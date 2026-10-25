import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-audit-identity-'));
process.env.FAROL_HOME = home;
const { Engine } = await import('../server.js');
const io = (await import('../lib/io.js')).default, previousRun = io.run;
const { auditFixture } = await import('./helpers/audit-fixture.js');
const { command, view, tick } = await import('../lib/review-audit/commands.js');
const { running } = await import('../lib/review-audit/runner.js');
const { saveRound, scopeFor } = await import('../lib/engine/review-round-store.js');
const { digest } = await import('../lib/review-audit/contract.js');
const provider = path.join(import.meta.dirname, '..', 'tools', 'smoke-fixtures', 'audit-provider.js');
const previousStub = process.env.FAROL_HEADLESS_CMD;
process.env.FAROL_HEADLESS_CMD = `"${process.execPath}" "${provider}"`;
after(() => {
  io.run = previousRun;
  if (previousStub === undefined) delete process.env.FAROL_HEADLESS_CMD; else process.env.FAROL_HEADLESS_CMD = previousStub;
  assert.ok(path.resolve(home).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(home, { recursive: true, force: true });
});
function fixture() { const f = auditFixture(new Engine()); io.run = f.run; return f; }

test('auditorias manuais e automáticas preservam login configurado com maiúsculas em credenciais, fontes e sessões', async () => {
  for (const automatic of [false, true]) {
    const f = fixture(), account = 'MixedCase';
    f.engine.config.accounts = [{ user: account, owners: ['org'] }];
    f.engine.config.ghUser = account; f.engine.tokens = { [account]: 'synthetic-fixture' };
    f.engine.tokenFor = Engine.prototype.tokenFor; f.engine.ghEnv = Engine.prototype.ghEnv;
    f.engine.accountForPr = () => account;
    f.engine.resolveClaudeAuth = user => { assert.equal(user, account); return { kind: 'dir', dir: '' }; };
    f.engine.budgetBlockedFor = user => { assert.equal(user, account); return null; };
    f.decision.pr.account = account;
    const round = { ...f.round, id: digest([f.round.id, account]).slice(0, 32), scope: scopeFor(f.decision.key, account) };
    saveRound(round); f.decision.roundId = round.id;
    let requests = 0;
    io.run = (...args) => { assert.equal(args[2].env.GH_TOKEN, 'synthetic-fixture'); requests++; return f.run(...args); };
    if (automatic) {
      f.engine.config.auditSampling = { enabled: true, accounts: ['mixedcase'], dailyLimit: 10, budgetUsd: 10, reserveUsd: 0.5 };
      await tick(f.engine);
    } else {
      const started = await command(f.engine, { action: 'start', decisionId: f.decision.id, account: 'MIXEDCASE', confirmed: true });
      assert.equal(started.ok, true, started.error);
    }
    assert.ok(running(f.engine)); await running(f.engine);
    const value = view(f.engine).jobs.find(v => v.job.target.decisionId === f.decision.id);
    assert.equal(value.result.status, 'completed'); assert.equal(value.job.mode, automatic ? 'automatic' : 'manual');
    assert.ok(requests > 1, 'diff e fontes foram consultados com a credencial correta');
  }
});

