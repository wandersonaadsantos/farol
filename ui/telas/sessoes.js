/* Farol · UI: topo/status da checagem e o feed ao vivo das sessões em andamento
   ("Analisando agora"). Não é aba (não passa por registrarTela): renderStatus e
   renderActive são chamadas pelo connect() do app.js a cada snapshot do SSE, na
   mesma ordem de sempre. */

import {
  statusBannerHtml, fmtClock, feedLine, agentsTitle, stageFlowFrom, stageFlowHtml,
  sessionCardHtml, progressoDaSessao, conclusaoDaSessao, etapaAtiva,
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
  // linha nova é sinal de vida: o carimbo vale já (o snapshot só chega no ciclo), o
  // ponto da barra pisca e o progresso é recalculado a cada evento
  const sess = (estado()?.activeSessions || []).find(x => x.id === id);
  if (sess && item && item.t) sess.ultimoSinalEm = item.t;
  piscar(id);
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
  // Engine fora do ar: contar para a próxima checagem seria prometer uma coisa que não
  // vai acontecer. A contagem some e fica só quando foi a última vez que soubemos algo.
  if (document.body.classList.contains('sem-engine')) { el.textContent = `${last} · sem conexão com o engine`; }
  else if (estado().status === 'checking') { el.textContent = `${last} · verificando…`; }
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
  // a etapa do cabecalho e a etapa REAL da esteira (item.s do engine), nao mais um
  // rotulo por idade que virava string vazia aos 15 s
  document.querySelectorAll('.session-stage[data-id]').forEach(el => {
    const id = el.dataset.id;
    const sess = (estado().activeSessions || []).find(x => x.id === id);
    if (!sess) return;
    const flow = stageFlowFrom(estado().activity && estado().activity[id], sess.startedAt);
    const etapa = sess.fase === 'fechando' ? 'fechando' : etapaAtiva(flow);
    el.textContent = etapa ? `(${etapa})` : '(iniciando…)';
  });
  // a situacao (sem sinal ha Xs) tambem envelhece sozinha entre eventos
  document.querySelectorAll('.sess-progress[data-id]').forEach(el => updateSessionBar(el.dataset.id));
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
/* Progresso do card de sessão (09/10/2026, desenho do Claude Design em
   docs/superpowers/specs/2026-10-09-progresso-da-sessao-anexos/HANDOFF.md). A conta é
   do progressoDaSessao (ui/pure/sessao.js), sobre o tempo típico que o engine mede e os
   arquivos lidos; aqui mora o que é de TELA: a barra nunca volta (maior valor já
   mostrado), para no lugar quando o stream fica mudo, o ponto pisca a cada evento, e o
   aria-valuetext só muda quando o texto muda ou a cada 10 pontos. */
const PCT_MOSTRADO = new Map();
const ARIA_MOSTRADO = new Map();
const ULTIMA_PISCADA = new Map();
// última versão de cada sessão vista no snapshot, e as que estão no estado 8 (concluída)
const ULTIMA_VISTA = new Map();
const SAINDO = new Map();
const MOSTRA_CONCLUIDA_MS = 1500;
const SAIDA_MS = 300;

function piscar(id) {
  const agora = Date.now();
  if (agora - (ULTIMA_PISCADA.get(id) || 0) < 250) return;
  ULTIMA_PISCADA.set(id, agora);
  const el = document.querySelector(`.sess-progress[data-id="${CSS.escape(id)}"] .sess-sinal`);
  if (!el) return;
  el.classList.remove('pisca');
  void el.offsetWidth; // reinicia a animação
  el.classList.add('pisca');
}

function pintarBarra(wrap, id, p) {
  wrap.dataset.estado = p.estado;
  // a borda do cartão acompanha o estado (classe no cartão: ver o comentário no app.css)
  const card = wrap.closest('.session-card');
  if (card) {
    card.classList.toggle('sess-muda', p.estado === 'muda');
    card.classList.toggle('sess-concluida', p.estado === 'concluida');
  }
  const inteiro = Math.floor(p.pct);
  wrap.querySelector('.sess-pct').textContent = `${inteiro}%`;
  wrap.querySelector('.op-bar-fill').style.width = `${p.pct}%`;
  wrap.querySelector('.sess-estado').textContent = p.texto;
  const base = wrap.querySelector('.sess-base');
  base.textContent = p.base;
  base.hidden = !p.base;
  wrap.setAttribute('aria-valuenow', String(inteiro));
  // no estado mudo o contador anda a cada segundo: a chave ignora o número
  const chave = p.estado === 'muda' ? 'muda' : p.texto;
  const ant = ARIA_MOSTRADO.get(id);
  if (!ant || ant.chave !== chave || Math.abs(p.pct - ant.pct) >= 10) {
    wrap.setAttribute('aria-valuetext', p.aria);
    ARIA_MOSTRADO.set(id, { chave, pct: p.pct });
  }
  // o silêncio é anunciado UMA vez, ao entrar no estado
  const aviso = wrap.querySelector('.sess-aviso');
  if (p.estado === 'muda' && !aviso.textContent) aviso.textContent = p.texto;
  if (p.estado !== 'muda' && aviso.textContent) aviso.textContent = '';
}

function updateSessionBar(id) {
  const wrap = document.querySelector(`.sess-progress[data-id="${CSS.escape(id)}"]`);
  if (!wrap) return;
  const saindo = SAINDO.get(id);
  if (saindo) return pintarBarra(wrap, id, conclusaoDaSessao(saindo.sess, saindo.fim));
  const sess = (estado().activeSessions || []).find(x => x.id === id) || {};
  const p = progressoDaSessao(sess, stageFlowFrom(estado().activity && estado().activity[id], sess.startedAt));
  const antes = PCT_MOSTRADO.get(id) || 0;
  const pct = p.estado === 'muda' ? antes : Math.max(antes, p.pct);
  PCT_MOSTRADO.set(id, pct);
  pintarBarra(wrap, id, { ...p, pct, aria: p.aria.replace(/^d+%/, `${Math.floor(pct)}%`) });
}

// Estado 8: a sessão que saiu do snapshot DEPOIS que o modelo concluiu fica em 100% por
// um instante e sai. Saída antes disso (cancelamento, falha) não é conclusão, e o cartão
// some na hora, como sempre.
function marcarConcluidas(box, vivas) {
  const ids = new Set(vivas.map(s => s.id));
  for (const el of box.querySelectorAll('.session-card')) {
    const id = el.dataset.id;
    const ult = ULTIMA_VISTA.get(id);
    if (ids.has(id) || SAINDO.has(id) || !ult || ult.fase !== 'fechando') continue;
    SAINDO.set(id, { sess: ult, fim: Date.now() });
    const cancelar = el.querySelector('.act-cancel');
    if (cancelar) cancelar.remove();
    updateSessionBar(id);
    setTimeout(() => sair(id), MOSTRA_CONCLUIDA_MS);
  }
  for (const id of [...ULTIMA_VISTA.keys()]) if (!ids.has(id) && !SAINDO.has(id)) esquecer(id);
  for (const s of vivas) ULTIMA_VISTA.set(s.id, s);
}
function esquecer(id) {
  for (const m of [PCT_MOSTRADO, ARIA_MOSTRADO, ULTIMA_PISCADA, ULTIMA_VISTA, SAINDO]) m.delete(id);
}
function sair(id) {
  const el = document.querySelector(`.session-card[data-id="${CSS.escape(id)}"]`);
  if (el) el.classList.add('saindo');
  const reduzido = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => { esquecer(id); renderActive(); }, reduzido ? 0 : SAIDA_MS);
}
function renderActive() {
  const vivas = (estado().activeSessions || []).filter(s => (s.mode === 'auto' || s.mode === 'self') && sessionVisible(s));
  const box = $('#activeSessions');
  marcarConcluidas(box, vivas);
  const concluidas = [...SAINDO.values()].map(x => x.sess).filter(s => !vivas.some(v => v.id === s.id));
  const sessions = [...vivas, ...concluidas];
  const contas = estado().headlessWaitingContas || {};
  const waiting = (estado().headlessWaiting || []).filter(k => scopeVisible({ key: k, account: contas[k] }));
  const wrap = $('#activeWrap');
  wrap.hidden = sessions.length === 0 && waiting.length === 0;
  $('#activeCount').textContent = vivas.length || '';
  $('#activeWaiting').textContent = waiting.length
    ? `na fila (${waiting.length}): ${waiting.join(' · ')}`
    : '';
  // cartão a cartão, e não innerHTML da caixa inteira: refazer tudo zerava o feed do
  // cartão que está no estado de concluída
  const want = new Set(sessions.map(s => s.id));
  for (const el of box.querySelectorAll('.session-card')) if (!want.has(el.dataset.id)) el.remove();
  // quem mais está revisando o PR da sessão vem do panorama, que o motor anota a cada ciclo
  const outrosDe = (s) => ((estado().panorama || []).find((p) => p.key === (s.keys || [])[0]) || {}).outrosRevisando || [];
  for (const s of sessions) {
    if (!box.querySelector(`.session-card[data-id="${CSS.escape(s.id)}"]`)) box.insertAdjacentHTML('beforeend', sessionCardHtml(s, '(iniciando…)', outrosDe(s)));
  }
  for (const s of vivas) {
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
