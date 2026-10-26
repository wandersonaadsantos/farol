import test from 'node:test';
import assert from 'node:assert/strict';
import { activityReport } from '../lib/usage/report.js';
import { usageActivity } from '../lib/engine/usage-activity.js';
import { activityBodyHtml, activityHistoryHtml } from '../ui/pure/consumo-atividade.js';
import { accountHash } from '../lib/sync/keys.js';

const NOW = Date.parse('2026-10-26T16:00:00Z');
const query = { start: '2026-10-01', end: '2026-10-26' };
const row = (extra = {}) => ({ id: 'review-1', at: NOW, kind: 'review', account: 'dev', profileId: 'p',
  ref: 'org/repo#1', model: 'Opus', status: 'ok', inputTokens: 10, outputTokens: 5,
  cacheReadTokens: 100, cacheCreationTokens: 20, costUsd: 1, costSource: 'medido', ...extra });
const report = (rows, filters = {}) => activityReport([{ device: 'local', rows }], { ...query, ...filters }, NOW);

test('soma todas as tentativas, mas conclusão e PR único não duplicam', () => {
  const r = report([row({ at: NOW - 1000, status: 'erro', attemptId: 'a' }), row({ attemptId: 'b' }), row({ id: 'review-2' })]);
  assert.equal(r.totals.attempts, 3);
  assert.deepEqual(r.completed, { reviews: 2, self: 0, prs: 1 });
  assert.equal(r.retries, 1);
  assert.equal(r.history.total, 2);
  assert.equal(r.totals.inputTokens + r.totals.outputTokens, 45);
  assert.equal(r.totals.cacheReadTokens + r.totals.cacheCreationTokens, 360);
});

test('identidade separa aparelho, conta, perfil e tipo; subagentes não viram reviews', () => {
  const rows = [row(), row({ account: 'other' }), row({ profileId: 'other' }), row({ kind: 'self' }), row({ modelUsage: { subagent: {} }, id: 'review-2' })];
  const r = activityReport([{ device: 'one', rows }, { device: 'two', rows: [row()] }], query, NOW);
  assert.equal(r.history.total, 6);
  assert.equal(r.completed.reviews, 5);
  assert.equal(r.completed.self, 1);
});

test('desfecho desconhecido, descartado ou legado sem ID não vira conclusão', () => {
  const r = report([row({ id: null }), row({ id: 'other', status: 'futuro' }), row({ id: 'discard', status: 'descartada' })]);
  assert.equal(r.completed.reviews, 0);
  assert.equal(r.unidentified, 1);
  assert.equal(r.totals.attempts, 3);
  assert.equal(r.totals.desconhecido, 1);
});

test('não deduplica gasto por ID de operação; deduplica o mesmo attemptId', () => {
  const r = report([row({ attemptId: 'a' }), row({ attemptId: 'a' }), row({ attemptId: 'b' })]);
  assert.equal(r.totals.attempts, 2);
  assert.equal(r.totals.costUsd, 2);
});

test('uso de subagentes aparece no modelo que consumiu, sem criar execuções extras', () => {
  const r = report([row({ modelUsage: { primary: { inputTokens: 6, outputTokens: 2 }, secondary: { inputTokens: 4, outputTokens: 3 } } })]);
  assert.equal(r.totals.attempts, 1);
  assert.equal(r.completed.reviews, 1);
  assert.equal(r.models.length, 2);
  assert.deepEqual(r.models.map(m => m.inputTokens + m.outputTokens).sort(), [7, 8]);
  const aliases = report([row({ modelUsage: { 'claude-opus-5-5-20261001': { inputTokens: 6, outputTokens: 2 }, 'claude-opus-5-5-20261002': { inputTokens: 4, outputTokens: 3 } } })]);
  assert.equal(aliases.models.length, 1);
  assert.equal(aliases.models[0].attempts, 1);
});

test('conclusão é do último resultado, mesmo ao filtrar modelo ou datas anteriores', () => {
  const rows = [row({ at: Date.parse('2026-10-20T15:00:00Z'), model: 'first' }), row({ model: 'last', status: 'erro' })];
  assert.equal(report(rows, { model: 'first' }).completed.reviews, 0);
  assert.equal(report(rows, { end: '2026-10-20', focus: 'review' }).history.total, 0);
  assert.equal(report(rows, { end: '2026-10-20' }).totals.attempts, 1);
});

test('custo e modalidade desconhecidos não viram fatura nem economia', () => {
  const r = report([row(), row({ id: 'api', billingKind: 'apikey', costSource: 'estimado', costUsd: 2 }), row({ id: 'unknown', billingKind: 'apikey', costSource: 'desconhecido', costUsd: 0 })]);
  assert.equal(r.totals.apiUsd, 2);
  assert.equal(r.totals.apiEstimatedUsd, 2);
  assert.equal(r.totals.apiUnknown, 1);
  assert.equal(r.totals.unknownBilling, 1);
  assert.match(activityBodyHtml(r), /sem modalidade histórica/);
  const kinds = report([row({ billingKind: 'dir' }), row({ id: 'machine', billingKind: 'maquina' }), row({ id: 'router', billingKind: 'openrouter' })]);
  assert.equal(kinds.totals.subscription, 2);
  assert.equal(kinds.totals.apiUsd, 1);
});

test('intervalos inválidos são recusados e vazio conhecido é zero', () => {
  for (const start of ['', '2026-99-99', '2026-02-30', '2027-01-01']) assert.equal(report([], { start }).ok, false);
  assert.equal(report([]).totals.attempts, 0);
  assert.match(activityBodyHtml({ ok: false }), /indisponíveis/);
});

test('diário ausente com agregado positivo não é apresentado como consumo zero', async () => {
  const r = await usageActivity({ usage: { totals: { sessions: 10 } }, usageSessions: { sessions: [] } }, new URLSearchParams());
  assert.equal(r.ok, false);
  assert.match(r.motivo, /diário detalhado não está disponível/);
});

test('o recorte usa o diário completo, não só as 100 sessões mais recentes', () => {
  const rows = Array.from({ length: 150 }, (_, i) => row({ id: `review-${i}`, ref: `org/repo#${i}` }));
  assert.equal(report(rows).completed.reviews, 150);
  const r = report(rows, { page: 999 });
  assert.equal(r.history.page, 18);
  assert.equal(r.history.rows.length, 6);
  assert.equal(report(rows, { repo: 'other/repo' }).totals.attempts, 0);
});

test('a projeção pública não expõe cursores, snapshots ou campos extras e escapa HTML', () => {
  const r = report([row({ ref: '<img src=x onerror=alert(1)>', accounting: { secret: 'private' }, apiKey: 'private' })]);
  assert.equal(r.history.rows[0].accounting, undefined);
  assert.equal(r.history.rows[0].apiKey, undefined);
  assert.doesNotMatch(activityHistoryHtml(r), /<img/);
  assert.match(activityHistoryHtml(r), /&lt;img/);
});

test('consulta consolidada usa somente uid configurado e filtra conta pelo hash existente', async () => {
  const paths = [];
  const event = row({ id: undefined, localId: 'r', account: undefined, accountHash: accountHash('dev'), ref: undefined, refHash: 'hash' });
  const engine = { config: { sync: { enabled: true, consolidation: { enabled: true } } }, sync: { uid: 'owner', deviceId: 'd', status: 'conectado', client: {
    get: async path => { paths.push(path); return { ok: true, data: path.endsWith('usageEvents') ? { d: { e: event } } : {} }; },
  } } };
  const response = await usageActivity(engine, new URLSearchParams({ scope: 'all', account: 'dev', start: '2026-10-01', end: '2026-10-26' }));
  assert.equal(response.ok, true);
  assert.equal(response.totals.attempts, 1);
  assert.deepEqual(paths.sort(), ['/users/owner/devices', '/users/owner/usageEvents']);
  assert.equal((await usageActivity({}, new URLSearchParams('scope=all'))).ok, false);
});

test('troca de identidade durante a consulta não entrega o histórico do usuário anterior', async () => {
  const engine = { config: { sync: { enabled: true, consolidation: { enabled: true } } }, sync: { uid: 'before', status: 'conectado', client: {
    get: async () => { engine.sync.uid = 'after'; return { ok: true, data: {} }; },
  } } };
  const response = await usageActivity(engine, new URLSearchParams('scope=all'));
  assert.equal(response.ok, false);
});
