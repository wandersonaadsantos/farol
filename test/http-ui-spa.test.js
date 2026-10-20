// A rota no caminho (20/10/2026): o servidor devolve o index.html para toda navegação fora
// de /api, para `/radar/pra-mim` aberto direto ou recarregado chegar à tela. Prova a regra
// pura (lib/http-ui.js) e o servidor real, no molde do test/http-host-allowlist.test.js:
// caminho profundo devolve a página, /api não, arquivo que existe sai como ele mesmo,
// travessia nunca escapa da pasta da UI, e a allowlist de Host e o porteiro da A4 seguem
// valendo no caminho novo.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-http-spa-'));
process.env.FAROL_HOME = HOME;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const { resolverDaUi } = await import('../lib/http-ui.js');
const { UI_DIR } = await import('../lib/paths.js');

const INDEX = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf8');
let engine, server, porta;

before(async () => {
  engine = new Engine();
  engine.config.port = 0;
  server = await new Promise((resolve, reject) => {
    const s = startServer(engine, (url, err) => (err ? reject(err) : resolve(s)));
  });
  porta = server.address().port;
});

after(() => {
  try { server.close(); } catch { /* já fechado */ }
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// pedido cru: http.request manda o caminho como veio, sem normalizar
function pedir(caminho, { method = 'GET', host } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: host || `127.0.0.1:${porta}` };
    const req = http.request({ host: '127.0.0.1', port: porta, path: caminho, method, headers }, (res) => {
      let corpo = '';
      res.on('data', (c) => (corpo += c));
      res.on('end', () => resolve({ status: res.statusCode, tipo: res.headers['content-type'] || '', corpo }));
    });
    req.on('error', reject);
    req.end();
  });
}

/* ---------- a regra pura ---------- */

test('navegação devolve a página; arquivo que existe sai como ele mesmo', () => {
  for (const p of ['/', '/radar/pra-mim', '/radar/aparelhos/dev-1', '/sistema/contas', '/entregas', '/qualquer/coisa']) {
    const r = resolverDaUi(p, UI_DIR);
    assert.equal(r && r.pagina, true, p);
    assert.equal(r.arquivo, path.join(path.resolve(UI_DIR), 'index.html'), p);
  }
  for (const p of ['/app.js', '/app.css', '/favicon.svg', '/index.html', '/pure/rota.js', '/telas/rota.js']) {
    const r = resolverDaUi(p, UI_DIR);
    assert.equal(r && r.pagina, false, p);
    assert.equal(r.arquivo, path.join(path.resolve(UI_DIR), p.slice(1)), p);
  }
});

test('arquivo que não existe é 404, nunca a página no lugar de um script', () => {
  for (const p of ['/nao-existe.js', '/radar/app.js', '/radar/app.css', '/x.svg']) assert.equal(resolverDaUi(p, UI_DIR), null, p);
});

test('/api nunca vira página, com ou sem barra final', () => {
  for (const p of ['/api', '/api/', '/api/nada', '/api/events']) assert.equal(resolverDaUi(p, UI_DIR), null, p);
});

test('travessia é recusada, inclusive codificada e com barra invertida', () => {
  for (const p of [
    '/../server.js', '/..', '/./app.js', '/radar/../../package.json', '/%2e%2e/package.json', '/%2E%2E/%2E%2E/x',
    '/..%2fpackage.json', '/..%5cpackage.json', '/radar%5c..%5c..%5cserver.js', '/a\\b', '/%00', 'sem-barra',
  ]) {
    assert.equal(resolverDaUi(p, UI_DIR), null, p);
  }
});

test('caminho com `%` malformado leva a página (a tela cai no padrão), nunca um arquivo', () => {
  for (const p of ['/%E0%A4%A', '/nao-existe/%E0%A4%A', '/radar/%', '/sistema/%ZZ']) {
    assert.equal(resolverDaUi(p, UI_DIR).pagina, true, p);
  }
  for (const p of ['/api/%ZZ', '/%ZZ.js', '/radar/%.css', 'sem-barra%ZZ']) assert.equal(resolverDaUi(p, UI_DIR), null, p);
});

test('só leitura chega à página: outro método é 404', () => {
  assert.equal(resolverDaUi('/radar/pra-mim', UI_DIR, 'HEAD').pagina, true);
  for (const m of ['POST', 'PUT', 'DELETE']) {
    assert.equal(resolverDaUi('/radar/pra-mim', UI_DIR, m), null, m);
    assert.equal(resolverDaUi('/app.js', UI_DIR, m), null, m);
  }
});

/* ---------- o servidor real ---------- */

test('caminho profundo aberto direto recebe o index.html, que carrega os arquivos pela raiz', async () => {
  for (const p of ['/radar/pra-mim', '/radar/aparelhos/dev-1?conta=alice', '/sistema/contas', '/entregas?dias=7&org=acme']) {
    const r = await pedir(p);
    assert.equal(r.status, 200, p);
    assert.match(r.tipo, /^text\/html/, p);
    assert.equal(r.corpo, INDEX, p);
  }
  // relativo, `/radar/pra-mim` buscaria `/radar/app.js` e a página abriria vazia
  assert.match(INDEX, /<script type="module" src="\/app\.js">/);
  assert.match(INDEX, /<link rel="stylesheet" href="\/app\.css">/);
  assert.match(INDEX, /href="\/favicon\.svg"/);
  assert.doesNotMatch(INDEX, /(src|href)="(?!\/|#|https?:)[^"]/, 'nenhum arquivo da página por caminho relativo');
});

test('estático existente sai como ele mesmo; /api desconhecida é recusa da API, nunca a página', async () => {
  const js = await pedir('/app.js');
  assert.equal(js.status, 200);
  assert.match(js.tipo, /^text\/javascript/);
  assert.equal(js.corpo, fs.readFileSync(path.join(UI_DIR, 'app.js'), 'utf8'));
  for (const p of ['/api/nada', '/api']) {
    const r = await pedir(p);
    // GET em rota da API que não existe: o roteador da API responde (405 ou 404), em JSON
    assert.ok(r.status === 404 || r.status === 405, `${p}: ${r.status}`);
    assert.doesNotMatch(r.corpo, /<html/i, p);
  }
  const falta = await pedir('/radar/app.js');
  assert.equal(falta.status, 404);
  assert.doesNotMatch(falta.corpo, /<html/i);
});

test('travessia pelo servidor não entrega nada de fora da pasta da UI', async () => {
  const fora = fs.readFileSync(path.join(UI_DIR, '..', 'package.json'), 'utf8');
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/..%5cpackage.json', '/..\\package.json', '/radar/..%2f..%2fpackage.json']) {
    const r = await pedir(p);
    assert.notEqual(r.corpo, fora, p);
    assert.doesNotMatch(r.corpo, /"name":\s*"farol"/, p);
  }
});

test('a allowlist de Host vale no caminho profundo', async () => {
  const r = await pedir('/radar/pra-mim', { host: 'evil.example' });
  assert.equal(r.status, 403);
  assert.doesNotMatch(r.corpo, /<html/i);
});

test('com a A4 exigindo, a página abre no caminho profundo e a API continua pedindo credencial', async () => {
  const antes = engine.config.localAuth;
  engine.config.localAuth = 'exigir';
  try {
    const pagina = await pedir('/sistema/contas');
    assert.equal(pagina.status, 200);
    assert.equal(pagina.corpo, INDEX);
    const api = await pedir('/api/state');
    assert.equal(api.status, 401);
  } finally {
    engine.config.localAuth = antes;
  }
});
