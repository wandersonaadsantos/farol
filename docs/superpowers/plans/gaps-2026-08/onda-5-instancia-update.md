## Onda 5: Instância única e fluxo de update

**Achados cobertos:** A7, M13, M14, M15, M16

Base: Farol v2.30.1, fonte em `C:\Users\wanderson\Documents\farol`, relatório em `C:\Users\wanderson\Documents\biud\analise-farol-gaps-logicos\relatorio.md` (seções A7 na linha 80 e M13 a M16 nas linhas 113 a 119). Linhas citadas abaixo são do HEAD atual; elas deslizam conforme as tarefas anteriores da onda entram, então localize pelo trecho de código, não pelo número.

**Dificuldades antecipadas da onda** (a parte MAIS importante do plano; o objetivo do usuário é ter a solução pronta antes do impedimento aparecer):

- **D1. Testar o erro do listen sem colidir com um Farol real na 47170** → Solução preparada: o teste sobe um "blocker" HTTP em porta efêmera (`listen(0, '127.0.0.1')`), lê a porta sorteada e grava `config.json` do FAROL_HOME temporário apontando pra ela. O EADDRINUSE é determinístico, nenhuma porta fixa é tocada, e o idioma já existe na suite (test/http.test.js usa porta 0; test/boot.test.js grava e restaura config.json). O arquivo novo test/instance.test.js ganha FAROL_HOME próprio, então o isolamento por processo do runner nativo protege os vizinhos.
- **D2. Na fase vermelha do A7, o `start()` pré-correção dispara `check('startup')` com gh real** → Solução preparada: o config dos testes já nasce com `autoReview: false` e `updateRepo: ''` (corta `gh release view` e qualquer revisão automática), o FAROL_HOME é zerado (sem contas configuradas), e os spawns que sobram (`gh auth token`, doctor) são read-only. Depois da correção, os stubs de `check`/`checkUpdate`/`doctor` são instalados de forma síncrona logo após `farol.start()` retornar, ANTES do tick assíncrono do listen, então a suite verde nunca faz rede. Higiene obrigatória no `finally`: `clearTimeout(engine.timer)` e `server.close()`, senão o `node --test` fica pendurado.
- **D3. `test/facades.test.js` deriva a aridade da fachada `Engine.applyUpdate()` do fonte** → Solução preparada: a costura de teste usa `deps = {}` COM default. `Function.length` para de contar no primeiro parâmetro com default, então `applyUpdate(engine, deps = {})` tem length 1, a varredura calcula `1 - 1 = 0` e a fachada de 0 parâmetros continua verde. Escrever `deps` SEM default quebraria a suite (esperado viraria 1). Se algum dia for necessário, a válvula documentada é a tabela `EXCECOES` do próprio facades.test.js, mas com o default ela não é preciso.
- **D4. `applyUpdate` chama `checkUpdate`/`downloadRemoteUpdate` pelo binding local do módulo, impossível de mockar via exports** → Solução preparada: tarefa própria (5.3) introduz a injeção `deps` com default pros reais, antes de qualquer correção que precise de teste. É o mesmo padrão já sancionado no projeto: `buildModelFlags` foi extraída do `runClaudeStream` exatamente porque "o stub suprimia a flag e não dava pra provar o que ia pra linha" (CLAUDE.md, seção modelo e esforço).
- **D5. Um teste que percorra o caminho Windows do applyUpdate pode disparar `Start-Process` de verdade** → Solução preparada: TODO diretório fake de update criado nos testes fica de propósito SEM `installer/`, então qualquer fluxo (inclusive o pré-correção, na fase vermelha do TDD) morre no retorno `installer não encontrado` ANTES do spawn. As duas plataformas param na mesma mensagem (install.ps1 no Windows, install.sh no mac via `applyUpdateMac`), então os testes rodam idênticos nos dois SOs, sem skip, honrando o requisito cross-platform.
- **D6. M14 não dá pra validar executando PowerShell no teste** → Solução preparada: extrair a montagem do comando pra função PURA exportada (`buildUpdateLaunchCommand`) e testar a STRING gerada (aspas duplas embutidas no item do `-ArgumentList`). A validação de execução é manual, uma vez, no Windows, com o roteiro pronto no corpo da tarefa 5.2 (script num diretório com espaço, rodar o comando gerado, conferir o efeito).
- **D7. O teste de reentrância do M16 pode virar deadlock na fase vermelha** (a segunda chamada esperaria um download que o teste só libera depois do assert) → Solução preparada: a segunda chamada usa `deps` PRÓPRIOS com download instantâneo. Sem a guarda (pré-correção) ela resolve rápido com a mensagem errada, dando vermelho limpo; com a guarda ela é recusada antes de chamar o download (flag `chamouSegundoDownload` prova). Nunca compartilhar a promise travada entre as duas chamadas.
- **D8. `main.js` não tem teste nenhum (shell Electron) e o item de bandeja "Verificar agora" acordaria o engine inerte da instância anexada** → Solução preparada: guarda `attachedToExisting` no próprio main.js (o clique vira no-op quando a janela é só um visor de outra instância). Verificação: `npm run check` (o check-syntax varre main.js) mais o smoke manual descrito na tarefa 5.1 (subir `node server.js`, depois `npm start`, conferir que a janela abre apontando pra instância existente e que nada é agendado no engine local).
- **D9. Cinco tarefas editam o MESMO corpo de `applyUpdate` e os diffs podem se atropelar** → Solução preparada: ordem fixa de execução (5.2 M14, 5.3 costura, 5.4 M13, 5.5 M15, 5.6 M16) e cada Passo 3 mostra o corpo CUMULATIVO como fica depois da tarefa; o bloco da 5.6 é o estado final completo pra conferência byte a byte.
- **D10. Estado legado: `updateApplying` não existe em instalações antigas e não pode virar lixo persistido** → Solução preparada: o flag vive SÓ em memória (inicializado no construtor da Engine, nunca gravado em config.json nem em state/), então não há migração; depois de `ok:true` ele fica ligado de propósito (o installer vai matar o processo; se algo impedir o update, o próximo boot zera sozinho). O comentário no código registra essa decisão pra ninguém "corrigir" achando que é vazamento.
- **D11. `requestSingleInstanceLock` do Electron NÃO resolve o A7 sozinho** → Solução preparada (avaliação feita, decisão registrada): o lock do Electron (main.js:20) só cobre Electron contra Electron; o cenário do achado é justamente Electron contra `node server.js` (ou server contra server), onde não há app Electron pra segurar lock. A solução escolhida é usar o próprio listen na porta como lock de instância única: `engine.schedule()`/`engine.start()` só rodam DEPOIS do callback de sucesso do listen. Vale nos dois modos e nos dois SOs, sem arquivo de lock novo. Risco residual aceito e documentado: duas instâncias com PORTAS diferentes configuradas no mesmo `~/.farol` continuam possíveis (é opt-in explícito de config, fora do escopo do A7).

---

### Tarefa 5.1: Engine só monitora depois do listen dar certo (achados: A7)

**Arquivos:** Modify: `server.js:1058-1064` (função `start`), `main.js:18` (declaração), `main.js:29-36` (branch de erro), `main.js:131` (item da bandeja) | Test: `test/instance.test.js` (novo)

**Interfaces:** `start(onReady)` mantém assinatura e retorno `{ engine, server, port }`. Muda o CONTRATO temporal: `onReady(url)` de sucesso é chamado depois de `engine.schedule()`/`engine.start()`; `onReady(null, err)` implica engine inerte (sem timer, sem ciclo). Nenhum outro chamador além de main.js e do bloco `require.main` (verificado por grep).

**Dificuldades antecipadas:**
- Fase vermelha dispara gh real (D2) → config do teste com `updateRepo: ''` e `autoReview: false`, HOME zerado; pós-correção os stubs entram antes do tick do listen; timer e servers fechados no `finally`.
- Na fase vermelha o teste 2 também fica vermelho (o `check` real ainda está em voo e `status` é `'checking'` na hora do assert): esperado, os DOIS ficam verdes juntos com a correção.
- `server.on('error')` pode em teoria disparar depois de um listen ok (chamando `onReady` de novo, quirk pré-existente) → o latch `began` garante que schedule/start rodam no máximo uma vez; o quirk do onReady duplo fica como está (fora do escopo).
- `engine.start()` segue fire-and-forget → sem risco de unhandled rejection: `check()` tem try/catch interno e `checkUpdate`/`doctor` já são chamados com `.catch(() => {})`.
- `config.json` com `port: 0` no teste 2: o boot não sana a porta (merge direto com DEFAULTS), o listen(0) sorteia porta e a URL cosmética do onReady usa `engine.config.port`; o teste não depende da URL, só do timing.

- [ ] **Passo 1: escrever o teste que falha**

Criar `test/instance.test.js`:

```js
'use strict';
// A7: porta ocupada não pode deixar um SEGUNDO engine vivo no mesmo ~/.farol
// (polling dobrado, revisão dupla com dois posts no GitHub, writeFileSync
// concorrente em seen/inflight/usage/chats). O listen na porta é o lock de
// instância única: vale no Electron E no modo `node server.js` (o
// requestSingleInstanceLock do Electron não cobre o modo servidor).
// Idioma: FAROL_HOME temporário ANTES do require (test/boot.test.js) e porta
// efêmera pra nunca colidir com um Farol real (test/http.test.js).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const HOME = path.join(os.tmpdir(), 'farol-test-instance-' + process.pid);
process.env.FAROL_HOME = HOME;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const farol = require('../server.js');

after(() => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

// autoReview false e updateRepo vazio: nem o caminho pré-correção (start síncrono)
// dispara revisão automática ou gh release view
function escreveConfig(cfg) {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(path.join(HOME, 'config.json'),
    JSON.stringify({ autoReview: false, updateRepo: '', ...cfg }));
}

test('porta ocupada: o engine NÃO agenda polling nem inicia o ciclo (A7)', async () => {
  const blocker = http.createServer(() => { });
  await new Promise(res => blocker.listen(0, '127.0.0.1', res));
  escreveConfig({ port: blocker.address().port });
  let engine, server;
  const err = await new Promise((resolve) => {
    ({ engine, server } = farol.start((url, e) => resolve(e)));
  });
  try {
    assert.ok(err, 'o listen falhou com a porta ocupada (EADDRINUSE)');
    assert.equal(engine.timer, null, 'nenhum polling agendado: schedule() não pode ter rodado');
    assert.equal(engine.nextCheckAt, null, 'nextCheckAt intocado: schedule() não rodou');
    assert.equal(engine.status, 'starting', 'status intocado: check("startup") não rodou');
  } finally {
    if (engine) clearTimeout(engine.timer);
    try { server && server.close(); } catch { /* ok */ }
    await new Promise(res => blocker.close(res));
  }
});

test('porta livre: o engine monitora DEPOIS do listen (comportamento preservado)', async () => {
  escreveConfig({ port: 0 });
  let engine, server;
  const pronto = new Promise((resolve, reject) => {
    ({ engine, server } = farol.start((url, e) => (e ? reject(e) : resolve(url))));
  });
  // stubs instalados de forma SÍNCRONA, antes do tick assíncrono do listen:
  // com a correção, schedule/start só rodam no callback, então usam os stubs
  // e a suite verde não faz rede nenhuma
  engine.check = async () => { engine.status = 'idle'; };
  engine.checkUpdate = async () => { };
  engine.doctor = async () => { };
  await pronto;
  await new Promise(res => setImmediate(res));
  try {
    assert.ok(engine.nextCheckAt, 'schedule() rodou depois do listen');
    assert.ok(engine.timer, 'timer de polling agendado');
    assert.equal(engine.status, 'idle', 'check("startup") rodou (o stub marcou idle)');
  } finally {
    clearTimeout(engine.timer);
    try { server.close(); } catch { /* ok */ }
  }
});
```

- [ ] **Passo 2: rodar e ver falhar** (`node --test test/instance.test.js`)

Esperado: teste 1 falha em `nenhum polling agendado` (o `engine.timer` atual é um objeto Timeout, porque `start()` chama `engine.schedule()` de forma síncrona e incondicional). Teste 2 falha em `check("startup") rodou` com `status` real `'checking'` (o check verdadeiro partiu antes dos stubs). Nesta rodada vermelha pode haver spawns read-only de gh (documentado em D2); a rodada verde não terá nenhum.

- [ ] **Passo 3: implementação mínima**

`server.js`, função `start` (hoje linhas 1058-1064), fica assim:

```js
function start(onReady) {
  const engine = new Engine();
  let began = false;
  const server = startServer(engine, (url, err) => {
    // O listen na porta é o lock de instância única (vale também no modo
    // `node server.js`, sem Electron). Com a porta ocupada já existe um Farol
    // usando este ~/.farol: um segundo engine com polling próprio revisaria PR
    // em dobro e escreveria seen/inflight/usage sem lock (A7). Por isso o
    // monitoramento só começa DEPOIS do listen dar certo.
    if (!err && !began) { began = true; engine.schedule(); engine.start(); }
    if (onReady) onReady(url, err);
  });
  return { engine, server, port: engine.config.port };
}
```

`main.js`: declarar o flag junto dos outros (linha 18) e usar no branch de erro e na bandeja:

```js
let hideHintShown = false;
let attachedToExisting = false; // porta ocupada: esta janela é só um VISOR da instância que já roda
```

```js
    const { engine: eng } = farol.start((url, err) => {
      if (err) {
        // porta ocupada: provavelmente ja existe um Farol rodando em modo servidor.
        // O engine local NÃO monitora (ver start no server.js); esta janela vira visor.
        attachedToExisting = true;
        appUrl = `http://127.0.0.1:${eng.config.port}`;
      } else {
        appUrl = url;
      }
```

```js
    { label: 'Verificar agora', click: () => engine && !attachedToExisting && engine.checkNow() },
```

- [ ] **Passo 4: rodar a suite inteira** (`npm test && npm run check`)

Smoke manual complementar (main.js não tem teste): num terminal `node server.js`; noutro `npm start`. A janela deve abrir mostrando a UI da instância existente, e o processo Electron não pode agendar polling (conferir que só o `node server.js` escreve em `~/.farol/workspace/state/`). "Verificar agora" na bandeja não pode disparar nada no processo Electron.

- [ ] **Passo 5: commit** `fix: engine só monitora depois do listen dar certo (instância única)`

---

### Tarefa 5.2: Citar o caminho do script no Start-Process do PowerShell 5.1 (achados: M14)

**Arquivos:** Modify: `lib/engine/update.js:147` (linha do `ps`), nova função pura antes de `applyUpdate` (após a linha 114), exports em `lib/engine/update.js:177-180` | Test: `test/update.test.js`

**Interfaces:** Produz `buildUpdateLaunchCommand(scriptFile: string): string`, PURA e exportada (consumida por `applyUpdate` e pelos testes).

**Dificuldades antecipadas:**
- Não dá pra executar PowerShell no teste (D6) → testar a string; validação de execução manual única no Windows: criar `C:\tmp\pasta com espaco\update-1.ps1` com `Set-Content "$PSScriptRoot\ok.txt" "rodou"`, colar o comando devolvido pela função num PowerShell e conferir que `ok.txt` aparece. Sem a correção, o mesmo roteiro falha em silêncio (janela oculta morre no parse do -File).
- Aspas: o caminho entra numa string single-quoted do PowerShell (dentro do `-Command`), então apóstrofo no caminho quebraria a string → dobrar `'` (regra do PowerShell), no mesmo helper.
- Assert com barras invertidas em JS é fácil de errar → montar o esperado por concatenação (`` `'-File','"` + script + `"'` ``), nunca de cabeça.
- O spawn externo (linha 149) não muda: o array de args do `spawn` já cuida do quoting do `-Command`; a correção é só na linha INTERNA que o PowerShell 5.1 monta pro processo filho.

- [ ] **Passo 1: escrever o teste que falha**

Anexar ao final de `test/update.test.js`:

```js
test('buildUpdateLaunchCommand: caminho com espaço sai citado no -File (M14)', () => {
  // PS 5.1: Start-Process junta o -ArgumentList com espaço SEM citar cada item.
  // Perfil "C:\Users\Nome Sobrenome" partia o -File em dois argumentos e o
  // installer morria numa janela oculta DEPOIS do ok:true e do toast de sucesso.
  const script = 'C:\\Users\\Nome Sobrenome\\.farol\\sessions\\update-1.ps1';
  const cmd = update.buildUpdateLaunchCommand(script);
  assert.ok(cmd.startsWith('Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '),
    'forma geral do comando preservada');
  assert.ok(cmd.endsWith(`'-File','"` + script + `"'`),
    'aspas duplas embutidas sobrevivem à junção do -ArgumentList e chegam inteiras no filho');
});

test('buildUpdateLaunchCommand: apóstrofo no caminho é dobrado (string single-quoted do PS)', () => {
  const cmd = update.buildUpdateLaunchCommand("C:\\Users\\O'Brien\\.farol\\sessions\\update-2.ps1");
  assert.ok(cmd.includes("O''Brien"), 'apóstrofo dobrado, a string do -Command não quebra');
});
```

- [ ] **Passo 2: rodar e ver falhar** (`node --test test/update.test.js`)

Esperado: os dois testes novos falham com `TypeError: update.buildUpdateLaunchCommand is not a function`.

- [ ] **Passo 3: implementação mínima**

Em `lib/engine/update.js`, logo depois de `downloadRemoteUpdate` (antes de `applyUpdate`):

```js
// Linha que lança o script de update destacado. PURA e exportada pra teste: o
// Start-Process do PowerShell 5.1 junta os itens do -ArgumentList com espaço SEM
// citar cada um, então caminho com espaço (C:\Users\Nome Sobrenome\...) partia o
// -File em dois argumentos e o installer morria numa janela oculta DEPOIS do
// ok:true (M14). Aspas duplas embutidas sobrevivem à junção; apóstrofo é dobrado
// (regra de string single-quoted do PowerShell).
function buildUpdateLaunchCommand(scriptFile) {
  const quoted = `"${String(scriptFile)}"`.replace(/'/g, "''");
  return `Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${quoted}'`;
}
```

Na linha do `ps` dentro de `applyUpdate` (hoje 147):

```js
  const ps = buildUpdateLaunchCommand(scriptFile);
```

E no exports:

```js
module.exports = {
  resolveUpdateSource, cmpVersion, checkUpdate, checkUpdateRemote,
  downloadRemoteUpdate, applyUpdate, applyUpdateMac, buildUpdateLaunchCommand,
};
```

- [ ] **Passo 4: rodar a suite inteira** (`npm test && npm run check`)
- [ ] **Passo 5: commit** `fix: citar o caminho do script de update no Start-Process do PowerShell 5.1`

---

### Tarefa 5.3: Costura de teste: checkUpdate e download injetáveis no applyUpdate (achados: pré-requisito de M13, M15, M16)

**Arquivos:** Modify: `lib/engine/update.js:116-118` (assinatura e cabeça do `applyUpdate`) | Test: `test/update.test.js`

**Interfaces:** `applyUpdate(engine, deps = {})` com `deps.checkUpdate(engine)` e `deps.downloadRemoteUpdate(engine)` assíncronos, default pros reais. A fachada `Engine.applyUpdate()` (server.js:852) e a rota `/api/update` NÃO mudam.

**Dificuldades antecipadas:**
- Binding local impede mock via exports (D4) → é exatamente o que esta costura resolve; padrão sancionado pelo precedente do `buildModelFlags`.
- Aridade da fachada (D3) → `deps = {}` com default é obrigatório: mantém `Function.length` em 1 e o `test/facades.test.js` verde (esperado `1 - 1 = 0`, fachada declara 0). Sem o default, facades fica vermelho.
- O `checkUpdate` REAL com config default faria `gh release view` (DEFAULTS.updateRepo é `wandersonaadsantos/farol`) → todo teste de applyUpdate zera `engine.config.updateRepo` na primeira linha, então até a fase vermelha (deps ignorado) fica sem rede: o checkUpdate real cai no canal `none` e retorna rápido.
- `engine.pushState()` dentro do checkUpdate real emite `state` num EventEmitter sem listeners: inofensivo, nada a stubar.

- [ ] **Passo 1: escrever o teste que falha**

Anexar ao final de `test/update.test.js`:

```js
test('applyUpdate: sem update disponível devolve ok:false (baseline, sem rede)', async () => {
  const engine = new Engine();
  engine.config.updateRepo = '';
  engine.config.updateSource = '';
  const r = await update.applyUpdate(engine, {});
  assert.deepEqual(r, { ok: false, error: 'nenhuma atualização disponível' });
});

test('applyUpdate: usa o checkUpdate injetado (costura de teste)', async () => {
  const engine = new Engine();
  engine.config.updateRepo = '';
  let usado = false;
  const r = await update.applyUpdate(engine, {
    checkUpdate: async (e) => {
      usado = true;
      e.update = { current: '0.0.1', channel: 'remote', repo: 'x/y', source: null, sourceVersion: null, available: false, checkedAt: Date.now() };
    }
  });
  assert.equal(usado, true, 'o applyUpdate honrou deps.checkUpdate');
  assert.equal(r.ok, false);
});
```

- [ ] **Passo 2: rodar e ver falhar** (`node --test test/update.test.js`)

Esperado: o baseline passa desde já (rede de segurança do refactor); `usa o checkUpdate injetado` falha em `o applyUpdate honrou deps.checkUpdate` (o segundo argumento é ignorado pela assinatura atual).

- [ ] **Passo 3: implementação mínima**

Cabeça do `applyUpdate` em `lib/engine/update.js` (o restante do corpo fica idêntico):

```js
// deps é injeção PRA TESTE: checkUpdate e downloadRemoteUpdate reais fazem rede
// via gh e o corpo chama o binding local (mock via exports não alcança). O default
// preserva a chamada de produção applyUpdate(engine) e mantém Function.length = 1,
// que o test/facades.test.js usa pra derivar a aridade esperada da fachada
// Engine.applyUpdate() (0 parâmetros). NÃO remova o `= {}`.
async function applyUpdate(engine, deps = {}) {
  const check = deps.checkUpdate || checkUpdate;
  const download = deps.downloadRemoteUpdate || downloadRemoteUpdate;
  await check(engine);
  if (!engine.update.available) return { ok: false, error: 'nenhuma atualização disponível' };
  if (engine.headlessBusyAccounts.size || engine.running.size || engine.headlessQueue.length) {
    return { ok: false, error: 'há análise ou chat em andamento; termine ou cancele antes de atualizar' };
  }
  // remoto: baixa e extrai a release; aponta a "fonte" pra pasta extraída
  if (engine.update.channel === 'remote') {
    try { engine.update.source = await download(engine); }
    catch (e) {
      engine.emit('toast', { kind: 'error', text: 'Falha ao baixar a atualização: ' + e.message });
      return { ok: false, error: e.message };
    }
  }
```

- [ ] **Passo 4: rodar a suite inteira** (`npm test && npm run check`) e conferir no output que TODOS os testes `fachada ... não engole argumento` seguem verdes.
- [ ] **Passo 5: commit** `refactor: injeção de checkUpdate e download no applyUpdate pra teste`

---

### Tarefa 5.4: Gravar o source do update no engine.update ATUAL depois do download (achados: M13)

**Arquivos:** Modify: `lib/engine/update.js` (bloco `channel === 'remote'` dentro de `applyUpdate`, hoje linhas 122-129) | Test: `test/update.test.js`

**Interfaces:** nenhuma nova; comportamento interno do `applyUpdate`.

**Dificuldades antecipadas:**
- A raiz do bug é sutil (semântica de avaliação do JS): em `engine.update.source = await download(...)` a referência-base `engine.update` é resolvida ANTES do await; o `checkUpdate` do ciclo de polling (server.js:637 roda a cada ciclo) reatribui `engine.update` durante o download e a gravação cai no objeto órfão → a correção em dois tempos (`const dir = await ...; engine.update.source = dir;`) reavalia `engine.update` DEPOIS do await. Comentário no código explica, senão alguém "simplifica" de volta.
- Depois da atribuição não há mais await até o spawn (tudo síncrono: `sessionsBusy`, `existsSync`, montagem do script), então não sobra outra janela de reatribuição; registrar isso no plano evita caça a lock desnecessário.
- Reproduzir a corrida em teste sem depender de timing → o próprio stub de download faz o papel do ciclo: reatribui `e.update` e só então retorna o diretório. Determinístico, sem sleep.
- Teste não pode chegar ao spawn (D5) → fixture sem `installer/`; o assert aceita o `ok:false` de `installer não encontrado` E confere `engine.update.source === dir` no objeto novo.

- [ ] **Passo 1: escrever o teste que falha**

Anexar ao final de `test/update.test.js` (o helper é compartilhado com 5.5 e 5.6):

```js
// engine.update remoto com release disponível, como o checkUpdate real deixaria
function updateRemotoDisponivel(e) {
  e.update = { current: '0.0.1', channel: 'remote', repo: 'x/y', source: null, sourceVersion: '9.9.9', available: true, checkedAt: Date.now() };
}

test('applyUpdate: checkUpdate concorrente durante o download não órfã o source (M13)', async () => {
  const engine = new Engine();
  engine.config.updateRepo = '';
  const dir = path.join(scratch, 'm13-extracted');
  fs.mkdirSync(dir, { recursive: true }); // de propósito SEM installer/: o fluxo para ANTES de qualquer spawn
  const r = await update.applyUpdate(engine, {
    checkUpdate: async (e) => updateRemotoDisponivel(e),
    downloadRemoteUpdate: async (e) => {
      // o ciclo de polling rodou checkUpdate no MEIO do download e reatribuiu engine.update
      updateRemotoDisponivel(e);
      return dir;
    }
  });
  assert.equal(r.ok, false);
  assert.match(String(r.error), /installer não encontrado/, 'parou no installer ausente, não em path.join(null)');
  assert.equal(engine.update.source, dir, 'source gravado no objeto ATUAL de engine.update, não no órfão');
});
```

- [ ] **Passo 2: rodar e ver falhar** (`node --test test/update.test.js`)

Esperado: o teste rejeita com `TypeError: The "path" argument must be of type string. Received null` (o `path.join(engine.update.source, 'installer', ...)` leu `null` do objeto reatribuído, exatamente o 500 do achado).

- [ ] **Passo 3: implementação mínima**

O bloco remoto do `applyUpdate` fica:

```js
  // remoto: baixa e extrai a release; aponta a "fonte" pra pasta extraída.
  // Atribuição em DOIS tempos de propósito: `engine.update.source = await ...`
  // resolvia a referência de engine.update ANTES do download, e o checkUpdate do
  // ciclo de polling que reatribui engine.update no meio deixava o source num
  // objeto órfão (o engine.update atual ficava com source null e o path.join(null)
  // explodia em 500, update nunca aplicava) (M13).
  if (engine.update.channel === 'remote') {
    let dir;
    try { dir = await download(engine); }
    catch (e) {
      engine.emit('toast', { kind: 'error', text: 'Falha ao baixar a atualização: ' + e.message });
      return { ok: false, error: e.message };
    }
    engine.update.source = dir;
  }
```

- [ ] **Passo 4: rodar a suite inteira** (`npm test && npm run check`)
- [ ] **Passo 5: commit** `fix: gravar o source do update no engine.update atual depois do download`

---

### Tarefa 5.5: Re-checar sessões ativas DEPOIS do download, antes do installer (achados: M15)

**Arquivos:** Modify: `lib/engine/update.js` (constante e helper novos antes de `applyUpdate`; checagem da linha 119 substituída; re-checagem inserida após o bloco remoto, antes do `if (!IS_WIN)`) | Test: `test/update.test.js`

**Interfaces:** nenhuma exportada nova (`sessionsBusy` e `BUSY_ERROR` ficam module-private).

**Dificuldades antecipadas:**
- A checagem precisa existir em DOIS pontos com a mesma mensagem (fail-fast antes de gastar download, e gate real depois dele) → extrair `sessionsBusy(engine)` e `BUSY_ERROR` pra não duplicar texto (uma mensagem divergente quebraria o assert e a UX).
- Posição exata importa: a re-checagem tem que vir ANTES do `if (!IS_WIN) return applyUpdateMac(engine)`, senão o mac fica desprotegido; depois dela não há mais await até o spawn, então não sobra janela nova.
- No canal `local` a re-checagem é redundante (não houve await de download relevante): inofensiva e determinística, não criar caso especial.
- Simular "sessão iniciada durante o download" sem polling real → o stub de download empurra um item em `engine.headlessQueue` (Engine real, campo real) antes de retornar; sem sleep, sem corrida.
- Teste nunca chega ao spawn mesmo pré-correção (D5) → fixture sem `installer/`; o vermelho é a mensagem errada (`installer não encontrado` em vez de `análise ou chat em andamento`).

- [ ] **Passo 1: escrever o teste que falha**

Anexar ao final de `test/update.test.js`:

```js
test('applyUpdate: revisão iniciada DURANTE o download barra o installer (M15)', async () => {
  const engine = new Engine();
  engine.config.updateRepo = '';
  const dir = path.join(scratch, 'm15-extracted');
  fs.mkdirSync(dir, { recursive: true }); // sem installer/: nem um fluxo quebrado chega ao spawn
  const r = await update.applyUpdate(engine, {
    checkUpdate: async (e) => updateRemotoDisponivel(e),
    downloadRemoteUpdate: async (e) => {
      // o polling iniciou uma revisão headless enquanto o download (minutos) rodava
      e.headlessQueue.push({ key: 'org/repo#1', url: 'https://github.com/org/repo/pull/1' });
      return dir;
    }
  });
  assert.equal(r.ok, false);
  assert.match(String(r.error), /análise ou chat em andamento/,
    'a checagem de ocupado precisa RE-rodar depois do download, não só antes');
});
```

- [ ] **Passo 2: rodar e ver falhar** (`node --test test/update.test.js`)

Esperado: falha no `assert.match` com o erro real `installer não encontrado em ...` (a checagem de ocupado só rodou antes do download, quando a fila ainda estava vazia).

- [ ] **Passo 3: implementação mínima**

Antes de `applyUpdate` em `lib/engine/update.js`:

```js
// O installer mata o Farol: sessão headless ou chat vivos morreriam no meio,
// possivelmente entre o APPROVE postado e a gravação do estado local. A MESMA
// checagem roda antes do download (fail-fast, não gasta banda) e DEPOIS dele
// (gate de verdade: o download dura minutos e o polling pode iniciar revisão).
const BUSY_ERROR = 'há análise ou chat em andamento; termine ou cancele antes de atualizar';
function sessionsBusy(engine) {
  return !!(engine.headlessBusyAccounts.size || engine.running.size || engine.headlessQueue.length);
}
```

No corpo do `applyUpdate`, a checagem antiga vira e a nova entra (corpo cumulativo com 5.3 e 5.4):

```js
  await check(engine);
  if (!engine.update.available) return { ok: false, error: 'nenhuma atualização disponível' };
  if (sessionsBusy(engine)) return { ok: false, error: BUSY_ERROR };
  if (engine.update.channel === 'remote') {
    let dir;
    try { dir = await download(engine); }
    catch (e) {
      engine.emit('toast', { kind: 'error', text: 'Falha ao baixar a atualização: ' + e.message });
      return { ok: false, error: e.message };
    }
    engine.update.source = dir;
  }
  // re-checa DEPOIS do download: revisão iniciada nesse meio tempo seria morta
  // pelo installer no meio da sessão (M15)
  if (sessionsBusy(engine)) return { ok: false, error: BUSY_ERROR };
  if (!IS_WIN) return applyUpdateMac(engine);
```

- [ ] **Passo 4: rodar a suite inteira** (`npm test && npm run check`)
- [ ] **Passo 5: commit** `fix: re-checar sessões ativas depois do download antes do installer`

---

### Tarefa 5.6: Guarda de reentrância no applyUpdate (achados: M16)

**Arquivos:** Modify: `lib/engine/update.js` (wrapper `applyUpdate` + corpo renomeado `applyUpdateInner`), `server.js:195` (inicializar `this.updateApplying` junto de `this.checking`) | Test: `test/update.test.js`

**Interfaces:** `applyUpdate(engine, deps = {})` mantém assinatura e retornos; novo estado em memória `engine.updateApplying: boolean` (inicializado `false` no construtor da Engine, nunca persistido). `applyUpdateInner` fica module-private (NÃO exportar).

**Dificuldades antecipadas:**
- Deadlock na fase vermelha do teste de concorrência (D7) → a segunda chamada usa deps próprios instantâneos; pré-correção ela resolve rápido com a mensagem errada, pós-correção nem chama o download (flag `chamouSegundoDownload`).
- Guarda ANTES do primeiro await é o ponto inteiro (o padrão P4 do relatório é exatamente checar-antes-do-await e marcar depois) → `engine.updateApplying = true` na primeira linha síncrona do wrapper; qualquer versão que marque depois do `await check(engine)` reabre a janela do clique duplo.
- Quando destravar: `ok:false` destrava (o usuário pode tentar de novo); `ok:true` fica LIGADO de propósito (o installer vai matar o processo; se não matar, o próximo boot zera porque o flag é só memória); exceção destrava e relança. Sem isso, um download que falhe deixaria o botão morto até reiniciar.
- Aridade da fachada continua em jogo (D3) → o wrapper conserva `deps = {}` (length 1); `applyUpdateInner(engine, deps)` sem default não entra na varredura porque não é fachada nem é exportada.
- Estado legado (D10) → flag só em memória, sem migração; inicialização no construtor serve de documentação viva no server.js.

- [ ] **Passo 1: escrever o teste que falha**

Anexar ao final de `test/update.test.js`:

```js
test('applyUpdate: segundo clique durante o download é recusado e falha destrava (M16)', async () => {
  const engine = new Engine();
  engine.config.updateRepo = '';
  const dir = path.join(scratch, 'm16-extracted');
  fs.mkdirSync(dir, { recursive: true }); // sem installer/: a primeira chamada termina em ok:false sem spawn
  let libera;
  const downloadTravado = new Promise(res => { libera = res; });
  const primeira = update.applyUpdate(engine, {
    checkUpdate: async (e) => updateRemotoDisponivel(e),
    downloadRemoteUpdate: async () => { await downloadTravado; return dir; }
  });
  // segunda chamada com deps PRÓPRIOS e instantâneos: sem a guarda ela resolve
  // rápido com a mensagem errada (vermelho limpo, sem deadlock no teste)
  let chamouSegundoDownload = false;
  const segunda = await update.applyUpdate(engine, {
    checkUpdate: async (e) => updateRemotoDisponivel(e),
    downloadRemoteUpdate: async () => { chamouSegundoDownload = true; return dir; }
  });
  assert.equal(segunda.ok, false);
  assert.match(String(segunda.error), /atualização já em andamento/);
  assert.equal(chamouSegundoDownload, false, 'a guarda barrou ANTES de qualquer download novo');
  libera();
  const r1 = await primeira;
  assert.equal(r1.ok, false, 'primeira chamada morre no installer ausente (fixture sem installer/)');
  const terceira = await update.applyUpdate(engine, {
    checkUpdate: async (e) => updateRemotoDisponivel(e),
    downloadRemoteUpdate: async () => dir
  });
  assert.match(String(terceira.error), /installer não encontrado/, 'ok:false destrava a guarda pro próximo clique');
});
```

- [ ] **Passo 2: rodar e ver falhar** (`node --test test/update.test.js`)

Esperado: falha em `assert.match(segunda.error, /atualização já em andamento/)` (a segunda chamada rodou inteira e devolveu `installer não encontrado`) e em `chamouSegundoDownload` (`true`, o download dela foi disparado). Sem travamento: a segunda chamada tem deps instantâneos.

- [ ] **Passo 3: implementação mínima**

Em `lib/engine/update.js`, o `applyUpdate` vira wrapper e o corpo atual (cumulativo das tarefas 5.2 a 5.5) é renomeado pra `applyUpdateInner`:

```js
async function applyUpdate(engine, deps = {}) {
  // Clique duplo em "Atualizar agora" (sem feedback visual durante o download)
  // disparava dois downloads e dois installers copiando por cima de ~/.farol/app
  // ao mesmo tempo (M16). A guarda liga ANTES do primeiro await (o padrão do bug
  // era checar-antes-do-await e marcar depois). Depois de ok:true ela fica LIGADA
  // de propósito: o installer vai matar o processo; se algo impedir, o próximo
  // boot zera (o flag vive só em memória, nunca persiste).
  if (engine.updateApplying) return { ok: false, error: 'atualização já em andamento' };
  engine.updateApplying = true;
  let r;
  try { r = await applyUpdateInner(engine, deps); }
  catch (err) { engine.updateApplying = false; throw err; }
  if (!r.ok) engine.updateApplying = false;
  return r;
}

async function applyUpdateInner(engine, deps) {
  const check = deps.checkUpdate || checkUpdate;
  const download = deps.downloadRemoteUpdate || downloadRemoteUpdate;
  await check(engine);
  if (!engine.update.available) return { ok: false, error: 'nenhuma atualização disponível' };
  if (sessionsBusy(engine)) return { ok: false, error: BUSY_ERROR };
  // remoto: baixa e extrai a release; aponta a "fonte" pra pasta extraída.
  // Atribuição em DOIS tempos de propósito: `engine.update.source = await ...`
  // resolvia a referência de engine.update ANTES do download, e o checkUpdate do
  // ciclo de polling que reatribui engine.update no meio deixava o source num
  // objeto órfão (o engine.update atual ficava com source null e o path.join(null)
  // explodia em 500, update nunca aplicava) (M13).
  if (engine.update.channel === 'remote') {
    let dir;
    try { dir = await download(engine); }
    catch (e) {
      engine.emit('toast', { kind: 'error', text: 'Falha ao baixar a atualização: ' + e.message });
      return { ok: false, error: e.message };
    }
    engine.update.source = dir;
  }
  // re-checa DEPOIS do download: revisão iniciada nesse meio tempo seria morta
  // pelo installer no meio da sessão (M15)
  if (sessionsBusy(engine)) return { ok: false, error: BUSY_ERROR };
  if (!IS_WIN) return applyUpdateMac(engine);
  const installer = path.join(engine.update.source, 'installer', 'install.ps1');
  if (!fs.existsSync(installer)) return { ok: false, error: `installer não encontrado em ${engine.update.source}\\installer` };
  const lnk = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Farol.lnk');
  // o script vive num .ps1 próprio e é lançado via Start-Process (ShellExecute)
  // pra sobreviver à morte deste processo (o installer mata o Farol no meio).
  // Não usar detached+windowsHide direto: as flags de console são incompatíveis.
  const dir = path.join(HOME, 'sessions');
  ensureDir(dir);
  const scriptFile = path.join(dir, `update-${Date.now()}.ps1`);
  fs.writeFileSync(scriptFile, [
    `& '${installer}' *> (Join-Path '${STATE_DIR}' 'update.log')`,
    'Start-Sleep -Seconds 1',
    `explorer.exe '${lnk}'`,
    `Remove-Item -LiteralPath '${scriptFile}' -Force -ErrorAction SilentlyContinue`
  ].join('\r\n'));
  const ps = buildUpdateLaunchCommand(scriptFile);
  logSpawn('applyUpdate', ['powershell.exe', scriptFile]);
  spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    { stdio: 'ignore', windowsHide: true });
  // farol.log é só falha: uma atualização iniciada não é erro, então não loga.
  engine.emit('toast', { kind: 'info', text: 'Atualizando: o Farol vai fechar e reabrir sozinho em instantes.' });
  return { ok: true, from: APP_VERSION, to: engine.update.sourceVersion };
}
```

Atenção ao detalhe: o corpo Windows reusa o nome local `dir` (pasta `sessions`); dentro do `applyUpdateInner` o `dir` do download vive só no bloco `if`, então não há conflito, mas confira o shadowing ao montar o diff.

Em `server.js`, junto de `this.checking = false;` (linha 195):

```js
    this.checking = false;
    this.updateApplying = false; // "Atualizar agora" em andamento (guarda de clique duplo; só memória)
```

- [ ] **Passo 4: rodar a suite inteira** (`npm test && npm run check`) e conferir que `fachada applyUpdate não engole argumento` segue verde.
- [ ] **Passo 5: commit** `fix: guarda de reentrância no applyUpdate contra clique duplo`

---

### Fechamento da onda

- Rodar `npm run check && npm test` uma última vez com tudo integrado (gate obrigatório do CLAUDE.md antes de qualquer entrega).
- O bloco final do `applyUpdate`/`applyUpdateInner` da tarefa 5.6 é o estado-alvo completo: conferir o arquivo contra ele.
- Nada desta onda muda config persistido, formato de estado em `~/.farol` ou contrato da UI (a rota `/api/update` devolve os mesmos shapes `{ok, error?}` e `{ok, from, to}`; as mensagens novas de erro aparecem no toast que a UI já mostra).
- Release e bump de versão ficam FORA da onda (seguem o checklist de release do CLAUDE.md quando o conjunto de ondas fechar).
