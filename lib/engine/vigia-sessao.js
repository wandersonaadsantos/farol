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

const MOTIVOS = { HEAD: 'head-novo', REVISADO: 'ja-revisado' };

// PURA: o estado novo torna esta sessao inutil? `headAgora` vazio e "nao sei", nunca
// "mudou"; `meusEstados` null e "nao sei", nunca "nao revisei" (o mesmo contrato que o
// myReviewStates ja usa no dedup).
function decidir({ headInicial, headAgora, meusEstados }) {
  if (headInicial && headAgora && headAgora !== headInicial) {
    return { abandonar: true, motivo: MOTIVOS.HEAD };
  }
  // DECIDIR sobre o head, e nao ter comentado nele: `myReviewStates` devolve COMMENTED
  // junto, e comentar nao decide nada (pergunta ao autor, recado de "vou olhar"). A tabela
  // e a do decision.js, exportada de la exatamente porque quem pergunta "ja decidi sobre
  // este head?" nao pode ter tabela propria.
  if (Array.isArray(meusEstados) && meusEstados.some((x) => DECISIVE_REVIEW_STATES.has(x))) {
    return { abandonar: true, motivo: MOTIVOS.REVISADO };
  }
  return { abandonar: false, motivo: '' };
}

function registro(engine) {
  if (!(engine.abandonosDeSessao instanceof Map)) engine.abandonosDeSessao = new Map();
  return engine.abandonosDeSessao;
}

function abandonoDe(engine, key) { return registro(engine).get(key) || ''; }
function consumirAbandono(engine, key) { registro(engine).delete(key); }

// Uma rodada de vigia. Separada do relogio pra poder ser exercitada sem timer.
async function conferir(engine, pr, id, headInicial) {
  let headAgora = '';
  let meusEstados = null;
  try { headAgora = await engine.headSha(pr); } catch { headAgora = ''; }
  try { meusEstados = await engine.myReviewStates(pr, headInicial); } catch { meusEstados = null; }
  const d = decidir({ headInicial, headAgora, meusEstados });
  if (!d.abandonar) return d;
  registro(engine).set(pr.key, d.motivo);
  engine.pushActivity(id, 'info', d.motivo === MOTIVOS.HEAD
    ? 'Chegou commit novo no PR: encerrando esta sessão em vez de revisar um head que já passou.'
    : 'A revisão deste head já existe: encerrando esta sessão em vez de refazer o que está feito.');
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
function iniciar(engine, pr, id, headInicial, { intervaloMs = TEMPOS.VIGIA_SESSAO_MS } = {}) {
  if (!headInicial) return { parar() { } };  // sem head de partida nao ha o que comparar
  let vivo = true;
  const timer = setInterval(() => {
    if (!vivo) return;
    conferir(engine, pr, id, headInicial).catch(() => { /* vigia nunca derruba a sessao */ });
  }, intervaloMs);
  if (typeof timer.unref === 'function') timer.unref();
  return {
    parar() { vivo = false; clearInterval(timer); }
  };
}

export default { MOTIVOS, decidir, conferir, jaRevisado, sairDeCena, iniciar, abandonoDe, consumirAbandono };
export { MOTIVOS, decidir, conferir, jaRevisado, sairDeCena, iniciar, abandonoDe, consumirAbandono };
