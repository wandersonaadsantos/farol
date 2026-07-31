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

/* ---------- modal de confirmação (ações destrutivas) ---------- */
// Devolve uma Promise<boolean>. body aceita HTML (controlado por nós). Toda ação
// que apaga/remove algo deve passar por aqui, deixando o IMPACTO claro.
function confirmModal(opts) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.innerHTML = `<div class="modal-card ${opts.danger ? 'danger' : ''}">
      <div class="modal-title">${esc(opts.title || 'Confirmar')}</div>
      <div class="modal-body">${opts.body || ''}</div>
      <div class="modal-actions">
        <button class="btn sm ghost modal-cancel">${esc(opts.cancelLabel || 'Cancelar')}</button>
        <button class="btn sm ${opts.danger ? 'danger-solid' : 'primary'} modal-ok">${esc(opts.confirmLabel || 'Confirmar')}</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const close = (v) => { ov.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    ov.querySelector('.modal-cancel').onclick = () => close(false);
    ov.querySelector('.modal-ok').onclick = () => close(true);
    ov.onclick = (e) => { if (e.target === ov) close(false); };
    document.addEventListener('keydown', onKey);
    setTimeout(() => ov.querySelector('.modal-cancel').focus(), 30);
  });
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
  // 'sistema' e 'consumo' são visões do Farol como app, não de uma conta: a barra de
  // filtro por conta não se aplica (e mostrá-la ali daria falsa sensação de filtro).
  if (accounts.length < 2 || CURRENT_TAB === 'sistema' || CURRENT_TAB === 'consumo') { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  const all = SCOPE === 'all';
  // o contador (PRs precisando de você) é conceito do Radar; nas outras abas some
  const showCounts = CURRENT_TAB === 'radar';
  const totalAtt = accounts.filter(a => !a.muted).reduce((n, a) => n + attentionCount(a.user), 0);
  const segAll = `<button class="acct-seg ${all ? 'active' : ''}" data-scope="all" title="Ver todas as contas"
      style="${all ? '--seg-bg:var(--surface-2);--seg-fg:var(--text);--seg-badge-bg:var(--accent-soft);--seg-badge-fg:var(--accent);' : ''}">Todas${showCounts && totalAtt ? `<span class="seg-count">${totalAtt}</span>` : ''}</button>`;
  const segs = accounts.map(a => {
    const meta = ACCT[a.user.toLowerCase()] || {};
    const active = String(SCOPE).toLowerCase() === a.user.toLowerCase();
    const att = a.muted ? 0 : attentionCount(a.user);
    const style = `--ac:${meta.color};` + (active ? `--seg-bg:${meta.soft};--seg-fg:${meta.color};--seg-badge-bg:${meta.color};--seg-badge-fg:${meta.ink};` : '');
    return `<button class="acct-seg ${active ? 'active' : ''} ${a.muted ? 'muted' : ''}" data-scope="${esc(a.user)}"
        title="@${esc(a.user)}${meta.org ? ' · ' + esc(meta.org) : ''}${a.muted ? ' (silenciada)' : ''}" style="${style}">
        <span class="seg-dot"></span>${esc(meta.label || a.user)}${a.muted ? '<span class="seg-pause">⏸</span>' : (showCounts && att ? `<span class="seg-count">${att}</span>` : '')}</button>`;
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

/* ---------- gerenciador/editor de contas (Sistema) ---------- */
function accountSaveArray(list) {
  return (list || []).map(a => {
    const o = { user: a.user, owners: a.owners || [], label: a.label, color: a.color, kind: a.kind || '', muted: !!a.muted };
    if (a.autoReview === true || a.autoReview === false) o.autoReview = a.autoReview;
    if (a.onClean === 'approve' || a.onClean === 'wait') o.onClean = a.onClean;
    if (a.onCaveats === 'approve' || a.onCaveats === 'wait') o.onCaveats = a.onCaveats;
    if (a.onReject === 'request_changes' || a.onReject === 'wait') o.onReject = a.onReject;
    if (a.claudeProfileId) o.claudeProfileId = a.claudeProfileId;
    return o;
  });
}
function editAccount(user, patch) {
  const list = (STATE.accounts || []).map(a => a.user === user ? { ...a, ...patch } : a);
  STATE.accounts = list; rebuildAccounts();
  renderAccountsManager(); renderAccountBar(); renderIdentity();
  api('/api/settings', { accounts: accountSaveArray(list) });
}
function removeAccount(user) {
  const list = (STATE.accounts || []).filter(a => a.user !== user);
  STATE.accounts = list; rebuildAccounts();
  renderAccountsManager(); renderAccountBar(); renderIdentity();
  api('/api/settings', { accounts: accountSaveArray(list) });
}
function addAccount(user, owners, label) {
  const list = [...(STATE.accounts || []), { user, owners, label: label || user, color: '', kind: '', muted: false, tokenOk: false, primary: false }];
  STATE.accounts = list; rebuildAccounts();
  renderAccountsManager(); renderAccountBar();
  api('/api/settings', { accounts: accountSaveArray(list) });
}
function renderAccountsManager() {
  const box = $('#accountsManager'); if (!box) return;
  // não re-renderiza enquanto você edita um campo (senão apaga o que está digitando)
  if (document.activeElement && box.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  const accounts = (STATE.accounts || []);
  const multi = accounts.length > 1;
  const c = STATE.config || {};
  const globalAR = c.autoReview !== false;      // padrão herdado: revisar automaticamente
  const globalCav = c.autoApproveAll !== false; // padrão herdado: aprovar com ressalvas
  const rows = accounts.map(a => {
    const meta = ACCT[a.user.toLowerCase()] || {};
    const auth = a.muted ? 'silenciada (fora dos avisos e da auto-revisão)' : (a.tokenOk ? 'autenticada no gh' : 'sem token: rode gh auth login');
    return `<div class="card acct-card ${a.muted ? 'muted' : ''}" style="--ac:${meta.color};--ac-soft:${meta.soft};--ac-ink:${meta.ink};">
      <input type="color" class="acct-color" data-user="${esc(a.user)}" value="${esc(a.color || meta.color || '#ffb454')}" title="cor da conta">
      <div class="a-body">
        <div class="a-editrow">
          <input class="acct-label" data-user="${esc(a.user)}" value="${esc(a.label || a.user)}" placeholder="rótulo" spellcheck="false" title="rótulo da conta">
          <input class="acct-kind" data-user="${esc(a.user)}" list="acctKinds" value="${esc(a.kind || '')}" placeholder="tipo (Pessoal/Trabalho)" spellcheck="false">
          ${a.primary ? '<span class="a-tag">primária</span>' : ''}
        </div>
        <div class="a-sub"><span class="a-auth ${a.tokenOk && !a.muted ? 'ok' : ''}">@${esc(a.user)}</span> · ${esc(auth)}</div>
        <div class="a-editrow orgs"><span class="a-fieldlabel">orgs</span>
          <input class="acct-owners" data-user="${esc(a.user)}" value="${esc((a.owners || []).join(', '))}" placeholder="org1, org2" spellcheck="false" title="organizações monitoradas por esta conta"></div>
        <div class="a-pol-note">O que o Farol faz sozinho nos PRs desta conta (o que não escolher, segue o padrão geral):</div>
        <div class="a-policy">
          <div class="a-pol-item"><span class="a-fieldlabel">quando chega um PR pra você</span>
            <select class="acct-autoreview" data-user="${esc(a.user)}" title="Revisar na hora ou só listar e esperar você mandar revisar">
              <option value="">herda o geral: ${globalAR ? 'revisa na hora' : 'só põe na fila'}</option>
              <option value="on"${a.autoReview === true ? ' selected' : ''}>revisa na hora</option>
              <option value="off"${a.autoReview === false ? ' selected' : ''}>só põe na fila (você manda revisar)</option>
            </select></div>
          <div class="a-pol-item"><span class="a-fieldlabel">quando fica aprovável sem ressalvas</span>
            <select class="acct-onclean" data-user="${esc(a.user)}" title="PR aprovável e sem nenhum ponto de atenção">
              <option value="">herda o geral: aprova sozinho</option>
              <option value="approve"${a.onClean === 'approve' ? ' selected' : ''}>aprova sozinho</option>
              <option value="wait"${a.onClean === 'wait' ? ' selected' : ''}>espera você aprovar</option>
            </select></div>
          <div class="a-pol-item"><span class="a-fieldlabel">quando fica aprovável com ressalvas</span>
            <select class="acct-oncaveats" data-user="${esc(a.user)}" title="PR aprovável, mas com pontos de atenção anotados">
              <option value="">herda o geral: ${globalCav ? 'aprova e destaca as ressalvas' : 'espera você'}</option>
              <option value="approve"${a.onCaveats === 'approve' ? ' selected' : ''}>aprova e destaca as ressalvas</option>
              <option value="wait"${a.onCaveats === 'wait' ? ' selected' : ''}>espera você aprovar</option>
            </select></div>
          <div class="a-pol-item"><span class="a-fieldlabel">quando tem bloqueios</span>
            <select class="acct-onreject" data-user="${esc(a.user)}" title="PR com bloqueios reais (a revisão pediu mudanças)">
              <option value=""${!a.onReject || a.onReject === 'wait' ? ' selected' : ''}>espera você (padrão)</option>
              <option value="request_changes"${a.onReject === 'request_changes' ? ' selected' : ''}>reprova sozinho (posta pedir mudanças)</option>
            </select></div>
          <div class="a-pol-item"><span class="a-fieldlabel">perfil Claude</span>
            <select class="acct-claudeprofile" data-user="${esc(a.user)}" title="Assinatura Claude usada nas sessões desta conta">
              <option value="">usa o perfil padrão do Farol</option>
              ${(STATE.config.claudeProfiles || []).map(p => `<option value="${esc(p.id)}"${a.claudeProfileId === p.id ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}
            </select>
            ${claudeAuthBadge(a.claudeProfileId || STATE.config.claudeProfileId || '')}
          </div>
        </div>
      </div>
      ${multi ? `<div class="a-actions">
        <button class="btn sm ${a.muted ? 'ok' : 'ghost'} act-mute" data-user="${esc(a.user)}">${a.muted ? 'Reativar' : 'Silenciar'}</button>
        <button class="btn sm danger-ghost acct-remove" data-user="${esc(a.user)}" title="parar de monitorar esta conta no Farol">Remover</button>
      </div>` : ''}
    </div>`;
  }).join('');
  const addForm = `<div class="card acct-add">
    <div class="a-add-title">Adicionar conta</div>
    <div class="a-editrow">
      <input id="acctAddUser" placeholder="login do github" spellcheck="false">
      <input id="acctAddOwners" placeholder="orgs (org1, org2)" spellcheck="false">
      <input id="acctAddLabel" placeholder="rótulo (opcional)" spellcheck="false">
      <button class="btn sm" id="btnAcctAdd">Adicionar</button>
    </div>
    <div class="a-hint">A conta precisa estar logada no <code>gh</code> (<code>gh auth login</code>) pra buscar e postar. Sem token, ela aparece aqui mas sem acesso.</div>
  </div>
  <datalist id="acctKinds"><option value="Pessoal"></option><option value="Trabalho"></option><option value="Teste antigo"></option></datalist>`;
  box.innerHTML = (rows || '<div class="empty">Nenhuma conta configurada.</div>') + addForm;
}

// Gerenciador de perfis de assinatura Claude (Sistema): cada perfil é {id,label,dir}.
// Perfil padrão global + perfis salvos, cada um com o e-mail logado (badge, via doctor).
function claudeAuthBadge(id) {
  const all = (STATE.doctor && STATE.doctor.claudeAuth) || [];
  const info = all.find(x => x.id === id) || all.find(x => x.id === '') || null;
  if (!info) return '';
  if (info.ready === false) return `<span class="a-claude bad" title="rode claude login nesse diretório">SEM LOGIN</span>`;
  if (info.account) return `<span class="a-claude ok" title="${esc(info.configDir || 'padrão da máquina')}">@${esc(info.account)}</span>`;
  return `<span class="a-claude" title="${esc(info.configDir || 'padrão da máquina')}">${info.configDir ? 'logada' : 'padrão da máquina'}</span>`;
}

function genProfileId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function saveClaudeProfiles(profiles) {
  STATE.config.claudeProfiles = profiles;
  api('/api/settings', { claudeProfiles: profiles });
}

function renderClaudeProfiles() {
  const box = $('#claudeProfilesManager'); if (!box) return;
  if (document.activeElement && box.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  const c = STATE.config || {};
  const profiles = c.claudeProfiles || [];
  // migração: legado preenchido e nenhum perfil salvo ainda -> oferece virar o primeiro perfil
  const migrateCard = (!profiles.length && c.claudeConfigDir) ? `<div class="card acct-add">
    <div class="a-add-title">Perfil atual detectado</div>
    <div class="a-hint">Você já tem um diretório configurado: <code>${esc(c.claudeConfigDir)}</code>. Salvar como o primeiro perfil?</div>
    <div class="a-editrow">
      <input id="claudeMigrateLabel" placeholder="nome do perfil" value="Perfil atual" spellcheck="false">
      <button class="btn sm" id="btnClaudeMigrate">Salvar como perfil</button>
    </div>
  </div>` : '';
  const defaultOptions = [`<option value="">Padrão da máquina</option>`]
    .concat(profiles.map(p => `<option value="${esc(p.id)}"${c.claudeProfileId === p.id ? ' selected' : ''}>${esc(p.label)}</option>`))
    .join('');
  const defaultRow = `<div class="card">
    <div class="a-editrow">
      <span class="a-fieldlabel">perfil padrão do Farol</span>
      <select id="claudeProfileDefault">${defaultOptions}</select>
    </div>
  </div>`;
  const rows = profiles.map(p => `<div class="card acct-card">
    <div class="a-body">
      <div class="a-editrow">
        <input class="cp-label" data-id="${esc(p.id)}" value="${esc(p.label)}" placeholder="nome do perfil" spellcheck="false">
        ${claudeAuthBadge(p.id)}
      </div>
      <div class="a-editrow">
        <input class="cp-dir" data-id="${esc(p.id)}" value="${esc(p.dir)}" placeholder="C:\\Users\\voce\\.claude-perfil" spellcheck="false">
      </div>
    </div>
    <div class="a-actions">
      <button class="btn sm danger-ghost cp-remove" data-id="${esc(p.id)}">Remover</button>
    </div>
  </div>`).join('');
  const addForm = `<div class="card acct-add">
    <div class="a-add-title">Adicionar perfil</div>
    <div class="a-editrow">
      <input id="cpAddLabel" placeholder="nome (ex.: BIUD Trabalho)" spellcheck="false">
      <input id="cpAddDir" placeholder="diretório de config (ex.: C:\\Users\\voce\\.claude-biud-trabalho)" spellcheck="false">
      <button class="btn sm" id="btnCpAdd">Adicionar</button>
    </div>
  </div>`;
  box.innerHTML = migrateCard + defaultRow + rows + addForm;
}

// re-render das seções sensíveis ao escopo (sem esperar novo state do engine)
function rerenderScope() {
  if (!STATE) return;
  renderAccountBar(); renderIdentity();
  renderActive(); renderDecisions(); renderQueue(); renderMyPRs(); renderPanorama(); renderSilenced();
  renderRadarNav();
  if ($('#tab-destaques').classList.contains('active')) { loadHighlights(); renderTools(); }
  if ($('#tab-time').classList.contains('active')) loadTeam();
}

// mini-navegação do Radar: só lista seções visíveis (hidden=false), com contagem
// quando o número ajuda a decidir pra onde ir. Espelha o estado real do DOM em
// vez do STATE cru, então some/aparece junto com a própria seção.
function renderRadarNav() {
  const nav = $('#radarNav');
  const items = [
    ['activeWrap', 'rnActive', $('#activeCount').textContent],
    ['decisionsWrap', 'rnDecisions', $('#decisionsCount').textContent],
    ['queueSection', 'rnQueue', $('#queueCount').hidden ? '' : $('#queueCount').textContent],
    ['resolvedWrap', 'rnResolved', ''],
    ['myPRsWrap', 'rnMyPRs', $('#myPRsCount').hidden ? '' : $('#myPRsCount').textContent],
    ['panoramaSection', 'rnPano', $('#panoCount').hidden ? '' : $('#panoCount').textContent],
  ];
  let anyVisible = false;
  for (const [targetId, countId, count] of items) {
    const target = document.getElementById(targetId);
    const link = nav.querySelector(`[data-target="${targetId}"]`);
    if (!target || !link) continue;
    // queueSection e panoramaSection são cabeçalhos sem "hidden" próprio: sempre visíveis
    const visible = target.hidden !== true;
    link.hidden = !visible;
    if (visible) anyVisible = true;
    const countEl = document.getElementById(countId);
    if (countEl) countEl.textContent = count || '';
  }
  nav.hidden = !anyVisible;
}
$('#radarNav').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-target]');
  if (!a) return;
  e.preventDefault();
  const target = document.getElementById(a.dataset.target);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

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
  const people = { ...((STATE.config && STATE.config.people) || {}) };
  const person = { ...(people[login] || {}) };
  if (isPapel) {
    if (t.value) person.papel = t.value; else delete person.papel;
  } else {
    const dom = { ...(person.dominios || {}) };
    if (t.value) dom[t.dataset.domain] = t.value; else delete dom[t.dataset.domain];
    if (Object.keys(dom).length) person.dominios = dom; else delete person.dominios;
  }
  if (person.papel || person.dominios) people[login] = person; else delete people[login];
  if (STATE.config) STATE.config.people = people;   // otimista, pra o select não piscar
  api('/api/settings', { people });
});
/* registrar pushback nas linhas de Revisões recentes (desfecho + nota) */
$('#resolved').addEventListener('change', (e) => {
  if (e.target.classList && (e.target.classList.contains('pb-outcome') || e.target.classList.contains('pb-note'))) submitPushback(e.target);
});
/* editor de contas: mudar cor / rótulo / tipo / orgs */
$('#accountsManager').addEventListener('change', (e) => {
  const t = e.target, user = t.dataset && t.dataset.user;
  if (!user) return;
  if (t.classList.contains('acct-color')) return editAccount(user, { color: t.value });
  if (t.classList.contains('acct-label')) return editAccount(user, { label: (t.value || '').trim() || user });
  if (t.classList.contains('acct-kind')) return editAccount(user, { kind: (t.value || '').trim() });
  if (t.classList.contains('acct-owners')) return editAccount(user, { owners: (t.value || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean) });
  // política de automação por conta ('' = herda o global)
  if (t.classList.contains('acct-autoreview')) return editAccount(user, { autoReview: t.value === '' ? undefined : t.value === 'on' });
  if (t.classList.contains('acct-onclean')) return editAccount(user, { onClean: t.value || undefined });
  if (t.classList.contains('acct-oncaveats')) return editAccount(user, { onCaveats: t.value || undefined });
  if (t.classList.contains('acct-onreject')) return editAccount(user, { onReject: t.value === 'request_changes' ? 'request_changes' : undefined });
  if (t.classList.contains('acct-claudeprofile')) return editAccount(user, { claudeProfileId: t.value || undefined });
});
/* editor de contas: silenciar/reativar, remover, adicionar */
$('#accountsManager').addEventListener('click', (e) => {
  const mute = e.target.closest('.act-mute');
  if (mute) {
    const user = mute.dataset.user;
    const a = (STATE.accounts || []).find(x => x.user === user);
    const willMute = !(a && a.muted);
    if (willMute && String(SCOPE).toLowerCase() === user.toLowerCase()) { SCOPE = 'all'; localStorage.setItem('farol-scope', 'all'); }
    editAccount(user, { muted: willMute });
    return;
  }
  const rem = e.target.closest('.acct-remove');
  if (rem) {
    const user = rem.dataset.user;
    if ((STATE.accounts || []).length <= 1) { toast('error', 'Precisa de ao menos uma conta configurada.'); return; }
    const a = (STATE.accounts || []).find(x => x.user === user) || {};
    const orgs = (a.owners || []).length ? ` (orgs: ${esc(a.owners.join(', '))})` : '';
    confirmModal({
      title: `Remover a conta @${user} do Farol?`,
      danger: true, confirmLabel: 'Remover conta', cancelLabel: 'Manter',
      body: `<p>Isso mexe <b>só aqui no Farol</b>, não toca no seu GitHub nem apaga nada lá.</p>
        <p><b>O que muda:</b></p>
        <ul>
          <li>O Farol <b>para de monitorar</b> os PRs, a fila e os avisos dessa conta${orgs}.</li>
          <li>Some a <b>identidade</b> dela do painel: rótulo, cor e tipo que você configurou.</li>
          ${a.primary ? '<li>Ela é a conta <b>primária</b> hoje; a próxima da lista assume como primária.</li>' : ''}
          <li>A <b>memória de reviews</b> (Destaques e Time) e o histórico <b>não são apagados</b>.</li>
        </ul>
        <p>Dá pra <b>adicionar de volta</b> a qualquer momento (o rótulo, a cor e o tipo você reconfigura).</p>`
    }).then(ok => {
      if (!ok) return;
      if (String(SCOPE).toLowerCase() === user.toLowerCase()) { SCOPE = 'all'; localStorage.setItem('farol-scope', 'all'); }
      removeAccount(user);
      toast('info', `Conta @${user} removida do Farol.`, 3000);
    });
    return;
  }
  if (e.target.closest('#btnAcctAdd')) {
    const u = ($('#acctAddUser').value || '').trim().replace(/^@/, '');
    const owners = ($('#acctAddOwners').value || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
    const label = ($('#acctAddLabel').value || '').trim();
    if (!u) { toast('error', 'Informe o login da conta.'); return; }
    if ((STATE.accounts || []).some(a => a.user.toLowerCase() === u.toLowerCase())) { toast('error', 'Essa conta já está na lista.'); return; }
    addAccount(u, owners, label);
    toast('ok', `Conta @${u} adicionada. Se ainda não estiver logada, rode gh auth login.`, 5000);
    return;
  }
});

/* editor de perfis de assinatura Claude: adicionar / remover / editar / migrar / padrão global */
$('#claudeProfilesManager').addEventListener('click', (e) => {
  const t = e.target;
  if (t.id === 'btnCpAdd') {
    const label = ($('#cpAddLabel').value || '').trim();
    const dir = ($('#cpAddDir').value || '').trim();
    if (!label || !dir) return toast('error', 'Preencha nome e diretório do perfil.', 3000);
    const profiles = [...(STATE.config.claudeProfiles || []), { id: genProfileId(), label, dir }];
    $('#cpAddLabel').value = ''; $('#cpAddDir').value = '';
    saveClaudeProfiles(profiles);
    return;
  }
  if (t.classList.contains('cp-remove')) {
    const id = t.dataset.id;
    const profiles = (STATE.config.claudeProfiles || []).filter(p => p.id !== id);
    saveClaudeProfiles(profiles);
    return;
  }
  if (t.id === 'btnClaudeMigrate') {
    const label = ($('#claudeMigrateLabel').value || '').trim() || 'Perfil atual';
    const profiles = [{ id: genProfileId(), label, dir: STATE.config.claudeConfigDir }];
    saveClaudeProfiles(profiles);
    return;
  }
});
$('#claudeProfilesManager').addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'claudeProfileDefault') {
    STATE.config.claudeProfileId = t.value;
    return api('/api/settings', { claudeProfileId: t.value });
  }
  if (t.classList.contains('cp-label') || t.classList.contains('cp-dir')) {
    const id = t.dataset.id;
    const profiles = (STATE.config.claudeProfiles || []).map(p => p.id === id
      ? { ...p, label: t.classList.contains('cp-label') ? t.value.trim() || p.label : p.label,
              dir: t.classList.contains('cp-dir') ? t.value.trim() : p.dir }
      : p);
    saveClaudeProfiles(profiles);
  }
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
function switchTab(name) {
  CURRENT_TAB = name;
  document.querySelectorAll('.nav-item').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (STATE) renderAccountBar();   // mostra/esconde a barra de contas conforme a aba
  if (name === 'entregas') loadDeliveries();
  if (name === 'destaques') { loadHighlights(); renderTools(); }   // renderTools: kudos do escopo atual, não o defasado
  if (name === 'time') loadTeam();
  if (name === 'sistema') { loadLog(); renderDoctor(); renderAccountsManager(); renderClaudeProfiles(); loadReviewerCands(); }
  if (name === 'consumo') renderUsage();
}
$('#nav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
  if (btn) switchTab(btn.dataset.tab);
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

/* ---------- atalhos de teclado ---------- */
// J/K navegam nas decisões pendentes; A aprova, M pede mudanças, C comenta, P pula;
// / foca a consulta de PR; 1-6 trocam de aba; ? mostra esta lista.
const KBD_ACTIONS = { a: 'approve', m: 'request_changes', c: 'comment', p: 'skip' };
function kbdCards() { return [...document.querySelectorAll('#decisions .decision')]; }
function kbdSelected() { return document.querySelector('#decisions .decision.kbd-sel'); }
function kbdMove(delta) {
  const cards = kbdCards();
  if (!cards.length) return;
  switchTab('radar');
  const cur = kbdSelected();
  let i = cur ? cards.indexOf(cur) + delta : (delta > 0 ? 0 : cards.length - 1);
  i = Math.max(0, Math.min(cards.length - 1, i));
  cards.forEach(c => c.classList.remove('kbd-sel'));
  cards[i].classList.add('kbd-sel');
  cards[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function kbdHelp() {
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal-card">
    <div class="modal-title">Atalhos de teclado</div>
    <div class="modal-body"><table class="kbd-table">
      <tr><td><kbd>J</kbd> / <kbd>K</kbd></td><td>navegar nas decisões pendentes</td></tr>
      <tr><td><kbd>A</kbd></td><td>aprovar a decisão selecionada</td></tr>
      <tr><td><kbd>M</kbd></td><td>pedir mudanças na selecionada</td></tr>
      <tr><td><kbd>C</kbd></td><td>só comentar na selecionada</td></tr>
      <tr><td><kbd>P</kbd></td><td>pular a selecionada</td></tr>
      <tr><td><kbd>/</kbd></td><td>consultar um PR por URL</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>K</kbd></td><td>paleta de comando: ir a qualquer lugar</td></tr>
      <tr><td><kbd>1</kbd>…<kbd>6</kbd></td><td>trocar de aba</td></tr>
      <tr><td><kbd>?</kbd></td><td>esta lista</td></tr>
    </table></div>
    <div class="modal-actions"><button class="btn sm primary modal-ok">Fechar</button></div>
  </div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.querySelector('.modal-ok').onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  document.addEventListener('keydown', onKey);
}
/* ---------- paleta de comando (Ctrl+K / Cmd+K) ---------- */
// Ir a qualquer lugar rápido: abas, seções do Radar, ou colar/digitar URL/key
// de PR (org/repo#NN) pra abrir a conversa salva, sem precisar do mouse.
const CMD_STATIC = [
  ...[...document.querySelectorAll('.nav-item')].map(b => ({ kind: 'tab', label: `Ir para ${b.textContent}`, hint: 'aba', run: () => switchTab(b.dataset.tab) })),
  { kind: 'section', label: 'Ir para Precisa de você', hint: 'seção', run: () => { switchTab('radar'); document.getElementById('decisionsWrap')?.scrollIntoView({ behavior: 'smooth' }); } },
  { kind: 'section', label: 'Ir para Sua fila', hint: 'seção', run: () => { switchTab('radar'); document.getElementById('queueSection')?.scrollIntoView({ behavior: 'smooth' }); } },
  { kind: 'section', label: 'Ir para Meus PRs', hint: 'seção', run: () => { switchTab('radar'); document.getElementById('myPRsWrap')?.scrollIntoView({ behavior: 'smooth' }); } },
  { kind: 'section', label: 'Ir para Panorama', hint: 'seção', run: () => { switchTab('radar'); document.getElementById('panoramaSection')?.scrollIntoView({ behavior: 'smooth' }); } },
  { kind: 'action', label: 'Verificar agora', hint: 'ação', run: () => $('#btnCheck').click() },
  { kind: 'action', label: 'Alternar tema', hint: 'ação', run: () => $('#btnTheme').click() },
  { kind: 'action', label: 'Atalhos de teclado', hint: '?', run: () => kbdHelp() },
];
let cmdOverlay = null;
function cmdClose() {
  if (!cmdOverlay) return;
  cmdOverlay.remove(); cmdOverlay = null;
  document.removeEventListener('keydown', cmdOnKey, true);
}
function cmdOnKey(e) {
  if (!cmdOverlay) return;
  const list = [...cmdOverlay.querySelectorAll('.cmd-item')];
  const cur = cmdOverlay.querySelector('.cmd-item.sel');
  let i = cur ? list.indexOf(cur) : -1;
  if (e.key === 'Escape') { cmdClose(); e.preventDefault(); }
  else if (e.key === 'ArrowDown') { i = Math.min(list.length - 1, i + 1); cmdMark(list, i); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { i = Math.max(0, i - 1); cmdMark(list, i); e.preventDefault(); }
  else if (e.key === 'Enter') { e.preventDefault(); (cur || list[0])?.click(); }
}
function cmdMark(list, i) {
  list.forEach(el => el.classList.remove('sel'));
  if (list[i]) { list[i].classList.add('sel'); list[i].scrollIntoView({ block: 'nearest' }); }
}
function cmdOpen() {
  if (cmdOverlay) { cmdClose(); return; }
  const ov = document.createElement('div');
  ov.className = 'modal-overlay cmd-overlay';
  ov.innerHTML = `<div class="cmd-box">
    <input id="cmdInput" class="cmd-input" type="text" spellcheck="false" placeholder="Ir para… ou cole a URL/key de um PR (org/repo#NN)">
    <div id="cmdList" class="cmd-list"></div>
  </div>`;
  document.body.appendChild(ov);
  cmdOverlay = ov;
  const input = ov.querySelector('#cmdInput');
  const list = ov.querySelector('#cmdList');
  const renderList = () => {
    const q = input.value.trim();
    const prMatch = q.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/i) || q.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
    const items = [];
    if (prMatch) {
      const key = `${prMatch[1]}#${prMatch[2]}`;
      const url = q.startsWith('http') ? q : `https://github.com/${prMatch[1]}/pull/${prMatch[2]}`;
      items.push({ label: `Abrir a conversa de ${key}`, hint: 'PR', run: () => openChat(key, url) });
    }
    const ql = q.toLowerCase();
    items.push(...CMD_STATIC.filter(c => !ql || c.label.toLowerCase().includes(ql)));
    list.innerHTML = items.map((c, idx) => `<div class="cmd-item${idx === 0 ? ' sel' : ''}" data-idx="${idx}"><span>${esc(c.label)}</span><span class="cmd-hint">${esc(c.hint)}</span></div>`).join('')
      || '<div class="cmd-empty">Nada encontrado. Cole a URL de um PR pra abrir a conversa.</div>';
    [...list.querySelectorAll('.cmd-item')].forEach((el, idx) => {
      el.onclick = () => { items[idx].run(); cmdClose(); };
    });
  };
  input.addEventListener('input', renderList);
  ov.addEventListener('click', (e) => { if (e.target === ov) cmdClose(); });
  document.addEventListener('keydown', cmdOnKey, true);
  renderList();
  setTimeout(() => input.focus(), 20);
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); cmdOpen(); }
});

document.addEventListener('keydown', (e) => {
  // nunca por cima de digitação, diálogo, chat ou combinação com modificador
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return;
  if (document.querySelector('.modal-overlay')) return;
  if (!$('#chatPanel').hidden) return;
  const k = e.key;
  if (k >= '1' && k <= '6') {
    const tabs = [...document.querySelectorAll('.nav-item')];
    const btn = tabs[Number(k) - 1];
    if (btn) { switchTab(btn.dataset.tab); e.preventDefault(); }
    return;
  }
  if (k === '/') { switchTab('radar'); $('#lookupUrl').focus(); e.preventDefault(); return; }
  if (k === '?') { kbdHelp(); e.preventDefault(); return; }
  const low = k.toLowerCase();
  if (low === 'j') { kbdMove(1); e.preventDefault(); return; }
  if (low === 'k') { kbdMove(-1); e.preventDefault(); return; }
  if (KBD_ACTIONS[low]) {
    const card = kbdSelected();
    const btn = card && card.querySelector(`.dec-act[data-action="${KBD_ACTIONS[low]}"]`);
    if (btn) { btn.click(); e.preventDefault(); }
  }
});

/* ---------- entregas (PRs mergeados por repo / por responsável) ---------- */
let deliveriesData = null;
let deliveriesDays = parseInt(localStorage.getItem('farol-deliv-days'), 10);
if (![0, 7, 15, 30].includes(deliveriesDays)) deliveriesDays = 7;
let deliveriesBy = localStorage.getItem('farol-deliv-by') === 'author' ? 'author' : 'repo';
let deliveriesOrg = localStorage.getItem('farol-deliv-org') || ''; // '' = ainda não resolvido → cai na principal

// org principal (default da visão): 1º owner da 1ª conta, senão o legado config.owners
function primaryOrg() {
  for (const a of (STATE && STATE.accounts) || []) if ((a.owners || []).length) return a.owners[0];
  return (((STATE && STATE.config) || {}).owners || [])[0] || '';
}
// todas as orgs monitoradas (união dos owners de todas as contas), c/ a conta dona
function orgsWithAccount() {
  const map = new Map(); // org -> user (conta dona)
  for (const a of (STATE && STATE.accounts) || []) for (const o of (a.owners || [])) if (!map.has(o)) map.set(o, a.user);
  for (const o of (((STATE && STATE.config) || {}).owners || [])) if (!map.has(o)) map.set(o, (STATE.account || {}).user || '');
  return [...map.entries()].map(([org, user]) => ({ org, user }));
}
function renderDelivOrgSelect() {
  const sel = $('#delivOrg'); if (!sel) return;
  const orgs = orgsWithAccount();
  // resolve a seleção: mantém a salva se ainda existir, senão cai na principal
  if (!deliveriesOrg || !orgs.some(o => o.org === deliveriesOrg)) deliveriesOrg = primaryOrg();
  const multi = multiAccount && multiAccount();
  sel.innerHTML = orgs.map(o =>
    `<option value="${esc(o.org)}"${o.org === deliveriesOrg ? ' selected' : ''}>${esc(o.org)}${multi && o.user ? ` · @${esc(o.user)}` : ''}</option>`
  ).join('') || '<option value="">(nenhuma org monitorada)</option>';
}

async function loadDeliveries() {
  renderDelivOrgSelect();
  const sel = $('#delivDays'); if (sel) sel.value = String(deliveriesDays);
  document.querySelectorAll('#delivBy .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.by === deliveriesBy));
  $('#deliveries').innerHTML = '<div class="empty">Carregando entregas…</div>';
  const data = await get('/api/deliveries?days=' + deliveriesDays + '&owner=' + encodeURIComponent(deliveriesOrg || ''));
  deliveriesData = data || { items: [] };
  renderDeliveries();
}

// maior mergedAt de uma lista (ISO ordena lexicograficamente)
function lastMerge(list) { return (list.map(x => x.mergedAt || '').sort().slice(-1)[0]) || ''; }
function groupBy(items, keyFn) {
  const m = new Map();
  for (const it of items) { const k = keyFn(it); (m.get(k) || m.set(k, []).get(k)).push(it); }
  return m;
}
function delivPrRow(it) {
  return `<div class="row">
    <span class="ref"><a href="${esc(it.url)}" target="_blank" rel="noreferrer">${esc(it.key)}</a></span>
    <span class="title" title="${esc(it.title)}">${esc(it.title)}</span>
    <span class="who">@${esc(it.author)}</span>
    <span class="when">${fmtRel(it.mergedAt)}</span>
  </div>`;
}
function delivGroupCard(head, count, bodyHtml) {
  return `<div class="card deliv-card">
    <details>
      <summary class="deliv-sum">${head}<span class="count">${count}</span></summary>
      ${bodyHtml}
    </details>
  </div>`;
}
// linha de PR dentro de um sub-grupo por repo (o repo já é o cabeçalho, então
// mostra só o número e omite o @autor, que é o dono do card na visão por pessoa)
function delivPrRowInRepo(it) {
  const num = String(it.key).split('#')[1] || it.number;
  return `<div class="row">
    <span class="ref"><a href="${esc(it.url)}" target="_blank" rel="noreferrer">#${esc(num)}</a></span>
    <span class="title" title="${esc(it.title)}">${esc(it.title)}</span>
    <span class="when">${fmtRel(it.mergedAt)}</span>
  </div>`;
}
// corpo agrupado por projeto (repo): usado na visão por responsável
function delivRepoSubgroups(list) {
  const groups = [...groupBy(list, it => it.repo).entries()].map(([repo, prs]) => ({ repo, prs, last: lastMerge(prs) }));
  groups.sort((a, b) => b.prs.length - a.prs.length || String(b.last).localeCompare(String(a.last)));
  return groups.map(g => `
    <details class="deliv-subgroup" open>
      <summary class="deliv-subhead"><span class="deliv-subname">${esc(g.repo)}</span><span class="count sm">${g.prs.length}</span></summary>
      <div class="rows">${g.prs.map(delivPrRowInRepo).join('')}</div>
    </details>`).join('');
}
function deliveriesByRepo(items) {
  const groups = [...groupBy(items, it => it.repo).entries()].map(([repo, list]) => {
    const autores = new Set(list.map(x => x.author).filter(Boolean)).size;
    return { list, last: lastMerge(list), head: `<span class="deliv-name">${esc(repo)}</span><span class="deliv-meta">${autores} ${autores === 1 ? 'autor' : 'autores'} · último ${fmtRel(lastMerge(list))}</span>` };
  });
  groups.sort((a, b) => b.list.length - a.list.length || String(b.last).localeCompare(String(a.last)));
  return groups.map(g => delivGroupCard(g.head, g.list.length, `<div class="rows">${g.list.map(delivPrRow).join('')}</div>`)).join('');
}
function deliveriesByAuthor(items) {
  const groups = [...groupBy(items, it => it.author || '(desconhecido)').entries()].map(([login, list]) => {
    const repos = new Set(list.map(x => x.repo)).size;
    return { list, last: lastMerge(list), head: `${avatar(login)}<span class="deliv-name">@${esc(login)}</span><span class="deliv-meta">${repos} ${repos === 1 ? 'repo' : 'repos'} · último ${fmtRel(lastMerge(list))}</span>` };
  });
  groups.sort((a, b) => b.list.length - a.list.length || String(b.last).localeCompare(String(a.last)));
  return groups.map(g => delivGroupCard(g.head, g.list.length, delivRepoSubgroups(g.list))).join('');
}
function renderDeliveries() {
  const data = deliveriesData || { items: [] };
  const note = $('#delivNote');
  const msgs = [];
  if (data.partial) msgs.push('Algumas buscas ao GitHub falharam; a lista pode estar incompleta (veja o log em Sistema).');
  if (data.capped) msgs.push('Alguma organização tem mais de 100 entregas no período; mostrando as 100 mais recentes.');
  note.hidden = !msgs.length;
  note.textContent = msgs.join(' ');
  const box = $('#deliveries');
  const items = data.items || [];
  if (!items.length) {
    box.innerHTML = `<div class="empty"><span class="big">📦</span>Nenhum PR mergeado neste período.<br><small>Ajuste o período acima ou confira as organizações monitoradas em Sistema.</small></div>`;
    return;
  }
  box.innerHTML = deliveriesBy === 'author' ? deliveriesByAuthor(items) : deliveriesByRepo(items);
}
$('#delivOrg').addEventListener('change', (e) => {
  deliveriesOrg = e.target.value || '';
  localStorage.setItem('farol-deliv-org', deliveriesOrg);
  loadDeliveries();
});
$('#delivDays').addEventListener('change', (e) => {
  const v = parseInt(e.target.value, 10); // "Hoje" = 0 (é falsy: não usar || aqui)
  deliveriesDays = [0, 7, 15, 30].includes(v) ? v : 7;
  localStorage.setItem('farol-deliv-days', String(deliveriesDays));
  loadDeliveries();
});
$('#delivBy').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  deliveriesBy = b.dataset.by === 'author' ? 'author' : 'repo';
  localStorage.setItem('farol-deliv-by', deliveriesBy);
  document.querySelectorAll('#delivBy .seg-btn').forEach(x => x.classList.toggle('active', x.dataset.by === deliveriesBy));
  renderDeliveries(); // troca de fatia é só re-render, sem novo fetch
});

/* ---------- render: topo/status ---------- */
function renderStatus() {
  const s = STATE;
  const pill = $('#statusPill');
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
// a sessão pertence à conta do PR que ela revisa (pelo owner do repo); sem conta
// atribuível, não esconde. Assim trocar de conta não mistura o "Analisando agora".
function sessionVisible(s) {
  const u = s && s.pr ? prUser(s.pr) : '';
  return !u || scopeVisible({ account: u });
}
function renderActive() {
  const sessions = (STATE.activeSessions || []).filter(s => (s.mode === 'auto' || s.mode === 'self') && sessionVisible(s));
  const waiting = (STATE.headlessWaiting || []).filter(k => scopeVisible({ key: k }));
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
/* consultar um PR por URL: abre a conversa salva mesmo que ele não esteja na lista
   (some do "Revisões recentes" por escopo ou pelo limite de 30). Reusa o chat. */
$('#lookupForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = ($('#lookupUrl').value || '').trim();
  const m = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/i);
  if (!m) { toast('error', 'Cole a URL de um PR do GitHub (…/pull/NN).'); return; }
  openChat(`${m[1]}#${m[2]}`, url);
  $('#lookupUrl').value = '';
});

/* ---------- render: decisoes pendentes ---------- */
function renderDecisions() {
  // guarda de foco: não reconstrói os cards enquanto você mexe no seletor de papel
  // (ou em outro input) de um card; ainda assim atualiza Revisões recentes
  const dbox = $('#decisions');
  if (document.activeElement && dbox.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) { renderResolved(); return; }
  const pending = (STATE.decisions?.pending || []).filter(scopeVisible);
  const wrap = $('#decisionsWrap');
  wrap.hidden = pending.length === 0;
  $('#decisionsCount').textContent = pending.length;
  if (!pending.length) { $('#decisions').innerHTML = ''; renderResolved(); return; }
  $('#decisions').innerHTML = pending.map(d => {
    const m = acctMark(d);
    const author = (d.pr && d.pr.author) || d.author || '';
    return `
    <div class="card decision" data-id="${esc(d.id)}" data-url="${esc(d.pr?.url || '')}" style="${m.style}">
      <div class="decision-head">
        <span class="verdict ${d.verdict === 'approve' ? 'approve' : 'rc'}">${d.verdict === 'approve' ? 'APROVÁVEL' : 'COM BLOCKER'}</span>
        <a class="dec-ref" href="${esc(d.pr?.url || '#')}" target="_blank" rel="noreferrer">${esc(d.key)}</a>
        ${m.chip}
        ${d.card ? `<span class="pill">${esc(d.card)}</span>` : '<span class="pill">sem card</span>'}
        <span class="dec-when">${fmtClock(d.createdAt)}</span>
      </div>
      ${d.pr?.title ? `<div class="dec-title">${esc(d.pr.title)}</div>` : ''}
      ${author ? `<div class="dec-author">PR de <b>@${esc(author)}</b> ${papelPicker(author)}</div>` : ''}
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

/* ---------- pushback: registrar quando o autor contesta um review ---------- */
const PB_OPTS = [['', 'sem pushback'], ['author_right', 'o autor tinha razão'], ['we_right', 'nós tínhamos razão'], ['mixed', 'meio-termo']];
const PB_SHORT = { author_right: 'autor tinha razão', we_right: 'nós tínhamos razão', mixed: 'meio-termo' };
function pushbackOf(key) { return (STATE.pushbacks || {})[key] || null; }
function pushbackControl(r) {
  const author = (r.pr && r.pr.author) || r.author || '';
  if (!author) return '';
  const pb = pushbackOf(r.key);
  const pending = pb && pb.status === 'pending';    // auto em dúvida: pede confirmação
  const sum = pending ? `↩ confirmar: ${esc(PB_SHORT[pb.outcome] || 'pushback')}?`
    : pb ? `↩ ${esc(PB_SHORT[pb.outcome] || 'pushback')}${pb.source === 'auto' ? ' (auto)' : ''}`
      : '↩ pushback?';
  const title = pending ? 'O Farol suspeita de pushback aqui; confirme ou corrija o desfecho'
    : 'Marque se o autor contestou este review, pra calibrar os reviews futuros dele';
  return `<details class="pushback"${pb ? ' data-set="1"' : ''}${pending ? ' data-pending="1" open' : ''}>
    <summary title="${title}">${sum}</summary>
    <div class="pb-body">
      ${pending ? `<span class="pb-hint">O Farol detectou possível pushback${pb.note ? ` (${esc(pb.note)})` : ''}. Confirme o desfecho:</span>` : ''}
      <select class="pb-outcome" data-key="${esc(r.key)}" data-author="${esc(author)}">
        ${PB_OPTS.map(([v, t]) => `<option value="${v}"${pb && pb.outcome === v ? ' selected' : ''}>${t}</option>`).join('')}
      </select>
      <input class="pb-note" data-key="${esc(r.key)}" data-author="${esc(author)}" value="${esc(pb && pb.note || '')}" placeholder="nota curta (opcional)" spellcheck="false" maxlength="300">
    </div>
  </details>`;
}
function submitPushback(el) {
  const box = el.closest('.pushback'); if (!box) return;
  const sel = box.querySelector('.pb-outcome'), note = box.querySelector('.pb-note');
  const key = sel.dataset.key, author = sel.dataset.author, outcome = sel.value;
  const noteVal = outcome ? (note.value || '').trim() : '';
  const map = { ...(STATE.pushbacks || {}) };   // otimista, pra o controle não piscar
  if (outcome) map[key] = { author: String(author).toLowerCase(), outcome, note: noteVal, at: Date.now(), source: 'manual', status: 'confirmed' };
  else delete map[key];
  STATE.pushbacks = map;
  api('/api/pushback', { key, author, outcome, note: noteVal });
}

function renderResolved() {
  const box0 = $('#resolved');
  // guarda de foco: não re-renderiza enquanto você digita a nota / escolhe o desfecho
  if (document.activeElement && box0.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  const resolved = (STATE.decisions?.resolved || []).filter(scopeVisible);
  const wrap = $('#resolvedWrap');
  wrap.hidden = resolved.length === 0;
  if (!resolved.length) { $('#resolved').innerHTML = ''; return; }
  const labels = {
    auto_approved: ['✅', 'aprovado sozinho'],
    auto_rejected: ['🔴', 'mudanças pedidas sozinho'],
    posted: ['📬', 'postado por você'],
    already_reviewed: ['✔', 'já revisado por você (não repostei)'],
    skipped: ['⏭', 'pulado']
  };
  const actions = { approve: 'APPROVE', request_changes: 'REQUEST CHANGES', comment: 'COMMENT' };
  $('#resolved').innerHTML = resolved.map(r => {
    const [icon, label] = labels[r.status] || ['•', r.status];
    const act = (r.status === 'posted' || r.status === 'already_reviewed') ? ` (${actions[r.action] || r.action})` : '';
    // pontos de atenção de um PR aprovado sozinho: ficam claros aqui (expansível)
    const attn = (r.attention && r.attention.length) ? r.attention : ((r.status === 'auto_approved' || r.status === 'auto_rejected') ? (r.reasons || []) : []);
    const hasAttn = attn.length > 0;
    const attnLabel = r.status === 'auto_rejected' ? `motivo${attn.length > 1 ? 's' : ''} do pedido de mudanças` : `ponto${attn.length > 1 ? 's' : ''} de atenção`;
    const attnHtml = hasAttn
      ? `<details class="resolved-attn"><summary>⚠ ${attn.length} ${attnLabel}</summary><ul class="dec-reasons">${attn.map(p => `<li>${esc(p)}</li>`).join('')}</ul></details>`
      : '';
    return `<div class="row ${hasAttn ? 'has-attn' : ''}">
      <span>${icon}</span>
      <span class="ref"><a href="${esc(r.pr?.url || '#')}" target="_blank" rel="noreferrer">${esc(r.key)}</a></span>
      <span class="title">${label}${act}${r.card ? ` · ${esc(r.card)}` : ''}${attnHtml}</span>
      ${pushbackControl(r)}
      <button class="btn sm ghost act-chat" data-key="${esc(r.key)}" data-url="${esc(r.pr?.url || '')}">💬${chatBadge(r.key)}</button>
      <span class="when">${fmtClock(r.resolvedAt)}</span>
    </div>`;
  }).join('');
}

/* ---------- render: radar ---------- */
function renderQueue() {
  // guarda de foco: não reconstrói a fila enquanto você mexe no seletor de papel de um card
  const qbox = $('#queue');
  if (document.activeElement && qbox.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
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
    <div class="card pr-card" data-key="${esc(pr.key)}" data-url="${esc(pr.url)}" style="${m.style}">
      ${m.dot}${avatar(pr.author)}
      <div class="info">
        <div class="pr-ref"><a href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.key)}</a>${m.chip}${pr.reRequested ? '<span class="badge rev-pend">pedida de novo</span>' : ''}</div>
        <div class="pr-title" title="${esc(pr.title)}">${esc(pr.title)}</div>
        <div class="pr-sub"><span class="author">@${esc(pr.author)}</span> · atualizado ${fmtRel(pr.updatedAt)}${pr.author ? ` ${papelPicker(pr.author)}` : ''}</div>
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
    // re-request (o autor pediu sua revisão DE NOVO): não é mais "resolvido/aguardando o
    // autor", voltou a ser acionável (a review antiga foi dismissed no GitHub).
    const reviewed = (kind === 'approve' || kind === 'request_changes') && !pr.reRequested;
    const isPending = kind === 'pending';
    // stale = você revisou e entrou commit novo depois: o "Re-revisar" volta a valer
    const stale = reviewed && !!(STATE.staleStates || {})[pr.key];
    const showBtn = (!reviewed || stale) && !isPending && !busy.has(pr.key);
    const settledLabel = kind === 'request_changes' ? 'aguardando o autor' : isPending ? 'aguardando você' : reviewed ? 'nada a fazer' : '';
    const tail = busy.has(pr.key)
      ? '<button class="btn sm ghost pano-review" disabled>Revisando…</button>'
      : showBtn
        ? `<button class="btn sm ghost act-review pano-review" data-url="${esc(pr.url)}" title="${pr.reRequested ? 'O autor pediu sua revisão de novo (re-request): a review anterior foi dispensada' : stale ? 'Entrou commit novo depois da sua review: revisar de novo' : pr.mine ? 'Revisar (seu review pedido)' : 'Revisar sob demanda: o resultado sempre passa por você, nada é postado sozinho'}">${stale || pr.reRequested ? 'Re-revisar' : 'Revisar'}</button>`
        : `<span class="settled">${esc(settledLabel)}</span>`;
    return `
    <div class="row ${pr.mine ? 'mine' : ''} ${chip ? 'reviewed' : ''}" style="${m.varStyle}${m.dim}">
      <span class="status-dot"></span>
      <span class="ref"><a href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.key)}</a></span>
      ${SCOPE === 'all' && m.chip ? m.chip : (pr.mine ? '<span class="badge">sua revisão</span>' : '')}
      ${pr.reRequested ? '<span class="badge rev-pend">pedida de novo</span>' : ''}
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
    confirmModal({
      title: `Mergear ${key}?`, danger: true, confirmLabel: 'Mergear', cancelLabel: 'Cancelar',
      body: `<p>O Farol vai:</p>
        <ul>
          <li>te <b>atribuir ao PR</b> se você ainda não estiver;</li>
          <li>fazer o <b>merge commit</b> na branch de destino;</li>
          <li><b>deletar a branch de origem</b> se for descartável (feature/fix/task…), preservando develop/release/main.</li>
        </ul>
        <p>Isso <b>escreve no GitHub</b> e não dá pra desfazer com um clique.</p>`
    }).then(ok => {
      if (!ok) return;
      mrg.disabled = true; mrg.textContent = 'Mergeando…';
      api('/api/self-review/merge', { url: mrg.dataset.url }).then(r => {
        if (r?.ok) return; // sucesso: o state push atualiza a tela
        if (r?.blocked === 'policy') {
          mergeBlockedByPolicy.add(key); renderMyPRs();
          toast('info', 'A branch de destino tem proteção. Escolha: Auto-merge (espera os requisitos) ou Merge (admin).', 6000);
          return;
        }
        toast('error', esc(r?.error || 'não consegui mergear'));
        mrg.disabled = false; mrg.textContent = 'Merge';
      });
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
    confirmModal({
      title: `Merge como ADMIN de ${key}`, danger: true, confirmLabel: 'Merge como admin', cancelLabel: 'Cancelar',
      body: `<p>Isso <b>bypassa a proteção da branch</b> e mergeia <b>agora</b>, ignorando revisões e checks obrigatórios. Só funciona se você for admin do repo.</p>
        <p><b>Você está passando por cima do gate de review do time.</b> Use com consciência. Quando der, prefira o <b>Auto-merge</b>: ele espera os requisitos passarem, sem furar nada.</p>`
    }).then(ok => {
      if (!ok) return;
      mAdmin.disabled = true; mAdmin.textContent = 'Mergeando…';
      api('/api/self-review/merge', { url: mAdmin.dataset.url, mode: 'admin' }).then(r => {
        if (r?.ok) { mergeBlockedByPolicy.delete(key); return; } // state push atualiza
        if (r?.blocked === 'rule') { adminUnavailableKeys.add(key); renderMyPRs(); return; }
        toast('error', esc(r?.error || 'não consegui mergear como admin'));
        mAdmin.disabled = false; mAdmin.textContent = 'Merge (admin)';
      });
    });
    return;
  }
  const clr = e.target.closest('.act-self-clear');
  if (clr) api('/api/self-review/clear', { key: clr.dataset.key });
});

/* ---------- render: versão e atualização ---------- */
/* ---------- Consumo de tokens (tela própria, charts em SVG puro) ---------- */
const usageState = { metric: 'total', window: 30, dim: 'kind' };
function fmtTok(n) { return Number(n || 0).toLocaleString('pt-BR'); }
function fmtCompact(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(Math.round(n));
}
function usageMetricVal(b, m) {
  b = b || {};
  if (m === 'input') return b.inputTokens || 0;
  if (m === 'output') return b.outputTokens || 0;
  if (m === 'cache') return (b.cacheReadTokens || 0) + (b.cacheCreationTokens || 0);
  return (b.inputTokens || 0) + (b.outputTokens || 0); // total
}
// chaves de dia (UTC, batendo com o server) dos últimos n dias, incluindo hoje
function usageDayKeysBack(n) {
  const out = [], d = new Date(); d.setUTCHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getTime()); x.setUTCDate(d.getUTCDate() - i); out.push(x.toISOString().slice(0, 10)); }
  return out;
}

// linha do tempo: barras por dia na janela escolhida, métrica escolhida (SVG)
function drawUsageTimeline(el, series, metric, win) {
  const map = {}; for (const d of (series || [])) map[d.day] = d;
  const data = usageDayKeysBack(win).map(day => ({ day, v: usageMetricVal(map[day], metric) }));
  if (!data.some(d => d.v > 0)) { el.innerHTML = '<div class="usage-empty">Sem consumo nesta janela.</div>'; return; }
  const max = Math.max(1, ...data.map(d => d.v));
  const W = 820, H = 200, padL = 46, padR = 8, padT = 10, padB = 22;
  const cw = W - padL - padR, ch = H - padT - padB, n = data.length, bw = cw / n, barW = Math.max(1.2, bw * 0.68);
  const yOf = v => padT + ch * (1 - v / max);
  const grid = [max, max / 2, 0].map(v => {
    const yy = yOf(v);
    return `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" class="ugrid"/>`
      + `<text x="${padL - 6}" y="${(yy + 3.5).toFixed(1)}" class="uaxis uaxis-y">${fmtCompact(v)}</text>`;
  }).join('');
  const bars = data.map((d, i) => {
    const x = padL + i * bw + (bw - barW) / 2, h = ch * (d.v / max);
    return `<rect class="ubar-rect" x="${x.toFixed(1)}" y="${(padT + ch - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="1.5"><title>${d.day.slice(8, 10)}/${d.day.slice(5, 7)}: ${fmtTok(d.v)}</title></rect>`;
  }).join('');
  const step = Math.ceil(n / 10);
  const xlab = data.map((d, i) => (i % step === 0 || i === n - 1)
    ? `<text class="uaxis uaxis-x" x="${(padL + i * bw + bw / 2).toFixed(1)}" y="${H - 6}">${d.day.slice(8, 10)}/${d.day.slice(5, 7)}</text>` : '').join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="usvg">${grid}${bars}${xlab}</svg>`;
}

// quebra: barras horizontais por tipo/conta/modelo (HTML), métrica escolhida
function drawUsageBreakdown(el, items, metric) {
  const vals = (items || []).map(x => ({ label: x.label || '', v: usageMetricVal(x, metric), s: x.sessions }))
    .filter(x => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 10);
  if (!vals.length) { el.innerHTML = '<div class="usage-empty">Sem dados ainda.</div>'; return; }
  const max = Math.max(1, ...vals.map(x => x.v));
  el.innerHTML = vals.map(x => `<div class="ubar-row"><span class="ubar-label" title="${esc(x.label)}">${esc(x.label)}</span>`
    + `<span class="ubar-track"><span class="ubar-fill" style="width:${(x.v / max * 100).toFixed(1)}%"></span></span>`
    + `<span class="ubar-val">${fmtTok(x.v)}<small> · ${x.s}s</small></span></div>`).join('');
}

function renderUsage() {
  const u = STATE && STATE.usage;
  const statsEl = $('#usageStats'), tl = $('#usageTimeline'), bd = $('#usageBreakdown');
  if (!statsEl || !tl || !bd) return;
  if (!u || !u.totals || !u.totals.sessions) {
    statsEl.innerHTML = '';
    tl.innerHTML = '<div class="usage-empty">Nenhuma sessão registrada ainda. Quando o Farol rodar uma revisão, autoanálise, pushback, ferramenta ou chat, o consumo aparece aqui.</div>';
    bd.innerHTML = '';
    return;
  }
  const stat = (label, b, extra) => `<div class="usage-stat"><span class="us-label">${label}</span>`
    + `<b>${fmtTok((b.inputTokens || 0) + (b.outputTokens || 0))}<small> tokens</small></b>`
    + `<span class="us-sub">${fmtTok(b.inputTokens)} in · ${fmtTok(b.outputTokens)} out · ${b.sessions}s${extra || ''}</span></div>`;
  const costNote = u.totals.costUsd > 0 ? ` · ~US$ ${u.totals.costUsd.toFixed(2)}` : '';
  statsEl.innerHTML = stat('Total', u.totals, costNote) + stat('Hoje', u.today) + stat('7 dias', u.last7) + stat('30 dias', u.last30);
  drawUsageTimeline(tl, u.series, usageState.metric, usageState.window);
  const data = usageState.dim === 'account' ? u.byAccount : usageState.dim === 'model' ? u.byModel : u.byKind;
  drawUsageBreakdown(bd, data, usageState.metric);
}

function wireUsageControls() {
  const bind = (sel, attr, key, cast) => {
    const box = document.querySelector(sel); if (!box) return;
    box.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
      box.querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      usageState[key] = cast ? cast(b.dataset[attr]) : b.dataset[attr];
      renderUsage();
    }));
  };
  bind('#usageMetric', 'metric', 'metric');
  bind('#usageWindow', 'window', 'window', Number);
  bind('#usageDim', 'dim', 'dim');
}
wireUsageControls();

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

/* ---------- perfil de review por pessoa: papel + matriz por domínio ----------
   Molda o TOM e a POSTURA da revisão automática, nunca a decisão. */
const PAPEL_OPTS = [['', 'papel'], ['estagio', 'Estágio'], ['junior', 'Júnior'], ['pleno', 'Pleno'], ['senior', 'Sênior'], ['techlead', 'Tech Lead'], ['arquiteto', 'Arquiteto'], ['especialista', 'Especialista']];
const DOMAIN_DEFS = [['backend', 'Backend'], ['frontend', 'Frontend'], ['dados', 'Dados'], ['infra', 'Infra']];
const DOMLEVEL_OPTS = [['', 'sem info'], ['basico', 'Básico'], ['intermediario', 'Interm.'], ['avancado', 'Avançado'], ['autoridade', 'Autoridade']];
function personOf(login) { return ((STATE.config && STATE.config.people) || {})[String(login || '').toLowerCase()] || {}; }
function papelOf(login) { return personOf(login).papel || ''; }
function domLevelOf(login, d) { return (personOf(login).dominios || {})[d] || ''; }
// papel (compacto): usado nos cards do PR e no cabeçalho do card do time
function papelPicker(login) {
  return `<select class="papel-level" data-login="${esc(login)}" title="Papel de @${esc(login)}: molda o tom da revisão automática, nunca a decisão">
    ${PAPEL_OPTS.map(([v, t]) => `<option value="${v}"${papelOf(login) === v ? ' selected' : ''}>${t}</option>`).join('')}
  </select>`;
}
// matriz por domínio (só na aba Time): competência por área calibra a postura
function domainMatrix(login) {
  return `<div class="dom-matrix">${DOMAIN_DEFS.map(([d, label]) => `
    <label class="dom-cell"><span class="dom-name">${label}</span>
      <select class="dom-level" data-login="${esc(login)}" data-domain="${d}" title="Competência de @${esc(login)} em ${label}">
        ${DOMLEVEL_OPTS.map(([v, t]) => `<option value="${v}"${domLevelOf(login, d) === v ? ' selected' : ''}>${t}</option>`).join('')}
      </select></label>`).join('')}</div>`;
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
        ${papelPicker(m.login)}
      </div>
      <div class="member-profile">
        <span class="mp-label">Competência por domínio</span>
        ${domainMatrix(m.login)}
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
  ['2.26.0', ['PR grande agora é revisado em lotes, por vários revisores em paralelo: acima de 1000 linhas ou 20 arquivos, o Farol divide os arquivos em 2 a 4 lotes coesos (por afinidade de pasta) e dispara um revisor por lote ao mesmo tempo, cada um lendo por completo só o lote dele e ciente do que está nos outros, com consolidação num relatório único. Motivo medido em 44 reviews reais: o tamanho dos PRs varia 4359x e o do relatório varia 3x, e nos PRs acima de 2000 linhas 3 de 5 saíram sem nenhuma citação ancorada. A revisão também passa a declarar quantos arquivos do diff realmente cobriu: se ficou algum de fora, o PR vai pra "Precisa da sua atenção" em vez de aprovar sozinho. E aprovando com ressalva, a ressalva agora aparece no PR escrita com naturalidade (o que é assunto interno nosso continua só no app). PR abaixo do limiar segue igual.']],
  ['2.25.0', ['Quando outra ferramenta já revisou o PR (Acrity, Sonar, Snyk, ou um colega), o Farol forma o veredito dele pelo código e pelo card ANTES de ler o review alheio, e adota o apontamento real que passou pela nossa revisão. Discordar virou exceção com barra alta: quatro rótulos (falso positivo, fora do escopo pactuado, pré-existente, critério não vigente), cada um exigindo prova própria (arquivo:linha que refuta, o texto que documenta o adiamento, o diff, ou a contagem medida). Sem prova, ele fica calado e entrega só a análise dele. E contestação nunca sai sozinha: qualquer discordância força "Precisa da sua atenção", com o apontamento e a prova na tela, mesmo com aprovação automática ligada.']],
  ['2.24.2', ['Re-request de review (autor pede sua revisão de novo num PR que você já revisou) agora é identificado de forma confiável e volta a ser revisado sozinho, sem precisar de clique. A detecção comparava dois resultados de busca diferentes do GitHub, e a segunda tem indexação assíncrona, então às vezes ficava atrasada e o re-request nunca era reconhecido. Agora o sinal vem do histórico local do próprio Farol, instantâneo.']],
  ['2.24.1', ['Mini-navegação no topo do Radar: barra de âncoras só com as seções que têm algo agora (com contagem), clique rola suave até lá. E a paleta de comando (Ctrl+K / Cmd+K): busca central pra ir a qualquer aba/seção, disparar Verificar agora ou Alternar tema, e reconhece URL ou key (org/repo#NN) de PR pra abrir a conversa na hora. Navega com as setas, Enter confirma, Esc fecha.']],
  ['2.24.0', ['Fluidez: clicar num alerta de revisão agora leva direto ao card do PR (a tela rola e destaca com um pulso); o ícone na barra de tarefas ganha uma bolinha (Windows) ou número no Dock (macOS) enquanto houver decisão esperando, com a contagem no tooltip da bandeja; e chegaram atalhos de teclado (J/K navegam nas decisões, A aprova, M pede mudanças, C comenta, P pula, / consulta PR por URL, 1 a 6 trocam de aba, ? mostra a lista). Com a janela em foco, o aviso fica só no app, sem duplicar na notificação do sistema.']],
  ['2.23.8', ['Os alertas de revisão agora dizem o desfecho e o motivo, sem o tom de "sem você": "Aprovado sem ressalvas" (revisão completa, nenhum ponto de atenção), "Aprovado com ressalvas" (mostra a primeira ressalva e aponta pra Revisões recentes), "Reprovado" (com o motivo) e "Precisa da sua atenção" (lidera com o motivo, não com uma contagem). Vale pra notificação do sistema, pros avisos dentro do app e pra notificação do navegador.']],
  ['2.23.7', ['O pushback (detecção automática de contestação do autor) agora só aparece quando o seu review de fato apontou algo: PR que você bloqueou (pediu mudanças) ou aprovou com ressalva. Aprovação limpa, sem nenhum ponto de atenção, deixa de gerar pushback (antes qualquer review seu entrava no scan). A resposta do autor depois do review continua sendo condição. Esta aba Novidades também voltou a listar todas as versões (tinha parado na 2.23.4).']],
  ['2.23.6', ['Correções do macOS. O Farol agora abre de verdade pelo Finder, Spotlight e Launchpad (o lançador executa o binário nativo do Electron direto, sem depender de node no PATH; antes, aberto pelo Finder com PATH mínimo, morria em silêncio, sem janela e sem log). A janela sobe na frente e com foco, na abertura e no clique seguinte no ícone (antes subia atrás de tudo e sem foco, parecendo que não tinha aberto). E o ícone do Farol aparece certo no Finder/Spotlight (o .icns vem no pacote) e no Dock em execução (antes era o ícone cru do Electron). Primeira correção validada num Mac de verdade (Apple Silicon), vinda do PR #3 de @thiagocarvalho-dev.']],
  ['2.23.5', ['Acabou o "terminal piscando": aquela janela de console que abria e fechava sozinha de tempos em tempos enquanto o Farol rodava. A causa não era um comando do Farol (todos já rodam com janela oculta), era a telemetria do GitHub CLI, que dispara um processo próprio desanexado (gh send-telemetry) e, sem console herdado, faz o Windows abrir um console novo visível. O Farol agora desliga a telemetria do gh em tudo o que dispara (GH_TELEMETRY=false, o desligamento oficial documentado pelo GitHub CLI), cobrindo os comandos diretos, os gh de dentro das revisões e as sessões de terminal.']],
  ['2.23.4', ['Quando o autor pede sua revisão de novo (re-request) num PR que você já revisou, o Farol volta a mostrar o PR na sua fila como "pedida de novo" (com botão "Re-revisar"), em vez de deixá-lo preso no Panorama como "aguardando o autor". Antes, por já ter sido visto na 1ª revisão, a re-solicitação não reaparecia na sua tela. Também: novo interruptor "Registrar processos (diagnóstico)" em Sistema, pra caçar "terminal piscando" (loga em spawns.log cada comando que o Farol dispara, com horário, sem token).']],
  ['2.23.3', ['A interface responde melhor a janelas estreitas (o app já tem bastante aba e painel): em telas menores a barra de abas encolhe e rola em vez de estourar o topo, o botão "Verificar agora" vira só o ícone, e as linhas de lista e barras de ação quebram em vez de cortar botão ou texto. Em telas largas nada muda.']],
  ['2.23.2', ['A aba Consumo não mostra mais a barra de filtro por conta no topo: ali a medição é do Farol como um app (uso total de tokens), não de uma conta, então o filtro não se aplicava e só dava sensação de bug (trocar a conta e o número não mudar). A quebra "Por conta", que é explícita, continua, e o texto da tela deixa claro que mede o Farol como um todo.']],
  ['2.23.1', ['Ajuste do Consumo de tokens (da v2.23.0): virou uma tela própria (aba Consumo, saiu da Sistema), dedicada a acompanhar o uso das sessões autônomas do Claude. Agora com gráficos: uma linha do tempo (barras por dia) com métrica selecionável (total, input, output, cache) e janela selecionável (7, 30, 90 dias), e uma quebra por tipo, conta ou modelo. Continua sendo só rastreio pessoal, não influencia nenhuma decisão. E o registro ficou permanente: saiu o botão de zerar.']],
  ['2.23.0', ['Novo painel Consumo de tokens (aba Sistema): mostra quanto as sessões autônomas do Claude gastaram (revisão, autoanálise, pushback, ferramentas e chat), com total, hoje e últimos 7 dias, e quebras por tipo, por conta e por modelo. É só rastreio pra você ter noção do gasto no dia a dia, não muda nada na automação: a qualidade segue sendo o único critério das decisões. Registro local, sem custo extra. Também: "Revisões recentes" passa a mostrar 30 na tela (era 8) e guardar 200 no histórico (era 30).']],
  ['2.22.0', ['Nova aba Entregas: veja os PRs mergeados (por qualquer pessoa, não só o que o Farol revisou), agrupados por repositório ou por responsável, com o período escolhível (hoje, 7, 15 ou 30 dias). A visão é por organização: a sua principal já vem selecionada e você troca pra outra org num clique (com mais de uma conta, cada org aparece com a conta dona). É a visão de atualização dos projetos e de quem está entregando. Só leitura.']],
  ['2.21.0', ['As revisões que o Farol posta passam a parecer escritas por você, não por um bot. Saíram os carimbos de automação ("aprovado automaticamente pelo Farol", "por isso não auto-aprovei") e o formato rígido de template (caixas de alerta, Placar, checklist de critérios, prefixos "suggestion (non-blocking)"). O review sai no seu tom, direto e sem travessão, e o formato se adapta à senioridade do autor: estágio/júnior vira prosa de mentor; pleno/sênior/arquiteto fica enxuto e direto. Usa todo o perfil da pessoa pra personalizar, sem mudar a decisão nem o rigor. As ressalvas de um PR auto-aprovado seguem visíveis em Revisões recentes, só não vão mais coladas no PR.']],
  ['2.20.0', ['Dá pra consultar a conversa de qualquer PR pela URL. Um campo discreto embaixo de "Revisões recentes": cole a URL do PR e o Farol abre o chat salvo daquele review, mesmo que o PR já tenha saído da lista (pelo limite de 30 recentes ou por estar numa conta que não é a selecionada). Reusa o painel de chat de sempre, o resto do fluxo não muda, e as conversas ficam guardadas mesmo depois que a revisão sai do histórico.']],
  ['2.19.1', ['Qualidade de volta como padrão. Na v2.19.0 eu tinha posto Sonnet e o pushback desligado como padrão (mirando economia); revertido. O padrão volta a ser o Opus (melhor) e o pushback automático ligado. As opções de economia (Sonnet/Haiku, desligar pushback) seguem em Sistema pra quem quiser, mas não são o padrão. E o conserto que importa fica: se o limite do plano estourar, o Farol retoma sozinho no reset, sem largar o PR sem análise.']],
  ['2.19.0', ['O Farol passa a gastar bem menos do teu limite do Claude. As revisões automáticas agora rodam em Sonnet por padrão (consome muito menos do teto do plano que o Opus); dá pra trocar o modelo em Sistema, e a sessão de terminal não muda. A detecção automática de pushback virou opt-in (roda uma sessão do Claude por PR contestado, então vem desligada; a marcação manual segue sempre). E quando uma revisão falha por algo transitório (limite do plano atingido, rede, claude indisponível), o Farol retoma sozinho no próximo ciclo em vez de largar o PR na fila sem análise.']],
  ['2.18.0', ['Dá pra escolher qual assinatura do Claude o Farol usa. No campo "Assinatura do Claude" (Sistema), aponte um diretório de config próprio logado noutra conta, e as sessões do Farol (automáticas e de terminal) passam a usar aquela assinatura, sem mexer no seu login principal do claude (o de codar). Útil pra não deixar as revisões e a classificação de pushback comendo a sua conta de trabalho. Faça claude login nesse diretório uma vez; a aba Saúde mostra a conta em uso e avisa se faltar login. Alternar de assinatura é só trocar o caminho (vazio volta pra padrão da máquina).']],
  ['2.17.0', ['O pushback passou a ser detectado sozinho, direto do PR. Quando o autor contesta um review seu (responde, rebate, re-pede review), o Farol percebe e classifica o desfecho (autor tinha razão, você tinha, ou meio-termo) sem você marcar à mão. Funciona assim: um gatilho barato vê se o autor teve atividade depois do seu review; só aí o Farol lê a thread (leitura pura, nunca posta) pra julgar. Desfecho claro entra sozinho; em dúvida, aparece um "confirmar?" em Revisões recentes com o desfecho sugerido, pra você resolver num toque só os ambíguos. Isso calibra o tom dos reviews futuros da pessoa, sem mexer na decisão técnica. A marcação manual segue como correção quando você discordar do que o Farol inferiu.']],
  ['2.16.1', ['Pente-fino de uma revisão do projeto. Correções: não duplica mais a revisão de um PR que já estava em análise (clique ou dois cliques rápidos); aprovação por conta mais segura (se os PRs impecáveis aguardam sua ação, os com ressalva também aguardam, corrigindo um caso de configuração invertida); o seletor de papel no card do PR não fecha mais sozinho no meio da escolha; e o kudos sempre mostra a conta certa ao abrir Destaques. Esta lista de novidades também recuperou as versões 2.0.0 e 1.19.0 que tinham sido puladas.']],
  ['2.16.0', ['O Farol passa a lembrar dos pushbacks. Quando um review seu é contestado, você registra na linha de "Revisões recentes" o desfecho (o autor tinha razão, nós tínhamos razão, ou meio-termo) e uma nota curta opcional. Nas próximas revisões automáticas daquela pessoa, o Farol leva esse histórico em conta pra calibrar a postura: onde ela já mostrou que estava certa, afirma com mais humildade antes de apontar algo parecido; onde você estava certo, mantém a posição. Mexe só no tom e na postura, nunca na decisão técnica.']],
  ['2.15.0', ['A senioridade virou um perfil de verdade, com dois eixos. O papel cobre carreira e posição (Estágio, Júnior, Pleno, Sênior, mais Tech Lead, Arquiteto e Especialista) e dá o tom-base. A matriz por domínio (Backend, Frontend, Dados, Infra, de Básico a Autoridade) reconhece que a pessoa pode ser autoridade numa área e estar começando em outra: onde é autoridade o review defere e foca no alto nível; onde está começando, explica mais e cuida dos fundamentos. Segue mexendo só no tom e na postura, nunca na decisão técnica. O papel se marca no card do PR e na aba Time; a matriz fica na aba Time. Quem já estava marcado como Estágio/Júnior/Pleno/Sênior migra sozinho pro papel.']],
  ['2.14.0', ['Agora dá pra marcar a senioridade de alguém direto do card do PR (na fila e em "Precisa de você"), não só na aba Time. Antes, como a aba Time só lista quem já foi revisado ao menos uma vez, o primeiro PR de alguém novo saía sempre no tom neutro; agora você marca no momento em que vê o PR e a revisão já sai no tom certo. É a mesma marcação por pessoa, só com mais um lugar pra fazer.']],
  ['2.13.0', ['Contas diferentes agora são revisadas em paralelo: cada conta roda a sua revisão ao mesmo tempo (a BIUD e a pessoal juntas, por exemplo), em vez de uma por vez no total. Dentro da mesma conta segue uma de cada vez, pra não sobrecarregar a máquina. Assim, uma análise demorada de uma conta não segura mais a fila das outras.']],
  ['2.12.1', ['Correção: "Analisando agora" e a fila do Radar agora respeitam a conta selecionada. Antes, a revisão em andamento aparecia igual em qualquer conta (misturava trabalho e pessoal enquanto o Farol analisava um PR); agora filtra pela conta escolhida, e em "Todas" mostra tudo. As outras seções já respeitavam.']],
  ['2.12.0', ['Senioridade por pessoa, na aba Time: marque cada pessoa como Estágio, Júnior, Pleno ou Sênior, e a revisão automática ajusta o TOM e a forma de comunicar o veredito de acordo. Com um estágio, reconhece a iniciativa e enquadra os ajustes como aprendizado (sem desanimar, mesmo pedindo mudança); com uma pessoa sênior, vai direto ao ponto. Muda só a linguagem: a decisão técnica (aprovar, pedir mudanças, o card, o gate) continua igual pra todo mundo, pelos fatos do código. Quem você não marcar recebe o tom neutro de antes. Vale na revisão que o Farol posta sozinho; a sessão de terminal segue como está.']],
  ['2.11.0', ['A automação por conta ficou mais fiel ao que você pediu. (1) "Revisa na hora" agora vale pros PRs que JÁ estavam na fila da conta, não só os que acabaram de chegar (era o "configurei e não agiu"); PRs cancelados ou que falharam sem ser rede ficam de fora até você reabrir. (2) Quando um aprovável fica esperando por causa da sua política (ex.: aprovável com ressalvas e a conta manda aguardar), o motivo agora diz isso claramente, em vez de mostrar só os pontos técnicos. (3) Nova alavanca opt-in por conta "quando tem bloqueios": por padrão espera você, mas dá pra ligar "reprova sozinho", aí num review pedido a você e com bloqueios reais o Farol posta o "pedir mudanças" com os pontos anexados (marcado como automático). Desligada por padrão; clique no panorama nunca posta; não re-pede mudanças se você já pediu.']],
  ['2.10.0', ['Os Kudos compilados agora respeitam a conta selecionada: cada conta tem a sua compilação, gerada só com os destaques daquela conta, e o painel some quando a conta ainda não tem kudos (em "Todas" compila tudo). Antes o mesmo resumo aparecia em qualquer conta, misturando trabalho e pessoal. Junto, os rótulos da automação por conta foram reescritos pra ficarem óbvios ("quando chega um PR pra você", "quando fica aprovável sem/com ressalvas", "revisa na hora", "aprova e destaca as ressalvas", "espera você aprovar"), com uma linha lembrando que o que você não escolher segue o padrão geral.']],
  ['2.9.0', ['Política automática por conta, no painel Contas (aba Sistema): cada conta do GitHub decide sozinha como o Farol age. São três controles próprios por conta, quando chega revisão (revisa sozinho, só põe na fila ou herda o padrão global), PR aprovável sem ressalva (aprova sozinho ou aguarda você) e PR aprovável com ressalva (aprova ressaltando os pontos de atenção ou aguarda sua ação). A conta do trabalho pode revisar e aprovar sozinha o que é seguro, a pessoal só põe na fila e espera você, sem misturar as regras. O que você não configurar por conta herda o padrão global (os dois toggles gerais em Sistema).']],
  ['2.8.3', ['Confirmação com impacto nas ações que escrevem no GitHub: Merge, Merge como admin e Pedir mudanças agora abrem a caixa de confirmação (como o Remover conta), explicando o que a ação faz e o que ela mexe, no lugar do aviso genérico do navegador. O Merge admin, que fura o gate de review do time, ganha o aviso mais forte.']],
  ['2.8.2', ['Instalador BETA de macOS (Apple Silicon) anexado à release: o Farol-Instalar-mac.command foi montado aqui mesmo, sem um Mac, embutindo o Electron pra o próprio Mac descompactar (assim os symlinks do app ficam intactos). Como o suporte a macOS nunca rodou num Mac de verdade, é beta: instale (1ª vez: botão direito > Abrir), e se algo quebrar, use "Exportar diagnóstico" (Saúde) e mande. Com esse retorno a gente corrige e libera a versão final.']],
  ['2.8.1', ['Preparação do suporte a macOS: o install.sh passou a garantir o bit de execução do Electron na instalação (robustez pra instalador montado fora do Mac).']],
  ['2.8.0', ['Exportar diagnóstico (Sistema > Saúde): um clique gera um relatório sem segredos (ambiente, contas, config, estado e o log de falhas) pra você copiar e mandar pra quem mantém o Farol. É o jeito de coletar o que precisa pra corrigir um problema, especialmente útil pra destravar o suporte a macOS.', 'Remover conta agora abre uma caixa de confirmação que explica o impacto (o que para de ser monitorado, o que não é apagado, que dá pra readicionar), no lugar do aviso genérico do navegador.']],
  ['2.7.0', ['Editor de contas na aba Sistema: dá pra adicionar e remover conta, e editar o rótulo, a cor, o tipo (Trabalho/Pessoal) e as orgs de cada uma, sem precisar mexer no config.json na mão. O tipo é o que faz a faixa dizer "1 de trabalho e 1 pessoal".', '"Aprovar sozinho tudo que for aprovável" agora vem DESLIGADO por padrão (você liga em Sistema se quiser): mais seguro agora que o app é público e cada pessoa decide o próprio nível de automação.', 'A barra de contas não mostra mais o contador de PRs pendentes fora do Radar (lá ele não tinha a ver com o conteúdo da aba).']],
  ['2.6.1', ['O seletor de reviewers agora lista só quem faz parte daquela organização: antes, ao configurar os reviewers de um projeto, o dropdown misturava as pessoas de todas as orgs monitoradas (na conta pessoal aparecia gente do trabalho, o que não fazia sentido). Cada org passa a oferecer só os próprios membros e times. Org sem membros enumeráveis vira um campo pra digitar o handle na mão.']],
  ['2.6.0', ['Destaques e Time separados por conta: quando você monitora mais de uma conta do GitHub, cada aba agrupa por conta (com a barra de contas de volta pra filtrar), em vez de misturar trabalho e pessoal no mesmo balaio. A partir desta versão a memória do time guarda a org de cada review pra atribuir a conta; registros antigos (sem essa marca) aparecem num grupo "Geral" até o autor ser re-revisado.']],
  ['2.5.0', ['Reviewers por projeto reinventado, o fim da repetição: agora você define um grupo padrão por organização (aplicado a TODOS os repos dela no botão Reviewers), e só os projetos que fogem do padrão aparecem, como um diff enxuto ("padrão − fulano" / "padrão + ciclano"). Os demais colapsam numa linha só. Quem já tinha listas repetidas ganha um botão "Criar padrão" que detecta o grupo comum e recolhe tudo num clique. E o botão "👥 Reviewers" passa a funcionar em qualquer repo da org, mesmo sem config própria, usando o padrão.']],
  ['2.4.2', ['A barra de contas agora aparece só no Radar, onde ela realmente filtra. Nas abas Sistema, Time e Destaques ela sumiu (lá trocar de conta não mudava nada e só confundia): Sistema é global, e Time/Destaques são memória do time.']],
  ['2.4.1', ['Diagnóstico de atualização honesto: quando o Farol não consegue ler as releases (repo sem acesso pra sua conta, sem release ainda, ou rede), a aba Sistema diz isso claramente, em vez de mostrar "você está na versão mais recente" e te deixar sem saber que havia update.']],
  ['2.4.0', ['Aprova sozinho tudo que for aprovável, sem depender do seu clique: quando a revisão conclui que o PR está aprovável, o Farol posta o APPROVE na hora e deixa os pontos de atenção claros (anexados ao próprio PR e visíveis em Revisões recentes). Vale só pros reviews pedidos a você (clique no panorama nunca posta). Dá pra desligar em Sistema > Configurações e voltar a ser chamado nos casos com ressalva.']],
  ['2.3.0', ['Panorama: um PR que você já aprovou volta a mostrar "Re-revisar" quando (e só quando) entra commit novo depois da sua review; sem commit novo, segue como "nada a fazer". O Farol compara o commit da sua última review com o topo atual do PR.']],
  ['2.2.0', ['Reviewers por projeto agora agrupados por conta: cada projeto aparece sob a conta dona (Pessoal, BIUD, etc.), acabando com a lista misturada quando você monitora mais de uma conta']],
  ['2.1.0', ['Separação de contas: barra no topo pra alternar entre Todas e cada conta do GitHub (trabalho, pessoal, mais de um emprego), cada uma com cor e identidade próprias', 'De quem e por quem: cada card mostra o autor do PR (@quem escreveu) separado da sua conta (cor e etiqueta), e ao focar uma conta a faixa diz "revisando e postando como @você"', 'Contas silenciadas: aquele PR-teste antigo que nunca fecha sai do painel e dos avisos sem ser perdido (aparece ao selecionar a conta); ajuste em Sistema > Contas', 'Painel de contas em Sistema pra silenciar/reativar, e reviewers por projeto mais enxuto', 'Panorama: PR que você já aprovou não mostra mais "Re-revisar" (só quando entra commit novo)']],
  ['2.0.0', ['A cara nova do Farol: navegação lateral (Radar, Destaques, Time e Sistema numa barra à esquerda, com a conta sempre à vista e um aviso no Radar quando alguma decisão espera por você), um resumo do dia no topo do Radar (quantas decisões precisam de você, o tamanho da fila, o que está sendo analisado agora e quantos PRs você já revisou hoje, tudo do estado real), e cards e listas mais legíveis, mantendo exatamente os mesmos fluxos.']],
  ['1.19.0', ['Multi-conta: o Farol passa a observar mais de uma conta do GitHub ao mesmo tempo (a do trabalho e a pessoal, por exemplo) e junta os PRs das duas no mesmo painel. Cada PR sabe de qual conta veio, e toda ação (buscar, revisar, comentar, pedir reviewers, mergear) usa o token certo daquela conta, sem misturar identidade. Quem usa uma conta só não muda nada. Ative preenchendo o bloco accounts no ~/.farol/config.json.']],
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
let reviewerCands = {}; // { org: { members, teams } } (candidatos POR organização)
let reviewerCandsLoaded = false;
const openExceptions = new Set(); // repos (owner/repo) com o editor de exceção aberto
const foldedOpen = new Set();     // orgs com a lista "seguem o padrão" expandida
const pendingExc = new Set();     // repos novos sendo criados como exceção

async function loadReviewerCands(force) {
  if (reviewerCandsLoaded && !force) return;
  const r = await get('/api/reviewer-candidates');
  if (r) { reviewerCands = r; reviewerCandsLoaded = true; }
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
  if (isTeam) { const org = rv.split('/')[0]; const t = ((reviewerCands[org] || {}).teams || []).find(t => t.id === rv); return { label: (t ? t.name : rv.split('/').pop()) + ' (time)', cls: 'team' }; }
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
// seletor de adicionar reviewer, SÓ com os candidatos da org. Quando a org não
// tem membros enumeráveis (ex.: conta pessoal, namespace sem org no GitHub), cai
// num campo pra digitar o handle na mão (Enter adiciona).
function addControl(cls, dataAttrs, list, org) {
  const c = reviewerCands[org] || { members: [], teams: [] };
  const me = (OWNER2USER[String(org || '').toLowerCase()] || (STATE.config || {}).ghUser || '').toLowerCase();
  const has = v => (list || []).some(l => l.toLowerCase() === String(v).toLowerCase());
  if (!reviewerCandsLoaded) return `<select class="rev-add ${cls}" ${dataAttrs}><option value="">carregando…</option></select>`;
  if (!c.members.length && !c.teams.length) return `<input class="rev-add rev-manual ${cls}" ${dataAttrs} placeholder="+ digite um handle e Enter…" spellcheck="false">`;
  const opts = [
    ...c.members.filter(x => x.toLowerCase() !== me && !has(x)).map(x => `<option value="${esc(x)}">${esc(x)}</option>`),
    ...c.teams.filter(t => !has(t.id)).map(t => `<option value="${esc(t.id)}">${esc(t.name)} (time)</option>`)
  ].join('');
  return `<select class="rev-add ${cls}" ${dataAttrs}><option value="">+ adicionar…</option>${opts}</select>`;
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
      <div class="rev-chips">${chips}${addControl('rev-def-add', `data-org="${esc(org)}"`, def, org)}</div>
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
        : `<div class="rev-chips">${addControl('rev-def-add', `data-org="${esc(org)}"`, [], org)}</div>
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
        <div class="rev-chips">${chips || '<span class="rev-empty">sem reviewers</span>'}${addControl('rev-exc-add', `data-repo="${esc(repo)}"`, list, repo.split('/')[0])}</div>
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
  if (defAdd) {
    const val = (defAdd.value || '').trim(); if (!val) return;
    const org = defAdd.dataset.org, cur = defaultFor(org);
    if (cur.some(x => x.toLowerCase() === val.toLowerCase())) return;
    const map = { ...cfgDefaults() }; map[org] = [...cur, val];
    applyDefaults(map); return;
  }
  const excAdd = e.target.closest('.rev-exc-add');
  if (excAdd) {
    const val = (excAdd.value || '').trim(); if (!val) return;
    const repo = excAdd.dataset.repo;
    const cur = overrideFor(repo) || (pendingExc.has(repo) ? [...defaultFor(repo.split('/')[0])] : []);
    if (cur.some(x => x.toLowerCase() === val.toLowerCase())) return;
    const map = { ...cfgProjects() }; map[repo] = [...cur, val];
    applyProjects(map, repo); return;
  }
});
// campo manual (org sem membros): Enter adiciona (dispara o change)
$('#reviewersEditor').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('rev-manual')) { e.preventDefault(); e.target.blur(); }
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
  renderClaudeProfiles();
  $('#setInterval').value = String(c.intervalSeconds);
  $('#setReviewModel').value = (c.reviewModel != null ? c.reviewModel : '');
  $('#setAutoReview').checked = !!c.autoReview;
  $('#setAutoApproveAll').checked = c.autoApproveAll !== false;
  $('#setAutoPushback').checked = !!c.autoPushback;
  $('#setDebugSpawns').checked = !!c.debugSpawns;
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
function kudosScopeKey() { return SCOPE === 'all' ? '*' : String(SCOPE).toLowerCase(); }
function renderTools() {
  const runs = STATE.toolRuns || {};
  const btnK = $('#btnKudos'), btnH = $('#btnHealth');

  // kudos é por conta: cada escopo tem sua própria compilação (nunca mistura contas)
  const kmap = (runs.kudos && typeof runs.kudos === 'object') ? runs.kudos : {};
  const k = kmap[kudosScopeKey()] || {};
  const scopeName = SCOPE === 'all' ? '' : ((ACCT[String(SCOPE).toLowerCase()] || {}).label || SCOPE);
  btnK.disabled = k.status === 'running';
  btnK.innerHTML = k.status === 'running'
    ? '<span class="spin"></span> Gerando…'
    : `<svg viewBox="0 0 24 24"><path d="M12 3l1.9 4.6 4.9.4-3.7 3.2 1.1 4.8L12 13.5 7.8 16l1.1-4.8L5.2 8l4.9-.4L12 3z" fill="currentColor"/></svg> Gerar kudos${scopeName ? ' de ' + esc(scopeName) : ''}`;
  const kp = $('#kudosPanel');
  kp.hidden = k.status !== 'done';
  if (k.status === 'done') {
    lastKudosOutput = stripFence(k.output);
    $('#kudosOut').innerHTML = md(lastKudosOutput);
    $('#kudosMeta').textContent = `gerado às ${fmtClock(k.finishedAt)}${scopeName ? ' · ' + esc(scopeName) : ''} · pronto pra colar no canal`;
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
  const r = await api('/api/tool/clear', { name: 'kudos', scope: kudosScopeKey() });
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

/* ---------- exportar diagnóstico (pra reparar, ex.: no macOS) ---------- */
// Junta ambiente + contas + config + estado + log num texto SEM segredo (nada de
// token/senha), pra a pessoa copiar e mandar pra quem mantém o Farol.
async function buildDiagnostics() {
  const s = STATE || {};
  const log = (await get('/api/log')) || [];
  const d = s.doctor || {}, c = s.config || {};
  const accts = (s.accounts || []).map(a => `  @${a.user}${a.primary ? ' [primária]' : ''} · rótulo=${a.label || '-'} · tipo=${a.kind || '-'} · orgs=${(a.owners || []).join(',') || '-'} · token=${a.tokenOk ? 'ok' : 'NAO'}${a.muted ? ' · silenciada' : ''}`).join('\n');
  const u = s.update;
  return [
    '=== Farol · diagnóstico ===',
    `gerado: ${new Date().toLocaleString('pt-BR')}`,
    `versão: v${s.app?.version || '?'} · plataforma: ${s.app?.platform || '?'} · node: ${d.node || '?'}`,
    `status: ${s.status || '?'}${s.error ? ' · último erro: ' + s.error : ''}`,
    '',
    'Ambiente (doctor):',
    `  gh: ${d.gh || 'NAO ENCONTRADO'}`,
    `  claude: ${d.claude || 'NAO ENCONTRADO'}`,
    `  assinatura Claude: ${d.claudeAuth ? ((d.claudeAuth.configDir ? 'dir próprio (' + d.claudeAuth.configDir + ')' : 'padrão da máquina') + (d.claudeAuth.account ? ' · conta ' + d.claudeAuth.account : '') + (d.claudeAuth.ready === false ? ' · SEM LOGIN (rode: claude login nesse dir)' : '')) : '?'}`,
    `  git bash: ${d.gitBash || '(n/a)'}`,
    `  conta primária autenticada no gh: ${d.ghAuth ? 'sim' : 'NAO'}`,
    `  workspace: ${d.workspace || s.paths?.workspace || '?'}`,
    `  home: ${s.paths?.home || '?'}`,
    '',
    `Contas (${(s.accounts || []).length}):`,
    accts || '  (nenhuma)',
    '',
    'Config:',
    `  intervalo: ${c.intervalSeconds}s · autoReview: ${!!c.autoReview} · autoApproveAll: ${c.autoApproveAll !== false} · skipPermissions: ${!!c.skipPermissions}`,
    `  autostart: ${!!c.autostart} · som: ${!!c.soundEnabled} · tema: ${c.theme || '-'}`,
    `  updateRepo: ${c.updateRepo || '-'} · updateSource: ${c.updateSource || '(release)'}`,
    `  mergeBlockedRepos: ${(c.mergeBlockedRepos || []).join(', ') || '-'}`,
    '',
    'Estado agora:',
    `  fila: ${(s.queue || []).length} · panorama: ${(s.panorama || []).length} · meus PRs: ${(s.myPRs || []).length} · decisões pendentes: ${(s.decisions?.pending || []).length} · sessões ativas: ${(s.activeSessions || []).length}`,
    `  atualização: ${u ? `v${u.current} · ${u.available ? 'v' + u.sourceVersion + ' DISPONÍVEL' : 'na mais recente'} (${u.channel}${u.repo ? ' ' + u.repo : ''})${u.note ? ' · ' + u.note : ''}` : '?'}`,
    '',
    `Log de falhas (${log.length} linha(s)):`,
    log.length ? log.join('\n') : '  (sem falhas registradas)',
    '',
    '(este relatório não contém tokens nem senhas)'
  ].join('\n');
}
let lastDiag = '';
$('#btnDiag').onclick = async () => {
  const btn = $('#btnDiag'), prev = btn.textContent;
  btn.disabled = true; btn.textContent = 'Gerando…';
  lastDiag = await buildDiagnostics();
  $('#diagBox').textContent = lastDiag;
  $('#diagPanel').hidden = false;
  btn.disabled = false; btn.textContent = prev;
  const ok = await copyToClipboard(lastDiag);
  toast(ok ? 'ok' : 'info', ok ? 'Diagnóstico gerado e copiado. É só colar e mandar.' : 'Diagnóstico gerado. Use "Copiar" pra levar o texto.', 4500);
  $('#diagPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};
$('#btnDiagCopy').onclick = async () => {
  const ok = await copyToClipboard(lastDiag || $('#diagBox').textContent);
  toast(ok ? 'ok' : 'error', ok ? 'Copiado.' : 'Não consegui copiar (permissão do navegador).', 2500);
};
$('#btnDiagClear').onclick = () => { $('#diagPanel').hidden = true; };

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
$('#btnKudos').onclick = async () => {
  const r = await api('/api/tool', { name: 'kudos', scope: kudosScopeKey() });
  if (!r?.ok) toast('info', esc(r?.error || 'não consegui gerar'));
};
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
  if (action === 'request_changes') {
    const ref = (btn.closest('.decision').querySelector('.dec-ref')?.textContent || 'este PR').trim();
    const ok = await confirmModal({
      title: `Pedir mudanças em ${ref}?`, danger: true, confirmLabel: 'Pedir mudanças', cancelLabel: 'Cancelar',
      body: `<p>Isso <b>posta um REQUEST CHANGES no GitHub</b>, visível pra todo mundo do PR, com os pontos que a revisão levantou.</p>
        <p>O PR fica <b>bloqueado</b> até o autor tratar e você reavaliar. Pra reverter, é só dispensar o seu review depois.</p>`
    });
    if (!ok) return;
  }
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
  ['#setReviewModel', 'reviewModel', el => el.value],
  ['#setAutoPushback', 'autoPushback', el => el.checked],
  ['#setDebugSpawns', 'debugSpawns', el => el.checked],
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
    renderRadarNav();
    renderSettings(); renderTools(); renderUpdate(); tickCountdown();
    if ($('#tab-sistema').classList.contains('active')) { renderDoctor(); renderAccountsManager(); renderClaudeProfiles(); }
    if ($('#tab-consumo').classList.contains('active')) renderUsage();
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
  es.addEventListener('auto-rejected', () => ping());
  es.addEventListener('needs-decision', (e) => {
    ping();
    const { pr, item } = JSON.parse(e.data);
    if (!isElectron && 'Notification' in window && Notification.permission === 'granted') {
      const n = new Notification('Farol · precisa da sua atenção', { body: `${pr.key}: ${(item.reasons || [])[0] || 'ver relatório'}` });
      n.onclick = () => { window.focus(); focusPr(pr.url); };
    }
  });
  es.addEventListener('focus-pr', (e) => {
    const { url } = JSON.parse(e.data);
    focusPr(url);
  });
  es.onerror = () => {
    $('#statusPill').className = 'pill err';
    $('#statusPill').textContent = 'reconectando…';
  };
}
connect();
