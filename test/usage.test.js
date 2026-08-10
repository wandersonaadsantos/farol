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

test('usageSummary: totais, série diária ordenada e payload morto aposentado (v2.40.0)', () => {
  const today = usage.localDay();
  const store = usage.defaultUsage();
  const big = usage.extractUsage({ usage: { input_tokens: 1000, output_tokens: 200 } }, 'claude-opus-4-8');
  const small = usage.extractUsage({ usage: { input_tokens: 10, output_tokens: 5 } }, 'claude-opus-4-8');
  usage.applyUsage(store, today, 'review', 'trabalho', 'claude-opus-4-8', big);
  usage.applyUsage(store, today, 'chat', 'trabalho', 'claude-opus-4-8', small);
  usage.applyUsage(store, '2000-01-01', 'tool', 'trabalho', 'claude-opus-4-8', small);

  const sum = usage.usageSummary({ usage: store });
  assert.equal(sum.totals.sessions, 3);
  // série diária ascendente, com todos os dias que têm registro (inclui o de 2000)
  assert.ok(Array.isArray(sum.series));
  assert.equal(sum.series[0].day, '2000-01-01', 'série começa no dia mais antigo');
  assert.equal(sum.series[sum.series.length - 1].day, today, 'série termina hoje');
  // janela é responsabilidade de quem consome, sobre a MESMA série: os campos
  // pré-somados com definição própria de janela saíram do payload, junto com as
  // quebras planas que nenhum painel lia (auditoria de 10/08/2026)
  for (const morto of ['today', 'last7', 'last30', 'byKind', 'byAccount', 'byModel', 'byProfile', 'recentDays']) {
    assert.equal(morto in sum, false, `${morto} não trafega mais`);
  }
  assert.equal(sum.retentionDays, 120, 'a retenção viaja no payload (a UI não replica mais MAX_DAYS)');
});

test('usageSummary: reconciliação cria a camada _resto pra dia sem detalhamento (registro antigo)', () => {
  const store = usage.defaultUsage();
  const u1 = usage.extractUsage({ usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 7 }, total_cost_usd: 0.5 }, 'claude-opus-4-8');
  const u2 = usage.extractUsage({ usage: { input_tokens: 40, output_tokens: 10 }, total_cost_usd: 0.25 }, 'claude-sonnet-4-5');
  usage.applyUsage(store, '2026-08-01', 'review', 'trabalho', 'claude-opus-4-8', u1);
  usage.applyUsage(store, '2026-08-02', 'self', 'pessoal', 'claude-sonnet-4-5', u2);
  // simula o registro anterior à v2.38.0: o dia 01 existe em days mas os buckets
  // cruzados dele não existem (era exatamente o estado do disco em 10/08/2026)
  for (const map of ['daysByKind', 'daysByModel', 'daysByAccount']) {
    for (const k of Object.keys(store[map])) if (k.endsWith('|2026-08-01')) delete store[map][k];
  }
  for (const k of Object.keys(store.daysByKindModel)) if (k.endsWith('|2026-08-01')) delete store.daysByKindModel[k];

  const sum = usage.usageSummary({ usage: store });
  assert.ok(sum.kindNames.includes(usage.RESTO), '_resto entra na lista de nomes quando há resto');
  assert.ok(sum.modelNames.includes(usage.RESTO));
  assert.ok(sum.accountNames.includes(usage.RESTO));
  const dia1 = sum.stackedSeries.byKind.find(d => d.day === '2026-08-01');
  const resto1 = dia1.items.find(i => i.name === usage.RESTO);
  assert.equal(resto1.label, 'Sem detalhamento');
  assert.equal(resto1.inputTokens, 100, 'o resto do dia 01 é o dia inteiro');
  assert.equal(resto1.sessions, 1);
  assert.equal(resto1.cacheReadTokens, 7);
  const dia2 = sum.stackedSeries.byKind.find(d => d.day === '2026-08-02');
  const resto2 = dia2.items.find(i => i.name === usage.RESTO);
  assert.equal(resto2.inputTokens, 0, 'dia 100% detalhado tem resto zero');
  // matriz: o resto do dia 01 mora em cells._resto._resto
  assert.ok(sum.matrixKindNames.includes(usage.RESTO));
  assert.ok(sum.matrixModelNames.includes(usage.RESTO));
  const m1 = sum.matrixSeries.find(d => d.day === '2026-08-01');
  assert.equal(m1.cells[usage.RESTO][usage.RESTO].inputTokens, 100);
});

test('INVARIANTE: soma das camadas empilhadas == série do dia, campo a campo, nas 3 dimensões', () => {
  const store = usage.defaultUsage();
  const mk = (inp, out, cr, cc, cost) => usage.extractUsage(
    { usage: { input_tokens: inp, output_tokens: out, cache_read_input_tokens: cr, cache_creation_input_tokens: cc }, total_cost_usd: cost }, 'claude-opus-4-8');
  usage.applyUsage(store, '2026-08-01', 'review', 'trabalho', 'claude-opus-4-8', mk(100, 20, 5, 3, 0.11));
  usage.applyUsage(store, '2026-08-02', 'chat', 'pessoal', 'claude-sonnet-4-5', mk(50, 10, 0, 0, 0.07));
  usage.applyUsage(store, '2026-08-02', 'tool', 'trabalho', 'claude-haiku-4-5', mk(9, 1, 2, 0, 0.01));
  // dia 01 vira "sem detalhamento" parcial: apaga só metade dos buckets cruzados
  delete store.daysByKind['review|2026-08-01'];
  delete store.daysByKindModel['review|Opus 4.8|2026-08-01'];

  const sum = usage.usageSummary({ usage: store });
  const campos = ['sessions', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens'];
  for (const dim of ['byKind', 'byModel', 'byAccount']) {
    for (const dia of sum.stackedSeries[dim]) {
      const serie = sum.series.find(s => s.day === dia.day);
      for (const campo of campos) {
        const soma = dia.items.reduce((a, it) => a + (it[campo] || 0), 0);
        assert.equal(soma, serie[campo], `${dim}/${dia.day}/${campo}: camadas somam a série`);
      }
      const somaCusto = dia.items.reduce((a, it) => a + (it.costUsd || 0), 0);
      assert.ok(Math.abs(somaCusto - serie.costUsd) < 0.001, `${dim}/${dia.day}/costUsd`);
    }
  }
  // matriz: total geral de todos os dias == total da série
  for (const dia of sum.matrixSeries) {
    const serie = sum.series.find(s => s.day === dia.day);
    for (const campo of campos) {
      let soma = 0;
      for (const row of Object.values(dia.cells)) for (const b of Object.values(row)) soma += b[campo] || 0;
      assert.equal(soma, serie[campo], `matriz/${dia.day}/${campo}`);
    }
  }
});

test('INVARIANTE: _resto é SEMPRE o último item, e os demais seguem a ordem exata dos nomes (a UI zipa por índice)', () => {
  const store = usage.defaultUsage();
  const u = usage.extractUsage({ usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.01 }, 'claude-opus-4-8');
  usage.applyUsage(store, '2026-08-01', 'review', 'trabalho', 'claude-opus-4-8', u);
  usage.applyUsage(store, '2026-08-02', 'chat', 'pessoal', 'claude-sonnet-4-5', u);
  delete store.daysByKind['review|2026-08-01']; // força hasResto

  const sum = usage.usageSummary({ usage: store });
  assert.equal(sum.kindNames[sum.kindNames.length - 1], usage.RESTO, '_resto fecha a lista de nomes');
  assert.deepEqual(sum.kindNames.slice(0, -1), ['review', 'self', 'chat', 'tool', 'pushback', 'outro'], 'os nomes base mantêm a ordem fixa');
  for (const dia of sum.stackedSeries.byKind) {
    assert.equal(dia.items[dia.items.length - 1].name, usage.RESTO, `_resto é o último item do dia ${dia.day}`);
    assert.deepEqual(dia.items.map(i => i.name).slice(0, -1), ['review', 'self', 'chat', 'tool', 'pushback', 'outro'],
      `os items do dia ${dia.day} seguem a MESMA ordem dos nomes (cor/legenda/tooltip casam por índice)`);
  }
});

test('reconciliação: bucket detalhado À FRENTE de days (deriva inversa) clampa o resto em zero, nunca negativo', () => {
  const store = usage.defaultUsage();
  const u = usage.extractUsage({ usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.01 }, 'claude-opus-4-8');
  usage.applyUsage(store, '2026-08-01', 'review', 'trabalho', 'claude-opus-4-8', u);
  // deriva inversa simulada (ex.: crash entre as duas escritas): o detalhado tem MAIS que days
  store.daysByKind['review|2026-08-01'].inputTokens += 999;
  store.daysByKind['review|2026-08-01'].costUsd += 5;

  const sum = usage.usageSummary({ usage: store });
  const dia = sum.stackedSeries.byKind.find(d => d.day === '2026-08-01');
  const resto = dia.items.find(i => i.name === usage.RESTO);
  for (const campo of ['sessions', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'costUsd']) {
    assert.ok(resto[campo] >= 0, `${campo} nunca fica negativo`);
    assert.equal(resto[campo], 0, `${campo} clampa em zero (o detalhado prevalece)`);
  }
});

test('reconciliação: epsilon do custo zera só poeira de float (<0.001), nunca custo real', () => {
  const mk = cost => {
    const store = usage.defaultUsage();
    const u = usage.extractUsage({ usage: { input_tokens: 10 }, total_cost_usd: 1 }, 'x');
    usage.applyUsage(store, '2026-08-01', 'review', 'a', 'x', u);
    // days fica com custo 1 + cost a mais que o detalhado
    store.days['2026-08-01'].costUsd += cost;
    return usage.usageSummary({ usage: store }).stackedSeries.byKind
      .find(d => d.day === '2026-08-01').items.find(i => i.name === usage.RESTO).costUsd;
  };
  assert.equal(mk(0.0005), 0, 'meio décimo de centavo é poeira de float, zera');
  assert.ok(Math.abs(mk(0.005) - 0.005) < 1e-9, 'meio centavo é custo real, sobrevive (mutação do epsilon pra 0.01 quebraria aqui)');
});

test('recordUsage: marca farol_cancelled vira status cancelada no log (não ok, não erro)', () => {
  const engine = { usage: usage.defaultUsage(), usageSessions: usage.defaultSessions(), pushState() {}, log() {} };
  usage.recordUsage(engine, 'a1', 'trabalho', { usage: { input_tokens: 5, output_tokens: 1 }, total_cost_usd: 0.01, farol_cancelled: true }, 'claude-opus-4-8', '', 'x/y#1');
  assert.equal(engine.usageSessions.sessions[0].status, 'cancelada');
  usage.recordUsage(engine, 'a2', 'trabalho', { usage: { input_tokens: 5 }, total_cost_usd: 0, is_error: true, farol_cancelled: true }, 'claude-opus-4-8', '', 'x/y#2');
  assert.equal(engine.usageSessions.sessions[1].status, 'cancelada', 'cancelamento tem precedência sobre is_error');
});

test('usageSummary.budgets: espelha profileBudgetStatus ao vivo e NUNCA vaza a chave', () => {
  const store = usage.defaultUsage();
  const u = usage.extractUsage({ usage: { input_tokens: 1 }, total_cost_usd: 5 }, 'x');
  usage.applyUsage(store, usage.localDay(), 'review', 'a', 'x', u, 'p1');
  const profiles = [
    { id: 'p1', label: 'Chave', kind: 'apikey', apiKey: 'sk-SEGREDO', baseUrl: 'http://x', budgetDaily: 3, budgetTotal: 100, budgetSince: '2026-08-01' },
    { id: 'p2', label: 'Assinatura', dir: 'C:\\x' },
  ];
  const sum = usage.usageSummary({ usage: store, config: { claudeProfiles: profiles } });
  assert.equal(sum.budgets.length, 2);
  const b1 = sum.budgets[0];
  assert.equal(b1.kind, 'apikey');
  assert.equal(b1.blocked, true, 'mesmo veredito do gate real (5 >= teto diário 3)');
  assert.equal(b1.reason, 'diario');
  assert.equal(Math.round(b1.today * 100) / 100, 5);
  assert.equal(b1.budgetDaily, 3);
  assert.equal('apiKey' in b1, false, 'a chave nunca trafega');
  assert.equal('baseUrl' in b1, false);
  const b2 = sum.budgets[1];
  assert.equal(b2.kind, 'assinatura');
  assert.equal(b2.blocked, false);
  assert.equal(b2.budgetDaily, null, 'perfil de assinatura não tem teto');
  assert.equal(JSON.stringify(sum).includes('sk-SEGREDO'), false, 'nenhum campo do payload carrega a chave');
});

test('usageSummary.sessionsSince: at da sessão mais antiga do log (null sem log)', () => {
  const engine = { usage: usage.defaultUsage(), usageSessions: usage.defaultSessions(), config: {}, pushState() {}, log() {} };
  assert.equal(usage.usageSummary(engine).sessionsSince, null);
  usage.recordUsage(engine, 'a1', 'trabalho', { usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 }, 'claude-sonnet-4-5', '', 'ref1');
  usage.recordUsage(engine, 'a2', 'trabalho', { usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 }, 'claude-sonnet-4-5', '', 'ref2');
  const s = usage.usageSummary(engine);
  assert.equal(s.sessionsSince, engine.usageSessions.sessions[0].at, 'a mais antiga, não a mais nova');
});

test('recordUsage: sessão com custo e ZERO tokens registra (custo real não some do teto)', () => {
  const engine = { usage: usage.defaultUsage(), usageSessions: usage.defaultSessions(), pushState() {}, log() {} };
  usage.recordUsage(engine, 'a1', 'trabalho', { total_cost_usd: 2.5 }, 'claude-opus-4-8', 'p1', 'x/y#1');
  assert.equal(engine.usage.totals.sessions, 1);
  assert.equal(Math.round(engine.usage.totals.costUsd * 100) / 100, 2.5);
  assert.equal(engine.usageSessions.sessions.length, 1);
  assert.equal(engine.usage.byProfileDay[`p1|${usage.localDay()}`].costUsd, 2.5, 'o teto vê esse dinheiro');
});

test('recordUsage: sessão com tudo zerado (stub) segue ignorada', () => {
  const engine = { usage: usage.defaultUsage(), usageSessions: usage.defaultSessions(), pushState() {}, log() {} };
  usage.recordUsage(engine, 'a1', 'trabalho', { usage: {}, total_cost_usd: 0 }, 'claude-opus-4-8', '', 'x');
  assert.equal(engine.usage.totals.sessions, 0);
  assert.equal(engine.usageSessions.sessions.length, 0);
});

test('recordUsage grava uma linha no log de sessoes, com ref e status', () => {
  const engine = { usage: usage.defaultUsage(), usageSessions: usage.defaultSessions(), pushState() {}, log() {} };
  const resultEvent = { usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.001 };
  usage.recordUsage(engine, 'a1', 'trabalho', resultEvent, 'claude-opus-4-8', '', 'biudtech/farol#88');
  assert.equal(engine.usageSessions.sessions.length, 1);
  const s = engine.usageSessions.sessions[0];
  assert.equal(s.kind, 'review');
  assert.equal(s.ref, 'biudtech/farol#88');
  assert.equal(s.account, 'trabalho');
  assert.equal(s.model, 'Opus 4.8');
  assert.equal(s.inputTokens, 10);
  assert.equal(s.status, 'ok');
  assert.ok(s.at > 0);
});

test('recordUsage marca status erro quando resultEvent.is_error e nao poda o log', () => {
  const engine = { usage: usage.defaultUsage(), usageSessions: usage.defaultSessions(), pushState() {}, log() {} };
  const okEvent = { usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 };
  for (let i = 0; i < 5; i++) usage.recordUsage(engine, 's' + i, 'trabalho', okEvent, 'claude-sonnet-4-5', '', 'ref' + i);
  const errEvent = { usage: { input_tokens: 2, output_tokens: 0 }, total_cost_usd: 0, is_error: true };
  usage.recordUsage(engine, 'a9', 'trabalho', errEvent, 'claude-sonnet-4-5', '', 'biudtech/farol#90');
  assert.equal(engine.usageSessions.sessions.length, 6, 'log nao tem poda, todas as 6 sessoes ficam');
  assert.equal(engine.usageSessions.sessions[5].status, 'erro');
});

test('recordUsage sem ref grava null (nunca quebra)', () => {
  const engine = { usage: usage.defaultUsage(), usageSessions: usage.defaultSessions(), pushState() {}, log() {} };
  const ev = { usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 };
  usage.recordUsage(engine, 'f1', 'trabalho', ev, 'claude-haiku-4-5', '');
  assert.equal(engine.usageSessions.sessions[0].ref, null);
});

test('usageSummary expoe stackedSeries, matrixSeries e recentSessions', () => {
  const engine = { usage: usage.defaultUsage(), usageSessions: usage.defaultSessions(), config: {}, pushState() {}, log() {} };
  const today = usage.localDay();
  const u1 = usage.extractUsage({ usage: { input_tokens: 100, output_tokens: 20 }, total_cost_usd: 0.02 }, 'claude-opus-4-8');
  usage.applyUsage(engine.usage, today, 'review', 'trabalho', 'claude-opus-4-8', u1);
  usage.recordUsage(engine, 'a1', 'trabalho', { usage: { input_tokens: 100, output_tokens: 20 }, total_cost_usd: 0.02 }, 'claude-opus-4-8', '', 'biudtech/farol#88');

  const s = usage.usageSummary(engine);
  assert.deepEqual(s.kindNames, ['review', 'self', 'chat', 'tool', 'pushback', 'outro']);
  assert.ok(s.modelNames.includes('Opus 4.8'));
  assert.ok(s.accountNames.includes('trabalho'));

  const dia = s.stackedSeries.byKind.find(d => d.day === today);
  assert.ok(dia, 'stackedSeries.byKind tem o dia gravado');
  const itemReview = dia.items.find(i => i.name === 'review');
  assert.equal(itemReview.label, 'Revisão');
  assert.equal(itemReview.inputTokens, 200, 'soma applyUsage + recordUsage (2 chamadas de 100 cada)');
  const itemSelf = dia.items.find(i => i.name === 'self');
  assert.equal(itemSelf.inputTokens, 0, 'dimensao sem sessao no dia vem com bucket zerado, nao ausente');

  const diaMatrix = s.matrixSeries.find(d => d.day === today);
  assert.equal(diaMatrix.cells.review['Opus 4.8'].inputTokens, 200);

  assert.equal(s.recentSessions.length, 1);
  assert.equal(s.recentSessions[0].ref, 'biudtech/farol#88');
});

test('usageSummary.recentSessions corta em 100 e mostra a mais nova primeiro', () => {
  const engine = { usage: usage.defaultUsage(), usageSessions: usage.defaultSessions(), config: {}, pushState() {}, log() {} };
  for (let i = 0; i < 105; i++) {
    usage.recordUsage(engine, 'a' + i, 'trabalho', { usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 }, 'claude-sonnet-4-5', '', 'ref' + i);
  }
  const s = usage.usageSummary(engine);
  assert.equal(s.recentSessions.length, 100);
  assert.equal(s.recentSessions[0].ref, 'ref104', 'mais nova primeiro');
  assert.equal(engine.usageSessions.sessions.length, 105, 'o arquivo em disco nao foi cortado, so o que trafega pra UI');
});
