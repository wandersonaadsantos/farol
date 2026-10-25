// Registro pequeno de posse, separado da árvore Git e das evidências duráveis.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import io from '../io.js';
import { processProbe } from './material-process.js';
import { privateChild, siblingFile } from './material-paths.js';

const instance = randomUUID();
const STATES = new Set(['preparing', 'in-use', 'released', 'removal-pending', 'removed']);
const ID = /^[a-zA-Z0-9-]{1,100}$/;
const known = new Map();
let birth;
function metadata(value = {}) {
  const safe = {};
  for (const key of ['repo', 'prKey', 'account', 'head', 'base', 'mergeBase', 'sessionId']) {
    if (typeof value[key] === 'string' && /^[\w./#:-]{1,240}$/.test(value[key])) safe[key] = value[key];
  }
  return safe;
}
function recordFile(target) { return siblingFile(target, '-material.json'); }
function leaseDir(target) { return target + '-consumers'; }
function readRecord(target) {
  let data;
  try {
    const file = recordFile(target);
    if (fs.statSync(file).size > 65536) return null;
    data = io.parseJson(fs.readFileSync(file, 'utf8'));
  }
  catch { return null; }
  if (data?.schema !== 1 || data.id !== path.basename(target) || !STATES.has(data.state)
    || typeof data.owner?.instance !== 'string' || !data.owner.instance || !Number.isInteger(data.owner.pid) || data.owner.pid <= 0
    || (data.owner.birth !== null && (typeof data.owner.birth !== 'string' || data.owner.birth.length > 200))
    || !Array.isArray(data.consumers) || data.consumers.length > 128
    || new Set(data.consumers).size !== data.consumers.length || !data.consumers.every(c => typeof c === 'string' && ID.test(c))) return null;
  return data;
}
function writeRecord(target, record) {
  siblingFile(target, '-material.json.tmp');
  io.writeJsonAtomic(recordFile(target), record);
  if (record.state === 'removed') known.delete(target);
  else known.set(target, record);
}
function updateRecord(target, change) {
  const record = readRecord(target);
  if (!record) throw new Error('material sem registro íntegro');
  const next = change(record);
  writeRecord(target, next);
  return next;
}
function createRecord(target, value) {
  const sessionId = typeof value?.sessionId === 'string' && ID.test(value.sessionId) ? value.sessionId : randomUUID();
  const record = { schema: 1, id: path.basename(target), state: 'preparing', createdAt: Date.now(),
    owner: { instance, pid: process.pid, birth: null, sessionId }, context: metadata(value), consumers: ['session'], attempts: 0 };
  writeRecord(target, record);
  return record;
}
async function prepareRecord(target, value) {
  if (!birth) birth = processProbe.read(process.pid);
  const identity = await birth;
  if (identity.status !== 'found') birth = null;
  return updateRecord(target, record => ({ ...record, owner: { ...record.owner, birth: identity.birth || null }, context: { ...record.context, ...metadata(value) } }));
}
function retain(target, id = randomUUID()) {
  if (!ID.test(id)) throw new Error('consumidor inválido');
  const record = readRecord(target);
  if (!record || record.owner.instance !== instance || !['preparing', 'in-use'].includes(record.state)) throw new Error('material não aceita consumidores');
  if (record.consumers.includes(id)) return id;
  updateRecord(target, r => ({ ...r, consumers: [...r.consumers, id] }));
  return id;
}
function release(target, id = 'session') {
  return updateRecord(target, record => {
    if (record.owner.instance !== instance) throw new Error('material de outra instância');
    const consumers = record.consumers.filter(c => c !== id);
    return { ...record, consumers, state: consumers.length ? record.state : 'released', releasedAt: Date.now() };
  });
}
function ready(target) { return updateRecord(target, r => ({ ...r, state: 'in-use' })); }
function consumerPath(target, id) {
  if (!ID.test(id)) throw new Error('consumidor inválido');
  const root = leaseDir(target);
  if (fs.existsSync(root)) privateChild(root, path.dirname(root), 'review-');
  return siblingFile(path.join(root, id), '.json');
}
function launchConsumer(target, id) {
  retain(target, id);
  fs.mkdirSync(leaseDir(target), { recursive: true });
  const file = consumerPath(target, id);
  siblingFile(file, '.tmp');
  io.writeJsonAtomic(file, { schema: 1, id, pending: true });
}
async function bindConsumer(target, id) {
  const file = consumerPath(target, id), record = readRecord(target);
  if (!record?.consumers.includes(id) || !fs.existsSync(file)) throw new Error('consumidor sem reserva');
  const identity = await processProbe.read(process.pid);
  siblingFile(file, '.tmp');
  io.writeJsonAtomic(file, { schema: 1, id, pending: false, pid: process.pid, birth: identity.birth || null });
}
function finishBoundConsumer(target, id) {
  const file = consumerPath(target, id);
  const previous = io.parseJson(fs.readFileSync(file, 'utf8'));
  if (previous?.pid !== process.pid || previous.id !== id) throw new Error('consumidor de outro processo');
  siblingFile(file, '.tmp');
  io.writeJsonAtomic(file, { ...previous, ended: true });
}
function releaseConsumer(target, id) {
  const file = consumerPath(target, id);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return release(target, id);
}
function consumerRecords(target, record) {
  return record.consumers.filter(id => id !== 'session').map(id => {
    try {
      const file = consumerPath(target, id);
      if (fs.statSync(file).size > 4096) return null;
      const data = io.parseJson(fs.readFileSync(file, 'utf8'));
      if (data?.schema !== 1 || data.id !== id || typeof data.pending !== 'boolean') return null;
      if (!data.pending && (!Number.isInteger(data.pid) || data.pid <= 0
        || (data.birth !== null && (typeof data.birth !== 'string' || data.birth.length > 200)))) return null;
      return data;
    }
    catch { return null; }
  });
}

export { instance, known, recordFile, leaseDir, readRecord, writeRecord, updateRecord, createRecord,
  prepareRecord, retain, release, ready, launchConsumer, bindConsumer, finishBoundConsumer, releaseConsumer, consumerRecords };
