# C1a Allowlist de Host: plano de implementação

> **Para quem executa:** use superpowers:executing-plans, tarefa por tarefa, marcando os checkboxes.

**Objetivo:** recusar, antes de qualquer rota do servidor local (leituras, SSE, POST e arquivos estáticos), toda requisição cujo `Host` não seja `127.0.0.1:<porta>` ou `localhost:<porta>` na porta efetiva do socket, e toda requisição com `Origin` presente fora de `http://127.0.0.1:<porta>` ou `http://localhost:<porta>`. Isso fecha o DNS rebinding e a página de outra origem, sem mudar o que o Electron, o navegador do próprio aparelho e o `curl` das sessões já mandam.

**Arquitetura:** uma função PURA nova, `validarHostEOrigem({ host, origin, porta })`, em `lib/http-guard.js` (sem IO, sem estado, sem config). O `startServer` de `lib/http-server.js` chama essa função logo depois de montar o `send` e antes do `try` que roteia. A porta vem de `server.address().port`, e não de `engine.config.port`: com a config em `0` (porta efêmera, usada pela suíte) as duas divergem. A recusa sai como `403` JSON `{ error: 'forbidden', motivo }`. Nenhum cabeçalho CORS é emitido. As travas `x-farol` (linha 85) e `x-farol-review-cap` (linhas 177 a 180) ficam intocadas.

**Stack:** Node ESM puro (`node:http`, `node:net`), runner nativo `node --test`, zero dependências.

**Spec:** `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md`, seção 7.C1a (escopo e critérios de aceite), com o inventário de rotas da seção 7.A4, a linha "C1a allowlist de Host" da tabela (b) do CT-COMPAT (seção 5) e as regras da seção 15.

**Restrições globais:**
- Zero dependências novas: nada entra em `package.json`.
- Texto e comentários em português, sem travessão (use vírgula, parênteses ou dois pontos).
- A contagem do ratchet não sobe: nada de `JSON.parse`/`JSON.stringify` fora de `lib/io.js` no código de produção novo.
- Nada de `process.env` fora de `lib/paths.js` e `lib/env.js` no código de produção novo.
- Nada de número mágico de tempo fora de `lib/constants.js`.
- Nenhum `catch` vazio sem comentário de intenção.
- Nenhum ternário aninhado (dois `?` no mesmo statement).
- Profundidade de chaves dentro de função no máximo 3.
- Arquivo novo abaixo de 400 linhas úteis.
- Não rode `npm run lint:update`: a baseline desta entrega fica como está.
- Testes usam `node --test` e `FAROL_HOME` temporário com `await import()` depois da env (trava de `test/test-isolation.test.js`), nunca o `~/.farol` real.
- Nenhuma atribuição de IA em commit (sem `Co-Authored-By`, sem rodapé de ferramenta).

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `lib/http-guard.js` | criar | `validarHostEOrigem`: decide pela allowlist de Host e Origin, pura |
| `test/http-guard.test.js` | criar | testes unitários da função pura (9 testes) |
| `lib/http-server.js` | modificar (import depois da linha 10; guarda entre as linhas 81 e 83) | aplica a guarda antes de qualquer rota, com a porta efetiva do socket |
| `test/http-host-allowlist.test.js` | criar | integração com o servidor real: uma rota por classe do inventário da A4, estático, SSE, Origin, Electron, navegador local, porta, `x-farol` (28 testes) |
| `CLAUDE.md` | modificar (linha 23, acrescenta uma linha na tabela logo abaixo) | mapa de arquivos ganha `lib/http-guard.js` |
| `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md` | criar (não existe neste worktree) | registro da execução: comandos, contagens, critério x teste |

Fatos conferidos no código que o plano usa:
- `lib/http-server.js`: imports nas linhas 4 a 10; `startServer` nas linhas 54 a 209; `send` nas linhas 78 a 81; `try` na 83; `if (p.startsWith('/api/'))` na 84; checagem `x-farol` só em POST na 85; SSE `/api/events` nas linhas 113 a 120; 405 na 122; estáticos nas linhas 186 a 193; `server.listen(engine.config.port, '127.0.0.1', ...)` na 200.
- `lib/constants.js` exporta `DEFAULT_PORT` (linhas 121 e 122).
- `main.js` carrega `http://127.0.0.1:${eng.config.port}` (linha 47) ou a URL devolvida pelo servidor (`http://127.0.0.1:<porta>`, linha 201 do http-server), com `win.loadURL(appUrl)` na linha 98.
- `ui/app.js`: `api()` (linha 56) faz `fetch` relativo POST com `x-farol: 1`; `get()` (linha 63) faz `fetch` relativo; `connect()` (linha 4301) abre `new EventSource('/api/events')`. Tudo na mesma origem.
- As sessões falam com o servidor por `curl` em `http://127.0.0.1:<porta>` (`lib/engine/session.js` linhas 74, 283 e 364; `lib/engine/chat.js` linha 36; `workspace-template/CLAUDE.md` linha 89): Host `127.0.0.1:<porta>`, sem Origin, portanto aceitas.
- Os outros testes que sobem o servidor (`test/http.test.js`, `test/sync-consolidated.test.js`, `test/sync-engine.test.js`, `test/sync-manual.test.js`) usam base `http://127.0.0.1:${server.address().port}`. Medido com Node v24.15.0: o `fetch` do Node num POST manda Host `127.0.0.1:<porta>` e **não** manda `Origin`; `http.request` com `headers: { host }` mantém o Host passado; `Origin` enviado vazio chega como `''` (presente).
- `tools/quality/gate.js` ignora `test/` (linha 17); as regras de ratchet valem para `lib/`.
- Métodos espionados existem em `server.js`: `fetchDeliveries` (795), `checkNow` (1265), `launchReview` (1333), `postReviewFromSession` (1509), `decide` (1516), `clearLog` (1542), `setJiraCredential` (1790), `snapshot` (1817).

---

### Tarefa 0: branch e contagem de partida

**Arquivos:** nenhum.

**Interfaces:** consome nada; produz o número `N0` de testes da suíte antes da entrega, usado na Tarefa 4.

- [ ] **Passo 1: criar o branch da entrega a partir do HEAD deste worktree** (o `EXECUCAO.md` mora em `docs/superpowers/handoff/`, que só existe neste branch).

```bash
cd /c/Users/wanderson/Documents/farol-multidispositivo
git status --short
git switch -c feat/md-c1a-allowlist-host
```

Esperado: `git status --short` vazio antes do switch; depois, `Switched to a new branch 'feat/md-c1a-allowlist-host'`.

- [ ] **Passo 2: medir a suíte de partida.**

```bash
cd /c/Users/wanderson/Documents/farol-multidispositivo
npm run check && npm run lint && npm test 2>&1 | tail -n 12
```

Esperado: os três verdes. Anote as linhas literais `# tests`, `# pass`, `# fail` e `# skipped` do fim da saída. `N0` é o valor de `# tests`.

---

### Tarefa 1: função pura `validarHostEOrigem`

**Arquivos:**
- criar `lib/http-guard.js`
- criar `test/http-guard.test.js`

**Interfaces:**
- consome: nada (módulo folha, sem import).
- produz: `validarHostEOrigem({ host, origin, porta })` que devolve `{ ok: true }` ou `{ ok: false, motivo: 'host' | 'origin' }`. Export nomeado e default `{ validarHostEOrigem }`.

- [ ] **Passo 1: escrever o teste que falha.** Crie `test/http-guard.test.js`:

```js
// C1a: a allowlist de Host e Origin da API local, como função PURA
// (lib/http-guard.js). Sem servidor, sem FAROL_HOME: o módulo não importa nada do
// repo. O servidor real é coberto em test/http-host-allowlist.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarHostEOrigem } from '../lib/http-guard.js';

const PORTA = 51234;
const RECUSA_HOST = { ok: false, motivo: 'host' };
const RECUSA_ORIGIN = { ok: false, motivo: 'origin' };

test('aceita 127.0.0.1 e localhost na porta efetiva, sem Origin', () => {
  assert.deepEqual(validarHostEOrigem({ host: `127.0.0.1:${PORTA}`, porta: PORTA }), { ok: true });
  assert.deepEqual(validarHostEOrigem({ host: `localhost:${PORTA}`, porta: PORTA }), { ok: true });
});

test('aceita Origin da própria origem nos dois nomes (Electron em POST e navegador local)', () => {
  assert.deepEqual(validarHostEOrigem({ host: `127.0.0.1:${PORTA}`, origin: `http://127.0.0.1:${PORTA}`, porta: PORTA }), { ok: true });
  assert.deepEqual(validarHostEOrigem({ host: `localhost:${PORTA}`, origin: `http://localhost:${PORTA}`, porta: PORTA }), { ok: true });
  // o Host diz a quem a requisição chegou; o Origin diz de onde a página veio.
  // Os dois nomes são a mesma máquina, então a combinação cruzada também é local.
  assert.deepEqual(validarHostEOrigem({ host: `127.0.0.1:${PORTA}`, origin: `http://localhost:${PORTA}`, porta: PORTA }), { ok: true });
});

test('recusa host de outro nome com motivo host (DNS rebinding e afins)', () => {
  for (const host of [`evil.example:${PORTA}`, `rebinding.evil.example:${PORTA}`, `0.0.0.0:${PORTA}`, `[::1]:${PORTA}`, '127.0.0.1', 'localhost']) {
    assert.deepEqual(validarHostEOrigem({ host, porta: PORTA }), RECUSA_HOST, host);
  }
});

test('recusa o host local em outra porta', () => {
  assert.deepEqual(validarHostEOrigem({ host: `127.0.0.1:${PORTA + 1}`, porta: PORTA }), RECUSA_HOST);
  assert.deepEqual(validarHostEOrigem({ host: `localhost:${PORTA - 1}`, porta: PORTA }), RECUSA_HOST);
});

test('não há curinga: prefixo, sufixo e variação do nome não passam', () => {
  for (const host of [`127.0.0.1.evil.example:${PORTA}`, `evil.localhost:${PORTA}`, `localhost.:${PORTA}`, `LOCALHOST:${PORTA}`, `127.0.0.1:${PORTA}0`, ` 127.0.0.1:${PORTA}`]) {
    assert.deepEqual(validarHostEOrigem({ host, porta: PORTA }), RECUSA_HOST, JSON.stringify(host));
  }
});

test('recusa host ausente, vazio ou de tipo errado', () => {
  assert.deepEqual(validarHostEOrigem({ porta: PORTA }), RECUSA_HOST);
  assert.deepEqual(validarHostEOrigem({ host: '', porta: PORTA }), RECUSA_HOST);
  assert.deepEqual(validarHostEOrigem({ host: [`127.0.0.1:${PORTA}`], porta: PORTA }), RECUSA_HOST);
  assert.deepEqual(validarHostEOrigem(), RECUSA_HOST);
});

test('recusa Origin externo, de outra porta, https, "null" e vazio com motivo origin', () => {
  const host = `127.0.0.1:${PORTA}`;
  for (const origin of ['https://evil.example', `http://evil.example:${PORTA}`, `http://127.0.0.1:${PORTA + 1}`, `https://127.0.0.1:${PORTA}`, `http://127.0.0.1:${PORTA}/`, 'null', '']) {
    assert.deepEqual(validarHostEOrigem({ host, origin, porta: PORTA }), RECUSA_ORIGIN, JSON.stringify(origin));
  }
});

test('Host inválido vence Origin inválido: o motivo é host', () => {
  assert.deepEqual(validarHostEOrigem({ host: `evil.example:${PORTA}`, origin: 'https://evil.example', porta: PORTA }), RECUSA_HOST);
});

test('porta inválida recusa até o host certo (falta de porta provada não libera)', () => {
  for (const porta of [0, -1, 65536, Number.NaN, String(PORTA), undefined, null]) {
    assert.deepEqual(validarHostEOrigem({ host: `127.0.0.1:${porta}`, porta }), RECUSA_HOST, String(porta));
  }
});
```

- [ ] **Passo 2: rodar e ver falhar.**

```bash
cd /c/Users/wanderson/Documents/farol-multidispositivo
node --test test/http-guard.test.js
```

Esperado: falha no carregamento do arquivo com `ERR_MODULE_NOT_FOUND` apontando `lib/http-guard.js`, e `# fail 1` (o arquivo inteiro conta como uma falha).

- [ ] **Passo 3: implementar.** Crie `lib/http-guard.js`:

```js
// Allowlist de Host e Origin da API local (C1a da operação multidispositivo).
// Função PURA: nenhum IO, nenhum estado, nenhuma leitura de config. Quem chama passa
// a porta EFETIVA do servidor (server.address().port), nunca a da config: com a
// config em 0 (porta efêmera, usada pelos testes) as duas divergem, e a regra tem que
// valer para a porta em que o socket de fato escuta.
//
// Host permitido não é autenticação: qualquer processo local fala com 127.0.0.1. O que
// isto fecha é o DNS rebinding (o navegador manda o Host do domínio do atacante) e a
// página de outra origem (o navegador manda o Origin dela). Autenticação é a A4.

const HOSTS_LOCAIS = ['127.0.0.1', 'localhost'];
const PORTA_MAXIMA = 65535;

function portaValida(porta) {
  return Number.isInteger(porta) && porta >= 1 && porta <= PORTA_MAXIMA;
}

// Os dois nomes com a porta, comparados por igualdade exata: sem curinga, sem sufixo e
// sem variação de caixa. É o que o Electron (main.js carrega http://127.0.0.1:<porta>),
// o navegador do próprio aparelho e o curl das sessões mandam.
function hostsPermitidos(porta) {
  return HOSTS_LOCAIS.map(nome => `${nome}:${porta}`);
}

function validarHostEOrigem({ host, origin, porta } = {}) {
  if (!portaValida(porta)) return { ok: false, motivo: 'host' };
  const permitidos = hostsPermitidos(porta);
  if (typeof host !== 'string' || !permitidos.includes(host)) return { ok: false, motivo: 'host' };
  // Origin AUSENTE é aceito: navegação direta, GET da própria página e curl local não
  // mandam. Presente e vazio não é ausente: o cabeçalho veio, e veio fora da lista.
  if (origin === undefined) return { ok: true };
  const origensPermitidas = permitidos.map(h => `http://${h}`);
  if (typeof origin !== 'string' || !origensPermitidas.includes(origin)) return { ok: false, motivo: 'origin' };
  return { ok: true };
}

export default { validarHostEOrigem };
export { validarHostEOrigem };
```

- [ ] **Passo 4: rodar e ver passar.**

```bash
cd /c/Users/wanderson/Documents/farol-multidispositivo
node --test test/http-guard.test.js
```

Esperado: `# tests 9`, `# pass 9`, `# fail 0`.

- [ ] **Passo 5: contraprova.** Coloque os dois arquivos no índice para ter a referência de restauração, faça cada mutação, veja o teste certo reprovar e restaure do índice.

```bash
cd /c/Users/wanderson/Documents/farol-multidispositivo
git add lib/http-guard.js test/http-guard.test.js
```

Mutação A (a lista de hosts deixa de valer): em `lib/http-guard.js`, troque
`if (typeof host !== 'string' || !permitidos.includes(host)) return { ok: false, motivo: 'host' };`
por
`if (typeof host !== 'string') return { ok: false, motivo: 'host' };`

```bash
node --test test/http-guard.test.js
```

Esperado: reprovam `recusa host de outro nome com motivo host (DNS rebinding e afins)`, `recusa o host local em outra porta`, `não há curinga: prefixo, sufixo e variação do nome não passam` e `Host inválido vence Origin inválido: o motivo é host`. Restaure e confirme:

```bash
git checkout -- lib/http-guard.js
git diff --exit-code -- lib/http-guard.js && echo restaurado
```

Mutação B (Origin deixa de ser conferido): em `lib/http-guard.js`, troque
`if (origin === undefined) return { ok: true };`
por
`return { ok: true };`

```bash
node --test test/http-guard.test.js
```

Esperado: reprova `recusa Origin externo, de outra porta, https, "null" e vazio com motivo origin`. Restaure e confirme:

```bash
git checkout -- lib/http-guard.js
git diff --exit-code -- lib/http-guard.js && echo restaurado
node --test test/http-guard.test.js
```

Esperado: `restaurado` e de novo `# pass 9`.

- [ ] **Passo 6: commit.**

```bash
cd /c/Users/wanderson/Documents/farol-multidispositivo
git add lib/http-guard.js test/http-guard.test.js
git commit -m "feat(http): validarHostEOrigem, allowlist pura de Host e Origin da API local"
```

---

### Tarefa 2: aplicar a guarda no `startServer`, antes de qualquer rota

**Arquivos:**
- modificar `lib/http-server.js`: import novo depois da linha 10; guarda nova entre a linha 81 (fim do `send`) e a linha 83 (`try {`).
- criar `test/http-host-allowlist.test.js`

**Interfaces:**
- consome: `validarHostEOrigem` de `lib/http-guard.js`; `server.address().port`; `req.headers.host`; `req.headers.origin`.
- produz: resposta `403` com corpo JSON exato `{ "error": "forbidden", "motivo": "host" | "origin" }`, sem cabeçalho `Access-Control-*`, antes do `/api` (linha 84), do SSE (113) e dos estáticos (186). O `403 { error: 'forbidden' }` sem `motivo` da linha 85 continua sendo a resposta de POST sem `x-farol` com Host válido.

- [ ] **Passo 1: escrever o teste de integração.** Crie `test/http-host-allowlist.test.js`:

```js
// C1a: a allowlist de Host e Origin roda ANTES de qualquer rota do lib/http-server.js,
// estáticos e SSE inclusive. Sobe o servidor real com uma Engine contra FAROL_HOME
// temporário (sem polling, sem gh), no mesmo molde do test/http.test.js. Os métodos do
// engine que cada rota chamaria são espionados: recusa tem que chegar com ZERO chamadas,
// e o controle com Host válido prova que o espião está no caminho (senão o zero seria vazio).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';

const HOME = path.join(os.tmpdir(), 'farol-test-http-host-' + process.pid);
process.env.FAROL_HOME = HOME;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const { DEFAULT_PORT } = await import('../lib/constants.js');

let engine, server, porta;
const extras = [];

function iniciar(eng) {
  return new Promise((resolve, reject) => {
    const s = startServer(eng, (url, err) => (err ? reject(err) : resolve(s)));
  });
}

before(async () => {
  engine = new Engine();
  engine.config.port = 0; // porta efêmera: a efetiva diverge da config de propósito
  engine.config.deliveriesEnabled = true; // senão /api/deliveries nem chega ao espião
  server = await iniciar(engine);
  porta = server.address().port;
});

after(() => {
  for (const s of [server, ...extras]) { try { s.close(); } catch { /* já fechado */ } }
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// Pedido cru com os cabeçalhos que o teste escolher (http.request mantém o host passado).
// Stream SSE aberto não termina: resolve na resposta e derruba a conexão.
function pedir(pathname, { method = 'GET', headers = {}, body, portaAlvo = porta } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: portaAlvo, path: pathname, method, headers }, res => {
      const tipo = res.headers['content-type'] || '';
      if (tipo.startsWith('text/event-stream')) {
        res.destroy();
        return resolve({ status: res.statusCode, tipo, corpo: '', headers: res.headers });
      }
      let corpo = '';
      res.on('data', c => (corpo += c));
      res.on('end', () => resolve({ status: res.statusCode, tipo, corpo, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function postJson(pathname, corpo, headers, portaAlvo = porta) {
  const body = JSON.stringify(corpo || {});
  return pedir(pathname, {
    method: 'POST', body, portaAlvo,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers },
  });
}

function chamar(c, headers) {
  if (c.method === 'GET') return pedir(c.rota, { headers });
  return postJson(c.rota, c.corpo, { 'x-farol': '1', ...headers });
}

// Troca os métodos do engine por contadores. snapshot segue devolvendo o real, porque
// o SSE e o /api/state serializam o retorno.
function espionar(nomes) {
  const chamadas = Object.fromEntries(nomes.map(n => [n, 0]));
  const originais = {};
  for (const nome of nomes) {
    originais[nome] = engine[nome];
    engine[nome] = (...args) => {
      chamadas[nome]++;
      if (nome === 'snapshot') return originais[nome].apply(engine, args);
      return { ok: true };
    };
  }
  return { chamadas, restaurar: () => { for (const nome of nomes) engine[nome] = originais[nome]; } };
}

const ESPIOES = ['snapshot', 'fetchDeliveries', 'setJiraCredential', 'decide', 'launchReview', 'clearLog', 'checkNow', 'postReviewFromSession'];

// Um representante por classe do inventário da seção 7.A4 da spec.
const CLASSES_A4 = [
  { classe: 'leitura sensível', method: 'GET', rota: '/api/state', espiao: 'snapshot' },
  { classe: 'leitura de baixo risco', method: 'GET', rota: '/api/deliveries?days=7', espiao: 'fetchDeliveries' },
  { classe: 'evento em tempo real', method: 'GET', rota: '/api/events', espiao: 'snapshot' },
  { classe: 'ação que recebe segredo', method: 'POST', rota: '/api/jira/credential', corpo: { siteId: 's1', email: 'a@b.c', token: 'segredo' }, espiao: 'setJiraCredential' },
  { classe: 'ação que posta ou escreve no GitHub', method: 'POST', rota: '/api/decide', corpo: { id: 'd1', action: 'approve' }, espiao: 'decide' },
  { classe: 'ação que abre sessão paga', method: 'POST', rota: '/api/review', corpo: { urls: ['https://github.com/acme/app/pull/1'] }, espiao: 'launchReview' },
  { classe: 'ação destrutiva', method: 'POST', rota: '/api/log/clear', corpo: {}, espiao: 'clearLog' },
  { classe: 'demais ações', method: 'POST', rota: '/api/check', corpo: {}, espiao: 'checkNow' },
];

const hostLocal = () => `127.0.0.1:${porta}`;
const HOST_REBINDING = () => `rebinding.evil.example:${porta}`;

function assertRecusa(r, motivo) {
  assert.equal(r.status, 403);
  assert.match(r.tipo, /application\/json/, 'recusa é JSON, nunca stream nem HTML');
  assert.deepEqual(JSON.parse(r.corpo), { error: 'forbidden', motivo });
}

/* ---------- Host inválido: um teste por classe da A4 ---------- */

for (const c of CLASSES_A4) {
  test(`Host inválido: ${c.classe} (${c.method} ${c.rota}) recebe 403 sem estado, sem SSE e sem ação`, async () => {
    const espiao = espionar(ESPIOES);
    try {
      const r = await chamar(c, { host: HOST_REBINDING() });
      assertRecusa(r, 'host');
      assert.doesNotMatch(r.corpo, /event: state|"decisions"/, 'nenhum pedaço do snapshot sai');
      assert.equal(espiao.chamadas[c.espiao], 0, `${c.espiao} não pode ser chamado`);
      assert.equal(espiao.chamadas.snapshot, 0, 'o snapshot nem é montado');
    } finally {
      espiao.restaurar();
    }
  });
}

for (const c of CLASSES_A4) {
  test(`controle: com Host local, ${c.classe} (${c.method} ${c.rota}) chega ao engine`, async () => {
    const espiao = espionar(ESPIOES);
    try {
      const r = await chamar(c, { host: hostLocal() });
      assert.equal(r.status, 200);
      assert.ok(espiao.chamadas[c.espiao] >= 1, `${c.espiao} está no caminho da rota`);
    } finally {
      espiao.restaurar();
    }
  });
}

test('Host inválido: arquivo estático recebe 403 JSON e nenhum byte da UI', async () => {
  for (const rota of ['/', '/index.html', '/app.css']) {
    const r = await pedir(rota, { headers: { host: HOST_REBINDING() } });
    assertRecusa(r, 'host');
    assert.doesNotMatch(r.corpo, /<html|<script|\{\s*[a-z-]+\s*:/i, rota);
  }
});

/* ---------- Origin ---------- */

test('Origin externo recebe 403 numa leitura, sem estado', async () => {
  const espiao = espionar(ESPIOES);
  try {
    const r = await pedir('/api/state', { headers: { host: hostLocal(), origin: 'https://evil.example' } });
    assertRecusa(r, 'origin');
    assert.equal(espiao.chamadas.snapshot, 0);
  } finally {
    espiao.restaurar();
  }
});

test('Origin externo recebe 403 num POST com x-farol, sem ação', async () => {
  const espiao = espionar(ESPIOES);
  try {
    const r = await postJson('/api/check', {}, { host: hostLocal(), origin: 'https://evil.example', 'x-farol': '1' });
    assertRecusa(r, 'origin');
    assert.equal(espiao.chamadas.checkNow, 0);
  } finally {
    espiao.restaurar();
  }
});

test('Origin da mesma máquina em outra porta também é externo', async () => {
  const outraPorta = porta === 65535 ? porta - 1 : porta + 1;
  const r = await pedir('/api/events', { headers: { host: hostLocal(), origin: `http://127.0.0.1:${outraPorta}` } });
  assertRecusa(r, 'origin');
});

test('nenhum cabeçalho CORS de permissão sai, nem na resposta aceita nem na recusada', async () => {
  const aceita = await pedir('/api/state', { headers: { host: `localhost:${porta}`, origin: `http://localhost:${porta}` } });
  const recusada = await pedir('/api/state', { headers: { host: hostLocal(), origin: 'https://evil.example' } });
  assert.equal(aceita.status, 200);
  assert.equal(recusada.status, 403);
  for (const r of [aceita, recusada]) {
    const cors = Object.keys(r.headers).filter(h => h.startsWith('access-control-'));
    assert.deepEqual(cors, []);
  }
});

/* ---------- quem precisa continuar funcionando ---------- */

test('janela do Electron: Host 127.0.0.1:<porta>, GET sem Origin e POST com a própria origem', async () => {
  const espiao = espionar(ESPIOES);
  try {
    const pagina = await pedir('/', { headers: { host: hostLocal() } });
    assert.equal(pagina.status, 200);
    assert.match(pagina.tipo, /text\/html/);
    const eventos = await pedir('/api/events', { headers: { host: hostLocal() } });
    assert.equal(eventos.status, 200);
    assert.match(eventos.tipo, /text\/event-stream/);
    const acao = await postJson('/api/check', {}, { host: hostLocal(), origin: `http://127.0.0.1:${porta}`, 'x-farol': '1' });
    assert.equal(acao.status, 200);
    assert.equal(espiao.chamadas.checkNow, 1);
  } finally {
    espiao.restaurar();
  }
});

test('navegador do próprio aparelho: Host e Origin em localhost:<porta>', async () => {
  const espiao = espionar(ESPIOES);
  try {
    const pagina = await pedir('/app.css', { headers: { host: `localhost:${porta}` } });
    assert.equal(pagina.status, 200);
    assert.match(pagina.tipo, /text\/css/);
    const estado = await pedir('/api/state', { headers: { host: `localhost:${porta}`, origin: `http://localhost:${porta}` } });
    assert.equal(estado.status, 200);
    const acao = await postJson('/api/check', {}, { host: `localhost:${porta}`, origin: `http://localhost:${porta}`, 'x-farol': '1' });
    assert.equal(acao.status, 200);
    assert.equal(espiao.chamadas.checkNow, 1);
  } finally {
    espiao.restaurar();
  }
});

/* ---------- porta efetiva ---------- */

function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const livre = s.address().port;
      s.close(err => (err ? reject(err) : resolve(livre)));
    });
  });
}

test('com a config em 0 vale a porta em que o socket escuta, não a da config', async () => {
  assert.equal(engine.config.port, 0);
  assert.equal((await pedir('/api/state', { headers: { host: hostLocal() } })).status, 200);
  assertRecusa(await pedir('/api/state', { headers: { host: '127.0.0.1:0' } }), 'host');
});

test('servidor em porta configurada diferente da padrão aceita a porta efetiva e recusa a padrão', async () => {
  const livre = await portaLivre();
  assert.notEqual(livre, DEFAULT_PORT, 'a porta sorteada não pode ser a padrão, senão o teste não prova nada');
  const anterior = engine.config.port;
  engine.config.port = livre;
  try {
    const s = await iniciar(engine);
    extras.push(s);
    assert.equal(s.address().port, livre);
    assert.equal((await pedir('/api/state', { portaAlvo: livre, headers: { host: `127.0.0.1:${livre}` } })).status, 200);
    assertRecusa(await pedir('/api/state', { portaAlvo: livre, headers: { host: `127.0.0.1:${DEFAULT_PORT}` } }), 'host');
    assertRecusa(await pedir('/api/state', { portaAlvo: livre, headers: { host: `localhost:${DEFAULT_PORT}` } }), 'host');
    s.close();
  } finally {
    engine.config.port = anterior;
  }
});

/* ---------- proteções existentes ---------- */

test('x-farol continua exigido em POST com Host válido (contrato de 403 sem motivo intacto)', async () => {
  const espiao = espionar(ESPIOES);
  try {
    const r = await postJson('/api/check', {}, { host: hostLocal() });
    assert.equal(r.status, 403);
    assert.deepEqual(JSON.parse(r.corpo), { error: 'forbidden' });
    assert.equal(espiao.chamadas.checkNow, 0);
  } finally {
    espiao.restaurar();
  }
});

test('Host inválido sem x-farol: a allowlist responde primeiro, com motivo host', async () => {
  const r = await postJson('/api/check', {}, { host: HOST_REBINDING() });
  assertRecusa(r, 'host');
});

test('x-farol-review-cap continua sendo conferida depois da allowlist', async () => {
  const r = await postJson('/api/review/post', { key: 'acme/app#1', payload: { event: 'APPROVE', body: 'Texto limpo.', comments: [] } }, { host: hostLocal(), 'x-farol': '1' });
  assert.equal(r.status, 200);
  const corpo = JSON.parse(r.corpo);
  assert.equal(corpo.ok, false);
  assert.equal(corpo.blocked, 'capability');
});
```

- [ ] **Passo 2: rodar e ver falhar.**

```bash
cd /c/Users/wanderson/Documents/farol-multidispositivo
node --test --test-force-exit test/http-host-allowlist.test.js
```

Esperado: `# tests 28`, `# fail 16`, `# pass 12`.
- Reprovam: os 8 `Host inválido: ...` (status 200 ou 400 em vez de 403), `Host inválido: arquivo estático ...`, os 3 de Origin (`Origin externo recebe 403 numa leitura, sem estado`, `Origin externo recebe 403 num POST com x-farol, sem ação`, `Origin da mesma máquina em outra porta também é externo`), `nenhum cabeçalho CORS de permissão sai, ...` (a recusada vem 200), `com a config em 0 vale a porta em que o socket escuta, não a da config` (Host `127.0.0.1:0` vem 200), `servidor em porta configurada diferente da padrão ...` e `Host inválido sem x-farol: ...` (vem `{ error: 'forbidden' }` sem `motivo`).
- Passam, e são guardas de não regressão que precisam continuar passando: os 8 `controle: ...`, `janela do Electron: ...`, `navegador do próprio aparelho: ...`, `x-farol continua exigido ...` e `x-farol-review-cap continua ...`. Se algum destes reprovar aqui, pare: o teste está errado, não o servidor.

- [ ] **Passo 3: implementar.** Em `lib/http-server.js`, depois da linha 10 (`import { triage } from './log-taxonomy.js';`), acrescente:

```js
import { validarHostEOrigem } from './http-guard.js';
```

Ainda em `lib/http-server.js`, entre o fim do `send` (linha 81, `    };`) e o `try {` (linha 83), acrescente (a linha em branco 82 continua separando do `try`):

```js

    // C1a: Host e Origin passam pela allowlist ANTES de qualquer rota, estáticos e SSE
    // inclusive. A porta é a EFETIVA do socket, não a da config (config 0 = efêmera).
    // Fica fora do try de propósito: a função é pura e não lança, e address() nulo
    // (socket já fechado) vira porta inválida e recusa, em vez de derrubar o processo.
    // A recusa não leva cabeçalho CORS, então nenhuma origem de fora ganha leitura.
    const endereco = server.address();
    const guarda = validarHostEOrigem({ host: req.headers.host, origin: req.headers.origin, porta: endereco && endereco.port });
    if (!guarda.ok) return send(403, { error: 'forbidden', motivo: guarda.motivo });
```

Resultado esperado do trecho, para conferência:

```js
    const send = (code, data, type = 'application/json') => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(type === 'application/json' ? JSON.stringify(data) : data);
    };

    // C1a: Host e Origin passam pela allowlist ANTES de qualquer rota, estáticos e SSE
    // inclusive. A porta é a EFETIVA do socket, não a da config (config 0 = efêmera).
    // Fica fora do try de propósito: a função é pura e não lança, e address() nulo
    // (socket já fechado) vira porta inválida e recusa, em vez de derrubar o processo.
    // A recusa não leva cabeçalho CORS, então nenhuma origem de fora ganha leitura.
    const endereco = server.address();
    const guarda = validarHostEOrigem({ host: req.headers.host, origin: req.headers.origin, porta: endereco && endereco.port });
    if (!guarda.ok) return send(403, { error: 'forbidden', motivo: guarda.motivo });

    try {
      if (p.startsWith('/api/')) {
        if (req.method === 'POST' && req.headers['x-farol'] !== '1') return send(403, { error: 'forbidden' });
```

Nada mais muda no arquivo. O `server` referenciado dentro do callback é o `const server = http.createServer(...)` da linha 74; o callback só roda depois da atribuição.

- [ ] **Passo 4: rodar e ver passar**, o arquivo novo e os testes que já sobem o servidor.

```bash
cd /c/Users/wanderson/Documents/farol-multidispositivo
node --test --test-force-exit test/http-host-allowlist.test.js
node --test --test-force-exit test/http.test.js test/sync-consolidated.test.js test/sync-engine.test.js test/sync-manual.test.js test/settings-fonte-unica.test.js test/taxonomy-ui.test.js test/ui-contract.test.js test/http-guard.test.js
```

Esperado: o primeiro com `# tests 28`, `# pass 28`, `# fail 0`; o segundo com `# fail 0` (nenhum dos testes antigos manda Host fora da lista nem Origin).

- [ ] **Passo 5: contraprova.** Coloque os arquivos no índice como referência, faça cada mutação, veja reprovar e restaure.

```bash
cd /c/Users/wanderson/Documents/farol-multidispositivo
git add lib/http-server.js test/http-host-allowlist.test.js
```

Mutação A (a guarda não recusa): em `lib/http-server.js`, troque
`    if (!guarda.ok) return send(403, { error: 'forbidden', motivo: guarda.motivo });`
por
`    if (false && !guarda.ok) return send(403, { error: 'forbidden', motivo: guarda.motivo });`

```bash
node --test --test-force-exit test/http-host-allowlist.test.js
```

Esperado: as mesmas 16 reprovações do Passo 2. Restaure e confirme:

```bash
git checkout -- lib/http-server.js
git diff --exit-code -- lib/http-server.js && echo restaurado
```

Mutação B (porta da config em vez da efetiva): em `lib/http-server.js`, troque
`porta: endereco && endereco.port });`
por
`porta: engine.config.port });`

```bash
node --test --test-force-exit test/http-host-allowlist.test.js
```

Esperado: reprovam, entre outros, os 8 `controle: ...`, `janela do Electron: ...`, `navegador do próprio aparelho: ...` e `com a config em 0 vale a porta em que o socket escuta, não a da config` (a config é 0, porta inválida, tudo vira 403). Restaure e confirme:

```bash
git checkout -- lib/http-server.js
git diff --exit-code -- lib/http-server.js && echo restaurado
```

Mutação C (a guarda depois do roteamento de `/api`, deixando só os estáticos protegidos): em `lib/http-server.js`, recorte as três linhas `const endereco = ...`, `const guarda = ...` e `if (!guarda.ok) ...` e cole-as imediatamente acima do comentário `// arquivos estaticos da UI` (linha 186 antes da mudança).

```bash
node --test --test-force-exit test/http-host-allowlist.test.js
```

Esperado: 15 reprovações, os 8 `Host inválido: ...`, os 3 de Origin, `nenhum cabeçalho CORS ...`, `com a config em 0 ...`, `servidor em porta configurada ...` e `Host inválido sem x-farol: ...`; `Host inválido: arquivo estático ...` passa. Isso prova que o teste distingue "antes de qualquer rota" de "só nos estáticos". Restaure e confirme:

```bash
git checkout -- lib/http-server.js
git diff --exit-code -- lib/http-server.js && echo restaurado
node --test --test-force-exit test/http-host-allowlist.test.js
```

Esperado: `restaurado` e de novo `# pass 28`.

- [ ] **Passo 6: commit.**

```bash
cd /c/Users/wanderson/Documents/farol-multidispositivo
git add lib/http-server.js test/http-host-allowlist.test.js
git commit -m "feat(http): recusa Host e Origin fora da allowlist antes de qualquer rota"
```

---

### Tarefa 3: mapa de arquivos do `CLAUDE.md`

**Arquivos:** modificar `CLAUDE.md`, acrescentando uma linha logo abaixo da linha 23 (`| \`lib/http-server.js\` | ... |`).

**Interfaces:** consome o nome `validarHostEOrigem` e o caminho `lib/http-guard.js`; produz documentação.

- [ ] **Passo 1: teste que falha.** Não há teste automatizado de conteúdo do mapa; a verificação é a busca abaixo, que precisa voltar vazia antes e com uma linha depois.

```bash
cd /c/Users/wanderson/Documents/farol-multidispositivo
grep -n "lib/http-guard.js" CLAUDE.md
```

Esperado: nenhuma saída e código de saída 1.

- [ ] **Passo 2: implementar.** Logo abaixo da linha 23 do `CLAUDE.md`, acrescente:

```markdown
| `lib/http-guard.js` | **Allowlist de Host e Origin da API local** (C1a). `validarHostEOrigem({ host, origin, porta })` é PURA e o `startServer` a aplica antes de qualquer rota, estáticos e SSE inclusive, com a porta EFETIVA do socket (`server.address().port`), nunca a da config. Aceita só `127.0.0.1:<porta>` e `localhost:<porta>`, sem curinga; `Origin` ausente passa, presente tem que ser `http://127.0.0.1:<porta>` ou `http://localhost:<porta>`. Recusa é `403 { error: 'forbidden', motivo: 'host' \| 'origin' }`, sem cabeçalho CORS. Host permitido não é autenticação (isso é a A4); `x-farol` e `x-farol-review-cap` continuam como estavam |
```

- [ ] **Passo 3: rodar e ver passar.**

```bash
cd /c/Users/wanderson/Documents/farol-multidispositivo
grep -n "lib/http-guard.js" CLAUDE.md
node --test --test-force-exit test/release-consistency.test.js
```

Esperado: uma linha, com número 24; o teste de consistência de release segue verde (esta entrega não mexe em versão).

- [ ] **Passo 4: contraprova.** Confira que a linha nova não quebra nenhum teste que lê o `CLAUDE.md`.

```bash
cd /c/Users/wanderson/Documents/farol-multidispositivo
git add CLAUDE.md
grep -rl "CLAUDE.md" test --include=*.test.js | xargs node --test --test-force-exit
```

Esperado: `# fail 0`. Mutação: acrescente temporariamente a palavra `travessão` seguida de um caractere de travessão ao fim da linha nova, rode `grep -n "$(printf '\342\200\224')" CLAUDE.md | grep http-guard` e confirme que a linha aparece (a regra de texto sem travessão do invariante 6 é verificável por busca). Restaure e confirme:

```bash
git checkout -- CLAUDE.md
git diff --exit-code -- CLAUDE.md && echo restaurado
grep -n "$(printf '\342\200\224')" CLAUDE.md | grep http-guard || echo "sem travessão na linha nova"
```

Esperado: `restaurado` e `sem travessão na linha nova`.

- [ ] **Passo 5: commit.**

```bash
cd /c/Users/wanderson/Documents/farol-multidispositivo
git add CLAUDE.md
git commit -m "docs: mapa de arquivos ganha lib/http-guard.js"
```

---

### Tarefa 4: gate completo e registro da execução

**Arquivos:** criar `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md` (o arquivo não existe neste worktree; se outra entrega já o tiver criado quando esta for executada, acrescente a seção no fim em vez de sobrescrever).

**Interfaces:** consome `N0` da Tarefa 0 e as saídas dos três comandos; produz o registro.

- [ ] **Passo 1: rodar o gate.**

```bash
cd /c/Users/wanderson/Documents/farol-multidispositivo
npm run check && npm run lint && npm test 2>&1 | tail -n 12
```

Esperado:
- `npm run check`: verde, e a contagem de arquivos que ele imprime é a da Tarefa 0 mais 3 (`lib/http-guard.js`, `test/http-guard.test.js`, `test/http-host-allowlist.test.js`).
- `npm run lint`: verde, sem nenhuma contagem acima da baseline, e `higiene: sem referencia de card solta`.
- `npm test`: `# fail 0`, com `# tests` igual a `N0 + 37` (9 de `test/http-guard.test.js` mais 28 de `test/http-host-allowlist.test.js`).

Se `# tests` não for `N0 + 37`, pare e descubra a diferença antes de registrar: teste pulado ou duplicado muda o que a suíte prova.

- [ ] **Passo 2: registrar.** Crie (ou complete) `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md` com a seção abaixo, trocando cada campo entre colchetes angulares pelo valor literal medido no Passo 1 e na Tarefa 0 (é registro de medição, não pode ser preenchido de cabeça):

```markdown
## C1a Allowlist de Host (plano 2026-09-15-md-c1a-allowlist-host)

Branch `feat/md-c1a-allowlist-host`, commits da entrega: <saída de `git log --oneline -3`>.

### Comandos

    npm run check && npm run lint && npm test

### Contagens

| medida | antes (Tarefa 0) | depois |
|---|---|---|
| `# tests` | <N0> | <N0 + 37> |
| `# pass` | <valor> | <valor> |
| `# fail` | 0 | 0 |
| `# skipped` | <valor> | <valor> |
| arquivos do `npm run check` | <valor> | <valor + 3> |
| lint | verde | verde, sem regressão |

Testes novos: 9 em `test/http-guard.test.js`, 28 em `test/http-host-allowlist.test.js`.

### Critério de aceite x teste

| critério da 7.C1a | teste que prova |
|---|---|
| Host inválido recebe 403 sem estado, sem SSE e sem ação, um teste por classe da A4 | os 8 `Host inválido: <classe> (...) recebe 403 sem estado, sem SSE e sem ação`, com os 8 `controle: ...` provando que o espião estava no caminho, e `Host inválido: arquivo estático recebe 403 JSON e nenhum byte da UI` |
| `Origin` externo recebe 403 | `Origin externo recebe 403 numa leitura, sem estado`, `Origin externo recebe 403 num POST com x-farol, sem ação`, `Origin da mesma máquina em outra porta também é externo`, e o unitário `recusa Origin externo, de outra porta, https, "null" e vazio com motivo origin` |
| nenhum cabeçalho CORS de permissão | `nenhum cabeçalho CORS de permissão sai, nem na resposta aceita nem na recusada` |
| janela do Electron e navegador do aparelho continuam funcionando | `janela do Electron: Host 127.0.0.1:<porta>, GET sem Origin e POST com a própria origem`, `navegador do próprio aparelho: Host e Origin em localhost:<porta>` |
| porta configurada diferente da padrão aceita a efetiva e recusa a padrão | `servidor em porta configurada diferente da padrão aceita a porta efetiva e recusa a padrão`, `com a config em 0 vale a porta em que o socket escuta, não a da config` |
| hosts exatos, sem curinga | unitários `não há curinga: prefixo, sufixo e variação do nome não passam`, `recusa host de outro nome com motivo host (DNS rebinding e afins)`, `recusa o host local em outra porta` |
| proteções existentes mantidas | `x-farol continua exigido em POST com Host válido (contrato de 403 sem motivo intacto)`, `Host inválido sem x-farol: a allowlist responde primeiro, com motivo host`, `x-farol-review-cap continua sendo conferida depois da allowlist` |

### Contraprovas feitas

- `lib/http-guard.js`: lista de hosts desligada (4 unitários reprovaram) e Origin desligado (1 reprovou); restaurado com `git diff --exit-code`.
- `lib/http-server.js`: guarda sem efeito (16 reprovaram), porta da config em vez da efetiva (controles, Electron, navegador e config 0 reprovaram), guarda só nos estáticos (15 reprovaram, o de estático passou); restaurado com `git diff --exit-code`.

### Fora do que a suíte prova

- Janela real do Electron com o `Origin` que o Chromium manda: coberta pelo job `electron` do CI (`tools/electron-smoke-main.js` faz `fetch('/api/state')` na página carregada de `http://127.0.0.1:<porta>`), que só roda no PR.
- `npm run eng` não roda nesta tarefa; roda antes do push, pelo pre-push.
```

- [ ] **Passo 3: contraprova do registro.** Confira que nenhum campo ficou sem medir.

```bash
cd /c/Users/wanderson/Documents/farol-multidispositivo
grep -n "<" docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md | grep -v "<porta>\|<classe>" || echo "sem campo aberto"
```

Esperado: `sem campo aberto`. Mutação: deixe temporariamente um `<N0>` sem trocar, rode o mesmo comando e veja a linha aparecer; troque de volta pelo valor medido e rode de novo até imprimir `sem campo aberto`.

- [ ] **Passo 4: commit.**

```bash
cd /c/Users/wanderson/Documents/farol-multidispositivo
git add docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md
git commit -m "docs: registro de execução da C1a allowlist de Host"
```

Push e PR ficam fora deste plano (seção 15 da spec: um PR por entrega, CI verde, nunca push direto na `main`).

---

## Critérios de aceite da spec x testes

| Critério da 7.C1a | Teste |
|---|---|
| Host inválido recebe 403 sem estado (leitura sensível) | `Host inválido: leitura sensível (GET /api/state) recebe 403 sem estado, sem SSE e sem ação` |
| Host inválido recebe 403 (leitura de baixo risco) | `Host inválido: leitura de baixo risco (GET /api/deliveries?days=7) recebe 403 sem estado, sem SSE e sem ação` |
| Host inválido recebe 403 sem SSE | `Host inválido: evento em tempo real (GET /api/events) recebe 403 sem estado, sem SSE e sem ação` |
| Host inválido recebe 403 sem executar ação (segredo) | `Host inválido: ação que recebe segredo (POST /api/jira/credential) recebe 403 sem estado, sem SSE e sem ação` |
| Host inválido recebe 403 sem executar ação (GitHub) | `Host inválido: ação que posta ou escreve no GitHub (POST /api/decide) recebe 403 sem estado, sem SSE e sem ação` |
| Host inválido recebe 403 sem executar ação (sessão paga) | `Host inválido: ação que abre sessão paga (POST /api/review) recebe 403 sem estado, sem SSE e sem ação` |
| Host inválido recebe 403 sem executar ação (destrutiva) | `Host inválido: ação destrutiva (POST /api/log/clear) recebe 403 sem estado, sem SSE e sem ação` |
| Host inválido recebe 403 sem executar ação (demais) | `Host inválido: demais ações (POST /api/check) recebe 403 sem estado, sem SSE e sem ação` |
| Validação antes de qualquer rota, arquivos estáticos inclusive | `Host inválido: arquivo estático recebe 403 JSON e nenhum byte da UI` (e a Mutação C da Tarefa 2) |
| Os zeros de chamada acima não são vazios | os 8 `controle: com Host local, <classe> (...) chega ao engine` |
| `Origin` externo recebe 403 | `Origin externo recebe 403 numa leitura, sem estado`; `Origin externo recebe 403 num POST com x-farol, sem ação`; `Origin da mesma máquina em outra porta também é externo`; unitário `recusa Origin externo, de outra porta, https, "null" e vazio com motivo origin` |
| Ausência de `Origin` aceita | unitário `aceita 127.0.0.1 e localhost na porta efetiva, sem Origin`; `janela do Electron: ...` (GET sem Origin) |
| Nenhum cabeçalho CORS de permissão | `nenhum cabeçalho CORS de permissão sai, nem na resposta aceita nem na recusada` |
| Janela do Electron continua funcionando (Host e Origin que ela envia) | `janela do Electron: Host 127.0.0.1:<porta>, GET sem Origin e POST com a própria origem` |
| Navegador do próprio aparelho continua funcionando | `navegador do próprio aparelho: Host e Origin em localhost:<porta>`; unitário `aceita Origin da própria origem nos dois nomes (Electron em POST e navegador local)` |
| Porta configurada diferente da padrão: aceita a efetiva, recusa a padrão | `servidor em porta configurada diferente da padrão aceita a porta efetiva e recusa a padrão` |
| A porta é a efetivamente usada pelo servidor | `com a config em 0 vale a porta em que o socket escuta, não a da config` (e a Mutação B da Tarefa 2) |
| Só `127.0.0.1` e `localhost`, sem curinga | unitários `recusa host de outro nome com motivo host (DNS rebinding e afins)`, `recusa o host local em outra porta`, `não há curinga: prefixo, sufixo e variação do nome não passam`, `recusa host ausente, vazio ou de tipo errado`, `porta inválida recusa até o host certo (falta de porta provada não libera)` |
| `x-farol` mantido nos POST | `x-farol continua exigido em POST com Host válido (contrato de 403 sem motivo intacto)`; `Host inválido sem x-farol: a allowlist responde primeiro, com motivo host` |
| Capability de postagem das sessões mantida | `x-farol-review-cap continua sendo conferida depois da allowlist` |
