'use strict';
// Perfis de assinatura Claude por conta: resolver + claudeAuthInfo parametrizado.
// Segue o padrão de boot.test.js (Engine real contra FAROL_HOME temporário).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const HOME = path.join(os.tmpdir(), 'farol-test-claude-profiles-' + process.pid);
process.env.FAROL_HOME = HOME;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../server.js');

after(() => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

test('resolveClaudeConfigDir: sem profiles, cai no legado (claudeConfigDir)', () => {
  const engine = new Engine();
  engine.config.claudeConfigDir = 'C:\\legado';
  engine.config.claudeProfiles = [];
  assert.equal(engine.resolveClaudeConfigDir('alice'), 'C:\\legado');
  assert.equal(engine.resolveClaudeConfigDir(undefined), 'C:\\legado');
});

test('resolveClaudeConfigDir: com profiles, sem override de conta, usa o padrão global', () => {
  const engine = new Engine();
  engine.config.claudeConfigDir = 'C:\\legado'; // não deve ser usado
  engine.config.claudeProfiles = [
    { id: 'trabalho', label: 'BIUD Trabalho', dir: 'C:\\biud-trabalho' },
    { id: 'pessoal', label: 'Pessoal Max', dir: 'C:\\pessoal' }
  ];
  engine.config.claudeProfileId = 'pessoal';
  engine.config.accounts = [{ user: 'alice', owners: ['x'] }]; // sem claudeProfileId próprio
  assert.equal(engine.resolveClaudeConfigDir('alice'), 'C:\\pessoal');
});

test('resolveClaudeConfigDir: com profiles, override por conta vence o padrão global', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [
    { id: 'trabalho', label: 'BIUD Trabalho', dir: 'C:\\biud-trabalho' },
    { id: 'pessoal', label: 'Pessoal Max', dir: 'C:\\pessoal' }
  ];
  engine.config.claudeProfileId = 'pessoal';
  engine.config.accounts = [{ user: 'bob', owners: ['biudtech'], claudeProfileId: 'trabalho' }];
  assert.equal(engine.resolveClaudeConfigDir('bob'), 'C:\\biud-trabalho');
});

test('resolveClaudeConfigDir: id aponta pra perfil inexistente, cai no legado', () => {
  const engine = new Engine();
  engine.config.claudeConfigDir = 'C:\\legado';
  engine.config.claudeProfiles = [{ id: 'trabalho', label: 'BIUD Trabalho', dir: 'C:\\biud-trabalho' }];
  engine.config.claudeProfileId = 'id-que-nao-existe';
  engine.config.accounts = [{ user: 'carol', owners: [] }];
  assert.equal(engine.resolveClaudeConfigDir('carol'), 'C:\\legado');
});

test('resolveClaudeConfigDir: perfil encontrado mas com dir vazio/ausente cai no legado', () => {
  const engine = new Engine();
  engine.config.claudeConfigDir = 'C:\\legado';
  engine.config.claudeProfiles = [{ id: 'quebrado', label: 'Sem dir', dir: '' }];
  engine.config.claudeProfileId = 'quebrado';
  assert.equal(engine.resolveClaudeConfigDir('qualquer'), 'C:\\legado');
});

test('resolveClaudeConfigDir: sem user informado usa o padrão global/legado normalmente', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [{ id: 'p1', label: 'P1', dir: 'C:\\p1' }];
  engine.config.claudeProfileId = 'p1';
  assert.equal(engine.resolveClaudeConfigDir(), 'C:\\p1');
});
