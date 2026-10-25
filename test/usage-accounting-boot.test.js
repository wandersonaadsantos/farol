import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-accounting-boot-'));
process.env.FAROL_HOME = home;
const { Engine } = await import('../server.js');
const journal = await import('../lib/engine/usage-tentativas.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));
const model = n => ({ inputTokens: 10 * n, outputTokens: 100 * n, cacheReadInputTokens: 1000 * n, cacheCreationInputTokens: 20 * n, costUSD: n });
const result = (sid, n = 1) => ({ session_id: sid, total_cost_usd: n, usage: { output_tokens: 100 }, modelUsage: { 'claude-opus-5-5': model(n) } });

test('boot preserva id do provedor e a tentativa interrompida invalida o cursor antigo', () => {
  const e = new Engine();
  for (const sid of ['provider-resume', 'sample-2', 'sample-3']) {
    e.recordUsage(`a-${sid}`, 'dev', result(sid), 'claude-opus-5-5', 'profile');
  }
  const before = e.usage.totals;
  const tokens = before.outputTokens, cost = before.costUsd;
  const attempt = journal.abrirTentativa(e, { sessionId: 'a-interrupted', account: 'dev', profileId: 'profile', model: 'claude-opus-5-5' });
  assert.equal(journal.registrarSessao(e, attempt, 'provider-resume'), true);
  journal.registrarParcial(e, attempt, { usage: { output_tokens: 100 }, fimDeTurno: true });
  const boot = new Engine();
  const interrupted = boot.usageSessions.sessions.at(-1);
  assert.equal(interrupted.accounting.sessionId, 'provider-resume');
  assert.equal(interrupted.status, 'interrompida');
  assert.equal(interrupted.costSource, 'estimado');
  boot.recordUsage('a-resumed', 'dev', { ...result('provider-resume', 3), farol_resumed: true }, 'claude-opus-5-5', 'profile');
  const resumed = boot.usageSessions.sessions.at(-1);
  assert.equal(resumed.costSource, 'desconhecido');
  assert.equal(resumed.outputTokens, 100, 'não soma outra vez os tokens já registrados no boot');
  assert.equal(boot.usage.totals.outputTokens, tokens + 200);
  assert.equal(boot.usage.totals.costUsd, cost + 1, 'só a estimativa parcial entra; o restante continua desconhecido');
  boot.recordUsage('a-next', 'dev', { ...result('provider-resume', 4), farol_resumed: true }, 'claude-opus-5-5', 'profile');
  assert.equal(boot.usageSessions.sessions.at(-1).costUsd, 1, 'total confiável restabelece o cursor');
});
