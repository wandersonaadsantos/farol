'use strict';
/* Funcoes PURAS da UI: so dependem dos argumentos. Nao tocam DOM, nao leem STATE nem
   nenhuma global mutavel, e por isso sao as unicas do front que da pra testar com
   `node --test`. Sairam do ui/app.js, que tem ~2700 linhas e nunca teve teste nenhum
   (e a Onda 4 do docs/QUALITY.md).

   Carregado das duas pontas, sem build step: o navegador le por <script src> antes do
   app.js (as funcoes ficam no escopo global, exatamente como estavam), e o node le pelo
   rodape CommonJS la embaixo. `typeof module` no navegador e 'undefined' e nao lanca.

   REGRA: so entra aqui o que for puro. Funcao que precise de STATE, SCOPE ou document
   fica no app.js; se quiser trazer, passe o que ela le como parametro primeiro. */

/* ---------- folhas: sem dependencia nenhuma ---------- */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtClock(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtTok(n) { return Number(n || 0).toLocaleString('pt-BR'); }

function fmtCompact(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(Math.round(n));
}

// tira acento pra "revisao" achar "Revisão"
function sysNorm(s) { return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase(); }

/* ---- atribuição de conta pra memória (Destaques/Time) ---- */
function ownerFromUrl(url) { const m = String(url || '').match(/github\.com\/([^\/]+)\//i); return m ? m[1] : ''; }

function repoShort(repo) { return repo.split('/').slice(1).join('/') || repo; }

function stripFence(s) {
  return String(s || '').trim().replace(/^```[a-z]*\s*\r?\n/i, '').replace(/\r?\n```\s*$/, '').trim();
}

function hexToRgba(hex, a) {
  const m = String(hex || '').replace('#', '');
  if (m.length !== 6) return `rgba(255,180,84,${a})`;
  const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

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

// maior mergedAt de uma lista (ISO ordena lexicograficamente)
function lastMerge(list) { return (list.map(x => x.mergedAt || '').sort().slice(-1)[0]) || ''; }

function groupBy(items, keyFn) {
  const m = new Map();
  for (const it of items) { const k = keyFn(it); (m.get(k) || m.set(k, []).get(k)).push(it); }
  return m;
}

function usageMetricVal(b, m) {
  b = b || {};
  if (m === 'input') return b.inputTokens || 0;
  if (m === 'output') return b.outputTokens || 0;
  if (m === 'cache') return (b.cacheReadTokens || 0) + (b.cacheCreationTokens || 0);
  return (b.inputTokens || 0) + (b.outputTokens || 0); // total
}

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

function delivGroupCard(head, count, bodyHtml) {
  return `<div class="card deliv-card">
    <details>
      <summary class="deliv-sum">${head}<span class="count">${count}</span></summary>
      ${bodyHtml}
    </details>
  </div>`;
}

/* ---------- folhas com relogio: a hora entra por parametro, com default, pra dar pra testar ---------- */

// `agora` entra por parametro (com default) so pra dar pra testar: todos os chamadores
// passam 1 argumento so, entao nada muda pra eles.
function fmtRel(iso, agora = Date.now()) {
  if (!iso) return '';
  const s = Math.max(0, (agora - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'agora';
  if (s < 3600) return `${Math.round(s / 60)}min`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

// chaves de dia (UTC, batendo com o server) dos últimos n dias, incluindo hoje
function usageDayKeysBack(n, agora = Date.now()) {
  const out = [], d = new Date(agora); d.setUTCHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getTime()); x.setUTCDate(d.getUTCDate() - i); out.push(x.toISOString().slice(0, 10)); }
  return out;
}

/* ---------- dependem das folhas ---------- */

function avatar(login, cls = '') {
  const initial = (login || '?').charAt(0).toUpperCase();
  return `<span class="avatar ${cls}">${esc(initial)}<img src="https://github.com/${encodeURIComponent(login)}.png?size=96" alt="" loading="lazy" onerror="this.remove()"></span>`;
}

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

function feedLine(it) {
  const icon = { tool: '⚙', text: '💬', warn: '⚠', info: '·' }[it.k] || '·';
  return `<div class="feed-line k-${esc(it.k)}"><span class="feed-t">${fmtClock(it.t)}</span><span class="feed-i">${icon}</span><span class="feed-x">${esc(it.text)}</span></div>`;
}

function delivPrRow(it) {
  return `<div class="row">
    <span class="ref"><a href="${esc(it.url)}" target="_blank" rel="noreferrer">${esc(it.key)}</a></span>
    <span class="title" title="${esc(it.title)}">${esc(it.title)}</span>
    <span class="who">@${esc(it.author)}</span>
    <span class="when">${fmtRel(it.mergedAt)}</span>
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

/* ---------- montagem da aba Entregas (agrupa, ordena e formata) ---------- */

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

/* Rodape CommonJS: so o node entra aqui. No navegador estas funcoes ja estao no
   escopo global por terem sido declaradas no topo deste arquivo. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    esc, fmtClock, fmtTok, fmtCompact, sysNorm, ownerFromUrl, repoShort, stripFence, hexToRgba,
    sameSet, diffVs, lastMerge, groupBy, usageMetricVal, accountSaveArray, delivGroupCard, fmtRel,
    usageDayKeysBack, avatar, md, feedLine, delivPrRow, delivPrRowInRepo, delivRepoSubgroups,
    deliveriesByRepo, deliveriesByAuthor
  };
}
