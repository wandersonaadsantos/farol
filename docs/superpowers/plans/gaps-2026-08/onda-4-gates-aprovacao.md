# Rascunho de plano, Farol v2.30.1

## Onda 4: Gates de aprovação e merge (segurança)

**Achados cobertos:** A4, A6, M6, B7, B8

**Contexto verificado no código real (linhas de hoje, main local):**
- A4: `lib/engine/decision.js:132`, a rede de segurança do `coverageGap` exige `revisados > 0`, então `coverage: {total: 30, reviewed: []}` devolve `[]` e o gate libera; `reviewed` que não é array vira `revisados = 0` e escapa igual.
- A6: `lib/engine/selfpr.js:438-439`, o SHA é capturado DEPOIS do `runClaudeStream` (TOCTOU) e o fallback `pr.headSha || null` grava `headSha: null`, o que desliga pra sempre a invalidação de `enrichMyPRBranches` (linha 145 exige `a.headSha` truthy).
- M6: `lib/engine/decision.js:15`, `recordDecision` prefere `result.pr` (saída do modelo, o prompt `pr-review-auto.md:16` pede o campo, nada valida) e `decide()` posta em `item.pr` (`decision.js:264` e `272`, chegando em `postReview:190-191`).
- B7: `lib/engine/selfpr.js:203`, `pr.base || ms.baseRefName` é código morto porque `fetchMergeState` (linhas 116-124) nunca devolve `baseRefName`.
- B8: `lib/engine/selfpr.js:208`, `engine.mergeStates = next` substitui o objeto por atacado; `runSelfAnalysis:463` escreve `engine.mergeStates[pr.key]` durante os awaits do loop e a escrita é engolida.

**Ordem de execução:** 4.1 (A4, pura) -> 4.2 (M6, decisão) -> 4.3 (A6, cria o arquivo de teste novo de selfpr) -> 4.4 (B7, anexa no mesmo arquivo) -> 4.5 (B8, anexa no mesmo arquivo). B7 vem antes de B8 porque o helper `msFresco` dos testes de B8 usa o campo `baseRefName` que B7 introduz no retorno de `fetchMergeState`.

**Dificuldades antecipadas da onda** (a parte MAIS importante do plano; o objetivo do usuário é ter a solução pronta antes do impedimento aparecer):

- **D1. O relatório dos 52 gaps não foi localizado (o orquestrador passou caminho "undefined")** → Solução preparada: cada achado foi verificado direto no código citado antes de planejar (linhas conferidas em `decision.js`, `selfpr.js`, `review.js`, `session.js` e nos prompts do workspace-template); o plano cita as linhas reais de hoje. Se o relatório aparecer, a única conferência pendente é se ele lista critério de aceite extra por achado; o desenho das correções não depende dele.
- **D2. O espião do `io.run` só funciona se for instalado ANTES do `require('../server.js')`** (a desestruturação `const { run } = require('../io')` no topo de `selfpr.js` e `decision.js` captura a referência no load do módulo; espião instalado depois nunca é chamado e os testes "passam" contra o gh real ou quebram por rede) → Solução preparada: copiar o harness EXATO de `test/merge-gates.test.js` linhas 26-36 nos dois arquivos novos, com o comentário explicando o porquê; o primeiro teste de cada arquivo já denuncia espião quebrado (o array `chamadas` fica vazio e a asserção de rota falha com mensagem clara).
- **D3. `node --test` roda os arquivos de teste em paralelo, cada um em processo próprio; FAROL_HOME compartilhado corromperia estado entre arquivos** → Solução preparada: prefixo único por arquivo (`farol-test-envelope-` e `farol-test-selfpr-` + `process.pid`), mesmo padrão dos vizinhos, com `after()` removendo o diretório.
- **D4. Estado persistido legado: `self-analyses.json` pode ter entradas com `headSha: null`** (gravadas por versões antigas ou pelo fallback atual); com o fix do A6 elas passam a ser descartadas no primeiro ciclo após o update e o card volta pra "não analisado" → Solução preparada: é a direção segura DE PROPÓSITO (análise incomprovável não pode alimentar o gate 1 do `mergeSelfPR`, que libera merge de commits que a análise nunca leu); o custo é um clique de re-análise. Registrar a frase no CHANGELOG da release: "autoanálises antigas sem SHA registrado são descartadas e pedem re-análise (segurança do botão Merge)".
- **D5. `writeMemory` no caminho automático (`review.js:333` e `360`) recebe `result` cru e ainda lê `result.pr` do modelo pro ref da memória local** (`decision.js:220` e `226`) → Solução preparada: fica FORA do escopo do M6 nesta onda, porque só afeta atribuição em arquivo local (`state/authors/*.md`), nunca escrita no GitHub; no caminho `decide()` o `writeMemory(item)` já sai corrigido de graça (item.pr passa a ser confiável). Registrar follow-up pra onda de robustez: "sanear result.pr também no writeMemory do caminho auto".
- **D6. Os prompts (`pr-review-auto.md:16`, `self-review.md:35`) continuam pedindo o campo `pr` no envelope; depois do fix o campo vira ignorado pra identidade e um revisor pode achar contraditório** → Solução preparada: NÃO mexer nos templates nesta onda (o `prepareHome` re-sincroniza o protocolo a cada boot e mudança de prompt arrastaria validação de comportamento de sessão, escopo de outra onda); deixar o motivo escrito no comentário novo do `recordDecision` ("o campo pr do envelope fica ignorado de propósito").
- **D7. O teste de `decide()` (M6) atravessa `postReview` e `writeMemory`, que escrevem `pr-review-payload.json` e `authors/*.md` em STATE_DIR; se o diretório não existir o `postReview` devolve `{ok:false}` e o teste falha com mensagem confusa** → Solução preparada: o construtor da `Engine` chama `prepareHome()` (server.js:198), que cria `workspace/state` sob o FAROL_HOME temporário; basta instanciar `new Engine()` real (como merge-gates faz) e NUNCA stubar `prepareHome`. O `after()` apaga tudo.
- **D8. Regressão em teste existente: o fix do A4 muda o predicado do `coverageGap`** → Solução preparada: varri os casos existentes; em `fanout.test.js` todos os envelopes com `coverage` têm `missing` não-vazio (retorno antecipado na linha 127, inalterado) ou `reviewed` preenchido com conta fechando; o caso da linha 166 (`reviewed: []`) tem `missing` com 6 itens e nem chega na rede de segurança. Nenhum teste atual muda de resultado; o passo 4 da tarefa roda o arquivo inteiro pra provar.
- **D9. Os dois SHAs do A6 divergindo (push no meio da análise): o que fazer com a sessão que custou tokens** → Solução preparada: descartar SEM re-enfileirar sozinho (re-análise automática em PR com push frequente viraria loop de sessões pagas); registro claro em WARN no farol.log + toast informativo, e o usuário relança pelo botão quando o PR assentar. Custo antecipado da correção: uma chamada `gh pr view --json headRefOid` a mais por autoanálise (antes + depois), irrisório perto da sessão Claude que ela embrulha.
- **D10. B8: o risco de "consertar demais" a substituição por atacado** (se o refresh passar a preservar tudo, entrada velha de PR que deixou de ser aprovável nunca sai e o botão Merge fica em pé com dado podre) → Solução preparada: reconciliar por carimbo de tempo, não por chave cega: só sobrevive à troca a entrada com `at >= iniciado` (gravada durante o ciclo, necessariamente por `runSelfAnalysis`, que só grava aprovável fora de repo bloqueado). As semânticas originais "não-alvo sai" e "fetch falhado derruba a entrada" ficam pinadas por dois testes dedicados na tarefa 4.5.
- **D11. Cross-platform (requisito firme)** → Solução preparada: nenhum trecho tocado tem branch de SO (é tudo lógica de estado e chamadas `gh` via `run`); os testes novos usam `os.tmpdir()` + `path.join` e zero shell direto, então rodam idênticos em Windows e macOS. O `test/session-posix.test.js` (que pula no Windows) não é tocado.
- **D12. As fachadas da Engine têm tabela de aridade travada em `test/review-prompt.test.js`** → Solução preparada: nenhuma assinatura de fachada muda nesta onda (só corpo de colaborador e um campo aditivo de retorno), então a tabela não precisa de entrada nova; conferir no passo 4 de cada tarefa que `review-prompt.test.js` segue verde dentro do `npm test`.
- **D13. Linhas deslocam entre tarefas no mesmo arquivo** (`selfpr.js` é editado por 4.3, 4.4 e 4.5) → Solução preparada: os números citados são os de HOJE; 4.4 edita `fetchMergeState` (linhas 116-124), que fica ACIMA das edições de 4.3 (144-150 e 428+), então não desloca; 4.5 edita `refreshMergeStates` (186-209), deslocada em ~3 linhas pela edição de 4.3 no `enrichMyPRBranches`. Em cada tarefa, localizar pelo NOME da função e pela âncora de código, não pelo número cru.

---

### Tarefa 4.1: coverage vazio ou malformado é lacuna, não passe livre (achados: A4)

**Arquivos:** Modify: `lib/engine/decision.js:128-135` (rede de segurança do `coverageGap`) | Test: `test/fanout.test.js` (seção "gate de cobertura", após o teste da linha 135)

**Interfaces:** Consome/Produz: `coverageGap(result) -> string[]` mantém a assinatura; muda só o predicado da rede de segurança (remove a exigência `revisados > 0` e o caminho de escape do `reviewed` não-array).

**Dificuldades antecipadas:**
- Risco: mudar o texto da mensagem quebraria o teste existente da linha 133 (`/8 arquivo\(s\)/`) → Solução preparada: manter o template da mensagem EXATAMENTE como está (`X arquivo(s) do diff sem revisão declarada (revisou Y de Z)`), só o `if` muda.
- Risco: envelope legítimo de PR pequeno com `coverage: {}` (objeto vazio) passar a bloquear → Solução preparada: não bloqueia; `Number(undefined) || 0` dá `total = 0` e o `if` exige `total > 0`. O teste existente "envelope sem coverage não muda nada" (linha 137) segue pinando o regime.

- [ ] **Passo 1: escrever o teste que falha** (anexar em `test/fanout.test.js`, dentro da seção `/* ---------- gate de cobertura ---------- */`, depois do teste "lacuna de cobertura também segura o reprovar sozinho"):

```js
test('coverage adversarial: total declarado sem nenhum arquivo revisado é lacuna, não passe livre', () => {
  const e = engineLiberado();
  const vazio = aprovavel({ coverage: { total: 30, reviewed: [], missing: [] } });
  assert.equal(e.coverageGap(vazio).length, 1, 'total 30 com leitura zero declarada é lacuna');
  assert.match(e.coverageGap(vazio)[0], /30 arquivo\(s\)/, 'diz quantos ficaram sem revisão');
  assert.equal(e.shouldAutoApprove(PR, vazio), false, 'reabre o caso do PR gigante: sem leitura, sem auto-approve');
});

test('coverage adversarial: reviewed que não é lista não prova leitura nenhuma', () => {
  const e = engineLiberado();
  const malformado = aprovavel({ coverage: { total: 12, reviewed: 'todos', missing: [] } });
  assert.equal(e.coverageGap(malformado).length, 1, 'reviewed fora do contrato conta como zero lido');
  assert.equal(e.shouldAutoApprove(PR, malformado), false);
  const rej = {
    verdict: 'request_changes', decision: 'needs_decision', reasons: ['blocker'],
    payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'x' } },
    coverage: { total: 12, reviewed: null, missing: [] }
  };
  assert.equal(e.shouldAutoReject(PR, rej), false, 'reprovar sem leitura declarada também não');
});
```

- [ ] **Passo 2: rodar e ver falhar**: `node --test test/fanout.test.js`. Esperar os 2 testes novos vermelhos: `coverageGap(vazio)` devolve `[]` (length 0, não 1) e `shouldAutoApprove` devolve `true`; os demais testes do arquivo seguem verdes.

- [ ] **Passo 3: implementação mínima** (`lib/engine/decision.js`, o bloco da rede de segurança do `coverageGap`; ANTES nas linhas 128-135, DEPOIS assim):

```js
  const missing = Array.isArray(c.missing) ? c.missing.map(p => String(p || '').trim()).filter(Boolean) : [];
  if (missing.length) return missing;
  // rede de segurança: revisados a menos que o total também é lacuna, mesmo com
  // missing vazio (a sessão pode ter contado errado ou esquecido de listar).
  // Zero revisado NÃO é passe livre: total declarado sem nenhum arquivo lido é
  // o pior caso (nada foi lido), e reviewed fora do contrato conta como zero.
  const total = Number(c.total) || 0;
  const revisados = Array.isArray(c.reviewed) ? c.reviewed.length : 0;
  if (total > 0 && revisados < total) {
    return [`${total - revisados} arquivo(s) do diff sem revisão declarada (revisou ${revisados} de ${total})`];
  }
  return [];
```

(A mudança concreta: o `if` deixa de exigir `revisados > 0`; o resto do bloco fica idêntico.)

- [ ] **Passo 4: rodar a suite inteira**: `npm run check && npm test`. Verde nos dois; atenção especial a `test/fanout.test.js` completo e `test/contested.test.js` (também exercitam `shouldAutoApprove`).

- [ ] **Passo 5: commit**: `fix: coverage com zero arquivos revisados conta como lacuna no gate de postagem`

---

### Tarefa 4.2: identidade do PR na decisão vem da fila, nunca do envelope (achados: M6)

**Arquivos:** Modify: `lib/engine/decision.js:15` (`recordDecision`) | Test: `test/decision-envelope.test.js` (arquivo NOVO)

**Interfaces:** Consome/Produz: `recordDecision(engine, pr, result, extra) -> item` mantém a assinatura; o contrato que muda é interno: `item.pr` passa a ser SEMPRE `{repo, number, url, title, author}` derivado do `pr` da fila, e `result.pr` (saída de modelo) é ignorado. Consumidores de `item.pr` (`decide()` em `decision.js:264/272`, `postReview:190-191`, `writeMemory` via `decide()`, e a UI via snapshot) recebem só dado confiável.

**Dificuldades antecipadas:**
- Risco: o espião do `io.run` instalado depois do require não intercepta nada (D2) → Solução preparada: harness copiado de `merge-gates.test.js:26-36`, espião antes do `require('../server.js')`.
- Risco: `decide()` chama `myReviewStates` que, com repo mentiroso, pode resolver conta vazia e devolver `null`; o fluxo segue pro `postReview` mesmo assim → Solução preparada: o teste não depende do dedup; a asserção varre TODAS as chamadas `gh api` e exige que toda rota comece com `repos/acme/app/pulls/42/`, então qualquer vazamento pro repo mentiroso falha, no dedup ou no post.
- Risco: `postReview`/`writeMemory` escrevem arquivo em STATE_DIR (D7) → Solução preparada: `new Engine()` real cria os diretórios via `prepareHome()`; `after()` limpa o FAROL_HOME temporário.

- [ ] **Passo 1: escrever o teste que falha** (arquivo novo `test/decision-envelope.test.js`, completo):

```js
'use strict';
// M6: o envelope da sessão é saída de modelo, não fonte de identidade. recordDecision
// preferia result.pr (repo/number ditados pela sessão) e decide()/postReview postavam
// NESSE repo: um envelope mentiroso redirecionaria um APPROVE pra outro repositório.
// Estes testes travam: a identidade do PR vem SEMPRE da fila (pr), nunca do envelope.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-envelope-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// espião no lugar do run, instalado antes do primeiro require de decision
// (mesma técnica do merge-gates.test.js: a desestruturação captura a referência no load)
const io = require('../lib/io');
const runReal = io.run;
let runImpl = null;
const chamadas = [];
io.run = function runEspiao(cmd, args, opts) {
  chamadas.push({ cmd, args: args || [] });
  if (runImpl) return runImpl(cmd, args || [], opts);
  return runReal(cmd, args, opts);
};

const { Engine } = require('../server.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(() => { chamadas.length = 0; runImpl = null; });

const PR = { key: 'acme/app#42', repo: 'acme/app', number: 42, url: 'https://github.com/acme/app/pull/42', title: 'PR real', author: 'dev' };

function novoEngine() {
  const engine = new Engine();
  engine.token = 'token-falso';
  engine.tokens = { eu: 'token-falso' };
  engine.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  engine.saveDecisions = () => { };
  engine.pushState = () => { };
  engine.refreshTokens = async () => { };
  engine.log = () => { };
  engine.on('toast', () => { });
  return engine;
}

function resultado(extra) {
  return {
    verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
    payloads: { approve: { event: 'APPROVE', body: 'ok' } },
    reportMarkdown: '# ok', ...extra
  };
}

test('recordDecision ignora o pr do envelope: a identidade vem da fila', () => {
  const engine = novoEngine();
  const mentiroso = resultado({ pr: { repo: 'evil/repo', number: 1, url: 'https://github.com/evil/repo/pull/1', title: 'isca', author: 'mallory' } });
  const item = engine.recordDecision(PR, mentiroso, { status: 'pending' });
  assert.equal(item.pr.repo, 'acme/app', 'repo vem do PR da fila, não do envelope');
  assert.equal(item.pr.number, 42);
  assert.equal(item.pr.author, 'dev');
});

test('decide() posta no repo verdadeiro mesmo com envelope apontando outro repo', async () => {
  runImpl = (cmd, args) => {
    const sub = args.join(' ');
    if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('--jq')) return Promise.resolve({ ok: true, stdout: '[]', stderr: '' });
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
  const engine = novoEngine();
  const mentiroso = resultado({ pr: { repo: 'evil/repo', number: 1 } });
  const item = engine.recordDecision(PR, mentiroso, { status: 'pending' });
  const r = await engine.decide(item.id, 'approve');
  assert.equal(r.ok, true);
  const rotas = chamadas.filter(c => c.args[0] === 'api').map(c => c.args[1]);
  assert.ok(rotas.length >= 1, 'houve chamada de API do gh');
  for (const rota of rotas) {
    assert.match(rota, /^repos\/acme\/app\/pulls\/42\//, `toda chamada vai pro PR real, veio: ${rota}`);
  }
});
```

- [ ] **Passo 2: rodar e ver falhar**: `node --test test/decision-envelope.test.js`. Esperar os 2 testes vermelhos: o primeiro com `item.pr.repo === 'evil/repo'`, o segundo com rota `repos/evil/repo/pulls/1/reviews` na lista.

- [ ] **Passo 3: implementação mínima** (`lib/engine/decision.js`, início do `recordDecision`; a linha 15 ANTES é `pr: result.pr && result.pr.repo ? result.pr : {...}`, DEPOIS o bloco fica):

```js
function recordDecision(engine, pr, result, extra) {
  const item = {
    id: `d${Date.now()}${Math.floor(Math.random() * 1000)}`,
    createdAt: Date.now(),
    // identidade SEMPRE do PR da fila (confiável), nunca do envelope: result.pr é
    // saída de modelo e um repo/number mentiroso redirecionaria a postagem
    // (decide() -> myReviewStates/postReview usam item.pr). O campo pr que o
    // prompt pede no envelope fica ignorado de propósito.
    pr: { repo: pr.repo, number: pr.number, url: pr.url, title: pr.title, author: pr.author },
    key: pr.key,
```

- [ ] **Passo 4: rodar a suite inteira**: `npm run check && npm test`. Atenção a `test/rerequest.test.js` e `test/pushback.test.js` (mexem com decisões/reviewActions); nenhum deles depende de `result.pr`, mas é onde regressão apareceria.

- [ ] **Passo 5: commit**: `fix: identidade do PR na decisão vem da fila, nunca do envelope da sessão`

---

### Tarefa 4.3: SHA da autoanálise capturado antes da sessão, com re-checagem e descarte (achados: A6)

**Arquivos:** Modify: `lib/engine/selfpr.js:428-444` (`runSelfAnalysis`: captura antes + re-checagem depois) e `lib/engine/selfpr.js:144-150` (`enrichMyPRBranches`: análise sem SHA descarta) | Test: `test/selfpr-consistency.test.js` (arquivo NOVO; 4.4 e 4.5 anexam nele)

**Interfaces:** Consome/Produz: `runSelfAnalysis(engine, pr)` inalterada por fora; o contrato que muda: `selfAnalyses[key].headSha` passa a ser o SHA lido ANTES da sessão (o commit que a análise de fato leu), e análise cujo head mudou durante a sessão NÃO é gravada. `enrichMyPRBranches` passa a descartar também análise com `headSha` ausente quando o head atual é conhecido.

**Dificuldades antecipadas:**
- Risco: legado com `headSha: null` em `self-analyses.json` sendo descartado em massa no primeiro ciclo (D4) → Solução preparada: aceito de propósito (direção segura, protege o gate 1 do merge); frase pronta pro CHANGELOG na D4.
- Risco: as duas chamadas de SHA falharem (rede) e a análise ficar sem carimbo de novo → Solução preparada: fallback em cadeia `gh -> pr.headSha -> null`; se ainda assim ficar null, a nova regra do `enrichMyPRBranches` descarta no ciclo seguinte (a análise não fica imortal como hoje). Comportamento documentado no comentário.
- Risco: re-enfileirar sozinho após descarte viraria loop de sessões pagas em PR com push frequente (D9) → Solução preparada: nunca re-enfileira; WARN + toast e o usuário relança.
- Risco: o stub de `runClaudeStream` precisa devolver envelope que `parseSelfResult` aceite (exige `approvable` boolean, `verdict`, `reportMarkdown`) → Solução preparada: helper `envelope()` no teste já traz os 3 campos obrigatórios + `tips`/`blockers`.
- Risco: `selfPromptFor` lê o template de `workspace-template/prompts/self-review.md` → Solução preparada: o fallback pro TEMPLATE_DIR do repo (selfpr.js:374-383) cobre o FAROL_HOME temporário sem seed; nada a stubar.
- Risco: com `approvable: true` o fluxo segue pro `fetchMergeState` real (gh de verdade) no fim do `runSelfAnalysis` → Solução preparada: stubar `engine.fetchMergeState = async () => null` no teste do caminho feliz (o descarte por TOCTOU retorna antes e nem chega lá).

- [ ] **Passo 1: escrever o teste que falha** (arquivo novo `test/selfpr-consistency.test.js`, completo):

```js
'use strict';
// Consistência da autoanálise e do estado de merge (selfpr.js), que alimentam os gates
// do botão Merge: o SHA que carimba a autoanálise (gate 1 do mergeSelfPR), a base que
// alimenta o gate de ruleset (tarefa B7) e a reconciliação do mergeStates (B8).
// Cenários adversariais: push no meio da análise, análise sem SHA, escrita concorrente.
// Mesma técnica de espião do merge-gates.test.js (instalado ANTES do require do server).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-selfpr-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const io = require('../lib/io');
const runReal = io.run;
let runImpl = null;
const chamadas = [];
io.run = function runEspiao(cmd, args, opts) {
  chamadas.push({ cmd, args: args || [] });
  if (runImpl) return runImpl(cmd, args || [], opts);
  return runReal(cmd, args, opts);
};

const { Engine } = require('../server.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(() => { chamadas.length = 0; runImpl = null; });

const URL_PR = 'https://github.com/acme/app/pull/42';
const CHAVE = 'acme/app#42';
const MEU_PR = { key: CHAVE, repo: 'acme/app', number: 42, url: URL_PR, title: 'PR meu' };

function novoEngine() {
  const engine = new Engine();
  engine.token = 'token-falso';
  engine.tokens = { eu: 'token-falso' };
  engine.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  engine.saveSelfAnalyses = () => { };
  engine.pushState = () => { };
  engine.refreshTokens = async () => { };
  engine.log = () => { };
  engine.on('toast', () => { });
  return engine;
}

function envelope(extra) {
  return JSON.stringify({
    approvable: true, verdict: 'aprovável', confidence: 'alta', summary: 'ok',
    blockers: [], tips: [], reportMarkdown: '# ok', ...extra
  });
}

// roteia o gh: headRefOid devolve o SHA "atual" (mutável pelo teste, simula push)
function roteadorSha(sha) {
  return (cmd, args) => {
    const sub = args.join(' ');
    if (sub.includes('headRefOid')) return Promise.resolve({ ok: true, stdout: sha.valor, stderr: '' });
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
}

/* ---------- A6: o SHA que carimba a autoanálise ---------- */

test('o SHA é capturado ANTES da sessão e carimba a análise', async () => {
  const sha = { valor: 'aaa111' };
  runImpl = roteadorSha(sha);
  const engine = novoEngine();
  let lidosAntesDaSessao = 0;
  engine.runClaudeStream = async () => {
    lidosAntesDaSessao = chamadas.filter(c => c.args.join(' ').includes('headRefOid')).length;
    return { text: envelope(), sessionId: 'sess1' };
  };
  engine.fetchMergeState = async () => null;
  await engine.runSelfAnalysis(MEU_PR);
  assert.equal(lidosAntesDaSessao, 1, 'uma leitura de SHA antes da sessão começar');
  assert.equal(engine.selfAnalyses[CHAVE].headSha, 'aaa111', 'a análise vale pro commit que ela leu');
});

test('push DURANTE a análise descarta o resultado com registro claro (TOCTOU)', async () => {
  const sha = { valor: 'aaa111' };
  runImpl = roteadorSha(sha);
  const engine = novoEngine();
  const avisos = [];
  engine.log = (lvl, msg) => avisos.push(`${lvl}: ${msg}`);
  engine.runClaudeStream = async () => {
    sha.valor = 'bbb222';               // alguém deu push no meio da análise
    return { text: envelope(), sessionId: 'sess1' };
  };
  await engine.runSelfAnalysis(MEU_PR);
  assert.equal(engine.selfAnalyses[CHAVE], undefined, 'análise de commit velho não pode alimentar o gate de merge');
  assert.ok(avisos.some(m => /commit novo durante a análise/.test(m)), 'o descarte fica registrado no log');
});

test('análise sem SHA registrado é descartada quando o head atual é conhecido', async () => {
  const engine = novoEngine();
  engine.myPRs = [{ ...MEU_PR }];
  engine.selfAnalyses = { [CHAVE]: { approvable: true, headSha: null } };
  engine.mergeStates = { [CHAVE]: { status: 'CLEAN', at: Date.now() } };
  runImpl = (cmd, args) => {
    const sub = args.join(' ');
    if (sub.includes('headRefName')) {
      return Promise.resolve({ ok: true, stdout: JSON.stringify({ headRefName: 'f', baseRefName: 'develop', headRefOid: 'ccc333' }), stderr: '' });
    }
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
  await engine.enrichMyPRBranches();
  assert.equal(engine.selfAnalyses[CHAVE], undefined, 'sem SHA não dá pra provar que a análise vale pro commit atual');
  assert.equal(engine.mergeStates[CHAVE], undefined, 'o botão Merge não pode viver de análise incomprovável');
});
```

- [ ] **Passo 2: rodar e ver falhar**: `node --test test/selfpr-consistency.test.js`. Esperar 3 vermelhos: teste 1 com `lidosAntesDaSessao === 0` (hoje o SHA é lido depois); teste 2 com `selfAnalyses[CHAVE]` definido e `headSha: 'bbb222'` (o TOCTOU em ação); teste 3 com a análise sobrevivendo (a linha 145 exige `a.headSha` truthy).

- [ ] **Passo 3: implementação mínima**, duas edições em `lib/engine/selfpr.js`.

Edição 1, `runSelfAnalysis` (o miolo do `try` ANTES começa direto no `const res = await engine.runClaudeStream(...)` e captura o SHA depois do parse, nas linhas 429-439; DEPOIS fica):

```js
  try {
    // SHA ANTES da sessão: a análise vale pro commit que ela vai ler. Capturado
    // depois, um push no meio da análise carimbava SHA novo em análise velha
    // (TOCTOU) e a invalidação do enrichMyPRBranches nunca disparava.
    const antesR = await run('gh', ['pr', 'view', pr.url, '--json', 'headRefOid', '--jq', '.headRefOid'], { env: engine.ghEnv(engine.accountForPr(pr)) });
    const shaAntes = ((antesR.ok ? antesR.stdout : '') || '').trim() || pr.headSha || '';
    const res = await engine.runClaudeStream(engine.selfPromptFor(pr.url), {
      id,
      account: engine.accountForPr(pr),
      onModel: (m) => engine.setSessionModel(id, m),
      onEvent: (e) => engine.pushActivity(id, e.kind, e.text)
    });
    const result = engine.parseSelfResult(res.text);
    // re-checagem DEPOIS: se o head mudou durante a análise, o resultado descreve
    // um código que já não é a ponta da branch. Descarta com registro claro e sem
    // re-enfileirar (relançar é decisão do usuário). Custo: uma chamada gh a mais.
    const depoisR = await run('gh', ['pr', 'view', pr.url, '--json', 'headRefOid', '--jq', '.headRefOid'], { env: engine.ghEnv(engine.accountForPr(pr)) });
    const shaDepois = ((depoisR.ok ? depoisR.stdout : '') || '').trim();
    if (shaAntes && shaDepois && shaAntes !== shaDepois) {
      engine.log('WARN', `autoanálise de ${pr.key} descartada: commit novo durante a análise (${shaAntes.slice(0, 7)} -> ${shaDepois.slice(0, 7)})`);
      engine.emit('toast', { kind: 'info', text: `${pr.key}: entrou commit novo durante a autoanálise; rode de novo pra valer pro código atual.` });
      return;
    }
    engine.selfAnalyses[pr.key] = {
      key: pr.key,
      pr: { repo: pr.repo, number: pr.number, url: pr.url, title: pr.title },
      at: Date.now(),
      headSha: shaAntes || null,
```

(o restante do objeto e da função segue igual; a antiga leitura `const shaR = ...` das linhas 438-439 SAI)

Edição 2, `enrichMyPRBranches` (linhas 144-150 ANTES exigem `a.headSha` truthy; DEPOIS):

```js
    const a = engine.selfAnalyses[pr.key];
    if (a && pr.headSha && (!a.headSha || a.headSha !== pr.headSha)) {
      delete engine.selfAnalyses[pr.key];
      delete engine.mergeStates[pr.key];
      engine.log('WARN', a.headSha
        ? `autoanálise de ${pr.key} descartada: PR mudou (commit novo)`
        : `autoanálise de ${pr.key} descartada: análise sem SHA registrado (não dá pra provar que vale pro commit atual)`);
      pruned = true;
    }
```

- [ ] **Passo 4: rodar a suite inteira**: `npm run check && npm test`. Atenção a `test/merge-gates.test.js` (mesmo módulo, gates do merge não podem mudar) e `test/boot.test.js` (smoke com FAROL_HOME).

- [ ] **Passo 5: commit**: `fix: SHA da autoanálise capturado antes da sessão com re-checagem no fim`

---

### Tarefa 4.4: fetchMergeState devolve baseRefName e o gate de ruleset checa a base real (achados: B7)

**Arquivos:** Modify: `lib/engine/selfpr.js:118` (campo a mais no `--json`) e `lib/engine/selfpr.js:122` (campo a mais no retorno) | Test: `test/selfpr-consistency.test.js` (anexar seção B7)

**Interfaces:** Consome/Produz: `fetchMergeState(engine, url) -> { mergeable, status, isDraft, state, baseRefName, at } | null` (campo `baseRefName` é ADITIVO). Consumidores: `refreshMergeStates` linha 203 (`pr.base || ms.baseRefName`, o fallback morto que passa a funcionar), `runSelfAnalysis:462` (ignora o campo, sem impacto) e a UI via snapshot (campo extra inofensivo).

**Dificuldades antecipadas:**
- Risco: escolher o outro lado da correção (apagar o fallback morto em vez de alimentá-lo) deixaria o gate de ruleset cego quando `pr.base` ainda não foi enriquecido (o `check()` chama `refreshMergeStates` logo após `enrichMyPRBranches`, mas `runSelfAnalysis:462` chama `fetchMergeState` FORA do ciclo, antes de qualquer enriquecimento do PR recém-analisado) → Solução preparada: alimentar o fallback é a correção que honra a intenção original da linha 203, custa zero chamada extra (mesmo `gh pr view`, um campo a mais no `--json`) e destrava o caso real.
- Risco: teste do `refreshMergeStates` disparar `gh` de verdade → Solução preparada: stubar as fachadas `engine.fetchMergeState`/`engine.fetchAutoMergeAllowed`/`engine.fetchRuleBlocked` direto no engine (o colaborador chama via `engine.`, então o stub pega); só o teste unitário do `fetchMergeState` usa o espião do `io.run`.

- [ ] **Passo 1: escrever o teste que falha** (anexar em `test/selfpr-consistency.test.js`):

```js
/* ---------- B7: a base que alimenta o gate de ruleset ---------- */

test('fetchMergeState devolve baseRefName (o fallback do ruleset deixa de ser código morto)', async () => {
  runImpl = (cmd, args) => {
    const sub = args.join(' ');
    if (sub.startsWith('pr view')) {
      return Promise.resolve({ ok: true, stdout: JSON.stringify({ mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', isDraft: false, state: 'OPEN', baseRefName: 'develop' }), stderr: '' });
    }
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
  const ms = await novoEngine().fetchMergeState(URL_PR);
  assert.equal(ms.status, 'BLOCKED');
  assert.equal(ms.baseRefName, 'develop', 'a base vem junto, pro ruleset ser checável sem depender de pr.base');
});

test('refreshMergeStates em BLOCKED sem pr.base checa o ruleset com a base do fetchMergeState', async () => {
  const engine = novoEngine();
  engine.myPRs = [{ ...MEU_PR, base: '' }];      // ainda não passou pelo enrichMyPRBranches
  engine.selfAnalyses = { [CHAVE]: { approvable: true } };
  engine.fetchMergeState = async () => ({ mergeable: 'MERGEABLE', status: 'BLOCKED', isDraft: false, state: 'OPEN', baseRefName: 'develop', at: Date.now() });
  engine.fetchAutoMergeAllowed = async () => true;
  const consultas = [];
  engine.fetchRuleBlocked = async (repo, base) => { consultas.push({ repo, base }); return true; };
  await engine.refreshMergeStates();
  assert.deepEqual(consultas, [{ repo: 'acme/app', base: 'develop' }], 'o gate de ruleset recebe a base real');
  assert.equal(engine.mergeStates[CHAVE].adminBlocked, true, 'admin não é oferecido quando o ruleset bloqueia');
});
```

- [ ] **Passo 2: rodar e ver falhar**: `node --test test/selfpr-consistency.test.js`. Esperar os 2 novos vermelhos: teste 1 com `ms.baseRefName === undefined`; teste 2 com `consultas[0].base === undefined` (a prova viva de que a linha 203 era código morto).

- [ ] **Passo 3: implementação mínima** (`lib/engine/selfpr.js`, `fetchMergeState`; DEPOIS fica):

```js
async function fetchMergeState(engine, url) {
  const m = String(url).match(/github\.com\/([^/]+)\//i);
  const r = await run('gh', ['pr', 'view', url, '--json', 'mergeable,mergeStateStatus,isDraft,state,baseRefName'], { env: engine.ghEnv(engine.accountForOwner(m && m[1])) });
  if (!r.ok) return null;
  try {
    const j = JSON.parse(r.stdout || '{}');
    // baseRefName alimenta o fallback do gate de ruleset em refreshMergeStates
    // (pr.base pode ainda não ter sido enriquecido quando o PR acabou de ser analisado)
    return { mergeable: j.mergeable || 'UNKNOWN', status: j.mergeStateStatus || 'UNKNOWN', isDraft: !!j.isDraft, state: j.state || '', baseRefName: j.baseRefName || '', at: Date.now() };
  } catch { return null; }
}
```

(a linha 203 `pr.base || ms.baseRefName` fica como está: era ela a intenção certa o tempo todo)

- [ ] **Passo 4: rodar a suite inteira**: `npm run check && npm test`. Atenção a `test/merge-gates.test.js` (o roteador de lá responde `pr view` com outro shape; `fetchMergeState` não é exercitado por ele, mas conferir que segue verde).

- [ ] **Passo 5: commit**: `fix: fetchMergeState devolve baseRefName e o gate de ruleset checa a base real`

---

### Tarefa 4.5: refreshMergeStates reconcilia por chave, sem engolir escrita concorrente (achados: B8)

**Arquivos:** Modify: `lib/engine/selfpr.js:186-209` (`refreshMergeStates`: carimbo `iniciado` + reconciliação antes da troca) | Test: `test/selfpr-consistency.test.js` (anexar seção B8)

**Interfaces:** Consome/Produz: `refreshMergeStates(engine)` inalterada por fora. Contrato interno preservado: `mergeStates` continua contendo só aprováveis; a diferença é que entrada gravada DURANTE o ciclo (por `runSelfAnalysis:462-464`, que só grava aprovável fora de repo bloqueado) sobrevive à troca.

**Dificuldades antecipadas:**
- Risco: "consertar demais" e nunca mais limpar entrada velha (D10) → Solução preparada: reconciliar por carimbo de tempo `at >= iniciado` (o campo `at` já existe em todo retorno de `fetchMergeState`, linha 122); dois testes pinam de propósito as semânticas originais (não-alvo sai, fetch falhado derruba).
- Risco: empate de milissegundo entre `iniciado` e a escrita concorrente → Solução preparada: comparação com `>=` (o teste roda no mesmo ms; `< iniciado` descarta, o resto fica).
- Risco: a reconciliação em si sofrer interleaving → Solução preparada: o laço de reconciliação + a atribuição final são 100% síncronos (nenhum await entre eles), e em Node código síncrono não é interrompido; só os awaits do loop de fetch abrem janela, e é exatamente ela que o carimbo cobre.
- Risco: entrada concorrente SEM campo `at` (não deveria existir, todo produtor passa por `fetchMergeState`) → Solução preparada: `Number(v.at || 0)` trata ausência como 0, que é `< iniciado`, caindo na regra de sempre (não sobrevive); nunca lança.
- Risco: deslocamento de linhas pelo 4.3 (D13) → Solução preparada: localizar `refreshMergeStates` pelo nome; a âncora é a linha final `engine.mergeStates = next;`.

- [ ] **Passo 1: escrever o teste que falha** (anexar em `test/selfpr-consistency.test.js`):

```js
/* ---------- B8: reconciliação do mergeStates ---------- */

function msFresco(extra) {
  return { mergeable: 'MERGEABLE', status: 'CLEAN', isDraft: false, state: 'OPEN', baseRefName: 'develop', at: Date.now(), ...extra };
}

test('escrita concorrente do runSelfAnalysis durante o refresh não é engolida', async () => {
  const engine = novoEngine();
  engine.myPRs = [{ ...MEU_PR }];
  engine.selfAnalyses = { [CHAVE]: { approvable: true } };
  engine.fetchAutoMergeAllowed = async () => true;
  engine.fetchMergeState = async () => {
    // simula a autoanálise de OUTRO PR terminando no meio do await deste ciclo
    engine.mergeStates['acme/app#77'] = msFresco();
    return msFresco();
  };
  await engine.refreshMergeStates();
  assert.ok(engine.mergeStates[CHAVE], 'o alvo do ciclo entrou');
  assert.ok(engine.mergeStates['acme/app#77'], 'a entrada gravada durante o ciclo não pode sumir até o próximo polling');
});

test('entrada velha de PR que deixou de ser alvo continua saindo no refresh', async () => {
  const engine = novoEngine();
  engine.myPRs = [];
  engine.selfAnalyses = {};
  engine.mergeStates = { 'acme/app#99': msFresco({ at: Date.now() - 60000 }) };
  await engine.refreshMergeStates();
  assert.equal(engine.mergeStates['acme/app#99'], undefined, 'estado velho de não-alvo é limpo como sempre');
});

test('fetch que falhou continua derrubando a entrada do alvo (semântica original)', async () => {
  const engine = novoEngine();
  engine.myPRs = [{ ...MEU_PR }];
  engine.selfAnalyses = { [CHAVE]: { approvable: true } };
  engine.mergeStates = { [CHAVE]: msFresco({ at: Date.now() - 60000 }) };
  engine.fetchMergeState = async () => null;
  await engine.refreshMergeStates();
  assert.equal(engine.mergeStates[CHAVE], undefined, 'sem leitura fresca, o botão não fica em pé por dado velho');
});
```

- [ ] **Passo 2: rodar e ver falhar**: `node --test test/selfpr-consistency.test.js`. Esperar o primeiro teste vermelho (`acme/app#77` sumiu na troca por atacado); os outros dois já nascem verdes DE PROPÓSITO (pinam a semântica original que a correção não pode mudar).

- [ ] **Passo 3: implementação mínima** (`lib/engine/selfpr.js`, `refreshMergeStates`; DEPOIS fica):

```js
async function refreshMergeStates(engine) {
  const iniciado = Date.now();
  const blocked = (engine.config.mergeBlockedRepos || []).map(r => String(r).toLowerCase());
  const targets = (engine.myPRs || []).filter(pr => {
    const a = engine.selfAnalyses[pr.key];
    return a && a.approvable === true && !blocked.includes(String(pr.repo || '').toLowerCase());
  });
  const next = {};
  const autoByRepo = new Map();
  for (const pr of targets) {
    const ms = await engine.fetchMergeState(pr.url);
    if (!ms) continue;
    const repo = pr.repo || (pr.key || '').split('#')[0];
    if (!autoByRepo.has(repo)) autoByRepo.set(repo, await engine.fetchAutoMergeAllowed(repo));
    ms.autoAllowed = autoByRepo.get(repo);
    // so quando esta BLOCKED (quando auto/admin apareceriam) vale checar o ruleset:
    // se a base tem ruleset bloqueante, o --admin nao fura, entao esconde o admin.
    if (ms.status === 'BLOCKED') {
      const rb = await engine.fetchRuleBlocked(repo, pr.base || ms.baseRefName);
      ms.adminBlocked = rb === true || !!engine.adminBlockedRepos[repo];
    }
    next[pr.key] = ms;
  }
  // reconcilia em vez de trocar por atacado: runSelfAnalysis grava
  // engine.mergeStates[key] enquanto este loop espera os gh (escrita concorrente)
  // e a troca total engolia a entrada recém-gravada até o próximo polling.
  // Entrada carimbada de "iniciado" pra cá é mais fresca que o snapshot deste
  // ciclo e permanece; o resto segue a regra de sempre (só alvo confirmado fica).
  for (const [k, v] of Object.entries(engine.mergeStates)) {
    if (!v || Number(v.at || 0) < iniciado) continue;
    if (!next[k] || Number(v.at || 0) > Number(next[k].at || 0)) next[k] = v;
  }
  engine.mergeStates = next;
}
```

(mudanças concretas: `const iniciado = Date.now();` no topo e o laço de reconciliação antes da atribuição final; o loop de fetch fica idêntico)

- [ ] **Passo 4: rodar a suite inteira**: `npm run check && npm test`. Rodar `node --test test/selfpr-consistency.test.js` duas ou três vezes seguidas pra afastar flakiness de timing (o carimbo usa `>=`, então empate de ms não flakeia, mas a prova custa 10 segundos).

- [ ] **Passo 5: commit**: `fix: refreshMergeStates reconcilia por chave sem engolir escrita concorrente`

---

## Fecho da onda

Depois da 4.5: rodar `npm run check && npm test` uma última vez com a suite completa (335 testes de antes + os 12 novos: 2 na 4.1, 2 na 4.2, 3 na 4.3, 2 na 4.4, 3 na 4.5) e conferir que `test/review-prompt.test.js` (tabela de aridade das fachadas) segue verde, já que nenhuma fachada mudou de assinatura. Nenhuma tarefa da onda toca UI, plataforma (IS_WIN/IS_MAC) ou os templates do workspace; o re-sync do `prepareHome` no boot não arrasta nada novo.
