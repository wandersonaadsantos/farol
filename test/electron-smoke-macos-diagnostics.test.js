import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { AX_SCRIPT, permissionStageObserved, PERMISSION_STAGE, startMacosDiagnostics } from '../tools/electron-smoke-macos-diagnostics.js';
import { IS_MAC } from '../lib/paths.js';

test('falha ao ler janelas AX não se torna evidência de desktop sem processos', () => {
  const process = { name: () => 'Synthetic', unixId: () => 123, bundleIdentifier: () => 'test.synthetic',
    windows: () => { throw new Error('Accessibility unavailable'); } };
  // Só prova a serialização do erro; não simula consentimento nem valida UI Mac.
  const result = JSON.parse(vm.runInNewContext(AX_SCRIPT, { Application: () => ({ applicationProcesses: () => [process] }) }));
  assert.equal(result.processCount, 1);
  assert.equal(result.inspectedProcessCount, 1);
  assert.match(result.processes[0].windowsError, /Accessibility unavailable/);
  assert.equal('windowCount' in result.processes[0], false, 'falha não afirma zero janelas');
});

test('diagnóstico não aceita stage anterior nem relatório de outra execução', () => {
  const current = { probeId: 'current', stage: PERMISSION_STAGE };
  assert.equal(permissionStageObserved(current, 'current'), true);
  assert.equal(permissionStageObserved({ ...current, probeId: 'previous' }, 'current'), false);
  assert.equal(permissionStageObserved({ ...current, stage: 'window-loaded' }, 'current'), false);
  assert.equal(permissionStageObserved(null, 'current'), false);
});

test('observação de desktop macOS não dispara comandos nos demais sistemas', { skip: IS_MAC }, () => {
  assert.throws(() => startMacosDiagnostics({}), /runner macOS/);
});
