// O SSE escreve o cabeçalho 200 antes de montar o retrato. Se o retrato lançava, o catch do
// servidor tentava responder 500 numa resposta já começada, o writeHead lançava dentro do catch
// e a rejeição sem tratamento derrubava o processo (porte do fork, 24/11/2026). Agora a conexão é
// fechada, o cliente reconecta, e o servidor segue respondendo.
// FAROL_HOME temporário ANTES do import do engine, e HOME junto (o boot escreve ~/.claude.json).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-sse-lanca-'));
process.env.FAROL_HOME = HOME;
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');

let engine, server, porta;

before(async () => {
  engine = new Engine();
  engine.config.port = 0;
  await new Promise((resolve, reject) => {
    server = startServer(engine, (url, err) => (err ? reject(err) : resolve()));
  });
  porta = server.address().port;
});

after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(() => resolve()));
  fs.rmSync(HOME, { recursive: true, force: true });
});

function pedir(caminho) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: 'GET', headers: { 'x-farol': '1' } }, (res) => {
      let corpo = '';
      res.on('data', (c) => { corpo += c; });
      res.on('end', () => resolve({ status: res.statusCode, corpo, fechou: false }));
      res.on('error', () => resolve({ status: res.statusCode, corpo, fechou: true }));
      res.on('aborted', () => resolve({ status: res.statusCode, corpo, fechou: true }));
    });
    req.on('error', () => resolve({ status: 0, corpo: '', fechou: true }));
    // com o defeito antigo a conexão ficava pendurada: o prazo faz o teste falhar em vez de travar
    req.setTimeout(5000, () => { req.destroy(); resolve({ status: 0, corpo: '', fechou: true, pendurou: true }); });
    req.end();
  });
}

test('retrato que lança depois do 200 fecha a conexão e o processo segue de pé', async () => {
  const original = engine.snapshot;
  const linhas = [];
  const logOriginal = engine.log;
  engine.log = (nivel, msg) => { linhas.push(`${nivel} ${msg}`); };
  engine.snapshot = () => { throw new Error('falha de propósito no retrato'); };
  try {
    const sse = await pedir('/api/events');
    // o 200 já tinha sido escrito; destruída a resposta antes do primeiro byte, o cliente vê a
    // conexão fechada, e nenhum 500 chega por cima do 200
    assert.notEqual(sse.pendurou, true, 'a conexão é fechada, não fica pendurada');
    assert.notEqual(sse.status, 500);
    assert.ok(!sse.corpo.includes('event: state'), 'nenhum evento chegou');
    assert.ok(linhas.some(l => /^ERROR http \/api\/events: falha de propósito/.test(l)), 'a falha vai ao log');
  } finally {
    engine.snapshot = original;
    engine.log = logOriginal;
  }
  // o processo não caiu: o servidor continua respondendo, e o SSE volta a funcionar
  const depois = await pedir('/api/auth/status');
  assert.equal(depois.status, 200);
});
