// Coerência não decide o mérito: resultado contraditório pede nova análise, nunca
// aprovação automática ou transformação de sugestões em defeitos bloqueantes.
import { payloadCoherenceGap } from './public-review-text.js';
import { normalizeFindings } from './review-findings.js';
import { checksVermelhos } from './gate-espera.js';
import { REVIEW_COHERENCE_GAP, relatorioComViolacao } from '../technical-review/verdict.js';

// O que o pedido de mudanças tem por trás: bloqueios declarados, defeito provado e o CI vermelho
// lido no commit revisado. `conhecido` diz se a contagem de bloqueios é confiável.
function apoioDaReprovacao(result) {
  const normalized = normalizeFindings(result.findings);
  const atuais = normalized.findings.filter(f => f.severity === 'blocking' && !['resolvido', 'retirado'].includes(f.status));
  const memoria = result.roundReview;
  const contagemValida = memoria?.schema === 1 && Number.isInteger(memoria.unresolvedCount) && memoria.unresolvedCount >= 0;
  const anteriores = contagemValida ? memoria.unresolvedCount : 0;
  const conhecido = normalized.status === 'complete'
    || (contagemValida && Array.isArray(memoria.integrity) && memoria.integrity.length === 0);
  const defeito = relatorioComViolacao(result.technicalReview) || result.cardParteDestePr === false;
  const ciVermelho = !!result.headSha && result.checksVerifiedHead === result.headSha && checksVermelhos(result).length > 0;
  return { atuais, blockers: Math.max(atuais.length, anteriores), conhecido, defeito, ciVermelho };
}

// O pedido de mudanças que só o CI vermelho sustenta (nenhum bloqueio, nenhum defeito provado).
// Com "CI obrigatório antes da aprovação" desligado (06/11/2026) ele não sai sozinho
// (approval-policy.js, shouldAutoReject): o estado do CI deixou de decidir. Não exige a contagem
// confiável (`conhecido`) que a coerência exige: com achados ilegíveis e só o CI vermelho à vista,
// segurar o pedido automático é o lado seguro, e ele vai à mesa com o motivo dito.
function reprovacaoSoPeloCi(result) {
  if (!result || result.verdict !== 'request_changes') return false;
  const a = apoioDaReprovacao(result);
  return !a.blockers && !a.defeito && a.ciVermelho;
}

function reviewCoherenceGap(result) {
  if (!result || !['approve', 'request_changes'].includes(result.verdict)) return '';
  if (result.technicalReview?.escopoSessaoInconclusivo === true || result.technicalReview?.escopoSessaoPendente === true) return REVIEW_COHERENCE_GAP;
  if (result.criteriaEvidence?.ok === false) return REVIEW_COHERENCE_GAP;
  const { atuais, blockers, conhecido, defeito, ciVermelho } = apoioDaReprovacao(result);
  if (result.verdict === 'approve' && atuais.length) return REVIEW_COHERENCE_GAP;
  if (result.verdict === 'request_changes' && conhecido && !blockers && !defeito && !ciVermelho) return REVIEW_COHERENCE_GAP;
  // Uma violação confirmada pode mudar a ação escolhida pelo motor. Nesse caso,
  // o texto daquela ação também precisa explicar a reprovação de forma coerente.
  const action = defeito ? 'request_changes' : result.verdict;
  const payload = result.payloads?.[action];
  if (payloadCoherenceGap(payload)) return REVIEW_COHERENCE_GAP;
  return payloadCoherenceGap({ event: action === 'request_changes' ? 'REQUEST_CHANGES' : 'APPROVE', body: result.reviewMarkdown });
}

export { payloadCoherenceGap, reviewCoherenceGap, reprovacaoSoPeloCi };
