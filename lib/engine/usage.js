// Concern de consumo de tokens (colaborador). Toda sessão headless do Claude emite um
// evento "result" com usage (input/output/cache) e total_cost_usd; aqui a gente registra
// isso de forma persistente e agregada (por dia, tipo, conta e modelo), sem gastar nada a
// mais. Só leitura do que a sessão já reporta. Funções recebem o engine como ctx; a Engine
// mantém fachadas finas. Ver docs/QUALITY.md.
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR, APP_VERSION } from '../paths.js';
import { writeJsonAtomic } from '../io.js';
import { modelLabel } from '../format.js';
import { TEMPOS } from '../constants.js';

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
    // versao do Farol que gravou esta sessao (pedido do Wanderson, 15/08/2026):
    // so aparece na tabela "Sessoes recentes" da aba Consumo, NUNCA em prompt
    // (recordUsage roda pos-sessao, depois que o Claude ja encerrou). Sessoes
    // gravadas antes desta feature nao tem o campo, e ficam assim pra sempre
    // (registro permanente, sem migracao).
    farol: APP_VERSION,
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

// Janela que define o "custo típico de uma revisão": as revisões do último mês.
const TIPICO_DIAS = 30;
// a duração de um dia sai de TEMPOS, junto das outras do app: número de tempo
// solto no meio do arquivo é violação do gate de qualidade, e com razão.

/* Quanto custa, tipicamente, UMA revisão deste app, medido no próprio histórico
   (pedido do Wanderson, 20/08/2026: "com base nas minhas reviews do mês você pode
   estipular uma média de valor de review justa para o dia a dia").

   É MEDIANA, não média. Medido no histórico real em 20/08/2026, com 144 revisões:
   média US$ 5,68 e mediana US$ 4,11, porque a cauda é longa (o PR mais caro custou
   US$ 29,04, 7x a mediana). A média deixa a estimativa refém de dois PRs gigantes
   do mês e faria o gate barrar revisão comum como se fosse cara; a mediana descreve
   o dia a dia, que é o que a pergunta pede.

   PURA. Sem histórico de revisão na janela devolve 0, e 0 desliga a projeção: o
   gate volta a ser exatamente o de antes desta feature. É a mesma régua do resto
   do app (falta de dado nunca vira ação). */
function custoTipicoDeReview(sessions, agora = Date.now(), dias = TIPICO_DIAS) {
  const corte = agora - dias * TEMPOS.DIA_MS;
  const custos = (Array.isArray(sessions) ? sessions : [])
    .filter(s => s && s.kind === 'review' && s.at >= corte && Number(s.costUsd) > 0)
    .map(s => Number(s.costUsd))
    .sort((a, b) => a - b);
  return mediana(custos);
}

/* Compara o gasto do perfil com os tetos configurados. Dois eixos, e eles mudaram
   junto na v2.48.4:

   1. QUEM PARTICIPA. Antes só `kind:'apikey'`. Agora qualquer perfil com teto, de
      chave OU de assinatura. O teto por assinatura não fala de fatura (assinatura
      não vira cobrança por token), fala de RITMO: é o jeito de o dia a dia caber
      num consumo previsível. Perfil sem teto configurado continua sem bloquear
      nunca, que é o default de todo mundo.

   2. A PROJEÇÃO. `tipico` é o custo de uma revisão (custoTipicoDeReview). O gate
      pergunta se a PRÓXIMA revisão cabe, não se a anterior coube: "se a revisão vai
      estourar o limite, assume que vai estourar" (Wanderson, 20/08/2026). O motivo
      é a assimetria do meio do caminho: sessão não é interrompível sem perder o que
      já foi pago, então cortar depois de começar é o pior dos dois mundos. Decidir
      na porta, com o custo típico em mãos, deixa a revisão que COMEÇOU sempre
      terminar. `tipico = 0` (sem histórico) devolve o comportamento anterior.

   Testa o diário ANTES do total: se os dois estourarem no mesmo instante, o motivo
   relatado é o diário (mais recente, mais acionável). Os motivos separam o que já
   aconteceu do que foi previsto, porque a ação do humano é diferente: `diario` pede
   esperar amanhã, `diario-previsto` pede decidir se aquele PR vale o estouro. */
// mediana de uma lista de números (usada pelo custo típico e pela sugestão de teto)
function mediana(nums) {
  const s = [...nums].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* Teto diário SUGERIDO, medido no próprio histórico (v2.50.0). É o valor que o
   campo vem preenchido, e ele NÃO passa a valer sozinho: só bloqueia depois que
   a pessoa salva (decisão do Wanderson em 20/08/2026, pra automação nunca parar
   sem ninguém ter configurado nada).

   Base: a mediana do gasto dos DIAS ÚTEIS da janela. Dia útil e não todo dia
   porque o fim de semana tem poucos dias medidos e distorce (em 20/08/2026:
   8 dias úteis com mediana US$ 72,31 contra 2 dias de fim de semana com US$
   132,05, e dois dias não sustentam um teto). Quem quiser diferenciar fim de
   semana faz isso pelo teto por dia da semana, que é override explícito.

   POR PERFIL quando há dado dele, senão pelo gasto TOTAL da máquina: perfil de
   assinatura só passou a ter gasto atribuído na v2.49.0, então exigir dado
   próprio deixaria a sugestão vazia justamente em quem mais precisa dela.
   PURA (recebe o "agora"), devolve 0 quando não há o que medir. */
function diaDaSemana(dia) { return new Date(`${dia}T12:00:00`).getDay(); }
function ehDiaUtil(dia) { const d = diaDaSemana(dia); return d !== 0 && d !== 6; }

// { 'YYYY-MM-DD': custo somado } das sessões recebidas
function gastoPorDia(sessions) {
  const porDia = {};
  for (const x of sessions) porDia[x.day] = (porDia[x.day] || 0) + Number(x.costUsd);
  return porDia;
}

function sugestaoTetoDiario(sessions, profileId, agora = Date.now(), dias = TIPICO_DIAS) {
  const corte = agora - dias * TEMPOS.DIA_MS;
  const naJanela = (Array.isArray(sessions) ? sessions : [])
    .filter(x => x && x.at >= corte && Number(x.costUsd) > 0);
  const doPerfil = profileId ? naJanela.filter(x => x.profileId === profileId) : [];
  const porDia = gastoPorDia(doPerfil.length ? doPerfil : naJanela);
  return mediana(Object.keys(porDia).filter(ehDiaUtil).map(d => porDia[d]));
}

/* Teto do DIA, resolvido num lugar só (v2.50.0). É a peça central do orçamento:
   vale igual pra perfil de assinatura e de chave de API, e cada perfil resolve o
   seu de forma independente. Precedência do MAIS ESPECÍFICO pro mais geral:

     1. data única   (budgetDates['2026-08-25'])  ex.: "hoje eu topo gastar mais"
     2. dia da semana (budgetByWeekday['1'])       ex.: sábado é menor
     3. teto base     (budgetDaily)                o de sempre

   PURA e sem relógio: recebe o dia pronto (YYYY-MM-DD), como applyUsage. Devolve
   null quando não há teto nenhum, e null nunca bloqueia.

   O dia da semana sai de meio-dia LOCAL de propósito: com meia-noite, uma virada
   de horário de verão jogaria a data pro dia anterior em parte do ano. */
function dailyCapFor(profile, day) {
  if (!profile) return null;
  const porData = profile.budgetDates && profile.budgetDates[day];
  if (Number.isFinite(porData)) return porData;
  const porDia = profile.budgetByWeekday && profile.budgetByWeekday[String(diaDaSemana(day))];
  if (Number.isFinite(porDia)) return porDia;
  return Number.isFinite(profile.budgetDaily) ? profile.budgetDaily : null;
}

// De onde vem o teto que vale hoje: pra tela poder dizer "sábado" ou "só hoje" em
// vez de mostrar um número que não bate com o campo base e parecer defeito.
function dailyCapSource(profile, day) {
  if (!profile) return 'nenhum';
  if (Number.isFinite(profile.budgetDates && profile.budgetDates[day])) return 'data';
  if (Number.isFinite(profile.budgetByWeekday && profile.budgetByWeekday[String(diaDaSemana(day))])) return 'semana';
  return Number.isFinite(profile.budgetDaily) ? 'base' : 'nenhum';
}

function profileBudgetStatus(profile, store, tipico = 0) {
  if (!profile) return { blocked: false };
  const spend = profileSpend(store, profile.id, profile.budgetSince);
  // O plano ChatGPT nao informa custo por sessao nem saldo de cota ao CLI. Aplicar
  // um teto em US$ ao Codex seria falsa precisao e, pior, a projecao aprendida nas
  // sessoes Claude poderia pausar um perfil Codex que gastou US$ 0.
  if (profile.kind === 'codex') return { blocked: false, today: spend.today, sinceCutoff: spend.sinceCutoff };
  const projecao = Number(tipico) > 0 ? Number(tipico) : 0;
  const veredito = (reason, gasto, teto) => {
    if (teto == null) return null;
    if (gasto >= teto) return { blocked: true, reason, today: spend.today, sinceCutoff: spend.sinceCutoff };
    if (gasto + projecao >= teto) {
      return { blocked: true, reason: `${reason}-previsto`, projetado: projecao, today: spend.today, sinceCutoff: spend.sinceCutoff };
    }
    return null;
  };
  // o teto do dia (base, ou o override de dia da semana / data única) é quem manda
  return veredito('diario', spend.today, dailyCapFor(profile, localDay()))
    || veredito('total', spend.sinceCutoff, profile.budgetTotal)
    || { blocked: false, today: spend.today, sinceCutoff: spend.sinceCutoff };
}

// as duas de cima aplicadas ao engine: existem pra fachada em server.js ficar
// FINA de verdade (uma delegação, sem chamada aninhada dentro dos argumentos),
// que é o que o test/facades.test.js consegue conferir lendo o fonte.
function custoTipicoDoEngine(engine) {
  return custoTipicoDeReview((engine.usageSessions && engine.usageSessions.sessions) || []);
}

function budgetStatusFor(engine, profile) {
  return profileBudgetStatus(profile, engine.usage, custoTipicoDoEngine(engine));
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
function linhaDeOrcamento(p, st, hoje, tipico, sessions) {
  let kind = 'assinatura';
  if (p.kind === 'apikey') kind = 'apikey';
  else if (p.kind === 'codex') kind = 'codex';
  return {
    id: p.id, label: p.label, kind,
    budgetDaily: p.budgetDaily != null ? p.budgetDaily : null,
    budgetTotal: p.budgetTotal != null ? p.budgetTotal : null,
    budgetSince: p.budgetSince || null,
    // overrides por dia: viajam pra UI desenhar o editor. Cópia rasa pra tela
    // nunca mexer no objeto da config por referência.
    budgetByWeekday: { ...(p.budgetByWeekday || {}) },
    budgetDates: { ...(p.budgetDates || {}) },
    // qual teto vale HOJE e de onde ele veio: sem isso a tela mostraria o campo
    // base e o medidor usaria outro número, parecendo defeito
    capHoje: dailyCapFor(p, hoje),
    capOrigem: dailyCapSource(p, hoje),
    today: st.today || 0, sinceCutoff: st.sinceCutoff || 0,
    blocked: !!st.blocked, reason: st.reason || null,
    // o custo típico viaja pra tela poder dizer POR QUE barrou antes de estourar
    tipicoReview: tipico || 0,
    // valor que o campo vem preenchido enquanto não há teto salvo (não bloqueia)
    sugestaoDiaria: p.kind === 'codex' ? 0 : sugestaoTetoDiario(sessions, p.id),
  };
}

function budgetsFrom(store, profiles, tipico = 0, sessions = []) {
  const hoje = localDay();
  return (profiles || []).map(p => linhaDeOrcamento(p, profileBudgetStatus(p, store, tipico), hoje, tipico, sessions));
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
    budgets: budgetsFrom(store, engine.config && engine.config.claudeProfiles, custoTipicoDeReview(sessions), sessions),
    retentionDays: MAX_DAYS,
  };
}

const usageMod = {
  USAGE_FILE, defaultUsage, SESSIONS_FILE, defaultSessions, kindFromId, extractUsage, applyUsage,
  recordUsage, usageSummary, localDay, profileSpend, profileBudgetStatus, RESTO,
  custoTipicoDeReview, custoTipicoDoEngine, budgetStatusFor, budgetsFrom, TIPICO_DIAS,
  dailyCapFor, dailyCapSource, sugestaoTetoDiario, mediana,
};
export default usageMod;
export {
  USAGE_FILE, defaultUsage, SESSIONS_FILE, defaultSessions, kindFromId, extractUsage, applyUsage,
  recordUsage, usageSummary, localDay, profileSpend, profileBudgetStatus, RESTO,
  custoTipicoDeReview, custoTipicoDoEngine, budgetStatusFor, budgetsFrom, TIPICO_DIAS,
  dailyCapFor, dailyCapSource, sugestaoTetoDiario, mediana,
};
