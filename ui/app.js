/* Farol · UI: consome o engine local via SSE + fetch. Sem frameworks. */

import {
  safeJsonParse, parseGoto,
} from './pure.js';
import { telasRegistradas, telaPorId } from './telas/registro.js';
import { tokenLocal, FonteDeEventosAutenticada, OCIOSO_MS, recusaDeLoginExterno } from './transporte.js';
import { montarPareamento, precisaParear, voltarDoPareamento } from './telas/pareamento.js';
import {
  estado, abaAtual, definirEstado, definirEscopo, definirAba,
  teamHighlightsEnabled, deliveriesEnabled,
  ehMac, ehElectron, definirPlataforma,
} from './telas/estado.js';
import {
  $, toast,
  syncAnalysisOps,
  sysFlash,
} from './telas/infra.js';
export { toast } from './telas/infra.js';
import {
  rebuildAccounts,
  renderAccountBar, renderIdentity, renderSilenced,
  initContasTriggers, escopoGuardado,
} from './telas/contas.js';
import { gotoDeliv } from './telas/entregas.js';
import { loadHighlights, loadTeam } from './telas/time.js';
import { renderTools } from './telas/ferramentas.js';
import { ping, notifyNewPRs, avisoDaBase } from './telas/avisos.js';
import { interventionReceived, interventionsFromState } from './telas/interventions.js';
import { initTweaks } from './telas/acoes.js';
import { registrarTelaConsumo } from './telas/consumo.js';
import { renderStatus, tickCountdown, renderActive, handleActivity } from './telas/sessoes.js';
import { renderChat, chatKeyAtual, initChatTriggers, handleChatActivity } from './telas/chat.js';
import {
  renderDecisions, renderQueue, renderPanorama, renderRadarNav, initResolvedTriggers, aoMudarRadarSub, switchRadarSub,
} from './telas/radar.js';
import { renderMyPRs, initReviewersButton, updateAnalysisProgress, contagemMeusPrs } from './telas/meus-prs.js';
import { renderUpdate } from './telas/sistema-atualizacao.js';
import { sysGoTo, renderSettings } from './telas/sistema.js';
import { initCaixaRevisao } from './telas/caixa-revisao.js';
import { initAtalhos } from './telas/atalhos.js';
import { initPaleta, rotularBtnCmdK } from './telas/paleta.js';
import { initTema, syncTheme } from './telas/tema.js';
import { initPerfilPessoa } from './telas/perfil-pessoa.js';
import { registrarTelaRadarCompartilhado, aoAndamentoRemoto, aoPendenciasRemotas } from './telas/radar-compartilhado.js';
import { initListasRemotas, aoListasRemotas } from './telas/listas-remotas.js';
import { registrarTelaRadarAparelhos } from './telas/radar-aparelhos.js';
import { initRota, depoisDoEstado, sincronizarUrl } from './telas/rota.js';
import { criarAgendaVisual } from './telas/pintura.js';
import { gruposDaPintura } from './telas/pintura-estado.js';
import { limitarAtividadeVisual } from './telas/atividade-visual.js';
import { criarPreservacaoDeFormulario } from './telas/formularios.js';

const isElectron = ehElectron();
if (isElectron) document.body.classList.add('electron');

/* Plataforma: a FONTE DE VERDADE é o engine (snapshot.app.platform = process.platform).
   O userAgent aqui é só o palpite do PRIMEIRO PAINT, antes do primeiro estado chegar pelo
   SSE: sem ele o padding do semáforo do macOS piscaria. aplicaPlataforma reconcilia assim
   que o estado chega, e é ela que manda daí em diante.
   Antes eram duas fontes de verdade no mesmo arquivo (userAgent no cromo, app.platform no
   doctor), que divergem de verdade ao abrir a UI de um Mac contra um engine Windows.
   ehMac/ehWin são FUNÇÕES de propósito: uma referência esquecida a `isMac` vira
   ReferenceError alto, em vez de um `if (isMac)` sempre verdadeiro falhando calado.
   O estado (PLATAFORMA) e as duas funções moram em telas/estado.js desde a Task 10a (Fase
   1b): telas/sistema-perfis.js também precisa perguntar "é Windows?" pro editor de perfis
   Claude, e um módulo de tela não pode importar o bootstrap de volta. */
function aplicaPlataforma(p) {
  definirPlataforma(p);
  document.body.classList.toggle('mac', ehMac());
  rotularBtnCmdK();   // o botão é da paleta; quem sabe rotulá-lo é telas/paleta.js
}
aplicaPlataforma();

/* ---------- camada de contas (separação por identidade) ---------- */
definirEscopo(escopoGuardado());   // 'all' ou o login de uma conta; chave e default em telas/contas.js
// espelha a aba no <body> pro CSS ajustar a largura útil (a aba Sistema tem sidebar e
// precisa de mais). switchTab não roda no boot, então a aba inicial é marcada aqui.
document.body.dataset.tab = abaAtual();
function syncOptionalTabsVisibility() {
  const features = [
    { tab: 'destaques', enabled: teamHighlightsEnabled() },
    { tab: 'entregas', enabled: deliveriesEnabled() },
  ];
  for (const feature of features) {
    $(`#tabbtn-${feature.tab}`).hidden = !feature.enabled;
    $(`#tab-${feature.tab}`).hidden = !feature.enabled;
    if (!feature.enabled && abaAtual() === feature.tab) switchTab('radar');
  }
}

// fan-out de render das seções sensíveis a CONTA (escopo/identidade/fila/decisões):
// o handler de 'state' do SSE e o rerenderScope (troca de escopo, sem esperar
// estado novo) desenhavam essas nove chamadas, na MESMA ordem, em dois lugares.
// Uma função só, usada pelos dois; o que cada um faz ANTES e DEPOIS continua
// distinto (o handler de 'state' também troca o snapshot inteiro e cobre as
// telas sem conta própria; rerenderScope só isso, mais destaques/time se
// estiverem na aba ativa).
function renderScopedSections() {
  pinturas.invalidar();
  pinturas.pintar();
}

// re-render das seções sensíveis ao escopo (sem esperar novo state do engine). Morava em
// telas/contas.js recebendo nove funções por parâmetro (a costura da Task 6, criada
// enquanto elas ainda viviam no app.js). Com o Radar e Meus PRs virando módulo na Task
// 8, quase todas essas nove viraram import de mão única, e deixar rerenderScope na
// camada de identidade faria contas.js importar as telas que a importam de volta: o
// ciclo que a Fase 1b existe para evitar. Por isso ela veio pra cá: o bootstrap pode
// conhecer todas as telas, a camada de identidade não pode.
function rerenderScope() {
  if (!estado()) return;
  renderScopedSections();
  if ($('#tab-destaques').classList.contains('active')) { loadHighlights(); renderTools(); }
  if ($('#tab-time').classList.contains('active')) loadTeam();
}
initTweaks(rerenderScope);

/* Gatilhos da barra de contas e do resumo de silenciadas: moram em
   telas/contas.js, dono de renderAccountBar/renderSilenced.
   initContasTriggers(rerenderScope) recebe o re-render de escopo, que
   conhece todas as telas e por isso fica aqui. Chamada no mesmo ponto
   relativo em que os dois listeners moravam. */
initContasTriggers(rerenderScope);

/* Editar o perfil de review de uma pessoa (papel e domínios): mora em
   telas/perfil-pessoa.js, que é a tela dona do ASSUNTO (o picker aparece na
   aba Time e nos cards do Radar, então não pertence a nenhum dos dois).
   Chamada aqui, no mesmo ponto relativo em que o listener morava, pra não
   mudar a ordem dos handlers de change do document. */
initPerfilPessoa();
/* Gatilhos de #resolved (pushback e revisar de novo/copiar URL): moram em
   telas/radar.js, dono de renderResolved/submitPushback. Chamada aqui, no
   mesmo ponto relativo em que os dois listeners moravam. */
initResolvedTriggers();

/* Tema claro/escuro: mora em telas/tema.js. Chamada aqui, no mesmo ponto
   relativo em que o bloco morava. */
initTema();

/* ---------- navegação ---------- */
/* Altura REAL da topbar num custom property. Os dois elementos sticky do app (a
   navegação do Radar e a sidebar do Sistema) tinham o deslocamento cravado em 54px e
   66px, mas a topbar muda de altura: encolhe abaixo de 620px e cresce quando a barra de
   contas aparece e quebra em duas linhas. O resultado era uma faixa vazada por baixo, ou
   a navegação passando por trás da topbar. Aqui a medida é observada. */
function medirTopbar() {
  const tb = document.querySelector('.topbar');
  if (!tb) return;
  document.documentElement.style.setProperty('--topbar-h', Math.round(tb.getBoundingClientRect().height) + 'px');
}
medirTopbar();
if (window.ResizeObserver) new ResizeObserver(medirTopbar).observe(document.querySelector('.topbar'));

/* Redesenho no resize: quem precisa reagir (hoje só o Consumo, cujo gráfico mede o
   container pra montar o viewBox) se registra com aoRedimensionar (telas/registro.js),
   o mesmo gancho de aoEntrar/aoEstado. O bootstrap só percorre o registro, debounced
   pra não redesenhar a cada pixel. */
let resizeTimer = null;
window.addEventListener('resize', () => {
  medirTopbar();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    for (const tela of telasRegistradas()) if (tela.aoRedimensionar) tela.aoRedimensionar();
  }, 150);
});

function switchTab(name) {
  if (name === 'destaques' && !teamHighlightsEnabled()) name = 'radar';
  if (name === 'entregas' && !deliveriesEnabled()) name = 'radar';
  definirAba(name);
  document.body.dataset.tab = name;   // largura útil por aba (ver body[data-tab] no app.css)
  // aria-selected junto com a classe: a classe pinta, o aria é o que o leitor de tela lê
  document.querySelectorAll('.nav-item').forEach(t => {
    const ativo = t.dataset.tab === name;
    t.classList.toggle('active', ativo);
    t.setAttribute('aria-selected', ativo ? 'true' : 'false');
  });
  document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (estado()) renderAccountBar();   // mostra/esconde a barra de contas conforme a aba
  const tela = telaPorId(name);
  if (estado()) { pinturas.invalidar(); pinturas.pintar(); }
  if (tela && tela.aoEntrar) tela.aoEntrar();
}
$('#nav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
  if (btn) switchTab(btn.dataset.tab);
});

/* ---------- caixa de revisão por chave (atalho da tabela de Consumo) ----------
   Mora em telas/caixa-revisao.js: não precisa de navegação, só de estado() e das
   rotas de decisão. Chamada aqui, no mesmo ponto relativo em que o listener
   morava, pra não mudar a ordem dos handlers de click do document. */
initCaixaRevisao();

/* ---------- navegação interna centralizada: data-goto ----------
   Contrapartida interna dos helpers de menção do ui/pure.js (personMention,
   repoMention, prRefMention levam pro GitHub; aqui é pra levar a um lugar do
   PRÓPRIO app). Um handler só, delegado no document, pra nenhuma tela precisar
   registrar listener próprio nem repetir a sequência "switchTab depois
   sysGoTo com setTimeout" (a ordem importa: sysGoTo rola/pisca e elemento em
   aba escondida não rola).

   Formatos aceitos (data-goto):
     aba:<nome>                        → só troca de aba (radar, entregas, …)
     aba:<nome>:<seletor CSS>          → idem + rola e pisca o alvo
     sys:<secao>                       → aba Sistema + seção
     sys:<secao>:<seletor CSS>         → idem + rola e pisca o alvo
     deliv:repo:<owner/repo>           → Entregas, visão por repo, no grupo
     deliv:author:<login>              → Entregas, visão por pessoa, no grupo
     deliv:days:<0|7|15|30>            → Entregas, troca o período

   Quem emite passa o valor CRU; a leitura é sempre por dataset (nada de parse
   de HTML). Elemento com data-goto ganha o affordance de clique no CSS
   (.is-goto) e vira botão pra teclado/leitor de tela via role/tabindex. */
// troca de aba e, se veio seletor, rola e pisca o alvo. Mesma ordem do sysGoTo
// (aba visível ANTES do scroll: scrollIntoView em elemento escondido não faz nada
// e não avisa). Painel de ferramenta nasce hidden: sem resultado gerado ainda, a
// navegação para na aba certa em vez de piscar o que ninguém vê.
function gotoAba(nome, at) {
  switchTab(nome);
  if (!at) return;
  setTimeout(() => {
    const el = document.querySelector(at);
    if (!el || el.hidden) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    sysFlash(el);
  }, 0);
}

function goTo(spec) {
  const { tipo, alvo, seletor } = parseGoto(spec);
  if (tipo === 'aba') return gotoAba(alvo, seletor || null);
  if (tipo === 'sys') {
    switchTab('sistema');
    return sysGoTo(alvo, seletor || null);
  }
  if (tipo === 'deliv') return gotoDeliv(alvo, seletor, switchTab);
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-goto]');
  if (!el) return;
  e.preventDefault();
  goTo(el.dataset.goto);
});
// mesma navegação pelo teclado: quem tem data-goto é anunciado como botão
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest && e.target.closest('[data-goto]');
  if (!el || el.tagName === 'A' || el.tagName === 'BUTTON') return;
  e.preventDefault();
  goTo(el.dataset.goto);
});

// Deep-link de alerta: rola até o card do PR e dá um pulso de destaque.
// Ordem de busca = onde a ação mora (decisão > fila > meus PRs > panorama > recentes).
function openIntervention(target) {
  if (target?.type === 'pr') {
    if (target.account && estado()?.accounts?.some(a => a.user.toLowerCase() === target.account.toLowerCase())) {
      definirEscopo(target.account); renderAccountBar(); rerenderScope();
    }
    return focusPr(target.url);
  }
  if (target?.type !== 'system') return;
  switchTab('sistema'); sysGoTo(target.section);
}

function subabaDoPr(url) {
  const s = estado() || {};
  if ((s.decisions?.pending || []).some(d => d.pr?.url === url)) return 'mim';
  if ((s.queue || []).some(pr => pr.url === url)) return 'mim';
  const esperando = new Set([...(s.headlessWaiting || []), ...(s.headlessDistributing || [])]);
  if ((s.panorama || []).some(pr => pr.url === url && esperando.has(pr.key))) return 'mim';
  if ((s.myPRs || []).some(pr => pr.url === url)) return 'meus';
  if ((s.panorama || []).some(pr => pr.url === url)) return 'pano';
  return 'mim';
}
function focusPr(url, tentativa = 0) {
  if (!url) return;
  // O painel pode ainda não ter DOM: escolhe pelos dados antes de procurar o card.
  switchRadarSub(subabaDoPr(url));
  switchTab('radar');
  const sel = ['#decisions .decision', '#esperaCi .decision', '#queue .pr-card', '#myPRs .mypr-card', '#panorama [data-url]', '#resolved [data-url]']
    .map(s => `${s}[data-url="${CSS.escape(url)}"]`).join(', ');
  const card = document.querySelector(sel);
  if (!card) {
    // o state pode ainda estar chegando pelo SSE; tenta de novo uma vez
    if (tentativa < 2) setTimeout(() => focusPr(url, tentativa + 1), 700);
    return;
  }
  // card numa sub-aba do Radar que não está à mostra (Meus PRs): troca antes de rolar,
  // senão o scroll num painel escondido não faz nada e o clique morre calado
  const painel = card.closest('.rpane');
  if (painel && !painel.classList.contains('active')) {
    const sub = document.querySelector(`.rsub[data-sub="${CSS.escape(painel.id.replace(/^rpane-/, ''))}"]`);
    if (sub) sub.click();
  }
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  sincronizarUrl();   // chegou por notificação, não por clique: o endereço acompanha aqui
  card.classList.add('pulse-focus');
  setTimeout(() => card.classList.remove('pulse-focus'), 2600);
}

/* Paleta de comando (Ctrl+K / Cmd+K): mora em telas/paleta.js. Chamada aqui, no
   mesmo ponto relativo em que a ligação do #btnCmdK e o listener de Ctrl+K
   moravam, pra não mudar a ordem dos handlers de keydown do document (o Ctrl+K
   registra ANTES do listener de atalhos, logo abaixo). */
initPaleta(switchTab);

/* Atalhos de teclado do Radar: mora em telas/atalhos.js. Chamada aqui, no mesmo
   ponto relativo em que o listener morava, pra não mudar a ordem dos handlers de
   keydown do document (o Ctrl+K da paleta registra ANTES deste). */
initAtalhos(switchTab);

/* Chat com o Claude: os gatilhos que abrem a conversa (.act-chat e a busca por
   URL) moram em telas/chat.js. Chamada aqui, no mesmo ponto relativo em que os
   dois listeners moravam, pra não mudar a ordem dos handlers de click do
   document. */
initChatTriggers();

/* Meus PRs: botão Reviewers. Mora em telas/meus-prs.js (a tela dona do botão);
   initReviewersButton(switchTab) recebe a navegação de que precisa pra levar à
   aba Sistema. Chamada aqui, no mesmo ponto relativo em que o listener morava,
   no MESMO elemento #myPRs (o listener de meus-prs.js cuida do resto dos
   cliques do card). */
initReviewersButton(switchTab);

/* ---------- SSE ---------- */
let TENTATIVAS_RECONEXAO = 0;

// Um stream por vez: depois de parear de novo no meio do uso, o da credencial antiga não
// pode continuar entregando os mesmos eventos em dobro.
let streamAtual = null;

// A repintura por estado novo, num lugar só: o `state` inteiro e o `state-patch`
// terminam no MESMO caminho, senão a tela que recebe diferença renderizaria menos
// coisa do que a que recebe o snapshot, e o defeito só apareceria em uma das duas.
function pintarTelaRegistrada(id) {
  const tela = telaPorId(id);
  if (tela?.aoEstado) tela.aoEstado();
}
const preservarConfiguracao = criarPreservacaoDeFormulario();
const pinturas = criarAgendaVisual({
  grupos: gruposDaPintura({
    plataforma: () => aplicaPlataforma(estado().app?.platform),
    contas: () => { rebuildAccounts(); renderAccountBar(); renderIdentity(); },
    status: renderStatus, sessoes: renderActive, decisoes: renderDecisions, fila: renderQueue,
    meus: () => { renderMyPRs(); syncAnalysisOps(); }, panorama: renderPanorama,
    silenciadas: renderSilenced, navegacao: () => renderRadarNav(contagemMeusPrs()), operacoes: syncAnalysisOps,
    configuracoes: () => preservarConfiguracao($('#tab-sistema'), () => { renderSettings(); pintarTelaRegistrada('sistema'); }),
    ferramentas: renderTools, atualizacao: renderUpdate, relogio: tickCountdown,
    consumo: () => pintarTelaRegistrada('consumo'),
    compartilhado: () => pintarTelaRegistrada('radar-compartilhado'),
    aparelhos: () => pintarTelaRegistrada('radar-aparelhos'),
  }),
  oculta: () => document.hidden,
  agendar: fn => requestAnimationFrame(fn),
});
aoMudarRadarSub(() => { if (estado()) { pinturas.invalidar(); pinturas.pintar(); } });
function repintarPorEstado(campos, imediato = false) {
  if (!campos || campos.includes('config')) { syncTheme(estado().config); syncOptionalTabsVisibility(); }
  pinturas.invalidar(campos);
  // A rota é aplicada com estado atual, sem esperar animação ou uma janela reaparecer.
  depoisDoEstado();
  if (imediato) pinturas.pintar();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { pinturas.pintar(); tickCountdown(); } });
document.addEventListener('focusout', () => queueMicrotask(() => pinturas.pintar()));
document.addEventListener('selectionchange', () => queueMicrotask(() => pinturas.pintar()));
document.addEventListener('click', () => queueMicrotask(() => pinturas.pintar()));

// Prova de vida do stream. O engine manda um evento `ping` a cada 25 s; enquanto ele
// chega, a conexão está de pé mesmo sem nada acontecendo. Sem ele o socket pode estar
// morto com a aba achando que está conectada (proxy/antivírus que bufferiza), e antes
// disto a tela simplesmente congelava mostrando dado velho, sem avisar ninguém.
let ULTIMO_SINAL = 0;
let VIGIA_CONEXAO = null;

function marcarSinalDoEngine() { ULTIMO_SINAL = Date.now(); }

function vigiarConexao(es) {
  if (VIGIA_CONEXAO) clearInterval(VIGIA_CONEXAO);
  marcarSinalDoEngine();
  VIGIA_CONEXAO = setInterval(() => {
    if (Date.now() - ULTIMO_SINAL < OCIOSO_MS) return;
    // derruba de propósito: fechar e reabrir é o que faz o onerror acender o aviso e o
    // stream voltar; esperar o socket morto perceber sozinho pode nunca acontecer
    clearInterval(VIGIA_CONEXAO); VIGIA_CONEXAO = null;
    try { es.close(); } catch { /* já caiu */ }
    if (es.onerror) es.onerror();
    connect();
  }, Math.round(OCIOSO_MS / 6));
}

function connect() {
  if (streamAtual) streamAtual.close();
  // EventSource não aceita cabeçalho: com token, o stream é lido por fetch (A4)
  const es = tokenLocal() ? new FonteDeEventosAutenticada('/api/events') : new EventSource('/api/events');
  streamAtual = es;
  vigiarConexao(es);
  es.addEventListener('ping', marcarSinalDoEngine);
  es.addEventListener('state', (e) => {
    marcarSinalDoEngine();
    const d = safeJsonParse(e.data); if (!d) return;
    const primeiro = !estado();
    definirEstado({ ...d, activity: limitarAtividadeVisual(d.activity, d.activeSessions) });
    interventionsFromState(d, openIntervention);
    repintarPorEstado(null, primeiro);
  });
  // Estado por DIFERENÇA (lib/estado-delta.js): o engine manda só os campos de topo
  // que mudaram, e a tela mescla no que já tem. O `state` inteiro continua existindo
  // e é o que abre o stream; patch sem estado anterior seria mesclar no vazio, então
  // ele é ignorado e o próximo `state` recompõe tudo.
  es.addEventListener('state-patch', (e) => {
    marcarSinalDoEngine();
    const d = safeJsonParse(e.data); if (!d || !d.campos) return;
    const atual = estado();
    if (!atual || !Object.keys(atual).length) return;
    const novo = { ...atual, ...d.campos };
    for (const chave of d.removidos || []) delete novo[chave];
    if (Object.hasOwn(d.campos, 'activity')) novo.activity = limitarAtividadeVisual(novo.activity, novo.activeSessions);
    definirEstado(novo); interventionsFromState(novo, openIntervention);
    repintarPorEstado([...Object.keys(d.campos), ...(d.removidos || [])]);
  });
  // o app.js só entrega o evento: quem calcula o que ele significa é quem é
  // dono do assunto (telas/sessoes.js, o feed e a barra de progresso da sessão;
  // telas/meus-prs.js, o progresso do op de autoanálise que ela própria cria).
  es.addEventListener('activity', (e) => {
    const d = safeJsonParse(e.data); if (!d) return; const { id, item } = d;
    handleActivity(id, item);
    pinturas.invalidar(['activity']);
    updateAnalysisProgress(id, item);
  });
  es.addEventListener('chat', (e) => {
    const c = safeJsonParse(e.data); if (!c) return;
    const chatKey = chatKeyAtual();
    if (chatKey && c.key === chatKey) renderChat(c);
  });
  // idem: telas/chat.js já é dono de chatKeyAtual(), então é quem decide o que
  // um evento de atividade do chat significa.
  es.addEventListener('chat-activity', (e) => {
    const d = safeJsonParse(e.data); if (!d) return; const { key, text } = d;
    handleChatActivity(key, text);
  });
  // visão compartilhada (andamento e pendências de outros aparelhos): delta próprio, nunca o
  // estado inteiro. O bootstrap só entrega; quem entende é telas/radar-compartilhado.js.
  es.addEventListener('sync-live', (e) => {
    const d = safeJsonParse(e.data); if (!d) return;
    aoAndamentoRemoto(d);
  });
  es.addEventListener('sync-pending', (e) => {
    const d = safeJsonParse(e.data); if (!d) return;
    aoPendenciasRemotas(d);
  });
  // Panorama e Meus PRs de outros aparelhos: idem, quem entende é telas/listas-remotas.js
  es.addEventListener('sync-lists', (e) => {
    const d = safeJsonParse(e.data); if (!d) return;
    aoListasRemotas(d);
  });
  // credencial revogada ou vencida com a página aberta (A4)
  es.addEventListener('nao-autenticado', () => {
    es.close();
    trocarPeloPareamento('A credencial deste navegador expirou ou foi revogada. Pareie de novo para voltar.');
  });
  // recusa de quem está na frente do Farol (o portão do login Google, no servidor): parear
  // não resolve; recarregar leva ao login dele. Uma vez por minuto, para não entrar em laço.
  es.addEventListener('login-externo', () => irParaLoginExterno(es));
  es.addEventListener('toast', (e) => {
    const t = safeJsonParse(e.data); if (!t) return;
    toast(t.kind || 'info', t.text);
  });
  es.addEventListener('new-prs', (e) => { const d = safeJsonParse(e.data); if (d) notifyNewPRs(d); });
  // PR meu em conflito ou superado pela base: o toast é de telas/avisos.js, a navegação é daqui
  es.addEventListener('meu-pr-base', (e) => { const d = safeJsonParse(e.data); if (d) avisoDaBase(d, (url) => focusPr(url)); });
  es.addEventListener('auto-approved', () => ping());
  es.addEventListener('auto-rejected', () => ping());
  es.addEventListener('auto-commented', () => ping());
  es.addEventListener('intervention', e => interventionReceived(safeJsonParse(e.data), openIntervention));
  es.addEventListener('focus-intervention', e => openIntervention(safeJsonParse(e.data)));
  es.addEventListener('focus-pr', (e) => {
    const d = safeJsonParse(e.data); if (!d) return; const { url } = d;
    focusPr(url);
  });
  // A pill do topo sozinha não bastava: em janela estreita ela fica fora de vista atrás
  // das abas, e o app parece só ter parado de atualizar. A faixa entra NO FLUXO, onde
  // você está olhando, e conta as tentativas.
  es.onerror = () => {
    // sem token, o EventSource nativo não mostra o motivo da queda: uma sondagem diz se foi
    // o login de fora do Farol que venceu (o caso medido na Hostinger, 20/10/2026)
    if (!(es instanceof FonteDeEventosAutenticada)) sondarLoginExterno(es);
    $('#statusPill').className = 'pill err';
    $('#statusPill').textContent = 'reconectando…';
    TENTATIVAS_RECONEXAO++;
    // a tela inteira passa a dizer que está velha: sem isto ela continua exibindo o
    // panorama e a contagem regressiva como se estivessem vivos
    document.body.classList.add('sem-engine');
    const f = $('#connLost');
    if (f) {
      f.hidden = false;
      const t = f.querySelector('.cl-try');
      if (t) t.textContent = TENTATIVAS_RECONEXAO > 1 ? `tent. ${TENTATIVAS_RECONEXAO}` : '';
    }
  };
  es.addEventListener('open', () => {
    TENTATIVAS_RECONEXAO = 0; marcarSinalDoEngine();
    const f = $('#connLost'); if (f) f.hidden = true;
    document.body.classList.remove('sem-engine');
  });
}

// 'entregas', 'destaques', 'time' e 'sistema' já se registraram sozinhas ao serem
// importadas (import estático roda antes deste ponto, na ordem em que aparecem lá em
// cima; telas/sistema.js é importado depois de telas/time.js, por isso 'sistema'
// registra depois de 'destaques'/'time'). Só 'consumo' precisa ser CHAMADA aqui: ela
// não se registra ao ser importada porque telas/consumo.js é importado bem mais
// acima, antes de telas/sistema.js, e se registrasse no import passaria à frente de
// 'sistema' (telasRegistradas() devolve na ordem de registro, e precisa continuar
// entregas, destaques, time, sistema, consumo).
registrarTelaConsumo();
// a visão compartilhada do Radar registra por último, pelo mesmo motivo: registrar no import
// a poria antes de 'sistema' e mudaria a ordem garantida acima
registrarTelaRadarCompartilhado();
// Radar > Aparelhos lê o que a visão compartilhada acumula, e por isso registra depois dela
registrarTelaRadarAparelhos();
// Panorama e Meus PRs de outros aparelhos: quando chega projeção nova, as duas abas (e as
// contagens das sub-abas) se redesenham pelas funções que o bootstrap já chama por snapshot
initListasRemotas(() => { pinturas.invalidar(['myPRs', 'panorama', 'sync']); });

/* O endereço da página reflete a tela (telas/rota.js): por último, para o ouvinte de clique
   e tecla dele rodar depois de todos os handlers acima, e com todas as telas registradas
   (o switchTab que ele recebe chama o aoEntrar de cada uma). */
initRota({ switchTab, rerenderScope });

/* A4: antes de qualquer coisa, a página pergunta se este navegador pode entrar. Com a
   exigência ligada e sem credencial, a interface inteira vira o pareamento: nada do estado,
   do log, do chat ou dos eventos é pedido antes. Sem exigência, nada muda. */
// A recarga pelo login de fora fica marcada nesta aba: se o portão devolver 401 de novo em
// menos de um minuto, a página avisa em vez de recarregar outra vez (sem laço).
const RECARGA_PELO_LOGIN = 'farol-recarga-pelo-login';
function podeRecarregarPeloLogin(agora = Date.now()) {
  try {
    const ultima = Number(sessionStorage.getItem(RECARGA_PELO_LOGIN)) || 0;
    if (agora - ultima < 60 * 1000) return false;
    sessionStorage.setItem(RECARGA_PELO_LOGIN, String(agora));
    return true;
  } catch {
    return false;
  }
}

// recusa de quem está na frente do Farol: parear não resolve; recarregar leva ao login dele
function irParaLoginExterno(es) {
  es.close();
  if (podeRecarregarPeloLogin()) location.reload();
  else toast('error', 'O acesso a este Farol pede login de novo. Recarregue a página para entrar.');
}

// no máximo uma sondagem a cada 30 s: a reconexão do EventSource tenta de novo sozinha
let ultimaSondagem = 0;
function sondarLoginExterno(es, agora = Date.now()) {
  if (agora - ultimaSondagem < 30 * 1000) return;
  ultimaSondagem = agora;
  recusaDeLoginExterno().then((r) => { if (r === 'login-externo' && streamAtual === es) irParaLoginExterno(es); });
}

function trocarPeloPareamento(aviso) {
  const raiz = document.getElementById('pareamento');
  if (!raiz || document.body.classList.contains('parear')) return;
  document.body.classList.add('parear');
  raiz.hidden = false;
  montarPareamento(raiz, aviso, { recarregar: () => voltarDoPareamento(raiz, connect) });
}

precisaParear().then((precisa) => {
  if (precisa) return trocarPeloPareamento('');
  connect();
});
