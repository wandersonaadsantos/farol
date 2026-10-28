// Lease com Git pendente e reserva global cujo dono acabou sem deixar marcador (27/10/2026).
// O Farol morto no meio de um fetch deixa `gitProcessPending` na lease e a reserva no
// storage-budget.json, sem operation-pending.json. Desde a v2.78.7 a lease pendente de outro
// processo reserva a folga do escopo na quota global, e nada a recuperava: na atualização das
// 19:19 o engine-ai ficou com ~2 GB de folga presa e toda aquisição de todo repositório deu
// "Reserva global de disco insuficiente". A prova é a mesma da recuperação com marcador: dono
// encerrado e nenhum Git anterior ao instante protegido ainda vivo. Reserva sem dono gravado
// (anterior à v2.78.10) só sai com boot posterior a ela.
import fs from 'node:fs/promises';
import path from 'node:path';
import { read, atomic, contained } from './files.js';
import { INSTANCE } from './instance.js';
import { ownerState } from './process-owner.js';
import { readRecord, updateRecord } from '../technical-review/material-record.js';
import { processState } from '../technical-review/material-process.js';

// O ps do POSIX mede o tempo decorrido em segundos; a folga mantém o Git do mesmo segundo como anterior.
const FOLGA_DO_RELOGIO_MS = 2000;
const daqui = owner => owner?.instance === INSTANCE && owner.pid === process.pid;

// Lease anterior à v2.78.10 não grava o início do processo: vale a data de criação do registro
// do material (mesmo PID) e, sem ela, só o PID ausente.
async function leaseOwnerState(lease) {
  if (Number.isSafeInteger(lease.startedAt)) return ownerState(lease);
  const record = lease.destination ? readRecord(lease.destination) : null;
  if (record?.owner?.pid === lease.pid && record.owner.birth) {
    const state = await processState(record.owner);
    return state === 'reused' ? 'ended' : state;
  }
  return ownerState({ pid: lease.pid });
}

const semGitAnterior = (git, at) => !!git && !git.some(row => !Number.isFinite(row.born) || row.born <= at + FOLGA_DO_RELOGIO_MS);

async function orphanLeases(base, listarGit) {
  const found = [];
  for (const name of await fs.readdir(base)) {
    if (!/^[a-f0-9]{64}$/.test(name)) continue;
    // escopo com marcador é da recuperação de interrupção (recovery.js), com a prova dela
    if (await read(path.join(base, name, 'operation-pending.json')).catch(() => true)) continue;
    const dir = path.join(base, name, 'leases');
    await contained(base, dir);
    let files;
    try { files = await fs.readdir(dir); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const file of files) {
      const leaseFile = path.join(dir, file), lease = await read(leaseFile).catch(() => null);
      if (lease?.schema !== 1 || !lease.gitProcessPending || daqui(lease) || !Number.isInteger(lease.pid)) continue;
      if (await leaseOwnerState(lease) !== 'ended') continue;
      const at = Number.isSafeInteger(lease.gitProcessAt) ? lease.gitProcessAt : (await fs.stat(leaseFile)).mtimeMs;
      if (semGitAnterior(await listarGit(), at)) found.push({ leaseFile, id: lease.id, pid: lease.pid, instance: lease.instance, at });
    }
  }
  return found;
}

async function orphanReservations(state, listarGit, lerBoot) {
  const found = [];
  for (const [id, r] of Object.entries(state?.reservations || {})) {
    if (!r || !Number.isSafeInteger(r.createdAt)) continue;
    if (!r.owner) {
      const bootAt = await lerBoot();
      if (Number.isSafeInteger(bootAt) && bootAt > 0 && bootAt <= Date.now() && r.createdAt < bootAt) found.push({ id, createdAt: r.createdAt, proof: 'previous-system-boot' });
      continue;
    }
    if (daqui(r.owner) || await ownerState(r.owner) !== 'ended') continue;
    if (semGitAnterior(await listarGit(), r.createdAt)) found.push({ id, createdAt: r.createdAt, proof: 'owner-ended-without-git', ownerPid: r.owner.pid });
  }
  return found;
}

// Consulta de SO fora das travas; a lista de Git é compartilhada e só sai quando há dono encerrado.
async function orphanProof(base, listarGit, lerBoot) {
  const state = await read(path.join(base, 'storage-budget.json')).catch(() => null);
  const leases = await orphanLeases(base, listarGit);
  const reservations = await orphanReservations(state, listarGit, lerBoot);
  return leases.length || reservations.length ? { leases, reservations } : null;
}

// Sob storage-budget.lock: cada candidato é conferido de novo antes de mudar. Devolve quantos saíram.
async function recoverOrphans(base, state, proof) {
  if (!proof) return 0;
  let recovered = 0;
  for (const item of proof.leases) {
    const lease = await read(item.leaseFile).catch(() => null);
    if (!lease?.gitProcessPending || lease.id !== item.id || lease.pid !== item.pid || lease.instance !== item.instance) continue;
    const evidence = { at: Date.now(), proof: 'owner-ended-without-git', ownerPid: item.pid, gitProcessAt: item.at };
    await atomic(item.leaseFile, { ...lease, gitProcessPending: false, recovered: evidence });
    if (lease.destination && readRecord(lease.destination)?.sourceProcessPending) {
      updateRecord(lease.destination, record => ({ ...record, sourceProcessPending: false, sourceRecovery: evidence }));
    }
    recovered++;
  }
  let removed = 0;
  for (const item of proof.reservations) {
    if (state.reservations[item.id]?.createdAt !== item.createdAt) continue;
    delete state.reservations[item.id];
    removed++;
  }
  if (removed) {
    state.lastOrphanRecovery = { at: Date.now(), reservations: removed, leases: recovered };
    await atomic(path.join(base, 'storage-budget.json'), state);
  }
  return recovered + removed;
}

export { orphanProof, recoverOrphans, leaseOwnerState };
