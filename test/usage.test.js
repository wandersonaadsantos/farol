'use strict';
// Cobre a agregação de consumo de tokens (lib/engine/usage.js): parte pura (kindFromId,
// extractUsage, applyUsage) + o resumo. Sem fs, sem sessão real. Runner nativo, ZERO deps.
const os = require('node:os');
const path = require('node:path');
// o corte de dia é LOCAL (regra do projeto: horário de Brasília, nunca UTC cru);
// sem fixar o fuso o teste passaria numa máquina e falharia noutra
process.env.TZ = 'America/Sao_Paulo';
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

test('localDay corta no dia LOCAL, não no UTC (às 21h de Brasília o dia NÃO vira)', () => {
  // 01:00Z de 02/08 é 22:00 de 01/08 em São Paulo: o bucket é o dia 01
  assert.equal(usage.localDay(new Date(Date.parse('2026-08-02T01:00:00Z'))), '2026-08-01');
  assert.equal(usage.localDay(new Date(Date.parse('2026-08-01T15:00:00Z'))), '2026-08-01');
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

test('applyUsage: profileId opcional cria o bucket byProfileDay com chave composta', () => {
  const store = usage.defaultUsage();
  const u = usage.extractUsage({ usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.01 }, 'claude-opus-4-8');
  usage.applyUsage(store, '2026-08-01', 'review', 'trabalho', 'claude-opus-4-8', u, 'perfil-a');
  assert.ok(store.byProfileDay, 'bucket byProfileDay existe');
  assert.equal(store.byProfileDay['perfil-a|2026-08-01'].inputTokens, 10);
  assert.equal(store.byProfileDay['perfil-a|2026-08-01'].costUsd, 0.01);
});

test('applyUsage: buckets diarios cruzados (kind/model/account/kindxmodel)', () => {
  const store = usage.defaultUsage();
  const u1 = usage.extractUsage({ usage: { input_tokens: 100, output_tokens: 20 }, total_cost_usd: 0.02 }, 'claude-opus-4-8');
  const u2 = usage.extractUsage({ usage: { input_tokens: 50, output_tokens: 10 }, total_cost_usd: 0.01 }, 'claude-sonnet-4-5');
  usage.applyUsage(store, '2026-08-01', 'review', 'trabalho', 'claude-opus-4-8', u1);
  usage.applyUsage(store, '2026-08-01', 'self', 'pessoal', 'claude-sonnet-4-5', u2);

  assert.equal(store.daysByKind['review|2026-08-01'].inputTokens, 100);
  assert.equal(store.daysByKind['self|2026-08-01'].inputTokens, 50);
  assert.equal(store.daysByModel['Opus 4.8|2026-08-01'].inputTokens, 100);
  assert.equal(store.daysByModel['Sonnet 4.5|2026-08-01'].inputTokens, 50);
  assert.equal(store.daysByAccount['trabalho|2026-08-01'].inputTokens, 100);
  assert.equal(store.daysByAccount['pessoal|2026-08-01'].inputTokens, 50);
  assert.equal(store.daysByKindModel['review|Opus 4.8|2026-08-01'].inputTokens, 100);
  assert.equal(store.daysByKindModel['self|Sonnet 4.5|2026-08-01'].inputTokens, 50);
});

test('applyUsage: poda dos buckets cruzados acompanha a poda de days (MAX_DAYS)', () => {
  const store = usage.defaultUsage();
  const u = usage.extractUsage({ usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 }, 'claude-opus-4-8');
  // 125 dias > MAX_DAYS (120): os 5 primeiros devem sumir dos 4 buckets novos tambem
  for (let i = 0; i < 125; i++) {
    const d = new Date(2026, 0, 1 + i);
    const day = d.toISOString().slice(0, 10);
    usage.applyUsage(store, day, 'review', 'trabalho', 'claude-opus-4-8', u);
  }
  const days = Object.keys(store.days).sort();
  assert.equal(days.length, 120);
  const primeiroPodado = '2026-01-01';
  assert.ok(!store.days[primeiroPodado]);
  assert.ok(!store.daysByKind[`review|${primeiroPodado}`], 'daysByKind podado junto');
  assert.ok(!store.daysByModel[`Opus 4.8|${primeiroPodado}`], 'daysByModel podado junto');
  assert.ok(!store.daysByAccount[`trabalho|${primeiroPodado}`], 'daysByAccount podado junto');
  assert.ok(!store.daysByKindModel[`review|Opus 4.8|${primeiroPodado}`], 'daysByKindModel podado junto');
  const ultimoDia = days[days.length - 1];
  assert.ok(store.daysByKind[`review|${ultimoDia}`], 'dia recente permanece');
});

test('applyUsage: sem profileId (perfil dir/legado) não cria entrada em byProfileDay', () => {
  const store = usage.defaultUsage();
  const u = usage.extractUsage({ usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.01 }, 'claude-opus-4-8');
  usage.applyUsage(store, '2026-08-01', 'review', 'trabalho', 'claude-opus-4-8', u);
  assert.deepEqual(store.byProfileDay || {}, {});
});

test('profileSpend: soma hoje e desde a data de corte, sem vazar entre perfis', () => {
  // profileSpend calcula "hoje" pelo dia REAL da máquina (localDay()), não por um
  // parâmetro: fixar '2026-08-04' aqui prendia o teste a uma única data de calendário,
  // que passou a falhar sozinho assim que o dia virou (achado em 05/08/2026).
  const today = usage.localDay();
  const oldDay = '2020-01-01';
  const store = usage.defaultUsage();
  const u1 = usage.extractUsage({ usage: { input_tokens: 10 }, total_cost_usd: 1 }, 'x');
  const u2 = usage.extractUsage({ usage: { input_tokens: 10 }, total_cost_usd: 2 }, 'x');
  const u3 = usage.extractUsage({ usage: { input_tokens: 10 }, total_cost_usd: 5 }, 'x');
  usage.applyUsage(store, oldDay, 'review', 'a', 'x', u1, 'perfil-a'); // dia antigo, perfil A
  usage.applyUsage(store, today, 'review', 'a', 'x', u2, 'perfil-a'); // hoje, perfil A
  usage.applyUsage(store, today, 'review', 'b', 'x', u3, 'perfil-b'); // hoje, perfil B (não pode vazar pro A)
  const spendHoje = usage.profileSpend(store, 'perfil-a', today);
  assert.equal(Math.round(spendHoje.today * 100) / 100, 2, 'hoje soma só o dia de hoje');
  const spendTotal = usage.profileSpend(store, 'perfil-a', oldDay);
  assert.equal(Math.round(spendTotal.sinceCutoff * 100) / 100, 3, 'desde o dia antigo soma os 2 dias do perfil A (1+2), nunca o do B');
});

test('profileSpend: sem data de corte (since undefined) soma TODOS os dias do perfil', () => {
  const store = usage.defaultUsage();
  const u = usage.extractUsage({ usage: { input_tokens: 1 }, total_cost_usd: 1 }, 'x');
  usage.applyUsage(store, '2020-01-01', 'review', 'a', 'x', u, 'perfil-a');
  usage.applyUsage(store, '2026-08-04', 'review', 'a', 'x', u, 'perfil-a');
  const spend = usage.profileSpend(store, 'perfil-a', undefined);
  assert.equal(Math.round(spend.sinceCutoff * 100) / 100, 2);
});

test('profileBudgetStatus: perfil sem teto nenhum nunca bloqueia', () => {
  const store = usage.defaultUsage();
  const profile = { id: 'p1', kind: 'apikey' };
  assert.equal(usage.profileBudgetStatus(profile, store).blocked, false);
});

test('profileBudgetStatus: perfil kind dir nunca bloqueia (não participa de orçamento)', () => {
  const store = usage.defaultUsage();
  const profile = { id: 'p1', dir: 'C:\\x', budgetDaily: 0.01 };
  assert.deepEqual(usage.profileBudgetStatus(profile, store), { blocked: false });
});

test('profileBudgetStatus: estoura teto diário', () => {
  const store = usage.defaultUsage();
  const u = usage.extractUsage({ usage: { input_tokens: 1 }, total_cost_usd: 5 }, 'x');
  usage.applyUsage(store, usage.localDay(), 'review', 'a', 'x', u, 'p1');
  const profile = { id: 'p1', kind: 'apikey', budgetDaily: 3 };
  const status = usage.profileBudgetStatus(profile, store);
  assert.equal(status.blocked, true);
  assert.equal(status.reason, 'diario');
});

test('profileBudgetStatus: estoura teto total (dentro do diário)', () => {
  const store = usage.defaultUsage();
  const u = usage.extractUsage({ usage: { input_tokens: 1 }, total_cost_usd: 5 }, 'x');
  usage.applyUsage(store, usage.localDay(), 'review', 'a', 'x', u, 'p1');
  const profile = { id: 'p1', kind: 'apikey', budgetDaily: 100, budgetTotal: 3, budgetSince: usage.localDay() };
  const status = usage.profileBudgetStatus(profile, store);
  assert.equal(status.blocked, true);
  assert.equal(status.reason, 'total');
});

test('profileBudgetStatus: dentro dos dois tetos não bloqueia', () => {
  const store = usage.defaultUsage();
  const u = usage.extractUsage({ usage: { input_tokens: 1 }, total_cost_usd: 1 }, 'x');
  usage.applyUsage(store, usage.localDay(), 'review', 'a', 'x', u, 'p1');
  const profile = { id: 'p1', kind: 'apikey', budgetDaily: 10, budgetTotal: 10, budgetSince: usage.localDay() };
  const status = usage.profileBudgetStatus(profile, store);
  assert.equal(status.blocked, false);
  assert.equal(Math.round(status.today * 100) / 100, 1);
});

test('profileBreakdown: soma todos os dias por perfil, com label do config e shape de bucket reusável', () => {
  const store = usage.defaultUsage();
  const u1 = usage.extractUsage({ usage: { input_tokens: 10, output_tokens: 2 }, total_cost_usd: 1 }, 'x');
  const u2 = usage.extractUsage({ usage: { input_tokens: 5, output_tokens: 1 }, total_cost_usd: 0.5 }, 'x');
  usage.applyUsage(store, '2026-08-01', 'review', 'a', 'x', u1, 'p1');
  usage.applyUsage(store, '2026-08-02', 'review', 'a', 'x', u2, 'p1');
  const profiles = [{ id: 'p1', label: 'OpenRouter Pessoal', kind: 'apikey' }];
  const out = usage.profileBreakdown(store, profiles);
  assert.equal(out.length, 1);
  assert.equal(out[0].profileId, 'p1');
  assert.equal(out[0].label, 'OpenRouter Pessoal');
  assert.equal(out[0].inputTokens, 15);
  assert.equal(out[0].sessions, 2);
});

test('profileBreakdown: perfil removido do config ainda aparece, com o id cru como label', () => {
  const store = usage.defaultUsage();
  const u = usage.extractUsage({ usage: { input_tokens: 1 }, total_cost_usd: 1 }, 'x');
  usage.applyUsage(store, '2026-08-01', 'review', 'a', 'x', u, 'p-removido');
  const out = usage.profileBreakdown(store, []);
  assert.equal(out[0].label, 'p-removido');
});

test('usageSummary devolve totais, hoje, 7 dias e quebras ordenadas', () => {
  const today = usage.localDay(); // o "hoje" do resumo é o dia LOCAL, igual ao gravado
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
  assert.equal(sum.last30.inputTokens, 1010, '30 dias também exclui o dia de 2000');
  // byKind ordenado por outputTokens desc: review (200) antes de chat (5)
  assert.equal(sum.byKind[0].kind, 'review');
  assert.equal(sum.byKind[0].label, 'Revisão');
  assert.ok(sum.byKind[0].outputTokens >= sum.byKind[1].outputTokens);
  // série diária ascendente, com todos os dias que têm registro (inclui o de 2000)
  assert.ok(Array.isArray(sum.series));
  assert.equal(sum.series[0].day, '2000-01-01', 'série começa no dia mais antigo');
  assert.equal(sum.series[sum.series.length - 1].day, today, 'série termina hoje');
  assert.equal('recentDays' in sum, false, 'recentDays foi substituído por series');
});
