# C0b Arbitragem de postagem no funil e co-assinatura coordenada: plano de implementação

> **Ajustes de execução (15/09/2026, valem sobre o texto abaixo):** worktree `C:\Users\wanderson\Documents\farol-md-exec`; branch `md/c0b` cortada da ponta de `md/integracao` (base `origin/main` `8c043bc`, com `ui/pure/` modularizado, mais C1a, C0 e A5 integradas); sem `git fetch`/`merge origin/main`. Onde o texto manda criar ou acrescentar seção no `EXECUCAO.md`, a evidência vai para `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/evidencias-execucao/c0b.md` e o `EXECUCAO.md` recebe só a linha de estado, os commits e o caminho da evidência. Dependência de entrega mergeada na main significa integrada em `md/integracao`. Números esperados de testes são referência: o que vale é a medição na hora.


> **Para quem executa:** use superpowers:executing-plans, tarefa por tarefa, marcando os checkboxes.

**Objetivo:** implementar o contrato CT-POST no funil `postReview` para APPROVE e REQUEST_CHANGES com a coordenação entre aparelhos ligada, aplicado às cinco vias (revisão automática e re-revisão com o handle da sessão; reenvio, clique, sessão de chat ou terminal e co-assinatura com posse de postagem no mesmo lease `/leases/{conta}/{pr}`, tipo `post`), mais as regras próprias da co-assinatura da entrega 7.C0b. Com a coordenação desligada, as chamadas ao `gh` ficam byte a byte como hoje.

**Arquitetura:** a lógica nova mora em módulos novos; `decision.js`, `review.js` e `skip-review.js` (dívida de responsabilidade única em `tools/eng-behaviour/baselines.json`) recebem só fiação.

| Peça | Arquivo | Papel |
|---|---|---|
| Posse de postagem | `lib/sync/posse-postagem.js` | lease `post` no mesmo nó das análises, devolvendo um handle do coordenador |
| Registro de postagem | `lib/engine/registro-postagem.js` | cópia local atômica (`state/postagens.json`) e cópia remota no filho `postagens/{EVENTO}` do recibo `review_<head>` |
| Arbitragem | `lib/engine/postagem-arbitragem.js` | os passos 1 a 7 de CT-POST em volta da fila por PR que já existe |
| Reconciliação | `lib/engine/postagem-reconciliacao.js` | resolve `enviando` pela regra das duas leituras |
| Co-assinatura coordenada | `lib/engine/coassinatura-coordenada.js` | posse, releitura no mesmo SHA, postagem ancorada sem recuo |
| Cobertura | `lib/sync/cobertura-postagem.js` | `coberturaDePostagem(devices, account)`, pura |

O funil fica assim: `postReview(engine, pr, payload, opcoes)` decide por `postagemCoordenada(engine, payload)`. Desligada (ou COMMENT), chama `enfileirarPostagem(engine, pr, payload, null)`, que é o corpo de hoje. Ligada, chama `arbitrarPostagem(engine, { ...opcoes, pr, payload }, (guarda) => enfileirarPostagem(engine, pr, payload, guarda))`. A guarda tem quatro ganchos: `naVez()` (passo 2, depois da espera na fila), `antesDoEnvio(payloadNormalizado)` (passos 3 e 4, colado em cada `io.run`), `depoisDoEnvio(r)` (passo 5) e `podeRecuar()` (passo 6).

**Stack:** Node ESM puro, `node --test`, dublê `test/helpers/fake-rtdb.js`, zero dependências novas.

**Spec:** `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md`, seções 4.6, CT-COMPAT, CT-FIO, CT-POST, 7.C0b e 15.

**Dependências de outros planos:** C0 (correções da sincronização publicada), item 3. Este plano CONSOME, sem reimplementar, `syncAtualizarPublicacao(engine, { account, prKey, headSha, operationKind, publicationState })`, exportada por nome de `lib/engine/sync.js`. A Tarefa 0 para a execução se ela não existir.

**Restrições globais:**
- Zero dependências novas. Texto e comentários em português, sem travessão.
- O ratchet de `npm run lint` não pode subir: nada de `JSON.parse`/`JSON.stringify` cru fora de `lib/io.js` (nos arquivos de produção; `test/` não é medido), nada de `process.env` fora de `lib/paths.js`/`lib/env.js`, nenhum número de tempo fora de `lib/constants.js`, nenhum `catch` vazio sem comentário, nenhum ternário aninhado (dois `?` no mesmo statement, contando regex), profundidade de chaves no máximo 4 dentro de função, arquivo novo abaixo de 400 linhas úteis. Números medidos hoje: `lib/engine/sync.js` 377 linhas úteis, `lib/engine/skip-review.js` 336, `lib/sync/coordinator.js` 300.
- Em `decision.js`, `review.js`, `skip-review.js`, `server.js` e `sync.js`: só fiação mínima.
- Testes com `FAROL_HOME` temporário fixado antes de `await import(...)` de qualquer módulo que alcance `lib/paths.js`. Helpers novos de `test/helpers/` não importam módulo do repositório que alcance `lib/paths.js`.
- Nenhum teste existente é editado. Se um teste existente reprovar, pare e reporte.
- Nada toca `~/.farol` real, GitHub real ou Firebase real.
- Commits sem atribuição de IA. Nada de push nesta execução sem pedido do dono.
- Imports entre os módulos novos e o coordenador são NOMEADOS: `coordinator.js` importa `decision.js`, que passa a importar a arbitragem, e só funções declaradas atravessam um ciclo de ESM sem cair em TDZ.

---

## Mapa de arquivos

| Ação | Caminho |
|---|---|
| criar | `lib/sync/posse-postagem.js` |
| criar | `lib/sync/cobertura-postagem.js` |
| criar | `lib/engine/registro-postagem.js` |
| criar | `lib/engine/postagem-arbitragem.js` |
| criar | `lib/engine/postagem-reconciliacao.js` |
| criar | `lib/engine/coassinatura-coordenada.js` |
| criar | `test/helpers/github-reviews-falso.js` |
| criar | `test/helpers/aparelho-coordenado.js` |
| criar | `test/postagem-coordenacao-desligada.test.js` |
| criar | `test/sync-coordinator-postagem.test.js` |
| criar | `test/sync-posse-postagem.test.js` |
| criar | `test/registro-postagem.test.js` |
| criar | `test/postagem-reconciliacao.test.js` |
| criar | `test/postagem-arbitragem.test.js` |
| criar | `test/postagem-vias.test.js` |
| criar | `test/postagem-revisao-automatica.test.js` |
| criar | `test/postagem-incerta.test.js` |
| criar | `test/coassinatura-coordenada.test.js` |
| criar | `test/cobertura-postagem.test.js` |
| criar | `test/postagem-fiacao-fonte.test.js` |
| editar | `lib/constants.js` (objeto `TEMPOS`, depois de `SINAL_REVISAO_TTL_MS`, linha 317) |
| editar | `lib/sync/coordinator.js` (`noopHandle` 82-86, `gravarRecibo` 302-311, `createHandle` 351-380) |
| editar | `lib/engine/decision.js` (import na linha 16, `retryFailedPosts` 370, `postReview` 690-701, `postReviewSerial` 703-720, `postReviewOnce` 722-798, `postReviewFromSession` 904, `decide` 1033) |
| editar | `lib/engine/review.js` (import depois da linha 26, postagens em 1437-1438 e 1480-1481) |
| editar | `lib/engine/skip-review.js` (`reviewsDeOutros` 379-392, `coAssinar` 422-434, imports 64-70) |
| editar | `lib/engine/sync.js` (import no topo, `statusForUi` 513-525) |
| editar | `server.js` (import perto da linha 37, `check()` depois da linha 883, fachadas na linha 1508) |
| criar | `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md` (ou acrescentar seção, se já existir) |

Todas as linhas acima foram medidas no worktree `farol-md-exec` em 15/09/2026, sobre `6d4252b`, antes da C0. Depois de a C0 entrar, reconfira cada âncora com `grep -n` antes de editar; o texto citado em cada passo é o que vale.

---

## Tarefa 0: preparação e dependência da C0

**Arquivos:** nenhum.

- [ ] **Passo 1:** no worktree, confirmar árvore limpa e a `main` com a C0 mergeada.

```
cd C:/Users/wanderson/Documents/farol-md-exec
git status --short
git fetch origin && git log --oneline -5 origin/main
```

Esperado: `git status --short` vazio.

- [ ] **Passo 2:** confirmar a função da C0.

```
grep -n "syncAtualizarPublicacao" lib/engine/sync.js
```

Esperado: uma definição `async function syncAtualizarPublicacao(engine, {` e o nome na linha `export { ... }`. **Se não existir, pare aqui:** esta entrega depende da C0 (seção 6.1 da spec). Não implemente uma cópia.

- [ ] **Passo 3:** criar o branch a partir da `main` atualizada.

```
git switch main && git pull --ff-only
git switch -c feat/md-c0b-arbitragem-postagem
```

- [ ] **Passo 4:** medir o gate de partida e anotar os números (vão para o EXECUCAO.md).

```
npm run check && npm run lint && npm test
```

Esperado: verde. Se não estiver verde antes de qualquer mudança, pare e reporte.

---

## Tarefa 1: caracterização da coordenação desligada (antes de mudar código)

**Arquivos:** criar `test/postagem-coordenacao-desligada.test.js`.

**Interfaces:** nenhuma nova. O teste grava cada `io.run` (argumentos, com o caminho do arquivo temporário trocado por `<arquivo>`, e o conteúdo exato do arquivo `--input`) e compara com a lista esperada. Ele nasce VERDE contra o código de hoje e precisa continuar verde depois de todas as tarefas: é a prova de "coordenação desligada, byte a byte nas chamadas ao `gh`". A via de revisão automática não tem cenário próprio aqui porque ela chega ao mesmo `postReview` com o mesmo payload; o terceiro argumento que ela passa a mandar só é lido pela arbitragem.

- [ ] **Passo 1:** criar o teste completo.

```js
// Coordenação entre aparelhos DESLIGADA: as chamadas ao gh das vias de postagem ficam
// exatamente como eram antes da arbitragem de postagem (CT-POST, "Com a coordenação
// desligada: comportamento de hoje", e CT-COMPAT). Este arquivo nasce ANTES da mudança,
// verde contra o código de então, e continua verde depois: é a prova byte a byte.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-postagem-desligada-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const { Engine } = await import('../server.js');
const skip = await import('../lib/engine/skip-review.js');

const runReal = io.run;
let chamadas = [];
let respostas = [];
io.run = async (cmd, args) => {
  const a = [...(args || [])];
  const i = a.indexOf('--input');
  const conteudo = i >= 0 ? fs.readFileSync(a[i + 1], 'utf8') : null;
  if (i >= 0) a[i + 1] = '<arquivo>';
  chamadas.push({ cmd, args: a, conteudo });
  return respostas.length ? respostas.shift() : { ok: true, code: 0, stdout: '[]', stderr: '' };
};
after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { chamadas = []; respostas = []; });

const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const PR = { key: 'o/r#1', repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1', author: 'dev', account: 'eu' };
const CORPO = 'Leitura atenta, tudo certo por aqui.';
const POST = ['api', 'repos/o/r/pulls/1/reviews', '--input', '<arquivo>'];
const MEUS = ['api', 'repos/o/r/pulls/1/reviews', '--jq', '[.[] | select((.user.login | ascii_downcase) == "eu") | {state, submitted_at, commit_id}]'];
const OUTROS = ['api', 'repos/o/r/pulls/1/reviews', '--jq', '[.[] | select((.user.login | ascii_downcase) != "eu") | {quem: .user.login, tipo: .user.type, state, commit_id}]'];
const VAZIO = { ok: true, code: 0, stdout: '[]', stderr: '' };
const OK_POST = { ok: true, code: 0, stdout: '{"id":1}', stderr: '' };
const RECUSA = { ok: false, code: 1, stdout: '{"message":"Unprocessable Entity","errors":["commit_id inválido"]}', stderr: 'gh: Unprocessable Entity (HTTP 422)' };

function arquivo(valor) { return JSON.stringify(valor, null, 2); }

function motor() {
  const e = new Engine();
  e.log = () => { };
  e.accountForPr = () => 'eu';
  e.tokenFor = () => 'tok-eu';
  e.token = 'tok-eu';
  e.refreshTokens = async () => { };
  e.ghEnv = () => ({});
  e.headSha = async () => HEAD;
  e.prState = async () => 'OPEN';
  e.saveDecisions = () => { };
  e.pushState = () => { };
  e.writeMemory = () => { };
  e.skipComentado = {};
  e.postagensArquivo = path.join(FAROL_HOME, `postagens-${Math.random().toString(16).slice(2)}.json`);
  return e;
}

function pendencia(extra = {}) {
  return {
    id: 'd1', key: PR.key, createdAt: 1, status: 'pending', verdict: 'approve',
    pr: { repo: 'o/r', number: 1, url: PR.url, author: 'dev', account: 'eu' }, headSha: HEAD, reasons: [],
    payloads: { approve: { event: 'APPROVE', body: CORPO, comments: [] } }, ...extra,
  };
}

test('pré-condição: engine de teste nasce com a coordenação desligada', () => {
  assert.equal(motor().syncCoordenacaoAtiva(), false);
});

test('postReview: APPROVE ancorado sai numa chamada só, com o payload normalizado, sem registro de postagem', async () => {
  const e = motor();
  respostas = [OK_POST];
  const r = await e.postReview(PR, { event: 'APPROVE', body: `  ${CORPO}  `, comments: [], commit_id: HEAD });
  assert.equal(r.ok, true);
  assert.deepEqual(chamadas, [{ cmd: 'gh', args: POST, conteudo: arquivo({ event: 'APPROVE', body: CORPO, comments: [], commit_id: HEAD }) }]);
  assert.equal(fs.existsSync(e.postagensArquivo), false);
});

test('postReview: 422 sem inline recua a âncora numa segunda chamada', async () => {
  const e = motor();
  respostas = [RECUSA, OK_POST];
  await e.postReview(PR, { event: 'APPROVE', body: CORPO, comments: [], commit_id: HEAD });
  assert.deepEqual(chamadas, [
    { cmd: 'gh', args: POST, conteudo: arquivo({ event: 'APPROVE', body: CORPO, comments: [], commit_id: HEAD }) },
    { cmd: 'gh', args: POST, conteudo: arquivo({ event: 'APPROVE', body: CORPO, comments: [] }) },
  ]);
});

test('postReview: 422 com inline recua os pontos para o corpo', async () => {
  const e = motor();
  const inline = { path: 'a.js', line: 3, side: 'RIGHT', body: 'texto do ponto' };
  respostas = [RECUSA, OK_POST];
  await e.postReview(PR, { event: 'REQUEST_CHANGES', body: CORPO, comments: [inline], commit_id: HEAD });
  const recuado = `${CORPO}\n\nOs comentários abaixo não puderam ser ancorados nas linhas do diff:\n- \`a.js:3\`: texto do ponto`;
  assert.deepEqual(chamadas, [
    { cmd: 'gh', args: POST, conteudo: arquivo({ event: 'REQUEST_CHANGES', body: CORPO, comments: [inline], commit_id: HEAD }) },
    { cmd: 'gh', args: POST, conteudo: arquivo({ event: 'REQUEST_CHANGES', body: recuado, comments: [] }) },
  ]);
});

test('decide: dedup no GitHub e POST ancorado no head lido', async () => {
  const e = motor();
  e.decisions.pending = [pendencia()];
  respostas = [VAZIO, OK_POST];
  assert.equal((await e.decide('d1', 'approve')).ok, true);
  assert.deepEqual(chamadas, [
    { cmd: 'gh', args: MEUS, conteudo: null },
    { cmd: 'gh', args: POST, conteudo: arquivo({ event: 'APPROVE', body: CORPO, comments: [], commit_id: HEAD }) },
  ]);
});

test('retryFailedPosts: dedup no GitHub e POST ancorado', async () => {
  const e = motor();
  e.decisions.pending = [pendencia({ postRetry: { event: 'approve', attempts: 0 } })];
  respostas = [VAZIO, OK_POST];
  assert.equal(await e.retryFailedPosts(), 1);
  assert.deepEqual(chamadas, [
    { cmd: 'gh', args: MEUS, conteudo: null },
    { cmd: 'gh', args: POST, conteudo: arquivo({ event: 'APPROVE', body: CORPO, comments: [], commit_id: HEAD }) },
  ]);
});

test('postReviewFromSession: POST direto, sem consulta ao GitHub antes', async () => {
  const e = motor();
  const cap = e.createReviewPostCapability([PR.key], 'eu', 'chat', '');
  respostas = [OK_POST];
  const r = await e.postReviewFromSession({ key: PR.key, payload: { event: 'APPROVE', body: CORPO, comments: [] } }, cap);
  assert.equal(r.ok, true);
  await new Promise((res) => setImmediate(res));
  assert.deepEqual(chamadas, [{ cmd: 'gh', args: POST, conteudo: arquivo({ event: 'APPROVE', body: CORPO, comments: [] }) }]);
});

test('coAssinar: dedup e POST sem commit_id, como hoje', async () => {
  const e = motor();
  e.skipComentado[PR.key] = { head: HEAD, quem: ['ana'] };
  respostas = [VAZIO, OK_POST];
  assert.equal(await skip.coAssinar(e, PR, 'ana', HEAD), true);
  assert.deepEqual(chamadas, [
    { cmd: 'gh', args: MEUS, conteudo: null },
    { cmd: 'gh', args: POST, conteudo: arquivo({ event: 'APPROVE', body: skip.textoDaCoassinatura('ana').trim(), comments: [] }) },
  ]);
});

test('seguirForaDeCena com head vazio: desligada segue aceitando a aprovação sem commit_id', async () => {
  const e = motor();
  e.config.coAssinarReview = true;
  respostas = [{ ok: true, code: 0, stdout: '[{"quem":"ana","tipo":"User","state":"APPROVED"}]', stderr: '' }, VAZIO, OK_POST];
  assert.equal(await skip.seguirForaDeCena(e, { ...PR, labels: [] }, { head: '', quem: ['ana'] }, ''), true);
  assert.deepEqual(chamadas.map((c) => c.args), [OUTROS, MEUS, POST]);
});
```

- [ ] **Passo 2:** rodar só este arquivo contra o código de hoje.

```
node --test test/postagem-coordenacao-desligada.test.js
```

Esperado: 9 testes passando. Este é um teste de caracterização, então ele não tem fase vermelha: se algum reprovar, a expectativa escrita não bate com o código de hoje. Corrija a EXPECTATIVA para o que o código faz hoje (o objetivo é travar o presente), registre a diferença no EXECUCAO.md e só então siga.

- [ ] **Passo 3 (contraprova):** em `lib/engine/decision.js`, dentro de `postReviewOnce`, troque `fs.writeFileSync(file, JSON.stringify(payload, null, 2));` por `fs.writeFileSync(file, JSON.stringify(payload));`. Rode `node --test test/postagem-coordenacao-desligada.test.js`: reprova `postReview: APPROVE ancorado...` e os seguintes, por diferença no `conteudo`. Restaure com `git checkout lib/engine/decision.js` e rode de novo: verde.

- [ ] **Passo 4:** commit.

```
git add test/postagem-coordenacao-desligada.test.js
git commit -m "test: caracteriza as chamadas ao gh das vias de postagem com a coordenação desligada"
```

---

## Tarefa 2: constantes de tempo e três ajustes no coordenador

**Arquivos:**
- editar `lib/constants.js`, objeto `TEMPOS`, logo depois de `SINAL_REVISAO_TTL_MS: HORA_MS,` (linha 317);
- editar `lib/sync/coordinator.js`: `noopHandle` (82-86), `gravarRecibo` (302-311), `createHandle` (linha 360, `h.valido = ...`);
- criar `test/sync-coordinator-postagem.test.js`.

**Interfaces:**
- `TEMPOS.POSTAGEM_RECONCILIACAO_ESPERA_MS` (60 s) e `TEMPOS.POSTAGEM_MARGEM_POSSE_MS` (15 s).
- `handle.validoPor(margemMs)`: `true` só se o lease não foi perdido e `agora + margemMs < validade conhecida`. No `noopHandle`, sempre `true`.
- `gravarRecibo`: ao sobrescrever um recibo antigo por etag, preserva o filho `postagens` que já estava no nó. Sem isso, o `complete()` da revisão automática apagaria o registro remoto `enviando` ou `confirmada` que a arbitragem gravou no mesmo nó.

- [ ] **Passo 1:** escrever o teste que falha.

```js
// Três ajustes do coordenador que a arbitragem de postagem (CT-POST) consome: a posse com
// margem (validoPor), o noop que não barra quem não ligou a coordenação e o recibo que
// não apaga o registro de postagem gravado no mesmo nó.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-coord-postagem-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { SYNC, TEMPOS } from '../lib/constants.js';
import { accountHash, prHash, operationFingerprint } from '../lib/sync/keys.js';

const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const { admit, noopHandle } = await import('../lib/sync/coordinator.js');

const TOKEN = 'tok-ok';
const AGORA = 1_800_000_000_000;
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const PR_KEY = 'Org/Repo#7';
const IDS = { uid: 'u1', accountHash: accountHash('Eu'), prHash: prHash(PR_KEY) };
const FP = operationFingerprint('review', HEAD);
let fake;

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => {
  await fake.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { fake.setTree(null); });

function motor() {
  const rt = {
    status: 'conectado', lastError: null, uid: 'u1', deviceId: 'dEu', deviceName: 'Notebook',
    client: createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: TOKEN }) }),
    devices: {}, leasesVistos: {}, recibosVistos: {}, espera: {}, relogio: AGORA,
  };
  rt.agora = () => rt.relogio;
  return {
    config: { sync: { enabled: true, coordination: { enabled: true }, consolidation: { enabled: false } } },
    sync: rt, logs: [], log(n, m) { this.logs.push([n, m]); }, markSeen() { }, cancelSession() { },
    async myReviewStates() { return []; }, accountForPr: () => 'Eu', async headSha() { return HEAD; },
  };
}

function ctx() {
  const pr = { key: PR_KEY, repo: 'Org/Repo', number: 7, account: 'Eu' };
  return { prKey: PR_KEY, account: 'Eu', materialVersion: HEAD, headSha: HEAD, contaRodada: false, manual: false, semCoordenacao: false, ignorarRecibo: false, pr, operationKind: 'review', opId: '' };
}

function noDoRecibo() {
  return fake.tree().users.u1.receipts[IDS.accountHash][IDS.prHash][FP];
}

test('validoPor exige folga até o vencimento; valido() continua sem folga', async () => {
  const e = motor();
  const a = await admit(e, ctx());
  assert.equal(a.admitted, true);
  e.sync.relogio = AGORA + SYNC.LEASE_TTL_MS - 10_000;
  assert.equal(a.handle.valido(), true);
  assert.equal(a.handle.validoPor(0), true);
  assert.equal(a.handle.validoPor(TEMPOS.POSTAGEM_MARGEM_POSSE_MS), false);
  await a.handle.abort();
});

test('noopHandle: validoPor nunca barra quem não tem lease', () => {
  assert.equal(noopHandle().validoPor(TEMPOS.POSTAGEM_MARGEM_POSSE_MS), true);
});

test('complete sobre nó que só tinha o registro de postagem: grava o recibo e preserva postagens', async () => {
  const registro = { estado: 'confirmada', tentativaId: 't1', intencaoEm: AGORA, atualizadoEm: AGORA, head: HEAD, evento: 'APPROVE' };
  fake.setTree({ users: { u1: { receipts: { [IDS.accountHash]: { [IDS.prHash]: { [FP]: { postagens: { APPROVE: registro } } } } } } } });
  const e = motor();
  const a = await admit(e, ctx());
  assert.equal(a.admitted, true, 'nó sem outcome não bloqueia a admissão');
  assert.equal((await a.handle.complete({ publicationState: 'published' })).ok, true);
  const no = noDoRecibo();
  assert.equal(no.outcome, 'completed');
  assert.equal(no.publicationState, 'published');
  assert.deepEqual(no.postagens.APPROVE, registro);
});

test('as constantes da arbitragem existem e têm a ordem certa', () => {
  assert.equal(TEMPOS.POSTAGEM_RECONCILIACAO_ESPERA_MS, 60_000);
  assert.ok(TEMPOS.POSTAGEM_MARGEM_POSSE_MS > 0 && TEMPOS.POSTAGEM_MARGEM_POSSE_MS < SYNC.HEARTBEAT_MS);
});
```

- [ ] **Passo 2:** rodar `node --test test/sync-coordinator-postagem.test.js`. Esperado: 4 reprovações (`a.handle.validoPor is not a function`, `noopHandle(...).validoPor is not a function`, `postagens` indefinido no recibo, constante indefinida).

- [ ] **Passo 3:** implementar. Em `lib/constants.js`, depois de `SINAL_REVISAO_TTL_MS: HORA_MS,`:

```js
  // Arbitragem de postagem entre aparelhos (CT-POST, lib/engine/postagem-arbitragem.js).
  // Uma postagem INCERTA só é dada como não enviada com duas leituras da lista de reviews
  // separadas por esta janela e ambas começando esta janela depois da intenção.
  POSTAGEM_RECONCILIACAO_ESPERA_MS: HORA_MS / 60,
  // Folga exigida entre agora e o vencimento da posse antes de cada envio: o POST não sai
  // com uma posse que venceria durante o próprio gh. Metade do batimento do lease.
  POSTAGEM_MARGEM_POSSE_MS: 15 * 1000,
```

Em `lib/sync/coordinator.js`, no `noopHandle`, troque `valido: () => true, onLost() {},` por `valido: () => true, validoPor: () => true, onLost() {},`.

Troque o fim de `gravarRecibo`:

```js
  if (recenteDemais(lido.receipt, nowMs)) return { ok: true };
  const w2 = await writeReceipt(dados.client, dados.ids, dados.fingerprint, recibo, { ifMatch: lido.etag });
  return w2.ok ? { ok: true } : falhaDe(w2);
}
```

por:

```js
  if (recenteDemais(lido.receipt, nowMs)) return { ok: true };
  const w2 = await writeReceipt(dados.client, dados.ids, dados.fingerprint, comPostagens(recibo, lido.receipt), { ifMatch: lido.etag });
  return w2.ok ? { ok: true } : falhaDe(w2);
}

// O registro de postagem (lib/engine/registro-postagem.js) mora no filho `postagens` deste
// mesmo nó. Sobrescrever o recibo sem carregar o filho apagaria um `enviando` que outro
// aparelho precisa ver para não postar por cima (CT-POST).
function comPostagens(recibo, anterior) {
  if (!ehObjeto(anterior) || !ehObjeto(anterior.postagens)) return recibo;
  return { ...recibo, postagens: anterior.postagens };
}
```

Em `createHandle`, logo depois de `h.valido = () => !h.lost && rt.agora() < estado.expiraEm;`:

```js
  // CT-POST, passo 4: a última conferência antes de cada POST exige folga, não só validade
  h.validoPor = (margemMs) => !h.lost && rt.agora() + (Number(margemMs) || 0) < estado.expiraEm;
```

- [ ] **Passo 4:** rodar `node --test test/sync-coordinator-postagem.test.js test/sync-coordinator.test.js test/sync-constants.test.js`. Esperado: verde.

- [ ] **Passo 5 (contraprova):** em `gravarRecibo`, troque `comPostagens(recibo, lido.receipt)` por `recibo`. Rode `node --test test/sync-coordinator-postagem.test.js`: reprova `complete sobre nó que só tinha o registro de postagem` (`no.postagens` indefinido). Restaure e rode: verde.

- [ ] **Passo 6:** commit.

```
git add lib/constants.js lib/sync/coordinator.js test/sync-coordinator-postagem.test.js
git commit -m "feat(sync): posse com margem e recibo que preserva o registro de postagem"
```

---

## Tarefa 3: posse de postagem

**Arquivos:** criar `lib/sync/posse-postagem.js` e `test/sync-posse-postagem.test.js`.

**Interfaces:** `async function adquirirPosseDePostagem(engine, { prKey, account, headSha })` devolve `{ ok: true, handle }` ou `{ ok: false, motivo }`, com `motivo` em `'coordenacao-indisponivel' | 'posse-alheia'`. Lease em `/users/{uid}/leases/{accountHash}/{prHash}` com `operationKind: 'post'`. O handle é o de `createHandle` (com `validoPor` e `abort`).

- [ ] **Passo 1:** escrever o teste que falha.

```js
// Posse de postagem (CT-POST, passo 1): o MESMO lease das análises, tipo 'post'.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-posse-postagem-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { TEMPOS } from '../lib/constants.js';
import { accountHash, prHash } from '../lib/sync/keys.js';

const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const { adquirirPosseDePostagem } = await import('../lib/sync/posse-postagem.js');

const TOKEN = 'tok-ok';
const AGORA = 1_800_000_000_000;
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const PR_KEY = 'o/r#1';
const AH = accountHash('eu');
const PH = prHash(PR_KEY);
const CTX = { prKey: PR_KEY, account: 'eu', headSha: HEAD };
let fake;

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => {
  await fake.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; });

function motor(status = 'conectado', deviceId = 'dEu') {
  const rt = {
    status, uid: 'u1', deviceId, relogio: AGORA,
    client: createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: TOKEN }) }),
  };
  rt.agora = () => rt.relogio;
  return { sync: rt, log() { }, cancelSession() { } };
}

function leaseNoBanco() {
  const t = fake.tree();
  return t && t.users && t.users.u1.leases && t.users.u1.leases[AH] && t.users.u1.leases[AH][PH];
}

test('PR livre: pega o lease com tipo post e devolve handle válido', async () => {
  const p = await adquirirPosseDePostagem(motor(), CTX);
  assert.equal(p.ok, true);
  assert.equal(leaseNoBanco().operationKind, 'post');
  assert.equal(leaseNoBanco().deviceId, 'dEu');
  assert.equal(leaseNoBanco().headSha, HEAD);
  assert.equal(p.handle.validoPor(TEMPOS.POSTAGEM_MARGEM_POSSE_MS), true);
  await p.handle.abort();
  assert.equal(leaseNoBanco(), undefined, 'abort devolve o lease');
});

test('lease vivo de outro aparelho (qualquer tipo): posse-alheia e o lease dele fica', async () => {
  const outro = { leaseId: 'LO', deviceId: 'dOutro', operationKind: 'review', headSha: HEAD, acquiredAt: AGORA, heartbeatAt: AGORA, expiresAt: AGORA + 60_000, farolVersion: '9.9.9' };
  fake.setTree({ users: { u1: { leases: { [AH]: { [PH]: outro } } } } });
  assert.deepEqual(await adquirirPosseDePostagem(motor(), CTX), { ok: false, motivo: 'posse-alheia' });
  assert.equal(leaseNoBanco().leaseId, 'LO');
});

test('dois aparelhos disputando ao mesmo tempo: só um fica com a posse', async () => {
  const [pa, pb] = await Promise.all([adquirirPosseDePostagem(motor(), CTX), adquirirPosseDePostagem(motor('conectado', 'dOutro'), CTX)]);
  assert.equal([pa, pb].filter((p) => p.ok).length, 1);
  for (const p of [pa, pb]) if (p.ok) await p.handle.abort();
});

test('fora de conectado, sem head ou sem conta: indisponível sem tocar a rede', async () => {
  assert.deepEqual(await adquirirPosseDePostagem(motor('erro'), CTX), { ok: false, motivo: 'coordenacao-indisponivel' });
  assert.deepEqual(await adquirirPosseDePostagem(motor(), { ...CTX, headSha: '' }), { ok: false, motivo: 'coordenacao-indisponivel' });
  assert.deepEqual(await adquirirPosseDePostagem(motor(), { ...CTX, account: '' }), { ok: false, motivo: 'coordenacao-indisponivel' });
  assert.equal(fake.requests.length, 0);
});
```

- [ ] **Passo 2:** rodar `node --test test/sync-posse-postagem.test.js`. Esperado: reprova com `Cannot find module` apontando `lib/sync/posse-postagem.js`.

- [ ] **Passo 3:** criar `lib/sync/posse-postagem.js`.

```js
// Posse de POSTAGEM entre aparelhos (CT-POST, passo 1). É o MESMO lease das análises
// (/leases/{conta}/{pr}), com operationKind 'post': não existe lock separado por via. A
// revisão automática que segura o lease da sessão exclui o clique, o reenvio, o chat e a
// co-assinatura do mesmo PR, e cada uma dessas exclui as outras.
//
// O handle devolvido é o do coordenador: batimento, validoPor (a última conferência antes
// do POST) e abort. A impressão digital é a da revisão daquele head, porque é o recibo dela
// que guarda o registro de postagem; o handle de postagem nunca chama complete.
//
// Nada aqui lança: recusa volta como { ok: false, motivo }.
import { APP_VERSION } from '../paths.js';
import { accountHash, prHash, operationFingerprint, novoId } from './keys.js';
import { acquireLease } from './lease.js';
import { createHandle } from './coordinator.js';

const CONECTADO = 'conectado';

function recusa(motivo) {
  return { ok: false, motivo };
}

function idsDe(rt, c) {
  const ph = prHash(c.prKey);
  if (!ph || !String(c.account || '').trim() || !c.headSha) return null;
  return { uid: rt.uid, accountHash: accountHash(c.account), prHash: ph };
}

async function tentarLease(rt, ids, c) {
  const dados = { leaseId: novoId(), deviceId: rt.deviceId, operationKind: 'post', headSha: c.headSha, nowMs: rt.agora(), farolVersion: APP_VERSION };
  try {
    const a = await acquireLease(rt.client, ids, dados);
    return { a, leaseId: dados.leaseId };
  } catch {
    return { a: { ok: false, reason: 'indisponivel' }, leaseId: '' };
  }
}

async function adquirirPosseDePostagem(engine, ctx) {
  const rt = engine && engine.sync;
  if (!rt || rt.status !== CONECTADO || !rt.client) return recusa('coordenacao-indisponivel');
  const c = ctx || {};
  const ids = idsDe(rt, c);
  if (!ids) return recusa('coordenacao-indisponivel');
  const { a, leaseId } = await tentarLease(rt, ids, c);
  if (!a.ok && a.reason === 'alheio') return recusa('posse-alheia');
  if (!a.ok) return recusa('coordenacao-indisponivel');
  const handle = createHandle(engine, {
    ids, fingerprint: operationFingerprint('review', c.headSha), leaseId, attemptId: '',
    ctx: { prKey: c.prKey, operationKind: 'post', materialVersion: c.headSha, opId: '' }, expiresAt: a.lease.expiresAt,
  });
  return { ok: true, handle };
}

export default { adquirirPosseDePostagem };
export { adquirirPosseDePostagem };
```

- [ ] **Passo 4:** rodar `node --test test/sync-posse-postagem.test.js test/sync-coordinator.test.js`. Esperado: verde.

- [ ] **Passo 5 (contraprova):** em `tentarLease`, troque `operationKind: 'post'` por `operationKind: 'review'`. Rode `node --test test/sync-posse-postagem.test.js`: reprova `PR livre: pega o lease com tipo post`. Restaure e rode: verde.

- [ ] **Passo 6:** commit.

```
git add lib/sync/posse-postagem.js test/sync-posse-postagem.test.js
git commit -m "feat(sync): posse de postagem no mesmo lease das análises"
```

---

## Tarefa 4: registro de postagem (local e remoto)

**Arquivos:** criar `lib/engine/registro-postagem.js` e `test/registro-postagem.test.js`.

**Interfaces** (todas nomeadas; o `ctx` é sempre `{ account, prKey, head, evento }`):
- `async lerRegistro(engine, ctx)` devolve `{ ok, local, remoto, efetivo }` ou `{ ok: false, motivo: 'registro-indisponivel', local }`.
- `async gravarIntencao(engine, ctx, registro)` devolve `{ ok: true }` ou `{ ok: false, motivo }`. Grava local primeiro e remoto depois por CAS; se o remoto falha, a cópia local vira `nao_enviada` (seguro, porque nenhum `io.run` foi chamado).
- `async gravarDesfecho(engine, ctx, tentativaId, campos, opcoes)` devolve `{ ok, local, remoto }`. Com `opcoes.remotoPrimeiro`, só grava o local se o remoto deu certo.
- `estadoEfetivo(local, remoto)`, PURA.
- Auxiliares: `observarRemoto`, `gravarLeituras`, `listarIncertos`, `adotarLocal`, `marcarPublicado`, `hashDoPayload`, `agoraDe`, `arquivoDePostagens`, `chaveDoRegistro`.
- Caminho remoto: `/users/{uid}/receipts/{accountHash}/{prHash}/review_<32 hex do head>/postagens/{EVENTO}`.
- Campos remotos (allowlist): `estado, tentativaId, intencaoEm, atualizadoEm, deviceId, via, evento, head, payloadHash, recusados, reviewId, commitId, motivo`. Conta e PR nunca sobem em texto.

- [ ] **Passo 1:** escrever o teste que falha.

```js
// Registro de postagem (CT-POST, passos 3 e 5): cópia local atômica e cópia remota no
// recibo da revisão daquele head. O que vale quando as duas divergem é estadoEfetivo.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-registro-postagem-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { accountHash, prHash, operationFingerprint } from '../lib/sync/keys.js';

const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const registro = await import('../lib/engine/registro-postagem.js');

const TOKEN = 'tok-ok';
const AGORA = 1_800_000_000_000;
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const CTX = { account: 'eu', prKey: 'o/r#1', head: HEAD, evento: 'APPROVE' };
let fake;
let n = 0;

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => {
  await fake.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { fake.setTree(null); });

function aparelho(token = TOKEN) {
  n++;
  const rt = { status: 'conectado', uid: 'u1', deviceId: `d${n}`, relogio: AGORA, client: createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: token }) }) };
  rt.agora = () => rt.relogio;
  return { sync: rt, logs: [], log(nv, m) { this.logs.push(`${nv} ${m}`); }, postagensArquivo: path.join(FAROL_HOME, `postagens-${n}.json`) };
}

function intencao(extra = {}) {
  return { estado: 'enviando', tentativaId: 't1', intencaoEm: AGORA, atualizadoEm: AGORA, deviceId: 'd1', via: 'clique', evento: 'APPROVE', head: HEAD, payloadHash: 'h1', reviewId: '', commitId: '', motivo: '', leiturasVazias: [], ...extra };
}

function remotoNoBanco() {
  const fp = operationFingerprint('review', HEAD);
  const t = fake.tree();
  const no = t && t.users.u1.receipts[accountHash('eu')][prHash('o/r#1')][fp];
  return no && no.postagens && no.postagens.APPROVE;
}

test('estadoEfetivo: mesma tentativa, o desfecho vence o enviando', () => {
  const env = intencao();
  const conf = intencao({ estado: 'confirmada', atualizadoEm: AGORA - 5 });
  assert.equal(registro.estadoEfetivo(env, conf).estado, 'confirmada');
  assert.equal(registro.estadoEfetivo(conf, env).estado, 'confirmada');
});

test('estadoEfetivo: tentativas diferentes, vence a intenção mais nova', () => {
  const velha = intencao({ estado: 'nao_enviada', tentativaId: 't0', intencaoEm: AGORA - 1000 });
  const nova = intencao({ tentativaId: 't2', intencaoEm: AGORA });
  assert.equal(registro.estadoEfetivo(velha, nova).tentativaId, 't2');
  assert.equal(registro.estadoEfetivo(nova, velha).tentativaId, 't2');
});

test('estadoEfetivo: registro remoto ilegível só restringe (CT-FIO)', () => {
  const localLivre = intencao({ estado: 'nao_enviada', intencaoEm: AGORA + 999 });
  const ilegivel = { estado: 'enviando', tentativaId: '', intencaoEm: Number.NaN, invalido: true };
  assert.equal(registro.estadoEfetivo(localLivre, ilegivel).estado, 'enviando');
  assert.equal(registro.estadoEfetivo(null, null), null);
});

test('gravarIntencao: grava as duas cópias, e o remoto não leva conta nem PR em texto', async () => {
  const e = aparelho();
  assert.deepEqual(await registro.gravarIntencao(e, CTX, intencao()), { ok: true });
  const remoto = remotoNoBanco();
  assert.equal(remoto.estado, 'enviando');
  assert.equal(remoto.tentativaId, 't1');
  assert.equal(JSON.stringify(remoto).includes('o/r#1'), false);
  assert.equal(JSON.stringify(remoto).includes('"eu"'), false);
  assert.equal(remoto.leiturasVazias, undefined, 'as leituras da reconciliação são só locais');
  const lido = await registro.lerRegistro(e, CTX);
  assert.equal(lido.ok, true);
  assert.equal(lido.local.estado, 'enviando');
  assert.equal(lido.efetivo.estado, 'enviando');
});

test('gravarIntencao com o banco recusando: não autoriza o envio e a cópia local vira nao_enviada', async () => {
  const e = aparelho('tok-errado');
  const r = await registro.gravarIntencao(e, CTX, intencao());
  assert.deepEqual(r, { ok: false, motivo: 'registro-indisponivel' });
  const local = JSON.parse(fs.readFileSync(e.postagensArquivo, 'utf8'));
  assert.equal(Object.values(local)[0].estado, 'nao_enviada');
});

test('gravarIntencao com outra tentativa em enviando no banco: registro-concorrente', async () => {
  const a = aparelho();
  const b = aparelho();
  await registro.gravarIntencao(a, CTX, intencao());
  const r = await registro.gravarIntencao(b, CTX, intencao({ tentativaId: 't9', deviceId: 'd9' }));
  assert.deepEqual(r, { ok: false, motivo: 'registro-concorrente' });
  assert.equal(remotoNoBanco().tentativaId, 't1');
});

test('gravarDesfecho: confirmada nas duas cópias', async () => {
  const e = aparelho();
  await registro.gravarIntencao(e, CTX, intencao());
  const r = await registro.gravarDesfecho(e, CTX, 't1', { estado: 'confirmada', reviewId: '77' });
  assert.equal(r.ok, true);
  assert.equal(remotoNoBanco().estado, 'confirmada');
  assert.equal(remotoNoBanco().reviewId, '77');
  assert.equal((await registro.lerRegistro(e, CTX)).efetivo.estado, 'confirmada');
});

test('gravarDesfecho não sobrescreve no banco o enviando de outra tentativa', async () => {
  const a = aparelho();
  const b = aparelho();
  await registro.gravarIntencao(a, CTX, intencao());
  await registro.gravarDesfecho(b, CTX, 'outra', { estado: 'nao_enviada', motivo: 'x' });
  assert.equal(remotoNoBanco().estado, 'enviando');
  assert.equal(remotoNoBanco().tentativaId, 't1');
});

test('gravarDesfecho com remotoPrimeiro e banco fora: não toca a cópia local', async () => {
  const e = aparelho();
  await registro.gravarIntencao(e, CTX, intencao());
  e.sync.client = createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: 'tok-errado' }) });
  const r = await registro.gravarDesfecho(e, CTX, 't1', { estado: 'nao_enviada' }, { remotoPrimeiro: true });
  assert.deepEqual(r, { ok: false, local: false, remoto: false });
  assert.equal(registro.listarIncertos(e).length, 1);
});

test('cada aparelho tem o próprio arquivo local; o banco é o que eles dividem', async () => {
  const a = aparelho();
  const b = aparelho();
  await registro.gravarIntencao(a, CTX, intencao());
  assert.equal(registro.listarIncertos(b).length, 0);
  const lidoB = await registro.lerRegistro(b, CTX);
  assert.equal(lidoB.local, null);
  assert.equal(lidoB.efetivo.estado, 'enviando');
  registro.observarRemoto(b, CTX, lidoB.remoto);
  assert.equal(registro.listarIncertos(b).length, 1);
});
```

- [ ] **Passo 2:** rodar `node --test test/registro-postagem.test.js`. Esperado: reprova com `Cannot find module` apontando `lib/engine/registro-postagem.js`.

- [ ] **Passo 3:** criar `lib/engine/registro-postagem.js`.

```js
// Registro durável de cada tentativa de postar APPROVE ou REQUEST_CHANGES com a
// coordenação entre aparelhos ligada (CT-POST, passos 3 e 5, e a reconciliação). Duas
// cópias com papéis diferentes:
//   - LOCAL, em state/postagens.json, gravada de forma atômica: sobrevive a banco fora do
//     ar e a reinício, e é a lista que a reconciliação percorre;
//   - REMOTA, no filho postagens/{EVENTO} do recibo da revisão daquele head: é o que faz
//     outro aparelho enxergar um `enviando` e não postar por cima.
//
// Estados: enviando (a tentativa pode ter alcançado a rede; lido como INCERTO), confirmada,
// recusada e nao_enviada. Só nao_enviada, ou nenhum registro, autoriza tentar de novo;
// recusada autoriza apenas um texto que ainda não foi recusado.
//
// O remoto leva só o que o recibo já expõe: head em claro, ids de aparelho e de tentativa,
// horários, hashes de payload e o id do review. Conta e PR nunca sobem em texto, porque o
// caminho já é o hash dos dois (lib/sync/keys.js).
//
// Nada aqui lança: falha de disco ou de banco volta como { ok: false }.
import path from 'node:path';
import crypto from 'node:crypto';
import { STATE_DIR } from '../paths.js';
import { readJson, writeJsonAtomic, safeStringify } from '../io.js';
import { accountHash, prHash, operationFingerprint, canonicalPrKey } from '../sync/keys.js';
import { receiptPath } from '../sync/receipts.js';

const ESTADOS = new Set(['enviando', 'confirmada', 'recusada', 'nao_enviada']);
const TERMINAIS = new Set(['confirmada', 'recusada', 'nao_enviada']);
const CAMPOS_REMOTOS = ['estado', 'tentativaId', 'intencaoEm', 'atualizadoEm', 'deviceId', 'via', 'evento', 'head', 'payloadHash', 'recusados', 'reviewId', 'commitId', 'motivo'];
const COM_ETAG = { etag: true };
const INDISPONIVEL = 'registro-indisponivel';
// Recusas da função da C0 que não são falha: coordenação desligada, recibo ainda não
// gravado (co-assinatura, ou postagem antes do desfecho da revisão) e recibo já publicado.
// O farol.log é só de falha (invariante 3), então estas não viram WARN.
const PUBLICACAO_SEM_FALHA = new Set(['coordenacao-desligada', 'sem-recibo', 'inalterado']);

function ehObjeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function logar(engine, msg) {
  if (engine && typeof engine.log === 'function') engine.log('WARN', msg);
}

// Relógio da coordenação quando existe (corrigido pelo servidor do banco), senão o local.
function agoraDe(engine) {
  const rt = engine && engine.sync;
  if (rt && typeof rt.agora === 'function') return rt.agora();
  return Date.now();
}

// O arquivo é por PROCESSO de Farol. `engine.postagensArquivo` existe para a suíte simular
// dois aparelhos no mesmo processo, já que o STATE_DIR é resolvido uma vez no import de
// lib/paths.js; em produção o campo não existe e vale state/postagens.json.
function arquivoDePostagens(engine) {
  return (engine && engine.postagensArquivo) || path.join(STATE_DIR, 'postagens.json');
}

function chaveDoRegistro(ctx) {
  const c = ctx || {};
  return [String(c.account || '').toLowerCase(), canonicalPrKey(c.prKey), String(c.head || '').toLowerCase(), String(c.evento || '').toUpperCase()].join('|');
}

function registroValido(r) {
  return ehObjeto(r) && ESTADOS.has(r.estado) && typeof r.tentativaId === 'string' && Number.isFinite(r.intencaoEm);
}

function hashDoPayload(payload) {
  return crypto.createHash('sha256').update(safeStringify(payload, '')).digest('hex');
}

function lerLocais(engine) {
  const dados = readJson(arquivoDePostagens(engine), {});
  return ehObjeto(dados) ? dados : {};
}

function gravarLocal(engine, ctx, registro) {
  const todos = lerLocais(engine);
  todos[chaveDoRegistro(ctx)] = { ...registro, account: ctx.account, prKey: ctx.prKey, head: ctx.head, evento: ctx.evento };
  try {
    writeJsonAtomic(arquivoDePostagens(engine), todos);
    return true;
  } catch (err) {
    logar(engine, `registro de postagem local não gravado (${ctx.prKey}): ${err.message}`);
    return false;
  }
}

function caminhoRemoto(rt, ctx) {
  const fp = operationFingerprint('review', ctx.head);
  return `${receiptPath(rt.uid, accountHash(ctx.account), prHash(ctx.prKey), fp)}/postagens/${String(ctx.evento).toUpperCase()}`;
}

function paraRemoto(registro) {
  const saida = {};
  for (const campo of CAMPOS_REMOTOS) {
    if (registro[campo] !== undefined) saida[campo] = registro[campo];
  }
  return saida;
}

// CT-FIO: o que chega pelo banco só restringe. Registro remoto ilegível não autoriza nada:
// vira `enviando` sem prova, e a reconciliação decide a partir de quando ele foi visto.
function normalizarRemoto(data) {
  if (data === null || data === undefined) return null;
  if (registroValido(data)) return data;
  return { estado: 'enviando', tentativaId: '', intencaoEm: Number.NaN, invalido: true };
}

function carimbo(r, campo) {
  const v = Number(r[campo]);
  return Number.isFinite(v) ? v : 0;
}

function desempateDaMesmaTentativa(a, b) {
  const aTerminal = TERMINAIS.has(a.estado);
  if (aTerminal !== TERMINAIS.has(b.estado)) return aTerminal ? a : b;
  return carimbo(a, 'atualizadoEm') >= carimbo(b, 'atualizadoEm') ? a : b;
}

// PURA: qual das duas cópias vale. Remoto ilegível vence sempre (só restringe). Mesma
// tentativa: desfecho vence `enviando`, e entre dois desfechos vence o mais recente.
// Tentativas diferentes: vence a intenção mais nova.
function estadoEfetivo(local, remoto) {
  if (!local) return remoto || null;
  if (!remoto) return local;
  if (remoto.invalido) return remoto;
  if (local.tentativaId === remoto.tentativaId) return desempateDaMesmaTentativa(local, remoto);
  return carimbo(local, 'intencaoEm') >= carimbo(remoto, 'intencaoEm') ? local : remoto;
}

async function lerRegistro(engine, ctx) {
  const cru = lerLocais(engine)[chaveDoRegistro(ctx)];
  const local = registroValido(cru) ? cru : null;
  const rt = engine && engine.sync;
  if (!rt || !rt.client) return { ok: false, motivo: INDISPONIVEL, local };
  try {
    const lido = await rt.client.get(caminhoRemoto(rt, ctx), COM_ETAG);
    if (!lido.ok) return { ok: false, motivo: INDISPONIVEL, local };
    const remoto = normalizarRemoto(lido.data);
    return { ok: true, local, remoto, efetivo: estadoEfetivo(local, remoto) };
  } catch {
    return { ok: false, motivo: INDISPONIVEL, local };
  }
}

// Leitura com etag e escrita condicionada a ele: `aceita` diz se o que está no banco pode
// ser substituído. Nenhum aparelho sem posse escreve aqui, e o CAS cobre o resto.
async function escreverRemoto(engine, ctx, registro, aceita) {
  const rt = engine && engine.sync;
  if (!rt || !rt.client) return { ok: false, motivo: INDISPONIVEL };
  try {
    const caminho = caminhoRemoto(rt, ctx);
    const lido = await rt.client.get(caminho, COM_ETAG);
    if (!lido.ok) return { ok: false, motivo: INDISPONIVEL };
    if (!aceita(normalizarRemoto(lido.data))) return { ok: false, motivo: 'registro-concorrente' };
    const w = await rt.client.put(caminho, paraRemoto(registro), { ifMatch: lido.etag || 'null_etag' });
    return w.ok ? { ok: true } : { ok: false, motivo: INDISPONIVEL };
  } catch {
    return { ok: false, motivo: INDISPONIVEL };
  }
}

async function gravarIntencao(engine, ctx, registro) {
  if (!gravarLocal(engine, ctx, registro)) return { ok: false, motivo: INDISPONIVEL };
  const aceita = (r) => !r || r.tentativaId === registro.tentativaId || (r.estado !== 'enviando' && !r.invalido);
  const w = await escreverRemoto(engine, ctx, registro, aceita);
  if (w.ok) return { ok: true };
  gravarLocal(engine, ctx, { ...registro, estado: 'nao_enviada', motivo: w.motivo, atualizadoEm: agoraDe(engine) });
  return { ok: false, motivo: w.motivo };
}

async function gravarDesfecho(engine, ctx, tentativaId, campos, opcoes) {
  const atual = lerLocais(engine)[chaveDoRegistro(ctx)];
  const mesma = registroValido(atual) && atual.tentativaId === tentativaId;
  const base = mesma ? atual : { tentativaId, intencaoEm: agoraDe(engine), evento: ctx.evento, head: ctx.head };
  const registro = { ...base, ...campos, atualizadoEm: agoraDe(engine) };
  const aceita = (r) => !r || r.invalido || r.tentativaId === tentativaId || r.estado !== 'enviando';
  if (opcoes && opcoes.remotoPrimeiro) {
    const primeiro = await escreverRemoto(engine, ctx, registro, aceita);
    if (!primeiro.ok) return { ok: false, local: false, remoto: false };
    const gravou = gravarLocal(engine, ctx, registro);
    return { ok: gravou, local: gravou, remoto: true };
  }
  const local = gravarLocal(engine, ctx, registro);
  const remoto = await escreverRemoto(engine, ctx, registro, aceita);
  return { ok: local && remoto.ok, local, remoto: remoto.ok };
}

// Cópia local de um `enviando` visto no banco (de outro aparelho, ou de uma vida anterior
// deste): é o que põe a dúvida na lista da reconciliação daqui.
function observarRemoto(engine, ctx, remoto) {
  const intencaoEm = Number.isFinite(remoto.intencaoEm) ? remoto.intencaoEm : agoraDe(engine);
  const tentativaId = remoto.tentativaId || 'remoto-ilegivel';
  return gravarLocal(engine, ctx, { ...remoto, tentativaId, intencaoEm, leiturasVazias: [], origem: 'remoto' });
}

function gravarLeituras(engine, ctx, leituras) {
  const atual = lerLocais(engine)[chaveDoRegistro(ctx)];
  if (!registroValido(atual)) return false;
  return gravarLocal(engine, ctx, { ...atual, leiturasVazias: leituras });
}

function listarIncertos(engine) {
  return Object.values(lerLocais(engine)).filter((r) => registroValido(r) && r.estado === 'enviando');
}

function adotarLocal(engine, ctx, efetivo) {
  return gravarLocal(engine, ctx, { ...efetivo });
}

// Passo 7 de CT-POST: `confirmada` marca o recibo daquele head como publicado, pela função
// única da C0. Import tardio de propósito: lib/engine/sync.js alcança o coordenador, que
// alcança lib/engine/decision.js, que importa a arbitragem; o import estático fecharia o
// ciclo no carregamento.
async function marcarPublicado(engine, ctx) {
  try {
    const { syncAtualizarPublicacao } = await import('./sync.js');
    const dados = { account: ctx.account, prKey: ctx.prKey, headSha: ctx.head, operationKind: 'review', publicationState: 'published' };
    const r = await syncAtualizarPublicacao(engine, dados);
    if (r && r.ok === false && !PUBLICACAO_SEM_FALHA.has(r.motivo)) logar(engine, `${ctx.prKey}: recibo não marcado como publicado: ${r.motivo || r.code || 'falha'}`);
  } catch (err) {
    logar(engine, `${ctx.prKey}: recibo não marcado como publicado: ${err.message}`);
  }
}

export default {
  lerRegistro, gravarIntencao, gravarDesfecho, estadoEfetivo, observarRemoto, gravarLeituras, listarIncertos,
  adotarLocal, marcarPublicado, hashDoPayload, agoraDe, arquivoDePostagens, chaveDoRegistro,
};
export {
  lerRegistro, gravarIntencao, gravarDesfecho, estadoEfetivo, observarRemoto, gravarLeituras, listarIncertos,
  adotarLocal, marcarPublicado, hashDoPayload, agoraDe, arquivoDePostagens, chaveDoRegistro,
};
```

- [ ] **Passo 4:** rodar `node --test test/registro-postagem.test.js`. Esperado: 10 testes verdes.

- [ ] **Passo 5 (contraprova):** em `estadoEfetivo`, apague a linha `if (remoto.invalido) return remoto;`. Rode `node --test test/registro-postagem.test.js`: reprova `registro remoto ilegível só restringe` (vence o `nao_enviada` local). Restaure e rode: verde.

- [ ] **Passo 6:** commit.

```
git add lib/engine/registro-postagem.js test/registro-postagem.test.js
git commit -m "feat(postagem): registro durável de cada tentativa, local e no recibo do head"
```

---

## Tarefa 5: reconciliação das postagens incertas

**Arquivos:** criar `lib/engine/postagem-reconciliacao.js` e `test/postagem-reconciliacao.test.js`. A prova de ponta a ponta (queda depois do aceite, queda na fronteira) fica na Tarefa 8, depois de o funil existir.

**Interfaces:**
- `async reconciliarPostagensIncertas(engine)` devolve quantos registros saíram de `enviando`. Com a coordenação desligada devolve `0` sem ler nada.
- `leituraConta(registro, inicio)`, PURA: a leitura que começou em `inicio` conta para a regra das duas leituras?
- `provaDaTentativa(registro, review)`, PURA: o review (formato de `myReviewsWithTime`: `{ state, at, commit }`) prova que a tentativa saiu?

- [ ] **Passo 1:** escrever o teste que falha.

```js
// Regras puras da reconciliação de `enviando` (CT-POST): o que prova que a postagem saiu e
// quando uma leitura sem o review conta para concluir que ela não saiu.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-reconciliacao-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPOS } from '../lib/constants.js';

const rec = await import('../lib/engine/postagem-reconciliacao.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });

const T0 = 1_800_000_000_000;
const E = TEMPOS.POSTAGEM_RECONCILIACAO_ESPERA_MS;
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const REG = { estado: 'enviando', tentativaId: 't1', intencaoEm: T0, evento: 'APPROVE', head: HEAD, leiturasVazias: [] };

test('leitura que começa antes da janela depois da intenção não conta', () => {
  assert.equal(rec.leituraConta(REG, T0 + E - 1), false);
  assert.equal(rec.leituraConta(REG, T0 + E), true);
});

test('segunda leitura só conta com a janela inteira depois da primeira', () => {
  const comUma = { ...REG, leiturasVazias: [T0 + E] };
  assert.equal(rec.leituraConta(comUma, T0 + 2 * E - 1), false);
  assert.equal(rec.leituraConta(comUma, T0 + 2 * E), true);
});

test('prova: mesmo veredito, mesmo commit, criado depois da intenção', () => {
  assert.equal(rec.provaDaTentativa(REG, { state: 'APPROVED', commit: HEAD, at: T0 }), true);
  assert.equal(rec.provaDaTentativa(REG, { state: 'APPROVED', commit: HEAD, at: T0 - 1 }), false, 'anterior à intenção');
  assert.equal(rec.provaDaTentativa(REG, { state: 'CHANGES_REQUESTED', commit: HEAD, at: T0 }), false, 'outro veredito');
  assert.equal(rec.provaDaTentativa(REG, { state: 'APPROVED', commit: 'b'.repeat(40), at: T0 }), false, 'outro commit');
  assert.equal(rec.provaDaTentativa(REG, { state: 'APPROVED', commit: HEAD, at: null }), false, 'rascunho sem horário');
});

test('coordenação desligada: nada é lido e nada muda', async () => {
  const e = { syncCoordenacaoAtiva: () => false, postagensArquivo: path.join(FAROL_HOME, 'nao-existe.json') };
  assert.equal(await rec.reconciliarPostagensIncertas(e), 0);
  assert.equal(fs.existsSync(e.postagensArquivo), false);
});
```

- [ ] **Passo 2:** rodar `node --test test/postagem-reconciliacao.test.js`. Esperado: reprova com `Cannot find module` apontando `lib/engine/postagem-reconciliacao.js`.

- [ ] **Passo 3:** criar `lib/engine/postagem-reconciliacao.js`.

```js
// Reconciliação das postagens INCERTAS (CT-POST, "Reconciliação de enviando"). O check()
// chama logo depois do reconcilePending e antes do retryFailedPosts. Para cada registro
// local em `enviando`:
//   - achou review MEU naquele head, com o mesmo veredito, criado depois da intenção:
//     `confirmada`, e o recibo do head passa a publicado;
//   - só conclui `nao_enviada` com DUAS leituras bem-sucedidas da lista de reviews,
//     separadas por TEMPOS.POSTAGEM_RECONCILIACAO_ESPERA_MS e ambas começando pelo menos
//     essa janela depois da intenção, sem o review. A gravação exige posse e vai primeiro
//     ao banco: sem o banco, a dúvida continua;
//   - leitura que falha não conta e mantém a dúvida.
// Enquanto a dúvida dura, o funil recusa qualquer POST daquele head e veredito.
import { TEMPOS } from '../constants.js';
import { adquirirPosseDePostagem } from '../sync/posse-postagem.js';
import { lerRegistro, gravarDesfecho, listarIncertos, gravarLeituras, adotarLocal, marcarPublicado, agoraDe } from './registro-postagem.js';

const ESTADO_NO_GITHUB = { APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED' };

function coordenacaoLigada(engine) {
  return !!engine && typeof engine.syncCoordenacaoAtiva === 'function' && engine.syncCoordenacaoAtiva() === true;
}

// PURA: a leitura que começou em `inicio` conta para a regra das duas leituras?
function leituraConta(registro, inicio) {
  const espera = TEMPOS.POSTAGEM_RECONCILIACAO_ESPERA_MS;
  if (!(inicio >= Number(registro.intencaoEm) + espera)) return false;
  const leituras = Array.isArray(registro.leiturasVazias) ? registro.leiturasVazias : [];
  if (!leituras.length) return true;
  return inicio - Number(leituras[leituras.length - 1]) >= espera;
}

// PURA: este review prova que a tentativa saiu?
function provaDaTentativa(registro, review) {
  if (!review || review.state !== ESTADO_NO_GITHUB[registro.evento]) return false;
  if (review.commit !== registro.head) return false;
  return Number.isFinite(review.at) && review.at >= Number(registro.intencaoEm);
}

function contextoDe(registro) {
  return { account: registro.account, prKey: registro.prKey, head: registro.head, evento: registro.evento };
}

function prDe(registro) {
  const partes = String(registro.prKey || '').split('#');
  return { key: registro.prKey, repo: partes[0], number: parseInt(partes[1], 10), account: registro.account };
}

async function lerReviews(engine, pr) {
  try {
    return await engine.myReviewsWithTime(pr);
  } catch {
    return null;
  }
}

async function confirmar(engine, ctx, registro) {
  await gravarDesfecho(engine, ctx, registro.tentativaId, { estado: 'confirmada', motivo: 'reconciliada-no-github' });
  await marcarPublicado(engine, ctx);
  return true;
}

async function concluirNaoEnviada(engine, ctx, registro) {
  const posse = await adquirirPosseDePostagem(engine, { prKey: ctx.prKey, account: ctx.account, headSha: ctx.head });
  if (!posse.ok) return false;
  try {
    const r = await gravarDesfecho(engine, ctx, registro.tentativaId, { estado: 'nao_enviada', motivo: 'reconciliada-sem-review' }, { remotoPrimeiro: true });
    return r.remoto === true;
  } finally {
    try { await posse.handle.abort(); } catch { /* lease que não sai agora expira sozinho pelo TTL */ }
  }
}

async function reconciliarUm(engine, registro) {
  const ctx = contextoDe(registro);
  const lido = await lerRegistro(engine, ctx);
  if (!lido.ok) return false;
  const ef = lido.efetivo;
  if (ef && !ef.invalido && ef.tentativaId !== registro.tentativaId) {
    adotarLocal(engine, ctx, ef);
    return false;
  }
  if (ef && !ef.invalido && ef.estado !== 'enviando') {
    adotarLocal(engine, ctx, ef);
    return true;
  }
  const inicio = agoraDe(engine);
  const reviews = await lerReviews(engine, prDe(registro));
  if (!Array.isArray(reviews)) return false;
  if (reviews.some((r) => provaDaTentativa(registro, r))) return confirmar(engine, ctx, registro);
  if (!leituraConta(registro, inicio)) return false;
  const anteriores = Array.isArray(registro.leiturasVazias) ? registro.leiturasVazias : [];
  const leituras = [...anteriores, inicio];
  gravarLeituras(engine, ctx, leituras);
  if (leituras.length < 2) return false;
  return concluirNaoEnviada(engine, ctx, registro);
}

async function reconciliarPostagensIncertas(engine) {
  if (!coordenacaoLigada(engine)) return 0;
  let resolvidas = 0;
  for (const registro of listarIncertos(engine)) {
    if (await reconciliarUm(engine, registro)) resolvidas++;
  }
  if (resolvidas && typeof engine.pushState === 'function') engine.pushState();
  return resolvidas;
}

export default { reconciliarPostagensIncertas, leituraConta, provaDaTentativa };
export { reconciliarPostagensIncertas, leituraConta, provaDaTentativa };
```

- [ ] **Passo 4:** rodar `node --test test/postagem-reconciliacao.test.js`. Esperado: 4 testes verdes.

- [ ] **Passo 5 (contraprova):** em `leituraConta`, troque `Number(registro.intencaoEm) + espera` por `Number(registro.intencaoEm)`. Rode o arquivo: reprova `leitura que começa antes da janela depois da intenção não conta`. Restaure e rode: verde.

- [ ] **Passo 6:** commit.

```
git add lib/engine/postagem-reconciliacao.js test/postagem-reconciliacao.test.js
git commit -m "feat(postagem): reconciliação de postagem incerta pela regra das duas leituras"
```

---

## Tarefa 6: arbitragem no funil, helpers de teste e fiação em `decision.js` e `server.js`

**Arquivos:**
- criar `test/helpers/github-reviews-falso.js`, `test/helpers/aparelho-coordenado.js`;
- criar `lib/engine/postagem-arbitragem.js` e `test/postagem-arbitragem.test.js`;
- editar `lib/engine/decision.js`: import depois de `import { TEMPOS } from '../constants.js';` (linha 16); `postReview` (690-701); `postReviewSerial` (703-720); `postReviewOnce` (722-798);
- editar `server.js`: import junto de `import decisionMod from './lib/engine/decision.js';` (linha 37); fachada `async postReview(pr, payload)` (linha 1508) e fachada nova logo abaixo.

**Interfaces:**
- `async arbitrarPostagem(engine, { pr, payload, via, handle, commitIdObrigatorio, recuoPermitido }, enviar)` devolve `{ ok, estado, reviewId, motivo, attempted }`, com `estado` em `'confirmada' | 'recusada' | 'enviando' | 'nao_enviada'`, mais `error`, `deduped`, `blocked` e `issues` quando a camada de baixo os produziu. `enviar(guarda)` é a fila por PR de sempre, recebendo a guarda.
- `postagemCoordenada(engine, payload)`, `postagemCoordenadaLigada(engine)`, `lancarSePossePerdida(post)`, `MOTIVOS`, e o reexport de `reconciliarPostagensIncertas`.
- `postReview(engine, pr, payload, opcoes)` com o terceiro argumento opcional; a fachada da Engine passa a declarar `(pr, payload, opcoes)` (o `test/facades.test.js` compara as aridades e reprovaria sem isso).
- Fachada nova: `reconciliarPostagensIncertas() { return arbitragemMod.reconciliarPostagensIncertas(this); }`.

- [ ] **Passo 1:** criar os dois helpers.

`test/helpers/github-reviews-falso.js`:

```js
// Dublê do endpoint de reviews do GitHub para os testes da arbitragem de postagem. Sem
// efeito colateral no import. Responde às três formas de chamada que o Farol usa:
//   - POST gh api repos/{repo}/pulls/{n}/reviews --input <arquivo>
//   - GET  ... --jq <filtro com == "conta">  (os meus: state, submitted_at, commit_id)
//   - GET  ... --jq <filtro com != "conta">  (dos outros: quem, tipo, state, commit_id)
// O jq não é executado: o dublê já devolve no formato que cada filtro produziria.
// `estado.ocultarNovos` imita o índice atrasado: review postado com a chave ligada não
// aparece na listagem até `revelar()`.
import fs from 'node:fs';

const ESTADO = { APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED', COMMENT: 'COMMENTED' };

export function recusa422() {
  return { ok: false, code: 1, stdout: JSON.stringify({ message: 'Unprocessable Entity', errors: ['commit_id inválido'] }), stderr: 'gh: Unprocessable Entity (HTTP 422)' };
}

export function criarGithubFalso({ conta = 'eu', agora = () => Date.now(), head = () => '' } = {}) {
  const reviews = [];
  const posts = [];
  const estado = { falharLeitura: false, aoPostar: null, ocultarNovos: false, proximoId: 1000 };

  const ok = (stdout) => ({ ok: true, code: 0, stdout, stderr: '' });

  function registrar(payload, user) {
    const review = {
      id: estado.proximoId++, user, state: ESTADO[payload.event] || '', commit_id: payload.commit_id || head(),
      submitted_at: new Date(agora()).toISOString(), oculto: estado.ocultarNovos,
    };
    reviews.push(review);
    return review;
  }

  function postar(args) {
    const payload = JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8'));
    posts.push({ args: [...args], payload });
    const decisao = estado.aoPostar ? estado.aoPostar(payload, posts.length) : 'aceitar';
    if (decisao && typeof decisao === 'object') return Promise.resolve(decisao);
    const review = registrar(payload, conta);
    if (decisao === 'aceitar-e-cair') return Promise.reject(new Error('processo encerrado depois do aceite'));
    return Promise.resolve(ok(JSON.stringify({ id: review.id, state: review.state, commit_id: review.commit_id })));
  }

  function listar(args) {
    if (estado.falharLeitura) return Promise.resolve({ ok: false, code: 1, stdout: '', stderr: 'gh: HTTP 502' });
    const jq = args[args.indexOf('--jq') + 1] || '';
    const visiveis = reviews.filter((r) => !r.oculto);
    if (jq.includes(`== "${conta}"`)) {
      return Promise.resolve(ok(JSON.stringify(visiveis.filter((r) => r.user === conta).map((r) => ({ state: r.state, submitted_at: r.submitted_at, commit_id: r.commit_id })))));
    }
    return Promise.resolve(ok(JSON.stringify(visiveis.filter((r) => r.user !== conta).map((r) => ({ quem: r.user, tipo: 'User', state: r.state, commit_id: r.commit_id })))));
  }

  function run(cmd, args) {
    const a = args || [];
    if (a[0] === 'api' && a.includes('--input')) return postar(a);
    if (a[0] === 'api' && a.includes('--jq')) return listar(a);
    return Promise.resolve(ok(''));
  }

  return {
    run, reviews, posts, estado,
    revelar() { for (const r of reviews) r.oculto = false; },
    adicionarReview({ user, state, commit_id, submitted_at }) {
      reviews.push({ id: estado.proximoId++, user, state, commit_id, submitted_at: submitted_at || new Date(agora()).toISOString(), oculto: false });
    },
  };
}
```

`test/helpers/aparelho-coordenado.js`:

```js
// Monta um "aparelho" para os testes da arbitragem de postagem: uma Engine real com a
// coordenação ligada, o runtime da sincronização já conectado ao dublê do banco e um
// arquivo de registros de postagem próprio. Dois aparelhos no mesmo processo dividem o
// STATE_DIR (resolvido uma vez no import de lib/paths.js), então o que separa o estado
// local de cada um é `postagensArquivo`, exatamente o arquivo que a arbitragem lê.
// Sem import do server.js aqui: quem chama passa a classe, depois de fixar FAROL_HOME.
import fs from 'node:fs';
import path from 'node:path';

export function montarAparelho({ Engine, createRtdbClient, fake, token, deviceId, dir, relogio, conta = 'eu' }) {
  fs.mkdirSync(dir, { recursive: true });
  const e = new Engine();
  e.logs = [];
  e.log = (nivel, msg) => { e.logs.push(`${nivel} ${msg}`); };
  e.accountForPr = () => conta;
  e.tokenFor = () => 'tok-eu';
  e.token = 'tok-eu';
  e.refreshTokens = async () => { };
  e.ghEnv = () => ({});
  e.headSha = async () => relogio.head;
  e.prState = async () => 'OPEN';
  e.saveDecisions = () => { };
  e.pushState = () => { };
  e.writeMemory = () => { };
  e.skipComentado = {};
  e.postagensArquivo = path.join(dir, 'postagens.json');
  e.config.sync = { enabled: true, coordination: { enabled: true }, consolidation: { enabled: false } };
  const rt = {
    status: 'conectado', lastError: null, uid: 'u1', email: '', deviceId, deviceName: deviceId,
    client: createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: token }) }),
    tokenSource: null, skewMs: 0, devices: {}, leasesVistos: {}, recibosVistos: {}, espera: {},
  };
  rt.agora = () => relogio.agora;
  e.sync = rt;
  e.toasts = [];
  e.on('toast', (t) => e.toasts.push(t));
  return e;
}
```

- [ ] **Passo 2:** escrever o teste do funil, que falha.

```js
// A arbitragem no funil (CT-POST), exercitada pelo postReview real de dois "aparelhos"
// com o banco e o GitHub em dublê.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-postagem-arbitragem-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { criarGithubFalso, recusa422 } from './helpers/github-reviews-falso.js';
import { montarAparelho } from './helpers/aparelho-coordenado.js';
import { SYNC } from '../lib/constants.js';

const io = (await import('../lib/io.js')).default;
const { Engine } = await import('../server.js');
const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const { admit } = await import('../lib/sync/coordinator.js');
const { adquirirPosseDePostagem } = await import('../lib/sync/posse-postagem.js');
const registro = await import('../lib/engine/registro-postagem.js');
const { lancarSePossePerdida } = await import('../lib/engine/postagem-arbitragem.js');

const TOKEN = 'tok-ok';
const AGORA = 1_800_000_000_000;
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const HEAD_NOVO = 'b8722a34da5fadb9fda260565f166c977eb5d992';
const PR = { key: 'o/r#1', repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1', author: 'dev', account: 'eu' };
const APPROVE = { event: 'APPROVE', body: 'Leitura atenta, tudo certo por aqui.', comments: [] };
const CTX_REG = { account: 'eu', prKey: PR.key, head: HEAD, evento: 'APPROVE' };
const relogio = { agora: AGORA, head: HEAD };
const runReal = io.run;
let fake;
let gh;
let n = 0;
let handles = [];

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => {
  io.run = runReal;
  await fake.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => {
  fake.setTree(null);
  relogio.agora = AGORA;
  relogio.head = HEAD;
  gh = criarGithubFalso({ conta: 'eu', agora: () => relogio.agora, head: () => relogio.head });
  io.run = (cmd, args, opts) => gh.run(cmd, args, opts);
});
afterEach(async () => {
  for (const h of handles) await h.abort();
  handles = [];
});

function aparelho(deviceId) {
  n++;
  return montarAparelho({ Engine, createRtdbClient, fake, token: TOKEN, deviceId, dir: path.join(FAROL_HOME, `ap-${n}`), relogio });
}

function ctxRevisao() {
  return { prKey: PR.key, account: 'eu', materialVersion: HEAD, headSha: HEAD, contaRodada: false, manual: false, semCoordenacao: false, ignorarRecibo: false, pr: PR, operationKind: 'review', opId: '' };
}

async function revisaoAdmitida(e) {
  const adm = await admit(e, ctxRevisao());
  assert.equal(adm.admitted, true);
  handles.push(adm.handle);
  return adm.handle;
}

test('posse perdida durante a espera na fila por processo: o io.run não é chamado', async () => {
  const a = aparelho('dA');
  const handle = await revisaoAdmitida(a);
  let liberar;
  a.postLanes = new Map([['eu|o/r#1', new Promise((r) => { liberar = r; })]]);
  const promessa = a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'revisao', handle });
  await new Promise((r) => setTimeout(r, 30));
  relogio.agora += SYNC.LEASE_TTL_MS + 1;
  liberar();
  const r = await promessa;
  assert.equal(r.ok, false);
  assert.equal(r.estado, 'nao_enviada');
  assert.equal(r.motivo, 'posse-perdida');
  assert.equal(gh.posts.length, 0);
  assert.equal((await registro.lerRegistro(a, CTX_REG)).efetivo.estado, 'nao_enviada');
});

test('retomada depois de suspensão: posse vencida não posta e nem grava intenção', async () => {
  const a = aparelho('dA');
  const handle = await revisaoAdmitida(a);
  relogio.agora += SYNC.LEASE_TTL_MS + 1;
  const r = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'revisao', handle });
  assert.equal(r.estado, 'nao_enviada');
  assert.equal(r.motivo, 'posse-perdida');
  assert.equal(gh.posts.length, 0);
  assert.equal((await registro.lerRegistro(a, CTX_REG)).efetivo, null);
});

test('lancarSePossePerdida: só posse perdida vira perda de coordenação', () => {
  assert.throws(() => lancarSePossePerdida({ ok: false, estado: 'nao_enviada', motivo: 'posse-perdida' }), (err) => err.coordenacao === 'perdido');
  assert.doesNotThrow(() => lancarSePossePerdida({ ok: false, estado: 'enviando', motivo: 'resultado-incerto' }));
  assert.doesNotThrow(() => lancarSePossePerdida({ ok: true, estado: 'confirmada' }));
});

test('sucesso: confirmada com o id do review, e o lease de postagem volta', async () => {
  const a = aparelho('dA');
  const r = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'clique' });
  assert.equal(r.ok, true);
  assert.equal(r.estado, 'confirmada');
  assert.equal(r.reviewId, '1000');
  assert.equal(gh.posts.length, 1);
  assert.equal((await registro.lerRegistro(a, CTX_REG)).efetivo.estado, 'confirmada');
  const t = fake.tree();
  assert.equal(t.users.u1.leases, undefined, 'posse própria devolvida');
});

test('recusa provada no clique: recusada, e o recuo sem âncora é uma tentativa nova', async () => {
  const a = aparelho('dA');
  gh.estado.aoPostar = (_p, i) => (i === 1 ? recusa422() : null);
  const r = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'clique' });
  assert.equal(r.ok, true);
  assert.equal(gh.posts.length, 2);
  assert.equal(gh.posts[0].payload.commit_id, HEAD);
  assert.equal(gh.posts[1].payload.commit_id, undefined);
});

test('texto já recusado neste commit não é enviado de novo', async () => {
  const a = aparelho('dA');
  gh.estado.aoPostar = () => recusa422();
  const primeira = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'clique', recuoPermitido: false });
  assert.equal(primeira.estado, 'recusada');
  const segunda = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'clique', recuoPermitido: false });
  assert.equal(segunda.estado, 'recusada');
  assert.equal(segunda.motivo, 'recusada-antes');
  assert.equal(gh.posts.length, 1);
});

test('recuoPermitido false: nenhuma segunda chamada depois do 422', async () => {
  const a = aparelho('dA');
  gh.estado.aoPostar = () => recusa422();
  const posse = await adquirirPosseDePostagem(a, { prKey: PR.key, account: 'eu', headSha: HEAD });
  handles.push(posse.handle);
  const r = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'coassinatura', handle: posse.handle, commitIdObrigatorio: HEAD, recuoPermitido: false });
  assert.equal(r.estado, 'recusada');
  assert.equal(gh.posts.length, 1);
});

test('commitIdObrigatorio com head que andou depois da posse: não posta', async () => {
  const a = aparelho('dA');
  const posse = await adquirirPosseDePostagem(a, { prKey: PR.key, account: 'eu', headSha: HEAD });
  handles.push(posse.handle);
  relogio.head = HEAD_NOVO;
  const r = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'coassinatura', handle: posse.handle, commitIdObrigatorio: HEAD, recuoPermitido: false });
  assert.equal(r.estado, 'nao_enviada');
  assert.equal(r.motivo, 'head-mudou');
  assert.equal(gh.posts.length, 0);
});

test('commitIdObrigatorio e payload sem âncora: não posta', async () => {
  const a = aparelho('dA');
  const posse = await adquirirPosseDePostagem(a, { prKey: PR.key, account: 'eu', headSha: HEAD });
  handles.push(posse.handle);
  const r = await a.postReview(PR, { ...APPROVE }, { via: 'coassinatura', handle: posse.handle, commitIdObrigatorio: HEAD, recuoPermitido: false });
  assert.equal(r.motivo, 'ancora-ausente');
  assert.equal(gh.posts.length, 0);
});

test('falha que não prova recusa (502): fica enviando e a próxima tentativa não posta', async () => {
  const a = aparelho('dA');
  gh.estado.aoPostar = () => ({ ok: false, code: 1, stdout: '<html>502</html>', stderr: 'gh: Bad Gateway (HTTP 502)' });
  const r = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'clique' });
  assert.equal(r.estado, 'enviando');
  assert.equal(r.attempted, true);
  gh.estado.aoPostar = null;
  const b = aparelho('dB');
  const outra = await b.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'clique' });
  assert.equal(outra.estado, 'enviando');
  assert.equal(outra.motivo, 'resultado-incerto');
  assert.equal(gh.posts.length, 1);
});

test('myReviewStates indisponível: não enviada por estado desconhecido', async () => {
  const a = aparelho('dA');
  gh.estado.falharLeitura = true;
  const r = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'clique' });
  assert.equal(r.estado, 'nao_enviada');
  assert.equal(r.motivo, 'estado-desconhecido');
  assert.equal(gh.posts.length, 0);
});

test('coordenação ligada e banco recusando: nenhuma via posta, nem com handle', async () => {
  const a = aparelho('dA');
  const handle = await revisaoAdmitida(a);
  a.sync.client = createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: 'tok-errado' }) });
  const comHandle = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'revisao', handle });
  assert.equal(comHandle.estado, 'nao_enviada');
  a.sync.status = 'erro';
  const semHandle = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'clique' });
  assert.equal(semHandle.motivo, 'coordenacao-indisponivel');
  assert.equal(gh.posts.length, 0);
});

test('COMMENT não passa pela arbitragem, mesmo com a coordenação ligada', async () => {
  const a = aparelho('dA');
  const r = await a.postReview(PR, { event: 'COMMENT', body: 'Pergunta sobre o fluxo de retry.', comments: [] }, { via: 'sessao' });
  assert.equal(r.ok, true);
  assert.equal(r.estado, undefined);
  assert.equal(fs.existsSync(a.postagensArquivo), false);
});
```

- [ ] **Passo 3:** rodar `node --test test/postagem-arbitragem.test.js`. Esperado: reprova já no import (`Cannot find module` apontando `lib/engine/postagem-arbitragem.js`).

- [ ] **Passo 4:** criar `lib/engine/postagem-arbitragem.js`.

```js
// Arbitragem de postagem no funil (CT-POST da spec 2026-09-15-operacao-multidispositivo).
// Com a coordenação entre aparelhos LIGADA, toda tentativa de APPROVE ou REQUEST_CHANGES,
// venha de qual via vier (revisão automática, reenvio, clique, chat ou terminal,
// co-assinatura), passa por aqui antes de chegar ao gh. Desligada, o postReview nem chama
// este módulo: o caminho é o de sempre, byte a byte.
//
// Os passos: 1 posse (handle da via ou lease 'post'); 2 releitura DEPOIS da posse e da
// espera na fila (registro do head e myReviewStates no head; null nunca autoriza); 3
// intenção durável antes da rede; 4 última conferência da posse colada no io.run; 5
// desfecho (confirmada, recusada ou, sem prova, enviando); 6 recuo como tentativa nova,
// proibido com recuoPermitido === false; 7 recibo do head como publicado.
//
// Garantia e limite, sem exagero: no máximo uma tentativa em voo por conta, PR e head
// entre os aparelhos que participam, e nenhuma repetição às cegas depois de uma tentativa
// que pode ter alcançado a rede. NÃO é exactly-once: entre a última conferência e o pacote
// sair existe uma janela que código nenhum fecha, e quem a cobre é o `enviando` com a
// reconciliação (lib/engine/postagem-reconciliacao.js).
import { TEMPOS } from '../constants.js';
import io from '../io.js';
import { novoId } from '../sync/keys.js';
import { adquirirPosseDePostagem } from '../sync/posse-postagem.js';
import { normalizeReviewPayload } from './public-review.js';
import { lerRegistro, gravarIntencao, gravarDesfecho, observarRemoto, hashDoPayload, marcarPublicado, agoraDe } from './registro-postagem.js';
import { reconciliarPostagensIncertas } from './postagem-reconciliacao.js';

const EVENTOS_ARBITRADOS = new Set(['APPROVE', 'REQUEST_CHANGES']);
const ESTADO_NO_GITHUB = { APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED' };
const SHA_RE = /^[0-9a-f]{7,40}$/i;

const MOTIVOS = {
  'coordenacao-indisponivel': 'a coordenação entre aparelhos está fora do ar, então nada foi postado',
  'posse-alheia': 'outro aparelho está com este PR agora, então nada foi postado',
  'posse-perdida': 'a posse deste PR venceu antes do envio, então nada foi postado',
  'head-desconhecido': 'não deu para saber o commit atual do PR, então nada foi postado',
  'head-mudou': 'chegou commit novo depois da decisão, então nada foi postado para o commit novo',
  'ancora-ausente': 'a postagem ficou sem a âncora do commit, então nada foi postado',
  'estado-desconhecido': 'não deu para conferir no GitHub se você já tinha se manifestado neste commit, então nada foi postado',
  'registro-indisponivel': 'não deu para gravar a intenção de postar no banco compartilhado, então nada foi postado',
  'registro-concorrente': 'outra tentativa de postagem deste commit está registrada, então nada foi postado',
  'resultado-incerto': 'uma postagem deste commit pode ter chegado ao GitHub e ainda não foi conferida; não posto de novo até conferir',
  'recusada-antes': 'o GitHub já recusou exatamente este texto neste commit; só um texto diferente pode ser postado',
  'recusada-pelo-github': 'o GitHub recusou o conteúdo desta postagem',
};

function postagemCoordenadaLigada(engine) {
  return !!engine && typeof engine.syncCoordenacaoAtiva === 'function' && engine.syncCoordenacaoAtiva() === true;
}

function postagemCoordenada(engine, payload) {
  const evento = String((payload && payload.event) || '').toUpperCase();
  return EVENTOS_ARBITRADOS.has(evento) && postagemCoordenadaLigada(engine);
}

function resultado(estado, motivo) {
  return { ok: false, estado, motivo, attempted: false, reviewId: '', error: MOTIVOS[motivo] || motivo };
}

function naoEnviada(motivo) {
  return resultado('nao_enviada', motivo);
}

function shaValido(v) {
  const s = String(v || '');
  if (!SHA_RE.test(s)) return '';
  return s.toLowerCase();
}

function chaveDoPr(pr) {
  if (pr.key) return pr.key;
  return `${pr.repo}#${pr.number}`;
}

async function headVivo(engine, pr) {
  if (typeof engine.headSha !== 'function') return '';
  try {
    return shaValido(await engine.headSha(pr));
  } catch {
    return '';
  }
}

async function montarContexto(engine, opts) {
  const pr = opts.pr || {};
  const obrigatorio = shaValido(opts.commitIdObrigatorio);
  let head = obrigatorio || shaValido(opts.payload && opts.payload.commit_id);
  if (!head && !opts.commitIdObrigatorio) head = await headVivo(engine, pr);
  return {
    pr, head, obrigatorio, via: String(opts.via || ''), evento: String(opts.payload.event).toUpperCase(),
    account: engine.accountForPr(pr), prKey: chaveDoPr(pr),
  };
}

async function obterPosse(engine, ctx, handle) {
  if (handle) {
    const valido = typeof handle.validoPor === 'function' && handle.validoPor(TEMPOS.POSTAGEM_MARGEM_POSSE_MS);
    if (!valido) return { recusa: 'posse-perdida' };
    return { handle, propria: false };
  }
  const p = await adquirirPosseDePostagem(engine, { prKey: ctx.prKey, account: ctx.account, headSha: ctx.head });
  if (!p.ok) return { recusa: p.motivo };
  return { handle: p.handle, propria: true };
}

async function soltarPosse(handle) {
  try { await handle.abort(); } catch { /* lease que não sai agora expira sozinho pelo TTL */ }
}

function parar(g, r) {
  g.parada = r;
  return false;
}

function recusadosDe(ef) {
  if (!ef || !Array.isArray(ef.recusados)) return [];
  return ef.recusados.map(String);
}

function mesmaTentativa(a, b) {
  return !!a && !!b && a.tentativaId === b.tentativaId;
}

function barradoPeloRegistro(engine, ctx, lido, payload) {
  const ef = lido.efetivo;
  if (!ef) return null;
  if (ef.estado === 'enviando') {
    if (ef === lido.remoto && !mesmaTentativa(lido.local, ef)) observarRemoto(engine, ctx, ef);
    return resultado('enviando', 'resultado-incerto');
  }
  if (ef.estado === 'confirmada') return { ok: true, deduped: true, estado: 'confirmada', motivo: 'ja-registrada', attempted: false, reviewId: String(ef.reviewId || '') };
  const n = normalizeReviewPayload(payload);
  if (ef.estado === 'recusada' && n.ok && recusadosDe(ef).includes(hashDoPayload(n.value))) return resultado('recusada', 'recusada-antes');
  return null;
}

async function estadosNoHead(engine, ctx) {
  try {
    return await engine.myReviewStates(ctx.pr, ctx.head);
  } catch {
    return null;
  }
}

async function jaNoGithub(engine, ctx) {
  await gravarDesfecho(engine, ctx, novoId(), { estado: 'confirmada', motivo: 'ja-no-github', via: ctx.via });
  await marcarPublicado(engine, ctx);
  return { ok: true, deduped: true, estado: 'confirmada', motivo: 'ja-no-github', attempted: false, reviewId: '' };
}

// Passo 2. Consultas anteriores à posse e à espera na fila não valem.
async function naVez(engine, ctx, g, payload) {
  if (ctx.obrigatorio) {
    const vivo = await headVivo(engine, ctx.pr);
    if (!vivo) return parar(g, naoEnviada('head-desconhecido'));
    if (vivo !== ctx.head) return parar(g, naoEnviada('head-mudou'));
  }
  const lido = await lerRegistro(engine, ctx);
  if (!lido.ok) return parar(g, naoEnviada('registro-indisponivel'));
  g.recusados = recusadosDe(lido.efetivo);
  const barrado = barradoPeloRegistro(engine, ctx, lido, payload);
  if (barrado) return parar(g, barrado);
  const estados = await estadosNoHead(engine, ctx);
  if (!Array.isArray(estados)) return parar(g, naoEnviada('estado-desconhecido'));
  if (estados.includes(ESTADO_NO_GITHUB[ctx.evento])) return parar(g, await jaNoGithub(engine, ctx));
  return true;
}

function intencao(engine, ctx, g) {
  const agora = agoraDe(engine);
  return {
    estado: 'enviando', tentativaId: g.tentativaId, intencaoEm: agora, atualizadoEm: agora,
    deviceId: String((engine.sync && engine.sync.deviceId) || ''), via: ctx.via, evento: ctx.evento, head: ctx.head,
    payloadHash: g.payloadHash, recusados: g.recusados, reviewId: '', commitId: '', motivo: '', leiturasVazias: [],
  };
}

// Passos 3 e 4, colados em cada io.run (depois da fila, do token e do arquivo temporário).
async function antesDoEnvio(engine, ctx, g, handle, payload) {
  if (ctx.obrigatorio && shaValido(payload.commit_id) !== ctx.obrigatorio) return parar(g, naoEnviada('ancora-ausente'));
  g.tentativaId = novoId();
  g.payloadHash = hashDoPayload(payload);
  const w = await gravarIntencao(engine, ctx, intencao(engine, ctx, g));
  if (!w.ok) return parar(g, naoEnviada(w.motivo || 'registro-indisponivel'));
  g.ultimo = 'enviando';
  if (handle.validoPor(TEMPOS.POSTAGEM_MARGEM_POSSE_MS)) return true;
  await gravarDesfecho(engine, ctx, g.tentativaId, { estado: 'nao_enviada', motivo: 'posse-perdida' });
  g.ultimo = 'nao_enviada';
  return parar(g, naoEnviada('posse-perdida'));
}

// Só 422 com corpo de erro do GitHub prova recusa; o resto (timeout, rede, 5xx) é incerto.
function recusaProvada(r) {
  if (!r || !/HTTP 422/.test(String(r.stderr || ''))) return false;
  const corpo = io.parseJson(String(r.stdout || '').trim(), null);
  return !!corpo && typeof corpo === 'object' && (typeof corpo.message === 'string' || Array.isArray(corpo.errors));
}

async function confirmarEnvio(engine, ctx, g, r) {
  const corpo = io.parseJson(String(r.stdout || ''), null);
  const dados = corpo && typeof corpo === 'object' ? corpo : {};
  g.ultimo = 'confirmada';
  g.reviewId = dados.id ? String(dados.id) : '';
  await gravarDesfecho(engine, ctx, g.tentativaId, { estado: 'confirmada', reviewId: g.reviewId, commitId: String(dados.commit_id || '') });
  await marcarPublicado(engine, ctx);
}

// Passo 5. Sem prova de desfecho, o registro fica `enviando`.
async function depoisDoEnvio(engine, ctx, g, r) {
  if (r && r.ok) {
    await confirmarEnvio(engine, ctx, g, r);
    return;
  }
  if (!recusaProvada(r)) return;
  g.ultimo = 'recusada';
  g.recusados = [...g.recusados, g.payloadHash];
  await gravarDesfecho(engine, ctx, g.tentativaId, { estado: 'recusada', motivo: 'recusada-pelo-github', recusados: g.recusados });
}

function criarGuarda(engine, ctx, handle, opts) {
  const g = { parada: null, ultimo: '', tentativaId: '', payloadHash: '', reviewId: '', recusados: [] };
  const recuoPermitido = opts.recuoPermitido !== false;
  g.naVez = () => naVez(engine, ctx, g, opts.payload);
  g.antesDoEnvio = (payload) => antesDoEnvio(engine, ctx, g, handle, payload);
  g.depoisDoEnvio = (r) => depoisDoEnvio(engine, ctx, g, r);
  g.podeRecuar = () => recuoPermitido && g.ultimo === 'recusada';
  return g;
}

function resultadoFinal(g, r) {
  if (g.parada) return g.parada;
  const base = r || { ok: false, error: 'postagem sem resposta' };
  if (base.ok) return { ...base, estado: 'confirmada', motivo: '', attempted: g.ultimo === 'confirmada', reviewId: g.reviewId };
  if (g.ultimo === 'recusada') return { ...base, estado: 'recusada', motivo: 'recusada-pelo-github', attempted: true, reviewId: '' };
  if (g.ultimo === 'enviando') {
    const error = `${MOTIVOS['resultado-incerto']} (${base.error || 'sem resposta'})`;
    return { ...base, estado: 'enviando', motivo: 'resultado-incerto', attempted: true, reviewId: '', error };
  }
  return { ...base, estado: 'nao_enviada', motivo: base.blocked || 'nao-enviada', attempted: false, reviewId: '' };
}

async function arbitrarPostagem(engine, opcoes, enviar) {
  const opts = opcoes || {};
  const ctx = await montarContexto(engine, opts);
  if (!ctx.head) return naoEnviada('head-desconhecido');
  const posse = await obterPosse(engine, ctx, opts.handle);
  if (posse.recusa) return naoEnviada(posse.recusa);
  try {
    const g = criarGuarda(engine, ctx, posse.handle, opts);
    const r = await enviar(g);
    return resultadoFinal(g, r);
  } finally {
    if (posse.propria) await soltarPosse(posse.handle);
  }
}

// A revisão automática trata posse perdida como perda de coordenação (err.coordenacao),
// nunca como falha de rede: senão o postRetry reenviaria sem lease.
function lancarSePossePerdida(post) {
  if (!post || post.estado !== 'nao_enviada' || post.motivo !== 'posse-perdida') return;
  throw Object.assign(new Error('lease de coordenação perdido antes de postar; nada foi postado'), { coordenacao: 'perdido' });
}

export default { arbitrarPostagem, reconciliarPostagensIncertas, postagemCoordenada, postagemCoordenadaLigada, lancarSePossePerdida, MOTIVOS };
export { arbitrarPostagem, reconciliarPostagensIncertas, postagemCoordenada, postagemCoordenadaLigada, lancarSePossePerdida, MOTIVOS };
```

- [ ] **Passo 5:** fiação em `lib/engine/decision.js`. Depois de `import { TEMPOS } from '../constants.js';`:

```js
import { arbitrarPostagem, postagemCoordenada } from './postagem-arbitragem.js';
```

Substitua a função `postReview` inteira (de `async function postReview(engine, pr, payload) {` até o `return minha;` e a chave que a fecha) por:

```js
// CT-POST: com a coordenação entre aparelhos ligada, APPROVE e REQUEST_CHANGES passam pela
// arbitragem (lib/engine/postagem-arbitragem.js), que cuida de posse, intenção durável e
// desfecho em volta da MESMA fila por PR de sempre. Desligada, ou para COMMENT, o caminho é
// o de antes, byte a byte nas chamadas ao gh. `opcoes` ({ via, handle, commitIdObrigatorio,
// recuoPermitido }) só é lido pela arbitragem.
async function postReview(engine, pr, payload, opcoes) {
  if (!postagemCoordenada(engine, payload)) return enfileirarPostagem(engine, pr, payload, null);
  return arbitrarPostagem(engine, { ...(opcoes || {}), pr, payload }, (guarda) => enfileirarPostagem(engine, pr, payload, guarda));
}

function enfileirarPostagem(engine, pr, payload, guarda) {
  const lane = postLaneKey(engine, pr);
  if (!(engine.postLanes instanceof Map)) engine.postLanes = new Map();
  const anterior = engine.postLanes.get(lane) || Promise.resolve();
  // a cauda nunca rejeita: uma postagem que falha não pode derrubar a próxima da fila
  const minha = anterior.then(() => postReviewSerial(engine, pr, payload, lane, guarda),
    () => postReviewSerial(engine, pr, payload, lane, guarda));
  const cauda = minha.then(() => { }, () => { });
  engine.postLanes.set(lane, cauda);
  cauda.then(() => { if (engine.postLanes.get(lane) === cauda) engine.postLanes.delete(lane); });
  return minha;
}
```

Em `postReviewSerial`, troque a assinatura `async function postReviewSerial(engine, pr, payload, lane) {` por `async function postReviewSerial(engine, pr, payload, lane, guarda) {`; logo depois de `const evento = String((payload && payload.event) || '').toUpperCase();` acrescente:

```js
  // CT-POST, passo 2: a releitura só vale DEPOIS da espera nesta fila
  if (guarda && !(await guarda.naVez())) return { ok: false };
```

e troque `const r = await postReviewOnce(engine, pr, payload);` por `const r = await postReviewOnce(engine, pr, payload, guarda);`.

Em `postReviewOnce`, troque a assinatura por `async function postReviewOnce(engine, pr, payload, guarda) {`. Troque:

```js
    attempted = true;
    let r = await io.run('gh', ['api', `repos/${repo}/pulls/${number}/reviews`, '--input', file], { env: engine.ghEnv(acc) });
```

por:

```js
    // CT-POST, passos 3 e 4: intenção durável e última conferência da posse, colados no io.run
    if (guarda && !(await guarda.antesDoEnvio(payload))) return { ok: false, attempted: false };
    attempted = true;
    let r = await io.run('gh', ['api', `repos/${repo}/pulls/${number}/reviews`, '--input', file], { env: engine.ghEnv(acc) });
    if (guarda) await guarda.depoisDoEnvio(r);
```

Logo depois do bloco `if (!r.ok && /line could not be resolved|422/i.test(r.stderr)) { ... }` (antes de `if (fallback) {`), acrescente:

```js
    // CT-POST, passo 6: com arbitragem, só recua depois de recusa PROVADA, e nunca quando a via proíbe
    if (fallback && guarda && !guarda.podeRecuar()) fallback = null;
```

E dentro de `if (fallback) {`, troque:

```js
      fs.writeFileSync(file, JSON.stringify(normalizedFallback.value, null, 2));
      r = await io.run('gh', ['api', `repos/${repo}/pulls/${number}/reviews`, '--input', file], { env: engine.ghEnv(acc) });
```

por:

```js
      fs.writeFileSync(file, JSON.stringify(normalizedFallback.value, null, 2));
      if (guarda && !(await guarda.antesDoEnvio(normalizedFallback.value))) return { ok: false, attempted: true };
      r = await io.run('gh', ['api', `repos/${repo}/pulls/${number}/reviews`, '--input', file], { env: engine.ghEnv(acc) });
      if (guarda) await guarda.depoisDoEnvio(r);
```

- [ ] **Passo 6:** fiação em `server.js`. Depois de `import decisionMod from './lib/engine/decision.js';`:

```js
import arbitragemMod from './lib/engine/postagem-arbitragem.js';
```

Troque `  async postReview(pr, payload) { return decisionMod.postReview(this, pr, payload); }` por:

```js
  async postReview(pr, payload, opcoes) { return decisionMod.postReview(this, pr, payload, opcoes); }
  async reconciliarPostagensIncertas() { return arbitragemMod.reconciliarPostagensIncertas(this); }
```

- [ ] **Passo 7:** rodar.

```
node --test test/postagem-arbitragem.test.js test/postagem-coordenacao-desligada.test.js test/facades.test.js test/post-422-ancora.test.js test/decide-concurrency.test.js test/dedup-round.test.js
```

Esperado: tudo verde. `test/postagem-coordenacao-desligada.test.js` verde prova que a fiação não mudou o caminho desligado.

- [ ] **Passo 8:** `npm run lint`. Esperado: sem aumento. Se `profundidadeExcedida` subir em `decision.js`, extraia o `if` novo para uma função do próprio arquivo com o mesmo comportamento; não suba a baseline.

- [ ] **Passo 9 (contraprova):** em `antesDoEnvio`, troque `if (handle.validoPor(TEMPOS.POSTAGEM_MARGEM_POSSE_MS)) return true;` por `return true;`. Rode `node --test test/postagem-arbitragem.test.js`: reprova `posse perdida durante a espera na fila por processo` (`gh.posts.length` 1). Restaure e rode: verde.

- [ ] **Passo 10:** commit.

```
git add lib/engine/postagem-arbitragem.js lib/engine/decision.js server.js test/postagem-arbitragem.test.js test/helpers/github-reviews-falso.js test/helpers/aparelho-coordenado.js
git commit -m "feat(postagem): arbitragem de postagem no funil com a coordenação ligada"
```

---

## Tarefa 7: as quatro vias fora da co-assinatura

**Arquivos:**
- editar `lib/engine/decision.js`: `retryFailedPosts` (linha 370), `postReviewFromSession` (linha 904), `decide` (linha 1033);
- editar `lib/engine/review.js`: import depois de `import { repoDoPr } from './review-signal.js';` (linha 26); postagens em 1437-1438 e 1480-1481;
- criar `test/postagem-vias.test.js` e `test/postagem-revisao-automatica.test.js`.

**Interfaces:** nenhuma nova. Cada via passa a dizer quem é (`via`), e a revisão automática passa o handle da sessão. O reenvio não gasta tentativa quando a arbitragem devolve um estado que não é recusa (incerto, posse, estado desconhecido): tenta no ciclo seguinte, sem contar para o teto de `MAX_POST_RETRY_ATTEMPTS`.

- [ ] **Passo 1:** escrever `test/postagem-vias.test.js`, que falha.

```js
// As vias de postagem com a coordenação ligada, em dois "aparelhos" da mesma conta.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-postagem-vias-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { criarGithubFalso } from './helpers/github-reviews-falso.js';
import { montarAparelho } from './helpers/aparelho-coordenado.js';

const io = (await import('../lib/io.js')).default;
const { Engine } = await import('../server.js');
const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const { admit } = await import('../lib/sync/coordinator.js');
const registro = await import('../lib/engine/registro-postagem.js');

const TOKEN = 'tok-ok';
const AGORA = 1_800_000_000_000;
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const PR = { key: 'o/r#1', repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1', author: 'dev', account: 'eu' };
const CORPO = 'Leitura atenta, tudo certo por aqui.';
const CTX_REG = { account: 'eu', prKey: PR.key, head: HEAD, evento: 'APPROVE' };
const relogio = { agora: AGORA, head: HEAD };
const runReal = io.run;
let fake;
let gh;
let n = 0;
let handles = [];

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => {
  io.run = runReal;
  await fake.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => {
  fake.setTree(null);
  relogio.agora = AGORA;
  relogio.head = HEAD;
  gh = criarGithubFalso({ conta: 'eu', agora: () => relogio.agora, head: () => relogio.head });
  io.run = (cmd, args, opts) => gh.run(cmd, args, opts);
});
afterEach(async () => {
  for (const h of handles) await h.abort();
  handles = [];
});

function aparelho(deviceId, dir) {
  n++;
  return montarAparelho({ Engine, createRtdbClient, fake, token: TOKEN, deviceId, dir: dir || path.join(FAROL_HOME, `ap-${n}`), relogio });
}

function reiniciar(e) {
  return aparelho(e.sync.deviceId, path.dirname(e.postagensArquivo));
}

function pendencia(extra = {}) {
  return {
    id: 'd1', key: PR.key, createdAt: AGORA, status: 'pending', verdict: 'approve',
    pr: { repo: 'o/r', number: 1, url: PR.url, author: 'dev', account: 'eu' }, headSha: HEAD, reasons: [],
    payloads: { approve: { event: 'APPROVE', body: CORPO, comments: [] } }, ...extra,
  };
}

function intencaoSemEnvio() {
  return { estado: 'enviando', tentativaId: 't-velha', intencaoEm: AGORA, atualizadoEm: AGORA, deviceId: 'dA', via: 'revisao', evento: 'APPROVE', head: HEAD, payloadHash: '', reviewId: '', commitId: '', motivo: '', leiturasVazias: [] };
}

async function revisaoAdmitida(e) {
  const ctx = { prKey: PR.key, account: 'eu', materialVersion: HEAD, headSha: HEAD, contaRodada: false, manual: false, semCoordenacao: false, ignorarRecibo: false, pr: PR, operationKind: 'review', opId: '' };
  const adm = await admit(e, ctx);
  assert.equal(adm.admitted, true);
  handles.push(adm.handle);
  return adm.handle;
}

test('dois cliques em aparelhos diferentes: um único POST', async () => {
  const a = aparelho('dA');
  const b = aparelho('dB');
  a.decisions.pending = [pendencia()];
  b.decisions.pending = [pendencia()];
  await Promise.all([a.decide('d1', 'approve'), b.decide('d1', 'approve')]);
  assert.equal(gh.posts.length, 1);
  await a.decide('d1', 'approve');
  await b.decide('d1', 'approve');
  assert.equal(gh.posts.length, 1, 'o clique repetido depois também não duplica');
});

test('clique durante a revisão automática de outro aparelho: um único POST', async () => {
  const a = aparelho('dA');
  const b = aparelho('dB');
  const handle = await revisaoAdmitida(a);
  b.decisions.pending = [pendencia()];
  const clique = await b.decide('d1', 'approve');
  assert.equal(clique.ok, false);
  assert.equal(clique.motivo, 'posse-alheia');
  assert.equal(gh.posts.length, 0);
  const auto = await a.postReview(PR, { event: 'APPROVE', body: CORPO, comments: [], commit_id: HEAD }, { via: 'revisao', handle });
  assert.equal(auto.ok, true);
  assert.equal(gh.posts.length, 1);
});

test('reenvio automático com enviando pendente não posta nem gasta tentativa', async () => {
  const a = aparelho('dA');
  await registro.gravarIntencao(a, CTX_REG, intencaoSemEnvio());
  a.decisions.pending = [pendencia({ postRetry: { event: 'approve', attempts: 0 } })];
  assert.equal(await a.retryFailedPosts(), 0);
  assert.equal(gh.posts.length, 0);
  assert.equal(a.decisions.pending.length, 1);
  assert.equal(a.decisions.pending[0].postRetry.attempts, 0);
});

test('chat depois de reinício não duplica review já publicado, nem num aparelho sem o arquivo local', async () => {
  const a = aparelho('dA');
  const sub = { key: PR.key, payload: { event: 'APPROVE', body: CORPO, comments: [] } };
  assert.equal((await a.postReviewFromSession(sub, a.createReviewPostCapability([PR.key], 'eu', 'chat', ''))).ok, true);
  const a2 = reiniciar(a);
  const r = await a2.postReviewFromSession(sub, a2.createReviewPostCapability([PR.key], 'eu', 'chat', ''));
  assert.equal(r.ok, true);
  assert.equal(r.deduped, true);
  const b = aparelho('dB');
  const rb = await b.postReviewFromSession(sub, b.createReviewPostCapability([PR.key], 'eu', 'chat', ''));
  assert.equal(rb.ok, true);
  assert.equal(gh.posts.length, 1);
});

test('myReviewStates indisponível não autoriza postagem: revisão automática, reenvio, clique e chat', async () => {
  gh.estado.falharLeitura = true;
  const auto = aparelho('dA');
  const handle = await revisaoAdmitida(auto);
  const rAuto = await auto.postReview(PR, { event: 'APPROVE', body: CORPO, comments: [], commit_id: HEAD }, { via: 'revisao', handle });
  assert.equal(rAuto.motivo, 'estado-desconhecido');
  const reenvio = aparelho('dB');
  reenvio.decisions.pending = [pendencia({ postRetry: { event: 'approve', attempts: 0 } })];
  await reenvio.retryFailedPosts();
  const clique = aparelho('dC');
  clique.decisions.pending = [pendencia()];
  const rClique = await clique.decide('d1', 'approve');
  assert.equal(rClique.ok, false);
  const chat = aparelho('dD');
  const rChat = await chat.postReviewFromSession({ key: PR.key, payload: { event: 'APPROVE', body: CORPO, comments: [] } }, chat.createReviewPostCapability([PR.key], 'eu', 'chat', ''));
  assert.equal(rChat.ok, false);
  assert.equal(gh.posts.length, 0);
});

test('um aparelho só, coordenação ligada: o clique posta uma vez e resolve a pendência', async () => {
  const a = aparelho('dA');
  a.decisions.pending = [pendencia()];
  assert.equal((await a.decide('d1', 'approve')).ok, true);
  assert.equal(a.decisions.pending.length, 0);
  assert.equal(gh.posts.length, 1);
});
```

`test/postagem-revisao-automatica.test.js`:

```js
// A revisão automática com a arbitragem de postagem: passa o handle da sessão ao funil,
// trata posse perdida como perda de coordenação e não como falha de rede.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-postagem-auto-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const fanout = (await import('../lib/engine/fanout.js')).default;
const io = (await import('../lib/io.js')).default;

const prMetricsOriginal = fanout.prMetrics;
fanout.prMetrics = async () => null;
const runOriginal = io.run;
io.run = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });
after(() => {
  fanout.prMetrics = prMetricsOriginal;
  io.run = runOriginal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const prDe = (key) => ({ key, repo: key.split('#')[0], number: Number(key.split('#')[1]), url: `https://github.com/${key.replace('#', '/pull/')}`, author: 'dev', requested: true, account: 'eu' });

function envelope(tipo) {
  if (tipo === 'approve') {
    return { analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [], reportMarkdown: 'relatório', payloads: { approve: { event: 'APPROVE', body: 'Leitura atenta, tudo certo por aqui.' } } };
  }
  return { analysisStatus: 'complete', verdict: 'request_changes', decision: 'needs_decision', cardMet: true, reasons: ['bloqueio real'], reportMarkdown: 'relatório', payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'Tem um problema na validação do redirect.' } } };
}

function handleFalso() {
  const h = { noop: false, leaseId: 'L1', attemptId: '', lost: false, done: false, completos: [] };
  h.valido = () => true;
  h.validoPor = () => true;
  h.onLost = () => { };
  h.complete = async (op) => { h.completos.push(op); h.done = true; return { ok: true }; };
  h.abort = async () => { h.done = true; };
  return h;
}

function motor(post, handle, tipo) {
  const e = new Engine();
  e.accountForPr = (pr) => pr.account || 'eu';
  e.tokenFor = () => 'tok-eu';
  e.isMuted = () => false;
  e.logs = [];
  e.log = (nivel, msg) => { e.logs.push(`${nivel} ${msg}`); };
  e.prState = async () => 'OPEN';
  e.headSha = async () => HEAD;
  e.fetchPrFiles = async () => null;
  e.bloqueadoPorChecks = async () => ({ faltando: [] });
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
  e.approvePolicyFor = () => 'approve';
  e.rejectPolicyFor = () => 'request_changes';
  e.scopeLabel = () => 'Conta';
  e.writeMemory = () => { };
  e.myReviewsWithTime = async () => [];
  e.chamadas = [];
  e.postReview = async (pr, payload, opcoes) => { e.chamadas.push({ payload, opcoes }); return post; };
  e.runClaudeStream = async (prompt, opts) => {
    if (typeof opts.onAdmitted === 'function') await opts.onAdmitted(null);
    return { text: JSON.stringify({ result: JSON.stringify(envelope(tipo)) }), sessionId: 's1', coordination: handle };
  };
  e.toasts = [];
  e.on('toast', (t) => e.toasts.push(t));
  e.config.sync = { ...e.config.sync, enabled: true, coordination: { enabled: true } };
  return e;
}

const POSSE_PERDIDA = { ok: false, estado: 'nao_enviada', motivo: 'posse-perdida', attempted: false, reviewId: '', error: 'a posse deste PR venceu antes do envio, então nada foi postado' };
const INCERTA = { ok: false, estado: 'enviando', motivo: 'resultado-incerto', attempted: true, reviewId: '', error: 'uma postagem deste commit pode ter chegado ao GitHub e ainda não foi conferida; não posto de novo até conferir (gh: HTTP 502)' };

for (const tipo of ['approve', 'request_changes']) {
  test(`${tipo}: o funil recebe via revisao e o handle da sessão`, async () => {
    const h = handleFalso();
    const e = motor({ ok: true, estado: 'confirmada' }, h, tipo);
    await e.runHeadlessReview(prDe('o/r#1'));
    assert.equal(e.chamadas.length, 1);
    assert.equal(e.chamadas[0].opcoes.via, 'revisao');
    assert.equal(e.chamadas[0].opcoes.handle, h);
  });

  test(`${tipo}: posse perdida no funil sobe como perda de coordenação`, async () => {
    const e = motor(POSSE_PERDIDA, handleFalso(), tipo);
    await assert.rejects(e.runHeadlessReview(prDe('o/r#2')), (err) => err.coordenacao === 'perdido');
    assert.equal(e.decisions.pending.some((d) => d.key === 'o/r#2'), false);
  });
}

test('postagem incerta: vira pendência com o motivo, sem lançar', async () => {
  const e = motor(INCERTA, handleFalso(), 'approve');
  await e.runHeadlessReview(prDe('o/r#3'));
  const item = e.decisions.pending.find((d) => d.key === 'o/r#3');
  assert.ok(item);
  assert.ok((item.reasons || []).some((r) => r.kind === 'infra' && /pode ter chegado ao GitHub/.test(r.text)));
});
```

- [ ] **Passo 2:** rodar `node --test test/postagem-vias.test.js test/postagem-revisao-automatica.test.js`. Esperado: reprovam `reenvio automático com enviando pendente...` (`attempts` vira 1), os dois `o funil recebe via revisao` (`opcoes` indefinido) e os dois `posse perdida no funil sobe como perda de coordenação` (a promessa resolve em vez de rejeitar). Os demais podem já passar, porque o funil arbitra sem `via`.

- [ ] **Passo 3:** fiação. Em `lib/engine/decision.js`, `retryFailedPosts`, troque:

```js
      const post = await engine.postReview(item.pr, { ...payload, commit_id: item.headSha });
      if (!post.ok) {
```

por:

```js
      const post = await engine.postReview(item.pr, { ...payload, commit_id: item.headSha }, { via: 'reenvio' });
      if (!post.ok) {
        // CT-POST: incerto, posse ou estado desconhecido não gastam tentativa; o próximo ciclo decide
        if (post.estado && post.estado !== 'recusada') continue;
```

Em `postReviewFromSession`, troque `result = await engine.postReview(pr, payload);` por `result = await engine.postReview(pr, payload, { via: 'sessao' });`.

Em `decide`, troque `const post = await engine.postReview({ ...item.pr, key: item.key }, { ...payload, commit_id: item.headSha || head || '' });` por:

```js
  const post = await engine.postReview({ ...item.pr, key: item.key }, { ...payload, commit_id: item.headSha || head || '' }, { via: 'clique' });
```

Em `lib/engine/review.js`, depois de `import { repoDoPr } from './review-signal.js';`:

```js
import { lancarSePossePerdida } from './postagem-arbitragem.js';
```

Troque:

```js
      pararSeLeasePerdido(coord);
      const post = await engine.postReview(pr, { ...result.payloads.approve, commit_id: headShaAtual });
```

por:

```js
      pararSeLeasePerdido(coord);
      const post = await engine.postReview(pr, { ...result.payloads.approve, commit_id: headShaAtual }, { via: 'revisao', handle: coord });
      lancarSePossePerdida(post);
```

E troque:

```js
      pararSeLeasePerdido(coord);
      const post = await engine.postReview(pr, rc);
```

por:

```js
      pararSeLeasePerdido(coord);
      const post = await engine.postReview(pr, rc, { via: 'revisao', handle: coord });
      lancarSePossePerdida(post);
```

- [ ] **Passo 4:** rodar `node --test test/postagem-vias.test.js test/postagem-revisao-automatica.test.js test/postagem-coordenacao-desligada.test.js test/retry-failed-posts.test.js test/sync-review.test.js test/http.test.js`. Esperado: tudo verde.

- [ ] **Passo 5 (contraprova):** em `retryFailedPosts`, apague a linha `if (post.estado && post.estado !== 'recusada') continue;`. Rode `node --test test/postagem-vias.test.js`: reprova `reenvio automático com enviando pendente não posta nem gasta tentativa` (`attempts` 1). Restaure. Depois apague a primeira `lancarSePossePerdida(post);` de `review.js` e rode `node --test test/postagem-revisao-automatica.test.js`: reprova `approve: posse perdida no funil sobe como perda de coordenação`. Restaure e rode os dois: verde.

- [ ] **Passo 6:** commit.

```
git add lib/engine/decision.js lib/engine/review.js test/postagem-vias.test.js test/postagem-revisao-automatica.test.js
git commit -m "feat(postagem): revisão automática, reenvio, clique e chat passam pela arbitragem"
```

---

## Tarefa 8: reconciliação no ciclo e os dois cenários de queda

**Arquivos:**
- editar `server.js`, `check()`, logo depois da linha `try { await this.reconcilePending(); } catch (e) { this.log('WARN', \`reconcilePending: ${e.message}\`); }` (linha 883);
- criar `test/postagem-incerta.test.js`.

**Interfaces:** nenhuma nova; o `check()` passa a chamar `this.reconciliarPostagensIncertas()` entre `reconcilePending` e `retryFailedPosts`.

- [ ] **Passo 1:** escrever o teste que falha.

```js
// Resultado incerto (CT-POST): queda depois do aceite e queda na fronteira. Nenhum dos dois
// pode virar "não enviado" por ausência de desfecho, e a reconciliação é a única saída.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-postagem-incerta-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { criarGithubFalso } from './helpers/github-reviews-falso.js';
import { montarAparelho } from './helpers/aparelho-coordenado.js';
import { TEMPOS } from '../lib/constants.js';

const io = (await import('../lib/io.js')).default;
const { Engine } = await import('../server.js');
const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const registro = await import('../lib/engine/registro-postagem.js');

const TOKEN = 'tok-ok';
const AGORA = 1_800_000_000_000;
const E = TEMPOS.POSTAGEM_RECONCILIACAO_ESPERA_MS;
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const PR_KEY = 'o/r#1';
const CTX_REG = { account: 'eu', prKey: PR_KEY, head: HEAD, evento: 'APPROVE' };
const relogio = { agora: AGORA, head: HEAD };
const runReal = io.run;
let fake;
let gh;
let n = 0;

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => {
  io.run = runReal;
  await fake.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => {
  fake.setTree(null);
  relogio.agora = AGORA;
  relogio.head = HEAD;
  gh = criarGithubFalso({ conta: 'eu', agora: () => relogio.agora, head: () => relogio.head });
  io.run = (cmd, args, opts) => gh.run(cmd, args, opts);
});

function aparelho(deviceId, dir) {
  n++;
  return montarAparelho({ Engine, createRtdbClient, fake, token: TOKEN, deviceId, dir: dir || path.join(FAROL_HOME, `ap-${n}`), relogio });
}

function reiniciar(e) {
  return aparelho(e.sync.deviceId, path.dirname(e.postagensArquivo));
}

function pendencia() {
  return {
    id: 'd1', key: PR_KEY, createdAt: AGORA, status: 'pending', verdict: 'approve',
    pr: { repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1', author: 'dev', account: 'eu' }, headSha: HEAD, reasons: [],
    payloads: { approve: { event: 'APPROVE', body: 'Leitura atenta, tudo certo por aqui.', comments: [] } },
  };
}

async function estado(e) {
  return (await registro.lerRegistro(e, CTX_REG)).efetivo.estado;
}

test('publicação aceita e queda antes do desfecho: fica enviando, ninguém reposta, a reconciliação confirma', async () => {
  const a = aparelho('dA');
  const b = aparelho('dB');
  gh.estado.aoPostar = () => 'aceitar-e-cair';
  gh.estado.ocultarNovos = true;
  a.decisions.pending = [pendencia()];
  const r = await a.decide('d1', 'approve');
  assert.equal(r.ok, false);
  assert.equal(r.estado, 'enviando');
  gh.estado.aoPostar = null;
  const a2 = reiniciar(a);
  a2.decisions.pending = [pendencia()];
  await a2.decide('d1', 'approve');
  b.decisions.pending = [pendencia()];
  await b.decide('d1', 'approve');
  assert.equal(gh.posts.length, 1, 'nem a recuperação nem outro aparelho postam de novo');
  assert.equal(await estado(b), 'enviando');
  gh.revelar();
  assert.equal(await a2.reconciliarPostagensIncertas(), 1);
  assert.equal(await estado(a2), 'confirmada');
  assert.equal(await estado(b), 'confirmada', 'o banco carrega o desfecho para os outros aparelhos');
  assert.equal(gh.posts.length, 1);
});

test('queda na fronteira: enviando sem io.run só vira nao_enviada com as duas leituras', async () => {
  const a = aparelho('dA');
  const intencao = { estado: 'enviando', tentativaId: 't-fronteira', intencaoEm: AGORA, atualizadoEm: AGORA, deviceId: 'dA', via: 'clique', evento: 'APPROVE', head: HEAD, payloadHash: '', reviewId: '', commitId: '', motivo: '', leiturasVazias: [] };
  assert.deepEqual(await registro.gravarIntencao(a, CTX_REG, intencao), { ok: true });
  const a2 = reiniciar(a);
  a2.decisions.pending = [pendencia()];
  await a2.decide('d1', 'approve');
  assert.equal(gh.posts.length, 0, 'enviando nunca é lido como não enviado');

  relogio.agora = AGORA + E / 2;
  await a2.reconciliarPostagensIncertas();
  relogio.agora = AGORA + E + 1;
  await a2.reconciliarPostagensIncertas();
  relogio.agora = AGORA + E + E / 2;
  await a2.reconciliarPostagensIncertas();
  gh.estado.falharLeitura = true;
  relogio.agora = AGORA + 2 * E + 5;
  await a2.reconciliarPostagensIncertas();
  gh.estado.falharLeitura = false;
  assert.equal(await estado(a2), 'enviando', 'leitura cedo, espaçamento curto e leitura falha não concluem');
  assert.equal(registro.listarIncertos(a2)[0].leiturasVazias.length, 1);

  relogio.agora = AGORA + 2 * E + 10;
  assert.equal(await a2.reconciliarPostagensIncertas(), 1);
  assert.equal(await estado(a2), 'nao_enviada');
  await a2.decide('d1', 'approve');
  assert.equal(gh.posts.length, 1, 'só depois da conclusão a via tenta de novo');
});

test('check() reconcilia postagens incertas depois do reconcilePending e antes do retryFailedPosts', () => {
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'server.js'), 'utf8');
  const pend = fonte.indexOf('await this.reconcilePending();');
  const inc = fonte.indexOf('await this.reconciliarPostagensIncertas();');
  const retry = fonte.indexOf('await this.retryFailedPosts();');
  assert.ok(pend > 0 && inc > pend && retry > inc, `ordem no check(): ${pend} < ${inc} < ${retry}`);
});
```

- [ ] **Passo 2:** rodar `node --test test/postagem-incerta.test.js`. Esperado: os dois primeiros passam (a lógica já existe desde as Tarefas 5 e 6) e o terceiro reprova (`inc` é -1). Os dois primeiros ficam como prova de aceite desta entrega.

- [ ] **Passo 3:** em `server.js`, logo depois da linha do `reconcilePending` no `check()`:

```js
      // postagem incerta (CT-POST): confere no GitHub se ela saiu ANTES de qualquer reenvio,
      // que é o passo logo abaixo; com a coordenação desligada não faz nada
      try { await this.reconciliarPostagensIncertas(); } catch (e) { this.log('WARN', `reconciliar postagens: ${e.message}`); }
```

- [ ] **Passo 4:** rodar `node --test test/postagem-incerta.test.js test/facades.test.js`. Esperado: verde.

- [ ] **Passo 5 (contraprova):** em `lib/engine/postagem-arbitragem.js`, `barradoPeloRegistro`, troque `if (ef.estado === 'enviando') {` por `if (ef.estado === 'enviando' && ef.via === 'nunca') {`. Rode `node --test test/postagem-incerta.test.js`: reprovam os dois cenários de queda (`gh.posts.length` passa de 1 e de 0). Restaure e rode: verde.

- [ ] **Passo 6:** commit.

```
git add server.js test/postagem-incerta.test.js
git commit -m "feat(postagem): o ciclo reconcilia postagem incerta antes do reenvio"
```

---

## Tarefa 9: co-assinatura coordenada

**Arquivos:**
- criar `lib/engine/coassinatura-coordenada.js` e `test/coassinatura-coordenada.test.js`;
- editar `lib/engine/skip-review.js`: imports (depois de `import { avisaBloqueioChecks } from './checks-exigidos.js';`, linha 70), `reviewsDeOutros` (379-392), `coAssinar` (422-434).

**Interfaces:**
- `async coAssinarCoordenado(engine, pr, { quem, head, corpo, reler, concluir })` devolve `true` só quando um APPROVE novo saiu.
- `aprovouNoMesmoSha(reviews, quem, head)`, PURA.
- `reviewsDeOutros(engine, pr, head, { mesmoSha })`: com `mesmoSha: true`, head vazio devolve `null` e só review com `commit_id === head` entra; sem a opção, o filtro tolerante de hoje (a caducidade da saída de cena continua lendo assim). A lista passa a trazer `commit`.
- `coAssinar(engine, pr, quem, head)`: com a coordenação ligada delega a `coAssinarCoordenado`; desligada, o corpo de hoje, sem mudança.

Regras da 7.C0b cobertas aqui: posse de postagem antes de tudo; depois da posse, head atual igual ao do endosso, aprovação da pessoa no MESMO sha e nenhum APPROVE meu nesse sha; POST com `commit_id` explícito, `commitIdObrigatorio` e `recuoPermitido: false`; commit novo é desfecho explícito (log e aviso), nunca recuo; dedup grava a marca `coAssinado`; nenhuma sessão, envelope ou consumo.

- [ ] **Passo 1:** escrever o teste que falha.

```js
// Co-assinatura com a coordenação ligada (7.C0b), em dois "aparelhos" da mesma conta.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-coassinatura-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { criarGithubFalso, recusa422 } from './helpers/github-reviews-falso.js';
import { montarAparelho } from './helpers/aparelho-coordenado.js';

const io = (await import('../lib/io.js')).default;
const { Engine } = await import('../server.js');
const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const { admit } = await import('../lib/sync/coordinator.js');
const skip = await import('../lib/engine/skip-review.js');
const { aprovouNoMesmoSha } = await import('../lib/engine/coassinatura-coordenada.js');

const TOKEN = 'tok-ok';
const AGORA = 1_800_000_000_000;
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const HEAD_NOVO = 'b8722a34da5fadb9fda260565f166c977eb5d992';
const PR = { key: 'o/r#1', repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1', author: 'dev', account: 'eu' };
const relogio = { agora: AGORA, head: HEAD };
const runReal = io.run;
let fake;
let gh;
let n = 0;
let handles = [];

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => {
  io.run = runReal;
  await fake.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => {
  fake.setTree(null);
  relogio.agora = AGORA;
  relogio.head = HEAD;
  gh = criarGithubFalso({ conta: 'eu', agora: () => relogio.agora, head: () => relogio.head });
  io.run = (cmd, args, opts) => gh.run(cmd, args, opts);
});
afterEach(async () => {
  for (const h of handles) await h.abort();
  handles = [];
});

function aparelho(deviceId) {
  n++;
  const e = montarAparelho({ Engine, createRtdbClient, fake, token: TOKEN, deviceId, dir: path.join(FAROL_HOME, `ap-${n}`), relogio });
  e.config.coAssinarReview = true;
  e.skipComentado[PR.key] = { head: HEAD, quem: ['ana'] };
  return e;
}

function anaAprovou(commitId = HEAD) {
  gh.adicionarReview({ user: 'ana', state: 'APPROVED', commit_id: commitId });
}

function ctxRevisao() {
  return { prKey: PR.key, account: 'eu', materialVersion: HEAD, headSha: HEAD, contaRodada: false, manual: false, semCoordenacao: false, ignorarRecibo: false, pr: PR, operationKind: 'review', opId: '' };
}

test('aprovouNoMesmoSha: só APPROVED da pessoa no mesmo commit', () => {
  assert.equal(aprovouNoMesmoSha([{ quem: 'Ana', state: 'APPROVED', commit: HEAD }], 'ana', HEAD), true);
  assert.equal(aprovouNoMesmoSha([{ quem: 'ana', state: 'APPROVED', commit: '' }], 'ana', HEAD), false);
  assert.equal(aprovouNoMesmoSha([{ quem: 'ana', state: 'APPROVED', commit: HEAD }], 'ana', ''), false);
  assert.equal(aprovouNoMesmoSha([{ quem: 'zoe', state: 'APPROVED', commit: HEAD }], 'ana', HEAD), false);
  assert.equal(aprovouNoMesmoSha(null, 'ana', HEAD), false);
});

test('duas co-assinaturas concorrentes em dois aparelhos: um único POST, ancorado', async () => {
  anaAprovou();
  const a = aparelho('dA');
  const b = aparelho('dB');
  const r = await Promise.all([skip.coAssinar(a, PR, 'ana', HEAD), skip.coAssinar(b, PR, 'ana', HEAD)]);
  assert.equal(gh.posts.length, 1);
  assert.equal(r.filter(Boolean).length, 1);
  assert.equal(gh.posts[0].payload.commit_id, HEAD);
  const perdedor = r[0] ? b : a;
  assert.equal(await skip.coAssinar(perdedor, PR, 'ana', HEAD), false);
  assert.equal(perdedor.skipComentado[PR.key].coAssinado, true, 'o dedup grava a marca de concluída');
  assert.equal(gh.posts.length, 1);
});

test('co-assinatura concorrendo com revisão normal que segura o PR: um único POST', async () => {
  anaAprovou();
  const a = aparelho('dA');
  const b = aparelho('dB');
  const adm = await admit(a, ctxRevisao());
  assert.equal(adm.admitted, true);
  handles.push(adm.handle);
  assert.equal(await skip.coAssinar(b, PR, 'ana', HEAD), false);
  const auto = await a.postReview(PR, { event: 'APPROVE', body: 'Leitura atenta, tudo certo por aqui.', comments: [], commit_id: HEAD }, { via: 'revisao', handle: adm.handle });
  assert.equal(auto.ok, true);
  assert.equal(gh.posts.length, 1);
});

test('co-assinatura que sai primeiro: a revisão do outro aparelho não é admitida', async () => {
  anaAprovou();
  const a = aparelho('dA');
  const b = aparelho('dB');
  assert.equal(await skip.coAssinar(b, PR, 'ana', HEAD), true);
  const adm = await admit(a, ctxRevisao());
  assert.equal(adm.admitted, false);
  assert.equal(adm.reason, 'recibo');
  assert.equal(gh.posts.length, 1);
});

test('HEAD mudando entre a conferência e o POST: não aprova o commit novo e avisa', async () => {
  anaAprovou();
  const b = aparelho('dB');
  relogio.head = HEAD_NOVO;
  assert.equal(await skip.coAssinar(b, PR, 'ana', HEAD), false);
  assert.equal(gh.posts.length, 0);
  assert.ok(b.toasts.some((t) => /commit novo/.test(t.text)));
  assert.ok(b.logs.some((l) => /não vale para o commit novo/.test(l)));
});

test('aprovação sem commit_id, em outro commit, ou head vazio: nada é postado', async () => {
  const b = aparelho('dB');
  anaAprovou('');
  assert.equal(await skip.coAssinar(b, PR, 'ana', HEAD), false);
  anaAprovou('c'.repeat(40));
  assert.equal(await skip.coAssinar(b, PR, 'ana', HEAD), false);
  assert.equal(await skip.coAssinar(b, PR, 'ana', ''), false);
  assert.equal(gh.posts.length, 0);
});

test('seguirForaDeCena com head vazio e coordenação ligada: aprovação sem sha não vira co-assinatura', async () => {
  anaAprovou('');
  const b = aparelho('dB');
  assert.equal(await skip.seguirForaDeCena(b, { ...PR, labels: [] }, { head: '', quem: ['ana'] }, ''), true);
  assert.equal(gh.posts.length, 0);
});

test('422 na co-assinatura: o recuo sem âncora não é tentado', async () => {
  anaAprovou();
  const b = aparelho('dB');
  gh.estado.aoPostar = () => recusa422();
  assert.equal(await skip.coAssinar(b, PR, 'ana', HEAD), false);
  assert.equal(gh.posts.length, 1);
  assert.equal(gh.posts[0].payload.commit_id, HEAD);
});

test('myReviewStates indisponível: a co-assinatura não posta', async () => {
  anaAprovou();
  const b = aparelho('dB');
  gh.estado.falharLeitura = true;
  assert.equal(await skip.coAssinar(b, PR, 'ana', HEAD), false);
  assert.equal(gh.posts.length, 0);
});

test('co-assinatura não é revisão: não abre sessão nem registra sessão ativa', async () => {
  anaAprovou();
  const b = aparelho('dB');
  b.runClaudeStream = async () => { throw new Error('co-assinatura não pode abrir sessão'); };
  assert.equal(await skip.coAssinar(b, PR, 'ana', HEAD), true);
  assert.equal(b.activeReviews.size, 0);
});
```

- [ ] **Passo 2:** rodar `node --test test/coassinatura-coordenada.test.js`. Esperado: reprova no import (`Cannot find module` apontando `lib/engine/coassinatura-coordenada.js`).

- [ ] **Passo 3:** criar `lib/engine/coassinatura-coordenada.js`.

```js
// Co-assinatura com a coordenação entre aparelhos ligada (7.C0b da spec
// 2026-09-15-operacao-multidispositivo). Continua opt-in e continua NÃO sendo revisão: não
// abre sessão, não fabrica envelope para shouldAutoApprove e não conta consumo. O que muda
// é a ordem das provas:
//   1. posse de postagem (o mesmo lease das análises, tipo 'post');
//   2. DEPOIS da posse: o commit atual ainda é o do endosso, a aprovação de quem pegou o
//      PR é NESSE commit (head vazio ou review sem commit_id não provam) e eu ainda não
//      aprovei esse commit;
//   3. a postagem sai ancorada no commit confirmado, pelo funil, sem recuo sem âncora.
// Commit novo é desfecho explícito, com aviso: o endosso anterior não aprova o commit novo.
import { adquirirPosseDePostagem } from '../sync/posse-postagem.js';

function logar(engine, nivel, msg) {
  if (typeof engine.log === 'function') engine.log(nivel, msg);
}

// PURA: a pessoa do endosso aprovou ESTE commit?
function aprovouNoMesmoSha(reviews, quem, head) {
  if (!Array.isArray(reviews) || !head) return false;
  const alvo = String(quem || '').toLowerCase();
  return reviews.some((r) => !!r && r.state === 'APPROVED' && String(r.quem).toLowerCase() === alvo && r.commit === head);
}

async function headAtual(engine, pr) {
  try {
    return String((await engine.headSha(pr)) || '');
  } catch {
    return '';
  }
}

async function soltar(handle) {
  try { await handle.abort(); } catch { /* lease que não sai agora expira sozinho pelo TTL */ }
}

function avisarCommitNovo(engine, pr, quem, head, vivo) {
  logar(engine, 'INFO', `co-assinatura de ${pr.key}: o commit ${head.slice(0, 8)} deu lugar a ${vivo.slice(0, 8)}; a aprovação de @${quem} não vale para o commit novo`);
  engine.emit('toast', { kind: 'info', text: `${pr.key}: chegou commit novo depois da aprovação de @${quem}, então não aprovei; o endosso anterior não vale para o commit novo.` });
  return false;
}

async function postarEndosso(engine, pr, dados) {
  const { quem, head, corpo, concluir, handle } = dados;
  const payload = { event: 'APPROVE', body: corpo, comments: [], commit_id: head };
  const post = await engine.postReview(pr, payload, { via: 'coassinatura', handle, commitIdObrigatorio: head, recuoPermitido: false });
  if (!post.ok) {
    logar(engine, 'WARN', `co-assinatura de ${pr.key} não saiu: ${post.error}`);
    return false;
  }
  concluir();
  if (post.deduped) return false;
  engine.emit('toast', { kind: 'ok', text: `✅ ${pr.key} aprovado junto com @${quem} (você não gastou revisão).` });
  return true;
}

async function comPosse(engine, pr, dados) {
  const { quem, head, reler, concluir } = dados;
  const vivo = await headAtual(engine, pr);
  if (!vivo) return false;
  if (vivo !== head) return avisarCommitNovo(engine, pr, quem, head, vivo);
  if (!aprovouNoMesmoSha(await reler(), quem, head)) return false;
  const meus = await engine.myReviewStates(pr, head);
  if (meus === null) return false;
  if (meus.includes('APPROVED')) {
    concluir();
    return false;
  }
  return postarEndosso(engine, pr, dados);
}

async function coAssinarCoordenado(engine, pr, dados) {
  if (!dados || !dados.head) return false;
  const posse = await adquirirPosseDePostagem(engine, { prKey: pr.key, account: engine.accountForPr(pr), headSha: dados.head });
  if (!posse.ok) return false;
  try {
    return await comPosse(engine, pr, { ...dados, handle: posse.handle });
  } finally {
    await soltar(posse.handle);
  }
}

export default { coAssinarCoordenado, aprovouNoMesmoSha };
export { coAssinarCoordenado, aprovouNoMesmoSha };
```

- [ ] **Passo 4:** fiação em `lib/engine/skip-review.js`. Depois de `import { avisaBloqueioChecks } from './checks-exigidos.js';`:

```js
import { postagemCoordenadaLigada } from './postagem-arbitragem.js';
import { coAssinarCoordenado } from './coassinatura-coordenada.js';
```

Em `reviewsDeOutros`, troque a assinatura `async function reviewsDeOutros(engine, pr, head) {` por `async function reviewsDeOutros(engine, pr, head, opcoes) {`, acrescente logo depois dela:

```js
  const mesmoSha = !!(opcoes && opcoes.mesmoSha);
  if (mesmoSha && !head) return null;
```

e troque:

```js
  return raw
    .filter(x => !head || !x.commit_id || x.commit_id === head)
    .map(x => ({ quem: String(x.quem || ''), tipo: String(x.tipo || ''), state: String(x.state || '') }));
}
```

por:

```js
  return raw
    .filter(x => reviewNoHead(x, head, mesmoSha))
    .map(x => ({ quem: String(x.quem || ''), tipo: String(x.tipo || ''), state: String(x.state || ''), commit: String(x.commit_id || '') }));
}

// Endosso da co-assinatura coordenada (7.C0b) só aceita review NO MESMO SHA: head vazio ou
// review sem commit_id não provam nada. A caducidade da saída de cena segue com a leitura
// tolerante de sempre, porque nela a falta de dado já pende para o lado seguro.
function reviewNoHead(x, head, mesmoSha) {
  if (mesmoSha) return !!head && !!x.commit_id && x.commit_id === head;
  return !head || !x.commit_id || x.commit_id === head;
}
```

Em `coAssinar`, logo depois de `async function coAssinar(engine, pr, quem, head) {`:

```js
  // coordenação ligada: posse, releitura no mesmo sha e postagem ancorada (7.C0b)
  if (postagemCoordenadaLigada(engine)) {
    return coAssinarCoordenado(engine, pr, {
      quem, head, corpo: textoDaCoassinatura(quem),
      reler: () => reviewsDeOutros(engine, pr, head, { mesmoSha: true }),
      concluir: () => marcarCoAssinado(engine, pr),
    });
  }
```

e, logo depois do fechamento de `coAssinar`:

```js
function marcarCoAssinado(engine, pr) {
  engine.skipComentado[pr.key] = { ...(engine.skipComentado[pr.key] || {}), coAssinado: true, at: Date.now() };
  saveSkipComentado(engine);
}
```

- [ ] **Passo 5:** rodar `node --test test/coassinatura-coordenada.test.js test/skip-review.test.js test/consciencia-historico.test.js test/postagem-coordenacao-desligada.test.js`. Esperado: tudo verde.

- [ ] **Passo 6 (contraprova):** em `postarEndosso`, troque `recuoPermitido: false` por `recuoPermitido: true`. Rode `node --test test/coassinatura-coordenada.test.js`: reprova `422 na co-assinatura: o recuo sem âncora não é tentado` (`gh.posts.length` 2). Restaure. Depois, em `reviewNoHead`, troque `return !!head && !!x.commit_id && x.commit_id === head;` por `return !head || !x.commit_id || x.commit_id === head;` e rode: reprova `aprovação sem commit_id, em outro commit, ou head vazio`. Restaure e rode: verde.

- [ ] **Passo 7:** commit.

```
git add lib/engine/coassinatura-coordenada.js lib/engine/skip-review.js test/coassinatura-coordenada.test.js
git commit -m "feat(postagem): co-assinatura coordenada, ancorada no commit do endosso"
```

---

## Tarefa 10: cobertura por conta com aparelho em versão antiga

**Arquivos:**
- criar `lib/sync/cobertura-postagem.js` e `test/cobertura-postagem.test.js`;
- editar `lib/engine/sync.js`: import junto de `import coordinator from '../sync/coordinator.js';` (linha 23); função nova antes de `statusForUi`; campo novo no objeto de `statusForUi` (513-525).

**Interfaces:**
- `coberturaDePostagem(devices, account)` devolve `{ account, coberta, naoCobertaPor }`. PURA. `devices` é o `rt.devices` (`{ id: { name, platform, farolVersion, lastSeenAt } }`).
- `POSTAGEM_COORDENADA_DESDE` e `compararVersao(a, b)` (devolve -1, 0, 1 ou `null` para versão ilegível).
- `statusForUi(engine).coberturaPostagem`: uma entrada por conta de `engine.accountList()` com a coordenação ligada; lista vazia com ela desligada.

- [ ] **Passo 1:** escrever o teste que falha.

```js
// CT-COMPAT, ativação por versão: a arbitragem de postagem só é declarada coberta para uma
// conta quando todo aparelho visto participa do protocolo.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-cobertura-postagem-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { coberturaDePostagem, compararVersao, POSTAGEM_COORDENADA_DESDE } from '../lib/sync/cobertura-postagem.js';

const { Engine } = await import('../server.js');
const syncMod = (await import('../lib/engine/sync.js')).default;

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });

const NOVO = { name: 'Notebook', farolVersion: POSTAGEM_COORDENADA_DESDE, lastSeenAt: 1 };

test('a versão mínima é posterior à última medida sem a arbitragem (2.59.3)', () => {
  assert.equal(compararVersao(POSTAGEM_COORDENADA_DESDE, '2.59.3'), 1);
  assert.equal(compararVersao('2.10.0', '2.9.9'), 1);
  assert.equal(compararVersao('x', '2.9.9'), null);
});

test('todos os aparelhos na versão que participa: coberta', () => {
  assert.deepEqual(coberturaDePostagem({ d1: NOVO, d2: { ...NOVO, name: 'Desktop', farolVersion: '9.0.0' } }, 'eu'), { account: 'eu', coberta: true, naoCobertaPor: [] });
});

test('um aparelho antigo, mesmo sem batimento recente: não coberta, nomeando o aparelho', () => {
  const r = coberturaDePostagem({ d1: NOVO, d2: { name: 'Desktop velho', farolVersion: '2.59.3', lastSeenAt: 0 } }, 'eu');
  assert.deepEqual(r, { account: 'eu', coberta: false, naoCobertaPor: ['Desktop velho'] });
});

test('aparelho sem versão legível conta como antigo; sem nome, vale o id', () => {
  assert.deepEqual(coberturaDePostagem({ d9: { farolVersion: '' } }, 'eu').naoCobertaPor, ['d9']);
});

test('nenhum aparelho visto: não declara cobertura', () => {
  assert.equal(coberturaDePostagem({}, 'eu').coberta, false);
  assert.equal(coberturaDePostagem(null, 'eu').coberta, false);
});

test('statusForUi: uma entrada por conta com a coordenação ligada, nenhuma com ela desligada', () => {
  const e = new Engine();
  e.config.accounts = [{ user: 'eu', owners: ['o'] }];
  e.sync.devices = { d1: NOVO, d2: { name: 'Desktop velho', farolVersion: '2.59.3', lastSeenAt: 0 } };
  assert.deepEqual(syncMod.statusForUi(e).coberturaPostagem, []);
  e.config.sync = { ...e.config.sync, enabled: true, coordination: { enabled: true } };
  assert.deepEqual(syncMod.statusForUi(e).coberturaPostagem, [{ account: 'eu', coberta: false, naoCobertaPor: ['Desktop velho'] }]);
});
```

- [ ] **Passo 2:** rodar `node --test test/cobertura-postagem.test.js`. Esperado: reprova com `Cannot find module` apontando `lib/sync/cobertura-postagem.js`.

- [ ] **Passo 3:** criar `lib/sync/cobertura-postagem.js`.

```js
// Declaração de cobertura da arbitragem de postagem por conta (CT-COMPAT, "Ativação por
// versão"). PURA. Aparelho sem batimento recente não prova que não vai voltar a postar, e
// a presença de hoje não diz quais contas cada aparelho usa: por isso TODO aparelho visto
// na sincronização conta como capaz de postar por qualquer conta, e basta um numa versão
// que não participa (ou sem versão legível) para a conta ser declarada não coberta.
//
// POSTAGEM_COORDENADA_DESDE é a primeira versão publicada com a arbitragem. O valor abaixo
// é o menor possível depois da 2.59.3; o PR de release desta entrega o ajusta para o
// número efetivamente publicado (ver "Limites que continuam declarados" no plano C0b).
const POSTAGEM_COORDENADA_DESDE = '2.59.4';
const VERSAO_RE = /^(\d+)\.(\d+)\.(\d+)$/;

function partes(v) {
  const m = VERSAO_RE.exec(String(v || '').trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compararVersao(a, b) {
  const pa = partes(a);
  const pb = partes(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

function naoParticipa(d) {
  const c = compararVersao(d && d.farolVersion, POSTAGEM_COORDENADA_DESDE);
  return c === null || c < 0;
}

function coberturaDePostagem(devices, account) {
  const lista = Object.entries(devices && typeof devices === 'object' ? devices : {});
  const antigos = lista.filter(([, d]) => naoParticipa(d)).map(([id, d]) => String((d && d.name) || '') || id);
  return { account: String(account || ''), coberta: lista.length > 0 && antigos.length === 0, naoCobertaPor: antigos };
}

export default { coberturaDePostagem, compararVersao, POSTAGEM_COORDENADA_DESDE };
export { coberturaDePostagem, compararVersao, POSTAGEM_COORDENADA_DESDE };
```

- [ ] **Passo 4:** fiação em `lib/engine/sync.js`. Depois de `import coordinator from '../sync/coordinator.js';`:

```js
import { coberturaDePostagem } from '../sync/cobertura-postagem.js';
```

Antes de `function statusForUi(engine) {`:

```js
// CT-COMPAT: a tela declara a conta como não coberta pela arbitragem de postagem enquanto
// algum aparelho visto estiver numa versão que não participa. Só com a coordenação ligada.
function coberturaDasContas(engine, rt, cfg) {
  if (!coordinationActive(cfg) || typeof engine.accountList !== 'function') return [];
  return engine.accountList().map((a) => coberturaDePostagem(rt.devices, a.user));
}
```

No objeto devolvido por `statusForUi`, troque `    outbox: syncUsage.usageStatus(engine),` por:

```js
    outbox: syncUsage.usageStatus(engine),
    coberturaPostagem: coberturaDasContas(engine, rt, cfg),
```

- [ ] **Passo 5:** rodar `node --test test/cobertura-postagem.test.js test/sync-engine.test.js test/ui-pure-sync.test.js`. Esperado: verde.

- [ ] **Passo 6 (contraprova):** em `naoParticipa`, troque `return c === null || c < 0;` por `return c !== null && c < 0;`. Rode `node --test test/cobertura-postagem.test.js`: reprova `aparelho sem versão legível conta como antigo`. Restaure e rode: verde.

- [ ] **Passo 7:** commit.

```
git add lib/sync/cobertura-postagem.js lib/engine/sync.js test/cobertura-postagem.test.js
git commit -m "feat(sync): status declara a conta sem cobertura da arbitragem com aparelho antigo"
```

---

## Tarefa 11: trava de fonte das cinco vias

**Arquivos:** criar `test/postagem-fiacao-fonte.test.js`.

**Interfaces:** nenhuma. O teste lê os fontes e reprova se alguma via deixar de se identificar ao funil, se a co-assinatura coordenada perder `commitIdObrigatorio` ou `recuoPermitido: false`, ou se a revisão automática deixar de tratar posse perdida como perda de coordenação. É a mesma técnica de `test/motivo-nunca-vira-objeto.test.js`: consumidor sem trava é onde o bug volta.

- [ ] **Passo 1:** criar o teste.

```js
// As cinco vias de postagem se identificam ao funil (CT-POST, tabela "As vias com o controle
// comum"). Nenhuma via é declarada coberta sem esta trava e o teste de comportamento dela.
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const RAIZ = path.join(import.meta.dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

test('revisão automática: as duas postagens passam via revisao com o handle e lançam perda de coordenação', () => {
  const fonte = ler('lib/engine/review.js');
  assert.equal((fonte.match(/\{ via: 'revisao', handle: coord \}\);\n\s+lancarSePossePerdida\(post\);/g) || []).length, 2);
});

test('reenvio, clique e sessão se identificam', () => {
  const fonte = ler('lib/engine/decision.js');
  for (const via of ['reenvio', 'clique', 'sessao']) assert.ok(fonte.includes(`{ via: '${via}' }`), `via ${via}`);
});

test('co-assinatura coordenada: âncora obrigatória e recuo proibido', () => {
  const fonte = ler('lib/engine/coassinatura-coordenada.js');
  assert.ok(fonte.includes("{ via: 'coassinatura', handle, commitIdObrigatorio: head, recuoPermitido: false }"));
});

test('nenhuma outra chamada a postReview em lib/ fora das vias conhecidas', () => {
  const conhecidas = new Map([
    ['lib/engine/review.js', 2], ['lib/engine/decision.js', 3], ['lib/engine/skip-review.js', 1], ['lib/engine/coassinatura-coordenada.js', 1],
  ]);
  const dir = path.join(RAIZ, 'lib', 'engine');
  for (const nome of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const rel = `lib/engine/${nome}`;
    const achadas = (ler(rel).match(/engine\.postReview\(/g) || []).length;
    assert.equal(achadas, conhecidas.get(rel) || 0, rel);
  }
});
```

- [ ] **Passo 2:** rodar `node --test test/postagem-fiacao-fonte.test.js`. Esperado: verde (a fiação já existe). Se a contagem de `lib/engine/decision.js` ou `skip-review.js` divergir, confira com `grep -n "engine.postReview(" lib/engine/*.js` antes de ajustar o mapa: o número tem de corresponder às vias da tabela de CT-POST, e o `coAssinar` desligado conta como a chamada de `skip-review.js`.

- [ ] **Passo 3 (contraprova):** em `lib/engine/review.js`, troque a primeira ocorrência de `{ via: 'revisao', handle: coord }` por `{ handle: coord }`. Rode o arquivo: reprova o primeiro teste (contagem 1). Restaure e rode: verde.

- [ ] **Passo 4:** commit.

```
git add test/postagem-fiacao-fonte.test.js
git commit -m "test: trava de fonte das cinco vias de postagem no funil"
```

---

## Tarefa 12: gate completo e evidência

**Arquivos:** criar ou acrescentar seção em `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md`.

- [ ] **Passo 1:** gate completo.

```
npm run check && npm run lint && npm test
```

Esperado: os três verdes. `lint` sem nenhuma contagem acima da baseline. Se falhar, corrija o código; a baseline nunca sobe à mão.

- [ ] **Passo 2:** conferir byte a byte que nenhum teste existente foi tocado e que só os arquivos do mapa mudaram.

```
git diff --stat main...HEAD
git diff --name-status main...HEAD -- test/
```

Esperado: em `test/`, só linhas `A` (arquivos novos). Qualquer `M` num teste existente reprova a entrega.

- [ ] **Passo 3:** rodar a caracterização isolada mais uma vez e guardar a saída.

```
node --test test/postagem-coordenacao-desligada.test.js
```

- [ ] **Passo 4:** `npm run eng` (gate da constituição, obrigatório antes de qualquer push). Registre as oito avaliações escritas deste diff, cada uma com fundamentação própria.

- [ ] **Passo 5:** escrever no EXECUCAO.md uma seção `## C0b arbitragem de postagem` com: data; commit final (`git rev-parse HEAD`); números do gate de partida (Tarefa 0) e de chegada (contagem de testes do `npm test`); saída do Passo 3; a lista de contraprovas feitas (tarefa, mutação, teste que reprovou, restauração); e qualquer divergência de linha encontrada ao reconferir as âncoras depois da C0.

- [ ] **Passo 6:** commit.

```
git add docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md
git commit -m "docs: evidência da execução da C0b"
```

---

## Critérios de aceite da spec x testes

| Critério da 7.C0b | Teste |
|---|---|
| duas co-assinaturas concorrentes em dois aparelhos geram um único POST | `test/coassinatura-coordenada.test.js`: `duas co-assinaturas concorrentes em dois aparelhos: um único POST, ancorado` |
| co-assinatura concorrendo com revisão normal gera um único POST | `co-assinatura concorrendo com revisão normal que segura o PR` e `co-assinatura que sai primeiro: a revisão do outro aparelho não é admitida` |
| HEAD mudando entre a conferência e o POST não aprova o commit novo | `HEAD mudando entre a conferência e o POST` (co-assinatura) e `test/postagem-arbitragem.test.js`: `commitIdObrigatorio com head que andou depois da posse` |
| recuo sem âncora na co-assinatura não é tentado | `422 na co-assinatura: o recuo sem âncora não é tentado` e `recuoPermitido false: nenhuma segunda chamada depois do 422` |
| aceite seguido de queda antes do desfecho: `enviando`, sem repost, reconciliação confirma | `test/postagem-incerta.test.js`: `publicação aceita e queda antes do desfecho` |
| queda na fronteira: não é tratada como não enviada; `nao_enviada` só pelas duas leituras | `queda na fronteira: enviando sem io.run só vira nao_enviada com as duas leituras` e `test/postagem-reconciliacao.test.js` |
| perda de lease na espera da fila por processo: `io.run` não é chamado | `test/postagem-arbitragem.test.js`: `posse perdida durante a espera na fila por processo` |
| perda de lease e retomada depois de suspensão: não posta com posse vencida | `retomada depois de suspensão: posse vencida não posta` |
| reenvio automático com `enviando` pendente não posta | `test/postagem-vias.test.js`: `reenvio automático com enviando pendente não posta nem gasta tentativa` |
| dois cliques em aparelhos diferentes e clique durante revisão automática: um POST | `dois cliques em aparelhos diferentes` e `clique durante a revisão automática de outro aparelho` |
| chat depois de reinício não duplica | `chat depois de reinício não duplica review já publicado, nem num aparelho sem o arquivo local` |
| `myReviewStates` indisponível não autoriza em nenhuma via | `myReviewStates indisponível não autoriza postagem: revisão automática, reenvio, clique e chat`, `myReviewStates indisponível: a co-assinatura não posta` e `myReviewStates indisponível: não enviada por estado desconhecido` |
| convivência com versão antiga: a conta é declarada não coberta | `test/cobertura-postagem.test.js` (função pura e `statusForUi`) |
| coordenação desligada: comportamento de hoje, byte a byte nas chamadas ao `gh` | `test/postagem-coordenacao-desligada.test.js` (nasce verde antes da mudança) |
| perda de posse devolvida à revisão automática como perda de coordenação | `test/postagem-revisao-automatica.test.js`: `posse perdida no funil sobe como perda de coordenação` (approve e request_changes) |
| co-assinatura não é revisão fictícia | `co-assinatura não é revisão: não abre sessão nem registra sessão ativa` |
| co-assinatura que não saiu por dedup grava a marca | segunda metade de `duas co-assinaturas concorrentes...` |
| coordenação ligada e indisponível: nenhuma via posta | `coordenação ligada e banco recusando: nenhuma via posta, nem com handle` |
| o recibo passa a publicado a partir do funil | coberto pela chamada a `syncAtualizarPublicacao` (`marcarPublicado`); o comportamento da função é da C0 e é testado lá |

---

## Limites que continuam declarados

- **Não é exactly-once.** Entre a última conferência da posse e o pacote sair existe uma janela que nenhum código fecha; quem a cobre é o `enviando` com a reconciliação.
- **Aparelho em versão antiga não participa.** Ele coordena revisões por lease como hoje e posta por fora; a conta aparece como não coberta em `statusForUi().coberturaPostagem`. O desenho dessa informação na tela fica para a onda de telas (B2 no Claude Design); esta entrega só a põe no status.
- **A presença não diz quais contas cada aparelho usa.** Por isso todo aparelho visto conta para toda conta, o que pode declarar "não coberta" uma conta que o aparelho antigo nunca usou. O erro é para o lado seguro.
- **`POSTAGEM_COORDENADA_DESDE` nasce `2.59.4`.** O número real só existe depois de publicado (regra 4 de "Versionamento" do `CLAUDE.md`); o PR de release desta entrega precisa ajustar a constante para a versão publicada, senão um aparelho numa versão entre a 2.59.4 e a publicada, sem a arbitragem, seria contado como coberto.
- **Registro remoto só no banco, sem regra própria.** O filho `postagens/{EVENTO}` fica sob o nó de recibo, cuja `.validate` não roda em escrita de descendente; nenhuma regra nova é publicada nesta entrega (as regras v2 têm publicação única e manual, seção 10 da spec). O registro remoto aceita qualquer forma, e a leitura trata forma inválida como `enviando` (CT-FIO).
- **"Refazer neste aparelho" (`lib/engine/sync-redo.js`) apaga o nó do recibo órfão inteiro**, e junto um registro remoto de postagem que estivesse lá. A cópia local do aparelho que tentou continua segurando a dúvida nele; os outros aparelhos deixam de vê-la.
- **Duas instâncias do Farol no mesmo aparelho e na mesma conta** participam como dois aparelhos só se tiverem `deviceId` diferentes; com o mesmo `state/`, dividem também o `state/postagens.json`.
- **A reconciliação compara o horário do review no GitHub com o relógio da coordenação** (`rt.agora()`, corrigido pelo servidor do banco). Relógio do GitHub adiantado ou atrasado em relação a ele pode fazer um review verdadeiro não contar como prova da tentativa; nesse caso a regra das duas leituras conclui `nao_enviada`, e a próxima tentativa ainda passa pelo passo 2, que encontra o review no head e não posta.
- **COMMENT não é arbitrado.** O chat e o terminal conversam por COMMENT sem posse nem registro, como hoje.
- **Com a coordenação desligada nada disto vale**, inclusive as regras da co-assinatura (mesmo SHA, âncora, marca de concluída): o CT-COMPAT (b) não lista a co-assinatura entre as melhorias universais, então ela segue exatamente como hoje.
- **Registros `enviando` gravados com a coordenação ligada ficam parados se ela for desligada**: a reconciliação não roda, e o funil desligado não os lê.

## Ambiguidades encontradas no código, para o dono conferir antes de executar

1. **`reviewsDeOutros` serve a dois donos.** A spec manda o filtro dele deixar de aceitar head vazio e review sem `commit_id`, mas a mesma função alimenta `standDownCaducou`. Aplicar o filtro estrito ali faria a saída de cena caducar com head vazio (o Farol voltaria a revisar). O plano aplica o filtro estrito só no endosso (`{ mesmoSha: true }`) e mantém o tolerante na caducidade.
2. **Versão de corte da cobertura.** A presença não publica versão de contrato de postagem, e o número da release só existe depois de publicado; o plano usa `farolVersion` contra uma constante ajustada no PR de release.
3. **Margem da posse.** A spec diz "com margem" sem número; o plano usa 15 s (metade do batimento de 30 s). É parâmetro técnico, não decisão de produto, mas não está na spec.
4. **Recibo publicado para a co-assinatura.** O passo 7 manda atualizar o recibo "da operação"; a co-assinatura não tem operação própria. O plano usa o recibo da revisão daquele head (o mesmo nó do registro). Pelo plano da C0 (`atualizarPublicacaoDoRecibo`), sem recibo a função devolve `sem-recibo` e não cria nenhum; o plano trata isso como não falha. Consequência a confirmar: se o nó só tiver o filho `postagens`, a função da C0 o lê como recibo existente e grava `publicationState` e `lastVerifiedAt` num nó sem `outcome`. Isso não bloqueia admissão (`receiptBlocks` exige `outcome`) e o `complete()` de uma revisão posterior sobrescreve preservando `postagens`, mas é um nó de recibo parcial no banco.
6. **Duas chamadas de publicação no clique e no reenvio.** A C0 já chama `publicarRecibo` em `decide` e `retryFailedPosts`; o funil desta entrega chama `syncAtualizarPublicacao` de novo no `confirmada`. A segunda chamada devolve `inalterado` e não escreve; o plano não remove a da C0 para não misturar entregas.
5. **Dois aparelhos no mesmo processo nos testes.** O `STATE_DIR` é resolvido uma vez no import de `lib/paths.js`, então "FAROL_HOME separado" por aparelho não existe dentro de um processo; o plano separa o estado local pelo campo `engine.postagensArquivo`, lido só pelo registro de postagem.
