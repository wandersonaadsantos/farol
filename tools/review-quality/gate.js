// Compara avaliações curadas; não tenta inferir qualidade por palavras ou quantidade de achados.
import { CHECKS, corpusHash, suiteInput, batchInput } from './contract.js';

function assessRun(run, expected) {
  const rejected = [], unknown = [], a = run.assessment;
  if (run.status !== 'complete' || !a || a.status !== 'complete') unknown.push('analysis-or-assessment-incomplete');
  for (const id of expected.controls) {
    const status = a?.controls.find(c => c.id === id)?.status;
    if (status === 'missed') rejected.push(`missed:${id}`);
    else if (status !== 'detected') unknown.push(`unverified:${id}`);
  }
  for (const key of CHECKS) {
    if (a?.checks[key] === 'violated') rejected.push(`violated:${key}`);
    else if (a?.checks[key] !== 'verified') unknown.push(`unverified:${key}`);
  }
  if (a?.falsePositives) rejected.push('false-positive');
  if (a?.unsupportedClaims) unknown.push('unsupported-claim');
  return { id: run.id, caseId: run.caseId, repetition: run.repetition, reviewSha256: run.reviewSha256, rejected, unknown };
}

function assessBatch(batch, suite) {
  const runs = batch.runs.map(r => assessRun(r, suite.cases.find(c => c.id === r.caseId)));
  const missing = suite.cases.flatMap(c => Array.from({ length: suite.repetitions }, (_, i) => i + 1)
    .filter(n => !batch.runs.some(r => r.caseId === c.id && r.repetition === n)).map(n => `${c.id}:${n}`));
  let status = 'passed';
  if (missing.length || runs.some(r => r.unknown.length)) status = 'inconclusive';
  if (runs.some(r => r.rejected.length)) status = 'rejected';
  return { variant: batch.variant, status, missing, runs };
}

function measurement(before, after, suite) {
  const pairs = [], reasons = [];
  for (const expected of suite.cases) {
    const a = before.runs.filter(r => r.caseId === expected.id), b = after.runs.filter(r => r.caseId === expected.id);
    if (a.length !== b.length) reasons.push('unpaired-repetitions');
    for (const candidate of b) {
      const reference = a.find(r => r.repetition === candidate.repetition);
      if (!reference) { reasons.push('missing-reference'); continue; }
      if (['model', 'effort', 'cliSha256'].some(k => reference[k] !== candidate[k])) reasons.push('runtime-mismatch');
      if (!reference.contextSha256 || !candidate.contextSha256) reasons.push('input-context-unverified');
      else if (reference.contextSha256 !== candidate.contextSha256) reasons.push('input-context-mismatch');
      if (!reference.tokens || !candidate.tokens || reference.status !== 'complete' || candidate.status !== 'complete') reasons.push('tokens-unmeasured');
      else pairs.push({ caseId: expected.id, repetition: candidate.repetition, before: reference.tokens.total, after: candidate.tokens.total });
    }
  }
  if (!pairs.length) reasons.push('no-measured-pairs');
  const beforeTotal = pairs.reduce((n, p) => n + p.before, 0), afterTotal = pairs.reduce((n, p) => n + p.after, 0);
  if (![beforeTotal, afterTotal].every(Number.isSafeInteger)) reasons.push('aggregate-out-of-range');
  const status = reasons.length ? 'inconclusive' : 'measured';
  const deltaPercent = beforeTotal && !reasons.length ? 100 * (afterTotal / beforeTotal - 1) : null;
  return { status, reasons: [...new Set(reasons)], pairs, beforeTotal, afterTotal, deltaPercent,
    subscriptionQuotaMeasured: false };
}

function compareReviewQuality(corpus, baseline, candidate) {
  const suite = suiteInput(corpus), before = batchInput(baseline, suite), after = batchInput(candidate, suite);
  const executionIds = [...before.runs, ...after.runs].map(r => r.executionId);
  if (new Set(executionIds).size !== executionIds.length || before.variant === after.variant) throw new Error('Execução ou variante reaproveitada na comparação.');
  const reference = assessBatch(before, suite), quality = assessBatch(after, suite), efficiency = measurement(before, after, suite);
  let status = quality.status;
  if (status === 'passed' && (reference.missing.length || reference.runs.some(r => r.unknown.length) || efficiency.status !== 'measured')) status = 'inconclusive';
  return { schema: 1, status, corpusSha256: corpusHash(suite), reference, candidate: quality, efficiency,
    eligibleForPilot: status === 'passed' && efficiency.afterTotal < efficiency.beforeTotal,
    automaticallyActivates: false, guaranteeOfGeneralQuality: false,
    assessmentBoundary: 'Confere identidade, vínculos e critérios da curadoria independente; não verifica entendimento semântico nem substitui essa curadoria.' };
}
export { compareReviewQuality };
