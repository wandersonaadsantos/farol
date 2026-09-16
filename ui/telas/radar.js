/* Farol · UI: a aba Radar (fila, decisões pendentes, pushback e panorama). Não é uma
   aba registrável (é a aba padrão, e hoje não reage a entrar de aba nem a chegar
   estado): renderDecisions, renderQueue, renderPanorama e renderRadarNav são
   chamadas pelo connect() do app.js a cada snapshot do SSE, na mesma ordem de
   sempre. */

import {
  esc, fmtStamp, fmtWhenDay, personMention, papelPicker, reasonGroupsHtml, chatBadge, md,
  resolvedRow, listViewState, queueEmptyOkHtml, aprovadosHoje, orgsMonitoradas,
  automacaoPausadaPor, queueCardHtml, panoramaRowHtml, staleCardMeta,
} from '../pure.js';
import { estado, escopo, peopleOf } from './estado.js';
import { $, api, textoDaListaVazia } from './infra.js';
import { scopeVisible, acctMark } from './contas.js';

// mini-navegação do Radar: só lista seções visíveis (hidden=false), com contagem
// quando o número ajuda a decidir pra onde ir. Espelha o estado real do DOM em
// vez do estado cru, então some/aparece junto com a própria seção.
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

$('#radarSubs').addEventListener('click', (e) => {
  const b = e.target.closest('.rsub');
  if (b) switchRadarSub(b.dataset.sub);
});

/* ---------- render: decisoes pendentes ---------- */
function renderDecisions() {
  // guarda de foco: não reconstrói os cards enquanto você mexe no seletor de papel
  // (ou em outro input) de um card; ainda assim atualiza Revisões recentes
  const dbox = $('#decisions');
  if (document.activeElement && dbox.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) { renderResolved(); return; }
  const pending = (estado().decisions?.pending || []).filter(scopeVisible);
  // uma leitura só pra toda a renderização: os cards desta passada têm que
  // enxergar o MESMO mapa de pessoas, senão um SSE no meio do map faria dois
  // cards da mesma tela discordarem sobre o papel de alguém
  const people = peopleOf();
  const wrap = $('#decisionsWrap');
  wrap.hidden = pending.length === 0;
  $('#decisionsCount').textContent = pending.length;
  if (!pending.length) { $('#decisions').innerHTML = ''; renderResolved(); return; }
  $('#decisions').innerHTML = pending.map(d => {
    const m = acctMark(d);
    const author = (d.pr && d.pr.author) || d.author || '';
    // card de commit novo (v2.59.3): barra, veredito, motivos, aviso e botões saem daqui
    const meta = staleCardMeta(d, (estado().reRounds || {})[d.key]);
    return `
    <div class="card decision ${meta.cardClass}" data-id="${esc(d.id)}" data-url="${esc(d.pr?.url || '')}" style="${m.style}">
      <div class="decision-head">
        ${meta.verdictHtml}
        <a class="dec-ref" href="${esc(d.pr?.url || '#')}" target="_blank" rel="noreferrer">${esc(d.key)}</a>
        ${m.chip}
        ${d.card ? `<span class="pill">${esc(d.card)}</span>` : '<span class="pill">sem card</span>'}
        <span class="dec-when" title="${esc(fmtStamp(d.createdAt))}">${esc(fmtWhenDay(d.createdAt))}</span>
      </div>
      ${d.pr?.title ? `<div class="dec-title">${esc(d.pr.title)}</div>` : ''}
      ${author ? `<div class="dec-author">PR de ${personMention(author, 'xs')} ${papelPicker(author, people)}</div>` : ''}
      ${meta.reasons.length ? reasonGroupsHtml(meta.reasons, d.postRetry) : ''}
      ${meta.statusHtml}
      <details class="dec-report"><summary>Ver relatório completo</summary><div class="report">${md(d.reportMarkdown)}</div></details>
      <div class="dec-actions">
        ${(meta.reviewBtn === 'primary' || meta.reviewBtn === 'secondary') && d.pr?.url
          ? `<button class="btn${meta.reviewBtn === 'primary' ? ' primary' : ''} sm act-review" data-url="${esc(d.pr.url)}" title="Revisa de novo agora, no commit atual do PR">Revisar agora</button>`
          : ''}
        ${meta.stale ? '' : `<button class="btn primary sm dec-act" data-action="approve">Aprovar</button>
        <button class="btn sm dec-act dec-rc" data-action="request_changes">Pedir mudanças</button>
        <button class="btn sm dec-act" data-action="comment">Só comentar</button>`}
        <button class="btn sm act-chat" data-key="${esc(d.key)}" data-url="${esc(d.pr?.url || '')}">💬 Conversar${chatBadge(d.key, estado()?.chats)}</button>
        <button class="btn sm ghost dec-act" data-action="skip">Pular</button>
      </div>
    </div>`;
  }).join('');
  renderResolved();
}

/* ---------- pushback: PB_OPTS/PB_SHORT/pushbackControl moraram aqui e foram pro
   ui/pure.js (testáveis); o submit e os listeners seguem aqui por tocarem DOM/estado ---------- */
function submitPushback(el) {
  const box = el.closest('.pushback'); if (!box) return;
  const sel = box.querySelector('.pb-outcome'), note = box.querySelector('.pb-note');
  const key = sel.dataset.key, author = sel.dataset.author, outcome = sel.value;
  const noteVal = outcome ? (note.value || '').trim() : '';
  const map = { ...(estado().pushbacks || {}) };   // otimista, pra o controle não piscar
  if (outcome) map[key] = { author: String(author).toLowerCase(), outcome, note: noteVal, at: Date.now(), source: 'manual', status: 'confirmed' };
  else delete map[key];
  estado().pushbacks = map;
  api('/api/pushback', { key, author, outcome, note: noteVal });
  renderResolved();   // reflete na hora (a guarda de foco segura o caso do change no select/nota)
}

function renderResolved() {
  const box0 = $('#resolved');
  // guarda de foco: não re-renderiza enquanto você digita a nota / escolhe o desfecho
  if (document.activeElement && box0.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  const resolved = (estado().decisions?.resolved || []).filter(scopeVisible);
  const wrap = $('#resolvedWrap');
  wrap.hidden = resolved.length === 0;
  if (!resolved.length) { $('#resolved').innerHTML = ''; return; }
  // a linha inteira mora no pure.js (testada); aqui só se resolve o que depende de
  // estado global: a etiqueta da conta (escopo/TWEAK) e o contador de conversas.
  const pushbacks = estado().pushbacks || {};
  $('#resolved').innerHTML = resolved.map(r => resolvedRow(r, {
    pushbacks,
    chip: acctMark(r).chip,
    chatBadge: chatBadge(r.key, estado()?.chats)
  })).join('');
}

/* ---------- render: radar ---------- */
function renderQueue() {
  // guarda de foco: não reconstrói a fila enquanto você mexe no seletor de papel de um card
  const qbox = $('#queue');
  if (document.activeElement && qbox.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  const q = (estado().queue || []).filter(scopeVisible);
  const people = peopleOf();   // idem renderDecisions: um mapa só pra toda a passada
  $('#queueCount').hidden = q.length === 0;
  $('#queueCount').textContent = q.length;
  const btnAll = $('#btnReviewAll');
  btnAll.hidden = q.length < 2;
  btnAll.textContent = `Revisar tudo (${q.length})`;

  const box = $('#queue');
  const vs = listViewState({ lastCheckAt: estado().lastCheckAt, status: estado().status, length: q.length });
  if (vs === 'loading' || vs === 'error') {
    box.innerHTML = `<div class="empty" style="border:0">${vs === 'loading'
      ? 'Verificando se há algo esperando por você…'
      : 'Não foi possível confirmar ainda (a checagem falhou; veja o aviso no topo). Vou tentar de novo no próximo ciclo.'}</div>`;
    return;
  }
  if (!q.length) {
    // aprovadosHoje compara o dia em fuso LOCAL e vive no pure.js (testada la)
    box.innerHTML = queueEmptyOkHtml({
      aprovados: aprovadosHoje(estado().decisions?.resolved),
      // as orgs saem da régua do que é DE FATO buscado (conta não silenciada e com
      // token), no escopo em que a lista acima foi filtrada. Ler config.owners aqui
      // mostrava um campo que o accountList() do server descarta quando há contas.
      owners: orgsMonitoradas(estado().accounts, escopo()),
      intervalSeconds: estado().config?.intervalSeconds,
      // fila vazia com a automação pausada por teto não é "está tudo em dia":
      // é "nada vai ser revisado sozinho até liberar" (ver automacaoPausadaPor)
      pausado: automacaoPausadaPor(estado().accounts, estado().config, estado().usage),
    });
    return;
  }
  const parked = estado().parked || {};
  box.innerHTML = q.map(pr => queueCardHtml(pr, { people, mark: acctMark(pr), parked, sync: estado().sync })).join('');
}

/* selo de estado da SUA revisão numa linha do panorama: primeiro o que o Farol
   registrou (decisões), senão o que o GitHub diz (--reviewed-by, cobre reviews
   feitos fora do Farol). */

function renderPanorama() {
  const list = (estado().panorama || []).filter(scopeVisible);
  $('#panoCount').hidden = list.length === 0;
  $('#panoCount').textContent = list.length;
  $('#panoOwners').textContent = list.length ? 'PRs abertos, os seus destacados' : '';
  const box = $('#panorama');
  const vs = listViewState({ lastCheckAt: estado().lastCheckAt, status: estado().status, length: list.length });
  if (vs !== 'list') {
    box.style.display = 'block';
    box.innerHTML = `<div class="empty" style="border:0">${textoDaListaVazia(vs)}</div>`;
    return;
  }
  box.style.display = '';
  const runningKeys = new Set([].concat(...(estado().activeSessions || []).map(s => s.keys || [])));
  const waitingKeys = estado().headlessWaiting || [];
  const ctxPano = { actions: estado().reviewActions || {}, staleStates: estado().staleStates || {}, running: runningKeys, waiting: waitingKeys,
    todasContas: escopo() === 'all', chats: estado().chats };
  box.innerHTML = list.map(pr => panoramaRowHtml(pr, { ...ctxPano, mark: acctMark(pr, { noBar: true }) })).join('');
}

export {
  renderDecisions, submitPushback, renderResolved, renderQueue, renderPanorama,
  renderRadarNav, switchRadarSub,
};
