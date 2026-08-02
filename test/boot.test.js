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
  assert.equal(config.reviewEffort, '', 'default = sem flag, o CLI decide pelo modelo');
  assert.equal(config.autoPushback, true);
  assert.ok(Array.isArray(config.accounts), 'accounts normalizado em array');
  assert.equal(typeof config.people, 'object', 'people migrado/normalizado');
});

test('config.json com reviewModel/reviewEffort inválido é saneado no BOOT', () => {
  // Estes dois campos entram na linha de comando passada a um shell. Até a v2.27.0 só o
  // caminho HTTP validava, então um config.json editado à mão passava cru até o spawn.
  fs.mkdirSync(HOME, { recursive: true });
  const arq = path.join(HOME, 'config.json');
  const antes = fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8') : null;
  fs.writeFileSync(arq, JSON.stringify({ reviewModel: 'opus && calc.exe', reviewEffort: 'ultracode' }));
  try {
    const { config } = new Engine();
    assert.equal(config.reviewModel, '', 'modelo com metacaractere de shell vira o padrão');
    assert.equal(config.reviewEffort, '', 'nível session-only vira o padrão');
  } finally {
    if (antes === null) { try { fs.unlinkSync(arq); } catch { /* best-effort */ } }
    else fs.writeFileSync(arq, antes);
  }
});

test('config.json com reviewModel/reviewEffort válido é preservado no boot', () => {
  fs.mkdirSync(HOME, { recursive: true });
  const arq = path.join(HOME, 'config.json');
  const antes = fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8') : null;
  fs.writeFileSync(arq, JSON.stringify({ reviewModel: 'fable', reviewEffort: 'xhigh' }));
  try {
    const { config } = new Engine();
    assert.equal(config.reviewModel, 'fable');
    assert.equal(config.reviewEffort, 'xhigh');
  } finally {
    if (antes === null) { try { fs.unlinkSync(arq); } catch { /* best-effort */ } }
    else fs.writeFileSync(arq, antes);
  }
});

test('config.json com intervalSeconds inválido é clampado no BOOT (updateSettings já clampava)', () => {
  // NaN aqui virava setTimeout(fn, NaN) no schedule(): polling de ~1ms contra o
  // GitHub até esgotar o rate limit. O clamp do boot usa a MESMA expressão do
  // caminho HTTP (updateSettings), pras duas portas de entrada serem idênticas.
  fs.mkdirSync(HOME, { recursive: true });
  const arq = path.join(HOME, 'config.json');
  const antes = fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8') : null;
  try {
    fs.writeFileSync(arq, JSON.stringify({ intervalSeconds: 'trezentos' }));
    assert.equal(new Engine().config.intervalSeconds, 300, 'não numérico cai no default');
    fs.writeFileSync(arq, JSON.stringify({ intervalSeconds: 5 }));
    assert.equal(new Engine().config.intervalSeconds, 60, 'piso de 60s');
    fs.writeFileSync(arq, JSON.stringify({ intervalSeconds: 999999 }));
    assert.equal(new Engine().config.intervalSeconds, 3600, 'teto de 1h');
    fs.writeFileSync(arq, JSON.stringify({ intervalSeconds: 600 }));
    assert.equal(new Engine().config.intervalSeconds, 600, 'valor válido é preservado');
  } finally {
    if (antes === null) { try { fs.unlinkSync(arq); } catch { /* best-effort */ } }
    else fs.writeFileSync(arq, antes);
  }
});

test('snapshot() devolve um estado serializável com a versão', () => {
  const snap = new Engine().snapshot();
  assert.equal(typeof snap, 'object');
  assert.doesNotThrow(() => JSON.stringify(snap), 'snapshot é serializável (vai por SSE)');
  assert.ok('version' in snap || 'appVersion' in snap || 'status' in snap, 'snapshot traz metadados do app');
});
