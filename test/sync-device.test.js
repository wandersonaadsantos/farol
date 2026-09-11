// lib/sync/device.js: a identidade persistente deste aparelho na sincronização.
// O deviceId nasce uma vez e sobrevive a reinício: é ele que diz "este lease é meu"
// e separa os eventos de consumo de cada aparelho no banco.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = path.join(os.tmpdir(), 'farol-test-sync-device-' + process.pid);
process.env.FAROL_HOME = HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
const { devicePath, ensureDevice, readDevice } = await import('../lib/sync/device.js');

after(() => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });
beforeEach(() => { try { fs.rmSync(devicePath(), { force: true }); } catch { /* best-effort */ } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('devicePath: arquivo em workspace/state', () => {
  assert.equal(devicePath(), path.join(HOME, 'workspace', 'state', 'sync-device.json'));
});

test('readDevice: sem arquivo não inventa aparelho', () => {
  assert.equal(readDevice(), null);
});

test('ensureDevice: cria na primeira chamada e grava em disco', () => {
  const antes = Date.now();
  const d = ensureDevice();
  assert.match(d.deviceId, UUID);
  assert.ok(d.createdAt >= antes);
  assert.ok(fs.existsSync(devicePath()));
  assert.deepEqual(readDevice(), d);
});

test('ensureDevice: chamadas seguintes devolvem o MESMO aparelho', () => {
  const a = ensureDevice();
  const b = ensureDevice();
  assert.deepEqual(b, a);
});

test('arquivo corrompido ou com id inválido como chave do banco vira aparelho novo', () => {
  fs.mkdirSync(path.dirname(devicePath()), { recursive: true });
  for (const cru of ['{ quebrado', '[]', JSON.stringify({ deviceId: 'a/b', createdAt: 1 }), JSON.stringify({ createdAt: 1 })]) {
    fs.writeFileSync(devicePath(), cru);
    assert.equal(readDevice(), null, cru);
    const d = ensureDevice();
    assert.match(d.deviceId, UUID, cru);
  }
});
