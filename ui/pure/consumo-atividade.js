import { esc } from './comum.js';
import { fmtUsageMetric, USAGE_KIND_LABEL } from './consumo.js';

const count = value => Number(value || 0).toLocaleString('pt-BR');
const money = value => `US$ ${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tokens = row => row.inputTokens + row.outputTokens;
const date = day => day.split('-').reverse().join('/');
const statusLabel = { ok: 'Concluída', erro: 'Erro', cancelada: 'Cancelada', interrompida: 'Interrompida', parcial: 'Parcial', descartada: 'Descartada', desconhecido: 'Não informado' };

export function activityKpisHtml(report) {
  const values = [
    ['review', 'Reviews concluídas', report.completed.reviews, 'Resultados técnicos · publicação não medida'],
    ['self', 'Autoanálises concluídas', report.completed.self, 'Análise de PR próprio'],
    ['pr', 'PRs revisados', report.completed.prs, 'PRs únicos com resultado concluído'],
    ['all', 'Execuções de IA', report.totals.attempts, `${count(report.retries)} retentativas identificadas já incluídas`],
  ];
  return values.map(([key, label, value, sub]) => `<button class="usage-kpi activity-kpi" data-activity-focus="${key}"><span class="usage-kpi-label">${label} <span aria-hidden="true">↗</span></span><b>${count(value)}</b><span class="usage-kpi-sub">${sub}</span></button>`).join('');
}

function activityTable(report) {
  const row = (b, label) => `<tr><th scope="row">${label}</th>${['attempts', 'ok', 'erro', 'cancelada', 'interrompida', 'parcial', 'descartada', 'desconhecido'].map(key => `<td>${count(b[key])}</td>`).join('')}<td>${fmtUsageMetric(tokens(b), 'total')}</td></tr>`;
  return `<div class="card usage-chart-card"><div class="usage-chart-head"><h3>Atividade por tipo</h3><span class="usage-caption">Retentativas incluídas nas execuções</span></div><div class="activity-scroll" tabindex="0" role="region" aria-label="Atividade por tipo e resultado"><table class="activity-table"><thead><tr><th>Tipo de trabalho</th><th>Execuções</th><th>Concluídas</th><th>Erros</th><th>Canceladas</th><th>Interrompidas</th><th>Parciais</th><th>Descartadas</th><th>Sem resultado</th><th>Tokens</th></tr></thead><tbody>${report.byKind.map(b => row(b, esc(USAGE_KIND_LABEL[b.name]))).join('')}</tbody><tfoot>${row(report.totals, 'Total')}</tfoot></table></div><p class="usage-caption">Resultados de tentativas nesta tabela; os cartões acima agrupam operações identificadas. Deslize a tabela para ver todas as colunas.</p></div>`;
}

function resources(report) {
  const t = report.totals;
  let api = money(t.apiUsd);
  if (t.unknownBilling === t.attempts && t.attempts > 0) api = 'Não identificado';
  return `<div class="activity-resources"><div><span>Tokens registrados · entrada + saída</span><b>${fmtUsageMetric(tokens(t), 'total')}</b><small>${fmtUsageMetric(t.inputTokens, 'total')} entrada · ${fmtUsageMetric(t.outputTokens, 'total')} saída</small></div><div><span>Cache · contado separadamente</span><b>${fmtUsageMetric(t.cacheReadTokens + t.cacheCreationTokens, 'total')}</b><small>${fmtUsageMetric(t.cacheReadTokens, 'total')} leitura · ${fmtUsageMetric(t.cacheCreationTokens, 'total')} escrita</small></div><div><span>Custo de API registrado</span><b>${api}</b><small>${money(t.apiEstimatedUsd)} estimados · ${count(t.apiUnknown)} sem valor</small><small>${count(t.subscription)} execuções de assinatura · ${count(t.unknownBilling)} sem modalidade histórica</small></div></div><p class="usage-caption">Valores do CLI são referência, não confirmação de fatura. ${count(t.unknownCost)} execuções têm custo desconhecido. Tokens conhecidos podem ser parciais.</p>`;
}

export function activityTimelineHtml(report, metric = 'sessions') {
  if (metric === 'api' && report.totals.unknownBilling === report.totals.attempts && report.totals.attempts) return '<p class="usage-empty">Modalidade de API não identificada nos registros deste recorte.</p>';
  const values = report.series.slice().sort((a, b) => a.name.localeCompare(b.name));
  const value = b => {
    if (metric === 'api') return b.apiUsd;
    return metric === 'total' ? tokens(b) : b.attempts;
  };
  const max = Math.max(1, ...values.map(value));
  const bars = values.map(b => `<div class="activity-bar" title="${esc(date(b.name))}: ${esc(count(value(b)))}"><span style="height:${Math.max(1, value(b) / max * 100)}%"></span><small>${esc(b.name.slice(8))}</small></div>`).join('');
  let title = metric === 'total' ? 'Tokens registrados' : 'Execuções';
  let caption = metric === 'total' ? 'entrada + saída, sem cache' : 'retentativas incluídas';
  if (metric === 'api') { title = 'Custo de API'; caption = 'somente modalidade API identificada · referência em US$'; }
  return `<div class="activity-bars" role="img" aria-label="${title} por dia registrado">${bars || '<p class="usage-empty">Nenhuma execução neste período.</p>'}</div><p class="usage-caption">${date(report.range.start)} a ${date(report.range.end)} · dias com registros · ${caption}</p>`;
}

function modelsHtml(report) {
  return report.models.map(model => `<div class="activity-model"><span>${esc(model.name)}</span><span>${count(model.attempts)} execuções <small>${fmtUsageMetric(tokens(model), 'total')} tokens</small></span></div>`).join('') || '<p class="usage-empty">Sem dados neste período.</p>';
}

function reference(row, remote) {
  if (!row.ref) return 'Sem referência';
  if (remote) return `PR identificado · ${esc(row.ref.slice(0, 10))}…`;
  return esc(row.ref);
}

function historyRow(row, remote) {
  const label = `${USAGE_KIND_LABEL[row.kind]} · ${reference(row, remote)}`;
  const attempts = row.attempts.map(a => `<li>${esc(statusLabel[a.status])} · ${esc(new Date(a.at).toLocaleString('pt-BR'))} · ${fmtUsageMetric(tokens(a), 'total')} tokens · ${UNKNOWN_COST(a) ? 'custo desconhecido' : money(a.costUsd)} (${esc(a.costSource)})</li>`).join('');
  const total = row.attempts.reduce((n, a) => n + tokens(a), 0);
  const duration = row.attempts.reduce((n, a) => n + Math.max(0, a.duration), 0);
  const durationLabel = row.attempts.every(a => a.durationKnown) ? `${count(Math.round(duration / 60000))} min` : 'Não informada';
  const cost = row.attempts.reduce((n, a) => n + a.costUsd, 0);
  const costLabel = row.attempts.some(UNKNOWN_COST) ? 'Parcial / desconhecido' : money(cost);
  return `<tr><td><details data-activity-key="${esc(row.key)}"><summary>${label}<small>${count(row.attempts.length)} tentativa(s) · ${esc(row.device === 'local' ? 'Este aparelho' : row.device)} · ${esc(new Date(row.at).toLocaleDateString('pt-BR'))}</small></summary><ol>${attempts}</ol><small>Consumo de todas as tentativas desta operação, inclusive fora da janela. Conclusão contada no máximo uma vez.</small></details></td><td>${esc(statusLabel[row.status])}</td><td>${esc(row.model)}<small>${esc(row.provider)}</small></td><td>${fmtUsageMetric(total, 'total')}</td><td>${durationLabel}</td><td>${costLabel}<small>Referência do CLI</small></td></tr>`;
}

function UNKNOWN_COST(row) { return ['sem-base', 'desconhecido'].includes(row.costSource); }

export function activityHistoryHtml(report) {
  const h = report.history;
  const start = h.total ? h.page * 8 + 1 : 0;
  const previous = h.page === 0 ? 'disabled' : '';
  const next = h.page + 1 >= h.pages ? 'disabled' : '';
  return `<div class="activity-scroll"><table class="activity-history"><thead><tr><th>Trabalho / PR</th><th>Resultado</th><th>Modelo</th><th>Tokens da operação</th><th>Duração</th><th>Custo de referência</th></tr></thead><tbody>${h.rows.map(row => historyRow(row, report.remote)).join('') || '<tr><td colspan="6">Nenhuma operação neste recorte.</td></tr>'}</tbody></table></div><div class="activity-history-foot"><span>${start}–${Math.min(h.total, (h.page + 1) * 8)} de ${count(h.total)} operações</span><div><button data-activity-page="${h.page - 1}" aria-label="Página anterior" ${previous}>←</button><button data-activity-page="${h.page + 1}" aria-label="Próxima página" ${next}>→</button></div></div>`;
}

export function activityBodyHtml(report) {
  if (!report?.ok) return `<div class="callout warn" role="status">${esc(report?.motivo || 'Não foi possível carregar o consumo. Totais indisponíveis; isto não significa ausência de uso.')}</div>`;
  let notice = '';
  if (report.incomplete) notice += 'O diário detalhado não cobre todo o consumo agregado. Os indicadores representam apenas os registros disponíveis. ';
  if (report.unidentified) notice += `${count(report.unidentified)} execuções sem identidade de operação: consumo incluído, conclusões e retentativas não inferidas. `;
  if (report.since && report.range.start < report.sinceDay) notice += 'O período começa antes do primeiro registro disponível. Não há cobertura comprovada dos dias anteriores. ';
  if (report.remote) notice += 'Consolidado apenas dos eventos recebidos. Contas e PRs remotos permanecem identificados por hash; modalidade e provedor podem não estar disponíveis. ';
  const scope = report.remote ? 'Todos os aparelhos · eventos sincronizados' : 'Este aparelho · diário permanente';
  const warning = notice ? `<div class="callout warn">${esc(notice)}</div>` : '';
  return `<div class="activity-scope">${date(report.range.start)} a ${date(report.range.end)} · ${scope}</div>${warning}<div class="usage-kpis activity-kpis">${activityKpisHtml(report)}</div>${activityTable(report)}${resources(report)}<div class="usage-grid-2"><div class="card usage-chart-card"><div class="usage-chart-head"><h3>Linha do tempo</h3><div class="seg"><button data-activity-metric="sessions">Volume</button><button data-activity-metric="total">Tokens</button><button data-activity-metric="api">Custo API</button></div></div><div id="activityTimeline">${activityTimelineHtml(report)}</div></div><div class="card usage-chart-card"><h3>Por modelo</h3><p class="usage-caption">Uma execução pode usar mais de um modelo.</p>${modelsHtml(report)}</div></div>`;
}

export function activityRulesHtml() {
  return '<summary>Como contamos</summary><p>Reviews e autoanálises concluídas são operações identificadas cujo último resultado técnico é ok no período. Isso não comprova publicação no GitHub. PRs revisados são referências únicas dessas reviews. Execuções incluem falhas, cancelamentos, parciais e descartes. Tentativas com o mesmo ID, aparelho, conta, perfil e tipo são agrupadas; IDs diferentes não são unidos por suposição. Retentativas identificadas não representam necessariamente todas as recuperações históricas. Subagentes já fazem parte do consumo informado pela árvore do provedor e não contam como reviews extras. Modalidade de cobrança só aparece quando registrada na execução; histórico anterior permanece desconhecido. Nenhum destes números altera gates, orçamento ou política de revisão.</p>';
}
