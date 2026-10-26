// Coerência não decide o mérito: resultado contraditório pede nova análise, nunca
// aprovação automática ou transformação de sugestões em defeitos bloqueantes.
import { payloadCoherenceGap } from './public-review-text.js';
import { normalizeFindings } from './review-findings.js';
import { REVIEW_COHERENCE_GAP, relatorioComViolacao } from '../technical-review/verdict.js';

function reviewCoherenceGap(result) {
  if (!result || !['approve', 'request_changes'].includes(result.verdict)) return '';
  const normalized = normalizeFindings(result.findings);
  const atuais = normalized.findings.filter(f => f.severity === 'blocking' && !['resolvido', 'retirado'].includes(f.status));
  const memoria = result.roundReview;
  const contagemValida = memoria?.schema === 1 && Number.isInteger(memoria.unresolvedCount) && memoria.unresolvedCount >= 0;
  const anteriores = contagemValida ? memoria.unresolvedCount : 0;
  const blockers = Math.max(atuais.length, anteriores);
  const conhecido = normalized.status === 'complete'
    || (contagemValida && Array.isArray(memoria.integrity) && memoria.integrity.length === 0);
  const defeito = relatorioComViolacao(result.technicalReview) || result.cardParteDestePr === false;
  if (result.verdict === 'approve' && atuais.length) return REVIEW_COHERENCE_GAP;
  if (result.verdict === 'request_changes' && conhecido && !blockers && !defeito) return REVIEW_COHERENCE_GAP;
  // Uma violação confirmada pode mudar a ação escolhida pelo motor. Nesse caso,
  // o texto daquela ação também precisa explicar a reprovação de forma coerente.
  const action = defeito ? 'request_changes' : result.verdict;
  const payload = result.payloads?.[action];
  if (payloadCoherenceGap(payload)) return REVIEW_COHERENCE_GAP;
  return payloadCoherenceGap({ event: action === 'request_changes' ? 'REQUEST_CHANGES' : 'APPROVE', body: result.reviewMarkdown });
}

export { payloadCoherenceGap, reviewCoherenceGap };
