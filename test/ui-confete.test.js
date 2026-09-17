// A festa de 4 segundos da análise impecável (pedido do Wanderson, 17/09/2026): ela
// aparece, desenha, sai sozinha e nunca fica no caminho de quem está usando o app.
// Roda contra o DOM de mentira (test/helpers/dom-stub.js), como as outras telas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { instalarDom } from './helpers/dom-stub.js';

instalarDom();
const { festejar } = await import('../ui/telas/confete.js');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const filhos = (classe) => document.body.children.filter((c) => c.className === classe);

test('a festa entra na tela, desenha e sai sozinha no fim', async () => {
  const canvas = festejar({ duracaoMs: 60 });
  assert.equal(canvas.tagName.toLowerCase(), 'canvas');
  assert.equal(canvas.className, 'confete');
  assert.equal(canvas.getAttribute('aria-hidden'), 'true', 'leitor de tela não lê o enfeite');
  assert.equal(filhos('confete').length, 1);
  await esperar(30);
  assert.ok(canvas.ctx2d.chamadas.some(([nome]) => nome === 'fillRect'), 'desenhou partícula');
  await esperar(80);
  assert.equal(filhos('confete').length, 0, 'o canvas sai do DOM quando a festa termina');
});

test('a festa não segura o texto: o aviso diz o que aconteceu e também sai', async () => {
  festejar({ duracaoMs: 60, texto: 'Análise impecável: nada a ajustar.' });
  const aviso = filhos('confete-aviso')[0];
  assert.equal(aviso.textContent, 'Análise impecável: nada a ajustar.');
  assert.equal(aviso.getAttribute('role'), 'status', 'o aviso é anunciado, o canvas não');
  await esperar(90);
  assert.equal(filhos('confete-aviso').length, 0);
});

test('com movimento reduzido, nenhuma partícula: só o aviso', async () => {
  const antes = window.matchMedia;
  window.matchMedia = (consulta) => ({ matches: /reduce/.test(consulta), addEventListener() { }, removeEventListener() { } });
  try {
    const el = festejar({ duracaoMs: 40 });
    assert.equal(el.className, 'confete-aviso');
    assert.equal(filhos('confete').length, 0, 'nenhum canvas com movimento reduzido');
  } finally {
    window.matchMedia = antes;
  }
  await esperar(60);
});

test('o estilo da festa não recebe clique, nas duas formas', () => {
  const css = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'app.css'), 'utf8');
  const bloco = (seletor) => css.slice(css.indexOf(seletor), css.indexOf('}', css.indexOf(seletor)));
  assert.match(bloco('.confete {'), /pointer-events:\s*none/);
  assert.match(bloco('.confete-aviso {'), /pointer-events:\s*none/);
});
