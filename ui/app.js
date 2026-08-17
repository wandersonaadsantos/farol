/* Farol · UI: consome o engine local via SSE + fetch. Sem frameworks. */

import {
  esc, safeJsonParse, fmtClock, fmtTok, fmtCompact, sysNorm, ownerFromUrl, prKeyFromUrl, repoShort, stripFence, hexToRgba,
  sameSet, diffVs, usageMetricVal, sparklinePath, usageDelta, usageStackLayers, usageHoverIndex, usageMatrixRows,
  USAGE_KIND_LABEL, usageSessionRow, FAROL_STAMP_SINCE, FAROL_PRE_STAMP_LABEL, accountSaveArray, delivCappedMsg, fmtRel,
  usageDayKeysBack, aprovadosHoje, avatar, md, feedLine, agentsTitle, analysisOpsPlan, selfSessionKey, sessionProgress,
  personMention, repoMention, prRefMention, parseGoto, sessionRefCell, reviewBoxHtml, operationChecks,
  delivFilterItems, delivStats, delivStatsCards, delivActivityCard, delivEmptyState, deliveriesByRepo, deliveriesByAuthor,
  pushbackControl, PB_OPTS, PB_SHORT, fmtStamp, fmtWhenDay, resolvedRow,
  logSummaryLines, logTailLines, logSummaryShort,
  opTransition, opDismissDelay, stageLabel, validScope, accountBarVisible, expiredSessionMarks, listViewState,
  splitHiddenPRs, effectiveHidden, hiddenFootLabel, myPRsEmptyMsg,
  mergeToastKind, creditsHtml, buildFixPrompt
} from './pure.js';

const $ = (s) => document.querySelector(s);
const isElectron = navigator.userAgent.includes('Electron');
if (isElectron) document.body.classList.add('electron');

/* Plataforma: a FONTE DE VERDADE é o engine (snapshot.app.platform = process.platform).
   O userAgent aqui é só o palpite do PRIMEIRO PAINT, antes do primeiro estado chegar pelo
   SSE: sem ele o padding do semáforo do macOS piscaria. aplicaPlataforma reconcilia assim
   que o estado chega, e é ela que manda daí em diante.
   Antes eram duas fontes de verdade no mesmo arquivo (userAgent no cromo, app.platform no
   doctor), que divergem de verdade ao abrir a UI de um Mac contra um engine Windows.
   ehMac/ehWin são FUNÇÕES de propósito: uma referência esquecida a `isMac` vira
   ReferenceError alto, em vez de um `if (isMac)` sempre verdadeiro falhando calado. */
let PLATAFORMA = /Macintosh|Mac OS X/.test(navigator.userAgent) ? 'darwin' : 'win32';
const ehMac = () => PLATAFORMA === 'darwin';
const ehWin = () => PLATAFORMA === 'win32';
function aplicaPlataforma(p) {
  if (p) PLATAFORMA = p;
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

let STATE = null;
let logTimer = null;

/* ---------- helpers ---------- */
function api(path, body) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-farol': '1' },
    body: JSON.stringify(body || {})
  }).then(r => r.json()).catch(() => null);
}
function get(path) { return fetch(path).then(r => r.json()).catch(() => null); }

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
    ov.innerHTML = `<div class="modal-card ${opts.danger ? 'danger' : ''}" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <div class="modal-title" id="modalTitle">${esc(opts.title || 'Confirmar')}</div>
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

/* ---------- operation feedback system (async operations transparency) ---------- */
/* UNIFIED FEEDBACK VISUAL SYSTEM

   Goal: Users never unsure if app is frozen. Every async operation shows:
   - Current step (e.g., "Lendo arquivos…")
   - Progress % (0-100)
   - Expected time remaining (ETA)
   - Queue position (if applicable)
   - Auto-dismiss on completion or error

   API Functions:
   - showOp(opId, opts) — start operation widget (inline: true for compact pill)
   - updateOp(opId, {step, progress, eta, queuePos, status}) — update progress
   - closeOp(opId, status, message) — mark done/error, auto-dismiss after 3s

   Visual Patterns:
   1. Operation Widget (.op-widget) — full card with icon, step, progress bar
   2. Inline Pill (.op-inline-pill) — compact text badge for background ops
   3. Auto-dismiss — fades out 3s after completion

   Coverage (9 problem areas resolved):
   - Polling: status checks with queue feedback
   - Data Loading: spinners for Deliveries/Highlights/Team
   - Review/Analysis: progress through Lendo → Analisando → Montando
   - Merge: success toast on completion
   - Chat: phase progression + streaming indicator
   - Update: verification feedback badge
   - Settings: success toast on save
   - Tools: Kudos & Health execution feedback
   - Session Startup: stage indicators (iniciando → processando)

   Implementation: Pure JS, no frameworks. ACTIVE_OPS Map tracks all active operations.
   Reusable across all async flows via showOp/updateOp/closeOp pattern.
*/
let ACTIVE_OPS = new Map();  // opId → {id, type, status, step, progress, eta, queuePos, startTime, cancellable, container, element}

function showOp(opId, opts) {
  opts = opts || {};
  // reuso do mesmo opId nao pode orfanar a pill anterior no DOM (M22): a entrada
  // do Map era substituida e o elemento velho ficava pra sempre sem referencia
  const prev = ACTIVE_OPS.get(opId);
  if (prev && prev.element) prev.element.remove();
  const op = {
    id: opId,
    type: opts.type || 'generic',
    title: opts.title || 'Operação…',
    status: 'running',
    step: '',
    progress: 0,
    startTime: Date.now(),
    cancellable: opts.cancellable || false,
    cancel: opts.cancel || null,   // { path, body }: o POST real que o botão Cancelar dispara
    key: opts.key || '',           // key do PR (ops de autoanálise): liga o op ao snapshot
    seen: false,                   // o key já apareceu num snapshot? (guarda da corrida SSE)
    container: opts.container || document.body,
    inline: opts.inline || false
  };
  ACTIVE_OPS.set(opId, op);
  if (op.inline) {
    op.element = document.createElement('span');
    op.element.className = 'op-inline-pill';
  } else {
    op.element = document.createElement('div');
    op.element.className = 'op-widget';
    op.element.setAttribute('data-op-id', opId);
  }
  op.container.appendChild(op.element);
  updateOpDisplay(opId);
  return op.element;
}

function updateOp(opId, update) {
  const op = ACTIVE_OPS.get(opId);
  if (!op) return;
  Object.assign(op, {
    step: update.step !== undefined ? update.step : op.step,
    progress: update.progress !== undefined ? update.progress : op.progress,
    eta: update.eta,
    queuePos: update.queuePos !== undefined ? update.queuePos : op.queuePos,
    status: update.status || op.status
  });
  updateOpDisplay(opId);
}

function closeOp(opId, result = 'done', message = '') {
  const op = ACTIVE_OPS.get(opId);
  if (!op) return;
  op.status = opTransition(op.status, result);  // running -> done | error | cancelled
  op.message = message;
  updateOpDisplay(opId);
  const delay = opDismissDelay(op.status);
  if (delay !== null) {
    setTimeout(() => {
      if (op.element) op.element.remove();
      // so deleta se a entrada ainda for ESTA op: um showOp com o mesmo id pode
      // ter recriado a operacao, e o timer velho nao pode apagar a nova
      if (ACTIVE_OPS.get(opId) === op) ACTIVE_OPS.delete(opId);
    }, delay);
  }
}

function updateOpDisplay(opId) {
  const op = ACTIVE_OPS.get(opId);
  if (!op || !op.element) return;
  const isInline = op.element.classList.contains('op-inline-pill');
  if (isInline) {
    op.element.className = `op-inline-pill ${op.status}`;
    const iconHtml = op.status === 'running'
      ? '<span class="op-icon spin"></span>'
      : op.status === 'done'
      ? '<span class="op-icon done"></span>'
      : '<span class="op-icon error"></span>';
    const text = esc(op.step || op.title);
    op.element.innerHTML = `${iconHtml} ${text}`;
  } else {
    op.element.className = `op-widget ${op.status}`;
    const iconHtml = op.status === 'running'
      ? '<span class="op-icon spin"></span>'
      : op.status === 'done'
      ? '<span class="op-icon done"></span>'
      : '<span class="op-icon error"></span>';
    const metaHtml = op.queuePos !== undefined
      ? `<span>${op.queuePos > 0 ? `fila: ${op.queuePos}` : ''}</span>`
      : op.eta
      ? `<span>~${formatDuration(op.eta)}</span>`
      : '';
    const progressHtml = op.progress > 0 && op.progress < 100
      ? `<div class="op-progress"><span>${op.progress}%</span><div class="op-bar"><div class="op-bar-fill" style="width: ${op.progress}%"></div></div></div>`
      : '';
    const cancelHtml = op.cancellable && op.status === 'running'
      ? `<button class="op-cancel" data-op-id="${esc(opId)}">Cancelar</button>`
      : '';
    op.element.innerHTML = `
      <div class="op-header"><span class="op-icon ${op.status === 'running' ? 'spin' : (op.status === 'done' ? 'done' : 'error')}"></span><span>${esc(op.title)}</span></div>
      ${op.step ? `<div class="op-step">${esc(op.step)}</div>` : ''}
      ${progressHtml}
      ${metaHtml ? `<div class="op-meta">${metaHtml}</div>` : ''}
      ${op.message && op.status !== 'running' ? `<div style="color: var(--muted); font-size: 12px; margin-top: 4px;">${esc(op.message)}</div>` : ''}
      ${op.cancellable || cancelHtml ? `<div class="op-actions">${cancelHtml}</div>` : ''}
    `;
  }
}

function formatDuration(ms) {
  if (ms < 60000) return `${Math.ceil(ms / 1000)}s`;
  return `${Math.ceil(ms / 60000)}m`;
}

document.addEventListener('click', async (e) => {
  if (e.target.classList && e.target.classList.contains('op-cancel')) {
    const opId = e.target.dataset.opId;
    const op = ACTIVE_OPS.get(opId);
    // op sem pedido de cancelamento declarado: não há o que pedir ao servidor,
    // fecha só o widget (feedback puramente visual)
    if (!op || !op.cancel) { closeOp(opId, 'cancelled', 'Cancelado'); return; }
    e.target.disabled = true;   // evita POST duplo durante o await
    const r = await api(op.cancel.path, op.cancel.body);
    if (r && r.ok) closeOp(opId, 'cancelled', 'Cancelado pelo usuário');
    else {
      // NUNCA afirmar "cancelado" sem o servidor confirmar (a mentira do achado M18)
      closeOp(opId, 'error', (r && r.error) || 'não consegui cancelar');
      toast('error', esc((r && r.error) || 'não consegui cancelar a autoanálise'));
    }
  }
});

/* ciclo de vida dos widgets de autoanálise: o FIM vem do snapshot (SSE), não de um
   response. Reanexa o elemento (o innerHTML de #myPRs destrói os filhos a cada
   re-render) e fecha quando a análise some do estado (analysisOpsPlan, pura, testada). */
function syncAnalysisOps() {
  const ops = [...ACTIVE_OPS.values()].filter(o => o.type === 'analysis');
  if (!ops.length) return;
  for (const op of ops) {
    if (op.element && !op.element.isConnected) {
      const card = document.querySelector(`.mypr-card[data-key="${CSS.escape(op.key)}"]`);
      if (card) card.appendChild(op.element);
    }
  }
  const plan = analysisOpsPlan(ops.map(o => ({ id: o.id, key: o.key, seen: !!o.seen })), STATE || {});
  for (const id of plan.markSeen) { const op = ACTIVE_OPS.get(id); if (op) op.seen = true; }
  for (const id of plan.close) {
    const op = ACTIVE_OPS.get(id);
    if (!op) continue;
    if (op.status === 'running') closeOp(id, 'done', 'Análise concluída');
    else { if (op.element) op.element.remove(); ACTIVE_OPS.delete(id); }  // cancelado/erro: só limpa
  }
}

/* ---------- camada de contas (separação por identidade) ---------- */
let SCOPE = localStorage.getItem('farol-scope') || 'all';   // 'all' ou o login de uma conta
let silencedOpen = false;
let CURRENT_TAB = 'radar';   // a barra de contas só filtra o Radar; nas outras abas fica escondida
// espelha a aba no <body> pro CSS ajustar a largura útil (a aba Sistema tem sidebar e
// precisa de mais). switchTab não roda no boot, então a aba inicial é marcada aqui.
document.body.dataset.tab = CURRENT_TAB;
function identGuardada() {
  const v = localStorage.getItem('farol-identity-style');
  if (v === 'Só ponto') return v;
  return 'Ponto + etiqueta';   // cobre o default, 'Barra + etiqueta' e o antigo 'Só barra'
}
const TWEAK = {
  muted: localStorage.getItem('farol-muted-handling') || 'Recolher',   // Recolher | Esmaecer | Ocultar
  // 'Só barra' saiu quando a borda esquerda virou urgência: quem tinha essa opção ficaria
  // sem NENHUM marcador de conta. Migra pro equivalente mais informativo.
  ident: identGuardada(), // Ponto + etiqueta | Só ponto
};
let ACCT = {};        // user(lower) -> metadados da conta
let OWNER2USER = {};  // owner/org(lower) -> user dono
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
  // o escopo persistido pode ter ficado orfao (conta removida/renomeada): saneia
  // aqui, que roda a cada snapshot. So valida com a lista PRESENTE: o snapshot de
  // boot pode vir sem contas e nao pode resetar um escopo valido (B15).
  if (list.length) {
    const v = validScope(SCOPE, list.map(a => a.user));
    if (v !== SCOPE) { SCOPE = v; localStorage.setItem('farol-scope', SCOPE); }
  }
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
  // A BARRA ESQUERDA NÃO É MAIS A COR DA CONTA. Ela passou a significar URGÊNCIA, e quem
  // a pinta é quem sabe o estado: a fila (âmbar), as decisões (âmbar, ou vermelho quando
  // tem blocker), as sessões ativas (azul) e Meus PRs (verde/vermelho pelo veredito).
  // Motivo: âmbar em tudo faz âmbar não querer dizer nada. A conta continua visível no
  // ponto e na etiqueta, que já existiam. Ver o delta 2e do documento de design.
  const showChip = TWEAK.ident === 'Ponto + etiqueta' && all && multi;
  const showDot = all && multi;
  const varStyle = a ? `--ac:${a.color};--ac-soft:${a.soft};--ac-ink:${a.ink};` : '';
  const dim = dimmedPr(pr) ? 'opacity:.55;' : '';
  const barStyle = '';
  const chip = (showChip && a) ? `<span class="acct-chip">${esc(a.label)}</span>` : '';
  const dot = (showDot && a) ? `<span class="acct-dot"></span>` : '';
  return { style: varStyle + dim + barStyle, varStyle, dim, chip, dot, acct: a };
}
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
  // a allowlist de abas mora no pure.js (accountBarVisible): so Radar, Destaques
  // e Time respeitam SCOPE; Entregas filtra por org propria e Sistema/Consumo
  // sao visoes do Farol como app, nao de uma conta.
  if (!accountBarVisible(accounts.length, CURRENT_TAB)) { bar.hidden = true; bar.innerHTML = ''; return; }
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
      <div class="id-body"><div class="id-line">Revisando e postando como <span class="id-handle">${personMention(a.user, 'xs', true)}</span> ${meta.org ? `<span class="id-org">· ${esc(meta.org)}</span>` : ''}</div></div>
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
  const head = `<div class="sil-head"><span class="sil-dot" aria-hidden="true"></span>
      <span>${items.length} ${items.length === 1 ? 'item silenciado' : 'itens silenciados'} · ${esc(names)}</span>
      <button class="sil-toggle">${silencedOpen ? 'ocultar' : 'ver'}</button></div>`;
  const body = silencedOpen ? `<div class="sil-items">${items.map(pr => {
    const meta = acctOf(pr) || {};
    return `<div class="card pr-card" style="--ac:${meta.color || 'var(--accent)'};--ac-soft:${meta.soft || 'var(--accent-soft)'};border-left:3px solid ${meta.color || 'var(--accent)'};opacity:.85;">
      <div class="info">
        <div class="pr-ref"><a href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.key)}</a> <span class="acct-chip">${esc(meta.label || '')}</span></div>
        <div class="pr-title" title="${esc(pr.title)}">${esc(pr.title)}</div>
        <div class="pr-sub">${personMention(pr.author, 'xs')} · ${fmtRel(pr.updatedAt)}</div>
      </div></div>`;
  }).join('')}</div>` : '';
  box.innerHTML = head + body;
}

/* ---------- gerenciador/editor de contas (Sistema) ---------- */
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
        <div class="a-sub"><a class="a-auth ${a.tokenOk && !a.muted ? 'ok' : ''}" href="https://github.com/${encodeURIComponent(a.user)}" target="_blank" rel="noreferrer" title="Abrir @${esc(a.user)} no GitHub">@${esc(a.user)}</a> · ${esc(auth)}</div>
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

// Gerenciador de perfis de assinatura Claude (Sistema): cada perfil é {id,label,dir}
// (login por assinatura) ou {id,label,kind:'apikey',apiKey,baseUrl} (chave de API).
// Perfil padrão global + perfis salvos, cada um com o e-mail logado (badge, via doctor).
function claudeAuthBadge(id) {
  const all = (STATE.doctor && STATE.doctor.claudeAuth) || [];
  // servidor sempre inclui a entrada '' (padrão da máquina/legado), mesmo com perfis
  // salvos - então id === '' (padrão global sem override, ou conta sem claudeProfileId
  // próprio) acha essa entrada direto. all[0] fica só como último recurso pra doctorInfo
  // ainda não ter chegado num formato esperado (nunca devolve string vazia à toa).
  const info = all.find(x => x.id === id) || all.find(x => x.id === '') || all[0] || null;
  if (!info) return '';
  if (info.apiKeyMode) {
    if (!info.ready) return `<span class="a-claude bad" title="Perfil de chave de API sem chave preenchida">SEM CHAVE</span>`;
    // bloqueio de orçamento vem de STATE.usage.budgets (fonte única, viva a cada
    // pushState, v2.40.0); o doctor parou de carregar blocked/reason, e este selo
    // lia de lá (achado da revisão adversarial: o ramo tinha virado código morto)
    const budget = ((STATE.usage && STATE.usage.budgets) || []).find(b => b.id === (info.id || id)) || {};
    if (budget.blocked) {
      const motivo = budget.reason === 'diario' ? 'orçamento diário' : 'orçamento total';
      return `<span class="a-claude bad" title="${motivo} estourado, automação pausada (clique manual continua liberado)">🔴 ${motivo} estourado</span>`;
    }
    return `<span class="a-claude ok" title="Autenticação por chave de API">🔑 chave configurada</span>`;
  }
  if (info.ready === false) return `<span class="a-claude bad" title="rode claude login nesse diretório">SEM LOGIN</span>`;
  if (info.account) return `<span class="a-claude ok" title="${esc(info.configDir || 'padrão da máquina')}">@${esc(info.account)}</span>`;
  return `<span class="a-claude" title="${esc(info.configDir || 'padrão da máquina')}">${info.configDir ? 'logada' : 'padrão da máquina'}</span>`;
}

function genProfileId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function saveClaudeProfiles(profiles, defaultId) {
  STATE.config.claudeProfiles = profiles;
  const patch = { claudeProfiles: profiles };
  // defaultId opcional: usado pela migração (btnClaudeMigrate), que precisa setar o
  // perfil recém-criado como o padrão global no MESMO patch (senão o perfil migrado
  // fica sem dono, ver achado da revisão final sobre legado invisível).
  if (defaultId !== undefined) { STATE.config.claudeProfileId = defaultId; patch.claudeProfileId = defaultId; }
  api('/api/settings', patch).then(r => {
    if (r?.ok) toast('ok', '✓ Configurações salvas', 2000);
    else toast('error', 'Erro ao salvar configurações');
  });
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
  // se o legado (claudeConfigDir) ainda estiver preenchido, "Padrão da máquina" na
  // verdade cai nele por baixo dos panos (ver resolveClaudeConfigDir) - deixa isso
  // visível aqui, já que a Task 6 tirou o campo texto que mostrava esse valor.
  const defaultEmptyLabel = c.claudeConfigDir ? `Padrão da máquina (legado: ${esc(c.claudeConfigDir)})` : 'Padrão da máquina';
  const defaultOptions = [`<option value="">${defaultEmptyLabel}</option>`]
    .concat(profiles.map(p => `<option value="${esc(p.id)}"${c.claudeProfileId === p.id ? ' selected' : ''}>${esc(p.label)}</option>`))
    .join('');
  // botão de login da linha padrão: data-id dinâmico (era fixo "" antes desta feature,
  // então sempre abria o legado ao clicar, mesmo com outro perfil selecionado no dropdown
  // - bug preexistente, corrigido junto por ser exigido pra esconder o botão certo).
  const defaultProfile = profiles.find(p => p.id === (c.claudeProfileId || ''));
  const defaultIsApiKey = defaultProfile && defaultProfile.kind === 'apikey';
  const defaultLoginBtn = defaultIsApiKey ? '' : `<button class="btn sm cp-login" data-id="${esc(c.claudeProfileId || '')}">Abrir sessão de login</button>`;
  const defaultRow = `<div class="card set-row">
    <div class="set-txt">
      <span class="set-title">Perfil padrão do Farol</span>
      <span class="set-desc">Vale pra toda conta do GitHub que não tiver um perfil próprio (painel Contas).</span>
    </div>
    <div class="set-ctl">
      <select id="claudeProfileDefault">${defaultOptions}</select>
      ${defaultLoginBtn}
    </div>
  </div>`;
  const rows = profiles.map(p => {
    const isApiKey = p.kind === 'apikey';
    // gasto vem de STATE.usage.budgets (fonte unica do orcamento, viva a cada
    // pushState), nunca mais do cache do doctor, que congelava o "Hoje" daqui
    // enquanto a aba Consumo andava (v2.40.0)
    const budgetInfo = isApiKey ? ((STATE.usage && STATE.usage.budgets) || []).find(x => x.id === p.id) : null;
    const budgetStatusText = budgetInfo
      ? `Hoje: US$ ${(budgetInfo.today || 0).toFixed(2)}${p.budgetDaily != null ? ` de US$ ${p.budgetDaily.toFixed(2)}` : ''}`
        + (p.budgetTotal != null ? ` · Desde ${p.budgetSince || '?'}: US$ ${(budgetInfo.sinceCutoff || 0).toFixed(2)} de US$ ${p.budgetTotal.toFixed(2)}` : '')
      : '';
    const fields = isApiKey ? `
      <div class="a-editrow">
        <input class="cp-apikey" type="password" data-id="${esc(p.id)}" value="${esc(p.apiKey || '')}" placeholder="chave de API" spellcheck="false" autocomplete="off">
        <button class="btn icon sm ghost cp-toggle-key" data-id="${esc(p.id)}" title="Mostrar/ocultar a chave" aria-label="Mostrar/ocultar a chave">👁</button>
      </div>
      <div class="a-editrow">
        <input class="cp-baseurl" data-id="${esc(p.id)}" value="${esc(p.baseUrl || '')}" placeholder="URL base (opcional, deixe em branco pra usar a Anthropic direto)" spellcheck="false">
      </div>
      <div class="a-editrow">
        <input class="cp-budget-daily" type="number" min="0" step="0.01" data-id="${esc(p.id)}" value="${p.budgetDaily != null ? p.budgetDaily : ''}" placeholder="Orçamento diário (US$, opcional)">
        <input class="cp-budget-total" type="number" min="0" step="0.01" data-id="${esc(p.id)}" value="${p.budgetTotal != null ? p.budgetTotal : ''}" placeholder="Orçamento total (US$, opcional)">
        <input class="cp-budget-since" type="date" data-id="${esc(p.id)}" value="${esc(p.budgetSince || '')}" title="Contar o total a partir de">
      </div>
      ${budgetStatusText ? `<div class="a-hint">${esc(budgetStatusText)}</div>` : ''}` : `
      <div class="a-editrow">
        <input class="cp-dir" data-id="${esc(p.id)}" value="${esc(p.dir || '')}" placeholder="${ehWin() ? 'C:\\Users\\voce\\.claude-perfil' : '~/.claude-perfil'}" spellcheck="false">
      </div>`;
    return `<div class="card acct-card">
    <div class="a-body">
      <div class="a-editrow">
        <input class="cp-label" data-id="${esc(p.id)}" value="${esc(p.label)}" placeholder="nome do perfil" spellcheck="false">
        ${claudeAuthBadge(p.id)}
      </div>
      ${fields}
    </div>
    <div class="a-actions">
      ${isApiKey ? '' : `<button class="btn sm cp-login" data-id="${esc(p.id)}">Abrir sessão de login</button>`}
      <button class="btn sm danger-ghost cp-remove" data-id="${esc(p.id)}">Remover</button>
    </div>
  </div>`;
  }).join('');
  const addForm = `<div class="card acct-add">
    <div class="a-add-title">Adicionar perfil</div>
    <div class="a-editrow">
      <div class="seg" id="cpAddKind" role="group" aria-label="Tipo de perfil">
        <button type="button" class="seg-btn active" data-kind="dir">Login por assinatura</button>
        <button type="button" class="seg-btn" data-kind="apikey">Chave de API</button>
      </div>
    </div>
    <div class="a-editrow">
      <input id="cpAddLabel" placeholder="nome (ex.: BIUD Trabalho)" spellcheck="false">
      <input id="cpAddDir" placeholder="diretório de config (ex.: ${ehWin() ? 'C:\\Users\\voce\\.claude-biud-trabalho' : '~/.claude-biud-trabalho'})" spellcheck="false">
      <input id="cpAddApiKey" type="password" placeholder="chave de API" spellcheck="false" autocomplete="off" hidden>
      <input id="cpAddBaseUrl" placeholder="URL base (opcional)" spellcheck="false" hidden>
      <button class="btn sm" id="btnCpAdd">Adicionar</button>
    </div>
    <div class="a-hint" id="cpAddHint">Deixe em branco pra usar a Anthropic direto. Um endpoint customizado precisa falar a API de Mensagens da Anthropic, não é garantia de que qualquer provedor (ex.: OpenRouter) funcione sem um proxy tradutor.</div>
  </div>`;
  box.innerHTML = migrateCard + defaultRow + rows + addForm;
  const hint = $('#cpAddHint'); if (hint) hint.hidden = true; // só aparece no modo Chave de API (ver listener do seletor)
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
/* Sub-abas do Radar: uma tela, um propósito. Substituem a antiga faixa de âncoras
   (.radar-nav), que em janela estreita rolava horizontalmente e escondia metade dos
   destinos sem avisar que existiam. */
let RADAR_SUB = 'mim';

function switchRadarSub(nome) {
  if (nome) RADAR_SUB = nome;
  document.querySelectorAll('.rsub').forEach(b => {
    const ativo = b.dataset.sub === RADAR_SUB;
    b.classList.toggle('active', ativo);
    b.setAttribute('aria-selected', ativo ? 'true' : 'false');
  });
  document.querySelectorAll('.rpane').forEach(p => p.classList.toggle('active', p.id === 'rpane-' + RADAR_SUB));
}

// Contagem das sub-abas. 'Pra mim' soma o que espera decisão sua (camada 1, âmbar);
// as outras duas são contexto e usam a contagem neutra.
function renderRadarNav() {
  const num = sel => { const e = $(sel); return (!e || e.hidden) ? 0 : (parseInt(e.textContent, 10) || 0); };
  const poe = (sel, n) => { const e = $(sel); if (!e) return; e.textContent = n || ''; e.hidden = !n; };
  poe('#rcMim', num('#decisionsCount') + num('#queueCount'));
  poe('#rcMeus', num('#myPRsCount'));
  poe('#rcPano', num('#panoCount'));
}
// menu ··· do card: abre um por vez, e fecha ao clicar fora
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.act-more');
  const dentro = e.target.closest('.pr-menu');
  document.querySelectorAll('.pr-menu').forEach(m => {
    const meu = btn && m.dataset.menu === btn.dataset.key;
    if (!meu && !dentro) m.hidden = true;
  });
  document.querySelectorAll('.act-more').forEach(b => {
    if (!btn || b !== btn) b.setAttribute('aria-expanded', 'false');
  });
  if (!btn) return;
  const menu = document.querySelector(`.pr-menu[data-menu="${CSS.escape(btn.dataset.key)}"]`);
  if (!menu) return;
  menu.hidden = !menu.hidden;
  btn.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
});

// atalhos do estado vazio: levar pro que foi feito, ou forçar uma checagem
document.addEventListener('click', (e) => {
  if (e.target.closest('.eo-check-now')) $('#btnCheck').click();
  const r = e.target.closest('.eo-resolved');
  if (r) { const alvo = $('#resolvedWrap'); if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});

$('#btnCmdK').addEventListener('click', () => cmdOpen());

$('#radarSubs').addEventListener('click', (e) => {
  const b = e.target.closest('.rsub');
  if (b) switchRadarSub(b.dataset.sub);
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
/* confirmar o palpite re-selecionando a MESMA opção não dispara change; o botão cobre
   o caminho pending -> confirmed com o desfecho sugerido (achado M21) */
$('#resolved').addEventListener('click', async (e) => {
  const btn = e.target.closest('.pb-confirm');
  if (btn) { submitPushback(btn); return; }
  // revisar de novo: mesma rota do Revisar da fila. O .act-review NÃO tem listener
  // global (o da fila é escutado dentro do #queue, o do panorama dentro do #panorama),
  // então a seção escuta o seu. O botão desabilita até o próximo estado re-renderizar.
  const rev = e.target.closest('.act-review');
  if (rev) { rev.disabled = true; api('/api/review', { urls: [rev.dataset.url] }); return; }
  const cp = e.target.closest('.rr-copy');
  if (cp) {
    const ok = await copyToClipboard(cp.dataset.url || cp.dataset.key || '');
    toast(ok ? 'ok' : 'error', ok ? 'URL do PR copiada.' : 'Não consegui copiar (permissão do navegador).', 2500);
  }
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
  // seletor "Login por assinatura" / "Chave de API" no form de adicionar: troca os
  // campos visíveis, sem tocar em nenhum perfil já salvo.
  const seg = t.closest('#cpAddKind .seg-btn');
  if (seg) {
    $('#cpAddKind').querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === seg));
    const isApiKey = seg.dataset.kind === 'apikey';
    $('#cpAddDir').hidden = isApiKey;
    $('#cpAddApiKey').hidden = !isApiKey;
    $('#cpAddBaseUrl').hidden = !isApiKey;
    $('#cpAddHint').hidden = !isApiKey;
    return;
  }
  // mostrar/ocultar a chave de um perfil já salvo (não é validação nem salvamento, só
  // alterna o type do input entre password e text).
  if (t.classList.contains('cp-toggle-key')) {
    const input = e.currentTarget.querySelector(`.cp-apikey[data-id="${CSS.escape(t.dataset.id)}"]`);
    if (input) input.type = input.type === 'password' ? 'text' : 'password';
    return;
  }
  if (t.id === 'btnCpAdd') {
    const label = ($('#cpAddLabel').value || '').trim();
    const kindBtn = $('#cpAddKind .seg-btn.active');
    const isApiKey = kindBtn && kindBtn.dataset.kind === 'apikey';
    if (isApiKey) {
      const apiKey = ($('#cpAddApiKey').value || '').trim();
      const baseUrl = ($('#cpAddBaseUrl').value || '').trim();
      if (!label || !apiKey) return toast('error', 'Preencha nome e chave.', 3000);
      if (/["\r\n]/.test(apiKey.replace(/^"(.*)"$/s, '$1').trim()) || /["\r\n]/.test(baseUrl.replace(/^"(.*)"$/s, '$1').trim())) {
        return toast('error', 'Chave ou URL base com aspas ou quebra de linha no meio (não em volta) não pode ser usada.', 4500);
      }
      const profiles = [...(STATE.config.claudeProfiles || []), { id: genProfileId(), label, kind: 'apikey', apiKey, baseUrl }];
      $('#cpAddLabel').value = ''; $('#cpAddApiKey').value = ''; $('#cpAddBaseUrl').value = '';
      saveClaudeProfiles(profiles);
      return;
    }
    const dir = ($('#cpAddDir').value || '').trim();
    if (!label || !dir) return toast('error', 'Preencha nome e diretório do perfil.', 3000);
    if (/["\r\n]/.test(dir.replace(/^"(.*)"$/s, '$1').trim())) {
      return toast('error', 'Esse caminho tem aspas ou quebra de linha no meio (não em volta), não pode ser usado. Confira se colou o caminho certo.', 4500);
    }
    const profiles = [...(STATE.config.claudeProfiles || []), { id: genProfileId(), label, dir }];
    $('#cpAddLabel').value = ''; $('#cpAddDir').value = '';
    saveClaudeProfiles(profiles);
    return;
  }
  if (t.classList.contains('cp-remove')) {
    const id = t.dataset.id;
    const profiles = (STATE.config.claudeProfiles || []).filter(p => p.id !== id);
    // combina TUDO num único PATCH (claudeProfiles + claudeProfileId + accounts), em vez de
    // N requests separados: com 2+ contas referenciando o perfil removido, PATCHes
    // concorrentes e fire-and-forget não garantiam ordem de chegada no servidor, e o último
    // a processar sobrescrevia o array accounts inteiro, podendo restaurar a referência
    // órfã que os PATCHes anteriores já tinham limpado (achado de auditoria adversarial).
    const patch = { claudeProfiles: profiles };
    STATE.config.claudeProfiles = profiles;
    if (STATE.config.claudeProfileId === id) {
      STATE.config.claudeProfileId = '';
      patch.claudeProfileId = '';
    }
    const accounts = (STATE.accounts || []);
    const affected = accounts.some(a => a.claudeProfileId === id);
    if (affected) {
      const updated = accounts.map(a => a.claudeProfileId === id ? { ...a, claudeProfileId: undefined } : a);
      STATE.accounts = updated; rebuildAccounts();
      patch.accounts = accountSaveArray(updated);
    }
    renderClaudeProfiles(); renderAccountsManager();
    api('/api/settings', patch);
    return;
  }
  if (t.classList.contains('cp-login')) {
    const id = t.dataset.id || '';
    api('/api/claude-login', { profileId: id });
    toast('ok', 'Abrindo sessão de terminal pra login. Rode /login lá, se pedir, e pode fechar quando terminar.', 4500);
    return;
  }
  if (t.id === 'btnClaudeMigrate') {
    const label = ($('#claudeMigrateLabel').value || '').trim() || 'Perfil atual';
    const newId = genProfileId();
    const profiles = [{ id: newId, label, dir: STATE.config.claudeConfigDir }];
    // o perfil migrado precisa virar o padrão global na hora: senão ele fica "novo" mas
    // sem dono, e o legado (claudeConfigDir) continua vencendo por baixo dos panos, sem
    // jeito de editar ou desativar (achado da revisão final).
    saveClaudeProfiles(profiles, newId);
    return;
  }
});
$('#claudeProfilesManager').addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'claudeProfileDefault') {
    STATE.config.claudeProfileId = t.value;
    const patch = api('/api/settings', { claudeProfileId: t.value });
    // tira o foco do select: renderClaudeProfiles() tem uma guarda que pula o re-render
    // enquanto INPUT/SELECT do gerenciador estiver focado (pra não atrapalhar quem está
    // digitando), e trocar de opção não tira o foco sozinho. Sem o blur, o botão "Abrir
    // sessão de login" ficava com o data-id do perfil ANTERIOR até o próximo re-render
    // manual (achado de bug real). O blur libera o próximo re-render legítimo (o push de
    // 'settings' via SSE que já acontece depois de qualquer PATCH em /api/settings).
    t.blur();
    return patch;
  }
  const camposEditaveis = ['cp-label', 'cp-dir', 'cp-apikey', 'cp-baseurl', 'cp-budget-daily', 'cp-budget-total', 'cp-budget-since'];
  if (camposEditaveis.some(cls => t.classList.contains(cls))) {
    const id = t.dataset.id;
    if ((t.classList.contains('cp-dir') || t.classList.contains('cp-apikey') || t.classList.contains('cp-baseurl'))
        && /["\r\n]/.test(t.value.replace(/^"(.*)"$/s, '$1').trim())) {
      toast('error', 'Esse valor tem aspas ou quebra de linha no meio, não pode ser usado.', 4500);
      return;
    }
    const profiles = (STATE.config.claudeProfiles || []).map(p => {
      if (p.id !== id) return p;
      const next = { ...p };
      if (t.classList.contains('cp-label')) next.label = t.value.trim() || p.label;
      if (t.classList.contains('cp-dir')) next.dir = t.value.trim();
      if (t.classList.contains('cp-apikey')) next.apiKey = t.value.trim();
      if (t.classList.contains('cp-baseurl')) next.baseUrl = t.value.trim();
      if (t.classList.contains('cp-budget-daily')) {
        const v = t.value.trim();
        if (v === '') delete next.budgetDaily; else next.budgetDaily = Number(v);
      }
      if (t.classList.contains('cp-budget-total')) {
        const v = t.value.trim();
        if (v === '') delete next.budgetTotal; else next.budgetTotal = Number(v);
      }
      if (t.classList.contains('cp-budget-since')) {
        const v = t.value.trim();
        if (v === '') delete next.budgetSince; else next.budgetSince = v;
      }
      return next;
    });
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

// segmentado: a classe pinta, o aria-pressed e o que o leitor de tela anuncia.
// Um helper so pra os dois nunca divergirem.
function marcarSeg(botoes, ehAtivo) {
  botoes.forEach(b => { const a = ehAtivo(b); b.classList.toggle('active', a); b.setAttribute('aria-pressed', a ? 'true' : 'false'); });
}

function switchTab(name) {
  CURRENT_TAB = name;
  document.body.dataset.tab = name;   // largura útil por aba (ver body[data-tab] no app.css)
  // aria-selected junto com a classe: a classe pinta, o aria é o que o leitor de tela lê
  document.querySelectorAll('.nav-item').forEach(t => {
    const ativo = t.dataset.tab === name;
    t.classList.toggle('active', ativo);
    t.setAttribute('aria-selected', ativo ? 'true' : 'false');
  });
  document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (STATE) renderAccountBar();   // mostra/esconde a barra de contas conforme a aba
  if (name === 'entregas') loadDeliveries();
  if (name === 'destaques') { loadHighlights(); renderTools(); }   // renderTools: kudos do escopo atual, não o defasado
  if (name === 'time') loadTeam();
  if (name === 'sistema') { switchSistemaSection(); loadLog(); renderDoctor(); renderAccountsManager(); renderClaudeProfiles(); loadReviewerCands(); }
  if (name === 'consumo') renderUsage();
}
$('#nav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
  if (btn) switchTab(btn.dataset.tab);
});

/* ---------- sistema: sub-navegação sidebar ---------- */
let SISTEMA_SECTION = 'overview';

function switchSistemaSection(name) {
  if (name) SISTEMA_SECTION = name;
  document.querySelectorAll('.sys-nav-item').forEach(b => {
    const ativo = b.dataset.section === SISTEMA_SECTION;
    b.classList.toggle('active', ativo);
    b.setAttribute('aria-selected', ativo ? 'true' : 'false');
  });
  document.querySelectorAll('.sys-section').forEach(s => s.classList.toggle('active', s.id === 'sys-' + SISTEMA_SECTION));
}

$('#sysNav').addEventListener('click', (e) => {
  const btn = e.target.closest('.sys-nav-item');
  if (!btn) return;
  const q = $('#sysSearch');
  if (q.value) { q.value = ''; sysSearchFilter(''); }
  switchSistemaSection(btn.dataset.section);
});

/* Índice da busca do Sistema. Casar por textContent da seção inteira, como era antes,
   acendia meia dúzia de seções ao mesmo tempo (o termo "conta" aparece em quase todas)
   e empilhava tudo na vertical. Com índice, o resultado é uma lista curta que aponta
   pra UMA linha. 'at' é o seletor do alvo, e todo alvo tem que existir no HTML. */
const SYS_INDEX = [
  { sec: 'overview', at: '#updateBox', title: 'Versão e atualização', hint: 'update, atualizar, versão, release' },
  { sec: 'overview', at: '#doctor', title: 'Saúde do ambiente', hint: 'doctor, gh, claude, git bash, diagnóstico' },
  { sec: 'accounts', at: '#accountsManager', title: 'Contas do GitHub', hint: 'conta, identidade, cor, silenciar, política, token' },
  { sec: 'automation', at: '#sys-row-autoreview', title: 'Revisar automaticamente quando chegar PR', hint: 'auto review, revisão na hora, fila' },
  { sec: 'automation', at: '#sys-row-autoapprove', title: 'Aprovar sozinho os aprováveis com ressalvas', hint: 'auto approve, ressalva, aprovação' },
  { sec: 'automation', at: '#sys-row-pushback', title: 'Detectar pushback automaticamente', hint: 'contestação, autor, desfecho' },
  { sec: 'automation', at: '#sys-row-modelo', title: 'Modelo das revisões automáticas', hint: 'opus, sonnet, haiku, fable, best, modelo, limite do plano' },
  { sec: 'automation', at: '#sys-row-paralelas', title: 'Revisões paralelas por conta', hint: 'paralelo, simultâneo, série, fila, velocidade' },
  { sec: 'automation', at: '#sys-row-esforco', title: 'Esforço de raciocínio', hint: 'effort, pensar, raciocínio, alto, baixo, xhigh' },
  { sec: 'automation', at: '#sys-row-intervalo', title: 'Intervalo de checagem', hint: 'polling, minutos, frequência' },
  { sec: 'automation', at: '#sys-row-skipperms', title: 'Sessão no terminal sem pedir permissões', hint: 'dangerously skip permissions, prompts' },
  { sec: 'connections', at: '#sys-row-ghuser', title: 'Conta do GitHub (trabalho)', hint: 'usuário, login, gh, conta primária' },
  { sec: 'connections', at: '#sys-row-orgs', title: 'Organizações monitoradas', hint: 'org, owners, panorama, repositórios' },
  { sec: 'connections', at: '#sys-row-mergeblocked', title: 'Repos bloqueados pra merge', hint: 'merge, bloqueio, repo, self merge' },
  { sec: 'plans', at: '#claudeProfilesManager', title: 'Perfis de assinatura do Claude', hint: 'plano, assinatura, config dir, login, chave' },
  { sec: 'reviewers', at: '#reviewersEditor', title: 'Reviewers por projeto', hint: 'revisor, time, padrão da org, exceção, repo' },
  { sec: 'prefs', at: '#sys-row-identity', title: 'Identidade nos cards', hint: 'barra, etiqueta, ponto, marcador' },
  { sec: 'prefs', at: '#sys-row-mutedview', title: 'Contas silenciadas', hint: 'recolher, esmaecer, ocultar, exibição' },
  { sec: 'prefs', at: '#sys-row-sound', title: 'Som ao chegar PR novo', hint: 'som, aviso, notificação' },
  { sec: 'prefs', at: '#rowAutostart', title: 'Iniciar com o Windows', hint: 'autostart, inicialização, segundo plano' },
  { sec: 'news', at: '#relNotes', title: 'Novidades por versão', hint: 'changelog, release notes, o que mudou' },
  { sec: 'diag', at: '#sys-row-spawns', title: 'Registrar processos (diagnóstico)', hint: 'spawns, terminal piscando, debug' },
  { sec: 'diag', at: '#sys-row-log', title: 'Log de falhas', hint: 'log, erro, falha, pr-health' },
  { sec: 'about', at: '#aboutPrivacy', title: 'Privacidade', hint: 'dados, telemetria, coleta, local, privacidade' },
  { sec: 'about', at: '#aboutLicense', title: 'Licença', hint: 'mit, licença, open source, garantia' },
  { sec: 'about', at: '#aboutCredits', title: 'Créditos', hint: 'contribuidores, autores, idealizador, mantenedor, quem fez' },
];


function sysSecName(sec) {
  const b = document.querySelector(`.sys-nav-item[data-section="${sec}"]`);
  return b ? b.textContent.trim() : sec;
}

// pisca o alvo depois de navegar, pra achar a linha no meio da seção
function sysFlash(el) {
  if (!el || !el.animate) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.animate([
    { boxShadow: '0 0 0 0 rgba(255,180,84,0)' },
    { boxShadow: '0 0 0 3px rgba(255,180,84,.32)', offset: .5 },
    { boxShadow: '0 0 0 0 rgba(255,180,84,0)' }
  ], { duration: 850, iterations: 2 });
}

/* Navega pra uma entrada do índice. A ordem importa: a seção precisa estar VISÍVEL
   antes do scroll, porque scrollIntoView em elemento display:none não faz nada e não
   avisa. Daí o setTimeout depois do switchSistemaSection. */
function sysGoTo(sec, at) {
  const q = $('#sysSearch');
  if (q.value) { q.value = ''; sysSearchFilter(''); }
  switchSistemaSection(sec);
  setTimeout(() => {
    const el = at && document.querySelector(at);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    sysFlash(el);
  }, 0);
}

/* ---------- caixa de revisão por chave (atalho da tabela de Consumo) ----------
   O snapshot manda só as 30 revisões mais recentes (com relatório, cada decisão
   pesa ~5 KB; 3000 seriam 15 MB a CADA push de SSE). Então procura primeiro no
   que já está em mãos e, só se não achar, pergunta ao engine, que varre o
   histórico completo (3000 em disco). Handler delegado no document, igual ao
   data-goto: nenhuma tela registra listener próprio. */
function decisaoLocal(key) {
  const d = STATE?.decisions || {};
  return (d.pending || []).find(x => x.key === key) || (d.resolved || []).find(x => x.key === key) || null;
}

async function abrirCaixaRevisao(key) {
  // o get() devolve null em QUALQUER falha, por isso a rota responde envelope:
  // sem ele, "não há revisão desse PR" e "a busca falhou" seriam a mesma coisa
  // na tela, e o clique ficaria indistinguível de bug.
  let d = decisaoLocal(key);
  if (!d) {
    const env = await get('/api/decision?key=' + encodeURIComponent(key));
    if (!env) { toast('error', 'Não consegui buscar a revisão agora. Tente de novo.'); return; }
    d = env.decision;
  }
  overlayModal(`Revisão de ${esc(key)}`, reviewBoxHtml(d));
}

// overlay de leitura (sem confirmar/cancelar), no mesmo esqueleto do confirmModal
function overlayModal(titulo, corpo) {
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal-card wide" role="dialog" aria-modal="true" aria-labelledby="revBoxTitle">
    <div class="modal-title" id="revBoxTitle">${titulo}</div>
    <div class="modal-body scroll">${corpo}</div>
    <div class="modal-actions"><button class="btn sm primary modal-ok">Fechar</button></div>
  </div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.querySelector('.modal-ok').onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  document.addEventListener('keydown', onKey);
  setTimeout(() => ov.querySelector('.modal-ok').focus(), 30);
}

document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-review-key]');
  if (!b) return;
  e.preventDefault();
  abrirCaixaRevisao(b.dataset.reviewKey);
});

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
function gotoDeliv(kind, valor) {
  // KPIs desta tela também usam data-goto. Não recarregue a própria aba antes
  // de abrir/rolar o grupo: a resposta assíncrona substituiria o DOM recém-alvo.
  if (CURRENT_TAB !== 'entregas') switchTab('entregas');
  if (kind === 'days') {
    const d = parseInt(valor, 10);
    deliveriesDays = [0, 7, 15, 30].includes(d) ? d : deliveriesDays;
    localStorage.setItem('farol-deliv-days', String(deliveriesDays));
    marcarDelivDays();
    resetDeliveriesDisclosure();
    loadDeliveries();
    return;
  }
  // trocar a visão (repo x pessoa) é parte de "levar até a coisa": o grupo só
  // existe na visão correspondente
  const by = kind === 'author' ? 'author' : 'repo';
  if (deliveriesBy !== by) {
    deliveriesBy = by;
    localStorage.setItem('farol-deliv-by', by);
    marcarSeg(document.querySelectorAll('#delivBy .seg-btn'), x => x.dataset.by === by);
  }
  if (deliveriesQuery) { deliveriesQuery = ''; const q = $('#delivQuery'); if (q) q.value = ''; }
  if (by === 'author') deliveriesOpen.add('author:' + valor);
  renderDeliveries();
  // o grupo é montado no render acima; achar pelo groupKey do próprio pure.js
  setTimeout(() => {
    const key = `${by === 'author' ? 'author' : 'repo'}:${valor}`;
    const alvo = [...document.querySelectorAll('#deliveries .deliv-card')]
      .find(c => c.querySelector(`[data-deliv-group="${CSS.escape(key)}"]`))
      || [...document.querySelectorAll('#deliveries .deliv-card .deliv-name')]
        .find(n => n.textContent.trim() === (by === 'author' ? '@' + valor : valor));
    const card = alvo && (alvo.closest ? alvo.closest('.deliv-card') : alvo);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    sysFlash(card);
  }, 0);
}

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
  if (tipo === 'deliv') return gotoDeliv(alvo, seletor);
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

function sysSearchFilter(query) {
  const q = sysNorm(query).trim();
  const box = $('#sysResults');
  const navItems = document.querySelectorAll('.sys-nav-item');
  if (!q) {
    box.hidden = true;
    box.innerHTML = '';
    document.querySelectorAll('.sys-section').forEach(s => s.classList.toggle('active', s.id === 'sys-' + SISTEMA_SECTION));
    navItems.forEach(b => { b.classList.remove('match'); b.classList.toggle('active', b.dataset.section === SISTEMA_SECTION); });
    return;
  }
  const hits = SYS_INDEX.filter(e => sysNorm(`${e.title} ${e.hint} ${sysSecName(e.sec)}`).includes(q));
  // enquanto busca, nenhuma seção fica aberta: quem ocupa a área é a lista de resultados
  document.querySelectorAll('.sys-section').forEach(s => s.classList.remove('active'));
  const comHit = new Set(hits.map(h => h.sec));
  navItems.forEach(b => { b.classList.remove('active'); b.classList.toggle('match', comHit.has(b.dataset.section)); });
  box.hidden = false;
  box.innerHTML = hits.length
    ? hits.map(h => `<button class="sys-hit" data-sec="${esc(h.sec)}" data-at="${esc(h.at)}">
        <span class="sys-hit-txt">${esc(h.title)}<span class="sys-hit-sub">${esc(h.hint)}</span></span>
        <span class="sys-hit-sec">${esc(sysSecName(h.sec))}</span>
      </button>`).join('')
    : `<div class="empty">Nada com esse nome. Tenta "modelo", "esforço", "som", "orgs" ou "log".</div>`;
}

$('#sysSearch').addEventListener('input', (e) => sysSearchFilter(e.target.value));
$('#sysResults').addEventListener('click', (e) => {
  const btn = e.target.closest('.sys-hit');
  if (btn) sysGoTo(btn.dataset.sec, btn.dataset.at);
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
      <tr><td><kbd>${ehMac() ? 'Cmd' : 'Ctrl'}</kbd>+<kbd>K</kbd></td><td>paleta de comando: ir a qualquer lugar</td></tr>
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
/* decisão pendente: caminho ÚNICO de POST, usado pelo card (#decisions) e pela paleta.
   O achado A5: a paleta chamava um decide() que nunca existiu (ReferenceError engolido). */
function decide(id, action) {
  return api('/api/decide', { id, action }).then(r => {
    if (!r || !r.ok) toast('error', esc((r && r.error) || 'não consegui registrar a decisão'));
    return r;
  });
}
// a paleta não tem o modal do card, então o REQUEST_CHANGES ganha a MESMA confirmação
async function decideComConfirmacao(id, action, ref) {
  if (action === 'request_changes') {
    const ok = await confirmModal({
      title: `Pedir mudanças em ${ref || 'este PR'}?`, danger: true, confirmLabel: 'Pedir mudanças', cancelLabel: 'Cancelar',
      body: `<p>Isso <b>posta um REQUEST CHANGES no GitHub</b>, visível pra todo mundo do PR, com os pontos que a revisão levantou.</p>`
    });
    if (!ok) return { ok: false };
  }
  return decide(id, action);
}
/* ---------- paleta de comando (Ctrl+K / Cmd+K) ---------- */
// Ir a qualquer lugar rápido: abas, seções do Radar, ou colar/digitar URL/key
// de PR (org/repo#NN) pra abrir a conversa salva, sem precisar do mouse.
/* Era `const`: o array era montado UMA vez, no load. As decisões pendentes mudam a cada
   evento SSE, então nunca entravam na paleta. Como função, ela é remontada a cada
   abertura. Em janela estreita a paleta deixa de ser atalho de gente avançada e vira a
   rota principal pra tudo que não cabe na tira de abas. */
function cmdStatic() { return [
  // as decisões pendentes primeiro: são a única ação urgente e destrutiva do app
  ...(STATE?.decisions?.pending || []).flatMap(d => {
    const ref = d.key || '';
    const acao = (rotulo, action) => ({
      kind: 'decisão', label: `${rotulo} ${ref}`, hint: 'decisão',
      run: () => decideComConfirmacao(d.id, action, ref)
    });
    return [acao('Aprovar', 'approve'), acao('Pedir mudanças em', 'request_changes')];
  }),
  // o lote respeita o ESCOPO: aprova só o que o filtro de conta mostra, nunca a
  // fila inteira (agravante do achado A5, regra R13 do plano mestre)
  ...(() => {
    const visiveis = (STATE?.decisions?.pending || []).filter(scopeVisible);
    return visiveis.length > 1
      ? [{ kind: 'lote', label: `Aprovar as ${visiveis.length} pendentes`, hint: 'lote',
          run: async () => { for (const d of visiveis) await decide(d.id, 'approve'); } }]
      : [];
  })(),
  ...[...document.querySelectorAll('.nav-item')].map(b => ({ kind: 'tab', label: `Ir para ${b.textContent}`, hint: 'aba', run: () => switchTab(b.dataset.tab) })),
  // as 9 seções do Sistema, lidas do DOM: seção nova entra aqui sozinha.
  // .trim() porque o botão tem um <svg aria-hidden="true"> antes do texto e sobra espaço em branco.
  ...[...document.querySelectorAll('.sys-nav-item')].map(b => ({
    kind: 'section', label: `Sistema: ${b.textContent.trim()}`, hint: 'sistema',
    run: () => { switchTab('sistema'); switchSistemaSection(b.dataset.section); }
  })),
  { kind: 'section', label: 'Ir para Precisa de você', hint: 'seção', run: () => { switchTab('radar'); document.getElementById('decisionsWrap')?.scrollIntoView({ behavior: 'smooth' }); } },
  { kind: 'section', label: 'Ir para Sua fila', hint: 'seção', run: () => { switchTab('radar'); document.getElementById('queueSection')?.scrollIntoView({ behavior: 'smooth' }); } },
  { kind: 'section', label: 'Ir para Meus PRs', hint: 'seção', run: () => { switchTab('radar'); document.getElementById('myPRsWrap')?.scrollIntoView({ behavior: 'smooth' }); } },
  { kind: 'section', label: 'Ir para Panorama', hint: 'seção', run: () => { switchTab('radar'); document.getElementById('panoramaSection')?.scrollIntoView({ behavior: 'smooth' }); } },
  { kind: 'action', label: 'Verificar agora', hint: 'ação', run: () => $('#btnCheck').click() },
  { kind: 'action', label: 'Alternar tema', hint: 'ação', run: () => $('#btnTheme').click() },
  { kind: 'action', label: 'Atalhos de teclado', hint: '?', run: () => kbdHelp() },
]; }
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
    items.push(...cmdStatic().filter(c => !ql || c.label.toLowerCase().includes(ql)));
    list.innerHTML = items.map((c, idx) => `<div class="cmd-item${idx === 0 ? ' sel' : ''}" data-idx="${idx}"><span>${esc(c.label)}</span><span class="cmd-hint">${esc(c.hint)}</span></div>`).join('')
      || '<div class="cmd-empty">Nada encontrado. Cole a URL de um PR pra abrir a conversa.</div>';
    [...list.querySelectorAll('.cmd-item')].forEach((el, idx) => {
      // fecha ANTES de rodar: um run() que lança não pode travar a paleta aberta,
      // e a rejeição vira toast em vez de sumir no console
      el.onclick = () => { cmdClose(); Promise.resolve().then(() => items[idx].run()).catch(err => toast('error', esc((err && err.message) || 'a ação falhou'))); };
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

/* ---------- entregas v2 (PRs mergeados: busca, estatísticas, atividade,
   grupos por repo/pessoa com paginação). Releitura do Claude Design, projeto
   "Revisão página entregas" (Entregas v2.dc.html). ---------- */
let deliveriesData = null;
let deliveriesDays = parseInt(localStorage.getItem('farol-deliv-days'), 10);
if (![0, 7, 15, 30].includes(deliveriesDays)) deliveriesDays = 7;
let deliveriesBy = localStorage.getItem('farol-deliv-by') === 'author' ? 'author' : 'repo';
let deliveriesOrg = localStorage.getItem('farol-deliv-org') || ''; // '' = ainda não resolvido → cai na principal
let deliveriesQuery = ''; // busca livre, só em memória (não persiste entre sessões)
let deliveriesExpanded = new Set(); // chaves 'repo:x'/'author:x' com paginação expandida
let deliveriesOpen = new Set(); // disclosures abertos da visão Pessoas (default: todos fechados)
let deliveriesDataContext = null; // org/período da última resposta aceita
function resetDeliveriesDisclosure() { deliveriesOpen = new Set(); }
// token de requisição: trocar org/período dispara cargas concorrentes e a resposta
// VELHA não pode vencer a nova (mesma guarda que o openChat faz por chave)
let deliveriesReqSeq = 0;

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
function marcarDelivDays() {
  marcarSeg(document.querySelectorAll('#delivDays .seg-btn'), b => parseInt(b.dataset.days, 10) === deliveriesDays);
}

async function loadDeliveries() {
  renderDelivOrgSelect();
  marcarDelivDays();
  marcarSeg(document.querySelectorAll('#delivBy .seg-btn'), b => b.dataset.by === deliveriesBy);
  // Capture o contexto efetivamente consultado. renderDelivOrgSelect pode trocar
  // silenciosamente uma org salva que deixou de existir pela org principal.
  const requestOrg = deliveriesOrg;
  const requestDays = deliveriesDays;
  const requestContext = JSON.stringify([requestOrg, requestDays]);
  const box = $('#deliveries');
  box.innerHTML = '<div class="empty">Carregando entregas…</div>';
  const opId = 'load-deliveries';
  showOp(opId, { type: 'data', title: 'Carregando entregas', inline: true, container: box });
  const rid = ++deliveriesReqSeq;
  const data = await get('/api/deliveries?days=' + requestDays + '&owner=' + encodeURIComponent(requestOrg || ''));
  // outra carga começou depois desta: a resposta é velha e não pinta nada (a op
  // 'load-deliveries' já é da carga nova, que fará o próprio closeOp)
  if (rid !== deliveriesReqSeq) return;
  // O reset do clique dá feedback imediato, mas a UI antiga ainda pode reabrir
  // um autor durante o await. A resposta aceita é a autoridade final. Refresh
  // do MESMO contexto preserva a abertura explícita do atalho @fulano.
  if (deliveriesDataContext !== requestContext) resetDeliveriesDisclosure();
  deliveriesDataContext = requestContext;
  deliveriesData = data || { items: [] };
  deliveriesExpanded = new Set(); // dado novo: paginação de grupo velha não faz sentido
  closeOp(opId, 'done');
  renderDeliveries();
}

function renderDeliveries() {
  const data = deliveriesData || { items: [] };
  const note = $('#delivNote');
  const msgs = [];
  // "o log em Sistema" é menção a lugar do app: vira clique que leva à linha do
  // log no Diagnóstico. Por isso a nota passou de textContent pra innerHTML, com
  // esc() em TODO texto que não seja o link (delivCappedMsg é texto do pure.js).
  if (data.partial) msgs.push('Algumas buscas ao GitHub falharam; a lista pode estar incompleta (veja <span class="is-goto" data-goto="sys:diag:#sys-row-log" role="button" tabindex="0">o log em Sistema</span>).');
  if (data.capped) msgs.push(esc(delivCappedMsg(data.limit)));
  note.hidden = !msgs.length;
  note.innerHTML = msgs.join(' ');

  const items = delivFilterItems(data.items || [], deliveriesQuery);
  $('#delivStats').innerHTML = delivStatsCards(delivStats(items, deliveriesDays));
  $('#delivChart').innerHTML = delivActivityCard(items, deliveriesDays);

  const box = $('#deliveries');
  if (!items.length) {
    box.innerHTML = delivEmptyState({ query: deliveriesQuery, canExpand: deliveriesDays < 30, canClear: !!deliveriesQuery });
    return;
  }
  const opts = { teto: 4, expandedKeys: deliveriesExpanded, openKeys: deliveriesOpen };
  box.innerHTML = deliveriesBy === 'author' ? deliveriesByAuthor(items, opts) : deliveriesByRepo(items, opts);
}
$('#delivOrg').addEventListener('change', (e) => {
  deliveriesOrg = e.target.value || '';
  localStorage.setItem('farol-deliv-org', deliveriesOrg);
  resetDeliveriesDisclosure();
  loadDeliveries();
});
$('#delivDays').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn'); if (!b) return;
  const v = parseInt(b.dataset.days, 10); // "Hoje" = 0 (é falsy: não usar || aqui)
  const nextDays = [0, 7, 15, 30].includes(v) ? v : 7;
  if (nextDays === deliveriesDays) return;
  deliveriesDays = nextDays;
  localStorage.setItem('farol-deliv-days', String(deliveriesDays));
  marcarDelivDays();
  resetDeliveriesDisclosure();
  loadDeliveries();
});
$('#delivBy').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  deliveriesBy = b.dataset.by === 'author' ? 'author' : 'repo';
  localStorage.setItem('farol-deliv-by', deliveriesBy);
  marcarSeg(document.querySelectorAll('#delivBy .seg-btn'), x => x.dataset.by === deliveriesBy);
  renderDeliveries(); // troca de fatia é só re-render, sem novo fetch
});
$('#delivQuery').addEventListener('input', (e) => {
  deliveriesQuery = e.target.value || '';
  renderDeliveries();
});
// O evento nativo `toggle` de <details> não borbulha. Capture mantém um único
// listener delegado e preserva a abertura de Pessoas nos re-renders da busca e
// da paginação, sem interferir na semântica/teclado nativos de <summary>.
$('#deliveries').addEventListener('toggle', (e) => {
  const details = e.target.closest && e.target.closest('details[data-deliv-group^="author:"]');
  if (!details || details !== e.target) return;
  const key = details.dataset.delivGroup;
  if (details.open) deliveriesOpen.add(key); else deliveriesOpen.delete(key);
}, true);
// delegação: "mostrar mais/menos" de cada grupo e as ações do estado vazio
// ("Ver 30 dias" / "Limpar busca"), ambos desenhados no pure.js com data-*
$('#deliveries').addEventListener('click', (e) => {
  const mais = e.target.closest('.deliv-mais');
  if (mais) {
    const key = mais.dataset.delivGroup;
    // `toggle` é enfileirado; o clique em mostrar mais pode re-renderizar antes
    // de ele sincronizar o Set. Leia o estado vivo antes de remover o <details>.
    if (key.startsWith('author:') && mais.closest('details[open]')) deliveriesOpen.add(key);
    if (deliveriesExpanded.has(key)) deliveriesExpanded.delete(key); else deliveriesExpanded.add(key);
    renderDeliveries();
    return;
  }
  const acao = e.target.closest('[data-deliv-action]');
  if (!acao) return;
  if (acao.dataset.delivAction === 'ver30') {
    deliveriesDays = 30;
    localStorage.setItem('farol-deliv-days', '30');
    marcarDelivDays();
    resetDeliveriesDisclosure();
    loadDeliveries();
  } else if (acao.dataset.delivAction === 'limpar-busca') {
    deliveriesQuery = '';
    $('#delivQuery').value = '';
    renderDeliveries();
  }
});

/* ---------- render: topo/status ---------- */
function renderStatus() {
  const s = STATE;
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
  // o estagio (iniciando/processando) envelhece junto: o card so re-renderiza em
  // snapshot SSE, entao sem este ticker o rotulo congelava no primeiro paint (B13)
  document.querySelectorAll('.session-stage').forEach(el => {
    const started = parseInt(el.dataset.started, 10);
    if (!started) return;
    el.textContent = stageLabel(Math.max(0, Math.round((Date.now() - started) / 1000)));
  });
}

/* ---------- render: análises em andamento (feed ao vivo) ---------- */
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
  const pct = sessionProgress((STATE?.activity?.[id] || []).length);
  wrap.querySelector('.op-bar-fill').style.width = pct + '%';
  wrap.querySelector('.sess-pct').textContent = pct + '%';
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
    box.innerHTML = sessions.map(s => {
      const uptime = Math.round((Date.now() - (s.startedAt || Date.now())) / 1000);
      const stages = stageLabel(uptime);
      return `
      <div class="card session-card" data-id="${esc(s.id)}">
        <div class="session-head">
          <span class="spin accent"></span>
          <b>${esc(s.label)}</b> <span class="session-stage" data-started="${s.startedAt || ''}">${stages}</span>
          <span class="session-model" data-id="${esc(s.id)}" hidden></span>
          <span class="session-agents" data-id="${esc(s.id)}" hidden></span>
          ${s.pr?.url ? `<a href="${esc(s.pr.url)}" target="_blank" rel="noreferrer">abrir PR</a>` : ''}
          <span class="session-elapsed" data-started="${s.startedAt}"></span>
          ${s.cancellable ? `<button class="btn sm danger-ghost act-cancel" data-id="${esc(s.id)}">Cancelar</button>` : ''}
        </div>
        <div class="op-progress sess-progress" data-id="${esc(s.id)}"><span class="sess-pct"></span><div class="op-bar"><div class="op-bar-fill"></div></div></div>
        <div class="activity-feed" data-id="${esc(s.id)}"></div>
      </div>`;
    }).join('');
  }
  for (const s of sessions) {
    const feed = box.querySelector(`.activity-feed[data-id="${CSS.escape(s.id)}"]`);
    if (feed) fillFeed(feed, STATE.activity && STATE.activity[s.id]);
    updateSessionBar(s.id);
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
function closeChat() {
  // fechar no meio da resposta: encerra a op ANTES de soltar a chave, senao a
  // entrada chat-<key> fica pra sempre no ACTIVE_OPS (B16)
  if (chatKey) closeOp(`chat-${chatKey}`, 'cancelled', '');
  chatKey = null;
  $('#chatPanel').hidden = true;
}
function renderChat(c) {
  const box = $('#chatMsgs');
  const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
  if (!(c.messages || []).length) {
    box.innerHTML = `<div class="chat-hint">Converse com o Claude sobre <b>${esc(c.key)}</b>. Quando o PR já passou pela revisão automática, ele chega sabendo o diff, o card e o relatório; e pode examinar o PR com <code>gh</code>. Pra responder no PR, é só pedir: "posta esse comentário".</div>`;
  } else {
    const msgs = c.messages.map(m => {
      if (m.role === 'user') return `<div class="msg user">${esc(m.text)}</div>`;
      if (m.role === 'system') return `<div class="msg sys">${esc(m.text)}</div>`;
      return `<div class="msg bot report">${md(m.text)}</div>`;
    }).join('');
    // Add streaming indicator when response is generating
    const streaming = c.status === 'running' && c.messages.length > 0 && c.messages[c.messages.length - 1].role !== 'user'
      ? `<div class="msg bot streaming"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>`
      : '';
    box.innerHTML = msgs + streaming;
  }
  const running = c.status === 'running';
  $('#btnChatSend').disabled = running;
  $('#btnChatStop').hidden = !running;
  const act = $('#chatActivity');
  act.hidden = !running;
  const chatOpId = `chat-${chatKey}`;
  if (running) {
    if (!ACTIVE_OPS.has(chatOpId)) {
      showOp(chatOpId, {
        type: 'chat',
        title: 'Claude respondendo',
        inline: true,
        container: act
      });
      // fase generica so no primeiro paint; depois quem escreve step E
      // progresso e o handler de chat-activity (regua unica sessionProgress)
      updateOp(chatOpId, { step: 'Lendo PR…', progress: 5 });
    }
  } else {
    closeOp(chatOpId, 'done', 'Resposta recebida');
  }
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
    <div class="card decision ${d.verdict === 'approve' ? 'urgent' : 'blocked'}" data-id="${esc(d.id)}" data-url="${esc(d.pr?.url || '')}" style="${m.style}">
      <div class="decision-head">
        <span class="verdict ${d.verdict === 'approve' ? 'approve' : 'rc'}">${d.verdict === 'approve' ? 'APROVÁVEL' : 'COM BLOCKER'}</span>
        <a class="dec-ref" href="${esc(d.pr?.url || '#')}" target="_blank" rel="noreferrer">${esc(d.key)}</a>
        ${m.chip}
        ${d.card ? `<span class="pill">${esc(d.card)}</span>` : '<span class="pill">sem card</span>'}
        <span class="dec-when" title="${esc(fmtStamp(d.createdAt))}">${esc(fmtWhenDay(d.createdAt))}</span>
      </div>
      ${d.pr?.title ? `<div class="dec-title">${esc(d.pr.title)}</div>` : ''}
      ${author ? `<div class="dec-author">PR de ${personMention(author, 'xs')} ${papelPicker(author)}</div>` : ''}
      ${(d.reasons || []).length ? `<ul class="dec-reasons">${d.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
      ${d.blockedReason ? `<div class="dec-blocked">🚫 <span><b>Bloqueado:</b> ${esc(d.blockedReason)}</span></div>` : ''}
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

/* ---------- pushback: PB_OPTS/PB_SHORT/pushbackControl moraram aqui e foram pro
   ui/pure.js (testáveis); o submit e os listeners seguem aqui por tocarem DOM/STATE ---------- */
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
  renderResolved();   // reflete na hora (a guarda de foco segura o caso do change no select/nota)
}

function renderResolved() {
  const box0 = $('#resolved');
  // guarda de foco: não re-renderiza enquanto você digita a nota / escolhe o desfecho
  if (document.activeElement && box0.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  const resolved = (STATE.decisions?.resolved || []).filter(scopeVisible);
  const wrap = $('#resolvedWrap');
  wrap.hidden = resolved.length === 0;
  if (!resolved.length) { $('#resolved').innerHTML = ''; return; }
  // a linha inteira mora no pure.js (testada); aqui só se resolve o que depende de
  // estado global: a etiqueta da conta (SCOPE/TWEAK) e o contador de conversas.
  const pushbacks = STATE.pushbacks || {};
  $('#resolved').innerHTML = resolved.map(r => resolvedRow(r, {
    pushbacks,
    chip: acctMark(r).chip,
    chatBadge: chatBadge(r.key)
  })).join('');
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
  const vs = listViewState({ lastCheckAt: STATE.lastCheckAt, status: STATE.status, length: q.length });
  if (vs === 'loading' || vs === 'error') {
    box.innerHTML = `<div class="empty" style="border:0">${vs === 'loading'
      ? 'Verificando se há algo esperando por você…'
      : 'Não foi possível confirmar ainda (a checagem falhou; veja o aviso no topo). Vou tentar de novo no próximo ciclo.'}</div>`;
    return;
  }
  if (!q.length) {
    // Vazio bom merece CONFIRMAR o que o app fez, não só dizer que não tem nada.
    // resolvedAt é epoch em ms; a comparação de dia é LOCAL e vive no pure.js (testada lá).
    const aprovados = aprovadosHoje(STATE.decisions?.resolved);
    const orgs = (STATE.config?.owners || []).map(o => `<b>${esc(o)}</b>`).join(', ');
    const min = Math.round((STATE.config?.intervalSeconds || 300) / 60);
    const feito = aprovados
      ? `O Farol aprovou ${aprovados} ${aprovados === 1 ? 'PR' : 'PRs'} sozinho hoje e monitora `
      : 'O Farol monitora ';
    box.innerHTML = `<div class="empty-ok">
      <div class="eo-check" aria-hidden="true">✓</div>
      <div class="eo-title">Nada esperando por você</div>
      <p class="eo-sub">${feito}${orgs || 'as organizações configuradas'} a cada ${min} ${min === 1 ? 'minuto' : 'minutos'}. Quando pedirem sua revisão, o card aparece aqui.</p>
      <div class="eo-acts">
        <button class="btn sm eo-resolved">Ver o que foi aprovado</button>
        <button class="btn sm ghost eo-check-now">Verificar agora</button>
      </div>
    </div>`;
    return;
  }
  box.innerHTML = q.map(pr => {
    const m = acctMark(pr);
    return `
    <div class="card pr-card urgent" data-key="${esc(pr.key)}" data-url="${esc(pr.url)}" style="${m.style}">
      ${m.dot}${avatar(pr.author)}
      <div class="info">
        <div class="pr-ref"><a href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.key)}</a>${m.chip}${pr.isDraft ? '<span class="badge">rascunho</span>' : ''}${pr.reRequested ? '<span class="badge rev-pend">pedida de novo</span>' : ''}</div>
        <div class="pr-title" title="${esc(pr.title)}">${esc(pr.title)}</div>
        <div class="pr-sub">${personMention(pr.author, 'xs')} · atualizado ${fmtRel(pr.updatedAt)}${pr.author ? ` ${papelPicker(pr.author)}` : ''}</div>
      </div>
      <div class="pr-actions">
        <button class="btn primary sm act-review" data-url="${esc(pr.url)}">Revisar</button>
        <button class="btn icon sm ghost act-chat" data-key="${esc(pr.key)}" data-url="${esc(pr.url)}" title="Conversar com o Claude sobre este PR" aria-label="Conversar com o Claude sobre este PR">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H4l2.5-2.7A8 8 0 1 1 21 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
        </button>
        <button class="btn icon sm ghost act-more" data-key="${esc(pr.key)}" title="Mais ações" aria-label="Mais ações" aria-expanded="false">···</button>
      </div>
      <!-- O menu abre DENTRO do card, empurrando o conteúdo, em vez de flutuar por cima:
           num card já estreito, dropdown flutuante sai da tela ou cobre o card vizinho.
           Terminal e Ignorar vieram pra cá porque Ignorar é destrutivo e estava a um
           toque de distância do Revisar. -->
      <div class="pr-menu" data-menu="${esc(pr.key)}" hidden>
        <button class="act-terminal" data-url="${esc(pr.url)}">Revisar no terminal (interativo)</button>
        <a href="${esc(pr.url)}" target="_blank" rel="noreferrer">Abrir no GitHub ↗</a>
        <button class="danger act-ignore" data-key="${esc(pr.key)}">Marcar como visto sem revisar</button>
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
  const vs = listViewState({ lastCheckAt: STATE.lastCheckAt, status: STATE.status, length: list.length });
  if (vs !== 'list') {
    box.style.display = 'block';
    box.innerHTML = vs === 'loading'
      ? `<div class="empty" style="border:0">Verificando os PRs abertos…</div>`
      : vs === 'error'
        ? `<div class="empty" style="border:0">Não foi possível confirmar ainda (a checagem falhou; veja o aviso no topo). Vou tentar de novo no próximo ciclo.</div>`
        : `<div class="empty" style="border:0">Nenhum PR aberto ${SCOPE === 'all' ? 'nas organizações monitoradas' : 'nesta conta'}.</div>`;
    return;
  }
  box.style.display = '';
  const runningKeys = new Set([].concat(...(STATE.activeSessions || []).map(s => s.keys || [])));
  const waitingKeys = STATE.headlessWaiting || [];
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
    // roda de verdade x só espera a vez: mesma distinção do "Meus PRs", pra não
    // rotular de "Revisando…" um PR que ainda nem começou (B: fila e panorama divergiam)
    const running = runningKeys.has(pr.key);
    const qpos = running ? 0 : waitingKeys.indexOf(pr.key) + 1;
    const queued = qpos > 0;
    const showBtn = (!reviewed || stale) && !isPending && !running && !queued;
    const settledLabel = kind === 'request_changes' ? 'aguardando o autor' : isPending ? 'aguardando você' : reviewed ? 'nada a fazer' : '';
    const tail = running
      ? '<button class="btn sm ghost pano-review" disabled>Revisando…</button>'
      : queued
      ? `<button class="btn sm ghost pano-review" disabled>Na fila (${qpos})</button>`
      : showBtn
        ? `<button class="btn sm ghost act-review pano-review" data-url="${esc(pr.url)}" title="${pr.reRequested ? 'O autor pediu sua revisão de novo (re-request): a review anterior foi dispensada' : stale ? 'Entrou commit novo depois da sua review: revisar de novo' : pr.mine ? 'Revisar (seu review pedido)' : 'Revisar sob demanda: o resultado sempre passa por você, nada é postado sozinho'}">${stale || pr.reRequested ? 'Re-revisar' : 'Revisar'}</button>`
        : `<span class="settled">${esc(settledLabel)}</span>`;
    return `
    <div class="prow ${pr.mine ? 'mine' : ''} ${chip ? 'reviewed' : ''}" style="${m.varStyle}${m.dim}">
      <span class="status-dot" aria-hidden="true"></span>
      <div class="pw-main">
        <div class="pw-head">
          <a class="pw-ref" href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.key)}</a>
          ${SCOPE === 'all' && m.chip ? m.chip : (pr.mine ? '<span class="badge">sua revisão</span>' : '')}
          ${pr.isDraft ? '<span class="badge">rascunho</span>' : ''}
          ${pr.reRequested ? '<span class="badge rev-pend">pedida de novo</span>' : ''}
          ${chip}
        </div>
        <div class="pw-title">
          <span class="pw-title-txt" title="${esc(pr.title)}">${esc(pr.title)}</span>
          ${pr.title ? '<span class="pw-sep">·</span>' : ''}${personMention(pr.author, 'xs')}
        </div>
      </div>
      <div class="pw-side">
        <span class="pw-when">${fmtRel(pr.updatedAt)}</span>
        <div class="pw-acts">
          <button class="btn icon sm ghost act-chat" data-key="${esc(pr.key)}" data-url="${esc(pr.url)}" title="Conversar com o Claude sobre este PR" aria-label="Conversar sobre este PR">💬${chatBadge(pr.key)}</button>
          ${tail}
          <button class="btn icon sm ghost rr-copy" data-url="${esc(pr.url)}" data-key="${esc(pr.key)}" title="Copiar a URL do PR" aria-label="Copiar a URL do PR">⧉</button>
          <a class="btn icon sm ghost" href="${esc(pr.url)}" target="_blank" rel="noreferrer" title="Abrir no GitHub" aria-label="Abrir no GitHub">↗</a>
        </div>
      </div>
    </div>`;
  }).join('');
}

/* ---------- render: meus PRs (autoanálise) ---------- */
// PRs cujo merge normal esbarrou na proteção de branch: mostram as saídas
// auto-merge/admin até a pessoa escolher (estado só da sessão, não persiste).
const mergeBlockedByPolicy = new Set();
// PRs cujo auto-merge o repo recusou nesta sessão (repo sem "Allow auto-merge"):
// desabilita o botão Auto-merge até o próximo refresh confirmar o estado do repo.
// Map de key pro lastCheckAt do momento da recusa: a poda no renderMyPRs expira a
// marca quando um refresh mais novo chega (antes era Set e nunca expirava, B17).
const autoUnavailableKeys = new Map();
// PRs cujo Merge (admin) foi recusado por ruleset nesta sessão: esconde o botão
// admin até o próximo refresh confirmar (o --admin não fura ruleset). Mesmo Map
// com geração da recusa, mesma poda.
const adminUnavailableKeys = new Map();
// PR oculto de "Meus PRs" (experimento velho que nunca vai mergear e ocupava a aba pra
// sempre). Quem guarda a lista é o motor (STATE.hiddenPRs); estas duas marcas são só a
// resposta OTIMISTA ao clique, pra o card sumir/voltar na hora em vez de esperar o
// próximo push de estado. Cada uma é limpa assim que o motor confirma.
const hideOptimistic = new Set();
const unhideOptimistic = new Set();
// mostrar os ocultos é estado local da tela (não persiste), igual ao silencedOpen
let hiddenOpen = false;
function renderMyPRs() {
  // os marcadores de sessão valem até o PRÓXIMO refresh de mergeStates (que roda
  // no fim de cada check, junto do lastCheckAt novo): refresh mais novo que a
  // marcação poda a marca e o dado fresco do repo volta a decidir os botões
  for (const k of expiredSessionMarks([...autoUnavailableKeys], STATE.lastCheckAt)) autoUnavailableKeys.delete(k);
  for (const k of expiredSessionMarks([...adminUnavailableKeys], STATE.lastCheckAt)) adminUnavailableKeys.delete(k);
  // o motor é a fonte de verdade dos ocultos; a marca otimista morre assim que ele
  // confirma (ocultou de fato, ou de fato reexibiu), pra não sobreviver a um estado novo
  const doMotor = new Set((STATE.hiddenPRs || []).map(k => String(k).toLowerCase()));
  for (const k of [...hideOptimistic]) if (doMotor.has(String(k).toLowerCase())) hideOptimistic.delete(k);
  for (const k of [...unhideOptimistic]) if (!doMotor.has(String(k).toLowerCase())) unhideOptimistic.delete(k);

  const todos = (STATE.myPRs || []).filter(scopeVisible);
  const { visiveis, ocultos } = splitHiddenPRs(todos, effectiveHidden(STATE.hiddenPRs, hideOptimistic, unhideOptimistic));
  // sem nenhum oculto o rodapé não tem o que alternar: volta pro fechado, senão a tela
  // ficaria "aberta" pra sempre depois que o motor reexibisse tudo sozinho
  if (!ocultos.length) hiddenOpen = false;
  // a lista pintada: os visíveis sempre, os ocultos só quando a pessoa pede
  const list = hiddenOpen ? [...visiveis, ...ocultos] : visiveis;
  const analyses = STATE.selfAnalyses || {};
  const wrap = $('#myPRsWrap');
  wrap.hidden = false;
  // o contador da sub-aba conta o que está VISÍVEL: com o total, a bolinha dizia 3 e a
  // lista mostrava 0
  $('#myPRsCount').hidden = visiveis.length === 0;
  $('#myPRsCount').textContent = visiveis.length;
  renderMyPRsHiddenFoot(ocultos.length);
  // o estado de carregamento é do MOTOR, então olha a lista completa: com tudo oculto o
  // ciclo terminou bem e o vazio é escolha da pessoa, não falta de resposta
  const vs = listViewState({ lastCheckAt: STATE.lastCheckAt, status: STATE.status, length: todos.length });
  if (vs !== 'list' || !list.length) {
    $('#myPRs').innerHTML = `<div class="empty" style="border:0">${esc(myPRsEmptyMsg(vs, { escopoTodas: SCOPE === 'all', ocultos: ocultos.length }))}</div>`;
    return;
  }

  const activeSelf = new Set(
    [].concat(...(STATE.activeSessions || []).filter(s => s.mode === 'self').map(s => s.keys || []))
  );
  const waiting = STATE.headlessWaiting || [];
  const blockedRepos = new Set(((STATE.config && STATE.config.mergeBlockedRepos) || []).map(r => String(r).toLowerCase()));
  // só tem conteúdo quando os ocultos estão à mostra: é o que esmaece o card e troca
  // o botão Ocultar pelo Reexibir
  const ocultosSet = new Set(ocultos.map(p => p.key));

  $('#myPRs').innerHTML = list.map(pr => {
    const escondido = ocultosSet.has(pr.key);
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
    <div class="card mypr-card ${a ? (a.approvable ? 'ok' : 'warn') : ''}${escondido ? ' oculto' : ''}" data-key="${esc(pr.key)}" style="${m.style}">
      <div class="mypr-top">
        ${m.dot}${avatar(pr.author)}
        <div class="info">
          <div class="pr-ref"><a href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.key)}</a>
            ${pr.isDraft ? '<span class="badge">rascunho</span>' : ''}${badge}${m.chip}</div>
          <div class="pr-title" title="${esc(pr.title)}">${esc(pr.title)}</div>
          ${pr.head && pr.base ? `<div class="pr-branches"><code>${esc(pr.head)}</code> <span class="arrow">→</span> <code>${esc(pr.base)}</code></div>` : ''}
          <div class="pr-sub">${m.acct ? `por você · ${personMention(m.acct.user, 'xs', true)} · ` : ''}atualizado ${fmtRel(pr.updatedAt)}</div>
        </div>
        <div class="pr-actions">
          <button class="btn primary sm act-self" data-url="${esc(pr.url)}" ${running || queued ? 'disabled' : ''}>${btnLabel}</button>
          <button class="btn sm ghost act-set-reviewers" data-url="${esc(pr.url)}" title="Atribui você e pede review dos reviewers configurados deste repo (aba Sistema). Aplica na hora, sem confirmação.">👥 Reviewers</button>
          ${mergeBtns}
          ${a ? `<button class="btn sm ghost act-self-clear" data-key="${esc(pr.key)}" title="Ocultar esta autoanálise (é só sua, some da tela; dá pra reanalisar quando quiser)">Ocultar análise</button>` : ''}
          ${escondido
        ? `<button class="btn sm ghost act-pr-unhide" data-key="${esc(pr.key)}" title="Traz este PR de volta pra lista de Meus PRs">Reexibir</button>`
        : `<button class="btn sm ghost act-pr-hide" data-key="${esc(pr.key)}" title="Some com este PR de Meus PRs. Ele volta sozinho se receber commit novo">Ocultar</button>`}
        </div>
      </div>
      ${analysisPanel}
    </div>`;
  }).join('');
}
// rodapé discreto da seção: "3 PRs ocultos · mostrar". A linha inteira é o controle
// (um botão só), pra ser alcançável por teclado e leitor de tela sem inventar widget.
function renderMyPRsHiddenFoot(n) {
  const foot = $('#myPRsHiddenFoot');
  if (!foot) return;
  const label = hiddenFootLabel(n, hiddenOpen);
  foot.hidden = !label;
  foot.innerHTML = label
    ? `<button class="mypr-hidden-toggle" aria-expanded="${hiddenOpen ? 'true' : 'false'}" title="PR oculto some de Meus PRs mas volta sozinho se receber commit novo">${esc(label)}</button>`
    : '';
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

// Wrapper fino: coleta do STATE os dados do prompt (achados da autoanálise +
// metadados do PR) e delega o miolo puro pra buildFixPrompt de ui/pure.js
// (carregado antes deste arquivo via <script src>, migrado na Task 12).
function montaFixPrompt(key) {
  const a = (STATE.selfAnalyses || {})[key];
  const pr = (STATE.myPRs || []).find(p => p.key === key) || {};
  if (!a) return '';
  return buildFixPrompt({
    key, url: pr.url, title: pr.title, card: a.card, summary: a.summary,
    blockers: a.blockers, tips: a.tips
  });
}

$('#myPRs').addEventListener('click', (e) => {
  const fix = e.target.closest('.act-fix-copy');
  if (fix) {
    const prompt = montaFixPrompt(fix.dataset.key);
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
      // sem isso a seção fica display:none e o scroll abaixo não mostra nada: o usuário
      // caía na Visão geral com um toast falando de uma tela que ele não estava vendo
      switchSistemaSection('reviewers');
      const busca = $('#sysSearch');
      if (busca.value) { busca.value = ''; sysSearchFilter(''); }
      loadReviewerCands();
      renderReviewersEditor();
      setTimeout(() => { const el = $('#reviewersEditor'); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); sysFlash(el); } }, 60);
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
    // o card já carrega o key canônico; a URL é só fallback (pura, testada)
    const card = run.closest('.mypr-card');
    const prKey = (card && card.dataset.key) || prKeyFromUrl(run.dataset.url);
    const opId = `analysis-${prKey}`;
    showOp(opId, {
      type: 'analysis',
      title: `Analisando ${prKey}`,
      key: prKey,
      cancellable: true,
      cancel: { path: '/api/self-review/cancel', body: { key: prKey } },
      container: run.closest('.mypr-card') || run.parentElement
    });
    updateOp(opId, { step: 'Iniciando…', progress: 5 });
    api('/api/self-review', { url: run.dataset.url }).then(r => {
      if (!r?.ok) {
        closeOp(opId, 'error', r?.error || 'falha ao iniciar');
        toast('error', esc(r?.error || 'não consegui iniciar a autoanálise'));
        run.disabled = false; run.textContent = 'Analisar';
      } else {
        // daqui em diante quem move a barra é o feed real da sessão (evento
        // 'activity'); prometer "Lendo arquivos… 25%" aqui era chute
        updateOp(opId, { step: 'Preparando a sessão…', progress: 8 });
      }
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
        if (r?.ok) { toast('ok', '✓ Merge realizado com sucesso', 3000); return; } // sucesso: o state push atualiza a tela
        if (r?.blocked === 'policy') {
          mergeBlockedByPolicy.add(key); renderMyPRs();
          toast('info', 'A branch de destino tem proteção. Escolha: Auto-merge (espera os requisitos) ou Merge (admin).', 6000);
          return;
        }
        toast(mergeToastKind(r?.error), esc(r?.error || 'não consegui mergear'));
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
        autoUnavailableKeys.set(key, STATE.lastCheckAt || 0); mergeBlockedByPolicy.add(key); renderMyPRs(); return;
      }
      toast(mergeToastKind(r?.error), esc(r?.error || 'não consegui ativar o auto-merge'));
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
        if (r?.blocked === 'rule') { adminUnavailableKeys.set(key, STATE.lastCheckAt || 0); renderMyPRs(); return; }
        toast(mergeToastKind(r?.error), esc(r?.error || 'não consegui mergear como admin'));
        mAdmin.disabled = false; mAdmin.textContent = 'Merge (admin)';
      });
    });
    return;
  }
  const clr = e.target.closest('.act-self-clear');
  if (clr) { api('/api/self-review/clear', { key: clr.dataset.key }); return; }
  // ocultar/reexibir o PR inteiro: some (ou volta) na hora, otimista, e o estado que o
  // motor devolve confirma. Falhou, desfaz a marca e avisa, senão a tela mentiria.
  const hide = e.target.closest('.act-pr-hide');
  if (hide) {
    const key = hide.dataset.key;
    hideOptimistic.add(key); unhideOptimistic.delete(key);
    renderMyPRs(); renderRadarNav();
    api('/api/pr/hide', { key }).then(r => {
      if (r?.ok) return;
      hideOptimistic.delete(key); renderMyPRs(); renderRadarNav();
      toast('error', esc(r?.error || 'não consegui ocultar este PR'));
    });
    return;
  }
  const unhide = e.target.closest('.act-pr-unhide');
  if (unhide) {
    const key = unhide.dataset.key;
    unhideOptimistic.add(key); hideOptimistic.delete(key);
    renderMyPRs(); renderRadarNav();
    api('/api/pr/unhide', { key }).then(r => {
      if (r?.ok) return;
      unhideOptimistic.delete(key); renderMyPRs(); renderRadarNav();
      toast('error', esc(r?.error || 'não consegui reexibir este PR'));
    });
  }
});

/* alterna a exibição dos ocultos (estado só da tela, não persiste) */
$('#myPRsHiddenFoot').addEventListener('click', (e) => {
  if (!e.target.closest('.mypr-hidden-toggle')) return;
  hiddenOpen = !hiddenOpen;
  renderMyPRs(); renderRadarNav();
});

/* ---------- render: versão e atualização ---------- */
/* ---------- Consumo de tokens (tela própria, charts em SVG puro) ---------- */
const usageState = { metric: 'total', window: 30, dim: 'kind' };

function fmtMoney(v) { return 'US$ ' + (Number(v) || 0).toFixed(2); }
function fmtUsageMetric(v, metric) { return metric === 'custo' ? fmtMoney(v) : fmtCompact(v); }

// 4 cartoes: Custo/Tokens/Sessoes do periodo escolhido + Hoje, cada um com
// sparkline dos ultimos `win` dias (Hoje usa fixo 14 dias, igual ao mock) e chip
// de delta vs o periodo anterior de mesmo tamanho. O chip so aparece quando o
// periodo anterior tem base JUSTA: cabe inteiro na retencao do engine
// (u.retentionDays, fonte unica, era uma replica manual de MAX_DAYS aqui) E o
// historico registrado ja cobria o primeiro dia dele (senao um app novo, ou uma
// janela maior que o historico, comparava contra dias estruturalmente vazios e
// inflava o percentual). Todas as somas passam por usageMetricVal: a DEFINICAO
// de cada metrica mora num lugar so (ui/pure.js), a mesma da timeline/matriz.
function drawUsageKpis(el, u, win) {
  const map = {}; for (const d of (u.series || [])) map[d.day] = d;
  const janela = usageDayKeysBack(win).map(day => map[day]);
  const anteriorKeys = usageDayKeysBack(win * 2).slice(0, win);
  const anterior = anteriorKeys.map(day => map[day]);
  const primeiroDia = (u.series && u.series[0] && u.series[0].day) || null;
  const comparavel = win * 2 <= ((u.retentionDays) || 120) && !!primeiroDia && primeiroDia <= anteriorKeys[0];
  const soma = (list, m) => list.reduce((a, d) => a + usageMetricVal(d, m), 0);
  const curCost = soma(janela, 'custo');
  const curTok = soma(janela, 'total');
  const curSess = janela.reduce((a, d) => a + ((d || {}).sessions || 0), 0);
  const curCache = soma(janela, 'cache');
  const antCost = comparavel ? soma(anterior, 'custo') : 0;
  const antTok = comparavel ? soma(anterior, 'total') : 0;
  const antSess = comparavel ? anterior.reduce((a, d) => a + ((d || {}).sessions || 0), 0) : 0;
  const hoje = map[usageDayKeysBack(1)[0]] || {};
  const ontemKey = usageDayKeysBack(2)[0];
  const ontem = map[ontemKey] || {};
  const spark14 = usageDayKeysBack(14).map(day => usageMetricVal(map[day], 'custo'));

  const card = (label, big, sub, delta, vals) => {
    const { line, area } = sparklinePath(vals, 100, 26);
    return `<div class="usage-kpi">
      <div class="usage-kpi-head"><span class="usage-kpi-label">${esc(label)}</span>${delta ? `<span class="usage-kpi-delta">${esc(delta)}</span>` : ''}</div>
      <b>${esc(big)}</b>
      <span class="usage-kpi-sub">${esc(sub)}</span>
      <svg viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true" class="usage-kpi-spark">
        <path d="${area}" fill="var(--accent-soft)"></path>
        <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="1.5" vector-effect="non-scaling-stroke"></path>
      </svg>
    </div>`;
  };

  // o sub do KPI de tokens declara o cache quando houver: "Tokens" (in+out) nao
  // inclui cache em nenhum painel, mas o CUSTO inclui o custo do cache, e sem a
  // linha os dois cartoes vizinhos nao se explicavam (achado da auditoria).
  const tokSub = `${fmtCompact(soma(janela, 'input'))} in · ${fmtCompact(soma(janela, 'output'))} out`
    + (curCache > 0 ? ` · ${fmtCompact(curCache)} cache` : '');
  el.innerHTML = [
    card(`Custo estimado · ${win} dias`, fmtMoney(curCost), `~${fmtMoney(curCost / win)} por dia`, usageDelta(curCost, antCost), janela.map(d => usageMetricVal(d, 'custo'))),
    card(`Tokens · ${win} dias`, fmtCompact(curTok), tokSub, usageDelta(curTok, antTok), janela.map(d => usageMetricVal(d, 'total'))),
    card(`Sessões · ${win} dias`, String(curSess), `média de ${(curSess / win).toFixed(1)} por dia`, usageDelta(curSess, antSess), janela.map(d => (d || {}).sessions || 0)),
    card('Hoje', fmtMoney(usageMetricVal(hoje, 'custo')), `${fmtCompact(usageMetricVal(hoje, 'total'))} tokens · ${hoje.sessions || 0} sessões`, usageDelta(usageMetricVal(hoje, 'custo'), usageMetricVal(ontem, 'custo')), spark14),
  ].join('');
}

// cor por camada: fixa pro tipo (bate com o mock), ciclica pras outras dimensoes
// (modelo/conta), que tem quantidade variavel de nomes. _resto (a fatia
// reconciliada sem detalhamento) e SEMPRE apagado, em qualquer dimensao: e
// registro antigo, nao pode parecer uma serie de verdade.
const USAGE_KIND_COLOR = { review: 'var(--accent)', self: 'var(--info)', chat: 'var(--ok)', tool: '#b394f0', pushback: 'var(--danger)', outro: 'var(--faint)', _resto: 'var(--faint)' };
const USAGE_PALETTE = ['var(--accent)', 'var(--info)', 'var(--ok)', '#b394f0', 'var(--danger)', 'var(--faint)'];

function usageColorsFor(dim, names) {
  if (dim === 'kind') return names.map(n => USAGE_KIND_COLOR[n] || 'var(--faint)');
  return names.map((n, i) => n === '_resto' ? 'var(--faint)' : USAGE_PALETTE[i % USAGE_PALETTE.length]);
}

let usageHoverIdx = null;

// linha do tempo empilhada (area) por dimensao (tipo/modelo/conta), com legenda,
// grade, marca de pico e tooltip de hover. `u.stackedSeries[dim]` ja vem do
// backend com granularidade diaria (Task 3 de lib/engine/usage.js); aqui so
// fatia a janela escolhida e desenha.
function drawUsageTimeline(el, legendEl, u, metric, win, dim) {
  const key = dim === 'model' ? 'byModel' : dim === 'account' ? 'byAccount' : 'byKind';
  const names = dim === 'model' ? (u.modelNames || []) : dim === 'account' ? (u.accountNames || []) : (u.kindNames || []);
  const labels = {}; // name -> label amigavel, tirado do proprio stackedSeries
  const byDay = {}; for (const d of ((u.stackedSeries || {})[key]) || []) { byDay[d.day] = d.items; for (const it of d.items) labels[it.name] = it.label; }
  const days = usageDayKeysBack(win);
  // troca de janela/metrica/dimensao sem o mouse sair do grafico reusa o hover antigo;
  // sem esse clamp, um indice de uma janela maior (ex.: 25 em 30 dias) sobrevive pra uma
  // janela menor (7 dias) e days[25]/series[25] ficam undefined mais abaixo (TypeError
  // no tooltip, renderUsage quebra no meio do innerHTML).
  if (usageHoverIdx != null && usageHoverIdx >= days.length) usageHoverIdx = null;
  const series = days.map(day => (byDay[day] || names.map(n => ({ name: n }))).map(it => usageMetricVal(it, metric)));
  const totalPeriodo = series.reduce((a, vals) => a + vals.reduce((x, y) => x + y, 0), 0);
  if (!totalPeriodo) {
    el.innerHTML = '<div class="usage-empty">Sem consumo nesta janela.</div>';
    legendEl.innerHTML = '';
    usageHoverIdx = null;
    return;
  }
  const colors = usageColorsFor(dim, names);
  const W = Math.max(300, Math.round(el.clientWidth || 820)), H = 220;
  const geo = usageStackLayers(series, names, colors, W, H);

  const totalPorNome = names.map((_, i) => series.reduce((a, vals) => a + vals[i], 0));
  legendEl.innerHTML = names.map((n, i) => totalPorNome[i] > 0
    ? `<span><span class="dot" style="background:${colors[i]}"></span>${esc(labels[n] || n)}<b>${esc(fmtUsageMetric(totalPorNome[i], metric))}</b></span>` : '').join('');

  const fmtY = v => fmtUsageMetric(v, metric);
  const step = Math.ceil(days.length / Math.max(3, Math.floor(W / 78)));
  const xlab = days.map((d, i) => (i % step === 0 || i === days.length - 1)
    ? `<text class="uaxis uaxis-x" x="${geo.xs[i]}" y="${H - 6}">${d.slice(8, 10)}/${d.slice(5, 7)}</text>` : '').join('');
  const grid = geo.grid.map(g => `<line x1="${geo.padL}" y1="${g.y}" x2="${W - 14}" y2="${g.y}" class="ugrid"/><text x="${geo.padL - 6}" y="${g.y + 3.5}" class="uaxis uaxis-y">${esc(fmtY(g.value))}</text>`).join('');
  const layerPaths = geo.layers.map(l => `<path d="${l.d}" fill="${l.color}" opacity="0.92"></path>`).join('');
  const peakX = geo.xs[geo.peakIndex];
  const total = `Total ${fmtUsageMetric(totalPeriodo, metric)} em ${days.length} dias, pico de ${fmtUsageMetric(geo.dayTotals[geo.peakIndex], metric)} em ${days[geo.peakIndex]}`;
  // marca visivel do pico (o texto ja ia so pro aria-label, sem nada na tela pra
  // apontar QUAL barra e o pico): mesma formula de y de usageStackLayers/yOf
  // (ui/pure.js), com maxV/dayTotals ja calculados ali, so reaplicada aqui.
  const peakY = geo.padT + geo.ch * (1 - (geo.dayTotals[geo.peakIndex] || 0) / geo.maxV);
  const peakMark = `<circle cx="${peakX}" cy="${peakY.toFixed(1)}" r="3" class="upeak-dot"></circle>`;

  el.innerHTML = `<svg role="img" aria-label="${esc(total)}" viewBox="0 0 ${W} ${H}" class="usvg" id="usvgTimeline">
      ${grid}${layerPaths}${peakMark}${xlab}
      ${usageHoverIdx != null ? `<line x1="${geo.xs[usageHoverIdx]}" y1="${geo.padT}" x2="${geo.xs[usageHoverIdx]}" y2="${geo.padT + geo.ch}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"></line>` : ''}
      <rect x="${geo.padL}" y="0" width="${geo.cw}" height="${H}" fill="transparent" style="cursor:crosshair" data-usage-overlay="1"></rect>
    </svg>
    ${usageHoverIdx != null ? drawUsageTooltip(days[usageHoverIdx], series[usageHoverIdx], names, labels, colors, metric, usageHoverIdx, geo, W) : ''}`;

  const svgEl = el.querySelector('#usvgTimeline');
  const overlay = el.querySelector('[data-usage-overlay]');
  if (overlay) {
    overlay.addEventListener('mousemove', (e) => {
      const rect = svgEl.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (W / rect.width);
      const idx = usageHoverIndex(mx, geo);
      if (idx !== usageHoverIdx) { usageHoverIdx = idx; drawUsageTimeline(el, legendEl, u, metric, win, dim); }
    });
    overlay.addEventListener('mouseleave', () => { if (usageHoverIdx != null) { usageHoverIdx = null; drawUsageTimeline(el, legendEl, u, metric, win, dim); } });
  }
}

function drawUsageTooltip(day, vals, names, labels, colors, metric, idx, geo, W) {
  const total = vals.reduce((a, b) => a + b, 0);
  const leftPct = Math.min(82, Math.max(4, (geo.xs[idx] / W) * 100));
  const rows = names.map((n, i) => vals[i] > 0 ? `<div class="ut-row"><span class="dot" style="background:${colors[i]}"></span><span>${esc(labels[n] || n)}</span><b>${esc(fmtUsageMetric(vals[i], metric))}</b></div>` : '').join('');
  return `<div class="usage-tooltip" style="left:${leftPct}%"><div class="ut-head">${esc(day.slice(8, 10))}/${esc(day.slice(5, 7))} · ${esc(fmtUsageMetric(total, metric))}</div>${rows}</div>`;
}

// matriz Tipo x Modelo do periodo escolhido (mesma janela da linha do tempo),
// com heatmap leve (intensidade da celula sobre a maior celula da matriz).
function drawUsageMatrix(el, captionEl, u, metric, win) {
  const days = usageDayKeysBack(win);
  // nomes PROPRIOS da matriz (matrixKindNames/matrixModelNames): incluem _resto
  // quando algum dia tem fatia sem detalhamento, independente da linha do tempo
  const kindNames = u.matrixKindNames || u.kindNames || [];
  const modelNames = u.matrixModelNames || u.modelNames || [];
  if (!modelNames.length) { el.innerHTML = '<div class="usage-empty">Sem dados ainda.</div>'; captionEl.textContent = ''; return; }
  const m = usageMatrixRows(u.matrixSeries || [], kindNames, modelNames, days, metric);
  if (!m.grand) { el.innerHTML = '<div class="usage-empty">Sem consumo nesta janela.</div>'; captionEl.textContent = ''; return; }
  captionEl.textContent = metric === 'custo' ? 'custo estimado no período' : 'tokens no período';
  const kindLabel = k => USAGE_KIND_LABEL[k] || k;
  const modelLabelOf = mm => mm === '_resto' ? 'Sem detalhamento' : mm;
  // valor EXATO no title da celula (fmtTok/fmtMoney): as celulas compactadas
  // (43k) nao somam o proprio total a vista, e o title e onde confere sem ruido
  const exact = v => metric === 'custo' ? fmtMoney(v) : fmtTok(v);
  // modelo aposentado nunca some de u.modelNames (byModel, no backend, não tem poda:
  // é histórico permanente), então sem esse filtro a coluna dele ficava pra sempre na
  // matriz, zerada. A linha do tempo já faz o equivalente na legenda (totalPorNome[i]
  // > 0); aqui é a mesma ideia aplicada às colunas (achado da revisão final).
  const idxAtivos = modelNames.map((_, j) => j).filter(j => m.colTotals[j] > 0);
  const modelosAtivos = idxAtivos.map(j => modelNames[j]);
  const cols = `96px repeat(${modelosAtivos.length}, minmax(0,1fr)) 64px`;
  const head = `<div class="usage-matrix-row head" style="grid-template-columns:${cols}"><span></span>${modelosAtivos.map(mm => `<span class="usage-matrix-hcell">${esc(modelLabelOf(mm))}</span>`).join('')}<span class="usage-matrix-hcell">Total</span></div>`;
  const rows = m.rows.filter(r => r.total > 0).map(r => `<div class="usage-matrix-row" style="grid-template-columns:${cols}">
      <span class="usage-matrix-label"><span class="dot" style="background:${USAGE_KIND_COLOR[r.kind] || 'var(--faint)'};width:8px;height:8px;border-radius:2.5px;display:inline-block"></span>${esc(kindLabel(r.kind))}</span>
      ${idxAtivos.map(j => { const c = r.cells[j]; return `<span class="usage-matrix-cell" style="background:color-mix(in srgb, var(--accent) ${((0.04 + 0.24 * c.intensity) * 100).toFixed(0)}%, transparent)" title="${esc(kindLabel(r.kind))} × ${esc(modelLabelOf(c.model))}: ${esc(exact(c.value))}">${esc(fmtUsageMetric(c.value, metric))}</span>`; }).join('')}
      <span class="usage-matrix-total" title="${esc(exact(r.total))}">${esc(fmtUsageMetric(r.total, metric))}</span>
    </div>`).join('');
  const foot = `<div class="usage-matrix-row foot" style="grid-template-columns:${cols}"><span>Total</span>${idxAtivos.map(j => `<span class="usage-matrix-total" title="${esc(exact(m.colTotals[j]))}">${esc(fmtUsageMetric(m.colTotals[j], metric))}</span>`).join('')}<span class="usage-matrix-grand" title="${esc(exact(m.grand))}">${esc(fmtUsageMetric(m.grand, metric))}</span></div>`;
  el.innerHTML = `<div class="usage-matrix">${head}${rows}${foot}</div>`;
}

// um cartao por perfil de Claude configurado (Sistema -> Plano e chaves). Perfil de
// assinatura (kind 'assinatura') nao tem teto, so uma nota informativa; perfil de
// chave mostra os 2 medidores (diario/total), gasto x teto.
//
// FONTE UNICA (v2.40.0): tudo vem de u.budgets (usageSummary), que traz teto E
// gasto E bloqueio calculados pela MESMA funcao do gate real (profileBudgetStatus)
// no momento de cada pushState. Antes, o gasto vinha de STATE.doctor.claudeAuth
// (cache que so recalculava no boot/Verificar agora/salvar perfis) e o teto de
// STATE.config: o cartao congelava enquanto o KPI "Hoje" da mesma tela crescia, e
// a automacao pausava por estouro com o cartao ainda dizendo "no orcamento".
function drawUsageBudget(el, u) {
  const perfis = (u && u.budgets) || [];
  if (!perfis.length) { el.innerHTML = '<div class="usage-empty">Nenhum perfil de Claude configurado ainda.</div>'; return; }
  const meter = (label, spent, cap) => {
    // cap == null: teto NAO configurado (meter() nem chega a ser chamado nesse caso, ver
    // abaixo). cap === 0 e um teto valido (lib/parse.js aceita 0), e qualquer gasto acima
    // de zero ja estoura ele, por isso cap > 0 (que tratava 0 como "sem teto") virava um
    // sliver vazio e nao vermelho, contradizendo o selo "estourado" do cartao (achado de
    // review). >= no lugar de > pra bater com o mesmo criterio de profileBudgetStatus
    // (lib/engine/usage.js), que bloqueia em spent >= cap, nao só spent > cap.
    const pct = cap != null ? Math.min(100, cap > 0 ? (spent / cap) * 100 : (spent > 0 ? 100 : 0)) : 0;
    const over = cap != null && spent >= cap;
    return `<div class="usage-meter">
      <div class="usage-meter-row"><span>${esc(label)}</span><span>${esc(fmtMoney(spent))} / ${esc(fmtMoney(cap))}</span></div>
      <span class="usage-meter-track"><span class="usage-meter-fill${over ? ' over' : ''}" style="width:${Math.max(2, pct).toFixed(0)}%"></span></span>
    </div>`;
  };
  const temChave = perfis.some(p => p.kind === 'apikey');
  el.innerHTML = perfis.map(p => {
    const isApiKey = p.kind === 'apikey';
    const statusCls = p.blocked ? 'bad' : 'ok';
    const statusTxt = !isApiKey ? 'coberto pela assinatura' : (p.blocked ? 'orçamento estourado' : 'no orçamento');
    const meters = isApiKey
      ? [p.budgetDaily != null ? meter('Teto diário', p.today, p.budgetDaily) : '', p.budgetTotal != null ? meter('Teto total', p.sinceCutoff, p.budgetTotal) : ''].join('')
      : '';
    const irAoTeto = `sys:plans:.cp-budget-daily[data-id="${String(p.id).replace(/"/g, '\\"')}"]`;
    const nota = !isApiKey
      ? '<span class="usage-budget-note">Sem teto configurado: o gasto em tokens não vira fatura, só entra no registro.</span>'
      : (p.budgetDaily == null && p.budgetTotal == null
        ? `<span class="usage-budget-note">Nenhum teto definido pra este perfil (<span class="is-goto" data-goto="${esc(irAoTeto)}" role="button" tabindex="0">definir em Sistema → Plano e chaves</span>).</span>`
        : (p.blocked ? '<span class="usage-budget-note">Automação de gasto pausada pra este perfil (revisão automática, retentativa e scan de pushback).</span>' : ''));
    // o nome do perfil leva ao card DELE em Sistema (o input do nome carrega o
    // mesmo id; seletor montado aqui porque CSS.escape não existe no pure.js)
    const alvoPerfil = `sys:plans:.cp-label[data-id="${String(p.id).replace(/"/g, '\\"')}"]`;
    return `<div class="usage-budget-card">
      <div class="usage-budget-head">
        <span class="usage-budget-name is-goto" data-goto="${esc(alvoPerfil)}" role="button" tabindex="0" title="Abrir este perfil em Sistema → Plano e chaves">${esc(p.label || p.id)}</span>
        <span class="usage-budget-kind">${isApiKey ? 'Chave de API' : 'Login por assinatura'}</span>
        <span class="usage-budget-status ${statusCls}">${esc(statusTxt)}</span>
      </div>
      ${meters}
      ${nota}
    </div>`;
  }).join('')
    // lacuna declarada (auditoria de 10/08): a sessao interativa de terminal usa a
    // MESMA credencial do perfil, mas o claude interativo nao emite stream-json,
    // entao esse gasto nao tem como entrar na medicao nem no teto. Sem declarar,
    // o cartao prometia um teto que um dos caminhos de gasto nunca encontra.
    + (temChave ? '<span class="usage-budget-note">Sessões interativas no terminal usam a mesma credencial, mas não entram na medição nem no teto: o CLI não reporta o consumo delas ao Farol.</span>' : '');
}

// tabela das sessoes mais recentes (ate 100, cortado no backend). Log permanente
// em disco (usage-sessions.json); a UI so mostra as mais novas, com rolagem.
function drawUsageSessions(el, u) {
  const lista = u.recentSessions || [];
  // mensagem curta de proposito: a explicacao completa (o que gera consumo) ja
  // aparece na linha do tempo, logo acima nesta mesma aba; repetir a frase
  // inteira aqui so duplicava as mesmas 25 palavras duas vezes na tela.
  if (!lista.length) { el.innerHTML = '<div class="usage-empty">Nenhuma sessão ainda.</div>'; return; }
  const head = `<div class="usage-sessions-row head">
      <span class="usage-sessions-hcell">Quando</span><span class="usage-sessions-hcell">Tipo</span>
      <span class="usage-sessions-hcell">PR / sessão</span><span class="usage-sessions-hcell">Modelo</span>
      <span class="usage-sessions-hcell">Farol</span>
      <span class="usage-sessions-hcell right">Tokens</span><span class="usage-sessions-hcell right">~US$</span>
      <span class="usage-sessions-hcell right">Estado</span></div>`;
  const rows = lista.map(s => {
    const r = usageSessionRow(s);
    return `<div class="usage-sessions-row">
      <span class="usage-sessions-when">${esc(r.whenLabel)}</span>
      <span class="usage-sessions-kind"><span class="dot" style="background:${USAGE_KIND_COLOR[s.kind] || 'var(--faint)'};width:8px;height:8px;border-radius:2.5px;display:inline-block"></span>${esc(r.kindLabel)}</span>
      ${sessionRefCell(r.ref, 'usage-sessions-ref')}
      <span class="usage-sessions-model">${esc(r.model)}</span>
      <span class="usage-sessions-farol"${r.farol === FAROL_PRE_STAMP_LABEL ? ` title="sessão registrada antes da ${FAROL_STAMP_SINCE}, quando o carimbo de versão passou a existir"` : ''}>${esc(r.farol)}</span>
      <span class="usage-sessions-num">${esc(r.tokLabel)}</span>
      <span class="usage-sessions-num">${esc(r.costLabel)}</span>
      <span style="text-align:right"><span class="usage-sessions-st ${r.stClass}">${esc(r.stLabel)}</span></span>
    </div>`;
  }).join('');
  // cobertura declarada: o log individual nasceu na v2.38.0 (10/08/2026); sessoes
  // anteriores existem SO nos agregados (KPI/linha do tempo/matriz, camada "Sem
  // detalhamento"). Sem a data, a tabela parecia ser o historico inteiro.
  const desde = u.sessionsSince ? new Date(u.sessionsSince) : null;
  const p2 = n => String(n).padStart(2, '0');
  const desdeTxt = desde ? `Registro individual desde ${p2(desde.getDate())}/${p2(desde.getMonth() + 1)}/${desde.getFullYear()}; sessões anteriores aparecem só nos agregados. ` : '';
  el.innerHTML = `<div class="usage-sessions">${head}${rows}</div>
    <div class="usage-sessions-foot"><span>${esc(desdeTxt)}Registro permanente, sem botão de zerar.</span><span>Mostrando as ${lista.length} mais recentes</span></div>`;
}

function renderUsage() {
  const u = STATE && STATE.usage;
  const kpisEl = $('#usageKpis'), tl = $('#usageTimeline'), legend = $('#usageLegend');
  const matrix = $('#usageMatrix'), matrixCap = $('#usageMatrixCaption');
  const budget = $('#usageBudget'), sessions = $('#usageSessions');
  if (!kpisEl || !tl || !legend || !matrix || !matrixCap || !budget || !sessions) return;
  // cada painel decide a PROPRIA vaziez, lendo a PROPRIA fonte: u.totals vem de
  // usage.json, mas a matriz/sessões leem usage-sessions.json e daysByKindModel
  // (arquivos diferentes). Gatear a aba inteira num campo agregado só deixava a
  // tela se contradizer quando os dois arquivos discordam entre si (achado da
  // revisão final: timeline dizia "nenhuma sessão" com a matriz e a tabela de
  // sessões cheias logo abaixo). drawUsageTimeline/Matrix/Budget/Sessions já
  // sabem ficar vazias sozinhas (Task 14); só drawUsageKpis não tem essa
  // defesa, então o guard fica só pra ela.
  if (!u || !u.totals || !u.totals.sessions) kpisEl.innerHTML = '';
  else drawUsageKpis(kpisEl, u, usageState.window);
  drawUsageTimeline(tl, legend, u || {}, usageState.metric, usageState.window, usageState.dim);
  drawUsageMatrix(matrix, matrixCap, u || {}, usageState.metric, usageState.window);
  drawUsageBudget(budget, u || {});
  drawUsageSessions(sessions, u || {});
}

function wireUsageControls() {
  const bind = (sel, attr, key, cast) => {
    const box = document.querySelector(sel); if (!box) return;
    box.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
      marcarSeg(box.querySelectorAll('.seg-btn'), x => x === b);
      usageState[key] = cast ? cast(b.dataset[attr]) : b.dataset[attr];
      usageHoverIdx = null; // troca de metrica/janela/dimensao aposenta o hover antigo
      renderUsage();
    }));
  };
  bind('#usageMetric', 'metric', 'metric');
  bind('#usageWindow', 'window', 'window', Number);
  bind('#usageStack', 'dim', 'dim');
}
wireUsageControls();

function renderUpdate() {
  const u = STATE.update;
  const box = $('#updateBox');
  if (!u) { box.textContent = 'Verificando…'; return; }
  const remote = u.channel === 'remote';
  // o repo das releases é menção a coisa navegável: abre a página de releases
  const origin = remote
    ? `GitHub Releases (<a href="https://github.com/${esc(u.repo || '')}/releases" target="_blank" rel="noreferrer" title="Abrir as releases no GitHub"><code>${esc(u.repo || '')}</code></a>)`
    : (u.source ? `fonte em <code>${esc(u.source)}</code>` : '');
  const hasChannel = remote || !!u.source;
  // não deu pra ler a release (repo privado/sem acesso, sem release ainda, ou rede):
  // sourceVersion nulo + note. Não é "está na mais recente", é falta de acesso.
  const noAccess = hasChannel && !u.available && !u.sourceVersion && !!u.note;
  box.classList.toggle('avail', !!u.available);
  box.classList.toggle('ok-state', !u.available && hasChannel && !noAccess);
  if (u.available) {
    const autoOn = remote && STATE.config?.autoUpdate !== false;
    const noteAuto = autoOn
      ? `Atualização disponível ${'nas ' + origin}. Com "Atualizar sozinho" ligado (Sistema > Automação), o Farol aplica sozinho assim que ficar ocioso (sem análise, chat ou terminal em andamento), fecha e reabre preservando estado e configurações. O botão abaixo aplica agora, sem esperar.`
      : `Atualização disponível ${remote ? 'nas ' + origin : 'na ' + origin}. O Farol ${remote ? 'baixa e instala, ' : ''}fecha e reabre sozinho, preservando estado e configurações.`;
    const queuedLine = u.queued ? ' <b>Agendado:</b> aplica sozinho assim que as sessões em andamento terminarem.' : '';
    box.innerHTML = `
      <span class="up-ver">v${esc(u.current)} → v${esc(u.sourceVersion)}</span>
      <span class="up-note">${noteAuto}${queuedLine}</span>
      <button id="btnUpdateNow" class="btn primary sm">Atualizar agora</button>`;
    $('#btnUpdateNow').onclick = async () => {
      // confirm() nativo era o último popup fora da identidade do app neste fluxo
      // (pedido do Wanderson, 15/08/2026): o modal do próprio Farol explica o que
      // vai acontecer, e nada roda sem o clique em Atualizar.
      const ok = await confirmModal({
        title: `Atualizar pra v${u.sourceVersion}?`,
        body: `<p>O Farol sai da <b>v${esc(u.current)}</b> pra <b>v${esc(u.sourceVersion)}</b>.</p>
          <ul>
            <li>${remote ? 'baixa a release e instala' : 'copia os arquivos da pasta-fonte'} sozinho;</li>
            <li>o app <b>fecha e reabre</b> no fim (leva alguns segundos);</li>
            <li>estado, memória do time e configurações ficam intactos;</li>
            <li>se houver revisão ou sessão em andamento, nada é morto no meio: o update fica agendado e aplica sozinho assim que terminar.</li>
          </ul>`,
        confirmLabel: 'Atualizar'
      });
      if (!ok) return;
      const r = await api('/api/update', {});
      // ocupado não é erro (v2.46.1): o clique agenda e o Farol aplica ao ficar ocioso
      if (r?.queued) toast('info', 'Tem análise, chat ou sessão de terminal em andamento. O update ficou agendado: assim que terminar, o Farol aplica sozinho, fecha e reabre.');
      else if (!r?.ok) toast('error', esc(r?.error || 'não consegui iniciar a atualização'));
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
  const box = $('#highlights');
  const opId = 'load-highlights';
  showOp(opId, { type: 'data', title: 'Carregando destaques', inline: true, container: box });
  const items = (await get('/api/highlights')) || [];
  closeOp(opId, 'done');
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
          ${h.author ? `<span class="author">${personMention(h.author, 'xs', true)}</span>` : ''}
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
  const box = $('#team');
  const opId = 'load-team';
  showOp(opId, { type: 'data', title: 'Carregando time', inline: true, container: box });
  const team = (await get('/api/team')) || [];
  closeOp(opId, 'done');
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
          <div class="login">${personMention(m.login, 'xs', true)} · ${entries.length} review(s) registrados</div>
        </div>
        ${verdictChip}
        ${papelPicker(m.login)}
        <button class="btn sm ghost member-remove" data-login="${esc(m.login)}" title="Remover @${esc(m.login)} do Time (apaga a memória local sobre a pessoa; pede confirmação)">Remover</button>
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

// Remover do Time: ação destrutiva, então o botão SÓ abre o modal de confirmação
// (padrão do app pra tudo que apaga, ver confirmModal) explicando o efeito; nada
// acontece sem o clique em Remover. A remoção vale pra pessoa INTEIRA (o dossiê é
// um só), então os cards dela em todos os grupos (conta e "Geral") saem juntos.
$('#team').addEventListener('click', async (e) => {
  const btn = e.target.closest('.member-remove');
  if (!btn) return;
  const login = btn.dataset.login || '';
  const ok = await confirmModal({
    danger: true,
    title: `Remover @${login} do Time?`,
    body: `<p>Apaga <b>desta máquina</b> tudo o que o Farol guarda sobre ${personMention(login, 'xs')}:</p>
      <ul>
        <li>o dossiê com o histórico de reviews (todos os grupos, inclusive "Geral");</li>
        <li>os destaques registrados nos reviews dessa pessoa;</li>
        <li>o papel e a matriz de competência configurados;</li>
        <li>os registros de contestação (pushback).</li>
      </ul>
      <p>Nada é alterado no GitHub, e a remoção não desfaz. Se um PR dessa pessoa for revisado de novo, um dossiê novo começa do zero.</p>`,
    confirmLabel: 'Remover'
  });
  if (!ok) return;
  const r = await api('/api/team/remove', { login });
  if (r && r.ok) { toast('ok', `@${esc(login)} removido do Time.`); loadTeam(); }
  else toast('error', `Não deu pra remover: ${esc((r && r.error) || 'falha na chamada')}.`);
});

/* ---------- render: sistema ---------- */
function renderDoctor() {
  const d = STATE && STATE.doctor;
  const box = $('#doctor');
  if (!d) { box.innerHTML = '<div class="empty">Verificando o ambiente…</div>'; return; }
  // `goto` (opcional): o check cita uma coisa configurável do app, então clicar
  // leva até ela (a conta abre o card dela em Contas)
  const checks = [
    { ok: !!d.gh, label: 'GitHub CLI', detail: d.gh || 'gh não encontrado no PATH' },
    {
      ok: d.ghAuth, label: STATE.config.ghUser ? `Conta @${STATE.config.ghUser}` : 'Conta do GitHub',
      detail: d.ghAuth ? 'autenticada no gh' : 'sem token: rode gh auth login (conta de trabalho)',
      goto: STATE.config.ghUser ? `sys:accounts:.acct-label[data-user="${String(STATE.config.ghUser).replace(/"/g, '\\"')}"]` : 'sys:accounts:#accountsManager'
    },
    { ok: !!d.claude, label: 'Claude Code', detail: d.claude || 'claude não encontrado no PATH', goto: 'sys:plans:#claudeProfilesManager' },
    // Git Bash é pré-requisito só no Windows (CLAUDE_CODE_GIT_BASH_PATH)
    ...(ehWin() ? [{ ok: !!d.gitBash, label: 'Git Bash', detail: d.gitBash || 'não encontrado: sessões do Claude podem travar' }] : []),
    { ok: true, label: 'Pasta de trabalho', detail: d.workspace },
    // ambiente ok não quer dizer que vai achar PR: os checks de operação (conta
    // sem organização, conta sem token, tudo silenciado) moram no pure.js
    ...operationChecks(STATE.accounts)
  ];
  box.innerHTML = checks.map(c => `
    <div class="check ${c.ok ? 'ok' : 'bad'}${c.goto ? ' is-goto' : ''}"${c.goto ? ` data-goto="${esc(c.goto)}" role="button" tabindex="0" title="Abrir a configuração deste item"` : ''}>
      <span class="led"></span>
      <div><div class="label">${esc(c.label)}</div><div class="detail">${esc(c.detail)}</div></div>
    </div>`).join('');
  $('#about').innerHTML = `O polling usa só o GitHub CLI (zero tokens de IA). O Claude entra apenas quando você abre uma revisão.`;
  // versão e caminho dos dados moram no rodapé da sidebar, visíveis em qualquer seção.
  // A versão leva às Novidades dela (a menção mais citada da tela toda).
  $('#sysFoot').innerHTML = `<span class="is-goto" data-goto="sys:news:#relNotes" role="button" tabindex="0" title="Ver as novidades desta versão">Farol v${esc(STATE.app.version)}</span><br>dados em <code>${esc(STATE.paths.home)}</code>`;
}

// Novidades por versão (mostradas na aba Sistema; a versão atual vem marcada).
// Ao cortar uma release, some uma linha aqui no topo.
const RELEASE_NOTES = [
  ['2.47.0', ['Nova chave em Sistema > Automação: "Aprovar sozinho mesmo discordando de outro review". Quando a revisão discorda de um apontamento de outro revisor (Acrity, Sonar, uma pessoa) e prova a discordância, o Farol sempre segurou o PR pra você decidir. Agora é escolha sua: desligada (padrão) nada muda, ligada a discordância deixa de travar e vira só ponto de atenção, com a regra de ressalvas decidindo o resto. A discordância segue nunca sendo escrita no PR, e reprovar sozinho em cima dela continua sempre passando por você.', 'A linha de uma revisão que você aprovou na mão agora diz por que ela veio pra sua mesa. Antes mostrava só "postado por você (APPROVE)" e o motivo (discordância, cobertura incompleta, revisão disparada por você, política da conta) ficava invisível, mesmo já estando gravado.']],
  ['2.46.2', ['Intervalo de checagem com piso de 3 minutos: as opções de 1 e 2 minutos saíram do sistema (curtas demais, só gastavam chamadas do gh); quem estava nelas passa automaticamente pra 3 minutos.', 'O log de falhas (farol.log) agora carimba em horário de Brasília com o fuso explícito na linha, em vez de UTC sem marcador (que ficava 3 horas deslocado do resto do app e confundia o Diagnóstico). Linhas antigas continuam sendo lidas normalmente.']],
  ['2.46.1', ['Clicar em Atualizar durante uma análise não dá mais erro: o update fica agendado e aplica sozinho quando a análise termina. O aviso virou informativo (explica o agendamento), o banner da Visão geral mostra quando há update agendado, e o clique vale mesmo com o "Atualizar sozinho" desligado (pedido explícito, válido por uma vez).']],
  ['2.46.0', ['O Farol agora se atualiza sozinho: com uma atualização disponível nas releases do GitHub, ele aplica sozinho assim que nenhuma análise, chat ou sessão de terminal estiver rodando (espera terminar o que está em andamento, depois baixa, instala, fecha e reabre preservando estado e configurações). O botão "Atualizar agora" continua funcionando igual pra aplicar na hora. Desligue em Sistema > Automação (toggle "Atualizar sozinho") pra voltar ao clique manual.']],
  ['2.45.1', ['Migração pra ESM puro: todo arquivo .js é agora módulo nativo (zero CommonJS), a validação de sintaxe passa a usar node --check, e engines declarado >=22.12 (abaixo disso o require/interop de ESM nos fluxos de teste não é confiável). O código perdeu o truque de carga dupla da UI e ficou mais limpo.', 'Gate de qualidade automático com ratchet: npm run lint compara o código atual contra a baseline gravada, monitora 10 regras (tamanho de arquivo, catch vazio, var, JSON.parse cru, JSON.stringify cru, process.env direto, ternário aninhado, tempo mágico, porta literal e profundidade excedida, com a referência de card como checagem irmã separada), e reprova regressão em qualquer uma. Extração e refino deste ciclo: check() de 297 pra 74 linhas, handler de sessão achatado, e reduções em portaLiteral (6→0), processEnvDireto (19→11), jsonParseCru (32→26), emptyCatch (20→17), tempoMagico (12→10) e profundidadeExcedida (87→82).']],
  ['2.45.0', ['Suporte experimental a Linux: o Farol agora instala (installer/install-linux.sh), abre pelo menu de aplicativos (.desktop), monitora, revisa e se atualiza num Linux ou WSL. Sessões de terminal abrem no emulador disponível (x-terminal-emulator, gnome-terminal, konsole ou xterm), com aviso claro se nenhum existir. Validado num Ubuntu real (WSL): suíte completa verde e app instalado abrindo com o engine no ar. Fora do escopo por enquanto: bandeja, autostart e instalador offline no Linux.']],
  ['2.44.3', ['Revisão completa de suporte a Windows e macOS (auditoria em 4 frentes). No mac: sessão de terminal não fica mais presa quando a porta não está no config, conta sem token aborta com aviso em vez de agir na conta errada, console de login não herda token do profile, instalador offline e auto-update não exigem mais Node, e a validação da instalação confere o binário que o app realmente executa. No Windows: o update passou a remover arquivos que a versão nova deletou, e o desinstalador agora acompanha a instalação. Atalhos e exemplos da interface mostram Cmd/⌘ no mac e Ctrl no Windows. Auditoria do pacote de release passou a varrer também os scripts de mac, e a suite ganhou 8 testes de plataforma (incluindo o cancelamento de sessão posix com processo real).']],
  ['2.44.2', ['Progresso honesto em TODO o app, com régua única: a revisão automática (cards do "Analisando agora") ganhou barra de progresso movida pela atividade real da sessão, e o chat por PR deixou de ficar parado em 25% (mesma família do bug da autoanálise). Os três fluxos usam a mesma régua central, e um teste impede percentual chutado de voltar.']],
  ['2.44.1', ['A barra de progresso da autoanálise (Meus PRs) parou de mentir: ela ficava fixa em 25% e concluía do nada, porque os percentuais eram números chutados. Agora ela acompanha a atividade real da sessão (cada ação do Claude move a barra e vira o texto do passo), avançando até 90% e fechando quando a análise termina de verdade.']],
  ['2.44.0', ['Botão Remover no card do Time: quando alguém sai da equipe, apaga desta máquina o dossiê, os destaques, o perfil e os pushbacks da pessoa, com modal de confirmação explicando o efeito. Nada é alterado no GitHub.', 'Confirmações de "Atualizar agora" e "Zerar log" trocaram o popup nativo do sistema por modais do próprio Farol, com a explicação do que vai acontecer. Não resta popup nativo no app.', 'Créditos com origem: a seção Sobre registra que o Farol nasceu da iniciativa do Thiago (@thiagopcdev), o revisor de PRs em janela de terminal cuja essência o app reconstruiu.']],
  ['2.43.0', ['Seção "Sobre" na aba Sistema: o compromisso de privacidade (o Farol não coleta nem envia nenhum dado a quem o mantém, tudo fica local em ~/.farol), a licença MIT e os créditos do projeto.', 'Créditos sincronizados com o GitHub: idealizador e contribuidores aparecem com foto e link pro perfil, e colaborador novo que entrar no repositório entra na lista sozinho, sem manutenção.']],
  ['2.42.2', ['Sessão registrada antes da v2.42.0 deixou de aparecer com a célula vazia na coluna Farol do Consumo: agora mostra "< 2.42.0", com explicação no tooltip. Regra só de exibição, o registro em disco segue intocado.']],
  ['2.42.1', ['Licença MIT formalizada (arquivo LICENSE) e seção "Privacidade e responsabilidade" no README: o Farol não coleta nem envia dado nenhum ao mantenedor, não há telemetria, tudo fica local em ~/.farol e o tráfego de rede é todo em nome do usuário (GitHub via gh, Anthropic via Claude Code).']],
  ['2.42.0', ['Coluna "Farol" nas Sessões recentes do Consumo: toda sessão fica carimbada com a versão do app que a produziu, junto do modelo e do custo (auditoria de contexto). Sessões antigas aparecem com a célula vazia, sem retro-carimbo.', 'A versão nunca vaza pro review postado: a trava de linguagem bloqueia proveniência com versão ("gerado pelo Farol vX.Y.Z") e continua permitindo menção técnica legítima quando o assunto do PR é o próprio Farol.']],
  ['2.41.4', ['Auto-update espera sessões de terminal também (e sessão esquecida há mais de 12h deixa de segurar a atualização pra sempre).', 'Estacionamento de revisões falhas persiste em disco: reiniciar o app não relança sessão fadada à mesma falha, e a limpeza respeita falha de rede e orgs fora da config.', 'Orçamento re-checado na boca de cada sessão: lote enfileirado antes do estouro não atravessa mais o teto (aviso único por perfil, PRs estacionam e voltam por clique).', 'Autorização de postagem do terminal vale enquanto a sessão viver, com teto de 12h (acabou o "expirada" no meio do almoço).', 'Multi-conta: se o mesmo PR chega por duas contas, a conta capaz (com login e não silenciada) assume.', 'Clique duplo no Merge recusa com aviso discreto; downloads de update com mais de 24h são limpos; e o perfil de assinatura vence credenciais soltas no shell do macOS/Linux (limpeza dentro do próprio login shell).']],
  ['2.41.3', ['Round 2 automático resiliente: reinício do app não queima mais a âncora da re-revisão (o boot poda e o ciclo re-arma), flake do GitHub no início da sessão cai no commit conhecido do relançamento, e queda de rede não rebaixa o round a manual nem deixa o card mentindo "aguardando você".', 'Rascunho não dispara re-revisão automática (push de WIP não queima sessão nem posta em cadência de robô).', 'Pendências sem beco: PR fechado sem merge cancela o card com aviso, aprovar à mão durante a análise reconcilia (ação decisiva no mesmo commit conta, comentário avulso não), e o bloqueio do filtro de linguagem explica o motivo e aponta o chat como saída.', 'Review por clique ancora no commit que a análise leu: push entre a análise e o clique não silencia mais o round novo.']],
  ['2.41.2', ['Review postado agora carrega o commit que a revisão LEU: push do autor durante a sessão deixa o review defasado de verdade e a re-revisão automática arma (antes o GitHub carimbava o head do momento do post e o round novo nunca abria).', 'Decisões concorrentes não se atropelam: o clique re-localiza a pendência pelo id antes de remover, achado de outra revisão não some mais da lista.', 'Merge recusa PR que recebeu commit depois da sua autoanálise.', 'Fim de dois vazamentos de custo: comentário de terceiro não reclassifica mais a mesma thread de pushback a cada ciclo, e seen.txt truncado por queda de energia não dispara mais rajada de re-revisões.', 'Duas contas: a queda de busca de uma preserva PRs, autoanálises e ocultos da outra.']],
  ['2.41.1', ['Revisão automática mais precisa: seis lições medidas em reviews reais (achados verificados um a um e contestações de autor confirmadas) entram no protocolo que toda revisão lê. O revisor passa a checar o diff acumulado da branch (não commit isolado), a listar o que um remédio proposto NÃO cobre, a dimensionar o raio real de cada achado e a distinguir required check configurado de doutrina do time.', 'Menos falso blocker: código que segue padrão já aceito no repo e exigência de processo fora do diff (check obrigatório, branch protection) deixam de bloquear; viram ressalva e sugestão. Nenhum gate afrouxou, muda a pontaria e não o rigor.']],
  ['2.41.0', ['Re-revisão automática: quando você pediu mudanças e o autor empurrou a correção, o PR volta pra fila de revisão sozinho no ciclo seguinte, sem clique. Cada commit é relançado no máximo uma vez e a postagem continua atrás dos gates de sempre.', 'Revisões paralelas por conta (opt-in em Sistema): a mesma conta pode rodar até 4 revisões automáticas ao mesmo tempo. O padrão continua 1, em série, como sempre foi.', 'PRs em rascunho entram no radar e na fila, com selo "rascunho" no card. O merge de rascunho continua bloqueado.']],
  ['2.40.8', ['PR mergeado ou fechado enquanto esperava no retry de rede não gera mais cascata de notificações a cada ciclo de polling. Antes cada ciclo disparava "relançando..." seguido de "já mergeado, cancelei", sem parar. Agora o estado é conferido antes de notificar, e o PR sai do retry em silêncio.']],
  ['2.40.7', ['A caixa de revisão agora mostra somente o contexto técnico útil para o autor: problema, impacto e próximo passo. Motivos operacionais ficam separados em "Por que precisa de você", e registros antigos são limpos apenas na apresentação, sem alterar o histórico salvo.', 'Antes de postar pelos fluxos do Farol, o corpo e todos os comentários inline passam por uma validação determinística que bloqueia linguagem de bastidor e formatos com aparência de template. O caso real que motivou a correção e variações com Markdown, HTML e caracteres invisíveis viraram testes.', 'Análise incompleta ou payload incompatível não aprova nem pede mudanças sozinho. Terminal e chat usam uma autorização temporária limitada ao PR, inclusive quando uma conversa antiga é retomada, e postagens simultâneas não duplicam nem cruzam corpos.']],
  ['2.40.6', ['Na visão por Pessoas, quem tem mais PRs mergeados no período aparece primeiro; merge mais recente e login só desempatam. A ordem acompanha organização, período e busca atuais, enquanto Repositórios continua por recência.', 'Os grupos de Pessoas agora nascem recolhidos. O que você abrir permanece aberto ao buscar ou usar "mostrar mais/menos", e trocar organização ou período começa novamente com a lista compacta.', 'O atalho "@fulano na frente" abre e leva até a pessoa líder, e a seta do cartão finalmente gira junto com o estado aberto.']],
  ['2.40.5', ['Revisão de segunda rodada volta a chegar no PR. Antes de postar, o Farol perguntava "eu já pedi mudanças neste PR alguma vez?"; como a resposta era sim desde a primeira rodada, tudo que a revisão achava depois que o autor empurrava a correção ficava só na sua máquina. Aconteceu duas vezes seguidas no mesmo PR: o Farol concluiu que a correção não tinha fechado o buraco e não postou nenhuma das duas. Agora a pergunta é "eu já me manifestei sobre ESTE commit?", e a mesma rodada continua sem virar review duplicado.', 'O mesmo bloqueio valia pro clique em "Precisa de você": um review de rodada antiga convertia o clique explícito em "já revisado" e nada era postado.', '"Já revisado por você (não repostei)" agora mostra os achados na linha, em "N achados que ficaram só aqui". Era o único status que escondia os achados, justamente aquele em que eles só existem dentro do app.']],
  ['2.40.4', ['Painel vazio agora tem explicação. Sistema → Visão geral ganhou uma linha de monitoramento por conta: conta sem organização cadastrada aparece como problema (era o pior silêncio do app, os 5 itens ficavam verdes, nenhuma busca era feita e o painel ficava vazio pra sempre sem erro nenhum), conta adicional sem gh auth login também, e "todas as contas silenciadas" avisa que nada vai aparecer mesmo com PR esperando. Clicar em qualquer uma leva direto à conta em Contas.']],
  ['2.40.3', ['A revisão de um PR abre direto da tabela de Consumo: cada linha de PR ganhou um atalho ao lado da referência, que mostra veredito, pontos de atenção e o relatório completo ali mesmo. O texto continua abrindo o PR no GitHub, então você escolhe pra onde vai.', 'O histórico de revisões passou de 200 pra 3000. Antes, revisão que saísse das 200 mais recentes sumia, e a tela só alcançava as 30 mais novas; agora qualquer revisão guardada abre pelo atalho, inclusive as antigas e as de outra conta, sem pesar o que o app carrega a cada ciclo.', 'PR sem revisão registrada e falha na busca viraram mensagens diferentes. Antes ficariam idênticas na tela, e "não existe" parecendo "quebrou" faz desconfiar do app inteiro.']],
  ['2.40.2', ['A sessão de ferramenta na tabela de Consumo agora navega por clique: "Kudos" abre a aba Destaques no painel dos kudos compilados, e "Diagnóstico do Farol" abre Sistema → Diagnóstico no relatório. Antes só a referência de PR era clicável e a linha de ferramenta ficava como texto morto.', 'Trava nova no gate de qualidade: destino de navegação interna apontando pra aba, seção ou âncora inexistente passa a reprovar a suíte. Esse defeito não gera erro nenhum, o clique só não faz nada, e é o tipo mais caro de achar.']],
  ['2.40.1', ['Foto de quem abriu o PR no Panorama (e na fila, nas decisões, em Destaques, no Time e na barra de identidade): toda menção de pessoa agora sai do mesmo lugar, com foto e link pro perfil no GitHub.', 'O que a tela menciona leva até a coisa com um clique: nome de pessoa e de repositório abrem o GitHub; a referência do PR na tabela de sessões abre o PR; "Sistema → Plano e chaves", o nome do perfil no cartão de orçamento, "o log em Sistema", "organizações monitoradas", "Automação" e a versão no rodapé abrem a seção exata, já rolada e destacada.', 'Atalhos nos cartões de Entregas: "@fulano na frente" e "repo na frente" levam ao grupo na lista (trocando a visão quando precisa) e "+N hoje" troca o período. Tudo navegável pelo teclado.', 'Correção: título comprido escondia o autor no Panorama (mesmo defeito corrigido em "Revisões recentes" na versão anterior). Agora quem trunca é o texto do título, e a foto com o @login ficam sempre visíveis.']],
  ['2.40.0', ['Consumo com fonte única de verdade: os painéis não se contradizem mais (o cartão de tokens dizia 942k nos 7 dias com a linha do tempo mostrando 43k). O registro antigo, sem quebra por tipo/modelo/conta, aparece como camada cinza "Sem detalhamento", reconciliada dia a dia: os totais de KPI, linha do tempo e matriz agora batem sempre, por construção.', 'Orçamento por perfil ao vivo: o cartão, o selo e o gasto na aba Sistema recalculam a cada atualização, com a mesma conta que pausa a automação, em vez de congelar no último "Verificar agora".', 'Entregas ordenadas pelo mais atual primeiro: quem mergeou por último abre a lista (por repositório e por pessoa), descendo até o grupo parado há mais tempo. O número de ranking saiu; quem mais entrega segue nos cartões "na frente".', 'Entregas sem números fantasma: dia sem merge aparecia como a 2ª barra mais alta do gráfico (colisão de estilo) e os cartões contavam ~50 merges de uma janela maior que a do gráfico (corte UTC). Agora dia zerado é um toco de 2px, "Hoje" começa às 00:00 de verdade, e total, média, pico e barras contam o MESMO período.', 'Registro mais completo: sessão cancelada depois do relatório final registra o gasto (e aparece como "cancelada", não "ok"); sessão com custo e zero tokens também registra; a tabela de sessões declara desde quando o registro individual existe; e o cartão de orçamento avisa que sessão interativa de terminal não entra na medição (o CLI não reporta).', 'KPIs honestos: o subtítulo de Tokens mostra o cache do período (o custo inclui cache), a variação (%) só aparece quando o período anterior tem histórico completo pra comparar, e as células da matriz mostram o valor exato no tooltip.']],
  ['2.39.0', ['Consumo redesenhado: cartões de KPI com tendência, linha do tempo empilhada por tipo/modelo/conta com hover, matriz Tipo × Modelo, orçamento por perfil com medidor, e uma tabela de sessões recentes mostrando o PR (ou chat/ferramenta) de cada uma.', 'Correção: o autor sumia de "Revisões recentes" quando o título do PR era comprido, porque o @login ficava dentro do título, que trunca com reticências. Agora o autor tem linha própria, com a mesma foto de perfil que a fila, "Precisa de você", Destaques e Time já usam.']],
  ['2.38.0', ['Entregas ganhou busca por título, autor ou repositório, período em seleção rápida (Hoje/7/15/30 dias), cartões de estatística, gráfico de merges por dia e paginação "mostrar mais" por grupo, com uma barra mostrando quanto cada repositório ou pessoa representa no período.']],
  ['2.37.1', ['Correção: o "Ocultar" de "Meus PRs" escondia só a autoanálise, nunca o PR, que era justamente o caso que motivou o pedido (PR próprio parado há anos ocupando a aba pra sempre). Agora "Ocultar" oculta o PR, e o botão que existia virou "Ocultar análise".', 'Um rodapé mostra quantos você escondeu, com opção de exibir de novo (card esmaecido e botão "Reexibir"). O contador da sub-aba conta o que está visível, e com tudo oculto a tela explica em vez de ficar em branco.', 'Ocultar não vira ignorar a realidade: o PR volta sozinho se receber commit novo. É só na sua tela, nada é escrito no GitHub, e queda de rede não desoculta nada.']],
  ['2.37.0', ['Diagnóstico agrupado: o log de falhas abre com um resumo por episódio (quantas vezes, de quando até quando, quais PRs, e se a falha se resolve sozinha ou depende de você), em vez de despejar linha crua. O detalhe continua embaixo, limitado às 40 linhas mais recentes. A aba Sistema mostra os três maiores grupos na própria linha do log.', 'Correção: um PR podia entrar em loop infinito de revisão. Falha passageira colocava o PR na lista de "tentar de novo"; se a falha seguinte fosse permanente (credencial recusada, acesso desligado pela organização), o app estacionava o PR mas não o tirava da lista, e o relançamento desfazia o estacionamento no ciclo seguinte. Deu 25 tentativas idênticas do mesmo PR em três horas.', 'Limite do plano Claude agora espera a hora do reset que vem escrita na própria mensagem, em vez de tentar 12 vezes por PR. O aviso passou a dizer o horário ("retomo depois das 21:00").']],
  ['2.36.1', ['Correção: a revisão automática podia postar review num PR que já tinha sido mergeado. Agora uma pendência em "Precisa de você" cancela sozinha quando o PR mergeia enquanto espera sua decisão, e a revisão automática confere o estado do PR antes de começar, pulando sem gastar tokens se já foi mergeado enquanto esperava a vez na fila.']],
  ['2.36.0', ['Checkpoint de verificação: a revisão headless guarda uma memória incremental do que já verificou (afirmação por arquivo:linha), pra não reprocessar tudo do zero se a sessão travar num erro transitório (ex.: 529 de sobrecarga) e precisar recomeçar. Sempre gravado pelo motor do Farol, nunca pela sessão diretamente.', 'Divergência entre duas verificações da mesma afirmação nunca é resolvida em silêncio: vira ponto de atenção e trava a postagem automática (aprovação e reprovação), igual já acontecia com cobertura incompleta. "Revisões recentes" mostra quantas afirmações foram confirmadas e se há divergência pendente.', 'O checkpoint expira sozinho quando o PR ganha commit novo: uma divergência contra código que já mudou deixa de travar a postagem automática pra sempre (o histórico completo continua guardado, só para de contar pro gate).']],
  ['2.35.2', ['Correção: o Panorama mostrava "Revisando…" pra PR que só estava na fila, sem nenhuma revisão rodando de fato. Agora distingue "Revisando…" (sessão rodando) de "Na fila (N)" (esperando a vez), igual "Meus PRs" já fazia.']],
  ['2.35.1', ['"Meus PRs", "Pra mim" e "Panorama" podiam mostrar "você não tem nada" sem nunca ter confirmado: no boot ou quando o primeiro ciclo de verificação falhava, a tela assumia vazio em vez de avisar que ainda está verificando ou que a checagem falhou. Agora as três esperam uma resposta definitiva do motor antes disso.']],
  ['2.35.0', ['Orçamento por perfil de chave de API: cada perfil (Sistema > Plano e chaves) pode ter um teto diário e/ou total, com data de início. Estourar qualquer um pausa a automação de gasto daquele perfil (revisão automática, retentativa pós-falha e scan de pushback), sem bloquear clique manual nem a autoanálise. Card do perfil e aba Consumo mostram o gasto acumulado e o selo de estouro.', 'Uma sessão que gastava tokens e falhava só na última mensagem registrava zero custo. Agora o gasto é sempre contabilizado, mesmo em erro.', 'Um perfil liberado (teto aumentado) podia ficar com o aviso de estouro mudo pro próximo estouro real, se a fila estivesse vazia no meio do caminho. Corrigido: o estado é reconciliado a cada ciclo.']],
  ['2.34.1', ['Form de "Adicionar perfil" (Plano e chaves) ficava colado: o seletor de tipo e a linha de campos abaixo coincidiam sem espaço nenhum. Agora tem respiro entre as duas linhas.']],
  ['2.34.0', ['Perfil de assinatura Claude por chave de API: cada perfil agora pode ser "login por assinatura" (o de sempre) ou "chave de API" (ANTHROPIC_API_KEY + URL base opcional, billing por token). Os dois convivem no mesmo gerenciador (Sistema > Plano e chaves), escolhidos por conta do GitHub, e cobrem tanto as sessões automáticas quanto a sessão de terminal da fila. Perfil de chave não tem fluxo de claude login, a chave já é a credencial.', 'Uma chave de API já configurada na máquina (ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN) deixa de vazar sozinha pras sessões do Farol: agora é sempre limpa antes de aplicar o perfil escolhido.']],
  ['2.33.2', ['Panorama ganhou linha própria, no mesmo padrão de "Revisões recentes": cada PR empilhava título, autor e botão numa coluna só, porque a direita só tinha o horário. Agora horário e ações (conversar, revisar, copiar URL, abrir no GitHub) ficam ancorados à direita, título e autor dividem uma linha, e cada PR ocupa bem menos altura.', '"Conversar" e "copiar URL" chegaram no Panorama: não existia como abrir o chat de um PR direto da linha (o campo "Consultar um PR por URL" era o contorno pra isso). Agora estão na própria linha, junto com abrir no GitHub.']],
  ['2.33.1', ['"Meus PRs" ficava em branco, sem nenhum aviso, quando você não tinha PR aberto: a sub-aba escondia o cabeçalho inteiro e zerava a lista sem mensagem, diferente de "Pra mim" e "Panorama". Agora o cabeçalho continua visível e aparece "Você não tem PRs abertos nas organizações monitoradas" (ou "nesta conta", conforme o escopo).']],
  ['2.33.0', ['"Revisões recentes" mostra o dia, não só a hora: sai "hoje 17:51", "ontem 16:29", "01/08 15:35" e, quando é de outro ano, "24/07/2025 09:12", com data e hora completas no tooltip. Vale também pro card de "Precisa de você", que tinha o mesmo problema ao lado.', 'A linha aproveita a largura toda: a metade direita ficava em branco e agora ancora o carimbo e quatro ações sempre visíveis, conversar, revisar de novo, copiar a URL do PR e abrir no GitHub.', 'Aparece o que já existia e estava escondido: título do PR, autor, a etiqueta da conta (importante em "Todas") e o relatório completo da revisão, expansível ali mesmo.', 'E ficou mais curta, não mais alta: título e autor dividem uma linha, os três expansíveis dividem uma faixa só, e o selo do desfecho ganhou cor (verde aprovado, vermelho mudanças pedidas, azul comentado) pra varrer a lista de olho.']],
  ['2.32.4', ['PR que você resolveu pelo chat continuava aparecendo em "Precisa de você". O review ia pro GitHub, mas o card só saía se você clicasse num dos botões dele; agora o Farol confronta a pendência com os reviews que já são seus no PR e fecha sozinho, na hora ao fim da conversa e no ciclo de checagem pros reviews postados fora do app. Só fecha com review seu postado depois da análise, então re-request continua caindo na sua mesa, e nada desaparece quando não dá pra confirmar.']],
  ['2.32.3', ['A linha "Perfil padrão do Farol" saía esmagada, com uma palavra por linha (bug que a v2.32.2 introduziu): o seletor forçava largura total e comia a coluna de texto.', 'Plano e chaves passou a ocupar a mesma largura das outras telas do Sistema, no formato de Contas. Medido em 900, 1150 e 1280px nas quatro telas.']],
  ['2.32.2', ['Conexões e Plano e chaves ainda tinham espaço vazio à direita mesmo depois da v2.32.1. Agora usam o mesmo padrão de Preferências/Automação: linha cheia, texto à esquerda, controle ancorado à direita.']],
  ['2.32.1', ['Espaço vazio à direita nos cards de Conexões e Plano e chaves: mesma causa da v2.32.0 (card mais largo que o conteúdo), corrigida só nesses dois; Reviewers segue de largura total.', 'Novidades: a rolagem automática virou um botão "Ver mais", clicado por você em vez de carregar sozinho.']],
  ['2.32.0', ['Novidades carrega por rolagem: em vez de listar as 67 versões de uma vez, mostra 5 e carrega mais conforme você desce, até esgotar o histórico.', 'Espaço vazio à direita nos cards de Reviewers por projeto: o card ficava travado em 640px dentro do container de 1150px da aba Sistema. Corrigido pra ocupar a largura real disponível.']],
  ['2.31.0', ['Correção dos 52 gaps lógicos encontrados numa auditoria completa do código, executada em 9 ondas com teste antes de cada mudança: a suite foi de 392 pra 538 testes.', 'Identidade de conta ficou estrita: quando o token de uma conta falha no keyring do gh, o Farol não herda mais a identidade da outra conta. Busca, review postado, chat e autoanálise agora ou usam a conta certa ou avisam que ela está sem token; nunca mais um APPROVE sai assinado pela conta errada.', 'O radar aguenta ciclo ruim: falha só nas buscas de "pedido a mim" preserva a fila e os marcadores do último ciclo bom (antes zerava tudo, ressuscitava PRs ignorados e re-notificava), e o eco do índice do GitHub logo após postar review deixou de disparar re-revisão à toa.', 'Gates de aprovação sem furos: cobertura declarada com zero arquivos lidos não libera mais postagem automática, a identidade do PR nunca vem do texto gerado pela sessão, e a autoanálise carimba o commit lido antes da sessão e re-checa no fim (push no meio da análise invalida o resultado em vez de liberar merge de código não analisado). Autoanálises antigas sem esse carimbo são descartadas e pedem re-análise uma vez.', 'Abrir o app com outro Farol já rodando não deixa mais dois motores revisando em paralelo, e o update ficou seguro: caminho com espaço no perfil do Windows, clique duplo em Atualizar e sessão iniciada durante o download não quebram mais a atualização.', 'Sessões mais robustas: acento não vira mais caractere quebrado no meio do texto, processo que morre no meio vira erro de verdade em vez de resposta sem sentido, cancelar perto do timeout conta como cancelamento, e clique duplo em chat ou ferramenta não roda mais em dobro.', 'A interface parou de prometer o que não fazia: aprovar pela paleta de comandos funciona, o botão Cancelar da autoanálise cancela de verdade, confirmar um pushback sugerido funciona num clique, widgets de erro somem sozinhos em vez de acumular, e trocar filtro rápido nas Entregas não mistura mais os resultados.', 'Persistência ficou atômica: queda de energia no meio de um save não reseta mais a configuração pros padrões (arquivo corrompido é preservado como evidência e o log avisa), e o consumo passou a contar o dia no seu fuso, então o card Hoje não zera mais às 21h.']],
  ['2.30.1', ['Operações assíncronas nunca ficam silenciosas: nove categorias de ação (polling, data loading, análise, merge, chat, ferramentas, update, settings, startup) mostram feedback visual em tempo real com spinner animado, progresso com %, etapa do processamento, e widgets reutilizáveis (operation widget, inline pill, toasts, typing dots).', 'Sistema unificado de operações (showOp, updateOp, closeOp) com um mapa central rastreando tudo que está rodando, atualização de UI em tempo real, ETA quando disponível, cancelamento em operações longas e auto-dismiss após conclusão. Fim da confusão sobre se o app está travado.', 'Três padrões visuais reusáveis: operation widget (completo, com passo a passo) pra ações focadas; inline pill (compacto, discreto) pra background jobs; toasts (transientes, confirmação rápida) pra one-shot. Spinner com CSS animations (spin, bounce, fade), suave até em 3G, progress bar com transição suave de %.', '389 testes green cobrindo slow network, múltiplas operações simultâneas, erro e cancelamento.']],
  ['2.30.0', ['O Radar virou 3 sub-abas: Pra mim, Meus PRs e Panorama. A faixa de atalhos que existia antes rolava de lado em janela estreita e escondia metade dos destinos sem avisar. A busca de PR por URL foi pro Panorama.', 'A borda esquerda dos cards deixou de indicar a CONTA e passou a indicar URGÊNCIA: âmbar pro que espera você, vermelho pro que tem bloqueio, azul pro que está rodando, verde pro aprovável. A conta continua no ponto e na etiqueta. Como a opção Só barra ficaria sem nenhum marcador de conta, as opções de Identidade nos cards viraram Ponto + etiqueta e Só ponto (quem usava a antiga é migrado sozinho).', 'Os 4 botões do card da fila viraram 1 principal, o chat e um menu de três pontos. Ignorar é destrutivo e estava a um toque do Revisar; foi pro menu, junto do terminal. O menu abre dentro do card em vez de flutuar por cima.', 'O título do PR não é mais cortado com reticências: é a informação que faz você decidir se vai revisar.', 'Quando a fila está vazia, a tela passa a confirmar o que o Farol fez sozinho (quantos aprovou hoje, o que monitora, de quanto em quanto tempo) em vez de só dizer que não tem nada. E quando a conexão cai, o aviso aparece no meio da tela com o número da tentativa, não só numa etiqueta no topo que some de vista.', 'A paleta de comandos (Ctrl+K) passou a trazer as decisões pendentes, incluindo aprovar todas de uma vez, e ganhou um botão visível em janela estreita. Antes ela era montada uma vez só ao abrir o app, então as decisões nunca entravam.', 'O app foi ajustado pra janela estreita de verdade: em 380px nada fica abaixo de 11,5px, a ação principal ocupa a linha inteira, a barra de abas quebra em duas linhas e o chat vira uma folha que sobe de baixo.']],
  ['2.29.1', ['Versão de manutenção: nada muda na tela nem no comportamento. As funções de formatação e de escape da interface saíram do arquivo de 2.860 linhas onde moravam e ganharam arquivo próprio, com 45 testes. Era o maior arquivo do projeto e o único sem nenhum teste. Entre elas está a que neutraliza HTML antes de exibir, usada em cerca de 240 lugares do app e que nunca tinha sido verificada.']],
  ['2.29.0', ['Todas as telas passaram a explicar pra que servem: o refino de espaçamento que a v2.28.0 fez só na aba Sistema chegou nas outras cinco. Cada seção agora tem uma frase abaixo do título dizendo o que ela mostra, com a mesma largura de leitura em todo lugar. Eram três tratamentos diferentes pro mesmo tipo de texto, e o Radar não tinha nenhum apesar de ter seis seções.', 'O app ficou usável no celular. Entregas, Destaques e Time não tinham uma linha sequer de regra pra tela estreita: agora os controles de Entregas ocupam a faixa inteira, os cartões viram coluna, os botões dos cards de PR ganham largura em vez de sobrar meio botão fora da tela, e o título do PR quebra em duas linhas em vez de virar reticências.', 'O gráfico do Consumo virou legível no celular. Ele era desenhado sempre com 820px e depois encolhido pra caber, então os rótulos das datas ficavam com 4 pixels. Agora mede o espaço disponível e desenha no tamanho certo, mostrando menos datas quando o espaço é menor.', 'A barra de seções do Radar parou de descolar do topo: o deslocamento estava cravado em 54 pixels, mas a barra do topo muda de altura (encolhe no celular, cresce com mais de uma conta). Agora a altura é medida.', 'Acessibilidade: a página não tinha nenhum título de nível 1 e as abas eram só botões com uma classe, então quem usa leitor de tela não sabia quantas abas existem nem qual está aberta. As duas navegações agora se anunciam certo, os ícones pararam de ser lidos em voz alta, os botões só-ícone e os campos de busca ganharam nome, e os avisos (o toast de configuração salva, a faixa de aviso) passaram a ser anunciados.', 'Correções: o toast podia ficar mais largo que a tela no celular; os controles segmentados tinham estilo declarado duas vezes, com a primeira sendo código morto; uma regra de quebra de linha apontava pra uma classe inexistente enquanto os cards de PR, que precisavam dela, ficavam de fora.']],
  ['2.28.0', ['Novo controle de esforço de raciocínio em Sistema > Automação: cinco níveis (padrão do Claude, baixo, médio, alto e muito alto), cada um explicando o que muda e quanto custa do teu limite. Vale pras sessões autônomas (revisão, autoanálise, pushback, chat e ferramentas); a sessão no terminal não é afetada. O padrão continua deixando o Claude decidir pelo modelo, então quem não mexer não vê diferença. Com Haiku escolhido os cartões desabilitam, porque esse modelo não aceita nível de esforço.', 'O seletor de modelo das revisões foi de 4 pra 6 opções, com o trade-off no rótulo: além de Opus, Sonnet e Haiku, agora tem "Melhor disponível" (o Claude escolhe o topo da tua conta) e Fable (raciocínio longo). O config.json também passa a aceitar o nome completo de um modelo, sem precisar de versão nova do Farol.', 'A revisão em lotes de PR grande nunca tinha funcionado: desde a v2.26.0 o Farol media o PR, decidia fatiar em 2 a 4 lotes e montava o plano, mas o plano era descartado antes de chegar no Claude. Na prática um PR de 8700 linhas era lido parcialmente e aprovado. Agora o fan-out roda de verdade, com um subagente por lote em paralelo: a revisão de PR grande fica bem mais completa, e consome mais do teu limite.', 'A aba Sistema respira: cada configuração virou uma linha com o texto à esquerda, o controle à direita e uma divisória entre elas, no lugar do bloco corrido onde tudo ficava colado. A sidebar se separa do conteúdo por espaço em branco em vez de uma borda encostada, a aba ganhou mais largura, e cada seção tem um título maior com uma frase dizendo pra que serve. Versão e caminho dos dados foram pro rodapé da sidebar.', 'A busca do Sistema devolve uma lista de resultados nomeados, cada um com a seção de onde vem; clicar leva direto pra configuração e pisca a linha. Antes acendia várias seções ao mesmo tempo e empilhava tudo. Funciona sem acento e avisa quando não acha nada. As 9 seções também entraram na paleta de comandos (Ctrl+K).', 'Correções de acabamento: dez divisórias da tela de Sistema não estavam sendo desenhadas (cor usada sem nunca ter sido definida), o texto de ajuda dos campos ficava espremido ao lado em vez de abaixo, o botão "Reviewers" num PR sem configuração levava pra uma seção invisível, e o selo de assinatura do Claude aparecia como texto solto.', 'Modelo inválido no config.json agora é barrado no boot: esse campo entra na linha de comando que o Farol executa e só era validado quando salvo pela tela. A aba Consumo passa a mostrar a versão dos modelos da geração nova (Opus 5, Sonnet 5, Fable 5), que antes apareciam sem número. E a interface pergunta ao motor em qual sistema ele roda, em vez de adivinhar pelo navegador.']],
  ['2.27.0', ['A aba Sistema ganhou uma sidebar de navegação com 9 seções (Visão geral, Contas, Automação, Conexões, Plano e chaves, Reviewers, Preferências, Novidades e Diagnóstico), cada uma com seu grupo de configurações, no lugar da lista corrida anterior. Um campo de busca no topo da sidebar filtra por texto e mostra só as seções que contêm o termo. Em telas estreitas a sidebar vira uma faixa horizontal com os mesmos itens.', 'A assinatura do Claude que o Farol usa agora pode ser diferente por conta GitHub monitorada: crie perfis nomeados (ex.: "BIUD Trabalho", "Pessoal Max"), cada um apontando pro seu diretório de config próprio, e escolha um perfil padrão do Farol e, opcionalmente, um perfil específico por conta (Sistema > Contas). Cada conta e cada perfil mostram um selo com o e-mail logado ali (ou "SEM LOGIN" se faltar o claude login naquele diretório), e esse selo se atualiza sozinho ao salvar. Sem nenhum perfil criado, nada muda.', 'Cada perfil de assinatura Claude (e o padrão do Farol) ganha um botão "Abrir sessão de login": um terminal só com o claude, sem PR, fila ou token do GitHub envolvido.', 'Fechar a sessão de terminal sem terminar a revisão não faz mais o PR sumir da fila: fechar a sessão sempre devolve o PR à fila.', 'Pente-fino nos perfis de assinatura Claude: config.json malformado não derruba mais buscas de PR nem sessões de review; caminho de perfil com aspas ou quebra de linha não consegue mais executar comando nenhum; remover um perfil usado por 2+ contas ao mesmo tempo não deixa mais nenhuma "presa" a ele; migrar o campo antigo pra um perfil novo já marca esse perfil como padrão na hora.']],
  ['2.26.1', ['Atualizar no macOS voltou a funcionar: o pacote era gerado com barras invertidas (Windows) e o unzip do Mac recusava; corrigido, e a auditoria do pacote agora reprova se o defeito voltar. E aviso cosmético do unzip não derruba mais a atualização.']],
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
const REL_NOTES_BATCH = 5;
let relNotesShown = REL_NOTES_BATCH;
function renderReleaseNotes() {
  const box = $('#relNotes');
  if (!box) return;
  const cur = (STATE.app && STATE.app.version) || '';
  const total = RELEASE_NOTES.length;
  const shown = Math.min(relNotesShown, total);
  const resto = total - shown;
  box.innerHTML = RELEASE_NOTES.slice(0, shown).map(([v, items]) => `
    <div class="relnote">
      <div class="relnote-ver">v${esc(v)}${v === cur ? ' <span class="badge">atual</span>' : ''}</div>
      <ul class="dec-reasons">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
    </div>`).join('') + (resto > 0 ? `<button id="relNotesMore" class="btn sm">Ver mais ${Math.min(REL_NOTES_BATCH, resto)} versões (${resto} restantes)</button>` : '');
}
$('#relNotes').addEventListener('click', (e) => {
  if (e.target.closest('#relNotesMore')) { relNotesShown += REL_NOTES_BATCH; renderReleaseNotes(); }
});

/* ---------- Sistema > Sobre: privacidade, licença e créditos ---------- */
// Créditos vêm do snapshot (engine busca os contribuidores do repo do update no
// GitHub, cache de 24h): a lista se mantém sozinha quando entra colaborador novo.
// O link da licença aponta pro LICENSE do MESMO repo, então fork continua certo.
function renderAbout() {
  const box = $('#creditsBox');
  if (!box) return;
  // crédito de ORIGEM é fixo de propósito: a inspiração não está no git (o código
  // atual foi reconstruído do zero), então a lista sincronizada nunca a capturaria,
  // e história não muda, logo não há manutenção. Decisão do Wanderson, 15/08/2026.
  $('#aboutOrigem').innerHTML = `<span class="origem-label">Origem</span> O Farol nasceu de uma iniciativa do Thiago (${personMention('thiagopcdev', 'xs')}): um revisor de PRs que rodava numa janela de terminal e dependia de ação manual. O app atual foi reconstruído do zero em cima dessa essência.`;
  box.innerHTML = creditsHtml(STATE.credits);
  const repo = ((STATE.config && STATE.config.updateRepo) || '').trim();
  const link = $('#aboutLicenseLink');
  if (link && /^[^\s/]+\/[^\s/]+$/.test(repo)) link.href = `https://github.com/${repo}/blob/main/LICENSE`;
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
function reviewerLabel(rv) {
  const isTeam = rv.includes('/');
  const ent = isTeam && rv.split('/').slice(1).join('/').includes(':');
  if (ent) return { label: `${rv.split('/').pop()} (enterprise, não pedível)`, cls: 'bad', ent: true };
  if (isTeam) { const org = rv.split('/')[0]; const t = ((reviewerCands[org] || {}).teams || []).find(t => t.id === rv); return { label: (t ? t.name : rv.split('/').pop()) + ' (time)', cls: 'team' }; }
  return { label: rv, cls: '' };
}
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

/* Cartões de esforço: marca o que está salvo e explica o estado. Valor desconhecido
   (config antigo, ou nível que saiu da lista) cai no cartão do padrão, em vez de deixar
   nenhum marcado. */
function renderEffort(c) {
  const box = $('#setReviewEffort');
  if (!box) return;
  const eff = String(c.reviewEffort || '');
  const alvo = box.querySelector(`input[value="${CSS.escape(eff)}"]`) || box.querySelector('input[value=""]');
  if (alvo) alvo.checked = true;
  // o Haiku não aceita nível de esforço (ver effortForModel em lib/parse.js): desliga os
  // cartões e explica, em vez de deixar escolher algo que o engine vai descartar
  const semEsforco = String(c.reviewModel || '') === 'haiku';
  box.classList.toggle('disabled', semEsforco);
  $('#effortHint').textContent = semEsforco
    ? 'O Haiku não aceita nível de esforço, então o Farol não passa a flag enquanto ele estiver escolhido.'
    : 'Quanto o Claude pensa antes de responder nas sessões autônomas. Mais esforço acha mais coisa e gasta mais do teu limite. A sessão no terminal não é afetada.';
}

function renderSettings() {
  renderReleaseNotes();
  renderAbout();
  const c = STATE.config;
  const setIf = (el, val) => { if (document.activeElement !== el) el.value = val; };
  setIf($('#setUser'), c.ghUser);
  setIf($('#setOwners'), (c.owners || []).join(', '));
  setIf($('#setMergeBlocked'), (c.mergeBlockedRepos || []).join(', '));
  renderReviewersEditor();
  renderClaudeProfiles();
  $('#setInterval').value = String(c.intervalSeconds);
  $('#setReviewModel').value = (c.reviewModel != null ? c.reviewModel : '');
  $('#setParallelReviews').value = String(c.parallelReviews || 1);
  renderEffort(c);
  $('#setAutoReview').checked = !!c.autoReview;
  $('#setAutoApproveAll').checked = c.autoApproveAll !== false;
  $('#setAutoApproveContested').checked = c.autoApproveContested === true;
  $('#setReviewFast').checked = c.reviewFast === true;
  $('#setReReviewResume').checked = c.reReviewResume === true;
  $('#setAutoPushback').checked = !!c.autoPushback;
  $('#setAutoUpdate').checked = c.autoUpdate !== false;
  $('#setDebugSpawns').checked = !!c.debugSpawns;
  $('#setSkipPerms').checked = !!c.skipPermissions;
  $('#setSound').checked = !!c.soundEnabled;
  $('#setAutostart').checked = !!c.autostart;
  // autostart: só no Windows (no macOS o login item abriria o Electron sem os args do app,
  // ver applyAutostart em main.js). A plataforma vem do engine, não do userAgent.
  // autostart só existe de verdade no Windows (setLoginItemSettings é no-op no
  // Linux e desabilitado por decisão no mac); mostrar a opção seria mentira
  $('#rowAutostart').style.display = isElectron && ehWin() ? '' : 'none';
}

/* ---------- ferramentas internas (kudos/diagnostico) ---------- */
let lastKudosOutput = '';
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
    : `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3l1.9 4.6 4.9.4-3.7 3.2 1.1 4.8L12 13.5 7.8 16l1.1-4.8L5.2 8l4.9-.4L12 3z" fill="currentColor"/></svg> Gerar kudos${scopeName ? ' de ' + esc(scopeName) : ''}`;
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
  // era o último confirm() nativo do app (o do update saiu na mesma leva)
  const ok = await confirmModal({
    danger: true,
    title: 'Zerar o log de falhas?',
    body: '<p>Use quando os pontos levantados já foram tratados: o próximo diagnóstico parte do zero, sem o histórico atual.</p>',
    confirmLabel: 'Zerar log'
  });
  if (!ok) return;
  const r = await api('/api/log/clear');
  if (!r?.ok) { toast('error', esc(r?.error || 'não consegui limpar o log')); return; }
  toast('ok', 'Log de falhas zerado.', 3000);
  loadLog();
};

async function loadLog() {
  const [lines, grupos] = await Promise.all([get('/api/log'), get('/api/log/triage')]);
  const linhas = lines || [];
  $('#logBox').textContent = linhas.length ? linhas.join('\n') : 'Nenhuma falha registrada. Bom sinal.';
  // resumo agrupado ANTES do despejo: contagem crua não distingue "1 problema repetido
  // 70 vezes" de "70 problemas". Fica num parágrafo próprio de propósito, e não dentro
  // da .section-head: aquela linha é flex e quebra cedo (ver CLAUDE.md/CSS da aba).
  const resumo = $('#logResumo');
  const texto = logSummaryShort(grupos || [], 3);
  resumo.textContent = texto;
  resumo.hidden = !texto;
  const box = $('#logBox');
  box.scrollTop = box.scrollHeight;
}

/* ---------- exportar diagnóstico (pra reparar, ex.: no macOS) ---------- */
// Junta ambiente + contas + config + estado + log num texto SEM segredo (nada de
// token/senha), pra a pessoa copiar e mandar pra quem mantém o Farol.
// quantas linhas cruas do log entram no relatório: o texto é copiado e colado, e depois
// do resumo agrupado o despejo inteiro (159 linhas no caso real) só custava tamanho.
const DIAG_LOG_TAIL = 40;

async function buildDiagnostics() {
  const s = STATE || {};
  const [logRaw, gruposRaw] = await Promise.all([get('/api/log'), get('/api/log/triage')]);
  const log = logRaw || [];
  const grupos = gruposRaw || [];
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
    ...((d.claudeAuth || []).map(p =>
      `  assinatura Claude${p.label ? ' [' + p.label + ']' : ''}: ${(p.configDir ? 'dir próprio (' + p.configDir + ')' : 'padrão da máquina') + (p.account ? ' · conta ' + p.account : '') + (p.ready === false ? ' · SEM LOGIN (rode: claude login nesse dir)' : '')}`
    )),
    `  git bash: ${d.gitBash || '(n/a)'}`,
    `  conta primária autenticada no gh: ${d.ghAuth ? 'sim' : 'NAO'}`,
    `  workspace: ${d.workspace || s.paths?.workspace || '?'}`,
    `  home: ${s.paths?.home || '?'}`,
    '',
    `Contas (${(s.accounts || []).length}):`,
    accts || '  (nenhuma)',
    '',
    'Config:',
    `  intervalo: ${c.intervalSeconds}s · autoReview: ${!!c.autoReview} · autoApproveAll: ${c.autoApproveAll !== false} · autoApproveContested: ${c.autoApproveContested === true} · skipPermissions: ${!!c.skipPermissions}`,
    `  autostart: ${!!c.autostart} · som: ${!!c.soundEnabled} · tema: ${c.theme || '-'}`,
    `  updateRepo: ${c.updateRepo || '-'} · updateSource: ${c.updateSource || '(release)'}`,
    `  mergeBlockedRepos: ${(c.mergeBlockedRepos || []).join(', ') || '-'}`,
    '',
    'Estado agora:',
    `  fila: ${(s.queue || []).length} · panorama: ${(s.panorama || []).length} · meus PRs: ${(s.myPRs || []).length} · decisões pendentes: ${(s.decisions?.pending || []).length} · sessões ativas: ${(s.activeSessions || []).length}`,
    `  atualização: ${u ? `v${u.current} · ${u.available ? 'v' + u.sourceVersion + ' DISPONÍVEL' : 'na mais recente'} (${u.channel}${u.repo ? ' ' + u.repo : ''})${u.note ? ' · ' + u.note : ''}` : '?'}`,
    '',
    // evento = linha com timestamp; o total de LINHAS é maior porque mensagem de erro
    // multilinha (gh, cmd.exe) ocupa mais de uma. Dizer só "159 linhas" e depois "146
    // eventos" na linha de leitura confundia, então o cabeçalho traz os dois.
    `Log de falhas (${grupos.reduce((n, g) => n + g.count, 0)} evento(s) em ${grupos.length} grupo(s), ${log.length} linha(s)):`,
    // resumo primeiro, detalhe depois: quem lê o relatório precisa saber QUANTOS
    // episódios distintos existem antes de encarar linha crua.
    ...(grupos.length ? ['  Resumo:', ...logSummaryLines(grupos).map(l => '    ' + l), ''] : []),
    ...(log.length
      ? [`  Detalhe (as ${Math.min(log.length, DIAG_LOG_TAIL)} linhas mais recentes):`, ...logTailLines(log, DIAG_LOG_TAIL)]
      : ['  (sem falhas registradas)']),
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
  // revisa só o que está visível no escopo atual; a lista vai SEMPRE explícita
  // (mandar {} fazia o servidor revisar a fila INTEIRA, achado B22)
  const urls = (STATE.queue || []).filter(scopeVisible).map(p => p.url);
  if (!urls.length) { toast('info', 'Nada visível pra revisar agora (a fila mudou embaixo do botão).'); return; }
  api('/api/review', { urls });
};

/* tweaks de exibição (guardados no navegador, não vão pro engine) */
function initTweaks() {
  const mh = $('#setMutedHandling'), is = $('#setIdentityStyle');
  if (mh) { mh.value = TWEAK.muted; mh.onchange = () => { TWEAK.muted = mh.value; localStorage.setItem('farol-muted-handling', mh.value); rerenderScope(); }; }
  if (is) { is.value = TWEAK.ident; is.onchange = () => { TWEAK.ident = is.value; localStorage.setItem('farol-identity-style', is.value); rerenderScope(); }; }
}
initTweaks();
$('#btnKudos').onclick = async () => {
  const btn = $('#btnKudos');
  const opId = 'tool-kudos';
  showOp(opId, { type: 'tool', title: 'Gerando kudos', inline: true, container: btn.parentElement });
  const r = await api('/api/tool', { name: 'kudos', scope: kudosScopeKey() });
  if (r?.ok) closeOp(opId, 'done', 'Kudos gerado');
  else { closeOp(opId, 'error', r?.error || 'não consegui gerar'); toast('info', esc(r?.error || 'não consegui gerar')); }
};
$('#btnHealth').onclick = async () => {
  const btn = $('#btnHealth');
  const opId = 'tool-health';
  showOp(opId, { type: 'tool', title: 'Diagnosticando', inline: true, container: btn.parentElement });
  const r = await api('/api/tool', { name: 'health' });
  if (r?.ok) closeOp(opId, 'done', 'Diagnóstico completo');
  else closeOp(opId, 'error', r?.error || 'falha no diagnóstico');
};
$('#btnDoctor').onclick = async () => { await get('/api/doctor'); };
$('#btnUpdateCheck').onclick = async () => {
  const btn = $('#btnUpdateCheck');
  const opId = 'sys-update-check';
  btn.disabled = true;
  btn.textContent = '↑ Verificando…';
  showOp(opId, { type: 'update', title: 'Verificando atualizações', inline: true, container: $('#updateBox') || document.body });
  await get('/api/doctor');
  closeOp(opId, 'done', 'Verificação concluída');
  setTimeout(() => { btn.disabled = false; btn.textContent = '↑ Verificar agora'; }, 1000);
  toast('ok', 'Verificação de atualização feita.', 2500);
};
$('#btnLogRefresh').onclick = loadLog;

$('#panorama').addEventListener('click', async (e) => {
  const btn = e.target.closest('.pano-review');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Revisando…';
    api('/api/review', { urls: [btn.dataset.url] });
    return;
  }
  // .act-chat é ouvido globalmente (document); só o copiar precisa de listener aqui,
  // mesmo padrão de "cada seção escuta o seu" usado em Revisões recentes (#resolved).
  const cp = e.target.closest('.rr-copy');
  if (cp) {
    const ok = await copyToClipboard(cp.dataset.url || cp.dataset.key || '');
    toast(ok ? 'ok' : 'error', ok ? 'URL do PR copiada.' : 'Não consegui copiar (permissão do navegador).', 2500);
  }
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
  const r = await decide(id, action);
  if (!r?.ok) btn.disabled = false;
});

/* configurações: aplica na mudança */
const settingsMap = [
  ['#setUser', 'ghUser', el => el.value],
  ['#setOwners', 'owners', el => el.value],
  ['#setMergeBlocked', 'mergeBlockedRepos', el => el.value],
  ['#setInterval', 'intervalSeconds', el => parseInt(el.value, 10)],
  ['#setReviewModel', 'reviewModel', el => el.value],
  ['#setParallelReviews', 'parallelReviews', el => parseInt(el.value, 10)],
  // radio: o change borbulha até o container, então e.target já é o rádio marcado
  ['#setReviewEffort', 'reviewEffort', el => el.value],
  ['#setAutoPushback', 'autoPushback', el => el.checked],
  ['#setAutoUpdate', 'autoUpdate', el => el.checked],
  ['#setDebugSpawns', 'debugSpawns', el => el.checked],
  ['#setAutoReview', 'autoReview', el => el.checked],
  ['#setAutoApproveAll', 'autoApproveAll', el => el.checked],
  ['#setAutoApproveContested', 'autoApproveContested', el => el.checked],
  ['#setReviewFast', 'reviewFast', el => el.checked],
  ['#setReReviewResume', 'reReviewResume', el => el.checked],
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
let TENTATIVAS_RECONEXAO = 0;

function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('state', (e) => {
    const d = safeJsonParse(e.data); if (!d) return; STATE = d;
    aplicaPlataforma(STATE.app && STATE.app.platform);   // engine manda; o userAgent era só o palpite inicial
    rebuildAccounts();
    renderStatus(); renderAccountBar(); renderIdentity();
    renderActive(); renderDecisions(); renderQueue(); renderMyPRs(); renderPanorama(); renderSilenced();
    renderRadarNav();
    syncAnalysisOps();
    renderSettings(); renderTools(); renderUpdate(); tickCountdown();
    if ($('#tab-sistema').classList.contains('active')) { renderDoctor(); renderAccountsManager(); renderClaudeProfiles(); }
    if ($('#tab-consumo').classList.contains('active')) renderUsage();
  });
  es.addEventListener('activity', (e) => {
    const d = safeJsonParse(e.data); if (!d) return; const { id, item } = d;
    if (STATE?.activity) (STATE.activity[id] = STATE.activity[id] || []).push(item);
    const feed = document.querySelector(`.activity-feed[data-id="${CSS.escape(id)}"]`);
    if (feed) {
      const stick = feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 30;
      feed.insertAdjacentHTML('beforeend', feedLine(item));
      if (stick) feed.scrollTop = feed.scrollHeight;
    }
    // progresso honesto (régua única sessionProgress, ui/pure.js): a atividade
    // real move a barra do card da sessão no "Analisando agora"...
    updateSessionBar(id);
    // ...e, se for autoanálise, também o widget do card em Meus PRs
    const selfKey = selfSessionKey(STATE?.activeSessions, id);
    if (selfKey) {
      const op = ACTIVE_OPS.get(`analysis-${selfKey}`);
      if (op && op.status === 'running') {
        const n = (STATE?.activity?.[id] || []).length;
        updateOp(op.id, {
          step: (item && item.text) || op.step,
          progress: Math.max(op.progress || 0, sessionProgress(n))
        });
      }
    }
  });
  es.addEventListener('chat', (e) => {
    const c = safeJsonParse(e.data); if (!c) return;
    if (chatKey && c.key === chatKey) renderChat(c);
  });
  es.addEventListener('chat-activity', (e) => {
    const d = safeJsonParse(e.data); if (!d) return; const { key, text } = d;
    if (chatKey && key === chatKey) {
      const el = $('#chatActivity');
      el.hidden = false;
      const opId = `chat-${key}`;
      // o texto vivo vira o step da MESMA pill que o renderChat cria; escrever
      // textContent no container destruia a pill e orfanava a op (B16). Se a
      // atividade chegar antes do primeiro snapshot de chat, cria a op aqui.
      if (!ACTIVE_OPS.has(opId)) showOp(opId, { type: 'chat', title: 'Claude respondendo', inline: true, container: el });
      // o chat nao acumula feed em STATE.activity; a contagem de eventos vive
      // na propria op, e o percentual sai da MESMA regua dos outros fluxos
      const op = ACTIVE_OPS.get(opId);
      const n = (op.chatEvents = (op.chatEvents || 0) + 1);
      updateOp(opId, { step: text, progress: Math.max(op.progress || 0, sessionProgress(n)) });
    }
  });
  es.addEventListener('toast', (e) => {
    const t = safeJsonParse(e.data); if (!t) return;
    toast(t.kind || 'info', esc(t.text));
  });
  es.addEventListener('new-prs', (e) => { const d = safeJsonParse(e.data); if (d) notifyNewPRs(d); });
  es.addEventListener('auto-approved', () => ping());
  es.addEventListener('auto-rejected', () => ping());
  es.addEventListener('needs-decision', (e) => {
    ping();
    const d = safeJsonParse(e.data); if (!d) return; const { pr, item } = d;
    if (!isElectron && 'Notification' in window && Notification.permission === 'granted') {
      const n = new Notification('Farol · precisa da sua atenção', { body: `${pr.key}: ${(item.reasons || [])[0] || 'ver relatório'}` });
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
connect();
