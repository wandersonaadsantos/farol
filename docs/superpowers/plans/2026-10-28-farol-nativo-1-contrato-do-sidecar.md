# Contrato do sidecar no motor: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** fazer o motor Node do Farol subir como sidecar de uma casca nativa (Mac ou Windows), autenticá-la, emitir os eventos que ela exibe, escolher a própria versão em `~/.farol/engine/` e aceitar bind fora do loopback, sem mudar nenhuma regra de produto.

**Architecture:** tudo é adição ao motor existente: um modo novo em `lib/paths.js` (`FAROL_SHELL`), um arquivo de descoberta em `state/`, uma classe de sessão da A4, um módulo puro que transforma os eventos do engine em avisos prontos, três eventos novos no SSE, um bootstrap de versão no topo do `server.js`, um ramo de update e um bind configurável. O `main.js` do Electron continua funcionando até o plano 4 retirá-lo.

**Tech Stack:** Node 24 puro (ESM, zero deps), `node --test` via `npm test`, gate `npm run check && npm run lint && npm test`.

**Spec:** `docs/superpowers/specs/2026-10-27-farol-nativo-swiftui-winui-design.md` (seções 4.1, 4.5, 4.6, 7) e o índice `docs/superpowers/plans/2026-10-28-farol-nativo-indice.md` (interfaces fixadas).

## Global Constraints

- Nenhuma dependência npm nova (invariante 1). Node `>=24.22.1 <25` (`nvm use 24.22.1`).
- Texto de UI, comentários e mensagens em português, sem travessão (invariante 6).
- Nenhuma regra de produto lê o modo casca: gates, postagem e política não mudam (invariante 4).
- Log só de falhas (invariante 3). Dados em `~/.farol` (invariante 2).
- Diferença de SO só por `IS_WIN`/`IS_MAC`/`IS_LINUX` de `lib/paths.js` (invariante 5).
- Rota nova em `/api` precisa de classe em `lib/local-auth/inventario.js` (este plano não cria rota nova).
- Antes de cada commit: `npm run check && npm run lint && npm test` verdes. O `lint` é ratchet: nenhuma contagem de `tools/quality/baseline.json` pode subir (sem `JSON.parse` cru, sem `process.env` direto fora de `lib/paths.js`, sem número de tempo solto fora de `lib/constants.js`).
- Commits em português, no formato `tipo(escopo): assunto`, sem trailer de coautoria (regra global do autor).
- Branch de trabalho: `feat/contrato-do-sidecar`, a partir de `main`.

## Review Focus

1. **`FAROL_SHELL` com valor fora de `mac`/`win`** (ex. `linux`, `1`, vazio com espaços): `modoCasca()` deve devolver `''` e o motor subir como hoje; teste na Task 1.
2. **`state/casca.json` deixado por um motor que morreu** (pid morto, porta sem Farol): a casca nova sobe o sidecar e o motor sobrescreve o arquivo; o código antigo não pode parear ninguém. Teste na Task 3 (código consumido ou vencido recusa).
3. **Pasta `~/.farol/engine/<versão>/` corrompida ou sem `package.json`**: o bootstrap ignora a pasta e sobe o motor semeado, registrando WARN; teste na Task 6.
4. **`engines.farolShell` ausente no `package.json` do motor atualizado** (pacote leve antigo): tratado como incompatível e a pasta ignorada; teste na Task 6.
5. **`config.bind` com valor que não é IP nem nome de host** (ex. `0.0.0.0:80`, `http://x`): saneado para `127.0.0.1`; teste na Task 8.

---

### Task 1: `modoCasca()` e `versaoDaCasca()` em `lib/paths.js`

**Files:**
- Modify: `lib/paths.js` (ao lado de `modoServidor`, linha 64, e nos dois `export` do fim)
- Test: `test/modo-casca.test.js`

**Interfaces:**
- Produces: `modoCasca(env = process.env) -> '' | 'mac' | 'win'` e `versaoDaCasca(env = process.env) -> string` (vazia quando ausente ou inválida; válida é `X.Y.Z`).

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modoCasca, versaoDaCasca, modoServidor } from '../lib/paths.js';

test('modoCasca lê FAROL_SHELL e só aceita mac e win', () => {
  assert.equal(modoCasca({ FAROL_SHELL: 'mac' }), 'mac');
  assert.equal(modoCasca({ FAROL_SHELL: 'win' }), 'win');
  assert.equal(modoCasca({ FAROL_SHELL: ' MAC ' }), 'mac', 'tolera caixa e espaço');
  for (const v of ['linux', '1', '', '   ', undefined]) assert.equal(modoCasca({ FAROL_SHELL: v }), '', `recusa ${JSON.stringify(v)}`);
  assert.equal(modoCasca({}), '');
});

test('versaoDaCasca exige X.Y.Z', () => {
  assert.equal(versaoDaCasca({ FAROL_SHELL_VERSION: '3.0.0' }), '3.0.0');
  for (const v of ['3.0', 'v3.0.0', '', undefined]) assert.equal(versaoDaCasca({ FAROL_SHELL_VERSION: v }), '');
});

test('modo casca não é modo servidor nem Electron', () => {
  assert.equal(modoServidor(undefined), true, 'sem Electron continua sendo servidor para o update de hoje');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/modo-casca.test.js`
Expected: FAIL com `modoCasca is not a function` (ou export ausente).

- [ ] **Step 3: Implement `modoCasca(env)` and `versaoDaCasca(env)` in `lib/paths.js`**

Mesmo estilo de `atualizacaoExterna(env = process.env)`: funções puras com `env` por parâmetro (é o único arquivo onde `process.env` direto não conta no ratchet). Comentário de cabeçalho dizendo que o modo casca é lido pela casca nativa (desenho 4.1 item 1). Acrescentar os dois nomes nos dois blocos de export.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/modo-casca.test.js`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/paths.js test/modo-casca.test.js
git commit -m "feat(casca): modoCasca e versaoDaCasca em lib/paths.js"
```

---

### Task 2: A4 exigida no modo casca

**Files:**
- Modify: `lib/local-auth/modo.js:29-32` (`exigeAutenticacao`)
- Modify: `lib/local-auth/acesso.js:24-27` (`exigida`)
- Test: `test/casca-autenticacao.test.js`

**Interfaces:**
- Consumes: `modoCasca()` (Task 1).
- Produces: `exigeAutenticacao({ modoCelular, config, ativacaoAutomatica, modoCasca })` devolve `true` quando `modoCasca` é `'mac'` ou `'win'`, mantendo o resto igual.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exigeAutenticacao } from '../lib/local-auth/modo.js';

test('a casca nativa exige autenticação mesmo no desktop e sem localAuth', () => {
  assert.equal(exigeAutenticacao({ modoCelular: false, config: {}, ativacaoAutomatica: true, modoCasca: 'mac' }), true);
  assert.equal(exigeAutenticacao({ modoCelular: false, config: {}, ativacaoAutomatica: true, modoCasca: 'win' }), true);
});

test('sem casca nada muda no desktop', () => {
  assert.equal(exigeAutenticacao({ modoCelular: false, config: {}, ativacaoAutomatica: true, modoCasca: '' }), false);
  assert.equal(exigeAutenticacao({ modoCelular: false, config: {}, ativacaoAutomatica: true }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/casca-autenticacao.test.js`
Expected: FAIL no primeiro `assert.equal` (`false !== true`).

- [ ] **Step 3: Implement**

Em `modo.js`, acrescentar o parâmetro `modoCasca = ''` e a linha `if (modoCasca === 'mac' || modoCasca === 'win') return true;` antes do ramo do celular. Em `acesso.js`, `exigida(config)` passa `modoCasca: modoCasca()` importado de `../paths.js`. Atualizar o comentário de cabeçalho de `modo.js` (o modo casca é propriedade do processo, igual ao celular).

- [ ] **Step 4: Run tests**

Run: `npm test -- test/casca-autenticacao.test.js test/local-auth-modo.test.js test/local-auth-inventario.test.js`
Expected: PASS em todos.

- [ ] **Step 5: Commit**

```bash
git add lib/local-auth/modo.js lib/local-auth/acesso.js test/casca-autenticacao.test.js
git commit -m "feat(casca): A4 exigida quando o motor sobe como sidecar"
```

---

### Task 3: código de pareamento e sessão da classe `casca`

**Files:**
- Modify: `lib/local-auth/pareamento.js:33-80` (`criarCodigo`, `tentarCodigo`, `consumirCodigo`)
- Modify: `lib/local-auth/sessoes.js:21-33` (`viva`, `emitirSessao`)
- Modify: `lib/local-auth/acesso.js:83-90` (`parear`)
- Test: `test/casca-sessao.test.js`

**Interfaces:**
- Produces: `criarCodigo(agora, { classe = '' } = {}) -> { codigo, expiraEm }` (o registro guarda `classe`); `tentarCodigo(codigo, agora) -> { ok, classe, code?, restantes? }`; `emitirSessao(rotulo, agora, { classe = '' } = {}) -> token`; sessão com `classe: 'casca'` ignora `SESSAO_LOCAL_ABSOLUTA_MS` e continua sujeita a `SESSAO_LOCAL_OCIOSA_MS`; `parear(body)` emite a sessão com a classe do código.

- [ ] **Step 1: Write the failing test** (usar `FAROL_HOME` temporário como em `test/local-auth-sessoes.test.js`)

```js
test('código da classe casca gera sessão da classe casca', () => {
  const { codigo } = criarCodigo(Date.now(), { classe: 'casca' });
  const r = parear({ codigo, rotulo: 'Farol.app' });
  assert.equal(r.ok, true);
  const sessoes = listarSessoes();
  assert.equal(sessoes.at(-1).classe, 'casca');
  assert.equal(sessoes.at(-1).rotulo, 'Farol.app');
});

test('sessão casca sobrevive aos 90 dias absolutos, mas não a 30 dias ociosa', () => {
  const t0 = Date.now();
  const token = emitirSessao('casca', t0, { classe: 'casca' });
  assert.equal(verificarSessao(token, t0 + TEMPOS.SESSAO_LOCAL_ABSOLUTA_MS + 1), true, 'usada a cada dia, não vence');
  assert.equal(verificarSessao(token, t0 + TEMPOS.SESSAO_LOCAL_ABSOLUTA_MS + 1 + TEMPOS.SESSAO_LOCAL_OCIOSA_MS), false, 'ociosa vence');
});

test('sessão comum continua vencendo nos 90 dias', () => {
  const t0 = Date.now();
  const token = emitirSessao('navegador', t0);
  assert.equal(verificarSessao(token, t0 + TEMPOS.SESSAO_LOCAL_ABSOLUTA_MS + 1), false);
});

test('código consumido ou vencido não pareia (sidecar órfão)', () => {
  const { codigo } = criarCodigo(Date.now(), { classe: 'casca' });
  assert.equal(parear({ codigo }).ok, true);
  assert.equal(parear({ codigo }).ok, false, 'uso único');
  const { codigo: c2 } = criarCodigo(Date.now() - TEMPOS.PAREAMENTO_VALIDADE_MS - 1, { classe: 'casca' });
  assert.equal(tentarCodigo(c2).ok, false, 'vencido');
});
```

Observação para o segundo teste: `verificarSessao` só grava `ultimoUsoEm` a cada `SESSAO_LOCAL_TOQUE_MS`; para simular "usada a cada dia", chamar `verificarSessao` em laço a cada `SESSAO_LOCAL_OCIOSA_MS / 2` até passar dos 90 dias.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/casca-sessao.test.js`
Expected: FAIL (`classe` undefined na sessão; sessão casca vencida aos 90 dias).

- [ ] **Step 3: Implement**

`pareamento.js`: `criarCodigo` grava `classe` no registro; `tentarCodigo` e `consumirCodigo` devolvem `classe` junto de `ok`. `sessoes.js`: `viva` pula a linha do absoluto quando `sessao.classe === 'casca'`; `emitirSessao` grava `classe`. `acesso.js`: `parear` passa `tentativa.classe` para `emitirSessao`. `listarSessoes` passa a expor `classe` (a tela de sessões de `ui/` mostra o rótulo, que já diz "Farol.app").

- [ ] **Step 4: Run tests**

Run: `npm test -- test/casca-sessao.test.js test/local-auth-sessoes.test.js test/local-auth-pareamento.test.js test/local-auth-http.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/local-auth/pareamento.js lib/local-auth/sessoes.js lib/local-auth/acesso.js test/casca-sessao.test.js
git commit -m "feat(casca): código e sessão da classe casca na autenticação local"
```

---

### Task 4: `state/casca.json`, gravado pelo motor ao subir como sidecar

**Files:**
- Create: `lib/engine/casca-arquivo.js`
- Modify: `server.js` (callback de `start`, linha ~2249, e o tratamento de SIGTERM/SIGINT existente)
- Modify: `lib/paths.js` (constante `CASCA_FILE = path.join(STATE_DIR, 'casca.json')`, exportada)
- Test: `test/casca-arquivo.test.js`

**Interfaces:**
- Consumes: `modoCasca()` (Task 1), `criarCodigo(agora, { classe: 'casca' })` (Task 3), `APP_VERSION`.
- Produces: `gravarCasca({ porta, pid, versao, codigoPareamento, iniciadoEm, proximaVersao = null }) -> void` (atômico, modo 0600, via `writeJsonAtomic` de `lib/io.js` e `gravarRestrito` de `lib/local-auth/arquivo.js`); `lerCasca() -> objeto | null`; `apagarCasca() -> void`; `publicarCasca(engine, porta) -> void` (monta o objeto, cria o código e grava); `marcarProximaVersao(versao) -> void`.

- [ ] **Step 1: Write the failing test**

```js
test('publicarCasca grava porta, pid, versão e um código de uso único com 0600', () => {
  publicarCasca({ config: {} }, 47191);
  const c = lerCasca();
  assert.equal(c.porta, 47191); assert.equal(c.pid, process.pid); assert.equal(c.versao, APP_VERSION);
  assert.equal(c.codigoPareamento.length, LOCAL_AUTH.CODIGO_TAMANHO, 'o formato é o de gerarCodigo(): CODIGO_TAMANHO letras do ALFABETO, sem hífen');
  assert.equal(c.proximaVersao, null);
  if (!IS_WIN) assert.equal(fs.statSync(CASCA_FILE).mode & 0o777, 0o600);
  assert.equal(tentarCodigo(c.codigoPareamento).ok, true);
  assert.equal(tentarCodigo(c.codigoPareamento).classe, 'casca');
});

test('marcarProximaVersao preserva o resto e apagarCasca remove', () => {
  publicarCasca({ config: {} }, 1);
  marcarProximaVersao('2.80.0');
  assert.equal(lerCasca().proximaVersao, '2.80.0'); assert.equal(lerCasca().porta, 1);
  apagarCasca(); assert.equal(lerCasca(), null);
});

test('lerCasca com arquivo corrompido devolve null', () => {
  fs.writeFileSync(CASCA_FILE, '{nope'); assert.equal(lerCasca(), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/casca-arquivo.test.js`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implement `lib/engine/casca-arquivo.js` and wire it in `server.js`**

No `start()` do `server.js`, dentro do callback em que o servidor já respondeu (`url` sem `err`), se `modoCasca()`: `publicarCasca(engine, server.address().port)`; em `sair()` (chamada pelos `process.once` de `SIGINT`, `SIGTERM` e `beforeExit`, `server.js:2221-2223`): `apagarCasca()`. No caso `err` (porta ocupada) não gravar nada: a casca reconhece o Farol vivo pelo `GET /api/auth/status`.

- [ ] **Step 4: Run tests**

Run: `npm test -- test/casca-arquivo.test.js test/boot.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/casca-arquivo.js lib/paths.js server.js test/casca-arquivo.test.js
git commit -m "feat(casca): state/casca.json com porta, pid e código de pareamento"
```

---

### Task 5: `lib/engine/avisos-nativos.js` (puro) e os eventos `aviso-nativo` e `casca` no SSE

**Files:**
- Create: `lib/engine/avisos-nativos.js`
- Create: `test/fixtures/casca/eventos.json` (gerado pelo teste, ver Step 3)
- Modify: `lib/http-server.js:176-195` (broadcasts) e `:262-263` (envio inicial na conexão)
- Modify: `main.js` (opcional nesta task: NÃO mexer; o Electron segue com `wireEngine()` até o plano 4)
- Test: `test/avisos-nativos.test.js`, `test/casca-sse.test.js`

**Interfaces:**
- Consumes: `interventionEvent`, `quietNow` de `ui/pure/interventions.js`; `reasonText` de `lib/format.js`; `tituloDePrsNovos` (migra do `main.js:259-262` para cá).
- Produces:
  - `avisoDe(evento, payload, { config, agora = Date.now() }) -> { titulo, corpo, url, pr, silencioso } | null` para `evento` em `new-prs`, `auto-approved`, `auto-rejected`, `auto-commented`, `tool-done`, `intervention`, `meu-pr-base`; qualquer outro devolve `null`.
  - `badgeDe(snapshot) -> { contador, rotulo }` (regra de `main.js:241-247`: pendências sem `esperaCi` e sem `esperaProva`; rótulo `1 decisão esperando você` / `N decisões esperando você`; contador 0 → rótulo `''`).
  - `cascaDe(engine) -> { badge, ocupado, autostart, cores }` com `ocupado = engine.activeReviews.size > 0`, `autostart = !!engine.config.autostart`, `cores = { bg, symbol }` com a regra de `themeColors()` de `main.js:70-76` (copiar os valores literais de lá).
  - Eventos SSE: `aviso-nativo` com o objeto de `avisoDe`; `casca` com o de `cascaDe`, enviado logo após o `state` inicial e a cada `state` e `settings-changed` em que o objeto mudou (comparar por `safeStringify`).

- [ ] **Step 1: Write the failing tests** (`test/avisos-nativos.test.js`), com os textos EXATOS de `main.js:264-305`:

```js
test('new-prs: um PR na fila automática', () => {
  const a = avisoDe('new-prs', { items: [{ key: 'o/r#1', title: 'T', url: 'u' }], total: 1, auto: true }, { config: {} });
  assert.deepEqual(a, { titulo: 'Farol · PR novo, na fila da revisão automática', corpo: 'o/r#1: T', url: 'u', pr: 'o/r#1', silencioso: false });
});
test('new-prs: vários PRs pedindo revisão juntam as chaves com  ·  e sem url', ...);
test('auto-approved sem ressalvas', () => { /* 'Farol · aprovado sem ressalvas ✅', corpo `${pr.key} (${result.card || 'sem card'}): revisão completa, nenhum ponto de atenção. APPROVE postado.` */ });
test('auto-approved com 2 ressalvas', () => { /* 'Farol · aprovado com ressalvas ⚠️', corpo com reasonText(points[0]) e ' (+1)' */ });
test('auto-rejected sem reasons cai em ver relatório', ...);
test('auto-commented', ...);
test('tool-done kudos e diagnóstico', ...);
test('intervention usa interventionEvent, silencioso = quietNow(config) e pr do alvo', ...);
test('intervention inválida devolve null', ...);
test('meu-pr-base agrupado usa a url do primeiro item', ...);
test('evento desconhecido devolve null', () => assert.equal(avisoDe('state', {}, { config: {} }), null));
test('badgeDe conta pendências que esperam você', () => {
  assert.deepEqual(badgeDe({ decisions: { pending: [{}, { esperaCi: true }, { esperaProva: true }] } }), { contador: 1, rotulo: '1 decisão esperando você' });
  assert.deepEqual(badgeDe({}), { contador: 0, rotulo: '' });
});
test('cascaDe projeta badge, ocupado, autostart e cores', ...);
```

E o gerador das fixtures de paridade, no mesmo arquivo:

```js
test('as fixtures de paridade das cascas refletem os casos deste arquivo', () => {
  const casos = [/* os mesmos {evento, payload, config} dos testes acima */].map(c => ({ ...c, esperado: avisoDe(c.evento, c.payload, { config: c.config }) }));
  const arquivo = path.join(import.meta.dirname, 'fixtures', 'casca', 'eventos.json');
  if (process.env.FAROL_ATUALIZAR_FIXTURES === '1') fs.writeFileSync(arquivo, JSON.stringify(casos, null, 2) + '\n');
  assert.deepEqual(parseJson(fs.readFileSync(arquivo, 'utf8')), casos, 'rode com FAROL_ATUALIZAR_FIXTURES=1 para regravar');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/avisos-nativos.test.js`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implement `lib/engine/avisos-nativos.js`** copiando a lógica de `wireEngine()`, `updateBadge()`, `tituloDePrsNovos()` e `themeColors()` do `main.js` (textos idênticos). Rodar uma vez com `FAROL_ATUALIZAR_FIXTURES=1` para gerar `test/fixtures/casca/eventos.json` e conferir o arquivo a olho.

- [ ] **Step 4: Write the failing SSE test** (`test/casca-sse.test.js`, no molde de `test/http-ui-spa.test.js`: `new Engine()`, `engine.config.port = 0`, `startServer`):

```js
test('a conexão SSE recebe casca depois do state inicial, e aviso-nativo a cada evento', async () => {
  // abrir GET /api/events com x-farol: 1 e Host 127.0.0.1:<porta>, ler o stream
  // esperar 'event: state' e depois 'event: casca' com badge {contador:0, rotulo:''}
  // engine.emit('auto-commented', { pr: { key: 'o/r#1', url: 'u' } })
  // esperar 'event: aviso-nativo' com titulo 'Farol · comentado 💬'
  // engine.emit('settings-changed', { ...engine.config, autostart: true })
  // esperar 'event: casca' com autostart true
});
```

- [ ] **Step 5: Wire the broadcasts in `lib/http-server.js`**: ao lado de `engine.on('new-prs', ...)` etc., para cada um dos sete eventos, além do broadcast de hoje, `const a = avisoDe(evento, p, { config: engine.config }); if (a) broadcast('aviso-nativo', a);`. Para `casca`: guardar `ultimaCasca` por string e emitir no `state`, no `settings-changed` (`engine.on('settings-changed', ...)` ainda não existe aqui: acrescentar) e na conexão nova, logo após o `state` inicial.

- [ ] **Step 6: Run tests**

Run: `npm test -- test/avisos-nativos.test.js test/casca-sse.test.js test/http-ui-spa.test.js test/local-auth-inventario.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/engine/avisos-nativos.js lib/http-server.js test/avisos-nativos.test.js test/casca-sse.test.js test/fixtures/casca/eventos.json
git commit -m "feat(casca): avisos nativos prontos e evento casca no SSE"
```

---

### Task 6: bootstrap de versão em `~/.farol/engine/<versão>/` e `engines.farolShell`

**Files:**
- Create: `lib/engine/casca-bootstrap.js`
- Modify: `package.json` (campo `engines.farolShell`: `">=3.0.0 <4"`)
- Modify: `server.js` (topo: antes de qualquer `import` que toque estado, o bootstrap; ver Step 3)
- Modify: `lib/paths.js` (constante `ENGINE_DIR = path.join(HOME, 'engine')`, exportada)
- Modify: `lib/node-runtime.js` (exportar `nodeVersionSatisfies` para reuso, se ainda não for exportada)
- Test: `test/casca-bootstrap.test.js`

**Interfaces:**
- Consumes: `modoCasca()`, `versaoDaCasca()` (Task 1); `cmpVersion` de `lib/engine/update.js:44`.
- Produces: `escolherMotor({ semeada, raizSemeada, pastaEngine, versaoCasca }) -> { raiz, versao, motivo }` puro: lista subpastas de `pastaEngine` com `package.json` válido, `version` maior que `semeada` e `engines.farolShell` que aceita `versaoCasca`; devolve a maior, ou a semeada com `motivo` (`'semeada'`, `'sem-pasta'`, `'nenhuma-compativel'`); pasta sem `package.json` ou sem `engines.farolShell` é ignorada com `motivo` em `ignoradas: [{ pasta, motivo }]`. `podarMotores({ pastaEngine, manter })` apaga as pastas abaixo da versão escolhida e da semeada. `reexecutar(raiz) -> never` sobe `process.execPath` com `path.join(raiz, 'server.js')` e os mesmos `argv`, `stdio: 'inherit'`, mesmo `env`, e encerra este processo com o código do filho (repassa SIGTERM ao filho).

- [ ] **Step 1: Write the failing test**

```js
test('sem FAROL_SHELL o bootstrap não roda', ...);
test('escolhe a maior versão compatível acima da semeada', () => {
  // pastaEngine temporária com 2.80.0 (farolShell >=3.0.0 <4), 2.81.0 (>=4.0.0 <5) e 2.79.0 (abaixo da semeada 2.79.5)
  const r = escolherMotor({ semeada: '2.79.5', raizSemeada: '/bundle', pastaEngine, versaoCasca: '3.0.0' });
  assert.equal(r.versao, '2.80.0'); assert.deepEqual(r.ignoradas.map(i => i.motivo).sort(), ['abaixo-da-semeada', 'casca-incompativel']);
});
test('pasta corrompida ou sem package.json é ignorada e a semeada ganha', () => { /* motivo 'manifesto-invalido' */ });
test('package.json sem engines.farolShell é incompatível', () => { /* motivo 'sem-farolShell' */ });
test('podarMotores apaga só o que está abaixo das duas', ...);
test('reexecutar sobe o server.js escolhido e repassa o código de saída', () => {
  // raiz temporária com um server.js que faz process.exit(75); conferir que o filho sai com 75 (usar child_process.spawnSync sobre um script que chama reexecutar)
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/casca-bootstrap.test.js`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implement** `lib/engine/casca-bootstrap.js` e a chamada no `server.js`: na primeira linha executável (antes de `start`), `if (modoCasca() && !process.env.FAROL_BOOTSTRAP_FEITO)`: `const r = escolherMotor(...)`; se `r.raiz !== APP_ROOT`, `podarMotores` e `reexecutar(r.raiz)` com `FAROL_BOOTSTRAP_FEITO=1` no env do filho (evita laço). Ignoradas viram `WARN` no log só quando o motivo é `manifesto-invalido`. A variável `FAROL_BOOTSTRAP_FEITO` é lida em `lib/paths.js` (`bootstrapFeito(env)`), não com `process.env` direto no `server.js`.

- [ ] **Step 4: Run tests**

Run: `npm test -- test/casca-bootstrap.test.js test/node-runtime.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/casca-bootstrap.js lib/paths.js lib/node-runtime.js server.js package.json test/casca-bootstrap.test.js
git commit -m "feat(casca): bootstrap de versão em ~/.farol/engine e engines.farolShell"
```

---

### Task 7: ramo de update do modo casca e o evento `casca-saida`

**Files:**
- Create: `lib/engine/update-casca.js`
- Modify: `lib/engine/update.js:392-424` (`applyUpdateInner`: antes do `modoServidor`, `if (modoCasca()) return aplicarNaCasca(engine, deps);`)
- Modify: `lib/http-server.js` (broadcast de `casca-saida`)
- Modify: `lib/constants.js` (constante nova exportada `CASCA = Object.freeze({ CODIGO_SAIDA_DE_PROPOSITO: 75 })`)
- Test: `test/update-casca.test.js`

**Interfaces:**
- Consumes: `trocarArquivos(origem, raiz)` de `update-servidor.js:47` (reusar para copiar o pacote leve), `marcarProximaVersao` (Task 4), `marcarReaberturaSilenciosa` (`update.js:187`), `motivoOcupado(engine)` (`update.js:242`).
- Produces: `aplicarNaCasca(engine, deps = {}) -> { ok, error? }`: recusa com o mesmo texto de `update-servidor.js:115` se `APP_ROOT` tem `.git`; copia `engine.update.source` para `ENGINE_DIR/<versão>.tmp` e renomeia para `ENGINE_DIR/<versão>`; `marcarProximaVersao(versão)`; `marcarReaberturaSilenciosa(versão)`; `engine.emit('casca-saida', { motivo: 'update', proximaVersao: versão })`; `setTimeout(() => process.exit(CASCA.CODIGO_SAIDA_DE_PROPOSITO), TEMPOS.SAIDA_DEPOIS_DO_UPDATE_MS)`. Com `deps.exit` injetável para teste.

- [ ] **Step 1: Write the failing test**

```js
test('aplicarNaCasca instala em ~/.farol/engine/<versão> e sai com 75 depois de avisar', async () => {
  // engine falso com update.source = pasta com package.json {version:'2.80.0', engines:{farolShell:'>=3.0.0 <4'}} e server.js
  // deps: { raiz: pastaSemGit, exit: codigo => saidas.push(codigo), pastaEngine }
  // esperar: pasta ENGINE/2.80.0/server.js existe, não existe 2.80.0.tmp, casca.json.proximaVersao === '2.80.0',
  // evento 'casca-saida' emitido com { motivo: 'update', proximaVersao: '2.80.0' }, saidas === [75] após SAIDA_DEPOIS_DO_UPDATE_MS
});
test('recusa checkout git', ...);
test('cópia que falha no meio não deixa pasta final', () => { /* source sem server.js -> .tmp removida, sem ENGINE/<v> */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/update-casca.test.js`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implement** `lib/engine/update-casca.js`, o desvio em `applyUpdateInner` e `engine.on('casca-saida', p => broadcast('casca-saida', p))` no `http-server.js`.

- [ ] **Step 4: Run tests**

Run: `npm test -- test/update-casca.test.js test/update-servidor.test.js test/update.test.js test/update-adiado.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/update-casca.js lib/engine/update.js lib/http-server.js lib/constants.js test/update-casca.test.js
git commit -m "feat(casca): update do motor em ~/.farol/engine com saída de propósito"
```

---

### Task 8: `config.bind` e allowlist de Host configurável (web)

**Files:**
- Modify: `lib/settings.js:142` (ao lado de `port`: `{ key: 'bind', def: '127.0.0.1', ui: false, san: sanearBind }`)
- Modify: `lib/parse.js` (`sanearBind(v) -> string`: aceita IPv4, IPv6 entre colchetes ou nome de host `[A-Za-z0-9.-]{1,253}`; qualquer outra coisa → `'127.0.0.1'`)
- Modify: `lib/http-guard.js:11-35` (`validarHostEOrigem({ host, origin, porta, bind })`: com `bind` fora de `127.0.0.1`/`localhost`, `hostsPermitidos` inclui `${bind}:${porta}` e `Origin` aceita `http://${bind}:${porta}` e `https://${bind}`)
- Modify: `lib/http-server.js:408` (`server.listen(engine.config.port, engine.config.bind, ...)` e passar `bind` à guarda)
- Modify: `lib/local-auth/modo.js` (`exigeAutenticacao({ ..., bindForaDoLoopback })` → `true`)
- Modify: `lib/local-auth/acesso.js` (`exigida` passa `bindForaDoLoopback: !loopback(config.bind)`)
- Test: `test/bind-configuravel.test.js`

**Interfaces:**
- Produces: `sanearBind`, `validarHostEOrigem` com `bind`, `exigeAutenticacao` com `bindForaDoLoopback`.

- [ ] **Step 1: Write the failing test**

```js
test('sanearBind aceita IP e host e cai em loopback no resto', () => {
  assert.equal(sanearBind('0.0.0.0'), '0.0.0.0'); assert.equal(sanearBind('farol.interno'), 'farol.interno'); assert.equal(sanearBind('[::1]'), '[::1]');
  for (const v of ['0.0.0.0:80', 'http://x', '', undefined, 'a b']) assert.equal(sanearBind(v), '127.0.0.1');
});
test('com bind fora do loopback a allowlist aceita o host do bind e nada mais', () => {
  const ok = validarHostEOrigem({ host: 'farol.interno:47170', origin: 'https://farol.interno', porta: 47170, bind: 'farol.interno' });
  assert.equal(ok.ok, true);
  assert.equal(validarHostEOrigem({ host: 'outro:47170', porta: 47170, bind: 'farol.interno' }).ok, false);
  assert.equal(validarHostEOrigem({ host: '127.0.0.1:47170', porta: 47170, bind: 'farol.interno' }).ok, true, 'loopback continua valendo');
});
test('bind fora do loopback exige autenticação', () => {
  assert.equal(exigeAutenticacao({ modoCelular: false, config: {}, ativacaoAutomatica: true, bindForaDoLoopback: true }), true);
});
test('o servidor escuta no bind configurado', async () => { /* Engine com config.bind='127.0.0.1' e port 0: server.address().address === '127.0.0.1' */ });
```

O retorno de `validarHostEOrigem` é `{ ok: true }` ou `{ ok: false, motivo: 'host' | 'origin' }` (`lib/http-guard.js:25-35`); com `bind` fora do loopback, `origensPermitidas` ganha também `https://${bind}` (sem porta, porque o proxy com TLS fica na 443).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/bind-configuravel.test.js`
Expected: FAIL (`sanearBind` inexistente).

- [ ] **Step 3: Implement** nos seis arquivos. `loopback(bind)` é `bind === '127.0.0.1' || bind === 'localhost' || bind === '[::1]'`, em `lib/http-guard.js`, exportada.

- [ ] **Step 4: Run tests**

Run: `npm test -- test/bind-configuravel.test.js test/http-guard.test.js test/settings-fonte-unica.test.js test/local-auth-modo.test.js test/local-auth-http.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/settings.js lib/parse.js lib/http-guard.js lib/http-server.js lib/local-auth/modo.js lib/local-auth/acesso.js test/bind-configuravel.test.js
git commit -m "feat(web): bind configurável com Host na allowlist e autenticação exigida fora do loopback"
```

---

### Task 9: documentação e gate completo

**Files:**
- Modify: `CLAUDE.md` (mapa de arquivos: `lib/engine/casca-arquivo.js`, `avisos-nativos.js`, `casca-bootstrap.js`, `update-casca.js`; invariante 1 com a redação da seção 3 do desenho; nota em "Como rodar" sobre `FAROL_SHELL=mac node server.js`)
- Modify: `docs/CONFIGURATION.md` (seção "Modo casca e bind": `FAROL_SHELL`, `FAROL_SHELL_VERSION`, `config.bind`, `state/casca.json`, sessão `casca`)
- Modify: `docs/MACOS.md` (um parágrafo no "modo servidor": o modo casca é o terceiro jeito de subir o motor)
- Test: `test/guias-navegaveis.test.js` (já existe; trava links e índice)

- [ ] **Step 1: Escrever as seções** com os nomes e valores exatos deste plano e do índice.

- [ ] **Step 2: Rodar o gate inteiro**

Run: `npm run check && npm run lint && npm test`
Expected: os três verdes; o `lint` sem contagem acima da baseline.

- [ ] **Step 3: Smoke manual do modo casca**

Run:
```bash
FAROL_HOME=/tmp/farol-casca FAROL_SHELL=mac FAROL_SHELL_VERSION=3.0.0 node server.js
```
Expected: sobe; `cat /tmp/farol-casca/state/casca.json` mostra porta, pid e código; `curl -H 'Host: 127.0.0.1:<porta>' http://127.0.0.1:<porta>/api/state` devolve 401 (A4 exigida); `curl -X POST -H 'Host: ...' -H 'content-type: application/json' -d '{"codigo":"<código>","rotulo":"teste"}' http://127.0.0.1:<porta>/api/auth/pair` devolve `{ ok: true, token }`; `curl -N -H 'Authorization: Bearer <token>' -H 'x-farol: 1' .../api/events` mostra `event: state` e depois `event: casca`. Ctrl+C apaga o `casca.json`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/CONFIGURATION.md docs/MACOS.md
git commit -m "docs(casca): modo casca, bind configurável e sessão da casca"
```

- [ ] **Step 5: Abrir o PR** de `feat/contrato-do-sidecar` para `main`, com o resumo deste plano e o link do desenho, sem rodapé de ferramenta.
