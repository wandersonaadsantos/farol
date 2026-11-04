// As entradas "Ir para" da paleta de comando levam à sub-aba certa do Radar. Exercitado no
// módulo real (ui/telas/paleta.js) sobre o DOM de mentira: abre pelo botão, filtra pelo campo e
// clica no item, como a pessoa faz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom } from './helpers/dom-stub.js';

const { doc } = instalarDom();

// O stub não interpreta innerHTML: a lista devolve um elemento por item desenhado, com o rótulo
// lido do HTML, e o overlay devolve sempre o mesmo campo e a mesma lista.
function elementosDaPaleta() {
  const input = doc.createElement('input');
  const list = doc.createElement('div');
  let itens = [];
  list.querySelectorAll = () => {
    itens = [...list.innerHTML.matchAll(/class="cmd-item[^"]*"[^>]*><span>([^<]*)<\/span>/g)].map(m => {
      const el = doc.createElement('div');
      el.rotulo = m[1];
      return el;
    });
    return itens;
  };
  return { input, list, itens: () => itens };
}

const criarElemento = doc.createElement.bind(doc);
let paleta = null;
doc.createElement = (tag) => {
  const el = criarElemento(tag);
  el.querySelector = (sel) => (paleta && { '#cmdInput': paleta.input, '#cmdList': paleta.list }[sel]) || criarElemento('div');
  return el;
};

let abrirPeloBotao = null;
doc.querySelector('#btnCmdK').addEventListener = (tipo, fn) => { if (tipo === 'click') abrirPeloBotao = fn; };
const rolou = [];
for (const id of ['decisionsWrap', 'queueSection']) {
  doc.getElementById(id).scrollIntoView = () => rolou.push(id);
}

const { initPaleta } = await import('../ui/telas/paleta.js');
const abas = [];
const subs = [];
initPaleta((aba) => abas.push(aba), (sub) => subs.push(sub));

// Abre, deixa só o item do rótulo pelo filtro e clica nele. O clique roda a ação numa promise.
async function escolher(rotulo) {
  abas.length = 0; subs.length = 0; rolou.length = 0;
  paleta = elementosDaPaleta();
  paleta.input.value = rotulo;
  abrirPeloBotao();
  const item = paleta.itens().find(el => el.rotulo === rotulo);
  assert.ok(item, `a paleta lista ${rotulo}`);
  item.onclick();
  await Promise.resolve();
  await Promise.resolve();
}

for (const [rotulo, sub, secao] of [
  ['Ir para Pra mim', 'mim', null],
  ['Ir para Precisa de você', 'mim', 'decisionsWrap'],
  ['Ir para Sua fila', 'mim', 'queueSection'],
  ['Ir para Meus PRs', 'meus', null],
  ['Ir para Panorama', 'pano', null],
]) {
  test(`${rotulo} abre o Radar na sub-aba ${sub}${secao ? ` e rola até ${secao}` : ''}`, async () => {
    await escolher(rotulo);
    assert.deepEqual(abas, ['radar']);
    assert.deepEqual(subs, [sub]);
    assert.deepEqual(rolou, secao ? [secao] : []);
  });
}
