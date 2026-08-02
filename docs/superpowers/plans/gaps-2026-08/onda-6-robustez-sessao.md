# Rascunho de plano (Onda 6)

Fonte dos achados: `C:\Users\wanderson\Documents\biud\analise-farol-gaps-logicos\relatorio.md` (M3, M4, M5 na seção MÉDIA; B1 a B4 na seção BAIXA). Código alvo no commit `4d39d8f` (v2.30.1), fonte em `C:\Users\wanderson\Documents\farol`. Nada foi alterado no repositório; este arquivo é só o plano.

## Onda 6: Robustez de sessão e spawn

**Achados cobertos:** M3, M4, M5, B1, B2, B3, B4

**Dificuldades antecipadas da onda** (a parte MAIS importante do plano; o objetivo é ter a solução pronta antes do impedimento aparecer):

- **D1. O fake `filhoFalso` de `test/session-posix.test.js` quebra com as correções M4 e B4.** O stdout dele é `EventEmitter` puro (sem `setEncoding`) e o stdin é objeto `{ write, end }` (sem `.on`). Quando `runClaudeStream` passar a chamar `child.stdout.setEncoding('utf8')` e `child.stdin.on('error', ...)`, o executor da Promise lança `TypeError` ANTES de registrar o handler de `close`, e o pior: o `setTimeout` de 30 minutos já foi armado e nunca é limpo, então o arquivo de teste fica pendurado meia hora segurando o event loop. → Solução preparada: na MESMA edição da Tarefa 6.1, atualizar `filhoFalso` (linhas 44 a 52 de `test/session-posix.test.js`) com `child.stdout.setEncoding = () => { }` e `child.stdin = Object.assign(new EventEmitter(), { write() { }, end() { } })`. É o único fake do repo que passa por `runClaudeStream` (verificado por grep: só `session-posix.test.js` e `model-effort.test.js` importam `runClaudeStream`, e o segundo só usa `buildModelFlags`).
- **D2. `PassThrough` em flowing mode CONCATENA escritas enfileiradas.** O teste do M4 precisa de dois eventos `data` separados cortando um caractere no meio; se as duas metades forem escritas no mesmo tick, o `read()` interno devolve as duas num Buffer só e o bug não se manifesta (teste verde mentiroso na fase vermelha). → Solução preparada: escrever a primeira metade, aguardar `child.stdout.once('data', ...)` numa Promise, e só então escrever a segunda. O teste ainda valida a pré-condição (`corte > 0`) pra falhar alto se o texto de teste perder o caractere multibyte.
- **D3. Timer real de 30 minutos pendura a fase vermelha de qualquer teste que rejeita sem `finish`.** Sempre que uma asserção falha antes de o filho fake emitir `close`, o `setTimeout(30min)` de `runClaudeStream` fica armado e o processo do runner não morre. → Solução preparada: em TODOS os testes do arquivo novo, emitir `close` (que chama `finish` e limpa o timer) ANTES das asserções que podem falhar; no teste do B3, usar `t.mock.timers.enable({ apis: ['setTimeout'] })` do node:test (estável no Node 24, confirmado `node --version` = v24.15.0) e disparar o timeout com `t.mock.timers.tick(30 * 60 * 1000)`.
- **D4. Emitir `error` num stdin sem listener DERRUBA o processo do runner.** O modo de falha do B4 é exatamente `uncaughtException`; um teste ingênuo que emite o erro pra "provar" o crash mata o node:test inteiro na fase vermelha, sem relatório. → Solução preparada: guardar o emit com `if (child.stdin.listenerCount('error') > 0)` e fazer a asserção de vermelho sobre o `listenerCount` DEPOIS de o fluxo settle (a falha vira assert limpo, nunca crash).
- **D5. Mudar o fallback do M3 pode quebrar o contrato do stub e a classificação de erro do review.** Dois consumidores dependem do formato: (a) o stub `FAROL_HEADLESS_CMD` documentado no CLAUDE.md ("imprima um envelope {result} no stdout"), e (b) `lib/engine/review.js:131`, que classifica erro transitório com regex sobre `err.message` (`ECONNRESET|ENOTFOUND|ETIMEDOUT|...`). → Solução preparada: verificado por grep que NENHUM teste da suite usa `FAROL_HEADLESS_CMD` (o contrato vivo é só "envelope + exit 0", que continua passando pelo `parseEnvelope`); a mensagem nova mantém o prefixo `claude saiu com código N:` já existente e embute o stderr cru, então a regex do review continua enxergando `ECONNRESET` etc. dentro da mensagem. Um teste de regressão do envelope com exit 0 entra na Tarefa 6.2 pra pinar o contrato do stub.
- **D6. `test/session-unsee-on-exit.test.js` usa spawn REAL e não tem mock.** A Tarefa 6.5 precisa mockar o `spawn` do `open`, mas o arquivo já tem um teste Windows que depende do `powershell.exe` de verdade, e `lib/engine/session.js` captura `spawn` no load (trocar depois do require não afeta a referência). → Solução preparada: aplicar o padrão já provado de `test/session-claude-profile.test.js` (property swap com fallback pro spawn real quando `spawnImpl === null`), inserido ANTES do require da linha 27, com restauração no `after`. O teste real do Windows continua caindo no fallback.
- **D7. B1/B2 com Engine real: os stubs precisam valer via late binding.** `chat.js` e `tools.js` chamam `engine.refreshToken`/`engine.runClaudeStream`/`engine.toolPrompt` (contexto), nunca import direto, então substituir na instância funciona (verificado nas fontes). Dois pontos do caminho real ainda podem estourar por fora do que o teste quer provar: `pushState()` chama `this.snapshot()` completo, e `toolPrompt` lê `WORKSPACE/.claude/commands/pr-health.md`, que não existe num FAROL_HOME temporário sem boot. → Solução preparada: no fake, stubar `e.pushState = () => { }` e `e.toolPrompt = () => 'prompt de teste'`; `saveChats`/`saveToolRuns` já engolem erro de disco com try/catch, podem ficar reais.
- **D8. Na fase vermelha do B1, um `refreshToken` que nunca resolve trava o teste em vez de falhar.** Com deferred manual, as DUAS chamadas concorrentes criam Promises e a segunda sobrescreve o resolver da primeira: `await p1` pendura pra sempre e o teste morre por timeout confuso. → Solução preparada: `refreshToken` stub resolve sozinho após 30ms (`setTimeout`), o que mantém a janela da corrida aberta o suficiente e garante que a fase vermelha termina com asserção falhando (`r2.ok === true`), não com timeout.
- **D9. `open` pode disparar `error` E `exit` pro mesmo filho (double-fire).** O handler novo do M5 e o handler de `error` existente limpam o mesmo estado; rodando os dois, o unsee/toast duplicaria. → Solução preparada: o handler de `exit` usa o retorno booleano de `engine.activeReviews.delete(id)` como trava de idempotência (se o `error` já limpou, retorna sem fazer nada).
- **D10. Cross-platform: `spawnConsoleMac` roda em qualquer SO no teste, e é isso que queremos.** A função não checa `IS_WIN` (o branch fica no chamador `spawnConsole`), então o teste do M5 exercita o caminho macOS rodando no Windows, sem skip; ela grava um `.command` REAL em `HOME/sessions`. → Solução preparada: o arquivo de teste já fixa `FAROL_HOME` temporário antes de qualquer require (padrão da casa) e o fake engine ganha a fachada `buildSessionScriptMac` devolvendo script trivial; nenhum teste novo da onda usa skip por plataforma, os 7 fixes ficam cobertos nos dois SOs.
- **D11. Observação de escopo (não vira tarefa): `spawnLoginConsoleMac` (session.js:237) tem o mesmo gap do M5** (ignora exit != 0 do `open`), mas sem keys o dano é só pill preso, e o achado do relatório cita só `spawnConsoleMac`. Correção mínima: não expandir; registrar como candidato de onda futura pra não sumir.

---

### Tarefa 6.1: setEncoding utf8 no stdout do stream headless (achados: M4)

**Arquivos:** Modify: `lib/engine/session.js:397` (inserir antes do handler de data) e `test/session-posix.test.js:44-52` (fake) | Test: `test/session-stream.test.js` (novo)

**Interfaces:** Consome/Produz: nenhuma assinatura muda; `runClaudeStream(engine, prompt, opts)` segue igual. Contrato novo implícito: `child.stdout` recebe `setEncoding('utf8')`, então fakes de stdout precisam do método (ver D1).

**Dificuldades antecipadas:**
- Fake `filhoFalso` de session-posix quebra com o `setEncoding` (D1) → patch do fake NA MESMA edição, incluído no Passo 3.
- PassThrough concatena escritas enfileiradas e esconde o bug (D2) → aguardar o primeiro `data` antes da segunda metade, asserção de sanidade `corte > 0`.
- `recordUsage` não existe no engine fake e é chamado no caminho de result → o call site já embrulha em try/catch ("registro é opcional"), mas o fake declara `recordUsage() { }` mesmo assim pra não depender desse detalhe.

- [ ] **Passo 1: escrever o teste que falha.** Criar `test/session-stream.test.js` completo:

```js
'use strict';
// Robustez do stream headless (runClaudeStream): decodificação utf8 (M4), exit code != 0
// com stream parcial (M3), handler de error no stdin (B4) e timeout vs cancelamento (B3).
// Mesmo padrão dos vizinhos: FAROL_HOME temporário e mock de child_process.spawn ANTES
// do require de lib/engine/session (que captura `spawn` no load do módulo).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-stream-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const childProcess = require('child_process');
const realSpawn = childProcess.spawn;
let spawnImpl = null;
childProcess.spawn = function mockableSpawn(...args) {
  if (spawnImpl) return spawnImpl(...args);
  return realSpawn(...args);
};

const { runClaudeStream, cancelSession, parseEnvelope } = require('../lib/engine/session');

after(() => {
  childProcess.spawn = realSpawn;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// filho falso com stdout de STREAM REAL (PassThrough): o teste de multibyte precisa da
// maquinaria de verdade (StringDecoder via setEncoding), senão testaria o próprio fake.
// stdin é EventEmitter com write/end porque runClaudeStream registra handler de 'error'.
function filhoStream() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { write() { }, end() { } });
  child.pid = 4242;
  return child;
}

function engineFalso() {
  return {
    config: {},
    ghEnv: () => ({ PATH: process.env.PATH }),
    running: new Map(),
    killTree() { },
    recordUsage() { },
    toolSummary: () => '',
    parseEnvelope(raw) { return parseEnvelope(this, raw); },
  };
}

test('runClaudeStream: multibyte cortado no limite do chunk não vira U+FFFD (M4)', async () => {
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engineFalso(), 'prompt', {});
  spawnImpl = null;

  const texto = 'revisão aprovada: atenção na validação do módulo de sessão';
  const linha = Buffer.from(JSON.stringify({ type: 'result', result: texto, session_id: 's1' }) + '\n', 'utf8');
  const corte = linha.findIndex(b => b >= 0x80) + 1; // corta DENTRO do primeiro caractere multibyte
  assert.ok(corte > 0, 'o texto de teste precisa ter caractere multibyte');

  // duas metades em DOIS eventos data separados: em flowing mode, escritas enfileiradas
  // no mesmo tick seriam concatenadas num Buffer só e o corte sumiria
  const primeiroChunk = new Promise(r => child.stdout.once('data', r));
  child.stdout.write(linha.slice(0, corte));
  await primeiroChunk;
  child.stdout.once('end', () => child.emit('close', 0));
  child.stdout.write(linha.slice(corte));
  child.stdout.end();

  const res = await p;
  assert.doesNotMatch(res.text, /\uFFFD/, 'U+FFFD = chunk decodificado como Buffer isolado');
  assert.equal(res.text, texto);
  assert.equal(res.sessionId, 's1');
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/session-stream.test.js`. Esperado: 1 teste, 1 falha, com a asserção `doesNotMatch` acusando `\uFFFD` dentro de `res.text` (o `String(c)` por Buffer corrompeu o caractere cortado).

- [ ] **Passo 3: implementação mínima.** Em `lib/engine/session.js`, o trecho da linha 397 fica assim (uma linha nova antes do handler; `c = String(c)` fica, vira no-op inofensivo sobre string):

```js
    // chunk pode cortar caractere multibyte no meio (o evento result é a linha mais
    // longa, a mais provável de atravessar o limite de 64KB): setEncoding liga o
    // StringDecoder do stream, que remonta o caractere entre chunks. String(c) por
    // Buffer isolado virava U+FFFD dentro do texto, até em review postado (M4).
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => {
      c = String(c);
      if (raw.length < 32 * 1024 * 1024) raw += c;
      lineBuf += c;
      let nl;
      while ((nl = lineBuf.indexOf('\n')) >= 0) {
        handleLine(lineBuf.slice(0, nl));
        lineBuf = lineBuf.slice(nl + 1);
      }
    });
```

E em `test/session-posix.test.js`, `filhoFalso` (linhas 44 a 52) fica assim (patch preventivo do D1, já cobre também o B4 da Tarefa 6.3):

```js
// filho falso: encerra na hora pra runClaudeStream resolver sem processo de verdade
function filhoFalso() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => { }; // runClaudeStream liga utf8 no stream real (M4)
  child.stderr = new EventEmitter();
  // stdin precisa de .on: runClaudeStream registra handler de 'error' (B4)
  child.stdin = Object.assign(new EventEmitter(), { write() { }, end() { } });
  child.pid = 4242;
  setImmediate(() => { child.emit('close', 0); });
  return child;
}
```

- [ ] **Passo 4: rodar a suite inteira.** `npm test && npm run check` (atenção especial a `test/session-posix.test.js`, que é quem quebraria sem o patch do fake).

- [ ] **Passo 5: commit.** `fix(session): decodifica stdout como utf8 pra nao corromper multibyte cortado no chunk`

---

### Tarefa 6.2: exit != 0 sem evento result vira erro, nunca sucesso (achados: M3)

**Arquivos:** Modify: `lib/engine/session.js:423-426` (fallback do close) | Test: `test/session-stream.test.js`

**Interfaces:** Consome/Produz: nenhuma assinatura muda. Formato de erro preservado: prefixo `claude saiu com código N:` (a classificação de transitório em `lib/engine/review.js:131` faz regex sobre `err.message` e continua casando `ECONNRESET` etc. vindos do stderr embutido). Efeito colateral desejado no chat: um resume que falha agora chega como stderr real (`No conversation found with session ID ...`), que casa a regex de retry do `chat.js:85`.

**Dificuldades antecipadas:**
- Contrato do stub `FAROL_HEADLESS_CMD` (envelope + exit 0) não pode quebrar (D5) → o novo `if (code !== 0)` só intercepta exit != 0; envelope com exit 0 segue pro `parseEnvelope`, e o teste de regressão abaixo pina isso.
- Envelope com `is_error: true` e exit 0 (CLI antigo) precisa continuar lançando o erro ESPECÍFICO (`sessão retornou erro: ...`) → o caminho não muda: `parseEnvelope` já lança e o `catch (e) { finish(e); }` propaga; nada a fazer além de não interceptar exit 0.
- Fase vermelha não pode pendurar o timer de 30min (D3) → o teste emite `close` (via `once('end')`) antes do `assert.rejects`, então `finish` roda e limpa o timer mesmo quando a asserção falha.

- [ ] **Passo 1: escrever o teste que falha.** Acrescentar em `test/session-stream.test.js`:

```js
test('runClaudeStream: exit != 0 com stream parcial (sem evento result) é ERRO, não sucesso (M3)', async () => {
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engineFalso(), 'prompt', {});
  spawnImpl = null;

  // o claude morre DEPOIS de emitir NDJSON e ANTES do evento result
  child.stdout.write('{"type":"system","subtype":"init","model":"claude-opus-5","session_id":"s1"}\n');
  child.stdout.write('{"type":"assistant","message":{"content":[{"type":"text","text":"analisando o diff"}]}}\n');
  child.stderr.emit('data', 'FATAL ERROR: JavaScript heap out of memory');
  child.stdout.once('end', () => child.emit('close', 134));
  child.stdout.end();

  await assert.rejects(p, (err) => {
    assert.match(err.message, /saiu com código 134/, 'o exit code real tem que aparecer');
    assert.match(err.message, /heap out of memory/, 'o stderr real tem que aparecer');
    assert.doesNotMatch(err.message, /"type":"system"/, 'NDJSON cru não é mensagem de erro');
    return true;
  });
});

test('runClaudeStream: envelope do stub com exit 0 continua valendo (regressão do fallback)', async () => {
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engineFalso(), 'prompt', {});
  spawnImpl = null;

  child.stdout.once('end', () => child.emit('close', 0));
  child.stdout.write('{"result":"envelope do stub","is_error":false}\n');
  child.stdout.end();

  const res = await p;
  assert.equal(res.text, 'envelope do stub', 'contrato do FAROL_HEADLESS_CMD: envelope + exit 0');
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/session-stream.test.js`. Esperado: o teste do M3 falha com `Missing expected rejection` (hoje o NDJSON cru resolve como sucesso via `parseEnvelope`); o teste do envelope passa (é pino de regressão).

- [ ] **Passo 3: implementação mínima.** Em `lib/engine/session.js`, as linhas 423 a 426 ficam assim:

```js
      // sem evento result: stub de teste ou CLI antigo, parseia o envelope inteiro.
      // Exit != 0 NUNCA vira sucesso: claude que morreu no meio deixa NDJSON parcial
      // no raw, e esse cru não é resposta (virava "texto" no chat e SyntaxError
      // genérico no review). O detalhe real sai do stderr (M3).
      if (code !== 0) {
        const detail = errBuf.trim() || (raw.trim() ? 'stream interrompido antes do evento result' : 'sem saida');
        return finish(new Error(`claude saiu com código ${code}: ${detail.slice(0, 300)}`));
      }
      try { finish(null, { text: engine.parseEnvelope(raw), sessionId }); }
      catch (e) { finish(e); }
```

- [ ] **Passo 4: rodar a suite inteira.** `npm test && npm run check`.

- [ ] **Passo 5: commit.** `fix(session): exit code != 0 sem evento result vira erro, nunca sucesso com NDJSON cru`

---

### Tarefa 6.3: handler de error no stdin (EPIPE não derruba o engine) (achados: B4)

**Arquivos:** Modify: `lib/engine/session.js:428-429` | Test: `test/session-stream.test.js`

**Interfaces:** Consome/Produz: nenhuma assinatura muda. Contrato novo implícito: fakes de stdin precisam de `.on` (já resolvido pelo patch do `filhoFalso` na Tarefa 6.1).

**Dificuldades antecipadas:**
- Emitir `error` sem listener mata o runner na fase vermelha (D4) → o emit é guardado por `listenerCount` e a prova de vermelho é a asserção final sobre `handlers >= 1`, que falha limpa.
- A rejeição do `close 1` depende do comportamento de exit != 0 → o teste funciona ANTES e DEPOIS da Tarefa 6.2 (com raw vazio, até o código antigo já rejeitava), então a ordem entre 6.2 e 6.3 não trava; mantida a ordem do plano por clareza.

- [ ] **Passo 1: escrever o teste que falha.** Acrescentar em `test/session-stream.test.js`:

```js
test('runClaudeStream: stdin tem handler de error (EPIPE de processo morto não derruba o engine) (B4)', async () => {
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engineFalso(), 'x'.repeat(128 * 1024), {}); // prompt maior que o pipe de 64KB
  spawnImpl = null;

  const handlers = child.stdin.listenerCount('error');
  // só emite se tem quem ouça: sem handler, o emit derrubaria o PROCESSO do teste
  // (uncaughtException), que é exatamente o modo de falha do achado
  if (handlers > 0) {
    child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE', syscall: 'write' }));
  }
  child.stderr.emit('data', 'morreu antes de ler o prompt');
  child.stdout.once('end', () => child.emit('close', 1));
  child.stdout.end();
  await assert.rejects(p, /saiu com código 1/, 'a causa real da morte vem pelo close, não pelo EPIPE');

  assert.ok(handlers >= 1, 'child.stdin sem handler de error: EPIPE assíncrono vira uncaughtException e mata o engine');
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/session-stream.test.js`. Esperado: falha na asserção final (`handlers >= 1`), sem crash do runner (o emit foi pulado porque `handlers === 0`).

- [ ] **Passo 3: implementação mínima.** Em `lib/engine/session.js`, as linhas 428 e 429 ficam assim:

```js
    // EPIPE assíncrono de um filho que morreu antes de ler o prompt inteiro (>64KB no
    // pipe) não pode virar uncaughtException: sem handler, derruba o engine (B4). Só
    // absorve; a causa real da morte é reportada pelo close.
    child.stdin.on('error', () => { });
    child.stdin.write(prompt);
    child.stdin.end();
```

- [ ] **Passo 4: rodar a suite inteira.** `npm test && npm run check`.

- [ ] **Passo 5: commit.** `fix(session): stdin da sessao headless ganha handler de error (EPIPE nao derruba o engine)`

---

### Tarefa 6.4: timeout de 30min não engole cancelamento em andamento (achados: B3)

**Arquivos:** Modify: `lib/engine/session.js:352-356` | Test: `test/session-stream.test.js`

**Interfaces:** Consome/Produz: nenhuma assinatura muda. `cancelSession(engine, id)` (exportada) é usada no teste com `engine.running` real (Map) e `killTree` stub.

**Dificuldades antecipadas:**
- Não dá pra esperar 30 minutos → `t.mock.timers.enable({ apis: ['setTimeout'] })` + `tick(30 * 60 * 1000)` (Node 24, estável; D3). O mock cobre `setTimeout`/`clearTimeout`; `setImmediate` e streams não são afetados.
- O mock precisa estar ligado ANTES do `runClaudeStream` armar o timer → `enable` é a primeira linha do teste.
- Semântica do reset antigo: a linha `run.cancelled = false` existia pra "timeout não é cancelamento do usuário", mas `run.cancelled` só vira `true` pela mão do usuário (`cancelSession`), então o reset só tem efeito observável quando DESTRÓI um cancelamento em andamento; remover é seguro. Se o timeout dispara primeiro, `finish` resolve antes e o `close` posterior é no-op (`done = true`), como hoje.
- Cancelamento DEPOIS do timeout: `finish` já removeu a entrada de `engine.running`, então `cancelSession` devolve `sessão não encontrada`, comportamento atual preservado.

- [ ] **Passo 1: escrever o teste que falha.** Acrescentar em `test/session-stream.test.js`:

```js
test('runClaudeStream: timeout de 30min não engole cancelamento em andamento (B3)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const engine = engineFalso();
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engine, 'prompt', { id: 'sess-1' });
  spawnImpl = null;

  // o usuário cancela: killTree disparado, mas o close do processo ainda não chegou
  assert.equal(cancelSession(engine, 'sess-1').ok, true);
  // o timer de 30min vence NESSA janela, antes do close
  t.mock.timers.tick(30 * 60 * 1000);
  child.emit('close', null); // processo morto pelo killTree do cancelamento

  await assert.rejects(p, (err) => {
    assert.equal(err.cancelled, true, 'cancelamento do usuário virou outra coisa');
    assert.match(err.message, /cancelada por você/);
    return true;
  });
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/session-stream.test.js`. Esperado: o validator falha porque a rejeição chega como `tempo esgotado (30min) na sessão autônoma` sem `err.cancelled` (o timeout sobrescreveu `run.cancelled = true` e chamou `finish` primeiro).

- [ ] **Passo 3: implementação mínima.** Em `lib/engine/session.js`, as linhas 352 a 356 ficam assim (sai o reset da flag, entra o retorno cedo):

```js
    const timeout = setTimeout(() => {
      // cancelamento do usuário em andamento: o killTree dele já foi disparado e o
      // close vai reportar 'cancelada por você'. Sobrescrever a flag aqui fazia o
      // cancelamento virar "falha por tempo esgotado" (B3).
      if (run.cancelled) return;
      engine.killTree(child.pid);
      finish(new Error('tempo esgotado (30min) na sessão autônoma'));
    }, 30 * 60 * 1000);
```

- [ ] **Passo 4: rodar a suite inteira.** `npm test && npm run check`.

- [ ] **Passo 5: commit.** `fix(session): timeout de 30min nao sobrescreve cancelamento em andamento`

---

### Tarefa 6.5: spawnConsoleMac trata exit code do open (achados: M5)

**Arquivos:** Modify: `lib/engine/session.js:78-87` (handler novo após o de error) e `test/session-unsee-on-exit.test.js:23-49` (mock de spawn + fachada no fake) | Test: `test/session-unsee-on-exit.test.js`

**Interfaces:** Consome/Produz: nenhuma assinatura muda. O fake engine do arquivo de teste ganha `buildSessionScriptMac(slash, id, user)` (fachada, espelha a que a Engine real tem em server.js).

**Dificuldades antecipadas:**
- O arquivo de teste usa spawn real e não tem mock (D6) → property swap com fallback ANTES do require da linha 27, restauração no `after`; o teste Windows real continua no fallback.
- Double-fire error + exit do mesmo filho (D9) → `if (!engine.activeReviews.delete(id)) return;` como trava de idempotência no handler novo.
- `exit 0` do `open` NÃO é fim de sessão (o open retorna na hora; o fim real chega pelo trap EXIT do `.command` via `/api/session-exit`) → o handler novo só age com `code` truthy, e o segundo teste pina que exit 0 não mexe em nada e que `sessionExit` continua fechando o ciclo.
- O toast do fake guarda `{ kind: evento, payload }` (o `kind` é o NOME do evento, `'toast'`) → a asserção correta é `t.kind === 'toast' && t.payload.kind === 'error'`, não `t.kind === 'error'`.
- A função grava um `.command` real → `FAROL_HOME` temporário já está fixado no topo do arquivo; o teste de exit != 0 também assevera que o script órfão foi apagado (o trap nunca vai rodar pra se apagar sozinho).

- [ ] **Passo 1: escrever o teste que falha.** Em `test/session-unsee-on-exit.test.js`: (a) inserir o mock ANTES do require da linha 27; (b) importar `spawnConsoleMac`; (c) fachada no fake; (d) dois testes novos.

Trecho (a), inserido entre a linha 23 (`fs.mkdirSync(...)`) e a linha 25 (`const { test, after } ...`):

```js
// mock de child_process.spawn pros testes de spawnConsoleMac (M5): lib/engine/session.js
// captura `spawn` no load, então a troca precisa vir ANTES do require abaixo (mesmo
// padrão de test/session-claude-profile.test.js). Sem spawnImpl setado, delega pro
// spawn real (o teste de spawnConsole real do Windows, mais abaixo, depende disso).
const childProcess = require('child_process');
const realSpawn = childProcess.spawn;
let spawnImpl = null;
childProcess.spawn = function mockableSpawn(...args) {
  if (spawnImpl) return spawnImpl(...args);
  return realSpawn(...args);
};
const { EventEmitter } = require('node:events');
```

Trecho (b), a linha 27 vira:

```js
const { spawnConsole, spawnConsoleMac, sessionExit, handleSessionExit } = require('../lib/engine/session');
```

E o `after` da linha 29 vira:

```js
after(() => {
  childProcess.spawn = realSpawn;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});
```

Trecho (c), dentro do `fakeEngine`, logo abaixo da fachada `buildSessionScript` existente:

```js
    buildSessionScriptMac(slash, id, user) { return '#!/bin/bash\nexit 0\n'; }, // script minimo valido
```

Trecho (d), os dois testes novos no fim do arquivo:

```js
// M5: `open -a Terminal` retorna na hora; exit 0 = Terminal lançado (o fim REAL da
// sessão chega depois, pelo trap EXIT do .command). Exit != 0 = o Terminal nunca abriu
// (permissão de automação negada, MDM): sem tratar, o pill fica preso e as keys ficam
// vistas pra sempre, PR sumido da fila (o inflight só cobre sessões auto).
test('spawnConsoleMac: open saindo != 0 desfaz o visto, remove a sessão e avisa (M5)', () => {
  const engine = fakeEngine();
  const fakeChild = new EventEmitter();
  let scriptGravado = null;
  spawnImpl = (cmd, args) => { scriptGravado = args[2]; return fakeChild; }; // spawn('open', ['-a','Terminal',script])
  try {
    spawnConsoleMac(engine, '/pr-review x', 'Revisão de 1 PR', ['org/repo#7'], 'alice');
  } finally {
    spawnImpl = null;
  }
  const id = Array.from(engine.activeReviews.keys())[0];
  assert.ok(id, 'sessão registrada antes do exit');
  assert.equal(fs.existsSync(scriptGravado), true, 'o .command foi gravado');

  fakeChild.emit('exit', 1);

  assert.equal(engine.activeReviews.size, 0, 'pill não pode ficar preso');
  assert.deepEqual(engine._unseen, ['org/repo#7'], 'sem unsee o PR some da fila pra sempre');
  assert.equal(engine.checkedNow, true, 'a fila precisa ser rechecada');
  assert.ok(engine._toasts.some(t => t.kind === 'toast' && t.payload.kind === 'error'), 'o usuário precisa saber que não abriu');
  assert.equal(fs.existsSync(scriptGravado), false, 'o trap EXIT nunca vai rodar; o script órfão tem que ser apagado');
});

test('spawnConsoleMac: open saindo 0 não mexe em nada; o fim real chega pelo trap EXIT (M5)', () => {
  const engine = fakeEngine();
  const fakeChild = new EventEmitter();
  spawnImpl = () => fakeChild;
  try {
    spawnConsoleMac(engine, '/pr-review x', 'Revisão de 1 PR', ['org/repo#7'], 'alice');
  } finally {
    spawnImpl = null;
  }
  const id = Array.from(engine.activeReviews.keys())[0];

  fakeChild.emit('exit', 0); // open lançou o Terminal e retornou; a sessão segue viva

  assert.equal(engine.activeReviews.has(id), true, 'sessão continua ativa');
  assert.deepEqual(engine._unseen, [], 'não desfaz visto de sessão viva');

  const r = sessionExit(engine, id); // o trap EXIT do .command chama /api/session-exit
  assert.equal(r.ok, true);
  assert.deepEqual(engine._unseen, ['org/repo#7'], 'o ciclo fecha pelo caminho de sempre');
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/session-unsee-on-exit.test.js`. Esperado: o teste de exit != 0 falha na primeira asserção pós-emit (`activeReviews.size` é 1, não 0), porque hoje não existe handler de `exit`. O teste de exit 0 já passa (pino do comportamento atual).

- [ ] **Passo 3: implementação mínima.** Em `lib/engine/session.js`, depois do `child.on('error', ...)` (linha 85) e antes do `engine.pushState()` final da função, entra:

```js
  // open retorna na hora: exit 0 = Terminal lançado (o fim REAL da sessão chega
  // depois, pelo trap EXIT do .command via /api/session-exit). Exit != 0 = o Terminal
  // nunca abriu (permissão de automação negada, MDM): sem isto o pill ficava preso e
  // as keys vistas pra sempre, PR sumido da fila (M5). O delete devolve false se o
  // handler de error já limpou (open pode disparar error E exit pro mesmo filho).
  child.on('exit', (code) => {
    if (!code) return;
    try { fs.unlinkSync(script); } catch { }
    if (!engine.activeReviews.delete(id)) return;
    for (const k of keys) engine.unsee(k);
    engine.log('ERROR', `falha ao abrir sessao "${label}" no Terminal: open saiu com codigo ${code}`);
    engine.emit('toast', { kind: 'error', text: `Não consegui abrir a sessão no Terminal (código ${code}).` });
    engine.pushState();
    if (keys.length) engine.checkNow();
  });
```

- [ ] **Passo 4: rodar a suite inteira.** `npm test && npm run check`.

- [ ] **Passo 5: commit.** `fix(session): spawnConsoleMac trata exit code do open (sessao nao fica presa nem PR some da fila)`

---

### Tarefa 6.6: chatSend marca running antes de qualquer await (achados: B1)

**Arquivos:** Modify: `lib/engine/chat.js:47` (remover) e `lib/engine/chat.js:77-79` (inserir no try) | Test: `test/reentrancy.test.js` (novo)

**Interfaces:** Consome/Produz: assinatura `chatSend(engine, key, url, text)` inalterada; o retorno `{ ok: true }` passa a ser síncrono de fato (antes havia um await de token antes do return). Falha do `refreshToken` deixa de rejeitar a chamada HTTP e vira mensagem `falha: ...` no próprio chat (o catch existente já cobre), com o `finally` devolvendo o status pra `idle`.

**Dificuldades antecipadas:**
- Deferred manual no stub trava a fase vermelha em timeout (D8) → `refreshToken` resolve sozinho em 30ms.
- `pushState()` real chama `snapshot()` completo num engine sem boot (D7) → stub `e.pushState = () => { }` no helper.
- O teste precisa provar as DUAS metades do dano: guarda furada (r2.ok true) e geração dupla (`_geracoes === 2`) e mensagem duplicada no histórico → três asserções separadas, qualquer uma denuncia regressão sozinha.
- Espera pelo fim do IIFE fire-and-forget → helper `esperar` com polling de 10ms e teto de 2s (mesmo idioma do teste de spawnConsole real).

- [ ] **Passo 1: escrever o teste que falha.** Criar `test/reentrancy.test.js` completo:

```js
'use strict';
// Guardas de reentrância checadas ANTES de um await (padrão P4 do relatório de gaps):
// chatSend (B1) e launchTool (B2) liam o status, davam await no refreshToken e SÓ ENTÃO
// marcavam 'running'. Duas chamadas na mesma janela passavam as duas pela guarda: duas
// gerações concorrentes no mesmo chat, duas sessões da mesma ferramenta (custo em dobro,
// resultado sobrescrito). A correção marca 'running' de forma síncrona e move o
// refreshToken pra dentro do bloco async (falha vira mensagem; o finally restaura).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-reentrancy-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../server.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

function esperar(cond, ms = 2000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (cond()) { clearInterval(iv); resolve(); return; }
      if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('timeout esperando a condição')); }
    }, 10);
  });
}

// Engine real com os pontos de rede/sessão substituídos NA INSTÂNCIA: chat.js e tools.js
// chamam engine.refreshToken/engine.runClaudeStream/engine.toolPrompt via contexto (late
// binding), então o stub na instância vale. O refreshToken lento (30ms) segura aberta a
// janela da corrida antiga; pushState é stubado porque snapshot() completo não interessa
// aqui e toolPrompt leria um arquivo do workspace que não existe sem boot.
function engineStubado() {
  const e = new Engine();
  e.token = null; // força o caminho do await do refreshToken
  e.refreshToken = () => new Promise(r => setTimeout(() => { e.token = 'tok'; r(true); }, 30));
  e.pushState = () => { };
  e._geracoes = 0;
  e.runClaudeStream = async () => { e._geracoes++; return { text: 'resposta', sessionId: 's1' }; };
  return e;
}

test('chatSend: segunda mensagem na janela do refreshToken é recusada (B1)', async () => {
  const e = engineStubado();
  const p1 = e.chatSend('acme/app#1', 'https://github.com/acme/app/pull/1', 'primeira');
  const p2 = e.chatSend('acme/app#1', 'https://github.com/acme/app/pull/1', 'segunda');
  const r1 = await p1;
  const r2 = await p2;
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, false, 'as duas passaram pela guarda: corrida aberta');
  assert.match(r2.error, /aguarde/);
  await esperar(() => e.chats['acme/app#1'].status === 'idle');
  assert.equal(e._geracoes, 1, 'uma única sessão do Claude por mensagem');
  const doUsuario = e.chats['acme/app#1'].messages.filter(m => m.role === 'user');
  assert.equal(doUsuario.length, 1, 'a mensagem recusada não entra no histórico');
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/reentrancy.test.js`. Esperado: falha em `r2.ok === false` (hoje as duas chamadas atravessam a guarda durante o await do token e ambas devolvem ok), e se essa asserção fosse relaxada, `_geracoes` seria 2 e `doUsuario.length` seria 2.

- [ ] **Passo 3: implementação mínima.** Em `lib/engine/chat.js`: a linha 47 (`if (!engine.token) await engine.refreshToken();`) sai do corpo síncrono, e o começo do IIFE (linhas 77 a 79) fica assim:

```js
  (async () => {
    try {
      // o refresh fica DEPOIS da marcação síncrona de status 'running': a guarda lá em
      // cima fecha a janela de reentrância sem nenhum await no meio (B1). Se o refresh
      // falhar, o catch registra a falha no chat e o finally devolve o status pra idle.
      if (!engine.token) await engine.refreshToken();
      const prompt = chat.seeded ? text : engine.chatPreamble(key, chat.url, inherited) + text;
```

O trecho da guarda (linhas 46 a 50) fica, sem a linha do refresh:

```js
  if (chat.status === 'running') return { ok: false, error: 'aguarde a resposta atual (ou pare a geração)' };
  chat.url = chat.url || url || null;
  chat.messages.push({ role: 'user', text, at: Date.now() });
  chat.status = 'running';
```

- [ ] **Passo 4: rodar a suite inteira.** `npm test && npm run check`.

- [ ] **Passo 5: commit.** `fix(chat): marca running antes do await do token (corrida de geracoes duplas no mesmo chat)`

---

### Tarefa 6.7: launchTool marca running antes de qualquer await (achados: B2)

**Arquivos:** Modify: `lib/engine/tools.js:87` (remover) e `lib/engine/tools.js:94-96` (inserir no try) | Test: `test/reentrancy.test.js`

**Interfaces:** Consome/Produz: assinatura `launchTool(engine, name, scope)` inalterada; `{ ok: true }` vira síncrono de fato. Falha do `refreshToken` cai no catch existente (`toolRunSet(..., { status: 'error' })` + toast), em vez de rejeitar a rota.

**Dificuldades antecipadas:**
- `toolPrompt` real lê `WORKSPACE/.claude/commands/pr-health.md`, inexistente num FAROL_HOME sem boot (D7) → stub `e.toolPrompt = () => 'prompt de teste'` na instância (a fachada existe e o módulo chama `engine.toolPrompt`).
- Usar `kudos` exigiria semear highlights → o teste usa `health`, que não tem pré-condição de dados.
- `saveToolRuns` grava em STATE_DIR possivelmente inexistente → o try/catch interno já engole; nada a fazer.
- A ordem pós-fix precisa continuar: guarda, checagens do kudos, `activeReviews.set`, `activity.set`, `toolRunSet('running')`, `saveToolRuns`, IIFE → o diff só move a linha do refresh, não reordena o resto.

- [ ] **Passo 1: escrever o teste que falha.** Acrescentar em `test/reentrancy.test.js`:

```js
test('launchTool: segundo clique na janela do refreshToken é recusado (B2)', async () => {
  const e = engineStubado();
  e.toolPrompt = () => 'prompt de teste';
  const p1 = e.launchTool('health');
  const p2 = e.launchTool('health');
  const r1 = await p1;
  const r2 = await p2;
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, false, 'as duas passaram pela guarda: sessão headless dobrada');
  assert.match(r2.error, /já está rodando/);
  await esperar(() => { const run = e.toolRunGet('health'); return run && run.status !== 'running'; });
  assert.equal(e.toolRunGet('health').status, 'done');
  assert.equal(e._geracoes, 1, 'uma única sessão da ferramenta, não custo em dobro');
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/reentrancy.test.js`. Esperado: o teste do B1 (já corrigido na 6.6) passa; o do B2 falha em `r2.ok === false` (hoje os dois cliques atravessam a guarda e `_geracoes` termina em 2).

- [ ] **Passo 3: implementação mínima.** Em `lib/engine/tools.js`: a linha 87 (`if (!engine.token) await engine.refreshToken();`) sai, e o começo do IIFE (linhas 94 a 96) fica assim:

```js
  (async () => {
    try {
      // o refresh fica DEPOIS do toolRunSet('running') síncrono: a guarda 'já está
      // rodando' fecha a janela de reentrância sem await no meio (B2). Falha do
      // refresh cai no catch normal (status 'error' + toast).
      if (!engine.token) await engine.refreshToken();
      const res = await engine.runClaudeStream(engine.toolPrompt(name, { scoped, list: scopedList, label: scopeName }), {
        id,
        onEvent: (e) => engine.pushActivity(id, e.kind, e.text)
      });
```

- [ ] **Passo 4: rodar a suite inteira.** `npm test && npm run check`.

- [ ] **Passo 5: commit.** `fix(tools): marca running antes do await do token (ferramenta nao roda em dobro)`

---

## Verificação de fechamento da onda

- `npm test && npm run check` verdes no Windows (e, quando um Mac rodar, os testes novos não têm skip por plataforma: cobrem o caminho mac por injeção de fake, ver D10).
- Conferir que `test/facades.test.js` segue verde: nenhuma fachada mudou de assinatura nesta onda (a checagem é derivada do fonte do server.js, que não é tocado).
- Releitura dos 7 achados no relatório confirmando que cada cenário descrito agora tem teste com o nome do achado no título.
- Registrar D11 (spawnLoginConsoleMac com o mesmo gap do M5, dano menor) como candidato de onda futura.
