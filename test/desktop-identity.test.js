// Exercita o Electron real e lê as propriedades da janela pela API do Windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as esperar } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const raiz = path.resolve(import.meta.dirname, '..');
const executable = path.join(raiz, 'node_modules/electron/dist/electron.exe');
test('janela tem identidade, ícone e reabertura próprios no Windows', {
  skip: process.platform !== 'win32' || !fs.existsSync(executable), timeout: 30000,
}, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-desktop-'));
  const ready = path.join(tmp, 'ready.json');
  fs.mkdirSync(path.join(tmp, 'assets'));
  fs.copyFileSync(path.join(raiz, 'assets/farol.ico'), path.join(tmp, 'assets/farol.ico'));
  const helper = pathToFileURL(path.join(raiz, 'lib/desktop-identity.js')).href;
  const bootstrap = path.join(tmp, 'main.cjs');
  fs.writeFileSync(bootstrap, `
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
process.stdin.once('data', () => app.quit());
app.setPath('userData', ${JSON.stringify(path.join(tmp, 'profile'))});
(async () => {
  const { identificarAplicativo, identificarJanela } = await import(${JSON.stringify(helper)});
  identificarAplicativo(app);
  await app.whenReady();
  const win = new BrowserWindow({ show: false });
  identificarJanela(win, app);
  fs.writeFileSync(${JSON.stringify(ready)}, JSON.stringify({
    handle: win.getNativeWindowHandle().readBigUInt64LE().toString(),
    executable: process.execPath, appPath: app.getAppPath(), name: app.getName(),
  }));
})().catch((error) => { console.error(error); app.exit(1); });
`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [bootstrap], { env, stdio: ['pipe', 'ignore', 'ignore'] });
  const exited = new Promise((resolve) => {
    child.once('error', resolve);
    child.once('exit', resolve);
  });
  try {
    for (let i = 0; i < 200 && !fs.existsSync(ready) && child.exitCode === null; i++) await esperar(50);
    assert.ok(fs.existsSync(ready), 'Electron deve criar a janela isolada');
    const info = JSON.parse(fs.readFileSync(ready, 'utf8'));
    const native = JSON.parse(execFileSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(raiz, 'test/helpers/window-identity.ps1'), '-Handle', info.handle,
    ], { encoding: 'utf8' }));
    assert.equal(info.name, 'Farol');
    assert.equal(native.appId, 'com.biud.farol');
    assert.equal(native.name, 'Farol');
    assert.equal(native.icon, path.join(info.appPath, 'assets', 'farol.ico') + ',0');
    assert.equal(native.command, `"${info.executable}" "${info.appPath}"`);
  } finally {
    child.stdin.end('quit');
    await Promise.race([exited, esperar(5000)]);
    if (child.exitCode === null && child.pid) {
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    }
    await exited;
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
