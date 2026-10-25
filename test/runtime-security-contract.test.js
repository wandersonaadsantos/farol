// Contrato da distribuição: o npm não substitui os componentes embarcados.
import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { packageElectronRequirement, requiredElectronVersion, assertElectronRuntime } from '../lib/electron-runtime.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

test('manifesto, lock e piso do smoke exigem o Electron com a mitigação TLS', () => {
  const range = packageElectronRequirement(fileURLToPath(new URL('../package.json', import.meta.url)));
  assert.equal(range, '^44.9.3');
  assert.equal(lock.packages[''].dependencies.electron, range);
  assert.equal(lock.packages['node_modules/electron'].version, requiredElectronVersion(range));
  assert.throws(() => assertElectronRuntime('44.9.2', range), /incompatível/);
  assert.equal(assertElectronRuntime('44.9.3', range), '44.9.3');
});

test('Undici opcional fica no range do downloader com patch de segurança, sem dependência direta ou override', () => {
  const get = lock.packages['node_modules/@electron/get'];
  assert.equal(get.optionalDependencies.undici, '^7.24.4');
  const [major, minor, patch] = lock.packages['node_modules/undici'].version.split('.').map(Number);
  assert.equal(major, 7);
  assert.ok(minor > 30 || (minor === 30 && patch >= 1));
  assert.equal(pkg.dependencies.undici, undefined);
  assert.equal(pkg.overrides, undefined);
});
