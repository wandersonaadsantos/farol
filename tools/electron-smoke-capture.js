// O compositor pode rejeitar uma captura transitória; nunca substitui a imagem.
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { safeStringify } from '../lib/io.js';
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
async function waitForWindowGeometry(window, expected, timeoutMs = 15000) {
  const polling = new AbortController();
  let observed, stopped = false, timer;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      stopped = true;
      reject(new Error(`Geometria da janela não confirmou o resize: ${safeStringify({ expected, observed })}`));
    }, timeoutMs);
  });
  const measure = async () => {
    while (!stopped) {
      const viewport = await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve({width:innerWidth,height:innerHeight}))))');
      if (stopped) return;
      const contentSize = window.getContentSize(), bounds = window.getBounds();
      observed = { contentSize, bounds, viewport };
      const [width, height] = expected.contentSize;
      if (contentSize[0] === width && contentSize[1] === height && viewport.width === width && viewport.height === height
        && (!expected.bounds || (bounds.width === expected.bounds.width && bounds.height === expected.bounds.height))) return observed;
      await delay(50, undefined, { signal: polling.signal });
    }
  };
  try { return await Promise.race([measure(), deadline]); }
  finally { stopped = true; clearTimeout(timer); polling.abort(); }
}
export { captureWindow, reloadWindow, waitForWindowGeometry, diagnostics };
