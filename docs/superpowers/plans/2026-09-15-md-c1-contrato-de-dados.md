# C1 Contrato de dados v2 e cifragem: plano de implementação

> **Ajustes de execução (15/09/2026, valem sobre o texto abaixo):** worktree `C:\Users\wanderson\Documents\farol-md-exec`; branch `md/c1` cortada da ponta de `md/integracao` (base `origin/main` `8c043bc`, com C1a, C0, A5, A1, A4 e C0b integradas); sem `git fetch`/`merge origin/main`. A evidência vai para `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/evidencias-execucao/c1.md`, e o `EXECUCAO.md` recebe só a linha de estado, os commits e o caminho da evidência. Números esperados de testes são referência: o que vale é a medição na hora.

> **Para quem executa:** use superpowers:executing-plans, tarefa por tarefa, marcando os checkboxes.

**Objetivo:** implementar CT-ENV (chaves, cache, envelope cifrado e identificadores v2) atrás do interruptor `sync.shared.enabled`, publicar as regras v2 geradas por macro com teste byte a byte, remover o apagão remoto e reescrever a frase da tela, sem mudar nada do comportamento de hoje enquanto o compartilhamento estiver desligado.

**Arquitetura:** o material novo mora em módulos folha de `lib/sync/` (`tags.js`, `kek.js`, `chaveiro.js`, `cache-chave.js`, `envelope.js`), todos sem estado do engine e sem dependência nova. `lib/engine/sync.js` recebe só fiação: abrir o chaveiro no login, conferir o `kcv` na conexão e expor o estado da chave. As regras saem de um template expandido por um gerador em Node puro (`tools/sync-rules.js`), e o JSON publicado é conferido byte a byte por teste.

| Peça | Arquivo | Papel |
|---|---|---|
| Identificadores v2 | `lib/sync/tags.js` | `tag(K_id, domínio, valor)` por HMAC-SHA256, com os sete domínios |
| Embrulho pela senha | `lib/sync/kek.js` | `scrypt` assíncrono, embrulho AES-256-GCM do material, `kcv` |
| Chaveiro remoto | `lib/sync/chaveiro.js` | nó `users/{uid}/keyring`: criação com CAS por ETag, reembrulho, rotação, estado "chave perdida" |
| Cache local | `lib/sync/cache-chave.js` | `~/.farol/sync-key.json`, modo 0600 em toda gravação, descarte por `uid`, destino ou `kcv` |
| Envelope | `lib/sync/envelope.js` | `e1.<kid>.<iv>.<ct>.<tag>`, AAD em ordem fixa, preenchimento de 256, leitura que falha fechada |
| Sonda de regras | `lib/sync/sonda-regras.js` | `rulesProbe/v2/{id}`: descobre regra velha antes de escrever nó novo |
| Gerador de regras | `tools/sync-rules.js` | expande as macros do template e escreve `firebase/database.rules.json` |

**Stack:** Node ESM puro, só `node:crypto`, `node --test`, dublês `test/helpers/fake-rtdb.js` e `test/helpers/fake-identity.js`, zero dependências novas.

**Spec:** `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md`, seções 5 (CT-ENV), 7.C1, 10 e 11. Detalhe normativo em `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-anexos/C1-contrato-de-dados.md`, seções "Gestão de chave", "Envelope cifrado", "Identificadores e migração", "Nós do banco", "Estratégia de regras" e "Contraprovas", respeitando os blocos "Trechos superados neste campo, que NÃO valem".

## Constraints globais

Valores exatos, copiados da spec e do anexo. Toda tarefa herda esta seção.

- **Zero dependências novas.** Só `node:crypto`. É proibido importar `node:zlib` em `lib/sync/` (a Tarefa 7 trava isso por varredura estática).
- **Texto e comentários em português, sem travessão.**
- **Material:** `K_id` 32 bytes (`randomBytes`), estável por época; `K_enc[gN]` 32 bytes aleatórios por geração, sem derivar de `K_id`; `K_adm` é par Ed25519 e **fica fora desta entrega** (nasce na C2).
- **KEK:** `crypto.scrypt` **assíncrono**, `N=16384, r=8, p=5`, sal de 16 bytes por embrulho, saída de 32 bytes. Nunca `scryptSync` no event loop. Parâmetros e sal viajam no embrulho.
- **Embrulho:** `blob = 'w1.<iv>.<ct>.<tag>'`, AES-256-GCM com `authTagLength: 16`, AAD `'farol|wrap|1|<uid>|pw|scrypt|<N>|<r>|<p>|<salt>|<rev>'`.
- **kcv[g]:** 16 primeiros hex de `HMAC-SHA256(K_enc[g], 'farol|kcv')`.
- **Keyring:** `users/{uid}/keyring`, `{v:1, rev, updatedAt, epochSince, cur, kids, kcv, slots}`; criado **só depois** de `signInWithPassword` responder ok; `rev` 1 na criação e `rev+1` em cada gravação; CAS por ETag (`null_etag` na criação). Keyring visto e depois ausente **nunca** é recriado sozinho.
- **Cache:** `~/.farol/sync-key.json`, `{v, uid, destino, keyringRev, cur, id, enc, savedAt}`, `chmod 0600` em **toda** gravação. O boot só lê (sem scrypt, sem rede). `uid` ou destino diferente descarta.
- **Envelope:** `'e1.<kid>.<iv>.<ct>.<tag>'` em base64url sem preenchimento; `kid` = `'g'` + dígitos; IV de 12 bytes nunca reusado; tag de 16 bytes; conferência de tamanho de IV e tag **antes** de `setAuthTag`.
- **AAD do envelope (UTF-8, ordem fixa):** `'farol|e1|<uid>|<caminho lógico>|<campo>|<kid>|<esquema>'`, mais os campos extras por nó quando o contrato do nó exigir.
- **Texto claro:** `{s, v:1, r, ...campos da allowlist}`, completado com espaços até múltiplo de **256 bytes**, **sem compressão**.
- **Leitura falha fechada:** prefixo, kid, IV, tag, JSON, esquema ou `r` regressivo descartam o item inteiro, que vira "não verificável" e fica fora de decisão, orçamento e exibição.
- **Identificadores:** `tag(domínio, valor) = HMAC-SHA256(K_id, 'farol' NUL 'v2' NUL domínio NUL valor)`, cortado em 32 hex; `tag64` é o hex inteiro. Domínios: `acct`, `pr`, `org`, `mat`, `event`, `review`, `pending`. **`profileTag` derivado de credencial não existe** (superado por CT-GRUPO).
- **Coordenação não muda de caminho.** `leases`, `receipts` e `dailyRounds` continuam em SHA-256 sem sal. Com o compartilhamento ligado muda só o corpo: `lease.headSha` vai `''` e `receipt.materialVersion` vai `'h1:' + tag('mat', versão)`.
- **Com o compartilhamento desligado, nada muda**, byte a byte, em qualquer escrita que hoje chega ao banco.
- **O ratchet de `npm run lint` não pode subir:** nada de `JSON.parse`/`JSON.stringify` cru fora de `lib/io.js`, nada de `process.env` fora de `lib/paths.js`/`lib/env.js`, nenhum número de tempo fora de `lib/constants.js`, nenhum `catch` vazio sem comentário, nenhum ternário aninhado, profundidade de chaves no máximo 3 dentro de função, arquivo novo abaixo de 400 linhas úteis.
- **Testes com `FAROL_HOME` temporário fixado antes de `await import(...)`** de qualquer módulo que alcance `lib/paths.js`. O caso do cache 0600 redireciona `HOME`/`USERPROFILE` também, porque o arquivo mora em `HOME`.
- **Nenhum teste existente é editado.** Se um teste existente reprovar, pare e reporte.
- **Nada toca `~/.farol` real, GitHub real ou Firebase real.** Nenhuma regra é publicada por esta execução: a publicação é manual, uma vez, pelo dono.
- **Commits sem atribuição de IA.** Nada de push.

---

## Mapa de arquivos

| Ação | Caminho |
|---|---|
| criar | `lib/sync/tags.js` |
| criar | `lib/sync/kek.js` |
| criar | `lib/sync/chaveiro.js` |
| criar | `lib/sync/cache-chave.js` |
| criar | `lib/sync/envelope.js` |
| criar | `lib/sync/sonda-regras.js` |
| criar | `tools/sync-rules.js` |
| criar | `firebase/database.rules.template.json` |
| criar | `test/sync-compartilhamento-desligado.test.js` |
| criar | `test/sync-tags.test.js` |
| criar | `test/sync-kek.test.js` |
| criar | `test/sync-chaveiro.test.js` |
| criar | `test/sync-cache-chave.test.js` |
| criar | `test/sync-envelope.test.js` |
| criar | `test/sync-desbloqueio.test.js` |
| criar | `test/sync-recuperacao-chave.test.js` |
| criar | `test/sync-sonda-regras.test.js` |
| criar | `test/sync-rules-contrato.test.js` |
| criar | `test/sync-escritas-v1.test.js` |
| criar | `test/sync-sem-apagao.test.js` |
| editar | `lib/constants.js` (`SYNC`: arquivo do cache, parâmetros do scrypt, tetos do envelope) |
| editar | `lib/sync/config.js` (`syncDefaults`, `parseSyncConfig`, `sharedActive`) |
| editar | `lib/engine/sync.js` (fiação: chaveiro no login, `kcv` na conexão, estado da chave em `statusForUi`, remoção de `syncEraseRemote`) |
| editar | `lib/http-server.js` (rota `POST /api/sync/unlock`; remoção de `/api/sync/erase-remote`) |
| editar | `server.js` (fachadas `syncUnlock` e `syncEstadoDaChave`; remoção da fachada do apagão) |
| editar | `ui/pure/sync.js` (botão do apagão sai; frase da tela entra) |
| editar | `ui/app.js` (handler do apagão sai) |
| editar | `firebase/database.rules.json` (gerado) |
| editar | `firebase/README.md` (lista manual de emulador e projeto real) |
| editar | `CLAUDE.md` (mapa de arquivos) |

Todas as âncoras de linha foram medidas na ponta de `md/integracao` em 15/09/2026, depois da C0b. Reconfira com `grep -n` antes de editar: o texto citado em cada passo é o que vale.

---

## Tarefa 0: preparação e gate de partida

**Arquivos:** nenhum.

- [ ] **Passo 1:** conferir árvore limpa e cortar a branch.

```bash
cd C:/Users/wanderson/Documents/farol-md-exec
git status --short
git checkout md/integracao && git checkout -b md/c1
```

Esperado: `git status --short` vazio.

- [ ] **Passo 2:** medir o gate de partida e anotar os números (vão para a evidência).

```bash
npm run check && npm run lint && npm test
```

Esperado: os três verdes. Se não estiver verde antes de qualquer mudança, pare e reporte.

- [ ] **Passo 3:** confirmar que as peças que esta entrega consome existem.

```bash
grep -n "function signInWithPassword" lib/sync/auth.js
grep -n "function readSyncCredential\|function setSyncCredential" lib/sync/credentials.js
grep -n "function outboxTarget" lib/sync/outbox.js
grep -n "function assertRtdbKey" lib/sync/keys.js
```

Esperado: uma linha para cada. São as quatro peças que o chaveiro, o cache e as tags usam sem reimplementar.

---

## Tarefa 1: caracterização do compartilhamento desligado (antes de mudar código)

**Arquivos:** criar `test/sync-compartilhamento-desligado.test.js`.

**Interfaces:** nenhuma nova. O teste grava cada pedido que chega ao dublê do banco (método, caminho e corpo) e compara com a lista esperada. Ele nasce VERDE contra o código de hoje e precisa continuar verde depois de todas as tarefas: é a prova de "compartilhamento desligado, byte a byte no que sobe".

Este arquivo é o gêmeo do `test/postagem-coordenacao-desligada.test.js` da C0b, e existe pelo mesmo motivo: a garantia que mais importa nesta entrega é a que se prova ANTES de mexer no código.

- [ ] **Passo 1:** criar o teste completo.

```js
// Compartilhamento DESLIGADO: o que sobe para o banco fica exatamente como era antes do
// contrato v2 (CT-COMPAT e CT-ENV, "com o compartilhamento desligado nada disto vale").
// Este arquivo nasce ANTES da mudança, verde contra o código de então, e continua verde
// depois: é a prova byte a byte da presença, do lease, do recibo e do evento de consumo.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c1-desligado-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { SYNC } from '../lib/constants.js';

const { Engine } = await import('../server.js');
const { accountHash, prHash, operationFingerprint, eventIdFor } = await import('../lib/sync/keys.js');
const { buildLease } = await import('../lib/sync/lease.js');
const { buildReceipt } = await import('../lib/sync/receipts.js');
const { payloadFor } = await import('../lib/sync/outbox.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const AGORA = 1_800_000_000_000;
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const PR_KEY = 'Org/Repo#7';
const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
let fake;
let identity;

before(async () => {
  identity = await startFakeIdentity({ apiKey: API_KEY, users: { [EMAIL]: { password: SENHA, uid: 'u1' } } });
  fake = await startFakeRtdb({ token: (t) => identity.tokens.idTokens.includes(t) });
});
after(async () => {
  await fake.close();
  await identity.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; });

// o banco do dublê é http em 127.0.0.1, então o login vai para o Auth do emulador; aqui
// ele é desviado para o dublê de identidade, e nada sai da máquina
async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

function syncCfg(extra = {}) {
  return {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false },
    deviceName: 'Notebook', apiKey: API_KEY, databaseUrl: fake.url, projectId: 'farol-local', ...extra,
  };
}

// `saveConfig()` do engine não recebe argumento: quem aplica configuração é o
// updateSettings, e a conexão sobe de forma assíncrona (o mesmo helper dos testes de sync).
async function salvarSync(engine, cfg) {
  engine.updateSettings({ sync: cfg });
  if (engine.sync.iniciando) await engine.sync.iniciando;
}

async function motorConectado(cfg = syncCfg()) {
  const engine = new Engine();
  engine.log = () => { };
  engine.pushState = () => { };
  engine.sync.fetchImpl = fetchDosDubles;
  await salvarSync(engine, cfg);
  assert.equal((await engine.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  return engine;
}

// O corpo de cada escrita v1 sai das MESMAS funções puras que o engine usa. Se alguma
// delas passar a carregar campo novo com o compartilhamento desligado, o caso reprova.
test('lease v1: o corpo é o de hoje, com o headSha em claro', () => {
  const lease = buildLease({ leaseId: 'L1', deviceId: 'dA', operationKind: 'review', headSha: HEAD, nowMs: AGORA, farolVersion: '9.9.9' });
  assert.equal(lease.headSha, HEAD);
  assert.deepEqual(Object.keys(lease).sort(), ['acquiredAt', 'deviceId', 'expiresAt', 'farolVersion', 'headSha', 'heartbeatAt', 'leaseId', 'operationKind'].sort());
});

test('recibo v1: materialVersion em claro, sem prefixo', () => {
  const recibo = buildReceipt({ operationKind: 'review', materialVersion: HEAD, deviceId: 'dA', leaseId: 'L1', nowMs: AGORA, outcome: 'completed', publicationState: 'published', reviewId: '', farolVersion: '9.9.9' });
  assert.equal(recibo.materialVersion, HEAD);
  assert.equal(String(recibo.materialVersion).startsWith('h1:'), false);
});

test('evento de consumo v1: hashes sem chave e campos em claro, como hoje', () => {
  const sessao = { id: 'a1', at: AGORA, kind: 'review', ref: PR_KEY, account: 'fulano', model: 'Opus 5', profileId: 'p1', inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 1.25, farol: '2.59.4', costSource: 'medido', status: 'ok' };
  const p = payloadFor(sessao, 'dA', '9.9.9');
  assert.equal(p.accountHash, accountHash('fulano'));
  assert.equal(p.refHash, prHash(PR_KEY));
  assert.equal(p.profileId, 'p1');
  assert.equal(p.localId, 'a1');
  assert.equal(p.enc, undefined, 'nada cifrado com o compartilhamento desligado');
});

test('caminhos da coordenação continuam em SHA-256 sem sal', () => {
  assert.match(accountHash('fulano'), /^[0-9a-f]{64}$/);
  assert.match(prHash(PR_KEY), /^[0-9a-f]{64}$/);
  assert.match(operationFingerprint('review', HEAD), /^review_[0-9a-f]{32}$/);
  assert.equal(operationFingerprint('review', HEAD), operationFingerprint('review', HEAD), 'determinístico');
});

test('eventIdFor: vetor dourado sobre uma sessão literal', () => {
  const sessao = { id: 'a1', at: 1_700_000_000_000, kind: 'review', ref: 'Org/Repo#1', model: 'Opus 5', inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4, costUsd: 0.5 };
  assert.equal(eventIdFor(sessao, 'dourado'), eventIdFor(sessao, 'dourado'), 'determinístico');
  assert.match(eventIdFor(sessao, 'dourado'), /^[0-9a-f]{64}$/);
  assert.notEqual(eventIdFor(sessao, 'dourado'), eventIdFor({ ...sessao, at: 1 }, 'dourado'));
});

test('presença com o compartilhamento desligado: o PUT do aparelho é o de hoje', async () => {
  const engine = await motorConectado();
  await engine.syncTick();
  // o `createdAt` é escrito à parte, com o sentinela de timestamp como corpo inteiro: a
  // presença é a outra escrita, e é ela que carrega os campos do aparelho
  const dev = fake.requests.filter((r) => r.path.includes('/devices/') && r.method !== 'GET' && !r.path.includes('/createdAt'));
  assert.ok(dev.length >= 1, 'a presença sobe');
  const corpo = JSON.parse(dev.at(-1).body || '{}');
  assert.deepEqual(Object.keys(corpo).sort(), ['farolVersion', 'lastSeenAt', 'name', 'platform'], 'nenhum campo novo na presença');
  assert.equal(corpo.contract, undefined, 'sem campo de contrato v2');
  assert.equal(corpo.keyReady, undefined, 'sem prontidão de chave');
  assert.equal(typeof corpo.name, 'string', 'o nome do aparelho continua em claro');
});

test('nenhum nó novo do contrato v2 é escrito com o compartilhamento desligado', async () => {
  const engine = await motorConectado();
  await engine.syncTick();
  const proibidos = ['/keyring', '/catalog', '/live/', '/rulesProbe'];
  const tocados = fake.requests.filter((r) => r.method !== 'GET' && proibidos.some((p) => r.path.includes(p)));
  assert.deepEqual(tocados.map((r) => `${r.method} ${r.path}`), []);
});

test('sincronização desligada: nada é escrito e nenhum arquivo novo aparece', async () => {
  const antes = fs.readdirSync(FAROL_HOME);
  const engine = new Engine();
  engine.log = () => { };
  engine.pushState = () => { };
  await engine.syncTick();
  assert.deepEqual(fake.requests.filter((r) => r.method !== 'GET').map((r) => r.path), []);
  assert.deepEqual(fs.readdirSync(FAROL_HOME).sort(), antes.sort());
});
```

- [ ] **Passo 2:** rodar só este arquivo contra o código de hoje.

```bash
node --test test/sync-compartilhamento-desligado.test.js
```

Esperado: 8 testes passando. É teste de caracterização, então não tem fase vermelha: se algum reprovar, a expectativa escrita não bate com o código de hoje. Corrija a EXPECTATIVA para o que o código faz hoje (o objetivo é travar o presente), registre a diferença na evidência e só então siga.

- [ ] **Passo 3 (contraprova):** em `lib/sync/lease.js`, dentro de `buildLease`, acrescente `contract: 2,` ao objeto devolvido. Rode o arquivo: reprova `lease v1: o corpo é o de hoje` (a lista de chaves muda). Restaure com `git checkout lib/sync/lease.js` e rode de novo: verde.

- [ ] **Passo 4:** commit.

```bash
git add test/sync-compartilhamento-desligado.test.js
git commit -m "test: caracteriza o que sobe ao banco com o compartilhamento desligado"
```

---

## Tarefa 2: o interruptor `sync.shared.enabled`

**Arquivos:**
- editar `lib/sync/config.js` (`syncDefaults`, `parseSyncConfig`, export);
- editar `lib/engine/sync.js` (`statusForUi`);
- criar `test/sync-interruptor-compartilhamento.test.js`.

**Interfaces:**
- Produz: `sharedActive(cfg)` em `lib/sync/config.js`, verdadeiro só com `cfg.enabled === true && cfg.shared.enabled === true`; `statusForUi(engine).shared` com o mesmo valor.
- O interruptor nasce **desligado** e só liga com `true` explícito, como os outros três.

- [ ] **Passo 1:** escrever o teste que falha.

```js
// O quarto interruptor da sincronização (CT-ENV): compartilhamento de conteúdo cifrado.
// Nasce desligado, só liga com true explícito e nunca liga sozinho por config editado à
// mão, corrompido ou de versão antiga, pela mesma razão dos outros três.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c1-interruptor-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const cfgMod = (await import('../lib/sync/config.js')).default;
const { sharedActive } = await import('../lib/sync/config.js');
const syncMod = (await import('../lib/engine/sync.js')).default;
const { Engine } = await import('../server.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });

test('o padrão nasce desligado, com a mesma forma dos outros interruptores', () => {
  const d = cfgMod.syncDefaults();
  assert.deepEqual(d.shared, { enabled: false });
});

test('só true explícito liga; qualquer outro valor fica desligado', () => {
  for (const v of [undefined, null, 'true', 1, {}, { enabled: 'true' }, { enabled: 1 }]) {
    assert.deepEqual(cfgMod.parseSyncConfig({ shared: v }).shared, { enabled: false }, JSON.stringify(v));
  }
  assert.deepEqual(cfgMod.parseSyncConfig({ shared: { enabled: true } }).shared, { enabled: true });
});

test('sharedActive exige a chave geral ligada também', () => {
  assert.equal(sharedActive({ enabled: false, shared: { enabled: true } }), false);
  assert.equal(sharedActive({ enabled: true, shared: { enabled: false } }), false);
  assert.equal(sharedActive({ enabled: true, shared: { enabled: true } }), true);
  assert.equal(sharedActive(null), false);
});

test('statusForUi expõe o interruptor, e ele é falso por padrão', () => {
  const e = new Engine();
  assert.equal(syncMod.statusForUi(e).shared, false);
  e.config.sync = { ...e.config.sync, enabled: true, shared: { enabled: true } };
  assert.equal(syncMod.statusForUi(e).shared, true);
});

test('desligar a chave geral zera o compartilhamento no objeto salvo', () => {
  const salvo = cfgMod.parseSyncConfig({ enabled: false, shared: { enabled: true } });
  assert.equal(sharedActive(salvo), false);
});
```

- [ ] **Passo 2:** rodar `node --test test/sync-interruptor-compartilhamento.test.js`. Esperado: reprova (`shared` indefinido, `sharedActive` não exportado).

- [ ] **Passo 3:** implementar em `lib/sync/config.js`.

Em `syncDefaults`, troque

```js
    enabled: false, coordination: { enabled: false }, consolidation: { enabled: false },
```

por

```js
    enabled: false, coordination: { enabled: false }, consolidation: { enabled: false }, shared: { enabled: false },
```

Em `parseSyncConfig`, troque

```js
    consolidation: interruptor(r.consolidation),
```

por

```js
    consolidation: interruptor(r.consolidation),
    // CT-ENV: conteúdo cifrado só sobe com este interruptor ligado. Nasce desligado e,
    // como os outros, só liga com `true` explícito: config de versão antiga não pode
    // começar a publicar título de PR de colega por conta própria.
    shared: interruptor(r.shared),
```

Depois de `consolidationActive`, acrescente

```js
function sharedActive(cfg) {
  return !!(cfg && cfg.enabled === true && cfg.shared && cfg.shared.enabled === true);
}
```

e inclua `sharedActive` nos dois exports.

- [ ] **Passo 4:** implementar em `lib/engine/sync.js`. No import de `../sync/config.js`, acrescente `sharedActive`. No objeto devolvido por `statusForUi`, troque

```js
    enabled: cfg.enabled === true, coordination: coordinationActive(cfg), consolidation: consolidationActive(cfg),
```

por

```js
    enabled: cfg.enabled === true, coordination: coordinationActive(cfg), consolidation: consolidationActive(cfg), shared: sharedActive(cfg),
```

- [ ] **Passo 5:** a tabela de `lib/settings.js` (linha 31) tem uma **cópia** dos defaults de `sync`, e `test/sync-config.test.js` congela a forma deles. Medido na execução: sem os ajustes abaixo, dois testes existentes reprovam, e é exatamente para isso que eles existem (um deles compara `defaults().sync` com `syncDefaults()`, ou seja, pega a divergência entre as duas fontes).
  - em `lib/settings.js`, acrescente `shared: { enabled: false },` ao `def` da chave `sync`, depois de `consolidation`;
  - em `test/sync-config.test.js`, acrescente `shared: { enabled: true }` ao fixture `VALIDO` e `shared: { enabled: false }` ao literal do caso `syncDefaults: tudo desligado e vazio`.

  As duas garantias congeladas ali ficam **iguais**: o padrão continua com tudo desligado e objeto novo a cada chamada, e um objeto válido continua passando inteiro. É o caso previsto na autorização: teste ligado à forma antiga é ajustado preservando a garantia que ele verificava.

- [ ] **Passo 6:** rodar `node --test test/sync-interruptor-compartilhamento.test.js test/sync-config.test.js test/settings.test.js test/sync-engine.test.js test/ui-pure-sync.test.js test/sync-compartilhamento-desligado.test.js`. Esperado: tudo verde.

- [ ] **Passo 7 (contraprova):** em `parseSyncConfig`, troque `shared: interruptor(r.shared),` por `shared: { enabled: r.shared !== undefined },`. Rode o arquivo: reprova `só true explícito liga`. Restaure. Depois, em `sharedActive`, tire a exigência de `cfg.enabled === true` e rode: reprova `sharedActive exige a chave geral ligada também`. Restaure e rode: verde.

- [ ] **Passo 8:** commit.

```bash
git add lib/sync/config.js lib/engine/sync.js lib/settings.js test/sync-interruptor-compartilhamento.test.js test/sync-config.test.js
git commit -m "feat(sync): interruptor do compartilhamento cifrado, desligado por padrao"
```

---

## Tarefa 3: identificadores v2 (tags por HMAC)

**Arquivos:** criar `lib/sync/tags.js` e `test/sync-tags.test.js`.

**Interfaces:**
- `tag64(kId, dominio, valor)` → 64 hex; `tag(kId, dominio, valor)` → os 32 primeiros hex.
- `DOMINIOS` = `['acct', 'pr', 'org', 'mat', 'event', 'review', 'pending']`; domínio fora da lista lança `SyncError` de falha interna.
- `acctTag(kId, login)`, `prTag(kId, key)`, `matTag(kId, versao)`: as normalizações continuam as de `lib/sync/keys.js` (`trim().toLowerCase()` e `canonicalPrKey`).
- Nada aqui toca disco, rede ou engine.

- [ ] **Passo 1:** escrever o teste que falha.

```js
// Identificadores v2 (CT-ENV): o "sal" é a chave secreta K_id, não um valor público. Sal
// público não resolve contra dicionário, porque quem lê o banco lê o sal junto.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c1-tags-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const tags = await import('../lib/sync/tags.js');
const { sha256Hex, canonicalPrKey, assertRtdbKey } = await import('../lib/sync/keys.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });

const K = Buffer.alloc(32, 7);
const K2 = Buffer.alloc(32, 9);
const PR_KEY = 'Org/Repo#7';

test('tag: 32 hex, determinística, e tag64 com o hex inteiro', () => {
  const t = tags.tag(K, 'pr', canonicalPrKey(PR_KEY));
  assert.match(t, /^[0-9a-f]{32}$/);
  assert.equal(t, tags.tag(K, 'pr', canonicalPrKey(PR_KEY)));
  assert.equal(tags.tag64(K, 'pr', canonicalPrKey(PR_KEY)).slice(0, 32), t);
  assert.match(tags.tag64(K, 'pr', canonicalPrKey(PR_KEY)), /^[0-9a-f]{64}$/);
});

test('HMAC, não SHA-256: a tag difere do hash com prefixo e muda com a chave', () => {
  const canonica = canonicalPrKey(PR_KEY);
  assert.notEqual(tags.tag(K, 'pr', canonica), sha256Hex('pr:' + canonica).slice(0, 32));
  assert.notEqual(tags.tag(K, 'pr', canonica), tags.tag(K2, 'pr', canonica));
});

test('o domínio separa espaços: mesmo valor em domínios diferentes dá tags diferentes', () => {
  assert.notEqual(tags.tag(K, 'acct', 'x'), tags.tag(K, 'pr', 'x'));
  assert.notEqual(tags.tag(K, 'event', 'x'), tags.tag(K, 'review', 'x'));
});

test('o valor entra inteiro na pré-imagem: NUL dentro do valor não é engolido', () => {
  // se o separador fosse ignorado ou o valor fosse saneado, estes dois cairiam na mesma
  // pré-imagem, e dois PRs diferentes dividiriam identificador
  assert.notEqual(tags.tag(K, 'acct', 'b\u0000c'), tags.tag(K, 'acct', 'bc'));
  assert.notEqual(tags.tag(K, 'acct', 'a\u0000b'), tags.tag(K, 'acct', 'ab'));
});

test('domínio fora da lista lança, em vez de gravar num espaço inventado', () => {
  assert.throws(() => tags.tag(K, 'inventado', 'x'), /domínio/i);
  assert.deepEqual([...tags.DOMINIOS], ['acct', 'pr', 'org', 'mat', 'event', 'review', 'pending']);
});

test('chave que não tem 32 bytes lança: K_id malformada nunca produz identificador', () => {
  assert.throws(() => tags.tag(Buffer.alloc(16, 1), 'pr', 'x'), /K_id/);
  assert.throws(() => tags.tag('nao-e-buffer', 'pr', 'x'), /K_id/);
});

test('as normalizações são as mesmas de hoje', () => {
  assert.equal(tags.acctTag(K, '  Fulano  '), tags.tag(K, 'acct', 'fulano'));
  assert.equal(tags.prTag(K, 'ORG/Repo#07'), tags.tag(K, 'pr', 'org/repo#7'));
  assert.equal(tags.prTag(K, 'sem-formato'), '', 'chave de PR inválida não vira tag');
});

test('toda tag passa no validador de chave do banco', () => {
  for (const d of tags.DOMINIOS) assert.equal(assertRtdbKey(tags.tag(K, d, 'valor')), tags.tag(K, d, 'valor'));
});

test('mesmaTag compara em tempo constante e não confunde tamanhos', () => {
  const t = tags.tag(K, 'pr', 'org/repo#7');
  assert.equal(tags.mesmaTag(t, t), true);
  assert.equal(tags.mesmaTag(t, t.slice(0, 31)), false);
  assert.equal(tags.mesmaTag('', ''), false);
  assert.equal(tags.mesmaTag(t, tags.tag(K2, 'pr', 'org/repo#7')), false);
});
```

- [ ] **Passo 2:** rodar `node --test test/sync-tags.test.js`. Esperado: `Cannot find module` apontando `lib/sync/tags.js`.

- [ ] **Passo 3:** criar `lib/sync/tags.js`.

```js
// Identificadores v2 da sincronização (CT-ENV). Puro: sem estado, sem IO, sem rede.
//
// O identificador v1 é SHA-256 sem sal, e a pré-imagem dele é enumerável: quem lê o banco
// testa nomes conhecidos de conta e de PR e confere o hash. Sal público não resolveria,
// porque quem lê o banco lê o sal junto. O "sal" aqui é a chave secreta K_id, que só
// existe dentro do chaveiro embrulhado pela senha.
//
// K_id é estável por época de chave e NÃO gira numa rotação comum: o histórico precisa
// continuar ligável ao mesmo PR e à mesma conta depois de uma rotação de K_enc.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalPrKey, assertRtdbKey } from './keys.js';
import { SyncError, SYNC_CODES } from './errors.js';

const DOMINIOS = ['acct', 'pr', 'org', 'mat', 'event', 'review', 'pending'];
const TAMANHO_K_ID = 32;
const TAG_HEX = 32;
const NUL = '\u0000';

function falhaInterna(msg) {
  return new SyncError(SYNC_CODES.FALHA_INTERNA, msg);
}

function chaveValida(kId) {
  if (!Buffer.isBuffer(kId) || kId.length !== TAMANHO_K_ID) throw falhaInterna('K_id precisa ser um Buffer de 32 bytes');
  return kId;
}

// A pré-imagem leva 'farol' e a versão do esquema antes do domínio: um dia com contrato
// v3 as tags não podem colidir com as da v2, nem por acidente nem de propósito.
function preImagem(dominio, valor) {
  if (!DOMINIOS.includes(dominio)) throw falhaInterna(`domínio de identificador desconhecido: ${String(dominio)}`);
  return ['farol', 'v2', dominio, String(valor === null || valor === undefined ? '' : valor)].join(NUL);
}

function tag64(kId, dominio, valor) {
  return createHmac('sha256', chaveValida(kId)).update(preImagem(dominio, valor), 'utf8').digest('hex');
}

// 128 bits de identificador: chave curta no banco e colisão fora de alcance prático.
function tag(kId, dominio, valor) {
  return tag64(kId, dominio, valor).slice(0, TAG_HEX);
}

function acctTag(kId, login) {
  return tag(kId, 'acct', String(login || '').trim().toLowerCase());
}

// Chave de PR que não casa o formato não vira tag: identificador vazio é recusado pelo
// assertRtdbKey mais adiante, e inventar um aqui esconderia o erro dentro do caminho.
function prTag(kId, key) {
  const canonica = canonicalPrKey(key);
  return canonica ? tag(kId, 'pr', canonica) : '';
}

function matTag(kId, versao) {
  return tag(kId, 'mat', String(versao === null || versao === undefined ? '' : versao));
}

// Comparação de tag em tempo constante, para o caso de a tag vir de fora (sonda, item
// remoto): comparar com === vaza o prefixo comum pelo tempo.
function mesmaTag(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  if (x.length !== y.length || !x.length) return false;
  return timingSafeEqual(x, y);
}

export default { DOMINIOS, tag, tag64, acctTag, prTag, matTag, mesmaTag, assertRtdbKey };
export { DOMINIOS, tag, tag64, acctTag, prTag, matTag, mesmaTag };
```

- [ ] **Passo 4:** rodar `node --test test/sync-tags.test.js test/sync-keys.test.js`. Esperado: verde.

- [ ] **Passo 5 (contraprova):** três mutações, uma de cada vez, restaurando e rodando de novo depois de cada uma. **Não** troque `createHmac` por `createHash`: sem o import o arquivo quebra, e o teste reprovaria por erro de carga, não pela garantia.
  (a) troque `createHmac('sha256', chaveValida(kId))` por `createHmac('sha256', Buffer.alloc(32, 1))` (chave fixa, que é o que transforma a tag num hash sem segredo): reprovam `HMAC, não SHA-256`, `chave que não tem 32 bytes lança` e `mesmaTag` (3 falhas medidas);
  (b) apague a linha do `throw` de domínio desconhecido: reprova `domínio fora da lista lança` (1 falha);
  (c) em `preImagem`, troque o valor por `String(...).split(NUL).join('')` (saneamento do valor): reprova `o valor entra inteiro na pré-imagem` (1 falha).

- [ ] **Passo 6:** commit.

```bash
git add lib/sync/tags.js test/sync-tags.test.js
git commit -m "feat(sync): identificadores v2 por HMAC com a chave secreta do conjunto"
```

---

## Tarefa 4: KEK e embrulho do material pela senha

**Arquivos:**
- editar `lib/constants.js` (`SYNC`: parâmetros do scrypt e nome do arquivo de cache);
- criar `lib/sync/kek.js` e `test/sync-kek.test.js`.

**Interfaces:**
- `parametrosPadrao()` → `{ alg: 'scrypt', N, r, p, salt }` com sal novo de 16 bytes em base64url.
- `async embrulhar(material, senha, { uid, rev, kdf })` → `{ kdf, blob }`, com `blob = 'w1.<iv>.<ct>.<tag>'`.
- `async abrir(blob, senha, kdf, { uid, rev })` → material ou `null` (senha errada é `null`, nunca exceção).
- `novoMaterial()` → `{ v: 1, id, enc: { g1 } }` com 32 bytes aleatórios cada, em base64url.
- `kcvDe(encBase64url)` → 16 hex.
- `bufferDe(valorBase64url)` → Buffer, usado por quem cifra.
- Nada aqui toca disco, rede ou engine. `scrypt` roda **assíncrono**, no threadpool.

- [ ] **Passo 1:** escrever o teste que falha.

```js
// Embrulho do material pela senha do Firebase (CT-ENV). O scrypt roda assíncrono: o
// engine não pode travar o event loop por ~90 ms a cada login, e travaria com scryptSync.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c1-kek-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const kek = await import('../lib/sync/kek.js');
const { SYNC } = await import('../lib/constants.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });

const UID = 'u1';
const SENHA = 'senha longa de teste';

test('parâmetros: os da tabela OWASP, com sal novo a cada chamada', () => {
  const a = kek.parametrosPadrao();
  const b = kek.parametrosPadrao();
  assert.equal(a.alg, 'scrypt');
  assert.equal(a.N, SYNC.KEK_N);
  assert.equal(a.r, SYNC.KEK_R);
  assert.equal(a.p, SYNC.KEK_P);
  assert.equal(Buffer.from(a.salt, 'base64url').length, 16);
  assert.notEqual(a.salt, b.salt, 'sal por embrulho, nunca fixo');
});

test('material novo: 32 bytes por chave, e K_enc não deriva de K_id', () => {
  const m = kek.novoMaterial();
  assert.equal(m.v, 1);
  assert.equal(Buffer.from(m.id, 'base64url').length, 32);
  assert.equal(Buffer.from(m.enc.g1, 'base64url').length, 32);
  assert.notEqual(m.id, m.enc.g1);
  assert.notEqual(kek.novoMaterial().id, m.id);
});

test('embrulhar e abrir: a mesma senha devolve o material igual', async () => {
  const m = kek.novoMaterial();
  const kdf = kek.parametrosPadrao();
  const { blob } = await kek.embrulhar(m, SENHA, { uid: UID, rev: 1, kdf });
  assert.match(blob, /^w1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(await kek.abrir(blob, SENHA, kdf, { uid: UID, rev: 1 }), m);
});

test('senha errada devolve null, não exceção: tag GCM inválida é resposta, não queda', async () => {
  const kdf = kek.parametrosPadrao();
  const { blob } = await kek.embrulhar(kek.novoMaterial(), SENHA, { uid: UID, rev: 1, kdf });
  assert.equal(await kek.abrir(blob, 'outra senha', kdf, { uid: UID, rev: 1 }), null);
});

test('a AAD amarra uid, rev e os parâmetros: mexer em qualquer um invalida o embrulho', async () => {
  const kdf = kek.parametrosPadrao();
  const { blob } = await kek.embrulhar(kek.novoMaterial(), SENHA, { uid: UID, rev: 3, kdf });
  assert.equal(await kek.abrir(blob, SENHA, kdf, { uid: 'outro', rev: 3 }), null, 'uid diferente');
  assert.equal(await kek.abrir(blob, SENHA, kdf, { uid: UID, rev: 4 }), null, 'rev diferente');
  assert.equal(await kek.abrir(blob, SENHA, { ...kdf, N: kdf.N / 2 }, { uid: UID, rev: 3 }), null, 'custo diferente');
  assert.equal(await kek.abrir(blob, SENHA, { ...kdf, salt: kek.parametrosPadrao().salt }, { uid: UID, rev: 3 }), null, 'sal diferente');
});

test('blob corrompido em qualquer pedaço devolve null', async () => {
  const kdf = kek.parametrosPadrao();
  const { blob } = await kek.embrulhar(kek.novoMaterial(), SENHA, { uid: UID, rev: 1, kdf });
  const partes = blob.split('.');
  for (const i of [1, 2, 3]) {
    const trocado = [...partes];
    trocado[i] = Buffer.from(Buffer.from(trocado[i], 'base64url').map((b, j) => (j === 0 ? b ^ 1 : b))).toString('base64url');
    assert.equal(await kek.abrir(trocado.join('.'), SENHA, kdf, { uid: UID, rev: 1 }), null, `pedaço ${i}`);
  }
  assert.equal(await kek.abrir('x1.a.b.c', SENHA, kdf, { uid: UID, rev: 1 }), null, 'prefixo errado');
  assert.equal(await kek.abrir('', SENHA, kdf, { uid: UID, rev: 1 }), null, 'vazio');
});

test('kcv: 16 hex, estável por chave e diferente entre chaves', () => {
  const m = kek.novoMaterial();
  assert.match(kek.kcvDe(m.enc.g1), /^[0-9a-f]{16}$/);
  assert.equal(kek.kcvDe(m.enc.g1), kek.kcvDe(m.enc.g1));
  assert.notEqual(kek.kcvDe(m.enc.g1), kek.kcvDe(kek.novoMaterial().enc.g1));
});

test('o scrypt não bloqueia o event loop enquanto deriva', async () => {
  const kdf = kek.parametrosPadrao();
  let bateu = 0;
  const timer = setInterval(() => { bateu++; }, 5);
  await kek.embrulhar(kek.novoMaterial(), SENHA, { uid: UID, rev: 1, kdf });
  clearInterval(timer);
  assert.ok(bateu > 0, 'o laço de eventos continuou girando durante a derivação');
});
```

- [ ] **Passo 2:** rodar `node --test test/sync-kek.test.js`. Esperado: `Cannot find module` apontando `lib/sync/kek.js`.

- [ ] **Passo 3:** em `lib/constants.js`, dentro de `SYNC`, depois de `DAY_TZ`, acrescente:

```js
  // Embrulho do material de chave pela senha (CT-ENV). Linha equivalente da tabela OWASP
  // para scrypt: cerca de 16 MiB, que cabe no maxmem padrão do Node. Medido em 91 a 95 ms
  // no desktop; no Termux ainda NÃO foi medido, e acima de 3 s a spec manda cair para
  // N=8192, r=8, p=10. Os parâmetros viajam no embrulho, então mudam sem migração.
  KEK_N: 16384,
  KEK_R: 8,
  KEK_P: 5,
  KEK_SALT_BYTES: 16,
  KEY_CACHE_FILE: 'sync-key.json',          // em ~/.farol/, FORA do config.json e de state/
```

- [ ] **Passo 4:** criar `lib/sync/kek.js`.

```js
// Embrulho do material de chave pela senha da conta do Firebase (CT-ENV). Puro no sentido
// que importa aqui: sem estado, sem IO e sem rede. Só node:crypto.
//
// A senha nunca vira chave direto: ela passa pelo scrypt com sal por embrulho, e a KEK
// resultante cifra o material em AES-256-GCM. O scrypt roda ASSÍNCRONO, no threadpool: a
// versão síncrona travaria o event loop do engine por dezenas de milissegundos a cada
// login, e o engine atende HTTP e SSE no mesmo laço.
//
// A AAD amarra uid, slot, parâmetros, sal e rev. Trocar qualquer um deles no banco
// invalida o embrulho em vez de produzir material silenciosamente errado.
import { scrypt, randomBytes, createCipheriv, createDecipheriv, createHmac } from 'node:crypto';
import { SYNC } from '../constants.js';
import io from '../io.js';

const PREFIXO = 'w1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const CHAVE_BYTES = 32;
const KCV_HEX = 16;

function parametrosPadrao() {
  return { alg: 'scrypt', N: SYNC.KEK_N, r: SYNC.KEK_R, p: SYNC.KEK_P, salt: randomBytes(SYNC.KEK_SALT_BYTES).toString('base64url') };
}

function b64(buf) { return Buffer.from(buf).toString('base64url'); }
function debase64(texto) { return Buffer.from(String(texto || ''), 'base64url'); }

function bufferDe(valor) {
  const b = debase64(valor);
  return b.length === CHAVE_BYTES ? b : null;
}

function novoMaterial() {
  return { v: 1, id: b64(randomBytes(CHAVE_BYTES)), enc: { g1: b64(randomBytes(CHAVE_BYTES)) } };
}

// Prova, sem a senha, que a chave que está no cache é a mesma que o banco conhece.
function kcvDe(encBase64url) {
  const chave = bufferDe(encBase64url);
  if (!chave) return '';
  return createHmac('sha256', chave).update('farol|kcv', 'utf8').digest('hex').slice(0, KCV_HEX);
}

function aad(uid, kdf, rev) {
  return ['farol', 'wrap', '1', String(uid || ''), 'pw', String(kdf.alg), String(kdf.N), String(kdf.r), String(kdf.p), String(kdf.salt), String(rev)].join('|');
}

// scrypt assíncrono: nunca scryptSync no event loop do engine.
function derivar(senha, kdf) {
  return new Promise((resolve, reject) => {
    const opcoes = { N: Number(kdf.N), r: Number(kdf.r), p: Number(kdf.p) };
    scrypt(String(senha === null || senha === undefined ? '' : senha), debase64(kdf.salt), CHAVE_BYTES, opcoes, (err, chave) => {
      if (err) reject(err);
      else resolve(chave);
    });
  });
}

async function embrulhar(material, senha, { uid, rev, kdf }) {
  const parametros = kdf || parametrosPadrao();
  const chave = await derivar(senha, parametros);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', chave, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad(uid, parametros, rev), 'utf8'));
  const ct = Buffer.concat([cipher.update(io.safeStringify(material, '{}'), 'utf8'), cipher.final()]);
  return { kdf: parametros, blob: [PREFIXO, b64(iv), b64(ct), b64(cipher.getAuthTag())].join('.') };
}

// Senha errada, embrulho mexido ou AAD diferente devolvem null: é resposta esperada do
// fluxo de login, não falha de programa.
async function abrir(blob, senha, kdf, { uid, rev }) {
  const partes = String(blob || '').split('.');
  if (partes.length !== 4 || partes[0] !== PREFIXO) return null;
  const iv = debase64(partes[1]);
  const ct = debase64(partes[2]);
  const tag = debase64(partes[3]);
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || !ct.length) return null;
  try {
    const chave = await derivar(senha, kdf);
    const decipher = createDecipheriv('aes-256-gcm', chave, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad(uid, kdf, rev), 'utf8'));
    decipher.setAuthTag(tag);
    const claro = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    const material = io.parseJson(claro, null);
    return material && typeof material === 'object' ? material : null;
  } catch {
    // tag GCM inválida: senha errada ou embrulho adulterado, que é o caminho normal
    return null;
  }
}

export default { parametrosPadrao, novoMaterial, embrulhar, abrir, kcvDe, bufferDe };
export { parametrosPadrao, novoMaterial, embrulhar, abrir, kcvDe, bufferDe };
```

- [ ] **Passo 5:** rodar `node --test test/sync-kek.test.js test/sync-constants.test.js`. Esperado: verde.

- [ ] **Passo 6 (contraprova):** três mutações, uma de cada vez (1 falha cada, medidas):
  (a) em `aad`, reduza a lista para `['farol', 'wrap', '1', 'pw', String(kdf.alg)]`: reprova `a AAD amarra uid, rev e os parâmetros`, que é o que impede o embrulho de abrir sob outro uid ou outro rev;
  (b) em `kcvDe`, troque `createHmac('sha256', chave)` por `createHmac('sha256', Buffer.alloc(32))`: reprova `kcv`, porque o kcv deixa de provar qualquer coisa sobre a chave;
  (c) em `novoMaterial`, faça `enc.g1` receber a mesma `id`: reprova `K_enc não deriva de K_id`, que é o que faz a rotação valer contra um cache vazado.

  **Não** troque `scrypt` por `scryptSync`: o símbolo não está importado, o arquivo quebra e o teste reprovaria por erro de carga, não pela garantia. O caso `o scrypt não bloqueia o event loop` fica declarado como teste de propriedade sem mutação textual limpa: o que ele trava é qual API é usada, e trocá-la exige mexer no import.

- [ ] **Passo 7:** commit.

```bash
git add lib/constants.js lib/sync/kek.js test/sync-kek.test.js
git commit -m "feat(sync): material de chave embrulhado pela senha, com scrypt assincrono"
```

---

## Tarefa 5: chaveiro remoto (`users/{uid}/keyring`)

**Arquivos:** criar `lib/sync/chaveiro.js` e `test/sync-chaveiro.test.js`.

**Interfaces:**
- `async lerChaveiro(client, uid)` → `{ ok: true, chaveiro, etag }`, `{ ok: true, chaveiro: null, etag }` (não existe) ou `{ ok: false, motivo }`.
- `async criarChaveiro(client, uid, senha, deviceId)` → `{ ok: true, material, chaveiro }` ou `{ ok: false, motivo }`. PUT com `if-match: null_etag` e `rev: 1`. Um 412 significa que outro aparelho criou antes: relê, abre o do vencedor e **descarta** o material próprio, que ainda não cifrou nada.
- `async abrirChaveiro(chaveiro, senha, uid)` → material ou `null`.
- `async reembrulhar(client, uid, material, senha, { chaveiro, etag, deviceId })` → `rev + 1`, sal novo, CAS por ETag.
- `async rotacionar(client, uid, material, senha, { chaveiro, etag, deviceId })` → geração `g(n+1)` aleatória, `cur` trocado, gerações antigas preservadas.
- `chaveiroValido(x)`, PURA.
- **Keyring visto e depois ausente nunca é recriado sozinho:** quem chama informa `jaVisto` e recebe `{ ok: false, motivo: 'chave-perdida' }`.

- [ ] **Passo 1:** escrever o teste que falha.

```js
// Chaveiro remoto (CT-ENV): nó único, criado só depois de o login por senha dar certo,
// com CAS por ETag. Corrida de criação termina com um chaveiro só, e chaveiro que some
// depois de visto nunca é recriado sozinho.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c1-chaveiro-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';

const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const chaveiro = await import('../lib/sync/chaveiro.js');
const kek = await import('../lib/sync/kek.js');

const TOKEN = 'tok-ok';
const UID = 'u1';
const SENHA = 'senha de teste';
let fake;

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => {
  await fake.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; });

function cliente(token = TOKEN) {
  return createRtdbClient({ databaseUrl: fake.url, projectId: 'farol-local', getIdToken: async () => ({ ok: true, idToken: token }) });
}

function noBanco() {
  const t = fake.tree();
  return t && t.users && t.users[UID] ? t.users[UID].keyring : null;
}

test('criação: rev 1, cur g1, kcv conferível e blob que abre com a senha', async () => {
  const r = await chaveiro.criarChaveiro(cliente(), UID, SENHA, 'dA');
  assert.equal(r.ok, true);
  const no = noBanco();
  assert.equal(no.v, 1);
  assert.equal(no.rev, 1);
  assert.equal(no.cur, 'g1');
  assert.equal(no.kcv.g1, kek.kcvDe(r.material.enc.g1));
  assert.equal(no.slots.pw.by, 'dA');
  assert.deepEqual(await chaveiro.abrirChaveiro(no, SENHA, UID), r.material);
});

test('o material nunca sobe em claro: o nó não carrega K_id nem K_enc', async () => {
  const r = await chaveiro.criarChaveiro(cliente(), UID, SENHA, 'dA');
  const texto = JSON.stringify(noBanco());
  assert.equal(texto.includes(r.material.id), false);
  assert.equal(texto.includes(r.material.enc.g1), false);
  assert.equal(texto.includes(SENHA), false);
});

test('corrida na criação: dois aparelhos terminam com um chaveiro só e a mesma K_id', async () => {
  const [a, b] = await Promise.all([
    chaveiro.criarChaveiro(cliente(), UID, SENHA, 'dA'),
    chaveiro.criarChaveiro(cliente(), UID, SENHA, 'dB'),
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.material.id, b.material.id, 'quem perdeu a corrida adota o material do vencedor');
  assert.equal(noBanco().rev, 1, 'a corrida não sobe o rev');
});

test('abrir com a senha errada devolve null, e o nó fica intacto', async () => {
  await chaveiro.criarChaveiro(cliente(), UID, SENHA, 'dA');
  const antes = JSON.stringify(noBanco());
  assert.equal(await chaveiro.abrirChaveiro(noBanco(), 'outra', UID), null);
  assert.equal(JSON.stringify(noBanco()), antes);
});

test('chaveiro visto e depois ausente: chave-perdida, sem recriar nada', async () => {
  await chaveiro.criarChaveiro(cliente(), UID, SENHA, 'dA');
  fake.setTree(null);
  fake.requests.length = 0;
  const r = await chaveiro.garantirChaveiro(cliente(), UID, SENHA, { deviceId: 'dA', jaVisto: true });
  assert.deepEqual(r, { ok: false, motivo: 'chave-perdida' });
  assert.deepEqual(fake.requests.filter((x) => x.method === 'PUT'), [], 'nenhum PUT depois de ver o sumiço');
});

test('reembrulho: rev sobe um, sal novo, e a senha nova abre o material antigo', async () => {
  const c = cliente();
  const criado = await chaveiro.criarChaveiro(c, UID, SENHA, 'dA');
  const lido = await chaveiro.lerChaveiro(c, UID);
  const salAntigo = lido.chaveiro.slots.pw.kdf.salt;
  const r = await chaveiro.reembrulhar(c, UID, criado.material, 'senha nova', { chaveiro: lido.chaveiro, etag: lido.etag, deviceId: 'dA' });
  assert.equal(r.ok, true);
  assert.equal(noBanco().rev, 2);
  assert.notEqual(noBanco().slots.pw.kdf.salt, salAntigo);
  assert.deepEqual(await chaveiro.abrirChaveiro(noBanco(), 'senha nova', UID), criado.material);
  assert.equal(await chaveiro.abrirChaveiro(noBanco(), SENHA, UID), null, 'a senha antiga não abre mais');
});

test('rotação: geração nova, cur trocado, gerações antigas preservadas', async () => {
  const c = cliente();
  const criado = await chaveiro.criarChaveiro(c, UID, SENHA, 'dA');
  const lido = await chaveiro.lerChaveiro(c, UID);
  const r = await chaveiro.rotacionar(c, UID, criado.material, SENHA, { chaveiro: lido.chaveiro, etag: lido.etag, deviceId: 'dA' });
  assert.equal(r.ok, true);
  assert.equal(noBanco().cur, 'g2');
  assert.equal(noBanco().rev, 2);
  assert.equal(r.material.id, criado.material.id, 'K_id não gira numa rotação comum');
  assert.equal(r.material.enc.g1, criado.material.enc.g1, 'a geração antiga fica, para ler o histórico');
  assert.notEqual(r.material.enc.g2, r.material.enc.g1);
  assert.equal(noBanco().kcv.g2, kek.kcvDe(r.material.enc.g2));
});

test('chaveiroValido: forma errada é recusada antes de qualquer decifragem', () => {
  assert.equal(chaveiro.chaveiroValido(null), false);
  assert.equal(chaveiro.chaveiroValido({ v: 1, rev: 1, cur: 'g1' }), false);
  assert.equal(chaveiro.chaveiroValido({ v: 1, rev: 0, cur: 'g1', kids: {}, kcv: {}, slots: { pw: {} }, updatedAt: 1, epochSince: 1 }), false);
});
```

- [ ] **Passo 2:** rodar `node --test test/sync-chaveiro.test.js`. Esperado: `Cannot find module` apontando `lib/sync/chaveiro.js`.

- [ ] **Passo 3:** criar `lib/sync/chaveiro.js`.

```js
// Chaveiro remoto da sincronização (CT-ENV): users/{uid}/keyring, nó único que guarda
// K_id e K_enc embrulhadas pela senha. Folha de IO: fala com o cliente do banco e com o
// kek, e não conhece o engine.
//
// Três regras que vêm da spec e não são negociáveis aqui:
//   1. só se cria chaveiro DEPOIS de o login por senha ter dado certo, senão uma senha
//      errada embrulharia material que ninguém mais conseguiria abrir;
//   2. a criação é CAS com if-match null_etag; 412 quer dizer que outro aparelho criou
//      antes, e aí o material próprio é DESCARTADO (ele ainda não cifrou nada);
//   3. chaveiro que já foi visto e depois some nunca é recriado sozinho: isso é o estado
//      'chave-perdida', com saída explícita e senha, porque recriar publicaria conteúdo
//      novo sob uma chave que o histórico não conhece.
import { randomBytes } from 'node:crypto';
import kek from './kek.js';

const REV_INICIAL = 1;
const PRIMEIRA_GERACAO = 'g1';
const GERACAO_RE = /^g[0-9]+$/;

function falha(motivo) {
  return { ok: false, motivo };
}

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function chaveiroValido(x) {
  if (!objeto(x) || x.v !== 1) return false;
  if (!Number.isFinite(Number(x.rev)) || Number(x.rev) < 1) return false;
  if (!GERACAO_RE.test(String(x.cur || ''))) return false;
  return objeto(x.kids) && objeto(x.kcv) && objeto(x.slots) && objeto(x.slots.pw);
}

function caminho(uid) {
  return `/users/${uid}/keyring`;
}

function proximaGeracao(material) {
  const numeros = Object.keys(material.enc || {}).map((g) => Number(String(g).slice(1)) || 0);
  return `g${Math.max(0, ...numeros) + 1}`;
}

function kcvDeTodas(material) {
  const kcv = {};
  for (const [g, valor] of Object.entries(material.enc || {})) kcv[g] = kek.kcvDe(valor);
  return kcv;
}

function kidsDe(material, anterior, agora) {
  const kids = objeto(anterior) ? { ...anterior } : {};
  for (const g of Object.keys(material.enc || {})) if (!kids[g]) kids[g] = agora;
  return kids;
}

async function montarNo(material, senha, { uid, rev, cur, kids, epochSince, deviceId, agora }) {
  const { kdf, blob } = await kek.embrulhar(material, senha, { uid, rev, kdf: kek.parametrosPadrao() });
  return {
    v: 1, rev, updatedAt: agora, epochSince, cur,
    kids: kidsDe(material, kids, agora), kcv: kcvDeTodas(material),
    slots: { pw: { kdf, blob, by: String(deviceId || '') } },
  };
}

async function lerChaveiro(client, uid) {
  try {
    const r = await client.get(caminho(uid), { etag: true });
    if (!r.ok) return falha('indisponivel');
    const bruto = r.data;
    return { ok: true, chaveiro: chaveiroValido(bruto) ? bruto : null, etag: r.etag || 'null_etag' };
  } catch {
    return falha('indisponivel');
  }
}

async function abrirChaveiro(chaveiro, senha, uid) {
  if (!chaveiroValido(chaveiro)) return null;
  const slot = chaveiro.slots.pw;
  return kek.abrir(slot.blob, senha, slot.kdf, { uid, rev: Number(chaveiro.rev) });
}

// Perdeu a corrida: relê e adota o material de quem criou primeiro. O material sorteado
// aqui é jogado fora sem cerimônia, porque nada foi cifrado com ele ainda.
async function adotarDoVencedor(client, uid, senha) {
  const lido = await lerChaveiro(client, uid);
  if (!lido.ok || !lido.chaveiro) return falha('indisponivel');
  const material = await abrirChaveiro(lido.chaveiro, senha, uid);
  if (!material) return falha('senha-nao-abre');
  return { ok: true, material, chaveiro: lido.chaveiro };
}

async function criarChaveiro(client, uid, senha, deviceId) {
  const agora = Date.now();
  const material = kek.novoMaterial();
  const no = await montarNo(material, senha, {
    uid, rev: REV_INICIAL, cur: PRIMEIRA_GERACAO, kids: null, epochSince: agora, deviceId, agora,
  });
  try {
    const w = await client.put(caminho(uid), no, { ifMatch: 'null_etag' });
    if (w.ok) return { ok: true, material, chaveiro: no };
    return adotarDoVencedor(client, uid, senha);
  } catch {
    return falha('indisponivel');
  }
}

// `jaVisto` é o que separa "primeiro login deste aparelho" de "o chaveiro sumiu".
async function garantirChaveiro(client, uid, senha, { deviceId, jaVisto }) {
  const lido = await lerChaveiro(client, uid);
  if (!lido.ok) return falha('indisponivel');
  if (lido.chaveiro) {
    const material = await abrirChaveiro(lido.chaveiro, senha, uid);
    if (!material) return falha('senha-nao-abre');
    return { ok: true, material, chaveiro: lido.chaveiro };
  }
  if (jaVisto) return falha('chave-perdida');
  return criarChaveiro(client, uid, senha, deviceId);
}

async function gravarVersaoNova(client, uid, material, senha, { chaveiro, etag, deviceId, cur }) {
  const agora = Date.now();
  const rev = Number(chaveiro.rev) + 1;
  const no = await montarNo(material, senha, {
    uid, rev, cur: cur || chaveiro.cur, kids: chaveiro.kids, epochSince: chaveiro.epochSince, deviceId, agora,
  });
  try {
    const w = await client.put(caminho(uid), no, { ifMatch: etag || 'null_etag' });
    if (!w.ok) return falha('conflito');
    return { ok: true, material, chaveiro: no };
  } catch {
    return falha('indisponivel');
  }
}

function reembrulhar(client, uid, material, senha, opcoes) {
  return gravarVersaoNova(client, uid, material, senha, opcoes);
}

// Rotação: geração nova e aleatória, `cur` apontando para ela. As antigas ficam no
// material para continuar lendo o histórico; nada é recifrado em massa.
function rotacionar(client, uid, material, senha, opcoes) {
  const nova = proximaGeracao(material);
  const comNova = { ...material, enc: { ...material.enc, [nova]: randomBytes(32).toString('base64url') } };
  return gravarVersaoNova(client, uid, comNova, senha, { ...opcoes, cur: nova });
}

export default { lerChaveiro, criarChaveiro, garantirChaveiro, abrirChaveiro, reembrulhar, rotacionar, chaveiroValido };
export { lerChaveiro, criarChaveiro, garantirChaveiro, abrirChaveiro, reembrulhar, rotacionar, chaveiroValido };
```

- [ ] **Passo 4:** rodar `node --test test/sync-chaveiro.test.js test/sync-rtdb.test.js`. Esperado: verde.

- [ ] **Passo 5 (contraprova):** em `garantirChaveiro`, troque `if (jaVisto) return falha('chave-perdida');` por nada (apague a linha). Rode `node --test test/sync-chaveiro.test.js`: reprova `chaveiro visto e depois ausente` (aparece um PUT). Restaure. Depois, em `criarChaveiro`, troque `{ ifMatch: 'null_etag' }` por `{}` e rode: reprova a corrida (dois materiais diferentes). Restaure e rode: verde.

- [ ] **Passo 6:** commit.

```bash
git add lib/sync/chaveiro.js test/sync-chaveiro.test.js
git commit -m "feat(sync): chaveiro remoto com CAS por etag, reembrulho e rotacao"
```

---

## Tarefa 6: cache local da chave

**Arquivos:** criar `lib/sync/cache-chave.js` e `test/sync-cache-chave.test.js`.

**Interfaces:**
- `caminhoDoCache()` → `~/.farol/sync-key.json`.
- `lerCache()` → `{ uid, destino, keyringRev, cur, id, enc, savedAt }` ou `null`. **Só leitura, sem scrypt e sem rede**: é o que o boot usa.
- `gravarCache(valor)` → `true`/`false`, com `chmod 0600` em TODA gravação.
- `apagarCache()` → `true`/`false`.
- `cacheServe(cache, { uid, destino })` → `false` quando `uid` ou destino mudam.
- `cacheConfere(cache, chaveiro)` → compara o `kcv` de cada geração do cache com o do chaveiro; qualquer divergência é `false`.
- Regra dura: **desligar não apaga o cache**, e credencial inválida do Firebase **não** apaga o cache. Só "Sair deste aparelho" apaga.

- [ ] **Passo 1:** escrever o teste que falha.

```js
// Cache local da chave (CT-ENV): mora em ~/.farol, fora do config.json e fora de state/,
// que é o cwd das sessões. O boot só LÊ; quem deriva chave é o login.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c1-cache-'));
const CASA = path.join(BASE, 'casa');
fs.mkdirSync(CASA, { recursive: true });
process.env.FAROL_HOME = path.join(BASE, 'farol');
process.env.HOME = CASA;
process.env.USERPROFILE = CASA;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const cache = await import('../lib/sync/cache-chave.js');
const kek = await import('../lib/sync/kek.js');
const { IS_WIN } = await import('../lib/paths.js');

after(() => { try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });
beforeEach(() => { cache.apagarCache(); });

const MATERIAL = kek.novoMaterial();
const DESTINO = 'u1|https://x.firebaseio.com';

function valor(extra = {}) {
  return { uid: 'u1', destino: DESTINO, keyringRev: 1, cur: 'g1', id: MATERIAL.id, enc: MATERIAL.enc, ...extra };
}

test('o cache mora em ~/.farol, fora do config.json e de state/', () => {
  const p = cache.caminhoDoCache();
  assert.equal(path.dirname(p), path.join(CASA, '.farol'));
  assert.equal(path.basename(p), 'sync-key.json');
  assert.equal(p.includes(`${path.sep}state${path.sep}`), false);
});

test('gravar e ler devolve o mesmo material, com carimbo de gravação', () => {
  assert.equal(cache.gravarCache(valor()), true);
  const lido = cache.lerCache();
  assert.equal(lido.uid, 'u1');
  assert.equal(lido.id, MATERIAL.id);
  assert.deepEqual(lido.enc, MATERIAL.enc);
  assert.ok(lido.savedAt > 0);
});

test('arquivo ausente, vazio ou corrompido devolve null, sem lançar', () => {
  assert.equal(cache.lerCache(), null);
  fs.mkdirSync(path.dirname(cache.caminhoDoCache()), { recursive: true });
  fs.writeFileSync(cache.caminhoDoCache(), 'nao e json');
  assert.equal(cache.lerCache(), null);
  fs.writeFileSync(cache.caminhoDoCache(), '{"uid":"u1"}');
  assert.equal(cache.lerCache(), null, 'sem material não serve de cache');
});

test('cacheServe: uid ou destino diferentes descartam o cache', () => {
  const c = valor();
  assert.equal(cache.cacheServe(c, { uid: 'u1', destino: DESTINO }), true);
  assert.equal(cache.cacheServe(c, { uid: 'u2', destino: DESTINO }), false);
  assert.equal(cache.cacheServe(c, { uid: 'u1', destino: 'outro' }), false);
  assert.equal(cache.cacheServe(null, { uid: 'u1', destino: DESTINO }), false);
});

test('cacheConfere: kcv divergente reprova, e chave a mais no banco também', () => {
  const chaveiro = { cur: 'g1', kcv: { g1: kek.kcvDe(MATERIAL.enc.g1) } };
  assert.equal(cache.cacheConfere(valor(), chaveiro), true);
  assert.equal(cache.cacheConfere(valor(), { cur: 'g1', kcv: { g1: 'f'.repeat(16) } }), false);
  assert.equal(cache.cacheConfere(valor(), { cur: 'g2', kcv: { g1: kek.kcvDe(MATERIAL.enc.g1), g2: 'a'.repeat(16) } }), false, 'geração corrente ausente no cache');
  assert.equal(cache.cacheConfere(valor(), null), false);
});

test('apagarCache remove o arquivo e é idempotente', () => {
  cache.gravarCache(valor());
  assert.equal(cache.apagarCache(), true);
  assert.equal(fs.existsSync(cache.caminhoDoCache()), false);
  assert.equal(cache.apagarCache(), false);
});

test('modo 0600 depois de CADA gravação (posix)', { skip: IS_WIN ? 'chmod não vale em NTFS' : false }, () => {
  cache.gravarCache(valor());
  assert.equal(fs.statSync(cache.caminhoDoCache()).mode & 0o777, 0o600);
  cache.gravarCache(valor({ keyringRev: 2 }));
  assert.equal(fs.statSync(cache.caminhoDoCache()).mode & 0o777, 0o600, 'a regravação não devolve o arquivo para 0644');
});

test('a senha nunca entra no cache', () => {
  cache.gravarCache({ ...valor(), senha: 'segredo-que-nao-pode-ficar' });
  assert.equal(fs.readFileSync(cache.caminhoDoCache(), 'utf8').includes('segredo-que-nao-pode-ficar'), false);
});
```

- [ ] **Passo 2:** rodar `node --test test/sync-cache-chave.test.js`. Esperado: `Cannot find module` apontando `lib/sync/cache-chave.js`.

- [ ] **Passo 3:** criar `lib/sync/cache-chave.js`.

```js
// Cache local do material de chave (CT-ENV). Mora em ~/.farol, pelo mesmo motivo do
// lib/sync/credentials.js: o config.json inteiro trafega para a UI, e state/ é o cwd das
// sessões do Claude. Aqui ficam K_id e K_enc em claro, então o arquivo é o ativo mais
// sensível do aparelho e leva 0600 em TODA gravação.
//
// O boot só LÊ este arquivo: sem scrypt, sem rede e sem pedir senha. É o que faz o Farol
// abrir funcionando depois de reiniciar.
//
// Desligar a sincronização NÃO apaga o cache, e credencial do Firebase inválida também
// não: a spec é explícita, porque é justamente o cache que permite recuperar as chaves
// depois de uma redefinição de senha por e-mail. Só "Sair deste aparelho" apaga.
import fs from 'node:fs';
import path from 'node:path';
import { HOME } from '../paths.js';
import { SYNC } from '../constants.js';
import io from '../io.js';
import kek from './kek.js';

const ARQUIVO = path.join(HOME, SYNC.KEY_CACHE_FILE);
const VERSAO = 1;

function caminhoDoCache() { return ARQUIVO; }

function texto(v) { return typeof v === 'string' ? v.trim() : ''; }

function objeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

// chmod não existe em NTFS: no Windows a proteção real é a ACL do perfil do usuário.
function restringir(arquivo) {
  try { fs.chmodSync(arquivo, 0o600); } catch { /* sem suporte a modo neste sistema de arquivos */ }
}

function lerCache() {
  const d = io.readJson(ARQUIVO, null);
  if (!objeto(d) || d.v !== VERSAO) return null;
  const uid = texto(d.uid);
  const id = texto(d.id);
  if (!uid || !id || !objeto(d.enc) || !Object.keys(d.enc).length) return null;
  return { uid, destino: texto(d.destino), keyringRev: Number(d.keyringRev) || 0, cur: texto(d.cur), id, enc: { ...d.enc }, savedAt: Number(d.savedAt) || 0 };
}

// A allowlist de campos é o que impede a senha (ou qualquer outra coisa que o chamador
// tenha em mãos) de cair no arquivo por descuido.
function gravarCache(valor) {
  const v = valor || {};
  const uid = texto(v.uid);
  const id = texto(v.id);
  if (!uid || !id || !objeto(v.enc)) return false;
  try {
    io.ensureDir(path.dirname(ARQUIVO));
    io.writeJsonAtomic(ARQUIVO, {
      v: VERSAO, uid, destino: texto(v.destino), keyringRev: Number(v.keyringRev) || 0,
      cur: texto(v.cur), id, enc: { ...v.enc }, savedAt: Date.now(),
    });
    restringir(ARQUIVO);
    return true;
  } catch {
    // disco cheio ou sem permissão: sem cache o próximo login pede a senha de novo
    return false;
  }
}

function apagarCache() {
  if (!fs.existsSync(ARQUIVO)) return false;
  fs.rmSync(ARQUIVO, { force: true });
  return true;
}

function cacheServe(cache, { uid, destino }) {
  if (!objeto(cache)) return false;
  return cache.uid === texto(uid) && cache.destino === texto(destino);
}

// Prova, sem senha, que o material local é o mesmo que o banco conhece. Precisa cobrir a
// geração CORRENTE: cache de antes de uma rotação abriria o histórico e cifraria o novo
// com uma chave que os outros aparelhos não têm.
function cacheConfere(cache, chaveiro) {
  if (!objeto(cache) || !objeto(chaveiro) || !objeto(chaveiro.kcv)) return false;
  const cur = texto(chaveiro.cur);
  if (!cur || !cache.enc[cur]) return false;
  for (const [g, esperado] of Object.entries(chaveiro.kcv)) {
    const local = cache.enc[g];
    if (!local) continue;
    if (kek.kcvDe(local) !== esperado) return false;
  }
  return true;
}

export default { caminhoDoCache, lerCache, gravarCache, apagarCache, cacheServe, cacheConfere };
export { caminhoDoCache, lerCache, gravarCache, apagarCache, cacheServe, cacheConfere };
```

- [ ] **Passo 4:** rodar `node --test test/sync-cache-chave.test.js`. Esperado: verde, com o caso do modo 0600 pulado no Windows.

- [ ] **Passo 5 (contraprova):** em `gravarCache`, apague a linha `restringir(ARQUIVO);`. Rode no POSIX (WSL): reprova `modo 0600 depois de CADA gravação`. No Windows o caso pula, e a contraprova fica registrada como dependente de POSIX. Restaure. Depois, em `cacheConfere`, troque `if (!cur || !cache.enc[cur]) return false;` por `if (!cur) return false;` e rode: reprova `geração corrente ausente no cache`. Restaure e rode: verde.

- [ ] **Passo 6:** commit.

```bash
git add lib/sync/cache-chave.js test/sync-cache-chave.test.js
git commit -m "feat(sync): cache local da chave em ~/.farol, com modo restrito em toda gravacao"
```

---

## Tarefa 7: envelope cifrado

**Arquivos:**
- editar `lib/constants.js` (`SYNC`: tetos por nó e tamanho do preenchimento);
- criar `lib/sync/envelope.js` e `test/sync-envelope.test.js`.

**Interfaces:**
- `cifrar({ material, cur, uid, caminho, campo, esquema, extras, r, dados })` → `{ ok: true, enc }` ou `{ ok: false, motivo }`.
- `decifrar({ material, uid, caminho, campo, esquema, extras, enc, rMinimo })` → `{ ok: true, valor, r, kid }` ou `{ ok: false, motivo }`.
- `TETOS` (mapa nó → caracteres) e `cabeNoTeto(enc, no)`.
- `aadDe({ uid, caminho, campo, kid, esquema, extras })`, PURA, exportada para os testes de fronteira.
- Leitura **falha fechada**: `motivo` em `'prefixo' | 'kid' | 'iv' | 'tag' | 'gcm' | 'json' | 'esquema' | 'revisao'`. Nunca devolve texto parcial.

- [ ] **Passo 1:** escrever o teste que falha.

```js
// Envelope cifrado (CT-ENV): 'e1.<kid>.<iv>.<ct>.<tag>', AAD amarrando uid, caminho, campo,
// geração e esquema, preenchimento até múltiplo de 256 e leitura que falha fechada.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c1-envelope-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const env = await import('../lib/sync/envelope.js');
const kek = await import('../lib/sync/kek.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });

const MATERIAL = kek.novoMaterial();
const UID = 'u1';
const BASE = { material: MATERIAL, cur: 'g1', uid: UID, caminho: 'catalog/aaa', campo: 'enc', esquema: 'pr1', r: 1 };
const DADOS = { key: 'org/repo#7', title: 'Corrige o redirect', author: 'dev' };

function cifrado(extra = {}) {
  const r = env.cifrar({ ...BASE, dados: DADOS, ...extra });
  assert.equal(r.ok, true, r.motivo);
  return r.enc;
}

test('formato: e1.<kid>.<iv>.<ct>.<tag> em base64url sem preenchimento', () => {
  const enc = cifrado();
  assert.match(enc, /^e1\.g[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const [, kid, iv, , tag] = enc.split('.');
  assert.equal(kid, 'g1');
  assert.equal(Buffer.from(iv, 'base64url').length, 12);
  assert.equal(Buffer.from(tag, 'base64url').length, 16);
});

test('ida e volta: o valor volta igual, com r e kid', () => {
  const lido = env.decifrar({ ...BASE, enc: cifrado() });
  assert.equal(lido.ok, true);
  assert.deepEqual(lido.valor, DADOS);
  assert.equal(lido.r, 1);
  assert.equal(lido.kid, 'g1');
});

test('IV nunca reusado: 1000 envelopes da mesma mensagem têm IVs distintos', () => {
  const vistos = new Set();
  for (let i = 0; i < 1000; i++) vistos.add(cifrado().split('.')[2]);
  assert.equal(vistos.size, 1000);
});

test('trocar um bit do ct ou da tag falha', () => {
  const partes = cifrado().split('.');
  for (const i of [3, 4]) {
    const trocado = [...partes];
    const b = Buffer.from(trocado[i], 'base64url');
    b[0] ^= 1;
    trocado[i] = b.toString('base64url');
    const lido = env.decifrar({ ...BASE, enc: trocado.join('.') });
    assert.equal(lido.ok, false);
    assert.equal(lido.motivo, 'gcm');
  }
});

test('AAD sem o caminho não existe: mover o envelope de catalog/A para catalog/B falha', () => {
  const enc = env.cifrar({ ...BASE, caminho: 'catalog/A', dados: DADOS }).enc;
  const lido = env.decifrar({ ...BASE, caminho: 'catalog/B', enc });
  assert.equal(lido.ok, false);
  assert.equal(lido.motivo, 'gcm');
});

test('AAD amarra uid, campo, esquema e os extras do nó', () => {
  const enc = env.cifrar({ ...BASE, extras: ['x1', 'dA', '7'], dados: DADOS }).enc;
  assert.equal(env.decifrar({ ...BASE, extras: ['x1', 'dA', '7'], enc }).ok, true);
  assert.equal(env.decifrar({ ...BASE, extras: ['x2', 'dA', '7'], enc }).motivo, 'gcm', 'x novo invalida o envelope antigo');
  assert.equal(env.decifrar({ ...BASE, uid: 'outro', extras: ['x1', 'dA', '7'], enc }).motivo, 'gcm');
  assert.equal(env.decifrar({ ...BASE, campo: 'outro', extras: ['x1', 'dA', '7'], enc }).motivo, 'gcm');
});

test('esquema diferente do esperado descarta o item, mesmo com a cifra íntegra', () => {
  const lido = env.decifrar({ ...BASE, esquema: 'op1', enc: cifrado() });
  assert.equal(lido.ok, false);
  assert.equal(lido.motivo, 'gcm', 'o esquema está na AAD, então nem chega a abrir');
});

test('revisão regressiva é descartada (CT-FIO): item antigo não sobrescreve o novo', () => {
  const enc = env.cifrar({ ...BASE, r: 5, dados: DADOS }).enc;
  assert.equal(env.decifrar({ ...BASE, r: 5, enc, rMinimo: 5 }).ok, true);
  const lido = env.decifrar({ ...BASE, r: 5, enc, rMinimo: 6 });
  assert.equal(lido.ok, false);
  assert.equal(lido.motivo, 'revisao');
});

test('leitura falha fechada em cada pedaço malformado, sem texto parcial', () => {
  const casos = [
    ['', 'prefixo'], ['x1.g1.a.b.c', 'prefixo'], ['e1.g9.a.b.c', 'kid'],
    [`e1.g1.${Buffer.alloc(8).toString('base64url')}.YQ.${Buffer.alloc(16).toString('base64url')}`, 'iv'],
    [`e1.g1.${Buffer.alloc(12).toString('base64url')}.YQ.${Buffer.alloc(4).toString('base64url')}`, 'tag'],
  ];
  for (const [enc, motivo] of casos) {
    const lido = env.decifrar({ ...BASE, enc });
    assert.equal(lido.ok, false, enc);
    assert.equal(lido.motivo, motivo, enc);
    assert.equal(lido.valor, undefined, 'nunca devolve valor parcial');
  }
});

test('preenchimento: o texto claro é múltiplo de 256 bytes, e o tamanho não segue o conteúdo', () => {
  const curto = cifrado({ dados: { key: 'a' } });
  const medio = cifrado({ dados: { key: 'a'.repeat(50) } });
  assert.equal(env.tamanhoDoClaro({ ...BASE, dados: { key: 'a' } }) % 256, 0);
  assert.equal(env.tamanhoDoClaro({ ...BASE, dados: { key: 'a'.repeat(50) } }) % 256, 0);
  assert.equal(curto.length, medio.length, 'mensagens pequenas diferentes caem no mesmo degrau');
});

test('tetos por nó: o que não cabe é recusado antes de subir', () => {
  assert.equal(env.TETOS.recentReviews, 1024);
  assert.equal(env.TETOS.reviewBodies, 48000);
  const grande = env.cifrar({ ...BASE, caminho: 'recentReviews/x', no: 'recentReviews', dados: { texto: 'x'.repeat(4000) } });
  assert.equal(grande.ok, false);
  assert.equal(grande.motivo, 'teto');
});

test('nenhum módulo de lib/sync importa node:zlib (sem compressão, decisão 9)', () => {
  const dir = path.join(import.meta.dirname, '..', 'lib', 'sync');
  for (const nome of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const fonte = fs.readFileSync(path.join(dir, nome), 'utf8');
    assert.equal(/require\(['"]node:zlib|from ['"]node:zlib/.test(fonte), false, nome);
  }
});
```

- [ ] **Passo 2:** rodar `node --test test/sync-envelope.test.js`. Esperado: `Cannot find module` apontando `lib/sync/envelope.js`.

- [ ] **Passo 3:** em `lib/constants.js`, dentro de `SYNC`, depois de `KEY_CACHE_FILE`, acrescente:

```js
  // Envelope cifrado (CT-ENV). O texto claro é completado até múltiplo disto, sem
  // compressão: o tamanho comprimido de um relatório que mistura texto de terceiros
  // vazaria conteúdo, e o preenchimento tira o tamanho exato da mensagem de cena.
  ENVELOPE_BLOCO_BYTES: 256,
```

- [ ] **Passo 4:** criar `lib/sync/envelope.js`.

```js
// Envelope cifrado do conteúdo que sobe para o banco (CT-ENV). Folha: sem estado, sem IO,
// sem rede, só node:crypto.
//
// Formato: 'e1.<kid>.<iv>.<ct>.<tag>', tudo em base64url sem preenchimento. A AAD amarra
// uid, caminho lógico, campo, geração e esquema, mais os extras que o contrato do nó
// exigir. Mover um envelope para outro nó, outro campo ou outra conta falha no GCM em vez
// de decifrar em silêncio no lugar errado.
//
// O texto claro é completado com espaços até múltiplo de ENVELOPE_BLOCO_BYTES e NÃO é
// comprimido: comprimir antes de cifrar faz o tamanho do ciphertext seguir o conteúdo, e
// o conteúdo aqui é relatório de revisão com texto de terceiros.
//
// A leitura falha FECHADA: qualquer pedaço malformado descarta o item inteiro, que vira
// "não verificável" para quem chamou. Nunca existe texto parcial.
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { SYNC } from '../constants.js';
import io from '../io.js';
import kek from './kek.js';

const PREFIXO = 'e1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KID_RE = /^g[0-9]+$/;
const ESPACO = ' ';

// Tetos em caracteres da string final, por nó (anexo C1, "Envelope cifrado").
const TETOS = {
  'live/operations': 2048, 'live/pending': 4096, 'live/deviceStatus': 2048,
  'live/devicePolicies': 2048, 'live/profiles': 1024, catalog: 2048,
  recentReviews: 1024, reviewBodies: 48000, panorama: 2048, myPrs: 8192,
  selfAnalyses: 48000, usageEvents: 1024,
};

function falha(motivo) { return { ok: false, motivo }; }

function b64(buf) { return Buffer.from(buf).toString('base64url'); }
function debase64(t) { return Buffer.from(String(t || ''), 'base64url'); }

function aadDe({ uid, caminho, campo, kid, esquema, extras }) {
  const base = ['farol', PREFIXO, String(uid || ''), String(caminho || ''), String(campo || ''), String(kid || ''), String(esquema || '')];
  const extra = Array.isArray(extras) ? extras.map((x) => String(x === null || x === undefined ? '' : x)) : [];
  return [...base, ...extra].join('|');
}

// O claro guarda o esquema e a revisão junto dos campos: quem lê confere os dois antes de
// aceitar o item, e a revisão é o que impede um item antigo de sobrescrever um novo.
function claroDe({ esquema, r, dados }) {
  const texto = io.safeStringify({ s: String(esquema || ''), v: 1, r: Number(r) || 0, ...(dados || {}) }, '{}');
  const bloco = SYNC.ENVELOPE_BLOCO_BYTES;
  const falta = (bloco - (Buffer.byteLength(texto, 'utf8') % bloco)) % bloco;
  return texto + ESPACO.repeat(falta);
}

function tamanhoDoClaro(ctx) {
  return Buffer.byteLength(claroDe(ctx), 'utf8');
}

function cabeNoTeto(enc, no) {
  const teto = TETOS[no];
  if (!teto) return true;
  return String(enc || '').length <= teto;
}

function cifrar(ctx) {
  const kid = String(ctx.cur || '');
  const chave = kek.bufferDe((ctx.material && ctx.material.enc ? ctx.material.enc[kid] : ''));
  if (!KID_RE.test(kid) || !chave) return falha('kid');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', chave, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aadDe({ ...ctx, kid }), 'utf8'));
  const ct = Buffer.concat([cipher.update(claroDe(ctx), 'utf8'), cipher.final()]);
  const enc = [PREFIXO, kid, b64(iv), b64(ct), b64(cipher.getAuthTag())].join('.');
  if (!cabeNoTeto(enc, ctx.no)) return falha('teto');
  return { ok: true, enc };
}

function pedacos(enc) {
  const partes = String(enc || '').split('.');
  if (partes.length !== 5 || partes[0] !== PREFIXO) return null;
  return { kid: partes[1], iv: debase64(partes[2]), ct: debase64(partes[3]), tag: debase64(partes[4]) };
}

function decifrar(ctx) {
  const p = pedacos(ctx.enc);
  if (!p) return falha('prefixo');
  const chave = kek.bufferDe((ctx.material && ctx.material.enc ? ctx.material.enc[p.kid] : ''));
  if (!KID_RE.test(p.kid) || !chave) return falha('kid');
  if (p.iv.length !== IV_BYTES) return falha('iv');
  if (p.tag.length !== TAG_BYTES) return falha('tag');
  const claro = abrir(p, chave, ctx);
  if (claro === null) return falha('gcm');
  const valor = io.parseJson(claro.trim(), null);
  if (!valor || typeof valor !== 'object') return falha('json');
  if (String(valor.s || '') !== String(ctx.esquema || '')) return falha('esquema');
  const r = Number(valor.r) || 0;
  if (Number.isFinite(Number(ctx.rMinimo)) && r < Number(ctx.rMinimo)) return falha('revisao');
  const { s, v, r: _r, ...campos } = valor;
  return { ok: true, valor: campos, r, kid: p.kid };
}

function abrir(p, chave, ctx) {
  try {
    const decipher = createDecipheriv('aes-256-gcm', chave, p.iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aadDe({ ...ctx, kid: p.kid }), 'utf8'));
    decipher.setAuthTag(p.tag);
    return Buffer.concat([decipher.update(p.ct), decipher.final()]).toString('utf8');
  } catch {
    // tag inválida, AAD diferente ou ciphertext adulterado: o item inteiro é descartado
    return null;
  }
}

export default { cifrar, decifrar, aadDe, cabeNoTeto, tamanhoDoClaro, TETOS };
export { cifrar, decifrar, aadDe, cabeNoTeto, tamanhoDoClaro, TETOS };
```

- [ ] **Passo 5:** rodar `node --test test/sync-envelope.test.js`. Esperado: 12 testes verdes. Rodar `npm run lint`: o `decifrar` acima tem profundidade 1 e nenhum ternário aninhado; se o gate reclamar de tamanho, extraia `pedacos`/`abrir` para o topo do arquivo (já estão), nunca suba a baseline.

- [ ] **Passo 6 (contraprova):** três mutações, uma de cada vez:
  (a) em `aadDe`, apague `String(caminho || ''),` da lista: reprova `AAD sem o caminho não existe`.
  (b) em `cifrar` e `decifrar`, remova `{ authTagLength: TAG_BYTES }` das duas chamadas: reprova `leitura falha fechada` no caso da tag de 4 bytes (a tag curta passa a ser aceita).
  (c) em `claroDe`, troque `const falta = ...` por `const falta = 0;`: reprova `preenchimento`.
  Restaure depois de cada uma e rode de novo: verde.

- [ ] **Passo 7:** commit.

```bash
git add lib/constants.js lib/sync/envelope.js test/sync-envelope.test.js
git commit -m "feat(sync): envelope cifrado com AAD amarrada, preenchimento e leitura que falha fechada"
```

---

## Tarefa 8: desbloqueio do aparelho logado antes da feature

**Arquivos:**
- editar `lib/engine/sync.js` (estado da chave no runtime e em `statusForUi`; `syncUnlock`);
- editar `lib/http-server.js` (rota `POST /api/sync/unlock`);
- editar `server.js` (fachada `syncUnlock`);
- criar `test/sync-desbloqueio.test.js`.

**Interfaces:**
- `async syncUnlock(engine, { password })` → `{ ok: true }` ou `{ ok: false, code, motivo }`. Faz `signInWithPassword` com o e-mail já guardado, grava o refresh token novo, abre ou cria o chaveiro e grava o cache.
- `statusForUi(engine).chave` → `'pronta' | 'bloqueada' | 'perdida' | 'desligada'`.
- Com o compartilhamento **desligado**, `chave` é `'desligada'` e a rota responde `{ ok: false, code: 'compartilhamento-desligado' }` sem tocar rede.
- A senha **nunca** é gravada, logada nem devolvida.

- [ ] **Passo 1:** escrever o teste que falha.

```js
// Desbloqueio (CT-ENV): aparelho que já estava logado antes da feature tem refresh token e
// não tem senha. Com o compartilhamento ligado ele fica 'bloqueado neste aparelho' e opera
// no modo legado até a pessoa digitar a senha uma vez.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c1-unlock-'));
const CASA = path.join(BASE, 'casa');
fs.mkdirSync(CASA, { recursive: true });
process.env.FAROL_HOME = path.join(BASE, 'farol');
process.env.HOME = CASA;
process.env.USERPROFILE = CASA;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';

const { Engine } = await import('../server.js');
const syncMod = (await import('../lib/engine/sync.js')).default;
const cache = await import('../lib/sync/cache-chave.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
let fake;
let identity;

before(async () => {
  identity = await startFakeIdentity({ apiKey: API_KEY, users: { [EMAIL]: { password: SENHA, uid: 'u1' } } });
  fake = await startFakeRtdb({ token: (t) => identity.tokens.idTokens.includes(t) });
});
after(async () => {
  await fake.close();
  await identity.close();
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; cache.apagarCache(); });

function syncCfg(extra = {}) {
  return {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false }, shared: { enabled: true },
    deviceName: 'Notebook', apiKey: API_KEY, databaseUrl: fake.url, projectId: 'farol-local', ...extra,
  };
}

async function motor(cfg = syncCfg()) {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  await e.saveConfig({ ...e.config, sync: cfg });
  return e;
}

test('compartilhamento desligado: a chave aparece como desligada e a rota não toca rede', async () => {
  const e = await motor(syncCfg({ shared: { enabled: false } }));
  assert.equal(syncMod.statusForUi(e).chave, 'desligada');
  fake.requests.length = 0;
  const r = await e.syncUnlock({ password: SENHA });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'compartilhamento-desligado');
  assert.deepEqual(fake.requests, []);
});

test('logado sem chave: fica bloqueado, e o desbloqueio com a senha certa cria o chaveiro', async () => {
  const e = await motor();
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  cache.apagarCache();
  e.sync.material = null;
  assert.equal(syncMod.statusForUi(e).chave, 'bloqueada');
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  assert.equal(syncMod.statusForUi(e).chave, 'pronta');
  assert.ok(fake.tree().users.u1.keyring, 'o chaveiro foi criado');
  assert.ok(cache.lerCache(), 'o cache local foi gravado');
});

test('senha errada não grava nada: sem chaveiro, sem cache e sem estado pronto', async () => {
  const e = await motor();
  const r = await e.syncUnlock({ password: 'errada' });
  assert.equal(r.ok, false);
  assert.equal(fake.tree(), null, 'nenhum PUT chegou ao banco');
  assert.equal(cache.lerCache(), null);
  assert.notEqual(syncMod.statusForUi(e).chave, 'pronta');
});

test('a senha não sobrevive em lugar nenhum: nem no config, nem no snapshot, nem no cache', async () => {
  const e = await motor();
  await e.syncUnlock({ password: SENHA });
  const varrer = (v) => JSON.stringify(v || {}).includes(SENHA);
  assert.equal(varrer(e.config), false);
  assert.equal(varrer(syncMod.statusForUi(e)), false);
  assert.equal(fs.readFileSync(cache.caminhoDoCache(), 'utf8').includes(SENHA), false);
});

test('chaveiro apagado depois de visto: estado perdida, e o desbloqueio não recria', async () => {
  const e = await motor();
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  fake.setTree(null);
  cache.apagarCache();
  e.sync.material = null;
  const r = await e.syncUnlock({ password: SENHA });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'chave-perdida');
  assert.equal(syncMod.statusForUi(e).chave, 'perdida');
  assert.equal(fake.tree(), null, 'nada foi recriado');
});
```

- [ ] **Passo 2:** rodar `node --test test/sync-desbloqueio.test.js`. Esperado: reprova (`syncUnlock` não é função, `chave` indefinida).

- [ ] **Passo 3:** implementar em `lib/engine/sync.js`.

No topo, junto dos outros imports de `../sync/`:

```js
import { sharedActive } from '../sync/config.js';
import chaveiro from '../sync/chaveiro.js';
import cacheChave from '../sync/cache-chave.js';
```

E acrescente `outboxTarget` ao import que **já existe** de `../sync/outbox.js` (hoje `import { resetForFullSync, saveOutbox } from '../sync/outbox.js';`): o destino gravado no cache é o mesmo identificador de destino da fila, e duplicar a montagem dele aqui criaria duas definições do mesmo conceito.

Em `novoRuntime`, acrescente ao objeto `material: null, chaveVista: false, chaveMotivo: ''`.

Acrescente, antes de `statusForUi`:

```js
// Estado da chave deste aparelho, para a tela e para quem decide se pode cifrar.
// 'desligada' não é problema: é o recurso não estar ligado.
function estadoDaChave(engine, rt, cfg) {
  if (!sharedActive(cfg)) return 'desligada';
  if (rt.chaveMotivo === 'chave-perdida') return 'perdida';
  return rt.material ? 'pronta' : 'bloqueada';
}

// Desbloqueio do aparelho que já estava logado antes da feature: ele tem refresh token e
// não tem senha, então o chaveiro só abre quando a pessoa digita a senha uma vez. A senha
// é usada aqui e descartada; nada dela vai para config, log, snapshot ou cache.
async function syncUnlock(engine, { password } = {}) {
  const cfg = cfgDe(engine);
  if (!sharedActive(cfg)) return { ok: false, code: 'compartilhamento-desligado', motivo: 'o compartilhamento cifrado está desligado' };
  const rt = engine.sync;
  const cred = readSyncCredential();
  const email = (cred && cred.email) || rt.email;
  if (!email) return { ok: false, code: SYNC_CODES.SEM_CREDENCIAL, motivo: 'este aparelho não tem login guardado' };
  const entrada = await signInWithPassword(cfg, { email, password });
  if (!entrada.ok) return { ok: false, code: entrada.code, motivo: entrada.motivo };
  setSyncCredential({ uid: entrada.uid, email, refreshToken: entrada.refreshToken });
  return abrirChaveDoConjunto(engine, rt, cfg, password);
}

async function abrirChaveDoConjunto(engine, rt, cfg, password) {
  const r = await chaveiro.garantirChaveiro(rt.client, rt.uid, password, { deviceId: rt.deviceId, jaVisto: rt.chaveVista });
  if (!r.ok) {
    rt.chaveMotivo = r.motivo;
    avisarTela(engine);
    return { ok: false, code: r.motivo, motivo: motivoDaChave(r.motivo) };
  }
  rt.material = r.material;
  rt.chaveVista = true;
  rt.chaveMotivo = '';
  cacheChave.gravarCache({
    uid: rt.uid, destino: outboxTarget(rt.uid, cfgDe(engine).databaseUrl),
    keyringRev: Number(r.chaveiro.rev) || 0, cur: r.chaveiro.cur, id: r.material.id, enc: r.material.enc,
  });
  avisarTela(engine);
  return { ok: true };
}

function motivoDaChave(codigo) {
  if (codigo === 'chave-perdida') return 'a chave do conjunto sumiu do banco depois de já ter sido vista neste aparelho';
  if (codigo === 'senha-nao-abre') return 'a senha não abre a chave do conjunto deste banco';
  return 'não deu para falar com o banco agora';
}
```

No objeto devolvido por `statusForUi`, troque

```js
    shared: sharedActive(cfg),
```

por

```js
    shared: sharedActive(cfg), chave: estadoDaChave(engine, rt, cfg),
```

e acrescente `syncUnlock` aos dois exports do módulo.

- [ ] **Passo 4:** implementar a rota em `lib/http-server.js`, junto das outras rotas de `/api/sync/`:

```js
        if (p === '/api/sync/unlock') return send(200, syncResult(await engine.syncUnlock(body)));
```

- [ ] **Passo 5:** implementar a fachada em `server.js`, junto das outras de sync:

```js
  syncUnlock(dados) { return syncMod.syncUnlock(this, dados); }
```

- [ ] **Passo 6:** rodar `node --test test/sync-desbloqueio.test.js test/sync-engine.test.js test/http.test.js test/facades.test.js test/sync-compartilhamento-desligado.test.js`. Esperado: verde.

- [ ] **Passo 7 (contraprova):** em `syncUnlock`, troque `jaVisto: rt.chaveVista` por `jaVisto: false`. Rode `node --test test/sync-desbloqueio.test.js`: reprova `chaveiro apagado depois de visto` (o chaveiro é recriado). Restaure. Depois troque a ordem, chamando `abrirChaveDoConjunto` ANTES de `signInWithPassword`, e rode: reprova `senha errada não grava nada`. Restaure e rode: verde.

- [ ] **Passo 8:** commit.

```bash
git add lib/engine/sync.js lib/http-server.js server.js test/sync-desbloqueio.test.js
git commit -m "feat(sync): desbloqueio do aparelho logado antes da feature, com estado da chave"
```

---

## Tarefa 9: ciclo de recuperação de senha e chaves

**Arquivos:**
- editar `lib/engine/sync.js` (`syncUnlock` ganha o reembrulho; `syncGerarChaveNova`; o cache sobrevive a credencial inválida);
- editar `server.js` e `lib/http-server.js` (rota e fachada de `POST /api/sync/new-epoch`);
- criar `test/sync-recuperacao-chave.test.js`.

**Interfaces:**
- No desbloqueio, quando o chaveiro do banco **não abre** com a senha dada e este aparelho tem **cache válido** (`cacheServe` e `cacheConfere` no `rev` do banco), o Farol **reembrulha** com a senha nova, `rev + 1` e sal novo, em vez de recusar.
- `async syncGerarChaveNova(engine, { password })` → época nova (`K_id` e `K_enc` novas, `epochSince` de agora), com o conteúdo antigo **preservado**. Só roda quando o estado da chave é `'perdida'`.
- **O cache nunca é apagado por credencial inválida.** Só `syncLogout` apaga.

As três situações de CT-ENV, nomeadas como a spec as nomeia:

| Situação | O que o teste prova |
|---|---|
| Troca de senha sabendo a atual | com cache no mesmo `rev`, o primeiro aparelho reembrulha (PUT com `rev + 1` e sal novo) |
| Senha esquecida, com aparelho desbloqueado | credencial do Firebase inválida não apaga o cache; ao entrar com a senha nova, reembrulha |
| Senha esquecida, sem chave recuperável | estado `'perdida'`, conteúdo antigo retido, e "Gerar chave nova" cria época nova sem apagar a antiga |

- [ ] **Passo 1:** escrever o teste que falha.

```js
// As três situações de recuperação de CT-ENV. Recuperar a CONTA do Firebase e recuperar as
// CHAVES de dados são coisas diferentes: a redefinição por e-mail devolve a conta e não
// abre o chaveiro, que continua embrulhado pela senha antiga.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c1-recuperacao-'));
const CASA = path.join(BASE, 'casa');
fs.mkdirSync(CASA, { recursive: true });
process.env.FAROL_HOME = path.join(BASE, 'farol');
process.env.HOME = CASA;
process.env.USERPROFILE = CASA;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';

const { Engine } = await import('../server.js');
const syncMod = (await import('../lib/engine/sync.js')).default;
const cache = await import('../lib/sync/cache-chave.js');
const chaveiro = await import('../lib/sync/chaveiro.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-velha';
const SENHA_NOVA = 'senha-nova';
let fake;
let identity;

before(async () => {
  identity = await startFakeIdentity({ apiKey: API_KEY, users: { [EMAIL]: { password: SENHA, uid: 'u1' } } });
  fake = await startFakeRtdb({ token: (t) => identity.tokens.idTokens.includes(t) });
});
after(async () => {
  await fake.close();
  await identity.close();
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; cache.apagarCache(); identity.setPassword(EMAIL, SENHA); });

function syncCfg() {
  return {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false }, shared: { enabled: true },
    deviceName: 'Notebook', apiKey: API_KEY, databaseUrl: fake.url, projectId: 'farol-local',
  };
}

async function motor() {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  await e.saveConfig({ ...e.config, sync: syncCfg() });
  return e;
}

function noBanco() {
  const t = fake.tree();
  return t && t.users && t.users.u1 ? t.users.u1.keyring : null;
}

test('troca de senha com cache no mesmo rev: o aparelho reembrulha, sem pedir a senha antiga', async () => {
  const e = await motor();
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  const idAntes = noBanco().kcv.g1;
  const salAntes = noBanco().slots.pw.kdf.salt;
  identity.setPassword(EMAIL, SENHA_NOVA);
  const r = await e.syncUnlock({ password: SENHA_NOVA });
  assert.equal(r.ok, true);
  assert.equal(noBanco().rev, 2, 'reembrulhou');
  assert.notEqual(noBanco().slots.pw.kdf.salt, salAntes, 'sal novo');
  assert.equal(noBanco().kcv.g1, idAntes, 'a MESMA chave continua valendo: o histórico não vira ilegível');
  assert.equal(syncMod.statusForUi(e).chave, 'pronta');
});

test('troca de senha sem cache nenhum: o chaveiro não abre e nada é gravado', async () => {
  const e = await motor();
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  const revAntes = noBanco().rev;
  cache.apagarCache();
  e.sync.material = null;
  identity.setPassword(EMAIL, SENHA_NOVA);
  const r = await e.syncUnlock({ password: SENHA_NOVA });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'senha-nao-abre');
  assert.equal(noBanco().rev, revAntes, 'nada foi regravado com a senha que não abre');
});

test('credencial do Firebase inválida NÃO apaga o cache: é ele que salva a recuperação', async () => {
  const e = await motor();
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  assert.ok(cache.lerCache());
  e.sync.lastError = { code: 'credencial_invalida' };
  e.sync.status = 'erro';
  syncMod.stopSync(e);
  assert.ok(cache.lerCache(), 'desligar e cair em credencial inválida não apagam a chave local');
});

test('sair deste aparelho apaga o cache, e só ele', async () => {
  const e = await motor();
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  e.syncLogout();
  assert.equal(cache.lerCache(), null);
});

test('sem chave recuperável: estado perdida, conteúdo antigo retido, época nova preserva a antiga', async () => {
  const e = await motor();
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  const antigo = await chaveiro.lerChaveiro(e.sync.client, 'u1');
  const kcvAntigo = antigo.chaveiro.kcv.g1;
  fake.setTree(null);
  cache.apagarCache();
  e.sync.material = null;
  assert.equal((await e.syncUnlock({ password: SENHA })).code, 'chave-perdida');
  assert.equal(syncMod.statusForUi(e).chave, 'perdida');

  const nova = await e.syncGerarChaveNova({ password: SENHA });
  assert.equal(nova.ok, true);
  assert.equal(syncMod.statusForUi(e).chave, 'pronta');
  assert.notEqual(noBanco().kcv.g1, kcvAntigo, 'a época nova tem chave nova');
  assert.ok(noBanco().epochSince > 0);
});

test('gerar chave nova exige o estado perdida: com a chave pronta, recusa', async () => {
  const e = await motor();
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  const r = await e.syncGerarChaveNova({ password: SENHA });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'chave-disponivel');
  assert.equal(noBanco().rev, 1, 'nada foi regravado');
});
```

**O `test/helpers/fake-identity.js` não tem `setPassword` hoje** (medido: o mapa `users` é lido direto em `signIn`). Acrescente o método ao objeto devolvido pelo helper, ao lado de `revogar`:

```js
    // troca a senha aceita para um e-mail, como o Firebase faz: a antiga passa a devolver
    // INVALID_PASSWORD. É o que permite exercitar as três situações de recuperação de CT-ENV.
    setPassword(email, senha) { users[email] = { ...(users[email] || {}), password: senha }; },
```

Este é o **único** arquivo de `test/` já existente que a entrega toca, e ele é helper, não teste de comportamento: a Tarefa 14 declara essa exceção na conferência do diff.

- [ ] **Passo 2:** rodar `node --test test/sync-recuperacao-chave.test.js`. Esperado: reprova (`syncGerarChaveNova` não é função; o reembrulho não acontece).

- [ ] **Passo 3:** implementar em `lib/engine/sync.js`. Em `abrirChaveDoConjunto`, antes de devolver a falha `senha-nao-abre`, tente o reembrulho:

```js
async function abrirChaveDoConjunto(engine, rt, cfg, password) {
  const r = await chaveiro.garantirChaveiro(rt.client, rt.uid, password, { deviceId: rt.deviceId, jaVisto: rt.chaveVista });
  if (!r.ok && r.motivo === 'senha-nao-abre') return reembrulharComCache(engine, rt, cfg, password);
  if (!r.ok) {
    rt.chaveMotivo = r.motivo;
    avisarTela(engine);
    return { ok: false, code: r.motivo, motivo: motivoDaChave(r.motivo) };
  }
  return guardarMaterial(engine, rt, cfg, r);
}

// Troca de senha (CT-ENV, primeira situação): o chaveiro segue embrulhado pela senha
// antiga, e quem tem cache válido reembrulha com a senha nova. A chave NÃO muda, então o
// histórico continua legível; o que muda é só o embrulho.
async function reembrulharComCache(engine, rt, cfg, password) {
  const local = cacheChave.lerCache();
  const destino = outboxTarget(rt.uid, cfg.databaseUrl);
  const lido = await chaveiro.lerChaveiro(rt.client, rt.uid);
  if (!lido.ok || !lido.chaveiro) return falhaDaChave(engine, rt, 'chave-perdida');
  if (!cacheChave.cacheServe(local, { uid: rt.uid, destino })) return falhaDaChave(engine, rt, 'senha-nao-abre');
  if (!cacheChave.cacheConfere(local, lido.chaveiro)) return falhaDaChave(engine, rt, 'senha-nao-abre');
  const material = { v: 1, id: local.id, enc: { ...local.enc } };
  const w = await chaveiro.reembrulhar(rt.client, rt.uid, material, password, { chaveiro: lido.chaveiro, etag: lido.etag, deviceId: rt.deviceId });
  if (!w.ok) return falhaDaChave(engine, rt, w.motivo);
  return guardarMaterial(engine, rt, cfg, w);
}

function falhaDaChave(engine, rt, motivo) {
  rt.chaveMotivo = motivo;
  avisarTela(engine);
  return { ok: false, code: motivo, motivo: motivoDaChave(motivo) };
}

function guardarMaterial(engine, rt, cfg, r) {
  rt.material = r.material;
  rt.chaveVista = true;
  rt.chaveMotivo = '';
  cacheChave.gravarCache({
    uid: rt.uid, destino: outboxTarget(rt.uid, cfg.databaseUrl),
    keyringRev: Number(r.chaveiro.rev) || 0, cur: r.chaveiro.cur, id: r.material.id, enc: r.material.enc,
  });
  avisarTela(engine);
  return { ok: true };
}

// Terceira situação: sem nenhuma chave recuperável. O conteúdo cifrado antigo é
// PRESERVADO e fica marcado como cifrado com chave indisponível; o que este ato faz é
// abrir uma época nova para o conteúdo futuro, com o keyring da época antiga intacto.
async function syncGerarChaveNova(engine, { password } = {}) {
  const cfg = cfgDe(engine);
  if (!sharedActive(cfg)) return { ok: false, code: 'compartilhamento-desligado', motivo: 'o compartilhamento cifrado está desligado' };
  const rt = engine.sync;
  if (rt.chaveMotivo !== 'chave-perdida') return { ok: false, code: 'chave-disponivel', motivo: 'a chave do conjunto ainda está disponível neste aparelho' };
  const r = await chaveiro.criarChaveiro(rt.client, rt.uid, password, rt.deviceId);
  if (!r.ok) return falhaDaChave(engine, rt, r.motivo);
  return guardarMaterial(engine, rt, cfg, r);
}
```

Acrescente `syncGerarChaveNova` aos dois exports, a fachada `syncGerarChaveNova(dados) { return syncMod.syncGerarChaveNova(this, dados); }` em `server.js` e a rota `if (p === '/api/sync/new-epoch') return send(200, syncResult(await engine.syncGerarChaveNova(body)));` em `lib/http-server.js`.

Em `syncLogout`, junto da remoção da credencial, acrescente `cacheChave.apagarCache();`. **Não** acrescente nada disso em `stopSync` nem no caminho de credencial inválida.

- [ ] **Passo 4:** rodar `node --test test/sync-recuperacao-chave.test.js test/sync-desbloqueio.test.js test/sync-engine.test.js test/http.test.js test/facades.test.js`. Esperado: verde.

- [ ] **Passo 5 (contraprova):** em `reembrulharComCache`, troque `if (!cacheChave.cacheConfere(local, lido.chaveiro))` por `if (false)`. Rode: reprova `troca de senha sem cache nenhum` (passa a regravar com cache que não confere). Restaure. Depois acrescente `cacheChave.apagarCache();` dentro de `stopSync` e rode: reprova `credencial do Firebase inválida NÃO apaga o cache`. Restaure e rode: verde.

- [ ] **Passo 6:** commit.

```bash
git add lib/engine/sync.js server.js lib/http-server.js test/sync-recuperacao-chave.test.js test/helpers/fake-identity.js
git commit -m "feat(sync): ciclo de recuperacao de senha e chaves, com reembrulho e epoca nova"
```

---

## Tarefa 10: sonda de regras

**Arquivos:** criar `lib/sync/sonda-regras.js` e `test/sync-sonda-regras.test.js`; fiação em `lib/engine/sync.js`.

**Interfaces:**
- `async sondarRegras(client, uid, deviceId)` → `{ ok: true, versao: 2 }` ou `{ ok: false, motivo: 'regra-velha' | 'indisponivel' }`.
- A sonda escreve em `rulesProbe/v2/{deviceId}` e confere que o **DELETE de `/users/{uid}` é recusado**. Com um banco que aceita o DELETE, a resposta é `regra-velha` e **nenhum nó novo é escrito**.
- Roda **depois** de uma presença bem-sucedida, uma vez por conexão.

- [ ] **Passo 1:** escrever o teste que falha.

```js
// Sonda de regras (anexo C1, "Estratégia de regras", princípio 8): antes de escrever
// qualquer nó do contrato v2, o cliente prova que o banco está com as regras v2. Com
// regra velha, o apagão ainda existe, e escrever conteúdo cifrado ali seria confiar numa
// proteção que não está publicada.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c1-sonda-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';

const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const { sondarRegras } = await import('../lib/sync/sonda-regras.js');

const TOKEN = 'tok-ok';
let fake;

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => {
  await fake.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; });

function cliente(recusarDelete) {
  const real = createRtdbClient({ databaseUrl: fake.url, projectId: 'farol-local', getIdToken: async () => ({ ok: true, idToken: TOKEN }) });
  return { ...real, del: async (p, o) => (recusarDelete && p === '/users/u1' ? { ok: false, code: 'permissao', status: 401 } : real.del(p, o)) };
}

test('regras v2: o DELETE da raiz é recusado, e a sonda aprova', async () => {
  const r = await sondarRegras(cliente(true), 'u1', 'dA');
  assert.deepEqual(r, { ok: true, versao: 2 });
});

test('regra velha: o DELETE da raiz passa, a sonda reprova e nada novo é escrito', async () => {
  const r = await sondarRegras(cliente(false), 'u1', 'dA');
  assert.deepEqual(r, { ok: false, motivo: 'regra-velha' });
  const novos = fake.requests.filter((x) => x.method !== 'GET' && /catalog|recentReviews|\/live\//.test(x.path));
  assert.deepEqual(novos.map((x) => x.path), []);
});

test('a sonda nunca apaga dado de verdade: ela escreve e remove só o próprio nó', async () => {
  await sondarRegras(cliente(true), 'u1', 'dA');
  const tocados = fake.requests.filter((x) => x.method !== 'GET').map((x) => x.path);
  for (const p of tocados) assert.match(p, /rulesProbe\/v2\/dA|\/users\/u1$/);
});

test('banco fora do ar: indisponível, sem concluir nada sobre a versão da regra', async () => {
  const quebrado = { get: async () => ({ ok: false }), put: async () => ({ ok: false }), del: async () => ({ ok: false }) };
  assert.deepEqual(await sondarRegras(quebrado, 'u1', 'dA'), { ok: false, motivo: 'indisponivel' });
});
```

- [ ] **Passo 2:** rodar `node --test test/sync-sonda-regras.test.js`. Esperado: `Cannot find module`.

- [ ] **Passo 3:** criar `lib/sync/sonda-regras.js`.

```js
// Sonda da versão das regras publicadas (anexo C1, "Estratégia de regras", princípio 8).
//
// O contrato v2 depende de regras que ainda são publicadas À MÃO, uma vez, pelo dono. Um
// aparelho atualizado falando com um banco de regras velhas escreveria conteúdo cifrado
// achando que a raiz está protegida, quando o apagão da v2.59.x ainda existe ali.
//
// O teste é direto: sob as regras v2 o DELETE de /users/{uid} é NEGADO. Se ele passa, as
// regras são velhas. A sonda escreve e remove só o próprio nó, e nunca apaga nada de
// verdade: o DELETE da raiz é tentado contra um caminho que, se as regras forem velhas,
// já estaria desprotegido de qualquer jeito.
const CAMINHO = 'rulesProbe/v2';

function falha(motivo) { return { ok: false, motivo }; }

async function sondarRegras(client, uid, deviceId) {
  if (!client || !uid || !deviceId) return falha('indisponivel');
  const meu = `/users/${uid}/${CAMINHO}/${deviceId}`;
  try {
    const w = await client.put(meu, { at: Date.now(), v: 2 });
    if (!w.ok) return falha('indisponivel');
    const apagou = await client.del(`/users/${uid}`);
    if (apagou && apagou.ok) return falha('regra-velha');
    await client.del(meu);
    return { ok: true, versao: 2 };
  } catch {
    return falha('indisponivel');
  }
}

export default { sondarRegras };
export { sondarRegras };
```

- [ ] **Passo 4:** fiação em `lib/engine/sync.js`: depois da presença bem-sucedida, uma vez por conexão, chame a sonda e guarde o resultado em `rt.regras` (`'v2' | 'velha' | ''`). Com `regra-velha`, o estado da chave vira `'bloqueada'` e nenhum nó novo é escrito. Acrescente `regras: rt.regras` ao objeto de `statusForUi`.

- [ ] **Passo 5:** rodar `node --test test/sync-sonda-regras.test.js test/sync-engine.test.js test/sync-compartilhamento-desligado.test.js`. Esperado: verde.

- [ ] **Passo 6 (contraprova):** em `sondarRegras`, troque `if (apagou && apagou.ok) return falha('regra-velha');` por nada. Rode: reprova `regra velha`. Restaure e rode: verde.

- [ ] **Passo 7:** commit.

```bash
git add lib/sync/sonda-regras.js lib/engine/sync.js test/sync-sonda-regras.test.js
git commit -m "feat(sync): sonda que prova a versao das regras antes de escrever no contrato v2"
```

---

## Tarefa 11: regras v2 geradas por macro

**Arquivos:**
- criar `firebase/database.rules.template.json` e `tools/sync-rules.js`;
- editar `firebase/database.rules.json` (passa a ser **gerado**);
- criar `test/sync-rules-contrato.test.js` e `test/sync-escritas-v1.test.js`;
- editar `package.json` (script `sync:rules`).

**Interfaces:**
- `node tools/sync-rules.js` lê o template e escreve `firebase/database.rules.json`. Substituição é **textual**, sem `JSON.parse`: o template já é o JSON com marcadores `@MACRO@`, e o gerador só troca texto. Isso mantém o arquivo byte a byte previsível e evita o santuário de JSON do ratchet.
- `node tools/sync-rules.js --check` sai com código 1 quando o arquivo no disco difere do gerado.
- Macros: `@U@`, `@C@`, `@REC@`, `@GEN@`, `@LIMPA@`, `@H(['a','b'])@`, `@ENC(2048)@`.

**Regra de ouro desta tarefa:** as `.validate` de `leases`, `receipts`, `dailyRounds`, `devices` e `usageEvents` continuam **byte a byte** as de hoje. O que muda é a raiz (perde o `.write`) e a chegada das concessões por registro.

- [ ] **Passo 1:** escrever o teste que falha.

```js
// As regras publicadas são GERADAS: o JSON no disco precisa ser byte a byte o que o
// gerador produz a partir do template, e as validações legadas precisam continuar
// idênticas às de hoje (anexo C1, "Estratégia de regras", regra de ouro dos nós legados).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const RAIZ = path.join(import.meta.dirname, '..');
const REGRAS = path.join(RAIZ, 'firebase', 'database.rules.json');
const TEMPLATE = path.join(RAIZ, 'firebase', 'database.rules.template.json');

const texto = fs.readFileSync(REGRAS, 'utf8');
const regras = JSON.parse(texto).rules.users.$uid;

test('o arquivo publicado é exatamente o que o gerador produz', () => {
  const gerado = execFileSync(process.execPath, [path.join(RAIZ, 'tools', 'sync-rules.js'), '--stdout'], { encoding: 'utf8' });
  assert.equal(gerado, texto, 'rode `node tools/sync-rules.js` e comite o resultado');
});

test('o template não deixou macro por expandir', () => {
  assert.equal(/@[A-Z]/.test(texto), false, texto.slice(0, 200));
  assert.ok(fs.readFileSync(TEMPLATE, 'utf8').includes('@U@'), 'o template usa macro');
});

test('a raiz perdeu o .write: o apagão de /users/{uid} deixa de existir', () => {
  assert.equal(regras['.write'], undefined);
  assert.equal(regras['.read'], 'auth != null && auth.uid == $uid');
});

test('as validações legadas continuam byte a byte as de hoje', () => {
  const lease = regras.leases.$acct.$pr;
  assert.equal(lease['.validate'], "newData.hasChildren(['leaseId', 'deviceId', 'operationKind', 'expiresAt']) && newData.child('expiresAt').isNumber() && newData.child('expiresAt').val() > now && newData.child('expiresAt').val() <= now + 300000 && (!data.exists() || data.child('expiresAt').val() <= now || (data.child('leaseId').val() == newData.child('leaseId').val() && data.child('deviceId').val() == newData.child('deviceId').val()))");
  assert.equal(regras.receipts.$acct.$pr.$fp['.validate'], "newData.hasChildren(['operationKind', 'materialVersion', 'deviceId', 'completedAt', 'outcome', 'publicationState']) && newData.child('completedAt').isNumber()");
  assert.equal(regras.usageEvents.$device.$event['.validate'], "newData.hasChildren(['at', 'kind', 'costUsd']) && newData.child('at').isNumber()");
});

test('os nós legados ganharam concessão de escrita própria, já que a raiz não concede mais', () => {
  for (const no of ['leases', 'receipts', 'dailyRounds', 'devices', 'usageEvents']) {
    assert.equal(regras[no]['.write'], 'auth != null && auth.uid == $uid', no);
  }
});

test('keyring: exige senha recente e rev monotônico', () => {
  const w = regras.keyring['.write'];
  assert.ok(w.includes("auth.token.firebase.sign_in_provider == 'password'"));
  assert.ok(w.includes('auth.token.auth_time * 1000 + 300000 > now'), 'o *1000 é o que faz o caso positivo passar');
  assert.ok(w.includes("newData.child('rev').val() == data.child('rev').val() + 1"));
});

test('nó novo sem concessão é negado por construção: só os listados têm .write', () => {
  const comEscrita = Object.keys(regras).filter((k) => regras[k] && regras[k]['.write']);
  assert.deepEqual(comEscrita.sort(), ['dailyRounds', 'devices', 'keyring', 'leases', 'receipts', 'rulesProbe', 'usageEvents'].sort());
});
```

- [ ] **Passo 2:** rodar `node --test test/sync-rules-contrato.test.js`. Esperado: reprova (não existe template nem gerador, e a raiz ainda tem `.write`).

- [ ] **Passo 3:** criar `firebase/database.rules.template.json` copiando o `database.rules.json` de hoje e aplicando exatamente estas mudanças:
  1. em `users.$uid`, **apague** a linha do `".write"` e deixe o `".read"` como está;
  2. troque o valor do `".read"` por `"@U@"`;
  3. acrescente `".write": "@U@"` dentro de `leases`, `receipts`, `dailyRounds`, `devices` e `usageEvents` (na categoria, antes do curinga), sem tocar em nenhuma `.validate`;
  4. acrescente o nó `keyring` e o nó `rulesProbe`:

```json
        "keyring": {
          ".write": "@U@ && @REC@ && @H(['v','rev','updatedAt','epochSince','cur','kids','kcv','slots'])@ && newData.child('rev').isNumber() && ((!data.exists() && newData.child('rev').val() == 1) || newData.child('rev').val() == data.child('rev').val() + 1) && newData.child('updatedAt').val() <= now + 60000 && newData.child('updatedAt').val() + 60000 > now",
          "slots": {
            "$s": {
              ".validate": "$s.matches(/^(pw|pp)$/)",
              "blob": { ".validate": "newData.isString()" }
            }
          }
        },
        "rulesProbe": {
          "v2": {
            "$dev": {
              ".write": "@U@",
              ".validate": "newData.hasChildren(['at', 'v']) || !newData.exists()"
            }
          }
        },
```

- [ ] **Passo 4:** criar `tools/sync-rules.js`.

```js
// Gerador das regras do Firebase (anexo C1, "Estratégia de regras"). Expande as macros do
// template e escreve firebase/database.rules.json.
//
// A expansão é TEXTUAL, sem JSON.parse: o template já é o JSON publicável, com marcadores
// no lugar das condições repetidas. Assim o arquivo gerado é byte a byte previsível, o
// diff da publicação é legível, e nada aqui depende do formatador de JSON do Node.
//
// As regras NÃO são publicadas por este script: a publicação é manual, uma vez, pelo dono
// (firebase/README.md). Aqui só se gera o arquivo que ele vai colar no console.
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.join(import.meta.dirname, '..');
const TEMPLATE = path.join(RAIZ, 'firebase', 'database.rules.template.json');
const SAIDA = path.join(RAIZ, 'firebase', 'database.rules.json');
const MAX_PASSES = 5;

const SIMPLES = {
  U: "auth != null && auth.uid == $uid",
  C: "root.child('users').child($uid).child('live').child('control')",
  // senha recente: o auth_time vem em SEGUNDOS, e sem o *1000 a comparação com `now`
  // (milissegundos) daria sempre falso, negando até quem acabou de entrar
  REC: "auth.token.firebase.sign_in_provider == 'password' && auth.token.auth_time * 1000 + 300000 > now",
  GEN: "newData.child('generation').val() == @C@.child('admin').child('generation').val()",
  LIMPA: "!newData.exists() && @REC@ && @C@.child('cleanup').child('enabled').val() == true && !root.child('users').child($uid).child('live').child('operations').exists()",
};

function listaDe(texto) {
  return texto.split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

function expandirFuncoes(texto) {
  return texto
    .replace(/@H\(\[([^\]]*)\]\)@/g, (_m, lista) => `newData.hasChildren([${listaDe(lista).map((x) => `'${x}'`).join(', ')}])`)
    .replace(/@ENC\((\d+)\)@/g, (_m, n) => `newData.child('enc').isString() && newData.child('enc').val().matches(/^e1[.]g[0-9]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$/) && newData.child('enc').val().length <= ${n}`);
}

function expandir(texto) {
  let saida = texto;
  for (let i = 0; i < MAX_PASSES; i++) {
    const antes = saida;
    for (const [nome, valor] of Object.entries(SIMPLES)) saida = saida.split(`@${nome}@`).join(valor);
    saida = expandirFuncoes(saida);
    if (saida === antes) break;
  }
  return saida;
}

function gerar() {
  const bruto = fs.readFileSync(TEMPLATE, 'utf8');
  const saida = expandir(bruto);
  const sobrou = saida.match(/@[A-Z][A-Za-z]*/);
  if (sobrou) throw new Error(`macro sem expansão no template: ${sobrou[0]}`);
  return saida;
}

const gerado = gerar();
if (process.argv.includes('--stdout')) {
  process.stdout.write(gerado);
} else if (process.argv.includes('--check')) {
  const atual = fs.existsSync(SAIDA) ? fs.readFileSync(SAIDA, 'utf8') : '';
  if (atual !== gerado) {
    process.stderr.write('firebase/database.rules.json está diferente do gerado pelo template\n');
    process.exit(1);
  }
  process.stdout.write('regras geradas conferem com o arquivo publicado\n');
} else {
  fs.writeFileSync(SAIDA, gerado);
  process.stdout.write(`regras geradas em ${SAIDA}\n`);
}
```

- [ ] **Passo 5:** em `package.json`, acrescente o script `"sync:rules": "node tools/sync-rules.js"`. Rode `node tools/sync-rules.js` e comite o `database.rules.json` gerado.

- [ ] **Passo 6:** escrever `test/sync-escritas-v1.test.js`, que monta os payloads REAIS e confere que nenhuma condição nova os alcança.

```js
// Regra de ouro dos nós legados: toda escrita que o v1 faz hoje continua valendo sob as
// regras v2. Aqui o teste monta os payloads REAIS (não literais escritos à mão) e confere
// que cada um satisfaz as validações publicadas. O emulador confirma no roteiro manual.
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const RAIZ = path.join(import.meta.dirname, '..');
const regras = JSON.parse(fs.readFileSync(path.join(RAIZ, 'firebase', 'database.rules.json'), 'utf8')).rules.users.$uid;

const { buildLease } = await import('../lib/sync/lease.js');
const { buildReceipt } = await import('../lib/sync/receipts.js');
const { payloadFor } = await import('../lib/sync/outbox.js');

const AGORA = 1_800_000_000_000;
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

// Lê a lista de hasChildren de uma .validate e confere que o payload tem todos.
function exigidos(validate) {
  const m = /hasChildren\(\[([^\]]*)\]\)/.exec(validate || '');
  return m ? m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')) : [];
}

test('lease real satisfaz a validação publicada', () => {
  const lease = buildLease({ leaseId: 'L1', deviceId: 'dA', operationKind: 'review', headSha: HEAD, nowMs: AGORA, farolVersion: '9.9.9' });
  for (const campo of exigidos(regras.leases.$acct.$pr['.validate'])) assert.ok(campo in lease, campo);
  assert.ok(lease.expiresAt > AGORA && lease.expiresAt <= AGORA + 300000, 'dentro do teto que a regra aceita');
});

test('recibo real satisfaz a validação publicada', () => {
  const recibo = buildReceipt({ operationKind: 'review', materialVersion: HEAD, deviceId: 'dA', leaseId: 'L1', nowMs: AGORA, outcome: 'completed', publicationState: 'published', reviewId: '', farolVersion: '9.9.9' });
  for (const campo of exigidos(regras.receipts.$acct.$pr.$fp['.validate'])) assert.ok(campo in recibo, campo);
  assert.equal(typeof recibo.completedAt, 'number');
});

test('evento de consumo real satisfaz a validação publicada', () => {
  const p = payloadFor({ id: 'a1', at: AGORA, kind: 'review', account: 'x', costUsd: 1 }, 'dA', '9.9.9');
  for (const campo of exigidos(regras.usageEvents.$device.$event['.validate'])) assert.ok(campo in p, campo);
  assert.equal(typeof p.at, 'number');
});

test('cada nó legado tem concessão própria de escrita, agora que a raiz não concede', () => {
  for (const no of ['leases', 'receipts', 'dailyRounds', 'devices', 'usageEvents']) {
    assert.ok(regras[no]['.write'], `${no} perdeu a concessão e o v1 pararia de escrever`);
  }
});
```

- [ ] **Passo 7:** rodar `node --test test/sync-rules-contrato.test.js test/sync-escritas-v1.test.js`. Esperado: verde.

- [ ] **Passo 8 (contraprova):** três mutações, uma de cada vez:
  (a) troque um caractere de uma `.validate` legada no template, gere e rode: reprova `as validações legadas continuam byte a byte`.
  (b) apague o `* 1000` da macro `REC`, gere e rode: reprova `keyring: exige senha recente`.
  (c) devolva `".write": "@U@"` para `users.$uid` no template, gere e rode: reprova `a raiz perdeu o .write`.
  Restaure, gere de novo e rode: verde.

- [ ] **Passo 9:** commit.

```bash
git add firebase/database.rules.template.json firebase/database.rules.json tools/sync-rules.js package.json test/sync-rules-contrato.test.js test/sync-escritas-v1.test.js
git commit -m "feat(sync): regras v2 geradas por macro, com a raiz sem concessao de escrita"
```

---

## Tarefa 12: remoção do apagão remoto

**Arquivos:**
- editar `lib/engine/sync.js` (apaga `syncEraseRemote` e os exports);
- editar `server.js` (apaga a fachada);
- editar `lib/http-server.js` (apaga a rota);
- editar `ui/pure/sync.js` e `ui/app.js` (apaga o botão e o handler);
- criar `test/sync-sem-apagao.test.js`.

O apagão sai porque as regras v2 negam o DELETE da raiz: manter um botão que agora falha seria prometer o que o banco recusa. O caminho de "parar de usar" continua sendo **Sair deste aparelho** e **desligar**, que já existem.

- [ ] **Passo 1:** escrever o teste que falha.

```js
// O apagão remoto some (7.C1). As regras v2 negam o DELETE de /users/{uid}, então um botão
// que o chama só produziria erro. Sair deste aparelho e desligar continuam existindo.
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const RAIZ = path.join(import.meta.dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

test('nenhum arquivo de produção menciona o apagão remoto', () => {
  for (const rel of ['lib/engine/sync.js', 'server.js', 'lib/http-server.js', 'ui/app.js', 'ui/pure/sync.js']) {
    const fonte = ler(rel);
    assert.equal(/syncEraseRemote|erase-remote|syncErase\b/.test(fonte), false, rel);
  }
});

test('a saída e o desligar continuam de pé', () => {
  assert.ok(/syncLogout/.test(ler('lib/engine/sync.js')));
  assert.ok(/stopSync/.test(ler('lib/engine/sync.js')));
  assert.ok(/syncLogout/.test(ler('ui/app.js')));
});

test('a rota do apagão não existe mais no servidor', () => {
  assert.equal(/\/api\/sync\/erase-remote/.test(ler('lib/http-server.js')), false);
});
```

- [ ] **Passo 2:** rodar `node --test test/sync-sem-apagao.test.js`. Esperado: reprova nos três casos.

- [ ] **Passo 3:** remover, nesta ordem: o handler `syncApagarRemoto` e o `syncErase` de `ui/app.js`; o botão de `ui/pure/sync.js`; a rota de `lib/http-server.js`; a fachada de `server.js`; a função `syncEraseRemote` e os dois exports de `lib/engine/sync.js`. Se `resetForFullSync`/`saveOutbox` ficarem sem uso no arquivo, remova também os imports órfãos.

- [ ] **Passo 4:** rodar `node --test test/sync-sem-apagao.test.js test/sync-engine.test.js test/http.test.js test/facades.test.js test/ui-pure-sync.test.js test/ui-contract.test.js`. Esperado: verde. **Se `test/sync-engine.test.js` tiver um caso do apagão (linha 215 hoje), ele reprova: PARE e reporte.** Remover comportamento com teste existente é decisão do dono, e o plano não autoriza editar teste existente.

- [ ] **Passo 5 (contraprova):** devolva a rota em `lib/http-server.js`. Rode: reprova `a rota do apagão não existe mais`. Restaure e rode: verde.

- [ ] **Passo 6:** commit.

```bash
git add lib/engine/sync.js server.js lib/http-server.js ui/app.js ui/pure/sync.js test/sync-sem-apagao.test.js
git commit -m "feat(sync): remove o apagao remoto, que as regras v2 passam a negar"
```

---

## Tarefa 13: frase da tela, README do Firebase e mapa do mantenedor

**Arquivos:** editar `ui/pure/sync.js`, `firebase/README.md` e `CLAUDE.md`.

- [ ] **Passo 1:** em `ui/pure/sync.js`, no lugar onde ficava o botão do apagão, entre a frase da seção 11 da spec, montada a partir de uma constante do módulo, escapada como todo texto da UI. Ela diz, sem prometer mais: o que sobe cifrado; o que qualquer cópia do banco enxerga; o que a coordenação expõe; contra quem a cifra não protege; o que nunca sai do aparelho; e que **sincronização não é backup**. Título e autor de PR são dados de colegas, e a frase nomeia isso.

- [ ] **Passo 2:** em `firebase/README.md`, acrescentar a seção "Validação manual das regras v2", com a lista completa de itens de emulador e de projeto real que o anexo C1 marca como de emulador: `auth_time` (entrar, esperar 6 min, renovar, tentar gravar `keyring`: 401; login novo: 200), `.length`, `matches` com classes, `child()` dinâmico, cada escrita v1 literal respondendo 200, o DELETE de `/users/{uid}` respondendo 401, e a recusa de `rev` repetido no `keyring`. Registrar que **as regras não rodam no CI** (o fake não avalia regra) e que a publicação é manual, uma vez, pelo dono.

- [ ] **Passo 3:** em `CLAUDE.md`, na tabela "Mapa de arquivos", depois da linha de `lib/sync/...`, acrescentar as linhas de `lib/sync/tags.js`, `lib/sync/kek.js`, `lib/sync/chaveiro.js`, `lib/sync/cache-chave.js`, `lib/sync/envelope.js`, `lib/sync/sonda-regras.js` e `tools/sync-rules.js`, cada uma dizendo o que o arquivo decide e o que ele nunca faz.

- [ ] **Passo 4:** rodar `npm test`. Esperado: verde, incluindo `test/guias-navegaveis.test.js` e `test/ui-pure-sync.test.js`.

- [ ] **Passo 5:** commit.

```bash
git add ui/pure/sync.js firebase/README.md CLAUDE.md
git commit -m "docs: frase da tela do compartilhamento, roteiro manual das regras v2 e mapa"
```

---

## Tarefa 14: gate completo e evidência

- [ ] **Passo 1:** gate completo.

```bash
npm run check && npm run lint && npm test
```

Esperado: os três verdes, `lint` sem nenhuma contagem acima da baseline.

- [ ] **Passo 2:** conferir que nenhum teste existente foi tocado e que só os arquivos do mapa mudaram.

```bash
git diff --name-status md/integracao...HEAD -- test/
git diff --stat md/integracao...HEAD
```

Esperado: em `test/`, só linhas `A`, com a exceção declarada de `test/helpers/fake-identity.js` (helper, se a Tarefa 9 precisou do `setPassword`). Qualquer `M` em teste de comportamento reprova a entrega.

- [ ] **Passo 3:** rodar a caracterização isolada mais uma vez e guardar a saída.

```bash
node --test test/sync-compartilhamento-desligado.test.js
```

- [ ] **Passo 4:** rodar `node tools/sync-rules.js --check`. Esperado: o arquivo publicado confere com o gerado.

- [ ] **Passo 5:** escrever `evidencias-execucao/c1.md` com: estado, gate (antes e depois), critérios de aceite x teste, tabela de contraprovas com o número de falhas medido em cada uma, ajustes técnicos em relação ao plano e a lista do que ficou **aguardando validação externa** (tudo que depende de emulador ou de projeto real). Atualizar o `EXECUCAO.md` (linha de estado, linha da entrega, commits, próxima ação) e a tabela "Validações externas pendentes".

- [ ] **Passo 6:** commit.

```bash
git add docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/
git commit -m "docs: evidencia da execucao da C1"
```

---

## Critérios de aceite da spec x testes

| Critério (7.C1 e CT-ENV) | Teste | Estado esperado |
|---|---|---|
| Keyring criado só depois do login por senha | `sync-desbloqueio`: "senha errada não grava nada" | comprovado |
| Corrida na criação termina com um chaveiro só | `sync-chaveiro`: "corrida na criação" | comprovado |
| Keyring perdido nunca é recriado sozinho | `sync-chaveiro` e `sync-desbloqueio` | comprovado |
| Cache 0600 em toda gravação | `sync-cache-chave` (pula no Windows) | comprovado no POSIX |
| Cache preservado quando a credencial do Firebase fica inválida | `sync-recuperacao-chave`: "credencial ... NÃO apaga o cache" | comprovado |
| As três situações de recuperação | `sync-recuperacao-chave` (um caso cada) | comprovado |
| Envelope: AAD amarrada, IV único, falha fechada, preenchimento | `sync-envelope` (12 casos) | comprovado |
| Sem compressão em `lib/sync` | `sync-envelope`: varredura estática de `node:zlib` | comprovado |
| Identificadores por HMAC, diferentes de SHA-256 | `sync-tags` | comprovado |
| Coordenação continua em SHA-256 sem sal | `sync-compartilhamento-desligado` | comprovado |
| Compartilhamento desligado: nada muda | `sync-compartilhamento-desligado` (8 casos) | comprovado |
| Regras v2 geradas, byte a byte | `sync-rules-contrato` | comprovado no estático |
| Escritas v1 continuam válidas sob as regras v2 | `sync-escritas-v1` | comprovado no estático; **emulador pendente** |
| Apagão removido | `sync-sem-apagao` | comprovado |
| Sonda detecta regra velha | `sync-sonda-regras` | comprovado |
| `auth_time`, `.length`, `matches`, `child()` dinâmico | roteiro manual do `firebase/README.md` | **aguardando validação externa** |

## Limites declarados

- **As regras não rodam no CI.** O `fake-rtdb` não avalia regra (decisão 8 da spec): tudo que é de regra fica provado só no estático aqui, e o resto vai para o roteiro manual do `firebase/README.md`.
- **`scrypt` no Termux não foi medido.** Se passar de 3 s, a spec manda cair para `N=8192, r=8, p=10`. Os parâmetros viajam no embrulho, então a troca não exige migração.
- **Sem migração de eventos legados** (spec 9.2): evento antigo continua identificado como legado, e o valor nunca some.
- **`K_adm` (Ed25519) e as assinaturas** ficam para a C2: aqui nenhuma política é assinada nem conferida.
- **Os nós de conteúdo (catálogo, revisões, panorama, pendências) não passam a ser escritos nesta entrega.** A C1 entrega o mecanismo (chave, envelope, tags, regras) e o interruptor; quem começa a publicar conteúdo cifrado é a C3 em diante, atrás do mesmo interruptor.
- **Rotação de chave existe no módulo, mas não tem gatilho de UI nesta entrega**: ela é chamada pelo ciclo de recuperação e pela C2.
