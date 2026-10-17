import { profileFor, cadastroIlegivel } from './profiles.js';
import { technicalGap, requiredEvidenceGap } from './verdict.js';
import { publicationEvidence } from './registry.js';
import { technicalRuntime } from './runtime.js';
import { requestRecheck } from './recheck.js';

// Repositório sem declaração técnica (17/10/2026): não há avaliação a reconfirmar, então a
// recusa por isso saiu. Continua exigindo o commit confirmado, a prova gravada sem lacuna e
// os checks obrigatórios verdes NESTE commit, lidos agora.
async function semDeclaracaoRefusal(engine, pr, proof, payload) {
  let gap = requiredEvidenceGap(proof.evidence);
  if (!gap && !payload.commit_id) gap = 'aprovação sem commit confirmado';
  let waitForCi = false;
  if (!gap) {
    try {
      const checks = await engine.bloqueadoPorChecks(pr);
      if (checks?.verifiedHead !== payload.commit_id || !Array.isArray(checks.faltando) || checks.faltando.length) {
        gap = 'checks necessários à aprovação ainda não comprovados'; waitForCi = true;
      }
    } catch { gap = 'não foi possível reconfirmar os checks da aprovação'; }
  }
  return gap ? { ok: false, blocked: 'technical_review', attempted: false, error: gap, needsReview: false, waitForCi } : null;
}

async function approvalRefusal(engine, pr, payload) {
  if (payload.event !== 'APPROVE') return null;
  const repo = pr.repo || String(pr.key || '').split('#')[0];
  const proof = publicationEvidence(engine, pr);
  const profile = profileFor(repo);
  if (!profile && !cadastroIlegivel()) return semDeclaracaoRefusal(engine, pr, proof, payload);
  let needsReview = !!(proof.report && profile && (proof.report.profile !== profile.fingerprint));
  let gap = !profile && 'declaração técnica do repositório ausente';
  let waitForCi = false;
  if (!gap) gap = technicalGap(proof.report, { repo, head: payload.commit_id, profile: profile.fingerprint });
  if (!gap) gap = requiredEvidenceGap(proof.evidence);
  if (!gap && !payload.commit_id) gap = 'aprovação sem commit confirmado';
  if (!gap) {
    try {
      await technicalRuntime.requireTool();
      const target = await technicalRuntime.targetFor(engine, pr, proof.report.head);
      if (target.base !== proof.report.base) { gap = 'a base mudou depois da avaliação técnica'; needsReview = true; }
      const objections = await technicalRuntime.reviewSnapshot(engine, pr);
      if (!proof.report.humanReviewFingerprint || objections.fingerprint !== proof.report.humanReviewFingerprint) { gap = 'histórico de objeções mudou depois da revisão'; needsReview = true; }
      const checks = await engine.bloqueadoPorChecks(pr);
      if (checks?.verifiedHead !== proof.report.head || !Array.isArray(checks.faltando) || checks.faltando.length) {
        gap = 'checks necessários à aprovação ainda não comprovados'; waitForCi = true;
      }
    } catch { gap = 'não foi possível reconfirmar a avaliação técnica'; }
  }
  if (!gap) return null;
  if (needsReview) requestRecheck(engine, pr);
  return { ok: false, blocked: 'technical_review', attempted: false, error: gap, needsReview, waitForCi: waitForCi && !needsReview };
}

export { approvalRefusal };
export const technicalPublication = { approvalRefusal };
