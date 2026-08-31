// Cobre o logger de spawns: só grava quando FAROL_DEBUG_SPAWNS=1, grava o comando,
// e NUNCA env/token. Runner nativo, ZERO deps.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-spawnlog-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
// await import (nunca import estático): o estático é hasteado ACIMA do FAROL_HOME
// acima e o paths.js resolveria HOME no ~/.farol REAL, fazendo este teste semear o
// workspace do usuário e escrever spawns.log lá, sempre verde. Ver test-isolation.test.js.
const { Engine } = await import('../server.js'); // cria os diretórios de state
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

// O arquivo é de alto volume (uma linha por comando disparado) e não tinha relógio
// nenhum: medido em 30/08/2026 estava com 60 MB e crescendo. Rotaciona como o
// farol.log: passou do teto, o atual vira `.1` e um novo começa.
test('rotaciona quando passa do teto, preservando o anterior em .1', async () => {
  const { TEMPOS } = await import('../lib/constants.js');
  process.env.FAROL_DEBUG_SPAWNS = '1';
  fs.writeFileSync(SPAWN_LOG_FILE, 'x'.repeat(TEMPOS.SPAWN_LOG_ROTACAO_BYTES + 1));
  logSpawn('gh', ['pr', 'view', 'depois-da-rotacao']);
  const atual = readLog();
  assert.match(atual, /depois-da-rotacao/, 'a linha nova entrou no arquivo novo');
  assert.ok(atual.length < TEMPOS.SPAWN_LOG_ROTACAO_BYTES, 'o arquivo recomeçou pequeno');
  assert.equal(fs.existsSync(SPAWN_LOG_FILE + '.1'), true, 'o anterior virou .1');
  process.env.FAROL_DEBUG_SPAWNS = '';
});

test('abaixo do teto NÃO rotaciona (o arquivo continua acumulando)', () => {
  process.env.FAROL_DEBUG_SPAWNS = '1';
  fs.writeFileSync(SPAWN_LOG_FILE, 'linha antiga que tem que continuar aqui\n');
  logSpawn('gh', ['pr', 'view', 'sem-rotacao']);
  const atual = readLog();
  assert.match(atual, /linha antiga que tem que continuar aqui/, 'não jogou fora o que havia');
  assert.match(atual, /sem-rotacao/, 'e acrescentou a nova');
  process.env.FAROL_DEBUG_SPAWNS = '';
});
