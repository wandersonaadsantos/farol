/* Farol · UI: aba Consumo de tokens (charts em SVG puro) + a boca única do clique
   Revisar (usada por outras telas também, ver comentário de revisarUrls abaixo). */

import {
  esc, usageMetricVal, usageStackLayers, usageHoverIndex, usageDayKeysBack, usageColorsFor,
  usageTooltipHtml, fmtUsageMetric, usageKpisHtml, usageMatrixHtml, usageBudgetHtml,
  usageSessionsHtml, filaJustaHtml, syncConfirmacoesDoClique, usageConsolidadoEnvelopeHtml,
} from '../pure.js';
import { estado } from './estado.js';
import { $, api, get, toast, confirmModal, DIMENSAO_DO_CONSUMO, marcarSeg } from './infra.js';
import { registrarTela } from './registro.js';

/* ---------- Consumo de tokens (tela própria, charts em SVG puro) ---------- */
const usageState = { metric: 'total', window: 30, dim: 'kind' };


// 4 cartoes: Custo/Tokens/Sessoes do periodo escolhido + Hoje, cada um com
// sparkline dos ultimos `win` dias (Hoje usa fixo 14 dias, igual ao mock) e chip
// de delta vs o periodo anterior de mesmo tamanho. O chip so aparece quando o
// periodo anterior tem base JUSTA: cabe inteiro na retencao do engine
// (u.retentionDays, fonte unica, era uma replica manual de MAX_DAYS aqui) E o
// historico registrado ja cobria o primeiro dia dele (senao um app novo, ou uma
// janela maior que o historico, comparava contra dias estruturalmente vazios e
// inflava o percentual). Todas as somas passam por usageMetricVal: a DEFINICAO
// de cada metrica mora num lugar so (ui/pure.js), a mesma da timeline/matriz.



let usageHoverIdx = null;

// linha do tempo empilhada (area) por dimensao (tipo/modelo/conta), com legenda,
// grade, marca de pico e tooltip de hover. `u.stackedSeries[dim]` ja vem do
// backend com granularidade diaria (Task 3 de lib/engine/usage.js); aqui so
// fatia a janela escolhida e desenha.
function drawUsageTimeline(el, legendEl, u, metric, win, dim) {
  const { key, campoDeNomes } = DIMENSAO_DO_CONSUMO[dim] || DIMENSAO_DO_CONSUMO.kind;
  const names = u[campoDeNomes] || [];
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
    ${usageHoverIdx != null ? usageTooltipHtml(days[usageHoverIdx], series[usageHoverIdx], names, labels, colors, metric, usageHoverIdx, geo, W) : ''}`;

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


// matriz Tipo x Modelo do periodo escolhido (mesma janela da linha do tempo),
// com heatmap leve (intensidade da celula sobre a maior celula da matriz).

// um cartao por perfil de Claude configurado (Sistema -> Plano e chaves). Perfil de
// assinatura (kind 'assinatura') nao tem teto, so uma nota informativa; perfil de
// chave mostra os 2 medidores (diario/total), gasto x teto.
//
// FONTE UNICA (v2.40.0): tudo vem de u.budgets (usageSummary), que traz teto E
// gasto E bloqueio calculados pela MESMA funcao do gate real (profileBudgetStatus)
// no momento de cada pushState. Antes, o gasto vinha de estado().doctor.claudeAuth
// (cache que so recalculava no boot/Verificar agora/salvar perfis) e o teto de
// estado().config: o cartao congelava enquanto o KPI "Hoje" da mesma tela crescia, e
// a automacao pausava por estouro com o cartao ainda dizendo "no orcamento".

// tabela das sessoes mais recentes (ate 100, cortado no backend). Log permanente
// em disco (usage-sessions.json); a UI so mostra as mais novas, com rolagem.

/* Painel de Justiça de fila (spec 2026-09-10-justica-de-fila-entre-orgs). Fica na aba
   Consumo porque metade dele é dinheiro (a cota da conta dentro do perfil) e a outra
   metade só faz sentido ao lado dela.

   Decide a PRÓPRIA vaziez, no mesmo padrão do resto desta aba: quem tem uma org e um
   perfil só não tem rodízio nenhum pra explicar, e um card vazio na tela parece defeito.
   O filaJustaHtml devolve '' nesse caso, e o card inteiro some. */
function renderFilaJusta() {
  const card = $('#filaJustaCard'), body = $('#filaJustaBody');
  if (!card || !body) return;
  const html = filaJustaHtml(estado() && estado().filaJusta);
  body.innerHTML = html;
  card.hidden = !html;
}

function renderUsage() {
  renderFilaJusta();
  renderUsageDeviceSeg();
  const consolidado = usageDeviceState.escopo === 'todos';
  const painelLocal = $('#usageLocal');
  const painelTodos = $('#usageConsolidado');
  if (painelLocal) painelLocal.hidden = consolidado;
  if (painelTodos) painelTodos.hidden = !consolidado;
  if (consolidado) { renderUsageConsolidado(); return; }
  const u = estado() && estado().usage;
  const kpisEl = $('#usageKpis'), tl = $('#usageTimeline'), legend = $('#usageLegend');
  const matrix = $('#usageMatrix'), matrixCap = $('#usageMatrixCaption');
  const budget = $('#usageBudget'), sessions = $('#usageSessions');
  if (!kpisEl || !tl || !legend || !matrix || !matrixCap || !budget || !sessions) return;
  // cada painel decide a PROPRIA vaziez, lendo a PROPRIA fonte: u.totals vem de
  // usage.json, mas a matriz/sessões leem usage-sessions.json e daysByKindModel
  // (arquivos diferentes). Gatear a aba inteira num campo agregado só deixava a
  // tela se contradizer quando os dois arquivos discordam entre si (achado da
  // revisão final: timeline dizia "nenhuma sessão" com a matriz e a tabela de
  // sessões cheias logo abaixo). drawUsageTimeline e os builders de matriz,
  // orçamento e sessões já sabem ficar vazios sozinhos (Task 14); só o
  // usageKpisHtml não tem essa defesa, então o guard fica só pra ele.
  if (!u || !u.totals || !u.totals.sessions) kpisEl.innerHTML = '';
  else kpisEl.innerHTML = usageKpisHtml(u, usageState.window);
  drawUsageTimeline(tl, legend, u || {}, usageState.metric, usageState.window, usageState.dim);
  const mtx = usageMatrixHtml(u || {}, usageState.metric, usageState.window);
  matrix.innerHTML = mtx.html; matrixCap.textContent = mtx.caption;
  budget.innerHTML = usageBudgetHtml(u || {});
  sessions.innerHTML = usageSessionsHtml(u || {});
}


/* ---------- coordenação no clique Revisar (U2) ----------

   A resposta de /api/review traz `coordenacao[]` quando o preflight segurou algum PR.
   A ESCOLHA do desfecho por motivo é pura (syncConfirmacaoDoClique, em ui/pure.js);
   aqui fica só o modal e o reenvio. O override é reenviado por PR, e só pelo PR que
   a pessoa confirmou: mandar o lote inteiro com a flag contornaria a coordenação de
   PRs que ninguém confirmou. */
// owner/repo#N a partir da URL do PR: é assim que a URL que o clique ENVIOU vira a
// chave que a resposta devolve, sem depender de o PR estar numa lista da tela.
function keyDaUrl(url) {
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(String(url || ''));
  return m ? `${m[1]}/${m[2]}#${m[3]}` : '';
}

// `urls` é a lista que o clique enviou, e é ela que resolve a chave. Procurar só em
// estado().queue e estado().panorama deixava a confirmação sem abrir quando o clique vinha de
// Resolvidos ou de Decisões, que é justamente onde o PR não está nas duas listas. As
// listas ficam como degrau de recuo para chamador que não passe as urls.
async function tratarCoordenacaoDoClique(resp, mode, urls = []) {
  const porKey = new Map(urls.map((u) => [keyDaUrl(u), u]).filter(([k]) => k));
  for (const c of syncConfirmacoesDoClique(resp)) {
    if (c.tipo === 'aviso') { toast('info', c.texto, 7000); continue; }
    const daLista = (estado().queue || []).concat(estado().panorama || []).find(p => p.key === c.key);
    const url = porKey.get(c.key) || (daLista && daLista.url) || '';
    if (!url) { toast('info', `${c.key}: a coordenação segurou a revisão, e o PR não está mais na tela.`, 6000); continue; }
    // uma confirmação por vez é o ponto: são modais, e empilhar dois esconderia um
    const ok = await confirmModal({ title: c.titulo, confirmLabel: c.acao, body: c.corpo });
    if (ok) revisarUrls([url], { [c.override]: true }, mode);
  }
}

/* Boca ÚNICA do clique Revisar. Todos os caminhos (fila, panorama, "revisar de novo",
   revisar tudo, terminal) passam por aqui, pela mesma razão do enqueueHeadless no
   engine: garantia que precisa valer sempre mora no estrangulamento, e não em cada
   chamador. Sem isto, o botão que alguém acrescentasse amanhã ignoraria a confirmação
   da coordenação em silêncio. */
function revisarUrls(urls, extras = {}, mode = 'auto') {
  const corpo = { urls, ...extras };
  if (mode === 'terminal') corpo.mode = 'terminal';
  return api('/api/review', corpo).then(r => {
    if (r && Array.isArray(r.coordenacao) && r.coordenacao.length) tratarCoordenacaoDoClique(r, mode, urls);
    return r;
  });
}

/* ---------- Consumo: este aparelho x todos os aparelhos (U4) ----------

   "Este aparelho" volta ao renderUsage de sempre, sem NENHUMA diferença: a consolidação
   é uma segunda visão, nunca uma reescrita da primeira. O segmentado só existe com a
   consolidação ligada, porque sem ela não há o que consolidar. */
const usageDeviceState = { escopo: 'este' };

function usageConsolidadoVisivel() {
  return !!(estado() && estado().sync && estado().sync.consolidation);
}

function renderUsageDeviceSeg() {
  const box = $('#usageDevice');
  if (!box) return;
  box.hidden = !usageConsolidadoVisivel();
  // consolidação desligada no meio do caminho: a visão volta pra deste aparelho, senão
  // a tela ficaria presa numa aba que não pode mais buscar nada
  if (box.hidden && usageDeviceState.escopo !== 'este') usageDeviceState.escopo = 'este';
}

// O estado chega por push a cada ciclo de polling, e este painel é o único que faz IO
// para pintar. Sem memória, cada push trocava o conteúdo por "Buscando…" (pisca) e
// repetia o GET. A resposta anterior pinta na hora e a busca só se repete depois do
// intervalo mínimo; trocar a janela busca na hora, porque aí a resposta é outra.
const consolidadoCache = { janela: null, resposta: null, at: 0, buscando: false };
const CONSOLIDADO_MIN_MS = 30000;

async function renderUsageConsolidado() {
  const alvo = $('#usageConsolidado');
  if (!alvo) return;
  const janela = usageState.window;
  const serveCache = consolidadoCache.resposta && consolidadoCache.janela === janela;
  alvo.innerHTML = serveCache
    ? usageConsolidadoEnvelopeHtml(consolidadoCache.resposta)
    : '<p class="vago">Buscando o consumo de todos os aparelhos…</p>';
  const recente = consolidadoCache.janela === janela && consolidadoCache.at > 0
    && (Date.now() - consolidadoCache.at) < CONSOLIDADO_MIN_MS;
  if (recente || consolidadoCache.buscando) return;
  consolidadoCache.buscando = true;
  let r;
  try { r = await get(`/api/sync/consolidated?days=${encodeURIComponent(janela)}`); }
  finally { consolidadoCache.buscando = false; }
  // a janela pode ter mudado enquanto a busca corria: resposta velha não pinta a tela
  if (usageDeviceState.escopo !== 'todos' || usageState.window !== janela) return;
  // `at` é carimbado SEMPRE, inclusive na falha: o get() devolve null quando a rede cai,
  // e guardar só o sucesso deixava o throttle sem efeito justamente com o endpoint fora
  // do ar (cada push repintava "Buscando…" e disparava outro GET). A resposta nula não
  // entra no cache, para a tela não servir vazio como se fosse dado.
  consolidadoCache.janela = janela;
  consolidadoCache.at = Date.now();
  if (r) consolidadoCache.resposta = r;
  alvo.innerHTML = usageConsolidadoEnvelopeHtml(r);
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
  const dev = document.querySelector('#usageDevice');
  if (dev) {
    dev.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
      marcarSeg(dev.querySelectorAll('.seg-btn'), x => x === b);
      usageDeviceState.escopo = b.dataset.escopo;
      renderUsage();
    }));
  }
}
wireUsageControls();

// Import estático roda ANTES do corpo do app.js (é assim que ES module funciona), e
// a ordem de registro das telas precisa continuar entregas, destaques, time, sistema,
// consumo (telasRegistradas() devolve na ordem de registro). Se o registro rodasse
// aqui, no topo do módulo, consumo passaria à frente de destaques/time/sistema, que
// ainda se registram no CORPO do app.js. Por isso o registro fica atrás desta função,
// que o app.js chama no lugar exato de onde tirou o registrarTela literal.
function registrarTelaConsumo() {
  registrarTela({
    id: 'consumo',
    aoEntrar: () => renderUsage(),
    aoEstado: () => { if ($('#tab-consumo').classList.contains('active')) renderUsage(); },
  });
}

export { revisarUrls, registrarTelaConsumo, renderUsage };
