// Projeção pura: não resolve HOME nem importa estado do engine.
import TOOL from './tool.json' with { type: 'json' };
const SHA = /^[a-f0-9]{40}$/;

function technicalGap(report, { repo, head, profile } = {}) {
  if (!report || report.schema !== 1 || report.toolCommit !== TOOL.commit) return 'avaliação técnica atual ausente';
  if (report.version !== TOOL.version || !SHA.test(report.head || '') || !SHA.test(report.base || '')) return 'identidade da avaliação técnica inválida';
  if (repo && report.repo !== repo) return 'avaliação técnica de outro repositório';
  if (head && report.head !== head) return 'avaliação técnica de outro commit';
  if (profile && report.profile !== profile) return 'declaração técnica mudou';
  if (!report.catalogFingerprint || !Array.isArray(report.rules)) return 'regras técnicas não comprovadas';
  if (!report.humanReviewFingerprint) return 'histórico de objeções não conferido';
  const coverage = report.coverage || {};
  const outside = coverage.foraDoMaterial;
  if (!report.rules.length && !(coverage.selecionadas > 0 && coverage.arquivosDaEntrega > 0 && Array.isArray(outside) && outside.length === coverage.selecionadas)) return 'aplicabilidade técnica não comprovada';
  if (report.rules.some(r => r.verdict === 'fail') || report.verdict === 'fail') return 'violação técnica confirmada';
  if (report.verdict !== 'pass' || report.rules.some(r => r.verdict !== 'pass')) return 'avaliação técnica inconclusiva';
  if (!Array.isArray(report.findings) || report.findings.length) return 'achados técnicos não resolvidos';
  return '';
}

function technicalSummary(report) {
  if (!report) return { state: 'pending', message: 'Avaliação técnica necessária.' };
  const gap = technicalGap(report);
  const violated = report.rules?.filter(r => r.verdict === 'fail').length || 0;
  const pending = report.rules?.filter(r => r.verdict === 'not-run').length || 0;
  let state = 'pass';
  if (gap) state = violated || report.verdict === 'fail' ? 'violation' : 'pending';
  const knownDebt = (report.rules || []).reduce((n, r) => n + (Number(r.conhecidos) || 0), 0);
  let approved = 'Critérios técnicos comprovados.';
  if (knownDebt) approved = `Critérios da entrega comprovados; ${knownDebt} ocorrência(s) de dívida anterior registrada permanecem.`;
  return { state, message: report.error || gap || approved, violated, pending, knownDebt };
}

function evidenceGap(result) {
  const head = result.headSha || result.reviewedHead;
  return technicalGap(result.technicalReview, { repo: result.technicalReview?.repo, head });
}


export { TOOL, technicalGap, technicalSummary, evidenceGap };
