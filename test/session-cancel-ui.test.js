import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom } from './helpers/dom-stub.js';
import { sessionCardHtml } from '../ui/pure/sessao.js';

const { doc } = instalarDom();
const criar = doc.createElement;
// Guarda os controles da modal para exercitar os handlers reais, sem substituir
// confirmModal nem api. Este DOM não verifica layout ou comportamento do navegador.
doc.createElement = tag => {
  const el = criar(tag);
  const controles = new Map();
  el.querySelector = sel => {
    if (!controles.has(sel)) controles.set(sel, criar('button'));
    return controles.get(sel);
  };
  return el;
};
let clique;
doc.querySelector('#activeSessions').addEventListener = (tipo, fn) => { if (tipo === 'click') clique = fn; };
await import('../ui/telas/acoes.js');
const { renderActive } = await import('../ui/telas/sessoes.js');
const { definirEstado } = await import('../ui/telas/estado.js');

function iniciar(resposta = { ok: true }) {
  const pedidos = [];
  doc.querySelector('#toasts').children = [];
  globalThis.fetch = async (url, opts) => {
    pedidos.push({ url, body: JSON.parse(opts.body) });
    if (resposta instanceof Error) throw resposta;
    return { json: async () => resposta };
  };
  const btn = { dataset: { id: 'review-1' }, disabled: false, textContent: 'Cancelar' };
  const fim = clique({ target: { closest: () => btn } });
  const modal = doc.body.children.find(el => el.className === 'modal-overlay');
  assert.ok(modal, 'o clique abre a modal real antes do POST');
  assert.equal(pedidos.length, 0);
  assert.match(modal.innerHTML, /Continuar sessão/);
  return { pedidos, btn, fim, modal };
}

test('desistir na modal mantém o review e reabilita o botão', async () => {
  const c = iniciar();
  c.modal.querySelector('.modal-cancel').onclick();
  await c.fim;
  assert.equal(c.pedidos.length, 0);
  assert.equal(c.btn.disabled, false);
  assert.equal(c.btn.textContent, 'Cancelar');
});

test('confirmar envia o id correto e mostra cancelamento solicitado', async () => {
  const c = iniciar();
  c.modal.querySelector('.modal-ok').onclick();
  await c.fim;
  assert.deepEqual(c.pedidos, [{ url: '/api/cancel', body: { id: 'review-1' } }]);
  assert.equal(c.btn.disabled, true);
  assert.equal(c.btn.textContent, 'Cancelando…');
  assert.match(doc.querySelector('#toasts').children.at(-1).textContent, /Cancelamento solicitado/);
});

test('erro do servidor ou rede aparece e permite tentar novamente', async () => {
  for (const resposta of [{ ok: false, error: 'sessão já terminou' }, new Error('rede')]) {
    const c = iniciar(resposta);
    c.modal.querySelector('.modal-ok').onclick();
    await c.fim;
    assert.equal(c.btn.disabled, false);
    assert.equal(c.btn.textContent, 'Cancelar');
    const aviso = doc.querySelector('#toasts').children.at(-1);
    assert.match(aviso.className, /error/);
    assert.match(aviso.textContent, /sessão já terminou|Não consegui cancelar/);
  }
});

test('clique repetido durante a confirmação não duplica modal ou pedido', async () => {
  const c = iniciar();
  const outro = { ...c.btn, disabled: false };
  await clique({ target: { closest: () => outro } });
  assert.equal(doc.body.children.filter(el => el.className === 'modal-overlay').length, 1);
  c.modal.querySelector('.modal-ok').onclick();
  await c.fim;
  assert.equal(c.pedidos.length, 1);
});

test('atualização do estado mantém Cancelando e remove ação quando o envio começou', () => {
  const html = sessionCardHtml({ id: 'r1', cancellable: true, cancelled: true });
  assert.match(html, /data-id="r1" disabled>Cancelando…/);
  assert.doesNotMatch(sessionCardHtml({ id: 'r1', cancellable: false }), /act-cancel/);
});

test('snapshots atualizam o botão do cartão já montado sem recriar o cartão', () => {
  const box = doc.querySelector('#activeSessions');
  const original = box.querySelector;
  const btn = { disabled: false, hidden: false, textContent: 'Cancelar' };
  const card = doc.createElement('div');
  box.querySelector = sel => sel.startsWith('.act-cancel') ? btn : card;
  try {
    const sessao = { id: 'r1', mode: 'auto', cancellable: true, startedAt: Date.now() };
    const snapshot = { config: {}, activeSessions: [sessao], activity: {}, headlessWaiting: [], panorama: [] };
    definirEstado(snapshot);
    renderActive();
    assert.equal(btn.disabled, false);
    sessao.cancelled = true;
    renderActive();
    assert.equal(btn.disabled, true);
    assert.equal(btn.textContent, 'Cancelando…');
    sessao.cancelled = false;
    sessao.cancellable = false;
    renderActive();
    assert.equal(btn.hidden, true, 'o botão antigo some quando o servidor inicia a publicação');
  } finally { box.querySelector = original; }
});
