import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test, after } from 'node:test';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-self-reconcile-'));
process.env.FAROL_HOME = home;
const { Engine } = await import('../server.js');
const { STATE_DIR, BASELINE_FILE } = await import('../lib/paths.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));

const pr = { key: 'acme/app#12', repo: 'acme/app', number: 12,
  url: 'https://github.com/acme/app/pull/12', author: 'outro-autor', account: 'eu',
  title: 'Revisão solicitada manualmente', updatedAt: '2026-11-02T12:00:00Z' };

function fixture(state = 'OPEN') {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(BASELINE_FILE, 'baseline\n');
  const engine = new Engine();
  engine.config.accounts = [{ user: 'eu', owners: ['acme'], autoReview: false }];
  engine.selfAnalyses = { [pr.key]: { key: pr.key, headSha: 'a'.repeat(40),
    reportMarkdown: 'Relatório pago preservado', history: [{ reportMarkdown: 'Anterior' }] } };
  engine.pushState = () => {};
  engine.schedule = () => {};
  engine.log = () => {};
  engine.resolveAccount = async () => {};
  engine.refreshTokens = async () => { engine.tokenOk = true; };
  engine.searchPRs = async () => [];
  engine.myAuthoredPRs = async () => [];
  engine.enrichMyPRBranches = async () => {};
  engine.refreshMergeStates = async () => {};
  engine.refreshStaleStates = async () => {};
  engine.refreshReviewSignals = async () => {};
  engine.scanPushbacks = async () => {};
  engine.checkUpdate = async () => {};
  engine.saveSeen = () => {};
  engine.bloqueadoPorHistorico = async () => ({ bloqueado: false });
  engine.bloqueadoPorChecks = async () => ({ bloqueado: false });
  engine.launchReview = () => assert.fail('não deve iniciar revisão');
  engine.calls = [];
  engine.prState = async target => { engine.calls.push(target); return state; };
  return engine;
}

async function cycles(engine, count = 3) {
  for (let i = 0; i < count; i++) await engine.check('test');
}

test('PR aberto de outro autor não perde relatório nem histórico por ausência autoral', async () => {
  const engine = fixture();
  const analysis = engine.selfAnalyses[pr.key];
  await cycles(engine);
  assert.equal(engine.selfAnalyses[pr.key], analysis);
  assert.ok(engine.calls.length, 'ausência exige consulta direta ao PR');
  assert.equal(engine.calls[0].url, pr.url);
  assert.equal(engine.accountForPr(engine.calls[0]), 'eu');
});

for (const state of [null, '', 'UNKNOWN']) {
  test(`estado inconclusivo ${String(state)} não comprova fechamento`, async () => {
    const engine = fixture(state);
    const analysis = engine.selfAnalyses[pr.key];
    await cycles(engine);
    assert.equal(engine.selfAnalyses[pr.key], analysis);
  });
}

test('falha na consulta direta preserva a análise', async () => {
  const engine = fixture();
  engine.prState = async () => { throw new Error('falha de rede'); };
  await cycles(engine);
  assert.ok(engine.selfAnalyses[pr.key]);
});

for (const state of ['CLOSED', 'MERGED']) {
  test(`limpeza exige confirmação direta de ${state}`, async () => {
    const engine = fixture(state);
    await cycles(engine, 1);
    assert.ok(engine.selfAnalyses[pr.key]);
    assert.equal(engine.calls.length, 0);
    await cycles(engine, 1);
    assert.equal(engine.calls.length, 1, 'consulta direta precede exclusão');
    assert.equal(engine.selfAnalyses[pr.key], undefined);
  });
}

test('PR aberto no panorama não precisa pertencer à lista autoral', async () => {
  const engine = fixture();
  engine.searchPRs = async args => args[0] === '--owner' ? [{ ...pr }] : [];
  await cycles(engine, 4);
  assert.ok(engine.selfAnalyses[pr.key]);
  assert.equal(engine.calls.length, 0, 'presença positiva evita consulta redundante');
});

test('resultado novo durante a consulta não é apagado pela reconciliação antiga', async () => {
  const engine = fixture();
  const fresh = { key: pr.key, headSha: 'b'.repeat(40), reportMarkdown: 'Novo relatório' };
  engine.prState = async () => { engine.selfAnalyses[pr.key] = fresh; return 'CLOSED'; };
  await cycles(engine, 2);
  assert.equal(engine.selfAnalyses[pr.key], fresh);
});
