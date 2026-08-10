# Consumo: centralização dos dados (fonte única, reconciliação e orçamento vivo)

Data: 10/08/2026
Estado: aprovado pelo Wanderson ("refinamento lógico e centralização dos dados pra não levantar dados errados e divergentes"), execução autônoma

## O problema (medido em auditoria de 32 agentes, 26 achados confirmados)

A releitura da tela (v2.38.0/v2.39.0) compôs 5 painéis lendo 4 universos de dados
diferentes, e a tela real divergia em números grandes:

1. **Universo dividido.** Os KPIs somam `u.series` (de `store.days`, histórico
   completo desde 28/07); a linha do tempo soma `u.stackedSeries` e a matriz soma
   `u.matrixSeries` (dos buckets cruzados `daysBy*`, nascidos na v2.38.0 SEM
   migração). Medido em disco: janela de 7 dias com **964.836 tokens em `days`
   contra 66.472 nos buckets cruzados** (o print do Wanderson: 942k vs 43k).
   Pior: **até o dia de HOJE diverge** (7 sessões/139.657 tokens em `days` vs
   3/43.343 nos cruzados), porque 4 sessões de hoje rodaram na versão anterior à
   atualização. Essa fatia nunca se recupera sozinha: fica errada até o dia sair
   da janela de 90 dias.
2. **Contradição de vaziez.** "Sem consumo nesta janela" na timeline logo abaixo
   de um KPI de 942k.
3. **Orçamento congelado.** O cartão de orçamento lê `STATE.doctor.claudeAuth`,
   que só recalcula no boot, no "Verificar agora" e ao salvar perfis; o resto da
   aba atualiza a cada `pushState`. O gate real (`budgetBlockedFor`) recalcula ao
   vivo: a automação pode pausar por estouro com o cartão dizendo "no orçamento",
   e na virada do dia o cartão mostra o gasto de ontem rotulado de hoje.
4. **Payload morto com definição própria.** `today/last7/last30/byKind/byAccount/
   byModel/byProfile` trafegam em todo push de SSE e NENHUM painel lê; as janelas
   deles já divergem da definição da UI (`usageDayKeysBack`). Réplica manual de
   `MAX_DAYS` na UI (`USAGE_RETENTION_DAYS = 120`) sem nada que as amarre.
5. **Registro com furos.** `recordUsage` descarta sessão com custo > 0 e tokens
   zerados; o cancelamento descarta o `resultEvent` já parseado (registro vinha
   DEPOIS do branch de cancelled); sessão interativa de terminal nunca entra na
   medição nem no teto (limitação real do CLI, mas a tela não declarava).
6. **Métrica com 4 definições.** O seletor muda timeline e matriz, os KPIs somam
   in+out na mão; "Tokens" exclui cache em todo painel enquanto "Custo" inclui o
   custo do cache, sem a tela explicar; delta comparava contra janela anterior
   estruturalmente incompleta quando o histórico é mais novo que 2x a janela.

## A correção (por camada)

### Motor (`lib/engine/usage.js`): reconciliação na fonte

`store.days` é o eixo AUTORITATIVO (íntegro: totals = Σdays = ΣbyKind = ΣbyAccount
= ΣbyModel nas 6 métricas, verificado em disco). A regra nova, aplicada NA LEITURA
(`usageSummary`), sem migração de arquivo e autocurativa pra qualquer deriva
passada ou futura:

- **`stackedSeriesFor`**: pra cada dia, se a soma dos buckets da dimensão ficar
  abaixo de `days[day]` (campo a campo, clamp em zero), a diferença vira uma
  camada sintética **`_resto`** ("Sem detalhamento"), sempre a ÚLTIMA da lista de
  nomes. Invariante por construção: Σ camadas do dia == `days[day]`, logo
  timeline == KPI em qualquer janela.
- **`matrixSeriesFrom`**: mesmo cálculo por dia contra a soma de todas as
  células; o resto entra na célula `cells._resto._resto`. Invariante: total geral
  da matriz na janela == KPI da janela.
- `kindNames`/`modelNames`/`accountNames` só ganham `_resto` quando existe resto
  em algum dia (a UI já esconde série/coluna/linha zerada na janela).
- **`budgets`** (campo novo): um item por perfil de `config.claudeProfiles`, com
  `id, label, kind ('apikey'|'assinatura'), budgetDaily, budgetTotal,
  budgetSince, today, sinceCutoff, blocked, reason`, calculado por
  `profileBudgetStatus` NO MOMENTO do push. NUNCA inclui `apiKey`. É a mesma
  função do gate real: cartão e comportamento não podem mais divergir.
- **`sessionsSince`** (campo novo): `at` da sessão mais antiga do log, pra UI
  declarar a cobertura da tabela (o log nasceu 10/08 15:03 e cobre 3 de 131
  sessões; isso é limitação de dado, não de tela, então declara).
- **`retentionDays`** (campo novo): `MAX_DAYS` no payload; a UI para de replicar.
- **Saem do payload**: `today`, `last7`, `last30`, `byKind`, `byAccount`,
  `byModel`, `byProfile` (payload morto). `profileBreakdown`, `sumDaysSince` e
  `daysAgo` saem do módulo (sem chamador). `totals` fica (guard de vaziez).
- **`recordUsage`**: o early-return passa a exigir tokens E custo zerados
  (`!costUsd` entra no teste), pra custo sem token não sumir da contabilidade e
  do teto.

### Sessão (`lib/engine/session.js`)

`recordUsage` sobe pra ANTES do branch `run.cancelled` no close handler: se o
evento result chegou antes do kill, o gasto é real e registra. Morte sem result
segue sem registro (o dado não existe; limitação do CLI).

### Server (`server.js`)

`allClaudeAuthInfo` deixa de espalhar `profileBudgetStatus` no perfil apikey
(ficam `ready`/`apiKeyMode`): o orçamento agora viaja SÓ em `usage.budgets`, uma
fonte única. O doctor segue dono do que é dele: dir, conta OAuth, `ready`.

### UI (`ui/app.js`, `ui/pure.js`)

- `drawUsageBudget` e o selo de gasto da aba Sistema leem `STATE.usage.budgets`
  (mesmo push que o resto da tela). Zero leitura de `STATE.doctor` no Consumo.
- `drawUsageKpis` soma com `usageMetricVal` (definição única de métrica, a mesma
  da timeline/matriz/tabela); o sub do KPI de tokens ganha o cache quando houver
  (`… in · … out · … cache`), explicando por que "Custo" anda com o cache;
  o chip de delta só aparece quando a janela anterior cabe INTEIRA no histórico
  registrado (primeiro dia da série <= primeiro dia da janela anterior) E na
  retenção (`u.retentionDays`).
- `_resto`: cor `var(--faint)` em TODAS as dimensões (`usageColorsFor` força),
  rótulo "Sem detalhamento" (camada, linha e coluna da matriz).
- Célula da matriz ganha `title` com o valor EXATO (`fmtTok`/`fmtMoney`), porque
  células compactadas não somavam o próprio total à vista.
- Rodapé de Sessões recentes declara a cobertura: "Registro individual desde
  DD/MM/AAAA; sessões anteriores aparecem só nos agregados."
- Cartão de orçamento com perfil de chave declara a lacuna do terminal: sessões
  interativas não entram na medição nem no teto.

## Invariantes novos (travados em teste)

1. Pra toda janela e todo dia: Σ camadas de `stackedSeries[dim][day]` ==
   `series[day]`, campo a campo, nas 3 dimensões (com `_resto` incluído).
2. Total geral de `matrixSeries` == Σ `series`, campo a campo.
3. `budgets` espelha `profileBudgetStatus` (mesmo `blocked/today/sinceCutoff`)
   e nunca contém `apiKey`.
4. `usageSummary` não contém mais os 7 campos aposentados.
5. `recordUsage` registra sessão com custo e sem token.
6. Sessão cancelada COM resultEvent registra consumo (session.js).

## Da revisão adversarial (13 agentes sobre o diff, 8 achados, todos corrigidos)

- **claudeAuthBadge tinha morrido junto:** o selo "🔴 orçamento estourado" da
  aba Sistema lia `blocked/reason` do doctor, que esta mudança removeu. Passou a
  ler `STATE.usage.budgets` (a fonte única), validado ao vivo com teto estourado
  nos 3 lugares (selo, hint e cartão) concordando.
- **Sessão cancelada saía como "ok" no log:** `session.js` marca
  `farol_cancelled` no evento e o log grava `status: 'cancelada'` (precedência
  sobre `is_error`), com pill própria apagada na tabela.
- **Cobertura de mutação:** testes novos travam a ORDEM dos items (`_resto`
  sempre último, base na ordem fixa, porque a UI zipa cor/legenda por índice), o
  clamp da deriva inversa (detalhado à frente de `days` nunca gera resto
  negativo) e a fronteira do epsilon do custo (0,0005 zera, 0,005 sobrevive).

## Fora de escopo (decisões conscientes)

- **Migrar os arquivos em disco**: a reconciliação na leitura cobre o mesmo caso
  sem reescrever registro permanente.
- **Medir a sessão interativa de terminal**: o CLI não emite stream-json nesse
  modo; declarar a lacuna é o honesto possível hoje.
- **Transação entre usage.json e usage-sessions.json**: falha de I/O isolada se
  autocorrige no próximo write (o array em memória regrava inteiro); a camada
  `_resto` absorve visualmente o resíduo se sobrar deriva.
- **Chaves de dia UTC antigas**: sem anomalia visível em disco (verificado);
  renormalizar seria reescrever registro permanente.
- **KPIs seguirem o seletor de métrica**: os 4 cartões são fixos por desenho
  (Custo/Tokens/Sessões/Hoje); o que centraliza é a DEFINIÇÃO da soma.

## Versão

v2.40.0 (minor: payload muda, comportamento visível novo: camada "Sem
detalhamento", orçamento vivo, notas de cobertura).
