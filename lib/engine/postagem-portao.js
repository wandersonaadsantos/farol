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
// 3. Conta silenciada: novas ações são recusadas; revisões já admitidas podem concluir
//    com a permissão interna da sessão ou da decisão persistida no mesmo commit.
//    A via automática já parava antes (travaDoRound, toReview), mas o clique, o chat e o
//    terminal chegavam aqui com a conta resolvida pela org, e a org resolvia para a primeira
//    conta que a cobre, silenciada ou não (lib/engine/conta-que-age.js).
// 4. PR da própria conta que revisa (17/10/2026, v2.72.6, revisão do PR #248): o GitHub não
//    aceita APPROVE nem REQUEST_CHANGES do autor, então o decisivo não sai por via nenhuma
//    (clique, reenvio, chat, espera do CI). COMMENT continua saindo: comentar o próprio PR pode.
import { recusaDeSilenciada } from './conta-que-age.js';
import { podeConcluir } from './continuidade-revisao.js';
import { ehMeu, textoDoPrProprio } from './pr-proprio.js';

const DECISIVOS = new Set(['APPROVE', 'REQUEST_CHANGES']);
const FECHADO = { MERGED: 'o PR já foi mergeado', CLOSED: 'o PR foi fechado sem merge' };

// Conta que não se resolve (engine sem config, teste montado à mão) não prova nada: falta de
// dado nunca bloqueia, e o recordDecision também grava a marca por aqui sem poder lançar.
function ehDaContaQueRevisa(engine, pr) {
  if (!pr || typeof engine?.accountForPr !== 'function') return false;
  try { return ehMeu(engine, pr); } catch { return false; /* conta não resolvida: não é prova de PR próprio */ }
}

function recusaDePrProprio(engine, pr, payload) {
  const evento = String((payload && payload.event) || '').toUpperCase();
  if (!DECISIVOS.has(evento) || !ehDaContaQueRevisa(engine, pr)) return null;
  const veredito = evento === 'REQUEST_CHANGES' ? 'request_changes' : 'approve';
  return { ok: false, blocked: 'pr_proprio', attempted: false, error: textoDoPrProprio(engine.accountForPr(pr), veredito) };
}

// Sem gh: roda no topo do postReviewOnce, antes de qualquer outra trava.
function recusaDaConta(engine, pr, payload, continuidade) {
  const proprio = recusaDePrProprio(engine, pr, payload);
  if (proprio) return proprio;
  const atribuicao = typeof engine.atribuicaoDoPr === 'function' ? engine.atribuicaoDoPr(pr) : null;
  if (atribuicao && atribuicao.por === 'reserva') {
    engine.log('WARN', `postar review ${pr.key}: nenhuma conta do Farol cobre esta org; nada foi postado`);
    return { ok: false, blocked: 'sem_conta_dona', error: 'nenhuma conta do Farol cobre a org deste PR: adicione a org a uma conta em Sistema > Contas' };
  }
  if (podeConcluir(engine, pr, payload, continuidade)) return null;
  const silenciada = recusaDeSilenciada(engine, atribuicao ? atribuicao.conta : engine.accountForPr?.(pr));
  if (silenciada) engine.log('WARN', `postar review ${pr.key}: ${silenciada.error}; nada foi postado`);
  return silenciada;
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

export default { recusaDaConta, recusaPorEstado, ehDaContaQueRevisa };
export { recusaDaConta, recusaPorEstado, ehDaContaQueRevisa };
