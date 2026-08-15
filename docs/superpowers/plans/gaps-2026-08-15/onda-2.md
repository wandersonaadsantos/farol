# Onda 2: round 2 resiliente + reconcile completo (G7 a G13, release v2.41.3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o round 2 automático (v2.41.0) sobrevive a reinício, flake de gh e queda de rede; o reconcile de pendências cobre PR fechado e review no mesmo head; bloqueio de linguagem ganha saída. Spec: `../../specs/2026-08-15-gaps-v2411-auditoria.md`.

**Global Constraints:** ver "Regras globais" do `00-plano-mestre.md`. Pré-requisito: onda 1 publicada (a Task 2.6 usa o `commit_id` da Task 1.1).

---

### Task 2.1: G7, reinício não queima a âncora do round 2

**Files:**
- Modify: `server.js` (`recoverInflight`, hoje :243-249; conferir a ordem dos loads no construtor)
- Test: `test/rereview.test.js` (acrescentar caso)

- [ ] **Step 1: conferir a ordem do boot.** Ler o construtor da Engine em `server.js` e localizar onde `this.reReviewLaunched` é carregado (busque `rereview-launched`). Se o load acontece DEPOIS de `this.recoverInflight()` (hoje :238), mover a linha do load pra antes; a poda do Step 3 depende do mapa já carregado.

- [ ] **Step 2: teste que falha.** Em `test/rereview.test.js`:

```js
test('recoverInflight poda a âncora de re-revisão dos PRs que estavam em andamento', () => {
  // monta um FAROL_HOME temporário com:
  //  - state/inflight.json = [{ key: 'acme/repo#5', url: '...', title: 't' }]
  //  - state/rereview-launched.json = { 'acme/repo#5': 'a'.repeat(40), 'acme/outro#6': 'b'.repeat(40) }
  // sobe a Engine e afirma:
  const e = new Engine();
  assert.equal(e.reReviewLaunched['acme/repo#5'], undefined, 'âncora do PR interrompido foi podada');
  assert.equal(e.reReviewLaunched['acme/outro#6'], 'b'.repeat(40), 'âncora alheia intacta');
});
```
(Usar o padrão de FAROL_HOME temporário por processo que os outros testes de boot usam; gravar os dois JSONs ANTES do `new Engine()`.)

- [ ] **Step 3: fix.** Em `recoverInflight`, depois do loop de `unsee` (hoje :246), acrescentar:

```js
    // G7: a âncora do round 2 é gravada ANTES de enfileirar; se o app morreu com
    // a re-revisão na fila/rodando, a âncora sem a revisão mataria o round pra
    // sempre naquele head. Poda: o próximo check() re-arma pelo staleInfo.
    let podado = false;
    for (const pr of inflight) {
      if (pr && pr.key && this.reReviewLaunched && this.reReviewLaunched[pr.key] !== undefined) {
        delete this.reReviewLaunched[pr.key]; podado = true;
      }
    }
    if (podado) this.saveReReviewLaunched();
```

- [ ] **Step 4: rodar e ver passar.** `node --test test/rereview.test.js test/boot.test.js`.
- [ ] **Step 5: gate e commit.** `npm run check && npm test`, depois:
```bash
git add server.js test/rereview.test.js
git commit -m "fix(re-revisao): reinício com round 2 em andamento poda a âncora e o ciclo re-arma (G7)"
```

---

### Task 2.2 [OPUS]: G8, o head conhecido viaja com o PR relançado

**Files:**
- Modify: `lib/engine/review.js` (`launchReReviews` :617 e `runHeadlessReview` :347-350)
- Test: `test/rereview.test.js` e `test/review-commit-id.test.js` (acrescentar casos)

**Interfaces:**
- Produces: PRs enfileirados podem carregar `knownHead` (sha string). `runHeadlessReview` usa como fallback quando o fetch do headSha falha. Consome o `commit_id` da Task 1.1 (o fallback também ancora o post).

- [ ] **Step 1: teste que falha.** Dois casos:

```js
// em test/rereview.test.js: launchReReviews enfileira com knownHead = âncora
test('re-revisão enfileira o PR com o head que o staleInfo conheceu', () => {
  // engine fake no padrão do arquivo; espião em enqueueHeadless
  // afirmar: chamado com objeto contendo knownHead === staleInfo[key].head e requested === true
});

// em test/review-commit-id.test.js: fallback do headSha
test('runHeadlessReview usa knownHead quando o fetch do headSha falha', async () => {
  // engine com headSha = async () => { throw new Error('rede'); }
  // runClaudeStream stubado devolvendo envelope mínimo; pr = { ..., knownHead: 'c'.repeat(40) }
  // afirmar: myReviewStates foi chamado com 'c'.repeat(40) (espião), não com ''
});
```

- [ ] **Step 2: rodar e ver falhar.**

- [ ] **Step 3: fix.** Em `launchReReviews` (hoje :617):

```js
  for (const pr of alvos) engine.enqueueHeadless({
    ...pr, account: engine.accountForPr(pr), requested: true,
    // G8: o gate SÓ arma com head conhecido (info.head); carregá-lo evita que um
    // flake de gh no início da sessão degrade o dedup pro comportamento antigo e
    // mate o round 2 como already_reviewed com a âncora já queimada
    knownHead: (engine.staleInfo[pr.key] || {}).head || ''
  });
```

Em `runHeadlessReview` (hoje :347-350), trocar:

```js
  try {
    engine.activeReviews.get(id).headSha = await engine.headSha(pr);
  } catch { /* sem SHA: entradas desta sessão gravam headSha vazio, tratado como "sempre considerado" na leitura */ }
  const headShaAtual = (engine.activeReviews.get(id) || {}).headSha || '';
```
por:
```js
  try {
    engine.activeReviews.get(id).headSha = await engine.headSha(pr);
  } catch { /* sem SHA do fetch: tenta o knownHead do enfileiramento abaixo */ }
  if (!(engine.activeReviews.get(id) || {}).headSha && pr.knownHead) {
    engine.activeReviews.get(id).headSha = pr.knownHead; // G8: fallback do relançamento
  }
  const headShaAtual = (engine.activeReviews.get(id) || {}).headSha || '';
```

- [ ] **Step 4: rodar e ver passar.** `node --test test/rereview.test.js test/review-commit-id.test.js test/dedup-round.test.js`.
- [ ] **Step 5: gate e commit.**
```bash
git add lib/engine/review.js test/rereview.test.js test/review-commit-id.test.js
git commit -m "fix(re-revisao): head conhecido viaja com o relançamento e cobre flake do headSha (G8)"
```

---

### Task 2.3: G9, retry pós-rede relança o OBJETO guardado (requested sobrevive)

**Files:**
- Modify: `server.js` (bloco do retry, hoje :716-737)
- Test: `test/retry-net.test.js` (acrescentar caso)

- [ ] **Step 1: teste que falha.**

```js
test('retry relança preservando requested: true do objeto guardado', async () => {
  // engine no padrão do arquivo; retryAfterNet.set('acme/repo#3', prComRequestedTrue)
  // espião em enqueueHeadless; rodar o trecho do check (ou extrair helper, ver Step 3)
  // afirmar: enqueueHeadless recebeu objeto com requested === true e knownHead preservado
});
```

- [ ] **Step 2: rodar e ver falhar.**

- [ ] **Step 3: fix.** No bloco do retry (hoje :732-735), trocar:

```js
          if (stillOpen.length) {
            this.emit('toast', { kind: 'info', text: `Conexão de volta: relançando a revisão de ${stillOpen.map(p => p.key).join(', ')}.` });
            this.launchReview(stillOpen.map(p => p.url), 'auto');
          }
```
por:
```js
          if (stillOpen.length) {
            this.emit('toast', { kind: 'info', text: `Conexão de volta: relançando a revisão de ${stillOpen.map(p => p.key).join(', ')}.` });
            // G9: relança o OBJETO guardado (era o motivo de guardá-lo): relançar
            // por URL re-resolvia no panorama e requested virava false, rebaixando
            // um round automático a manual com a reason errada
            for (const pr of stillOpen) this.enqueueHeadless(pr);
          }
```
Conferir que `retryTargets` devolve os objetos guardados no `retryAfterNet` (é o contrato atual; o teste do Step 1 prova).

- [ ] **Step 4: rodar e ver passar.** `node --test test/retry-net.test.js`.
- [ ] **Step 5: gate e commit.**
```bash
git add server.js test/retry-net.test.js
git commit -m "fix(retry): relançamento pós-rede preserva requested e knownHead do objeto guardado (G9)"
```

---

### Task 2.4: G10, draft não arma re-revisão automática

**Files:**
- Modify: `lib/engine/review.js` (`reReviewTargets`, hoje :551-578)
- Test: `test/rereview.test.js`

- [ ] **Step 1: teste que falha.** No padrão dos casos existentes do gate: mesmo cenário que arma (stale, head, CHANGES_REQUESTED), mas `pr.isDraft = true`; esperado: fora dos alvos. Caso espelho com `isDraft: false` continua armando.
- [ ] **Step 2: rodar e ver falhar.**
- [ ] **Step 3: fix.** Logo após o check de `lastState` (hoje :558):

```js
    // G10: draft é trabalho sabidamente em andamento; re-revisar a cada push de
    // WIP queima sessão e, com onReject ligado, posta um review por push (cadência
    // que denuncia a automação). O chip manual continua cobrindo draft.
    if (pr.isDraft) return false;
```
- [ ] **Step 4: rodar e ver passar.** `node --test test/rereview.test.js`.
- [ ] **Step 5: gate e commit.**
```bash
git add lib/engine/review.js test/rereview.test.js
git commit -m "fix(re-revisao): draft não arma round automático, só por clique (G10)"
```

---

### Task 2.5: G11, reconcile resolve pendência de PR fechado sem merge

**Files:**
- Modify: `lib/engine/decision.js` (`reconcilePending`, hoje :187-195)
- Modify: `ui/pure.js` (rótulo do status novo; busque `already_merged` pra achar o mapa de labels)
- Test: `test/reconcile-pending.test.js`

- [ ] **Step 1: teste que falha.** No padrão do caso `'MERGED'` existente (linha ~132): `prState` stubado devolvendo `'CLOSED'`; esperado: pendência sai, histórico ganha `status: 'already_closed'`, `action: 'skip'`.
- [ ] **Step 2: rodar e ver falhar.**
- [ ] **Step 3: fix.** Trocar o bloco do MERGED (hoje :187-195) por:

```js
    if (estado === 'MERGED' || estado === 'CLOSED') {
      const idx = engine.decisions.pending.findIndex(d => d.id === item.id);
      if (idx < 0) continue;
      engine.decisions.pending.splice(idx, 1);
      engine.resolveIntoHistory({ ...item, status: estado === 'MERGED' ? 'already_merged' : 'already_closed', action: 'skip' });
      resolvidas++;
      engine.emit('toast', {
        kind: 'info', text: estado === 'MERGED'
          ? `${item.key}: já foi mergeado; cancelei a revisão pendente.`
          : `${item.key}: o PR foi fechado sem merge; cancelei a revisão pendente.`
      });
      continue;
    }
```
No `ui/pure.js`, acrescentar o rótulo de `already_closed` ao lado do de `already_merged` (ex.: `'PR fechado sem merge'`), no mesmo mapa/função onde os demais status viram texto.
- [ ] **Step 4: rodar e ver passar.** `node --test test/reconcile-pending.test.js test/ui-pure.test.js`.
- [ ] **Step 5: gate e commit.**
```bash
git add lib/engine/decision.js ui/pure.js test/reconcile-pending.test.js
git commit -m "fix(reconcile): PR fechado sem merge resolve a pendência como already_closed (G11)"
```

---

### Task 2.6 [OPUS]: G12, review no MESMO head anterior à pendência reconcilia

**Files:**
- Modify: `lib/engine/review.js` (`runHeadlessReview`: gravar o head no result antes dos recordDecision)
- Modify: `lib/engine/decision.js` (`recordDecision` grava `headSha`; `reconcilePending` :200-203 aceita match por commit)
- Test: `test/reconcile-pending.test.js`

**Interfaces:**
- Produces: itens de decisão passam a carregar `headSha` (o head que a sessão leu; '' quando desconhecido). `reconcilePending` aceita review com `commit === item.headSha` mesmo com `at <= createdAt`.

- [ ] **Step 1: teste que falha.**

```js
test('review meu no MESMO head, submetido ANTES da pendência nascer, resolve o card', async () => {
  // pendência com createdAt = agora e headSha = 'd'.repeat(40)
  // myReviewsWithTime stubado devolvendo [{ state: 'APPROVED', at: createdAt - 60000, commit: 'd'.repeat(40) }]
  // esperado: pendência resolvida como already_reviewed com action approve
});

test('review antigo em OUTRO head continua NÃO resolvendo (caso re-request preservado)', async () => {
  // igual, mas commit = 'e'.repeat(40); esperado: pendência fica
});
```

- [ ] **Step 2: rodar e ver falhar.**
- [ ] **Step 3: fix em três pontos.**

(a) `runHeadlessReview`: logo depois de `const result = engine.parseHeadlessResult(res.text);` (hoje :384), acrescentar `result.headSha = headShaAtual;`.

(b) `recordDecision` (decision.js, objeto montado hoje :25-41): acrescentar o campo `headSha: result.headSha || '',` junto dos demais.

(c) `reconcilePending` (hoje :200-203), trocar:
```js
    const depois = reviews
      .filter(r => r.at && r.at > item.createdAt && REVIEW_STATE_ACTION[r.state])
      .sort((a, b) => a.at - b.at);
```
por:
```js
    // G12: review posterior à pendência OU review do MESMO head que a sessão leu
    // (você aprovou à mão DURANTE a análise: o horário é anterior, o head prova
    // que fala do mesmo código). Review antigo em head antigo segue fora (caso
    // re-request, que motivou a trava de horário).
    const depois = reviews
      .filter(r => REVIEW_STATE_ACTION[r.state] &&
        ((r.at && r.at > item.createdAt) || (item.headSha && r.commit && r.commit === item.headSha)))
      .sort((a, b) => a.at - b.at);
```
- [ ] **Step 4: rodar e ver passar.** `node --test test/reconcile-pending.test.js test/dedup-round.test.js`.
- [ ] **Step 5: gate e commit.**
```bash
git add lib/engine/review.js lib/engine/decision.js test/reconcile-pending.test.js
git commit -m "fix(reconcile): review no mesmo head da pendência resolve o card mesmo anterior a ela (G12)"
```

---

### Task 2.7: G13, bloqueio de linguagem ganha motivo persistente e saída

**Files:**
- Modify: `lib/engine/decision.js` (`decide`, ramo de falha do post, hoje :584-586)
- Modify: `ui/app.js` (card da pendência exibe o motivo; localizar o render buscando por onde as `reasons` da pendência são montadas)
- Test: `test/decide-concurrency.test.js` (acrescentar caso; o arquivo nasceu na Task 1.2)

- [ ] **Step 1: teste que falha.**

```js
test('decide(): bloqueio internal_language grava blockedReason persistente na pendência', async () => {
  // postReview stubado devolvendo { ok: false, blocked: 'internal_language', error: 'a redação...' }
  // esperado: r.ok false; a pendência CONTINUA na lista; item.blockedReason contém a orientação
});
```

- [ ] **Step 2: rodar e ver falhar.**
- [ ] **Step 3: fix no decide().** Trocar (hoje :584-586):

```js
  if (!post.ok) {
    engine.emit('toast', { kind: 'error', text: `Falha ao postar em ${item.key}: ${post.error}` });
    return post;
  }
```
por:
```js
  if (!post.ok) {
    if (post.blocked === 'internal_language') {
      // G13: o payload é imutável e não existe editor; sem registrar o motivo, o
      // clique falha idêntico pra sempre sem dizer a saída. O chat do PR é o
      // caminho mediado pra redigir e postar um texto novo.
      item.blockedReason = 'a redação gerada foi bloqueada pelo filtro de linguagem; use o chat deste PR pra redigir e postar o review';
      engine.saveDecisions();
      engine.pushState();
    }
    engine.emit('toast', { kind: 'error', text: `Falha ao postar em ${item.key}: ${post.error}` });
    return post;
  }
```
- [ ] **Step 4: UI.** Em `ui/app.js`, no render do card de pendência (onde as reasons aparecem), exibir `d.blockedReason` quando presente, como linha destacada. Conferir que `decisionForUi` (decision.js) deixa `blockedReason` passar pra UI; se a projeção for allowlist de campos, acrescentar o campo lá (ele é texto NOSSO, fixo, não vaza relatório).
- [ ] **Step 5: rodar e ver passar.** `node --test test/decide-concurrency.test.js` e smoke visual (subir com FAROL_HOME de teste).
- [ ] **Step 6: gate e commit.**
```bash
git add lib/engine/decision.js ui/app.js test/decide-concurrency.test.js
git commit -m "fix(decisao): bloqueio de linguagem registra motivo persistente e aponta o chat como saída (G13)"
```

---

### Fechamento da onda 2

- [ ] Gate completo `npm run check && npm test`.
- [ ] Revisão adversarial (agente OPUS) do diff da onda contra a spec, com atenção especial ao trio dedup (regra global 5) e ao invariante 4 (nenhum gate afrouxou).
- [ ] Release v2.41.3 pelo checklist do CLAUDE.md.
