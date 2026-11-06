// Objetos Git por autorização, refs por consumidor e worktrees descartáveis. Exceção: refs/farol/known/{head,base}
// guardam o último alvo preparado, e refs/farol/known/recent/{head,base}/ os últimos alvos de cada lado, para o
// fetch seguinte negociar só o que falta.
import fs from 'node:fs/promises';
import path from 'node:path';
import io from '../io.js';
import { envGitIsolado, FLAGS_GIT_ISOLADO, flagsDeRedeDaMaquina } from '../git-isolado.js';
import { STATE_DIR } from '../paths.js';
import { SHA, check, aborted } from './contract.js';
import { contained, atomic } from './store.js';
import { treeBytes } from './storage-inventory.js';
import { removerSobraDeDespejo } from './storage-reclaim.js';

const FLAGS = [...FLAGS_GIT_ISOLADO, '-c', 'fetch.fsckObjects=true'];
// Reinício no meio de um update-ref deixa o .lock para sempre, e o repositório recusa toda aquisição.
const TRAVA_RECUSADA = /Unable to create '([^'\n]+\.lock)': File exists/;
const TENTATIVAS_APOS_TRAVA = 3;
// O fetch roda com --no-auto-maintenance, então só esta classe junta os packs. Medido em 03/11/2026 no
// biud-frontend: 74 packs e 1,5 GB viraram 1 pack e 186 MB em 4 s, já sem os commits que nenhuma ref
// alcança; quem precisar de um deles paga um fetch incremental.
const PACKS_PARA_COMPACTAR = 20;
// Anel de alvos recentes (06/11/2026): até 8 por lado cobre as três bases do GitFlow com folga para os
// merge-backs de release intercalados, e 16 refs não pesam na negociação.
const PREFIXO_RECENTES = 'refs/farol/known/recent/';
const RECENTES_POR_LADO = 8;
const FALHA_DO_GIT = 'Não foi possível preparar os objetos Git da fonte.';
const SEM_ESPACO_PARA_COMPACTAR = /^(?:Quota global|Reserva global)/;
class GitSource {
  constructor(engine, store, lease, target, options = {}) {
    this.engine = engine; this.store = store; this.leaseId = lease; this.target = target;
    this.options = options; this.gitDir = path.join(store.root, 'repository.git');
  }
  async run(args, options = {}) {
    const signal = options.cleanup ? undefined : (options.signal || this.options.signal);
    aborted(signal);
    const auth = this.engine.ghEnv(this.store.scope.authAccount || this.store.scope.account);
    // Em inglês fixo porque o stderr é lido: traduzido, a trava órfã não seria reconhecida.
    const env = { ...envGitIsolado(), LC_ALL: 'C', LANGUAGE: 'C', GH_TOKEN: auth.GH_TOKEN, GITHUB_TOKEN: auth.GITHUB_TOKEN };
    const protectedWrite = args.includes('fetch') || args[0] === 'repack' || (args[0] === 'worktree' && args[1] === 'add');
    if (protectedWrite) await this.store.protectedGit(this.leaseId, true);
    const result = await io.run('git', [...FLAGS, '--git-dir', this.gitDir, ...args],
      { env, signal, timeout: this.store.limits.timeoutMs, maxBuffer: 32 * 1024 ** 2, ...options });
    if (uncertainTermination(result, signal)) {
      const error = new Error('Término da árvore de processos Git não confirmado; materiais e reserva preservados.');
      error.sourceTerminationUnconfirmed = true;
      try { await this.store.markUnconfirmed(this.leaseId); }
      catch { /* O erro mantém a reserva; ausência de registro verificável também impede a limpeza. */ }
      throw error;
    }
    if (protectedWrite) await this.desmarcarGit();
    aborted(signal);
    const tentativas = options.tentativasAposTrava ?? TENTATIVAS_APOS_TRAVA;
    if (!result.ok && tentativas > 0 && await this.removerTravaOrfa(result.stderr)) {
      return this.run(args, { ...options, tentativasAposTrava: tentativas - 1 });
    }
    check(result.ok, FALHA_DO_GIT);
    return result.stdout;
  }
  // Outro PR do mesmo repositório pode estar com o git em curso, e a trava dele é legítima. Só é órfã
  // a que passou do dobro do maior prazo de um git: até ali ele teria terminado ou sido encerrado.
  async removerTravaOrfa(stderr) {
    const citada = TRAVA_RECUSADA.exec(stderr || '')?.[1];
    if (!citada) return false;
    const trava = path.resolve(citada);
    const relativo = path.relative(this.gitDir, trava);
    if (!relativo || relativo.startsWith('..') || path.isAbsolute(relativo)) return false;
    const { timeoutMs, fetchTimeoutMs } = this.store.limits;
    try {
      const { mtimeMs } = await fs.lstat(trava);
      if (Date.now() - mtimeMs <= 2 * Math.max(timeoutMs, fetchTimeoutMs)) return false;
      await fs.rm(trava);
      return true;
    } catch { return false; }
  }
  // A trava do orçamento pode estar com outro processo. Marca que fica pendente prende o repositório até
  // reiniciar o app, então a contenção passageira ganha novas tentativas antes de virar erro.
  async desmarcarGit(novasTentativas = 2) {
    try { await this.store.protectedGit(this.leaseId, false); }
    catch (error) {
      if (!novasTentativas) throw error;
      await this.desmarcarGit(novasTentativas - 1);
    }
  }
  ref(side) { return `refs/farol/consumers/${this.leaseId}/${side}`; }
  async missingCommits(hashes) {
    const missing = [];
    for (const sha of hashes) {
      const value = await io.run('git', [...FLAGS, '--git-dir', this.gitDir, 'cat-file', '-e', `${sha}^{commit}`],
        { env: envGitIsolado(), signal: this.options.signal });
      if (!value.ok) missing.push(sha);
    }
    return missing;
  }
  async prepare() {
    return this.store.transaction(async () => {
      await contained(this.store.base, this.gitDir);
      // A sobra do próprio escopo nunca é candidata a despejo: sai quando o repositório volta a ser usado.
      await removerSobraDeDespejo(this.store.root).catch(() => false);
      const existing = await this.store.usage();
      if (existing.bytes > this.store.limits.maxBytes) await this.liberarEspaco();
      try { await fs.access(path.join(this.gitDir, 'HEAD')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; await this.run(['init', '--bare', this.gitDir]); }
      const hashes = [...new Set([this.target.head, this.target.base, this.target.mergeBase])];
      check(hashes.every(sha => SHA.test(sha)), 'Commits Git inválidos.');
      const missing = await this.missingCommits(hashes);
      if (missing.length) {
        await this.acquireCommits(missing);
        this.store.metrics.acquisitions++;
      }
      for (const side of ['head', 'base', 'mergeBase']) await this.run(['update-ref', this.ref(side), this.target[side]]);
      await this.run(['fsck', '--full', '--no-reflogs']);
      const measured = (await this.run(['merge-base', this.target.base, this.target.head])).trim();
      check(measured === this.target.mergeBase, 'Merge-base Git diverge da fonte GitHub.');
      // Sem ref nenhuma o fetch seguinte não anuncia o que o cache tem e baixa o histórico inteiro
      // (179 MB e 153 s no biud-frontend, acima do teto de 120 s). Estas duas refs ficam entre aquisições.
      const anteriores = await this.refsConhecidas().catch(() => null);
      for (const side of ['head', 'base']) await this.run(['update-ref', `refs/farol/known/${side}`, this.target[side]]);
      // O anel é otimização do fetch seguinte: falha nele (um .lock de Git morto, por exemplo) não
      // derruba a preparação, que já tem known/{head,base} gravadas.
      if (anteriores) await this.lembrarRecentes(anteriores).catch(() => null);
      if (missing.length && await this.fragmentado()) await this.compactar();
      await this.measure();
      if ((await this.store.usage()).bytes > this.store.limits.maxBytes && await this.liberarEspaco()) {
        throw new Error('Objetos Git acima do limite; preparação adiada, consumidores ativos preservados.');
      }
      await this.store.markGitPrepared(this.leaseId);
    }, this.options.signal);
  }
  // Todas as refs sob refs/farol/known/, como { nome: sha }, lidas antes de sobrescrever known/{head,base}.
  async refsConhecidas() {
    const saida = await this.run(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/farol/known/']);
    return Object.fromEntries(saida.split('\n').map(linha => linha.trim().split(' ')).filter(([nome, sha]) => nome && SHA.test(sha || '')));
  }
  // Anel de alvos recentes por lado (06/11/2026). known/{head,base} guardam só o último alvo, e o fetch
  // (sem --negotiation-tip, negociação padrão "consecutive") anuncia como "tenho" as pontas de TODAS as
  // refs locais. Alternando PRs para production, homologation e development, a base da outra troca
  // sumia do anúncio e a divergência vinha de novo: aquisição do biud-frontend de 100 a 807 s por
  // revisão (mediana do dia 116 s, p90 588 s; nos repositórios pequenos, 3 a 6 s). Um anel por lado
  // porque os heads trocam a cada PR e, num anel único, empurrariam as bases para fora.
  // As refs seguram objetos no repack (`-a -d`): o limite delas é a poda por contagem, e acima do
  // `maxBytes` o despejo continua apagando o repository.git inteiro, anel junto.
  async lembrarRecentes(anteriores) {
    const agora = Date.now();
    for (const side of ['head', 'base']) {
      const prefixo = `${PREFIXO_RECENTES}${side}/`, sha = this.target[side];
      const anel = Object.keys(anteriores).filter(nome => nome.startsWith(prefixo));
      const novas = [`${prefixo}${String(agora).padStart(13, '0')}-${sha}`];
      // Cache anterior ao anel só tem known/{head,base}: o alvo que ela guardava entra como o mais antigo.
      const legado = anteriores[`refs/farol/known/${side}`];
      if (!anel.length && legado && legado !== sha) novas.push(`${prefixo}${String(agora - 1).padStart(13, '0')}-${legado}`);
      // Cria antes de apagar: o alvo nunca fica sem ref entre os dois comandos.
      for (const nome of novas) await this.run(['update-ref', nome, nome.slice(-40)]);
      const repetidas = anel.filter(nome => nome.endsWith(`-${sha}`) && !novas.includes(nome));
      const vivas = [...new Set([...anel.filter(nome => !repetidas.includes(nome)), ...novas])].sort().reverse();
      for (const nome of [...repetidas, ...vivas.slice(RECENTES_POR_LADO)]) await this.run(['update-ref', '-d', nome]);
    }
  }
  async acquireCommits(missing) {
    return this.store.withBudget('git-acquisition', this.store.limits.acquisitionReserveBytes, this.options.signal, async signal =>
      this.run([...await flagsDeRedeDaMaquina(signal), '-c', 'credential.helper=!gh auth git-credential',
        'fetch', '--no-tags', '--no-auto-maintenance', `https://${this.store.scope.host}/${this.store.scope.repo}.git`, ...missing], { signal, timeout: this.store.limits.fetchTimeoutMs }));
  }
  async contarPacks() {
    return Number(/^packs: (\d+)/m.exec(await this.run(['count-objects', '-v']))?.[1] || 0);
  }
  async fragmentado() { return await this.contarPacks() >= PACKS_PARA_COMPACTAR; }
  // Repack morto no meio deixa o pack temporário para trás, e ele entra na conta do cache.
  async restosDeRepack() {
    const pasta = path.join(this.gitDir, 'objects/pack');
    const nomes = await fs.readdir(pasta).catch(() => []);
    return nomes.filter(nome => nome.startsWith('tmp_')).map(nome => path.join(pasta, nome));
  }
  // Só roda dentro da transação do store e depois de os alvos terem ref: `-a -d` descarta o que nenhuma
  // ref alcança. As worktrees dos consumidores ativos contam como referência para o Git.
  // Falha aqui não é o erro de ninguém: sobra o pack antigo, e o limite decide o que acontece.
  async compactar() {
    try { await fs.access(path.join(this.gitDir, 'HEAD')); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    const restos = await this.restosDeRepack();
    if (await this.contarPacks() < 2 && !restos.length) return false;
    const reserva = this.store.limits.acquisitionReserveBytes;
    try { await this.store.withBudget('git-compaction', reserva, this.options.signal, signal => this.repack(restos, signal)); }
    catch (error) {
      if (error.message !== FALHA_DO_GIT && !SEM_ESPACO_PARA_COMPACTAR.test(error.message)) throw error;
      return false;
    }
    await this.measure();
    return true;
  }
  async repack(restos, signal) {
    await Promise.all(restos.map(resto => fs.rm(resto, { force: true })));
    await this.run(['repack', '-a', '-d', '-q'], { signal, timeout: this.store.limits.fetchTimeoutMs });
  }
  // Compactar antes de despejar: despejar joga fora o histórico, e buscar de novo custa minutos.
  // Devolve se o cache precisou ser despejado.
  async liberarEspaco() {
    await this.compactar();
    if ((await this.store.usage()).bytes <= this.store.limits.maxBytes) return false;
    await this.evictInactive();
    return true;
  }
  async evictInactive() {
    check((await this.store.gitConsumers(this.leaseId)).length === 0, 'Objetos Git ativos não podem ser removidos pelo limite.');
    const own = await this.store.lease(this.leaseId);
    check(!own?.gitProcessPending && !own?.terminationUnconfirmed, 'Aquisição Git com término não confirmado; cache preservado.');
    check(!own?.gitPrepared, 'Consumidor atual já utiliza os objetos Git; cache preservado.');
    await contained(this.store.base, this.gitDir);
    await fs.rm(this.gitDir, { recursive: true, force: true });
    await atomic(path.join(this.store.root, 'git-usage.json'), { bytes: 0, materialBytes: 0, estimate: true, measuredAt: Date.now() });
  }
  async measure(cleanup = false) {
    const output = await this.run(['count-objects', '-v'], { cleanup });
    const metrics = Object.fromEntries(output.trim().split('\n').map(line => line.split(':').map(v => v.trim())));
    const gitObjectEstimateBytes = (Number(metrics.size || 0) + Number(metrics['size-pack'] || 0)) * 1024;
    const bytes = await treeBytes(this.gitDir);
    let materialBytes = 0;
    for (const name of await fs.readdir(path.join(this.store.root, 'leases'))) {
      const value = await this.store.lease(name.replace(/\.json$/, ''));
      if (value?.destination) materialBytes += await treeBytes(value.destination);
    }
    const value = { bytes, materialBytes, estimate: false, precision: 'logical-file-size', gitObjectEstimateBytes, measuredAt: Date.now() };
    await atomic(path.join(this.store.root, 'git-usage.json'), value);
    return value;
  }
  async materialize(destination) {
    const resolved = path.resolve(destination);
    await contained(this.options.materialRoot || path.join(STATE_DIR, 'technical-review'), resolved);
    check(path.basename(resolved).startsWith('review-'), 'Material de revisão fora do formato esperado.');
    const stat = await fs.lstat(resolved);
    check(stat.isDirectory() && !stat.isSymbolicLink() && (await fs.readdir(resolved)).length === 0, 'Material de revisão deve ser diretório vazio sem links.');
    await this.store.attach(this.leaseId, resolved);
    await this.prepare();
    return this.store.transaction(async () => {
      const entries = await this.run(['ls-tree', '-r', '-l', this.target.head]);
      check(!/^(?:120000|160000) /m.test(entries), 'Links ou submódulos exigem materialização adicional isolada.');
      const materialBytes = entries.split('\n').reduce((total, row) => total + Number(/^\d+ \w+ [a-f0-9]+\s+(\d+)\t/.exec(row)?.[1] || 0), 0);
      const cabe = async () => (await this.store.usage()).bytes + materialBytes <= this.store.limits.maxBytes;
      if (!await cabe()) await this.compactar();
      check(await cabe(), 'Materialização adiada pelo limite do cache.');
      await this.store.withBudget('git-materialization', materialBytes + this.store.limits.acquisitionReserveBytes,
        this.options.signal, signal => this.checkout(resolved, signal));
      return resolved;
    }, this.options.signal);
  }
  async checkout(resolved, signal) {
    await this.run(['worktree', 'add', '--detach', resolved, this.target.head], { signal });
    await this.run(['worktree', 'lock', resolved], { signal });
    await this.store.recordMaterial(this.leaseId, await treeBytes(resolved));
    await this.measure(true);
  }
  async release(destination) {
    await this.store.assertConfirmed(this.leaseId);
    return this.store.transaction(async () => {
      if (destination) check(await this.store.assertMaterialRemoved(this.leaseId, destination), 'Material sem consumidor verificável; refs preservadas.');
      try { await fs.access(path.join(this.gitDir, 'HEAD')); }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      if (destination) await this.removeWorktreeRegistration(destination);
      for (const side of ['head', 'base', 'mergeBase']) await this.run(['update-ref', '-d', this.ref(side)], { cleanup: true });
      await this.measure(true);
    });
  }
  async removeWorktreeRegistration(destination) {
    const worktrees = await this.run(['worktree', 'list', '--porcelain', '-z'], { cleanup: true });
    const canonical = await canonicalWorktreePath(destination);
    for (const block of worktrees.split('\0\0')) {
      const fields = block.split('\0'), entry = fields.find(line => line.startsWith('worktree '));
      if (!entry) continue;
      const registered = entry.slice(9);
      if (await canonicalWorktreePath(registered) !== canonical) continue;
      await this.removeRegisteredWorktree(registered, fields.some(field => field === 'locked' || field.startsWith('locked ')));
      return;
    }
  }
  async removeRegisteredWorktree(registered, locked) {
    if (locked) await this.run(['worktree', 'unlock', registered], { cleanup: true });
    await this.run(['worktree', 'remove', '--force', registered], { cleanup: true });
  }
}
async function canonicalWorktreePath(destination) {
  let current = path.resolve(destination);
  const missing = [];
  for (;;) {
    try { return path.join(await fs.realpath(current), ...missing); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.unshift(path.basename(current)); current = parent;
    }
  }
}
function uncertainTermination(result, signal) {
  if (result.ok) return false;
  if (signal?.aborted || result.code === null || result.code === undefined) return true;
  return ['ABORT_ERR', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'].includes(result.code);
}
export { GitSource, RECENTES_POR_LADO };
