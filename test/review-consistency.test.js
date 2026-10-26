import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-coerencia-'));
process.env.FAROL_HOME = home;
const { reviewCoherenceGap, payloadCoherenceGap } = await import('../lib/engine/review-consistency.js');
const { lacunasExigidas } = await import('../lib/engine/busca-da-prova.js');
const { REVIEW_COHERENCE_GAP } = await import('../lib/technical-review/verdict.js');
after(() => { assert.ok(home.startsWith(os.tmpdir())); fs.rmSync(home, { recursive: true, force: true }); });

const blocker = { severity: 'blocking', title: 'Perda de dados', summary: 'Grava antes de validar.', file: 'src/a.js', line: 2, evidence: 'A gravação antecede o guard.' };
const suggestion = { ...blocker, severity: 'suggestion', title: 'Mensagem mais clara' };
const result = (verdict, findings) => ({ verdict, findings, payloads: { [verdict]: {
  event: verdict === 'approve' ? 'APPROVE' : 'REQUEST_CHANGES', body: verdict === 'approve' ? 'Sem defeito bloqueante.' : 'Valide antes de gravar para evitar perda de dados.',
} } });

test('mérito e classificação concordam, sem transformar uma ação na outra', () => {
  const rejected = result('request_changes', [suggestion]);
  const before = structuredClone(rejected);
  assert.equal(reviewCoherenceGap(rejected), REVIEW_COHERENCE_GAP);
  assert.deepEqual(rejected, before, 'o gate não reescreve nem aprova o resultado');
  assert.equal(reviewCoherenceGap(result('approve', [suggestion])), '');
  assert.equal(reviewCoherenceGap(result('request_changes', [blocker])), '');
  assert.equal(reviewCoherenceGap(result('approve', [blocker])), REVIEW_COHERENCE_GAP);
  assert.equal(reviewCoherenceGap(result('request_changes', [{ ...blocker, status: 'resolvido', ref: 'anterior' }])), REVIEW_COHERENCE_GAP);
});

test('ausência legada e memória incerta não são declaração de zero blockers', () => {
  const legacy = result('request_changes', undefined);
  assert.equal(reviewCoherenceGap(legacy), '');
  legacy.roundReview = { schema: 1, unresolvedCount: 0, integrity: ['findings legacy'] };
  assert.equal(reviewCoherenceGap(legacy), '');
  legacy.roundReview.integrity = [];
  assert.equal(reviewCoherenceGap(legacy), REVIEW_COHERENCE_GAP);
  legacy.roundReview.unresolvedCount = 1;
  assert.equal(reviewCoherenceGap(legacy), '', 'blocker persistente continua sustentando reprovação');
});

test('falha interna não sustenta reprovação e incoerência nunca vira ressalva por esgotamento', () => {
  const r = { ...result('request_changes', [suggestion]), provaEsgotada: true, technicalReview: { verdict: 'not-run', failure: 'material' } };
  assert.equal(reviewCoherenceGap(r), REVIEW_COHERENCE_GAP);
  assert.ok(lacunasExigidas(r).includes(REVIEW_COHERENCE_GAP));
  assert.equal(r.verdict, 'request_changes');
});

test('defeito confirmado e parte do card não entregue continuam impedimentos reais', () => {
  assert.equal(reviewCoherenceGap({ ...result('request_changes', []), technicalReview: { verdict: 'fail' } }), '');
  assert.equal(reviewCoherenceGap({ ...result('request_changes', []), cardParteDestePr: false }), '');
  const r = { ...result('approve', []), technicalReview: { verdict: 'fail' } };
  r.payloads.request_changes = { event: 'REQUEST_CHANGES', body: 'Não encontrei nada bloqueante no código.' };
  assert.equal(reviewCoherenceGap(r), REVIEW_COHERENCE_GAP, 'mudança de ação pelo motor não autoriza texto contraditório');
});

test('texto público contraditório é recusado; CI vermelho explicado e citações continuam válidos', () => {
  for (const body of ['Não encontrei nada bloqueante no código.', 'Sem blockers. Apenas sugestões.', 'Nada no código segura o merge.', 'No blocking issues found.', 'Na\u0303o encontrei nada bloqueante no co\u0301digo.']) {
    assert.equal(payloadCoherenceGap({ event: 'REQUEST_CHANGES', body }), REVIEW_COHERENCE_GAP, body);
  }
  for (const body of ['Não encontrei nada bloqueante no código, mas os checks obrigatórios estão falhando.', '> Não encontrei nada bloqueante no código.\n\nEssa conclusão anterior estava errada: valide antes de gravar.', 'Há perda de dados. A sugestão de nome é opcional.', '```txt\nSem blockers\n```\nValide antes de gravar.']) {
    assert.equal(payloadCoherenceGap({ event: 'REQUEST_CHANGES', body }), '', body);
  }
  assert.equal(payloadCoherenceGap({ event: 'REQUEST_CHANGES', body: 'Sem blockers. CI em andamento.' }), REVIEW_COHERENCE_GAP);
  assert.equal(payloadCoherenceGap({ event: 'COMMENT', body: 'Sem blockers. Apenas sugestões.' }), '');
});

test('área sem defeito não é afirmação de ausência global de blockers', () => {
  const r = result('request_changes', [blocker]);
  r.payloads.request_changes.body = 'Não encontrei nada bloqueante no código de autenticação. Porém, o pagamento grava antes de validar o saldo.';
  assert.equal(payloadCoherenceGap(r.payloads.request_changes), '');
  assert.equal(reviewCoherenceGap(r), '');
});

test('arquivo entre crases preserva o escopo da conclusão', () => {
  const r = result('request_changes', [blocker]);
  r.payloads.request_changes.body = 'Não encontrei nada bloqueante no código `src/auth.js`. Porém, o pagamento grava antes de validar o saldo.';
  assert.equal(payloadCoherenceGap(r.payloads.request_changes), '');
  assert.equal(reviewCoherenceGap(r), '');
});

test('CI obrigatório vermelho confirmado no mesmo head sustenta reprovação sem finding de código', () => {
  const body = 'Não encontrei nada bloqueante no código. Os checks obrigatórios estão falhando no commit abc1234.';
  const r = { ...result('request_changes', []), headSha: 'abc1234', checksVerifiedHead: 'abc1234', checksObrigatorios: [{ nome: 'test', estado: 'vermelho' }] };
  r.payloads.request_changes.body = body;
  assert.equal(reviewCoherenceGap(r), '');
  assert.equal(reviewCoherenceGap({ ...r, checksVerifiedHead: 'def5678' }), REVIEW_COHERENCE_GAP);
  assert.equal(reviewCoherenceGap({ ...r, checksVerifiedHead: null }), REVIEW_COHERENCE_GAP);
  assert.equal(reviewCoherenceGap({ ...r, checksObrigatorios: [{ nome: 'test', estado: 'rodando' }] }), REVIEW_COHERENCE_GAP);
  assert.equal(reviewCoherenceGap({ ...r, checksObrigatorios: [] }), REVIEW_COHERENCE_GAP);
  const approve = { ...r, verdict: 'approve', payloads: { approve: { event: 'APPROVE', body: 'Sem defeito bloqueante.' } } };
  assert.equal(reviewCoherenceGap(approve), '', 'CI não muda a ação do modelo neste gate; aprovação ainda depende do gate de CI');
});

test('menção histórica ou negada de CI não dá passe para uma contradição', () => {
  for (const body of ['Sem blockers. O CI não falhou.', 'Não encontrei nada bloqueante no código. O CI falhou antes, mas já passou no head atual.']) {
    assert.equal(payloadCoherenceGap({ event: 'REQUEST_CHANGES', body }), REVIEW_COHERENCE_GAP, body);
  }
});

test('CI obrigatório atual explicitado não depende da pontuação para justificar o pedido', () => {
  const body = 'Não encontrei nada bloqueante no código. Os checks obrigatórios estão falhando no commit abc1234; o merge precisa da pipe verde neste commit.';
  assert.equal(payloadCoherenceGap({ event: 'REQUEST_CHANGES', body }), '');
  assert.equal(payloadCoherenceGap({ event: 'REQUEST_CHANGES', body: body + ' O CI já passou no head atual.' }), REVIEW_COHERENCE_GAP);
  assert.equal(payloadCoherenceGap({ event: 'REQUEST_CHANGES', body: body.replace('estão falhando', 'não estão falhando') }), REVIEW_COHERENCE_GAP);
});

test('conclusão limitada por seção não vira afirmação global sobre o PR', () => {
  const body = '### Autenticação\nSem blockers.\n\n### Pagamentos\nA cobrança é gravada antes da validação; precisa corrigir.';
  const r = result('request_changes', [blocker]);
  r.payloads.request_changes.body = body;
  assert.equal(payloadCoherenceGap(r.payloads.request_changes), '');
  assert.equal(reviewCoherenceGap(r), '');
  assert.equal(payloadCoherenceGap({ event: 'REQUEST_CHANGES', body: 'Sem blockers.\n\n' + body }), REVIEW_COHERENCE_GAP);
  assert.equal(reviewCoherenceGap({ ...r, findings: [] }), REVIEW_COHERENCE_GAP, 'sem resumo não dispensa o gate estruturado');
  assert.equal(payloadCoherenceGap({ event: 'REQUEST_CHANGES', body: 'Autenticação\n---\nSem blockers.\n\nPagamentos\n---\nCorrija a gravação.' }), '');
});

test('títulos citados ou em código não delimitam resumo e explicação de CI pode ficar em seção', () => {
  for (const prefix of ['> ### Citação\n', '```md\n### Exemplo\n```\n']) {
    assert.equal(payloadCoherenceGap({ event: 'REQUEST_CHANGES', body: prefix + 'Sem blockers.\n\n### Detalhes\nSó ajustes.' }), REVIEW_COHERENCE_GAP);
  }
  assert.equal(payloadCoherenceGap({ event: 'REQUEST_CHANGES', body: 'Não encontrei nada bloqueante no código.\n\n### CI\nOs checks obrigatórios estão falhando no commit abc1234.' }), '');
});
