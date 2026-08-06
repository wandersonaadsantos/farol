'use strict';
// Trava arquitetural: NÃO existe (e não deveria passar a existir) um caminho de prompt
// separado pro relançamento via retryAfterNet. Onda 3 do checkpoint (resumeBlock) depende
// de toda sessão, primeira vez ou retry, passar pelo MESMO ponto de montagem de prompt em
// runHeadlessReview. Ver docs/superpowers/specs/2026-08-05-checkpoint-verificacao-design.md.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('runHeadlessReview é a ÚNICA função que chama headlessPromptFor', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'engine', 'review.js'), 'utf8');
  const chamadas = src.match(/headlessPromptFor\(/g) || [];
  // 1 na definição da função (`function headlessPromptFor(`) + 1 na chamada dentro de
  // runHeadlessReview = 2 ocorrências do token no arquivo inteiro
  assert.equal(chamadas.length, 2, 'headlessPromptFor só é definida e chamada uma vez; nenhum caminho paralelo de prompt');
});

test('retryTargets só filtra e devolve PRs, nunca monta prompt nem chama runClaudeStream', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'engine', 'review.js'), 'utf8');
  const inicio = src.indexOf('function retryTargets(');
  const fim = src.indexOf('\n}', inicio);
  const corpo = src.slice(inicio, fim);
  assert.doesNotMatch(corpo, /headlessPromptFor|runClaudeStream/, 'retryTargets é só filtro, o relançamento de verdade passa por runOneHeadless/runHeadlessReview');
});
