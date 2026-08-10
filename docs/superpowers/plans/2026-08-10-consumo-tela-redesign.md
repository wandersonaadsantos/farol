# Consumo: releitura da tela Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesenhar a aba Consumo do Farol (`lib/engine/usage.js` + `ui/`) pra bater
com o mock `Consumo v2.dc.html` (claude.ai/design): cartões de KPI com sparkline e
delta, linha do tempo em área empilhada por dimensão com hover, matriz Tipo × Modelo,
orçamento por perfil com medidor, e uma tabela de sessões recentes com referência de PR.

**Architecture:** Backend primeiro (novos buckets diários cruzados em `usage.js` +
log de sessões permanente em arquivo próprio + plumbing do campo `ref` pelos 5
chamadores de `runClaudeStream`), depois funções puras de UI em `ui/pure.js`
(testáveis com `node --test`, mesmo padrão do resto do front), por fim a
marcação/CSS/wiring em `ui/app.js` + `ui/index.html`, um card por vez.

**Tech Stack:** Node puro (zero dependências, invariante 1 do CLAUDE.md), SVG cru
pros gráficos (sem lib de chart), `node --test` como test runner.

## Global Constraints

- Zero pacotes npm novos (invariante 1).
- Texto da UI e comentários em português, **sem travessão** (invariante 6): usar
  vírgula, parênteses ou dois pontos.
- `ui/pure.js` só recebe função pura (sem DOM, sem `STATE`/`SCOPE` globais); o que
  depender de estado global entra por parâmetro.
- Nenhuma cor nova de tema: reusar `--bg/--border/--text/--accent/--muted/--faint/
  --ok/--info/--danger` que já existem em `ui/app.css`. Única cor literal nova:
  `#b394f0` (roxo, série "Ferramentas" do gráfico), como constante local de JS.
- Log de sessões (`usage-sessions.json`) é **permanente, sem poda** (decisão do
  Wanderson, ver spec). Os buckets diários cruzados (`daysByKind` etc.) SEGUEM a
  poda de `MAX_DAYS` que `days` já tem, porque só alimentam gráfico de 90 dias.
- `npm run check && npm test` verde é pré-requisito antes de qualquer commit que
  toque `server.js`/`main.js`/`ui/app.js` (roda `node --check` + a suíte nativa).
- Spec completo: `docs/superpowers/specs/2026-08-10-consumo-tela-redesign-design.md`.
  Não reabra decisões já tomadas lá (cor, estilo de gráfico fixo em área, retenção
  sem limite, dado real em vez de aproximação).

---

## Mapa de interfaces (pra não divergir entre tarefas)

```
usage.js (novo/mudado)
  KIND_ORDER = ['review','self','chat','tool','pushback','outro']
  defaultUsage() -> { totals, days, byKind, byAccount, byModel, byProfileDay,
                       daysByKind, daysByModel, daysByAccount, daysByKindModel }
  defaultSessions() -> { sessions: [] }
  SESSIONS_FILE
  applyUsage(store, day, kind, account, model, u, profileId)   // já existe, ganha os 4 buckets novos
  recordUsage(engine, id, account, resultEvent, model, profileId, ref)  // ganha `ref`
  usageSummary(engine) -> { ...campos atuais, kindNames, modelNames, accountNames,
                             stackedSeries: { byKind, byModel, byAccount },
                             matrixSeries: [{ day, cells: { [kind]: { [model]: bucket } } }],
                             recentSessions: [{ at, day, kind, ref, account, model,
                               profileId, inputTokens, outputTokens, cacheReadTokens,
                               cacheCreationTokens, costUsd, status }] }

ui/pure.js (novo)
  usageMetricVal(b, m)          // já existe, ganha o caso 'custo'
  sparklinePath(vals, w=100, h=26) -> { line, area }
  usageDelta(cur, prev) -> '' | '↑ N%' | '↓ N%'
  usageStackLayers(series, names, colors, W, H) -> { layers, xs, grid, padL, padT, padB, cw, ch, peakIndex, dayTotals, maxV }
  usageHoverIndex(mouseX, geo) -> int
  usageMatrixRows(matrixSeries, kindNames, modelNames, days, metric) -> { rows, colTotals, grand }
  usageSessionRow(s) -> { whenLabel, kindLabel, dotColor, ref, model, tokLabel, costLabel, stLabel, stClass }

ui/app.js (novo/mudado)
  USAGE_KIND_COLOR = { review:'var(--accent)', self:'var(--info)', chat:'var(--ok)',
                        tool:'#b394f0', pushback:'var(--danger)', outro:'var(--faint)' }
  renderUsage()               // já existe, reescrita pra orquestrar as 5 peças abaixo
  drawUsageKpis(el, u, win, metric)
  drawUsageTimeline(el, legendEl, u, metric, win, dim)   // reescrita
  drawUsageMatrix(el, u, win, metric)
  drawUsageBudget(el, u)
  drawUsageSessions(el, u)
```

---

## Task 1: Buckets diários cruzados (`lib/engine/usage.js`)

**Files:**
- Modify: `lib/engine/usage.js` (`defaultUsage`, `applyUsage`)
- Test: `test/usage.test.js`

**Interfaces:**
- Consumes: nada de tarefas anteriores (é a base).
- Produces: `store.daysByKind`, `store.daysByModel`, `store.daysByAccount`,
  `store.daysByKindModel` (chaves `` `${dim}|${day}` `` e `` `${kind}|${model}|${day}` ``),
  usados pela Task 3 (`usageSummary`).

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `test/usage.test.js` (depois do teste
`'applyUsage: profileId opcional cria o bucket byProfileDay com chave composta'`):

```js
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
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/usage.test.js`
Expected: FAIL (`store.daysByKind` é `undefined`, `Cannot read properties of undefined`)

- [ ] **Step 3: Implementar**

Em `lib/engine/usage.js`, trocar `defaultUsage`:

```js
function defaultUsage() {
  return {
    totals: emptyBucket(), days: {}, byKind: {}, byAccount: {}, byModel: {}, byProfileDay: {},
    daysByKind: {}, daysByModel: {}, daysByAccount: {}, daysByKindModel: {},
  };
}
```

Adicionar, perto de `pick`:

```js
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
```

Trocar o corpo de `applyUsage` (mantendo a assinatura):

```js
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
```

(Repare que a linha `addSession(pick(store, 'byModel', modelLabel(model) || 'desconhecido'), u);`
do original vira duas: `modelKey` calculado uma vez e reusado nos buckets novos.)

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/usage.test.js`
Expected: PASS (todos os testes do arquivo, incluindo os 2 novos)

- [ ] **Step 5: Gate de qualidade e commit**

Run: `npm run check && npm test`
Expected: verde

```bash
git add lib/engine/usage.js test/usage.test.js
git commit -m "feat(usage): buckets diarios cruzados por tipo/modelo/conta"
```

---

## Task 2: Log de sessões permanente (`usage-sessions.json`)

**Files:**
- Modify: `lib/engine/usage.js` (`recordUsage`, exports)
- Modify: `server.js` (boot de `this.usageSessions`, facade `recordUsage`)
- Test: `test/usage.test.js`

**Interfaces:**
- Consumes: nada da Task 1 diretamente (é ortogonal), mas fica no mesmo arquivo.
- Produces: `engine.usageSessions = { sessions: [...] }`, `usageMod.SESSIONS_FILE`,
  `usageMod.defaultSessions()`, `recordUsage(engine, id, account, resultEvent, model,
  profileId, ref)` (ganhou o 7º parâmetro `ref`). A Task 4 (plumbing do `ref`) e a
  Task 3 (`usageSummary`) dependem do que sai aqui.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `test/usage.test.js`:

```js
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
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/usage.test.js`
Expected: FAIL (`usage.defaultSessions is not a function`)

- [ ] **Step 3: Implementar**

Em `lib/engine/usage.js`, logo abaixo de `const USAGE_FILE = ...`:

```js
const SESSIONS_FILE = path.join(STATE_DIR, 'usage-sessions.json');

function defaultSessions() { return { sessions: [] }; }

function saveSessions(engine) {
  try { writeJsonAtomic(SESSIONS_FILE, engine.usageSessions); }
  catch (err) { if (engine.log) engine.log('WARN', `salvar usage-sessions.json: ${err.message}`); }
}
```

Trocar `recordUsage` (ganha o parâmetro `ref`, grava a linha permanente):

```js
// registra o consumo de uma sessao que terminou (sucesso OU erro) nos dois lugares:
// o agregado (usage.json, via applyUsage) e o log individual permanente, sem poda
// (usage-sessions.json), que alimenta a tabela "Sessoes recentes" da aba Consumo.
// `ref` e a referencia amigavel mostrada na tela (chave do PR, do chat, ou o
// rotulo da ferramenta); ausente vira null, nunca quebra o registro.
function recordUsage(engine, id, account, resultEvent, model, profileId, ref) {
  const u = extractUsage(resultEvent, model);
  if (!u.inputTokens && !u.outputTokens && !u.cacheReadTokens && !u.cacheCreationTokens) return;
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
    costUsd: u.costUsd, status: (resultEvent && resultEvent.is_error) ? 'erro' : 'ok',
  });
  saveSessions(engine);
  engine.pushState();
}
```

Atualizar `module.exports` no fim do arquivo, acrescentando `SESSIONS_FILE, defaultSessions,`.

Em `server.js`, logo depois da linha que carrega `this.usage` (a que tem
`this.usage = { ...usageMod.defaultUsage(), ...readJson(usageMod.USAGE_FILE, {}, warn) };`):

```js
    // log individual de sessoes, permanente (sem poda, decisao consciente: ver
    // docs/superpowers/specs/2026-08-10-consumo-tela-redesign-design.md). Separado
    // do usage.json pra gravacao do agregado nao reserializar um array que so cresce.
    this.usageSessions = { ...usageMod.defaultSessions(), ...readJson(usageMod.SESSIONS_FILE, {}, warn) };
```

E trocar a fachada `recordUsage`:

```js
  recordUsage(id, account, resultEvent, model, profileId, ref) { return usageMod.recordUsage(this, id, account, resultEvent, model, profileId, ref); }
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/usage.test.js`
Expected: PASS

- [ ] **Step 5: Gate de qualidade e commit**

Run: `npm run check && npm test`
Expected: verde (rodar a suíte inteira aqui importa: `test/facades.test.js` varre
`server.js` e vai conferir a aridade nova de `recordUsage` sozinho)

```bash
git add lib/engine/usage.js server.js test/usage.test.js
git commit -m "feat(usage): log permanente de sessoes individuais (usage-sessions.json)"
```

---

## Task 3: `usageSummary` ganha `stackedSeries`, `matrixSeries` e `recentSessions`

**Files:**
- Modify: `lib/engine/usage.js` (`usageSummary`)
- Test: `test/usage.test.js`

**Interfaces:**
- Consumes: os buckets da Task 1 (`daysByKind/Model/Account/KindModel`) e o log da
  Task 2 (`engine.usageSessions`).
- Produces: `usageSummary(engine)` com os 3 campos novos + `kindNames`/`modelNames`/
  `accountNames`, no formato do "Mapa de interfaces" no topo deste plano. A Task 11
  (linha do tempo), Task 12 (matriz) e Task 14 (sessões) da UI consomem isso.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `test/usage.test.js`:

```js
test('usageSummary expoe stackedSeries, matrixSeries e recentSessions', () => {
  const engine = { usage: usage.defaultUsage(), usageSessions: usage.defaultSessions(), config: {} };
  const u1 = usage.extractUsage({ usage: { input_tokens: 100, output_tokens: 20 }, total_cost_usd: 0.02 }, 'claude-opus-4-8');
  usage.applyUsage(engine.usage, '2026-08-01', 'review', 'trabalho', 'claude-opus-4-8', u1);
  usage.recordUsage(engine, 'a1', 'trabalho', { usage: { input_tokens: 100, output_tokens: 20 }, total_cost_usd: 0.02 }, 'claude-opus-4-8', '', 'biudtech/farol#88');

  const s = usage.usageSummary(engine);
  assert.deepEqual(s.kindNames, ['review', 'self', 'chat', 'tool', 'pushback', 'outro']);
  assert.ok(s.modelNames.includes('Opus 4.8'));
  assert.ok(s.accountNames.includes('trabalho'));

  const dia = s.stackedSeries.byKind.find(d => d.day === '2026-08-01');
  assert.ok(dia, 'stackedSeries.byKind tem o dia gravado');
  const itemReview = dia.items.find(i => i.name === 'review');
  assert.equal(itemReview.label, 'Revisão');
  assert.equal(itemReview.inputTokens, 200, 'soma applyUsage + recordUsage (2 chamadas de 100 cada)');
  const itemSelf = dia.items.find(i => i.name === 'self');
  assert.equal(itemSelf.inputTokens, 0, 'dimensao sem sessao no dia vem com bucket zerado, nao ausente');

  const diaMatrix = s.matrixSeries.find(d => d.day === '2026-08-01');
  assert.equal(diaMatrix.cells.review['Opus 4.8'].inputTokens, 200);

  assert.equal(s.recentSessions.length, 1);
  assert.equal(s.recentSessions[0].ref, 'biudtech/farol#88');
});

test('usageSummary.recentSessions corta em 100 e mostra a mais nova primeiro', () => {
  const engine = { usage: usage.defaultUsage(), usageSessions: usage.defaultSessions(), config: {} };
  for (let i = 0; i < 105; i++) {
    usage.recordUsage(engine, 'a' + i, 'trabalho', { usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 }, 'claude-sonnet-4-5', '', 'ref' + i);
  }
  const s = usage.usageSummary(engine);
  assert.equal(s.recentSessions.length, 100);
  assert.equal(s.recentSessions[0].ref, 'ref104', 'mais nova primeiro');
  assert.equal(engine.usageSessions.sessions.length, 105, 'o arquivo em disco nao foi cortado, so o que trafega pra UI');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/usage.test.js`
Expected: FAIL (`s.stackedSeries` é `undefined`)

- [ ] **Step 3: Implementar**

Em `lib/engine/usage.js`, acrescentar a constante (perto de `KIND_LABEL`):

```js
// ordem fixa das camadas do grafico empilhado: cor estavel mesmo quando um tipo
// nao teve sessao num dia (o dia entra com bucket zerado, nao some da lista).
const KIND_ORDER = ['review', 'self', 'chat', 'tool', 'pushback', 'outro'];
```

Acrescentar as funções auxiliares (perto de `profileBreakdown`):

```js
// re-fatiar daysByKindModel (chave `${kind}|${model}|${day}`) em serie por dia,
// pra UI somar o periodo (7/30/90) que ela mesma escolheu, do mesmo jeito que ja
// faz com `series`. kind e model nunca contem "|", entao o split e seguro.
function matrixSeriesFrom(store) {
  const byDay = {};
  for (const [key, bucket] of Object.entries(store.daysByKindModel || {})) {
    const [kind, model, day] = key.split('|');
    if (!byDay[day]) byDay[day] = {};
    if (!byDay[day][kind]) byDay[day][kind] = {};
    byDay[day][kind][model] = bucket;
  }
  return Object.keys(store.days).sort().map(day => ({ day, cells: byDay[day] || {} }));
}

// idem, pra uma dimensao so (kind, model ou account): devolve, por dia, o bucket
// de cada nome da dimensao (zerado quando aquele nome nao teve sessao no dia).
function stackedSeriesFor(store, map, names, labelFn) {
  const days = Object.keys(store.days).sort();
  return days.map(day => ({
    day,
    items: names.map(name => ({ name, label: labelFn(name), ...(map[`${name}|${day}`] || emptyBucket()) })),
  }));
}

// as ultimas `limit` sessoes do log permanente, mais nova primeiro (so o que
// trafega pra UI e cortado; o arquivo em disco guarda tudo, sem poda).
function recentSessionsFrom(engine, limit = 100) {
  const list = (engine.usageSessions && engine.usageSessions.sessions) || [];
  return list.slice(-limit).reverse();
}
```

Trocar o corpo de `usageSummary`:

```js
function usageSummary(engine) {
  const store = engine.usage || defaultUsage();
  const today = localDay();
  const listOf = (map, keyName, labelFn) => Object.entries(map)
    .map(([k, b]) => ({ [keyName]: k, label: labelFn ? labelFn(k) : k, ...b }))
    .sort((a, b) => b.outputTokens - a.outputTokens);
  const series = Object.entries(store.days)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, b]) => ({ day, ...b }));
  const kindNames = KIND_ORDER.slice();
  const modelNames = Object.keys(store.byModel);
  const accountNames = Object.keys(store.byAccount);
  return {
    totals: store.totals,
    today: store.days[today] || emptyBucket(),
    last7: sumDaysSince(store.days, daysAgo(6)),
    last30: sumDaysSince(store.days, daysAgo(29)),
    byKind: listOf(store.byKind, 'kind', k => KIND_LABEL[k] || k),
    byAccount: listOf(store.byAccount, 'account'),
    byModel: listOf(store.byModel, 'model'),
    byProfile: profileBreakdown(store, engine.config && engine.config.claudeProfiles),
    series,
    kindNames, modelNames, accountNames,
    stackedSeries: {
      byKind: stackedSeriesFor(store, store.daysByKind || {}, kindNames, k => KIND_LABEL[k] || k),
      byModel: stackedSeriesFor(store, store.daysByModel || {}, modelNames, m => m),
      byAccount: stackedSeriesFor(store, store.daysByAccount || {}, accountNames, a => a),
    },
    matrixSeries: matrixSeriesFrom(store),
    recentSessions: recentSessionsFrom(engine),
  };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/usage.test.js`
Expected: PASS

- [ ] **Step 5: Gate de qualidade e commit**

Run: `npm run check && npm test`

```bash
git add lib/engine/usage.js test/usage.test.js
git commit -m "feat(usage): usageSummary expoe serie empilhada, matriz e sessoes recentes"
```

---

## Task 4: Plumbing do `ref` pelos 5 chamadores de `runClaudeStream`

**Files:**
- Modify: `lib/engine/session.js:483` (repassa `opts.ref`)
- Modify: `lib/engine/review.js:356` (`ref: pr.key`)
- Modify: `lib/engine/selfpr.js:557` (`ref: pr.key`)
- Modify: `lib/engine/pushback.js:176` (`ref: pr.key`)
- Modify: `lib/engine/chat.js:73` (`ref: key`)
- Modify: `lib/engine/tools.js:100` (`ref: label`)
- Test: `test/usage.test.js` (novo teste de integração leve)

**Interfaces:**
- Consumes: `recordUsage(engine, id, account, resultEvent, model, profileId, ref)`
  da Task 2.
- Produces: nada de novo pra outras tarefas (é o fim da cadeia do backend).

- [ ] **Step 1: Escrever o teste que falha**

`session.js` já tem `opts.account`/`opts.id` repassados a `engine.recordUsage`; falta
`opts.ref`. Como `test/session-stream.test.js` já stuba `engine.recordUsage` pra
capturar os argumentos (confirme abrindo o arquivo; se o stub for outro formato,
adapte o teste abaixo ao padrão que já existir lá, mantendo a asserção final),
acrescente:

```js
test('runClaudeStream repassa opts.ref pra recordUsage', async () => {
  process.env.FAROL_HEADLESS_CMD = 'echo {"type":"result","subtype":"success","result":"ok","total_cost_usd":0.01,"usage":{"input_tokens":1,"output_tokens":1}}';
  const chamadas = [];
  const engine = {
    config: {}, running: new Map(),
    ghEnv: () => ({}), resolveClaudeAuth: () => ({ kind: 'dir', id: '' }),
    killTree() {}, log() {}, toolSummary: () => '',
    recordUsage(...args) { chamadas.push(args); },
  };
  const { runClaudeStream } = require('../lib/engine/session');
  await runClaudeStream(engine, 'prompt', { id: 'a1', account: 'trabalho', ref: 'biudtech/farol#88' });
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0][5], 'biudtech/farol#88', 'ref e o 6o argumento posicional de recordUsage');
  delete process.env.FAROL_HEADLESS_CMD;
});
```

Se o arquivo `test/session-stream.test.js` já tiver uma suíte com stub de
`runClaudeStream` nesse formato (com `FAROL_HEADLESS_CMD`), prefira colocar este
teste lá em vez de `usage.test.js`, seguindo a convenção do arquivo (mesmo stub de
comando, mesmo shape de `engine` fake).

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/usage.test.js` (ou `test/session-stream.test.js`, conforme
onde o teste foi colocado no Step 1)
Expected: FAIL (`chamadas[0][5]` é `undefined`, porque hoje `recordUsage` só recebe
5 argumentos posicionais dentro de `runClaudeStream`)

- [ ] **Step 3: Implementar**

Em `lib/engine/session.js`, na linha (hoje ~483):

```js
        try { engine.recordUsage(opts.id, opts.account, resultEvent, usedModel, authProfileId); } catch { /* registro é opcional */ }
```

trocar por:

```js
        try { engine.recordUsage(opts.id, opts.account, resultEvent, usedModel, authProfileId, opts.ref); } catch { /* registro é opcional */ }
```

Em `lib/engine/review.js`, dentro de `runHeadlessReview` (hoje ~356):

```js
    const res = await engine.runClaudeStream(promptFinal, {
      id,
      account: engine.accountForPr(pr),
      onModel: (m) => engine.setSessionModel(id, m),
      onEvent: (e) => engine.pushActivity(id, e.kind, e.text)
    });
```

trocar por:

```js
    const res = await engine.runClaudeStream(promptFinal, {
      id,
      account: engine.accountForPr(pr),
      ref: pr.key,
      onModel: (m) => engine.setSessionModel(id, m),
      onEvent: (e) => engine.pushActivity(id, e.kind, e.text)
    });
```

Em `lib/engine/selfpr.js`, dentro de `runSelfAnalysis` (hoje ~557):

```js
    const res = await engine.runClaudeStream(engine.selfPromptFor(pr.url), {
      id,
      account: accPr,
      onModel: (m) => engine.setSessionModel(id, m),
      onEvent: (e) => engine.pushActivity(id, e.kind, e.text)
    });
```

trocar por:

```js
    const res = await engine.runClaudeStream(engine.selfPromptFor(pr.url), {
      id,
      account: accPr,
      ref: pr.key,
      onModel: (m) => engine.setSessionModel(id, m),
      onEvent: (e) => engine.pushActivity(id, e.kind, e.text)
    });
```

Em `lib/engine/pushback.js`, dentro de `classifyPushback` (hoje ~176):

```js
  const res = await engine.runClaudeStream(prompt, { id, account: acc });
```

trocar por:

```js
  const res = await engine.runClaudeStream(prompt, { id, account: acc, ref: pr.key });
```

Em `lib/engine/chat.js`, dentro de `chatSend`, na closure `runOnce` (hoje ~73):

```js
  const runOnce = (sid, prompt) => engine.runClaudeStream(prompt, {
    id,
    account: acc,
    extraArgs: sid ? ['--resume', sid] : [],
    onEvent: (e) => {
```

trocar por:

```js
  const runOnce = (sid, prompt) => engine.runClaudeStream(prompt, {
    id,
    account: acc,
    ref: key,
    extraArgs: sid ? ['--resume', sid] : [],
    onEvent: (e) => {
```

Em `lib/engine/tools.js`, dentro de `launchTool` (hoje ~100):

```js
      const res = await engine.runClaudeStream(engine.toolPrompt(name, { scoped, list: scopedList, label: scopeName }), {
        id,
        onEvent: (e) => engine.pushActivity(id, e.kind, e.text)
      });
```

trocar por:

```js
      const res = await engine.runClaudeStream(engine.toolPrompt(name, { scoped, list: scopedList, label: scopeName }), {
        id,
        ref: label,
        onEvent: (e) => engine.pushActivity(id, e.kind, e.text)
      });
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test`
Expected: PASS em tudo (o teste novo do Step 1 e os 5 arquivos mudados não quebram
nenhuma suíte existente: nenhum teste hoje afirma a LISTA de chaves de `opts`, só
comportamento, então acrescentar `ref` é aditivo)

- [ ] **Step 5: Gate de qualidade e commit**

Run: `npm run check && npm test`

```bash
git add lib/engine/session.js lib/engine/review.js lib/engine/selfpr.js lib/engine/pushback.js lib/engine/chat.js lib/engine/tools.js test/usage.test.js
git commit -m "feat(usage): repassa ref (PR/chat/ferramenta) pro log de sessoes"
```

(Se o teste do Step 1 foi colocado em `test/session-stream.test.js` em vez de
`usage.test.js`, ajuste o `git add` de acordo.)

---

## Task 5: `ui/pure.js` — sparkline, delta e o caso `'custo'` de `usageMetricVal`

**Files:**
- Modify: `ui/pure.js`
- Test: `test/ui-pure.test.js` (ou `test/pure.test.js`, confira qual dos dois já
  testa `usageMetricVal` hoje e acrescente lá, pra não duplicar suíte)

**Interfaces:**
- Consumes: nada de backend.
- Produces: `sparklinePath(vals, w, h)`, `usageDelta(cur, prev)`, e
  `usageMetricVal` com o caso `'custo'` novo. Usado pelas Tasks 10 (KPIs) e 11
  (linha do tempo).

- [ ] **Step 1: Escrever o teste que falha**

Localizar o teste existente de `usageMetricVal` (`grep -n "usageMetricVal" test/*.js`)
e acrescentar no MESMO arquivo:

```js
test('usageMetricVal: caso custo le costUsd', () => {
  assert.equal(pure.usageMetricVal({ costUsd: 1.5 }, 'custo'), 1.5);
  assert.equal(pure.usageMetricVal(null, 'custo'), 0);
});

test('sparklinePath: gera line e area proporcionais ao maior valor', () => {
  const { line, area } = pure.sparklinePath([0, 5, 10], 100, 26);
  assert.match(line, /^M0(\.0)?,26/, 'primeiro ponto no eixo (valor 0 -> y=26, base)');
  assert.match(line, /L100(\.0)?,/, 'ultimo ponto no fim da largura');
  assert.match(area, /Z$/, 'area fecha o poligono');
});

test('sparklinePath: serie de 1 ponto nao gera NaN (divisao por zero evitada)', () => {
  const { line } = pure.sparklinePath([7], 100, 26);
  assert.ok(!line.includes('NaN'));
});

test('usageDelta: cresceu, caiu, sem base', () => {
  assert.equal(pure.usageDelta(120, 100), '↑ 20%');
  assert.equal(pure.usageDelta(80, 100), '↓ 20%');
  assert.equal(pure.usageDelta(10, 0), '', 'sem base de comparacao (0 ou ausente) nao mostra chip');
  assert.equal(pure.usageDelta(10, null), '');
});
```

(troque `pure` pelo nome que o arquivo de teste já usa pra `require('../ui/pure')`)

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test <arquivo escolhido no Step 1>`
Expected: FAIL (`pure.sparklinePath is not a function`)

- [ ] **Step 3: Implementar**

Em `ui/pure.js`, trocar `usageMetricVal`:

```js
function usageMetricVal(b, m) {
  b = b || {};
  if (m === 'custo') return b.costUsd || 0;
  if (m === 'input') return b.inputTokens || 0;
  if (m === 'output') return b.outputTokens || 0;
  if (m === 'cache') return (b.cacheReadTokens || 0) + (b.cacheCreationTokens || 0);
  return (b.inputTokens || 0) + (b.outputTokens || 0); // total
}
```

Acrescentar, perto dela:

```js
// path SVG de uma sparkline (linha + area fechada), normalizado pro maior valor
// da serie. w/h em unidades do viewBox (a UI usa 100x26, igual ao mock).
function sparklinePath(vals, w = 100, h = 26) {
  const n = (vals || []).length;
  if (!n) return { line: '', area: '' };
  const mx = Math.max(1e-9, ...vals);
  const dx = n > 1 ? w / (n - 1) : 0;
  const pts = vals.map((v, i) => `${(i * dx).toFixed(1)},${(h - (h - 2) * (v / mx)).toFixed(1)}`);
  return { line: 'M' + pts.join('L'), area: `M0,${h}L${pts.join('L')}L${w},${h}Z` };
}

// chip de variacao percentual (cur vs prev). Sem base valida (prev ausente ou
// zero) nao da pra comparar, entao nao mostra nada, em vez de "Infinity%".
function usageDelta(cur, prev) {
  if (!prev || prev <= 0) return '';
  const pc = Math.round(((cur - prev) / prev) * 100);
  return (pc >= 0 ? '↑ ' : '↓ ') + Math.abs(pc) + '%';
}
```

Acrescentar `sparklinePath, usageDelta,` no `module.exports` do rodapé.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test <arquivo do Step 1>`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ui/pure.js test/<arquivo-usado>.test.js
git commit -m "feat(ui): sparkline, delta e metrica custo em ui/pure.js"
```

---

## Task 6: `ui/pure.js` — geometria da linha do tempo empilhada (`usageStackLayers`)

**Files:**
- Modify: `ui/pure.js`
- Test: mesmo arquivo de teste da Task 5

**Interfaces:**
- Consumes: nada além de arrays simples (função pura, sem dependência de outra task).
- Produces: `usageStackLayers(series, names, colors, W, H)` e `usageHoverIndex(mouseX, geo)`.
  A Task 11 (linha do tempo na UI) monta `series`/`names`/`colors` a partir de
  `STATE.usage.stackedSeries` (Task 3) e chama esta função pra desenhar.

- [ ] **Step 1: Escrever o teste que falha**

```js
test('usageStackLayers: empilha 2 camadas, area soma os dois valores no topo', () => {
  const series = [[10, 5], [20, 5], [0, 0]]; // 3 dias, 2 camadas cada
  const geo = pure.usageStackLayers(series, ['a', 'b'], ['#111', '#222'], 200, 100);
  assert.equal(geo.layers.length, 2);
  assert.equal(geo.layers[0].color, '#111');
  assert.equal(geo.dayTotals[0], 15);
  assert.equal(geo.dayTotals[1], 25);
  assert.equal(geo.peakIndex, 1, 'dia com maior total (25) e o indice 1');
  assert.equal(geo.xs.length, 3);
  assert.ok(!geo.layers[0].d.includes('NaN'));
});

test('usageStackLayers: dia todo zerado nao quebra (maxV nunca fica 0)', () => {
  const geo = pure.usageStackLayers([[0, 0], [0, 0]], ['a', 'b'], ['#111', '#222'], 200, 100);
  assert.ok(!geo.layers[0].d.includes('NaN'));
  assert.ok(!geo.layers[0].d.includes('Infinity'));
});

test('usageHoverIndex: mapeia posicao do mouse pro dia mais proximo, limitado as bordas', () => {
  const geo = pure.usageStackLayers([[1], [2], [3], [4]], ['a'], ['#111'], 200, 100);
  assert.equal(pure.usageHoverIndex(geo.padL - 50, geo), 0, 'antes do inicio -> primeiro dia');
  assert.equal(pure.usageHoverIndex(geo.padL + geo.cw + 50, geo), 3, 'depois do fim -> ultimo dia');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test <arquivo da Task 5>`
Expected: FAIL (`pure.usageStackLayers is not a function`)

- [ ] **Step 3: Implementar**

Em `ui/pure.js`:

```js
// camadas de area empilhada + grade, pra linha do tempo do Consumo. `series` e um
// array por dia, cada item um array de valores (1 por camada, MESMA ordem de
// `names`), ja na metrica escolhida (usageMetricVal ja aplicado por quem chama).
function usageStackLayers(series, names, colors, W, H) {
  const padL = 46, padR = 14, padT = 12, padB = 22;
  const cw = W - padL - padR, ch = H - padT - padB, n = series.length;
  const dayTotals = series.map(vals => vals.reduce((a, b) => a + b, 0));
  const maxV = Math.max(1e-9, ...dayTotals) * 1.06;
  const yOf = v => padT + ch * (1 - v / maxV);
  const xs = (n > 1 ? series.map((_, i) => padL + i * (cw / (n - 1))) : [padL + cw / 2]);
  const r1 = v => Math.round(v * 10) / 10;
  const cum = series.map(() => 0);
  const layers = names.map((name, li) => {
    const base = cum.slice();
    for (let i = 0; i < n; i++) cum[i] += (series[i][li] || 0);
    let d = 'M' + r1(xs[0]) + ',' + r1(yOf(cum[0]));
    for (let i = 1; i < n; i++) d += 'L' + r1(xs[i]) + ',' + r1(yOf(cum[i]));
    for (let i = n - 1; i >= 0; i--) d += 'L' + r1(xs[i]) + ',' + r1(yOf(base[i]));
    return { name, color: colors[li % colors.length], d: d + 'Z' };
  });
  const grid = [maxV, maxV / 2, 0].map(v => ({ y: r1(yOf(v)), value: v }));
  let peakIndex = 0;
  for (let i = 1; i < n; i++) if (dayTotals[i] > dayTotals[peakIndex]) peakIndex = i;
  return { layers, xs: xs.map(r1), grid, padL, padT, padB, cw, ch, W, H, peakIndex, dayTotals, maxV };
}

// indice do dia mais proximo de um X de mouse (coordenadas do MESMO viewBox usado
// em usageStackLayers), limitado as bordas da serie.
function usageHoverIndex(mouseX, geo) {
  const n = geo.xs.length;
  if (n <= 1) return 0;
  const step = geo.cw / (n - 1);
  const idx = Math.round((mouseX - geo.padL) / step);
  return Math.max(0, Math.min(n - 1, idx));
}
```

Acrescentar `usageStackLayers, usageHoverIndex,` no `module.exports`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test <arquivo da Task 5>`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ui/pure.js test/<arquivo-usado>.test.js
git commit -m "feat(ui): geometria da area empilhada e hover da linha do tempo"
```

---

## Task 7: `ui/pure.js` — matriz Tipo × Modelo (`usageMatrixRows`)

**Files:**
- Modify: `ui/pure.js`
- Test: mesmo arquivo das Tasks 5/6

**Interfaces:**
- Consumes: `usageMetricVal` (Task 5).
- Produces: `usageMatrixRows(matrixSeries, kindNames, modelNames, days, metric)`.
  A Task 12 (matriz na UI) chama com `STATE.usage.matrixSeries`/`kindNames`/
  `modelNames` (Task 3) e `days = usageDayKeysBack(usageState.window)`.

- [ ] **Step 1: Escrever o teste que falha**

```js
test('usageMatrixRows: soma so os dias pedidos, calcula totais e intensidade', () => {
  const matrixSeries = [
    { day: '2026-08-01', cells: { review: { 'Opus 4.8': { inputTokens: 10, outputTokens: 0 }, 'Sonnet 4.5': { inputTokens: 2, outputTokens: 0 } } } },
    { day: '2026-08-02', cells: { review: { 'Opus 4.8': { inputTokens: 30, outputTokens: 0 } } } },
    { day: '2026-07-30', cells: { review: { 'Opus 4.8': { inputTokens: 999, outputTokens: 0 } } } }, // fora da janela
  ];
  const r = pure.usageMatrixRows(matrixSeries, ['review', 'self'], ['Opus 4.8', 'Sonnet 4.5'], ['2026-08-01', '2026-08-02'], 'input');
  const linhaReview = r.rows.find(x => x.kind === 'review');
  assert.equal(linhaReview.cells.find(c => c.model === 'Opus 4.8').value, 40, '10+30, ignora o dia fora da janela');
  assert.equal(linhaReview.cells.find(c => c.model === 'Sonnet 4.5').value, 2);
  assert.equal(linhaReview.total, 42);
  const linhaSelf = r.rows.find(x => x.kind === 'self');
  assert.equal(linhaSelf.total, 0, 'tipo sem dado nenhum vem zerado, nao ausente');
  assert.equal(r.grand, 42);
  assert.equal(linhaReview.cells.find(c => c.model === 'Opus 4.8').intensity, 1, 'maior celula tem intensidade 1');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test <arquivo>`
Expected: FAIL (`pure.usageMatrixRows is not a function`)

- [ ] **Step 3: Implementar**

Em `ui/pure.js`:

```js
// matriz Tipo x Modelo pro periodo pedido (`days`, as chaves de usageDayKeysBack).
// `matrixSeries` vem inteiro do backend (usage.js), com granularidade diaria; quem
// soma o periodo escolhido e esta funcao, do mesmo jeito que o resto da tela soma
// `series` no cliente. Celula sem dado no periodo vem zerada, nao ausente.
function usageMatrixRows(matrixSeries, kindNames, modelNames, days, metric) {
  const daySet = new Set(days);
  const vals = kindNames.map(() => modelNames.map(() => 0));
  for (const entry of matrixSeries) {
    if (!daySet.has(entry.day)) continue;
    kindNames.forEach((k, i) => {
      const row = entry.cells[k] || {};
      modelNames.forEach((m, j) => { vals[i][j] += usageMetricVal(row[m], metric); });
    });
  }
  const rowTotals = vals.map(row => row.reduce((a, b) => a + b, 0));
  const colTotals = modelNames.map((_, j) => vals.reduce((a, row) => a + row[j], 0));
  const grand = rowTotals.reduce((a, b) => a + b, 0);
  const cellMax = Math.max(1e-9, ...vals.flat());
  const rows = kindNames.map((k, i) => ({
    kind: k,
    cells: modelNames.map((m, j) => ({ model: m, value: vals[i][j], intensity: vals[i][j] / cellMax })),
    total: rowTotals[i],
  }));
  return { rows, colTotals, grand };
}
```

Acrescentar `usageMatrixRows,` no `module.exports`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test <arquivo>`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ui/pure.js test/<arquivo-usado>.test.js
git commit -m "feat(ui): matriz Tipo x Modelo (usageMatrixRows)"
```

---

## Task 8: `ui/pure.js` — formatador de linha da tabela de sessões (`usageSessionRow`)

**Files:**
- Modify: `ui/pure.js`
- Test: mesmo arquivo das Tasks 5/6/7

**Interfaces:**
- Consumes: `fmtTok`, `fmtClock` (já existem em `pure.js`).
- Produces: `usageSessionRow(s, agora)`. A Task 13 (tabela de sessões na UI) mapeia
  `STATE.usage.recentSessions` com esta função.

- [ ] **Step 1: Escrever o teste que falha**

```js
test('usageSessionRow: formata quando, tipo, tokens, custo e estado', () => {
  const agora = Date.parse('2026-08-10T15:00:00-03:00');
  const s = { at: Date.parse('2026-08-10T14:12:00-03:00'), kind: 'review', ref: 'biudtech/farol#88', model: 'Sonnet 5', inputTokens: 80000, outputTokens: 16400, costUsd: 0.41, status: 'ok' };
  const r = pure.usageSessionRow(s, agora);
  assert.match(r.whenLabel, /^hoje /);
  assert.equal(r.kindLabel, 'Revisão');
  assert.equal(r.ref, 'biudtech/farol#88');
  assert.equal(r.model, 'Sonnet 5');
  assert.equal(r.tokLabel, pure.fmtTok(96400));
  assert.equal(r.costLabel, '0.41');
  assert.equal(r.stLabel, 'ok');
  assert.equal(r.stClass, 'ok');
});

test('usageSessionRow: sessao com erro e sem ref', () => {
  const s = { at: Date.now(), kind: 'tool', ref: null, model: 'Haiku 4.5', inputTokens: 1, outputTokens: 1, costUsd: 0, status: 'erro' };
  const r = pure.usageSessionRow(s, Date.now());
  assert.equal(r.ref, '(sem referência)');
  assert.equal(r.stLabel, 'erro');
  assert.equal(r.stClass, 'erro');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test <arquivo>`
Expected: FAIL (`pure.usageSessionRow is not a function`)

- [ ] **Step 3: Implementar**

Em `ui/pure.js` (reusa `fmtClock`, que já existe; para "hoje HH:mm" usa a MESMA
lógica de corte de dia local que `fmtWhenDay` já usa, então reaproveita ela em vez
de duplicar):

```js
const USAGE_KIND_LABEL = { review: 'Revisão', self: 'Autoanálise', pushback: 'Pushback', tool: 'Ferramentas', chat: 'Chat', outro: 'Outro' };

// linha pronta pra tabela de Sessoes recentes: rotulo de tipo, referencia (com
// fallback sem travessao), tokens somados, custo com 2 casas e o estado (ok/erro).
function usageSessionRow(s, agora = Date.now()) {
  return {
    whenLabel: fmtWhenDay(s.at, agora),
    kindLabel: USAGE_KIND_LABEL[s.kind] || s.kind,
    ref: s.ref || '(sem referência)',
    model: s.model || '',
    tokLabel: fmtTok((s.inputTokens || 0) + (s.outputTokens || 0)),
    costLabel: (s.costUsd || 0).toFixed(2),
    stLabel: s.status === 'erro' ? 'erro' : 'ok',
    stClass: s.status === 'erro' ? 'erro' : 'ok',
  };
}
```

Acrescentar `USAGE_KIND_LABEL, usageSessionRow,` no `module.exports`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test <arquivo>`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ui/pure.js test/<arquivo-usado>.test.js
git commit -m "feat(ui): formatador de linha da tabela de sessoes recentes"
```

---

## Task 9: `ui/index.html` + `ui/app.css` — esqueleto novo da aba Consumo

**Files:**
- Modify: `ui/index.html:201-244` (bloco `<section id="tab-consumo">`)
- Modify: `ui/app.css` (bloco `/* --- Consumo de tokens (tela própria) --- */`, hoje
  linhas 942-974)

**Interfaces:**
- Consumes: nada (é marcação/estilo).
- Produces: os ids que as Tasks 10-14 (`ui/app.js`) vão preencher:
  `#usageKpis`, `#usageTimeline` + `#usageLegend`, `#usageMetric` (ganha o botão
  "Custo"), `#usageWindow`, `#usageStack` (era `#usageDim`, perde o botão de
  perfil), `#usageMatrix`, `#usageBudget`, `#usageSessions`.

- [ ] **Step 1: Substituir o bloco em `ui/index.html`**

Trocar todo o conteúdo entre `<!-- ============ CONSUMO ============ -->` e a
tag `</section>` que fecha essa aba (hoje linhas 201-244) por:

```html
  <!-- ============ CONSUMO ============ -->
  <section id="tab-consumo" class="tabpane" role="tabpanel" aria-labelledby="tabbtn-consumo" tabindex="0">
    <div class="section-head">
      <h2>Consumo</h2>
    </div>
    <p class="section-desc">Quanto as sessões autônomas do Claude (revisão, autoanálise, pushback, ferramentas e chat) consomem, em tokens e custo estimado. Mede o Farol como um todo. Registro pessoal e permanente; não influencia nenhuma decisão da automação.</p>

    <div id="usageKpis" class="usage-kpis"></div>

    <div class="card usage-chart-card">
      <div class="usage-chart-head">
        <h3>Linha do tempo</h3>
        <div class="usage-controls">
          <div class="seg" id="usageMetric" role="group" aria-label="Métrica">
            <button class="seg-btn" data-metric="custo" aria-pressed="false">Custo</button>
            <button class="seg-btn active" data-metric="total" aria-pressed="true">Tokens</button>
            <button class="seg-btn" data-metric="input" aria-pressed="false">Input</button>
            <button class="seg-btn" data-metric="output" aria-pressed="false">Output</button>
            <button class="seg-btn" data-metric="cache" aria-pressed="false">Cache</button>
          </div>
          <div class="seg" id="usageWindow" role="group" aria-label="Janela">
            <button class="seg-btn" data-window="7" aria-pressed="false">7 dias</button>
            <button class="seg-btn active" data-window="30" aria-pressed="true">30 dias</button>
            <button class="seg-btn" data-window="90" aria-pressed="false">90 dias</button>
          </div>
          <div class="seg" id="usageStack" role="group" aria-label="Empilhar por">
            <button class="seg-btn active" data-dim="kind" aria-pressed="true">Por tipo</button>
            <button class="seg-btn" data-dim="model" aria-pressed="false">Por modelo</button>
            <button class="seg-btn" data-dim="account" aria-pressed="false">Por conta</button>
          </div>
        </div>
      </div>
      <div id="usageLegend" class="usage-legend"></div>
      <div id="usageTimeline" class="usage-chart"></div>
    </div>

    <div class="usage-grid-2">
      <div class="card usage-chart-card">
        <div class="usage-chart-head">
          <h3>Tipo × Modelo</h3>
          <span id="usageMatrixCaption" class="usage-caption"></span>
        </div>
        <div id="usageMatrix" class="usage-matrix-wrap"></div>
      </div>

      <div class="card usage-chart-card">
        <div class="usage-chart-head">
          <h3>Orçamento por perfil</h3>
          <span class="usage-caption">Sistema → Plano e chaves</span>
        </div>
        <div id="usageBudget" class="usage-budget"></div>
      </div>
    </div>

    <div class="card usage-chart-card">
      <div class="usage-chart-head">
        <h3>Sessões recentes</h3>
        <span class="usage-caption">Sessões com erro também contam no gasto</span>
      </div>
      <div id="usageSessions" class="usage-sessions-wrap"></div>
    </div>
  </section>
```

- [ ] **Step 2: Substituir o bloco CSS em `ui/app.css`**

Trocar o bloco `/* --- Consumo de tokens (tela própria) --- */` (hoje linhas
942-974) por (mantém as classes antigas que ainda servem: `.usage-chart-card`,
`.usage-chart-head`, `.usage-controls`, `.seg`/`.seg-btn`, `.usage-chart`,
`.usage-empty`, `.usvg`; remove `.usage-stats/.usage-stat/.us-label/.us-sub`
(viram `.usage-kpis`/`.usage-kpi`) e `.ubar-*` (a quebra antiga por barra some, a
Task 14 não usa mais)):

```css
/* --- Consumo de tokens (tela própria) --- */
.usage-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-bottom: 14px; }
.usage-kpi { background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px 10px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.usage-kpi-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.usage-kpi-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--faint); font-weight: 600; }
.usage-kpi-delta { font-size: 10.5px; font-weight: 700; color: var(--muted); background: var(--surface); border: 1px solid var(--border); border-radius: 99px; padding: 1px 8px; white-space: nowrap; }
.usage-kpi b { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.25; }
.usage-kpi-sub { font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.usage-kpi-spark { width: 100%; height: 26px; display: block; margin-top: 6px; }

.usage-chart-card { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
.usage-chart-head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; }
.usage-chart-head h3 { margin: 0; font-size: 14px; font-weight: 650; }
.usage-caption { font-size: 11.5px; color: var(--faint); }
.usage-controls { display: flex; gap: 8px; flex-wrap: wrap; }
.seg { display: inline-flex; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 2px; gap: 2px; }
.seg-btn { border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 11.5px; padding: 4px 10px; border-radius: 6px; cursor: pointer; transition: background .12s, color .12s; }
.seg-btn:hover { color: var(--text); }
.seg-btn.active { background: var(--accent); color: var(--accent-ink); font-weight: 600; }
.usage-chart { width: 100%; position: relative; }
.usage-empty { color: var(--faint); font-size: 13px; padding: 22px 4px; text-align: center; }
.usage-legend { display: flex; gap: 4px 16px; flex-wrap: wrap; align-items: center; font-size: 12px; color: var(--muted); }
.usage-legend .dot { width: 8px; height: 8px; border-radius: 2.5px; display: inline-block; margin-right: 6px; }
.usage-legend b { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; margin-left: 4px; }

.usvg { width: 100%; height: auto; display: block; }
.ugrid { stroke: var(--border); stroke-width: 1; opacity: .6; }
.uaxis { fill: var(--faint); font-size: 10px; }
.uaxis-x { text-anchor: middle; }
.uaxis-y { text-anchor: end; }
.usage-tooltip { position: absolute; top: 6px; background: var(--surface); border: 1px solid var(--border); border-radius: 9px; padding: 8px 11px; box-shadow: 0 8px 24px rgba(0,0,0,.25); pointer-events: none; min-width: 150px; z-index: 5; }
.usage-tooltip .ut-head { font-weight: 700; font-size: 11.5px; margin-bottom: 4px; }
.usage-tooltip .ut-row { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--muted); padding: 1px 0; }
.usage-tooltip .ut-row b { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; margin-left: auto; }

.usage-grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 14px; }

.usage-matrix-wrap { overflow-x: auto; }
.usage-matrix { min-width: 320px; display: flex; flex-direction: column; }
.usage-matrix-row { display: grid; align-items: center; gap: 8px; padding: 5px 0; }
.usage-matrix-row.head { padding-bottom: 7px; border-bottom: 1px solid var(--border); }
.usage-matrix-row.foot { padding-top: 7px; border-top: 1px solid var(--border); }
.usage-matrix-row:not(.head):not(.foot) { border-bottom: 1px solid var(--border-soft); }
.usage-matrix-hcell { font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--faint); font-weight: 600; text-align: right; }
.usage-matrix-label { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); white-space: nowrap; }
.usage-matrix-cell { font-size: 12px; color: var(--text); text-align: right; font-variant-numeric: tabular-nums; border-radius: 5px; padding: 3px 7px; }
.usage-matrix-total { font-size: 12px; color: var(--text); font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
.usage-matrix-grand { font-size: 12px; color: var(--accent); font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; }

.usage-budget { display: flex; flex-direction: column; gap: 10px; }
.usage-budget-card { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 11px 13px; display: flex; flex-direction: column; gap: 8px; }
.usage-budget-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.usage-budget-name { font-size: 13px; font-weight: 650; }
.usage-budget-kind { font-size: 10.5px; font-weight: 700; color: var(--muted); background: var(--surface); border: 1px solid var(--border); border-radius: 99px; padding: 1px 8px; }
.usage-budget-status { font-size: 10.5px; font-weight: 700; border-radius: 99px; padding: 1px 8px; margin-left: auto; white-space: nowrap; }
.usage-budget-status.ok { color: var(--ok); background: var(--ok-soft); }
.usage-budget-status.bad { color: var(--danger); background: var(--danger-soft); }
.usage-meter { display: flex; flex-direction: column; gap: 3px; }
.usage-meter-row { display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.usage-meter-track { display: block; height: 6px; background: var(--surface); border-radius: 99px; overflow: hidden; }
.usage-meter-fill { display: block; height: 100%; border-radius: 99px; background: var(--accent); }
.usage-meter-fill.over { background: var(--danger); }
.usage-budget-note { font-size: 11px; color: var(--faint); }

.usage-sessions-wrap { overflow-x: auto; }
.usage-sessions { min-width: 640px; max-height: 380px; overflow-y: auto; }
.usage-sessions-row { display: grid; grid-template-columns: 86px 110px minmax(0,1fr) 84px 64px 70px 56px; gap: 10px; align-items: center; padding: 7px 2px; border-bottom: 1px solid var(--border-soft); font-size: 12.5px; }
.usage-sessions-row.head { border-bottom: 1px solid var(--border); padding-bottom: 8px; }
.usage-sessions-row:hover:not(.head) { background: var(--surface-2); }
.usage-sessions-hcell { font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--faint); font-weight: 600; }
.usage-sessions-hcell.right { text-align: right; }
.usage-sessions-when { color: var(--faint); font-size: 12px; white-space: nowrap; }
.usage-sessions-kind { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); white-space: nowrap; }
.usage-sessions-ref { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.usage-sessions-model { color: var(--muted); white-space: nowrap; }
.usage-sessions-num { text-align: right; font-variant-numeric: tabular-nums; }
.usage-sessions-st { font-size: 10.5px; font-weight: 700; border-radius: 99px; padding: 1px 8px; }
.usage-sessions-st.ok { color: var(--ok); background: var(--ok-soft); }
.usage-sessions-st.erro { color: var(--danger); background: var(--danger-soft); }
.usage-sessions-foot { display: flex; justify-content: space-between; gap: 10px; padding: 8px 2px 0; font-size: 11.5px; color: var(--faint); }
```

- [ ] **Step 3: Conferir sintaxe**

Run: `npm run check`
Expected: PASS (`node --check` não valida HTML/CSS, mas confirma que nada em
`server.js`/`main.js`/`ui/app.js` quebrou; a validação real desta task é visual,
feita junto com a Task 10, já que sem os `render*` novos os containers ficam vazios)

- [ ] **Step 4: Commit**

```bash
git add ui/index.html ui/app.css
git commit -m "feat(ui): esqueleto novo da aba Consumo (KPIs, matriz, orcamento, sessoes)"
```

---

## Task 10: `ui/app.js` — cartões de KPI

**Files:**
- Modify: `ui/app.js` (função nova `drawUsageKpis`, chamada de dentro de `renderUsage`)

**Interfaces:**
- Consumes: `sparklinePath`, `usageDelta` (Task 5); `usageMetricVal` (existente,
  com o caso `'custo'` da Task 5); `usageDayKeysBack` (existente).
- Produces: `drawUsageKpis(el, u, win, metric)`, chamada por `renderUsage` (que
  esta task começa a reescrever; as Tasks 11-14 completam).

- [ ] **Step 1: Implementar `drawUsageKpis`**

Em `ui/app.js`, logo ANTES da definição atual de `drawUsageTimeline` (linha ~2320),
acrescentar:

```js
function fmtMoney(v) { return 'US$ ' + (Number(v) || 0).toFixed(2); }
function fmtUsageMetric(v, metric) { return metric === 'custo' ? fmtMoney(v) : fmtCompact(v); }

// 4 cartoes: Custo/Tokens/Sessoes do periodo escolhido + Hoje, cada um com
// sparkline dos ultimos `win` dias (Hoje usa fixo 14 dias, igual ao mock) e chip
// de delta vs o periodo anterior de mesmo tamanho.
function drawUsageKpis(el, u, win, metric) {
  const map = {}; for (const d of (u.series || [])) map[d.day] = d;
  const janela = usageDayKeysBack(win).map(day => map[day]);
  const anterior = usageDayKeysBack(win * 2).slice(0, win).map(day => map[day]);
  const soma = (list, fn) => list.reduce((a, d) => a + fn(d || {}), 0);
  const curCost = soma(janela, d => d.costUsd || 0);
  const curTok = soma(janela, d => (d.inputTokens || 0) + (d.outputTokens || 0));
  const curSess = soma(janela, d => d.sessions || 0);
  const antCost = soma(anterior, d => d.costUsd || 0);
  const antTok = soma(anterior, d => (d.inputTokens || 0) + (d.outputTokens || 0));
  const antSess = soma(anterior, d => d.sessions || 0);
  const hoje = map[usageDayKeysBack(1)[0]] || {};
  const ontemKey = usageDayKeysBack(2)[0];
  const ontem = map[ontemKey] || {};
  const spark14 = usageDayKeysBack(14).map(day => (map[day] || {}).costUsd || 0);

  const card = (label, big, sub, delta, vals) => {
    const { line, area } = sparklinePath(vals, 100, 26);
    return `<div class="usage-kpi">
      <div class="usage-kpi-head"><span class="usage-kpi-label">${esc(label)}</span>${delta ? `<span class="usage-kpi-delta">${esc(delta)}</span>` : ''}</div>
      <b>${esc(big)}</b>
      <span class="usage-kpi-sub">${esc(sub)}</span>
      <svg viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true" class="usage-kpi-spark">
        <path d="${area}" fill="var(--accent-soft)"></path>
        <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="1.5" vector-effect="non-scaling-stroke"></path>
      </svg>
    </div>`;
  };

  el.innerHTML = [
    card(`Custo estimado · ${win} dias`, fmtMoney(curCost), `~${fmtMoney(curCost / win)} por dia`, usageDelta(curCost, antCost), janela.map(d => (d || {}).costUsd || 0)),
    card(`Tokens · ${win} dias`, fmtCompact(curTok), `${fmtCompact(soma(janela, d => d.inputTokens || 0))} in · ${fmtCompact(soma(janela, d => d.outputTokens || 0))} out`, usageDelta(curTok, antTok), janela.map(d => ((d || {}).inputTokens || 0) + ((d || {}).outputTokens || 0))),
    card(`Sessões · ${win} dias`, String(curSess), `média de ${(curSess / win).toFixed(1)} por dia`, usageDelta(curSess, antSess), janela.map(d => (d || {}).sessions || 0)),
    card('Hoje', fmtMoney(hoje.costUsd || 0), `${fmtCompact((hoje.inputTokens || 0) + (hoje.outputTokens || 0))} tokens · ${hoje.sessions || 0} sessões`, usageDelta(hoje.costUsd || 0, ontem.costUsd || 0), spark14),
  ].join('');
}
```

- [ ] **Step 2: Ligar em `renderUsage`**

`renderUsage` (hoje ~linha 2363) ainda vai ser reescrita nas próximas tasks; por
enquanto, SÓ acrescentar a chamada nova no topo do corpo (sem remover nada ainda,
pra não quebrar o que as Tasks 11-14 ainda dependem):

```js
function renderUsage() {
  const u = STATE && STATE.usage;
  const kpisEl = $('#usageKpis');
  if (kpisEl) {
    if (!u || !u.totals || !u.totals.sessions) kpisEl.innerHTML = '';
    else drawUsageKpis(kpisEl, u, usageState.window, usageState.metric);
  }
  // === resto da funcao atual continua aqui, intacto por enquanto (Tasks 11-14 substituem) ===
```

(Mantenha todo o corpo atual de `renderUsage` depois desse trecho; ele referencia
`#usageStats`/`#usageBreakdown`, que ainda existiam até a Task 9 e já não existem
mais no HTML novo, então `$('#usageStats')` vai devolver `null` e a função vai
retornar cedo pela guarda `if (!statsEl || !tl || !bd) return;` já existente,
zerando o resto do card temporariamente até a Task 11 assumir. Isso é esperado e
temporário: cada task seguinte substitui mais um pedaço.)

- [ ] **Step 3: Verificação visual**

```
FAROL_HOME=<temp> node server.js
```

Semear `<temp>/workspace/state/usage.json` com pelo menos 14 dias de série
(`days`) com valores variados de `costUsd`/tokens/sessions antes de subir, abrir
`http://127.0.0.1:<porta>` no navegador (Browser tool), ir na aba Consumo e
confirmar os 4 cartões de KPI com sparkline e (quando houver período anterior com
dado) o chip de delta.

- [ ] **Step 4: Commit**

```bash
git add ui/app.js
git commit -m "feat(ui): cartoes de KPI com sparkline e delta na aba Consumo"
```

---

## Task 11: `ui/app.js` — linha do tempo empilhada com hover

**Files:**
- Modify: `ui/app.js` (reescreve `drawUsageTimeline`; `usageState` ganha
  `metric: 'total'` continua default, `dim` renomeado conceitualmente pra "stack"
  mas mantém a chave `dim` pra não mexer em mais lugares que precisam)

**Interfaces:**
- Consumes: `usageStackLayers`, `usageHoverIndex` (Task 6); `USAGE_KIND_COLOR`
  (nova constante desta task); `STATE.usage.stackedSeries`/`kindNames`/
  `modelNames`/`accountNames` (Task 3).
- Produces: `drawUsageTimeline(el, legendEl, u, metric, win, dim)`. Chamada por
  `renderUsage` (que esta task edita).

- [ ] **Step 1: Implementar**

Em `ui/app.js`, substituir a função `drawUsageTimeline` inteira (hoje ~linha
2320-2350) por:

```js
// cor por camada: fixa pro tipo (bate com o mock), ciclica pras outras dimensoes
// (modelo/conta), que tem quantidade variavel de nomes.
const USAGE_KIND_COLOR = { review: 'var(--accent)', self: 'var(--info)', chat: 'var(--ok)', tool: '#b394f0', pushback: 'var(--danger)', outro: 'var(--faint)' };
const USAGE_PALETTE = ['var(--accent)', 'var(--info)', 'var(--ok)', '#b394f0', 'var(--danger)', 'var(--faint)'];

function usageColorsFor(dim, names) {
  if (dim === 'kind') return names.map(n => USAGE_KIND_COLOR[n] || 'var(--faint)');
  return names.map((_, i) => USAGE_PALETTE[i % USAGE_PALETTE.length]);
}

let usageHoverIdx = null;

// linha do tempo empilhada (area) por dimensao (tipo/modelo/conta), com legenda,
// grade, marca de pico e tooltip de hover. `u.stackedSeries[dim]` ja vem do
// backend com granularidade diaria (Task 3 de lib/engine/usage.js); aqui so
// fatia a janela escolhida e desenha.
function drawUsageTimeline(el, legendEl, u, metric, win, dim) {
  const key = dim === 'model' ? 'byModel' : dim === 'account' ? 'byAccount' : 'byKind';
  const names = dim === 'model' ? (u.modelNames || []) : dim === 'account' ? (u.accountNames || []) : (u.kindNames || []);
  const labels = {}; // name -> label amigavel, tirado do proprio stackedSeries
  const byDay = {}; for (const d of ((u.stackedSeries || {})[key]) || []) { byDay[d.day] = d.items; for (const it of d.items) labels[it.name] = it.label; }
  const days = usageDayKeysBack(win);
  const series = days.map(day => (byDay[day] || names.map(n => ({ name: n }))).map(it => usageMetricVal(it, metric)));
  const totalPeriodo = series.reduce((a, vals) => a + vals.reduce((x, y) => x + y, 0), 0);
  if (!totalPeriodo) {
    el.innerHTML = '<div class="usage-empty">Sem consumo nesta janela.</div>';
    legendEl.innerHTML = '';
    usageHoverIdx = null;
    return;
  }
  const colors = usageColorsFor(dim, names);
  const W = Math.max(300, Math.round(el.clientWidth || 820)), H = 220;
  const geo = usageStackLayers(series, names, colors, W, H);

  const totalPorNome = names.map((_, i) => series.reduce((a, vals) => a + vals[i], 0));
  legendEl.innerHTML = names.map((n, i) => totalPorNome[i] > 0
    ? `<span><span class="dot" style="background:${colors[i]}"></span>${esc(labels[n] || n)}<b>${esc(fmtUsageMetric(totalPorNome[i], metric))}</b></span>` : '').join('');

  const fmtY = v => fmtUsageMetric(v, metric);
  const step = Math.ceil(days.length / Math.max(3, Math.floor(W / 78)));
  const xlab = days.map((d, i) => (i % step === 0 || i === days.length - 1)
    ? `<text class="uaxis uaxis-x" x="${geo.xs[i]}" y="${H - 6}">${d.slice(8, 10)}/${d.slice(5, 7)}</text>` : '').join('');
  const grid = geo.grid.map(g => `<line x1="${geo.padL}" y1="${g.y}" x2="${W - 14}" y2="${g.y}" class="ugrid"/><text x="${geo.padL - 6}" y="${g.y + 3.5}" class="uaxis uaxis-y">${esc(fmtY(g.value))}</text>`).join('');
  const layerPaths = geo.layers.map(l => `<path d="${l.d}" fill="${l.color}" opacity="0.92"></path>`).join('');
  const peakX = geo.xs[geo.peakIndex];
  const total = `Total ${fmtUsageMetric(totalPeriodo, metric)} em ${days.length} dias, pico de ${fmtUsageMetric(geo.dayTotals[geo.peakIndex], metric)} em ${days[geo.peakIndex]}`;

  el.innerHTML = `<svg role="img" aria-label="${esc(total)}" viewBox="0 0 ${W} ${H}" class="usvg" id="usvgTimeline">
      ${grid}${layerPaths}${xlab}
      ${usageHoverIdx != null ? `<line x1="${geo.xs[usageHoverIdx]}" y1="${geo.padT}" x2="${geo.xs[usageHoverIdx]}" y2="${geo.padT + geo.ch}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"></line>` : ''}
      <rect x="${geo.padL}" y="0" width="${geo.cw}" height="${H}" fill="transparent" style="cursor:crosshair" data-usage-overlay="1"></rect>
    </svg>
    ${usageHoverIdx != null ? drawUsageTooltip(days[usageHoverIdx], series[usageHoverIdx], names, labels, colors, metric, usageHoverIdx, geo, W) : ''}`;

  const svgEl = el.querySelector('#usvgTimeline');
  const overlay = el.querySelector('[data-usage-overlay]');
  if (overlay) {
    overlay.addEventListener('mousemove', (e) => {
      const rect = svgEl.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (W / rect.width);
      const idx = usageHoverIndex(mx, geo);
      if (idx !== usageHoverIdx) { usageHoverIdx = idx; drawUsageTimeline(el, legendEl, u, metric, win, dim); }
    });
    overlay.addEventListener('mouseleave', () => { if (usageHoverIdx != null) { usageHoverIdx = null; drawUsageTimeline(el, legendEl, u, metric, win, dim); } });
  }
}

function drawUsageTooltip(day, vals, names, labels, colors, metric, idx, geo, W) {
  const total = vals.reduce((a, b) => a + b, 0);
  const leftPct = Math.min(82, Math.max(4, (geo.xs[idx] / W) * 100));
  const rows = names.map((n, i) => vals[i] > 0 ? `<div class="ut-row"><span class="dot" style="background:${colors[i]}"></span><span>${esc(labels[n] || n)}</span><b>${esc(fmtUsageMetric(vals[i], metric))}</b></div>` : '').join('');
  return `<div class="usage-tooltip" style="left:${leftPct}%"><div class="ut-head">${esc(day.slice(8, 10))}/${esc(day.slice(5, 7))} · ${esc(fmtUsageMetric(total, metric))}</div>${rows}</div>`;
}
```

Trocar o objeto `usageState` (hoje `{ metric: 'total', window: 30, dim: 'kind' }`)
não muda de forma (mesmas 3 chaves), só o SIGNIFICADO de `dim` passa a ser "por
qual dimensão empilhar o gráfico" em vez de "qual quebra mostrar embaixo" (a
quebra embaixo, `#usageBreakdown`, é removida na Task 14).

Dentro de `renderUsage`, trocar a chamada antiga:

```js
  drawUsageTimeline(tl, u.series, usageState.metric, usageState.window);
```

por:

```js
  drawUsageTimeline($('#usageTimeline'), $('#usageLegend'), u, usageState.metric, usageState.window, usageState.dim);
```

(mantendo por ora as linhas seguintes de `renderUsage` que ainda leem
`#usageBreakdown`/`#usageDimProfile`/`#usageBudgetNote`, que serão substituídas
nas Tasks 12-14).

Em `wireUsageControls`, a linha `bind('#usageDim', 'dim', 'dim');` passa a ler o
novo id:

```js
  bind('#usageStack', 'dim', 'dim');
```

- [ ] **Step 2: Verificação visual**

Mesma instância isolada da Task 10, com `usage.json` semeado cobrindo pelo menos
2 tipos de sessão em dias diferentes. Confirmar: área empilhada com cores
distintas por tipo, legenda com total por tipo, troca de "Empilhar por" muda as
camadas, hover mostra a linha pontilhada + tooltip com a quebra do dia, métrica
"Custo" formata em US$ nos eixos/tooltip.

- [ ] **Step 3: Commit**

```bash
git add ui/app.js
git commit -m "feat(ui): linha do tempo em area empilhada com hover na aba Consumo"
```

---

## Task 12: `ui/app.js` — matriz Tipo × Modelo

**Files:**
- Modify: `ui/app.js` (função nova `drawUsageMatrix`, ligada em `renderUsage`)

**Interfaces:**
- Consumes: `usageMatrixRows` (Task 7); `STATE.usage.matrixSeries`/`kindNames`/
  `modelNames` (Task 3); `USAGE_KIND_COLOR` (Task 11).

- [ ] **Step 1: Implementar**

Em `ui/app.js`, acrescentar depois de `drawUsageTooltip`:

```js
// matriz Tipo x Modelo do periodo escolhido (mesma janela da linha do tempo),
// com heatmap leve (intensidade da celula sobre a maior celula da matriz).
function drawUsageMatrix(el, captionEl, u, metric, win) {
  const days = usageDayKeysBack(win);
  const kindNames = (u.kindNames || []).filter(k => (u.byKind || []).some(x => x.kind === k) || true);
  const modelNames = u.modelNames || [];
  if (!modelNames.length) { el.innerHTML = '<div class="usage-empty">Sem dados ainda.</div>'; captionEl.textContent = ''; return; }
  const m = usageMatrixRows(u.matrixSeries || [], kindNames, modelNames, days, metric);
  if (!m.grand) { el.innerHTML = '<div class="usage-empty">Sem consumo nesta janela.</div>'; captionEl.textContent = ''; return; }
  captionEl.textContent = metric === 'custo' ? 'custo estimado no período' : 'tokens no período';
  const kindLabel = k => USAGE_KIND_LABEL[k] || k;
  const cols = `96px repeat(${modelNames.length}, minmax(0,1fr)) 64px`;
  const head = `<div class="usage-matrix-row head" style="grid-template-columns:${cols}"><span></span>${modelNames.map(mm => `<span class="usage-matrix-hcell">${esc(mm)}</span>`).join('')}<span class="usage-matrix-hcell">Total</span></div>`;
  const rows = m.rows.filter(r => r.total > 0 || m.grand === 0).map(r => `<div class="usage-matrix-row" style="grid-template-columns:${cols}">
      <span class="usage-matrix-label"><span class="dot" style="background:${USAGE_KIND_COLOR[r.kind] || 'var(--faint)'};width:8px;height:8px;border-radius:2.5px;display:inline-block"></span>${esc(kindLabel(r.kind))}</span>
      ${r.cells.map(c => `<span class="usage-matrix-cell" style="background:rgba(255,180,84,${(0.04 + 0.24 * c.intensity).toFixed(2)})" title="${esc(kindLabel(r.kind))} × ${esc(c.model)}: ${esc(fmtUsageMetric(c.value, metric))}">${esc(fmtUsageMetric(c.value, metric))}</span>`).join('')}
      <span class="usage-matrix-total">${esc(fmtUsageMetric(r.total, metric))}</span>
    </div>`).join('');
  const foot = `<div class="usage-matrix-row foot" style="grid-template-columns:${cols}"><span>Total</span>${m.colTotals.map(c => `<span class="usage-matrix-total">${esc(fmtUsageMetric(c, metric))}</span>`).join('')}<span class="usage-matrix-grand">${esc(fmtUsageMetric(m.grand, metric))}</span></div>`;
  el.innerHTML = `<div class="usage-matrix">${head}${rows}${foot}</div>`;
}
```

No corpo de `renderUsage`, acrescentar a chamada (a guarda de "sem sessão nenhuma"
já existe no topo da função):

```js
  drawUsageMatrix($('#usageMatrix'), $('#usageMatrixCaption'), u, usageState.metric, usageState.window);
```

- [ ] **Step 2: Verificação visual**

Mesma instância, `usage.json` com pelo menos 2 tipos × 2 modelos no período.
Confirmar: tabela com linhas de tipo, colunas de modelo, célula mais escura onde
o valor é maior, totais de linha/coluna/geral batendo com a soma manual.

- [ ] **Step 3: Commit**

```bash
git add ui/app.js
git commit -m "feat(ui): matriz Tipo x Modelo na aba Consumo"
```

---

## Task 13: `ui/app.js` — orçamento por perfil

**Files:**
- Modify: `ui/app.js` (função nova `drawUsageBudget`, ligada em `renderUsage`)

**Interfaces:**
- Consumes: `STATE.doctor.claudeAuth` (já existe, expõe `id/label/kind/apiKeyMode/
  today/sinceCutoff/blocked/budgetDaily/budgetTotal` por perfil, conferir o shape
  exato lendo `doctorInfo`/`claudeAuth` em `server.js` antes de implementar, já
  que esta task só LÊ esse contrato, não o cria).

- [ ] **Step 1: Confirmar o shape de `doctor.claudeAuth`**

Rodar: `grep -n "claudeAuth" server.js lib/engine/*.js | head -30` e ler a função
que monta cada item (provavelmente em `lib/parse.js` ou `server.js`, perto de
`doctorInfo`). Confirmar os campos exatos disponíveis por perfil antes do Step 2
(nomes podem diferir ligeiramente do que o trecho de `renderUsage` ATUAL já lê,
que serve de referência mínima: `info.today`, `info.sinceCutoff`, `info.blocked`,
`info.apiKeyMode`, e localizar `label`/`kind`/`budgetDaily`/`budgetTotal`).

- [ ] **Step 2: Implementar**

Em `ui/app.js`, acrescentar depois de `drawUsageMatrix`:

```js
// um cartao por perfil de Claude configurado (Sistema > Assinatura do Claude).
// Perfil de assinatura (kind !== apikey) nao tem teto, so uma nota informativa;
// perfil de chave mostra os 2 medidores (diario/total) vindos do doctor, que ja
// calcula gasto x teto (profileBudgetStatus, lib/engine/usage.js).
function drawUsageBudget(el, u) {
  const perfis = (STATE.doctor && STATE.doctor.claudeAuth) || [];
  if (!perfis.length) { el.innerHTML = '<div class="usage-empty">Nenhum perfil de Claude configurado ainda.</div>'; return; }
  const meter = (label, spent, cap) => {
    const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
    const over = cap > 0 && spent > cap;
    return `<div class="usage-meter">
      <div class="usage-meter-row"><span>${esc(label)}</span><span>${esc(fmtMoney(spent))} / ${esc(fmtMoney(cap))}</span></div>
      <span class="usage-meter-track"><span class="usage-meter-fill${over ? ' over' : ''}" style="width:${Math.max(2, pct).toFixed(0)}%"></span></span>
    </div>`;
  };
  el.innerHTML = perfis.map(p => {
    const isApiKey = !!p.apiKeyMode;
    const statusCls = p.blocked ? 'bad' : 'ok';
    const statusTxt = !isApiKey ? 'coberto pela assinatura' : (p.blocked ? 'orçamento estourado' : 'no orçamento');
    const meters = isApiKey
      ? [p.budgetDaily != null ? meter('Teto diário', p.today || 0, p.budgetDaily) : '', p.budgetTotal != null ? meter('Teto total', p.sinceCutoff || 0, p.budgetTotal) : ''].join('')
      : '';
    const nota = !isApiKey
      ? '<span class="usage-budget-note">Sem teto configurado: o gasto em tokens não vira fatura, só entra no registro.</span>'
      : (p.blocked ? '<span class="usage-budget-note">Automação de gasto pausada pra este perfil (revisão automática, retentativa e scan de pushback).</span>' : '');
    return `<div class="usage-budget-card">
      <div class="usage-budget-head">
        <span class="usage-budget-name">${esc(p.label || p.id)}</span>
        <span class="usage-budget-kind">${isApiKey ? 'Chave de API' : 'Login por assinatura'}</span>
        <span class="usage-budget-status ${statusCls}">${esc(statusTxt)}</span>
      </div>
      ${meters}
      ${nota}
    </div>`;
  }).join('');
}
```

No corpo de `renderUsage`:

```js
  drawUsageBudget($('#usageBudget'), u);
```

- [ ] **Step 3: Verificação visual**

Mesma instância, com `config.json` semeando 1 perfil de assinatura e 1 de chave
com `budgetDaily` perto do gasto do dia (pra ver o medidor quase cheio). Confirmar
os 2 cartões, medidor correto, nota certa em cada tipo.

- [ ] **Step 4: Commit**

```bash
git add ui/app.js
git commit -m "feat(ui): cartoes de orcamento por perfil na aba Consumo"
```

---

## Task 14: `ui/app.js` — sessões recentes e limpeza do código antigo

**Files:**
- Modify: `ui/app.js` (função nova `drawUsageSessions`; `renderUsage` termina de
  ser reescrita; remove `drawUsageBreakdown` e o código morto que ele deixa pra
  trás)
- Modify: `ui/index.html` (se algum id antigo ainda sobrar, conferir que não sobra
  nenhuma referência a `#usageBreakdown`/`#usageDimProfile`/`#usageBudgetNote`
  depois da Task 9; se a Task 9 já os removeu do HTML, este passo é só checagem)

**Interfaces:**
- Consumes: `usageSessionRow` (Task 8); `STATE.usage.recentSessions` (Task 3).
- Produces: `renderUsage` final, sem nenhuma referência a elementos que não
  existem mais.

- [ ] **Step 1: Implementar `drawUsageSessions`**

Em `ui/app.js`, acrescentar depois de `drawUsageBudget`:

```js
// tabela das sessoes mais recentes (ate 100, cortado no backend). Log permanente
// em disco (usage-sessions.json); a UI so mostra as mais novas, com rolagem.
function drawUsageSessions(el, u) {
  const lista = u.recentSessions || [];
  if (!lista.length) { el.innerHTML = '<div class="usage-empty">Nenhuma sessão registrada ainda. Quando o Farol rodar uma revisão, autoanálise, pushback, ferramenta ou chat, o consumo aparece aqui.</div>'; return; }
  const head = `<div class="usage-sessions-row head">
      <span class="usage-sessions-hcell">Quando</span><span class="usage-sessions-hcell">Tipo</span>
      <span class="usage-sessions-hcell">PR / sessão</span><span class="usage-sessions-hcell">Modelo</span>
      <span class="usage-sessions-hcell right">Tokens</span><span class="usage-sessions-hcell right">~US$</span>
      <span class="usage-sessions-hcell right">Estado</span></div>`;
  const rows = lista.map(s => {
    const r = usageSessionRow(s);
    return `<div class="usage-sessions-row">
      <span class="usage-sessions-when">${esc(r.whenLabel)}</span>
      <span class="usage-sessions-kind"><span class="dot" style="background:${USAGE_KIND_COLOR[s.kind] || 'var(--faint)'};width:8px;height:8px;border-radius:2.5px;display:inline-block"></span>${esc(r.kindLabel)}</span>
      <span class="usage-sessions-ref" title="${esc(r.ref)}">${esc(r.ref)}</span>
      <span class="usage-sessions-model">${esc(r.model)}</span>
      <span class="usage-sessions-num">${esc(r.tokLabel)}</span>
      <span class="usage-sessions-num">${esc(r.costLabel)}</span>
      <span style="text-align:right"><span class="usage-sessions-st ${r.stClass}">${esc(r.stLabel)}</span></span>
    </div>`;
  }).join('');
  el.innerHTML = `<div class="usage-sessions">${head}${rows}</div>
    <div class="usage-sessions-foot"><span>Registro permanente, sem botão de zerar.</span><span>Mostrando as ${lista.length} mais recentes</span></div>`;
}
```

- [ ] **Step 2: Reescrever `renderUsage` por completo**

Substituir a função `renderUsage` inteira (a que as Tasks 10-12 foram
incrementando) por esta versão final:

```js
function renderUsage() {
  const u = STATE && STATE.usage;
  const kpisEl = $('#usageKpis'), tl = $('#usageTimeline'), legend = $('#usageLegend');
  const matrix = $('#usageMatrix'), matrixCap = $('#usageMatrixCaption');
  const budget = $('#usageBudget'), sessions = $('#usageSessions');
  if (!kpisEl || !tl || !matrix || !budget || !sessions) return;
  if (!u || !u.totals || !u.totals.sessions) {
    kpisEl.innerHTML = '';
    tl.innerHTML = '<div class="usage-empty">Nenhuma sessão registrada ainda. Quando o Farol rodar uma revisão, autoanálise, pushback, ferramenta ou chat, o consumo aparece aqui.</div>';
    legend.innerHTML = ''; matrix.innerHTML = ''; matrixCap.textContent = '';
    drawUsageBudget(budget, u || {});
    sessions.innerHTML = '';
    return;
  }
  drawUsageKpis(kpisEl, u, usageState.window, usageState.metric);
  drawUsageTimeline(tl, legend, u, usageState.metric, usageState.window, usageState.dim);
  drawUsageMatrix(matrix, matrixCap, u, usageState.metric, usageState.window);
  drawUsageBudget(budget, u);
  drawUsageSessions(sessions, u);
}
```

- [ ] **Step 3: Remover código morto**

Apagar a função `drawUsageBreakdown` inteira (ficou órfã desde a Task 11).
Em `wireUsageControls`, remover qualquer bind que ainda mencione `#usageDimProfile`
(se sobrou algum de antes da Task 9). Rodar:

```
grep -n "usageBreakdown\|usageDimProfile\|usageBudgetNote\|usageStats" ui/app.js ui/index.html
```

Expected: nenhuma ocorrência (a Task 9 já tirou do HTML; este grep confirma que
`ui/app.js` também ficou limpo).

- [ ] **Step 4: Gate de qualidade**

Run: `npm run check && npm test`
Expected: verde (`ui-pure.test.js`/`ui-widgets.test.js`/`ui-semantics.test.js`/
`ui-contract.test.js` não devem quebrar; se algum deles testar strings específicas
do HTML antigo da aba Consumo, ajustar o teste pro texto novo)

- [ ] **Step 5: Verificação visual completa**

Mesma instância isolada, agora com `usage.json` + `usage-sessions.json` semeados
juntos (dados coerentes entre os dois: os totais do log de sessões devem bater
com os agregados). Percorrer os 3 períodos (7/30/90 dias), os 3 modos de
"Empilhar por", as 5 métricas, e o estado vazio (`usage.json` default, sem
nenhuma sessão). Comparar lado a lado com `Consumo v2.dc.html` (aberto no Claude
Design ou salvo localmente) checando: mesma disposição de cartões, mesma
paleta, mesmo comportamento de hover, mesmas colunas na tabela de sessões.

- [ ] **Step 6: Commit**

```bash
git add ui/app.js ui/index.html
git commit -m "feat(ui): tabela de sessoes recentes e limpeza do codigo antigo da aba Consumo"
```

---

## Task 15: Versão, CHANGELOG e verificação final

**Files:**
- Modify: `package.json` (`version`)
- Modify: `CHANGELOG.md`
- Modify: `ui/app.js` (`RELEASE_NOTES`)

**Interfaces:**
- Consumes: nada (é o fechamento do trabalho).
- Produces: nada (fim do plano; a publicação da release em si segue o checklist
  do `CLAUDE.md`, fora deste plano, feita manualmente depois que todas as tasks
  acima estiverem com `npm run check && npm test` verde).

- [ ] **Step 1: Bump de versão**

Em `package.json`, trocar `"version": "2.37.1"` por `"version": "2.38.0"`.

- [ ] **Step 2: `CHANGELOG.md`**

Acrescentar no topo (antes da seção da versão anterior), seguindo o formato que
já existe nas entradas de cima:

```markdown
## v2.38.0

Releitura completa da aba Consumo (desenho do Wanderson no Claude Design):
cartões de KPI com sparkline e variação vs período anterior, linha do tempo em
área empilhada por tipo/modelo/conta com hover, matriz Tipo × Modelo pro período
selecionado, cartões de orçamento por perfil com medidor, e uma tabela de
sessões recentes com a referência do PR/chat/ferramenta de cada sessão (novo log
permanente em `usage-sessions.json`, sem poda). Métrica "Custo" nova ao lado de
Tokens/Input/Output/Cache.
```

- [ ] **Step 3: `RELEASE_NOTES` em `ui/app.js`**

Localizar o array `RELEASE_NOTES` (linha ~2656 hoje) e acrescentar no topo:

```js
  ['2.38.0', ['Consumo redesenhado: cartões de KPI com tendência, linha do tempo empilhada por tipo/modelo/conta com hover, matriz Tipo × Modelo, orçamento por perfil com medidor, e uma tabela de sessões recentes mostrando o PR (ou chat/ferramenta) de cada uma.']],
```

- [ ] **Step 4: Gate de qualidade final**

Run: `npm run check && npm test`
Expected: verde, sem nenhum teste pulado além dos que já pulavam antes desta
mudança (ex.: os testes específicos de macOS no Windows).

- [ ] **Step 5: Commit**

```bash
git add package.json CHANGELOG.md ui/app.js
git commit -m "chore: release v2.38.0"
```

Publicação (fora do escopo deste plano, feita manualmente pelo Wanderson ou por
mim seguindo o checklist do `CLAUDE.md`): `gh auth switch --user
wandersonaadsantos`, `powershell -ExecutionPolicy Bypass -File
tools\publish-release.ps1`, verificar a release no GitHub, `gh auth switch` de
volta pra conta de trabalho.

---

## Self-Review (feito antes de entregar este plano)

**Cobertura do spec:** os 5 blocos do spec (buckets diários cruzados, log de
sessões, plumbing do `ref`, redesenho da UI card a card, testes) têm task
correspondente (Tasks 1-4 backend, 5-8 puro, 9-14 UI, 15 fecha versão). O "fora de
escopo" do spec (CSV, paginação além de 100, migração de dado histórico) não
gerou nenhuma task, de propósito.

**Placeholders:** nenhum "TBD"/"implementar depois" ficou nas tasks. A única
instrução condicional que sobrou é a Task 4 Step 1 ("se o arquivo de teste já
tiver tal formato, adapte"), porque o formato exato do stub em
`test/session-stream.test.js` não foi confirmado por leitura direta antes deste
plano; é uma decisão de ONDE colocar o teste, não de COMO escrevê-lo (o código do
teste em si está completo, com asserção real). Mesma situação na Task 13 Step 1
(shape de `doctor.claudeAuth`): a task manda confirmar por grep antes de
implementar, porque o contrato pertence a outro colaborador (`lib/parse.js`) não
lido em detalhe durante o brainstorming.

**Consistência de tipos:** conferido `recordUsage` (6 chamadas: `applyUsage`
interno mais os 5 call sites) usa sempre `ref` como 7º parâmetro posicional na
função de `usage.js`, e como `opts.ref` nos 5 chamadores de `runClaudeStream`.
`usageStackLayers`/`usageMatrixRows`/`usageSessionRow` usados nas Tasks 11-14 com
os MESMOS nomes e formas de retorno definidos nas Tasks 6-8. `USAGE_KIND_COLOR`
definida uma vez (Task 11) e reusada nas Tasks 12 e 14, não duplicada.
