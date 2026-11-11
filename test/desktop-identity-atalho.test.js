// O Electron.lnk que o Electron 44 grava para as notificações ganha o ícone do Farol.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as esperar } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { precisaDoIconeDoFarol, caminhoDoAtalhoDoElectron } from '../lib/desktop-identity.js';

const W = path.win32;
const EXE = W.join('C:', 'Users', 'x', '.farol', 'app', 'node_modules', 'electron', 'dist', 'Farol.exe');
const ICONE = W.join('C:', 'Users', 'x', '.farol', 'app', 'assets', 'farol.ico');
const base = { target: EXE, appUserModelId: 'com.biud.farol', icon: '' };

test('atalho do Electron com o AUMID do Farol e sem ícone recebe o ícone', () => {
  assert.equal(precisaDoIconeDoFarol(base, { executavel: EXE, icone: ICONE }), true);
  assert.equal(precisaDoIconeDoFarol({ ...base, target: EXE.toLowerCase() }, { executavel: EXE, icone: ICONE }), true);
});

test('atalho que já tem o ícone, de outro app ou de outro executável fica como está', () => {
  assert.equal(precisaDoIconeDoFarol({ ...base, icon: ICONE.toUpperCase() }, { executavel: EXE, icone: ICONE }), false);
  assert.equal(precisaDoIconeDoFarol({ ...base, appUserModelId: 'com.outro.app' }, { executavel: EXE, icone: ICONE }), false);
  assert.equal(precisaDoIconeDoFarol({ ...base, target: W.join('C:', 'outro', 'electron.exe') }, { executavel: EXE, icone: ICONE }), false);
  assert.equal(precisaDoIconeDoFarol(null, { executavel: EXE, icone: ICONE }), false);
});

test('o atalho mora no Menu Iniciar do usuário com o nome do executável', () => {
  assert.equal(caminhoDoAtalhoDoElectron(W.join('C:', 'AD')), path.join(W.join('C:', 'AD'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Electron.lnk'));
});

const raiz = path.resolve(import.meta.dirname, '..');
const executable = path.join(raiz, 'node_modules/electron/dist/electron.exe');
test('no Electron real, o ícone entra e o ID do ativador das notificações fica', {
  skip: process.platform !== 'win32' || !fs.existsSync(executable), timeout: 30000,
}, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-atalho-'));
  test.after(() => fs.promises.rm(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }), { timeout: 30000 });
  fs.mkdirSync(path.join(tmp, 'assets'));
  fs.copyFileSync(path.join(raiz, 'assets/farol.ico'), path.join(tmp, 'assets/farol.ico'));
  const saida = path.join(tmp, 'saida.json');
  const helper = pathToFileURL(path.join(raiz, 'lib/desktop-identity.js')).href;
  const bootstrap = path.join(tmp, 'main.cjs');
  const clsid = '{11111111-2222-3333-4444-555555555555}';
  fs.writeFileSync(bootstrap, `
const { app, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.setPath('userData', ${JSON.stringify(path.join(tmp, 'profile'))});
(async () => {
  const { carimbarAtalhoDoElectron, caminhoDoAtalhoDoElectron } = await import(${JSON.stringify(helper)});
  await app.whenReady();
  const appData = ${JSON.stringify(path.join(tmp, 'appdata'))};
  const atalho = caminhoDoAtalhoDoElectron(appData);
  fs.mkdirSync(path.dirname(atalho), { recursive: true });
  shell.writeShortcutLink(atalho, 'create', { target: process.execPath, cwd: path.dirname(process.execPath),
    appUserModelId: 'com.biud.farol', toastActivatorClsid: ${JSON.stringify(clsid)} });
  const gravou = carimbarAtalhoDoElectron(shell, app, appData);
  const depois = shell.readShortcutLink(atalho);
  const deNovo = carimbarAtalhoDoElectron(shell, app, appData);
  fs.writeFileSync(${JSON.stringify(saida)}, JSON.stringify({ gravou, deNovo, depois, icone: path.join(app.getAppPath(), 'assets', 'farol.ico'), exe: process.execPath }));
  app.quit();
})().catch((error) => { console.error(error); app.exit(1); });
`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [bootstrap], { env, stdio: 'ignore' });
  const saiu = new Promise((resolve) => { child.once('error', resolve); child.once('exit', resolve); });
  await Promise.race([saiu, esperar(25000)]);
  assert.ok(fs.existsSync(saida), 'o Electron deve gravar o resultado');
  const r = JSON.parse(fs.readFileSync(saida, 'utf8'));
  assert.equal(r.gravou, true);
  assert.equal(r.deNovo, false, 'com o ícone posto, não grava de novo');
  assert.equal(r.depois.icon.toLowerCase(), r.icone.toLowerCase());
  assert.equal(r.depois.appUserModelId, 'com.biud.farol');
  assert.equal(r.depois.toastActivatorClsid.toUpperCase(), clsid.toUpperCase(), 'o Electron compara o ID: ele não pode mudar');
  assert.equal(r.depois.target.toLowerCase(), r.exe.toLowerCase());
});
