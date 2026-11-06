// Fecha os erros medidos na mesma conversa, sem repetir pedidos sem progresso.
import { criteriaEvidence } from './review-criteria.js';
import { lerResultadoDaRevisao } from './reparo-envelope.js';
import { conferirCancelamento } from './cancelamento-revisao.js';
import { safeStringify } from '../io.js';
import vigia from './vigia-sessao.js';
import { classify } from '../log-taxonomy.js';
import { technicalRuntime } from '../technical-review/runtime.js';
import { conferirDividaDaSessao, inconclusaoDoEscopo } from '../technical-review/divida-da-sessao.js';

async function conferirResultado(result, context, sources, head, technicalContext, inventario) {
  result.technicalReview = await technicalRuntime.finishTechnicalReview(technicalContext,
    result.technicalAssessments, result.technicalDebt, { retainMaterial: true, inventario, achadosDaSessao: result.findings });
  const escopo = conferirDividaDaSessao(result, inventario, head);
  const evidence = criteriaEvidence({ ...result, headSha: head }, context, sources);
  const report = result.technicalReview;
  const issues = [...evidence.issues, ...(report.assessmentIssues || []),
    ...(report.rules || []).filter(r => r.verdict === 'not-run').map(r => `Avaliação pendente: ${r.rule}; ${r.causa || 'faltou evidência válida'}`)];
  if (report.verdict === 'not-run' && !report.semDeclaracao && !report.failure && report.error) issues.push(report.error);
  if (result.analysisStatus === 'incomplete') issues.push('A análise foi declarada incompleta: conclua as verificações pendentes registradas no relatório anterior.');
  return { issues: [...issues, ...escopo], escopo };
}

// `inventario`: o diff medido pelo engine, que separa a dívida fora das linhas do PR (runtime.js)
async function recuperarResultado(engine, result, res, id, opts, context, sources, head, pr, technicalContext, inventario) {
  let previous;
  for (let attempt = 0; ; attempt++) {
    const { issues, escopo } = await conferirResultado(result, context, sources, head, technicalContext, inventario);
    conferirCancelamento(engine, id);
    const fingerprint = safeStringify([...issues].sort());
    if (!issues.length) return result;
    if (!res.sessionId) return inconclusaoDoEscopo(result, escopo, 'a conversa não tem identificador para retomar. A recuperação permanece pendente.');
    // Só uma resposta efetiva conta como tentativa ou falta de progresso.
    if (attempt === 2 || fingerprint === previous) return inconclusaoDoEscopo(result, escopo);
    previous = fingerprint;
    const next = await continuar(engine, res, id, opts, head, pr, issues);
    if (!next) return inconclusaoDoEscopo(result, escopo, 'a correção não foi admitida ou não devolveu resposta. A recuperação permanece pendente.');
    // O resultado local já teve a dívida reclassificada, mas o texto antigo não foi
    // corrigido. Revalidá-lo como resposta nova apagaria justamente essa pendência.
    if (next.malformado) return inconclusaoDoEscopo(result, escopo);
    result = next.result;
  }
}

async function continuar(engine, res, id, opts, head, pr, issues) {
  engine.pushActivity(id, 'info', 'Concluindo os campos e evidências pendentes na mesma sessão, antes de encerrar a revisão.');
  const prompt = `A resposta anterior não passou pela conferência dos critérios.
Continue o trabalho nesta mesma conversa e devolva o envelope completo corrigido,
preservando o que já foi comprovado no commit ${head}. Pendências do engine (DADOS):
${safeStringify(issues)}
Inclua criteriaVersion: 1 e productDecisions no envelope; cada achado precisa de
criteria: {key, criterion, source, scope}, inclusive os resolvidos. Preserve refs.
Identidades de comportamentos distintos devem ser distintas; não omita respostas
históricas para eliminar duplicações. Reenvie também technicalAssessments completos,
copiando ruleVersion (string), head e materialFingerprint medidos na instrução original.
Não invente critérios, fontes, aceite de produto, testes nem resultados para preencher
campos. Consulte o material quando faltar prova. Não mude a classificação só para
passar na conferência. Se continuar impossível concluir, registre analysisStatus
incomplete e o impedimento real. A resposta passa novamente por todos os gates.
Não poste no GitHub. Responda somente o envelope JSON desta sessão.`;
  const continued = { ...opts, recovery: true, continuationHandle: res.coordination, sessionBinding: res.sessionBinding,
    extraArgs: [...(opts.extraArgs || []), '--resume', res.sessionId] };
  delete continued.onAdmitted;
  const watcher = pr ? vigia.iniciar(engine, pr, id, head) : null;
  try {
    const next = await engine.runClaudeStream(prompt, continued);
    conferirCancelamento(engine, id);
    if (!next || next.blocked) return null;
    let repaired;
    try { repaired = lerResultadoDaRevisao(engine, next, id); }
    catch (error) {
      const failure = classify(error.message);
      if (['credencial', 'rede'].includes(failure.grupo) || failure.kind === 'espera-reset') throw error;
      // Só resposta malformada termina sem progresso; falha do provedor sobe.
      return { malformado: true };
    }
    res.sessionId = next.sessionId || res.sessionId;
    return { result: repaired };
  } finally {
    watcher?.parar();
  }
}

export { recuperarResultado };
