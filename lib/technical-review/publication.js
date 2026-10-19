import { profileFor, cadastroIlegivel } from './profiles.js';
import { technicalGap, requiredEvidenceGap, legacyEvidenceGap, ehLacunaDura, relatorioComViolacao } from './verdict.js';
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

const SHA = /^[a-f0-9]{40}$/;

// O que a revisão leu ainda vale? Base e objeções, conferidas pelo que dá para conferir.
// - base: quando o relatório gravou a base (a avaliação chegou a preparar o material), ela tem
//   de ser a base atual do PR no commit aprovado; sem base gravada não há com o que comparar,
//   e a âncora fica sendo o commit (commit_id), como no repositório sem declaração;
// - objeções: com a impressão do histórico gravada no relatório, ela tem de bater com o
//   histórico atual. Sem ela (repositório sem declaração, ou avaliação que falhou antes de ler
//   o histórico) não há com o que comparar, e nada é inventado: desde 18/10/2026 (a decisão
//   sem mesa) o pedido de mudanças de uma pessoa não segura a aprovação que a conta mandou
//   sair, então ele também não serve de substituto da impressão.
async function contextoMudou(engine, pr, report, head) {
  if (SHA.test(report.base || '')) {
    const target = await technicalRuntime.targetFor(engine, pr, head);
    if (target.base !== report.base) return { gap: 'a base mudou depois da avaliação técnica', needsReview: true };
  }
  if (report.humanReviewFingerprint) {
    const objections = await technicalRuntime.reviewSnapshot(engine, pr);
    return objections.fingerprint === report.humanReviewFingerprint ? null : { gap: 'histórico de objeções mudou depois da revisão', needsReview: true };
  }
  return null;
}

// Prova esgotada (17/10/2026, v2.72.6; de novo pela decisão do dono de 18/10/2026, que supera
// o PR #250) e repositório sem declaração técnica: depois das duas tentativas do Farol neste
// commit, a lacuna técnica que não é dura é ressalva. Vale o mesmo do repositório sem declaração (commit,
// prova sem lacuna exigida e checks verdes neste commit) e, além disso, o contexto que a revisão
// leu não pode ter mudado (contextoMudou). Revisão do PR #248: sem isto a aprovação saía por
// cima de base nova ou objeção nova.
async function provaEsgotadaRefusal(engine, pr, proof, payload) {
  const basica = await semDeclaracaoRefusal(engine, pr, proof, payload);
  if (basica) return basica;
  let mudou;
  try { mudou = await contextoMudou(engine, pr, proof.report || {}, payload.commit_id); }
  catch { mudou = { gap: 'não foi possível reconfirmar a base e as objeções da revisão', needsReview: false }; }
  if (!mudou) return null;
  if (mudou.needsReview) requestRecheck(engine, pr);
  return { ok: false, blocked: 'technical_review', attempted: false, error: mudou.gap, needsReview: mudou.needsReview, waitForCi: false };
}

async function approvalRefusal(engine, pr, payload) {
  if (payload.event !== 'APPROVE') return null;
  const repo = pr.repo || String(pr.key || '').split('#')[0];
  const proof = publicationEvidence(engine, pr);
  const profile = profileFor(repo);
  // prova gravada por regras anteriores: o engine precisa recalcular, nunca vale como ressalva
  const legado = legacyEvidenceGap(proof);
  if (legado) {
    requestRecheck(engine, pr);
    return { ok: false, blocked: 'technical_review', attempted: false, error: legado, needsReview: true, waitForCi: false };
  }
  // sem declaração técnica (decisão do dono de 18/10/2026): ressalva, com commit, prova sem
  // lacuna exigida, checks verdes neste commit e o contexto da revisão ainda valendo
  if (!profile && !cadastroIlegivel()) return provaEsgotadaRefusal(engine, pr, proof, payload);
  let needsReview = !!(proof.report && profile && (proof.report.profile !== profile.fingerprint));
  let gap = !profile && 'declaração técnica do repositório ausente';
  let waitForCi = false;
  if (!gap) gap = technicalGap(proof.report, { repo, head: payload.commit_id, profile: profile.fingerprint });
  if (gap && proof.provaEsgotada === true && !ehLacunaDura(gap) && !relatorioComViolacao(proof.report)) return provaEsgotadaRefusal(engine, pr, proof, payload);
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
