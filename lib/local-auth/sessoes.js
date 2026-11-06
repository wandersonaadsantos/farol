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
// A sessão do agente da autoanálise tem hash em domínio próprio: um motor anterior (revert,
// ou a casca voltando ao motor semeado) calcula sha256(token) puro e nunca a reconhece, então
// esse token falha fechado em vez de virar Bearer geral.
const AUTOANALISE = 'autoanalise';
function hashDoToken(token, escopo = '') {
  const dominio = escopo === AUTOANALISE ? `${AUTOANALISE}:` : '';
  return crypto.createHash('sha256').update(dominio + String(token)).digest('hex');
}

// Classes que a sessão guarda: a da casca nativa e a do agente da autoanálise.
function classeDaSessao(classe) {
  return ['casca', AUTOANALISE].includes(classe) ? classe : '';
}

// A sessão da casca nativa (classe 'casca') não tem limite absoluto: a casca a usa
// enquanto está aberta e não tem como pedir código novo sozinha. Continua vencendo com
// 30 dias sem uso, como qualquer outra.
function viva(sessao, agora) {
  if (!sessao || typeof sessao.hash !== 'string') return false;
  const semAbsoluto = sessao.classe === 'casca';
  if (!semAbsoluto && agora - Number(sessao.criadoEm) >= TEMPOS.SESSAO_LOCAL_ABSOLUTA_MS) return false;
  return agora - Number(sessao.ultimoUsoEm) < TEMPOS.SESSAO_LOCAL_OCIOSA_MS;
}

function emitirSessao(rotulo = '', agora = Date.now(), { classe = '' } = {}) {
  const token = crypto.randomBytes(LOCAL_AUTH.TOKEN_BYTES).toString('base64url');
  const valida = classeDaSessao(classe);
  const nova = { hash: hashDoToken(token, valida), criadoEm: agora, ultimoUsoEm: agora, rotulo: String(rotulo || '').slice(0, LOCAL_AUTH.ROTULO_MAX) };
  if (valida) nova.classe = valida;
  gravarRestrito(ARQUIVO, [...lerLista(ARQUIVO).filter(s => viva(s, agora)), nova]);
  return token;
}

// `escopo` vazio é a API geral (Bearer); 'autoanalise' são só as rotas do agente. Uma sessão
// nunca vale fora do próprio escopo.
function verificarSessao(token, agora = Date.now(), escopo = '') {
  if (!FORMATO_TOKEN.test(String(token || ''))) return false;
  const lista = lerLista(ARQUIVO);
  const hash = hashDoToken(token, escopo);
  const doEscopo = (s) => (s.classe === AUTOANALISE) === (escopo === AUTOANALISE);
  const sessao = lista.find(s => viva(s, agora) && s.hash === hash && doEscopo(s));
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
    ultimoUsoEm: Number(s.ultimoUsoEm) || 0, classe: classeDaSessao(s.classe),
    atual: !!hashAtual && s.hash === hashAtual,
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
