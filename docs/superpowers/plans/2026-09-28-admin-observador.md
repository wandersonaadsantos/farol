# Admin observador — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o aparelho admin do Farol vira mesa de controle (assiste ao vivo e decide, nunca executa), e toda execução no conjunto fica amarrada à conta GitHub que a revisão usa.

**Architecture:** a conta entra na identidade do candidato distribuído (sem mudar o formato `hex_hex` que as regras do banco validam). Um predicado puro `ehObservador` decide o papel e é aplicado nas portas de execução que já existem (admissão, `enqueueHeadless`, agendador, comandos). A transmissão ao vivo reaproveita o nó cifrado de andamento com um feed de linhas sob orçamento de tamanho, e a pendência passa a apontar para o corpo do histórico, que ganha os payloads por ação.

**Tech Stack:** Node 24 ESM puro, Electron, `node --test`, Firebase RTDB via REST (sem SDK), UI em HTML/JS sem framework.

**Spec:** `docs/superpowers/specs/2026-09-28-admin-observador-design.md`

## Global Constraints

- Zero dependências novas (invariante 1 do `CLAUDE.md`).
- Português, sem travessão, em comentário e UI (invariante 6).
- `npm run check && npm run lint && npm test` verdes antes de cada commit; `lint` é ratchet: nenhuma contagem sobe (`maxLines` de arquivo já acima de 400 não pode crescer).
- `npm run eng` antes do push, com avaliações escritas em `avaliacoes.jsonl` (roteiro em `docs/QUALITY.md`, seção da constituição).
- Nenhuma mudança em `firebase/database.rules.json`. Limites que o código tem de respeitar: `operations` 2048, `deviceStatus` 2048, `pending` 4096, corpo do histórico 48000 caracteres cifrados.
- Nenhum nome de conta real em arquivo que viaja no pacote (auditoria do `make-package.ps1` e `test/pacote-auditoria.test.js`). Fixture de teste usa `alice`, `bob`, `eu`.
- Commit `<tipo>(<escopo>): <resumo>` sem co-autoria.

---

## Fase 1. Execução amarrada à conta

### Task 1: a conta entra na identidade do candidato

**Files:**
- Modify: `lib/sync/candidato.js` (nova `matContaTag`; `candidatoDe` usa a conta no material)
- Modify: `lib/engine/sync-distribuicao.js` (`headBate`, `adotarUm`, lista `CODIGOS`, `aceitarAtribuicoes`)
- Modify: `lib/engine/sync-comandos.js` (`iniciar`)
- Modify: `ui/pure/compartilhado.js` (rótulo `conta_diferente` no mapa `CODIGO`)
- Test: `test/candidato-conta.test.js`

**Interfaces:**
- Produces: `matContaTag(kId: Buffer, head: string, conta: string): string` exportada por `lib/sync/candidato.js`; código de recusa `'conta_diferente'`.

- [ ] **Step 1: teste que falha.** Em `test/candidato-conta.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { candidatoDe, matContaTag, fundir } from '../lib/sync/candidato.js';

const kId = randomBytes(32);
const HEAD = 'a'.repeat(40);
const pr = { key: 'acme/app#7', headSha: HEAD };

test('mesmo PR e head com contas diferentes são dois itens', () => {
  const a = candidatoDe(pr, { kId, conta: 'alice', agora: 1, ttlMs: 1000 });
  const b = candidatoDe(pr, { kId, conta: 'bob', agora: 1, ttlMs: 1000 });
  assert.notEqual(a.itemId, b.itemId);
  const itens = fundir({ devA: [a], devB: [b] }, { agora: 2 });
  assert.equal(itens.length, 2, 'fundir não junta contas diferentes');
});

test('o material do candidato é o de head e conta, e a caixa do login não importa', () => {
  const a = candidatoDe(pr, { kId, conta: 'Alice', agora: 1, ttlMs: 1000 });
  assert.equal(a.matTag, matContaTag(kId, HEAD, 'alice'));
  assert.match(a.itemId, /^[0-9a-f]+_[0-9a-f]+$/, 'formato que as regras do banco validam');
});

test('sem conta não há candidato', () => {
  assert.equal(candidatoDe(pr, { kId, conta: '', agora: 1, ttlMs: 1000 }), null);
});
```

- [ ] **Step 2:** `node --test test/candidato-conta.test.js` falha (`matContaTag` não existe).

- [ ] **Step 3: implementação em `lib/sync/candidato.js`.** Acrescentar, logo abaixo de `matTag`:

```js
// O material do CANDIDATO é head + conta (28/09/2026). Só o head fazia dois aparelhos com
// contas diferentes no mesmo PR virarem UM item, e só uma das duas revisões acontecia. Com a
// conta, o executor que recalcula com a conta LOCAL e não bate recusa por construção. O
// `matTag` do andamento e do histórico continua só do head: o histórico liga revisões do
// mesmo PR por ele.
function matContaTag(kId, head, conta) {
  return tag(kId, 'mat', `${String(head || '').trim()}\u0000${String(conta || '').trim().toLowerCase()}`);
}
```

Em `candidatoDe`: trocar `if (!chave || !head) return null;` por `if (!chave || !head || !conta) return null;` e `const material = matTag(kId, head);` por `const material = matContaTag(kId, head, conta);`. Exportar `matContaTag` nos dois `export`.

- [ ] **Step 4: executor e adoção usam a conta local.** Em `lib/engine/sync-distribuicao.js`:

```js
function headBate(engine, rt, item, pr) {
  const conta = typeof engine.accountForPr === 'function' ? engine.accountForPr(pr) : '';
  const atual = candidato.matContaTag(kIdDe(rt), String(pr.headSha || pr.knownHead || ''), conta);
  return atual === item.matTag;
}
```

Atualizar a chamada em `aceitarAtribuicoes` para `headBate(engine, rt, item, meu.pr)`. Em `adotarUm`, trocar a comparação por `candidato.matContaTag(kId, head, engine.accountForPr(pr)) !== item.matTag`. Acrescentar `'conta_diferente'` ao fim de `CODIGOS`.

Em `lib/engine/sync-comandos.js`, `iniciar` (o executor é sempre o publicador, e `meusCandidatos` guarda `{ pr, conta }` da publicação): trocar a checagem de head por

```js
  if (!head || candidato.matContaTag(kId, head, meu.conta) !== args.matTag) return { estado: 'recusado', code: 'head_mudou' };
  if (String(engine.accountForPr(meu.pr) || '').toLowerCase() !== String(meu.conta || '').toLowerCase()) return { estado: 'recusado', code: 'conta_diferente' };
```

com `import candidato from '../sync/candidato.js';`. A mesma segunda linha entra em `aceitarAtribuicoes`, logo depois do `headBate`, empurrando `{ itemId, code: 'conta_diferente' }` para `recusas`.

Em `ui/pure/compartilhado.js`, mapa `CODIGO`: `conta_diferente: 'a conta daquele aparelho não é a desta revisão',`.

- [ ] **Step 5: teste do executor.** Acrescentar ao mesmo arquivo um teste de `aceitarAtribuicoes` só se já houver helper de engine falso em `test/` para a distribuição (procure `aceitarAtribuicoes` em `test/`); caso exista, replicar um cenário em que `accountForPr` devolve `bob` para um candidato publicado com `alice` e afirmar recusa com `code: 'head_mudou'` ou `'conta_diferente'`. Os testes existentes de distribuição que montam candidato sem `conta` precisam passar a informar uma: rode `npm test`, e para cada falha em teste de distribuição acrescente `conta: 'eu'` na chamada e `accountForPr: () => 'eu'` no engine falso.

- [ ] **Step 6:** `npm run check && npm run lint && npm test` verdes.

- [ ] **Step 7: commit** `fix(sync): a conta entra na identidade do candidato distribuido`.

### Task 2: credencial por conta na capacidade e na transferência

**Files:**
- Modify: `lib/engine/sync-publicacao.js` (`capacidadeDe` publica `contasComToken`)
- Modify: `lib/sync/transferencia.js` (`destinoApto` exige a conta em `contasComToken`)
- Test: `test/transferencia-conta.test.js`

**Interfaces:**
- Produces: campo `contasComToken: string[]` (acctTags) na capacidade publicada; usado pelas Tasks 6 e 7.

- [ ] **Step 1: teste que falha:**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { destinoApto } from '../lib/sync/transferencia.js';

const base = { frescoAte: 10, aceitarAdmin: true, teto: 2, ocupadas: 0, iaPronta: true };

test('destino com a conta configurada mas sem token dela não é apto', () => {
  const r = destinoApto({ ...base, contas: ['t1'], token: true, contasComToken: [] }, { acctTag: 't1', agora: 1 });
  assert.deepEqual(r, { apto: false, motivo: 'sem-credencial' });
});

test('destino com token da conta é apto', () => {
  const r = destinoApto({ ...base, contas: ['t1'], contasComToken: ['t1'] }, { acctTag: 't1', agora: 1 });
  assert.equal(r.apto, true);
});

test('aparelho antigo, sem contasComToken, não é destino (falha fechada)', () => {
  const r = destinoApto({ ...base, contas: ['t1'], token: true }, { acctTag: 't1', agora: 1 });
  assert.equal(r.apto, false);
});
```

- [ ] **Step 2:** o teste falha.

- [ ] **Step 3:** em `destinoApto`, trocar a condição de credencial por:

```js
  if (acctTag && !(Array.isArray(c.contasComToken) && c.contasComToken.includes(acctTag))) {
    return { apto: false, motivo: 'sem-credencial' };
  }
```

e atualizar o comentário do topo ("CREDENCIAL da conta do PR" agora é "token daquela conta, publicado por conta").

- [ ] **Step 4:** em `sync-publicacao.js`:

```js
// Só as contas com token AGORA (28/09/2026). O booleano `token` era o `gh auth` global da
// máquina, e um aparelho parecia apto para uma conta cujo token não existia.
function contasComTokenDe(engine, kId) {
  const lista = typeof engine.accountList === 'function' ? engine.accountList() : [];
  const temToken = (login) => typeof engine.tokenFor === 'function' && !!engine.tokenFor(login);
  return lista.filter((a) => a && a.user && temToken(a.user)).map((a) => acctTag(kId, a.user)).sort();
}
```

e em `capacidadeDe`: `contasComToken: kId ? contasComTokenDe(engine, kId) : [],` logo abaixo de `contas`.

- [ ] **Step 5:** rodar `npm test`; testes de transferência existentes que montam resumo com `token: true` passam a precisar de `contasComToken: [<tag>]` — atualizar cada um. Conferir que o teste de tamanho da capacidade, se houver (procure `deviceStatus` ou `2048` em `test/`), segue verde.

- [ ] **Step 6:** gates verdes; **commit** `fix(sync): transferencia so para destino com token da conta`.

### Task 3: `tomar` exige a conta

**Files:**
- Modify: `lib/sync/comando.js` (`tomarDe` com `acctTag` obrigatório)
- Modify: `lib/engine/sync-comandos.js` (`tomar` confere a conta)
- Modify: `ui/telas/radar-compartilhado.js` (`tomarOperacao` envia `acctTag: op.acctTag`)
- Test: `test/comando-tomar-conta.test.js`

- [ ] **Step 1: teste que falha (puro):**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import comando from '../lib/sync/comando.js';

const T = 'a'.repeat(32);
test('tomar sem acctTag não é comando', () => {
  assert.equal(comando.sanearComando({ tipo: 'tomar', args: { prTag: T, matTag: T, confirmado: true } }), null);
});
test('tomar com acctTag viaja com ela', () => {
  const c = comando.sanearComando({ tipo: 'tomar', args: { prTag: T, matTag: T, acctTag: T, confirmado: true } });
  assert.equal(c.args.acctTag, T);
});
```

(Se `sanearComando` não estiver exportado no default, exporte-o.)

- [ ] **Step 2:** falha. **Step 3:** `tomarDe`:

```js
function tomarDe(a) {
  if (!tag(a.prTag) || !tag(a.matTag) || !tag(a.acctTag) || a.confirmado !== true) return null;
  return { prTag: tag(a.prTag), matTag: tag(a.matTag), acctTag: tag(a.acctTag), confirmado: true };
}
```

Em `sync-comandos.js` `tomar`, logo depois de achar o `pr`: `if (acctTag(kId, engine.accountForPr(pr)) !== args.acctTag) return { estado: 'recusado', code: 'conta_diferente' };` (importar `acctTag` de `../sync/tags.js`).

- [ ] **Step 4:** gates verdes; **commit** `fix(sync): tomar so com a conta da revisao`.

## Fase 2. Admin observador

### Task 4: o papel do aparelho

**Files:**
- Create: `lib/sync/papel.js` (puro)
- Create: `lib/engine/papel-do-aparelho.js` (lê `engine.sync` e a chave local)
- Test: `test/papel.test.js`

**Interfaces:**
- Produces: `ehObservador({ adminDev, deviceId, temChaveDeAdmin }): boolean` (puro) e `souObservador(engine): boolean` (engine). Toda porta das Tasks 5 a 9 chama `souObservador(engine)`.

- [ ] **Step 1: teste:**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ehObservador } from '../lib/sync/papel.js';

test('com sinal: observador se e só se o admin é este aparelho', () => {
  assert.equal(ehObservador({ adminDev: 'd1', deviceId: 'd1', temChaveDeAdmin: false }), true);
  assert.equal(ehObservador({ adminDev: 'd2', deviceId: 'd1', temChaveDeAdmin: true }), false);
});
test('sem sinal: a chave local decide, falhando fechado', () => {
  assert.equal(ehObservador({ adminDev: '', deviceId: 'd1', temChaveDeAdmin: true }), true);
  assert.equal(ehObservador({ adminDev: '', deviceId: 'd1', temChaveDeAdmin: false }), false);
});
test('sem deviceId não há papel de admin', () => {
  assert.equal(ehObservador({ adminDev: 'd1', deviceId: '', temChaveDeAdmin: false }), false);
});
```

- [ ] **Step 2:** falha. **Step 3:** `lib/sync/papel.js`:

```js
// Papel do aparelho no conjunto (28/09/2026, decisão do dono): o admin ASSISTE e DECIDE,
// nunca executa. Puro. Sem sinal do banco, a chave local de admin decide, e a falha é
// FECHADA: admin que perdeu a rede não volta a executar sozinho.
function ehObservador({ adminDev = '', deviceId = '', temChaveDeAdmin = false } = {}) {
  const eu = String(deviceId || '');
  if (!eu) return false;
  const admin = String(adminDev || '');
  if (admin) return admin === eu;
  return temChaveDeAdmin === true;
}

export default { ehObservador };
export { ehObservador };
```

`lib/engine/papel-do-aparelho.js`:

```js
// O papel DESTE aparelho, lido do estado da sincronização. Sem compartilhamento ligado o
// aparelho é o Farol de sempre, e nunca observador.
import { ehObservador } from '../sync/papel.js';
import adminChave from '../sync/admin-chave.js';
import { sharedActive } from '../sync/config.js';

function souObservador(engine) {
  const cfg = (engine && engine.config && engine.config.sync) || {};
  if (!sharedActive(cfg)) return false;
  const rt = engine.sync || {};
  const admin = rt.sinais && rt.sinais.admin ? String(rt.sinais.admin.dev || '') : '';
  return ehObservador({ adminDev: admin, deviceId: rt.deviceId, temChaveDeAdmin: !!adminChave.lerChaveDeAdmin() });
}

const AVISO_OBSERVADOR = 'Este aparelho é o admin: ele assiste e decide, e as revisões rodam nos aparelhos com a conta.';

export default { souObservador, AVISO_OBSERVADOR };
export { souObservador, AVISO_OBSERVADOR };
```

- [ ] **Step 4:** gates verdes; **commit** `feat(papel): o admin e o observador do conjunto`.

### Task 5: o observador não executa

**Files:**
- Modify: `lib/engine/review.js` (`launchReview`, `enqueueHeadless`)
- Modify: `server.js` (filtro `toReview`)
- Modify: `lib/engine/admissao.js` (`requisitoDuro`)
- Modify: `lib/engine/sync-publicacao.js` (capacidade publica `observador: true`)
- Modify: `lib/engine/sync-distribuicao.js` (`estadoDoAparelho`, `resumoDoAparelho`, `aceitarAtribuicoes`, `DETALHES`)
- Modify: `lib/engine/sync-comandos.js` (`tomar`, `iniciar`, `repetir` recusam `observador`)
- Modify: `lib/engine/selfpr.js` (`launchSelfAnalysis`)
- Modify: `lib/engine/pushback.js` (a varredura não roda no observador)
- Test: `test/observador.test.js`

**Interfaces:**
- Consumes: `souObservador(engine)` (Task 4).
- Produces: código `'observador'` nas recusas; texto do aviso `AVISO_OBSERVADOR = 'Este aparelho é o admin: ele assiste e decide, e as revisões rodam nos aparelhos com a conta.'` exportado de `lib/engine/papel-do-aparelho.js`.

- [ ] **Step 1: testes que falham.** Engine real com `FAROL_HOME` temporário (padrão de `test/pr-proprio.test.js`), com `e.sync = { deviceId: 'd1', sinais: { admin: { dev: 'd1' } } }` e `e.config.sync = <cfg que faz sharedActive true>` (copie o cfg mínimo de um teste existente que usa `sharedActive`, procure `sharedActive` em `test/`). Casos:
  1. `launchReview([url], 'auto', 'clique')` com PR do panorama de outra pessoa → `ok:false`, nada enfileirado, toast com `AVISO_OBSERVADOR`.
  2. `enqueueHeadless(pr)` → `{ ok:false, code:'observador' }`.
  3. `admissao.reservar(e, { tipo:'review' })` → `motivo:'observador'` (com `doctorInfo.claude = true` e presença fresca, para o motivo não ser outro).
  4. Com `sinais.admin.dev = 'd2'` (este aparelho não é admin), o caso 2 segue o caminho normal.
  5. `estadoDoAparelho` de um resumo com `observador: true` → `apto:false` e o `motivoDoAparelho` do `escolha.js` diz `'observador'`.

- [ ] **Step 2:** falham. **Step 3: implementação**, com uma PORTA DE EXECUÇÃO única:
  - Criar `lib/engine/porta-de-execucao.js`, dona da pergunta "este aparelho pode executar este PR?", reunindo as duas regras (PR próprio, de `pr-proprio.js`, e observador, de `papel-do-aparelho.js`):

```js
// A porta de execução deste aparelho (28/09/2026): a UMA pergunta que toda revisão headless
// faz antes de existir. Duas regras hoje, cada uma dona do próprio módulo: PR da própria
// conta (pr-proprio.js) e aparelho admin, que só observa (papel-do-aparelho.js).
import prProprio from './pr-proprio.js';
import papel from './papel-do-aparelho.js';

function motivoParaNaoExecutar(engine, pr) {
  if (papel.souObservador(engine)) return 'observador';
  if (prProprio.ehMeu(engine, pr)) return 'pr-proprio';
  return '';
}

function avisoDe(motivo, key) {
  return motivo === 'observador' ? papel.AVISO_OBSERVADOR : prProprio.avisoPrProprio(key);
}

// Tira do lote o que não pode executar aqui, com um aviso por PR barrado (o do observador
// sai uma vez só, porque ele vale para o lote inteiro).
function executaveis(engine, itens) {
  const fica = [];
  const avisos = new Set();
  for (const it of itens) {
    const motivo = motivoParaNaoExecutar(engine, it);
    if (!motivo) { fica.push(it); continue; }
    const aviso = avisoDe(motivo, it.key);
    if (!avisos.has(aviso)) engine.emit('toast', { kind: 'info', text: aviso });
    avisos.add(aviso);
  }
  return fica;
}

export default { motivoParaNaoExecutar, executaveis };
export { motivoParaNaoExecutar, executaveis };
```

  - `review.js` troca as duas chamadas da v2.63.4, sem linha nova: no `launchReview`, `prProprio.semPrProprio(engine, ...)` vira `porta.executaveis(engine, ...)` (e o texto do erro de lote vazio vira `'nada deste lote pode executar neste aparelho'`); no `enqueueHeadless`, a linha do PR próprio vira `const fora = porta.motivoParaNaoExecutar(engine, pr); if (fora) return { ok: false, code: fora };` (uma linha, com `if` na mesma linha, como o vizinho). `semPrProprio` sai de `pr-proprio.js` e os testes da v2.63.4 passam a chamar pela porta.
  - `server.js` `toReview`: `if (this.souObservador()) return false;` como primeira linha do filtro, com fachada `souObservador() { return papel.souObservador(this); }` — se o `maxLines` do `server.js` subir, filtrar ANTES do `filter` com `const toReview = this.souObservador() ? [] : this.queue.filter(...)` (zero linha nova).
  - `admissao.requisitoDuro`: `if (['review', 'self', 'pushback'].includes(tipo) && papel.souObservador(engine)) return 'observador';` logo após a checagem de tipo. Acrescentar `'observador'` a `DETALHES` em `sync-distribuicao.js`.
  - Capacidade: `observador: papel.souObservador(engine),` em `capacidadeDe`; `resumoDoAparelho` repassa `observador: c.observador === true`; `estadoDoAparelho`: `apto: ocup.temResumo && !pausado && !recusaPorPrincipio && !resumo?.observador` com `observador: !!(resumo && resumo.observador)` no objeto; `escolha.motivoDoAparelho`: `if (a.observador === true) return 'observador';` antes de `pausado`.
  - `aceitarAtribuicoes`: primeira linha do laço depois de `nao-e-minha`: `if (papel.souObservador(engine)) { recusas.push({ itemId, code: 'inapto', problema: 'observador' }); continue; }`.
  - `sync-comandos.js`: `tomar`, `iniciar` e `repetir` começam com `if (papel.souObservador(engine)) return { estado: 'recusado', code: 'observador' };`. Rótulo no `CODIGO` da UI: `observador: 'aquele aparelho é o admin, que não executa revisões',`.
  - `selfpr.launchSelfAnalysis`: primeira linha `if (papel.souObservador(engine)) return { ok: false, error: papel.AVISO_OBSERVADOR };`.
  - `pushback.js`: na função de varredura agendada (procure a que o `server.js` chama no ciclo, `scanPushbacks`), primeira linha `if (papel.souObservador(engine)) return;`.

- [ ] **Step 4:** gates verdes (atenção ao ratchet de `maxLines` em `review.js` e `server.js`). **Commit** `feat(papel): o admin nao executa revisao por caminho nenhum`.

### Task 6: a fila do admin diz quem cuida

**Files:**
- Create: `lib/sync/quem-cuida.js` (puro)
- Modify: `lib/engine/sync-telas.js` (projeção `quemCuida` por PR no snapshot do admin)
- Modify: `ui/pure/` do card da fila (procure onde o card de `#queue` é montado, `queueCardHtml` ou similar em `ui/pure/`) para mostrar a linha
- Test: `test/quem-cuida.test.js`

**Interfaces:**
- Consumes: `contasComToken` (Task 2), capacidade aberta por `capacidade.abrirCapacidade`, operações ao vivo `rt.andamentos` (lista de `lerAndamentos`).
- Produces: `quemCuida({ acctTag, prTag, aparelhos: [{ dev, nome, contasComToken, observador }], operacoes: [{ dev, prTag, aparelho }] }): { situacao: 'revisando'|'cuida'|'sem-aparelho', aparelho: string }`.

- [ ] **Step 1: teste:**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { quemCuida } from '../lib/sync/quem-cuida.js';

const aparelhos = [
  { dev: 'adm', nome: 'PC', contasComToken: ['c1', 'c2'], observador: true },
  { dev: 'cel', nome: 'Celular', contasComToken: ['c1'], observador: false },
];
test('operação ao vivo manda', () => {
  assert.deepEqual(quemCuida({ acctTag: 'c1', prTag: 'p', aparelhos, operacoes: [{ dev: 'cel', prTag: 'p', aparelho: 'Celular' }] }), { situacao: 'revisando', aparelho: 'Celular' });
});
test('executor com a conta cuida', () => {
  assert.deepEqual(quemCuida({ acctTag: 'c1', prTag: 'p', aparelhos, operacoes: [] }), { situacao: 'cuida', aparelho: 'Celular' });
});
test('só o admin tem a conta: sem aparelho', () => {
  assert.deepEqual(quemCuida({ acctTag: 'c2', prTag: 'p', aparelhos, operacoes: [] }), { situacao: 'sem-aparelho', aparelho: '' });
});
```

- [ ] **Step 2:** falha. **Step 3:**

```js
// Quem cuida de um PR da fila do admin (28/09/2026). Puro. O admin não executa, então cada
// PR da fila dele tem de dizer onde a revisão acontece, ou que ela não acontece.
function quemCuida({ acctTag = '', prTag = '', aparelhos = [], operacoes = [] } = {}) {
  const viva = (Array.isArray(operacoes) ? operacoes : []).find((o) => o && o.prTag === prTag);
  if (viva) return { situacao: 'revisando', aparelho: String(viva.aparelho || '') };
  const com = (Array.isArray(aparelhos) ? aparelhos : []).filter((a) => a && a.observador !== true
    && Array.isArray(a.contasComToken) && a.contasComToken.includes(acctTag));
  if (com.length) return { situacao: 'cuida', aparelho: String(com[0].nome || '') };
  return { situacao: 'sem-aparelho', aparelho: '' };
}

export default { quemCuida };
export { quemCuida };
```

- [ ] **Step 4:** projeção: em `sync-telas.js`, no snapshot do admin (`souObservador`), anexar a cada PR da `queue` o `quemCuida` calculado com `acctTag(kId, engine.accountForPr(pr))`, `prTag(kId, pr.key)`, as capacidades abertas dos aparelhos do `rt.devices` e `rt.andamentos`. A UI do card da fila, quando o PR tem `quemCuida`, troca o botão Revisar por uma linha: `revisando no <aparelho>` / `o <aparelho> cuida desta revisão` / `sem aparelho com a conta <conta>: ela não é revisada sozinha`. Teste da função pura de render com os três casos.

- [ ] **Step 5:** gates verdes; **commit** `feat(admin): a fila do admin diz quem cuida de cada revisao`.

## Fase 3. Transmissão ao vivo e decisão completa

### Task 7: feed ao vivo e card de operação do admin

**Files:**
- Modify: `lib/sync/andamento.js` (`projetar` ganha `feed` com orçamento)
- Modify: `ui/pure/compartilhado.js` (`operacaoHtml`: feed, subagentes por nome, conta, sem Tomar)
- Modify: `ui/telas/radar-compartilhado.js` (remove `tomarOperacao` e o handler `.md-tomar`)
- Test: `test/andamento-feed.test.js`

**Interfaces:**
- Produces: `projetar(...).feed: string[]` (mais antigo primeiro), `ORCAMENTO_FEED = 900` caracteres somados, `MAX_LINHA_FEED = 140`.

- [ ] **Step 1: teste:**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import andamento from '../lib/sync/andamento.js';

const kId = randomBytes(32);
const sessao = { pr: { key: 'acme/app#1' }, account: 'eu', startedAt: 1, model: 'claude-opus-5-5' };

test('o feed traz as últimas linhas, cortadas, dentro do orçamento', () => {
  const feed = Array.from({ length: 50 }, (_, i) => ({ t: i + 2, k: 'info', text: `linha ${i} ` + 'x'.repeat(300) }));
  const p = andamento.projetar(sessao, feed, { kId, agora: 100 });
  assert.ok(p.feed.length > 0);
  assert.ok(p.feed.every((l) => l.length <= andamento.MAX_LINHA_FEED));
  assert.ok(p.feed.join('').length <= andamento.ORCAMENTO_FEED);
  assert.match(p.feed.at(-1), /^linha 49/, 'a mais recente fica');
});

test('a projeção inteira cabe no nó de operações', () => {
  const feed = Array.from({ length: 120 }, (_, i) => ({ t: i + 2, k: 'info', text: 'ç'.repeat(400), a: 'leitor-' + i, s: 'leitura' }));
  const p = andamento.projetar(sessao, feed, { kId, agora: 200 });
  const claro = JSON.stringify({ p });
  assert.ok(Buffer.byteLength(claro) * 4 / 3 + 200 <= 2048, `claro de ${Buffer.byteLength(claro)} bytes não cabe cifrado em 2048`);
});
```

- [ ] **Step 2:** falha. **Step 3:** em `andamento.js`:

```js
const MAX_LINHA_FEED = 140;
const ORCAMENTO_FEED = 900;

// O feed ao vivo que o admin assiste (28/09/2026): as mesmas linhas que o aparelho dono
// mostra na tela dele, das mais recentes para trás, até o orçamento. O nó de operações
// cabe em 2048 caracteres cifrados, e o resto da projeção já ocupa parte disso.
function feedDe(feed) {
  const linhas = (Array.isArray(feed) ? feed : []).filter((i) => objeto(i) && i.text);
  const saida = [];
  let total = 0;
  for (let i = linhas.length - 1; i >= 0; i--) {
    const l = String(linhas[i].text).replace(/\s+/g, ' ').trim().slice(0, MAX_LINHA_FEED);
    if (!l) continue;
    if (total + l.length > ORCAMENTO_FEED) break;
    saida.unshift(l);
    total += l.length;
  }
  return saida;
}
```

e `feed: feedDe(feed),` no retorno de `projetar`; exportar as duas constantes. Se o segundo teste falhar por causa dos `subagentes` (120 rótulos), limitar `subagentes` a 8 com `.slice(0, 8)`. O resumo usado por `precisaEscrever` já muda quando o feed muda, então a escrita segue o ritmo de 10 s.

- [ ] **Step 4:** `operacaoHtml`: abaixo de `md-sub`, `<ol class="md-feed">` com cada linha em `<li>` (escapada), só as 6 últimas visíveis e o resto num `<details>`; `subagentes` pelo nome (`op.subagentes.join(', ')`); remover o botão `md-tomar` e a entrada `tomar` de `acoesDaOperacao`; remover `faltaParaTomar`. Em `radar-compartilhado.js`, remover `perguntarTomada`, `tomarOperacao` e o listener de `.md-tomar`. CSS mínimo em `ui/app.css` para `.md-feed` (fonte mono pequena, cor `--fraco`, `max-height` com rolagem). Teste de render: card com feed mostra as linhas e não tem "Tomar".

- [ ] **Step 5:** gates verdes; **commit** `feat(admin): o admin assiste o feed ao vivo de cada revisao`.

### Task 8: decisão com o review completo

**Files:**
- Modify: `lib/sync/pendencia.js` (`projetarPendencia` leva `reviewId`)
- Modify: `lib/engine/sync-pendencias.js` (passa `dev` e `idLocal` para calcular o `reviewId`)
- Modify: `lib/engine/sync-historico.js` / `lib/sync/historico.js` (corpo leva `payloads` por ação, com corte em 40000 caracteres)
- Modify: `lib/sync/comando.js` (`ACOES` = `approve`, `request_changes`, `comment`, `skip`, `reject`)
- Modify: `lib/engine/sync-comandos.js` (`decidir` mapeia `reject` para `request_changes`)
- Modify: `ui/pure/compartilhado.js` (`pendenciaHtml`: motivos por extenso, botão Ver review completo)
- Modify: `ui/telas/radar-compartilhado.js` (modal de decisão com 4 ações, só as que têm payload; abre o corpo pelo `reviewId`)
- Modify: `ui/pure/` do render do corpo aberto (`revisaoAbertaHtml`): mostra os payloads (corpo e inlines por arquivo)
- Test: `test/decisao-remota.test.js`

**Interfaces:**
- Produces: pendência com `reviewId: string` e `acoes: string[]` (as chaves de `item.payloads` presentes); comando `decidir` com `acao ∈ {approve, request_changes, comment, skip}`.

- [ ] **Step 1: testes:**
  1. `projetarPendencia(item, { kId, dev: 'd1' })` devolve `reviewId === historico.reviewIdDe(kId, 'd1', item.id)` e `acoes` igual às chaves de `item.payloads` (mais `skip`, sempre).
  2. `comando.sanearComando({ tipo: 'decidir', args: { itemId: T, acao: 'request_changes' } })` aceita; `acao: 'reject'` também; `acao: 'apagar'` não.
  3. `decidir` no executor com `acao: 'reject'` chama `engine.decide(id, 'request_changes')` (engine falso com `decide` espião e uma pendência cujo `itemIdDe` bate).
  4. O corpo do histórico de uma pendência com `payloads` leva `payloads.approve.body` e os `comments`; com payload gigante, o corpo é cortado e leva `cortado: true`.
  5. Render: pendência com `acoes: ['approve','comment','skip']` e `reviewId` mostra o botão "Ver review completo" e os motivos por extenso.

- [ ] **Step 2:** falham. **Step 3: implementação.**
  - `pendencia.js`: `projetarPendencia(item, { kId, dev = '' })` acrescenta `reviewId: dev && i.id ? reviewIdDe(kId, dev, i.id) : ''` (importar `reviewIdDe` de `./historico.js`) e `acoes: [...Object.keys(objeto(i.payloads) ? i.payloads : {}).filter((a) => ['approve', 'request_changes', 'comment'].includes(a)), 'skip']`. Conferir que a pendência cifrada continua abaixo de 4096 (teste com 10 motivos de 300 caracteres).
  - `sync-pendencias.js`: a chamada passa `dev: rt.deviceId`.
  - Histórico: no ponto em que o corpo é montado a partir do item (`corpoDe` recebe a projeção de UI), incluir `payloads` saneados: para cada ação, `{ event, body: String(body).slice(0, 12000), comments: comments.slice(0, 60).map(({ path, line, body }) => ({ path, line, body: String(body).slice(0, 1500) })) }`; se o JSON do corpo passar de 40000 caracteres, remover `comments` da ação `comment`, depois de `request_changes`, e marcar `cortado: true`.
  - `comando.js`: `const ACOES = ['approve', 'request_changes', 'comment', 'skip', 'reject'];`.
  - `sync-comandos.js` `decidir`: `const acao = args.acao === 'reject' ? 'request_changes' : args.acao;` e `engine.decide(item.id, acao)`.
  - UI: `pendenciaHtml` lista os motivos (`<ul class="md-motivos">`), botão `Ver review completo` (`data-review="${p.reviewId}"`) quando há `reviewId`; `perguntarDecisao(aparelho, acoes)` monta opções só com as ações de `p.acoes`, rótulos `Aprovar`, `Pedir mudanças`, `Só comentar`, `Pular`; `decidirNoAparelho` aceita as quatro. O botão reaproveita `abrirRevisao(reviewId)`. `revisaoAbertaHtml` mostra, quando houver `payloads`, uma seção por ação com o corpo e os inlines agrupados por arquivo.

- [ ] **Step 4:** gates verdes; **commit** `feat(admin): o admin decide com o review completo na tela`.

## Fase 4. Quem não é admin vê só o próprio trabalho

### Task 9: seções da frota só no admin e aviso da decisão remota

**Files:**
- Modify: `ui/telas/radar-compartilhado.js` (`renderCompartilhado`)
- Modify: `lib/engine/sync-comandos.js` (`decidir` aplicado registra atividade e toast no executor)
- Test: `test/visao-do-papel.test.js`

- [ ] **Step 1: testes:** função pura nova em `ui/pure/compartilhado.js`, `secoesDaFrota(sync) → boolean`, verdadeira só com `sync.admin && sync.admin.souEu === true`; e o `decidir` do executor, ao aplicar, emite `toast` com `o admin decidiu` e o nome do PR.
- [ ] **Step 2:** falham. **Step 3:** `renderCompartilhado`: `const ligada = visaoCompartilhada(s) === 'ligada' && secoesDaFrota(s);`. `decidir`: depois do `r.ok`, `engine.emit('toast', { kind: 'info', text: \`O admin decidiu ${ROTULO[acao]} em ${item.key}.\` })` com `ROTULO = { approve: 'aprovar', request_changes: 'pedir mudanças', comment: 'só comentar', skip: 'pular' }`.
- [ ] **Step 4:** gates verdes; **commit** `feat(papel): quem nao e admin ve so o proprio trabalho`.

## Entrega

### Task 10: PR, CI, merge e release v2.64.0

- [ ] Avaliações do `npm run eng` para o head final e push da branch `feat/admin-observador` (pré-push completo).
- [ ] PR com o resumo das quatro fases, CI verde, merge `--merge --delete-branch`.
- [ ] Branch `release/v2.64.0`: `package.json`, seção no topo do `CHANGELOG.md` (Novidades: mesa de controle do admin; Correções: execução amarrada à conta, decisão remota de pedir mudanças que falhava), entrada em `ui/telas/novidades.js`; PR, CI, merge; `tools/publish-release.ps1` com `GH_TOKEN` da conta dona.
