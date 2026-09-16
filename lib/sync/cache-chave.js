// Cache local do material de chave (CT-ENV). Mora em ~/.farol, pelo mesmo motivo do
// lib/sync/credentials.js: o config.json inteiro trafega para a UI, e state/ é o cwd das
// sessões do Claude. Aqui ficam K_id e K_enc em claro, então o arquivo é o ativo mais
// sensível do aparelho e leva 0600 em TODA gravação.
//
// O boot só LÊ este arquivo: sem scrypt, sem rede e sem pedir senha. É o que faz o Farol
// abrir funcionando depois de reiniciar.
//
// Desligar a sincronização NÃO apaga o cache, e credencial do Firebase inválida também
// não: a spec é explícita, porque é justamente o cache que permite recuperar as chaves
// depois de uma redefinição de senha por e-mail. Só "Sair deste aparelho" apaga.
import fs from 'node:fs';
import path from 'node:path';
import { HOME } from '../paths.js';
import { SYNC } from '../constants.js';
import io from '../io.js';
import kek from './kek.js';

const ARQUIVO = path.join(HOME, SYNC.KEY_CACHE_FILE);
const VERSAO = 1;

function caminhoDoCache() { return ARQUIVO; }

function texto(v) { return typeof v === 'string' ? v.trim() : ''; }

function objeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

// chmod não existe em NTFS: no Windows a proteção real é a ACL do perfil do usuário.
function restringir(arquivo) {
  try { fs.chmodSync(arquivo, 0o600); } catch { /* sem suporte a modo neste sistema de arquivos */ }
}

function lerCache() {
  const d = io.readJson(ARQUIVO, null);
  if (!objeto(d) || d.v !== VERSAO) return null;
  const uid = texto(d.uid);
  const id = texto(d.id);
  if (!uid || !id || !objeto(d.enc) || !Object.keys(d.enc).length) return null;
  return { uid, destino: texto(d.destino), keyringRev: Number(d.keyringRev) || 0, cur: texto(d.cur), id, enc: { ...d.enc }, savedAt: Number(d.savedAt) || 0 };
}

// A allowlist de campos é o que impede a senha (ou qualquer outra coisa que o chamador
// tenha em mãos) de cair no arquivo por descuido.
function gravarCache(valor) {
  const v = valor || {};
  const uid = texto(v.uid);
  const id = texto(v.id);
  if (!uid || !id || !objeto(v.enc)) return false;
  try {
    io.ensureDir(path.dirname(ARQUIVO));
    io.writeJsonAtomic(ARQUIVO, {
      v: VERSAO, uid, destino: texto(v.destino), keyringRev: Number(v.keyringRev) || 0,
      cur: texto(v.cur), id, enc: { ...v.enc }, savedAt: Date.now(),
    });
    restringir(ARQUIVO);
    return true;
  } catch {
    // disco cheio ou sem permissão: sem cache o próximo login pede a senha de novo
    return false;
  }
}

function apagarCache() {
  if (!fs.existsSync(ARQUIVO)) return false;
  fs.rmSync(ARQUIVO, { force: true });
  return true;
}

function cacheServe(cache, { uid, destino }) {
  if (!objeto(cache)) return false;
  return cache.uid === texto(uid) && cache.destino === texto(destino);
}

// Prova, sem senha, que o material local é o mesmo que o banco conhece. Precisa cobrir a
// geração CORRENTE: cache de antes de uma rotação abriria o histórico e cifraria o novo
// com uma chave que os outros aparelhos não têm.
function cacheConfere(cache, chaveiro) {
  if (!objeto(cache) || !objeto(chaveiro) || !objeto(chaveiro.kcv)) return false;
  const cur = texto(chaveiro.cur);
  if (!cur || !cache.enc[cur]) return false;
  for (const [g, esperado] of Object.entries(chaveiro.kcv)) {
    const local = cache.enc[g];
    if (!local) continue;
    if (kek.kcvDe(local) !== esperado) return false;
  }
  return true;
}

export default { caminhoDoCache, lerCache, gravarCache, apagarCache, cacheServe, cacheConfere };
export { caminhoDoCache, lerCache, gravarCache, apagarCache, cacheServe, cacheConfere };
