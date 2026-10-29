// Bind configurável (web): o motor escuta no endereço de config.bind, a allowlist de Host
// e Origin aceita esse endereço (além do loopback, que segue valendo) e a autenticação
// local passa a ser exigida sempre que o bind sai do loopback.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-bind-'));
process.env.FAROL_HOME = HOME;
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { sanearBind } = await import('../lib/parse.js');
const { validarHostEOrigem, loopback } = await import('../lib/http-guard.js');
const { exigeAutenticacao } = await import('../lib/local-auth/modo.js');
const { sanear, paraGravar } = await import('../lib/settings.js');
const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');

after(() => fs.rmSync(HOME, { recursive: true, force: true }));

test('sanearBind aceita IP e host e cai em loopback no resto', () => {
  assert.equal(sanearBind('0.0.0.0'), '0.0.0.0'); assert.equal(sanearBind('farol.interno'), 'farol.interno'); assert.equal(sanearBind('[::1]'), '[::1]');
  for (const v of ['0.0.0.0:80', 'http://x', '', undefined, 'a b']) assert.equal(sanearBind(v), '127.0.0.1');
  assert.equal(sanearBind('Farol.Interno'), 'farol.interno', 'o navegador manda o Host em caixa baixa');
});

test('bind [::1]: o Host do IPv6 entra na allowlist e o 127.0.0.1 segue valendo', () => {
  assert.equal(validarHostEOrigem({ host: '[::1]:47170', origin: 'http://[::1]:47170', porta: 47170, bind: '[::1]' }).ok, true);
  assert.equal(validarHostEOrigem({ host: '127.0.0.1:47170', porta: 47170, bind: '[::1]' }).ok, true);
  assert.equal(validarHostEOrigem({ host: '[::1]:47170', porta: 47170 }).ok, false, 'sem bind, [::1] segue fora');
});

test('bind no padrão não é gravado no config.json', () => {
  assert.equal('bind' in paraGravar({ bind: '127.0.0.1', port: 47170 }), false);
  assert.equal(paraGravar({ bind: 'farol.interno' }).bind, 'farol.interno');
});

test('a tabela de preferências saneia bind com sanearBind', () => {
  assert.equal(sanear('bind', 'http://x', {}, { sanearBind }), '127.0.0.1');
  assert.equal(sanear('bind', 'farol.interno', {}, { sanearBind }), 'farol.interno');
});

test('com bind fora do loopback a allowlist aceita o host do bind e nada mais', () => {
  const ok = validarHostEOrigem({ host: 'farol.interno:47170', origin: 'https://farol.interno', porta: 47170, bind: 'farol.interno' });
  assert.equal(ok.ok, true);
  assert.equal(validarHostEOrigem({ host: 'outro:47170', porta: 47170, bind: 'farol.interno' }).ok, false);
  assert.equal(validarHostEOrigem({ host: '127.0.0.1:47170', porta: 47170, bind: 'farol.interno' }).ok, true, 'loopback continua valendo');
  assert.equal(validarHostEOrigem({ host: 'farol.interno:47170', origin: 'http://farol.interno:47170', porta: 47170, bind: 'farol.interno' }).ok, true);
  assert.deepEqual(validarHostEOrigem({ host: 'farol.interno:47170', origin: 'https://outro', porta: 47170, bind: 'farol.interno' }), { ok: false, motivo: 'origin' });
  assert.equal(validarHostEOrigem({ host: 'farol.interno:47170', porta: 47170 }).ok, false, 'sem bind o host de fora segue recusado');
});

test('loopback: os três nomes locais e o bind ausente', () => {
  for (const v of ['127.0.0.1', 'localhost', '[::1]', undefined, null, '']) assert.equal(loopback(v), true, String(v));
  for (const v of ['0.0.0.0', 'farol.interno']) assert.equal(loopback(v), false, v);
});

test('bind fora do loopback exige autenticação', () => {
  assert.equal(exigeAutenticacao({ modoCelular: false, config: {}, ativacaoAutomatica: true, bindForaDoLoopback: true }), true);
  assert.equal(exigeAutenticacao({ modoCelular: false, config: {}, ativacaoAutomatica: true, bindForaDoLoopback: false }), false);
});

test('o servidor escuta no bind configurado', async () => {
  const engine = new Engine();
  assert.equal(engine.config.bind, '127.0.0.1', 'padrão da tabela');
  engine.config.port = 0;
  const server = await new Promise((resolve, reject) => {
    const s = startServer(engine, (url, err) => (err ? reject(err) : resolve(s)));
  });
  try {
    assert.equal(server.address().address, '127.0.0.1');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(() => resolve()));
  }
});
