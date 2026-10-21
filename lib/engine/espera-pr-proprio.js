// Espera automática em PR da própria conta que revisa (17/10/2026; sem mesa desde 18/10/2026).
//
// Caso medido no celular (v2.72.5): biudtech/biud-frontend#1479 era da conta que revisava e
// ficou em "Aprova sozinho (esperando o CI ou a prova)". O GitHub não aceita APPROVE nem
// REQUEST_CHANGES do autor, então nenhuma prova e nenhum CI verde destravam aquela espera.
// Desde a v2.72.6 o gate de postagem (approval-policy.js) não arma espera nesse caso; aqui sai
// a espera que já existia, do CI ou da prova.
//
// A decisão sem mesa (18/10/2026): com a política da classe automática (aprova sozinho para o
// veredito aprovar, reprova sozinho para pedir mudanças) e a revisão vinda do dono, a revisão
// sai como COMMENT, que o GitHub aceita do autor, e a pendência é resolvida como
// `commented_own_pr`. Falha passageira arma o reenvio de sempre (`postRetry` do evento
// `comment`). A mesa sobra para a política em "espera você" e para a falha permanente ao
// postar, dita no card como infra.
//
// O autor vem do item gravado; sem ele, da leitura do PR que a espera da prova já faz no ciclo
// (`autorLido`). Falta de dado nunca larga nada.
import { classify } from '../log-taxonomy.js';
import { ehMeu, ehPrProprio, textoDoPrProprio } from './pr-proprio.js';
import { origemDoDono, payloadDoPrProprio } from './desfecho-automatico.js';
import { comentarioJaPublicado } from './comentario-proprio.js';

function semMotivoDaEspera(reasons) {
  return (Array.isArray(reasons) ? reasons : []).filter((r) => !(r && typeof r === 'object' && r.espera === true));
}

function ehDaContaQueRevisa(engine, item, autorLido) {
  const pr = { ...(item.pr || {}), key: item.key };
  if (autorLido) return ehPrProprio(autorLido, engine.accountForPr(pr));
  return ehMeu(engine, pr);
}

// A política da classe deste resultado manda sair sozinho?
function politicaAutomatica(engine, d, conta) {
  if (d.verdict === 'request_changes') return engine.rejectPolicyFor(conta) === 'request_changes';
  const pontos = d.esperaCi ? d.esperaCi.pontos : null;
  const limpo = d.esperaProva ? d.esperaProva.limpo !== false : !(Array.isArray(pontos) && pontos.length);
  return engine.approvePolicyFor(conta, limpo) === 'approve';
}

const PRECISA_DE_OUTRA = (key) => `🟡 ${key} precisa de outra pessoa: o PR é da própria conta que revisa, e o GitHub não aceita a revisão do autor.`;

function largarEsperas(d) {
  d.esperaProva = null;
  d.esperaCi = null;
  d.prProprio = true;
  // a rodada complementar da busca da prova (stale_head no MESMO head) também sai: sem isto a
  // tela mostrava o card de commit novo e o round automático seguia mirando o PR (revisão do PR #248)
  if (d.blockedKind === 'stale_head' && d.blockedHead === d.headSha) {
    delete d.blockedKind; delete d.blockedHead; delete d.headQuietoDesde;
  }
}

function paraAMesa(engine, d, motivo, toast = `🟡 ${d.key} precisa da sua atenção: ${motivo.text}`) {
  d.reasons = [motivo, ...semMotivoDaEspera(d.reasons)];
  engine.saveDecisions();
  const publico = engine.decisionForUi(d);
  engine.emit('needs-decision', { pr: { ...d.pr, key: d.key }, item: publico });
  engine.emit('toast', { kind: 'info', text: toast });
}

function resolverComoComentado(engine, d, idx) {
  engine.decisions.pending.splice(idx, 1);
  const resolvido = { ...d, status: 'commented_own_pr', action: 'comment', postRetry: null, reasons: semMotivoDaEspera(d.reasons) };
  engine.resolveIntoHistory(resolvido);
  engine.saveDecisions();
  engine.writeMemory(resolvido, 'COMMENT');
  engine.emit('auto-commented', { pr: { ...d.pr, key: d.key }, result: engine.decisionForUi(resolvido) });
  engine.emit('toast', { kind: 'ok', text: `💬 ${d.key}: o PR é da própria conta que revisa, então a revisão saiu como comentário.` });
}

// Posta o COMMENT do PR próprio. Devolve sem lançar; o estado da pendência diz o desfecho.
async function comentar(engine, d, conta) {
  const payload = payloadDoPrProprio(d);
  const pr = { ...(d.pr || {}), key: d.key };
  if (!payload || !d.headSha) return paraAMesa(engine, d, { text: textoDoPrProprio(conta, d.verdict), kind: 'gate' });
  d.payloads = { ...(d.payloads || {}), comment: payload };
  // o mesmo texto já está no PR neste commit: não repete (comentario-proprio.js)
  const jaSaiu = await comentarioJaPublicado(engine, pr, d.headSha, payload.body);
  const idx = engine.decisions.pending.findIndex((x) => x.id === d.id);
  if (idx < 0) return undefined;
  if (jaSaiu === true) return resolverComoComentado(engine, d, idx);
  const post = await engine.postReview(pr, { ...payload, commit_id: d.headSha }, { via: 'espera-ci', continuidade: d });
  const agora = engine.decisions.pending.findIndex((x) => x.id === d.id);
  if (agora < 0) return undefined;
  if (post.ok) return resolverComoComentado(engine, d, agora);
  if (classify(String(post.error || '')).kind === 'transitorio') {
    d.postRetry = { event: 'comment', attempts: 0 };
    d.reasons = [{ text: `falha ao postar o comentário no PR da própria conta: ${post.error}`, kind: 'infra' }, ...semMotivoDaEspera(d.reasons)];
    engine.saveDecisions();
    return undefined;
  }
  return paraAMesa(engine, d, { text: `falha ao postar o comentário no PR da própria conta: ${post.error || 'erro desconhecido'}`, kind: 'infra' });
}

// Devolve 1 quando tratou a espera do item (comentou, armou o reenvio ou largou), 0 quando o PR
// não é da conta que revisa.
async function largarSeForPrProprio(engine, item, autorLido = '') {
  if (!item || !(item.esperaProva || item.esperaCi) || !ehDaContaQueRevisa(engine, item, autorLido)) return 0;
  const idx = engine.decisions.pending.findIndex((d) => d.id === item.id);
  if (idx < 0) return 0;
  const d = engine.decisions.pending[idx];
  const conta = engine.accountForPr({ ...(d.pr || {}), key: d.key });
  const automatica = origemDoDono(d.pr) && politicaAutomatica(engine, d, conta);
  largarEsperas(d);
  engine.log('INFO', `${d.key}: espera automática largada, o PR é da própria conta que revisa (${conta}).`);
  if (automatica) await comentar(engine, d, conta);
  else paraAMesa(engine, d, { text: textoDoPrProprio(conta, d.verdict), kind: 'gate' }, PRECISA_DE_OUTRA(d.key));
  return 1;
}

// A varredura do ciclo, antes das esperas do CI e da prova: só o autor gravado.
async function largarEsperasDePrProprio(engine) {
  const esperando = engine.decisions.pending.filter((d) => d && (d.esperaProva || d.esperaCi));
  let largadas = 0;
  for (const item of esperando) largadas += await largarSeForPrProprio(engine, item);
  return largadas;
}

export default { largarSeForPrProprio, largarEsperasDePrProprio };
export { largarSeForPrProprio, largarEsperasDePrProprio };
