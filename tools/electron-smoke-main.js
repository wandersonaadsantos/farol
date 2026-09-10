// Bootstrap de integração: importa o main.js real, que constrói BrowserWindow,
// Tray e servidor HTTP reais. Só o monitor externo fica desativado; seu contrato
// (gh, autenticação, revisões e update) pertence a outras verificações.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { app, Notification, session } from 'electron';
import { localRequest, validateWindowEvidence, validateLoginItem, createIsolatedLoginSetter, loopbackOrigin } from './electron-smoke-lib.js';
import { readJson, writeJsonAtomic } from '../lib/io.js';
import { semAsVariaveis } from '../lib/env.js';
import { IS_WIN, IS_LINUX } from '../lib/paths.js';

if (!process.versions.electron) throw new Error('Este bootstrap exige o runtime Electron real.');
const config = readJson(semAsVariaveis([]).FAROL_ELECTRON_SMOKE_CONFIG, null);
if (!config) throw new Error('Configuração do smoke ausente ou inválida.');
const origin = loopbackOrigin(config.port);
const report = { status: 'running', probeId: config.name, platform: process.platform, versions: { ...process.versions },
  expectedElectron: config.expectedElectron, expectedApp: config.expectedApp,
  isolation: { monitoring: 'disabled at Engine.start/schedule only', externalProcesses: [], blockedRequests: [] },
  errors: [], checks: {} };
let main;
let notification;
let nativeLoginSetter;
let loginWrites = 0;
const loginArgs = [config.root, config.name];

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
  if (!IS_WIN) return;
  nativeLoginSetter = app.setLoginItemSettings.bind(app);
  // Intercepta ANTES do import main: até autostart:false no boot removeria o
  // registro real. A chamada continua NATIVA, só muda para uma identidade única.
  const forward = createIsolatedLoginSetter(nativeLoginSetter,
    { path: process.execPath, args: [config.root] },
    { name: config.name, args: loginArgs, authorized: config.autostart },
    () => report.errors.push('autostart: path/args de produção divergiram antes do isolamento'));
  app.setLoginItemSettings = settings => {
    loginWrites++;
    forward(settings);
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

async function checkNavigation(win) {
  const navigation = [];
  // Consumo só renderiza o snapshot já recebido; Sistema/Time disparam outras
  // consultas que não pertencem à prova do shell isolado.
  for (const tab of ['consumo', 'radar']) {
    navigation.push(await win.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('#tabbtn-${tab}');
      button.click();
      return { tab: '${tab}', selected: button.getAttribute('aria-selected') === 'true',
        visible: getComputedStyle(document.querySelector('#tab-${tab}')).display !== 'none',
        activePanels: document.querySelectorAll('.tabpane.active').length, bodyTab: document.body.dataset.tab };
    })()`));
  }
  return navigation;
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
  assert.equal(win.webContents.getURL(), origin + '/', 'renderer deve estar na raiz HTTP loopback isolada');
  // O renderer consulta um caminho literal da própria origem já verificada.
  // Nenhum conteúdo do arquivo de configuração compõe a URL da requisição.
  const response = await win.webContents.executeJavaScript(`(async () => {
    const response = await fetch('/api/state', { method: 'GET', redirect: 'error' });
    return { status: response.status, contentType: response.headers.get('content-type'), snapshot: await response.json() };
  })()`);
  assert.equal(response.status, 200, 'snapshot HTTP deve responder 200');
  assert.ok(response.contentType?.includes('application/json'));
  const snapshot = response.snapshot;
  dom.navigation = await checkNavigation(win);
  validateWindowEvidence(response.status, snapshot, dom, { expectedApp: config.expectedApp, platform: process.platform });
  // Engine.start está desativado: "iniciando…" é o estado honesto enquanto não
  // houve checagem. A prova é HTTP real + versão renderizada + handlers da UI.
  assert.equal(snapshot.lastCheckAt, null, 'smoke não executa nem inventa checagem externa');
  await waitFor(() => win.webContents.executeJavaScript(`(() => {
    const panel = document.querySelector('.tabpane.active');
    return getComputedStyle(panel).opacity === '1' && panel.getAnimations({ subtree: true }).every(animation =>
      !Number.isFinite(animation.effect.getComputedTiming().endTime) || animation.playState === 'finished');
  })()`), 'painel ativo concluir a pintura e a animação reais antes da captura');
  // A animação pode terminar antes de o compositor apresentar o último frame.
  await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const image = await win.capturePage();
  assert.equal(image.isEmpty(), false);
  const screenshot = config.name + '-window.png';
  fs.writeFileSync(path.join(config.output, screenshot), image.toPNG());
  report.checks.window = { status: 'passed', dom, bounds: win.getBounds(), url: win.webContents.getURL(), screenshot,
    httpSnapshot: { status: response.status, app: snapshot.app, engineStatus: snapshot.status, lastCheckAt: snapshot.lastCheckAt } };
}

async function checkTray() {
  const tray = await waitFor(() => main.tray, 'main.js criar Tray');
  assert.equal(tray.isDestroyed(), false);
  assert.ok(tray.listenerCount('click') > 0);
  // Electron só expõe getBounds para macOS/Windows. No Linux, objeto e
  // handler não comprovam que o painel do desktop desenhou o ícone.
  const bounds = IS_LINUX ? null : tray.getBounds();
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
  report.checks.notification = { supported, status: 'pending', acceptedByNativeApi: false, visualDisplay: 'not inspected' };
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
    acceptedByNativeApi: outcome.event === 'show', ...outcome, visualDisplay: 'not inspected', userClick: 'not exercised' };
  notification.close();
  assert.equal(outcome.event, 'show', `API nativa não confirmou a notificação: ${outcome.error || outcome.event}`);
}

function checkAutostart() {
  if (!IS_WIN) {
    report.checks.autostart = { status: 'not-applicable', reason: 'Farol só oferece autostart no Windows.' };
    assert.equal(report.checks.window.dom.autostartHidden, true);
    return;
  }
  assert.ok(loginWrites > 0, 'boot real chamou applyAutostart');
  if (!config.autostart) {
    report.checks.autostart = { status: 'not-executed', reason: 'Probe de registro não autorizado fora da CI.' };
    return;
  }
  // openAtLogin consulta só AppUserModelID; name custom aparece em launchItems.
  // Não troca a identidade real do app para tornar o teste artificialmente verde.
  const options = { path: `"${process.execPath}"`, args: loginArgs };
  const expected = { name: config.name, path: process.execPath, args: loginArgs };
  report.checks.autostart = { status: 'pending', isolatedName: config.name };
  validateLoginItem(app.getLoginItemSettings(options), expected, false);
  main.engine.config.autostart = true;
  main.applyAutostart();
  validateLoginItem(app.getLoginItemSettings(options), expected, true);
  main.engine.config.autostart = false;
  main.applyAutostart();
  validateLoginItem(app.getLoginItemSettings(options), expected, false);
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
