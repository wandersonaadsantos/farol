// Vigia da sessao: abandonar cedo o que ja virou trabalho perdido (23/09/2026).
//
// Medido nos 25 reviews de biudtech/infra-k8s deste aparelho: duas passadas inteiras
// foram pro lixo porque o mundo andou DURANTE a sessao. A de #145 rodou 16m55 e custou
// US$ 3,37 pra terminar como `already_reviewed` (a revisao ja existia quando o envelope
// chegou); a de #150 rodou 8m31 e custou US$ 2,74 pra terminar como `superseded` (commit
// novo). Nos dois casos o Farol so descobriu NO FIM, depois de pagar a sessao inteira.
//
// O vigia pergunta de tempos em tempos as duas coisas que tornam a sessao inutil: o head
// ainda e o mesmo? eu ja revisei este head? Se alguma responde que sim, cancela a sessao
// e deixa o desfecho carimbado pro runOneHeadless tratar sem estacionar.
//
// Falta de dado NUNCA abandona: erro de rede na checagem devolve "nao sei", e nao sei
// mantem a sessao viva. Abandonar trabalho pago por causa de um `gh` que falhou seria
// trocar um desperdicio raro por um desperdicio a cada queda de rede.
import { TEMPOS } from '../constants.js';
import { DECISIVE_REVIEW_STATES } from './decision.js';

const MOTIVOS = { HEAD: 'head-novo', REVISADO: 'ja-revisado', FECHADO: 'pr-fechado', LABEL: 'label-retirada' };

// PURA: o estado novo torna esta sessao inutil? `headAgora` vazio e "nao sei", nunca
// "mudou"; `meusEstados` null e "nao sei", nunca "nao revisei" (o mesmo contrato que o
// myReviewStates ja usa no dedup).
// `porClique`: revisão pedida por clique num head que eu já revisei é o "refaça o review" de
// propósito, e o invariante 4 diz que clique nunca é barrado pelos gates automáticos. O gate
// de antes de abrir já respeitava isso (`!pr.manual` no runOneHeadless); o vigia, com a
// sessão aberta, não respeitava, e matava a revisão pedida depois de minutos pagos (medido em
// 27/09/2026). Commit novo continua encerrando: aí o head revisado já passou, clique ou não.
// PR mergeado ou fechado encerra até a revisão pedida por clique: não há mais onde postar
// (medido em biudtech/biud-frontend#1627, 30/10/2026: mergeado às 11:47, a sessão seguiu
// pagando até 12:01). `estadoAgora` vazio ou null é "não sei" e nunca encerra.
function decidir({ headInicial, headAgora, meusEstados, estadoAgora = '', porClique = false, labelPropria = '', labelsAgora = null }) {
  if (estadoAgora === 'MERGED' || estadoAgora === 'CLOSED') {
    return { abandonar: true, motivo: MOTIVOS.FECHADO };
  }
  if (headInicial && headAgora && headAgora !== headInicial) {
    return { abandonar: true, motivo: MOTIVOS.HEAD };
  }
  // DECIDIR sobre o head, e nao ter comentado nele: `myReviewStates` devolve COMMENTED
  // junto, e comentar nao decide nada (pergunta ao autor, recado de "vou olhar"). A tabela
  // e a do decision.js, exportada de la exatamente porque quem pergunta "ja decidi sobre
  // este head?" nao pode ter tabela propria.
  if (!porClique && Array.isArray(meusEstados) && meusEstados.some((x) => DECISIVE_REVIEW_STATES.has(x))) {
    return { abandonar: true, motivo: MOTIVOS.REVISADO };
  }
  // depois de "já revisado": a label tirada por quem já decidiu este head não é pedido para parar
  // Quem tirou a label `<conta>:revisando` do PR pediu para parar (a label é o sinal
  // escrito de revisão em andamento). Label ainda não posta (`labelPropria` vazia) e leitura
  // sem lista (`labelsAgora` null) são "não sei" e nunca encerram; a caixa é ignorada porque
  // o GitHub não distingue.
  if (labelPropria && Array.isArray(labelsAgora)
    && !labelsAgora.some((l) => String(l).toLowerCase() === String(labelPropria).toLowerCase())) {
    return { abandonar: true, motivo: MOTIVOS.LABEL };
  }
  return { abandonar: false, motivo: '' };
}

function registro(engine) {
  if (!(engine.abandonosDeSessao instanceof Map)) engine.abandonosDeSessao = new Map();
  return engine.abandonosDeSessao;
}

function abandonoDe(engine, key) {
  const marca = registro(engine).get(key);
  return (typeof marca === 'string' ? marca : marca?.motivo) || '';
}
function consumirAbandono(engine, key) { registro(engine).delete(key); }
// Quem cancela por fora do vigia (a tela de tags) registra o motivo antes, para cair no mesmo
// estacionamento, com a chave da sessão em `activeReviews`.
function marcarAbandono(engine, key, motivo, sessao = '') {
  registro(engine).set(key, sessao ? { motivo, sessao } : motivo);
}
// O cancelamento de uma sessão larga a marca presa a OUTRA sessão do mesmo PR: a que concluiu
// sem ler o próprio cancelamento deixou a marca, e ela não pode virar o motivo deste.
function largarMarcaDeOutra(engine, keys, sessao) {
  for (const key of keys || []) {
    const marca = registro(engine).get(key);
    if (marca && typeof marca === 'object' && marca.sessao !== sessao) registro(engine).delete(key);
  }
}

// Uma rodada de vigia. Separada do relogio pra poder ser exercitada sem timer.
async function conferir(engine, pr, id, headInicial, labelAtual = () => '', aindaVivo = () => true) {
  // capturada ANTES de qualquer leitura: a label pode entrar durante elas (admissão tardia),
  // e comparar uma lista lida antes com uma label lida depois encerraria sem ninguém tirar nada
  const labelPropria = labelAtual() || '';
  let headAgora = '';
  let meusEstados = null;
  try { headAgora = await engine.headSha(pr); } catch { headAgora = ''; }
  let estadoAgora = '';
  let labelsAgora = null;
  try {
    const lido = await engine.prEstadoELabels(pr);
    if (lido) { estadoAgora = lido.estado || ''; labelsAgora = Array.isArray(lido.labels) ? lido.labels : null; }
  } catch { estadoAgora = ''; labelsAgora = null; }
  try { meusEstados = await engine.myReviewStates(pr, headInicial); } catch { meusEstados = null; }
  const d = decidir({ headInicial, headAgora, meusEstados, estadoAgora, porClique: !!pr.manual, labelPropria, labelsAgora });
  if (!d.abandonar) return d;
  // o vigia foi parado durante as leituras: a sessão já terminou, não há o que cancelar
  if (!aindaVivo()) return { abandonar: false, motivo: '' };
  registro(engine).set(pr.key, d.motivo);
  engine.pushActivity(id, 'info', {
    [MOTIVOS.HEAD]: 'Chegou commit novo no PR: encerrando esta sessão em vez de revisar um head que já passou.',
    [MOTIVOS.REVISADO]: 'A revisão deste head já existe: encerrando esta sessão em vez de refazer o que está feito.',
    [MOTIVOS.LABEL]: 'A label de revisão foi retirada do PR: encerrando esta sessão, porque quem a tirou pediu para parar.',
    [MOTIVOS.FECHADO]: 'O PR foi mergeado ou fechado: encerrando esta sessão, porque não há mais onde postar a revisão.',
  }[d.motivo]);
  engine.cancelSession(id);
  return d;
}

// A MESMA pergunta, feita ANTES de abrir a sessao. Ate 24/09/2026 ela so era feita duas
// vezes: pelo vigia, com a sessao ja rodando, e pelo decide(), com a sessao ja paga. O
// re-pedido de revisao no mesmo head caia entre as duas: o `requested` voltava a true, o PR
// reentrava na fila automatica e a resposta so chegava no fim (medido em
// biudtech/engine-ai#273: aprovado as 12:32, re-pedido as 12:59 sem commit novo, duas
// sessoes abertas, nada postado).
//
// Falta de dado nunca cala um round: sem head, com a consulta falhando ou com `null` (que
// e "nao deu pra confirmar"), devolve false e a sessao abre como sempre.
async function jaRevisado(engine, pr) {
  try {
    const head = await engine.headSha(pr);
    if (!head) return false;
    const meusEstados = await engine.myReviewStates(pr, head);
    return decidir({ headInicial: head, headAgora: head, meusEstados }).motivo === MOTIVOS.REVISADO;
  } catch {
    return false; // conferencia que falha nunca derruba a revisao
  }
}

// Nao ha o que revisar neste head: o PR sai da fila automatica SEM estacionar, e volta
// sozinho quando o head mudar. Os dois momentos em que isso acontece (o vigia, com a
// sessao rodando, e o gate antes de abrir) fazem exatamente a mesma coisa.
function sairDeCena(engine, pr, texto) {
  engine.markSeen(pr.key);
  engine.queue = engine.queue.filter((p) => p.key !== pr.key);
  engine.emit('toast', { kind: 'info', text: texto });
}

// Liga o relogio enquanto a sessao roda. Devolve o `parar`, que o chamador chama no
// finally: vigia que sobrevive a sessao ficaria consultando o GitHub sobre PR que
// ninguem esta revisando.
function iniciar(engine, pr, id, headInicial, { intervaloMs = TEMPOS.VIGIA_SESSAO_MS, labelAtual = () => '' } = {}) {
  if (!headInicial) return { parar() { } };  // sem head de partida nao ha o que comparar
  let vivo = true;
  const timer = setInterval(() => {
    if (!vivo) return;
    conferir(engine, pr, id, headInicial, labelAtual, () => vivo).catch(() => { /* vigia nunca derruba a sessao */ });
  }, intervaloMs);
  if (typeof timer.unref === 'function') timer.unref();
  return {
    parar() { vivo = false; clearInterval(timer); }
  };
}

export default { MOTIVOS, decidir, conferir, jaRevisado, sairDeCena, iniciar, abandonoDe, consumirAbandono, marcarAbandono, largarMarcaDeOutra };
export { MOTIVOS, decidir, conferir, jaRevisado, sairDeCena, iniciar, abandonoDe, consumirAbandono, marcarAbandono, largarMarcaDeOutra };
