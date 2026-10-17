// Critério do card só na parte deste PR, e dependência aberta como ressalva (17/10/2026).
//
// Decisão do dono: "critério do card só na parte deste PR e dependência aberta viram
// ressalva; CI vermelho, violação técnica e lacuna de leitura seguem bloqueando."
// Medido no admin: card BIUD costuma ser multi-repo (waba#52 provado no código,
// messaging-api#349 e tenant-company#186/#187 ainda abertos). Com o card inteiro e a
// dependência aberta como lacuna obrigatória (PR #244, v2.72.2), um PR irmão esperava o
// outro e nenhum era aprovado sozinho. Aqui fica travado o desenho novo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-card-parte-'));
process.env.FAROL_HOME = path.join(root, 'home');
const { TOOL } = await import('../lib/technical-review/verdict.js');
const { approvalGaps } = await import('../lib/technical-review/evidence.js');
const { attentionPoints } = await import('../lib/engine/ressalvas.js');
const { shouldAutoApprove } = await import('../lib/engine/approval-policy.js');
after(() => fs.rmSync(root, { recursive: true, force: true }));

const head = 'a'.repeat(40);
const GAP_DA_PARTE = 'a parte do card que cabe a este PR não foi comprovada';
function report(extra = {}) {
  return { schema: 1, version: TOOL.version, toolCommit: TOOL.commit, repo: 'org/repo',
    base: 'b'.repeat(40), head, profile: 'profile', catalogFingerprint: 'catalog',
    humanReviewFingerprint: 'human', verdict: 'pass', rules: [{ rule: 'core.file.single-responsibility', verdict: 'pass' }], findings: [], ...extra };
}
// o caso medido: card lido, a parte deste PR provada, o card inteiro não, irmãos abertos
function multiRepo(extra = {}) {
  return { analysisStatus: 'complete', verdict: 'approve', decision: 'needs_decision',
    card: 'CARD-1', cardMet: null, cardParteDestePr: true,
    dependenciasAbertas: ['biudtech/biud-messaging-api#349 ainda aberto', 'biudtech/tenant-company#186 ainda aberto'],
    headSha: head, checksVerifiedHead: head, checksObrigatorios: [], technicalReview: report(), reasons: [],
    diffMedido: ['a.md'], coverage: { total: 1, reviewed: ['a.md'], missing: [] },
    verificationCheckpoint: { total: 0, conflicts: [] }, protocolo: { prReviewer: 'rodou' },
    payloads: { approve: { event: 'APPROVE', body: 'O comportamento foi conferido.' } }, ...extra };
}
function engineCom(onCaveats) {
  return { accountForPr: () => 'reviewer', attentionPoints: (r) => attentionPoints(null, r),
    approvePolicyFor: (_conta, limpo) => (limpo ? 'approve' : onCaveats) };
}
const PEDIDO = { requested: true };

test('card inteiro não provado e dependência aberta não são lacuna obrigatória quando a parte deste PR está provada', () => {
  assert.deepEqual(approvalGaps(multiRepo()), []);
  assert.deepEqual(approvalGaps(multiRepo({ cardMet: false })), []);
});

test('parte deste PR sem declaração (null ou ausente) não bloqueia', () => {
  assert.deepEqual(approvalGaps(multiRepo({ cardParteDestePr: null })), []);
  const semCampo = multiRepo();
  delete semCampo.cardParteDestePr;
  assert.deepEqual(approvalGaps(semCampo), []);
});

test('card ilegível no Jira (cardMet false forçado pelo app, sem card) segue ressalva, não lacuna', () => {
  const r = multiRepo({ card: undefined, cardMet: false, cardParteDestePr: null, dependenciasAbertas: [] });
  assert.deepEqual(approvalGaps(r), []);
  assert.ok(attentionPoints(null, r).some((p) => /card não foi totalmente comprovado/.test(p.text)));
});

test('a sessão dizendo que a parte DESTE PR não foi entregue bloqueia o APPROVE', () => {
  const r = multiRepo({ cardParteDestePr: false });
  assert.deepEqual(approvalGaps(r), [GAP_DA_PARTE]);
  assert.equal(shouldAutoApprove(engineCom('approve'), PEDIDO, r).motivo, 'prova_tecnica_incompleta');
  assert.deepEqual(approvalGaps(multiRepo({ cardParteDestePr: 'false' })), [], 'só o booleano falso bloqueia, como o cardMet');
});

test('as ressalvas nomeiam o card e a dependência', () => {
  const textos = attentionPoints(null, multiRepo()).map((p) => p.text);
  assert.ok(textos.some((t) => /parte deste PR no card foi comprovada/.test(t)), textos.join(' | '));
  assert.ok(textos.some((t) => /biud-messaging-api#349 ainda aberto/.test(t)), textos.join(' | '));
  const semParte = attentionPoints(null, multiRepo({ cardMet: false })).map((p) => p.text);
  assert.ok(semParte.some((t) => /card não foi totalmente comprovado/.test(t)), semParte.join(' | '));
  assert.equal(attentionPoints(null, multiRepo({ cardMet: true, dependenciasAbertas: [], decision: 'auto_approve' })).length, 0, 'card provado e nada aberto é limpo');
});

test('a política de ressalvas da conta decide: aprova sozinho com "aprovar", espera com "esperar"', () => {
  assert.deepEqual(shouldAutoApprove(engineCom('approve'), PEDIDO, multiRepo()), { ok: true, motivo: null });
  assert.deepEqual(shouldAutoApprove(engineCom('wait'), PEDIDO, multiRepo()), { ok: false, motivo: 'politica' });
});

test('CI vermelho e violação técnica continuam bloqueando o mesmo caso multi-repo', () => {
  const ci = multiRepo({ checksObrigatorios: [{ nome: 'test', estado: 'vermelho' }] });
  assert.equal(shouldAutoApprove(engineCom('approve'), PEDIDO, ci).motivo, 'ci_vermelho');
  const violacao = multiRepo({ technicalReview: report({ verdict: 'fail', findings: [{ file: 'a.ts', message: 'regra duplicada' }] }) });
  assert.ok(approvalGaps(violacao).includes('violação técnica confirmada'));
  assert.equal(shouldAutoApprove(engineCom('approve'), PEDIDO, violacao).motivo, 'prova_tecnica_incompleta');
  const leitura = multiRepo({ coverage: { total: 1, reviewed: [], missing: ['a.md'] } });
  assert.equal(shouldAutoApprove(engineCom('approve'), PEDIDO, leitura).motivo, 'prova_tecnica_incompleta');
});
