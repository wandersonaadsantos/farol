'use strict';
// Cobre a agregação de consumo de tokens (lib/engine/usage.js): parte pura (kindFromId,
// extractUsage, applyUsage) + o resumo. Sem fs, sem sessão real. Runner nativo, ZERO deps.
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-usage-' + process.pid);

const { test } = require('node:test');
const assert = require('node:assert/strict');
const usage = require('../lib/engine/usage');

test('kindFromId deriva o tipo pelo prefixo do id da sessão', () => {
  assert.equal(usage.kindFromId('a7'), 'review');
  assert.equal(usage.kindFromId('s3'), 'self');
  assert.equal(usage.kindFromId('pb2'), 'pushback');
  assert.equal(usage.kindFromId('f1'), 'tool');
  assert.equal(usage.kindFromId('c9'), 'chat');
  assert.equal(usage.kindFromId('t4'), 'outro');
  assert.equal(usage.kindFromId(''), 'outro');
});

test('extractUsage lê os tokens do evento result (0 quando ausente)', () => {
  const ev = { usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 3 }, total_cost_usd: 0.01 };
  const u = usage.extractUsage(ev, 'claude-opus-4-8');
  assert.equal(u.inputTokens, 100);
  assert.equal(u.outputTokens, 20);
  assert.equal(u.cacheReadTokens, 5);
  assert.equal(u.cacheCreationTokens, 3);
  assert.equal(u.costUsd, 0.01);
  assert.equal(u.model, 'claude-opus-4-8');
  const zero = usage.extractUsage({}, '');
  assert.equal(zero.inputTokens, 0);
  assert.equal(zero.outputTokens, 0);
});

test('applyUsage agrega em todos os eixos (totais, dia, tipo, conta, modelo)', () => {
  const store = usage.defaultUsage();
  const u1 = usage.extractUsage({ usage: { input_tokens: 100, output_tokens: 20 }, total_cost_usd: 0.02 }, 'claude-opus-4-8');
  const u2 = usage.extractUsage({ usage: { input_tokens: 50, output_tokens: 10 }, total_cost_usd: 0.01 }, 'claude-sonnet-4-5');
  usage.applyUsage(store, '2026-07-20', 'review', 'trabalho', 'claude-opus-4-8', u1);
  usage.applyUsage(store, '2026-07-21', 'self', 'pessoal', 'claude-sonnet-4-5', u2);

  assert.equal(store.totals.sessions, 2);
  assert.equal(store.totals.inputTokens, 150);
  assert.equal(store.totals.outputTokens, 30);
  assert.equal(Math.round(store.totals.costUsd * 100) / 100, 0.03);
  assert.equal(store.byKind.review.inputTokens, 100);
  assert.equal(store.byKind.self.inputTokens, 50);
  assert.equal(store.byAccount.trabalho.sessions, 1);
  assert.equal(store.byAccount.pessoal.sessions, 1);
  // byModel usa o rótulo amigável (Opus 4.8 / Sonnet 4.5)
  assert.equal(store.byModel['Opus 4.8'].inputTokens, 100);
  assert.equal(store.byModel['Sonnet 4.5'].inputTokens, 50);
  assert.equal(store.days['2026-07-20'].outputTokens, 20);
});

test('usageSummary devolve totais, hoje, 7 dias e quebras ordenadas', () => {
  const today = new Date().toISOString().slice(0, 10);
  const store = usage.defaultUsage();
  const big = usage.extractUsage({ usage: { input_tokens: 1000, output_tokens: 200 } }, 'claude-opus-4-8');
  const small = usage.extractUsage({ usage: { input_tokens: 10, output_tokens: 5 } }, 'claude-opus-4-8');
  usage.applyUsage(store, today, 'review', 'trabalho', 'claude-opus-4-8', big);
  usage.applyUsage(store, today, 'chat', 'trabalho', 'claude-opus-4-8', small);
  usage.applyUsage(store, '2000-01-01', 'tool', 'trabalho', 'claude-opus-4-8', small); // dia velho: fora do 7d

  const sum = usage.usageSummary({ usage: store });
  assert.equal(sum.totals.sessions, 3);
  assert.equal(sum.today.inputTokens, 1010, 'hoje soma as duas sessões de hoje');
  assert.equal(sum.last7.inputTokens, 1010, '7 dias não inclui o dia de 2000');
  // byKind ordenado por outputTokens desc: review (200) antes de chat (5)
  assert.equal(sum.byKind[0].kind, 'review');
  assert.equal(sum.byKind[0].label, 'Revisão');
  assert.ok(sum.byKind[0].outputTokens >= sum.byKind[1].outputTokens);
});
