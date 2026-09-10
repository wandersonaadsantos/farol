import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-update-runtime-'));
process.env.FAROL_HOME = path.join(scratch, 'installed');
const launches = [];
const originalSpawn = cp.spawn;
cp.spawn = (...args) => { launches.push(args); return { unref() {} }; };
syncBuiltinESMExports();
const update = (await import('../lib/engine/update.js')).default;
after(() => {
  cp.spawn = originalSpawn;
  syncBuiltinESMExports();
  fs.rmSync(scratch, { recursive: true, force: true });
});
beforeEach(() => {
  launches.length = 0;
  fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true });
});

function fixture(range = '^44.1.0') {
  const source = fs.mkdtempSync(path.join(scratch, 'source-'));
  fs.mkdirSync(path.join(source, 'installer'));
  for (const file of ['install.ps1', 'install.sh', 'install-linux.sh']) fs.writeFileSync(path.join(source, 'installer', file), 'stub');
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'farol', version: '9.9.9', dependencies: { electron: range } }));
  const oldApp = path.join(process.env.FAROL_HOME, 'app', 'package.json');
  fs.mkdirSync(path.dirname(oldApp), { recursive: true });
  fs.writeFileSync(oldApp, 'versão atual preservada');
  fs.mkdirSync(path.dirname(update.REABRIR_SILENCIOSO), { recursive: true });
  const engine = { config: {}, activeReviews: new Map(), headlessBusyAccounts: new Map(), running: new Map(), headlessQueue: [],
    emit() {}, pushState() {} };
  const deps = { checkUpdate: async e => { e.update = { channel: 'remote', available: true, sourceVersion: '9.9.9' }; },
    downloadRemoteUpdate: async () => source };
  return { source, oldApp, engine, deps };
}

test('update leve recusa runtime antigo antes de script, marcador, instalador ou alteração da instalação', async () => {
  const { engine, deps, oldApp } = fixture();
  const result = await update.applyUpdate(engine, { ...deps, electronVersion: '43.1.0' });
  assert.equal(result.ok, false);
  assert.match(result.error, /Electron 43\.1\.0 incompatível com \^44\.1\.0/);
  assert.match(result.error, /instalador completo/);
  assert.equal(launches.length, 0);
  assert.equal(fs.existsSync(update.REABRIR_SILENCIOSO), false);
  assert.equal(fs.existsSync(path.join(process.env.FAROL_HOME, 'sessions')), false);
  assert.equal(fs.readFileSync(oldApp, 'utf8'), 'versão atual preservada');
  assert.equal(engine.updateApplying, false);
});

test('runtime compatível libera o lançamento existente e preserva o estado até o instalador executar', async () => {
  const { engine, deps, oldApp } = fixture();
  const result = await update.applyUpdate(engine, { ...deps, electronVersion: '44.1.0' });
  assert.equal(result.ok, true);
  assert.equal(launches.length, 1, 'spawn interceptado; nenhum instalador real executado');
  assert.equal(fs.existsSync(update.REABRIR_SILENCIOSO), true);
  assert.equal(fs.readFileSync(oldApp, 'utf8'), 'versão atual preservada');
});

test('manifesto sem requisito verificável e runtime desconhecido falham antes do instalador', async () => {
  for (const [range, electronVersion] of [[undefined, '44.1.0'], ['latest', '44.1.0'], ['^44.1.0', '']]) {
    const { engine, deps, source } = fixture(range);
    if (range === undefined) fs.writeFileSync(path.join(source, 'package.json'), '{}');
    const result = await update.applyUpdate(engine, { ...deps, electronVersion });
    assert.equal(result.ok, false);
    assert.match(result.error, /instalador completo/);
    assert.equal(launches.length, 0);
    assert.equal(fs.existsSync(update.REABRIR_SILENCIOSO), false);
  }
});
