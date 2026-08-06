'use strict';
// Prompt da revisão headless: o fan-out de PR grande precisa CHEGAR no prompt.
//
// Contexto: a fachada Engine.headlessPromptFor declarava (url, author) enquanto a
// implementação em lib/engine/review.js recebe (engine, url, author, lotes, metrics) e o
// chamador real passa os quatro. Os dois últimos eram engolidos, então o bloco de fan-out
// nunca era concatenado: o Farol media o PR, montava os lotes e jogava o plano fora.
// Um PR de 8700 linhas era lido parcialmente e aprovado. Estes testes travam os dois
// lados: o comportamento (o bloco aparece) e a assinatura (aridade da fachada).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const HOME = path.join(os.tmpdir(), 'farol-test-review-prompt-' + process.pid);
process.env.FAROL_HOME = HOME;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../server.js');
const { planLotes } = require('../lib/engine/fanout');

after(() => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const URL_PR = 'https://github.com/acme/repo/pull/688';

// mesma forma que runHeadlessReview produz: planLotes sobre os arquivos do diff
const LOTES = planLotes([
  { path: 'src/backend/api/pedido.ts', lines: 400 },
  { path: 'src/backend/api/cliente.ts', lines: 350 },
  { path: 'src/frontend/pages/Checkout.tsx', lines: 380 },
  { path: 'src/frontend/pages/Carrinho.tsx', lines: 320 },
]);
const METRICS = { changedFiles: 4, lines: 1450 };

test('headlessPromptFor: sem lotes, o prompt não ganha o bloco de fan-out', () => {
  const prompt = new Engine().headlessPromptFor(URL_PR, 'alice');
  assert.equal(typeof prompt, 'string');
  assert.ok(prompt.length > 0, 'o template base foi lido');
  assert.doesNotMatch(prompt, /PR GRANDE/, 'PR pequeno segue no passe único');
});

test('headlessPromptFor: COM lotes, o bloco de fan-out chega no prompt', () => {
  assert.ok(LOTES.length >= 2, 'o cenário precisa de pelo menos 2 lotes pra fatiar');
  const prompt = new Engine().headlessPromptFor(URL_PR, 'alice', LOTES, METRICS);
  assert.match(prompt, /PR GRANDE: revisão em lotes com subagentes/);
  assert.match(prompt, /Dispare um subagente `pr-reviewer` POR LOTE, em paralelo/);
  // e os lotes de verdade, não um bloco genérico
  for (const l of LOTES) assert.match(prompt, new RegExp(`Lote ${l.id} \\(`), `lote ${l.id} listado`);
  assert.match(prompt, /src\/backend\/api\/pedido\.ts/);
  assert.match(prompt, /src\/frontend\/pages\/Checkout\.tsx/);
  // as métricas medidas entram no texto (é o que justifica o fatiamento pro modelo)
  assert.match(prompt, /4 arquivos e ~1450 linhas/);
});

test('headlessPromptFor: o prompt com lotes é um superconjunto do sem lotes', () => {
  const engine = new Engine();
  const sem = engine.headlessPromptFor(URL_PR, 'alice');
  const com = engine.headlessPromptFor(URL_PR, 'alice', LOTES, METRICS);
  assert.ok(com.startsWith(sem), 'o fan-out é anexado ao fim, não substitui nada');
  assert.ok(com.length > sem.length);
});

/* A aridade das fachadas (a outra metade deste defeito) é checada em test/facades.test.js,
   que varre as ~97 fachadas derivando a expectativa do próprio fonte. Aqui ficou só o
   comportamento: o bloco de fan-out realmente chega no prompt. */

const { checkpointPath } = require('../lib/engine/verification-checkpoint');

test('headlessPromptFor: {{CHECKPOINT_PATH}} é substituído pelo caminho real do checkpoint', () => {
  const prompt = new Engine().headlessPromptFor(URL_PR, 'alice');
  assert.doesNotMatch(prompt, /\{\{CHECKPOINT_PATH\}\}/, 'nunca sobra o placeholder cru');
  const esperado = checkpointPath('acme/repo#688'); // mesma key que URL_PR já usa neste arquivo
  assert.ok(prompt.includes(esperado), 'o caminho exato do checkpoint deste PR aparece no prompt');
});
