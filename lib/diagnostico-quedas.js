// Minidumps locais são opt-in: podem conter trechos da memória do processo.
// A API precisa iniciar antes de criar o renderer e não pode parar sem reiniciar.
// https://www.electronjs.org/docs/latest/api/crash-reporter
import fs from 'node:fs';
import path from 'node:path';
import { HOME, CONFIG_FILE } from './paths.js';
import { readJson } from './io.js';

function iniciarDiagnosticoQuedas(app, crashReporter, config = readJson(CONFIG_FILE, {})) {
  if (config?.diagnosticoQuedas !== true) return { ativo: false };
  try {
    const diretorio = path.join(HOME, 'diagnostico-quedas');
    fs.mkdirSync(diretorio, { recursive: true, mode: 0o700 });
    fs.chmodSync(diretorio, 0o700);
    app.setPath('crashDumps', diretorio);
    crashReporter.start({ uploadToServer: false, ignoreSystemCrashHandler: true });
    return { ativo: true };
  } catch (err) {
    return { ativo: false, erro: `não foi possível habilitar o diagnóstico local de quedas: ${err.message}` };
  }
}

export { iniciarDiagnosticoQuedas };
