// O contrato da autoanálise é produto: o texto que ele devolve vira o prompt que o
// autor cola no chat que resolve o PR. Medido em 17/09/2026 (engine-ai#214): a análise
// misturou numa lista só o que um commit resolve e o que só o dono do card resolve,
// sugeriu uma ação que só valia no commit analisado sem dizer isso, pediu "um teste que
// registre o limite" sem dizer qual era o comportamento certo, e ofereceu bypass de
// admin como saída. Cada teste abaixo fixa a regra que fecha um desses pontos.
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const RAIZ = path.join(import.meta.dirname, '..');
const SELF = fs.readFileSync(path.join(RAIZ, 'workspace-template', 'prompts', 'self-review.md'), 'utf8');

test('o schema separa o bloqueio do PR do bloqueio de fora dele', () => {
  assert.match(SELF, /"externalBlockers":/);
  assert.match(SELF, /`blockers`[^\n]*commit no PR/);
  assert.match(SELF, /`externalBlockers`[^\n]*fora do PR/);
});

test('bloqueio de fora do PR nomeia quem resolve', () => {
  assert.match(SELF, /Quem resolve: o que falta/);
});

test('sugestão de comportamento diz o que é certo, e não só a ação', () => {
  assert.match(SELF, /comportamento esperado/i);
  assert.match(SELF, /hoje/);
});

test('item que só vale no commit analisado vem marcado', () => {
  assert.match(SELF, /Neste head \(<sha7>\):/);
});

test('contornar proteção nunca aparece como caminho', () => {
  assert.match(SELF, /bypass/i);
  assert.match(SELF, /--no-verify/);
  assert.match(SELF, /nunca (?:sugira|ofereça)/i);
});

test('o relatório abre com o head analisado e separa o que é de fora do PR', () => {
  assert.match(SELF, /\*\*Head analisado\*\*/);
  assert.match(SELF, /\*\*Fora do PR\*\*/);
});
