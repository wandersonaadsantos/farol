import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-snapshot-payload-'));
process.env.FAROL_HOME = home;
const { Engine } = await import('../server.js');
const usage = await import('../lib/engine/usage.js');
const { snapshotUsage } = await import('../lib/engine/snapshot-usage.js');
const { snapshotReviewActions } = await import('../lib/engine/snapshot-decisions.js');
const { usageKpisHtml, usageMatrixHtml, usageSessionsHtml, usageMetricVal } = await import('../ui/pure/consumo.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));

function consumoSintetico() {
  const e = { usage: usage.defaultUsage(), usageSessions: { sessions: [] }, config: { claudeProfiles: [] } };
  const now = new Date();
  const measured = usage.extractUsage({ usage: { input_tokens: 100, output_tokens: 20 }, total_cost_usd: .5 }, 'modelo-0');
  for (let i = 119; i >= 0; i--) {
    const day = usage.localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
    usage.applyUsage(e.usage, day, 'review', 'fixture', `modelo-${i % 12}`, measured, 'perfil');
    e.usageSessions.sessions.push({ id: `a-${i}`, at: now.getTime() - i * 86400000,
      day, kind: 'review', ref: `fixture/app#${i}`, model: `modelo-${i % 12}`, farol: 'fixture',
      inputTokens: 100, outputTokens: 20, costUsd: .5, costSource: 'medido', status: 'ok',
      modelUsage: { principal: { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 0 } },
      accounting: { source: 'fixture', sessionId: `a-${i}`, internal: 'metadado interno da contabilidade' } });
  }
  return e;
}

test('snapshot conserva gráficos, sessões e orçamento, com menos bytes e sem podar o diário', t => {
  const e = consumoSintetico();
  const antes = structuredClone({ usage: e.usage, sessions: e.usageSessions });
  const completo = usage.usageSummary(e);
  const compacto = snapshotUsage(completo);
  assert.equal(compacto.totals, completo.totals);
  assert.equal(compacto.auditoria, completo.auditoria);
  assert.equal(compacto.budgets, completo.budgets);
  assert.equal(compacto.retentionDays, completo.retentionDays);
  assert.equal(compacto.recentSessions.length, 100);
  assert.equal(compacto.series.length, 120);
  assert.equal('modelUsage' in compacto.recentSessions[0], false);
  assert.equal('accounting' in compacto.recentSessions[0], false);
  for (const window of [1, 7, 30, 90]) {
    assert.equal(usageKpisHtml(compacto, window), usageKpisHtml(completo, window));
    for (const metric of ['input', 'output', 'total', 'cache', 'custo']) {
      assert.deepEqual(usageMatrixHtml(compacto, metric, window), usageMatrixHtml(completo, metric, window));
    }
  }
  assert.equal(usageSessionsHtml(compacto), usageSessionsHtml(completo));
  for (const [dimension, series] of Object.entries(completo.stackedSeries)) {
    assert.deepEqual(compacto.stackedSeries[dimension].map(d => d.items.map(i => [i.name, i.label])),
      series.map(d => d.items.map(i => [i.name, i.label])), 'cores e índices continuam associados');
    for (const metric of ['input', 'output', 'total', 'cache', 'custo']) {
      assert.deepEqual(compacto.stackedSeries[dimension].map(d => d.items.map(i => usageMetricVal(i, metric))),
        series.map(d => d.items.map(i => usageMetricVal(i, metric))));
    }
  }
  assert.deepEqual({ usage: e.usage, sessions: e.usageSessions }, antes);
  const bytesAntes = Buffer.byteLength(JSON.stringify(completo));
  const bytesDepois = Buffer.byteLength(JSON.stringify(compacto));
  assert.ok(bytesDepois < bytesAntes * .5, `${bytesAntes} -> ${bytesDepois}`);
  t.diagnostic(`Consumo sintético, 120 dias: ${bytesAntes} -> ${bytesDepois} bytes; diário e renderização preservados.`);
});

test('cache compacto reutiliza séries, mas atualiza orçamento, falhas e novos registros', () => {
  const e = consumoSintetico();
  const original = usage.usageSummary(e);
  const first = snapshotUsage(original);
  const novoOrcamento = [{ id: 'perfil', blocked: true, today: 1, capHoje: 1 }];
  const novasFalhas = { 'a-0': { motivo: 'falha posterior' } };
  const next = snapshotUsage({ ...original, budgets: novoOrcamento, falhasPorSessao: novasFalhas });
  assert.equal(next.series, first.series);
  assert.equal(next.budgets, novoOrcamento);
  assert.equal(next.falhasPorSessao, novasFalhas);
  const trocouSessao = snapshotUsage({ ...original, recentSessions: [{ ...original.recentSessions[0], status: 'descartada' }] });
  assert.equal(trocouSessao.recentSessions[0].status, 'descartada');
  const measured = usage.extractUsage({ usage: { output_tokens: 1 }, total_cost_usd: 1 }, 'modelo-novo');
  usage.applyUsage(e.usage, usage.localDay(), 'review', 'fixture', 'modelo-novo', measured);
  const atualizado = snapshotUsage(usage.usageSummary(e));
  assert.notEqual(atualizado.series, first.series);
  assert.equal(atualizado.series.at(-1).sessions, 2);
  assert.equal(snapshotUsage(null), null);
});

test('API de estado limita ações ao que a tela conhece sem perder revisão antiga ou a pendência atual', t => {
  const e = new Engine();
  e.decisions.resolved = Array.from({ length: 1900 }, (_, i) => ({
    id: `d-${i}`, key: `fixture/app#${i}`, status: 'auto_approved', action: 'approve', resolvedAt: 1900 - i,
  }));
  e.panorama = [{ key: 'fixture/app#700' }];
  e.queue = [{ key: 'fixture/app#800' }];
  e.myPRs = [{ key: 'fixture/app#900' }];
  e.decisions.pending = [{ id: 'p-700', key: 'fixture/app#700', createdAt: 2000, esperaProva: { tentativas: 2 } }];
  const original = structuredClone(e.decisions);
  const inteiro = e.reviewActions();
  const compacto = e.snapshot().reviewActions;
  assert.equal(Object.keys(compacto).length, 33);
  for (const key of Object.keys(compacto)) assert.deepEqual(compacto[key], inteiro[key]);
  assert.equal(compacto['fixture/app#700'].kind, 'pending');
  assert.equal(compacto['fixture/app#700'].esperaProva, true);
  assert.equal(compacto['fixture/app#600'], undefined);
  assert.equal(e.decisionByKey('fixture/app#600').id, 'd-600');
  e.panorama.push({ key: 'fixture/app#600' });
  assert.deepEqual(snapshotReviewActions(e)['fixture/app#600'], inteiro['fixture/app#600']);
  assert.deepEqual(e.decisions, original);
  assert.equal(Object.keys(e.reviewActions()).length, 1900, 'negócio continua consultando o mapa inteiro');
  const bytesAntes = Buffer.byteLength(JSON.stringify(inteiro));
  const bytesDepois = Buffer.byteLength(JSON.stringify(compacto));
  assert.ok(bytesDepois < bytesAntes * .03);
  t.diagnostic(`Ações sintéticas, 1900 chaves e 33 exibidas: ${bytesAntes} -> ${bytesDepois} bytes.`);
});

test('snapshot da Engine aplica a projeção de consumo e mantém os registros para consulta completa', () => {
  const e = new Engine();
  Object.assign(e, consumoSintetico());
  const snapshot = e.snapshot();
  assert.equal('modelUsage' in snapshot.usage.recentSessions[0], false);
  assert.ok(e.usageSessions.sessions.at(-1).modelUsage);
  assert.equal(snapshot.usage.totals.sessions, 120);
});
