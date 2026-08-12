'use strict';
// checkpointGap segue EXATAMENTE o padrão de coverageGap (lib/engine/decision.js): função
// pura que só olha o campo já computado em `result`, nunca dispara IO. A leitura de disco
// acontece uma vez só, em runHeadlessReview (Task 7), antes do gate rodar.
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-checkpoint-gate-' + process.pid);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Engine } = require('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

const PR = { key: 'o/r#1', repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1', requested: true };

function approvableResult(extra) {
  return {
    analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
    payloads: { approve: { event: 'APPROVE', body: 'ok' } },
    ...extra
  };
}

function engineWithPolicy(policy) {
  const e = new Engine();
  e.config.autoApproveAll = true;
  e.config.accounts = [];
  e.approvePolicyFor = () => policy;
  e.rejectPolicyFor = () => 'request_changes';
  e.accountForPr = () => 'alguem';
  return e;
}

test('checkpointGap: sem verificationCheckpoint no result, não bloqueia', () => {
  const e = engineWithPolicy('approve');
  assert.equal(e.shouldAutoApprove(PR, approvableResult()).ok, true);
});

test('checkpointGap: verificationCheckpoint limpo (sem conflito), não bloqueia', () => {
  const e = engineWithPolicy('approve');
  const r = approvableResult({ verificationCheckpoint: { total: 2, confirmedCount: 2, conflicts: [] } });
  assert.equal(e.shouldAutoApprove(PR, r).ok, true);
});

test('checkpointGap: verificationCheckpoint com conflito bloqueia o auto-approve', () => {
  const e = engineWithPolicy('approve');
  const r = approvableResult({
    verificationCheckpoint: {
      total: 2, confirmedCount: 1,
      conflicts: [{ entries: [{ claim: 'a', verdict: 'confirmado' }, { claim: 'a', verdict: 'refutado' }] }],
    }
  });
  assert.deepEqual(e.shouldAutoApprove(PR, r), { ok: false, motivo: 'checkpoint' });
});

test('checkpointGap: verificationCheckpoint malformado bloqueia', () => {
  const e = engineWithPolicy('approve');
  const r = approvableResult({ verificationCheckpoint: { malformed: true } });
  assert.deepEqual(e.shouldAutoApprove(PR, r), { ok: false, motivo: 'checkpoint' });
});

function rejectableResult(extra) {
  return {
    analysisStatus: 'complete', verdict: 'request_changes', decision: 'needs_decision', reasons: ['blocker'],
    payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'x' } },
    ...extra
  };
}

test('shouldAutoReject: checkpoint com conflito também bloqueia o auto-reject', () => {
  const e = engineWithPolicy('approve');
  e.rejectPolicyFor = () => 'request_changes';
  const r = rejectableResult({
    verificationCheckpoint: {
      total: 2, confirmedCount: 1,
      conflicts: [{ entries: [{ claim: 'a', verdict: 'confirmado' }, { claim: 'a', verdict: 'refutado' }] }],
    }
  });
  assert.equal(e.shouldAutoReject(PR, r), false, 'divergência entre passadas bloqueia o reject automático também');
});

test('shouldAutoReject: checkpoint limpo ou ausente não bloqueia (comportamento de hoje preservado)', () => {
  const e = engineWithPolicy('approve');
  e.rejectPolicyFor = () => 'request_changes';
  assert.equal(e.shouldAutoReject(PR, rejectableResult()), true, 'sem checkpoint, segue reprovando sozinho como hoje');
  assert.equal(e.shouldAutoReject(PR, rejectableResult({ verificationCheckpoint: { total: 1, confirmedCount: 1, conflicts: [] } })), true, 'checkpoint limpo não bloqueia');
});

// teste direto de checkpointGap isolado (Minor deferido da Task 6)
test('checkpointGap cita arquivo, linha e claim do conflito, não só um índice genérico', () => {
  const { checkpointGap } = require('../lib/engine/decision');
  const result = {
    verificationCheckpoint: {
      conflicts: [
        { entries: [
          { file: 'src/foo.ts', line: 42, claim: 'valida o token antes de usar', verdict: 'confirmado' },
          { file: 'src/foo.ts', line: 42, claim: 'valida o token antes de usar', verdict: 'refutado' },
        ] },
      ],
    },
  };
  const gaps = checkpointGap(result);
  assert.equal(gaps.length, 1);
  assert.match(gaps[0], /src\/foo\.ts/);
  assert.match(gaps[0], /42/);
  assert.match(gaps[0], /valida o token antes de usar/);
});
