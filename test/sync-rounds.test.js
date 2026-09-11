// lib/sync/rounds.js: o teto COMPARTILHADO de rodadas automáticas por PR e por dia.
// O nó do dia inteiro é escrito com `if-match`, então dois aparelhos que disputam o
// último lugar do dia não passam os dois: o dublê do RTDB faz o CAS de verdade.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { createRtdbClient } from '../lib/sync/rtdb.js';
import { SYNC } from '../lib/constants.js';
import { brasiliaDay } from '../lib/sync/keys.js';
import rounds, {
  roundsPath, countStarted, countReservedVivas, reserveRound, startRound, pruneRounds,
} from '../lib/sync/rounds.js';

const TOKEN = 'tok-ok';
const IDS = { uid: 'u1', accountHash: 'a'.repeat(64), prHash: 'b'.repeat(64) };
const AGORA = 1_800_000_000_000;
const DIA = brasiliaDay(AGORA);
let fake;

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => { await fake.close(); });
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; });

function cliente(extra = {}) {
  return createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: TOKEN }), ...extra });
}

function reservaDe(attemptId, leaseId = 'L-' + attemptId, nowMs = AGORA) {
  return { attemptId, fingerprint: 'review_' + 'c'.repeat(32), leaseId, nowMs };
}

function semear(dia, reservations) {
  fake.setTree({ users: { u1: { dailyRounds: { [IDS.accountHash]: { [IDS.prHash]: { [dia]: { dayPolicy: SYNC.DAY_TZ, updatedAt: 1, reservations } } } } } } });
}

function iniciada(n) {
  return { operationFingerprint: 'f', leaseId: 'L' + n, state: 'started', reservedAt: 1, startedAt: 2, expiresAt: 3 };
}

function noDia(dia = DIA) {
  const t = fake.tree();
  return t && t.users.u1.dailyRounds[IDS.accountHash][IDS.prHash][dia];
}

test('exporta pelo default e pelos nomes', () => {
  for (const nome of ['roundsPath', 'countStarted', 'countReservedVivas', 'reserveRound', 'startRound', 'pruneRounds']) {
    assert.equal(typeof rounds[nome], 'function', nome);
  }
});

test('roundsPath monta o caminho do contrato', () => {
  assert.equal(roundsPath('u1', 'ah', 'ph', '2026-09-10'), '/users/u1/dailyRounds/ah/ph/2026-09-10');
});

test('countStarted e countReservedVivas contam só o que vale', () => {
  const node = { reservations: {
    a: { state: 'started' },
    b: { state: 'started', expiresAt: 0 },
    c: { state: 'reserved', expiresAt: AGORA + 1 },
    d: { state: 'reserved', expiresAt: AGORA },
    e: { state: 'reserved' },
    f: 'lixo',
  } };
  assert.equal(countStarted(node), 2, 'started conta mesmo com expiresAt vencido: a rodada aconteceu');
  assert.equal(countReservedVivas(node, AGORA), 1, 'só reserva com expiresAt no futuro');
  assert.equal(countStarted(null), 0);
  assert.equal(countReservedVivas(undefined, AGORA), 0);
});

test('reserveRound em dia vazio grava o nó inteiro com a reserva', async () => {
  const r = await reserveRound(cliente(), IDS, DIA, reservaDe('t1'));
  assert.equal(r.ok, true);
  assert.match(r.etag, /^[0-9a-f]{40}$/);
  const no = noDia();
  assert.equal(no.dayPolicy, 'America/Sao_Paulo');
  assert.equal(no.updatedAt, AGORA);
  assert.deepEqual(no.reservations.t1, {
    operationFingerprint: 'review_' + 'c'.repeat(32), leaseId: 'L-t1', state: 'reserved',
    reservedAt: AGORA, expiresAt: AGORA + SYNC.LEASE_TTL_MS,
  });
  assert.equal(fake.requests.find((q) => q.method === 'PUT').headers['if-match'], 'null_etag');
});

test('teto: DAILY_ROUNDS_MAX rodadas iniciadas esgotam o dia', async () => {
  const cheio = {};
  for (let i = 0; i < SYNC.DAILY_ROUNDS_MAX; i++) cheio['s' + i] = iniciada(i);
  semear(DIA, cheio);
  const r = await reserveRound(cliente(), IDS, DIA, reservaDe('t1'));
  assert.deepEqual(r, { ok: false, reason: 'esgotado', started: SYNC.DAILY_ROUNDS_MAX });
  assert.equal(Object.keys(noDia().reservations).length, SYNC.DAILY_ROUNDS_MAX, 'nada foi escrito');
});

test('reserva viva conta contra o teto', async () => {
  semear(DIA, { s0: iniciada(0), s1: iniciada(1), r2: { operationFingerprint: 'f', leaseId: 'Lx', state: 'reserved', reservedAt: AGORA, expiresAt: AGORA + 1 } });
  const r = await reserveRound(cliente(), IDS, DIA, reservaDe('t1'));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'esgotado');
  assert.equal(r.started, 2);
});

test('reserva vencida não conta: a sessão que reservou morreu antes de começar', async () => {
  semear(DIA, { s0: iniciada(0), s1: iniciada(1), r2: { operationFingerprint: 'f', leaseId: 'Lx', state: 'reserved', reservedAt: 1, expiresAt: AGORA } });
  const r = await reserveRound(cliente(), IDS, DIA, reservaDe('t1'));
  assert.equal(r.ok, true);
  assert.equal(noDia().reservations.t1.state, 'reserved');
  assert.ok(noDia().reservations.r2, 'a reserva antiga fica no nó (a poda é por dia)');
});

test('parâmetro max sobrescreve o teto padrão', async () => {
  semear(DIA, { s0: iniciada(0) });
  const r = await reserveRound(cliente(), IDS, DIA, { ...reservaDe('t1'), max: 1 });
  assert.deepEqual(r, { ok: false, reason: 'esgotado', started: 1 });
});

test('dois aparelhos disputando o último lugar do dia: só um passa', async () => {
  semear(DIA, { s0: iniciada(0), s1: iniciada(1) });
  const [a, b] = await Promise.all([
    reserveRound(cliente(), IDS, DIA, reservaDe('tA')),
    reserveRound(cliente(), IDS, DIA, reservaDe('tB')),
  ]);
  const passaram = [a, b].filter((r) => r.ok);
  assert.equal(passaram.length, 1, 'exatamente um');
  const barrado = [a, b].find((r) => !r.ok);
  assert.equal(barrado.reason, 'esgotado');
  const res = noDia().reservations;
  assert.equal(Object.keys(res).length, 3);
  assert.equal(countStarted(noDia()) + countReservedVivas(noDia(), AGORA), SYNC.DAILY_ROUNDS_MAX);
});

test('startRound marca a reserva como iniciada', async () => {
  await reserveRound(cliente(), IDS, DIA, reservaDe('t1', 'L1'));
  const r = await startRound(cliente(), IDS, DIA, { attemptId: 't1', leaseId: 'L1', nowMs: AGORA + 10 });
  assert.deepEqual(r, { ok: true });
  const res = noDia().reservations.t1;
  assert.equal(res.state, 'started');
  assert.equal(res.startedAt, AGORA + 10);
  assert.equal(noDia().updatedAt, AGORA + 10);
});

test('startRound condiciona o PUT do dia ao etag lido: rodada que outro aparelho gravou entre o GET e o PUT sobrevive', async () => {
  await reserveRound(cliente(), IDS, DIA, reservaDe('t1', 'L1'));
  const base = cliente();
  let intercalou = false;
  // entre a leitura e a escrita do nó do dia, outro aparelho inicia uma rodada própria
  const c = {
    ...base,
    put: async (p, v, o) => {
      if (!intercalou) {
        intercalou = true;
        const t = fake.tree();
        t.users.u1.dailyRounds[IDS.accountHash][IDS.prHash][DIA].reservations.outro = iniciada(9);
        fake.setTree(t);
      }
      return base.put(p, v, o);
    },
  };
  fake.requests.length = 0;
  const r = await startRound(c, IDS, DIA, { attemptId: 't1', leaseId: 'L1', nowMs: AGORA + 10 });
  assert.equal(intercalou, true, 'o gancho rodou entre o GET e o PUT');
  assert.deepEqual(r, { ok: true }, 'o 412 obriga a reler, e a segunda volta inicia a reserva');
  const res = noDia().reservations;
  assert.ok(res.outro, 'a rodada do outro aparelho não foi apagada');
  assert.equal(res.outro.state, 'started');
  assert.equal(res.t1.state, 'started');
  assert.equal(countStarted(noDia()), 2, 'o teto compartilhado enxerga as duas rodadas');
  const puts = fake.requests.filter((q) => q.method === 'PUT');
  assert.equal(puts.length, 2, 'uma escrita recusada e uma aceita');
  for (const q of puts) assert.match(q.headers['if-match'], /^[0-9a-f]{40}$/, 'todo PUT do startRound leva if-match');
});

test('startRound exige o mesmo leaseId da reserva', async () => {
  await reserveRound(cliente(), IDS, DIA, reservaDe('t1', 'L1'));
  const r = await startRound(cliente(), IDS, DIA, { attemptId: 't1', leaseId: 'OUTRO', nowMs: AGORA + 10 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'perdido');
  assert.equal(noDia().reservations.t1.state, 'reserved', 'não iniciou a reserva de outro lease');
});

test('startRound de reserva que não existe é perdido', async () => {
  const r = await startRound(cliente(), IDS, DIA, { attemptId: 'nada', leaseId: 'L1', nowMs: AGORA });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'perdido');
});

test('startRound de reserva vencida é perdido: outro aparelho pode já ter usado o lugar', async () => {
  await reserveRound(cliente(), IDS, DIA, reservaDe('t1', 'L1'));
  const r = await startRound(cliente(), IDS, DIA, { attemptId: 't1', leaseId: 'L1', nowMs: AGORA + SYNC.LEASE_TTL_MS });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'perdido');
});

test('o dia vem de brasiliaDay: 02:30 UTC ainda é o dia anterior em Brasília', async () => {
  const instante = Date.UTC(2026, 8, 11, 2, 30);
  const dia = brasiliaDay(instante);
  assert.equal(dia, '2026-09-10');
  const r = await reserveRound(cliente(), IDS, dia, reservaDe('t1', 'L1', instante));
  assert.equal(r.ok, true);
  assert.ok(noDia('2026-09-10'), 'gravado no dia de Brasília');
  assert.equal(fake.tree().users.u1.dailyRounds[IDS.accountHash][IDS.prHash]['2026-09-11'], undefined);
});

test('pruneRounds apaga dia antigo, mantém o de hoje e decide a borda pelo dia de Brasília', async () => {
  const agora = Date.UTC(2026, 8, 19, 2, 30); // ainda 18/09 em Brasília
  const fundo = { dayPolicy: SYNC.DAY_TZ, updatedAt: 1, reservations: { s: iniciada(0) } };
  fake.setTree({ users: { u1: { dailyRounds: { [IDS.accountHash]: { [IDS.prHash]: {
    '2026-09-01': fundo, '2026-09-09': fundo, '2026-09-10': fundo, '2026-09-18': fundo,
  } } } } } });
  const r = await pruneRounds(cliente(), 'u1', IDS.accountHash, IDS.prHash, { nowMs: agora });
  assert.deepEqual(r, { ok: true, removidos: 2 });
  const dias = Object.keys(fake.tree().users.u1.dailyRounds[IDS.accountHash][IDS.prHash]).sort();
  assert.deepEqual(dias, ['2026-09-10', '2026-09-18'], 'o limite é 8 dias antes em Brasília (10/09), não em UTC (11/09)');
  assert.equal(fake.requests.at(-1).method, 'PATCH', 'um PATCH só com os nulos');
});

test('pruneRounds sem nada velho não escreve', async () => {
  semear(DIA, { s0: iniciada(0) });
  const r = await pruneRounds(cliente(), 'u1', IDS.accountHash, IDS.prHash, { nowMs: AGORA });
  assert.deepEqual(r, { ok: true, removidos: 0 });
  assert.equal(fake.requests.some((q) => q.method !== 'GET'), false);
});

test('rede caída: indisponivel com código, sem lançar', async () => {
  const semRede = cliente({ fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  const r = await reserveRound(semRede, IDS, DIA, reservaDe('t1'));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'indisponivel');
  assert.equal(r.code, 'indisponivel');
  const s = await startRound(semRede, IDS, DIA, { attemptId: 't1', leaseId: 'L1', nowMs: AGORA });
  assert.equal(s.reason, 'indisponivel');
  const p = await pruneRounds(semRede, 'u1', IDS.accountHash, IDS.prHash, { nowMs: AGORA });
  assert.equal(p.ok, false);
  assert.equal(p.removidos, 0);
  assert.equal(p.code, 'indisponivel');
});

// O nó do dia inteiro é reescrito por PUT: sem ETag o if-match sairia de cena e duas
// reservas simultâneas passariam as duas, furando o teto compartilhado.
test('sem ETag na resposta, reservar e iniciar viram indisponivel sem escrever nada', async () => {
  const c = cliente();
  semear(DIA, { t1: reservaDe('t1') });
  fake.requests.length = 0;
  fake.setSemEtag(true);
  try {
    const r = await reserveRound(c, IDS, DIA, { attemptId: 't2', fingerprint: 'review_x', leaseId: 'L2', nowMs: AGORA });
    assert.equal(r.reason, 'indisponivel');
    assert.equal(r.code, 'resposta_invalida');
    const s = await startRound(c, IDS, DIA, { attemptId: 't1', leaseId: 'L-t1', nowMs: AGORA });
    assert.equal(s.reason, 'indisponivel');
    assert.equal(s.code, 'resposta_invalida');
    assert.deepEqual(fake.requests.filter((q) => q.method === 'PUT').map((q) => q.path), [], 'nenhuma escrita sem prova');
    assert.deepEqual(Object.keys(noDia().reservations), ['t1']);
  } finally {
    fake.setSemEtag(false);
  }
});
