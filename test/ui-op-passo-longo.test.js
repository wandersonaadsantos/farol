// O passo da operação pode ser uma linha ENORME sem espaço (a saída do
// FAROL_CHECKPOINT é um JSON inteiro numa linha só). Medido na tela em 17/09/2026:
// o texto vazava da caixa e empurrava a barra e o botão para longe. Aqui ficam as
// duas travas: o texto cabe em duas linhas, e o que não coube continua alcançável.
import path from 'node:path';
import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom } from './helpers/dom-stub.js';

const CSS = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'app.css'), 'utf8');
const bloco = (seletor) => {
  const i = CSS.indexOf(seletor);
  assert.ok(i >= 0, `o seletor ${seletor} existe`);
  return CSS.slice(i, CSS.indexOf('}', i));
};

instalarDom();
const { showOp, updateOp, closeOp, ACTIVE_OPS } = await import('../ui/telas/infra.js');

const LONGO = 'Bash · FAROL_CHECKPOINT: {"claim":"Apos operacao editorial o loader zera a projecao de homologacao e nunca a recarrega","file":"src/components/domains/editorial-review-workbench.tsx","line":394,"verdict":"confirmado"}';

test('o passo longo cabe em duas linhas e o texto inteiro fica no tooltip', () => {
  showOp('op-passo', { title: 'Analisando acme/app#7', cancellable: true });
  updateOp('op-passo', { step: LONGO, progress: 40 });
  const el = ACTIVE_OPS.get('op-passo').element;
  const passo = el.innerHTML;
  assert.match(passo, /class="op-step"/);
  assert.match(passo, /title="/, 'o texto completo fica no title, então nada se perde');
  assert.ok(passo.includes('editorial-review-workbench.tsx'), 'o texto vai inteiro para o atributo');
  closeOp('op-passo');
});

test('o estilo do passo corta em duas linhas e quebra palavra que não cabe', () => {
  const b = bloco('.op-step {');
  assert.match(b, /-webkit-line-clamp:\s*2/, 'duas linhas, e o resto vira reticências');
  assert.match(b, /overflow:\s*hidden/);
  assert.match(b, /overflow-wrap:\s*anywhere/, 'palavra sem espaço quebra em vez de vazar');
});

test('o cabeçalho da operação também quebra nome comprido de PR', () => {
  const b = bloco('.op-header {');
  assert.match(b, /overflow-wrap:\s*anywhere/);
});

test('os blocos do card respiram: caixa e ações com espaço declarado', () => {
  assert.match(bloco('.op-widget {'), /gap:\s*1[2-9]px/, 'o espaço entre título, passo, barra e ações');
  assert.match(bloco('.op-widget {'), /padding:\s*1[4-9]px/);
  assert.match(bloco('.op-actions {'), /margin-top:\s*[6-9]px|margin-top:\s*1[0-9]px/);
  assert.match(bloco('.op-progress {'), /gap:\s*(8|9|10|11|12)px/);
});
