// O que impede um review de sair, olhando o PR e não o texto (25/09/2026).
//
// Chamado por postReviewOnce (lib/engine/decision.js), que é a boca por onde toda
// via posta: revisão automática, clique, fila de reenvio, chat e co-assinatura. As travas do
// TEXTO (payload, linguagem interna) e da credencial continuam lá; aqui ficam as do PR.
//
// 1. PR que nenhuma conta cobre: postar com a primária seria falar com a identidade que
//    ninguém escolheu para aquela org (veio do postReviewOnce, onde nasceu na v2.62.0).
// 2. PR já mergeado ou fechado: o review decisivo não sai. A revisão conferia o estado só
//    antes de começar, e a sessão dura minutos; a auditoria de qualidade de 25/09/2026 achou
//    REQUEST_CHANGES postado 1min50s e 2min23s depois do merge (biud-esg#338,
//    infra-k8s#145). COMMENT continua saindo, porque comentar depois do merge pode ser o
//    pedido (chat). Estado desconhecido (rede, token) NÃO cancela: mesma regra do prState em
//    todo o Farol, falta de prova nunca vira "fechado".
const DECISIVOS = new Set(['APPROVE', 'REQUEST_CHANGES']);
const FECHADO = { MERGED: 'o PR já foi mergeado', CLOSED: 'o PR foi fechado sem merge' };

// Sem gh: roda no topo do postReviewOnce, antes de qualquer outra trava.
function recusaDaConta(engine, pr) {
  const atribuicao = typeof engine.atribuicaoDoPr === 'function' ? engine.atribuicaoDoPr(pr) : null;
  if (atribuicao && atribuicao.por === 'reserva') {
    engine.log('WARN', `postar review ${pr.key}: nenhuma conta do Farol cobre esta org; nada foi postado`);
    return { ok: false, blocked: 'sem_conta_dona', error: 'nenhuma conta do Farol cobre a org deste PR: adicione a org a uma conta em Sistema > Contas' };
  }
  return null;
}

// Com gh: roda DEPOIS das travas de texto e de credencial, logo antes do envio. A trava de
// linguagem é a primeira fronteira de propósito (nada de gh antes dela, travado em
// test/public-review-language.test.js), e esta é a última, a mais perto do envio.
async function recusaPorEstado(engine, pr, payload) {
  const evento = String((payload && payload.event) || '').toUpperCase();
  if (!DECISIVOS.has(evento) || typeof engine.prState !== 'function') return null;
  let estado = null;
  try { estado = await engine.prState(pr); } catch { estado = null; }
  if (!Object.hasOwn(FECHADO, String(estado))) return null;
  // sem linha no farol.log: PR que andou antes da postagem não é falha (invariante 3); o
  // motivo viaja no resultado e vira a razão da decisão
  return { ok: false, blocked: 'pr_fechado', attempted: false, estado, error: `${FECHADO[estado]}, então o review não foi postado` };
}

export default { recusaDaConta, recusaPorEstado };
export { recusaDaConta, recusaPorEstado };
