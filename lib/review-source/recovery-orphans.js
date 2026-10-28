// Lease com Git pendente e reserva global cujo dono acabou sem deixar marcador (27/10/2026).
// O Farol morto no meio de um fetch deixa `gitProcessPending` na lease e a reserva no
// storage-budget.json, sem operation-pending.json. Desde a v2.78.7 a lease pendente de outro
// processo reserva a folga do escopo na quota global, e nada a recuperava: na atualização das
// 19:19 o engine-ai ficou com ~2 GB de folga presa e toda aquisição de todo repositório deu
// "Reserva global de disco insuficiente".
//
// A prova tem o sentido oposto ao da recuperação com marcador. Lá o instante é gravado DEPOIS
// do Git voltar com término incerto, e todo Git da operação nasceu antes dele. Aqui o instante
// (`gitProcessAt` da lease, `createdAt` da reserva) é de ANTES do Git começar, então o Git
// órfão do dono morto nasce DEPOIS dele: qualquer Git vivo nascido a partir do instante
// (com a folga do relógio) bloqueia. É conservador, e solta quando esses Git terminam.
// Reserva sem dono gravado (anterior à v2.78.10) só sai com boot posterior a ela.
import fs from 'node:fs/promises';
import path from 'node:path';
import { read, atomic, contained } from './files.js';
import { INSTANCE } from './instance.js';
import { ownerState } from './process-owner.js';
import { lockLog } from './lock-file.js';
import { readRecord, updateRecord } from '../technical-review/material-record.js';
import { processState } from '../technical-review/material-process.js';

// O ps do POSIX mede o tempo decorrido em segundos; a folga recua o corte para o lado seguro.
const FOLGA_DO_RELOGIO_MS = 2000;
// Dono vivo ou sem resposta é reconsultado no máximo uma vez neste intervalo: a varredura roda
// a cada reserva, e cada consulta é um PowerShell no Windows.
const REVISITA_MS = 60_000;
const daqui = owner => owner?.instance === INSTANCE && owner.pid === process.pid;
const lembrados = new Map();
let bootLido;
const orphanMemo = { clear() { lembrados.clear(); bootLido = undefined; } };

async function lembrar(chave, consulta) {
  const antes = lembrados.get(chave);
  if (antes && Date.now() - antes.at < REVISITA_MS) return antes.state;
  const state = await consulta();
  if (state !== 'ended') lembrados.set(chave, { state, at: Date.now() });
  return state;
}

// Lease anterior à v2.78.10 não grava o início do processo: vale a data de criação do registro
// do material (mesmo PID) e, sem ela, só o PID ausente.
async function leaseOwnerState(lease) {
  return lembrar(`lease:${lease.instance}:${lease.pid}`, async () => {
    if (Number.isSafeInteger(lease.startedAt)) return ownerState(lease);
    const record = lease.destination ? readRecord(lease.destination) : null;
    if (record?.owner?.pid === lease.pid && record.owner.birth) {
      const state = await processState(record.owner);
      return state === 'reused' ? 'ended' : state;
    }
    return ownerState({ pid: lease.pid });
  });
}

// Nenhum Git vivo nascido a partir do instante protegido (início desconhecido também bloqueia).
const semGitPosterior = (git, at) => !!git && !git.some(row => !Number.isFinite(row.born) || row.born >= at - FOLGA_DO_RELOGIO_MS);

async function escopoSemMarcador(base, name) {
  return !await read(path.join(base, name, 'operation-pending.json')).catch(() => true);
}

async function orphanLeasesDoEscopo(base, name, listarGit) {
  const found = [], dir = path.join(base, name, 'leases');
  await contained(base, dir);
  for (const file of await fs.readdir(dir)) {
    const leaseFile = path.join(dir, file), lease = await read(leaseFile).catch(() => null);
    if (lease?.schema !== 1 || !lease.gitProcessPending || daqui(lease) || !Number.isInteger(lease.pid)) continue;
    if (await leaseOwnerState(lease) !== 'ended') continue;
    // lease antiga não grava o instante do Git: a criação dela é o mais antigo possível
    const at = Number.isSafeInteger(lease.gitProcessAt) ? lease.gitProcessAt : lease.createdAt;
    if (Number.isSafeInteger(at) && semGitPosterior(await listarGit(), at)) found.push({ leaseFile, id: lease.id, pid: lease.pid, instance: lease.instance, at });
  }
  return found;
}

async function orphanLeases(base, listarGit) {
  const found = [];
  for (const name of await fs.readdir(base)) {
    // escopo com marcador é da recuperação de interrupção (recovery.js), com a prova dela
    if (!/^[a-f0-9]{64}$/.test(name) || !await escopoSemMarcador(base, name)) continue;
    // escopo ilegível fica sem candidato; não derruba a admissão dos outros repositórios
    found.push(...await orphanLeasesDoEscopo(base, name, listarGit).catch(() => []));
  }
  return found;
}

async function orphanReservations(base, state, listarGit, lerBoot) {
  const found = [];
  for (const [id, r] of Object.entries(state?.reservations || {})) {
    if (!r || !Number.isSafeInteger(r.createdAt) || r.terminationUnconfirmed) continue;
    if (typeof r.scope === 'string' && /^[a-f0-9]{64}$/.test(r.scope) && !await escopoSemMarcador(base, r.scope)) continue;
    if (!r.owner) {
      const bootAt = await lerBoot();
      if (Number.isSafeInteger(bootAt) && bootAt > 0 && bootAt <= Date.now() && r.createdAt < bootAt) found.push({ id, createdAt: r.createdAt, proof: 'previous-system-boot' });
      continue;
    }
    if (daqui(r.owner)) continue;
    if (await lembrar(`res:${r.owner.instance}:${r.owner.pid}`, () => ownerState(r.owner)) !== 'ended') continue;
    if (semGitPosterior(await listarGit(), r.createdAt)) found.push({ id, createdAt: r.createdAt, proof: 'owner-ended-without-git', ownerPid: r.owner.pid });
  }
  return found;
}

// Consulta de SO fora das travas; a lista de Git é compartilhada e só sai quando há dono encerrado.
async function orphanProof(base, listarGit, lerBoot) {
  const state = await read(path.join(base, 'storage-budget.json')).catch(() => null);
  const boot = async () => (bootLido === undefined ? (bootLido = await lerBoot()) : bootLido);
  const leases = await orphanLeases(base, listarGit);
  const reservations = await orphanReservations(base, state, listarGit, boot);
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
  if (recovered + removed) {
    try { lockLog.write?.('WARN', `Cache de código: ${recovered} lease(s) com Git pendente e ${removed} reserva(s) de processo encerrado recuperadas, sem Git posterior vivo.`); }
    catch { /* log nunca derruba a recuperação */ }
  }
  return recovered + removed;
}

export { orphanProof, recoverOrphans, leaseOwnerState, orphanMemo };
