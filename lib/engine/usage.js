'use strict';
// Concern de consumo de tokens (colaborador). Toda sessão headless do Claude emite um
// evento "result" com usage (input/output/cache) e total_cost_usd; aqui a gente registra
// isso de forma persistente e agregada (por dia, tipo, conta e modelo), sem gastar nada a
// mais. Só leitura do que a sessão já reporta. Funções recebem o engine como ctx; a Engine
// mantém fachadas finas. Ver docs/QUALITY.md.
const fs = require('fs');
const path = require('path');
const { STATE_DIR } = require('../paths');
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
  return { totals: emptyBucket(), days: {}, byKind: {}, byAccount: {}, byModel: {} };
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

// aplica uma sessão a todos os eixos do store (PURO: não toca em disco nem no relógio;
// recebe o dia pronto, pra ser testável). Devolve o próprio store.
function applyUsage(store, day, kind, account, model, u) {
  addSession(store.totals, u);
  addSession(pick(store, 'days', day), u);
  addSession(pick(store, 'byKind', kind), u);
  addSession(pick(store, 'byAccount', account), u);
  addSession(pick(store, 'byModel', modelLabel(model) || 'desconhecido'), u);
  // poda os dias mais antigos (só a timeline; totais e quebras permanecem)
  const days = Object.keys(store.days).sort();
  if (days.length > MAX_DAYS) for (const d of days.slice(0, days.length - MAX_DAYS)) delete store.days[d];
  return store;
}

function saveUsage(engine) {
  try { fs.writeFileSync(USAGE_FILE, JSON.stringify(engine.usage, null, 2)); }
  catch (err) { if (engine.log) engine.log('WARN', `salvar usage.json: ${err.message}`); }
}

// registra o consumo de uma sessão que terminou com sucesso (chamado do runClaudeStream).
function recordUsage(engine, id, account, resultEvent, model) {
  const u = extractUsage(resultEvent, model);
  // sessão sem tokens (stub de teste, ou result sem usage): não registra ruído
  if (!u.inputTokens && !u.outputTokens && !u.cacheReadTokens && !u.cacheCreationTokens) return;
  if (!engine.usage) engine.usage = defaultUsage();
  const day = new Date().toISOString().slice(0, 10);
  const acc = String(account || '').toLowerCase() || '(sem conta)';
  applyUsage(engine.usage, day, kindFromId(id), acc, model, u);
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
  return d.toISOString().slice(0, 10);
}

// resumo pro snapshot/UI (tela Consumo): totais, janelas (hoje/7/30 dias), a série
// diária pros charts de linha do tempo, e as quebras por tipo/conta/modelo. É só
// leitura/agregação; não há como zerar (o registro é permanente, por decisão).
function usageSummary(engine) {
  const store = engine.usage || defaultUsage();
  const today = new Date().toISOString().slice(0, 10);
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
    series
  };
}

module.exports = {
  USAGE_FILE, defaultUsage, kindFromId, extractUsage, applyUsage,
  recordUsage, saveUsage, usageSummary,
};
