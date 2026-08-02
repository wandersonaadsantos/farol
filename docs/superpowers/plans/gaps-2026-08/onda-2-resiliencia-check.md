# Rascunho de plano, Farol v2.30.1

## Onda 2: Resiliência do check() (raiz P2)
**Achados cobertos:** A2 (alta), M1 (média), M2 (média), B10 (baixa)

Contexto verificado no fonte (01/08/2026, working tree em `C:\Users\wanderson\Documents\farol`):
- `check()` em server.js:490-648; a falha parcial das buscas `--review-requested=@me` cai em `mineList = mine || []` (linha 564), zera `this.queue` (linha 591) e chama `markReRequests(Set vazio)` (linha 574), cujo loop de limpeza (linha 687) apaga `reReviewedKeys` inteiro. A preservação já existe pra `reviewedKeys` (linha 540) e `myPRs` (linhas 551-554), provando a intenção.
- `markReRequests` em server.js:677-689 usa `reviewActions()` (lib/engine/decision.js:47-62), cujo mapa carrega `at` (o `resolvedAt` da decisão), que é exatamente o carimbo necessário pra carência anti-lag do M1.
- `schedule()` em server.js:654 faz `Math.max(60, this.config.intervalSeconds)`, e `Math.max(60, NaN)` é NaN; `updateSettings` (server.js:952) clampa, o construtor (server.js:122-201) não.
- `searchPRs` em lib/engine/gh-queries.js:8-33 usa `--limit 100` e não detecta o teto; `fetchDeliveries` no mesmo arquivo (linha 102) mostra o padrão certo (`capped`).
- `test/rerequest.test.js` (lido inteiro) fixa o contrato "o ignorar do usuário fica valendo" (linha 52) e usa o helper `resolve()` com `resolvedAt: Date.now()`, detalhe que interage com a carência do M1 (ver D2).
- Nenhum outro teste chama `markReRequests` (grep na pasta test/: só rerequest.test.js). `markReRequests` é método direto do server.js, não fachada, então a tabela de aridade do `test/review-prompt.test.js` não precisa de entrada nova.

**Dificuldades antecipadas da onda** (a parte MAIS importante do plano; o objetivo é ter a solução pronta antes do impedimento aparecer):

- **D1. check() nunca foi testado de ponta a ponta e encadeia uns dez colaboradores com side-effect real (rede via searchPRs, spawn via launchReview, timer via schedule, IO via markSeen e baseline, SSE via pushState). Escrever o primeiro teste dele é o maior risco de travar a onda.** → Solução preparada: o helper `checkEngine()` do arquivo novo `test/check-resilience.test.js` já vem pronto neste plano com a lista EXATA de stubs por instância (resolveAccount, refreshTokens, myAuthoredPRs, enrichMyPRBranches, refreshMergeStates, refreshStaleStates, scanPushbacks, checkUpdate, schedule, saveSeen), com `config.autoReview = false` e com `launchReview` que LANÇA se for chamado (flagra disparo indevido de revisão headless no teste). O stub de `searchPRs` roteia pelo primeiro item de `extraArgs` (`--owner`, `--review-requested=@me`, `--reviewed-by=@me`), que é como o check() distingue as buscas.
- **D2. A carência anti-lag do M1 quebra os 6 testes EXISTENTES do rerequest.test.js, porque o helper `resolve()` carimba `resolvedAt: Date.now()`: com a carência, toda decisão dos testes ficaria "recém-postada" e nenhum re-request seria detectado.** → Solução preparada: na Tarefa 2.3, o MESMO commit muda o default do helper pra `Date.now() - 60 * 60 * 1000` (uma hora atrás, fora da carência, que é o caso normal de re-request na vida real) e adiciona um 5º parâmetro opcional `at` pros casos de carência. Nenhum teste existente precisa de outra mudança (conferido caso a caso: todos tratam "review postado faz tempo").
- **D3. `markReRequests(null)` hoje explode com TypeError (`for...of` sobre null), e a distinção "busca falhou" (null) contra "ninguém mais pedido" (Set vazio) é sutil o bastante pra alguém desfazer num refactor.** → Solução preparada: o contrato vira explícito no comentário do método (null preserva e devolve CÓPIA de reReviewedKeys; Set vazio limpa, como sempre) e fica travado por dois testes lado a lado no rerequest.test.js: o existente da linha 55 (Set vazio limpa) e o novo da Tarefa 2.1 (null preserva). Devolver cópia (`new Set(this.reReviewedKeys)`) e não a referência impede o chamador de mutar estado interno por acidente.
- **D4. Ordem interna do check(): a preservação tem que alimentar `mineList`/`mineKeys` ANTES do bloco `prevQueue`/`fresh` (linhas 586-588), senão a recuperação do ciclo seguinte re-notifica tudo (prevQueue teria zerado).** → Solução preparada: o diff da Tarefa 2.2 não move nenhuma linha, só troca a FONTE de `mineList`/`mineKeys` quando `mine === null`; com a fila preservada, `fresh` sai vazio de graça no ciclo de falha E no de recuperação. O teste 1 do arquivo novo trava exatamente isso (contador de `new-prs` fica em 1 através dos três ciclos).
- **D5. No B10, o `run` não é stubável depois do load: gh-queries.js faz `const { run } = require('../io')` no topo, então patch tardio em `io.run` não chega na referência já destruturada.** → Solução preparada: o teste novo `test/gh-queries-capped.test.js` requer `lib/io` e substitui `io.run` ANTES do `require('../server.js')` (aí o destructuring do gh-queries pega o fake). O runner do node isola cada arquivo de teste num processo próprio, então o patch não vaza pros outros arquivos; o comentário no topo do teste documenta a ordem obrigatória.
- **D6. Regressão silenciosa em teste vizinho: mudanças no markReRequests podem quebrar contratos que outros arquivos fixam.** → Solução preparada: verificado por grep antes de planejar, só rerequest.test.js exercita o método, a aridade não muda (segue 1 parâmetro) e nada aqui é fachada pra lib/engine (a tabela curada do review-prompt.test.js não precisa de entrada). Ainda assim, o Passo 4 de TODA tarefa roda `npm run check && npm test` completo, nunca só o arquivo da tarefa.
- **D7. Cross-platform (requisito firme):** nada nesta onda toca branch de SO (é estado em memória, timers e log). O único IO novo em teste usa `BASELINE_FILE`/`STATE_DIR` importados de `lib/paths` (path.join, portável) e `fs.rmSync(..., { recursive: true, force: true })`, que é o padrão da suite inteira. Nenhum comando de shell nos testes novos. → Solução preparada: manter os imports de caminho SEMPRE via lib/paths (nunca montar `~/.farol` na mão) e rodar a suite no Windows antes do commit (o macOS pega carona, os testes novos não têm branch de SO).
- **D8. O campo novo `this.mineKeys` não é persistido: depois de um reinício do app, um primeiro ciclo que JÁ falhe nas buscas `--review-requested` preserva um Set vazio (comportamento idêntico ao atual nesse canto).** → Solução preparada: aceito de propósito (persistir seria escopo extra sem dor real: `seen` e `baseline` já cobrem o essencial entre boots) e documentado no comentário do construtor, pra ninguém "corrigir" isso depois achando que foi esquecimento.
- **D9. O WARN do B10 pode virar ruído recorrente (um por ciclo por busca no teto), esbarrando no invariante "log só de falhas".** → Solução preparada: teto atingido É falha (de visibilidade do radar), o farol.log rotaciona em 2MB (server.js:305), e a mensagem é curta e estável (fácil de filtrar no Diagnóstico). Fica documentado no comentário do código que a alternativa (sinalizar `capped` no retorno, como fetchDeliveries) muda o shape consumido por check() e foi descartada como correção mínima.

Ordem de execução: 2.1 → 2.2 → 2.3 → 2.4 → 2.5. A 2.2 depende do contrato criado na 2.1; a 2.3 mexe no mesmo método e no mesmo arquivo de teste da 2.1, então vem depois pra não conflitar; 2.4 e 2.5 são independentes e ficam pro fim por serem menores.

---

### Tarefa 2.1: markReRequests distingue "busca falhou" (null) de "ninguém mais pedido" (Set vazio) (achados: A2, parte 1)
**Arquivos:** Modify: `server.js:677-689` (método `markReRequests`) | Test: `test/rerequest.test.js`
**Interfaces:** Produz: `markReRequests(mineKeys: Set<string> | null): Set<string>`; com `null` preserva `seen` e `reReviewedKeys` e devolve `new Set(this.reReviewedKeys)` (cópia, nunca a referência interna). Com Set (vazio ou não), comportamento idêntico ao atual. Consome: `this.reviewActions()` (inalterado).
**Dificuldades antecipadas:**
- Hoje `markReRequests(null)` lança `TypeError: mineKeys is not iterable`; o teste novo primeiro captura exatamente essa falha (é o vermelho esperado do TDD). → O guard de null entra como PRIMEIRA linha do método, antes do `reviewActions()`.
- Devolver a referência de `reReviewedKeys` deixaria o chamador (check(), que carimba `pr.reRequested`) segurando o Set interno; uma mutação futura corromperia estado. → Devolver cópia, e o teste confere o efeito observável (marcador preservado) e o rótulo devolvido.
- Alguém pode futuramente chamar com `undefined` achando que é o caso "falhou". → O comentário do método fixa: só `null` é o sinal de falha (é o que searchPRs devolve e o que check() repassa); `undefined` cairia no TypeError, alto e claro, em vez de limpar por engano.

- [ ] **Passo 1: escrever o teste que falha.** Acrescentar ao final de `test/rerequest.test.js` (idioma da suite: node:test, assert/strict, helpers `freshEngine`/`resolve` já existentes no arquivo):

```js
test('busca falhou (null) não é "saiu dos pedidos": preserva marcadores e visto', () => {
  const e = freshEngine();
  resolve(e, 'o/r#20', 'auto_approved', 'approve');
  e.seen.add('o/r#20');
  e.markReRequests(new Set(['o/r#20'])); // re-request real: marcador criado
  e.seen.add('o/r#20');                  // usuário ignora (re-marca visto)
  const reReq = e.markReRequests(null);  // ciclo seguinte: buscas --review-requested falharam
  assert.ok(e.reReviewedKeys.has('o/r#20'), 'marcador preservado (null não limpa)');
  assert.equal(e.seen.has('o/r#20'), true, 'não mexe no visto');
  assert.ok(reReq.has('o/r#20'), 'rótulo devolvido do último ciclo bom');
  // a busca volta e o PR segue pedido: o ignorar continua valendo
  e.markReRequests(new Set(['o/r#20']));
  assert.equal(e.seen.has('o/r#20'), true, 'não ressuscita depois da falha');
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/rerequest.test.js`. Esperado: os 6 testes existentes verdes e o novo vermelho com `TypeError` (iteração de `for...of` sobre null dentro de `markReRequests`).
- [ ] **Passo 3: implementação mínima.** Em `server.js`, o método fica assim (a mudança é o bloco de comentário novo e as duas primeiras linhas do corpo; o resto é o código atual das linhas 678-688 intacto):

```js
  markReRequests(mineKeys) {
    // null = as buscas --review-requested falharam NESTE ciclo: sem saber quem segue
    // pedido, preserva visto e marcadores e devolve o rótulo do último ciclo bom
    // (cópia, nunca o Set interno). Set VAZIO é outra coisa: "ninguém está mais
    // pedido", e aí limpa como sempre. Sem essa distinção, um rate limit da API de
    // search apagava reReviewedKeys e ressuscitava PRs que o usuário ignorou.
    if (mineKeys === null) return new Set(this.reReviewedKeys);
    const actions = this.reviewActions();
    const reReq = new Set();
    for (const key of mineKeys) {
      const a = actions[key];
      if (a && a.kind !== 'pending') reReq.add(key);
    }
    for (const key of reReq) {
      if (this.seen.has(key) && !this.reReviewedKeys.has(key)) { this.unsee(key); this.reReviewedKeys.add(key); }
    }
    for (const k of [...this.reReviewedKeys]) if (!reReq.has(k)) this.reReviewedKeys.delete(k);
    return reReq;
  }
```

- [ ] **Passo 4: rodar a suite inteira.** `npm run check && npm test` (na raiz do repo). Esperado: tudo verde (335 + 1).
- [ ] **Passo 5: commit.** `fix: markReRequests preserva marcadores quando a busca de pedidos falha (null)`

---

### Tarefa 2.2: check() preserva fila, "é meu" e rótulos quando só as buscas --review-requested falham (achados: A2, parte 2)
**Arquivos:** Modify: `server.js:190` (construtor, campo novo ao lado de `reReviewedKeys`) e `server.js:564-576` (check()) | Test: `test/check-resilience.test.js` (arquivo NOVO)
**Interfaces:** Produz: campo `this.mineKeys: Set<string>` (keys pedidos a mim no último ciclo BOM; não persistido, ver D8). Consome: `markReRequests(null | Set)` da Tarefa 2.1. Nenhuma assinatura pública muda.
**Dificuldades antecipadas:**
- Primeiro teste de check() da história do repo (D1). → Helper `checkEngine()` completo abaixo, com stub de `searchPRs` roteando por `extraArgs[0]` e `launchReview` que lança se chamado.
- A primeira checagem da vida marca tudo como visto (baseline silencioso, server.js:580-584) e engoliria a fila do teste. → O helper pré-grava `BASELINE_FILE` (importado de `lib/paths`) antes de qualquer ciclo.
- check() MUTA os objetos PR devolvidos pela busca (carimba `pr.mine`, `pr.reRequested`); reusar o mesmo objeto entre ciclos contaminaria as asserções. → O stub devolve cópia `{ ...p }` a cada chamada.
- `schedule()` no finally do check() criaria timer real (unref, mas não determinístico). → Stub `e.schedule = () => {}`.
- A recuperação (ciclo 3) não pode re-notificar o que já estava na fila; é o ponto que o D4 explica. → Asserção explícita: `notices.length` fica em 1 nos três ciclos do teste 1.

- [ ] **Passo 1: escrever o teste que falha.** Criar `test/check-resilience.test.js`:

```js
'use strict';
// check() resiliente a falha PARCIAL das buscas: quando só as --review-requested
// falham (ex.: rate limit da API de search), a fila, o "é meu" do panorama e os
// marcadores do último ciclo bom são preservados, como já acontece com reviewedKeys
// e myPRs. Sem isso, um ciclo ruim zerava a fila, apagava reReviewedKeys
// (ressuscitando PRs ignorados) e re-notificava tudo na recuperação.
// Runner nativo (node --test), ZERO dependências.
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-checkres-' + process.pid);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Engine } = require('../server.js');
const { BASELINE_FILE, STATE_DIR } = require('../lib/paths');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

const PR = {
  key: 'acme/app#1', url: 'https://github.com/acme/app/pull/1', title: 'PR de teste',
  author: 'alice', repo: 'acme/app', number: 1, updatedAt: '2026-08-01T10:00:00Z', account: 'me'
};

// Engine com TODO colaborador de rede/side-effect do check() stubado. O roteiro
// (e.scenario) diz o que cada busca devolve no ciclo corrente; null = busca falhou.
function checkEngine() {
  const e = new Engine();
  e.config.accounts = [{ user: 'me', owners: ['acme'] }];
  e.config.autoReview = false; // nunca dispara revisão headless em teste
  e.seen = new Set();
  e.reReviewedKeys = new Set();
  e.decisions = { pending: [], resolved: [] };
  e.queue = [];
  e.resolveAccount = async () => {};
  e.refreshTokens = async () => { e.tokenOk = true; return true; };
  e.myAuthoredPRs = async () => [];
  e.enrichMyPRBranches = async () => {};
  e.refreshMergeStates = async () => {};
  e.refreshStaleStates = async () => {};
  e.scanPushbacks = async () => {};
  e.checkUpdate = async () => {};
  e.launchReview = () => { throw new Error('launchReview não deveria rodar neste teste'); };
  e.schedule = () => {};
  e.saveSeen = () => {}; // seen em memória basta pro cenário
  e.scenario = { panorama: [], mine: [], reviewed: [] };
  e.searchPRs = async (extraArgs) => {
    const lista = extraArgs[0] === '--owner' ? e.scenario.panorama
      : extraArgs[0] === '--review-requested=@me' ? e.scenario.mine
        : e.scenario.reviewed;
    return lista === null ? null : lista.map(p => ({ ...p })); // check() muta os PRs
  };
  // baseline já existente: a 1ª checagem da vida não pode engolir a fila do teste
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(BASELINE_FILE, new Date().toISOString() + '\n');
  e.notices = [];
  e.on('new-prs', ev => e.notices.push(ev));
  return e;
}

test('falha só das --review-requested preserva fila e "é meu", sem re-notificar', async () => {
  const e = checkEngine();
  // ciclo 1: tudo ok, o PR pedido a mim entra na fila e notifica UMA vez
  e.scenario = { panorama: [PR], mine: [PR], reviewed: [] };
  await e.check('test');
  assert.equal(e.queue.length, 1);
  assert.equal(e.notices.length, 1, 'notificou o PR novo uma vez');
  // ciclo 2: rate limit derruba só as buscas --review-requested
  e.scenario = { panorama: [PR], mine: null, reviewed: [] };
  await e.check('test');
  assert.equal(e.queue.length, 1, 'fila preservada do último ciclo bom');
  assert.equal(e.panorama.find(p => p.key === PR.key).mine, true, 'o "é meu" não some do panorama');
  assert.equal(e.notices.length, 1, 'ciclo com falha não notifica');
  assert.equal(e.lastError, null, 'falha parcial não é erro fatal do ciclo');
  // ciclo 3: a busca volta; nada é "novo" de novo
  e.scenario = { panorama: [PR], mine: [PR], reviewed: [] };
  await e.check('test');
  assert.equal(e.queue.length, 1);
  assert.equal(e.notices.length, 1, 'recuperação não re-notifica o que já estava na fila');
});

test('PR ignorado não ressuscita depois de um ciclo com busca falha', async () => {
  const e = checkEngine();
  // histórico local: já revisei este PR faz tempo (fora de qualquer carência)
  e.decisions.resolved.unshift({ key: PR.key, status: 'auto_approved', action: 'approve', resolvedAt: Date.now() - 60 * 60 * 1000 });
  e.seen.add(PR.key);
  // ciclo 1: re-request real detectado, volta pra fila
  e.scenario = { panorama: [PR], mine: [PR], reviewed: [] };
  await e.check('test');
  assert.equal(e.seen.has(PR.key), false, 're-request des-marca o visto');
  assert.ok(e.reReviewedKeys.has(PR.key));
  // usuário ignora (re-marca visto)
  e.seen.add(PR.key);
  // ciclo 2: a falha das buscas --review-requested não pode apagar o marcador
  e.scenario = { panorama: [PR], mine: null, reviewed: [] };
  await e.check('test');
  assert.ok(e.reReviewedKeys.has(PR.key), 'marcador sobrevive à falha da busca');
  // ciclo 3: busca volta e o PR segue pedido; o ignorar fica valendo
  e.scenario = { panorama: [PR], mine: [PR], reviewed: [] };
  await e.check('test');
  assert.equal(e.seen.has(PR.key), true, 'o ignorar do usuário fica valendo');
  assert.equal(e.queue.length, 0, 'não volta pra fila sozinho');
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/check-resilience.test.js`. Esperado: teste 1 vermelho em "fila preservada do último ciclo bom" (`0 !== 1`, a fila zera no ciclo 2 com o código atual) e teste 2 vermelho em "marcador sobrevive à falha da busca" (reReviewedKeys apagado pelo `markReRequests(Set vazio)` atual, que a Tarefa 2.1 ainda não é chamada com null pelo check()).
- [ ] **Passo 3: implementação mínima.** Duas edições em `server.js`. No construtor, logo abaixo de `this.reReviewedKeys = new Set();` (linha 190):

```js
    this.reReviewedKeys = new Set(); // re-requests que ja voltaram pra fila (evita re-surgir todo ciclo)
    // keys pedidos a mim no último ciclo BOM: preserva fila e "é meu" quando as buscas
    // --review-requested falham (falha parcial não zera o radar). De propósito NÃO é
    // persistido: após reinício, um 1º ciclo já com falha preserva um Set vazio, igual
    // ao comportamento antigo nesse canto (seen e baseline cobrem o essencial entre boots).
    this.mineKeys = new Set();
```

No `check()`, as linhas 564-565 e 574 (o resto do bloco fica intacto, inclusive `prevQueue`/`fresh`):

```js
      // falha só das --review-requested (ex.: rate limit da API de search): preserva
      // fila, "é meu" e marcadores do último ciclo bom, no MESMO padrão de reviewedKeys
      // e myPRs logo acima. Zerar aqui apagava reReviewedKeys (markReRequests com Set
      // vazio) e ressuscitava PRs que o usuário ignorou, re-notificando tudo na volta.
      const mineFailed = mine === null;
      const mineList = mineFailed ? [...this.queue] : mine;
      const mineKeys = mineFailed ? this.mineKeys : new Set(mineList.map(p => p.key));
      if (!mineFailed) this.mineKeys = mineKeys;
      for (const pr of panorama) pr.mine = mineKeys.has(pr.key);
      for (const pr of mineList) {
        if (!seenKeys.has(pr.key)) { pr.mine = true; panorama.push(pr); }
      }
      // re-request de review: fui pedido de novo (mine) num PR que EU já revisei
      // (reviewedByMe). No fluxo normal, revisar te tira dos pedidos; voltar aos pedidos
      // = o autor re-solicitou (a review antiga vira DISMISSED no GitHub). markReRequests
      // des-marca esses como "visto" pra voltarem à fila (acionáveis de novo).
      const reReq = this.markReRequests(mineFailed ? null : mineKeys);
```

- [ ] **Passo 4: rodar a suite inteira.** `npm run check && npm test`. Esperado: tudo verde, incluindo os 7 do rerequest.test.js e os 2 novos.
- [ ] **Passo 5: commit.** `fix: check() preserva fila e reReviewedKeys quando so as buscas de pedidos falham`

---

### Tarefa 2.3: carência anti-lag do índice de busca no markReRequests (achados: M1)
**Arquivos:** Modify: `server.js` (const nova `REREQ_GRACE_MS` no escopo de módulo, logo após o bloco `DEFAULTS` que termina na linha 118, e o loop do `markReRequests`, linhas 680-683 atuais) | Test: `test/rerequest.test.js` (helper `resolve` + 3 casos novos)
**Interfaces:** Produz: `const REREQ_GRACE_MS = 10 * 60 * 1000` (módulo server.js). Consome: `reviewActions()[key].at` (o `resolvedAt` da decisão, já existente em lib/engine/decision.js:56-58). Assinatura de `markReRequests` inalterada.
**Dificuldades antecipadas:**
- A MAIOR: o helper `resolve()` do rerequest.test.js usa `resolvedAt: Date.now()`; com a carência, os 6 testes existentes + o da Tarefa 2.1 virariam decisões "recém-postadas" e falhariam em bloco. → No mesmo commit, o default do helper vira uma hora atrás (caso normal: re-request acontece bem depois do meu review) com 5º parâmetro `at` opcional. Fazer ISSO PRIMEIRO no Passo 1, antes de rodar qualquer coisa.
- Registro legado em decisions.json sem `resolvedAt` (`a.at` undefined) não pode ficar preso na carência pra sempre. → Fail-open: `a.at && ...` só aplica carência quando há carimbo; teste dedicado cobre.
- Re-request REAL feito dentro da janela é atrasado. → Trade-off aceito e limitado: atraso máximo = carência + 1 intervalo de polling (10 min + 300 s por default); o comentário no código deixa isso explícito pra ninguém tratar como bug depois.
- Interação com o loop de limpeza do marcador: durante o eco (carência ativa), a key sai de `reReq` e um marcador existente seria limpo. Analisado: o marcador só existe quando o re-request ANTERIOR já voltou à fila; se acabei de postar review de novo (a.at fresco), o ciclo daquele re-request terminou e limpar é correto (um NOVO pedido que persista após a carência recria o marcador pelo caminho normal). O teste do ciclo completo da Tarefa 2.1 continua verde, provando que o contrato do ignorar não regride.
- O teste 2 da Tarefa 2.2 já usa `resolvedAt: Date.now() - 60 * 60 * 1000`, escolhido de propósito pra ser imune a esta tarefa (ordem 2.2 → 2.3 não quebra nada).

- [ ] **Passo 1: escrever o teste que falha.** Em `test/rerequest.test.js`, substituir o helper `resolve` (linhas 26-29) por:

```js
// simula uma decisão já resolvida (aprovado/reprovado/comentado, ou pulada).
// `at` default = 1h atrás: FORA da carência anti-lag, que é o caso normal de
// re-request (o autor re-pede bem depois do meu review). Os casos da carência
// passam timestamps explícitos.
function resolve(e, key, status, action, at = Date.now() - 60 * 60 * 1000) {
  e.decisions.resolved.unshift({ key, status, action, resolvedAt: at });
}
```

E acrescentar ao final do arquivo:

```js
test('carência anti-lag: review postado AGORA ainda ecoa nos pedidos, não é re-request', () => {
  const e = freshEngine();
  resolve(e, 'o/r#50', 'auto_approved', 'approve', Date.now()); // acabei de postar (auto-approve)
  e.seen.add('o/r#50');
  const reReq = e.markReRequests(new Set(['o/r#50'])); // índice de busca atrasado ainda lista o PR
  assert.equal(reReq.has('o/r#50'), false, 'eco do índice não vira re-request');
  assert.equal(e.seen.has('o/r#50'), true, 'não des-marca o visto (não relança revisão)');
  assert.equal(e.reReviewedKeys.has('o/r#50'), false, 'não cria marcador');
});

test('carência vencida: pedido que persiste vira re-request de verdade', () => {
  const e = freshEngine();
  resolve(e, 'o/r#51', 'auto_approved', 'approve', Date.now() - 11 * 60 * 1000);
  e.seen.add('o/r#51');
  const reReq = e.markReRequests(new Set(['o/r#51']));
  assert.ok(reReq.has('o/r#51'), 'depois da carência é re-request');
  assert.equal(e.seen.has('o/r#51'), false, 'volta pra fila');
});

test('registro legado sem horário não fica preso na carência (comporta como antes)', () => {
  const e = freshEngine();
  e.decisions.resolved.unshift({ key: 'o/r#52', status: 'posted', action: 'approve' }); // sem resolvedAt
  e.seen.add('o/r#52');
  const reReq = e.markReRequests(new Set(['o/r#52']));
  assert.ok(reReq.has('o/r#52'), 'sem carimbo, o sinal de pedido vale como sempre valeu');
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/rerequest.test.js`. Esperado: os testes antigos e os das Tarefas 2.1/2.2 verdes (o helper novo não muda a semântica deles) e o teste "carência anti-lag" vermelho em "eco do índice não vira re-request" (`true !== false`, hoje não existe carência). Os outros dois novos já nascem verdes (documentam o comportamento nas bordas).
- [ ] **Passo 3: implementação mínima.** Em `server.js`, no escopo de módulo (logo após o fechamento do objeto `DEFAULTS`, linha 118):

```js
// carência anti-lag do índice de busca do GitHub: logo após EU postar um review, o PR
// ainda ecoa em --review-requested por alguns minutos (a busca é indexação assíncrona).
// Nesse eco, "está pedido" não é o autor re-solicitando, é atraso do índice; sem a
// carência, todo auto-approve virava um segundo review headless completo. Custo do
// trade-off: um re-request REAL feito dentro da janela entra com atraso máximo de
// carência + 1 intervalo de polling.
const REREQ_GRACE_MS = 10 * 60 * 1000;
```

E no `markReRequests`, o primeiro loop vira:

```js
    const actions = this.reviewActions();
    const reReq = new Set();
    const now = Date.now();
    for (const key of mineKeys) {
      const a = actions[key];
      if (!a || a.kind === 'pending') continue;
      // eco do índice: review MEU recém-postado ainda aparece nos pedidos; não é
      // re-request (ver REREQ_GRACE_MS). Sem carimbo (registro legado), vale o sinal.
      if (a.at && (now - a.at) < REREQ_GRACE_MS) continue;
      reReq.add(key);
    }
```

- [ ] **Passo 4: rodar a suite inteira.** `npm run check && npm test`. Atenção redobrada em `test/check-resilience.test.js` (usa timestamp de 1h atrás, deve seguir verde) e em `test/session-unsee-on-exit.test.js` (não usa markReRequests, mas mexe em seen; deve seguir verde).
- [ ] **Passo 5: commit.** `fix: carencia anti-lag no markReRequests evita re-review espurio pos-approve`

---

### Tarefa 2.4: intervalSeconds clampado no boot (achados: M2)
**Arquivos:** Modify: `server.js:134-138` (bloco de saneamento do construtor, acrescentar 1 linha após `reviewEffort`) | Test: `test/boot.test.js`
**Interfaces:** nenhuma assinatura nova; o construtor passa a garantir `60 <= config.intervalSeconds <= 3600`, a MESMA expressão do `updateSettings` (server.js:952), pras duas portas de entrada ficarem idênticas.
**Dificuldades antecipadas:**
- `DEFAULTS` não é exportado; o teste não pode importá-lo. → Comparar contra literais (300, 60, 3600), como o boot.test.js já faz com `port` 47170.
- Escrever config.json de teste contamina os outros testes do MESMO arquivo (todos compartilham o FAROL_HOME do processo). → Seguir o padrão salva/restaura com try/finally já usado nos testes de reviewModel/reviewEffort do próprio arquivo (linhas 44-74).
- Tentação de "corrigir também" o `schedule()` (linha 654) com clamp próprio. → Não fazer: com boot e updateSettings clampando, não sobra rota de entrada pro NaN; mexer no schedule seria refactor além do necessário (regra da correção mínima). Se um dia surgir rota nova, o teste de boot pega no clamp de origem.

- [ ] **Passo 1: escrever o teste que falha.** Acrescentar a `test/boot.test.js`, depois do teste "config.json com reviewModel/reviewEffort válido é preservado no boot":

```js
test('config.json com intervalSeconds inválido é clampado no BOOT (updateSettings já clampava)', () => {
  // NaN aqui virava setTimeout(fn, NaN) no schedule(): polling de ~1ms contra o
  // GitHub até esgotar o rate limit. O clamp do boot usa a MESMA expressão do
  // caminho HTTP (updateSettings), pras duas portas de entrada serem idênticas.
  fs.mkdirSync(HOME, { recursive: true });
  const arq = path.join(HOME, 'config.json');
  const antes = fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8') : null;
  try {
    fs.writeFileSync(arq, JSON.stringify({ intervalSeconds: 'trezentos' }));
    assert.equal(new Engine().config.intervalSeconds, 300, 'não numérico cai no default');
    fs.writeFileSync(arq, JSON.stringify({ intervalSeconds: 5 }));
    assert.equal(new Engine().config.intervalSeconds, 60, 'piso de 60s');
    fs.writeFileSync(arq, JSON.stringify({ intervalSeconds: 999999 }));
    assert.equal(new Engine().config.intervalSeconds, 3600, 'teto de 1h');
    fs.writeFileSync(arq, JSON.stringify({ intervalSeconds: 600 }));
    assert.equal(new Engine().config.intervalSeconds, 600, 'valor válido é preservado');
  } finally {
    if (antes === null) { try { fs.unlinkSync(arq); } catch { /* best-effort */ } }
    else fs.writeFileSync(arq, antes);
  }
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/boot.test.js`. Esperado: vermelho na primeira asserção (`'trezentos' !== 300`, o boot atual passa o valor cru adiante).
- [ ] **Passo 3: implementação mínima.** Em `server.js`, logo após a linha 138 (`this.config.reviewEffort = ...`):

```js
    this.config.reviewModel = sanitizeModel(this.config.reviewModel) ?? '';
    this.config.reviewEffort = sanitizeEffort(this.config.reviewEffort) ?? '';
    // intervalo do polling: o caminho HTTP (updateSettings) já clampa em 60..3600, mas
    // o boot engolia config.json editado à mão. Não numérico virava Math.max(60, NaN)
    // = NaN no schedule(), e setTimeout(fn, NaN) dispara em ~1ms: polling contínuo
    // contra o GitHub até o rate limit. Mesma expressão do updateSettings, de propósito.
    this.config.intervalSeconds = Math.min(3600, Math.max(60, parseInt(this.config.intervalSeconds, 10) || DEFAULTS.intervalSeconds));
```

- [ ] **Passo 4: rodar a suite inteira.** `npm run check && npm test`. Esperado: tudo verde (o smoke de boot existente usa config vazio, que dá 300 e passa pelo clamp sem mudar).
- [ ] **Passo 5: commit.** `fix: clampa intervalSeconds no boot (NaN virava polling de ~1ms)`

---

### Tarefa 2.5: searchPRs sinaliza truncamento no teto do --limit 100 (achados: B10)
**Arquivos:** Modify: `lib/engine/gh-queries.js:17` (logo após o `JSON.parse` do `searchPRs`) | Test: `test/gh-queries-capped.test.js` (arquivo NOVO)
**Interfaces:** retorno de `searchPRs` INALTERADO (array | null); o sinal é um `engine.log('WARN', ...)`. Consome: `engine.log` (já existente). O shape com `capped` (padrão do fetchDeliveries) foi considerado e descartado: mudaria o contrato consumido por check() em 4 pontos e pela UI, além da correção mínima pra um achado de severidade baixa.
**Dificuldades antecipadas:**
- `run` é destruturado no topo do gh-queries no LOAD do módulo; stub tardio não chega (D5). → O teste patcheia `io.run` ANTES do `require('../server.js')`; o runner isola cada arquivo num processo, sem vazamento.
- O check no teto tem que medir os itens CRUS (antes dos filtros de draft/autor), porque o corte do gh aconteceu antes de qualquer filtro nosso. → O log entra imediatamente após o `JSON.parse`, antes do `.filter`.
- Ruído recorrente no log (D9). → Mensagem curta, estável e com a busca identificada (conta + extraArgs), pro Diagnóstico agrupar; rotação de 2MB do farol.log segura o volume.

- [ ] **Passo 1: escrever o teste que falha.** Criar `test/gh-queries-capped.test.js`:

```js
'use strict';
// searchPRs no teto do --limit 100: o gh corta em silêncio e, com best-match como
// ordenação, QUAIS 100 entram é imprevisível (PR pedido a mim pode ficar de fora
// sem nenhum sinal). fetchDeliveries no mesmo arquivo já trata o caso (capped);
// aqui trava o análogo do searchPRs: WARN no log quando o teto é atingido.
// ATENÇÃO à ordem: gh-queries destrutura io.run no LOAD, então o patch de io.run
// precisa vir ANTES do require do server (o runner isola cada arquivo num processo).
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-ghcap-' + process.pid);

const io = require('../lib/io');
let ghStdout = '[]';
io.run = async () => ({ ok: true, code: 0, stdout: ghStdout, stderr: '' });

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Engine } = require('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

function itens(n) {
  return JSON.stringify(Array.from({ length: n }, (_, i) => ({
    url: `https://github.com/acme/app/pull/${i + 1}`, title: `PR ${i + 1}`, isDraft: false,
    author: { login: 'alice' }, number: i + 1,
    repository: { nameWithOwner: 'acme/app' }, updatedAt: '2026-08-01T10:00:00Z'
  })));
}

test('searchPRs no teto de 100 loga WARN de resultado truncado', async () => {
  const e = new Engine();
  const logs = [];
  e.log = (level, msg) => logs.push({ level, msg });
  ghStdout = itens(100);
  const list = await e.searchPRs(['--owner', 'acme'], 'me');
  assert.equal(list.length, 100, 'a lista em si segue vindo inteira');
  const warn = logs.find(l => l.level === 'WARN' && /teto do --limit/.test(l.msg));
  assert.ok(warn, 'avisa que o radar pode estar incompleto');
  assert.match(warn.msg, /--owner acme/, 'o log diz QUAL busca truncou');
});

test('abaixo do teto não loga nada (log é só de falhas)', async () => {
  const e = new Engine();
  const logs = [];
  e.log = (level, msg) => logs.push({ level, msg });
  ghStdout = itens(99);
  const list = await e.searchPRs(['--owner', 'acme'], 'me');
  assert.equal(list.length, 99);
  assert.equal(logs.length, 0, 'nenhum ruído no log');
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/gh-queries-capped.test.js`. Esperado: vermelho em "avisa que o radar pode estar incompleto" (warn undefined, hoje nada é logado); o segundo teste já nasce verde (protege contra um WARN sempre ligado).
- [ ] **Passo 3: implementação mínima.** Em `lib/engine/gh-queries.js`, dentro de `searchPRs`, logo após o parse (linha 17):

```js
  let items;
  try { items = JSON.parse(r.stdout || '[]'); } catch { return null; }
  // o gh corta no --limit sem avisar e, com best-match como ordenação, QUAIS 100
  // entram é imprevisível: um PR pedido a mim pode ficar fora do radar em silêncio.
  // O teto é da API de search (não dá pra subir), então pelo menos deixa rastro.
  // Medido nos itens CRUS (antes dos filtros): o corte aconteceu no gh, não aqui.
  // fetchDeliveries abaixo sinaliza o análogo no retorno (capped); aqui o retorno
  // fica intacto (4 chamadores no check()) e o sinal vai pro log.
  if (items.length >= 100) {
    engine.log('WARN', `gh search no teto do --limit 100 (${user || 'primaria'}: ${extraArgs.join(' ')}): pode haver PRs fora do radar`);
  }
  const acc = user || engine.primaryUser();
```

- [ ] **Passo 4: rodar a suite inteira.** `npm run check && npm test`. Esperado: tudo verde; conferir que `test/chat-tools-queries.test.js` (que também exercita gh-queries, sem patch de run) segue verde.
- [ ] **Passo 5: commit.** `fix: searchPRs loga WARN quando o resultado bate o teto de 100 do gh`

---

## Fechamento da onda

- Rodar `npm run check && npm test` uma última vez com as 5 tarefas integradas.
- Conferir no `git log` que são 5 commits `fix:` sem trailer de co-autoria.
- NÃO bumpar versão nem publicar release nesta onda (o bump é decisão do plano geral, na consolidação das ondas; regra do projeto: a referência é a última release publicada).
- Registrar no relatório geral: A2, M1, M2 e B10 corrigidos com teste; o contrato "o ignorar do usuário fica valendo" agora coberto também no nível do check() (test/check-resilience.test.js), que era o buraco que a suite tinha.
