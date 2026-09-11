// Único lugar do app que lê ou grava o login do Firebase deste aparelho. Mora fora
// do config.json pelo mesmo motivo de lib/jira/credentials.js: o config inteiro
// trafega para a UI, e o refresh token é credencial (troca por ID token sem senha,
// por tempo indeterminado). A senha nunca entra aqui: ela é usada uma vez no login
// e descartada.
import fs from 'node:fs';
import path from 'node:path';
import { HOME } from '../paths.js';
import { SYNC } from '../constants.js';
import io from '../io.js';

const ARQUIVO = path.join(HOME, SYNC.CREDENTIALS_FILE);

function credentialsPath() { return ARQUIVO; }

function texto(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// chmod não existe em NTFS: a proteção real no Windows é a ACL do perfil do
// usuário. Aqui é best effort pro caso POSIX, e falhar não pode impedir o login.
function restringirPermissao(arquivo) {
  try { fs.chmodSync(arquivo, 0o600); } catch { /* sem suporte a modo neste sistema de arquivos */ }
}

// TODA gravação restringe de novo: o writeJsonAtomic entrega ao arquivo final o
// modo default do .tmp, então a rotação do refresh token devolveria o arquivo para
// 0644 se o chmod só acontecesse no primeiro login (mesma armadilha já paga no Jira).
function gravar(dados) {
  io.ensureDir(path.dirname(ARQUIVO));
  io.writeJsonAtomic(ARQUIVO, dados);
  restringirPermissao(ARQUIVO);
}

function readSyncCredential() {
  const d = io.readJson(ARQUIVO, null);
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const uid = texto(d.uid);
  const refreshToken = texto(d.refreshToken);
  if (!uid || !refreshToken) return null;
  return { uid, email: texto(d.email), refreshToken, savedAt: Number(d.savedAt) || 0 };
}

function hasSyncCredential() { return !!readSyncCredential(); }

function setSyncCredential(valor) {
  const v = valor || {};
  const uid = texto(v.uid);
  const refreshToken = texto(v.refreshToken);
  if (!uid || !refreshToken) return false;
  gravar({ uid, email: texto(v.email), refreshToken, savedAt: Date.now() });
  return true;
}

// O securetoken pode devolver um refresh token NOVO a cada renovação; guardar o
// velho funcionaria até a rotação invalidá-lo, e aí o aparelho cairia sem aviso.
//
// O `uid` é conferido porque a renovação é ASSÍNCRONA e pode chegar depois de a pessoa
// ter trocado de conta: gravar o token da conta anterior sob o uid da nova produz um
// arquivo coerente na forma e inválido no servidor, e o aparelho entra em laço de 401
// mostrando "indisponível" em vez de pedir login. Renovação de outra conta é descartada,
// que é o mesmo que ela já seria: o token velho morre sozinho.
function updateRefreshToken(refreshToken, uid = '') {
  const atual = readSyncCredential();
  const novo = texto(refreshToken);
  if (!atual || !novo) return false;
  const doDono = texto(uid);
  if (doDono && doDono !== atual.uid) return false;
  gravar({ uid: atual.uid, email: atual.email, refreshToken: novo, savedAt: Date.now() });
  return true;
}

function removeSyncCredential() {
  if (!fs.existsSync(ARQUIVO)) return false;
  fs.rmSync(ARQUIVO, { force: true });
  return true;
}

export default { credentialsPath, readSyncCredential, setSyncCredential, updateRefreshToken, removeSyncCredential, hasSyncCredential };
export { credentialsPath, readSyncCredential, setSyncCredential, updateRefreshToken, removeSyncCredential, hasSyncCredential };
