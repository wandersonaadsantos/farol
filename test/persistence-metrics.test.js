import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-persistence-metrics-'));
process.env.FAROL_HOME = home;
process.env.TZ = 'America/Sao_Paulo';
const { writeJsonAtomic } = await import('../lib/io.js');
const { persistenceMetrics } = await import('../lib/persistence-metrics.js');
const usage = (await import('../lib/engine/usage.js')).default;
const { STATE_DIR } = await import('../lib/paths.js');
fs.mkdirSync(STATE_DIR, { recursive: true });
after(() => fs.rmSync(home, { recursive: true, force: true }));
const NativeDate = Date;
function clock(value) {
  let now = NativeDate.parse(value);
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  return { set: next => { now = NativeDate.parse(next); }, restore: () => { globalThis.Date = NativeDate; } };
}
function engine() {
  return { usage: usage.defaultUsage(), usageSessions: usage.defaultSessions(), config: { claudeProfiles: [] },
    falhasSessao: [], pushState() {}, log() {} };
}
const event = cost => ({ usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: cost });

test('gravação real sincroniza o arquivo temporário antes da troca e mantém a ordem de confirmação', () => {
  const file = path.join(home, 'decisions.json'); fs.writeFileSync(file, '{"seq":0}');
  const sync = fs.fsyncSync, rename = fs.renameSync, phases = [];
  let expected = 1, synced = 0;
  fs.fsyncSync = fd => {
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).seq, expected - 1);
    assert.equal(JSON.parse(fs.readFileSync(file + '.tmp', 'utf8')).seq, expected);
    sync(fd); synced = expected; phases.push(`sync-${expected}`);
  };
  fs.renameSync = (from, to) => {
    assert.equal(synced, expected); rename(from, to); phases.push(`commit-${expected}`);
  };
  try {
    writeJsonAtomic(file, { seq: expected }); expected++;
    writeJsonAtomic(file, { seq: expected });
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).seq, 2);
    assert.deepEqual(phases, ['sync-1', 'commit-1', 'sync-2', 'commit-2']);
    assert.equal(fs.existsSync(file + '.tmp'), false);
  } finally { fs.fsyncSync = sync; fs.renameSync = rename; }
});
test('falha de fsync preserva versão confirmada, fecha descritor e permite recuperação posterior', () => {
  const file = path.join(home, 'decisions.json'), sync = fs.fsyncSync;
  fs.writeFileSync(file, '{"seq":10}'); let descriptor;
  fs.fsyncSync = fd => { descriptor = fd; throw Object.assign(new Error('fsync indisponível'), { code: 'EIO' }); };
  try {
    assert.throws(() => writeJsonAtomic(file, { seq: 11 }), /fsync indisponível/);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).seq, 10);
    assert.throws(() => fs.fstatSync(descriptor), { code: 'EBADF' });
    assert.equal(persistenceMetrics().writes.at(-1).ok, false);
  } finally { fs.fsyncSync = sync; }
  writeJsonAtomic(file, { seq: 12 });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).seq, 12);
  assert.equal(persistenceMetrics().writes.at(-1).ok, true);
});
test('métricas têm fases reais, bytes UTF-8 e janela limitada, sem conteúdo ou caminho pessoal', () => {
  const file = path.join(home, 'usage.json');
  const payload = { texto: 'ação 😀', privado: 'conteudo-que-nao-deve-ir-para-metricas' };
  writeJsonAtomic(file, payload);
  const metric = persistenceMetrics().writes.at(-1);
  assert.equal(metric.file, 'usage.json'); assert.equal(metric.bytes, fs.statSync(file).size);
  for (const field of ['serializeMs', 'writeMs', 'fsyncMs', 'totalMs']) assert.ok(metric[field] >= 0);
  assert.ok(metric.totalMs >= metric.writeMs + metric.fsyncMs);
  const text = JSON.stringify(persistenceMetrics());
  assert.equal(text.includes(home), false); assert.equal(text.includes(payload.privado), false);
  for (let i = 0; i < 70; i++) writeJsonAtomic(file, { seq: i });
  const writes = persistenceMetrics().writes;
  assert.equal(writes.length, 64); assert.ok(writes.every(w => w.file === 'usage.json' && w.ok));
  const before = JSON.stringify(writes);
  writeJsonAtomic(path.join(home, 'config-privada.json'), payload);
  assert.equal(JSON.stringify(persistenceMetrics().writes), before);
});
test('falha de serialização não altera registro confirmado nem é registrada como sucesso', () => {
  const file = path.join(home, 'decisions.json'), payload = {}; payload.circular = payload;
  fs.writeFileSync(file, '{"preservado":true}');
  assert.throws(() => writeJsonAtomic(file, payload), /circular/i);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { preservado: true });
  assert.equal(persistenceMetrics().writes.at(-1).ok, false);
});
test('novo consumo e correção do desfecho invalidam histórico e auditoria sem perder gasto', () => {
  const e = engine();
  usage.recordUsage(e, 'a1', 'fixture', event(2), 'claude-opus-4-8', 'p1', 'org/repo#1');
  const first = usage.usageSummary(e);
  assert.equal(first.auditoria.util.costUsd, 2);
  usage.marcarDesfecho(e, 'a1', 'descartada');
  const changed = usage.usageSummary(e);
  assert.equal(changed.auditoria.util.costUsd, 0); assert.equal(changed.auditoria.perdido.costUsd, 2);
  assert.equal(changed.totals.costUsd, 2); assert.equal(changed.recentSessions[0].status, 'descartada');
  assert.equal(JSON.parse(fs.readFileSync(usage.SESSIONS_FILE, 'utf8')).sessions[0].status, 'descartada');
  usage.recordUsage(e, 'a2', 'fixture', event(3), 'claude-opus-4-8', 'p1', 'org/repo#2');
  const next = usage.usageSummary(e);
  assert.equal(next.totals.costUsd, 5); assert.equal(next.recentSessions.length, 2); assert.equal(next.auditoria.util.costUsd, 3);
});
test('API pública applyUsage invalida séries mesmo antes de uma gravação por engine', () => {
  const e = engine(); usage.usageSummary(e);
  usage.applyUsage(e.usage, usage.localDay(), 'review', 'fixture', 'claude-opus-4-8', usage.extractUsage(event(2), 'claude-opus-4-8'));
  const summary = usage.usageSummary(e);
  assert.equal(summary.series.length, 1); assert.equal(summary.series[0].sessions, 1);
  assert.equal(summary.stackedSeries.byKind[0].items.find(i => i.name === 'review').costUsd, 2);
});
test('virada do dia e alterações de orçamento não congelam no cache histórico', () => {
  const time = clock('2026-10-24T23:59:00-03:00');
  try {
    const e = engine(); e.config.claudeProfiles = [{ id: 'p1', kind: 'apikey', label: 'Primeiro', budgetDaily: 1 }];
    usage.recordUsage(e, 'a1', 'fixture', event(2), 'claude-opus-4-8', 'p1');
    const before = usage.usageSummary(e); assert.equal(before.budgets[0].blocked, true); assert.equal(before.budgets[0].today, 2);
    time.set('2026-10-25T00:01:00-03:00');
    const after = usage.usageSummary(e); assert.equal(after.budgets[0].today, 0);
    assert.equal(after.series, before.series, 'histórico é reutilizado sem congelar o orçamento dinâmico');
    e.config.claudeProfiles[0].budgetDates = { '2026-10-25': 0 };
    e.config.claudeProfiles[0].label = 'Alterado';
    const capped = usage.usageSummary(e); assert.equal(capped.budgets[0].blocked, true); assert.equal(capped.budgets[0].capHoje, 0);
    assert.equal(capped.budgets[0].label, 'Alterado'); assert.equal(capped.budgets[0].capOrigem, 'data');
    e.config.claudeProfiles[0].budgetDates['2026-10-25'] = 10;
    assert.equal(usage.usageSummary(e).budgets[0].blocked, false);
  } finally { time.restore(); }
});
test('falhas das sessões continuam atuais mesmo com séries históricas reaproveitadas', () => {
  const e = engine(); usage.recordUsage(e, 'a1', 'fixture', event(1), 'claude-opus-4-8');
  const before = usage.usageSummary(e); assert.equal(before.falhasPorSessao.a1, undefined);
  e.falhasSessao.push({ sessionId: 'a1', at: Date.now(), classe: 'fixture', motivo: 'Falha nova.' });
  const after = usage.usageSummary(e);
  assert.equal(after.falhasPorSessao.a1.motivo, 'Falha nova.'); assert.equal(after.series, before.series);
});
