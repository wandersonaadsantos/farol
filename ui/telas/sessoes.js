/* Farol · UI: topo/status da checagem e o feed ao vivo das sessões em andamento
   ("Analisando agora"). Não é aba (não passa por registrarTela): renderStatus e
   renderActive são chamadas pelo connect() do app.js a cada snapshot do SSE, na
   mesma ordem de sempre. */

import {
  statusBannerHtml, fmtClock, feedLine, agentsTitle, stageFlowFrom, stageFlowHtml,
  sessionProgress, sessionCardHtml, stageLabel,
} from '../pure.js';
import { estado } from './estado.js';
import { $, ACTIVE_OPS, showOp, closeOp } from './infra.js';
import { prUser, scopeVisible } from './contas.js';

/* ---------- evento 'activity' do SSE (feed ao vivo de uma sessão) ----------
   Chamado pelo connect() do ui/app.js: aqui é quem sabe o que uma linha de
   atividade FAZ com o estado e a tela de sessão (o app.js só entrega o
   evento). Empilha no feed de estado().activity, escreve no DOM se o card
   está aberto, e atualiza a barra de progresso e a esteira de etapas. */
function handleActivity(id, item) {
  if (estado()?.activity) (estado().activity[id] = estado().activity[id] || []).push(item);
  const feed = document.querySelector(`.activity-feed[data-id="${CSS.escape(id)}"]`);
  if (feed) {
    const stick = feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 30;
    feed.insertAdjacentHTML('beforeend', feedLine(item));
    if (stick) feed.scrollTop = feed.scrollHeight;
  }
  // progresso honesto (régua única sessionProgress, ui/pure.js): a atividade
  // real move a barra do card da sessão no "Analisando agora"
  updateSessionBar(id);
  updateStageFlow(id);
}

/* ---------- render: topo/status ---------- */
function renderStatus() {
  const s = estado();
  const pill = $('#statusPill');
  if (s.status === 'checking') {
    pill.className = 'pill busy';
    pill.textContent = 'verificando…';
    // um erro anterior deixava a op terminal no Map e o has() abaixo barrava o
    // widget novo pra sempre (B11): ciclo novo purga o que ja terminou
    const cur = ACTIVE_OPS.get('sys-polling');
    if (cur && cur.status !== 'running') {
      if (cur.element) cur.element.remove();
      ACTIVE_OPS.delete('sys-polling');
    }
    // Start polling feedback widget
    if (!ACTIVE_OPS.has('sys-polling')) {
      showOp('sys-polling', {
        type: 'polling',
        title: 'Verificando PRs',
        inline: true,
        // ao LADO do #metaCheck (a .meta-line), nunca DENTRO dele: o tickCountdown
        // sobrescreve o textContent do span a cada segundo e mataria a pill
        container: ($('#metaCheck') && $('#metaCheck').parentElement) || document.body
      });
    }
  } else if (s.status === 'error') {
    pill.className = 'pill err';
    pill.textContent = 'erro na checagem';
    closeOp('sys-polling', 'error', (s.error || 'falha na checagem'));
  } else if (s.status === 'starting') {
    pill.className = 'pill';
    pill.textContent = 'iniciando…';
  } else {
    pill.className = 'pill ok';
    pill.textContent = 'monitorando';
    closeOp('sys-polling', 'done', 'Verificação concluída');
  }

  const sp = $('#sessionsPill');
  const term = (s.activeSessions || []).filter(x => x.mode === 'terminal').length;
  sp.hidden = term === 0;
  if (!sp.hidden) sp.textContent = term === 1 ? '1 sessão de IA no terminal' : `${term} sessões de IA no terminal`;

  $('#appVer').textContent = s.app?.version ? `v${s.app.version}` : '';

  const banner = $('#banner');
  const aviso = statusBannerHtml(s);
  // hidden ANTES do innerHTML: o banner e aria-live, e trocar o texto de um elemento
  // ainda escondido evita o leitor de tela anunciar duas vezes
  banner.hidden = !aviso;
  if (aviso) banner.innerHTML = aviso;
}

function tickCountdown() {
  if (!estado()) return;
  const el = $('#metaCheck');
  const last = estado().lastCheckAt ? `Última checagem ${fmtClock(estado().lastCheckAt)}` : 'Primeira checagem em andamento';
  if (estado().status === 'checking') { el.textContent = `${last} · verificando…`; }
  else if (!estado().nextCheckAt) { el.textContent = last; }
  else {
    const rem = Math.max(0, Math.round((estado().nextCheckAt - Date.now()) / 1000));
    const mm = Math.floor(rem / 60), ss = String(rem % 60).padStart(2, '0');
    el.textContent = `${last} · próxima em ${mm}:${ss}`;
  }
  tickElapsed();
}
setInterval(tickCountdown, 1000);

function tickElapsed() {
  document.querySelectorAll('.session-elapsed').forEach(el => {
    const started = parseInt(el.dataset.started, 10);
    if (!started) return;
    const s = Math.max(0, Math.round((Date.now() - started) / 1000));
    el.textContent = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
  });
  // a etapa ATIVA da esteira acumula tempo entre eventos: sem o ticker o contador
  // do nó ativo congelava até a próxima linha do feed chegar
  document.querySelectorAll('.stage-flow[data-id]').forEach(el => updateStageFlow(el.dataset.id));
  // o estagio (iniciando/processando) envelhece junto: o card so re-renderiza em
  // snapshot SSE, entao sem este ticker o rotulo congelava no primeiro paint (B13)
  document.querySelectorAll('.session-stage').forEach(el => {
    const started = parseInt(el.dataset.started, 10);
    if (!started) return;
    el.textContent = stageLabel(Math.max(0, Math.round((Date.now() - started) / 1000)));
  });
}

/* ---------- render: análises em andamento (feed ao vivo) ---------- */
// esteira de etapas do card (estilo n8n): nós com estado feito/ativo/pendente e o
// tempo acumulado, recalculada dos itens ESTAMPADOS do feed (item.s, engine)
function updateStageFlow(id) {
  const el = document.querySelector(`.stage-flow[data-id="${CSS.escape(id)}"]`);
  if (!el) return;
  const sess = (estado().activeSessions || []).find(x => x.id === id);
  const html = stageFlowHtml(stageFlowFrom(estado().activity && estado().activity[id], sess && sess.startedAt));
  el.hidden = !html;
  if (html) el.innerHTML = html;
}

// badge 👥 vivos/total do card de sessão; o title lista cada subagente e o estado
function updateSessionAgents(el, s) {
  if (!el) return;
  const lista = s.agents || [];
  el.hidden = !lista.length;
  if (!lista.length) return;
  el.textContent = `👥 ${s.agentsLive || 0}/${lista.length}`;
  el.title = agentsTitle(lista);
}

function fillFeed(feed, items) {
  const stick = feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 30;
  feed.innerHTML = (items || []).map(feedLine).join('') ||
    '<div class="feed-line k-info"><span class="feed-x">preparando a sessão…</span></div>';
  if (stick) feed.scrollTop = feed.scrollHeight;
}
// a sessão pertence à conta do PR que ela revisa (pelo owner do repo); sem conta
// atribuível, não esconde. Assim trocar de conta não mistura o "Analisando agora".
function sessionVisible(s) {
  const u = s && s.pr ? prUser(s.pr) : '';
  return !u || scopeVisible({ account: u });
}
/* barra de progresso do card de sessão (revisão automática E autoanálise no
   "Analisando agora"): percentual pela régua única sessionProgress sobre a
   contagem de eventos reais do feed. Chamada no render e a cada evento SSE. */
function updateSessionBar(id) {
  const wrap = document.querySelector(`.sess-progress[data-id="${CSS.escape(id)}"]`);
  if (!wrap) return;
  const pct = sessionProgress((estado()?.activity?.[id] || []).length);
  wrap.querySelector('.op-bar-fill').style.width = pct + '%';
  wrap.querySelector('.sess-pct').textContent = pct + '%';
}
function renderActive() {
  const sessions = (estado().activeSessions || []).filter(s => (s.mode === 'auto' || s.mode === 'self') && sessionVisible(s));
  const waiting = (estado().headlessWaiting || []).filter(k => scopeVisible({ key: k }));
  const wrap = $('#activeWrap');
  wrap.hidden = sessions.length === 0 && waiting.length === 0;
  $('#activeCount').textContent = sessions.length || '';
  $('#activeWaiting').textContent = waiting.length
    ? `na fila (${waiting.length}): ${waiting.join(' · ')}`
    : '';
  const box = $('#activeSessions');
  const have = [...box.querySelectorAll('.session-card')].map(el => el.dataset.id).join(',');
  const want = sessions.map(s => s.id).join(',');
  if (have !== want) {
    box.innerHTML = sessions.map(s => {
      const uptime = Math.round((Date.now() - (s.startedAt || Date.now())) / 1000);
      return sessionCardHtml(s, stageLabel(uptime));
    }).join('');
  }
  for (const s of sessions) {
    const feed = box.querySelector(`.activity-feed[data-id="${CSS.escape(s.id)}"]`);
    if (feed) fillFeed(feed, estado().activity && estado().activity[s.id]);
    updateSessionBar(s.id);
    updateStageFlow(s.id);
    // o nivel (Opus/Sonnet/...) so chega no init da sessao, depois do card montar
    const lvl = box.querySelector(`.session-model[data-id="${CSS.escape(s.id)}"]`);
    if (lvl) {
      lvl.hidden = !s.model;
      lvl.textContent = s.model || '';
      if (s.modelRaw) lvl.title = s.modelRaw;
    }
    // subagentes da sessão (fan-out de leitura/verificação): 👥 vivos/total, com a
    // lista de quem faz o quê no title. Some quando a sessão não fatiou nada.
    updateSessionAgents(box.querySelector(`.session-agents[data-id="${CSS.escape(s.id)}"]`), s);
  }
  tickElapsed();
}

export { renderStatus, tickCountdown, updateStageFlow, updateSessionBar, renderActive, handleActivity };
