// Espera automática em PR da própria conta que revisa: larga e vai para a mesa (17/10/2026).
//
// Caso medido no celular (v2.72.5): biudtech/biud-frontend#1479 era da conta que revisava e
// ficou em "Aprova sozinho (esperando o CI ou a prova)". O GitHub não aceita APPROVE nem
// REQUEST_CHANGES do autor, então nenhuma prova e nenhum CI verde destravam aquela espera.
// Desde a v2.72.6 o gate de postagem (approval-policy.js) não arma espera nesse caso; aqui sai
// a espera que já existia, do CI ou da prova: a marca é largada, o card vai para a mesa com o
// motivo dito e o `needs-decision` sai uma vez (sem marca, a varredura não volta a ver o item).
//
// O autor vem do item gravado; sem ele, da leitura do PR que a espera da prova já faz no ciclo
// (`autorLido`). Falta de dado nunca larga nada.
import { ehMeu, ehPrProprio, textoDoPrProprio } from './pr-proprio.js';

function semMotivoDaEspera(reasons) {
  return (Array.isArray(reasons) ? reasons : []).filter((r) => !(r && typeof r === 'object' && r.espera === true));
}

function ehDaContaQueRevisa(engine, item, autorLido) {
  const pr = { ...(item.pr || {}), key: item.key };
  if (autorLido) return ehPrProprio(autorLido, engine.accountForPr(pr));
  return ehMeu(engine, pr);
}

// Devolve 1 quando largou a espera do item, 0 quando o PR não é da conta que revisa.
function largarSeForPrProprio(engine, item, autorLido = '') {
  if (!item || !(item.esperaProva || item.esperaCi) || !ehDaContaQueRevisa(engine, item, autorLido)) return 0;
  const idx = engine.decisions.pending.findIndex((d) => d.id === item.id);
  if (idx < 0) return 0;
  const d = engine.decisions.pending[idx];
  const conta = engine.accountForPr({ ...(d.pr || {}), key: d.key });
  d.esperaProva = null;
  d.esperaCi = null;
  d.prProprio = true;
  // a rodada complementar da busca da prova (stale_head no MESMO head) também sai: sem isto a
  // tela mostrava o card de commit novo e o round automático seguia mirando o PR (revisão do PR #248)
  if (d.blockedKind === 'stale_head' && d.blockedHead === d.headSha) {
    delete d.blockedKind; delete d.blockedHead; delete d.headQuietoDesde;
  }
  d.reasons = [{ text: textoDoPrProprio(conta, d.verdict), kind: 'gate' }, ...semMotivoDaEspera(d.reasons)];
  engine.saveDecisions();
  engine.log('INFO', `${d.key}: espera automática largada, o PR é da própria conta que revisa (${conta}).`);
  const publico = engine.decisionForUi(d);
  engine.emit('needs-decision', { pr: d.pr, item: publico });
  engine.emit('toast', { kind: 'info', text: `🟡 ${d.key} precisa de outra pessoa: o PR é da própria conta que revisa, e o GitHub não aceita a revisão do autor.` });
  return 1;
}

// A varredura do ciclo, antes das esperas do CI e da prova: só o autor gravado, sem rede.
function largarEsperasDePrProprio(engine) {
  const esperando = engine.decisions.pending.filter((d) => d && (d.esperaProva || d.esperaCi));
  let largadas = 0;
  for (const item of esperando) largadas += largarSeForPrProprio(engine, item);
  return largadas;
}

export default { largarSeForPrProprio, largarEsperasDePrProprio };
export { largarSeForPrProprio, largarEsperasDePrProprio };
