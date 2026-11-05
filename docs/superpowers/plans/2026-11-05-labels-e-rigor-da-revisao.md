# Labels como contrato, pedido visível e rigor proporcional: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A label `<conta>:revisando` passa a equivaler a sessão viva nos dois sentidos, quem revisa vê quem pediu, a reprovação automática sai só por defeito provado no código, e instância isolada nunca escreve no GitHub.

**Architecture:** Tudo no motor Node (`lib/engine/`, `lib/paths.js`, `lib/constants.js`) e nas funções puras da UI (`ui/pure/`), seguindo o padrão do projeto: módulo PURO novo por assunto, fiação no `server.js` ou no `review.js`, texto de card pelos helpers existentes, teste em `test/` com `node --test`. Nenhuma dependência nova. Cada tarefa é entregável sozinha e a ordem segue a do desenho (segurança primeiro, label, pedido, rigor).

**Tech Stack:** Node 24 ESM puro, `gh` CLI, `node --test`, UI sem framework.

**Spec:** `docs/superpowers/specs/2026-11-05-labels-e-rigor-da-revisao-design.md`

## Global Constraints

- Texto da UI, comentários e documentação em português, **sem travessão** (vírgula, parênteses ou dois pontos).
- Tempo só em `lib/constants.js` (`TEMPOS`, derivado de `HORA_MS` e `DIA_MS`). `process.env` só em `lib/paths.js`.
- Nenhuma dependência npm nova. Log só de falha (`engine.log('WARN'|'ERROR')`), uma linha por mudança de estado, nunca por ciclo.
- Toda escrita no GitHub continua passando por `postReviewOnce` (`lib/engine/decision.js`) ou pelos pontos nomeados na Tarefa 1; nada novo chama `gh pr review`.
- Nenhum texto público novo no PR: a label é o único sinal escrito.
- Rota `/api` nova ou alterada mantém classe em `lib/local-auth/inventario.js` (aqui só `/api/review-labels`, que já é `escreve-github`).
- Antes de cada commit: `npm run check && npm run lint && npm test` verdes (o `lint` é ratchet: contagem de violação não pode subir). Antes de empurrar: `npm run eng`.
- Mensagens de commit em português, sem nenhuma menção a IA, Claude ou assistência automatizada, sem trailer `Co-Authored-By`.
- Arquivos do protocolo do workspace (`workspace-template/`) ficam abaixo de 24.000 bytes por seção do `CLAUDE.md`; aqui só `prompts/pr-review-auto.md` e `.claude/agents/pr-reviewer.md` mudam.

## Review Focus

1. **Label retirada enquanto a leitura do GitHub falha**: a sessão continua (falta de dado nunca encerra). Teste na Tarefa 3.
2. **Envelope legado ou retomado com `blocking` sem `causa`**: não posta REQUEST_CHANGES nem APPROVE, vai à recuperação. Teste na Tarefa 9.
3. **Label própria num PR que outro aparelho da mesma conta está revisando sob coordenação**: a limpeza de órfã não toca. Teste na Tarefa 6.
4. **`FAROL_HOME` apontando para o próprio `~/.farol` (barra final, caminho relativo)**: não é instância isolada. Teste na Tarefa 1.
5. **Sessão que morre em menos de 15 s sem evento**: nenhuma chamada `--add-label`; sessão com primeiro evento aos 2 s e cancelada depois: label entra e sai. Teste na Tarefa 5.

---

## Estrutura de arquivos

| arquivo | papel |
|---|---|
| `lib/paths.js` (modificar) | `instanciaIsolada`: `FAROL_HOME` resolvido difere de `~/.farol`, fora do runner de teste |
| `lib/engine/instancia-isolada.js` (criar) | `recusaDeIsolada(engine, acao)`: a recusa única de toda escrita no GitHub em instância isolada |
| `lib/engine/labels-a-tirar.js` (modificar) | prazo de 7 dias e WARN único por pendência |
| `lib/engine/gh-queries.js` (modificar) | `prEstadoELabels`, `mergeavelDoPr`, `ultimoPedidoDeRevisao`; comentário da label corrigido |
| `lib/engine/vigia-sessao.js` (modificar) | motivo `label-retirada` |
| `lib/engine/label-tardia.js` (criar) | PURO: a label entra no primeiro evento ou no prazo, uma vez só |
| `lib/engine/label-propria-orfa.js` (criar) | label da própria conta sem sessão nem dono some depois do TTL |
| `lib/sync/lease.js` (modificar) | `leaseVivo(client, ids, nowMs)`: leitura sem adquirir |
| `lib/engine/review-label-control.js` (modificar) | remover a própria label cancela a sessão viva antes |
| `lib/engine/espera-conflito.js` (criar) | PR em conflito com a base não abre sessão automática |
| `lib/engine/review-findings.js` (modificar) | `causa` obrigatória em `blocking` e `causasDosBloqueios` |
| `lib/engine/desfecho-automatico.js` (modificar) | `bloqueiosSoDeEstado`, `causaDaEspera` |
| `lib/engine/approval-policy.js` (modificar) | `shouldAutoReject` recusa bloqueio só de estado; texto de recusa novo |
| `lib/engine/desfecho-da-revisao.js` (modificar) | bloqueio só de estado vira espera ou mesa |
| `lib/engine/provas-da-decisao.js` (modificar) | `pedido` nas provas |
| `lib/engine/avisos-nativos.js` + `main.js` (modificar) | evento `review-started` |
| `lib/engine/review.js` (modificar) | fiação: label tardia, vigia com label, pedido, gate de conflito |
| `server.js` (modificar) | fachadas e fiação do ciclo (`tirarOrfas`, snapshot `esperaConflito`, `doctor.instanciaIsolada`) |
| `ui/pure/radar.js`, `ui/pure/sessao.js`, `ui/telas/review-labels.js` (modificar) | frases de card, pedido no cartão, texto da confirmação |
| `workspace-template/prompts/pr-review-auto.md`, `workspace-template/.claude/agents/pr-reviewer.md` (modificar) | o campo `causa` e a tabela |
| `CLAUDE.md`, `docs/REVIEW-GATES.md` (modificar) | mapa e doutrina |

---

### Tarefa 1: Instância isolada não escreve no GitHub (parte D)

**Files:**
- Modify: `lib/paths.js` (ao lado de `homeDoFarol`, linhas 115-128; exportar em 224-228)
- Create: `lib/engine/instancia-isolada.js`
- Modify: `lib/engine/postagem-portao.js:52` (`recusaDaConta`, antes de `recusaDePrProprio`)
- Modify: `lib/engine/review.js:949` (`addInProgressLabel`), `lib/engine/selfpr.js:76` (`setReviewers`), `lib/engine/self-merge.js` (antes do primeiro `io.run('gh', ['pr', 'edit'`)
- Modify: `server.js` (`doctor()`: campo `instanciaIsolada`)
- Modify: `CLAUDE.md:301` (bullet "Nunca teste com conta que revisa sozinha")
- Test: `test/instancia-isolada.test.js`

**Interfaces:**
- Produces: `instanciaIsolada: boolean` em `lib/paths.js`; `recusaDeIsolada(engine, acao, { isolada = instanciaIsolada } = {}) -> { ok:false, blocked:'instancia_isolada', attempted:false, error } | null` em `lib/engine/instancia-isolada.js`. `acao` é texto curto para o erro (`'postar review'`, `'adicionar label'`, `'pedir revisão'`, `'fazer merge'`). Devolve `null` quando `!isolada` ou `engine.config?.instanciaIsoladaPosta === true`.

- [ ] **Passo 1: teste que falha**

```js
// test/instancia-isolada.test.js (FAROL_HOME temporário no topo, como test/labels-a-tirar.test.js)
test('isolada e sem opt-in recusa, com o motivo dito', () => {
  const r = recusaDeIsolada({ config: {} }, 'postar review', { isolada: true });
  assert.equal(r.blocked, 'instancia_isolada');
  assert.match(r.error, /instanciaIsoladaPosta/);
});
test('opt-in por arquivo libera; instância normal não recusa', () => {
  assert.equal(recusaDeIsolada({ config: { instanciaIsoladaPosta: true } }, 'postar review', { isolada: true }), null);
  assert.equal(recusaDeIsolada({ config: {} }, 'postar review', { isolada: false }), null);
});
test('postReviewOnce em isolada não chama gh', async () => { /* motor fake com io.run espião: nenhuma chamada e blocked === 'instancia_isolada' */ });
test('FAROL_HOME igual ao ~/.farol (com barra final) não é isolada', () => { /* child process node -e importando lib/paths.js com FAROL_HOME=`${os.homedir()}/.farol/` e sem NODE_TEST_CONTEXT; imprime instanciaIsolada; espera "false" */ });
test('servidor filho com FAROL_HOME temporário expõe doctor.instanciaIsolada=true', async () => { /* spawn de server.js no molde de test/casca-stdin.test.js, env sem NODE_TEST_CONTEXT, lê GET /api/state com x-farol: 1 */ });
```

- [ ] **Passo 2: rodar e ver falhar**: `node --test test/instancia-isolada.test.js` (módulo inexistente).

- [ ] **Passo 3: implementar**
  - `lib/paths.js`: `const instanciaIsolada = !!process.env.FAROL_HOME && !process.env.NODE_TEST_CONTEXT && path.resolve(process.env.FAROL_HOME) !== path.join(os.homedir(), '.farol');` e exportar.
  - `lib/engine/instancia-isolada.js`: a função acima; texto do erro: `instância isolada (FAROL_HOME fora de ~/.farol) não ${acao} no GitHub; para permitir, grave "instanciaIsoladaPosta": true no config.json`.
  - `postagem-portao.recusaDaConta`: primeira linha `const isolada = recusaDeIsolada(engine, 'posta review'); if (isolada) { engine.log('WARN', ...uma vez por boot, com um Set no engine...); return isolada; }`.
  - `addInProgressLabel`: `if (recusaDeIsolada(engine, 'adiciona label')) return '';`. `setReviewers` e o merge: devolvem a recusa como `{ ok:false, error }`.
  - `doctor()`: `instanciaIsolada` no objeto devolvido (lido de `lib/paths.js`).
  - `CLAUDE.md:301`: acrescentar que desde esta entrega a instância com `FAROL_HOME` fora de `~/.farol` não escreve no GitHub sem `instanciaIsoladaPosta: true`, e que isso é invariante, não preferência.

- [ ] **Passo 4: rodar e ver passar**: `node --test test/instancia-isolada.test.js`, depois `npm run check && npm run lint && npm test`.

- [ ] **Passo 5: commit** `feat: instância isolada não escreve no GitHub sem opt-in`

---

### Tarefa 2: Pendência de remoção com prazo e sem ruído (A4 e A5)

**Files:**
- Modify: `lib/constants.js` (`TEMPOS.LABEL_PENDENCIA_MAX_MS: 7 * DIA_MS`)
- Modify: `lib/engine/labels-a-tirar.js:28-36` (`anotar`), `:52-61` (`remover`), `:80-98` (`tirarPendentes`)
- Modify: `lib/engine/gh-queries.js:49-54` (comentário), `CLAUDE.md` (linha de `labels-a-tirar.js`)
- Test: `test/labels-a-tirar.test.js`

**Interfaces:**
- Produces: a pendência ganha `avisado: boolean`; `tirarPendentes(engine, run, agora)` descarta pendência com `agora - desde >= TEMPOS.LABEL_PENDENCIA_MAX_MS`.

- [ ] **Passo 1: testes que falham**

```js
test('falha repetida grava UM WARN, não um por tentativa', async () => { /* io.run falha 3 vezes; e.logs com exatamente 1 linha "não saiu de" */ });
test('pendência com mais de 7 dias é descartada com um WARN e sem chamar gh', async () => { /* anotar com desde = agora - 8 dias; tirarPendentes(e, run, agora); run não chamado; arquivo sem a chave; 1 WARN contendo "7 dias" */ });
```

- [ ] **Passo 2: rodar e ver falhar.**
- [ ] **Passo 3: implementar**: em `remover`, só `engine.log('WARN', ...)` quando `!item.avisado`, e gravar `avisado: true` ao reanotar; em `tirarPendentes`, antes de `revisandoAqui`, o descarte por prazo com `engine.log('WARN', \`desisti de tirar a label ${item.label} de ${key} depois de 7 dias; confira no GitHub\`)`. Corrigir o comentário de `gh-queries.js:49-54` (a label é o sinal ESCRITO desde 28/08/2026 à tarde; as refs são leitura de transição) e a linha do `CLAUDE.md`.
- [ ] **Passo 4: rodar e ver passar** (`node --test test/labels-a-tirar.test.js`, depois o gate).
- [ ] **Passo 5: commit** `fix: pendência de remoção da label desiste em 7 dias e avisa uma vez`

---

### Tarefa 3: Tirar a label encerra a sessão, pelo vigia (A2, primeira boca)

**Files:**
- Modify: `lib/engine/gh-queries.js:253-260` (`prState` vira `prEstadoELabels` + `prState` como fachada)
- Modify: `server.js:802` (fachada `prEstadoELabels`)
- Modify: `lib/engine/vigia-sessao.js:19` (`MOTIVOS`), `:31-50` (`decidir`), `:58-75` (`conferir`), `:109-121` (`iniciar`)
- Modify: `lib/engine/review.js:877-891` (`tratarAbandonoDoVigia`), `:896-903` (`sessaoVigiada`)
- Modify: `ui/pure/radar.js:161-169` (`PARKED_FRASE`)
- Test: `test/vigia-sessao.test.js`, `test/ui-pure.test.js` (ou o que já cobre `parkedNoteHtml`)

**Interfaces:**
- Consumes: `estacionar(engine, key, motivo, tipo, head)` de `review.js:1685`.
- Produces: `prEstadoELabels(engine, pr) -> { estado: string, labels: string[] } | null` (uma chamada `gh pr view --json state,labels`); `MOTIVOS.LABEL = 'label-retirada'`; `decidir({ ..., labelPropria = '', labelsAgora = null })`; `iniciar(engine, pr, id, headInicial, { intervaloMs, labelAtual = () => '' })`; tipo de estacionamento `'label-retirada'`.

- [ ] **Passo 1: testes que falham**

```js
test('label própria que sumiu do PR manda abandonar', () => {
  assert.equal(decidir({ headInicial: 'a', headAgora: 'a', meusEstados: [], labelPropria: 'eu:revisando', labelsAgora: ['bug'] }).motivo, 'label-retirada');
});
test('label ainda no PR, sem label adicionada, ou leitura sem lista: segue', () => {
  assert.equal(decidir({ headInicial: 'a', headAgora: 'a', meusEstados: [], labelPropria: 'eu:revisando', labelsAgora: ['Eu:Revisando'] }).abandonar, false);
  assert.equal(decidir({ headInicial: 'a', headAgora: 'a', meusEstados: [], labelPropria: '', labelsAgora: [] }).abandonar, false);
  assert.equal(decidir({ headInicial: 'a', headAgora: 'a', meusEstados: [], labelPropria: 'eu:revisando', labelsAgora: null }).abandonar, false);
});
test('a rodada lê labels pela mesma chamada do estado e cancela com o motivo novo', async () => { /* motor fake: prEstadoELabels devolve { estado:'OPEN', labels:[] }; conferir com labelAtual () => 'eu:revisando'; cancelSession chamado; abandonoDe === 'label-retirada' */ });
test('label-retirada estaciona como tipo próprio, não como cancelado', () => { /* tratarAbandonoDoVigia com abandono 'label-retirada': parkedMotivos[key].tipo === 'label-retirada' */ });
test('parkedNoteHtml diz que a label foi retirada e como a revisão volta', () => { /* contém "label de revisão foi retirada" e "commit novo" */ });
```

- [ ] **Passo 2: rodar e ver falhar.**
- [ ] **Passo 3: implementar**
  - `prEstadoELabels`: mesmo `io.run` com `--json state,labels`; labels como `l.name` em lista; `prState` passa a chamar e devolver `estado`.
  - `decidir`: regra nova DEPOIS de fechado e head, ANTES de revisado: `labelPropria && Array.isArray(labelsAgora) && !labelsAgora.some(l => String(l).toLowerCase() === labelPropria.toLowerCase())`.
  - `conferir`: troca `engine.prState` por `engine.prEstadoELabels` (estado e labels da mesma leitura), passa `labelPropria: labelAtual()`; texto do `pushActivity` para o motivo novo: `A label de revisão foi retirada do PR: encerrando esta sessão, porque quem a tirou pediu para parar.`
  - `review.js`: `sessaoVigiada` recebe `{ labelAtual: () => labelEmAndamento }` e repassa a `vigiaMod.iniciar`; `tratarAbandonoDoVigia`: `if (motivo === vigiaMod.MOTIVOS.LABEL) { estacionar(engine, pr.key, 'a label de revisão foi retirada do PR', 'label-retirada', pr.headLido); toast \`${pr.key}: a label de revisão foi retirada do PR; a sessão foi encerrada e a revisão volta por clique, commit novo ou pedido novo.\`; return; }`.
  - `PARKED_FRASE['label-retirada'] = () => 'a label de revisão foi retirada do PR; a revisão volta por clique, commit novo ou pedido novo'`.
  - Conferir que `destrava.js:82,89` já tratam qualquer `tipo !== 'cancelado'` como destravável (nada a mudar; acrescentar um caso em `test/destrava*.test.js` com `tipo: 'label-retirada'` e commit novo posterior devolvendo o PR).
- [ ] **Passo 4: rodar e ver passar** e o gate.
- [ ] **Passo 5: commit** `feat: retirar a label de revisão encerra a sessão e estaciona com o motivo`

---

### Tarefa 4: Remover a própria label pela tela cancela a sessão antes (A2, segunda boca)

**Files:**
- Modify: `lib/engine/review-label-control.js:20-45` (`executar`)
- Modify: `ui/telas/review-labels.js:35` (texto da confirmação)
- Test: `test/review-label-control.test.js`

**Interfaces:**
- Consumes: `engine.cancelSession(id)`; `engine.activeReviews` (registros com `keys`, `mode`).
- Produces: resposta de `remove` ganha `sessaoCancelada: string | null` (o id da sessão deste aparelho cancelada, quando a label era da conta que revisa e havia sessão viva de revisão no PR).

- [ ] **Passo 1: teste que falha**

```js
test('remover a própria label com sessão viva cancela a sessão antes de tocar o GitHub', async () => {
  /* engine com activeReviews { 'a-1': { id:'a-1', keys:['acme/app#7'], mode:'auto' } } e cancelSession espião;
     command(engine, { url, action:'remove', label:'eu:revisando' }, run);
     ordem: cancelSession('a-1') antes do gh pr edit --remove-label; resposta.sessaoCancelada === 'a-1' */
});
test('label de outra conta não cancela nada', async () => { /* label 'ela:revisando': cancelSession não chamado; sessaoCancelada null */ });
```

- [ ] **Passo 2: rodar e ver falhar.**
- [ ] **Passo 3: implementar**: em `executar`, no ramo `remove`, antes de `labelsATirar.remover`: se `label.split(':')[0].toLowerCase() === conta.toLowerCase()`, para cada sessão em `engine.activeReviews` com `mode !== 'self'` e `keys.some(k => mesmoPr(k, pr.key))`, `engine.cancelSession(sessao.id)`; guardar o primeiro id em `sessaoCancelada`. Texto da confirmação na tela: `A remoção encerra a revisão em andamento neste aparelho e deixa o PR parado até clique, commit novo ou pedido novo. Outro aparelho pode adicionar a tag de novo.`
- [ ] **Passo 4: rodar e ver passar** e o gate (inclui `test/review-label-ui.test.js`, que pode travar o texto).
- [ ] **Passo 5: commit** `feat: remover a própria label pela tela cancela a sessão antes`

---

### Tarefa 5: A label espera a sessão provar vida (A1)

**Files:**
- Create: `lib/engine/label-tardia.js`
- Modify: `lib/constants.js` (`TEMPOS.LABEL_APOS_SPAWN_MS: 15 * 1000`, escrito como `HORA_MS / 240`)
- Modify: `lib/engine/review.js:1162-1177` (admissão e a adição imediata), `:1262-1295` (`streamOpts.onEvent`, `onAdmitted`), `:1395-1420` (`finally`)
- Test: `test/label-tardia.test.js`, `test/review-label.test.js`

**Interfaces:**
- Produces: `armarLabelTardia({ adicionar, esperaMs, setTimer = setTimeout, clearTimer = clearTimeout }) -> { aoEvento(), aoAdmitir(), cancelar(), promessa() }`. `adicionar` é `() => Promise<string>` e roda **uma vez**, no primeiro `aoEvento()` ou `esperaMs` depois de `aoAdmitir()`, o que vier primeiro; `cancelar()` apaga o timer e impede disparo futuro; `promessa()` devolve a promessa da adição (ou `Promise.resolve('')` se nunca disparou).

- [ ] **Passo 1: testes que falham**

```js
test('dispara uma vez no primeiro evento, e o timer não dispara de novo', async () => { /* timers falsos; aoAdmitir(); aoEvento(); aoEvento(); avança o relógio além de esperaMs; adicionar chamado 1 vez */ });
test('sem evento, dispara no prazo', async () => { /* aoAdmitir(); avança 15 s; adicionar chamado */ });
test('cancelar antes do prazo e sem evento: nunca dispara, promessa resolve vazio', async () => {});
test('runOneHeadless sem coordenação: sessão que morre antes de evento e de 15 s não chama --add-label', async () => { /* no harness de test/review-label.test.js: stream falso que rejeita em 50 ms sem emitir; lista de args do io.run não contém '--add-label' */ });
test('primeiro evento aos 2 s: label entra, e sai no finally', async () => { /* mesmo harness; ordem add depois remove */ });
```

- [ ] **Passo 2: rodar e ver falhar.**
- [ ] **Passo 3: implementar**: o módulo puro; em `review.js`, com `!coordenacaoLigada(engine)`: `const tardia = armarLabelTardia({ adicionar: () => addInProgressLabel(engine, pr).then(l => { labelEmAndamento = l; return l; }), esperaMs: TEMPOS.LABEL_APOS_SPAWN_MS })`; `onAdmitted` chama `tardia.aoAdmitir()` (sem coordenação) ou `porLabelNaAdmissao` (com); `onEvent` chama `tardia.aoEvento()` antes do `pushActivity`; no `finally`, `tardia.cancelar(); await tardia.promessa();` antes de `removeInProgressLabel`. O caminho com coordenação não muda.
- [ ] **Passo 4: rodar e ver passar** e o gate.
- [ ] **Passo 5: commit** `feat: a label de revisão espera o primeiro evento da sessão`

---

### Tarefa 6: Label própria sem dono some sozinha (A3)

**Files:**
- Modify: `lib/sync/lease.js` (exportar `leaseVivo`)
- Create: `lib/engine/label-propria-orfa.js`
- Modify: `server.js` (estado `labelPropriaVistaDesde` lido de `state/label-propria-vista.json` no construtor, ao lado de `labelVistaDesde`; chamada no `check()` logo depois de `labelsATirar.tirarPendentes`)
- Modify: `CLAUDE.md` (linha nova no mapa)
- Test: `test/label-propria-orfa.test.js`

**Interfaces:**
- Consumes: `labelsATirar.anotar/remover`, `revisandoAqui` (duplicar a leitura de `activeReviews` localmente, não importar de `labels-a-tirar.js`), `engine.syncCoordenacaoAtiva?.()`, `engine.sync` (`client`, `uid`), `accountHash`/`prHash` de `lib/sync/keys.js`, `TEMPOS.SINAL_REVISAO_TTL_MS`.
- Produces: `leaseVivo(client, ids, nowMs) -> true | false | null` (null = não deu para ler; quem chama trata como vivo); `carimbarEPodar(engine, panorama, agora) -> string[]` (keys cuja label própria passou do TTL; PURA sobre `engine.labelPropriaVistaDesde`); `tirarOrfas(engine, panorama, { agora = Date.now(), run } = {})`.

- [ ] **Passo 1: testes que falham**

```js
test('carimba a primeira vez que vê a própria label sem sessão e sem pendência; preserva o carimbo depois', () => {});
test('label que sumiu ou PR que saiu do panorama perde o carimbo', () => {});
test('com sessão viva deste aparelho no PR, não carimba', () => {});
test('passado o TTL de 3 h, entra em labels-a-tirar e remove', async () => { /* run espião recebe --remove-label */ });
test('com coordenação ligada e lease vivo de outro aparelho, não carimba nem remove', async () => { /* leaseVivo true */ });
test('leitura do lease que falha conta como vivo', async () => {});
```

- [ ] **Passo 2: rodar e ver falhar.**
- [ ] **Passo 3: implementar**: `leaseVivo` lê `client.get(caminhoDe(ids), COM_ETAG)` e aplica a mesma régua de `leaseAcquirable` (sem `expiresAt` numérico conta como vivo); o módulo novo percorre o panorama, acha `${conta}:revisando` (comparação sem caixa), aplica as três exclusões, carimba, e para as vencidas chama `anotar` e `remover`; grava o arquivo só quando muda (molde de `marcarLabelsVistas`). Fiação no `check()` em `try { await tirarOrfas(this, panorama) } catch (e) { this.log('WARN', ...) }`.
- [ ] **Passo 4: rodar e ver passar** e o gate.
- [ ] **Passo 5: commit** `feat: label própria sem sessão nem dono some depois do TTL`

---

### Tarefa 7: Quem pediu a revisão, e quando (B1)

**Files:**
- Modify: `lib/engine/gh-queries.js` (`ultimoPedidoDeRevisao`)
- Modify: `lib/engine/review.js:1087-1091` (registro da sessão) e onde `result` é montado antes de `recordDecision` (copiar `pr.pedido` para `result.pedido`)
- Modify: `lib/engine/provas-da-decisao.js:47-68` (`pedido`)
- Modify: `lib/engine/avisos-nativos.js:67-72` (evento `review-started`), `main.js:259` (registrar `notificar('review-started')`), `test/fixtures/casca/eventos.json`
- Modify: `ui/pure/sessao.js:201-240` (`sessionCardHtml`: linha do pedido)
- Test: `test/pedido-de-revisao.test.js`, `test/ui-widgets.test.js` ou o que cobre `sessionCardHtml`, `test/avisos-nativos*.test.js`

**Interfaces:**
- Produces: `ultimoPedidoDeRevisao(engine, pr) -> { por: string, em: string(ISO), time: boolean } | null` (uma chamada `gh api repos/{repo}/issues/{n}/timeline?per_page=100 --paginate` com `--jq` filtrando `review_requested` cujo `requested_reviewer.login` é a conta, sem caixa, ou `requested_team`; devolve o último; falha devolve `null`); registro da sessão e `provas.pedido` com a mesma forma; evento `review-started { pr, pedido }` que vira `aviso-nativo { titulo: 'Revisão automática iniciada', corpo: '<key>, pedida por @<por> às <hh:mm>', url, silencioso: true }` (sem pedido: corpo `'<key>, pedido não identificado'`).

- [ ] **Passo 1: testes que falham**

```js
test('ultimoPedidoDeRevisao devolve o último pedido para a conta, sem caixa, e null em falha', async () => {});
test('provasDaDecisao carrega pedido quando o result tem, e null quando não tem', () => {});
test('sessionCardHtml mostra "pedida por" com menção navegável e hora quando há pedido', () => { /* contém personMention do login; sem pedido, não contém "pedida por" */ });
test('avisoDe("review-started") monta o aviso silencioso com o pedido', () => {});
```

- [ ] **Passo 2: rodar e ver falhar.**
- [ ] **Passo 3: implementar**: após `engine.activeReviews.set(id, ...)` e só quando `!pr.manual`, `ultimoPedidoDeRevisao(engine, pr).then(p => { const s = engine.activeReviews.get(id); if (!s) return; s.pedido = p; pr.pedido = p; engine.emit('review-started', { pr, pedido: p }); engine.pushState(); }).catch(() => {})`; o toast sai do próprio `review-started` na tela (ouvinte já existente de eventos do SSE, texto `▶ <key>: revisão automática iniciada, pedida por @<por> às <hh:mm>`); `provasDaDecisao` acrescenta `pedido: result.pedido || null`; cartão: `<span class="session-requested">pedida por ${personMention(por, 'xs')} às ${hora}</span>` (hora pelo helper de formatação de `ui/pure/comum.js`), time sem menção de pessoa.
- [ ] **Passo 4: rodar e ver passar** e o gate (a fixture de paridade das cascas reprova evento sem exemplo).
- [ ] **Passo 5: commit** `feat: a revisão automática mostra quem a pediu e quando`

---

### Tarefa 8: PR em conflito com a base não abre sessão automática (C2)

**Files:**
- Modify: `lib/engine/gh-queries.js` (`mergeavelDoPr`)
- Create: `lib/engine/espera-conflito.js`
- Modify: `lib/engine/review.js` (gate de lançamento do caminho automático, no mesmo ponto em que `bloqueiaAutomatico`/`jaResolvido` rodam antes da sessão; motivo `conflito` no `parado(...)` da máquina de estados da linha 1502 em diante)
- Modify: `server.js` (snapshot: `esperaConflito` com `{ key: { at, head } }`)
- Modify: `ui/pure/radar.js:182-236` (`queueCardHtml`: nota `pr-coord` quando `ctx.esperaConflito?.[pr.key]`)
- Modify: `CLAUDE.md` (mapa e a lista de motivos de `parado`), `docs/REVIEW-GATES.md` (parágrafo na seção "Gate de consciência" ou vizinha)
- Test: `test/espera-conflito.test.js`, teste da UI que cobre `queueCardHtml`

**Interfaces:**
- Produces: `mergeavelDoPr(engine, pr) -> 'CONFLICTING' | 'MERGEABLE' | 'UNKNOWN' | null` (`gh pr view --json mergeable`); `seguraPorConflito(engine, pr, { agora, ler = mergeavelDoPr }) -> Promise<boolean>` (`true` só com `'CONFLICTING'`; cache em `engine.conflitoLido` por `key` + `updatedAt`, então custa uma leitura por mudança do PR; grava `engine.esperaConflito[key] = { at, head }` e emite toast uma vez por `key`+`head`: `⏸ <key>: em conflito com a base; a revisão automática abre quando o conflito for resolvido.`; `'MERGEABLE'` apaga a marca); chave `config.aguardarMergeavelParaRevisar` lida como `!== false` (ligada por padrão).

- [ ] **Passo 1: testes que falham**

```js
test('CONFLICTING segura, UNKNOWN e null não seguram, MERGEABLE limpa a marca', async () => {});
test('a leitura é reaproveitada enquanto o updatedAt não muda', async () => { /* ler espião chamado 1 vez em 3 chamadas */ });
test('toast sai uma vez por PR e head', async () => {});
test('clique manual atravessa (pr.manual) e a chave em false desliga', async () => {});
test('queueCardHtml mostra a nota de conflito quando há espera', () => {});
```

- [ ] **Passo 2: rodar e ver falhar.**
- [ ] **Passo 3: implementar** o módulo e a fiação; no gate de lançamento: `if (!pr.manual && await esperaConflito.seguraPorConflito(engine, pr)) return parado('conflito', ...)` no mesmo molde dos motivos vizinhos; o snapshot leva `esperaConflito`; a nota do card: `Em conflito com a base: a revisão automática abre quando o conflito for resolvido. O botão Revisar não espera.`
- [ ] **Passo 4: rodar e ver passar** e o gate.
- [ ] **Passo 5: commit** `feat: PR em conflito com a base espera antes da revisão automática`

---

### Tarefa 9: Todo bloqueio declara a causa, e só defeito reprova sozinho (C1)

**Files:**
- Modify: `lib/engine/review-findings.js:5-26` (`CAUSAS`, validação, `causasDosBloqueios`)
- Modify: `lib/engine/desfecho-automatico.js:43-55` (`bloqueiosSoDeEstado`, `causaDaEspera`), exportações
- Modify: `lib/engine/approval-policy.js:68-81` (`shouldAutoReject`), `:85-95` (`TEXTOS_DA_RECUSA.bloqueio_de_estado`)
- Modify: `lib/engine/desfecho-da-revisao.js:252-283` (`registrarPendencia`)
- Modify: `workspace-template/prompts/pr-review-auto.md:39,77,105,196`, `workspace-template/.claude/agents/pr-reviewer.md` (depois do Gate do BLOCKER)
- Modify: `CLAUDE.md` (invariante 4, parágrafo "A decisão sem mesa"), `docs/REVIEW-GATES.md:195` (subseção nova "Bloqueio de estado não reprova (05/11/2026)")
- Test: `test/review-findings*.test.js`, `test/decisao-sem-mesa.test.js`, `test/motivo-recusa-visivel.test.js`

**Interfaces:**
- Produces: `CAUSAS = ['defeito_codigo', 'card', 'ci', 'conflito', 'dependencia', 'fora_do_diff']`; finding `blocking` sem `causa` válida é inválido (`issues` ganha `achado bloqueante N sem causa declarada`); findings não bloqueantes ignoram `causa`; `causasDosBloqueios(result) -> Set<string>` (bloqueios atuais, fora `resolvido`/`retirado`); `CAUSAS_QUE_REPROVAM = ['defeito_codigo', 'card']`; `bloqueiosSoDeEstado(result) -> boolean` (há bloqueio e nenhum com causa que reprova); `causaDaEspera(result) -> 'ci' | 'conflito' | 'mesa'` (`ci` se alguma causa é `ci`, senão `conflito` se alguma é `conflito`, senão `mesa`).

- [ ] **Passo 1: testes que falham**

```js
test('blocking sem causa é achado inválido; suggestion sem causa é válida', () => {});
test('causasDosBloqueios ignora resolvidos e retirados', () => {});
test('shouldAutoReject recusa quando os bloqueios são só de estado', () => { /* verdict request_changes, findings [{severity:'blocking', causa:'conflito', ...}], política request_changes: false */ });
test('shouldAutoReject segue aceitando defeito_codigo e card', () => {});
test('violação técnica confirmada continua reprovando sem olhar causa', () => { /* technicalReview com fail, findings só de estado: caminhoNovo devolve tipo defeito */ });
test('bloqueio só de ci arma a espera do CI; só de conflito vai à espera de conflito; dependencia vai à mesa com o motivo dito', async () => { /* registrarPendencia: reasons[0] contém "não em defeito do código" */ });
test('envelope legado (findings undefined) com verdict request_changes não posta e não aprova', async () => { /* já coberto pela análise incompleta? garantir que normalizeFindings status legacy mantém o comportamento atual: nada muda */ });
```

- [ ] **Passo 2: rodar e ver falhar.**
- [ ] **Passo 3: implementar**
  - `review-findings.js`: constante, validação (`f.severity === 'blocking' && !CAUSAS.includes(f.causa)` entra em `invalid`), copiar `causa` para o finding normalizado, `causasDosBloqueios`.
  - `desfecho-automatico.js`: as duas funções, lendo `normalizeFindings(result.findings)`.
  - `approval-policy.js`: em `shouldAutoReject`, depois de `analiseSustentaReprovacao`: `if (bloqueiosSoDeEstado(result)) return false;`. Texto: `bloqueio_de_estado: () => 'a reprovação se apoia só no estado do PR (CI, conflito, dependência ou arquivo fora do diff), não em defeito do código: espera, sem reprovar'`.
  - `desfecho-da-revisao.registrarPendencia`: antes de `armarEspera`, `if (result.verdict === 'request_changes' && auto.bloqueiosSoDeEstado(result))`: prepor `gateReason(textoDaRecusa(engine, pr, 'bloqueio_de_estado', result))`; `causaDaEspera` `ci` → `esperaCi.armar(motivoDeEspera(result), result, pontos)` (null cai na mesa); `conflito` → marca em `engine.esperaConflito` (Tarefa 8) e `status: 'pending'` com `blockedKind: 'conflito'`; `mesa` → fluxo de sempre.
  - Prompts: linha 77 do schema ganha `"causa": "defeito_codigo|card|ci|conflito|dependencia|fora_do_diff"` com a nota `obrigatória em blocking`; linha 39 ganha `Conflito com a base, CI que não rodou e arquivo que este PR não toca não são defeito deste PR: declare a causa e deixe o motor decidir a espera.`; `pr-reviewer.md` ganha, depois do Gate do BLOCKER, a tabela das seis causas (uma linha cada, copiada do desenho).
  - Docs: `CLAUDE.md` invariante 4 ("defeito do PR vira REQUEST_CHANGES") ganha a frase `desde 05/11/2026 o bloqueio que o modelo declara com causa de estado (ci, conflito, dependencia, fora_do_diff) não reprova sozinho: espera ou mesa`; `REVIEW-GATES.md` ganha a subseção com a tabela e a medição do dia (tenant-company#293, biud-frontend#1784, engine-ai#880).
- [ ] **Passo 4: rodar e ver passar** e o gate.
- [ ] **Passo 5: commit** `feat: bloqueio só de estado do PR não reprova sozinho; todo bloqueio declara a causa`

---

### Tarefa 10: Gate final, mapa e nota de versão

**Files:**
- Modify: `CLAUDE.md` (linhas do mapa para `instancia-isolada.js`, `label-tardia.js`, `label-propria-orfa.js`, `espera-conflito.js`; a linha de `vigia-sessao` se existir; a de `review-label-control.js`)
- Modify: `docs/REVIEW-GATES.md` (seção "Um Farol por PR": as três frentes da label; seção "Sessão presa com a label": referência ao motivo `label-retirada`)
- Modify: `package.json` (versão, pela regra de `docs/RELEASE.md`) e notas de versão (`ui/telas/release-notes.js`, no molde das entradas existentes)

- [ ] **Passo 1**: `npm run check && npm run lint && npm test` e `npm run eng` (as avaliações do eng-behaviour por regra de julgamento, uma por regra acionada, com fundamentação sobre este diff).
- [ ] **Passo 2**: `node test/guias-navegaveis.test.js` passa (links e índice do `CLAUDE.md`).
- [ ] **Passo 3: commit** `docs: labels como contrato, pedido visível e rigor proporcional`

---

## Autoavaliação do plano

- **Cobertura do desenho**: A1 (T5), A2 (T3, T4), A3 (T6), A4 e A5 (T2), B1 (T7), B2 (sem mudança, conferido), C1 (T9), C2 (T8), C3 (sem código: configuração da conta), D (T1), docs (T10). "Fora do desenho" (declaração técnica) não tem tarefa, de propósito.
- **Nomes entre tarefas**: `prEstadoELabels` (T3) é a única leitura nova que o vigia usa; `esperaConflito` (T8) é consumida por T9 em `causaDaEspera === 'conflito'`; `estacionar(..., 'label-retirada')` (T3) é o tipo que `PARKED_FRASE` (T3) e `destrava.js` leem; `instanciaIsolada` (T1) só é lida por `instancia-isolada.js` e pelo `doctor`.
- **Review Focus**: 1 em T3, 2 em T9, 3 em T6, 4 em T1, 5 em T5.
- **Proporção**: o plano decide arquivos, assinaturas, valores e testes; corpos ficam com quem constrói.
