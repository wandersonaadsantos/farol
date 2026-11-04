// Lacunas conferidas contra o Sentinela: check legado pendente, label durante o sono, trava órfã do
// git e cache de repositório parado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checksExigidosVerdes } from '../lib/engine/checks-exigidos.js';
import skip from '../lib/engine/skip-review.js';
import { GitSource } from '../lib/review-source/git.js';
import { reclaimScopeGit, scopesWithIdleGit } from '../lib/review-source/storage-reclaim.js';
import { DEFAULTS } from '../lib/review-source/contract.js';
import { envGitLimpo } from './helpers/git-limpo.js';

const pasta = (t) => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-resiliencia-'));
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true, maxRetries: 3 }));
  return raiz;
};

test('status legado ainda rodando não é vermelho', () => {
  for (const state of ['PENDING', 'pending', 'EXPECTED']) {
    const r = checksExigidosVerdes([{ context: 'ci/externo', state }], ['ci/externo']);
    assert.deepEqual(r.faltando, [{ nome: 'ci/externo', estado: 'rodando' }], state);
  }
});

test('status legado concluído segue como antes: falha é vermelho e sucesso passa', () => {
  for (const state of ['FAILURE', 'ERROR']) {
    assert.deepEqual(checksExigidosVerdes([{ context: 'c', state }], ['c']).faltando, [{ nome: 'c', estado: 'vermelho' }], state);
  }
  assert.equal(checksExigidosVerdes([{ context: 'c', state: 'SUCCESS' }], ['c']).pronto, true);
  assert.deepEqual(checksExigidosVerdes([{ name: 'c', status: 'IN_PROGRESS' }], ['c']).faltando, [{ nome: 'c', estado: 'rodando' }]);
  assert.equal(checksExigidosVerdes([{ name: 'c', status: 'COMPLETED', conclusion: 'SUCCESS' }], ['c']).pronto, true);
});

const INTERVALO_S = 300;
const motorDeLabel = () => {
  const gravados = [];
  return {
    labelVistaDesde: {}, config: { intervalSeconds: INTERVALO_S }, accountForPr: () => 'eu',
    saveLabelVistaDesde: () => {}, saveLabelVistaObservada() { gravados.push(this.labelVistaObservadaEm); }, gravados,
  };
};
const COM_LABEL = [{ key: 'o/r#1', labels: ['ana:revisando'] }];
const HORA = 3600e3;

test('ciclos seguidos preservam o carimbo da label', () => {
  const e = motorDeLabel();
  for (let i = 0; i < 12; i++) skip.marcarLabelsVistas(e, COM_LABEL, 1000 + i * INTERVALO_S * 1000);
  assert.equal(e.labelVistaDesde['o/r#1'].ana, 1000);
});

test('notebook fechado: a contagem pausa, sem caducar nem recomeçar', () => {
  const e = motorDeLabel();
  skip.marcarLabelsVistas(e, COM_LABEL, 1000);
  skip.marcarLabelsVistas(e, COM_LABEL, 1000 + 60e3);
  const acordou = 1000 + 60e3 + 10 * HORA;
  skip.marcarLabelsVistas(e, COM_LABEL, acordou);
  assert.equal(acordou - e.labelVistaDesde['o/r#1'].ana, 60e3, 'só o tempo observado conta');
});

test('sonos repetidos não prendem a label: o tempo observado segue somando', () => {
  const e = motorDeLabel();
  let agora = 1000;
  skip.marcarLabelsVistas(e, COM_LABEL, agora);
  for (let dia = 0; dia < 30; dia++) {
    for (let i = 0; i < 24; i++) { agora += INTERVALO_S * 1000; skip.marcarLabelsVistas(e, COM_LABEL, agora); }
    agora += HORA / 3;
    skip.marcarLabelsVistas(e, COM_LABEL, agora);
  }
  assert.equal(agora - e.labelVistaDesde['o/r#1'].ana, 30 * 24 * INTERVALO_S * 1000);
});

test('label já caducada não ressuscita depois do sono', () => {
  const e = motorDeLabel();
  let agora = 1000;
  skip.marcarLabelsVistas(e, COM_LABEL, agora);
  for (let i = 0; i < 48; i++) { agora += INTERVALO_S * 1000; skip.marcarLabelsVistas(e, COM_LABEL, agora); }
  const observado = agora - e.labelVistaDesde['o/r#1'].ana;
  agora += 10 * HORA;
  skip.marcarLabelsVistas(e, COM_LABEL, agora);
  assert.equal(agora - e.labelVistaDesde['o/r#1'].ana, observado);
});

test('relógio que voltou não apaga o tempo já observado nem deixa carimbo no futuro', () => {
  const e = motorDeLabel();
  skip.marcarLabelsVistas(e, COM_LABEL, 100 * HORA);
  skip.marcarLabelsVistas(e, COM_LABEL, 100 * HORA + 60e3);
  const voltou = 90 * HORA;
  skip.marcarLabelsVistas(e, COM_LABEL, voltou);
  assert.equal(voltou - e.labelVistaDesde['o/r#1'].ana, 60e3);
});

test('label que aparece depois do sono nasce com o relógio de agora', () => {
  const e = motorDeLabel();
  skip.marcarLabelsVistas(e, [{ key: 'o/r#1', labels: [] }], 1000);
  const acordou = 10 * HORA;
  skip.marcarLabelsVistas(e, COM_LABEL, acordou);
  assert.equal(e.labelVistaDesde['o/r#1'].ana, acordou);
});

test('intervalo longo configurado não conta como sono, senão a label nunca caducaria', () => {
  const e = motorDeLabel();
  e.config.intervalSeconds = 3600;
  skip.marcarLabelsVistas(e, COM_LABEL, 1000);
  skip.marcarLabelsVistas(e, COM_LABEL, 1000 + HORA);
  assert.equal(e.labelVistaDesde['o/r#1'].ana, 1000);
});

test('o instante da observação vai a disco, sem gravar a cada ciclo, e sobrevive ao reinício', () => {
  const e = motorDeLabel();
  for (let i = 0; i <= 12; i++) skip.marcarLabelsVistas(e, COM_LABEL, 1000 + i * 60e3);
  assert.ok(e.gravados.length >= 2 && e.gravados.length <= 4, `gravou ${e.gravados.length} vezes em 12 min`);
  const depois = motorDeLabel();
  depois.labelVistaDesde = { 'o/r#1': { ana: 1000 } };
  depois.labelVistaObservadaEm = e.gravados.at(-1);
  const acordou = 10 * HORA;
  skip.marcarLabelsVistas(depois, COM_LABEL, acordou);
  assert.equal(acordou - depois.labelVistaDesde['o/r#1'].ana, e.gravados.at(-1) - 1000);
});

test('sem registro da última observação vale o carimbo antigo, como antes', () => {
  const e = motorDeLabel();
  e.labelVistaDesde = { 'o/r#1': { ana: 1000 } };
  skip.marcarLabelsVistas(e, COM_LABEL, 10 * HORA);
  assert.equal(e.labelVistaDesde['o/r#1'].ana, 1000);
});

const git = (dir, ...args) => execFileSync('git', ['--git-dir', dir, ...args], { encoding: 'utf8', env: envGitLimpo(), stdio: ['ignore', 'pipe', 'pipe'] });
function fonteComTrava(t, idadeMs) {
  const raiz = pasta(t);
  const gitDir = path.join(raiz, 'repository.git');
  execFileSync('git', ['init', '--bare', '-q', gitDir], { env: envGitLimpo() });
  const arvore = git(gitDir, 'hash-object', '-t', 'tree', '-w', '--stdin', '--no-filters').trim() || '';
  const commit = execFileSync('git', ['--git-dir', gitDir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit-tree', arvore, '-m', 'x'],
    { encoding: 'utf8', env: envGitLimpo() }).trim();
  const trava = path.join(gitDir, 'refs', 'farol', 'known', 'head.lock');
  fs.mkdirSync(path.dirname(trava), { recursive: true });
  fs.writeFileSync(trava, '');
  const quando = new Date(Date.now() - idadeMs);
  fs.utimesSync(trava, quando, quando);
  const store = { root: raiz, scope: { account: 'eu' }, limits: { ...DEFAULTS, timeoutMs: 10_000, fetchTimeoutMs: 10_000 }, protectedGit: async () => {} };
  const engine = { ghEnv: () => ({ GH_TOKEN: '', GITHUB_TOKEN: '' }) };
  return { fonte: new GitSource(engine, store, 'lease', {}, {}), trava, commit, gitDir };
}

test('trava que passou do prazo é órfã: sai, e o comando anda', async (t) => {
  const { fonte, trava, commit, gitDir } = fonteComTrava(t, 60_000);
  await fonte.run(['update-ref', 'refs/farol/known/head', commit]);
  assert.equal(fs.existsSync(trava), false);
  assert.equal(git(gitDir, 'rev-parse', 'refs/farol/known/head').trim(), commit);
});

test('trava recente é de outro git em curso: fica, e o comando falha', async (t) => {
  const { fonte, trava, commit } = fonteComTrava(t, 1000);
  await assert.rejects(fonte.run(['update-ref', 'refs/farol/known/head', commit]));
  assert.equal(fs.existsSync(trava), true);
});

test('a repetição depois de trava tem teto', async (t) => {
  const { fonte, commit } = fonteComTrava(t, 1000);
  let chamadas = 0;
  fonte.removerTravaOrfa = async () => { chamadas++; return true; };
  await assert.rejects(fonte.run(['update-ref', 'refs/farol/known/head', commit]));
  assert.equal(chamadas, 3);
});

test('trava citada fora do repositório nunca é apagada', async (t) => {
  const { fonte } = fonteComTrava(t, 0);
  const fora = path.join(pasta(t), 'x.lock');
  fs.writeFileSync(fora, '');
  const antiga = new Date(Date.now() - 60_000);
  fs.utimesSync(fora, antiga, antiga);
  assert.equal(await fonte.removerTravaOrfa(`fatal: Unable to create '${fora.split(path.sep).join('/')}': File exists`), false);
  assert.equal(fs.existsSync(fora), true);
});

function escopo(base, nome, { lease = 'released', usadoEm = 1 } = {}) {
  const root = path.join(base, nome);
  fs.mkdirSync(path.join(root, 'repository.git'), { recursive: true });
  fs.mkdirSync(path.join(root, 'leases'), { recursive: true });
  fs.writeFileSync(path.join(root, 'repository.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(root, 'leases', 'a.json'), JSON.stringify({ schema: 1, state: lease }));
  fs.writeFileSync(path.join(root, 'git-usage.json'), JSON.stringify({ bytes: 5, measuredAt: usadoEm }));
  return root;
}

test('despeja o Git do escopo sem consumidor e zera a medida', async (t) => {
  const base = pasta(t);
  const root = escopo(base, 'parado');
  assert.equal(await reclaimScopeGit(base, root), true);
  assert.equal(fs.existsSync(path.join(root, 'repository.git')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'git-usage.json'), 'utf8')).bytes, 0);
});

test('repositório sem HEAD, de uma remoção antiga pela metade, também sai', async (t) => {
  const base = pasta(t);
  const root = escopo(base, 'pela-metade');
  fs.rmSync(path.join(root, 'repository.git', 'HEAD'));
  assert.equal(await reclaimScopeGit(base, root), true);
  assert.equal(fs.existsSync(path.join(root, 'repository.git')), false);
});

test('sobra de um despejo interrompido não sobrevive à passada seguinte', async (t) => {
  const base = pasta(t);
  const root = escopo(base, 'sobra');
  const sobra = path.join(root, 'repository.git.despejado.tmp');
  fs.mkdirSync(sobra);
  fs.writeFileSync(path.join(sobra, 'pack'), 'x');
  assert.equal(await reclaimScopeGit(base, root), true);
  assert.equal(fs.existsSync(sobra), false);
});

test('escopo com consumidor ativo preserva o Git', async (t) => {
  const base = pasta(t);
  const root = escopo(base, 'ativo', { lease: 'prepared' });
  assert.equal(await reclaimScopeGit(base, root), false);
  assert.equal(fs.existsSync(path.join(root, 'repository.git', 'HEAD')), true);
});

test('escolhe do uso mais antigo para o mais novo, fora o próprio, o incerto e o usado há pouco', async (t) => {
  const base = pasta(t);
  const agora = 10 * HORA;
  escopo(base, 'novo', { usadoEm: 300 });
  escopo(base, 'velho', { usadoEm: 100 });
  escopo(base, 'meu', { usadoEm: 1 });
  for (const nome of ['incerto', 'pendente', 'alheio']) escopo(base, nome, { usadoEm: 2 });
  escopo(base, 'recente', { usadoEm: agora - 60e3 });
  const inventario = {
    novo: { gitBytes: 1 }, velho: { gitBytes: 1 }, meu: { gitBytes: 1 }, recente: { gitBytes: 1 }, vazio: { gitBytes: 0 },
    incerto: { gitBytes: 1, terminationUnconfirmed: true }, pendente: { gitBytes: 1, pendingGitProcess: true }, alheio: { gitBytes: 1, foreignGitProcess: true },
  };
  assert.deepEqual((await scopesWithIdleGit(base, inventario, 'meu', agora)).map(i => i.scope), ['velho', 'novo']);
});

test('medida corrompida de um escopo parado não derruba a aquisição de outro', async (t) => {
  const base = pasta(t);
  const root = escopo(base, 'torto');
  fs.writeFileSync(path.join(root, 'git-usage.json'), '{quebrado');
  assert.deepEqual((await scopesWithIdleGit(base, { torto: { gitBytes: 1 } }, 'outro', 10 * HORA)).map(i => i.scope), ['torto']);
});
