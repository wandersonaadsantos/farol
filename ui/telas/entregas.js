/* Farol · UI: aba Entregas (PRs mergeados: busca, estatísticas, atividade, grupos por
   repo/pessoa com paginação). Releitura do Claude Design, projeto "Revisão página
   entregas" (Entregas v2.dc.html). */

import {
  esc, delivCappedMsg, delivFilterItems, delivStats, delivStatsCards, delivActivityCard,
  delivEmptyState, deliveriesByRepo, deliveriesByAuthor,
} from '../pure.js';
import { estado, abaAtual, deliveriesEnabled } from './estado.js';
import { $, get, showOp, closeOp, marcarSeg, sysFlash } from './infra.js';
import { multiAccount } from './contas.js';
import { registrarTela } from './registro.js';

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
  for (const a of (estado() && estado().accounts) || []) if ((a.owners || []).length) return a.owners[0];
  return (((estado() && estado().config) || {}).owners || [])[0] || '';
}
// todas as orgs monitoradas (união dos owners de todas as contas), c/ a conta dona
function orgsWithAccount() {
  const map = new Map(); // org -> user (conta dona)
  for (const a of (estado() && estado().accounts) || []) for (const o of (a.owners || [])) if (!map.has(o)) map.set(o, a.user);
  for (const o of (((estado() && estado().config) || {}).owners || [])) if (!map.has(o)) map.set(o, (estado().account || {}).user || '');
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
  if (!deliveriesEnabled()) return;
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

// Alvo do roteador de navegação interna (data-goto="deliv:...", ver ui/app.js). O
// `switchTab` chega por parâmetro porque é primitiva do shell (troca de aba, aciona
// aoEntrar de toda tela) e não pode vir daqui sem criar ciclo com o bootstrap.
function gotoDeliv(kind, valor, switchTab) {
  // KPIs desta tela também usam data-goto. Não recarregue a própria aba antes
  // de abrir/rolar o grupo: a resposta assíncrona substituiria o DOM recém-alvo.
  if (abaAtual() !== 'entregas') switchTab('entregas');
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

registrarTela({ id: 'entregas', aoEntrar: () => loadDeliveries() });

export { gotoDeliv };
