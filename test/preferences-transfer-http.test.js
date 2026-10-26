import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { baseConfig, fieldCases } from './helpers/preferences-cases.js';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-preferences-http-'));
process.env.FAROL_HOME = home;
const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const { CONFIG_FILE } = await import('../lib/paths.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));

test('todos os campos e opções percorrem a rota HTTP e persistem a seleção da prévia', async () => {
  const engine = new Engine(); engine.config = baseConfig(); engine.config.port = 0;
  engine.log = () => {}; engine.pushState = () => {}; engine.checkNow = () => {};
  engine.doctor = async () => {}; engine.syncAplicarConfig = () => {};
  const server = startServer(engine); await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${server.address().port}/api/preferences/transfer`;
  const send = async body => {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-farol': '1' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200); return response.json();
  };
  let scenarios = 0;
  try {
    for (const [key, candidates] of Object.entries(fieldCases())) for (const value of candidates) {
      engine.config = baseConfig(); engine.config.port = server.address().port;
      if (key === 'accounts' && value.length === 0) { engine.config.ghUser = ''; engine.config.accounts = []; }
      const document = { type: 'farol-preferences', schema: 2, values: { [key]: value } };
      const preview = await send({ action: 'preview', document });
      assert.equal(preview.ok, true, `${key}: ${preview.error}`);
      scenarios++;
      if (!preview.changes.length) continue;
      const result = await send({ action: 'apply', document, token: preview.token, keys: [key] });
      assert.equal(result.ok, true, `${key}: ${result.error}`);
      assert.deepEqual(result.values[key], preview.changes[0].incoming, key);
      const stored = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      assert.deepEqual(stored[key], engine.config[key], key);
      assert.deepEqual((await send({ action: 'preview', document })).changes, [], key);
      const exported = await send({ action: 'export' });
      assert.equal(exported.ok, true, key); assert.doesNotMatch(JSON.stringify(exported), /synthetic-private|synthetic-sync-key|apiKey/);
    }
    console.log(`HTTP: ${scenarios} cenários em ${Object.keys(fieldCases()).length} campos.`);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
