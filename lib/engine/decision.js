// Concern de decisão + postagem no GitHub (Onda 2, colaborador). Registro das decisões
// (pendentes/histórico), gates de auto-aprovar/auto-reprovar, dedup de postagem, o post
// em si e a memória do time. Funções recebem o engine como ctx; a Engine mantém fachadas
// finas que delegam. Gate de postagem intacto (ver docs/REVIEW-GATES.md, invariante 4). Ver docs/QUALITY.md.
import fs from 'node:fs';
import roundsMod from './review-rounds.js';
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import io from '../io.js';
import { writeJsonAtomic } from '../io.js';
import { publicReviewLanguageIssues, normalizeReviewPayload, decisionForUi, reviewMarkdownForUi } from './public-review.js';
import { staleHeadText } from '../format.js';
import { coverageGap } from './file-proof.js';
import { marcaDoDestrave } from './destrava.js';
import { attentionPoints, contestations, checkpointGap } from './ressalvas.js';
import { TEMPOS } from '../constants.js';
import { arbitrarPostagem, postagemCoordenada, contornoComFirebaseFora, conferirNoGithub, coordenacaoForaDoAr } from './postagem-arbitragem.js';
import portao, { ehDaContaQueRevisa } from './postagem-portao.js';
import { inlineFallbackPayload, semAncoraPayload, recusaDoRecuo } from './postagem-recuo.js';
import { provasDaDecisao } from './provas-da-decisao.js';
import { marcarCommitNovo } from './pendencia-commit-novo.js';
import { checksVermelhos } from './gate-espera.js';
import { shouldAutoApprove, shouldAutoReject } from './approval-policy.js';
import { origemDoDono, ehPedidoDoCi, statusAutomatico, rotuloDaMemoria, eventoNaTela, jaPublicado } from './desfecho-automatico.js';
import { reviewCaps, createReviewPostCapability, revokeReviewPostCapability, revokeReviewPostCapabilitiesByOwner, reviewPostCapability, TERMINAL_SESSION_MAX_MS } from './autorizacao-postagem.js';
import { reciboDoTrabalho } from './continuidade-revisao.js';
import { technicalPublication } from '../technical-review/publication.js';
import { reviewEvidenceFields } from '../technical-review/registry.js';

function recordDecision(engine, pr, result, extra) {
  const reviewMarkdown = reviewMarkdownForUi({ ...result, action: extra && extra.action });
  const item = {
    id: `d${Date.now()}${Math.floor(Math.random() * 1000)}`,
    createdAt: Date.now(),
    // identidade SEMPRE do PR da fila (confiável), nunca do envelope: result.pr é
    // saída de modelo e um repo/number mentiroso redirecionaria a postagem
    // (decide() -> myReviewStates/postReview usam item.pr). O campo pr que o
    // prompt pede no envelope fica ignorado de propósito.
    // account viaja junto pra pendência poder relançar pela identidade certa: o
    // candidato do gatilho B (review.js, candidatosReRound) reconstrói o alvo A
    // PARTIR desta pendência quando o PR está fora do panorama, e sem account
    // aqui accountForPr cairia no fallback da conta primária, relançando (e
    // postando) o round com a identidade ERRADA do GitHub.
    // isDraft real (FIX v2.53.1): o gate de draft do round automático (G10)
    // precisa do dado verdadeiro quando o PR só existe na pendência.
    pr: { repo: pr.repo, number: pr.number, url: pr.url, title: pr.title, author: pr.author, account: pr.account || '', isDraft: !!pr.isDraft, requested: pr.requested === true, origemDono: origemDoDono(pr) },
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
    inventarioDiff: result.inventarioDiff || null,
    roundId: result.roundId || null, roundReview: result.roundReview || null,
    ...reviewEvidenceFields(result),
    technicalRecheck: result.technicalRecheck === true, provaEsgotada: result.provaEsgotada === true, prProprio: ehDaContaQueRevisa(engine, pr),
    // tempo por etapa da sessão (stageSummaryFrom, review.js): o feed morre com a
    // sessão, então a decisão é o único lugar onde a resposta de "por que demorou"
    // sobrevive. null em sessão sem traço (stub, cancelamento cedo).
    stages: result.stages || null,
    // o que sustentou a decisão, resumido para auditoria (provas-da-decisao.js, 03/10/2026)
    provas: provasDaDecisao(result),
    // marcado só quando shouldAutoApprove/shouldAutoReject já tinham liberado a
    // postagem e ELA MESMA falhou por algo transitório (ver classify em
    // log-taxonomy.js): retryFailedPosts (abaixo) reusa o payload já pronto pra
    // reenviar sozinho nos próximos ciclos, sem reabrir sessão nem gastar token.
    // null = pendência de verdade (gate barrou por regra/conteúdo), nunca entra
    // no sweep.
    postRetry: result.postRetry || null,
    ...extra,
    trabalhoIniciado: reciboDoTrabalho(engine, pr, result.headSha)
  };
  // Round novo do MESMO PR SUBSTITUI a pendência que travou em head velho, em
  // QUALQUER desfecho: aquele card fala de código que não existe mais e o payload
  // está ancorado num sha que o GitHub recusa. Antes isso só valia quando o round
  // novo também virava pendência; um round que POSTAVA deixava o card morto na
  // mesa. Só o bloqueio por head velho é substituído: pendência viva (gate barrou
  // por regra ou conteúdo) continua sendo sua pra decidir.
  // Rodadas PRESAS em sequência (v2.59.3): round que termina de novo em stale_head
  // herda a contagem da pendência que substitui, +1; qualquer outro desfecho não
  // carrega nada, e a sequência recomeça. O gate (explicaReRound, review.js) troca a
  // espera de PR quieto pela longa quando a sequência chega a MAX_RODADAS_PRESAS.
  // Só o round da sessão entra aqui: a pendência que vira stale no clique (decide,
  // abaixo) não foi rodada presa nenhuma.
  if (item.status === 'pending' && item.blockedKind === 'stale_head') {
    const anterior = engine.decisions.pending.find(d => d.key === item.key && d.blockedKind === 'stale_head');
    item.rodadasPresas = (anterior ? (Number(anterior.rodadasPresas) || 0) : 0) + 1;
  }
  for (const velha of engine.decisions.pending.filter(d => d.key === item.key && (d.provaEsgotada === true || ['stale_head', 'technical_recheck'].includes(d.blockedKind)))) {
    const i = engine.decisions.pending.findIndex(d => d.id === velha.id);
    if (i >= 0) engine.decisions.pending.splice(i, 1);
    engine.resolveIntoHistory({ ...velha, status: 'superseded', action: 'skip' });
  }
  if (item.status === 'pending') engine.decisions.pending.unshift(item);
  else engine.resolveIntoHistory(item);
  roundsMod.recordPublicationOutcome(engine, item);
  engine.saveDecisions();
  return item;
}

function resolveIntoHistory(engine, item) {
  item.resolvedAt = Date.now();
  roundsMod.recordPublicationOutcome(engine, item);
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
    else if (['posted', 'already_reviewed', 'commented_own_pr'].includes(d.status)) map[d.key] = { kind: d.action, at: d.resolvedAt, caveats: caveats(d) };
  }
  for (const d of engine.decisions.pending) map[d.key] = { kind: 'pending', at: d.createdAt, ...(d.esperaCi ? { esperaCi: true } : {}), ...(d.esperaProva && { esperaProva: true }) };
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
    '--jq', `[.[] | select((.user.login | ascii_downcase) == "${me}") | {state, submitted_at, commit_id, body}]`], { env: engine.ghEnv(acc) });
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
      commit: String((x && x.commit_id) || ''), body: String((x && x.body) || '')
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
// PEDIDO DE REVISAO NOVO (02/10/2026): review meu ANTERIOR a um pedido de revisao
// posterior nao responde ao que foi pedido agora, entao ele sai da conta do dedup. Sem
// isto, o autor que remove e pede a revisao de novo (botao do GitHub, head igual) nunca
// recebe revisao: a rodada ate roda e termina em already_reviewed, gastando sessao e nao
// entregando nada. O afrouxamento e ESTREITO de proposito: so vale com a marca de
// destrave do tipo `pedido` (lib/engine/destrava.js, que a grava com o instante do evento
// `review_requested` lido da timeline), nunca para push, e review sem carimbo de hora
// nunca e descartado. Fora disso o recorte por head segue intacto, que e a protecao do
// #742 e do APPROVE duplicado do biud-esg#230.
function pedidoDeRevisaoEm(engine, pr) {
  const key = String((pr && pr.key) || '');
  if (!key) return 0;
  const marca = marcaDoDestrave(engine, key);
  return marca.tipo === 'pedido' ? marca.at : 0;
}

async function myReviewStates(engine, pr, headSha) {
  const reviews = await engine.myReviewsWithTime(pr);
  if (!reviews) return null;
  const head = String(headSha || '');
  const pedido = pedidoDeRevisaoEm(engine, pr);
  return reviews
    .filter(r => !head || !r.commit || r.commit === head)
    .filter(r => !pedido || !r.at || r.at > pedido)
    .map(r => r.state);
}

// Estado de review no GitHub -> ação equivalente do Farol. DISMISSED e PENDING ficam
// FORA de propósito: review derrubado deixou de valer e rascunho nunca foi postado,
// então nenhum dos dois atende uma pendência.
const REVIEW_STATE_ACTION = { APPROVED: 'approve', CHANGES_REQUESTED: 'request_changes', COMMENTED: 'comment' };

// Estados que, SOZINHOS, são desfecho de uma pendência: você decidiu sobre aquele código.
// COMMENTED fica de fora porque comentar não decide nada (pergunta ao autor, recado de
// "vou olhar", comentário de outro assunto). Só o ramo do MESMO HEAD usa esta tabela: no
// ramo do horário, comentar DEPOIS que o card nasceu é atendimento e segue valendo.
// Exportado porque o preflight da coordenação entre aparelhos (lib/sync/coordinator.js)
// faz a mesma pergunta ("já decidi sobre este head?") e não pode ter tabela própria.
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
      .filter(r => REVIEW_STATE_ACTION[r.state] && r.at && !ehPedidoDoCi(item, r) &&
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
  // a que sobrou na mesa e ganhou commit novo vira stale_head, sem clique (02/10/2026)
  await marcarCommitNovo(engine, alvo);
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
  // coordenação ligada e fora do ar: o reenvio é automático e seria recusado na arbitragem,
  // depois de gastar a leitura do head e dos reviews no GitHub a cada ciclo. Espera a conexão.
  if (coordenacaoForaDoAr(engine)) return 0;
  const candidatas = engine.decisions.pending.filter(d => d.postRetry && (d.postRetry.attempts || 0) < MAX_POST_RETRY_ATTEMPTS);
  let resolvidas = 0;
  for (const item of candidatas) {
    const event = item.postRetry.event; // 'approve' | 'request_changes' | 'comment' (PR próprio)
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
    const jaPostado = await jaPublicado(engine, item, event, payload, states);
    if (jaPostado === null) continue;              // idem (e comentário sem conferir): próximo ciclo
    if (!jaPostado) {
      const post = await engine.postReview({ ...item.pr, key: item.key }, { ...payload, commit_id: item.headSha }, { via: 'reenvio', continuidade: item });
      if (!post.ok) {
        // CT-POST: incerto, posse ou estado desconhecido não gastam tentativa; o próximo ciclo decide
        if (post.estado && post.estado !== 'recusada') continue;
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
    const status = statusAutomatico(event);
    const semInfra = (item.reasons || []).filter(r => !(r && r.kind === 'infra'));
    const resolved = { ...item, status, action: event, postRetry: null, reasons: semInfra, attention: semInfra };
    engine.resolveIntoHistory(resolved);
    engine.saveDecisions();
    resolvidas++;
    await publicarRecibo(engine, item, item.headSha);
    engine.writeMemory(resolved, rotuloDaMemoria(event));
    const publicItem = engine.decisionForUi(resolved);
    engine.emit(eventoNaTela(event),
      { pr: item.pr, result: publicItem, points: publicItem.attention || [] });
    engine.emit('toast', { kind: 'ok', text: `✅ ${item.key}: a postagem que tinha falhado por instabilidade foi sozinha agora.` });
  }
  return resolvidas;
}

// coverageGap (a lacuna de cobertura da leitura) mora em lib/engine/file-proof.js, junto
// da herança e da medição do diff que ela confere: a regra de cobertura fica num lugar só.
// Este módulo só a aplica nos gates e a reexporta para as fachadas.

// checksVermelhos (checks obrigatórios em FAILURE no head) mora em lib/engine/gate-espera.js,
// junto de CI em andamento e dependência em aberto: a regra de quando a aprovação espera
// fica num lugar só. Este módulo a reexporta para a fachada do server.js e os testes.

// checkpointGap, contestations e attentionPoints moram em lib/engine/ressalvas.js desde
// 30/09/2026 (a regra do que é ressalva num lugar só). Este módulo os aplica e reexporta.

// Marca o corpo do REQUEST_CHANGES automático, pro autor saber que foi o Farol.
function rejectBodyWithMark(engine, body) {
  // o corpo vai como está: nada de carimbo de "automático", o review tem que
  // parecer o teu, humano. A rastreabilidade de que foi o Farol fica só no app.
  return String(body || '').trim();
}

// O recuo do 422 (inlineFallbackPayload, semAncoraPayload) e a conferência do head antes
// dele moram em lib/engine/postagem-recuo.js desde 05/10/2026.

// `gh api` fala por DOIS canais quando o GitHub recusa: no stderr vai a linha curta
// ("gh: Unprocessable Entity (HTTP 422)") e no stdout vai o corpo JSON inteiro, onde mora
// o `errors[]` que diz QUAL campo caiu. Preferir o stderr, como fazíamos, jogava fora a
// única metade acionável, e foi por isso que o 422 do biud-esg#224 chegou no log e na tela
// como oito palavras que não explicam nada. As duas metades andam juntas agora.
function ghErrorDetails(stdout) {
  const corpo = String(stdout || '').trim();
  if (!corpo.startsWith('{')) return '';
  const json = io.parseJson(corpo, null);
  const errs = json && Array.isArray(json.errors) ? json.errors : [];
  return errs.map(e => {
    if (typeof e === 'string') return e.trim();
    if (!e || typeof e !== 'object') return '';
    const campo = [e.resource, e.field].filter(Boolean).join('.');
    const texto = String(e.message || e.code || '').trim();
    return [campo, texto].filter(Boolean).join(': ');
  }).filter(Boolean).join('; ');
}

function ghErrorMessage(r) {
  const curto = String(r.stderr || '').trim();
  const base = curto || String(r.stdout || '').trim() || 'erro desconhecido';
  const detalhe = ghErrorDetails(r.stdout);
  return (detalhe && !base.includes(detalhe) ? `${base} · ${detalhe}` : base).slice(0, 300);
}

/* ---------- fila de postagem por PR (a corrida do biud-esg#230) ----------
   Cinco caminhos postam review: a revisão automática (review.js), o reenvio de
   postagem que falhou (retryFailedPosts), o clique (decide), o chat do PR
   (postReviewFromSession) e a co-assinatura (skip-review). Todos consultam
   `myReviewStates` antes, e ainda assim saíram DOIS APPROVE no biud-esg#230 em
   23/08/2026, com 10 segundos de diferença: a consulta responde sobre o passado,
   e entre ela e o POST cabe outro POST. Quem perguntou primeiro não tinha como
   ver o review que ainda estava no ar.

   Por isso a trava mora AQUI, no funil, e não em cada via: postagens do mesmo PR
   pela mesma conta entram em fila, e quem chega depois não repete o veredito que
   acabou de sair para o MESMO head. O que continua passando: round novo (head
   diferente é outra manifestação, como os dois APPROVE legítimos do engine-ai#51),
   COMMENT (o chat conversa, e travar isso emudeceria a conversa), outro PR, outra
   conta, e o repost depois de uma tentativa que FALHOU (falha não é entrega). */
const DEDUP_EVENTS = new Set(['APPROVE', 'REQUEST_CHANGES']);
// Janela da memória do que já saiu (TEMPOS.POSTAGEM_MEMORIA_MS). CURTA de
// propósito: o que esta memória resolve é a corrida entre duas vias, medida em
// segundos. Fora dela quem decide é o dedup remoto de cada via, que pergunta ao
// GitHub e sabe o que esta memória não sabe (review DISMISSED pelo autor deixou
// de valer, então repostar no mesmo head é legítimo). Janela longa aqui vetaria
// essa repostagem e devolveria ok pro chamador, que resolveria a pendência sem
// nada ter chegado ao PR.

function postLaneKey(engine, pr) {
  const repo = pr.repo || (pr.key || '').split('#')[0];
  const number = pr.number || parseInt((pr.key || '').split('#')[1], 10);
  const acc = String(engine.accountForPr(pr) || '').toLowerCase();
  return `${acc}|${repo}#${number}`;
}

function postedMemory(engine) {
  if (!(engine.postedReviews instanceof Map)) engine.postedReviews = new Map();
  const agora = Date.now();
  for (const [k, at] of engine.postedReviews) if (agora - at > TEMPOS.POSTAGEM_MEMORIA_MS) engine.postedReviews.delete(k);
  return engine.postedReviews;
}

// assinatura do que foi entregue: veredito + head. Sem head (o gh não respondeu,
// pendência antiga), sobra o veredito, que é o comportamento conservador certo:
// sem saber de que código o review fala, repetir o mesmo veredito é duplicata.
// O sha passa pela MESMA régua do normalizeReviewPayload (public-review.js): sha
// torto é descartado lá e o review sai sem âncora, então ele também não pode
// distinguir duas assinaturas aqui, ou a duplicata voltaria por um detalhe que o
// GitHub nem chegou a ver.
function postedSignature(lane, payload) {
  const cru = String((payload && payload.commit_id) || '');
  const sha = /^[0-9a-f]{7,40}$/i.test(cru) ? cru.toLowerCase() : '';
  return `${lane}|${String((payload && payload.event) || '').toUpperCase()}|${sha}`;
}

// CT-POST: com a coordenação entre aparelhos ligada, APPROVE e REQUEST_CHANGES passam pela
// arbitragem (lib/engine/postagem-arbitragem.js), que cuida de posse, intenção durável e
// desfecho em volta da MESMA fila por PR de sempre. Desligada, ou para COMMENT, o caminho é
// o de antes, byte a byte nas chamadas ao gh. `opcoes` ({ via, handle, commitIdObrigatorio,
// recuoPermitido }) só é lido pela arbitragem.
async function postReview(engine, pr, payload, opcoes) {
  if (!postagemCoordenada(engine, payload)) return enfileirarPostagem(engine, pr, payload, null, opcoes?.continuidade, opcoes);
  // Firebase ligado mas fora do ar: o ato explícito posta sem arbitragem (postagem-arbitragem.js)
  if (contornoComFirebaseFora(engine, opcoes)) {
    const ja = await conferirNoGithub(engine, pr, payload);
    if (ja) return ja;
    engine.log('WARN', `postar review ${pr.key}: coordenação entre aparelhos fora do ar; postado sem ela por ação sua`);
    return enfileirarPostagem(engine, pr, payload, null, opcoes?.continuidade, opcoes);
  }
  return arbitrarPostagem(engine, { ...(opcoes || {}), pr, payload }, (guarda) => enfileirarPostagem(engine, pr, payload, guarda, opcoes?.continuidade, opcoes));
}

function enfileirarPostagem(engine, pr, payload, guarda, continuidade, options) {
  const lane = postLaneKey(engine, pr);
  if (!(engine.postLanes instanceof Map)) engine.postLanes = new Map();
  const anterior = engine.postLanes.get(lane) || Promise.resolve();
  // a cauda nunca rejeita: uma postagem que falha não pode derrubar a próxima da fila
  const minha = anterior.then(() => postReviewSerial(engine, pr, payload, lane, guarda, continuidade, options),
    () => postReviewSerial(engine, pr, payload, lane, guarda, continuidade, options));
  const cauda = minha.then(() => { }, () => { });
  engine.postLanes.set(lane, cauda);
  cauda.then(() => { if (engine.postLanes.get(lane) === cauda) engine.postLanes.delete(lane); });
  return minha;
}

async function postReviewSerial(engine, pr, payload, lane, guarda, continuidade, options) {
  const evento = String((payload && payload.event) || '').toUpperCase();
  // CT-POST, passo 2: a releitura só vale DEPOIS da espera nesta fila
  if (guarda && !(await guarda.naVez())) return { ok: false };
  if (DEDUP_EVENTS.has(evento)) {
    const memoria = postedMemory(engine);
    const assinatura = postedSignature(lane, payload);
    if (memoria.has(assinatura)) {
      // não é erro: o review que este chamador queria ver no PR está lá. Devolver
      // ok:true é o que faz a pendência sair da mesa em vez de voltar pra fila.
      engine.log('WARN', `postar review ${pr.key} (${evento}): outra via já postou este veredito neste head há instantes; não dupliquei`);
      return { ok: true, deduped: true };
    }
  }
  const r = await postReviewOnce(engine, pr, payload, guarda, continuidade, options);
  if (r.ok && !r.deduped && DEDUP_EVENTS.has(evento)) {
    postedMemory(engine).set(postedSignature(lane, payload), Date.now());
  }
  return r;
}

async function postReviewOnce(engine, pr, payload, guarda, continuidade, options) {
  const roundRefusal = roundsMod.publicationRefusal(engine, options, payload);
  if (roundRefusal) return roundRefusal;
  let file = null;
  let attempted = false;
  // travas do PR (org sem conta dona; PR mergeado ou fechado, mais abaixo): postagem-portao.js
  const semConta = portao.recusaDaConta(engine, pr, payload, continuidade);
  if (semConta) return semConta;
  try {
    const normalized = normalizeReviewPayload(payload);
    if (!normalized.ok) {
      return { ok: false, blocked: 'invalid_payload', error: normalized.error };
    }
    payload = normalized.value;
    // Última fronteira antes de qualquer credencial, arquivo temporário ou `gh`.
    // Prompt é defesa de geração; esta trava é determinística e cobre APPROVE,
    // REQUEST_CHANGES, COMMENT e todos os comentários inline.
    // A conta que VAI POSTAR entra no gate: e ela que o texto nao pode citar em terceira
    // pessoa (lib/engine/public-review.js, selfMentionIssues). Lida aqui, antes do token,
    // porque a trava de linguagem e anterior a qualquer credencial.
    const conta = engine.accountForPr(pr);
    const languageIssues = publicReviewLanguageIssues(payload, conta);
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
    // ESCRITA no GitHub: sem o token DESTA conta, não posta (a alternativa era o
    // review sair assinado pela primária, o cenário central do A1)
    if (!engine.tokenFor(conta)) {
      const msg = `conta ${conta || '(nenhuma)'} sem token no gh, review não postado`;
      engine.log('ERROR', `postar review ${pr.key} (${payload.event}): ${msg}`);
      return { ok: false, error: msg };
    }
    const technical = await technicalPublication.approvalRefusal(engine, pr, payload);
    if (technical) return technical;
    const fechado = await portao.recusaPorEstado(engine, pr, payload);
    if (fechado) return fechado;
    // Uma revisão por conta pode postar em paralelo. Arquivo compartilhado deixava
    // uma chamada sobrescrever o corpo que outra ainda entregaria ao `gh --input`.
    file = path.join(STATE_DIR, `pr-review-payload-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    const repo = pr.repo || (pr.key || '').split('#')[0];
    const number = pr.number || parseInt((pr.key || '').split('#')[1], 10);
    // CT-POST, passos 3 e 4: intenção durável e última conferência da posse, colados no io.run
    if (guarda && !(await guarda.antesDoEnvio(payload))) return { ok: false, attempted: false };
    attempted = true;
    let r = await io.run('gh', ['api', `repos/${repo}/pulls/${number}/reviews`, '--input', file], { env: engine.ghEnv(conta) });
    if (guarda) await guarda.depoisDoEnvio(r);
    // Recuo em UM degrau quando o GitHub recusa o conteúdo: com inline, os pontos voltam
    // pro corpo; sem inline, sobra largar a âncora. Nenhum dos dois mexe no texto que você
    // leu, e nenhum dos dois repete o payload idêntico (insistir só duplicaria a recusa).
    let fallback = null;
    if (!r.ok && /line could not be resolved|422/i.test(r.stderr)) {
      fallback = (payload.comments || []).length ? inlineFallbackPayload(payload) : semAncoraPayload(payload);
    }
    // CT-POST, passo 6: com arbitragem, só recua depois de recusa PROVADA, e nunca quando a via proíbe
    if (fallback && guarda && !guarda.podeRecuar()) fallback = null;
    if (fallback) {
      const recusa = await recusaDoRecuo(engine, pr, payload, ghErrorMessage(r));
      if (recusa) return recusa;
      const normalizedFallback = normalizeReviewPayload(fallback);
      if (!normalizedFallback.ok) {
        return { ok: false, blocked: 'invalid_payload', error: normalizedFallback.error };
      }
      const fallbackIssues = publicReviewLanguageIssues(normalizedFallback.value, conta);
      if (fallbackIssues.length) {
        return {
          ok: false,
          blocked: 'internal_language',
          error: 'o fallback do review expõe linguagem interna da revisão; nada foi repostado',
          issues: fallbackIssues,
        };
      }
      fs.writeFileSync(file, JSON.stringify(normalizedFallback.value, null, 2));
      if (guarda && !(await guarda.antesDoEnvio(normalizedFallback.value))) return { ok: false, attempted: true };
      r = await io.run('gh', ['api', `repos/${repo}/pulls/${number}/reviews`, '--input', file], { env: engine.ghEnv(conta) });
      if (guarda) await guarda.depoisDoEnvio(r);
    }
    if (!r.ok) {
      const msg = ghErrorMessage(r);
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
    result = await engine.postReview(pr, payload, { via: 'sessao', continuidade: auth.cap.continuidade?.get(pr.key) });
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

function writeHighlight(engine, result, mem, today, login, ref) {
  if (engine.config.teamHighlights !== true || !mem?.highlight) return;
  // A sessão sugere o CONTEÚDO, nunca identidade/data/PR. Esses campos vêm do
  // mesmo envelope confiável usado pelo dossiê, inclusive na autoanálise.
  const raw = String(mem.highlight).trim().replace(/^[-*]\s*/, '');
  const sep = raw.indexOf('—');
  const praise = (sep >= 0 ? raw.slice(sep + 1) : raw).trim();
  if (!praise) return;
  const url = result.pr.url || `https://github.com/${result.pr.repo}/pull/${result.pr.number}`;
  const line = `- ${today} · @${login} · [${ref}](${url}) — ${praise}`;
  const highlights = path.join(STATE_DIR, 'highlights.md');
  let current = '';
  try { current = fs.readFileSync(highlights, 'utf8'); } catch { current = ''; }
  if (!current.split(/\r?\n/).includes(line)) fs.appendFileSync(highlights, '\n' + line + '\n');
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
    writeHighlight(engine, result, mem, today, login, ref);
  } catch (err) {
    engine.log('ERROR', `escrever memoria (${actionLabel}): ${err.message}`);
  }
}

// Postagem que saiu por aqui fecha o recibo de coordenação do head como publicado (C0,
// defeito 3). Engine de teste montado à mão não tem a fachada, e aí nada muda. Nunca
// lança: o review já está no PR, a falha só mantém o recibo como estava.
async function publicarRecibo(engine, item, head) {
  if (typeof engine.syncAtualizarPublicacao !== 'function') return;
  const pr = { ...(item.pr || {}), key: item.key };
  const account = pr.account || (typeof engine.accountForPr === 'function' ? engine.accountForPr(pr) : '');
  try {
    await engine.syncAtualizarPublicacao({ account, prKey: item.key, headSha: item.headSha || head || '', operationKind: 'review', publicationState: 'published' });
  } catch (err) {
    engine.log('WARN', `recibo de coordenação de ${item.key}: ${err.message}`);
  }
}

async function decide(engine, id, action, { viaAdmin = false } = {}) {
  const idx = engine.decisions.pending.findIndex(d => d.id === id);
  if (idx < 0) return { ok: false, error: 'decisão não encontrada (já resolvida?)' };
  const item = engine.decisions.pending[idx];
  const labels = { approve: 'APPROVE', request_changes: 'REQUEST CHANGES', comment: 'COMMENT' };

  if (action === 'skip') {
    engine.decisions.pending.splice(idx, 1);
    engine.resolveIntoHistory({ ...item, status: 'skipped', action });
    engine.saveDecisions();
    if (!viaAdmin) engine.emit('toast', { kind: 'info', text: `${item.key} pulado, nada foi postado.` });
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
    await publicarRecibo(engine, item, head);
    engine.emit('toast', { kind: 'info', text: `${item.key}: já havia um ${labels[action]} seu neste PR; não postei de novo.` });
    return { ok: true };
  }
  // G1 + C1 da revisão final: a âncora é o head que a SESSÃO LEU (item.headSha), porque é
  // dele que o texto deste payload fala. O `head` fresco (buscado acima pro dedup) é só
  // fallback pra pendência antiga, gravada antes de o campo existir. Se o autor empurrou
  // commit entre a análise e o clique, carimbar o head novo faria o review descrever um
  // código que ninguém leu E convenceria o staleForReview de que o head novo já foi
  // revisado, matando o round 2 automático que o G1 existe pra garantir.
  // Mesma trava do caminho automático (review.js), aqui na ponta do clique: se o PR
  // andou depois da revisão, este payload não tem para onde ir. Ancorado no head lido, o
  // GitHub recusa com 422 e o clique falha idêntico pra sempre (foi o que aconteceu no
  // biud-esg#224); sem âncora, o review sairia falando de um código que ninguém leu. Em
  // vez de qualquer um dos dois, a pendência fica na mesa dizendo o que aconteceu e qual
  // é a saída. Head desconhecido degrada pro comportamento antigo, como no dedup.
  if (head && item.headSha && head !== item.headSha) {
    item.blockedReason = `${staleHeadText(item.headSha, head)}; este texto fala do código anterior. Só a revisão do commit atual pode ser postada, e o card mostra quando ela sai.`;
    // o TIPO do bloqueio é dado, não frase: a tela decide por ele se oferece o botão
    // de revisar de novo, em vez de farejar o texto em português (que muda).
    item.blockedKind = 'stale_head';
    // head observado na hora do clique, pra quem lê a pendência (ex.: a Task 4)
    // saber pra qual head relançar, sem precisar consultar o GitHub de novo.
    item.blockedHead = head;
    engine.saveDecisions();
    engine.pushState();
    engine.emit('toast', { kind: 'error', text: `Não postei em ${item.key}: ${staleHeadText(item.headSha, head)}; o card mostra quando reviso de novo.` });
    return { ok: false, blocked: 'stale_head', error: item.blockedReason };
  }
  const post = await engine.postReview({ ...item.pr, key: item.key }, { ...payload, commit_id: item.headSha || head || '' }, { via: 'clique', continuidade: item });
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
  await publicarRecibo(engine, item, head);
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
  shouldAutoApprove, shouldAutoReject, rejectBodyWithMark, attentionPoints, contestations, coverageGap, checkpointGap, checksVermelhos,
  postReview, postReviewFromSession, postedSignature, inlineFallbackPayload, decisionForUi,
  reviewCaps, createReviewPostCapability, revokeReviewPostCapability, revokeReviewPostCapabilitiesByOwner,
  writeMemory, removeTeamMember, decide, publicarRecibo,
  TERMINAL_SESSION_MAX_MS, MAX_POST_RETRY_ATTEMPTS, DECISIVE_REVIEW_STATES,
};
export default decisionMod;
export {
  recordDecision, resolveIntoHistory, decisionByKey, reviewActions, saveDecisions,
  myReviewsWithTime, myReviewStates, reconcilePending, retryFailedPosts,
  shouldAutoApprove, shouldAutoReject, rejectBodyWithMark, attentionPoints, contestations, coverageGap, checkpointGap, checksVermelhos,
  postReview, postReviewFromSession, postedSignature, inlineFallbackPayload, decisionForUi,
  reviewCaps, createReviewPostCapability, revokeReviewPostCapability, revokeReviewPostCapabilitiesByOwner,
  writeMemory, removeTeamMember, decide, publicarRecibo,
  TERMINAL_SESSION_MAX_MS, MAX_POST_RETRY_ATTEMPTS, DECISIVE_REVIEW_STATES,
};
