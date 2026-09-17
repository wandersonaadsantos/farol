// O ui/app.js usa o transporte autenticado SÓ quando há token (A4). Sem token, o caminho
// de sempre (EventSource e fetch sem cabeçalho) segue coberto pelo test/app-carrega.test.js.
// Aqui a página carrega com um token salvo e o teste confere o que sai pela rede.
// Arquivo próprio porque o app.js é módulo de navegador carregado uma vez por processo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { instalarDom } from './helpers/dom-stub.js';

const TOKEN = 'c'.repeat(43);
const APPJS = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'app.js'), 'utf8');
// desde a Fase 1b, api() e get() moram na infraestrutura das telas
const INFRA = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'telas', 'infra.js'), 'utf8');

instalarDom();
globalThis.localStorage.setItem('farol-auth-token', TOKEN);
let eventSourceCriados = 0;
globalThis.EventSource = class { constructor() { eventSourceCriados++; } addEventListener() { } close() { } };
const pedidos = [];
globalThis.fetch = async (url, init = {}) => {
  pedidos.push({ url: String(url), init });
  return { ok: false, status: 401, body: null, json: async () => ({}), text: async () => '' };
};
await import('../ui/app.js');
await new Promise(resolve => setTimeout(resolve, 50));

test('com token salvo, o SSE sai por fetch com Authorization e nenhum EventSource é criado', () => {
  assert.equal(eventSourceCriados, 0);
  const eventos = pedidos.filter(p => p.url === '/api/events');
  assert.ok(eventos.length >= 1, 'o stream autenticado foi aberto');
  assert.equal(eventos[0].init.headers.Authorization, `Bearer ${TOKEN}`);
});

test('nenhuma requisição leva o token na URL', () => {
  for (const p of pedidos) assert.equal(p.url.includes(TOKEN), false, `token em URL: ${p.url}`);
});

test('api() e get() passam pelos cabeçalhos com autorização', () => {
  assert.match(APPJS, /import \{ tokenLocal, FonteDeEventosAutenticada \} from '\.\/transporte\.js';/);
  assert.match(INFRA, /import \{ comAutorizacao \} from '\.\.\/transporte\.js';/);
  assert.match(INFRA, /headers: comAutorizacao\(\{ 'Content-Type': 'application\/json', 'x-farol': '1' \}\)/);
  assert.match(INFRA, /function get\(path\) \{ return fetch\(path, \{ headers: comAutorizacao\(\) \}\)/);
  assert.match(APPJS, /const es = tokenLocal\(\) \? new FonteDeEventosAutenticada\('\/api\/events'\) : new EventSource\('\/api\/events'\);/);
});
