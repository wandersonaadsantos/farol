// Motor como sidecar de casca nativa (FAROL_SHELL): a API local exige autenticação sem
// nenhuma config, e a allowlist de Host continua aceitando o loopback. Arquivo próprio
// porque FAROL_SHELL vale para o processo inteiro e precisa estar posto antes dos imports.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-bind-casca-'));
process.env.FAROL_HOME = HOME;
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.FAROL_SHELL = 'mac';

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');

after(() => fs.rmSync(HOME, { recursive: true, force: true }));

function pedir(porta, rota) {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${porta}${rota}`, { method: 'GET', headers: { 'x-farol': '1' } }, res => {
      let d = ''; res.on('data', c => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('no modo casca, /api/state sem Bearer é recusado e o loopback passa pela allowlist', async () => {
  const engine = new Engine();
  engine.config.port = 0;
  const server = await new Promise((resolve, reject) => {
    const s = startServer(engine, (url, err) => (err ? reject(err) : resolve(s)));
  });
  try {
    const r = await pedir(server.address().port, '/api/state');
    assert.equal(r.status, 401, 'quem recusa é o porteiro da A4, não a allowlist (que daria 403)');
    assert.deepEqual(JSON.parse(r.body), { error: 'nao_autenticado' });
    assert.equal(engine.estadoDasCapacidades().autenticacaoLocal.exigida, true, 'o snapshot diz a verdade');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(() => resolve()));
  }
});
