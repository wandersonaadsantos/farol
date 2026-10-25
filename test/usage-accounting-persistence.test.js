import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-accounting-'));
process.env.FAROL_HOME = home;
const { Engine } = await import('../server.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));
const one = { inputTokens: 10, outputTokens: 100, cacheReadInputTokens: 1000, cacheCreationInputTokens: 20, costUSD: 1 };
const two = Object.fromEntries(Object.entries(one).map(([k, n]) => [k, n * 2]));
const ev = n => ({ session_id: 'provider-session', usage: { output_tokens: 5 }, total_cost_usd: n,
  modelUsage: { 'claude-opus-5-5': n === 1 ? one : two }, farol_attempt: `attempt-${n}` });

test('cursor persiste no registro de sessões e retomada após reiniciar soma apenas o novo gasto', () => {
  const first = new Engine();
  first.recordUsage('a-first', 'Dev', ev(1), 'claude-opus-5-5', 'profile');
  const second = new Engine();
  second.recordUsage('a-next', 'Dev', { ...ev(2), farol_resumed: true }, 'claude-opus-5-5', 'profile');
  assert.equal(second.usage.totals.costUsd, 2);
  assert.equal(second.usage.totals.outputTokens, 200);
  assert.equal(second.usageSessions.sessions.at(-1).accounting.scope, 'tree-delta');
  assert.equal(second.usageSessions.sessions.at(-1).costUsd, 1);
  second.recordUsage('a-next', 'Dev', { ...ev(2), farol_resumed: true }, 'claude-opus-5-5', 'profile');
  assert.equal(second.usageSessions.sessions.length, 2, 'mesma tentativa não entra duas vezes');
  assert.equal(second.usage.totals.costUsd, 2);
});

test('modelo misto mantém agregado único e matrizes por modelo reconciliadas', () => {
  const e = new Engine();
  const start = e.usage.totals.costUsd;
  const sessions = e.usage.totals.sessions;
  e.recordUsage('a-mixed', 'Dev', { session_id: 'mixed-session', total_cost_usd: 3,
    modelUsage: { 'claude-opus-5-5': two, 'claude-haiku-5-5': one } }, 'claude-opus-5-5', 'profile');
  assert.equal(e.usage.totals.costUsd - start, 3);
  assert.equal(e.usage.totals.sessions - sessions, 1);
  assert.equal(e.usage.byModel['Haiku 5.5'].costUsd, 1);
  assert.equal(e.usage.byModel['Haiku 5.5'].outputTokens, 100);
  const totalByModel = Object.values(e.usage.byModel).reduce((n, b) => n + b.costUsd, 0);
  assert.equal(totalByModel, e.usage.totals.costUsd);
});

test('primeira retomada legada não lança custo cumulativo inteiro como gasto novo', () => {
  const e = new Engine();
  const start = e.usage.totals.costUsd;
  e.recordUsage('a-legacy-resume', 'Dev', { ...ev(2), session_id: 'old-session', farol_attempt: 'legacy-attempt', farol_resumed: true }, 'claude-opus-5-5', 'profile');
  assert.equal(e.usage.totals.costUsd, start);
  const recorded = e.usageSessions.sessions.at(-1);
  assert.equal(recorded.costSource, 'desconhecido');
  assert.equal(recorded.accounting.reason, 'missing-baseline');
  assert.equal(recorded.outputTokens, 5);
});
