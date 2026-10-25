// O result.usage cobre só o coordenador; modelUsage cobre a árvore inteira.
// Os totais restaurados por --resume exigem um cursor por sessão e identidade.
const FIELDS = ['inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens'];
const MAP = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];

function object(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function valid(v) { return typeof v === 'number' && Number.isFinite(v) && v >= 0; }
function sessionId(ev) { return typeof ev.session_id === 'string' && ev.session_id.length <= 200 ? ev.session_id : ''; }
function token(v) { return Number.isSafeInteger(v) && v >= 0; }

function modelSnapshot(raw) {
  if (!object(raw) || !Object.keys(raw).length || Object.keys(raw).length > 50) return null;
  const entries = Object.entries(raw);
  if (entries.some(([name, u]) => !name || name.length > 200 || !object(u) || FIELDS.some(k => !token(u[k])))) return null;
  if (FIELDS.some(k => !token(entries.reduce((n, [, u]) => n + u[k], 0)))) return null;
  return Object.fromEntries(entries.map(([name, u]) => [name, normalizeModel(u)]));
}

function normalizeModel(u) {
  const thinking = valid(u.thinkingTokens) ? u.thinkingTokens : 0;
  const cost = valid(u.costUSD) ? u.costUSD : null;
  return { ...Object.fromEntries(FIELDS.map(k => [k, u[k]])), thinkingTokens: thinking, costUSD: cost };
}

function sumModels(models) {
  return Object.fromEntries(MAP.map((field, i) => [field,
    Object.values(models).reduce((n, u) => n + u[FIELDS[i]], 0)]));
}

function priorFor(rows, identity, sid) {
  return rows.findLast(r => r.account === identity.account && (r.profileId || '') === identity.profileId
    && r.accounting?.sessionId === sid);
}

function difference(current, previous) {
  const entries = Object.entries(current).map(([name, u]) => [name, deltaModel(u, Object.hasOwn(previous, name) ? previous[name] : null)]);
  const missing = Object.keys(previous).some(name => !current[name]);
  if (missing || entries.some(([, u]) => !u)) return null;
  return Object.fromEntries(entries);
}

function deltaModel(u, old) {
  if (!old) return u;
  if (FIELDS.some(k => u[k] < old[k]) || (valid(old.costUSD) && (!valid(u.costUSD) || u.costUSD < old.costUSD))) return null;
  const delta = Object.fromEntries(FIELDS.map(k => [k, u[k] - old[k]]));
  return { ...delta, thinkingTokens: Math.max(0, u.thinkingTokens - old.thinkingTokens),
    costUSD: valid(u.costUSD) && valid(old.costUSD) ? u.costUSD - old.costUSD : null };
}

function uncertain(ev, accounting, reason) {
  // Só o uso do turno principal é conhecido quando falta um cursor confiável.
  // Zero numérico é acompanhado da marca desconhecido, nunca vendido como economia.
  return { ...ev, total_cost_usd: 0, farol_custo_desconhecido: true,
    farol_accounting: { ...accounting, source: 'result.usage', scope: 'main-turn', reason } };
}

function invalidCursor(ev, accounting, reason) {
  // Observação bruta é diagnóstico, não uma base utilizável na próxima retomada.
  return uncertain(ev, { ...accounting, observedSnapshot: accounting.snapshot, snapshot: null }, reason);
}

function accountResult(ev, rows, identity) {
  const models = modelSnapshot(ev.modelUsage);
  const sid = sessionId(ev);
  const accounting = { version: 1, sessionId: sid, source: 'result.usage', scope: 'main-turn' };
  if (ev.farol_parcial || ev.farol_interrompida) {
    return { ...ev, farol_accounting: { ...accounting, source: 'stream', scope: 'partial' } };
  }
  if (!models) return legacyResult(ev, rows, identity, accounting);
  const snapshot = { models, costUsd: valid(ev.total_cost_usd) ? ev.total_cost_usd : null };
  const meta = { ...accounting, source: 'result.modelUsage', scope: 'tree', snapshot };
  const prior = sid ? priorFor(rows, identity, sid) : null;
  if (!valid(snapshot.costUsd)) return invalidCursor(ev, meta, 'cost-total-unavailable');
  if (snapshot.costUsd === 0 && (prior || ev.is_error || Object.values(models).some(m => m.costUSD > 0))) return invalidCursor(ev, meta, 'cost-total-zeroed');
  if (!sid && ev.farol_resumed) return uncertain(ev, meta, 'missing-session-id');
  if (ev.farol_resumed && !prior?.accounting?.snapshot) return uncertain(ev, meta, 'missing-baseline');
  if (prior && !prior.accounting?.snapshot) return uncertain(ev, meta, 'partial-baseline');
  const previous = prior?.accounting?.snapshot;
  const previousModels = previous && modelSnapshot(previous.models);
  if (previous && !previousModels) return uncertain(ev, meta, 'invalid-baseline');
  const baseline = previous ? { ...previous, models: previousModels } : null;
  return completeResult(ev, meta, models, baseline);
}

function legacyResult(ev, rows, identity, accounting) {
  // Outros provedores mantêm seu contrato; uma retomada Claude sem total por modelo
  // não oferece os dados necessários para separar o gasto restaurado do gasto novo.
  if (ev.farol_resumed) return uncertain(ev, accounting, 'model-totals-unavailable');
  const prior = accounting.sessionId && priorFor(rows, identity, accounting.sessionId);
  if (prior && ev.farol_provider === 'claude') return uncertain(ev, accounting, 'model-totals-unavailable');
  return { ...ev, farol_accounting: accounting };
}

function completeResult(ev, meta, models, prior) {
  const total = meta.snapshot.costUsd;
  const delta = prior ? difference(models, prior.models) : models;
  if (!delta) return invalidCursor(ev, meta, 'cumulative-counters-regressed');
  if (prior && valid(prior.costUsd) && total < prior.costUsd) return invalidCursor(ev, meta, 'cost-total-unavailable');
  if (prior && !valid(prior.costUsd)) return uncertain(ev, meta, 'invalid-baseline');
  const cost = prior ? total - prior.costUsd : total;
  const thinking = Object.values(delta).reduce((n, u) => n + u.thinkingTokens, 0);
  return { ...ev, usage: { ...sumModels(delta), thinking_tokens: thinking }, total_cost_usd: cost,
    farol_model_usage: delta, farol_accounting: { ...meta, scope: prior ? 'tree-delta' : 'tree' } };
}

function modelBuckets(ev, u, model) {
  const models = ev.farol_model_usage;
  if (!models) return [[model, u]];
  const cost = Object.values(models).reduce((n, m) => n + (m.costUSD || 0), 0);
  const reconciled = Object.values(models).every(m => valid(m.costUSD)) && Math.abs(cost - u.costUsd) < 0.000001;
  const active = Object.entries(models).filter(([, m]) => FIELDS.some(k => m[k] > 0) || m.costUSD > 0);
  const buckets = active.map(([name, m]) => [name, {
    inputTokens: m.inputTokens, outputTokens: m.outputTokens, cacheReadTokens: m.cacheReadInputTokens,
    cacheCreationTokens: m.cacheCreationInputTokens, costUsd: reconciled ? m.costUSD : 0,
  }]);
  if (!reconciled) buckets.push(['', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: u.costUsd }]);
  return buckets;
}

function extractUsage(resultEvent, model) {
  const us = (resultEvent && resultEvent.usage) || {};
  return {
    inputTokens: Number(us.input_tokens) || 0,
    outputTokens: Number(us.output_tokens) || 0,
    cacheReadTokens: Number(us.cache_read_input_tokens) || 0,
    cacheCreationTokens: Number(us.cache_creation_input_tokens) || 0,
    // Raciocínio é metadado, já incluído na saída quando vem dos totais Claude.
    thinkingTokens: Number(us.thinking_tokens) || 0,
    costUsd: Number(resultEvent && resultEvent.total_cost_usd) || 0,
    model: model || ''
  };
}

export { accountResult, modelBuckets, extractUsage };
