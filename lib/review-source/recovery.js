// Reconcilia aquisições interrompidas, sem apagar objetos, refs ou materiais.
import fs from 'node:fs/promises';
import path from 'node:path';
import { read, atomic, contained } from './files.js';
import { digest } from './contract.js';
import { readRecord, updateRecord } from '../technical-review/material-record.js';
import { recoveryBoot } from './recovery-boot.js';
import { ownerEndedProof, recoveryProcesses } from './recovery-owner.js';
import { orphanProof, recoverOrphans } from './recovery-orphans.js';
import { tryWithLock } from './lock-file.js';

// O dono neste próprio processo (git morto por timeout) recebe evidência própria.
const PROVA_DO_DONO = { self: 'own-interruption-without-git' };
async function candidate(base, root, materialRoot, proof) {
  const pending = await read(path.join(root, 'operation-pending.json'));
  if (pending?.schema !== 1 || !/^[a-f0-9-]{36}$/.test(pending.lease || '')) return null;
  const leaseFile = path.join(root, 'leases', pending.lease + '.json');
  await contained(base, leaseFile);
  const lease = await read(leaseFile);
  if (lease?.schema !== 1 || lease.id !== pending.lease || !Number.isInteger(lease.pid) || lease.pid <= 0
    || !lease.destination || (!lease.terminationUnconfirmed && !lease.recovered)) return null;
  if (!Number.isSafeInteger(lease.createdAt) || !Number.isSafeInteger(pending.at) || lease.createdAt > pending.at) return null;
  const { bootAt } = proof, owner = proof.owners?.get(path.basename(root));
  const byBoot = Number.isSafeInteger(bootAt) && bootAt > 0 && bootAt <= Date.now() && pending.at < bootAt;
  const byOwner = !byBoot && owner?.lease === lease.id && owner.pendingAt === pending.at && owner.ownerPid === lease.pid;
  if (!byBoot && !byOwner) return null;
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
  const evidence = byBoot ? { bootAt, ownerPid: lease.pid, proof: 'previous-system-boot' }
    : { ownerPid: lease.pid, ownerState: owner.owner, proof: PROVA_DO_DONO[owner.owner] || 'owner-ended-without-git' };
  return { pending, lease, leaseFile, destination, evidence };
}
async function recoverScope(base, root, materialRoot, state, proof) {
  const lockFile = path.join(root, 'writer.lock');
  await contained(base, lockFile);
  return tryWithLock(lockFile, () => false, async () => {
    const value = await candidate(base, root, materialRoot, proof);
    if (!value) return false;
    const reservations = Object.entries(state.reservations).filter(([, r]) => r.scope === path.basename(root) && r.terminationUnconfirmed);
    if (reservations.some(([, r]) => !Number.isSafeInteger(r.createdAt) || r.createdAt > value.pending.at)) return false;
    const evidence = { at: Date.now(), ...value.evidence };
    // O marcador do escopo é removido por último. Se uma escrita falhar, ele
    // continua impedindo admissões até a reconciliação inteira ser repetida.
    await atomic(value.leaseFile, { ...value.lease, gitProcessPending: false, terminationUnconfirmed: null, recovered: evidence });
    updateRecord(value.destination, record => ({ ...record, sourceProcessPending: false, sourceTerminationUnconfirmed: null, sourceRecovery: evidence }));
    for (const [id] of reservations) delete state.reservations[id];
    await atomic(path.join(base, 'storage-budget.json'), state);
    await fs.unlink(path.join(root, 'operation-pending.json'));
    return true;
  });
}
// Consulta de SO fora das travas: outra instância pode estar encerrando Git.
// Duas provas de término: o boot posterior à interrupção ou, no mesmo boot, o dono encerrado sem Git anterior vivo.
async function interruptedProof(base, materialRoot) {
  let bootAt, git, owners = null;
  for (const name of await fs.readdir(base)) {
    if (!/^[a-f0-9]{64}$/.test(name)) continue;
    const root = path.join(base, name);
    await contained(base, root);
    const pending = await read(path.join(root, 'operation-pending.json'));
    if (!pending) continue;
    if (bootAt === undefined) bootAt = await recoveryBoot.read();
    owners ||= new Map();
    // O boot já prova: a lista de processos, cara no Windows, nem é consultada.
    if (Number.isSafeInteger(bootAt) && bootAt > 0 && bootAt <= Date.now() && pending.at < bootAt) continue;
    const owner = await ownerEndedProof(base, root, materialRoot, () => (git ||= recoveryProcesses.list()));
    if (owner) owners.set(name, owner);
  }
  // Sem marcador também há o que recuperar: lease com Git pendente e reserva de dono encerrado.
  const orphans = await orphanProof(base, () => (git ||= recoveryProcesses.list()),
    async () => (bootAt === undefined ? (bootAt = await recoveryBoot.read()) : bootAt));
  return (owners || orphans) && { bootAt, owners: owners || new Map(), orphans };
}
// Chamado somente sob storage-budget.lock; revalida registros após a consulta.
async function recoverInterruptedSources(base, materialRoot, state, proof) {
  if (!proof) return 0;
  let recovered = await recoverOrphans(base, state, proof.orphans);
  for (const name of await fs.readdir(base)) {
    if (!/^[a-f0-9]{64}$/.test(name)) continue;
    const root = path.join(base, name);
    await contained(base, root);
    if (!await read(path.join(root, 'operation-pending.json'))) continue;
    if (await recoverScope(base, root, materialRoot, state, proof)) recovered++;
  }
  return recovered;
}
export { recoverInterruptedSources, interruptedProof };
