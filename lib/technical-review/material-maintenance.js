// Coleta limitada e assíncrona. Liberação explícita ou provas de término precedem o descarte.
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import { privateChild, siblingFile } from './material-paths.js';
import { instance, readRecord, updateRecord, leaseDir, consumerRecords } from './material-record.js';
import { processState } from './material-process.js';

const POLICY = { intervalMs: 30000, retryBaseMs: 1000, retryMaxMs: 300000, queueLimit: 128, batchSize: 2, scanLimit: 16 };
const remocao = { rm: (target, options) => fs.promises.rm(target, options) };
const pendentes = new Set();
const roots = new Map();
const callbacks = new Map();
function tecnicaRoot() { return path.join(STATE_DIR, 'technical-review'); }
function manager(root = tecnicaRoot()) {
  const key = path.resolve(root);
  if (!roots.has(key)) roots.set(key, { root: key, queue: new Map(), active: null, cursor: 0, referenceState: () => 'unknown' });
  return roots.get(key);
}
function enqueue(target) {
  const m = manager(path.dirname(target)), record = readRecord(target);
  if (!record || !['released', 'removal-pending'].includes(record.state) || record.consumers.length) return false;
  if (m.queue.size >= POLICY.queueLimit && !m.queue.has(target)) return false;
  m.queue.set(target, record.retryAt || 0); pendentes.add(target);
  return true;
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
async function recoverReleased(m, target, record) {
  if (['released', 'removal-pending'].includes(record.state)) return enqueue(target);
  if (record.state === 'removed' || record.owner.instance === instance) return false;
  if (await m.referenceState(record, target) !== 'ended') return false;
  const owner = await processState(record.owner);
  if (!['ended', 'reused'].includes(owner) || !(await endedConsumers(target, record))) return false;
  updateRecord(target, r => ({ ...r, state: 'released', consumers: [], recoveredAt: Date.now() }));
  return enqueue(target);
}
async function discover(m) {
  let files;
  try { files = (await fs.promises.readdir(m.root)).filter(name => /^review-[\w-]+-material\.json$/.test(name)); }
  catch { return; } // Raiz ainda não criada não é falha de coleta.
  for (let i = 0; i < Math.min(files.length, POLICY.scanLimit); i++) {
    const name = files[m.cursor % files.length]; m.cursor++;
    const target = path.join(m.root, name.slice(0, -'-material.json'.length));
    const record = readRecord(target);
    if (record) await recoverReleased(m, target, record);
  }
}
async function removeOne(m, target) {
  const record = readRecord(target);
  if (!record || record.consumers.length || !['released', 'removal-pending'].includes(record.state)) {
    m.queue.delete(target); pendentes.delete(target); return;
  }
  try {
    privateChild(target, m.root, 'review-');
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
  await discover(m);
  const targets = [...m.queue].filter(([, at]) => at <= now).slice(0, POLICY.batchSize);
  for (const [target] of targets) await removeOne(m, target);
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
  if (m.timer) return () => pararManutencaoMaterial(m.root);
  m.timer = setInterval(() => { maintainMaterials({ root: m.root }).catch(error => { m.lastFailure = error.code || 'MAINTENANCE_FAILED'; }); }, options.intervalMs || POLICY.intervalMs);
  m.timer.unref();
  maintainMaterials({ root: m.root }).catch(error => { m.lastFailure = error.code || 'MAINTENANCE_FAILED'; });
  return () => pararManutencaoMaterial(m.root);
}
function pararManutencaoMaterial(root) { const m = manager(root); clearInterval(m.timer); m.timer = null; }
function afterRemoval(target, callback) { callbacks.set(target, callback); }
async function diagnosticoLegados(options = {}) {
  const root = options.root || tecnicaRoot();
  const referenced = new Set((options.references || []).map(p => path.resolve(p)));
  let files;
  try { files = await fs.promises.readdir(root, { withFileTypes: true }); }
  catch { return { legacy: 0, referenced: 0, pending: 0, items: [] }; }
  const items = files.filter(f => f.isDirectory() && /^review-[a-zA-Z0-9]+$/.test(f.name)).flatMap(f => {
    const target = path.join(root, f.name);
    if (readRecord(target)) return [];
    return [{ id: f.name, state: referenced.has(target) ? 'referenced' : 'unverified', eligible: false }];
  });
  return { legacy: items.length, referenced: items.filter(i => i.state === 'referenced').length,
    pending: items.filter(i => i.state === 'unverified').length, items };
}

export { tecnicaRoot, manager, enqueue, maintainMaterials, iniciarManutencaoMaterial, pararManutencaoMaterial,
  afterRemoval, diagnosticoLegados, remocao, pendentes, POLICY };
