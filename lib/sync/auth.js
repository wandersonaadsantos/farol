// Login e renovação de token no Firebase Auth por REST (Identity Toolkit e
// securetoken). E-mail e senha porque é o único fluxo headless que funciona igual no
// Electron e no Termux/proot, sem navegador nem registro de app OAuth.
//
// A senha entra só no corpo do POST de login e nunca volta em resultado nenhum: todo
// erro sai como { ok:false, code, motivo } com o motivo da tabela de errors.js, e
// não com a mensagem crua do fornecedor.
//
// fetch entra por injeção para o teste não tocar a rede.
import { SYNC } from '../constants.js';
import io from '../io.js';
import { SYNC_CODES, codeFromStatus, codeFromIdentityMessage, motivoDe } from './errors.js';

// cabeçalhos fora da chamada: objeto literal aninhado conta como nível de chave no gate
const CABECALHO_JSON = { 'Content-Type': 'application/json' };
const CABECALHO_FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };

function falha(code) {
  return { ok: false, code, motivo: motivoDe(code) };
}

// AbortError é o nosso alarme de tempo disparando; qualquer outra rejeição do fetch
// (DNS, conexão recusada, TLS) é rede.
function codigoDeRede(err) {
  return err && err.name === 'AbortError' ? SYNC_CODES.TIMEOUT : SYNC_CODES.INDISPONIVEL;
}

// O alarme cobre o corpo também: um servidor que manda o cabeçalho e trava no corpo
// seguraria o login para sempre se o timeout parasse no primeiro byte.
async function postar(fetchImpl, url, headers, body) {
  const controle = new AbortController();
  const alarme = setTimeout(() => controle.abort(), SYNC.REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { method: 'POST', headers, body, signal: controle.signal });
    const texto = await res.text();
    return { status: res.status, ok: res.ok, corpo: io.parseJson(texto, null) };
  } catch (err) {
    return { erro: codigoDeRede(err) };
  } finally {
    clearTimeout(alarme);
  }
}

// 5xx é sempre indisponibilidade (transitória), mesmo com mensagem no corpo; abaixo
// disso o código do Identity Toolkit é o que diz se foi credencial, excesso ou chave.
function codigoDoErro(resp) {
  if (resp.status >= 500) return codeFromStatus(resp.status);
  const erro = resp.corpo && typeof resp.corpo === 'object' ? resp.corpo.error : null;
  if (erro && typeof erro.message === 'string') return codeFromIdentityMessage(erro.message);
  return codeFromStatus(resp.status);
}

function objeto(corpo) {
  return corpo && typeof corpo === 'object' && !Array.isArray(corpo) ? corpo : null;
}

function naoVazio(v) {
  return typeof v === 'string' && v.length > 0;
}

// expiresIn/expires_in chegam como STRING de segundos; número inválido não vira
// token eterno, vira resposta inválida.
function vencimento(agora, segundos) {
  const s = Number(segundos);
  return Number.isFinite(s) && s > 0 ? agora() + s * 1000 : 0;
}

async function signInWithPassword({ apiKey, email, password, fetchImpl = fetch, identityUrl = SYNC.IDENTITY_TOOLKIT_URL, agora = Date.now }) {
  if (!naoVazio(apiKey)) return falha(SYNC_CODES.CONFIG_INVALIDA);
  if (!naoVazio(email) || !naoVazio(password)) return falha(SYNC_CODES.CREDENCIAL_INVALIDA);
  const url = `${identityUrl}/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`;
  const corpo = io.safeStringify({ email, password, returnSecureToken: true });
  const resp = await postar(fetchImpl, url, CABECALHO_JSON, corpo);
  if (resp.erro) return falha(resp.erro);
  if (!resp.ok) return falha(codigoDoErro(resp));
  const d = objeto(resp.corpo);
  // Conta com segundo fator responde 200 e SEM idToken: em vez da sessão vem o
  // `mfaPendingCredential`, que só vira token depois de um `mfaSignIn:finalize` com o
  // código que chega no outro aparelho. A guarda de forma logo abaixo pegaria isso, mas
  // pelo motivo errado: diria "formato inesperado" e mandaria investigar o Firebase,
  // quando o corpo está perfeitamente bem formado e quem não sabe a etapa é o Farol. O
  // login headless daqui é e-mail e senha por REST, sem tela pra digitar código.
  if (d && naoVazio(d.mfaPendingCredential)) return falha(SYNC_CODES.SEGUNDO_FATOR);
  const expiresAtMs = d ? vencimento(agora, d.expiresIn) : 0;
  if (!d || !naoVazio(d.idToken) || !naoVazio(d.refreshToken) || !naoVazio(d.localId) || !expiresAtMs) {
    return falha(SYNC_CODES.RESPOSTA_INVALIDA);
  }
  return { ok: true, uid: d.localId, email: naoVazio(d.email) ? d.email : email, idToken: d.idToken, refreshToken: d.refreshToken, expiresAtMs };
}

async function refreshIdToken({ apiKey, refreshToken, fetchImpl = fetch, tokenUrl = SYNC.SECURE_TOKEN_URL, agora = Date.now }) {
  if (!naoVazio(apiKey)) return falha(SYNC_CODES.CONFIG_INVALIDA);
  if (!naoVazio(refreshToken)) return falha(SYNC_CODES.SEM_CREDENCIAL);
  const url = `${tokenUrl}?key=${encodeURIComponent(apiKey)}`;
  const corpo = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`;
  const resp = await postar(fetchImpl, url, CABECALHO_FORM, corpo);
  if (resp.erro) return falha(resp.erro);
  if (!resp.ok) return falha(codigoDoErro(resp));
  const d = objeto(resp.corpo);
  const expiresAtMs = d ? vencimento(agora, d.expires_in) : 0;
  if (!d || !naoVazio(d.id_token) || !naoVazio(d.user_id) || !expiresAtMs) return falha(SYNC_CODES.RESPOSTA_INVALIDA);
  // resposta sem refresh_token mantém o que já funcionava: não há rotação a registrar
  const novo = naoVazio(d.refresh_token) ? d.refresh_token : refreshToken;
  return { ok: true, uid: d.user_id, idToken: d.id_token, refreshToken: novo, expiresAtMs };
}

// Fonte de ID token com cache. Renova MARGEM antes de vencer (a chamada que usa o
// token ainda leva até REQUEST_TIMEOUT_MS para chegar ao banco) e faz UMA renovação
// por vez: o heartbeat do lease, o tick de presença e a outbox pedem token no mesmo
// ciclo, e três renovações em paralelo só gastariam cota do securetoken.
function createTokenSource({ apiKey, refreshToken, fetchImpl, tokenUrl, agora = Date.now, onRefresh }) {
  let atual = refreshToken;
  let cache = null;
  let emVoo = null;

  // o uid vai junto porque quem guarda precisa saber de QUAL conta é este token: a
  // rotação é assíncrona e pode chegar depois de a pessoa trocar de conta
  function avisarRotacao(novo, uid) {
    if (!onRefresh) return;
    // guardar a rotação é problema de quem guarda; o token novo já vale nesta fonte
    // quem persiste decide o que fazer com a falha (e registra); aqui só garantimos que
    // uma exceção de quem guarda não derrube a renovação, que já deu certo
    try { onRefresh({ refreshToken: novo, uid }); } catch { /* já registrado por quem guarda */ }
  }

  async function renovar() {
    const r = await refreshIdToken({ apiKey, refreshToken: atual, fetchImpl, tokenUrl, agora });
    if (!r.ok) {
      cache = null;
      return falha(r.code);
    }
    if (r.refreshToken !== atual) {
      atual = r.refreshToken;
      avisarRotacao(atual, r.uid);
    }
    cache = { idToken: r.idToken, expiresAtMs: r.expiresAtMs };
    return { ok: true, idToken: r.idToken };
  }

  function getIdToken() {
    if (cache && agora() < cache.expiresAtMs - SYNC.TOKEN_MARGIN_MS) return Promise.resolve({ ok: true, idToken: cache.idToken });
    if (!emVoo) emVoo = renovar().finally(() => { emVoo = null; });
    return emVoo;
  }

  function invalidate() { cache = null; }

  return { getIdToken, invalidate };
}

export default { signInWithPassword, refreshIdToken, createTokenSource };
export { signInWithPassword, refreshIdToken, createTokenSource };
