// Rotas do agente da autoanálise no servidor real (issue #346): só a credencial própria
// (cabeçalho x-farol-autoanalise com sessão da classe autoanalise) abre as três rotas, em
// qualquer modo, inclusive o desktop sem autenticação local; e esse token nunca vale como
// Bearer geral. FAROL_HOME, HOME e USERPROFILE temporários antes de qualquer import, como em
// test/local-auth-http.test.js.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-autoanalise-agente-http-'));
process.env.FAROL_HOME = HOME;
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const { emitirSessao, listarSessoes, revogarSessao } = await import('../lib/local-auth/sessoes.js');

const URL_PR = 'https://github.com/acme/app/pull/7';
const ROTAS = [['POST', '/api/self-review/agent/request'], ['GET', `/api/self-review/agent/read?url=${encodeURIComponent(URL_PR)}`], ['GET', '/api/self-review/agent/list']];
let engine, server, base;

before(async () => {
  engine = new Engine();
  engine.config.port = 0;
  engine.config.accounts = [{ user: 'dona', owners: ['acme'] }];
  engine.myPRs = [{ key: 'acme/app#7', url: URL_PR, title: 'Ajuste', author: 'dona', repo: 'acme/app', number: 7, account: 'dona', headSha: 'a'.repeat(40) }];
  await new Promise((resolve, reject) => { server = startServer(engine, (u, err) => (err ? reject(err) : resolve())); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(() => resolve()));
  fs.rmSync(HOME, { recursive: true, force: true });
});

function pedir(metodo, rota, cabecalhos = {}) {
  return new Promise((resolve, reject) => {
    const data = metodo === 'POST' ? JSON.stringify({ url: URL_PR }) : '';
    const headers = { 'x-farol': '1', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...cabecalhos };
    const req = http.request(base + rota, { method: metodo, headers }, res => {
      let d = ''; res.on('data', c => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

// SSE aberto não termina: o que importa aqui é só o status da resposta
function statusDoStream(cabecalhos) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + '/api/events', { method: 'GET', headers: cabecalhos }, res => { resolve(res.statusCode); req.destroy(); });
    req.on('error', err => { if (err.code !== 'ECONNRESET') reject(err); });
    req.end();
  });
}

async function comExigencia(fn) {
  const anterior = engine.config.localAuth;
  engine.config.localAuth = 'exigir';
  try { return await fn(); } finally { engine.config.localAuth = anterior; }
}

const agente = (token) => ({ 'x-farol-autoanalise': token });

async function todasRecusam(cabecalhos, rotulo) {
  for (const [metodo, rota] of ROTAS) {
    const r = await pedir(metodo, rota, cabecalhos);
    assert.equal(r.status, 401, `${rotulo}: ${metodo} ${rota}`);
  }
  assert.equal(engine.headlessQueue.length, 0, `${rotulo}: nada entra na fila`);
}

test('no desktop, sem credencial ou com credencial de outra classe, as três rotas respondem 401', async () => {
  const comum = emitirSessao('celular');
  const casca = emitirSessao('casca', Date.now(), { classe: 'casca' });
  await todasRecusam({}, 'sem credencial');
  await todasRecusam(agente(comum), 'sessão comum no cabeçalho do agente');
  await todasRecusam({ Authorization: `Bearer ${comum}` }, 'Bearer geral');
  await todasRecusam(agente(casca), 'sessão da casca');
  await todasRecusam({ 'x-farol-review-cap': 'x'.repeat(43), 'x-farol-session': 'y'.repeat(43) }, 'credenciais das sessões de IA');
});

test('no modo que exige, o Bearer geral também não abre as rotas do agente', async () => {
  const comum = emitirSessao('celular');
  await comExigencia(() => todasRecusam({ Authorization: `Bearer ${comum}` }, 'Bearer geral exigido'));
});

test('a credencial do agente lê e lista, e nunca vale como Bearer geral', async () => {
  const token = emitirSessao('agente', Date.now(), { classe: 'autoanalise' });
  const lista = await pedir(...ROTAS[2], agente(token));
  assert.equal(lista.status, 200);
  assert.deepEqual(JSON.parse(lista.body).prs.map(p => p.key), ['acme/app#7']);
  const leitura = await pedir(...ROTAS[1], agente(token));
  assert.equal(leitura.status, 200);
  assert.equal(JSON.parse(leitura.body).estado, 'sem_analise');
  await comExigencia(async () => {
    assert.equal((await pedir('GET', '/api/state', { Authorization: `Bearer ${token}` })).status, 401);
    assert.equal((await pedir('GET', '/api/state', agente(token))).status, 401);
    assert.equal(await statusDoStream({ Authorization: `Bearer ${token}` }), 401);
  });
});

test('pedido de PR fora do escopo é recusado com o motivo, sem fila', async () => {
  const token = emitirSessao('agente', Date.now(), { classe: 'autoanalise' });
  const anterior = engine.config.accounts;
  engine.config.accounts = [{ user: 'dona', owners: ['outra'] }];
  try {
    const r = await pedir(...ROTAS[0], agente(token));
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.body).code, 'pr_fora_do_escopo');
    assert.equal(engine.headlessQueue.length, 0);
  } finally { engine.config.accounts = anterior; }
});

test('credencial revogada deixa de abrir as rotas', async () => {
  const token = emitirSessao('revogavel', Date.now(), { classe: 'autoanalise' });
  const id = listarSessoes().find(s => s.rotulo === 'revogavel').id;
  assert.equal(revogarSessao(id), true);
  await todasRecusam(agente(token), 'revogada');
});
