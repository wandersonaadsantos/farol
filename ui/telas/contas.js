/* Farol · UI: camada de identidade de conta (de quem é cada PR, o que o escopo esconde,
   como a conta é marcada) e o que depende dela: a barra de contas, a faixa de identidade
   e o resumo de silenciadas. O re-render por troca de escopo (rerenderScope) morou aqui
   até a Task 8, que o levou pro ui/app.js: com o Radar e Meus PRs virando módulo, ele
   passou a chamar mais telas do que esta camada de identidade pode conhecer sem ciclo. */

import { esc, hexToRgba, ownerFromUrl, validScope, personMention, fmtRel, accountBarVisible } from '../pure.js';
import { estado, escopo, abaAtual, definirEscopo } from './estado.js';
import { $, selo } from './infra.js';

function identGuardada() {
  const v = localStorage.getItem('farol-identity-style');
  if (v === 'Só ponto') return v;
  return 'Ponto + etiqueta';   // cobre o default, 'Barra + etiqueta' e o antigo 'Só barra'
}
export const TWEAK = {
  muted: localStorage.getItem('farol-muted-handling') || 'Recolher',   // Recolher | Esmaecer | Ocultar
  // 'Só barra' saiu quando a borda esquerda virou urgência: quem tinha essa opção ficaria
  // sem NENHUM marcador de conta. Migra pro equivalente mais informativo.
  ident: identGuardada(), // Ponto + etiqueta | Só ponto
};
export let ACCT = {};        // user(lower) -> metadados da conta
export let OWNER2USER = {};  // owner/org(lower) -> user dono
export function rebuildAccounts() {
  ACCT = {}; OWNER2USER = {};
  const list = (estado() && estado().accounts) || [];
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
    const v = validScope(escopo(), list.map(a => a.user));
    if (v !== escopo()) { definirEscopo(v); localStorage.setItem('farol-scope', escopo()); }
  }
}
export function multiAccount() { return ((estado() && estado().accounts) || []).length > 1; }
export function prUser(pr) {
  if (pr && pr.account) return pr.account;
  const repo = (pr && (pr.repo || (pr.key || '').split('#')[0])) || '';
  const owner = repo.split('/')[0].toLowerCase();
  return OWNER2USER[owner] || '';
}
export function acctOf(pr) { return ACCT[String(prUser(pr)).toLowerCase()] || null; }
export function isMutedPr(pr) { const a = acctOf(pr); return !!(a && a.muted); }
// item visível no escopo atual (respeitando o tratamento de silenciadas)
export function scopeVisible(pr) {
  if (escopo() === 'all') { if (isMutedPr(pr)) return TWEAK.muted === 'Esmaecer'; return true; }
  return String(prUser(pr)).toLowerCase() === String(escopo()).toLowerCase();
}
export function dimmedPr(pr) { return escopo() === 'all' && isMutedPr(pr) && TWEAK.muted === 'Esmaecer'; }
// marcador de conta pra um card: estilo (var --ac + barra + esmaecido), chip e ponto
export function acctMark(pr, opts) {
  opts = opts || {};
  const a = acctOf(pr);
  const all = escopo() === 'all';
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
export function acctUserFromUrl(url) { return OWNER2USER[ownerFromUrl(url).toLowerCase()] || ''; }
// entrada de memória sem conta (dados antigos) só aparece na visão Todas (grupo "Geral")
export function scopeMemVisible(user) {
  if (!user) return escopo() === 'all';
  if (escopo() === 'all') { const a = ACCT[user.toLowerCase()]; if (a && a.muted) return TWEAK.muted === 'Esmaecer'; return true; }
  return String(user).toLowerCase() === String(escopo()).toLowerCase();
}
export function acctStyleFor(user) { const a = ACCT[String(user || '').toLowerCase()]; return a ? `--ac:${a.color};--ac-soft:${a.soft};` : '--ac:var(--muted);'; }
export function memGroupHead(user) {
  const a = ACCT[String(user || '').toLowerCase()];
  const label = a ? (a.label || a.user) : 'Geral';
  const color = a ? a.color : 'var(--muted)';
  const sub = a ? (a.org || '') : 'sem conta atribuída';
  return `<div class="group-head" style="--ac:${color}"><span class="g-dot"></span>${esc(label)}${sub ? `<span class="g-sub">· ${esc(sub)}</span>` : ''}</div>`;
}

// PRs que pedem sua atenção numa conta (fila + decisões pendentes)
export function attentionCount(user) {
  const u = String(user).toLowerCase();
  const q = (estado().queue || []).filter(p => String(prUser(p)).toLowerCase() === u).length;
  const d = (estado().decisions?.pending || []).filter(p => String(prUser(p)).toLowerCase() === u).length;
  return q + d;
}

/* ---------- render: barra de contas ---------- */
export function renderAccountBar() {
  const bar = $('#accountBar');
  const accounts = (estado().accounts || []);
  // a allowlist de abas mora no pure.js (accountBarVisible): so Radar, Destaques
  // e Time respeitam escopo(); Entregas filtra por org propria e Sistema/Consumo
  // sao visoes do Farol como app, nao de uma conta.
  if (!accountBarVisible(accounts.length, abaAtual())) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  const all = escopo() === 'all';
  // o contador (PRs precisando de você) é conceito do Radar; nas outras abas some
  const showCounts = abaAtual() === 'radar';
  const totalAtt = accounts.filter(a => !a.muted).reduce((n, a) => n + attentionCount(a.user), 0);
  const segAll = `<button class="acct-seg ${all ? 'active' : ''}" data-scope="all" title="Ver todas as contas"
      style="${all ? '--seg-bg:var(--surface-2);--seg-fg:var(--text);--seg-badge-bg:var(--accent-soft);--seg-badge-fg:var(--accent);' : ''}">Todas${showCounts && totalAtt ? `<span class="seg-count">${totalAtt}</span>` : ''}</button>`;
  const segs = accounts.map(a => {
    const meta = ACCT[a.user.toLowerCase()] || {};
    const active = String(escopo()).toLowerCase() === a.user.toLowerCase();
    const att = a.muted ? 0 : attentionCount(a.user);
    const style = `--ac:${meta.color};` + (active ? `--seg-bg:${meta.soft};--seg-fg:${meta.color};--seg-badge-bg:${meta.color};--seg-badge-fg:${meta.ink};` : '');
    return `<button class="acct-seg ${active ? 'active' : ''} ${a.muted ? 'muted' : ''}" data-scope="${esc(a.user)}"
        title="@${esc(a.user)}${meta.org ? ' · ' + esc(meta.org) : ''}${a.muted ? ' (silenciada)' : ''}" style="${style}">
        <span class="seg-dot"></span>${esc(meta.label || a.user)}${selo(a, showCounts, att)}</button>`;
  }).join('');
  bar.innerHTML = segAll + segs;
}

/* ---------- render: faixa de identidade ---------- */
export function renderIdentity() {
  const strip = $('#identityStrip');
  const accounts = (estado().accounts || []);
  if (accounts.length < 2) { strip.hidden = true; strip.removeAttribute('style'); return; }
  strip.hidden = false;
  if (escopo() === 'all') {
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
    const a = accounts.find(x => x.user.toLowerCase() === String(escopo()).toLowerCase());
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
// aberto/fechado do resumo de silenciadas: estado só da tela (não persiste), lido aqui e
// escrito pelo app.js (troca de escopo fecha; o botão "ver"/"ocultar" alterna).
let silencedOpen = false;
export function fecharSilenciadas() { silencedOpen = false; }
export function alternarSilenciadas() { silencedOpen = !silencedOpen; }
export function renderSilenced() {
  const box = $('#silenced');
  const accounts = (estado().accounts || []);
  const mutedAccts = accounts.filter(a => a.muted);
  const items = (estado().panorama || []).filter(pr => isMutedPr(pr));
  const show = escopo() === 'all' && TWEAK.muted === 'Recolher' && mutedAccts.length > 0 && items.length > 0;
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

/* ---------- gatilhos da barra de contas e do resumo de silenciadas ----------
   Trocam o escopo e reagem ao clique de expandir/recolher. rerenderScope
   conhece TODAS as telas e por isso fica no bootstrap (ui/app.js): recebido
   por parâmetro, na mesma injeção de initTweaks(rerenderScope). Chamada pelo
   bootstrap no mesmo ponto relativo em que os dois listeners moravam. Este
   módulo continua sem importar nenhuma tela. */
export function initContasTriggers(rerenderScope) {
  /* trocar de conta na barra */
  $('#accountBar').addEventListener('click', (e) => {
    const seg = e.target.closest('.acct-seg');
    if (!seg) return;
    definirEscopo(seg.dataset.scope);
    localStorage.setItem('farol-scope', escopo());
    fecharSilenciadas();
    rerenderScope();
  });
  /* abrir/fechar o resumo de silenciadas */
  $('#silenced').addEventListener('click', (e) => {
    if (e.target.closest('.sil-toggle')) { alternarSilenciadas(); renderSilenced(); }
  });
}
