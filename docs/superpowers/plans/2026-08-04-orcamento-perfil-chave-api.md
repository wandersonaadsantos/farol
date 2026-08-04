# Orçamento por perfil de chave de API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir o tracking de custo em sessões que falham no final (achado real: gasto
invisível no incidente de 04/08) e adicionar um teto diário/total de gasto por perfil de
chave de API, que pausa a automação (não o clique manual) quando estourado.

**Architecture:** `usage.js` ganha um bucket composto `byProfileDay` (chave
`"${profileId}|${dia}"`) e duas funções puras (`profileSpend`, `profileBudgetStatus`) que
comparam gasto acumulado com os tetos do perfil. `session.js` passa a registrar consumo
mesmo em sessão com erro, e resolve/repassa o `profileId` de verdade usado. `server.js`
consulta o status do orçamento antes de disparar auto-revisão nova pra contas ligadas a um
perfil estourado (mesmo padrão do `autoReviewParked` já existente), e expõe o status no
doctor pra UI mostrar. UI: campos de teto no card do perfil, e uma nova opção "Por perfil"
no seletor de dimensão que a aba Consumo já tem (reaproveita `drawUsageBreakdown` sem
mudança nenhuma, porque o shape do bucket é o mesmo de `byAccount`/`byModel`).

**Tech Stack:** Node.js puro (sem dependências novas), `node --test`, UI sem framework.

## Global Constraints

- Zero dependências novas (invariante 1 do `CLAUDE.md`).
- `npm run check && npm test` verde é pré-requisito antes de considerar qualquer task pronta.
- Texto de UI/comentários em português, sem travessão (vírgula, "e", ou parênteses no lugar).
- Orçamento nunca bloqueia clique manual (`launchReview` direto), só o disparo automático
  do `check()`. Decisão explícita, confirmada com o usuário durante o brainstorming.
- Corte de dia é sempre LOCAL (horário de Brasília), nunca UTC — mesma convenção que
  `localDay()` em `lib/engine/usage.js` já usa pro resto do arquivo.
- Perfil `dir` (login por assinatura) nunca participa do orçamento; só `kind:'apikey'`.
- Referência: `docs/superpowers/specs/2026-08-04-orcamento-perfil-chave-api-design.md`
  (spec aprovada).

---

### Task 1: `lib/engine/usage.js` — bucket por perfil, `profileSpend`, `profileBudgetStatus`

**Files:**
- Modify: `lib/engine/usage.js:75-115` (`applyUsage`, `recordUsage`), depois de
  `usageSummary` (linha ~153, antes do `module.exports`)
- Test: `test/usage.test.js`

**Interfaces:**
- Produz: `applyUsage(store, day, kind, account, model, u, profileId)` — `profileId` é o
  6º parâmetro, opcional (chamadas existentes sem ele continuam funcionando).
- Produz: `recordUsage(engine, id, account, resultEvent, model, profileId)` — mesmo:
  `profileId` novo, opcional, no fim.
- Produz: `profileSpend(store, profileId, since)`, `profileBudgetStatus(profile, store)`,
  `profileBreakdown(store, profiles)` — funções puras novas.
- Consumido por: Task 2 (`server.js` chama `profileBudgetStatus` via fachada),
  Task 3 (`session.js` chama `recordUsage` com o novo parâmetro).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `test/usage.test.js`, logo depois do teste
`'applyUsage agrega em todos os eixos (totais, dia, tipo, conta, modelo)'` (existente):

```js
test('applyUsage: profileId opcional cria o bucket byProfileDay com chave composta', () => {
  const store = usage.defaultUsage();
  const u = usage.extractUsage({ usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.01 }, 'claude-opus-4-8');
  usage.applyUsage(store, '2026-08-01', 'review', 'trabalho', 'claude-opus-4-8', u, 'perfil-a');
  assert.ok(store.byProfileDay, 'bucket byProfileDay existe');
  assert.equal(store.byProfileDay['perfil-a|2026-08-01'].inputTokens, 10);
  assert.equal(store.byProfileDay['perfil-a|2026-08-01'].costUsd, 0.01);
});

test('applyUsage: sem profileId (perfil dir/legado) não cria entrada em byProfileDay', () => {
  const store = usage.defaultUsage();
  const u = usage.extractUsage({ usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.01 }, 'claude-opus-4-8');
  usage.applyUsage(store, '2026-08-01', 'review', 'trabalho', 'claude-opus-4-8', u);
  assert.deepEqual(store.byProfileDay || {}, {});
});

test('profileSpend: soma hoje e desde a data de corte, sem vazar entre perfis', () => {
  const store = usage.defaultUsage();
  const u1 = usage.extractUsage({ usage: { input_tokens: 10 }, total_cost_usd: 1 }, 'x');
  const u2 = usage.extractUsage({ usage: { input_tokens: 10 }, total_cost_usd: 2 }, 'x');
  const u3 = usage.extractUsage({ usage: { input_tokens: 10 }, total_cost_usd: 5 }, 'x');
  usage.applyUsage(store, '2026-08-01', 'review', 'a', 'x', u1, 'perfil-a'); // dia antigo, perfil A
  usage.applyUsage(store, '2026-08-04', 'review', 'a', 'x', u2, 'perfil-a'); // hoje, perfil A
  usage.applyUsage(store, '2026-08-04', 'review', 'b', 'x', u3, 'perfil-b'); // hoje, perfil B (não pode vazar pro A)
  const spendHoje = usage.profileSpend(store, 'perfil-a', '2026-08-04');
  assert.equal(Math.round(spendHoje.today * 100) / 100, 2, 'hoje soma só o dia 2026-08-04');
  const spendTotal = usage.profileSpend(store, 'perfil-a', '2026-08-01');
  assert.equal(Math.round(spendTotal.sinceCutoff * 100) / 100, 3, 'desde 08-01 soma os 2 dias do perfil A (1+2), nunca o do B');
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
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/usage.test.js 2>&1 | grep -A 3 "profileSpend\|profileBudgetStatus\|profileBreakdown\|byProfileDay"`
Expected: FAIL — nenhuma dessas funções/parâmetros existe ainda.

- [ ] **Step 3: Implementar em `lib/engine/usage.js`**

Trocar a assinatura de `applyUsage` (linha ~75) e `recordUsage` (linha ~105):

```js
// aplica uma sessão a todos os eixos do store (PURO: não toca em disco nem no relógio;
// recebe o dia pronto, pra ser testável). profileId é opcional: só perfil de chave de API
// participa do bucket byProfileDay (dir/legado chegam sem profileId, ou com '', e não
// geram entrada, ver profileBudgetStatus). Devolve o próprio store.
function applyUsage(store, day, kind, account, model, u, profileId) {
  addSession(store.totals, u);
  addSession(pick(store, 'days', day), u);
  addSession(pick(store, 'byKind', kind), u);
  addSession(pick(store, 'byAccount', account), u);
  addSession(pick(store, 'byModel', modelLabel(model) || 'desconhecido'), u);
  if (profileId) {
    if (!store.byProfileDay) store.byProfileDay = {};
    const key = `${profileId}|${day}`;
    if (!store.byProfileDay[key]) store.byProfileDay[key] = emptyBucket();
    addSession(store.byProfileDay[key], u);
  }
  // poda os dias mais antigos (só a timeline; totais e quebras permanecem)
  const days = Object.keys(store.days).sort();
  if (days.length > MAX_DAYS) for (const d of days.slice(0, days.length - MAX_DAYS)) delete store.days[d];
  return store;
}
```

```js
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
```

Também atualizar `defaultUsage()` (linha ~21) pra incluir a chave nova (evita depender só
do `if (!store.byProfileDay)` acima, deixa explícito no shape default):

```js
function defaultUsage() {
  return { totals: emptyBucket(), days: {}, byKind: {}, byAccount: {}, byModel: {}, byProfileDay: {} };
}
```

Adicionar as 3 funções novas, logo depois de `daysAgo` (linha ~128), antes de `usageSummary`:

```js
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
// os dois estourarem no mesmo instante, o motivo relatado é o diário (mais recente/mais
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
// profileId (não só hoje), no MESMO shape de bucket que byAccount/byModel (sessions/
// tokens/costUsd) + label, pra reusar drawUsageBreakdown (ui/app.js) sem mudança nenhuma
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
```

E `usageSummary` (linha ~133-153) ganha a chave `byProfile` no objeto devolvido:

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
  return {
    totals: store.totals,
    today: store.days[today] || emptyBucket(),
    last7: sumDaysSince(store.days, daysAgo(6)),
    last30: sumDaysSince(store.days, daysAgo(29)),
    byKind: listOf(store.byKind, 'kind', k => KIND_LABEL[k] || k),
    byAccount: listOf(store.byAccount, 'account'),
    byModel: listOf(store.byModel, 'model'),
    byProfile: profileBreakdown(store, engine.config && engine.config.claudeProfiles),
    series
  };
}
```

Por fim, exportar as 3 funções novas no `module.exports` (linha ~155):

```js
module.exports = {
  USAGE_FILE, defaultUsage, kindFromId, extractUsage, applyUsage,
  recordUsage, usageSummary, localDay, profileSpend, profileBudgetStatus, profileBreakdown,
};
```

(confirme o restante da lista de exports contra o arquivo atual antes de sobrescrever —
só ACRESCENTE os 3 nomes novos, não remova nenhum export existente.)

- [ ] **Step 4: Rodar de novo e confirmar que passam**

Run: `node --test test/usage.test.js`
Expected: PASS em TODOS os testes, incluindo os que já existiam antes desta task (nenhuma
assinatura antiga quebrou: `applyUsage`/`recordUsage` sem o parâmetro novo continuam
funcionando, `profileId` é opcional).

- [ ] **Step 5: Rodar o gate completo**

Run: `npm run check && npm test`
Expected: verde nos dois.

- [ ] **Step 6: Commit**

```bash
git add lib/engine/usage.js test/usage.test.js
git commit -m "feat: usage.js ganha bucket e freio de orcamento por perfil de chave de API"
```

---

### Task 2: `lib/parse.js` — sanitização dos campos de orçamento

**Files:**
- Modify: `lib/parse.js:156-181` (`normalizeClaudeProfiles`)
- Test: `test/pure.test.js`

**Interfaces:**
- Produz: perfil `apikey` normalizado passa a incluir `budgetDaily`/`budgetTotal`
  (`number | undefined`) e `budgetSince` (`string YYYY-MM-DD | undefined`) quando
  fornecidos e válidos.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `test/pure.test.js`, logo depois do teste
`'normalizeClaudeProfiles: kind desconhecido (nem dir nem apikey) é tratado como dir'`
(já existente da feature anterior):

```js
test('normalizeClaudeProfiles: budgetDaily/budgetTotal válidos são aceitos como número', () => {
  const out = normalizeClaudeProfiles([
    { id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', budgetDaily: 3, budgetTotal: 20.5 },
  ]);
  assert.equal(out[0].budgetDaily, 3);
  assert.equal(out[0].budgetTotal, 20.5);
});

test('normalizeClaudeProfiles: budgetDaily/budgetTotal malformados (string não numérica, negativo) viram undefined', () => {
  const out = normalizeClaudeProfiles([
    { id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', budgetDaily: 'abc', budgetTotal: -5 },
  ]);
  assert.equal(out[0].budgetDaily, undefined);
  assert.equal(out[0].budgetTotal, undefined);
});

test('normalizeClaudeProfiles: budgetSince válido (YYYY-MM-DD) é aceito, formato errado vira undefined', () => {
  const out = normalizeClaudeProfiles([
    { id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', budgetSince: '2026-08-01' },
    { id: 'p2', label: 'P2', kind: 'apikey', apiKey: 'sk-2', budgetSince: '01/08/2026' },
    { id: 'p3', label: 'P3', kind: 'apikey', apiKey: 'sk-3' },
  ]);
  assert.equal(out[0].budgetSince, '2026-08-01');
  assert.equal(out[1].budgetSince, undefined);
  assert.equal(out[2].budgetSince, undefined);
});

test('normalizeClaudeProfiles: perfil dir nunca ganha campos de orçamento, mesmo se enviados', () => {
  const out = normalizeClaudeProfiles([
    { id: 'p1', label: 'P1', dir: 'C:\\x', budgetDaily: 5 },
  ]);
  assert.equal('budgetDaily' in out[0], false);
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `node --test test/pure.test.js 2>&1 | grep -A 3 "budgetDaily\|budgetTotal\|budgetSince"`
Expected: FAIL — os campos ainda não existem no objeto normalizado.

- [ ] **Step 3: Implementar em `lib/parse.js:161-177`**

Trocar o ramo `apikey` de `normalizeClaudeProfiles` (dentro do `.map`) por:

```js
    if (p && p.kind === 'apikey') {
      const rawApiKey = p.apiKey;
      const rawBaseUrl = p.baseUrl;
      const apiKey = typeof rawApiKey === 'string' ? sanitizeClaudeDir(rawApiKey) : '';
      const baseUrl = typeof rawBaseUrl === 'string' ? sanitizeClaudeDir(rawBaseUrl) : '';
      if ((typeof rawApiKey === 'string' && rawApiKey && !apiKey) ||
          (typeof rawBaseUrl === 'string' && rawBaseUrl && !baseUrl)) {
        return null;
      }
      const out = { id, label, kind: 'apikey', apiKey, baseUrl };
      // orçamento: campos opcionais. Número inválido (NaN, negativo) ou data fora do
      // formato YYYY-MM-DD vira ausente (sem teto), nunca lança e nunca aceita lixo.
      const daily = Number(p.budgetDaily);
      if (Number.isFinite(daily) && daily >= 0) out.budgetDaily = daily;
      const total = Number(p.budgetTotal);
      if (Number.isFinite(total) && total >= 0) out.budgetTotal = total;
      if (typeof p.budgetSince === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.budgetSince)) {
        out.budgetSince = p.budgetSince;
      }
      return out;
    }
```

- [ ] **Step 4: Rodar de novo e confirmar que passam**

Run: `node --test test/pure.test.js`
Expected: PASS em tudo, incluindo os testes de `normalizeClaudeProfiles` já existentes
(kind ausente, aspas/quebra de linha, kind desconhecido).

- [ ] **Step 5: Rodar o gate completo**

Run: `npm run check && npm test`
Expected: verde nos dois.

- [ ] **Step 6: Commit**

```bash
git add lib/parse.js test/pure.test.js
git commit -m "feat: perfil de chave de API aceita campos de orcamento (budgetDaily/Total/Since)"
```

---

### Task 3: `server.js` — `resolveClaudeAuth` ganha `id`, fachadas de orçamento

**Files:**
- Modify: `server.js:923-933` (`resolveClaudeAuth`), `server.js:1003-1014`
  (`allClaudeAuthInfo`), `server.js:1139` (fachada `recordUsage`)
- Test: `test/claude-profiles.test.js`

**Interfaces:**
- Produz: `resolveClaudeAuth(user)` passa a incluir `id` no objeto devolvido (`''` pro
  legado, o `id` do perfil resolvido nos outros casos).
- Produz: `Engine.profileBudgetStatus(profile)` — fachada fina sobre
  `usageMod.profileBudgetStatus`.
- Produz: `Engine.recordUsage(id, account, resultEvent, model, profileId)` — fachada ganha
  o 5º parâmetro.
- Consumido por: Task 4 (`session.js` lê `.id` e chama `recordUsage` com `profileId`),
  Task 5 (gate do `check()` chama `profileBudgetStatus`).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `test/claude-profiles.test.js`, logo depois do bloco de testes de
`resolveClaudeAuth` (da feature anterior):

```js
test('resolveClaudeAuth: devolve o id do perfil resolvido (apikey)', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [{ id: 'chave-x', label: 'Chave X', kind: 'apikey', apiKey: 'sk-1', baseUrl: '' }];
  engine.config.claudeProfileId = 'chave-x';
  assert.equal(engine.resolveClaudeAuth('qualquer').id, 'chave-x');
});

test('resolveClaudeAuth: devolve o id do perfil resolvido (dir)', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [{ id: 'dir-x', label: 'Dir X', dir: 'C:\\x' }];
  engine.config.claudeProfileId = 'dir-x';
  assert.equal(engine.resolveClaudeAuth('qualquer').id, 'dir-x');
});

test('resolveClaudeAuth: legado (sem profiles) devolve id vazio', () => {
  const engine = new Engine();
  engine.config.claudeConfigDir = 'C:\\legado';
  engine.config.claudeProfiles = [];
  assert.equal(engine.resolveClaudeAuth('qualquer').id, '');
});

test('profileBudgetStatus (fachada): delega pro usage.js com this.usage', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [{ id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', budgetDaily: 1 }];
  const profile = engine.config.claudeProfiles[0];
  // sem nenhum uso registrado ainda: não bloqueia
  assert.equal(engine.profileBudgetStatus(profile).blocked, false);
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `node --test test/claude-profiles.test.js 2>&1 | grep -B1 -A 3 "resolveClaudeAuth: devolve o id\|profileBudgetStatus (fachada)"`
Expected: FAIL — `.id` ainda não existe no retorno, `profileBudgetStatus` ainda não existe
na `Engine`.

- [ ] **Step 3: Implementar em `server.js`**

`resolveClaudeAuth` (linha 923-933), acrescentar `id` nos 3 pontos de retorno:

```js
  resolveClaudeAuth(user) {
    const acc = (this.config.accounts || []).find(a => a && a.user === user);
    const profiles = this.config.claudeProfiles || [];
    if (profiles.length) {
      const id = acc?.claudeProfileId || this.config.claudeProfileId || '';
      const p = profiles.find(p => p.id === id);
      if (p?.kind === 'apikey' && p.apiKey) return { kind: 'apikey', id: p.id, apiKey: p.apiKey, baseUrl: p.baseUrl || '' };
      if (p && p.kind !== 'apikey' && p.dir) return { kind: 'dir', id: p.id, dir: p.dir };
    }
    return { kind: 'dir', id: '', dir: this.config.claudeConfigDir || '' };
  }
```

Nova fachada, logo depois de `usageSummary()` (linha 1140):

```js
  profileBudgetStatus(profile) { return usageMod.profileBudgetStatus(profile, this.usage); }
```

Fachada de `recordUsage` (linha 1139) ganha o parâmetro:

```js
  recordUsage(id, account, resultEvent, model, profileId) { return usageMod.recordUsage(this, id, account, resultEvent, model, profileId); }
```

`allClaudeAuthInfo` (linha 1003-1014) passa a incluir o status de orçamento no ramo apikey:

```js
  allClaudeAuthInfo() {
    const profiles = this.config.claudeProfiles || [];
    const legacy = { id: '', label: 'Padrão', ...this.claudeAuthInfo() };
    if (!profiles.length) return [legacy];
    return [legacy, ...profiles.map(p => ({
      id: p.id,
      label: p.label,
      ...(p.kind === 'apikey'
        ? { configDir: null, account: null, ready: !!p.apiKey, apiKeyMode: true, ...this.profileBudgetStatus(p) }
        : this.claudeAuthInfo(p.dir))
    }))];
  }
```

- [ ] **Step 4: Atualizar 4 testes existentes que quebram com o campo `id` novo**

`test/claude-profiles.test.js` já tem 4 chamadas `assert.deepEqual(engine.resolveClaudeAuth(...), {...})`
comparando o objeto INTEIRO sem o campo `id` (`deepEqual` é estrito quanto a chaves extras,
então adicionar `id` no retorno quebra as 4). Atualizar cada uma:

Linha 76 (`'resolveClaudeAuth: sem profiles, cai no legado como kind dir'`):
```js
  assert.deepEqual(engine.resolveClaudeAuth('alice'), { kind: 'dir', id: '', dir: 'C:\\legado' });
```

Linha 87 (`'resolveClaudeAuth: perfil apikey da conta vence o padrão global dir'`, perfil
usado é `chave-pessoal`):
```js
  assert.deepEqual(engine.resolveClaudeAuth('bob'), { kind: 'apikey', id: 'chave-pessoal', apiKey: 'sk-ant-123', baseUrl: '' });
```

Linha 95 (`'resolveClaudeAuth: padrão global apikey, conta sem override'`, perfil usado é
`chave`):
```js
  assert.deepEqual(engine.resolveClaudeAuth('carol'), { kind: 'apikey', id: 'chave', apiKey: 'sk-ant-456', baseUrl: 'https://proxy.x' });
```

Linha 105 (`'resolveClaudeAuth: perfil apikey apontado mas sem apiKey (corrompido) cai no legado'`,
cai no fallback legado, `id` vazio):
```js
  assert.deepEqual(engine.resolveClaudeAuth('qualquer'), { kind: 'dir', id: '', dir: 'C:\\legado' });
```

- [ ] **Step 5: Rodar de novo e confirmar que passam**

Run: `node --test test/claude-profiles.test.js`
Expected: PASS em tudo, incluindo os 4 testes atualizados no Step 4 e os novos do Step 1.

- [ ] **Step 6: Rodar o gate completo**

Run: `npm run check && npm test`
Expected: verde nos dois.

- [ ] **Step 7: Commit**

```bash
git add server.js test/claude-profiles.test.js
git commit -m "feat: resolveClaudeAuth expoe o id do perfil, engine ganha fachada de orcamento"
```

---

### Task 4: `lib/engine/session.js` — registra consumo em sessão com erro + repassa `profileId`

**Files:**
- Modify: `lib/engine/session.js:342-350` (topo de `runClaudeStream`),
  `lib/engine/session.js:437-449` (handler de `close`)
- Test: `test/session-stream.test.js`

**Interfaces:**
- Consome: `engine.resolveClaudeAuth(account).id` (Task 3).
- Consome: `engine.recordUsage(id, account, resultEvent, model, profileId)` (Task 3).

- [ ] **Step 1: Escrever os testes que falham**

Ler primeiro `test/session-stream.test.js` inteiro pra entender o `fakeEngine` usado lá
(ele stuba `recordUsage`). Adicionar um teste novo que capture os argumentos:

```js
test('runClaudeStream: chama recordUsage mesmo quando a sessão termina em erro (achado do incidente de 04/08)', async () => {
  const chamadas = [];
  const engine = fakeEngine({
    recordUsage(id, account, resultEvent, model, profileId) {
      chamadas.push({ id, account, resultEvent, model, profileId });
    }
  });
  // FAROL_HEADLESS_CMD (stub) precisa devolver um envelope com is_error:true E usage
  // preenchido, simulando uma sessão que gastou token nos turnos anteriores e falhou
  // só no evento final (o cenário real do incidente).
  process.env.FAROL_HEADLESS_CMD = `node -e "console.log(JSON.stringify({type:'result', is_error:true, result:'erro simulado', usage:{input_tokens:100,output_tokens:20}, total_cost_usd:0.05}))"`;
  try {
    await assert.rejects(() => sessionMod.runClaudeStream(engine, '/pr-review x', { account: 'bob', id: 'a1' }));
  } finally {
    delete process.env.FAROL_HEADLESS_CMD;
  }
  assert.equal(chamadas.length, 1, 'recordUsage foi chamado mesmo com is_error:true');
  assert.equal(chamadas[0].resultEvent.is_error, true);
  assert.equal(chamadas[0].resultEvent.usage.input_tokens, 100);
});
```

(ajuste o nome exato de `fakeEngine`/como o arquivo constrói o engine falso e importa
`sessionMod` conforme o que já existe em `test/session-stream.test.js` — o teste acima
pressupõe uma função `fakeEngine(overrides)` que faz merge de overrides no engine padrão do
arquivo; se o arquivo usa outro padrão, adapte SÓ a construção do engine falso, mantendo as
asserções sobre `chamadas` como estão.)

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/session-stream.test.js 2>&1 | grep -A 5 "mesmo quando a sess"`
Expected: FAIL — hoje `recordUsage` só é chamado no ramo de sucesso, então `chamadas.length`
seria `0`.

- [ ] **Step 3: Implementar**

No topo de `runClaudeStream` (`lib/engine/session.js:350-351`), calcular o `profileId` uma
vez, junto do `env`:

```js
  return new Promise((resolve, reject) => {
    const env = engine.ghEnv(opts.account);
    const authProfileId = engine.resolveClaudeAuth(opts.account).kind === 'apikey'
      ? engine.resolveClaudeAuth(opts.account).id : '';
```

No handler de `close` (linha 437-449), mover o `recordUsage` pra ANTES do `if
(resultEvent.is_error)`, chamando incondicionalmente:

```js
    child.on('close', (code) => {
      if (lineBuf.trim()) handleLine(lineBuf);
      if (run.cancelled) {
        return finish(Object.assign(new Error('cancelada por você'), { cancelled: true }));
      }
      if (resultEvent) {
        // registra o consumo desta sessão SEMPRE que o evento final existir, mesmo em
        // erro: uma sessão que falhou no passo final ainda pode ter gasto de verdade nos
        // passos anteriores (achado real, 04/08/2026: retry de ~4h que custou dinheiro em
        // sessões que erraram no fim, invisível no usage.json porque só o caminho de
        // sucesso registrava). recordUsage já ignora sessão sem nenhum token (early-return
        // interno), então chamar incondicionalmente é seguro.
        try { engine.recordUsage(opts.id, opts.account, resultEvent, usedModel, authProfileId); } catch { /* registro é opcional */ }
        if (resultEvent.is_error) {
          const detail = String(resultEvent.result || (resultEvent.errors || []).join('; ') || errBuf.trim() || resultEvent.subtype);
          return finish(new Error(`sessão retornou erro: ${detail.slice(0, 300)}`));
        }
        return finish(null, { text: String(resultEvent.result ?? ''), sessionId: resultEvent.session_id || sessionId });
      }
```

- [ ] **Step 4: Rodar de novo e confirmar que passam**

Run: `node --test test/session-stream.test.js`
Expected: PASS em tudo, incluindo os testes já existentes (o `recordUsage` chamado a mais
cedo não muda o comportamento de sucesso, só passa a também rodar no caminho de erro).

- [ ] **Step 5: Rodar o gate completo**

Run: `npm run check && npm test`
Expected: verde nos dois.

- [ ] **Step 6: Commit**

```bash
git add lib/engine/session.js test/session-stream.test.js
git commit -m "fix: registra consumo mesmo quando a sessao termina em erro"
```

---

### Task 5: `server.js` — gate de orçamento no `check()`

**Files:**
- Modify: `server.js:190-196` (Sets do construtor), `server.js:650-656` (`toReview`)
- Test: `test/check-resilience.test.js` (ou o arquivo de teste que já cobre `check()`/
  `toReview` — rode `grep -rn "toReview\|autoReviewParked" test/*.js` pra confirmar qual
  arquivo tem a suíte certa antes de adicionar; se nenhum arquivo existente cobrir
  `toReview` diretamente, criar os testes num arquivo novo `test/budget-gate.test.js`
  seguindo o padrão de `test/claude-profiles.test.js`: `new Engine()` real contra
  `FAROL_HOME` temporário)

**Interfaces:**
- Consome: `this.resolveClaudeAuth(acct)` (Task 3), `this.profileBudgetStatus(profile)`
  (Task 3).
- Produz: `this.budgetWarned` (novo `Set` no construtor).

- [ ] **Step 1: Escrever os testes que falham**

Rodar primeiro: `grep -rln "toReview\|autoReviewParked" test/*.js` pra decidir o arquivo.
Se existir um arquivo de teste que já monta um `Engine` real e chama algo equivalente ao
fluxo de `check()`, adicionar lá; senão, criar `test/budget-gate.test.js`:

```js
'use strict';
// Cobre o gate de orçamento por perfil de chave de API no toReview do check() (server.js).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const HOME = path.join(os.tmpdir(), 'farol-test-budget-gate-' + process.pid);
process.env.FAROL_HOME = HOME;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../server.js');

after(() => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

// monta um PR mínimo e a config necessária pra ele passar por todos os OUTROS filtros do
// toReview (autoReview ligado, token presente, sem estar parked/inflight/retry), isolando
// o comportamento do gate de orçamento como a única variável.
function setupPrEAccount(engine, { budgetDaily, budgetTotal, budgetSince } = {}) {
  engine.config.accounts = [{ user: 'bob', owners: ['x'], autoReview: true }];
  engine.tokens = { bob: 't-b' };
  engine.config.claudeProfiles = [{
    id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', baseUrl: '',
    ...(budgetDaily != null ? { budgetDaily } : {}),
    ...(budgetTotal != null ? { budgetTotal } : {}),
    ...(budgetSince != null ? { budgetSince } : {}),
  }];
  engine.config.claudeProfileId = 'p1';
  const pr = { key: 'biudtech/x#1', url: 'https://github.com/biudtech/x/pull/1', account: 'bob' };
  engine.queue = [pr];
  return pr;
}

test('toReview: conta com perfil de orçamento estourado é excluída do disparo automático', () => {
  const engine = new Engine();
  setupPrEAccount(engine, { budgetDaily: 1 });
  // gasto de hoje já no teto
  const { localDay } = require('../lib/engine/usage');
  engine.usage.byProfileDay = { [`p1|${localDay()}`]: { sessions: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 1 } };
  const toReview = engine.queue.filter(p => {
    const acct = engine.accountForPr ? engine.accountForPr(p) : p.account;
    const auth = engine.resolveClaudeAuth(acct);
    if (auth.kind !== 'apikey') return true;
    const profile = (engine.config.claudeProfiles || []).find(x => x.id === auth.id);
    return !(profile && engine.profileBudgetStatus(profile).blocked);
  });
  assert.equal(toReview.length, 0, 'PR não entra na lista de auto-revisão com orçamento estourado');
});

test('toReview: conta com perfil dentro do orçamento continua elegível', () => {
  const engine = new Engine();
  setupPrEAccount(engine, { budgetDaily: 100 });
  const toReview = engine.queue.filter(p => {
    const acct = p.account;
    const auth = engine.resolveClaudeAuth(acct);
    if (auth.kind !== 'apikey') return true;
    const profile = (engine.config.claudeProfiles || []).find(x => x.id === auth.id);
    return !(profile && engine.profileBudgetStatus(profile).blocked);
  });
  assert.equal(toReview.length, 1, 'PR continua elegível quando o gasto não estourou nada');
});

test('toReview: perfil dir (assinatura) nunca é afetado pelo gate de orçamento', () => {
  const engine = new Engine();
  engine.config.accounts = [{ user: 'bob', owners: ['x'], autoReview: true }];
  engine.tokens = { bob: 't-b' };
  engine.config.claudeProfiles = [{ id: 'd1', label: 'Dir', dir: 'C:\\x' }];
  engine.config.claudeProfileId = 'd1';
  const pr = { key: 'biudtech/x#1', url: 'https://github.com/biudtech/x/pull/1', account: 'bob' };
  const auth = engine.resolveClaudeAuth('bob');
  assert.equal(auth.kind, 'dir');
  // gate nem chega a olhar orçamento pra kind dir
});
```

- [ ] **Step 2: Rodar e confirmar o comportamento atual (sem o gate, o 1º teste falharia)**

Run: `node --test test/budget-gate.test.js 2>&1 | grep -A 5 "excluída do disparo"`
Expected: neste ponto o teste ainda passa isolado (ele testa a EXPRESSÃO do filtro
diretamente, não o `check()` de verdade), porque a lógica do filtro já está escrita no
próprio teste como reprodução manual — o que falta é ela estar DENTRO do `toReview` real do
`server.js`. Este step serve pra confirmar que `engine.profileBudgetStatus` (Task 3) e
`engine.resolveClaudeAuth` (Task 3) já existem e respondem certo isoladamente antes de
integrar no `check()` de verdade no Step 3.

- [ ] **Step 3: Implementar em `server.js`**

Construtor (`server.js`, logo depois da linha 196):
```js
    this.autoReviewParked = new Set(); // keys que falharam sem ser rede (ou foram canceladas): aguardam ação manual, não relançam sozinhas
    this.budgetWarned = new Set(); // ids de perfil apikey já avisados de orçamento estourado neste ciclo (evita repetir o toast a cada checagem)
```

`toReview` (`server.js:650-656`):
```js
      const toReview = this.queue.filter(p => {
        const acct = this.accountForPr(p);
        if (this.isMuted(acct)) return false;
        if (!this.autoReviewFor(acct)) return false;
        if (!this.tokenFor(acct)) return false;
        if (inflight.has(p.key)) return false;
        if (this.autoReviewParked.has(p.key)) return false;
        if (this.retryAfterNet.has(p.key)) return false;
        const auth = this.resolveClaudeAuth(acct);
        if (auth.kind === 'apikey') {
          const profile = (this.config.claudeProfiles || []).find(x => x.id === auth.id);
          if (profile && this.profileBudgetStatus(profile).blocked) {
            if (!this.budgetWarned.has(auth.id)) {
              this.budgetWarned.add(auth.id);
              this.emit('toast', { kind: 'error', text: `Orçamento do perfil "${profile.label}" estourado; automação pausada até liberar (clique manual continua liberado).` });
            }
            return false;
          }
          this.budgetWarned.delete(auth.id);
        }
        return true;
      });
```

- [ ] **Step 4: Rodar de novo e confirmar que passam**

Run: `node --test test/budget-gate.test.js`
Expected: PASS.

- [ ] **Step 5: Rodar o gate completo**

Run: `npm run check && npm test`
Expected: verde nos dois. Preste atenção especial a QUALQUER teste existente que cubra
`check()`/`toReview` diretamente (ex.: `test/check-resilience.test.js`,
`test/reentrancy.test.js`) — a mudança de forma do filtro (de uma expressão booleana
encadeada pra um `filter(p => {...})` com corpo) precisa manter EXATAMENTE o mesmo
comportamento pros casos que já eram cobertos (muted, autoReview desligado, sem token,
inflight, parked, retry). Se algum desses testes quebrar, o filtro novo introduziu uma
regressão de ordem/lógica que precisa ser corrigida antes de prosseguir.

- [ ] **Step 6: Commit**

```bash
git add server.js test/budget-gate.test.js
git commit -m "feat: orcamento estourado pausa a auto-revisao do perfil, sem afetar clique manual"
```

---

### Task 6: UI — campos de orçamento no card do perfil

**Files:**
- Modify: `ui/app.js:576-656` (`renderClaudeProfiles`), `ui/app.js:541-557`
  (`claudeAuthBadge`), `ui/app.js` (handler de `change` de `#claudeProfilesManager`,
  bloco `camposEditaveis`)
- Verificação: manual, no navegador (mesma convenção do projeto, sem harness de DOM)

**Interfaces:**
- Consome: `p.budgetDaily`/`p.budgetTotal`/`p.budgetSince` (Task 2),
  `STATE.doctor.claudeAuth[].{today,sinceCutoff,blocked,reason}` (Task 3, via
  `allClaudeAuthInfo`).

- [ ] **Step 1: `claudeAuthBadge` — mostra status de orçamento quando estourado**

Em `ui/app.js:549-553`, dentro do ramo `info.apiKeyMode`, acrescentar o estado de
orçamento (sem remover o que já existe pra `ready`):

```js
  if (info.apiKeyMode) {
    if (!info.ready) return `<span class="a-claude bad" title="Perfil de chave de API sem chave preenchida">SEM CHAVE</span>`;
    if (info.blocked) {
      const motivo = info.reason === 'diario' ? 'orçamento diário' : 'orçamento total';
      return `<span class="a-claude bad" title="${motivo} estourado, automação pausada (clique manual continua liberado)">🔴 ${motivo} estourado</span>`;
    }
    return `<span class="a-claude ok" title="Autenticação por chave de API">🔑 chave configurada</span>`;
  }
```

- [ ] **Step 2: `renderClaudeProfiles` — campos de orçamento no bloco `apikey`**

Em `ui/app.js:615-621` (bloco `fields` quando `isApiKey`), acrescentar os 3 campos e a
linha de status, depois do campo `cp-baseurl`:

```js
    const isApiKey = p.kind === 'apikey';
    const budgetInfo = isApiKey ? ((STATE.doctor && STATE.doctor.claudeAuth) || []).find(x => x.id === p.id) : null;
    const budgetStatusText = budgetInfo
      ? `Hoje: US$ ${(budgetInfo.today || 0).toFixed(2)}${p.budgetDaily != null ? ` de US$ ${p.budgetDaily.toFixed(2)}` : ''}`
        + (p.budgetTotal != null ? ` · Desde ${p.budgetSince || '?'}: US$ ${(budgetInfo.sinceCutoff || 0).toFixed(2)} de US$ ${p.budgetTotal.toFixed(2)}` : '')
      : '';
    const fields = isApiKey ? `
      <div class="a-editrow">
        <input class="cp-apikey" type="password" data-id="${esc(p.id)}" value="${esc(p.apiKey || '')}" placeholder="chave de API" spellcheck="false" autocomplete="off">
        <button class="btn icon sm ghost cp-toggle-key" data-id="${esc(p.id)}" title="Mostrar/ocultar a chave" aria-label="Mostrar/ocultar a chave">👁</button>
      </div>
      <div class="a-editrow">
        <input class="cp-baseurl" data-id="${esc(p.id)}" value="${esc(p.baseUrl || '')}" placeholder="URL base (opcional, deixe em branco pra usar a Anthropic direto)" spellcheck="false">
      </div>
      <div class="a-editrow">
        <input class="cp-budget-daily" type="number" min="0" step="0.01" data-id="${esc(p.id)}" value="${p.budgetDaily != null ? p.budgetDaily : ''}" placeholder="Orçamento diário (US$, opcional)">
        <input class="cp-budget-total" type="number" min="0" step="0.01" data-id="${esc(p.id)}" value="${p.budgetTotal != null ? p.budgetTotal : ''}" placeholder="Orçamento total (US$, opcional)">
        <input class="cp-budget-since" type="date" data-id="${esc(p.id)}" value="${p.budgetSince || ''}" title="Contar o total a partir de">
      </div>
      ${budgetStatusText ? `<div class="a-hint">${esc(budgetStatusText)}</div>` : ''}` : `
      <div class="a-editrow">
        <input class="cp-dir" data-id="${esc(p.id)}" value="${esc(p.dir || '')}" placeholder="C:\\Users\\voce\\.claude-perfil" spellcheck="false">
      </div>`;
```

- [ ] **Step 3: handler de `change` — persistir os 3 campos novos**

Localizar o array `camposEditaveis` (`ui/app.js`, dentro do `addEventListener('change', ...)`
de `#claudeProfilesManager`) e trocar por:

```js
  const camposEditaveis = ['cp-label', 'cp-dir', 'cp-apikey', 'cp-baseurl', 'cp-budget-daily', 'cp-budget-total', 'cp-budget-since'];
  if (camposEditaveis.some(cls => t.classList.contains(cls))) {
    const id = t.dataset.id;
    if ((t.classList.contains('cp-dir') || t.classList.contains('cp-apikey') || t.classList.contains('cp-baseurl'))
        && /["\r\n]/.test(t.value.replace(/^"(.*)"$/s, '$1').trim())) {
      toast('error', 'Esse valor tem aspas ou quebra de linha no meio, não pode ser usado.', 4500);
      return;
    }
    const profiles = (STATE.config.claudeProfiles || []).map(p => {
      if (p.id !== id) return p;
      const next = { ...p };
      if (t.classList.contains('cp-label')) next.label = t.value.trim() || p.label;
      if (t.classList.contains('cp-dir')) next.dir = t.value.trim();
      if (t.classList.contains('cp-apikey')) next.apiKey = t.value.trim();
      if (t.classList.contains('cp-baseurl')) next.baseUrl = t.value.trim();
      if (t.classList.contains('cp-budget-daily')) {
        const v = t.value.trim();
        if (v === '') delete next.budgetDaily; else next.budgetDaily = Number(v);
      }
      if (t.classList.contains('cp-budget-total')) {
        const v = t.value.trim();
        if (v === '') delete next.budgetTotal; else next.budgetTotal = Number(v);
      }
      if (t.classList.contains('cp-budget-since')) {
        const v = t.value.trim();
        if (v === '') delete next.budgetSince; else next.budgetSince = v;
      }
      return next;
    });
    saveClaudeProfiles(profiles);
  }
```

- [ ] **Step 4: rodar o gate de sintaxe**

Run: `npm run check`
Expected: `ok sintaxe validada em 65 arquivos .js`.

- [ ] **Step 5: Verificação manual no navegador**

1. Subir instância isolada: `FAROL_HOME=<pasta temp> node server.js` (ajuste a porta no
   `config.json` do `FAROL_HOME` se precisar rodar junto de outra instância).
2. Sistema > Plano e chaves > criar um perfil "Chave de API" com uma chave qualquer.
3. Editar o perfil salvo: preencher "Orçamento diário" com `0.01`, deixar "Orçamento total"
   vazio.
4. Confirmar que o campo persiste (recarregar a página ou trocar de aba e voltar — o valor
   deve continuar `0.01`).
5. Não há como testar o bloqueio de verdade sem rodar uma sessão real que gaste dinheiro
   (fora de escopo pra este teste manual); confiar nos testes automatizados das Tasks 1/5
   pra essa parte, e usar este passo só pra confirmar que a UI SALVA e MOSTRA os campos
   corretamente.
6. Encerrar a instância de teste.

- [ ] **Step 6: Commit**

```bash
git add ui/app.js
git commit -m "feat(ui): campos de orcamento no card do perfil de chave de API"
```

---

### Task 7: UI — "Por perfil" na aba Consumo

**Files:**
- Modify: `ui/index.html:228-240` (seletor `#usageDim`), `ui/app.js:2260-2273`
  (`wireUsageControls`), `ui/app.js:2240-2258` (`renderUsage`)
- Verificação: manual, no navegador

**Interfaces:**
- Consome: `STATE.usage.byProfile` (Task 1, via `usageSummary`), `STATE.doctor.claudeAuth`
  (Task 3).

- [ ] **Step 1: `ui/index.html` — botão novo no seletor de dimensão**

Em `ui/index.html:232-236`, acrescentar o 4º botão, escondido por padrão (JS decide
mostrar ou não, ver Step 3):

```html
          <div class="seg" id="usageDim" role="group" aria-label="Dimensão">
            <button class="seg-btn active" data-dim="kind" aria-pressed="true">Por tipo</button>
            <button class="seg-btn" data-dim="account" aria-pressed="false">Por conta</button>
            <button class="seg-btn" data-dim="model" aria-pressed="false">Por modelo</button>
            <button class="seg-btn" id="usageDimProfile" data-dim="profile" aria-pressed="false" hidden>Por perfil</button>
          </div>
```

Logo abaixo do `<div id="usageBreakdown" class="usage-chart"></div>` (linha 239),
acrescentar o container da nota de orçamento:

```html
      <div id="usageBreakdown" class="usage-chart"></div>
      <div id="usageBudgetNote" class="a-hint" hidden></div>
```

- [ ] **Step 2: `renderUsage` — inclui o dim `profile` e a nota de orçamento**

Em `ui/app.js:2240-2258`, trocar `renderUsage` por:

```js
function renderUsage() {
  const u = STATE && STATE.usage;
  const statsEl = $('#usageStats'), tl = $('#usageTimeline'), bd = $('#usageBreakdown');
  const dimBtn = $('#usageDimProfile'), noteEl = $('#usageBudgetNote');
  if (!statsEl || !tl || !bd) return;
  // botão "Por perfil" só aparece se existir algum dado de perfil de chave de API
  if (dimBtn) dimBtn.hidden = !(u && u.byProfile && u.byProfile.length);
  if (!u || !u.totals || !u.totals.sessions) {
    statsEl.innerHTML = '';
    tl.innerHTML = '<div class="usage-empty">Nenhuma sessão registrada ainda. Quando o Farol rodar uma revisão, autoanálise, pushback, ferramenta ou chat, o consumo aparece aqui.</div>';
    bd.innerHTML = '';
    if (noteEl) noteEl.hidden = true;
    return;
  }
  const stat = (label, b, extra) => `<div class="usage-stat"><span class="us-label">${label}</span>`
    + `<b>${fmtTok((b.inputTokens || 0) + (b.outputTokens || 0))}<small> tokens</small></b>`
    + `<span class="us-sub">${fmtTok(b.inputTokens)} in · ${fmtTok(b.outputTokens)} out · ${b.sessions}s${extra || ''}</span></div>`;
  const costNote = u.totals.costUsd > 0 ? ` · ~US$ ${u.totals.costUsd.toFixed(2)}` : '';
  statsEl.innerHTML = stat('Total', u.totals, costNote) + stat('Hoje', u.today) + stat('7 dias', u.last7) + stat('30 dias', u.last30);
  drawUsageTimeline(tl, u.series, usageState.metric, usageState.window);
  const data = usageState.dim === 'account' ? u.byAccount
    : usageState.dim === 'model' ? u.byModel
    : usageState.dim === 'profile' ? (u.byProfile || [])
    : u.byKind;
  drawUsageBreakdown(bd, data, usageState.metric);
  // nota de orçamento: só na dimensão "profile", compara gasto (usage.js) com teto
  // configurado (doctor/claudeAuth, que já calcula isso por perfil via profileBudgetStatus)
  if (noteEl) {
    if (usageState.dim === 'profile') {
      const claudeAuth = (STATE.doctor && STATE.doctor.claudeAuth) || [];
      const linhas = (u.byProfile || []).map(item => {
        const info = claudeAuth.find(x => x.id === item.profileId);
        if (!info || !info.apiKeyMode) return '';
        const partes = [];
        if (info.today != null) partes.push(`hoje US$ ${info.today.toFixed(2)}`);
        if (info.sinceCutoff != null) partes.push(`total US$ ${info.sinceCutoff.toFixed(2)}`);
        const selo = info.blocked ? ' 🔴 orçamento estourado' : '';
        return partes.length ? `${esc(item.label)}: ${partes.join(' · ')}${selo}` : '';
      }).filter(Boolean);
      noteEl.innerHTML = linhas.join('<br>');
      noteEl.hidden = !linhas.length;
    } else {
      noteEl.hidden = true;
    }
  }
}
```

- [ ] **Step 3: rodar o gate de sintaxe**

Run: `npm run check`
Expected: `ok sintaxe validada em 65 arquivos .js`.

- [ ] **Step 4: Verificação manual no navegador**

1. Instância isolada de novo (pode reusar a da Task 6).
2. Sem nenhum perfil apikey com uso registrado: ir em Consumo, confirmar que o botão
   "Por perfil" está escondido (`hidden`).
3. Injetar uso sintético via console do navegador pra simular dado (já que gerar uso real
   custaria dinheiro de verdade): `STATE.usage.byProfile = [{profileId:'p1', label:'Teste', sessions:1, inputTokens:100, outputTokens:50, cacheReadTokens:0, cacheCreationTokens:0, costUsd:1.23}]; renderUsage();` no console — confirma que o botão aparece e a barra desenha.
4. Clicar em "Por perfil": confirma que a quebra mostra a barra "Teste".
5. Encerrar a instância de teste.

- [ ] **Step 5: Commit**

```bash
git add ui/index.html ui/app.js
git commit -m "feat(ui): aba Consumo ganha quebra por perfil de chave de API"
```

---

### Task 8: Documentação e gate final

**Files:**
- Modify: `CLAUDE.md` (seção "Assinatura do Claude", parágrafo "Perfil por chave de API")
- Modify: `docs/superpowers/specs/2026-08-04-orcamento-perfil-chave-api-design.md` (status)

**Interfaces:** nenhuma (só documentação).

- [ ] **Step 1: Atualizar o parágrafo "Perfil por chave de API" do `CLAUDE.md`**

Acrescentar ao final do parágrafo existente (procure "Perfil por chave de API (desde a
v2.34.0)"):

```markdown
Desde a vX.Y.Z (ver CHANGELOG), cada perfil de chave pode ter um **orçamento**: teto
diário e/ou total (contado a partir de uma data de corte editável), configurados no mesmo
card do perfil. Estourar qualquer um dos dois pausa a automação (auto-revisão/autoanálise)
das contas ligadas àquele perfil, sem bloquear clique manual; libera sozinho quando o gasto
volta a caber, sem precisar de nenhum botão de "despausar". **Correção importante junto
desta feature**: sessões que terminam em erro agora também registram consumo no
`usage.json` (`lib/engine/usage.js`), porque uma sessão pode gastar tokens de verdade em
turnos anteriores e falhar só no passo final — antes disso, esse gasto ficava invisível na
aba Consumo (achado real de um incidente de 04/08/2026, ~US$ 11 gastos em sessões que nunca
terminaram com sucesso).
```

(preencher `vX.Y.Z` no momento do release, seguindo o checklist de release do `CLAUDE.md`;
não faz parte deste plano decidir a versão agora.)

- [ ] **Step 2: Marcar a spec como entregue**

Em `docs/superpowers/specs/2026-08-04-orcamento-perfil-chave-api-design.md:4`, trocar:

```markdown
Status: **DESENHADO**, aguardando plano de implementação.
```

por:

```markdown
Status: **ENTREGUE na vX.Y.Z** (data). Todo item desta spec está no código e coberto por
`test/usage.test.js`, `test/pure.test.js`, `test/claude-profiles.test.js`,
`test/session-stream.test.js` e `test/budget-gate.test.js`.
```

- [ ] **Step 3: Gate de qualidade completo, do zero**

Run: `npm run check && npm test`
Expected: `ok sintaxe validada em 65 arquivos .js` e TODOS os testes passando (suíte
inteira, não só os arquivos tocados).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-08-04-orcamento-perfil-chave-api-design.md
git commit -m "docs: orcamento por perfil documentado no CLAUDE.md, spec marcada entregue"
```

---

## Nota sobre release

Este plano NÃO inclui o bump de versão/CHANGELOG/publish-release.ps1: por convenção deste
projeto, isso é feito numa passada só depois que TODAS as Tasks acima estão verdes,
decidindo a versão nova conforme a última release publicada no GitHub no momento.
