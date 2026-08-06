# Checkpoint de verificação: implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar à revisão headless uma memória persistida e auditável do que já foi verificado, pra uma sessão que precisa recomeçar (subagente travado em `529`, ou relançamento inteiro depois de timeout) não repetir do zero o que já foi confirmado, com qualquer divergência entre passadas virando ponto de atenção visível, nunca resolvida em silêncio.

**Architecture:** Um arquivo de checkpoint por PR (`state/verification/<key codificada>.json`, append-only), escrito pelo ENGINE (nunca pelo modelo, que é proibido de escrever em `state/`) ao interceptar um marcador estruturado (`FAROL_CHECKPOINT: {...}`) no campo `description` de uma chamada Bash que a sessão já roda. Lido pelo engine antes do gate de decisão (mesmo padrão de `coverage`/`coverageGap`) e usado pra montar um bloco de retomada no prompt de sessões relançadas.

**Tech Stack:** Node puro, `node --test` (runner nativo, zero dependências), Electron 43, Windows + macOS.

## Spec de referência

`docs/superpowers/specs/2026-08-05-checkpoint-verificacao-design.md` (ler inteira antes de começar; este plano segue ela seção por seção, já com as 3 correções da 3ª conferência incorporadas).

## Global Constraints

- Fonte é a verdade: todo trabalho em `~/Documents/farol` (não confundir com a cópia instalada em `~/.farol/app`).
- Commits: conventional commits, um por tarefa, **SEM** trailer de co-autoria (`no-coauthor-commits`).
- Cada tarefa: teste que falha primeiro, implementação mínima, `npm run check && npm test` verdes antes do commit.
- **A sessão headless NUNCA escreve em `state/` diretamente** (regra 2 de `workspace-template/prompts/pr-review-auto.md`, invariável). Toda escrita do checkpoint é feita pelo ENGINE, nunca por Write/Edit da sessão.
- Proibido travessão (em-dash) em qualquer texto produzido (código, comentário, doc, commit); usar vírgula, "e" ou parênteses.
- Texto de UI e comentários em português (regra do CLAUDE.md do projeto).
- Sem pacotes npm novos (invariante 1 do CLAUDE.md: zero dependências além do Electron).
- Onda seguinte só começa com a anterior 100% verde (Onda 3 só depois de 1+2 validadas).
- Localizar sempre pela âncora (nome de função, comentário vizinho), nunca por número de linha cru: os números citados aqui valem pro estado do fonte em 05/08/2026 e podem deslocar.

---

## Mapa de arquivos desta entrega

| Arquivo | Ação | Papel |
|---|---|---|
| `lib/engine/verification-checkpoint.js` | **Criar** | Módulo novo, único: `checkpointPath`, `appendCheckpointEntry` (Onda 1), `readCheckpoint`, `summarizeCheckpoint` (Onda 2), `resumeBlock` (Onda 3) |
| `lib/engine/session.js` | Modificar | Interceptação do marcador `FAROL_CHECKPOINT:` no branch `tool_use` de `handleEvent` |
| `lib/engine/review.js` | Modificar | `{{CHECKPOINT_PATH}}` em `headlessPromptFor`; `result.verificationCheckpoint` + reasons em `runHeadlessReview`; injeção do `resumeBlock` |
| `lib/engine/decision.js` | Modificar | `checkpointGap(result)`, wiring em `shouldAutoApprove` |
| `workspace-template/prompts/pr-review-auto.md` | Modificar | Seção nova de instrução de checkpoint |
| `ui/pure.js` | Modificar | `verificationSummaryLine(vc)`, formatador puro e testável |
| `ui/app.js` | Modificar | Chama `verificationSummaryLine` na renderização de Revisões recentes (não testado por `node --test`, é DOM; verificar manualmente no navegador) |
| `test/verification-checkpoint.test.js` | **Criar** | Todas as funções puras do módulo novo |
| `test/session-checkpoint-capture.test.js` | **Criar** | Interceptação em `session.js` |
| `test/review-prompt.test.js` | Modificar | `{{CHECKPOINT_PATH}}` chega no prompt; `resumeBlock` condicional |
| `test/decision-envelope.test.js` ou novo `test/checkpoint-gate.test.js` | **Criar** | `checkpointGap` e o gate |

---

### Task 1: `checkpointPath` e `appendCheckpointEntry` (lado da escrita)

**Files:**
- Create: `lib/engine/verification-checkpoint.js`
- Test: `test/verification-checkpoint.test.js`

**Interfaces:**
- Produz: `checkpointPath(prKey: string): string` (caminho absoluto dentro de `STATE_DIR/verification/`); `appendCheckpointEntry(filePath: string, prKey: string, prUrl: string, entry: object): void` (grava via `writeJsonAtomic`, cria o diretório se faltar).
- Consome: `STATE_DIR` de `lib/paths.js`; `ensureDir`, `readJson`, `writeJsonAtomic` de `lib/io.js`.

**Dificuldades antecipadas:**
- `writeJsonAtomic` (`lib/io.js:39`) **não cria o diretório pai sozinho** (chamei e conferi: só faz `writeFileSync(tmp, ...)` direto). Sem `ensureDir(path.dirname(filePath))` antes, a primeira gravação de qualquer PR lançaria `ENOENT` (pasta `state/verification/` não existe até a primeira captura). → `appendCheckpointEntry` chama `ensureDir` sempre, antes de `writeJsonAtomic`.
- `checkpointPath` usando `/`/`#` substituídos por `__` colide (ex.: `org="a__b"` `repo="c"` vs `org="a"` `repo="b__c"` geram o mesmo nome). → Usar `encodeURIComponent(prKey)`, que é injetivo (nunca perde informação).

- [ ] **Passo 1: escrever o teste que falha.** Criar `test/verification-checkpoint.test.js`:

```js
'use strict';
// Checkpoint de verificação: memória persistida e incremental do que a revisão headless
// já confirmou, pra não reprocessar do zero depois de um subagente travar em 529 ou a
// sessão ser relançada. Ver docs/superpowers/specs/2026-08-05-checkpoint-verificacao-design.md.
// Runner nativo (node --test), ZERO dependências.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-checkpoint-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { checkpointPath, appendCheckpointEntry } = require('../lib/engine/verification-checkpoint');
const { STATE_DIR } = require('../lib/paths');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

test('checkpointPath: usa encodeURIComponent, nunca colide entre keys diferentes', () => {
  const p1 = checkpointPath('a__b/c#1');
  const p2 = checkpointPath('a/b__c#1');
  assert.notEqual(p1, p2, 'owner/repo com __ não pode colidir');
  assert.ok(p1.startsWith(path.join(STATE_DIR, 'verification')), 'fica dentro de state/verification');
  assert.match(p1, /\.json$/);
});

test('appendCheckpointEntry: cria o diretório e o arquivo na primeira gravação', () => {
  const p = checkpointPath('acme/repo#42');
  assert.equal(fs.existsSync(p), false, 'ainda não existe');
  appendCheckpointEntry(p, 'acme/repo#42', 'https://github.com/acme/repo/pull/42', {
    claim: 'x.ts:10 confirma y', file: 'x.ts', line: 10, verdict: 'confirmado',
    evidence: 'linha 10 confirma', sessionId: 's1', at: '2026-08-05T10:00:00-03:00',
  });
  assert.equal(fs.existsSync(p), true);
  const saved = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(saved.prKey, 'acme/repo#42');
  assert.equal(saved.entries.length, 1);
  assert.equal(saved.entries[0].verdict, 'confirmado');
});

test('appendCheckpointEntry: é append-only, nunca sobrescreve entrada anterior', () => {
  const p = checkpointPath('acme/repo#43');
  appendCheckpointEntry(p, 'acme/repo#43', 'https://github.com/acme/repo/pull/43', {
    claim: 'a', file: 'a.ts', line: 1, verdict: 'confirmado', evidence: 'e1', sessionId: 's1', at: '2026-08-05T10:00:00-03:00',
  });
  appendCheckpointEntry(p, 'acme/repo#43', 'https://github.com/acme/repo/pull/43', {
    claim: 'a', file: 'a.ts', line: 1, verdict: 'refutado', evidence: 'e2', sessionId: 's2', at: '2026-08-05T10:05:00-03:00',
  });
  const saved = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(saved.entries.length, 2, 'as duas entradas ficam, mesmo divergindo');
  assert.equal(saved.entries[0].verdict, 'confirmado');
  assert.equal(saved.entries[1].verdict, 'refutado');
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/verification-checkpoint.test.js`. Esperado: falha com "Cannot find module '../lib/engine/verification-checkpoint'".

- [ ] **Passo 3: implementação mínima.** Criar `lib/engine/verification-checkpoint.js`:

```js
'use strict';
// Checkpoint de verificação: memória persistida e incremental do que a revisão headless
// já confirmou sobre afirmações factuais (arquivo:linha) checadas contra o código real.
// Append-only de propósito: uma nova passada que discorda da anterior gera uma entrada
// NOVA, nunca sobrescreve, e a divergência vira ponto de atenção (ver decision.js
// checkpointGap). A sessão NUNCA escreve este arquivo diretamente (proibido pela regra 2
// de workspace-template/prompts/pr-review-auto.md); só o engine grava, ao interceptar o
// marcador FAROL_CHECKPOINT: no tool_use da sessão (ver lib/engine/session.js).
// Ver docs/superpowers/specs/2026-08-05-checkpoint-verificacao-design.md.
const path = require('path');
const { STATE_DIR } = require('../paths');
const { ensureDir, readJson, writeJsonAtomic } = require('../io');

function checkpointPath(prKey) {
  return path.join(STATE_DIR, 'verification', `${encodeURIComponent(prKey)}.json`);
}

function appendCheckpointEntry(filePath, prKey, prUrl, entry) {
  ensureDir(path.dirname(filePath));
  const existing = readJson(filePath, null) || { prKey, prUrl, entries: [] };
  if (!Array.isArray(existing.entries)) existing.entries = [];
  existing.entries.push(entry);
  writeJsonAtomic(filePath, existing);
}

module.exports = { checkpointPath, appendCheckpointEntry };
```

- [ ] **Passo 4: rodar e ver passar.** `node --test test/verification-checkpoint.test.js`. Esperado: os 3 testes verdes.

- [ ] **Passo 5: gate completo.** `npm run check && npm test`. Esperado: tudo verde (baseline + 3).

- [ ] **Passo 6: commit.**

```bash
git add lib/engine/verification-checkpoint.js test/verification-checkpoint.test.js
git commit -m "feat: checkpoint de verificacao, lado da escrita (checkpointPath, appendCheckpointEntry)"
```

---

### Task 2: interceptação do marcador em `session.js`

**Files:**
- Modify: `lib/engine/session.js` (dentro de `handleEvent`, branch `tool_use`, âncora: `} else if (block.type === 'tool_use') {`)
- Test: `test/session-checkpoint-capture.test.js` (novo)

**Interfaces:**
- Consome: `appendCheckpointEntry`, `checkpointPath` (Task 1); `engine.activeReviews` (Map já existente, `id -> {pr: {key, ...}}`, gravado por `runHeadlessReview` antes de `runClaudeStream`).
- Produz: nenhuma função pública nova; é um efeito colateral adicional dentro de `handleEvent` (função interna de `runClaudeStream`, não exportada, só testável via o comportamento observável do stream).

**Dificuldades antecipadas:**
- `handleEvent` é uma função interna de `runClaudeStream`, sem acesso direto de fora. → O teste roda `runClaudeStream` de ponta a ponta com `spawn` mockado (mesmo padrão de `test/session-stream.test.js`), alimenta o stdout com um evento `assistant`/`tool_use` de `Bash` cujo `description` carrega o marcador, e verifica o EFEITO (arquivo de checkpoint gravado), não a função interna.
- O `id` da sessão (usado por `engine.activeReviews.get(id)`) é passado em `opts.id` pro `runClaudeStream`; o engine falso do teste precisa povoar `activeReviews` com esse MESMO id antes de rodar, senão a captura não sabe qual PR é.
- JSON inválido depois do marcador não pode derrubar a sessão. → `try/catch` mudo ao redor do `JSON.parse`; se falhar, ignora e segue o fluxo normal (o `onEvent` de exibição já rodou antes, intocado).
- Cross-platform: nada aqui depende de SO (é só parsing de string e fs, ambos já usados pelo resto do arquivo).

- [ ] **Passo 1: escrever o teste que falha.** Criar `test/session-checkpoint-capture.test.js`:

```js
'use strict';
// A sessão headless não pode escrever em state/ (regra 2 de pr-review-auto.md). Em vez
// disso, ela sinaliza um veredito de verificação via um marcador estruturado no campo
// `description` de uma chamada Bash que já rodaria de qualquer forma; o ENGINE intercepta
// esse tool_use (mesmo ponto que já alimenta o feed de atividade) e é ELE quem grava o
// checkpoint. Ver docs/superpowers/specs/2026-08-05-checkpoint-verificacao-design.md, Onda 1.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-session-checkpoint-' + process.pid);
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

const { runClaudeStream, parseEnvelope } = require('../lib/engine/session');
const { checkpointPath } = require('../lib/engine/verification-checkpoint');

after(() => {
  childProcess.spawn = realSpawn;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function filhoStream() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { write() { }, end() { } });
  child.pid = 4242;
  return child;
}

function engineFalso(id, prKey) {
  const activeReviews = new Map();
  activeReviews.set(id, { id, pr: { key: prKey } });
  return {
    config: {},
    ghEnv: () => ({ PATH: process.env.PATH }),
    running: new Map(),
    activeReviews,
    killTree() { },
    recordUsage() { },
    resolveClaudeAuth: () => ({ kind: 'dir', id: '' }),
    toolSummary: () => '',
    parseEnvelope(raw) { return parseEnvelope(this, raw); },
  };
}

test('marcador FAROL_CHECKPOINT no description de um Bash grava uma entrada no checkpoint da sessão', async () => {
  const id = 'a1';
  const prKey = 'acme/repo#99';
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engineFalso(id, prKey), 'prompt', { id });
  spawnImpl = null;

  const marcador = 'FAROL_CHECKPOINT: ' + JSON.stringify({
    claim: 'gateway.ts:10 confirma x', file: 'gateway.ts', line: 10,
    verdict: 'confirmado', evidence: 'linha 10 confirma',
  });
  const linhaToolUse = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'true', description: marcador } }] },
  }) + '\n';
  const linhaResult = JSON.stringify({ type: 'result', result: 'ok', session_id: 's1' }) + '\n';

  child.stdout.write(linhaToolUse);
  child.stdout.once('end', () => child.emit('close', 0));
  child.stdout.write(linhaResult);
  child.stdout.end();

  await p;

  const arquivo = checkpointPath(prKey);
  assert.equal(fs.existsSync(arquivo), true, 'o engine gravou o checkpoint, a sessão não precisou tocar em state/');
  const saved = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  assert.equal(saved.entries.length, 1);
  assert.equal(saved.entries[0].verdict, 'confirmado');
  assert.equal(saved.entries[0].file, 'gateway.ts');
});

test('Bash SEM o marcador no description não grava nada (comportamento de hoje, intocado)', async () => {
  const id = 'a2';
  const prKey = 'acme/repo#100';
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engineFalso(id, prKey), 'prompt', { id });
  spawnImpl = null;

  const linhaToolUse = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls', description: 'listar arquivos' } }] },
  }) + '\n';
  const linhaResult = JSON.stringify({ type: 'result', result: 'ok', session_id: 's1' }) + '\n';

  child.stdout.write(linhaToolUse);
  child.stdout.once('end', () => child.emit('close', 0));
  child.stdout.write(linhaResult);
  child.stdout.end();

  await p;

  assert.equal(fs.existsSync(checkpointPath(prKey)), false, 'sem marcador, nada é gravado');
});

test('marcador com JSON inválido depois dele é ignorado, não derruba a sessão', async () => {
  const id = 'a3';
  const prKey = 'acme/repo#101';
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engineFalso(id, prKey), 'prompt', { id });
  spawnImpl = null;

  const linhaToolUse = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'true', description: 'FAROL_CHECKPOINT: {isso nao e json valido' } }] },
  }) + '\n';
  const linhaResult = JSON.stringify({ type: 'result', result: 'ok', session_id: 's1' }) + '\n';

  child.stdout.write(linhaToolUse);
  child.stdout.once('end', () => child.emit('close', 0));
  child.stdout.write(linhaResult);
  child.stdout.end();

  const res = await p;
  assert.equal(res.text, 'ok', 'a sessão termina normalmente, o marcador ruim não propaga erro');
  assert.equal(fs.existsSync(checkpointPath(prKey)), false, 'nada foi gravado (JSON inválido)');
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/session-checkpoint-capture.test.js`. Esperado: o 1º teste falha (arquivo não existe, nada intercepta ainda); os outros dois já passam por vacuidade (nada grava mesmo sem código novo), mas ficam aqui como trava de regressão.

- [ ] **Passo 3: implementação mínima.** Em `lib/engine/session.js`, no topo do arquivo, importar o módulo novo:

```js
const { checkpointPath, appendCheckpointEntry } = require('./verification-checkpoint');
const CHECKPOINT_MARKER = /^FAROL_CHECKPOINT:\s*(.+)$/s;
```

No branch `tool_use` de `handleEvent` (âncora: `} else if (block.type === 'tool_use') {`), acrescentar a captura LOGO ABAIXO da linha `onEvent({ kind: 'tool', ... })` que já existe, sem removê-la:

```js
} else if (block.type === 'tool_use') {
  const sum = engine.toolSummary(block.name, block.input);
  onEvent({ kind: 'tool', text: sum ? `${block.name} · ${sum}` : block.name });
  // captura passiva do checkpoint de verificação: a sessão NUNCA escreve em state/
  // (regra 2 do prompt), ela só sinaliza via este campo estruturado; quem grava é
  // o engine, aqui. Ver docs/superpowers/specs/2026-08-05-checkpoint-verificacao-design.md.
  if (block.name === 'Bash') {
    const desc = String((block.input && block.input.description) || '');
    const m = desc.match(CHECKPOINT_MARKER);
    if (m) {
      try {
        const parsed = JSON.parse(m[1]);
        const review = engine.activeReviews && engine.activeReviews.get(opts.id);
        const prKey = review && review.pr && review.pr.key;
        const prUrl = review && review.pr && review.pr.url;
        if (prKey && parsed && typeof parsed === 'object') {
          appendCheckpointEntry(checkpointPath(prKey), prKey, prUrl || '', {
            claim: String(parsed.claim || ''),
            file: String(parsed.file || ''),
            line: Number(parsed.line) || 0,
            verdict: String(parsed.verdict || ''),
            evidence: String(parsed.evidence || ''),
            sessionId: opts.id,
            at: new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', 'T'),
          });
        }
      } catch { /* marcador mal formado: ignora, não derruba a sessão */ }
    }
  }
}
```

Nota: `opts` já está no escopo de `handleEvent` (é parâmetro de `runClaudeStream`, closure). O carimbo de hora usa `toLocaleString('sv-SE', {timeZone: 'America/Sao_Paulo'})`, que devolve `AAAA-MM-DD HH:MM:SS` (formato sueco é o único locale builtin do Node que já sai em ordem ISO), convertido pra `T` no meio (regra do projeto: horário de Brasília, nunca UTC cru).

- [ ] **Passo 4: rodar e ver passar.** `node --test test/session-checkpoint-capture.test.js`. Esperado: os 3 testes verdes.

- [ ] **Passo 5: gate completo.** `npm run check && npm test`.

- [ ] **Passo 6: commit.**

```bash
git add lib/engine/session.js test/session-checkpoint-capture.test.js
git commit -m "feat: engine intercepta marcador FAROL_CHECKPOINT e grava o checkpoint, sessao nunca escreve state/"
```

---

### Task 3: `{{CHECKPOINT_PATH}}` no prompt (`headlessPromptFor`)

**Files:**
- Modify: `lib/engine/review.js` (âncora: `function headlessPromptFor(engine, url, author, lotes, metrics) {`)
- Test: `test/review-prompt.test.js` (acrescentar ao arquivo existente)

**Interfaces:**
- Consome: `prFromUrl` (já existe, `review.js:17`), `checkpointPath` (Task 1).
- Produz: nenhuma assinatura nova (o placeholder entra no CORPO de `headlessPromptFor`, que continua `(engine, url, author, lotes, metrics)`, nenhuma fachada muda de aridade).

**Dificuldades antecipadas:**
- `prFromUrl` pode devolver `null` se a URL não bater no regex (não deveria acontecer em uso real, mas é defensivo). → Se `null`, substituir por um placeholder `(indisponível)` em vez de lançar.

- [ ] **Passo 1: escrever o teste que falha.** Acrescentar ao final de `test/review-prompt.test.js`:

```js
const { checkpointPath } = require('../lib/engine/verification-checkpoint');

test('headlessPromptFor: {{CHECKPOINT_PATH}} é substituído pelo caminho real do checkpoint', () => {
  const prompt = new Engine().headlessPromptFor(URL_PR, 'alice');
  assert.doesNotMatch(prompt, /\{\{CHECKPOINT_PATH\}\}/, 'nunca sobra o placeholder cru');
  const esperado = checkpointPath('acme/repo#688'); // mesma key que URL_PR já usa neste arquivo
  assert.ok(prompt.includes(esperado), 'o caminho exato do checkpoint deste PR aparece no prompt');
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/review-prompt.test.js`. Esperado: falha (placeholder ainda não existe no template nem é substituído).

- [ ] **Passo 3: implementação mínima.** Em `workspace-template/prompts/pr-review-auto.md`, na linha 4 (`Revise o PR: {{URL}}`), sem remover nada, é só o template ganhar o placeholder em algum lugar (a Task 4 cuida do texto explicativo; aqui só garante que o token existe pra Task 3 testar):

```
Revise o PR: {{URL}}
Checkpoint de verificação deste PR: {{CHECKPOINT_PATH}}
```

Em `lib/engine/review.js`, dentro de `headlessPromptFor`, junto do `.replaceAll('{{URL}}', url)` que já existe:

```js
function headlessPromptFor(engine, url, author, lotes, metrics) {
  const candidates = [
    path.join(WORKSPACE, 'prompts', 'pr-review-auto.md'),
    path.join(TEMPLATE_DIR, 'prompts', 'pr-review-auto.md')
  ];
  const pr = prFromUrl(engine, url);
  const checkpointFile = pr ? checkpointPath(pr.key) : '(indisponível)';
  for (const f of candidates) {
    try {
      return fs.readFileSync(f, 'utf8').replaceAll('{{URL}}', url)
        .replaceAll('{{CHECKPOINT_PATH}}', checkpointFile)
        + engine.personProfileBlock(author) + engine.reviewFormatBlock() + thirdPartyReviewBlock()
        + (lotes ? fanoutMod.fanOutBlock(lotes, metrics) : '');
    } catch { }
  }
  throw new Error('template prompts/pr-review-auto.md não encontrado');
}
```

E no topo do arquivo, acrescentar o import (junto dos outros requires de `review.js`):

```js
const { checkpointPath } = require('./verification-checkpoint');
```

- [ ] **Passo 4: rodar e ver passar.** `node --test test/review-prompt.test.js`. Esperado: todos os testes do arquivo verdes (os 3 antigos + o novo).

- [ ] **Passo 5: gate completo.** `npm run check && npm test`.

- [ ] **Passo 6: commit.**

```bash
git add lib/engine/review.js workspace-template/prompts/pr-review-auto.md test/review-prompt.test.js
git commit -m "feat: headlessPromptFor substitui CHECKPOINT_PATH, mesmo padrao do URL"
```

---

### Task 4: instruções de checkpoint no prompt (`pr-review-auto.md`)

**Files:**
- Modify: `workspace-template/prompts/pr-review-auto.md`
- Test: nenhum novo (é prosa pro modelo seguir; a Task 3 já travou que o placeholder chega). Verificação manual: rodar uma revisão real e conferir no feed que o marcador aparece quando a sessão verifica uma afirmação.

**Interfaces:** nenhuma (só texto).

**Dificuldades antecipadas:**
- A instrução tem que deixar claríssimo que LER o checkpoint é permitido (via `Read`) mas ESCREVER nele é proibido (a sessão nunca usa `Write`/`Edit` em `state/`); o jeito de "escrever" é o marcador no `description` do Bash. Confusão aqui reintroduziria a violação da regra 2. → Repetir explicitamente "nunca escreva em state/" dentro da própria instrução nova, não só confiar na regra 2 geral.

- [ ] **Passo 1: acrescentar a seção nova**, logo após a seção "## Falhas" (final do arquivo) de `workspace-template/prompts/pr-review-auto.md`:

```markdown

## Checkpoint de verificação (memória entre passadas)

Existe um checkpoint desta revisão em `{{CHECKPOINT_PATH}}`. Antes de checar qualquer
afirmação que cite arquivo/linha específico (ex.: "gateway.ts:53 faz X"):

1. **Leia** esse arquivo (ferramenta `Read`; se não existir ainda, é a primeira verificação
   desta revisão, siga normalmente). Se já existir uma entrada com veredito `confirmado` ou
   `refutado` pra essa MESMA afirmação, reaproveite a evidência já registrada em vez de
   reler o código.
2. Ao estabelecer um veredito NOVO (a afirmação não estava no checkpoint, ou você decidiu
   reconfirmar), rode o comando Bash de verificação (ou, se já tiver lido via `Read` e não
   precisar de mais nenhum comando, rode `true`) com o campo `description` EXATAMENTE neste
   formato, sem nada antes nem depois:

```
FAROL_CHECKPOINT: {"claim":"<a afirmação em 1 linha>","file":"<arquivo>","line":<número>,"verdict":"confirmado|refutado|parcial","evidence":"<a evidência em 1 linha>"}
```

**NUNCA escreva, crie nem edite o arquivo de checkpoint diretamente** (nem com `Write` nem
com `Edit`): é o app que grava, a partir do `description` acima. Isso vale mesmo que o
checkpoint ainda não exista, você não precisa criá-lo, o app cria sozinho na primeira
captura.
```

- [ ] **Passo 2: verificação de sintaxe.** `npm run check` (valida `node --check` nos arquivos `.js`; este passo não toca `.js`, mas roda o gate completo por hábito e porque a Task 3 já mexeu em `review.js` no mesmo commit anterior).

- [ ] **Passo 3: commit.**

```bash
git add workspace-template/prompts/pr-review-auto.md
git commit -m "docs: instrucoes de checkpoint de verificacao no prompt da revisao headless"
```

**Nota de validação manual (fazer antes de considerar a Onda 1 fechada):** ligar uma instância isolada (`FAROL_HOME=/tmp/farol-teste node server.js`), disparar uma revisão real de um PR que faça verificação de afirmações (ex.: um PR de docs/spec), e conferir no feed ao vivo que aparece pelo menos um `Bash · FAROL_CHECKPOINT: ...` e que o arquivo `state/verification/<key>.json` é criado com a entrada.

---

### Task 5: `readCheckpoint` e `summarizeCheckpoint` (lado da leitura)

**Files:**
- Modify: `lib/engine/verification-checkpoint.js`
- Test: `test/verification-checkpoint.test.js` (acrescentar)

**Interfaces:**
- Produz: `readCheckpoint(filePath: string): {ok: boolean, entries?: array, reason?: string}`; `summarizeCheckpoint(entries: array): {total: number, confirmedCount: number, conflicts: array}`.
- Consome: `readJson` de `lib/io.js` (já usado por `appendCheckpointEntry`).

**Dificuldades antecipadas:**
- `readJson(file, fallback, log)` (`lib/io.js:18`) já distingue "arquivo ausente" (devolve fallback, sem chamar `log`) de "JSON corrompido" (devolve fallback, MAS chama `log` se fornecido). → Passar um `log` que só seta uma flag local, sem duplicar o parsing.
- "Conflito" precisa agrupar por identidade da afirmação. Duas entradas com `file`+`line` iguais mas `claim` diferente (raro, mas possível: duas afirmações sobre a mesma linha) NÃO deveriam ser tratadas como a mesma afirmação. → Agrupar por `file+'|'+line+'|'+claim`, não só `file+line`.

- [ ] **Passo 1: escrever o teste que falha.** Acrescentar ao final de `test/verification-checkpoint.test.js`:

```js
const { readCheckpoint, summarizeCheckpoint } = require('../lib/engine/verification-checkpoint');

test('readCheckpoint: arquivo ausente devolve ok:true com entries vazio', () => {
  const p = checkpointPath('nunca/existiu#1');
  const r = readCheckpoint(p);
  assert.deepEqual(r, { ok: true, entries: [] });
});

test('readCheckpoint: JSON malformado devolve ok:false com motivo', () => {
  const p = checkpointPath('malformado/teste#1');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '{ isso nao e json valido');
  const r = readCheckpoint(p);
  assert.equal(r.ok, false);
  assert.ok(r.reason, 'tem motivo');
});

test('readCheckpoint: JSON válido sem campo entries devolve ok:false', () => {
  const p = checkpointPath('semcampo/teste#1');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ prKey: 'x' }));
  const r = readCheckpoint(p);
  assert.equal(r.ok, false);
});

test('readCheckpoint: JSON válido e completo devolve as entradas intactas', () => {
  const p = checkpointPath('completo/teste#1');
  appendCheckpointEntry(p, 'completo/teste#1', 'url', { claim: 'c', file: 'f.ts', line: 1, verdict: 'confirmado', evidence: 'e', sessionId: 's', at: 'x' });
  const r = readCheckpoint(p);
  assert.equal(r.ok, true);
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].claim, 'c');
});

test('summarizeCheckpoint: sem entradas', () => {
  assert.deepEqual(summarizeCheckpoint([]), { total: 0, confirmedCount: 0, conflicts: [] });
});

test('summarizeCheckpoint: entradas concordantes não geram conflito', () => {
  const entries = [
    { claim: 'a', file: 'x.ts', line: 1, verdict: 'confirmado' },
    { claim: 'b', file: 'y.ts', line: 2, verdict: 'refutado' },
  ];
  const s = summarizeCheckpoint(entries);
  assert.equal(s.total, 2);
  assert.equal(s.confirmedCount, 1);
  assert.deepEqual(s.conflicts, []);
});

test('summarizeCheckpoint: duas entradas da MESMA afirmação com veredito diferente geram um conflito', () => {
  const entries = [
    { claim: 'a', file: 'x.ts', line: 1, verdict: 'confirmado', at: '2026-08-05T10:00:00-03:00' },
    { claim: 'a', file: 'x.ts', line: 1, verdict: 'refutado', at: '2026-08-05T10:10:00-03:00' },
  ];
  const s = summarizeCheckpoint(entries);
  assert.equal(s.conflicts.length, 1);
  assert.equal(s.conflicts[0].entries.length, 2);
});

test('summarizeCheckpoint: mesma linha, claim DIFERENTE, não é conflito (afirmações distintas)', () => {
  const entries = [
    { claim: 'a', file: 'x.ts', line: 1, verdict: 'confirmado' },
    { claim: 'b (outra afirmação na mesma linha)', file: 'x.ts', line: 1, verdict: 'refutado' },
  ];
  const s = summarizeCheckpoint(entries);
  assert.deepEqual(s.conflicts, [], 'claim diferente não agrupa junto');
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/verification-checkpoint.test.js`. Esperado: falha (funções não existem ainda).

- [ ] **Passo 3: implementação mínima.** Acrescentar em `lib/engine/verification-checkpoint.js`:

```js
function readCheckpoint(filePath) {
  let corrupted = false;
  const data = readJson(filePath, null, () => { corrupted = true; });
  if (corrupted) return { ok: false, reason: 'checkpoint corrompido' };
  if (!data) return { ok: true, entries: [] };
  if (!Array.isArray(data.entries)) return { ok: false, reason: 'formato inválido: campo entries ausente' };
  return { ok: true, entries: data.entries };
}

function summarizeCheckpoint(entries) {
  entries = entries || [];
  const groups = new Map();
  for (const e of entries) {
    const key = `${e.file}|${e.line}|${e.claim}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const conflicts = [];
  for (const grupo of groups.values()) {
    const veredictos = new Set(grupo.map(e => e.verdict));
    if (veredictos.size > 1) conflicts.push({ entries: grupo });
  }
  return {
    total: entries.length,
    confirmedCount: entries.filter(e => e.verdict === 'confirmado').length,
    conflicts,
  };
}

module.exports = { checkpointPath, appendCheckpointEntry, readCheckpoint, summarizeCheckpoint };
```

- [ ] **Passo 4: rodar e ver passar.** `node --test test/verification-checkpoint.test.js`. Esperado: todos verdes.

- [ ] **Passo 5: gate completo.** `npm run check && npm test`.

- [ ] **Passo 6: commit.**

```bash
git add lib/engine/verification-checkpoint.js test/verification-checkpoint.test.js
git commit -m "feat: readCheckpoint e summarizeCheckpoint, lado da leitura do checkpoint"
```

---

### Task 6: `checkpointGap` e o gate em `shouldAutoApprove`

**Files:**
- Modify: `lib/engine/decision.js` (âncora: `function coverageGap(result) {`, e `function shouldAutoApprove(engine, pr, result) {`)
- Test: Create `test/checkpoint-gate.test.js`

**Interfaces:**
- Produz: `checkpointGap(result: object): array<string>` (lista de problemas; vazia = sem problema).
- Consome: `result.verificationCheckpoint` (shape `{total, confirmedCount, conflicts, malformed?}`, montado pela Task 7, mas ESTA task já pode testar `checkpointGap` isoladamente passando o campo à mão, sem esperar a Task 7).

**Dificuldades antecipadas:**
- `coverageGap` (o padrão que estamos seguindo) só olha `result.coverage`, nunca dispara IO. `checkpointGap` tem que seguir a MESMA regra: só olha `result.verificationCheckpoint`, nunca chama `readCheckpoint` nem toca disco. Se alguém "otimizar" e fizer `checkpointGap` ler o arquivo direto, quebra a paridade de pureza dos gates. → O teste desta task passa `result.verificationCheckpoint` MONTADO À MÃO (sem nenhum arquivo real no disco), provando que a função nunca precisa de IO pra funcionar.

- [ ] **Passo 1: escrever o teste que falha.** Criar `test/checkpoint-gate.test.js`:

```js
'use strict';
// checkpointGap segue EXATAMENTE o padrão de coverageGap (lib/engine/decision.js): função
// pura que só olha o campo já computado em `result`, nunca dispara IO. A leitura de disco
// acontece uma vez só, em runHeadlessReview (Task 7), antes do gate rodar.
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-checkpoint-gate-' + process.pid);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Engine } = require('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

const PR = { key: 'o/r#1', repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1', requested: true };

function approvableResult(extra) {
  return {
    verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
    payloads: { approve: { event: 'APPROVE', body: 'ok' } },
    ...extra
  };
}

function engineWithPolicy(policy) {
  const e = new Engine();
  e.config.autoApproveAll = true;
  e.config.accounts = [];
  e.approvePolicyFor = () => policy;
  e.rejectPolicyFor = () => 'request_changes';
  e.accountForPr = () => 'alguem';
  return e;
}

test('checkpointGap: sem verificationCheckpoint no result, não bloqueia', () => {
  const e = engineWithPolicy('approve');
  assert.equal(e.shouldAutoApprove(PR, approvableResult()).ok, true);
});

test('checkpointGap: verificationCheckpoint limpo (sem conflito), não bloqueia', () => {
  const e = engineWithPolicy('approve');
  const r = approvableResult({ verificationCheckpoint: { total: 2, confirmedCount: 2, conflicts: [] } });
  assert.equal(e.shouldAutoApprove(PR, r).ok, true);
});

test('checkpointGap: verificationCheckpoint com conflito bloqueia o auto-approve', () => {
  const e = engineWithPolicy('approve');
  const r = approvableResult({
    verificationCheckpoint: {
      total: 2, confirmedCount: 1,
      conflicts: [{ entries: [{ claim: 'a', verdict: 'confirmado' }, { claim: 'a', verdict: 'refutado' }] }],
    }
  });
  assert.deepEqual(e.shouldAutoApprove(PR, r), { ok: false, motivo: 'checkpoint' });
});

test('checkpointGap: verificationCheckpoint malformado bloqueia', () => {
  const e = engineWithPolicy('approve');
  const r = approvableResult({ verificationCheckpoint: { malformed: true } });
  assert.deepEqual(e.shouldAutoApprove(PR, r), { ok: false, motivo: 'checkpoint' });
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/checkpoint-gate.test.js`. Esperado: os testes de bloqueio falham (`shouldAutoApprove` devolve `ok:true` porque `checkpointGap` ainda não existe).

- [ ] **Passo 3: implementação mínima.** Em `lib/engine/decision.js`, logo após `coverageGap` (âncora: fecha em `}` antes de `function attentionPoints`):

```js
// mesmo padrão de coverageGap: função PURA, só olha result.verificationCheckpoint
// (montado por runHeadlessReview ANTES de chamar o gate, ver review.js), nunca disco.
function checkpointGap(result) {
  const vc = result && result.verificationCheckpoint;
  if (!vc) return [];
  if (vc.malformed) return ['checkpoint de verificação malformado'];
  const conflicts = Array.isArray(vc.conflicts) ? vc.conflicts : [];
  return conflicts.map((c, i) => `divergência de veredito na afirmação ${i + 1} entre passadas de verificação`);
}
```

E dentro de `shouldAutoApprove`, logo após a linha do `coverageGap` (âncora: `if (coverageGap(result).length) return { ok: false, motivo: 'cobertura' };`):

```js
  if (coverageGap(result).length) return { ok: false, motivo: 'cobertura' };
  // checkpoint malformado ou com divergência entre passadas: mesma régua da cobertura,
  // "sem prova completa não posta sozinho" (ver docs/superpowers/specs/2026-08-05-checkpoint-verificacao-design.md)
  if (checkpointGap(result).length) return { ok: false, motivo: 'checkpoint' };
```

E no `module.exports` de `decision.js` (linha 378-383), trocar:

```js
module.exports = {
  recordDecision, resolveIntoHistory, reviewActions, saveDecisions,
  myReviewsWithTime, myReviewStates, reconcilePending,
  shouldAutoApprove, shouldAutoReject, rejectBodyWithMark, attentionPoints, contestations, coverageGap,
  postReview, writeMemory, decide,
};
```

por (só acrescenta `checkpointGap` na mesma linha de `coverageGap`):

```js
module.exports = {
  recordDecision, resolveIntoHistory, reviewActions, saveDecisions,
  myReviewsWithTime, myReviewStates, reconcilePending,
  shouldAutoApprove, shouldAutoReject, rejectBodyWithMark, attentionPoints, contestations, coverageGap, checkpointGap,
  postReview, writeMemory, decide,
};
```

- [ ] **Passo 4: rodar e ver passar.** `node --test test/checkpoint-gate.test.js`. Esperado: todos verdes.

- [ ] **Passo 5: gate completo.** `npm run check && npm test`.

- [ ] **Passo 6: commit.**

```bash
git add lib/engine/decision.js test/checkpoint-gate.test.js
git commit -m "feat: checkpointGap trava auto-approve com checkpoint malformado ou divergente"
```

---

### Task 7: `runHeadlessReview` monta `result.verificationCheckpoint` e o texto de `reasons`

**Files:**
- Modify: `lib/engine/review.js` (âncora: dentro de `runHeadlessReview`, logo após `const result = engine.parseHeadlessResult(res.text);`)
- Test: `test/checkpoint-gate.test.js` (acrescentar, cobrindo o caminho de ponta a ponta) ou `test/review-prompt.test.js`; usar um arquivo novo `test/checkpoint-review-wiring.test.js` pra não misturar preocupações.

**Interfaces:**
- Consome: `readCheckpoint`, `summarizeCheckpoint`, `checkpointPath` (Tasks 1 e 5).
- Produz: `result.verificationCheckpoint` populado antes de `engine.shouldAutoApprove` ser chamado; um bloco novo em `result.reasons` quando há gap.

**Dificuldades antecipadas:**
- `runHeadlessReview` não é fácil de testar de ponta a ponta (depende de `runClaudeStream`, IO, etc., como o próprio `check()` documentado em `docs/superpowers/plans/gaps-2026-08/onda-2-resiliencia-check.md`). → Em vez de testar `runHeadlessReview` inteiro, extrair a montagem de `result.verificationCheckpoint` como um passo isolado dentro da função (não uma função nova exportada, só uma leitura + atribuição), e testar o EFEITO no gate via `checkpointGap`/`shouldAutoApprove` (já feito na Task 6) mais um teste de integração leve que só confirma que, com um checkpoint real gravado em disco, o campo populado bate com `summarizeCheckpoint` do que está lá.

- [ ] **Passo 1: escrever o teste que falha.** Criar `test/checkpoint-review-wiring.test.js`:

```js
'use strict';
// Confirma que a MONTAGEM de result.verificationCheckpoint segue exatamente
// summarizeCheckpoint(readCheckpoint(checkpointPath(pr.key)).entries), do jeito que
// runHeadlessReview monta antes de chamar shouldAutoApprove.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-checkpoint-wiring-' + process.pid);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { checkpointPath, appendCheckpointEntry, readCheckpoint, summarizeCheckpoint } = require('../lib/engine/verification-checkpoint');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

test('monta verificationCheckpoint a partir do arquivo real, com conflito detectado', () => {
  const prKey = 'wiring/teste#1';
  const p = checkpointPath(prKey);
  appendCheckpointEntry(p, prKey, 'url', { claim: 'a', file: 'x.ts', line: 1, verdict: 'confirmado' });
  appendCheckpointEntry(p, prKey, 'url', { claim: 'a', file: 'x.ts', line: 1, verdict: 'refutado' });

  // isto é exatamente a linha que entra em runHeadlessReview
  const lido = readCheckpoint(checkpointPath(prKey));
  const vc = lido.ok ? summarizeCheckpoint(lido.entries) : { malformed: true };

  assert.equal(vc.total, 2);
  assert.equal(vc.conflicts.length, 1);
});
```

- [ ] **Passo 2: rodar e ver falhar.** Não deveria falhar (as funções já existem das tasks anteriores); serve como trava de integração, então rode e confirme que passa de primeira. Se falhar, alguma das Tasks 1/5 tem regressão, pare e investigue antes de prosseguir.

- [ ] **Passo 3: implementação em `review.js`.** Dentro de `runHeadlessReview`, logo após a linha `result.sessionId = res.sessionId || null;` e ANTES de `const autoDec = engine.shouldAutoApprove(pr, result);`:

```js
    // checkpoint de verificação: lido UMA vez aqui (é onde a sessão já faz IO), nunca
    // dentro de decision.js (que continua puro). Ver docs/superpowers/specs/
    // 2026-08-05-checkpoint-verificacao-design.md.
    const cpLido = readCheckpoint(checkpointPath(pr.key));
    result.verificationCheckpoint = cpLido.ok
      ? summarizeCheckpoint(cpLido.entries)
      : { malformed: true, reason: cpLido.reason };
```

E, no bloco que já monta `reasons` a partir de `coverageGap` (âncora: `const semCobertura = engine.coverageGap(result);`), acrescentar logo depois, seguindo o MESMO padrão de `unshift`:

```js
    const semCobertura = engine.coverageGap(result);
    if (semCobertura.length) {
      const amostra = semCobertura.slice(0, 3).join(', ');
      result.reasons = [`a revisão não cobriu o diff inteiro (${semCobertura.length} pendência(s): ${amostra}${semCobertura.length > 3 ? ', ...' : ''}), então não posto sozinho`,
        ...(result.reasons || [])];
    }
    // checkpoint malformado ou com divergência entre passadas: mesma régua da cobertura
    const gapCheckpoint = engine.checkpointGap(result);
    if (gapCheckpoint.length) {
      result.reasons = [`verificação de afirmações com problema (${gapCheckpoint.join('; ')}), então não posto sozinho`,
        ...(result.reasons || [])];
    }
```

No topo de `review.js`, acrescentar ao import já existente do módulo novo:

```js
const { checkpointPath, readCheckpoint, summarizeCheckpoint, appendCheckpointEntry } = require('./verification-checkpoint');
```

(substitui o import mais restrito da Task 3, que só trazia `checkpointPath`).

Em `server.js:884`, logo abaixo da fachada existente `coverageGap(result) { return decisionMod.coverageGap(result); }`, acrescentar a fachada nova, no mesmo estilo:

```js
  coverageGap(result) { return decisionMod.coverageGap(result); }
  checkpointGap(result) { return decisionMod.checkpointGap(result); }
```

- [ ] **Passo 4: gate completo.** `npm run check && npm test`. Esperado: tudo verde, incluindo os testes da Task 6 (que já exercitam `shouldAutoApprove` com `verificationCheckpoint` populado à mão) e o novo teste de wiring.

- [ ] **Passo 5: commit.**

```bash
git add lib/engine/review.js server.js test/checkpoint-review-wiring.test.js
git commit -m "feat: runHeadlessReview monta verificationCheckpoint e reporta divergencia em reasons"
```

---

### Task 8: renderização na UI (Revisões recentes)

**Files:**
- Modify: `lib/engine/decision.js` (âncora: `function recordDecision(engine, pr, result, extra) {`, dentro do objeto `item`)
- Modify: `ui/pure.js` (âncora: `function resolvedRow(r, ctx) {`, já existe, já é testada)
- Test: `test/ui-pure.test.js` (arquivo já existe, ver achado abaixo; acrescentar casos)

**Achado da autorrevisão que corrigiu esta task:** `resolvedRow(r, ctx)` já existe em
`ui/pure.js:389` e é a função PURA e já testada que desenha cada linha de "Revisões
recentes" (confirmado: `renderResolved` em `ui/app.js:1770-1786` só resolve o que precisa
de estado global, tipo/etiqueta e chat, e delega a linha inteira pra `resolvedRow`). Ela já
lê `r.attention || r.reasons` num bloco `<details>` de "pontos de atenção" (linhas
398-402/415), que é EXATAMENTE onde o texto de conflito de checkpoint (Task 7, prependido
em `result.reasons`) já apareceria de graça, **SEM precisar de UI nova nenhuma pro caso de
problema**. O que falta é só a linha de RESUMO neutro (quantas confirmadas de quantas
totais), que não existe hoje pra `coverage` nem pra nada parecido. E tem um furo real:
`recordDecision` (`lib/engine/decision.js`, o `item` que vira `r` aqui) **não copia**
`result.verificationCheckpoint` pro registro persistido, `r.verificationCheckpoint` seria
sempre `undefined` sem essa mudança.

**Interfaces:**
- Produz: `recordDecision` passa a incluir `verificationCheckpoint: result.verificationCheckpoint || null` no `item`; `resolvedRow` ganha um trecho novo que lê `r.verificationCheckpoint` e desenha a linha de resumo quando `total > 0`.

**Dificuldades antecipadas:**
- `ui/app.js` não tem infraestrutura de teste (só `ui/pure.js` é testado). → Toda a lógica de decisão (o QUÊ mostrar) fica dentro de `resolvedRow`, que já é 100% testável; nenhuma linha nova entra em `ui/app.js` nesta task (a chamada a `resolvedRow` em `renderResolved` já existe e não muda).

- [ ] **Passo 1: escrever o teste que falha.** Confirmado (`grep -rl "ui/pure" test/*.js`): o arquivo é `test/ui-pure.test.js`. Acrescentar ao final dele:

```js
test('resolvedRow: sem verificationCheckpoint, não mostra nenhuma linha de resumo', () => {
  const html = resolvedRow({ key: 'o/r#1', status: 'auto_approved', action: 'approve', reasons: [] }, {});
  assert.doesNotMatch(html, /Verificação de afirmações/);
});

test('resolvedRow: com verificationCheckpoint limpo, mostra a contagem sem selo de divergência', () => {
  const html = resolvedRow({
    key: 'o/r#1', status: 'auto_approved', action: 'approve', reasons: [],
    verificationCheckpoint: { total: 5, confirmedCount: 5, conflicts: [] },
  }, {});
  assert.match(html, /Verificação de afirmações: 5 confirmadas de 5/);
  assert.doesNotMatch(html, /divergência/);
});

test('resolvedRow: com conflito no verificationCheckpoint, mostra o selo de divergência (além do texto já ir por reasons)', () => {
  const html = resolvedRow({
    key: 'o/r#1', status: 'auto_approved', action: 'approve',
    reasons: ['verificação de afirmações com problema (divergência de veredito na afirmação 1 entre passadas de verificação), então não posto sozinho'],
    verificationCheckpoint: { total: 2, confirmedCount: 1, conflicts: [{ entries: [] }] },
  }, {});
  assert.match(html, /Verificação de afirmações: 1 confirmadas de 2/);
  assert.match(html, /⚠ 1 divergência/);
  assert.match(html, /pontos? de atenção/, 'o texto do reasons já aparece no bloco de atenção existente, sem UI nova');
});
```

(confirmar no topo de `test/ui-pure.test.js` que `resolvedRow` já está no `require` de `../ui/pure.js`; se não estiver, acrescentar ao destructuring existente).

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/ui-pure.test.js`. Esperado: os 2 últimos testes falham (a linha de resumo não existe ainda).

- [ ] **Passo 3: implementação em `lib/engine/decision.js`.** Dentro de `recordDecision`, no objeto `item` (âncora: `memory: result.memory || null,`), acrescentar logo abaixo:

```js
    memory: result.memory || null,
    verificationCheckpoint: result.verificationCheckpoint || null,
```

- [ ] **Passo 4: implementação em `ui/pure.js`.** Dentro de `resolvedRow`, logo após a linha que monta `attn`/`attnLabel` (âncora: `const vcls = VERDICT_CLASS[r.action] || '';`), acrescentar:

```js
  const vc = r.verificationCheckpoint;
  const vcLine = (vc && vc.total)
    ? `Verificação de afirmações: ${vc.confirmedCount} confirmadas de ${vc.total}`
      + (Array.isArray(vc.conflicts) && vc.conflicts.length ? ` · ⚠ ${vc.conflicts.length} divergência(s) entre passadas` : '')
    : '';
```

No template literal do retorno de `resolvedRow`, a `<div class="rr-disc">` já existe assim (não mexer nas 3 linhas de dentro, só inserir a linha de `vcLine` logo no começo do bloco):

```js
      <div class="rr-disc">
        ${vcLine ? `<div class="rr-verification">${esc(vcLine)}</div>` : ''}
        ${attn.length ? `<details class="resolved-attn"><summary>⚠ ${attn.length} ${attnLabel}</summary><ul class="dec-reasons">${attn.map(p => `<li>${esc(p)}</li>`).join('')}</ul></details>` : ''}
        ${r.reportMarkdown ? `<details class="dec-report"><summary>Ver relatório completo</summary><div class="report">${md(r.reportMarkdown)}</div></details>` : ''}
        ${pushbackControl(r, ctx.pushbacks)}
      </div>
```

- [ ] **Passo 5: rodar e ver passar.** `node --test test/ui-pure.test.js`.

- [ ] **Passo 6: gate completo.** `npm run check && npm test`.

- [ ] **Passo 7: verificação manual no navegador.** Subir instância isolada, forçar um `result.verificationCheckpoint` com conflito (stub `FAROL_HEADLESS_CMD` devolvendo um envelope de teste com o campo populado), e confirmar visualmente que a linha de resumo aparece em Revisões recentes, com o selo quando há conflito.

- [ ] **Passo 8: commit.**

```bash
git add lib/engine/decision.js ui/pure.js test/pure.test.js
git commit -m "feat: recordDecision guarda verificationCheckpoint e resolvedRow mostra o resumo"
```

---

### Task 9: `resumeBlock` (texto de retomada)

**Files:**
- Modify: `lib/engine/verification-checkpoint.js`
- Test: `test/verification-checkpoint.test.js` (acrescentar)

**Interfaces:**
- Produz: `resumeBlock(count: number, filePath: string): string`.

- [ ] **Passo 1: escrever o teste que falha.** Acrescentar a `test/verification-checkpoint.test.js`:

```js
const { resumeBlock } = require('../lib/engine/verification-checkpoint');

test('resumeBlock: menciona a contagem e o caminho, em tom de atenção', () => {
  const texto = resumeBlock(5, '/caminho/x.json');
  assert.match(texto, /5/);
  assert.match(texto, /\/caminho\/x\.json/);
  assert.match(texto, /ATENÇÃO/);
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test test/verification-checkpoint.test.js`.

- [ ] **Passo 3: implementação mínima.** Acrescentar a `lib/engine/verification-checkpoint.js`:

```js
function resumeBlock(count, filePath) {
  return `\n\nATENÇÃO: existe checkpoint parcial de verificação anterior em ${filePath}, com ${count} afirmação(ões) já registrada(s). Leia esse arquivo ANTES de verificar qualquer afirmação; não repita o que já está lá salvo se quiser reconfirmar por segurança.`;
}
```

Atualizar `module.exports` do arquivo pra incluir `resumeBlock`.

- [ ] **Passo 4: rodar e ver passar.** `node --test test/verification-checkpoint.test.js`.

- [ ] **Passo 5: gate completo.** `npm run check && npm test`.

- [ ] **Passo 6: commit.**

```bash
git add lib/engine/verification-checkpoint.js test/verification-checkpoint.test.js
git commit -m "feat: resumeBlock, texto de retomada quando ja existe checkpoint nao-vazio"
```

---

### Task 10: injeção condicional do `resumeBlock` em `runHeadlessReview`

**Files:**
- Modify: `lib/engine/review.js` (âncora: `const res = await engine.runClaudeStream(engine.headlessPromptFor(pr.url, pr.author, lotes, metrics), {`)
- Test: `test/review-prompt.test.js` (acrescentar)

**Interfaces:**
- Consome: `resumeBlock`, `readCheckpoint`, `checkpointPath` (já importados na Task 7).

**Dificuldades antecipadas:**
- O prompt final é montado DENTRO da chamada a `runClaudeStream` hoje (`engine.headlessPromptFor(...)` é passado direto como argumento posicional, sem variável intermediária). → Extrair pra uma variável `prompt` antes da chamada, só nesta linha, sem mexer em mais nada da função.

- [ ] **Passo 1: escrever o teste que falha.** Este teste não pode usar `headlessPromptFor` isolado (o `resumeBlock` é injetado em `runHeadlessReview`, uma camada acima). Testar via `verification-checkpoint.test.js` a composição isolada é insuficiente pra travar a integração real; em vez disso, o teste de integração vive em `test/checkpoint-review-wiring.test.js` (Task 7), testando a LÓGICA de decisão de injetar ou não (sem rodar `runHeadlessReview` inteiro, que exige `runClaudeStream`). Acrescentar a esse arquivo:

```js
const { resumeBlock } = require('../lib/engine/verification-checkpoint');

test('decide injetar resumeBlock quando o checkpoint tem entradas', () => {
  const prKey = 'wiring/teste#2';
  const p = checkpointPath(prKey);
  appendCheckpointEntry(p, prKey, 'url', { claim: 'a', file: 'x.ts', line: 1, verdict: 'confirmado' });

  // é exatamente a lógica que entra em runHeadlessReview antes de runClaudeStream
  const cp = readCheckpoint(checkpointPath(prKey));
  let prompt = 'prompt base';
  if (cp.ok && cp.entries.length) prompt += resumeBlock(cp.entries.length, checkpointPath(prKey));

  assert.match(prompt, /ATENÇÃO/);
  assert.match(prompt, /1 afirmação/);
});

test('NÃO injeta resumeBlock quando o checkpoint está ausente ou vazio', () => {
  const prKey = 'wiring/teste#3'; // nunca gravado
  const cp = readCheckpoint(checkpointPath(prKey));
  let prompt = 'prompt base';
  if (cp.ok && cp.entries.length) prompt += resumeBlock(cp.entries.length, checkpointPath(prKey));

  assert.equal(prompt, 'prompt base', 'sem checkpoint, o prompt não ganha nada a mais');
});
```

- [ ] **Passo 2: rodar e ver falhar.** Deveria já passar (é lógica pura testada isoladamente); se falhar, revise as Tasks 1/5/9 antes de prosseguir (não deveria precisar de código novo aqui, só a integração real em `review.js`).

- [ ] **Passo 3: implementação em `review.js`.** Trocar a linha:

```js
    const res = await engine.runClaudeStream(engine.headlessPromptFor(pr.url, pr.author, lotes, metrics), {
```

por:

```js
    let promptFinal = engine.headlessPromptFor(pr.url, pr.author, lotes, metrics);
    const cpAntesDeComecar = readCheckpoint(checkpointPath(pr.key));
    if (cpAntesDeComecar.ok && cpAntesDeComecar.entries.length) {
      promptFinal += resumeBlock(cpAntesDeComecar.entries.length, checkpointPath(pr.key));
    }
    const res = await engine.runClaudeStream(promptFinal, {
```

(o restante do objeto de opções, `{ id, account: ..., onModel: ..., onEvent: ... }`, continua exatamente igual, só a variável do primeiro argumento muda de uma expressão inline pra `promptFinal`).

Atualizar o import do topo de `review.js` (já feito na Task 7) pra incluir `resumeBlock`:

```js
const { checkpointPath, readCheckpoint, summarizeCheckpoint, appendCheckpointEntry, resumeBlock } = require('./verification-checkpoint');
```

- [ ] **Passo 4: gate completo.** `npm run check && npm test`.

- [ ] **Passo 5: commit.**

```bash
git add lib/engine/review.js test/checkpoint-review-wiring.test.js
git commit -m "feat: runHeadlessReview injeta bloco de retomada quando ja existe checkpoint"
```

---

### Task 11: trava de que o relançamento reusa o mesmo caminho (sem código novo, só teste)

**Files:**
- Test: Create `test/checkpoint-retry-same-path.test.js`

**Interfaces:** nenhuma nova; este teste documenta e trava uma premissa arquitetural (não existe caminho de código separado pro retry) que a Onda 3 inteira depende.

**Dificuldades antecipadas:**
- Testar `retryTargets`/`runOneHeadless` de ponta a ponta é caro (mesmo problema do `check()`, documentado em `onda-2-resiliencia-check.md`). → Testar só a PREMISSA estrutural: `retryTargets` devolve PRs (não sessões nem prompts), e o único jeito de relançar uma revisão é `runOneHeadless` → `runHeadlessReview`, que é a MESMA função já testada nas Tasks 7 e 10. O teste aqui é de leitura de código (grep programático), não de execução, exatamente pra travar que ninguém introduza um segundo caminho de prompt no futuro sem essa suíte notar.

- [ ] **Passo 1: escrever o teste.** Criar `test/checkpoint-retry-same-path.test.js`:

```js
'use strict';
// Trava arquitetural: NÃO existe (e não deveria passar a existir) um caminho de prompt
// separado pro relançamento via retryAfterNet. Onda 3 do checkpoint (resumeBlock) depende
// de toda sessão, primeira vez ou retry, passar pelo MESMO ponto de montagem de prompt em
// runHeadlessReview. Ver docs/superpowers/specs/2026-08-05-checkpoint-verificacao-design.md.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('runHeadlessReview é a ÚNICA função que chama headlessPromptFor', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'engine', 'review.js'), 'utf8');
  const chamadas = src.match(/headlessPromptFor\(/g) || [];
  // 1 na definição da função (`function headlessPromptFor(`) + 1 na chamada dentro de
  // runHeadlessReview = 2 ocorrências do token no arquivo inteiro
  assert.equal(chamadas.length, 2, 'headlessPromptFor só é definida e chamada uma vez; nenhum caminho paralelo de prompt');
});

test('retryTargets só filtra e devolve PRs, nunca monta prompt nem chama runClaudeStream', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'engine', 'review.js'), 'utf8');
  const inicio = src.indexOf('function retryTargets(');
  const fim = src.indexOf('\n}', inicio);
  const corpo = src.slice(inicio, fim);
  assert.doesNotMatch(corpo, /headlessPromptFor|runClaudeStream/, 'retryTargets é só filtro, o relançamento de verdade passa por runOneHeadless/runHeadlessReview');
});
```

- [ ] **Passo 2: rodar.** `node --test test/checkpoint-retry-same-path.test.js`. Esperado: verde de primeira (é uma trava sobre o código JÁ existente das tasks anteriores, não exige implementação nova). Se falhar, para e investiga antes de prosseguir, algo no fonte mudou de um jeito que quebra a premissa da Onda 3.

- [ ] **Passo 3: gate completo.** `npm run check && npm test`.

- [ ] **Passo 4: commit.**

```bash
git add test/checkpoint-retry-same-path.test.js
git commit -m "test: trava que retry e primeira vez usam o mesmo caminho de prompt (premissa da onda 3)"
```

---

## Ordem de execução e onda

1. **Onda 1 (Tasks 1 a 4):** escrita incremental via interceptação. Rodar `npm run check && npm test` verde ao final da Onda 1, e fazer a validação manual da Task 4 (revisão real de um PR de docs/spec) antes de seguir.
2. **Onda 2 (Tasks 5 a 8):** leitura, gate, UI. Só começar depois da Onda 1 validada em uso real (regra do projeto: nada de trabalho novo sobre base não confirmada).
3. **Onda 3 (Tasks 9 a 11):** retomada proativa. Só começar depois da Onda 2 100% verde.

## Release

Esta entrega NÃO inclui publicação de release. Ao final das 3 ondas, seguir o checklist de release do `CLAUDE.md` do repo (bump semver, CHANGELOG.md, RELEASE_NOTES em `ui/app.js`) como uma entrega própria, decidida por você depois de validar em uso real.
