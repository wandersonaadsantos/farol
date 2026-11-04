// Regra de organização não trava sozinha; o que afeta comportamento ou segurança segue travando.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { technicalGap, technicalSummary, relatorioComViolacao, ehDeOrganizacao, TOOL } from '../lib/technical-review/verdict.js';
import { criterioTecnicoHtml } from '../ui/pure/review.js';
import { technicalPrompt } from '../lib/technical-review/prompt.js';
import { debtVerdict } from '../lib/technical-review/debt.js';
import { publicTextLanguageIssues } from '../lib/engine/public-review.js';
import { reviewCoherenceGap } from '../lib/engine/review-consistency.js';

const SHA = 'a'.repeat(40);
const relatorio = (rules, extra = {}) => ({
  schema: 1, version: TOOL.version, toolCommit: TOOL.commit, repo: 'o/r', base: SHA, head: SHA, profile: 'p',
  humanReviewFingerprint: 'h', catalogFingerprint: 'c', verdict: rules.some(r => r.verdict === 'fail') ? 'fail' : 'pass',
  rules, findings: [], coverage: {}, ...extra,
});
const fail = rule => ({ rule, verdict: 'fail' });
const pass = rule => ({ rule, verdict: 'pass' });
const ORGANIZACAO = 'core.javascript.no-nested-ternary';

test('só regra de organização reprovada não é lacuna nem violação', () => {
  const r = relatorio([fail(ORGANIZACAO), fail('core.locality.promote-on-real-reuse'), pass('backend.output.sanitized')]);
  assert.equal(technicalGap(r), '');
  assert.equal(relatorioComViolacao(r), false);
  const resumo = technicalSummary(r);
  assert.equal(resumo.state, 'pass');
  assert.equal(resumo.violated, 0);
  assert.match(resumo.message, /2 regra\(s\) de organização seguem como sugestão/);
});

test('achado automático de regra de organização também não trava', () => {
  const r = relatorio([fail(ORGANIZACAO)], { findings: [{ rule: ORGANIZACAO, file: 'a.js', message: 'x' }] });
  assert.equal(technicalGap(r), '');
  assert.equal(relatorioComViolacao(r), false);
});

test('regra que afeta comportamento ou segurança segue bloqueando, sozinha ou junto de organização', () => {
  for (const regra of ['backend.output.sanitized', 'backend.input.checked-before-effect', 'backend.isolation.scope-required',
    'backend.delivery.idempotent-effect', 'backend.degradation.leaves-trace', 'backend.verification.inconclusive-is-not-pass',
    'core.testing.behavior-proof', 'core.testing.coverage-under-mocked-strategy', 'core.testing.e2e-without-mocks',
    'core.suppression.declared', 'frontend.design-system.canonical-source', 'core.duplication.business-rule',
    'core.javascript.modern-and-explicit', 'frontend.component.scalable-units']) {
    assert.equal(ehDeOrganizacao(regra), false, regra);
    assert.equal(technicalGap(relatorio([fail(regra)])), 'violação técnica confirmada', regra);
    assert.equal(technicalGap(relatorio([fail(regra), fail(ORGANIZACAO)])), 'violação técnica confirmada', regra);
    assert.equal(relatorioComViolacao(relatorio([fail(regra), fail(ORGANIZACAO)])), true, regra);
    assert.equal(technicalSummary(relatorio([fail(regra), fail(ORGANIZACAO)])).state, 'violation', regra);
  }
});

test('regra desconhecida, nova no catálogo, bloqueia', () => {
  for (const regra of ['core.nova.regra', '', undefined, 'constructor', 'CORE.JAVASCRIPT.NO-NESTED-TERNARY']) {
    assert.equal(technicalGap(relatorio([fail(regra)])), 'violação técnica confirmada', String(regra));
  }
});

test('achado sem regra ou de regra que bloqueia segue travando, mesmo com regra só de organização', () => {
  for (const achado of [{ file: 'a.js' }, { rule: 'backend.output.sanitized' }, null]) {
    const r = relatorio([fail(ORGANIZACAO)], { findings: [achado] });
    assert.equal(technicalGap(r), 'achados técnicos não resolvidos', JSON.stringify(achado));
    assert.equal(relatorioComViolacao(r), true, JSON.stringify(achado));
  }
});

test('reprovação sem regra por trás, como dívida agravada, segue bloqueando', () => {
  assert.equal(technicalGap(relatorio([pass(ORGANIZACAO)], { verdict: 'fail' })), 'violação técnica confirmada');
  assert.equal(relatorioComViolacao(relatorio([], { verdict: 'fail' })), true);
});

test('regra que não rodou segue inconclusiva, mesmo com organização reprovada', () => {
  const r = relatorio([fail(ORGANIZACAO), { rule: 'backend.output.sanitized', verdict: 'not-run' }]);
  assert.equal(technicalGap(r), 'avaliação técnica inconclusiva');
  assert.equal(technicalGap(relatorio([{ rule: 'backend.output.sanitized', verdict: 'not-run' }, { rule: ORGANIZACAO, verdict: 'not-run' }], { verdict: 'not-run' })), 'avaliação técnica inconclusiva');
});

test('regra de organização que não rodou não segura a aprovação', () => {
  assert.equal(technicalGap(relatorio([pass('backend.output.sanitized'), { rule: ORGANIZACAO, verdict: 'not-run' }], { verdict: 'not-run' })), '');
});

test('relatório sem rodar com erro ou falha não passa por regra de organização pendente', () => {
  const regras = [pass('backend.output.sanitized'), { rule: ORGANIZACAO, verdict: 'not-run' }];
  assert.notEqual(technicalGap(relatorio(regras, { verdict: 'not-run', error: 'ferramenta caiu' })), '');
  assert.notEqual(technicalGap(relatorio(regras, { verdict: 'not-run', failure: 'desconhecida' })), '');
});

test('erro no relatório, onde a dívida agravada fica, bloqueia mesmo com só organização reprovada', () => {
  for (const error of ['dívida anterior agravada pela entrega', 'comparação com a dívida anterior não comprovada']) {
    const r = relatorio([fail(ORGANIZACAO)], { error });
    assert.equal(technicalGap(r), 'violação técnica confirmada', error);
    assert.equal(relatorioComViolacao(r), true, error);
    assert.equal(technicalSummary(r).state, 'violation', error);
  }
});

test('veredito desconhecido não vale, mesmo com só organização reprovada', () => {
  for (const verdict of ['banana', undefined, null, 'not-run']) {
    assert.notEqual(technicalGap(relatorio([fail(ORGANIZACAO)], { verdict })), '', String(verdict));
  }
});

test('regra que bloqueia reprovada barra mesmo com o veredito geral dizendo que passou', () => {
  const r = relatorio([fail('backend.output.sanitized')], { verdict: 'pass' });
  assert.equal(technicalGap(r), 'violação técnica confirmada');
  assert.equal(relatorioComViolacao(r), true);
});

test('findings fora do formato segue travando', () => {
  assert.equal(technicalGap(relatorio([pass(ORGANIZACAO)], { findings: undefined })), 'achados técnicos não resolvidos');
});

test('reprovar sem blocker e só com organização é incoerente: o texto volta para recuperação', () => {
  const r = { verdict: 'request_changes', findings: [], roundReview: { schema: 1, unresolvedCount: 0, integrity: [] }, reviewMarkdown: 'x', payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'Precisa mudar.' } }, technicalReview: relatorio([fail(ORGANIZACAO)]) };
  assert.notEqual(reviewCoherenceGap(r), '');
  assert.equal(reviewCoherenceGap({ ...r, technicalReview: relatorio([fail('backend.output.sanitized')]) }), '');
});

test('o protocolo diz o mesmo nos quatro textos, e o exemplo de bloqueio não é de organização', () => {
  for (const arq of ['workspace-template/CLAUDE.md', 'workspace-template/prompts/pr-review-auto.md', 'workspace-template/prompts/self-review.md', 'workspace-template/.claude/agents/pr-reviewer.md']) {
    assert.match(fs.readFileSync(arq, 'utf8'), /salvo de regra de organização sem cenário concreto de falha/, arq);
  }
  assert.doesNotMatch(fs.readFileSync('lib/engine/review-prompt.js', 'utf8'), /alias canônico antes do merge/);
});

test('identidade do relatório continua valendo antes de qualquer regra', () => {
  assert.equal(technicalGap(relatorio([fail(ORGANIZACAO)]), { head: 'b'.repeat(40) }), 'avaliação técnica de outro commit');
});

test('dívida de regra de organização não trava; a das outras exige comparação', async () => {
  const contexto = regra => ({ base: SHA, head: SHA, profile: { baselines: [{ rule: regra, known: [`${regra}|a.js|violacao`] }] } });
  const resultado = regra => ({ changeSet: {}, rules: [{ rule: regra, verdict: 'pass', conhecidos: 1, acionadores: ['a.js'] }] });
  assert.equal(await debtVerdict(contexto(ORGANIZACAO), resultado(ORGANIZACAO), []), 'pass');
  assert.equal(await debtVerdict(contexto('backend.output.sanitized'), resultado('backend.output.sanitized'), []), 'not-run');
  const agravada = [{ rule: 'backend.output.sanitized', file: 'a.js', state: 'aggravated', confidence: 'alta', rationale: 'x', evidence: [] }];
  assert.equal(await debtVerdict(contexto('backend.output.sanitized'), resultado('backend.output.sanitized'), agravada), 'not-run', 'sem evidência segue sem autorizar');
});

test('aprovar com só organização reprovada é coerente', () => {
  const base = { verdict: 'approve', findings: [], reviewMarkdown: 'Tudo certo para seguir.', payloads: { approve: { event: 'APPROVE', body: 'Tudo certo para seguir.' }, request_changes: { event: 'REQUEST_CHANGES', body: '' } } };
  assert.equal(reviewCoherenceGap({ ...base, technicalReview: relatorio([fail(ORGANIZACAO)]) }), '');
});

test('o card só mostra o critério técnico quando ele informa algo além do veredito', () => {
  assert.equal(criterioTecnicoHtml(technicalSummary(relatorio([pass('backend.output.sanitized')]))), '');
  assert.equal(criterioTecnicoHtml(null), '');
  assert.match(criterioTecnicoHtml(technicalSummary(relatorio([fail(ORGANIZACAO)]))), /seguem como sugestão/);
  assert.match(criterioTecnicoHtml(technicalSummary(relatorio([fail('backend.output.sanitized')]))), /violação técnica confirmada/);
  assert.match(criterioTecnicoHtml(technicalSummary(relatorio([pass('a')], { rules: [{ rule: 'a', verdict: 'pass', conhecidos: 2 }] }))), /dívida anterior/);
});

test('o prompt nomeia as regras de organização e mantém o bloqueio das demais', () => {
  const texto = technicalPrompt({ toolHome: 't', snapshot: 's', repo: 'o/r', base: SHA, head: SHA, objections: [],
    initial: { rules: [{ rule: ORGANIZACAO, type: 'hard' }, { rule: 'backend.output.sanitized', type: 'judgment' }], findings: [], excerpt: '' } });
  const trecho = /Regras de organização: (.*?)\. Avalie-as/.exec(texto)?.[1] || '';
  assert.match(trecho, /no-nested-ternary/);
  assert.doesNotMatch(trecho, /backend\.output/);
  assert.match(texto, /vira sugestão não bloqueante/);
  assert.match(texto, /sem entrar em `reasons`/);
  assert.match(texto, /Todas as demais regras bloqueiam/);
});

test('frases de processo não saem no texto público; falar do código, sim', () => {
  for (const frase of ['As direções de correção não foram implementadas.', 'Isso não é um relato de falha executada.', 'Isto não é relato de falha.',
    'É uma exigência de organização, sem alegação de falha funcional.']) {
    assert.ok(publicTextLanguageIssues(frase).length > 0, frase);
  }
  for (const frase of ['O CI ainda está rodando.', 'A correção não foi aplicada em editorial-metadata-dialog.tsx:100.',
    'As validações de permissão não foram implementadas nem testadas neste fluxo.', 'As migrações novas não foram executadas nem testadas.',
    'As direções de correção não foram seguidas no segundo arquivo.', 'O script de CI consultado pelo deploy aponta para a branch errada.']) {
    assert.equal(publicTextLanguageIssues(frase).length, 0, frase);
  }
});
