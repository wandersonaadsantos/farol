// Único lugar do app que lê ou escreve a credencial do Jira. Mora fora do
// config.json porque o config inteiro trafega pra UI (ui/app.js monta perfil com
// apiKey em texto puro), e tudo que entra lá passa a circular por esse caminho.
import fs from 'node:fs';
import path from 'node:path';
import { HOME } from '../paths.js';
import io from '../io.js';

const ARQUIVO = path.join(HOME, 'jira-credentials.json');

function credentialsPath() { return ARQUIVO; }

function ler() {
  const dados = io.readJson(ARQUIVO, {});
  return (dados && typeof dados === 'object') ? dados : {};
}

// chmod não existe em NTFS: a proteção real no Windows é a ACL do perfil do
// usuário. Aqui é best effort pro caso POSIX, e falhar não pode impedir o cadastro.
function restringirPermissao(arquivo) {
  try { fs.chmodSync(arquivo, 0o600); } catch { /* sem suporte a modo neste sistema de arquivos */ }
}

// TODA gravação restringe de novo. O writeJsonAtomic escreve num .tmp com o modo
// default e o rename entrega ESSE modo ao arquivo final, então o chmod feito uma
// vez só no cadastro não sobrevive à escrita seguinte, e remover um site devolvia
// os tokens dos OUTROS sites pro modo 0644, pra sempre. Sobra a janela do .tmp com
// modo default por alguns milissegundos, limitação conhecida e aceita.
//
// Continua sendo writeJsonAtomic e não rename cru: o io.js mantém de propósito o
// fallback copy mais unlink pro EPERM transitório de antivírus no Windows.
function gravar(todas) {
  io.ensureDir(path.dirname(ARQUIVO));
  io.writeJsonAtomic(ARQUIVO, todas);
  restringirPermissao(ARQUIVO);
}

function credentialFor(siteId) {
  const item = ler()[String(siteId || '')];
  if (!item || !item.email || !item.token) return null;
  return { email: String(item.email), token: String(item.token) };
}

function hasCredential(siteId) { return !!credentialFor(siteId); }

function setCredential(siteId, valor) {
  const id = String(siteId || '').trim();
  const email = String((valor && valor.email) || '').trim();
  const token = String((valor && valor.token) || '').trim();
  if (!id || !email || !token) return false;
  const todas = ler();
  todas[id] = { email, token };
  gravar(todas);
  return true;
}

function removeCredential(siteId) {
  const id = String(siteId || '').trim();
  const todas = ler();
  if (!id || !todas[id]) return false;
  delete todas[id];
  gravar(todas);
  return true;
}

export default { credentialsPath, credentialFor, hasCredential, setCredential, removeCredential };
export { credentialsPath, credentialFor, hasCredential, setCredential, removeCredential };
