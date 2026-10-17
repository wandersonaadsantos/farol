// Decide admissibilidade antes da preferência de publicação.
import { approvalGaps, isCiGap } from '../technical-review/evidence.js';
import { motivoDeEspera } from './gate-espera.js';

function temTextoPublico(payload) {
  if (!payload) return false;
  return !!(String(payload.body || '').trim() || (Array.isArray(payload.comments) && payload.comments.length));
}

function shouldAutoApprove(engine, pr, result) {
  if (result.analysisStatus !== 'complete') return { ok: false, motivo: 'analise_incompleta' };
  const approvable = result.verdict === 'approve' &&
    result.payloads && result.payloads.approve && result.payloads.approve.event === 'APPROVE';
  if (!approvable) return { ok: false, motivo: 'nao_aprovavel' };
  if (!temTextoPublico(result.payloads.approve)) return { ok: false, motivo: 'sem_texto' };
  if (pr.requested !== true) return { ok: false, motivo: 'clique' };
  const required = approvalGaps(result).filter(g => !isCiGap(g));
  if (required.length) return { ok: false, motivo: 'prova_tecnica_incompleta' };
  const clean = engine.attentionPoints(result).length === 0;
  if (engine.approvePolicyFor(engine.accountForPr(pr), clean) !== 'approve') {
    return { ok: false, motivo: 'politica' };
  }
  const espera = motivoDeEspera(result) || (result.checksVerifiedHead !== result.headSha && 'ci_em_andamento');
  return espera ? { ok: false, motivo: espera } : { ok: true, motivo: null };
}

function shouldAutoReject(engine, pr, result) {
  if (result.analysisStatus !== 'complete') return false;
  const rc = result.payloads && result.payloads.request_changes;
  const rejectable = result.verdict === 'request_changes' &&
    rc && rc.event === 'REQUEST_CHANGES' && temTextoPublico(rc);
  if (!rejectable || pr.requested !== true) return false;   // pedido a mim, igual ao approve
  return engine.rejectPolicyFor(engine.accountForPr(pr)) === 'request_changes';
}

export { shouldAutoApprove, shouldAutoReject };
