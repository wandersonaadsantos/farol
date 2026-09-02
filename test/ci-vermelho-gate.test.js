// Check OBRIGATÓRIO vermelho no head nunca sai como APPROVE sozinho, em nenhuma
// política. Caso medido (biudtech/biud-frontend#896, 02/09/2026): a sessão devolveu
// needs_decision e escreveu no relatório que o merge estava travado pelo ruleset, e a
// política de "aprovável com ressalvas" aprovou por cima, porque a regra de CI só
// existia no prompt. Três minutos depois o PR foi mergeado por bypass de admin com o
// `audit` vermelho. O gate mora em shouldAutoApprove, no mesmo padrão de coverageGap e
// checkpointGap: PURO, só olha `result.checksObrigatorios`, que runHeadlessReview
// preenche com o `faltando` do bloqueadoPorChecks antes de chamar o gate.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-ci-vermelho-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');
const { checksVermelhos } = await import('../lib/engine/decision.js');

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

test('checksVermelhos: só o estado vermelho conta; rodando e ausente não provam reprovação', () => {
  assert.deepEqual(checksVermelhos({}), []);
  assert.deepEqual(checksVermelhos({ checksObrigatorios: null }), []);
  assert.deepEqual(checksVermelhos({ checksObrigatorios: [] }), []);
  assert.deepEqual(checksVermelhos({ checksObrigatorios: [{ nome: 'lint', estado: 'rodando' }, { nome: 'build', estado: 'ausente' }] }), []);
  assert.deepEqual(checksVermelhos({ checksObrigatorios: [{ nome: 'audit', estado: 'vermelho' }, { nome: 'test', estado: 'rodando' }] }), ['audit']);
});

test('obrigatório vermelho segura o APPROVE mesmo com a política de ressalvas aprovando', () => {
  const e = engineWithPolicy('approve');
  // é o envelope real do #896: verdict approve, needs_decision, ressalvas, e audit vermelho
  const r = approvableResult({
    decision: 'needs_decision', cardMet: null,
    reasons: [{ text: 'audit obrigatório em FAILURE', kind: 'content' }],
    checksObrigatorios: [{ nome: 'audit', estado: 'vermelho' }],
  });
  assert.deepEqual(e.shouldAutoApprove(PR, r), { ok: false, motivo: 'ci_vermelho' });
});

test('obrigatório vermelho segura também o PR limpo (decision auto_approve, sem ressalva)', () => {
  const e = engineWithPolicy('approve');
  const r = approvableResult({ checksObrigatorios: [{ nome: 'build', estado: 'vermelho' }] });
  assert.deepEqual(e.shouldAutoApprove(PR, r), { ok: false, motivo: 'ci_vermelho' });
});

test('check ainda rodando ou ausente não segura: aprovar com pipe em andamento é decisão de revisor', () => {
  const e = engineWithPolicy('approve');
  const r = approvableResult({ checksObrigatorios: [{ nome: 'test', estado: 'rodando' }, { nome: 'e2e', estado: 'ausente' }] });
  assert.equal(e.shouldAutoApprove(PR, r).ok, true);
});

test('campo ausente (leitura que falhou, repo sem exigência) não inventa CI vermelho', () => {
  const e = engineWithPolicy('approve');
  assert.equal(e.shouldAutoApprove(PR, approvableResult()).ok, true);
  assert.equal(e.shouldAutoApprove(PR, approvableResult({ checksObrigatorios: [] })).ok, true);
});

test('o gate vem antes da política: conta em wait continua em wait, e o motivo é o CI', () => {
  const e = engineWithPolicy('wait');
  const r = approvableResult({ checksObrigatorios: [{ nome: 'audit', estado: 'vermelho' }] });
  assert.deepEqual(e.shouldAutoApprove(PR, r), { ok: false, motivo: 'ci_vermelho' });
});

test('reprovar sozinho não é afetado: CI vermelho não impede REQUEST_CHANGES', () => {
  const e = engineWithPolicy('approve');
  const r = {
    analysisStatus: 'complete', verdict: 'request_changes', decision: 'needs_decision', reasons: [],
    payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'bloqueio real' } },
    checksObrigatorios: [{ nome: 'audit', estado: 'vermelho' }],
  };
  assert.equal(e.shouldAutoReject(PR, r), true);
});
