// Códigos de pareamento da API local (A4, spec 7.A4 item 3). O código em claro existe
// só na saída do comando local (tools/farol-parear.js) e no corpo do POST /api/auth/pair;
// em disco ficam o hash com sal, a validade e o contador de erros.
import crypto from 'node:crypto';
import path from 'node:path';
import { LOCAL_AUTH_DIR } from '../paths.js';
import { TEMPOS, LOCAL_AUTH } from '../constants.js';
import { lerLista, gravarRestrito } from './arquivo.js';

const ARQUIVO = path.join(LOCAL_AUTH_DIR, 'pareamentos.json');
// base32 da RFC 4648: 32 símbolos, então byte & 31 é uniforme (256 é múltiplo de 32).
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const SAL_BYTES = 16;

function pareamentosPath() { return ARQUIVO; }

function hashDoCodigo(sal, codigo) {
  return crypto.createHash('sha256').update(`${sal}:${codigo}`).digest('hex');
}

function normalizar(codigo) {
  return String(codigo || '').toUpperCase().replace(/[\s-]/g, '');
}

function gerarCodigo() {
  return [...crypto.randomBytes(LOCAL_AUTH.CODIGO_TAMANHO)].map(b => ALFABETO[b & 31]).join('');
}

function pendentes(lista, agora) {
  return lista.filter(p => p && Number(p.expiraEm) > agora && Number(p.erros) < LOCAL_AUTH.CODIGO_MAX_ERROS);
}

function criarCodigo(agora = Date.now()) {
  const codigo = gerarCodigo();
  const sal = crypto.randomBytes(SAL_BYTES).toString('hex');
  const novo = { sal, hash: hashDoCodigo(sal, codigo), criadoEm: agora, expiraEm: agora + TEMPOS.PAREAMENTO_VALIDADE_MS, erros: 0 };
  gravarRestrito(ARQUIVO, [...pendentes(lerLista(ARQUIVO), agora), novo]);
  return codigo;
}

function confere(registro, codigo) {
  const esperado = Buffer.from(String(registro.hash || ''), 'hex');
  const obtido = Buffer.from(hashDoCodigo(String(registro.sal || ''), codigo), 'hex');
  return esperado.length === obtido.length && crypto.timingSafeEqual(esperado, obtido);
}

// Tentativa errada conta contra TODO código pendente, porque não há como saber qual
// deles quem tenta estava adivinhando. O quinto erro tira o código do arquivo.
//
// A tela precisa distinguir três desfechos (B2, 2.1): errou e ainda pode tentar, errou a
// última vez, e não havia código pendente. O que ela NÃO diz, porque o disco não sabe: se
// o código tentado venceu, se já tinha sido usado ou se nunca existiu. Depois que o
// registro sai do arquivo, os três são o mesmo silêncio.
function registrarErro(lista, agora) {
  if (!lista.length) return { ok: false, code: 'sem_codigo_pendente', restantes: null };
  const contados = lista.map(p => ({ ...p, erros: Number(p.erros) + 1 }));
  const sobraram = pendentes(contados, agora);
  gravarRestrito(ARQUIVO, sobraram);
  const restantes = Math.max(0, ...sobraram.map(p => LOCAL_AUTH.CODIGO_MAX_ERROS - Number(p.erros)));
  return sobraram.length
    ? { ok: false, code: 'codigo_invalido', restantes }
    : { ok: false, code: 'bloqueado', restantes: 0 };
}

// Uso único: o código certo sai do arquivo na mesma gravação que o aceita.
function tentarCodigo(codigo, agora = Date.now()) {
  const alvo = normalizar(codigo);
  const lista = pendentes(lerLista(ARQUIVO), agora);
  if (alvo.length !== LOCAL_AUTH.CODIGO_TAMANHO) return registrarErro(lista, agora);
  const acerto = lista.find(p => confere(p, alvo));
  if (!acerto) return registrarErro(lista, agora);
  gravarRestrito(ARQUIVO, lista.filter(p => p !== acerto));
  return { ok: true, code: '', restantes: null };
}

// Quem só precisa do sim ou não (o comando local, os testes de uso único).
function consumirCodigo(codigo, agora = Date.now()) {
  return tentarCodigo(codigo, agora).ok;
}

function revogarCodigos() { gravarRestrito(ARQUIVO, []); }

export default { pareamentosPath, criarCodigo, consumirCodigo, tentarCodigo, revogarCodigos };
export { pareamentosPath, criarCodigo, consumirCodigo, tentarCodigo, revogarCodigos };
