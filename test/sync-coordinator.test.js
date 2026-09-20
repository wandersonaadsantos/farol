// lib/sync/coordinator.js: a admissão de uma análise entre aparelhos (recibo, preflight
// do GitHub, lease, releitura sob lease, teto de rodadas) e o handle que renova o lease
// e grava o recibo no fim. O banco é o dublê em processo; o engine é um objeto mínimo
// com os campos que o coordenador lê (o runtime de lib/engine/sync.js já conectado).
//
// FAROL_HOME antes do import: o coordenador alcança lib/paths.js (versão do app e o Set
// de estados decisivos de decision.js), então ele entra por await import.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-coordinator-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { SYNC } from '../lib/constants.js';
import { accountHash, prHash, operationFingerprint, brasiliaDay } from '../lib/sync/keys.js';
import { motivoDe } from '../lib/sync/errors.js';

const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const coordinator = await import('../lib/sync/coordinator.js');
const { textoBloqueio } = await import('../lib/format.js');
const { admit, createHandle, noopHandle, preflightManual, registrarRecibo } = coordinator;

const TOKEN = 'tok-ok';
const AGORA = 1_800_000_000_000;
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const PR_KEY = 'Org/Repo#7';
const IDS = { uid: 'u1', accountHash: accountHash('Eu'), prHash: prHash(PR_KEY) };
const FP = operationFingerprint('review', HEAD);
let fake;

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => {
  await fake.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; });

function cliente() {
  return createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: TOKEN }) });
}

function motor(extra = {}) {
  const rt = {
    status: 'conectado', lastError: null, uid: 'u1', email: '', deviceId: 'dEu', deviceName: 'Notebook',
    client: cliente(), tokenSource: null, skewMs: 0,
    devices: { dEu: { name: 'Notebook', lastSeenAt: AGORA }, dOutro: { name: 'Desktop', lastSeenAt: AGORA } },
    leasesVistos: {}, recibosVistos: {}, espera: {}, relogio: AGORA,
  };
  rt.agora = () => rt.relogio;
  const engine = {
    config: { sync: { enabled: true, coordination: { enabled: true }, consolidation: { enabled: false } } },
    sync: rt, logs: [], seen: new Set(), cancelados: [], reviewStates: [],
    log(level, msg) { this.logs.push([level, msg]); },
    markSeen(k) { this.seen.add(k); },
    cancelSession(id) { this.cancelados.push(id); },
    async myReviewStates() { return this.reviewStates; },
    accountForPr: (pr) => pr.account || 'eu',
    async headSha() { return HEAD; },
  };
  return Object.assign(engine, extra);
}

function ctxDe(extra = {}) {
  const pr = { key: PR_KEY, url: 'https://github.com/Org/Repo/pull/7', repo: 'Org/Repo', number: 7, author: 'autor', account: 'Eu' };
  return {
    prKey: PR_KEY, account: 'Eu', materialVersion: HEAD, headSha: HEAD, contaRodada: false, manual: false,
    semCoordenacao: false, ignorarRecibo: false, pr, operationKind: 'review', opId: 'a-1', ...extra,
  };
}

function reciboDe(extra = {}) {
  return {
    operationKind: 'review', materialVersion: HEAD, deviceId: 'dOutro', leaseId: 'LO', completedAt: AGORA - 1000,
    lastVerifiedAt: AGORA - 1000, expiresAt: AGORA + SYNC.RECEIPT_TTL_MS, outcome: 'completed',
    publicationState: 'published', reviewId: '', farolVersion: '9.9.9', ...extra,
  };
}

function usuario() {
  const t = fake.tree();
  return (t && t.users && t.users.u1) || {};
}

function leaseNoBanco() {
  const l = usuario().leases;
  return l && l[IDS.accountHash] && l[IDS.accountHash][IDS.prHash];
}

function reciboNoBanco() {
  const r = usuario().receipts;
  return r && r[IDS.accountHash] && r[IDS.accountHash][IDS.prHash] && r[IDS.accountHash][IDS.prHash][FP];
}

function semearRecibo(recibo) {
  fake.setTree({ users: { u1: { receipts: { [IDS.accountHash]: { [IDS.prHash]: { [FP]: recibo } } } } } });
}

function semearLease(lease) {
  fake.setTree({ users: { u1: { leases: { [IDS.accountHash]: { [IDS.prHash]: lease } } } } });
}

function leaseDoOutro() {
  return { leaseId: 'LO', deviceId: 'dOutro', operationKind: 'review', headSha: HEAD, acquiredAt: AGORA - 5000, heartbeatAt: AGORA - 5000, expiresAt: AGORA + 60_000, farolVersion: '9.9.9' };
}

async function ate(cond, limite = 2000) {
  const inicio = Date.now();
  while (!cond()) {
    if (Date.now() - inicio > limite) throw new Error('condição não chegou a tempo');
    await new Promise((r) => setTimeout(r, 5));
  }
}

test('noopHandle segue o contrato e não faz nada', async () => {
  const h = noopHandle();
  assert.equal(h.noop, true);
  assert.equal(h.leaseId, '');
  assert.equal(h.attemptId, '');
  assert.equal(h.lost, false);
  assert.equal(h.done, true);
  h.onLost(() => { throw new Error('nunca chamado'); });
  assert.deepEqual(await h.complete({ publicationState: 'published' }), { ok: true });
  assert.equal(await h.abort(), undefined);
});

test('coordenação desligada: admite com handle noop sem tocar a rede', async () => {
  const e = motor();
  e.config.sync.coordination.enabled = false;
  e.sync.client = null;
  const a = await admit(e, ctxDe());
  assert.equal(a.admitted, true);
  assert.equal(a.handle.noop, true);
  assert.equal(fake.requests.length, 0);
});

test('semCoordenacao confirmado no clique: admite noop e registra INFO no log', async () => {
  const e = motor();
  e.sync.status = 'erro';
  const a = await admit(e, ctxDe({ manual: true, semCoordenacao: true }));
  assert.equal(a.admitted, true);
  assert.equal(a.handle.noop, true);
  assert.deepEqual(e.logs, [['INFO', `${PR_KEY}: gate de coordenação contornado por decisão manual`]]);
  assert.equal(fake.requests.length, 0);
});

test('semCoordenacao sem clique manual não é honrado: override é só do clique', async () => {
  const e = motor();
  e.sync.status = 'erro';
  const a = await admit(e, ctxDe({ manual: false, semCoordenacao: true }));
  assert.equal(a.admitted, false);
  assert.equal(a.reason, 'indisponivel');
  assert.deepEqual(e.logs, []);
});

test('runtime fora de conectado: indisponivel com o motivo do último erro, sem rede', async () => {
  const e = motor();
  e.sync.status = 'erro';
  e.sync.lastError = { code: 'timeout', motivo: 'x', at: 1 };
  const a = await admit(e, ctxDe());
  assert.deepEqual(a, { admitted: false, reason: 'indisponivel', detail: { motivo: motivoDe('timeout') } });
  e.sync.status = 'conectando';
  e.sync.lastError = null;
  const b = await admit(e, ctxDe());
  assert.deepEqual(b.detail, { motivo: motivoDe('indisponivel') });
  assert.equal(fake.requests.length, 0);
});

test('versão material vazia: indisponivel, a coordenação exige saber o que foi analisado', async () => {
  const a = await admit(motor(), ctxDe({ materialVersion: '' }));
  assert.deepEqual(a, { admitted: false, reason: 'indisponivel', detail: { motivo: 'head do PR desconhecido; a coordenação exige a versão material' } });
  assert.equal(fake.requests.length, 0);
});

test('chave de PR fora do formato: indisponivel sem tocar a rede', async () => {
  const a = await admit(motor(), ctxDe({ prKey: 'sem-formato' }));
  assert.equal(a.admitted, false);
  assert.equal(a.reason, 'indisponivel');
  assert.equal(fake.requests.length, 0);
});

test('recibo válido de outro aparelho: recusa com o nome dele, marca o PR como visto e não pega lease', async () => {
  semearRecibo(reciboDe());
  const e = motor();
  const a = await admit(e, ctxDe());
  assert.equal(a.admitted, false);
  assert.equal(a.reason, 'recibo');
  assert.equal(a.detail.deviceName, 'Desktop');
  assert.equal(a.detail.local, false, 'o Desktop não é este aparelho');
  assert.equal(a.detail.receipt.deviceId, 'dOutro');
  assert.ok(e.seen.has(PR_KEY), 'review com recibo vira visto: o PR não volta a disparar');
  assert.deepEqual(e.sync.recibosVistos[PR_KEY], {
    at: AGORA - 1000, deviceId: 'dOutro', deviceName: 'Desktop', publicationState: 'published', operationKind: 'review', orfao: 'ativo',
  });
  assert.equal(leaseNoBanco(), undefined, 'nenhum lease foi adquirido');
});

test('recibo vencido não bloqueia', async () => {
  semearRecibo(reciboDe({ expiresAt: AGORA }));
  const e = motor();
  const a = await admit(e, ctxDe());
  assert.equal(a.admitted, true);
  await a.handle.abort();
});

test('recibo de autoanálise não marca o PR como visto (seen é da revisão)', async () => {
  const fpSelf = operationFingerprint('self', HEAD);
  fake.setTree({ users: { u1: { receipts: { [IDS.accountHash]: { [IDS.prHash]: { [fpSelf]: reciboDe({ operationKind: 'self' }) } } } } } });
  const e = motor();
  const a = await admit(e, ctxDe({ operationKind: 'self' }));
  assert.equal(a.reason, 'recibo');
  assert.equal(e.seen.has(PR_KEY), false);
});

test('ignorarRecibo confirmado no clique atravessa o recibo e o preflight do GitHub', async () => {
  semearRecibo(reciboDe());
  const e = motor();
  e.reviewStates = ['APPROVED'];
  const a = await admit(e, ctxDe({ manual: true, ignorarRecibo: true }));
  assert.equal(a.admitted, true);
  assert.equal(leaseNoBanco().leaseId, a.handle.leaseId);
  await a.handle.abort();
});

test('preflight do GitHub com APPROVED meu no head: recibo externo gravado e recusa', async () => {
  const e = motor();
  e.reviewStates = ['COMMENTED', 'APPROVED'];
  let pedido = null;
  e.myReviewStates = async (pr, head) => { pedido = { pr, head }; return e.reviewStates; };
  const a = await admit(e, ctxDe());
  assert.deepEqual(a, { admitted: false, reason: 'recibo', detail: { externo: true } });
  assert.equal(pedido.head, HEAD);
  assert.equal(pedido.pr.key, PR_KEY);
  const r = reciboNoBanco();
  assert.equal(r.outcome, 'external_review');
  assert.equal(r.publicationState, 'published');
  assert.equal(r.leaseId, '');
  assert.equal(r.deviceId, 'dEu');
  assert.ok(e.seen.has(PR_KEY));
  assert.equal(leaseNoBanco(), undefined);
});

test('preflight do GitHub só com COMMENTED não é desfecho: admite', async () => {
  const e = motor();
  e.reviewStates = ['COMMENTED', 'DISMISSED'];
  const a = await admit(e, ctxDe());
  assert.equal(a.admitted, true);
  await a.handle.abort();
});

test('myReviewStates null (não deu para consultar) NÃO bloqueia', async () => {
  const e = motor();
  e.reviewStates = null;
  const a = await admit(e, ctxDe());
  assert.equal(a.admitted, true);
  assert.equal(reciboNoBanco(), undefined);
  await a.handle.abort();
});

test('myReviewStates que lança também não bloqueia nem derruba a admissão', async () => {
  const e = motor();
  e.myReviewStates = async () => { throw new Error('gh caiu'); };
  const a = await admit(e, ctxDe());
  assert.equal(a.admitted, true);
  await a.handle.abort();
});

test('preflight do GitHub não roda fora da revisão', async () => {
  const e = motor();
  let chamou = false;
  e.myReviewStates = async () => { chamou = true; return ['APPROVED']; };
  const a = await admit(e, ctxDe({ operationKind: 'pushback', materialVersion: 'marcador-1' }));
  assert.equal(a.admitted, true);
  assert.equal(chamou, false);
  await a.handle.abort();
});

test('lease vivo de outro aparelho: alheio com o nome do aparelho, desde quando e o tipo da operação dele', async () => {
  semearLease(leaseDoOutro());
  const a = await admit(motor(), ctxDe());
  assert.deepEqual(a, { admitted: false, reason: 'alheio', detail: { deviceId: 'dOutro', deviceName: 'Desktop', local: false, since: AGORA - 5000, operationKind: 'review' } });
  assert.equal(leaseNoBanco().leaseId, 'LO', 'o lease do outro fica intacto');
});

test('admissão ok grava o lease deste aparelho com a versão material', async () => {
  const e = motor();
  const a = await admit(e, ctxDe());
  assert.equal(a.admitted, true);
  assert.equal(a.handle.noop, false);
  assert.equal(a.handle.lost, false);
  assert.equal(a.handle.done, false);
  const l = leaseNoBanco();
  assert.equal(l.leaseId, a.handle.leaseId);
  assert.equal(l.deviceId, 'dEu');
  assert.equal(l.operationKind, 'review');
  assert.equal(l.headSha, HEAD);
  assert.equal(l.expiresAt, AGORA + SYNC.LEASE_TTL_MS);
  await a.handle.abort();
});

test('releitura sob lease: recibo gravado por outro aparelho entre a primeira leitura e a aquisição', async () => {
  const e = motor();
  const base = e.sync.client;
  const outro = cliente();
  let intercalou = false;
  // o outro aparelho termina a mesma análise no instante em que este vai pegar o lease
  e.sync.client = {
    ...base,
    put: async (p, v, o) => {
      if (!intercalou && p.includes('/leases/')) {
        intercalou = true;
        await outro.put(`/users/u1/receipts/${IDS.accountHash}/${IDS.prHash}/${FP}`, reciboDe(), { ifMatch: 'null_etag' });
      }
      return base.put(p, v, o);
    },
  };
  const a = await admit(e, ctxDe());
  assert.equal(intercalou, true, 'o gancho rodou antes da aquisição');
  assert.equal(a.admitted, false);
  assert.equal(a.reason, 'recibo');
  assert.equal(a.detail.deviceName, 'Desktop');
  assert.equal(leaseNoBanco(), undefined, 'o lease adquirido foi liberado');
  assert.ok(e.seen.has(PR_KEY));
});

test('rodada automática com o teto do dia esgotado: esgotado e lease liberado', async () => {
  const dia = brasiliaDay(AGORA);
  const cheio = {};
  for (let i = 0; i < SYNC.DAILY_ROUNDS_MAX; i++) cheio['s' + i] = { operationFingerprint: 'f', leaseId: 'L' + i, state: 'started', reservedAt: 1, startedAt: 2, expiresAt: 3 };
  fake.setTree({ users: { u1: { dailyRounds: { [IDS.accountHash]: { [IDS.prHash]: { [dia]: { dayPolicy: SYNC.DAY_TZ, updatedAt: 1, reservations: cheio } } } } } } });
  const a = await admit(motor(), ctxDe({ contaRodada: true }));
  assert.deepEqual(a, { admitted: false, reason: 'esgotado', detail: { day: dia, started: SYNC.DAILY_ROUNDS_MAX } });
  assert.equal(leaseNoBanco(), undefined, 'lease liberado');
});

test('rodada automática com lugar: reserva iniciada com o lease e o attemptId do handle, no dia de Brasília', async () => {
  const e = motor();
  // 02:30 UTC de 11/09 ainda é 10/09 em Brasília: quem escolhe o dia é o coordenador
  e.sync.relogio = Date.UTC(2026, 8, 11, 2, 30);
  const a = await admit(e, ctxDe({ contaRodada: true }));
  assert.equal(a.admitted, true);
  assert.ok(a.handle.attemptId);
  const dias = usuario().dailyRounds[IDS.accountHash][IDS.prHash];
  assert.equal(dias['2026-09-11'], undefined, 'nunca o dia UTC');
  const dia = dias['2026-09-10'];
  assert.ok(dia, 'a reserva nasce no dia de Brasília');
  const res = dia.reservations[a.handle.attemptId];
  assert.equal(res.state, 'started');
  assert.equal(res.leaseId, a.handle.leaseId);
  assert.equal(res.operationFingerprint, FP);
  await a.handle.abort();
});

test('preflight do GitHub lento: lease e rodada nascem com o relógio da aquisição, não o do início', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const e = motor();
  // gh no teto (60s) mais a leitura do recibo no teto (15s) mais rede
  const DEMORA = 95_000;
  e.myReviewStates = async () => { e.sync.relogio += DEMORA; return []; };
  const a = await admit(e, ctxDe({ contaRodada: true }));
  assert.equal(a.admitted, true);
  const naAquisicao = AGORA + DEMORA;
  const l = leaseNoBanco();
  assert.equal(l.acquiredAt, naAquisicao);
  assert.equal(l.expiresAt, naAquisicao + SYNC.LEASE_TTL_MS);
  const res = usuario().dailyRounds[IDS.accountHash][IDS.prHash][brasiliaDay(naAquisicao)].reservations[a.handle.attemptId];
  assert.equal(res.reservedAt, naAquisicao);
  assert.equal(res.startedAt, naAquisicao);
  // a primeira batida acha o lease vivo e renova, em vez de cancelar a sessão que acabou de subir
  e.sync.relogio = naAquisicao + SYNC.HEARTBEAT_MS;
  t.mock.timers.tick(SYNC.HEARTBEAT_MS);
  await ate(() => leaseNoBanco() && leaseNoBanco().heartbeatAt === naAquisicao + SYNC.HEARTBEAT_MS);
  assert.equal(a.handle.lost, false);
  assert.deepEqual(e.cancelados, []);
  await a.handle.abort();
});

test('sem contaRodada nada é reservado no teto do dia', async () => {
  const a = await admit(motor(), ctxDe());
  assert.equal(a.handle.attemptId, '');
  assert.equal(usuario().dailyRounds, undefined);
  await a.handle.abort();
});

test('handle.complete grava o recibo, libera o lease e encerra', async () => {
  const e = motor();
  const a = await admit(e, ctxDe());
  e.sync.relogio = AGORA + 1000;
  const r = await a.handle.complete({ publicationState: 'published', reviewId: 'R1' });
  assert.deepEqual(r, { ok: true });
  const rec = reciboNoBanco();
  assert.equal(rec.outcome, 'completed');
  assert.equal(rec.publicationState, 'published');
  assert.equal(rec.reviewId, 'R1');
  assert.equal(rec.leaseId, a.handle.leaseId);
  assert.equal(rec.deviceId, 'dEu');
  assert.equal(rec.materialVersion, HEAD);
  assert.equal(rec.completedAt, AGORA + 1000);
  assert.equal(leaseNoBanco(), undefined, 'lease liberado');
  assert.equal(a.handle.done, true);
  const de_novo = await a.handle.complete({ publicationState: 'published' });
  assert.equal(de_novo.ok, false, 'complete duas vezes não grava de novo');
});

test('handle.complete sobre recibo antigo do mesmo head: sobrescreve', async () => {
  const e = motor();
  const a = await admit(e, ctxDe({ manual: true, ignorarRecibo: true }));
  // recibo antigo (refazer confirmado) já está lá quando esta sessão termina
  await cliente().put(`/users/u1/receipts/${IDS.accountHash}/${IDS.prHash}/${FP}`, reciboDe({ completedAt: AGORA - SYNC.LEASE_TTL_MS - 1, publicationState: 'failed' }), { ifMatch: 'null_etag' });
  const r = await a.handle.complete({ publicationState: 'published' });
  assert.deepEqual(r, { ok: true });
  assert.equal(reciboNoBanco().deviceId, 'dEu');
  assert.equal(reciboNoBanco().publicationState, 'published');
});

test('handle.complete com recibo recente de um sucessor: mantém o do outro', async () => {
  const e = motor();
  const a = await admit(e, ctxDe());
  await cliente().put(`/users/u1/receipts/${IDS.accountHash}/${IDS.prHash}/${FP}`, reciboDe({ completedAt: AGORA - 10 }), { ifMatch: 'null_etag' });
  const r = await a.handle.complete({ publicationState: 'published' });
  assert.equal(r.ok, true);
  assert.equal(reciboNoBanco().deviceId, 'dOutro', 'não sobrescreve o sucessor');
  assert.equal(leaseNoBanco(), undefined);
});

test('handle.abort libera o lease sem gravar recibo', async () => {
  const a = await admit(motor(), ctxDe());
  await a.handle.abort();
  assert.equal(a.handle.done, true);
  assert.equal(leaseNoBanco(), undefined);
  assert.equal(reciboNoBanco(), undefined);
  await a.handle.abort();
});

test('heartbeat renova o lease a cada HEARTBEAT_MS', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const e = motor();
  const a = await admit(e, ctxDe());
  e.sync.relogio = AGORA + SYNC.HEARTBEAT_MS;
  t.mock.timers.tick(SYNC.HEARTBEAT_MS);
  await ate(() => leaseNoBanco() && leaseNoBanco().heartbeatAt === AGORA + SYNC.HEARTBEAT_MS);
  assert.equal(leaseNoBanco().expiresAt, AGORA + SYNC.HEARTBEAT_MS + SYNC.LEASE_TTL_MS);
  assert.equal(a.handle.lost, false);
  await a.handle.abort();
});

test('heartbeat recusado (outro aparelho tomou o lease): lost, onLost, cancela a sessão e complete não grava', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const e = motor();
  const a = await admit(e, ctxDe());
  const perdas = [];
  a.handle.onLost(() => perdas.push('cb1'));
  a.handle.onLost(() => { throw new Error('consumidor com defeito'); });
  a.handle.onLost(() => perdas.push('cb3'));
  semearLease(leaseDoOutro());
  t.mock.timers.tick(SYNC.HEARTBEAT_MS);
  await ate(() => a.handle.lost);
  assert.deepEqual(perdas, ['cb1', 'cb3'], 'cada cb roda, e um que lança não impede os outros');
  assert.deepEqual(e.cancelados, ['a-1'], 'a sessão do opId é cancelada');
  const tardio = [];
  a.handle.onLost(() => tardio.push('tarde'));
  assert.deepEqual(tardio, ['tarde'], 'onLost depois da perda avisa na hora');
  const r = await a.handle.complete({ publicationState: 'published' });
  assert.deepEqual(r, { ok: false, code: 'conflito', motivo: 'lease perdido; recibo não gravado' });
  assert.equal(reciboNoBanco(), undefined, 'nenhum recibo');
  assert.equal(leaseNoBanco().leaseId, 'LO', 'o lease do outro fica intacto');
  t.mock.timers.tick(SYNC.HEARTBEAT_MS * 3);
  await new Promise((r2) => setTimeout(r2, 20));
  assert.deepEqual(e.cancelados, ['a-1'], 'o timer parou: nada é cancelado de novo');
});

// 7.C8: perder o lease para uma TOMADA tem tratamento próprio, e ele era inalcançável.
// Medido na bancada com engines reais (17/09/2026): o aparelho tomado seguiu a sessão
// inteira até o fim, sem registrar nada, porque o batimento só declarava perda quando o
// motivo era `perdido`.
test('heartbeat depois de uma TOMADA: registra a tomada sofrida e cancela a sessão', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const e = motor();
  const a = await admit(e, ctxDe());
  semearLease({ ...leaseDoOutro(), takeoverSeq: 2, tomadoDe: 'dEu', tomadoEm: AGORA });
  t.mock.timers.tick(SYNC.HEARTBEAT_MS);
  await ate(() => a.handle.lost);
  assert.deepEqual(e.cancelados, ['a-1'], 'a sessão daqui é encerrada');
  assert.equal((e.sync.tomadasSofridas || []).length, 1, 'a tomada sofrida fica registrada');
  assert.deepEqual(e.sync.tomadasSofridas[0].para, 'dOutro');
  assert.equal(e.sync.tomadasSofridas[0].geracao, 2);
  assert.ok(e.logs.some(([nivel, msg]) => nivel === 'WARN' && /assumiu este PR/.test(msg)), 'o log diz o que houve');
});

test('heartbeat sem rede não perde o lease: espera a próxima batida', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const e = motor();
  const a = await admit(e, ctxDe());
  const base = e.sync.client;
  e.sync.client = { ...base, get: async () => ({ ok: false, code: 'indisponivel', status: 0, motivo: 'sem rede' }) };
  const h = createHandle(e, { ids: IDS, fingerprint: FP, leaseId: a.handle.leaseId, attemptId: '', ctx: ctxDe() });
  t.mock.timers.tick(SYNC.HEARTBEAT_MS);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.lost, false);
  assert.deepEqual(e.cancelados, []);
  e.sync.client = base;
  await h.abort();
  await a.handle.abort();
});

test('heartbeat sem rede por mais que o TTL: o próprio aparelho declara o lease perdido e cancela a sessão', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let rede = true;
  let semRede = 0;
  // a queda é do token (getIdToken falha antes de qualquer fetch), como numa partição real
  const client = createRtdbClient({
    databaseUrl: fake.url,
    getIdToken: async () => {
      if (rede) return { ok: true, idToken: TOKEN };
      semRede++;
      return { ok: false, code: 'indisponivel', motivo: 'sem rede' };
    },
  });
  const a = motor();
  a.sync.client = client;
  const adm = await admit(a, ctxDe());
  assert.equal(adm.admitted, true);
  const perdas = [];
  adm.handle.onLost(() => perdas.push('perdeu'));
  rede = false;
  const batidas = SYNC.LEASE_TTL_MS / SYNC.HEARTBEAT_MS;
  for (let i = 1; i <= batidas; i++) {
    a.sync.relogio = AGORA + i * SYNC.HEARTBEAT_MS;
    t.mock.timers.tick(SYNC.HEARTBEAT_MS);
    await ate(() => semRede === i);
    await new Promise((r) => setTimeout(r, 10));
    if (i < batidas) assert.equal(adm.handle.lost, false, `batida ${i}: ainda dentro da validade, rede fora não encerra`);
  }
  assert.equal(adm.handle.lost, true, 'validade local vencida: perdido mesmo sem conseguir ler o banco');
  assert.deepEqual(a.cancelados, ['a-1'], 'a sessão é cancelada');
  assert.deepEqual(perdas, ['perdeu']);
  // outro aparelho assume o lease vencido, e só um dos dois segue rodando
  const b = motor({ cancelados: [] });
  b.sync.deviceId = 'dOutro';
  b.sync.relogio = AGORA + SYNC.LEASE_TTL_MS;
  const admB = await admit(b, ctxDe({ opId: 'b-1' }));
  assert.equal(admB.admitted, true);
  const r = await adm.handle.complete({ publicationState: 'published' });
  assert.deepEqual(r, { ok: false, code: 'conflito', motivo: 'lease perdido; recibo não gravado' });
  assert.equal(reciboNoBanco(), undefined, 'a sessão perdida não grava recibo');
  await admB.handle.abort();
});

test('registrarRecibo guarda o recibo visto para a tela e marca seen só na revisão', () => {
  const e = motor();
  registrarRecibo(e, ctxDe(), reciboDe({ publicationState: 'pending', completedAt: AGORA - SYNC.ORPHAN_AFTER_MS }));
  assert.equal(e.sync.recibosVistos[PR_KEY].orfao, 'ativo', 'aparelho visto agora: não é órfão');
  assert.ok(e.seen.has(PR_KEY));
  const e2 = motor();
  registrarRecibo(e2, ctxDe({ operationKind: 'pushback' }), reciboDe({ operationKind: 'pushback' }));
  assert.equal(e2.seen.size, 0, 'pushback: quem avança o marcador é o chamador');
  assert.equal(e2.sync.recibosVistos[PR_KEY].operationKind, 'pushback');
});

const PR = { key: PR_KEY, url: 'https://github.com/Org/Repo/pull/7', repo: 'Org/Repo', number: 7, account: 'Eu' };

function soLeituras() {
  return fake.requests.every((q) => q.method === 'GET');
}

test('preflightManual: coordenação desligada é ok sem rede', async () => {
  const e = motor();
  e.config.sync.coordination.enabled = false;
  assert.deepEqual(await preflightManual(e, PR), { ok: true });
  assert.equal(fake.requests.length, 0);
});

test('preflightManual: fora de conectado é indisponivel', async () => {
  const e = motor();
  e.sync.status = 'sem-credencial';
  const r = await preflightManual(e, PR);
  assert.deepEqual(r, { ok: false, reason: 'indisponivel', detail: { motivo: motivoDe('indisponivel') } });
});

test('preflightManual: head desconhecido é indisponivel', async () => {
  const e = motor();
  e.headSha = async () => '';
  const r = await preflightManual(e, PR);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'indisponivel');
});

test('preflightManual: recibo existente é recibo, sem escrever e sem marcar seen', async () => {
  semearRecibo(reciboDe());
  const e = motor();
  const r = await preflightManual(e, PR);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'recibo');
  assert.equal(r.detail.deviceName, 'Desktop');
  assert.ok(soLeituras(), 'nunca escreve');
  assert.equal(e.seen.size, 0);
});

test('preflightManual: lease vivo de outro aparelho é alheio, sem adquirir', async () => {
  semearLease(leaseDoOutro());
  const r = await preflightManual(motor(), PR);
  assert.deepEqual(r, { ok: false, reason: 'alheio', detail: { deviceId: 'dOutro', deviceName: 'Desktop', local: false, since: AGORA - 5000, operationKind: 'review' } });
  assert.ok(soLeituras());
});

// M1: accountHash('') devolve hash válido, então conta vazia coordenaria num namespace
// só deste aparelho, e o aparelho que sabe a conta, em outro: os dois se dariam por
// sozinhos no mesmo PR e no mesmo head.
test('conta vazia é indisponivel com motivo próprio, nos dois caminhos, sem tocar a rede', async () => {
  const e = motor();
  const a = await admit(e, ctxDe({ account: '   ' }));
  assert.equal(a.admitted, false);
  assert.equal(a.reason, 'indisponivel');
  assert.match(a.detail.motivo, /conta dona do PR desconhecida/);
  assert.equal(fake.requests.length, 0, 'recusa antes de qualquer chamada ao banco');

  const e2 = motor({ accountForPr: () => '' });
  const r = await preflightManual(e2, { key: PR_KEY, url: PR.url, repo: 'Org/Repo', number: 7 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'indisponivel');
  assert.match(r.detail.motivo, /conta dona do PR desconhecida/);
  assert.equal(fake.requests.length, 0);
});

// M2: sem o release, o PR ficava travado para os outros aparelhos até o TTL do lease,
// por causa de uma sessão que nem chegou a começar.
test('exceção depois de adquirir o lease libera o lease antes de virar indisponivel', async () => {
  const e = motor();
  // defeito na camada das rodadas, que só é tocada DEPOIS do lease
  const base = e.sync.client;
  const explode = (metodo) => async (caminho, ...resto) => {
    if (String(caminho).includes('dailyRounds')) throw new Error('defeito na reserva da rodada');
    return base[metodo](caminho, ...resto);
  };
  e.sync.client = { ...base, get: explode('get'), put: explode('put') };
  const r = await admit(e, ctxDe({ contaRodada: true }));
  assert.equal(r.admitted, false);
  assert.equal(r.reason, 'indisponivel');
  assert.match(r.detail.motivo, /falha interna da coordenação/);
  assert.equal(leaseNoBanco(), undefined, 'o lease adquirido não pode ficar para trás');
});

// M3: sem esta distinção o preflight nomeava o PRÓPRIO aparelho como "outro" e a tela
// mandava esperar por si mesmo. Quem evita a análise em dobro aqui é o enqueueHeadless.
test('preflightManual: lease vivo do PRÓPRIO aparelho não bloqueia o clique', async () => {
  semearLease({ ...leaseDoOutro(), leaseId: 'LEu', deviceId: 'dEu' });
  const r = await preflightManual(motor(), PR);
  assert.deepEqual(r, { ok: true });
  assert.ok(soLeituras());
});

test('preflightManual: livre é ok, sem reservar nem escrever nada', async () => {
  const r = await preflightManual(motor(), PR);
  assert.deepEqual(r, { ok: true });
  assert.ok(soLeituras());
  assert.equal(fake.tree(), null);
});

test('fachadas da Engine: syncAdmit e syncPreflightManual delegam ao coordenador', async () => {
  const { Engine } = await import('../server.js');
  const engine = new Engine();
  engine.log = () => {};
  const a = await engine.syncAdmit(ctxDe());
  assert.equal(a.admitted, true, 'recurso desligado por padrão: admite');
  assert.equal(a.handle.noop, true);
  assert.deepEqual(await engine.syncPreflightManual(PR), { ok: true });
});

/* ---------- 20/09/2026: o aviso não descreve em terceira pessoa a máquina de quem lê ----
   A queixa, com print: "este commit já foi analisado por o aparelho Windows Predator i9
   4070", lido NO Windows Predator i9 4070. `nomeDoDispositivo` devolvia o nome do próprio
   aparelho sem dizer que era o próprio, e o texto embrulhava esse nome como terceiro.
   `alheioDeVerdade` já protegia o motivo `alheio`; o `recibo` nunca teve guarda. */

test('recibo DESTE aparelho: a recusa diz que é local, e o aviso fala em primeira pessoa', async () => {
  semearRecibo(reciboDe({ deviceId: 'dEu' }));
  const e = motor();
  const a = await admit(e, ctxDe());
  assert.equal(a.reason, 'recibo');
  assert.equal(a.detail.local, true, 'o recibo é deste aparelho, e o aviso precisa saber disso');
  assert.equal(a.detail.deviceName, 'Notebook', 'o nome continua vindo, para quem quiser mostrá-lo');
  const texto = textoBloqueio(PR_KEY, a);
  assert.match(texto, /analisado neste aparelho/);
  assert.equal(texto.includes('Notebook'), false, 'a máquina em que a tela está aberta não é "o aparelho Notebook"');
  assert.equal(texto.includes('por o aparelho'), false);
});

test('recibo de outro aparelho: o aviso nomeia, com a crase certa', async () => {
  semearRecibo(reciboDe());
  const e = motor();
  const a = await admit(e, ctxDe());
  assert.match(textoBloqueio(PR_KEY, a), /analisado pelo aparelho Desktop/);
});
