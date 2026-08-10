'use strict';
// Robustez do stream headless (runClaudeStream): decodificação utf8 (M4), exit code != 0
// com stream parcial (M3), handler de error no stdin (B4) e timeout vs cancelamento (B3).
// Mesmo padrão dos vizinhos: FAROL_HOME temporário e mock de child_process.spawn ANTES
// do require de lib/engine/session (que captura `spawn` no load do módulo).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-stream-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const childProcess = require('child_process');
const realSpawn = childProcess.spawn;
let spawnImpl = null;
childProcess.spawn = function mockableSpawn(...args) {
  if (spawnImpl) return spawnImpl(...args);
  return realSpawn(...args);
};

const { runClaudeStream, cancelSession, parseEnvelope } = require('../lib/engine/session');

after(() => {
  childProcess.spawn = realSpawn;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// filho falso com stdout de STREAM REAL (PassThrough): o teste de multibyte precisa da
// maquinaria de verdade (StringDecoder via setEncoding), senão testaria o próprio fake.
// stdin é EventEmitter com write/end porque runClaudeStream registra handler de 'error'.
function filhoStream() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { write() { }, end() { } });
  child.pid = 4242;
  return child;
}

function engineFalso() {
  return {
    config: {},
    ghEnv: () => ({ PATH: process.env.PATH }),
    running: new Map(),
    killTree() { },
    recordUsage() { },
    // padrão: sem perfil de chave de API (legado), authProfileId fica vazio
    resolveClaudeAuth: () => ({ kind: 'dir', id: '' }),
    toolSummary: () => '',
    parseEnvelope(raw) { return parseEnvelope(this, raw); },
  };
}

test('runClaudeStream: multibyte cortado no limite do chunk não vira U+FFFD (M4)', async () => {
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engineFalso(), 'prompt', {});
  spawnImpl = null;

  const texto = 'revisão aprovada: atenção na validação do módulo de sessão';
  const linha = Buffer.from(JSON.stringify({ type: 'result', result: texto, session_id: 's1' }) + '\n', 'utf8');
  const corte = linha.findIndex(b => b >= 0x80) + 1; // corta DENTRO do primeiro caractere multibyte
  assert.ok(corte > 0, 'o texto de teste precisa ter caractere multibyte');

  // duas metades em DOIS eventos data separados: em flowing mode, escritas enfileiradas
  // no mesmo tick seriam concatenadas num Buffer só e o corte sumiria
  const primeiroChunk = new Promise(r => child.stdout.once('data', r));
  child.stdout.write(linha.slice(0, corte));
  await primeiroChunk;
  child.stdout.once('end', () => child.emit('close', 0));
  child.stdout.write(linha.slice(corte));
  child.stdout.end();

  const res = await p;
  assert.doesNotMatch(res.text, /�/, 'U+FFFD = chunk decodificado como Buffer isolado');
  assert.equal(res.text, texto);
  assert.equal(res.sessionId, 's1');
});

test('runClaudeStream: exit != 0 com stream parcial (sem evento result) é ERRO, não sucesso (M3)', async () => {
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engineFalso(), 'prompt', {});
  spawnImpl = null;

  // o claude morre DEPOIS de emitir NDJSON e ANTES do evento result
  child.stdout.write('{"type":"system","subtype":"init","model":"claude-opus-5","session_id":"s1"}\n');
  child.stdout.write('{"type":"assistant","message":{"content":[{"type":"text","text":"analisando o diff"}]}}\n');
  child.stderr.emit('data', 'FATAL ERROR: JavaScript heap out of memory');
  child.stdout.once('end', () => child.emit('close', 134));
  child.stdout.end();

  await assert.rejects(p, (err) => {
    assert.match(err.message, /saiu com código 134/, 'o exit code real tem que aparecer');
    assert.match(err.message, /heap out of memory/, 'o stderr real tem que aparecer');
    assert.doesNotMatch(err.message, /"type":"system"/, 'NDJSON cru não é mensagem de erro');
    return true;
  });
});

test('runClaudeStream: envelope do stub com exit 0 continua valendo (regressão do fallback)', async () => {
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engineFalso(), 'prompt', {});
  spawnImpl = null;

  child.stdout.once('end', () => child.emit('close', 0));
  child.stdout.write('{"result":"envelope do stub","is_error":false}\n');
  child.stdout.end();

  const res = await p;
  assert.equal(res.text, 'envelope do stub', 'contrato do FAROL_HEADLESS_CMD: envelope + exit 0');
});

test('runClaudeStream: timeout de 30min não engole cancelamento em andamento (B3)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const engine = engineFalso();
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engine, 'prompt', { id: 'sess-1' });
  spawnImpl = null;

  // o usuário cancela: killTree disparado, mas o close do processo ainda não chegou
  assert.equal(cancelSession(engine, 'sess-1').ok, true);
  // o timer de 30min vence NESSA janela, antes do close
  t.mock.timers.tick(30 * 60 * 1000);
  child.emit('close', null); // processo morto pelo killTree do cancelamento

  await assert.rejects(p, (err) => {
    assert.equal(err.cancelled, true, 'cancelamento do usuário virou outra coisa');
    assert.match(err.message, /cancelada por você/);
    return true;
  });
});

test('runClaudeStream: chama recordUsage mesmo quando a sessão termina em erro (achado do incidente de 04/08)', async () => {
  const chamadas = [];
  const engine = engineFalso();
  engine.recordUsage = (id, account, resultEvent, model, profileId) => {
    chamadas.push({ id, account, resultEvent, model, profileId });
  };
  // conta 'bob' resolve pra um perfil de chave de API: o authProfileId tem que chegar
  // em recordUsage mesmo no caminho de erro
  engine.resolveClaudeAuth = (account) => account === 'bob'
    ? { kind: 'apikey', id: 'chave-bob' }
    : { kind: 'dir', id: '' };
  // FAROL_HEADLESS_CMD (stub) precisa devolver um envelope com is_error:true E usage
  // preenchido, simulando uma sessão que gastou token nos turnos anteriores e falhou
  // só no evento final (o cenário real do incidente).
  process.env.FAROL_HEADLESS_CMD = `node -e "console.log(JSON.stringify({type:'result', is_error:true, result:'erro simulado', usage:{input_tokens:100,output_tokens:20}, total_cost_usd:0.05}))"`;
  // este teste é o único do arquivo que faz spawn de verdade (os outros usam
  // spawnImpl falso): precisa que o WORKSPACE (cwd do spawn) exista de fato
  fs.mkdirSync(path.join(FAROL_HOME, 'workspace'), { recursive: true });
  try {
    await assert.rejects(() => runClaudeStream(engine, '/pr-review x', { account: 'bob', id: 'a1' }));
  } finally {
    delete process.env.FAROL_HEADLESS_CMD;
  }
  assert.equal(chamadas.length, 1, 'recordUsage foi chamado mesmo com is_error:true');
  assert.equal(chamadas[0].resultEvent.is_error, true);
  assert.equal(chamadas[0].resultEvent.usage.input_tokens, 100);
  assert.equal(chamadas[0].profileId, 'chave-bob', 'authProfileId do perfil apikey resolvido chega em recordUsage');
});

test('runClaudeStream: repassa opts.ref pra recordUsage (Task 4, plumbing PR/chat/ferramenta)', async () => {
  const chamadas = [];
  const engine = engineFalso();
  engine.recordUsage = (id, account, resultEvent, model, profileId, ref) => {
    chamadas.push({ id, account, resultEvent, model, profileId, ref });
  };
  process.env.FAROL_HEADLESS_CMD = `node -e "console.log(JSON.stringify({type:'result', is_error:false, result:'ok', usage:{input_tokens:1,output_tokens:1}, total_cost_usd:0.01}))"`;
  fs.mkdirSync(path.join(FAROL_HOME, 'workspace'), { recursive: true });
  try {
    const res = await runClaudeStream(engine, 'prompt', { id: 'a1', account: 'trabalho', ref: 'biudtech/farol#88' });
    assert.equal(res.text, 'ok');
  } finally {
    delete process.env.FAROL_HEADLESS_CMD;
  }
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].ref, 'biudtech/farol#88', 'opts.ref precisa chegar em recordUsage');
});

test('runClaudeStream: stdin tem handler de error (EPIPE de processo morto não derruba o engine) (B4)', async () => {
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engineFalso(), 'x'.repeat(128 * 1024), {}); // prompt maior que o pipe de 64KB
  spawnImpl = null;

  const handlers = child.stdin.listenerCount('error');
  // só emite se tem quem ouça: sem handler, o emit derrubaria o PROCESSO do teste
  // (uncaughtException), que é exatamente o modo de falha do achado
  if (handlers > 0) {
    child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE', syscall: 'write' }));
  }
  child.stderr.emit('data', 'morreu antes de ler o prompt');
  child.stdout.once('end', () => child.emit('close', 1));
  child.stdout.end();
  await assert.rejects(p, /saiu com código 1/, 'a causa real da morte vem pelo close, não pelo EPIPE');

  assert.ok(handlers >= 1, 'child.stdin sem handler de error: EPIPE assíncrono vira uncaughtException e mata o engine');
});
