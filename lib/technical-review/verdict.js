// Projeção pura: não resolve HOME nem importa estado do engine.
import TOOL from './tool.json' with { type: 'json' };
import { VERSAO_DAS_LINHAS } from './divida-fora-das-linhas.js';
import { rotuloDaPasta } from './declaracao.js';
const SHA = /^[a-f0-9]{40}$/;
const CONFIRMED_VIOLATION = 'violação técnica confirmada';
const GAP_DA_PARTE_DO_CARD = 'a parte do card que cabe a este PR não foi comprovada';
const VERSAO_DAS_REGRAS = 8;
const REVIEW_COHERENCE_GAP = 'veredito e texto público incompatíveis com os achados';
const LACUNA_DA_DIVIDA = 'classificação da dívida anterior requer reconferência';
// Pasta declarada que o commit não tem (27/10/2026): configuração, não falha passageira. Não
// entra em FALHAS_DE_EXECUCAO, que são as que o Farol tenta de novo e viram ressalva.
const LACUNA_DE_DECLARACAO = 'declaração técnica cita pasta inexistente';
const FALHAS_DE_EXECUCAO = {
  profile: 'A configuração dos critérios técnicos deste repositório está ausente ou ilegível. A recuperação retoma após corrigir essa configuração.',
  tool: 'A ferramenta de verificação técnica está indisponível neste aparelho. A recuperação retoma após restabelecer a ferramenta.',
  target: 'Não foi possível confirmar os commits da análise.',
  material: 'Não foi possível preparar o código para análise.',
  objections: 'Não foi possível conferir os reviews existentes.',
  assessment: 'A execução da verificação técnica não concluiu.',
};

// Regras de organização (04/11/2026): sozinhas, não travam a demanda. O que não tem efeito no
// comportamento vira sugestão. Quando a organização causa defeito de verdade, a sessão aponta o cenário
// e ele bloqueia como achado próprio. Lista FECHADA de propósito: regra que não está aqui, inclusive
// regra nova do catálogo, segue bloqueando. Segurança, entrada, isolamento, rastro, prova de
// comportamento, supressão e regra de negócio duplicada não entram.
const REGRAS_DE_ORGANIZACAO = new Set([
  'core.abstraction.no-premature', 'core.convention.one-per-repository', 'core.file.single-responsibility',
  'core.imports.prefer-supported-aliases', 'core.javascript.no-nested-ternary', 'core.locality.promote-on-real-reuse',
  'core.testing.unit-mock-minimal', 'frontend.component.index-only-reexports', 'frontend.component.named-implementation',
  'frontend.component.named-structural-branches', 'frontend.component.no-inline-jsx-ternary',
  'frontend.component.one-component-per-file', 'frontend.component.storybook', 'frontend.design-system.storybook-single-subject',
]);
const ehDeOrganizacao = (regra) => REGRAS_DE_ORGANIZACAO.has(regra);
// Dívida fora das linhas do PR (05/11/2026, divida-fora-das-linhas.js): a marca é do app, gravada
// pelo runtime com o diff que o engine mediu; regra e achado marcados viram sugestão.
const ehDivida = (item) => item?.dividaForaDasLinhas === true;
const regraBloqueia = (r) => !ehDeOrganizacao(r.rule) && !ehDivida(r);
const regrasReprovadas = (report) => (Array.isArray(report?.rules) ? report.rules : []).filter(r => r && r.verdict === 'fail');
const reprovadasDeOrganizacao = (report) => regrasReprovadas(report).filter(r => ehDeOrganizacao(r.rule));
const reprovadasQueBloqueiam = (report) => regrasReprovadas(report).filter(regraBloqueia);
// Só vale quando há regra reprovada, todas são de organização (ou dívida fora das linhas) e o relatório não traz erro. O erro é
// onde a dívida agravada fica quando o veredito já era `fail`: sem esta conta, um ternário aninhado
// esconderia o agravamento de uma regra de segurança. `fail` sem regra por trás segue bloqueando.
const soOrganizacao = (report) => !report?.error && regrasReprovadas(report).length > 0 && reprovadasQueBloqueiam(report).length === 0;
// D7: regra de organização que não rodou não segura a aprovação, por poucas rodadas nem por ressalva.
const pendentesQueBloqueiam = (report) => report.rules.filter(r => !['pass', 'fail'].includes(r.verdict) && !ehDeOrganizacao(r.rule));
const naoRodouSoOrganizacao = (report) => report.verdict === 'not-run' && !report.error && !report.failure
  && report.rules.some(r => r.verdict === 'not-run') && pendentesQueBloqueiam(report).length === 0;
const achadosQueBloqueiam = (report) => (Array.isArray(report?.findings) ? report.findings : []).filter(f => !ehDeOrganizacao(f?.rule) && f?.foraDasLinhas !== true);

// Prova esgotada gravada sem o carimbo de versão das regras (antes da v2.72.8): o engine não sabe
// o que ela dispensou, então pede revisão nova. Com carimbo (2 ou mais), a prova foi gravada pelo
// engine com as lacunas que ele mesmo exigiu, e continua valendo (PR #253, 18/10/2026).
function legacyEvidenceGap({ provaEsgotada, evidenceVersion } = {}) {
  return provaEsgotada === true && !(Number(evidenceVersion) >= 2)
    ? 'a prova antiga omitiu lacunas; é necessária nova revisão' : '';
}

// As lacunas DURAS (17/10/2026, v2.72.6): as que continuam impedindo o APPROVE mesmo quando a
// rodada decide sozinha (lib/engine/busca-da-prova.js). Mora aqui, a camada mais
// baixa, porque a revisão, a publicação e o resumo da tela leem a mesma lista.
// A análise incompleta entra desde 06/11/2026: com toda rodada decidindo sozinha, ela sairia da
// prova gravada e o clique na mesa (e a publicação) deixaria de vê-la. Ela continua na
// recuperação durável, nunca vira ressalva. Pelo mesmo motivo (revisão independente, 06/11/2026):
// sem o diff medido pelo engine a cobertura volta a ser só o que o modelo declarou, e sem relatório
// técnico (com declaração cadastrada; sem declaração é `semDeclaracao`, ressalva) nada foi avaliado.
const LACUNAS_DURAS = [
  REVIEW_COHERENCE_GAP, LACUNA_DE_DECLARACAO, LACUNA_DA_DIVIDA,
  'análise incompleta', 'diff não medido independentemente', 'avaliação técnica atual ausente',
  CONFIRMED_VIOLATION, 'achados técnicos não resolvidos', GAP_DA_PARTE_DO_CARD, 'commit revisado não confirmado',
  'avaliação técnica de outro commit', 'avaliação técnica de outro repositório',
];
const ehLacunaDura = (g) => LACUNAS_DURAS.includes(g);

// O relatório técnico aponta violação ou achado, seja qual for a lacuna que o technicalGap
// devolveu primeiro (declaração que mudou, por exemplo, vem antes da violação na ordem dele).
function relatorioComViolacao(report) {
  if (!report || typeof report !== 'object') return false;
  const veredito = report.verdict === 'fail' && !soOrganizacao(report);
  return veredito || reprovadasQueBloqueiam(report).length > 0 || achadosQueBloqueiam(report).length > 0;
}

function isCiGap(gap) {
  return ['ci_vermelho', 'ci_em_andamento', 'checks não conferidos no commit revisado'].includes(gap);
}

function requiredEvidenceGap(evidence) {
  if (!Array.isArray(evidence) || evidence.some(g => typeof g !== 'string' || !g.trim())) return 'prova necessária à aprovação inválida';
  return evidence.find(g => !isCiGap(g)) || '';
}

function technicalGap(report, { repo, head, profile } = {}) {
  if (report?.escopoSessaoInconclusivo === true || report?.escopoSessaoPendente === true) return REVIEW_COHERENCE_GAP;
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
  const organizacao = soOrganizacao(report);
  if (reprovadasQueBloqueiam(report).length || (report.verdict === 'fail' && !organizacao)) return CONFIRMED_VIOLATION;
  const descontouDivida = report.foraDasLinhas?.achados > 0 || report.rules.some(r => r.dividaForaDasLinhas)
    || (Array.isArray(report.findings) && report.findings.some(f => f?.foraDasLinhas));
  if (descontouDivida && report.foraDasLinhas?.versao !== VERSAO_DAS_LINHAS) {
    return achadosQueBloqueiam(report).length ? 'achados técnicos não resolvidos' : LACUNA_DA_DIVIDA;
  }
  const vereditoAceito = report.verdict === 'pass' || (report.verdict === 'fail' && organizacao) || naoRodouSoOrganizacao(report);
  if (!vereditoAceito || pendentesQueBloqueiam(report).length) return 'avaliação técnica inconclusiva';
  if (!Array.isArray(report.findings) || achadosQueBloqueiam(report).length) return 'achados técnicos não resolvidos';
  return '';
}

const SEM_DECLARACAO_TEXTO = 'Este repositório não tem declaração técnica cadastrada, então a avaliação técnica automática não rodou.';

// `provaEsgotada` (v2.72.6; de novo desde 18/10/2026): já na primeira rodada do
// commit (06/11/2026), a lacuna técnica que não é dura é ressalva, e o resumo não pode dizer
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
  const ressalva = comoRessalva ? `${technicalFailure}; segue como ressalva desta revisão` : '';
  if (comoRessalva) technicalFailure = '';
  let gap = technicalFailure || legado;
  if (!gap && provenance?.recheck === true) gap = 'O contexto da revisão mudou. É necessária nova análise antes de aprovar.';
  if (!gap && evidence !== undefined) gap = requiredEvidenceGap(evidence);
  const rules = Array.isArray(report.rules) ? report.rules.filter(r => r && typeof r === 'object') : [];
  const violated = reprovadasQueBloqueiam(report).length;
  const organizacao = reprovadasDeOrganizacao(report).length;
  const pending = rules.filter(r => r.verdict === 'not-run').length;
  let state = 'pass';
  if (gap) state = 'pending';
  if (technicalFailure === CONFIRMED_VIOLATION) state = 'violation';
  const knownDebt = rules.reduce((n, r) => n + (Number(r.conhecidos) || 0), 0);
  let approved = 'Critérios técnicos comprovados.';
  if (knownDebt) approved = `Critérios da entrega comprovados; ${knownDebt} ocorrência(s) de dívida anterior registrada permanecem.`;
  if (organizacao) approved += ` ${organizacao} regra(s) de organização seguem como sugestão.`;
  const divida = Number(report.foraDasLinhas?.achados) || 0;
  if (divida) approved += ` ${divida} achado(s) em linha que o PR não alterou seguem como dívida anterior, sem bloquear.`;
  let failure = Object.hasOwn(FALHAS_DE_EXECUCAO, report.failure || '') && FALHAS_DE_EXECUCAO[report.failure];
  if (report.failure === 'declaration') failure = textoDaDeclaracao(report);
  if (ressalva && !gap) return { state: 'ressalva', message: ressalva, violated, pending, knownDebt };
  return { state, message: failure || report.error || gap || approved, violated, pending, knownDebt };
}

// Os motivos que a conferência grava (declaracao.js); só eles vão ao card.

// Montado das pastas conferidas pelo Farol, nunca do texto de erro gravado (registro antigo,
// ou erro de leitura, poderia trazer caminho da máquina).
function textoDaDeclaracao(report) {
  const pastas = (Array.isArray(report.missingDirs) ? report.missingDirs : [])
    .filter(a => a && typeof a.campo === 'string' && typeof a.dir === 'string')
    .slice(0, 5).map(rotuloDaPasta).join(', ');
  const total = Number(report.missingCount) || 0;
  const resto = total > 5 ? ` e mais ${total - 5}` : '';
  const quais = pastas ? `: ${pastas}${resto}` : '';
  return `A declaração técnica do repositório cita pasta que não existe neste commit${quais}. Corrija a declaração técnica neste aparelho; a recuperação retoma quando ela mudar, e aprovar manualmente não resolve.`;
}

function evidenceGap(result) {
  const head = result.headSha || result.reviewedHead;
  return technicalGap(result.technicalReview, { repo: result.technicalReview?.repo, head });
}


export { ehDeOrganizacao, TOOL, technicalGap, technicalSummary, evidenceGap, isCiGap, requiredEvidenceGap, GAP_DA_PARTE_DO_CARD, VERSAO_DAS_REGRAS, legacyEvidenceGap, ehLacunaDura, relatorioComViolacao, REVIEW_COHERENCE_GAP, CONFIRMED_VIOLATION as LACUNA_DE_VIOLACAO, LACUNA_DE_DECLARACAO, LACUNA_DA_DIVIDA };
