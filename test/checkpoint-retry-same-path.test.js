// Trava arquitetural: NÃO existe (e não deveria passar a existir) um caminho de prompt
// separado pro relançamento via retryAfterNet. Onda 3 do checkpoint (resumeBlock) depende
// de toda sessão, primeira vez ou retry, passar pelo MESMO ponto de montagem de prompt em
// runHeadlessReview. Ver a seção "Checkpoint de verificação" do docs/REVIEW-GATES.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('runHeadlessReview é a ÚNICA função que chama headlessPromptFor', () => {
  // A montagem do prompt saiu do review.js em 23/09/2026 (lib/engine/review-prompt.js).
  // O invariante não mudou, o endereço sim: antes este caso contava 2 ocorrências no
  // review.js (definição mais chamada), e agora pergunta o mesmo em dois arquivos.
  const leia = (...p) => fs.readFileSync(path.join(import.meta.dirname, '..', ...p), 'utf8');
  const chamadas = (leia('lib', 'engine', 'review.js').match(/headlessPromptFor\(/g) || []).length;
  assert.equal(chamadas, 1, 'uma chamada só, dentro do runHeadlessReview: nenhum caminho paralelo de prompt');
  const def = (leia('lib', 'engine', 'review-prompt.js').match(/function headlessPromptFor\(/g) || []).length;
  assert.equal(def, 1, 'e uma definição só, no módulo do prompt');
});

test('retryTargets só filtra e devolve PRs, nunca monta prompt nem chama runClaudeStream', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'engine', 'review.js'), 'utf8');
  const inicio = src.indexOf('function retryTargets(');
  const fim = src.indexOf('\n}', inicio);
  const corpo = src.slice(inicio, fim);
  assert.doesNotMatch(corpo, /headlessPromptFor|runClaudeStream/, 'retryTargets é só filtro, o relançamento de verdade passa por runOneHeadless/runHeadlessReview');
});
