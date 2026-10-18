// Identidade do aplicativo nas superfícies nativas do sistema.
import path from 'node:path';
import { IS_WIN, IS_MAC } from './paths.js';

export function identificarAplicativo(app) {
  app.setName('Farol');
  if (IS_WIN) {
    app.setAppUserModelId('com.biud.farol');
  }
}

export function identificarJanela(janela, app) {
  if (!IS_WIN) return;
  // O ID do processo não basta para janelas iniciadas por executáveis Electron.
  // A identidade explícita também orienta fixar e reabrir pela barra de tarefas.
  const argumentos = app.isPackaged ? [] : [app.getAppPath()];
  janela.setAppDetails({
    appId: 'com.biud.farol',
    appIconPath: path.join(app.getAppPath(), 'assets', 'farol.ico'),
    relaunchDisplayName: 'Farol',
    relaunchCommand: [process.execPath, ...argumentos].map((valor) => `"${valor}"`).join(' '),
  });
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
