// Falha comprovada pela sessão prevalece sobre o doctor (que só vê arquivos locais).
// Guarda apenas metadados do arquivo, nunca tokens. Credencial renovada ou sessão
// bem-sucedida devolve a assinatura à prioridade original.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chaveDaAssinatura } from './limite-plano.js';

function marcaDaCredencial(auth) {
  if (auth.kind !== 'dir') return '';
  try {
    const st = fs.statSync(path.join(auth.dir || path.join(os.homedir(), '.claude'), '.credentials.json'));
    return `${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`;
  } catch { return ''; }
}

function registrarLoginIndisponivel(engine, auth) {
  if (!engine.loginsIndisponiveis) engine.loginsIndisponiveis = new Map();
  engine.loginsIndisponiveis.set(chaveDaAssinatura(auth), marcaDaCredencial(auth));
}

function liberarLogin(engine, auth) {
  engine.loginsIndisponiveis?.delete(chaveDaAssinatura(auth));
}

function loginIndisponivel(engine, auth) {
  const chave = chaveDaAssinatura(auth);
  if (!engine.loginsIndisponiveis?.has(chave)) return false;
  if (engine.loginsIndisponiveis.get(chave) === marcaDaCredencial(auth)) return true;
  liberarLogin(engine, auth);
  return false;
}

export { registrarLoginIndisponivel, loginIndisponivel, liberarLogin };
