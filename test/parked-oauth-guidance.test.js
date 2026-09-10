import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parkedParaUi } from '../lib/engine/review.js';
import { parkedNoteHtml } from '../ui/pure.js';

const OAUTH = 'Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue. (após 2 tentativa(s) de reconexão com a API)';
const project = (motivo, tipo) => parkedParaUi({
  autoReviewParked: new Set(['acme/app#1']),
  parkedMotivos: { 'acme/app#1': { at: '', motivo, tipo } },
})['acme/app#1'];

test('OAuth expirado orienta renovar o perfil, inclusive no estacionamento antigo por retries', () => {
  for (const tipo of ['falha', 'esgotado']) {
    const info = project(OAUTH, tipo);
    assert.equal(info.tipo, 'autenticacao');
    const html = parkedNoteHtml(info);
    assert.match(html, /renove o login do perfil/i);
    assert.match(html, /Plano e chaves/);
    assert.match(html, /antes de clicar em Revisar/);
    assert.doesNotMatch(html, /várias vezes seguidas/);
  }
});

test('orientação de login não substitui cancelamento nem atribui 401 genérico a OAuth', () => {
  assert.equal(project(OAUTH, 'cancelado').tipo, 'cancelado');
  assert.equal(project('API Error: 401 Unauthorized', 'falha').tipo, 'falha');
  assert.equal(project('fetch failed', 'esgotado').tipo, 'esgotado');
});
