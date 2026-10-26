import test from 'node:test';
import assert from 'node:assert/strict';
import { compareReviewQuality } from '../tools/review-quality/gate.js';
import { reviewHash, corpusHash } from '../tools/review-quality/contract.js';
import { qualityFixture } from './helpers/review-quality-fixture.js';

const compare = f => compareReviewQuality(f.corpus, f.baseline, f.candidate);
test('todas as provas e repetições permitem somente piloto, sem ativar ou prometer qualidade geral', () => {
  const report = compare(qualityFixture());
  assert.equal(report.status, 'passed');
  assert.equal(report.eligibleForPilot, true);
  assert.equal(report.efficiency.beforeTotal, 300);
  assert.equal(report.efficiency.afterTotal, 240);
  assert.equal(report.automaticallyActivates, false);
  assert.equal(report.guaranteeOfGeneralQuality, false);
  assert.equal(report.efficiency.subscriptionQuotaMeasured, false);
});

test('perder qualquer controle reprova mesmo quando a referência também o perdeu', () => {
  for (let i = 0; i < 4; i++) {
    const f = qualityFixture();
    f.baseline.runs[0].assessment.controls[i].status = 'missed';
    f.candidate.runs[0].assessment.controls[i].status = 'missed';
    const report = compare(f);
    assert.equal(report.status, 'rejected');
    assert.equal(report.eligibleForPilot, false);
    assert.ok(report.candidate.runs[0].rejected.some(r => r.startsWith('missed:')));
  }
});

test('uma única repetição com regressão não é escondida por média ou economia', () => {
  const f = qualityFixture(); f.candidate.runs[2].assessment.checks.evidence = 'violated';
  assert.equal(compare(f).status, 'rejected');
  f.candidate.runs[2].assessment.checks.evidence = 'verified';
  f.candidate.runs[2].assessment.falsePositives = 1;
  assert.equal(compare(f).status, 'rejected');
});

test('análise, curadoria ou verificação incompleta jamais vira aprovação', () => {
  for (const mutate of [
    r => { r.status = 'incomplete'; },
    r => { r.assessment = null; },
    r => { r.assessment.status = 'incomplete'; },
    r => { r.assessment.controls.pop(); },
    r => { r.assessment.controls[0].status = 'inconclusive'; },
    r => { r.assessment.checks.publication = 'unverified'; },
    r => { r.assessment.unsupportedClaims = 1; }
  ]) {
    const f = qualityFixture(); mutate(f.candidate.runs[0]);
    assert.equal(compare(f).status, 'inconclusive');
    assert.equal(compare(f).eligibleForPilot, false);
  }
  const f = qualityFixture(); f.baseline.runs[0].assessment = null;
  assert.equal(compare(f).status, 'inconclusive');
});

test('faltam casos ou repetições: não há prova de economia com qualidade', () => {
  const f = qualityFixture(); f.baseline.runs.pop(); f.candidate.runs.pop();
  assert.equal(compare(f).status, 'inconclusive');
  f.baseline.runs = []; f.candidate.runs = [];
  assert.equal(compare(f).status, 'inconclusive');
  const other = qualityFixture(); other.candidate.runs.pop();
  assert.equal(compare(other).efficiency.status, 'inconclusive');
});

test('um caso inteiro ausente impede aprovação mesmo com os demais satisfeitos', () => {
  const f = qualityFixture();
  f.corpus.cases.push({ ...structuredClone(f.corpus.cases[0]), id: 'compatible', controls: ['compatible-contract'] });
  for (const batch of [f.baseline, f.candidate]) for (const run of batch.runs) run.assessment.corpusSha256 = corpusHash(f.corpus);
  const report = compare(f);
  assert.equal(report.status, 'inconclusive');
  assert.deepEqual(report.candidate.missing, ['compatible:1', 'compatible:2', 'compatible:3']);
  assert.equal(report.eligibleForPilot, false);
});

test('curadoria de outra review, fonte ou identidade não pode aprovar a execução', () => {
  for (const mutate of [
    r => { r.review += ' Editada após a curadoria.'; },
    r => { r.assessment.controls[0].evidence[0].quote = 'Trecho inventado na resposta.'; },
    r => { r.assessment.controls[0].evidence[0].source.commit = 'd'.repeat(40); },
    r => { r.target.head = 'd'.repeat(40); },
    r => { r.target.base = 'd'.repeat(40); },
    r => { r.target.repo = 'other/project'; },
    r => { r.assessment.method = 'model-self-report'; }
  ]) {
    const f = qualityFixture(); mutate(f.candidate.runs[0]);
    assert.throws(() => compare(f));
  }
});

test('detecção exige trecho real e fonte localizada mesmo após atualizar o hash', () => {
  const f = qualityFixture(); const r = f.candidate.runs[0];
  r.review = 'Sem problemas encontrados.'; r.assessment.reviewSha256 = reviewHash(r.review);
  assert.throws(() => compare(f), /Evidência/);
  const other = qualityFixture(); other.candidate.runs[0].assessment.controls[0].evidence = [];
  assert.throws(() => compare(other), /sem evidência/);
});

test('repetição ou sessão reaproveitada não aumenta a amostra', () => {
  const f = qualityFixture(); f.candidate.runs[1].executionId = f.candidate.runs[0].executionId;
  assert.throws(() => compare(f), /repetido/);
  const other = qualityFixture(); other.candidate.runs[0].executionId = other.baseline.runs[0].executionId;
  assert.throws(() => compare(other), /reaproveitada/);
  const third = qualityFixture(); third.candidate.runs[1].repetition = 1;
  assert.throws(() => compare(third), /repetido/);
});

test('reduzir o corpus depois da curadoria invalida o vínculo, em vez de melhorar a nota', () => {
  const f = qualityFixture(); f.corpus.cases[0].controls.pop();
  for (const batch of [f.baseline, f.candidate]) for (const run of batch.runs) run.assessment.controls.pop();
  assert.throws(() => compare(f), /outro corpus/);
  const other = qualityFixture(); other.corpus.cases[0].oracleSha256 = 'e'.repeat(64);
  assert.throws(() => compare(other), /outro corpus/);
});

test('modelo, esforço ou CLI diferente impedem atribuir economia à otimização', () => {
  for (const key of ['model', 'effort', 'cliSha256']) {
    const f = qualityFixture(); f.candidate.runs[0][key] = key === 'cliSha256' ? 'd'.repeat(64) : 'different';
    assert.equal(compare(f).status, 'inconclusive');
    assert.equal(compare(f).eligibleForPilot, false);
  }
});

test('mudar conta, política ou contexto comum não pode aparecer como economia da variante', () => {
  for (const value of [null, 'f'.repeat(64)]) {
    const f = qualityFixture(); f.candidate.runs[0].contextSha256 = value;
    assert.equal(compare(f).status, 'inconclusive');
    assert.equal(compare(f).eligibleForPilot, false);
  }
});

test('tokens parciais, ausentes ou ambíguos não comprovam economia', () => {
  const f = qualityFixture(); f.candidate.runs[0].tokens = null;
  assert.equal(compare(f).status, 'inconclusive');
  for (const mutate of [t => { t.scope = 'main-turn'; }, t => { t.source = 'result.usage'; },
    t => { t.output = -1; }, t => { t.cacheRead = Number.NaN; }]) {
    const other = qualityFixture(); mutate(other.candidate.runs[0].tokens);
    assert.throws(() => compare(other));
  }
});

test('qualidade satisfeita sem economia não recomenda a otimização', () => {
  const f = qualityFixture(); for (const r of f.candidate.runs) r.tokens.cacheRead = 100;
  assert.equal(compare(f).status, 'passed');
  assert.equal(compare(f).eligibleForPilot, false);
});

test('estouro do agregado não pode aparecer como medição confiável', () => {
  const f = qualityFixture();
  for (const run of f.candidate.runs) run.tokens.cacheRead = Number.MAX_SAFE_INTEGER - 30;
  assert.equal(compare(f).status, 'inconclusive');
  assert.equal(compare(f).efficiency.deltaPercent, null);
  assert.equal(compare(f).eligibleForPilot, false);
});
