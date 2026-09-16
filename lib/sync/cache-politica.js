// Última política aceita (CT-ADM-POL). Mora em ~/.farol, ao lado do sync-key.json e do
// sync-admin.json, e leva 0600 em TODA gravação pelo mesmo motivo deles: state/ é o cwd
// das sessões do Claude, e o config.json inteiro trafega para a UI.
//
// Aqui NÃO há segredo: o que fica é a política já aberta, saneada e a versão que a
// produziu. O modo restrito existe porque este arquivo decide o que o aparelho pode fazer,
// e um arquivo que qualquer processo do usuário reescreve seria um jeito silencioso de
// pausar (ou despausar) o Farol sem passar por admin nenhum.
//
// Ele é o que faz a política sobreviver a reinício e a uma queda de autoridade: sem cache,
// reiniciar o Farol ampliaria sozinho o que o admin tinha restringido.
import fs from 'node:fs';
import path from 'node:path';
import { HOME } from '../paths.js';
import { SYNC } from '../constants.js';
import io from '../io.js';
import { sanearPolitica } from './politica.js';

const ARQUIVO = path.join(HOME, SYNC.POLICY_CACHE_FILE);
const VERSAO = 1;

function caminhoDoCache() { return ARQUIVO; }

function texto(v) { return typeof v === 'string' ? v.trim() : ''; }

function objeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

// chmod não existe em NTFS: no Windows a proteção real é a ACL do perfil do usuário.
function restringir(arquivo) {
  try { fs.chmodSync(arquivo, 0o600); } catch { /* sem suporte a modo neste sistema de arquivos */ }
}

// A política é saneada TAMBÉM na leitura: o arquivo é do disco, e disco é entrada.
function lerPolitica() {
  const d = io.readJson(ARQUIVO, null);
  if (!objeto(d) || d.v !== VERSAO) return null;
  const uid = texto(d.uid);
  if (!uid) return null;
  return {
    uid, dev: texto(d.dev), generation: Number(d.generation) || 0, versao: Number(d.versao) || 0,
    politica: sanearPolitica(d.politica), aceitaEm: Number(d.aceitaEm) || 0,
  };
}

function gravarPolitica(valor) {
  const v = valor || {};
  const uid = texto(v.uid);
  if (!uid) return false;
  try {
    io.ensureDir(path.dirname(ARQUIVO));
    io.writeJsonAtomic(ARQUIVO, {
      v: VERSAO, uid, dev: texto(v.dev), generation: Number(v.generation) || 0,
      versao: Number(v.versao) || 0, politica: sanearPolitica(v.politica), aceitaEm: Date.now(),
    });
    restringir(ARQUIVO);
    return true;
  } catch {
    // sem cache, a política vale só enquanto o Farol estiver de pé nesta sessão
    return false;
  }
}

function apagarPolitica() {
  if (!fs.existsSync(ARQUIVO)) return false;
  fs.rmSync(ARQUIVO, { force: true });
  return true;
}

// Cache de outra conta ou de outro aparelho não vale: política é por aparelho.
function politicaServe(cache, { uid, dev }) {
  if (!objeto(cache)) return false;
  return cache.uid === texto(uid) && cache.dev === texto(dev);
}

export default { caminhoDoCache, lerPolitica, gravarPolitica, apagarPolitica, politicaServe };
export { caminhoDoCache, lerPolitica, gravarPolitica, apagarPolitica, politicaServe };
