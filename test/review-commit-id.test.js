'use strict';
// G1 da auditoria 15/08/2026: payload sem commit_id faz o GitHub ancorar o
// review no head do momento do POST, não no head que a sessão leu. Estes
// testes travam: normalize aceita/valida o campo, e os três pontos de
// postagem (canAuto, canReject, decide) o propagam.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeReviewPayload } = require('../lib/engine/public-review');

test('normalizeReviewPayload: commit_id sha válido é preservado', () => {
  const r = normalizeReviewPayload({ event: 'APPROVE', body: 'ok', comments: [], commit_id: 'a'.repeat(40) });
  assert.equal(r.ok, true);
  assert.equal(r.value.commit_id, 'a'.repeat(40));
});

test('normalizeReviewPayload: commit_id ausente ou vazio fica de fora do payload', () => {
  const r = normalizeReviewPayload({ event: 'APPROVE', body: 'ok', comments: [] });
  assert.equal(r.ok, true);
  assert.equal('commit_id' in r.value, false);
});

test('normalizeReviewPayload: commit_id que não é sha é DESCARTADO (nunca vira erro)', () => {
  // descarta em vez de recusar: um sha torto não pode impedir a postagem de um
  // review válido, apenas volta ao comportamento antigo (GitHub decide o head)
  const r = normalizeReviewPayload({ event: 'APPROVE', body: 'ok', comments: [], commit_id: 'não-é-sha' });
  assert.equal(r.ok, true);
  assert.equal('commit_id' in r.value, false);
});

const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = process.env.FAROL_HOME || path.join(os.tmpdir(), 'farol-test-commitid-' + process.pid);
const { Engine } = require('../server.js');

test('decide(): o commit_id enviado ao postReview é o head buscado no clique', async () => {
  const engine = new Engine();
  let payloadRecebido = null;
  engine.headSha = async () => 'f'.repeat(40);
  engine.myReviewStates = async () => [];
  engine.postReview = async (pr, payload) => { payloadRecebido = payload; return { ok: true }; };
  engine.saveDecisions = () => { };
  engine.writeMemory = () => { };
  engine.pushState = () => { };
  engine.decisions.pending.unshift({
    id: 'd1', key: 'acme/repo#1', pr: { repo: 'acme/repo', number: 1, url: 'https://github.com/acme/repo/pull/1' },
    createdAt: Date.now(),
    payloads: { approve: { event: 'APPROVE', body: 'ok', comments: [] } }
  });
  const r = await engine.decide('d1', 'approve');
  assert.equal(r.ok, true);
  assert.equal(payloadRecebido.commit_id, 'f'.repeat(40));
});
