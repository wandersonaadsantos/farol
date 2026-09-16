// Chave do admin (CT-ENV, "Gestão de chave"): par Ed25519 que NASCE e MORA só no aparelho
// que é admin. A privada nunca sobe para o banco, nunca entra no config.json e nunca sai
// em snapshot, log ou resposta de rota; o que sobe é só a pública, em live/control/admin.
//
// Mora em ~/.farol/sync-admin.json, ao lado do sync-credentials.json e do sync-key.json,
// com modo 0600 em TODA gravação, pelo mesmo motivo dos dois: é segredo do aparelho, e
// state/ é o cwd das sessões do Claude.
//
// A chave é presa à GERAÇÃO: geração nova significa outro admin (ou este mesmo admin
// refeito), e guardar a chave velha só criaria caminho para assinar com uma autoridade
// que não existe mais.
import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { HOME } from '../paths.js';
import { SYNC } from '../constants.js';
import io from '../io.js';

const ARQUIVO = path.join(HOME, SYNC.ADMIN_KEY_FILE);
const VERSAO = 1;

function caminhoDaChaveDeAdmin() { return ARQUIVO; }

function texto(v) { return typeof v === 'string' ? v.trim() : ''; }

function objeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

// chmod não existe em NTFS: no Windows a proteção real é a ACL do perfil do usuário.
function restringir(arquivo) {
  try { fs.chmodSync(arquivo, 0o600); } catch { /* sem suporte a modo neste sistema de arquivos */ }
}

// A pública viaja como os 43 caracteres base64url do `x` do JWK: é o formato que o nó
// live/control/admin guarda, e o que o verificador reconstrói para conferir assinatura.
function gerarParDeAdmin() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = privateKey.export({ format: 'jwk' });
  return { publicKey: publicKey.export({ format: 'jwk' }).x, jwk };
}

function chavePublicaDe(x) {
  try {
    return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: texto(x) }, format: 'jwk' });
  } catch {
    // pública malformada no banco: quem chama trata como assinatura não verificável
    return null;
  }
}

function lerChaveDeAdmin() {
  const d = io.readJson(ARQUIVO, null);
  if (!objeto(d) || d.v !== VERSAO || !objeto(d.jwk) || !texto(d.jwk.d)) return null;
  return { uid: texto(d.uid), destino: texto(d.destino), generation: Number(d.generation) || 0, jwk: { ...d.jwk } };
}

function gravarChaveDeAdmin(valor) {
  const v = valor || {};
  const uid = texto(v.uid);
  if (!uid || !objeto(v.jwk) || !texto(v.jwk.d)) return false;
  try {
    io.ensureDir(path.dirname(ARQUIVO));
    io.writeJsonAtomic(ARQUIVO, { v: VERSAO, uid, destino: texto(v.destino), generation: Number(v.generation) || 0, jwk: { ...v.jwk } });
    restringir(ARQUIVO);
    return true;
  } catch {
    // disco cheio ou sem permissão: sem chave local este aparelho não assina, e a tela
    // mostra que ele não é admin
    return false;
  }
}

function apagarChaveDeAdmin() {
  if (!fs.existsSync(ARQUIVO)) return false;
  fs.rmSync(ARQUIVO, { force: true });
  return true;
}

function chaveServe(chave, { uid, destino, generation }) {
  if (!objeto(chave)) return false;
  if (chave.uid !== texto(uid) || chave.destino !== texto(destino)) return false;
  return Number(chave.generation) === Number(generation);
}

// O que a tela pode ver: nunca o `d`.
function resumoDaChaveDeAdmin(chave) {
  if (!objeto(chave)) return null;
  return { uid: chave.uid, destino: chave.destino, generation: Number(chave.generation) || 0, publicKey: texto(chave.jwk && chave.jwk.x) };
}

export default { caminhoDaChaveDeAdmin, gerarParDeAdmin, lerChaveDeAdmin, gravarChaveDeAdmin, apagarChaveDeAdmin, chaveServe, resumoDaChaveDeAdmin, chavePublicaDe };
export { caminhoDaChaveDeAdmin, gerarParDeAdmin, lerChaveDeAdmin, gravarChaveDeAdmin, apagarChaveDeAdmin, chaveServe, resumoDaChaveDeAdmin, chavePublicaDe };
