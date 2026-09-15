// Sessões da API local (A4, spec 7.A4 item 4): só o hash do token em disco, expiração
// com 30 dias sem uso ou 90 desde a criação, revogação total e sobrevivência a reinício
// (o arquivo é a fonte; nenhum cache em memória). FAROL_HOME temporário antes do import.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = path.join(os.tmpdir(), 'farol-test-local-auth-sessoes-' + process.pid);
process.env.FAROL_HOME = HOME;

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
const { emitirSessao, verificarSessao, revogarTodas, sessoesPath } = await import('../lib/local-auth/sessoes.js');
const { LOCAL_AUTH_DIR } = await import('../lib/paths.js');
const { TEMPOS } = await import('../lib/constants.js');

const T0 = 1_760_000_000_000;
const DIA = TEMPOS.DIA_MS;

beforeEach(() => { fs.rmSync(LOCAL_AUTH_DIR, { recursive: true, force: true }); });
after(() => { fs.rmSync(HOME, { recursive: true, force: true }); });

test('o token tem 32 bytes em base64url e o arquivo guarda só o hash', () => {
  const token = emitirSessao('celular', T0);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const texto = fs.readFileSync(sessoesPath(), 'utf8');
  assert.equal(texto.includes(token), false, 'o token em claro não pode ir para o disco');
  const [s] = JSON.parse(texto);
  assert.deepEqual(Object.keys(s).sort(), ['criadoEm', 'hash', 'rotulo', 'ultimoUsoEm']);
  assert.match(s.hash, /^[0-9a-f]{64}$/);
  assert.equal(s.rotulo, 'celular');
});

test('token válido passa; errado, malformado ou vazio não', () => {
  const token = emitirSessao('', T0);
  assert.equal(verificarSessao(token, T0 + 1), true);
  assert.equal(verificarSessao('A'.repeat(43), T0 + 1), false);
  assert.equal(verificarSessao(token + 'x', T0 + 1), false);
  assert.equal(verificarSessao('', T0 + 1), false);
  assert.equal(verificarSessao(undefined, T0 + 1), false);
});

test('30 dias sem uso expiram a sessão', () => {
  const ociosa = emitirSessao('', T0);
  assert.equal(verificarSessao(ociosa, T0 + TEMPOS.SESSAO_LOCAL_OCIOSA_MS), false);
  const quase = emitirSessao('', T0);
  assert.equal(verificarSessao(quase, T0 + TEMPOS.SESSAO_LOCAL_OCIOSA_MS - 1), true);
});

test('90 dias desde a criação expiram a sessão mesmo com uso contínuo', () => {
  const token = emitirSessao('', T0);
  for (const dia of [20, 40, 60, 80]) assert.equal(verificarSessao(token, T0 + dia * DIA), true, `uso no dia ${dia}`);
  assert.equal(verificarSessao(token, T0 + 89 * DIA), true, 'dia 89 ainda vale');
  assert.equal(verificarSessao(token, T0 + TEMPOS.SESSAO_LOCAL_ABSOLUTA_MS), false, 'dia 90 não vale mais');
});

test('o último uso só é regravado depois da folga', () => {
  const token = emitirSessao('', T0);
  const antes = fs.readFileSync(sessoesPath(), 'utf8');
  verificarSessao(token, T0 + TEMPOS.SESSAO_LOCAL_TOQUE_MS - 1);
  assert.equal(fs.readFileSync(sessoesPath(), 'utf8'), antes, 'uso dentro da folga não reescreve o arquivo');
  verificarSessao(token, T0 + TEMPOS.SESSAO_LOCAL_TOQUE_MS);
  assert.equal(JSON.parse(fs.readFileSync(sessoesPath(), 'utf8'))[0].ultimoUsoEm, T0 + TEMPOS.SESSAO_LOCAL_TOQUE_MS);
});

test('revogarTodas derruba toda sessão, e a verificação lê o disco a cada chamada', () => {
  const a = emitirSessao('a', T0);
  const b = emitirSessao('b', T0);
  revogarTodas();
  assert.equal(verificarSessao(a, T0 + 1), false);
  assert.equal(verificarSessao(b, T0 + 1), false);
});

test('rótulo é cortado em 60 caracteres', () => {
  emitirSessao('x'.repeat(200), T0);
  assert.equal(JSON.parse(fs.readFileSync(sessoesPath(), 'utf8'))[0].rotulo.length, 60);
});

test('emitir uma sessão nova poda as expiradas', () => {
  emitirSessao('velha', T0);
  emitirSessao('nova', T0 + TEMPOS.SESSAO_LOCAL_OCIOSA_MS);
  const lista = JSON.parse(fs.readFileSync(sessoesPath(), 'utf8'));
  assert.deepEqual(lista.map(s => s.rotulo), ['nova']);
});

test('o arquivo de sessões nunca fica legível por outros', { skip: process.platform === 'win32' }, () => {
  const token = emitirSessao('', T0);
  assert.equal(fs.statSync(sessoesPath()).mode & 0o777, 0o600);
  verificarSessao(token, T0 + TEMPOS.SESSAO_LOCAL_TOQUE_MS);
  assert.equal(fs.statSync(sessoesPath()).mode & 0o777, 0o600, 'o toque regrava e restringe de novo');
});
