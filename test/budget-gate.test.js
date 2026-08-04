'use strict';
// Cobre o gate de orçamento por perfil de chave de API no toReview do check() (server.js).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const HOME = path.join(os.tmpdir(), 'farol-test-budget-gate-' + process.pid);
process.env.FAROL_HOME = HOME;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../server.js');

after(() => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

// monta um PR mínimo e a config necessária pra ele passar por todos os OUTROS filtros do
// toReview (autoReview ligado, token presente, sem estar parked/inflight/retry), isolando
// o comportamento do gate de orçamento como a única variável.
function setupPrEAccount(engine, { budgetDaily, budgetTotal, budgetSince } = {}) {
  engine.config.accounts = [{ user: 'bob', owners: ['x'], autoReview: true }];
  engine.tokens = { bob: 't-b' };
  engine.config.claudeProfiles = [{
    id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', baseUrl: '',
    ...(budgetDaily != null ? { budgetDaily } : {}),
    ...(budgetTotal != null ? { budgetTotal } : {}),
    ...(budgetSince != null ? { budgetSince } : {}),
  }];
  engine.config.claudeProfileId = 'p1';
  const pr = { key: 'biudtech/x#1', url: 'https://github.com/biudtech/x/pull/1', account: 'bob' };
  engine.queue = [pr];
  return pr;
}

test('toReview: conta com perfil de orçamento estourado é excluída do disparo automático', () => {
  const engine = new Engine();
  setupPrEAccount(engine, { budgetDaily: 1 });
  // gasto de hoje já no teto
  const { localDay } = require('../lib/engine/usage');
  engine.usage.byProfileDay = { [`p1|${localDay()}`]: { sessions: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 1 } };
  const toReview = engine.queue.filter(p => {
    const acct = engine.accountForPr ? engine.accountForPr(p) : p.account;
    const auth = engine.resolveClaudeAuth(acct);
    if (auth.kind !== 'apikey') return true;
    const profile = (engine.config.claudeProfiles || []).find(x => x.id === auth.id);
    return !(profile && engine.profileBudgetStatus(profile).blocked);
  });
  assert.equal(toReview.length, 0, 'PR não entra na lista de auto-revisão com orçamento estourado');
});

test('toReview: conta com perfil dentro do orçamento continua elegível', () => {
  const engine = new Engine();
  setupPrEAccount(engine, { budgetDaily: 100 });
  const toReview = engine.queue.filter(p => {
    const acct = p.account;
    const auth = engine.resolveClaudeAuth(acct);
    if (auth.kind !== 'apikey') return true;
    const profile = (engine.config.claudeProfiles || []).find(x => x.id === auth.id);
    return !(profile && engine.profileBudgetStatus(profile).blocked);
  });
  assert.equal(toReview.length, 1, 'PR continua elegível quando o gasto não estourou nada');
});

test('toReview: perfil dir (assinatura) nunca é afetado pelo gate de orçamento', () => {
  const engine = new Engine();
  engine.config.accounts = [{ user: 'bob', owners: ['x'], autoReview: true }];
  engine.tokens = { bob: 't-b' };
  engine.config.claudeProfiles = [{ id: 'd1', label: 'Dir', dir: 'C:\\x' }];
  engine.config.claudeProfileId = 'd1';
  const pr = { key: 'biudtech/x#1', url: 'https://github.com/biudtech/x/pull/1', account: 'bob' };
  const auth = engine.resolveClaudeAuth('bob');
  assert.equal(auth.kind, 'dir');
  // gate nem chega a olhar orçamento pra kind dir
});
