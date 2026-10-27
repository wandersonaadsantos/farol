// Projeção pura: não resolve HOME nem importa estado do engine.
import TOOL from './tool.json' with { type: 'json' };
const SHA = /^[a-f0-9]{40}$/;
const CONFIRMED_VIOLATION = 'violação técnica confirmada';
const GAP_DA_PARTE_DO_CARD = 'a parte do card que cabe a este PR não foi comprovada';
const VERSAO_DAS_REGRAS = 5;
const REVIEW_COHERENCE_GAP = 'veredito e texto público incompatíveis com os achados';
// Pasta declarada que o commit não tem (27/10/2026): configuração, não falha passageira. Não
// entra em FALHAS_DE_EXECUCAO, que são as que o Farol tenta de novo e viram ressalva.
const LACUNA_DE_DECLARACAO = 'declaração técnica cita pasta inexistente';
const FALHAS_DE_EXECUCAO = {
  profile: 'A configuração dos critérios técnicos deste repositório está ausente ou ilegível. A recuperação retoma após corrigir essa configuração.',
  tool: 'A ferramenta de verificação técnica está indisponível neste aparelho. A recuperação retoma após restabelecer a ferramenta.',
  target: 'Não foi possível confirmar os commits da análise. O Farol tentará novamente.',
  material: 'Não foi possível preparar o código para análise. O Farol tentará novamente.',
  objections: 'Não foi possível conferir os reviews existentes. O Farol tentará novamente.',
  assessment: 'A execução da verificação técnica não concluiu. O Farol tentará novamente.',
};

// Prova esgotada gravada sem o carimbo de versão das regras (antes da v2.72.8): o engine não sabe
// o que ela dispensou, então pede revisão nova. Com carimbo (2 ou mais), a prova foi gravada pelo
// engine com as lacunas que ele mesmo exigiu, e continua valendo (PR #253, 18/10/2026).
function legacyEvidenceGap({ provaEsgotada, evidenceVersion } = {}) {
  return provaEsgotada === true && !(Number(evidenceVersion) >= 2)
    ? 'a prova antiga omitiu lacunas; é necessária nova revisão' : '';
}

// As lacunas DURAS (17/10/2026, v2.72.6): as que continuam impedindo o APPROVE mesmo depois das
// duas tentativas do Farol neste commit (lib/engine/busca-da-prova.js). Mora aqui, a camada mais
// baixa, porque a revisão, a publicação e o resumo da tela leem a mesma lista.
const LACUNAS_DURAS = [
  REVIEW_COHERENCE_GAP, LACUNA_DE_DECLARACAO,
  CONFIRMED_VIOLATION, 'achados técnicos não resolvidos', GAP_DA_PARTE_DO_CARD, 'commit revisado não confirmado',
  'avaliação técnica de outro commit', 'avaliação técnica de outro repositório',
];
const ehLacunaDura = (g) => LACUNAS_DURAS.includes(g);

// O relatório técnico aponta violação ou achado, seja qual for a lacuna que o technicalGap
// devolveu primeiro (declaração que mudou, por exemplo, vem antes da violação na ordem dele).
function relatorioComViolacao(report) {
  if (!report || typeof report !== 'object') return false;
  const regras = Array.isArray(report.rules) ? report.rules : [];
  return report.verdict === 'fail' || regras.some((r) => r && r.verdict === 'fail')
    || (Array.isArray(report.findings) && report.findings.length > 0);
}

function isCiGap(gap) {
  return ['ci_vermelho', 'ci_em_andamento', 'checks não conferidos no commit revisado'].includes(gap);
}

function requiredEvidenceGap(evidence) {
  if (!Array.isArray(evidence) || evidence.some(g => typeof g !== 'string' || !g.trim())) return 'prova necessária à aprovação inválida';
  return evidence.find(g => !isCiGap(g)) || '';
}

function technicalGap(report, { repo, head, profile } = {}) {
  if (report?.verdict === 'not-run' && report.failure === 'declaration') return LACUNA_DE_DECLARACAO;
  if (report?.verdict === 'not-run' && Object.hasOwn(FALHAS_DE_EXECUCAO, report.failure || '')) return 'execução da avaliação técnica não concluída';
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

const SEM_DECLARACAO_TEXTO = 'Este repositório não tem declaração técnica cadastrada, então a avaliação técnica automática não rodou.';

// `provaEsgotada` (v2.72.6; de novo desde 18/10/2026): depois das duas tentativas do Farol
// neste commit, a lacuna técnica que não é dura é ressalva, e o resumo não pode dizer
// "pendente" (a tela desligaria o Aprovar que a política da conta deixou para você). A prova
// gravada por regras anteriores segue pedindo revisão nova (legacyEvidenceGap).
function technicalSummary(report, evidence, provenance = {}) {
  if (!report) return { state: 'pending', message: 'Avaliação técnica necessária.' };
  const legado = legacyEvidenceGap(provenance);
  if (report.semDeclaracao === true) {
    const reconferir = provenance?.recheck === true ? 'O contexto da revisão mudou. É necessária nova análise antes de aprovar.' : '';
    const gap = legado || reconferir || (evidence === undefined ? '' : requiredEvidenceGap(evidence));
    return gap ? { state: 'pending', message: gap } : { state: 'sem-declaracao', message: SEM_DECLARACAO_TEXTO };
  }
  let technicalFailure = technicalGap(report);
  const comoRessalva = !legado && provenance.provaEsgotada === true && technicalFailure && !ehLacunaDura(technicalFailure) && !relatorioComViolacao(report);
  const ressalva = comoRessalva ? `${technicalFailure}; depois de duas tentativas minhas neste commit, segue como ressalva` : '';
  if (comoRessalva) technicalFailure = '';
  let gap = technicalFailure || legado;
  if (!gap && provenance?.recheck === true) gap = 'O contexto da revisão mudou. É necessária nova análise antes de aprovar.';
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
  let failure = Object.hasOwn(FALHAS_DE_EXECUCAO, report.failure || '') && FALHAS_DE_EXECUCAO[report.failure];
  if (report.failure === 'declaration') failure = textoDaDeclaracao(report);
  if (ressalva && !gap) return { state: 'ressalva', message: ressalva, violated, pending, knownDebt };
  return { state, message: failure || report.error || gap || approved, violated, pending, knownDebt };
}

function textoDaDeclaracao(report) {
  const motivo = typeof report.error === 'string' && report.error ? report.error : LACUNA_DE_DECLARACAO;
  return `${motivo[0].toUpperCase()}${motivo.slice(1)}. Corrija a declaração técnica do repositório neste aparelho; a recuperação retoma quando ela mudar, e aprovar manualmente não resolve.`;
}

function evidenceGap(result) {
  const head = result.headSha || result.reviewedHead;
  return technicalGap(result.technicalReview, { repo: result.technicalReview?.repo, head });
}


export { TOOL, technicalGap, technicalSummary, evidenceGap, isCiGap, requiredEvidenceGap, GAP_DA_PARTE_DO_CARD, VERSAO_DAS_REGRAS, legacyEvidenceGap, ehLacunaDura, relatorioComViolacao, REVIEW_COHERENCE_GAP, CONFIRMED_VIOLATION as LACUNA_DE_VIOLACAO, LACUNA_DE_DECLARACAO };
