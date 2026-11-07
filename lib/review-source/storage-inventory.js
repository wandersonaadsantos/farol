// Inventário lógico por metadados, sem seguir links nem executar código obtido.
import fs from 'node:fs/promises';
import path from 'node:path';
import { read, contained } from './files.js';
import { INSTANCE } from './instance.js';
const OBSERVATION_TTL_MS = 60000;
const OBSERVATION_WINDOW_MS = 200;
const OBSERVATION_FILES = 10000;
const legacyCache = new Map();
// Material pronto não muda mais: `ready()` só acontece depois do checkout conferido, a remoção marca
// `removal-pending` antes de apagar, e a finalização exige `git status --porcelain` limpo. Medido em
// 06/11/2026: percorrer de novo cada material a cada admissão levava o inventário a 6 s (quente) e 31 s
// (frio) com 857 mil arquivos, segurando a trava global. O tamanho gravado no registro quando ele fica
// pronto vale só nesses dois estados; registro antigo, sem o campo ou em outro estado, segue percorrido.
const MATERIAL_IMUTAVEL = new Set(['in-use', 'released']);

async function treeBytes(root, seen = new Set(), details) {
  let stat;
  try { stat = await fs.lstat(root, { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
  if (stat.isSymbolicLink()) throw new Error('Inventário com link não verificável; aquisição adiada.');
  if (stat.isDirectory()) {
    // A manutenção remove material fora da trava global: pasta que some entre o lstat e o readdir vale 0.
    let names;
    try { names = await fs.readdir(root); }
    catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
    let bytes = 0;
    for (const name of names) bytes += await treeBytes(path.join(root, name), seen, details);
    return bytes;
  }
  if (!stat.isFile()) throw new Error('Inventário com entrada especial não verificável.');
  const key = `${stat.dev}:${stat.ino}`;
  if (stat.ino && seen.has(key)) return 0;
  seen.add(key);
  if (details && (/[\\/](?:tmp[_-]|incoming[_-])/.test(root) || root.endsWith('.tmp'))) details.temporaryBytes += Number(stat.size);
  return Number(stat.size);
}
function recordedBytes(record, target) {
  if (record?.schema !== 1 || record.id !== path.basename(target) || !MATERIAL_IMUTAVEL.has(record.state)) return null;
  return Number.isSafeInteger(record.bytes) && record.bytes >= 0 ? record.bytes : null;
}
async function materialBytes(target, record, seen) {
  const recorded = recordedBytes(record, target);
  return recorded === null ? treeBytes(target, seen) : recorded;
}
async function materials(root, seen, destinations) {
  const result = { activeMaterialBytes: 0, pendingMaterialBytes: 0 };
  const leaseRoot = path.join(root, 'leases');
  let names;
  try { names = await fs.readdir(leaseRoot); }
  catch (error) { if (error.code === 'ENOENT') return result; throw error; }
  for (const name of names) {
    const lease = await read(path.join(leaseRoot, name));
    if (lease?.gitProcessPending) result.pendingGitProcess = true;
    // Git pendente de outro processo: o monitor que estenderia a reserva pode ter morrido junto.
    if (lease?.gitProcessPending && !(lease.instance === INSTANCE && lease.pid === process.pid)) result.foreignGitProcess = true;
    if (!lease?.destination) continue;
    destinations.add(path.resolve(lease.destination));
    const record = await read(lease.destination + '-material.json');
    const bytes = await materialBytes(lease.destination, record, seen);
    const pending = lease.state === 'released' || ['released', 'removal-pending'].includes(record?.state);
    const key = pending ? 'pendingMaterialBytes' : 'activeMaterialBytes';
    result[key] += bytes;
  }
  return result;
}
async function scopeInventory(root, destinations = new Set()) {
  const result = { objectCacheBytes: 0, gitBytes: 0, acquisitionTemporaryBytes: 0, metadataBytes: 0 };
  const seen = new Set();
  for (const name of await fs.readdir(root)) {
    const target = path.join(root, name);
    let key = 'metadataBytes';
    if (name === 'objects') key = 'objectCacheBytes';
    if (name === 'repository.git') key = 'gitBytes';
    if (name.endsWith('.tmp')) key = 'acquisitionTemporaryBytes';
    const details = { temporaryBytes: 0 };
    result[key] += await treeBytes(target, seen, details);
    if (key !== 'acquisitionTemporaryBytes') {
      result[key] -= details.temporaryBytes;
      result.acquisitionTemporaryBytes += details.temporaryBytes;
    }
  }
  Object.assign(result, await materials(root, seen, destinations));
  result.bytes = Object.values(result).reduce((total, bytes) => total + (typeof bytes === 'number' ? bytes : 0), 0);
  result.terminationUnconfirmed = Boolean(await read(path.join(root, 'operation-pending.json')));
  return result;
}
async function observedBytes(root, budget) {
  if (budget.files++ >= OBSERVATION_FILES || Date.now() >= budget.deadline) { budget.complete = false; return 0; }
  // Legado removido pela manutenção (fora da trava global) no meio da observação vale 0, em vez de
  // derrubar o inventário inteiro e deixar presa a reserva de quem o pediu (revisão de 06/11/2026).
  let stat, names;
  try { stat = await fs.lstat(root); }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
  if (stat.isSymbolicLink()) { budget.complete = false; return 0; }
  if (stat.isFile()) return stat.size;
  try { names = await fs.readdir(root); }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
  let bytes = 0;
  for (const name of names) {
    if (!budget.complete) break;
    bytes += await observedBytes(path.join(root, name), budget);
  }
  return bytes;
}
function managedRecord(record, name) {
  if (record?.sourceReference?.schema === 1) return true;
  return record?.schema === 1 && record.id === name && typeof record.owner?.instance === 'string'
    && ['preparing', 'in-use', 'released', 'removal-pending', 'removed'].includes(record.state);
}
async function externalMaterials(root, destinations) {
  const result = { unregisteredManagedBytes: 0, externalManagedMetadataBytes: 0,
    legacy: { bytes: 0, directories: 0, complete: true, removable: false, includedInManagedBytes: false } };
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return result; throw error; }
  const old = legacyCache.get(root), cached = old && Date.now() - old.measuredAt < OBSERVATION_TTL_MS;
  const budget = { files: 0, complete: true, deadline: Date.now() + OBSERVATION_WINDOW_MS };
  const managedNames = new Set([...destinations].filter(target => path.dirname(target) === path.resolve(root)).map(target => path.basename(target)));
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (!entry.isDirectory() || destinations.has(path.resolve(target))) continue;
    const record = await read(target + '-material.json');
    if (managedRecord(record, entry.name)) {
      managedNames.add(entry.name);
      result.unregisteredManagedBytes += await materialBytes(target, record);
    }
    else result.legacy.directories++;
    if (!cached && !managedNames.has(entry.name) && budget.complete) result.legacy.bytes += await observedBytes(target, budget);
  }
  for (const entry of entries) {
    if (![...managedNames].some(name => entry.name.startsWith(name + '-') || entry.name.startsWith(name + '.'))) continue;
    if (!destinations.has(path.resolve(root, entry.name))) result.externalManagedMetadataBytes += await treeBytes(path.join(root, entry.name));
  }
  if (cached) Object.assign(result.legacy, { bytes: old.bytes, complete: old.complete, measuredAt: old.measuredAt });
  else {
    Object.assign(result.legacy, { complete: budget.complete, measuredAt: Date.now() });
    legacyCache.set(root, { ...result.legacy });
  }
  if (cached && old.directories !== result.legacy.directories) result.legacy.complete = false;
  result.legacy.precision = result.legacy.complete ? 'observed-logical-size' : 'bounded-lower-bound';
  return result;
}
async function storageInventory(base, materialRoot) {
  const scopes = {};
  const destinations = new Set();
  let controlBytes = 0, unclassifiedBytes = 0;
  for (const name of await fs.readdir(base)) {
    const target = path.join(base, name);
    await contained(base, target);
    if (/^[a-f0-9]{64}$/.test(name)) scopes[name] = await scopeInventory(target, destinations);
    else if (name === 'storage-budget.json' || name.startsWith('storage-budget.lock') || name.startsWith('storage-budget.json.')) controlBytes += await treeBytes(target);
    else unclassifiedBytes += await treeBytes(target);
  }
  const external = materialRoot ? await externalMaterials(materialRoot, destinations) : { unregisteredManagedBytes: 0, externalManagedMetadataBytes: 0, legacy: null };
  const managedBytes = Object.values(scopes).reduce((total, scope) => total + scope.bytes,
    controlBytes + unclassifiedBytes + external.unregisteredManagedBytes + external.externalManagedMetadataBytes);
  return { scopes, managedBytes, controlBytes, unclassifiedBytes, ...external, precision: 'logical-file-size-deduplicated-within-scope',
    exclusions: ['directory-allocation', 'filesystem-compression-and-sparse-allocation', 'unregistered-external-materials', 'in-memory-syntax-index'] };
}
export { treeBytes, recordedBytes, scopeInventory, storageInventory };
