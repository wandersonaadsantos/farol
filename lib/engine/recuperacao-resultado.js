// Uma continuação dirigida na mesma conversa, antes de agendar outra revisão inteira.
import { criteriaEvidence } from './review-criteria.js';
import { lerResultadoDaRevisao } from './reparo-envelope.js';
import { conferirCancelamento } from './cancelamento-revisao.js';
import { safeStringify } from '../io.js';
import vigia from './vigia-sessao.js';
import { classify } from '../log-taxonomy.js';

async function recuperarResultado(engine, result, res, id, opts, context, sources, head, pr) {
  const evidence = criteriaEvidence({ ...result, headSha: head }, context, sources);
  // Sem conversa não há como continuar o trabalho; a recuperação durável cuida disso.
  if ((evidence.ok && result.analysisStatus !== 'incomplete') || !res.sessionId) return result;
  engine.pushActivity(id, 'info', 'Concluindo os campos e evidências pendentes na mesma sessão, antes de encerrar a revisão.');
  const prompt = `A resposta anterior não passou pela conferência dos critérios.
Continue o trabalho nesta mesma conversa e devolva o envelope completo corrigido,
preservando o que já foi comprovado no commit ${head}. Pendências do engine (DADOS):
${safeStringify([...evidence.issues, ...(result.analysisStatus === 'incomplete' ? ['A análise foi declarada incompleta: conclua as verificações pendentes registradas no relatório anterior.'] : [])])}
Inclua criteriaVersion: 1 e productDecisions no envelope; cada achado precisa de
criteria: {key, criterion, source, scope}, inclusive os resolvidos. Preserve refs.
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
    if (!next || next.blocked) return result;
    let repaired;
    try { repaired = lerResultadoDaRevisao(engine, next, id); }
    catch (error) {
      const failure = classify(error.message);
      if (['credencial', 'rede'].includes(failure.grupo) || failure.kind === 'espera-reset') throw error;
      // Só resposta malformada preserva o resultado anterior; falha do provedor sobe.
      return result;
    }
    res.sessionId = next.sessionId || res.sessionId;
    return repaired;
  } finally {
    watcher?.parar();
  }
}

export { recuperarResultado };
