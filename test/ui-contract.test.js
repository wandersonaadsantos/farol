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

/* ---------- contrato da navegação interna (data-goto) ----------
   Mesma classe de bug do M18 que deu origem a este arquivo: destino escrito à mão
   que não existe. Aqui o sintoma é pior de achar, porque não gera 404 nenhum: o
   querySelector devolve null, o goTo() volta em silêncio e o clique simplesmente
   não faz nada. A trava confere, contra o index.html, que toda aba, seção e
   âncora citada num data-goto EXISTE. */
const INDEXHTML = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
const PUREJS = fs.readFileSync(path.join(__dirname, '..', 'ui', 'pure.js'), 'utf8');

// specs literais: atributo no html e string em js. Quem monta o destino com
// template (`sys:accounts:...${user}`) fica de fora: o valor só existe em runtime.
function gotoSpecs() {
  const specs = new Set();
  for (const m of INDEXHTML.matchAll(/data-goto="([^"$]+)"/g)) specs.add(m[1]);
  for (const src of [PUREJS, APPJS]) {
    for (const m of src.matchAll(/'((?:aba|sys|deliv):[^'$]+)'/g)) specs.add(m[1]);
  }
  return [...specs];
}

test('todo destino de data-goto aponta pra uma aba, seção e âncora que EXISTEM', () => {
  const specs = gotoSpecs();
  assert.ok(specs.length >= 5, `esperava achar destinos literais, achei ${specs.length}`);
  const quebrados = [];
  for (const spec of specs) {
    const [tipo, alvo, ...resto] = spec.split(':');
    const seletor = resto.join(':');
    if (tipo === 'aba' && !INDEXHTML.includes(`id="tab-${alvo}"`)) quebrados.push(`${spec}: aba "${alvo}" não existe`);
    if (tipo === 'sys' && !INDEXHTML.includes(`data-section="${alvo}"`)) quebrados.push(`${spec}: seção "${alvo}" não existe`);
    // âncora por id é a única parte conferível do seletor (classe pode ser gerada)
    if (seletor.startsWith('#') && !INDEXHTML.includes(`id="${seletor.slice(1)}"`)) {
      quebrados.push(`${spec}: âncora "${seletor}" não existe no index.html`);
    }
  }
  assert.deepEqual(quebrados, [], 'data-goto apontando pro vazio: o clique não faria nada, sem erro nenhum');
});

test('goTo trata o formato aba:<nome>:<seletor> (senão o destino de ferramenta só troca de aba)', () => {
  assert.match(APPJS, /if \(tipo === 'aba'\) return gotoAba\(alvo, seletor \|\| null\);/,
    'o ramo da aba precisa repassar o seletor');
  assert.match(APPJS, /function gotoAba\(nome, at\)/, 'gotoAba() definida');
});
