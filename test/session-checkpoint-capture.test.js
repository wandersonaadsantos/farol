'use strict';
// A sessão headless não pode escrever em state/ (regra 2 de pr-review-auto.md). Em vez
// disso, ela sinaliza um veredito de verificação via um marcador estruturado no campo
// `description` de uma chamada Bash que já rodaria de qualquer forma; o ENGINE intercepta
// esse tool_use (mesmo ponto que já alimenta o feed de atividade) e é ELE quem grava o
// checkpoint. Ver docs/superpowers/specs/2026-08-05-checkpoint-verificacao-design.md, Onda 1.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-session-checkpoint-' + process.pid);
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

const { runClaudeStream, parseEnvelope } = require('../lib/engine/session');
const { checkpointPath, readCheckpoint } = require('../lib/engine/verification-checkpoint');

after(() => {
  childProcess.spawn = realSpawn;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function filhoStream() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { write() { }, end() { } });
  child.pid = 4242;
  return child;
}

function engineFalso(id, prKey, extraReviewFields) {
  const activeReviews = new Map();
  activeReviews.set(id, { id, pr: { key: prKey }, ...(extraReviewFields || {}) });
  return {
    config: {},
    ghEnv: () => ({ PATH: process.env.PATH }),
    running: new Map(),
    activeReviews,
    killTree() { },
    recordUsage() { },
    resolveClaudeAuth: () => ({ kind: 'dir', id: '' }),
    toolSummary: () => '',
    parseEnvelope(raw) { return parseEnvelope(this, raw); },
  };
}

async function rodarSessaoComMarcador(engine, id, campos) {
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engine, 'prompt', { id });
  spawnImpl = null;

  const marcador = 'FAROL_CHECKPOINT: ' + JSON.stringify(campos);
  const linhaToolUse = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'true', description: marcador } }] },
  }) + '\n';
  const linhaResult = JSON.stringify({ type: 'result', result: 'ok', session_id: 's1' }) + '\n';

  child.stdout.write(linhaToolUse);
  child.stdout.once('end', () => child.emit('close', 0));
  child.stdout.write(linhaResult);
  child.stdout.end();

  return p;
}

test('marcador FAROL_CHECKPOINT no description de um Bash grava uma entrada no checkpoint da sessão', async () => {
  const id = 'a1';
  const prKey = 'acme/repo#99';
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engineFalso(id, prKey), 'prompt', { id });
  spawnImpl = null;

  const marcador = 'FAROL_CHECKPOINT: ' + JSON.stringify({
    claim: 'gateway.ts:10 confirma x', file: 'gateway.ts', line: 10,
    verdict: 'confirmado', evidence: 'linha 10 confirma',
  });
  const linhaToolUse = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'true', description: marcador } }] },
  }) + '\n';
  const linhaResult = JSON.stringify({ type: 'result', result: 'ok', session_id: 's1' }) + '\n';

  child.stdout.write(linhaToolUse);
  child.stdout.once('end', () => child.emit('close', 0));
  child.stdout.write(linhaResult);
  child.stdout.end();

  await p;

  const arquivo = checkpointPath(prKey);
  assert.equal(fs.existsSync(arquivo), true, 'o engine gravou o checkpoint, a sessão não precisou tocar em state/');
  const saved = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  assert.equal(saved.entries.length, 1);
  assert.equal(saved.entries[0].verdict, 'confirmado');
  assert.equal(saved.entries[0].file, 'gateway.ts');
});

test('Bash SEM o marcador no description não grava nada (comportamento de hoje, intocado)', async () => {
  const id = 'a2';
  const prKey = 'acme/repo#100';
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engineFalso(id, prKey), 'prompt', { id });
  spawnImpl = null;

  const linhaToolUse = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls', description: 'listar arquivos' } }] },
  }) + '\n';
  const linhaResult = JSON.stringify({ type: 'result', result: 'ok', session_id: 's1' }) + '\n';

  child.stdout.write(linhaToolUse);
  child.stdout.once('end', () => child.emit('close', 0));
  child.stdout.write(linhaResult);
  child.stdout.end();

  await p;

  assert.equal(fs.existsSync(checkpointPath(prKey)), false, 'sem marcador, nada é gravado');
});

test('marcador com JSON inválido depois dele é ignorado, não derruba a sessão', async () => {
  const id = 'a3';
  const prKey = 'acme/repo#101';
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engineFalso(id, prKey), 'prompt', { id });
  spawnImpl = null;

  const linhaToolUse = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'true', description: 'FAROL_CHECKPOINT: {isso nao e json valido' } }] },
  }) + '\n';
  const linhaResult = JSON.stringify({ type: 'result', result: 'ok', session_id: 's1' }) + '\n';

  child.stdout.write(linhaToolUse);
  child.stdout.once('end', () => child.emit('close', 0));
  child.stdout.write(linhaResult);
  child.stdout.end();

  const res = await p;
  assert.equal(res.text, 'ok', 'a sessão termina normalmente, o marcador ruim não propaga erro');
  assert.equal(fs.existsSync(checkpointPath(prKey)), false, 'nada foi gravado (JSON inválido)');
});

test('entrada gravada carrega o headSha da revisão quando presente em activeReviews', async () => {
  const id = 'a4';
  const prKey = 'org/repo#99';
  const engine = engineFalso(id, prKey, { headSha: 'abc123' });

  await rodarSessaoComMarcador(engine, id, {
    claim: 'x', file: 'f.ts', line: 1, verdict: 'confirmado', evidence: 'e',
  });

  const cp = readCheckpoint(checkpointPath(prKey));
  assert.equal(cp.entries[0].headSha, 'abc123');
});

test('entrada gravada sem headSha na revisão (busca ao gh falhou) grava headSha vazio, não quebra', async () => {
  const id = 'a5';
  const prKey = 'org/repo#100';
  const engine = engineFalso(id, prKey); // sem headSha

  await rodarSessaoComMarcador(engine, id, {
    claim: 'y', file: 'g.ts', line: 2, verdict: 'confirmado', evidence: 'e',
  });

  const cp = readCheckpoint(checkpointPath(prKey));
  assert.equal(cp.entries[0].headSha, '');
});
