// C0, defeito 3 (spec 7.C0): recibo ficava 'pending' para sempre depois de uma postagem
// que saiu FORA da revisão automática (clique em decide, reenvio do retryFailedPosts,
// review já no PR). Outro aparelho via o recibo pendente, e passada uma semana o
// oferecia como órfão com "Refazer" pago para um PR já postado.
//
// O banco é o dublê em processo; o engine é o real, com o runtime da sincronização
// montado à mão como conectado (mesmo formato que o coordenador lê).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-publicacao-recibo-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { accountHash, prHash, operationFingerprint } from '../lib/sync/keys.js';

const { Engine } = await import('../server.js');
const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const { SYNC } = await import('../lib/constants.js');
const { buildReceipt, readReceipt, writeReceipt, receiptOrphanState, atualizarPublicacaoDoRecibo } = await import('../lib/sync/receipts.js');

const TOKEN = 'tok-ok';
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const KEY = 'Org/Repo#7';
const IDS = { uid: 'u1', accountHash: accountHash('eu'), prHash: prHash(KEY) };
const FP = operationFingerprint('review', HEAD);
const PUBLICAR = { operationKind: 'review', materialVersion: HEAD, publicationState: 'published' };
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

function reciboDe(extra = {}) {
  return buildReceipt({
    operationKind: 'review', materialVersion: HEAD, deviceId: 'dEu', leaseId: 'L1', nowMs: Date.now(),
    outcome: 'completed', publicationState: 'pending', reviewId: '', farolVersion: '9.9.9', ...extra,
  });
}

async function gravar(extra = {}) {
  const r = reciboDe(extra);
  const w = await writeReceipt(cliente(), IDS, FP, r, { ifMatch: 'null_etag' });
  assert.equal(w.ok, true, 'o recibo de partida precisa existir no banco');
  fake.requests.length = 0;
  return r;
}

async function noBanco() {
  const r = await readReceipt(cliente(), IDS, FP);
  assert.equal(r.ok, true);
  return r.receipt;
}

const puts = () => fake.requests.filter((q) => q.method === 'PUT').length;

// --- a função de lib/sync/receipts.js ------------------------------------------------

test('atualizarPublicacaoDoRecibo: pending vira published, lastVerifiedAt novo e o resto intacto', async () => {
  const antes = await gravar();
  const r = await atualizarPublicacaoDoRecibo(cliente(), IDS, { ...PUBLICAR, nowMs: antes.completedAt + 5000 });
  assert.deepEqual(r, { ok: true, motivo: 'atualizado' });
  assert.deepEqual(await noBanco(), { ...antes, publicationState: 'published', lastVerifiedAt: antes.completedAt + 5000 });
  const put = fake.requests.find((q) => q.method === 'PUT');
  assert.ok(put.headers['if-match'] && put.headers['if-match'] !== 'null_etag', 'escrita condicionada ao etag lido');
});

// Medido em 18/09/2026 ("recibo não marcado como publicado: Permission denied" no log a cada
// postagem automática): a intenção de postar nasce ANTES do recibo, e o nó com só `postagens`
// era lido como recibo. Gravar publicationState nele vira recibo pela metade, que a regra recusa.
test('atualizarPublicacaoDoRecibo: nó só com o registro de postagem não é recibo, e nada é escrito', async () => {
  const w = await cliente().put(`/users/u1/receipts/${IDS.accountHash}/${IDS.prHash}/${FP}/postagens/APPROVE`, { estado: 'confirmada', tentativaId: 't1', intencaoEm: Date.now() }, {});
  assert.equal(w.ok, true, 'a premissa: a intenção está no banco sem recibo');
  fake.requests.length = 0;
  assert.deepEqual(await atualizarPublicacaoDoRecibo(cliente(), IDS, { ...PUBLICAR, nowMs: Date.now() }), { ok: false, motivo: 'sem-recibo' });
  assert.equal(puts(), 0);
});

test('atualizarPublicacaoDoRecibo: sem recibo não cria um, e estado já igual não escreve', async () => {
  assert.deepEqual(await atualizarPublicacaoDoRecibo(cliente(), IDS, { ...PUBLICAR, nowMs: Date.now() }), { ok: false, motivo: 'sem-recibo' });
  assert.equal(puts(), 0, 'recibo sem análise deste aparelho seria afirmação falsa');
  await gravar({ publicationState: 'published' });
  assert.deepEqual(await atualizarPublicacaoDoRecibo(cliente(), IDS, { ...PUBLICAR, nowMs: Date.now() }), { ok: true, motivo: 'inalterado' });
  assert.equal(puts(), 0);
});

test('atualizarPublicacaoDoRecibo: estado fora da lista e versão vazia recusam sem tocar a rede', async () => {
  const c = cliente();
  assert.deepEqual(await atualizarPublicacaoDoRecibo(c, IDS, { ...PUBLICAR, publicationState: 'publicado', nowMs: 1 }), { ok: false, motivo: 'estado-invalido' });
  assert.deepEqual(await atualizarPublicacaoDoRecibo(c, IDS, { ...PUBLICAR, materialVersion: '', nowMs: 1 }), { ok: false, motivo: 'versao-invalida' });
  assert.equal(fake.requests.length, 0);
});

test('atualizarPublicacaoDoRecibo: outro aparelho regravou entre a leitura e a escrita, e o dele fica', async () => {
  await gravar();
  const real = cliente();
  const doOutro = reciboDe({ deviceId: 'dOutro', publicationState: 'failed' });
  const intruso = {
    get: (...a) => real.get(...a),
    put: async (...a) => {
      fake.setTree({ users: { u1: { receipts: { [IDS.accountHash]: { [IDS.prHash]: { [FP]: doOutro } } } } } });
      return real.put(...a);
    },
  };
  assert.deepEqual(await atualizarPublicacaoDoRecibo(intruso, IDS, { ...PUBLICAR, nowMs: Date.now() }), { ok: false, motivo: 'conflito' });
  assert.equal((await noBanco()).deviceId, 'dOutro');
});

// --- o engine: invólucro e os três pontos que postam fora da revisão automática --------

const PR = { key: KEY, url: 'https://github.com/Org/Repo/pull/7', repo: 'Org/Repo', number: 7, title: 't', author: 'dev', account: 'eu' };

function motor({ coordenacao = true, states = [], postOk = true } = {}) {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.saveDecisions = () => { };
  e.writeMemory = () => { };
  e.accountForPr = () => 'eu';
  e.headSha = async () => HEAD;
  e.myReviewStates = async () => states;
  e.postados = [];
  e.postReview = async (pr, payload) => { e.postados.push(payload); return postOk ? { ok: true } : { ok: false, error: 'HTTP 503' }; };
  if (coordenacao) {
    e.config.sync = { enabled: true, coordination: { enabled: true }, consolidation: { enabled: false } };
    Object.assign(e.sync, { status: 'conectado', uid: 'u1', deviceId: 'dEu', client: cliente() });
  }
  return e;
}

function pendencia(extra = {}) {
  return {
    id: 'd-7', createdAt: Date.now(), status: 'pending', verdict: 'approve', key: KEY, pr: { ...PR }, headSha: HEAD,
    reasons: [], payloads: { approve: { event: 'APPROVE', body: 'Li com calma e está tudo certo.' } }, ...extra,
  };
}

test('syncAtualizarPublicacao: sem coordenação devolve coordenacao-desligada e não toca o banco (CT-COMPAT)', async () => {
  const e = motor({ coordenacao: false });
  const r = await e.syncAtualizarPublicacao({ account: 'eu', prKey: KEY, headSha: HEAD, operationKind: 'review', publicationState: 'published' });
  assert.deepEqual(r, { ok: false, motivo: 'coordenacao-desligada' });
  assert.equal(fake.requests.length, 0);
});

test('syncAtualizarPublicacao: sem conexão ou sem conta e head recusa sem tocar o banco', async () => {
  const e = motor();
  assert.deepEqual(await e.syncAtualizarPublicacao({ account: '', prKey: KEY, headSha: HEAD, publicationState: 'published' }), { ok: false, motivo: 'contexto-incompleto' });
  assert.deepEqual(await e.syncAtualizarPublicacao({ account: 'eu', prKey: KEY, headSha: '', publicationState: 'published' }), { ok: false, motivo: 'contexto-incompleto' });
  e.sync.status = 'erro';
  assert.deepEqual(await e.syncAtualizarPublicacao({ account: 'eu', prKey: KEY, headSha: HEAD, publicationState: 'published' }), { ok: false, motivo: 'sem-conexao' });
  assert.equal(fake.requests.length, 0);
});

test('decide com postagem ok deixa o recibo do head published, e o outro aparelho nunca o vê como órfão', async () => {
  await gravar();
  const e = motor();
  e.decisions = { pending: [pendencia()], resolved: [] };
  const r = await e.decide('d-7', 'approve');
  assert.equal(r.ok, true);
  assert.equal(e.postados.length, 1);
  const recibo = await noBanco();
  assert.equal(recibo.publicationState, 'published');
  const muitoDepois = Date.now() + 5 * SYNC.ORPHAN_AFTER_MS;
  assert.equal(receiptOrphanState(recibo, { lastSeenAt: 1 }, muitoDepois), 'ativo', 'publicado nunca vira "Refazer" pago em outro aparelho');
});

test('decide com postagem que falhou deixa o recibo como estava', async () => {
  await gravar();
  const e = motor({ postOk: false });
  e.decisions = { pending: [pendencia()], resolved: [] };
  const r = await e.decide('d-7', 'approve');
  assert.equal(r.ok, false);
  assert.equal((await noBanco()).publicationState, 'pending');
});

test('decide que acha o review já no PR (already_reviewed) também publica o recibo', async () => {
  await gravar();
  const e = motor({ states: ['APPROVED'] });
  e.decisions = { pending: [pendencia()], resolved: [] };
  const r = await e.decide('d-7', 'approve');
  assert.equal(r.ok, true);
  assert.equal(e.postados.length, 0, 'nada repostado');
  assert.equal((await noBanco()).publicationState, 'published');
});

test('retryFailedPosts que consegue postar publica o recibo que tinha ficado failed', async () => {
  await gravar({ publicationState: 'failed' });
  const e = motor();
  e.decisions = { pending: [pendencia({ postRetry: { event: 'approve', attempts: 0 } })], resolved: [] };
  assert.equal(await e.retryFailedPosts(), 1);
  assert.equal((await noBanco()).publicationState, 'published');
});

test('coordenação desligada: decide posta como sempre e nenhuma requisição vai ao banco (CT-COMPAT)', async () => {
  const e = motor({ coordenacao: false });
  e.decisions = { pending: [pendencia()], resolved: [] };
  assert.equal((await e.decide('d-7', 'approve')).ok, true);
  assert.equal(e.postados.length, 1);
  assert.equal(fake.requests.length, 0);
});
