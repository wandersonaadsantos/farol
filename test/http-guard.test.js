// C1a: a allowlist de Host e Origin da API local, como função PURA
// (lib/http-guard.js). Sem servidor, sem FAROL_HOME: o módulo não importa nada do
// repo. O servidor real é coberto em test/http-host-allowlist.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarHostEOrigem } from '../lib/http-guard.js';

const PORTA = 51234;
const RECUSA_HOST = { ok: false, motivo: 'host' };
const RECUSA_ORIGIN = { ok: false, motivo: 'origin' };

test('aceita 127.0.0.1 e localhost na porta efetiva, sem Origin', () => {
  assert.deepEqual(validarHostEOrigem({ host: `127.0.0.1:${PORTA}`, porta: PORTA }), { ok: true });
  assert.deepEqual(validarHostEOrigem({ host: `localhost:${PORTA}`, porta: PORTA }), { ok: true });
});

test('aceita Origin da própria origem nos dois nomes (Electron em POST e navegador local)', () => {
  assert.deepEqual(validarHostEOrigem({ host: `127.0.0.1:${PORTA}`, origin: `http://127.0.0.1:${PORTA}`, porta: PORTA }), { ok: true });
  assert.deepEqual(validarHostEOrigem({ host: `localhost:${PORTA}`, origin: `http://localhost:${PORTA}`, porta: PORTA }), { ok: true });
  // o Host diz a quem a requisição chegou; o Origin diz de onde a página veio.
  // Os dois nomes são a mesma máquina, então a combinação cruzada também é local.
  assert.deepEqual(validarHostEOrigem({ host: `127.0.0.1:${PORTA}`, origin: `http://localhost:${PORTA}`, porta: PORTA }), { ok: true });
});

test('recusa host de outro nome com motivo host (DNS rebinding e afins)', () => {
  for (const host of [`evil.example:${PORTA}`, `rebinding.evil.example:${PORTA}`, `0.0.0.0:${PORTA}`, `[::1]:${PORTA}`, '127.0.0.1', 'localhost']) {
    assert.deepEqual(validarHostEOrigem({ host, porta: PORTA }), RECUSA_HOST, host);
  }
});

test('recusa o host local em outra porta', () => {
  assert.deepEqual(validarHostEOrigem({ host: `127.0.0.1:${PORTA + 1}`, porta: PORTA }), RECUSA_HOST);
  assert.deepEqual(validarHostEOrigem({ host: `localhost:${PORTA - 1}`, porta: PORTA }), RECUSA_HOST);
});

test('não há curinga: prefixo, sufixo e variação do nome não passam', () => {
  for (const host of [`127.0.0.1.evil.example:${PORTA}`, `evil.localhost:${PORTA}`, `localhost.:${PORTA}`, `LOCALHOST:${PORTA}`, `127.0.0.1:${PORTA}0`, ` 127.0.0.1:${PORTA}`]) {
    assert.deepEqual(validarHostEOrigem({ host, porta: PORTA }), RECUSA_HOST, JSON.stringify(host));
  }
});

test('recusa host ausente, vazio ou de tipo errado', () => {
  assert.deepEqual(validarHostEOrigem({ porta: PORTA }), RECUSA_HOST);
  assert.deepEqual(validarHostEOrigem({ host: '', porta: PORTA }), RECUSA_HOST);
  assert.deepEqual(validarHostEOrigem({ host: [`127.0.0.1:${PORTA}`], porta: PORTA }), RECUSA_HOST);
  assert.deepEqual(validarHostEOrigem(), RECUSA_HOST);
});

test('recusa Origin externo, de outra porta, https, "null" e vazio com motivo origin', () => {
  const host = `127.0.0.1:${PORTA}`;
  for (const origin of ['https://evil.example', `http://evil.example:${PORTA}`, `http://127.0.0.1:${PORTA + 1}`, `https://127.0.0.1:${PORTA}`, `http://127.0.0.1:${PORTA}/`, 'null', '']) {
    assert.deepEqual(validarHostEOrigem({ host, origin, porta: PORTA }), RECUSA_ORIGIN, JSON.stringify(origin));
  }
});

test('Host inválido vence Origin inválido: o motivo é host', () => {
  assert.deepEqual(validarHostEOrigem({ host: `evil.example:${PORTA}`, origin: 'https://evil.example', porta: PORTA }), RECUSA_HOST);
});

test('porta inválida recusa até o host certo (falta de porta provada não libera)', () => {
  for (const porta of [0, -1, 65536, Number.NaN, String(PORTA), undefined, null]) {
    assert.deepEqual(validarHostEOrigem({ host: `127.0.0.1:${porta}`, porta }), RECUSA_HOST, String(porta));
  }
});
