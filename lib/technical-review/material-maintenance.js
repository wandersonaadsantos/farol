// Coleta limitada e assíncrona. Liberação explícita ou provas de término precedem o descarte.
import fs from 'node:fs';
import path from 'node:path';
import io from '../io.js';
import { STATE_DIR, HOME } from '../paths.js';
import { privateChild, siblingFile } from './material-paths.js';
import { instance, known, readRecord, updateRecord, leaseDir, consumerRecords } from './material-record.js';
import { processState } from './material-process.js';
import { read, contained } from '../review-source/files.js';
import { ownerState } from '../review-source/process-owner.js';
import { recoveryProcesses } from '../review-source/recovery-owner.js';
import { semGitPosterior } from '../review-source/recovery-orphans.js';
import { lockLog } from '../review-source/lock-file.js';

// Legado: 237 pastas `review-*` de 18 a 26/10/2026, anteriores ao registro, ficaram para sempre
// (medido em 06/11/2026: 252 checkouts e ~850 mil arquivos na raiz, 6 a 31 s por inventário da
// quota). Sete dias pela modificação da pasta, mais nenhuma lease citando o caminho, provam o
// abandono; a varredura das leases de todos os escopos roda no máximo a cada 10 minutos.
const HORA_MS = 3600 * 1000;
const POLICY = { intervalMs: 30000, retryBaseMs: 1000, retryMaxMs: 300000, queueLimit: 128, batchSize: 2, scanLimit: 16,
  legacyMinAgeMs: 7 * 24 * HORA_MS, legacyIntervalMs: HORA_MS / 6, legacyLedgerLimit: 500 };
const LEGACY = /^review-[a-zA-Z0-9]+$/;
const remocao = { rm: (target, options) => fs.promises.rm(target, options) };
const pendentes = new Set();
const roots = new Map();
const callbacks = new Map();
function tecnicaRoot() { return path.join(STATE_DIR, 'technical-review'); }
function manager(root = tecnicaRoot()) {
  const key = path.resolve(root);
  if (!roots.has(key)) {
    roots.set(key, { root: key, queue: new Map(), active: null, cursor: 0, referenceState: () => 'unknown',
      removed: new Set(), legacy: new Map(), legacyAt: 0, sourceCache: path.join(HOME, 'source-cache'), log: null });
  }
  return roots.get(key);
}
function avisar(m, text) {
  try { (m.log || lockLog.write)?.('WARN', text); }
  catch { /* log nunca derruba a manutenção */ }
}
function enqueue(target) {
  const m = manager(path.dirname(target)), record = readRecord(target);
  if (record?.sourceTerminationUnconfirmed || record?.sourceProcessPending) { pendentes.add(target); return false; }
  if (!record || !['released', 'removal-pending'].includes(record.state) || record.consumers.length) return false;
  if (m.queue.size >= POLICY.queueLimit && !m.queue.has(target)) return false;
  m.queue.set(target, record.retryAt || 0); pendentes.add(target);
  return true;
}
// Caminhos de material citados por qualquer lease de qualquer escopo do cache, com o estado do Git.
// `null` quando algum escopo ou lease não pôde ser lido: sem a lista inteira não há prova de que
// ninguém referencia o material. Chave em minúsculas: no Windows o mesmo caminho muda de caixa, e
// casar a mais só preserva.
function citar(refs, lease) {
  const key = path.resolve(lease.destination).toLowerCase(), before = refs.get(key) || {};
  refs.set(key, { gitProcessPending: !!(before.gitProcessPending || lease.gitProcessPending),
    terminationUnconfirmed: !!(before.terminationUnconfirmed || lease.terminationUnconfirmed) });
}
// Lança quando o escopo não pode ser lido inteiro; pasta `leases` ausente é escopo sem lease.
async function leasesDoEscopo(base, name, refs) {
  const dir = path.join(base, name, 'leases');
  await contained(base, dir);
  let files;
  try { files = await fs.promises.readdir(dir); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const file of files.filter(f => f.endsWith('.json'))) {
    const lease = await read(path.join(dir, file));
    if (!lease) continue; // saiu entre o readdir e a leitura
    if (lease.schema !== 1) throw new Error('lease fora do esquema');
    if (typeof lease.destination === 'string') citar(refs, lease);
  }
}
async function leaseReferences(base) {
  const refs = new Map();
  let scopes;
  try { scopes = await fs.promises.readdir(base); }
  catch (error) { return error.code === 'ENOENT' ? refs : null; }
  try {
    for (const name of scopes.filter(n => /^[a-f0-9]{64}$/.test(n))) await leasesDoEscopo(base, name, refs);
  } catch { return null; }
  return refs;
}
// Uma consulta de leases e uma lista de Git por ciclo, e só quando há candidato.
function cicloNovo(m) {
  let git, refs;
  return { git: () => (git ??= recoveryProcesses.list()), refs: () => (refs ??= leaseReferences(m.sourceCache)) };
}
async function endedConsumers(target, record) {
  const children = consumerRecords(target, record);
  for (const child of children) {
    if (!child || child.pending) return false;
    if (child.ended === true) continue;
    const status = await processState(child);
    if (!['ended', 'reused'].includes(status)) return false;
  }
  return true;
}
// O dono do registro acabou? Mesma régua da lease na v2.78.10 (recovery-orphans.js): com a data
// de criação gravada, PID ausente ou reaproveitado; sem ela, só o PID ausente. O mesmo PID deste
// processo com outra instância é um Farol anterior (a instância deste já foi descartada antes).
async function donoEncerrado(record) {
  if (record.owner.birth) {
    const state = await processState(record.owner);
    return state === 'reused' ? 'ended' : state;
  }
  return ownerState({ pid: record.owner.pid });
}
// Prova de dono morto para material sem decisão final (06/11/2026: 14 registros `in-use` e
// `preparing` de 27/10 a 05/11 e um `sourceProcessPending` eterno desde 27/10, todos de Farol já
// encerrado). O instante protegido é a criação do registro, anterior a todo Git da preparação,
// então qualquer Git vivo nascido a partir dele (com a folga de 2 s) bloqueia, como na lease. É
// conservador e solta quando esses Git terminam. Lease que ainda cita o material com Git
// pendente ou término não confirmado fica com a recuperação do cache, que tem a prova dela.
async function provaDeDonoMorto(ciclo, target, record) {
  if (record.owner.instance === instance || !Number.isSafeInteger(record.createdAt)) return null;
  if (await donoEncerrado(record) !== 'ended') return null;
  const refs = await ciclo.refs(), ref = refs?.get(path.resolve(target).toLowerCase());
  if (!refs || ref?.gitProcessPending || ref?.terminationUnconfirmed) return null;
  if (!semGitPosterior(await ciclo.git(), record.createdAt)) return null;
  return { at: Date.now(), proof: 'owner-ended-without-git', ownerPid: record.owner.pid, protectedAt: record.createdAt };
}
// Grava a evidência só se o registro ainda é o julgado (mesmo dono e mesmo estado).
function marcarRecuperado(target, record, evidence, change) {
  let applied = false;
  updateRecord(target, r => {
    if (r.owner.instance !== record.owner.instance || r.owner.pid !== record.owner.pid || r.state !== record.state) return r;
    applied = true;
    return { ...change(r), recovered: evidence };
  });
  return applied;
}
async function recoverReleased(m, target, record, ciclo) {
  if (record.sourceTerminationUnconfirmed) { pendentes.add(target); return false; }
  if (record.sourceProcessPending) {
    const evidence = await provaDeDonoMorto(ciclo, target, record);
    if (!evidence || !marcarRecuperado(target, record, evidence, r => ({ ...r, sourceProcessPending: false }))) { pendentes.add(target); return false; }
    avisar(m, `Material técnico ${record.id}: Git pendente de dono encerrado (PID ${record.owner.pid}) liberado, sem Git posterior vivo.`);
    record = readRecord(target);
    if (!record) return false;
  }
  if (['released', 'removal-pending'].includes(record.state)) return enqueue(target);
  if (record.state === 'removed' || record.owner.instance === instance) return false;
  const reference = await m.referenceState(record, target);
  if (reference === 'ended') {
    const owner = await donoEncerrado(record);
    if (owner !== 'ended' || !(await endedConsumers(target, record))) return false;
    updateRecord(target, r => ({ ...r, state: 'released', consumers: [], recoveredAt: Date.now() }));
    return enqueue(target);
  }
  // Sem decisão final e sem referência viva no engine, só a prova do SO libera.
  if (reference !== 'unknown' || !(await endedConsumers(target, record))) return false;
  const evidence = await provaDeDonoMorto(ciclo, target, record);
  if (!evidence || !marcarRecuperado(target, record, evidence, r => ({ ...r, state: 'released', consumers: [] }))) return false;
  avisar(m, `Material técnico ${record.id}: ${record.state} de dono encerrado (PID ${record.owner.pid}) liberado para remoção, sem Git posterior vivo.`);
  return enqueue(target);
}
// Lápides (`removed`) ficam fora do rodízio: em 06/11/2026 eram 1.082 dos 1.097 registros, e um
// material liberado esperava até ~34 min para ser visto. Registro deste processo volta pelo `known`.
async function discover(m, ciclo) {
  let files;
  try { files = (await fs.promises.readdir(m.root)).filter(name => /^review-[\w-]+-material\.json$/.test(name)); }
  catch { return; } // Raiz ainda não criada não é falha de coleta.
  const present = new Set(files);
  for (const name of m.removed) if (!present.has(name)) m.removed.delete(name);
  const live = files.filter(name => !m.removed.has(name) || known.has(path.join(m.root, name.slice(0, -'-material.json'.length))));
  for (let i = 0; i < Math.min(live.length, POLICY.scanLimit); i++) {
    const name = live[m.cursor % live.length]; m.cursor++;
    const target = path.join(m.root, name.slice(0, -'-material.json'.length));
    const record = readRecord(target);
    if (record?.state === 'removed') { m.removed.add(name); continue; }
    if (record) await recoverReleased(m, target, record, ciclo);
  }
}
// Pasta legada candidata: sem registro (nem ilegível), sem consumidores, e modificada antes do corte.
// Devolve a data de modificação, ou null quando não é candidata.
function legadoAntigo(target, now) {
  try {
    if (fs.existsSync(target + '-material.json') || fs.existsSync(leaseDir(target))) return null;
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink() || now - stat.mtimeMs < POLICY.legacyMinAgeMs) return null;
    return stat.mtimeMs;
  } catch { return null; }
}
async function discoverLegacy(m, ciclo) {
  const now = Date.now();
  if (now - m.legacyAt < POLICY.legacyIntervalMs) return;
  m.legacyAt = now;
  let entries;
  try { entries = await fs.promises.readdir(m.root, { withFileTypes: true }); }
  catch { return; }
  const candidates = entries.filter(e => e.isDirectory() && LEGACY.test(e.name)).map(e => path.join(m.root, e.name))
    .filter(target => !m.queue.has(target) && legadoAntigo(target, now) !== null);
  if (!candidates.length) return;
  const refs = await ciclo.refs();
  if (!refs) return;
  for (const target of candidates) {
    if (refs.has(path.resolve(target).toLowerCase())) continue;
    if (m.queue.size >= POLICY.queueLimit) break;
    m.legacy.set(target, { attempts: 0 }); m.queue.set(target, 0);
  }
}
function registrarLegado(m, entry) {
  const file = path.join(m.root, 'legacy-removals.json');
  let items = [];
  try { items = io.parseJson(fs.readFileSync(file, 'utf8'))?.items || []; }
  catch { /* ledger ausente ou ilegível recomeça; a evidência também vai ao log */ }
  io.writeJsonAtomic(file, { schema: 1, items: [...items, entry].slice(-POLICY.legacyLedgerLimit) });
}
// Confere tudo de novo antes de apagar: registro, idade e leases podem ter mudado desde a descoberta.
async function removeLegacy(m, target, ciclo) {
  const state = m.legacy.get(target), now = Date.now();
  const modifiedAt = legadoAntigo(target, now), refs = modifiedAt === null ? null : await ciclo.refs();
  if (modifiedAt === null || !refs || refs.has(path.resolve(target).toLowerCase())) {
    m.queue.delete(target); m.legacy.delete(target); return;
  }
  try {
    privateChild(target, m.root, 'review-');
    const request = siblingFile(target, '-request.json');
    await remocao.rm(target, { recursive: true, force: true });
    await remocao.rm(request, { force: true });
    const evidence = { id: path.basename(target), at: Date.now(), proof: 'legacy-unreferenced', modifiedAt: Math.round(modifiedAt) };
    try { registrarLegado(m, evidence); } catch { /* sem espaço para o ledger, o log ainda registra */ }
    avisar(m, `Material técnico legado ${evidence.id} removido: sem registro, modificado em ${new Date(modifiedAt).toISOString()} e sem lease que o cite.`);
    m.queue.delete(target); m.legacy.delete(target);
  } catch {
    state.attempts++;
    m.queue.set(target, Date.now() + Math.min(POLICY.retryMaxMs, POLICY.retryBaseMs * (2 ** Math.min(state.attempts, 8))));
  }
}
async function removeOne(m, target, ciclo) {
  if (m.legacy.has(target)) return removeLegacy(m, target, ciclo);
  const record = readRecord(target);
  if (record?.sourceTerminationUnconfirmed || record?.sourceProcessPending) { m.queue.delete(target); pendentes.add(target); return; }
  if (!record || record.consumers.length || !['released', 'removal-pending'].includes(record.state)) {
    m.queue.delete(target); pendentes.delete(target); return;
  }
  try {
    privateChild(target, m.root, 'review-');
    if (record.sourceReference) {
      const { assertMaterialRemovalAllowed } = await import('../review-source/index.js');
      await assertMaterialRemovalAllowed(record.sourceReference);
    }
    updateRecord(target, r => ({ ...r, state: 'removal-pending' }));
    await remocao.rm(target, { recursive: true, force: true });
    const request = siblingFile(target, '-request.json');
    await remocao.rm(request, { force: true });
    const leases = leaseDir(target);
    privateChild(leases, m.root, 'review-');
    await remocao.rm(leases, { recursive: true, force: true });
    if (callbacks.has(target)) await callbacks.get(target)();
    else if (record.sourceReference) {
      const { releaseMaterialReference } = await import('../review-source/index.js');
      await releaseMaterialReference(record.sourceReference, target);
    }
    callbacks.delete(target);
    updateRecord(target, r => ({ ...r, state: 'removed', removedAt: Date.now(), lastFailure: null, retryAt: 0 }));
    m.removed.add(path.basename(target) + '-material.json');
    m.queue.delete(target); pendentes.delete(target);
  } catch (error) {
    const attempts = record.attempts + 1;
    const retryAt = Date.now() + Math.min(POLICY.retryMaxMs, POLICY.retryBaseMs * (2 ** Math.min(attempts, 8)));
    updateRecord(target, r => ({ ...r, state: 'removal-pending', attempts, retryAt,
      lastFailure: { at: Date.now(), code: String(error.code || 'CLEANUP_FAILED').slice(0, 50) } }));
    m.queue.set(target, retryAt);
  }
}
async function drain(m, now) {
  const ciclo = cicloNovo(m);
  await discover(m, ciclo);
  await discoverLegacy(m, ciclo);
  const targets = [...m.queue].filter(([, at]) => at <= now).slice(0, POLICY.batchSize);
  for (const [target] of targets) await removeOne(m, target, ciclo);
  return targets.length;
}
function maintainMaterials(options = {}) {
  const m = manager(options.root);
  if (m.active) return m.active;
  m.active = drain(m, options.now || Date.now()).finally(() => { m.active = null; });
  return m.active;
}
function iniciarManutencaoMaterial(options = {}) {
  const m = manager(options.root);
  if (options.referenceState) m.referenceState = options.referenceState;
  if (options.log) m.log = options.log;
  if (options.sourceCache) m.sourceCache = path.resolve(options.sourceCache);
  if (m.timer) return () => pararManutencaoMaterial(m.root);
  m.timer = setInterval(() => { maintainMaterials({ root: m.root }).catch(error => { m.lastFailure = error.code || 'MAINTENANCE_FAILED'; }); }, options.intervalMs || POLICY.intervalMs);
  m.timer.unref();
  maintainMaterials({ root: m.root }).catch(error => { m.lastFailure = error.code || 'MAINTENANCE_FAILED'; });
  return () => pararManutencaoMaterial(m.root);
}
function pararManutencaoMaterial(root) { const m = manager(root); clearInterval(m.timer); m.timer = null; }
function afterRemoval(target, callback) { callbacks.set(target, callback); }
// Estados: `referenced` (lease ou referência informada), `recent` (modificado há menos de 7 dias),
// `eligible` (sai pela fila da manutenção) e `unverified` (leases ilegíveis: sem prova, fica).
async function diagnosticoLegados(options = {}) {
  const root = options.root || tecnicaRoot();
  const referenced = new Set((options.references || []).map(p => path.resolve(p).toLowerCase()));
  let files;
  try { files = await fs.promises.readdir(root, { withFileTypes: true }); }
  catch { return { legacy: 0, referenced: 0, pending: 0, eligible: 0, items: [] }; }
  const refs = await leaseReferences(options.sourceCache || manager(root).sourceCache), now = Date.now();
  const items = files.filter(f => f.isDirectory() && LEGACY.test(f.name)).flatMap(f => {
    const target = path.join(root, f.name), key = path.resolve(target).toLowerCase();
    if (fs.existsSync(target + '-material.json')) return [];
    let state;
    if (referenced.has(key) || refs?.has(key)) state = 'referenced';
    else if (!refs) state = 'unverified';
    else state = legadoAntigo(target, now) === null ? 'recent' : 'eligible';
    return [{ id: f.name, state, eligible: state === 'eligible' }];
  });
  return { legacy: items.length, referenced: items.filter(i => i.state === 'referenced').length,
    pending: items.filter(i => i.state === 'recent' || i.state === 'unverified').length,
    eligible: items.filter(i => i.eligible).length, items };
}

export { tecnicaRoot, manager, enqueue, maintainMaterials, iniciarManutencaoMaterial, pararManutencaoMaterial,
  afterRemoval, diagnosticoLegados, remocao, pendentes, POLICY };
