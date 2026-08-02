# Rascunho de plano, Onda 3

Repo: `C:\Users\wanderson\Documents\farol` (fonte da verdade, nunca a cópia instalada). Suite: `node --test` nativo, zero deps. Gate: `npm run check && npm test`.

## Onda 3: Contratos UI↔server (raiz P3)

**Achados cobertos:** A5 (paleta chama `decide()` inexistente), M18 (Cancelar posta `/api/cancel-op`, rota inexistente), M20 (widget de autoanálise com key malformada, sem fechamento e destruído pelo re-render), M21 (pushback pendente não confirma re-selecionando o desfecho sugerido), B22 (fallback `{}` do Revisar tudo faz o servidor revisar a fila inteira).

**Dificuldades antecipadas da onda** (a parte MAIS importante do plano; o objetivo é ter a solução pronta antes do impedimento aparecer):

- **D1. `ui/app.js` tem ZERO teste e é script de navegador (toca `document` no topo), então não carrega no `node --test`** → Solução preparada: três técnicas que a suite JÁ usa, cada tarefa declara qual usa. (a) Extrair lógica pra função pura em `ui/pure.js` e testar via `require` (padrão de `test/ui-pure.test.js`); (b) teste de texto: ler `ui/app.js` como string e afirmar invariantes por regex (padrão de `test/ui-semantics.test.js`, que já faz exatamente isso com `APPJS`); (c) teste de contrato de rotas: extrair por regex toda rota `/api/*` chamada no `app.js` e conferir contra as rotas roteadas em `lib/http-server.js` (novo `test/ui-contract.test.js`). Nada de jsdom nem dependência nova (invariante 1 do projeto).
- **D2. Cancelar a autoanálise exige um id que a UI NÃO tem no momento do clique**: `launchSelfAnalysis` só empurra pra `headlessQueue` (lib/engine/selfpr.js:412) e o session id (`s<seq>`) só nasce quando o escalonador puxa da fila (`runSelfAnalysis`, selfpr.js:420). Devolver o session id no POST `/api/self-review` (a ideia inicial) NÃO funciona: no retorno do POST a sessão ainda não existe → Solução preparada: contrato por KEY, não por session id. Rota nova `POST /api/self-review/cancel {key}` com `cancelSelfAnalysis(engine, key)` que cobre os DOIS estados: na fila (remove da `headlessQueue`) e rodando (acha em `activeReviews` a entrada `mode === 'self'` com o key e delega pro `cancelSession(id)` existente). O key é o identificador estável que a UI já tem (`card.dataset.key`).
- **D3. Corrida do SSE contra o clique**: o widget nasce no clique, mas um evento `state` emitido ANTES do servidor enfileirar pode chegar DEPOIS do `showOp`; um reconciliador ingênuo ("key não está no snapshot, fecha") mataria o widget recém-nascido como "concluído" → Solução preparada: protocolo seen/close na função pura `analysisOpsPlan(ops, snap)`: o op só é fechável DEPOIS de ter aparecido pelo menos uma vez em `activeSessions` (mode self) ou `headlessWaiting`. O caso da corrida vira teste de unidade explícito (Tarefa 3.4, terceiro teste).
- **D4. `renderMyPRs` reescreve `#myPRs` por `innerHTML` a cada push de estado** (ui/app.js:1754), e `launchSelfAnalysis` faz `pushState()` imediato (selfpr.js:414): o widget morre menos de 1s depois de nascer → Solução preparada: a referência do elemento fica guardada em `ACTIVE_OPS` (já fica hoje, `op.element`); `syncAnalysisOps()` roda após os renders do handler `state` e re-anexa com `card.appendChild(op.element)` todo op cujo `element.isConnected === false` (appendChild re-anexa o nó vivo, com o conteúdo intacto).
- **D5. Tirar o fallback "sem urls = fila inteira" do `/api/review` pode quebrar chamador escondido** → Solução preparada: verificado por grep no repo inteiro (`grep -rn "api/review"` fora de node_modules): o ÚNICO chamador é `ui/app.js` (btnReviewAll, panorama, queue, todos mandam `urls` explícito exceto o `{}` do bug). O 400 novo devolve mensagem que explica o contrato ("urls é obrigatório..."), então qualquer script pessoal que dependesse do default falha ALTO com instrução, em vez de mudar de comportamento calado.
- **D6. Teste por regex é frágil: uma refatoração de formato pode esvaziar o extrator e o teste "passa vazio"** → Solução preparada: todo teste grep da onda vem com um teste de sanidade anti-extrator-cego que afirma valores conhecidos (ex.: o Set de rotas chamadas contém `/api/decide`, o de servidas contém `/api/review`, tamanho mínimo do Set). Se o padrão dos arquivos mudar, é a sanidade que acusa, não o silêncio.
- **D7. Mover `PB_OPTS`/`PB_SHORT`/`pushbackControl` do `app.js` pro `pure.js` pode explodir no navegador**: os dois são scripts clássicos no MESMO escopo global (index.html carrega pure.js antes do app.js) e `const` redeclarado entre scripts lança `SyntaxError: Identifier has already been declared` no load da página, coisa que `npm run check` (sintaxe por arquivo) NÃO pega → Solução preparada: a MESMA edição que adiciona no pure.js remove as três declarações do app.js, e o passo de verificação da tarefa inclui `grep -n "const PB_OPTS\|const PB_SHORT\|function pushbackControl" ui/app.js ui/pure.js` conferindo que só o pure.js declara.
- **D8. Cross-platform (requisito firme)**: nada desta onda pode criar branch de SO → Solução preparada: nenhuma tarefa toca spawn, path de SO ou `IS_WIN`/`IS_MAC`; os testes novos usam `os.tmpdir()` + `process.pid` (padrão de `test/http.test.js` e `test/merge-gates.test.js`) e rodam idênticos em Windows e macOS.
- **D9. Testar `cancelSelfAnalysis` no caminho "rodando" chamaria `cancelSession` de verdade, que faz `killTree` (taskkill/SIGKILL)** → Solução preparada: no teste, sombrear o método na INSTÂNCIA (`engine.cancelSession = (id) => {...}`): a fachada é método de protótipo (server.js:742), então a atribuição de instância intercepta sem processo nenhum. Mesmo truque de espião que `test/merge-gates.test.js` usa com `io.run`.
- **D10. Vizinhança do achado 47 (closeOp nunca remove widget de erro/cancelado), que é de OUTRA onda**: o reconciliador da 3.4 poderia "consertar demais" e conflitar → Solução preparada: escopo cirúrgico: o `syncAnalysisOps` só limpa ops `type === 'analysis'`; os pills de kudos/health (achado 47) não são tocados. Quando a onda do 47 chegar, ela mexe só no `closeOp`.
- **D11. Regressão nos 335 testes existentes** → Solução preparada: toda tarefa termina com `npm test && npm run check` (passo 4); as mudanças de assinatura têm chamador único e ele é atualizado na mesma edição (`pushbackControl`: único call site em ui/app.js:1594; `/api/review`: único chamador é a própria UI).

---

### Tarefa 3.1: Cancelamento real da autoanálise no engine, por key (achados: M18, lado servidor)

**Arquivos:** Modify: `lib/engine/selfpr.js` (nova função após `launchSelfAnalysis`, linha 417, e export na linha 486), `server.js` (fachada nova junto da linha 785), `lib/http-server.js` (rota nova após a linha 90) | Test: `test/selfpr-cancel.test.js` (novo), `test/http.test.js` (helper `post` + 1 teste de rota)

**Interfaces:** Produz: `cancelSelfAnalysis(engine, key) -> { ok: boolean, error?: string }` (selfpr.js, exportada); fachada `Engine.prototype.cancelSelfAnalysis(key)`; rota `POST /api/self-review/cancel` com body `{ key }`. Consome: `engine.headlessQueue`, `engine.activeReviews`, `engine.cancelSession(id)` (existente, session.js:295).

**Dificuldades antecipadas:**
- Teste do caminho "rodando" mataria processo de verdade (D9) → espião de instância em `engine.cancelSession`, sem spawn.
- Toast duplicado ao cancelar sessão rodando: `runOneHeadless` JÁ emite "Autoanálise de X cancelada." quando `err.cancelled` (lib/engine/review.js:105-106) → no caminho rodando, `cancelSelfAnalysis` NÃO emite toast, só delega; toast próprio só no caminho "ainda na fila" (onde nenhum outro caminho avisaria).
- Mexer na `headlessQueue` durante o `processHeadless`? Não há reentrância real: `processHeadless` é síncrono (review.js:87-95) e o handler HTTP roda noutro tick; o `splice` é seguro. E item `self` não entra no inflight persistido (`writeInflight` só grava mode auto, server.js:216), então remover da fila não exige `writeInflight`.
- Ordem de rota: `/api/self-review/cancel` precisa vir como `p === '...'` exato; o roteador do http-server.js só usa igualdade estrita, então não colide com `/api/self-review` (linha 87). Colocar junto do bloco self-review (após a linha 90) pra legibilidade.

- [ ] **Passo 1: escrever o teste que falha**

Criar `test/selfpr-cancel.test.js`:

```js
'use strict';
// Cancelamento da autoanálise (Onda 3, contrato UI↔server). O bug de origem: o botão
// Cancelar da UI postava /api/cancel-op, rota que nunca existiu, e a sessão seguia
// rodando com a UI dizendo "Cancelado". O contrato novo cancela POR KEY, porque no
// momento do clique a sessão pode nem existir ainda (o item está na headlessQueue e o
// id s<seq> só nasce quando o escalonador puxa). Este arquivo trava o lado do engine.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-selfcancel-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../server.js');

after(() => {
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

test('autoanálise ainda NA FILA: cancela removendo da headlessQueue, sem tocar em sessão', () => {
  const engine = new Engine();
  engine.headlessQueue.push({ kind: 'self', key: 'acme/app#7', url: 'https://github.com/acme/app/pull/7' });
  const r = engine.cancelSelfAnalysis('acme/app#7');
  assert.equal(r.ok, true);
  assert.equal(engine.headlessQueue.length, 0, 'o item saiu da fila');
});

test('autoanálise RODANDO: delega pro cancelSession com o id da sessão certa', () => {
  const engine = new Engine();
  engine.activeReviews.set('s9', { id: 's9', keys: ['acme/app#8'], mode: 'self', startedAt: Date.now() });
  const chamados = [];
  engine.cancelSession = (id) => { chamados.push(id); return { ok: true }; };  // espião: nada de killTree
  const r = engine.cancelSelfAnalysis('acme/app#8');
  assert.equal(r.ok, true);
  assert.deepEqual(chamados, ['s9']);
});

test('NÃO confunde com sessão de revisão (mode auto) do mesmo key', () => {
  const engine = new Engine();
  engine.activeReviews.set('s1', { id: 's1', keys: ['acme/app#9'], mode: 'auto', startedAt: Date.now() });
  let cancelou = false;
  engine.cancelSession = () => { cancelou = true; return { ok: true }; };
  const r = engine.cancelSelfAnalysis('acme/app#9');
  assert.equal(r.ok, false);
  assert.equal(cancelou, false, 'a revisão headless de outrem não pode ser morta por engano');
});

test('key desconhecida (ou vazia) devolve erro honesto, sem lançar', () => {
  const engine = new Engine();
  assert.equal(engine.cancelSelfAnalysis('acme/app#404').ok, false);
  assert.equal(engine.cancelSelfAnalysis('').ok, false);
});
```

E acrescentar em `test/http.test.js`, logo abaixo do helper `get` (linha 41), o helper `post` e o teste da rota:

```js
function post(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request(base + pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-farol': '1', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let d = ''; res.on('data', c => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

test('POST /api/self-review/cancel existe e responde JSON (key desconhecida = ok:false)', async () => {
  const r = await post('/api/self-review/cancel', { key: 'acme/app#404' });
  assert.equal(r.status, 200, 'a rota existe (antes caía no 404 not found)');
  assert.equal(JSON.parse(r.body).ok, false);
});
```

- [ ] **Passo 2: rodar e ver falhar**

```
node --test test/selfpr-cancel.test.js test/http.test.js
```

Esperado: os 4 testes novos do selfpr-cancel falham com `TypeError: engine.cancelSelfAnalysis is not a function`; o teste novo do http falha com `404 !== 200`.

- [ ] **Passo 3: implementação mínima**

Em `lib/engine/selfpr.js`, depois do `launchSelfAnalysis` (após a linha 417):

```js
// Cancela a autoanálise de um PR PELO KEY (contrato com o botão Cancelar da UI).
// Por key, não por session id: no momento do clique o item pode estar só na
// headlessQueue, e o id s<seq> só nasce quando o escalonador puxa (runSelfAnalysis).
// Rodando, delega pro cancelSession, e o toast de "cancelada" vem do catch do
// runOneHeadless (err.cancelled), não daqui, pra não avisar duas vezes.
function cancelSelfAnalysis(engine, key) {
  key = String(key || '');
  if (!key) return { ok: false, error: 'sem PR pra cancelar' };
  const idx = engine.headlessQueue.findIndex(p => p.kind === 'self' && p.key === key);
  if (idx >= 0) {
    engine.headlessQueue.splice(idx, 1);
    engine.pushState();
    engine.emit('toast', { kind: 'info', text: `Autoanálise de ${key} cancelada (ainda estava na fila).` });
    return { ok: true };
  }
  const sess = [...engine.activeReviews.values()].find(s => s.mode === 'self' && (s.keys || []).includes(key));
  if (sess) return engine.cancelSession(sess.id);
  return { ok: false, error: 'essa autoanálise não está na fila nem rodando (já terminou?)' };
}
```

No `module.exports` do mesmo arquivo (linha 482-487), acrescentar `cancelSelfAnalysis` na linha do `launchSelfAnalysis`:

```js
  launchSelfAnalysis, cancelSelfAnalysis, runSelfAnalysis,
```

Em `server.js`, junto da fachada de autoanálise (após a linha 785):

```js
  async launchSelfAnalysis(url) { return selfMod.launchSelfAnalysis(this, url); }
  cancelSelfAnalysis(key) { return selfMod.cancelSelfAnalysis(this, key); }
```

Em `lib/http-server.js`, no bloco das rotas self-review (após a linha 90):

```js
        if (p === '/api/self-review/reviewers') return send(200, await engine.setReviewers(String(body.url || '')));
        if (p === '/api/self-review/cancel') return send(200, engine.cancelSelfAnalysis(String(body.key || '')));
```

- [ ] **Passo 4: rodar a suite inteira**

```
npm test && npm run check
```

- [ ] **Passo 5: commit**

```
feat(selfpr): cancelamento de autoanálise por key (fila e sessão) via /api/self-review/cancel
```

---

### Tarefa 3.2: Key canônico do widget de autoanálise, com função pura (achados: M20, parte a)

**Arquivos:** Modify: `ui/pure.js` (nova folha perto de `ownerFromUrl`, linha 38, e export na linha 230), `ui/app.js:1921` (handler `.act-self`) | Test: `test/ui-pure.test.js`

**Interfaces:** Produz: `prKeyFromUrl(url) -> string` ('https://github.com/o/r/pull/9' vira 'o/r#9', vazio se não for URL de PR). Consome (no app.js): `run.closest('.mypr-card').dataset.key` como fonte primária (o card já carrega o key correto, ui/app.js:1814).

**Dificuldades antecipadas:**
- O opId muda de formato ('analysis-repo#pull#123' vira 'analysis-o/r#123'): existe consumidor do formato antigo? → Verificado por grep (`grep -n "analysis-" ui/app.js`): os únicos usos são o próprio handler e o `data-op-id` do DOM, nada persistido; a mudança é local. As tarefas 3.3 e 3.4 JÁ nascem sobre o formato novo.
- `dataset.key` poderia faltar se o botão for renderizado fora do card → fallback pra `prKeyFromUrl(run.dataset.url)`, e a função pura cobre o caso de URL fora do padrão devolvendo vazio (testado), nunca 'repo#pull#123'.

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar em `test/ui-pure.test.js` (no fim, antes de qualquer bloco de comentário final):

```js
/* ---------- prKeyFromUrl: o key canônico a partir da URL do PR ---------- */

test('prKeyFromUrl monta o key canônico owner/repo#numero', () => {
  assert.equal(P.prKeyFromUrl('https://github.com/biudtech/app/pull/123'), 'biudtech/app#123');
});

test('prKeyFromUrl não repete o defeito do slice(-3): nada de "pull" no key', () => {
  // o bug real: url.split('/').slice(-3).join('#') produzia 'repo#pull#123'
  assert.doesNotMatch(P.prKeyFromUrl('https://github.com/biudtech/app/pull/123'), /pull/);
});

test('prKeyFromUrl devolve vazio pra entrada que não é URL de PR', () => {
  assert.equal(P.prKeyFromUrl('https://github.com/biudtech/app'), '');
  assert.equal(P.prKeyFromUrl(''), '');
  assert.equal(P.prKeyFromUrl(null), '');
});
```

- [ ] **Passo 2: rodar e ver falhar**

```
node --test test/ui-pure.test.js
```

Esperado: os 3 testes novos falham com `TypeError: P.prKeyFromUrl is not a function`.

- [ ] **Passo 3: implementação mínima**

Em `ui/pure.js`, logo abaixo de `ownerFromUrl` (linha 38):

```js
// 'https://github.com/owner/repo/pull/123' -> 'owner/repo#123' (o key canônico do app)
function prKeyFromUrl(url) {
  const m = String(url || '').match(/github\.com\/([^\/]+\/[^\/]+)\/pull\/(\d+)/i);
  return m ? `${m[1]}#${m[2]}` : '';
}
```

No rodapé CommonJS (linha 230), acrescentar `prKeyFromUrl` junto de `ownerFromUrl`:

```js
    esc, fmtClock, fmtTok, fmtCompact, sysNorm, ownerFromUrl, prKeyFromUrl, repoShort, stripFence, hexToRgba,
```

Em `ui/app.js`, no handler `.act-self` (linha 1921), trocar:

```js
    const prKey = run.dataset.url.split('/').slice(-3).join('#');
```

por:

```js
    // o card já carrega o key canônico; a URL é só fallback (pura, testada)
    const card = run.closest('.mypr-card');
    const prKey = (card && card.dataset.key) || prKeyFromUrl(run.dataset.url);
```

- [ ] **Passo 4: rodar a suite inteira**

```
npm test && npm run check
```

- [ ] **Passo 5: commit**

```
fix(ui): key canônico do widget de autoanálise via prKeyFromUrl (era repo#pull#123)
```

---

### Tarefa 3.3: Botão Cancelar posta o cancelamento REAL, e o contrato de rotas UI→server vira teste (achados: M18)

**Arquivos:** Modify: `ui/app.js:109-135` (showOp guarda o descriptor `cancel`), `ui/app.js:211-217` (handler `.op-cancel`), `ui/app.js:1923-1928` (act-self passa o descriptor) | Test: `test/ui-contract.test.js` (novo)

**Interfaces:** Produz: contrato interno do sistema de ops: `showOp(opId, { cancel: { path, body } })`; o handler `.op-cancel` passa a POSTar `op.cancel.path` com `op.cancel.body` e só marca cancelado se `r.ok`. Consome: rota `/api/self-review/cancel` (Tarefa 3.1).

**Dificuldades antecipadas:**
- O teste de contrato precisa falhar AGORA por causa do `/api/cancel-op` e continuar pegando drift futuro → extração por regex das chamadas `api('/api/...')`, `get('/api/...')`, `new EventSource('/api/...')` E dos descriptors `path: '/api/...'`; comparação com os `p === '/api/...'` do http-server. Sanidade anti-extrator-cego (D6) incluída.
- Rotas com query string (`get('/api/chat?key=' + ...)`, `get('/api/deliveries?days=' + ...)`) quebrariam a comparação → o regex de captura para no `?` (`[^'?]+`), então captura `/api/chat` e `/api/deliveries`, que são exatamente os literais roteados.
- O teste NÃO valida método HTTP (GET vs POST): fora de escopo declarado no comentário do teste; o que ele caça é rota inexistente (o 404 engolido pelo `.catch(() => null)` do `api()`, ui/app.js:34).
- Duplo clique no Cancelar durante o await → `e.target.disabled = true` antes do POST.
- Resposta `null` (engine caiu) ou `ok:false` → `closeOp(opId, 'error', ...)` + toast; NUNCA mais afirmar "Cancelado" sem confirmação do servidor (era a mentira do M18).
- Ops canceláveis sem descriptor (nenhum existe hoje; o único `cancellable:true` é a autoanálise, ui/app.js:1926) → fallback documentado: fecha só o widget local, sem POST fantasma.

- [ ] **Passo 1: escrever o teste que falha**

Criar `test/ui-contract.test.js`:

```js
'use strict';
// Contrato UI↔server (Onda 3): toda rota /api que o ui/app.js chama tem que EXISTIR no
// lib/http-server.js. O bug de origem (achado M18): o botão Cancelar postava
// /api/cancel-op, rota que nunca existiu; o 404 era engolido pelo .catch(() => null) do
// api() e a sessão seguia rodando com a UI dizendo "Cancelado pelo usuário".
// Sem DOM e sem dependência: os dois arquivos são lidos como texto e conferidos por
// regex, a mesma técnica do ui-semantics.test.js. Método HTTP fica fora do escopo; o
// que se caça aqui é rota que cai no 404 silencioso.
const path = require('node:path');
const fs = require('node:fs');

const { test } = require('node:test');
const assert = require('node:assert/strict');

const APPJS = fs.readFileSync(path.join(__dirname, '..', 'ui', 'app.js'), 'utf8');
const SERVERJS = fs.readFileSync(path.join(__dirname, '..', 'lib', 'http-server.js'), 'utf8');

// chamadas da UI: api('/api/x'), get('/api/x?...'), EventSource e descriptors path: '/api/x'
function rotasChamadas() {
  const rotas = new Set();
  for (const m of APPJS.matchAll(/\b(?:api|get)\(\s*'(\/api\/[^'?]+)/g)) rotas.add(m[1]);
  for (const m of APPJS.matchAll(/new EventSource\('(\/api\/[^'?]+)'\)/g)) rotas.add(m[1]);
  for (const m of APPJS.matchAll(/path:\s*'(\/api\/[^'?]+)'/g)) rotas.add(m[1]);
  return rotas;
}
// rotas servidas: todo `p === '/api/x'` do http-server
function rotasServidas() {
  return new Set([...SERVERJS.matchAll(/p === '(\/api\/[^']+)'/g)].map(m => m[1]));
}

test('toda rota /api chamada pela UI existe no servidor', () => {
  const servidas = rotasServidas();
  const faltando = [...rotasChamadas()].filter(r => !servidas.has(r));
  assert.deepEqual(faltando, [],
    `a UI chama rotas que o servidor não roteia (cairiam no 404 engolido pelo api()): ${faltando.join(', ')}`);
});

test('o extrator de rotas não está cego (sanidade das duas pontas)', () => {
  // se uma refatoração mudar o padrão de chamada ou de roteamento, os Sets esvaziam e o
  // teste acima passaria no vazio; esta sanidade acusa a cegueira.
  const chamadas = rotasChamadas(), servidas = rotasServidas();
  assert.ok(chamadas.has('/api/decide'), 'a UI chama /api/decide');
  assert.ok(chamadas.has('/api/self-review'), 'a UI chama /api/self-review');
  assert.ok(servidas.has('/api/review'), 'o servidor roteia /api/review');
  assert.ok(servidas.has('/api/self-review/cancel'), 'o servidor roteia o cancelamento da autoanálise');
  assert.ok(chamadas.size >= 15, `a UI chama muitas rotas (achou ${chamadas.size})`);
});
```

- [ ] **Passo 2: rodar e ver falhar**

```
node --test test/ui-contract.test.js
```

Esperado: o primeiro teste falha listando `/api/cancel-op` como rota faltando. (O segundo passa, porque a rota da 3.1 já existe.)

- [ ] **Passo 3: implementação mínima**

Em `ui/app.js`, no objeto do `showOp` (linhas 111-122), acrescentar o descriptor:

```js
  const op = {
    id: opId,
    type: opts.type || 'generic',
    title: opts.title || 'Operação…',
    status: 'running',
    step: '',
    progress: 0,
    startTime: Date.now(),
    cancellable: opts.cancellable || false,
    cancel: opts.cancel || null,   // { path, body }: o POST real que o botão Cancelar dispara
    container: opts.container || document.body,
    inline: opts.inline || false
  };
```

Substituir o handler global (linhas 211-217) por:

```js
document.addEventListener('click', async (e) => {
  if (e.target.classList && e.target.classList.contains('op-cancel')) {
    const opId = e.target.dataset.opId;
    const op = ACTIVE_OPS.get(opId);
    // op sem pedido de cancelamento declarado: não há o que pedir ao servidor,
    // fecha só o widget (feedback puramente visual)
    if (!op || !op.cancel) { closeOp(opId, 'cancelled', 'Cancelado'); return; }
    e.target.disabled = true;   // evita POST duplo durante o await
    const r = await api(op.cancel.path, op.cancel.body);
    if (r && r.ok) closeOp(opId, 'cancelled', 'Cancelado pelo usuário');
    else {
      // NUNCA afirmar "cancelado" sem o servidor confirmar (a mentira do achado M18)
      closeOp(opId, 'error', (r && r.error) || 'não consegui cancelar');
      toast('error', esc((r && r.error) || 'não consegui cancelar a autoanálise'));
    }
  }
});
```

E no `showOp` do `.act-self` (linhas 1923-1928), declarar o cancelamento real:

```js
    showOp(opId, {
      type: 'analysis',
      title: `Analisando ${prKey}`,
      cancellable: true,
      cancel: { path: '/api/self-review/cancel', body: { key: prKey } },
      container: run.closest('.mypr-card') || run.parentElement
    });
```

- [ ] **Passo 4: rodar a suite inteira**

```
npm test && npm run check
```

- [ ] **Passo 5: commit**

```
fix(ui): botão Cancelar posta o cancelamento real e o contrato de rotas UI-server vira teste
```

---

### Tarefa 3.4: Ciclo de vida do widget de autoanálise: reanexar no re-render e fechar pelo snapshot (achados: M20, partes b e c)

**Arquivos:** Modify: `ui/pure.js` (nova função `analysisOpsPlan` + export), `ui/app.js:111-122` (showOp guarda `key` e `seen`), `ui/app.js:1923-1928` (act-self passa `key`), `ui/app.js` (nova função `syncAnalysisOps` perto do bloco de ops, e chamada no handler `state` após a linha 2957) | Test: `test/ui-pure.test.js`

**Interfaces:** Produz: `analysisOpsPlan(ops, snap) -> { markSeen: string[], close: string[] }`, onde `ops = [{ id, key, seen }]` e `snap = { activeSessions, headlessWaiting }` (fragmentos do snapshot que o SSE já entrega). Consome: `STATE.activeSessions` (entradas `mode === 'self'` com `keys`), `STATE.headlessWaiting` (server.js:1020-1022).

**Dificuldades antecipadas:**
- Corrida do SSE (D3): snapshot emitido antes do enqueue chegando depois do showOp → protocolo seen/close, com o caso da corrida como teste explícito (terceiro teste abaixo).
- `innerHTML` destrói o widget (D4) → reanexo por referência viva no `syncAnalysisOps` (o `op.element` fica guardado no Map; `appendChild` re-anexa).
- Fechar um op que o usuário JÁ cancelou (status 'cancelled'/'error') com `closeOp('done')` sobrescreveria a mensagem e mentiria "concluída" → no aplicador, op com `status !== 'running'` é só LIMPO (remove elemento + entrada do Map), sem closeOp; o fechamento "done" com auto-dismiss de 3s (ui/app.js:156-160) fica só pro op que ainda rodava.
- `headlessWaiting` carrega também keys de revisão normal → colisão impossível na prática (o GitHub não pede review pro próprio autor, então um key de Meus PRs não coexiste com um da fila de revisão) e o lado `activeSessions` já filtra `mode === 'self'`; documentado no comentário da função.
- Achado 47 é de outra onda (D10) → `syncAnalysisOps` filtra `type === 'analysis'`; kudos/health intocados.

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar em `test/ui-pure.test.js`:

```js
/* ---------- analysisOpsPlan: ciclo de vida do widget de autoanálise ---------- */

test('analysisOpsPlan marca seen quando o key aparece rodando ou na fila', () => {
  const snap = { activeSessions: [{ mode: 'self', keys: ['a/b#1'] }], headlessWaiting: ['c/d#2'] };
  const plan = P.analysisOpsPlan([
    { id: 'analysis-a/b#1', key: 'a/b#1', seen: false },
    { id: 'analysis-c/d#2', key: 'c/d#2', seen: false }
  ], snap);
  assert.deepEqual(plan.markSeen.sort(), ['analysis-a/b#1', 'analysis-c/d#2']);
  assert.deepEqual(plan.close, []);
});

test('analysisOpsPlan fecha só o op que JÁ foi visto e sumiu do snapshot', () => {
  const plan = P.analysisOpsPlan([
    { id: 'analysis-a/b#1', key: 'a/b#1', seen: true }
  ], { activeSessions: [], headlessWaiting: [] });
  assert.deepEqual(plan.close, ['analysis-a/b#1']);
});

test('analysisOpsPlan NÃO fecha o op recém-criado que um snapshot atrasado ainda não conhece', () => {
  // a corrida real: clique -> showOp -> chega um state emitido ANTES do servidor
  // enfileirar; sem o protocolo seen, o widget fecharia "concluído" ao nascer
  const plan = P.analysisOpsPlan([
    { id: 'analysis-a/b#1', key: 'a/b#1', seen: false }
  ], { activeSessions: [], headlessWaiting: [] });
  assert.deepEqual(plan.close, []);
  assert.deepEqual(plan.markSeen, []);
});

test('analysisOpsPlan ignora sessão de outro modo com o mesmo key', () => {
  const plan = P.analysisOpsPlan([
    { id: 'analysis-a/b#1', key: 'a/b#1', seen: true }
  ], { activeSessions: [{ mode: 'auto', keys: ['a/b#1'] }], headlessWaiting: [] });
  assert.deepEqual(plan.close, ['analysis-a/b#1'], 'mode auto não segura o widget de autoanálise');
});

test('analysisOpsPlan aguenta snapshot e lista vazios sem lançar', () => {
  assert.deepEqual(P.analysisOpsPlan([], {}), { markSeen: [], close: [] });
  assert.deepEqual(P.analysisOpsPlan(null, null), { markSeen: [], close: [] });
});
```

- [ ] **Passo 2: rodar e ver falhar**

```
node --test test/ui-pure.test.js
```

Esperado: os 5 testes novos falham com `TypeError: P.analysisOpsPlan is not a function`.

- [ ] **Passo 3: implementação mínima**

Em `ui/pure.js` (seção "dependem das folhas"):

```js
/* ---------- ops de autoanálise: decisão de fechamento ----------
   A UI cria um widget por análise lançada (opId 'analysis-<key>'), mas quem sabe o FIM
   é o snapshot do SSE: a análise some de activeSessions (mode self) e de
   headlessWaiting quando termina. Protocolo seen/close por causa da corrida: um state
   emitido antes do servidor enfileirar pode chegar depois do clique, e sem o `seen` o
   widget recém-nascido fecharia como "concluído". headlessWaiting também carrega keys
   de revisão normal, sem colisão na prática (o GitHub não pede review pro autor). */
function analysisOpsPlan(ops, snap) {
  snap = snap || {};
  const presentes = new Set();
  for (const s of (snap.activeSessions || [])) {
    if (s && s.mode === 'self') for (const k of (s.keys || [])) presentes.add(k);
  }
  for (const k of (snap.headlessWaiting || [])) presentes.add(k);
  const markSeen = [], close = [];
  for (const op of (ops || [])) {
    if (presentes.has(op.key)) { if (!op.seen) markSeen.push(op.id); }
    else if (op.seen) close.push(op.id);
  }
  return { markSeen, close };
}
```

Export no rodapé (junto de `feedLine`):

```js
    usageDayKeysBack, avatar, md, feedLine, analysisOpsPlan, delivPrRow, delivPrRowInRepo, delivRepoSubgroups,
```

Em `ui/app.js`, no objeto do `showOp` (que a 3.3 já tocou), acrescentar as duas propriedades:

```js
    cancel: opts.cancel || null,   // { path, body }: o POST real que o botão Cancelar dispara
    key: opts.key || '',           // key do PR (ops de autoanálise): liga o op ao snapshot
    seen: false,                   // o key já apareceu num snapshot? (guarda da corrida SSE)
```

No `showOp` do `.act-self`, acrescentar `key`:

```js
    showOp(opId, {
      type: 'analysis',
      title: `Analisando ${prKey}`,
      key: prKey,
      cancellable: true,
      cancel: { path: '/api/self-review/cancel', body: { key: prKey } },
      container: run.closest('.mypr-card') || run.parentElement
    });
```

Nova função em `ui/app.js`, logo depois do handler `.op-cancel` (após a linha 217 atual):

```js
/* ciclo de vida dos widgets de autoanálise: o FIM vem do snapshot (SSE), não de um
   response. Reanexa o elemento (o innerHTML de #myPRs destrói os filhos a cada
   re-render) e fecha quando a análise some do estado (analysisOpsPlan, pura, testada). */
function syncAnalysisOps() {
  const ops = [...ACTIVE_OPS.values()].filter(o => o.type === 'analysis');
  if (!ops.length) return;
  for (const op of ops) {
    if (op.element && !op.element.isConnected) {
      const card = document.querySelector(`.mypr-card[data-key="${CSS.escape(op.key)}"]`);
      if (card) card.appendChild(op.element);
    }
  }
  const plan = analysisOpsPlan(ops.map(o => ({ id: o.id, key: o.key, seen: !!o.seen })), STATE || {});
  for (const id of plan.markSeen) { const op = ACTIVE_OPS.get(id); if (op) op.seen = true; }
  for (const id of plan.close) {
    const op = ACTIVE_OPS.get(id);
    if (!op) continue;
    if (op.status === 'running') closeOp(id, 'done', 'Análise concluída');
    else { if (op.element) op.element.remove(); ACTIVE_OPS.delete(id); }  // cancelado/erro: só limpa
  }
}
```

E no handler `state` do SSE (linha 2948-2958), acrescentar a chamada depois dos renders:

```js
    renderActive(); renderDecisions(); renderQueue(); renderMyPRs(); renderPanorama(); renderSilenced();
    renderRadarNav();
    syncAnalysisOps();
```

- [ ] **Passo 4: rodar a suite inteira**

```
npm test && npm run check
```

- [ ] **Passo 5: commit**

```
fix(ui): widget de autoanálise sobrevive ao re-render e fecha pelo snapshot (fim do vazamento em ACTIVE_OPS)
```

---

### Tarefa 3.5: A paleta de comandos volta a decidir de verdade: decide() real (achados: A5)

**Arquivos:** Modify: `ui/app.js:1077-1090` (cmdStatic), `ui/app.js:1151-1153` (onclick dos itens), `ui/app.js:2900-2917` (handler `#decisions` passa a usar o mesmo caminho), nova função `decide`/`decideComConfirmacao` antes do `cmdStatic` | Test: `test/ui-contract.test.js`

**Interfaces:** Produz: `decide(id, action) -> Promise<r>` (POSTa `/api/decide`, toast de erro se `!r.ok`); `async decideComConfirmacao(id, action, ref) -> Promise<r|{ok:false}>` (modal de confirmação antes do REQUEST_CHANGES, mesmo texto do card). Consome: `api('/api/decide')` (rota existente, lib/http-server.js:91), `confirmModal` (ui/app.js:50).

**Dificuldades antecipadas:**
- A paleta era código MORTO (ReferenceError): consertar o nome sem mais nada HABILITARIA postar REQUEST_CHANGES no GitHub sem confirmação, proteção que o card tem (ui/app.js:2905-2913) → `decideComConfirmacao` reusa o mesmo modal com o mesmo texto; approve segue direto (como no card).
- `run()` lançando dentro do onclick impedia até o `cmdClose()` (a paleta ficava aberta) e rejeição de promise era engolida → inverter a ordem (fecha a paleta ANTES de rodar) e encadear `.catch` com toast; os runs de navegação (switchTab etc.) não dependem da paleta aberta.
- Nome `decide` pode colidir com algo existente → verificado por grep: as únicas ocorrências de `decide` no app.js são a paleta (1083/1089), prosa de release notes e a string '/api/decide'; sem colisão.
- Teste grep frágil (D6) → padrões ancorados em nome de função e no formato `run: () => decideComConfirmacao(`, estáveis; se o cmdStatic for refatorado, o teste quebra ALTO apontando a linha, que é o comportamento desejado num contrato.

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar em `test/ui-contract.test.js`:

```js
test('a paleta de comandos usa funções de decisão que EXISTEM no app.js', () => {
  // regressão do achado A5: cmdStatic montava run: () => decide(...) e nenhum decide
  // existia em script carregado; o clique morria em ReferenceError silencioso e o
  // usuário achava que tinha aprovado
  assert.match(APPJS, /function decide\(/, 'decide() definida');
  assert.match(APPJS, /async function decideComConfirmacao\(/, 'decideComConfirmacao() definida');
  assert.match(APPJS, /run: \(\) => decideComConfirmacao\(/, 'a paleta chama a versão com confirmação');
});

test('o clique num item da paleta fecha a paleta ANTES de rodar e captura a rejeição', () => {
  // sem isto, um run() que lança trava a paleta aberta e a promise rejeita em silêncio
  assert.match(APPJS, /cmdClose\(\); Promise\.resolve\(\)\.then\(\(\) => items\[idx\]\.run\(\)\)\.catch\(/);
});
```

- [ ] **Passo 2: rodar e ver falhar**

```
node --test test/ui-contract.test.js
```

Esperado: os 2 testes novos falham nos `assert.match` (as funções não existem e o onclick ainda é `items[idx].run(); cmdClose();`).

- [ ] **Passo 3: implementação mínima**

Em `ui/app.js`, antes do comentário da paleta (antes da linha 1070):

```js
/* decisão pendente: caminho ÚNICO de POST, usado pelo card (#decisions) e pela paleta.
   O achado A5: a paleta chamava um decide() que nunca existiu (ReferenceError engolido). */
function decide(id, action) {
  return api('/api/decide', { id, action }).then(r => {
    if (!r || !r.ok) toast('error', esc((r && r.error) || 'não consegui registrar a decisão'));
    return r;
  });
}
// a paleta não tem o modal do card, então o REQUEST_CHANGES ganha a MESMA confirmação
async function decideComConfirmacao(id, action, ref) {
  if (action === 'request_changes') {
    const ok = await confirmModal({
      title: `Pedir mudanças em ${ref || 'este PR'}?`, danger: true, confirmLabel: 'Pedir mudanças', cancelLabel: 'Cancelar',
      body: `<p>Isso <b>posta um REQUEST CHANGES no GitHub</b>, visível pra todo mundo do PR, com os pontos que a revisão levantou.</p>`
    });
    if (!ok) return { ok: false };
  }
  return decide(id, action);
}
```

No `cmdStatic` (linhas 1079-1090), trocar o bloco das decisões por:

```js
  ...(STATE?.decisions?.pending || []).flatMap(d => {
    const ref = d.key || '';
    const acao = (rotulo, action) => ({
      kind: 'decisão', label: `${rotulo} ${ref}`, hint: 'decisão',
      run: () => decideComConfirmacao(d.id, action, ref)
    });
    return [acao('Aprovar', 'approve'), acao('Pedir mudanças em', 'request_changes')];
  }),
  ...((STATE?.decisions?.pending || []).length > 1
    ? [{ kind: 'lote', label: `Aprovar as ${STATE.decisions.pending.length} pendentes`, hint: 'lote',
        run: async () => { for (const d of [...STATE.decisions.pending]) await decide(d.id, 'approve'); } }]
    : []),
```

No onclick dos itens (linhas 1151-1153):

```js
    [...list.querySelectorAll('.cmd-item')].forEach((el, idx) => {
      el.onclick = () => { cmdClose(); Promise.resolve().then(() => items[idx].run()).catch(err => toast('error', esc((err && err.message) || 'a ação falhou'))); };
    });
```

No handler `#decisions` (linha 2915), unificar o POST no mesmo caminho:

```js
  btn.disabled = true;
  const r = await decide(id, action);
  if (!r?.ok) btn.disabled = false;
```

- [ ] **Passo 4: rodar a suite inteira**

```
npm test && npm run check
```

- [ ] **Passo 5: commit**

```
fix(ui): paleta de comandos decide de verdade (decide real, confirmação no request_changes)
```

---

### Tarefa 3.6: Pushback pendente confirmável num clique (achados: M21)

**Arquivos:** Modify: `ui/pure.js` (recebe `PB_OPTS`, `PB_SHORT` e `pushbackControl(r, pushbacks)` + exports), `ui/app.js:1528-1551` (remove as três declarações), `ui/app.js:1594` (call site passa `STATE.pushbacks`), `ui/app.js:1552-1562` (submitPushback ganha re-render), `ui/app.js:685-688` (novo listener de click pro botão) | Test: `test/ui-pure.test.js`

**Interfaces:** Produz: `pushbackControl(r, pushbacks) -> string` (HTML; ASSINATURA NOVA: o mapa de pushbacks entra por parâmetro, era lido de `STATE` via `pushbackOf`). Consome: `esc` (mesmo arquivo). Único chamador (`renderResolved`, ui/app.js:1594) atualizado na mesma edição.

**Dificuldades antecipadas:**
- `const` redeclarado entre pure.js e app.js lança SyntaxError no load do navegador e o `npm run check` NÃO pega (D7) → a mesma edição remove `PB_OPTS`/`PB_SHORT`/`pushbackControl` do app.js; verificação extra no passo 4: `grep -n "const PB_OPTS\|const PB_SHORT\|function pushbackControl" ui/app.js ui/pure.js` tem que listar só o pure.js.
- `pushbackOf` lia `STATE` (global proibida no pure.js) → o mapa entra por parâmetro (`pushbacks`), seguindo a regra escrita no cabeçalho do pure.js ("se quiser trazer, passe o que ela lê como parâmetro"); `pushbackOf` do app.js fica sem uso e SAI junto (era usada só ali, verificado por grep).
- Confirmar precisa refletir na tela sem esperar o próximo ciclo → `submitPushback` ganha `renderResolved()` no fim; a guarda de foco do próprio `renderResolved` (ui/app.js:1566-1567) impede roubo de foco quando o gatilho foi o change do select/nota (o foco está em SELECT/INPUT), e no clique do botão o re-render é exatamente o que se quer (o controle vira "confirmado" na hora).
- Confirmar com a opção '' ("sem pushback") deleta o registro → comportamento coerente com o select de hoje (o usuário está dizendo que o palpite do Farol era falso positivo); documentado no comentário do botão.
- O `change` continua funcionando como antes pra quem ESCOLHE outra opção → o botão é um caminho ADICIONAL, só renderizado no estado pending; zero mudança pros registros confirmados.

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar em `test/ui-pure.test.js`:

```js
/* ---------- pushbackControl: o controle de pushback nas Revisões recentes ---------- */

test('pushback pendente traz o botão Confirmar e o desfecho sugerido já selecionado', () => {
  // achado M21: re-selecionar a opção já selecionada não dispara change, então sem um
  // botão o caminho "confirme num toque" prometido pela hint não existia
  const html = P.pushbackControl(
    { key: 'a/b#1', pr: { author: 'dev' } },
    { 'a/b#1': { outcome: 'author_right', status: 'pending', source: 'auto', note: 'palpite' } }
  );
  assert.match(html, /pb-confirm/, 'tem o botão Confirmar');
  assert.match(html, /value="author_right" selected/, 'o desfecho sugerido vem selecionado');
  assert.match(html, /data-pending="1"/, 'o details nasce aberto no estado pendente');
});

test('pushback confirmado NÃO mostra o botão Confirmar', () => {
  const html = P.pushbackControl(
    { key: 'a/b#1', pr: { author: 'dev' } },
    { 'a/b#1': { outcome: 'author_right', status: 'confirmed', source: 'manual' } }
  );
  assert.doesNotMatch(html, /pb-confirm/);
});

test('pushbackControl sem autor devolve vazio e sem registro rende o convite padrão', () => {
  assert.equal(P.pushbackControl({ key: 'a/b#1' }, {}), '');
  assert.match(P.pushbackControl({ key: 'a/b#1', pr: { author: 'dev' } }, {}), /pushback\?/);
});

test('pushbackControl escapa a nota vinda do classificador', () => {
  const html = P.pushbackControl(
    { key: 'a/b#1', pr: { author: 'dev' } },
    { 'a/b#1': { outcome: 'mixed', status: 'pending', source: 'auto', note: '<img src=x onerror=alert(1)>' } }
  );
  assert.doesNotMatch(html, /<img/);
});
```

- [ ] **Passo 2: rodar e ver falhar**

```
node --test test/ui-pure.test.js
```

Esperado: os 4 testes novos falham com `TypeError: P.pushbackControl is not a function`.

- [ ] **Passo 3: implementação mínima**

Em `ui/pure.js` (seção "dependem das folhas"), colar as constantes e a função com a assinatura nova e o botão:

```js
/* ---------- pushback: o controle das Revisões recentes ----------
   Saiu do app.js pra ganhar teste; o mapa de pushbacks entra por parâmetro
   (era lido de STATE, global proibida aqui). */
const PB_OPTS = [['', 'sem pushback'], ['author_right', 'o autor tinha razão'], ['we_right', 'nós tínhamos razão'], ['mixed', 'meio-termo']];
const PB_SHORT = { author_right: 'autor tinha razão', we_right: 'nós tínhamos razão', mixed: 'meio-termo' };
function pushbackControl(r, pushbacks) {
  const author = (r.pr && r.pr.author) || r.author || '';
  if (!author) return '';
  const pb = (pushbacks || {})[r.key] || null;
  const pending = pb && pb.status === 'pending';    // auto em dúvida: pede confirmação
  const sum = pending ? `↩ confirmar: ${esc(PB_SHORT[pb.outcome] || 'pushback')}?`
    : pb ? `↩ ${esc(PB_SHORT[pb.outcome] || 'pushback')}${pb.source === 'auto' ? ' (auto)' : ''}`
      : '↩ pushback?';
  const title = pending ? 'O Farol suspeita de pushback aqui; confirme ou corrija o desfecho'
    : 'Marque se o autor contestou este review, pra calibrar os reviews futuros dele';
  return `<details class="pushback"${pb ? ' data-set="1"' : ''}${pending ? ' data-pending="1" open' : ''}>
    <summary title="${title}">${sum}</summary>
    <div class="pb-body">
      ${pending ? `<span class="pb-hint">O Farol detectou possível pushback${pb.note ? ` (${esc(pb.note)})` : ''}. Confirme o desfecho:</span>` : ''}
      <select class="pb-outcome" data-key="${esc(r.key)}" data-author="${esc(author)}">
        ${PB_OPTS.map(([v, t]) => `<option value="${v}"${pb && pb.outcome === v ? ' selected' : ''}>${t}</option>`).join('')}
      </select>
      <input class="pb-note" data-key="${esc(r.key)}" data-author="${esc(author)}" value="${esc(pb && pb.note || '')}" placeholder="nota curta (opcional)" spellcheck="false" maxlength="300">
      ${pending ? `<button class="btn sm primary pb-confirm" data-key="${esc(r.key)}" data-author="${esc(author)}" title="Grava o desfecho selecionado como confirmado (re-selecionar a mesma opção não dispara change; com '' confirma que NÃO houve pushback)">Confirmar</button>` : ''}
    </div>
  </details>`;
}
```

Export no rodapé:

```js
    deliveriesByRepo, deliveriesByAuthor, pushbackControl, PB_OPTS, PB_SHORT
```

Em `ui/app.js`: REMOVER as linhas 1528-1531 (`PB_OPTS`, `PB_SHORT`, `pushbackOf`) e a função `pushbackControl` inteira (1531-1551), deixando o comentário de seção apontando pro pure.js:

```js
/* ---------- pushback: PB_OPTS/PB_SHORT/pushbackControl moraram aqui e foram pro
   ui/pure.js (testáveis); o submit e os listeners seguem aqui por tocarem DOM/STATE ---------- */
```

No call site (linha 1594):

```js
      ${pushbackControl(r, STATE.pushbacks || {})}
```

No `submitPushback` (fim, após a linha 1561):

```js
  api('/api/pushback', { key, author, outcome, note: noteVal });
  renderResolved();   // reflete na hora (a guarda de foco segura o caso do change no select/nota)
```

Novo listener junto do change (após a linha 688):

```js
/* confirmar o palpite re-selecionando a MESMA opção não dispara change; o botão cobre
   o caminho pending -> confirmed com o desfecho sugerido (achado M21) */
$('#resolved').addEventListener('click', (e) => {
  const btn = e.target.closest('.pb-confirm');
  if (btn) submitPushback(btn);
});
```

- [ ] **Passo 4: rodar a suite inteira** (mais a checagem anti-redeclaração da D7)

```
npm test && npm run check
grep -n "const PB_OPTS\|const PB_SHORT\|function pushbackControl" ui/app.js ui/pure.js
```

Esperado: suite verde e o grep listando as três declarações SÓ em `ui/pure.js`.

- [ ] **Passo 5: commit**

```
fix(ui): pushback pendente confirma num clique (pushbackControl pura + botão Confirmar)
```

---

### Tarefa 3.7: Revisar tudo sem fallback pra fila inteira (achados: B22)

**Arquivos:** Modify: `lib/http-server.js:82-85` (rota `/api/review` valida `urls`), `ui/app.js:2828-2832` (btnReviewAll nunca posta vazio) | Test: `test/http.test.js` (reusa o `post` da Tarefa 3.1)

**Interfaces:** Produz: contrato novo do `POST /api/review`: `urls` é OBRIGATÓRIO (array de strings não-vazio); sem ele, 400 com mensagem explicativa; o comportamento "sem urls = revisa a fila inteira" DEIXA DE EXISTIR. Consome: `engine.launchReview(urls, mode)` (inalterado).

**Dificuldades antecipadas:**
- Chamador escondido dependendo do default (D5) → grep no repo inteiro provou que só `ui/app.js` chama `/api/review` (panorama:2876, queue:2888/2890, reviewAll:2831), todos com `urls` explícito exceto o `{}` do bug; o 400 com mensagem explica o contrato pra qualquer script externo.
- Testar o caminho feliz por HTTP dispararia `launchReview` de verdade (refreshTokens, gh, sessão headless) → os testes cobrem SÓ a recusa (400 com `{}`, com `urls: []` e com `urls` de tipo errado), que não toca o engine; o caminho feliz já é coberto pelos testes de engine existentes (launchReview em test/fanout.test.js e afins).
- A corrida real do achado (SSE esvazia a fila entre o render e o clique) segue possível → por isso a defesa é DUPLA: a UI não posta vazio (e avisa com toast), e o servidor recusa vazio mesmo assim (defesa em profundidade, mesmo padrão das 3 camadas do sanitizeModel).
- `p === '/api/review'` é igualdade estrita, então `/api/reviewer-candidates` (linha 67) não é afetada.

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar em `test/http.test.js`:

```js
test('POST /api/review sem urls é recusado com 400 (o fallback "fila inteira" morreu)', async () => {
  // achado B22: a UI mandava {} quando a fila visível esvaziava entre o render e o
  // clique, e o servidor interpretava ausência de urls como "revise TUDO", inclusive
  // PRs de outras contas que o escopo escondia
  const r = await post('/api/review', {});
  assert.equal(r.status, 400);
  assert.match(JSON.parse(r.body).error, /urls/);
});

test('POST /api/review com urls vazio ou de tipo errado também é recusado', async () => {
  assert.equal((await post('/api/review', { urls: [] })).status, 400);
  assert.equal((await post('/api/review', { urls: 'https://github.com/a/b/pull/1' })).status, 400);
});
```

- [ ] **Passo 2: rodar e ver falhar**

```
node --test test/http.test.js
```

Esperado: os 2 testes novos falham. Atenção ao modo da falha: com `{}` o servidor de HOJE cai no fallback `engine.queue.map(...)` com fila vazia e chama `launchReview([])`, devolvendo 200; o teste espera 400.

- [ ] **Passo 3: implementação mínima**

Em `lib/http-server.js` (linhas 82-85):

```js
        if (p === '/api/review') {
          // contrato explícito: a UI SEMPRE manda a lista de PRs. O fallback antigo
          // (sem urls = fila inteira) fazia um {} acidental revisar PRs de todas as
          // contas, fora do escopo visível (achado B22).
          const urls = Array.isArray(body.urls) ? body.urls.filter(u => typeof u === 'string' && u) : [];
          if (!urls.length) return send(400, { error: 'urls é obrigatório: a lista explícita das URLs dos PRs a revisar' });
          return send(200, await engine.launchReview(urls, body.mode === 'terminal' ? 'terminal' : 'auto'));
        }
```

Em `ui/app.js` (linhas 2828-2832):

```js
$('#btnReviewAll').onclick = () => {
  // revisa só o que está visível no escopo atual; a lista vai SEMPRE explícita
  // (mandar {} fazia o servidor revisar a fila INTEIRA, achado B22)
  const urls = (STATE.queue || []).filter(scopeVisible).map(p => p.url);
  if (!urls.length) { toast('info', 'Nada visível pra revisar agora (a fila mudou embaixo do botão).'); return; }
  api('/api/review', { urls });
};
```

- [ ] **Passo 4: rodar a suite inteira**

```
npm test && npm run check
```

- [ ] **Passo 5: commit**

```
fix(review): POST /api/review exige urls explícito (fim do fallback pra fila inteira)
```

---

## Fechamento da onda

Ordem de execução: 3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 3.7 (a cadeia 3.1→3.3→3.4 tem dependência real: rota antes do botão, botão antes do ciclo de vida; 3.5/3.6/3.7 são independentes entre si, mas o teste de contrato da 3.3 já protege as rotas que elas tocam). Ao final da onda: `npm run check && npm test` verde com 335 testes antigos + os novos (4 selfpr-cancel, 3 http, 12 ui-pure, 4 ui-contract), e verificação manual num `FAROL_HOME` isolado (`FAROL_HOME=/tmp/farol-teste node server.js`, `autoReview` desligado): paleta Ctrl+K aprova pendente; Analisar em Meus PRs mostra widget com key certo, Cancelar de verdade e fechamento no fim; pushback pendente confirma no botão; Revisar tudo com fila esvaziada mostra o toast em vez de revisar tudo.
