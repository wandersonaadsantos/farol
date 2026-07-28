'use strict';
// Smoke de boot: constrói a Engine contra um FAROL_HOME temporário e confere que
// o app "acorda" sem quebrar (config com defaults, workspace semeado, snapshot ok).
// É a rede que protege a decomposição da Engine em ondas: se um refactor quebrar o
// boot, isto falha. Runner nativo (node --test), ZERO dependências.
// IMPORTANTE: fixar FAROL_HOME ANTES de require('../server.js'), pois os caminhos
// são const de nível de módulo lidos no load. O runner isola cada arquivo em um
// processo próprio, então esta env não vaza pros outros testes.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const HOME = path.join(os.tmpdir(), 'farol-test-boot-' + process.pid);
process.env.FAROL_HOME = HOME;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../server.js');

after(() => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

test('Engine constrói contra FAROL_HOME temporário sem lançar', () => {
  const engine = new Engine();
  assert.ok(engine, 'engine instanciada');
  assert.equal(typeof engine.config, 'object');
});

test('boot semeia HOME, workspace e state', () => {
  new Engine();
  assert.ok(fs.existsSync(HOME), 'HOME criado');
  assert.ok(fs.existsSync(path.join(HOME, 'workspace', 'state')), 'workspace/state criado');
});

test('config aplica os defaults conhecidos', () => {
  const { config } = new Engine();
  assert.equal(config.port, 47170);
  assert.equal(config.reviewModel, '', 'default = modelo bom (Opus), não econômico');
  assert.equal(config.autoPushback, true);
  assert.ok(Array.isArray(config.accounts), 'accounts normalizado em array');
  assert.equal(typeof config.people, 'object', 'people migrado/normalizado');
});

test('snapshot() devolve um estado serializável com a versão', () => {
  const snap = new Engine().snapshot();
  assert.equal(typeof snap, 'object');
  assert.doesNotThrow(() => JSON.stringify(snap), 'snapshot é serializável (vai por SSE)');
  assert.ok('version' in snap || 'appVersion' in snap || 'status' in snap, 'snapshot traz metadados do app');
});
