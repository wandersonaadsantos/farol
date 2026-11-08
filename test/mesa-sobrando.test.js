// Os três caminhos que ainda iam à mesa com a conta decidindo sozinha (08/11/2026, ordem do dono:
// "se eu deixei pra aprovar sozinho ele deve aprovar sozinho"):
//   1. pedido de mudanças sustentado só pelo CI, com a espera do CI desligada;
//   2. conflito declarado pela revisão que o GitHub desmente;
//   3. análise que não fecha no teto de rodadas do commit.
// Nos três a decisão volta à política da conta, com ressalva dizendo por quê.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-mesa-sobrando-'));
process.env.FAROL_HOME = path.join(root, 'home');
const { TOOL } = await import('../lib/technical-review/verdict.js');
const { attentionPoints } = await import('../lib/engine/ressalvas.js');
const { shouldAutoApprove, shouldAutoReject } = await import('../lib/engine/approval-policy.js');
const { acaoAoAprovar } = await import('../lib/engine/contas-config.js');
const { estadosDoPedido, aprovarSemOEstado, aplicarEstadoDesmentido } = await import('../lib/engine/estado-desmentido.js');
const busca = await import('../lib/engine/busca-da-prova.js');
const { publicReviewLanguageIssues } = await import('../lib/engine/public-review.js');
after(() => fs.rmSync(root, { recursive: true, force: true }));

const head = 'a'.repeat(40);
const gateReason = (text) => ({ text, kind: 'gate' });
function report(extra = {}) {
  return { schema: 1, version: TOOL.version, toolCommit: TOOL.commit, repo: 'org/repo',
    base: 'b'.repeat(40), head, profile: 'profile', catalogFingerprint: 'catalog',
    humanReviewFingerprint: 'human', verdict: 'pass', rules: [{ rule: 'core.file.single-responsibility', verdict: 'pass' }], findings: [], ...extra };
}
function base(extra = {}) {
  return { analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true,
    headSha: head, checksVerifiedHead: head, checksObrigatorios: [], technicalReview: report(), reasons: [],
    diffMedido: ['a.md'], coverage: { total: 1, reviewed: ['a.md'], missing: [] },
    verificationCheckpoint: { total: 0, conflicts: [] }, protocolo: { prReviewer: 'rodou' },
    payloads: { approve: { event: 'APPROVE', body: 'O comportamento foi conferido.' } }, ...extra };
}
const CI_VERMELHO = [{ nome: 'build', estado: 'vermelho' }];
const PEDIDO_RC = { event: 'REQUEST_CHANGES', body: 'Os checks obrigatórios `build` estão falhando no commit aaaaaaa.' };
function soPeloCi(extra = {}) {
  return base({ verdict: 'request_changes', decision: 'needs_decision', checksObrigatorios: CI_VERMELHO,
    payloads: { request_changes: PEDIDO_RC }, findings: [], ...extra });
}
const achado = (causa, extra = {}) => ({ severity: 'blocking', title: 'Bloqueio', summary: 'resumo', causa, file: 'a.md', line: 1, ...extra });
function engineCom({ onCaveats = 'approve', ciDecide = false, decisions } = {}) {
  const e = { accountForPr: () => 'reviewer', attentionPoints: (r) => attentionPoints(null, r),
    accountList: () => [{ user: 'reviewer', onClean: 'approve', onCaveats, onReject: 'request_changes' }],
    config: { aguardarCiParaAprovar: ciDecide }, decisions: decisions || { pending: [] }, tokenFor: () => null };
  e.approvePolicyFor = (user, limpo) => acaoAoAprovar(e, user, limpo);
  e.rejectPolicyFor = () => 'request_changes';
  return e;
}
const PR = { key: 'org/repo#1', repo: 'org/repo', number: 1, requested: true };

test('1: pedido só pelo CI com a espera desligada vira aprovação pela política, com ressalva', () => {
  const e = engineCom();
  const r = soPeloCi();
  assert.equal(shouldAutoReject(e, PR, r), false, 'antes: o pedido não saía sozinho');
  assert.deepEqual(estadosDoPedido(e, r), { ci: true, conflito: false });
  aprovarSemOEstado(r, estadosDoPedido(e, r), gateReason);
  assert.equal(r.verdict, 'approve');
  assert.equal(r.payloads.approve.event, 'APPROVE');
  assert.deepEqual(publicReviewLanguageIssues(r.payloads.approve, 'reviewer'), [], 'o texto do app passa a trava de linguagem');
  assert.ok(attentionPoints(null, r).some((p) => /pediu mudanças só pelo CI obrigatório, com a espera do CI desligada/.test(p.text)));
  assert.deepEqual(shouldAutoApprove(e, PR, r), { ok: true, motivo: null });
  assert.deepEqual(shouldAutoApprove(engineCom({ onCaveats: 'wait' }), PR, r), { ok: false, motivo: 'politica' }, 'a conta em espera continua levando à mesa');
});

test('1: bloqueio declarado com causa ci vira sugestão e retira o que vinha de rodada anterior', () => {
  const e = engineCom();
  const r = soPeloCi({ findings: [achado('ci'), achado('ci', { ref: 'r1:f1', status: 'persiste' })] });
  aprovarSemOEstado(r, estadosDoPedido(e, r), gateReason);
  assert.deepEqual(r.findings.map((f) => [f.severity, f.status || null]), [['suggestion', null], ['suggestion', 'retirado']]);
  assert.deepEqual(shouldAutoApprove(e, PR, r), { ok: true, motivo: null });
});

test('1: texto de aprovação escrito pela revisão é preservado', () => {
  const r = soPeloCi({ payloads: { request_changes: PEDIDO_RC, approve: { event: 'APPROVE', body: 'Texto da revisão.' } } });
  aprovarSemOEstado(r, estadosDoPedido(engineCom(), r), gateReason);
  assert.equal(r.payloads.approve.body, 'Texto da revisão.');
});

test('1: com a espera do CI ligada, defeito provado, outra causa ou análise incompleta, nada muda', () => {
  assert.equal(estadosDoPedido(engineCom({ ciDecide: true }), soPeloCi()), null, 'CI ligado: a espera do CI decide');
  assert.equal(estadosDoPedido(engineCom(), soPeloCi({ findings: [achado('ci'), achado('defeito_codigo')] })), null);
  assert.equal(estadosDoPedido(engineCom(), soPeloCi({ findings: [achado('dependencia')] })), null);
  assert.equal(estadosDoPedido(engineCom(), soPeloCi({ technicalReview: report({ verdict: 'fail' }) })), null);
  assert.equal(estadosDoPedido(engineCom(), soPeloCi({ analysisStatus: 'incomplete' })), null);
  assert.equal(estadosDoPedido(engineCom(), soPeloCi({ checksObrigatorios: [] })), null, 'sem CI vermelho e sem bloqueio, não é pedido só pelo CI');
  assert.equal(estadosDoPedido(engineCom(), base()), null, 'aprovação não é tocada');
});

test('2: conflito declarado só vira aprovação com o GitHub dizendo MERGEABLE', async () => {
  const e = engineCom();
  const r = soPeloCi({ checksObrigatorios: [], findings: [achado('conflito')] });
  assert.deepEqual(estadosDoPedido(e, r), { ci: false, conflito: true });
  assert.equal(await aplicarEstadoDesmentido(e, PR, r, gateReason), false, 'leitura indisponível não desmente');
  assert.equal(r.verdict, 'request_changes');
  aprovarSemOEstado(r, { ci: false, conflito: true }, gateReason);
  assert.match(r.payloads.approve.body, /não aponta conflito com a base/);
  assert.ok(attentionPoints(null, r).some((p) => /conflito com a base que o GitHub não confirma/.test(p.text)));
  assert.deepEqual(shouldAutoApprove(e, PR, r), { ok: true, motivo: null });
});

// 3: o teto de rodadas do commit
function pendenteComTentativas(n) {
  return { pending: [{ key: PR.key, headSha: head, esperaProva: { tentativas: n } }] };
}
test('3: a rodada que chega ao teto do commit é reconhecida pela marca da recuperação', () => {
  const MAX = busca.MAX_TENTATIVAS_POR_HEAD;
  assert.equal(busca.rodadaNoTeto(engineCom({ decisions: pendenteComTentativas(MAX - 1) }), PR, base()), true);
  assert.equal(busca.rodadaNoTeto(engineCom({ decisions: pendenteComTentativas(MAX - 2) }), PR, base()), false);
  assert.equal(busca.rodadaNoTeto(engineCom(), PR, base()), false, 'sem marca anterior não há teto');
  const mesa = { pending: [{ key: PR.key, headSha: head, tentativasDaProva: MAX }] };
  assert.equal(busca.rodadaNoTeto(engineCom({ decisions: mesa }), PR, base()), true, 'o clique depois do teto também decide');
  assert.equal(busca.rodadaNoTeto(engineCom({ decisions: pendenteComTentativas(MAX - 1) }), PR, base({ headSha: 'c'.repeat(40) })), false, 'outro commit recomeça');
});

test('3: no teto, a análise que não fechou vira ressalva e a política decide', () => {
  const e = engineCom({ decisions: pendenteComTentativas(busca.MAX_TENTATIVAS_POR_HEAD - 1) });
  const r = base({ analysisStatus: 'incomplete', decision: 'needs_decision' });
  const exigidas = busca.lacunasDaRodada(e, PR, r);
  assert.equal(r.provaNoTeto, true);
  assert.ok(!exigidas.includes('análise incompleta'));
  r.approvalEvidence = exigidas;
  r.reasons = busca.pontosDaProvaEsgotada(r);
  assert.ok(r.reasons.some((p) => /depois de 6 revisões neste commit a análise não fechou, então segue como ressalva: análise incompleta/.test(p.text)));
  assert.deepEqual(shouldAutoApprove(e, PR, r), { ok: true, motivo: null });
  assert.deepEqual(shouldAutoApprove(engineCom({ onCaveats: 'wait', decisions: pendenteComTentativas(5) }), PR, r), { ok: false, motivo: 'politica' });
});

test('3: antes do teto a análise incompleta segue exigida, e no teto a violação também', () => {
  const antes = engineCom({ decisions: pendenteComTentativas(1) });
  const r = base({ analysisStatus: 'incomplete' });
  assert.ok(busca.lacunasDaRodada(antes, PR, r).includes('análise incompleta'));
  assert.equal(r.provaNoTeto, undefined);
  assert.equal(shouldAutoApprove(antes, PR, r).motivo, 'analise_incompleta');
  const noTeto = engineCom({ decisions: pendenteComTentativas(5) });
  const comViolacao = base({ analysisStatus: 'incomplete', technicalReview: report({ verdict: 'fail' }) });
  assert.ok(busca.lacunasDaRodada(noTeto, PR, comViolacao).length > 0, 'violação confirmada nunca sai como APPROVE');
  // a publicação recusa a avaliação técnica ausente de novo: dispensá-la no teto faria um laço de reconferência
  const semAvaliacao = base({ analysisStatus: 'incomplete', technicalReview: null });
  assert.ok(busca.lacunasDaRodada(noTeto, PR, semAvaliacao).includes('avaliação técnica atual ausente'), 'no teto a avaliação ausente segue exigida');
  assert.notDeepEqual(shouldAutoApprove(noTeto, PR, semAvaliacao), { ok: true, motivo: null });
});
