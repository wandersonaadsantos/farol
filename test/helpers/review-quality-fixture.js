import { reviewHash, corpusHash } from '../../tools/review-quality/contract.js';

const target = { repo: 'fixture/project', base: 'a'.repeat(40), head: 'b'.repeat(40) };
const controls = ['anchor', 'supersession', 'presence', 'projection'];
function qualityFixture() {
  const corpus = { schema: 1, repetitions: 3, cases: [{ id: 'recovery', target, oracleSha256: 'd'.repeat(64), controls }] };
  const review = 'A âncora impede a retomada. A decisão anterior continua aberta. A presença aguarda o envio. A tela perde a marca de CI.';
  function batch(variant, total) {
    return { schema: 1, variant, runs: [1, 2, 3].map(repetition => ({
      id: `${variant}-${repetition}`, executionId: `${variant}-provider-${repetition}`, repetition,
      caseId: 'recovery', target: { ...target }, status: 'complete', model: 'same-model', effort: 'same-effort', cliSha256: 'c'.repeat(64), contextSha256: 'e'.repeat(64), review,
      tokens: { source: 'result.modelUsage', scope: 'tree', input: 10, output: 10, cacheRead: total - 30, cacheCreation: 10 },
      assessment: { method: 'source-and-reproduction', status: 'complete', reviewSha256: reviewHash(review), corpusSha256: corpusHash(corpus),
        controls: controls.map(id => ({ id, status: 'detected', evidence: [{ quote: review,
          source: { path: 'src/flow.js', start: 1, end: 2, commit: target.head } }] })),
        checks: { coverage: 'verified', evidence: 'verified', classification: 'verified', publication: 'verified', claims: 'verified' },
        falsePositives: 0, unsupportedClaims: 0 }
    })) };
  }
  return { corpus, baseline: batch('baseline', 100), candidate: batch('candidate', 80) };
}
export { qualityFixture };
