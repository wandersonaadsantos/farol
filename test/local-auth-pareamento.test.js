// Código de pareamento da API local (A4, spec 7.A4 item 3): 10 caracteres base32,
// 10 minutos, uso único, invalidado depois de 5 tentativas erradas, e só o hash com sal
// em disco. FAROL_HOME temporário ANTES do import (test/test-isolation.test.js).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = path.join(os.tmpdir(), 'farol-test-local-auth-pareamento-' + process.pid);
process.env.FAROL_HOME = HOME;

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
const { criarCodigo, consumirCodigo, revogarCodigos, pareamentosPath } = await import('../lib/local-auth/pareamento.js');
const { LOCAL_AUTH_DIR } = await import('../lib/paths.js');
const { TEMPOS } = await import('../lib/constants.js');

const T0 = 1_760_000_000_000;

beforeEach(() => { fs.rmSync(LOCAL_AUTH_DIR, { recursive: true, force: true }); });
after(() => { fs.rmSync(HOME, { recursive: true, force: true }); });

test('o código tem 10 caracteres base32 e o arquivo fica dentro do FAROL_HOME', () => {
  const codigo = criarCodigo(T0);
  assert.match(codigo, /^[A-Z2-7]{10}$/);
  assert.ok(pareamentosPath().startsWith(HOME), 'nunca o ~/.farol real');
});

test('em disco fica só o hash com sal, nunca o código', () => {
  const codigo = criarCodigo(T0);
  const texto = fs.readFileSync(pareamentosPath(), 'utf8');
  assert.equal(texto.includes(codigo), false, 'o código em claro não pode ir para o disco');
  const [registro] = JSON.parse(texto);
  assert.deepEqual(Object.keys(registro).sort(), ['criadoEm', 'erros', 'expiraEm', 'hash', 'sal']);
  assert.match(registro.hash, /^[0-9a-f]{64}$/);
  assert.equal(registro.expiraEm, T0 + TEMPOS.PAREAMENTO_VALIDADE_MS);
});

test('o código funciona uma vez só', () => {
  const codigo = criarCodigo(T0);
  assert.equal(consumirCodigo(codigo, T0 + 1000), true);
  assert.equal(consumirCodigo(codigo, T0 + 2000), false);
});

test('caixa, espaço e hífen digitados não atrapalham', () => {
  const codigo = criarCodigo(T0);
  const digitado = ` ${codigo.slice(0, 5).toLowerCase()}-${codigo.slice(5)} `;
  assert.equal(consumirCodigo(digitado, T0 + 1000), true);
});

test('o código não funciona depois do prazo', () => {
  const noLimite = criarCodigo(T0);
  assert.equal(consumirCodigo(noLimite, T0 + TEMPOS.PAREAMENTO_VALIDADE_MS), false, 'no instante do vencimento já não vale');
  const antes = criarCodigo(T0);
  assert.equal(consumirCodigo(antes, T0 + TEMPOS.PAREAMENTO_VALIDADE_MS - 1), true, 'um milissegundo antes ainda vale');
});

test('5 tentativas erradas invalidam o código', () => {
  const codigo = criarCodigo(T0);
  for (let i = 0; i < 5; i++) assert.equal(consumirCodigo('AAAAAAAAAA', T0 + i), false);
  assert.equal(consumirCodigo(codigo, T0 + 10), false, 'depois do quinto erro o código certo não entra');
});

test('4 tentativas erradas ainda deixam o código valer', () => {
  const codigo = criarCodigo(T0);
  for (let i = 0; i < 4; i++) consumirCodigo('AAAAAAAAAA', T0 + i);
  assert.equal(consumirCodigo(codigo, T0 + 10), true);
});

test('tentativa com tamanho errado também conta como erro', () => {
  const codigo = criarCodigo(T0);
  for (let i = 0; i < 5; i++) consumirCodigo('X', T0 + i);
  assert.equal(consumirCodigo(codigo, T0 + 10), false);
});

test('tentativa sem código pendente não cria arquivo', () => {
  assert.equal(consumirCodigo('AAAAAAAAAA', T0), false);
  assert.equal(fs.existsSync(pareamentosPath()), false);
});

test('revogarCodigos invalida os pendentes', () => {
  const codigo = criarCodigo(T0);
  revogarCodigos();
  assert.equal(consumirCodigo(codigo, T0 + 1000), false);
});

test('o arquivo de pareamentos nunca fica legível por outros', { skip: process.platform === 'win32' }, () => {
  criarCodigo(T0);
  assert.equal(fs.statSync(pareamentosPath()).mode & 0o777, 0o600);
  consumirCodigo('AAAAAAAAAA', T0 + 1);
  assert.equal(fs.statSync(pareamentosPath()).mode & 0o777, 0o600, 'a regravação restringe de novo');
  assert.equal(fs.statSync(LOCAL_AUTH_DIR).mode & 0o777, 0o700);
});
