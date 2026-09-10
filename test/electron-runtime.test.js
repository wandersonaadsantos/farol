import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { requiredElectronVersion, electronVersionSatisfies, packageElectronRequirement, checkElectronPackage } from '../lib/electron-runtime.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-runtime-contract-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const cli = path.resolve(import.meta.dirname, '../lib/electron-runtime.js');

function pacote(version, distributed = version) {
  const root = fs.mkdtempSync(path.join(scratch, 'package-'));
  fs.mkdirSync(path.join(root, 'node_modules/electron/dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { electron: '^44.1.0' } }));
  fs.writeFileSync(path.join(root, 'node_modules/electron/package.json'), JSON.stringify({ version }));
  fs.writeFileSync(path.join(root, 'node_modules/electron/dist/version'), distributed);
  return root;
}

test('range do Electron aceita o mínimo e a mesma major, recusando runtime antigo ou futura major', () => {
  assert.equal(requiredElectronVersion('^44.1.0'), '44.1.0');
  for (const version of ['44.1.0', '44.1.3', '44.2.0']) assert.equal(electronVersionSatisfies(version, '^44.1.0'), true);
  for (const version of ['43.1.0', '44.0.9', '45.0.0', '44.1.0-beta.1', '', undefined]) {
    assert.equal(electronVersionSatisfies(version, '^44.1.0'), false, String(version));
  }
});

test('versão exata, tilde e caret antes de 1.0 mantêm suas fronteiras', () => {
  assert.equal(electronVersionSatisfies('44.1.1', '44.1.0'), false);
  assert.equal(electronVersionSatisfies('44.1.1', '~44.1.0'), true);
  assert.equal(electronVersionSatisfies('44.2.0', '~44.1.0'), false);
  assert.equal(electronVersionSatisfies('0.2.9', '^0.2.1'), true);
  assert.equal(electronVersionSatisfies('0.3.0', '^0.2.1'), false);
  assert.equal(electronVersionSatisfies('0.0.2', '^0.0.1'), false);
});

test('range ausente ou não suportado não vira compatibilidade presumida', () => {
  for (const range of ['', undefined, '*', 'latest', '>=44', '^44.01.0', '44.1.0 || 43.0.0']) {
    assert.throws(() => requiredElectronVersion(range), /ausente ou não suportado/);
  }
});

test('manifesto truncado ou com forma inválida falha explicitamente', () => {
  const root = pacote('44.1.0');
  const file = path.join(root, 'package.json');
  for (const text of ['{"dependencies":', 'null', '[]', '"^44.1.0"']) {
    fs.writeFileSync(file, text);
    assert.throws(() => packageElectronRequirement(file), /Não foi possível ler o manifesto/);
    assert.equal(fs.readFileSync(file, 'utf8'), text);
  }
});

test('builder recusa node_modules antigo e dist diferente do package, sem modificar os artefatos', () => {
  const old = pacote('43.1.0');
  const mismatch = pacote('44.1.0', '43.1.0');
  for (const root of [old, mismatch]) {
    const file = path.join(root, 'node_modules/electron/dist/version');
    const before = fs.readFileSync(file, 'utf8');
    assert.throws(() => checkElectronPackage(root, true), /incompatível/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  }
  assert.equal(checkElectronPackage(pacote('44.1.0'), true), '44.1.0');
  assert.equal(checkElectronPackage(pacote('44.1.0', 'v44.1.0'), true), '44.1.0');
});

test('CLI comunica mínimo, compatibilidade e falha; Node comum não prova runtime Electron', () => {
  const root = pacote('44.1.0');
  const manifest = path.join(root, 'package.json');
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  assert.equal(run('required', manifest).stdout.trim(), '44.1.0');
  assert.equal(run('check-installed', root).status, 0);
  assert.equal(run('check-installed', pacote('43.1.0')).status, 1);
  assert.equal(run('required', path.join(root, 'missing.json')).status, 2);
  assert.equal(run('check-running', manifest).status, 1);
});

test('CLI também executa via diretório com symlink, como /tmp no macOS', () => {
  const alias = path.join(scratch, 'linked-source');
  fs.symlinkSync(path.dirname(path.dirname(cli)), alias, 'junction');
  const root = pacote('44.1.0');
  const result = spawnSync(process.execPath, [path.join(alias, 'lib/electron-runtime.js'), 'required', path.join(root, 'package.json')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '44.1.0');
});
