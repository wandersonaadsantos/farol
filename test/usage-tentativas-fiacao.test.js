// Fiação do diário de tentativas no caminho de verdade (runClaudeStream com filho falso
// e stream real), mesmo método do test/usage-parcial-stream.test.js: o furo costuma
// estar na fiação, não na função pura.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-tentativa-fio-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import childProcess from 'node:child_process';

const realSpawn = childProcess.spawn;
let spawnImpl = null;
childProcess.spawn = function spawnFalso(...args) { return spawnImpl ? spawnImpl(...args) : realSpawn(...args); };

const { runClaudeStream, parseEnvelope } = await import('../lib/engine/session.js');
const tentativas = await import('../lib/engine/usage-tentativas.js');
const { Engine } = await import('../server.js');

after(() => {
  childProcess.spawn = realSpawn;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});
beforeEach(() => { fs.rmSync(tentativas.arquivoDeTentativas(), { force: true }); });

const diario = () => {
  if (!fs.existsSync(tentativas.arquivoDeTentativas())) return [];
  return Object.values(JSON.parse(fs.readFileSync(tentativas.arquivoDeTentativas(), 'utf8')).tentativas);
};
const tick = () => new Promise((r) => setImmediate(r));

function filho() {
  const c = new EventEmitter();
  c.stdout = new PassThrough();
  c.stderr = new EventEmitter();
  c.stdin = Object.assign(new EventEmitter(), { write() { }, end() { } });
  c.pid = 4545;
  return c;
}

function engineFalso(registros, auth = { kind: 'dir', id: 'p1' }) {
  return {
    config: {}, running: new Map(), killTree() { },
    ghEnv: () => ({ PATH: '' }), resolveClaudeAuth: () => auth,
    recordUsage(id, account, ev) { registros.push({ id, ev }); },
    pushActivity() { }, setSessionModel() { }, toolSummary: () => '',
    parseEnvelope(raw) { return parseEnvelope(this, raw); },
  };
}

test('sessão Claude: tentativa aberta antes do provedor, parcial gravado e fechada depois do consumo', async () => {
  const registros = [];
  const c = filho();
  spawnImpl = () => c;
  const p = runClaudeStream(engineFalso(registros), 'prompt', { id: 'a-fio', account: 'eu', ref: 'o/r#1' });
  spawnImpl = null;
  const [aberta] = diario();
  assert.equal(aberta.sessionId, 'a-fio');
  assert.equal(aberta.provedor, 'claude');
  c.stdout.write(JSON.stringify({ type: 'assistant', message: { id: 'msg_1', stop_reason: 'tool_use', content: [{ type: 'text', text: 'lendo' }], usage: { output_tokens: 30 } } }) + '\n');
  await tick();
  assert.equal(diario()[0].parcial.output_tokens, 30);
  c.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: 'ok', usage: { output_tokens: 30 }, total_cost_usd: 0.3 }) + '\n');
  c.stdout.once('end', () => c.emit('close', 0));
  c.stdout.end();
  await p;
  assert.equal(registros.length, 1);
  assert.equal(registros[0].ev.farol_attempt, aberta.attemptId, 'a linha leva o id da tentativa');
  assert.deepEqual(diario(), [], 'fechamento normal tira a tentativa do diário');
});

test('sessão Claude com erro: o erro leva o attemptId e o diário esvazia', async () => {
  const c = filho();
  spawnImpl = () => c;
  const p = runClaudeStream(engineFalso([]), 'prompt', { id: 'a-fio-erro' });
  spawnImpl = null;
  const [aberta] = diario();
  c.stdout.once('end', () => c.emit('close', 1));
  c.stdout.end();
  await assert.rejects(p, (err) => err.attemptId === aberta.attemptId);
  assert.deepEqual(diario(), []);
});

test('falha no spawn (evento error) também fecha a tentativa', async () => {
  const c = filho();
  spawnImpl = () => c;
  const p = runClaudeStream(engineFalso([]), 'prompt', { id: 'a-fio-spawn' });
  spawnImpl = null;
  assert.equal(diario().length, 1);
  c.emit('error', new Error('ENOENT'));
  await assert.rejects(p, /ENOENT/);
  assert.deepEqual(diario(), []);
});

test('sessão Codex: tentativa aberta antes do provedor e fechada depois do registro da falha', async () => {
  const registros = [];
  process.env.FAROL_HEADLESS_CMD = 'stub-do-teste';
  const criado = new Promise((resolve) => { spawnImpl = () => { const c = filho(); resolve(c); return c; }; });
  const p = runClaudeStream(engineFalso(registros, { kind: 'codex', id: 'cx1' }), 'prompt', { id: 'a-fio-cx', ref: 'o/r#2' });
  try {
    const c = await criado;
    spawnImpl = null;
    const [aberta] = diario();
    assert.equal(aberta.provedor, 'codex');
    c.stdout.write(JSON.stringify({ type: 'turn.failed', error: { message: 'recusado' } }) + '\n');
    await tick();
    c.stdout.once('end', () => c.emit('close', 1));
    c.stdout.end();
    await assert.rejects(p, (err) => err.attemptId === aberta.attemptId);
    assert.equal(registros.at(-1).ev.farol_attempt, aberta.attemptId);
    assert.equal(registros.at(-1).ev.farol_custo_desconhecido, true);
    assert.deepEqual(diario(), []);
  } finally {
    spawnImpl = null;
    delete process.env.FAROL_HEADLESS_CMD;
  }
});

test('boot da Engine reconcilia a tentativa que sobrou', () => {
  tentativas.abrirTentativa({}, { sessionId: 'a-sobrou', account: 'eu', profileId: '', model: 'claude-opus-5', ref: 'o/r#3' });
  const e = new Engine();
  const s = e.usageSessions.sessions.find((x) => x.id === 'a-sobrou');
  assert.equal(s.status, 'interrompida');
  assert.equal(s.costSource, 'desconhecido');
  assert.deepEqual(diario(), []);
});
