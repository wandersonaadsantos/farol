// O modo celular é simulado pelo sinal do Termux, ANTES de qualquer import: o porteiro lê
// os sinais do processo uma vez só. Pasta de dados isolada, sem rede.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-a4b-celular-'));
process.env.FAROL_HOME = path.join(BASE, 'farol');
process.env.TERMUX_VERSION = '0.118.0-teste';

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const syncMod = (await import('../lib/engine/sync.js')).default;

after(() => { try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* best-effort */ } });

function ligado() {
  return { enabled: true, coordination: { enabled: true }, shared: { enabled: true }, distribution: { enabled: true }, databaseUrl: '', apiKey: '' };
}

test('no celular sem autenticação exigida, o compartilhamento e a distribuição ficam desligados, com motivo', () => {
  fs.mkdirSync(process.env.FAROL_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.FAROL_HOME, 'config.json'), JSON.stringify({ sync: ligado() }));
  const e = new Engine();
  e.pushState = () => { };
  assert.equal(e.config.sync.shared.enabled, false, 'config.json editado à mão também é barrado no boot');
  e.updateSettings({ sync: ligado() });
  assert.equal(e.config.sync.shared.enabled, false);
  assert.equal(e.config.sync.distribution.enabled, false);
  assert.equal(syncMod.statusForUi(e).bloqueioCompartilhamento, 'autenticacao-local');
});

// `localAuth` não passa pela rota de configurações: ele é escrito no config.json pelo dono,
// e é assim que o teste o liga, antes do boot.
test('com a autenticação exigida, o compartilhamento liga', () => {
  fs.mkdirSync(process.env.FAROL_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.FAROL_HOME, 'config.json'), JSON.stringify({ localAuth: 'exigir', sync: ligado() }));
  const e = new Engine();
  e.pushState = () => { };
  assert.equal(e.config.sync.shared.enabled, true, 'vale no boot');
  e.updateSettings({ sync: ligado() });
  assert.equal(e.config.sync.shared.enabled, true);
  assert.equal(syncMod.statusForUi(e).bloqueioCompartilhamento, '');
});
