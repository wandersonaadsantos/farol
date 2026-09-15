// A aba Entregas v2: busca, estatísticas, atividade e grupos com progresso, rank e
// paginação. Releitura desenhada no Claude Design, projeto "Revisão página entregas"
// (`Entregas v2.dc.html`).
//
// Extraído do ui/pure.js na Fase 1a da reorganização; o conteúdo não mudou.

// aviso de teto da aba Entregas: a busca fatiada corta em DELIVERIES_LIMIT por org e
// o server manda o limite no payload (fonte única do número; a mensagem antiga
// afirmava 100 com o teto real em 1000). Fallback 5000 é o valor real atual e cobre
// payload sem o campo. "atividade mais recente" (não "mais recentes"): dentro da
// fatia mínima o corte do gh é por --sort updated, aproximação de recência.
import { esc, fmtRel, groupBy, lastMerge, localDayKey, plural, repoShort, usageDayKeysBack } from './comum.js';
import { personMention, repoMention } from './mencoes.js';

export function delivCappedMsg(limit) {
  const n = Number(limit) || 5000;
  return `Alguma organização tem mais de ${n} entregas no período; mostrando as ${n} de atividade mais recente (números e gráfico podem subestimar).`;
}

// busca livre por título, autor ou repo, sem diferenciar caixa (mesmo campo
// único do mock; sem acento-folding, igual ao resto do app)
export function delivFilterItems(items, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return items || [];
  return (items || []).filter(it => `${it.title || ''} ${it.author || ''} ${it.repo || ''}`.toLowerCase().includes(q));
}

// buckets diários LOCAIS (mesmo corte de localDayKey/usageDayKeysBack), mais
// antigo primeiro, hoje por último. dias=0 (janela "Hoje") vira 1 bucket só.
export function delivDayBuckets(items, days, agora = Date.now()) {
  const nDias = days === 0 ? 1 : days;
  const counts = new Map();
  for (const it of (items || [])) {
    const k = localDayKey(it.mergedAt);
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  }
  return usageDayKeysBack(nDias, agora).map(k => {
    const [y, m, d] = k.split('-').map(Number);
    return { dayKey: k, date: new Date(y, m - 1, d), n: counts.get(k) || 0 };
  });
}

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const ddmm = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

// os 4 cartões de estatística do topo. [] quando não há entregas no período
// (a UI então nem desenha a grade). O 4º cartão muda com o período: "Hoje"
// mostra o último merge, os demais mostram a média diária com o pico.
export function delivStats(items, days, agora = Date.now()) {
  const total = (items || []).length;
  if (!total) return [];
  const hoje = localDayKey(agora);
  const deHoje = items.filter(x => localDayKey(x.mergedAt) === hoje).length;
  const porAutor = [...groupBy(items, x => x.author || '(desconhecido)').entries()]
    .sort((a, b) => delivVolumeOrder(a[1], b[1], a[0], b[0]));
  const porRepo = [...groupBy(items, x => x.repo).entries()].sort((a, b) => b[1].length - a[1].length);
  const nDias = days === 0 ? 1 : days;
  const buckets = delivDayBuckets(items, days, agora);
  const pico = buckets.reduce((a, b) => (b.n > a.n ? b : a), buckets[0] || { n: 0 });
  const media = (total / nDias).toFixed(1).replace('.', ',');
  const ultimoItem = items.reduce((a, b) => (new Date(b.mergedAt) > new Date(a.mergedAt) ? b : a), items[0]);

  // `goto` (opcional) faz o subtítulo virar ATALHO pra própria lista abaixo:
  // "@fulano na frente" leva ao grupo dele (trocando pra visão por pessoa),
  // "repo na frente" ao grupo do repo, "+N hoje" ao período Hoje. Menção de
  // pessoa/repo aqui é atalho INTERNO de propósito (o GitHub fica nos nomes
  // dentro da lista), pra o mesmo texto nunca ter dois destinos.
  const quarto = days === 0
    ? {
      rotulo: 'Último merge', valor: fmtRel(ultimoItem.mergedAt, agora),
      sub: 'por @' + (ultimoItem.author || '(desconhecido)'),
      goto: ultimoItem.author ? `deliv:author:${ultimoItem.author}` : ''
    }
    : { rotulo: 'Média por dia', valor: media, sub: pico.n ? `pico de ${pico.n} (${DIAS_SEMANA[pico.date.getDay()]} ${ddmm(pico.date)})` : '' };

  return [
    {
      rotulo: 'PRs mergeados', valor: String(total),
      sub: subtituloDoPeriodo(days, deHoje),
      goto: days !== 0 && deHoje > 0 ? 'deliv:days:0' : ''
    },
    { rotulo: 'Pessoas entregando', valor: String(porAutor.length), sub: '@' + porAutor[0][0] + ' na frente', goto: `deliv:author:${porAutor[0][0]}` },
    { rotulo: 'Repositórios ativos', valor: String(porRepo.length), sub: repoShort(porRepo[0][0]) + ' na frente', goto: `deliv:repo:${porRepo[0][0]}` },
    quarto
  ];
}

// days === 0 é a janela "hoje", e aí o subtítulo diz desde quando, não quantos hoje
function subtituloDoPeriodo(days, deHoje) {
  if (days === 0) return 'desde 00:00';
  return deHoje > 0 ? `+${deHoje} hoje` : 'nenhum hoje';
}

export function delivStatsCards(stats) {
  if (!(stats || []).length) return '';
  return `<div class="deliv-stats">${stats.map(s => {
    const sub = s.goto
      ? `<span class="ds-sub is-goto" data-goto="${esc(s.goto)}" role="button" tabindex="0" title="Ir até ${esc(s.sub)}">${esc(s.sub)}</span>`
      : `<span class="ds-sub">${esc(s.sub)}</span>`;
    return `<div class="deliv-stat"><span class="ds-label">${esc(s.rotulo)}</span><b>${esc(s.valor)}</b>${sub}</div>`;
  }).join('')}</div>`;
}

// barras da "Atividade no período": rótulo raro pra não colidir em janelas
// longas (todo dia em 7, a cada 3 em 15, a cada 5 em 30), sempre com "hoje"
// na última barra.
export function delivActivityChart(items, days, agora = Date.now()) {
  const buckets = delivDayBuckets(items, days, agora);
// A última barra é sempre "hoje". Nas demais, a janela decide a densidade do rótulo:
// 7 dias cabe o dia da semana em todas; 15 e 30 ficariam ilegíveis, então rotula de 3
// em 3 e de 5 em 5.
const PASSO_DO_ROTULO = { 7: 1, 15: 3 };
function rotuloDaBarra(days, hojeBar, i, data) {
  if (hojeBar) return 'hoje';
  if (days === 7) return DIAS_SEMANA[data.getDay()];
  const passo = PASSO_DO_ROTULO[days] || 5;
  return i % passo === 0 ? ddmm(data) : '';
}

  const max = Math.max(1, ...buckets.map(b => b.n));
  return buckets.map((b, i) => {
    const hojeBar = i === buckets.length - 1;
    const rotulo = rotuloDaBarra(days, hojeBar, i, b.date);
    const pct = b.n === 0 ? 0 : Math.max(6, Math.round(b.n / max * 100));
    const dica = `${DIAS_SEMANA[b.date.getDay()]} ${ddmm(b.date)} · ${plural(b.n, 'PR', 'PRs')}`;
    // classe 'zero', NUNCA 'empty': .empty e o estado vazio GLOBAL do app (padding
    // 26px + borda tracejada) e colidia aqui, inflando dia SEM merge pra 54px de
    // altura, a 2a barra mais alta do grafico (as barras escuras do print de 10/08)
    return `<div class="deliv-bar" title="${esc(dica)}">
      <div class="deliv-bar-track"><div class="deliv-bar-fill${b.n === 0 ? ' zero' : ''}" style="height:${pct}%"></div></div>
      <div class="deliv-bar-label">${esc(rotulo)}</div>
    </div>`;
  }).join('');
}

// cartão inteiro do gráfico, ou '' quando não faz sentido mostrar (janela
// "Hoje", sem granularidade diária, ou sem nenhuma entrega no período)
export function delivActivityCard(items, days, agora = Date.now()) {
  if (!(days > 0) || !(items || []).length) return '';
  return `<div class="card deliv-chart-card">
    <div class="deliv-chart-head"><h3>Atividade no período</h3><span class="deliv-chart-note">merges por dia</span></div>
    <div class="deliv-bars">${delivActivityChart(items, days, agora)}</div>
  </div>`;
}

// fatia as linhas de um grupo respeitando o teto de PRs visíveis. Legenda de
// repo (linha ehCap, só na visão por pessoa) não conta no teto, mas só entra
// se o PR dela entrou: uma legenda que sobra sozinha no fim é descartada.
export function delivSliceRows(rows, teto, expanded) {
  if (expanded) return { visiveis: rows, resto: 0 };
  const out = []; let prs = 0, resto = 0;
  for (const r of rows) {
    if (r.ehPr) { if (prs < teto) { out.push(r); prs++; } else resto++; }
    else if (prs < teto) out.push(r);
  }
  if (out.length && !out[out.length - 1].ehPr) out.pop();
  return { visiveis: out, resto };
}

function delivPrRowV2(it, comAutor) {
  const num = String(it.key || '').split('#')[1] || it.number;
  return `<div class="row">
    <span class="ref"><a href="${esc(it.url)}" target="_blank" rel="noreferrer">#${esc(num)}</a></span>
    <span class="title" title="${esc(it.title)}">${esc(it.title)}</span>
    ${comAutor ? `<span class="who">${personMention(it.author, 'xs', true)}</span>` : ''}
    <span class="when">${fmtRel(it.mergedAt)}</span>
  </div>`;
}

// corpo de um grupo: linhas fatiadas + botão "mostrar mais/menos" quando cabe
function delivGroupBody(rows, teto, expandedKeys, groupKey) {
  const expanded = !!(expandedKeys && expandedKeys.has(groupKey));
  const { visiveis, resto } = delivSliceRows(rows, teto, expanded);
  const rowsHtml = visiveis.map(r => r.ehCap
    ? `<div class="deliv-caption">${repoMention(r.cap)}</div>`
    : delivPrRowV2(r.item, r.comAutor)
  ).join('');
  const totalPr = rows.filter(r => r.ehPr).length;
  const mostraBotao = resto > 0 || (expanded && totalPr > teto);
  const botao = mostraBotao
    ? `<button type="button" class="deliv-mais" data-deliv-group="${esc(groupKey)}">${resto > 0 ? `mostrar mais ${resto}` : 'mostrar menos'}</button>`
    : '';
  return `<div class="rows">${rowsHtml}</div>${botao}`;
}

function delivGroupCardV2(head, count, pct, bodyHtml, opts = {}) {
  // grupo pequeno arredonda pra 0% mas a barra tem piso visual de 3%: o tooltip
  // diz "<1%" em vez de afirmar "0%" com preenchimento a mostra
  const pctLabel = pct < 1 ? '<1' : String(pct);
  const open = opts.open !== false;
  return `<div class="card deliv-card">
    <details data-deliv-group="${esc(opts.groupKey || '')}"${open ? ' open' : ''}>
      <summary class="deliv-sum">${head}<span class="deliv-progress" title="${pctLabel}% das entregas do período"><span class="deliv-progress-fill" style="width:${Math.max(pct, 3)}%"></span></span><span class="count">${count}</span></summary>
      ${bodyHtml}
    </details>
  </div>`;
}

// Regra única do ranking por volume. Recência desempata e o nome torna o
// resultado determinístico quando até o último merge coincide (payload do gh
// não é contrato de ordenação para um empate completo).
function delivVolumeOrder(aList, bList, aKey, bKey) {
  return bList.length - aList.length
    || String(lastMerge(bList)).localeCompare(String(lastMerge(aList)))
    || String(aKey).localeCompare(String(bKey));
}

export function deliveriesByRepo(items, opts = {}) {
  const teto = opts.teto || 4;
  const expandedKeys = opts.expandedKeys || new Set();
  const totalPeriodo = items.length;
  const groups = [...groupBy(items, it => it.repo).entries()].map(([repo, list]) => {
    const autores = new Set(list.map(x => x.author).filter(Boolean)).size;
    const ordenado = [...list].sort((a, b) => String(b.mergedAt).localeCompare(String(a.mergedAt)));
    const rows = ordenado.map(item => ({ ehPr: true, ehCap: false, item, comAutor: true }));
    const head = `<span class="deliv-name">${repoMention(repo)}</span><span class="deliv-meta">${plural(autores, 'autor', 'autores')} · último ${fmtRel(lastMerge(list))}</span>`;
    return { repo, list, last: lastMerge(list), head, rows, groupKey: 'repo:' + repo };
  });
  // mais ATUAL primeiro (decisão do Wanderson, 10/08/2026): quem mergeou por
  // último abre a lista, e desce até o grupo parado há mais tempo; contagem só
  // desempata. Os cartões "na frente" seguem por volume, papel deles.
  groups.sort((a, b) => String(b.last).localeCompare(String(a.last)) || b.list.length - a.list.length);
  return groups.map(g => delivGroupCardV2(
    g.head, g.list.length, Math.round(g.list.length / totalPeriodo * 100),
    delivGroupBody(g.rows, teto, expandedKeys, g.groupKey),
    { groupKey: g.groupKey, open: true }
  )).join('');
}

export function deliveriesByAuthor(items, opts = {}) {
  const teto = opts.teto || 4;
  const expandedKeys = opts.expandedKeys || new Set();
  const openKeys = opts.openKeys || new Set();
  const totalPeriodo = items.length;
  const groups = [...groupBy(items, it => it.author || '(desconhecido)').entries()].map(([login, list]) => {
    const repos = new Set(list.map(x => x.repo)).size;
    const subRepos = [...groupBy(list, x => x.repo).entries()]
      .map(([repo, prs]) => ({ repo, prs, last: lastMerge(prs) }))
      // mesma regra dos grupos: o repo com merge mais recente da pessoa vem antes
      .sort((a, b) => String(b.last).localeCompare(String(a.last)) || b.prs.length - a.prs.length);
    const rows = [];
    for (const sg of subRepos) {
      rows.push({ ehPr: false, ehCap: true, cap: sg.repo });
      const ordenado = [...sg.prs].sort((a, b) => String(b.mergedAt).localeCompare(String(a.mergedAt)));
      for (const item of ordenado) rows.push({ ehPr: true, ehCap: false, item, comAutor: false });
    }
    const head = `<span class="deliv-name">${personMention(login)}</span><span class="deliv-meta">${plural(repos, 'repo', 'repos')} · último ${fmtRel(lastMerge(list))}</span>`;
    return { login, list, last: lastMerge(list), head, rows, groupKey: 'author:' + login };
  });
  // Na visão por pessoa, volume é a pergunta principal: quem entregou mais no
  // recorte visível vem antes. Recência e login servem só de desempate.
  groups.sort((a, b) => delivVolumeOrder(a.list, b.list, a.login, b.login));
  return groups.map(g => delivGroupCardV2(
    g.head, g.list.length, Math.round(g.list.length / totalPeriodo * 100),
    delivGroupBody(g.rows, teto, expandedKeys, g.groupKey),
    { groupKey: g.groupKey, open: openKeys.has(g.groupKey) }
  )).join('');
}

// estado vazio: some pra ampliar o período (só quando dá pra ampliar) e some
// pra limpar a busca (só quando há busca ativa)
export function delivEmptyState(opts = {}) {
  const query = opts.query || '';
  const titulo = query ? `Nada com “${query}” neste período.` : 'Nenhum PR mergeado neste período.';
  // "organizações monitoradas em Sistema" leva ATÉ a linha das orgs (regra das
  // menções: citou um lugar do app, clicou, chegou lá)
  const sub = query
    ? 'Tente outro termo ou amplie o período.'
    : `Amplie o período ou confira as <span class="is-goto" data-goto="sys:connections:#sys-row-orgs" role="button" tabindex="0">organizações monitoradas em Sistema</span>.`;
  const subHtml = query ? esc(sub) : sub;
  const botoes = [];
  if (opts.canExpand) botoes.push(`<button type="button" class="btn sm" data-deliv-action="ver30">Ver 30 dias</button>`);
  if (opts.canClear) botoes.push(`<button type="button" class="btn sm ghost" data-deliv-action="limpar-busca">Limpar busca</button>`);
  return `<div class="empty deliv-empty"><span class="big">📦</span>${esc(titulo)}<br><small>${subHtml}</small>${botoes.length ? `<div class="deliv-empty-actions">${botoes.join('')}</div>` : ''}</div>`;
}
