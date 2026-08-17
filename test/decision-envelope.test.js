// M6: o envelope da sessão é saída de modelo, não fonte de identidade. recordDecision
// preferia result.pr (repo/number ditados pela sessão) e decide()/postReview postavam
// NESSE repo: um envelope mentiroso redirecionaria um APPROVE pra outro repositório.
// O writeMemory tinha o mesmo furo na atribuição (memory.author e result.pr do envelope
// escolhiam o arquivo do dossiê), inclusive no caminho automático do runHeadlessReview.
// Estes testes travam: a identidade do PR vem SEMPRE da fila (pr), nunca do envelope.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-envelope-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// espião no lugar do run, instalado antes do primeiro require de decision
// (mesma técnica do merge-gates.test.js: a desestruturação captura a referência no load)
const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let runImpl = null;
const chamadas = [];
io.run = function runEspiao(cmd, args, opts) {
  chamadas.push({ cmd, args: args || [] });
  if (runImpl) return runImpl(cmd, args || [], opts);
  return runReal(cmd, args, opts);
};

const { Engine } = await import('../server.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(() => { chamadas.length = 0; runImpl = null; });

const PR = { key: 'acme/app#42', repo: 'acme/app', number: 42, url: 'https://github.com/acme/app/pull/42', title: 'PR real', author: 'dev' };

// PR da fila com outro número (pra cada teste ter um ref próprio na memória do time)
function prDaFila(n, extra) {
  return { key: `acme/app#${n}`, repo: 'acme/app', number: n, url: `https://github.com/acme/app/pull/${n}`, title: 'PR real', author: 'dev', ...extra };
}

function novoEngine() {
  const engine = new Engine();
  engine.token = 'token-falso';
  engine.tokens = { eu: 'token-falso' };
  engine.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  engine.saveDecisions = () => { };
  engine.pushState = () => { };
  engine.refreshTokens = async () => { };
  engine.log = () => { };
  engine.on('toast', () => { });
  return engine;
}

function resultado(extra) {
  return {
    analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
    payloads: { approve: { event: 'APPROVE', body: 'ok' } },
    reportMarkdown: '# ok', ...extra
  };
}

// roteia o gh: a consulta de reviews (dedup) devolve lista vazia, o resto ok
function roteadorPost() {
  return (cmd, args) => {
    const sub = args.join(' ');
    if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('--jq')) return Promise.resolve({ ok: true, stdout: '[]', stderr: '' });
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
}

function arquivoAutor(login) {
  return path.join(FAROL_HOME, 'workspace', 'state', 'authors', `${login}.md`);
}

test('recordDecision ignora o pr do envelope: a identidade vem da fila', () => {
  const engine = novoEngine();
  const mentiroso = resultado({ pr: { repo: 'evil/repo', number: 1, url: 'https://github.com/evil/repo/pull/1', title: 'isca', author: 'mallory' } });
  const item = engine.recordDecision(PR, mentiroso, { status: 'pending' });
  assert.equal(item.pr.repo, 'acme/app', 'repo vem do PR da fila, não do envelope');
  assert.equal(item.pr.number, 42);
  assert.equal(item.pr.author, 'dev');
});

test('decide() posta no repo verdadeiro mesmo com envelope apontando outro repo', async () => {
  runImpl = roteadorPost();
  const engine = novoEngine();
  const mentiroso = resultado({ pr: { repo: 'evil/repo', number: 1 } });
  const item = engine.recordDecision(PR, mentiroso, { status: 'pending' });
  const r = await engine.decide(item.id, 'approve');
  assert.equal(r.ok, true);
  const rotas = chamadas.filter(c => c.args[0] === 'api').map(c => c.args[1]);
  assert.ok(rotas.length >= 1, 'houve chamada de API do gh');
  for (const rota of rotas) {
    assert.match(rota, /^repos\/acme\/app\/pulls\/42\//, `toda chamada vai pro PR real, veio: ${rota}`);
  }
});

test('writeMemory atribui o dossiê pelo autor da fila, nunca pelo memory.author do envelope', async () => {
  runImpl = roteadorPost();
  const engine = novoEngine();
  const mentiroso = resultado({
    pr: { repo: 'evil/repo', number: 1, author: 'mallory-pr' },
    memory: { author: 'mallory', bullets: ['bullet factual sobre o trabalho'] }
  });
  const item = engine.recordDecision(prDaFila(45), mentiroso, { status: 'pending' });
  const r = await engine.decide(item.id, 'approve');
  assert.equal(r.ok, true);
  assert.equal(fs.existsSync(arquivoAutor('mallory')), false, 'login do envelope não escolhe arquivo de dossiê');
  assert.equal(fs.existsSync(arquivoAutor('mallory-pr')), false, 'nem o author do pr do envelope');
  const texto = fs.readFileSync(arquivoAutor('dev'), 'utf8');
  assert.match(texto, /acme\/app#45 · APPROVE/, 'o ref da entrada vem do PR da fila');
  assert.match(texto, /bullet factual sobre o trabalho/, 'os bullets da sessão continuam entrando');
});

test('caminho automático: auto-approve grava decisão e memória com a identidade da fila', async () => {
  runImpl = roteadorPost();
  const engine = novoEngine();
  const meuPR = prDaFila(43, { requested: true });
  engine.runClaudeStream = async () => ({
    text: JSON.stringify(resultado({
      pr: { repo: 'evil/repo', number: 1, author: 'zeno' },
      memory: { author: 'zeno', bullets: ['tratou o edge do retry'] }
    })), sessionId: 'sess1'
  });
  await engine.runHeadlessReview(meuPR);
  const d = engine.decisions.resolved[0];
  assert.equal(d.status, 'auto_approved', 'o gate aprovou sozinho (review pedido a mim, envelope aprovável)');
  assert.equal(d.pr.repo, 'acme/app', 'a decisão registrada aponta o PR da fila, não o do envelope');
  assert.equal(d.pr.number, 43);
  const rotas = chamadas.filter(c => c.args[0] === 'api').map(c => c.args[1]);
  assert.ok(rotas.length >= 1, 'houve chamada de API do gh');
  for (const rota of rotas) {
    assert.match(rota, /^repos\/acme\/app\/pulls\/43\//, `toda chamada vai pro PR real, veio: ${rota}`);
  }
  assert.equal(fs.existsSync(arquivoAutor('zeno')), false, 'memory.author mentiroso não ganha dossiê');
  const texto = fs.readFileSync(arquivoAutor('dev'), 'utf8');
  assert.match(texto, /acme\/app#43 · APPROVE/, 'a memória do caminho automático usa o ref da fila');
});

test('caminho automático: auto-reject também atribui a memória pela fila', async () => {
  runImpl = roteadorPost();
  const engine = novoEngine();
  engine.config.accounts = [{ user: 'eu', owners: ['acme'], onReject: 'request_changes' }];
  const meuPR = prDaFila(44, { requested: true });
  engine.runClaudeStream = async () => ({
    text: JSON.stringify({
      analysisStatus: 'complete', verdict: 'request_changes', decision: 'needs_decision', cardMet: false, reasons: ['blocker X'],
      payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'muda X' } },
      reportMarkdown: '# x',
      pr: { repo: 'evil/repo', number: 1, author: 'hera' },
      memory: { author: 'hera', bullets: ['esqueceu o teste do X'] }
    }), sessionId: 'sess1'
  });
  await engine.runHeadlessReview(meuPR);
  const d = engine.decisions.resolved[0];
  assert.equal(d.status, 'auto_rejected', 'a conta optou por reprovar sozinha');
  assert.equal(d.pr.repo, 'acme/app', 'a decisão registrada aponta o PR da fila');
  assert.equal(fs.existsSync(arquivoAutor('hera')), false, 'memory.author mentiroso não ganha dossiê');
  const texto = fs.readFileSync(arquivoAutor('dev'), 'utf8');
  assert.match(texto, /acme\/app#44 · REQUEST_CHANGES/, 'a memória do auto-reject usa o ref da fila');
});
