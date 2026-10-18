// Identidade do aplicativo nas superfícies nativas do sistema.
import path from 'node:path';

export function identificarAplicativo(app) {
  app.setName('Farol');
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.biud.farol');
  }
}

export function identificarJanela(janela, app) {
  if (process.platform !== 'win32') return;
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
  if (process.platform !== 'darwin') return;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]));
}
