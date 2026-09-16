/* Farol · UI: consome o engine local via SSE + fetch. Sem frameworks. */

import {
  safeJsonParse,
  feedLine, selfSessionKey,
  sessionProgress, parseGoto,
  reasonText,
} from './pure.js';
import { telasRegistradas, telaPorId } from './telas/registro.js';
import {
  estado, abaAtual, definirEstado, definirEscopo, definirAba,
  teamHighlightsEnabled, deliveriesEnabled,
  ehMac, ehElectron, definirPlataforma,
} from './telas/estado.js';
import {
  $, api, toast, showOp, updateOp, ACTIVE_OPS,
  syncAnalysisOps,
  sysFlash,
} from './telas/infra.js';
export { toast } from './telas/infra.js';
import {
  rebuildAccounts,
  renderAccountBar, renderIdentity, renderSilenced,
  initContasTriggers,
} from './telas/contas.js';
import { gotoDeliv } from './telas/entregas.js';
import { loadHighlights, loadTeam } from './telas/time.js';
import { renderTools } from './telas/ferramentas.js';
import { ping, notifyNewPRs } from './telas/avisos.js';
import { initTweaks } from './telas/acoes.js';
import { registrarTelaConsumo, renderUsage } from './telas/consumo.js';
import { renderStatus, tickCountdown, updateStageFlow, updateSessionBar, renderActive } from './telas/sessoes.js';
import { renderChat, chatKeyAtual, initChatTriggers } from './telas/chat.js';
import {
  renderDecisions, renderQueue, renderPanorama, renderRadarNav, initResolvedTriggers,
} from './telas/radar.js';
import { renderMyPRs, initReviewersButton } from './telas/meus-prs.js';
import { renderUpdate } from './telas/sistema-atualizacao.js';
import { sysGoTo, renderSettings } from './telas/sistema.js';
import { initCaixaRevisao } from './telas/caixa-revisao.js';
import { initAtalhos } from './telas/atalhos.js';
import { initPaleta } from './telas/paleta.js';
import { initTema } from './telas/tema.js';

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
  // o botão da paleta é estático no HTML e misturava as duas convenções (⌘K com
  // tooltip Ctrl+K); aqui ele fica coerente com o SO real do engine
  const cmdBtn = document.getElementById('btnCmdK');
  if (cmdBtn) {
    cmdBtn.textContent = ehMac() ? '⌘K' : 'Ctrl+K';
    cmdBtn.title = `Paleta de comandos (${ehMac() ? 'Cmd' : 'Ctrl'}+K)`;
  }
}
aplicaPlataforma();

let logTimer = null;

/* ---------- camada de contas (separação por identidade) ---------- */
definirEscopo(localStorage.getItem('farol-scope') || 'all');   // 'all' ou o login de uma conta
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

// re-render das seções sensíveis ao escopo (sem esperar novo state do engine). Morava em
// telas/contas.js recebendo nove funções por parâmetro (a costura da Task 6, criada
// enquanto elas ainda viviam no app.js). Com o Radar e Meus PRs virando módulo na Task
// 8, quase todas essas nove viraram import de mão única, e deixar rerenderScope na
// camada de identidade faria contas.js importar as telas que a importam de volta: o
// ciclo que a Fase 1b existe para evitar. Por isso ela veio pra cá: o bootstrap pode
// conhecer todas as telas, a camada de identidade não pode.
function rerenderScope() {
  if (!estado()) return;
  renderAccountBar(); renderIdentity();
  renderActive(); renderDecisions(); renderQueue(); renderMyPRs(); renderPanorama(); renderSilenced();
  renderRadarNav();
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

/* marcar o perfil de review de uma pessoa (papel e domínios): molda o tom e a
   postura da revisão automática. Global (delegado no documento) pra funcionar na
   aba Time E nos cards do PR (fila, Precisa de você), inclusive pra marcar o 1º
   PR de quem ainda não está no time. */
document.addEventListener('change', (e) => {
  const t = e.target;
  if (!t.classList) return;
  const isPapel = t.classList.contains('papel-level');
  const isDom = t.classList.contains('dom-level');
  if (!isPapel && !isDom) return;
  const login = String(t.dataset.login || '').toLowerCase();
  if (!login) return;
  const people = { ...((estado().config && estado().config.people) || {}) };
  const person = { ...(people[login] || {}) };
  if (isPapel) {
    if (t.value) person.papel = t.value; else delete person.papel;
  } else {
    const dom = { ...(person.dominios || {}) };
    if (t.value) dom[t.dataset.domain] = t.value; else delete dom[t.dataset.domain];
    if (Object.keys(dom).length) person.dominios = dom; else delete person.dominios;
  }
  if (person.papel || person.dominios) people[login] = person; else delete people[login];
  if (estado().config) estado().config.people = people;   // otimista, pra o select não piscar
  api('/api/settings', { people });
});
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

/* Redesenho no resize: o gráfico do Consumo mede o container pra montar o viewBox, então
   precisa ser refeito quando a largura muda. Debounce pra não redesenhar a cada pixel. */
let resizeTimer = null;
window.addEventListener('resize', () => {
  medirTopbar();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if ($('#tab-consumo').classList.contains('active')) renderUsage();
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
function focusPr(url, tentativa = 0) {
  if (!url) return;
  switchTab('radar');
  const sel = ['#decisions .decision', '#queue .pr-card', '#myPRs .mypr-card', '#panorama [data-url]', '#resolved [data-url]']
    .map(s => `${s}[data-url="${CSS.escape(url)}"]`).join(', ');
  const card = document.querySelector(sel);
  if (!card) {
    // o state pode ainda estar chegando pelo SSE; tenta de novo uma vez
    if (tentativa < 2) setTimeout(() => focusPr(url, tentativa + 1), 700);
    return;
  }
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('state', (e) => {
    const d = safeJsonParse(e.data); if (!d) return; definirEstado(d);
    aplicaPlataforma(estado().app && estado().app.platform);   // engine manda; o userAgent era só o palpite inicial
    syncOptionalTabsVisibility();
    rebuildAccounts();
    renderStatus(); renderAccountBar(); renderIdentity();
    renderActive(); renderDecisions(); renderQueue(); renderMyPRs(); renderPanorama(); renderSilenced();
    renderRadarNav();
    syncAnalysisOps();
    renderSettings(); renderTools(); renderUpdate(); tickCountdown();
    for (const tela of telasRegistradas()) if (tela.aoEstado) tela.aoEstado();
  });
  es.addEventListener('activity', (e) => {
    const d = safeJsonParse(e.data); if (!d) return; const { id, item } = d;
    if (estado()?.activity) (estado().activity[id] = estado().activity[id] || []).push(item);
    const feed = document.querySelector(`.activity-feed[data-id="${CSS.escape(id)}"]`);
    if (feed) {
      const stick = feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 30;
      feed.insertAdjacentHTML('beforeend', feedLine(item));
      if (stick) feed.scrollTop = feed.scrollHeight;
    }
    // progresso honesto (régua única sessionProgress, ui/pure.js): a atividade
    // real move a barra do card da sessão no "Analisando agora"...
    updateSessionBar(id);
    updateStageFlow(id);
    // ...e, se for autoanálise, também o widget do card em Meus PRs
    const selfKey = selfSessionKey(estado()?.activeSessions, id);
    if (selfKey) {
      const op = ACTIVE_OPS.get(`analysis-${selfKey}`);
      if (op && op.status === 'running') {
        const n = (estado()?.activity?.[id] || []).length;
        updateOp(op.id, {
          step: (item && item.text) || op.step,
          progress: Math.max(op.progress || 0, sessionProgress(n))
        });
      }
    }
  });
  es.addEventListener('chat', (e) => {
    const c = safeJsonParse(e.data); if (!c) return;
    const chatKey = chatKeyAtual();
    if (chatKey && c.key === chatKey) renderChat(c);
  });
  es.addEventListener('chat-activity', (e) => {
    const d = safeJsonParse(e.data); if (!d) return; const { key, text } = d;
    const chatKey = chatKeyAtual();
    if (chatKey && key === chatKey) {
      const el = $('#chatActivity');
      el.hidden = false;
      const opId = `chat-${key}`;
      // o texto vivo vira o step da MESMA pill que o renderChat cria; escrever
      // textContent no container destruia a pill e orfanava a op (B16). Se a
      // atividade chegar antes do primeiro snapshot de chat, cria a op aqui.
      if (!ACTIVE_OPS.has(opId)) showOp(opId, { type: 'chat', title: 'Claude respondendo', inline: true, container: el });
      // o chat nao acumula feed em estado().activity; a contagem de eventos vive
      // na propria op, e o percentual sai da MESMA regua dos outros fluxos
      const op = ACTIVE_OPS.get(opId);
      const n = (op.chatEvents = (op.chatEvents || 0) + 1);
      updateOp(opId, { step: text, progress: Math.max(op.progress || 0, sessionProgress(n)) });
    }
  });
  es.addEventListener('toast', (e) => {
    const t = safeJsonParse(e.data); if (!t) return;
    toast(t.kind || 'info', t.text);
  });
  es.addEventListener('new-prs', (e) => { const d = safeJsonParse(e.data); if (d) notifyNewPRs(d); });
  es.addEventListener('auto-approved', () => ping());
  es.addEventListener('auto-rejected', () => ping());
  es.addEventListener('needs-decision', (e) => {
    ping();
    const d = safeJsonParse(e.data); if (!d) return; const { pr, item } = d;
    if (!isElectron && 'Notification' in window && Notification.permission === 'granted') {
      const n = new Notification('Farol · precisa da sua atenção', { body: `${pr.key}: ${reasonText((item.reasons || [])[0]) || 'ver relatório'}` });
      n.onclick = () => { window.focus(); focusPr(pr.url); };
    }
  });
  es.addEventListener('focus-pr', (e) => {
    const d = safeJsonParse(e.data); if (!d) return; const { url } = d;
    focusPr(url);
  });
  // A pill do topo sozinha não bastava: em janela estreita ela fica fora de vista atrás
  // das abas, e o app parece só ter parado de atualizar. A faixa entra NO FLUXO, onde
  // você está olhando, e conta as tentativas.
  es.onerror = () => {
    $('#statusPill').className = 'pill err';
    $('#statusPill').textContent = 'reconectando…';
    TENTATIVAS_RECONEXAO++;
    const f = $('#connLost');
    if (f) {
      f.hidden = false;
      const t = f.querySelector('.cl-try');
      if (t) t.textContent = TENTATIVAS_RECONEXAO > 1 ? `tent. ${TENTATIVAS_RECONEXAO}` : '';
    }
  };
  es.addEventListener('open', () => { TENTATIVAS_RECONEXAO = 0; const f = $('#connLost'); if (f) f.hidden = true; });
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

connect();
