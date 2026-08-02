'use strict';
// Smoke da camada HTTP (lib/http-server.js): sobe o servidor com uma Engine real contra
// um FAROL_HOME temporário (sem polling, sem gh) e confere que /api/state e a UI estática
// respondem. Protege a extração do http server. Runner nativo, ZERO deps.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const HOME = path.join(os.tmpdir(), 'farol-test-http-' + process.pid);
process.env.FAROL_HOME = HOME;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../server.js');
const { startServer } = require('../lib/http-server');

let server, base;

before(async () => {
  const engine = new Engine();
  engine.config.port = 0; // porta efêmera: evita conflito com o Farol real ou outro teste
  await new Promise((resolve, reject) => {
    server = startServer(engine, (url, err) => (err ? reject(err) : resolve()));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  try { server && server.close(); } catch { /* ok */ }
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function get(pathname) {
  return new Promise((resolve, reject) => {
    http.get(base + pathname, res => {
      let d = ''; res.on('data', c => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body: d }));
    }).on('error', reject);
  });
}

function post(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request(base + pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-farol': '1', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let d = ''; res.on('data', c => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

test('GET /api/state devolve o snapshot serializável', async () => {
  const r = await get('/api/state');
  assert.equal(r.status, 200);
  const snap = JSON.parse(r.body);
  assert.equal(typeof snap, 'object');
  assert.ok(snap.decisions, 'snapshot traz decisions');
  assert.ok(Array.isArray(snap.decisions.resolved), 'resolved é array');
  assert.ok(snap.decisions.resolved.length <= 30, 'payload do SSE respeita o cap de 30 (Revisões recentes)');
});

test('GET / serve a UI estática (index.html)', async () => {
  const r = await get('/');
  assert.equal(r.status, 200);
  assert.match(r.type, /text\/html/);
});

test('GET numa rota /api desconhecida devolve 405 (só POST é aceito além das GET conhecidas)', async () => {
  const r = await get('/api/nao-existe');
  assert.equal(r.status, 405);
  assert.deepEqual(JSON.parse(r.body), { error: 'method' });
});

test('POST /api/self-review/cancel existe e responde JSON (key desconhecida = ok:false)', async () => {
  const r = await post('/api/self-review/cancel', { key: 'acme/app#404' });
  assert.equal(r.status, 200, 'a rota existe (antes caía no 404 not found)');
  assert.equal(JSON.parse(r.body).ok, false);
});

test('POST /api/review sem urls é recusado com 400 (o fallback "fila inteira" morreu)', async () => {
  // achado B22: a UI mandava {} quando a fila visível esvaziava entre o render e o
  // clique, e o servidor interpretava ausência de urls como "revise TUDO", inclusive
  // PRs de outras contas que o escopo escondia
  const r = await post('/api/review', {});
  assert.equal(r.status, 400);
  assert.match(JSON.parse(r.body).error, /urls/);
});

test('POST /api/review com urls vazio ou de tipo errado também é recusado', async () => {
  assert.equal((await post('/api/review', { urls: [] })).status, 400);
  assert.equal((await post('/api/review', { urls: 'https://github.com/a/b/pull/1' })).status, 400);
});
