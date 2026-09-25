// Dublê do Firebase Auth por REST (Identity Toolkit + securetoken), em processo.
// Sem efeito colateral no import: o `node --test` executa test/**/*.js, e um
// arquivo que só exporta funções passa vazio.
//
// Imita o que o cliente consome de verdade: o erro vem como
// { error: { message } }, `expiresIn`/`expires_in` chegam como STRING de segundos,
// e o refresh token pode rotacionar a cada renovação (aqui rotaciona sempre, para o
// teste ver a rotação chegar em quem guarda a credencial).
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { desligarSubidaDeTierDoWasm } from './sem-tier-wasm.js';

// O emulador do Firebase Auth serve as duas APIs com o host de produção como prefixo de
// caminho; o dublê aceita as duas formas, pra servir tanto o teste da folha (que passa
// a URL base à mão) quanto o do engine (que usa o endereço do emulador).
const CAMINHOS_DO_EMULADOR = {
  '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword': '/v1/accounts:signInWithPassword',
  '/securetoken.googleapis.com/v1/token': '/v1/token',
};

function responder(res, status, corpo) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(corpo));
}

function erro(res, message) {
  responder(res, 400, { error: { code: 400, message, errors: [{ message, domain: 'global', reason: 'invalid' }] } });
}

function lerCorpo(req) {
  return new Promise((resolve) => {
    let dados = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { dados += c; });
    req.on('end', () => resolve(dados));
  });
}

export async function startFakeIdentity({ apiKey = 'key-1', users = { 'a@b.com': { password: 'segredo', uid: 'u1' } }, expiresIn = 3600 } = {}) {
  // antes de qualquer fetch contra o dublê: ver test/helpers/sem-tier-wasm.js
  desligarSubidaDeTierDoWasm();
  const requests = [];
  const tokens = { idTokens: [], refreshTokens: [] };
  const donoDoRefresh = new Map();
  const revogados = new Set();

  function emitir(uid) {
    const idToken = 'id-' + randomUUID();
    const refreshToken = 'rt-' + randomUUID();
    tokens.idTokens.push(idToken);
    tokens.refreshTokens.push(refreshToken);
    donoDoRefresh.set(refreshToken, uid);
    return { idToken, refreshToken };
  }

  function signIn(res, corpo) {
    const dados = JSON.parse(corpo || '{}');
    const user = users[dados.email];
    if (!user) return erro(res, 'EMAIL_NOT_FOUND');
    if (user.password !== dados.password) return erro(res, 'INVALID_PASSWORD');
    const t = emitir(user.uid);
    return responder(res, 200, {
      kind: 'identitytoolkit#VerifyPasswordResponse', localId: user.uid, email: dados.email,
      displayName: '', idToken: t.idToken, registered: true, refreshToken: t.refreshToken, expiresIn: String(expiresIn),
    });
  }

  function refresh(res, corpo) {
    const form = new URLSearchParams(corpo || '');
    const atual = form.get('refresh_token') || '';
    if (form.get('grant_type') !== 'refresh_token') return erro(res, 'INVALID_GRANT_TYPE');
    if (revogados.has(atual)) return erro(res, 'TOKEN_EXPIRED');
    const uid = donoDoRefresh.get(atual);
    if (!uid) return erro(res, 'INVALID_REFRESH_TOKEN');
    const t = emitir(uid);
    return responder(res, 200, {
      access_token: t.idToken, expires_in: String(expiresIn), token_type: 'Bearer',
      refresh_token: t.refreshToken, id_token: t.idToken, user_id: uid, project_id: 'farol-local',
    });
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const body = await lerCorpo(req);
    requests.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: req.headers, body });
    if (req.method !== 'POST') return erro(res, 'METHOD_NOT_ALLOWED');
    if (u.searchParams.get('key') !== apiKey) return erro(res, 'API key not valid. Please pass a valid API key.');
    const caminho = CAMINHOS_DO_EMULADOR[u.pathname] || u.pathname;
    if (caminho === '/v1/accounts:signInWithPassword') return signIn(res, body);
    if (caminho === '/v1/token') return refresh(res, body);
    return responder(res, 404, { error: { code: 404, message: 'NOT_FOUND' } });
  });
  // Conexão ociosa nunca é fechada por aqui (25/09/2026). O padrão do Node fecha em 5 s,
  // e o fetch do cliente reaproveita a conexão: sob carga (pre-push com o Farol rodando,
  // duas suítes juntas) o intervalo entre duas chamadas de um teste passa de 5 s, o
  // servidor fecha no instante em que o cliente reusa, e o login ou o unlock voltam
  // 'indisponivel' por um read ECONNRESET. Medido com duas suítes em paralelo: 46 resets
  // numa rodada, contra no máximo 8 depois desta linha. O close() encerra tudo com
  // closeAllConnections, então nenhuma conexão sobra depois do teste.
  server.keepAliveTimeout = 0;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  return {
    url,
    requests,
    tokens,
    revogar(refreshToken) { revogados.add(refreshToken); },
    // troca a senha aceita para um e-mail, como o Firebase faz numa redefinição: a antiga
    // passa a devolver INVALID_PASSWORD. É o que permite exercitar as três situações de
    // recuperação de chave de CT-ENV.
    setPassword(email, senha) { users[email] = { ...(users[email] || {}), password: senha }; },
    close() {
      return new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    },
  };
}

export default { startFakeIdentity };
