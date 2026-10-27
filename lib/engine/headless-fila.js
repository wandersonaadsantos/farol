// Agendamento da fila local e o motivo efetivamente observado em cada espera.
import admissao from './admissao.js';
import porta from './porta-de-execucao.js';

function grupoSegura(engine, acct) {
  return typeof engine.grupoSegura === 'function' ? engine.grupoSegura(acct) : null;
}

function grupoDaConta(engine, acct) {
  return typeof engine.grupoDaConta === 'function' ? engine.grupoDaConta(acct) : '';
}

// Teto de revisões SIMULTÂNEAS da mesma conta (config.parallelReviews, opt-in do
// Wanderson em 15/08/2026). Clampado AQUI, no consumidor, além do updateSettings:
// defesa em profundidade no padrão do buildModelFlags, porque config torta vinda de
// config.json editado à mão não pode virar teto 0 (fila travada) nem NaN (loop).
// Vale SEMPRE, com ou sem a admissão: até 30/09/2026 a admissão trocava este limite por um
// fixo de 4 e usava o número como total do aparelho. O total é outro número
// (globalParallelLimit, e a política do aparelho em admissao.js).
function parallelLimit(engine) {
  const n = parseInt((engine.config || {}).parallelReviews, 10);
  return Number.isFinite(n) ? Math.min(4, Math.max(1, n)) : 1;
}

// org (owner) dona do PR, pro rodízio da Política 1. Mesmo caminho que accountForPr
// usa pra achar a conta: o owner sai do `repo`, e da `key` (owner/repo#n) quando ele
// não veio. Sem owner resolvível, cai num balde próprio que DISPUTA o rodízio como
// qualquer org (não é fila de castigo: um PR sem repo legível não pode ser punido por
// isso). Minúsculo, porque owner do GitHub não diferencia caixa e o Map diferenciaria.
const SEM_ORG = '(sem org)';
function headlessOrg(pr) {
  const repo = (pr && (pr.repo || String((pr.key || '')).split('#')[0])) || '';
  return String(repo).split('/')[0].toLowerCase() || SEM_ORG;
}

// Teto TOTAL deste aparelho: revisões simultâneas somando todas as contas (Política 3,
// config.globalParallelReviews). 0/ausente/torto = SEM TETO TOTAL, que é o comportamento
// de sempre: o único limite é o por conta. Ligado, clampa em 1..8 aqui no consumidor, o
// mesmo padrão de defesa em profundidade do parallelLimit (config.json editado à mão
// não pode virar teto infinito nem NaN).
//
// Esta política só é segura porque o rodízio de org existe: teto global sozinho
// CONCENTRA, porque quem tem mais PR na fila ocupa o teto inteiro. Com o rodízio
// decidindo quem ocupa cada vaga, o teto vira distribuição de vazão em vez de corrida.
function globalParallelLimit(engine) {
  const n = parseInt((engine.config || {}).globalParallelReviews, 10);
  if (!Number.isFinite(n) || n <= 0) return Infinity;
  return Math.min(8, n);
}

// quantas revisões headless estão em curso somando TODAS as contas
function headlessBusyTotal(engine) {
  let total = 0;
  for (const n of engine.headlessBusyAccounts.values()) total += n;
  return total;
}

// A tela recebe a recusa observada pelo agendador. Projetar a fila nunca
// consulta serviços, reserva vagas ou dispara uma sessão.
function anotarEspera(engine, itens, motivo, dados = {}) {
  for (const pr of itens) {
    engine.headlessWaitReasons.set(pr.key, { motivo, ocupadas: dados.ocupadas, limite: dados.limite });
  }
}

/* Escolhe o PRÓXIMO PR a disparar entre os ELEGÍVEIS (conta abaixo do teto dela).
   Elegível é pré-requisito, nunca critério: a política só decide QUAL, jamais SE, e é
   por isso que ela é work-conserving por construção (se existe elegível, ele sai).

   Critério (Política 1, spec 2026-09-10): ganha o PR da org atendida HÁ MAIS TEMPO.
   Org nunca atendida vale -Infinity, então ela fura a fila da que já rodou. Empate
   (mesma org, ou duas orgs nunca atendidas) resolve pela ORDEM DE CHEGADA, porque o
   findIndex original é FIFO e uma org só na fila tem que se comportar exatamente como
   antes desta feature.

   "Última vez atendida" e não contagem de propósito: contagem pune eternamente quem
   teve um pico de manhã e exige janela deslizante e decaimento pra não mentir. "Quem
   esperou mais" é a definição direta de justiça de fila e é uma comparação de dois
   números. */
function proximoHeadless(engine, limite, seguradas = null) {
  let escolhido = -1;
  let maisAntigo = Infinity;
  for (let i = 0; i < engine.headlessQueue.length; i++) {
    const pr = engine.headlessQueue[i];
    const ocupadas = engine.headlessBusyAccounts.get(engine.headlessAcct(pr)) || 0;
    if (ocupadas >= limite) {
      anotarEspera(engine, [pr], 'limite-conta', { ocupadas, limite });
      continue;
    }
    if (seguradas && seguradas.has(engine.headlessAcct(pr))) continue;
    // orgLastStart pode não existir em engine antigo/parcial (fachada fina, testes de
    // outras suítes): sem ele, toda org empata e o rodízio degrada pro FIFO de antes.
    const visto = engine.orgLastStart && engine.orgLastStart.get(headlessOrg(pr));
    const quando = (visto && Number.isFinite(visto.seq)) ? visto.seq : -Infinity;
    if (quando < maisAntigo) { maisAntigo = quando; escolhido = i; }
    if (maisAntigo === -Infinity) break; // org virgem ganha de todas; a 1ª achada é a mais antiga na fila
  }
  return escolhido;
}

// escalonador: dispara quantas revisões der, até parallelLimit por conta (default 1,
// o comportamento de sempre: série dentro da conta, contas diferentes em paralelo) e
// até globalParallelLimit no total (default: sem teto). Entre os elegíveis, a vaga vai
// pro rodízio de org (proximoHeadless), não pro primeiro da fila.
// Síncrono (não await): cada revisão roda em paralelo e reprograma no fim.
function processHeadless(engine) {
  if (engine.updateInstalling) return;
  porta.devolverSilenciados(engine);
  engine.headlessWaitReasons = new Map();
  const tetoGlobal = globalParallelLimit(engine);
  const comAdmissao = admissao.ativa(engine);
  // contas que o teto do grupo segura por não dar para verificar (C4b): nem o clique
  // atravessa, e o PR espera na fila sem estacionar
  const seguradas = new Set();
  // O laço só avança porque o item sai da fila ou a conta entra em `seguradas`. Um teto de
  // voltas pelo tamanho da fila é a rede de segurança disso: descobrir em produção que uma
  // condição nova não fez nenhuma das duas coisas seria o engine travado num laço quente.
  for (let voltas = engine.headlessQueue.length + 1; voltas > 0; voltas--) {
    const ocupadas = headlessBusyTotal(engine);
    if (ocupadas >= tetoGlobal) {
      anotarEspera(engine, engine.headlessQueue, 'limite-global', { ocupadas, limite: tetoGlobal });
      break;
    }
    const limite = parallelLimit(engine);
    const idx = proximoHeadless(engine, limite, seguradas);
    if (idx < 0) break; // fila vazia ou todas as contas pendentes já no teto
    const contaDoItem = engine.headlessAcct(engine.headlessQueue[idx]);
    if (comAdmissao && grupoSegura(engine, engine.accountForPr(engine.headlessQueue[idx]))) {
      seguradas.add(contaDoItem);
      anotarEspera(engine, engine.headlessQueue.filter(pr => engine.headlessAcct(pr) === contaDoItem), 'grupo-nao-verificavel');
      continue;
    }
    // Com a admissão ativa, a vaga é do APARELHO e é tomada ANTES de tirar o PR da fila:
    // sem vaga o PR CONTINUA na fila (espera, nunca estacionamento como falha).
    // item que veio da distribuição JÁ tem vaga reservada no aceite: reservar de novo
    // contaria a mesma execução duas vezes na ocupação do aparelho
    const jaReservado = !!engine.headlessQueue[idx].admissaoId;
    const grupoDoItem = grupoDaConta(engine, engine.accountForPr(engine.headlessQueue[idx]));
    const vaga = comAdmissao && !jaReservado ? admissao.reservar(engine, { tipo: 'review', ref: engine.headlessQueue[idx].key, grupo: grupoDoItem }) : null;
    if (vaga && !vaga.ok) {
      anotarEspera(engine, engine.headlessQueue, vaga.motivo, { ocupadas: vaga.ocupadas, limite: vaga.teto });
      break;
    }
    const pr = engine.headlessQueue.splice(idx, 1)[0];
    engine.headlessWaitReasons.delete(pr.key);
    if (vaga) pr.admissaoId = vaga.id;
    const acct = engine.headlessAcct(pr);
    engine.headlessBusyAccounts.set(acct, (engine.headlessBusyAccounts.get(acct) || 0) + 1);
    /* Carimba no MESMO ponto em que o slot é tomado: o rodízio conta revisão INICIADA,
       não terminada, senão duas revisões longas da mesma org sairiam juntas por ainda
       não ter voltado nenhuma.

       A ORDEM é por `seq` (contador monotônico) e não por relógio: Date.now() tem
       granularidade de milissegundo, e o escalonador dispara várias revisões no mesmo
       tick. Duas orgs carimbadas no mesmo milissegundo empatariam, o desempate cairia
       pro FIFO e a alternância sumiria justamente no caso que a feature existe pra
       resolver (lote de PRs chegando junto). O `at` fica junto só pra tela poder dizer
       "atendida há 12 min"; ele NUNCA decide a vez. */
    if (engine.orgLastStart) {
      engine.headlessSeq = (engine.headlessSeq || 0) + 1;
      engine.orgLastStart.set(headlessOrg(pr), { seq: engine.headlessSeq, at: Date.now() });
    }
    engine.runOneHeadless(pr, acct);
  }
}


export { parallelLimit, globalParallelLimit, headlessOrg, processHeadless };
