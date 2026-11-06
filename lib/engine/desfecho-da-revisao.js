// O desfecho de uma revisão headless: o que sai no GitHub e o que fica gravado (saiu do
// runHeadlessReview, lib/engine/review.js, em 18/10/2026, junto da decisão sem mesa).
//
// A ordem é a de sempre para o approve e o reject da sessão, e os caminhos novos da v2.73.2
// entram depois deles, todos sob a MESMA conferência do head que andou e o mesmo dedup por
// head (regra do dono: o que a conta configurou para sair sozinho sai sozinho):
//   1. APPROVE (`shouldAutoApprove` ok);
//   2. REQUEST_CHANGES da sessão (`shouldAutoReject`);
//   3. REQUEST_CHANGES por defeito do PR: a sessão concluiu aprovar, mas a avaliação técnica
//      confirmou violação ou achado não resolvido, ou a parte do card deste PR não foi
//      entregue, e a conta reprova sozinha (desfecho-automatico.js monta o texto);
//   4. REQUEST_CHANGES por CI obrigatório vermelho no commit revisado, com a conta reprovando
//      sozinha e "CI obrigatório antes da aprovação" ligado (06/11/2026: desligado, que é o
//      padrão, o CI não decide e este caminho não existe): a reprovação publicada encerra o head,
//      sem aprovação automática posterior nele;
//   5. COMMENT em PR da própria conta que revisa (o GitHub recusa APPROVE e REQUEST_CHANGES do
//      autor), quando a política da classe é automática; resolvido como `commented_own_pr`.
// O que não sai fica como pendência: as esperas automáticas (CI, prova, resultado incompleto)
// ou a mesa, que sobra só para a política em "espera você" e para os motivos de infra ditos
// no card (docs/REVIEW-GATES.md, "A decisão sem mesa").
import { roundGap } from './review-findings.js';
import { decisaoAutomaticaJaPublicada } from './review-head-policy.js';
import { inventoryGap } from './pr-inventory.js';
import { reviewCoherenceGap, reprovacaoSoPeloCi } from './review-consistency.js';
import { conferirCancelamento, iniciarPublicacao } from './cancelamento-revisao.js';
import { classify } from '../log-taxonomy.js';
import { reasonText, staleHeadText } from '../format.js';
import { lancarSePossePerdida, falhaPassageira, postarComRetentativas } from './postagem-arbitragem.js';
import contasConfig from './contas-config.js';
import { aguardaCiParaAprovar, avisoDaAprovacao, avisoDoCi, checksVermelhos, motivoDeEspera } from './gate-espera.js';
import { notasDaReprovacao } from './ressalvas.js';
import esperaProva from './espera-prova.js';
import esperaCi from './espera-ci.js';
import { marcarConflito } from './espera-conflito.js';
import { mergeavelDoPr } from './gh-queries.js';
import { causasDosBloqueios } from './review-findings-contract.js';
import { textoDaRecusa } from './approval-policy.js';
import auto from './desfecho-automatico.js';
import { comentarioJaPublicado } from './comentario-proprio.js';
import { prepararRecuperacaoDaPublicacao } from './recuperacao-prova.js';
import { provaDaRetirada, retirarPedidoResolvido, temPedidoAutomatico, marcaDaRodada, marcaDoCi, MOTIVOS_PASSAGEIROS } from './retirada-de-pedido.js';

const gateReason = (text) => ({ text, kind: 'gate' });
const infraReason = (text) => ({ text, kind: 'infra' });
const RECIBO_PUBLICADO = Object.freeze({ publicationState: 'published' });
const RECIBO_EXTERNO = Object.freeze({ outcome: 'external_review', publicationState: 'published' });
const VEREDITOS = ['approve', 'request_changes'];

// D14 vale até o POST, não só enquanto a sessão roda: o heartbeat segue batendo na fase
// pós-sessão (dedup, checks, head), e o cancelamento que ele dispara ali é inócuo
// porque a sessão já saiu de engine.running. Lease perdido quer dizer que outro aparelho
// pode ser o dono do PR agora, então nada sai no GitHub. O erro carrega a mesma marca
// da perda durante a sessão, e o runOneHeadless trata os dois do mesmo jeito: PR de
// volta pra fila, sem estacionar e sem retry. Chamado colado em cada postReview, porque
// entre a checagem e o POST não pode caber nenhum await AQUI.
// LIMITE, e ele é real: o POST de verdade sai dentro da lane do postReview
// (lib/engine/decision.js), que serializa as postagens do mesmo PR pela mesma conta.
// Se outra postagem do mesmo PR estiver na frente, a nossa espera na fila, e nesse
// intervalo o lease pode cair sem que esta guarda perceba. O que cobre essa janela é o
// dedup por head, que faz a postagem repetida virar no-op; a guarda daqui é o que evita
// abrir o POST quando a perda já é conhecida.
function pararSeLeasePerdido(coord) {
  if (!coord) return;
  if (typeof coord.valido === 'function' && !coord.valido()) {
    throw Object.assign(new Error('lease de coordenação vencido antes de postar; nada foi postado'), { coordenacao: 'perdido' });
  }
  if (!coord.lost) return;
  throw Object.assign(new Error('lease de coordenação perdido antes de postar; nada foi postado'), { coordenacao: 'perdido' });
}

// Marcador do reenvio: só falha transitória (log-taxonomy.js) ou recusa passageira da coordenação.
function postRetryFor(event, erro, post) {
  if (falhaPassageira(post)) return { event, attempts: 0 };
  return classify(erro).kind === 'transitorio' ? { event, attempts: 0 } : null;
}

// Posta e, se a trava de linguagem barrar, reconstrói o texto UMA vez (desfecho-automatico.js).
async function postarReconstruindo(engine, ctx, payload) {
  const { pr, coord } = ctx;
  const enviar = (p) => postarComRetentativas(
    () => engine.postReview(pr, { ...p, commit_id: ctx.headShaAtual }, { via: 'revisao', handle: coord, continuidade: ctx.continuidade, roundReview: ctx.result.roundReview, verdict: ctx.result.verdict }),
    { antes: () => pararSeLeasePerdido(coord) });
  const post = await enviar(payload);
  if (post.ok || post.blocked !== 'internal_language') return { post, payload };
  const novo = auto.reconstruirPayload(payload, engine.accountForPr(pr));
  if (!novo) return { post, payload };
  engine.log('INFO', `${pr.key}: texto do review reconstruído uma vez depois da trava de linguagem.`);
  return { post: await enviar(novo), payload: novo };
}

// Qual dos caminhos novos (3, 4 ou 5) vale para este resultado. null = nenhum.
function caminhoNovo(engine, pr, result, autoDec, canReject) {
  // a coerência é conferida aqui, e não só pelo motivo do approve: resultado incompleto para em
  // analise_incompleta antes de chegar nela, e agora ele pode reprovar (revisão do PR #326)
  if (autoDec.motivo === 'review_inconsistent' || reviewCoherenceGap(result)) return null;
  if (inventoryGap(result) || roundGap(result, engine.config?.reviewRoundsMode, result.verdict)) return null;
  // sem o commit lido confirmado, o texto não tem âncora: o caminho novo não sai (invariante 4)
  if (!auto.origemDoDono(pr) || !auto.analiseSustentaReprovacao(result) || canReject || !result.headSha) return null;
  const conta = engine.accountForPr(pr);
  const reprova = engine.rejectPolicyFor(conta) === 'request_changes';
  if (autoDec.motivo === 'pr_proprio') {
    const limpo = engine.attentionPoints(result).length === 0;
    const automatica = result.verdict === 'approve' ? engine.approvePolicyFor(conta, limpo) === 'approve' : reprova;
    const payload = automatica ? auto.payloadDoPrProprio(result) : null;
    return payload ? { tipo: 'pr_proprio', evento: 'comment', payload } : null;
  }
  if (!reprova || result.verdict !== 'approve') return null;
  const defeitos = auto.defeitosDoPr(result);
  if (defeitos.length) return { tipo: 'defeito', evento: 'request_changes', defeitos, payload: auto.payloadDoDefeito(result, defeitos) };
  if (autoDec.motivo === 'ci_vermelho' && aguardaCiParaAprovar(engine.config)) {
    const vermelhos = checksVermelhos(result);
    return { tipo: 'ci_vermelho', evento: 'request_changes', payload: auto.payloadDoCiVermelho(vermelhos, result.headSha) };
  }
  return null;
}

const ESTADO_DO_DEDUP = { request_changes: 'CHANGES_REQUESTED' };
const TOAST_NOVO = {
  pr_proprio: (key) => `💬 ${key}: o PR é da própria conta que revisa, então a revisão saiu como comentário.`,
  defeito: (key, item) => `🔴 ${key} reprovado (mudanças pedidas): ${reasonText((item.reasons || [])[0]) || 'defeito confirmado na avaliação técnica'}`,
  ci_vermelho: (key) => `🔴 ${key}: CI obrigatório vermelho neste commit, mudanças pedidas; nova revisão automática somente em outro commit.`,
};

// Caminhos 3, 4 e 5. Devolve 'resolvido' (acabou), 'ci' (RC do CI saiu ou já estava lá: segue
// para a espera do CI), 'ci_falhou' (o pedido pelo CI não saiu: a espera do CI tenta de novo) ou
// '' (falhou ao postar; o motivo e o reenvio ficam no resultado).
// Já está no PR? REQUEST_CHANGES pelo estado no commit; COMMENT pelo texto, porque um comentário
// anterior e alheio da conta no mesmo commit não pode calar este (comentario-proprio.js).
async function jaEstaNoPr(engine, ctx, novo) {
  if (novo.evento === 'comment') return (await comentarioJaPublicado(engine, ctx.pr, ctx.headShaAtual, novo.payload.body)) === true;
  const states = await engine.myReviewStates(ctx.pr, ctx.headShaAtual);
  return decisaoAutomaticaJaPublicada(ctx.pr, states) || (Array.isArray(states) && states.includes(ESTADO_DO_DEDUP[novo.evento]));
}

async function registrarJaDecidido(engine, ctx, action) {
  engine.activeReviews.get(ctx.id).cancellable = false;
  engine.recordDecision(ctx.pr, ctx.result, { status: 'already_reviewed', action });
  await ctx.fecharDesfecho(RECIBO_EXTERNO);
  engine.emit('toast', { kind: 'info', text: `${ctx.pr.key}: você já tinha decidido sobre este commit no GitHub; não postei de novo.` });
  return true;
}

async function publicarCaminhoNovo(engine, ctx, novo) {
  const { pr, result, id } = ctx;
  const jaEstava = await jaEstaNoPr(engine, ctx, novo);
  conferirCancelamento(engine, id);
  if (jaEstava) {
    await registrarJaDecidido(engine, ctx, novo.evento);
    return 'resolvido';
  }
  pararSeLeasePerdido(ctx.coord);
  iniciarPublicacao(engine, id);
  const { post, payload } = await postarReconstruindo(engine, ctx, novo.payload);
  lancarSePossePerdida(post);
  if (post.alreadyReviewed) { await registrarJaDecidido(engine, ctx, novo.evento); return 'resolvido'; }
  result.payloads = { ...(result.payloads || {}), [novo.evento]: payload };
  if (!post.ok) {
    result.reasons = [...(result.reasons || []), infraReason(`falha ao postar o ${novo.evento === 'comment' ? 'COMMENT' : 'REQUEST_CHANGES'}: ${post.error}`)];
    // o pedido pelo CI que não saiu é tentado de novo pela espera do CI, no próximo ciclo
    if (novo.tipo === 'ci_vermelho') return 'ci_falhou';
    result.postRetry = postRetryFor(novo.evento, post.error, post);
    ctx.estado.postFalhou = true;
    return '';
  }
  if (novo.tipo === 'defeito') result.reasons = [...novo.defeitos.map(gateReason), ...(result.reasons || [])];
  if (novo.tipo === 'ci_vermelho') result.verdict = 'request_changes';
  // o pedido pelo CI vermelho sai se o check fechar verde neste mesmo commit (retirada-de-pedido.js)
  const retirada = novo.tipo === 'ci_vermelho' ? { retiradaPendente: marcaDoCi(result.headSha, ctx.estado.retiradaPendente) } : {};
  const item = engine.recordDecision(pr, result, { status: auto.statusAutomatico(novo.evento), action: novo.evento, ...retirada });
  engine.writeMemory(item, auto.rotuloDaMemoria(novo.evento));
  await ctx.fecharDesfecho(RECIBO_PUBLICADO);
  const publicItem = engine.decisionForUi(item);
  engine.emit(auto.eventoNaTela(novo.evento), { pr, result: publicItem });
  engine.emit('toast', { kind: 'ok', text: TOAST_NOVO[novo.tipo](pr.key, publicItem) });
  return 'resolvido';
}

// O head pode ter andado ENQUANTO a sessão lia o PR (biud-esg#224): nada é postado, e quem
// fecha o PR é o round seguinte, sobre o head certo. Head desconhecido não inventa rodada.
async function headAndou(engine, ctx) {
  let headAgora = '';
  try { headAgora = await engine.headSha(ctx.pr); } catch { /* sem sha não inventa rodada nova */ }
  if (!headAgora || !ctx.headShaAtual || headAgora === ctx.headShaAtual) return false;
  ctx.result.reasons = [gateReason(`${staleHeadText(ctx.headShaAtual, headAgora)}, então não posto: este texto fala do código anterior`),
    ...(ctx.result.reasons || [])];
  ctx.estado.staleHeadNovo = headAgora;
  engine.log('INFO', `${ctx.pr.key}: head andou de ${ctx.headShaAtual.slice(0, 8)} pra ${headAgora.slice(0, 8)} durante a sessão; não postei, a pendência ficou marcada stale_head.`);
  return true;
}

async function postarAprovacao(engine, ctx, pontos, autoDec) {
  const { pr, result, id, coord } = ctx;
  // dedup: aprovação minha DESTE head já existe (biud-frontend#635); de head anterior não conta (#742)
  const states = await engine.myReviewStates(pr, ctx.headShaAtual);
  conferirCancelamento(engine, id);
  if (decisaoAutomaticaJaPublicada(pr, states) || (states && states.includes('APPROVED'))) {
    return registrarJaDecidido(engine, ctx, 'approve');
  }
  // o corpo do APPROVE vai LIMPO; as ressalvas ficam no app (campo attention)
  // CI fora do verde ou repositório sem check obrigatório: o card da aprovação avisa (gate-espera.js),
  // mas só depois que o APPROVE saiu; com a postagem falhando, o motivo segue neutro (avisoDoCi)
  const points = [...pontos, ...avisoDoCi(result)];
  pararSeLeasePerdido(coord);
  iniciarPublicacao(engine, id);
  const { post, payload } = await postarReconstruindo(engine, ctx, result.payloads.approve);
  lancarSePossePerdida(post);
  if (post.alreadyReviewed) return registrarJaDecidido(engine, ctx, 'approve');
  // o texto que saiu (ou que o reenvio vai mandar) é o reconstruído, se houve reconstrução
  result.payloads = { ...result.payloads, approve: payload };
  if (post.ok) {
    const item = engine.recordDecision(pr, result, { status: 'auto_approved', action: 'approve', attention: [...pontos, ...avisoDaAprovacao(result)] });
    const publicItem = engine.decisionForUi(item);
    const publicPoints = publicItem.attention || [];
    engine.writeMemory(item, 'APPROVE');
    await ctx.fecharDesfecho(RECIBO_PUBLICADO);
    engine.emit('auto-approved', { pr, result: publicItem, points: publicPoints });
    engine.emit('toast', {
      kind: 'ok', text: publicPoints.length
        ? `⚠️ ${pr.key} aprovado com ${publicPoints.length} ressalva(s): ${reasonText(publicPoints[0])}`
        : `✅ ${pr.key} aprovado sem ressalvas.`
    });
    return true;
  }
  result.reasons = [...points, infraReason(`falha ao postar o APPROVE: ${post.error}`)];
  // recusa técnica na publicação volta ao funil da recuperação (PR #253, recuperacao-prova.js)
  ctx.estado.postFalhou = prepararRecuperacaoDaPublicacao(result, autoDec, post);
  // falha transitória: o retryFailedPosts reenvia o MESMO payload nos próximos ciclos
  result.postRetry = postRetryFor('approve', post.error, post);
  return false;
}

async function postarReprovacao(engine, ctx) {
  const { pr, result, id, coord } = ctx;
  // dedup por head: não re-pede mudanças se já pedi PARA ESTE HEAD (#742)
  const states = await engine.myReviewStates(pr, ctx.headShaAtual);
  conferirCancelamento(engine, id);
  if (decisaoAutomaticaJaPublicada(pr, states) || (states && states.includes('CHANGES_REQUESTED'))) {
    return registrarJaDecidido(engine, ctx, 'request_changes');
  }
  const rc = { ...result.payloads.request_changes, body: engine.rejectBodyWithMark(result.payloads.request_changes.body) };
  pararSeLeasePerdido(coord);
  iniciarPublicacao(engine, id);
  const { post, payload } = await postarReconstruindo(engine, ctx, rc);
  lancarSePossePerdida(post);
  if (post.alreadyReviewed) return registrarJaDecidido(engine, ctx, 'request_changes');
  result.payloads = { ...result.payloads, request_changes: payload };
  if (post.ok) {
    const item = engine.recordDecision(pr, result, { status: 'auto_rejected', action: 'request_changes' });
    const publicItem = engine.decisionForUi(item);
    engine.writeMemory(item, 'REQUEST_CHANGES');
    await ctx.fecharDesfecho(RECIBO_PUBLICADO);
    engine.emit('auto-rejected', { pr, result: publicItem });
    engine.emit('toast', { kind: 'ok', text: `🔴 ${pr.key} reprovado (mudanças pedidas): ${reasonText((publicItem.reasons || [])[0]) || 'ver relatório'}` });
    return true;
  }
  result.reasons = [...(result.reasons || []), infraReason(`falha ao postar o REQUEST_CHANGES: ${post.error}`)];
  ctx.estado.postFalhou = true;
  result.postRetry = postRetryFor('request_changes', post.error, post);
  return false;
}

const avisarDoCiDeEstado = (engine, pr) => engine.emit('toast', { kind: 'info',
  text: `⏳ ${pr.key}: a revisão pediu mudanças só pelo CI obrigatório; espero o CI neste commit, sem publicar o pedido da revisão.` });

// A reprovação que se apoia só no estado do PR (05/11/2026, desfecho-automatico.js): nada da
// revisão vai ao PR. CI vai à espera do CI de sempre (o pedido pelo CI vermelho segue a regra de
// 18/10/2026, e o CI verde não vira APPROVE: espera-ci.js); conflito vai à espera do conflito
// (espera-conflito.js), que o commit novo destrava; dependência e arquivo fora do diff vão à mesa,
// com o texto da revisão no card. Resultado incoerente ou incompleto segue na recuperação de sempre.
// O conflito que o modelo declarou é conferido no GitHub: MERGEABLE vai à mesa com o motivo (a
// espera do conflito só acaba com commit novo), e UNKNOWN ou leitura que falha seguem como antes.
async function esperaDeEstado(engine, ctx, pontos) {
  const { pr, result } = ctx;
  if (result.postRetry || result.analysisStatus !== 'complete' || reviewCoherenceGap(result) || !auto.reprovacaoSoDeEstado(result)) return null;
  const motivo = gateReason(textoDaRecusa(engine, pr, 'bloqueio_de_estado', result));
  const daRevisao = result.reasons || [];
  const causas = causasDosBloqueios(result);
  // a espera do CI existe para a conta que reprova sozinha e para a revisão mandada pelo dono;
  // com a política em "espera você" (ou origem desconhecida), o pedido pelo CI vai à mesa.
  // Com "CI obrigatório antes da aprovação" desligado (padrão desde 06/11/2026) não há espera do
  // CI: o CI declarado não segura, e o que sobra (conflito) segue a regra dele
  const ciDecide = aguardaCiParaAprovar(engine.config);
  const esperaOCi = ciDecide && causas.has('ci') && engine.rejectPolicyFor(engine.accountForPr(pr)) === 'request_changes' && auto.origemDoDono(pr);
  const ci = esperaOCi ? esperaCi.armar(motivoDeEspera(result), result, pontos) : null;
  if (ci) return { ...ci, reasons: [motivo, ...ci.reasons, ...daRevisao], avisar: avisarDoCiDeEstado };
  // CI já verde (a espera do CI não arma) com conflito também declarado: o conflito ainda segura
  const conflito = causas.has('conflito') && (!causas.has('ci') || esperaOCi || !ciDecide) && result.headSha;
  if (conflito && await mergeavelDoPr(engine, pr).catch(() => null) === 'MERGEABLE') {
    result.reasons = [motivo, gateReason('o relatório fala em conflito, mas o GitHub diz que o PR é mesclável: a decisão é sua'), ...daRevisao];
    return null;
  }
  if (conflito) {
    // o aviso do conflito é o da própria marca (um por PR e head)
    marcarConflito(engine, pr.key, result.headSha, Date.now(), pr.updatedAt);
    return { extra: { blockedKind: 'conflito' }, reasons: [motivo, ...daRevisao], avisar: () => { } };
  }
  const foraDaDecisao = !ciDecide && causas.has('ci') ? [gateReason(textoDaRecusa(engine, pr, 'ci_fora_da_decisao', result))] : [];
  result.reasons = [...foraDaDecisao, motivo, ...daRevisao];
  return null;
}

// Pendência: espera automática (CI, prova, resultado incompleto, estado do PR) ou mesa com o motivo dito.
async function registrarPendencia(engine, ctx, pontos, autoDec) {
  const { pr, result, id } = ctx;
  const recusa = textoDaRecusa(engine, pr, autoDec.motivo, result);
  if (recusa) result.reasons = [gateReason(recusa), ...(result.reasons || [])];
  // o pedido que só o CI vermelho sustenta, com o CI fora da decisão (shouldAutoReject o segurou)
  if (!aguardaCiParaAprovar(engine.config) && reprovacaoSoPeloCi(result)) {
    result.reasons = [gateReason(textoDaRecusa(engine, pr, 'ci_fora_da_decisao', result)), ...(result.reasons || [])];
  }
  const deEstado = await esperaDeEstado(engine, ctx, pontos);
  // postagem que falhou por algo passageiro é do reenvio, não de uma espera
  const espera = deEstado || (result.postRetry ? null : esperaProva.armarEspera(engine, pr, autoDec.motivo, result, pontos));
  // a recuperação (PR #253) é o agendador único: a reconferência técnica não corre em paralelo
  if (espera) Object.assign(result, { reasons: espera.reasons, technicalRecheck: false });
  if (autoDec.motivo === 'politica') {
    // o motivo nomeia a configuração que segurou e QUANDO ela foi definida (contas-config.js)
    result.reasons = [gateReason(contasConfig.motivoDaPolitica(engine, engine.accountForPr(pr), pontos.length === 0)),
      ...avisoDoCi(result), ...pontos];
  }
  conferirCancelamento(engine, id);
  engine.activeReviews.get(id).cancellable = false;
  const pendingExtra = { status: 'pending', ...(espera && espera.extra) };
  if (ctx.estado.retiradaPendente) pendingExtra.retiradaPendente = ctx.estado.retiradaPendente;
  if (result.technicalRecheck) pendingExtra.blockedKind = 'technical_recheck';
  if (ctx.estado.staleHeadNovo) Object.assign(pendingExtra, { blockedKind: 'stale_head', blockedHead: ctx.estado.staleHeadNovo });
  const item = engine.recordDecision(pr, result, pendingExtra);
  await ctx.fecharDesfecho({ publicationState: ctx.estado.postFalhou ? 'failed' : 'pending' });
  const publicItem = engine.decisionForUi(item);
  if (espera) return espera.avisar(engine, pr, publicItem);
  engine.emit('needs-decision', { pr, item: publicItem });
  const extra = (publicItem.reasons || []).length > 1 ? ` (+${publicItem.reasons.length - 1})` : '';
  // commit novo durante a sessão não é "precisa da sua atenção": o round automático fecha sozinho
  const texto = ctx.estado.staleHeadNovo
    ? `↻ ${pr.key}: chegou commit novo durante a revisão, então nada foi postado; o card mostra quando reviso de novo.`
    : `🟡 ${pr.key} precisa da sua atenção: ${reasonText((publicItem.reasons || [])[0]) || 'ver relatório'}${extra}`;
  engine.emit('toast', { kind: 'info', text: texto });
}

// O pedido de mudanças anterior sai antes do desfecho, e o desfecho segue igual: retirar não
// aprova (retirada-de-pedido.js). Cancelamento e posse perdida lançam, como em toda postagem.
async function retirarPedidoAnterior(engine, ctx) {
  const { pr, result, id, coord } = ctx;
  conferirCancelamento(engine, id);
  // o headAndou deixa passar a leitura que falha; aqui, sem confirmar o head, a varredura decide
  const atual = await engine.headSha(pr).catch(() => '');
  if (atual !== ctx.headShaAtual) {
    ctx.estado.retiradaPendente = marcaDaRodada(ctx.headShaAtual);
    return;
  }
  const r = await retirarPedidoResolvido(engine, pr, ctx.headShaAtual, {
    continuidade: ctx.continuidade,
    antesDeEnviar: () => { pararSeLeasePerdido(coord); iniciarPublicacao(engine, id); },
  });
  if (r.ok) result.pedidoRetirado = { head: ctx.headShaAtual, at: Date.now() };
  if (MOTIVOS_PASSAGEIROS.has(r.motivo)) ctx.estado.retiradaPendente = marcaDaRodada(ctx.headShaAtual);
}

// A rodada que só rodou para retirar o meu pedido (skip-review.js) não aprova por cima de quem já
// decidiu este commit. Devolve true se resolveu aqui.
async function dispensarAprovacaoEmHeadDecidido(engine, ctx) {
  const { pr, result } = ctx;
  if (pr.manual || !temPedidoAutomatico(engine, pr, result.headSha)) return false;
  const hist = await engine.bloqueadoPorHistorico(pr);
  if (!hist?.decidido) return false;
  const nomes = (hist.quem || []).map((u) => `@${u}`).join(', ');
  result.reasons = [gateReason(`outra pessoa já decidiu este commit (${nomes}): a aprovação automática não é necessária, nada foi postado`), ...(result.reasons || [])];
  engine.activeReviews.get(ctx.id).cancellable = false;
  // a retirada que ficou para depois não se perde: a varredura a conclui
  const marca = ctx.estado.retiradaPendente;
  engine.recordDecision(pr, result, { status: 'approval_not_needed', action: 'skip', ...(marca ? { retiradaPendente: marca } : {}) });
  await ctx.fecharDesfecho(RECIBO_EXTERNO);
  engine.emit('toast', { kind: 'info', text: `${pr.key}: outra pessoa já decidiu este commit (${nomes}); a aprovação automática não é necessária.` });
  return true;
}

// ctx: { pr, result, id, coord, headShaAtual, fecharDesfecho }
async function concluirRevisao(engine, ctx) {
  const { pr, result } = ctx;
  ctx.estado = { staleHeadNovo: '', postFalhou: false };
  // as ressalvas, lidas UMA vez e antes de qualquer motivo de gate entrar em reasons
  const pontos = engine.attentionPoints(result);
  const autoDec = engine.shouldAutoApprove(pr, result);
  let canAuto = autoDec.ok === true;
  if (inventoryGap(result) && result.verdict !== 'approve') result.reasons = [gateReason(inventoryGap(result)), ...(result.reasons || [])];
  if (roundGap(result, engine.config?.reviewRoundsMode, result.verdict) && result.verdict !== 'approve') result.reasons = [gateReason(roundGap(result, engine.config?.reviewRoundsMode, result.verdict)), ...(result.reasons || [])];
  let canReject = engine.shouldAutoReject(pr, result);
  let novo = caminhoNovo(engine, pr, result, autoDec, canReject);
  if (!auto.origemDoDono(pr) && VEREDITOS.includes(result.verdict)) {
    result.reasons = [gateReason('revisão de origem desconhecida (nem a fila, nem você, nem um aparelho seu): nada é postado sozinho'),
      ...(result.reasons || [])];
  }
  // só quem tem pedido automático anterior paga a releitura do head
  let retira = temPedidoAutomatico(engine, pr, result.headSha) ? provaDaRetirada(engine, pr, result) : 'nao';
  if ((canAuto || canReject || novo || retira !== 'nao') && await headAndou(engine, ctx)) {
    canAuto = false;
    canReject = false;
    novo = null;
    retira = 'nao';
  }
  if (retira === 'sim') await retirarPedidoAnterior(engine, ctx);
  if (retira === 'ci') ctx.estado.retiradaPendente = marcaDaRodada(ctx.headShaAtual);
  // reprovação que sai com lacuna, checkpoint divergente ou contestação: o card registra (01/10/2026)
  if (canReject) result.reasons = [...notasDaReprovacao(result).map(gateReason), ...(result.reasons || [])];
  if (canAuto && await dispensarAprovacaoEmHeadDecidido(engine, ctx)) return;
  if (canAuto && await postarAprovacao(engine, ctx, pontos, autoDec)) return;
  if (canReject && await postarReprovacao(engine, ctx)) return;
  if (novo) {
    const r = await publicarCaminhoNovo(engine, ctx, novo);
    if (r === 'resolvido') return;
  }
  await registrarPendencia(engine, ctx, pontos, autoDec);
}

export default { concluirRevisao, pararSeLeasePerdido, postRetryFor };
export { concluirRevisao, pararSeLeasePerdido, postRetryFor, caminhoNovo };
