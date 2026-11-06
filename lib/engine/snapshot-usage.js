// Projeção do consumo para a tela, sem alterar a contabilidade nem a retenção.
// Os gráficos aceitam zero ausente, mas precisam de todos os itens na mesma
// ordem para associar valores, nomes e cores. O diário completo é lido por /api/usage.
const CAMPOS_NUMERICOS = new Set([
  'sessions', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'costUsd',
]);
const CAMPOS_DA_SESSAO = [
  'id', 'at', 'day', 'kind', 'ref', 'account', 'profileId', 'model', 'farol',
  'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens',
  'costUsd', 'costSource', 'status', 'provider', 'billingKind',
];
const cache = new WeakMap();

function compacto(bucket) {
  return Object.fromEntries(Object.entries(bucket).filter(([key, value]) => !CAMPOS_NUMERICOS.has(key) || value !== 0));
}

function sessaoParaTela(session) {
  return Object.fromEntries(CAMPOS_DA_SESSAO.filter(key => Object.hasOwn(session, key)).map(key => [key, session[key]]));
}

function compactarSeries(summary) {
  const stackedSeries = Object.fromEntries(Object.entries(summary.stackedSeries || {}).map(([key, series]) => [key,
    series.map(day => ({ day: day.day, items: day.items.map(compacto) })),
  ]));
  const matrixSeries = (summary.matrixSeries || []).map(day => ({ day: day.day,
    cells: Object.fromEntries(Object.entries(day.cells).map(([kind, row]) => [kind,
      Object.fromEntries(Object.entries(row).map(([model, bucket]) => [model, compacto(bucket)])),
    ])),
  }));
  return { series: summary.series.map(compacto), stackedSeries, matrixSeries,
    recentSessions: (summary.recentSessions || []).map(sessaoParaTela) };
}

function snapshotUsage(summary) {
  if (!Array.isArray(summary?.series)) return summary;
  const anterior = cache.get(summary.series);
  const mesmasFontes = anterior && anterior.stacked === summary.stackedSeries
    && anterior.matrix === summary.matrixSeries && anterior.sessions === summary.recentSessions;
  const compacto = mesmasFontes ? anterior.value : compactarSeries(summary);
  if (!mesmasFontes) cache.set(summary.series, { stacked: summary.stackedSeries,
    matrix: summary.matrixSeries, sessions: summary.recentSessions, value: compacto });
  // Orçamento e falhas são vivos: não podem congelar junto com as séries.
  return { ...summary, ...compacto };
}

export { snapshotUsage };
