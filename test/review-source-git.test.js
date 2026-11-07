import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import io from '../lib/io.js';
import { envGitLimpo } from './helpers/git-limpo.js';
import { SourceStore } from '../lib/review-source/store.js';
import { GitSource, RECENTES_POR_LADO } from '../lib/review-source/git.js';
import { releaseMaterialReference } from '../lib/review-source/index.js';
import { DEFAULTS } from '../lib/review-source/contract.js';

async function gitFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-source-git-'));
  const origin = path.join(root, 'origin'), materials = path.join(root, 'materials');
  await fs.mkdir(origin); await fs.mkdir(materials);
  const git = args => execFileSync('git', args, { cwd: origin, env: envGitLimpo(), encoding: 'utf8', windowsHide: true }).trim();
  git(['init', '--quiet']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.test']);
  await fs.writeFile(path.join(origin, 'source.js'), 'export const x = 1;\n');
  git(['add', '.']); git(['commit', '--quiet', '-m', 'base']); const base = git(['rev-parse', 'HEAD']);
  await fs.writeFile(path.join(origin, 'source.js'), 'export const x = 2;\n');
  git(['add', '.']); git(['commit', '--quiet', '-m', 'head']); const head = git(['rev-parse', 'HEAD']);
  const original = io.run; let fetches = 0;
  io.run = async (cmd, args, opts) => {
    if (cmd !== 'git') throw new Error('Nenhuma rede externa permitida na fixture.');
    const localArgs = args.map(arg => arg === 'https://github.com/org/repo.git' ? origin : arg);
    if (args.includes('fetch')) fetches++;
    // o ambiente é o de produção, e só a origem local precisa do protocolo que produção não abre
    return original(cmd, ['-c', 'protocol.file.allow=always', ...localArgs], opts);
  };
  t.after(async () => { io.run = original; await fs.rm(root, { recursive: true, force: true }); });
  const scope = { host: 'github.com', account: 'fixture', repo: 'org/repo', repositoryId: 123 };
  const options = { root: path.join(root, 'cache'), limits: { reserveBytes: 1 } };
  const store = await new SourceStore(scope, options).initialize();
  let alvoAtual = { head, base };
  const make = async name => {
    const leaseId = await store.acquire({ H: alvoAtual.head, B: alvoAtual.base, M: alvoAtual.base });
    const source = new GitSource({ ghEnv: () => ({}) }, store, leaseId, { head: alvoAtual.head, base: alvoAtual.base, mergeBase: alvoAtual.base }, { materialRoot: materials });
    const destination = path.join(materials, 'review-' + name); await fs.mkdir(destination);
    return { source, destination, leaseId, reference: { schema: 1, scope, leaseId } };
  };
  return { root, origin, store, make, git, options, fetches: () => fetches, alvo: novo => { alvoAtual = novo; } };
}
test('dois materiais compartilham objetos sem alternates e liberar um preserva o outro', async t => {
  const fx = await gitFixture(t), first = await fx.make('one'), second = await fx.make('two');
  await first.source.materialize(first.destination); await second.source.materialize(second.destination);
  assert.equal(fx.fetches(), 1);
  assert.equal(await fs.readFile(path.join(second.destination, 'source.js'), 'utf8'), 'export const x = 2;\n');
  await assert.rejects(fs.access(path.join(fx.store.root, 'repository.git/objects/info/alternates')));
  await fs.rm(first.destination, { recursive: true, force: true });
  await releaseMaterialReference(first.reference, first.destination, fx.options);
  assert.equal((await fx.store.lease(first.leaseId)).state, 'released');
  assert.equal((await fx.store.lease(second.leaseId)).state, 'active');
  assert.equal(await fs.readFile(path.join(second.destination, 'source.js'), 'utf8'), 'export const x = 2;\n');
  await second.source.prepare(); assert.equal(fx.fetches(), 1);
  const list = await second.source.run(['worktree', 'list', '--porcelain']);
  assert.ok(!list.includes(first.destination.replaceAll('\\', '/')));
  await fs.rm(second.destination, { recursive: true, force: true });
  await releaseMaterialReference(second.reference, second.destination, fx.options);
  await releaseMaterialReference(second.reference, second.destination, fx.options);
});
// Sem ref nenhuma entre aquisições, o fetch seguinte não anunciava o que o cache tinha e baixava o
// histórico inteiro (179 MB e 153 s no biud-frontend, acima do teto de 120 s).
test('refs conhecidas sobrevivem à liberação para o próximo fetch negociar', async t => {
  const fx = await gitFixture(t), first = await fx.make('known');
  await first.source.materialize(first.destination);
  await fs.rm(first.destination, { recursive: true, force: true });
  await releaseMaterialReference(first.reference, first.destination, fx.options);
  const refs = (await first.source.run(['for-each-ref', '--format=%(refname) %(objectname)'], { cleanup: true })).trim().split(/\r?\n/);
  const [base, head] = [fx.git(['rev-parse', 'HEAD~1']), fx.git(['rev-parse', 'HEAD'])];
  assert.deepEqual(refs.filter(ref => !ref.startsWith('refs/farol/known/recent/')).sort(), [`refs/farol/known/base ${base}`, `refs/farol/known/head ${head}`]);
  assert.deepEqual(refs.filter(ref => ref.startsWith('refs/farol/known/recent/')).map(ref => ref.replace(/\/\d{13}-[a-f0-9]{40} /, ' ')).sort(),
    [`refs/farol/known/recent/base ${base}`, `refs/farol/known/recent/head ${head}`]);
});
// Medido em 06/11/2026: alternar PRs para production, homologation e development baixava a divergência
// entre as bases de novo a cada troca (biud-frontend de 100 a 807 s por aquisição), porque known/{head,base}
// guardam só o último alvo. O anel de recentes mantém as bases anteriores no anúncio do fetch.
async function basesDivergentes(fx) {
  const commit = async (ramo, de, arquivos, mensagem) => {
    fx.git(['checkout', '--quiet', '-B', ramo, de]);
    for (const [nome, conteudo] of arquivos) {
      await fs.mkdir(path.dirname(path.join(fx.origin, nome)), { recursive: true });
      await fs.writeFile(path.join(fx.origin, nome), conteudo);
    }
    fx.git(['add', '.']); fx.git(['commit', '--quiet', '-m', mensagem]);
    return fx.git(['rev-parse', 'HEAD']);
  };
  const raiz = fx.git(['rev-parse', 'HEAD~1']);
  // Acima do transfer.unpackLimit (100): a divergência chega como pack, e o in-pack mostra o que veio.
  const muitos = lado => Array.from({ length: 150 }, (_, i) => [`${lado}/f${i}.txt`, `${lado} ${i} ${randomBytes(8).toString('hex')}\n`]);
  const baseA = await commit('ramo-a', raiz, muitos('a'), 'base a');
  const headA1 = await commit('pr-a1', baseA, [['a/pr.txt', 'a1\n']], 'pr a1');
  const baseB = await commit('ramo-b', raiz, muitos('b'), 'base b');
  const headB = await commit('pr-b', baseB, [['b/pr.txt', 'b\n']], 'pr b');
  const headA2 = await commit('pr-a2', baseA, [['a/pr2.txt', 'a2\n']], 'pr a2');
  return { baseA, headA1, baseB, headB, headA2 };
}
const objetos = async source => {
  const saida = await source.run(['count-objects', '-v'], { cleanup: true });
  const metricas = Object.fromEntries(saida.trim().split('\n').map(l => l.split(':').map(v => v.trim())));
  return Number(metricas.count) + Number(metricas['in-pack']);
};
async function preparar(fx, alvo, nome) {
  fx.alvo(alvo); const consumidor = await fx.make(nome);
  await consumidor.source.prepare();
  // Como depois da liberação: sem as refs do consumidor, só as known/ seguram o que o fetch anuncia.
  for (const lado of ['head', 'base', 'mergeBase']) await consumidor.source.run(['update-ref', '-d', consumidor.source.ref(lado)], { cleanup: true });
  return consumidor.source;
}
async function recentes(source, lado) {
  const saida = await source.run(['for-each-ref', '--format=%(refname) %(objectname)', `refs/farol/known/recent/${lado}/`], { cleanup: true });
  return saida.trim().split('\n').filter(Boolean).map(linha => linha.split(' ')[1]);
}
async function apagarAnel(source) {
  const saida = await source.run(['for-each-ref', '--format=%(refname)', 'refs/farol/known/recent/'], { cleanup: true });
  for (const nome of saida.trim().split('\n').filter(Boolean)) await source.run(['update-ref', '-d', nome], { cleanup: true });
}
test('alternar bases divergentes: a volta para a primeira base não baixa a divergência de novo', async t => {
  const fx = await gitFixture(t), alvos = await basesDivergentes(fx);
  await preparar(fx, { head: alvos.headA1, base: alvos.baseA }, 'a1');
  const fonte = await preparar(fx, { head: alvos.headB, base: alvos.baseB }, 'b');
  const antes = await objetos(fonte), fetchesAntes = fx.fetches();
  await preparar(fx, { head: alvos.headA2, base: alvos.baseA }, 'a2');
  assert.equal(fx.fetches(), fetchesAntes + 1, 'o head novo ainda precisa de um fetch');
  const recebidos = await objetos(fonte) - antes;
  assert.ok(recebidos < 20, `a volta à base A recebeu ${recebidos} objetos; esperado só o commit novo`);
});
test('controle: sem o anel, a mesma volta baixa a divergência inteira de novo', async t => {
  const fx = await gitFixture(t), alvos = await basesDivergentes(fx);
  await preparar(fx, { head: alvos.headA1, base: alvos.baseA }, 'a1');
  const fonte = await preparar(fx, { head: alvos.headB, base: alvos.baseB }, 'b');
  await apagarAnel(fonte);
  const antes = await objetos(fonte);
  await preparar(fx, { head: alvos.headA2, base: alvos.baseA }, 'a2');
  const recebidos = await objetos(fonte) - antes;
  assert.ok(recebidos > 150, `sem o anel a volta deveria trazer a divergência de novo, trouxe ${recebidos}`);
});
test('cache antigo só com known/{head,base}: o alvo guardado entra no anel antes de ser sobrescrito', async t => {
  const fx = await gitFixture(t), alvos = await basesDivergentes(fx);
  const fonte = await preparar(fx, { head: alvos.headA1, base: alvos.baseA }, 'a1');
  await apagarAnel(fonte);
  await preparar(fx, { head: alvos.headB, base: alvos.baseB }, 'b');
  assert.deepEqual(await recentes(fonte, 'base'), [alvos.baseA, alvos.baseB]);
  assert.deepEqual(await recentes(fonte, 'head'), [alvos.headA1, alvos.headB]);
  const antes = await objetos(fonte);
  await preparar(fx, { head: alvos.headA2, base: alvos.baseA }, 'a2');
  assert.ok(await objetos(fonte) - antes < 20, 'a base do cache antigo segue anunciada');
});
test('anel poda os mais antigos no limite e não duplica o alvo repetido', async t => {
  const fx = await gitFixture(t), cadeia = [fx.git(['rev-parse', 'HEAD'])];
  for (let i = 0; i < RECENTES_POR_LADO + 2; i++) {
    await fs.writeFile(path.join(fx.origin, 'source.js'), `export const x = ${i + 10};\n`);
    fx.git(['add', '.']); fx.git(['commit', '--quiet', '-m', `c${i}`]); cadeia.push(fx.git(['rev-parse', 'HEAD']));
  }
  let fonte;
  for (let i = 0; i < cadeia.length - 1; i++) {
    fonte = await preparar(fx, { head: cadeia[i + 1], base: cadeia[i] }, `c${i}`);
    await new Promise(pronto => setTimeout(pronto, 2)); // o carimbo é em ms: dois alvos no mesmo ms empatariam
  }
  assert.deepEqual(await recentes(fonte, 'base'), cadeia.slice(-1 - RECENTES_POR_LADO, -1), 'só as 8 bases mais recentes, da mais antiga para a mais nova');
  assert.deepEqual(await recentes(fonte, 'head'), cadeia.slice(-RECENTES_POR_LADO));
  // repetir um alvo que ainda está no anel o promove a mais recente, sem duplicar
  const repetida = cadeia[cadeia.length - 1 - RECENTES_POR_LADO];
  fonte = await preparar(fx, { head: cadeia[cadeia.length - RECENTES_POR_LADO], base: repetida }, 'repete');
  const bases = await recentes(fonte, 'base');
  assert.equal(bases.length, RECENTES_POR_LADO);
  assert.equal(bases.filter(sha => sha === repetida).length, 1);
  assert.equal(bases.at(-1), repetida);
});
test('fetch usa teto próprio para o cache frio e os demais comandos seguem com o teto comum', async t => {
  const fx = await gitFixture(t), first = await fx.make('cold'), inner = io.run, tetos = {};
  io.run = async (cmd, args, opts) => { tetos[args.includes('fetch') ? 'fetch' : 'outro'] = opts.timeout; return inner(cmd, args, opts); };
  await first.source.materialize(first.destination);
  io.run = inner;
  assert.equal(tetos.fetch, DEFAULTS.fetchTimeoutMs);
  assert.equal(tetos.outro, DEFAULTS.timeoutMs);
  assert.ok(DEFAULTS.fetchTimeoutMs > DEFAULTS.timeoutMs);
});
test('material existente não libera refs e aquisição repetida mantém o consumidor', async t => {
  const fx = await gitFixture(t), first = await fx.make('active');
  await first.source.materialize(first.destination);
  await assert.rejects(releaseMaterialReference(first.reference, first.destination, fx.options), /ainda existe/);
  assert.equal((await fx.store.lease(first.leaseId)).state, 'active');
  await fs.rm(first.destination, { recursive: true, force: true });
  await releaseMaterialReference(first.reference, first.destination, fx.options);
});
test('destino fora da raiz privada é recusado antes de buscar objetos', async t => {
  const fx = await gitFixture(t), first = await fx.make('escape');
  await assert.rejects(first.source.materialize(path.join(fx.root, 'review-outside')), /fora da raiz/);
  assert.equal(fx.fetches(), 0);
});

test('limpeza por ancestral alias remove somente o registro canônico do destino já removido', async t => {
  const fx = await gitFixture(t), first = await fx.make('aliased'), second = await fx.make('preserved');
  await first.source.materialize(first.destination); await second.source.materialize(second.destination);
  const registered = await fs.realpath(first.destination), other = await fs.realpath(second.destination);
  const alias = path.join(fx.root, 'materials-alias');
  await fs.symlink(path.dirname(first.destination), alias, 'junction');
  const absentAlias = path.join(alias, path.basename(first.destination));
  assert.notEqual(path.resolve(absentAlias), registered, 'a regressão precisa de caminhos diferentes para o mesmo material');
  await fs.rm(first.destination, { recursive: true, force: true });
  await first.source.removeWorktreeRegistration(absentAlias);
  const list = await second.source.run(['worktree', 'list', '--porcelain']);
  assert.ok(!list.includes(registered.replaceAll('\\', '/')), 'registro canônico removido');
  assert.ok(list.includes(other.replaceAll('\\', '/')), 'outro registro preservado');
  assert.equal(await fs.readFile(path.join(second.destination, 'source.js'), 'utf8'), 'export const x = 2;\n');
});

test('falha ao remover registro Git conserva lease e refs; retry conclui sem tocar outro material', async t => {
  const fx = await gitFixture(t), material = await fx.make('cleanup-failure'), other = await fx.make('cleanup-preserved');
  await material.source.materialize(material.destination); await other.source.materialize(other.destination);
  await fs.rm(material.destination, { recursive: true, force: true });
  const original = io.run;
  io.run = (command, args, options) => args.includes('worktree') && args.includes('remove')
    ? Promise.resolve({ ok: false, code: 1, stdout: '', stderr: 'falha de limpeza injetada' })
    : original(command, args, options);
  try { await assert.rejects(releaseMaterialReference(material.reference, material.destination, fx.options), /objetos Git/); }
  finally { io.run = original; }
  assert.equal((await fx.store.lease(material.leaseId)).state, 'active');
  const refs = await material.source.run(['show-ref']);
  assert.ok(refs.includes(material.source.ref('head')));
  assert.equal((await fx.store.lease(other.leaseId)).state, 'active');
  assert.equal(await fs.readFile(path.join(other.destination, 'source.js'), 'utf8'), 'export const x = 2;\n');
  await releaseMaterialReference(material.reference, material.destination, fx.options);
  assert.equal((await fx.store.lease(material.leaseId)).state, 'released');
  const after = await other.source.run(['show-ref']);
  assert.ok(!after.includes(material.source.ref('head')));
  assert.ok(after.includes(other.source.ref('head')));
  assert.equal((await fx.store.lease(other.leaseId)).state, 'active');
  assert.equal(await fs.readFile(path.join(other.destination, 'source.js'), 'utf8'), 'export const x = 2;\n');
});

// O fetch roda com --no-auto-maintenance e cada aquisição deixa um pack: medido em 03/11/2026 no
// biud-frontend, 74 packs e 1,5 GB que viravam 1 pack e 186 MB em 4 s. Sem compactar, o cache chegava
// ao limite e toda análise parava em "Materialização adiada". O pack duplicado reproduz esse acúmulo.
async function fragmentar(fx, source, copias) {
  const repositorio = path.join(fx.store.root, 'repository.git');
  execFileSync('git', ['--git-dir', repositorio, 'repack', '-a', '-d', '-q'], { env: envGitLimpo(), windowsHide: true });
  const pasta = path.join(repositorio, 'objects/pack');
  const nome = (await fs.readdir(pasta)).find(arquivo => arquivo.endsWith('.pack')).slice(0, -5);
  for (let i = 0; i < copias; i++) {
    const copia = 'pack-' + String(i).padStart(40, '0');
    await fs.copyFile(path.join(pasta, nome + '.pack'), path.join(pasta, copia + '.pack'));
    await fs.copyFile(path.join(pasta, nome + '.idx'), path.join(pasta, copia + '.idx'));
  }
  return (await source.measure()).bytes;
}
const packsDe = async source => Number(/^packs: (\d+)/m.exec(await source.run(['count-objects', '-v'], { cleanup: true }))[1]);
async function liberar(fx, consumidor) {
  await fs.rm(consumidor.destination, { recursive: true, force: true });
  await releaseMaterialReference(consumidor.reference, consumidor.destination, fx.options);
}
// A folga de aquisição (16 MiB) é maior que a fixture inteira: sem reduzir, nada caberia no teto.
function limitarEscopo(fx, maxBytes) {
  const teto = { maxBytes, acquisitionReserveBytes: 1024 };
  fx.store.limits = { ...fx.store.limits, ...teto };
  fx.store.budget.limits = { ...fx.store.budget.limits, ...teto };
}
async function commitGrande(fx) {
  await fs.writeFile(path.join(fx.origin, 'grande.bin'), randomBytes(256 * 1024));
  fx.git(['add', '.']); fx.git(['commit', '--quiet', '-m', 'grande']);
}
test('acúmulo de packs no limite: compacta, materializa e não busca de novo', async t => {
  const fx = await gitFixture(t); await commitGrande(fx);
  const [head, base] = [fx.git(['rev-parse', 'HEAD']), fx.git(['rev-parse', 'HEAD~1'])];
  fx.alvo({ head, base });
  const primeiro = await fx.make('um');
  await primeiro.source.materialize(primeiro.destination);
  await liberar(fx, primeiro);
  const inflado = await fragmentar(fx, primeiro.source, 12);
  limitarEscopo(fx, Math.floor(inflado * 0.8));
  const segundo = await fx.make('dois');
  await segundo.source.materialize(segundo.destination);
  assert.equal(await packsDe(segundo.source), 1);
  assert.equal(fx.fetches(), 1, 'compactar não pode custar um fetch novo');
  assert.equal((await fs.readFile(path.join(segundo.destination, 'grande.bin'))).length, 256 * 1024);
});
test('compactar preserva o que um consumidor ativo está usando', async t => {
  const fx = await gitFixture(t); await commitGrande(fx);
  const [head, base] = [fx.git(['rev-parse', 'HEAD']), fx.git(['rev-parse', 'HEAD~1'])];
  fx.alvo({ head, base });
  const ativo = await fx.make('ativo');
  await ativo.source.materialize(ativo.destination);
  await fragmentar(fx, ativo.source, 3);
  assert.equal(await ativo.source.compactar(), true);
  assert.equal(await packsDe(ativo.source), 1);
  assert.ok((await ativo.source.run(['cat-file', '-t', head], { cleanup: true })).includes('commit'));
  await ativo.source.run(['fsck', '--full', '--no-reflogs'], { cleanup: true });
});
test('fragmentação alta compacta na própria aquisição, sem esperar o limite, e guarda o commit novo', async t => {
  const fx = await gitFixture(t), primeiro = await fx.make('frag');
  await primeiro.source.materialize(primeiro.destination);
  await liberar(fx, primeiro);
  await fragmentar(fx, primeiro.source, 25);
  await commitGrande(fx);
  const [head, base] = [fx.git(['rev-parse', 'HEAD']), fx.git(['rev-parse', 'HEAD~1'])];
  fx.alvo({ head, base });
  const segundo = await fx.make('novo');
  await segundo.source.materialize(segundo.destination);
  assert.equal(fx.fetches(), 2);
  assert.equal(await packsDe(segundo.source), 1);
  assert.equal((await fs.readFile(path.join(segundo.destination, 'grande.bin'))).length, 256 * 1024);
});
test('pouco fragmentado não gasta compactação', async t => {
  const fx = await gitFixture(t), primeiro = await fx.make('pouco');
  await primeiro.source.materialize(primeiro.destination);
  await liberar(fx, primeiro);
  await fragmentar(fx, primeiro.source, 3);
  await commitGrande(fx);
  const [head, base] = [fx.git(['rev-parse', 'HEAD']), fx.git(['rev-parse', 'HEAD~1'])];
  fx.alvo({ head, base });
  const segundo = await fx.make('pouco2');
  await segundo.source.materialize(segundo.destination);
  assert.ok(await packsDe(segundo.source) >= 4);
});
test('sem espaço mesmo compactado, a materialização segue adiada e o material fica vazio', async t => {
  const fx = await gitFixture(t); await commitGrande(fx);
  const [head, base] = [fx.git(['rev-parse', 'HEAD']), fx.git(['rev-parse', 'HEAD~1'])];
  fx.alvo({ head, base });
  const primeiro = await fx.make('cheio');
  await primeiro.source.prepare();
  const usado = (await fx.store.usage()).bytes;
  limitarEscopo(fx, usado + 1024);
  await assert.rejects(primeiro.source.materialize(primeiro.destination), /Materialização adiada/);
  assert.deepEqual(await fs.readdir(primeiro.destination), []);
});
test('compactar sem ganho não roda repack, e pack temporário de repack morto sai da conta', async t => {
  const fx = await gitFixture(t); await commitGrande(fx);
  const [head, base] = [fx.git(['rev-parse', 'HEAD']), fx.git(['rev-parse', 'HEAD~1'])];
  fx.alvo({ head, base });
  const consumidor = await fx.make('unico');
  await consumidor.source.prepare();
  await fragmentar(fx, consumidor.source, 0);
  assert.equal(await consumidor.source.compactar(), false, 'um pack só não ganha nada');
  const resto = path.join(fx.store.root, 'repository.git/objects/pack/tmp_pack_morto');
  await fs.writeFile(resto, randomBytes(4096));
  assert.equal(await consumidor.source.compactar(), true);
  await assert.rejects(fs.access(resto));
});
test('repack usa o teto longo do fetch e reserva pelo orçamento, que devolve a reserva no fim', async t => {
  const fx = await gitFixture(t); await commitGrande(fx);
  const [head, base] = [fx.git(['rev-parse', 'HEAD']), fx.git(['rev-parse', 'HEAD~1'])];
  fx.alvo({ head, base });
  const consumidor = await fx.make('teto');
  await consumidor.source.prepare();
  await fragmentar(fx, consumidor.source, 2);
  const original = io.run; let teto, reservas;
  io.run = async (cmd, args, opts) => {
    if (args.includes('repack')) { teto = opts.timeout; reservas = Object.values((await fx.store.budget.state()).reservations).map(r => r.kind); }
    return original(cmd, args, opts);
  };
  assert.equal(await consumidor.source.compactar(), true);
  io.run = original;
  assert.equal(teto, fx.store.limits.fetchTimeoutMs);
  assert.deepEqual(reservas, ['git-compaction']);
  assert.deepEqual(Object.keys((await fx.store.budget.state()).reservations), []);
});
test('trava do orçamento ocupada ao terminar o repack: a marca do Git sai e o erro persistente aparece', async t => {
  const fx = await gitFixture(t); await commitGrande(fx);
  const [head, base] = [fx.git(['rev-parse', 'HEAD']), fx.git(['rev-parse', 'HEAD~1'])];
  fx.alvo({ head, base });
  const consumidor = await fx.make('trava');
  await consumidor.source.prepare();
  await fragmentar(fx, consumidor.source, 2);
  const original = fx.store.protectedGit.bind(fx.store); let falhas = 2;
  fx.store.protectedGit = async (lease, pendente) => {
    if (!pendente && falhas-- > 0) throw new Error('trava ocupada');
    return original(lease, pendente);
  };
  assert.equal(await consumidor.source.compactar(), true);
  assert.equal((await fx.store.lease(consumidor.leaseId)).gitProcessPending, false);
  await fragmentar(fx, consumidor.source, 2);
  fx.store.protectedGit = async (lease, pendente) => {
    if (!pendente) throw new Error('trava ocupada');
    return original(lease, pendente);
  };
  await assert.rejects(consumidor.source.compactar(), /trava ocupada/);
});
test('falha da compactação não vira erro próprio: quem decide é o limite', async t => {
  const fx = await gitFixture(t); await commitGrande(fx);
  const [head, base] = [fx.git(['rev-parse', 'HEAD']), fx.git(['rev-parse', 'HEAD~1'])];
  fx.alvo({ head, base });
  const primeiro = await fx.make('falha');
  await primeiro.source.prepare();
  await fragmentar(fx, primeiro.source, 2);
  const original = io.run;
  io.run = async (cmd, args, opts) => (args.includes('repack') ? { ok: false, code: 1, stdout: '', stderr: 'sem disco' } : original(cmd, args, opts));
  assert.equal(await primeiro.source.compactar(), false);
  io.run = original;
  assert.ok((await primeiro.source.run(['cat-file', '-t', head], { cleanup: true })).includes('commit'));
});
