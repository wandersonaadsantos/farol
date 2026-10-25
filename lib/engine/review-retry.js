import retomadaMod from './retomada-duravel.js';
import { politicaDeInicio } from './review-scope.js';
import { limiteAte } from './limite-plano.js';

// Quem volta do retry pós-transitório neste ciclo (o check() chama quando a checagem
// funcionou, ou seja, a rede voltou). SÍNCRONA e sem IO, mesmo motivo do pushbackTargets:
// testável sem rede. A promessa do toast ("retomo sozinho") NÃO depende da política
// autoReview da conta nem de o PR estar na fila: revisão por clique no panorama e conta
// com autoReview desligado também são retomadas. Ficam de fora: conta silenciada, conta
// sem token no gh (guarda da Onda 1: sem token não abre sessão, o PR espera o token
// voltar), PR recém-chegado (o toReview do ciclo cuida dele), o que já está na fila
// headless/rodando, e conta cujo perfil de chave de API está com o orçamento
// estourado (mesmo gate do toReview, via budgetBlockedFor: é exatamente o caminho
// automático que causou o incidente de 04/08/2026, retry sem noção de gasto), e o PR
// cujo `notBefore` ainda está no futuro (limite de plano com hora de reset conhecida:
// tentar antes da hora é gasto certo com falha certa). O "agora" entra por parâmetro
// pra o teste ser determinístico; em produção é sempre o default.
export function retryTargets(engine, freshKeys, inflightKeys, agora = Date.now()) {
  return [...engine.retryAfterNet.values()]
    .filter(v => !(v && v.notBefore && v.notBefore > agora))
    .map(v => v && v.pr)
    .filter(pr => pr &&
      politicaDeInicio(engine, pr, { retry: true }).automatic &&
      !freshKeys.has(pr.key) &&
      !inflightKeys.has(pr.key) &&
      !engine.isMuted(engine.accountForPr(pr)) &&
      engine.tokenFor(engine.accountForPr(pr)) &&
      // saí de cena neste PR: o retry não pode ressuscitar o que eu prometi não
      // revisar (o enqueueHeadless barraria de qualquer jeito; aqui é pra não
      // ficar repescando em silêncio a cada ciclo)
      !(engine.skipComentado || {})[pr.key] &&
      // coordenação entre aparelhos segurando (conexão fora, ou espera anotada): o
      // retry espera com o resto das automações, sem gastar tentativa (D11)
      engine.syncSeguraAutomacao?.(pr.key) !== true &&
      !engine.grupoSegura?.(engine.accountForPr(pr)) &&
      !engine.budgetBlockedFor(engine.accountForPr(pr)) &&
      // o limite da assinatura vale mesmo que a espera própria do PR já tenha passado
      !limiteAte(engine, engine.accountForPr(pr), agora));
}


export async function repescarRetry(engine, fresh, inflight) {
    if (!engine.retryAfterNet.size) return;
    const retry = engine.retryTargets(new Set(fresh.map(f => f.key)), inflight);
    if (!retry.length) return;
    // poda PRs que foram mergeados/fechados enquanto esperavam no retry,
    // ANTES de notificar e lançar: sem isso cada ciclo gera uma cascata
    // de "relançando..." + "já mergeado, cancelei" pra cada PR fechado
    const stillOpen = [];
    for (const pr of retry) {
      let state = null;
      try { state = await engine.prState(pr); } catch { /* Falha na consulta não comprova que o PR fechou. */ }
      if (state === 'MERGED' || state === 'CLOSED') {
        engine.retryAfterNet.delete(pr.key);
        // PR fechado não volta: a referência de retomada dele é consumida aqui, senão
        // ficaria no inflight.json pra sempre
        retomadaMod.consumirRetomada(engine, pr.key);
      } else {
        stillOpen.push(pr);
      }
    }
    // gate de consciência do review automático (28/08/2026 à tarde): head ativo
    // com review decisivo de outra pessoa deixa o retry aguardando ação manual.
    // A entrada do retry morre junto (a promessa "retomo sozinho" caducou:
    // alguém decisivo se manifestou, e insistir seria reconsultar o mesmo head
    // a cada ciclo); o card segue visível na fila, deixado lá pela falha
    // transitória original, com o botão Revisar valendo. Roda ANTES do toast de
    // relançamento pra nunca anunciar um relançamento que não vai acontecer.
    const relancaveis = [];
    for (const pr of stillOpen) {
      if (await engine.bloqueiaAutomatico(pr)) engine.retryAfterNet.delete(pr.key);
      else relancaveis.push(pr);
    }
    if (!relancaveis.length) return;
    engine.emit('toast', { kind: 'info', text: `Conexão de volta: relançando a revisão de ${relancaveis.map(p => p.key).join(', ')}.` });
    // G9: relança o OBJETO guardado (era o motivo de guardá-lo): relançar
    // por URL re-resolvia no panorama e requested virava false, rebaixando
    // um round automático a manual com a reason errada
    for (const pr of relancaveis) {
      if (!politicaDeInicio(engine, pr, { retry: true }).automatic) continue;
      // a falha transitória original (runOneHeadless) fez unsee + queue.push
      // pra deixar o card visível "aguardando você" enquanto esperava o retry.
      // O launchReview desfazia os dois (markSeen + saída da fila) no
      // relançamento; enqueueHeadless sozinho não faz isso, e o card mentia
      // "aguardando você" com o botão Revisar ativo enquanto a revisão
      // relançada já estava rodando.
      engine.markSeen(pr.key);
      engine.queue = engine.queue.filter(p => p.key !== pr.key);
      engine.enqueueHeadless({ ...pr, automaticRetry: true });
    }
  }

