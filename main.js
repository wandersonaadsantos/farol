// Farol · shell Electron: janela nativa, bandeja, notificações e autostart.
// Toda a logica de monitoramento vive em server.js (que tambem roda sozinho
// com "node server.js" caso o Electron nao esteja disponivel).

import { app, BrowserWindow, Tray, Menu, Notification, shell, nativeImage, crashReporter } from 'electron';
import path from 'node:path';

import farol from './server.js';
import { interventionEvent } from './ui/pure/interventions.js';
import { avisoDe, badgeDe, coresDe } from './lib/engine/avisos-nativos.js';
import { consumirReaberturaSilenciosa } from './lib/engine/update.js';

// fonte única do branch de plataforma (lib/paths.js), como no resto do app
import { IS_MAC, IS_WIN } from './lib/paths.js';
import { TEMPOS } from './lib/constants.js';
import { aplicarAutostartMac } from './lib/autostart-mac.js';
import { identificarAplicativo, identificarJanela, instalarMenuMac, carimbarAtalhoDoElectron } from './lib/desktop-identity.js';
import { linhaDaQuedaDoRenderer, linhaDaQuedaDeProcesso, memoriaDoProcesso } from './lib/queda-de-processo.js';
import { iniciarDiagnosticoQuedas } from './lib/diagnostico-quedas.js';
import { quedaInesperada, recarregarJanela } from './lib/renderer-recovery.js';

// A queda do renderer só é diagnosticável com o que se sabia ANTES dela: depois
// que o processo morre não há memória para medir. Então a memória dele é amostrada
// em silêncio (nada vai ao log) e a linha da queda conta a última amostra.
const AMOSTRA_RENDERER_MS = 30000;
let amostraRenderer = null;
let paginaCarregadaEm = null;

let win = null;
let tray = null;
let engine = null;
let appUrl = null;
let quitting = false;
let hideHintShown = false;
let balloonTarget = null;
let attachedToExisting = false; // porta ocupada: esta janela é só um VISOR da instância que já roda
// reabertura DEPOIS de um auto-update: sobe direto na bandeja, sem roubar o foco
// de quem está trabalhando (pedido do Wanderson, 20/08/2026). O marcador é lido
// UMA vez, aqui no topo do boot, porque o consumo apaga o arquivo.
const reabertura = consumirReaberturaSilenciosa();

// Quando o macOS executa o binário cru do Electron, a barra de menu pode herdar
// "Electron" do bundle nativo. O nome do app precisa ser afirmado pelo processo.
identificarAplicativo(app);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  const diagnosticoQuedas = iniciarDiagnosticoQuedas(app, crashReporter);

  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    instalarMenuMac(Menu);
    agendarIconeDoAtalho();
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
    if (diagnosticoQuedas.erro) engine.log('WARN', diagnosticoQuedas.erro);
  });

  app.on('before-quit', () => { quitting = true; });
  // GPU e utilitários (rede, áudio) também morrem sozinhos; a do GPU é suspeita direta
  // das quedas do renderer no Windows (titleBarOverlay compõe pela GPU). Saída limpa e
  // o encerramento do app não são falha.
  app.on('child-process-gone', (_e, details) => {
    if (quitting) return;
    const linha = linhaDaQuedaDeProcesso(details, IS_WIN);
    if (linha && engine) engine.log('ERROR', linha);
  });
  app.on('window-all-closed', () => { /* segue vivo na bandeja */ });
  app.on('activate', () => showWindow()); // macOS: clique no Dock reabre a janela
}

function themeColors() {
  return coresDe(engine?.config);
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
  identificarJanela(win, app);
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
  // Desde 05/11/2026 a linha leva código de saída, a última memória medida, há quanto
  // tempo a página carregou e se a janela estava visível: 23 quedas só com "(crashed)"
  // não deram diagnóstico nenhum (lib/queda-de-processo.js).
  win.webContents.on('did-finish-load', () => { paginaCarregadaEm = Date.now(); });
  win.webContents.on('render-process-gone', (_e, details) => {
    if (!quedaInesperada(details, quitting)) return;
    const visivel = win && !win.isDestroyed() ? win.isVisible() : undefined;
    engine && engine.log('ERROR', linhaDaQuedaDoRenderer({
      details, amostra: amostraRenderer, carregadaEm: paginaCarregadaEm, visivel, agora: Date.now(), ehWindows: IS_WIN,
    }));
    amostraRenderer = null;
    paginaCarregadaEm = null;
    void recarregarJanela(win, appUrl, mensagem => engine?.log('ERROR', mensagem));
  });
  amostrarRenderer();
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

// Amostra silenciosa da memória do renderer (app.getAppMetrics, sem custo de IPC
// com a página). unref: o relógio nunca segura o app vivo na saída.
function amostrarRenderer() {
  const medir = () => {
    try {
      if (!win || win.isDestroyed()) return;
      const mem = memoriaDoProcesso(app.getAppMetrics(), win.webContents.getOSProcessId());
      if (mem) amostraRenderer = { ...mem, em: Date.now() };
    } catch { /* medir é best-effort; a queda continua registrada sem memória */ }
  };
  medir();
  const t = setInterval(medir, AMOSTRA_RENDERER_MS);
  if (t.unref) t.unref();
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  // No Windows, `focus()` sozinho NÃO traz a janela pra frente: o SO só deixa
  // quem já é o processo em primeiro plano roubar o foco (foreground lock), e
  // clicar numa notificação não conta. O resultado era o clique não fazer nada
  // visível (achado do Wanderson em 20/08/2026). O pulo do alwaysOnTop força a
  // janela pro topo e é desfeito na sequência, pra ela não ficar presa lá.
  if (!IS_MAC) {
    try { win.setAlwaysOnTop(true); win.setAlwaysOnTop(false); } catch { /* cosmético, nunca derruba */ }
  }
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
  tray.on('balloon-click', () => balloonTarget ? balloonTarget() : showWindow());
}

// A notificacao faz o Electron gravar o Electron.lnk sem icone, numa tarefa em
// segundo plano; o icone do Farol entra depois que ele terminou (desktop-identity.js).
// Uma rajada de notificacoes reagenda em vez de empilhar leituras do atalho, e uma
// segunda olhada cobre a maquina lenta em que o Electron grava depois da primeira.
let timersDoAtalho = [];
function agendarIconeDoAtalho() {
  if (!IS_WIN) return;
  for (const t of timersDoAtalho) clearTimeout(t);
  timersDoAtalho = [TEMPOS.ATALHO_DO_ELECTRON_MS, TEMPOS.ATALHO_DO_ELECTRON_SEGUNDA_MS]
    .map((espera) => setTimeout(() => carimbarAtalhoDoElectron(shell, app), espera));
}

function notify(title, body, prUrl, onOpen, silent = false) {
  // janela em foco = você já está vendo o toast dentro do app; a notificação
  // do sistema em cima viraria ruído duplicado
  if (win && !win.isDestroyed() && win.isFocused()) return;
  const goto = () => { showWindow(); if (onOpen) onOpen(); else if (prUrl && engine) engine.focusPr(prUrl); };
  try {
    if (Notification.isSupported()) {
      // PNG e nao .ico: o macOS nao decodifica ICO e a notificacao sairia sem icone
      const n = new Notification({ title, body, silent, icon: path.join(import.meta.dirname, 'assets', 'png', 'farol-256.png') });
      n.on('click', goto);
      n.on('failed', () => balloon(title, body, goto, silent));
      n.show();
      agendarIconeDoAtalho();
      return;
    }
  } catch { /* cai pro balao */ }
  balloon(title, body, goto, silent);
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
  const { contador: count, rotulo: label } = badgeDe(snapshot);
  if (count === lastBadgeCount) return;
  lastBadgeCount = count;
  try {
    if (IS_MAC) { app.dock && app.dock.setBadge(count ? String(count) : ''); }
    else if (win && !win.isDestroyed()) { win.setOverlayIcon(count ? overlayDot() : null, count ? label : ''); }
    tray && tray.setToolTip(count ? `Farol · ${label}` : 'Farol');
  } catch { /* badge e cosmetico, nunca derruba o shell */ }
}

function balloon(title, content, onOpen, silent) {
  balloonTarget = onOpen || null;
  try { tray && tray.displayBalloon({ title, content, noSound: !!silent, icon: trayIcon() }); } catch { }
}

function wireEngine() {
  if (!engine) return;
  // título e corpo moram em lib/engine/avisos-nativos.js, a mesma fonte das cascas nativas
  const notificar = (evento) => (payload) => {
    const aviso = avisoDe(evento, payload);
    if (aviso) notify(aviso.titulo, aviso.corpo, aviso.url);
  };
  engine.on('new-prs', notificar('new-prs'));
  engine.on('auto-approved', notificar('auto-approved'));
  engine.on('auto-rejected', notificar('auto-rejected'));
  // PR da própria conta que revisa: o GitHub não aceita a revisão decisiva do autor, e ela sai
  // como comentário (lib/engine/desfecho-da-revisao.js e espera-pr-proprio.js, v2.72.12)
  engine.on('auto-commented', notificar('auto-commented'));
  engine.on('tool-done', notificar('tool-done'));
  engine.on('review-started', notificar('review-started'));
  engine.on('intervention', raw => {
    const event = interventionEvent(raw); if (!event) return;
    const aviso = avisoDe('intervention', raw, { config: engine.config });
    notify(aviso.titulo, aviso.corpo, null, () => engine.emit('focus-intervention', event.target), aviso.silencioso);
    if (win && !win.isDestroyed() && !win.isFocused()) win.flashFrame(true);
  });
  // PR meu em conflito ou já absorvido pela base (lib/engine/meus-prs-base.js), uma vez por head
  engine.on('meu-pr-base', notificar('meu-pr-base'));
  // release de ponte (desenho 4.7 do Farol nativo): a 3.x não roda nesta casca; o engine emite
  // uma vez por processo e versão, e o clique só abre a janela (o aviso fica em Sistema)
  engine.on('update-ponte', (p) => {
    notify('Farol · última versão nesta casca', `A ${p.versao} é o Farol nativo. Baixe o instalador em Sistema > Visão geral.`, null);
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
  // Electron pelado (sem o app). La o autostart e um LaunchAgent que abre o
  // lancador ~/Applications/Farol.app (lib/autostart-mac.js).
  if (IS_MAC) {
    const r = aplicarAutostartMac({ ligado: !!engine.config.autostart });
    if (!r.ok) engine.log('WARN', `iniciar com o macOS: ${r.motivo}`);
    return;
  }
  try {
    app.setLoginItemSettings({
      openAtLogin: !!engine.config.autostart,
      path: process.execPath,
      args: [path.resolve(import.meta.dirname)]
    });
  } catch { }
}

// Observação do shell real pelo smoke Electron; não altera boot, UI ou monitoramento.
export { win, tray, engine, appUrl, attachedToExisting, notify, applyAutostart };
