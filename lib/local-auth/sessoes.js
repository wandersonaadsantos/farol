// Sessões autorizadas da API local (A4, spec 7.A4 item 4). Em disco fica só o hash do
// token. Não há cache em memória: revogar pelo comando local vale na requisição seguinte,
// e reiniciar o engine não derruba ninguém.
import crypto from 'node:crypto';
import path from 'node:path';
import { LOCAL_AUTH_DIR } from '../paths.js';
import { TEMPOS, LOCAL_AUTH } from '../constants.js';
import { lerLista, gravarRestrito } from './arquivo.js';

const ARQUIVO = path.join(LOCAL_AUTH_DIR, 'sessoes.json');
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function sessoesPath() { return ARQUIVO; }

// Comparar o hash com === não vaza nada útil: o token tem 256 bits aleatórios, e descobrir
// o hash guardado não devolve o token que o gerou.
function hashDoToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function viva(sessao, agora) {
  if (!sessao || typeof sessao.hash !== 'string') return false;
  if (agora - Number(sessao.criadoEm) >= TEMPOS.SESSAO_LOCAL_ABSOLUTA_MS) return false;
  return agora - Number(sessao.ultimoUsoEm) < TEMPOS.SESSAO_LOCAL_OCIOSA_MS;
}

function emitirSessao(rotulo = '', agora = Date.now()) {
  const token = crypto.randomBytes(LOCAL_AUTH.TOKEN_BYTES).toString('base64url');
  const nova = { hash: hashDoToken(token), criadoEm: agora, ultimoUsoEm: agora, rotulo: String(rotulo || '').slice(0, LOCAL_AUTH.ROTULO_MAX) };
  gravarRestrito(ARQUIVO, [...lerLista(ARQUIVO).filter(s => viva(s, agora)), nova]);
  return token;
}

function verificarSessao(token, agora = Date.now()) {
  if (!FORMATO_TOKEN.test(String(token || ''))) return false;
  const lista = lerLista(ARQUIVO);
  const hash = hashDoToken(token);
  const sessao = lista.find(s => viva(s, agora) && s.hash === hash);
  if (!sessao) return false;
  if (agora - Number(sessao.ultimoUsoEm) >= TEMPOS.SESSAO_LOCAL_TOQUE_MS) {
    sessao.ultimoUsoEm = agora;
    gravarRestrito(ARQUIVO, lista.filter(s => viva(s, agora)));
  }
  return true;
}

function revogarTodas() { gravarRestrito(ARQUIVO, []); }

// Revogação individual (a tela prevista na spec). O identificador público é um pedaço do
// hash, nunca o token: saber o hash inteiro não devolve o token, e o pedaço só serve para
// apontar a linha. `atual` marca a sessão de quem está pedindo.
function idPublico(hash) {
  return String(hash || '').slice(0, 16);
}

function listarSessoes({ tokenAtual = '', agora = Date.now() } = {}) {
  const hashAtual = FORMATO_TOKEN.test(String(tokenAtual || '')) ? hashDoToken(tokenAtual) : '';
  return lerLista(ARQUIVO).filter((s) => viva(s, agora)).map((s) => ({
    id: idPublico(s.hash), rotulo: String(s.rotulo || ''), criadoEm: Number(s.criadoEm) || 0,
    ultimoUsoEm: Number(s.ultimoUsoEm) || 0, atual: !!hashAtual && s.hash === hashAtual,
  }));
}

function revogarSessao(id, agora = Date.now()) {
  const alvo = String(id || '');
  if (!/^[0-9a-f]{16}$/.test(alvo)) return false;
  const lista = lerLista(ARQUIVO).filter((s) => viva(s, agora));
  const restantes = lista.filter((s) => idPublico(s.hash) !== alvo);
  if (restantes.length === lista.length) return false;
  gravarRestrito(ARQUIVO, restantes);
  return true;
}

export default { sessoesPath, emitirSessao, verificarSessao, revogarTodas, listarSessoes, revogarSessao };
export { sessoesPath, emitirSessao, verificarSessao, revogarTodas, listarSessoes, revogarSessao };
