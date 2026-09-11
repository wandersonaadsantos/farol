// Teto COMPARTILHADO de rodadas automáticas por PR e por dia (D13 do contrato). Folha
// de IO simples: recebe o cliente do banco pronto e não conhece o engine.
//
// O teto local (MAX_RODADAS_AUTO_DIA, review.js) conta só o que ESTE aparelho relançou;
// com dois aparelhos da mesma pessoa, cada um gastaria o seu teto e o PR teria o dobro
// de rodadas no dia. Aqui o nó do dia inteiro é reescrito com `if-match`, então duas
// reservas simultâneas para o último lugar não passam as duas: o 412 obriga a reler,
// e a releitura já enxerga o lugar ocupado.
//
// O dia é o de Brasília (brasiliaDay), nunca o do fuso do processo: aparelhos em fusos
// diferentes precisam concordar sobre qual é "hoje" para o teto ser o mesmo.
//
// Nada aqui lança: todo desfecho volta como { ok, ... } para o coordenador decidir.
import { SYNC } from '../constants.js';
import { SYNC_CODES, motivoDe } from './errors.js';
import { brasiliaDay } from './keys.js';

// uma leitura + escrita por tentativa; três é o que o contrato fixa para a disputa
const MAX_TENTATIVAS = 3;
const COM_ETAG = { etag: true };
const SHALLOW = { shallow: true };
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

function roundsBase(uid, accountHash, prHash) {
  return `/users/${uid}/dailyRounds/${accountHash}/${prHash}`;
}

function roundsPath(uid, accountHash, prHash, day) {
  return `${roundsBase(uid, accountHash, prHash)}/${day}`;
}

function ehObjeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function reservasDe(node) {
  return ehObjeto(node) && ehObjeto(node.reservations) ? node.reservations : {};
}

function listaDeReservas(node) {
  return Object.values(reservasDe(node)).filter(ehObjeto);
}

// started conta mesmo vencido: a rodada aconteceu, e o teto é de rodadas do dia
function countStarted(node) {
  return listaDeReservas(node).filter((r) => r.state === 'started').length;
}

// reserva de sessão que morreu antes de começar não segura o lugar para sempre:
// ela só conta enquanto o prazo dela (o TTL do lease) não venceu
function countReservedVivas(node, nowMs) {
  return listaDeReservas(node).filter((r) => r.state === 'reserved' && Number(r.expiresAt) > nowMs).length;
}

function indisponivel(r) {
  const code = (r && r.code) || SYNC_CODES.INDISPONIVEL;
  return { ok: false, reason: 'indisponivel', code, motivo: (r && r.motivo) || motivoDe(code) };
}

// três 412 seguidos: o nó do dia está em disputa contínua, e sem prova do lugar a
// rodada não começa (a admissão trata como indisponível, que é espera, não falha)
function disputaSemFim() {
  return indisponivel({ code: SYNC_CODES.CONFLITO });
}

function comReserva(node, { attemptId, fingerprint, leaseId, nowMs }) {
  const reserva = {
    operationFingerprint: fingerprint, leaseId, state: 'reserved',
    reservedAt: nowMs, startedAt: null, expiresAt: nowMs + SYNC.LEASE_TTL_MS,
  };
  const reservations = { ...reservasDe(node), [attemptId]: reserva };
  return { dayPolicy: SYNC.DAY_TZ, updatedAt: nowMs, reservations };
}

async function tentarReservar(client, path, dados, max) {
  const lido = await client.get(path, COM_ETAG);
  if (!lido.ok) return { fim: indisponivel(lido) };
  const started = countStarted(lido.data);
  if (started + countReservedVivas(lido.data, dados.nowMs) >= max) return { fim: { ok: false, reason: 'esgotado', started } };
  const w = await client.put(path, comReserva(lido.data, dados), { ifMatch: lido.etag || 'null_etag', etag: true });
  if (w.ok) return { fim: { ok: true, etag: w.etag } };
  if (w.code !== SYNC_CODES.CONFLITO) return { fim: indisponivel(w) };
  return {};
}

async function reserveRound(client, ids, day, { attemptId, fingerprint, leaseId, nowMs, max = SYNC.DAILY_ROUNDS_MAX }) {
  const path = roundsPath(ids.uid, ids.accountHash, ids.prHash, day);
  const dados = { attemptId, fingerprint, leaseId, nowMs };
  for (let i = 0; i < MAX_TENTATIVAS; i++) {
    const passo = await tentarReservar(client, path, dados, max);
    if (passo.fim) return passo.fim;
  }
  return disputaSemFim();
}

// Reserva vencida é perdida: depois do prazo ela deixou de contar contra o teto, então
// outro aparelho pode já ter ocupado o lugar, e iniciá-la agora passaria do teto.
function reservaIniciavel(reserva, leaseId, nowMs) {
  if (!ehObjeto(reserva) || !leaseId || reserva.leaseId !== leaseId) return false;
  return reserva.state === 'started' || Number(reserva.expiresAt) > nowMs;
}

async function tentarIniciar(client, path, { attemptId, leaseId, nowMs }) {
  const lido = await client.get(path, COM_ETAG);
  if (!lido.ok) return { fim: indisponivel(lido) };
  const reserva = reservasDe(lido.data)[attemptId];
  if (!reservaIniciavel(reserva, leaseId, nowMs)) return { fim: { ok: false, reason: 'perdido' } };
  const iniciada = { ...reserva, state: 'started', startedAt: nowMs };
  const reservations = { ...reservasDe(lido.data), [attemptId]: iniciada };
  const w = await client.put(path, { ...lido.data, updatedAt: nowMs, reservations }, { ifMatch: lido.etag });
  if (w.ok) return { fim: { ok: true } };
  if (w.code !== SYNC_CODES.CONFLITO) return { fim: indisponivel(w) };
  return {};
}

async function startRound(client, ids, day, dados) {
  const path = roundsPath(ids.uid, ids.accountHash, ids.prHash, day);
  for (let i = 0; i < MAX_TENTATIVAS; i++) {
    const passo = await tentarIniciar(client, path, dados);
    if (passo.fim) return passo.fim;
  }
  return disputaSemFim();
}

// Um PATCH só, com os dias velhos em null: PATCH é idempotente e dia velho ninguém
// mais escreve, então não há corrida a arbitrar com `if-match`.
async function pruneRounds(client, uid, accountHash, prHash, { nowMs }) {
  const base = roundsBase(uid, accountHash, prHash);
  const lido = await client.get(base, SHALLOW);
  if (!lido.ok) return { ok: false, removidos: 0, code: lido.code, motivo: lido.motivo };
  const limite = brasiliaDay(nowMs - SYNC.ROUNDS_TTL_MS);
  const velhos = Object.keys(ehObjeto(lido.data) ? lido.data : {}).filter((d) => DIA_RE.test(d) && d < limite);
  if (!velhos.length) return { ok: true, removidos: 0 };
  const r = await client.patch(base, Object.fromEntries(velhos.map((d) => [d, null])));
  if (!r.ok) return { ok: false, removidos: 0, code: r.code, motivo: r.motivo };
  return { ok: true, removidos: velhos.length };
}

export default { roundsPath, countStarted, countReservedVivas, reserveRound, startRound, pruneRounds };
export { roundsPath, countStarted, countReservedVivas, reserveRound, startRound, pruneRounds };
