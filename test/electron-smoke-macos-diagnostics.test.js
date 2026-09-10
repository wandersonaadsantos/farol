import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permissionStageObserved, PERMISSION_STAGE, startMacosDiagnostics } from '../tools/electron-smoke-macos-diagnostics.js';
import { IS_MAC } from '../lib/paths.js';

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
