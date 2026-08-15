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

const { inlineFallbackPayload } = require('../lib/engine/decision.js');

// O 422 do GitHub não distingue âncora de LINHA inválida de âncora de HEAD inválida. Se o
// retry reenviasse o mesmo commit_id, um 422 causado pelo próprio sha falharia idêntico e o
// review não sairia de jeito nenhum. O fallback larga a âncora de propósito: perde a
// precisão do head (o dedup do ciclo seguinte lê o review como do head novo) e mantém a
// entrega do conteúdo, que é o que ainda dá pra salvar nesse ponto.
test('fallback de inline: o payload regravado NÃO leva commit_id (o 422 pode ser do próprio sha)', () => {
  const fb = inlineFallbackPayload({
    event: 'REQUEST_CHANGES',
    body: 'o redirect não fechou',
    comments: [{ path: 'src/a.js', line: 4, side: 'RIGHT', body: 'aqui' }],
    commit_id: 'a'.repeat(40)
  });
  assert.equal('commit_id' in fb, false, 'reenviar o mesmo sha repetiria o 422');
  assert.deepEqual(fb.comments, [], 'os inlines recuam pro corpo');
  assert.match(fb.body, /src\/a\.js:4/, 'o achado não pode se perder no recuo');
});

test('fallback de inline: o payload normalizado do fallback sai sem âncora de head', () => {
  const fb = inlineFallbackPayload({
    event: 'REQUEST_CHANGES', body: 'x',
    comments: [{ path: 'a.js', line: 1, side: 'RIGHT', body: 'y' }],
    commit_id: 'a'.repeat(40)
  });
  const r = normalizeReviewPayload(fb);
  assert.equal(r.ok, true);
  assert.equal('commit_id' in r.value, false, 'é o value do normalize que vira o arquivo do --input');
});
