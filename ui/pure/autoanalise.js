// O parecer de autoanálise dos meus PRs: selo, recolher e mostrar, o que falta para o
// Merge e o texto dos motivos de qualidade. Extraído do ui/pure.js na Fase 1a da
// reorganização; o conteúdo não mudou.
//
// A UI CONSOME a elegibilidade de qualidade que o engine calcula (evaluateQualityEligibility),
// nunca a reconstrói: o disco guarda parecer bruto mais o que o engine observou, e o
// `quality` é derivado a cada snapshot. Recolher o parecer é preferência de leitura e não
// entra em gate nenhum.

// --- elegibilidade de merge da autoanálise: a UI CONSOME, nunca reconstrói ---
// O `canMerge` do app.js era `!!(a && a.approvable)`, uma quarta cópia da regra que
// o engine centralizou em evaluateQualityEligibility. A decisão mora aqui, e não no
// render, porque aqui tem teste: `quality` chega calculado no snapshot e a única
// pergunta desta camada é se o status é `eligible`. `approvable` não é consultado
// em lugar nenhum deste arquivo, de propósito.

export function canMergeSelfAnalysis(analysis) {
  return !!(analysis && analysis.quality && analysis.quality.status === 'eligible');
}

// A análise DESATUALIZOU: o PR recebeu commit depois dela (carimbo do engine em
// `observed.stale`). O registro fica, o veredito não vale mais, e a tela precisa dizer
// as duas coisas ao mesmo tempo. Ler `observed` e não um campo solto é de propósito: a
// evidência do engine mora num lugar só, e é ela que o gate consome.
export function selfAnalysisStale(analysis) {
  return !!(analysis && analysis.observed && analysis.observed.stale === true);
}

// O selo ao lado do número do PR. Desatualizada VENCE o parecer: mostrar "aprovável"
// sobre código que já mudou é a única leitura que faria alguém agir errado, e o custo
// de esconder o parecer por um ciclo é zero (ele continua escrito no painel).
export function selfAnalysisBadge(analysis) {
  if (!analysis) return null;
  if (selfAnalysisStale(analysis)) {
    return { cls: 'stale', label: 'desatualizada', title: 'O PR recebeu commit novo depois desta análise. O relatório continua aqui, mas o veredito não vale pro código atual: reanalise quando quiser o veredito de novo.' };
  }
  return analysis.approvable
    ? { cls: 'approve', label: 'aprovável', title: '' }
    : { cls: 'rc', label: 'precisa de ajuste', title: '' };
}

// Ocultar/mostrar a análise é PREFERÊNCIA DE LEITURA e nada mais: não apaga, não expira
// e não encosta em gate nenhum. O par de rótulos mora aqui porque o botão é um só e
// alterna, e um texto errado nesse botão foi exatamente o defeito de origem (ele dizia
// "Ocultar" e apagava o registro do disco).
export function selfAnalysisToggle(analysis) {
  const oculta = !!(analysis && analysis.hidden);
  return oculta
    ? { hidden: true, alvo: false, label: 'Mostrar análise', title: 'Mostrar de novo o parecer desta autoanálise. Ele continua guardado desde que a análise rodou.' }
    : { hidden: false, alvo: true, label: 'Ocultar análise', title: 'Recolhe o parecer desta autoanálise da tela. O relatório continua guardado e volta com um clique, sem gastar uma análise nova.' };
}

// O engine entrega CÓDIGO (contrato de máquina) e a apresentação escreve a frase.
// Código desconhecido cai numa frase genérica em vez de vazar o identificador cru:
// a tela nunca fica em branco e o usuário nunca lê CONSTANTE_EM_CAIXA_ALTA.
const QUALITY_REASON_LABELS = {
  BLOCKER_PRESENT: 'A análise apontou bloqueios',
  EXTERNAL_BLOCKER_PRESENT: 'Há bloqueio fora do PR (card, infra ou outra pessoa)',
  BLOCKERS_UNKNOWN: 'A análise não declarou os bloqueios',
  COVERAGE_UNKNOWN: 'Sem cobertura comprovada',
  COVERAGE_INCOMPLETE: 'Parte do PR ficou sem análise',
  // limitação do INSTRUMENTO, não da análise: o provedor da sessão não reporta leitura
  // de arquivo, então a cobertura não pôde ser observada. O Merge segue indisponível
  // (sem prova de leitura não se libera), mas a linha para de culpar quem leu.
  COVERAGE_UNOBSERVABLE: 'Não deu pra observar a leitura nesta sessão',
  ANALYSIS_INCOMPLETE: 'A análise não chegou ao fim',
  CARD_UNSATISFIED: 'O card não foi atendido',
  CARD_UNKNOWN: 'Atendimento ao card não comprovado',
  VERIFICATION_FAILED: 'Uma verificação falhou',
  VERIFICATION_MISSING: 'Verificação necessária não foi feita',
  ANALYSIS_STALE: 'O PR mudou depois desta análise',
  EVIDENCE_STALE: 'A evidência não é do código analisado',
  COVERAGE_LIMITS_MALFORMED: 'A análise devolveu limitações de cobertura inválidas'
};

export function qualityReasonLabel(code) {
  return QUALITY_REASON_LABELS[code] || 'Requisito de qualidade não atendido';
}

// Título do botão desabilitado: uma frase principal que explica o fail-closed, e os
// motivos como lista embaixo. Concatenar os códigos num toast só transformaria
// contrato de máquina em copy, que é justamente o que a separação acima evita.
export function qualityBlockTitle(quality) {
  const principal = 'Sua autoanálise ainda não comprova qualidade suficiente para merge.';
  const motivos = ((quality && quality.reasons) || []).map(r => `• ${qualityReasonLabel(r && r.code)}`);
  return motivos.length ? `${principal}\n${motivos.join('\n')}` : principal;
}
