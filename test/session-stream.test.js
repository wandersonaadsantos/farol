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
