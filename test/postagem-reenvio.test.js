// O reenvio da postagem que nunca desiste da falha passageira (porte do fork, 24/11/2026):
// o recuo e a lista explícita do que é permanente. A fiação mora em test/retry-failed-posts.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recuoDoReenvio, ehPermanente, proximaTentativa, devidoAgora, TENTATIVAS_RAPIDAS } from '../lib/engine/postagem-reenvio.js';

const MIN = 60_000;

test('recuo: 15 min, dobrando, com teto de seis horas', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 40].map(recuoDoReenvio), [15, 30, 60, 120, 240, 360, 360, 360].map(m => m * MIN));
  assert.equal(recuoDoReenvio(-3), 15 * MIN, 'negativo vira a primeira espera');
});

test('permanente é só a lista explícita; na dúvida, passageira', () => {
  for (const blocked of ['criterios_inconsistentes', 'pr_proprio', 'instancia_isolada', 'credencial_no_texto', 'internal_language']) {
    assert.equal(ehPermanente({ ok: false, blocked }), true, blocked);
  }
  assert.equal(ehPermanente({ ok: false, blocked: 'technical_review', error: 'violação confirmada' }), true);
  assert.equal(ehPermanente({ ok: false, blocked: 'technical_review', error: 'não foi possível reconfirmar a avaliação' }), false);
  assert.equal(ehPermanente({ ok: false, error: 'HTTP 422: repository is archived' }), true);
  assert.equal(ehPermanente({ ok: false, error: 'HTTP 422: pull request is locked' }), true);
  for (const error of ['HTTP 500', 'HTTP 503', 'HTTP 401', 'HTTP 404', 'HTTP 422: commit_id inválido', 'qualquer coisa']) {
    assert.equal(ehPermanente({ ok: false, error }), false, error);
  }
  assert.equal(ehPermanente({ ok: false, blocked: 'head_desconhecido' }), false);
  assert.equal(ehPermanente({ ok: false, semToken: true, blocked: 'pr_proprio' }), false, 'sem token passa quando o token volta');
  assert.equal(ehPermanente({ ok: true }), false);
  assert.equal(ehPermanente(null), false);
});

test('proximaTentativa: as rápidas sem recuo, depois proximaEm; permanente esgota', () => {
  const agora = 1_000_000;
  let m = { event: 'approve', attempts: 0 };
  for (let i = 1; i < TENTATIVAS_RAPIDAS; i++) {
    m = proximaTentativa(m, 'x', { agora });
    assert.equal(m.proximaEm, undefined, `tentativa ${i} é rápida`);
    assert.equal(m.exhausted, false);
  }
  m = proximaTentativa(m, 'x', { agora });
  assert.equal(m.proximaEm, agora + 15 * MIN);
  const p = proximaTentativa({ event: 'approve', attempts: 1, proximaEm: 5 }, 'y', { permanente: true, agora });
  assert.equal(p.exhausted, true);
  assert.equal(p.permanente, true);
  assert.equal(p.lastError, 'y');
});

test('devidoAgora: respeita proximaEm, ignora a permanente e aceita a marca antiga', () => {
  assert.equal(devidoAgora(null), false);
  assert.equal(devidoAgora({ attempts: 0 }), true);
  assert.equal(devidoAgora({ attempts: 4, proximaEm: 10 }, 9), false);
  assert.equal(devidoAgora({ attempts: 4, proximaEm: 10 }, 10), true);
  assert.equal(devidoAgora({ attempts: 1, exhausted: true, permanente: true }), false);
  assert.equal(devidoAgora({ attempts: 3, exhausted: true }), true, 'marca antiga, que desistia na terceira, volta');
});
