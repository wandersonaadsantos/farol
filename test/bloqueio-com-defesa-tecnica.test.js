// Todo bloqueio leva defesa técnica, nunca só o nome da regra (21/11/2026).
//
// Num PR real de 21/11/2026 o bloqueio estava certo, mas o texto público e o motivo interno
// diziam só que a regra de supressão exigia a ficha: "viola a regra obrigatória". O autor não
// fica sabendo o que dá errado no código dele, e um colega que conteste não recebe resposta. O
// catálogo técnico tem o porquê de cada regra; o bloqueio precisa trazê-lo aplicado ao trecho,
// com o cenário, quem paga e por que a correção resolve. A trava cobre os dois lugares: o bloco
// de formato do texto público e a regra dos `reasons` no contrato da revisão headless.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-defesa-tecnica-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const prompt = (await import('../lib/engine/review-prompt.js')).default;

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

const contrato = () => fs.readFileSync(path.join('workspace-template', 'prompts', 'pr-review-auto.md'), 'utf8');

test('o texto público de cada bloqueio traz cenário, quem paga e por que a correção resolve', () => {
  const b = prompt.reviewFormatBlock(new Engine());
  assert.match(b, /Todo bloqueio leva defesa técnica, nunca só a regra/);
  assert.match(b, /\(a\) o que acontece de errado com ESTE código/);
  assert.match(b, /\(b\) quem paga por isso/);
  assert.match(b, /\(c\) por que a correção pedida resolve/);
});

test('regra do catálogo entra pelo porquê dela aplicado ao trecho', () => {
  const b = prompt.reviewFormatBlock(new Engine());
  assert.match(b, /a seção "Por quê" dela\) aplicado a este trecho/);
  assert.match(b, /O nome de uma regra, a palavra "obrigatório" ou "viola o padrão" não são argumento/);
});

test('sem defesa, o modelo diz isso em reasons em vez de inventar risco', () => {
  const b = prompt.reviewFormatBlock(new Engine());
  assert.match(b, /o ponto não tem defesa: diga isso em `reasons` em vez de inventar um risco/);
});

test('o motivo interno de bloqueio também leva o porquê técnico', () => {
  const c = contrato();
  assert.match(c, /Reason de bloqueio diz o porquê técnico, não só a regra/);
  assert.match(c, /Ruim: "it\.skip sem ficha: viola a regra de supressão"/);
});
