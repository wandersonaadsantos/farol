import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureWindow, diagnostics } from '../tools/electron-smoke-capture.js';
function fixture(capture) {
  const state = { restored: 0, shown: 0, paints: 0, calls: 0 };
  return { state, isMinimized: () => true, isVisible: () => false, restore: () => state.restored++, show: () => state.shown++,
    webContents: { executeJavaScript: async () => { state.paints++; }, capturePage: async () => { state.calls++; return capture(state.calls); } } };
}
test('captura espera pintura e só recupera erro transitório com imagem real', async () => {
  const image = { fixture: true }, start = diagnostics.length;
  const window = fixture(n => { if (n < 3) throw Error('UnknownVizError'); return image; });
  assert.equal(await captureWindow(window, 'fixture'), image);
  assert.deepEqual(window.state, { restored: 1, shown: 1, paints: 3, calls: 3 });
  assert.equal(diagnostics.length - start, 2);
});
test('três falhas reprovam, sem imagem substituta; erro diferente não repete', async () => {
  const transient = fixture(() => { throw Error('UnknownVizError'); });
  await assert.rejects(captureWindow(transient, 'fixture'), /UnknownVizError/); assert.equal(transient.state.calls, 3);
  const permanent = fixture(() => { throw Error('Falha diferente'); });
  await assert.rejects(captureWindow(permanent, 'fixture'), /Falha diferente/); assert.equal(permanent.state.calls, 1);
});
