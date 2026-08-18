// Concern de decisão + postagem no GitHub (Onda 2, colaborador). Registro das decisões
// (pendentes/histórico), gates de auto-aprovar/auto-reprovar, dedup de postagem, o post
// em si e a memória do time. Funções recebem o engine como ctx; a Engine mantém fachadas
// finas que delegam. Gate de postagem intacto (ver CLAUDE.md, invariante 4). Ver docs/QUALITY.md.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { STATE_DIR } from '../paths.js';
import io from '../io.js';
import { writeJsonAtomic } from '../io.js';
import {
  publicReviewLanguageIssues, normalizeReviewPayload,
  decisionForUi, reviewMarkdownForUi,
} from './public-review.js';

function recordDecision(engine, pr, result, extra) {
  const reviewMarkdown = reviewMarkdownForUi({ ...result, action: extra && extra.action });
  const item = {
    id: `d${Date.now()}${Math.floor(Math.random() * 1000)}`,
    createdAt: Date.now(),
    // identidade SEMPRE do PR da fila (confiável), nunca do envelope: result.pr é
    // saída de modelo e um repo/number mentiroso redirecionaria a postagem
    // (decide() -> myReviewStates/postReview usam item.pr). O campo pr que o
    // prompt pede no envelope fica ignorado de propósito.
    pr: { repo: pr.repo, number: pr.number, url: pr.url, title: pr.title, author: pr.author },
    key: pr.key,
    // head que a sessão leu (G12): é o que permite a reconciliação dizer de qual estado
    // do PR esta decisão fala. '' quando desconhecido; nunca undefined.
    headSha: result.headSha || '',
    card: result.card || null,
    cardMet: result.cardMet,
    analysisStatus: result.analysisStatus === 'complete' ? 'complete' : 'incomplete',
    sessionId: result.sessionId || null,
    verdict: result.verdict,
    reasons: result.reasons || [],
    reportMarkdown: result.reportMarkdown || '',
    // Versão técnica/humana para a tela. O relatório acima continua sendo o
    // diagnóstico interno bruto; decisionForUi nunca o entrega sem projeção.
    reviewMarkdown,
    payloads: result.payloads || {},
    memory: result.memory || null,
    verificationCheckpoint: result.verificationCheckpoint || null,
    // marcado só quando shouldAutoApprove/shouldAutoReject já tinham liberado a
    // postagem e ELA MESMA falhou por algo transitório (ver classify em
    // log-taxonomy.js): retryFailedPosts (abaixo) reusa o payload já pronto pra
    // reenviar sozinho nos próximos ciclos, sem reabrir sessão nem gastar token.
    // null = pendência de verdade (gate barrou por regra/conteúdo), nunca entra
    // no sweep.
    postRetry: result.postRetry || null,
    ...extra
  };
  if (item.status === 'pending') engine.decisions.pending.unshift(item);
  else engine.resolveIntoHistory(item);
  engine.saveDecisions();
  return item;
}

function resolveIntoHistory(engine, item) {
  item.resolvedAt = Date.now();
  // historico nao precisa carregar relatorio e payloads inteiros
  const slim = { ...item, reportMarkdown: item.reportMarkdown, payloads: undefined, memory: undefined };
  engine.decisions.resolved.unshift(slim);
  // histórico guardado (cada item já é "slim": sem payloads/memory). A tela recebe
  // um recorte bem menor (ver snapshot); o que garante alcance a qualquer revisão
  // é o decisionByKey, não o tamanho do payload.
  engine.decisions.resolved = engine.decisions.resolved.slice(0, HIST_LIMIT);
}

// Teto do histórico em disco. Era 200 até a v2.40.2 e passou a 3000 (pedido do
// Wanderson, 11/08/2026: "não quero essa limitação mais, se for colocar pelo
// menos 3000"), porque a caixa de revisão virou destino de clique na tabela de
// Consumo e clique não pode esbarrar em teto. Custo medido: 1,1 KB por decisão
// sem relatório e 5,2 KB com, ou seja ~15 MB de arquivo no pior caso. Barato em
// disco; caro seria trafegar isso a cada push de SSE, que é justamente o que o
// snapshot NÃO faz.
const HIST_LIMIT = 3000;

// Acha a decisão de um PR pela chave (owner/repo#N) no histórico COMPLETO, não
// no recorte que a tela recebe. A pendente tem precedência: o mesmo PR pode ter
// uma decisão antiga resolvida e uma nova esperando você, e a caixa precisa
// mostrar a que está valendo agora.
function decisionByKey(engine, key) {
  const k = String(key || '').trim();
  if (!k) return null;
  const d = (engine.decisions?.pending || []).find(x => x.key === k)
    || (engine.decisions?.resolved || []).find(x => x.key === k);
  return decisionForUi(d || null);
}

// ultima acao do Farol por PR, pro indicador do panorama: o que foi postado
// (aprovado, mudancas pedidas, comentado) ou "pendente" quando esta na sua mesa.
// "pulado" nao marca nada: nao foi postado review.
function reviewActions(engine) {
  const map = {};
  // ressalva = a revisão apontou algo mesmo aprovando (mesmos pontos do attentionPoints:
  // card não comprovado OU algum motivo listado). Usado pra distinguir "aprovado limpo"
  // de "aprovado com ressalva" (ex.: gate do scan de pushback).
  const caveats = d => d.cardMet === false
    || (Array.isArray(d.attention) && d.attention.length > 0)
    || (Array.isArray(d.reasons) && d.reasons.length > 0);
  for (const d of [...engine.decisions.resolved].reverse()) {
    if (d.status === 'auto_approved') map[d.key] = { kind: 'approve', auto: true, at: d.resolvedAt, caveats: caveats(d) };
    else if (d.status === 'auto_rejected') map[d.key] = { kind: 'request_changes', auto: true, at: d.resolvedAt, caveats: caveats(d) };
    else if (d.status === 'posted' || d.status === 'already_reviewed') map[d.key] = { kind: d.action, at: d.resolvedAt, caveats: caveats(d) };
  }
  for (const d of engine.decisions.pending) map[d.key] = { kind: 'pending', at: d.createdAt };
  return map;
}

function saveDecisions(engine) {
  try { writeJsonAtomic(path.join(STATE_DIR, 'decisions.json'), engine.decisions); }
  catch (err) { engine.log('ERROR', `salvar decisions.json: ${err.message}`); }
  engine.pushState();
}

// Reviews MEUS neste PR, cada um com o horário de submissão em ms. É o ÚNICO ponto de
// I/O sobre isso: o dedup de postagem (myReviewStates) e a reconciliação de pendências
// (reconcilePending) derivam os dois daqui. O horário existe por causa da reconciliação:
// sem ele não se distingue "review que eu postei depois da análise" (chat/GitHub na mão)
// de "review antigo que o autor derrubou e re-pediu".
// null = nao deu pra confirmar (rede etc.); quem chama decide se segue.
async function myReviewsWithTime(engine, pr) {
  const repo = pr.repo || (pr.key || '').split('#')[0];
  const number = pr.number || parseInt((pr.key || '').split('#')[1], 10);
  const acc = engine.accountForPr(pr);
  const me = (acc || '').toLowerCase();
  if (!repo || !number || !me) return null;
  // conta sem token: não dá pra confirmar (nunca consultar com outra identidade)
  if (!engine.tokenFor(acc)) return null;
  const r = await io.run('gh', ['api', `repos/${repo}/pulls/${number}/reviews`,
    '--jq', `[.[] | select((.user.login | ascii_downcase) == "${me}") | {state, submitted_at, commit_id}]`], { env: engine.ghEnv(acc) });
  if (!r.ok) return null;
  try {
    const raw = JSON.parse(r.stdout || '[]');
    if (!Array.isArray(raw)) return null;
    // review em rascunho (não submetido) vem sem submitted_at: at fica null e nenhum
    // caminho de reconciliação o aceita, que é o certo (rascunho não é review postado).
    // commit_id é o head que aquele review olhou: é o que dá NOÇÃO DE ROUND pro dedup.
    return raw.map(x => ({
      state: String((x && x.state) || ''),
      at: Date.parse((x && x.submitted_at) || '') || null,
      commit: String((x && x.commit_id) || '')
    }));
  } catch { return null; }
}

// Estados dos reviews que EU ja postei neste PR PARA O HEAD `headSha` (dedup de postagem).
// null = nao deu pra confirmar (rede etc.); quem chama decide se segue.
//
// O recorte por head existe por causa do biud-frontend#742 (11/08/2026): o dedup
// perguntava "eu ja pedi mudancas neste PR alguma vez?", entao depois que o autor
// empurrava a correcao, o 2o round de revisao (com achado NOVO sobre o head novo) era
// resolvido como already_reviewed e nunca chegava no PR. A pergunta certa e "eu ja me
// manifestei sobre ESTE head?", e o commit_id do review responde isso.
// Round anterior nao silencia round atual; mesmo round segue sem duplicar (biud-core#215).
//
// headSha vazio = nao deu pra saber o head (sem token, rede, gh): degrada pro
// comportamento antigo (considera todos os reviews) em vez de repostar as cegas. Review
// sem commit_id tambem entra, pela mesma razao: falta de dado nao inventa rodada nova.
async function myReviewStates(engine, pr, headSha) {
  const reviews = await engine.myReviewsWithTime(pr);
  if (!reviews) return null;
  const head = String(headSha || '');
  return reviews.filter(r => !head || !r.commit || r.commit === head).map(r => r.state);
}

// Estado de review no GitHub -> ação equivalente do Farol. DISMISSED e PENDING ficam
// FORA de propósito: review derrubado deixou de valer e rascunho nunca foi postado,
// então nenhum dos dois atende uma pendência.
const REVIEW_STATE_ACTION = { APPROVED: 'approve', CHANGES_REQUESTED: 'request_changes', COMMENTED: 'comment' };

// Estados que, SOZINHOS, são desfecho de uma pendência: você decidiu sobre aquele código.
// COMMENTED fica de fora porque comentar não decide nada (pergunta ao autor, recado de
// "vou olhar", comentário de outro assunto). Só o ramo do MESMO HEAD usa esta tabela: no
// ramo do horário, comentar DEPOIS que o card nasceu é atendimento e segue valendo.
const DECISIVE_REVIEW_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED']);

// Pendências que já foram atendidas FORA do botão: o review saiu pelo chat do PR, pela
// web do GitHub ou por gh na mão. Até a v2.32.3 `decisions.pending` só era esvaziado
// dentro de decide() (o caminho do clique), então o card ficava preso em "Precisa de
// você" pra sempre, mesmo com o APPROVE já no PR. Caso real: internal-auth#34, pendência
// criada 17:33 e APPROVE meu submetido 17:35 pelo chat, card ainda na tela.
// A trava tem DOIS caminhos, e um review meu precisa passar por um deles: o HORÁRIO (review
// submetido DEPOIS da criação da pendência, em qualquer estado, inclusive COMMENTED, porque
// aí ele significa "você agiu depois que o card nasceu") ou o MESMO HEAD que a sessão leu
// (review anterior à pendência, mas sobre o mesmo código, e aí só APPROVED ou
// CHANGES_REQUESTED, ver DECISIVE_REVIEW_STATES). Review antigo em head antigo fica fora de
// propósito: é o caso do re-request (o autor derruba a aprovação e pede de novo), e ali a
// pendência é justamente a rodada nova, não pode desaparecer.
// Best-effort em toda falha: sem token ou sem rede, myReviewsWithTime devolve null e a
// pendência FICA (card não some por falta de prova). `keys` limita a quais PRs olhar
// (o chat reconcilia só o PR da conversa); sem keys, olha todas as pendências.
// Não escreve memória do time, igual ao caminho já_revisado do decide(): quem revisou
// foi você, por fora, e o app não tem o envelope daquele review.
async function reconcilePending(engine, keys) {
  const alvo = keys ? new Set(keys) : null;
  const candidatas = engine.decisions.pending.filter(d => !alvo || alvo.has(d.key));
  const labels = { approve: 'APPROVE', request_changes: 'REQUEST CHANGES', comment: 'COMMENT' };
  let resolvidas = 0;
  for (const item of candidatas) {
    // PR já mergeado (por outra pessoa, self-merge, ou na mão) enquanto a pendência
    // esperava você: postar review agora é ruído, então cancela sem tentar postar.
    // null (sem prova, rede/token) NUNCA cancela: só MERGED de verdade tira da fila.
    let estado;
    try { estado = await engine.prState({ ...item.pr, key: item.key }); }
    catch (err) { engine.log('WARN', `estado de ${item.key}: ${err.message}`); estado = null; }
    if (estado === 'MERGED' || estado === 'CLOSED') {
      const idx = engine.decisions.pending.findIndex(d => d.id === item.id);
      if (idx < 0) continue;
      engine.decisions.pending.splice(idx, 1);
      engine.resolveIntoHistory({ ...item, status: estado === 'MERGED' ? 'already_merged' : 'already_closed', action: 'skip' });
      resolvidas++;
      engine.emit('toast', {
        kind: 'info', text: estado === 'MERGED'
          ? `${item.key}: já foi mergeado; cancelei a revisão pendente.`
          : `${item.key}: o PR foi fechado sem merge; cancelei a revisão pendente.`
      });
      continue;
    }
    let reviews;
    try { reviews = await engine.myReviewsWithTime({ ...item.pr, key: item.key }); }
    catch (err) { engine.log('WARN', `reconciliar ${item.key}: ${err.message}`); continue; }
    if (!reviews) continue;
    // G12: review posterior à pendência OU review DECISIVO do MESMO head que a sessão
    // leu (você aprovou ou pediu mudanças à mão DURANTE a análise: o horário é anterior,
    // o head prova que fala do mesmo código). Review antigo em head antigo segue fora
    // (caso re-request, que motivou a trava de horário), e comentário anterior também
    // (C1: comentar não é decidir, e o card pode estar carregando um blocker).
    // Os DOIS ramos exigem `at` válido: o sort abaixo ordena por horário e um review
    // sem ele devolveria NaN no comparador, deixando indefinido qual é "o último".
    // Não custa nada ao G12: o review manual do cenário tem horário válido, só anterior.
    const depois = reviews
      .filter(r => REVIEW_STATE_ACTION[r.state] && r.at &&
        (r.at > item.createdAt
          || (item.headSha && r.commit && r.commit === item.headSha && DECISIVE_REVIEW_STATES.has(r.state))))
      .sort((a, b) => a.at - b.at);
    if (!depois.length) continue;
    // o desfecho é o ÚLTIMO review submetido: se você comentou e depois aprovou, o que
    // vale é a aprovação
    const action = REVIEW_STATE_ACTION[depois[depois.length - 1].state];
    // re-acha o índice agora: a lista pode ter mudado durante o await (clique no botão
    // resolvendo a mesma pendência), e aí não há nada pra reconciliar
    const idx = engine.decisions.pending.findIndex(d => d.id === item.id);
    if (idx < 0) continue;
    engine.decisions.pending.splice(idx, 1);
    engine.resolveIntoHistory({ ...item, status: 'already_reviewed', action });
    resolvidas++;
    engine.emit('toast', { kind: 'info', text: `${item.key}: ${labels[action]} seu já está no PR; tirei de Precisa de você.` });
  }
  if (resolvidas) engine.saveDecisions();
  return resolvidas;
}

// Teto de tentativas automáticas pra uma postagem que falhou por algo transitório
// (ver postRetry em recordDecision). Curto de propósito: se alguns ciclos de
// polling (cada um já É a janela de backoff, 180s-3600s conforme a config) não
// bastaram, o problema provavelmente não é mais "GitHub fora do ar", e nesse
// ponto a pendência esperando você é a leitura certa, não mais tentativa cega.
const MAX_POST_RETRY_ATTEMPTS = 3;

// Próximo estado do marcador depois de uma tentativa que falhou. `exhausted` é o
// que a tela lê pra dizer que o app desistiu, em vez de prometer um retry que não
// vem mais. Função e não literal no ponto de uso: ali são dois if aninhados dentro
// do laço, e o objeto estourava a profundidade do gate de qualidade.
function proximaTentativa(postRetry, erro) {
  const attempts = (postRetry.attempts || 0) + 1;
  return { ...postRetry, attempts, lastError: erro, exhausted: attempts >= MAX_POST_RETRY_ATTEMPTS };
}

// Varredura do ciclo de check() (chamada depois de reconcilePending, mesmo padrão
// de refreshMergeStates/scanPushbacks em server.js): reenvia sozinho a postagem de
// pendências que o GATE já tinha liberado (shouldAutoApprove/shouldAutoReject
// disseram ok:true) e só não saíram porque postReview falhou por algo transitório
// (caso real: biud-frontend#774, 17/08/2026, 503 do GitHub num outage). Não é um
// retry cego: reusa dois mecanismos que já existem pra manter isso seguro.
// - O payload já ficou gravado no item por recordDecision, então não reabre
//   sessão do Claude nem gasta token: só reenvia o MESMO APPROVE/REQUEST_CHANGES
//   que já tinha sido decidido.
// - myReviewStates confere no GitHub ANTES de reenviar, o mesmo dedup por head que
//   o caminho automático normal usa (review.js): se a 1ª tentativa na verdade
//   tinha ido pro ar (resposta se perdeu, só o cliente viu erro), o retry vira
//   no-op e a pendência resolve como se tivesse dado certo de primeira, sem
//   duplicar o review no PR.
async function retryFailedPosts(engine) {
  const candidatas = engine.decisions.pending.filter(d => d.postRetry && (d.postRetry.attempts || 0) < MAX_POST_RETRY_ATTEMPTS);
  let resolvidas = 0;
  for (const item of candidatas) {
    const event = item.postRetry.event; // 'approve' | 'request_changes'
    const payload = item.payloads && item.payloads[event];
    if (!payload) {
      // item sem o payload esperado (corrompido ou de uma versão anterior): não
      // reenvia às cegas. Some o marcador pra não ficar tentando pra sempre; a
      // pendência segue normal, esperando você, como qualquer outra.
      const idx = engine.decisions.pending.findIndex(d => d.id === item.id);
      if (idx >= 0) { engine.decisions.pending[idx].postRetry = null; engine.saveDecisions(); }
      continue;
    }
    // GATE 1, o head ainda e o mesmo? A decisao foi tomada sobre item.headSha, e o
    // retry pode acontecer horas depois (ate 3 ciclos de polling). Se o autor
    // empurrou commit novo nesse meio tempo, este APPROVE fala de codigo que nao
    // esta mais la, e postar aprovaria o que ninguem revisou. E o mesmo cuidado que
    // o decide() ja tem: ele le o head AO VIVO antes de postar, nao o guardado.
    // null (sem token, rede fora) NAO libera: sem prova de que o head e o mesmo,
    // nao se posta. Falha fechado de proposito, porque aqui a acao e escrita.
    let headAgora;
    try { headAgora = await engine.headSha(item.pr); }
    catch (err) { engine.log('WARN', `retryFailedPosts ${item.key}: ${err.message}`); continue; }
    if (!headAgora) continue;                       // sem confirmar, tenta no proximo ciclo
    if (headAgora !== item.headSha) {
      // o codigo mudou: a decisao envelheceu. Desarma o retry e deixa a pendencia
      // na mesa. O round novo entra pelo caminho normal (refreshStaleStates +
      // launchReReviews), que e quem sabe revisar o head novo.
      const idx = engine.decisions.pending.findIndex(d => d.id === item.id);
      if (idx < 0) continue;
      engine.decisions.pending[idx].postRetry = null;
      engine.decisions.pending[idx].reasons = [
        ...(item.reasons || []).filter(r => !(r && r.kind === 'infra')),
        { text: 'o autor empurrou commit novo antes de a postagem ser refeita, então a revisão anterior não vale mais pra este código', kind: 'gate' },
      ];
      engine.saveDecisions();
      continue;
    }
    // GATE 2, eu ja postei? Aqui o null tambem NAO libera, e a diferenca em relacao
    // ao caminho de primeira tentativa e o ponto: la nada tinha sido enviado ainda,
    // entao seguir era seguro. Aqui um POST JA SAIU (e por isso que ha um retry), e
    // o erro pode ter vindo DEPOIS de o GitHub aceitar. Sem conseguir confirmar,
    // reenviar arrisca review duplicado no PR.
    let states;
    try { states = await engine.myReviewStates(item.pr, item.headSha); }
    catch (err) { engine.log('WARN', `retryFailedPosts ${item.key}: ${err.message}`); continue; }
    if (states === null) continue;                  // idem: tenta no proximo ciclo
    const jaPostado = states.includes(event === 'approve' ? 'APPROVED' : 'CHANGES_REQUESTED');
    if (!jaPostado) {
      const post = await engine.postReview(item.pr, { ...payload, commit_id: item.headSha });
      if (!post.ok) {
        const idx = engine.decisions.pending.findIndex(d => d.id === item.id);
        if (idx < 0) continue; // resolvida por outra via durante o await (clique, reconcilePending)
        engine.decisions.pending[idx].postRetry = proximaTentativa(item.postRetry, post.error);
        engine.saveDecisions();
        continue;
      }
    }
    // sucesso (ou já tinha ido): resolve pra história igual ao caminho automático
    // normal. As reasons de conteúdo/gate (se houver) continuam visíveis em
    // `attention`; a razão de infra que segurou isso some, porque já foi resolvida.
    const idx = engine.decisions.pending.findIndex(d => d.id === item.id);
    if (idx < 0) continue;
    engine.decisions.pending.splice(idx, 1);
    const status = event === 'approve' ? 'auto_approved' : 'auto_rejected';
    const semInfra = (item.reasons || []).filter(r => !(r && r.kind === 'infra'));
    const resolved = { ...item, status, action: event, postRetry: null, reasons: semInfra, attention: semInfra };
    engine.resolveIntoHistory(resolved);
    engine.saveDecisions();
    resolvidas++;
    engine.writeMemory(resolved, event === 'approve' ? 'APPROVE' : 'REQUEST_CHANGES');
    const publicItem = engine.decisionForUi(resolved);
    engine.emit(event === 'approve' ? 'auto-approved' : 'auto-rejected',
      { pr: item.pr, result: publicItem, points: publicItem.attention || [] });
    engine.emit('toast', { kind: 'ok', text: `✅ ${item.key}: a postagem que tinha falhado por instabilidade foi sozinha agora.` });
  }
  return resolvidas;
}

// Deve auto-aprovar este PR? Aprovável = veredito approve + payload APPROVE.
// Devolve { ok, motivo }: ok true aprova sozinho; ok false carrega POR QUE não
// ('nao_aprovavel' | 'clique' | 'contestacao' | 'cobertura' | 'politica'), pra o
// chamador explicar a recusa sem adivinhar (antes a transparência do
// runHeadlessReview atribuía toda recusa à política da conta). Revisão iniciada
// por clique (requested === false) NUNCA auto-posta. Com autoApproveAll (default)
// todo aprovável passa; senão, só o gate estrito (auto_approve E card comprovado).
function shouldAutoApprove(engine, pr, result) {
  if (result.analysisStatus !== 'complete') return { ok: false, motivo: 'analise_incompleta' };
  const approvable = result.verdict === 'approve' &&
    result.payloads && result.payloads.approve && result.payloads.approve.event === 'APPROVE';
  if (!approvable) return { ok: false, motivo: 'nao_aprovavel' };
  if (pr.requested === false) return { ok: false, motivo: 'clique' };
  // contestar review de terceiro (dizer "isso é falso positivo") é afirmação pública
  // contra outro revisor: por default passa pelo humano, mesmo com autoApproveAll
  // ligado. Quem libera é uma decisão sua e só sua (`autoApproveContested`, Sistema >
  // Automação): liberado, a discordância deixa de travar e segue como ponto de
  // atenção, o que joga a decisão pra política de ressalvas logo abaixo (nunca é
  // "limpo" com contestação). Não afrouxa nenhum outro gate do invariante 4.
  if (contestations(result).length && engine.contestedPolicy() !== 'approve') {
    return { ok: false, motivo: 'contestacao' };
  }
  // cobertura incompleta em PR grande: "zero achado" aqui não prova nada, porque a
  // revisão não olhou o diff inteiro. Aprovar sozinho exige ter olhado tudo. Ressalva
  // NÃO entra nesta conta: ressalva aprova (decisão do Wanderson), lacuna de leitura não.
  if (coverageGap(result).length) return { ok: false, motivo: 'cobertura' };
  // checkpoint malformado ou com divergência entre passadas: mesma régua da cobertura,
  // "sem prova completa não posta sozinho" (ver a seção "Checkpoint de verificação" do CLAUDE.md)
  if (checkpointGap(result).length) return { ok: false, motivo: 'checkpoint' };
  // limpo = sem ressalvas (nenhum ponto de atenção) E a sessão decidiu auto_approve;
  // senão é "aprovável com ressalvas". A política da conta dona decide a ação.
  const clean = engine.attentionPoints(result).length === 0 && result.decision === 'auto_approve';
  if (engine.approvePolicyFor(engine.accountForPr(pr), clean) !== 'approve') {
    return { ok: false, motivo: 'politica' };
  }
  return { ok: true, motivo: null };
}

// Deve reprovar sozinho (postar REQUEST_CHANGES)? Só quando a revisão pediu
// mudanças (verdict request_changes + payload), foi um review PEDIDO a mim
// (clique nunca posta) e a conta optou por "reprova sozinho". Opt-in, default não.
function shouldAutoReject(engine, pr, result) {
  if (result.analysisStatus !== 'complete') return false;
  const rc = result.payloads && result.payloads.request_changes;
  const hasPublicFinding = !!(rc && (String(rc.body || '').trim()
    || (Array.isArray(rc.comments) && rc.comments.length)));
  const rejectable = result.verdict === 'request_changes' &&
    rc && rc.event === 'REQUEST_CHANGES' && hasPublicFinding;
  if (!rejectable || pr.requested === false) return false;
  if (contestations(result).length) return false;   // mesmo motivo do approve
  if (coverageGap(result).length) return false;     // reprovar com leitura parcial é pior ainda
  if (checkpointGap(result).length) return false;   // mesma régua do approve: divergência entre passadas não posta sozinho, nem approve nem reject
  return engine.rejectPolicyFor(engine.accountForPr(pr)) === 'request_changes';
}

// Arquivos do diff que a revisão NÃO conseguiu revisar (campo `coverage` do envelope,
// preenchido quando o PR foi revisado em lotes por subagentes). Cobertura incompleta
// não é achado, é falta de prova: a revisão não pode afirmar que o PR está limpo se
// não olhou o PR inteiro. Por isso segura a postagem automática (ver shouldAutoApprove).
// Envelope sem `coverage` (PR pequeno, passe único) devolve [] e nada muda.
function coverageGap(result) {
  const c = (result && result.coverage) || null;
  if (!c || typeof c !== 'object') return [];
  const missing = Array.isArray(c.missing) ? c.missing.map(p => String(p || '').trim()).filter(Boolean) : [];
  if (missing.length) return missing;
  // rede de segurança: revisados a menos que o total também é lacuna, mesmo com
  // missing vazio (a sessão pode ter contado errado ou esquecido de listar).
  // Zero revisado NÃO é passe livre: total declarado sem nenhum arquivo lido é
  // o pior caso (nada foi lido), e reviewed fora do contrato conta como zero.
  const total = Number(c.total) || 0;
  const revisados = Array.isArray(c.reviewed) ? c.reviewed.length : 0;
  if (total > 0 && revisados < total) {
    return [`${total - revisados} arquivo(s) do diff sem revisão declarada (revisou ${revisados} de ${total})`];
  }
  return [];
}

// mesmo padrão de coverageGap: função PURA, só olha result.verificationCheckpoint
// (montado por runHeadlessReview ANTES de chamar o gate, ver review.js), nunca disco.
function checkpointGap(result) {
  const vc = result && result.verificationCheckpoint;
  if (!vc) return [];
  if (vc.malformed) return ['checkpoint de verificação malformado'];
  const conflicts = Array.isArray(vc.conflicts) ? vc.conflicts : [];
  return conflicts.map((c) => {
    const primeira = (c.entries && c.entries[0]) || {};
    return `divergência de veredito em ${primeira.file || '?'}:${primeira.line || '?'} ("${primeira.claim || '?'}") entre passadas de verificação`;
  });
}

// Discordâncias de review de terceiro que a sessão quer publicar (campo `contested`
// do envelope). Normaliza e descarta item sem prova: contestação sem evidência não
// vale como contestação, e a regra é ficar calado quando não dá pra provar.
const CONTEST_LABELS = ['falso_positivo', 'fora_de_escopo', 'pre_existente', 'criterio_nao_vigente'];
function contestations(result) {
  const raw = (result && result.contested) || [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map(c => (c && typeof c === 'object') ? c : null)
    .filter(Boolean)
    .filter(c => CONTEST_LABELS.includes(String(c.label || '')) && String(c.evidence || '').trim());
}

// Rótulo curto pra tela e pro motivo (o texto longo vive no reportMarkdown).
const CONTEST_LABEL_PT = {
  falso_positivo: 'falso positivo',
  fora_de_escopo: 'fora do escopo pactuado',
  pre_existente: 'pré-existente, não veio deste PR',
  criterio_nao_vigente: 'critério não vigente no repo'
};

// Marca o corpo do REQUEST_CHANGES automático, pro autor saber que foi o Farol.
function rejectBodyWithMark(engine, body) {
  // o corpo vai como está: nada de carimbo de "automático", o review tem que
  // parecer o teu, humano. A rastreabilidade de que foi o Farol fica só no app.
  return String(body || '').trim();
}

// Pontos de atenção de uma revisão aprovável: as ressalvas que a sessão levantou
// (result.reasons) mais um aviso quando o card não foi comprovado. É o que a gente
// deixa claro ao aprovar sozinho, no PR e na tela.
// Cada ponto é { text, kind }: 'content' é a IA apontando algo sobre o PR,
// 'gate' é regra/política do app (cobertura incompleta, discordância de outro
// review), 'infra' vem de result.reasons quando review.js marcou falha de
// postagem. Mantém a mesma etiqueta que review.js já colocou em result.reasons;
// só os DOIS pontos que esta função cria do zero (card, cobertura) e o de
// contestação precisam de kind aqui.
function attentionPoints(engine, result) {
  const pts = [];
  if (result.cardMet === false) pts.push({ text: 'O card não foi totalmente comprovado na revisão automática, confira se necessário.', kind: 'content' });
  const faltando = coverageGap(result);
  if (faltando.length) {
    const amostra = faltando.slice(0, 5).join(', ');
    pts.push({ text: `A revisão não cobriu ${faltando.length} arquivo(s) do diff: ${amostra}${faltando.length > 5 ? ', ...' : ''}`, kind: 'gate' });
  }
  for (const c of contestations(result)) {
    pts.push({ text: `Discordância de outro review (${CONTEST_LABEL_PT[c.label]}): ${String(c.claim || '').trim()} · prova: ${String(c.evidence).trim()}`, kind: 'gate' });
  }
  // result.reasons já chega como { text, kind } (normalizado em runHeadlessReview);
  // string solta só acontece em caminho antigo/teste, vira 'content' por padrão.
  for (const r of (result.reasons || [])) {
    if (!r) continue;
    pts.push((typeof r === 'object' && typeof r.text === 'string') ? r : { text: String(r), kind: 'content' });
  }
  return pts;
}

// Âncora inline inválida: recua os pontos pro corpo e tenta de novo. O `commit_id` fica
// FORA de propósito: o 422 pode ter vindo da própria âncora de head, e reenviar o mesmo sha
// falharia igual. Sem o campo o GitHub carimba o head do momento do POST, então o dedup do
// ciclo seguinte lê este review como sendo do head novo: é a degradação escolhida (o
// fallback já desistiu da precisão ao recuar os inlines pro corpo), não um esquecimento.
function inlineFallbackPayload(payload) {
  return {
    event: payload.event,
    body: payload.body + '\n\nOs comentários abaixo não puderam ser ancorados nas linhas do diff:\n' +
      payload.comments.map(c => `- \`${c.path}:${c.line}\`: ${c.body}`).join('\n'),
    comments: []
  };
}

async function postReview(engine, pr, payload) {
  let file = null;
  let attempted = false;
  try {
    const normalized = normalizeReviewPayload(payload);
    if (!normalized.ok) {
      return { ok: false, blocked: 'invalid_payload', error: normalized.error };
    }
    payload = normalized.value;
    // Última fronteira antes de qualquer credencial, arquivo temporário ou `gh`.
    // Prompt é defesa de geração; esta trava é determinística e cobre APPROVE,
    // REQUEST_CHANGES, COMMENT e todos os comentários inline.
    const languageIssues = publicReviewLanguageIssues(payload);
    if (languageIssues.length) {
      const fields = [...new Set(languageIssues.map(x => x.field))].join(', ');
      engine.log('ERROR', `postar review ${pr.key}: texto público bloqueado por linguagem interna (${fields})`);
      return {
        ok: false,
        blocked: 'internal_language',
        error: 'a redação do review precisa ser ajustada antes de publicar',
        issues: languageIssues,
      };
    }
    if (!engine.token) await engine.refreshTokens();
    const acc = engine.accountForPr(pr);
    // ESCRITA no GitHub: sem o token DESTA conta, não posta (a alternativa era o
    // review sair assinado pela primária, o cenário central do A1)
    if (!engine.tokenFor(acc)) {
      const msg = `conta ${acc || '(nenhuma)'} sem token no gh, review não postado`;
      engine.log('ERROR', `postar review ${pr.key} (${payload.event}): ${msg}`);
      return { ok: false, error: msg };
    }
    // Uma revisão por conta pode postar em paralelo. Arquivo compartilhado deixava
    // uma chamada sobrescrever o corpo que outra ainda entregaria ao `gh --input`.
    file = path.join(STATE_DIR, `pr-review-payload-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    const repo = pr.repo || (pr.key || '').split('#')[0];
    const number = pr.number || parseInt((pr.key || '').split('#')[1], 10);
    attempted = true;
    let r = await io.run('gh', ['api', `repos/${repo}/pulls/${number}/reviews`, '--input', file], { env: engine.ghEnv(acc) });
    if (!r.ok && /line could not be resolved|422/i.test(r.stderr) && (payload.comments || []).length) {
      const fallback = inlineFallbackPayload(payload);
      const normalizedFallback = normalizeReviewPayload(fallback);
      if (!normalizedFallback.ok) {
        return { ok: false, blocked: 'invalid_payload', error: normalizedFallback.error };
      }
      const fallbackIssues = publicReviewLanguageIssues(normalizedFallback.value);
      if (fallbackIssues.length) {
        return {
          ok: false,
          blocked: 'internal_language',
          error: 'o fallback do review expõe linguagem interna da revisão; nada foi repostado',
          issues: fallbackIssues,
        };
      }
      fs.writeFileSync(file, JSON.stringify(normalizedFallback.value, null, 2));
      r = await io.run('gh', ['api', `repos/${repo}/pulls/${number}/reviews`, '--input', file], { env: engine.ghEnv(acc) });
    }
    if (!r.ok) {
      const msg = (r.stderr || r.stdout || 'erro desconhecido').trim().slice(0, 300);
      engine.log('ERROR', `postar review ${pr.key} (${payload.event}): ${msg}`);
      return { ok: false, attempted: true, error: msg };
    }
    return { ok: true };
  } catch (err) {
    engine.log('ERROR', `postar review ${pr.key}: ${err.message}`);
    return { ok: false, attempted, error: err.message };
  } finally {
    if (file) { try { fs.unlinkSync(file); } catch { /* best-effort */ } }
  }
}

const REVIEW_CAP_TTL_MS = 2 * 60 * 60 * 1000;

// Idade a partir da qual uma sessão de TERMINAL deixa de contar como viva: 12h cobre
// com folga o uso humano (almoço, reunião, voltar de manhã cedo no dia seguinte). Acima
// disso, quem segura a entrada quase sempre é um terminal FANTASMA (janela morta cujo
// aviso de saída, o trap EXIT, nunca chegou, pendência conhecida do macOS), e sessão
// fantasma não pode segurar credencial de escrita nem travar o update enquanto o engine
// viver. FONTE ÚNICA de propósito: o mesmo fantasma é julgado aqui (isenção de TTL da
// capability, G17) e em lib/engine/update.js (busy do update, G14); dois números
// divergentes fariam a mesma janela morta ser fantasma num lugar e viva no outro.
const TERMINAL_SESSION_MAX_MS = 12 * 60 * 60 * 1000;

// A sessão dona da cap ainda está aberta, é uma sessão de terminal E a cap ainda está
// dentro do teto absoluto? Só esse trio isenta do TTL (ver o laço de poda em reviewCaps).
// Sem createdAt confiável não há isenção: falha fechado, porque sem idade provada não dá
// pra afirmar que a cap está dentro do teto.
function terminalOwnerAlive(engine, cap, now) {
  if (!cap || !cap.ownerId) return false;
  if (!Number.isFinite(cap.createdAt) || now - cap.createdAt > TERMINAL_SESSION_MAX_MS) return false;
  if (!(engine.activeReviews instanceof Map)) return false;
  const dona = engine.activeReviews.get(String(cap.ownerId));
  return !!dona && dona.mode === 'terminal';
}

function reviewCaps(engine) {
  if (!(engine.reviewPostCaps instanceof Map)) engine.reviewPostCaps = new Map();
  const now = Date.now();
  for (const [token, cap] of engine.reviewPostCaps) {
    // G17: sessão de TERMINAL não tem prazo (o usuário abre a janela e pode voltar horas
    // depois); enquanto a sessão dona viver, a cap vive junto. O TTL segue valendo pra cap
    // ÓRFÃ (sessão morta que deixou token pra trás), que é o risco real que ele mitiga.
    // A isenção é SÓ de terminal, checada no modo da sessão dona: a revisão headless
    // (mode 'auto') também mora em activeReviews enquanto roda, e uma exceção genérica
    // por "dona viva" daria cap sem prazo pra ela. O chat nem entra em activeReviews.
    // E a isenção tem teto absoluto (TERMINAL_SESSION_MAX_MS): terminal fantasma não vira
    // credencial eterna.
    if (!cap || (cap.expiresAt <= now && !terminalOwnerAlive(engine, cap, now))) engine.reviewPostCaps.delete(token);
  }
  return engine.reviewPostCaps;
}

// Capability efêmera: o header x-farol é proteção de origem, não segredo. A escrita
// interativa precisa também estar limitada aos PRs e à conta daquela sessão.
function createReviewPostCapability(engine, keys, account, source, ownerId) {
  const scopedKeys = new Set((Array.isArray(keys) ? keys : [])
    .map(k => String(k || '').trim())
    .filter(k => /^[\w.-]+\/[\w.-]+#\d+$/.test(k)));
  if (!scopedKeys.size) return '';
  const token = crypto.randomBytes(32).toString('base64url');
  reviewCaps(engine).set(token, {
    keys: scopedKeys,
    used: new Set(),
    account: String(account || ''),
    source: String(source || ''),
    ownerId: String(ownerId || ''),
    createdAt: Date.now(), // âncora do teto absoluto da isenção de dona viva (G17)
    expiresAt: Date.now() + REVIEW_CAP_TTL_MS,
  });
  return token;
}

function revokeReviewPostCapability(engine, token) {
  if (engine.reviewPostCaps instanceof Map) engine.reviewPostCaps.delete(String(token || ''));
}

function revokeReviewPostCapabilitiesByOwner(engine, ownerId) {
  const owner = String(ownerId || '');
  if (!(engine.reviewPostCaps instanceof Map)) return;
  for (const [token, cap] of engine.reviewPostCaps) {
    if (cap && cap.ownerId === owner) engine.reviewPostCaps.delete(token);
  }
}

function reviewPostCapability(engine, token, key) {
  const cap = reviewCaps(engine).get(String(token || ''));
  if (!cap) return { ok: false, error: 'autorização de postagem ausente ou expirada' };
  if (!cap.keys.has(key)) return { ok: false, error: 'esta sessão não pode postar nesse PR' };
  if (cap.used.has(key)) return { ok: false, error: 'a revisão desse PR já foi enviada nesta sessão' };
  if (cap.inflight && cap.inflight.has(key)) return { ok: false, error: 'a revisão desse PR já está sendo enviada nesta sessão' };
  return { ok: true, cap };
}

// Único caminho de escrita usado pelas sessões interativas (terminal/chat).
// A sessão entrega URL/key + payload; identidade, token e lint continuam no app.
async function postReviewFromSession(engine, submission, capability) {
  const raw = submission && typeof submission === 'object' ? submission : {};
  let pr = raw.url ? engine.prFromUrl(String(raw.url)) : null;
  if (!pr && raw.key) {
    const m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(String(raw.key).trim());
    if (m) pr = {
      key: `${m[1]}#${m[2]}`,
      repo: m[1], number: parseInt(m[2], 10),
      url: `https://github.com/${m[1]}/pull/${m[2]}`,
    };
  }
  if (!pr) return { ok: false, error: 'PR inválido: informe url ou key owner/repo#numero' };
  const auth = reviewPostCapability(engine, capability, pr.key);
  if (!auth.ok) return { ok: false, blocked: 'capability', error: auth.error };
  pr.account = auth.cap.account;
  const payload = raw.payload;
  if (!(auth.cap.inflight instanceof Set)) auth.cap.inflight = new Set();
  auth.cap.inflight.add(pr.key);
  let result;
  try {
    result = await engine.postReview(pr, payload);
  } catch (err) {
    result = { ok: false, error: err.message };
  } finally {
    auth.cap.inflight.delete(pr.key);
  }
  // Depois que o GitHub foi chamado, uma falha pode ser ambígua. Consome a key
  // para nunca duplicar um review; bloqueios locais seguros continuam retentáveis.
  if (result.ok || result.attempted) auth.cap.used.add(pr.key);
  if (result.ok) {
    engine.reconcilePending([pr.key]).catch(err => engine.log('WARN', `reconcilePending ${pr.key}: ${err.message}`));
  }
  return result;
}

// memoria do time escrita pelo app (deterministica), a partir do JSON da sessao
function writeMemory(engine, result, actionLabel) {
  try {
    const mem = result.memory;
    // atribuição SEMPRE pela identidade confiável: result aqui é o item gravado pelo
    // recordDecision (pr vindo da fila). memory.author é saída de modelo e um login
    // mentiroso mandaria o dossiê (e o highlight) pro arquivo de outra pessoa.
    const login = result.pr && result.pr.author;
    if (!login) return;
    const today = new Date().toISOString().slice(0, 10);
    // repo COMPLETO (owner/repo) no ref: assim a memória do time fica atribuível
    // à conta/org dona, pra separar Destaques e Time por conta na UI. Entradas
    // antigas (só nome curto) ficam sem conta até o autor ser re-revisado.
    const ref = result.pr ? `${result.pr.repo}#${result.pr.number}` : '';
    const file = path.join(STATE_DIR, 'authors', `${login}.md`);
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { text = `# ${login}\n`; }
    const bullets = (mem && mem.bullets || []).filter(Boolean).map(b => `- ${b}`).join('\n');
    const entry = `## ${today} · ${ref} · ${actionLabel}\n${bullets}${bullets ? '\n' : ''}`;
    const nl = text.indexOf('\n');
    const head = nl >= 0 ? text.slice(0, nl + 1) : text + '\n';
    const rest = nl >= 0 ? text.slice(nl + 1) : '';
    const blocks = rest.split(/^(?=## )/m).filter(s => s.trim());
    blocks.unshift(entry);
    fs.writeFileSync(file, head + '\n' + blocks.slice(0, 10).join('\n').replace(/\n{3,}/g, '\n\n'));
    if (mem && mem.highlight) {
      fs.appendFileSync(path.join(STATE_DIR, 'highlights.md'), '\n' + mem.highlight.trim() + '\n');
    }
  } catch (err) {
    engine.log('ERROR', `escrever memoria (${actionLabel}): ${err.message}`);
  }
}

async function decide(engine, id, action) {
  const idx = engine.decisions.pending.findIndex(d => d.id === id);
  if (idx < 0) return { ok: false, error: 'decisão não encontrada (já resolvida?)' };
  const item = engine.decisions.pending[idx];
  const labels = { approve: 'APPROVE', request_changes: 'REQUEST CHANGES', comment: 'COMMENT' };

  if (action === 'skip') {
    engine.decisions.pending.splice(idx, 1);
    engine.resolveIntoHistory({ ...item, status: 'skipped', action });
    engine.saveDecisions();
    engine.emit('toast', { kind: 'info', text: `${item.key} pulado, nada foi postado.` });
    return { ok: true };
  }
  const payload = item.payloads && item.payloads[action];
  if (!payload) return { ok: false, error: `payload de ${action} não disponível` };
  const expectedEvent = { approve: 'APPROVE', request_changes: 'REQUEST_CHANGES', comment: 'COMMENT' }[action];
  if (!expectedEvent || String(payload.event || '').toUpperCase() !== expectedEvent) {
    return { ok: false, blocked: 'invalid_payload', error: `payload de ${action} tem evento incompatível` };
  }
  // dedup: review igual ja postado por mim PARA O HEAD ATUAL (via chat, manual no
  // GitHub, ou clique repetido apos falha ambigua de rede — caso real do biud-core#215).
  // O recorte por head e o que impede o clique explicito de ser engolido por um review
  // de rodada anterior, que ja nao fala do codigo que esta na tela (#742).
  const dupState = { approve: 'APPROVED', request_changes: 'CHANGES_REQUESTED', comment: 'COMMENTED' }[action];
  const head = await engine.headSha({ ...item.pr, key: item.key });
  const states = await engine.myReviewStates({ ...item.pr, key: item.key }, head);
  if (states && dupState && states.includes(dupState)) {
    // a lista pode ter mudado durante os awaits (unshift de pendência nova,
    // reconcilePending concorrente): re-acha o índice pela id, nunca usa o velho
    const cur = engine.decisions.pending.findIndex(d => d.id === item.id);
    if (cur >= 0) {
      engine.decisions.pending.splice(cur, 1);
      engine.resolveIntoHistory({ ...item, status: 'already_reviewed', action });
    } else {
      // já resolvida por outro caminho (reconcile) durante o dedup: não duplica
      // o histórico, só registra
      engine.log('WARN', `decide ${item.key}: pendência já resolvida durante o dedup, histórico preservado`);
    }
    engine.saveDecisions();
    engine.emit('toast', { kind: 'info', text: `${item.key}: já havia um ${labels[action]} seu neste PR; não postei de novo.` });
    return { ok: true };
  }
  // G1 + C1 da revisão final: a âncora é o head que a SESSÃO LEU (item.headSha), porque é
  // dele que o texto deste payload fala. O `head` fresco (buscado acima pro dedup) é só
  // fallback pra pendência antiga, gravada antes de o campo existir. Se o autor empurrou
  // commit entre a análise e o clique, carimbar o head novo faria o review descrever um
  // código que ninguém leu E convenceria o staleForReview de que o head novo já foi
  // revisado, matando o round 2 automático que o G1 existe pra garantir.
  const post = await engine.postReview({ ...item.pr, key: item.key }, { ...payload, commit_id: item.headSha || head || '' });
  if (!post.ok) {
    if (post.blocked === 'internal_language') {
      // G13: o payload é imutável e não existe editor; sem registrar o motivo, o
      // clique falha idêntico pra sempre sem dizer a saída. O chat do PR é o
      // caminho mediado pra redigir e postar um texto novo.
      item.blockedReason = 'a redação gerada foi bloqueada pelo filtro de linguagem; use o chat deste PR pra redigir e postar o review';
      engine.saveDecisions();
      engine.pushState();
      // o toast genérico entregaria "a redação do review precisa ser ajustada antes de
      // publicar" sem dizer o que fazer, e este é o único erro do clique cuja saída é
      // outro caminho do app (o chat do PR), não uma retentativa.
      engine.emit('toast', {
        kind: 'error',
        text: `Falha ao postar em ${item.key}: a redação foi bloqueada pelo filtro de linguagem; use o chat do PR pra redigir e postar.`
      });
      return post;
    }
    engine.emit('toast', { kind: 'error', text: `Falha ao postar em ${item.key}: ${post.error}` });
    return post;
  }
  const cur = engine.decisions.pending.findIndex(d => d.id === item.id);
  if (cur >= 0) {
    engine.decisions.pending.splice(cur, 1);
    engine.resolveIntoHistory({ ...item, status: 'posted', action });
  } else {
    // já resolvida por outro caminho (reconcile) durante o post: não duplica
    // o histórico, só registra
    engine.log('WARN', `decide ${item.key}: pendência já resolvida durante o post, histórico preservado`);
  }
  engine.saveDecisions();
  engine.writeMemory(item, labels[action] || action.toUpperCase());
  engine.emit('toast', { kind: 'ok', text: `${labels[action]} postado em ${item.key}.` });
  return { ok: true };
}

// Remoção de membro do Time (pedido do Wanderson, 15/08/2026: pessoa desligada
// não abre mais PR, e dossiê de quem saiu é anotação sobre pessoa sem finalidade
// operacional, higiene de dados manda apagar). Sai TUDO que é escopado à pessoa
// NESTA máquina: dossiê de reviews, destaques, perfil configurado (papel/matriz)
// e registros de pushback dela. Nada toca o GitHub, e se um PR antigo dela
// reaparecer o writeMemory simplesmente cria um dossiê novo do zero.
// O login vira NOME DE ARQUIVO, então a defesa é allowlist estrita no formato de
// login do GitHub (nunca sanitização): qualquer coisa fora do padrão é recusada
// antes de montar caminho, o que mata traversal por construção.
function removeTeamMember(engine, login) {
  const nome = String(login || '').trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(nome)) {
    return { ok: false, error: 'login inválido' };
  }
  const alvo = nome.toLowerCase();
  let removido = false;
  try { fs.unlinkSync(path.join(STATE_DIR, 'authors', `${nome}.md`)); removido = true; } catch { /* sem dossiê é ok */ }
  // destaques: só saem as linhas ATRIBUÍDAS à pessoa (formato "- data · @login · resto",
  // o mesmo parse do parseHighlights); linha que não casa o formato fica intocada
  try {
    const hl = path.join(STATE_DIR, 'highlights.md');
    const linhas = fs.readFileSync(hl, 'utf8').split(/\r?\n/);
    const resto = linhas.filter(l => {
      const m = l.match(/^-\s+(.*)$/);
      if (!m) return true;
      const parts = m[1].split('·').map(s => s.trim());
      if (parts.length < 3) return true;
      return parts[1].replace(/^@/, '').toLowerCase() !== alvo;
    });
    if (resto.length !== linhas.length) { fs.writeFileSync(hl, resto.join('\n')); removido = true; }
  } catch { /* sem highlights é ok */ }
  if (engine.config.people && engine.config.people[alvo]) {
    delete engine.config.people[alvo];
    engine.saveConfig();
    removido = true;
  }
  const pbKeys = Object.keys(engine.pushbacks || {}).filter(k => {
    const r = engine.pushbacks[k];
    return r && String(r.author || '').toLowerCase() === alvo;
  });
  if (pbKeys.length) {
    for (const k of pbKeys) delete engine.pushbacks[k];
    engine.savePushbacks();
    removido = true;
  }
  engine.pushState();
  return { ok: true, removed: removido };
}

const decisionMod = {
  recordDecision, resolveIntoHistory, decisionByKey, reviewActions, saveDecisions,
  myReviewsWithTime, myReviewStates, reconcilePending, retryFailedPosts,
  shouldAutoApprove, shouldAutoReject, rejectBodyWithMark, attentionPoints, contestations, coverageGap, checkpointGap,
  postReview, postReviewFromSession, inlineFallbackPayload, decisionForUi,
  reviewCaps, createReviewPostCapability, revokeReviewPostCapability, revokeReviewPostCapabilitiesByOwner,
  writeMemory, removeTeamMember, decide,
  TERMINAL_SESSION_MAX_MS, MAX_POST_RETRY_ATTEMPTS,
};
export default decisionMod;
export {
  recordDecision, resolveIntoHistory, decisionByKey, reviewActions, saveDecisions,
  myReviewsWithTime, myReviewStates, reconcilePending, retryFailedPosts,
  shouldAutoApprove, shouldAutoReject, rejectBodyWithMark, attentionPoints, contestations, coverageGap, checkpointGap,
  postReview, postReviewFromSession, inlineFallbackPayload, decisionForUi,
  reviewCaps, createReviewPostCapability, revokeReviewPostCapability, revokeReviewPostCapabilitiesByOwner,
  writeMemory, removeTeamMember, decide,
  TERMINAL_SESSION_MAX_MS, MAX_POST_RETRY_ATTEMPTS,
};
