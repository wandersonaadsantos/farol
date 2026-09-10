// Bootstrap de integração: importa o main.js real, que constrói BrowserWindow,
// Tray e servidor HTTP reais. Só o monitor externo fica desativado; seu contrato
// (gh, autenticação, revisões e update) pertence a outras verificações.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { app, Notification, session } from 'electron';
import { localRequest } from './electron-smoke-lib.js';
import { readJson, writeJsonAtomic } from '../lib/io.js';
import { semAsVariaveis } from '../lib/env.js';

if (!process.versions.electron) throw new Error('Este bootstrap exige o runtime Electron real.');
const config = readJson(semAsVariaveis([]).FAROL_ELECTRON_SMOKE_CONFIG, null);
if (!config) throw new Error('Configuração do smoke ausente ou inválida.');
const origin = `http://127.0.0.1:${config.port}`;
const report = { status: 'running', probeId: config.name, platform: process.platform, versions: { ...process.versions },
  expectedElectron: config.expectedElectron, expectedApp: config.expectedApp,
  isolation: { monitoring: 'disabled at Engine.start/schedule only', externalProcesses: [], blockedRequests: [] },
  errors: [], checks: {} };
let main;
let notification;
let nativeLoginSetter;
let loginWrites = 0;
const loginArgs = [config.root, '--farol-electron-smoke', config.name];

function writeReport() {
  writeJsonAtomic(path.join(config.output, 'result.json'), report);
}

function stage(value) { report.stage = value; writeReport(); }

function waitFor(predicate, label, ms = 15000) {
  const until = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const value = await predicate();
        if (value) return resolve(value);
        if (Date.now() >= until) return reject(new Error(`Timeout: ${label}`));
        setTimeout(poll, 100);
      } catch (err) { reject(err); }
    };
    poll();
  });
}

function isolateProcesses() {
  for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    childProcess[method] = (command) => {
      report.isolation.externalProcesses.push({ method, command: path.basename(String(command)) });
      throw new Error('Processo externo proibido no smoke isolado.');
    };
  }
  syncBuiltinESMExports();
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (url, ...args) => {
    const address = typeof url === 'string' ? url : url.url;
    if (!localRequest(address, origin)) throw new Error('Rede externa proibida no smoke isolado.');
    return nativeFetch(url, ...args);
  };
}

function isolateAutostart() {
  if (process.platform !== 'win32') return;
  nativeLoginSetter = app.setLoginItemSettings.bind(app);
  // Intercepta ANTES do import main: até autostart:false no boot removeria o
  // registro real. A chamada continua NATIVA, só muda para uma identidade única.
  app.setLoginItemSettings = settings => {
    loginWrites++;
    if (!config.autostart) return;
    nativeLoginSetter({ ...settings, name: config.name, args: loginArgs });
  };
}

function watchRenderer(window) {
  window.webContents.on('render-process-gone', (_event, details) => report.errors.push(`renderer: ${details.reason}`));
  window.webContents.on('did-fail-load', (_event, code, description) => report.errors.push(`load: ${code} ${description}`));
  window.webContents.on('console-message', (_event, level, message) => {
    const detail = typeof level === 'object' ? level : { level, message };
    if (detail.level === 'error' || detail.level === 3) report.errors.push(`console: ${detail.message}`);
  });
}

async function checkWindow() {
  const win = await waitFor(() => main.win, 'main.js criar BrowserWindow');
  assert.equal(main.attachedToExisting, false, 'não pode anexar a um Farol já em execução');
  assert.equal(main.appUrl, origin);
  const dom = await waitFor(async () => {
    if (win.webContents.isLoading()) return null;
    return win.webContents.executeJavaScript(`(() => {
      const version = document.querySelector('#appVer')?.textContent || '';
      return version ? { title: document.title, version, brand: document.querySelector('.brand-name')?.textContent,
        status: document.querySelector('#statusPill')?.textContent, tabs: document.querySelectorAll('#nav [role=tab]').length,
        autostartHidden: getComputedStyle(document.querySelector('#rowAutostart')).display === 'none' } : null;
    })()`);
  }, 'UI real renderizar o estado do servidor');
  assert.equal(dom.title, 'Farol');
  assert.equal(dom.brand, 'Farol');
  assert.ok(dom.version.includes(config.expectedApp));
  assert.ok(dom.tabs > 1);
  assert.notEqual(dom.status, 'iniciando…');
  const image = await win.capturePage();
  assert.equal(image.isEmpty(), false);
  const screenshot = config.name + '-window.png';
  fs.writeFileSync(path.join(config.output, screenshot), image.toPNG());
  report.checks.window = { status: 'passed', dom, bounds: win.getBounds(), url: win.webContents.getURL(), screenshot };
}

async function checkTray() {
  const tray = await waitFor(() => main.tray, 'main.js criar Tray');
  assert.equal(tray.isDestroyed(), false);
  assert.ok(tray.listenerCount('click') > 0);
  // Electron só expõe getBounds para macOS/Windows. No Linux, objeto e
  // handler não comprovam que o painel do desktop desenhou o ícone.
  const bounds = process.platform === 'linux' ? null : tray.getBounds();
  main.win.hide();
  assert.equal(main.win.isVisible(), false);
  tray.emit('click');
  await waitFor(() => main.win.isVisible(), 'handler real da bandeja reabrir janela');
  main.win.close();
  assert.equal(main.win.isDestroyed(), false, 'fechar conserva a janela na bandeja');
  assert.equal(main.win.isVisible(), false);
  report.checks.tray = { status: 'passed', bounds, iconObjectAlive: true,
    visibility: bounds ? 'native bounds observed; visual placement not inspected' : 'not verified on Linux',
    interaction: 'programmatic click event on native Tray; OS mouse not exercised', closeHidesWindow: true };
}

function observeNotificationShow(nativeShow, resolve, timer) {
  return function (...args) {
    notification = this;
    this.once('show', () => { clearTimeout(timer); resolve({ event: 'show' }); });
    this.once('failed', (...details) => {
      clearTimeout(timer);
      resolve({ event: 'failed', error: details.filter(a => typeof a === 'string').join(' ') });
    });
    return nativeShow.apply(this, args);
  };
}

async function checkNotification() {
  const supported = Notification.isSupported();
  report.checks.notification = { supported, status: 'pending', delivered: false };
  assert.equal(supported, true, 'notificações nativas indisponíveis neste desktop');
  main.win.hide();
  await waitFor(() => !main.win.isFocused(), 'janela perder foco antes da notificação');
  const nativeShow = Notification.prototype.show;
  const outcomePromise = new Promise(resolve => {
    const timer = setTimeout(() => resolve({ event: 'timeout' }), 10000);
    // Observa ANTES da API nativa: uma recusa síncrona (ex.: assinatura macOS)
    // não pode virar timeout só porque o listener foi registrado tarde demais.
    Notification.prototype.show = observeNotificationShow(nativeShow, resolve, timer);
  });
  try { main.notify('Farol: teste do runtime', 'Notificação sintética do smoke; nenhuma revisão foi executada.'); }
  finally { Notification.prototype.show = nativeShow; }
  assert.ok(notification, 'notify deve construir uma Notification real');
  const outcome = await outcomePromise;
  report.checks.notification = { supported, status: outcome.event === 'show' ? 'passed' : 'failed',
    delivered: outcome.event === 'show', ...outcome, userClick: 'not exercised' };
  notification.close();
  assert.equal(outcome.event, 'show', `notificação não foi exibida: ${outcome.error || outcome.event}`);
}

function checkAutostart() {
  if (process.platform !== 'win32') {
    report.checks.autostart = { status: 'not-applicable', reason: 'Farol só oferece autostart no Windows.' };
    assert.equal(report.checks.window.dom.autostartHidden, true);
    return;
  }
  assert.ok(loginWrites > 0, 'boot real chamou applyAutostart');
  if (!config.autostart) {
    report.checks.autostart = { status: 'not-executed', reason: 'Probe de registro não autorizado fora da CI.' };
    return;
  }
  const options = { path: process.execPath, args: loginArgs };
  assert.equal(app.getLoginItemSettings(options).openAtLogin, false, 'identidade única começa ausente');
  main.engine.config.autostart = true;
  main.applyAutostart();
  assert.equal(app.getLoginItemSettings(options).openAtLogin, true, 'API nativa gravou o login item isolado');
  main.engine.config.autostart = false;
  main.applyAutostart();
  assert.equal(app.getLoginItemSettings(options).openAtLogin, false, 'API nativa removeu o login item isolado');
  report.checks.autostart = { status: 'passed', roundtrip: 'disabled -> enabled -> disabled', isolatedName: config.name };
}

function cleanup() {
  try { notification?.close(); } catch { /* já encerrada */ }
  if (nativeLoginSetter && config.autostart) {
    nativeLoginSetter({ openAtLogin: false, path: process.execPath, args: loginArgs, name: config.name });
  }
  if (main?.engine) clearTimeout(main.engine.timer);
}

async function runSmoke() {
  try {
    stage('bootstrap-loaded');
    assert.equal(process.versions.electron, config.expectedElectron, 'executa exatamente o piso declarado do pacote');
    app.setPath('userData', config.dirs.userData);
    app.setPath('sessionData', config.dirs.sessionData);
    isolateProcesses();
    isolateAutostart();
    app.on('browser-window-created', (_event, win) => watchRenderer(win));
    await app.whenReady();
    stage('electron-ready');
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = localRequest(details.url, origin);
      if (!allowed) report.isolation.blockedRequests.push(details.url);
      callback({ cancel: !allowed });
    });
    const { Engine } = await import('../server.js');
    Engine.prototype.start = async function () { this.pushState(); };
    Engine.prototype.schedule = function () {};
    main = await import('../main.js');
    stage('main-imported');
    await checkWindow();
    stage('window-loaded');
    await checkTray();
    checkAutostart();
    await checkNotification();
    assert.deepEqual(report.isolation.externalProcesses, []);
    assert.deepEqual(report.errors, []);
    report.status = 'passed';
  } catch (err) {
    report.status = 'failed';
    report.error = err.message;
  } finally {
    try { cleanup(); }
    catch (err) { report.status = 'failed'; report.cleanupError = err.message; }
    writeReport();
    if (report.status === 'passed') app.quit();
    else app.exit(1);
  }
}

// Não await no topo: Electron só emite ready depois de carregar o entrypoint ESM.
runSmoke().catch(err => { report.status = 'failed'; report.error = err.message; writeReport(); app.exit(1); });
