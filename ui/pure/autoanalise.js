// O parecer de autoanálise dos meus PRs: selo, recolher e mostrar, o que falta para o
// Merge, o texto dos motivos de qualidade e o prompt de correção montado a partir do
// parecer. Extraído do ui/pure.js na Fase 1a da reorganização; o prompt de correção veio
// do ui/pure/sistema.js em 17/09/2026, porque é do parecer, e não da aba Sistema.
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

// Monta um prompt pronto pra colar no chat que está resolvendo o PR, a partir
// dos pontos da autoanálise. PURA: recebe os dados já coletados do STATE/DOM (o
// app.js faz essa coleta), devolve só a string do prompt. Migrada do app.js na Task 12.
//
// Três listas, porque são três pedidos diferentes (17/09/2026, medido no
// engine-ai#214): `blockers` é o que um commit no PR resolve; `externalBlockers` é o
// que trava a aprovação mas mora fora do PR (card, infra, outra pessoa) e nunca se
// resolve com commit; `tips` é melhoria. Com as duas primeiras numa lista só e o
// fecho "implemente as correções no código", quem recebeu foi procurar no código o
// que só o dono do card resolvia.
export function buildFixPrompt(args = {}) {
  const { key, url, title, card, summary, headSha } = args;
  const blockers = (args.blockers || []).filter(Boolean);
  const externos = (args.externalBlockers || []).filter(Boolean);
  const tips = (args.tips || []).filter(Boolean);
  const temCodigo = blockers.length > 0 || tips.length > 0;
  const head = headSha ? String(headSha).slice(0, 7) : '';

  let abre;
  if (blockers.length) abre = `Preciso que você corrija os pontos levantados na revisão do PR ${key}, começando pelo que trava a aprovação.`;
  else if (externos.length && !tips.length) abre = `Preciso da sua ajuda com a revisão do PR ${key}: o que trava a aprovação está fora do PR.`;
  else if (externos.length) abre = `Preciso que você aplique as melhorias da revisão do PR ${key}. O que trava a aprovação está fora do PR.`;
  else abre = `Preciso que você aplique as melhorias sugeridas na revisão do PR ${key}.`;

  const linhas = [abre, ''];
  if (url) linhas.push(`PR: ${url}`);
  if (title) linhas.push(`Título: ${title}`);
  if (card) linhas.push(`Card: ${card}`);
  if (head) linhas.push(`Head analisado: ${head}`);
  if (summary) { linhas.push('', `Resumo da revisão: ${summary}`); }
  if (blockers.length) { linhas.push('', 'Pendências no PR que travam a aprovação (prioridade):', ...blockers.map(b => `- ${b}`)); }
  if (externos.length) {
    linhas.push('', 'Pendências fora do PR que travam a aprovação (quem resolve e o que falta):', ...externos.map(b => `- ${b}`));
  }
  if (tips.length) { linhas.push('', 'Melhorias sugeridas:', ...tips.map(t => `- ${t}`)); }

  const fecho = [];
  if (temCodigo) fecho.push('Implemente no código as pendências do PR e as melhorias que procederem, rode os testes e o lint que fizerem sentido.');
  if (externos.length) fecho.push('As pendências de fora do PR não se resolvem com commit, e nunca com bypass de proteção: diga o que falta, quem resolve e o texto que eu posso mandar.');
  else fecho.push('Nenhuma pendência se resolve com bypass de proteção.');
  if (head) fecho.push(`Itens marcados "Neste head" só valem se o PR ainda estiver em ${head}.`);
  fecho.push(temCodigo ? 'No final, me diga o que mudou e por quê.' : 'No final, me diga o que você encaminhou.');
  linhas.push('', fecho.join(' '));
  return linhas.join('\n');
}
