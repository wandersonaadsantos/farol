// Reparo do envelope: UMA rodada quando a sessao termina em prosa (23/09/2026).
//
// Duas falhas medidas no aparelho do Wanderson (state/falhas-sessao.json): uma sessao
// de 10m17 devolveu 166 caracteres de texto e outra de 14m56 devolveu 97. As duas
// tinham passado por todas as etapas (preparo, leitura, card, verificacao, raciocinio)
// e nao entregaram o envelope JSON. O Farol descartava a sessao inteira e estacionava
// o PR: o trabalho inteiro perdido por causa da ultima mensagem.
//
// O reparo e barato (nao rele o diff: e --resume da mesma conversa) e ESTREITO:
//   - so quando NAO ha envelope nenhum (FAROL_RESULT_MISSING) ou quando o envelope veio com
//     ERRO DE SINTAXE (05/10/2026, ver abaixo). Ambiguo (dois blocos) ou fora do contrato
//     continua falha de contrato, porque ali o Farol teria de escolher entre conteudos;
//   - so com sid: sem a conversa anterior o "reparo" seria uma revisao nova as cegas,
//     que e exatamente o que o invariante 4 nao aceita;
//   - UMA vez. Nunca vira laco, e falha do reparo nunca vira erro novo: quem manda no
//     desfecho continua sendo a falha de contrato original.
//
// O prompt tambem e estreito: ele PROIBE concluir o que nao foi verificado. Uma sessao
// que morreu no meio tem que sair como incompleta, nao como aprovacao.
//
// SINTAXE (05/10/2026). Duas revisoes de 05/10 (de 12 e de 14 minutos) devolveram o envelope
// inteiro com UM caractere a mais no fim da lista `alcance` (uma aspa depois do `]`, num caso;
// um `]` a mais, no outro) e foram descartadas. O motivo antigo para nao reparar ("reparar
// seria escolher um veredito no meio de texto malformado") nao vale aqui: o Farol nao conserta
// texto nem escolhe nada, ele pede a MESMA sessao que escreva de novo o envelope que ela ja
// escreveu, e a resposta passa pelo mesmo parser e pelos mesmos gates de qualquer envelope.
// O erro que o parser deu (so a posicao, sem conteudo) vai junto, para a sessao saber onde.
const SINTAXE = /^JSON da sessão (?:inválido|com bloco json não encerrado)$/;

const PROMPT_REPARO = `A sua última resposta veio em prosa, e o Farol precisa do resultado estruturado.

Responda AGORA apenas o envelope JSON do protocolo desta sessão, no mesmo formato já
combinado aqui, refletindo exatamente o trabalho que você já fez nesta conversa.

Regras:
- Nada de texto fora do JSON: nem explicação, nem desculpa, nem resumo.
- Não invente evidência e não conclua o que você não verificou. Se a verificação ficou
  pela metade, o envelope sai com "analysisStatus": "incomplete" e
  "decision": "needs_decision", dizendo no relatório o que ficou faltando.
- Isto não é uma revisão nova: é o registro do que já aconteceu.`;

const PROMPT_REPARO_SINTAXE = (detalhe) => `A sua última resposta trouxe o envelope JSON com erro de sintaxe, e o Farol não consegue ler.${detalhe ? ` O leitor parou aqui: ${detalhe}.` : ''}

Responda AGORA apenas o envelope JSON desta sessão, com o MESMO conteúdo que você já escreveu,
corrigindo só a sintaxe: aspas, vírgulas, colchetes e chaves fechando no lugar certo, em
especial nas listas aninhadas (alcance e chamadores, coverage).

Regras:
- Nada de texto fora do JSON: nem explicação, nem desculpa, nem resumo.
- Não mude veredito, decisão, motivos nem textos: isto é a mesma resposta, bem formada.
- Não invente evidência e não conclua o que você não verificou. Se a verificação ficou
  pela metade, o envelope sai com "analysisStatus": "incomplete" e
  "decision": "needs_decision", dizendo no relatório o que ficou faltando.`;

// Qual reparo cabe nesta falha: 'prosa', 'sintaxe' ou '' (nenhum).
function tipoDoReparo(err) {
  if (!err) return '';
  if (err.code === 'FAROL_RESULT_MISSING') return 'prosa';
  return SINTAXE.test(String(err.message || '')) ? 'sintaxe' : '';
}

// Pede o envelope de novo, na MESMA sessao. Devolve o resultado da sessao de reparo, ou
// null quando nao ha reparo a tentar (e ai o chamador estaciona com a falha original).
async function pedirEnvelope(engine, err, res, id, streamOpts) {
  const tipo = tipoDoReparo(err);
  if (!tipo) return null;
  const sid = res && res.sessionId;
  if (!sid) return null;
  engine.pushActivity(id, 'info', tipo === 'prosa'
    ? 'A sessão terminou em prosa, sem o resultado estruturado: pedindo só o envelope, na mesma sessão.'
    : 'O envelope veio com erro de sintaxe: pedindo o mesmo envelope bem formado, na mesma sessão.');
  const prompt = tipo === 'prosa' ? PROMPT_REPARO : PROMPT_REPARO_SINTAXE(err.detalhe);
  // sem onAdmitted: a vaga e a label ja sao desta revisao, e repetir a admissao aqui
  // faria o reparo disputar consigo mesmo
  const opts = { ...streamOpts, extraArgs: [...(streamOpts.extraArgs || []), '--resume', sid] };
  delete opts.onAdmitted;
  try {
    const novo = (await engine.runClaudeStream(prompt, opts)) || {};
    // bloqueio de admissao/coordenacao no reparo nao e resultado: cai na falha original
    return novo.blocked ? null : novo;
  } catch (e2) {
    // o reparo e opcional por definicao: a falha dele nao pode substituir o diagnostico
    // da falha que ele tentou consertar
    void e2;
    return null;
  }
}

export default { PROMPT_REPARO, PROMPT_REPARO_SINTAXE, tipoDoReparo, pedirEnvelope };
export { PROMPT_REPARO, PROMPT_REPARO_SINTAXE, tipoDoReparo, pedirEnvelope };
