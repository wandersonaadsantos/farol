// Exercita tela, modal e API reais com DOM mínimo e transporte substituído.
// Verifica o estado do botão; não prova layout nem instalação no sistema.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom } from './helpers/dom-stub.js';

instalarDom();
const createElement = document.createElement;
document.createElement = tag => {
  const element = createElement(tag);
  const children = new Map();
  element.querySelector = selector => {
    if (!children.has(selector)) children.set(selector, createElement('button'));
    return children.get(selector);
  };
  return element;
};
const { definirEstado } = await import('../ui/telas/estado.js');
const { renderUpdate } = await import('../ui/telas/sistema-atualizacao.js');

test('botão indica preparação, bloqueia repetição e libera nova tentativa após falha ou agendamento', async () => {
  definirEstado({ config: {}, update: { channel: 'remote', available: true, current: '1.0.0', sourceVersion: '2.0.0', repo: 'owner/farol' } });
  let requests = 0;
  let respond;
  globalThis.fetch = async (url) => {
    requests++;
    assert.equal(url, '/api/update');
    return new Promise(resolve => { respond = body => resolve({ json: async () => body }); });
  };
  for (const result of [{ ok: false, error: 'download interrompido' }, { ok: false, queued: true }, { ok: true }]) {
    renderUpdate();
    const pending = document.querySelector('#btnUpdateNow').onclick();
    const modal = document.body.children.at(-1);
    assert.match(modal.innerHTML, /instalador completo/);
    modal.querySelector('.modal-ok').onclick();
    await new Promise(setImmediate);
    assert.match(document.querySelector('#updateBox').innerHTML, /disabled aria-busy="true"/);
    assert.match(document.querySelector('#updateBox').innerHTML, /Preparando atualização/);
    renderUpdate(); // o SSE redesenha a tela durante o download
    const count = requests;
    await document.querySelector('#btnUpdateNow').onclick();
    assert.equal(requests, count);
    respond(result);
    await pending;
    if (!result.ok) assert.doesNotMatch(document.querySelector('#updateBox').innerHTML, /disabled/);
    else assert.match(document.querySelector('#updateBox').innerHTML, /disabled/);
  }
  assert.equal(requests, 3);
});
