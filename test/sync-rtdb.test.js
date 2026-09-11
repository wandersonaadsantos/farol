// lib/sync/rtdb.js: o cliente REST do Firebase Realtime Database. O dublê é
// test/helpers/fake-rtdb.js (servidor HTTP em processo); os casos que ele não
// produz (rede caída, timeout, host https) entram por fetchImpl injetado.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import rtdb, { createRtdbClient, redactUrl } from '../lib/sync/rtdb.js';

const TOKEN = 'tok-ok';
let fake;

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => { await fake.close(); });
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; fake.setNow(1000); });

const tokenOk = async () => ({ ok: true, idToken: TOKEN });

function cliente(extra = {}) {
  return createRtdbClient({ databaseUrl: fake.url, getIdToken: tokenOk, ...extra });
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function ate(cond, limite = 2000) {
  const inicio = Date.now();
  while (!cond()) {
    if (Date.now() - inicio > limite) throw new Error('condição não chegou a tempo');
    await esperar(10);
  }
}

test('get de caminho vazio devolve null; put grava e devolve o valor gravado', async () => {
  const c = cliente();
  const vazio = await c.get('/users/u1/devices/d1');
  assert.deepEqual(vazio, { ok: true, status: 200, data: null, etag: '' });
  const p = await c.put('/users/u1/devices/d1', { name: 'Notebook' });
  assert.equal(p.ok, true);
  assert.equal(p.status, 200);
  assert.deepEqual(p.data, { name: 'Notebook' });
  assert.deepEqual((await c.get('/users/u1/devices/d1')).data, { name: 'Notebook' });
  assert.deepEqual(fake.tree(), { users: { u1: { devices: { d1: { name: 'Notebook' } } } } });
});

test('a URL leva .json e o ID token em ?auth=', async () => {
  await cliente().get('/users/u1/devices');
  const req = fake.requests.at(-1);
  assert.equal(req.path, '/users/u1/devices.json');
  assert.equal(req.query.auth, TOKEN);
});

test('patch mescla filhos e nunca manda if-match', async () => {
  const c = cliente();
  await c.put('/users/u1/devices/d1', { name: 'A', platform: 'win32' });
  const r = await c.patch('/users/u1/devices/d1', { name: 'B' });
  assert.deepEqual(r, { ok: true, status: 200, data: { name: 'B', platform: 'win32' } });
  const req = fake.requests.at(-1);
  assert.equal(req.method, 'PATCH');
  assert.equal(req.headers['if-match'], undefined);
});

test('del apaga e devolve ok', async () => {
  const c = cliente();
  await c.put('/users/u1/x', { a: 1 });
  assert.deepEqual(await c.del('/users/u1/x'), { ok: true, status: 200 });
  assert.equal(fake.tree(), null);
});

test('ETag: pedido na leitura, null_etag para vazio, e if-match no put', async () => {
  const c = cliente();
  const vazio = await c.get('/users/u1/leases/a/p', { etag: true });
  assert.equal(vazio.etag, 'null_etag');
  assert.equal(fake.requests.at(-1).headers['x-firebase-etag'], 'true');
  const p = await c.put('/users/u1/leases/a/p', { leaseId: 'L1' }, { ifMatch: 'null_etag', etag: true });
  assert.equal(p.ok, true);
  assert.match(p.etag, /^[0-9a-f]{40}$/);
  assert.equal(fake.requests.at(-1).headers['if-match'], 'null_etag');
  const lido = await c.get('/users/u1/leases/a/p', { etag: true });
  assert.equal(lido.etag, p.etag, 'o etag devolvido no put é o do valor gravado');
  const ok = await c.put('/users/u1/leases/a/p', { leaseId: 'L2' }, { ifMatch: lido.etag });
  assert.equal(ok.ok, true);
});

test('ETag: 412 devolve o valor ATUAL e o etag atual para quem perdeu a corrida', async () => {
  const c = cliente();
  await c.put('/users/u1/leases/a/p', { leaseId: 'L1' });
  const r = await c.put('/users/u1/leases/a/p', { leaseId: 'L2' }, { ifMatch: 'null_etag' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'conflito');
  assert.equal(r.status, 412);
  assert.deepEqual(r.data, { leaseId: 'L1' });
  assert.equal(r.etag, (await c.get('/users/u1/leases/a/p', { etag: true })).etag);
  assert.deepEqual(fake.tree().users.u1.leases.a.p, { leaseId: 'L1' }, 'nada foi sobrescrito');
});

test('del com if-match: etag velho é 412 com o atual, etag certo apaga', async () => {
  const c = cliente();
  await c.put('/users/u1/r', { v: 1 });
  const velho = (await c.get('/users/u1/r', { etag: true })).etag;
  await c.put('/users/u1/r', { v: 2 });
  const r = await c.del('/users/u1/r', { ifMatch: velho });
  assert.equal(r.code, 'conflito');
  assert.equal(r.status, 412);
  assert.deepEqual(r.data, { v: 2 });
  const atual = (await c.get('/users/u1/r', { etag: true })).etag;
  assert.deepEqual(await c.del('/users/u1/r', { ifMatch: atual }), { ok: true, status: 200 });
});

test('{".sv":"timestamp"} vira o relógio do servidor', async () => {
  fake.setNow(1757500000000);
  const r = await cliente().patch('/users/u1/devices/d1', { lastSeenAt: { '.sv': 'timestamp' } });
  assert.equal(r.data.lastSeenAt, 1757500000000);
});

test('shallow devolve só as chaves do nível', async () => {
  const c = cliente();
  await c.put('/users/u1/devices', { d1: { name: 'A' }, d2: { name: 'B' } });
  const r = await c.get('/users/u1/devices', { shallow: true });
  assert.deepEqual(r.data, { d1: true, d2: true });
  assert.equal(fake.requests.at(-1).query.shallow, 'true');
});

test('?ns=<projectId> só vai com http (emulador) e projectId preenchido', async () => {
  await cliente({ projectId: 'farol-local' }).get('/users/u1');
  assert.equal(fake.requests.at(-1).query.ns, 'farol-local');
  await cliente().get('/users/u1');
  assert.equal(fake.requests.at(-1).query.ns, undefined);
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return new Response('null', { status: 200 }); };
  const https = createRtdbClient({ databaseUrl: 'https://x-default-rtdb.firebaseio.com', projectId: 'x', getIdToken: tokenOk, fetchImpl });
  await https.get('/users/u1');
  assert.doesNotMatch(urls[0], /[?&]ns=/);
  assert.equal(urls[0], 'https://x-default-rtdb.firebaseio.com/users/u1.json?auth=tok-ok');
});

test('urlFor: auth primeiro, ns do emulador e demais parâmetros depois', () => {
  const c = cliente({ projectId: 'farol-local' });
  assert.equal(c.urlFor('/users/u1', { auth: 'T', shallow: 'true' }), `${fake.url}/users/u1.json?auth=T&ns=farol-local&shallow=true`);
  assert.equal(cliente().urlFor('/users/u1'), `${fake.url}/users/u1.json`);
});

test('token recusado pelo banco vira nao_autorizado com o motivo do servidor', async () => {
  const c = cliente({ getIdToken: async () => ({ ok: true, idToken: 'tok-vencido' }) });
  const r = await c.get('/users/u1');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'nao_autorizado');
  assert.equal(r.status, 401);
  assert.equal(r.motivo, 'Permission denied');
});

test('falha do getIdToken é devolvida sem tocar a rede', async () => {
  const c = cliente({ getIdToken: async () => ({ ok: false, code: 'credencial_invalida', motivo: 'entre de novo' }) });
  for (const r of [await c.get('/users/u1'), await c.put('/users/u1', 1), await c.patch('/users/u1', { a: 1 }), await c.del('/users/u1')]) {
    assert.equal(r.ok, false);
    assert.equal(r.code, 'credencial_invalida');
  }
  assert.equal(fake.requests.length, 0);
});

test('segmento de caminho inválido é falha interna e não toca a rede', async () => {
  const c = cliente();
  for (const caminho of ['/users/u.1', '/users/$x', '/users//x', 'users/u1', '/users/a#b']) {
    const r = await c.get(caminho);
    assert.equal(r.code, 'falha_interna', caminho);
  }
  assert.throws(() => c.urlFor('/users/a[b'), (e) => e.code === 'falha_interna');
  assert.equal(fake.requests.length, 0);
});

test('valor não serializável não vira null gravado no banco', async () => {
  const circular = {};
  circular.eu = circular;
  const r = await cliente().put('/users/u1/x', circular);
  assert.equal(r.code, 'falha_interna');
  assert.equal(fake.requests.length, 0);
});

test('rede caída vira indisponivel e a mensagem não carrega o token', async () => {
  const fetchImpl = async (url) => { throw new TypeError(`fetch failed: connect ECONNREFUSED ${url}`); };
  const c = createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: 'segredo-do-token' }), fetchImpl });
  const r = await c.get('/users/u1');
  assert.equal(r.code, 'indisponivel');
  assert.doesNotMatch(JSON.stringify(r), /segredo-do-token/);
});

test('sem resposta no teto de tempo vira timeout', async () => {
  const fetchImpl = (_url, opts) => new Promise((_resolve, reject) => {
    opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
  });
  const c = createRtdbClient({ databaseUrl: fake.url, getIdToken: tokenOk, fetchImpl, timeoutMs: 20 });
  assert.equal((await c.get('/users/u1')).code, 'timeout');
});

test('5xx vira indisponivel e corpo que não é JSON vira resposta_invalida', async () => {
  const c503 = createRtdbClient({ databaseUrl: fake.url, getIdToken: tokenOk, fetchImpl: async () => new Response('', { status: 503 }) });
  assert.equal((await c503.get('/users/u1')).code, 'indisponivel');
  const lixo = createRtdbClient({ databaseUrl: fake.url, getIdToken: tokenOk, fetchImpl: async () => new Response('<html>', { status: 200 }) });
  assert.equal((await lixo.get('/users/u1')).code, 'resposta_invalida');
});

// Sem o ETag pedido não existe CAS: a escrita seguinte sairia INCONDICIONAL, e
// sobrescrever lease, recibo ou rodada às cegas é o defeito que o if-match existe
// para impedir. Recusar a leitura é a única saída segura.
test('get: ETag pedido e ausente na resposta vira resposta_invalida', async () => {
  const c = cliente();
  await c.put('/users/u1/x', { a: 1 });
  fake.setSemEtag(true);
  try {
    const r = await c.get('/users/u1/x', { etag: true });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'resposta_invalida');
    assert.match(r.motivo, /ETag/);
    const semPedir = await c.get('/users/u1/x');
    assert.deepEqual(semPedir.data, { a: 1 }, 'leitura que não pede etag segue valendo');
  } finally {
    fake.setSemEtag(false);
  }
});

test('redactUrl esconde o valor de auth= e preserva o resto', () => {
  assert.equal(redactUrl('https://x.firebaseio.com/a.json?auth=abc.def-ghi&shallow=true'), 'https://x.firebaseio.com/a.json?auth=***&shallow=true');
  assert.equal(redactUrl('http://127.0.0.1:9000/a.json?ns=p&auth=zzz'), 'http://127.0.0.1:9000/a.json?ns=p&auth=***');
  assert.equal(redactUrl('https://x/a.json'), 'https://x/a.json');
});

/* ---------- stream (SSE) ---------- */

test('stream: put inicial, put incremental, keep-alive engolido, e fecha pelo signal', async () => {
  const c = cliente();
  await c.put('/users/u1/leases', { a: { p: { leaseId: 'L1' } } });
  const eventos = [];
  const controle = new AbortController();
  const fim = c.stream('/users/u1/leases', { onEvent: (e) => eventos.push(e), signal: controle.signal });
  await ate(() => eventos.length >= 1);
  assert.deepEqual(eventos[0], { event: 'put', data: { path: '/', data: { a: { p: { leaseId: 'L1' } } } } });
  assert.equal(fake.requests.at(-1).headers.accept, 'text/event-stream');
  await c.put('/users/u1/leases/a/p', { leaseId: 'L2' });
  await ate(() => eventos.length >= 2);
  assert.deepEqual(eventos[1], { event: 'put', data: { path: '/a/p', data: { leaseId: 'L2' } } });
  await esperar(250);
  assert.ok(eventos.every((e) => e.event !== 'keep-alive'), 'keep-alive não chega ao consumidor');
  assert.equal(fake.streams, 1);
  controle.abort();
  assert.deepEqual(await fim, { ok: true });
  await ate(() => fake.streams === 0);
});

test('stream: auth_revoked chega ao consumidor e a conexão fecha', async () => {
  const c = cliente();
  const eventos = [];
  const fim = c.stream('/users/u1', { onEvent: (e) => eventos.push(e) });
  await ate(() => eventos.length >= 1);
  fake.emitirAuthRevoked();
  assert.deepEqual(await fim, { ok: true });
  assert.equal(eventos.at(-1).event, 'auth_revoked');
});

test('stream: token recusado devolve nao_autorizado sem abrir stream', async () => {
  const c = cliente({ getIdToken: async () => ({ ok: true, idToken: 'tok-vencido' }) });
  const r = await c.stream('/users/u1', { onEvent: () => {} });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'nao_autorizado');
  assert.equal(fake.streams, 0);
});

test('stream: fechamento pelo servidor resolve ok', async () => {
  const c = cliente();
  const eventos = [];
  const fim = c.stream('/users/u1', { onEvent: (e) => eventos.push(e) });
  await ate(() => eventos.length >= 1);
  fake.fecharStreams();
  assert.deepEqual(await fim, { ok: true });
});

test('stream: consumidor que lança não derruba a leitura', async () => {
  const c = cliente();
  let vistos = 0;
  const controle = new AbortController();
  const fim = c.stream('/users/u1', { onEvent: () => { vistos++; throw new Error('bug do consumidor'); }, signal: controle.signal });
  await ate(() => vistos >= 1);
  await c.put('/users/u1/x', 1);
  await ate(() => vistos >= 2);
  controle.abort();
  assert.deepEqual(await fim, { ok: true });
});

// O keep-alive não chega ao onEvent, e é justamente ele que prova que a conexão vive:
// a vigia de inatividade do stream dos leases depende deste aviso por pedaço.
test('stream: onActivity avisa a cada pedaço que chega, keep-alive incluso, e defeito nele não derruba', async () => {
  const c = cliente();
  let pedacos = 0;
  const eventos = [];
  const controle = new AbortController();
  const onActivity = () => { pedacos++; throw new Error('bug do consumidor'); };
  const fim = c.stream('/users/u1', { onEvent: (e) => eventos.push(e), onActivity, signal: controle.signal });
  await ate(() => eventos.length >= 1);
  await esperar(350);
  assert.equal(eventos.length, 1, 'só o put inicial chega ao onEvent');
  assert.ok(pedacos >= 3, `keep-alives contam como atividade (vistos: ${pedacos})`);
  controle.abort();
  assert.deepEqual(await fim, { ok: true });
});

// Corpo SSE servido por fetchImpl: o servidor manda estes bytes e fecha LIMPO.
function clienteComCorpoSse(texto) {
  const fetchImpl = async () => new Response(texto, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  return createRtdbClient({ databaseUrl: fake.url, getIdToken: tokenOk, fetchImpl });
}

test('stream: conexão que fecha no meio de um evento descarta o evento incompleto (WHATWG)', async () => {
  const completo = 'event: put\ndata: {"path":"/","data":{"a":1}}\n\n';
  const cortado = 'event: put\ndata: {"path":"/","data":{"lea';
  const eventos = [];
  const r = await clienteComCorpoSse(completo + cortado).stream('/users/u1', { onEvent: (e) => eventos.push(e) });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(eventos, [{ event: 'put', data: { path: '/', data: { a: 1 } } }], 'só o evento completo chega');
  assert.ok(eventos.every((e) => e.data !== null), 'nenhum put com data null, que o consumidor leria como nó apagado');
});

test('stream: put ou patch com JSON ilegível não chega como null', async () => {
  const corpo = 'event: put\ndata: {quebrado\n\nevent: patch\ndata: nada\n\nevent: put\ndata: {"path":"/x","data":null}\n\n';
  const eventos = [];
  const r = await clienteComCorpoSse(corpo).stream('/users/u1', { onEvent: (e) => eventos.push(e) });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(eventos, [{ event: 'put', data: { path: '/x', data: null } }], 'o null legítimo do banco segue passando');
});

test('export default carrega o mesmo contrato dos nomeados', () => {
  assert.equal(rtdb.createRtdbClient, createRtdbClient);
  assert.equal(rtdb.redactUrl, redactUrl);
});
