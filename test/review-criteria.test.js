import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-criteria-'));
process.env.FAROL_HOME = home;
const { criteriaEvidence, criteriaPublicationRefusal, applyCriteriaEvidence, confirmCriteriaPersistence } = await import('../lib/engine/review-criteria.js');
const { rememberReview } = await import('../lib/technical-review/registry.js');
const { normalizeFindings } = await import('../lib/engine/review-findings.js');
const { postReview } = await import('../lib/engine/decision.js');
const { publishedCriteriaParents } = await import('../lib/engine/review-criteria-history.js');
const { finishRoundReview } = await import('../lib/engine/review-rounds.js');
const { readRounds, roundsPath, scopeFor } = await import('../lib/engine/review-round-store.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));
const finding = (extra = {}) => ({ id: 'prior', severity: 'suggestion', title: 'Turno', summary: 'Mistura regras',
  evidence: 'A: turno.js:3', criteria: { key: 'turno', criterion: 'Separar política', source: 'ARCH.md:1', scope: 'Diff do turno' }, ...extra });
const sources = { completa: false, itens: [] };
const review = (findings, extra = {}) => ({ headSha: 'B', verdict: 'approve', findings, ...extra });
const context = f => ({ criteriaParents: [{ findings: [f] }] });

test('metadata preservada pelo normalizador não mantém objetos arbitrários do modelo', () => {
  const raw = finding({ criteria: { ...finding().criteria, secreto: 'nao copiar' } });
  const f = normalizeFindings([raw]).findings[0];
  assert.equal(f.criteria.key, 'turno');
  assert.equal(f.criteria.secreto, undefined);
  assert.notEqual(f.criteria, raw.criteria);
});

test('renomear arquivo não muda identidade nem permite promoção sem nova prova', () => {
  const previous = finding();
  const f = finding({ file: 'outro.js', severity: 'blocking' });
  assert.match(criteriaEvidence(review([f]), context(previous), sources).issues.join(), /classificação sem nova evidência/);
  assert.equal(criteriaEvidence(review([finding({ file: 'outro.js' })]), context(previous), sources).ok, true);
});

test('regra/fonte alterada, duplicação e encerramento com a mesma evidência são recusados', () => {
  const previous = finding();
  assert.equal(criteriaEvidence(review([finding({ criteria: { ...previous.criteria, source: 'outra.md:2' } })]), context(previous), sources).ok, false);
  assert.equal(criteriaEvidence(review([finding(), finding()]), context(previous), sources).ok, false);
  assert.equal(criteriaEvidence(review([finding({ status: 'retirado' })]), context(previous), sources).ok, false);
  assert.equal(criteriaEvidence(review([finding({ status: 'retirado', evidence: 'B: chamada demonstrou que avaliação anterior estava errada' })]), context(previous), sources).ok, true);
});

test('todas as fronteiras publicadas concorrentes precisam de justificativa', () => {
  const a = finding(), b = finding({ id: 'outra', criteria: { ...finding().criteria, criterion: 'Outra regra' } });
  const r = criteriaEvidence(review([finding({ ref: a.id })]), { criteriaParents: [{ findings: [a] }, { findings: [b] }] }, sources);
  assert.equal(r.ok, false);
  assert.match(r.issues.join(), /mudança de critério/);
});

test('critérios ausentes/inválidos não são preenchidos como se houvesse evidência', () => {
  assert.equal(criteriaEvidence(review([finding({ criteria: null })]), {}, sources).ok, false);
  assert.equal(criteriaEvidence(review([{ severity: 'inventada' }]), {}, sources).ok, false);
});

test('nova sessão exige versão, listas explícitas e metadados; legado não é fonte de conformidade', () => {
  const strict = { criteriaContractRequired: true, criteriaParents: [] };
  assert.equal(criteriaEvidence(review([finding()]), strict, sources).ok, false);
  const valid = review([finding()], { criteriaVersion: 1, productDecisions: [] });
  assert.equal(criteriaEvidence(valid, strict, sources).ok, true);
  const missing = finding(); delete missing.criteria;
  assert.equal(criteriaEvidence({ ...valid, findings: [missing] }, strict, sources).ok, false);
  assert.equal(criteriaEvidence({ ...valid, findings: [finding({ severity: 'blocking', evidence: '' })] }, strict, sources).ok, false);
});

test('fronteira publicada atravessa tentativas pendentes sem ressuscitar apontamento resolvido', () => {
  const a = { id: 'A', parents: [], findings: [finding()] };
  const b = { id: 'B', parents: ['A'], findings: [finding({ severity: 'blocking' })] };
  const c = { id: 'C', parents: ['B'], findings: [finding({ status: 'resolvido', evidence: 'C: corrigido' })] };
  const decisions = { resolved: [{ roundId: 'A', status: 'auto_approved' }, { roundId: 'C', status: 'auto_approved' }] };
  const parents = publishedCriteriaParents([a, b, c], decisions);
  assert.deepEqual(parents.map(r => r.id), ['C']);
  assert.equal(criteriaEvidence(review([]), { criteriaParents: parents }, sources).ok, true);
  const attempt = { resolved: [{ roundId: 'B', status: 'pending' }, { roundId: 'A', status: 'auto_approved', postRetry: {} }] };
  assert.deepEqual(publishedCriteriaParents([a, b], attempt), []);
});

test('barreira de postagem lê evidência do engine, inclusive após recarregar pendência', async () => {
  const pr = { key: 'o/r#1', repo: 'o/r', number: 1, account: 'eu' };
  const engine = { config: {}, accountForPr: () => 'eu', log() {}, decisions: { pending: [] } };
  rememberReview(engine, pr, { criteriaEvidence: { ok: false, issues: ['fonte inventada'] } });
  assert.equal(criteriaPublicationRefusal(engine, pr).attempted, false);
  const r = await postReview(engine, pr, { event: 'REQUEST_CHANGES', body: 'Corrija o contrato.', commit_id: 'a'.repeat(40) });
  assert.equal(r.blocked, 'criterios_inconsistentes', 'nenhuma credencial/rede é necessária para recusar');
  engine.decisions.pending.push({ key: pr.key, criteriaEvidence: { ok: false, issues: ['fonte inventada'] } });
  engine.technicalApprovals.clear();
  assert.equal(criteriaPublicationRefusal(engine, pr).blocked, 'criterios_inconsistentes');
});

test('recomendação inválida não contamina o diário com blocker de análise incompleta', async () => {
  const pr = { key: 'o/r#20' }, scope = scopeFor(pr.key, 'eu');
  const ctx = { id: 'a'.repeat(32), scope, parents: [], headSha: 'B', baseSha: 'A', mode: 'enforce', criteriaContractRequired: true };
  const engine = { config: {}, log() {} };
  const result = review([finding({ severity: 'blocking', recommendation: { descricao: 'Trocar', estado: 'validada', headSha: 'B' } })],
    { analysisStatus: 'complete', criteriaVersion: 1, productDecisions: [] });
  applyCriteriaEvidence(result, ctx, sources);
  await finishRoundReview(engine, pr, ctx, { status: 'complete', files: [] }, result);
  assert.equal(result.analysisStatus, 'incomplete');
  assert.equal(readRounds(scope).rounds.length, 0);
});

test('falha de gravação local impede publicar mesmo em observação; roundId forjado não serve', async () => {
  const pr = { key: 'o/r#21' }, scope = scopeFor(pr.key, 'eu');
  const dir = roundsPath(scope);
  fs.mkdirSync(path.dirname(dir), { recursive: true }); fs.writeFileSync(dir, 'não é diretório');
  const ctx = { id: 'b'.repeat(32), scope, parents: [], headSha: 'B', baseSha: 'A', mode: 'observe', criteriaContractRequired: true };
  const engine = { config: {}, log() {} };
  const result = review([], { analysisStatus: 'complete', criteriaVersion: 1, productDecisions: [], roundId: ctx.id });
  applyCriteriaEvidence(result, ctx, sources);
  await finishRoundReview(engine, pr, ctx, { status: 'complete', files: [] }, result);
  confirmCriteriaPersistence(result, ctx);
  assert.equal(result.analysisStatus, 'incomplete');
  assert.equal(result.roundId, undefined);
  assert.match(result.criteriaEvidence.issues.join(), /não gravado/);
});
