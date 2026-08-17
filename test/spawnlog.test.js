// Cobre o logger de spawns: só grava quando FAROL_DEBUG_SPAWNS=1, grava o comando,
// e NUNCA env/token. Runner nativo, ZERO deps.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-spawnlog-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../server.js'; // cria os diretórios de state
const { logSpawn, SPAWN_LOG_FILE } = await import('../lib/spawnlog.js');

new Engine(); // garante workspace/state existindo
after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

function readLog() { try { return fs.readFileSync(SPAWN_LOG_FILE, 'utf8'); } catch { return ''; } }

test('desligado (sem FAROL_DEBUG_SPAWNS) não grava nada', () => {
  process.env.FAROL_DEBUG_SPAWNS = '';
  const before = readLog().length;
  logSpawn('gh', ['search', 'prs', '--owner', 'biudtech']);
  assert.equal(readLog().length, before, 'nada foi escrito com o flag desligado');
});

test('ligado grava o comando + args (com horário)', () => {
  process.env.FAROL_DEBUG_SPAWNS = '1';
  logSpawn('gh', ['release', 'view', '--repo', 'x/y']);
  const log = readLog();
  assert.match(log, /gh release view --repo x\/y/, 'gravou o comando');
  assert.match(log, /\d{2}:\d{2}:\d{2}/, 'tem horário');
});

test('nunca grava env/token (só recebe cmd e args, não opts)', () => {
  process.env.FAROL_DEBUG_SPAWNS = '1';
  // a assinatura é logSpawn(cmd, args): não há como passar env/token pra ele
  logSpawn('cmd.exe', ['/c', 'claude -p --output-format stream-json']);
  const log = readLog();
  assert.equal(/GH_TOKEN|ghp_|Bearer|password|secret/i.test(log), false, 'sem segredo no log');
  process.env.FAROL_DEBUG_SPAWNS = '';
});
