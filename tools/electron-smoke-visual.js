// Evidência do produto real com os dados sintéticos das jornadas nativas.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { safeStringify } from '../lib/io.js';
import { setTimeout as delay } from 'node:timers/promises';
import { captureWindow, waitForWindowGeometry } from './electron-smoke-capture.js';

async function settleTheme(web, theme) {
  if (await web.executeJavaScript('document.documentElement.dataset.theme') !== theme) {
    await web.executeJavaScript(`document.querySelector('#btnTheme').click()`);
  }
  const expected = theme === 'light' ? 'rgb(28, 37, 54)' : 'rgb(231, 236, 245)';
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await web.executeJavaScript('getComputedStyle(document.body).color') === expected) return;
    await delay(50);
  }
  throw new Error(`Transição para o tema ${theme} não terminou.`);
}

async function captureVariant(win, output, label, selector, width, theme) {
  const web = win.webContents, measurements = [];
  const progress = stage => fs.appendFileSync(path.join(output, 'visual-progress.jsonl'), safeStringify({label,width,theme,stage,at:new Date().toISOString()}) + '\n');
  progress('theme-start');
  await settleTheme(web, theme);
  progress('theme-ready');
  for (const edge of ['start', 'end']) {
    progress(`layout-${edge}`);
    const measured = await web.executeJavaScript(`new Promise(resolve => {
      const root = document.querySelector(${safeStringify(selector)});
      root.scrollIntoView({block:${safeStringify(edge)},behavior:'instant'});
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const outside = [...root.querySelectorAll('input,select,textarea,button,summary')].filter(el => {
          const r = el.getBoundingClientRect();
          return el.checkVisibility() && r.width > 0 && (r.left < -1 || r.right > innerWidth + 1);
        }).map(el => el.id || el.textContent.trim().slice(0,80));
        const cramped = [...root.querySelectorAll('.sess-txt')].filter(el => el.checkVisibility() && el.getBoundingClientRect().width < Math.min(200, root.clientWidth * .6)).length;
        resolve({width:innerWidth,theme:document.documentElement.dataset.theme,edge:${safeStringify(edge)},outside,cramped});
      }));
    })`);
    assert.deepEqual(measured.outside, [], `${label}: controles fora da tela em ${width}px/${theme}/${edge}`);
    assert.equal(measured.width, width, `${label}: largura real da janela`);
    assert.equal(measured.theme, theme, `${label}: tema real da captura`);
    assert.equal(measured.cramped, 0, `${label}: texto da sessão espremido em coluna estreita`);
    measurements.push(measured);
    const image = await captureWindow(win, `${label}-${width}-${theme}-${edge}`);
    fs.writeFileSync(path.join(output, `${label}-${width}-${theme}-${edge}.png`), image.toPNG());
  }
  return measurements;
}

function restoreThrottling(web, throttling, progress, failure) {
  try { web.setBackgroundThrottling(throttling); }
  catch (error) {
    progress('throttling-restore-failed', { error: error.message });
    if (!failure) throw error;
  }
}

async function captureReviewTools(main, output, label, selector) {
  const win = main.win, web = win.webContents;
  const bounds = win.getBounds(), contentSize = win.getContentSize(), minimum = win.getMinimumSize();
  const throttling = web.getBackgroundThrottling();
  const theme = await web.executeJavaScript('document.documentElement.dataset.theme');
  const measurements = [];
  let failure;
  const progress = (stage, detail = {}) => fs.appendFileSync(path.join(output, 'visual-progress.jsonl'), safeStringify({label,stage,...detail,at:new Date().toISOString()}) + '\n');
  progress('start');
  try {
    // A janela de teste pode estar encoberta enquanto o usuário trabalha.
    // Mantém os frames da captura ativos apenas neste probe isolado.
    web.setBackgroundThrottling(false);
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.setMinimumSize(320, 480);
    for (const width of [1280, 1024, 390]) {
      win.setContentSize(width, 800);
      await waitForWindowGeometry(win, { contentSize: [width, 800] });
      progress(`resize-${width}-confirmed`);
      for (const currentTheme of ['dark', 'light']) {
        measurements.push(...await captureVariant(win, output, label, selector, width, currentTheme));
      }
    }
    fs.writeFileSync(path.join(output, `${label}-layout.json`), safeStringify(measurements, null, 2));
    progress('captured');
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      win.setMinimumSize(...minimum);
      win.setBounds(bounds);
      await waitForWindowGeometry(win, { contentSize, bounds });
      progress('bounds-restored');
      await settleTheme(web, theme);
      progress('theme-restored');
    } catch (error) {
      progress('restore-failed', { error: error.message });
      if (!failure) throw error;
    } finally { restoreThrottling(web, throttling, progress, failure); }
  }
}
export { captureReviewTools };
