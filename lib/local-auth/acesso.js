// Porteiro da API local (A4, spec 7.A4 itens 2, 3 e 5). O lib/http-server.js consulta
// estas três funções e nada mais; a regra fica aqui. No modo que exige, todo /api/* pede
// Authorization: Bearer com uma sessão válida, exceto POST /api/auth/pair e GET
// /api/auth/status. Nenhuma resposta daqui emite cookie: o token sai só no corpo do
// pareamento, e a página o guarda em localStorage, que é isolado por origem.
import { sinaisDoModoCelular } from '../paths.js';
import { ATIVACAO_AUTOMATICA_A4, LOCAL_AUTH } from '../constants.js';
import { detectarModoCelular, exigeAutenticacao, compartilhamentoPermitido } from './modo.js';
import { verificarSessao, emitirSessao } from './sessoes.js';
import { consumirCodigo } from './pareamento.js';
import { rotaPublicaDeAutenticacao } from './inventario.js';

const FORMATO_BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;
const RECUSA = Object.freeze({ status: 401, body: Object.freeze({ error: 'nao_autenticado' }) });
const CODIGO_INVALIDO = Object.freeze({ ok: false, code: 'codigo_invalido' });

// O modo é propriedade do processo e não muda enquanto ele vive: lê os sinais uma vez.
let modoCelularMemo = null;
function modoCelular() {
  if (modoCelularMemo === null) modoCelularMemo = detectarModoCelular(sinaisDoModoCelular());
  return modoCelularMemo;
}

function exigida(config) {
  return exigeAutenticacao({ modoCelular: modoCelular(), config, ativacaoAutomatica: ATIVACAO_AUTOMATICA_A4 });
}

function compartilhamentoLiberado(config) {
  return compartilhamentoPermitido({ modoCelular: modoCelular(), config, ativacaoAutomatica: ATIVACAO_AUTOMATICA_A4 });
}

function autenticada(req) {
  const m = FORMATO_BEARER.exec(String(req.headers.authorization || ''));
  return !!m && verificarSessao(m[1]);
}

// Fora do modo que exige, devolve null sem tocar em disco: o desktop segue como hoje.
function recusaSemCredencial(req, rota, config) {
  if (rotaPublicaDeAutenticacao(req.method, rota)) return null;
  if (!exigida(config) || autenticada(req)) return null;
  return RECUSA;
}

function statusAutenticacao(req, config) {
  return { exigida: exigida(config), autenticado: autenticada(req) };
}

function parear(body) {
  const dados = body || {};
  if (!consumirCodigo(String(dados.codigo || ''))) return CODIGO_INVALIDO;
  return { ok: true, token: emitirSessao(String(dados.rotulo || '').slice(0, LOCAL_AUTH.ROTULO_MAX)) };
}

export default { recusaSemCredencial, statusAutenticacao, parear, compartilhamentoLiberado };
export { recusaSemCredencial, statusAutenticacao, parear, compartilhamentoLiberado };
