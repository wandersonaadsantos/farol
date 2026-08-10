# Consumo: releitura da tela (KPIs, linha do tempo empilhada, matriz Tipo × Modelo, sessões recentes)

Data: 10/08/2026
Estado: aprovado pelo Wanderson, pronto pra plano de implementação

## O problema

A aba Consumo de hoje (`ui/app.js`, bloco "Consumo de tokens") é a primeira versão:
4 estatísticas simples (Total/Hoje/7 dias/30 dias), um gráfico de barras único
(sem empilhar por dimensão) e uma lista de barras horizontais pra UMA dimensão
por vez (tipo, conta, modelo ou perfil, escolhida num seletor). Ela cumpre o
básico mas não deixa ver COMPOSIÇÃO ao longo do tempo (que fração é revisão vs
autoanálise em cada dia) nem cruzar dimensões (que modelo domina em cada tipo
de sessão), e não tem rastro de sessão individual (só soma agregada).

O Wanderson desenhou uma releitura completa no Claude Design
(`claude.ai/design/p/6c472030-8628-46ab-9873-09fde644f579`, arquivo
`Consumo v2.dc.html`) com: cartões de KPI com sparkline e delta, linha do
tempo em ÁREA EMPILHADA por dimensão com hover/tooltip, matriz Tipo × Modelo,
cartões de orçamento por perfil com medidor, e uma tabela de sessões recentes
(quando, tipo, PR/sessão, modelo, tokens, custo, estado). O arquivo do design
usa dado SIMULADO (a função `_data()` do componente gera série aleatória só
pra pré-visualizar a tela na ferramenta); a implementação real precisa mapear
cada peça pro dado de verdade que o Farol já tem, ou criar o que falta.

## Restrições e decisões já tomadas (não reabrir)

- **Zero cor nova de tema.** Conferido contra `ui/app.css`: `--bg` (#0b0e14),
  `--border` (#232c3d), `--text` (#e7ecf5), `--accent` (#ffb454), `--muted`
  (#8b97ab), `--faint` (#5c687d), `--ok` (#4cc38a), `--info` (#6ca8f2),
  `--danger` (#f2707a) já existem com esses valores exatos. Única cor
  realmente nova no app inteiro: `#b394f0` (roxo), usada só como constante
  local de JS pra série "Ferramentas" no gráfico (mesmo padrão do próprio
  mock, que também cravou a paleta crua no JS, não em variável CSS).
- **Gráfico da linha do tempo é ÁREA empilhada, sem alternância.** O mock tem
  uma prop de simulação (`grafico`) só pra pré-visualizar área vs barras
  dentro do Claude Design; não é um controle real da tela. Decisão: área
  empilhada, fixo (era o default do mock).
- **Matriz Tipo × Modelo e tabela de Sessões recentes usam dado REAL**, não a
  aproximação por proporção aleatória que o mock gera. Implica guardar
  granularidade nova (ver "Dados novos" abaixo).
- **Log de sessões sem poda, pra sempre.** Mesma filosofia do resto do
  `usage.json` ("registro permanente, sem botão de zerar"). A tela mostra só
  as mais recentes; o arquivo em disco guarda tudo.
- **Orçamento por perfil é dirigido por dado real**: itera
  `config.claudeProfiles` (quantos existirem), não os 2 cartões fixos de
  exemplo do mock. Mesmo desenho de cartão, conteúdo real.
- **O cabeçalho/nav (logo, pílula de versão, "monitorando", abas, "Verificar
  agora", tema) já existe hoje e é compartilhado por todas as abas.** O mock
  só reproduz porque a ferramenta de design sempre renderiza a tela inteira.
  Fora de escopo: não toca nisso.
- **Aposenta** `drawUsageBreakdown`, `#usageBreakdown` e `#usageDimProfile`
  (lista de barras horizontais por dimensão): a matriz + a legenda inline da
  linha do tempo cobrem o mesmo papel, redesenhado. A quebra por perfil vira
  os cartões de orçamento.

## Dados novos (`lib/engine/usage.js`)

### Buckets diários cruzados

Mesmo padrão que `byProfileDay` já usa (chave composta), pra dar granularidade
dia × dimensão sem quebrar o formato hoje existente (`days`, `byKind`,
`byAccount`, `byModel` continuam como estão, ninguém migra):

| bucket novo | chave | alimenta |
|---|---|---|
| `daysByKind` | `` `${kind}\|${day}` `` | linha do tempo empilhada por tipo |
| `daysByModel` | `` `${model}\|${day}` `` | linha do tempo empilhada por modelo |
| `daysByAccount` | `` `${account}\|${day}` `` | linha do tempo empilhada por conta |
| `daysByKindModel` | `` `${kind}\|${model}\|${day}` `` | matriz Tipo × Modelo no período |

Todos populados dentro de `applyUsage` (mesma sessão, mesmo evento, sem
chamada extra), podados junto do corte de `MAX_DAYS` que já existe pra `days`
(só a timeline usa isso; sem impacto no log de sessões, que não poda).

### Log de sessões (`state/usage-sessions.json`, arquivo novo)

Formato `{ sessions: [...] }`, gravação atômica (`writeJsonAtomic`, já
existe), **sem poda**. Cada sessão que termina (sucesso OU erro, mesma regra
que `recordUsage` já segue desde o achado de 04/08) grava um registro:

```
{ at, day, kind, ref, account, model, profileId,
  inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens,
  costUsd, status }
```

- `at`: epoch ms (pra ordenar e pro "quando" relativo/absoluto da UI).
- `ref`: string livre, a referência que a UI mostra na coluna "PR/sessão".
  Ver "Plumbing do ref" abaixo.
- `status`: `'ok'` ou `'erro'` (de `resultEvent.is_error`).

Fica em arquivo PRÓPRIO, separado de `usage.json`: como não tem poda, cresce
pra sempre; separar evita que toda gravação de agregado (`saveUsage`, que já
roda a cada sessão) tenha que reserializar um array cada vez maior junto com
os totais. Sem impacto de leitura: `usageSummary` lê os dois arquivos e
compõe.

### `usageSummary()` ganha 3 campos novos

- `stackedSeries`: série diária já fatiada pra janela pedida, com a
  composição por dimensão (kind/model/account) pronta pro gráfico montar as
  camadas. Substitui o uso direto de `series` pela timeline (que segue
  existindo pros cartões de KPI, que somam sem precisar de camada).
- `matrix`: linhas (tipo) × colunas (modelo) já somadas pro período
  selecionado, a partir de `daysByKindModel`.
- `recentSessions`: as últimas 100 entradas do log (mais nova primeiro), pra
  não mandar o histórico inteiro em todo push de SSE. O arquivo em disco
  segue completo; é só o que trafega pra UI que corta em 100.

## Plumbing do `ref` (pra "PR/sessão" da tabela)

`ref` vira um campo de `opts` em `runClaudeStream` → repassado a
`recordUsage`. Cada um dos 5 chamadores já tem o valor à mão, sem busca nova:

| chamador | `ref` |
|---|---|
| `lib/engine/review.js` (revisão headless) | `pr.key` |
| `lib/engine/selfpr.js` (autoanálise Meus PRs) | `pr.key` |
| `lib/engine/pushback.js` (`classifyPushback`) | `pr.key` |
| `lib/engine/chat.js` | `key` (chave do chat, mesmo formato `owner/repo#N`) |
| `lib/engine/tools.js` (kudos/diagnóstico) | o `label` que a função já monta (ex. `"Kudos · BIUD trabalho"`, `"Diagnóstico do Farol"`) |

Sem `ref` (não deveria acontecer, é defensivo): grava `null`, a UI mostra
`"(sem referência)"` (nunca travessão, invariante 6).

## Redesenho da UI (`ui/app.js`, `index.html`, `app.css`)

Mapeamento direto do `Consumo v2.dc.html`, mantendo a semântica dos
controles que já existem (`usageState`) e estendendo o que falta:

- **Métrica** (`usageState.metric`): ganha a opção **Custo** (nova), ao lado
  de Tokens/Input/Output/Cache que já existem. Vira o eixo compartilhado por
  KPIs, linha do tempo e matriz (mesmo padrão do mock: `fmtM` muda de token
  pra dinheiro conforme a métrica escolhida).
- **Empilhar por** (`usageState.dim`, reaproveitado): kind/model/account, os
  mesmos 3 que já existem pra quebra; `profile` sai desse seletor (não faz
  sentido empilhar a linha do tempo por perfil) e vira só os cartões de
  orçamento, sempre visíveis quando há perfil de chave configurado.
- **4 cartões de KPI**: Custo/Tokens/Sessões do período + Hoje, cada um com
  sparkline (path SVG gerado a partir da série da janela) e chip de delta vs
  o período anterior equivalente (mesmo cálculo que `deltaChip` do mock).
- **Linha do tempo empilhada**: `drawUsageTimeline` reescrita pra desenhar N
  camadas (`path` de área por dimensão, cumulativas) em vez de barras únicas;
  legenda inline acima do gráfico com total por camada; hover mapeia posição
  do mouse pro índice do dia e mostra tooltip com a quebra daquele dia; marca
  o pico do período.
- **Matriz Tipo × Modelo**: tabela com heatmap leve (`background:
  rgba(accent, fração do valor da célula sobre o máximo)`), linha de total
  por tipo, coluna de total por modelo, total geral no canto.
- **Orçamento por perfil**: um cartão por perfil configurado. Perfil de
  assinatura mostra nota informativa sem medidor (sem teto configurável);
  perfil de chave mostra os 2 medidores (diário/total) com
  `profileBudgetStatus` (já existe, sem mudança).
- **Sessões recentes**: tabela com as colunas do mock (Quando, Tipo,
  PR/sessão, Modelo, Tokens, ~US$, Estado), altura máxima com rolagem
  vertical, rodapé "Registro permanente, sem botão de zerar." + "Mostrando as
  N mais recentes" (N = `recentSessions.length`, até 100).

### Onde o código muda

| arquivo | o que entra |
|---|---|
| `lib/engine/usage.js` | 4 buckets diários novos, arquivo `usage-sessions.json`, `stackedSeries`/`matrix`/`recentSessions` em `usageSummary` |
| `lib/engine/session.js` | `runClaudeStream` repassa `opts.ref` pra `recordUsage` |
| `lib/engine/review.js`, `selfpr.js`, `pushback.js`, `chat.js`, `tools.js` | passam `ref` na chamada de `runClaudeStream` |
| `server.js` | fachada `recordUsage` ganha o parâmetro `ref`; `test/facades.test.js` deriva a aridade esperada do próprio fonte, então não precisa de tabela manual, só a assinatura bater |
| `ui/app.js` | `drawUsageTimeline` reescrita (camadas + hover), `drawUsageMatrix` (nova), `drawUsageSessions` (nova), `renderUsage` orquestra os 3 + cartões de KPI + orçamento; `drawUsageBreakdown` e o seletor `#usageDimProfile` removidos |
| `ui/index.html` | marcação da aba Consumo trocada pra estrutura nova (cartões, card da linha do tempo, card da matriz, card de orçamento, card de sessões) |
| `ui/app.css` | classes novas pro layout (grid de KPI, sparkline, matriz, medidor de orçamento, tabela de sessões); nada em `--bg/--border/--text/--accent` muda |

## Testes

- `test/usage.test.js`: casos novos pra `daysByKind`/`daysByModel`/
  `daysByAccount`/`daysByKindModel` (soma certa, poda junto com `days`), pro
  log de sessões (grava sem poda, sobrevive a sessão de erro, `ref` chega
  certo), e pros campos novos de `usageSummary` (`stackedSeries`, `matrix`,
  `recentSessions` cortado em 100).
- `test/ui-pure.test.js` (ou onde já existem os formatadores da aba Consumo):
  função de sparkline (path determinístico pra série conhecida), função da
  matriz (heatmap proporcional), qualquer helper novo que não toque DOM.
- Chamadores (`review.js`/`selfpr.js`/`pushback.js`/`chat.js`/`tools.js`):
  teste existente de cada um passa a conferir que `ref` chega em
  `runClaudeStream` com o valor esperado (stub já captura `opts` nesses
  testes, é só adicionar a asserção).

## Verificação visual

Instância isolada, sem tocar dado real:

```
FAROL_HOME=<temp> node server.js
```

com `usage.json` + `usage-sessions.json` semeados cobrindo: mix de tipos
(revisão/autoanálise/chat/ferramentas/pushback), mais de um modelo, mais de
uma conta, pelo menos um perfil de chave com orçamento perto do teto (pra ver
o medidor quase cheio) e um perfil de assinatura (pra ver o cartão sem
medidor). Comparar lado a lado com o `Consumo v2.dc.html` nos 3 períodos
(7/30/90 dias) e no estado vazio (`vazio: true` do mock, que já existe como
`u.totals.sessions === 0` no código real).

## Fora de escopo

- Qualquer mudança no cabeçalho/nav compartilhado.
- Exportar CSV: o mock tem o botão "Copiar CSV" (`_copyCsv`); conferido, a
  implementação atual não tem nada equivalente na aba Consumo. Fica de fora
  desta releitura (é aditivo e independente do resto); follow-up separado se
  o Wanderson quiser.
- Paginação da tabela de sessões além do corte de 100 mandados por SSE (se um
  dia precisar ver mais que isso na tela, é uma rota HTTP dedicada, não este
  trabalho).
- Migração de dado histórico: sessões registradas ANTES desta mudança não têm
  `ref` nem entram no log de sessões novo (só existem nos buckets agregados
  antigos). A tabela de sessões recentes começa vazia e cresce dali pra
  frente; os KPIs/linha do tempo/matriz de dias passados sem os buckets
  novos aparecem zerados nessas dimensões até o dia em que a mudança entrar
  no ar (mesma política que `byProfileDay` já adotou, sem migração).

## Versão

Minor: interface nova visível + dado novo rastreado, sem correção de defeito
de comportamento. Sai como **v2.38.0** (última publicada: v2.37.1).
