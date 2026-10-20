// O login de um perfil do Antigravity pela tela (lib/engine/login-web.js com o jeito de
// lib/agy/login.js), com o `agy` falso: o link do Google sai da saída do CLI, o código vai
// pela entrada padrão, e a saída 0 é o sucesso. O código nunca vai para o spawns.log.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-agy-login-'));
process.env.FAROL_AGY_CMD = path.join(import.meta.dirname, 'helpers', 'agy-falso.js');

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { AGY_DIR } = await import('../lib/paths.js');
const loginWeb = await import('../lib/engine/login-web.js');
const agyLogin = await import('../lib/agy/login.js');
const { temLogin } = await import('../lib/agy/home.js');
const { SPAWN_LOG_FILE } = await import('../lib/spawnlog.js');
const { setDebugSpawns } = await import('../lib/env.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

function engine() {
  const toasts = [];
  return {
    toasts,
    ghEnv: () => ({ ...process.env }),
    resolveAuthForLogin: (id) => ({ kind: 'agy', id }),
    doctor: () => Promise.resolve(),
    emit: (tipo, dados) => { if (tipo === 'toast') toasts.push(dados); },
  };
}

test('link do Google na saída, código pela entrada padrão, token na pasta do perfil', async () => {
  setDebugSpawns(true);
  const e = engine();
  const r = await loginWeb.iniciar(e, 'pl1');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.url, /^https:\/\/accounts\.google\.com\/o\/oauth2\/auth\?/);
  const fim = await loginWeb.enviarCodigo(e, r.loginId, '4/bom-codigo_123');
  assert.deepEqual(fim, { ok: true });
  assert.equal(temLogin('pl1'), true, 'o token foi para ~/.farol/agy/<perfil>');
  assert.ok(fs.existsSync(path.join(AGY_DIR, 'pl1')));
  assert.match(e.toasts.at(-1).text, /Antigravity/);
  for (const t of e.toasts) assert.ok(!t.text.includes('4/bom'), 'o código não vai para o toast');
  setDebugSpawns(false);
  const log = fs.existsSync(SPAWN_LOG_FILE) ? fs.readFileSync(SPAWN_LOG_FILE, 'utf8') : '';
  assert.ok(!log.includes('4/bom'), 'nem para o spawns.log');
});

test('código recusado: o motivo é do Antigravity, sem link nem código', async () => {
  const e = engine();
  const r = await loginWeb.iniciar(e, 'pl2');
  assert.equal(r.ok, true);
  const fim = await loginWeb.enviarCodigo(e, r.loginId, '4/ruim-codigo');
  assert.equal(fim.ok, false);
  assert.equal(fim.code, 'recusado');
  assert.match(fim.motivo, /Antigravity não aceitou o código/);
  assert.equal(temLogin('pl2'), false);
});

test('a forma do código do Google: barra entra, espaço e aspas não', () => {
  assert.equal(agyLogin.codigoValido(' 4/0AVGzR1A-x_y '), '4/0AVGzR1A-x_y');
  assert.equal(agyLogin.codigoValido('4/0A" && rm'), '');
  assert.equal(agyLogin.linkDaSaida('  https://accounts.google.com/o/oauth2/auth?x=1&y=2\n'), 'https://accounts.google.com/o/oauth2/auth?x=1&y=2');
  assert.equal(agyLogin.linkDaSaida('https://outro.site/o/oauth2/auth?x'), '');
});
