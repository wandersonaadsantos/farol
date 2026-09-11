// Lease de coordenação entre aparelhos: quem está analisando este PR agora. Folha de
// IO simples: recebe o cliente do banco pronto (lib/sync/rtdb.js) e não conhece o engine.
//
// A posse é decidida pelo CAS por ETag do RTDB (`if-match` em PUT e DELETE): dois
// aparelhos que leem o nó vazio no mesmo instante mandam o mesmo `null_etag`, e o
// servidor aceita só o primeiro PUT; o segundo recebe 412 e, relendo, enxerga o lease
// do vencedor. As regras do banco não veem o leaseId de quem apaga, então a remoção
// só apaga o que o `if-match` prova ser o MEU lease.
//
// Nada aqui lança: todo desfecho volta como { ok, ... } para o coordenador decidir.
import { SYNC } from '../constants.js';
import { SYNC_CODES, motivoDe } from './errors.js';

// uma leitura + escrita por tentativa; três é o que o contrato fixa para a disputa
const MAX_TENTATIVAS = 3;
const COM_ETAG = { etag: true };

function leasePath(uid, accountHash, prHash) {
  return `/users/${uid}/leases/${accountHash}/${prHash}`;
}

function caminhoDe(ids) {
  return leasePath(ids.uid, ids.accountHash, ids.prHash);
}

function ehObjeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// Falta de dado nunca libera: lease sem expiresAt numérico (null não vira zero) conta
// como vivo, porque tomar o lease de quem está trabalhando é a pior falha possível aqui.
function leaseAcquirable(atual, { leaseId, nowMs }) {
  if (atual === null || atual === undefined) return 'ausente';
  if (!ehObjeto(atual)) return 'alheio';
  if (leaseId && atual.leaseId === leaseId) return 'meu';
  const exp = atual.expiresAt;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return 'alheio';
  return exp <= nowMs ? 'expirado' : 'alheio';
}

function buildLease({ leaseId, deviceId, operationKind, headSha, nowMs, farolVersion }) {
  return {
    leaseId, deviceId, operationKind, headSha: headSha || '',
    acquiredAt: nowMs, heartbeatAt: nowMs, expiresAt: nowMs + SYNC.LEASE_TTL_MS, farolVersion,
  };
}

function indisponivel(r) {
  const code = (r && r.code) || SYNC_CODES.INDISPONIVEL;
  return { ok: false, reason: 'indisponivel', code, motivo: (r && r.motivo) || motivoDe(code) };
}

// Um passo da disputa: lê com etag e, se o lease pode ser meu, escreve condicionado ao
// etag lido. `conflito` devolve o valor atual que o 412 trouxe para a próxima volta.
async function tentarAdquirir(client, path, novo, nowMs) {
  const lido = await client.get(path, COM_ETAG);
  if (!lido.ok) return { fim: indisponivel(lido) };
  if (leaseAcquirable(lido.data, { leaseId: novo.leaseId, nowMs }) === 'alheio') return { fim: { ok: false, reason: 'alheio', lease: lido.data } };
  const w = await client.put(path, novo, { ifMatch: lido.etag || 'null_etag', etag: true });
  if (w.ok) return { fim: { ok: true, lease: novo, etag: w.etag } };
  if (w.code !== SYNC_CODES.CONFLITO) return { fim: indisponivel(w) };
  return { conflito: w.data };
}

async function acquireLease(client, ids, dados) {
  const path = caminhoDe(ids);
  const novo = buildLease(dados);
  let atual = null;
  for (let i = 0; i < MAX_TENTATIVAS; i++) {
    const passo = await tentarAdquirir(client, path, novo, dados.nowMs);
    if (passo.fim) return passo.fim;
    atual = passo.conflito;
  }
  // três 412 seguidos: outro aparelho segue escrevendo no nó, e na dúvida ele é o dono
  return { ok: false, reason: 'alheio', lease: atual };
}

function vivoEMeu(atual, leaseId, nowMs) {
  if (!ehObjeto(atual) || !leaseId || atual.leaseId !== leaseId) return false;
  return typeof atual.expiresAt === 'number' && atual.expiresAt > nowMs;
}

// Lease vencido é perdido mesmo que ninguém o tenha tomado ainda: outro aparelho pode
// já ter lido o nó como livre e estar a caminho do PUT, e renovar por cima esconderia
// essa corrida em vez de encerrar a sessão.
async function renewLease(client, ids, { leaseId, nowMs }) {
  const path = caminhoDe(ids);
  const lido = await client.get(path, COM_ETAG);
  if (!lido.ok) return indisponivel(lido);
  if (!vivoEMeu(lido.data, leaseId, nowMs)) return { ok: false, reason: 'perdido', lease: lido.data };
  const renovado = { ...lido.data, heartbeatAt: nowMs, expiresAt: nowMs + SYNC.LEASE_TTL_MS };
  const w = await client.put(path, renovado, { ifMatch: lido.etag, etag: true });
  if (w.ok) return { ok: true, etag: w.etag };
  if (w.code === SYNC_CODES.CONFLITO) return { ok: false, reason: 'perdido', lease: w.data };
  return indisponivel(w);
}

// Release atrasado (a sessão demorou a encerrar e o sucessor já assumiu) não pode
// apagar o sucessor: só apaga o nó cujo leaseId é o meu, e o `if-match` garante que é
// o MESMO nó que acabou de ser lido.
async function releaseLease(client, ids, { leaseId }) {
  const path = caminhoDe(ids);
  const lido = await client.get(path, COM_ETAG);
  if (!lido.ok) return indisponivel(lido);
  if (!ehObjeto(lido.data) || !leaseId || lido.data.leaseId !== leaseId) return { ok: true, released: false };
  const d = await client.del(path, { ifMatch: lido.etag });
  if (d.ok) return { ok: true, released: true };
  if (d.code === SYNC_CODES.CONFLITO) return { ok: true, released: false };
  return indisponivel(d);
}

export default { leasePath, leaseAcquirable, buildLease, acquireLease, renewLease, releaseLease };
export { leasePath, leaseAcquirable, buildLease, acquireLease, renewLease, releaseLease };
