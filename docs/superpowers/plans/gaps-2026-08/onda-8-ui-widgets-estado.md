# Onda 8: UI, widgets de operação e estado

**Achados cobertos:** M19, M22, B11, B13, B14, B15, B16, B17

**Nota de reconciliação:** o caminho do relatório de 52 gaps chegou indefinido no encadeamento desta onda e o arquivo com os códigos não foi localizado em disco. Cada achado abaixo foi reverificado direto contra o código real (`ui/app.js` de 3016 linhas, v2.30.1) com os números de linha atuais; todos os 8 se confirmam no fonte. Se o relatório aparecer antes da execução, reconciliar os códigos, mas o plano não depende dele.

**Dificuldades antecipadas da onda** (a parte MAIS importante do plano; o objetivo do usuário é ter a solução pronta antes do impedimento aparecer):

- **D1. ui/app.js tem ZERO teste e não pode ganhar DOM de teste (invariante 1 do CLAUDE.md: zero dependências, então jsdom está fora)** → Solução preparada: três pistas de verificação, e cada tarefa declara a sua explicitamente. Pista A: extrair a decisão pra função pura em `ui/pure.js` e testar com `node --test` (idioma do `test/ui-pure.test.js`). Pista B: invariante estática no TEXTO do `ui/app.js` lido por `fs.readFileSync`, idioma já estabelecido pelo `test/ui-semantics.test.js` (que lê `APPJS` e afirma regex). Pista C: verificação manual roteirizada com instância isolada (roteiro exato de cliques e resultado esperado dentro da tarefa). Todos os testes novos desta onda vivem num arquivo só, `test/ui-widgets.test.js`, montado cumulativamente tarefa a tarefa.
- **D2. O sistema de ops é transversal: showOp/closeOp têm 8 pontos de uso (sys-polling:1280/1290/1297, load-deliveries:1228/1231, chat:1444/1455, kudos:2844/2846-2847, health:2852/2854-2855, update-check:2863/2865, cancelamento por clique:214) e mudar a semântica de dismiss afeta todos** → Solução preparada: inventário acima já levantado; nenhum chamador depende de pill imortal (o erro de kudos:2847 também vai em toast, nada de informação se perde quando a pill de erro passa a expirar em 6s). A tarefa 8.1 muda o núcleo UMA vez e as tarefas seguintes só consomem; o roteiro manual da 8.2 revalida o ciclo completo running→done e running→error.
- **D3. Timer velho de um opId reutilizado pode apagar a op NOVA do Map (closeOp agenda setTimeout, showOp recria com o mesmo id, o timeout antigo dispara e deleta)** → Solução preparada: o timeout só deleta quando `ACTIVE_OPS.get(opId) === op` (comparação por identidade do objeto), já embutido no código da tarefa 8.1; sem isso, o fix do M22 criaria um bug novo de corrida.
- **D4. Risco de regressão nos testes existentes: `test/ui-semantics.test.js` varre o APPJS inteiro (svg sem aria-hidden, aria-selected) e `npm run check` roda `node --check` no ui/app.js** → Solução preparada: nenhuma tarefa introduz `<svg>` novo nem mexe em classe/aria de aba; todo passo 4 roda `npm run check && npm test` completo, então quebra de sintaxe ou de invariante existente morre na própria tarefa, não no fim da onda.
- **D5. Verificação manual precisa de instância segura (testar com conta real e autoReview ligado pode postar APPROVE de verdade, proibição do CLAUDE.md)** → Solução preparada: preparação comum dos roteiros, feita UMA vez:
  ```powershell
  # instância isolada (Windows PowerShell)
  $env:FAROL_HOME = "$env:TEMP\farol-onda8"
  New-Item -ItemType Directory -Force $env:FAROL_HOME | Out-Null
  '{"autoReview": false}' | Set-Content "$env:FAROL_HOME\config.json"
  # stub headless LENTO (segura a sessão 20s pra dar tempo de observar os widgets)
  "@echo off`r`ntimeout /t 20 /nobreak >nul`r`necho {`"result`": `"ok`"}" | Set-Content "$env:TEMP\farol-stub.cmd" -Encoding ascii
  $env:FAROL_HEADLESS_CMD = "$env:TEMP\farol-stub.cmd"
  node server.js
  # navegador em http://127.0.0.1:47170
  ```
  No macOS o stub é `/tmp/farol-stub.sh` com `#!/bin/sh`, `sleep 20; echo '{"result": "ok"}'` e `chmod +x`. O `ACTIVE_OPS` é global de script clássico (não módulo), então o console do DevTools consegue inspecionar `ACTIVE_OPS.size` e `document.querySelectorAll('.op-inline-pill').length`, que são os dois medidores usados nos roteiros.
- **D6. Cross-platform (requisito firme):** nenhuma correção desta onda tem branch de SO (é DOM e JS puro), mas os roteiros manuais têm comandos por SO → Solução preparada: cada roteiro traz a variação Windows (.cmd, `timeout /t`) e macOS (sh, `sleep`), como acima; nada entra em `IS_WIN`/`IS_MAC`.
- **D7. Estado persistido legado no navegador:** `farol-scope` pode carregar login órfão de conta removida/renomeada há meses (B15), e o fix não pode apagar escolha válida no boot (primeiro snapshot pode vir sem contas) → Solução preparada: validação só quando a lista de contas do snapshot está presente (`list.length > 0`), travada por teste estático; nenhuma chave nova de localStorage é criada, então não há migração.
- **D8. Sobreposição com o débito da Onda 4 (ui/app.js sem nenhum teste):** esta onda cria o primeiro arquivo de teste dedicado aos widgets (`test/ui-widgets.test.js`) e move 6 decisões pra `ui/pure.js` → Solução preparada: seguir a REGRA do cabeçalho do pure.js (só entra o que não toca DOM nem lê global; o que precisa de estado entra por parâmetro). Atualizar o `docs/QUALITY.md` não é escopo desta onda; deixar anotado no PR.

---

## Ordem de execução

1. 8.1 (M22): máquina de estados do ciclo de vida das ops. É a fundação; 8.2 e 8.7 dependem dela.
2. 8.2 (B11): sys-polling ancorado em elemento real e destravando após erro.
3. 8.3 (M19): token de requisição no loadDeliveries.
4. 8.4 (B13): rótulo de estágio com ticker próprio.
5. 8.5 (B15): SCOPE persistido validado contra as contas reais.
6. 8.6 (B14): allowlist de abas pra barra de contas.
7. 8.7 (B16): chat-activity via updateOp e closeChat encerrando a op.
8. 8.8 (B17): marcadores de sessão de merge expirando no refresh.

---

### Tarefa 8.1: Ciclo de vida das ops vira máquina de estados pura (achados: M22)

**Arquivos:** Modify: `ui/pure.js` (nova seção após `usageDayKeysBack`, linha ~121; rodapé de exports linhas 228-235) e `ui/app.js:109-135` (showOp), `ui/app.js:150-162` (closeOp) | Test: `test/ui-widgets.test.js` (arquivo novo)

**Interfaces:** Produz: `opTransition(atual, proximo) -> string` (devolve o próximo status se a transição running→done|error|cancelled for válida, senão devolve o atual) e `opDismissDelay(status) -> number|null` (null = não some sozinho; done = 3000; error/cancelled = 6000). Consumidas por `closeOp` no app.js. `updateOp` (linha 137) NÃO muda: nenhum chamador hoje passa `status` pelo update (verificado: renderChat e o novo handler só passam step/progress), então roteá-lo pela máquina fica fora da correção mínima.

**Dificuldades antecipadas:**
- Risco: closeOp é chamado com op inexistente a cada snapshot ok (`closeOp('sys-polling', 'done', ...)` em renderStatus:1297) → Solução preparada: preservar o retorno cedo `if (!op) return;` exatamente como está.
- Risco: timer velho deletando op nova de id reutilizado (detalhe D3 da onda) → Solução preparada: guarda de identidade `ACTIVE_OPS.get(opId) === op` dentro do setTimeout, já no código do passo 3.
- Risco: teste estático frágil a reformatação → Solução preparada: regex ancorada em `function closeOp(` até a primeira `}` na coluna 0 (o mesmo truque do ui-semantics.test.js) e exigindo só o NOME da função pura, não formatação.
- Risco: esquecer uma das duas pontas do pure.js (declaração global pro navegador OU export CommonJS pro node) → Solução preparada: as duas no mesmo diff; se o export faltar, o teste do passo 1 falha com `P.opTransition is not a function`, que é inconfundível.

- [ ] **Passo 1: escrever o teste que falha** (`test/ui-widgets.test.js`, arquivo novo completo)
  ```js
  'use strict';
  // Onda 8: widgets de operacao (showOp/updateOp/closeOp) e estado da UI.
  //
  // O ciclo de vida de uma operacao virou maquina de estados PURA (ui/pure.js):
  // running -> done|error|cancelled, e cada estado terminal tem prazo de auto-dismiss.
  // O DOM (ui/app.js) so consome. O que nao da pra testar sem DOM fica travado por
  // invariante estatica no texto do app.js, no idioma do ui-semantics.test.js.
  const path = require('node:path');
  const fs = require('node:fs');
  const { test } = require('node:test');
  const assert = require('node:assert/strict');
  const P = require(path.join(__dirname, '..', 'ui', 'pure.js'));
  const APPJS = fs.readFileSync(path.join(__dirname, '..', 'ui', 'app.js'), 'utf8');
  const HTML = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');

  /* ---------- maquina de estados das operacoes (M22) ---------- */

  test('opTransition: running anda pra qualquer terminal', () => {
    assert.equal(P.opTransition('running', 'done'), 'done');
    assert.equal(P.opTransition('running', 'error'), 'error');
    assert.equal(P.opTransition('running', 'cancelled'), 'cancelled');
  });

  test('opTransition: estado terminal nao vira outro terminal nem volta a running', () => {
    assert.equal(P.opTransition('done', 'error'), 'done');
    assert.equal(P.opTransition('error', 'done'), 'error');
    assert.equal(P.opTransition('cancelled', 'running'), 'cancelled');
  });

  test('opTransition: destino desconhecido nao anda', () => {
    assert.equal(P.opTransition('running', 'sumiu'), 'running');
  });

  test('opDismissDelay: running nao some sozinho, todo terminal SEMPRE some', () => {
    // pill de erro imortal era o M22: acumulava uma por tentativa
    assert.equal(P.opDismissDelay('running'), null);
    assert.equal(P.opDismissDelay('done'), 3000);
    assert.equal(P.opDismissDelay('error'), 6000);
    assert.equal(P.opDismissDelay('cancelled'), 6000);
  });

  test('closeOp agenda o dismiss pela maquina, nao so no done (M22)', () => {
    const fn = APPJS.match(/function closeOp\([\s\S]*?\n\}/);
    assert.ok(fn, 'closeOp existe');
    assert.match(fn[0], /opDismissDelay\(/, 'o prazo de sumir vem da funcao pura');
    assert.match(fn[0], /opTransition\(/, 'a transicao de status passa pela maquina');
    assert.doesNotMatch(fn[0], /result === 'done'\) \{\s*setTimeout/,
      'error e cancelled tambem expiram, nao so done');
  });

  test('showOp remove a pill anterior antes de recriar com o mesmo id (M22)', () => {
    const fn = APPJS.match(/function showOp\([\s\S]*?\n\}/);
    assert.ok(fn, 'showOp existe');
    assert.match(fn[0], /const prev = ACTIVE_OPS\.get\(opId\)/, 'consulta a operacao anterior');
    assert.match(fn[0], /prev\.element\.remove\(\)/, 'a pill velha sai do DOM antes da nova entrar');
  });
  ```
- [ ] **Passo 2: rodar e ver falhar** com `node --test test/ui-widgets.test.js`. Esperado: os 4 testes de `opTransition`/`opDismissDelay` falham com `TypeError: P.opTransition is not a function` (a função ainda não existe no pure.js) e os 2 estáticos falham no `assert.match` (o closeOp atual não cita `opDismissDelay` e o showOp não tem `const prev`).
- [ ] **Passo 3: implementação mínima**. Em `ui/pure.js`, nova seção logo depois de `usageDayKeysBack` (antes do bloco "dependem das folhas"):
  ```js
  /* ---------- ciclo de vida das operacoes (widgets showOp/updateOp/closeOp da UI) ---------- */

  // Maquina de estados minima: 'running' e o unico estado que anda; done/error/cancelled
  // sao terminais (nao viram um ao outro nem voltam a running: quem quer "de novo"
  // cria outra operacao). O DOM do app.js so consome estas duas decisoes.
  function opTransition(atual, proximo) {
    if (atual === 'running' && (proximo === 'done' || proximo === 'error' || proximo === 'cancelled')) return proximo;
    return atual;
  }

  // prazo de auto-dismiss por estado: running nao some sozinho; done some rapido;
  // erro e cancelamento ficam mais tempo na tela pra dar tempo de ler, mas SEMPRE
  // somem (pill de erro imortal acumulava uma por tentativa, o M22).
  function opDismissDelay(status) {
    if (status === 'running') return null;
    if (status === 'done') return 3000;
    return 6000;
  }
  ```
  E no rodapé CommonJS do pure.js, acrescentar os dois nomes ao objeto exportado:
  ```js
    module.exports = {
      esc, fmtClock, fmtTok, fmtCompact, sysNorm, ownerFromUrl, repoShort, stripFence, hexToRgba,
      sameSet, diffVs, lastMerge, groupBy, usageMetricVal, accountSaveArray, delivGroupCard, fmtRel,
      usageDayKeysBack, avatar, md, feedLine, delivPrRow, delivPrRowInRepo, delivRepoSubgroups,
      deliveriesByRepo, deliveriesByAuthor, opTransition, opDismissDelay
    };
  ```
  Em `ui/app.js`, o começo do `showOp` (linha 109) ganha a remoção da pill órfã:
  ```js
  function showOp(opId, opts) {
    opts = opts || {};
    // reuso do mesmo opId nao pode orfanar a pill anterior no DOM (M22): a entrada
    // do Map era substituida e o elemento velho ficava pra sempre sem referencia
    const prev = ACTIVE_OPS.get(opId);
    if (prev && prev.element) prev.element.remove();
    const op = {
      id: opId,
  ```
  (o restante do showOp fica como está). E o `closeOp` (linhas 150-162) vira:
  ```js
  function closeOp(opId, result = 'done', message = '') {
    const op = ACTIVE_OPS.get(opId);
    if (!op) return;
    op.status = opTransition(op.status, result);  // running -> done | error | cancelled
    op.message = message;
    updateOpDisplay(opId);
    const delay = opDismissDelay(op.status);
    if (delay !== null) {
      setTimeout(() => {
        if (op.element) op.element.remove();
        // so deleta se a entrada ainda for ESTA op: um showOp com o mesmo id pode
        // ter recriado a operacao, e o timer velho nao pode apagar a nova
        if (ACTIVE_OPS.get(opId) === op) ACTIVE_OPS.delete(opId);
      }, delay);
    }
  }
  ```
- [ ] **Passo 4: rodar a suite inteira**: `npm run check && npm test`. Verde nos dois (o check pega sintaxe no app.js, o test roda os 335 existentes mais os 6 novos).
- [ ] **Passo 5: commit**: `fix(ui): ciclo de vida das ops vira maquina pura e pill terminal sempre expira`

---

### Tarefa 8.2: sys-polling ancorado em elemento real e destravando após erro (achados: B11)

**Arquivos:** Modify: `ui/app.js:1275-1298` (renderStatus, o bloco `checking` nas linhas 1279-1286 e o container fantasma na 1284) | Test: `test/ui-widgets.test.js`

**Interfaces:** Consome: `opDismissDelay` indiretamente (via closeOp da 8.1). Não cria função nova.

**Dificuldades antecipadas:**
- Risco: a pill NÃO pode ir pra DENTRO de `#metaCheck`, porque `tickCountdown` (linha 1322-1329) faz `el.textContent = ...` a cada segundo e destruiria o widget em menos de 1s → Solução preparada: ancorar no `parentElement` (a div `.meta-line`, index.html:72-74), como IRMÃO do span, com fallback `|| document.body` se o HTML mudar.
- Risco: snapshots 'checking' consecutivos empilhando pills → Solução preparada: manter a guarda `ACTIVE_OPS.has('sys-polling')`; a purga só acontece quando a op existente está em estado terminal.
- Risco: o destrave depois do erro tem corrida com o auto-dismiss de 6s da 8.1 (a checagem seguinte pode começar antes) → Solução preparada: purga explícita e determinística no ramo 'checking' (remove elemento + deleta do Map quando `status !== 'running'`), sem depender do timer.
- Risco: reproduzir `status === 'error'` de verdade → Solução preparada: roteiro manual com a rede desligada (o `gh` falha e o engine marca error), na instância isolada da D5.

- [ ] **Passo 1: escrever o teste que falha** (acrescentar ao `test/ui-widgets.test.js`)
  ```js
  /* ---------- widget sys-polling (B11) ---------- */

  test('sys-polling ancora em elemento que existe, nao em id fantasma (B11)', () => {
    assert.match(HTML, /id="metaCheck"/, 'a ancora real existe no index.html');
    assert.doesNotMatch(APPJS, /\$\('#metaLine'\)/, 'nao existe id metaLine no index.html');
    assert.doesNotMatch(APPJS, /\$\('#topbar'\)/, 'topbar e classe, nao id: $() devolvia null');
    const fn = APPJS.match(/function renderStatus\([\s\S]*?\n\}/);
    assert.ok(fn, 'renderStatus existe');
    assert.match(fn[0], /#metaCheck/, 'a pill de polling vive ao lado do #metaCheck');
  });

  test('erro de checagem nao trava o widget sys-polling pra sempre (B11)', () => {
    const fn = APPJS.match(/function renderStatus\([\s\S]*?\n\}/);
    assert.match(fn[0], /status !== 'running'/,
      'op terminal e purgada no comeco do ciclo seguinte, senao o has() barra o novo widget');
  });
  ```
- [ ] **Passo 2: rodar e ver falhar** com `node --test test/ui-widgets.test.js`. Esperado: o primeiro teste falha no `doesNotMatch` de `$('#metaLine')` (o código atual, linha 1284, referencia o id fantasma) e o segundo falha no `assert.match` de `status !== 'running'`.
- [ ] **Passo 3: implementação mínima**. O ramo `checking` do renderStatus (linhas 1275-1286) vira:
  ```js
    if (s.status === 'checking') {
      pill.className = 'pill busy';
      pill.textContent = 'verificando…';
      // um erro anterior deixava a op terminal no Map e o has() abaixo barrava o
      // widget novo pra sempre (B11): ciclo novo purga o que ja terminou
      const cur = ACTIVE_OPS.get('sys-polling');
      if (cur && cur.status !== 'running') {
        if (cur.element) cur.element.remove();
        ACTIVE_OPS.delete('sys-polling');
      }
      // Start polling feedback widget
      if (!ACTIVE_OPS.has('sys-polling')) {
        showOp('sys-polling', {
          type: 'polling',
          title: 'Verificando PRs',
          inline: true,
          // ao LADO do #metaCheck (a .meta-line), nunca DENTRO dele: o tickCountdown
          // sobrescreve o textContent do span a cada segundo e mataria a pill
          container: ($('#metaCheck') && $('#metaCheck').parentElement) || document.body
        });
      }
    } else if (s.status === 'error') {
  ```
  (os ramos error/starting/ok, linhas 1287-1298, ficam como estão; o `closeOp('sys-polling', 'error', ...)` da 1290 agora expira em 6s pela 8.1.)
- [ ] **Passo 4: rodar a suite inteira**: `npm run check && npm test`.
- [ ] **Passo 5: commit**: `fix(ui): ancora o widget sys-polling na meta-line e destrava apos erro de checagem`

**Verificação manual roteirizada (obrigatória nesta tarefa, o ciclo error não tem teste automatizado):** subir a instância isolada da D5. (1) Com rede ok, clicar "Verificar agora": pill azul "Verificando PRs" aparece AO LADO da linha "Última checagem…" (não no rodapé da página), termina verde e some em ~3s. (2) Desligar a rede (Wi-Fi off), clicar "Verificar agora": pill fica vermelha com a mensagem de falha e SOME sozinha em ~6s. (3) Religar a rede, clicar "Verificar agora": a pill azul VOLTA (antes do fix ela nunca mais aparecia) e termina verde. (4) Repetir o ciclo 3 vezes e conferir no console: `ACTIVE_OPS.size` volta a 0 e `document.querySelectorAll('.op-inline-pill').length` é 0 entre ciclos.

---

### Tarefa 8.3: token de requisição no loadDeliveries (achados: M19)

**Arquivos:** Modify: `ui/app.js:1192-1233` (declarações da aba Entregas e o corpo do `loadDeliveries`:1221-1233) | Test: `test/ui-widgets.test.js`

**Interfaces:** Produz: variável de módulo `deliveriesReqSeq` (contador monotônico). Padrão copiado da guarda do openChat:1415 (`if (c && chatKey === key)`), adaptado de chave pra sequência porque aqui as requisições são todas da MESMA visão.

**Dificuldades antecipadas:**
- Risco: a resposta velha retornar cedo e deixar a op 'load-deliveries' sem closeOp → Solução preparada: análise já feita: a carga NOVA reutiliza o MESMO opId (e o showOp da 8.1 remove a pill anterior), então o closeOp da carga nova encerra a única op viva; o retorno antecipado da velha não vaza nada. Comentado no código.
- Risco: corrida real é intestável sem DOM e sem rede controlada → Solução preparada: pista B (invariante estática: o token existe e o `return` vem ANTES do closeOp) mais roteiro manual com throttling do DevTools, descrito abaixo.
- Risco: `renderDeliveries` pintar dado velho por outra porta (o handler de `#delivBy`:1262-1269 chama `renderDeliveries()` direto) → Solução preparada: esse caminho usa `deliveriesData` já aceito (não faz fetch), então não precisa de token; deixar como está.

- [ ] **Passo 1: escrever o teste que falha** (acrescentar ao `test/ui-widgets.test.js`)
  ```js
  /* ---------- corrida de respostas na aba Entregas (M19) ---------- */

  test('loadDeliveries descarta resposta velha por token de requisicao (M19)', () => {
    const fn = APPJS.match(/async function loadDeliveries\([\s\S]*?\n\}/);
    assert.ok(fn, 'loadDeliveries existe');
    assert.match(fn[0], /const rid = \+\+deliveriesReqSeq/, 'cada carga pega um token novo');
    assert.match(fn[0], /if \(rid !== deliveriesReqSeq\) return/,
      'resposta de carga superada nao pinta a tela (padrao da guarda do openChat)');
    const posGuarda = fn[0].indexOf('rid !== deliveriesReqSeq');
    const posClose = fn[0].indexOf('closeOp(');
    assert.ok(posGuarda !== -1 && posGuarda < posClose,
      'a guarda vem ANTES do closeOp: resposta velha nao encerra a op da carga nova');
  });
  ```
- [ ] **Passo 2: rodar e ver falhar** com `node --test test/ui-widgets.test.js`. Esperado: falha no primeiro `assert.match` (`deliveriesReqSeq` não existe no app.js hoje).
- [ ] **Passo 3: implementação mínima**. Junto das declarações da aba (após a linha 1196, `deliveriesOrg`):
  ```js
  let deliveriesOrg = localStorage.getItem('farol-deliv-org') || ''; // '' = ainda não resolvido → cai na principal
  // token de requisição: trocar org/período dispara cargas concorrentes e a resposta
  // VELHA não pode vencer a nova (mesma guarda que o openChat faz por chave)
  let deliveriesReqSeq = 0;
  ```
  E o `loadDeliveries` (linhas 1221-1233) vira:
  ```js
  async function loadDeliveries() {
    renderDelivOrgSelect();
    const sel = $('#delivDays'); if (sel) sel.value = String(deliveriesDays);
    marcarSeg(document.querySelectorAll('#delivBy .seg-btn'), b => b.dataset.by === deliveriesBy);
    const box = $('#deliveries');
    box.innerHTML = '<div class="empty">Carregando entregas…</div>';
    const opId = 'load-deliveries';
    showOp(opId, { type: 'data', title: 'Carregando entregas', inline: true, container: box });
    const rid = ++deliveriesReqSeq;
    const data = await get('/api/deliveries?days=' + deliveriesDays + '&owner=' + encodeURIComponent(deliveriesOrg || ''));
    // outra carga começou depois desta: a resposta é velha e não pinta nada (a op
    // 'load-deliveries' já é da carga nova, que fará o próprio closeOp)
    if (rid !== deliveriesReqSeq) return;
    deliveriesData = data || { items: [] };
    closeOp(opId, 'done');
    renderDeliveries();
  }
  ```
- [ ] **Passo 4: rodar a suite inteira**: `npm run check && npm test`.
- [ ] **Passo 5: commit**: `fix(ui): token de requisicao impede resposta velha de vencer na aba Entregas`

**Verificação manual roteirizada:** instância da D5 com uma conta real de LEITURA (as buscas de entregas são read-only, seguras). DevTools > Network > throttling "Slow 3G". (1) Abrir a aba Entregas. (2) Trocar o período de 7 pra 30 dias e, ANTES da resposta chegar, trocar de volta pra 7. Esperado: a lista final é a de 7 dias (a resposta de 30, que chega por último no throttle, é descartada). (3) Repetir trocando a org duas vezes rápido: a lista final corresponde à ÚLTIMA org do select. (4) Conferir que não sobrou pill "Carregando entregas" órfã e que `ACTIVE_OPS.size` é 0.

---

### Tarefa 8.4: rótulo de estágio da sessão com ticker próprio (achados: B13)

**Arquivos:** Modify: `ui/pure.js` (nova função `stageLabel` na seção de folhas; rodapé de exports) e `ui/app.js:1335-1342` (tickElapsed), `ui/app.js:1370-1377` (renderActive, o cálculo e o markup do estágio) | Test: `test/ui-widgets.test.js`

**Interfaces:** Produz: `stageLabel(segundos) -> string` (`'(iniciando…)'` sob 5s, `'(processando…)'` sob 15s, `''` depois). Consumida pelo renderActive (primeiro paint) e pelo tickElapsed (envelhecimento por segundo).

**Dificuldades antecipadas:**
- Risco: o achado sugere copiar o padrão do badge de modelo (1391-1396), mas aquele loop só roda a cada snapshot SSE; entre snapshots o rótulo continuaria congelado → Solução preparada: copiar o padrão MAIS forte do próprio arquivo, o `data-started` do `.session-elapsed` atualizado pelo `tickElapsed` (1335-1342), que roda a cada 1s via `setInterval(tickCountdown, 1000)`:1333. O badge de modelo fica intocado.
- Risco: fronteiras dos limiares regredirem (5s e 15s são a promessa do comentário "Session Startup: stage indicators" do cabeçalho:102) → Solução preparada: teste puro cobrindo 0/4/5/14/15/600.
- Risco: `s.startedAt` ausente → Solução preparada: o markup grava `data-started` vazio nesse caso e o ticker retorna cedo no `parseInt` NaN, mesmo contrato do `.session-elapsed`.

- [ ] **Passo 1: escrever o teste que falha** (acrescentar ao `test/ui-widgets.test.js`)
  ```js
  /* ---------- estagio da sessao ativa (B13) ---------- */

  test('stageLabel muda com o tempo de vida da sessao', () => {
    assert.equal(P.stageLabel(0), '(iniciando…)');
    assert.equal(P.stageLabel(4), '(iniciando…)');
    assert.equal(P.stageLabel(5), '(processando…)');
    assert.equal(P.stageLabel(14), '(processando…)');
    assert.equal(P.stageLabel(15), '');
    assert.equal(P.stageLabel(600), '');
  });

  test('o rotulo de estagio tem ticker proprio e nao congela no primeiro paint (B13)', () => {
    assert.match(APPJS, /class="session-stage" data-started=/, 'o estagio mora num span com data-started');
    const fn = APPJS.match(/function tickElapsed\([\s\S]*?\n\}/);
    assert.ok(fn, 'tickElapsed existe');
    assert.match(fn[0], /session-stage/, 'o ticker de 1s envelhece o estagio, como ja faz com o elapsed');
    assert.match(fn[0], /stageLabel\(/, 'o texto vem da funcao pura');
  });
  ```
- [ ] **Passo 2: rodar e ver falhar** com `node --test test/ui-widgets.test.js`. Esperado: `P.stageLabel is not a function` no primeiro e `assert.match` falhando no segundo (não existe `session-stage` no app.js).
- [ ] **Passo 3: implementação mínima**. Em `ui/pure.js` (seção de folhas, junto de `fmtCompact`):
  ```js
  // rotulo de estagio de uma sessao headless pelo tempo de vida em segundos. O card
  // nao re-renderiza a cada segundo, entao quem chama e o ticker do app (tickElapsed),
  // no mesmo padrao data-started do .session-elapsed (B13: congelava no 1o paint).
  function stageLabel(s) {
    if (s < 5) return '(iniciando…)';
    if (s < 15) return '(processando…)';
    return '';
  }
  ```
  Acrescentar `stageLabel` ao rodapé de exports. Em `ui/app.js`, o cálculo dentro do `box.innerHTML = sessions.map(...)` (linhas 1371-1377) vira:
  ```js
      const uptime = Math.round((Date.now() - (s.startedAt || Date.now())) / 1000);
      const stages = stageLabel(uptime);
      return `
      <div class="card session-card" data-id="${esc(s.id)}">
        <div class="session-head">
          <span class="spin accent"></span>
          <b>${esc(s.label)}</b> <span class="session-stage" data-started="${s.startedAt || ''}">${stages}</span>
  ```
  (o restante do template segue igual). E o `tickElapsed` (1335-1342) ganha o segundo loop:
  ```js
  function tickElapsed() {
    document.querySelectorAll('.session-elapsed').forEach(el => {
      const started = parseInt(el.dataset.started, 10);
      if (!started) return;
      const s = Math.max(0, Math.round((Date.now() - started) / 1000));
      el.textContent = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
    });
    // o estagio (iniciando/processando) envelhece junto: o card so re-renderiza em
    // snapshot SSE, entao sem este ticker o rotulo congelava no primeiro paint (B13)
    document.querySelectorAll('.session-stage').forEach(el => {
      const started = parseInt(el.dataset.started, 10);
      if (!started) return;
      el.textContent = stageLabel(Math.max(0, Math.round((Date.now() - started) / 1000)));
    });
  }
  ```
- [ ] **Passo 4: rodar a suite inteira**: `npm run check && npm test`.
- [ ] **Passo 5: commit**: `fix(ui): rotulo de estagio da sessao acompanha o tempo real da sessao`

**Verificação manual roteirizada:** instância da D5 com o stub lento de 20s. Clicar "Revisar" num PR do panorama e observar o card em "Analisando agora": "(iniciando…)" nos primeiros ~5s, virando "(processando…)" até ~15s e sumindo depois, SEM chegar snapshot novo (não clicar em nada no meio). Antes do fix o rótulo ficava eternamente no texto do primeiro paint.

---

### Tarefa 8.5: SCOPE persistido validado contra as contas reais (achados: B15)

**Arquivos:** Modify: `ui/pure.js` (nova função `validScope`; rodapé de exports) e `ui/app.js:239-251` (rebuildAccounts, validação no fim) | Test: `test/ui-widgets.test.js`

**Interfaces:** Produz: `validScope(scope, users) -> string` (devolve o próprio scope quando é 'all', vazio ou um login presente em users, comparando sem caixa; senão devolve 'all'). Consumida no fim do `rebuildAccounts`, que roda a cada snapshot (SSE 'state':2951), então o estado se autocorrige também quando uma conta é removida com o app aberto.

**Dificuldades antecipadas:**
- Risco: o primeiro snapshot (status 'starting') pode vir com `accounts` vazio e a validação resetaria um escopo VÁLIDO pra 'all', perdendo a escolha do usuário → Solução preparada: validar só quando `list.length > 0`; o teste estático exige a presença dessa guarda no rebuildAccounts.
- Risco: caixa divergente entre o valor salvo e o login real (localStorage antigo pode ter 'Fulano', conta é 'fulano') → Solução preparada: comparação lowercase DENTRO do validScope, preservando o valor original quando válido (o restante do app já compara SCOPE com lowercase nos dois lados, ver scopeVisible:264).
- Risco: laço de escrita no localStorage a cada snapshot → Solução preparada: só grava quando o valor MUDA (`if (v !== SCOPE)`).

- [ ] **Passo 1: escrever o teste que falha** (acrescentar ao `test/ui-widgets.test.js`)
  ```js
  /* ---------- escopo persistido orfao (B15) ---------- */

  test('validScope: orfao volta pra all, valido permanece', () => {
    assert.equal(P.validScope('all', ['alice']), 'all');
    assert.equal(P.validScope('', ['alice']), 'all');
    assert.equal(P.validScope(null, []), 'all');
    assert.equal(P.validScope('alice', ['alice', 'bob']), 'alice');
    assert.equal(P.validScope('ALICE', ['alice']), 'ALICE', 'compara sem caixa e preserva o valor salvo');
    assert.equal(P.validScope('carol', ['alice', 'bob']), 'all', 'conta removida nao pode esvaziar o Radar');
  });

  test('rebuildAccounts saneia o SCOPE persistido a cada snapshot (B15)', () => {
    const fn = APPJS.match(/function rebuildAccounts\([\s\S]*?\n\}/);
    assert.ok(fn, 'rebuildAccounts existe');
    assert.match(fn[0], /validScope\(/, 'a validacao roda onde as contas sao reconstruidas');
    assert.match(fn[0], /list\.length/, 'snapshot de boot sem contas nao pode resetar escopo valido');
  });
  ```
- [ ] **Passo 2: rodar e ver falhar** com `node --test test/ui-widgets.test.js`. Esperado: `P.validScope is not a function` e o estático falhando no `assert.match` de `validScope(`.
- [ ] **Passo 3: implementação mínima**. Em `ui/pure.js` (seção de folhas):
  ```js
  // escopo salvo no navegador validado contra as contas atuais: conta removida ou
  // renomeada deixava um escopo orfao que esvaziava o Radar pra sempre (B15).
  // Compara sem caixa e preserva o valor original quando ele e valido.
  function validScope(scope, users) {
    if (!scope || scope === 'all') return 'all';
    const s = String(scope).toLowerCase();
    return (users || []).some(u => String(u).toLowerCase() === s) ? scope : 'all';
  }
  ```
  Acrescentar `validScope` ao rodapé de exports. Em `ui/app.js`, o fim do `rebuildAccounts` (depois do `forEach`, antes da chave que fecha na linha 251):
  ```js
    (a.owners || []).forEach(o => { OWNER2USER[String(o).toLowerCase()] = a.user; });
    });
    // o escopo persistido pode ter ficado orfao (conta removida/renomeada): saneia
    // aqui, que roda a cada snapshot. So valida com a lista PRESENTE: o snapshot de
    // boot pode vir sem contas e nao pode resetar um escopo valido (B15).
    if (list.length) {
      const v = validScope(SCOPE, list.map(a => a.user));
      if (v !== SCOPE) { SCOPE = v; localStorage.setItem('farol-scope', SCOPE); }
    }
  }
  ```
- [ ] **Passo 4: rodar a suite inteira**: `npm run check && npm test`.
- [ ] **Passo 5: commit**: `fix(ui): escopo persistido orfao volta pra todas as contas em vez de esvaziar o Radar`

**Verificação manual roteirizada:** instância da D5 com 2 contas configuradas. No console: `localStorage.setItem('farol-scope', 'fantasma')` e recarregar a página. Esperado: o Radar mostra os PRs de todas as contas, o segmento "Todas" da barra está ativo e `localStorage.getItem('farol-scope')` voltou a `'all'`. Antes do fix: Radar vazio e nenhum segmento ativo.

---

### Tarefa 8.6: barra de contas só nas abas que respeitam o escopo (achados: B14)

**Arquivos:** Modify: `ui/pure.js` (nova função `accountBarVisible`; rodapé de exports) e `ui/app.js:311-319` (renderAccountBar, a condição de visibilidade e o comentário) | Test: `test/ui-widgets.test.js`

**Interfaces:** Produz: `accountBarVisible(nContas, tab) -> boolean` (allowlist: radar, destaques, time; exige 2+ contas). Consumida na primeira linha útil do `renderAccountBar`.

**Dificuldades antecipadas:**
- Risco: a denylist atual (`sistema`/`consumo` na linha 319) repete o bug a cada aba nova: a Entregas nasceu DEPOIS da barra e herdou a exibição sem que nada ali filtre por SCOPE (a aba filtra pela org própria, `#delivOrg`) → Solução preparada: virar allowlist pura; aba futura nasce SEM a barra até alguém decidir que ela respeita SCOPE, e o comentário no pure.js explica exatamente isso.
- Risco: mudança visível de comportamento (a barra some da Entregas) ser lida como regressão → Solução preparada: o próprio comentário do renderAccountBar:315-316 já prometia "aparece em Radar, Destaques e Time"; citar B14 e o comentário no corpo do commit.
- Risco: `switchTab` (885) e o SSE 'state' (2952) chamam renderAccountBar por caminhos diferentes → Solução preparada: a decisão mora numa função pura única, então os dois caminhos concordam por construção.

- [ ] **Passo 1: escrever o teste que falha** (acrescentar ao `test/ui-widgets.test.js`)
  ```js
  /* ---------- visibilidade da barra de contas (B14) ---------- */

  test('accountBarVisible: so nas abas onde o filtro por conta age', () => {
    assert.equal(P.accountBarVisible(2, 'radar'), true);
    assert.equal(P.accountBarVisible(2, 'destaques'), true);
    assert.equal(P.accountBarVisible(2, 'time'), true);
    assert.equal(P.accountBarVisible(2, 'entregas'), false, 'Entregas filtra por org propria, nada ali respeita SCOPE');
    assert.equal(P.accountBarVisible(2, 'sistema'), false);
    assert.equal(P.accountBarVisible(2, 'consumo'), false);
    assert.equal(P.accountBarVisible(1, 'radar'), false, 'conta unica nao tem o que filtrar');
    assert.equal(P.accountBarVisible(2, 'abaquenaoexiste'), false, 'allowlist: aba nova nasce sem a barra');
  });

  test('renderAccountBar consome a allowlist pura (B14)', () => {
    const fn = APPJS.match(/function renderAccountBar\([\s\S]*?\n\}/);
    assert.ok(fn, 'renderAccountBar existe');
    assert.match(fn[0], /accountBarVisible\(/);
    assert.doesNotMatch(fn[0], /CURRENT_TAB === 'sistema'/, 'a denylist antiga saiu');
  });
  ```
- [ ] **Passo 2: rodar e ver falhar** com `node --test test/ui-widgets.test.js`. Esperado: `P.accountBarVisible is not a function` e o estático falhando (a denylist ainda está lá).
- [ ] **Passo 3: implementação mínima**. Em `ui/pure.js` (seção de folhas):
  ```js
  // abas onde a barra de contas APARECE: so onde o filtro por conta age de verdade
  // (Radar, Destaques e Time filtram/agrupam por SCOPE). Allowlist, nao denylist:
  // a Entregas nasceu depois e ficou mostrando um filtro que nao filtrava nada (B14);
  // aba nova nasce SEM a barra ate alguem decidir que ela respeita o escopo.
  function accountBarVisible(nContas, tab) {
    return nContas >= 2 && (tab === 'radar' || tab === 'destaques' || tab === 'time');
  }
  ```
  Acrescentar `accountBarVisible` ao rodapé de exports. Em `ui/app.js`, o início do `renderAccountBar` (311-320) vira:
  ```js
  function renderAccountBar() {
    const bar = $('#accountBar');
    const accounts = (STATE.accounts || []);
    // a allowlist de abas mora no pure.js (accountBarVisible): so Radar, Destaques
    // e Time respeitam SCOPE; Entregas filtra por org propria e Sistema/Consumo
    // sao visoes do Farol como app, nao de uma conta.
    if (!accountBarVisible(accounts.length, CURRENT_TAB)) { bar.hidden = true; bar.innerHTML = ''; return; }
    bar.hidden = false;
  ```
- [ ] **Passo 4: rodar a suite inteira**: `npm run check && npm test`.
- [ ] **Passo 5: commit**: `fix(ui): barra de contas vira allowlist e some da aba Entregas que nao respeita escopo`

**Verificação manual roteirizada:** instância da D5 com 2 contas. Passear pelas 6 abas: barra visível em Radar, Destaques e Time; ausente em Entregas, Sistema e Consumo. Na Entregas, conferir que o select de org continua funcionando (o filtro legítimo da aba).

---

### Tarefa 8.7: chat-activity atualiza a pill sem destruir o widget e closeChat encerra a op (achados: B16)

**Arquivos:** Modify: `ui/app.js:1418` (closeChat), `ui/app.js:1441-1456` (renderChat, o bloco da op do chat), `ui/app.js:2973-2980` (handler SSE 'chat-activity') | Test: `test/ui-widgets.test.js`

**Interfaces:** Consome: `showOp`/`updateOp`/`closeOp` (com a semântica da 8.1: 'cancelled' expira em 6s e sai do Map). Não cria função nova; o contrato relevante é o opId `chat-${key}` compartilhado entre renderChat, o handler SSE e o closeChat.

**Dificuldades antecipadas:**
- Risco: ordem dos eventos SSE não é garantida: um 'chat-activity' pode chegar ANTES do primeiro 'chat' (que faz o renderChat criar a op), e aí não haveria pill pra atualizar → Solução preparada: o handler cria a op se ela não existir, com os MESMOS opts do renderChat, e depois faz updateOp; os dois caminhos convergem no mesmo opId.
- Risco: as fases fake do renderChat (linhas 1451-1453, `Math.random` sobre 'Lendo PR…' etc.) atropelariam o texto REAL de atividade a cada evento 'chat' → Solução preparada: mover o updateOp de fase pra DENTRO do bloco de criação (fase genérica só no primeiro paint; depois quem manda é o chat-activity real). Sem isso o fix do handler seria desfeito a cada snapshot de chat.
- Risco: closeChat com chatKey já nulo (Esc duas vezes, clique duplo no fechar) → Solução preparada: guarda `if (chatKey)` antes do closeOp.
- Risco: a op 'cancelled' fica 6s num container escondido → Solução preparada: comportamento aceito e verificado no roteiro (o painel está `hidden`, nada aparece; o Map zera em 6s pela 8.1); reabrir o chat antes disso recria a op pelo mesmo id e o showOp da 8.1 remove a pill velha.

- [ ] **Passo 1: escrever o teste que falha** (acrescentar ao `test/ui-widgets.test.js`)
  ```js
  /* ---------- atividade do chat e encerramento (B16) ---------- */

  test('chat-activity atualiza a pill via updateOp, nao atropela o container (B16)', () => {
    const handler = APPJS.match(/addEventListener\('chat-activity'[\s\S]*?\n  \}\);/);
    assert.ok(handler, 'o handler chat-activity existe');
    assert.match(handler[0], /updateOp\(/, 'o texto vivo entra como step da operacao');
    assert.doesNotMatch(handler[0], /\.textContent = text/,
      'textContent no container destroi a pill que o renderChat criou dentro dele');
  });

  test('closeChat encerra a operacao do chat antes de soltar a chave (B16)', () => {
    const fn = APPJS.match(/function closeChat\(\)[\s\S]*?\n\}/);
    assert.ok(fn, 'closeChat existe em forma de bloco');
    assert.match(fn[0], /closeOp\(/, 'fechar o painel no meio da resposta nao pode vazar a op no ACTIVE_OPS');
  });

  test('a fase generica do chat roda so no primeiro paint, nao a cada snapshot (B16)', () => {
    const fn = APPJS.match(/function renderChat\([\s\S]*?\n\}/);
    assert.ok(fn, 'renderChat existe');
    assert.doesNotMatch(fn[0], /Math\.random\(\)/,
      'fase sorteada a cada snapshot atropelava o texto real vindo do chat-activity');
  });
  ```
- [ ] **Passo 2: rodar e ver falhar** com `node --test test/ui-widgets.test.js`. Esperado: os três falham: o handler atual (2978) tem `el.textContent = text`; o closeChat atual é `function closeChat() { chatKey = null; ... }` numa linha só (a regex de bloco nem casa, o `assert.ok` acusa); o renderChat tem `Math.random()` na 1452.
- [ ] **Passo 3: implementação mínima**. O `closeChat` (linha 1418) vira:
  ```js
  function closeChat() {
    // fechar no meio da resposta: encerra a op ANTES de soltar a chave, senao a
    // entrada chat-<key> fica pra sempre no ACTIVE_OPS (B16)
    if (chatKey) closeOp(`chat-${chatKey}`, 'cancelled', '');
    chatKey = null;
    $('#chatPanel').hidden = true;
  }
  ```
  No `renderChat`, o bloco da op (1442-1456) vira:
  ```js
    if (running) {
      if (!ACTIVE_OPS.has(chatOpId)) {
        showOp(chatOpId, {
          type: 'chat',
          title: 'Claude respondendo',
          inline: true,
          container: act
        });
        // fase generica so no primeiro paint; depois quem escreve o step e o
        // handler de chat-activity, com o texto REAL da sessao
        updateOp(chatOpId, { step: 'Lendo PR…', progress: 25 });
      }
    } else {
      closeOp(chatOpId, 'done', 'Resposta recebida');
    }
  ```
  E o handler SSE (2973-2980) vira:
  ```js
    es.addEventListener('chat-activity', (e) => {
      const { key, text } = JSON.parse(e.data);
      if (chatKey && key === chatKey) {
        const el = $('#chatActivity');
        el.hidden = false;
        const opId = `chat-${key}`;
        // o texto vivo vira o step da MESMA pill que o renderChat cria; escrever
        // textContent no container destruia a pill e orfanava a op (B16). Se a
        // atividade chegar antes do primeiro snapshot de chat, cria a op aqui.
        if (!ACTIVE_OPS.has(opId)) showOp(opId, { type: 'chat', title: 'Claude respondendo', inline: true, container: el });
        updateOp(opId, { step: text });
      }
    });
  ```
- [ ] **Passo 4: rodar a suite inteira**: `npm run check && npm test`.
- [ ] **Passo 5: commit**: `fix(ui): atividade do chat atualiza a pill via updateOp e closeChat encerra a operacao`

**Verificação manual roteirizada:** instância da D5 com o stub lento de 20s (o stub substitui TODAS as sessões headless, chat incluso). (1) Colar a URL de um PR no "consultar por URL" pra abrir o chat e enviar uma mensagem. Esperado: pill "Claude respondendo" aparece em #chatActivity e NÃO é substituída por texto cru quando eventos de atividade chegam (o step muda dentro da pill). (2) Fechar o painel NO MEIO da resposta (botão fechar). No console: `ACTIVE_OPS.size` cai a 0 em até 6s (antes do fix a entrada `chat-...` ficava pra sempre). (3) Reabrir o mesmo chat antes dos 6s: uma pill só, nunca duas. (4) Deixar a resposta terminar com o painel aberto: pill fica verde e some em ~3s.

---

### Tarefa 8.8: marcadores de auto-merge/admin expiram no refresh seguinte (achados: B17)

**Arquivos:** Modify: `ui/pure.js` (nova função `expiredSessionMarks`; rodapé de exports) e `ui/app.js:1732-1738` (declarações dos marcadores), `ui/app.js:1739-1741` (topo do renderMyPRs), `ui/app.js:1974-1978` e `ui/app.js:1996-1997` (sites de escrita) | Test: `test/ui-widgets.test.js`

**Interfaces:** Produz: `expiredSessionMarks(marks, lastCheckAt) -> string[]` onde `marks` é array de pares `[key, marcadoEmMs]` e o retorno são as chaves cuja marcação ficou mais velha que o último refresh (expira quando `lastCheckAt > marcadoEm`; sem lastCheckAt nada expira). Muda também o TIPO de `autoUnavailableKeys`/`adminUnavailableKeys` de `Set` pra `Map` (key → `STATE.lastCheckAt` no momento da recusa); `.has`/`.delete` continuam com a mesma semântica nos leitores (1774/1777), só os `.add` viram `.set`.

**Dificuldades antecipadas:**
- Risco: a poda ingênua ("remove quando mergeStates[key] tem o campo") apagaria a marca IMEDIATAMENTE, porque o `ms` já existia com `autoAllowed` na hora da recusa, reabilitando o botão que acabou de falhar → Solução preparada: expiração por GERAÇÃO de refresh, não por presença de campo: a marca guarda o `STATE.lastCheckAt` do momento e só expira quando chega um `lastCheckAt` estritamente MAIOR (o engine grava `Date.now()` a cada check, server.js:592, e o `refreshMergeStates` roda no fim do mesmo check, então lastCheckAt novo = mergeStates fresco).
- Risco: Set→Map deixa um `.add(` remanescente, que em Map é `TypeError` silencioso só em runtime → Solução preparada: só existem 2 sites de escrita (1978 e 1997, confirmados por grep) e o teste estático PROÍBE `.add(` nesses dois nomes; `mergeBlockedByPolicy` continua Set (fora do achado, não tocar).
- Risco: `lastCheckAt` nulo no boot (server.js:146 inicia null) → Solução preparada: a função pura devolve `[]` quando a referência é 0/null (nada expira), e o `.set` grava `STATE.lastCheckAt || 0`, então a marca feita antes do primeiro check expira no primeiro check, o que é o comportamento certo (o check traz mergeStates fresco).
- Risco: clique do usuário DURANTE um check em andamento (marca com o lastCheckAt novo, mergeStates daquele ciclo pode já ter sido gravado) → Solução preparada: a marca só expira no ciclo SEGUINTE, ou seja, o botão fica desabilitado um ciclo a mais no pior caso; comportamento conservador e aceito, anotado no comentário do código.

- [ ] **Passo 1: escrever o teste que falha** (acrescentar ao `test/ui-widgets.test.js`)
  ```js
  /* ---------- marcadores de sessao do merge (B17) ---------- */

  test('expiredSessionMarks: marca so expira quando chega refresh mais NOVO', () => {
    const marks = [['acme/app#1', 100], ['acme/app#2', 200]];
    assert.deepEqual(P.expiredSessionMarks(marks, 150), ['acme/app#1'], 'expira so quem foi marcado antes do refresh');
    assert.deepEqual(P.expiredSessionMarks(marks, 200), ['acme/app#1'], 'refresh da mesma geracao nao confirma nada');
    assert.deepEqual(P.expiredSessionMarks(marks, 300), ['acme/app#1', 'acme/app#2']);
    assert.deepEqual(P.expiredSessionMarks([], 300), []);
    assert.deepEqual(P.expiredSessionMarks(marks, null), [], 'sem lastCheckAt (boot) nada expira');
    assert.deepEqual(P.expiredSessionMarks(marks, 0), [], 'zero tambem e ausencia de refresh');
  });

  test('os marcadores de merge sao Map com geracao e sao podados no render (B17)', () => {
    assert.match(APPJS, /autoUnavailableKeys = new Map\(\)/);
    assert.match(APPJS, /adminUnavailableKeys = new Map\(\)/);
    assert.doesNotMatch(APPJS, /autoUnavailableKeys\.add\(/, 'Map nao tem add: seria TypeError em runtime');
    assert.doesNotMatch(APPJS, /adminUnavailableKeys\.add\(/, 'Map nao tem add: seria TypeError em runtime');
    const inicio = APPJS.match(/function renderMyPRs\(\) \{[\s\S]{0,700}/);
    assert.ok(inicio, 'renderMyPRs existe');
    assert.match(inicio[0], /expiredSessionMarks\(/,
      'a poda roda no comeco de cada render, cumprindo o que o comentario das linhas 1733-1738 sempre prometeu');
  });
  ```
- [ ] **Passo 2: rodar e ver falhar** com `node --test test/ui-widgets.test.js`. Esperado: `P.expiredSessionMarks is not a function` no primeiro; no segundo, `assert.match` de `new Map()` falha (hoje são `new Set()`).
- [ ] **Passo 3: implementação mínima**. Em `ui/pure.js` (seção de folhas):
  ```js
  // marcadores de sessao do merge (auto-merge/admin recusados) expiram quando chega
  // um refresh de mergeStates mais NOVO que a marcacao (B17): o dado fresco do repo
  // volta a mandar. Presenca de campo nao serve de gatilho (o mergeStates JA existia
  // na hora da recusa); a geracao do refresh (lastCheckAt do engine) serve.
  // marks: array de pares [key, marcadoEmMs]; retorna as chaves que expiraram.
  function expiredSessionMarks(marks, lastCheckAt) {
    const ref = Number(lastCheckAt) || 0;
    if (!ref) return [];
    return (marks || []).filter(([, at]) => ref > (Number(at) || 0)).map(([k]) => k);
  }
  ```
  Acrescentar `expiredSessionMarks` ao rodapé de exports. Em `ui/app.js`, as declarações (1733-1738) viram:
  ```js
  // PRs cujo auto-merge o repo recusou nesta sessão (repo sem "Allow auto-merge"):
  // desabilita o botão Auto-merge até o próximo refresh confirmar o estado do repo.
  // Map de key → lastCheckAt do momento da recusa: a poda no renderMyPRs expira a
  // marca quando um refresh mais novo chega (antes era Set e nunca expirava, B17).
  const autoUnavailableKeys = new Map();
  // PRs cujo Merge (admin) foi recusado por ruleset nesta sessão: esconde o botão
  // admin até o próximo refresh confirmar (o --admin não fura ruleset). Mesmo Map
  // com geração da recusa, mesma poda.
  const adminUnavailableKeys = new Map();
  ```
  O topo do `renderMyPRs` (1739-1740) ganha a poda:
  ```js
  function renderMyPRs() {
    // os marcadores de sessão valem até o PRÓXIMO refresh de mergeStates (que roda
    // no fim de cada check, junto do lastCheckAt novo): refresh mais novo que a
    // marcação poda a marca e o dado fresco do repo volta a decidir os botões
    for (const k of expiredSessionMarks([...autoUnavailableKeys], STATE.lastCheckAt)) autoUnavailableKeys.delete(k);
    for (const k of expiredSessionMarks([...adminUnavailableKeys], STATE.lastCheckAt)) adminUnavailableKeys.delete(k);
    const list = (STATE.myPRs || []).filter(scopeVisible);
  ```
  Os sites de escrita: na linha 1978,
  ```js
        autoUnavailableKeys.set(key, STATE.lastCheckAt || 0); mergeBlockedByPolicy.add(key); renderMyPRs(); return;
  ```
  e na linha 1997,
  ```js
        if (r?.blocked === 'rule') { adminUnavailableKeys.set(key, STATE.lastCheckAt || 0); renderMyPRs(); return; }
  ```
  Os leitores `.has(pr.key)` (1774/1777) e os `.delete` (1974) não mudam: Map tem os dois com a mesma semântica.
- [ ] **Passo 4: rodar a suite inteira**: `npm run check && npm test`.
- [ ] **Passo 5: commit**: `fix(ui): marcadores de auto-merge e admin expiram no refresh seguinte do engine`

**Verificação manual roteirizada:** o cenário real exige um repo sem "Allow auto-merge", então o roteiro tem dois níveis. Nível console (determinístico, sempre disponível): na instância da D5 com um PR seu listado em Meus PRs, rodar no console `autoUnavailableKeys.set('qualquer/repo#1', 1); renderMyPRs(); autoUnavailableKeys.has('qualquer/repo#1')`. Esperado: `false` (o lastCheckAt real do engine é maior que 1, a poda removeu). Repetir com `STATE.lastCheckAt` no lugar do 1: esperado `true` (mesma geração não expira). Nível ponta a ponta (quando houver repo de teste): num PR aprovável de repo SEM allow auto-merge, clicar Auto-merge (falha e o botão desabilita); ligar "Allow auto-merge" no Settings do repo no GitHub; clicar "Verificar agora" e aguardar o ciclo. Esperado: o botão Auto-merge reabilita sozinho, sem recarregar o app (antes do fix ficava desabilitado até fechar o Farol).
