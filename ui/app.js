/* Farol · UI: consome o engine local via SSE + fetch. Sem frameworks. */
'use strict';

const $ = (s) => document.querySelector(s);
const isElectron = navigator.userAgent.includes('Electron');
if (isElectron) document.body.classList.add('electron');
const isMac = /Macintosh|Mac OS X/.test(navigator.userAgent);
if (isMac) document.body.classList.add('mac');

let STATE = null;
let logTimer = null;

/* ---------- helpers ---------- */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function api(path, body) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-farol': '1' },
    body: JSON.stringify(body || {})
  }).then(r => r.json()).catch(() => null);
}
function get(path) { return fetch(path).then(r => r.json()).catch(() => null); }

function fmtClock(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function fmtRel(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'agora';
  if (s < 3600) return `${Math.round(s / 60)}min`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
function avatar(login, cls = '') {
  const initial = (login || '?').charAt(0).toUpperCase();
  return `<span class="avatar ${cls}">${esc(initial)}<img src="https://github.com/${encodeURIComponent(login)}.png?size=96" alt="" loading="lazy" onerror="this.remove()"></span>`;
}
function toast(kind, html, ms = 5000) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = html;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
  return el;
}

/* ---------- tema ---------- */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('farol-theme', theme);
  $('#iconMoon').style.display = theme === 'dark' ? '' : 'none';
  $('#iconSun').style.display = theme === 'dark' ? 'none' : '';
}
applyTheme(localStorage.getItem('farol-theme') || 'dark');
$('#btnTheme').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  api('/api/settings', { theme: next });
};

/* ---------- abas ---------- */
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'destaques') loadHighlights();
  if (name === 'time') loadTeam();
  if (name === 'sistema') { loadLog(); renderDoctor(); loadReviewerCands(); }
}
$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (btn) switchTab(btn.dataset.tab);
});

/* ---------- render: topo/status ---------- */
function renderStatus() {
  const s = STATE;
  const pill = $('#statusPill');
  const sessions = (s.activeSessions || []).length;
  if (s.status === 'checking') { pill.className = 'pill busy'; pill.textContent = 'verificando…'; }
  else if (s.status === 'error') { pill.className = 'pill err'; pill.textContent = 'erro na checagem'; }
  else if (s.status === 'starting') { pill.className = 'pill'; pill.textContent = 'iniciando…'; }
  else { pill.className = 'pill ok'; pill.textContent = 'monitorando'; }

  const sp = $('#sessionsPill');
  const term = (s.activeSessions || []).filter(x => x.mode === 'terminal').length;
  sp.hidden = term === 0;
  if (!sp.hidden) sp.textContent = term === 1 ? '1 sessão do Claude no terminal' : `${term} sessões do Claude no terminal`;

  $('#metaAccount').textContent = `${s.account.user ? '@' + s.account.user : 'conta não configurada'} · ${(s.config.owners || []).join(', ')}`;
  $('#appVer').textContent = s.app?.version ? `v${s.app.version}` : '';

  const banner = $('#banner');
  if (!s.account.user && s.status !== 'starting') {
    banner.hidden = false;
    banner.innerHTML = `Bem-vindo ao Farol! Nenhuma conta do GitHub foi detectada. Rode <code>gh auth login</code> no terminal (conta de trabalho) e clique em Verificar agora.`;
  } else if (!s.account.tokenOk && s.status !== 'starting') {
    banner.hidden = false;
    banner.innerHTML = `A conta <b>${esc(s.account.user)}</b> não está autenticada no GitHub CLI. Rode <code>gh auth login</code> no terminal e clique em Verificar agora.`;
  } else if (s.status === 'error' && s.error) {
    banner.hidden = false;
    banner.innerHTML = `Falha na última checagem: ${esc(s.error)}. Vou tentar de novo no próximo ciclo.`;
  } else banner.hidden = true;
}

function tickCountdown() {
  if (!STATE) return;
  const el = $('#metaCheck');
  const last = STATE.lastCheckAt ? `Última checagem ${fmtClock(STATE.lastCheckAt)}` : 'Primeira checagem em andamento';
  if (STATE.status === 'checking') { el.textContent = `${last} · verificando…`; }
  else if (!STATE.nextCheckAt) { el.textContent = last; }
  else {
    const rem = Math.max(0, Math.round((STATE.nextCheckAt - Date.now()) / 1000));
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
}

/* ---------- render: análises em andamento (feed ao vivo) ---------- */
function feedLine(it) {
  const icon = { tool: '⚙', text: '💬', warn: '⚠', info: '·' }[it.k] || '·';
  return `<div class="feed-line k-${esc(it.k)}"><span class="feed-t">${fmtClock(it.t)}</span><span class="feed-i">${icon}</span><span class="feed-x">${esc(it.text)}</span></div>`;
}
function fillFeed(feed, items) {
  const stick = feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 30;
  feed.innerHTML = (items || []).map(feedLine).join('') ||
    '<div class="feed-line k-info"><span class="feed-x">preparando a sessão…</span></div>';
  if (stick) feed.scrollTop = feed.scrollHeight;
}
function renderActive() {
  const sessions = (STATE.activeSessions || []).filter(s => s.mode === 'auto' || s.mode === 'self');
  const waiting = STATE.headlessWaiting || [];
  const wrap = $('#activeWrap');
  wrap.hidden = sessions.length === 0 && waiting.length === 0;
  $('#activeCount').textContent = sessions.length || '';
  $('#activeWaiting').textContent = waiting.length
    ? `na fila (${waiting.length}), um por vez: ${waiting.join(' · ')}`
    : '';
  const box = $('#activeSessions');
  const have = [...box.querySelectorAll('.session-card')].map(el => el.dataset.id).join(',');
  const want = sessions.map(s => s.id).join(',');
  if (have !== want) {
    box.innerHTML = sessions.map(s => `
      <div class="card session-card" data-id="${esc(s.id)}">
        <div class="session-head">
          <span class="spin accent"></span>
          <b>${esc(s.label)}</b>
          <span class="session-model" data-id="${esc(s.id)}" hidden></span>
          ${s.pr?.url ? `<a href="${esc(s.pr.url)}" target="_blank" rel="noreferrer">abrir PR</a>` : ''}
          <span class="session-elapsed" data-started="${s.startedAt}"></span>
          ${s.cancellable ? `<button class="btn sm danger-ghost act-cancel" data-id="${esc(s.id)}">Cancelar</button>` : ''}
        </div>
        <div class="activity-feed" data-id="${esc(s.id)}"></div>
      </div>`).join('');
  }
  for (const s of sessions) {
    const feed = box.querySelector(`.activity-feed[data-id="${CSS.escape(s.id)}"]`);
    if (feed) fillFeed(feed, STATE.activity && STATE.activity[s.id]);
    // o nivel (Opus/Sonnet/...) so chega no init da sessao, depois do card montar
    const lvl = box.querySelector(`.session-model[data-id="${CSS.escape(s.id)}"]`);
    if (lvl) {
      lvl.hidden = !s.model;
      lvl.textContent = s.model || '';
      if (s.modelRaw) lvl.title = s.modelRaw;
    }
  }
  tickElapsed();
}

/* ---------- markdown minimo (relatorios de review) ---------- */
function md(src) {
  const lines = esc(String(src || '')).split(/\r?\n/);
  const out = [];
  let list = null, table = null;
  const closeAll = () => {
    if (list) { out.push(`</${list}>`); list = null; }
    if (table) { out.push('</tbody></table>'); table = null; }
  };
  const inline = (s) => s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/^\[!(NOTE|WARNING|IMPORTANT)\]\s*/i, '');
  for (const raw of lines) {
    const l = raw.trimEnd();
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeAll(); out.push(`<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`); continue; }
    if (/^(---+|\*\*\*+)$/.test(l.trim())) { closeAll(); out.push('<hr>'); continue; }
    if (/^&gt;\s?/.test(l.trim())) { closeAll(); out.push(`<blockquote>${inline(l.trim().replace(/^&gt;\s?/, ''))}</blockquote>`); continue; }
    if (/^\|.*\|$/.test(l.trim())) {
      const cells = l.trim().slice(1, -1).split('|').map(c => c.trim());
      if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue; // linha separadora
      if (!table) { table = true; out.push('<table><tbody>'); }
      out.push('<tr>' + cells.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>');
      continue;
    } else if (table) { out.push('</tbody></table>'); table = null; }
    const li = l.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      if (list !== 'ul') { closeAll(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(li[1].replace(/^\[([ x])\]\s*/i, (m, c) => c.toLowerCase() === 'x' ? '☑ ' : '☐ '))}</li>`);
      continue;
    }
    closeAll();
    if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  closeAll();
  return out.join('\n');
}

/* ---------- chat com o Claude ---------- */
let chatKey = null, chatUrl = null;
function chatBadge(key) {
  const c = STATE?.chats?.[key];
  return c && c.count ? ` <span class="count">${c.count}</span>` : '';
}
function openChat(key, url) {
  chatKey = key; chatUrl = url || null;
  $('#chatKey').textContent = key;
  const link = $('#chatLink');
  if (url) { link.href = url; link.hidden = false; } else link.hidden = true;
  $('#chatPanel').hidden = false;
  $('#chatMsgs').innerHTML = '<div class="chat-hint">carregando…</div>';
  get('/api/chat?key=' + encodeURIComponent(key)).then(c => { if (c && chatKey === key) renderChat(c); });
  $('#chatInput').focus();
}
function closeChat() { chatKey = null; $('#chatPanel').hidden = true; }
function renderChat(c) {
  const box = $('#chatMsgs');
  const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
  if (!(c.messages || []).length) {
    box.innerHTML = `<div class="chat-hint">Converse com o Claude sobre <b>${esc(c.key)}</b>. Quando o PR já passou pela revisão automática, ele chega sabendo o diff, o card e o relatório; e pode examinar o PR com <code>gh</code>. Pra responder no PR, é só pedir: "posta esse comentário".</div>`;
  } else {
    box.innerHTML = c.messages.map(m => {
      if (m.role === 'user') return `<div class="msg user">${esc(m.text)}</div>`;
      if (m.role === 'system') return `<div class="msg sys">${esc(m.text)}</div>`;
      return `<div class="msg bot report">${md(m.text)}</div>`;
    }).join('');
  }
  const running = c.status === 'running';
  $('#btnChatSend').disabled = running;
  $('#btnChatStop').hidden = !running;
  const act = $('#chatActivity');
  act.hidden = !running;
  if (running && !act.textContent) act.textContent = 'pensando…';
  if (!running) act.textContent = '';
  if (stick || running) box.scrollTop = box.scrollHeight;
}
$('#btnChatClose').onclick = closeChat;
$('#btnChatStop').onclick = () => api('/api/chat/stop', { key: chatKey });
$('#chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('#chatInput').value.trim();
  if (!text || !chatKey) return;
  $('#chatInput').value = '';
  const r = await api('/api/chat/send', { key: chatKey, url: chatUrl, text });
  if (!r?.ok) toast('error', esc(r?.error || 'não consegui enviar a mensagem'));
});
$('#chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chatForm').requestSubmit(); }
});
/* qualquer botão .act-chat da página abre a conversa do PR */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.act-chat');
  if (btn) openChat(btn.dataset.key, btn.dataset.url || null);
});

/* ---------- render: decisoes pendentes ---------- */
function renderDecisions() {
  const pending = STATE.decisions?.pending || [];
  const wrap = $('#decisionsWrap');
  wrap.hidden = pending.length === 0;
  $('#decisionsCount').textContent = pending.length;
  if (!pending.length) { $('#decisions').innerHTML = ''; renderResolved(); return; }
  $('#decisions').innerHTML = pending.map(d => `
    <div class="card decision" data-id="${esc(d.id)}">
      <div class="decision-head">
        <span class="verdict ${d.verdict === 'approve' ? 'approve' : 'rc'}">${d.verdict === 'approve' ? 'APROVÁVEL' : 'COM BLOCKER'}</span>
        <a class="dec-ref" href="${esc(d.pr?.url || '#')}" target="_blank" rel="noreferrer">${esc(d.key)}</a>
        ${d.card ? `<span class="pill">${esc(d.card)}</span>` : '<span class="pill">sem card</span>'}
        <span class="dec-when">${fmtClock(d.createdAt)}</span>
      </div>
      ${d.pr?.title ? `<div class="dec-title">${esc(d.pr.title)}</div>` : ''}
      ${(d.reasons || []).length ? `<ul class="dec-reasons">${d.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
      <details class="dec-report"><summary>Ver relatório completo</summary><div class="report">${md(d.reportMarkdown)}</div></details>
      <div class="dec-actions">
        <button class="btn primary sm dec-act" data-action="approve">Aprovar</button>
        <button class="btn sm dec-act dec-rc" data-action="request_changes">Pedir mudanças</button>
        <button class="btn sm dec-act" data-action="comment">Só comentar</button>
        <button class="btn sm act-chat" data-key="${esc(d.key)}" data-url="${esc(d.pr?.url || '')}">💬 Conversar${chatBadge(d.key)}</button>
        <button class="btn sm ghost dec-act" data-action="skip">Pular</button>
      </div>
    </div>`).join('');
  renderResolved();
}

function renderResolved() {
  const resolved = STATE.decisions?.resolved || [];
  const wrap = $('#resolvedWrap');
  wrap.hidden = resolved.length === 0;
  if (!resolved.length) return;
  const labels = {
    auto_approved: ['✅', 'aprovado sozinho'],
    posted: ['📬', 'postado por você'],
    already_reviewed: ['✔', 'já revisado por você (não repostei)'],
    skipped: ['⏭', 'pulado']
  };
  const actions = { approve: 'APPROVE', request_changes: 'REQUEST CHANGES', comment: 'COMMENT' };
  $('#resolved').innerHTML = resolved.map(r => {
    const [icon, label] = labels[r.status] || ['•', r.status];
    const act = (r.status === 'posted' || r.status === 'already_reviewed') ? ` (${actions[r.action] || r.action})` : '';
    return `<div class="row">
      <span>${icon}</span>
      <span class="ref"><a href="${esc(r.pr?.url || '#')}" target="_blank" rel="noreferrer">${esc(r.key)}</a></span>
      <span class="title">${label}${act}${r.card ? ` · ${esc(r.card)}` : ''}</span>
      <button class="btn sm ghost act-chat" data-key="${esc(r.key)}" data-url="${esc(r.pr?.url || '')}">💬${chatBadge(r.key)}</button>
      <span class="when">${fmtClock(r.resolvedAt)}</span>
    </div>`;
  }).join('');
}

/* ---------- render: radar ---------- */
function renderQueue() {
  const q = STATE.queue || [];
  $('#queueCount').hidden = q.length === 0;
  $('#queueCount').textContent = q.length;
  const btnAll = $('#btnReviewAll');
  btnAll.hidden = q.length < 2;
  btnAll.textContent = `Revisar tudo (${q.length})`;

  const box = $('#queue');
  if (!q.length) {
    box.innerHTML = `<div class="empty"><span class="big">✨</span>Tudo em dia. Nenhum PR esperando por você.<br><small>Quando pedirem sua revisão, o card aparece aqui e você recebe um aviso.</small></div>`;
    return;
  }
  box.innerHTML = q.map(pr => `
    <div class="card pr-card" data-key="${esc(pr.key)}">
      ${avatar(pr.author)}
      <div class="info">
        <div class="pr-ref"><a href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.key)}</a></div>
        <div class="pr-title" title="${esc(pr.title)}">${esc(pr.title)}</div>
        <div class="pr-sub">@${esc(pr.author)} · atualizado ${fmtRel(pr.updatedAt)}</div>
      </div>
      <div class="pr-actions">
        <button class="btn primary sm act-review" data-url="${esc(pr.url)}">Revisar</button>
        <button class="btn icon sm ghost act-chat" data-key="${esc(pr.key)}" data-url="${esc(pr.url)}" title="Conversar com o Claude sobre este PR">
          <svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H4l2.5-2.7A8 8 0 1 1 21 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
        </button>
        <button class="btn icon sm ghost act-terminal" data-url="${esc(pr.url)}" title="Revisar no terminal (interativo)">
          <svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z" fill="none" stroke="currentColor" stroke-width="2"/><path d="m7 9 3 3-3 3M12 15h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="btn sm danger-ghost act-ignore" data-key="${esc(pr.key)}" title="Marcar como visto sem revisar">Ignorar</button>
      </div>
    </div>`).join('');
}

/* selo de estado da SUA revisão numa linha do panorama: primeiro o que o Farol
   registrou (decisões), senão o que o GitHub diz (--reviewed-by, cobre reviews
   feitos fora do Farol). */
function reviewChip(pr) {
  const a = (STATE.reviewActions || {})[pr.key];
  if (a) {
    if (a.kind === 'pending') return '<span class="badge rev-pend" title="A análise terminou e está esperando a sua decisão em Precisa de você">🟡 aguardando você</span>';
    if (a.kind === 'approve') return `<span class="badge rev-ok" title="APPROVE postado${a.auto ? ' automaticamente pelo protocolo' : ' por você'} via Farol">✅ você aprovou</span>`;
    if (a.kind === 'request_changes') return '<span class="badge rev-rc" title="REQUEST CHANGES postado por você via Farol">✋ você pediu mudanças</span>';
    if (a.kind === 'comment') return '<span class="badge rev-cm" title="COMMENT postado por você via Farol">💬 você comentou</span>';
  }
  if (pr.reviewedByMe) return '<span class="badge rev-ok" title="Você já revisou este PR no GitHub">✔ revisado por você</span>';
  return '';
}

function renderPanorama() {
  const list = STATE.panorama || [];
  $('#panoCount').hidden = list.length === 0;
  $('#panoCount').textContent = list.length;
  $('#panoOwners').textContent = list.length ? 'PRs abertos, os seus destacados' : '';
  const box = $('#panorama');
  if (!list.length) {
    box.style.display = 'block';
    box.innerHTML = `<div class="empty" style="border:0">Nenhum PR aberto nas organizações monitoradas.</div>`;
    return;
  }
  box.style.display = '';
  const busy = new Set([].concat(...(STATE.activeSessions || []).map(s => s.keys || [])).concat(STATE.headlessWaiting || []));
  box.innerHTML = list.map(pr => {
    const chip = reviewChip(pr);
    return `
    <div class="row ${pr.mine ? 'mine' : ''} ${chip ? 'reviewed' : ''}">
      <span class="status-dot"></span>
      <span class="ref"><a href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.key)}</a></span>
      ${pr.mine ? '<span class="badge">sua revisão</span>' : ''}
      ${chip}
      <span class="title" title="${esc(pr.title)}">${esc(pr.title)}</span>
      <span class="who">@${esc(pr.author)}</span>
      <button class="btn sm ghost act-review pano-review" data-url="${esc(pr.url)}" ${busy.has(pr.key) ? 'disabled' : ''}
        title="${pr.mine ? 'Revisar (seu review pedido)' : 'Revisar sob demanda: o resultado sempre passa por você, nada é postado sozinho'}">${busy.has(pr.key) ? 'Revisando…' : chip ? 'Re-revisar' : 'Revisar'}</button>
      <span class="when">${fmtRel(pr.updatedAt)}</span>
    </div>`;
  }).join('');
}

/* ---------- render: meus PRs (autoanálise) ---------- */
// PRs cujo merge normal esbarrou na proteção de branch: mostram as saídas
// auto-merge/admin até a pessoa escolher (estado só da sessão, não persiste).
const mergeBlockedByPolicy = new Set();
// PRs cujo auto-merge o repo recusou nesta sessão (repo sem "Allow auto-merge"):
// desabilita o botão Auto-merge até o próximo refresh confirmar o estado do repo.
const autoUnavailableKeys = new Set();
// PRs cujo Merge (admin) foi recusado por ruleset nesta sessão: esconde o botão
// admin até o próximo refresh confirmar (o --admin não fura ruleset).
const adminUnavailableKeys = new Set();
function renderMyPRs() {
  const list = STATE.myPRs || [];
  const analyses = STATE.selfAnalyses || {};
  const wrap = $('#myPRsWrap');
  wrap.hidden = list.length === 0;
  $('#myPRsCount').hidden = list.length === 0;
  $('#myPRsCount').textContent = list.length;
  if (!list.length) { $('#myPRs').innerHTML = ''; return; }

  const activeSelf = new Set(
    [].concat(...(STATE.activeSessions || []).filter(s => s.mode === 'self').map(s => s.keys || []))
  );
  const waiting = STATE.headlessWaiting || [];
  const blockedRepos = new Set(((STATE.config && STATE.config.mergeBlockedRepos) || []).map(r => String(r).toLowerCase()));

  $('#myPRs').innerHTML = list.map(pr => {
    const a = analyses[pr.key];
    const running = activeSelf.has(pr.key);
    // fila serial (um por vez): posicao = ordem real na headlessQueue
    const qpos = running ? 0 : waiting.indexOf(pr.key) + 1;
    const queued = qpos > 0;
    const btnLabel = running ? 'Analisando…' : queued ? `Na fila (${qpos})` : a ? 'Reanalisar' : 'Analisar';
    // merge so quando a autoanalise diz aprovavel; desativado (com motivo) se o
    // repo estiver na lista bloqueada ou se ainda ha analise rodando/na fila
    // O Merge só fica disponível quando dá pra mergear DE VERDADE. A mergeabilidade
    // real vem do GitHub (STATE.mergeStates): CLEAN/UNSTABLE = mergeia agora;
    // BLOCKED = proteção exige requisitos (mostra auto/admin); DIRTY/BEHIND/DRAFT =
    // não dá, botão desabilitado com o motivo.
    const canMerge = !!(a && a.approvable);
    const repoBlocked = blockedRepos.has(String(pr.key.split('#')[0]).toLowerCase());
    const ms = (STATE.mergeStates || {})[pr.key];
    const dataAttrs = `data-url="${esc(pr.url)}" data-key="${esc(pr.key)}"`;
    // auto-merge indisponível: repo sem "Allow auto-merge" (autoAllowed===false) ou
    // já recusou numa tentativa nesta sessão. Nesse caso só admin resolve.
    const autoOff = (ms && ms.autoAllowed === false) || autoUnavailableKeys.has(pr.key);
    // admin indisponível: a base usa ruleset que o --admin não fura (ms.adminBlocked)
    // ou já recusou por isso nesta sessão. Nesse caso o botão Merge (admin) some.
    const adminOff = (ms && ms.adminBlocked === true) || adminUnavailableKeys.has(pr.key);
    const btnMerge = (dis, title) => `<button class="btn ok sm act-self-merge" ${dataAttrs} ${dis ? 'disabled' : ''} title="${esc(title)}">Merge</button>`;
    const btnOptions = () => {
      if (autoOff && adminOff) return `<button class="btn sm act-self-merge" ${dataAttrs} disabled title="A proteção deste repo exige aprovação (ruleset), e nem auto-merge nem admin resolvem. Consiga uma aprovação.">Precisa de aprovação</button>`;
      const auto = `<button class="btn ok sm act-merge-auto" ${dataAttrs} ${autoOff ? 'disabled' : ''} title="${esc(autoOff ? "Este repo não tem 'Allow auto-merge' ligado (Settings do repo)." : 'Ativa o auto-merge: o GitHub mergeia sozinho quando aprovação e checks passarem (não burla a proteção)')}">⏳ Auto-merge</button>`;
      const admin = adminOff ? '' : `<button class="btn sm act-merge-admin" ${dataAttrs} title="Bypassa a proteção da branch e mergeia agora, ignorando revisões e checks obrigatórios (só funciona se você for admin e a proteção não for ruleset)">Merge (admin)</button>`;
      return auto + (admin ? '\n         ' + admin : '');
    };
    let mergeBtns = '';
    if (canMerge) {
      if (running || queued) mergeBtns = btnMerge(true, 'Aguarde a análise terminar');
      else if (repoBlocked) mergeBtns = btnMerge(true, 'Merge bloqueado para este repo (edite a lista na aba Sistema)');
      else if (mergeBlockedByPolicy.has(pr.key)) mergeBtns = btnOptions();
      else if (!ms) mergeBtns = btnMerge(true, 'Verificando se dá pra mergear…');
      else if (ms.isDraft || ms.status === 'DRAFT') mergeBtns = btnMerge(true, 'O PR está como rascunho, marque como ready antes');
      else if (ms.mergeable === 'CONFLICTING' || ms.status === 'DIRTY') mergeBtns = btnMerge(true, 'O PR tem conflito com a branch de destino, resolva antes');
      else if (ms.status === 'BEHIND') mergeBtns = btnMerge(true, 'A branch está atrás da base, atualize antes de mergear');
      else if (ms.status === 'BLOCKED') mergeBtns = btnOptions();
      else if (ms.status === 'CLEAN' || ms.status === 'UNSTABLE' || ms.status === 'HAS_HOOKS' || ms.mergeable === 'MERGEABLE')
        mergeBtns = btnMerge(false, 'Atribui você ao PR se preciso, faz o merge na branch de destino e deleta a branch de origem se for descartável');
      else mergeBtns = btnMerge(true, `Não dá pra mergear agora (${ms.status || ms.mergeable || 'estado desconhecido'})`);
    }
    const badge = a
      ? (a.approvable ? '<span class="verdict approve">aprovável</span>' : '<span class="verdict rc">precisa de ajuste</span>')
      : '';
    const hasBlockers = !!(a && (a.blockers || []).length);
    const hasWork = !!(a && ((a.blockers || []).length || (a.tips || []).length));
    const analysisPanel = a ? `
      <div class="mypr-analysis">
        ${a.summary ? `<div class="mypr-summary">${esc(a.summary)}</div>` : ''}
        ${(a.blockers || []).length ? `<div class="mypr-block"><b>Antes de pedir review</b><ul class="dec-reasons">${a.blockers.map(b => `<li>🔴 ${esc(b)}</li>`).join('')}</ul></div>` : ''}
        ${(a.tips || []).length ? `<div class="mypr-tips"><b>Dá pra melhorar</b><ul class="dec-reasons">${a.tips.map(t => `<li>🟡 ${esc(t)}</li>`).join('')}</ul></div>` : ''}
        ${hasWork ? `<div class="mypr-fixrow"><button class="btn sm act-fix-copy" data-key="${esc(pr.key)}" title="Monta um prompt com os pontos da revisão pra você colar no chat que está resolvendo este PR">📋 ${hasBlockers ? 'Copiar prompt de correção' : 'Copiar prompt de melhoria'}</button></div>` : ''}
        ${a.reportMarkdown ? `<details class="dec-report"><summary>Ver relatório completo</summary><div class="report">${md(a.reportMarkdown)}</div></details>` : ''}
        <div class="mypr-when">analisado ${fmtRel(new Date(a.at).toISOString())}${a.card ? ` · ${esc(a.card)}` : ''}</div>
      </div>` : '';
    return `
    <div class="card mypr-card ${a ? (a.approvable ? 'ok' : 'warn') : ''}" data-key="${esc(pr.key)}">
      <div class="mypr-top">
        ${avatar(pr.author)}
        <div class="info">
          <div class="pr-ref"><a href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.key)}</a>
            ${pr.isDraft ? '<span class="badge">rascunho</span>' : ''}${badge}</div>
          <div class="pr-title" title="${esc(pr.title)}">${esc(pr.title)}</div>
          ${pr.head && pr.base ? `<div class="pr-branches"><code>${esc(pr.head)}</code> <span class="arrow">→</span> <code>${esc(pr.base)}</code></div>` : ''}
          <div class="pr-sub">atualizado ${fmtRel(pr.updatedAt)}</div>
        </div>
        <div class="pr-actions">
          <button class="btn primary sm act-self" data-url="${esc(pr.url)}" ${running || queued ? 'disabled' : ''}>${btnLabel}</button>
          <button class="btn sm ghost act-set-reviewers" data-url="${esc(pr.url)}" title="Atribui você e pede review dos reviewers configurados deste repo (aba Sistema). Aplica na hora, sem confirmação.">👥 Reviewers</button>
          ${mergeBtns}
          ${a ? `<button class="btn sm ghost act-self-clear" data-key="${esc(pr.key)}" title="Ocultar esta autoanálise (é só sua, some da tela; dá pra reanalisar quando quiser)">Ocultar</button>` : ''}
        </div>
      </div>
      ${analysisPanel}
    </div>`;
  }).join('');
}
// Copia texto com fallback: a Clipboard API exige contexto seguro e foco; quando
// falha (ex.: janela sem foco), recai pro textarea + execCommand, que não depende
// de permissão. Devolve true se algum caminho copiou.
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* cai no fallback */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.left = '-9999px'; ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

// Monta um prompt pronto pra colar no chat que está resolvendo o PR, a partir
// dos pontos da autoanálise (blockers = travam a aprovação; tips = melhorias).
function buildFixPrompt(key) {
  const a = (STATE.selfAnalyses || {})[key];
  const pr = (STATE.myPRs || []).find(p => p.key === key) || {};
  if (!a) return '';
  const blockers = (a.blockers || []).filter(Boolean);
  const tips = (a.tips || []).filter(Boolean);
  const abre = blockers.length
    ? `Preciso que você corrija os pontos levantados na revisão do PR ${key}, começando pelo que trava a aprovação.`
    : `Preciso que você aplique as melhorias sugeridas na revisão do PR ${key}.`;
  const linhas = [abre, ''];
  if (pr.url) linhas.push(`PR: ${pr.url}`);
  if (pr.title) linhas.push(`Título: ${pr.title}`);
  if (a.card) linhas.push(`Card: ${a.card}`);
  if (a.summary) { linhas.push('', `Resumo da revisão: ${a.summary}`); }
  if (blockers.length) { linhas.push('', 'Pendências que travam a aprovação (prioridade):', ...blockers.map(b => `- ${b}`)); }
  if (tips.length) { linhas.push('', 'Melhorias sugeridas:', ...tips.map(t => `- ${t}`)); }
  linhas.push('', 'Implemente as correções no código, rode os testes e o lint que fizerem sentido, e no final me diga o que mudou e por quê.');
  return linhas.join('\n');
}

$('#myPRs').addEventListener('click', (e) => {
  const fix = e.target.closest('.act-fix-copy');
  if (fix) {
    const prompt = buildFixPrompt(fix.dataset.key);
    if (!prompt) { toast('error', 'não achei a análise pra montar o prompt'); return; }
    copyToClipboard(prompt).then(ok => ok
      ? toast('ok', 'Prompt copiado. É só colar no chat que está resolvendo o PR.', 3500)
      : toast('error', 'Não consegui copiar (permissão do navegador).'));
    return;
  }
  const rev = e.target.closest('.act-set-reviewers');
  if (rev) {
    const card = rev.closest('.mypr-card');
    const repo = String(card?.dataset.key || '').split('#')[0];
    const cfg = ((STATE.config || {}).projectReviewers || {})[repo];
    // sem reviewers configurados: leva pra tela de config (em vez de erro)
    if (!cfg || !cfg.length) {
      if (repo) pendingRepoRows.add(repo);
      switchTab('sistema');
      loadReviewerCands();
      renderReviewersEditor();
      setTimeout(() => { const el = $('#reviewersEditor'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
      toast('info', `Configure os reviewers de ${repo} aqui, depois é só clicar em Reviewers no PR.`, 6000);
      return;
    }
    // tem config: aplica na hora, sem confirmação
    rev.disabled = true; rev.textContent = 'Setando…';
    api('/api/self-review/reviewers', { url: rev.dataset.url }).then(r => {
      if (!r?.ok) toast('error', esc(r?.error || 'não consegui setar os reviewers'));
      rev.disabled = false; rev.textContent = '👥 Reviewers';
    });
    return;
  }
  const run = e.target.closest('.act-self');
  if (run) {
    run.disabled = true; run.textContent = 'Analisando…';
    api('/api/self-review', { url: run.dataset.url }).then(r => {
      if (!r?.ok) { toast('error', esc(r?.error || 'não consegui iniciar a autoanálise')); run.disabled = false; run.textContent = 'Analisar'; }
    });
    return;
  }
  const mrg = e.target.closest('.act-self-merge');
  if (mrg) {
    const key = mrg.dataset.key;
    const ok = confirm(`Mergear ${key}?\n\nO Farol vai:\n• te atribuir ao PR se você ainda não estiver\n• fazer o merge (merge commit) na branch de destino\n• deletar a branch de origem se for descartável (feature/fix/task...), preservando develop/release/main\n\nIsso escreve no GitHub e não dá pra desfazer com um clique.`);
    if (!ok) return;
    mrg.disabled = true; mrg.textContent = 'Mergeando…';
    api('/api/self-review/merge', { url: mrg.dataset.url }).then(r => {
      if (r?.ok) return; // sucesso: o state push atualiza a tela
      if (r?.blocked === 'policy') {
        // a branch tem proteção; oferece as duas saídas no próprio card
        mergeBlockedByPolicy.add(key);
        renderMyPRs();
        toast('info', 'A branch de destino tem proteção. Escolha: Auto-merge (espera os requisitos) ou Merge (admin).', 6000);
        return;
      }
      toast('error', esc(r?.error || 'não consegui mergear'));
      mrg.disabled = false; mrg.textContent = 'Merge';
    });
    return;
  }
  const mAuto = e.target.closest('.act-merge-auto');
  if (mAuto) {
    const key = mAuto.dataset.key;
    mAuto.disabled = true; mAuto.textContent = 'Ativando…';
    api('/api/self-review/merge', { url: mAuto.dataset.url, mode: 'auto' }).then(r => {
      if (r?.ok) { mergeBlockedByPolicy.delete(key); autoUnavailableKeys.delete(key); renderMyPRs(); return; }
      if (r?.blocked === 'autoUnavailable') {
        // repo sem "Allow auto-merge": some com o botão auto, sobra o admin (o
        // servidor já mostrou o toast acionável). Mantém as opções visíveis.
        autoUnavailableKeys.add(key); mergeBlockedByPolicy.add(key); renderMyPRs(); return;
      }
      toast('error', esc(r?.error || 'não consegui ativar o auto-merge'));
      renderMyPRs();
    });
    return;
  }
  const mAdmin = e.target.closest('.act-merge-admin');
  if (mAdmin) {
    const key = mAdmin.dataset.key;
    const ok = confirm(`MERGE COMO ADMIN de ${key}\n\nIsso BYPASSA a proteção da branch e mergeia AGORA, ignorando revisões e checks obrigatórios. Só funciona se você for admin do repo.\n\nUse com consciência: você está passando por cima do gate de review do time.\n\nConfirmar merge como admin?`);
    if (!ok) return;
    mAdmin.disabled = true; mAdmin.textContent = 'Mergeando…';
    api('/api/self-review/merge', { url: mAdmin.dataset.url, mode: 'admin' }).then(r => {
      if (r?.ok) { mergeBlockedByPolicy.delete(key); return; } // state push atualiza
      if (r?.blocked === 'rule') {
        // ruleset não é furado por admin: esconde o botão (o servidor já avisou)
        adminUnavailableKeys.add(key); renderMyPRs(); return;
      }
      toast('error', esc(r?.error || 'não consegui mergear como admin'));
      mAdmin.disabled = false; mAdmin.textContent = 'Merge (admin)';
    });
    return;
  }
  const clr = e.target.closest('.act-self-clear');
  if (clr) api('/api/self-review/clear', { key: clr.dataset.key });
});

/* ---------- render: versão e atualização ---------- */
function renderUpdate() {
  const u = STATE.update;
  const box = $('#updateBox');
  if (!u) { box.textContent = 'Verificando…'; return; }
  const remote = u.channel === 'remote';
  const origin = remote
    ? `GitHub Releases (<code>${esc(u.repo || '')}</code>)`
    : (u.source ? `fonte em <code>${esc(u.source)}</code>` : '');
  const hasChannel = remote || !!u.source;
  box.classList.toggle('avail', !!u.available);
  box.classList.toggle('ok-state', !u.available && hasChannel);
  if (u.available) {
    box.innerHTML = `
      <span class="up-ver">v${esc(u.current)} → v${esc(u.sourceVersion)}</span>
      <span class="up-note">Atualização disponível ${remote ? 'nas ' + origin : 'na ' + origin}. O Farol ${remote ? 'baixa e instala, ' : ''}fecha e reabre sozinho, preservando estado e configurações.</span>
      <button id="btnUpdateNow" class="btn primary sm">Atualizar agora</button>`;
    $('#btnUpdateNow').onclick = async () => {
      if (!confirm(`Atualizar o Farol de v${u.current} para v${u.sourceVersion}? O app fecha e reabre sozinho.`)) return;
      const r = await api('/api/update', {});
      if (!r?.ok) toast('error', esc(r?.error || 'não consegui iniciar a atualização'));
    };
  } else if (hasChannel) {
    box.innerHTML = `
      <span class="up-ver">v${esc(u.current)}</span>
      <span class="up-note">Você está na versão mais recente (${origin}${u.sourceVersion ? ` também na v${esc(u.sourceVersion)}` : ''}). Última verificação ${fmtClock(u.checkedAt)}.</span>`;
  } else {
    box.innerHTML = `
      <span class="up-ver">v${esc(u.current)}</span>
      <span class="up-note">Nenhuma fonte de atualização nesta máquina. Configure <code>updateRepo</code> (releases do GitHub) ou <code>updateSource</code> (pasta) no config.json.</span>`;
  }
}

/* ---------- render: destaques ---------- */
async function loadHighlights() {
  const items = await get('/api/highlights') || [];
  const box = $('#highlights');
  if (!items.length) {
    box.innerHTML = `<div class="empty"><span class="big">🌱</span>Nenhum destaque registrado ainda.<br><small>Quando um review encontrar algo exemplar, ele entra aqui.</small></div>`;
    return;
  }
  box.innerHTML = items.map(h => `
    <div class="card hl-card">
      ${h.author ? avatar(h.author, 'sm') : ''}
      <div class="body">
        <div class="hl-head">
          ${h.author ? `<span class="author">@${esc(h.author)}</span>` : ''}
          ${h.ref ? `<a href="${esc(h.url)}" target="_blank" rel="noreferrer">${esc(h.ref)}</a>` : ''}
          <span>${esc(h.date || '')}</span>
        </div>
        <div class="hl-text">${esc(h.text)}</div>
      </div>
    </div>`).join('');
}

/* ---------- render: time ---------- */
async function loadTeam() {
  const team = await get('/api/team') || [];
  const box = $('#team');
  if (!team.length) {
    box.innerHTML = `<div class="empty"><span class="big">👋</span>Ainda não há memória de reviews.<br><small>A cada PR revisado, o Farol registra recorrências e ganhos por pessoa.</small></div>`;
    return;
  }
  box.innerHTML = team.map(m => {
    const last = m.entries[0];
    const verdictChip = last && last.verdict
      ? `<span class="verdict ${/approve/i.test(last.verdict) ? 'approve' : 'rc'}">${esc(last.verdict)}</span>` : '';
    const entries = m.entries.slice(0, 3).map(e => `
      <div class="entry">
        <div class="entry-head">${esc(e.date)} · ${esc(e.ref)} · ${esc(e.verdict)}</div>
        ${e.bullets.length ? `<ul>${e.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      </div>`).join('');
    return `
    <div class="card">
      <div class="member-head">
        ${avatar(m.login)}
        <div class="names">
          <div class="name">${esc(m.name)}</div>
          <div class="login">@${esc(m.login)} · ${m.entries.length} review(s) registrados</div>
        </div>
        ${verdictChip}
      </div>
      <div class="member-entries">${entries}</div>
    </div>`;
  }).join('');
}

/* ---------- render: sistema ---------- */
function renderDoctor() {
  const d = STATE && STATE.doctor;
  const box = $('#doctor');
  if (!d) { box.innerHTML = '<div class="empty">Verificando o ambiente…</div>'; return; }
  const isWin = (STATE.app?.platform || 'win32') === 'win32';
  const checks = [
    { ok: !!d.gh, label: 'GitHub CLI', detail: d.gh || 'gh não encontrado no PATH' },
    { ok: d.ghAuth, label: STATE.config.ghUser ? `Conta @${STATE.config.ghUser}` : 'Conta do GitHub', detail: d.ghAuth ? 'autenticada no gh' : 'sem token: rode gh auth login (conta de trabalho)' },
    { ok: !!d.claude, label: 'Claude Code', detail: d.claude || 'claude não encontrado no PATH' },
    // Git Bash é pré-requisito só no Windows (CLAUDE_CODE_GIT_BASH_PATH)
    ...(isWin ? [{ ok: !!d.gitBash, label: 'Git Bash', detail: d.gitBash || 'não encontrado: sessões do Claude podem travar' }] : []),
    { ok: true, label: 'Pasta de trabalho', detail: d.workspace }
  ];
  box.innerHTML = checks.map(c => `
    <div class="check ${c.ok ? 'ok' : 'bad'}">
      <span class="led"></span>
      <div><div class="label">${esc(c.label)}</div><div class="detail">${esc(c.detail)}</div></div>
    </div>`).join('');
  $('#about').innerHTML = `<b>Farol</b> v${esc(STATE.app.version)} · radar de Pull Requests<br>
    Dados e estado em <code>${esc(STATE.paths.home)}</code><br>
    O polling usa só o GitHub CLI (zero tokens de IA). O Claude entra apenas quando você abre uma revisão.`;
}

// Novidades por versão (mostradas na aba Sistema; a versão atual vem marcada).
// Ao cortar uma release, some uma linha aqui no topo.
const RELEASE_NOTES = [
  ['1.18.0', ['A autoanálise de um PR é descartada quando entra commit novo: o card volta a "não analisado", pra não mostrar veredito velho que já não vale', '"Merge (admin)" só aparece quando realmente resolve (some quando o repo usa ruleset que o admin não fura)', 'Times enterprise saíram do seletor de reviewers (o GitHub não os aceita como reviewer de PR)']],
  ['1.17.0', ['Reviewers por projeto agora é um seletor de pessoas e times da organização (chips), sem digitar handle na mão', 'Copiar o grupo de reviewers pra outros repos de uma vez ("copiar pra…")', 'Clicar em "Reviewers" num repo sem config leva pra tela de configuração, em vez de dar erro']],
  ['1.16.0', ['Instalador de arquivo único no Windows: um .exe, duplo clique instala e abre (sem extrair zip nem escolher arquivo)', 'Cada PR em "Meus PRs" mostra de qual branch pra qual branch vai (origem → destino)', 'Botão "Reviewers": configure os reviewers por projeto (Sistema) e, num clique, o Farol te atribui e pede review dessa lista']],
  ['1.15.0', ['Atualização automática: as cópias instaladas checam as releases do GitHub e se atualizam sozinhas (o update é leve, só troca os arquivos do app)']],
  ['1.14.0', ['Instalador offline: Windows (zip com Electron embutido, extrai e dá duplo clique) e macOS (arquivo único autoextraível). Sem Node, sem npm, sem download']],
  ['1.13.0', ['Auto-merge só é oferecido quando o repo tem "Allow auto-merge" ligado; senão sobra o Merge (admin), com aviso claro', 'Repo sem auto-merge deixou de poluir o log como erro (vira aviso)']],
  ['1.12.0', ['Aba Sistema mostra as novidades de cada versão (esta lista)']],
  ['1.11.0', ['Merge só fica disponível quando dá pra mergear de verdade (lê a mergeabilidade real do PR no GitHub)']],
  ['1.10.0', ['Quando a proteção de branch bloqueia, oferece Auto-merge (espera os requisitos) ou Merge como admin (bypassa, só se você for admin)']],
  ['1.9.0', ['Botão pra copiar um prompt de correção/melhoria a partir da revisão, pronto pra colar no chat']],
  ['1.8.0', ['Botão Merge nos Meus PRs aprováveis: só os seus, atribui você se preciso, deleta a branch descartável e respeita a lista de repos bloqueados']],
  ['1.7.0', ['Nível do agente (Opus/Sonnet) visível na análise', 'Fila de análise transparente: um por vez, com a posição de cada PR']]
];
function renderReleaseNotes() {
  const cur = (STATE.app && STATE.app.version) || '';
  $('#relNotes').innerHTML = RELEASE_NOTES.map(([v, items]) => `
    <div class="relnote">
      <div class="relnote-ver">v${esc(v)}${v === cur ? ' <span class="badge">atual</span>' : ''}</div>
      <ul class="dec-reasons">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
    </div>`).join('');
}

/* ---------- editor de reviewers por projeto ---------- */
let reviewerCands = { members: [], teams: [] };
let reviewerCandsLoaded = false;
const pendingRepoRows = new Set(); // repos com row aberto mas ainda sem reviewer
const copyOpenRepos = new Set();   // repos com o form "copiar pra..." aberto

async function loadReviewerCands(force) {
  if (reviewerCandsLoaded && !force) return;
  const r = await get('/api/reviewer-candidates');
  if (r) { reviewerCands = { members: r.members || [], teams: r.teams || [] }; reviewerCandsLoaded = true; }
  renderReviewersEditor();
}
function knownRepos() {
  const set = new Set();
  (STATE.myPRs || []).forEach(p => set.add(p.key.split('#')[0]));
  (STATE.panorama || []).forEach(p => set.add(String(p.key || '').split('#')[0]));
  Object.keys((STATE.config || {}).projectReviewers || {}).forEach(r => set.add(r));
  return [...set].filter(Boolean).sort();
}
function reviewerMap() {
  const cfg = (STATE.config || {}).projectReviewers || {};
  const map = {};
  for (const k of Object.keys(cfg)) map[k] = [...(cfg[k] || [])];
  for (const r of pendingRepoRows) if (!(r in map)) map[r] = [];
  return map;
}
function applyReviewers(map) {
  const clean = {};
  for (const k of Object.keys(map)) if ((map[k] || []).length) clean[k] = map[k];
  if (!STATE.config) STATE.config = {};
  STATE.config.projectReviewers = clean; // otimista, o SSE confirma depois
  renderReviewersEditor();
  api('/api/settings', { projectReviewers: clean });
}
function renderReviewersEditor() {
  const box = $('#reviewersEditor'); if (!box) return;
  const map = reviewerMap();
  const me = ((STATE.config || {}).ghUser || '').toLowerCase();
  const teamName = (id) => (reviewerCands.teams.find(t => t.id === id) || {}).name || id;
  const repos = Object.keys(map).sort();
  const rows = repos.map(repo => {
    const list = map[repo] || [];
    const chips = list.map(rv => {
      const isTeam = rv.includes('/');
      const ent = isTeam && rv.split('/').slice(1).join('/').includes(':'); // time enterprise: nao pedivel
      const label = ent ? `${rv.split('/').pop()} (enterprise, não pedível)` : (isTeam ? teamName(rv) + ' (time)' : rv);
      return `<span class="rev-chip${ent ? ' bad' : isTeam ? ' team' : ''}" ${ent ? 'title="Time enterprise não pode ser reviewer de PR (o GitHub recusa). Remova daqui."' : ''}>${esc(label)}<button class="rev-x" data-repo="${esc(repo)}" data-rv="${esc(rv)}" title="remover">×</button></span>`;
    }).join('');
    const has = (v) => list.some(l => l.toLowerCase() === String(v).toLowerCase());
    const opts = [
      ...reviewerCands.members.filter(x => x.toLowerCase() !== me && !has(x)).map(x => `<option value="${esc(x)}">${esc(x)}</option>`),
      ...reviewerCands.teams.filter(t => !has(t.id)).map(t => `<option value="${esc(t.id)}">${esc(t.name)} (time)</option>`)
    ].join('');
    const copyForm = copyOpenRepos.has(repo) ? `<div class="rev-copyform">
        <input class="rev-copytargets" data-repo="${esc(repo)}" list="revRepoList" placeholder="owner/repo, outro/repo" spellcheck="false">
        <button class="btn sm ok rev-copygo" data-repo="${esc(repo)}">Copiar grupo</button>
      </div>` : '';
    return `<div class="rev-row" data-repo="${esc(repo)}">
      <div class="rev-repohead"><code>${esc(repo)}</code>
        ${list.length ? `<button class="rev-copy" data-repo="${esc(repo)}" title="replicar estes reviewers em outros repos">copiar pra…</button>` : ''}
        <button class="rev-delrepo" data-repo="${esc(repo)}" title="remover este projeto">remover</button></div>
      <div class="rev-chips">${chips || '<span class="rev-empty">sem reviewers ainda</span>'}
        <select class="rev-add" data-repo="${esc(repo)}"><option value="">${reviewerCandsLoaded ? '+ adicionar…' : 'carregando…'}</option>${opts}</select>
      </div>
      ${copyForm}
    </div>`;
  }).join('');
  const dl = knownRepos().map(r => `<option value="${esc(r)}"></option>`).join('');
  box.innerHTML = `${rows || '<div class="rev-empty">Nenhum projeto configurado ainda. Adicione um abaixo.</div>'}
    <div class="rev-addrepo">
      <input id="revNewRepo" list="revRepoList" placeholder="owner/repo" spellcheck="false">
      <datalist id="revRepoList">${dl}</datalist>
      <button class="btn sm" id="revAddRepo">Adicionar projeto</button>
    </div>`;
}
$('#reviewersEditor').addEventListener('change', (e) => {
  const add = e.target.closest('.rev-add');
  if (add && add.value) {
    const repo = add.dataset.repo, map = reviewerMap();
    map[repo] = [...(map[repo] || []), add.value];
    applyReviewers(map);
  }
});
$('#reviewersEditor').addEventListener('click', (e) => {
  const x = e.target.closest('.rev-x');
  if (x) {
    const repo = x.dataset.repo, map = reviewerMap();
    map[repo] = (map[repo] || []).filter(r => r !== x.dataset.rv);
    if (!map[repo].length) pendingRepoRows.add(repo); // mantem a linha visivel
    applyReviewers(map);
    return;
  }
  const del = e.target.closest('.rev-delrepo');
  if (del) {
    const repo = del.dataset.repo, map = reviewerMap();
    delete map[repo]; pendingRepoRows.delete(repo); copyOpenRepos.delete(repo);
    applyReviewers(map);
    return;
  }
  const copy = e.target.closest('.rev-copy');
  if (copy) {
    const repo = copy.dataset.repo;
    if (copyOpenRepos.has(repo)) copyOpenRepos.delete(repo); else copyOpenRepos.add(repo);
    renderReviewersEditor();
    return;
  }
  const copyGo = e.target.closest('.rev-copygo');
  if (copyGo) {
    const repo = copyGo.dataset.repo, map = reviewerMap();
    const inp = document.querySelector(`.rev-copytargets[data-repo="${CSS.escape(repo)}"]`);
    const targets = String(inp && inp.value || '').split(/[,;]+/).map(s => s.trim()).filter(Boolean);
    const bad = targets.filter(t => !/^[^\s/]+\/[^\s/]+$/.test(t));
    if (!targets.length || bad.length) { toast('error', 'Informe os repos de destino no formato owner/repo, separados por vírgula.'); return; }
    const src = map[repo] || [];
    for (const t of targets) {
      if (t === repo) continue;
      const cur = map[t] || [];
      for (const rv of src) if (!cur.some(x => x.toLowerCase() === rv.toLowerCase())) cur.push(rv);
      map[t] = cur;
    }
    copyOpenRepos.delete(repo);
    applyReviewers(map);
    toast('ok', `Grupo de ${repo} copiado pra: ${targets.filter(t => t !== repo).join(', ')}.`, 4000);
    return;
  }
  const addRepo = e.target.closest('#revAddRepo');
  if (addRepo) {
    const inp = $('#revNewRepo'), repo = (inp.value || '').trim();
    if (!/^[^\s/]+\/[^\s/]+$/.test(repo)) { toast('error', 'Informe o repo no formato owner/repo.'); return; }
    pendingRepoRows.add(repo); inp.value = '';
    renderReviewersEditor();
    return;
  }
});

function renderSettings() {
  renderReleaseNotes();
  const c = STATE.config;
  const setIf = (el, val) => { if (document.activeElement !== el) el.value = val; };
  setIf($('#setUser'), c.ghUser);
  setIf($('#setOwners'), (c.owners || []).join(', '));
  setIf($('#setMergeBlocked'), (c.mergeBlockedRepos || []).join(', '));
  renderReviewersEditor();
  $('#setInterval').value = String(c.intervalSeconds);
  $('#setAutoReview').checked = !!c.autoReview;
  $('#setSkipPerms').checked = !!c.skipPermissions;
  $('#setSound').checked = !!c.soundEnabled;
  $('#setAutostart').checked = !!c.autostart;
  // autostart: só no Windows (no macOS o login item abriria o Electron sem o app)
  $('#rowAutostart').style.display = isElectron && !isMac ? '' : 'none';
}

/* ---------- ferramentas internas (kudos/diagnostico) ---------- */
let lastKudosOutput = '';
function stripFence(s) {
  return String(s || '').trim().replace(/^```[a-z]*\s*\r?\n/i, '').replace(/\r?\n```\s*$/, '').trim();
}
function renderTools() {
  const runs = STATE.toolRuns || {};
  const btnK = $('#btnKudos'), btnH = $('#btnHealth');

  const k = runs.kudos || {};
  btnK.disabled = k.status === 'running';
  btnK.innerHTML = k.status === 'running'
    ? '<span class="spin"></span> Gerando…'
    : '<svg viewBox="0 0 24 24"><path d="M12 3l1.9 4.6 4.9.4-3.7 3.2 1.1 4.8L12 13.5 7.8 16l1.1-4.8L5.2 8l4.9-.4L12 3z" fill="currentColor"/></svg> Gerar kudos com o Claude';
  const kp = $('#kudosPanel');
  kp.hidden = k.status !== 'done';
  if (k.status === 'done') {
    lastKudosOutput = stripFence(k.output);
    $('#kudosOut').innerHTML = md(lastKudosOutput);
    $('#kudosMeta').textContent = `gerado às ${fmtClock(k.finishedAt)} · pronto pra colar no canal`;
  }

  const h = runs.health || {};
  btnH.disabled = h.status === 'running';
  btnH.textContent = h.status === 'running' ? 'Diagnosticando…' : 'Diagnóstico com o Claude';
  const hp = $('#healthPanel');
  hp.hidden = h.status !== 'done';
  if (h.status === 'done') {
    $('#healthOut').innerHTML = md(stripFence(h.output));
    $('#healthMeta').textContent = `rodado às ${fmtClock(h.finishedAt)}`;
  }
}

$('#btnKudosCopy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(lastKudosOutput);
    toast('ok', 'Texto copiado. É só colar no canal.', 3000);
  } catch { toast('error', 'Não consegui copiar (permissão do navegador).'); }
};

/* limpar resultados de ferramenta: o painel some, nada além disso */
$('#btnKudosClear').onclick = async () => {
  const r = await api('/api/tool/clear', { name: 'kudos' });
  if (!r?.ok) toast('error', esc(r?.error || 'não consegui limpar'));
};
$('#btnHealthClear').onclick = async () => {
  const r = await api('/api/tool/clear', { name: 'health' });
  if (!r?.ok) toast('error', esc(r?.error || 'não consegui limpar'));
  else toast('ok', 'Diagnóstico limpo. O próximo parte do estado atual.', 3000);
};
$('#btnLogClear').onclick = async () => {
  if (!confirm('Zerar o log de falhas? Use quando os pontos levantados já foram tratados; o próximo diagnóstico parte do zero.')) return;
  const r = await api('/api/log/clear');
  if (!r?.ok) { toast('error', esc(r?.error || 'não consegui limpar o log')); return; }
  toast('ok', 'Log de falhas zerado.', 3000);
  loadLog();
};

async function loadLog() {
  const lines = await get('/api/log') || [];
  $('#logBox').textContent = lines.length ? lines.join('\n') : 'Nenhuma falha registrada. Bom sinal.';
  const box = $('#logBox');
  box.scrollTop = box.scrollHeight;
}

/* ---------- som + notificação ---------- */
let audioCtx = null;
function ping() {
  if (!STATE?.config?.soundEnabled) return;
  try {
    audioCtx = audioCtx || new AudioContext();
    const t = audioCtx.currentTime;
    [660, 880].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0, t + i * .12);
      g.gain.linearRampToValueAtTime(.08, t + i * .12 + .02);
      g.gain.exponentialRampToValueAtTime(.0001, t + i * .12 + .3);
      o.connect(g).connect(audioCtx.destination);
      o.start(t + i * .12); o.stop(t + i * .12 + .35);
    });
  } catch { /* sem audio, sem drama */ }
}

function notifyNewPRs(data) {
  ping();
  const n = data.items.length;
  const first = data.items[0];
  const title = data.auto
    ? (n === 1 ? 'PR novo, revisando sozinho' : `${n} PRs novos, revisando sozinho`)
    : (n === 1 ? `PR aguardando sua revisão` : `${n} PRs aguardando sua revisão`);
  const body = n === 1 ? `${first.key}: ${first.title}` : data.items.map(i => i.key).join('  ·  ');
  toast('info', `<b>${esc(title)}</b>&nbsp; ${esc(n === 1 ? first.key : '')}`);
  if (!isElectron && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      const notif = new Notification(`Farol · ${title}`, { body });
      notif.onclick = () => window.focus();
    } else if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }
}

/* ---------- ações ---------- */
$('#btnCheck').onclick = () => api('/api/check');
$('#btnReviewAll').onclick = () => api('/api/review');
$('#btnKudos').onclick = () => api('/api/tool', { name: 'kudos' });
$('#btnHealth').onclick = () => api('/api/tool', { name: 'health' });
$('#btnDoctor').onclick = async () => { await get('/api/doctor'); };
$('#btnUpdateCheck').onclick = async () => { await get('/api/doctor'); toast('ok', 'Verificação de atualização feita.', 2500); };
$('#btnLogRefresh').onclick = loadLog;

$('#panorama').addEventListener('click', (e) => {
  const btn = e.target.closest('.pano-review');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Revisando…';
  api('/api/review', { urls: [btn.dataset.url] });
});

$('#activeSessions').addEventListener('click', (e) => {
  const btn = e.target.closest('.act-cancel');
  if (!btn) return;
  btn.disabled = true;
  api('/api/cancel', { id: btn.dataset.id });
});

$('#queue').addEventListener('click', (e) => {
  const rev = e.target.closest('.act-review');
  if (rev) { api('/api/review', { urls: [rev.dataset.url] }); return; }
  const term = e.target.closest('.act-terminal');
  if (term) { api('/api/review', { urls: [term.dataset.url], mode: 'terminal' }); return; }
  const ign = e.target.closest('.act-ignore');
  if (ign) {
    const key = ign.dataset.key;
    api('/api/ignore', { key });
    const t = toast('info', `<span>${esc(key)} ignorado.</span><button class="undo">Desfazer</button>`, 8000);
    t.querySelector('.undo').onclick = () => { api('/api/restore', { key }); t.remove(); };
  }
});

$('#decisions').addEventListener('click', async (e) => {
  const btn = e.target.closest('.dec-act');
  if (!btn) return;
  const id = btn.closest('.decision').dataset.id;
  const action = btn.dataset.action;
  if (action === 'request_changes' && !confirm('Postar REQUEST CHANGES neste PR?')) return;
  btn.disabled = true;
  const r = await api('/api/decide', { id, action });
  if (!r?.ok) btn.disabled = false;
});

/* configurações: aplica na mudança */
const settingsMap = [
  ['#setUser', 'ghUser', el => el.value],
  ['#setOwners', 'owners', el => el.value],
  ['#setMergeBlocked', 'mergeBlockedRepos', el => el.value],
  ['#setInterval', 'intervalSeconds', el => parseInt(el.value, 10)],
  ['#setAutoReview', 'autoReview', el => el.checked],
  ['#setSkipPerms', 'skipPermissions', el => el.checked],
  ['#setSound', 'soundEnabled', el => el.checked],
  ['#setAutostart', 'autostart', el => el.checked]
];
for (const [sel, key, read] of settingsMap) {
  $(sel).addEventListener('change', async (e) => {
    await api('/api/settings', { [key]: read(e.target) });
    toast('ok', 'Configuração salva.', 2500);
  });
}

/* ---------- SSE ---------- */
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('state', (e) => {
    STATE = JSON.parse(e.data);
    renderStatus(); renderActive(); renderDecisions(); renderQueue(); renderMyPRs(); renderPanorama(); renderSettings(); renderTools(); renderUpdate(); tickCountdown();
    if ($('#tab-sistema').classList.contains('active')) renderDoctor();
  });
  es.addEventListener('activity', (e) => {
    const { id, item } = JSON.parse(e.data);
    if (STATE?.activity) (STATE.activity[id] = STATE.activity[id] || []).push(item);
    const feed = document.querySelector(`.activity-feed[data-id="${CSS.escape(id)}"]`);
    if (feed) {
      const stick = feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 30;
      feed.insertAdjacentHTML('beforeend', feedLine(item));
      if (stick) feed.scrollTop = feed.scrollHeight;
    }
  });
  es.addEventListener('chat', (e) => {
    const c = JSON.parse(e.data);
    if (chatKey && c.key === chatKey) renderChat(c);
  });
  es.addEventListener('chat-activity', (e) => {
    const { key, text } = JSON.parse(e.data);
    if (chatKey && key === chatKey) {
      const el = $('#chatActivity');
      el.hidden = false;
      el.textContent = text;
    }
  });
  es.addEventListener('toast', (e) => {
    const t = JSON.parse(e.data);
    toast(t.kind || 'info', esc(t.text));
  });
  es.addEventListener('new-prs', (e) => notifyNewPRs(JSON.parse(e.data)));
  es.addEventListener('auto-approved', () => ping());
  es.addEventListener('needs-decision', (e) => {
    ping();
    const { pr, item } = JSON.parse(e.data);
    if (!isElectron && 'Notification' in window && Notification.permission === 'granted') {
      const n = new Notification('Farol · precisa de você', { body: `${pr.key}: ${(item.reasons || [])[0] || 'ver relatório'}` });
      n.onclick = () => window.focus();
    }
  });
  es.onerror = () => {
    $('#statusPill').className = 'pill err';
    $('#statusPill').textContent = 'reconectando…';
  };
}
connect();
