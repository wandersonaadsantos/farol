import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-provider-deadline-'));
process.env.FAROL_HOME = home;
const { runCodexStream } = await import('../lib/codex/stream.js');
const { runAgyStream } = await import('../lib/agy/stream.js');
const original = cp.spawn;
after(() => { cp.spawn = original; delete process.env.FAROL_HEADLESS_CMD; fs.rmSync(home, { recursive: true, force: true }); });

function child() {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
    // Nunca há PID real neste teste: timeout do AGY não pode matar processo alheio.
    pid: 0,
  });
}

function engine() {
  return { config: {}, running: new Map(), ghEnv: () => ({}), killTree() {}, recordUsage() {}, parseEnvelope: t => t };
}

function event(proc, ev) { proc.stdout.write(JSON.stringify(ev) + '\n'); }

test('Codex renova prazo por evento útil e preserva thread para retomar após timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const proc = child();
  cp.spawn = () => proc;
  process.env.FAROL_HEADLESS_CMD = 'stub-local';
  const eng = engine();
  const sessions = [];
  const promise = runCodexStream(eng, 'prompt', { id: 'codex-deadline', onSession: sid => sessions.push(sid) });
  const checked = assert.rejects(promise, err => {
    assert.match(err.message, /sem progresso/);
    assert.equal(err.sessionId, 'thread-para-retomar');
    assert.ok(err.attemptId);
    return true;
  });
  // A verificação do plano é uma promessa, mesmo com o stub sem rede.
  await Promise.resolve();
  delete process.env.FAROL_HEADLESS_CMD;
  event(proc, { type: 'thread.started', thread_id: 'thread-para-retomar' });
  event(proc, { type: 'thread.started', thread_id: 'thread-para-retomar' });
  assert.deepEqual(sessions, ['thread-para-retomar'], 'referência persistível publicada no início, uma vez');
  for (let i = 0; i < 3; i++) {
    t.mock.timers.tick(15 * 60 * 1000);
    event(proc, { type: 'item.completed', item: { type: 'agent_message', text: 'lendo o PR' } });
    assert.ok(eng.running.has('codex-deadline'));
  }
  t.mock.timers.tick(30 * 60 * 1000);
  await checked;
  assert.equal(eng.running.has('codex-deadline'), false);
  proc.emit('close', null);
  cp.spawn = original;
});

test('Antigravity com progresso além de 30min conclui sem ser cortado pelo Farol', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const proc = child();
  cp.spawn = () => proc;
  const promise = runAgyStream(engine(), 'prompt', { id: 'agy-deadline', authProfileId: 'perfil-teste' });
  event(proc, { event: 'init', conversation_id: 'c0ffee00-0000-4000-8000-000000000001' });
  for (let i = 0; i < 3; i++) {
    t.mock.timers.tick(15 * 60 * 1000);
    event(proc, { event: 'step_update', step_update: { step_index: 1, step_type: 'agent_response', text_delta: 'lendo ', state: 'ACTIVE' } });
  }
  event(proc, { event: 'step_update', step_update: { step_index: 1, step_type: 'agent_response', state: 'DONE' } });
  event(proc, { event: 'result', result: { status: 'SUCCESS' } });
  proc.emit('close', 0);
  assert.equal((await promise).text, 'lendo lendo lendo');
  cp.spawn = original;
});

test('Antigravity sem progresso preserva conversa e tentativa no erro de timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const proc = child();
  cp.spawn = () => proc;
  const promise = runAgyStream(engine(), 'prompt', { id: 'agy-parado', authProfileId: 'perfil-teste' });
  const sid = 'c0ffee00-0000-4000-8000-000000000001';
  const checked = assert.rejects(promise, err => {
    assert.match(err.message, /sem progresso/);
    assert.equal(err.sessionId, sid);
    assert.ok(err.attemptId);
    return true;
  });
  event(proc, { event: 'init', conversation_id: sid });
  t.mock.timers.tick(30 * 60 * 1000);
  await checked;
  proc.emit('close', null);
  cp.spawn = original;
});
