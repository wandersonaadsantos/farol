// Decide admissibilidade antes da preferência de publicação.
import { approvalGaps, isCiGap } from '../technical-review/evidence.js';
import { motivoDeEspera } from './gate-espera.js';
import { ehMeu, textoDoPrProprio } from './pr-proprio.js';

const VEREDITOS_POSTAVEIS = ['approve', 'request_changes'];

function temTextoPublico(payload) {
  if (!payload) return false;
  return !!(String(payload.body || '').trim() || (Array.isArray(payload.comments) && payload.comments.length));
}

function shouldAutoApprove(engine, pr, result) {
  // PR da própria conta que revisa: o GitHub recusa a postagem do autor, nenhuma espera adianta
  if (VEREDITOS_POSTAVEIS.includes(result.verdict) && ehMeu(engine, pr)) return { ok: false, motivo: 'pr_proprio' };
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
  if (ehMeu(engine, pr)) return false;   // o GitHub recusa REQUEST_CHANGES do autor
  return engine.rejectPolicyFor(engine.accountForPr(pr)) === 'request_changes';
}

// O texto do card para as recusas do gate que a sessão não explica sozinha. '' = nada a dizer
// (nao_aprovavel só é notícia quando a revisão concluiu aprovar).
const TEXTOS_DA_RECUSA = {
  analise_incompleta: () => 'a revisão não terminou a análise (o envelope voltou com status incompleto), então não posto sozinho',
  sem_texto: () => 'a revisão aprovou sem escrever nada (nem corpo, nem comentário de linha), e aprovação em branco não sai sozinha',
  nao_aprovavel: (_e, _pr, r) => (r.verdict === 'approve' ? 'a revisão concluiu aprovar, mas não devolveu o APPROVE pronto pra postar (envelope incompleto), então não posto sozinho' : ''),
  pr_proprio: (e, pr, r) => textoDoPrProprio(e.accountForPr(pr), r.verdict),
};

function textoDaRecusa(engine, pr, motivo, result) {
  const texto = TEXTOS_DA_RECUSA[motivo];
  return texto ? texto(engine, pr, result) : '';
}

export { shouldAutoApprove, shouldAutoReject, textoDaRecusa };
