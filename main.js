// Farol · shell Electron: janela nativa, bandeja, notificações e autostart.
// Toda a logica de monitoramento vive em server.js (que tambem roda sozinho
// com "node server.js" caso o Electron nao esteja disponivel).

import { app, BrowserWindow, Tray, Menu, Notification, shell, nativeImage } from 'electron';
import path from 'node:path';

import farol from './server.js';
import { consumirReaberturaSilenciosa } from './lib/engine/update.js';

// fonte única do branch de plataforma (lib/paths.js), como no resto do app
import { IS_MAC } from './lib/paths.js';

let win = null;
let tray = null;
let engine = null;
let appUrl = null;
let quitting = false;
let hideHintShown = false;
let attachedToExisting = false; // porta ocupada: esta janela é só um VISOR da instância que já roda
// reabertura DEPOIS de um auto-update: sobe direto na bandeja, sem roubar o foco
// de quem está trabalhando (pedido do Wanderson, 20/08/2026). O marcador é lido
// UMA vez, aqui no topo do boot, porque o consumo apaga o arquivo.
const reabertura = consumirReaberturaSilenciosa();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.setAppUserModelId('com.biud.farol');

  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    const { engine: eng } = farol.start((url, err) => {
      if (err) {
        // porta ocupada: provavelmente ja existe um Farol rodando em modo servidor.
        // O engine local NÃO monitora (ver start no server.js); esta janela vira visor.
        attachedToExisting = true;
        appUrl = `http://127.0.0.1:${eng.config.port}`;
      } else {
        appUrl = url;
      }
      createWindow();
      createTray();
      wireEngine();
      applyAutostart();
      // depois da bandeja existir: o fallback de balão do notify() precisa dela
      if (reabertura) notify('Farol atualizado', `Agora na versão ${reabertura.to || 'nova'}. Segue monitorando na bandeja.`);
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
    icon: path.join(import.meta.dirname, 'assets', 'farol.ico'),
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
  // pós-update: nasce escondida e fica na bandeja. O aviso de que atualizou sai
  // por notificação (não rouba foco); o ícone da bandeja reabre quando você quiser.
  if (reabertura) opts.show = false;
  win = new BrowserWindow(opts);
  win.setMenuBarVisibility(false);
  win.loadURL(appUrl);
  // a janela nunca apareceu, então o aviso de "continua por aqui" do close não faz
  // sentido; quem conta que o app está vivo é a notificação logo abaixo, no boot
  if (reabertura) hideHintShown = true;

  // Renderer pode morrer sozinho (driver de GPU, principalmente no Windows, onde
  // o titleBarOverlay é composição via GPU do Chromium; o macOS usa hiddenInset,
  // sem esse caminho). Sem este handler a janela fica em branco pra sempre com o
  // processo principal vivo (achado real, 20/08/2026: 4 processos Farol.exe no
  // Task Manager e tela preta). recarrega sozinho; falha do reload não trava o app.
  win.webContents.on('render-process-gone', (_e, details) => {
    engine && engine.log('ERROR', `renderer caiu (${details.reason}); recarregando a janela`);
    if (win && !win.isDestroyed()) { try { win.loadURL(appUrl); } catch { /* próxima interação do usuário reabre pela bandeja */ } }
  });
  // trava (não caiu, mas parou de responder) tem outro sintoma: avisa em vez de
  // recarregar sozinho, pra não interromper um processo que ainda pode voltar.
  // Só WARN na trava: "voltou a responder" é ruído operacional, não falha
  // (invariante 3 do CLAUDE.md), então não vira linha de log.
  win.on('unresponsive', () => { engine && engine.log('WARN', 'janela sem responder'); });

  // no macOS o lancador (Farol.app) e um wrapper que da exec no Electron: quem o Finder
  // ativa morre na hora, e o Electron sobe sem ativacao, com a janela atras de tudo.
  // O steal traz o app pra frente na abertura (sem ele, parece que o app nao abriu)
  if (IS_MAC && !reabertura) {
    app.focus({ steal: true });
    // e o Dock mostra o icone do processo (Electron cru), nao o do lancador;
    // o setIcon troca em runtime pro icone do Farol
    try { app.dock.setIcon(path.join(import.meta.dirname, 'assets', 'png', 'farol-256.png')); } catch { /* best-effort: setIcon pode falhar se arquivo nao existir */ }
  }

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
      // "bandeja do sistema" e vocabulario Windows; no macOS o icone mora na barra de menus
      notify('Farol continua por aqui', IS_MAC
        ? 'Monitorando na barra de menus. Clique no icone do farol para reabrir.'
        : 'Monitorando na bandeja do sistema. Clique no icone para reabrir.');
    }
  });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  // mesmo motivo do createWindow: reabrir via segundo clique no Farol.app chega
  // como second-instance de um app que o macOS nao considera ativo
  if (IS_MAC) app.focus({ steal: true });
}

function trayIcon() {
  const p = path.join(import.meta.dirname, 'assets', 'tray.png');
  let img = nativeImage.createFromPath(p);
  // fallback em PNG, nunca .ico: o nativeImage do macOS nao decodifica ICO e o
  // Tray subiria invisivel; o PNG decodifica nos dois SOs
  if (img.isEmpty()) img = nativeImage.createFromPath(path.join(import.meta.dirname, 'assets', 'png', 'farol-32.png'));
  // a barra de menu do macOS espera ~18px; sem resize o icone sai gigante
  if (IS_MAC && !img.isEmpty()) img = img.resize({ width: 18, height: 18 });
  return img;
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Farol · radar de Pull Requests');
  const menu = Menu.buildFromTemplate([
    { label: 'Abrir o Farol', click: showWindow },
    { label: 'Verificar agora', click: () => engine && !attachedToExisting && engine.checkNow() },
    { type: 'separator' },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', showWindow);
  tray.on('balloon-click', showWindow);
}

function notify(title, body, prUrl) {
  // janela em foco = você já está vendo o toast dentro do app; a notificação
  // do sistema em cima viraria ruído duplicado
  if (win && !win.isDestroyed() && win.isFocused()) return;
  const goto = () => { showWindow(); if (prUrl && engine) engine.focusPr(prUrl); };
  try {
    if (Notification.isSupported()) {
      // PNG e nao .ico: o macOS nao decodifica ICO e a notificacao sairia sem icone
      const n = new Notification({ title, body, icon: path.join(import.meta.dirname, 'assets', 'png', 'farol-256.png') });
      n.on('click', goto);
      n.on('failed', () => balloon(title, body));
      n.show();
      return;
    }
  } catch { /* cai pro balao */ }
  balloon(title, body);
}

// Badge de pendencias: da pra saber se ha decisoes esperando sem abrir a janela.
// Windows: bolinha de overlay no icone da barra de tarefas; macOS: numero no Dock;
// e o tooltip da bandeja carrega a contagem nos dois.
let lastBadgeCount = -1;

// alpha do pixel da bolinha do badge: cheio dentro do raio, zero fora,
// borda com meio-tom de 1px (anti-alias manual)
function alphaBolinha(d, r) {
  if (d <= r - 0.5) return 255;
  if (d >= r + 0.5) return 0;
  return Math.round(255 * (r + 0.5 - d));
}

function overlayDot() {
  // bolinha vermelha 16x16 desenhada na mao (BGRA), zero dependencias
  const S = 16, buf = Buffer.alloc(S * S * 4);
  const cx = 7.5, cy = 7.5, r = 6.5;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const a = alphaBolinha(d, r);
      const i = (y * S + x) * 4;
      buf[i] = 54; buf[i + 1] = 66; buf[i + 2] = 239; buf[i + 3] = a; // BGRA: #ef4236
    }
  }
  return nativeImage.createFromBitmap(buf, { width: S, height: S });
}
function updateBadge(snapshot) {
  const count = ((snapshot.decisions || {}).pending || []).length;
  if (count === lastBadgeCount) return;
  lastBadgeCount = count;
  const label = count === 1 ? '1 decisão esperando você' : `${count} decisões esperando você`;
  try {
    if (IS_MAC) { app.dock && app.dock.setBadge(count ? String(count) : ''); }
    else if (win && !win.isDestroyed()) { win.setOverlayIcon(count ? overlayDot() : null, count ? label : ''); }
    tray && tray.setToolTip(count ? `Farol · ${label}` : 'Farol');
  } catch { /* badge e cosmetico, nunca derruba o shell */ }
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
    notify(`Farol · ${title}`, body, n === 1 ? items[0].url : null);
  });
  // alertas dizem o DESFECHO e o MOTIVO (aprovado sem/com ressalvas, reprovado,
  // precisa da sua atenção): transparência em vez de "sem você"
  engine.on('auto-approved', ({ pr, result, points }) => {
    const ressalvas = points || [];
    if (ressalvas.length) {
      const extra = ressalvas.length > 1 ? ` (+${ressalvas.length - 1})` : '';
      notify('Farol · aprovado com ressalvas ⚠️', `${pr.key}: APPROVE postado. Ressalva: ${ressalvas[0]}${extra}. Detalhes em Revisões recentes.`, pr.url);
    } else {
      notify('Farol · aprovado sem ressalvas ✅', `${pr.key} (${result.card || 'sem card'}): revisão completa, nenhum ponto de atenção. APPROVE postado.`, pr.url);
    }
  });
  engine.on('auto-rejected', ({ pr, result }) => {
    const motivo = (result.reasons && result.reasons[0]) || 'ver relatório';
    notify('Farol · reprovado 🔴', `${pr.key}: mudanças pedidas. Motivo: ${motivo}`, pr.url);
  });
  engine.on('tool-done', ({ name, label }) => {
    notify(`Farol · ${label}`, name === 'kudos' ? 'Kudos prontos pra copiar na aba Destaques.' : 'Relatório disponível na aba Sistema.');
  });
  engine.on('needs-decision', ({ pr, item }) => {
    const motivo = (item.reasons && item.reasons[0]) || 'ver relatório';
    const extra = (item.reasons || []).length > 1 ? ` (+${item.reasons.length - 1} motivo(s))` : '';
    notify('Farol · precisa da sua atenção 🟡', `${pr.key}: ${motivo}${extra}`, pr.url);
    if (win) win.flashFrame(true);
  });
  engine.on('state', updateBadge);
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
      args: [path.resolve(import.meta.dirname)]
    });
  } catch { }
}
