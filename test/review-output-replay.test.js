import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-output-replay-'));
process.env.FAROL_HOME = home;
const { compareReviewOutput } = await import('../tools/replay-saida-review.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));
const payload = { event: 'REQUEST_CHANGES', body: 'Corrija o isolamento da empresa.', comments: [
  { path: 'src/guard.js', line: 2, side: 'RIGHT', body: 'O filtro precisa usar a empresa autenticada.' } ] };
const legacy = { verdict: 'request_changes', decision: 'needs_decision', analysisStatus: 'complete',
  reportMarkdown: 'Prova interna.', reviewMarkdown: payload.body, findings: [{ severity: 'blocking', evidence: 'src/guard.js:2' }],
  payloads: { request_changes: payload, approve: { event: 'APPROVE', body: 'Alternativa descartada.', comments: [] } } };
const candidate = () => ({ verdict: legacy.verdict, decision: legacy.decision, analysisStatus: legacy.analysisStatus,
  reportMarkdown: legacy.reportMarkdown, findings: structuredClone(legacy.findings), reviewOutputVersion: 1,
  review: structuredClone(payload) });

test('replay prova preservação do resultado escolhido, sem alegar qualidade de uma execução nova', () => {
  const report = compareReviewOutput(legacy);
  assert.equal(report.lossless, true);
  assert.ok(report.bytesAfter < report.bytesBefore);
  assert.equal(report.decisionQualityMeasured, false);
});

test('perder achado, aviso de tela, comentário ou texto público reprova o replay', () => {
  const noFinding = candidate(); noFinding.findings = [];
  assert.equal(compareReviewOutput(legacy, noFinding).lossless, false);
  const noComment = candidate(); noComment.review.comments = [];
  assert.equal(compareReviewOutput(legacy, noComment).lossless, false);
  const otherBody = candidate(); otherBody.review.body = 'Tudo certo.';
  assert.equal(compareReviewOutput(legacy, otherBody).lossless, false);
  assert.equal(compareReviewOutput({ ...legacy, reviewMarkdown: 'Ressalva adicional para a tela.' }).sameDisplay, false);
});
