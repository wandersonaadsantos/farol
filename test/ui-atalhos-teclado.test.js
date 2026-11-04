// A, M e C no teclado agem no card selecionado do Radar. Duas travas de comportamento,
// exercitadas no handler real de keydown (ui/telas/atalhos.js) sobre o DOM de mentira:
// botão desligado não age pela tecla, e com uma modal aberta a tecla não faz nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom } from './helpers/dom-stub.js';

const { doc } = instalarDom();
const consultaOriginal = doc.querySelector.bind(doc);
let cardSelecionado = null;
// a guarda de modal pergunta ao document; aqui ela enxerga só o que foi aberto de fato
doc.querySelector = (sel) => {
  if (sel === '.modal-overlay') return doc.body.children.find(el => el.className === 'modal-overlay') || null;
  if (sel === '#decisions .decision.kbd-sel') return cardSelecionado;
  return consultaOriginal(sel);
};
doc.querySelector('#chatPanel').hidden = true;
let onKeydown;
doc.addEventListener = (tipo, fn) => { if (tipo === 'keydown' && !onKeydown) onKeydown = fn; };

const { initAtalhos } = await import('../ui/telas/atalhos.js');
initAtalhos(() => { });

function cardCom(btn) {
  const card = doc.createElement('div');
  card.dataset.id = 'dec-1';
  card.querySelector = (sel) => (sel.startsWith('.dec-act') ? btn : null);
  return card;
}
function botao(acao, disabled = false) {
  const btn = doc.createElement('button');
  btn.dataset.action = acao;
  btn.disabled = disabled;
  return btn;
}
const modais = () => doc.body.children.filter(el => el.className === 'modal-overlay');
const tecla = (key) => {
  let prevenido = false;
  onKeydown({ key, target: doc.body, preventDefault() { prevenido = true; } });
  return prevenido;
};

test('A com o botão de aprovar desligado não abre confirmação nem posta', () => {
  doc.body.children = [];
  const btn = botao('approve', true);
  cardSelecionado = cardCom(btn);
  tecla('a');
  assert.equal(modais().length, 0, 'botão desligado vale para a tecla também');
  assert.equal(btn.disabled, true);
});

test('A com o botão ligado abre a confirmação, e outra tecla com a modal aberta não faz nada', () => {
  doc.body.children = [];
  const btn = botao('approve');
  cardSelecionado = cardCom(btn);
  assert.equal(tecla('a'), true);
  assert.equal(modais().length, 1, 'a tecla pede confirmação antes de postar');
  assert.equal(btn.disabled, true, 'o botão desliga enquanto a decisão está em curso');
  btn.disabled = false; // mesmo com o botão ligado de novo, a modal aberta barra a tecla
  assert.equal(tecla('c'), false);
  assert.equal(tecla('a'), false);
  assert.equal(modais().length, 1, 'nenhuma segunda confirmação por cima da primeira');
});
