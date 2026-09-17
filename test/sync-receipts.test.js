// lib/sync/receipts.js: o recibo que diz "esta análise deste head já foi feita". A
// escrita é CAS por ETag contra o dublê do RTDB; bloqueio e órfão são puros.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { createRtdbClient } from '../lib/sync/rtdb.js';
import { SYNC } from '../lib/constants.js';
import receipts, {
  receiptPath, receiptsPath, buildReceipt, receiptBlocks, receiptOrphanState,
  readReceipt, writeReceipt, invalidateReceipt,
} from '../lib/sync/receipts.js';

const TOKEN = 'tok-ok';
const IDS = { uid: 'u1', accountHash: 'a'.repeat(64), prHash: 'b'.repeat(64) };
const FP = 'review_' + 'c'.repeat(32);
const AGORA = 1_800_000_000_000;
let fake;

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => { await fake.close(); });
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; });

function cliente(extra = {}) {
  return createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: TOKEN }), ...extra });
}

function recibo(extra = {}) {
  return buildReceipt({
    operationKind: 'review', materialVersion: 'abc123', deviceId: 'd1', leaseId: 'L1', nowMs: AGORA,
    outcome: 'completed', publicationState: 'published', reviewId: '', farolVersion: '9.9.9', ...extra,
  });
}

function noBanco() {
  const t = fake.tree();
  return t && t.users.u1.receipts[IDS.accountHash][IDS.prHash][FP];
}

test('exporta pelo default e pelos nomes', () => {
  for (const nome of ['receiptPath', 'receiptsPath', 'buildReceipt', 'receiptBlocks', 'receiptOrphanState', 'readReceipt', 'writeReceipt', 'invalidateReceipt', 'atualizarPublicacaoDoRecibo']) {
    assert.equal(typeof receipts[nome], 'function', nome);
  }
});

test('caminhos do contrato', () => {
  assert.equal(receiptPath('u1', 'ah', 'ph', 'fp'), '/users/u1/receipts/ah/ph/fp');
  assert.equal(receiptsPath('u1', 'ah', 'ph'), '/users/u1/receipts/ah/ph');
});

test('buildReceipt: expira em RECEIPT_TTL_MS e campos opcionais viram texto vazio', () => {
  const r = buildReceipt({
    operationKind: 'self', materialVersion: 'abc', deviceId: 'd1', leaseId: undefined, nowMs: AGORA,
    outcome: 'completed', publicationState: 'not_applicable', reviewId: undefined, farolVersion: '1.0.0',
  });
  assert.deepEqual(r, {
    operationKind: 'self', materialVersion: 'abc', deviceId: 'd1', leaseId: '',
    completedAt: AGORA, lastVerifiedAt: AGORA, expiresAt: AGORA + SYNC.RECEIPT_TTL_MS,
    outcome: 'completed', publicationState: 'not_applicable', reviewId: '', farolVersion: '1.0.0',
  });
});

test('receiptBlocks: por outcome e por expiresAt', () => {
  assert.equal(receiptBlocks(recibo(), AGORA), true);
  assert.equal(receiptBlocks(recibo({ outcome: 'external_review' }), AGORA), true);
  assert.equal(receiptBlocks(recibo({ outcome: 'cancelado' }), AGORA), false, 'outcome fora da lista não bloqueia');
  assert.equal(receiptBlocks({ ...recibo(), expiresAt: AGORA }, AGORA), false, 'vencido no instante não bloqueia');
  assert.equal(receiptBlocks({ ...recibo(), expiresAt: AGORA + 1 }, AGORA), true);
  assert.equal(receiptBlocks({ ...recibo(), expiresAt: null }, AGORA), false);
  assert.equal(receiptBlocks(null, AGORA), false);
  assert.equal(receiptBlocks('x', AGORA), false);
  assert.equal(receiptBlocks([recibo()], AGORA), false);
});

const VELHO = AGORA - SYNC.ORPHAN_AFTER_MS;
const DIA = 86_400_000;

test('receiptOrphanState: pending de aparelho parado há uma semana é órfão', () => {
  const r = recibo({ publicationState: 'pending', nowMs: VELHO });
  assert.equal(receiptOrphanState(r, { lastSeenAt: VELHO }, AGORA), 'orfao');
  assert.equal(receiptOrphanState(recibo({ publicationState: 'failed', nowMs: VELHO }), { lastSeenAt: VELHO }, AGORA), 'orfao');
});

test('receiptOrphanState: aparelho visto recentemente é ativo', () => {
  const r = recibo({ publicationState: 'pending', nowMs: VELHO });
  assert.equal(receiptOrphanState(r, { lastSeenAt: AGORA - 1000 }, AGORA), 'ativo');
});

test('receiptOrphanState: recibo recente de aparelho antigo NÃO é órfão', () => {
  const r = recibo({ publicationState: 'pending', nowMs: AGORA - 1000 });
  assert.equal(receiptOrphanState(r, { lastSeenAt: VELHO - DIA }, AGORA), 'ativo');
});

test('receiptOrphanState: falta de dado é desconhecido, nunca órfão', () => {
  const r = recibo({ publicationState: 'pending', nowMs: VELHO });
  assert.equal(receiptOrphanState(r, null, AGORA), 'desconhecido', 'aparelho sumido do banco');
  assert.equal(receiptOrphanState(r, {}, AGORA), 'desconhecido', 'lastSeenAt ausente');
  assert.equal(receiptOrphanState(r, { lastSeenAt: 'ontem' }, AGORA), 'desconhecido');
  assert.equal(receiptOrphanState(r, { lastSeenAt: AGORA + 1 }, AGORA), 'desconhecido', 'lastSeenAt no futuro');
  assert.equal(receiptOrphanState({ ...r, completedAt: undefined }, { lastSeenAt: VELHO }, AGORA), 'desconhecido');
});

test('receiptOrphanState: publicado ou sem publicação nunca é órfão', () => {
  for (const publicationState of ['published', 'not_applicable']) {
    const r = recibo({ publicationState, nowMs: VELHO - DIA });
    assert.equal(receiptOrphanState(r, { lastSeenAt: VELHO - DIA }, AGORA), 'ativo', publicationState);
  }
});

test('readReceipt: vazio devolve null com null_etag; gravado devolve o recibo e o etag', async () => {
  const c = cliente();
  const vazio = await readReceipt(c, IDS, FP);
  assert.deepEqual(vazio, { ok: true, receipt: null, etag: 'null_etag' });
  await writeReceipt(c, IDS, FP, recibo(), { ifMatch: 'null_etag' });
  const lido = await readReceipt(c, IDS, FP);
  assert.equal(lido.ok, true);
  assert.equal(lido.receipt.deviceId, 'd1');
  assert.match(lido.etag, /^[0-9a-f]{40}$/);
});

test('writeReceipt com null_etag grava no nó vazio', async () => {
  const w = await writeReceipt(cliente(), IDS, FP, recibo(), { ifMatch: 'null_etag' });
  assert.deepEqual(w, { ok: true });
  assert.equal(noBanco().outcome, 'completed');
  assert.equal(fake.requests.at(-1).headers['if-match'], 'null_etag');
});

test('writeReceipt sem ifMatch nunca escreve às cegas: vale null_etag', async () => {
  await writeReceipt(cliente(), IDS, FP, recibo({ deviceId: 'dOutro' }), { ifMatch: 'null_etag' });
  const w = await writeReceipt(cliente(), IDS, FP, recibo({ deviceId: 'dEu' }), {});
  assert.equal(w.ok, false);
  assert.equal(w.code, 'conflito');
  assert.equal(noBanco().deviceId, 'dOutro');
});

test('writeReceipt com 412 devolve o recibo atual e não sobrescreve', async () => {
  const c = cliente();
  await writeReceipt(c, IDS, FP, recibo({ deviceId: 'dOutro' }), { ifMatch: 'null_etag' });
  const w = await writeReceipt(c, IDS, FP, recibo({ deviceId: 'dEu' }), { ifMatch: 'null_etag' });
  assert.equal(w.ok, false);
  assert.equal(w.code, 'conflito');
  assert.equal(w.atual.deviceId, 'dOutro');
  assert.equal(noBanco().deviceId, 'dOutro');
});

test('writeReceipt com o etag lido sobrescreve', async () => {
  const c = cliente();
  await writeReceipt(c, IDS, FP, recibo({ deviceId: 'dOutro' }), { ifMatch: 'null_etag' });
  const lido = await readReceipt(c, IDS, FP);
  const w = await writeReceipt(c, IDS, FP, recibo({ deviceId: 'dEu' }), { ifMatch: lido.etag });
  assert.deepEqual(w, { ok: true });
  assert.equal(noBanco().deviceId, 'dEu');
});

test('invalidateReceipt apaga com o etag lido', async () => {
  const c = cliente();
  await writeReceipt(c, IDS, FP, recibo(), { ifMatch: 'null_etag' });
  const lido = await readReceipt(c, IDS, FP);
  assert.deepEqual(await invalidateReceipt(c, IDS, FP, { ifMatch: lido.etag }), { ok: true });
  assert.equal(fake.tree(), null);
});

test('invalidateReceipt com etag velho não apaga o recibo que outro aparelho regravou', async () => {
  const c = cliente();
  await writeReceipt(c, IDS, FP, recibo(), { ifMatch: 'null_etag' });
  const lido = await readReceipt(c, IDS, FP);
  await writeReceipt(c, IDS, FP, recibo({ deviceId: 'dOutro', nowMs: AGORA + 1 }), { ifMatch: lido.etag });
  const r = await invalidateReceipt(c, IDS, FP, { ifMatch: lido.etag });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'conflito');
  assert.equal(noBanco().deviceId, 'dOutro');
});

test('invalidateReceipt sem etag recusa sem tocar a rede', async () => {
  const r = await invalidateReceipt(cliente(), IDS, FP, {});
  assert.equal(r.ok, false);
  assert.equal(r.code, 'falha_interna');
  assert.equal(fake.requests.length, 0);
});

test('rede caída: leitura e escrita devolvem o código, sem lançar', async () => {
  const semRede = cliente({ fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  const r = await readReceipt(semRede, IDS, FP);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'indisponivel');
  assert.equal(typeof r.motivo, 'string');
  const w = await writeReceipt(semRede, IDS, FP, recibo(), { ifMatch: 'null_etag' });
  assert.equal(w.ok, false);
  assert.equal(w.code, 'indisponivel');
});

// Sem ETag não há CAS: writeReceipt cairia no 'null_etag' e invalidateReceipt não teria
// o que provar. A leitura falha, e quem chama trata como banco indisponível.
test('sem ETag na resposta, ler recibo vira resposta_invalida e nada é apagado', async () => {
  const c = cliente();
  await c.put(receiptPath('u1', IDS.accountHash, IDS.prHash, FP), recibo());
  fake.requests.length = 0;
  fake.setSemEtag(true);
  try {
    const r = await readReceipt(c, IDS, FP);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'resposta_invalida');
    assert.deepEqual(fake.requests.filter((q) => q.method === 'DELETE'), []);
    assert.ok(noBanco(), 'o recibo continua no banco');
  } finally {
    fake.setSemEtag(false);
  }
});
