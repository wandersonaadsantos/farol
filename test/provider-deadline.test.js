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
const { checkpointPath, readCheckpoint } = await import('../lib/engine/verification-checkpoint.js');
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

test('checkpoint do Codex chega ao diário real, isolado pelo PR e escopo do engine', async () => {
  const proc = child();
  cp.spawn = () => proc;
  process.env.FAROL_HEADLESS_CMD = 'stub-local';
  const eng = engine();
  const key = 'acme/app#checkpoint-codex';
  eng.activeReviews = new Map([['c1', { pr: { key }, checkpoint: 'review', headSha: 'head-do-engine', fileBlobs: { 'a.ts': 'blob-do-engine' } }]]);
  const promise = runCodexStream(eng, 'prompt', { id: 'c1', operationKind: 'review' });
  await Promise.resolve();
  event(proc, { type: 'item.completed', item: { type: 'agent_message', text: 'FAROL_CHECKPOINT: {"claim":"Valida antes de gravar","file":"a.ts","line":2,"verdict":"confirmado","evidence":"leitura a.ts:2","headSha":"forjado"}' } });
  event(proc, { type: 'item.completed', item: { type: 'agent_message', text: '{"analysisStatus":"complete"}' } });
  event(proc, { type: 'turn.completed', usage: {} });
  proc.emit('close', 0);
  const result = await promise;
  assert.equal(result.text, '{"analysisStatus":"complete"}');
  const saved = readCheckpoint(checkpointPath(key));
  assert.equal(saved.entries.length, 1);
  assert.equal(saved.entries[0].headSha, 'head-do-engine');
  assert.equal(saved.entries[0].blobSha, 'blob-do-engine');
  assert.equal(saved.entries[0].sessionId, 'c1');
  delete process.env.FAROL_HEADLESS_CMD;
  cp.spawn = original;
});

test('Codex recebe seu protocolo na entrada real do processo e mantém chat intacto', async () => {
  for (const operationKind of ['review', 'self', 'chat']) {
    const proc = child();
    cp.spawn = () => proc;
    process.env.FAROL_HEADLESS_CMD = 'stub-local';
    let input = '';
    proc.stdin.on('data', data => { input += String(data); });
    const promise = runCodexStream(engine(), 'prompt original', { operationKind });
    await Promise.resolve();
    if (operationKind === 'chat') assert.equal(input, 'prompt original');
    else {
      assert.match(input, /Execução da revisão no Codex/);
      assert.match(input, /Não execute claude, agy/);
      assert.match(input, /sem inventar delegação/);
    }
    event(proc, { type: 'turn.completed', usage: {} });
    proc.emit('close', 0);
    await promise;
  }
  delete process.env.FAROL_HEADLESS_CMD;
  cp.spawn = original;
});

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

// 31/10/2026: autoanálises do CNBB pelo Codex voltavam vazias e, com --ephemeral, sem rastro.
test('turno do Codex que fecha sem mensagem final deixa no log os tipos de item, sem conteúdo', async () => {
  const proc = child();
  cp.spawn = () => proc;
  process.env.FAROL_HEADLESS_CMD = 'stub-local';
  const logs = [];
  const eng = { ...engine(), log: (nivel, texto) => logs.push([nivel, texto]) };
  const promise = runCodexStream(eng, 'prompt', { id: 'v1', ref: 'acme/app#9', operationKind: 'self' });
  await Promise.resolve();
  event(proc, { type: 'item.completed', item: { type: 'reasoning', text: 'segredo lido do repositório' } });
  event(proc, { type: 'item.completed', item: { type: 'command_execution', command: 'cat .env' } });
  event(proc, { type: 'item.completed', item: { type: 'command_execution', command: 'ls' } });
  event(proc, { type: 'turn.completed', usage: { output_tokens: 812 } });
  proc.emit('close', 0);
  const result = await promise;
  assert.equal(result.text, '');
  const aviso = logs.find(([, t]) => /turno fechou sem mensagem final/.test(t));
  assert.ok(aviso, 'o turno vazio deixa rastro');
  assert.equal(aviso[0], 'WARN');
  assert.match(aviso[1], /acme\/app#9: turno fechou sem mensagem final \(itens: reasoning 1, command_execution 2; último: command_execution; saída: 812 tokens\)/);
  assert.doesNotMatch(aviso[1], /segredo|cat \.env/, 'só tipos e contagens, nunca conteúdo');
  delete process.env.FAROL_HEADLESS_CMD;
  cp.spawn = original;
});

test('turno com mensagem final não registra nada', async () => {
  const proc = child();
  cp.spawn = () => proc;
  process.env.FAROL_HEADLESS_CMD = 'stub-local';
  const logs = [];
  const eng = { ...engine(), log: (nivel, texto) => logs.push([nivel, texto]) };
  const promise = runCodexStream(eng, 'prompt', { id: 'v2', operationKind: 'self' });
  await Promise.resolve();
  event(proc, { type: 'item.completed', item: { type: 'agent_message', text: '{"analysisStatus":"complete"}' } });
  event(proc, { type: 'turn.completed', usage: {} });
  proc.emit('close', 0);
  assert.equal((await promise).text, '{"analysisStatus":"complete"}');
  assert.deepEqual(logs, []);
  delete process.env.FAROL_HEADLESS_CMD;
  cp.spawn = original;
});

// Revisão do PR #327: turno fechado sem nenhum item também é turno vazio.
test('turno do Codex fechado sem nenhum item também deixa rastro', async () => {
  const proc = child();
  cp.spawn = () => proc;
  process.env.FAROL_HEADLESS_CMD = 'stub-local';
  const logs = [];
  const eng = { ...engine(), log: (nivel, texto) => logs.push([nivel, texto]) };
  const promise = runCodexStream(eng, 'prompt', { id: 'v3', ref: 'acme/app#10', operationKind: 'self' });
  await Promise.resolve();
  event(proc, { type: 'turn.completed', usage: { output_tokens: 40 } });
  proc.emit('close', 0);
  assert.equal((await promise).text, '');
  assert.ok(logs.some(([n, t]) => n === 'WARN' && /itens: nenhum; último: nenhum; saída: 40 tokens/.test(t)), JSON.stringify(logs));
  delete process.env.FAROL_HEADLESS_CMD;
  cp.spawn = original;
});
