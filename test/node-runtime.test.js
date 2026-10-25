// Contrato externo e fronteira de recusa: nenhum motor ou install é iniciado.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { packageNodeRequirement, nodeVersionSatisfies, assertExternalNodeRuntime } from '../lib/node-runtime.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-node-runtime-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

test('contrato suporta piso 24.22.1 e patches da linha 24, sem prometer Node 22 ou majors futuras', () => {
  const range = packageNodeRequirement();
  assert.equal(range, '>=24.22.1 <25');
  for (const version of ['24.22.1', '24.22.2', '24.23.0']) assert.equal(nodeVersionSatisfies(version, range), true, version);
  for (const version of ['22.12.0', '24.0.0', '24.14.9', '24.15.0', '24.15.9', '24.16.0', '24.19.0', '24.22.0', '25.0.0', '26.0.0', '24.22.1-rc.1', 'indisponivel']) {
    assert.equal(nodeVersionSatisfies(version, range), false, version);
    assert.throws(() => assertExternalNodeRuntime({ version, electron: undefined }), /Node.*incompatível.*Node >=24\.22\.1 <25.*nvm install/);
  }
});

test('Node embarcado é validado pelo contrato Electron, separadamente do PATH', () => {
  assert.equal(assertExternalNodeRuntime({ version: '24.22.0', electron: '44.9.3', packageFile: 'ausente' }), '24.22.0');
});

test('CLI recusa runtime incompatível com mensagem acionável e código 1', () => {
  const manifest = path.join(scratch, 'package.json');
  fs.writeFileSync(manifest, JSON.stringify({ engines: { node: '>=99.0.0 <100' } }));
  const result = spawnSync(process.execPath, [path.join(ROOT, 'lib/node-runtime.js'), manifest], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /incompatível.*nvm install.*instalação existente foi preservada/);
  assert.equal(result.stdout, '');
});

test('manifesto ausente ou range aberto não é aceito como suporte', () => {
  const manifest = path.join(scratch, 'invalid.json');
  for (const engines of [{}, { node: '>=24.22.1' }, { node: '24' }]) {
    fs.writeFileSync(manifest, JSON.stringify({ engines }));
    assert.throws(() => packageNodeRequirement(manifest), /Contrato Node ausente ou inválido/);
  }
});

test('lockfile, versão local e CI preservam o piso e os três sistemas', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages[''].engines.node, packageNodeRequirement());
  assert.equal(fs.readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim(), '24.22.1');
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  assert.equal((workflow.match(/node-version: '24\.22\.1'/g) || []).length, 2);
  assert.equal((workflow.match(/os: \[ubuntu-latest, windows-latest, macos-latest\]/g) || []).length, 2);
  assert.match(workflow, /needs: \[gate, electron\]/);
});
