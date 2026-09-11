// lib/sync/errors.js: a taxonomia de falha da sincronização entre dispositivos.
// Mesmo motivo de lib/jira/errors.js: quem chama decide (esperar, pedir login de
// novo, avisar) por um código estável, nunca por regex em cima do texto do Firebase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import errors, { SYNC_CODES, MOTIVOS, SyncError, codeFromStatus, codeFromIdentityMessage, motivoDe } from '../lib/sync/errors.js';

test('SYNC_CODES: os catorze códigos do contrato, cada um com frase própria', () => {
  assert.deepEqual(Object.values(SYNC_CODES).sort(), [
    'auth_nao_configurado', 'config_invalida', 'conflito', 'credencial_invalida', 'desligado', 'falha_interna',
    'indisponivel', 'muitas_tentativas', 'nao_autorizado', 'nao_encontrado', 'provedor_desabilitado',
    'resposta_invalida', 'sem_credencial', 'timeout',
  ]);
  for (const code of Object.values(SYNC_CODES)) {
    assert.equal(typeof MOTIVOS[code], 'string', `${code} sem frase`);
    assert.equal(motivoDe(code), MOTIVOS[code]);
    assert.doesNotMatch(MOTIVOS[code], /\u2014/, `${code}: frase com travessão`);
  }
});

test('motivoDe: código desconhecido cai numa frase genérica, nunca undefined', () => {
  assert.equal(motivoDe('nao_existe'), 'falha desconhecida ao falar com o Firebase');
  assert.equal(motivoDe(undefined), 'falha desconhecida ao falar com o Firebase');
});

test('SyncError: é Error, carrega nome e código', () => {
  const e = new SyncError(SYNC_CODES.CONFLITO, 'x mudou');
  assert.ok(e instanceof Error);
  assert.equal(e.name, 'SyncError');
  assert.equal(e.code, 'conflito');
  assert.equal(e.message, 'x mudou');
});

test('codeFromStatus: o mapa do REST do banco', () => {
  assert.equal(codeFromStatus(401), 'nao_autorizado');
  assert.equal(codeFromStatus(404), 'nao_encontrado');
  assert.equal(codeFromStatus(412), 'conflito');
  for (const s of [500, 502, 503, 504, 599]) assert.equal(codeFromStatus(s), 'indisponivel', String(s));
  for (const s of [400, 403, 409, 418, 0, undefined]) assert.equal(codeFromStatus(s), 'resposta_invalida', String(s));
});

test('codeFromIdentityMessage: credencial recusada em todas as grafias do Identity Toolkit', () => {
  for (const m of ['EMAIL_NOT_FOUND', 'INVALID_PASSWORD', 'INVALID_LOGIN_CREDENTIALS', 'USER_DISABLED',
    'USER_NOT_FOUND', 'TOKEN_EXPIRED', 'INVALID_REFRESH_TOKEN']) {
    assert.equal(codeFromIdentityMessage(m), 'credencial_invalida', m);
  }
});

test('codeFromIdentityMessage: compara pelo prefixo antes de " : "', () => {
  assert.equal(codeFromIdentityMessage('TOO_MANY_ATTEMPTS_TRY_LATER : Too many unsuccessful login attempts.'), 'muitas_tentativas');
  assert.equal(codeFromIdentityMessage('USER_DISABLED : The user account has been disabled.'), 'credencial_invalida');
  assert.equal(codeFromIdentityMessage('TOO_MANY_ATTEMPTS_TRY_LATER'), 'muitas_tentativas');
});

test('codeFromIdentityMessage: chave web inválida é config, resto é resposta inesperada', () => {
  assert.equal(codeFromIdentityMessage('API key not valid. Please pass a valid API key.'), 'config_invalida');
  assert.equal(codeFromIdentityMessage('api KEY NOT valid'), 'config_invalida');
  assert.equal(codeFromIdentityMessage('CODIGO_QUE_NAO_EXISTE'), 'resposta_invalida');
  assert.equal(codeFromIdentityMessage(''), 'resposta_invalida');
  assert.equal(codeFromIdentityMessage(undefined), 'resposta_invalida');
});

// A recusa que motivou: com o provedor de e-mail e senha desligado no console, o Firebase
// responde OPERATION_NOT_ALLOWED e a tela dizia "o Firebase respondeu em formato
// inesperado", mandando investigar o fornecedor por uma caixa desmarcada. O projeto sem
// Authentication inicializado tem o mesmo desfecho por outro código.
test('codeFromIdentityMessage: recusa que fala do PROJETO não vira formato inesperado', () => {
  for (const m of ['OPERATION_NOT_ALLOWED', 'PASSWORD_LOGIN_DISABLED', 'ADMIN_ONLY_OPERATION']) {
    assert.equal(codeFromIdentityMessage(m), 'provedor_desabilitado', m);
  }
  assert.equal(codeFromIdentityMessage('OPERATION_NOT_ALLOWED : Password sign-in is disabled.'), 'provedor_desabilitado');
  assert.equal(codeFromIdentityMessage('CONFIGURATION_NOT_FOUND'), 'auth_nao_configurado');
  // as duas frases dizem ONDE resolver, senão trocar o código não muda nada pra quem lê
  assert.match(motivoDe('provedor_desabilitado'), /Authentication/);
  assert.match(motivoDe('auth_nao_configurado'), /Authentication/);
});

test('codeFromIdentityMessage: e-mail ou senha malformados são credencial, não defeito', () => {
  for (const m of ['INVALID_EMAIL', 'MISSING_EMAIL', 'MISSING_PASSWORD']) {
    assert.equal(codeFromIdentityMessage(m), 'credencial_invalida', m);
  }
});

test('export default carrega o mesmo contrato dos nomeados', () => {
  assert.equal(errors.SyncError, SyncError);
  assert.equal(errors.codeFromStatus, codeFromStatus);
  assert.equal(errors.codeFromIdentityMessage, codeFromIdentityMessage);
  assert.equal(errors.motivoDe, motivoDe);
  assert.equal(errors.SYNC_CODES, SYNC_CODES);
});
