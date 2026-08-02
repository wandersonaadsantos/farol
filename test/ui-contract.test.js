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

test('a paleta de comandos usa funções de decisão que EXISTEM no app.js', () => {
  // regressão do achado A5: cmdStatic montava run: () => decide(...) e nenhum decide
  // existia em script carregado; o clique morria em ReferenceError silencioso e o
  // usuário achava que tinha aprovado
  assert.match(APPJS, /function decide\(/, 'decide() definida');
  assert.match(APPJS, /async function decideComConfirmacao\(/, 'decideComConfirmacao() definida');
  assert.match(APPJS, /run: \(\) => decideComConfirmacao\(/, 'a paleta chama a versão com confirmação');
});

test('o clique num item da paleta fecha a paleta ANTES de rodar e captura a rejeição', () => {
  // sem isto, um run() que lança trava a paleta aberta e a promise rejeita em silêncio
  assert.match(APPJS, /cmdClose\(\); Promise\.resolve\(\)\.then\(\(\) => items\[idx\]\.run\(\)\)\.catch\(/);
});

test('o lote "Aprovar as N pendentes" só alcança as decisões visíveis no escopo', () => {
  // agravante do A5 (regra R13 do plano mestre): aprovar em lote não pode alcançar
  // decisões que o filtro de conta esconde; o lote itera a lista passada por
  // scopeVisible, nunca STATE.decisions.pending inteiro
  assert.match(APPJS, /const visiveis = \(STATE\?\.decisions\?\.pending \|\| \[\]\)\.filter\(scopeVisible\);/,
    'o lote nasce da lista filtrada por scopeVisible');
  assert.match(APPJS, /for \(const d of visiveis\) await decide\(d\.id, 'approve'\);/,
    'a iteração do lote é sobre as visíveis');
  assert.doesNotMatch(APPJS, /for \(const d of \[\.\.\.STATE\.decisions\.pending\]\)/,
    'a iteração antiga sobre a fila inteira saiu');
});
