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
const { publishedCriteriaParents, relatedCriteriaParents } = await import('../lib/engine/review-criteria-history.js');
const { finishRoundReview } = await import('../lib/engine/review-rounds.js');
const { readRounds, roundsPath, scopeFor, saveRound } = await import('../lib/engine/review-round-store.js');
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

test('PR relacionado exige mesmo card, site, conta e repositório confirmados e publicação efetiva', () => {
  const card = 'https://jira-a.example/browse/CARD-1';
  const cases = [
    ['ana', 'acme/app#1', card, 'auto_approved'],
    ['bia', 'acme/app#2', card, 'auto_approved'],
    ['ana', 'acme/other#3', card, 'auto_approved'],
    ['ana', 'acme/app#4', 'https://jira-b.example/browse/CARD-1', 'auto_approved'],
    ['ana', 'acme/app#5', card, 'pending'],
  ];
  const decisions = { resolved: [] };
  for (const [i, [account, key, url, status]] of cases.entries()) {
    const id = (i + 1).toString(16).repeat(32);
    const f = finding({ id: `${id}:f1`, criteria: { ...finding().criteria, card: url } });
    saveRound({ schema: 1, id, scope: scopeFor(key, account), parents: [], headSha: 'A', baseSha: 'base',
      at: i, findings: [f], unresolved: [], files: [] });
    decisions.resolved.push({ roundId: id, status });
  }
  const engine = { accountForPr: () => 'ana', decisions };
  const pr = { key: 'acme/app#9', repo: 'acme/app' };
  const history = relatedCriteriaParents(engine, pr, card);
  const related = history.parents;
  assert.equal(history.complete, true);
  assert.equal(related.length, 1);
  assert.equal(related[0].scope, 'ana|acme/app#1');
  assert.deepEqual(relatedCriteriaParents(engine, pr, ''), { parents: [], complete: null });
  const promoted = finding({ severity: 'blocking', evidence: 'Novo head' });
  assert.equal(criteriaEvidence(review([promoted]), { criteriaRelated: related }, sources).ok, false);
  assert.equal(criteriaEvidence(review([]), { criteriaRelated: related }, sources).ok, true, 'não obriga encerrar outro PR');
  const own = finding({ severity: 'blocking', criteria: { ...finding().criteria, criterion: 'Regra atual do próprio PR' } });
  const ownContext = { criteriaParents: [{ findings: [own] }], criteriaRelated: related };
  assert.equal(criteriaEvidence(review([own]), ownContext, sources).ok, true, 'outro PR não redefine critério próprio');
  const foreign = finding({ ref: related[0].findings[0].id, status: 'resolvido', evidence: 'Resolvido em outro PR' });
  assert.match(criteriaEvidence(review([foreign]), { criteriaRelated: related }, sources).issues.join(), /referência não pertence/);
  fs.writeFileSync(path.join(roundsPath(scopeFor('acme/app#4', 'ana')), 'bad.json'), 'corrompido');
  assert.equal(relatedCriteriaParents(engine, pr, card).complete, false, 'corrupção não significa ausência');
  assert.equal(fs.readFileSync(path.join(roundsPath(scopeFor('acme/app#4', 'ana')), 'bad.json'), 'utf8'), 'corrompido');
});

test('grafo relacionado incompleto impede afirmar continuidade e não libera veredito', () => {
  const card = 'https://jira-a.example/browse/CARD-2', id = 'd'.repeat(32);
  saveRound({ schema: 1, id, scope: scopeFor('outro/app#1', 'ana'), parents: ['e'.repeat(32)], headSha: 'A', baseSha: 'base',
    at: 1, findings: [finding({ id: `${id}:f1`, criteria: { ...finding().criteria, card } })], unresolved: [], files: [] });
  const engine = { accountForPr: () => 'ana', decisions: { resolved: [{ roundId: id, status: 'auto_approved' }] } };
  const related = relatedCriteriaParents(engine, { key: 'outro/app#2', repo: 'outro/app' }, card);
  assert.equal(related.complete, false);
  const r = criteriaEvidence(review([], { criteriaVersion: 1, productDecisions: [] }),
    { criteriaContractRequired: true, criteriaRelatedAvailable: related.complete }, sources);
  assert.match(r.issues.join(), /relacionados não verificável/);
});

test('card do achado persistido é atribuído pelo engine e não pelo modelo', async () => {
  const pr = { key: 'o/r#22' }, scope = scopeFor(pr.key, 'eu');
  const ctx = { id: 'c'.repeat(32), scope, parents: [], headSha: 'B', baseSha: 'A', mode: 'observe',
    criteriaCard: 'https://jira-a.example/browse/CARD-1' };
  const result = review([finding({ criteria: { ...finding().criteria, card: 'https://inventado.example/CARD-1' } })], { analysisStatus: 'complete' });
  await finishRoundReview({ config: {}, log() {} }, pr, ctx, { status: 'complete', files: [] }, result);
  assert.equal(readRounds(scope).rounds[0].findings[0].criteria.card, ctx.criteriaCard);
});
