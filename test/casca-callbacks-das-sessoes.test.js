// No modo casca a A4 é sempre exigida, mas as sessões de IA falam de volta com o motor sem
// Bearer: o curl de postagem (terminal e chat) leva `x-farol-review-cap`, e o trap EXIT do
// script de terminal chama /api/session-exit. Cada uma vale como credencial de escopo único,
// só na própria rota (revisão final do plano 1, I1). FAROL_SHELL antes dos imports.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-casca-callbacks-'));
process.env.FAROL_HOME = HOME;
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.FAROL_SHELL = 'mac';
process.env.FAROL_SHELL_VERSION = '3.0.0';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const { novoSegredoDeSaida } = await import('../lib/engine/segredo-de-saida.js');

let engine, server, porta;

before(async () => {
  engine = new Engine();
  engine.config.port = 0;
  server = await new Promise((resolve, reject) => {
    const s = startServer(engine, (url, err) => (err ? reject(err) : resolve(s)));
  });
  porta = server.address().port;
});

after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(() => resolve()));
  fs.rmSync(HOME, { recursive: true, force: true });
});

function pedir(metodo, rota, cabecalhos = {}, corpo) {
  return new Promise((resolve, reject) => {
    const headers = { 'x-farol': '1', 'Content-Type': 'application/json', ...cabecalhos };
    const req = http.request(`http://127.0.0.1:${porta}${rota}`, { method: metodo, headers }, res => {
      let d = ''; res.on('data', c => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.end(corpo === undefined ? undefined : JSON.stringify(corpo));
  });
}

test('POST /api/review/post: capability viva passa pela guarda, inválida ou ausente é 401', async () => {
  const cap = engine.createReviewPostCapability(['acme/repo#1'], 'eu', 'terminal', 't-cap');
  assert.ok(cap, 'a capability nasceu');
  const boa = await pedir('POST', '/api/review/post', { 'x-farol-review-cap': cap }, { key: 'acme/repo#1' });
  assert.notEqual(boa.status, 401, 'quem decide daqui em diante é a rota, não o porteiro');
  const ruim = await pedir('POST', '/api/review/post', { 'x-farol-review-cap': 'x'.repeat(43) }, { key: 'acme/repo#1' });
  assert.equal(ruim.status, 401);
  const sem = await pedir('POST', '/api/review/post', {}, { key: 'acme/repo#1' });
  assert.equal(sem.status, 401);
});

test('POST /api/session-exit: segredo certo encerra, errado ou ausente é 401', async () => {
  const segredo = novoSegredoDeSaida();
  engine.activeReviews.set('t-saida', { id: 't-saida', keys: [], label: 'x', mode: 'terminal', startedAt: Date.now(), segredoDeSaida: segredo });
  const errado = await pedir('POST', '/api/session-exit', { 'x-farol-session': novoSegredoDeSaida() }, { id: 't-saida' });
  assert.equal(errado.status, 401);
  const sem = await pedir('POST', '/api/session-exit', {}, { id: 't-saida' });
  assert.equal(sem.status, 401);
  const deOutraSessao = await pedir('POST', '/api/session-exit', { 'x-farol-session': segredo }, { id: 't-outra' });
  assert.equal(deOutraSessao.status, 401, 'o segredo vale só para o id dele');
  assert.ok(engine.activeReviews.has('t-saida'), 'nada encerrou com credencial errada');
  const certo = await pedir('POST', '/api/session-exit', { 'x-farol-session': segredo }, { id: 't-saida' });
  assert.equal(certo.status, 200);
  assert.equal(engine.activeReviews.has('t-saida'), false, 'a sessão saiu de activeReviews');
});

test('as credenciais de escopo único não abrem nenhuma outra rota', async () => {
  const cap = engine.createReviewPostCapability(['acme/repo#2'], 'eu', 'terminal', 't-cap2');
  const segredo = novoSegredoDeSaida();
  engine.activeReviews.set('t-x', { id: 't-x', keys: [], label: 'x', mode: 'terminal', startedAt: Date.now(), segredoDeSaida: segredo });
  assert.equal((await pedir('GET', '/api/state', { 'x-farol-review-cap': cap })).status, 401);
  assert.equal((await pedir('POST', '/api/session-exit', { 'x-farol-review-cap': cap }, { id: 't-x' })).status, 401);
  assert.equal((await pedir('POST', '/api/review/post', { 'x-farol-session': segredo }, { id: 't-x' })).status, 401);
  assert.equal((await pedir('POST', '/api/settings', { 'x-farol-session': segredo, 'x-farol-review-cap': cap }, { id: 't-x' })).status, 401);
});

test('o segredo de saída nunca vai ao snapshot', () => {
  engine.activeReviews.set('t-snap', { id: 't-snap', keys: [], label: 'x', mode: 'terminal', startedAt: Date.now(), segredoDeSaida: novoSegredoDeSaida() });
  const s = engine.snapshot();
  assert.ok(s.activeSessions.some(x => x.id === 't-snap'), 'a sessão aparece');
  assert.equal(JSON.stringify(s).includes('segredoDeSaida'), false);
});
