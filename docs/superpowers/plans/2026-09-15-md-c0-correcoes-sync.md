# C0 Correções da sincronização publicada: plano de implementação

> **Ajustes de execução (15/09/2026, valem sobre o texto abaixo):** worktree `C:\Users\wanderson\Documents\farol-md-exec`; branch `md/c0` cortada da ponta de `md/integracao` (base `origin/main` `8c043bc`, que já tem a modularização de `ui/pure/`, mais as entregas do lote já integradas); sem `git fetch`/`merge origin/main`. Onde o texto manda criar ou acrescentar seção no `EXECUCAO.md`, a evidência vai para `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/evidencias-execucao/c0.md` e o `EXECUCAO.md` recebe só a linha de estado, os commits e o caminho da evidência. Dependência de "entrega mergeada na main" significa integrada em `md/integracao`. Números esperados de testes são referência: o que vale é a medição na hora.


> **Para quem executa:** use superpowers:executing-plans, tarefa por tarefa, marcando os checkboxes.

**Objetivo:** corrigir os seis defeitos já publicados da sincronização entre dispositivos (spec 7.C0), cada um com um teste de ciclo inteiro que reprova antes da correção e passa depois, sem mudar gate de postagem, decisão de revisão nem escrita no GitHub.

**Arquitetura:** cada defeito é corrigido no ponto onde a causa foi medida, sem módulo novo de produção. (1) O engine passa a lembrar, em disco, os PRs vistos por recibo, e `reconciliarVistos` os respeita. (2) A rota `/api/settings` devolve o retorno inteiro de `updateSettings`, e a tela usa um texto puro único para as chaves ignoradas. (3) Uma função única em `lib/sync/receipts.js` atualiza o `publicationState` do recibo com CAS por ETag; um invólucro em `lib/engine/sync.js` a expõe ao engine, e `decide`, `retryFailedPosts` e o ramo `already_reviewed` a chamam. (4) O stream agenda um timer para o menor `expiresAt` visível. (5) O snapshot entrega o último estado decisivo meu no GitHub (`staleInfo[key].lastState`) e o selo do Panorama o usa antes do histórico local. (6) A frase de privacidade da tela e do `firebase/README.md` passa a listar o que sobe em claro, com um teste que lê os campos reais dos quatro payloads.

**Stack:** Node 24 ESM puro (`"type": "module"`), runner `node --test`, dublê do Realtime Database em `test/helpers/fake-rtdb.js` (ETag, `if-match`, `null_etag`, SSE, `setNow`). Zero pacote npm.

**Spec:** `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md`, seções 4.2, CT-COMPAT, 7.C0 (a entrega), 11 e 15.

## Restrições globais

- **Zero dependências** além do Electron (invariante 1 do `CLAUDE.md`). Nada de `npm install`.
- **Texto, comentário e commit em português, sem travessão.** Use vírgula, parênteses ou dois pontos. Comentário responde "por quê", nunca narra a sessão.
- **O ratchet do lint não pode subir** (`npm run lint`, regras em `tools/quality/rules.js`, baseline em `tools/quality/baseline.json`):
  - `JSON.parse`/`JSON.stringify` cru só em `lib/io.js` e `ui/pure/comum.js` (pasta `test/` é ignorada pelo gate);
  - `process.env` só em `lib/paths.js` e `lib/env.js`;
  - nenhum literal de tempo em propriedade (`ttl:`, `timeout:`, `delay:`...) nem `N * 60 * 1000` fora de `lib/constants.js` (use `TEMPOS`/`SYNC`);
  - nenhum `catch` vazio sem comentário de intenção dentro;
  - nenhum ternário aninhado (dois `?` no mesmo statement, descontados `?.` e `??`);
  - profundidade de chaves no máximo 4 contada do topo do arquivo (corpo de método de classe já é 2; objeto literal conta);
  - arquivo novo abaixo de 400 linhas úteis. `lib/engine/sync.js` está em 377 e termina esta entrega perto de 392: meça (Tarefa 3, passo 7).
- **Teste com `FAROL_HOME` temporário:** fixe `process.env.FAROL_HOME` no topo e carregue por `await import()` todo módulo do repositório que alcance `lib/paths.js` (`test/test-isolation.test.js` reprova import estático). Helpers de `test/helpers/`, `lib/sync/keys.js` e `ui/pure.js` podem ser estáticos.
- **Fachada nova em `server.js`** é de uma linha, `nome(a) { return xMod.impl(this, a); }`, e a implementação não usa parâmetro desestruturado com default (zeraria o `Function.length` que `test/facades.test.js` compara).
- **Nome novo exportado pelo `ui/pure.js`** entra na lista `CONGELADA` de `test/ui-pure-superficie.test.js` no mesmo commit.
- **Nenhuma atribuição de IA** em commit, PR ou release (sem `Co-Authored-By`, sem "Generated with").
- **Nunca push direto na `main`, nunca rebase, nunca force-push.** Nada toca o `~/.farol` real, o GitHub ou o Firebase de verdade.
- **CT-COMPAT (a):** com a sincronização desligada, nenhuma requisição ao banco e nenhum arquivo de sincronização novo. Cada tarefa que toca rede ou disco tem um caso que prova isso.

## Mapa de arquivos

| Arquivo | Tarefa | Responsabilidade da mudança |
|---|---|---|
| `server.js` | 1, 3, 5 | conjunto persistido `vistosPorRecibo` (construtor, `reconciliarVistos`, `unsee`, `marcarVistoPorRecibo`, `saveVistosPorRecibo`); fachada `syncAtualizarPublicacao`; projeção `reviewStatesGhParaUi` no snapshot |
| `lib/sync/coordinator.js` | 1 | `registrarRecibo` marca o PR como visto POR RECIBO |
| `lib/http-server.js` | 2 | rota `/api/settings` devolve o retorno inteiro de `updateSettings` |
| `ui/pure/sistema.js` | 2 | `settingsIgnoradasTexto(r)` |
| `ui/app.js` | 2, 5 | três handlers usam `settingsIgnoradasTexto`; `ctxPano` recebe `reviewStatesGh` |
| `lib/sync/receipts.js` | 3 | `atualizarPublicacaoDoRecibo(client, ids, {...})` |
| `lib/engine/sync.js` | 3, 6 | `syncAtualizarPublicacao(engine, dados)`; exporta `presencaDe` |
| `lib/engine/decision.js` | 3 | `publicarRecibo` chamado em `decide` (post ok e `already_reviewed`) e em `retryFailedPosts` |
| `ui/pure/sync.js` | 3 | `syncLinhaRecibo` mostra o `publicationState` real |
| `lib/engine/sync-stream.js` | 4 | `proximoVencimentoDe`, `agendarVencimento`, `aoVencer`; `fecharStream` desarma |
| `ui/pure/radar.js` | 5 | `kindDaRevisao` e `panoramaRowHtml` usam o estado do GitHub |
| `ui/pure/review.js` | 5 | `reviewChip(pr, actions, estadosGh)` |
| `ui/index.html` | 6 | frase de privacidade da seção `sys-sync` |
| `firebase/README.md` | 6 | seção "O que sobe para o banco" |
| `test/sync-recibo-visto-ciclo.test.js` (novo) | 1 | ciclo inteiro, reinício e CT-COMPAT |
| `test/http.test.js` | 2 | rota devolve `ignoradas` |
| `test/settings-ignoradas.test.js` (novo) | 2 | texto puro e os três handlers |
| `test/ui-pure-superficie.test.js` | 2 | nome novo `settingsIgnoradasTexto` |
| `test/sync-publicacao-recibo.test.js` (novo) | 3 | função de recibo, invólucro, `decide`, `already_reviewed`, `retryFailedPosts` |
| `test/sync-receipts.test.js` | 3 | lista de exports |
| `test/ui-pure-sync.test.js` | 3 | chip do recibo |
| `test/sync-stream.test.js` | 4 | teste do lease vencido atualizado DE PROPÓSITO; pura e `fecharStream` |
| `test/selo-panorama-gh.test.js` (novo) | 5 | dois ciclos de `refreshStaleStates` até o HTML |
| `test/sync-privacidade.test.js` (novo) | 6 | frase contra os campos reais |
| `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md` (novo) | 7 | critério de aceite x teste |

**Âncoras.** As linhas de `server.js`, `lib/` e `ui/app.js` foram conferidas e são iguais em `f80394e` e em `origin/main` (`8c043bc`). As de `ui/pure/*.js` são as de `origin/main`: em `f80394e` o conteúdo ainda morava no `ui/pure.js` monolítico, e a Tarefa 1 traz a `main` antes de qualquer edição.

---

### Tarefa 1: PR bloqueado por recibo não oscila na fila

**Arquivos:**
- Modificar: `server.js:314-322` (construtor, logo depois de `this.parkedPruneStrikes = new Map();`), `server.js:548-573` (`reconciliarVistos`), `server.js:582-586` (depois de `saveIgnorados`), `server.js:594` (`unsee`)
- Modificar: `lib/sync/coordinator.js:75-89` (`registrarRecibo`)
- Criar: `test/sync-recibo-visto-ciclo.test.js`

**Interfaces:**
- Consome: `registrarRecibo(engine, ctx, receipt)` de `lib/sync/coordinator.js`; `Engine._coletarPanorama()` devolve `{ panorama, queue, fresh, mineList, ownersOk, monitoredOwners }`.
- Produz: `engine.vistosPorRecibo: Set<string>`; `engine.marcarVistoPorRecibo(key: string): void`; `engine.saveVistosPorRecibo(): void`; arquivo `state/sync-vistos-por-recibo.json` (array de chaves), criado só na primeira marcação.

- [ ] **Passo 0: preparar a branch e confirmar a base verde**

```bash
cd /c/Users/wanderson/Documents/farol-md-exec
git switch md/integracao
git switch -c md/c0
git log --oneline -1 8c043bc
ls ui/pure/radar.js ui/pure/review.js ui/pure/sync.js ui/pure/sistema.js
npm run check && npm run lint && npm test
```

Esperado: merge sem conflito (a branch da spec só acrescenta documentos), os quatro arquivos listados e os três comandos verdes. Se algo já estiver vermelho antes de tocar código, pare e registre: não é defeito desta entrega.

- [ ] **Passo 1: escrever o teste que falha**

Criar `test/sync-recibo-visto-ciclo.test.js`:

```js
// C0, defeito 1 (spec 7.C0): PR bloqueado por recibo de outro aparelho oscilava na fila.
//
// A admissão ouve "recibo" e o coordenador marca o PR como visto (registrarRecibo). No
// ciclo seguinte reconciliarVistos via "visto sem decisão local" e devolvia o PR à fila
// como se fosse uma revisão que morreu no meio; a automação o admitia de novo, ouvia o
// mesmo recibo e o WARN saía em todo ciclo. Reiniciar o app recomeçava a oscilação.
//
// O teste roda o CICLO de verdade (_coletarPanorama, que é onde reconciliarVistos é
// chamado antes do filtro da fila), com a busca do gh stubada.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-recibo-visto-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { STATE_DIR, IGNORED_FILE, BASELINE_FILE } = await import('../lib/paths.js');
const { registrarRecibo } = await import('../lib/sync/coordinator.js');

after(() => {
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

const KEY = 'org/repo#42';
const PR = { key: KEY, url: 'https://github.com/org/repo/pull/42', repo: 'org/repo', number: 42, title: 't', author: 'dev', updatedAt: '2026-09-15T10:00:00Z' };
const ARQUIVO = path.join(STATE_DIR, 'sync-vistos-por-recibo.json');

// baseline já feito e ignorados já migrado: sem isso o primeiro ciclo marcaria o PR como
// descarte deliberado e o teste não mediria nada
fs.mkdirSync(STATE_DIR, { recursive: true });
fs.writeFileSync(BASELINE_FILE, '2026-09-15T00:00:00.000Z\n');
fs.writeFileSync(IGNORED_FILE, '');

function motor() {
  const e = new Engine();
  e.logs = [];
  e.log = (nivel, msg) => { e.logs.push(`${nivel} ${msg}`); };
  e.pushState = () => { };
  e.resolveAccount = async () => { };
  e.refreshTokens = async () => { };
  e.accountList = () => [{ user: 'eu', owners: ['org'] }];
  e.tokenFor = () => 'tok';
  e.isMuted = () => false;
  e.accountForPr = () => 'eu';
  e.accountForOwner = () => 'eu';
  e.myAuthoredPRs = async () => [];
  e.searchPRs = async (args) => (args[0] === '--reviewed-by=@me' ? [] : [{ ...PR }]);
  return e;
}

const voltouComWarn = (e) => e.logs.some((l) => /voltaram à fila/.test(l));

test('PR bloqueado por recibo não volta à fila nem loga WARN nos ciclos seguintes, nem depois de reiniciar', async () => {
  const e = motor();
  const c1 = await e._coletarPanorama();
  assert.equal(c1.queue.some((p) => p.key === KEY), true, 'ciclo 1: PR novo está na fila');
  assert.equal(fs.existsSync(ARQUIVO), false, 'sem recibo nenhum, nenhum arquivo novo (CT-COMPAT)');

  // a automação lança (markSeen do lançamento) e a admissão ouve "recibo"
  e.markSeen(KEY);
  registrarRecibo(e, { prKey: KEY, operationKind: 'review' }, { deviceId: 'dOutro', completedAt: Date.now(), publicationState: 'published', operationKind: 'review' });
  assert.equal(fs.existsSync(ARQUIVO), true, 'o visto por recibo vai para o disco');

  for (const ciclo of [2, 3]) {
    const c = await e._coletarPanorama();
    assert.equal(c.queue.some((p) => p.key === KEY), false, `ciclo ${ciclo}: não volta à fila`);
    assert.equal(voltouComWarn(e), false, `ciclo ${ciclo}: nenhum WARN de devolução`);
  }

  const reiniciado = motor();
  assert.equal(reiniciado.seen.has(KEY), true);
  assert.equal(reiniciado.vistosPorRecibo.has(KEY), true, 'o conjunto sobrevive ao reinício');
  const c4 = await reiniciado._coletarPanorama();
  assert.equal(c4.queue.some((p) => p.key === KEY), false, 'depois do reinício também não volta');
  assert.equal(voltouComWarn(reiniciado), false, 'nem loga WARN depois do reinício');
});

test('unsee tira a chave do conjunto e grava: PR que volta à fila por outro caminho não fica protegido pra sempre', () => {
  const e = motor();
  e.marcarVistoPorRecibo('org/repo#77');
  e.seen.add('org/repo#77');
  e.unsee('org/repo#77');
  assert.equal(e.vistosPorRecibo.has('org/repo#77'), false);
  assert.equal(JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')).includes('org/repo#77'), false);
});

test('arquivo com formato errado degrada para conjunto vazio sem derrubar o boot', () => {
  const salvo = fs.readFileSync(ARQUIVO, 'utf8');
  fs.writeFileSync(ARQUIVO, '{}');
  try {
    const e = motor();
    assert.equal(e.vistosPorRecibo.size, 0);
  } finally {
    fs.writeFileSync(ARQUIVO, salvo);
  }
});
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `node --test --test-force-exit test/sync-recibo-visto-ciclo.test.js`
Esperado: FAIL. O primeiro caso reprova em `ciclo 2: não volta à fila` (o PR volta, com WARN). Os outros dois reprovam com `TypeError` (`marcarVistoPorRecibo` e `vistosPorRecibo` não existem).

- [ ] **Passo 3: implementar no `server.js`**

3a. No construtor, logo depois da linha `this.parkedPruneStrikes = new Map(); // key estacionada -> ausências SEGUIDAS do panorama (memória; reinício zera, lado seguro)`, acrescentar:

```js
    // PRs marcados vistos porque OUTRO aparelho já analisou o head (recibo da
    // sincronização). Persistido porque reconciliarVistos os confundia com revisão que
    // morreu no meio: sem o arquivo, todo reinício devolvia esses PRs à fila, a admissão
    // ouvia o mesmo recibo e o WARN voltava. Formato errado degrada pra vazio, mesmo
    // guarda-corpo do estacionamento acima (`{}` é JSON válido e não é lista).
    const vistosRecibo = readJson(path.join(STATE_DIR, 'sync-vistos-por-recibo.json'), [], warn);
    this.vistosPorRecibo = new Set(Array.isArray(vistosRecibo) ? vistosRecibo.filter(k => typeof k === 'string') : []);
```

3b. Em `reconciliarVistos`, trocar o comentário e a linha de exclusão. Substituir:

```js
  // Devolve à fila o que foi marcado como visto por uma revisão que NUNCA decidiu:
  // a sessão morreu no meio (app fechado, crash, falha não classificada) e o PR
  // saiu da fila pra sempre, exigindo clique manual. Não toca no que foi descartado
  // de propósito, no que tem decisão, nem no que está em andamento, estacionado ou
  // aguardando retry, que são estados legítimos.
```

por:

```js
  // Devolve à fila o que foi marcado como visto por uma revisão que NUNCA decidiu:
  // a sessão morreu no meio (app fechado, crash, falha não classificada) e o PR
  // saiu da fila pra sempre, exigindo clique manual. Não toca no que foi descartado
  // de propósito, no que tem decisão, no que outro aparelho já analisou (visto por
  // recibo), nem no que está em andamento, estacionado ou aguardando retry, que são
  // estados legítimos.
```

e substituir:

```js
      if (this.ignorados.has(k) || comDecisao.has(k)) continue;
```

por:

```js
      if (this.ignorados.has(k) || comDecisao.has(k) || this.vistosPorRecibo?.has(k)) continue;
```

3c. Logo depois do método `saveIgnorados() { ... }` (termina em `writeTextAtomic(IGNORED_FILE, ...);\n  }`), acrescentar:

```js

  // Marcado como visto pela coordenação: a análise deste head terminou em outro
  // aparelho (lib/sync/coordinator.js, registrarRecibo). Grava só quando muda, então
  // quem nunca ligou a sincronização nunca ganha o arquivo.
  marcarVistoPorRecibo(key) {
    if (!this.vistosPorRecibo) this.vistosPorRecibo = new Set();
    if (!this.vistosPorRecibo.has(key)) { this.vistosPorRecibo.add(key); this.saveVistosPorRecibo(); }
  }

  saveVistosPorRecibo() {
    ensureDir(STATE_DIR);
    writeJsonAtomic(path.join(STATE_DIR, 'sync-vistos-por-recibo.json'), [...(this.vistosPorRecibo || [])]);
  }
```

3d. Substituir:

```js
  unsee(key) { if (this.seen.delete(key)) this.saveSeen(); }
```

por:

```js
  // o PR que volta à fila (re-request, destrave, restore, bloqueio de coordenação) deixa
  // de ser "visto por recibo": a proteção do reconciliarVistos vale só enquanto ele está visto
  unsee(key) { if (this.seen.delete(key)) this.saveSeen(); if (this.vistosPorRecibo?.delete(key)) this.saveVistosPorRecibo(); }
```

- [ ] **Passo 4: implementar no coordenador**

Em `lib/sync/coordinator.js`, substituir:

```js
// Memória para a tela (recibosVistos) e, na revisão, o PR vira visto: sem isso o
// toReview o relançaria a cada ciclo só para ouvir a mesma recusa. No pushback quem
// avança o marcador é o chamador, que conhece o marcador.
```

por:

```js
// Memória para a tela (recibosVistos) e, na revisão, o PR vira visto POR RECIBO: sem
// isso o toReview o relançaria a cada ciclo só para ouvir a mesma recusa, e sem o motivo
// o reconciliarVistos o devolveria à fila como revisão que morreu. No pushback quem
// avança o marcador é o chamador, que conhece o marcador.
```

e substituir:

```js
  if (ctx.operationKind === 'review' && typeof engine.markSeen === 'function') engine.markSeen(ctx.prKey);
```

por:

```js
  if (ctx.operationKind !== 'review') return;
  if (typeof engine.markSeen === 'function') engine.markSeen(ctx.prKey);
  if (typeof engine.marcarVistoPorRecibo === 'function') engine.marcarVistoPorRecibo(ctx.prKey);
```

- [ ] **Passo 5: rodar e ver passar**

Run: `node --test --test-force-exit test/sync-recibo-visto-ciclo.test.js test/seen-vazado.test.js test/sync-coordinator.test.js test/sync-review.test.js`
Esperado: PASS em todos.

- [ ] **Passo 6: contraprova**

Em `server.js`, apague ` || this.vistosPorRecibo?.has(k)` da linha de exclusão de `reconciliarVistos`.
Run: `node --test --test-force-exit test/sync-recibo-visto-ciclo.test.js`
Esperado: FAIL em `ciclo 2: não volta à fila`.
Restaure a linha, rode de novo e confirme PASS. Depois, na linha do construtor, troque `readJson(path.join(STATE_DIR, 'sync-vistos-por-recibo.json'), [], warn)` por `[]`; rode e confirme FAIL em `o conjunto sobrevive ao reinício`; restaure e confirme PASS. `git diff` deve mostrar só as mudanças dos passos 3 e 4.

- [ ] **Passo 7: commit**

```bash
git add server.js lib/sync/coordinator.js test/sync-recibo-visto-ciclo.test.js
git commit -m "fix(sync): PR bloqueado por recibo de outro aparelho não volta à fila a cada ciclo"
```

---

### Tarefa 2: `/api/settings` devolve `ignoradas` e a tela mostra

**Arquivos:**
- Modificar: `lib/http-server.js:168`
- Modificar: `ui/pure/sistema.js` (acrescentar no fim do arquivo)
- Modificar: `ui/app.js:21-22` (import), `ui/app.js:1055-1064` (`saveJiraSites`), `ui/app.js:1292-1305` (`saveSync`), `ui/app.js:4285-4296` (laço do `settingsMap`)
- Modificar: `test/http.test.js` (acrescentar no fim), `test/ui-pure-superficie.test.js` (lista `CONGELADA`)
- Criar: `test/settings-ignoradas.test.js`

**Interfaces:**
- Consome: `Engine.updateSettings(patch)` devolve `{ ok: true, ignoradas: string[], sync }` (`server.js:1732-1780`).
- Produz: resposta de `POST /api/settings` = `{ ok: true, ignoradas: string[], sync, config }`; `settingsIgnoradasTexto(r): string` exportado por `ui/pure.js` (vazio quando nada foi ignorado).

- [ ] **Passo 1: escrever os testes que falham**

Acrescentar no fim de `test/http.test.js`:

```js

/* C0, defeito 2: a rota descartava o retorno de updateSettings e mandava só
   { ok, config }. Os três ramos de erro da tela (saveSync, settingsMap e sites do Jira)
   liam r.ignoradas, que nunca chegava, e a tela dizia "salvo" para o que foi recusado. */
test('POST /api/settings devolve as chaves ignoradas junto da config', async () => {
  const r = await post('/api/settings', { chaveQueNaoExiste: 1 });
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.ok, true);
  assert.deepEqual(j.ignoradas, ['chaveQueNaoExiste']);
  assert.ok(j.config && typeof j.config === 'object', 'a config continua vindo');
  assert.equal('chaveQueNaoExiste' in j.config, false, 'o que foi ignorado não entra na config');
});
```

Criar `test/settings-ignoradas.test.js`:

```js
// C0, defeito 2: o texto que a tela mostra quando o servidor recusa uma preferência, e a
// garantia de que os TRÊS salvamentos da tela usam o mesmo texto. Antes cada handler
// só olhava a própria chave, e a rota nem devolvia a lista.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { settingsIgnoradasTexto } from '../ui/pure.js';

test('settingsIgnoradasTexto: vazio quando tudo entrou ou quando a resposta não diz nada', () => {
  assert.equal(settingsIgnoradasTexto({ ok: true, ignoradas: [] }), '');
  assert.equal(settingsIgnoradasTexto({ ok: true }), '');
  assert.equal(settingsIgnoradasTexto(null), '');
  assert.equal(settingsIgnoradasTexto({ ignoradas: 'sync' }), '', 'formato errado não inventa recusa');
});

test('settingsIgnoradasTexto: uma chave', () => {
  assert.equal(settingsIgnoradasTexto({ ignoradas: ['sync'] }), '"sync" não foi salva: o servidor não reconhece essa preferência.');
});

test('settingsIgnoradasTexto: várias chaves, e item que não é texto fica de fora', () => {
  assert.equal(settingsIgnoradasTexto({ ignoradas: ['a', 7, 'b'] }), '"a", "b" não foram salvas: o servidor não reconhece essas preferências.');
});

test('os três salvamentos da tela usam o texto das ignoradas, e nenhum filtra pela própria chave', () => {
  const app = fs.readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
  assert.equal((app.match(/settingsIgnoradasTexto\(r\)/g) || []).length, 3, 'saveJiraSites, saveSync e o laço do settingsMap');
  assert.equal(/r\.ignoradas\.includes\(/.test(app), false, 'filtrar pela própria chave escondia a recusa das outras');
});
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `node --test --test-force-exit test/http.test.js test/settings-ignoradas.test.js`
Esperado: FAIL. Em `http.test.js`, `j.ignoradas` chega `undefined`. Em `settings-ignoradas.test.js`, o import falha (`settingsIgnoradasTexto` não é exportado).

- [ ] **Passo 3: implementar a rota**

Em `lib/http-server.js`, substituir:

```js
        if (p === '/api/settings') { engine.updateSettings(body || {}); return send(200, { ok: true, config: engine.config }); }
```

por:

```js
        if (p === '/api/settings') { const r = engine.updateSettings(body || {}); return send(200, { ...r, config: engine.config }); }
```

- [ ] **Passo 4: implementar o texto puro**

Acrescentar no fim de `ui/pure/sistema.js`:

```js

// O que o servidor recusou num salvamento de preferências, em frase de toast. Vazio
// quando tudo entrou. Um texto só para os três salvamentos da tela: cada handler olhando
// a própria chave escondia a recusa das outras.
export function settingsIgnoradasTexto(r) {
  const lista = r && Array.isArray(r.ignoradas) ? r.ignoradas.filter((k) => typeof k === 'string' && k) : [];
  if (!lista.length) return '';
  const nomes = lista.map((k) => `"${k}"`).join(', ');
  if (lista.length === 1) return `${nomes} não foi salva: o servidor não reconhece essa preferência.`;
  return `${nomes} não foram salvas: o servidor não reconhece essas preferências.`;
}
```

Em `test/ui-pure-superficie.test.js`, na lista `CONGELADA`, acrescentar a linha `  "settingsIgnoradasTexto",` imediatamente depois de `  "sessionRefMention",`.

- [ ] **Passo 5: implementar os três handlers**

5a. Em `ui/app.js`, substituir:

```js
  filaJustaHtml, syncSecaoHtml, syncConfirmacoesDoClique, usageConsolidadoEnvelopeHtml, syncCfgComGeral
} from './pure.js';
```

por:

```js
  filaJustaHtml, syncSecaoHtml, syncConfirmacoesDoClique, usageConsolidadoEnvelopeHtml, syncCfgComGeral,
  settingsIgnoradasTexto
} from './pure.js';
```

5b. Em `saveJiraSites`, substituir:

```js
  api('/api/settings', { jiraSites: sites }).then(r => {
    if (r && Array.isArray(r.ignoradas) && r.ignoradas.includes('jiraSites')) {
      toast('error', '"jiraSites" não foi salvo: o servidor não reconhece essa preferência.', 6000);
      return;
    }
```

por:

```js
  api('/api/settings', { jiraSites: sites }).then(r => {
    const recusa = settingsIgnoradasTexto(r);
    if (recusa) {
      toast('error', recusa, 6000);
      return;
    }
```

5c. Em `saveSync`, substituir:

```js
  api('/api/settings', { sync }).then(r => {
    if (r && Array.isArray(r.ignoradas) && r.ignoradas.includes('sync')) {
      toast('error', '"sync" não foi salvo: o servidor não reconhece essa preferência.', 6000);
      return;
    }
```

por:

```js
  api('/api/settings', { sync }).then(r => {
    const recusa = settingsIgnoradasTexto(r);
    if (recusa) {
      toast('error', recusa, 6000);
      return;
    }
```

5d. No laço do `settingsMap`, substituir:

```js
    if (r && Array.isArray(r.ignoradas) && r.ignoradas.includes(key)) {
      toast('error', `"${key}" não foi salva: o servidor não reconhece essa preferência.`, 6000);
      return;
    }
```

por:

```js
    const recusa = settingsIgnoradasTexto(r);
    if (recusa) {
      toast('error', recusa, 6000);
      return;
    }
```

- [ ] **Passo 6: rodar e ver passar**

Run: `node --test --test-force-exit test/http.test.js test/settings-ignoradas.test.js test/ui-pure-superficie.test.js test/ui-contract.test.js test/settings-fonte-unica.test.js`
Esperado: PASS em todos.

- [ ] **Passo 7: contraprova**

Em `lib/http-server.js`, volte a rota para `{ engine.updateSettings(body || {}); return send(200, { ok: true, config: engine.config }); }`.
Run: `node --test --test-force-exit test/http.test.js`
Esperado: FAIL em `POST /api/settings devolve as chaves ignoradas junto da config`.
Restaure, rode e confirme PASS.

- [ ] **Passo 8: commit**

```bash
git add lib/http-server.js ui/pure/sistema.js ui/app.js test/http.test.js test/settings-ignoradas.test.js test/ui-pure-superficie.test.js
git commit -m "fix(settings): a rota devolve as preferências ignoradas e a tela deixa de dizer salvo"
```

---

### Tarefa 3: recibo publicado depois de postagem fora da revisão automática

**Arquivos:**
- Modificar: `lib/sync/receipts.js:10-11` (imports), acrescentar a função antes de `export default` (`:96-97`)
- Modificar: `lib/engine/sync.js:17` e `:22` (imports), depois de `redoReceipt` (`:482`), exports (`:527-536`)
- Modificar: `server.js:1811` (fachada, depois de `syncRedoReceipt`)
- Modificar: `lib/engine/decision.js:966` (helper antes de `decide`), `:1004` (ramo `already_reviewed`), `:1058-1060` (post ok), `:375-377` (`retryFailedPosts`)
- Modificar: `ui/pure/sync.js:233-240` (`syncLinhaRecibo`)
- Modificar: `test/sync-receipts.test.js:40-44`, `test/ui-pure-sync.test.js` (depois do teste da linha 199)
- Criar: `test/sync-publicacao-recibo.test.js`

**Interfaces:**
- Consome: `readReceipt(client, ids, fingerprint)` devolve `{ ok, receipt, etag }`; `writeReceipt(client, ids, fingerprint, receipt, { ifMatch })` devolve `{ ok }` ou `{ ok: false, code }`; `operationFingerprint(kind, materialVersion)` lança com versão vazia.
- Produz (outras entregas dependem desta assinatura exata, a C0b chama as duas a partir do funil):
  - `lib/sync/receipts.js`: `async function atualizarPublicacaoDoRecibo(client, ids, { operationKind, materialVersion, publicationState, nowMs })` devolve `{ ok: boolean, motivo: string }`, com `motivo` em `atualizado` | `inalterado` | `sem-recibo` | `conflito` | `estado-invalido` | `versao-invalida` | frase de indisponibilidade do cliente. Nunca cria recibo, nunca lança.
  - `lib/engine/sync.js`: `async function syncAtualizarPublicacao(engine, { account, prKey, headSha, operationKind, publicationState })` devolve `{ ok, motivo }`; `{ ok: false, motivo: 'coordenacao-desligada' }` sem coordenação ativa, sem tocar a rede; `sem-conexao` e `contexto-incompleto` nos outros casos de recusa. Nunca lança.
  - `Engine.syncAtualizarPublicacao(dados)`.

- [ ] **Passo 1: escrever os testes que falham**

Criar `test/sync-publicacao-recibo.test.js`:

```js
// C0, defeito 3 (spec 7.C0): recibo ficava 'pending' para sempre depois de uma postagem
// que saiu FORA da revisão automática (clique em decide, reenvio do retryFailedPosts,
// review já no PR). Outro aparelho via o recibo pendente, e passada uma semana o
// oferecia como órfão com "Refazer" pago para um PR já postado.
//
// O banco é o dublê em processo; o engine é o real, com o runtime da sincronização
// montado à mão como conectado (mesmo formato que o coordenador lê).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-publicacao-recibo-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { accountHash, prHash, operationFingerprint } from '../lib/sync/keys.js';

const { Engine } = await import('../server.js');
const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const { SYNC } = await import('../lib/constants.js');
const { buildReceipt, readReceipt, writeReceipt, receiptOrphanState, atualizarPublicacaoDoRecibo } = await import('../lib/sync/receipts.js');

const TOKEN = 'tok-ok';
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const KEY = 'Org/Repo#7';
const IDS = { uid: 'u1', accountHash: accountHash('eu'), prHash: prHash(KEY) };
const FP = operationFingerprint('review', HEAD);
const PUBLICAR = { operationKind: 'review', materialVersion: HEAD, publicationState: 'published' };
let fake;

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => {
  await fake.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; });

function cliente() {
  return createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: TOKEN }) });
}

function reciboDe(extra = {}) {
  return buildReceipt({
    operationKind: 'review', materialVersion: HEAD, deviceId: 'dEu', leaseId: 'L1', nowMs: Date.now(),
    outcome: 'completed', publicationState: 'pending', reviewId: '', farolVersion: '9.9.9', ...extra,
  });
}

async function gravar(extra = {}) {
  const r = reciboDe(extra);
  const w = await writeReceipt(cliente(), IDS, FP, r, { ifMatch: 'null_etag' });
  assert.equal(w.ok, true, 'o recibo de partida precisa existir no banco');
  fake.requests.length = 0;
  return r;
}

async function noBanco() {
  const r = await readReceipt(cliente(), IDS, FP);
  assert.equal(r.ok, true);
  return r.receipt;
}

const puts = () => fake.requests.filter((q) => q.method === 'PUT').length;

// --- a função de lib/sync/receipts.js ------------------------------------------------

test('atualizarPublicacaoDoRecibo: pending vira published, lastVerifiedAt novo e o resto intacto', async () => {
  const antes = await gravar();
  const r = await atualizarPublicacaoDoRecibo(cliente(), IDS, { ...PUBLICAR, nowMs: antes.completedAt + 5000 });
  assert.deepEqual(r, { ok: true, motivo: 'atualizado' });
  assert.deepEqual(await noBanco(), { ...antes, publicationState: 'published', lastVerifiedAt: antes.completedAt + 5000 });
  const put = fake.requests.find((q) => q.method === 'PUT');
  assert.ok(put.headers['if-match'] && put.headers['if-match'] !== 'null_etag', 'escrita condicionada ao etag lido');
});

test('atualizarPublicacaoDoRecibo: sem recibo não cria um, e estado já igual não escreve', async () => {
  assert.deepEqual(await atualizarPublicacaoDoRecibo(cliente(), IDS, { ...PUBLICAR, nowMs: Date.now() }), { ok: false, motivo: 'sem-recibo' });
  assert.equal(puts(), 0, 'recibo sem análise deste aparelho seria afirmação falsa');
  await gravar({ publicationState: 'published' });
  assert.deepEqual(await atualizarPublicacaoDoRecibo(cliente(), IDS, { ...PUBLICAR, nowMs: Date.now() }), { ok: true, motivo: 'inalterado' });
  assert.equal(puts(), 0);
});

test('atualizarPublicacaoDoRecibo: estado fora da lista e versão vazia recusam sem tocar a rede', async () => {
  const c = cliente();
  assert.deepEqual(await atualizarPublicacaoDoRecibo(c, IDS, { ...PUBLICAR, publicationState: 'publicado', nowMs: 1 }), { ok: false, motivo: 'estado-invalido' });
  assert.deepEqual(await atualizarPublicacaoDoRecibo(c, IDS, { ...PUBLICAR, materialVersion: '', nowMs: 1 }), { ok: false, motivo: 'versao-invalida' });
  assert.equal(fake.requests.length, 0);
});

test('atualizarPublicacaoDoRecibo: outro aparelho regravou entre a leitura e a escrita, e o dele fica', async () => {
  await gravar();
  const real = cliente();
  const doOutro = reciboDe({ deviceId: 'dOutro', publicationState: 'failed' });
  const intruso = {
    get: (...a) => real.get(...a),
    put: async (...a) => {
      fake.setTree({ users: { u1: { receipts: { [IDS.accountHash]: { [IDS.prHash]: { [FP]: doOutro } } } } } });
      return real.put(...a);
    },
  };
  assert.deepEqual(await atualizarPublicacaoDoRecibo(intruso, IDS, { ...PUBLICAR, nowMs: Date.now() }), { ok: false, motivo: 'conflito' });
  assert.equal((await noBanco()).deviceId, 'dOutro');
});

// --- o engine: invólucro e os três pontos que postam fora da revisão automática --------

const PR = { key: KEY, url: 'https://github.com/Org/Repo/pull/7', repo: 'Org/Repo', number: 7, title: 't', author: 'dev', account: 'eu' };

function motor({ coordenacao = true, states = [], postOk = true } = {}) {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.saveDecisions = () => { };
  e.writeMemory = () => { };
  e.accountForPr = () => 'eu';
  e.headSha = async () => HEAD;
  e.myReviewStates = async () => states;
  e.postados = [];
  e.postReview = async (pr, payload) => { e.postados.push(payload); return postOk ? { ok: true } : { ok: false, error: 'HTTP 503' }; };
  if (coordenacao) {
    e.config.sync = { enabled: true, coordination: { enabled: true }, consolidation: { enabled: false } };
    Object.assign(e.sync, { status: 'conectado', uid: 'u1', deviceId: 'dEu', client: cliente() });
  }
  return e;
}

function pendencia(extra = {}) {
  return {
    id: 'd-7', createdAt: Date.now(), status: 'pending', verdict: 'approve', key: KEY, pr: { ...PR }, headSha: HEAD,
    reasons: [], payloads: { approve: { event: 'APPROVE', body: 'Li com calma e está tudo certo.' } }, ...extra,
  };
}

test('syncAtualizarPublicacao: sem coordenação devolve coordenacao-desligada e não toca o banco (CT-COMPAT)', async () => {
  const e = motor({ coordenacao: false });
  const r = await e.syncAtualizarPublicacao({ account: 'eu', prKey: KEY, headSha: HEAD, operationKind: 'review', publicationState: 'published' });
  assert.deepEqual(r, { ok: false, motivo: 'coordenacao-desligada' });
  assert.equal(fake.requests.length, 0);
});

test('syncAtualizarPublicacao: sem conexão ou sem conta e head recusa sem tocar o banco', async () => {
  const e = motor();
  assert.deepEqual(await e.syncAtualizarPublicacao({ account: '', prKey: KEY, headSha: HEAD, publicationState: 'published' }), { ok: false, motivo: 'contexto-incompleto' });
  assert.deepEqual(await e.syncAtualizarPublicacao({ account: 'eu', prKey: KEY, headSha: '', publicationState: 'published' }), { ok: false, motivo: 'contexto-incompleto' });
  e.sync.status = 'erro';
  assert.deepEqual(await e.syncAtualizarPublicacao({ account: 'eu', prKey: KEY, headSha: HEAD, publicationState: 'published' }), { ok: false, motivo: 'sem-conexao' });
  assert.equal(fake.requests.length, 0);
});

test('decide com postagem ok deixa o recibo do head published, e o outro aparelho nunca o vê como órfão', async () => {
  await gravar();
  const e = motor();
  e.decisions = { pending: [pendencia()], resolved: [] };
  const r = await e.decide('d-7', 'approve');
  assert.equal(r.ok, true);
  assert.equal(e.postados.length, 1);
  const recibo = await noBanco();
  assert.equal(recibo.publicationState, 'published');
  const muitoDepois = Date.now() + 5 * SYNC.ORPHAN_AFTER_MS;
  assert.equal(receiptOrphanState(recibo, { lastSeenAt: 1 }, muitoDepois), 'ativo', 'publicado nunca vira "Refazer" pago em outro aparelho');
});

test('decide com postagem que falhou deixa o recibo como estava', async () => {
  await gravar();
  const e = motor({ postOk: false });
  e.decisions = { pending: [pendencia()], resolved: [] };
  const r = await e.decide('d-7', 'approve');
  assert.equal(r.ok, false);
  assert.equal((await noBanco()).publicationState, 'pending');
});

test('decide que acha o review já no PR (already_reviewed) também publica o recibo', async () => {
  await gravar();
  const e = motor({ states: ['APPROVED'] });
  e.decisions = { pending: [pendencia()], resolved: [] };
  const r = await e.decide('d-7', 'approve');
  assert.equal(r.ok, true);
  assert.equal(e.postados.length, 0, 'nada repostado');
  assert.equal((await noBanco()).publicationState, 'published');
});

test('retryFailedPosts que consegue postar publica o recibo que tinha ficado failed', async () => {
  await gravar({ publicationState: 'failed' });
  const e = motor();
  e.decisions = { pending: [pendencia({ postRetry: { event: 'approve', attempts: 0 } })], resolved: [] };
  assert.equal(await e.retryFailedPosts(), 1);
  assert.equal((await noBanco()).publicationState, 'published');
});

test('coordenação desligada: decide posta como sempre e nenhuma requisição vai ao banco (CT-COMPAT)', async () => {
  const e = motor({ coordenacao: false });
  e.decisions = { pending: [pendencia()], resolved: [] };
  assert.equal((await e.decide('d-7', 'approve')).ok, true);
  assert.equal(e.postados.length, 1);
  assert.equal(fake.requests.length, 0);
});
```

Em `test/sync-receipts.test.js`, substituir:

```js
  for (const nome of ['receiptPath', 'receiptsPath', 'buildReceipt', 'receiptBlocks', 'receiptOrphanState', 'readReceipt', 'writeReceipt', 'invalidateReceipt']) {
```

por:

```js
  for (const nome of ['receiptPath', 'receiptsPath', 'buildReceipt', 'receiptBlocks', 'receiptOrphanState', 'readReceipt', 'writeReceipt', 'invalidateReceipt', 'atualizarPublicacaoDoRecibo']) {
```

Em `test/ui-pure-sync.test.js`, logo depois do fechamento do teste `syncCoordenacaoHtml: só o recibo ÓRFÃO ganha o botão de refazer`, acrescentar:

```js

// C0, defeito 3: a linha dizia "pendente lá" para todo recibo, inclusive o já postado.
test('syncCoordenacaoHtml: o chip do recibo diz o publicationState real', () => {
  const linha = (publicationState) => P.syncCoordenacaoHtml(sync({ recibosVistos: { 'o/r#9': { deviceName: 'Celular', at: Date.now(), publicationState, orfao: 'ativo' } } }));
  assert.match(linha('published'), /sync-chip ok">publicado lá/);
  assert.doesNotMatch(linha('published'), /pendente lá/);
  assert.match(linha('pending'), /sync-chip mute">pendente lá/);
  assert.match(linha('failed'), /sync-chip bad">postagem falhou lá/);
  assert.match(linha('not_applicable'), /sync-chip mute">concluído lá/);
  assert.match(linha('constructor'), /concluído lá/, 'nome de protótipo não vira chip');
});
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `node --test --test-force-exit test/sync-publicacao-recibo.test.js test/sync-receipts.test.js test/ui-pure-sync.test.js`
Esperado: FAIL. `atualizarPublicacaoDoRecibo` é `undefined` (TypeError nos quatro primeiros), `e.syncAtualizarPublicacao is not a function`, o recibo segue `pending` depois de `decide`, e o chip do recibo publicado diz "pendente lá".

- [ ] **Passo 3: implementar a função do recibo**

Em `lib/sync/receipts.js`, substituir:

```js
import { SYNC } from '../constants.js';
import { SYNC_CODES, motivoDe } from './errors.js';
```

por:

```js
import { SYNC } from '../constants.js';
import { SYNC_CODES, motivoDe } from './errors.js';
import { operationFingerprint } from './keys.js';
```

Logo abaixo de `const COM_ETAG = { etag: true };`, acrescentar:

```js
// os estados que buildReceipt grava; qualquer outro valor é defeito de quem chama
const PUBLICACOES = new Set(['pending', 'failed', 'published', 'not_applicable']);
```

Antes de `export default { receiptPath, ...`, acrescentar:

```js
function versaoDe(operationKind, materialVersion) {
  try {
    return operationFingerprint(operationKind, materialVersion);
  } catch {
    // tipo sem coordenação ou versão vazia: sem fingerprint não há recibo a atualizar
    return '';
  }
}

// Publicação que aconteceu DEPOIS de o recibo ser gravado (clique, reenvio, review já no
// PR). Só atualiza: sem recibo não cria um, porque recibo sem lease nem desfecho afirmaria
// uma análise que ninguém registrou. CAS pelo etag lido: se outro aparelho regravou no
// meio, o 412 vira 'conflito' e o recibo dele fica. Best-effort e nunca lança.
async function atualizarPublicacaoDoRecibo(client, ids, { operationKind, materialVersion, publicationState, nowMs }) {
  if (!PUBLICACOES.has(publicationState)) return { ok: false, motivo: 'estado-invalido' };
  const fingerprint = versaoDe(operationKind, materialVersion);
  if (!fingerprint) return { ok: false, motivo: 'versao-invalida' };
  const lido = await readReceipt(client, ids, fingerprint);
  if (!lido.ok) return { ok: false, motivo: lido.motivo };
  if (!lido.receipt) return { ok: false, motivo: 'sem-recibo' };
  if (lido.receipt.publicationState === publicationState) return { ok: true, motivo: 'inalterado' };
  const novo = { ...lido.receipt, publicationState, lastVerifiedAt: nowMs };
  const w = await writeReceipt(client, ids, fingerprint, novo, { ifMatch: lido.etag || 'null_etag' });
  if (w.ok) return { ok: true, motivo: 'atualizado' };
  if (w.code === SYNC_CODES.CONFLITO) return { ok: false, motivo: 'conflito' };
  return { ok: false, motivo: w.motivo || motivoDe(w.code) };
}

```

e trocar as duas linhas de export:

```js
export default { receiptPath, receiptsPath, buildReceipt, receiptBlocks, receiptOrphanState, readReceipt, writeReceipt, invalidateReceipt };
export { receiptPath, receiptsPath, buildReceipt, receiptBlocks, receiptOrphanState, readReceipt, writeReceipt, invalidateReceipt };
```

por:

```js
export default { receiptPath, receiptsPath, buildReceipt, receiptBlocks, receiptOrphanState, readReceipt, writeReceipt, invalidateReceipt, atualizarPublicacaoDoRecibo };
export { receiptPath, receiptsPath, buildReceipt, receiptBlocks, receiptOrphanState, readReceipt, writeReceipt, invalidateReceipt, atualizarPublicacaoDoRecibo };
```

- [ ] **Passo 4: implementar o invólucro e a fachada**

Em `lib/engine/sync.js`, substituir:

```js
import { nextBrasiliaDayStartMs } from '../sync/keys.js';
```

por:

```js
import { nextBrasiliaDayStartMs, accountHash, prHash } from '../sync/keys.js';
```

e, logo depois de `import { createRtdbClient } from '../sync/rtdb.js';`, acrescentar:

```js
import { atualizarPublicacaoDoRecibo } from '../sync/receipts.js';
```

Logo depois da linha `function redoReceipt(engine, key) { return syncRedo.redoReceipt(engine, key); }`, acrescentar:

```js

// Postagem que saiu FORA da revisão automática (clique, reenvio, review já no PR) fecha
// o recibo do head como publicado. Sem isto ele ficava 'pending' para sempre e outro
// aparelho oferecia "Refazer" pago para um PR já postado. Nunca lança: o review já está
// no PR, e a falha aqui só deixa o recibo como estava.
async function syncAtualizarPublicacao(engine, dados) {
  const d = dados || {};
  if (!coordenacaoAtiva(engine)) return { ok: false, motivo: 'coordenacao-desligada' };
  const rt = engine.sync;
  if (!rt || rt.status !== STATUS.CONECTADO || !rt.client) return { ok: false, motivo: 'sem-conexao' };
  const ph = prHash(d.prKey);
  if (!ph || !d.headSha || !texto(d.account)) return { ok: false, motivo: 'contexto-incompleto' };
  const ids = { uid: rt.uid, accountHash: accountHash(d.account), prHash: ph };
  const alvo = { operationKind: d.operationKind || 'review', materialVersion: d.headSha, publicationState: d.publicationState, nowMs: rt.agora() };
  try {
    return await atualizarPublicacaoDoRecibo(rt.client, ids, alvo);
  } catch (err) {
    return { ok: false, motivo: `falha interna: ${(err && err.message) || err}` };
  }
}
```

Nos DOIS blocos de export do fim do arquivo (default e nomeado), substituir `  admit, preflightManual, redoReceipt,` por `  admit, preflightManual, redoReceipt, syncAtualizarPublicacao,` (Edit com `replace_all`).

Em `server.js`, logo depois de `  syncRedoReceipt(key) { return syncMod.redoReceipt(this, key); }`, acrescentar:

```js
  syncAtualizarPublicacao(dados) { return syncMod.syncAtualizarPublicacao(this, dados); }
```

- [ ] **Passo 5: implementar as três chamadas em `decision.js`**

5a. Imediatamente antes de `async function decide(engine, id, action) {`, acrescentar:

```js
// Postagem que saiu por aqui fecha o recibo de coordenação do head como publicado (C0,
// defeito 3). Engine de teste montado à mão não tem a fachada, e aí nada muda. Nunca
// lança: o review já está no PR, a falha só mantém o recibo como estava.
async function publicarRecibo(engine, item, head) {
  if (typeof engine.syncAtualizarPublicacao !== 'function') return;
  const pr = { ...(item.pr || {}), key: item.key };
  const account = pr.account || (typeof engine.accountForPr === 'function' ? engine.accountForPr(pr) : '');
  try {
    await engine.syncAtualizarPublicacao({ account, prKey: item.key, headSha: item.headSha || head || '', operationKind: 'review', publicationState: 'published' });
  } catch (err) {
    engine.log('WARN', `recibo de coordenação de ${item.key}: ${err.message}`);
  }
}

```

5b. No ramo de dedup de `decide`, substituir:

```js
    engine.saveDecisions();
    engine.emit('toast', { kind: 'info', text: `${item.key}: já havia um ${labels[action]} seu neste PR; não postei de novo.` });
```

por:

```js
    engine.saveDecisions();
    await publicarRecibo(engine, item, head);
    engine.emit('toast', { kind: 'info', text: `${item.key}: já havia um ${labels[action]} seu neste PR; não postei de novo.` });
```

5c. No fim de `decide`, substituir:

```js
  engine.saveDecisions();
  engine.writeMemory(item, labels[action] || action.toUpperCase());
```

por:

```js
  engine.saveDecisions();
  await publicarRecibo(engine, item, head);
  engine.writeMemory(item, labels[action] || action.toUpperCase());
```

5d. Em `retryFailedPosts`, substituir:

```js
    engine.resolveIntoHistory(resolved);
    engine.saveDecisions();
    resolvidas++;
```

por:

```js
    engine.resolveIntoHistory(resolved);
    engine.saveDecisions();
    resolvidas++;
    await publicarRecibo(engine, item, item.headSha);
```

- [ ] **Passo 6: implementar o chip da linha do recibo**

Em `ui/pure/sync.js`, imediatamente antes de `function syncLinhaRecibo(key, r) {`, acrescentar:

```js
// O chip diz o estado REAL da publicação. Antes dizia "pendente lá" para todo recibo,
// inclusive o já postado, e a linha mentia justamente no caso comum.
const RECIBO_CHIP = {
  published: '<span class="sync-chip ok">publicado lá</span>',
  pending: '<span class="sync-chip mute">pendente lá</span>',
  failed: '<span class="sync-chip bad">postagem falhou lá</span>',
};
const RECIBO_CHIP_SEM_PUBLICACAO = '<span class="sync-chip mute">concluído lá</span>';

```

e, dentro de `syncLinhaRecibo`, substituir:

```js
  return `<div class="sync-coord"><span><span class="sync-ref">${esc(key)}</span><span class="sync-o-que">analisado no ${esc(onde)}${quando} neste commit</span></span><span class="sync-chip mute">pendente lá</span></div>`;
```

por:

```js
  const chip = Object.hasOwn(RECIBO_CHIP, String(r.publicationState)) ? RECIBO_CHIP[r.publicationState] : RECIBO_CHIP_SEM_PUBLICACAO;
  return `<div class="sync-coord"><span><span class="sync-ref">${esc(key)}</span><span class="sync-o-que">analisado no ${esc(onde)}${quando} neste commit</span></span>${chip}</div>`;
```

- [ ] **Passo 7: rodar, ver passar e medir o teto de linhas**

Run: `node --test --test-force-exit test/sync-publicacao-recibo.test.js test/sync-receipts.test.js test/ui-pure-sync.test.js test/facades.test.js test/retry-failed-posts.test.js test/decide-concurrency.test.js test/dedup-round.test.js test/post-corrida.test.js`
Esperado: PASS em todos.

Run: `node --input-type=module -e "import fs from 'node:fs'; import { strip } from './tools/quality/strip.js'; for (const f of process.argv.slice(1)) console.log(f, strip(fs.readFileSync(f, 'utf8')).split('\n').filter((l) => l.trim()).length);" lib/engine/sync.js lib/sync/receipts.js ui/pure/sync.js`
Esperado: `lib/engine/sync.js` abaixo de 400 (perto de 392). Se passar de 400, NÃO suba a baseline. Encurtar comentário não adianta, porque o strip já os remove da contagem; o que reduz é código: junte as duas linhas `const ids`/`const alvo` dentro da própria chamada a `atualizarPublicacaoDoRecibo` e reexecute a medição.

- [ ] **Passo 8: contraprova**

Em `lib/engine/decision.js`, apague a linha `  await publicarRecibo(engine, item, head);` do fim de `decide` (a do passo 5c).
Run: `node --test --test-force-exit test/sync-publicacao-recibo.test.js`
Esperado: FAIL em `decide com postagem ok deixa o recibo do head published` (`'pending' !== 'published'`).
Restaure, rode e confirme PASS.

- [ ] **Passo 9: commit**

```bash
git add lib/sync/receipts.js lib/engine/sync.js server.js lib/engine/decision.js ui/pure/sync.js test/sync-publicacao-recibo.test.js test/sync-receipts.test.js test/ui-pure-sync.test.js
git commit -m "fix(sync): postagem por clique, reenvio ou review já no PR fecha o recibo como publicado"
```

---

### Tarefa 4: lease vencido sai da tela sem esperar o ciclo

**Arquivos:**
- Modificar: `lib/engine/sync-stream.js:95-107` (pura nova depois de `leasesVistosDe`), `:135-150` (`atualizarVistos` e helpers), `:169-174` (`novoStream`), `:289-299` (`fecharStream`), `:315-316` (exports)
- Modificar: `test/sync-stream.test.js` (teste puro novo depois do de `leasesVistosDe`, o teste de `lease que vence sem evento nenhum` substituído, filtro `esperaAgendada` do teste de backoff)

**Interfaces:**
- Consome: agendador injetável `engine.sync.agendadorStream` (`{ setTimeout(fn, ms), clearTimeout(t) }`), `agendar(rt, fn, ms)`/`desagendar(rt, t)` já existentes, `leaseVisivel(lease, euDeviceId, nowMs)`.
- Produz: `proximoVencimentoDe(arvore, { euDeviceId, nowMs }): number` (0 sem lease visível), exportada; `stream.vencimento` (timer) e `stream.vencimentoEm` (número).

- [ ] **Passo 1: escrever e atualizar os testes**

Em `test/sync-stream.test.js`, logo depois do fechamento do teste `leasesVistosDe: só lease vivo de OUTRO aparelho em PR conhecido; o resto conta em outros ou some`, acrescentar:

```js

test('proximoVencimentoDe: o menor expiresAt entre os leases que a visão mostra ou conta; nenhum dá 0', () => {
  const agora = 1_800_000_000_000;
  const ah = accountHash(CONTA);
  const arvore = { [ah]: {
    [prHash(PR_CONHECIDO)]: { deviceId: 'dev-outro', expiresAt: agora + 5000 },
    [prHash(PR_DESCONHECIDO)]: { deviceId: 'dev-outro', expiresAt: agora + 3000 },
    [prHash(PR_MEU)]: { deviceId: 'dev-eu', expiresAt: agora + 1000 },
    [prHash(PR_VENCIDO)]: { deviceId: 'dev-outro', expiresAt: agora },
    [prHash('Org/Repo#10')]: { deviceId: 'dev-outro' },
  } };
  assert.equal(stream.proximoVencimentoDe(arvore, { euDeviceId: 'dev-eu', nowMs: agora }), agora + 3000,
    'lease de PR desconhecido também vence e muda a contagem de outros');
  assert.equal(stream.proximoVencimentoDe(null, { euDeviceId: 'dev-eu', nowMs: agora }), 0);
});

test('fecharStream desarma o timer do vencimento', () => {
  const t = agendador.setTimeout(() => { throw new Error('o timer do vencimento não podia disparar depois de fechar'); }, 1234);
  const rt = { agendadorStream: agendador, stream: { fechado: false, vigia: null, espera: null, controle: null, acordar: null, vencimento: t } };
  assert.equal(stream.fecharStream(rt), true);
  assert.equal(t.vivo, false);
});
```

Substituir o teste inteiro que começa em `test('lease que vence sem evento nenhum sai da visão no tick seguinte', async () => {` e termina no `});` depois de `await releaseLease(outro, ids(PR_CONHECIDO), { leaseId: 'L-curto' });` por:

```js
// Atualizado DE PROPÓSITO na C0 (defeito 4). A versão anterior travava o comportamento
// "sai no tick seguinte": o lease de um aparelho que morreu não gera evento, e a tela o
// mostrava até o próximo ciclo de polling. Agora um timer acorda no menor vencimento
// visível e recalcula a visão sozinho. O relógio anda à mão, como antes, porque o que
// está sob teste é o lease vencer sem evento nenhum, não o socket ser rápido.
test('lease que vence sem evento nenhum sai da visão no timer do vencimento, sem ciclo', async () => {
  const relogio = engine.sync.agora;
  assert.equal((await acquireLease(outro, ids(PR_CONHECIDO), dadosDoLease('L-curto', 'dev-outro'))).ok, true);
  await ate(() => engine.sync.leasesVistos[PR_CONHECIDO], 'lease curto visto');
  const t = engine.sync.stream.vencimento;
  assert.ok(t && t.vivo, 'há um timer armado no menor vencimento visível');
  assert.ok(t.ms > 0 && t.ms <= SYNC.LEASE_TTL_MS, 'a espera vai até o vencimento, não até o ciclo');
  const antes = pushes;
  engine.sync.agora = () => relogio() + SYNC.LEASE_TTL_MS + 1000;
  try {
    t.vivo = false;
    t.fn();
    assert.equal(engine.sync.leasesVistos[PR_CONHECIDO], undefined, 'saiu da visão sem syncTick');
    assert.ok(pushes > antes, 'a tela é avisada');
  } finally {
    engine.sync.agora = relogio;
  }
  await releaseLease(outro, ids(PR_CONHECIDO), { leaseId: 'L-curto' });
});
```

No teste `sem rede, a espera dobra até STREAM_RECONNECT_MAX_MS e volta ao mínimo quando o stream responde`, substituir:

```js
  const esperaAgendada = () => timers.filter((t) => t.vivo && t.ms !== SYNC.STREAM_IDLE_MS).at(-1);
```

por:

```js
  // o timer do vencimento (C0) também vive no agendador e não é espera de reconexão
  const esperaAgendada = () => timers.filter((t) => t.vivo && t.ms !== SYNC.STREAM_IDLE_MS && t !== (engine.sync.stream && engine.sync.stream.vencimento)).at(-1);
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `node --test --test-force-exit test/sync-stream.test.js`
Esperado: FAIL em `proximoVencimentoDe` (não é função), em `fecharStream desarma o timer do vencimento` (`t.vivo` segue true) e em `lease que vence sem evento nenhum sai da visão no timer do vencimento, sem ciclo` (`há um timer armado`). Os demais passam.

- [ ] **Passo 3: implementar**

3a. Em `lib/engine/sync-stream.js`, logo depois do fechamento de `leasesVistosDe`, acrescentar:

```js

// O menor expiresAt entre os leases que a visão mostra ou conta em outros (0 sem
// nenhum): é o próximo instante em que a visão muda sem evento nenhum chegar.
function proximoVencimentoDe(arvore, { euDeviceId, nowMs }) {
  let menor = 0;
  for (const [, prs] of entradas(arvore)) {
    for (const [, lease] of entradas(prs)) {
      if (!leaseVisivel(lease, euDeviceId, nowMs)) continue;
      if (!menor || lease.expiresAt < menor) menor = lease.expiresAt;
    }
  }
  return menor;
}
```

3b. Substituir o comentário e o corpo de `atualizarVistos`:

```js
// Recalcula a visão a partir da árvore e avisa a tela SÓ quando ela muda: roda a cada
// evento e a cada tick, porque o lease também vence sem evento nenhum (o dono caiu) e
// porque a lista de PRs conhecidos muda a cada ciclo de polling.
function atualizarVistos(engine) {
  const rt = engine.sync;
  const st = rt.stream;
  if (!st) return false;
  const opcoes = { euDeviceId: rt.deviceId, nowMs: rt.agora(), conhecidos: prsConhecidos(engine), devices: rt.devices };
  const { vistos, outros } = leasesVistosDe(st.arvore, opcoes);
```

por:

```js
// Recalcula a visão a partir da árvore e avisa a tela SÓ quando ela muda: roda a cada
// evento, a cada tick (a lista de PRs conhecidos muda a cada ciclo de polling) e no timer
// do menor vencimento visível, porque o lease também vence sem evento nenhum (o dono caiu).
function atualizarVistos(engine) {
  const rt = engine.sync;
  const st = rt.stream;
  if (!st) return false;
  const opcoes = { euDeviceId: rt.deviceId, nowMs: rt.agora(), conhecidos: prsConhecidos(engine), devices: rt.devices };
  const { vistos, outros } = leasesVistosDe(st.arvore, opcoes);
  agendarVencimento(engine, st, proximoVencimentoDe(st.arvore, opcoes));
```

e, logo depois do fechamento de `atualizarVistos`, acrescentar:

```js

// Um timer só por stream, trocado quando o menor vencimento muda. Sem ele, lease de
// aparelho que morreu ficava na tela até o próximo ciclo de polling (minutos com o PR
// dado como "em outro aparelho"). O piso de 1 ms cobre relógio que acorda um instante antes.
function agendarVencimento(engine, st, menor) {
  const rt = engine.sync;
  if (st.vencimentoEm === menor) return;
  desagendar(rt, st.vencimento);
  Object.assign(st, { vencimento: null, vencimentoEm: menor });
  if (!menor) return;
  st.vencimento = agendar(rt, () => aoVencer(engine, st), Math.max(1, menor - rt.agora()));
}

function aoVencer(engine, st) {
  if (st.fechado || engine.sync.stream !== st) return;
  Object.assign(st, { vencimento: null, vencimentoEm: 0 });
  atualizarVistos(engine);
}
```

3c. Em `novoStream`, substituir:

```js
    controle: null, vigia: null, vigias: 0, espera: null, acordar: null, avisouCancel: false,
```

por:

```js
    controle: null, vigia: null, vigias: 0, espera: null, acordar: null, avisouCancel: false,
    vencimento: null, vencimentoEm: 0,
```

3d. Em `fecharStream`, substituir:

```js
  desagendar(rt, st.espera);
```

por:

```js
  desagendar(rt, st.espera);
  desagendar(rt, st.vencimento);
```

3e. Trocar as duas linhas de export:

```js
export default { aplicarEvento, mapaDePrs, leasesVistosDe, sincronizarStream, fecharStream, esquecerVisao, atualizarVistos };
export { aplicarEvento, mapaDePrs, leasesVistosDe, sincronizarStream, fecharStream, esquecerVisao, atualizarVistos };
```

por:

```js
export default { aplicarEvento, mapaDePrs, leasesVistosDe, proximoVencimentoDe, sincronizarStream, fecharStream, esquecerVisao, atualizarVistos };
export { aplicarEvento, mapaDePrs, leasesVistosDe, proximoVencimentoDe, sincronizarStream, fecharStream, esquecerVisao, atualizarVistos };
```

- [ ] **Passo 4: rodar e ver passar**

Run: `node --test --test-force-exit test/sync-stream.test.js test/sync-engine.test.js test/sync-saida-limpa.test.js`
Esperado: PASS em todos.

- [ ] **Passo 5: contraprova**

Em `atualizarVistos`, apague a linha `  agendarVencimento(engine, st, proximoVencimentoDe(st.arvore, opcoes));`.
Run: `node --test --test-force-exit test/sync-stream.test.js`
Esperado: FAIL em `lease que vence sem evento nenhum sai da visão no timer do vencimento, sem ciclo` (`há um timer armado`).
Restaure, rode e confirme PASS. Depois apague `  desagendar(rt, st.vencimento);` de `fecharStream`, confirme FAIL em `fecharStream desarma o timer do vencimento`, restaure e confirme PASS.

- [ ] **Passo 6: commit**

```bash
git add lib/engine/sync-stream.js test/sync-stream.test.js
git commit -m "fix(sync): lease de outro aparelho que vence sai da tela no vencimento, sem esperar o ciclo"
```

---

### Tarefa 5: selos do Panorama concordam entre aparelhos

**Arquivos:**
- Modificar: `server.js:1817` (método antes de `snapshot()`), `server.js:1855` (campo no snapshot)
- Modificar: `ui/pure/radar.js:195-222` (`kindDaRevisao`, `panoramaRowHtml`)
- Modificar: `ui/pure/review.js:205-215` (`reviewChip`)
- Modificar: `ui/app.js:2580` (`ctxPano`)
- Criar: `test/selo-panorama-gh.test.js`

**Interfaces:**
- Consome: `engine.staleInfo[key] = { stale, head, lastState }` preenchido por `refreshStaleStates` (`lib/engine/selfpr.js:582-611`), com `lastState` em `APPROVED` | `CHANGES_REQUESTED` | `''`.
- Produz: `Engine.reviewStatesGhParaUi(): { [key]: 'APPROVED' | 'CHANGES_REQUESTED' }` (só PRs do panorama); `snapshot().reviewStatesGh`; `ctx.reviewStatesGh` em `panoramaRowHtml`; `reviewChip(pr, actions, estadosGh)`.

- [ ] **Passo 1: escrever o teste que falha**

Criar `test/selo-panorama-gh.test.js`:

```js
// C0, defeito 5 (spec 7.C0): selos do Panorama divergiam entre aparelhos. O selo saía do
// histórico LOCAL e, sem registro local, `reviewedByMe` virava "aprovado": um
// CHANGES_REQUESTED postado por outro aparelho aparecia aqui como aprovado e parado.
// Agora o selo usa o último estado decisivo meu no GitHub (staleInfo[key].lastState, que
// o refreshStaleStates já busca). O teste roda dois ciclos do refreshStaleStates, passa
// pelo snapshot e renderiza o HTML, o caminho inteiro até a tela.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-selo-gh-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../ui/pure.js';

const { Engine } = await import('../server.js');

after(() => {
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

const KEY = 'acme/api#7';
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const MARK = { style: '', varStyle: '', dim: '', chip: '', dot: '', acct: { label: 'acme' } };
const prDe = (extra = {}) => ({ key: KEY, url: 'https://github.com/acme/api/pull/7', repo: 'acme/api', number: 7, title: 'Corrige o gate', author: 'alice', updatedAt: '2026-09-15T10:00:00Z', reviewedByMe: true, ...extra });

function ctxDo(snap) {
  return { mark: MARK, actions: snap.reviewActions, staleStates: snap.staleStates, reviewStatesGh: snap.reviewStatesGh, todasContas: false, chats: {}, running: new Set(), waiting: [] };
}

test('CHANGES_REQUESTED postado por outro aparelho aparece como "aguardando o autor", e o selo acompanha o GitHub a cada ciclo', async () => {
  const e = new Engine();
  e.pushState = () => { };
  e.panorama = [prDe()];
  e.decisions = { pending: [], resolved: [] };        // este aparelho nunca postou nada
  let estado = 'CHANGES_REQUESTED';
  e.staleForReview = async () => ({ stale: false, head: HEAD, lastState: estado });

  await e.refreshStaleStates();
  const s1 = e.snapshot();
  assert.deepEqual(s1.reviewStatesGh, { [KEY]: 'CHANGES_REQUESTED' });
  const html1 = P.panoramaRowHtml(prDe(), ctxDo(s1));
  assert.match(html1, /aguardando o autor/);
  assert.match(html1, /você pediu mudanças/);
  assert.doesNotMatch(html1, /você aprovou/);
  assert.doesNotMatch(html1, /act-review/, 'mudanças pedidas e parado: não oferece revisão paga');

  estado = 'APPROVED';
  await e.refreshStaleStates();
  const s2 = e.snapshot();
  assert.deepEqual(s2.reviewStatesGh, { [KEY]: 'APPROVED' });
  const html2 = P.panoramaRowHtml(prDe(), ctxDo(s2));
  assert.match(html2, /nada a fazer/);
  assert.match(html2, /você aprovou/);
});

test('reviewStatesGh só projeta PR do panorama e só estado decisivo', async () => {
  const e = new Engine();
  e.panorama = [prDe()];
  e.staleInfo = {
    [KEY]: { stale: false, head: HEAD, lastState: '' },
    'fora/do#1': { stale: false, head: HEAD, lastState: 'APPROVED' },
  };
  assert.deepEqual(e.reviewStatesGhParaUi(), {});
});

test('pendência na mesa deste aparelho vence o GitHub; sem estado nenhum, revisado não finge aprovação', () => {
  const base = { mark: MARK, actions: {}, staleStates: {}, reviewStatesGh: {}, todasContas: false, chats: {}, running: new Set(), waiting: [] };
  const pendente = P.panoramaRowHtml(prDe(), { ...base, actions: { [KEY]: { kind: 'pending' } }, reviewStatesGh: { [KEY]: 'APPROVED' } });
  assert.match(pendente, /aguardando você/);
  const semEstado = P.panoramaRowHtml(prDe(), base);
  assert.match(semEstado, /revisado por você/);
  assert.doesNotMatch(semEstado, /você aprovou|nada a fazer/);
  assert.doesNotMatch(semEstado, /act-review/, 'sem estado conhecido também não convida a revisão paga');
});

test('reviewChip: o estado do GitHub vence o histórico local, e nome de protótipo não vira selo', () => {
  const pr = prDe();
  assert.match(P.reviewChip(pr, { [KEY]: { kind: 'approve' } }, { [KEY]: 'CHANGES_REQUESTED' }), /você pediu mudanças/);
  assert.match(P.reviewChip(pr, {}, { [KEY]: 'constructor' }), /revisado por você/);
  assert.match(P.reviewChip(pr, { [KEY]: { kind: 'comment' } }), /você comentou/, 'sem estado do GitHub o histórico local complementa');
});
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `node --test --test-force-exit test/selo-panorama-gh.test.js`
Esperado: FAIL. `s1.reviewStatesGh` é `undefined`; `e.reviewStatesGhParaUi is not a function`; o PR sem registro local aparece como `nada a fazer`; `reviewChip` ignora o terceiro argumento.

- [ ] **Passo 3: implementar a projeção no engine**

Em `server.js`, imediatamente antes da linha `  snapshot() {`, acrescentar:

```js
  // Último estado decisivo MEU no GitHub por PR do panorama (staleInfo, que o
  // refreshStaleStates já busca). É o que faz o selo concordar entre aparelhos: o
  // histórico local só sabe o que ESTE aparelho postou.
  reviewStatesGhParaUi() {
    const saida = {};
    const chaves = new Set((this.panorama || []).map(p => p.key));
    for (const [k, info] of Object.entries(this.staleInfo || {})) {
      if (chaves.has(k) && info && (info.lastState === 'APPROVED' || info.lastState === 'CHANGES_REQUESTED')) saida[k] = info.lastState;
    }
    return saida;
  }

```

e, no `snapshot()`, substituir:

```js
      staleStates: this.staleStates,
```

por:

```js
      staleStates: this.staleStates,
      reviewStatesGh: this.reviewStatesGhParaUi(),
```

- [ ] **Passo 4: implementar o selo**

4a. Em `ui/pure/review.js`, substituir a função inteira:

```js
export function reviewChip(pr, actions) {
  const a = (actions || {})[pr.key];
  if (a) {
    if (a.kind === 'pending') return '<span class="badge rev-pend" title="A análise terminou e está esperando a sua decisão em Precisa de você">🟡 aguardando você</span>';
    if (a.kind === 'approve') return `<span class="badge rev-ok" title="APPROVE postado${a.auto ? ' automaticamente pelo protocolo' : ' por você'} via Farol">✅ você aprovou</span>`;
    if (a.kind === 'request_changes') return '<span class="badge rev-rc" title="REQUEST CHANGES postado por você via Farol">✋ você pediu mudanças</span>';
    if (a.kind === 'comment') return '<span class="badge rev-cm" title="COMMENT postado por você via Farol">💬 você comentou</span>';
  }
  if (pr.reviewedByMe) return '<span class="badge rev-ok" title="Você já revisou este PR no GitHub">✔ revisado por você</span>';
  return '';
}
```

por:

```js
// O estado do GitHub vence o histórico local pelo mesmo motivo do kindDaRevisao
// (ui/pure/radar.js): o que outro aparelho postou só existe lá.
const CHIP_DO_GH = {
  APPROVED: '<span class="badge rev-ok" title="Seu último review decisivo neste PR, no GitHub, aprovou">✅ você aprovou</span>',
  CHANGES_REQUESTED: '<span class="badge rev-rc" title="Seu último review decisivo neste PR, no GitHub, pediu mudanças">✋ você pediu mudanças</span>',
};

export function reviewChip(pr, actions, estadosGh) {
  const a = (actions || {})[pr.key];
  if (a && a.kind === 'pending') return '<span class="badge rev-pend" title="A análise terminou e está esperando a sua decisão em Precisa de você">🟡 aguardando você</span>';
  const gh = String((estadosGh || {})[pr.key]);
  if (Object.hasOwn(CHIP_DO_GH, gh)) return CHIP_DO_GH[gh];
  if (a) {
    if (a.kind === 'approve') return `<span class="badge rev-ok" title="APPROVE postado${a.auto ? ' automaticamente pelo protocolo' : ' por você'} via Farol">✅ você aprovou</span>`;
    if (a.kind === 'request_changes') return '<span class="badge rev-rc" title="REQUEST CHANGES postado por você via Farol">✋ você pediu mudanças</span>';
    if (a.kind === 'comment') return '<span class="badge rev-cm" title="COMMENT postado por você via Farol">💬 você comentou</span>';
  }
  if (pr.reviewedByMe) return '<span class="badge rev-ok" title="Você já revisou este PR no GitHub">✔ revisado por você</span>';
  return '';
}
```

4b. Em `ui/pure/radar.js`, imediatamente antes de `export function panoramaRowHtml(pr, ctx) {`, acrescentar:

```js
const KIND_DO_GH = { APPROVED: 'approve', CHANGES_REQUESTED: 'request_changes' };

// Qual revisão MINHA vale neste PR, nesta ordem: pendência na mesa deste aparelho, último
// estado decisivo meu no GitHub, histórico local, e por fim 'revisado' sem estado
// conhecido. O GitHub vem antes do histórico porque um CHANGES_REQUESTED postado por
// outro aparelho não existe no histórico local, e o reviewedByMe sozinho virava
// "aprovado" aqui. Sem estado conhecido o PR não finge aprovação.
function kindDaRevisao(pr, actions, estadosGh) {
  const ra = (actions || {})[pr.key];
  if (ra && ra.kind === 'pending') return 'pending';
  const gh = String((estadosGh || {})[pr.key]);
  if (Object.hasOwn(KIND_DO_GH, gh)) return KIND_DO_GH[gh];
  if (ra) return ra.kind;
  return pr.reviewedByMe ? 'revisado' : null;
}

```

4c. Em `panoramaRowHtml`, substituir:

```js
  const chip = reviewChip(pr, ctx.actions);
  const m = ctx.mark;
    // estado da SUA revisão: aprovado/mudanças pedidas = resolvido (sem botão de
    // re-revisar); pendente = já na fila de decisão; senão, dá pra revisar.
  const ra = (ctx.actions || {})[pr.key];
  // sem registro nosso, "revisado por mim no GitHub" conta como approve
  let kind = null;
  if (ra) kind = ra.kind;
  else if (pr.reviewedByMe) kind = 'approve';
```

por:

```js
  const chip = reviewChip(pr, ctx.actions, ctx.reviewStatesGh);
  const m = ctx.mark;
  // estado da SUA revisão: aprovado/mudanças pedidas/revisado = resolvido (sem botão de
  // re-revisar); pendente = já na fila de decisão; senão, dá pra revisar.
  const kind = kindDaRevisao(pr, ctx.actions, ctx.reviewStatesGh);
```

substituir:

```js
    const reviewed = (kind === 'approve' || kind === 'request_changes') && !pr.reRequested;
```

por:

```js
    const reviewed = (kind === 'approve' || kind === 'request_changes' || kind === 'revisado') && !pr.reRequested;
```

e substituir:

```js
  else if (isPending) settledLabel = 'aguardando você';
  else if (reviewed) settledLabel = 'nada a fazer';
```

por:

```js
  else if (isPending) settledLabel = 'aguardando você';
  else if (kind === 'revisado') settledLabel = 'revisado por você';
  else if (reviewed) settledLabel = 'nada a fazer';
```

4d. Em `ui/app.js`, substituir:

```js
  const ctxPano = { actions: STATE.reviewActions || {}, staleStates: STATE.staleStates || {}, running: runningKeys, waiting: waitingKeys,
```

por:

```js
  const ctxPano = { actions: STATE.reviewActions || {}, staleStates: STATE.staleStates || {}, reviewStatesGh: STATE.reviewStatesGh || {}, running: runningKeys, waiting: waitingKeys,
```

- [ ] **Passo 5: rodar e ver passar**

Run: `node --test --test-force-exit test/selo-panorama-gh.test.js test/ui-pure.test.js test/ui-widgets.test.js test/ui-pure-superficie.test.js test/head-quieto.test.js test/rerequest.test.js`
Esperado: PASS em todos (os testes existentes de `panoramaRowHtml` usam `actions` locais e continuam valendo).

- [ ] **Passo 6: contraprova**

Em `ui/pure/radar.js`, dentro de `kindDaRevisao`, apague a linha `  if (Object.hasOwn(KIND_DO_GH, gh)) return KIND_DO_GH[gh];`.
Run: `node --test --test-force-exit test/selo-panorama-gh.test.js`
Esperado: FAIL em `CHANGES_REQUESTED postado por outro aparelho aparece como "aguardando o autor"`.
Restaure, rode e confirme PASS.

- [ ] **Passo 7: commit**

```bash
git add server.js ui/pure/radar.js ui/pure/review.js ui/app.js test/selo-panorama-gh.test.js
git commit -m "fix(panorama): selo da revisão usa o último estado decisivo no GitHub e concorda entre aparelhos"
```

---

### Tarefa 6: frase de privacidade diz o que sobe em claro

**Arquivos:**
- Modificar: `ui/index.html:661`
- Modificar: `firebase/README.md:19-29` (seção "O que sobe para o banco")
- Modificar: `lib/engine/sync.js` (exports, depois da Tarefa 3)
- Criar: `test/sync-privacidade.test.js`

**Interfaces:**
- Consome: `buildLease` (`lib/sync/lease.js:41-46`), `buildReceipt` (`lib/sync/receipts.js:40-46`), `payloadFor` (`lib/sync/outbox.js:79-90`), `presencaDe(rt)` (`lib/engine/sync.js:274-276`), `nomeDoAparelho` (hostname como padrão, `lib/engine/sync.js:78-80`).
- Produz: `presencaDe` exportada por `lib/engine/sync.js`.

- [ ] **Passo 1: escrever o teste que falha**

Criar `test/sync-privacidade.test.js`:

```js
// C0, defeito 6 (spec 7.C0 e seção 11): a tela e o firebase/README.md prometiam que o
// repositório nunca é enviado, mas o SHA do commit sobe em claro no lease e no recibo, o
// nome do aparelho sobe como hostname, e perfil e modelo sobem no consumo.
//
// O teste lê os campos REAIS dos quatro payloads e exige que cada um esteja numa das três
// categorias abaixo, e que a frase da tela e do README nomeie cada categoria. Campo novo
// num payload sem categoria reprova: a frase não pode envelhecer calada.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-privacidade-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { buildLease } = await import('../lib/sync/lease.js');
const { buildReceipt } = await import('../lib/sync/receipts.js');
const { payloadFor } = await import('../lib/sync/outbox.js');
const { presencaDe } = await import('../lib/engine/sync.js');

after(() => {
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

const CLARO = {
  headSha: /SHA do commit/i, materialVersion: /SHA do commit/i,
  name: /nome do aparelho/i, platform: /sistema operacional/i, farolVersion: /versão do Farol/i,
  model: /modelo/i, profileId: /perfil/i, costUsd: /custo/i,
  inputTokens: /tokens/i, outputTokens: /tokens/i, cacheReadTokens: /tokens/i, cacheCreationTokens: /tokens/i,
};
const RESUMO = { accountHash: /resumo SHA-256 sem chave/i, refHash: /resumo SHA-256 sem chave/i };
const TECNICOS = [
  'leaseId', 'deviceId', 'operationKind', 'acquiredAt', 'heartbeatAt', 'expiresAt', 'completedAt', 'lastVerifiedAt',
  'outcome', 'publicationState', 'reviewId', 'lastSeenAt', 'at', 'day', 'kind', 'costSource', 'status', 'localId',
];
const NUNCA = [/prompt/i, /diff/i, /relatório/i, /título/i];

function camposReais() {
  const lease = buildLease({ leaseId: 'L', deviceId: 'd', operationKind: 'review', headSha: 'abc', nowMs: 1, farolVersion: '1' });
  const recibo = buildReceipt({ operationKind: 'review', materialVersion: 'abc', deviceId: 'd', leaseId: 'L', nowMs: 1, outcome: 'completed', publicationState: 'pending', reviewId: '', farolVersion: '1' });
  const presenca = presencaDe({ deviceName: 'Mesa' });
  const consumo = payloadFor({ at: 1, kind: 'review', account: 'eu', ref: 'o/r#1', model: 'm', profileId: 'p' }, 'd', '1');
  return [...new Set([lease, recibo, presenca, consumo].flatMap((o) => Object.keys(o)))].sort();
}

function normalizar(texto) {
  return texto.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

function fraseDaTela() {
  const html = fs.readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
  const inicio = html.indexOf('id="sys-sync"');
  assert.ok(inicio > 0, 'a seção de sincronização existe');
  const fim = html.indexOf('<div class="sys-section"', inicio + 1);
  return normalizar(html.slice(inicio, fim));
}

function fraseDoReadme() {
  return normalizar(fs.readFileSync(new URL('../firebase/README.md', import.meta.url), 'utf8'));
}

test('todo campo que sobe tem categoria: em claro, resumo sem chave ou identificador e horário', () => {
  const categorizados = [...Object.keys(CLARO), ...Object.keys(RESUMO), ...TECNICOS].sort();
  assert.deepEqual(camposReais(), categorizados);
});

for (const [rotulo, ler] of [['tela', fraseDaTela], ['firebase/README.md', fraseDoReadme]]) {
  test(`a frase da ${rotulo} nomeia o que sobe em claro, o que sobe como resumo e o que nunca sai`, () => {
    const texto = ler();
    for (const [campo, re] of Object.entries({ ...CLARO, ...RESUMO })) assert.match(texto, re, `${campo} precisa ser nomeado`);
    assert.match(texto, /nome da máquina/i, 'o nome do aparelho é o hostname quando vazio');
    assert.match(texto, /identificadores e horários/i);
    for (const re of NUNCA) assert.match(texto, re);
  });
}
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `node --test --test-force-exit test/sync-privacidade.test.js`
Esperado: FAIL. `presencaDe` não é exportada (import devolve `undefined` e o primeiro teste lança TypeError); a frase da tela não menciona `SHA do commit`, `perfil`, `nome da máquina`.

- [ ] **Passo 3: exportar `presencaDe`**

Em `lib/engine/sync.js`, nos DOIS blocos de export (default e nomeado), substituir `  admit, preflightManual, redoReceipt, syncAtualizarPublicacao,` por `  admit, preflightManual, redoReceipt, syncAtualizarPublicacao, presencaDe,` (Edit com `replace_all`).

- [ ] **Passo 4: reescrever a frase da tela**

Em `ui/index.html`, substituir:

```html
            <span><b>Nenhum prompt, diff ou relatório sai daqui.</b> Sobem hashes do PR, o aparelho que está com ele e os números de consumo. O nome do repositório e o título do PR nunca são enviados.</span>
```

por:

```html
            <span><b>Nenhum prompt, diff, relatório ou título de PR sai daqui.</b> Sobem em claro o SHA do commit analisado (no lease e no recibo; ele pode levar direto ao repositório, quando o repositório é público), o nome do aparelho (vazio usa o nome da máquina), o sistema operacional, a versão do Farol e, no consumo, o modelo, o perfil, os tokens e o custo de cada sessão, além de identificadores e horários de cada análise. Conta do GitHub e PR sobem como resumo SHA-256 sem chave: quem já conhece o nome consegue conferir.</span>
```

- [ ] **Passo 5: reescrever a seção do README**

Em `firebase/README.md`, substituir o trecho que vai de `## O que sobe para o banco` até `texto de revisão nunca saem do aparelho.` (inclusive) por:

```markdown
## O que sobe para o banco

- **Presença do aparelho** (`users/{uid}/devices/{deviceId}`): nome do aparelho, sistema
  operacional, versão do Farol e o horário da última vez em que o aparelho foi visto
  (carimbo do servidor).
- **Coordenação de análise** (`leases`, `receipts`, `dailyRounds`): quem está revisando
  qual PR agora, o que já foi concluído e quantas rodadas automáticas o PR teve no dia.
- **Eventos de consumo** (`usageEvents`), só com a consolidação ligada: tokens, custo,
  modelo, perfil e tipo de cada sessão.

### Em claro, legível por quem abrir o banco

- o SHA do commit analisado, no lease e no recibo (ele pode levar direto ao repositório,
  quando o repositório é público);
- o nome do aparelho, que vazio usa o nome da máquina (hostname), o sistema operacional e
  a versão do Farol;
- no consumo: o modelo, o perfil do Claude, os tokens e o custo de cada sessão;
- identificadores e horários de cada análise (qual aparelho, quando começou, quando vence,
  como terminou e se foi publicada).

### Como resumo SHA-256 sem chave

Conta do GitHub e PR (dono, repositório e número). Sem chave quer dizer que quem já
conhece o nome consegue calcular o mesmo resumo e conferir.

### Nunca sai do aparelho

Prompts, diffs, relatórios, título do PR, nome do repositório em texto, texto de revisão,
logs e credenciais.
```

- [ ] **Passo 6: rodar e ver passar**

Run: `node --test --test-force-exit test/sync-privacidade.test.js test/ui-contract.test.js test/sync-engine.test.js`
Esperado: PASS em todos.

- [ ] **Passo 7: contraprova**

Em `ui/index.html`, apague `, o perfil` da frase.
Run: `node --test --test-force-exit test/sync-privacidade.test.js`
Esperado: FAIL em `a frase da tela nomeia o que sobe em claro` (`profileId precisa ser nomeado`).
Restaure e confirme PASS. Depois acrescente um campo `extra: 1` ao objeto devolvido por `buildLease` em `lib/sync/lease.js`, confirme FAIL em `todo campo que sobe tem categoria`, remova e confirme PASS.

- [ ] **Passo 8: commit**

```bash
git add ui/index.html firebase/README.md lib/engine/sync.js test/sync-privacidade.test.js
git commit -m "docs(sync): a tela e o README dizem o que sobe em claro, o que sobe como resumo e o que nunca sai"
```

---

### Tarefa 7: verificação final e registro de execução

**Arquivos:**
- Criar: `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md`

**Interfaces:**
- Consome: todos os testes das Tarefas 1 a 6.
- Produz: registro de qual teste prova qual critério de aceite.

- [ ] **Passo 1: gate completo**

```bash
npm run check && npm run lint && npm test
```

Esperado: os três verdes. O `lint` não pode acusar contagem acima da baseline em nenhum arquivo. Se acusar, corrija o código (nunca `npm run lint:update` para subir número; ele só trava número mais BAIXO).

- [ ] **Passo 2: conferir que nenhum `~/.farol` real foi tocado e que o diff é só o planejado**

```bash
git diff --stat origin/main...HEAD
git status --short
```

Esperado: só os arquivos do Mapa de arquivos (mais os documentos da spec que já estavam na branch) e árvore limpa.

- [ ] **Passo 3: escrever o registro**

Criar `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md`:

```markdown
# Execução da C0: correções da sincronização publicada

Plano: `docs/superpowers/plans/2026-09-15-md-c0-correcoes-sync.md`.
Spec: `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md`, seção 7.C0.
Gate: `npm run check && npm run lint && npm test` verde no fim da Tarefa 7.

| Critério de aceite (7.C0) | Teste que prova | Contraprova executada |
|---|---|---|
| PR bloqueado por recibo não volta à fila nem loga WARN no segundo ciclo | `test/sync-recibo-visto-ciclo.test.js`: "PR bloqueado por recibo não volta à fila nem loga WARN nos ciclos seguintes, nem depois de reiniciar" (ciclos 2 e 3) | sem `vistosPorRecibo?.has(k)` no `reconciliarVistos`: FAIL em "ciclo 2" |
| ... nem depois de reinício | mesmo teste, bloco `reiniciado` | leitura do arquivo trocada por `[]`: FAIL em "o conjunto sobrevive ao reinício" |
| `/api/settings` com campo inválido devolve `ignoradas` | `test/http.test.js`: "POST /api/settings devolve as chaves ignoradas junto da config" | rota devolvendo só `{ ok, config }`: FAIL |
| ... e a tela mostra | `test/settings-ignoradas.test.js` (texto e os três handlers) | não aplicável (a trava de fonte é a própria contraprova estrutural) |
| `decide` com postagem ok deixa o recibo `published` no fake do banco | `test/sync-publicacao-recibo.test.js`: "decide com postagem ok deixa o recibo do head published..." | sem `publicarRecibo` no fim de `decide`: FAIL |
| ... também em `retryFailedPosts` e no ramo `already_reviewed` | mesmo arquivo, casos "retryFailedPosts que consegue postar..." e "decide que acha o review já no PR..." | não executada separadamente |
| a linha do recibo mostra o `publicationState` real | `test/ui-pure-sync.test.js`: "syncCoordenacaoHtml: o chip do recibo diz o publicationState real" | não executada separadamente |
| lease vencido some da visão sem ciclo | `test/sync-stream.test.js`: "lease que vence sem evento nenhum sai da visão no timer do vencimento, sem ciclo" (substitui DE PROPÓSITO o "sai no tick seguinte") | sem `agendarVencimento` em `atualizarVistos`: FAIL; sem `desagendar(rt, st.vencimento)`: FAIL em "fecharStream desarma o timer do vencimento" |
| CHANGES_REQUESTED postado por outro aparelho aparece como "aguardando o autor" | `test/selo-panorama-gh.test.js`: dois ciclos de `refreshStaleStates` até o HTML | sem a linha do GitHub em `kindDaRevisao`: FAIL |
| texto da tela e do README bate com os campos em claro de `buildLease`, `buildReceipt`, presença e `payloadFor` | `test/sync-privacidade.test.js` | sem ", o perfil" na tela: FAIL; campo novo em `buildLease`: FAIL |
| CT-COMPAT (a): sincronização desligada não toca banco nem cria arquivo | `sync-recibo-visto-ciclo` (arquivo só nasce com recibo), `sync-publicacao-recibo` ("coordenação desligada: decide posta como sempre e nenhuma requisição vai ao banco" e "syncAtualizarPublicacao: sem coordenação...") | não executada separadamente |

## Decisões tomadas na execução que a spec não fixava

- PR `reviewedByMe` sem estado decisivo conhecido (nem no GitHub nem no histórico local)
  aparece como "revisado por você", sem botão de revisar. Antes aparecia como aprovado.
- `atualizarPublicacaoDoRecibo` não cria recibo ausente e não repete a escrita depois de
  um 412: devolve `sem-recibo` ou `conflito`.
```

Se alguma contraprova divergir do esperado na execução, corrija a linha correspondente com o que de fato aconteceu antes de commitar.

- [ ] **Passo 4: commit**

```bash
git add docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md
git commit -m "docs(sync): registro de execução da C0 com critério de aceite por teste"
```

- [ ] **Passo 5: antes de qualquer push**

```bash
npm run eng
```

Esperado: verde, com as avaliações escritas por commit. Push e PR só com pedido do dono, pelo fluxo de branch, PR e CI verde do `CLAUDE.md`, sem atribuição de IA na descrição.

---

## Critérios de aceite da spec x testes

| Critério (spec 7.C0) | Tarefa | Teste |
|---|---|---|
| PR bloqueado por recibo não volta à fila nem loga WARN no segundo ciclo, nem depois de reinício | 1 | `test/sync-recibo-visto-ciclo.test.js` |
| `/api/settings` com campo inválido devolve `ignoradas` e a tela mostra | 2 | `test/http.test.js`, `test/settings-ignoradas.test.js` |
| `decide` com postagem ok deixa o recibo `published` no fake do banco (e `retryFailedPosts`, `already_reviewed`, chip real) | 3 | `test/sync-publicacao-recibo.test.js`, `test/ui-pure-sync.test.js` |
| lease vencido some da visão sem ciclo | 4 | `test/sync-stream.test.js` |
| CHANGES_REQUESTED postado por outro aparelho aparece como "aguardando o autor" | 5 | `test/selo-panorama-gh.test.js` |
| texto da tela e do README bate com os campos em claro de `buildLease`, `buildReceipt`, presença e `payloadFor` | 6 | `test/sync-privacidade.test.js` |
| CT-COMPAT (a): desligado não faz requisição nem cria arquivo | 1, 3 | casos de CT-COMPAT nos dois arquivos novos |
