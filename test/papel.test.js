import test from 'node:test';
import assert from 'node:assert/strict';
import { ehObservador } from '../lib/sync/papel.js';
import { souObservador } from '../lib/engine/papel-do-aparelho.js';

test('com sinal: observador se e só se o admin é este aparelho', () => {
  assert.equal(ehObservador({ adminDev: 'd1', deviceId: 'd1', temChaveDeAdmin: false }), true);
  assert.equal(ehObservador({ adminDev: 'd2', deviceId: 'd1', temChaveDeAdmin: true }), false);
});
test('sem sinal: a chave local decide, falhando fechado', () => {
  assert.equal(ehObservador({ adminDev: '', deviceId: 'd1', temChaveDeAdmin: true }), true);
  assert.equal(ehObservador({ adminDev: '', deviceId: 'd1', temChaveDeAdmin: false }), false);
});
test('sem deviceId não há papel de admin', () => {
  assert.equal(ehObservador({ adminDev: 'd1', deviceId: '', temChaveDeAdmin: false }), false);
});

test('souObservador: com sinal do admin não lê a chave local', () => {
  let chamadas = 0;
  const lerChaveInjetada = () => {
    chamadas++;
    return null;
  };
  const agora = 1000;
  // Engine com compartilhamento ativo, sinal do admin presente
  const engine = {
    config: { sync: { enabled: true, shared: { enabled: true } } },
    sync: {
      deviceId: 'd1',
      sinais: { admin: { dev: 'd2' } }
    }
  };
  // Primeira chamada com sinal: não deve ler a chave
  const resultado = souObservador(engine, { lerChave: lerChaveInjetada, agora });
  assert.equal(chamadas, 0, 'não deve chamar lerChave quando há sinal do admin');
  assert.equal(resultado, false, 'não é observador quando admin é outro aparelho');
});

test('souObservador: sem sinal do admin lê a chave local na primeira vez', () => {
  let chamadas = 0;
  const lerChaveInjetada = () => {
    chamadas++;
    return { uid: 'admin1' };
  };
  const agora = 1000;
  // Engine com compartilhamento ativo, sem sinal do admin
  const engine = {
    config: { sync: { enabled: true, shared: { enabled: true } } },
    sync: {
      deviceId: 'd1',
      sinais: { admin: { dev: '' } }
    }
  };
  // Primeira chamada sem sinal: deve ler a chave
  souObservador(engine, { lerChave: lerChaveInjetada, agora });
  assert.equal(chamadas, 1, 'deve chamar lerChave na primeira vez sem sinal');

  // Segunda chamada (dentro de 5s): não deve ler novamente
  souObservador(engine, { lerChave: lerChaveInjetada, agora: agora + 2000 });
  assert.equal(chamadas, 1, 'não deve chamar lerChave se memo não expirou');

  // Terceira chamada (depois de 5s): deve ler novamente
  souObservador(engine, { lerChave: lerChaveInjetada, agora: agora + 5001 });
  assert.equal(chamadas, 2, 'deve chamar lerChave se memo expirou');
});
