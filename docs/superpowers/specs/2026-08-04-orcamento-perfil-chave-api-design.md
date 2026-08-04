# Orçamento por perfil de chave de API

Data: 2026-08-04
Status: **DESENHADO**, aguardando plano de implementação.

## Problema

O perfil de assinatura Claude por chave de API (`kind:'apikey'`, ver
`docs/superpowers/specs/2026-08-04-perfil-claude-api-key-design.md`) permite billing por
token via qualquer provedor compatível (ex.: OpenRouter). Isso expõe o Farol a um risco que
o perfil de assinatura não tem: **gasto de dinheiro de verdade, sem teto**.

Incidente real (04/08/2026): uma revisão de PR grande (`biudtech/biud-frontend#702`) foi
retentada automaticamente pelo Farol por quase 4 horas (erro tratado como "transitório" em
alguns casos, e por um problema separado de reenfileiramento em outros), cada tentativa
lendo boa parte do diff via Opus antes de falhar no passo final (chave inválida, depois
saldo insuficiente pro `max_tokens` pedido). Resultado: **US$ 11,24 gastos em sessões que
NUNCA terminaram com sucesso**, nenhuma delas visível na aba Consumo do Farol.

**Achado que motiva a segunda metade desta spec:** investigando por que o gasto não aparece
em lugar nenhum do Farol, `lib/engine/session.js:437-449` (o handler de `close` de
`runClaudeStream`) só chama `engine.recordUsage(...)` **depois** de checar
`resultEvent.is_error` — ou seja, só registra consumo quando a sessão termina com sucesso.
Uma sessão que gastou tokens de verdade em turnos anteriores (leitura de arquivos, tool use)
e falhou só no turno final fica com **zero registro de custo no `usage.json`**, mesmo tendo
custado dinheiro real no provedor. Construir um orçamento em cima desse tracking, do jeito
que está, ficaria cego exatamente no cenário que motivou o pedido.

## Objetivo

1. **Corrigir o tracking**: registrar o consumo de uma sessão sempre que o evento final
   (`resultEvent`) existir e carregar dado de uso, independente de a sessão ter terminado em
   sucesso ou erro.
2. **Orçamento por perfil de chave de API**: cada perfil `apikey` ganha um teto diário e/ou
   um teto total (contado a partir de uma data de corte configurável). Estourar qualquer um
   dos dois pausa a **automação** (auto-revisão/autoanálise) das contas que usam aquele
   perfil, sem bloquear clique manual. Libera sozinho quando o gasto volta a caber (você
   editou o teto ou a data de corte), sem precisar de um botão de "despausar".

## Parte 1: corrigir o registro de consumo em sessão com erro

**Modificação em `lib/engine/session.js`, dentro do handler `child.on('close', ...)` de
`runClaudeStream`:**

Hoje:
```js
if (resultEvent) {
  if (resultEvent.is_error) {
    const detail = String(resultEvent.result || (resultEvent.errors || []).join('; ') || errBuf.trim() || resultEvent.subtype);
    return finish(new Error(`sessão retornou erro: ${detail.slice(0, 300)}`));
  }
  // registra o consumo de tokens desta sessão (best-effort, não interfere no resultado)
  try { engine.recordUsage(opts.id, opts.account, resultEvent, usedModel); } catch { /* registro é opcional */ }
  return finish(null, { text: String(resultEvent.result ?? ''), sessionId: resultEvent.session_id || sessionId });
}
```

Passa a ser:
```js
if (resultEvent) {
  // registra o consumo desta sessão SEMPRE que o evento final existir, mesmo em erro: uma
  // sessão que falhou no passo final ainda pode ter gasto de verdade nos passos anteriores
  // (achado real, 04/08/2026: retry de ~4h que custou dinheiro em sessões que erraram no
  // fim, e ficava invisível no usage.json porque só o caminho de sucesso registrava).
  // recordUsage já ignora sessão sem nenhum token (early-return interno), então chamar
  // incondicionalmente é seguro: sessão de erro sem custo nenhum simplesmente não registra
  // nada, do jeito que já era.
  try { engine.recordUsage(opts.id, opts.account, resultEvent, usedModel, authProfileId); } catch { /* registro é opcional */ }
  if (resultEvent.is_error) {
    const detail = String(resultEvent.result || (resultEvent.errors || []).join('; ') || errBuf.trim() || resultEvent.subtype);
    return finish(new Error(`sessão retornou erro: ${detail.slice(0, 300)}`));
  }
  return finish(null, { text: String(resultEvent.result ?? ''), sessionId: resultEvent.session_id || sessionId });
}
```

`authProfileId` é resolvido uma vez, junto da montagem do `env`, logo no topo da função:
```js
const env = engine.ghEnv(opts.account);
const authProfileId = engine.resolveClaudeAuth(opts.account).kind === 'apikey'
  ? engine.resolveClaudeAuth(opts.account).id : '';
```
(chamar `resolveClaudeAuth` duas vezes é barato, é leitura pura de config; alternativa
aceitável: guardar o resultado numa variável só e reusar.)

**Risco conhecido, documentado, não resolvido por esta spec:** se a sessão falhar bem no
início (antes de qualquer turno completar), `resultEvent` pode não existir de jeito nenhum
(o `close` cai no ramo `else`, "sem evento result", que já existe hoje pra stub/CLI antigo) —
nesse caso não há nada pra registrar mesmo, e está correto não registrar. O que esta spec
resolve é o caso em que `resultEvent` EXISTE (a sessão rodou até o fim e o CLI conseguiu
montar o envelope final), só que com `is_error:true`.

## Parte 2: modelo de dados do orçamento

**Perfil de chave de API ganha 3 campos novos, todos opcionais** (sem nenhum = sem freio,
comportamento de hoje):

```
{ id, label, kind:'apikey', apiKey, baseUrl, budgetDaily, budgetTotal, budgetSince }
```

- **`budgetDaily`**: número (US$). Teto de gasto no dia LOCAL corrente (mesma convenção de
  `localDay()` em `lib/engine/usage.js`, horário de Brasília, não UTC — o próprio comentário
  do código já documenta por que corta local: "às 21h locais o dia virava e o card 'Hoje'
  zerava" com corte UTC).
- **`budgetTotal`**: número (US$). Teto de gasto acumulado desde `budgetSince`.
- **`budgetSince`**: string `YYYY-MM-DD`. Data de corte pro cálculo do total. Editável a
  qualquer momento (é como você "reseta": muda a data pra hoje depois de recarregar crédito
  no provedor). Default ao criar o perfil: o dia da criação.

`normalizeClaudeProfiles` (`lib/parse.js`) passa a sanitizar os 3 campos pra perfil `apikey`:
`budgetDaily`/`budgetTotal` viram número (`Number(v)`, `NaN`/negativo vira `undefined`, ou
seja "sem teto" — nunca bloqueia por um valor malformado); `budgetSince` vira string
`YYYY-MM-DD` só se bater no formato (`/^\d{4}-\d{2}-\d{2}$/`), senão `undefined` (some o
teto total até você preencher uma data válida — mais seguro que aceitar lixo e o total
nunca bater com nada).

## Parte 3: `usage.js` ganha o agrupamento por perfil

```js
function applyUsage(store, day, kind, account, model, u, profileId) {
  addSession(store.totals, u);
  addSession(pick(store, 'days', day), u);
  addSession(pick(store, 'byKind', kind), u);
  addSession(pick(store, 'byAccount', account), u);
  addSession(pick(store, 'byModel', modelLabel(model) || 'desconhecido'), u);
  // só perfil de chave de API tem orçamento; perfil de assinatura (dir) e o legado não
  // participam deste agrupamento (profileId chega '' nesses casos).
  if (profileId) addSession(pick(store, 'byProfileDay', `${profileId}|${day}`), u);
  ...
}
```

Espera — **isto precisa de granularidade por DIA por perfil**, não só um total acumulado por
perfil (senão não dá pra calcular "gasto de HOJE deste perfil" separado do total). A chave
composta `${profileId}|${day}` resolve isso sem precisar de uma estrutura aninhada nova
(reaproveita o mesmo `pick`/`emptyBucket` que os outros agrupamentos já usam). Alternativa
mais legível (aninhado, `byProfile: {[profileId]: {days: {...}, total: bucket}}`) foi
descartada por exigir mais mudança de forma em `usageSummary`/testes existentes pra pouco
ganho; a chave composta é mais barata e seguindo o padrão já estabelecido no arquivo (um
`Object.entries` filtrando pelo prefixo `${profileId}|` resolve os dois cálculos).

`recordUsage` ganha o parâmetro `profileId`:
```js
function recordUsage(engine, id, account, resultEvent, model, profileId) {
  const u = extractUsage(resultEvent, model);
  if (!u.inputTokens && !u.outputTokens && !u.cacheReadTokens && !u.cacheCreationTokens) return;
  if (!engine.usage) engine.usage = defaultUsage();
  const day = localDay();
  const acc = String(account || '').toLowerCase() || '(sem conta)';
  applyUsage(engine.usage, day, kindFromId(id), acc, model, u, profileId || '');
  saveUsage(engine);
  engine.pushState();
}
```

**Fachada na `Engine` (`server.js`), mesmo padrão de `usageSummary()`:**
```js
profileBudgetStatus(profile) { return usageMod.profileBudgetStatus(profile, this.usage); }
```
(a função pura em `lib/engine/usage.js` recebe `store` como segundo parâmetro pra ser
testável isolada; a fachada já resolve `this.usage` sozinha, então todo chamador dentro da
Engine usa só `this.profileBudgetStatus(profile)`, sem se preocupar com o `store`.)

## Parte 4: lógica de freio

Duas funções puras novas em `lib/engine/usage.js`:

```js
// soma de hoje e desde a data de corte, pro perfil pedido. Lê da mesma bucket
// composta byProfileDay (Parte 3).
function profileSpend(store, profileId, since) {
  const today = localDay();
  const prefix = `${profileId}|`;
  const todayBucket = store.byProfileDay?.[`${prefix}${today}`] || emptyBucket();
  let sinceCost = 0;
  for (const [key, b] of Object.entries(store.byProfileDay || {})) {
    if (!key.startsWith(prefix)) continue;
    const day = key.slice(prefix.length);
    if (!since || day >= since) sinceCost += b.costUsd;
  }
  return { today: todayBucket.costUsd, sinceCutoff: sinceCost };
}

// compara o gasto com os tetos configurados no perfil. profile sem budgetDaily/budgetTotal
// nunca bloqueia (undefined nunca é excedido). Testa o diário ANTES do total: se os dois
// estourarem, o motivo relatado é o diário (mais recente/mais acionável: "veio de hoje").
function profileBudgetStatus(profile, store) {
  if (profile.kind !== 'apikey') return { blocked: false };
  const spend = profileSpend(store, profile.id, profile.budgetSince);
  if (profile.budgetDaily != null && spend.today >= profile.budgetDaily) {
    return { blocked: true, reason: 'diario', today: spend.today, sinceCutoff: spend.sinceCutoff };
  }
  if (profile.budgetTotal != null && spend.sinceCutoff >= profile.budgetTotal) {
    return { blocked: true, reason: 'total', today: spend.today, sinceCutoff: spend.sinceCutoff };
  }
  return { blocked: false, today: spend.today, sinceCutoff: spend.sinceCutoff };
}
```

**Gate no `check()` (`server.js`), no mesmo lugar que já filtra `toReview`
(`server.js:650-656`):**

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
        this.emit('toast', { kind: 'error', text: `Orçamento do perfil "${profile.label}" estourado; automação pausada até liberar (sem afetar clique manual).` });
      }
      return false;
    }
    this.budgetWarned.delete(auth.id); // liberou: próximo estouro avisa de novo
  }
  return true;
});
```

`this.budgetWarned` é um `Set` novo no construtor da `Engine` (mesmo padrão de
`autoReviewParked`/`retryAfterNet`), só pra não repetir o toast a cada ciclo de 5 minutos
enquanto o perfil seguir estourado — reseta (permite avisar de novo) assim que o perfil
volta a caber, pra um NOVO estouro futuro também avisar.

**Clique manual não passa por este filtro** (`toReview` só afeta o disparo automático do
`check()`; o botão "Revisar" da fila e do Panorama chama `launchReview` direto, sem checar
orçamento) — comportamento intencional, confirmado com você.

## Parte 5: UI

**Card do perfil de chave (Sistema > Plano e chaves), `ui/app.js` `renderClaudeProfiles`:**

Dois campos numéricos novos (`cp-budget-daily`, `cp-budget-total`) + um campo de data
(`cp-budget-since`), só no bloco de campos do tipo `apikey` (ao lado de `cp-apikey`/
`cp-baseurl`). Abaixo dos campos, uma linha de status somada do `STATE.doctor` (o doctor
precisa expor `profileBudgetStatus` por perfil, ver abaixo) — ex.: `"Hoje: US$ 2,10 de
US$ 3,00 · Desde 01/08: US$ 8,50 de US$ 10,00"`, com selo `🔴 orçamento estourado, automação
pausada` quando `blocked`.

`allClaudeAuthInfo()`/doctor (`server.js`) ganha, pro ramo `apikey`, os campos de orçamento
calculados:
```js
...(p.kind === 'apikey'
  ? { configDir: null, account: null, ready: !!p.apiKey, apiKeyMode: true, ...this.profileBudgetStatus(p) }
  : this.claudeAuthInfo(p.dir))
```

**Aba Consumo (`ui/index.html` + `ui/app.js`):** nova subseção "Por perfil de chave de API",
mesmo padrão visual das seções "Por conta"/"Por modelo" já existentes (lista + gráfico).
`usageSummary()` ganha uma quebra `byProfile` **computada** (não é um bucket bruto do
`store`, é uma agregação nova, no mesmo espírito de `today`/`last7`/`last30`, que também
são computadas a partir de `store.days`): pra cada perfil `apikey` que aparece em algum
prefixo de `store.byProfileDay`, soma o `costUsd` de hoje e o total (usando o
`budgetSince` do perfil, lido de `engine.config.claudeProfiles`), e devolve
`{profileId, label, today, sinceCutoff, budgetDaily, budgetTotal}` pra UI comparar lado a
lado. Só renderiza a seção se essa lista vier não-vazia.

## Segurança

Nada sensível novo: os 3 campos são só números/data, mesma sanitização defensiva
(`Number`/regex de data) que já existe pros outros campos de config. Não requer nenhuma
chamada de rede nova (o cálculo é 100% sobre `usage.json`, já local).

## Testes

- `lib/engine/session.js`: `recordUsage` é chamado também quando `resultEvent.is_error` é
  `true` e há usage (teste com stub que simula erro com tokens > 0); não é chamado quando
  não há `resultEvent` (ramo "sem evento result" continua igual).
- `normalizeClaudeProfiles`: `budgetDaily`/`budgetTotal` malformados (string não-numérica,
  negativo) viram `undefined`; `budgetSince` fora do formato `YYYY-MM-DD` vira `undefined`;
  valores válidos passam.
- `applyUsage`/`recordUsage`: bucket `byProfileDay` só recebe entrada quando `profileId`
  não é vazio; chave composta `${profileId}|${day}` bate exatamente.
- `profileSpend`: soma hoje e desde a data de corte corretamente, com múltiplos dias e
  múltiplos perfis misturados no mesmo store (não vaza gasto de um perfil pro outro).
- `profileBudgetStatus`: sem teto nenhum nunca bloqueia; estoura só diário; estoura só
  total; estoura os dois (motivo relatado é `'diario'`); dentro dos dois tetos não bloqueia;
  perfil `dir` (não-apikey) sempre `{blocked:false}` sem calcular nada.
- `check()`/`toReview`: conta cujo perfil resolvido está com orçamento estourado é excluída
  do disparo automático; volta a entrar quando o gasto para de exceder (sem exigir nenhuma
  ação manual de "despausar"); clique manual (`launchReview` direto) nunca é afetado.
- `budgetWarned`: toast dispara uma vez ao estourar, não repete a cada ciclo enquanto
  seguir estourado, e volta a disparar se estourar de novo depois de ter liberado.

## Fora de escopo (decisão consciente)

- **Sem corte no meio de uma sessão em andamento.** O custo só é conhecido no evento final;
  não existe hoje (nem via Anthropic nem via OpenRouter) um jeito de saber o gasto parcial
  DURANTE uma sessão rodando pra interromper no meio. O freio é sempre preventivo, pra
  próxima sessão.
- **Sem recuperação retroativa do gasto já perdido do incidente de 04/08.** As sessões que
  já rodaram e falharam ANTES desta spec não tiveram `resultEvent` nenhum registrado (o bug
  já existia), então não há como reconstruir aqueles US$ 11,24 no `usage.json` depois do
  fato. O fix vale só daqui pra frente.
- **Sem integração com o limite nativo do provedor** (ex.: `PROXY_API_KEYS`/limite do
  OpenRouter). São camadas independentes; o Farol não lê nem escreve limite de provedor
  nenhum, só o seu próprio.
- **Orçamento não bloqueia clique manual**, por decisão explícita (ver Parte 4).
