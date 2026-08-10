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
const SESSIONS_FILE = path.join(STATE_DIR, 'usage-sessions.json');
const MAX_DAYS = 120; // guarda ~4 meses de timeline diária (totais nunca se perdem)
const KIND_LABEL = {
  review: 'Revisão', self: 'Autoanálise', pushback: 'Pushback',
  tool: 'Ferramentas', chat: 'Chat', outro: 'Outro'
};

// ordem fixa das camadas do grafico empilhado: cor estavel mesmo quando um tipo
// nao teve sessao num dia (o dia entra com bucket zerado, nao some da lista).
const KIND_ORDER = ['review', 'self', 'chat', 'tool', 'pushback', 'outro'];

// nome reservado da camada/linha/coluna sintetica de reconciliacao: a fatia de um
// dia que existe no eixo autoritativo (days) mas nao tem detalhamento nos buckets
// cruzados (dias anteriores a v2.38.0, sessoes de antes de uma atualizacao no meio
// do dia, qualquer deriva futura entre escritas). Nunca colide com kind (KIND_ORDER
// e fechado), com conta (login GitHub nao comeca com _) nem com modelo (modelLabel
// nunca gera _resto).
const RESTO = '_resto';
const RESTO_LABEL = 'Sem detalhamento';

function emptyBucket() {
  return { sessions: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 };
}

function defaultUsage() {
  return {
    totals: emptyBucket(), days: {}, byKind: {}, byAccount: {}, byModel: {}, byProfileDay: {},
    daysByKind: {}, daysByModel: {}, daysByAccount: {}, daysByKindModel: {},
  };
}

function defaultSessions() { return { sessions: [] }; }

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
  // defaultUsage() sempre entrega os 4 mapas prontos, mas um store vindo de
  // outro lugar (disco antigo, teste) pode faltar um deles; mesma defesa que
  // byProfileDay já tinha logo abaixo, por consistência (nunca perder o
  // rastreio inteiro calado por causa de uma chave ausente).
  if (!store.daysByKind) store.daysByKind = {};
  if (!store.daysByModel) store.daysByModel = {};
  if (!store.daysByAccount) store.daysByAccount = {};
  if (!store.daysByKindModel) store.daysByKindModel = {};
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

function saveSessions(engine) {
  try { writeJsonAtomic(SESSIONS_FILE, engine.usageSessions); }
  catch (err) { if (engine.log) engine.log('WARN', `salvar usage-sessions.json: ${err.message}`); }
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

// registra o consumo de uma sessao que terminou (sucesso OU erro) nos dois lugares:
// o agregado (usage.json, via applyUsage) e o log individual permanente, sem poda
// (usage-sessions.json), que alimenta a tabela "Sessoes recentes" da aba Consumo.
// `ref` e a referencia amigavel mostrada na tela (chave do PR, do chat, ou o
// rotulo da ferramenta); ausente vira null, nunca quebra o registro.
function recordUsage(engine, id, account, resultEvent, model, profileId, ref) {
  const u = extractUsage(resultEvent, model);
  // so ignora sessao com token E custo zerados (stub de teste, CLI antigo): custo sem
  // token contabiliza, senao dinheiro real ficaria fora da tela E do teto de orcamento.
  if (!u.inputTokens && !u.outputTokens && !u.cacheReadTokens && !u.cacheCreationTokens && !u.costUsd) return;
  if (!engine.usage) engine.usage = defaultUsage();
  if (!engine.usageSessions) engine.usageSessions = defaultSessions();
  const day = localDay();
  const acc = String(account || '').toLowerCase() || '(sem conta)';
  const kind = kindFromId(id);
  applyUsage(engine.usage, day, kind, acc, model, u, profileId);
  saveUsage(engine);
  engine.usageSessions.sessions.push({
    at: Date.now(), day, kind, ref: ref || null, account: acc,
    model: modelLabel(model) || 'desconhecido', profileId: profileId || '',
    inputTokens: u.inputTokens, outputTokens: u.outputTokens,
    cacheReadTokens: u.cacheReadTokens, cacheCreationTokens: u.cacheCreationTokens,
    costUsd: u.costUsd,
    // 'cancelada' (marca farol_cancelled posta pelo session.js) tem precedência sobre
    // 'erro': o desfecho que o usuário provocou explica melhor a linha que o is_error
    // que o kill costuma produzir junto.
    status: (resultEvent && resultEvent.farol_cancelled) ? 'cancelada'
      : (resultEvent && resultEvent.is_error) ? 'erro' : 'ok',
  });
  saveSessions(engine);
  engine.pushState();
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

// a fatia de um dia que o eixo autoritativo (days) tem e a soma dos buckets
// detalhados nao cobre, campo a campo, clamp em zero: e a camada "_resto" da
// reconciliacao. `covered` e a soma dos buckets da dimensao naquele dia.
// Clamp: se algum bucket detalhado estiver A FRENTE de days (deriva inversa,
// ex.: crash entre as duas escritas), o resto zera e o detalhado prevalece.
function remainderBucket(dayTotal, covered) {
  const r = emptyBucket();
  if (!dayTotal) return r;
  r.sessions = Math.max(0, (dayTotal.sessions || 0) - covered.sessions);
  r.inputTokens = Math.max(0, (dayTotal.inputTokens || 0) - covered.inputTokens);
  r.outputTokens = Math.max(0, (dayTotal.outputTokens || 0) - covered.outputTokens);
  r.cacheReadTokens = Math.max(0, (dayTotal.cacheReadTokens || 0) - covered.cacheReadTokens);
  r.cacheCreationTokens = Math.max(0, (dayTotal.cacheCreationTokens || 0) - covered.cacheCreationTokens);
  // custo e float: soma e subtracao na ordem inversa deixam poeira de ponto
  // flutuante; abaixo de um decimo de centavo o resto e ruido, nao dado
  r.costUsd = Math.max(0, (dayTotal.costUsd || 0) - covered.costUsd);
  if (r.costUsd < 0.001) r.costUsd = 0;
  return r;
}

function hasAny(b) {
  return !!(b.sessions || b.inputTokens || b.outputTokens || b.cacheReadTokens || b.cacheCreationTokens || b.costUsd);
}

// re-fatiar daysByKindModel (chave `${kind}|${model}|${day}`) em serie por dia,
// pra UI somar o periodo (7/30/90) que ela mesma escolheu, do mesmo jeito que ja
// faz com `series`. kind e model nunca contem "|", entao o split e seguro.
// RECONCILIADO: a fatia do dia sem detalhamento entra em cells._resto._resto,
// entao o total geral da matriz na janela SEMPRE bate com o KPI da mesma janela.
function matrixSeriesFrom(store) {
  const byDay = {};
  for (const [key, bucket] of Object.entries(store.daysByKindModel || {})) {
    const [kind, model, day] = key.split('|');
    if (!byDay[day]) byDay[day] = {};
    if (!byDay[day][kind]) byDay[day][kind] = {};
    byDay[day][kind][model] = bucket;
  }
  let hasResto = false;
  const series = Object.keys(store.days).sort().map(day => {
    const cells = byDay[day] || {};
    const covered = emptyBucket();
    for (const row of Object.values(cells)) for (const b of Object.values(row)) addBucket(covered, b);
    const resto = remainderBucket(store.days[day], covered);
    if (hasAny(resto)) {
      hasResto = true;
      return { day, cells: { ...cells, [RESTO]: { [RESTO]: resto } } };
    }
    return { day, cells };
  });
  return { series, hasResto };
}

// idem, pra uma dimensao so (kind, model ou account): devolve, por dia, o bucket
// de cada nome da dimensao (zerado quando aquele nome nao teve sessao no dia).
// RECONCILIADO: quando a soma dos nomes nao cobre days[day], a diferenca vira o
// item _resto do dia (invariante: soma dos items == days[day], campo a campo).
// O chamador decide se _resto entra na lista de nomes exposta (so quando algum
// dia teve resto); os items ficam SEMPRE na ordem de `names` + _resto no fim,
// porque a UI zipa item/cor/legenda por indice.
function stackedSeriesFor(store, map, names, labelFn) {
  const days = Object.keys(store.days).sort();
  let hasResto = false;
  const series = days.map(day => {
    const items = names.map(name => ({ name, label: labelFn(name), ...(map[`${name}|${day}`] || emptyBucket()) }));
    const covered = emptyBucket();
    for (const it of items) addBucket(covered, it);
    const resto = remainderBucket(store.days[day], covered);
    if (hasAny(resto)) hasResto = true;
    items.push({ name: RESTO, label: RESTO_LABEL, ...resto });
    return { day, items };
  });
  return { series, hasResto };
}

// status de orcamento por perfil configurado, pro payload da aba Consumo: a MESMA
// conta do gate real (profileBudgetStatus), refeita a cada push, pra tela e
// comportamento nunca divergirem (o cartao lia o cache do doctor e congelava).
// NUNCA inclui apiKey nem baseUrl: so rotulo, tetos e gasto.
function budgetsFrom(store, profiles) {
  return (profiles || []).map(p => {
    const isKey = p.kind === 'apikey';
    const st = isKey ? profileBudgetStatus(p, store) : { blocked: false };
    return {
      id: p.id, label: p.label, kind: isKey ? 'apikey' : 'assinatura',
      budgetDaily: isKey && p.budgetDaily != null ? p.budgetDaily : null,
      budgetTotal: isKey && p.budgetTotal != null ? p.budgetTotal : null,
      budgetSince: (isKey && p.budgetSince) || null,
      today: st.today || 0, sinceCutoff: st.sinceCutoff || 0,
      blocked: !!st.blocked, reason: st.reason || null,
    };
  });
}

// as ultimas `limit` sessoes do log permanente, mais nova primeiro (so o que
// trafega pra UI e cortado; o arquivo em disco guarda tudo, sem poda).
function recentSessionsFrom(engine, limit = 100) {
  const list = (engine.usageSessions && engine.usageSessions.sessions) || [];
  return list.slice(-limit).reverse();
}

// resumo pro snapshot/UI (tela Consumo). FONTE UNICA da aba inteira: a serie
// diaria (days, eixo autoritativo), as series empilhadas e a matriz JA
// RECONCILIADAS contra ela (camada _resto), o orcamento por perfil calculado no
// momento do push (mesma conta do gate real), e o log de sessoes. A UI so fatia
// janela e formata; nenhuma definicao de dado mora la. E so leitura/agregacao;
// nao ha como zerar (o registro e permanente, por decisao).
// Invariantes (travados em test/usage.test.js): pra todo dia, a soma dos items
// de stackedSeries[dim] == series[day] e o total de matrixSeries == series[day],
// campo a campo. Janela (hoje/7/30/90) e quem consome que corta, sobre a MESMA
// serie: por isso nao existem mais today/last7/last30 pre-somados aqui (payload
// morto com definicao propria de janela, aposentado na v2.40.0, junto com
// byKind/byAccount/byModel/byProfile que nenhum painel lia).
function usageSummary(engine) {
  const store = engine.usage || defaultUsage();
  const series = Object.entries(store.days)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, b]) => ({ day, ...b }));
  const kindNames = KIND_ORDER.slice();
  const modelNames = Object.keys(store.byModel);
  const accountNames = Object.keys(store.byAccount);
  const byKind = stackedSeriesFor(store, store.daysByKind || {}, kindNames, k => KIND_LABEL[k] || k);
  const byModel = stackedSeriesFor(store, store.daysByModel || {}, modelNames, m => m);
  const byAccount = stackedSeriesFor(store, store.daysByAccount || {}, accountNames, a => a);
  const matrix = matrixSeriesFrom(store);
  const sessions = (engine.usageSessions && engine.usageSessions.sessions) || [];
  return {
    totals: store.totals,
    series,
    // _resto so entra na lista de nomes quando existe resto em algum dia: a UI
    // esconde serie zerada na janela sozinha, entao a camada some naturalmente
    // quando a janela escolhida ja e 100% detalhada
    kindNames: byKind.hasResto ? [...kindNames, RESTO] : kindNames,
    modelNames: byModel.hasResto ? [...modelNames, RESTO] : modelNames,
    accountNames: byAccount.hasResto ? [...accountNames, RESTO] : accountNames,
    matrixKindNames: matrix.hasResto ? [...kindNames, RESTO] : kindNames,
    matrixModelNames: matrix.hasResto ? [...modelNames, RESTO] : modelNames,
    stackedSeries: { byKind: byKind.series, byModel: byModel.series, byAccount: byAccount.series },
    matrixSeries: matrix.series,
    recentSessions: recentSessionsFrom(engine),
    sessionsSince: sessions.length ? sessions[0].at : null,
    budgets: budgetsFrom(store, engine.config && engine.config.claudeProfiles),
    retentionDays: MAX_DAYS,
  };
}

module.exports = {
  USAGE_FILE, defaultUsage, SESSIONS_FILE, defaultSessions, kindFromId, extractUsage, applyUsage,
  recordUsage, usageSummary, localDay, profileSpend, profileBudgetStatus, RESTO,
};
