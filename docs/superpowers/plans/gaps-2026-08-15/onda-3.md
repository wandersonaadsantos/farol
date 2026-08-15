# Onda 3: ciclo de vida e higiene (G14 a G21, release v2.41.4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** fechar os 8 gaps de ciclo de vida: update ciente de terminal, estacionamento persistido, orçamento re-checado, capability viva com a sessão, desempate multi-conta, guarda de merge, limpeza de downloads e o env de auth do login. Spec: `../../specs/2026-08-15-gaps-v2411-auditoria.md`.

**Global Constraints:** ver "Regras globais" do `00-plano-mestre.md`. Pré-requisito: onda 2 publicada.

---

### Task 3.1: G14, update recusa com sessão de terminal aberta

**Files:**
- Modify: `lib/engine/update.js` (`sessionsBusy`, hoje :132-134)
- Test: `test/update.test.js`

- [ ] **Step 1: teste que falha.**

```js
test('sessionsBusy: sessão de TERMINAL aberta também segura o update', () => {
  // engine mínimo no padrão dos casos M15 do arquivo
  engine.activeReviews.set('t1', { id: 't1', mode: 'terminal', keys: ['acme/repo#1'] });
  assert.equal(sessionsBusy(engine), true);
});
```

- [ ] **Step 2: rodar e ver falhar.**
- [ ] **Step 3: fix.**

```js
function sessionsBusy(engine) {
  // G14: o installer mata o processo; sessão de TERMINAL viva perderia o
  // handler de exit (PRs ficariam "vistos" pra sempre) e a capability de
  // postagem (que é memória). Terminal ocupado também barra o update.
  const terminalVivo = [...engine.activeReviews.values()].some(s => s.mode === 'terminal');
  return !!(engine.headlessBusyAccounts.size || engine.running.size || engine.headlessQueue.length || terminalVivo);
}
```
- [ ] **Step 4: rodar e ver passar.** `node --test test/update.test.js`.
- [ ] **Step 5: gate e commit.**
```bash
git add lib/engine/update.js test/update.test.js
git commit -m "fix(update): sessão de terminal aberta segura o auto-update (G14)"
```

---

### Task 3.2: G15, estacionamento persiste entre reinícios

**Files:**
- Modify: `server.js` (construtor: load; novo método `saveAutoReviewParked`; poda no check)
- Modify: `lib/engine/review.js` (pontos que fazem `autoReviewParked.add/delete` chamam o save; localizar com `grep -n autoReviewParked lib/engine/review.js server.js`)
- Test: `test/retry-net.test.js` (caso de persistência)

- [ ] **Step 1: teste que falha.**

```js
test('autoReviewParked sobrevive a reinício da Engine', () => {
  // FAROL_HOME temporário; engine1.autoReviewParked.add('acme/repo#4'); engine1.saveAutoReviewParked();
  // const engine2 = new Engine();
  assert.equal(engine2.autoReviewParked.has('acme/repo#4'), true);
});
```

- [ ] **Step 2: rodar e ver falhar.**
- [ ] **Step 3: fix.** No construtor (hoje :207), trocar `this.autoReviewParked = new Set();` por load do arquivo (padrão do pushbackScanned):

```js
    // G15: estacionamento persistido; era memória pura e cada reinício (inclusive
    // o do próprio auto-update) relançava sessões fadadas à mesma falha conhecida
    this.autoReviewParked = new Set(readJson(path.join(STATE_DIR, 'auto-review-parked.json'), [], (m) => this.log('WARN', m)));
```
Novo método na Engine (ao lado de savePushbackScanned na fiação de fachadas ou direto no server.js):
```js
  saveAutoReviewParked() {
    try { writeJsonAtomic(path.join(STATE_DIR, 'auto-review-parked.json'), [...this.autoReviewParked]); }
    catch { /* best-effort: perder o arquivo só re-relança uma vez no boot */ }
  }
```
Chamar `engine.saveAutoReviewParked()` imediatamente após CADA `autoReviewParked.add(...)` e `.delete(...)` no repo (grep obrigatório; hoje os adds moram em `lib/engine/review.js` no estacionamento pós-falha e no cancelamento, e os deletes no relançamento manual). No `check()`, podar keys fora do panorama (mesmo padrão da poda do reReviewLaunched em `launchReReviews`), salvando se mudou.
- [ ] **Step 4: rodar e ver passar.** `node --test test/retry-net.test.js test/boot.test.js`.
- [ ] **Step 5: gate e commit.**
```bash
git add server.js lib/engine/review.js test/retry-net.test.js
git commit -m "fix(fila): estacionamento pós-falha persiste entre reinícios (G15)"
```

---

### Task 3.3: G16, orçamento re-checado na boca da sessão

**Files:**
- Modify: `lib/engine/review.js` (`runOneHeadless`, logo após o check de já-mergeado, hoje ~:169)
- Test: `test/check-resilience.test.js`

- [ ] **Step 1: teste que falha.**

```js
test('runOneHeadless re-checa o orçamento antes de abrir a sessão', async () => {
  // budgetBlockedFor stubado: false no enfileiramento, true na hora de rodar
  // esperado: runHeadlessReview NÃO é chamado; pr.key entra em autoReviewParked;
  // slot devolvido (headlessBusyAccounts vazio ao final); 1 toast informativo
});
```

- [ ] **Step 2: rodar e ver falhar.**
- [ ] **Step 3: fix.** Em `runOneHeadless`, depois do bloco `jaMergeado` (hoje :162-169), acrescentar:

```js
  // G16: o gate de orçamento rodou no ENFILEIRAMENTO; num lote grande o teto
  // pode estourar entre a fila e a vez deste PR. Re-checa na boca da sessão:
  // estaciona (não descarta) e o relançamento manual continua valendo.
  if (engine.budgetBlockedFor(engine.accountForPr(pr))) {
    engine.autoReviewParked.add(pr.key);
    engine.saveAutoReviewParked();
    engine.emit('toast', { kind: 'info', text: `${pr.key}: o orçamento do perfil estourou antes desta revisão; ela aguarda você.` });
    engine.freeHeadlessSlot(acct);
    engine.writeInflight();
    engine.pushState();
    engine.processHeadless();
    return;
  }
```
(Depende da Task 3.2 pelo `saveAutoReviewParked`.)
- [ ] **Step 4: rodar e ver passar.** `node --test test/check-resilience.test.js`.
- [ ] **Step 5: gate e commit.**
```bash
git add lib/engine/review.js test/check-resilience.test.js
git commit -m "fix(orcamento): teto re-checado na boca da sessão, lote não estoura o limite (G16)"
```

---

### Task 3.4 [OPUS]: G17, capability vive enquanto a sessão de terminal viver

**Files:**
- Modify: `lib/engine/decision.js` (`reviewCaps` :431-438; conferir que `createReviewPostCapability` grava `ownerId`)
- Modify: `lib/engine/session.js` (o spawn do terminal precisa passar o id da sessão como `ownerId` da cap; localizar a chamada de `createReviewPostCapability` no arquivo)
- Test: `test/http.test.js` ou o arquivo onde as caps já são testadas (acrescentar caso)

- [ ] **Step 1: verificar o encanamento.** Ler em `session.js` a criação da cap do terminal: se `ownerId` já recebe o id registrado em `activeReviews`, siga; se não, passe-o (o id é o mesmo usado no `activeReviews.set(id, { mode: 'terminal', ... })`).
- [ ] **Step 2: teste que falha.**

```js
test('cap de terminal NÃO expira enquanto a sessão dona estiver viva', () => {
  // criar cap com ownerId 't9'; engine.activeReviews.set('t9', { mode: 'terminal' });
  // forçar cap.expiresAt = Date.now() - 1000; chamar reviewCaps(engine)
  assert.equal(engine.reviewPostCaps.has(token), true);
});

test('cap expirada de sessão morta é podada normalmente', () => {
  // mesmo setup sem a entrada em activeReviews: cap some
});
```

- [ ] **Step 3: fix.** Em `reviewCaps`:

```js
  for (const [token, cap] of engine.reviewPostCaps) {
    // G17: sessão de TERMINAL não tem prazo (o usuário pode voltar horas depois);
    // enquanto a sessão dona viver, a cap vive junto. O TTL segue valendo pra
    // cap órfã (sessão morta), que é o risco real que ele mitiga.
    const donaViva = cap && cap.ownerId && engine.activeReviews.has(cap.ownerId);
    if (!cap || (cap.expiresAt <= now && !donaViva)) engine.reviewPostCaps.delete(token);
  }
```
- [ ] **Step 4: rodar e ver passar.**
- [ ] **Step 5: gate e commit.**
```bash
git add lib/engine/decision.js lib/engine/session.js test/http.test.js
git commit -m "fix(capability): postagem do terminal vale enquanto a sessão viver (G17)"
```

---

### Task 3.5: G18, conta capaz vence o dedup do mineMap

**Files:**
- Modify: `server.js` (mineMap, hoje :590-596)
- Test: `test/check-resilience.test.js`

- [ ] **Step 1: teste que falha.** Duas contas acham o MESMO PR; a primeira está silenciada. Esperado: `accountForPr` resolve pra segunda (o PR não fica mudo).
- [ ] **Step 2: rodar e ver falhar.**
- [ ] **Step 3: fix.** Trocar o loop de inserção (hoje :595):

```js
        for (const pr of part) {
          const prev = mineMap.get(pr.key);
          if (!prev) { mineMap.set(pr.key, pr); continue; }
          // G18: o mesmo PR pode chegar por duas contas (time com as duas). A
          // conta CAPAZ de agir (não silenciada, com token) vence a incapaz;
          // empate mantém a primeira, o comportamento de sempre.
          const prevAcc = this.accountForPr(prev);
          const prevIncapaz = this.isMuted(prevAcc) || !this.tokenFor(prevAcc);
          const curCapaz = !this.isMuted(acc.user) && !!this.tokenFor(acc.user);
          if (prevIncapaz && curCapaz) mineMap.set(pr.key, pr);
        }
```
- [ ] **Step 4: rodar e ver passar.**
- [ ] **Step 5: gate e commit.**
```bash
git add server.js test/check-resilience.test.js
git commit -m "fix(multi-conta): conta capaz vence o dedup do review pedido em duas contas (G18)"
```

---

### Task 3.6: G19, guarda de merge em andamento

**Files:**
- Modify: `lib/engine/selfpr.js` (`mergeSelfPR`, hoje :374)
- Test: `test/merge-gates.test.js`

- [ ] **Step 1: teste que falha.** Duas chamadas concorrentes de `mergeSelfPR` pra mesma key (a primeira com `gh pr merge` stubado que demora via Promise pendente): a segunda devolve `{ ok: false, error: 'merge já em andamento' }` SEM chamar o gh de novo (contar chamadas no stub).
- [ ] **Step 2: rodar e ver falhar.**
- [ ] **Step 3: fix.** No topo de `mergeSelfPR`, após montar `key`:

```js
  // G19: double-click disparava dois merges; o segundo virava toast vermelho e
  // ERROR no log logo depois do sucesso do primeiro
  if (!engine.mergeInFlight) engine.mergeInFlight = new Set();
  if (engine.mergeInFlight.has(key)) return { ok: false, error: 'merge já em andamento' };
  engine.mergeInFlight.add(key);
  try {
```
e fechar TODO o corpo restante num `finally { engine.mergeInFlight.delete(key); }` (atenção aos returns existentes: o try/finally os cobre todos).
- [ ] **Step 4: rodar e ver passar.** `node --test test/merge-gates.test.js`.
- [ ] **Step 5: gate e commit.**
```bash
git add lib/engine/selfpr.js test/merge-gates.test.js
git commit -m "fix(meus-prs): segunda chamada de merge da mesma key é recusada sem tocar o gh (G19)"
```

---

### Task 3.7: G20, limpeza dos update-dl antigos

**Files:**
- Modify: `lib/engine/update.js` (início do fluxo de download, hoje ~:90)
- Test: `test/update.test.js`

- [ ] **Step 1: teste que falha.** Criar em dir temporário `sessions/update-dl-1` com mtime antigo (usar `fs.utimesSync` pra envelhecer) e `sessions/update-dl-2` recente; rodar o helper novo; esperado: o antigo some, o recente fica.
- [ ] **Step 2: rodar e ver falhar** (helper não existe).
- [ ] **Step 3: fix.** Helper no update.js, chamado no início de cada tentativa de download:

```js
// G20: cada tentativa criava sessions/update-dl-<ts> e nada apagava; meses de
// uso acumulavam dezenas de cópias do pacote. Poda best-effort na entrada.
function pruneOldDownloads(sessionsDir) {
  const DIA = 24 * 60 * 60 * 1000;
  let dirs = [];
  try { dirs = fs.readdirSync(sessionsDir).filter(d => d.startsWith('update-dl-')); } catch { return; }
  for (const d of dirs) {
    const full = path.join(sessionsDir, d);
    try {
      if (Date.now() - fs.statSync(full).mtimeMs > DIA) fs.rmSync(full, { recursive: true, force: true });
    } catch { /* best-effort: lixo que não saiu hoje sai amanhã */ }
  }
}
```
Exportar pra teste; chamar no ponto onde o `update-dl-<timestamp>` é criado (imediatamente antes).
- [ ] **Step 4: rodar e ver passar.** `node --test test/update.test.js`.
- [ ] **Step 5: gate e commit.**
```bash
git add lib/engine/update.js test/update.test.js
git commit -m "fix(update): downloads de update com mais de 24h são podados (G20)"
```

---

### Task 3.8: G21, env de auth no console de login e no login shell posix (VERIFICAR ANTES)

Este gap NÃO passou pela verificação adversarial da auditoria. A task começa
confirmando a mecânica; se qualquer metade não se confirmar, registrar o achado
no fechamento da onda e pular a metade refutada.

**Files:**
- Read primeiro: `lib/parse.js` (`applyClaudeAuthEnv` :208-219, `claudeAuthShellLines` :229-242), `lib/engine/session.js` (`spawnLoginConsole` ~:246, `buildLoginScript` ~:195, spawn posix headless ~:393)
- Modify (se confirmado): `lib/engine/session.js`
- Test: `test/claude-profiles.test.js`

- [ ] **Step 1: verificar metade Windows.** Ler `spawnLoginConsole`: o env passado ao console contém `ANTHROPIC_API_KEY` herdada do `process.env` sem passar por `applyClaudeAuthEnv`? Se sim, confirmado.
- [ ] **Step 2: verificar metade posix.** Ler o spawn headless posix: `/bin/sh -lc` com `-l` sourceia profile DEPOIS do env montado? Confirmar que `claudeAuthShellLines` não emite `unset`. Se ambos sim, confirmado.
- [ ] **Step 3 (Windows confirmado): teste + fix.** Teste no padrão do arquivo (contrato do env do console): env resultante NÃO contém `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` herdadas. Fix: passar o env do console por `applyClaudeAuthEnv` com o perfil resolvido do login (mesma chamada que o headless usa).
- [ ] **Step 4 (posix confirmado): teste + fix.** No script gerado pro posix (headless e terminal), emitir DEPOIS de qualquer sourcing e ANTES do exec do claude: `unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN` quando o perfil resolvido for de assinatura (perfil de chave seta a própria chave DEPOIS do unset). Travar em `session-posix.test.js` que o unset aparece no script e ANTES do exec.
- [ ] **Step 5: gate e commit.**
```bash
git add lib/engine/session.js lib/parse.js test/claude-profiles.test.js test/session-posix.test.js
git commit -m "fix(perfis): env de auth da máquina não vaza pro console de login nem pelo login shell posix (G21)"
```

---

### Fechamento da onda 3

- [ ] Gate completo `npm run check && npm test`.
- [ ] Revisão adversarial (agente OPUS) do diff da onda contra a spec.
- [ ] Release v2.41.4 pelo checklist do CLAUDE.md.
- [ ] Pós-campanha: atualizar a memória da auditoria (os 20 fechados), atualizar a seção "Números de hoje" do docs/QUALITY.md se os contadores mudaram, e rodar uma passada do Farol em PR real pra observar o round 2 completo em produção (pendência conhecida da v2.41.0).
