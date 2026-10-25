// O compositor pode rejeitar uma captura transitória; nunca substitui a imagem.
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
const CAPTURE_RETRY_DELAY_MS = 250;
const diagnostics = [];
async function captureWindow(window, label) {
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  for (let attempt = 1; attempt <= 3; attempt++) {
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    try { return await window.webContents.capturePage(); }
    catch (error) {
      if (error.message !== 'UnknownVizError' || attempt === 3) throw error;
      diagnostics.push({ label, attempt, reason: 'UnknownVizError' });
      await delay(CAPTURE_RETRY_DELAY_MS);
    }
  }
}
async function reloadWindow(window) {
  const loaded = once(window.webContents, 'did-finish-load', { signal: AbortSignal.timeout(15000) });
  window.webContents.reload();
  await loaded;
}
export { captureWindow, reloadWindow, diagnostics };
