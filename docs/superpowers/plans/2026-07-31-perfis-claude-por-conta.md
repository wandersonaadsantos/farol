# Perfis de assinatura Claude por conta GitHub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que cada conta GitHub monitorada pelo Farol use, opcionalmente, um perfil próprio de assinatura Claude (config dir logado numa conta separada), com fallback total pro campo legado `claudeConfigDir` — sem quebrar quem já usa o Farol hoje.

**Architecture:** Novo array `config.claudeProfiles` (perfis nomeados) + `claudeProfileId` global (padrão do Farol) + `accounts[].claudeProfileId` (override por conta, opcional). Um resolver único, `Engine.resolveClaudeConfigDir(user)`, decide qual dir usar; os três pontos que hoje leem `config.claudeConfigDir` direto (`ghEnv`, `buildSessionScript`, `buildSessionScriptMac`) passam a chamar o resolver. `claudeAuthInfo()` ganha parâmetro `dir` opcional e um novo `allClaudeAuthInfo()` itera todos os perfis salvos pro doctor/badges.

**Tech Stack:** Node.js puro (sem framework), `node:test` como runner de teste (zero dependências), front-end vanilla JS (`ui/app.js`) sem build step.

## Global Constraints

- Nenhuma migração automática destrutiva: se `config.claudeProfiles` estiver vazio, o comportamento deve ser IDÊNTICO ao de hoje (fallback pro `claudeConfigDir` legado). Ver spec, seção "Modelo de dados".
- Login (`claude login`) nunca é automatizado pelo Farol — é sempre ação manual do usuário. Nenhuma task deste plano chama `claude login`.
- Persistência de perfis/contas é só local (`~/.farol/config.json`), nunca no fonte versionado — mesma regra do `accounts` existente.
- Testes usam `node:test` (runner nativo), seguindo o padrão de `test/boot.test.js` (Engine real contra `FAROL_HOME` temporário) e `test/pure.test.js` (funções puras via `require`). Nada de framework novo.
- Rodar `node --check server.js && node --check main.js && node --check ui/app.js` (script `npm run check`) depois de qualquer edição nesses três arquivos.
- Fonte é a verdade em `C:\Users\wanderson\Documents\farol` — nunca editar a cópia instalada em `~/.farol/app`.

---

### Task 1: `resolveClaudeConfigDir(user)` no Engine + defaults de config

**Files:**
- Modify: `server.js:57-105` (bloco `DEFAULTS`)
- Modify: `server.js` (novo método na classe `Engine`, logo antes de `claudeAuthInfo()` — hoje em `server.js:820-834`)
- Test: `test/claude-profiles.test.js` (novo arquivo)

**Interfaces:**
- Produces: `Engine.resolveClaudeConfigDir(user: string|undefined): string` — devolve o caminho do config dir a usar (`''` = padrão da máquina). Usado pelas Tasks 2 e 3.
- Produces: defaults `claudeProfiles: []` e `claudeProfileId: ''` em `DEFAULTS`, consumidos pela Task 5.

- [ ] **Step 1: Escrever o teste (ainda falhando)**

Criar `test/claude-profiles.test.js`:

```js
'use strict';
// Perfis de assinatura Claude por conta: resolver + claudeAuthInfo parametrizado.
// Segue o padrão de boot.test.js (Engine real contra FAROL_HOME temporário).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const HOME = path.join(os.tmpdir(), 'farol-test-claude-profiles-' + process.pid);
process.env.FAROL_HOME = HOME;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../server.js');

after(() => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

test('resolveClaudeConfigDir: sem profiles, cai no legado (claudeConfigDir)', () => {
  const engine = new Engine();
  engine.config.claudeConfigDir = 'C:\\legado';
  engine.config.claudeProfiles = [];
  assert.equal(engine.resolveClaudeConfigDir('alice'), 'C:\\legado');
  assert.equal(engine.resolveClaudeConfigDir(undefined), 'C:\\legado');
});

test('resolveClaudeConfigDir: com profiles, sem override de conta, usa o padrão global', () => {
  const engine = new Engine();
  engine.config.claudeConfigDir = 'C:\\legado'; // não deve ser usado
  engine.config.claudeProfiles = [
    { id: 'trabalho', label: 'BIUD Trabalho', dir: 'C:\\biud-trabalho' },
    { id: 'pessoal', label: 'Pessoal Max', dir: 'C:\\pessoal' }
  ];
  engine.config.claudeProfileId = 'pessoal';
  engine.config.accounts = [{ user: 'alice', owners: ['x'] }]; // sem claudeProfileId próprio
  assert.equal(engine.resolveClaudeConfigDir('alice'), 'C:\\pessoal');
});

test('resolveClaudeConfigDir: com profiles, override por conta vence o padrão global', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [
    { id: 'trabalho', label: 'BIUD Trabalho', dir: 'C:\\biud-trabalho' },
    { id: 'pessoal', label: 'Pessoal Max', dir: 'C:\\pessoal' }
  ];
  engine.config.claudeProfileId = 'pessoal';
  engine.config.accounts = [{ user: 'bob', owners: ['biudtech'], claudeProfileId: 'trabalho' }];
  assert.equal(engine.resolveClaudeConfigDir('bob'), 'C:\\biud-trabalho');
});

test('resolveClaudeConfigDir: id aponta pra perfil inexistente, cai no legado', () => {
  const engine = new Engine();
  engine.config.claudeConfigDir = 'C:\\legado';
  engine.config.claudeProfiles = [{ id: 'trabalho', label: 'BIUD Trabalho', dir: 'C:\\biud-trabalho' }];
  engine.config.claudeProfileId = 'id-que-nao-existe';
  engine.config.accounts = [{ user: 'carol', owners: [] }];
  assert.equal(engine.resolveClaudeConfigDir('carol'), 'C:\\legado');
});

test('resolveClaudeConfigDir: perfil encontrado mas com dir vazio/ausente cai no legado', () => {
  const engine = new Engine();
  engine.config.claudeConfigDir = 'C:\\legado';
  engine.config.claudeProfiles = [{ id: 'quebrado', label: 'Sem dir', dir: '' }];
  engine.config.claudeProfileId = 'quebrado';
  assert.equal(engine.resolveClaudeConfigDir('qualquer'), 'C:\\legado');
});

test('resolveClaudeConfigDir: sem user informado usa o padrão global/legado normalmente', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [{ id: 'p1', label: 'P1', dir: 'C:\\p1' }];
  engine.config.claudeProfileId = 'p1';
  assert.equal(engine.resolveClaudeConfigDir(), 'C:\\p1');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/claude-profiles.test.js`
Expected: FAIL — `engine.resolveClaudeConfigDir is not a function`.

- [ ] **Step 3: Adicionar os defaults em `DEFAULTS`**

Em `server.js:100`, logo depois da linha `claudeConfigDir: '',`:

```js
  claudeConfigDir: '',
  // NOVO: perfis nomeados de assinatura Claude [{id,label,dir}]. Vazio = usa só o
  // claudeConfigDir legado acima (compatibilidade total, nada muda pra quem não adotar
  // o sistema novo). claudeProfileId escolhe o perfil padrão do Farol quando a conta
  // não tiver um claudeProfileId próprio (accounts[].claudeProfileId, opcional).
  claudeProfiles: [],
  claudeProfileId: '',
```

- [ ] **Step 4: Implementar `resolveClaudeConfigDir(user)`**

Em `server.js`, imediatamente antes do método `claudeAuthInfo()` (hoje `server.js:820-834`, comentário "--- diagnostico de pre-requisitos ---"), adicionar:

```js
  // qual config dir (assinatura Claude) usar pras sessões desta conta GitHub. Prioridade:
  // 1) accounts[].claudeProfileId da própria conta; 2) claudeProfileId global (padrão do
  // Farol); 3) sem profiles configurados (ou id não encontrado/perfil sem dir), cai no
  // claudeConfigDir legado — same behavior de antes do sistema de perfis existir.
  resolveClaudeConfigDir(user) {
    const acc = (this.config.accounts || []).find(a => a && a.user === user);
    const profiles = this.config.claudeProfiles || [];
    if (profiles.length) {
      const id = acc?.claudeProfileId || this.config.claudeProfileId || '';
      const p = profiles.find(p => p.id === id);
      if (p?.dir) return p.dir;
    }
    return this.config.claudeConfigDir || '';
  }

```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `node --test test/claude-profiles.test.js`
Expected: PASS (6 testes).

- [ ] **Step 6: Commit**

```bash
git add server.js test/claude-profiles.test.js
git commit -m "feat: resolveClaudeConfigDir por conta, com fallback legado"
```

---

### Task 2: `ghEnv(user)` usa o resolver

**Files:**
- Modify: `server.js:444-454` (método `ghEnv`)
- Test: `test/claude-profiles.test.js` (adicionar testes)

**Interfaces:**
- Consumes: `Engine.resolveClaudeConfigDir(user)` (Task 1).
- Produces: nenhuma interface nova — `ghEnv(user)` continua devolvendo o mesmo shape de `env` pros ~19 call sites existentes (`decision.js`, `fanout.js`, `gh-queries.js`, `pushback.js`, `selfpr.js`, `session.js`, `update.js`), nenhum precisa mudar.

- [ ] **Step 1: Escrever o teste (ainda falhando)**

Adicionar ao final de `test/claude-profiles.test.js`:

```js
test('ghEnv: injeta CLAUDE_CONFIG_DIR do perfil da conta', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [
    { id: 'trabalho', label: 'BIUD Trabalho', dir: 'C:\\biud-trabalho' },
    { id: 'pessoal', label: 'Pessoal Max', dir: 'C:\\pessoal' }
  ];
  engine.config.claudeProfileId = 'pessoal';
  engine.config.accounts = [
    { user: 'bob', owners: ['biudtech'], claudeProfileId: 'trabalho' },
    { user: 'alice', owners: ['lovelace-eng'] }
  ];
  assert.equal(engine.ghEnv('bob').CLAUDE_CONFIG_DIR, 'C:\\biud-trabalho');
  assert.equal(engine.ghEnv('alice').CLAUDE_CONFIG_DIR, 'C:\\pessoal');
});

test('ghEnv: sem profiles, comportamento legado (claudeConfigDir global ou nenhum)', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [];
  engine.config.claudeConfigDir = '';
  assert.equal('CLAUDE_CONFIG_DIR' in engine.ghEnv('qualquer'), false);
  engine.config.claudeConfigDir = 'C:\\legado';
  assert.equal(engine.ghEnv('qualquer').CLAUDE_CONFIG_DIR, 'C:\\legado');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/claude-profiles.test.js`
Expected: FAIL — o teste do "bob"/"alice" espera dirs diferentes, mas hoje `ghEnv` sempre usa `this.config.claudeConfigDir` (mesmo valor pras duas contas).

- [ ] **Step 3: Alterar `ghEnv`**

Em `server.js:444-454`, trocar a linha 452:

```js
  ghEnv(user) {
    const env = { ...process.env, GH_PAGER: 'cat', PAGER: 'cat', GH_PROMPT_DISABLED: '1' };
    const tok = (user && this.tokens && this.tokens[user]) || this.token;
    if (tok) env.GH_TOKEN = tok;
    if (this.gitBash) env.CLAUDE_CODE_GIT_BASH_PATH = this.gitBash;
    // assinatura do Claude que o Farol usa pra esta conta: ver resolveClaudeConfigDir
    // (perfil por conta > perfil padrão do Farol > claudeConfigDir legado).
    const claudeDir = this.resolveClaudeConfigDir(user);
    if (claudeDir) env.CLAUDE_CONFIG_DIR = claudeDir;
    return env;
  }
```

(substitui inteiramente o corpo atual do método, linhas 444-454.)

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/claude-profiles.test.js`
Expected: PASS (8 testes).

- [ ] **Step 5: Rodar a suíte inteira pra garantir que nada mais quebrou**

Run: `node --test`
Expected: PASS (todos os arquivos, incluindo `boot.test.js`, `http.test.js`, `pure.test.js`).

- [ ] **Step 6: Commit**

```bash
git add server.js test/claude-profiles.test.js
git commit -m "feat: ghEnv usa resolveClaudeConfigDir por conta"
```

---

### Task 3: sessões de terminal (Windows + macOS) usam o resolver

**Files:**
- Modify: `lib/engine/session.js:15-31` (`buildSessionScript`)
- Modify: `lib/engine/session.js:37-60` (`buildSessionScriptMac`)
- Modify: `lib/engine/session.js:91-96` (`spawnConsole`, repassar `account`)
- Modify: `server.js:670-671` (fachadas da Engine que delegam pro módulo)
- Test: `test/session-claude-profile.test.js` (novo arquivo)

**Interfaces:**
- Consumes: `engine.resolveClaudeConfigDir(user)` (Task 1) — aqui `engine` é um objeto duck-typed nos testes (não precisa ser uma `Engine` real, já que `buildSessionScript`/`buildSessionScriptMac` só chamam métodos/leem `config` do objeto que recebem).
- Produces: `buildSessionScript(engine, slash, account)` — assinatura nova, com 3º parâmetro opcional. Callers: `spawnConsole` (dentro do próprio arquivo) e a fachada `Engine.buildSessionScript(slash, account)` em `server.js`.

- [ ] **Step 1: Escrever o teste (ainda falhando)**

Criar `test/session-claude-profile.test.js`:

```js
'use strict';
// buildSessionScript/buildSessionScriptMac usam resolveClaudeConfigDir(account) em vez
// de ler config.claudeConfigDir direto — pra a sessão de terminal (Windows/mac) respeitar
// o perfil por conta, igual ao headless (ghEnv, ver ghEnv.test em claude-profiles.test.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSessionScript, buildSessionScriptMac } = require('../lib/engine/session');

// engine "de mentira": só precisa do que buildSessionScript/buildSessionScriptMac usam.
function fakeEngine(profiles) {
  return {
    config: { skipPermissions: false, port: 47170 },
    resolveClaudeConfigDir(user) {
      const p = (profiles || {})[user];
      return p || '';
    },
    primaryUser() { return 'default-user'; }
  };
}

test('buildSessionScript (Windows): injeta o dir resolvido pra conta', () => {
  const engine = fakeEngine({ bob: 'C:\\biud-trabalho' });
  const script = buildSessionScript(engine, '/pr-review x', 'bob');
  assert.match(script, /set "CLAUDE_CONFIG_DIR=C:\\biud-trabalho"/);
});

test('buildSessionScript (Windows): sem dir resolvido, não seta CLAUDE_CONFIG_DIR', () => {
  const engine = fakeEngine({});
  const script = buildSessionScript(engine, '/pr-review x', 'alice');
  assert.match(script, /rem sem config dir proprio/);
  assert.doesNotMatch(script, /CLAUDE_CONFIG_DIR/);
});

test('buildSessionScriptMac: injeta o dir resolvido pra conta', () => {
  const engine = fakeEngine({ bob: 'C:\\biud-trabalho' });
  const script = buildSessionScriptMac(engine, '/pr-review x', 'id1', 'bob');
  assert.match(script, /export CLAUDE_CONFIG_DIR='C:\\biud-trabalho'/);
});

test('buildSessionScriptMac: sem dir resolvido, não exporta CLAUDE_CONFIG_DIR', () => {
  const engine = fakeEngine({});
  const script = buildSessionScriptMac(engine, '/pr-review x', 'id1', 'alice');
  assert.match(script, /# sem config dir proprio/);
  assert.doesNotMatch(script, /CLAUDE_CONFIG_DIR/);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/session-claude-profile.test.js`
Expected: FAIL — hoje `buildSessionScript` não aceita 3º argumento e lê `engine.config.claudeConfigDir` (que nem existe no `fakeEngine`, então nunca bate "C:\\biud-trabalho").

- [ ] **Step 3: Alterar `buildSessionScript`**

Em `lib/engine/session.js:15-31`, substituir a função inteira:

```js
function buildSessionScript(engine, slash, account) {
  const stub = process.env.FAROL_REVIEW_CMD; // usado so em testes: substitui o claude
  const skip = engine.config.skipPermissions ? ' --dangerously-skip-permissions' : '';
  const claudeLine = stub ? `${stub} "${slash}"` : `claude${skip} "${slash}"`;
  const claudeDir = engine.resolveClaudeConfigDir(account);
  const cfgDir = claudeDir ? `set "CLAUDE_CONFIG_DIR=${claudeDir}"` : 'rem sem config dir proprio';
  return [
    '@echo off',
    'chcp 65001>nul',
    'title Farol - sessao do Claude',
    `cd /d "${WORKSPACE}"`,
    cfgDir,
    claudeLine,
    'echo.',
    'echo  [Farol] Sessao encerrada. Pressione qualquer tecla para fechar esta janela.',
    'pause>nul'
  ].join('\r\n') + '\r\n';
}
```

- [ ] **Step 4: Alterar `buildSessionScriptMac`**

Em `lib/engine/session.js:37-60`, trocar só a linha 54 (a que lê `engine.config.claudeConfigDir` direto):

```js
function buildSessionScriptMac(engine, slash, id, user) {
  const stub = process.env.FAROL_REVIEW_CMD;
  const skip = engine.config.skipPermissions ? ' --dangerously-skip-permissions' : '';
  const claudeLine = stub ? `${stub} '${slash}'` : `claude${skip} '${slash}'`;
  const acc = user || engine.primaryUser();
  const userArg = acc ? ` --user '${acc}'` : '';
  const claudeDir = engine.resolveClaudeConfigDir(user);
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
    claudeDir ? `export CLAUDE_CONFIG_DIR='${claudeDir}'` : '# sem config dir proprio',
    `GH_TOKEN="$(gh auth token${userArg} 2>/dev/null)" && export GH_TOKEN`,
    claudeLine,
    'echo',
    'echo " [Farol] Sessao encerrada. Pode fechar esta janela."'
  ].join('\n') + '\n';
}
```

Nota: passa `user` (não `acc`) pro resolver — `user` é o login GitHub cru; `acc` só existe pra ter um fallback de exibição/`--user` do `gh`, mas `resolveClaudeConfigDir(undefined)` já cai certinho no padrão global/legado (testado na Task 1), então não precisa do fallback aqui.

- [ ] **Step 5: Repassar `account` em `spawnConsole` (Windows) e na fachada da Engine**

Em `lib/engine/session.js:91-96` (dentro de `spawnConsole`), trocar a linha 96:

```js
  fs.writeFileSync(script, engine.buildSessionScript(slash, account));
```

Em `server.js:670`, trocar a fachada:

```js
  buildSessionScript(slash, account) { return sessionMod.buildSessionScript(this, slash, account); }
```

(linha 671, `buildSessionScriptMac`, já recebe e repassa `user` corretamente — não muda.)

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `node --test test/session-claude-profile.test.js`
Expected: PASS (4 testes).

- [ ] **Step 7: Rodar a suíte inteira**

Run: `node --test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server.js lib/engine/session.js test/session-claude-profile.test.js
git commit -m "feat: sessao de terminal (Windows/mac) respeita o perfil Claude por conta"
```

---

### Task 4: `claudeAuthInfo(dir)` parametrizado + `allClaudeAuthInfo()` + `doctor()`

**Files:**
- Modify: `server.js:820-859` (`claudeAuthInfo`, novo `allClaudeAuthInfo`, `doctor`)
- Test: `test/claude-profiles.test.js` (adicionar testes)

**Interfaces:**
- Consumes: nada de tasks anteriores diretamente (independe do resolver — lê disco).
- Produces: `Engine.claudeAuthInfo(dir?: string): {configDir, account, ready}` — parâmetro `dir` opcional; sem argumento (`undefined`), comportamento idêntico ao de hoje (lê `this.config.claudeConfigDir`); com `dir` explícito (inclusive `''`), checa exatamente aquele caminho. `Engine.allClaudeAuthInfo(): Array<{id, label, configDir, account, ready}>` — usado pela Task 9 (badges) e por `doctor()`.
- Produces: `doctorInfo.claudeAuth` passa a ser um ARRAY (era objeto único) — breaking change de shape, tratado na Task 9 (`buildDiagnostics` em `ui/app.js`).

- [ ] **Step 1: Escrever o teste (ainda falhando)**

Adicionar ao final de `test/claude-profiles.test.js`:

```js
const fsMod = require('node:fs');

test('claudeAuthInfo: sem argumento, comportamento legado (lê config.claudeConfigDir)', () => {
  const engine = new Engine();
  engine.config.claudeConfigDir = '';
  const info = engine.claudeAuthInfo();
  assert.equal(info.configDir, null);
  assert.equal(info.ready, true); // sem dir próprio, assume ok (padrão da máquina)
});

test('claudeAuthInfo: dir explícito sem .credentials.json reporta SEM LOGIN', () => {
  const engine = new Engine();
  const dir = path.join(HOME, 'perfil-sem-login');
  fsMod.mkdirSync(dir, { recursive: true });
  const info = engine.claudeAuthInfo(dir);
  assert.equal(info.configDir, dir);
  assert.equal(info.ready, false);
  assert.equal(info.account, null);
});

test('claudeAuthInfo: dir explícito com .credentials.json reporta ready', () => {
  const engine = new Engine();
  const dir = path.join(HOME, 'perfil-logado');
  fsMod.mkdirSync(dir, { recursive: true });
  fsMod.writeFileSync(path.join(dir, '.credentials.json'), '{}');
  fsMod.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'x@biud.com.br' } }));
  const info = engine.claudeAuthInfo(dir);
  assert.equal(info.ready, true);
  assert.equal(info.account, 'x@biud.com.br');
});

test('allClaudeAuthInfo: sem profiles, devolve 1 entrada sintética "Padrão"', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [];
  const all = engine.allClaudeAuthInfo();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, '');
  assert.equal(all[0].label, 'Padrão');
});

test('allClaudeAuthInfo: com profiles, devolve 1 entrada por perfil, na ordem', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [
    { id: 'a', label: 'A', dir: path.join(HOME, 'a') },
    { id: 'b', label: 'B', dir: path.join(HOME, 'b') }
  ];
  const all = engine.allClaudeAuthInfo();
  assert.deepEqual(all.map(x => x.id), ['a', 'b']);
  assert.deepEqual(all.map(x => x.label), ['A', 'B']);
  assert.equal(all[0].configDir, path.join(HOME, 'a'));
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/claude-profiles.test.js`
Expected: FAIL — `claudeAuthInfo(dir)` ainda ignora o argumento (só lê `this.config.claudeConfigDir`), e `allClaudeAuthInfo` não existe.

- [ ] **Step 3: Alterar `claudeAuthInfo` e adicionar `allClaudeAuthInfo`**

Em `server.js:820-834`, substituir o método inteiro e adicionar o novo logo depois:

```js
  // --- diagnostico de pre-requisitos ---
  // assinatura do Claude que as sessões do Farol usam (best-effort, sem segredo):
  // qual config dir e qual conta OAuth está logada ali, pra o doctor/badges mostrarem.
  // Sem argumento, mantém o comportamento legado (lê o claudeConfigDir global); passe um
  // dir explícito (inclusive '') pra checar um perfil específico (ver allClaudeAuthInfo).
  claudeAuthInfo(dir) {
    const d = (dir != null ? dir : (this.config.claudeConfigDir || '')).trim();
    const jsonPath = d ? path.join(d, '.claude.json') : path.join(os.homedir(), '.claude.json');
    const info = { configDir: d || null, account: null, ready: true };
    try {
      const j = readJson(jsonPath, {});
      info.account = (j && j.oauthAccount && j.oauthAccount.emailAddress) || null;
      // dir próprio precisa do login feito (credencial OAuth). A padrão a gente assume ok.
      if (d) info.ready = fs.existsSync(path.join(d, '.credentials.json')) || !!info.account;
    } catch { /* best-effort */ }
    return info;
  }

  // status de TODOS os perfis salvos (mais um sintético "Padrão" quando não há nenhum),
  // pro doctor e pros badges de conta/perfil na UI.
  allClaudeAuthInfo() {
    const profiles = this.config.claudeProfiles || [];
    if (!profiles.length) return [{ id: '', label: 'Padrão', ...this.claudeAuthInfo() }];
    return profiles.map(p => ({ id: p.id, label: p.label, ...this.claudeAuthInfo(p.dir) }));
  }
```

- [ ] **Step 4: Alterar `doctor()` pra usar `allClaudeAuthInfo()`**

Em `server.js:836-859`, trocar a linha 853:

```js
      claudeAuth: this.allClaudeAuthInfo(), // status de cada perfil de assinatura Claude salvo
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `node --test test/claude-profiles.test.js`
Expected: PASS (todos os testes da Task 1 + Task 2 + Task 4).

- [ ] **Step 6: Rodar a suíte inteira**

Run: `node --test`
Expected: PASS — atenção especial a `http.test.js` (bate em `/api/doctor` de verdade); se algum teste existente comparar `doctorInfo.claudeAuth` como objeto, precisa ajustar pra array (buscar por `claudeAuth` em `test/*.js` antes deste step: `grep -rn claudeAuth test/`).

- [ ] **Step 7: Commit**

```bash
git add server.js test/claude-profiles.test.js
git commit -m "feat: claudeAuthInfo parametrizado + allClaudeAuthInfo pro doctor/badges"
```

---

### Task 5: persistência — `claudeProfiles`/`claudeProfileId` em `updateSettings`, `accounts[].claudeProfileId` em `parseAccounts`/`accountList`/`snapshot`

**Files:**
- Modify: `lib/parse.js:53-87` (`parseAccounts`)
- Modify: `server.js:307-332` (`accountList`)
- Modify: `server.js:861-895` (`updateSettings`)
- Modify: `server.js:897-935` (`snapshot`)
- Test: `test/pure.test.js` (adicionar teste de `parseAccounts`)
- Test: `test/claude-profiles.test.js` (adicionar testes de round-trip via `updateSettings`)

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `parseAccounts` normaliza `claudeProfileId` (string, só quando não-vazio) em cada conta. `accountList()` e `snapshot()` propagam esse campo até o front. `updateSettings` aceita `claudeProfiles` (array de `{id,label,dir}`, filtrando entradas sem `id`/`dir`) e `claudeProfileId` (string) no patch.

- [ ] **Step 1: Escrever o teste de `parseAccounts` (ainda falhando)**

Adicionar ao final de `test/pure.test.js` (depois do teste `'parseAccounts: valores de política inválidos são ignorados'`):

```js
test('parseAccounts: claudeProfileId é preservado quando presente e string não-vazia', () => {
  const out = parseAccounts([
    { user: 'a', owners: [], claudeProfileId: 'trabalho' },
    { user: 'b', owners: [], claudeProfileId: '' },
    { user: 'c', owners: [] }
  ]);
  assert.equal(out[0].claudeProfileId, 'trabalho');
  assert.equal('claudeProfileId' in out[1], false);
  assert.equal('claudeProfileId' in out[2], false);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/pure.test.js`
Expected: FAIL — `out[0].claudeProfileId` é `undefined` (campo ainda não normalizado).

- [ ] **Step 3: Alterar `parseAccounts` em `lib/parse.js`**

Em `lib/parse.js:62-73` (bloco `if (meta) { ... }` dentro de `norm`), adicionar a linha de `claudeProfileId` junto das outras políticas por conta:

```js
    if (meta) {
      if (meta.label != null && String(meta.label).trim()) o.label = String(meta.label).trim();
      if (meta.color != null && String(meta.color).trim()) o.color = String(meta.color).trim();
      if (meta.kind != null && String(meta.kind).trim()) o.kind = String(meta.kind).trim();
      if (meta.muted) o.muted = true;
      // política de automação por conta (só quando definida; ausente = herda o global):
      //  autoReview bool; onClean/onCaveats = 'approve' | 'wait'; onReject = 'request_changes' | 'wait'
      if (meta.autoReview === true || meta.autoReview === false) o.autoReview = meta.autoReview;
      if (meta.onClean === 'approve' || meta.onClean === 'wait') o.onClean = meta.onClean;
      if (meta.onCaveats === 'approve' || meta.onCaveats === 'wait') o.onCaveats = meta.onCaveats;
      if (meta.onReject === 'request_changes' || meta.onReject === 'wait') o.onReject = meta.onReject;
      // perfil de assinatura Claude desta conta (id de config.claudeProfiles). Ausente/vazio
      // = herda o claudeProfileId global do Farol (ver Engine.resolveClaudeConfigDir).
      if (meta.claudeProfileId != null && String(meta.claudeProfileId).trim()) o.claudeProfileId = String(meta.claudeProfileId).trim();
    }
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/pure.test.js`
Expected: PASS.

- [ ] **Step 5: Propagar em `accountList()`**

Em `server.js:307-332`, adicionar `claudeProfileId` no primeiro `.map` (linha 310-322):

```js
  accountList() {
    const raw = Array.isArray(this.config.accounts) ? this.config.accounts : [];
    let base = raw
      .map(a => ({
        user: String((a && a.user) || '').trim(),
        owners: Array.isArray(a && a.owners) ? a.owners.map(String).map(s => s.trim()).filter(Boolean) : [],
        label: (a && a.label != null) ? String(a.label).trim() : '',
        color: (a && a.color != null) ? String(a.color).trim() : '',
        kind: (a && a.kind != null) ? String(a.kind).trim() : '',
        muted: !!(a && a.muted),
        // política de automação por conta (undefined = herda o global)
        autoReview: (a && (a.autoReview === true || a.autoReview === false)) ? a.autoReview : undefined,
        onClean: (a && (a.onClean === 'approve' || a.onClean === 'wait')) ? a.onClean : undefined,
        onCaveats: (a && (a.onCaveats === 'approve' || a.onCaveats === 'wait')) ? a.onCaveats : undefined,
        onReject: (a && (a.onReject === 'request_changes' || a.onReject === 'wait')) ? a.onReject : undefined,
        // perfil de assinatura Claude desta conta (undefined = herda o global/legado)
        claudeProfileId: (a && a.claudeProfileId != null && String(a.claudeProfileId).trim()) ? String(a.claudeProfileId).trim() : undefined
      }))
      .filter(a => a.user);
    if (!base.length) base = [{ user: (this.config.ghUser || '').trim(), owners: this.config.owners || [], label: '', color: '', kind: '', muted: false }];
    // preenche defaults de identidade: rótulo = login (ou org), cor estável por índice
    return base.map((a, i) => ({
      ...a,
      label: a.label || a.user || a.owners[0] || 'conta',
      color: a.color || ACCOUNT_PALETTE[i % ACCOUNT_PALETTE.length],
      muted: !!a.muted
    }));
  }
```

(o segundo `.map`, linhas 326-331, já preserva `claudeProfileId` via spread `...a` — não precisa mudar.)

- [ ] **Step 6: Adicionar `claudeProfiles`/`claudeProfileId` em `updateSettings`**

Em `server.js:861-895`, trocar o array `allowed` (linhas 862-864) e adicionar a normalização:

```js
  updateSettings(patch) {
    const allowed = ['ghUser', 'owners', 'accounts', 'intervalSeconds', 'autoReview', 'autoApproveAll', 'skipPermissions',
      'soundEnabled', 'theme', 'autostart', 'updateSource', 'updateRepo', 'mergeBlockedRepos',
      'projectReviewers', 'defaultReviewers', 'people', 'claudeConfigDir', 'claudeProfiles', 'claudeProfileId',
      'reviewModel', 'autoPushback', 'debugSpawns'];
    let intervalChanged = false, userChanged = false;
    for (const k of allowed) {
      if (!(k in patch)) continue;
      let v = patch[k];
      if (k === 'intervalSeconds') { v = Math.min(3600, Math.max(60, parseInt(v, 10) || DEFAULTS.intervalSeconds)); intervalChanged = true; }
      if (k === 'owners') v = Array.isArray(v) ? v.map(s => String(s).trim()).filter(Boolean) : String(v).split(/[,;\s]+/).filter(Boolean);
      if (k === 'mergeBlockedRepos') v = Array.isArray(v) ? v.map(s => String(s).trim()).filter(Boolean) : String(v).split(/[,;\s]+/).filter(Boolean);
      if (k === 'projectReviewers') v = parseProjectReviewers(v);
      if (k === 'defaultReviewers') v = parseDefaultReviewers(v);
      if (k === 'people') v = parsePeople(v);
      if (k === 'claudeConfigDir') v = String(v || '').trim();
      // perfis nomeados de assinatura Claude: [{id,label,dir}]. Descarta entradas sem
      // id ou sem dir (perfil incompleto não serve pra nada, ver resolveClaudeConfigDir).
      if (k === 'claudeProfiles') {
        v = Array.isArray(v) ? v.map(p => ({
          id: String((p && p.id) || '').trim(),
          label: String((p && p.label) || '').trim(),
          dir: String((p && p.dir) || '').trim()
        })).filter(p => p.id && p.dir) : [];
      }
      if (k === 'claudeProfileId') v = String(v || '').trim();
      if (k === 'reviewModel') { v = String(v || '').trim().toLowerCase(); if (!['', 'sonnet', 'haiku', 'opus'].includes(v)) v = this.config.reviewModel; }
      if (k === 'autoPushback') v = !!v;
      if (k === 'debugSpawns') v = !!v;
      if (k === 'accounts') {
        v = parseAccounts(v);
        // só re-autentica se as CONTAS (user/owners) mudaram; editar rótulo, cor,
        // tipo ou silenciar não mexe em token, então não força um re-login/re-check.
        const sig = arr => JSON.stringify((arr || []).map(a => [String(a.user).toLowerCase(), (a.owners || []).map(o => String(o).toLowerCase()).sort()]));
        if (sig(v) !== sig(this.config.accounts)) userChanged = true;
      }
      if (k === 'ghUser') { v = String(v).trim(); userChanged = userChanged || v !== this.config.ghUser; }
      this.config[k] = v;
    }
    process.env.FAROL_DEBUG_SPAWNS = this.config.debugSpawns ? '1' : ''; // liga/desliga o logger na hora
    this.saveConfig();
    if (userChanged) { this.token = null; this.tokenOk = false; this.tokens = {}; }
    if (intervalChanged || userChanged) this.checkNow();
    this.emit('settings-changed', this.config);
    this.pushState();
  }
```

- [ ] **Step 7: Propagar em `snapshot()`**

Em `server.js:903-907`, adicionar `claudeProfileId` no objeto remapeado:

```js
      accounts: this.accountList().map((a, i) => ({
        user: a.user, owners: a.owners, tokenOk: !!(this.tokens && this.tokens[a.user]),
        label: a.label, color: a.color, kind: a.kind, muted: !!a.muted, primary: i === 0,
        autoReview: a.autoReview, onClean: a.onClean, onCaveats: a.onCaveats, onReject: a.onReject,
        claudeProfileId: a.claudeProfileId
      })),
```

- [ ] **Step 8: Escrever teste de round-trip (ainda falhando antes do Step 6, agora deve passar)**

Adicionar ao final de `test/claude-profiles.test.js`:

```js
test('updateSettings: persiste claudeProfiles e claudeProfileId globais', () => {
  const engine = new Engine();
  engine.updateSettings({
    claudeProfiles: [
      { id: 'trabalho', label: 'BIUD Trabalho', dir: 'C:\\biud-trabalho' },
      { id: 'sem-dir', label: 'Incompleto', dir: '' } // descartado (sem dir)
    ],
    claudeProfileId: 'trabalho'
  });
  assert.deepEqual(engine.config.claudeProfiles, [{ id: 'trabalho', label: 'BIUD Trabalho', dir: 'C:\\biud-trabalho' }]);
  assert.equal(engine.config.claudeProfileId, 'trabalho');
});

test('updateSettings: persiste claudeProfileId por conta via accounts[]', () => {
  const engine = new Engine();
  engine.updateSettings({
    accounts: [{ user: 'bob', owners: ['biudtech'], claudeProfileId: 'trabalho' }]
  });
  assert.equal(engine.config.accounts[0].claudeProfileId, 'trabalho');
  assert.equal(engine.accountList()[0].claudeProfileId, 'trabalho');
  const snap = engine.snapshot();
  assert.equal(snap.accounts[0].claudeProfileId, 'trabalho');
});
```

- [ ] **Step 9: Rodar tudo e confirmar que passa**

Run: `node --test`
Expected: PASS (suíte inteira).

- [ ] **Step 10: Commit**

```bash
git add lib/parse.js server.js test/pure.test.js test/claude-profiles.test.js
git commit -m "feat: persistencia de claudeProfiles/claudeProfileId (global e por conta)"
```

---

### Task 6: UI — gerenciador de perfis substitui o campo texto único

**Files:**
- Modify: `ui/index.html:279-283` (remove o campo `#setClaudeConfigDir`, adiciona container novo)
- Modify: `ui/app.js` (nova função `renderClaudeProfiles()`, chamada de `renderSettings()`, listeners de add/remove/editar perfil e do dropdown de padrão global)

**Interfaces:**
- Consumes: `STATE.config.claudeProfiles`, `STATE.config.claudeProfileId`, `STATE.config.claudeConfigDir` (legado, só pra migração), `PATCH /api/settings` (já existe, `server.js:93` em `lib/http-server.js`).
- Produces: função `renderClaudeProfiles()` chamada de `renderSettings()` (perto de `setIf($('#setClaudeConfigDir'), ...)`, que é removida) e de `switchTab('sistema')` (`ui/app.js:524`, junto de `renderAccountsManager()`).

- [ ] **Step 1: Trocar o markup em `ui/index.html`**

Em `ui/index.html:279-283`, substituir:

```html
      <div class="field">
        <label for="setClaudeConfigDir">Assinatura do Claude (diretório de config)</label>
        <input id="setClaudeConfigDir" type="text" spellcheck="false" placeholder="ex.: C:\Users\voce\.claude-pessoal">
        <small>Vazio usa o login padrão do <code>claude</code> da máquina. Apontando um diretório próprio (logado em outra conta), as sessões do Farol passam a usar aquela assinatura, sem mexer no seu <code>claude</code> principal. Faça <code>claude login</code> nesse diretório uma vez antes; a conta em uso aparece em Saúde. Alternar de assinatura é trocar este caminho.</small>
      </div>
```

por:

```html
      <div class="field">
        <label>Perfis de assinatura do Claude</label>
        <div id="claudeProfilesManager" class="cards"></div>
        <small>Cada perfil aponta pra um diretório de config próprio. Faça <code>claude login</code> nesse diretório uma vez, FORA do Farol (ex.: <code>$env:CLAUDE_CONFIG_DIR="C:\caminho"; claude login</code>), antes de usá-lo aqui — o Farol nunca loga por você. O perfil padrão vale pra toda conta do GitHub que não tiver um perfil próprio (dropdown na conta, seção Contas acima). Sem nenhum perfil salvo, o Farol usa o login padrão da máquina.</small>
      </div>
```

- [ ] **Step 2: Adicionar `renderClaudeProfiles()` em `ui/app.js`**

Logo depois da função `renderAccountsManager()` (que termina em `ui/app.js:349`), adicionar:

```js
// Gerenciador de perfis de assinatura Claude (Sistema): cada perfil é {id,label,dir}.
// Perfil padrão global + perfis salvos, cada um com o e-mail logado (badge, via doctor).
function claudeAuthBadge(id) {
  const all = (STATE.doctor && STATE.doctor.claudeAuth) || [];
  const info = all.find(x => x.id === id) || all.find(x => x.id === '') || null;
  if (!info) return '';
  if (info.ready === false) return `<span class="a-claude bad" title="rode claude login nesse diretório">SEM LOGIN</span>`;
  if (info.account) return `<span class="a-claude ok" title="${esc(info.configDir || 'padrão da máquina')}">@${esc(info.account)}</span>`;
  return `<span class="a-claude" title="${esc(info.configDir || 'padrão da máquina')}">${info.configDir ? 'logada' : 'padrão da máquina'}</span>`;
}

function genProfileId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function saveClaudeProfiles(profiles) {
  STATE.config.claudeProfiles = profiles;
  api('/api/settings', { claudeProfiles: profiles });
}

function renderClaudeProfiles() {
  const box = $('#claudeProfilesManager'); if (!box) return;
  if (document.activeElement && box.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  const c = STATE.config || {};
  const profiles = c.claudeProfiles || [];
  // migração: legado preenchido e nenhum perfil salvo ainda -> oferece virar o primeiro perfil
  const migrateCard = (!profiles.length && c.claudeConfigDir) ? `<div class="card acct-add">
    <div class="a-add-title">Perfil atual detectado</div>
    <div class="a-hint">Você já tem um diretório configurado: <code>${esc(c.claudeConfigDir)}</code>. Salvar como o primeiro perfil?</div>
    <div class="a-editrow">
      <input id="claudeMigrateLabel" placeholder="nome do perfil" value="Perfil atual" spellcheck="false">
      <button class="btn sm" id="btnClaudeMigrate">Salvar como perfil</button>
    </div>
  </div>` : '';
  const defaultOptions = [`<option value="">Padrão da máquina</option>`]
    .concat(profiles.map(p => `<option value="${esc(p.id)}"${c.claudeProfileId === p.id ? ' selected' : ''}>${esc(p.label)}</option>`))
    .join('');
  const defaultRow = `<div class="card">
    <div class="a-editrow">
      <span class="a-fieldlabel">perfil padrão do Farol</span>
      <select id="claudeProfileDefault">${defaultOptions}</select>
    </div>
  </div>`;
  const rows = profiles.map(p => `<div class="card acct-card">
    <div class="a-body">
      <div class="a-editrow">
        <input class="cp-label" data-id="${esc(p.id)}" value="${esc(p.label)}" placeholder="nome do perfil" spellcheck="false">
        ${claudeAuthBadge(p.id)}
      </div>
      <div class="a-editrow">
        <input class="cp-dir" data-id="${esc(p.id)}" value="${esc(p.dir)}" placeholder="C:\\Users\\voce\\.claude-perfil" spellcheck="false">
      </div>
    </div>
    <div class="a-actions">
      <button class="btn sm danger-ghost cp-remove" data-id="${esc(p.id)}">Remover</button>
    </div>
  </div>`).join('');
  const addForm = `<div class="card acct-add">
    <div class="a-add-title">Adicionar perfil</div>
    <div class="a-editrow">
      <input id="cpAddLabel" placeholder="nome (ex.: BIUD Trabalho)" spellcheck="false">
      <input id="cpAddDir" placeholder="diretório de config (ex.: C:\\Users\\voce\\.claude-biud-trabalho)" spellcheck="false">
      <button class="btn sm" id="btnCpAdd">Adicionar</button>
    </div>
  </div>`;
  box.innerHTML = migrateCard + defaultRow + rows + addForm;
}
```

- [ ] **Step 3: Wire os listeners (add / remover / editar perfil / migrar / padrão global)**

Junto dos outros listeners de `#accountsManager` (perto de `ui/app.js:439-451`), adicionar:

```js
$('#claudeProfilesManager').addEventListener('click', (e) => {
  const t = e.target;
  if (t.id === 'btnCpAdd') {
    const label = ($('#cpAddLabel').value || '').trim();
    const dir = ($('#cpAddDir').value || '').trim();
    if (!label || !dir) return toast('error', 'Preencha nome e diretório do perfil.', 3000);
    const profiles = [...(STATE.config.claudeProfiles || []), { id: genProfileId(), label, dir }];
    $('#cpAddLabel').value = ''; $('#cpAddDir').value = '';
    saveClaudeProfiles(profiles);
    return;
  }
  if (t.classList.contains('cp-remove')) {
    const id = t.dataset.id;
    const profiles = (STATE.config.claudeProfiles || []).filter(p => p.id !== id);
    saveClaudeProfiles(profiles);
    return;
  }
  if (t.id === 'btnClaudeMigrate') {
    const label = ($('#claudeMigrateLabel').value || '').trim() || 'Perfil atual';
    const profiles = [{ id: genProfileId(), label, dir: STATE.config.claudeConfigDir }];
    saveClaudeProfiles(profiles);
    return;
  }
});
$('#claudeProfilesManager').addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'claudeProfileDefault') {
    STATE.config.claudeProfileId = t.value;
    return api('/api/settings', { claudeProfileId: t.value });
  }
  if (t.classList.contains('cp-label') || t.classList.contains('cp-dir')) {
    const id = t.dataset.id;
    const profiles = (STATE.config.claudeProfiles || []).map(p => p.id === id
      ? { ...p, label: t.classList.contains('cp-label') ? t.value.trim() || p.label : p.label,
              dir: t.classList.contains('cp-dir') ? t.value.trim() : p.dir }
      : p);
    saveClaudeProfiles(profiles);
  }
});
```

- [ ] **Step 4: Remover o campo legado de `renderSettings()` e `settingsMap`, e chamar `renderClaudeProfiles()`**

Em `ui/app.js:2147`, remover a linha:

```js
  setIf($('#setClaudeConfigDir'), c.claudeConfigDir || '');
```

e, na mesma função (`renderSettings`, depois de `renderReviewersEditor();`), adicionar:

```js
  renderClaudeProfiles();
```

Em `ui/app.js:2407` (array `settingsMap`), remover a linha:

```js
  ['#setClaudeConfigDir', 'claudeConfigDir', el => el.value],
```

Em `ui/app.js:524` (`switchTab`/dispatcher da aba Sistema), adicionar `renderClaudeProfiles()` junto dos demais:

```js
  if (name === 'sistema') { loadLog(); renderDoctor(); renderAccountsManager(); renderClaudeProfiles(); loadReviewerCands(); }
```

E em `ui/app.js:2435` (re-render reativo quando a aba Sistema está ativa):

```js
    if ($('#tab-sistema').classList.contains('active')) { renderDoctor(); renderAccountsManager(); renderClaudeProfiles(); }
```

- [ ] **Step 5: Checar sintaxe**

Run: `node --check ui/app.js`
Expected: sem erro (saída vazia).

Run: `npm run check` (roda `node --check` em `server.js`, `main.js` e `ui/app.js`)
Expected: sem erro.

- [ ] **Step 6: Verificação manual no navegador**

Suba o Farol numa instância isolada (`FAROL_HOME=/tmp/farol-teste-perfis node server.js`, porta default 47170 — se já tiver outra instância rodando, escreva antes `{"port": 47180, "autoReview": false}` em `/tmp/farol-teste-perfis/config.json`), abra a aba Sistema, confirme:
- O card "Perfis de assinatura do Claude" aparece com o dropdown "Padrão da máquina" e o formulário "Adicionar perfil".
- Adicionar um perfil (nome + qualquer caminho) salva e aparece na lista, com um badge (mesmo que "SEM LOGIN", já que o diretório de teste não tem credencial).
- Remover o perfil funciona.
- Trocar o dropdown "perfil padrão do Farol" persiste (recarregar a página mantém a seleção).

- [ ] **Step 7: Commit**

```bash
git add ui/index.html ui/app.js
git commit -m "feat: UI do gerenciador de perfis de assinatura Claude"
```

---

### Task 7: UI — dropdown "Perfil Claude" por conta GitHub

**Files:**
- Modify: `ui/app.js:281-349` (`renderAccountsManager`, adiciona o select)
- Modify: `ui/app.js:253-262` (`accountSaveArray`, inclui `claudeProfileId`)
- Modify: `ui/app.js:439-451` (listener de `change` do `#accountsManager`)

**Interfaces:**
- Consumes: `STATE.config.claudeProfiles` (Task 6), `STATE.accounts[].claudeProfileId` (Task 5), `claudeAuthBadge(id)` (Task 6).
- Produces: nenhuma interface nova pra outras tasks — fecha o ciclo de UI de contas.

- [ ] **Step 1: Adicionar o select na renderização de cada conta**

Em `ui/app.js:281-349`, dentro do bloco `.a-policy` (logo depois do `<div class="a-pol-item">` de "quando tem bloqueios", antes do fechamento `</div>` do `.a-policy`), adicionar:

```js
          <div class="a-pol-item"><span class="a-fieldlabel">perfil Claude</span>
            <select class="acct-claudeprofile" data-user="${esc(a.user)}" title="Assinatura Claude usada nas sessões desta conta">
              <option value="">usa o perfil padrão do Farol</option>
              ${(STATE.config.claudeProfiles || []).map(p => `<option value="${esc(p.id)}"${a.claudeProfileId === p.id ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}
            </select>
            ${claudeAuthBadge(a.claudeProfileId || STATE.config.claudeProfileId || '')}
          </div>
```

(o helper `claudeAuthBadge` já existe da Task 6.)

- [ ] **Step 2: Incluir `claudeProfileId` em `accountSaveArray`**

Em `ui/app.js:253-262`, trocar:

```js
function accountSaveArray(list) {
  return (list || []).map(a => {
    const o = { user: a.user, owners: a.owners || [], label: a.label, color: a.color, kind: a.kind || '', muted: !!a.muted };
    if (a.autoReview === true || a.autoReview === false) o.autoReview = a.autoReview;
    if (a.onClean === 'approve' || a.onClean === 'wait') o.onClean = a.onClean;
    if (a.onCaveats === 'approve' || a.onCaveats === 'wait') o.onCaveats = a.onCaveats;
    if (a.onReject === 'request_changes' || a.onReject === 'wait') o.onReject = a.onReject;
    if (a.claudeProfileId) o.claudeProfileId = a.claudeProfileId;
    return o;
  });
}
```

- [ ] **Step 3: Wire o listener de `change`**

Em `ui/app.js:439-451`, adicionar mais uma linha no bloco existente:

```js
$('#accountsManager').addEventListener('change', (e) => {
  const t = e.target, user = t.dataset && t.dataset.user;
  if (!user) return;
  if (t.classList.contains('acct-color')) return editAccount(user, { color: t.value });
  if (t.classList.contains('acct-label')) return editAccount(user, { label: (t.value || '').trim() || user });
  if (t.classList.contains('acct-kind')) return editAccount(user, { kind: (t.value || '').trim() });
  if (t.classList.contains('acct-owners')) return editAccount(user, { owners: (t.value || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean) });
  // política de automação por conta ('' = herda o global)
  if (t.classList.contains('acct-autoreview')) return editAccount(user, { autoReview: t.value === '' ? undefined : t.value === 'on' });
  if (t.classList.contains('acct-onclean')) return editAccount(user, { onClean: t.value || undefined });
  if (t.classList.contains('acct-oncaveats')) return editAccount(user, { onCaveats: t.value || undefined });
  if (t.classList.contains('acct-onreject')) return editAccount(user, { onReject: t.value === 'request_changes' ? 'request_changes' : undefined });
  if (t.classList.contains('acct-claudeprofile')) return editAccount(user, { claudeProfileId: t.value || undefined });
});
```

- [ ] **Step 4: Checar sintaxe**

Run: `node --check ui/app.js`
Expected: sem erro.

- [ ] **Step 5: Verificação manual no navegador**

Na mesma instância isolada da Task 6, com pelo menos 2 contas configuradas (`accounts` no `config.json` de teste), abra Sistema:
- Cada card de conta mostra o novo campo "perfil Claude" com um dropdown.
- Selecionar um perfil salvo (criado na Task 6) persiste (recarregar mantém a seleção) e o badge ao lado reflete o status daquele perfil.
- Deixar em "usa o perfil padrão do Farol" some o override (grava `undefined`, ou seja, a chave nem aparece no `config.json` daquela conta).

- [ ] **Step 6: Commit**

```bash
git add ui/app.js
git commit -m "feat: dropdown de perfil Claude por conta GitHub, com badge de status"
```

---

### Task 8: atualizar `buildDiagnostics()` pro novo shape de array

**Files:**
- Modify: `ui/app.js:2231-2260` (`buildDiagnostics`, trecho da linha "assinatura Claude")

**Interfaces:**
- Consumes: `STATE.doctor.claudeAuth` (Task 4) — agora array, não objeto único.

- [ ] **Step 1: Alterar a linha do diagnóstico**

Em `ui/app.js:2249`, trocar:

```js
    `  assinatura Claude: ${d.claudeAuth ? ((d.claudeAuth.configDir ? 'dir próprio (' + d.claudeAuth.configDir + ')' : 'padrão da máquina') + (d.claudeAuth.account ? ' · conta ' + d.claudeAuth.account : '') + (d.claudeAuth.ready === false ? ' · SEM LOGIN (rode: claude login nesse dir)' : '')) : '?'}`,
```

por (uma linha por perfil, já que agora é array):

```js
    ...((d.claudeAuth || []).map(p =>
      `  assinatura Claude${p.label ? ' [' + p.label + ']' : ''}: ${(p.configDir ? 'dir próprio (' + p.configDir + ')' : 'padrão da máquina') + (p.account ? ' · conta ' + p.account : '') + (p.ready === false ? ' · SEM LOGIN (rode: claude login nesse dir)' : '')}`
    )),
```

Nota: essa linha vira parte do array literal que `buildDiagnostics` já monta com `return [...]` — o spread `...` funciona porque `buildDiagnostics` devolve um array de strings (confirmar contra o `return [` em `ui/app.js:2240` antes de aplicar; se o `return` usar `.join('\n')` diretamente numa lista sem vírgulas finais, ajustar a vírgula da linha anterior).

- [ ] **Step 2: Checar sintaxe**

Run: `node --check ui/app.js`
Expected: sem erro.

- [ ] **Step 3: Verificação manual**

Na instância de teste, Sistema > "Exportar diagnóstico", confirme que o texto gerado lista uma linha "assinatura Claude [...]" por perfil salvo (ou uma única linha "assinatura Claude: padrão da máquina" se nenhum perfil foi criado).

- [ ] **Step 4: Commit**

```bash
git add ui/app.js
git commit -m "fix: exportar diagnostico lista todos os perfis Claude, nao so um"
```

---

### Task 9: docs, changelog e versão

**Files:**
- Modify: `CLAUDE.md` (seção "Assinatura do Claude", `CLAUDE.md:87-103`)
- Modify: `CHANGELOG.md`
- Modify: `ui/app.js` (array `RELEASE_NOTES`, topo, `ui/app.js:1804`)
- Modify: `package.json` (campo `version`)

**Interfaces:**
- Não produz nem consome interfaces de código — só documentação/versionamento.

- [ ] **Step 1: Atualizar `CLAUDE.md`**

Em `CLAUDE.md:87-103` (seção inteira "Assinatura do Claude"), reescrever pra descrever o sistema de perfis como o caminho recomendado, mantendo a explicação da precedência oficial do `claude` (cloud provider → env vars → OAuth) e o aviso de que login é sempre ação manual do usuário. Preservar a nota final: "**Nunca** logar/gravar credencial pelo Claude Code em nome do usuário: o `claude login` é ação dele." Referenciar o spec: `docs/superpowers/specs/2026-07-31-perfis-claude-por-conta-design.md`.

- [ ] **Step 2: Adicionar entrada no `CHANGELOG.md`**

Seguir o formato das entradas existentes (checar as últimas 2-3 entradas do arquivo pelo padrão exato de cabeçalho de versão), descrevendo: perfis nomeados de assinatura Claude, override opcional por conta GitHub, badges de status (conta + perfil), 100% compatível com quem só usa o `claudeConfigDir` legado.

- [ ] **Step 3: Adicionar entrada no topo de `RELEASE_NOTES` (`ui/app.js:1804`)**

Seguir o padrão das entradas existentes (ex.: a entrada `'2.18.0'` já fala da feature original de assinatura única — esta nova entrada é a evolução dela, pode referenciar isso). Texto sugerido:

```js
  ['2.27.0', ['A assinatura do Claude que o Farol usa agora pode ser diferente por conta GitHub monitorada: crie perfis nomeados (ex.: "BIUD Trabalho", "Pessoal Max"), cada um apontando pro seu diretório de config próprio, e escolha um perfil padrão do Farol e, opcionalmente, um perfil específico por conta (Sistema > Contas). Sem nenhum perfil criado, nada muda: continua valendo o campo único de antes. Cada conta e cada perfil mostram um selo com o e-mail logado ali (ou "SEM LOGIN" se faltar o claude login naquele diretório).']],
```

(adicionar ANTES da entrada `['2.26.0', ...]` já existente.)

- [ ] **Step 4: Bump de versão**

Em `package.json`, trocar `"version": "2.26.1"` por `"version": "2.27.0"` (feature nova, opt-in, 100% compatível = minor, não patch — ver convenção do projeto).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md CHANGELOG.md ui/app.js package.json
git commit -m "docs: perfis de assinatura Claude por conta (v2.27.0)"
```

**Nota de escopo:** este plano NÃO corta tag nem publica release — isso é sempre uma ação explícita e separada (ver `CLAUDE.md`/convenção do projeto: publicar = cortar `hmg-v*`/tag). Bump de versão + changelog aqui é só preparação do código-fonte.

---

## Verificação final (depois da Task 9)

- [ ] Run: `node --test` — suíte inteira passa.
- [ ] Run: `npm run check` — `node --check` em `server.js`, `main.js`, `ui/app.js` sem erro.
- [ ] Verificação manual ponta-a-ponta na instância isolada: criar 2 perfis, atribuir um a cada conta, confirmar (via `console.log` temporário em `ghEnv` ou só inspecionando `resolveClaudeConfigDir` num teste ad-hoc) que uma sessão de revisão de cada conta resolveria o dir correto. NÃO abrir sessões reais de revisão contra PRs de verdade durante o teste (autoReview deve estar OFF na instância de teste, conforme constraint do projeto).
