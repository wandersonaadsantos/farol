// Projeção pura: não resolve HOME nem importa estado do engine.
import TOOL from './tool.json' with { type: 'json' };
const SHA = /^[a-f0-9]{40}$/;
const CONFIRMED_VIOLATION = 'violação técnica confirmada';

function isCiGap(gap) {
  return ['ci_vermelho', 'ci_em_andamento', 'checks não conferidos no commit revisado'].includes(gap);
}

function requiredEvidenceGap(evidence) {
  if (!Array.isArray(evidence) || evidence.some(g => typeof g !== 'string' || !g.trim())) return 'prova necessária à aprovação inválida';
  return evidence.find(g => !isCiGap(g)) || '';
}

function technicalGap(report, { repo, head, profile } = {}) {
  if (!report || report.schema !== 1 || report.toolCommit !== TOOL.commit) return 'avaliação técnica atual ausente';
  if (report.version !== TOOL.version || !SHA.test(report.head || '') || !SHA.test(report.base || '')) return 'identidade da avaliação técnica inválida';
  if (repo && report.repo !== repo) return 'avaliação técnica de outro repositório';
  if (head && report.head !== head) return 'avaliação técnica de outro commit';
  if (profile && report.profile !== profile) return 'declaração técnica mudou';
  if (!report.catalogFingerprint || !Array.isArray(report.rules)) return 'regras técnicas não comprovadas';
  if (report.rules.some(r => !r || typeof r !== 'object')) return 'regras técnicas inválidas';
  if (!report.humanReviewFingerprint) return 'histórico de objeções não conferido';
  const coverage = report.coverage || {};
  const outside = coverage.foraDoMaterial;
  if (!report.rules.length && !(coverage.selecionadas > 0 && coverage.arquivosDaEntrega > 0 && Array.isArray(outside) && outside.length === coverage.selecionadas)) return 'aplicabilidade técnica não comprovada';
  if (report.rules.some(r => r.verdict === 'fail') || report.verdict === 'fail') return CONFIRMED_VIOLATION;
  if (report.verdict !== 'pass' || report.rules.some(r => r.verdict !== 'pass')) return 'avaliação técnica inconclusiva';
  if (!Array.isArray(report.findings) || report.findings.length) return 'achados técnicos não resolvidos';
  return '';
}

function technicalSummary(report, evidence) {
  if (!report) return { state: 'pending', message: 'Avaliação técnica necessária.' };
  const technicalFailure = technicalGap(report);
  let gap = technicalFailure;
  if (!gap && evidence !== undefined) gap = requiredEvidenceGap(evidence);
  const rules = Array.isArray(report.rules) ? report.rules.filter(r => r && typeof r === 'object') : [];
  const violated = rules.filter(r => r.verdict === 'fail').length;
  const pending = rules.filter(r => r.verdict === 'not-run').length;
  let state = 'pass';
  if (gap) state = 'pending';
  if (technicalFailure === CONFIRMED_VIOLATION) state = 'violation';
  const knownDebt = rules.reduce((n, r) => n + (Number(r.conhecidos) || 0), 0);
  let approved = 'Critérios técnicos comprovados.';
  if (knownDebt) approved = `Critérios da entrega comprovados; ${knownDebt} ocorrência(s) de dívida anterior registrada permanecem.`;
  return { state, message: report.error || gap || approved, violated, pending, knownDebt };
}

function evidenceGap(result) {
  const head = result.headSha || result.reviewedHead;
  return technicalGap(result.technicalReview, { repo: result.technicalReview?.repo, head });
}


export { TOOL, technicalGap, technicalSummary, evidenceGap, isCiGap, requiredEvidenceGap };
