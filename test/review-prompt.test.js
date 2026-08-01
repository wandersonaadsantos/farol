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

/* ---------- aridade das fachadas ----------
   A fachada recebe o engine como 1o argumento, então tem que ter exatamente UM parâmetro
   a menos que a implementação. TABELA CURADA de propósito: uma varredura automática de
   todas as fachadas daria falso positivo em pelo menos 5 casos (funções puras que não
   recebem engine, e parâmetro desestruturado com default, que reduz Function.length).
   Fachada nova que carregue argumento de comportamento entra aqui. */
const FACHADAS = [
  ['headlessPromptFor', require('../lib/engine/review')],
  ['personProfileBlock', require('../lib/engine/review')],
  ['runHeadlessReview', require('../lib/engine/review')],
  ['runClaudeStream', require('../lib/engine/session')],
  ['toolSummary', require('../lib/engine/session')],
  ['setSessionModel', require('../lib/engine/session')],
];

for (const [nome, mod] of FACHADAS) {
  test(`fachada ${nome} não engole argumento`, () => {
    const fachada = Engine.prototype[nome];
    assert.equal(typeof fachada, 'function', `Engine.prototype.${nome} existe`);
    assert.equal(typeof mod[nome], 'function', `a implementação ${nome} existe`);
    assert.equal(fachada.length, mod[nome].length - 1,
      `${nome}: a fachada tem ${fachada.length} parâmetro(s) e a implementação ${mod[nome].length} ` +
      `(esperado: implementação menos o engine). Argumento a mais na implementação sem estar ` +
      `na fachada chega undefined e falha em silêncio.`);
  });
}
