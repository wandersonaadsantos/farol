// lib/sync/auth.js: login por e-mail e senha e renovação do ID token no Firebase
// Auth por REST. O dublê é test/helpers/fake-identity.js; os casos que o dublê não
// produz (bloqueio por excesso, rede caída, timeout) entram por fetchImpl injetado.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { SYNC } from '../lib/constants.js';
import auth, { signInWithPassword, refreshIdToken, createTokenSource } from '../lib/sync/auth.js';

const SENHA = 'segredo';
let fake;
let identityUrl;
let tokenUrl;

before(async () => {
  fake = await startFakeIdentity();
  identityUrl = `${fake.url}/v1`;
  tokenUrl = `${fake.url}/v1/token`;
});
after(async () => { await fake.close(); });

const AGORA = 1757500000000;
const agora = () => AGORA;

function entrar(extra = {}) {
  return signInWithPassword({ apiKey: 'key-1', email: 'a@b.com', password: SENHA, identityUrl, agora, ...extra });
}

// fetch falso que devolve uma resposta fixa, para os casos que o dublê não produz
function respostaFixa(status, corpo) {
  return async () => new Response(corpo === undefined ? '' : JSON.stringify(corpo), { status });
}

function semSenha(resultado) {
  assert.doesNotMatch(JSON.stringify(resultado), new RegExp(SENHA), 'a senha nunca volta em resultado de erro');
}

test('signInWithPassword: login certo devolve uid, tokens e o vencimento em ms', async () => {
  const r = await entrar();
  assert.equal(r.ok, true);
  assert.equal(r.uid, 'u1');
  assert.equal(r.email, 'a@b.com');
  assert.ok(fake.tokens.idTokens.includes(r.idToken));
  assert.ok(fake.tokens.refreshTokens.includes(r.refreshToken));
  assert.equal(r.expiresAtMs, AGORA + 3600 * 1000, 'expiresIn chega como string de segundos');
  assert.equal(r.password, undefined);
});

test('signInWithPassword: POST JSON com returnSecureToken e a chave na query', async () => {
  await entrar();
  const req = fake.requests.at(-1);
  assert.equal(req.method, 'POST');
  assert.equal(req.path, '/v1/accounts:signInWithPassword');
  assert.equal(req.query.key, 'key-1');
  assert.match(req.headers['content-type'], /application\/json/);
  assert.deepEqual(JSON.parse(req.body), { email: 'a@b.com', password: SENHA, returnSecureToken: true });
});

test('signInWithPassword: senha errada ou e-mail desconhecido viram credencial_invalida', async () => {
  for (const extra of [{ password: 'errada' }, { email: 'x@y.com' }]) {
    const r = await entrar(extra);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'credencial_invalida');
    assert.equal(typeof r.motivo, 'string');
    semSenha(r);
  }
});

test('signInWithPassword: chave web recusada vira config_invalida', async () => {
  const r = await entrar({ apiKey: 'key-errada' });
  assert.equal(r.code, 'config_invalida');
  semSenha(r);
});

test('signInWithPassword: TOO_MANY_ATTEMPTS vira muitas_tentativas', async () => {
  const fetchImpl = respostaFixa(400, { error: { code: 400, message: 'TOO_MANY_ATTEMPTS_TRY_LATER : Too many unsuccessful login attempts. Please try again later.' } });
  const r = await entrar({ fetchImpl });
  assert.equal(r.code, 'muitas_tentativas');
  semSenha(r);
});

test('signInWithPassword: 5xx sem corpo vira indisponivel; 200 sem os campos vira resposta_invalida', async () => {
  assert.equal((await entrar({ fetchImpl: respostaFixa(503) })).code, 'indisponivel');
  assert.equal((await entrar({ fetchImpl: respostaFixa(200, { idToken: 'x' }) })).code, 'resposta_invalida');
  assert.equal((await entrar({ fetchImpl: respostaFixa(200, [1]) })).code, 'resposta_invalida');
  assert.equal((await entrar({ fetchImpl: respostaFixa(400) })).code, 'resposta_invalida');
});

/* Conta com segundo fator responde 200 e SEM idToken, o que a guarda de forma acima
   pegaria pelo motivo errado: "formato inesperado" manda investigar o Firebase, e o
   corpo está bem formado. Quem não sabe a etapa é o Farol, e a frase tem que dizer isso
   pra pessoa trocar de usuário em vez de caçar defeito no console. */
test('signInWithPassword: 200 com mfaPendingCredential vira segundo_fator, não formato inesperado', async () => {
  const mfa = { mfaPendingCredential: 'pend-1', mfaInfo: [{ mfaEnrollmentId: 'e1', phoneInfo: '+*******1234' }] };
  const r = await entrar({ fetchImpl: respostaFixa(200, mfa) });
  assert.equal(r.code, 'segundo_fator');
  assert.match(r.motivo, /segundo aparelho/);
  semSenha(r);
  // o telefone mascarado e a credencial pendente são da conta de quem entra: nem um nem
  // outro têm o que fazer numa recusa que só precisa dizer o que houve
  assert.doesNotMatch(JSON.stringify(r), /pend-1|1234/);
});

test('signInWithPassword: 200 sem idToken E sem mfaPendingCredential continua resposta_invalida', async () => {
  const r = await entrar({ fetchImpl: respostaFixa(200, { mfaInfo: [{ mfaEnrollmentId: 'e1' }] }) });
  assert.equal(r.code, 'resposta_invalida', 'corpo truncado não é segundo fator: sem a credencial pendente não há etapa a cumprir');
});

test('signInWithPassword: sem chave web ou sem senha nem toca a rede', async () => {
  let chamadas = 0;
  const fetchImpl = async () => { chamadas++; return new Response('{}'); };
  assert.equal((await entrar({ apiKey: '', fetchImpl })).code, 'config_invalida');
  assert.equal((await entrar({ password: '', fetchImpl })).code, 'credencial_invalida');
  assert.equal((await entrar({ email: '', fetchImpl })).code, 'credencial_invalida');
  assert.equal(chamadas, 0);
});

test('signInWithPassword: rede caída vira indisponivel sem vazar a senha', async () => {
  const fetchImpl = async () => { throw new TypeError('fetch failed'); };
  const r = await entrar({ fetchImpl });
  assert.deepEqual(Object.keys(r).sort(), ['code', 'motivo', 'ok']);
  assert.equal(r.code, 'indisponivel');
  semSenha(r);
});

test('signInWithPassword: sem resposta no teto de tempo vira timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetchImpl = (_url, opts) => new Promise((_resolve, reject) => {
    opts.signal.addEventListener('abort', () => {
      const e = new Error('This operation was aborted');
      e.name = 'AbortError';
      reject(e);
    });
  });
  const pendente = entrar({ fetchImpl });
  t.mock.timers.tick(SYNC.REQUEST_TIMEOUT_MS);
  const r = await pendente;
  assert.equal(r.code, 'timeout');
  semSenha(r);
});

test('refreshIdToken: POST form-urlencoded com o refresh token codificado', async () => {
  const login = await entrar();
  const r = await refreshIdToken({ apiKey: 'key-1', refreshToken: login.refreshToken, tokenUrl, agora });
  assert.equal(r.ok, true);
  assert.equal(r.uid, 'u1');
  assert.ok(fake.tokens.idTokens.includes(r.idToken));
  assert.equal(r.expiresAtMs, AGORA + 3600 * 1000);
  const req = fake.requests.at(-1);
  assert.equal(req.path, '/v1/token');
  assert.equal(req.query.key, 'key-1');
  assert.match(req.headers['content-type'], /application\/x-www-form-urlencoded/);
  assert.equal(req.body, `grant_type=refresh_token&refresh_token=${encodeURIComponent(login.refreshToken)}`);
});

test('refreshIdToken: refresh token revogado ou desconhecido vira credencial_invalida', async () => {
  const login = await entrar();
  fake.revogar(login.refreshToken);
  const r = await refreshIdToken({ apiKey: 'key-1', refreshToken: login.refreshToken, tokenUrl, agora });
  assert.equal(r.code, 'credencial_invalida');
  const r2 = await refreshIdToken({ apiKey: 'key-1', refreshToken: 'rt-inventado', tokenUrl, agora });
  assert.equal(r2.code, 'credencial_invalida');
});

test('refreshIdToken: rede caída vira indisponivel', async () => {
  const r = await refreshIdToken({ apiKey: 'key-1', refreshToken: 'x', tokenUrl, agora, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.equal(r.code, 'indisponivel');
});

test('createTokenSource: usa o cache até a margem de renovação', async () => {
  const login = await entrar();
  let relogio = AGORA;
  const fonte = createTokenSource({ apiKey: 'key-1', refreshToken: login.refreshToken, tokenUrl, agora: () => relogio });
  const antes = fake.requests.length;
  const a = await fonte.getIdToken();
  assert.equal(a.ok, true);
  assert.equal(fake.requests.length, antes + 1, 'a primeira chamada renova');
  relogio = AGORA + 3600 * 1000 - SYNC.TOKEN_MARGIN_MS - 1;
  const b = await fonte.getIdToken();
  assert.equal(b.idToken, a.idToken, 'dentro da margem é o mesmo token, sem rede');
  assert.equal(fake.requests.length, antes + 1);
  relogio = AGORA + 3600 * 1000 - SYNC.TOKEN_MARGIN_MS;
  const c = await fonte.getIdToken();
  assert.notEqual(c.idToken, a.idToken, 'na margem renova');
  assert.equal(fake.requests.length, antes + 2);
});

// A senha conferida de novo (admin, limpeza, revogação, chave nova) entrega uma entrada
// inteira: o token novo vale na hora, sem rede, e a renovação seguinte usa o refresh
// token DELA. Guardar só o token e seguir com o refresh antigo faria o aparelho voltar,
// no vencimento, para uma credencial que o servidor pode já ter rotacionado.
test('createTokenSource: adotar a entrada nova vale na hora e manda na renovação', async () => {
  const login = await entrar();
  let relogio = AGORA;
  const fonte = createTokenSource({ apiKey: 'key-1', refreshToken: login.refreshToken, tokenUrl, agora: () => relogio });
  assert.equal((await fonte.getIdToken()).ok, true);
  const nova = await entrar();
  const antes = fake.requests.length;
  assert.equal(fonte.adotar(nova), true);
  const agoraToken = await fonte.getIdToken();
  assert.equal(agoraToken.idToken, nova.idToken, 'o token da senha recém-conferida vale na hora');
  assert.equal(fake.requests.length, antes, 'sem rede: a entrada já veio pronta');
  relogio = nova.expiresAtMs;
  assert.equal((await fonte.getIdToken()).ok, true);
  const renovacao = fake.requests[fake.requests.length - 1];
  assert.equal(new URLSearchParams(renovacao.body || '').get('refresh_token'), nova.refreshToken);
});

// quem toma 401 do banco precisa saber se o token era velho (renovar) ou recém-obtido
// (regra recusando): é este relógio que separa os dois casos
test('createTokenSource: obtidoHa conta do último token obtido', async () => {
  const login = await entrar();
  let relogio = AGORA;
  const fonte = createTokenSource({ apiKey: 'key-1', refreshToken: login.refreshToken, tokenUrl, agora: () => relogio });
  assert.equal(fonte.obtidoHa(), Infinity, 'sem token nenhum, não há o que datar');
  assert.equal((await fonte.getIdToken()).ok, true);
  assert.equal(fonte.obtidoHa(), 0);
  relogio = AGORA + 5000;
  assert.equal(fonte.obtidoHa(), 5000);
  assert.equal(fonte.adotar(await entrar()), true);
  assert.equal(fonte.obtidoHa(), 0, 'a entrada adotada também é token novo');
});

test('createTokenSource: entrada incompleta não é adotada', async () => {
  const login = await entrar();
  const fonte = createTokenSource({ apiKey: 'key-1', refreshToken: login.refreshToken, tokenUrl, agora });
  assert.equal(fonte.adotar(null), false);
  assert.equal(fonte.adotar({ idToken: 'so-o-token' }), false);
  assert.equal((await fonte.getIdToken()).ok, true, 'a fonte continua servindo pelo refresh de antes');
});

test('createTokenSource: chamadas concorrentes fazem UMA renovação', async () => {
  const login = await entrar();
  const fonte = createTokenSource({ apiKey: 'key-1', refreshToken: login.refreshToken, tokenUrl, agora });
  const antes = fake.requests.length;
  const todos = await Promise.all([1, 2, 3, 4, 5].map(() => fonte.getIdToken()));
  assert.equal(fake.requests.length, antes + 1);
  assert.equal(new Set(todos.map((x) => x.idToken)).size, 1);
});

test('createTokenSource: a rotação do refresh token chega no onRefresh e é usada na próxima', async () => {
  const login = await entrar();
  const rotacoes = [];
  const fonte = createTokenSource({ apiKey: 'key-1', refreshToken: login.refreshToken, tokenUrl, agora, onRefresh: (x) => rotacoes.push(x) });
  await fonte.getIdToken();
  assert.equal(rotacoes.length, 1);
  assert.notEqual(rotacoes[0].refreshToken, login.refreshToken);
  // o uid viaja junto: quem persiste precisa saber de QUAL conta é este token, porque a
  // rotação é assíncrona e pode chegar depois de a pessoa trocar de conta
  assert.deepEqual(Object.keys(rotacoes[0]).sort(), ['refreshToken', 'uid']);
  assert.equal(rotacoes[0].uid, login.uid, 'o uid é o da conta que rotacionou');
  fonte.invalidate();
  await fonte.getIdToken();
  const req = fake.requests.at(-1);
  assert.equal(new URLSearchParams(req.body).get('refresh_token'), rotacoes[0].refreshToken, 'renova com o token rotacionado');
  assert.equal(rotacoes.length, 2);
});

test('createTokenSource: invalidate força renovação; falha devolve o código sem cachear', async () => {
  const login = await entrar();
  const fonte = createTokenSource({ apiKey: 'key-1', refreshToken: login.refreshToken, tokenUrl, agora });
  const a = await fonte.getIdToken();
  fonte.invalidate();
  const b = await fonte.getIdToken();
  assert.notEqual(b.idToken, a.idToken);
  fake.revogar(fake.tokens.refreshTokens.at(-1));
  fonte.invalidate();
  const c = await fonte.getIdToken();
  assert.deepEqual(c, { ok: false, code: 'credencial_invalida', motivo: c.motivo });
  const d = await fonte.getIdToken();
  assert.equal(d.ok, false, 'falha não vira token em cache');
});

test('createTokenSource: onRefresh que lança não derruba a renovação', async () => {
  const login = await entrar();
  const fonte = createTokenSource({ apiKey: 'key-1', refreshToken: login.refreshToken, tokenUrl, agora, onRefresh: () => { throw new Error('disco cheio'); } });
  const r = await fonte.getIdToken();
  assert.equal(r.ok, true);
});

test('export default carrega o mesmo contrato dos nomeados', () => {
  assert.equal(auth.signInWithPassword, signInWithPassword);
  assert.equal(auth.refreshIdToken, refreshIdToken);
  assert.equal(auth.createTokenSource, createTokenSource);
});
