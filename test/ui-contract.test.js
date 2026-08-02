'use strict';
// Contrato UI↔server (Onda 3): toda rota /api que o ui/app.js chama tem que EXISTIR no
// lib/http-server.js. O bug de origem (achado M18): o botão Cancelar postava
// /api/cancel-op, rota que nunca existiu; o 404 era engolido pelo .catch(() => null) do
// api() e a sessão seguia rodando com a UI dizendo "Cancelado pelo usuário".
// Sem DOM e sem dependência: os dois arquivos são lidos como texto e conferidos por
// regex, a mesma técnica do ui-semantics.test.js. Método HTTP fica fora do escopo; o
// que se caça aqui é rota que cai no 404 silencioso.
const path = require('node:path');
const fs = require('node:fs');

const { test } = require('node:test');
const assert = require('node:assert/strict');

const APPJS = fs.readFileSync(path.join(__dirname, '..', 'ui', 'app.js'), 'utf8');
const SERVERJS = fs.readFileSync(path.join(__dirname, '..', 'lib', 'http-server.js'), 'utf8');

// chamadas da UI: api('/api/x'), get('/api/x?...'), EventSource e descriptors path: '/api/x'
function rotasChamadas() {
  const rotas = new Set();
  for (const m of APPJS.matchAll(/\b(?:api|get)\(\s*'(\/api\/[^'?]+)/g)) rotas.add(m[1]);
  for (const m of APPJS.matchAll(/new EventSource\('(\/api\/[^'?]+)'\)/g)) rotas.add(m[1]);
  for (const m of APPJS.matchAll(/path:\s*'(\/api\/[^'?]+)'/g)) rotas.add(m[1]);
  return rotas;
}
// rotas servidas: todo `p === '/api/x'` do http-server
function rotasServidas() {
  return new Set([...SERVERJS.matchAll(/p === '(\/api\/[^']+)'/g)].map(m => m[1]));
}

test('toda rota /api chamada pela UI existe no servidor', () => {
  const servidas = rotasServidas();
  const faltando = [...rotasChamadas()].filter(r => !servidas.has(r));
  assert.deepEqual(faltando, [],
    `a UI chama rotas que o servidor não roteia (cairiam no 404 engolido pelo api()): ${faltando.join(', ')}`);
});

test('o extrator de rotas não está cego (sanidade das duas pontas)', () => {
  // se uma refatoração mudar o padrão de chamada ou de roteamento, os Sets esvaziam e o
  // teste acima passaria no vazio; esta sanidade acusa a cegueira.
  const chamadas = rotasChamadas(), servidas = rotasServidas();
  assert.ok(chamadas.has('/api/decide'), 'a UI chama /api/decide');
  assert.ok(chamadas.has('/api/self-review'), 'a UI chama /api/self-review');
  assert.ok(servidas.has('/api/review'), 'o servidor roteia /api/review');
  assert.ok(servidas.has('/api/self-review/cancel'), 'o servidor roteia o cancelamento da autoanálise');
  assert.ok(chamadas.size >= 15, `a UI chama muitas rotas (achou ${chamadas.size})`);
});
