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
const { LOG_FILE } = require('../lib/paths');

let server, base, engine;

before(async () => {
  engine = new Engine();
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

// mesmo POST, SEM o header x-farol: o gate global de 403 (defesa contra site
// qualquer postando no engine local) tem que continuar valendo pras rotas novas
function postSemHeader(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request(base + pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
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

/* ---------- ocultar um PR de "Meus PRs" (mesmo molde do /api/self-review/clear) ---------- */

test('POST /api/pr/hide e /api/pr/unhide mexem no estado e aparecem no snapshot', async () => {
  const CHAVE = 'acme/app#12';
  engine.myPRs = [{ key: CHAVE, repo: 'acme/app', number: 12, url: 'https://github.com/acme/app/pull/12', title: 'velho', updatedAt: '2024-08-01T10:00:00Z' }];

  const h = await post('/api/pr/hide', { key: CHAVE });
  assert.equal(h.status, 200);
  assert.deepEqual(JSON.parse(h.body), { ok: true });
  assert.equal(engine.hiddenPRs[CHAVE].updatedAt, '2024-08-01T10:00:00Z', 'a rota gravou a entrada de verdade');
  assert.deepEqual(JSON.parse((await get('/api/state')).body).hiddenPRs, [CHAVE], 'o snapshot publica a chave oculta');

  const u = await post('/api/pr/unhide', { key: CHAVE });
  assert.equal(u.status, 200);
  assert.deepEqual(JSON.parse(u.body), { ok: true });
  assert.equal(engine.hiddenPRs[CHAVE], undefined, 'mostrar de novo tira do estado');
  assert.deepEqual(JSON.parse((await get('/api/state')).body).hiddenPRs, []);
});

test('POST /api/pr/hide sem o header x-farol continua 403 (o gate global vale pras rotas novas)', async () => {
  const r = await postSemHeader('/api/pr/hide', { key: 'acme/app#12' });
  assert.equal(r.status, 403);
  assert.deepEqual(JSON.parse(r.body), { error: 'forbidden' });
  assert.equal(engine.hiddenPRs['acme/app#12'], undefined, 'e nada foi gravado');
});

/* ---------- /api/log/triage: o log agrupado que o Diagnóstico mostra ----------
   A rota crua (/api/log) devolve linha por linha e tem consumidor e teste; esta
   devolve o MESMO tail já triado por lib/log-taxonomy.js, porque o ui/app.js é
   carregado por <script src> e não pode dar require num módulo de lib/. */

// linhas REAIS do farol.log de produção, no formato "[ts] [NIVEL] mensagem"
function semeiaLog(linhas) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.writeFileSync(LOG_FILE, linhas.join('\n') + '\n');
}

const LOG_FIXTURE = [
  "[2026-08-07 17:32:15] [ERROR] revisao biudtech/biud-esg#193: sessão retornou erro: You've hit your weekly limit · resets 9pm",
  "[2026-08-07 18:10:00] [ERROR] revisao biudtech/biud-core#262: sessão retornou erro: You've hit your session limit",
  "[2026-08-07 21:28:03] [ERROR] revisao biudtech/biud-esg#193: sessão retornou erro: You've hit your weekly limit",
  '[2026-08-07 13:46:00] [ERROR] sessão retornou erro: Your organization has disabled Claude subscription access for Claude Code',
  '[2026-08-06 09:00:00] [WARN] error connecting to api.github.com',
];

test('GET /api/log/triage devolve os grupos ordenados por volume, com janela e PRs citados', async () => {
  semeiaLog(LOG_FIXTURE);
  const r = await get('/api/log/triage');
  assert.equal(r.status, 200);
  const grupos = JSON.parse(r.body);
  assert.ok(Array.isArray(grupos), 'a rota devolve a lista de grupos');
  assert.equal(grupos[0].id, 'limite-plano', 'o grupo mais volumoso vem primeiro');
  assert.equal(grupos[0].count, 3);
  assert.equal(grupos[0].grupo, 'ambiente');
  assert.equal(grupos[0].kind, 'espera-reset');
  assert.equal(grupos[0].first, '2026-08-07 17:32:15');
  assert.equal(grupos[0].last, '2026-08-07 21:28:03');
  assert.deepEqual(grupos[0].refs, ['biudtech/biud-core#262', 'biudtech/biud-esg#193']);
  assert.deepEqual(grupos.map(g => g.id).sort(), ['assinatura-bloqueada', 'limite-plano', 'rede']);
  // 5 linhas viraram 5 eventos em 3 grupos: é a leitura que o painel precisava
  assert.equal(grupos.reduce((a, g) => a + g.count, 0), 5);
});

test('GET /api/log/triage respeita o mesmo parâmetro lines da rota crua', async () => {
  semeiaLog(LOG_FIXTURE);
  const r = await get('/api/log/triage?lines=1');
  assert.equal(r.status, 200);
  const grupos = JSON.parse(r.body);
  assert.equal(grupos.length, 1, 'só a última linha entra no tail');
  assert.equal(grupos[0].id, 'rede');
});

test('GET /api/log segue devolvendo linha CRUA (contrato antigo intacto)', async () => {
  semeiaLog(LOG_FIXTURE);
  const r = await get('/api/log');
  assert.equal(r.status, 200);
  const linhas = JSON.parse(r.body);
  assert.ok(Array.isArray(linhas));
  assert.equal(typeof linhas[0], 'string', 'nada de objeto aqui: a rota crua não mudou');
  assert.equal(linhas.length, LOG_FIXTURE.length);
});

test('GET /api/log/triage sem log nenhum devolve lista vazia, sem estourar', async () => {
  try { fs.rmSync(LOG_FILE, { force: true }); } catch { /* ok */ }
  const r = await get('/api/log/triage');
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), []);
});
