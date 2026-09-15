// A4 no servidor real (spec 7.A4, critérios de aceite): no modo que exige, requisição
// sem credencial não recebe estado, relatório, log, chat nem evento SSE, e não executa
// ação (um teste por classe do inventário); o segredo não aparece em log, HTML, snapshot
// nem URL; nenhum cookie; modo decidido no servidor; sessão sobrevive a reinício e some
// com a revogação. O modo que exige é ligado aqui por config.localAuth = 'exigir', porque
// ATIVACAO_AUTOMATICA_A4 segue false. FAROL_HOME temporário antes de qualquer import, e
// HOME/USERPROFILE junto: o boot da Engine escreve ~/.claude.json (ensureWorkspaceTrusted)
// e teste nenhum pode mexer no arquivo real.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const HOME = path.join(os.tmpdir(), 'farol-test-local-auth-http-' + process.pid);
process.env.FAROL_HOME = HOME;
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const { LOG_FILE } = await import('../lib/paths.js');
const { SPAWN_LOG_FILE } = await import('../lib/spawnlog.js');
const { criarCodigo } = await import('../lib/local-auth/pareamento.js');
const { revogarTodas } = await import('../lib/local-auth/sessoes.js');
const { CLASSES } = await import('../lib/local-auth/inventario.js');

const RAIZ = path.join(import.meta.dirname, '..');
let engine, server, base;

async function subir() {
  engine = new Engine();
  engine.config.port = 0;
  await new Promise((resolve, reject) => {
    server = startServer(engine, (url, err) => (err ? reject(err) : resolve()));
  });
  base = `http://127.0.0.1:${server.address().port}`;
}

function derrubar() {
  if (!server) return Promise.resolve();
  server.closeAllConnections();
  return new Promise(resolve => server.close(() => resolve()));
}

before(subir);
after(async () => {
  await derrubar();
  fs.rmSync(HOME, { recursive: true, force: true });
});

function pedir(metodo, rota, { corpo, cabecalhos = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = corpo === undefined ? '' : JSON.stringify(corpo);
    const headers = { 'x-farol': '1', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...cabecalhos };
    const req = http.request(base + rota, { method: metodo, headers }, res => {
      let d = ''; res.on('data', c => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

// SSE autenticado não termina: lê até o primeiro evento completo e derruba a conexão
function primeiroEvento(cabecalhos) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + '/api/events', { method: 'GET', headers: cabecalhos }, res => {
      let d = '';
      const fim = () => { req.destroy(); resolve({ status: res.statusCode, headers: res.headers, body: d }); };
      res.on('data', c => { d += c; if (d.includes('\n\n')) fim(); });
      res.on('end', fim);
    });
    req.on('error', err => { if (err.code !== 'ECONNRESET') reject(err); });
    req.end();
  });
}

async function comExigencia(fn) {
  const anterior = engine.config.localAuth;
  engine.config.localAuth = 'exigir';
  try { return await fn(); } finally { engine.config.localAuth = anterior; }
}

async function parearViaHttp(rotulo = 'teste') {
  const codigo = criarCodigo();
  const r = await pedir('POST', '/api/auth/pair', { corpo: { codigo, rotulo } });
  const corpo = JSON.parse(r.body);
  assert.equal(corpo.ok, true, 'o pareamento com código válido tem que funcionar');
  return { codigo, token: corpo.token, resposta: r };
}

const bearer = token => ({ Authorization: `Bearer ${token}` });

// Métodos do engine que alguma rota chama, derivados do fonte do servidor. Substituídos
// por espiões durante as provas de recusa: se o porteiro falhar, a rota bate no espião
// (e não em gh, sessão paga ou update de verdade), e o teste acusa a chamada.
const METODOS_DO_ENGINE = [...new Set([...fs.readFileSync(path.join(RAIZ, 'lib', 'http-server.js'), 'utf8')
  .matchAll(/engine\.(\w+)\(/g)].map(m => m[1]))].filter(n => n !== 'on' && n !== 'log');

async function comEspioes(fn) {
  const chamadas = [];
  const originais = new Map();
  for (const nome of METODOS_DO_ENGINE) {
    originais.set(nome, engine[nome]);
    engine[nome] = () => { chamadas.push(nome); return { ok: true }; };
  }
  try { await fn(chamadas); } finally { for (const [nome, f] of originais) engine[nome] = f; }
}

const GET_DA_CLASSE = new Set(['leitura-sensivel', 'leitura-baixo-risco', 'evento']);

test('desktop sem localAuth: a API responde como hoje e o status diz que não exige', async () => {
  const estado = await pedir('GET', '/api/state');
  assert.equal(estado.status, 200);
  assert.ok(JSON.parse(estado.body).decisions);
  const status = await pedir('GET', '/api/auth/status');
  assert.deepEqual(JSON.parse(status.body), { exigida: false, autenticado: false });
});

for (const [classe, rotas] of Object.entries(CLASSES)) {
  if (classe === 'autenticacao-publica') continue;
  test(`classe ${classe}: sem credencial recebe 401, sem dado e sem ação`, async () => {
    await comExigencia(() => comEspioes(async (chamadas) => {
      for (const rota of rotas) {
        const metodo = GET_DA_CLASSE.has(classe) ? 'GET' : 'POST';
        const corpo = metodo === 'POST' ? { urls: ['https://github.com/acme/app/pull/1'], id: 'x', key: 'acme/app#1' } : undefined;
        const r = await pedir(metodo, rota, { corpo });
        assert.equal(r.status, 401, `${metodo} ${rota} sem credencial`);
        assert.deepEqual(JSON.parse(r.body), { error: 'nao_autenticado' }, `${rota} não pode devolver nada além da recusa`);
        assert.match(String(r.headers['content-type']), /application\/json/, `${rota} não abre stream`);
      }
      assert.deepEqual(chamadas, [], `a classe ${classe} chegou ao engine sem credencial`);
    }));
  });
}

test('token inválido, malformado ou de outro esquema também recebe 401', async () => {
  await comExigencia(async () => {
    for (const cab of [bearer('A'.repeat(43)), { Authorization: 'Bearer ' }, { Authorization: 'Basic abc' }, { Authorization: `bearer ${'A'.repeat(43)}` }]) {
      assert.equal((await pedir('GET', '/api/state', { cabecalhos: cab })).status, 401);
    }
  });
});

test('as exceções públicas dependem do método', async () => {
  await comExigencia(async () => {
    assert.equal((await pedir('GET', '/api/auth/status')).status, 200);
    assert.equal((await pedir('POST', '/api/auth/status', { corpo: {} })).status, 401);
    assert.equal((await pedir('GET', '/api/auth/pair')).status, 401);
  });
});

test('com token válido as rotas respondem, inclusive o SSE', async () => {
  await comExigencia(async () => {
    const { token } = await parearViaHttp();
    const estado = await pedir('GET', '/api/state', { cabecalhos: bearer(token) });
    assert.equal(estado.status, 200);
    assert.ok(JSON.parse(estado.body).decisions);
    const status = await pedir('GET', '/api/auth/status', { cabecalhos: bearer(token) });
    assert.deepEqual(JSON.parse(status.body), { exigida: true, autenticado: true });
    const ev = await primeiroEvento(bearer(token));
    assert.equal(ev.status, 200);
    assert.match(ev.body, /^event: state\n/);
    const semCredencial = await pedir('GET', '/api/events');
    assert.equal(semCredencial.status, 401);
    assert.doesNotMatch(semCredencial.body, /event:/);
  });
});

test('GET /api/auth/status devolve só exigida e autenticado', async () => {
  await comExigencia(async () => {
    const r = await pedir('GET', '/api/auth/status');
    assert.deepEqual(Object.keys(JSON.parse(r.body)).sort(), ['autenticado', 'exigida']);
  });
});

test('pareamento: código não funciona duas vezes e exige x-farol', async () => {
  const codigo = criarCodigo();
  const primeira = JSON.parse((await pedir('POST', '/api/auth/pair', { corpo: { codigo } })).body);
  assert.equal(primeira.ok, true);
  const segunda = JSON.parse((await pedir('POST', '/api/auth/pair', { corpo: { codigo } })).body);
  assert.deepEqual(segunda, { ok: false, code: 'codigo_invalido' });
  const outro = criarCodigo();
  const semHeader = await pedir('POST', '/api/auth/pair', { corpo: { codigo: outro }, cabecalhos: { 'x-farol': '' } });
  assert.equal(semHeader.status, 403);
  assert.equal(JSON.parse((await pedir('POST', '/api/auth/pair', { corpo: { codigo: outro } })).body).ok, true, 'a recusa por x-farol não gasta o código');
});

test('o segredo não aparece em log, spawns.log, snapshot, HTML nem URL', async () => {
  await comExigencia(async () => {
    const { codigo, token, resposta } = await parearViaHttp();
    await pedir('POST', '/api/auth/pair', { corpo: { codigo } });   // reuso recusado
    await pedir('POST', '/api/auth/pair', { corpo: { codigo: 'ERRADO2345' } });
    const estado = await pedir('GET', '/api/state', { cabecalhos: bearer(token) });
    const ui = await pedir('GET', '/', { cabecalhos: bearer(token) });
    const appjs = await pedir('GET', '/app.js', { cabecalhos: bearer(token) });
    const textos = {
      'farol.log': fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8') : '',
      'spawns.log': fs.existsSync(SPAWN_LOG_FILE) ? fs.readFileSync(SPAWN_LOG_FILE, 'utf8') : '',
      snapshot: JSON.stringify(engine.snapshot()),
      'GET /api/state': estado.body,
      'GET /': ui.body,
      'GET /app.js': appjs.body,
      'cabeçalhos do pareamento': JSON.stringify(resposta.headers),
    };
    for (const [onde, texto] of Object.entries(textos)) {
      assert.equal(texto.includes(token), false, `token vazou em ${onde}`);
      assert.equal(texto.includes(codigo), false, `código vazou em ${onde}`);
    }
    assert.equal(resposta.headers.location, undefined, 'pareamento nunca redireciona com segredo em URL');
    assert.equal(JSON.parse(resposta.body).token, token, 'o token sai só no corpo do pareamento');
  });
});

test('nenhuma resposta emite Set-Cookie', async () => {
  await comExigencia(async () => {
    const { token, resposta } = await parearViaHttp();
    const respostas = [
      resposta,
      await pedir('GET', '/api/state'),
      await pedir('GET', '/api/state', { cabecalhos: bearer(token) }),
      await pedir('GET', '/api/auth/status', { cabecalhos: bearer(token) }),
      await pedir('POST', '/api/auth/pair', { corpo: { codigo: 'AAAAAAAAAA' } }),
      await pedir('GET', '/'),
      await pedir('GET', '/nao-existe.txt'),
      await primeiroEvento(bearer(token)),
    ];
    for (const r of respostas) assert.equal(r.headers['set-cookie'], undefined);
  });
});

test('modo decidido no servidor: User-Agent forjado não muda nada', async () => {
  const celular = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Termux/0.118' };
  const desktop = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Electron/44.1.0' };
  assert.equal((await pedir('GET', '/api/state', { cabecalhos: celular })).status, 200, 'UA de celular não liga a exigência');
  assert.deepEqual(JSON.parse((await pedir('GET', '/api/auth/status', { cabecalhos: celular })).body), { exigida: false, autenticado: false });
  await comExigencia(async () => {
    assert.equal((await pedir('GET', '/api/state', { cabecalhos: desktop })).status, 401, 'UA de desktop não desliga a exigência');
  });
});

test('POST /api/settings não liga nem desliga localAuth', async () => {
  const antes = engine.config.localAuth;
  await pedir('POST', '/api/settings', { corpo: { localAuth: 'exigir' } });
  assert.equal(engine.config.localAuth, antes);
});

test('transporte da UI lê o SSE real com o cabeçalho no modo que exige', async () => {
  const { FonteDeEventosAutenticada } = await import('../ui/transporte.js');
  await comExigencia(async () => {
    const { token } = await parearViaHttp('navegador');
    const estado = await new Promise((resolve, reject) => {
      const fonte = new FonteDeEventosAutenticada('/api/events', () => token, (url, init) => fetch(base + url, init), (fn, ms) => { if (ms === 0) fn(); });
      fonte.onerror = () => reject(new Error('o stream autenticado falhou'));
      fonte.addEventListener('state', e => { fonte.close(); resolve(JSON.parse(e.data)); });
    });
    assert.ok(estado.decisions, 'o evento state chegou com o snapshot');
  });
});

test('sessão sobrevive a reinício do engine e some depois da revogação', async () => {
  engine.config.localAuth = 'exigir';
  const { token } = await parearViaHttp();
  await derrubar();
  await subir();
  engine.config.localAuth = 'exigir';
  assert.equal((await pedir('GET', '/api/state', { cabecalhos: bearer(token) })).status, 200, 'o token continua valendo depois do reinício');
  revogarTodas();
  assert.equal((await pedir('GET', '/api/state', { cabecalhos: bearer(token) })).status, 401, 'revogado não entra mais, sem reiniciar');
  engine.config.localAuth = '';
});
