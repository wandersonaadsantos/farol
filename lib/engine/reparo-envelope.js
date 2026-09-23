// Reparo do envelope: UMA rodada quando a sessao termina em prosa (23/09/2026).
//
// Duas falhas medidas no aparelho do Wanderson (state/falhas-sessao.json): uma sessao
// de 10m17 devolveu 166 caracteres de texto e outra de 14m56 devolveu 97. As duas
// tinham passado por todas as etapas (preparo, leitura, card, verificacao, raciocinio)
// e nao entregaram o envelope JSON. O Farol descartava a sessao inteira e estacionava
// o PR: o trabalho inteiro perdido por causa da ultima mensagem.
//
// O reparo e barato (nao rele o diff: e --resume da mesma conversa) e ESTREITO:
//   - so quando NAO ha envelope nenhum (FAROL_RESULT_MISSING). JSON quebrado, ambiguo
//     ou fora do contrato continua falha de contrato, porque ali reparar seria escolher
//     um veredito no meio de texto malformado;
//   - so com sid: sem a conversa anterior o "reparo" seria uma revisao nova as cegas,
//     que e exatamente o que o invariante 4 nao aceita;
//   - UMA vez. Nunca vira laco, e falha do reparo nunca vira erro novo: quem manda no
//     desfecho continua sendo a falha de contrato original.
//
// O prompt tambem e estreito: ele PROIBE concluir o que nao foi verificado. Uma sessao
// que morreu no meio tem que sair como incompleta, nao como aprovacao.

const PROMPT_REPARO = `A sua última resposta veio em prosa, e o Farol precisa do resultado estruturado.

Responda AGORA apenas o envelope JSON do protocolo desta sessão, no mesmo formato já
combinado aqui, refletindo exatamente o trabalho que você já fez nesta conversa.

Regras:
- Nada de texto fora do JSON: nem explicação, nem desculpa, nem resumo.
- Não invente evidência e não conclua o que você não verificou. Se a verificação ficou
  pela metade, o envelope sai com "analysisStatus": "incomplete" e
  "decision": "needs_decision", dizendo no relatório o que ficou faltando.
- Isto não é uma revisão nova: é o registro do que já aconteceu.`;

// Pede o envelope de novo, na MESMA sessao. Devolve o resultado da sessao de reparo, ou
// null quando nao ha reparo a tentar (e ai o chamador estaciona com a falha original).
async function pedirEnvelope(engine, err, res, id, streamOpts) {
  if (!err || err.code !== 'FAROL_RESULT_MISSING') return null;
  const sid = res && res.sessionId;
  if (!sid) return null;
  engine.pushActivity(id, 'info',
    'A sessão terminou em prosa, sem o resultado estruturado: pedindo só o envelope, na mesma sessão.');
  // sem onAdmitted: a vaga e a label ja sao desta revisao, e repetir a admissao aqui
  // faria o reparo disputar consigo mesmo
  const opts = { ...streamOpts, extraArgs: [...(streamOpts.extraArgs || []), '--resume', sid] };
  delete opts.onAdmitted;
  try {
    const novo = (await engine.runClaudeStream(PROMPT_REPARO, opts)) || {};
    // bloqueio de admissao/coordenacao no reparo nao e resultado: cai na falha original
    return novo.blocked ? null : novo;
  } catch (e2) {
    // o reparo e opcional por definicao: a falha dele nao pode substituir o diagnostico
    // da falha que ele tentou consertar
    void e2;
    return null;
  }
}

export default { PROMPT_REPARO, pedirEnvelope };
export { PROMPT_REPARO, pedirEnvelope };
