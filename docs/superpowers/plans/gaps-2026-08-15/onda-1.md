# Onda 1: integridade de postagem e custo (G1 a G6, release v2.41.2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** fechar os 6 gaps mais graves da auditoria (spec `../../specs/2026-08-15-gaps-v2411-auditoria.md`): review ancorado no head lido, decide() sem splice de índice velho, merge só de head analisado, scan de pushback sem loop pago, multi-conta sem apagar estado alheio, seen.txt atômico.

**Global Constraints:** ver "Regras globais" do `00-plano-mestre.md`. Leia-as antes de qualquer task.

---

### Task 1.1 [OPUS]: G1, review postado com `commit_id` do head lido

**Files:**
- Modify: `lib/engine/public-review.js` (função `normalizeReviewPayload`, hoje linhas 193-226)
- Modify: `lib/engine/decision.js` (`postReview` ~:351 e `decide` ~:583)
- Modify: `lib/engine/review.js` (chamadas de `postReview` em ~:446 e ~:479)
- Test: `test/review-commit-id.test.js` (novo)

**Interfaces:**
- Produces: `normalizeReviewPayload` passa a aceitar campo opcional `commit_id` (string sha, 7 a 40 hex); payload normalizado o carrega quando válido. Chamadores de `postReview` podem incluir `commit_id` no payload; a Task 2.6 (onda 2) depende disso.

- [ ] **Step 1: teste que falha.** Criar `test/review-commit-id.test.js`:

```js
'use strict';
// G1 da auditoria 15/08/2026: payload sem commit_id faz o GitHub ancorar o
// review no head do momento do POST, não no head que a sessão leu. Estes
// testes travam: normalize aceita/valida o campo, e os três pontos de
// postagem (canAuto, canReject, decide) o propagam.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeReviewPayload } = require('../lib/engine/public-review');

test('normalizeReviewPayload: commit_id sha válido é preservado', () => {
  const r = normalizeReviewPayload({ event: 'APPROVE', body: 'ok', comments: [], commit_id: 'a'.repeat(40) });
  assert.equal(r.ok, true);
  assert.equal(r.value.commit_id, 'a'.repeat(40));
});

test('normalizeReviewPayload: commit_id ausente ou vazio fica de fora do payload', () => {
  const r = normalizeReviewPayload({ event: 'APPROVE', body: 'ok', comments: [] });
  assert.equal(r.ok, true);
  assert.equal('commit_id' in r.value, false);
});

test('normalizeReviewPayload: commit_id que não é sha é DESCARTADO (nunca vira erro)', () => {
  // descarta em vez de recusar: um sha torto não pode impedir a postagem de um
  // review válido, apenas volta ao comportamento antigo (GitHub decide o head)
  const r = normalizeReviewPayload({ event: 'APPROVE', body: 'ok', comments: [], commit_id: 'não-é-sha' });
  assert.equal(r.ok, true);
  assert.equal('commit_id' in r.value, false);
});
```

- [ ] **Step 2: rodar e ver falhar.** `node --test test/review-commit-id.test.js`. Esperado: FAIL (commit_id não existe no value).

- [ ] **Step 3: implementar no `normalizeReviewPayload`.** Logo antes do `return { ok: true, value: ... }` final (hoje linha 225), acrescentar a validação e incluir o campo:

```js
  // G1: sha do head que a sessão LEU. Sem ele o GitHub ancora o review no head
  // do momento do POST, que pode ser um commit empurrado durante a sessão.
  // Sha torto é descartado (volta ao comportamento antigo), nunca bloqueia.
  const commitId = /^[0-9a-f]{7,40}$/i.test(String(payload.commit_id || '')) ? String(payload.commit_id) : '';
  const value = { event, body: payload.body.trim(), comments };
  if (commitId) value.commit_id = commitId;
  return { ok: true, value };
```

(Substituindo o `return { ok: true, value: { event, body: payload.body.trim(), comments } };` atual.)

- [ ] **Step 4: rodar e ver passar.** `node --test test/review-commit-id.test.js`. Esperado: PASS nos 3.

- [ ] **Step 5: propagar nos chamadores.** Três edições pontuais:

Em `lib/engine/review.js`, ramo canAuto (hoje `:446`), trocar:
```js
      const post = await engine.postReview(pr, result.payloads.approve);
```
por:
```js
      // G1: ancora o review no head que ESTA sessão leu (headShaAtual vem do
      // início da revisão); vazio = omite e o comportamento antigo vale
      const post = await engine.postReview(pr, { ...result.payloads.approve, commit_id: headShaAtual });
```

No ramo canReject (hoje `:478-479`), trocar:
```js
      const rc = { ...result.payloads.request_changes, body: engine.rejectBodyWithMark(result.payloads.request_changes.body) };
```
por:
```js
      const rc = { ...result.payloads.request_changes, body: engine.rejectBodyWithMark(result.payloads.request_changes.body), commit_id: headShaAtual };
```

Em `lib/engine/decision.js`, no `decide()` (hoje `:583`), trocar:
```js
  const post = await engine.postReview({ ...item.pr, key: item.key }, payload);
```
por:
```js
  // G1: `head` foi buscado agora mesmo pro dedup (linha acima); é o head que o
  // usuário está vendo na tela ao clicar
  const post = await engine.postReview({ ...item.pr, key: item.key }, { ...payload, commit_id: head || '' });
```

NÃO mexer em `postReviewFromSession` (terminal/chat): a sessão interativa lê o
head na hora e o comportamento atual permanece, documentado na spec.

- [ ] **Step 6: conferir que o `postReview` não perde o campo.** Ler `lib/engine/decision.js:351-390`: o payload que vai pro arquivo `--input` é o `normalized.value`. Como o Step 3 preserva `commit_id` no value, nada mais é preciso. Conferir também que `publicReviewLanguageIssues(payload)` (chamado em :363) não itera campo `commit_id` como texto público (ele varre body/comments; sha não passa por regra de linguagem). Se iterar, excluir o campo da varredura.

- [ ] **Step 7: teste de propagação.** Acrescentar ao `test/review-commit-id.test.js` (modelar os stubs em `test/dedup-round.test.js`, que já monta Engine com `myReviewStates`/`postReview` falsos):

```js
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = process.env.FAROL_HOME || path.join(os.tmpdir(), 'farol-test-commitid-' + process.pid);
const { Engine } = require('../server.js');

test('decide(): o commit_id enviado ao postReview é o head buscado no clique', async () => {
  const engine = new Engine();
  let payloadRecebido = null;
  engine.headSha = async () => 'f'.repeat(40);
  engine.myReviewStates = async () => [];
  engine.postReview = async (pr, payload) => { payloadRecebido = payload; return { ok: true }; };
  engine.saveDecisions = () => { };
  engine.writeMemory = () => { };
  engine.pushState = () => { };
  engine.decisions.pending.unshift({
    id: 'd1', key: 'acme/repo#1', pr: { repo: 'acme/repo', number: 1, url: 'https://github.com/acme/repo/pull/1' },
    createdAt: Date.now(),
    payloads: { approve: { event: 'APPROVE', body: 'ok', comments: [] } }
  });
  const r = await engine.decide('d1', 'approve');
  assert.equal(r.ok, true);
  assert.equal(payloadRecebido.commit_id, 'f'.repeat(40));
});
```

- [ ] **Step 8: gate e commit.**
```bash
npm run check && npm test
git add lib/engine/public-review.js lib/engine/decision.js lib/engine/review.js test/review-commit-id.test.js
git commit -m "fix(review): review postado carrega o commit_id do head que a sessão leu (G1)"
```

---

### Task 1.2 [OPUS]: G2, decide() re-acha o índice antes de cada splice

**Files:**
- Modify: `lib/engine/decision.js` (função `decide`, hoje linhas 550-594)
- Test: `test/decide-concurrency.test.js` (novo)

- [ ] **Step 1: teste que falha.** Criar `test/decide-concurrency.test.js`:

```js
'use strict';
// G2 da auditoria 15/08/2026: decide() capturava o índice antes de 3 awaits e
// fazia splice com o índice velho. Uma pendência nova criada durante o await
// (unshift do recordDecision) deslocava a lista e o splice removia a pendência
// ERRADA, que sumia das duas listas. reconcilePending já re-acha o índice
// depois do await (decision.js, comentário "a lista pode ter mudado"); este
// teste trava a mesma defesa no decide().
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-decide-conc-' + process.pid);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../server.js');

function pendencia(id, key) {
  return {
    id, key, pr: { repo: key.split('#')[0], number: parseInt(key.split('#')[1], 10), url: `https://github.com/${key.split('#')[0]}/pull/${key.split('#')[1]}` },
    createdAt: Date.now(),
    payloads: { approve: { event: 'APPROVE', body: 'ok', comments: [] } }
  };
}

test('decide(): pendência criada DURANTE o post não é engolida pelo splice', async () => {
  const engine = new Engine();
  engine.headSha = async () => '';
  engine.myReviewStates = async () => [];
  engine.saveDecisions = () => { };
  engine.writeMemory = () => { };
  engine.pushState = () => { };
  engine.decisions.pending = [pendencia('alvo', 'acme/repo#2')];
  engine.postReview = async () => {
    // simula: revisão headless de OUTRO PR termina no meio do await e cria
    // pendência nova no índice 0 (o unshift real do recordDecision)
    engine.decisions.pending.unshift(pendencia('nova', 'acme/outro#9'));
    return { ok: true };
  };
  const r = await engine.decide('alvo', 'approve');
  assert.equal(r.ok, true);
  const ids = engine.decisions.pending.map(d => d.id);
  assert.deepEqual(ids, ['nova'], 'a pendência nova sobrevive; a decidida sai');
  assert.equal(engine.decisions.resolved.some(d => d.id === 'alvo' && d.status === 'posted'), true);
  assert.equal(engine.decisions.resolved.some(d => d.id === 'nova'), false, 'a nova não foi resolvida por engano');
});
```

- [ ] **Step 2: rodar e ver falhar.** `node --test test/decide-concurrency.test.js`. Esperado: FAIL (ids fica `[]` porque o splice removeu 'nova' e 'alvo' ficou... conferir a falha real; o ponto é o deepEqual quebrar).

- [ ] **Step 3: fix no `decide()`.** Nos DOIS splices pós-await (dedup, hoje `:577`, e posted, hoje `:588`), re-achar o índice na hora. Trocar o bloco do dedup:

```js
  if (states && dupState && states.includes(dupState)) {
    engine.decisions.pending.splice(idx, 1);
```
por:
```js
  if (states && dupState && states.includes(dupState)) {
    // a lista pode ter mudado durante os awaits (unshift de pendência nova,
    // reconcilePending concorrente): re-acha o índice pela id, nunca usa o velho
    const cur = engine.decisions.pending.findIndex(d => d.id === item.id);
    if (cur >= 0) engine.decisions.pending.splice(cur, 1);
```
E o bloco do posted (após `post.ok`):
```js
  engine.decisions.pending.splice(idx, 1);
  engine.resolveIntoHistory({ ...item, status: 'posted', action });
```
por:
```js
  const cur = engine.decisions.pending.findIndex(d => d.id === item.id);
  if (cur >= 0) {
    engine.decisions.pending.splice(cur, 1);
    engine.resolveIntoHistory({ ...item, status: 'posted', action });
  } else {
    // já resolvida por outro caminho (reconcile) durante o post: não duplica
    // o histórico, só registra
    engine.log('WARN', `decide ${item.key}: pendência já resolvida durante o post, histórico preservado`);
  }
```

Obs.: no ramo `skip` (hoje `:557`) não há await antes do splice, o idx capturado é seguro; deixar como está.

- [ ] **Step 4: rodar e ver passar.** `node --test test/decide-concurrency.test.js` e depois `node --test test/dedup-round.test.js` (o dedup usa os mesmos caminhos; precisa continuar verde).

- [ ] **Step 5: gate e commit.**
```bash
npm run check && npm test
git add lib/engine/decision.js test/decide-concurrency.test.js
git commit -m "fix(decisao): decide() re-acha a pendência pelo id antes de cada splice (G2)"
```

---

### Task 1.3: G3, merge recusa autoanálise de head não lido

**Files:**
- Modify: `lib/engine/selfpr.js` (função `mergeSelfPR`, leitura fresca hoje em :407-408 e gates :416-423)
- Test: `test/merge-gates.test.js` (acrescentar casos)

- [ ] **Step 1: teste que falha.** Em `test/merge-gates.test.js`, seguir o padrão dos casos existentes (Engine com `run` stubado devolvendo o JSON do `gh pr view`) e acrescentar:

```js
test('mergeSelfPR: recusa quando o head atual difere do headSha da autoanálise', async () => {
  const engine = enginePronto(); // usar o helper do arquivo; se não existir, copiar o setup do caso "mergeia quando aprovável"
  engine.selfAnalyses['acme/repo#7'] = { approvable: true, headSha: 'a'.repeat(40) };
  stubGhView(engine, { state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', author: { login: 'eu' }, headRefOid: 'b'.repeat(40), headRefName: 'f', baseRefName: 'develop', title: 't' });
  const r = await engine.mergeSelfPR('https://github.com/acme/repo/pull/7');
  assert.equal(r.ok, false);
  assert.match(r.error, /commit depois da sua análise/);
});

test('mergeSelfPR: análise antiga SEM headSha não bloqueia (comportamento atual preservado)', async () => {
  const engine = enginePronto();
  engine.selfAnalyses['acme/repo#7'] = { approvable: true };
  // ...mesmo stub, headRefOid qualquer; o merge segue até o gh pr merge stubado
});
```

(Adaptar nomes de helpers ao que o arquivo já tem; a REGRA testada é o que importa: divergência recusa, ausência de sha na análise não recusa.)

- [ ] **Step 2: rodar e ver falhar.** `node --test test/merge-gates.test.js`.

- [ ] **Step 3: fix.** Em `mergeSelfPR`: (a) acrescentar `headRefOid` na lista do `--json` (hoje `'state,isDraft,mergeable,author,headRefName,baseRefName,title'`); (b) depois do gate 3 (estado/draft/conflito, hoje :421-423), acrescentar:

```js
  // G3: o selo "aprovável" fala de UM estado do PR. Se entrou commit depois da
  // análise, o selo não vale pro que vai ser mergeado (mesma doutrina do dedup
  // por round). Análise antiga sem sha registrado não bloqueia (sem base de
  // comparação), igual ao enrichMyPRBranches.
  if (analysis.headSha && pr.headRefOid && analysis.headSha !== pr.headRefOid) {
    return { ok: false, error: 'o PR recebeu commit depois da sua análise; re-analise antes de mergear.' };
  }
```

- [ ] **Step 4: rodar e ver passar.** `node --test test/merge-gates.test.js`.

- [ ] **Step 5: gate e commit.**
```bash
npm run check && npm test
git add lib/engine/selfpr.js test/merge-gates.test.js
git commit -m "fix(meus-prs): merge recusa autoanálise de head que ela não leu (G3)"
```

---

### Task 1.4: G4, scan de pushback só reclassifica com comentário NOVO do autor

**Files:**
- Modify: `lib/engine/pushback.js` (`detectAuthorPushback` :137-158 e `scanPushbacks` :101-107)
- Test: `test/pushback.test.js` (acrescentar casos)

**Interfaces:**
- Produces: `detectAuthorPushback(engine, pr, seen)` ganha o 3º parâmetro `seen` (marcador ISO gravado no ciclo anterior, string vazia na primeira vez). `hadActivity` passa a significar "comentário do autor DEPOIS de `seen` (ou depois do meu review, quando `seen` vazio)".

- [ ] **Step 1: teste que falha.** Em `test/pushback.test.js`, no padrão dos casos existentes (que stubam `run` do gh):

```js
test('scan não reclassifica quando a única novidade é de terceiro (updatedAt avançou, autor calado)', async () => {
  // marcador do ciclo anterior = último comentário do autor (10h)
  // updatedAt do PR = 11h (comentário de um colega)
  // comentários do autor devolvidos pelo gh: todos <= 10h
  // esperado: detectAuthorPushback(engine, pr, '2026-08-15T10:00:00Z').hadActivity === false
  //           e scanPushbacks NÃO chama classifyPushback (contar chamadas por stub)
});

test('comentário novo do autor depois do marcador reclassifica normalmente', async () => {
  // mesmo setup, mas o gh devolve um comentário do autor às 12h
  // esperado: hadActivity true, classifyPushback chamado 1 vez, marcador vira 12h
});
```

(Escrever os dois com os stubs concretos do arquivo; os casos existentes de
`detectAuthorPushback` mostram o formato do stdout stubado do `gh api`.)

- [ ] **Step 2: rodar e ver falhar.**

- [ ] **Step 3: fix.** Em `detectAuthorPushback`, assinatura vira `(engine, pr, seen)`. Depois de montar `times` (hoje :154-156), trocar:

```js
  const marker = times.sort().slice(-1)[0] || myAt;
  return { marker, hadActivity: times.length > 0 };
```
por:
```js
  const marker = times.sort().slice(-1)[0] || myAt;
  // G4: atividade que conta é comentário do autor DEPOIS do marcador anterior.
  // Sem isso, um comentário de terceiro avançava o updatedAt do PR pra sempre
  // e a MESMA thread era reclassificada (sessão Claude paga) a cada ciclo.
  const base = String(seen || '') || myAt;
  const hadActivity = times.some(t => t > base);
  return { marker, hadActivity };
```

Em `scanPushbacks` (hoje :101), passar o marcador: `const det = await engine.detectAuthorPushback(pr, engine.pushbackScanned[pr.key] || '');`.

ATENÇÃO fachada: `Engine.detectAuthorPushback` em server.js é fachada fina; ajustar a aridade dela junto (o `test/facades.test.js` deriva a aridade do fonte e acusa sozinho se esquecer).

- [ ] **Step 4: rodar e ver passar.** `node --test test/pushback.test.js test/facades.test.js`.

- [ ] **Step 5: gate e commit.**
```bash
npm run check && npm test
git add lib/engine/pushback.js server.js test/pushback.test.js
git commit -m "fix(pushback): scan só reclassifica com comentário novo do autor, mata o loop pago (G4)"
```

---

### Task 1.5 [OPUS]: G5, falha de busca de UMA conta não apaga estado das outras

**Files:**
- Modify: `server.js` (bloco "meus PRs abertos", hoje :613-638)
- Modify: `lib/engine/selfpr.js` (`reconcileHiddenPRs`, hoje :169-185)
- Test: `test/hidden-prs.test.js` e `test/check-resilience.test.js` (acrescentar casos)

**Interfaces:**
- Produces: `reconcileHiddenPRs(engine, okAccounts)` recebe `Set` de logins (minúsculos) cujas buscas funcionaram, ou `null` (nenhuma). A regra 2 (limpar chave sumida) só vale pra chave cuja conta dona está no Set.

- [ ] **Step 1: teste que falha.** Em `test/check-resilience.test.js`, montar Engine com DUAS contas e stubar `myAuthoredPRs` pra falhar (null) numa e responder na outra; afirmar que: (a) `this.myPRs` preserva os PRs da conta que falhou (vindos do ciclo anterior); (b) `selfAnalyses` de PR da conta que falhou NÃO é podada; (c) `hiddenPRs` de chave da conta que falhou NÃO é limpa. Em `test/hidden-prs.test.js`, caso novo: `reconcileHiddenPRs(engine, new Set(['contaA']))` com chave oculta de repo da contaB sumida da lista: a chave FICA.

- [ ] **Step 2: rodar e ver falhar.**

- [ ] **Step 3: fix no server.js.** Substituir o bloco :613-638 por:

```js
      // meus PRs abertos (autoanalise), POR CONTA: falha de uma conta preserva
      // o estado dela (G5: any-ok global apagava autoanálises e desocultava
      // hidden da conta que falhou no ciclo)
      let mineAuthored = null;
      const authOk = new Set();
      const authMap = new Map();
      for (const acc of accounts) {
        const part = await this.myAuthoredPRs(acc.user);
        if (part === null) continue;
        authOk.add(String(acc.user).toLowerCase());
        for (const pr of part) if (!authMap.has(pr.key)) authMap.set(pr.key, pr);
      }
      if (authOk.size) {
        // preserva do ciclo anterior os PRs das contas que falharam agora
        for (const pr of (this.myPRs || [])) {
          const dona = String(this.accountForPr(pr) || '').toLowerCase();
          if (!authOk.has(dona) && !authMap.has(pr.key)) authMap.set(pr.key, pr);
        }
        mineAuthored = [...authMap.values()];
        mineAuthored.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        this.myPRs = mineAuthored;
        // poda de autoanálise: só de chave cuja conta dona RESPONDEU neste ciclo
        const openKeys = new Set(mineAuthored.map(p => p.key));
        let pruned = false;
        for (const k of Object.keys(this.selfAnalyses)) {
          if (openKeys.has(k)) continue;
          const dona = String(this.accountForOwner(k.split('/')[0]) || '').toLowerCase();
          if (!authOk.has(dona)) continue; // conta falhou: "sumiu" não prova nada
          delete this.selfAnalyses[k]; pruned = true;
        }
        if (pruned) this.saveSelfAnalyses();
      }
      this.reconcileHiddenPRs(authOk.size ? authOk : null);
```

- [ ] **Step 4: fix no reconcileHiddenPRs.** Trocar o parâmetro `listaOk` por `okAccounts` e a regra 2 (hoje :181):

```js
    if (okAccounts && okAccounts.has(String(engine.accountForOwner(key.split('/')[0]) || '').toLowerCase())) {
      delete engine.hiddenPRs[key]; mudou = true;
    }
```
Atualizar o comentário da função (a explicação do "por conta" substitui a do booleano). Ajustar TODOS os chamadores e os casos existentes de `test/hidden-prs.test.js` pro parâmetro novo (os casos antigos com `true` viram `new Set([<conta do teste>])`, com `false` viram `null`).

- [ ] **Step 5: rodar e ver passar.** `node --test test/hidden-prs.test.js test/check-resilience.test.js test/facades.test.js`.

- [ ] **Step 6: gate e commit.**
```bash
npm run check && npm test
git add server.js lib/engine/selfpr.js test/hidden-prs.test.js test/check-resilience.test.js
git commit -m "fix(multi-conta): falha de busca de uma conta preserva autoanálises e ocultos dela (G5)"
```

---

### Task 1.6: G6, seen.txt gravado de forma atômica

**Files:**
- Modify: `lib/io.js` (novo helper ao lado de `writeJsonAtomic`, hoje :39-47)
- Modify: `server.js` (`saveSeen`, hoje :365-368)
- Test: `test/io-taxonomy.test.js` (acrescentar caso do helper)

- [ ] **Step 1: teste que falha.**

```js
test('writeTextAtomic: grava via tmp e rename, conteúdo íntegro', () => {
  const f = path.join(dirTemp, 'seen.txt'); // usar o helper de dir temp do arquivo
  writeTextAtomic(f, 'a#1\na#2\n');
  assert.equal(fs.readFileSync(f, 'utf8'), 'a#1\na#2\n');
  assert.equal(fs.existsSync(f + '.tmp'), false);
});
```

- [ ] **Step 2: rodar e ver falhar** (função não existe).

- [ ] **Step 3: implementar em lib/io.js** (mesmo contrato do writeJsonAtomic, texto plano):

```js
// Igual ao writeJsonAtomic, para texto plano (G6: seen.txt era o único estado
// gravado com writeFileSync direto; truncamento por queda de energia virava
// rajada de re-revisões pagas no boot seguinte).
function writeTextAtomic(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  try { fs.renameSync(tmp, file); }
  catch {
    fs.copyFileSync(tmp, file);
    try { fs.unlinkSync(tmp); } catch { /* sobrar .tmp é melhor que perder o estado */ }
  }
}
```
Exportar no module.exports do io.js. Em `server.js`, `saveSeen` passa a chamar `writeTextAtomic(SEEN_FILE, ...)` (import junto dos demais de `./lib/io`).

- [ ] **Step 4: rodar e ver passar.** `node --test test/io-taxonomy.test.js test/boot.test.js`.

- [ ] **Step 5: gate e commit.**
```bash
npm run check && npm test
git add lib/io.js server.js test/io-taxonomy.test.js
git commit -m "fix(estado): seen.txt gravado atomicamente via tmp+rename (G6)"
```

---

### Fechamento da onda 1

- [ ] Gate completo: `npm run check && npm test`.
- [ ] Revisão adversarial (agente OPUS): reler o diff da onda inteira contra a spec, mandato de refutar cada fix (o fix fecha o cenário? criou regressão? o teste prova?). Achado procedente volta pra task correspondente antes da release.
- [ ] Release v2.41.2 pelo checklist do CLAUDE.md (conferir última publicada, bump patch, CHANGELOG com os 6 fixes em linguagem de usuário, RELEASE_NOTES no ui/app.js, publish, conferir, restaurar conta gh).
