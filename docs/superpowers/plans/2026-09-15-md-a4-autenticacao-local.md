# A4 Autenticação da API local (núcleo, sem exigência automática): plano de implementação

> **Ajustes de execução (15/09/2026, valem sobre o texto abaixo):** worktree `C:UserswandersonDocumentsarol-md-exec`; branch `md/a4` cortada da ponta de `md/integracao` (base `origin/main` `8c043bc`, que já tem a modularização de `ui/pure/`, mais as entregas do lote já integradas); sem `git fetch`/`merge origin/main`. Onde o texto manda criar ou acrescentar seção no `EXECUCAO.md`, a evidência vai para `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/evidencias-execucao/a4.md` e o `EXECUCAO.md` recebe só a linha de estado, os commits e o caminho da evidência. Dependência de "entrega mergeada na main" significa integrada em `md/integracao`. Números esperados de testes são referência: o que vale é a medição na hora.


> **Para quem executa:** use superpowers:executing-plans, tarefa por tarefa, marcando os checkboxes.

**Objetivo:** implementar o motor da autenticação da API local (detecção do modo celular, pareamento por código de uso único, sessões por token, recusa de `/api/*` sem credencial, transporte autenticado da UI e comando local de pareamento) com a **exigência automática no modo celular desligada** pela constante `ATIVACAO_AUTOMATICA_A4 = false`. A exigência só vale hoje quando `config.localAuth === 'exigir'`, e é assim que os testes a ligam. Fora do modo que exige (desktop), nada muda.

**Arquitetura:** módulos novos em `lib/local-auth/`, com uma responsabilidade por arquivo:

- `modo.js` (puro): decide se é modo celular e se a autenticação é exigida;
- `arquivo.js`: leitura e gravação restrita (0600);
- `pareamento.js`: códigos de pareamento;
- `sessoes.js`: tokens de sessão;
- `inventario.js` (puro): classe de cada rota;
- `acesso.js`: o porteiro que o `lib/http-server.js` consulta.

A leitura dos sinais do ambiente mora em `lib/paths.js` (gate `processEnvDireto` e invariante 5). A UI ganha um módulo de transporte (`ui/transporte.js`), e o `ui/app.js` recebe só a fiação. O comando `tools/farol-parear.js` imprime o código no terminal e revoga tudo. Nenhuma fachada nova em `server.js`: o porteiro não precisa de estado do engine.

**Stack:** Node >= 22.12 ESM (`node:crypto`, `node:http`, `fetch`, `ReadableStream`, `TextDecoder` e `AbortController` nativos), `node --test`, zero pacote npm.

**Spec:** `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md`, seções 4.4, 5 (CT-COMPAT, item b), 6.3, 7.A4, 7.C1a, 13 e 15.

**Dependências de outros planos:** **C1a (allowlist de Host)** tem que estar mergeada antes. Este plano CONSOME a função `validarHostEOrigem({ host, origin, porta })` de `lib/http-guard.js`, aplicada no topo do handler de `lib/http-server.js` antes do roteamento. A A4 entra logo depois dela, dentro do bloco `/api/`, depois da checagem do `x-farol`, para que `POST /api/auth/pair` herde as duas proteções (spec 7.A4, item 3). Sem a C1a na `main`, a Tarefa 0 para a execução.

**Restrições globais:**

- **Zero dependências** além do Electron (invariante 1). Nada de `npm install`.
- **Texto, comentário e commit em português, sem travessão** (invariante 6). Use vírgula, parênteses ou dois pontos.
- **Ratchet do lint não pode subir** (`tools/quality/rules.js`; arquivo novo tem teto zero em todas as regras):
  - `JSON.parse` e `JSON.stringify` só em `lib/io.js` (`io.readJson`, `io.writeJsonAtomic`, `io.parseJson`, `io.safeStringify`);
  - `process.env` só em `lib/paths.js` e `lib/env.js`;
  - tempo só em `lib/constants.js`, com nome MAIÚSCULO. A regra casa `\b(ttl|ttlMs|timeout|timeoutMs|delay|delayMs|maxAge|expiresIn)\s*:\s*\d` e `\b\d+\s*\*\s*60\s*\*\s*1000\b`, então derive de `HORA_MS`;
  - `catch` vazio só com comentário de intenção;
  - sem ternário aninhado;
  - profundidade de chaves no máximo 4 contando o corpo da função (objeto literal e desestruturação contam);
  - arquivo novo com menos de 400 linhas úteis;
  - `var` proibido;
  - a porta padrão nunca literal fora de `lib/constants.js`.
- **`ui/app.js` está no baseline de responsabilidade única** (`tools/eng-behaviour/baselines.json`, `core.file.single-responsibility|ui/app.js`): a edição dele é só fiação (um import, `api()`, `get()` e uma linha do `connect()`). Lógica nova vai para `ui/transporte.js`.
- **Testes:** `node --test --test-force-exit test/<arquivo>.test.js`. Teste que fixa `process.env.FAROL_HOME` NÃO pode importar estaticamente módulo que alcance `lib/paths.js` (`test/test-isolation.test.js`): fixe a env no topo e use `await import()`. Módulos puros sem import (`lib/local-auth/modo.js`, `lib/local-auth/inventario.js`, `lib/constants.js`, `lib/settings.js`, `ui/transporte.js`) podem ser importados estaticamente.
- **Nunca tocar o `~/.farol` real**, o GitHub nem o Firebase. Todo teste usa `FAROL_HOME` temporário.
- **Sem atribuição de IA** em commit, PR ou texto. Nada de `Co-Authored-By` nem rodapé de ferramenta.
- **Um PR por entrega** (spec, seção 15): branch `feat/a4-autenticacao-local` nascida da `main` atualizada, PR, CI verde, merge. Nunca push na `main`.
- **Âncoras de linha:** medidas em `f80394e` e conferidas idênticas em `8c043bc` (`main` de 15/09/2026) para todos os arquivos citados, exceto `tools/quality/baseline.json`. A C1a vai deslocar as linhas de `lib/http-server.js`, então **toda inserção nesse arquivo é ancorada pelo texto citado**, não pelo número.

---

## Mapa de arquivos

| Caminho | Ação | Papel |
|---|---|---|
| `lib/constants.js` | modificar (TEMPOS linhas 10-67, exports 121-122) | tempos do pareamento e da sessão em `TEMPOS`; objeto `LOCAL_AUTH`; constante `ATIVACAO_AUTOMATICA_A4 = false` |
| `lib/paths.js` | modificar (depois da linha 77; exports 79-90) | `LOCAL_AUTH_DIR` e `sinaisDoModoCelular()` (única leitura de `TERMUX_VERSION`, `PREFIX` e `/proc/sys/kernel/osrelease`) |
| `lib/settings.js` | modificar (depois da linha 78) | chave `localAuth` com `ui: false` |
| `lib/local-auth/modo.js` | criar | `detectarModoCelular`, `exigeAutenticacao` (puras) |
| `lib/local-auth/arquivo.js` | criar | `lerLista`, `gravarRestrito` (0700 no diretório, 0600 no arquivo, a cada gravação) |
| `lib/local-auth/pareamento.js` | criar | `criarCodigo`, `consumirCodigo`, `revogarCodigos`, `pareamentosPath` |
| `lib/local-auth/sessoes.js` | criar | `emitirSessao`, `verificarSessao`, `revogarTodas`, `sessoesPath` |
| `lib/local-auth/inventario.js` | criar | `CLASSES`, `PUBLICAS`, `classeDaRota`, `rotaPublicaDeAutenticacao`, `todasAsRotas` |
| `lib/local-auth/acesso.js` | criar | `recusaSemCredencial`, `statusAutenticacao`, `parear` |
| `lib/http-server.js` | modificar (import depois da linha 10; gate depois da linha 85; pareamento depois da linha 123) | fiação do porteiro e das duas rotas públicas |
| `tools/farol-parear.js` | criar | CLI: imprime código novo no stdout; `--revogar-todas` |
| `tools/make-package.ps1` | modificar (linhas 24 e 47) | leva `farol-parear.js` no pacote leve |
| `tools/make-installer.ps1` | modificar (linha 55 na `main`) | mesma whitelist no Setup.exe |
| `tools/make-offline-mac.sh` | modificar (linha 56 na `main`) | mesma whitelist no instalador offline do macOS |
| `ui/transporte.js` | criar | `tokenLocal`, `comAutorizacao`, `separarEventos`, `FonteDeEventosAutenticada` |
| `ui/app.js` | modificar (import depois da linha 22; `api()` 56-62; `get()` 63; `connect()` 4302) | fiação mínima do transporte |
| `test/local-auth-modo.test.js` | criar | detecção, exigência, constante desligada, sinais |
| `test/local-auth-config.test.js` | criar | `localAuth` fora da tela |
| `test/local-auth-pareamento.test.js` | criar | uso único, prazo, 5 erros, 0600 |
| `test/local-auth-sessoes.test.js` | criar | expiração ociosa e absoluta, revogação, hash, 0600 |
| `test/local-auth-inventario.test.js` | criar | inventário contra o fonte do servidor |
| `test/local-auth-http.test.js` | criar | recusa por classe, segredo fora de log/HTML/snapshot/URL, sem cookie, User-Agent, reinício, transporte ponta a ponta |
| `test/farol-parear.test.js` | criar | CLI, `FAROL_HOME`, revogação, pacote |
| `test/ui-transporte.test.js` | criar | transporte isolado |
| `test/ui-transporte-app.test.js` | criar | `ui/app.js` com token usa o transporte autenticado |
| `CLAUDE.md` | modificar (tabela "Mapa de arquivos") | linhas dos arquivos novos |
| `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md` | criar ou acrescentar | evidência da execução |

---

## Tarefa 0: preflight (nenhum arquivo muda)

**Arquivos:** nenhum.

- [ ] **Passo 1: branch a partir da `main` atualizada.**

```bash
git fetch origin
git switch -c feat/a4-autenticacao-local origin/main
```

- [ ] **Passo 2: a C1a precisa estar na `main`.**

```bash
git grep -n "validarHostEOrigem" -- lib/http-guard.js lib/http-server.js
```

Esperado: pelo menos uma linha em `lib/http-guard.js` (definição) e uma em `lib/http-server.js` (chamada antes de `if (p.startsWith('/api/')) {`). **Sem saída: pare.** Registre o bloqueio em `EXECUCAO.md` ("A4 aguardando a C1a") e não siga para a Tarefa 1.

- [ ] **Passo 3: âncoras de texto que este plano usa.**

```bash
git grep -n "import { triage } from './log-taxonomy.js';" -- lib/http-server.js
git grep -n "req.headers\['x-farol'\] !== '1'" -- lib/http-server.js
git grep -n "const body = await readBody(req);" -- lib/http-server.js
git grep -n "function api(path, body) {" -- ui/app.js
git grep -n "function get(path) { return fetch(path).then" -- ui/app.js
git grep -n "const es = new EventSource('/api/events');" -- ui/app.js
git grep -n "} from './pure.js';" -- ui/app.js
git grep -n "{ key: 'port', def: null, ui: false }," -- lib/settings.js
git grep -n "foreach (\$t in @('jira-mcp.js'" -- tools/make-package.ps1 tools/make-installer.ps1
git grep -n "for t in jira-mcp.js make-icons.ps1" -- tools/make-offline-mac.sh
```

Esperado: exatamente uma ocorrência em cada comando (duas no penúltimo, uma por arquivo). Se alguma faltar, a base mudou: reconfira o trecho antes de editar.

- [ ] **Passo 4: o inventário da spec continua batendo com o servidor.**

```bash
node -e "const s=require('fs').readFileSync('lib/http-server.js','utf8');console.log(new Set([...s.matchAll(/p === '(\/api\/[^']+)'/g)].map(m=>m[1])).size)"
```

Esperado: `46`. Número diferente significa rota nova ou removida depois de `f80394e`: classifique antes de seguir (a Tarefa 5 reprova sem isso).

- [ ] **Passo 5: gate verde antes de começar.**

```bash
npm run check && npm run lint && npm test
```

Esperado: os três terminam com código 0. Vermelho aqui não é desta entrega: pare e registre.

---

## Tarefa 1: constantes, sinais do ambiente e decisão do modo

**Arquivos:**
- Modificar: `lib/constants.js` (dentro de `TEMPOS`, antes do `};` da linha 67; bloco novo depois do objeto `SYNC`, linha 119; exports linhas 121-122)
- Modificar: `lib/paths.js` (depois da linha 77 `const UI_DIR = ...`; exports linhas 79-90)
- Criar: `lib/local-auth/modo.js`
- Criar: `test/local-auth-modo.test.js`

**Interfaces:**

```js
// lib/local-auth/modo.js
detectarModoCelular({ platform, env: { TERMUX_VERSION, PREFIX }, osrelease }) -> boolean
exigeAutenticacao({ modoCelular, config, ativacaoAutomatica }) -> boolean
// lib/paths.js
sinaisDoModoCelular() -> { platform: string, env: { TERMUX_VERSION: string, PREFIX: string }, osrelease: string }
LOCAL_AUTH_DIR: string  // <HOME>/local-auth
// lib/constants.js
TEMPOS.PAREAMENTO_VALIDADE_MS, TEMPOS.SESSAO_LOCAL_OCIOSA_MS, TEMPOS.SESSAO_LOCAL_ABSOLUTA_MS, TEMPOS.SESSAO_LOCAL_TOQUE_MS
LOCAL_AUTH = { CODIGO_TAMANHO, CODIGO_MAX_ERROS, TOKEN_BYTES, ROTULO_MAX }
ATIVACAO_AUTOMATICA_A4 = false
```

- [ ] **Passo 1: escrever o teste que falha.** Criar `test/local-auth-modo.test.js`:

```js
// Quem exige autenticação na API local (A4, spec 7.A4 item 1). O modo celular é
// propriedade do PROCESSO que serve a API: plataforma, variáveis do Termux e kernel.
// Nada que o cliente escreve (User-Agent) entra na decisão. Runner nativo, zero deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { detectarModoCelular, exigeAutenticacao } from '../lib/local-auth/modo.js';
import { ATIVACAO_AUTOMATICA_A4, TEMPOS, LOCAL_AUTH } from '../lib/constants.js';

const DESKTOP = { platform: 'linux', env: { TERMUX_VERSION: '', PREFIX: '' }, osrelease: '6.8.0-45-generic\n' };

test('ATIVACAO_AUTOMATICA_A4 nasce desligada', () => {
  assert.equal(ATIVACAO_AUTOMATICA_A4, false,
    'ATIVACAO_AUTOMATICA_A4 só pode virar true quando a tela de pareamento do Claude Design (D9) existir e a detecção for validada num Termux real (spec 7.A4, Condição de ativação, e seção 13). Ligada antes, o usuário do celular fica trancado fora da interface.');
});

test('os tempos e limites da A4 são os da spec', () => {
  assert.equal(TEMPOS.PAREAMENTO_VALIDADE_MS, TEMPOS.HORA_MS / 6, 'código vale 10 minutos');
  assert.equal(TEMPOS.SESSAO_LOCAL_OCIOSA_MS, 30 * TEMPOS.DIA_MS, 'sessão expira com 30 dias sem uso');
  assert.equal(TEMPOS.SESSAO_LOCAL_ABSOLUTA_MS, 90 * TEMPOS.DIA_MS, 'sessão expira com 90 dias de vida');
  assert.equal(LOCAL_AUTH.CODIGO_TAMANHO, 10);
  assert.equal(LOCAL_AUTH.CODIGO_MAX_ERROS, 5);
  assert.equal(LOCAL_AUTH.TOKEN_BYTES, 32);
});

test('cada sinal sozinho basta para o modo celular', () => {
  assert.equal(detectarModoCelular({ ...DESKTOP, platform: 'android' }), true, 'Node nativo do Termux');
  assert.equal(detectarModoCelular({ ...DESKTOP, env: { TERMUX_VERSION: '0.118.1', PREFIX: '' } }), true, 'TERMUX_VERSION');
  assert.equal(detectarModoCelular({ ...DESKTOP, env: { TERMUX_VERSION: '', PREFIX: '/data/data/com.termux/files/usr' } }), true, 'PREFIX do Termux');
  assert.equal(detectarModoCelular({ ...DESKTOP, env: { TERMUX_VERSION: '', PREFIX: '/data/data/com.termux' } }), true, 'PREFIX na raiz do Termux');
  assert.equal(detectarModoCelular({ ...DESKTOP, osrelease: '5.10.198-android12-9-00085\n' }), true, 'kernel Android no proot');
  assert.equal(detectarModoCelular({ ...DESKTOP, osrelease: '4.19.157-Android-perf\n' }), true, 'caixa do kernel não importa');
});

test('fora do celular nenhum sinal liga o modo', () => {
  assert.equal(detectarModoCelular({ platform: 'win32', env: {}, osrelease: '' }), false, 'Windows');
  assert.equal(detectarModoCelular({ platform: 'darwin', env: {}, osrelease: '' }), false, 'macOS');
  assert.equal(detectarModoCelular(DESKTOP), false, 'Linux comum');
  assert.equal(detectarModoCelular({ ...DESKTOP, osrelease: '5.15.167.4-microsoft-standard-WSL2\n' }), false, 'WSL');
  assert.equal(detectarModoCelular({ ...DESKTOP, env: { TERMUX_VERSION: '   ', PREFIX: '/data/data/com.termuxfalso/usr' } }), false, 'prefixo parecido e versão em branco não contam');
  assert.equal(detectarModoCelular(), false, 'sem sinal nenhum');
});

test('localAuth exigir liga a autenticação em qualquer ambiente', () => {
  assert.equal(exigeAutenticacao({ modoCelular: false, config: { localAuth: 'exigir' }, ativacaoAutomatica: false }), true);
  assert.equal(exigeAutenticacao({ modoCelular: true, config: { localAuth: 'exigir' }, ativacaoAutomatica: false }), true);
});

test('desktop sem localAuth não exige (nada muda)', () => {
  assert.equal(exigeAutenticacao({ modoCelular: false, config: {}, ativacaoAutomatica: true }), false);
  assert.equal(exigeAutenticacao({ modoCelular: false, config: { localAuth: '' }, ativacaoAutomatica: false }), false);
  assert.equal(exigeAutenticacao(), false);
});

test('modo celular com a ativação desligada ainda não exige (estado desta entrega)', () => {
  assert.equal(exigeAutenticacao({ modoCelular: true, config: {}, ativacaoAutomatica: false }), false);
});

test('modo celular com a ativação ligada exige, e nenhuma config desliga', () => {
  for (const config of [{}, { localAuth: '' }, { localAuth: 'desligar' }, { localAuth: false }, { localAuth: 'nunca' }, null, undefined]) {
    assert.equal(exigeAutenticacao({ modoCelular: true, config, ativacaoAutomatica: true }), true, `config ${JSON.stringify(config)} não pode desligar`);
  }
});

test('sinaisDoModoCelular devolve o formato esperado sem lançar em nenhum sistema', async () => {
  const { sinaisDoModoCelular } = await import('../lib/paths.js');
  const s = sinaisDoModoCelular();
  assert.equal(s.platform, process.platform);
  assert.equal(typeof s.env.TERMUX_VERSION, 'string');
  assert.equal(typeof s.env.PREFIX, 'string');
  assert.equal(typeof s.osrelease, 'string');
});

test('a decisão do modo nunca lê User-Agent', () => {
  const dir = path.join(import.meta.dirname, '..', 'lib', 'local-auth');
  for (const nome of fs.readdirSync(dir).filter(n => n.endsWith('.js'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(dir, nome), 'utf8'), /user-agent/i, `${nome} não pode olhar o User-Agent`);
  }
});
```

- [ ] **Passo 2: rodar e ver falhar.**

```bash
node --test --test-force-exit test/local-auth-modo.test.js
```

Esperado: falha de carga `ERR_MODULE_NOT_FOUND` para `../lib/local-auth/modo.js` (e, depois dele, `ATIVACAO_AUTOMATICA_A4` indefinido).

- [ ] **Passo 3: implementar as constantes.** Em `lib/constants.js`, dentro de `TEMPOS`, logo depois da linha `SINAL_REVISAO_TTL_MS: HORA_MS,` (linha 66) e antes do `};`:

```js
  // Autenticação da API local (A4, spec 2026-09-15-operacao-multidispositivo, 7.A4).
  // Código de pareamento: 10 minutos de vida, uso único.
  PAREAMENTO_VALIDADE_MS: HORA_MS / 6,
  // Sessão autorizada: expira com 30 dias sem uso ou 90 dias desde a criação.
  SESSAO_LOCAL_OCIOSA_MS: 30 * 24 * HORA_MS,
  SESSAO_LOCAL_ABSOLUTA_MS: 90 * 24 * HORA_MS,
  // O último uso só é regravado quando ficou mais velho que isto: sem a folga, toda
  // chamada da API reescreveria o arquivo de sessões.
  SESSAO_LOCAL_TOQUE_MS: HORA_MS,
```

Depois do fechamento do objeto `SYNC` (linha 119, `};`) e antes do `export default`:

```js
// Limites da autenticação da API local (A4). Os caminhos moram em lib/paths.js.
const LOCAL_AUTH = {
  CODIGO_TAMANHO: 10,     // caracteres base32 do código de pareamento
  CODIGO_MAX_ERROS: 5,    // tentativas erradas que invalidam o código
  TOKEN_BYTES: 32,        // bytes aleatórios do token de sessão
  ROTULO_MAX: 60,         // tamanho máximo do rótulo descritivo da sessão
};

// Exigência automática no modo celular. Nasce false e só vira true quando a tela de
// pareamento existir (Claude Design, D9) e a detecção for validada num Termux real
// (spec, seção 13). Ligada antes, a interface do celular ficaria trancada sem ter onde
// digitar o código. test/local-auth-modo.test.js trava o valor.
const ATIVACAO_AUTOMATICA_A4 = false;
```

Trocar as linhas 121-122 por:

```js
export default { DEFAULT_PORT, TEMPOS, JIRA, SYNC, LOCAL_AUTH, ATIVACAO_AUTOMATICA_A4 };
export { DEFAULT_PORT, TEMPOS, JIRA, SYNC, LOCAL_AUTH, ATIVACAO_AUTOMATICA_A4 };
```

- [ ] **Passo 4: implementar os sinais em `lib/paths.js`.** Logo depois da linha 77 (`const UI_DIR = path.join(APP_ROOT, 'ui');`):

```js
// Autenticação da API local (A4): sessões e códigos de pareamento. Fora do workspace da
// sessão de revisão, como a credencial do Jira, porque a sessão do Claude lê o workspace.
const LOCAL_AUTH_DIR = path.join(HOME, 'local-auth');

// Sinais do modo celular (A4, spec 7.A4 item 1). A leitura mora aqui por dois motivos:
// process.env só é lido em lib/paths.js e lib/env.js (gate processEnvDireto), e diferença
// de ambiente passa por este arquivo (invariante 5). Quem decide é lib/local-auth/modo.js,
// que é puro. O osrelease cobre o proot, onde as variáveis do Termux podem não chegar.
function sinaisDoModoCelular() {
  let osrelease = '';
  try { osrelease = fs.readFileSync('/proc/sys/kernel/osrelease', 'utf8'); } catch { /* fora do Linux o arquivo não existe: sinal vazio */ }
  return {
    platform: process.platform,
    env: { TERMUX_VERSION: process.env.TERMUX_VERSION || '', PREFIX: process.env.PREFIX || '' },
    osrelease,
  };
}
```

Nos dois blocos de export (linhas 79-90), acrescentar `sinaisDoModoCelular` na primeira linha e `LOCAL_AUTH_DIR` na última:

```js
export default {
  executadoDireto, rodandoComoRoot, sinaisDoModoCelular,
  APP_VERSION, APP_NAME, DELIVERIES_LIMIT, IS_WIN, IS_MAC, IS_LINUX, APP_ROOT,
  HOME, WORKSPACE, STATE_DIR, CONFIG_FILE, LOG_FILE, SEEN_FILE, IGNORED_FILE, BASELINE_FILE,
  INFLIGHT_FILE, CHATS_FILE, SELF_FILE, HIDDEN_FILE, TEMPLATE_DIR, UI_DIR, LOCAL_AUTH_DIR,
};
export {
  executadoDireto, rodandoComoRoot, sinaisDoModoCelular,
  APP_VERSION, APP_NAME, DELIVERIES_LIMIT, IS_WIN, IS_MAC, IS_LINUX, APP_ROOT,
  HOME, WORKSPACE, STATE_DIR, CONFIG_FILE, LOG_FILE, SEEN_FILE, IGNORED_FILE, BASELINE_FILE,
  INFLIGHT_FILE, CHATS_FILE, SELF_FILE, HIDDEN_FILE, TEMPLATE_DIR, UI_DIR, LOCAL_AUTH_DIR,
};
```

- [ ] **Passo 5: criar `lib/local-auth/modo.js`.**

```js
// Quem exige autenticação na API local (A4, spec 7.A4). PURO: os sinais chegam por
// parâmetro, lidos em lib/paths.js (sinaisDoModoCelular). O modo é propriedade do
// processo que serve a API, então nada que o cliente escreve entra aqui.
const PREFIXO_TERMUX = '/data/data/com.termux';

function prefixoDoTermux(prefix) {
  const p = String(prefix || '');
  return p === PREFIXO_TERMUX || p.startsWith(PREFIXO_TERMUX + '/');
}

// Um sinal basta (spec 7.A4, item 1).
function detectarModoCelular({ platform = '', env = {}, osrelease = '' } = {}) {
  if (platform === 'android') return true;
  const e = env || {};
  if (String(e.TERMUX_VERSION || '').trim()) return true;
  if (prefixoDoTermux(e.PREFIX)) return true;
  return /android/i.test(String(osrelease || ''));
}

// localAuth 'exigir' liga em qualquer ambiente. No modo celular a exigência depende SÓ da
// ativação automática: não existe ramo que leia a config para devolver false ali, e é
// isso que impede uma config de desligar a proteção do celular.
function exigeAutenticacao({ modoCelular = false, config = {}, ativacaoAutomatica = false } = {}) {
  if (config && config.localAuth === 'exigir') return true;
  return modoCelular === true && ativacaoAutomatica === true;
}

export default { detectarModoCelular, exigeAutenticacao };
export { detectarModoCelular, exigeAutenticacao };
```

- [ ] **Passo 6: rodar e ver passar.**

```bash
node --test --test-force-exit test/local-auth-modo.test.js
npm run check && npm run lint
```

Esperado: todos os testes do arquivo passam; `check` e `lint` com código 0.

- [ ] **Passo 7: contraprova.**
  1. Em `lib/constants.js`, trocar `const ATIVACAO_AUTOMATICA_A4 = false;` por `true`. Rodar o arquivo: reprova `ATIVACAO_AUTOMATICA_A4 nasce desligada`, com a mensagem citando a tela de pareamento. Restaurar `false`.
  2. Em `lib/local-auth/modo.js`, trocar `/android/i` por `/android/`. Rodar: reprova `cada sinal sozinho basta` ("caixa do kernel não importa"). Restaurar.
  3. Em `exigeAutenticacao`, acrescentar como primeira linha `if (config && config.localAuth === 'desligar') return false;`. Rodar: reprova `modo celular com a ativação ligada exige, e nenhuma config desliga`. Remover a linha.
  4. Rodar de novo e confirmar tudo verde.

- [ ] **Passo 8: commit.**

```bash
git add lib/constants.js lib/paths.js lib/local-auth/modo.js test/local-auth-modo.test.js
git commit -m "feat(local-auth): decide no servidor o modo celular e a exigencia de autenticacao"
```

---

## Tarefa 2: chave `localAuth` fora da tela

**Arquivos:**
- Modificar: `lib/settings.js` (depois da linha 78, `{ key: 'port', def: null, ui: false },`)
- Criar: `test/local-auth-config.test.js`

**Interfaces:** `defaults(port).localAuth === ''`; `EDITAVEIS.has('localAuth') === false`.

- [ ] **Passo 1: teste que falha.** Criar `test/local-auth-config.test.js`:

```js
// A chave localAuth existe no config e NÃO vem da tela nem do POST /api/settings: uma
// página sem credencial não pode ligar nem desligar a própria proteção (A4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, EDITAVEIS } from '../lib/settings.js';

test('localAuth existe no config com padrão vazio (não exige)', () => {
  assert.ok('localAuth' in defaults(1), 'a chave precisa estar na tabela única');
  assert.equal(defaults(1).localAuth, '');
});

test('localAuth não é editável pela tela nem pelo updateSettings', () => {
  assert.equal(EDITAVEIS.has('localAuth'), false);
});
```

- [ ] **Passo 2: rodar e ver falhar.**

```bash
node --test --test-force-exit test/local-auth-config.test.js
```

Esperado: `localAuth existe no config` reprova com "a chave precisa estar na tabela única".

- [ ] **Passo 3: implementar.** Em `lib/settings.js`, logo depois da linha `{ key: 'port', def: null, ui: false },`:

```js
  // Autenticação da API local (A4): 'exigir' liga a exigência em qualquer ambiente.
  // NÃO vem da tela nem do POST /api/settings, porque uma página sem credencial não pode
  // ligar nem desligar a própria proteção. Edição de arquivo, com reinício. No modo
  // celular a exigência não depende desta chave (lib/local-auth/modo.js).
  { key: 'localAuth', def: '', ui: false },
```

- [ ] **Passo 4: rodar e ver passar.**

```bash
node --test --test-force-exit test/local-auth-config.test.js test/settings-fonte-unica.test.js
```

Esperado: todos passam.

- [ ] **Passo 5: contraprova.** Trocar `ui: false` por `ui: true` na linha nova. Rodar `test/local-auth-config.test.js`: reprova `localAuth não é editável`. Restaurar `ui: false` e confirmar verde.

- [ ] **Passo 6: commit.**

```bash
git add lib/settings.js test/local-auth-config.test.js
git commit -m "feat(local-auth): registra localAuth como chave de arquivo, fora da tela"
```

---

## Tarefa 3: gravação restrita e códigos de pareamento

**Arquivos:**
- Criar: `lib/local-auth/arquivo.js`
- Criar: `lib/local-auth/pareamento.js`
- Criar: `test/local-auth-pareamento.test.js`

**Interfaces:**

```js
// arquivo.js
lerLista(arquivo) -> Array
gravarRestrito(arquivo, lista) -> void   // 0700 no diretório e 0600 no arquivo, a CADA gravação
// pareamento.js
pareamentosPath() -> string               // <LOCAL_AUTH_DIR>/pareamentos.json
criarCodigo(agora = Date.now()) -> string // 10 caracteres [A-Z2-7]
consumirCodigo(codigo, agora = Date.now()) -> boolean
revogarCodigos() -> void
// registro em disco: { sal, hash, criadoEm, expiraEm, erros }
```

- [ ] **Passo 1: teste que falha.** Criar `test/local-auth-pareamento.test.js`:

```js
// Código de pareamento da API local (A4, spec 7.A4 item 3): 10 caracteres base32,
// 10 minutos, uso único, invalidado depois de 5 tentativas erradas, e só o hash com sal
// em disco. FAROL_HOME temporário ANTES do import (test/test-isolation.test.js).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = path.join(os.tmpdir(), 'farol-test-local-auth-pareamento-' + process.pid);
process.env.FAROL_HOME = HOME;

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
const { criarCodigo, consumirCodigo, revogarCodigos, pareamentosPath } = await import('../lib/local-auth/pareamento.js');
const { LOCAL_AUTH_DIR } = await import('../lib/paths.js');
const { TEMPOS } = await import('../lib/constants.js');

const T0 = 1_760_000_000_000;

beforeEach(() => { fs.rmSync(LOCAL_AUTH_DIR, { recursive: true, force: true }); });
after(() => { fs.rmSync(HOME, { recursive: true, force: true }); });

test('o código tem 10 caracteres base32 e o arquivo fica dentro do FAROL_HOME', () => {
  const codigo = criarCodigo(T0);
  assert.match(codigo, /^[A-Z2-7]{10}$/);
  assert.ok(pareamentosPath().startsWith(HOME), 'nunca o ~/.farol real');
});

test('em disco fica só o hash com sal, nunca o código', () => {
  const codigo = criarCodigo(T0);
  const texto = fs.readFileSync(pareamentosPath(), 'utf8');
  assert.equal(texto.includes(codigo), false, 'o código em claro não pode ir para o disco');
  const [registro] = JSON.parse(texto);
  assert.deepEqual(Object.keys(registro).sort(), ['criadoEm', 'erros', 'expiraEm', 'hash', 'sal']);
  assert.match(registro.hash, /^[0-9a-f]{64}$/);
  assert.equal(registro.expiraEm, T0 + TEMPOS.PAREAMENTO_VALIDADE_MS);
});

test('o código funciona uma vez só', () => {
  const codigo = criarCodigo(T0);
  assert.equal(consumirCodigo(codigo, T0 + 1000), true);
  assert.equal(consumirCodigo(codigo, T0 + 2000), false);
});

test('caixa, espaço e hífen digitados não atrapalham', () => {
  const codigo = criarCodigo(T0);
  const digitado = ` ${codigo.slice(0, 5).toLowerCase()}-${codigo.slice(5)} `;
  assert.equal(consumirCodigo(digitado, T0 + 1000), true);
});

test('o código não funciona depois do prazo', () => {
  const noLimite = criarCodigo(T0);
  assert.equal(consumirCodigo(noLimite, T0 + TEMPOS.PAREAMENTO_VALIDADE_MS), false, 'no instante do vencimento já não vale');
  const antes = criarCodigo(T0);
  assert.equal(consumirCodigo(antes, T0 + TEMPOS.PAREAMENTO_VALIDADE_MS - 1), true, 'um milissegundo antes ainda vale');
});

test('5 tentativas erradas invalidam o código', () => {
  const codigo = criarCodigo(T0);
  for (let i = 0; i < 5; i++) assert.equal(consumirCodigo('AAAAAAAAAA', T0 + i), false);
  assert.equal(consumirCodigo(codigo, T0 + 10), false, 'depois do quinto erro o código certo não entra');
});

test('4 tentativas erradas ainda deixam o código valer', () => {
  const codigo = criarCodigo(T0);
  for (let i = 0; i < 4; i++) consumirCodigo('AAAAAAAAAA', T0 + i);
  assert.equal(consumirCodigo(codigo, T0 + 10), true);
});

test('tentativa com tamanho errado também conta como erro', () => {
  const codigo = criarCodigo(T0);
  for (let i = 0; i < 5; i++) consumirCodigo('X', T0 + i);
  assert.equal(consumirCodigo(codigo, T0 + 10), false);
});

test('tentativa sem código pendente não cria arquivo', () => {
  assert.equal(consumirCodigo('AAAAAAAAAA', T0), false);
  assert.equal(fs.existsSync(pareamentosPath()), false);
});

test('revogarCodigos invalida os pendentes', () => {
  const codigo = criarCodigo(T0);
  revogarCodigos();
  assert.equal(consumirCodigo(codigo, T0 + 1000), false);
});

test('o arquivo de pareamentos nunca fica legível por outros', { skip: process.platform === 'win32' }, () => {
  criarCodigo(T0);
  assert.equal(fs.statSync(pareamentosPath()).mode & 0o777, 0o600);
  consumirCodigo('AAAAAAAAAA', T0 + 1);
  assert.equal(fs.statSync(pareamentosPath()).mode & 0o777, 0o600, 'a regravação restringe de novo');
  assert.equal(fs.statSync(LOCAL_AUTH_DIR).mode & 0o777, 0o700);
});
```

- [ ] **Passo 2: rodar e ver falhar.**

```bash
node --test --test-force-exit test/local-auth-pareamento.test.js
```

Esperado: `ERR_MODULE_NOT_FOUND` para `../lib/local-auth/pareamento.js`.

- [ ] **Passo 3: criar `lib/local-auth/arquivo.js`.**

```js
// Leitura e gravação dos arquivos da autenticação local (A4). Mesmo contrato de
// lib/jira/credentials.js: TODA gravação restringe o modo de novo, porque o
// writeJsonAtomic entrega ao arquivo final o modo default do .tmp. Continua sendo
// writeJsonAtomic e não rename cru, pelo fallback de EPERM do antivírus no Windows.
import fs from 'node:fs';
import path from 'node:path';
import io from '../io.js';

function lerLista(arquivo) {
  const dados = io.readJson(arquivo, []);
  return Array.isArray(dados) ? dados : [];
}

// chmod não existe em NTFS: no Windows a proteção real é a ACL do perfil do usuário.
function restringir(alvo, modo) {
  try { fs.chmodSync(alvo, modo); } catch { /* sem suporte a modo neste sistema de arquivos */ }
}

function gravarRestrito(arquivo, lista) {
  const dir = path.dirname(arquivo);
  io.ensureDir(dir);
  restringir(dir, 0o700);
  io.writeJsonAtomic(arquivo, lista);
  restringir(arquivo, 0o600);
}

export default { lerLista, gravarRestrito };
export { lerLista, gravarRestrito };
```

- [ ] **Passo 4: criar `lib/local-auth/pareamento.js`.**

```js
// Códigos de pareamento da API local (A4, spec 7.A4 item 3). O código em claro existe
// só na saída do comando local (tools/farol-parear.js) e no corpo do POST /api/auth/pair;
// em disco ficam o hash com sal, a validade e o contador de erros.
import crypto from 'node:crypto';
import path from 'node:path';
import { LOCAL_AUTH_DIR } from '../paths.js';
import { TEMPOS, LOCAL_AUTH } from '../constants.js';
import { lerLista, gravarRestrito } from './arquivo.js';

const ARQUIVO = path.join(LOCAL_AUTH_DIR, 'pareamentos.json');
// base32 da RFC 4648: 32 símbolos, então byte & 31 é uniforme (256 é múltiplo de 32).
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const SAL_BYTES = 16;

function pareamentosPath() { return ARQUIVO; }

function hashDoCodigo(sal, codigo) {
  return crypto.createHash('sha256').update(`${sal}:${codigo}`).digest('hex');
}

function normalizar(codigo) {
  return String(codigo || '').toUpperCase().replace(/[\s-]/g, '');
}

function gerarCodigo() {
  return [...crypto.randomBytes(LOCAL_AUTH.CODIGO_TAMANHO)].map(b => ALFABETO[b & 31]).join('');
}

function pendentes(lista, agora) {
  return lista.filter(p => p && Number(p.expiraEm) > agora && Number(p.erros) < LOCAL_AUTH.CODIGO_MAX_ERROS);
}

function criarCodigo(agora = Date.now()) {
  const codigo = gerarCodigo();
  const sal = crypto.randomBytes(SAL_BYTES).toString('hex');
  const novo = { sal, hash: hashDoCodigo(sal, codigo), criadoEm: agora, expiraEm: agora + TEMPOS.PAREAMENTO_VALIDADE_MS, erros: 0 };
  gravarRestrito(ARQUIVO, [...pendentes(lerLista(ARQUIVO), agora), novo]);
  return codigo;
}

function confere(registro, codigo) {
  const esperado = Buffer.from(String(registro.hash || ''), 'hex');
  const obtido = Buffer.from(hashDoCodigo(String(registro.sal || ''), codigo), 'hex');
  return esperado.length === obtido.length && crypto.timingSafeEqual(esperado, obtido);
}

// Tentativa errada conta contra TODO código pendente, porque não há como saber qual
// deles quem tenta estava adivinhando. O quinto erro tira o código do arquivo.
function registrarErro(lista, agora) {
  if (!lista.length) return false;
  const contados = lista.map(p => ({ ...p, erros: Number(p.erros) + 1 }));
  gravarRestrito(ARQUIVO, pendentes(contados, agora));
  return false;
}

// Uso único: o código certo sai do arquivo na mesma gravação que o aceita.
function consumirCodigo(codigo, agora = Date.now()) {
  const alvo = normalizar(codigo);
  const lista = pendentes(lerLista(ARQUIVO), agora);
  if (alvo.length !== LOCAL_AUTH.CODIGO_TAMANHO) return registrarErro(lista, agora);
  const acerto = lista.find(p => confere(p, alvo));
  if (!acerto) return registrarErro(lista, agora);
  gravarRestrito(ARQUIVO, lista.filter(p => p !== acerto));
  return true;
}

function revogarCodigos() { gravarRestrito(ARQUIVO, []); }

export default { pareamentosPath, criarCodigo, consumirCodigo, revogarCodigos };
export { pareamentosPath, criarCodigo, consumirCodigo, revogarCodigos };
```

- [ ] **Passo 5: rodar e ver passar.**

```bash
node --test --test-force-exit test/local-auth-pareamento.test.js
npm run check && npm run lint
```

Esperado: todos passam (o de modo 0600 aparece como `skip` no Windows).

- [ ] **Passo 6: contraprova.**
  1. Em `lib/constants.js`, trocar `CODIGO_MAX_ERROS: 5` por `6`. Rodar o arquivo: reprova `5 tentativas erradas invalidam o código` (e também `test/local-auth-modo.test.js`). Restaurar `5`.
  2. Em `criarCodigo`, trocar `const novo = { sal, hash:` por `const novo = { codigo, sal, hash:`. Rodar: reprova `em disco fica só o hash com sal`. Restaurar.
  3. Em `consumirCodigo`, apagar a linha `gravarRestrito(ARQUIVO, lista.filter(p => p !== acerto));`. Rodar: reprova `o código funciona uma vez só`. Restaurar e confirmar verde.

- [ ] **Passo 7: commit.**

```bash
git add lib/local-auth/arquivo.js lib/local-auth/pareamento.js test/local-auth-pareamento.test.js
git commit -m "feat(local-auth): codigo de pareamento de uso unico com hash e sal em disco"
```

---

## Tarefa 4: sessões autorizadas

**Arquivos:**
- Criar: `lib/local-auth/sessoes.js`
- Criar: `test/local-auth-sessoes.test.js`

**Interfaces:**

```js
sessoesPath() -> string                                    // <LOCAL_AUTH_DIR>/sessoes.json
emitirSessao(rotulo = '', agora = Date.now()) -> string    // token base64url de 32 bytes (43 caracteres)
verificarSessao(token, agora = Date.now()) -> boolean
revogarTodas() -> void
// registro em disco: { hash, criadoEm, ultimoUsoEm, rotulo }
```

- [ ] **Passo 1: teste que falha.** Criar `test/local-auth-sessoes.test.js`:

```js
// Sessões da API local (A4, spec 7.A4 item 4): só o hash do token em disco, expiração
// com 30 dias sem uso ou 90 desde a criação, revogação total e sobrevivência a reinício
// (o arquivo é a fonte; nenhum cache em memória). FAROL_HOME temporário antes do import.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = path.join(os.tmpdir(), 'farol-test-local-auth-sessoes-' + process.pid);
process.env.FAROL_HOME = HOME;

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
const { emitirSessao, verificarSessao, revogarTodas, sessoesPath } = await import('../lib/local-auth/sessoes.js');
const { LOCAL_AUTH_DIR } = await import('../lib/paths.js');
const { TEMPOS } = await import('../lib/constants.js');

const T0 = 1_760_000_000_000;
const DIA = TEMPOS.DIA_MS;

beforeEach(() => { fs.rmSync(LOCAL_AUTH_DIR, { recursive: true, force: true }); });
after(() => { fs.rmSync(HOME, { recursive: true, force: true }); });

test('o token tem 32 bytes em base64url e o arquivo guarda só o hash', () => {
  const token = emitirSessao('celular', T0);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const texto = fs.readFileSync(sessoesPath(), 'utf8');
  assert.equal(texto.includes(token), false, 'o token em claro não pode ir para o disco');
  const [s] = JSON.parse(texto);
  assert.deepEqual(Object.keys(s).sort(), ['criadoEm', 'hash', 'rotulo', 'ultimoUsoEm']);
  assert.match(s.hash, /^[0-9a-f]{64}$/);
  assert.equal(s.rotulo, 'celular');
});

test('token válido passa; errado, malformado ou vazio não', () => {
  const token = emitirSessao('', T0);
  assert.equal(verificarSessao(token, T0 + 1), true);
  assert.equal(verificarSessao('A'.repeat(43), T0 + 1), false);
  assert.equal(verificarSessao(token + 'x', T0 + 1), false);
  assert.equal(verificarSessao('', T0 + 1), false);
  assert.equal(verificarSessao(undefined, T0 + 1), false);
});

test('30 dias sem uso expiram a sessão', () => {
  const ociosa = emitirSessao('', T0);
  assert.equal(verificarSessao(ociosa, T0 + TEMPOS.SESSAO_LOCAL_OCIOSA_MS), false);
  const quase = emitirSessao('', T0);
  assert.equal(verificarSessao(quase, T0 + TEMPOS.SESSAO_LOCAL_OCIOSA_MS - 1), true);
});

test('90 dias desde a criação expiram a sessão mesmo com uso contínuo', () => {
  const token = emitirSessao('', T0);
  for (const dia of [20, 40, 60, 80]) assert.equal(verificarSessao(token, T0 + dia * DIA), true, `uso no dia ${dia}`);
  assert.equal(verificarSessao(token, T0 + 89 * DIA), true, 'dia 89 ainda vale');
  assert.equal(verificarSessao(token, T0 + TEMPOS.SESSAO_LOCAL_ABSOLUTA_MS), false, 'dia 90 não vale mais');
});

test('o último uso só é regravado depois da folga', () => {
  const token = emitirSessao('', T0);
  const antes = fs.readFileSync(sessoesPath(), 'utf8');
  verificarSessao(token, T0 + TEMPOS.SESSAO_LOCAL_TOQUE_MS - 1);
  assert.equal(fs.readFileSync(sessoesPath(), 'utf8'), antes, 'uso dentro da folga não reescreve o arquivo');
  verificarSessao(token, T0 + TEMPOS.SESSAO_LOCAL_TOQUE_MS);
  assert.equal(JSON.parse(fs.readFileSync(sessoesPath(), 'utf8'))[0].ultimoUsoEm, T0 + TEMPOS.SESSAO_LOCAL_TOQUE_MS);
});

test('revogarTodas derruba toda sessão, e a verificação lê o disco a cada chamada', () => {
  const a = emitirSessao('a', T0);
  const b = emitirSessao('b', T0);
  revogarTodas();
  assert.equal(verificarSessao(a, T0 + 1), false);
  assert.equal(verificarSessao(b, T0 + 1), false);
});

test('rótulo é cortado em 60 caracteres', () => {
  emitirSessao('x'.repeat(200), T0);
  assert.equal(JSON.parse(fs.readFileSync(sessoesPath(), 'utf8'))[0].rotulo.length, 60);
});

test('emitir uma sessão nova poda as expiradas', () => {
  emitirSessao('velha', T0);
  emitirSessao('nova', T0 + TEMPOS.SESSAO_LOCAL_OCIOSA_MS);
  const lista = JSON.parse(fs.readFileSync(sessoesPath(), 'utf8'));
  assert.deepEqual(lista.map(s => s.rotulo), ['nova']);
});

test('o arquivo de sessões nunca fica legível por outros', { skip: process.platform === 'win32' }, () => {
  const token = emitirSessao('', T0);
  assert.equal(fs.statSync(sessoesPath()).mode & 0o777, 0o600);
  verificarSessao(token, T0 + TEMPOS.SESSAO_LOCAL_TOQUE_MS);
  assert.equal(fs.statSync(sessoesPath()).mode & 0o777, 0o600, 'o toque regrava e restringe de novo');
});
```

- [ ] **Passo 2: rodar e ver falhar.**

```bash
node --test --test-force-exit test/local-auth-sessoes.test.js
```

Esperado: `ERR_MODULE_NOT_FOUND` para `../lib/local-auth/sessoes.js`.

- [ ] **Passo 3: criar `lib/local-auth/sessoes.js`.**

```js
// Sessões autorizadas da API local (A4, spec 7.A4 item 4). Em disco fica só o hash do
// token. Não há cache em memória: revogar pelo comando local vale na requisição seguinte,
// e reiniciar o engine não derruba ninguém.
import crypto from 'node:crypto';
import path from 'node:path';
import { LOCAL_AUTH_DIR } from '../paths.js';
import { TEMPOS, LOCAL_AUTH } from '../constants.js';
import { lerLista, gravarRestrito } from './arquivo.js';

const ARQUIVO = path.join(LOCAL_AUTH_DIR, 'sessoes.json');
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function sessoesPath() { return ARQUIVO; }

// Comparar o hash com === não vaza nada útil: o token tem 256 bits aleatórios, e descobrir
// o hash guardado não devolve o token que o gerou.
function hashDoToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function viva(sessao, agora) {
  if (!sessao || typeof sessao.hash !== 'string') return false;
  if (agora - Number(sessao.criadoEm) >= TEMPOS.SESSAO_LOCAL_ABSOLUTA_MS) return false;
  return agora - Number(sessao.ultimoUsoEm) < TEMPOS.SESSAO_LOCAL_OCIOSA_MS;
}

function emitirSessao(rotulo = '', agora = Date.now()) {
  const token = crypto.randomBytes(LOCAL_AUTH.TOKEN_BYTES).toString('base64url');
  const nova = { hash: hashDoToken(token), criadoEm: agora, ultimoUsoEm: agora, rotulo: String(rotulo || '').slice(0, LOCAL_AUTH.ROTULO_MAX) };
  gravarRestrito(ARQUIVO, [...lerLista(ARQUIVO).filter(s => viva(s, agora)), nova]);
  return token;
}

function verificarSessao(token, agora = Date.now()) {
  if (!FORMATO_TOKEN.test(String(token || ''))) return false;
  const lista = lerLista(ARQUIVO);
  const hash = hashDoToken(token);
  const sessao = lista.find(s => viva(s, agora) && s.hash === hash);
  if (!sessao) return false;
  if (agora - Number(sessao.ultimoUsoEm) >= TEMPOS.SESSAO_LOCAL_TOQUE_MS) {
    sessao.ultimoUsoEm = agora;
    gravarRestrito(ARQUIVO, lista.filter(s => viva(s, agora)));
  }
  return true;
}

function revogarTodas() { gravarRestrito(ARQUIVO, []); }

export default { sessoesPath, emitirSessao, verificarSessao, revogarTodas };
export { sessoesPath, emitirSessao, verificarSessao, revogarTodas };
```

- [ ] **Passo 4: rodar e ver passar.**

```bash
node --test --test-force-exit test/local-auth-sessoes.test.js
npm run check && npm run lint
```

Esperado: todos passam.

- [ ] **Passo 5: contraprova.**
  1. Em `viva`, trocar `>= TEMPOS.SESSAO_LOCAL_ABSOLUTA_MS` por `> TEMPOS.SESSAO_LOCAL_ABSOLUTA_MS`. Rodar: reprova `90 dias desde a criação expiram` ("dia 90 não vale mais"). Restaurar.
  2. Em `emitirSessao`, trocar `hash: hashDoToken(token)` por `hash: token`. Rodar: reprova `o token tem 32 bytes ... só o hash`. Restaurar e confirmar verde.

- [ ] **Passo 6: commit.**

```bash
git add lib/local-auth/sessoes.js test/local-auth-sessoes.test.js
git commit -m "feat(local-auth): sessoes por token com hash em disco, expiracao e revogacao"
```

---

## Tarefa 5: inventário de rotas por classe

**Arquivos:**
- Criar: `lib/local-auth/inventario.js`
- Criar: `test/local-auth-inventario.test.js`

**Interfaces:**

```js
CLASSES: { [classe: string]: string[] }       // 8 classes da spec + 'autenticacao-publica'
PUBLICAS: { '/api/auth/pair': 'POST', '/api/auth/status': 'GET' }
classeDaRota(rota) -> string                   // '' quando a rota não tem classe
rotaPublicaDeAutenticacao(metodo, rota) -> boolean
todasAsRotas() -> string[]
```

As duas rotas "de baixo risco a confirmar" da spec (`/api/deliveries`, `/api/reviewer-candidates`) ficam confirmadas **como protegidas**. A classe só registra o que se perde se a rota vazar; a exigência vale igual para todo `/api/*` (spec 7.A4, item 5).

- [ ] **Passo 1: teste que falha.** Criar `test/local-auth-inventario.test.js`:

```js
// Inventário das rotas /api (A4, spec 7.A4): toda rota que o servidor roteia tem classe.
// Rota nova sem classe reprova aqui. A lista do servidor é DERIVADA do fonte, com o mesmo
// extrator do test/ui-contract.test.js, para não virar tabela curada que envelhece.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CLASSES, PUBLICAS, classeDaRota, rotaPublicaDeAutenticacao, todasAsRotas } from '../lib/local-auth/inventario.js';

const SERVERJS = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'http-server.js'), 'utf8');
function rotasServidas() {
  return new Set([...SERVERJS.matchAll(/p === '(\/api\/[^']+)'/g)].map(m => m[1]));
}

test('o extrator de rotas não está cego', () => {
  const servidas = rotasServidas();
  assert.ok(servidas.has('/api/decide'));
  assert.ok(servidas.size >= 46, `esperava pelo menos 46 rotas, achei ${servidas.size}`);
});

test('toda rota servida tem classe no inventário', () => {
  const semClasse = [...rotasServidas()].filter(r => !classeDaRota(r));
  assert.deepEqual(semClasse, [], `rota sem classe (classifique em lib/local-auth/inventario.js conforme a spec 7.A4): ${semClasse.join(', ')}`);
});

test('nenhuma rota aparece em duas classes', () => {
  const todas = todasAsRotas();
  assert.equal(new Set(todas).size, todas.length);
});

test('as classes da spec cobrem os 46 caminhos, e as públicas são só as duas de autenticação', () => {
  const naoPublicas = Object.entries(CLASSES).filter(([c]) => c !== 'autenticacao-publica').flatMap(([, rotas]) => rotas);
  assert.equal(naoPublicas.length, 46);
  assert.deepEqual(CLASSES['autenticacao-publica'].slice().sort(), ['/api/auth/pair', '/api/auth/status']);
  assert.deepEqual(Object.keys(CLASSES).sort(), ['autenticacao-publica', 'demais', 'destrutiva', 'escreve-github', 'evento', 'leitura-baixo-risco', 'leitura-sensivel', 'recebe-segredo', 'sessao-paga']);
});

test('a exceção pública depende do método', () => {
  assert.deepEqual({ ...PUBLICAS }, { '/api/auth/pair': 'POST', '/api/auth/status': 'GET' });
  assert.equal(rotaPublicaDeAutenticacao('POST', '/api/auth/pair'), true);
  assert.equal(rotaPublicaDeAutenticacao('GET', '/api/auth/status'), true);
  assert.equal(rotaPublicaDeAutenticacao('GET', '/api/auth/pair'), false);
  assert.equal(rotaPublicaDeAutenticacao('POST', '/api/auth/status'), false);
  assert.equal(rotaPublicaDeAutenticacao('GET', '/api/state'), false);
});
```

- [ ] **Passo 2: rodar e ver falhar.**

```bash
node --test --test-force-exit test/local-auth-inventario.test.js
```

Esperado: `ERR_MODULE_NOT_FOUND` para `../lib/local-auth/inventario.js`.

- [ ] **Passo 3: criar `lib/local-auth/inventario.js`.**

```js
// Inventário das rotas /api do servidor local, por classe da spec 7.A4. A exigência de
// credencial vale igual para todas (spec 7.A4, item 5): a classe diz o que se perde se a
// rota vazar, e é por ela que os testes escolhem o que provar. Rota nova sem classe
// reprova em test/local-auth-inventario.test.js. As duas rotas de baixo risco foram
// confirmadas como protegidas, sem exceção.
const CLASSES = Object.freeze({
  'leitura-sensivel': ['/api/state', '/api/chat', '/api/decision', '/api/highlights', '/api/team', '/api/log', '/api/log/triage', '/api/doctor', '/api/sync/consolidated'],
  'leitura-baixo-risco': ['/api/deliveries', '/api/reviewer-candidates'],
  'evento': ['/api/events'],
  'recebe-segredo': ['/api/jira/credential', '/api/sync/login'],
  'escreve-github': ['/api/decide', '/api/review/post', '/api/self-review/merge', '/api/self-review/reviewers'],
  'sessao-paga': ['/api/review', '/api/self-review', '/api/chat/send', '/api/tool'],
  'destrutiva': ['/api/sync/erase-remote', '/api/log/clear', '/api/team/remove'],
  'demais': ['/api/check', '/api/jira/credential/remove', '/api/jira/test', '/api/sync/logout', '/api/sync/test', '/api/sync/redo', '/api/sync/consolidate', '/api/claude-login', '/api/self-review/visibility', '/api/self-review/cancel', '/api/pr/hide', '/api/pr/unhide', '/api/ignore', '/api/restore', '/api/settings', '/api/pushback', '/api/tool/clear', '/api/cancel', '/api/session-exit', '/api/update', '/api/chat/stop'],
  'autenticacao-publica': ['/api/auth/pair', '/api/auth/status'],
});

// As duas únicas exceções, com o método: fora dele a rota exige credencial como as outras.
const PUBLICAS = Object.freeze({ '/api/auth/pair': 'POST', '/api/auth/status': 'GET' });

function todasAsRotas() { return Object.values(CLASSES).flat(); }

function classeDaRota(rota) {
  const achada = Object.entries(CLASSES).find(([, rotas]) => rotas.includes(rota));
  return achada ? achada[0] : '';
}

function rotaPublicaDeAutenticacao(metodo, rota) {
  return Object.hasOwn(PUBLICAS, rota) && PUBLICAS[rota] === metodo;
}

export default { CLASSES, PUBLICAS, classeDaRota, rotaPublicaDeAutenticacao, todasAsRotas };
export { CLASSES, PUBLICAS, classeDaRota, rotaPublicaDeAutenticacao, todasAsRotas };
```

- [ ] **Passo 4: rodar e ver passar.**

```bash
node --test --test-force-exit test/local-auth-inventario.test.js
npm run check && npm run lint
```

Esperado: todos passam.

- [ ] **Passo 5: contraprova.** Apagar `'/api/chat/stop'` da lista `demais`. Rodar: reprovam `toda rota servida tem classe` (citando `/api/chat/stop`) e `as classes da spec cobrem os 46 caminhos`. Restaurar e confirmar verde.

- [ ] **Passo 6: commit.**

```bash
git add lib/local-auth/inventario.js test/local-auth-inventario.test.js
git commit -m "feat(local-auth): inventario das rotas da API local por classe de risco"
```

---

## Tarefa 6: porteiro e fiação no servidor HTTP

**Arquivos:**
- Criar: `lib/local-auth/acesso.js`
- Modificar: `lib/http-server.js` (três pontos ancorados por texto, ver Passo 4)
- Modificar: `test/local-auth-inventario.test.js` (acrescentar um teste)
- Criar: `test/local-auth-http.test.js`

**Interfaces:**

```js
// lib/local-auth/acesso.js
recusaSemCredencial(req, rota, config) -> null | { status: 401, body: { error: 'nao_autenticado' } }
statusAutenticacao(req, config) -> { exigida: boolean, autenticado: boolean }
parear(body) -> { ok: true, token: string } | { ok: false, code: 'codigo_invalido' }
// HTTP
GET  /api/auth/status  -> 200 { exigida, autenticado }
POST /api/auth/pair    -> 200 { ok: true, token } | 200 { ok: false, code: 'codigo_invalido' }   (exige x-farol; C1a na frente)
qualquer outro /api/* no modo que exige, sem Authorization: Bearer <token válido> -> 401 { error: 'nao_autenticado' }
```

- [ ] **Passo 1: acrescentar ao inventário o teste que só passa com a fiação.** Ao final de `test/local-auth-inventario.test.js`:

```js
test('toda rota inventariada existe no servidor (sem classe morta)', () => {
  const servidas = rotasServidas();
  const mortas = todasAsRotas().filter(r => !servidas.has(r));
  assert.deepEqual(mortas, [], `rota inventariada que o servidor não roteia: ${mortas.join(', ')}`);
});
```

- [ ] **Passo 2: criar o teste HTTP que falha.** Criar `test/local-auth-http.test.js`:

```js
// A4 no servidor real (spec 7.A4, critérios de aceite): no modo que exige, requisição
// sem credencial não recebe estado, relatório, log, chat nem evento SSE, e não executa
// ação (um teste por classe do inventário); o segredo não aparece em log, HTML, snapshot
// nem URL; nenhum cookie; modo decidido no servidor; sessão sobrevive a reinício e some
// com a revogação. O modo que exige é ligado aqui por config.localAuth = 'exigir', porque
// ATIVACAO_AUTOMATICA_A4 segue false. FAROL_HOME temporário antes de qualquer import.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const HOME = path.join(os.tmpdir(), 'farol-test-local-auth-http-' + process.pid);
process.env.FAROL_HOME = HOME;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const { LOG_FILE } = await import('../lib/paths.js');
const { SPAWN_LOG_FILE } = await import('../lib/spawnlog.js');
const { criarCodigo } = await import('../lib/local-auth/pareamento.js');
const { revogarTodas } = await import('../lib/local-auth/sessoes.js');
const { CLASSES } = await import('../lib/local-auth/inventario.js');

const RAIZ = path.join(import.meta.dirname, '..');
let engine, server, base;

async function subir() {
  engine = new Engine();
  engine.config.port = 0;
  await new Promise((resolve, reject) => {
    server = startServer(engine, (url, err) => (err ? reject(err) : resolve()));
  });
  base = `http://127.0.0.1:${server.address().port}`;
}

function derrubar() {
  if (!server) return Promise.resolve();
  server.closeAllConnections();
  return new Promise(resolve => server.close(() => resolve()));
}

before(subir);
after(async () => {
  await derrubar();
  fs.rmSync(HOME, { recursive: true, force: true });
});

function pedir(metodo, rota, { corpo, cabecalhos = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = corpo === undefined ? '' : JSON.stringify(corpo);
    const headers = { 'x-farol': '1', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...cabecalhos };
    const req = http.request(base + rota, { method: metodo, headers }, res => {
      let d = ''; res.on('data', c => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

// SSE autenticado não termina: lê até o primeiro evento completo e derruba a conexão
function primeiroEvento(cabecalhos) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + '/api/events', { method: 'GET', headers: cabecalhos }, res => {
      let d = '';
      const fim = () => { req.destroy(); resolve({ status: res.statusCode, headers: res.headers, body: d }); };
      res.on('data', c => { d += c; if (d.includes('\n\n')) fim(); });
      res.on('end', fim);
    });
    req.on('error', err => { if (err.code !== 'ECONNRESET') reject(err); });
    req.end();
  });
}

async function comExigencia(fn) {
  const anterior = engine.config.localAuth;
  engine.config.localAuth = 'exigir';
  try { return await fn(); } finally { engine.config.localAuth = anterior; }
}

async function parearViaHttp(rotulo = 'teste') {
  const codigo = criarCodigo();
  const r = await pedir('POST', '/api/auth/pair', { corpo: { codigo, rotulo } });
  const corpo = JSON.parse(r.body);
  assert.equal(corpo.ok, true, 'o pareamento com código válido tem que funcionar');
  return { codigo, token: corpo.token, resposta: r };
}

const bearer = token => ({ Authorization: `Bearer ${token}` });

// Métodos do engine que alguma rota chama, derivados do fonte do servidor. Substituídos
// por espiões durante as provas de recusa: se o porteiro falhar, a rota bate no espião
// (e não em gh, sessão paga ou update de verdade), e o teste acusa a chamada.
const METODOS_DO_ENGINE = [...new Set([...fs.readFileSync(path.join(RAIZ, 'lib', 'http-server.js'), 'utf8')
  .matchAll(/engine\.(\w+)\(/g)].map(m => m[1]))].filter(n => n !== 'on' && n !== 'log');

async function comEspioes(fn) {
  const chamadas = [];
  const originais = new Map();
  for (const nome of METODOS_DO_ENGINE) {
    originais.set(nome, engine[nome]);
    engine[nome] = () => { chamadas.push(nome); return { ok: true }; };
  }
  try { await fn(chamadas); } finally { for (const [nome, f] of originais) engine[nome] = f; }
}

const GET_DA_CLASSE = new Set(['leitura-sensivel', 'leitura-baixo-risco', 'evento']);

test('desktop sem localAuth: a API responde como hoje e o status diz que não exige', async () => {
  const estado = await pedir('GET', '/api/state');
  assert.equal(estado.status, 200);
  assert.ok(JSON.parse(estado.body).decisions);
  const status = await pedir('GET', '/api/auth/status');
  assert.deepEqual(JSON.parse(status.body), { exigida: false, autenticado: false });
});

for (const [classe, rotas] of Object.entries(CLASSES)) {
  if (classe === 'autenticacao-publica') continue;
  test(`classe ${classe}: sem credencial recebe 401, sem dado e sem ação`, async () => {
    await comExigencia(() => comEspioes(async (chamadas) => {
      for (const rota of rotas) {
        const metodo = GET_DA_CLASSE.has(classe) ? 'GET' : 'POST';
        const corpo = metodo === 'POST' ? { urls: ['https://github.com/acme/app/pull/1'], id: 'x', key: 'acme/app#1' } : undefined;
        const r = await pedir(metodo, rota, { corpo });
        assert.equal(r.status, 401, `${metodo} ${rota} sem credencial`);
        assert.deepEqual(JSON.parse(r.body), { error: 'nao_autenticado' }, `${rota} não pode devolver nada além da recusa`);
        assert.match(String(r.headers['content-type']), /application\/json/, `${rota} não abre stream`);
      }
      assert.deepEqual(chamadas, [], `a classe ${classe} chegou ao engine sem credencial`);
    }));
  });
}

test('token inválido, malformado ou de outro esquema também recebe 401', async () => {
  await comExigencia(async () => {
    for (const cab of [bearer('A'.repeat(43)), { Authorization: 'Bearer ' }, { Authorization: 'Basic abc' }, { Authorization: `bearer ${'A'.repeat(43)}` }]) {
      assert.equal((await pedir('GET', '/api/state', { cabecalhos: cab })).status, 401);
    }
  });
});

test('as exceções públicas dependem do método', async () => {
  await comExigencia(async () => {
    assert.equal((await pedir('GET', '/api/auth/status')).status, 200);
    assert.equal((await pedir('POST', '/api/auth/status', { corpo: {} })).status, 401);
    assert.equal((await pedir('GET', '/api/auth/pair')).status, 401);
  });
});

test('com token válido as rotas respondem, inclusive o SSE', async () => {
  await comExigencia(async () => {
    const { token } = await parearViaHttp();
    const estado = await pedir('GET', '/api/state', { cabecalhos: bearer(token) });
    assert.equal(estado.status, 200);
    assert.ok(JSON.parse(estado.body).decisions);
    const status = await pedir('GET', '/api/auth/status', { cabecalhos: bearer(token) });
    assert.deepEqual(JSON.parse(status.body), { exigida: true, autenticado: true });
    const ev = await primeiroEvento(bearer(token));
    assert.equal(ev.status, 200);
    assert.match(ev.body, /^event: state\n/);
    const semCredencial = await pedir('GET', '/api/events');
    assert.equal(semCredencial.status, 401);
    assert.doesNotMatch(semCredencial.body, /event:/);
  });
});

test('GET /api/auth/status devolve só exigida e autenticado', async () => {
  await comExigencia(async () => {
    const r = await pedir('GET', '/api/auth/status');
    assert.deepEqual(Object.keys(JSON.parse(r.body)).sort(), ['autenticado', 'exigida']);
  });
});

test('pareamento: código não funciona duas vezes e exige x-farol', async () => {
  const codigo = criarCodigo();
  const primeira = JSON.parse((await pedir('POST', '/api/auth/pair', { corpo: { codigo } })).body);
  assert.equal(primeira.ok, true);
  const segunda = JSON.parse((await pedir('POST', '/api/auth/pair', { corpo: { codigo } })).body);
  assert.deepEqual(segunda, { ok: false, code: 'codigo_invalido' });
  const outro = criarCodigo();
  const semHeader = await pedir('POST', '/api/auth/pair', { corpo: { codigo: outro }, cabecalhos: { 'x-farol': '' } });
  assert.equal(semHeader.status, 403);
  assert.equal(JSON.parse((await pedir('POST', '/api/auth/pair', { corpo: { codigo: outro } })).body).ok, true, 'a recusa por x-farol não gasta o código');
});

test('o segredo não aparece em log, spawns.log, snapshot, HTML nem URL', async () => {
  await comExigencia(async () => {
    const { codigo, token, resposta } = await parearViaHttp();
    await pedir('POST', '/api/auth/pair', { corpo: { codigo } });   // reuso recusado
    await pedir('POST', '/api/auth/pair', { corpo: { codigo: 'ERRADO2345' } });
    const estado = await pedir('GET', '/api/state', { cabecalhos: bearer(token) });
    const ui = await pedir('GET', '/', { cabecalhos: bearer(token) });
    const appjs = await pedir('GET', '/app.js', { cabecalhos: bearer(token) });
    const textos = {
      'farol.log': fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8') : '',
      'spawns.log': fs.existsSync(SPAWN_LOG_FILE) ? fs.readFileSync(SPAWN_LOG_FILE, 'utf8') : '',
      snapshot: JSON.stringify(engine.snapshot()),
      'GET /api/state': estado.body,
      'GET /': ui.body,
      'GET /app.js': appjs.body,
      'cabeçalhos do pareamento': JSON.stringify(resposta.headers),
    };
    for (const [onde, texto] of Object.entries(textos)) {
      assert.equal(texto.includes(token), false, `token vazou em ${onde}`);
      assert.equal(texto.includes(codigo), false, `código vazou em ${onde}`);
    }
    assert.equal(resposta.headers.location, undefined, 'pareamento nunca redireciona com segredo em URL');
    assert.equal(JSON.parse(resposta.body).token, token, 'o token sai só no corpo do pareamento');
  });
});

test('nenhuma resposta emite Set-Cookie', async () => {
  await comExigencia(async () => {
    const { token, resposta } = await parearViaHttp();
    const respostas = [
      resposta,
      await pedir('GET', '/api/state'),
      await pedir('GET', '/api/state', { cabecalhos: bearer(token) }),
      await pedir('GET', '/api/auth/status', { cabecalhos: bearer(token) }),
      await pedir('POST', '/api/auth/pair', { corpo: { codigo: 'AAAAAAAAAA' } }),
      await pedir('GET', '/'),
      await pedir('GET', '/nao-existe.txt'),
      await primeiroEvento(bearer(token)),
    ];
    for (const r of respostas) assert.equal(r.headers['set-cookie'], undefined);
  });
});

test('modo decidido no servidor: User-Agent forjado não muda nada', async () => {
  const celular = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Termux/0.118' };
  const desktop = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Electron/44.1.0' };
  assert.equal((await pedir('GET', '/api/state', { cabecalhos: celular })).status, 200, 'UA de celular não liga a exigência');
  assert.deepEqual(JSON.parse((await pedir('GET', '/api/auth/status', { cabecalhos: celular })).body), { exigida: false, autenticado: false });
  await comExigencia(async () => {
    assert.equal((await pedir('GET', '/api/state', { cabecalhos: desktop })).status, 401, 'UA de desktop não desliga a exigência');
  });
});

test('POST /api/settings não liga nem desliga localAuth', async () => {
  const antes = engine.config.localAuth;
  await pedir('POST', '/api/settings', { corpo: { localAuth: 'exigir' } });
  assert.equal(engine.config.localAuth, antes);
});

test('sessão sobrevive a reinício do engine e some depois da revogação', async () => {
  engine.config.localAuth = 'exigir';
  const { token } = await parearViaHttp();
  await derrubar();
  await subir();
  engine.config.localAuth = 'exigir';
  assert.equal((await pedir('GET', '/api/state', { cabecalhos: bearer(token) })).status, 200, 'o token continua valendo depois do reinício');
  revogarTodas();
  assert.equal((await pedir('GET', '/api/state', { cabecalhos: bearer(token) })).status, 401, 'revogado não entra mais, sem reiniciar');
  engine.config.localAuth = '';
});
```

- [ ] **Passo 3: rodar e ver falhar.**

```bash
node --test --test-force-exit test/local-auth-http.test.js test/local-auth-inventario.test.js
```

Esperado: as classes recebem `200`/`405` em vez de `401`, e os espiões acusam chamadas. `/api/auth/status` e `/api/auth/pair` respondem `405`/`404`, e o teste novo do inventário reprova com "rota inventariada que o servidor não roteia: /api/auth/pair, /api/auth/status".

- [ ] **Passo 4: criar `lib/local-auth/acesso.js`.**

```js
// Porteiro da API local (A4, spec 7.A4 itens 2, 3 e 5). O lib/http-server.js consulta
// estas três funções e nada mais; a regra fica aqui. No modo que exige, todo /api/* pede
// Authorization: Bearer com uma sessão válida, exceto POST /api/auth/pair e GET
// /api/auth/status. Nenhuma resposta daqui emite cookie: o token sai só no corpo do
// pareamento, e a página o guarda em localStorage, que é isolado por origem.
import { sinaisDoModoCelular } from '../paths.js';
import { ATIVACAO_AUTOMATICA_A4, LOCAL_AUTH } from '../constants.js';
import { detectarModoCelular, exigeAutenticacao } from './modo.js';
import { verificarSessao, emitirSessao } from './sessoes.js';
import { consumirCodigo } from './pareamento.js';
import { rotaPublicaDeAutenticacao } from './inventario.js';

const FORMATO_BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;
const RECUSA = Object.freeze({ status: 401, body: Object.freeze({ error: 'nao_autenticado' }) });
const CODIGO_INVALIDO = Object.freeze({ ok: false, code: 'codigo_invalido' });

// O modo é propriedade do processo e não muda enquanto ele vive: lê os sinais uma vez.
let modoCelularMemo = null;
function modoCelular() {
  if (modoCelularMemo === null) modoCelularMemo = detectarModoCelular(sinaisDoModoCelular());
  return modoCelularMemo;
}

function exigida(config) {
  return exigeAutenticacao({ modoCelular: modoCelular(), config, ativacaoAutomatica: ATIVACAO_AUTOMATICA_A4 });
}

function autenticada(req) {
  const m = FORMATO_BEARER.exec(String(req.headers.authorization || ''));
  return !!m && verificarSessao(m[1]);
}

// Fora do modo que exige, devolve null sem tocar em disco: o desktop segue como hoje.
function recusaSemCredencial(req, rota, config) {
  if (rotaPublicaDeAutenticacao(req.method, rota)) return null;
  if (!exigida(config) || autenticada(req)) return null;
  return RECUSA;
}

function statusAutenticacao(req, config) {
  return { exigida: exigida(config), autenticado: autenticada(req) };
}

function parear(body) {
  const dados = body || {};
  if (!consumirCodigo(String(dados.codigo || ''))) return CODIGO_INVALIDO;
  return { ok: true, token: emitirSessao(String(dados.rotulo || '').slice(0, LOCAL_AUTH.ROTULO_MAX)) };
}

export default { recusaSemCredencial, statusAutenticacao, parear };
export { recusaSemCredencial, statusAutenticacao, parear };
```

- [ ] **Passo 5: fiação em `lib/http-server.js`.** Três inserções, ancoradas por texto (as linhas citadas são as de antes da C1a).
  1. Logo depois de `import { triage } from './log-taxonomy.js';` (linha 10):

```js
import acesso from './local-auth/acesso.js';
```

  2. Logo depois de `if (req.method === 'POST' && req.headers['x-farol'] !== '1') return send(403, { error: 'forbidden' });` (linha 85), antes de `if (p === '/api/state')`:

```js
        // A4: no modo que exige, todo /api/* pede Authorization válido, exceto o
        // pareamento e o status (lib/local-auth/inventario.js). Fica depois da allowlist
        // de Host (C1a) e do x-farol, para o pareamento herdar as duas proteções, e antes
        // de qualquer rota, para nenhuma leitura, SSE ou ação escapar.
        const recusa = acesso.recusaSemCredencial(req, p, engine.config);
        if (recusa) return send(recusa.status, recusa.body);
        if (p === '/api/auth/status' && req.method === 'GET') return send(200, acesso.statusAutenticacao(req, engine.config));
```

  3. Logo depois de `const body = await readBody(req);` (linha 123), antes de `if (p === '/api/check')`:

```js
        // o token de sessão sai SÓ aqui, no corpo da resposta; nunca em cabeçalho,
        // cookie, URL ou log
        if (p === '/api/auth/pair') return send(200, acesso.parear(body));
```

- [ ] **Passo 6: rodar e ver passar.**

```bash
node --test --test-force-exit test/local-auth-http.test.js test/local-auth-inventario.test.js test/http.test.js test/ui-contract.test.js
npm run check && npm run lint
```

Esperado: todos passam. `test/http.test.js` segue igual (desktop sem mudança), e o `lint` não acusa subida em `lib/http-server.js`: nenhuma chave, `JSON.*` ou `catch` novo no arquivo.

- [ ] **Passo 7: contraprova.**
  1. Em `lib/http-server.js`, comentar `if (recusa) return send(recusa.status, recusa.body);`. Rodar `test/local-auth-http.test.js`: reprovam os oito testes `classe ...`, com os espiões acusando chamadas nas classes de ação, e também `sessão sobrevive ... some depois da revogação`. Restaurar.
  2. Mover a linha `const recusa = ...` e o `if (recusa)` para depois do bloco `/api/events` (linha 120). Rodar: reprovam as classes de leitura e evento. Desfazer.
  3. Em `acesso.js`, trocar `rotaPublicaDeAutenticacao(req.method, rota)` por `rota.startsWith('/api/auth/')`. Rodar: reprova `as exceções públicas dependem do método`. Restaurar e confirmar verde.

- [ ] **Passo 8: commit.**

```bash
git add lib/local-auth/acesso.js lib/http-server.js test/local-auth-http.test.js test/local-auth-inventario.test.js
git commit -m "feat(local-auth): API local recusa sem credencial no modo que exige e pareia por codigo"
```

---

## Tarefa 7: comando local de pareamento e pacote

**Arquivos:**
- Criar: `tools/farol-parear.js`
- Modificar: `tools/make-package.ps1` (linha 24: lista de `git status`; linha 47: whitelist `foreach ($t in @(...))`)
- Modificar: `tools/make-installer.ps1` (linha 55 na `main`: whitelist)
- Modificar: `tools/make-offline-mac.sh` (linha 56 na `main`: `for t in ...`)
- Criar: `test/farol-parear.test.js`

**Interfaces:**

```bash
node tools/farol-parear.js                  # stdout: "Código de pareamento: XXXXXXXXXX" + validade; código 0
node tools/farol-parear.js --revogar-todas  # apaga sessões e códigos; código 0
node tools/farol-parear.js <outra coisa>    # stderr: uso; código 2; nada muda
```

```js
executar(args, saida, erro) -> number   // exportada para teste
```

- [ ] **Passo 1: teste que falha.** Criar `test/farol-parear.test.js`:

```js
// Comando local de pareamento (A4, spec 7.A4 itens 3 e 4). O código sai SÓ na saída do
// terminal: nunca em farol.log, spawns.log, arquivo em claro ou linha de comando de outro
// processo. O comando honra FAROL_HOME, porque roda no aparelho ao lado do engine.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const HOME = path.join(os.tmpdir(), 'farol-test-farol-parear-' + process.pid);
process.env.FAROL_HOME = HOME;

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
const { consumirCodigo, criarCodigo } = await import('../lib/local-auth/pareamento.js');
const { emitirSessao, verificarSessao } = await import('../lib/local-auth/sessoes.js');
const { LOG_FILE, LOCAL_AUTH_DIR } = await import('../lib/paths.js');
const { SPAWN_LOG_FILE } = await import('../lib/spawnlog.js');

const RAIZ = path.join(import.meta.dirname, '..');
const CLI = path.join(RAIZ, 'tools', 'farol-parear.js');

function rodar(args = []) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, FAROL_HOME: HOME } });
}

function arquivosDe(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? arquivosDe(p) : [p];
  });
}

beforeEach(() => { fs.rmSync(HOME, { recursive: true, force: true }); });
after(() => { fs.rmSync(HOME, { recursive: true, force: true }); });

test('imprime um código que funciona uma vez, só no stdout e só dentro do FAROL_HOME', () => {
  const r = rodar();
  assert.equal(r.status, 0, r.stderr);
  const m = r.stdout.match(/Código de pareamento: ([A-Z2-7]{10})\n/);
  assert.ok(m, `saída inesperada: ${r.stdout}`);
  const codigo = m[1];
  assert.match(r.stdout, /Vale por 10 minutos e funciona uma vez só\./);
  assert.equal(r.stderr, '');
  for (const arq of arquivosDe(HOME)) {
    assert.equal(fs.readFileSync(arq, 'utf8').includes(codigo), false, `código em claro em ${arq}`);
  }
  assert.equal(fs.existsSync(LOG_FILE), false, 'o comando não escreve farol.log');
  assert.equal(fs.existsSync(SPAWN_LOG_FILE), false, 'o comando não escreve spawns.log');
  assert.ok(fs.existsSync(path.join(LOCAL_AUTH_DIR, 'pareamentos.json')), 'o pareamento fica no FAROL_HOME do teste');
  assert.equal(consumirCodigo(codigo), true);
  assert.equal(consumirCodigo(codigo), false);
});

test('--revogar-todas derruba sessões e códigos pendentes', () => {
  const token = emitirSessao('celular');
  const codigo = criarCodigo();
  const r = rodar(['--revogar-todas']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /revogados/);
  assert.equal(verificarSessao(token), false);
  assert.equal(consumirCodigo(codigo), false);
});

test('argumento desconhecido não gera código nem mexe em nada', () => {
  const r = rodar(['--codigo', 'ABCDEFGHIJ']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Uso: node tools\/farol-parear\.js \[--revogar-todas\]/);
  assert.equal(r.stdout, '');
  assert.equal(fs.existsSync(LOCAL_AUTH_DIR), false);
});

test('farol-parear.js viaja no pacote leve, no Setup.exe e no offline do macOS', () => {
  const pacote = fs.readFileSync(path.join(RAIZ, 'tools', 'make-package.ps1'), 'utf8');
  const setup = fs.readFileSync(path.join(RAIZ, 'tools', 'make-installer.ps1'), 'utf8');
  const offline = fs.readFileSync(path.join(RAIZ, 'tools', 'make-offline-mac.sh'), 'utf8');
  assert.match(pacote, /foreach \(\$t in @\([^)]*'farol-parear\.js'/, 'whitelist do pacote leve');
  assert.match(pacote, /tools\/farol-parear\.js/, 'o pacote recusa árvore suja também neste arquivo');
  assert.match(setup, /foreach \(\$t in @\([^)]*'farol-parear\.js'/, 'whitelist do Setup.exe');
  assert.match(offline, /for t in [^;\n]*\bfarol-parear\.js\b/, 'whitelist do offline do macOS');
});
```

- [ ] **Passo 2: rodar e ver falhar.**

```bash
node --test --test-force-exit test/farol-parear.test.js
```

Esperado: `Cannot find module .../tools/farol-parear.js` nos três primeiros (status diferente de 0) e reprova da whitelist no quarto.

- [ ] **Passo 3: criar `tools/farol-parear.js`.**

```js
// Pareamento da API local (A4, spec 7.A4 itens 3 e 4). Imprime um código novo SÓ na saída
// do terminal, ou revoga todas as sessões e códigos com --revogar-todas. Roda no próprio
// aparelho, com o mesmo FAROL_HOME do engine (lib/paths.js resolve). O código nunca vai
// para log, arquivo em claro nem linha de comando de outro processo, e o comando não
// aceita segredo por argumento.
import { executadoDireto } from '../lib/paths.js';
import { TEMPOS } from '../lib/constants.js';
import { criarCodigo, revogarCodigos } from '../lib/local-auth/pareamento.js';
import { revogarTodas } from '../lib/local-auth/sessoes.js';

const MINUTO_MS = TEMPOS.HORA_MS / 60;
const USO = 'Uso: node tools/farol-parear.js [--revogar-todas]\n';

function executar(args, saida, erro) {
  if (args.length === 1 && args[0] === '--revogar-todas') {
    revogarTodas();
    revogarCodigos();
    saida.write('Todas as sessões autorizadas e códigos de pareamento foram revogados.\n');
    return 0;
  }
  if (args.length) {
    erro.write(USO);
    return 2;
  }
  const codigo = criarCodigo();
  const minutos = Math.round(TEMPOS.PAREAMENTO_VALIDADE_MS / MINUTO_MS);
  saida.write(`Código de pareamento: ${codigo}\nVale por ${minutos} minutos e funciona uma vez só.\n`);
  return 0;
}

if (executadoDireto(import.meta.url)) process.exitCode = executar(process.argv.slice(2), process.stdout, process.stderr);

export default { executar };
export { executar };
```

- [ ] **Passo 4: acrescentar o arquivo às três whitelists.**
  1. `tools/make-package.ps1`, linha 24: trocar `installer tools/jira-mcp.js 2>$null` por `installer tools/jira-mcp.js tools/farol-parear.js 2>$null`.
  2. `tools/make-package.ps1`, linha 47: trocar `foreach ($t in @('jira-mcp.js', 'make-icons.ps1', 'pack-ico.js', 'make-package.ps1', 'make-icns.sh')) {` por `foreach ($t in @('jira-mcp.js', 'farol-parear.js', 'make-icons.ps1', 'pack-ico.js', 'make-package.ps1', 'make-icns.sh')) {`. Logo acima da linha 46 (`New-Item -ItemType Directory -Force -Path (Join-Path $staging 'tools')`), acrescentar o comentário:

```powershell
# farol-parear.js tambem e runtime: e o comando que gera o codigo de pareamento da API
# local no proprio aparelho (A4). Sem ele na copia instalada nao ha como parear.
```

  3. `tools/make-installer.ps1`, linha 55: a mesma troca da whitelist (acrescentar `'farol-parear.js', ` depois de `'jira-mcp.js', `).
  4. `tools/make-offline-mac.sh`, linha 56: trocar `for t in jira-mcp.js make-icons.ps1 pack-ico.js make-package.ps1 make-icns.sh; do` por `for t in jira-mcp.js farol-parear.js make-icons.ps1 pack-ico.js make-package.ps1 make-icns.sh; do`.

- [ ] **Passo 5: rodar e ver passar.**

```bash
node --test --test-force-exit test/farol-parear.test.js test/pacote-runtime-tools.test.js
npm run check && npm run lint
```

Esperado: todos passam; `pacote-runtime-tools` segue verde porque as três whitelists continuam iguais entre si.

- [ ] **Passo 6: contraprova.**
  1. Em `tools/make-offline-mac.sh`, tirar `farol-parear.js ` da lista. Rodar os dois arquivos: reprovam `farol-parear.js viaja no pacote leve ...` e `offline macOS copia a mesma whitelist de tools do pacote leve`. Restaurar.
  2. Em `tools/farol-parear.js`, trocar `saida.write(\`Código de pareamento: ${codigo}` por `erro.write(\`Código de pareamento: ${codigo}`. Rodar: reprova o primeiro teste (stdout sem código, stderr não vazio). Restaurar e confirmar verde.

- [ ] **Passo 7: commit.**

```bash
git add tools/farol-parear.js tools/make-package.ps1 tools/make-installer.ps1 tools/make-offline-mac.sh test/farol-parear.test.js
git commit -m "feat(local-auth): comando local de pareamento e revogacao, levado no pacote"
```

---

## Tarefa 8: transporte autenticado da UI

**Arquivos:**
- Criar: `ui/transporte.js`
- Criar: `test/ui-transporte.test.js`
- Modificar: `test/local-auth-http.test.js` (acrescentar o teste ponta a ponta)

**Interfaces:**

```js
tokenLocal(armazenamento = globalThis.localStorage) -> string          // '' sem token válido ou com storage que lança
comAutorizacao(cabecalhos = {}, token = tokenLocal()) -> object         // cópia, com Authorization só quando há token
separarEventos(texto) -> { eventos: [{ tipo, dados }], resto: string }
class FonteDeEventosAutenticada(url, obterToken = tokenLocal, fetchImpl, agendar)
  // addEventListener(tipo, fn), onerror, close(); emite 'open' e os eventos nomeados com { data }
```

A chave em `localStorage` é `farol-auth-token`. Quem grava o token é a tela de pareamento (Tarefa 9, bloqueada); até lá o caminho autenticado só é exercitado em teste.

- [ ] **Passo 1: teste isolado que falha.** Criar `test/ui-transporte.test.js`:

```js
// Transporte autenticado da UI (A4, spec 7.A4 item 2). Sem token, nada muda. Com token,
// toda chamada leva Authorization: Bearer e o SSE é lido por fetch, porque EventSource
// não aceita cabeçalho e o token nunca vai em URL. Módulo de navegador sem import: pode
// ser carregado direto no Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenLocal, comAutorizacao, separarEventos, FonteDeEventosAutenticada } from '../ui/transporte.js';

const TOKEN = 'a'.repeat(21) + '_' + 'B'.repeat(20) + '-';

function armazenamento(valor) { return { getItem: () => valor }; }

test('tokenLocal só devolve token com o formato de 32 bytes base64url', () => {
  assert.equal(tokenLocal(armazenamento(TOKEN)), TOKEN);
  assert.equal(tokenLocal(armazenamento(null)), '');
  assert.equal(tokenLocal(armazenamento('curto')), '');
  assert.equal(tokenLocal(armazenamento(TOKEN + '"')), '');
  assert.equal(tokenLocal(undefined), '');
});

test('tokenLocal não derruba a página quando o localStorage lança', () => {
  assert.equal(tokenLocal({ getItem() { throw new Error('bloqueado'); } }), '');
});

test('comAutorizacao só acrescenta o cabeçalho com token e não muta a entrada', () => {
  const base = { 'x-farol': '1' };
  assert.deepEqual(comAutorizacao(base, ''), { 'x-farol': '1' });
  assert.deepEqual(comAutorizacao(base, TOKEN), { 'x-farol': '1', Authorization: `Bearer ${TOKEN}` });
  assert.deepEqual(base, { 'x-farol': '1' });
});

test('separarEventos junta pedaços, ignora comentário e devolve o resto', () => {
  const r = separarEventos('event: state\ndata: {"a":1}\n\n: ping\n\nevent: toast\ndata: linha1\ndata: linha2\n\nevent: chat\ndata: {"pela');
  assert.deepEqual(r.eventos, [{ tipo: 'state', dados: '{"a":1}' }, { tipo: 'toast', dados: 'linha1\nlinha2' }]);
  assert.equal(r.resto, 'event: chat\ndata: {"pela');
});

function streamDe(partes) {
  const cod = new TextEncoder();
  return new ReadableStream({ start(c) { for (const p of partes) c.enqueue(cod.encode(p)); c.close(); } });
}

test('a fonte autenticada manda o cabeçalho, nunca o token na URL, e entrega os eventos', async () => {
  const pedidos = [];
  const agendados = [];
  const fetchFalso = async (url, init) => {
    pedidos.push({ url, init });
    return { ok: true, status: 200, body: streamDe(['event: state\ndata: {"x"', ':1}\n\n: ping\n\n']) };
  };
  const fonte = new FonteDeEventosAutenticada('/api/events', () => TOKEN, fetchFalso, (fn, ms) => agendados.push({ fn, ms }));
  const recebidos = [];
  let abriu = 0, erros = 0;
  fonte.addEventListener('open', () => abriu++);
  fonte.addEventListener('state', e => recebidos.push(e.data));
  fonte.onerror = () => erros++;
  assert.equal(agendados.length, 1);
  assert.equal(agendados[0].ms, 0);
  await agendados.shift().fn();
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].url, '/api/events', 'o token nunca vai em URL');
  assert.equal(pedidos[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(abriu, 1);
  assert.deepEqual(recebidos, ['{"x":1}']);
  assert.equal(erros, 1, 'fim do stream avisa como o EventSource');
  assert.equal(agendados.length, 1, 'e agenda a reconexão');
  assert.equal(agendados[0].ms, 3000);
});

test('recusa do servidor (401) avisa e reconecta, sem emitir evento', async () => {
  const agendados = [];
  const fonte = new FonteDeEventosAutenticada('/api/events', () => TOKEN, async () => ({ ok: false, status: 401, body: null }), (fn, ms) => agendados.push({ fn, ms }));
  let abriu = 0, erros = 0;
  fonte.addEventListener('open', () => abriu++);
  fonte.onerror = () => erros++;
  await agendados.shift().fn();
  assert.equal(abriu, 0);
  assert.equal(erros, 1);
  assert.equal(agendados.length, 1);
});

test('close interrompe e não reagenda', async () => {
  const agendados = [];
  const fonte = new FonteDeEventosAutenticada('/api/events', () => TOKEN, async () => ({ ok: false, status: 500, body: null }), (fn, ms) => agendados.push({ fn, ms }));
  fonte.close();
  await agendados.shift().fn();
  assert.equal(agendados.length, 0);
});
```

- [ ] **Passo 2: teste ponta a ponta que falha.** Ao final de `test/local-auth-http.test.js`, acrescentar (antes do teste de reinício, ou depois dele com `engine.config.localAuth = 'exigir'` já restaurado para `''`; ele liga a exigência por conta própria):

```js
test('transporte da UI lê o SSE real com o cabeçalho no modo que exige', async () => {
  const { FonteDeEventosAutenticada } = await import('../ui/transporte.js');
  await comExigencia(async () => {
    const { token } = await parearViaHttp('navegador');
    const estado = await new Promise((resolve, reject) => {
      const fonte = new FonteDeEventosAutenticada('/api/events', () => token, (url, init) => fetch(base + url, init), (fn, ms) => { if (ms === 0) fn(); });
      fonte.onerror = () => reject(new Error('o stream autenticado falhou'));
      fonte.addEventListener('state', e => { fonte.close(); resolve(JSON.parse(e.data)); });
    });
    assert.ok(estado.decisions, 'o evento state chegou com o snapshot');
  });
});
```

- [ ] **Passo 3: rodar e ver falhar.**

```bash
node --test --test-force-exit test/ui-transporte.test.js test/local-auth-http.test.js
```

Esperado: `ERR_MODULE_NOT_FOUND` para `../ui/transporte.js`, no arquivo novo e no teste ponta a ponta.

- [ ] **Passo 4: criar `ui/transporte.js`.**

```js
/* Transporte autenticado da UI (A4, spec 7.A4 item 2).
   Sem token salvo, nada muda: api() e get() seguem sem cabeçalho e o SSE segue no
   EventSource. Com token (depois do pareamento), toda chamada leva Authorization: Bearer
   e o SSE passa a ser lido por fetch, porque EventSource não aceita cabeçalho e o token
   nunca vai em URL. Sem cookie de propósito: localStorage é isolado por origem (esquema,
   host e porta), e cookie não é isolado por porta (RFC 6265, seção 8.5). */

const CHAVE_TOKEN = 'farol-auth-token';
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;
// a mesma espera de reconexão que os navegadores usam por padrão no EventSource
const RECONEXAO_MS = 3000;

// localStorage pode lançar (janela privada, dados do site bloqueados). Sem token legível
// a página segue no caminho de sempre.
export function tokenLocal(armazenamento = globalThis.localStorage) {
  try {
    const t = String((armazenamento && armazenamento.getItem(CHAVE_TOKEN)) || '');
    return FORMATO_TOKEN.test(t) ? t : '';
  } catch {
    return '';
  }
}

export function comAutorizacao(cabecalhos = {}, token = tokenLocal()) {
  return token ? { ...cabecalhos, Authorization: `Bearer ${token}` } : { ...cabecalhos };
}

function lerBloco(bloco) {
  let tipo = 'message';
  const dados = [];
  for (const linha of bloco.split('\n')) {
    if (linha.startsWith('event:')) tipo = linha.slice(6).trim();
    if (linha.startsWith('data:')) dados.push(linha.slice(5).replace(/^ /, ''));
  }
  return dados.length ? { tipo, dados: dados.join('\n') } : null;
}

// O que sobra depois do último separador é evento pela metade: volta como resto para
// juntar com o próximo pedaço do stream.
export function separarEventos(texto) {
  const blocos = String(texto).replace(/\r\n/g, '\n').split('\n\n');
  const resto = blocos.pop();
  const eventos = [];
  for (const bloco of blocos) {
    const evento = lerBloco(bloco);
    if (evento) eventos.push(evento);
  }
  return { eventos, resto };
}

export class FonteDeEventosAutenticada {
  constructor(url, obterToken = tokenLocal, fetchImpl = (u, init) => globalThis.fetch(u, init), agendar = (fn, ms) => setTimeout(fn, ms)) {
    this.url = url;
    this.obterToken = obterToken;
    this.fetchImpl = fetchImpl;
    this.agendar = agendar;
    this.ouvintes = new Map();
    this.onerror = null;
    this.fechada = false;
    this.controle = null;
    this.agendar(() => this.abrir(), 0);
  }

  addEventListener(tipo, fn) {
    this.ouvintes.set(tipo, [...(this.ouvintes.get(tipo) || []), fn]);
  }

  close() {
    this.fechada = true;
    if (this.controle) this.controle.abort();
  }

  emitir(tipo, dados) {
    for (const fn of this.ouvintes.get(tipo) || []) fn({ data: dados });
  }

  // Queda, fim do stream e recusa (token revogado) seguem o contrato do EventSource:
  // avisa por onerror e tenta de novo depois da espera.
  async abrir() {
    if (this.fechada) return;
    this.controle = new AbortController();
    await this.ler().catch(() => false);
    if (this.fechada) return;
    if (this.onerror) this.onerror();
    this.agendar(() => this.abrir(), RECONEXAO_MS);
  }

  async ler() {
    const init = { headers: comAutorizacao({ Accept: 'text/event-stream' }, this.obterToken()), signal: this.controle.signal };
    const resposta = await this.fetchImpl(this.url, init);
    if (!resposta.ok || !resposta.body) return false;
    this.emitir('open', '');
    const leitor = resposta.body.getReader();
    const decodificador = new TextDecoder();
    let resto = '';
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) return true;
      const lote = separarEventos(resto + decodificador.decode(value, { stream: true }));
      resto = lote.resto;
      lote.eventos.forEach(e => this.emitir(e.tipo, e.dados));
    }
  }
}
```

- [ ] **Passo 5: rodar e ver passar.**

```bash
node --test --test-force-exit test/ui-transporte.test.js test/local-auth-http.test.js
npm run check && npm run lint
```

Esperado: todos passam; `lint` sem violação nova em `ui/transporte.js`.

- [ ] **Passo 6: contraprova.**
  1. Em `ler()`, trocar `this.fetchImpl(this.url, init)` por `this.fetchImpl(\`${this.url}?token=${this.obterToken()}\`, init)`. Rodar `test/ui-transporte.test.js`: reprova `nunca o token na URL`. Restaurar.
  2. Em `comAutorizacao`, trocar `Authorization: \`Bearer ${token}\`` por `Authorization: token`. Rodar os dois arquivos: reprovam o teste isolado e o ponta a ponta (401 do servidor, rejeição "o stream autenticado falhou"). Restaurar e confirmar verde.

- [ ] **Passo 7: commit.**

```bash
git add ui/transporte.js test/ui-transporte.test.js test/local-auth-http.test.js
git commit -m "feat(local-auth): transporte da UI com Authorization e SSE lido por fetch"
```

---

## Tarefa 9: fiação do transporte no `ui/app.js`

**Arquivos:**
- Modificar: `ui/app.js` (import depois da linha 22 `} from './pure.js';`; `api()` linhas 56-62; `get()` linha 63; `connect()` linha 4302)
- Criar: `test/ui-transporte-app.test.js`

**Interfaces:** nenhuma nova. `api()`, `get()` e `connect()` mantêm assinatura e comportamento sem token.

- [ ] **Passo 1: teste que falha.** Criar `test/ui-transporte-app.test.js`:

```js
// O ui/app.js usa o transporte autenticado SÓ quando há token (A4). Sem token, o caminho
// de sempre (EventSource e fetch sem cabeçalho) segue coberto pelo test/app-carrega.test.js.
// Aqui a página carrega com um token salvo e o teste confere o que sai pela rede.
// Arquivo próprio porque o app.js é módulo de navegador carregado uma vez por processo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { instalarDom } from './helpers/dom-stub.js';

const TOKEN = 'c'.repeat(43);
const APPJS = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'app.js'), 'utf8');

instalarDom();
globalThis.localStorage.setItem('farol-auth-token', TOKEN);
let eventSourceCriados = 0;
globalThis.EventSource = class { constructor() { eventSourceCriados++; } addEventListener() { } close() { } };
const pedidos = [];
globalThis.fetch = async (url, init = {}) => {
  pedidos.push({ url: String(url), init });
  return { ok: false, status: 401, body: null, json: async () => ({}), text: async () => '' };
};
await import('../ui/app.js');
await new Promise(resolve => setTimeout(resolve, 50));

test('com token salvo, o SSE sai por fetch com Authorization e nenhum EventSource é criado', () => {
  assert.equal(eventSourceCriados, 0);
  const eventos = pedidos.filter(p => p.url === '/api/events');
  assert.ok(eventos.length >= 1, 'o stream autenticado foi aberto');
  assert.equal(eventos[0].init.headers.Authorization, `Bearer ${TOKEN}`);
});

test('nenhuma requisição leva o token na URL', () => {
  for (const p of pedidos) assert.equal(p.url.includes(TOKEN), false, `token em URL: ${p.url}`);
});

test('api() e get() passam pelos cabeçalhos com autorização', () => {
  assert.match(APPJS, /import \{ tokenLocal, comAutorizacao, FonteDeEventosAutenticada \} from '\.\/transporte\.js';/);
  assert.match(APPJS, /headers: comAutorizacao\(\{ 'Content-Type': 'application\/json', 'x-farol': '1' \}\)/);
  assert.match(APPJS, /function get\(path\) \{ return fetch\(path, \{ headers: comAutorizacao\(\) \}\)/);
  assert.match(APPJS, /const es = tokenLocal\(\) \? new FonteDeEventosAutenticada\('\/api\/events'\) : new EventSource\('\/api\/events'\);/);
});
```

- [ ] **Passo 2: rodar e ver falhar.**

```bash
node --test --test-force-exit test/ui-transporte-app.test.js
```

Esperado: reprovam os três testes (`eventSourceCriados` igual a 1, nenhum `fetch` para `/api/events` e regex ausentes no fonte).

- [ ] **Passo 3: fiação mínima em `ui/app.js`.**
  1. Logo depois da linha 22 (`} from './pure.js';`):

```js
import { tokenLocal, comAutorizacao, FonteDeEventosAutenticada } from './transporte.js';
```

  2. Trocar as linhas 56-63:

```js
function api(path, body) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-farol': '1' },
    body: JSON.stringify(body || {})
  }).then(r => r.json()).catch(() => null);
}
function get(path) { return fetch(path).then(r => r.json()).catch(() => null); }
```

  por:

```js
// A4: com token de pareamento salvo, as chamadas levam Authorization (ui/transporte.js);
// sem token, os cabeçalhos são exatamente os de sempre.
function api(path, body) {
  return fetch(path, {
    method: 'POST',
    headers: comAutorizacao({ 'Content-Type': 'application/json', 'x-farol': '1' }),
    body: JSON.stringify(body || {})
  }).then(r => r.json()).catch(() => null);
}
function get(path) { return fetch(path, { headers: comAutorizacao() }).then(r => r.json()).catch(() => null); }
```

  3. Na linha 4302, trocar `const es = new EventSource('/api/events');` por:

```js
  // EventSource não aceita cabeçalho: com token, o stream é lido por fetch (A4)
  const es = tokenLocal() ? new FonteDeEventosAutenticada('/api/events') : new EventSource('/api/events');
```

- [ ] **Passo 4: rodar e ver passar, incluindo o app sem token.**

```bash
node --test --test-force-exit test/ui-transporte-app.test.js test/app-carrega.test.js test/ui-contract.test.js
npm run check && npm run lint
```

Esperado: todos passam. `app-carrega` segue verde (sem token, o `EventSource` do stub registra o handler de `state`), `ui-contract` segue achando `new EventSource('/api/events')`, e o `lint` não sobe `ui/app.js` (um ternário simples, sem `JSON.*` nem chave nova).

- [ ] **Passo 5: contraprova.**
  1. Voltar a linha do `connect()` para `const es = new EventSource('/api/events');`. Rodar `test/ui-transporte-app.test.js`: reprovam o primeiro e o terceiro teste. Restaurar.
  2. Voltar `get()` para `fetch(path)`. Rodar: reprova `api() e get() passam pelos cabeçalhos`. Restaurar e confirmar verde.

- [ ] **Passo 6: commit.**

```bash
git add ui/app.js test/ui-transporte-app.test.js
git commit -m "feat(ui): api, get e eventos usam o transporte autenticado quando ha token"
```

---

## Tarefa 10: tela de pareamento e ativação automática

**BLOQUEADA: depende do desenho da tela de pareamento no Claude Design (D9)**

**O que falta, sem código neste plano:**

1. **Tela de pareamento**, vinda do Claude Design (regra do dono: layout e arquitetura de abas saem de lá; spec só descreve estados e dados). Estados e dados disponíveis hoje:
   - `GET /api/auth/status` responde `{ exigida, autenticado }`;
   - `POST /api/auth/pair` recebe `{ codigo, rotulo }` e responde `{ ok: true, token }` ou `{ ok: false, code: 'codigo_invalido' }`;
   - quem grava o token é a tela: `localStorage['farol-auth-token']`, dentro de `try/catch`, seguido de reconexão do SSE (`connect()`);
   - estados que a tela precisa cobrir: "autenticação exigida e sem sessão", "código recusado" (não diferencia erro, prazo e bloqueio por 5 erros, de propósito) e "sessão revogada ou expirada". Neste último, o SSE autenticado recebe 401 e hoje só mostra "reconectando".
2. **Tela de revogação individual** (spec 7.A4, item 4), que exige listar sessões com rótulo e datas. Hoje só existe `--revogar-todas`.
3. **Virar `ATIVACAO_AUTOMATICA_A4` para `true`** em `lib/constants.js` e trocar, no mesmo commit, a asserção de `test/local-auth-modo.test.js` para o novo contrato.
4. **Validação externa (spec, seção 13):** detecção do modo celular num Termux real (Node nativo `platform === 'android'`, variáveis do Termux) e num proot Debian (sinal por `/proc/sys/kernel/osrelease`, que precisa conter `android` no kernel medido), e alcance de outros apps do Android ao loopback com e sem a exigência.

**Condições de desbloqueio (todas):**
- desenho da tela de pareamento aprovado pelo dono no Claude Design (D9);
- este plano mergeado (núcleo, transporte e comando);
- C1a mergeada;
- medições da seção 13 registradas em `EXECUCAO.md` num Termux e num proot reais.

Enquanto qualquer uma faltar, a operação no celular **não** é declarada pronta para uso seguro (spec 6.3).

---

## Tarefa 11: gate final e evidência

**Arquivos:**
- Modificar: `CLAUDE.md` (tabela "Mapa de arquivos": depois da linha de `lib/spawnlog.js` e depois da linha de `tools/jira-mcp.js`)
- Criar ou acrescentar: `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md`

- [ ] **Passo 1: mapa de arquivos do `CLAUDE.md`.** Logo depois da linha `| \`lib/spawnlog.js\` | ... |`:

```markdown
| **`lib/local-auth/`** | **Autenticação da API local (A4): o núcleo existe, a exigência automática no celular está DESLIGADA** (`ATIVACAO_AUTOMATICA_A4 = false` em `lib/constants.js`, travada em teste até a tela de pareamento do Claude Design existir). Hoje só `config.localAuth: 'exigir'` (arquivo, nunca a tela) liga a exigência. `modo.js` (puro) decide modo celular e exigência sem olhar User-Agent; `pareamento.js` e `sessoes.js` guardam só hash em `~/.farol/local-auth/` com 0600 a cada gravação; `inventario.js` classifica cada rota `/api` (rota nova sem classe reprova em `test/local-auth-inventario.test.js`); `acesso.js` é o porteiro que o `http-server.js` consulta depois da allowlist de Host e do `x-farol`. Sem cookie: o token sai só no corpo de `POST /api/auth/pair` |
```

Logo depois da linha `| \`tools/jira-mcp.js\` | ... |`:

```markdown
| `tools/farol-parear.js` | Comando local da A4: imprime um código de pareamento SÓ no stdout (10 caracteres, 10 minutos, uso único) e `--revogar-todas`. Honra `FAROL_HOME`. Viaja nas três whitelists de `tools/` (pacote leve, Setup.exe, offline do macOS) |
```

E, na linha de `ui/` (`| \`ui/\` | UI sem framework: ...`), acrescentar ao fim da descrição: ` ; \`ui/transporte.js\` é o transporte autenticado (Authorization e SSE por fetch, só com token salvo)`.

- [ ] **Passo 2: gate completo.**

```bash
npm run check && npm run lint && npm test
```

Esperado: os três com código 0. Anotar o número de arquivos que o `check` imprime e o total de testes que o `npm test` imprime.

- [ ] **Passo 3: gate da constituição.**

```bash
npm run eng
```

Esperado: código 0 com as avaliações escritas dos commits desta branch. Ele compara contra `origin/main`, então roda na branch, não na `main`.

- [ ] **Passo 4: registrar a evidência.** Criar o arquivo se não existir; se existir, acrescentar a seção ao fim:

```markdown
## A4 núcleo (autenticação da API local, sem exigência automática)

- Branch: `feat/a4-autenticacao-local`, base `origin/main` em <sha da base>.
- C1a presente: `git grep -n validarHostEOrigem` -> <linhas>.
- Rotas: 46 da spec + 2 públicas (`/api/auth/pair`, `/api/auth/status`), conferido por `test/local-auth-inventario.test.js`.
- Gate: `npm run check` (<N> arquivos), `npm run lint` (sem subida), `npm test` (<N> testes, 0 falhas), `npm run eng` (código 0).
- Contraprovas executadas e restauradas: Tarefas 1 a 9, uma linha por mutação com o teste que reprovou.
- Commits: <sha curto e mensagem de cada tarefa>.
- `ATIVACAO_AUTOMATICA_A4`: false (confirmado).
- Pendente de validação externa (spec, seção 13): detecção do modo celular em Termux e proot reais; alcance de outros apps ao loopback. Tela de pareamento bloqueada por D9 (Tarefa 10).
```

Preencher cada `<...>` com o valor medido no Passo 2 e no `git log --oneline origin/main..HEAD`. Nenhum campo fica sem valor.

- [ ] **Passo 5: commit.**

```bash
git add CLAUDE.md docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md
git commit -m "docs: mapa de arquivos e evidencia da execucao do nucleo da A4"
```

---

## Critérios de aceite da spec x testes

| Critério (spec 7.A4 e CT-COMPAT, item b) | Teste | Situação |
|---|---|---|
| No modo que exige, sem credencial não recebe estado, relatório, log, chat nem SSE, e não executa ação, com um teste por classe | `test/local-auth-http.test.js`: oito testes `classe <nome>: sem credencial recebe 401, sem dado e sem ação`, com espiões em todo método do engine chamado por rota | coberto |
| Segredo fora de log, HTML, snapshot, URL e linha de comando | `local-auth-http`: `o segredo não aparece em log, spawns.log, snapshot, HTML nem URL`; `farol-parear`: código só no stdout e argumento de segredo recusado; `ui-transporte` e `ui-transporte-app`: token nunca em URL | coberto |
| Código não funciona duas vezes, depois do prazo nem depois de 5 erros | `local-auth-pareamento`: uso único, prazo, 5 erros (com a fronteira de 4); `local-auth-http`: reuso via HTTP | coberto |
| Modo decidido no servidor mesmo com User-Agent forjado | `local-auth-http`: `User-Agent forjado não muda nada`; `local-auth-modo`: `a decisão do modo nunca lê User-Agent` | coberto |
| Sessão sobrevive a reinício e some depois da revogação | `local-auth-http`: reinício do engine com o mesmo `FAROL_HOME`; `local-auth-sessoes` e `farol-parear`: `--revogar-todas` | coberto |
| Servidor em outra porta não obtém o token (nenhum cookie; token só no corpo do pareamento) | `local-auth-http`: `nenhuma resposta emite Set-Cookie` e a checagem dos cabeçalhos do pareamento | coberto no transporte; **pendente**: prova com navegador real e outra porta de `127.0.0.1` fica para a validação da tela |
| Rota nova sem classe reprova | `local-auth-inventario`: `toda rota servida tem classe` e `sem classe morta` | coberto |
| `ATIVACAO_AUTOMATICA_A4` falsa até existir a tela | `local-auth-modo`: `ATIVACAO_AUTOMATICA_A4 nasce desligada` | coberto |
| Detecção verdadeira para cada sinal e falsa em win32, darwin, Linux comum e WSL | `local-auth-modo`: dois testes de sinais | coberto em teste; **pendente de validação externa**: Termux e proot reais (seção 13) |
| Nenhuma config desliga a exigência no modo celular | `local-auth-modo`: `modo celular com a ativação ligada exige, e nenhuma config desliga` | coberto |
| Desktop fora do modo que exige: nada muda | `test/http.test.js` e `test/app-carrega.test.js` inalterados e verdes; `local-auth-http`: `desktop sem localAuth`; `ui-transporte`: sem token não há cabeçalho | coberto |
| Arquivos 0600 | `local-auth-pareamento` e `local-auth-sessoes` (pulam no Windows, rodam no CI Linux e macOS) | coberto no POSIX |
| Alcance de outros apps do Android ao loopback | nenhum teste simulado declara isso | **pendente de validação externa** (seção 13) |
| Tela de pareamento, revogação individual e ativação automática | Tarefa 10 | **bloqueado** (D9) |
