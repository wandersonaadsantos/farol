// Unidades do engine isolam a fronteira da ferramenta privada. Os testes dedicados
// exercitam o gate e a ferramenta real; os demais preservam seu objeto original.
import { TOOL } from '../../lib/technical-review/verdict.js';
import { technicalRuntime } from '../../lib/technical-review/runtime.js';
import { technicalPublication } from '../../lib/technical-review/publication.js';
import { Engine } from '../../server.js';

const HEAD = 'a'.repeat(40);
function technicalReport(head = HEAD, repo = 'o/r') {
  return { schema: 1, version: TOOL.version, toolCommit: TOOL.commit, repo,
    base: 'b'.repeat(40), head, profile: 'fixture', catalogFingerprint: 'fixture',
    humanReviewFingerprint: 'fixture', verdict: 'pass', rules: [{ rule: 'fixture', verdict: 'pass' }], findings: [] };
}

function provenResult(result = {}) {
  const head = result.headSha || HEAD;
  return { headSha: head, checksVerifiedHead: head, diffMedido: [],
    protocolo: { prReviewer: 'rodou' }, verificationCheckpoint: { total: 0, conflicts: [] },
    technicalReview: technicalReport(head), ...result };
}

function isolateTechnicalTool() {
  const original = { ...technicalRuntime };
  const publication = technicalPublication.approvalRefusal;
  const measured = Engine.prototype.fetchPrFiles;
  Engine.prototype.fetchPrFiles = async () => [];
  technicalPublication.approvalRefusal = async () => null;
  technicalRuntime.prepareTechnicalReview = async (engine, pr, head) => {
    const check = engine.bloqueadoPorChecks?.bind(engine);
    if (check) engine.bloqueadoPorChecks = async (...args) => ({ ...await check(...args), verifiedHead: head });
    return { repo: pr.repo, head, toolHome: 'fixture', snapshot: 'fixture',
      base: 'b'.repeat(40), initial: { rules: [], findings: [], excerpt: '' } };
  };
  technicalRuntime.finishTechnicalReview = async context => technicalReport(context.head, context.repo);
  return () => {
    Object.assign(technicalRuntime, original);
    technicalPublication.approvalRefusal = publication;
    Engine.prototype.fetchPrFiles = measured;
  };
}

export { technicalReport, provenResult, isolateTechnicalTool };
