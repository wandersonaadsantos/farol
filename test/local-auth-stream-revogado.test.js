// Achado da jornada integrada do pareamento (16/09/2026): com a API exigindo credencial, um
// stream de eventos JÁ ABERTO continuava recebendo o estado inteiro depois de a sessão ser
// revogada, porque a credencial só era conferida na conexão. Revogar precisa cortar o que
// está aberto, senão "revogar todas" não revoga o navegador perdido que ficou com a aba
// aberta. O modo que exige é ligado por config.localAuth, como nos outros testes da A4.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-stream-revogado-'));
process.env.FAROL_HOME = HOME;
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const { criarCodigo } = await import('../lib/local-auth/pareamento.js');
const { revogarTodas, emitirSessao } = await import('../lib/local-auth/sessoes.js');
const { TEMPOS } = await import('../lib/constants.js');

let engine;
let server;
let base;

before(async () => {
  engine = new Engine();
  engine.log = () => { };
  engine.config.port = 0;
  engine.config.localAuth = 'exigir';
  await new Promise((resolve, reject) => {
    server = startServer(engine, (url, err) => (err ? reject(err) : resolve()));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(() => resolve()));
  fs.rmSync(HOME, { recursive: true, force: true });
});

// Abre o stream e junta tudo o que chega; `fim` resolve quando o servidor encerra.
function abrirStream(token) {
  return new Promise((resolve, reject) => {
    // agent: false, sempre socket novo: reaproveitar o socket de um stream que o servidor
    // encerrou devolvia 400, e o teste lia esse fim como se fosse o encerramento esperado
    const req = http.get(`${base}/api/events`, { agent: false, headers: { Authorization: `Bearer ${token}` } }, (res) => {
      const recebido = { status: res.statusCode, texto: '' };
      const fim = new Promise((pronto) => res.on('end', pronto));
      res.on('data', (c) => { recebido.texto += c; });
      resolve({ recebido, fim, req });
    });
    req.on('error', reject);
  });
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

test('stream aberto com credencial válida recebe o estado', async () => {
  const token = emitirSessao('teste');
  const s = await abrirStream(token);
  assert.equal(s.recebido.status, 200);
  engine.emit('state', { marca: 'antes' });
  await esperar(50);
  assert.match(s.recebido.texto, /"marca":"antes"/);
  s.req.destroy();
});

test('revogar a sessão encerra o stream aberto, e nada mais é enviado por ele', async () => {
  const token = emitirSessao('teste');
  const s = await abrirStream(token);
  engine.emit('state', { marca: 'um' });
  await esperar(50);
  revogarTodas();
  // a reconferência tem memória curta: depois dela, o próximo envio já não sai
  await esperar(TEMPOS.STREAM_RECONFERENCIA_MS + 50);
  engine.emit('state', { marca: 'depois-da-revogacao' });
  const encerrou = await Promise.race([s.fim.then(() => true), esperar(2000).then(() => false)]);
  assert.equal(encerrou, true, 'o servidor encerrou o stream');
  assert.doesNotMatch(s.recebido.texto, /depois-da-revogacao/);
});

test('sem envio nenhum, o batimento também confere e encerra', async () => {
  const token = emitirSessao('teste');
  const s = await abrirStream(token);
  assert.equal(s.recebido.status, 200, 'o stream abriu de verdade');
  const abertoEm = Date.now();
  // o engine emite sozinho (estado, avisos, relógio): sem calar TODA emissão, quem
  // encerraria o stream seria um envio, e o batimento nunca seria provado
  const emitirOriginal = engine.emit;
  engine.emit = () => false;
  revogarTodas();
  const encerrou = await Promise.race([s.fim.then(() => true), esperar(TEMPOS.SSE_PING_MS + 2000).then(() => false)]);
  engine.emit = emitirOriginal;
  assert.equal(encerrou, true);
  // quem encerra é o batimento, que só roda depois do primeiro intervalo
  assert.ok(Date.now() - abertoEm >= TEMPOS.SSE_PING_MS - 100, `encerrou cedo demais: ${Date.now() - abertoEm} ms`);
});

test('sem a exigência (desktop), stream sem credencial segue recebendo depois da reconferência', async () => {
  engine.config.localAuth = undefined;
  try {
    const s = await abrirStream('');
    await esperar(TEMPOS.STREAM_RECONFERENCIA_MS + 50);
    engine.emit('state', { marca: 'desktop-segue' });
    await esperar(50);
    assert.match(s.recebido.texto, /desktop-segue/);
    s.req.destroy();
  } finally {
    engine.config.localAuth = 'exigir';
  }
});

test('o pareamento continua funcionando depois disso', async () => {
  const codigo = criarCodigo();
  const r = await new Promise((resolve, reject) => {
    const dados = JSON.stringify({ codigo, rotulo: 'teste' });
    const req = http.request(`${base}/api/auth/pair`, { method: 'POST', headers: { 'x-farol': '1', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados), Connection: 'close' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.end(dados);
  });
  assert.equal(r.ok, true);
});
