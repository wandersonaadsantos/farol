'use strict';
// Concern de consumo de tokens (colaborador). Toda sessão headless do Claude emite um
// evento "result" com usage (input/output/cache) e total_cost_usd; aqui a gente registra
// isso de forma persistente e agregada (por dia, tipo, conta e modelo), sem gastar nada a
// mais. Só leitura do que a sessão já reporta. Funções recebem o engine como ctx; a Engine
// mantém fachadas finas. Ver docs/QUALITY.md.
const fs = require('fs');
const path = require('path');
const { STATE_DIR } = require('../paths');
const { writeJsonAtomic } = require('../io');
const { modelLabel } = require('../format');

const USAGE_FILE = path.join(STATE_DIR, 'usage.json');
const MAX_DAYS = 120; // guarda ~4 meses de timeline diária (totais nunca se perdem)
const KIND_LABEL = {
  review: 'Revisão', self: 'Autoanálise', pushback: 'Pushback',
  tool: 'Ferramentas', chat: 'Chat', outro: 'Outro'
};

function emptyBucket() {
  return { sessions: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 };
}

function defaultUsage() {
  return {
    totals: emptyBucket(), days: {}, byKind: {}, byAccount: {}, byModel: {}, byProfileDay: {},
    daysByKind: {}, daysByModel: {}, daysByAccount: {}, daysByKindModel: {},
  };
}

// tipo da sessão pelo prefixo do id (a=review, s=self, pb=pushback, f=ferramenta, c=chat)
function kindFromId(id) {
  const s = String(id || '');
  if (s.startsWith('pb')) return 'pushback';
  const c = s[0];
  return c === 'a' ? 'review' : c === 's' ? 'self' : c === 'f' ? 'tool' : c === 'c' ? 'chat' : 'outro';
}

// extrai os tokens do evento result do stream-json (0 quando ausente: stub de teste, CLI antigo)
function extractUsage(resultEvent, model) {
  const us = (resultEvent && resultEvent.usage) || {};
  return {
    inputTokens: Number(us.input_tokens) || 0,
    outputTokens: Number(us.output_tokens) || 0,
    cacheReadTokens: Number(us.cache_read_input_tokens) || 0,
    cacheCreationTokens: Number(us.cache_creation_input_tokens) || 0,
    costUsd: Number(resultEvent && resultEvent.total_cost_usd) || 0,
    model: model || ''
  };
}

// soma os tokens de uma sessão num bucket (conta como 1 sessão)
function addSession(bucket, u) {
  bucket.sessions += 1;
  bucket.inputTokens += u.inputTokens;
  bucket.outputTokens += u.outputTokens;
  bucket.cacheReadTokens += u.cacheReadTokens;
  bucket.cacheCreationTokens += u.cacheCreationTokens;
  bucket.costUsd += u.costUsd;
}

// soma um bucket inteiro em outro (pra agregar janelas de dias)
function addBucket(into, b) {
  into.sessions += b.sessions;
  into.inputTokens += b.inputTokens;
  into.outputTokens += b.outputTokens;
  into.cacheReadTokens += b.cacheReadTokens;
  into.cacheCreationTokens += b.cacheCreationTokens;
  into.costUsd += b.costUsd;
}

function pick(store, mapName, key) {
  const map = store[mapName];
  if (!map[key]) map[key] = emptyBucket();
  return map[key];
}

function pickComposite(map, dim, day) {
  const key = `${dim}|${day}`;
  if (!map[key]) map[key] = emptyBucket();
  return map[key];
}

function pickKindModel(map, kind, model, day) {
  const key = `${kind}|${model}|${day}`;
  if (!map[key]) map[key] = emptyBucket();
  return map[key];
}

// poda os dias mais antigos de `days` E dos 4 buckets cruzados por dia, no mesmo
// corte (MAX_DAYS): eles só alimentam grafico/matriz de ate 90 dias, ao contrario
// do log de sessoes (usage-sessions.json), que nao tem poda (registro permanente).
function pruneOldDays(store) {
  const days = Object.keys(store.days).sort();
  if (days.length <= MAX_DAYS) return;
  const doomed = days.slice(0, days.length - MAX_DAYS);
  for (const d of doomed) {
    delete store.days[d];
    for (const map of [store.daysByKind, store.daysByModel, store.daysByAccount]) {
      for (const k of Object.keys(map)) if (k.endsWith(`|${d}`)) delete map[k];
    }
    for (const k of Object.keys(store.daysByKindModel)) if (k.endsWith(`|${d}`)) delete store.daysByKindModel[k];
  }
}

// aplica uma sessão a todos os eixos do store (PURO: não toca em disco nem no relógio;
// recebe o dia pronto, pra ser testável). profileId é opcional: só perfil de chave de API
// participa do bucket byProfileDay (dir/legado chegam sem profileId, ou com '', e não
// geram entrada, ver profileBudgetStatus). Devolve o próprio store.
function applyUsage(store, day, kind, account, model, u, profileId) {
  addSession(store.totals, u);
  addSession(pick(store, 'days', day), u);
  addSession(pick(store, 'byKind', kind), u);
  addSession(pick(store, 'byAccount', account), u);
  const modelKey = modelLabel(model) || 'desconhecido';
  addSession(pick(store, 'byModel', modelKey), u);
  addSession(pickComposite(store.daysByKind, kind, day), u);
  addSession(pickComposite(store.daysByModel, modelKey, day), u);
  addSession(pickComposite(store.daysByAccount, account, day), u);
  addSession(pickKindModel(store.daysByKindModel, kind, modelKey, day), u);
  if (profileId) {
    if (!store.byProfileDay) store.byProfileDay = {};
    const key = `${profileId}|${day}`;
    if (!store.byProfileDay[key]) store.byProfileDay[key] = emptyBucket();
    addSession(store.byProfileDay[key], u);
  }
  pruneOldDays(store);
  return store;
}

function saveUsage(engine) {
  try { writeJsonAtomic(USAGE_FILE, engine.usage); }
  catch (err) { if (engine.log) engine.log('WARN', `salvar usage.json: ${err.message}`); }
}

// Dia LOCAL do processo (YYYY-MM-DD). Regra do projeto: horário de Brasília na
// tela, nunca UTC cru; com o corte UTC, às 21h locais o dia virava e o card
// "Hoje" zerava. Buckets antigos gravados em dia UTC ficam COMO ESTÃO (decisão:
// sem migração, o registro é permanente); só o registro novo corta no local, e a
// transição pode deslocar na série as sessões da noite anterior por um dia.
function localDay(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// registra o consumo de uma sessão que terminou (sucesso OU erro, ver Task 3 pra quem
// chama isto também no caminho de erro). profileId: id do perfil de chave de API
// resolvido pra esta sessão ('' ou ausente pra perfil dir/legado).
function recordUsage(engine, id, account, resultEvent, model, profileId) {
  const u = extractUsage(resultEvent, model);
  if (!u.inputTokens && !u.outputTokens && !u.cacheReadTokens && !u.cacheCreationTokens) return;
  if (!engine.usage) engine.usage = defaultUsage();
  const day = localDay();
  const acc = String(account || '').toLowerCase() || '(sem conta)';
  applyUsage(engine.usage, day, kindFromId(id), acc, model, u, profileId);
  saveUsage(engine);
  engine.pushState();
}

// soma os buckets de dia com data >= from (YYYY-MM-DD)
function sumDaysSince(days, from) {
  const out = emptyBucket();
  for (const [d, b] of Object.entries(days)) if (d >= from) addBucket(out, b);
  return out;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDay(d);
}

// soma o gasto de HOJE (dia local) e desde a data de corte `since` (YYYY-MM-DD, ou
// undefined pra somar TUDO), pro profileId pedido, sem vazar gasto de outros perfis (a
// chave composta garante isolamento: só entra no cálculo quem começa com "${profileId}|").
function profileSpend(store, profileId, since) {
  const today = localDay();
  const prefix = `${profileId}|`;
  const byDay = store.byProfileDay || {};
  const todayBucket = byDay[`${prefix}${today}`] || emptyBucket();
  let sinceCost = 0;
  for (const [key, b] of Object.entries(byDay)) {
    if (!key.startsWith(prefix)) continue;
    const day = key.slice(prefix.length);
    if (!since || day >= since) sinceCost += b.costUsd;
  }
  return { today: todayBucket.costUsd, sinceCutoff: sinceCost };
}

// compara o gasto do perfil com os tetos configurados. Só kind:'apikey' participa (perfil
// dir/legado nunca bloqueia, não tem os campos budgetDaily/budgetTotal). budgetDaily e
// budgetTotal são opcionais (undefined nunca é excedido). Testa o diário ANTES do total: se
// os dois estourarem no mesmo instante, o motivo relatado é o diário (mais recente, mais
// acionável: "veio de hoje").
function profileBudgetStatus(profile, store) {
  if (!profile || profile.kind !== 'apikey') return { blocked: false };
  const spend = profileSpend(store, profile.id, profile.budgetSince);
  if (profile.budgetDaily != null && spend.today >= profile.budgetDaily) {
    return { blocked: true, reason: 'diario', today: spend.today, sinceCutoff: spend.sinceCutoff };
  }
  if (profile.budgetTotal != null && spend.sinceCutoff >= profile.budgetTotal) {
    return { blocked: true, reason: 'total', today: spend.today, sinceCutoff: spend.sinceCutoff };
  }
  return { blocked: false, today: spend.today, sinceCutoff: spend.sinceCutoff };
}

// quebra por perfil de chave de API, pra aba Consumo: soma TODOS os dias de cada
// profileId (não só hoje), no MESMO shape de bucket que byAccount/byModel (sessions,
// tokens, costUsd) + label, pra reusar drawUsageBreakdown (ui/app.js) sem mudança nenhuma
// na função de desenho. Perfil removido do config ainda aparece (histórico preservado,
// mesma filosofia de byAccount com conta removida), com o id cru como label.
function profileBreakdown(store, profiles) {
  const totals = {};
  for (const [key, b] of Object.entries(store.byProfileDay || {})) {
    const i = key.indexOf('|');
    if (i < 0) continue;
    const profileId = key.slice(0, i);
    if (!totals[profileId]) totals[profileId] = emptyBucket();
    addBucket(totals[profileId], b);
  }
  return Object.entries(totals).map(([profileId, b]) => {
    const p = (profiles || []).find(x => x.id === profileId);
    return { profileId, label: (p && p.label) || profileId, ...b };
  }).sort((a, b) => b.outputTokens - a.outputTokens);
}

// resumo pro snapshot/UI (tela Consumo): totais, janelas (hoje/7/30 dias), a série
// diária pros charts de linha do tempo, e as quebras por tipo/conta/modelo. É só
// leitura/agregação; não há como zerar (o registro é permanente, por decisão).
function usageSummary(engine) {
  const store = engine.usage || defaultUsage();
  const today = localDay();
  const listOf = (map, keyName, labelFn) => Object.entries(map)
    .map(([k, b]) => ({ [keyName]: k, label: labelFn ? labelFn(k) : k, ...b }))
    .sort((a, b) => b.outputTokens - a.outputTokens);
  // série diária ascendente (o store guarda até MAX_DAYS); a UI recorta a janela.
  const series = Object.entries(store.days)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, b]) => ({ day, ...b }));
  return {
    totals: store.totals,
    today: store.days[today] || emptyBucket(),
    last7: sumDaysSince(store.days, daysAgo(6)),   // hoje + 6 = 7 dias
    last30: sumDaysSince(store.days, daysAgo(29)), // hoje + 29 = 30 dias
    byKind: listOf(store.byKind, 'kind', k => KIND_LABEL[k] || k),
    byAccount: listOf(store.byAccount, 'account'),
    byModel: listOf(store.byModel, 'model'),
    byProfile: profileBreakdown(store, engine.config && engine.config.claudeProfiles),
    series
  };
}

module.exports = {
  USAGE_FILE, defaultUsage, kindFromId, extractUsage, applyUsage,
  recordUsage, usageSummary, localDay, profileSpend, profileBudgetStatus, profileBreakdown,
};
