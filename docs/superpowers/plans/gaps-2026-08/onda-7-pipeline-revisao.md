# Rascunho de plano, correção de gaps lógicos do Farol

## Onda 7: Pipeline de revisão, pushback e fan-out

**Achados cobertos:** M7, M8, M9, M12, B5, B6, B9

**Contexto verificado no fonte (v2.30.1):** todos os sete achados foram confirmados por leitura direta de `lib/engine/review.js`, `lib/engine/decision.js`, `lib/engine/pushback.js`, `lib/engine/fanout.js`, `lib/engine/selfpr.js` e `server.js` (check em 604-626), mais os testes `test/contested.test.js`, `test/fanout.test.js`, `test/pushback.test.js` e `test/review-prompt.test.js`. Os números de linha citados abaixo são do estado atual desses arquivos.

**Dificuldades antecipadas da onda** (a parte MAIS importante do plano; o objetivo é ter a solução pronta antes do impedimento aparecer):

- **D1. Objeto é truthy: mudar o retorno de `shouldAutoApprove` pra `{ok, motivo}` sem mudar o chamador no MESMO commit quebra o invariante 4 em silêncio.** `runHeadlessReview` faz `const canAuto = engine.shouldAutoApprove(pr, result)` e depois `if (canAuto)`; um objeto `{ok:false}` é truthy, então TODO PR aprovável passaria a postar APPROVE sozinho, e nenhum teste atual exercita `runHeadlessReview` pra acusar. → Solução preparada: a Tarefa 7.1 muda `decision.js` E a linha 288 do `review.js` (`.ok === true`) no mesmo commit, e antes do commit roda `grep -rn "shouldAutoApprove(" lib server.js test` conferindo que os únicos consumidores são `decision.js` (definição), `server.js:794` (fachada, intocada), `review.js:288` e os dois arquivos de teste. A Tarefa 7.2 acrescenta o harness que exercita `runHeadlessReview` de verdade e pina o gate.
- **D2. A suíte atual pina o retorno booleano com `assert.equal(..., true/false)` em 10 pontos.** Com `assert/strict`, objeto nunca é igual a `true`, então esses 10 asserts explodem juntos na Tarefa 7.1 e podem parecer regressão. → Solução preparada: lista fechada dos pontos a adaptar pra `.ok`: `test/contested.test.js` linhas 42, 47, 73, 82 e 103; `test/fanout.test.js` linhas 122, 125, 134, 141 e 150. `shouldAutoReject` segue booleano de propósito (o M7 é só do approve), então as linhas 56 e 59 do contested e 161 do fanout NÃO mudam, o que reduz o raio da mudança.
- **D3. Testar `runHeadlessReview` esbarra em `fanoutMod.prMetrics`, que roda `gh pr view` de verdade e não passa por fachada do engine (é `require` direto dentro do review.js).** Stub via `e.prMetrics = ...` não funciona. → Solução preparada: o call site é `fanoutMod.prMetrics(engine, pr)`, lookup de propriedade em tempo de chamada, então trocar a propriedade exportada do módulo funciona: `const fanout = require('../lib/engine/fanout.js'); fanout.prMetrics = async () => null;` (medição nula degrada pro passe único, que é o caminho que queremos no harness). Restaurar no `after()`. O `node --test` roda cada arquivo em processo próprio, então o patch não vaza pros outros arquivos.
- **D4. O harness de `runHeadlessReview` toca estado real (decisions.json, inflight) e emite eventos.** → Solução preparada: `FAROL_HOME` temporário por arquivo de teste com `rmSync` no `after()` (idioma exato da suíte, ver topo do `test/pushback.test.js`). Emits sem listener em EventEmitter são inofensivos (só o evento `error` lançaria, e nenhum caminho testado emite `error`). E `postReview` entra stubado pra LANÇAR (`throw`): vira sentinela, se algum gate deixar postar o teste explode em vez de passar calado.
- **D5. M8 muda a FORMA do valor do Map `retryAfterNet` (número de tentativas vira `{tries, pr}`), e um leitor esquecido coagiria objeto pra NaN em silêncio.** → Solução preparada: leitores mapeados por grep no repo inteiro (fora node_modules): `review.js` 122, 142, 145, 150 e `server.js` 613, 620, 621. Só isso. Escrita e leitura mudam no mesmo commit (7.4). Não existe estado legado em disco: o Map nasce `new Map()` no construtor (`server.js:179`) e NÃO entra no `writeInflight`, então não há migração a fazer.
- **D6. A fachada nova `retryTargets` precisa casar com a `RE_FACHADA` do `test/facades.test.js` (que deriva a aridade do fonte); fachada escrita fora do formato de uma linha sai da varredura sem acusar nada.** → Solução preparada: escrever no formato exato das vizinhas (`retryTargets(freshKeys, inflightKeys) { return reviewMod.retryTargets(this, freshKeys, inflightKeys); }`, corpo de uma linha, indentado com 2 espaços) e fazer o teste novo chamar A FACHADA (`e.retryTargets(...)`), não o módulo direto, cobrindo fachada e implementação no mesmo assert.
- **D7. M9 e B6 mexem no MESMO trecho do `scanPushbacks` (linhas 90-113) e os diffs conflitam se escritos isoladamente.** → Solução preparada: ordem fixa 7.5 antes de 7.6, e o bloco "depois" da 7.6 neste plano já está escrito SOBRE o código pós-7.5 (inclui a guarda de manual). O teste existente "para em 2 classificações por ciclo" continua verde nas duas tarefas porque `classified++` segue acontecendo antes do classify.
- **D8. M12 muda o resultado de `planLotes` pra entradas que os testes de borda atuais já cobrem ("tudo na raiz" passa a fatiar em 2).** → Solução preparada: conferido linha a linha, os asserts atuais são de faixa (`length >= 1 && <= 4`) e de conservação de arquivos, seguem verdes; "um arquivo só devolve um lote" é protegido pela guarda `lista.length >= 2` no fallback. Efeito colateral consciente: PR grande num diretório único passa a rodar fan-out DE VERDADE e custa mais tokens, que é o mesmo efeito documentado no CLAUDE.md quando o fan-out foi ligado na v2.28.0 (comportamento prometido, não regressão).
- **D9. B9 não tem como stubar o `gh`: o selfpr.js captura `run` por desestruturação no `require`, e o módulo já foi carregado pelo server.js quando qualquer teste roda.** → Solução preparada: não brigar com isso; extrair o gate de cachear numa função pura exportada (`temCandidatos`) e testar a função, exatamente o precedente registrado no próprio repo pra `pushbackTargets` (pushback.js:69-72) e `buildModelFlags` (CLAUDE.md). A linha de integração fica coberta por leitura: a ÚNICA escrita de `engine.reviewerCands` no selfpr.js passa a estar atrás do gate, conferível com `grep -n "reviewerCands =" lib/engine/selfpr.js` (deve devolver só a linha nova).
- **D10. Cross-platform (requisito firme).** Nenhuma tarefa toca branch de SO nem caminho de shell; os testes novos usam `os.tmpdir()` + `path.join` (idioma da suíte) e zero caminho com barra hardcoded, então rodam iguais no Windows e no macOS. Nada a validar em Mac além do `npm test` de sempre.

---

### Tarefa 7.1: shouldAutoApprove devolve o motivo estruturado da recusa (achados: M7, parte 1)

**Arquivos:** Modify: `lib/engine/decision.js:84-104`, `lib/engine/review.js:288`, `test/contested.test.js:42,47,73,82,103`, `test/fanout.test.js:122,125,134,141,150`, `CLAUDE.md` (parágrafo do invariante 4, frase "A decisão fica isolada em `shouldAutoApprove(pr, result)`") | Test: `test/contested.test.js`

**Interfaces:** Produz: `shouldAutoApprove(engine, pr, result)` passa a devolver `{ ok: boolean, motivo: 'nao_aprovavel'|'clique'|'contestacao'|'cobertura'|'politica'|null }` (motivo `null` quando `ok` é `true`). Consome (inalterado): `contestations(result)`, `coverageGap(result)`, `engine.attentionPoints(result)`, `engine.approvePolicyFor(user, clean)`, `engine.accountForPr(pr)`. `shouldAutoReject` segue devolvendo booleano.

**Dificuldades antecipadas:**
- Objeto truthy no `if (canAuto)` do review.js → Solução: a linha 288 muda pra `.ok === true` neste mesmo commit (ver D1 da onda).
- `assert.equal` estrito nunca iguala objeto a `true` → Solução: adaptação das 10 linhas listadas em D2, e os testes novos usam `assert.deepEqual` contra o objeto inteiro, que também trava o NOME de cada motivo (o review.js da 7.2 vai depender da string `'politica'`).
- O `facades.test.js` deriva aridade, não tipo de retorno → nada muda lá; rodar a suíte confirma.

- [ ] **Passo 1: escrever o teste que falha.** Acrescentar no fim de `test/contested.test.js`:

```js
/* ---------- retorno estruturado: o MOTIVO da recusa (Onda 7, M7) ----------
   O gate devolvia só um boolean e o bloco de transparência do runHeadlessReview
   tinha que ADIVINHAR por que a aprovação automática não saiu, e adivinhava sempre
   "política da conta", mesmo quando o bloqueio veio de contestação ou cobertura.
   Contrato novo: { ok, motivo }, com o motivo nomeado. */

test('shouldAutoApprove expõe o motivo da recusa: contestação', () => {
  const e = engineWithPolicy('approve');
  const r = approvableResult({
    contested: [{ source: 'Acrity', claim: 'x', label: 'falso_positivo', evidence: 'Arquivo.tsx:10' }]
  });
  assert.deepEqual(e.shouldAutoApprove(PR, r), { ok: false, motivo: 'contestacao' });
});

test('shouldAutoApprove expõe o motivo da recusa: cobertura', () => {
  const e = engineWithPolicy('approve');
  const r = approvableResult({ coverage: { total: 3, reviewed: ['a.ts'], missing: ['b.ts', 'c.ts'] } });
  assert.deepEqual(e.shouldAutoApprove(PR, r), { ok: false, motivo: 'cobertura' });
});

test('shouldAutoApprove expõe o motivo da recusa: política da conta', () => {
  const e = engineWithPolicy('wait');
  assert.deepEqual(e.shouldAutoApprove(PR, approvableResult()), { ok: false, motivo: 'politica' });
});

test('shouldAutoApprove expõe o motivo da recusa: clique no panorama e não-aprovável', () => {
  const e = engineWithPolicy('approve');
  assert.deepEqual(e.shouldAutoApprove({ ...PR, requested: false }, approvableResult()),
    { ok: false, motivo: 'clique' });
  assert.deepEqual(e.shouldAutoApprove(PR, approvableResult({ verdict: 'request_changes' })),
    { ok: false, motivo: 'nao_aprovavel' });
});

test('shouldAutoApprove aprovando devolve ok true e motivo nulo', () => {
  const e = engineWithPolicy('approve');
  assert.deepEqual(e.shouldAutoApprove(PR, approvableResult()), { ok: true, motivo: null });
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/contested.test.js`. Esperado: os 5 testes novos falham com `AssertionError` do `deepEqual` (veio `true`/`false`, esperado objeto); os testes antigos do arquivo seguem verdes (ainda comparam boolean com boolean).

- [ ] **Passo 3: implementação mínima.** Em `lib/engine/decision.js`, o bloco 84-104 fica assim:

```js
// Deve auto-aprovar este PR? Aprovável = veredito approve + payload APPROVE.
// Devolve { ok, motivo }: ok true aprova sozinho; ok false carrega POR QUE não
// ('nao_aprovavel' | 'clique' | 'contestacao' | 'cobertura' | 'politica'), pra o
// chamador explicar a recusa sem adivinhar (antes a transparência do
// runHeadlessReview atribuía toda recusa à política da conta). Revisão iniciada
// por clique (requested === false) NUNCA auto-posta. Com autoApproveAll (default)
// todo aprovável passa; senão, só o gate estrito (auto_approve E card comprovado).
function shouldAutoApprove(engine, pr, result) {
  const approvable = result.verdict === 'approve' &&
    result.payloads && result.payloads.approve && result.payloads.approve.event === 'APPROVE';
  if (!approvable) return { ok: false, motivo: 'nao_aprovavel' };
  if (pr.requested === false) return { ok: false, motivo: 'clique' };
  // contestar review de terceiro (dizer "isso é falso positivo") é afirmação pública
  // contra outro revisor: passa pelo humano SEMPRE, mesmo com autoApproveAll ligado.
  // Direção segura (só restringe), nunca afrouxa o gate do invariante 4.
  if (contestations(result).length) return { ok: false, motivo: 'contestacao' };
  // cobertura incompleta em PR grande: "zero achado" aqui não prova nada, porque a
  // revisão não olhou o diff inteiro. Aprovar sozinho exige ter olhado tudo. Ressalva
  // NÃO entra nesta conta: ressalva aprova (decisão do Wanderson), lacuna de leitura não.
  if (coverageGap(result).length) return { ok: false, motivo: 'cobertura' };
  // limpo = sem ressalvas (nenhum ponto de atenção) E a sessão decidiu auto_approve;
  // senão é "aprovável com ressalvas". A política da conta dona decide a ação.
  const clean = engine.attentionPoints(result).length === 0 && result.decision === 'auto_approve';
  if (engine.approvePolicyFor(engine.accountForPr(pr), clean) !== 'approve') {
    return { ok: false, motivo: 'politica' };
  }
  return { ok: true, motivo: null };
}
```

Em `lib/engine/review.js`, a linha 288 vira:

```js
    const canAuto = engine.shouldAutoApprove(pr, result).ok === true;
```

Adaptar os 10 asserts existentes (mesmo texto de mensagem, só o `.ok`), exemplo do padrão aplicado a todos:

```js
  assert.equal(e.shouldAutoApprove(PR, semContest).ok, true, 'sem contestação segue aprovando sozinho');
  assert.equal(e.shouldAutoApprove(PR, comContest).ok, false, 'com contestação, passa pelo humano');
```

(aplicar em contested.test.js 42, 47, 73, 82, 103 e fanout.test.js 122, 125, 134, 141, 150; NÃO tocar nos asserts de `shouldAutoReject`).

No `CLAUDE.md`, na frase do invariante 4 "A decisão fica isolada em `shouldAutoApprove(pr, result)`", acrescentar logo após: "(devolve `{ ok, motivo }`; o `motivo` alimenta a transparência do runHeadlessReview, que só atribui a recusa à política da conta quando o motivo é `politica`)".

- [ ] **Passo 4: rodar a suite inteira.** `npm test && npm run check` (verde nos dois; atenção especial a `test/facades.test.js` e aos 10 asserts adaptados).

- [ ] **Passo 5: commit.** `refactor(review): shouldAutoApprove devolve o motivo estruturado da recusa`

---

### Tarefa 7.2: transparência atribui à política só o que veio da política (achados: M7, parte 2)

**Arquivos:** Modify: `lib/engine/review.js:288,367-379` | Test: `test/review-reasons.test.js` (novo)

**Interfaces:** Consome: o `{ ok, motivo }` da 7.1 (a string `'politica'` vira condição do bloco de transparência). Produz: nada novo exportado; `runHeadlessReview` guarda o retorno em `autoDec` e deriva `canAuto` dele.

**Dificuldades antecipadas:**
- `prMetrics` roda `gh` de verdade dentro do harness → patch da propriedade do módulo fanout (D3 da onda), com restauração no `after`.
- O bloco antigo recalculava `clean` DEPOIS das mutações de `result.reasons`, e o novo precisa preservar isso (as reasons operacionais prependadas fazem `attentionPoints` > 0, então a redação sai "com ressalvas") → o código novo recalcula `clean` no mesmo ponto do fluxo, comportamento preservado.
- O caso "canAuto true mas o post falhou" (linha 343 acrescenta reason e cai pro fim) não pode ganhar a linha de política → com `motivo === null` nesse caso, o bloco novo não dispara, igual ao antigo (que exigia `!canAuto`).
- Estado compartilhado entre testes do mesmo arquivo (decisions.json no mesmo FAROL_HOME) → `recordDecision` faz `unshift`, então `pending[0]` é sempre o item do teste corrente; os asserts leem só `[0]`.

- [ ] **Passo 1: escrever o teste que falha.** Criar `test/review-reasons.test.js`:

```js
'use strict';
// Reasons do runHeadlessReview: o bloco de transparência só pode atribuir à POLÍTICA
// da conta o que veio de fato da política. Antes ele disparava sempre que o gate
// recusava um PR aprovável e pedido a mim, então contestação e cobertura apareciam
// pra você como "a política da conta manda aguardar", que era mentira (M7).
// Harness: engine real com FAROL_HOME temporário, sessão Claude stubada e a medição
// de fan-out neutralizada (prMetrics null = passe único). Runner nativo, ZERO deps.
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-review-reasons-' + process.pid);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Engine } = require('../server.js');
const fanout = require('../lib/engine/fanout.js');

// runHeadlessReview chama fanoutMod.prMetrics por acesso de propriedade em tempo de
// chamada, então trocar a propriedade exportada vale pro require de dentro do review.js.
const prMetricsOriginal = fanout.prMetrics;
fanout.prMetrics = async () => null;

after(() => {
  fanout.prMetrics = prMetricsOriginal;
  try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { }
});

const PR = {
  key: 'o/r#1', repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1',
  requested: true, title: 't', author: 'alice'
};

function envelope(extra) {
  return {
    verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
    reportMarkdown: 'relatório', payloads: { approve: { event: 'APPROVE', body: 'ok' } },
    ...extra
  };
}

// engine com a sessão stubada devolvendo o envelope dado; nada toca rede nem posta.
// postReview LANÇA de propósito: se algum gate deixar postar, o teste explode.
function engineComEnvelope(data, { policy = 'approve' } = {}) {
  const e = new Engine();
  e.accountForPr = () => 'trabalho';
  e.approvePolicyFor = () => policy;
  e.rejectPolicyFor = () => 'wait';
  e.scopeLabel = () => 'Conta Trabalho';
  e.myReviewStates = async () => null;
  e.postReview = async () => { throw new Error('não era pra postar neste teste'); };
  e.runClaudeStream = async () => ({ text: JSON.stringify({ result: JSON.stringify(data) }), sessionId: 's1' });
  return e;
}

test('recusa por política da conta lidera as reasons com a explicação da política', async () => {
  const e = engineComEnvelope(envelope(), { policy: 'wait' });
  await e.runHeadlessReview(PR);
  const item = e.decisions.pending[0];
  assert.ok(item, 'caiu na sua mesa (needs decision)');
  assert.match(item.reasons[0], /política da conta Conta Trabalho/, 'a recusa é da política, e diz isso');
});

test('recusa por contestação NÃO é atribuída à política da conta (M7)', async () => {
  const e = engineComEnvelope(envelope({
    contested: [{ source: 'Acrity', claim: 'ref não é setado', label: 'falso_positivo', evidence: 'Arquivo.tsx:172 seta o ref' }]
  }), { policy: 'approve' });
  await e.runHeadlessReview(PR);
  const item = e.decisions.pending[0];
  assert.ok(item, 'contestação sempre cai na sua mesa');
  assert.match(item.reasons[0], /discordância/, 'o motivo que lidera é a contestação');
  for (const r of item.reasons) assert.doesNotMatch(r, /política da conta/, 'nenhuma reason culpa a política');
});

test('recusa por cobertura incompleta NÃO é atribuída à política da conta (M7)', async () => {
  const e = engineComEnvelope(envelope({
    coverage: { total: 3, reviewed: ['a.ts'], missing: ['b.ts', 'c.ts'] }
  }), { policy: 'approve' });
  await e.runHeadlessReview(PR);
  const item = e.decisions.pending[0];
  assert.ok(item, 'lacuna de leitura sempre cai na sua mesa');
  assert.match(item.reasons[0], /não cobriu/, 'o motivo que lidera é a cobertura');
  for (const r of item.reasons) assert.doesNotMatch(r, /política da conta/, 'nenhuma reason culpa a política');
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/review-reasons.test.js`. Esperado: o 1º teste passa (pin do comportamento certo que já existe); o 2º e o 3º falham porque hoje `reasons[0]` é a linha "aprovável sem ressalvas, mas a política da conta Conta Trabalho manda aguardar..." (o bloco de transparência dispara pra QUALQUER recusa).

- [ ] **Passo 3: implementação mínima.** Em `lib/engine/review.js`, a linha 288 vira duas:

```js
    const autoDec = engine.shouldAutoApprove(pr, result);
    const canAuto = autoDec.ok === true;
```

E o bloco 367-379 (comentário + `const approvable` + `if`) é substituído por:

```js
    // transparência: o gate disse POR QUE não auto-postou (autoDec.motivo). Só
    // quando o motivo é a POLÍTICA da conta a recusa é atribuída à política;
    // contestação e cobertura já prependam a própria explicação nos blocos acima
    // (era o M7: o bloco antigo culpava a política em recusa de contestação/cobertura).
    if (autoDec.motivo === 'politica') {
      const acc = engine.accountForPr(pr);
      const label = engine.scopeLabel(acc) || acc || 'esta conta';
      const clean = engine.attentionPoints(result).length === 0 && result.decision === 'auto_approve';
      const why = clean
        ? `aprovável sem ressalvas, mas a política da conta ${label} manda aguardar sua aprovação (ajuste em Sistema > Contas)`
        : `aprovável com ressalvas, e a política da conta ${label} é aguardar você (mude pra "aprova e destaca as ressalvas" em Sistema > Contas se quiser que aprove sozinho)`;
      result.reasons = [why, ...(result.reasons || [])];
    }
```

- [ ] **Passo 4: rodar a suite inteira.** `npm test && npm run check`.

- [ ] **Passo 5: commit.** `fix(review): transparência atribui recusa à política só quando o motivo é a política`

---

### Tarefa 7.3: lacuna de cobertura entra UMA vez nas reasons (achados: B5)

**Arquivos:** Modify: `lib/engine/review.js:294-307` | Test: `test/review-reasons.test.js`

**Interfaces:** nada muda de assinatura; só a composição de `result.reasons` dentro de `runHeadlessReview`.

**Dificuldades antecipadas:**
- Decidir QUAL redação fica → decisão registrada aqui: fica a SEGUNDA ("a revisão não cobriu o diff inteiro (N pendência(s): amostra, ...), então não posto sozinho"), sai a primeira ("confira antes de aprovar"). Motivo: a amostra de arquivos dá ação imediata sem abrir o relatório, e "não posto sozinho" explica a consequência; a primeira redação não traz nada que a segunda não traga.
- Os comentários dos dois blocos se contradizem ("cobertura lidera tudo" vs "contestação lidera") → o comentário do bloco que fica é reescrito pra dizer a verdade do código: cada bloco faz `unshift`, então a ORDEM final é contestação, cobertura, clique (o último a prepender lidera).
- O teste do M7 (7.2, cobertura) usa `reasons[0]` com `/não cobriu/`, que casa com as duas redações → segue verde antes e depois desta tarefa, sem acoplamento de ordem.

- [ ] **Passo 1: escrever o teste que falha.** Acrescentar em `test/review-reasons.test.js`:

```js
test('lacuna de cobertura entra UMA vez nas reasons, com a amostra dos arquivos (B5)', async () => {
  const e = engineComEnvelope(envelope({
    coverage: { total: 3, reviewed: ['a.ts'], missing: ['b.ts', 'c.ts'] }
  }), { policy: 'approve' });
  await e.runHeadlessReview(PR);
  const item = e.decisions.pending[0];
  const deCobertura = item.reasons.filter(r => /não cobriu/.test(r));
  assert.equal(deCobertura.length, 1, `cobertura virou ${deCobertura.length} motivo(s): ${deCobertura.join(' | ')}`);
  assert.match(deCobertura[0], /b\.ts/, 'a redação que fica é a que mostra a amostra');
  assert.match(deCobertura[0], /não posto sozinho/, 'e a que explica a consequência');
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/review-reasons.test.js`. Esperado: o teste novo falha com `cobertura virou 2 motivo(s): ...` (os dois blocos consecutivos prependam cada um a sua linha).

- [ ] **Passo 3: implementação mínima.** Em `lib/engine/review.js`, apagar as linhas 294-299 (o comentário "cobertura incompleta lidera tudo" e o bloco do `faltando`) e ajustar o comentário do bloco que fica. O trecho entre o bloco de `requested === false` e o bloco de `contested` fica assim:

```js
    // lacuna de cobertura: é a diferença entre "está limpo" e "não olhei", e explica
    // por que um PR grande sem achado nenhum caiu na sua mesa em vez de auto-aprovar.
    // (cada bloco abaixo faz unshift, então a ordem final das reasons é: contestação,
    // cobertura, clique; o último a prepender lidera)
    const semCobertura = engine.coverageGap(result);
    if (semCobertura.length) {
      const amostra = semCobertura.slice(0, 3).join(', ');
      result.reasons = [`a revisão não cobriu o diff inteiro (${semCobertura.length} pendência(s): ${amostra}${semCobertura.length > 3 ? ', ...' : ''}), então não posto sozinho`,
        ...(result.reasons || [])];
    }
```

- [ ] **Passo 4: rodar a suite inteira.** `npm test && npm run check`.

- [ ] **Passo 5: commit.** `fix(review): lacuna de cobertura entra uma vez só nas reasons`

---

### Tarefa 7.4: retry pós-transitório vale pra clique do panorama e conta sem autoReview (achados: M8)

**Arquivos:** Modify: `lib/engine/review.js:141-148` (guardar `{tries, pr}`), `lib/engine/review.js:393-396` (exportar `retryTargets`), `server.js:619-626` (bloco de retry do check), `server.js:~715` (fachada nova, junto das fachadas de review) | Test: `test/retry-net.test.js` (novo)

**Interfaces:** Produz: `retryTargets(engine, freshKeys:Set, inflightKeys:Set) -> pr[]` exportada de `lib/engine/review.js`, com fachada `Engine.retryTargets(freshKeys, inflightKeys)`. Muda a forma do valor de `engine.retryAfterNet`: de `key -> número` pra `key -> { tries: número, pr: objeto do PR }`. Consome: `engine.isMuted`, `engine.accountForPr`.

**Dificuldades antecipadas:**
- Leitor esquecido do formato antigo do Map coagiria objeto pra NaN → lista fechada de leitores em D5 da onda; os dois pontos de leitura (`get` na linha 142) e escrita (`set` na 145) mudam juntos; `has`/`delete`/`size` não dependem da forma do valor.
- O bloco do check() hoje filtra `this.queue`, e o PR de clique no panorama NÃO volta pra queue no rebuild (a queue nasce de `mineList` a cada ciclo), então guardar só a key não basta → por isso o `pr` inteiro entra no Map na hora da falha (o objeto tem `url`, que é o que `launchReview` precisa).
- Relançar via `launchReview(urls, 'auto')` reconstrói o item: pra PR na fila resolve `requested: true`, pra PR do panorama `requested: !!pano.mine`, pra URL avulsa `false` → o gate de postagem preserva exatamente a semântica do lançamento original (clique nunca auto-posta), nada a compensar.
- Dupla largada no mesmo ciclo (toReview + retry) → `toReview` já exclui `retryAfterNet` (server.js:613, intocado), `retryTargets` exclui `fresh` e `inflight`, e `enqueueHeadless` tem dedup próprio (review.js:73-75), três camadas.
- A fachada precisa entrar na varredura do facades.test.js → formato de uma linha idêntico às vizinhas (D6 da onda), e o teste chama a fachada.

- [ ] **Passo 1: escrever o teste que falha.** Criar `test/retry-net.test.js`:

```js
'use strict';
// Retry pós-falha transitória: o toast promete "tento de novo no próximo ciclo",
// então o próximo ciclo tem que conseguir relançar SEM depender (a) da política
// autoReview da conta e (b) de o PR seguir na fila mine (revisão por clique no
// panorama não é mine e sai da queue no rebuild do check). O M8 era exatamente
// essa promessa quebrada. Runner nativo, ZERO deps.
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-retry-net-' + process.pid);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Engine } = require('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

function engineBase() {
  const e = new Engine();
  e.accountForPr = (pr) => pr.account || 'eu';
  e.isMuted = (u) => u === 'silenciada';
  e.log = () => { };
  return e;
}
const prDe = (key, extra) => ({ key, url: `https://github.com/${key.replace('#', '/pull/')}`, ...extra });

test('runOneHeadless guarda o PR junto das tentativas na falha transitória', async () => {
  const e = engineBase();
  e.runHeadlessReview = async () => { throw new Error('fetch failed'); };
  const pr = prDe('o/r#1');
  await e.runOneHeadless(pr, 'eu');
  const guardado = e.retryAfterNet.get('o/r#1');
  assert.equal(guardado.tries, 1, 'conta a tentativa');
  assert.equal(guardado.pr.url, pr.url, 'guarda o PR pra relançar sem depender da fila');
});

test('retryTargets relança PR de clique no panorama (fora da fila) e ignora autoReview da conta', () => {
  const e = engineBase();
  e.autoReviewFor = () => false; // conta SEM auto-revisão: a promessa do toast vale mesmo assim
  e.queue = [];                  // PR de clique não é mine: nunca volta pra queue no rebuild
  e.retryAfterNet.set('o/r#1', { tries: 1, pr: prDe('o/r#1') });
  assert.deepEqual(e.retryTargets(new Set(), new Set()).map(p => p.key), ['o/r#1']);
});

test('retryTargets pula silenciado, recém-chegado e o que já está rodando', () => {
  const e = engineBase();
  e.retryAfterNet.set('o/r#1', { tries: 1, pr: prDe('o/r#1', { account: 'silenciada' }) });
  e.retryAfterNet.set('o/r#2', { tries: 1, pr: prDe('o/r#2') });
  e.retryAfterNet.set('o/r#3', { tries: 1, pr: prDe('o/r#3') });
  e.retryAfterNet.set('o/r#4', { tries: 1, pr: prDe('o/r#4') });
  const alvos = e.retryTargets(new Set(['o/r#2']), new Set(['o/r#3']));
  assert.deepEqual(alvos.map(p => p.key), ['o/r#4']);
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/retry-net.test.js`. Esperado: o 1º falha (`guardado.tries` é `undefined`, hoje o Map guarda o número `1` cru); o 2º e o 3º falham com `TypeError: e.retryTargets is not a function`.

- [ ] **Passo 3: implementação mínima.** Em `lib/engine/review.js`, dentro do branch `transient` (linhas 141-148), a leitura e a escrita mudam:

```js
      const cap = limitErr ? 12 : 3;
      const guardado = engine.retryAfterNet.get(pr.key);
      const tries = (guardado && guardado.tries) || 0;
      engine.log('WARN', `revisao ${pr.key} (transitório, tenta de novo): ${msg}`);
      if (tries < cap) {
        // guarda o PR junto das tentativas: o relançamento não pode depender de o
        // PR seguir na fila mine (clique no panorama sai da queue no rebuild do check)
        engine.retryAfterNet.set(pr.key, { tries: tries + 1, pr });
```

Ainda em `lib/engine/review.js`, antes do `module.exports`, a função nova:

```js
// Quem volta do retry pós-transitório neste ciclo (o check() chama quando a checagem
// funcionou, ou seja, a rede voltou). SÍNCRONA e sem IO, mesmo motivo do pushbackTargets:
// testável sem rede. A promessa do toast ("retomo sozinho") NÃO depende da política
// autoReview da conta nem de o PR estar na fila: revisão por clique no panorama e conta
// com autoReview desligado também são retomadas. Ficam de fora: conta silenciada, PR
// recém-chegado (o toReview do ciclo cuida dele) e o que já está na fila headless/rodando.
function retryTargets(engine, freshKeys, inflightKeys) {
  return [...engine.retryAfterNet.values()]
    .map(v => v && v.pr)
    .filter(pr => pr &&
      !freshKeys.has(pr.key) &&
      !inflightKeys.has(pr.key) &&
      !engine.isMuted(engine.accountForPr(pr)));
}
```

e no `module.exports` do review.js, acrescentar `retryTargets` na primeira linha de exports (junto de `processHeadless, runOneHeadless`).

Em `server.js`, o bloco 619-626 do check() vira:

```js
      // a checagem funcionou = a rede voltou: relança revisões que caíram por algo
      // transitório. Vale pra QUALQUER revisão que caiu (clique no panorama e conta
      // sem autoReview inclusive): a promessa do toast não depende da política da conta.
      if (this.retryAfterNet.size) {
        const retry = this.retryTargets(new Set(fresh.map(f => f.key)), inflight);
        if (retry.length) {
          this.emit('toast', { kind: 'info', text: `Conexão de volta: relançando a revisão de ${retry.map(p => p.key).join(', ')}.` });
          this.launchReview(retry.map(p => p.url), 'auto');
        }
      }
```

E a fachada nova em `server.js`, logo abaixo de `runOneHeadless` (linha ~714), no formato exato de uma linha:

```js
  retryTargets(freshKeys, inflightKeys) { return reviewMod.retryTargets(this, freshKeys, inflightKeys); }
```

- [ ] **Passo 4: rodar a suite inteira.** `npm test && npm run check` (o facades.test.js valida a aridade da fachada nova automaticamente).

- [ ] **Passo 5: commit.** `fix(review): retry de falha transitória relança clique do panorama e conta sem autoReview`

---

### Tarefa 7.5: registro manual de pushback nunca é sobrescrito pelo scan (achados: M9)

**Arquivos:** Modify: `lib/engine/pushback.js:73-80` (pushbackTargets) e `lib/engine/pushback.js:99-101` (guarda antes da escrita) | Test: `test/pushback.test.js`

**Interfaces:** `pushbackTargets(engine, acts)` passa a consultar também `engine.pushbacks` (já é estado do engine, sem argumento novo, aridade intacta pro facades.test.js). Nada muda de assinatura.

**Dificuldades antecipadas:**
- Duas camadas ou uma? O gate no `pushbackTargets` economiza gh + sessão Claude, mas sozinho deixa a CORRIDA aberta (você marca à mão enquanto a classificação está em voo, e a escrita no fim do loop atropela) → as duas guardas entram: uma no `pushbackTargets` (barata, testável no idioma já existente do arquivo) e uma imediatamente antes da escrita no `scanPushbacks` (fecha a corrida). O teste da corrida injeta o registro manual DENTRO do stub de `classifyPushback`, reproduzindo a janela exata.
- `engine.pushbacks` pode não existir em engine sintético de teste → o helper `engineComPanorama` cria `Engine` real, que inicializa `pushbacks` no construtor; no código, `(engine.pushbacks || {})` protege mesmo assim.
- Semântica: registro `auto` (mesmo confirmed) PODE ser re-escaneado e atualizado (o autor continuou a thread); só `manual` é palavra final, como o contrato do `recordPushback` ("override") já diz → teste explícito dos dois lados pra ninguém "consertar" isso depois achando que auto também deveria travar.

- [ ] **Passo 1: escrever o teste que falha.** Acrescentar em `test/pushback.test.js`, depois dos testes de `pushbackTargets`:

```js
test('pushbackTargets: registro manual confirmado fica fora do scan (manual prevalece)', () => {
  const e = engineComPanorama(RESOLVIDOS,
    [{ key: 'o/r#2', updatedAt: '2026-08-01T12:00:00Z' },
    { key: 'o/r#3', updatedAt: '2026-08-01T12:00:00Z' }]);
  e.pushbacks = { 'o/r#2': { author: 'alice', outcome: 'author_right', source: 'manual', status: 'confirmed', at: 1 } };
  assert.deepEqual(pushbackTargets(e, e.reviewActions()).map(p => p.key), ['o/r#3']);
});

test('pushbackTargets: registro automático NÃO tira do scan (auto pode ser revisto)', () => {
  const e = engineComPanorama(RESOLVIDOS,
    [{ key: 'o/r#2', updatedAt: '2026-08-01T12:00:00Z' }],
    { 'o/r#2': '2026-08-01T10:00:00Z' });
  e.pushbacks = { 'o/r#2': { author: 'alice', outcome: 'we_right', source: 'auto', status: 'confirmed', at: 1 } };
  assert.deepEqual(pushbackTargets(e, e.reviewActions()).map(p => p.key), ['o/r#2']);
});

test('scanPushbacks não sobrescreve registro manual nem quando ele chega DURANTE o scan', async () => {
  // corrida real: você marca à mão enquanto a classificação está em voo
  const e = engineComPanorama(RESOLVIDOS, [{ key: 'o/r#2', updatedAt: '2026-08-01T10:00:00Z' }]);
  e.config.autoPushback = true;
  e.savePushbackScanned = () => { };
  e.savePushbacks = () => { };
  e.log = () => { };
  e.emit = () => { };
  e.detectAuthorPushback = async () => ({ marker: 'm', hadActivity: true });
  e.classifyPushback = async () => {
    e.pushbacks['o/r#2'] = { author: 'alice', outcome: 'author_right', source: 'manual', status: 'confirmed', at: 1 };
    return { isPushback: true, outcome: 'we_right', confidence: 'high', note: 'x' };
  };
  await e.scanPushbacks();
  assert.equal(e.pushbacks['o/r#2'].source, 'manual', 'o registro manual sobreviveu');
  assert.equal(e.pushbacks['o/r#2'].outcome, 'author_right', 'o desfecho marcado à mão prevalece');
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/pushback.test.js`. Esperado: o 1º falha (devolve `['o/r#2', 'o/r#3']`, o manual entrou no scan); o 2º passa (pin); o 3º falha (`source` virou `'auto'`, o scan atropelou o manual).

- [ ] **Passo 3: implementação mínima.** Em `lib/engine/pushback.js`, `pushbackTargets` (73-80) vira:

```js
function pushbackTargets(engine, acts) {
  return (engine.panorama || []).filter(pr => {
    if (engine.isMuted(engine.accountForPr(pr))) return false;
    if (!isPushbackTarget(acts[pr.key])) return false;
    // registro manual confirmado é palavra final (contrato do CLAUDE.md: recordPushback
    // é override): o scan não gasta gh nem sessão Claude com quem você já resolveu à mão
    const atual = (engine.pushbacks || {})[pr.key];
    if (atual && atual.source === 'manual') return false;
    const seen = engine.pushbackScanned[pr.key];
    return !seen || (pr.updatedAt && String(pr.updatedAt) > String(seen)); // updatedAt = gate barato
  });
}
```

E no `scanPushbacks`, imediatamente antes da escrita `engine.pushbacks[pr.key] = {` (linha 101), a guarda da corrida:

```js
        const prev = engine.pushbacks[pr.key];
        if (prev && prev.source === 'manual') continue; // marcou à mão durante o scan: manual prevalece
        engine.pushbacks[pr.key] = {
```

- [ ] **Passo 4: rodar a suite inteira.** `npm test && npm run check`.

- [ ] **Passo 5: commit.** `fix(pushback): registro manual confirmado nunca é sobrescrito pelo scan`

---

### Tarefa 7.6: marcador de scan só grava depois da classificação responder (achados: B6)

**Arquivos:** Modify: `lib/engine/pushback.js:93-99` (ordem marcador/classificação dentro do loop do scanPushbacks) | Test: `test/pushback.test.js`

**Interfaces:** nada muda de assinatura; muda QUANDO `engine.pushbackScanned[pr.key]` é gravado.

**Dificuldades antecipadas:**
- Distinguir "classificação falhou" de "classificou e não é pushback": `classifyPushback` devolve `null` na falha (rede, limite do plano, JSON quebrado) e um objeto em qualquer resposta válida, inclusive `outcome: 'none'` → só o `null` pula a gravação do marcador; resposta válida grava sempre (senão o PR reentraria em todo ciclo e cada reentrada custa uma sessão).
- `classified++` precisa continuar ANTES do classify, senão uma sequência de falhas transitórias fura o teto `MAX_PER_CYCLE` e dispara N sessões num ciclo → mantido no lugar; o teste existente "para em 2 classificações por ciclo" (classify devolvendo null 5 vezes) pina exatamente isso e tem que seguir verde.
- Conflito textual com a 7.5 (mesmo trecho) → o bloco "depois" abaixo já inclui o código pós-7.5; aplicar nesta ordem.
- Falha PERMANENTE de classificação num PR (ex.: thread gigante que sempre estoura) faria o alvo reentrar pra sempre, 1 sessão por ciclo → aceitável porque o teto por ciclo é 2 e o gate `updatedAt > marcador` só reabre com atividade nova; se um dia incomodar, o caminho é um contador de falhas por key, fora do escopo mínimo desta correção (registrado aqui de propósito pra não virar surpresa).

- [ ] **Passo 1: escrever o teste que falha.** Acrescentar em `test/pushback.test.js`:

```js
test('scanPushbacks: falha transitória da classificação NÃO grava o marcador (reentra no próximo ciclo)', async () => {
  const e = engineComPanorama(RESOLVIDOS, [{ key: 'o/r#2', updatedAt: '2026-08-01T10:00:00Z' }]);
  e.config.autoPushback = true;
  e.savePushbackScanned = () => { };
  e.log = () => { };
  e.detectAuthorPushback = async () => ({ marker: '2026-08-01T09:00:00Z', hadActivity: true });
  e.classifyPushback = async () => null; // sessão caiu (rede, limite do plano)
  await e.scanPushbacks();
  assert.equal(e.pushbackScanned['o/r#2'], undefined, 'sem marcador, o alvo volta no próximo ciclo');
  assert.deepEqual(pushbackTargets(e, e.reviewActions()).map(p => p.key), ['o/r#2'], 'e de fato reentra');
});

test('scanPushbacks: sem atividade do autor, o marcador grava e não gasta sessão', async () => {
  const e = engineComPanorama(RESOLVIDOS, [{ key: 'o/r#2', updatedAt: '2026-08-01T10:00:00Z' }]);
  e.config.autoPushback = true;
  e.savePushbackScanned = () => { };
  e.log = () => { };
  let classificou = false;
  e.detectAuthorPushback = async () => ({ marker: '2026-08-01T09:00:00Z', hadActivity: false });
  e.classifyPushback = async () => { classificou = true; return null; };
  await e.scanPushbacks();
  assert.equal(e.pushbackScanned['o/r#2'], '2026-08-01T09:00:00Z', 'marcador salvo');
  assert.equal(classificou, false, 'sem atividade não gasta sessão');
});

test('scanPushbacks: classificação respondida (mesmo "none") grava o marcador', async () => {
  const e = engineComPanorama(RESOLVIDOS, [{ key: 'o/r#2', updatedAt: '2026-08-01T10:00:00Z' }]);
  e.config.autoPushback = true;
  e.savePushbackScanned = () => { };
  e.log = () => { };
  e.detectAuthorPushback = async () => ({ marker: '2026-08-01T09:00:00Z', hadActivity: true });
  e.classifyPushback = async () => ({ isPushback: false, outcome: 'none', confidence: 'high', note: '' });
  await e.scanPushbacks();
  assert.equal(e.pushbackScanned['o/r#2'], '2026-08-01T09:00:00Z', 'a sessão respondeu: não reprocessa');
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/pushback.test.js`. Esperado: o 1º falha (hoje o marcador grava logo depois do detect, então `pushbackScanned['o/r#2']` existe e o alvo não reentra); o 2º e o 3º passam (pins do comportamento que deve sobreviver à mudança).

- [ ] **Passo 3: implementação mínima.** Em `lib/engine/pushback.js`, o miolo do loop do `scanPushbacks` (do `detectAuthorPushback` até o `PUSHBACK_OUTCOMES.includes`) fica assim (já sobre o código pós-7.5):

```js
        const det = await engine.detectAuthorPushback(pr);
        if (!det) continue; // não deu pra ler: tenta de novo depois (sem marcar)
        if (!det.hadActivity) {
          // autor não falou depois do meu review: marca e não gasta sessão
          engine.pushbackScanned[pr.key] = det.marker; engine.savePushbackScanned();
          continue;
        }
        classified++;
        const cls = await engine.classifyPushback(pr);
        // sessão caiu (rede/limite): NÃO marca, senão a comparação estrita do gate
        // (updatedAt > marcador) nunca reabre e o pushback se perde em definitivo
        if (!cls) continue;
        engine.pushbackScanned[pr.key] = det.marker; engine.savePushbackScanned();
        if (!cls.isPushback || cls.outcome === 'none' || !PUSHBACK_OUTCOMES.includes(cls.outcome)) continue;
```

- [ ] **Passo 4: rodar a suite inteira.** `npm test && npm run check` (atenção ao teste existente "para em 2 classificações por ciclo": tem que seguir verde).

- [ ] **Passo 5: commit.** `fix(pushback): marcador de scan só grava depois da classificação responder`

---

### Tarefa 7.7: fan-out fatia por arquivo quando o caminho não separa o diff (achados: M12)

**Arquivos:** Modify: `lib/engine/fanout.js:101-116` (planLotes, entre o agrupamento e a fusão) | Test: `test/fanout.test.js`

**Interfaces:** `planLotes(files, maxLotes)` mantém assinatura e formato de saída (`{id, escopo, lines, files}`); ganha o fallback interno. Nenhum chamador muda (`runHeadlessReview` já exige `planejados.length >= 2`, e agora passa a receber >= 2 nesse cenário).

**Dificuldades antecipadas:**
- O laço de profundidade nunca alcança `alvo` quando todo o diff mora num diretório só (ou na raiz): `keys.size` fica 1 até `maxDepth`, sobra UM grupo, o chamador descarta o plano e degrada EM SILÊNCIO pro passe único, exatamente no PR que mais precisa de fatiamento → fallback determinístico por ARQUIVO: ordena por linhas desc (desempate por path), distribui cada arquivo pro lote mais leve (greedy), rotula as partes.
- Determinismo (o teste "mesma entrada, mesma saída" pina isso) → toda ordenação do fallback tem desempate total: linhas desc, depois `localeCompare` do path; a escolha do "lote mais leve" varre `partes` em ordem fixa de índice e só troca com `<` estrito.
- Rótulo `escopo` do lote: com todos no mesmo diretório, N lotes sairiam com o MESMO escopo e o instrutivo do prompt ficaria ambíguo → cada parte ganha `(parte N)` no rótulo, numerada após a ordenação final por linhas desc; o caso raiz usa a base "raiz do repo" (mesma tradução que o `.map` final já faz pro `'.'`).
- Testes de borda existentes mudam de resultado ("tudo na raiz" com 1800 linhas passa a fatiar em 2) → verificado: os asserts são de faixa e de conservação, seguem verdes; "um arquivo só devolve um lote" protegido pela guarda `lista.length >= 2`.
- Custo real: PR grande num diretório só passa a rodar fan-out de verdade (mais tokens) → efeito desejado e documentado (mesma consequência registrada no CLAUDE.md quando o fan-out passou a funcionar na v2.28.0); nenhuma mitigação a preparar além de saber disso.

- [ ] **Passo 1: escrever o teste que falha.** Acrescentar em `test/fanout.test.js`, depois do teste "casos de borda não explodem":

```js
test('todos os arquivos no MESMO diretório: fatia por arquivo em vez de degradar calado (M12)', () => {
  // 30 arquivos, 3000 linhas, tudo em src/components: o agrupamento por prefixo
  // devolvia UM lote e o chamador (planejados.length >= 2) descartava o fan-out
  const files = Array.from({ length: 30 }, (_, i) => f(`src/components/c${String(i).padStart(2, '0')}.ts`, 100));
  const lotes = fanout.planLotes(files);
  assert.ok(lotes.length >= 2, `mesmo prefixo único tem que fatiar: veio ${lotes.length} lote(s)`);
  assert.ok(lotes.length <= fanout.MAX_LOTES, 'sem passar do teto');
  const todos = lotes.flatMap(l => l.files);
  assert.equal(todos.length, new Set(todos).size, 'nenhum arquivo em dois lotes');
  assert.deepEqual([...todos].sort(), files.map(x => x.path).sort(), 'a união é o diff inteiro');
  const maior = Math.max(...lotes.map(l => l.lines)), menor = Math.min(...lotes.map(l => l.lines));
  assert.ok(maior - menor <= 200, `lotes equilibrados por linhas (maior ${maior}, menor ${menor})`);
});

test('fallback por arquivo é determinístico e rotula as partes', () => {
  const files = Array.from({ length: 8 }, (_, i) => f(`src/only/f${i}.ts`, 150 + i));
  assert.deepEqual(fanout.planLotes(files), fanout.planLotes(files));
  for (const l of fanout.planLotes(files)) {
    assert.match(l.escopo, /src\/only \(parte \d\)/, 'cada lote diz que é uma parte do mesmo diretório');
  }
});

test('um arquivo só continua devolvendo um lote (fallback não fatia o infatiável)', () => {
  assert.equal(fanout.planLotes([f('src/only/unico.ts', 5000)]).length, 1);
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/fanout.test.js`. Esperado: o 1º falha com `mesmo prefixo único tem que fatiar: veio 1 lote(s)`; o 2º falha no `match` do escopo (hoje sai `src/only` sem "(parte N)", e um lote só); o 3º passa (pin).

- [ ] **Passo 3: implementação mínima.** Em `lib/engine/fanout.js`, o trecho entre a montagem dos grupos e a fusão dos menores fica assim (a linha `const arr = [...grupos.values()];` vira `let` e ganha o bloco de fallback):

```js
  let arr = [...grupos.values()];

  // fallback (M12): o caminho não separa nada (diff inteiro num diretório só, ou tudo
  // na raiz). Sem isso, o agrupamento devolvia UM lote, o chamador exige >= 2, e o
  // fan-out era descartado EM SILÊNCIO: exatamente o PR que mais precisa de fatiamento
  // seguia no passe único. Fatia por ARQUIVO, balanceando linhas: maiores primeiro,
  // cada um cai no lote mais leve (tudo com desempate total, então determinístico).
  if (arr.length === 1 && lista.length >= 2) {
    const base = arr[0].dir === '.' ? 'raiz do repo' : arr[0].dir;
    const partes = Array.from({ length: Math.min(alvo, lista.length) }, () => ({ dir: base, files: [], lines: 0 }));
    const ordenados = [...lista].sort((x, y) =>
      (y.lines || 0) - (x.lines || 0) || String(x.path).localeCompare(String(y.path)));
    for (const arq of ordenados) {
      let menor = partes[0];
      for (const p of partes) if (p.lines < menor.lines) menor = p;
      menor.files.push(arq.path);
      menor.lines += (arq.lines || 0);
    }
    arr = partes.filter(p => p.files.length);
    arr.sort((a, b) => b.lines - a.lines || a.files[0].localeCompare(b.files[0]));
    arr.forEach((p, i) => { p.dir = `${base} (parte ${i + 1})`; });
  }

  // funde os dois MENORES até caber no alvo (equilíbrio melhor que jogar tudo na raiz)
  while (arr.length > alvo) {
```

(o restante da função, fusão e `.map` final, fica intocado; os rótulos das partes já chegam prontos no `escopo` porque `g.dir` não é `'.'`).

- [ ] **Passo 4: rodar a suite inteira.** `npm test && npm run check` (conferir em especial os testes existentes de borda do fanout e o `test/review-prompt.test.js`, que monta lotes reais).

- [ ] **Passo 5: commit.** `fix(fanout): fatia por arquivo quando o caminho não separa o diff`

---

### Tarefa 7.8: falha total na busca de reviewers não entra no cache de 1 hora (achados: B9)

**Arquivos:** Modify: `lib/engine/selfpr.js:39` (gate antes de gravar o cache) e `lib/engine/selfpr.js:482-487` (export) | Test: `test/reviewer-candidates.test.js` (novo)

**Interfaces:** Produz: `temCandidatos(byOrg) -> boolean`, pura, exportada de `lib/engine/selfpr.js`. Consome: nada do engine. `reviewerCandidates(engine)` mantém assinatura e retorno (continua devolvendo o `byOrg` do ciclo, cacheado ou não: a UI recebe o vazio desta vez, mas o clique seguinte refaz a busca em vez de servir 1 hora de vazio).

**Dificuldades antecipadas:**
- Não dá pra stubar o `gh` (o `run` é capturado por desestruturação no require do selfpr, e o módulo já carregou junto do server.js) → testar o gate puro extraído, precedente registrado no próprio repo (`pushbackTargets`, `buildModelFlags`); a linha de integração é conferida por grep: `grep -n "reviewerCands =" lib/engine/selfpr.js` tem que devolver SÓ a linha atrás do gate.
- Falha PARCIAL (uma org respondeu, outra não) ainda cacheia o vazio da org que falhou por 1 hora → decisão consciente: o achado B9 é a falha TOTAL (gh sem rede/token, seletor 100% vazio); refino por org exigiria carregar o `ok` de cada chamada pra fora do laço e muda mais superfície; fica registrado como limite conhecido, não como esquecimento.
- "Org vazia de verdade" viraria re-busca a cada clique → não existe: quem chama `gh api orgs/X/members` autenticado enxerga a si mesmo, então org monitorada de verdade tem >= 1 membro; o comentário no código deixa esse raciocínio escrito.

- [ ] **Passo 1: escrever o teste que falha.** Criar `test/reviewer-candidates.test.js`:

```js
'use strict';
// Cache dos candidatos a reviewer (selfpr.reviewerCandidates): um byOrg inteiramente
// vazio é sintoma de falha total do gh (rede caída, token vencido), e cachear isso
// por 1 hora deixava o seletor de reviewers vazio até o TTL vencer (B9). O gate de
// cachear é a função pura temCandidatos, testável sem rede (o run do gh é capturado
// no require do selfpr e não dá pra stubar depois; mesmo caminho do pushbackTargets:
// extrai o gate síncrono). Runner nativo, ZERO deps.
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-revcands-' + process.pid);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { temCandidatos } = require('../lib/engine/selfpr');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

test('byOrg com algum membro ou time cacheia', () => {
  assert.equal(temCandidatos({ acme: { members: ['alice'], teams: [] } }), true);
  assert.equal(temCandidatos({ acme: { members: [], teams: [{ id: 'acme/dev', name: 'Dev' }] } }), true);
  assert.equal(temCandidatos({ vazia: { members: [], teams: [] }, acme: { members: ['alice'], teams: [] } }), true,
    'basta uma org com dado');
});

test('byOrg inteiramente vazio NÃO cacheia (falha total do gh não vale 1 hora de cache)', () => {
  assert.equal(temCandidatos({ acme: { members: [], teams: [] } }), false,
    'org de verdade tem pelo menos você como membro: tudo vazio = falha');
  assert.equal(temCandidatos({}), false, 'sem org nenhuma');
  assert.equal(temCandidatos(null), false, 'entrada nula não explode');
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/reviewer-candidates.test.js`. Esperado: os dois testes falham com `TypeError: temCandidatos is not a function` (a função ainda não existe nem está exportada).

- [ ] **Passo 3: implementação mínima.** Em `lib/engine/selfpr.js`, antes de `reviewerCandidates`:

```js
// Um byOrg inteiramente vazio é sintoma de falha total do gh (rede/token), não de
// org sem gente: quem chama `gh api orgs/X/members` autenticado enxerga a si mesmo,
// então org monitorada de verdade tem pelo menos 1 membro. Gate do cache do
// reviewerCandidates: falha total NÃO entra no cache de 1 hora (senão o seletor de
// reviewers fica vazio até o TTL vencer). Pura e exportada pra ser testável sem rede.
function temCandidatos(byOrg) {
  return Object.values(byOrg || {}).some(o => o && ((o.members || []).length > 0 || (o.teams || []).length > 0));
}
```

E a linha 39 (`engine.reviewerCands = { at: Date.now(), data: byOrg };`) vira:

```js
  if (temCandidatos(byOrg)) engine.reviewerCands = { at: Date.now(), data: byOrg };
  return byOrg;
```

No `module.exports`, acrescentar `temCandidatos` junto de `reviewerCandidates`:

```js
module.exports = {
  reviewerCandidates, temCandidatos, setReviewers, saveSelfAnalyses, clearSelfAnalysis, fetchMergeState,
  enrichMyPRBranches, fetchAutoMergeAllowed, fetchRuleBlocked, refreshMergeStates,
  refreshStaleStates, staleForReview, mergeSelfPR, selfPromptFor, parseSelfResult,
  launchSelfAnalysis, runSelfAnalysis,
};
```

- [ ] **Passo 4: rodar a suite inteira.** `npm test && npm run check`.

- [ ] **Passo 5: commit.** `fix(selfpr): falha total na busca de reviewers não entra no cache de 1 hora`

---

## Fechamento da onda

- Ordem de execução: 7.1 -> 7.2 -> 7.3 -> 7.4 -> 7.5 -> 7.6 -> 7.7 -> 7.8 (7.2 e 7.3 dependem da 7.1; 7.6 depende da 7.5 pelo conflito textual; as demais são independentes entre si, mas a ordem acima evita rebase mental).
- Saldo de testes: 3 arquivos novos (`review-reasons`, `retry-net`, `reviewer-candidates`), ~20 testes novos, 10 asserts adaptados, zero teste removido. A suíte sai de 335 pra ~355.
- Documentação: o CLAUDE.md é tocado UMA vez (Tarefa 7.1, invariante 4). Nenhuma outra tarefa muda contrato documentado.
- Nada aqui posta no GitHub nem roda sessão Claude de verdade: todos os testes novos usam stub/engine sintético e FAROL_HOME temporário, seguindo o idioma da suíte.
