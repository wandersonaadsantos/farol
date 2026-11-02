import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-legacy-proof-'));
process.env.FAROL_HOME = root;
const { PROFILE_FILE, profileFor } = await import('../lib/technical-review/profiles.js');
const { VERSAO_DAS_REGRAS, technicalSummary } = await import('../lib/technical-review/verdict.js');
const { approvalRefusal } = await import('../lib/technical-review/publication.js');
const { technicalRuntime } = await import('../lib/technical-review/runtime.js');
const { rememberReview, publicationEvidence } = await import('../lib/technical-review/registry.js');
const { lacunasDaRodada } = await import('../lib/engine/busca-da-prova.js');
const { technicalReport } = await import('./helpers/technical-proof.js');
const { staleCardMeta } = await import('../ui/pure/review.js');
const { decisionForUi } = await import('../lib/engine/public-review.js');
const { Engine } = await import('../server.js');

after(() => fs.rmSync(root, { recursive: true, force: true }));
fs.mkdirSync(path.dirname(PROFILE_FILE), { recursive: true });
fs.writeFileSync(PROFILE_FILE, JSON.stringify({ repositories: { 'org/repo': { declaration: { scopes: ['core'] } } } }));
const head = 'a'.repeat(40);
const pr = { key: 'org/repo#1', repo: 'org/repo', number: 1, url: 'https://github.com/org/repo/pull/1' };
const report = { ...technicalReport(head, pr.repo), profile: profileFor(pr.repo).fingerprint };

test('decisão antiga com evidência filtrada recusa e agenda nova revisão, inclusive após reinício', async () => {
  for (const fromMemory of [false, true]) {
    const item = { key: pr.key, provaEsgotada: true, technicalReview: report, approvalEvidence: [], pr };
    let checks = 0, saves = 0;
    const e = { decisions: { pending: [item] }, saveDecisions: () => saves++,
      bloqueadoPorChecks: async () => { checks++; return { verifiedHead: head, faltando: [] }; } };
    if (fromMemory) e.technicalApprovals = new Map([[pr.key, { report, evidence: [], provaEsgotada: true }]]);
    const refusal = await approvalRefusal(e, pr, { event: 'APPROVE', commit_id: head });
    assert.equal(refusal.attempted, false);
    assert.match(refusal.error, /prova antiga omitiu lacunas/);
    assert.equal(item.technicalRecheck, true);
    assert.equal(checks, 0);
    assert.equal(saves, 1);
    const ui = decisionForUi(item);
    assert.equal(ui.technical.state, 'pending');
    assert.equal(staleCardMeta(ui).approveDisabled, true);
    assert.equal(staleCardMeta(ui).reviewBtn, 'primary');
  }
});

test('revisão nova comprova e preserva a versão da evidência, mesmo com contador esgotado', async () => {
  const e = { decisions: { pending: [{ key: pr.key, headSha: head, esperaProva: { tentativas: 2 } }] } };
  const result = { headSha: head, technicalReview: report, analysisStatus: 'complete', checksVerifiedHead: head,
    diffMedido: ['README.md'], coverage: { total: 1, reviewed: ['README.md'], missing: [] },
    verificationCheckpoint: { total: 0, conflicts: [] }, protocolo: { prReviewer: 'rodou' } };
  result.approvalEvidence = lacunasDaRodada(e, pr, result);
  assert.deepEqual(result.approvalEvidence, []);
  assert.equal(result.provaEsgotada, true);
  assert.equal(result.approvalEvidenceVersion, VERSAO_DAS_REGRAS);
  rememberReview(e, pr, result);
  assert.equal(publicationEvidence(e, pr).evidenceVersion, VERSAO_DAS_REGRAS);
  const original = { ...technicalRuntime };
  try {
    technicalRuntime.requireTool = async () => 'fixture';
    technicalRuntime.targetFor = async () => ({ base: report.base });
    technicalRuntime.reviewSnapshot = async () => ({ fingerprint: report.humanReviewFingerprint });
    e.bloqueadoPorChecks = async () => ({ verifiedHead: head, faltando: [] });
    assert.equal(await approvalRefusal(e, pr, { event: 'APPROVE', commit_id: head }), null);
    assert.equal(technicalSummary(report, [], { provaEsgotada: true, evidenceVersion: VERSAO_DAS_REGRAS }).state, 'pass');
  } finally { Object.assign(technicalRuntime, original); }
});

test('nova revisão substitui a decisão esgotada e persiste a versão para a publicação após reinício', () => {
  const e = Object.create(Engine.prototype);
  e.config = { accounts: [{ user: 'reviewer', owners: ['org'] }] };
  e.accountForPr = () => 'reviewer'; e.saveDecisions = () => {};
  e.decisions = { pending: [{ key: pr.key, provaEsgotada: true }], resolved: [] };
  e.resolveIntoHistory = item => e.decisions.resolved.push(item);
  const current = e.recordDecision(pr, { headSha: head, technicalReview: report, approvalEvidence: [],
    approvalEvidenceVersion: VERSAO_DAS_REGRAS, provaEsgotada: true }, { status: 'pending' });
  assert.deepEqual(e.decisions.pending, [current]);
  assert.equal(e.decisions.resolved[0].status, 'superseded');
  assert.equal(publicationEvidence(e, pr).evidenceVersion, VERSAO_DAS_REGRAS);
});

// Decisão do dono de 18/10/2026, que supera o PR #250: depois das duas tentativas o que faltar
// vira ressalva e a política da conta decide, e o card diz isso. A prova esgotada que ainda
// mostra lacuna pendente (de regras anteriores, por exemplo) continua sem liberar o Aprovar.
test('a busca ativa diz que o que faltar vira ressalva, e a lacuna ainda pendente não libera Aprovar', () => {
  const active = staleCardMeta({ esperaProva: { tentativas: 1 }, technical: { state: 'pending' } });
  assert.match(active.statusHtml, /somente lacunas não impeditivas podem virar ressalva conforme a política da conta/);
  assert.match(active.statusHtml, /Análise incompleta não é aprovação nem reprovação/);
  const blocked = staleCardMeta({ provaEsgotada: true, technical: { state: 'pending' }, verdict: 'approve' });
  assert.equal(blocked.reviewBtn, 'primary');
  assert.equal(blocked.approveDisabled, true);
});

test('registrar um relatório sem a evidência de aprovação não fabrica um array completo', async () => {
  const e = { decisions: { pending: [] } };
  rememberReview(e, pr, { technicalReview: report });
  const refusal = await approvalRefusal(e, pr, { event: 'APPROVE', commit_id: head });
  assert.equal(refusal.error, 'prova necessária à aprovação ausente');
  assert.equal(refusal.attempted, false);
});
