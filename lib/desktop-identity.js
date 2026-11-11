// Identidade do aplicativo nas superfícies nativas do sistema.
import path from 'node:path';
import { IS_WIN, IS_MAC } from './paths.js';

const APP_ID = 'com.biud.farol';

export function identificarAplicativo(app) {
  app.setName('Farol');
  if (IS_WIN) {
    app.setAppUserModelId(APP_ID);
  }
}

export function identificarJanela(janela, app) {
  if (!IS_WIN) return;
  // O ID do processo não basta para janelas iniciadas por executáveis Electron.
  // A identidade explícita também orienta fixar e reabrir pela barra de tarefas.
  // O instalador renomeia o Electron: isPackaged vira true, mas defaultApp
  // continua indicando que o executável precisa receber a pasta do aplicativo.
  const argumentos = process.defaultApp ? [app.getAppPath()] : [];
  janela.setAppDetails({
    appId: APP_ID,
    appIconPath: path.join(app.getAppPath(), 'assets', 'farol.ico'),
    relaunchDisplayName: 'Farol',
    relaunchCommand: [process.execPath, ...argumentos].map((valor) => `"${valor}"`).join(' '),
  });
}

// O Electron 44 grava, ao registrar o ativador das notificações, um atalho em
// Programs\<nome do executável>.lnk ("Electron", porque o Farol.exe é o
// electron.exe renomeado) com o AUMID do Farol e sem ícone. A barra de tarefas
// pode escolher esse atalho e mostrar o átomo do Electron. Apagar não adianta:
// ele volta na próxima notificação. O Electron só reescreve o atalho quando o
// alvo, a pasta, o AUMID ou o ID do ativador mudam, nunca pelo ícone, então
// basta pôr o farol.ico nele uma vez.
export const ATALHO_DO_ELECTRON = 'Electron.lnk';

export function precisaDoIconeDoFarol(link, { executavel, icone }) {
  if (!link || !executavel || !icone) return false;
  const igual = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
  return igual(link.target, executavel) && link.appUserModelId === APP_ID && !igual(link.icon, icone);
}

export function caminhoDoAtalhoDoElectron(appData) {
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', ATALHO_DO_ELECTRON);
}

// Devolve true quando gravou o ícone. Nunca lança: atalho ausente, ilegível ou
// de outro app fica como está.
export function carimbarAtalhoDoElectron(shell, app, pastaAppData) {
  if (!IS_WIN) return false;
  try {
    const atalho = caminhoDoAtalhoDoElectron(pastaAppData || app.getPath('appData'));
    const icone = path.join(app.getAppPath(), 'assets', 'farol.ico');
    const link = shell.readShortcutLink(atalho);
    if (!precisaDoIconeDoFarol(link, { executavel: process.execPath, icone })) return false;
    return shell.writeShortcutLink(atalho, 'update', { icon: icone, iconIndex: 0, description: 'Farol' });
  } catch {
    return false;
  }
}

export function instalarMenuMac(Menu) {
  if (!IS_MAC) return;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]));
}
