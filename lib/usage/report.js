import { ACTIVITY_KINDS, activityRows, activityOptions, activityRange, activityDay, groupActivity, matchesActivity } from './activity.js';

const UNKNOWN_COST = new Set(['desconhecido', 'sem-base']);
const FIELDS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens'];
const zero = () => ({ attempts: 0, ok: 0, erro: 0, cancelada: 0, interrompida: 0, parcial: 0, descartada: 0, desconhecido: 0,
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
  costUsd: 0, estimatedUsd: 0, unknownCost: 0, apiUsd: 0, apiEstimatedUsd: 0, apiUnknown: 0, subscription: 0, unknownBilling: 0 });

function add(bucket, row) {
  bucket.attempts++;
  bucket[row.status]++;
  for (const field of FIELDS) bucket[field] += row[field];
  if (UNKNOWN_COST.has(row.costSource)) bucket.unknownCost++;
  else bucket.costUsd += row.costUsd;
  if (row.costSource === 'estimado') bucket.estimatedUsd += row.costUsd;
  if (['assinatura', 'dir', 'maquina', 'codex', 'agy'].includes(row.billing)) bucket.subscription++;
  else if (['apikey', 'openrouter'].includes(row.billing)) addApi(bucket, row);
  else bucket.unknownBilling++;
}

function addApi(bucket, row) {
  if (UNKNOWN_COST.has(row.costSource)) bucket.apiUnknown++;
  else bucket.apiUsd += row.costUsd;
  if (row.costSource === 'estimado') bucket.apiEstimatedUsd += row.costUsd;
}

function aggregate(rows, field) {
  const map = new Map();
  for (const row of rows) {
    const key = row[field];
    if (!map.has(key)) map.set(key, zero());
    add(map.get(key), row);
  }
  return [...map].map(([name, values]) => ({ name, ...values }));
}

function aggregateModels(rows) {
  const map = new Map();
  for (const row of rows) {
    const parts = row.modelParts.length ? row.modelParts : [{ model: row.model, inputTokens: row.inputTokens, outputTokens: row.outputTokens }];
    const counted = new Set();
    for (const part of parts) {
      if (!map.has(part.model)) map.set(part.model, { name: part.model, attempts: 0, inputTokens: 0, outputTokens: 0 });
      const bucket = map.get(part.model);
      if (!counted.has(part.model)) bucket.attempts++;
      counted.add(part.model);
      bucket.inputTokens += part.inputTokens; bucket.outputTokens += part.outputTokens;
    }
  }
  return [...map.values()];
}

function historyOf(groups, query) {
  let rows = groups;
  if (query.focus === 'review' || query.focus === 'self') rows = rows.filter(r => r.completedInRange && r.kind === query.focus);
  if (query.focus === 'pr') {
    const seen = new Set();
    rows = rows.filter(r => {
      if (!r.completedInRange || r.kind !== 'review' || !r.pr || seen.has(r.pr)) return false;
      seen.add(r.pr); return true;
    });
  }
  const search = String(query.search || '').toLocaleLowerCase().slice(0, 200);
  rows = rows.filter(r => `${r.ref} ${r.kind} ${r.model}`.toLocaleLowerCase().includes(search));
  const pages = Math.max(1, Math.ceil(rows.length / 8));
  const page = Math.min(Math.max(0, Math.floor(Number(query.page) || 0)), pages - 1);
  return { total: rows.length, page, pages, rows: rows.slice(page * 8, page * 8 + 8) };
}

// Agrupa antes de filtrar: uma retomada conserva a identidade; seu consumo pertence
// ao dia em que ocorreu, e a conclusão ao último resultado da operação.
export function activityReport(sources, query = {}, now = Date.now()) {
  const range = activityRange(query, now);
  if (!range.valid) return { ok: false, motivo: 'Selecione um intervalo válido, sem datas futuras.' };
  const all = activityRows(sources);
  const selected = all.filter(row => matchesActivity(row, query));
  const inRange = row => row.day >= range.start && row.day <= range.end;
  const attempts = selected.filter(inRange);
  const groups = groupActivity(all).filter(row => row.attempts.some(a => inRange(a) && matchesActivity(a, query))).sort((a, b) => b.at - a.at);
  for (const row of groups) row.completedInRange = row.identified && row.status === 'ok' && inRange(row) && matchesActivity(row, query);
  const completed = groups.filter(row => row.completedInRange);
  const reviews = completed.filter(row => row.kind === 'review');
  const totals = zero(); attempts.forEach(row => add(totals, row));
  const byKind = ACTIVITY_KINDS.map(name => ({ name, ...zero() }));
  for (const row of attempts) add(byKind.find(bucket => bucket.name === row.kind), row);
  const since = all.reduce((earliest, row) => Math.min(earliest, row.at), Infinity);
  return {
    ok: true, range, options: activityOptions(all), totals, byKind,
    completed: { reviews: reviews.length, self: completed.filter(r => r.kind === 'self').length,
      prs: new Set(reviews.map(r => r.pr).filter(Boolean)).size },
    retries: groups.reduce((n, row) => n + Math.max(0, row.attempts.filter(a => inRange(a) && matchesActivity(a, query)).length - 1), 0),
    unidentified: attempts.filter(row => !row.identified).length,
    since: Number.isFinite(since) ? since : null, sinceDay: activityDay(since), series: aggregate(attempts, 'day'), models: aggregateModels(attempts),
    history: historyOf(groups, query),
  };
}
