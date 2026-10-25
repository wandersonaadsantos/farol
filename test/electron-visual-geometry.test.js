import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { captureReviewTools } from '../tools/electron-smoke-visual.js';
import * as capture from '../tools/electron-smoke-capture.js';

function asynchronousWindow({ workAreaHeight = 1000, frameHeight = 0 } = {}) {
  const initial = { x: 80, y: 120, width: 1120, height: Math.min(760, workAreaHeight) };
  const state = { bounds: { ...initial }, viewport: { width: 1120, height: initial.height - frameHeight }, theme: 'dark', throttling: true, resizes: [], restores: 0 };
  function change(bounds) {
    const constrained = { ...bounds, height: Math.min(bounds.height, workAreaHeight) };
    setTimeout(() => { state.bounds = constrained; }, 5);
    setTimeout(() => { state.viewport = { width: constrained.width, height: constrained.height - frameHeight }; }, 15);
  }
  const webContents = {
    getBackgroundThrottling: () => state.throttling,
    setBackgroundThrottling: value => { state.throttling = value; },
    executeJavaScript: async code => {
      if (code === 'document.documentElement.dataset.theme') return state.theme;
      if (code.includes("'#btnTheme'")) { state.theme = state.theme === 'dark' ? 'light' : 'dark'; return; }
      if (code === 'getComputedStyle(document.body).color') return state.theme === 'light' ? 'rgb(28, 37, 54)' : 'rgb(231, 236, 245)';
      if (code.includes('scrollIntoView')) return { ...state.viewport, theme: state.theme, outside: [], cramped: 0 };
      if (code.includes('width:innerWidth,height:innerHeight')) return { ...state.viewport, availableHeight: workAreaHeight };
    },
    capturePage: async () => ({ toPNG: () => Buffer.from('unit capture boundary') }),
  };
  return { state, webContents, initial, isMinimized: () => false, isVisible: () => true,
    getBounds: () => ({ ...state.bounds }), getContentSize: () => [state.bounds.width, state.bounds.height - frameHeight],
    getMinimumSize: () => [1120, 760], setMinimumSize() {},
    setContentSize: (width, height) => { state.resizes.push([width, height]); change({ ...state.bounds, width, height: height + frameHeight }); },
    setBounds: bounds => { state.restores++; change(bounds); } };
}

test('probe espera resize nativo e viewport, inclusive restauração antes da próxima captura', async () => {
  const win = asynchronousWindow();
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-visual-geometry-'));
  try {
    await captureReviewTools({ win }, output, 'session', '#fixture');
    const measured = JSON.parse(fs.readFileSync(path.join(output, 'session-layout.json'), 'utf8'));
    assert.deepEqual(measured.map(item => item.width), [1280, 1280, 1280, 1280, 1024, 1024, 1024, 1024, 390, 390, 390, 390]);
    assert.deepEqual(win.state.resizes, [[1280, 800], [1024, 800], [390, 800]], 'cada tamanho é solicitado uma única vez');
    assert.equal(win.state.restores, 1);
    assert.deepEqual(win.state.bounds, win.initial);
    assert.deepEqual(win.state.viewport, { width: 1120, height: 760 });
    assert.equal(win.state.throttling, true);
  } finally {
    await delay(20);
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test('probe respeita área útil e moldura do desktop sem reduzir as três larguras', async () => {
  for (const scenario of [{ workAreaHeight: 677, frameHeight: 0, height: 677 },
    { workAreaHeight: 677, frameHeight: 30, height: 647 }, { workAreaHeight: 1024, frameHeight: 30, height: 800 }]) {
    const win = asynchronousWindow(scenario);
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-visual-work-area-'));
    try {
      await captureReviewTools({ win }, output, 'session', '#fixture');
      const measured = JSON.parse(fs.readFileSync(path.join(output, 'session-layout.json'), 'utf8'));
      assert.deepEqual([...new Set(measured.map(item => item.width))], [1280, 1024, 390]);
      assert.ok(measured.every(item => item.height === scenario.height));
      assert.deepEqual(win.state.resizes, [[1280, scenario.height], [1024, scenario.height], [390, scenario.height]]);
      assert.deepEqual(win.state.bounds, win.initial);
      assert.equal(win.state.throttling, true);
    } finally { await delay(20); fs.rmSync(output, { recursive: true, force: true }); }
  }
});

test('geometria não confirmada reprova sem reaplicar resize nem produzir captura', async () => {
  const win = asynchronousWindow();
  await assert.rejects(capture.waitForWindowGeometry(win, { contentSize: [1280, 800] }, 1), /Geometria.*não confirmou/);
  assert.deepEqual(win.state.resizes, []);
  assert.equal(win.state.restores, 0);
});

test('área útil indisponível reprova antes de solicitar tamanho, sem presumir tela suficiente', async () => {
  const win = asynchronousWindow();
  const execute = win.webContents.executeJavaScript;
  win.webContents.executeJavaScript = async code => {
    const value = await execute(code);
    return code.includes('width:innerWidth,height:innerHeight') ? { ...value, availableHeight: 0 } : value;
  };
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-visual-work-area-'));
  try {
    await assert.rejects(captureReviewTools({ win }, output, 'session', '#fixture'), /Área útil da captura indisponível/);
    assert.deepEqual(win.state.resizes, []);
    assert.equal(win.state.throttling, true);
  } finally { await delay(20); fs.rmSync(output, { recursive: true, force: true }); }
});

test('deadline rejeita renderer pendente e uma resposta tardia não retoma os polls', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish, polls = 0, nativeReads = 0;
  const win = { webContents: { executeJavaScript: () => { polls++; return new Promise(resolve => { finish = resolve; }); } },
    getContentSize: () => { nativeReads++; return [1280, 800]; }, getBounds: () => ({ width: 1280, height: 800 }) };
  const waiting = capture.waitForWindowGeometry(win, { contentSize: [1280, 800] }, 25);
  const rejected = assert.rejects(waiting, /Geometria.*não confirmou/);
  t.mock.timers.tick(25);
  await rejected;
  finish({ width: 1280, height: 800 });
  await Promise.resolve();
  assert.equal(polls, 1);
  assert.equal(nativeReads, 0, 'resultado depois do deadline não produz novas medições');
  t.mock.timers.tick(1000);
  assert.equal(polls, 1);
});

test('falha ao restaurar bounds ainda recompõe a política de background throttling', async () => {
  const win = asynchronousWindow();
  win.setBounds = () => { throw new Error('restauração recusada'); };
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-visual-geometry-'));
  try {
    await assert.rejects(captureReviewTools({ win }, output, 'session', '#fixture'), /restauração recusada/);
    assert.equal(win.state.throttling, true);
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});

test('falha de limpeza fica registrada sem substituir a falha original da medição', async () => {
  const win = asynchronousWindow();
  const execute = win.webContents.executeJavaScript;
  win.webContents.executeJavaScript = code => {
    if (code.includes('width:innerWidth,height:innerHeight')) throw new Error('renderer recusou a medição');
    return execute(code);
  };
  win.setBounds = () => { throw new Error('bounds recusados na limpeza'); };
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-visual-geometry-'));
  try {
    await assert.rejects(captureReviewTools({ win }, output, 'session', '#fixture'), /renderer recusou a medição/);
    assert.equal(win.state.throttling, true);
    assert.match(fs.readFileSync(path.join(output, 'visual-progress.jsonl'), 'utf8'), /bounds recusados na limpeza/);
  } finally { await delay(20); fs.rmSync(output, { recursive: true, force: true }); }
});
