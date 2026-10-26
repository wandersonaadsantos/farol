import { activityReport } from '../usage/report.js';
import { readUsageSource } from './sync-usage.js';
import { accountHash } from '../sync/keys.js';
import { activityRange } from '../usage/activity.js';

// Rota de leitura sob demanda: o diário inteiro não vai no SSE a cada push.
export async function usageActivity(engine, params) {
  const query = Object.fromEntries(params);
  if (!activityRange(query).valid) return { ok: false, motivo: 'Selecione um intervalo válido, sem datas futuras.' };
  if (query.scope === 'all') {
    const source = await readUsageSource(engine);
    if (!source.ok) return { ok: false, motivo: source.motivo || 'Consolidação indisponível.' };
    if (query.account && query.account !== 'all' && !/^[0-9a-f]{64}$/.test(query.account)) query.account = accountHash(query.account);
    const sources = Object.entries(source.eventos || {}).map(([device, rows]) => ({ device, rows: Object.values(rows || {}) }));
    return { ...activityReport(sources, query), remote: true };
  }
  const rows = engine.usageSessions?.sessions || [];
  const expected = Number(engine.usage?.totals?.sessions) || 0;
  if (!rows.length && expected > 0) return { ok: false, motivo: 'O agregado tem consumo, mas o diário detalhado não está disponível. Consulte os totais gerais na seção avançada.' };
  return { ...activityReport([{ device: 'local', rows }], query), incomplete: rows.length < expected };
}
