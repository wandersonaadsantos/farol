'use strict';
// Teste do removedor léxico: o que sai NUNCA contém conteúdo de string,
// comentário, template ou regex, e mantém o número de linhas do original.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { strip } = require('../tools/quality/strip.js');

test('remove strings simples e duplas preservando linhas', () => {
  const out = strip(`const a = 'if (x) {';\nconst b = "} else {";`);
  assert.equal(out.includes('if (x)'), false);
  assert.equal(out.includes('else'), false);
  assert.equal(out.split('\n').length, 2);
});

test('remove comentarios de linha e bloco', () => {
  const out = strip(`x(); // catch {}\n/* var y;\n var z; */\nfim();`);
  assert.equal(out.includes('catch'), false);
  assert.equal(out.includes('var'), false);
  assert.equal(out.split('\n').length, 4);
  assert.equal(out.includes('x()'), true);
  assert.equal(out.includes('fim()'), true);
});

test('remove template literal inclusive interpolacao aninhada', () => {
  const out = strip('const s = `a ${x ? `b ${y}` : "c"} d`;');
  assert.equal(out.includes('a '), false);
  assert.equal(out.includes(' d'), false);
  // o codigo DENTRO de ${} sobrevive (e codigo de verdade)
  assert.equal(out.includes('x ?'), true);
});

test('remove regex literal sem confundir com divisao', () => {
  const out = strip('const r = /catch {}/g; const d = a / b / c;');
  assert.equal(out.includes('catch'), false);
  assert.equal(out.includes('a / b / c'), true);
});

test('escape dentro de string nao encerra a string', () => {
  const out = strip(`const a = 'it\\'s a var trap';`);
  assert.equal(out.includes('var'), false);
});

test('chave aninhada dentro de ${} nao fecha a interpolacao cedo', () => {
  const out = strip('const s = `x ${fn({a:1})} y`;');
  assert.equal(out.includes('fn('), true);
  assert.equal(out.includes(')'), true);  // o fecha-parenteses do fn sobrevive
  assert.equal(out.includes(' y'), false); // ' y' e conteudo de template, morre
  assert.equal(out.split('\n').length, 1);
});
