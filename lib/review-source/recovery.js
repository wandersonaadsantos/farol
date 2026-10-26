// Reconcilia aquisições interrompidas, sem apagar objetos, refs ou materiais.
import fs from 'node:fs/promises';
import path from 'node:path';
import { read, atomic, contained } from './files.js';
import { digest } from './contract.js';
import { readRecord, updateRecord } from '../technical-review/material-record.js';
import { recoveryBoot } from './recovery-boot.js';

async function candidate(base, root, materialRoot, bootAt) {
  const pending = await read(path.join(root, 'operation-pending.json'));
  if (pending?.schema !== 1 || !/^[a-f0-9-]{36}$/.test(pending.lease || '')) return null;
  const leaseFile = path.join(root, 'leases', pending.lease + '.json');
  await contained(base, leaseFile);
  const lease = await read(leaseFile);
  if (lease?.schema !== 1 || lease.id !== pending.lease || !Number.isInteger(lease.pid) || lease.pid <= 0
    || !lease.destination || (!lease.terminationUnconfirmed && !lease.recovered)) return null;
  if (!Number.isSafeInteger(lease.createdAt) || !Number.isSafeInteger(pending.at)
    || lease.createdAt > pending.at || pending.at >= bootAt) return null;
  for (const name of await fs.readdir(path.join(root, 'leases'))) {
    const other = await read(path.join(root, 'leases', name));
    if (!other || (other.id !== lease.id && (other.gitProcessPending || other.terminationUnconfirmed))) return null;
  }
  const destination = path.resolve(lease.destination);
  if (path.dirname(destination) !== path.resolve(materialRoot) || !/^review-[\w-]+$/.test(path.basename(destination))) return null;
  await contained(materialRoot, destination);
  const record = readRecord(destination), scope = record?.sourceReference?.scope;
  if (!record || !['released', 'removal-pending'].includes(record.state) || record.consumers.length
    || !Number.isSafeInteger(record.createdAt) || record.createdAt > pending.at
    || record.owner.pid !== lease.pid || record.sourceReference?.leaseId !== lease.id || !scope
    || digest([scope.host, scope.account, scope.repositoryId, scope.repo]) !== path.basename(root)) return null;
  return { pending, lease, leaseFile, destination };
}
async function recoverScope(base, root, materialRoot, state, bootAt) {
  const lockFile = path.join(root, 'writer.lock');
  await contained(base, lockFile);
  let lock;
  try { lock = await fs.open(lockFile, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') return false; throw error; }
  try {
    const value = await candidate(base, root, materialRoot, bootAt);
    if (!value) return false;
    const reservations = Object.entries(state.reservations).filter(([, r]) => r.scope === path.basename(root) && r.terminationUnconfirmed);
    if (reservations.some(([, r]) => !Number.isSafeInteger(r.createdAt) || r.createdAt > value.pending.at)) return false;
    const at = Date.now(), evidence = { at, bootAt, ownerPid: value.lease.pid, proof: 'previous-system-boot' };
    // O marcador do escopo é removido por último. Se uma escrita falhar, ele
    // continua impedindo admissões até a reconciliação inteira ser repetida.
    await atomic(value.leaseFile, { ...value.lease, gitProcessPending: false, terminationUnconfirmed: null, recovered: evidence });
    updateRecord(value.destination, record => ({ ...record, sourceProcessPending: false, sourceTerminationUnconfirmed: null, sourceRecovery: evidence }));
    for (const [id] of reservations) delete state.reservations[id];
    await atomic(path.join(base, 'storage-budget.json'), state);
    await fs.unlink(path.join(root, 'operation-pending.json'));
    return true;
  } finally { await lock.close(); await fs.unlink(lockFile); }
}
// Consulta de SO fora das travas: outra instância pode estar encerrando Git.
async function interruptedBoot(base) {
  for (const name of await fs.readdir(base)) {
    if (!/^[a-f0-9]{64}$/.test(name)) continue;
    const root = path.join(base, name);
    await contained(base, root);
    if (await read(path.join(root, 'operation-pending.json'))) return recoveryBoot.read();
  }
  return null;
}
// Chamado somente sob storage-budget.lock; revalida registros após a consulta.
async function recoverInterruptedSources(base, materialRoot, state, bootAt) {
  if (!Number.isSafeInteger(bootAt) || bootAt <= 0 || bootAt > Date.now()) return 0;
  let recovered = 0;
  for (const name of await fs.readdir(base)) {
    if (!/^[a-f0-9]{64}$/.test(name)) continue;
    const root = path.join(base, name);
    await contained(base, root);
    if (!await read(path.join(root, 'operation-pending.json'))) continue;
    if (await recoverScope(base, root, materialRoot, state, bootAt)) recovered++;
  }
  return recovered;
}
export { recoverInterruptedSources, interruptedBoot };
