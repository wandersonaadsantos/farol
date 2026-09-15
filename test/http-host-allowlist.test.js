// C1a: a allowlist de Host e Origin roda ANTES de qualquer rota do lib/http-server.js,
// estáticos e SSE inclusive. Sobe o servidor real com uma Engine contra FAROL_HOME
// temporário (sem polling, sem gh), no mesmo molde do test/http.test.js. Os métodos do
// engine que cada rota chamaria são espionados: recusa tem que chegar com ZERO chamadas,
// e o controle com Host válido prova que o espião está no caminho (senão o zero seria vazio).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';

const HOME = path.join(os.tmpdir(), 'farol-test-http-host-' + process.pid);
process.env.FAROL_HOME = HOME;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const { DEFAULT_PORT } = await import('../lib/constants.js');

let engine, server, porta;
const extras = [];

function iniciar(eng) {
  return new Promise((resolve, reject) => {
    const s = startServer(eng, (url, err) => (err ? reject(err) : resolve(s)));
  });
}

before(async () => {
  engine = new Engine();
  engine.config.port = 0; // porta efêmera: a efetiva diverge da config de propósito
  engine.config.deliveriesEnabled = true; // senão /api/deliveries nem chega ao espião
  server = await iniciar(engine);
  porta = server.address().port;
});

after(() => {
  for (const s of [server, ...extras]) { try { s.close(); } catch { /* já fechado */ } }
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// Pedido cru com os cabeçalhos que o teste escolher (http.request mantém o host passado).
// Stream SSE aberto não termina: resolve na resposta e derruba a conexão.
function pedir(pathname, { method = 'GET', headers = {}, body, portaAlvo = porta } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: portaAlvo, path: pathname, method, headers }, res => {
      const tipo = res.headers['content-type'] || '';
      if (tipo.startsWith('text/event-stream')) {
        res.destroy();
        return resolve({ status: res.statusCode, tipo, corpo: '', headers: res.headers });
      }
      let corpo = '';
      res.on('data', c => (corpo += c));
      res.on('end', () => resolve({ status: res.statusCode, tipo, corpo, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function postJson(pathname, corpo, headers, portaAlvo = porta) {
  const body = JSON.stringify(corpo || {});
  return pedir(pathname, {
    method: 'POST', body, portaAlvo,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers },
  });
}

function chamar(c, headers) {
  if (c.method === 'GET') return pedir(c.rota, { headers });
  return postJson(c.rota, c.corpo, { 'x-farol': '1', ...headers });
}

// Troca os métodos do engine por contadores. snapshot segue devolvendo o real, porque
// o SSE e o /api/state serializam o retorno.
function espionar(nomes) {
  const chamadas = Object.fromEntries(nomes.map(n => [n, 0]));
  const originais = {};
  for (const nome of nomes) {
    originais[nome] = engine[nome];
    engine[nome] = (...args) => {
      chamadas[nome]++;
      if (nome === 'snapshot') return originais[nome].apply(engine, args);
      return { ok: true };
    };
  }
  return { chamadas, restaurar: () => { for (const nome of nomes) engine[nome] = originais[nome]; } };
}

const ESPIOES = ['snapshot', 'fetchDeliveries', 'setJiraCredential', 'decide', 'launchReview', 'clearLog', 'checkNow', 'postReviewFromSession'];

// Um representante por classe do inventário da seção 7.A4 da spec.
const CLASSES_A4 = [
  { classe: 'leitura sensível', method: 'GET', rota: '/api/state', espiao: 'snapshot' },
  { classe: 'leitura de baixo risco', method: 'GET', rota: '/api/deliveries?days=7', espiao: 'fetchDeliveries' },
  { classe: 'evento em tempo real', method: 'GET', rota: '/api/events', espiao: 'snapshot' },
  { classe: 'ação que recebe segredo', method: 'POST', rota: '/api/jira/credential', corpo: { siteId: 's1', email: 'a@b.c', token: 'segredo' }, espiao: 'setJiraCredential' },
  { classe: 'ação que posta ou escreve no GitHub', method: 'POST', rota: '/api/decide', corpo: { id: 'd1', action: 'approve' }, espiao: 'decide' },
  { classe: 'ação que abre sessão paga', method: 'POST', rota: '/api/review', corpo: { urls: ['https://github.com/acme/app/pull/1'] }, espiao: 'launchReview' },
  { classe: 'ação destrutiva', method: 'POST', rota: '/api/log/clear', corpo: {}, espiao: 'clearLog' },
  { classe: 'demais ações', method: 'POST', rota: '/api/check', corpo: {}, espiao: 'checkNow' },
];

const hostLocal = () => `127.0.0.1:${porta}`;
const HOST_REBINDING = () => `rebinding.evil.example:${porta}`;

function assertRecusa(r, motivo) {
  assert.equal(r.status, 403);
  assert.match(r.tipo, /application\/json/, 'recusa é JSON, nunca stream nem HTML');
  assert.deepEqual(JSON.parse(r.corpo), { error: 'forbidden', motivo });
}

/* ---------- Host inválido: um teste por classe da A4 ---------- */

for (const c of CLASSES_A4) {
  test(`Host inválido: ${c.classe} (${c.method} ${c.rota}) recebe 403 sem estado, sem SSE e sem ação`, async () => {
    const espiao = espionar(ESPIOES);
    try {
      const r = await chamar(c, { host: HOST_REBINDING() });
      assertRecusa(r, 'host');
      assert.doesNotMatch(r.corpo, /event: state|"decisions"/, 'nenhum pedaço do snapshot sai');
      assert.equal(espiao.chamadas[c.espiao], 0, `${c.espiao} não pode ser chamado`);
      assert.equal(espiao.chamadas.snapshot, 0, 'o snapshot nem é montado');
    } finally {
      espiao.restaurar();
    }
  });
}

for (const c of CLASSES_A4) {
  test(`controle: com Host local, ${c.classe} (${c.method} ${c.rota}) chega ao engine`, async () => {
    const espiao = espionar(ESPIOES);
    try {
      const r = await chamar(c, { host: hostLocal() });
      assert.equal(r.status, 200);
      assert.ok(espiao.chamadas[c.espiao] >= 1, `${c.espiao} está no caminho da rota`);
    } finally {
      espiao.restaurar();
    }
  });
}

test('Host inválido: arquivo estático recebe 403 JSON e nenhum byte da UI', async () => {
  for (const rota of ['/', '/index.html', '/app.css', '/pure/comum.js']) {
    const r = await pedir(rota, { headers: { host: HOST_REBINDING() } });
    assertRecusa(r, 'host');
    assert.doesNotMatch(r.corpo, /<html|<script|\{\s*[a-z-]+\s*:|export /i, rota);
  }
});

/* ---------- Origin ---------- */

test('Origin externo recebe 403 numa leitura, sem estado', async () => {
  const espiao = espionar(ESPIOES);
  try {
    const r = await pedir('/api/state', { headers: { host: hostLocal(), origin: 'https://evil.example' } });
    assertRecusa(r, 'origin');
    assert.equal(espiao.chamadas.snapshot, 0);
  } finally {
    espiao.restaurar();
  }
});

test('Origin externo recebe 403 num POST com x-farol, sem ação', async () => {
  const espiao = espionar(ESPIOES);
  try {
    const r = await postJson('/api/check', {}, { host: hostLocal(), origin: 'https://evil.example', 'x-farol': '1' });
    assertRecusa(r, 'origin');
    assert.equal(espiao.chamadas.checkNow, 0);
  } finally {
    espiao.restaurar();
  }
});

test('Origin da mesma máquina em outra porta também é externo', async () => {
  const outraPorta = porta === 65535 ? porta - 1 : porta + 1;
  const r = await pedir('/api/events', { headers: { host: hostLocal(), origin: `http://127.0.0.1:${outraPorta}` } });
  assertRecusa(r, 'origin');
});

test('nenhum cabeçalho CORS de permissão sai, nem na resposta aceita nem na recusada', async () => {
  const aceita = await pedir('/api/state', { headers: { host: `localhost:${porta}`, origin: `http://localhost:${porta}` } });
  const recusada = await pedir('/api/state', { headers: { host: hostLocal(), origin: 'https://evil.example' } });
  assert.equal(aceita.status, 200);
  assert.equal(recusada.status, 403);
  for (const r of [aceita, recusada]) {
    const cors = Object.keys(r.headers).filter(h => h.startsWith('access-control-'));
    assert.deepEqual(cors, []);
  }
});

/* ---------- quem precisa continuar funcionando ---------- */

test('janela do Electron: Host 127.0.0.1:<porta>, GET sem Origin e POST com a própria origem', async () => {
  const espiao = espionar(ESPIOES);
  try {
    const pagina = await pedir('/', { headers: { host: hostLocal() } });
    assert.equal(pagina.status, 200);
    assert.match(pagina.tipo, /text\/html/);
    const modulo = await pedir('/pure/comum.js', { headers: { host: hostLocal() } });
    assert.equal(modulo.status, 200, 'os módulos de ui/pure/ também são servidos');
    const eventos = await pedir('/api/events', { headers: { host: hostLocal() } });
    assert.equal(eventos.status, 200);
    assert.match(eventos.tipo, /text\/event-stream/);
    const acao = await postJson('/api/check', {}, { host: hostLocal(), origin: `http://127.0.0.1:${porta}`, 'x-farol': '1' });
    assert.equal(acao.status, 200);
    assert.equal(espiao.chamadas.checkNow, 1);
  } finally {
    espiao.restaurar();
  }
});

test('navegador do próprio aparelho: Host e Origin em localhost:<porta>', async () => {
  const espiao = espionar(ESPIOES);
  try {
    const pagina = await pedir('/app.css', { headers: { host: `localhost:${porta}` } });
    assert.equal(pagina.status, 200);
    assert.match(pagina.tipo, /text\/css/);
    const estado = await pedir('/api/state', { headers: { host: `localhost:${porta}`, origin: `http://localhost:${porta}` } });
    assert.equal(estado.status, 200);
    const acao = await postJson('/api/check', {}, { host: `localhost:${porta}`, origin: `http://localhost:${porta}`, 'x-farol': '1' });
    assert.equal(acao.status, 200);
    assert.equal(espiao.chamadas.checkNow, 1);
  } finally {
    espiao.restaurar();
  }
});

/* ---------- porta efetiva ---------- */

function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const livre = s.address().port;
      s.close(err => (err ? reject(err) : resolve(livre)));
    });
  });
}

test('com a config em 0 vale a porta em que o socket escuta, não a da config', async () => {
  assert.equal(engine.config.port, 0);
  assert.equal((await pedir('/api/state', { headers: { host: hostLocal() } })).status, 200);
  assertRecusa(await pedir('/api/state', { headers: { host: '127.0.0.1:0' } }), 'host');
});

test('servidor em porta configurada diferente da padrão aceita a porta efetiva e recusa a padrão', async () => {
  const livre = await portaLivre();
  assert.notEqual(livre, DEFAULT_PORT, 'a porta sorteada não pode ser a padrão, senão o teste não prova nada');
  const anterior = engine.config.port;
  engine.config.port = livre;
  try {
    const s = await iniciar(engine);
    extras.push(s);
    assert.equal(s.address().port, livre);
    assert.equal((await pedir('/api/state', { portaAlvo: livre, headers: { host: `127.0.0.1:${livre}` } })).status, 200);
    assertRecusa(await pedir('/api/state', { portaAlvo: livre, headers: { host: `127.0.0.1:${DEFAULT_PORT}` } }), 'host');
    assertRecusa(await pedir('/api/state', { portaAlvo: livre, headers: { host: `localhost:${DEFAULT_PORT}` } }), 'host');
    s.close();
  } finally {
    engine.config.port = anterior;
  }
});

/* ---------- proteções existentes ---------- */

test('x-farol continua exigido em POST com Host válido (contrato de 403 sem motivo intacto)', async () => {
  const espiao = espionar(ESPIOES);
  try {
    const r = await postJson('/api/check', {}, { host: hostLocal() });
    assert.equal(r.status, 403);
    assert.deepEqual(JSON.parse(r.corpo), { error: 'forbidden' });
    assert.equal(espiao.chamadas.checkNow, 0);
  } finally {
    espiao.restaurar();
  }
});

test('Host inválido sem x-farol: a allowlist responde primeiro, com motivo host', async () => {
  const r = await postJson('/api/check', {}, { host: HOST_REBINDING() });
  assertRecusa(r, 'host');
});

test('x-farol-review-cap continua sendo conferida depois da allowlist', async () => {
  const r = await postJson('/api/review/post', { key: 'acme/app#1', payload: { event: 'APPROVE', body: 'Texto limpo.', comments: [] } }, { host: hostLocal(), 'x-farol': '1' });
  assert.equal(r.status, 200);
  const corpo = JSON.parse(r.corpo);
  assert.equal(corpo.ok, false);
  assert.equal(corpo.blocked, 'capability');
});
