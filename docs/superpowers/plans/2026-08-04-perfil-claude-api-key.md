# Perfil de assinatura Claude por chave de API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Perfil de assinatura Claude ganha um segundo tipo (`kind: 'apikey'`, ao lado do `dir` que já existe), pra usar `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL` em vez de login OAuth por diretório, cobrindo tanto sessões headless quanto a sessão de terminal interativa da fila.

**Architecture:** Dois helpers puros centralizam TODA a decisão de "kind" (`applyClaudeAuthEnv` pra objeto de env, `claudeAuthShellLines` pra linha de script), consumidos por `ghEnv` e pelos 2 script builders da sessão de terminal da fila. A sessão de LOGIN (4 funções) não muda nada de código: o guard "perfil de chave não loga" fica só na resolução, uma camada acima, então `apikey` nunca chega perto delas.

**Tech Stack:** Node.js puro (sem dependências novas), `node --test` (runner nativo), UI sem framework (`ui/app.js`/`ui/index.html`/`ui/app.css`).

## Global Constraints

- Zero dependências novas (invariante 1 do `CLAUDE.md`).
- Texto de UI e comentários em português, sem travessão (invariante 6).
- `npm run check && npm test` verde é pré-requisito de qualquer commit que toque `server.js`/`main.js`/`ui/app.js`.
- Nenhum código checa `kind === 'dir'` como condição positiva — só `kind === 'apikey'`, com todo o resto tratado como o caminho de diretório (perfil legado nunca tem o campo `kind`, ver Task 1).
- A chave de API nunca é logada (`farol.log`) nem impressa em texto solto em nenhum output de terminal/commit.
- Referência: `docs/superpowers/specs/2026-08-04-perfil-claude-api-key-design.md` (spec aprovada, já revisada por gaps).

---

### Task 1: `lib/parse.js` — modelo de dados e os 2 helpers de env

**Files:**
- Modify: `lib/parse.js:145-161` (`normalizeClaudeProfiles`), `lib/parse.js:214-218` (`module.exports`)
- Modify: `server.js:1136-1137` (`module.exports`, re-exporta os puros de `lib/parse.js` pro teste)
- Test: `test/pure.test.js`

**Interfaces:**
- Produz: `normalizeClaudeProfiles(val): Array<{id,label,dir} | {id,label,kind:'apikey',apiKey,baseUrl}>` — cada entrada é OU o shape de hoje (dir, sem campo `kind`) OU o shape novo (`kind:'apikey'`, sem campo `dir`). Nunca os dois shapes misturados no mesmo objeto.
- Produz: `applyClaudeAuthEnv(env: object, auth: {kind:'dir',dir} | {kind:'apikey',apiKey,baseUrl}): void` — muta `env` in-place.
- Produz: `claudeAuthShellLines(auth: {kind:'dir',dir} | {kind:'apikey',apiKey,baseUrl}, isWin: boolean): string[]` — linhas de script, sem o `\r\n`/`\n` de junção (quem chama decide o separador).
- Consumido por: Task 2 (`ghEnv`), Task 5 (`buildSessionScript`/`Mac`).

- [ ] **Step 1: Escrever os testes que falham (normalizeClaudeProfiles)**

Adicionar em `test/pure.test.js`, logo depois do teste `'normalizeClaudeProfiles: dir com aspa dupla ou newline é descartado (id+dir inválido)'` (linha 101-109 hoje):

```js
test('normalizeClaudeProfiles: kind ausente ou "dir" mantém o shape de hoje, sem o campo kind', () => {
  const out = normalizeClaudeProfiles([
    { id: 'a', label: 'A', dir: 'C:\\a' },
    { id: 'b', label: 'B', kind: 'dir', dir: 'C:\\b' },
  ]);
  assert.deepEqual(out, [
    { id: 'a', label: 'A', dir: 'C:\\a' },
    { id: 'b', label: 'B', dir: 'C:\\b' },
  ]);
  assert.ok(!('kind' in out[0]), 'perfil dir não carrega o campo kind (preserva o shape legado)');
});

test('normalizeClaudeProfiles: kind "apikey" exige apiKey válida, baseUrl é opcional', () => {
  const out = normalizeClaudeProfiles([
    { id: 'k1', label: 'Com base', kind: 'apikey', apiKey: 'sk-ant-123', baseUrl: 'https://proxy.example.com' },
    { id: 'k2', label: 'Sem base', kind: 'apikey', apiKey: 'sk-ant-456' },
    { id: 'k3', label: 'Sem chave', kind: 'apikey', apiKey: '' }, // descartado
  ]);
  assert.deepEqual(out, [
    { id: 'k1', label: 'Com base', kind: 'apikey', apiKey: 'sk-ant-123', baseUrl: 'https://proxy.example.com' },
    { id: 'k2', label: 'Sem base', kind: 'apikey', apiKey: 'sk-ant-456', baseUrl: '' },
  ]);
});

test('normalizeClaudeProfiles: apiKey/baseUrl com aspas ou quebra de linha são rejeitados (mesmo risco de injeção do dir)', () => {
  const out = normalizeClaudeProfiles([
    { id: 'bad1', label: 'Aspa na chave', kind: 'apikey', apiKey: 'sk-ant"; rm -rf ~ #' },
    { id: 'bad2', label: 'Newline na base', kind: 'apikey', apiKey: 'sk-ant-ok', baseUrl: 'https://x\ny' },
    { id: 'ok', label: 'Ok', kind: 'apikey', apiKey: 'sk-ant-ok' },
  ]);
  assert.deepEqual(out.map(p => p.id), ['ok']);
});

test('normalizeClaudeProfiles: kind desconhecido (nem dir nem apikey) é tratado como dir', () => {
  const out = normalizeClaudeProfiles([
    { id: 'x', label: 'X', kind: 'bedrock', dir: 'C:\\x' }, // kind estranho, mas tem dir válido -> vira perfil dir
    { id: 'y', label: 'Y', kind: 'bedrock', apiKey: 'sk-ant-y' }, // kind estranho, sem dir -> descartado
  ]);
  assert.deepEqual(out, [{ id: 'x', label: 'X', dir: 'C:\\x' }]);
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm test 2>&1 | grep -A 3 "normalizeClaudeProfiles: kind"`
Expected: FAIL (os 4 testes novos quebram — a função ainda não entende `kind`/`apiKey`/`baseUrl`, e o teste `'kind desconhecido'` além disso mostra que o objeto atual tem `dir: ''` mesmo quando `kind` é estranho e não tem dir, então o segundo caso do 4º teste também falharia por outro motivo até o Step 3).

- [ ] **Step 3: Implementar `normalizeClaudeProfiles` (novo shape) em `lib/parse.js:145-161`**

Substituir a função inteira por:

```js
// Perfis nomeados de assinatura Claude. Dois shapes, NUNCA misturados no mesmo objeto:
//   dir:    {id, label, dir}                       (o de sempre, sem campo `kind`)
//   apikey: {id, label, kind:'apikey', apiKey, baseUrl}
// O shape dir não carrega `kind` DE PROPÓSITO: preserva byte a byte o formato que já
// existia antes desta função saber o que é apikey, e é o que permite ler QUALQUER perfil
// salvo antes desta feature existir sem migração nenhuma (ver invariante "nenhum código
// checa kind==='dir'" no design). O array de entrada pode vir malformado (config.json
// editado à mão, ou do PATCH /api/settings) e a função devolve SEMPRE um array limpo.
// Não-array (string, número, objeto, null) vira [].
function normalizeClaudeProfiles(val) {
  if (!Array.isArray(val)) return [];
  return val.map(p => {
    const id = String((p && p.id) || '').trim();
    const label = String((p && p.label) || '').trim();
    if (p && p.kind === 'apikey') {
      // apiKey/baseUrl passam pelo MESMO sanitizador anti-injeção do dir: os dois viram
      // valor de variável de shell nos script builders (ver claudeAuthShellLines), o
      // mesmo motivo de segurança (aspa dupla/newline permitiriam escapar da atribuição).
      const apiKey = typeof p.apiKey === 'string' ? sanitizeClaudeDir(p.apiKey) : '';
      const baseUrl = typeof p.baseUrl === 'string' ? sanitizeClaudeDir(p.baseUrl) : '';
      return { id, label, kind: 'apikey', apiKey, baseUrl };
    }
    const dir = typeof (p && p.dir) === 'string' ? sanitizeClaudeDir(p.dir) : '';
    return { id, label, dir };
  }).filter(p => p.id && (p.kind === 'apikey' ? p.apiKey : p.dir));
}
```

Também atualizar o comentário de `sanitizeClaudeDir` (linha 128-132 hoje), que passa a ser usada
pra mais do que diretório:

```js
// Caracteres sem uso legítimo em diretório/chave/URL e que quebram os scripts de sessão
// gerados (.cmd no Windows: aspa dupla + newline permitem injeção de comando; .command no
// mac: idem). Nome ficou "ClaudeDir" por ter nascido só pro dir; hoje sanitiza qualquer
// valor que vira variável de shell (dir, apiKey, baseUrl - ver normalizeClaudeProfiles).
// Rejeita em vez de tentar escapar aqui — não existe path/chave/URL real que precise
// desses caracteres, e a Task de fix do .command trata aspa simples via escaping de
// verdade (claudeAuthShellLines), por ser um caractere que PODE aparecer legitimamente.
function sanitizeClaudeDir(v) {
```
(o corpo da função não muda, só o comentário acima dela.)

- [ ] **Step 4: Rodar os testes de novo e confirmar que passam**

Run: `npm test 2>&1 | grep -A 3 "normalizeClaudeProfiles"`
Expected: PASS em todos, incluindo os 3 testes antigos que já existiam (`não-array vira []`, `dir com aspa dupla...`, e os 2 de `sanitizeClaudeDir` que não mudam).

- [ ] **Step 5: Escrever os testes que falham (`applyClaudeAuthEnv`)**

Adicionar em `test/pure.test.js`, logo depois dos testes de `normalizeClaudeProfiles` do Step 1:

```js
test('applyClaudeAuthEnv: kind dir seta CLAUDE_CONFIG_DIR, nunca as vars de apikey', () => {
  const env = {};
  applyClaudeAuthEnv(env, { kind: 'dir', dir: 'C:\\perfil' });
  assert.deepEqual(env, { CLAUDE_CONFIG_DIR: 'C:\\perfil' });
});

test('applyClaudeAuthEnv: kind dir sem dir não seta nada', () => {
  const env = {};
  applyClaudeAuthEnv(env, { kind: 'dir', dir: '' });
  assert.deepEqual(env, {});
});

test('applyClaudeAuthEnv: kind apikey seta ANTHROPIC_API_KEY (+ BASE_URL se houver)', () => {
  const env1 = {};
  applyClaudeAuthEnv(env1, { kind: 'apikey', apiKey: 'sk-ant-123', baseUrl: '' });
  assert.deepEqual(env1, { ANTHROPIC_API_KEY: 'sk-ant-123' });

  const env2 = {};
  applyClaudeAuthEnv(env2, { kind: 'apikey', apiKey: 'sk-ant-123', baseUrl: 'https://proxy.x' });
  assert.deepEqual(env2, { ANTHROPIC_API_KEY: 'sk-ant-123', ANTHROPIC_BASE_URL: 'https://proxy.x' });
});

test('applyClaudeAuthEnv: limpa CLAUDE_CONFIG_DIR/ANTHROPIC_* residuais do objeto recebido (achado crítico de vazamento de ambiente)', () => {
  // simula ghEnv partindo de { ...process.env }: se a MÁQUINA já tiver ANTHROPIC_API_KEY
  // setada (uso pessoal do claude CLI fora do Farol), um perfil de assinatura (dir) não
  // pode deixar essa chave residual passar - ela venceria a OAuth por login, sem erro.
  const env = { ANTHROPIC_API_KEY: 'chave-de-fora', ANTHROPIC_BASE_URL: 'https://de-fora.x', OUTRA_VAR: 'preservada' };
  applyClaudeAuthEnv(env, { kind: 'dir', dir: 'C:\\perfil' });
  assert.deepEqual(env, { CLAUDE_CONFIG_DIR: 'C:\\perfil', OUTRA_VAR: 'preservada' });

  const env2 = { CLAUDE_CONFIG_DIR: 'C:\\de-fora', OUTRA_VAR: 'preservada' };
  applyClaudeAuthEnv(env2, { kind: 'apikey', apiKey: 'sk-ant-novo', baseUrl: '' });
  assert.deepEqual(env2, { ANTHROPIC_API_KEY: 'sk-ant-novo', OUTRA_VAR: 'preservada' });
});
```

- [ ] **Step 6: Rodar e confirmar que falham**

Run: `npm test 2>&1 | grep -A 3 "applyClaudeAuthEnv"`
Expected: FAIL com `applyClaudeAuthEnv is not defined` (função ainda não existe).

- [ ] **Step 7: Implementar `applyClaudeAuthEnv` em `lib/parse.js`, logo depois de `normalizeClaudeProfileId`**

```js
// Objeto env (JS): usado só por Engine.ghEnv (server.js), que por sua vez alimenta as
// sessões headless E o processo que abre a sessão de terminal da fila.
//
// Limpa as 3 chaves ANTES de setar só a(s) do kind resolvido - CRÍTICO, não é enfeite.
// ghEnv parte de `{ ...process.env }`: se a própria máquina já tiver ANTHROPIC_API_KEY
// setada no ambiente (uso pessoal do claude CLI fora do Farol, por exemplo), um perfil
// dir (assinatura) seria silenciosamente ANULADO - a ordem de precedência oficial do
// claude CLI dá a API key do ambiente por cima do login OAuth, sem erro nenhum aparecer.
function applyClaudeAuthEnv(env, auth) {
  delete env.CLAUDE_CONFIG_DIR;
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_BASE_URL;
  if (auth.kind === 'apikey' && auth.apiKey) {
    env.ANTHROPIC_API_KEY = auth.apiKey;
    if (auth.baseUrl) env.ANTHROPIC_BASE_URL = auth.baseUrl;
  } else if (auth.dir) {
    env.CLAUDE_CONFIG_DIR = auth.dir;
  }
}
```

- [ ] **Step 8: Rodar de novo e confirmar que passam**

Run: `npm test 2>&1 | grep -A 3 "applyClaudeAuthEnv"`
Expected: PASS nos 4 testes.

- [ ] **Step 9: Escrever os testes que falham (`claudeAuthShellLines`)**

```js
test('claudeAuthShellLines: kind dir, Windows', () => {
  assert.deepEqual(claudeAuthShellLines({ kind: 'dir', dir: 'C:\\perfil' }, true), ['set "CLAUDE_CONFIG_DIR=C:\\perfil"']);
  assert.deepEqual(claudeAuthShellLines({ kind: 'dir', dir: '' }, true), ['rem sem config dir proprio']);
});

test('claudeAuthShellLines: kind dir, macOS/posix, com escaping de aspa simples', () => {
  const lines = claudeAuthShellLines({ kind: 'dir', dir: "/tmp/x' ; touch /tmp/PROOF #" }, false);
  assert.deepEqual(lines, [`export CLAUDE_CONFIG_DIR='/tmp/x'\\'' ; touch /tmp/PROOF #'`]);
  assert.deepEqual(claudeAuthShellLines({ kind: 'dir', dir: '' }, false), ['# sem config dir proprio']);
});

test('claudeAuthShellLines: kind apikey, Windows, com e sem baseUrl', () => {
  assert.deepEqual(
    claudeAuthShellLines({ kind: 'apikey', apiKey: 'sk-ant-123', baseUrl: '' }, true),
    ['set "ANTHROPIC_API_KEY=sk-ant-123"', 'rem sem base url propria']
  );
  assert.deepEqual(
    claudeAuthShellLines({ kind: 'apikey', apiKey: 'sk-ant-123', baseUrl: 'https://proxy.x' }, true),
    ['set "ANTHROPIC_API_KEY=sk-ant-123"', 'set "ANTHROPIC_BASE_URL=https://proxy.x"']
  );
});

test('claudeAuthShellLines: kind apikey, macOS/posix, com escaping de aspa simples na chave', () => {
  const lines = claudeAuthShellLines({ kind: 'apikey', apiKey: "sk-ant-123' ; touch /tmp/PROOF #", baseUrl: '' }, false);
  assert.deepEqual(lines, [`export ANTHROPIC_API_KEY='sk-ant-123'\\'' ; touch /tmp/PROOF #'`, '# sem base url propria']);
});
```

- [ ] **Step 10: Rodar e confirmar que falham**

Run: `npm test 2>&1 | grep -A 5 "claudeAuthShellLines"`
Expected: FAIL com `claudeAuthShellLines is not defined`.

- [ ] **Step 11: Implementar `claudeAuthShellLines` em `lib/parse.js`, logo depois de `applyClaudeAuthEnv`**

```js
// Linhas de script (.cmd no Windows, .command no macOS), SEM o separador de linha (quem
// chama junta com '\r\n' ou '\n' conforme o SO). Usado só por buildSessionScript/
// buildSessionScriptMac (sessão de terminal da fila) - a sessão de LOGIN nunca chama isto,
// porque perfil apikey não tem fluxo de login (ver Engine.resolveAuthForLogin/
// openClaudeLoginSession, que barra apikey antes de chegar em qualquer script builder).
// Mesmo escaping de aspa simples que o dir já usa hoje no lado Mac (achado de auditoria
// adversarial documentado no CLAUDE.md: sem escapar, um valor com aspa simples escapava
// da atribuição shell e executava comando arbitrário).
function claudeAuthShellLines(auth, isWin) {
  const esc = s => s.replace(/'/g, "'\\''");
  if (auth.kind === 'apikey' && auth.apiKey) {
    const lines = [isWin ? `set "ANTHROPIC_API_KEY=${auth.apiKey}"` : `export ANTHROPIC_API_KEY='${esc(auth.apiKey)}'`];
    lines.push(auth.baseUrl
      ? (isWin ? `set "ANTHROPIC_BASE_URL=${auth.baseUrl}"` : `export ANTHROPIC_BASE_URL='${esc(auth.baseUrl)}'`)
      : (isWin ? 'rem sem base url propria' : '# sem base url propria'));
    return lines;
  }
  const dir = auth.dir || '';
  return [dir
    ? (isWin ? `set "CLAUDE_CONFIG_DIR=${dir}"` : `export CLAUDE_CONFIG_DIR='${esc(dir)}'`)
    : (isWin ? 'rem sem config dir proprio' : '# sem config dir proprio')];
}
```

- [ ] **Step 12: Rodar de novo e confirmar que passam**

Run: `npm test 2>&1 | grep -A 5 "claudeAuthShellLines"`
Expected: PASS nos 4 testes.

- [ ] **Step 13: Exportar as 2 funções novas**

Em `lib/parse.js:214-218`, adicionar `applyClaudeAuthEnv, claudeAuthShellLines` ao `module.exports`:

```js
module.exports = {
  parseProjectReviewers, parseDefaultReviewers, parseAccounts, parsePeople, migrateSeniorityToPeople,
  sanitizeClaudeDir, normalizeClaudeProfiles, normalizeClaudeProfileId,
  applyClaudeAuthEnv, claudeAuthShellLines,
  MODEL_ALIASES, EFFORT_LEVELS, sanitizeModel, sanitizeEffort, effortForModel,
};
```

Em `server.js:1136-1137`, adicionar as mesmas duas ao re-export (é o que `test/pure.test.js`
importa via `require('../server.js')`):

```js
module.exports = { start, HOME, WORKSPACE, Engine, modelLabel, isPermanentBranch, parseProjectReviewers, parseDefaultReviewers, parseAccounts,
  sanitizeClaudeDir, normalizeClaudeProfiles, normalizeClaudeProfileId, applyClaudeAuthEnv, claudeAuthShellLines };
```

Também atualizar a linha 13-14 de `test/pure.test.js` (destructure) pra incluir as 2 novas:

```js
const { modelLabel, isPermanentBranch, parseAccounts, parseProjectReviewers, parseDefaultReviewers,
  normalizeClaudeProfiles, sanitizeClaudeDir, applyClaudeAuthEnv, claudeAuthShellLines } = farol;
```

- [ ] **Step 14: Rodar a suíte inteira e o check de sintaxe**

Run: `npm run check && npm test`
Expected: `ok sintaxe validada em 65 arquivos .js` e todos os testes passando (nenhum dos
testes JÁ EXISTENTES de `normalizeClaudeProfiles`/`sanitizeClaudeDir` deve quebrar).

- [ ] **Step 15: Commit**

```bash
git add lib/parse.js server.js test/pure.test.js
git commit -m "feat: perfil claude por chave de API - modelo de dados e helpers de env"
```

---

### Task 2: `server.js` — `resolveClaudeAuth` e `ghEnv`

**Files:**
- Modify: `server.js:922-931` (`resolveClaudeConfigDir`), `server.js:505-516` (`ghEnv`)
- Test: `test/claude-profiles.test.js`

**Interfaces:**
- Consome: `applyClaudeAuthEnv` (Task 1, de `lib/parse.js`, já importado em `server.js` via
  o `require` existente de `lib/parse.js` no topo do arquivo — checar o import atual e
  adicionar `applyClaudeAuthEnv` a ele).
- Produz: `Engine.resolveClaudeAuth(user): {kind:'dir',dir} | {kind:'apikey',apiKey,baseUrl}`.
- Consumido por: Task 5 (`buildSessionScript`/`Mac` chamam `engine.resolveClaudeAuth`).

- [ ] **Step 1: Adicionar `applyClaudeAuthEnv` ao import de `lib/parse.js` em `server.js:25-27`**

De:

```js
const { parseProjectReviewers, parseDefaultReviewers, parseAccounts, parsePeople, migrateSeniorityToPeople,
  sanitizeClaudeDir, normalizeClaudeProfiles, normalizeClaudeProfileId,
  sanitizeModel, sanitizeEffort } = require('./lib/parse');
```

Para:

```js
const { parseProjectReviewers, parseDefaultReviewers, parseAccounts, parsePeople, migrateSeniorityToPeople,
  sanitizeClaudeDir, normalizeClaudeProfiles, normalizeClaudeProfileId,
  sanitizeModel, sanitizeEffort, applyClaudeAuthEnv } = require('./lib/parse');
```

- [ ] **Step 2: Escrever os testes que falham (`resolveClaudeAuth`)**

Adicionar em `test/claude-profiles.test.js`, logo depois do bloco de testes de
`resolveClaudeConfigDir` (linha 17-70 hoje, antes do bloco de `resolveConfigDirForLogin`):

```js
test('resolveClaudeAuth: sem profiles, cai no legado como kind dir', () => {
  const engine = new Engine();
  engine.config.claudeConfigDir = 'C:\\legado';
  engine.config.claudeProfiles = [];
  assert.deepEqual(engine.resolveClaudeAuth('alice'), { kind: 'dir', dir: 'C:\\legado' });
});

test('resolveClaudeAuth: perfil apikey da conta vence o padrão global dir', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [
    { id: 'trabalho', label: 'BIUD Trabalho', dir: 'C:\\biud-trabalho' },
    { id: 'chave-pessoal', label: 'Chave pessoal', kind: 'apikey', apiKey: 'sk-ant-123', baseUrl: '' },
  ];
  engine.config.claudeProfileId = 'trabalho';
  engine.config.accounts = [{ user: 'bob', owners: ['x'], claudeProfileId: 'chave-pessoal' }];
  assert.deepEqual(engine.resolveClaudeAuth('bob'), { kind: 'apikey', apiKey: 'sk-ant-123', baseUrl: '' });
});

test('resolveClaudeAuth: padrão global apikey, conta sem override', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [{ id: 'chave', label: 'Chave', kind: 'apikey', apiKey: 'sk-ant-456', baseUrl: 'https://proxy.x' }];
  engine.config.claudeProfileId = 'chave';
  engine.config.accounts = [{ user: 'carol', owners: [] }];
  assert.deepEqual(engine.resolveClaudeAuth('carol'), { kind: 'apikey', apiKey: 'sk-ant-456', baseUrl: 'https://proxy.x' });
});

test('resolveClaudeAuth: perfil apikey apontado mas sem apiKey (corrompido) cai no legado', () => {
  const engine = new Engine();
  engine.config.claudeConfigDir = 'C:\\legado';
  // profile malformado não sobrevive à normalização em condições normais, mas
  // resolveClaudeAuth precisa ser robusto mesmo contra config.json editado à mão
  engine.config.claudeProfiles = [{ id: 'quebrado', label: 'Sem chave', kind: 'apikey', apiKey: '' }];
  engine.config.claudeProfileId = 'quebrado';
  assert.deepEqual(engine.resolveClaudeAuth('qualquer'), { kind: 'dir', dir: 'C:\\legado' });
});

test('resolveClaudeConfigDir: continua devolvendo só o dir (string) quando o resolvido é kind dir', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [{ id: 'p1', label: 'P1', dir: 'C:\\p1' }];
  engine.config.claudeProfileId = 'p1';
  assert.equal(engine.resolveClaudeConfigDir('qualquer'), 'C:\\p1');
});

test('resolveClaudeConfigDir: devolve "" quando o resolvido é kind apikey (não confunde os dois)', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [{ id: 'chave', label: 'Chave', kind: 'apikey', apiKey: 'sk-ant-789' }];
  engine.config.claudeProfileId = 'chave';
  assert.equal(engine.resolveClaudeConfigDir('qualquer'), '');
});
```

- [ ] **Step 3: Rodar e confirmar que falham**

Run: `npm test 2>&1 | grep -B1 -A 3 "resolveClaudeAuth"`
Expected: FAIL com `engine.resolveClaudeAuth is not a function` nos 4 primeiros; os 2
últimos (que só usam `resolveClaudeConfigDir`, já existente) devem passar de cara — são
teste de regressão, mantidos verdes o tempo todo.

- [ ] **Step 4: Implementar `resolveClaudeAuth` e refatorar `resolveClaudeConfigDir` em `server.js:922-931`**

Substituir o método `resolveClaudeConfigDir` por estes dois:

```js
  // qual AUTENTICAÇÃO (não só dir) usar pras sessões desta conta GitHub. Cascata:
  // 1) accounts[].claudeProfileId da própria conta; 2) claudeProfileId global (padrão do
  // Farol); 3) sem profiles configurados (ou id não encontrado/perfil sem o campo
  // obrigatório do seu kind), cai no claudeConfigDir legado (sempre kind dir).
  resolveClaudeAuth(user) {
    const acc = (this.config.accounts || []).find(a => a && a.user === user);
    const profiles = this.config.claudeProfiles || [];
    if (profiles.length) {
      const id = acc?.claudeProfileId || this.config.claudeProfileId || '';
      const p = profiles.find(p => p.id === id);
      if (p?.kind === 'apikey' && p.apiKey) return { kind: 'apikey', apiKey: p.apiKey, baseUrl: p.baseUrl || '' };
      if (p && p.kind !== 'apikey' && p.dir) return { kind: 'dir', dir: p.dir };
    }
    return { kind: 'dir', dir: this.config.claudeConfigDir || '' };
  }

  // compat: quem só quer "o dir, se houver" (nenhum call site de produção deveria
  // sobrar depois da migração das Tasks 2/3/5, mas mantido por garantia). Devolve ''
  // quando o resolvido for kind apikey - nunca confunde os dois formatos de auth.
  resolveClaudeConfigDir(user) {
    const auth = this.resolveClaudeAuth(user);
    return auth.kind === 'dir' ? (auth.dir || '') : '';
  }
```

- [ ] **Step 5: Rodar de novo e confirmar que passam**

Run: `npm test 2>&1 | grep -B1 -A 3 "resolveClaudeAuth\|resolveClaudeConfigDir"`
Expected: PASS em tudo, incluindo TODOS os testes antigos de `resolveClaudeConfigDir`
(linhas 17-70 de `test/claude-profiles.test.js`, que não foram tocados e continuam
chamando o método com a mesma assinatura de sempre).

- [ ] **Step 6: Escrever os testes que falham (`ghEnv` com perfil apikey)**

Adicionar em `test/claude-profiles.test.js`, logo depois do bloco de testes de `ghEnv`
(linha 96-120 hoje):

```js
test('ghEnv: perfil apikey seta ANTHROPIC_API_KEY/BASE_URL, nunca CLAUDE_CONFIG_DIR', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [{ id: 'chave', label: 'Chave', kind: 'apikey', apiKey: 'sk-ant-abc', baseUrl: 'https://proxy.x' }];
  engine.config.claudeProfileId = 'chave';
  engine.tokens = { bob: 't-b' };
  const env = engine.ghEnv('bob');
  assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant-abc');
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://proxy.x');
  assert.equal('CLAUDE_CONFIG_DIR' in env, false);
});

test('ghEnv: perfil apikey sem baseUrl não seta ANTHROPIC_BASE_URL', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [{ id: 'chave', label: 'Chave', kind: 'apikey', apiKey: 'sk-ant-abc', baseUrl: '' }];
  engine.config.claudeProfileId = 'chave';
  engine.tokens = { bob: 't-b' };
  const env = engine.ghEnv('bob');
  assert.equal('ANTHROPIC_BASE_URL' in env, false);
});
```

- [ ] **Step 7: Rodar e confirmar que falham**

Run: `npm test 2>&1 | grep -B1 -A 3 "ghEnv: perfil apikey"`
Expected: FAIL — `ghEnv` ainda só entende `CLAUDE_CONFIG_DIR`.

- [ ] **Step 8: Refatorar `ghEnv` em `server.js:505-516`**

```js
  ghEnv(user) {
    const env = { ...process.env, GH_PAGER: 'cat', PAGER: 'cat', GH_PROMPT_DISABLED: '1' };
    const tok = this.tokenFor(user);
    if (user && !tok) throw new Error(`conta ${user} sem token no gh (rode: gh auth login --user ${user})`);
    if (tok) env.GH_TOKEN = tok;
    if (this.gitBash) env.CLAUDE_CODE_GIT_BASH_PATH = this.gitBash;
    // assinatura do Claude que o Farol usa pra esta conta: ver resolveClaudeAuth
    // (perfil por conta > perfil padrão do Farol > claudeConfigDir legado).
    applyClaudeAuthEnv(env, this.resolveClaudeAuth(user));
    return env;
  }
```

- [ ] **Step 9: Rodar TODA a suíte de `claude-profiles.test.js` e confirmar que passa**

Run: `node --test test/claude-profiles.test.js`
Expected: PASS em tudo, incluindo os testes antigos de `ghEnv` (linha 96-120, que checam
`CLAUDE_CONFIG_DIR` do jeito de sempre) e o teste de boot com config malformado (linha
232-268, que também chama `ghEnv`).

- [ ] **Step 10: Rodar o gate completo**

Run: `npm run check && npm test`
Expected: verde nos dois.

- [ ] **Step 11: Commit**

```bash
git add server.js test/claude-profiles.test.js
git commit -m "feat: resolveClaudeAuth e ghEnv suportam perfil de chave de API"
```

---

### Task 3: `server.js` — sessão de login não existe pra perfil de chave

**Files:**
- Modify: `server.js:937-948` (`resolveConfigDirForLogin`, `openClaudeLoginSession`)
- Test: `test/claude-profiles.test.js`

**Interfaces:**
- Produz: `Engine.resolveAuthForLogin(profileId): {kind:'dir',dir} | {kind:'apikey',apiKey,baseUrl}`.
- `Engine.openClaudeLoginSession(profileId)` passa a devolver `{ok:false, error}` pra
  perfil apikey, em vez de abrir sessão.
- **Não muda:** `spawnLoginConsole`/`spawnLoginConsoleMac`/`buildLoginScript`/
  `buildLoginScriptMac` (`lib/engine/session.js`) — continuam recebendo `dir: string`,
  zero alteração de código ou assinatura.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `test/claude-profiles.test.js`, logo depois do bloco de
`resolveConfigDirForLogin` (linha 72-94 hoje):

```js
test('resolveAuthForLogin: perfil apikey encontrado devolve o auth completo', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [{ id: 'chave', label: 'Chave', kind: 'apikey', apiKey: 'sk-ant-xyz', baseUrl: '' }];
  assert.deepEqual(engine.resolveAuthForLogin('chave'), { kind: 'apikey', apiKey: 'sk-ant-xyz', baseUrl: '' });
});

test('resolveAuthForLogin: perfil dir encontrado devolve {kind:dir,dir}', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [{ id: 'p1', label: 'P1', dir: 'C:\\p1' }];
  assert.deepEqual(engine.resolveAuthForLogin('p1'), { kind: 'dir', dir: 'C:\\p1' });
});

test('resolveAuthForLogin: profileId vazio ou não encontrado cai no legado (kind dir)', () => {
  const engine = new Engine();
  engine.config.claudeConfigDir = 'C:\\legado';
  engine.config.claudeProfiles = [{ id: 'p1', label: 'P1', dir: 'C:\\p1' }];
  assert.deepEqual(engine.resolveAuthForLogin(''), { kind: 'dir', dir: 'C:\\legado' });
  assert.deepEqual(engine.resolveAuthForLogin('id-que-nao-existe'), { kind: 'dir', dir: 'C:\\legado' });
});

test('openClaudeLoginSession: perfil apikey NÃO abre sessão, devolve erro amigável', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [{ id: 'chave', label: 'Chave', kind: 'apikey', apiKey: 'sk-ant-xyz', baseUrl: '' }];
  let spawnChamado = false;
  engine.spawnLoginConsole = () => { spawnChamado = true; };
  const r = engine.openClaudeLoginSession('chave');
  assert.equal(r.ok, false);
  assert.match(r.error, /chave de API/);
  assert.equal(spawnChamado, false, 'spawnLoginConsole não deve ser chamado pra perfil apikey');
});

test('openClaudeLoginSession: perfil dir chama spawnLoginConsole com o MESMO contrato de hoje (dir cru)', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [{ id: 'p1', label: 'P1', dir: 'C:\\p1' }];
  let dirRecebido = null;
  engine.spawnLoginConsole = (dir) => { dirRecebido = dir; return { ok: true }; };
  engine.openClaudeLoginSession('p1');
  assert.equal(dirRecebido, 'C:\\p1', 'spawnLoginConsole recebe uma STRING crua, não um objeto');
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `npm test 2>&1 | grep -B1 -A 3 "resolveAuthForLogin\|openClaudeLoginSession"`
Expected: FAIL — `resolveAuthForLogin` ainda não existe, e `openClaudeLoginSession` ainda
não bloqueia `apikey`.

- [ ] **Step 3: Implementar em `server.js:937-948`**

```js
  // dir/auth de um perfil ESPECÍFICO pelo id, pra "abrir sessão de login" sem depender de
  // conta GitHub nenhuma. Mantido inalterado (não migra pra resolveAuthForLogin por baixo
  // de propósito): tem seus próprios testes e ninguém mais chama, então preservar como
  // está é mais barato que arriscar os dois caminhos divergirem.
  resolveConfigDirForLogin(profileId) {
    const profiles = this.config.claudeProfiles || [];
    const p = profileId ? profiles.find(x => x.id === profileId) : null;
    if (p?.dir) return p.dir;
    return this.config.claudeConfigDir || '';
  }

  // mesma cascata de resolveConfigDirForLogin, mas devolvendo o perfil INTEIRO (com kind),
  // pra openClaudeLoginSession decidir se o perfil resolvido pode logar.
  resolveAuthForLogin(profileId) {
    const profiles = this.config.claudeProfiles || [];
    const p = profileId ? profiles.find(x => x.id === profileId) : null;
    if (p?.kind === 'apikey' && p.apiKey) return { kind: 'apikey', apiKey: p.apiKey, baseUrl: p.baseUrl || '' };
    if (p && p.kind !== 'apikey' && p.dir) return { kind: 'dir', dir: p.dir };
    return { kind: 'dir', dir: this.config.claudeConfigDir || '' };
  }

  // abre a sessão de terminal SÓ pra login (ver Fix 2, lib/engine/session.js). Perfil de
  // chave de API não tem fluxo de claude login (a chave já é a credencial): nem chega a
  // chamar spawnLoginConsole. A UI já esconde o botão nesse caso; isto é o segundo lado
  // da defesa.
  openClaudeLoginSession(profileId) {
    const auth = this.resolveAuthForLogin(profileId);
    if (auth.kind === 'apikey') {
      return { ok: false, error: 'perfis de chave de API não usam login: a chave já é a credencial' };
    }
    return this.spawnLoginConsole(auth.dir);
  }
```

- [ ] **Step 4: Rodar de novo e confirmar que passam**

Run: `npm test 2>&1 | grep -B1 -A 3 "resolveAuthForLogin\|openClaudeLoginSession"`
Expected: PASS em tudo, incluindo os testes antigos de `resolveConfigDirForLogin` (linha
72-94, inalterados).

- [ ] **Step 5: Confirmar o contrato da rota HTTP `/api/claude-login` (nenhuma mudança necessária aqui)**

Em `lib/http-server.js:90`, a rota hoje é:

```js
if (p === '/api/claude-login') { engine.openClaudeLoginSession(body.profileId || ''); return send(200, { ok: true }); }
```

Ela chama `openClaudeLoginSession` mas IGNORA o retorno, sempre respondendo `{ok:true}`
pro cliente (fire-and-forget, mesmo padrão de outras rotas de sessão deste arquivo). Isso
significa que o `{ok:false, error}` que `openClaudeLoginSession` passa a devolver pra
perfil `apikey` nunca chega no navegador por essa rota — o guard do backend é só a
segunda camada de defesa (a primeira é a UI escondendo o botão, Task 6). Não mexer nesta
rota: propagar o erro pro toast do usuário não foi pedido na spec e o caminho normal
(botão escondido) já cobre o caso real. Só confirmar que o `grep` acima bate com o texto
citado, sem editar `lib/http-server.js`.

- [ ] **Step 6: Rodar o gate completo**

Run: `npm run check && npm test`
Expected: verde nos dois.

- [ ] **Step 7: Commit**

```bash
git add server.js test/claude-profiles.test.js
git commit -m "feat: perfil de chave de API nao abre sessao de login"
```

---

### Task 4: `server.js` — doctor/badge (`allClaudeAuthInfo`)

**Files:**
- Modify: `server.js:974-979` (`allClaudeAuthInfo`)
- Test: `test/claude-profiles.test.js`

**Interfaces:**
- Produz: entrada de `allClaudeAuthInfo()` pra perfil apikey:
  `{id, label, configDir:null, account:null, ready:boolean, apiKeyMode:true}`.
- Consumido por: Task 6 (`claudeAuthBadge` em `ui/app.js` lê `STATE.doctor.claudeAuth`).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `test/claude-profiles.test.js`, logo depois do bloco de testes de
`allClaudeAuthInfo` (linha 153-186 hoje):

```js
test('allClaudeAuthInfo: perfil apikey com chave preenchida reporta ready + apiKeyMode, sem ler arquivo', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [{ id: 'chave', label: 'Chave OK', kind: 'apikey', apiKey: 'sk-ant-123', baseUrl: '' }];
  const all = engine.allClaudeAuthInfo();
  const entry = all.find(x => x.id === 'chave');
  assert.deepEqual(entry, { id: 'chave', label: 'Chave OK', configDir: null, account: null, ready: true, apiKeyMode: true });
});

test('allClaudeAuthInfo: perfil apikey sem chave (não deveria existir, mas defensivo) reporta ready:false', () => {
  const engine = new Engine();
  // normalizeClaudeProfiles já descartaria isto no updateSettings normal; testa o método
  // isolado pra defesa em profundidade contra config.json editado à mão.
  engine.config.claudeProfiles = [{ id: 'quebrada', label: 'Sem chave', kind: 'apikey', apiKey: '' }];
  const all = engine.allClaudeAuthInfo();
  const entry = all.find(x => x.id === 'quebrada');
  assert.equal(entry.ready, false);
  assert.equal(entry.apiKeyMode, true);
});

test('allClaudeAuthInfo: mistura perfil dir e apikey na mesma lista, cada um com o formato certo', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [
    { id: 'a', label: 'A', dir: path.join(HOME, 'a') },
    { id: 'b', label: 'B', kind: 'apikey', apiKey: 'sk-ant-b', baseUrl: '' },
  ];
  const all = engine.allClaudeAuthInfo();
  assert.deepEqual(all.map(x => x.id), ['', 'a', 'b']);
  assert.equal('apiKeyMode' in all.find(x => x.id === 'a'), false, 'perfil dir não carrega apiKeyMode');
  assert.equal(all.find(x => x.id === 'b').apiKeyMode, true);
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `npm test 2>&1 | grep -B1 -A 5 "allClaudeAuthInfo: perfil apikey\|mistura perfil"`
Expected: FAIL — hoje `allClaudeAuthInfo` chama `claudeAuthInfo(p.dir)` sempre, e `p.dir`
é `undefined` pra perfil apikey (`claudeAuthInfo(undefined)` cai no comportamento
"legado", devolvendo `configDir:null` mas SEM `apiKeyMode`, e sem refletir `apiKey`).

- [ ] **Step 3: Implementar em `server.js:974-979`**

```js
  // status de TODOS os perfis salvos, mais uma entrada sintética "Padrão" pro fallback
  // legado. Perfil apikey não tem OAuth pra ler (claudeAuthInfo lê .credentials.json,
  // que só existe pro caminho dir): status sintético baseado só em "a chave está
  // preenchida?", sem tocar disco.
  allClaudeAuthInfo() {
    const profiles = this.config.claudeProfiles || [];
    const legacy = { id: '', label: 'Padrão', ...this.claudeAuthInfo() };
    if (!profiles.length) return [legacy];
    return [legacy, ...profiles.map(p => ({
      id: p.id,
      label: p.label,
      ...(p.kind === 'apikey'
        ? { configDir: null, account: null, ready: !!p.apiKey, apiKeyMode: true }
        : this.claudeAuthInfo(p.dir))
    }))];
  }
```

- [ ] **Step 4: Rodar de novo e confirmar que passam**

Run: `node --test test/claude-profiles.test.js`
Expected: PASS em tudo, incluindo os testes antigos de `allClaudeAuthInfo` (linha
153-186, inalterados, e o teste de boot malformado que também chama esse método).

- [ ] **Step 5: Rodar o gate completo**

Run: `npm run check && npm test`
Expected: verde nos dois.

- [ ] **Step 6: Commit**

```bash
git add server.js test/claude-profiles.test.js
git commit -m "feat: doctor/badge reconhece perfil de chave de API"
```

---

### Task 5: `lib/engine/session.js` — sessão de terminal da fila usa `claudeAuthShellLines`

**Files:**
- Modify: `lib/engine/session.js:16-33` (`buildSessionScript`), `lib/engine/session.js:39-69` (`buildSessionScriptMac`)
- Test: `test/session-claude-profile.test.js`

**Interfaces:**
- Consome: `claudeAuthShellLines` (Task 1, `lib/parse.js`), `engine.resolveClaudeAuth(user)` (Task 2).
- **Não muda:** `buildLoginScript`/`buildLoginScriptMac` neste mesmo arquivo (ver Task 3 —
  elas nunca recebem `kind: 'apikey'`).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `test/session-claude-profile.test.js`, logo depois do bloco de testes de
`buildSessionScript`/`buildSessionScriptMac` (linha 54-78 hoje). A `fakeEngine` de hoje
(`resolveClaudeConfigDir(user)`) precisa virar `resolveClaudeAuth(user)` pra estes novos
casos — adicionar uma segunda fábrica de engine falso, só pra estes testes, sem tocar a
`fakeEngine` original (os testes antigos que a usam continuam funcionando, porque
`buildSessionScript` ainda vai chamar `engine.resolveClaudeAuth`, e a `fakeEngine` original
só define `resolveClaudeConfigDir` — ver Step 3 abaixo, que resolve isso ajustando a
própria `fakeEngine` pra também expor `resolveClaudeAuth`):

```js
test('buildSessionScript (Windows): perfil apikey da conta seta ANTHROPIC_API_KEY, não CLAUDE_CONFIG_DIR', () => {
  const engine = fakeEngineAuth({ bob: { kind: 'apikey', apiKey: 'sk-ant-abc', baseUrl: '' } });
  const script = buildSessionScript(engine, '/pr-review x', 'bob');
  assert.match(script, /set "ANTHROPIC_API_KEY=sk-ant-abc"/);
  assert.doesNotMatch(script, /CLAUDE_CONFIG_DIR/);
});

test('buildSessionScriptMac: perfil apikey da conta, com baseUrl, escaping de aspa simples', () => {
  const engine = fakeEngineAuth({ bob: { kind: 'apikey', apiKey: "sk-ant-abc' ; touch /tmp/PROOF #", baseUrl: 'https://proxy.x' } });
  const script = buildSessionScriptMac(engine, '/pr-review x', 'id1', 'bob');
  assert.match(script, /export ANTHROPIC_API_KEY='sk-ant-abc'\\''/);
  assert.match(script, /export ANTHROPIC_BASE_URL='https:\/\/proxy\.x'/);
  assert.doesNotMatch(script, /CLAUDE_CONFIG_DIR/);
});
```

E a fábrica nova, logo antes desses 2 testes:

```js
// engine "de mentira" v2: expõe resolveClaudeAuth (o que buildSessionScript passa a
// chamar), pros casos que envolvem perfil apikey. A fakeEngine original (linha 43-52)
// continua servindo os testes de perfil dir de sempre.
function fakeEngineAuth(authByUser) {
  return {
    config: { skipPermissions: false, port: 47170 },
    resolveClaudeAuth(user) {
      return (authByUser || {})[user] || { kind: 'dir', dir: '' };
    },
    primaryUser() { return 'default-user'; }
  };
}
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `npm test test/session-claude-profile.test.js 2>&1 | grep -B1 -A 3 "perfil apikey"`
Expected: FAIL — `buildSessionScript`/`Mac` ainda chamam `resolveClaudeConfigDir` (que a
`fakeEngineAuth` nem define), então o script sai sem nenhuma variável setada.

- [ ] **Step 3: Refatorar `buildSessionScript` em `lib/engine/session.js:16-33`**

```js
function buildSessionScript(engine, slash, account) {
  const stub = process.env.FAROL_REVIEW_CMD; // usado so em testes: substitui o claude
  const skip = engine.config.skipPermissions ? ' --dangerously-skip-permissions' : '';
  const claudeLine = stub ? `${stub} "${slash}"` : `claude${skip} "${slash}"`;
  const authLines = claudeAuthShellLines(engine.resolveClaudeAuth(account), true).join('\r\n');
  return [
    '@echo off',
    'chcp 65001>nul',
    'title Farol - sessao do Claude',
    `cd /d "${WORKSPACE}"`,
    authLines,
    claudeLine,
    'echo.',
    'echo  [Farol] Sessao encerrada. Pressione qualquer tecla para fechar esta janela.',
    'pause>nul'
  ].join('\r\n') + '\r\n';
}
```

- [ ] **Step 4: Refatorar `buildSessionScriptMac` em `lib/engine/session.js:39-69`**

```js
function buildSessionScriptMac(engine, slash, id, user) {
  const stub = process.env.FAROL_REVIEW_CMD;
  const skip = engine.config.skipPermissions ? ' --dangerously-skip-permissions' : '';
  const claudeLine = stub ? `${stub} '${slash}'` : `claude${skip} '${slash}'`;
  const acc = user || engine.primaryUser();
  const userArg = acc ? ` --user '${acc}'` : '';
  const authLines = claudeAuthShellLines(engine.resolveClaudeAuth(user), false).join('\n');
  return [
    '#!/bin/bash',
    '# Farol: sessao interativa do Claude. Este arquivo se apaga ao terminar.',
    `cd '${WORKSPACE}' || exit 1`,
    'notify() {',
    `  curl -fsS -m 5 -X POST -H 'x-farol: 1' -H 'Content-Type: application/json' \\`,
    `    --data '{"id":"${id}"}' 'http://127.0.0.1:${engine.config.port}/api/session-exit' >/dev/null 2>&1`,
    '  rm -f -- "$0"',
    '}',
    'trap notify EXIT',
    'export GH_PAGER=cat PAGER=cat',
    authLines,
    `GH_TOKEN="$(gh auth token${userArg} 2>/dev/null)" && export GH_TOKEN`,
    claudeLine,
    'echo',
    'echo " [Farol] Sessao encerrada. Pode fechar esta janela."'
  ].join('\n') + '\n';
}
```

Adicionar o require de `claudeAuthShellLines` no topo do arquivo (linha 13, junto do
`sanitizeModel`/`sanitizeEffort`):

```js
const { sanitizeModel, sanitizeEffort, effortForModel, claudeAuthShellLines } = require('../parse');
```

- [ ] **Step 5: Rodar TODA a suíte de `session-claude-profile.test.js` e confirmar que passa**

Run: `node --test test/session-claude-profile.test.js`
Expected: PASS em tudo, incluindo os testes ANTIGOS de perfil dir (linha 54-78, que usam a
`fakeEngine` original com `resolveClaudeConfigDir`) — **este é o ponto que precisa de
atenção**: a `fakeEngine` original só define `resolveClaudeConfigDir`, não
`resolveClaudeAuth`. Como `buildSessionScript` agora chama `engine.resolveClaudeAuth(account)`
e não mais `engine.resolveClaudeConfigDir`, os testes antigos vão quebrar com
`engine.resolveClaudeAuth is not a function` até a `fakeEngine` original ganhar esse método.
Ajustar a `fakeEngine` original (linha 43-52) assim, ANTES de rodar este step:

```js
function fakeEngine(profiles) {
  return {
    config: { skipPermissions: false, port: 47170 },
    resolveClaudeAuth(user) {
      const dir = (profiles || {})[user] || '';
      return { kind: 'dir', dir };
    },
    primaryUser() { return 'default-user'; }
  };
}
```

(Troca `resolveClaudeConfigDir(user)` por `resolveClaudeAuth(user)`, devolvendo o mesmo
dir só que empacotado como `{kind:'dir', dir}` — os testes antigos continuam passando
porque o dir resolvido é idêntico, só a forma de expor mudou.)

- [ ] **Step 6: Rodar o gate completo**

Run: `npm run check && npm test`
Expected: verde nos dois.

- [ ] **Step 7: Commit**

```bash
git add lib/engine/session.js test/session-claude-profile.test.js
git commit -m "feat: sessao de terminal da fila suporta perfil de chave de API"
```

---

### Task 6: UI (`ui/app.js`) — gerenciador de perfis, badge, formulário

**Files:**
- Modify: `ui/app.js:540-551` (`claudeAuthBadge`), `ui/app.js:570-625` (`renderClaudeProfiles`),
  `ui/app.js:819-874` (click handler de `#claudeProfilesManager`),
  `ui/app.js:875-893` (change handler de `#claudeProfilesManager`)
- Verificação: manual, no navegador (não há harness de DOM neste projeto — `ui/pure.js` é
  o único código de front testado automaticamente, ver `CLAUDE.md`)

**Interfaces:**
- Consome: `STATE.doctor.claudeAuth` (agora com entradas `apiKeyMode`, Task 4),
  `STATE.config.claudeProfiles` (agora com entradas `{kind:'apikey',...}`, Task 1).

- [ ] **Step 1: `claudeAuthBadge` — ramo novo pra `apiKeyMode`**

Em `ui/app.js:540-551`, adicionar o ramo ANTES dos existentes:

```js
function claudeAuthBadge(id) {
  const all = (STATE.doctor && STATE.doctor.claudeAuth) || [];
  const info = all.find(x => x.id === id) || all.find(x => x.id === '') || all[0] || null;
  if (!info) return '';
  if (info.apiKeyMode) {
    return info.ready
      ? `<span class="a-claude ok" title="Autenticação por chave de API">🔑 chave configurada</span>`
      : `<span class="a-claude bad" title="Perfil de chave de API sem chave preenchida">SEM CHAVE</span>`;
  }
  if (info.ready === false) return `<span class="a-claude bad" title="rode claude login nesse diretório">SEM LOGIN</span>`;
  if (info.account) return `<span class="a-claude ok" title="${esc(info.configDir || 'padrão da máquina')}">@${esc(info.account)}</span>`;
  return `<span class="a-claude" title="${esc(info.configDir || 'padrão da máquina')}">${info.configDir ? 'logada' : 'padrão da máquina'}</span>`;
}
```

- [ ] **Step 2: `renderClaudeProfiles` — seletor de tipo, campos por kind, fix do data-id**

Substituir a função inteira (`ui/app.js:570-625`) por:

```js
function renderClaudeProfiles() {
  const box = $('#claudeProfilesManager'); if (!box) return;
  if (document.activeElement && box.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  const c = STATE.config || {};
  const profiles = c.claudeProfiles || [];
  const migrateCard = (!profiles.length && c.claudeConfigDir) ? `<div class="card acct-add">
    <div class="a-add-title">Perfil atual detectado</div>
    <div class="a-hint">Você já tem um diretório configurado: <code>${esc(c.claudeConfigDir)}</code>. Salvar como o primeiro perfil?</div>
    <div class="a-editrow">
      <input id="claudeMigrateLabel" placeholder="nome do perfil" value="Perfil atual" spellcheck="false">
      <button class="btn sm" id="btnClaudeMigrate">Salvar como perfil</button>
    </div>
  </div>` : '';
  const defaultEmptyLabel = c.claudeConfigDir ? `Padrão da máquina (legado: ${esc(c.claudeConfigDir)})` : 'Padrão da máquina';
  const defaultOptions = [`<option value="">${defaultEmptyLabel}</option>`]
    .concat(profiles.map(p => `<option value="${esc(p.id)}"${c.claudeProfileId === p.id ? ' selected' : ''}>${esc(p.label)}</option>`))
    .join('');
  // botão de login da linha padrão: data-id dinâmico (era fixo "" antes desta feature,
  // então sempre abria o legado ao clicar, mesmo com outro perfil selecionado no dropdown
  // - bug preexistente, corrigido junto por ser exigido pra esconder o botão certo).
  const defaultProfile = profiles.find(p => p.id === (c.claudeProfileId || ''));
  const defaultIsApiKey = defaultProfile && defaultProfile.kind === 'apikey';
  const defaultLoginBtn = defaultIsApiKey ? '' : `<button class="btn sm cp-login" data-id="${esc(c.claudeProfileId || '')}">Abrir sessão de login</button>`;
  const defaultRow = `<div class="card set-row">
    <div class="set-txt">
      <span class="set-title">Perfil padrão do Farol</span>
      <span class="set-desc">Vale pra toda conta do GitHub que não tiver um perfil próprio (painel Contas).</span>
    </div>
    <div class="set-ctl">
      <select id="claudeProfileDefault">${defaultOptions}</select>
      ${defaultLoginBtn}
    </div>
  </div>`;
  const rows = profiles.map(p => {
    const isApiKey = p.kind === 'apikey';
    const fields = isApiKey ? `
      <div class="a-editrow">
        <input class="cp-apikey" type="password" data-id="${esc(p.id)}" value="${esc(p.apiKey || '')}" placeholder="chave de API" spellcheck="false" autocomplete="off">
        <button class="btn icon sm ghost cp-toggle-key" data-id="${esc(p.id)}" title="Mostrar/ocultar a chave" aria-label="Mostrar/ocultar a chave">👁</button>
      </div>
      <div class="a-editrow">
        <input class="cp-baseurl" data-id="${esc(p.id)}" value="${esc(p.baseUrl || '')}" placeholder="URL base (opcional, deixe em branco pra usar a Anthropic direto)" spellcheck="false">
      </div>` : `
      <div class="a-editrow">
        <input class="cp-dir" data-id="${esc(p.id)}" value="${esc(p.dir || '')}" placeholder="C:\\Users\\voce\\.claude-perfil" spellcheck="false">
      </div>`;
    return `<div class="card acct-card">
    <div class="a-body">
      <div class="a-editrow">
        <input class="cp-label" data-id="${esc(p.id)}" value="${esc(p.label)}" placeholder="nome do perfil" spellcheck="false">
        ${claudeAuthBadge(p.id)}
      </div>
      ${fields}
    </div>
    <div class="a-actions">
      ${isApiKey ? '' : `<button class="btn sm cp-login" data-id="${esc(p.id)}">Abrir sessão de login</button>`}
      <button class="btn sm danger-ghost cp-remove" data-id="${esc(p.id)}">Remover</button>
    </div>
  </div>`;
  }).join('');
  const addForm = `<div class="card acct-add">
    <div class="a-add-title">Adicionar perfil</div>
    <div class="a-editrow">
      <div class="seg" id="cpAddKind" role="group" aria-label="Tipo de perfil">
        <button type="button" class="seg-btn active" data-kind="dir">Login por assinatura</button>
        <button type="button" class="seg-btn" data-kind="apikey">Chave de API</button>
      </div>
    </div>
    <div class="a-editrow">
      <input id="cpAddLabel" placeholder="nome (ex.: BIUD Trabalho)" spellcheck="false">
      <input id="cpAddDir" placeholder="diretório de config (ex.: C:\\Users\\voce\\.claude-biud-trabalho)" spellcheck="false">
      <input id="cpAddApiKey" type="password" placeholder="chave de API" spellcheck="false" autocomplete="off" hidden>
      <input id="cpAddBaseUrl" placeholder="URL base (opcional)" spellcheck="false" hidden>
      <button class="btn sm" id="btnCpAdd">Adicionar</button>
    </div>
    <div class="a-hint" id="cpAddHint">Deixe em branco pra usar a Anthropic direto. Um endpoint customizado precisa falar a API de Mensagens da Anthropic — não é garantia de que qualquer provedor (ex.: OpenRouter) funcione sem um proxy tradutor.</div>
  </div>`;
  box.innerHTML = migrateCard + defaultRow + rows + addForm;
  const hint = $('#cpAddHint'); if (hint) hint.hidden = true; // só aparece no modo Chave de API (ver listener do seletor)
}
```

- [ ] **Step 3: seletor de tipo + toggle de mostrar/ocultar chave, no MESMO listener de `click` já existente**

Tudo dentro do ÚNICO handler de `click` de `#claudeProfilesManager` que já existe
(`ui/app.js:819-874`) — sem registrar um segundo listener, mesmo estilo dos ramos
`cp-remove`/`cp-login`/`btnClaudeMigrate` que já moram ali. Adicionar 2 ramos novos no
TOPO do handler (antes do `if (t.id === 'btnCpAdd')`):

```js
$('#claudeProfilesManager').addEventListener('click', (e) => {
  const t = e.target;
  // seletor "Login por assinatura" / "Chave de API" no form de adicionar: troca os
  // campos visíveis, sem tocar em nenhum perfil já salvo.
  const seg = t.closest('#cpAddKind .seg-btn');
  if (seg) {
    $('#cpAddKind').querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === seg));
    const isApiKey = seg.dataset.kind === 'apikey';
    $('#cpAddDir').hidden = isApiKey;
    $('#cpAddApiKey').hidden = !isApiKey;
    $('#cpAddBaseUrl').hidden = !isApiKey;
    $('#cpAddHint').hidden = !isApiKey;
    return;
  }
  // mostrar/ocultar a chave de um perfil já salvo (não é validação nem salvamento, só
  // alterna o type do input entre password e text).
  if (t.classList.contains('cp-toggle-key')) {
    const input = e.currentTarget.querySelector(`.cp-apikey[data-id="${CSS.escape(t.dataset.id)}"]`);
    if (input) input.type = input.type === 'password' ? 'text' : 'password';
    return;
  }
  if (t.id === 'btnCpAdd') {
    // ... resto do handler de hoje continua aqui, ver Step 4 pra troca deste bloco
  }
});
```

`e.currentTarget` é `#claudeProfilesManager` (o elemento em que o listener foi
registrado) — escopa a busca do input em vez de um `document.querySelector` solto.

- [ ] **Step 4: `btnCpAdd` — validação e payload por tipo**

Trocar o bloco `if (t.id === 'btnCpAdd') { ... }` (já existente, dentro do mesmo handler
do Step 3) por:

```js
  if (t.id === 'btnCpAdd') {
    const label = ($('#cpAddLabel').value || '').trim();
    const kindBtn = $('#cpAddKind .seg-btn.active');
    const isApiKey = kindBtn && kindBtn.dataset.kind === 'apikey';
    if (isApiKey) {
      const apiKey = ($('#cpAddApiKey').value || '').trim();
      const baseUrl = ($('#cpAddBaseUrl').value || '').trim();
      if (!label || !apiKey) return toast('error', 'Preencha nome e chave.', 3000);
      if (/["\r\n]/.test(apiKey) || /["\r\n]/.test(baseUrl)) {
        return toast('error', 'Chave ou URL base com aspas ou quebra de linha no meio não pode ser usada.', 4500);
      }
      const profiles = [...(STATE.config.claudeProfiles || []), { id: genProfileId(), label, kind: 'apikey', apiKey, baseUrl }];
      $('#cpAddLabel').value = ''; $('#cpAddApiKey').value = ''; $('#cpAddBaseUrl').value = '';
      saveClaudeProfiles(profiles);
      return;
    }
    const dir = ($('#cpAddDir').value || '').trim();
    if (!label || !dir) return toast('error', 'Preencha nome e diretório do perfil.', 3000);
    if (/["\r\n]/.test(dir.replace(/^"(.*)"$/s, '$1').trim())) {
      return toast('error', 'Esse caminho tem aspas ou quebra de linha no meio (não em volta) — não pode ser usado. Confira se colou o caminho certo.', 4500);
    }
    const profiles = [...(STATE.config.claudeProfiles || []), { id: genProfileId(), label, dir }];
    $('#cpAddLabel').value = ''; $('#cpAddDir').value = '';
    saveClaudeProfiles(profiles);
    return;
  }
```

- [ ] **Step 5: edição inline de `cp-apikey`/`cp-baseurl`, no handler de `change` existente**

No handler de `change` (`ui/app.js:875-893`), trocar a condição
`if (t.classList.contains('cp-label') || t.classList.contains('cp-dir'))` por uma que
também cubra `cp-apikey`/`cp-baseurl`:

```js
$('#claudeProfilesManager').addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'claudeProfileDefault') {
    STATE.config.claudeProfileId = t.value;
    return api('/api/settings', { claudeProfileId: t.value });
  }
  const camposEditaveis = ['cp-label', 'cp-dir', 'cp-apikey', 'cp-baseurl'];
  if (camposEditaveis.some(cls => t.classList.contains(cls))) {
    const id = t.dataset.id;
    if ((t.classList.contains('cp-dir') || t.classList.contains('cp-apikey') || t.classList.contains('cp-baseurl'))
        && /["\r\n]/.test(t.value.replace(/^"(.*)"$/s, '$1').trim())) {
      toast('error', 'Esse valor tem aspas ou quebra de linha no meio — não pode ser usado.', 4500);
      return;
    }
    const profiles = (STATE.config.claudeProfiles || []).map(p => {
      if (p.id !== id) return p;
      const next = { ...p };
      if (t.classList.contains('cp-label')) next.label = t.value.trim() || p.label;
      if (t.classList.contains('cp-dir')) next.dir = t.value.trim();
      if (t.classList.contains('cp-apikey')) next.apiKey = t.value.trim();
      if (t.classList.contains('cp-baseurl')) next.baseUrl = t.value.trim();
      return next;
    });
    saveClaudeProfiles(profiles);
  }
});
```

- [ ] **Step 6: rodar o gate de sintaxe**

Run: `npm run check`
Expected: `ok sintaxe validada em 65 arquivos .js` (o `check` roda `node --check` em
`ui/app.js` também).

- [ ] **Step 7: Verificação manual no navegador**

1. Subir uma instância isolada: `FAROL_HOME=/tmp/farol-teste-apikey node server.js` (porta
   default 47170; ajuste `port` no `config.json` do `FAROL_HOME` se precisar rodar junto
   com outra instância).
2. Abrir `http://127.0.0.1:47170`, ir em Sistema > Plano e chaves.
3. Clicar em "Chave de API" no seletor de "Adicionar perfil": os campos de diretório
   somem, aparecem chave (mascarada) + URL base + a nota de apoio.
4. Preencher nome + chave (deixar URL base em branco), clicar Adicionar: o card do perfil
   aparece SEM o botão "Abrir sessão de login", com o campo de chave mascarado e um botão
   de mostrar/ocultar ao lado.
5. Clicar no botão de mostrar/ocultar: o campo alterna entre pontinhos e o texto da chave.
6. Badge do perfil mostra "🔑 chave configurada".
7. Editar o campo de chave pra vazio (ou testar sem preencher no form de adicionar): a
   validação bloqueia com "Preencha nome e chave." (form de adicionar) — a limpeza de um
   perfil JÁ SALVO até vazio ainda some silenciosamente no próximo reload (mesmo
   comportamento de sempre pro `dir`, documentado como decisão consciente já existente).
8. Trocar "Perfil padrão do Farol" pra esse perfil de chave: o botão "Abrir sessão de
   login" ao lado do dropdown some.
9. Trocar de volta pra um perfil `dir` (ou "Padrão da máquina"): o botão volta a aparecer,
   e o `data-id` dele (inspecionar via devtools) reflete o perfil de fato selecionado, não
   mais uma string vazia fixa.
10. Encerrar a instância de teste (matar o processo do `node server.js`).

- [ ] **Step 8: Commit**

```bash
git add ui/app.js
git commit -m "feat(ui): gerenciador de perfis suporta chave de API"
```

---

### Task 7: Documentação e gate final

**Files:**
- Modify: `CLAUDE.md` (seção "Assinatura do Claude")
- Modify: `docs/superpowers/specs/2026-08-04-perfil-claude-api-key-design.md` (status)

**Interfaces:** nenhuma (só documentação).

- [ ] **Step 1: Atualizar a seção "Assinatura do Claude" do `CLAUDE.md`**

Adicionar um parágrafo novo logo depois do parágrafo que descreve os "Perfis nomeados de
assinatura" (o item 3 da lista numerada "Formas de trocar"), explicando o tipo `apikey`:

```markdown
**Perfil por chave de API (desde a v2.34.0):** cada perfil pode ser "login por assinatura"
(o de sempre, `CLAUDE_CONFIG_DIR`) ou "chave de API" (`ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL`
opcional, billing por token em vez de assinatura). Os dois convivem no mesmo gerenciador de
perfis e são escolhidos por conta GitHub do mesmo jeito. Perfil de chave não tem fluxo de
`claude login` (a chave já é a credencial) e cobre tanto as sessões headless quanto a sessão
de terminal interativa da fila — a sessão de LOGIN em si (botão "Abrir sessão de login")
segue existindo só pro tipo assinatura. URL base é um escape hatch genérico pra qualquer
endpoint compatível com a API de Mensagens da Anthropic (proxy próprio, gateway corporativo);
não é garantia de funcionar com qualquer provedor (ex.: OpenRouter fala nativamente uma API
diferente, OpenAI-style).
```

- [ ] **Step 2: Marcar a spec como entregue**

Em `docs/superpowers/specs/2026-08-04-perfil-claude-api-key-design.md:4`, trocar:

```markdown
Status: **DESENHADO**, aguardando plano de implementação.
```

por:

```markdown
Status: **ENTREGUE na vX.Y.Z** (data). Todo item desta spec está no código e coberto por
`test/pure.test.js`, `test/claude-profiles.test.js` e `test/session-claude-profile.test.js`.
```

(preencher `vX.Y.Z`/data no momento do release, seguindo o checklist de release do
`CLAUDE.md`; não faz parte deste plano decidir a versão agora.)

- [ ] **Step 3: Gate de qualidade completo, do zero**

Run: `npm run check && npm test`
Expected: `ok sintaxe validada em 65 arquivos .js` e TODOS os testes passando (a suíte
inteira, não só os arquivos tocados — confirma que nada em outro lugar quebrou).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-08-04-perfil-claude-api-key-design.md
git commit -m "docs: perfil de chave de API documentado no CLAUDE.md, spec marcada entregue"
```

---

## Nota sobre release

Este plano NÃO inclui o bump de versão/CHANGELOG/publish-release.ps1: por convenção deste
projeto (ver checklist de release no `CLAUDE.md`), isso é feito numa passada só, depois que
TODAS as Tasks acima estão verdes, decidindo a versão nova conforme a última release
publicada no GitHub no momento (não a versão do `package.json`, que pode estar adiantada).
