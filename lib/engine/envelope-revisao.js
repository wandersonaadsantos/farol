// O conteúdo do envelope da revisão, depois de ele estar no contrato (03/10/2026: saiu do
// session.js, que cuida da sessão e não do que ela escreveu). Duas conferências, nesta ordem:
// a sessão que descreveu a própria morte por infra lança (para o retry tratar), e o que só
// uma pessoa decide entra no texto do APPROVE (para-quem-mergeia.js).
import { classify, DESCONHECIDO } from '../log-taxonomy.js';
import { comParaQuemMergeia } from './para-quem-mergeia.js';

// Sessão que MORRE de infra lança, e o retryAfterNet/estacionamento trata. Sessão que
// SOBREVIVE à infra e descreve a morte dos próprios lotes num envelope bem-formado não
// lançava nada: o Farol gravava a falha de credencial como veredito e o PR virava card
// mudo de "precisa de você". Foi o Edicoes-CNBB/biblioteca-cnbb-ai-engine#13 de
// 10/09/2026 (quatro lotes mortos com OAuth expirado, 24 "pendências" que ninguém leu).
//
// O gatilho é ESTREITO de propósito, porque o custo de um falso positivo é jogar fora
// uma revisão paga. Exige as TRÊS coisas ao mesmo tempo:
//   1. analysisStatus incomplete (envelope completo jamais é tocado);
//   2. nenhum conteúdo em nenhum payload (nem corpo, nem comentário de linha) — revisão
//      parcial que escreveu achado é revisão, e segue pro gate de cobertura do review.js;
//   3. a prosa classificada pela MESMA tabela do resto do app (log-taxonomy) como
//      credencial, rede ou espera-reset. Envelope mudo sem assinatura de infra continua
//      caindo no gate de 'analise_incompleta', como sempre.
// Devolve a mensagem a relançar (pra classify lá na ponta ver o mesmo texto) ou ''.
function falhaDeInfraNoEnvelope(data) {
  if (data.analysisStatus !== 'incomplete') return '';
  const payloads = data.payloads || {};
  const temConteudo = Object.values(payloads).some(p =>
    p && (String(p.body || '').trim() !== '' || (Array.isArray(p.comments) && p.comments.length > 0)));
  if (temConteudo) return '';
  const prosa = `${data.reportMarkdown || ''}\n${data.reviewMarkdown || ''}`;
  const classe = classify(prosa);
  const infra = classe.grupo === 'credencial' || classe.grupo === 'rede' || classe.kind === 'espera-reset';
  if (!infra) return '';
  return `a sessão não analisou nada e reportou falha de infraestrutura (${classe.label}): ${trechoDaFalha(prosa)}`;
}

// O texto que casou, não a prosa inteira: quem lê o farol.log e o Diagnóstico precisa
// da frase do provedor, e o relatório do revisor tem parágrafos que só atrapalhariam.
function trechoDaFalha(prosa) {
  const linha = prosa.split('\n').find(l => classify(l).id !== DESCONHECIDO.id);
  return (linha || prosa).trim().slice(0, 300);
}

function conferirEnvelope(data) {
  const infra = falhaDeInfraNoEnvelope(data);
  if (infra) throw new Error(infra);
  return comParaQuemMergeia(data);
}

export default { conferirEnvelope, falhaDeInfraNoEnvelope };
export { conferirEnvelope, falhaDeInfraNoEnvelope };
