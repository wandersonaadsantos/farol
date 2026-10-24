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
//      sozinha: o resultado continua esperando o CI e a aprovação sai quando ele fechar verde;
//   5. COMMENT em PR da própria conta que revisa (o GitHub recusa APPROVE e REQUEST_CHANGES do
//      autor), quando a política da classe é automática; resolvido como `commented_own_pr`.
// O que não sai fica como pendência: as esperas automáticas (CI, prova, resultado incompleto)
// ou a mesa, que sobra só para a política em "espera você" e para os motivos de infra ditos
// no card (docs/REVIEW-GATES.md, "A decisão sem mesa").
import { roundGap } from './review-findings.js';
import { inventoryGap } from './pr-inventory.js';
import { conferirCancelamento, iniciarPublicacao } from './cancelamento-revisao.js';
import { classify } from '../log-taxonomy.js';
import { reasonText, staleHeadText } from '../format.js';
import { lancarSePossePerdida, falhaPassageira, postarComRetentativas } from './postagem-arbitragem.js';
import contasConfig from './contas-config.js';
import { avisoDoCi, checksVermelhos } from './gate-espera.js';
import { notasDaReprovacao } from './ressalvas.js';
import esperaProva from './espera-prova.js';
import { textoDaRecusa } from './approval-policy.js';
import auto from './desfecho-automatico.js';
import { comentarioJaPublicado } from './comentario-proprio.js';
import { prepararRecuperacaoDaPublicacao } from './recuperacao-prova.js';

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
  if (inventoryGap(result) || roundGap(result, engine.config?.reviewRoundsMode, result.verdict)) return null;
  // sem o commit lido confirmado, o texto não tem âncora: o caminho novo não sai (invariante 4)
  if (!auto.origemDoDono(pr) || result.analysisStatus !== 'complete' || canReject || !result.headSha) return null;
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
  if (autoDec.motivo === 'ci_vermelho') {
    const vermelhos = checksVermelhos(result);
    return { tipo: 'ci_vermelho', evento: 'request_changes', payload: auto.payloadDoCiVermelho(vermelhos, result.headSha) };
  }
  return null;
}

const ESTADO_DO_DEDUP = { request_changes: 'CHANGES_REQUESTED' };
const TOAST_NOVO = {
  pr_proprio: (key) => `💬 ${key}: o PR é da própria conta que revisa, então a revisão saiu como comentário.`,
  defeito: (key, item) => `🔴 ${key} reprovado (mudanças pedidas): ${reasonText((item.reasons || [])[0]) || 'defeito confirmado na avaliação técnica'}`,
  ci_vermelho: (key) => `🔴 ${key}: CI obrigatório vermelho neste commit, mudanças pedidas; aprovo sozinho quando ele fechar verde.`,
};

// Caminhos 3, 4 e 5. Devolve 'resolvido' (acabou), 'ci' (RC do CI saiu ou já estava lá: segue
// para a espera do CI), 'ci_falhou' (o pedido pelo CI não saiu: a espera do CI tenta de novo) ou
// '' (falhou ao postar; o motivo e o reenvio ficam no resultado).
// Já está no PR? REQUEST_CHANGES pelo estado no commit; COMMENT pelo texto, porque um comentário
// anterior e alheio da conta no mesmo commit não pode calar este (comentario-proprio.js).
async function jaEstaNoPr(engine, ctx, novo) {
  if (novo.evento === 'comment') return (await comentarioJaPublicado(engine, ctx.pr, ctx.headShaAtual, novo.payload.body)) === true;
  const states = await engine.myReviewStates(ctx.pr, ctx.headShaAtual);
  return Array.isArray(states) && states.includes(ESTADO_DO_DEDUP[novo.evento]);
}

async function publicarCaminhoNovo(engine, ctx, novo) {
  const { pr, result, id } = ctx;
  const jaEstava = await jaEstaNoPr(engine, ctx, novo);
  conferirCancelamento(engine, id);
  if (jaEstava && novo.tipo === 'ci_vermelho') return 'ci';
  if (jaEstava) {
    engine.activeReviews.get(id).cancellable = false;
    engine.recordDecision(pr, result, { status: 'already_reviewed', action: novo.evento });
    await ctx.fecharDesfecho(RECIBO_EXTERNO);
    return 'resolvido';
  }
  pararSeLeasePerdido(ctx.coord);
  iniciarPublicacao(engine, id);
  const { post, payload } = await postarReconstruindo(engine, ctx, novo.payload);
  lancarSePossePerdida(post);
  if (novo.tipo !== 'ci_vermelho') result.payloads = { ...(result.payloads || {}), [novo.evento]: payload };
  if (!post.ok) {
    result.reasons = [...(result.reasons || []), infraReason(`falha ao postar o ${novo.evento === 'comment' ? 'COMMENT' : 'REQUEST_CHANGES'}: ${post.error}`)];
    // o pedido pelo CI que não saiu é tentado de novo pela espera do CI, no próximo ciclo
    if (novo.tipo === 'ci_vermelho') return 'ci_falhou';
    result.postRetry = postRetryFor(novo.evento, post.error, post);
    ctx.estado.postFalhou = true;
    return '';
  }
  if (novo.tipo === 'ci_vermelho') {
    engine.emit('toast', { kind: 'ok', text: TOAST_NOVO.ci_vermelho(pr.key) });
    return 'ci';
  }
  if (novo.tipo === 'defeito') result.reasons = [...novo.defeitos.map(gateReason), ...(result.reasons || [])];
  const item = engine.recordDecision(pr, result, { status: auto.statusAutomatico(novo.evento), action: novo.evento });
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
  if (states && states.includes('APPROVED')) {
    engine.activeReviews.get(id).cancellable = false;
    engine.recordDecision(pr, result, { status: 'already_reviewed', action: 'approve' });
    await ctx.fecharDesfecho(RECIBO_EXTERNO);
    engine.emit('toast', { kind: 'info', text: `${pr.key}: você já tinha aprovado no GitHub; não postei de novo.` });
    return true;
  }
  // o corpo do APPROVE vai LIMPO; as ressalvas ficam no app (campo attention)
  const points = [...pontos, ...avisoDoCi(result)];
  pararSeLeasePerdido(coord);
  iniciarPublicacao(engine, id);
  const { post, payload } = await postarReconstruindo(engine, ctx, result.payloads.approve);
  lancarSePossePerdida(post);
  // o texto que saiu (ou que o reenvio vai mandar) é o reconstruído, se houve reconstrução
  result.payloads = { ...result.payloads, approve: payload };
  if (post.ok) {
    const item = engine.recordDecision(pr, result, { status: 'auto_approved', action: 'approve', attention: points });
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
  if (states && states.includes('CHANGES_REQUESTED')) {
    engine.activeReviews.get(id).cancellable = false;
    engine.recordDecision(pr, result, { status: 'already_reviewed', action: 'request_changes' });
    await ctx.fecharDesfecho(RECIBO_EXTERNO);
    engine.emit('toast', { kind: 'info', text: `${pr.key}: você já tinha pedido mudanças no GitHub; não postei de novo.` });
    return true;
  }
  const rc = { ...result.payloads.request_changes, body: engine.rejectBodyWithMark(result.payloads.request_changes.body) };
  pararSeLeasePerdido(coord);
  iniciarPublicacao(engine, id);
  const { post, payload } = await postarReconstruindo(engine, ctx, rc);
  lancarSePossePerdida(post);
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

// Pendência: espera automática (CI, prova, resultado incompleto) ou mesa com o motivo dito.
async function registrarPendencia(engine, ctx, pontos, autoDec, ciReprovado) {
  const { pr, result, id } = ctx;
  const recusa = textoDaRecusa(engine, pr, autoDec.motivo, result);
  if (recusa) result.reasons = [gateReason(recusa), ...(result.reasons || [])];
  // postagem que falhou por algo passageiro é do reenvio, não de uma espera
  const espera = result.postRetry ? null : esperaProva.armarEspera(engine, pr, autoDec.motivo, result, pontos);
  // a recuperação (PR #253) é o agendador único: a reconferência técnica não corre em paralelo
  if (espera) Object.assign(result, { reasons: espera.reasons, technicalRecheck: false });
  if (espera && ciReprovado && espera.extra.esperaCi) espera.extra.esperaCi.rcHead = ciReprovado;
  if (autoDec.motivo === 'politica') {
    // o motivo nomeia a configuração que segurou e QUANDO ela foi definida (contas-config.js)
    result.reasons = [gateReason(contasConfig.motivoDaPolitica(engine, engine.accountForPr(pr), pontos.length === 0)),
      ...avisoDoCi(result), ...pontos];
  }
  conferirCancelamento(engine, id);
  engine.activeReviews.get(id).cancellable = false;
  const pendingExtra = { status: 'pending', ...(espera && espera.extra) };
  if (result.technicalRecheck) pendingExtra.blockedKind = 'technical_recheck';
  if (ctx.estado.staleHeadNovo) Object.assign(pendingExtra, { blockedKind: 'stale_head', blockedHead: ctx.estado.staleHeadNovo });
  const item = engine.recordDecision(pr, result, pendingExtra);
  await ctx.fecharDesfecho({ publicationState: ctx.estado.postFalhou ? 'failed' : 'pending' });
  const publicItem = engine.decisionForUi(item);
  if (espera) return espera.avisar(engine, pr);
  engine.emit('needs-decision', { pr, item: publicItem });
  const extra = (publicItem.reasons || []).length > 1 ? ` (+${publicItem.reasons.length - 1})` : '';
  // commit novo durante a sessão não é "precisa da sua atenção": o round automático fecha sozinho
  const texto = ctx.estado.staleHeadNovo
    ? `↻ ${pr.key}: chegou commit novo durante a revisão, então nada foi postado; o card mostra quando reviso de novo.`
    : `🟡 ${pr.key} precisa da sua atenção: ${reasonText((publicItem.reasons || [])[0]) || 'ver relatório'}${extra}`;
  engine.emit('toast', { kind: 'info', text: texto });
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
  if ((canAuto || canReject || novo) && await headAndou(engine, ctx)) {
    canAuto = false;
    canReject = false;
    novo = null;
  }
  // reprovação que sai com lacuna, checkpoint divergente ou contestação: o card registra (01/10/2026)
  if (canReject) result.reasons = [...notasDaReprovacao(result).map(gateReason), ...(result.reasons || [])];
  if (canAuto && await postarAprovacao(engine, ctx, pontos, autoDec)) return;
  if (canReject && await postarReprovacao(engine, ctx)) return;
  let ciReprovado = '';
  if (novo) {
    const r = await publicarCaminhoNovo(engine, ctx, novo);
    if (r === 'resolvido') return;
    if (r === 'ci') ciReprovado = ctx.headShaAtual;
  }
  await registrarPendencia(engine, ctx, pontos, autoDec, ciReprovado);
}

export default { concluirRevisao, pararSeLeasePerdido, postRetryFor };
export { concluirRevisao, pararSeLeasePerdido, postRetryFor };
