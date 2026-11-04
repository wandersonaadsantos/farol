# Correções de UX a partir da auditoria de 30/10/2026: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** corrigir os dez problemas de maior impacto da auditoria de experiência do Farol v2.78.11 sem mudar regra de negócio nem gate de postagem.

**Architecture:** quase tudo mora na `ui/`: texto e estrutura em `ui/index.html`, função pura nova em `ui/pure/<assunto>.js` (com o nome entrando na lista congelada de `test/ui-pure-superficie.test.js` no mesmo commit), fiação em `ui/telas/<assunto>.js` por injeção de dependência (`initX`), CSS em `ui/app.css`. Três pontos tocam o motor: o baseline da primeira checagem (`server.js`), a classificação do log (`lib/log-taxonomy.js`) e a indisponibilidade do update em checkout git (`lib/engine/update.js`). Nada posta no GitHub de forma diferente de hoje: a Task 9 só ACRESCENTA confirmação.

**Tech Stack:** Node 24 ESM sem dependência, `node --test`, UI vanilla (sem framework, sem build), CSS com tokens em `:root` e `:root[data-theme="light"]`.

**Spec:** `.superpowers/sdd/auditoria-ux.md` (git-ignored; se este worktree não o tiver, copie de `/Users/alex/Documents/Applications/farol/.claude/worktrees/contrato-do-sidecar/.superpowers/sdd/auditoria-ux.md`). A seção (b) traz os dez problemas; a (d) diz o que preservar.

## Global Constraints

- Texto da UI e comentários em português, sem travessão (vírgula, parênteses ou dois pontos).
- Zero dependência npm nova. `process.env` só em `lib/paths.js`. Tempo em ms só em `lib/constants.js`.
- Nome novo em `ui/pure/` entra em `CONGELADA` de `test/ui-pure-superficie.test.js` no mesmo commit; nenhum nome declarado em dois arquivos de `ui/pure/`.
- Tela (`ui/telas/`) não importa `../app.js`; dependência chega por `initX(dep)` guardada em variável de módulo; handlers nomeados no topo do módulo.
- Menção a pessoa, repo ou PR sai só dos helpers de `ui/pure/mencoes.js`; destino de `data-goto` tem de existir no `index.html` (`test/ui-contract.test.js`).
- Nada muda na admissibilidade nem na política de postagem (invariante 4 do `CLAUDE.md`).
- Gate por tarefa: `npm run check`, `npm run lint`, `npm test` (Node em `/Users/alex/.nvm/versions/node/v24.22.1/bin`; comandos separados). O ratchet `npm run lint` não pode subir: módulo novo abaixo de 400 linhas úteis, sem ternário aninhado, sem catch vazio sem comentário.
- Commit por tarefa, em português, primeira pessoa, `tipo(escopo): assunto`, sem trailer de coautoria e sem mencionar ferramenta ou assistente.

## Review Focus

1. Fila vazia com baseline e Panorama sem PR `mine` (conta nova sem pedido nenhum): o vazio novo não pode aparecer com "0 PRs"; cai no vazio bom de sempre. Teste na Task 1.
2. `/entregas` com a aba desligada enquanto a sub-aba ativa era Panorama: o aviso aparece e a sub-aba volta para Pra mim, não fica em Panorama. Teste na Task 2.
3. Motor em checkout git com `FAROL_UPDATE_MANAGER=external`: o estado "administrado por fora" vence o "checkout git" e nenhum dos dois loga a cada ciclo. Teste na Task 3.
4. Tema claro com cor de conta própria (inline `--ac`): o link do PR usa `--accent-text` no claro mesmo com `--ac` inline, porque o seletor de tema tem especificidade maior. Teste na Task 4.
5. Atalho A/M/C com a caixa de confirmação já aberta: o segundo toque não empilha outra caixa (o handler já ignora `.modal-overlay` aberto; o teste afirma que a confirmação é pedida uma vez). Teste na Task 9.

---

### Task 1: Fila vazia honesta sobre o baseline (problema 1 e parte do 4)

**Files:**
- Modify: `server.js:1101-1106` (bloco `if (!fs.existsSync(BASELINE_FILE))`), `server.js` `snapshot()` (~1897)
- Create: `lib/engine/baseline.js`
- Modify: `ui/pure/radar.js:93-127` (`queueEmptyOkHtml`), `ui/telas/radar.js:230-260` (`renderQueue`) e `:105-110` (handlers `.eo-*`), `ui/index.html:125-129` (`#queueSection`)
- Test: `test/baseline.test.js` (novo), `test/ui-pure.test.js` (casos de `queueEmptyOkHtml`)

**Interfaces:**
- Produces: `lib/engine/baseline.js` exporta `gravarBaseline(arquivo, { at, marcados })` (grava JSON `{ "at": <ms>, "marcados": <n> }`) e `lerBaseline(arquivo)` → `{ at, marcados } | null` (conteúdo legado, a string ISO de hoje, vira `{ at: Date.parse(texto), marcados: null }`; arquivo ausente ou ilegível é `null`, nunca lança). `ui/pure/radar.js` exporta `pedidosAntesDoInicio({ panorama, queueKeys, baseline })` → número de PRs com `pr.mine`, fora de `queueKeys` e com `Date.parse(pr.updatedAt) < baseline.at` (0 sem baseline); o `lib/` nunca importa de `ui/`.
- Produces: snapshot ganha `baseline: { at, marcados } | null`; `queueEmptyOkHtml(ctx)` passa a ler `ctx.antesDoInicio` (número) e `ctx.aprovados` já existente.

- [ ] **Step 1: Teste do módulo do baseline**

```js
// test/baseline.test.js
test('lerBaseline aceita o formato antigo (ISO) e o novo (JSON) e devolve null sem arquivo', ...)
test('gravarBaseline escreve JSON que lerBaseline lê de volta', ...)
// test/ui-pure.test.js
test('pedidosAntesDoInicio conta só mine, fora da fila e anteriores ao baseline', ...)
// panorama: [{key:'a', mine:true, updatedAt: antes}, {key:'b', mine:true, updatedAt: depois}, {key:'c', mine:false, updatedAt: antes}, {key:'d', mine:true, updatedAt: antes}]
// queueKeys: new Set(['d']) -> resultado 1; sem baseline -> 0
```

- [ ] **Step 2: Rodar e ver falhar** (`node --test test/baseline.test.js`: módulo não existe)
- [ ] **Step 3: Implementar `lib/engine/baseline.js`** (puro, sem engine; usa `parseJson` de `lib/io.js`)
- [ ] **Step 4: Fiação no `server.js`**: o bloco do baseline chama `gravarBaseline(BASELINE_FILE, { at: Date.now(), marcados: mineList.length })` e o toast vira `Primeira checagem: ${n} PR(s) que já pediam sua revisão ficaram fora da fila, para não disparar revisões de estoque. Veja no Panorama.` (com `n = mineList.length`; singular e plural). `snapshot()` ganha `baseline: lerBaseline(BASELINE_FILE)` (lido uma vez por boot e após o baseline, guardado em `this.baseline`). Confira que `test/sse-estado-delta.test.js` ou vizinho aceita o campo novo (allowlist do snapshot, se houver).
- [ ] **Step 5: Testes do vazio da fila** em `test/ui-pure.test.js`, ao lado dos casos existentes (l.2535 em diante):

```js
test('vazio da fila com PRs anteriores ao baseline diz quantos e leva ao Panorama', () => {
  const html = P.queueEmptyOkHtml({ aprovados: 0, owners: ['biudtech'], intervalSeconds: 300, antesDoInicio: 14 });
  assert.match(html, /14 PRs já pediam sua revisão antes do Farol começar a vigiar/);
  assert.match(html, /class="eo-panorama"/);
  assert.doesNotMatch(html, /Nada esperando por você/);
});
test('vazio da fila sem aprovados não oferece "Ver o que foi aprovado"', () => {
  assert.doesNotMatch(P.queueEmptyOkHtml({ aprovados: 0, owners: [], intervalSeconds: 300, antesDoInicio: 0 }), /eo-resolved/);
  assert.match(P.queueEmptyOkHtml({ aprovados: 2, owners: [], intervalSeconds: 300, antesDoInicio: 0 }), /eo-resolved/);
});
test('vazio da fila com antesDoInicio 0 é o vazio bom de sempre', ...)
```

- [ ] **Step 6: Implementar em `queueEmptyOkHtml`**: ramo `antesDoInicio > 0` (antes do ramo normal, depois do pausado) com título `${n} PRs já pediam sua revisão antes do Farol começar a vigiar`, texto `Eles ficam fora da fila para não disparar revisões de estoque. Cada um pode ser revisado pelo Panorama.` e botão `button.btn.sm.eo-panorama` "Ver no Panorama"; o botão `.eo-resolved` só sai com `aprovados > 0`.
- [ ] **Step 7: Fiação em `ui/telas/radar.js`**: `renderQueue` passa `antesDoInicio: pedidosAntesDoInicio({ panorama: estado().panorama || [], queueKeys: new Set((estado().queue || []).map(p => p.key)), baseline: estado().baseline })`, importada de `../pure/radar.js`. Handler `.eo-panorama` chama `switchRadarSub('pano')` (já no módulo). `#queueGrouping` recebe `hidden` quando `total === 0` e volta quando há itens (em `renderQueue`).
- [ ] **Step 8: Gate e commit** `feat(radar): a fila vazia diz quantos PRs ficaram fora pelo baseline`

### Task 2: Paleta e rota de aba desligada sem destino morto (problema 4 b, c, d)

**Files:**
- Modify: `ui/telas/paleta.js:31-47` (`cmdStatic`) e `initPaleta`, `ui/app.js:313` (chamada de `initPaleta`), `ui/telas/rota.js` (`aplicarRota`, ~121) e `ui/app.js:173-175` (`switchTab`)
- Create: função pura `avisoDeAbaDesligada(aba)` em `ui/pure/rota.js`
- Test: `test/ui-rota.test.js`, `test/ui-rota-fiacao.test.js:117-122`, `test/ui-contract.test.js` (se houver caso da paleta)

**Interfaces:**
- Produces: `initPaleta(switchTab, switchRadarSub)`; `avisoDeAbaDesligada('entregas')` → `'Entregas está desligada. Ligue em Sistema > Preferências.'` (`'destaques'` → `'Destaques está desligada. ...'`; outra aba → `''`).

- [ ] **Step 1: Testes**: em `test/ui-rota.test.js`, `avisoDeAbaDesligada` para as três entradas. Em `test/ui-rota-fiacao.test.js`, estender o caso 'aba opcional desligada cai no Radar e o endereço diz isso': com a sub-aba em `pano` antes de `irPara('/entregas?dias=30')`, afirmar `radarSubAtual() === 'mim'` e que o toast de informação foi emitido com o texto de `avisoDeAbaDesligada` (ver como o harness do teste dubla `toast`; se não dubla, injetar por parâmetro `initRota({ ..., avisar })`).
- [ ] **Step 2: Rodar e ver falhar**
- [ ] **Step 3: Implementar**: `switchTab` que converte `entregas`/`destaques` para `radar` também chama `switchRadarSub('mim')` e `toast('info', avisoDeAbaDesligada(name))` (uma vez por conversão). Na paleta: `querySelectorAll('.nav-item:not(.cmd-open)')`; as quatro entradas "Ir para ..." viram `{ label: 'Ir para Pra mim', run: () => { _switchTab('radar'); _switchRadarSub('mim'); } }`, `Meus PRs` → `'meus'`, `Panorama` → `'pano'`, e "Precisa de você"/"Sua fila" → `'mim'` seguido do `scrollIntoView` de hoje.
- [ ] **Step 4: Gate e commit** `fix(ui): a paleta troca a sub-aba do Radar e a aba desligada avisa antes de voltar`

### Task 3: Diagnóstico e atualização contam a mesma história (problema 3)

**Files:**
- Modify: `lib/log-taxonomy.js` (`CLASSES`, `triage`), `lib/engine/update.js` (`checkUpdate`, `checkUpdateRemote`, `maybeAutoUpdate`), `ui/pure/sistema.js` (`updateAdiadoHtml`, novo `updateIndisponivelHtml`), `ui/telas/sistema-atualizacao.js` (`renderUpdate`), `ui/pure/diagnostico.js:106` (`falhasSecaoHtml`), `ui/index.html` (títulos das seções `#sys-row-falhas` e do log em Diagnóstico)
- Test: `test/log-taxonomy.test.js`, `test/update-adiado.test.js`, `test/ui-update.test.js`, `test/diagnostico-falhas-tela.test.js`

**Interfaces:**
- Produces: classe `update-checkout-git` em `CLASSES` (regex `/auto-update falhou: O Farol roda de um reposit[óo]rio git/i`, `kind: 'permanente'`, grupo `app`, label `Atualização automática indisponível (checkout git)`); `triage` descarta linha de nível `WARN` cuja classe é `desconhecido` (WARN que a taxonomia conhece continua contando); `engine.update.indisponivel: 'checkout-git' | 'externo' | null`; `updateIndisponivelHtml(u)` → HTML ou `''`.

- [ ] **Step 1: Testes da taxonomia** em `test/log-taxonomy.test.js`: `classify('auto-update falhou: O Farol roda de um repositório git (/x): atualize com git pull.')` devolve `id: 'update-checkout-git'`, `kind: 'permanente'`; `triage([linha WARN de migração])` devolve `[]`; `triage([linha WARN que casa 'label-nao-saiu' ou outra classe conhecida])` continua contando (escolha uma classe existente que já tenha teste com WARN em l.420-441 e preserve-a).
- [ ] **Step 2: Testes do update** em `test/update-adiado.test.js`: com `deps.checkoutGit: true`, `maybeAutoUpdate` devolve `{ ok: false, skipped: 'checkout-git' }`, NÃO grava `autoUpdateFailedAt`, NÃO chama `engine.log` e `engine.update.indisponivel === 'checkout-git'`; com `atualizacaoExterna` o valor é `'externo'` e vence. Em `test/ui-update.test.js`: `updateIndisponivelHtml({ indisponivel: 'checkout-git' })` contém `Atualização automática indisponível nesta instalação` e `git pull`, e `renderUpdate` com esse estado não pinta `#btnUpdateNow`.
- [ ] **Step 3: Rodar e ver falhar**
- [ ] **Step 4: Implementar**: em `update.js`, `function motivoDeIndisponibilidade({ externo, checkoutGit })` (externo primeiro), `checkoutGit` lido por `fs.existsSync(path.join(APP_ROOT, '.git'))` com override em `deps`/`opcoes` para teste; `checkUpdate` e `checkUpdateRemote` gravam `indisponivel` no estado; `maybeAutoUpdate` sai antes do backoff com `skipped: 'checkout-git'` sem log (não é falha). `updateIndisponivelHtml` em `ui/pure/sistema.js`; `renderUpdate` mostra esse HTML no lugar do botão quando `u.indisponivel`. Em Diagnóstico: `falhasSecaoHtml` vazio diz `Nenhuma falha de sessão de IA registrada.` e o título do log vira `Log do app (últimas 300 linhas)`; o resumo de `#logResumo` ganha o prefixo `No log: `.
- [ ] **Step 5: Gate e commit** `fix(diagnostico): checkout git é indisponibilidade declarada, e WARN desconhecido não é falha`

### Task 4: Contraste no tema claro (problema 5)

**Files:**
- Modify: `ui/app.css:486-488` (`.pw-ref`, `.prow.mine .pw-ref`, `.pw-head .badge`), `:251-252` (`.pr-ref a`), `:1935-1936` (`--accent-text`)
- Test: `test/ui-tema-claro.test.js` (novo)

**Interfaces:**
- Produces: regra `:root[data-theme="light"] .prow.mine .pw-ref, :root[data-theme="light"] .pr-ref a { color: var(--accent-text); }` e `.pw-head .badge { color: var(--accent-text); }` (no escuro `--accent-text` já é `var(--accent)`).

- [ ] **Step 1: Teste** `test/ui-tema-claro.test.js`: lê `ui/app.css`; afirma que o bloco `:root[data-theme="light"]` (ou o bloco de l.1936) define `--accent-text` com um hex; calcula o contraste WCAG (função local `contraste(hexA, hexB)` com luminância relativa) de `--accent-text` do claro sobre `--surface` do claro (`#fff`) e exige `>= 4.5`; afirma que `.prow.mine .pw-ref` e `.pr-ref a` têm regra sob `[data-theme="light"]` usando `var(--accent-text)`, e que `.pw-head .badge` usa `var(--accent-text)`.
- [ ] **Step 2: Rodar e ver falhar**
- [ ] **Step 3: Implementar as regras** (acrescentar, não mover: `test/ui-widgets.test.js:417-431` continua lendo `.pw-title-txt` e `.pw-title .person-mention`).
- [ ] **Step 4: Gate e commit** `fix(css): link do PR e selo "sua revisão" legíveis no tema claro`

### Task 5: Visão geral começa pela saúde (problema 6)

**Files:**
- Modify: `ui/index.html:432-465` (ordem dentro de `#sys-overview`), `:460` (`#preferencesApply`), `ui/telas/sistema-atualizacao.js:55`, `ui/telas/preferences-transfer.js` (habilitar/realçar o botão)
- Test: `test/ui-widgets.test.js`

- [ ] **Step 1: Teste** em `test/ui-widgets.test.js`: no `index.html`, `indexOf('id="doctor"') < indexOf('id="updateBox"') < indexOf('id="setupManager"') < indexOf('id="reviewLabels"') < indexOf('id="preferencesTransfer"')`; `#preferencesApply` não tem a classe `primary` no HTML estático; `sistema-atualizacao.js` não contém `O botão abaixo`.
- [ ] **Step 2: Rodar e ver falhar**
- [ ] **Step 3: Implementar**: reordenar os cinco blocos (ids e `data-section` intactos, `test/ui-contract.test.js` segue verde); `#preferencesApply` vira `class="btn sm"` e `preferences-transfer.js` acrescenta `primary` quando há diferença selecionada e tira quando não há; o texto vira `O botão ao lado aplica agora, sem esperar.`
- [ ] **Step 4: Gate e commit** `fix(sistema): Visão geral abre pelos checks de saúde`

### Task 6: Menu do Sistema sem seção inerte e busca que acha orçamento (problema 7)

**Files:**
- Create: `ui/pure/sistema-busca.js` (o `SYS_INDEX` sai de `ui/telas/sistema.js:58-101` para cá, mais as funções puras)
- Modify: `ui/telas/sistema.js` (`sysSearchFilter`, `aoEstado`), `ui/index.html:403` (rótulo) e `:809` (h2)
- Test: `test/ui-sistema-busca.test.js` (novo), `test/ui-pure-superficie.test.js`

**Interfaces:**
- Produces: `SYS_INDEX` (array exportado, mesma forma `{ sec, at, title, hint }`), `buscarNoSistema(indice, query, nomeDaSecao)` → itens do índice cujo texto normalizado por `sysNorm` contém a consulta, `secoesOcultasDoSistema(config)` → `['devices', 'groups']` quando `config.sync?.enabled !== true`, senão `[]`.

- [ ] **Step 1: Testes**: `buscarNoSistema(SYS_INDEX, 'orçamento', () => '')` devolve item com `sec: 'plans'` ANTES de `groups`; todo `at` de `SYS_INDEX` que começa com `#` existe como `id="..."` no `index.html`; `secoesOcultasDoSistema({ sync: { enabled: false } })` e `({})` devolvem as duas seções, `({ sync: { enabled: true } })` devolve `[]`.
- [ ] **Step 2: Rodar e ver falhar**
- [ ] **Step 3: Implementar**: mover o índice, acrescentar `{ sec: 'plans', at: '#claudeProfilesManager', title: 'Orçamento por perfil', hint: 'orçamento, teto, limite, custo, gasto, cota' }` antes da entrada de Grupos; `sysSearchFilter` chama `buscarNoSistema`; em `aoEstado` de `ui/telas/sistema.js`, `#sysbtn-devices` e `#sysbtn-groups` recebem `hidden` conforme `secoesOcultasDoSistema(estado().config)` e, se a seção atual ficou oculta, `switchSistemaSection('sync')`. Rótulo `Reviewers` vira `Revisores e qualidade` (botão e h2 `Revisores e qualidade por projeto`); `sysSecName` continua lendo o botão. Conferir `test/ui-contract.test.js`: `data-section="reviewers"` permanece.
- [ ] **Step 4: Gate e commit** `fix(sistema): seções da sincronização somem com ela desligada e a busca acha o orçamento`

### Task 7: Consumo com o orçamento à vista e um termo por conceito (problema 8, parte 1)

**Files:**
- Modify: `ui/index.html:268-360` (aba Consumo), `ui/pure/consumo-atividade.js:10-23` (`activityKpisHtml`, `activityTable`), `ui/telas/consumo.js` (`renderUsage`, `wireUsageControls`), `ui/telas/consumo-atividade.js:29,86-87`
- Test: `test/usage-activity-ui.test.js`, `test/ui-pure.test.js` (~2065-2082), `test/ui-widgets.test.js`

**Interfaces:**
- Produces: `activityTable(report)` devolve `<p class="sys-note activity-empty">Nenhuma execução de IA neste período.</p>` quando `report.byKind` está vazio; o cartão `#usageBudget` passa a morar em `#usageBudgetTop`, fora do `<details id="usageAdvanced">`, logo depois de `#usageActivity`.

- [ ] **Step 1: Testes**: `activityTable({ ok: true, byKind: [] })` contém `activity-empty` e não contém `<table`; `activityKpisHtml` usa `Revisões concluídas` (ajustar `test/usage-activity-ui.test.js`); no `index.html`, `usageBudgetTop` aparece antes de `usageAdvanced`, os botões `data-metric="input"/"output"` têm texto `Entrada`/`Saída`, e o h3 dentro de `#usageAdvanced` é `Linha do tempo geral (sem filtros)`.
- [ ] **Step 2: Rodar e ver falhar**
- [ ] **Step 3: Implementar**: mover o card do orçamento para `#usageBudgetTop` e fazer `renderUsage` (ou a entrada da aba) pintá-lo sem depender do `toggle` do details; renomear `Reviews concluídas` → `Revisões concluídas`, `Histórico de operações` → `Histórico de execuções`, `Tokens da operação` → `Tokens da execução`, `Sessões recentes` → `Execuções recentes`, `Input`/`Output` → `Entrada`/`Saída`; estado vazio na tabela.
- [ ] **Step 4: Gate e commit** `fix(consumo): orçamento no topo, um termo por conceito e estado vazio na tabela`

### Task 8: Período do Consumo na URL (problema 8, parte 2)

**Files:**
- Modify: `ui/pure/rota.js` (`rotaPadrao`, `lerRota`, `lerRotaDeObjeto`, `escreverRota`, `mudancaDeRota`), `ui/telas/rota.js` (leitura da tela e aplicação), `ui/telas/consumo.js` (`usageState.window`)
- Test: `test/ui-rota.test.js`, `test/ui-rota-fiacao.test.js`

**Interfaces:**
- Produces: campo `janela: 1 | 7 | 30 | 90 | null` em `rotaPadrao`; `lerRota('/consumo?janela=7')` → `{ aba: 'consumo', janela: 7 }`; valor fora da lista é `null`; `escreverRota({ aba: 'consumo', janela: 7 })` → `'/consumo?janela=7'`; `janela: 30` (o padrão) não é escrita; mudar só a janela SUBSTITUI no histórico (como filtro).

- [ ] **Step 1: Testes** em `test/ui-rota.test.js` (os quatro casos acima) e em `test/ui-rota-fiacao.test.js`: clicar `#usageWindow [data-window="7"]` escreve `/consumo?janela=7` e `irPara('/consumo?janela=90')` deixa `usageState.window === 90` com o botão ativo.
- [ ] **Step 2: Rodar e ver falhar**
- [ ] **Step 3: Implementar** (a rota só aceita `janela` na aba consumo; nas outras é ignorada).
- [ ] **Step 4: Gate e commit** `feat(consumo): o período da aba vai para a URL`

### Task 9: Fricção antes de escrever no GitHub ou na config (problema 9)

**Files:**
- Modify: `ui/telas/atalhos.js:77-81`, `ui/telas/acoes.js:32-40` (`decideComConfirmacao`), `ui/telas/sistema-contas.js:53-71`, `ui/pure/contas.js`, `ui/telas/meus-prs.js:227`
- Test: `test/configuracoes-das-contas.test.js`, `test/ui-widgets.test.js`

**Interfaces:**
- Produces: `decideComConfirmacao(id, action, ref, { sempre })` confirma `approve` e `comment` também quando `sempre === true` (o teclado passa `sempre: true`; o clique mantém o comportamento de hoje); `textoDaMudancaDePolitica({ user, campo, de, para })` em `ui/pure/contas.js` → ex. `Política de @alex alterada: quando fica aprovável sem ressalvas, aprova sozinho.` (usa os rótulos de `POLITICA_DA_CONTA_TEXTOS`), e `''` para campo que não é política; o botão de Meus PRs vira `👥 Pedir reviewers no GitHub`.

- [ ] **Step 1: Testes**: em `test/configuracoes-das-contas.test.js`, `textoDaMudancaDePolitica` para `onClean` `wait` → `approve` e para `autoReview`; em `test/ui-widgets.test.js`, `atalhos.js` contém `sempre: true` e não contém `.click()` para A/M/C, e `meus-prs.js` contém `Pedir reviewers no GitHub`.
- [ ] **Step 2: Rodar e ver falhar**
- [ ] **Step 3: Implementar**: `atalhos.js` importa `decideComConfirmacao` de `./acoes.js` e, para A/M/C, lê `id` e `ref` do card selecionado (os mesmos `data-*` que `cliqueNoCardDeDecisao` lê) e chama com `{ sempre: true }`; P continua pulando sem confirmação. Em `sistema-contas.js`, depois de `editAccount` para os quatro seletores: `toastRich('ok', el => { texto + botão "Desfazer" que reenvia o valor anterior }, 8000)` (padrão de `acoes.js:126-139`); para `acct-padroes`, `toast('ok', 'Padrões do time de @' + user + ' salvos.', 2500)`.
- [ ] **Step 4: Gate e commit** `fix(ui): confirmação nos atalhos que postam e aviso com desfazer na política da conta`

### Task 10: Topbar em 768 px e alvos de toque no celular (problema 10)

**Files:**
- Modify: `ui/app.css:1384-1394` (media queries 860 e 620), `:495-512` (`.pw-title*`, `.pw-acts`)
- Test: `test/ui-widgets.test.js`

- [ ] **Step 1: Teste** em `test/ui-widgets.test.js`: o CSS tem um bloco `@media (max-width: 900px)` com `#btnCheck span { display: none` (ou o bloco de 620 passa a 900); tem, sob `@media (max-width: 420px)`, `.pw-title-txt` com `white-space: normal` e `-webkit-line-clamp: 2`, `.pw-title .person-mention` com `flex-basis: 100%`, e `.pw-acts .btn` com `min-height: 40px` e `min-width: 40px`. O caso existente de l.417-431 (`.pw-title-txt { ... text-overflow: ellipsis` na regra base) continua valendo.
- [ ] **Step 2: Rodar e ver falhar**
- [ ] **Step 3: Implementar**: subir o corte do rótulo de "Verificar agora" de 620 para 900 px; em 420 px, título em duas linhas (`display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; white-space: normal`), autor na linha de baixo (`.pw-title { flex-wrap: wrap }`, `.person-mention { flex-basis: 100%; margin-left: 0 }`), `.pw-acts { gap: 8px }` e botões com `min-width: 40px; min-height: 40px; justify-content: center`.
- [ ] **Step 4: Gate e commit** `fix(css): abas inteiras em 768 px e alvos de 40 px no Panorama do celular`

### Task 11: Glossário de produto no lugar do jargão (problema 2)

**Files:**
- Modify: `ui/index.html` (linhas 76, 163, 443, 518-519, 530-535, 585, 615, 626, 657-661, 670, 819, 827, 854-856), `ui/telas/sessoes.js:97`, `ui/telas/sistema-automacao.js:79-85`, `ui/telas/sistema-jira.js:86`, `ui/pure/setup.js:12`, `ui/pure/cadeia.js:28-31`, `ui/pure/capacity.js:42`, `ui/pure/compartilhado-posse.js:27-28,109`, `ui/pure/compartilhado.js:140-141`, `ui/telas/review-audits.js:23`, `ui/telas/radar-compartilhado.js:260`, `ui/pure/review.js:339-346`
- Test: `test/ui-glossario.test.js` (novo); conferir `test/sync-privacidade.test.js` e `test/cadeia-perfis.test.js` (se lerem o `index.html`, ajustar o literal junto)

**Interfaces:**
- Produces: tabela do glossário, aplicada palavra por palavra (o valor técnico continua em `<code>` quando é o nome de uma flag ou campo):

| hoje | passa a ser |
|---|---|
| gates | regras de segurança da postagem |
| revisão headless / headless | revisão em segundo plano |
| lease | reserva do PR (quem está revisando) |
| pushback (rótulo "Detectar pushback automaticamente") | contestação do autor ("Reconhecer quando o autor contesta a revisão (usa 1 sessão de IA por PR contestado)") |
| round 2 | segunda rodada |
| xhigh / medium (texto corrido) | esforço máximo / esforço médio (o `value` dos radios não muda) |
| MCPs / conectores | integrações ("as revisões passam a usar só o Jira do Farol e nenhuma outra integração") |
| admissão | controle de cota |
| cadeia | ordem de uso dos perfis |
| Sem conexão com o engine | Sem conexão com o Farol neste computador |
| `--dangerously-skip-permissions` (desc) | "A sessão no terminal não pede permissão a cada comando (`--dangerously-skip-permissions`). O modo em segundo plano já roda assim." |
| SHA-256 sem chave | resumo criptográfico (SHA-256) sem segredo: quem já conhece o nome consegue conferir |

- [ ] **Step 1: Teste** `test/ui-glossario.test.js`: lê `ui/index.html` com as tags `<code>...</code>` e os atributos `value="..."`/`id="..."`/`data-*` removidos, mais o texto dos módulos de `ui/pure/` e `ui/telas/` (só strings entre aspas ou crases, via `test/helpers/fontes-ui.js`), e afirma que NENHUM destes casa, sem diferenciar caixa: `/\bgates?\b/`, `/headless/`, `/\blease\b/`, `/pushback/`, `/round 2/`, `/\bxhigh\b/`, `/\bMCPs?\b/`, `/conectores/`, `/\badmiss[ãa]o\b/`, `/\bcadeia\b/`, `/conexão com o engine/`, `/SHA-256 sem chave/`. Exceções declaradas no teste: `ui/pure/consumo.js` `USAGE_KIND_LABEL.pushback` (chave de dado, o rótulo vira `Contestação`) e nomes de campo do snapshot (`headlessWaiting` não é string entre aspas, então não casa).
- [ ] **Step 2: Rodar e ver falhar** (lista os pontos que faltam)
- [ ] **Step 3: Aplicar o glossário** em todos os pontos listados em Files, um a um, mantendo o `<code>` onde é nome de flag; para os módulos de `ui/pure/` com teste de texto literal (`cadeia.js`, `review.js`), ajustar o teste junto.
- [ ] **Step 4: Gate e commit** `fix(ui): glossário de produto no lugar do jargão interno`

---

## O que a auditoria pediu e este plano deixa de fora, com motivo

- "Trazer para a fila" em lote no vazio do baseline: existe `POST /api/restore { key }` por PR; em lote seria rota nova no motor com decisão de produto (restaurar 14 PRs dispara 14 revisões se a conta revisar sozinha). Fica como sugestão para o dono.
- Separar visualmente "pedidos antes do início" no Panorama: depende do mesmo dado da Task 1 (`baseline.at` e `updatedAt`); entra numa iteração seguinte se o vazio novo não bastar.
- Shift+A no lugar da confirmação: a confirmação reaproveita `confirmModal` e cobre também M e C; um modificador novo precisaria de descoberta na caixa de atalhos.
