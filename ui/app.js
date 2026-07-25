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

/* ---------- camada de contas (separação por identidade) ---------- */
let SCOPE = localStorage.getItem('farol-scope') || 'all';   // 'all' ou o login de uma conta
let silencedOpen = false;
let CURRENT_TAB = 'radar';   // a barra de contas só filtra o Radar; nas outras abas fica escondida
const TWEAK = {
  muted: localStorage.getItem('farol-muted-handling') || 'Recolher',   // Recolher | Esmaecer | Ocultar
  ident: localStorage.getItem('farol-identity-style') || 'Barra + etiqueta', // Barra + etiqueta | Só barra | Só ponto
};
let ACCT = {};        // user(lower) -> metadados da conta
let OWNER2USER = {};  // owner/org(lower) -> user dono
function hexToRgba(hex, a) {
  const m = String(hex || '').replace('#', '');
  if (m.length !== 6) return `rgba(255,180,84,${a})`;
  const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function rebuildAccounts() {
  ACCT = {}; OWNER2USER = {};
  const list = (STATE && STATE.accounts) || [];
  list.forEach((a, i) => {
    const color = a.color || '#ffb454';
    ACCT[String(a.user).toLowerCase()] = {
      user: a.user, label: a.label || a.user, org: (a.owners || [])[0] || '',
      kind: a.kind || '', color, soft: hexToRgba(color, .16), ink: '#0b0e14',
      muted: !!a.muted, primary: !!a.primary, tokenOk: !!a.tokenOk, owners: a.owners || [], idx: i
    };
    (a.owners || []).forEach(o => { OWNER2USER[String(o).toLowerCase()] = a.user; });
  });
}
function multiAccount() { return ((STATE && STATE.accounts) || []).length > 1; }
function prUser(pr) {
  if (pr && pr.account) return pr.account;
  const repo = (pr && (pr.repo || (pr.key || '').split('#')[0])) || '';
  const owner = repo.split('/')[0].toLowerCase();
  return OWNER2USER[owner] || '';
}
function acctOf(pr) { return ACCT[String(prUser(pr)).toLowerCase()] || null; }
function isMutedPr(pr) { const a = acctOf(pr); return !!(a && a.muted); }
// item visível no escopo atual (respeitando o tratamento de silenciadas)
function scopeVisible(pr) {
  if (SCOPE === 'all') { if (isMutedPr(pr)) return TWEAK.muted === 'Esmaecer'; return true; }
  return String(prUser(pr)).toLowerCase() === String(SCOPE).toLowerCase();
}
function dimmedPr(pr) { return SCOPE === 'all' && isMutedPr(pr) && TWEAK.muted === 'Esmaecer'; }
// marcador de conta pra um card: estilo (var --ac + barra + esmaecido), chip e ponto
function acctMark(pr, opts) {
  opts = opts || {};
  const a = acctOf(pr);
  const all = SCOPE === 'all';
  const multi = multiAccount();
  const showBar = TWEAK.ident !== 'Só ponto' && multi && !opts.noBar;
  const showChip = TWEAK.ident === 'Barra + etiqueta' && all && multi;
  const showDot = TWEAK.ident === 'Só ponto' && all && multi;
  const varStyle = a ? `--ac:${a.color};--ac-soft:${a.soft};--ac-ink:${a.ink};` : '';
  const dim = dimmedPr(pr) ? 'opacity:.55;' : '';
  const barStyle = (showBar && a) ? `border-left:3px solid ${a.color};` : '';
  const chip = (showChip && a) ? `<span class="acct-chip">${esc(a.label)}</span>` : '';
  const dot = (showDot && a) ? `<span class="acct-dot"></span>` : '';
  return { style: varStyle + dim + barStyle, varStyle, dim, chip, dot, acct: a };
}
// filtra itens que carregam account; itens sem account (dados legados) sempre passam
function scopeItemVisible(it) {
  if (!it || !it.account) return true;
  return scopeVisible(it);
}

/* ---- atribuição de conta pra memória (Destaques/Time) ---- */
function ownerFromUrl(url) { const m = String(url || '').match(/github\.com\/([^\/]+)\//i); return m ? m[1] : ''; }
function acctUserFromUrl(url) { return OWNER2USER[ownerFromUrl(url).toLowerCase()] || ''; }
// entrada de memória sem conta (dados antigos) só aparece na visão Todas (grupo "Geral")
function scopeMemVisible(user) {
  if (!user) return SCOPE === 'all';
  if (SCOPE === 'all') { const a = ACCT[user.toLowerCase()]; if (a && a.muted) return TWEAK.muted === 'Esmaecer'; return true; }
  return String(user).toLowerCase() === String(SCOPE).toLowerCase();
}
function acctStyleFor(user) { const a = ACCT[String(user || '').toLowerCase()]; return a ? `--ac:${a.color};--ac-soft:${a.soft};` : '--ac:var(--muted);'; }
function memGroupHead(user) {
  const a = ACCT[String(user || '').toLowerCase()];
  const label = a ? (a.label || a.user) : 'Geral';
  const color = a ? a.color : 'var(--muted)';
  const sub = a ? (a.org || '') : 'sem conta atribuída';
  return `<div class="group-head" style="--ac:${color}"><span class="g-dot"></span>${esc(label)}${sub ? `<span class="g-sub">· ${esc(sub)}</span>` : ''}</div>`;
}

// PRs que pedem sua atenção numa conta (fila + decisões pendentes)
function attentionCount(user) {
  const u = String(user).toLowerCase();
  const q = (STATE.queue || []).filter(p => String(prUser(p)).toLowerCase() === u).length;
  const d = (STATE.decisions?.pending || []).filter(p => String(prUser(p)).toLowerCase() === u).length;
  return q + d;
}

/* ---------- render: barra de contas ---------- */
function renderAccountBar() {
  const bar = $('#accountBar');
  const accounts = (STATE.accounts || []);
  // aparece em Radar, Destaques e Time (todas filtram/agrupam por conta); só o
  // Sistema é global, então lá fica escondida.
  if (accounts.length < 2 || CURRENT_TAB === 'sistema') { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  const all = SCOPE === 'all';
  const totalAtt = accounts.filter(a => !a.muted).reduce((n, a) => n + attentionCount(a.user), 0);
  const segAll = `<button class="acct-seg ${all ? 'active' : ''}" data-scope="all" title="Ver todas as contas"
      style="${all ? '--seg-bg:var(--surface-2);--seg-fg:var(--text);--seg-badge-bg:var(--accent-soft);--seg-badge-fg:var(--accent);' : ''}">Todas${totalAtt ? `<span class="seg-count">${totalAtt}</span>` : ''}</button>`;
  const segs = accounts.map(a => {
    const meta = ACCT[a.user.toLowerCase()] || {};
    const active = String(SCOPE).toLowerCase() === a.user.toLowerCase();
    const att = a.muted ? 0 : attentionCount(a.user);
    const style = `--ac:${meta.color};` + (active ? `--seg-bg:${meta.soft};--seg-fg:${meta.color};--seg-badge-bg:${meta.color};--seg-badge-fg:${meta.ink};` : '');
    return `<button class="acct-seg ${active ? 'active' : ''} ${a.muted ? 'muted' : ''}" data-scope="${esc(a.user)}"
        title="@${esc(a.user)}${meta.org ? ' · ' + esc(meta.org) : ''}${a.muted ? ' (silenciada)' : ''}" style="${style}">
        <span class="seg-dot"></span>${esc(meta.label || a.user)}${a.muted ? '<span class="seg-pause">⏸</span>' : (att ? `<span class="seg-count">${att}</span>` : '')}</button>`;
  }).join('');
  bar.innerHTML = segAll + segs;
}

/* ---------- render: faixa de identidade ---------- */
function renderIdentity() {
  const strip = $('#identityStrip');
  const accounts = (STATE.accounts || []);
  if (accounts.length < 2) { strip.hidden = true; strip.removeAttribute('style'); return; }
  strip.hidden = false;
  if (SCOPE === 'all') {
    const mon = accounts.filter(a => !a.muted);
    const jobs = mon.filter(a => /trab/i.test(a.kind || '')).length;
    const pers = mon.filter(a => /pessoal/i.test(a.kind || '')).length;
    const nMuted = accounts.filter(a => a.muted).length;
    const parts = [`${mon.length} ${mon.length === 1 ? 'conta monitorada' : 'contas monitoradas'}`];
    if (jobs) parts.push(`${jobs} de trabalho`);
    if (pers) parts.push(`${pers} pessoal`);
    if (nMuted) parts.push(`${nMuted} silenciada${nMuted > 1 ? 's' : ''}`);
    strip.className = 'identity-strip all';
    strip.removeAttribute('style');
    strip.innerHTML = `<div class="id-body"><span class="id-summary">${esc(parts.join(' · '))}</span></div>`;
  } else {
    const a = accounts.find(x => x.user.toLowerCase() === String(SCOPE).toLowerCase());
    if (!a) { strip.hidden = true; return; }
    const meta = ACCT[a.user.toLowerCase()] || {};
    strip.className = 'identity-strip one';
    strip.style.cssText = `--ac:${meta.color};--ac-soft:${meta.soft};--ac-ink:${meta.ink};`;
    strip.innerHTML = `<span class="id-avatar">${esc((meta.label || a.user).charAt(0).toUpperCase())}</span>
      <div class="id-body"><div class="id-line">Revisando e postando como <span class="id-handle">@${esc(a.user)}</span> ${meta.org ? `<span class="id-org">· ${esc(meta.org)}</span>` : ''}</div></div>
      ${meta.kind ? `<span class="id-tag">${esc(meta.kind)}</span>` : ''}${a.muted ? '<span class="id-tag">silenciada</span>' : ''}`;
  }
}

/* ---------- render: contas silenciadas (resumo recolhido) ---------- */
function renderSilenced() {
  const box = $('#silenced');
  const accounts = (STATE.accounts || []);
  const mutedAccts = accounts.filter(a => a.muted);
  const items = (STATE.panorama || []).filter(pr => isMutedPr(pr));
  const show = SCOPE === 'all' && TWEAK.muted === 'Recolher' && mutedAccts.length > 0 && items.length > 0;
  if (!show) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  const names = mutedAccts.map(a => (ACCT[a.user.toLowerCase()] || {}).label || a.user).join(', ');
  const head = `<div class="sil-head"><span class="sil-icon">🔕</span>
      <span>${items.length} ${items.length === 1 ? 'item silenciado' : 'itens silenciados'} · ${esc(names)}</span>
      <button class="sil-toggle">${silencedOpen ? 'ocultar' : 'ver'}</button></div>`;
  const body = silencedOpen ? `<div class="sil-items">${items.map(pr => {
    const meta = acctOf(pr) || {};
    return `<div class="card pr-card" style="--ac:${meta.color || 'var(--accent)'};--ac-soft:${meta.soft || 'var(--accent-soft)'};border-left:3px solid ${meta.color || 'var(--accent)'};opacity:.85;">
      <div class="info">
        <div class="pr-ref"><a href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.key)}</a> <span class="acct-chip">${esc(meta.label || '')}</span></div>
        <div class="pr-title" title="${esc(pr.title)}">${esc(pr.title)}</div>
        <div class="pr-sub"><span class="author">@${esc(pr.author)}</span> · ${fmtRel(pr.updatedAt)}</div>
      </div></div>`;
  }).join('')}</div>` : '';
  box.innerHTML = head + body;
}

/* ---------- render: gerenciador de contas (Sistema) ---------- */
function renderAccountsManager() {
  const box = $('#accountsManager');
  if (!box) return;
  const accounts = (STATE.accounts || []);
  if (!accounts.length) { box.innerHTML = '<div class="empty">Nenhuma conta configurada.</div>'; return; }
  const multi = accounts.length > 1;
  box.innerHTML = accounts.map(a => {
    const meta = ACCT[a.user.toLowerCase()] || {};
    const style = `--ac:${meta.color};--ac-soft:${meta.soft};--ac-ink:${meta.ink};`;
    const auth = a.muted ? 'silenciada: token preservado, fora dos avisos e da auto-revisão' : (a.tokenOk ? 'autenticada no gh' : 'sem token: rode gh auth login');
    return `<div class="card acct-card ${a.muted ? 'muted' : ''}" style="${style}">
      <span class="a-avatar">${esc((meta.label || a.user).charAt(0).toUpperCase())}</span>
      <div class="a-body">
        <div class="a-name">${esc(meta.label || a.user)}
          ${meta.kind ? `<span class="a-kind">${esc(meta.kind)}</span>` : ''}
          ${a.primary ? '<span class="a-tag">primária</span>' : ''}
          ${a.muted ? '<span class="a-tag">silenciada</span>' : ''}</div>
        <div class="a-sub"><span class="a-auth">@${esc(a.user)}</span> · ${esc((a.owners || []).join(', ') || 'sem org')} · ${esc(auth)}</div>
      </div>
      ${multi ? `<div class="pr-actions"><button class="btn sm ${a.muted ? 'ok' : 'ghost'} act-mute" data-user="${esc(a.user)}">${a.muted ? 'Reativar' : 'Silenciar'}</button></div>` : ''}
    </div>`;
  }).join('');
}

// re-render das seções sensíveis ao escopo (sem esperar novo state do engine)
function rerenderScope() {
  if (!STATE) return;
  renderAccountBar(); renderIdentity();
  renderActive(); renderDecisions(); renderQueue(); renderMyPRs(); renderPanorama(); renderSilenced();
  if ($('#tab-destaques').classList.contains('active')) loadHighlights();
  if ($('#tab-time').classList.contains('active')) loadTeam();
}

/* trocar de conta na barra */
$('#accountBar').addEventListener('click', (e) => {
  const seg = e.target.closest('.acct-seg');
  if (!seg) return;
  SCOPE = seg.dataset.scope;
  localStorage.setItem('farol-scope', SCOPE);
  silencedOpen = false;
  rerenderScope();
});
/* abrir/fechar o resumo de silenciadas */
$('#silenced').addEventListener('click', (e) => {
  if (e.target.closest('.sil-toggle')) { silencedOpen = !silencedOpen; renderSilenced(); }
});
/* silenciar / reativar conta */
$('#accountsManager').addEventListener('click', (e) => {
  const btn = e.target.closest('.act-mute');
  if (!btn) return;
  const user = btn.dataset.user;
  const accounts = (STATE.accounts || []).map(a => ({
    user: a.user, owners: a.owners, label: a.label, color: a.color, kind: a.kind,
    muted: a.user === user ? !a.muted : !!a.muted
  }));
  btn.disabled = true; btn.textContent = '…';
  api('/api/settings', { accounts }).then(() => {
    // se a conta silenciada era o escopo atual, volta pra Todas
    if (String(SCOPE).toLowerCase() === String(user).toLowerCase() && accounts.find(a => a.user === user)?.muted) {
      SCOPE = 'all'; localStorage.setItem('farol-scope', 'all');
    }
    // o pushState do engine re-renderiza; toast de confirmação
    toast('ok', 'Conta atualizada.', 2500);
  });
});

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

/* ---------- navegação ---------- */
const TAB_TITLES = { radar: 'Radar', destaques: 'Destaques', time: 'Time', sistema: 'Sistema' };
function switchTab(name) {
  CURRENT_TAB = name;
  document.querySelectorAll('.nav-item').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  const title = $('#pageTitle'); if (title) title.textContent = TAB_TITLES[name] || 'Farol';
  if (STATE) renderAccountBar();   // mostra/esconde a barra de contas conforme a aba
  if (name === 'destaques') loadHighlights();
  if (name === 'time') loadTeam();
  if (name === 'sistema') { loadLog(); renderDoctor(); renderAccountsManager(); loadReviewerCands(); }
}
$('#nav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
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
  const pending = (STATE.decisions?.pending || []).filter(scopeVisible);
  const wrap = $('#decisionsWrap');
  wrap.hidden = pending.length === 0;
  $('#decisionsCount').textContent = pending.length;
  if (!pending.length) { $('#decisions').innerHTML = ''; renderResolved(); return; }
  $('#decisions').innerHTML = pending.map(d => {
    const m = acctMark(d);
    const author = (d.pr && d.pr.author) || d.author || '';
    return `
    <div class="card decision" data-id="${esc(d.id)}" style="${m.style}">
      <div class="decision-head">
        <span class="verdict ${d.verdict === 'approve' ? 'approve' : 'rc'}">${d.verdict === 'approve' ? 'APROVÁVEL' : 'COM BLOCKER'}</span>
        <a class="dec-ref" href="${esc(d.pr?.url || '#')}" target="_blank" rel="noreferrer">${esc(d.key)}</a>
        ${m.chip}
        ${d.card ? `<span class="pill">${esc(d.card)}</span>` : '<span class="pill">sem card</span>'}
        <span class="dec-when">${fmtClock(d.createdAt)}</span>
      </div>
      ${d.pr?.title ? `<div class="dec-title">${esc(d.pr.title)}</div>` : ''}
      ${author ? `<div class="dec-author">PR de <b>@${esc(author)}</b></div>` : ''}
      ${(d.reasons || []).length ? `<ul class="dec-reasons">${d.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
      <details class="dec-report"><summary>Ver relatório completo</summary><div class="report">${md(d.reportMarkdown)}</div></details>
      <div class="dec-actions">
        <button class="btn primary sm dec-act" data-action="approve">Aprovar</button>
        <button class="btn sm dec-act dec-rc" data-action="request_changes">Pedir mudanças</button>
        <button class="btn sm dec-act" data-action="comment">Só comentar</button>
        <button class="btn sm act-chat" data-key="${esc(d.key)}" data-url="${esc(d.pr?.url || '')}">💬 Conversar${chatBadge(d.key)}</button>
        <button class="btn sm ghost dec-act" data-action="skip">Pular</button>
      </div>
    </div>`;
  }).join('');
  renderResolved();
}

function renderResolved() {
  const resolved = (STATE.decisions?.resolved || []).filter(scopeVisible);
  const wrap = $('#resolvedWrap');
  wrap.hidden = resolved.length === 0;
  if (!resolved.length) { $('#resolved').innerHTML = ''; return; }
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
    // pontos de atenção de um PR aprovado sozinho: ficam claros aqui (expansível)
    const attn = (r.attention && r.attention.length) ? r.attention : (r.status === 'auto_approved' ? (r.reasons || []) : []);
    const hasAttn = attn.length > 0;
    const attnHtml = hasAttn
      ? `<details class="resolved-attn"><summary>⚠ ${attn.length} ponto${attn.length > 1 ? 's' : ''} de atenção</summary><ul class="dec-reasons">${attn.map(p => `<li>${esc(p)}</li>`).join('')}</ul></details>`
      : '';
    return `<div class="row ${hasAttn ? 'has-attn' : ''}">
      <span>${icon}</span>
      <span class="ref"><a href="${esc(r.pr?.url || '#')}" target="_blank" rel="noreferrer">${esc(r.key)}</a></span>
      <span class="title">${label}${act}${r.card ? ` · ${esc(r.card)}` : ''}${attnHtml}</span>
      <button class="btn sm ghost act-chat" data-key="${esc(r.key)}" data-url="${esc(r.pr?.url || '')}">💬${chatBadge(r.key)}</button>
      <span class="when">${fmtClock(r.resolvedAt)}</span>
    </div>`;
  }).join('');
}

/* ---------- render: radar ---------- */
function renderQueue() {
  const q = (STATE.queue || []).filter(scopeVisible);
  $('#queueCount').hidden = q.length === 0;
  $('#queueCount').textContent = q.length;
  const btnAll = $('#btnReviewAll');
  btnAll.hidden = q.length < 2;
  btnAll.textContent = `Revisar tudo (${q.length})`;

  const box = $('#queue');
  if (!q.length) {
    const msg = SCOPE === 'all' ? 'Tudo em dia. Nenhum PR esperando por você.' : 'Tudo em dia nesta conta. Nenhum PR esperando por você.';
    box.innerHTML = `<div class="empty"><span class="big">✨</span>${msg}<br><small>Quando pedirem sua revisão, o card aparece aqui e você recebe um aviso.</small></div>`;
    return;
  }
  box.innerHTML = q.map(pr => {
    const m = acctMark(pr);
    return `
    <div class="card pr-card" data-key="${esc(pr.key)}" style="${m.style}">
      ${m.dot}${avatar(pr.author)}
      <div class="info">
        <div class="pr-ref"><a href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.key)}</a>${m.chip}</div>
        <div class="pr-title" title="${esc(pr.title)}">${esc(pr.title)}</div>
        <div class="pr-sub"><span class="author">@${esc(pr.author)}</span> · atualizado ${fmtRel(pr.updatedAt)}</div>
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
    </div>`;
  }).join('');
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
  const list = (STATE.panorama || []).filter(scopeVisible);
  $('#panoCount').hidden = list.length === 0;
  $('#panoCount').textContent = list.length;
  $('#panoOwners').textContent = list.length ? 'PRs abertos, os seus destacados' : '';
  const box = $('#panorama');
  if (!list.length) {
    box.style.display = 'block';
    box.innerHTML = `<div class="empty" style="border:0">Nenhum PR aberto ${SCOPE === 'all' ? 'nas organizações monitoradas' : 'nesta conta'}.</div>`;
    return;
  }
  box.style.display = '';
  const busy = new Set([].concat(...(STATE.activeSessions || []).map(s => s.keys || [])).concat(STATE.headlessWaiting || []));
  box.innerHTML = list.map(pr => {
    const chip = reviewChip(pr);
    const m = acctMark(pr, { noBar: true });
    // estado da SUA revisão: aprovado/mudanças pedidas = resolvido (sem botão de
    // re-revisar); pendente = já na fila de decisão; senão, dá pra revisar.
    const ra = (STATE.reviewActions || {})[pr.key];
    const kind = ra ? ra.kind : (pr.reviewedByMe ? 'approve' : null);
    const reviewed = kind === 'approve' || kind === 'request_changes';
    const isPending = kind === 'pending';
    // stale = você revisou e entrou commit novo depois: o "Re-revisar" volta a valer
    const stale = reviewed && !!(STATE.staleStates || {})[pr.key];
    const showBtn = (!reviewed || stale) && !isPending && !busy.has(pr.key);
    const settledLabel = kind === 'request_changes' ? 'aguardando o autor' : isPending ? 'aguardando você' : reviewed ? 'nada a fazer' : '';
    const tail = busy.has(pr.key)
      ? '<button class="btn sm ghost pano-review" disabled>Revisando…</button>'
      : showBtn
        ? `<button class="btn sm ghost act-review pano-review" data-url="${esc(pr.url)}" title="${stale ? 'Entrou commit novo depois da sua review: revisar de novo' : pr.mine ? 'Revisar (seu review pedido)' : 'Revisar sob demanda: o resultado sempre passa por você, nada é postado sozinho'}">${stale ? 'Re-revisar' : 'Revisar'}</button>`
        : `<span class="settled">${esc(settledLabel)}</span>`;
    return `
    <div class="row ${pr.mine ? 'mine' : ''} ${chip ? 'reviewed' : ''}" style="${m.varStyle}${m.dim}">
      <span class="status-dot"></span>
      <span class="ref"><a href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.key)}</a></span>
      ${SCOPE === 'all' && m.chip ? m.chip : (pr.mine ? '<span class="badge">sua revisão</span>' : '')}
      ${chip}
      <span class="title" title="${esc(pr.title)}">${esc(pr.title)}</span>
      <span class="who">@${esc(pr.author)}</span>
      ${tail}
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
  const list = (STATE.myPRs || []).filter(scopeVisible);
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
    const m = acctMark(pr, { noBar: !!a });
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
    <div class="card mypr-card ${a ? (a.approvable ? 'ok' : 'warn') : ''}" data-key="${esc(pr.key)}" style="${m.style}">
      <div class="mypr-top">
        ${m.dot}${avatar(pr.author)}
        <div class="info">
          <div class="pr-ref"><a href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.key)}</a>
            ${pr.isDraft ? '<span class="badge">rascunho</span>' : ''}${badge}${m.chip}</div>
          <div class="pr-title" title="${esc(pr.title)}">${esc(pr.title)}</div>
          ${pr.head && pr.base ? `<div class="pr-branches"><code>${esc(pr.head)}</code> <span class="arrow">→</span> <code>${esc(pr.base)}</code></div>` : ''}
          <div class="pr-sub">${m.acct ? `por você · <span class="author">@${esc(m.acct.user)}</span> · ` : ''}atualizado ${fmtRel(pr.updatedAt)}</div>
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
    const org = repo.split('/')[0];
    // efetivo = exceção do repo, senão o padrão da org
    const eff = overrideFor(repo) || defaultFor(org);
    // sem reviewers (nem exceção nem padrão): leva pra tela de config
    if (!eff || !eff.length) {
      switchTab('sistema');
      loadReviewerCands();
      renderReviewersEditor();
      setTimeout(() => { const el = $('#reviewersEditor'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
      toast('info', `Defina os reviewers padrão de ${org} (ou uma exceção pra ${repoShort(repo)}) aqui, depois é só clicar em Reviewers no PR.`, 7000);
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
  // não deu pra ler a release (repo privado/sem acesso, sem release ainda, ou rede):
  // sourceVersion nulo + note. Não é "está na mais recente", é falta de acesso.
  const noAccess = hasChannel && !u.available && !u.sourceVersion && !!u.note;
  box.classList.toggle('avail', !!u.available);
  box.classList.toggle('ok-state', !u.available && hasChannel && !noAccess);
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
  } else if (noAccess) {
    box.innerHTML = `
      <span class="up-ver">v${esc(u.current)}</span>
      <span class="up-note">Não consegui ler as releases em ${origin} (${esc(u.note || 'sem acesso')}). Se o repo for privado, a conta primária do gh precisa ter acesso a ele (ou torne o repo público). Última verificação ${fmtClock(u.checkedAt)}.</span>`;
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

/* ---------- render: destaques (separado por conta) ---------- */
async function loadHighlights() {
  const items = (await get('/api/highlights')) || [];
  const box = $('#highlights');
  const tagged = items.map(h => ({ ...h, _user: acctUserFromUrl(h.url) }));
  const visible = tagged.filter(h => scopeMemVisible(h._user));
  if (!visible.length) {
    box.innerHTML = `<div class="empty"><span class="big">🌱</span>${SCOPE === 'all' ? 'Nenhum destaque registrado ainda.' : 'Nenhum destaque nesta conta ainda.'}<br><small>Quando um review encontrar algo exemplar, ele entra aqui.</small></div>`;
    return;
  }
  const multi = multiAccount();
  const card = h => `
    <div class="card hl-card" style="${multi ? acctStyleFor(h._user) : ''}">
      ${h.author ? avatar(h.author, 'sm') : ''}
      <div class="body">
        <div class="hl-head">
          ${h.author ? `<span class="author">@${esc(h.author)}</span>` : ''}
          ${h.ref ? `<a href="${esc(h.url)}" target="_blank" rel="noreferrer">${esc(h.ref)}</a>` : ''}
          <span>${esc(h.date || '')}</span>
          ${SCOPE === 'all' && multi && h._user ? `<span class="acct-chip">${esc((ACCT[h._user.toLowerCase()] || {}).label || h._user)}</span>` : ''}
        </div>
        <div class="hl-text">${esc(h.text)}</div>
      </div>
    </div>`;
  if (SCOPE === 'all' && multi) {
    const parts = [];
    for (const a of (STATE.accounts || [])) {
      const list = visible.filter(h => h._user && h._user.toLowerCase() === a.user.toLowerCase());
      if (list.length) { parts.push(memGroupHead(a.user)); parts.push(list.map(card).join('')); }
    }
    const geral = visible.filter(h => !h._user);
    if (geral.length) { parts.push(memGroupHead('')); parts.push(geral.map(card).join('')); }
    box.innerHTML = parts.join('');
  } else {
    box.innerHTML = visible.map(card).join('');
  }
}

/* ---------- render: time (separado por conta) ---------- */
async function loadTeam() {
  const team = (await get('/api/team')) || [];
  const box = $('#team');
  const multi = multiAccount();
  // conta de uma entrada: pelo owner do ref (owner/repo#num); antigo (só nome) = sem conta
  const entryUser = e => { const ref = e.ref || ''; const owner = ref.includes('/') ? ref.split('/')[0] : ''; return owner ? (OWNER2USER[owner.toLowerCase()] || '') : ''; };
  const refShort = ref => (ref.includes('/') ? ref.split('/').slice(1).join('/') : ref);
  const memberCard = (m, entries, user) => {
    const last = entries[0];
    const verdictChip = last && last.verdict ? `<span class="verdict ${/approve/i.test(last.verdict) ? 'approve' : 'rc'}">${esc(last.verdict)}</span>` : '';
    const es = entries.slice(0, 3).map(e => `
      <div class="entry">
        <div class="entry-head">${esc(e.date)} · ${esc(refShort(e.ref))} · ${esc(e.verdict)}</div>
        ${e.bullets.length ? `<ul>${e.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      </div>`).join('');
    return `
    <div class="card ${multi ? 'member-card' : ''}" style="${multi ? acctStyleFor(user) : ''}">
      <div class="member-head">
        ${avatar(m.login)}
        <div class="names">
          <div class="name">${esc(m.name)}</div>
          <div class="login">@${esc(m.login)} · ${entries.length} review(s) registrados</div>
        </div>
        ${verdictChip}
      </div>
      <div class="member-entries">${es}</div>
    </div>`;
  };
  // membros com entradas visíveis pro grupo pedido ('__all__' = todas; '' = sem conta)
  const groupCards = (user) => {
    const out = [];
    for (const m of team) {
      const es = (m.entries || []).filter(e => { const u = entryUser(e); return user === '__all__' ? true : (user ? u.toLowerCase() === user.toLowerCase() : !u); });
      if (es.length) out.push(memberCard(m, es, user === '__all__' ? entryUser(es[0]) : user));
    }
    return out;
  };
  const emptyMsg = `<div class="empty"><span class="big">👋</span>${SCOPE === 'all' ? 'Ainda não há memória de reviews.' : 'Nenhuma memória nesta conta ainda.'}<br><small>A cada PR revisado, o Farol registra recorrências e ganhos por pessoa.</small></div>`;
  if (SCOPE === 'all' && multi) {
    const parts = [];
    for (const a of (STATE.accounts || [])) {
      if (a.muted && TWEAK.muted !== 'Esmaecer') continue;
      const c = groupCards(a.user);
      if (c.length) { parts.push(memGroupHead(a.user)); parts.push(c.join('')); }
    }
    const geral = groupCards('');
    if (geral.length) { parts.push(memGroupHead('')); parts.push(geral.join('')); }
    box.innerHTML = parts.join('') || emptyMsg;
  } else if (SCOPE !== 'all') {
    const c = groupCards(SCOPE);
    box.innerHTML = c.length ? c.join('') : emptyMsg;
  } else {
    const c = groupCards('__all__');
    box.innerHTML = c.length ? c.join('') : emptyMsg;
  }
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
  ['2.6.0', ['Destaques e Time separados por conta: quando você monitora mais de uma conta do GitHub, cada aba agrupa por conta (com a barra de contas de volta pra filtrar), em vez de misturar trabalho e pessoal no mesmo balaio. A partir desta versão a memória do time guarda a org de cada review pra atribuir a conta; registros antigos (sem essa marca) aparecem num grupo "Geral" até o autor ser re-revisado.']],
  ['2.5.0', ['Reviewers por projeto reinventado, o fim da repetição: agora você define um grupo padrão por organização (aplicado a TODOS os repos dela no botão Reviewers), e só os projetos que fogem do padrão aparecem, como um diff enxuto ("padrão − fulano" / "padrão + ciclano"). Os demais colapsam numa linha só. Quem já tinha listas repetidas ganha um botão "Criar padrão" que detecta o grupo comum e recolhe tudo num clique. E o botão "👥 Reviewers" passa a funcionar em qualquer repo da org, mesmo sem config própria, usando o padrão.']],
  ['2.4.2', ['A barra de contas agora aparece só no Radar, onde ela realmente filtra. Nas abas Sistema, Time e Destaques ela sumiu (lá trocar de conta não mudava nada e só confundia): Sistema é global, e Time/Destaques são memória do time.']],
  ['2.4.1', ['Diagnóstico de atualização honesto: quando o Farol não consegue ler as releases (repo sem acesso pra sua conta, sem release ainda, ou rede), a aba Sistema diz isso claramente, em vez de mostrar "você está na versão mais recente" e te deixar sem saber que havia update.']],
  ['2.4.0', ['Aprova sozinho tudo que for aprovável, sem depender do seu clique: quando a revisão conclui que o PR está aprovável, o Farol posta o APPROVE na hora e deixa os pontos de atenção claros (anexados ao próprio PR e visíveis em Revisões recentes). Vale só pros reviews pedidos a você (clique no panorama nunca posta). Dá pra desligar em Sistema > Configurações e voltar a ser chamado nos casos com ressalva.']],
  ['2.3.0', ['Panorama: um PR que você já aprovou volta a mostrar "Re-revisar" quando (e só quando) entra commit novo depois da sua review; sem commit novo, segue como "nada a fazer". O Farol compara o commit da sua última review com o topo atual do PR.']],
  ['2.2.0', ['Reviewers por projeto agora agrupados por conta: cada projeto aparece sob a conta dona (Pessoal, BIUD, etc.), acabando com a lista misturada quando você monitora mais de uma conta']],
  ['2.1.0', ['Separação de contas: barra no topo pra alternar entre Todas e cada conta do GitHub (trabalho, pessoal, mais de um emprego), cada uma com cor e identidade próprias', 'De quem e por quem: cada card mostra o autor do PR (@quem escreveu) separado da sua conta (cor e etiqueta), e ao focar uma conta a faixa diz "revisando e postando como @você"', 'Contas silenciadas: aquele PR-teste antigo que nunca fecha sai do painel e dos avisos sem ser perdido (aparece ao selecionar a conta); ajuste em Sistema > Contas', 'Painel de contas em Sistema pra silenciar/reativar, e reviewers por projeto mais enxuto', 'Panorama: PR que você já aprovou não mostra mais "Re-revisar" (só quando entra commit novo)']],
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

/* ---------- editor de reviewers: padrão por org + exceções por repo ---------- */
let reviewerCands = { members: [], teams: [] };
let reviewerCandsLoaded = false;
const openExceptions = new Set(); // repos (owner/repo) com o editor de exceção aberto
const foldedOpen = new Set();     // orgs com a lista "seguem o padrão" expandida
const pendingExc = new Set();     // repos novos sendo criados como exceção

async function loadReviewerCands(force) {
  if (reviewerCandsLoaded && !force) return;
  const r = await get('/api/reviewer-candidates');
  if (r) { reviewerCands = { members: r.members || [], teams: r.teams || [] }; reviewerCandsLoaded = true; }
  renderReviewersEditor();
}

/* ---- helpers do modelo padrão/exceção ---- */
function cfgDefaults() { return (STATE.config || {}).defaultReviewers || {}; }
function cfgProjects() { return (STATE.config || {}).projectReviewers || {}; }
function defaultFor(org) { const d = cfgDefaults(); return d[org] || d[(org || '').toLowerCase()] || []; }
function overrideFor(repo) { const p = cfgProjects(); return p[repo] || p[(repo || '').toLowerCase()] || null; }
function sameSet(a, b) {
  const A = new Set((a || []).map(s => String(s).toLowerCase())), B = new Set((b || []).map(s => String(s).toLowerCase()));
  if (A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
}
function diffVs(base, list) {
  const B = new Set((base || []).map(x => x.toLowerCase())), L = new Set((list || []).map(x => x.toLowerCase()));
  return { added: (list || []).filter(x => !B.has(x.toLowerCase())), removed: (base || []).filter(x => !L.has(x.toLowerCase())) };
}
function reviewerLabel(rv) {
  const isTeam = rv.includes('/');
  const ent = isTeam && rv.split('/').slice(1).join('/').includes(':');
  if (ent) return { label: `${rv.split('/').pop()} (enterprise, não pedível)`, cls: 'bad', ent: true };
  if (isTeam) { const t = reviewerCands.teams.find(t => t.id === rv); return { label: (t ? t.name : rv.split('/').pop()) + ' (time)', cls: 'team' }; }
  return { label: rv, cls: '' };
}
function repoShort(repo) { return repo.split('/').slice(1).join('/') || repo; }
function reposOfOrg(org) {
  const o = String(org).toLowerCase(), set = new Set();
  const add = k => { const r = String(k || ''); if (r.split('/')[0].toLowerCase() === o) set.add(r); };
  (STATE.myPRs || []).forEach(p => add(p.key.split('#')[0]));
  (STATE.panorama || []).forEach(p => add(String(p.key || '').split('#')[0]));
  Object.keys(cfgProjects()).forEach(add);
  [...pendingExc].forEach(add);
  return [...set].filter(Boolean).sort();
}
// reviewers presentes na maioria das exceções da org: sugestão pra virar padrão
function suggestDefault(org) {
  const lists = reposOfOrg(org).map(overrideFor).filter(l => l && l.length);
  if (lists.length < 2) return [];
  const count = {}, rep = {};
  for (const list of lists) for (const rv of new Set(list)) { const k = rv.toLowerCase(); count[k] = (count[k] || 0) + 1; rep[k] = rv; }
  const th = Math.ceil(lists.length / 2);
  return Object.keys(count).filter(k => count[k] >= th).map(k => rep[k]).sort();
}
function chipHtml(rv, xClass, dataAttrs) {
  const r = reviewerLabel(rv);
  return `<span class="rev-chip${r.cls ? ' ' + r.cls : ''}" ${r.ent ? 'title="Time enterprise não pode ser reviewer de PR (o GitHub recusa). Remova daqui."' : ''}>${esc(r.label)}<button class="${xClass}" ${dataAttrs} title="remover">×</button></span>`;
}
function addSelect(cls, dataAttrs, list) {
  const me = ((STATE.config || {}).ghUser || '').toLowerCase();
  const has = v => (list || []).some(l => l.toLowerCase() === String(v).toLowerCase());
  const opts = [
    ...reviewerCands.members.filter(x => x.toLowerCase() !== me && !has(x)).map(x => `<option value="${esc(x)}">${esc(x)}</option>`),
    ...reviewerCands.teams.filter(t => !has(t.id)).map(t => `<option value="${esc(t.id)}">${esc(t.name)} (time)</option>`)
  ].join('');
  return `<select class="rev-add ${cls}" ${dataAttrs}><option value="">${reviewerCandsLoaded ? '+ adicionar…' : 'carregando…'}</option>${opts}</select>`;
}

/* ---- persistência otimista ---- */
function applyDefaults(map) {
  const clean = {};
  for (const k of Object.keys(map)) if ((map[k] || []).length) clean[k] = map[k];
  if (!STATE.config) STATE.config = {};
  STATE.config.defaultReviewers = clean;
  // pruna exceções que passaram a igualar o padrão (viram "segue o padrão")
  const pr = { ...cfgProjects() }; let prChanged = false;
  for (const repo of Object.keys(pr)) {
    if (openExceptions.has(repo) || pendingExc.has(repo)) continue;
    const d = clean[repo.split('/')[0]] || clean[repo.split('/')[0].toLowerCase()] || [];
    if (sameSet(pr[repo], d)) { delete pr[repo]; prChanged = true; }
  }
  if (prChanged) STATE.config.projectReviewers = pr;
  renderReviewersEditor();
  api('/api/settings', { defaultReviewers: clean });
  if (prChanged) api('/api/settings', { projectReviewers: pr });
}
function applyProjects(map, keepRepo) {
  const clean = {};
  for (const k of Object.keys(map)) {
    const list = map[k] || []; if (!list.length) continue;
    // dropa exceção idêntica ao padrão (salvo a que está aberta em edição)
    if (k !== keepRepo && !openExceptions.has(k) && !pendingExc.has(k) && sameSet(list, defaultFor(k.split('/')[0]))) continue;
    clean[k] = list;
  }
  if (!STATE.config) STATE.config = {};
  STATE.config.projectReviewers = clean;
  renderReviewersEditor();
  api('/api/settings', { projectReviewers: clean });
}
function seedException(repo) {
  pendingExc.add(repo); openExceptions.add(repo);
  const map = { ...cfgProjects() };
  if (!overrideFor(repo)) map[repo] = [...defaultFor(repo.split('/')[0])];
  applyProjects(map, repo);
}

/* ---- render de um bloco de org (padrão + exceções + colapsado) ---- */
function renderOrgBlock(org, accent) {
  const def = defaultFor(org);
  const repos = reposOfOrg(org);
  const isExc = r => { const o = overrideFor(r); return (o && !sameSet(o, def)) || openExceptions.has(r) || pendingExc.has(r); };
  const excRepos = repos.filter(isExc);
  const following = repos.filter(r => !excRepos.includes(r));

  // card do padrão
  let defCard;
  if (def.length) {
    const chips = def.map(rv => chipHtml(rv, 'rev-def-x', `data-org="${esc(org)}" data-rv="${esc(rv)}"`)).join('');
    defCard = `<div class="rev-default">
      <div class="rev-default-top"><span class="t">Reviewers padrão</span><span class="scope">${esc(org)}</span></div>
      <div class="rev-chips">${chips}${addSelect('rev-def-add', `data-org="${esc(org)}"`, def)}</div>
      <div class="rev-hint">Aplicado a todos os projetos de <code>${esc(org)}</code> quando você clica em "👥 Reviewers", salvo as exceções abaixo.</div>
    </div>`;
  } else {
    const sug = suggestDefault(org);
    const sugChips = sug.map(rv => `<span class="rev-chip ghost">${esc(reviewerLabel(rv).label)}</span>`).join('');
    defCard = `<div class="rev-default empty">
      <div class="rev-default-top"><span class="t">Reviewers padrão</span><span class="scope">${esc(org)}</span></div>
      ${sug.length
        ? `<div class="rev-hint">Detectei ${sug.length} reviewers comuns nos seus projetos de ${esc(org)}. Vira o padrão num clique, e os projetos iguais colapsam:</div>
           <div class="rev-chips">${sugChips}</div>
           <button class="btn sm ok rev-make-default" data-org="${esc(org)}">Criar padrão com estes ${sug.length}</button>`
        : `<div class="rev-chips">${addSelect('rev-def-add', `data-org="${esc(org)}"`, [])}</div>
           <div class="rev-hint">Escolha os reviewers padrão de <code>${esc(org)}</code>.</div>`}
    </div>`;
  }

  // exceções
  const excHtml = excRepos.map(repo => {
    const list = overrideFor(repo) || (pendingExc.has(repo) ? [...def] : []);
    if (openExceptions.has(repo)) {
      const chips = list.map(rv => chipHtml(rv, 'rev-exc-x', `data-repo="${esc(repo)}" data-rv="${esc(rv)}"`)).join('');
      return `<div class="rev-exc open" data-repo="${esc(repo)}">
        <div class="rev-exc-head"><code>${esc(repoShort(repo))}</code>
          <button class="rev-exc-reset" data-repo="${esc(repo)}" title="remover a exceção e voltar ao padrão da org">voltar ao padrão</button>
          <button class="rev-exc-toggle" data-repo="${esc(repo)}">fechar</button></div>
        <div class="rev-chips">${chips || '<span class="rev-empty">sem reviewers</span>'}${addSelect('rev-exc-add', `data-repo="${esc(repo)}"`, list)}</div>
      </div>`;
    }
    const d = diffVs(def, list);
    const pills = '<span class="rev-pill base">padrão</span>'
      + d.added.map(x => `<span class="rev-pill add">+ ${esc(reviewerLabel(x).label)}</span>`).join('')
      + d.removed.map(x => `<span class="rev-pill rem">− ${esc(reviewerLabel(x).label)}</span>`).join('');
    return `<div class="rev-exc" data-repo="${esc(repo)}"><code>${esc(repoShort(repo))}</code><div class="rev-diff">${def.length ? pills : list.map(x => `<span class="rev-pill add">${esc(reviewerLabel(x).label)}</span>`).join('')}</div><button class="rev-exc-toggle" data-repo="${esc(repo)}">editar</button></div>`;
  }).join('');

  // colapsado: projetos que seguem o padrão
  const open = foldedOpen.has(org);
  const followHtml = following.length ? `<div class="rev-folded">
      <span><span class="count">${following.length}</span> ${following.length === 1 ? 'projeto segue' : 'projetos seguem'} o padrão</span>
      <button class="rev-fold-toggle" data-org="${esc(org)}">${open ? 'ocultar' : 'ver'}</button>
    </div>${open ? `<div class="rev-folded-list">${following.map(r => `<span class="rev-repo-mini">${esc(repoShort(r))}<button class="rev-mk-exc" data-repo="${esc(r)}" title="criar exceção pra este projeto">+</button></span>`).join('')}</div>` : ''}` : '';

  // criar exceção pra um projeto (só quando há padrão)
  const dl = following.map(r => `<option value="${esc(r)}"></option>`).join('');
  const newExc = def.length ? `<div class="rev-newexc">
      <input class="rev-newexc-input" list="revExcList-${esc(org)}" placeholder="owner/repo, exceção" spellcheck="false">
      <datalist id="revExcList-${esc(org)}">${dl}</datalist>
      <button class="btn sm rev-newexc-go" data-org="${esc(org)}">+ criar exceção</button>
    </div>` : '';

  return `<div class="rev-org" data-org="${esc(org)}" style="--ac:${accent}">${defCard}${excRepos.length ? `<div class="rev-sec-title">Exceções (${excRepos.length})</div>${excHtml}` : ''}${followHtml}${newExc}</div>`;
}

function renderReviewersEditor() {
  const box = $('#reviewersEditor'); if (!box) return;
  const parts = [];
  const seen = new Set();
  const orgToUser = {};
  Object.keys(OWNER2USER).forEach(o => { orgToUser[o] = OWNER2USER[o]; });
  for (const a of (STATE.accounts || [])) {
    const meta = ACCT[a.user.toLowerCase()] || {};
    const orgs = [...new Set((a.owners || []).map(String))];
    [...Object.keys(cfgDefaults()), ...Object.keys(cfgProjects()).map(r => r.split('/')[0])].forEach(o => {
      if (OWNER2USER[o.toLowerCase()] === a.user && !orgs.some(x => x.toLowerCase() === o.toLowerCase())) orgs.push(o);
    });
    const blocks = orgs.filter(Boolean).sort().map(o => { seen.add(o.toLowerCase()); return renderOrgBlock(o, meta.color || 'var(--accent)'); }).join('');
    if (!blocks) continue;
    if (multiAccount()) parts.push(`<div class="rev-group-head" style="--ac:${meta.color}"><span class="g-dot"></span>${esc(meta.label || a.user)}</div>`);
    parts.push(blocks);
  }
  // orgs de config sem conta dona conhecida
  const orphans = [...new Set([...Object.keys(cfgDefaults()), ...Object.keys(cfgProjects()).map(r => r.split('/')[0])])].filter(o => o && !seen.has(o.toLowerCase())).sort();
  if (orphans.length) {
    if (multiAccount()) parts.push('<div class="rev-group-head" style="--ac:var(--muted)"><span class="g-dot"></span>Outros</div>');
    parts.push(orphans.map(o => renderOrgBlock(o, 'var(--muted)')).join(''));
  }
  box.innerHTML = parts.join('') || '<div class="rev-empty">Nenhuma organização monitorada ainda. Configure as organizações no campo acima.</div>';
}

$('#reviewersEditor').addEventListener('change', (e) => {
  const defAdd = e.target.closest('.rev-def-add');
  if (defAdd && defAdd.value) {
    const org = defAdd.dataset.org, map = { ...cfgDefaults() };
    map[org] = [...defaultFor(org), defAdd.value];
    applyDefaults(map); return;
  }
  const excAdd = e.target.closest('.rev-exc-add');
  if (excAdd && excAdd.value) {
    const repo = excAdd.dataset.repo, map = { ...cfgProjects() };
    const cur = overrideFor(repo) || (pendingExc.has(repo) ? [...defaultFor(repo.split('/')[0])] : []);
    map[repo] = [...cur, excAdd.value];
    applyProjects(map, repo); return;
  }
});
$('#reviewersEditor').addEventListener('click', (e) => {
  const defX = e.target.closest('.rev-def-x');
  if (defX) { const org = defX.dataset.org, map = { ...cfgDefaults() }; map[org] = defaultFor(org).filter(r => r !== defX.dataset.rv); applyDefaults(map); return; }
  const mkDef = e.target.closest('.rev-make-default');
  if (mkDef) { const org = mkDef.dataset.org, map = { ...cfgDefaults() }; map[org] = suggestDefault(org); applyDefaults(map); toast('ok', 'Padrão criado. Projetos iguais colapsaram; os diferentes viraram exceção.', 5000); return; }
  const excX = e.target.closest('.rev-exc-x');
  if (excX) { const repo = excX.dataset.repo, map = { ...cfgProjects() }; const cur = overrideFor(repo) || [...defaultFor(repo.split('/')[0])]; map[repo] = cur.filter(r => r !== excX.dataset.rv); applyProjects(map, repo); return; }
  const excToggle = e.target.closest('.rev-exc-toggle');
  if (excToggle) {
    const repo = excToggle.dataset.repo;
    if (openExceptions.has(repo)) {
      openExceptions.delete(repo); pendingExc.delete(repo);
      const o = overrideFor(repo);
      if (o && sameSet(o, defaultFor(repo.split('/')[0]))) { const map = { ...cfgProjects() }; delete map[repo]; delete map[repo.toLowerCase()]; applyProjects(map); }
      else renderReviewersEditor();
    } else { openExceptions.add(repo); renderReviewersEditor(); }
    return;
  }
  const excReset = e.target.closest('.rev-exc-reset');
  if (excReset) { const repo = excReset.dataset.repo; openExceptions.delete(repo); pendingExc.delete(repo); const map = { ...cfgProjects() }; delete map[repo]; delete map[repo.toLowerCase()]; applyProjects(map); toast('info', `${repoShort(repo)} voltou ao padrão da org.`, 3000); return; }
  const foldToggle = e.target.closest('.rev-fold-toggle');
  if (foldToggle) { const org = foldToggle.dataset.org; if (foldedOpen.has(org)) foldedOpen.delete(org); else foldedOpen.add(org); renderReviewersEditor(); return; }
  const mkExc = e.target.closest('.rev-mk-exc');
  if (mkExc) { seedException(mkExc.dataset.repo); return; }
  const newExcGo = e.target.closest('.rev-newexc-go');
  if (newExcGo) {
    const org = newExcGo.dataset.org;
    const inp = newExcGo.closest('.rev-newexc').querySelector('.rev-newexc-input');
    let repo = (inp.value || '').trim();
    if (!repo) return;
    if (!repo.includes('/')) repo = `${org}/${repo}`;
    if (!/^[^\s/]+\/[^\s/]+$/.test(repo)) { toast('error', 'Informe no formato owner/repo.'); return; }
    seedException(repo); return;
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
  $('#setAutoApproveAll').checked = c.autoApproveAll !== false;
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
$('#btnReviewAll').onclick = () => {
  // revisa só o que está visível no escopo atual
  const urls = (STATE.queue || []).filter(scopeVisible).map(p => p.url);
  api('/api/review', urls.length ? { urls } : {});
};

/* tweaks de exibição (guardados no navegador, não vão pro engine) */
function initTweaks() {
  const mh = $('#setMutedHandling'), is = $('#setIdentityStyle');
  if (mh) { mh.value = TWEAK.muted; mh.onchange = () => { TWEAK.muted = mh.value; localStorage.setItem('farol-muted-handling', mh.value); rerenderScope(); }; }
  if (is) { is.value = TWEAK.ident; is.onchange = () => { TWEAK.ident = is.value; localStorage.setItem('farol-identity-style', is.value); rerenderScope(); }; }
}
initTweaks();
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
  ['#setAutoApproveAll', 'autoApproveAll', el => el.checked],
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
    rebuildAccounts();
    renderStatus(); renderAccountBar(); renderIdentity();
    renderActive(); renderDecisions(); renderQueue(); renderMyPRs(); renderPanorama(); renderSilenced();
    renderSettings(); renderTools(); renderUpdate(); tickCountdown();
    if ($('#tab-sistema').classList.contains('active')) { renderDoctor(); renderAccountsManager(); }
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
