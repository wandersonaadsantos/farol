// Farol · shell Electron: janela nativa, bandeja, notificações e autostart.
// Toda a logica de monitoramento vive em server.js (que tambem roda sozinho
// com "node server.js" caso o Electron nao esteja disponivel).
'use strict';

const { app, BrowserWindow, Tray, Menu, Notification, shell, nativeImage } = require('electron');
const path = require('path');

const farol = require('./server');

const IS_MAC = process.platform === 'darwin';

let win = null;
let tray = null;
let engine = null;
let appUrl = null;
let quitting = false;
let hideHintShown = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.setAppUserModelId('com.biud.farol');

  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    const { engine: eng } = farol.start((url, err) => {
      if (err) {
        // porta ocupada: provavelmente ja existe um Farol rodando em modo servidor
        appUrl = `http://127.0.0.1:${eng.config.port}`;
      } else {
        appUrl = url;
      }
      createWindow();
      createTray();
      wireEngine();
      applyAutostart();
    });
    engine = eng;
  });

  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { /* segue vivo na bandeja */ });
  app.on('activate', () => showWindow()); // macOS: clique no Dock reabre a janela
}

function themeColors() {
  const light = engine && engine.config.theme === 'light';
  return light
    ? { bg: '#f4f6f9', symbol: '#1c2536' }
    : { bg: '#0b0e14', symbol: '#e7ecf5' };
}

function createWindow() {
  const c = themeColors();
  const opts = {
    width: 1120,
    height: 760,
    minWidth: 880,
    minHeight: 560,
    backgroundColor: c.bg,
    icon: path.join(__dirname, 'assets', 'farol.ico'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  };
  if (IS_MAC) {
    // no macOS os controles nativos (semaforo) ficam sobre a topbar da UI;
    // titleBarOverlay e coisa de Windows/Linux
    opts.titleBarStyle = 'hiddenInset';
  } else {
    opts.titleBarStyle = 'hidden';
    opts.titleBarOverlay = { color: c.bg, symbolColor: c.symbol, height: 44 };
  }
  win = new BrowserWindow(opts);
  win.setMenuBarVisibility(false);
  win.loadURL(appUrl);

  // links externos (GitHub etc.) abrem no navegador padrao
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!hideHintShown) {
      hideHintShown = true;
      notify('Farol continua por aqui', 'Monitorando na bandeja do sistema. Clique no icone para reabrir.');
    }
  });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function trayIcon() {
  const p = path.join(__dirname, 'assets', 'tray.png');
  let img = nativeImage.createFromPath(p);
  if (img.isEmpty()) img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'farol.ico'));
  // a barra de menu do macOS espera ~18px; sem resize o icone sai gigante
  if (IS_MAC && !img.isEmpty()) img = img.resize({ width: 18, height: 18 });
  return img;
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Farol · radar de Pull Requests');
  const menu = Menu.buildFromTemplate([
    { label: 'Abrir o Farol', click: showWindow },
    { label: 'Verificar agora', click: () => engine && engine.checkNow() },
    { type: 'separator' },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', showWindow);
  tray.on('balloon-click', showWindow);
}

function notify(title, body) {
  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title, body, icon: path.join(__dirname, 'assets', 'farol.ico') });
      n.on('click', showWindow);
      n.on('failed', () => balloon(title, body));
      n.show();
      return;
    }
  } catch { /* cai pro balao */ }
  balloon(title, body);
}

function balloon(title, content) {
  try { tray && tray.displayBalloon({ title, content, icon: trayIcon() }); } catch { }
}

function wireEngine() {
  if (!engine) return;
  engine.on('new-prs', ({ items, total, auto }) => {
    const n = items.length;
    const title = auto
      ? (n === 1 ? 'PR novo, revisando sozinho' : `${n} PRs novos, revisando sozinho`)
      : (n === 1 ? 'PR aguardando sua revisão' : `${n} PRs aguardando sua revisão`);
    const body = n === 1 ? `${items[0].key}: ${items[0].title}` : items.map(i => i.key).join('  ·  ');
    notify(`Farol · ${title}`, body);
  });
  engine.on('auto-approved', ({ pr, result }) => {
    notify('Farol · aprovado sem você ✅', `${pr.key} (${result.card || 'sem card'}): APPROVE postado.`);
  });
  engine.on('tool-done', ({ name, label }) => {
    notify(`Farol · ${label}`, name === 'kudos' ? 'Kudos prontos pra copiar na aba Destaques.' : 'Relatório disponível na aba Sistema.');
  });
  engine.on('needs-decision', ({ pr, item }) => {
    const motivo = (item.reasons && item.reasons[0]) || 'ver relatório';
    notify('Farol · precisa de você 🟡', `${pr.key}: ${motivo}`);
    if (win) win.flashFrame(true);
  });
  engine.on('settings-changed', (cfg) => {
    applyAutostart();
    if (win && !win.isDestroyed()) {
      const c = themeColors();
      if (!IS_MAC) { try { win.setTitleBarOverlay({ color: c.bg, symbolColor: c.symbol, height: 44 }); } catch { } }
      win.setBackgroundColor(c.bg);
    }
  });
}

function applyAutostart() {
  if (!engine) return;
  // macOS: setLoginItemSettings ignora "args", entao o login item abriria o
  // Electron pelado (sem o app). Ate existir um empacotamento proprio, o
  // autostart fica indisponivel la (a UI ja esconde a opcao).
  if (IS_MAC) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: !!engine.config.autostart,
      path: process.execPath,
      args: [path.resolve(__dirname)]
    });
  } catch { }
}
