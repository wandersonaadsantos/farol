# A5 Retomada durável: plano de implementação

> **Ajustes de execução (15/09/2026, valem sobre o texto abaixo):** worktree `C:\Users\wanderson\Documents\farol-md-exec`; branch `md/a5` cortada da ponta de `md/integracao` (base `origin/main` `8c043bc`, que já tem a modularização de `ui/pure/`, mais as entregas do lote já integradas); sem `git fetch`/`merge origin/main`. Onde o texto manda criar ou acrescentar seção no `EXECUCAO.md`, a evidência vai para `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/evidencias-execucao/a5.md` e o `EXECUCAO.md` recebe só a linha de estado, os commits e o caminho da evidência. Dependência de "entrega mergeada na main" significa integrada em `md/integracao`. Números esperados de testes são referência: o que vale é a medição na hora.


> **Para quem executa:** use superpowers:executing-plans, tarefa por tarefa, marcando os checkboxes.

**Objetivo:** fazer a referência de retomada de uma revisão headless interrompida (`retomarSid`) sobreviver a reinícios, esperas e recusas temporárias, e só ser reutilizada quando corresponde ao PR, ao head confirmado e ao contexto local de provedor e perfil que a originou. O desfecho (retomada, recusada pelo CLI, sessão nova, nenhuma) passa a ser distinguível fora da esteira ao vivo.

**Arquitetura:** um módulo novo, `lib/engine/retomada-duravel.js`, é a fonte única da referência: `engine.retomadas` (Map key do PR para entrada) com funções puras de validação e de montagem do `inflight.json`. O `server.js` só grava e restaura (`writeInflight`, `recoverInflight`), o `lib/engine/review.js` chama o módulo nos pontos de transição (enfileirar, sid nascer, falha, desfecho) e decide retomar, aguardar ou descartar antes de abrir a sessão. A entrada só sai do Map por `consumirRetomada`, e só um desfecho chama consumir.

**Stack:** Node ESM puro, `node --test`, zero dependências além do Electron.

**Spec:** `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md`, seções 4.5 (base medida), CT-COMPAT (b) (exceção declarada da A5), CT-RET (contrato), 7.A5 (critérios de aceite) e 15 (regras de trabalho).

**Restrições globais:**
- Zero dependência nova.
- Texto de UI, log, atividade e comentário em português, sem travessão (use vírgula, parênteses ou dois pontos).
- O ratchet do `npm run lint` não pode subir: nada de `JSON.parse`/`JSON.stringify` fora de `lib/io.js`, nada de `process.env` fora de `lib/paths.js`/`lib/env.js`, nenhum número mágico de tempo fora de `lib/constants.js`, nenhum `catch` vazio sem comentário de intenção, nenhum ternário aninhado (dois `?` no mesmo statement, inclusive dentro de um objeto literal), profundidade de chaves no máximo 3 dentro de função, arquivo novo abaixo de 400 linhas úteis. O diretório `test/` não é varrido pelo gate.
- Testes com `node --test`, `FAROL_HOME` temporário fixado ANTES de qualquer import que alcance `lib/paths.js`, e import dinâmico (`await import`) dos módulos do repo.
- Nunca tocar o `~/.farol` real, GitHub ou Firebase. Nenhuma sessão Claude real.
- Nenhuma atribuição de IA em commit, PR ou descrição.
- Nada aqui muda gate de postagem, decisão de revisão ou escrita no GitHub (CT-COMPAT (b)).
- Escopo: só `retomarSid`. A política do `resumeSid` da re-revisão incremental (`config.reReviewResume`) não muda.

**Âncoras:** as linhas citadas foram medidas no worktree `farol-md-exec` em `6d4252b`. Se a base andou, localize pelo nome da função e pelo trecho citado, nunca só pelo número.

**Interface exigida (consumida por outros planos, use exatamente):**
- `rodarSessao` devolve o resultado com `resumeOutcome: 'retomada' | 'recusada' | 'nova' | 'nenhuma'`.
- O registro da revisão ativa carrega `engine.activeReviews.get(id).resumeOutcome`, e o `streamOpts` que chega ao `runClaudeStream` (e dali ao `recordUsage`) carrega `resumeOutcome`. O `result` que chega ao `recordDecision` carrega `resumeOutcome`. Persistir esse campo em uso e decisão é trabalho da A1; aqui ele só viaja. Nada vai pro `farol.log` por causa do desfecho (invariante 3: log só de falha).
- Entrada persistida no `inflight.json`, formato exato e nesta ordem de chaves: `{ key, url, title, author, kind: 'auto', estado: 'pendente'|'fila'|'execucao', retomarSid, knownHead, provedor, perfilId, sessionId, headSha, atualizadoEm }`.

**Semântica dos desfechos:**

| `resumeOutcome` | quando |
|---|---|
| `retomada` | a tentativa com `--resume` abriu sessão (o CLI aceitou) |
| `recusada` | o CLI recusou o `--resume` e a revisão seguiu numa sessão nova, sem o bloco de retomada |
| `nova` | havia referência, mas ela foi descartada antes (head mudou, head salvo ausente, contexto ausente ou diferente, revisão equivalente concluída, outro PR) e a revisão seguiu numa sessão nova |
| `nenhuma` | não havia referência de `retomarSid` válida, ou a admissão da coordenação recusou antes de qualquer sessão abrir |

**Ciclo de vida da entrada (`engine.retomadas`):**

| evento | efeito na entrada |
|---|---|
| sid da sessão nasce (`registrarSessionId`) | grava ou substitui, com head e contexto da sessão |
| queda transitória com `err.sessionId` (`prComRetomada`) | grava ou atualiza, com `headLido` e `contextoLido` |
| boot (`recoverInflight`) | restaura toda linha com sid válido, estado `pendente`, e regrava o arquivo |
| enfileirar (`enqueueHeadless`) | lê e carimba `retomarSid`/`knownHead` no PR, **não consome** |
| espera por vaga, lease, coordenação fora, orçamento, head não confirmado | **mantém** |
| sessão devolveu resultado | consome |
| CLI recusou o `--resume` | consome antes da sessão nova |
| descarte por validação | consome antes da sessão nova |
| recibo de outro aparelho na admissão | consome |
| cancelado por você, falha permanente | consome |
| PR mergeado na boca da sessão, PR mergeado ou fechado no retry | consome |
| teto de tentativas transitórias (`esgotado`) | **mantém** (ver "Ambiguidades declaradas") |

---

## Mapa de arquivos

| Arquivo | Ação | Tarefa |
|---|---|---|
| `lib/engine/retomada-duravel.js` | criar | 1 |
| `test/retomada-duravel-puro.test.js` | criar | 1 |
| `server.js` | modificar: import, construtor (~303), `recoverInflight` (371-408), `writeInflight` (410-418), `_repescarRetry` (1218-1220) | 2 |
| `lib/engine/review.js` | modificar: import (~13), `consumirRetomadaPendente` (341-354, remover), `enqueueHeadless` (397-406) | 2 |
| `test/inflight-session-id.test.js` | modificar testes 3, 4, 6 e 7 e o cabeçalho | 2 |
| `test/retry-net.test.js` | modificar o teste de `retomadaPendente` (723-734) | 2 |
| `test/retomada-duravel.test.js` | criar (Tarefa 2) e acrescentar (Tarefas 3, 4 e 5) | 2 a 5 |
| `lib/engine/review.js` | modificar: `runHeadlessReview` registro ativo (1113-1118), `registrarSessionId` (1103-1110), `prComRetomada` (356-366), `runOneHeadless` (589-596, 667-675, 686-700, 712-716) | 3 |
| `lib/engine/review.js` | modificar: `RESUME_SID_RE` (1888-1891, remover), `tratarBloqueioDeCoordenacao` (113-121), `runOneHeadless` catch (646-648), `sidDeRetomada` (1066-1090), `anunciaRetomada` (1092-1100), `runHeadlessReview` (1126-1160, 1187, 1250-1254, 1289) | 4 |
| `test/retomada-apos-falha.test.js` | modificar | 4 |
| `test/sync-review.test.js` | modificar os dois testes que passam `retomarSid` (469, 520) | 4 |
| `lib/engine/review.js` | modificar: `rodarSessao` (849-872), `streamOpts` (1255-1280), chamada (1283) | 5 |
| `CLAUDE.md` | modificar a seção "Retomada após falha transitória (v2.57.3)" | 6 |
| `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md` | criar ou acrescentar a seção A5 | 6 |

---

## Tarefa 1: módulo puro da retomada durável

**Arquivos:**
- Criar: `lib/engine/retomada-duravel.js`
- Criar: `test/retomada-duravel-puro.test.js`

**Interfaces:**
- `RESUME_SID_RE`: `/^[0-9a-zA-Z-]{8,64}$/` (mesma allowlist de hoje, que passa a morar aqui).
- `DESFECHOS_RETOMADA`: lista congelada `['retomada', 'recusada', 'nova', 'nenhuma']`.
- `ESTADOS_INFLIGHT`: lista congelada `['pendente', 'fila', 'execucao']`.
- `CAMPOS_INFLIGHT`: lista congelada com as 13 chaves da entrada, na ordem exigida.
- `AVISO_DESCARTE`: objeto congelado motivo para frase da esteira.
- `lerRetomada(engine, key)`: entrada ou `null`.
- `consumirRetomada(engine, key)`: `boolean` (se havia).
- `contextoDaConta(engine, pr)`: `{ provedor, perfilId }` a partir de `engine.resolveClaudeAuth(engine.accountForPr(pr))`.
- `guardarRetomada(engine, pr, { retomarSid, knownHead, provedor, perfilId, sessionId, headSha })`: entrada gravada ou `null` (sid fora da allowlist).
- `restaurarRetomadas(engine, lista)`: normaliza as linhas do arquivo pro Map, sem sobrescrever o que já existe.
- `emAndamentoNoBoot(lista)`: linhas com `key` e estado diferente de `pendente` (linha legada sem estado conta como em andamento).
- `montarInflight(engine)`: lista pronta pro `inflight.json`.
- `concluidaDepois(engine, entrada)`: `true` se há decisão do mesmo PR, no `knownHead` da entrada, criada a partir de `atualizadoEm`.
- `validarRetomada(entrada, { prKey, headConfirmado, contexto, concluida })`: `{ acao: 'retomar'|'aguardar'|'descartar'|'nenhuma', motivo }`.

- [ ] **Passo 1: escrever o teste que falha**

Criar `test/retomada-duravel-puro.test.js`:

```js
// Funções puras da retomada durável (CT-RET, 7.A5 da spec
// docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md).
// O módulo não importa lib/paths.js, então não precisa de FAROL_HOME; o import
// dinâmico segue o padrão da suíte mesmo assim.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const r = await import('../lib/engine/retomada-duravel.js');

const SID = 'abcd-1234-efgh';
const HEAD = 'c0ffee1234ab';
const PR = { key: 'o/r#1', url: 'https://github.com/o/r/pull/1', title: 't', author: 'a' };
const CTX = { provedor: 'dir', perfilId: '' };

function motorFalso(extra = {}) {
  return {
    activeReviews: new Map(),
    headlessQueue: [],
    decisions: { pending: [], resolved: [] },
    accountForPr: () => 'eu',
    resolveClaudeAuth: () => ({ kind: 'dir', id: '', dir: '' }),
    ...extra,
  };
}

test('listas congeladas do contrato', () => {
  assert.deepEqual([...r.DESFECHOS_RETOMADA], ['retomada', 'recusada', 'nova', 'nenhuma']);
  assert.deepEqual([...r.ESTADOS_INFLIGHT], ['pendente', 'fila', 'execucao']);
  assert.deepEqual([...r.CAMPOS_INFLIGHT], ['key', 'url', 'title', 'author', 'kind', 'estado', 'retomarSid', 'knownHead', 'provedor', 'perfilId', 'sessionId', 'headSha', 'atualizadoEm']);
  assert.equal(Object.isFrozen(r.DESFECHOS_RETOMADA), true);
  assert.equal(Object.isFrozen(r.CAMPOS_INFLIGHT), true);
  assert.equal(Object.isFrozen(r.AVISO_DESCARTE), true);
  for (const frase of Object.values(r.AVISO_DESCARTE)) assert.ok(!frase.includes(String.fromCharCode(0x2014)), 'sem travessão');
});

test('validarRetomada: só retoma com PR, head confirmado e contexto iguais', () => {
  const entrada = { key: PR.key, retomarSid: SID, knownHead: HEAD, provedor: 'dir', perfilId: '' };
  const base = { prKey: PR.key, headConfirmado: HEAD, contexto: CTX, concluida: false };
  const v = (e, o) => r.validarRetomada(e, { ...base, ...o });
  assert.deepEqual(v(entrada, {}), { acao: 'retomar', motivo: 'valida' });
  assert.deepEqual(v(null, {}), { acao: 'nenhuma', motivo: 'sem_retomada' });
  assert.deepEqual(v({ ...entrada, retomarSid: 'x; rm -rf /' }, {}), { acao: 'nenhuma', motivo: 'sem_retomada' });
  assert.deepEqual(v(entrada, { prKey: 'o/r#99' }), { acao: 'descartar', motivo: 'outro_pr' });
  assert.deepEqual(v({ ...entrada, provedor: '' }, {}), { acao: 'descartar', motivo: 'contexto_ausente' });
  assert.deepEqual(v(entrada, { contexto: { provedor: 'dir', perfilId: 'p2' } }), { acao: 'descartar', motivo: 'contexto_incompativel' });
  assert.deepEqual(v(entrada, { contexto: { provedor: 'apikey', perfilId: '' } }), { acao: 'descartar', motivo: 'contexto_incompativel' });
  assert.deepEqual(v(entrada, { contexto: null }), { acao: 'descartar', motivo: 'contexto_incompativel' });
  assert.deepEqual(v(entrada, { concluida: true }), { acao: 'descartar', motivo: 'concluida' });
  assert.deepEqual(v({ ...entrada, knownHead: '' }, {}), { acao: 'descartar', motivo: 'sem_head_salvo' });
  assert.deepEqual(v(entrada, { headConfirmado: '' }), { acao: 'aguardar', motivo: 'head_nao_confirmado' });
  assert.deepEqual(v(entrada, { headConfirmado: 'facada998877' }), { acao: 'descartar', motivo: 'head_mudou' });
});

test('guardarRetomada: sid fora da allowlist não grava nada', () => {
  const e = motorFalso();
  assert.equal(r.guardarRetomada(e, PR, { retomarSid: 'x; rm -rf /', knownHead: HEAD, ...CTX }), null);
  assert.equal(r.guardarRetomada(e, { url: 'sem key' }, { retomarSid: SID }), null);
  assert.equal(r.lerRetomada(e, PR.key), null);
});

test('guardarRetomada: grava o formato exato e herda head e contexto só da MESMA sessão', () => {
  const e = motorFalso();
  const primeira = r.guardarRetomada(e, PR, { retomarSid: SID, knownHead: HEAD, ...CTX });
  assert.deepEqual(Object.keys(primeira), [...r.CAMPOS_INFLIGHT]);
  assert.equal(primeira.estado, 'pendente');
  assert.equal(primeira.kind, 'auto');
  assert.equal(primeira.sessionId, SID);
  assert.equal(primeira.headSha, HEAD);
  assert.ok(Number.isFinite(Date.parse(primeira.atualizadoEm)));
  // mesma sessão, sem head nem contexto novos: herda
  const mesma = r.guardarRetomada(e, PR, { retomarSid: SID });
  assert.equal(mesma.knownHead, HEAD);
  assert.equal(mesma.provedor, 'dir');
  // sessão nova: não herda nada da anterior
  const nova = r.guardarRetomada(e, PR, { retomarSid: 'outra-sessao-01' });
  assert.equal(nova.knownHead, '');
  assert.equal(nova.provedor, '');
  // contexto explícito com perfil vazio vale como está, não herda o perfil anterior
  r.guardarRetomada(e, PR, { retomarSid: 'sessao-perfil-1', knownHead: HEAD, provedor: 'dir', perfilId: 'p2' });
  const semPerfil = r.guardarRetomada(e, PR, { retomarSid: 'sessao-perfil-1', provedor: 'dir', perfilId: '' });
  assert.equal(semPerfil.perfilId, '');
});

test('consumirRetomada devolve se havia e tira do Map', () => {
  const e = motorFalso();
  r.guardarRetomada(e, PR, { retomarSid: SID, knownHead: HEAD, ...CTX });
  assert.equal(r.consumirRetomada(e, PR.key), true);
  assert.equal(r.consumirRetomada(e, PR.key), false);
  assert.equal(r.lerRetomada(e, PR.key), null);
});

test('contextoDaConta lê provedor e perfil do auth resolvido', () => {
  const e = motorFalso({ resolveClaudeAuth: () => ({ kind: 'apikey', id: 'p9', apiKey: 'segredo' }) });
  assert.deepEqual(r.contextoDaConta(e, PR), { provedor: 'apikey', perfilId: 'p9' });
  assert.deepEqual(r.contextoDaConta({}, PR), { provedor: '', perfilId: '' });
});

test('restaurarRetomadas: legado vira retomarSid sem contexto, sid inválido cai, existente não é sobrescrito', () => {
  const e = motorFalso();
  r.guardarRetomada(e, { key: 'o/r#3' }, { retomarSid: 'viva-sessao-03', knownHead: 'h3', ...CTX });
  r.restaurarRetomadas(e, [
    { key: 'o/r#1', url: 'u1', title: 't1', sessionId: SID, headSha: HEAD },
    { key: 'o/r#2', url: 'u2', sessionId: 'curto' },
    { key: 'o/r#3', url: 'u3', retomarSid: 'velha-sessao-03', knownHead: 'h0', provedor: 'dir', perfilId: '', estado: 'fila' },
    null,
    { url: 'sem key', retomarSid: SID },
  ]);
  const legado = r.lerRetomada(e, 'o/r#1');
  assert.equal(legado.retomarSid, SID);
  assert.equal(legado.knownHead, HEAD);
  assert.equal(legado.provedor, '');
  assert.equal(legado.estado, 'pendente');
  assert.deepEqual(Object.keys(legado), [...r.CAMPOS_INFLIGHT]);
  assert.equal(r.lerRetomada(e, 'o/r#2'), null);
  assert.equal(r.lerRetomada(e, 'o/r#3').retomarSid, 'viva-sessao-03');
});

test('emAndamentoNoBoot: fila, execução e legado sem estado; pendente fica de fora', () => {
  const lista = [
    { key: 'a#1', estado: 'pendente' }, { key: 'a#2', estado: 'fila' },
    { key: 'a#3', estado: 'execucao' }, { key: 'a#4' }, null, { estado: 'fila' },
  ];
  assert.deepEqual(r.emAndamentoNoBoot(lista).map(p => p.key), ['a#2', 'a#3', 'a#4']);
});

test('montarInflight: três estados, formato exato, sem duplicar e sem autoanálise', () => {
  const e = motorFalso();
  r.guardarRetomada(e, PR, { retomarSid: SID, knownHead: HEAD, ...CTX });
  r.guardarRetomada(e, { key: 'o/r#2', url: 'u2' }, { retomarSid: 'sessao-fila-02', knownHead: 'h2', ...CTX });
  e.headlessQueue.push({ key: 'o/r#2', url: 'u2', title: 't2', author: 'b' });
  e.headlessQueue.push({ key: 'o/r#9', url: 'u9', kind: 'self' });
  e.headlessQueue.push({ key: 'o/r#4', url: 'u4', title: 't4', knownHead: 'h4' });
  e.activeReviews.set('a1', { mode: 'auto', pr: { key: 'o/r#3', url: 'u3', title: 't3', author: 'c' }, sessionId: 'sessao-exec-03', headSha: 'h3' });
  e.activeReviews.set('a2', { mode: 'terminal', pr: { key: 'o/r#8' } });
  e.headlessQueue.push({ key: 'o/r#3', url: 'u3' });
  const lista = r.montarInflight(e);
  for (const item of lista) assert.deepEqual(Object.keys(item), [...r.CAMPOS_INFLIGHT]);
  const por = Object.fromEntries(lista.map(i => [i.key, i]));
  assert.deepEqual(Object.keys(por).sort(), ['o/r#1', 'o/r#2', 'o/r#3', 'o/r#4']);
  assert.equal(por['o/r#3'].estado, 'execucao');
  assert.equal(por['o/r#3'].sessionId, 'sessao-exec-03');
  assert.equal(por['o/r#3'].headSha, 'h3');
  assert.equal(por['o/r#3'].retomarSid, '');
  assert.equal(por['o/r#2'].estado, 'fila');
  assert.equal(por['o/r#2'].retomarSid, 'sessao-fila-02');
  assert.equal(por['o/r#4'].estado, 'fila');
  assert.equal(por['o/r#4'].knownHead, 'h4');
  assert.equal(por['o/r#1'].estado, 'pendente');
  assert.equal(por['o/r#1'].provedor, 'dir');
  assert.equal(lista.filter(i => i.key === 'o/r#3').length, 1, 'execução vence a fila, sem linha dobrada');
  assert.deepEqual(r.montarInflight({}), [], 'motor sem Map e sem fila não lança');
});

test('concluidaDepois: só decisão do mesmo PR e head, criada depois da referência', () => {
  const agora = Date.now();
  const entrada = { key: PR.key, knownHead: HEAD, atualizadoEm: new Date(agora - 60000).toISOString() };
  const com = (d) => motorFalso({ decisions: { pending: [], resolved: [d] } });
  assert.equal(r.concluidaDepois(com({ key: PR.key, headSha: HEAD, createdAt: agora }), entrada), true);
  assert.equal(r.concluidaDepois(motorFalso({ decisions: { pending: [{ key: PR.key, headSha: HEAD, createdAt: agora }], resolved: [] } }), entrada), true);
  assert.equal(r.concluidaDepois(com({ key: PR.key, headSha: HEAD, createdAt: agora - 120000 }), entrada), false, 'decisão anterior à queda');
  assert.equal(r.concluidaDepois(com({ key: PR.key, headSha: 'outro', createdAt: agora }), entrada), false);
  assert.equal(r.concluidaDepois(com({ key: 'o/r#2', headSha: HEAD, createdAt: agora }), entrada), false);
  assert.equal(r.concluidaDepois(com({ key: PR.key, headSha: HEAD, createdAt: agora }), { ...entrada, knownHead: '' }), false);
  assert.equal(r.concluidaDepois(com({ key: PR.key, headSha: HEAD, createdAt: agora }), { ...entrada, atualizadoEm: 'lixo' }), false);
  assert.equal(r.concluidaDepois(motorFalso({ decisions: undefined }), entrada), false);
  assert.equal(r.concluidaDepois(motorFalso(), null), false);
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `node --test test/retomada-duravel-puro.test.js`
Esperado: FAIL em todos, com `ERR_MODULE_NOT_FOUND` apontando `lib/engine/retomada-duravel.js`.

- [ ] **Passo 3: implementar**

Criar `lib/engine/retomada-duravel.js`:

```js
// Retomada durável (CT-RET da spec docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md,
// entrega 7.A5). Fonte única da referência de retomada de uma revisão headless
// interrompida: engine.retomadas (key do PR -> entrada), espelhada no
// state/inflight.json por montarInflight e restaurada no boot por restaurarRetomadas.
//
// A entrada só sai do Map por consumirRetomada, e quem chama consumir é um DESFECHO:
// sessão que devolveu resultado, retomada recusada pelo CLI, descarte comprovado
// (head mudou, contexto diferente, revisão equivalente concluída), recibo de outro
// aparelho, cancelamento, falha permanente, PR mergeado ou fechado. Recusa temporária
// (lease, vaga, orçamento, coordenação fora, head não confirmado) nunca consome.
//
// Sem IO de propósito: quem grava o arquivo é o server.js (writeInflight), com
// writeJsonAtomic, e quem decide o que fazer com a validação é o review.js.

// formato de session id do CLI que pode entrar numa linha de shell (--resume). Era
// local do review.js; mora aqui porque é também o que decide se uma linha do
// inflight.json carrega referência de retomada.
const RESUME_SID_RE = /^[0-9a-zA-Z-]{8,64}$/;

const DESFECHOS_RETOMADA = Object.freeze(['retomada', 'recusada', 'nova', 'nenhuma']);
const ESTADOS_INFLIGHT = Object.freeze(['pendente', 'fila', 'execucao']);
const CAMPOS_INFLIGHT = Object.freeze(['key', 'url', 'title', 'author', 'kind', 'estado', 'retomarSid', 'knownHead', 'provedor', 'perfilId', 'sessionId', 'headSha', 'atualizadoEm']);

// frase da esteira quando a referência é descartada antes da sessão. A de head_mudou
// é a mesma de antes desta entrega (test/retomada-apos-falha.test.js casa o texto).
const AVISO_DESCARTE = Object.freeze({
  head_mudou: 'O PR recebeu commit novo depois da queda: a sessão interrompida não é retomada, esta revisão lê o head atual do zero.',
  sem_head_salvo: 'A sessão interrompida não registrou qual commit leu: ela não é retomada, esta revisão lê o head atual do zero.',
  contexto_ausente: 'A sessão interrompida não registrou o perfil do Claude que a abriu: ela não é retomada, esta revisão começa do zero.',
  contexto_incompativel: 'O perfil ou o provedor desta conta mudou desde a queda: a sessão interrompida não é retomada, esta revisão começa do zero.',
  concluida: 'Este commit já tem revisão concluída depois da queda: a sessão interrompida não é retomada.',
  outro_pr: 'A referência de retomada não pertence a este PR: ela foi descartada e esta revisão começa do zero.',
});

function texto(v) { return typeof v === 'string' ? v : ''; }

function mapaDe(engine) {
  if (!(engine.retomadas instanceof Map)) engine.retomadas = new Map();
  return engine.retomadas;
}

function lerRetomada(engine, key) { return mapaDe(engine).get(key) || null; }

function consumirRetomada(engine, key) { return mapaDe(engine).delete(key); }

// contexto local que originou a sessão: o kind do auth resolvido (dir, apikey,
// openrouter, codex) e o id do perfil ('' no legado sem perfil). O grupo de consumo
// não substitui esta identidade (CT-RET).
function contextoDaConta(engine, pr) {
  if (typeof engine.resolveClaudeAuth !== 'function') return { provedor: '', perfilId: '' };
  const conta = typeof engine.accountForPr === 'function' ? engine.accountForPr(pr) : '';
  const auth = engine.resolveClaudeAuth(conta) || {};
  return { provedor: texto(auth.kind), perfilId: texto(auth.id) };
}

function guardarRetomada(engine, pr, dados = {}) {
  const sid = texto(dados.retomarSid);
  if (!pr || !texto(pr.key) || !RESUME_SID_RE.test(sid)) return null;
  const mapa = mapaDe(engine);
  const anterior = mapa.get(pr.key) || {};
  // head e contexto só são herdados da MESMA sessão: sessão nova com dado ausente
  // fica sem prova, e a validação descarta em vez de supor
  const mesmaSessao = anterior.retomarSid === sid;
  const herdado = (campo) => (mesmaSessao ? texto(anterior[campo]) : '');
  const temContexto = texto(dados.provedor) !== '';
  const provedor = temContexto ? texto(dados.provedor) : herdado('provedor');
  const perfilId = temContexto ? texto(dados.perfilId) : herdado('perfilId');
  const knownHead = texto(dados.knownHead) || herdado('knownHead');
  const entrada = {
    key: pr.key,
    url: texto(pr.url) || texto(anterior.url),
    title: texto(pr.title) || texto(anterior.title),
    author: texto(pr.author) || texto(anterior.author),
    kind: 'auto',
    estado: 'pendente',
    retomarSid: sid,
    knownHead,
    provedor,
    perfilId,
    sessionId: texto(dados.sessionId) || sid,
    headSha: texto(dados.headSha) || knownHead,
    atualizadoEm: new Date().toISOString(),
  };
  mapa.set(pr.key, entrada);
  return entrada;
}

// linha do inflight.json -> entrada do Map. O inflight da v2.57.3 guardava só
// sessionId e headSha: a referência vira retomarSid, o head vira knownHead, e o
// contexto fica vazio, o que a validação lê como contexto ausente.
function normalizarEntrada(bruta, agoraIso) {
  if (!bruta || typeof bruta !== 'object' || !texto(bruta.key)) return null;
  const retomarSid = texto(bruta.retomarSid) || texto(bruta.sessionId);
  if (!RESUME_SID_RE.test(retomarSid)) return null;
  return {
    key: bruta.key,
    url: texto(bruta.url),
    title: texto(bruta.title),
    author: texto(bruta.author),
    kind: 'auto',
    estado: 'pendente',
    retomarSid,
    knownHead: texto(bruta.knownHead) || texto(bruta.headSha),
    provedor: texto(bruta.provedor),
    perfilId: texto(bruta.perfilId),
    sessionId: texto(bruta.sessionId),
    headSha: texto(bruta.headSha),
    atualizadoEm: texto(bruta.atualizadoEm) || agoraIso,
  };
}

function restaurarRetomadas(engine, lista) {
  const mapa = mapaDe(engine);
  const agoraIso = new Date().toISOString();
  for (const bruta of Array.isArray(lista) ? lista : []) {
    const entrada = normalizarEntrada(bruta, agoraIso);
    if (entrada && !mapa.has(entrada.key)) mapa.set(entrada.key, entrada);
  }
  return mapa;
}

function emAndamentoNoBoot(lista) {
  return (Array.isArray(lista) ? lista : []).filter(p => !!p && texto(p.key) !== '' && p.estado !== 'pendente');
}

function linhaInflight(base, entrada, estado, extra) {
  const r = entrada || {};
  return {
    key: base.key,
    url: texto(base.url) || texto(r.url),
    title: texto(base.title) || texto(r.title),
    author: texto(base.author) || texto(r.author),
    kind: 'auto',
    estado,
    retomarSid: texto(r.retomarSid),
    knownHead: texto(r.knownHead) || texto(base.knownHead),
    provedor: texto(r.provedor),
    perfilId: texto(r.perfilId),
    sessionId: texto(extra.sessionId) || texto(r.sessionId),
    headSha: texto(extra.headSha) || texto(r.headSha),
    atualizadoEm: texto(r.atualizadoEm) || new Date().toISOString(),
  };
}

// execução vence fila, fila vence pendente: um PR aparece uma vez só. A referência que
// não está nem na fila nem rodando (esperando vaga entre o dequeue e a sessão, lease,
// orçamento, head não confirmado, retry) sai como pendente, e é isso que fecha a
// janela em que a única referência recuperável sumia do disco.
function montarInflight(engine) {
  const mapa = mapaDe(engine);
  const ativas = engine.activeReviews instanceof Map ? [...engine.activeReviews.values()] : [];
  const fila = Array.isArray(engine.headlessQueue) ? engine.headlessQueue : [];
  const vistos = new Set();
  const lista = [];
  const empurrar = (base, estado, extra) => {
    if (!base || !texto(base.key) || vistos.has(base.key)) return;
    vistos.add(base.key);
    lista.push(linhaInflight(base, mapa.get(base.key), estado, extra));
  };
  for (const s of ativas) {
    if (s && s.mode === 'auto' && s.pr) empurrar(s.pr, 'execucao', { sessionId: texto(s.sessionId), headSha: texto(s.headSha) });
  }
  for (const p of fila) {
    if (p && p.kind !== 'self') empurrar(p, 'fila', {});
  }
  for (const entrada of mapa.values()) empurrar(entrada, 'pendente', {});
  return lista;
}

// revisão equivalente já concluída: decisão do mesmo PR, sobre o mesmo commit que a
// sessão interrompida leu, criada a partir do momento em que a referência foi gravada
function concluidaDepois(engine, entrada) {
  if (!entrada || !texto(entrada.knownHead)) return false;
  const desde = Date.parse(entrada.atualizadoEm);
  if (!Number.isFinite(desde)) return false;
  const decisoes = engine.decisions || {};
  const todas = [...(decisoes.pending || []), ...(decisoes.resolved || [])];
  return todas.some(d => !!d && d.key === entrada.key && d.headSha === entrada.knownHead && Number(d.createdAt) >= desde);
}

// Ordem das perguntas: pertence a este PR, veio do mesmo contexto local, ninguém já
// concluiu, sabemos qual commit ela leu, o commit atual está CONFIRMADO e é o mesmo.
// Head salvo é evidência da tentativa anterior, nunca confirmação do estado atual:
// sem head atual confirmado a resposta é aguardar, nunca retomar (CT-RET).
function validarRetomada(entrada, { prKey, headConfirmado, contexto, concluida } = {}) {
  if (!entrada || !RESUME_SID_RE.test(texto(entrada.retomarSid))) return { acao: 'nenhuma', motivo: 'sem_retomada' };
  if (entrada.key !== prKey) return { acao: 'descartar', motivo: 'outro_pr' };
  if (!texto(entrada.provedor)) return { acao: 'descartar', motivo: 'contexto_ausente' };
  const ctx = contexto || {};
  if (entrada.provedor !== texto(ctx.provedor) || texto(entrada.perfilId) !== texto(ctx.perfilId)) {
    return { acao: 'descartar', motivo: 'contexto_incompativel' };
  }
  if (concluida) return { acao: 'descartar', motivo: 'concluida' };
  if (!texto(entrada.knownHead)) return { acao: 'descartar', motivo: 'sem_head_salvo' };
  if (!texto(headConfirmado)) return { acao: 'aguardar', motivo: 'head_nao_confirmado' };
  if (entrada.knownHead !== headConfirmado) return { acao: 'descartar', motivo: 'head_mudou' };
  return { acao: 'retomar', motivo: 'valida' };
}

const retomadaMod = {
  RESUME_SID_RE, DESFECHOS_RETOMADA, ESTADOS_INFLIGHT, CAMPOS_INFLIGHT, AVISO_DESCARTE,
  lerRetomada, consumirRetomada, contextoDaConta, guardarRetomada, restaurarRetomadas,
  emAndamentoNoBoot, montarInflight, concluidaDepois, validarRetomada,
};
export default retomadaMod;
export {
  RESUME_SID_RE, DESFECHOS_RETOMADA, ESTADOS_INFLIGHT, CAMPOS_INFLIGHT, AVISO_DESCARTE,
  lerRetomada, consumirRetomada, contextoDaConta, guardarRetomada, restaurarRetomadas,
  emAndamentoNoBoot, montarInflight, concluidaDepois, validarRetomada,
};
```

Nota de ratchet: `montarInflight` tem `for` com `if` de uma linha dentro (profundidade 2); o `if` com chaves em `validarRetomada` fica em profundidade 1; nenhum statement tem dois `?` (o `provedor`/`perfilId` saem em statements separados justamente por isso).

- [ ] **Passo 4: rodar e ver passar**

Rodar: `node --test test/retomada-duravel-puro.test.js`
Esperado: PASS em todos (11 testes).

Rodar: `npm run check && npm run lint`
Esperado: verde; o lint lista `lib/engine/retomada-duravel.js` sem violação nova.

- [ ] **Passo 5: contraprova**

Mutação: em `lib/engine/retomada-duravel.js`, apagar a linha
`  if (!texto(headConfirmado)) return { acao: 'aguardar', motivo: 'head_nao_confirmado' };`
Rodar: `node --test test/retomada-duravel-puro.test.js`
Esperado: FAIL em `validarRetomada: só retoma com PR, head confirmado e contexto iguais`, com o `deepEqual` do caso `headConfirmado: ''` recebendo `{ acao: 'descartar', motivo: 'head_mudou' }`.
Restaurar a linha e rodar de novo: PASS.

Segunda mutação: em `guardarRetomada`, trocar `const mesmaSessao = anterior.retomarSid === sid;` por `const mesmaSessao = true;`.
Esperado: FAIL em `guardarRetomada: grava o formato exato e herda head e contexto só da MESMA sessão` (`nova.knownHead` recebe o head da sessão anterior). Restaurar: PASS.

- [ ] **Passo 6: commit**

```
git add lib/engine/retomada-duravel.js test/retomada-duravel-puro.test.js
git commit -m "feat(retomada): modulo da retomada duravel com validacao pura"
```

---

## Tarefa 2: persistência sem janela (boot, fila e retry fechado)

Fecha os gaps (1) e (2) da seção 4.5 e a poda do retry.

**Arquivos:**
- Modificar: `server.js` (import perto da linha 42; construtor perto da linha 303; `recoverInflight` 371-408; `writeInflight` 410-418; `_repescarRetry` 1218-1220)
- Modificar: `lib/engine/review.js` (import perto da linha 13; remover `consumirRetomadaPendente` 341-354; `enqueueHeadless` 397-406)
- Modificar: `test/inflight-session-id.test.js`
- Modificar: `test/retry-net.test.js` (723-734)
- Criar: `test/retomada-duravel.test.js`

**Interfaces:**
- `engine.retomadas: Map<string, entrada>` substitui `engine.retomadaPendente` (que deixa de existir).
- `Engine.writeInflight()` grava `retomadaMod.montarInflight(this)`.
- `Engine.recoverInflight()` restaura, **regrava** o arquivo e só trata como "em andamento" as linhas fora de `pendente`.
- `enqueueHeadless` lê a entrada e carimba `retomarSid` e `knownHead` no PR, sem consumir.

- [ ] **Passo 1: escrever os testes que falham**

Criar `test/retomada-duravel.test.js` (harness compartilhado pelas Tarefas 2 a 5):

```js
// Retomada durável na Engine real (CT-RET, 7.A5 da spec
// docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md).
// FAROL_HOME temporário ANTES do import do server.js (const de nível de módulo) e
// import dinâmico, padrão de test/inflight-session-id.test.js. Sessão Claude nunca
// abre: runClaudeStream é stubado, e onde a fachada real precisa rodar (admissão da
// coordenação) o spawn do CLI é vigiado e recusado.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import childProcess from 'node:child_process';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-retomada-duravel-'));
process.env.FAROL_HOME = HOME;
delete process.env.FAROL_HEADLESS_CMD;

const spawnReal = childProcess.spawn;
let spawnsDoCli = 0;
childProcess.spawn = function spawnVigiado(cmd, args, opts) {
  if ((args || []).join(' ').includes('stream-json')) {
    spawnsDoCli++;
    throw new Error('spawn do CLI nesta suíte é defeito');
  }
  return spawnReal(cmd, args, opts);
};

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const fanout = (await import('../lib/engine/fanout.js')).default;
const retomada = await import('../lib/engine/retomada-duravel.js');
const { retomadaAposFalhaBlock } = await import('../lib/engine/review.js');

const prMetricsOriginal = fanout.prMetrics;
fanout.prMetrics = async () => null;

after(() => {
  childProcess.spawn = spawnReal;
  fanout.prMetrics = prMetricsOriginal;
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const INFLIGHT = path.join(HOME, 'workspace', 'state', 'inflight.json');
const HEAD = 'c0ffee1234ab';
const SID = 'abcd-1234-efgh';
const PR = {
  key: 'o/r#21', repo: 'o/r', number: 21, url: 'https://github.com/o/r/pull/21',
  requested: true, title: 'fix: algo', author: 'alguem'
};
const ENVELOPE = {
  analysisStatus: 'complete', verdict: 'approve', decision: 'needs_decision', cardMet: true,
  reasons: [], reportMarkdown: 'relatório', payloads: {}
};
const CONTEXTO = { provedor: 'dir', perfilId: '' };
const RESPOSTA = () => ({ text: JSON.stringify({ result: JSON.stringify(ENVELOPE) }), sessionId: 'sessao-nova-0001' });

beforeEach(() => {
  spawnsDoCli = 0;
  fs.mkdirSync(path.dirname(INFLIGHT), { recursive: true });
  fs.writeFileSync(INFLIGHT, '[]');
});

function lerInflight() { return JSON.parse(fs.readFileSync(INFLIGHT, 'utf8')); }
function linha(key) { return lerInflight().find(i => i.key === key); }

// referência como a Engine deste teste a produziria: config sem claudeProfiles
// resolve { kind: 'dir', id: '' }
function semear(e, extra = {}) {
  return retomada.guardarRetomada(e, PR, { retomarSid: SID, knownHead: HEAD, ...CONTEXTO, sessionId: SID, headSha: HEAD, ...extra });
}

// Engine real com o mínimo stubado (mesmo recorte de test/retomada-apos-falha.test.js)
function motor() {
  const e = new Engine();
  e.log = () => { };
  e.accountForPr = () => 'trabalho';
  e.approvePolicyFor = () => 'wait';
  e.rejectPolicyFor = () => 'wait';
  e.scopeLabel = () => 'Conta Trabalho';
  e.writeMemory = () => { };
  e.headSha = async () => HEAD;
  e.myReviewsWithTime = async () => [];
  e.postReview = async () => ({ ok: true });
  e.chamadas = [];
  e.decididos = [];
  const decidirOriginal = e.recordDecision.bind(e);
  e.recordDecision = (pr, result, extra) => { e.decididos.push(result); return decidirOriginal(pr, result, extra); };
  e.runClaudeStream = async (prompt, opts) => {
    e.chamadas.push({
      prompt, extraArgs: [...(opts.extraArgs || [])], opcao: opts.resumeOutcome,
      registro: (e.activeReviews.get(opts.id) || {}).resumeOutcome, guardada: e.retomadas.has(PR.key),
    });
    return RESPOSTA();
  };
  return e;
}

/* ---------- Tarefa 2: persistência sem janela ---------- */

test('writeInflight grava execução, fila e pendente no formato exato', () => {
  const e = motor();
  semear(e);
  retomada.guardarRetomada(e, { key: 'o/r#22', url: 'u22', title: 't22', author: 'a' }, { retomarSid: 'sessao-fila-0022', knownHead: 'h22', ...CONTEXTO });
  e.headlessQueue.push({ key: 'o/r#22', url: 'u22', title: 't22', author: 'a' });
  e.activeReviews.set('a9', { mode: 'auto', pr: { key: 'o/r#23', url: 'u23', title: 't23', author: 'b' }, sessionId: 'sessao-exec-0023', headSha: 'h23' });
  e.writeInflight();
  const lista = lerInflight();
  for (const item of lista) assert.deepEqual(Object.keys(item), [...retomada.CAMPOS_INFLIGHT]);
  assert.equal(linha(PR.key).estado, 'pendente');
  assert.equal(linha(PR.key).retomarSid, SID);
  assert.equal(linha(PR.key).knownHead, HEAD);
  assert.equal(linha(PR.key).provedor, 'dir');
  assert.equal(linha('o/r#22').estado, 'fila');
  assert.equal(linha('o/r#22').retomarSid, 'sessao-fila-0022');
  assert.equal(linha('o/r#23').estado, 'execucao');
  assert.equal(linha('o/r#23').sessionId, 'sessao-exec-0023');
});

test('dois reinícios antes da retomada não perdem a referência', () => {
  const a = motor();
  semear(a);
  a.writeInflight();
  const b = new Engine();
  assert.equal(b.retomadas.get(PR.key).retomarSid, SID);
  assert.equal(linha(PR.key).estado, 'pendente', 'o boot regrava a referência em vez de esvaziar o arquivo');
  const c = new Engine();
  const entrada = c.retomadas.get(PR.key);
  assert.ok(entrada, 'o segundo reinício ainda encontra a referência');
  assert.equal(entrada.retomarSid, SID);
  assert.equal(entrada.knownHead, HEAD);
  assert.equal(entrada.provedor, 'dir');
  assert.equal(linha(PR.key).retomarSid, SID);
});

test('referência preservada enquanto espera vaga na fila, inclusive depois de reiniciar', () => {
  const a = motor();
  semear(a);
  a.processHeadless = () => { }; // conta sem vaga: o item fica na fila
  a.pushState = () => { };
  a.enqueueHeadless({ ...PR });
  assert.equal(a.headlessQueue.length, 1);
  assert.equal(a.headlessQueue[0].retomarSid, SID, 'o PR enfileirado carrega a referência');
  assert.equal(a.headlessQueue[0].knownHead, HEAD);
  assert.equal(a.retomadas.has(PR.key), true, 'enfileirar não consome');
  const item = linha(PR.key);
  assert.equal(item.estado, 'fila');
  assert.equal(item.retomarSid, SID);
  assert.equal(item.knownHead, HEAD);
  assert.equal(item.provedor, 'dir');
  const b = new Engine();
  assert.equal(b.retomadas.get(PR.key).retomarSid, SID, 'crash com o PR na fila não perde a referência');
});

test('boot com linha pendente não repete o aviso de revisão em andamento', () => {
  const a = motor();
  semear(a);
  a.writeInflight();
  const avisos = [];
  const b = new Engine();
  assert.deepEqual(b.inflightRecuperado, [], 'pendente não é revisão em andamento: nenhuma label a limpar');
  b.log = (nivel, msg) => avisos.push(`${nivel} ${msg}`);
  b.recoverInflight();
  assert.equal(avisos.some(t => /app reiniciado com revisão em andamento/.test(t)), false);
});

test('PR fechado enquanto aguardava o retry: a referência sai junto', async () => {
  const e = motor();
  semear(e);
  e.isMuted = () => false;
  e.tokens = { trabalho: 'tok' };
  e.budgetBlockedFor = () => false;
  e.prState = async () => 'CLOSED';
  e.retryAfterNet.set(PR.key, { tries: 1, pr: { ...PR }, notBefore: null });
  await e._repescarRetry([], new Set());
  assert.equal(e.retryAfterNet.has(PR.key), false);
  assert.equal(e.retomadas.has(PR.key), false);
});
```

Modificar `test/inflight-session-id.test.js`:

1. Trocar o comentário das linhas 1 a 8 por:

```js
// Task 2 (v2.57.3) e A5 (retomada durável): sessionId persistido assim que nasce,
// não só no fim da revisão. writeInflight serializa sessionId (ou '' sem ele) junto
// do PR ativo, e o boot restaura a referência em engine.retomadas
// (lib/engine/retomada-duravel.js). enqueueHeadless só LÊ a referência: quem a
// consome é um desfecho. IMPORTANTE: FAROL_HOME temporário ANTES do import de
// server.js (const de nível de módulo lida uma única vez no load), mesmo padrão de
// test/boot.test.js e test/retry-net.test.js.
```

2. Substituir o teste `boot com inflight.json contendo sessionId popula retomadaPendente, consumido por enqueueHeadless como retomarSid` inteiro por:

```js
test('boot com inflight.json legado (só sessionId) restaura a referência e o enqueueHeadless não consome', () => {
  fs.mkdirSync(path.join(HOME, 'workspace', 'state'), { recursive: true });
  fs.writeFileSync(path.join(HOME, 'workspace', 'state', 'inflight.json'), JSON.stringify([
    { key: 'o/r#3', url: 'https://github.com/o/r/pull/3', title: 't', sessionId: 'sid-recuperado' }
  ]));
  const e = engineBase();
  const entrada = e.retomadas.get('o/r#3');
  assert.ok(entrada, 'referência restaurada no boot');
  assert.equal(entrada.retomarSid, 'sid-recuperado');
  assert.equal(entrada.knownHead, '');
  assert.equal(entrada.provedor, '', 'inflight legado não tem contexto; a validação decide depois');

  // dependências do enqueueHeadless real: processHeadless/pushState viram no-op,
  // o teste foca só no dado que entra na fila
  e.processHeadless = () => { };
  e.pushState = () => { };
  enqueueHeadless(e, { key: 'o/r#3', url: 'https://github.com/o/r/pull/3', title: 't' });
  const enfileirado = e.headlessQueue.find(p => p.key === 'o/r#3');
  assert.ok(enfileirado, 'PR redescoberto entrou na fila');
  assert.equal(enfileirado.retomarSid, 'sid-recuperado', 'sid recuperado carimbado como retomarSid');
  assert.equal(e.retomadas.has('o/r#3'), true, 'enfileirar não consome: quem consome é um desfecho');
});
```

3. No teste `boot com inflight.json sem sessionId não gera retomadaPendente pro PR`, trocar o nome por `boot com inflight.json sem sessionId não gera referência pro PR` e a asserção por:

```js
  assert.equal(e.retomadas.has('o/r#4'), false);
```

4. Substituir os testes `boot com headSha carimba knownHead junto do retomarSid no enqueueHeadless` e `knownHead que já veio no objeto não é sobrescrito pelo head do boot` inteiros por:

```js
test('boot com headSha carimba knownHead junto do retomarSid no enqueueHeadless', () => {
  fs.mkdirSync(path.join(HOME, 'workspace', 'state'), { recursive: true });
  fs.writeFileSync(path.join(HOME, 'workspace', 'state', 'inflight.json'), JSON.stringify([
    { key: 'o/r#6', url: 'https://github.com/o/r/pull/6', title: 't', sessionId: 'sid-000006', headSha: 'head-6' }
  ]));
  const e = engineBase();
  assert.equal(e.retomadas.get('o/r#6').retomarSid, 'sid-000006');
  assert.equal(e.retomadas.get('o/r#6').knownHead, 'head-6');
  e.processHeadless = () => { };
  e.pushState = () => { };
  enqueueHeadless(e, { key: 'o/r#6', url: 'https://github.com/o/r/pull/6', title: 't' });
  const enfileirado = e.headlessQueue.find(p => p.key === 'o/r#6');
  assert.equal(enfileirado.retomarSid, 'sid-000006');
  assert.equal(enfileirado.knownHead, 'head-6');
});

test('knownHead que já veio no objeto não é sobrescrito pelo head do boot', () => {
  fs.mkdirSync(path.join(HOME, 'workspace', 'state'), { recursive: true });
  fs.writeFileSync(path.join(HOME, 'workspace', 'state', 'inflight.json'), JSON.stringify([
    { key: 'o/r#7', url: 'https://github.com/o/r/pull/7', title: 't', sessionId: 'sid-000007', headSha: 'head-antigo' }
  ]));
  const e = engineBase();
  e.processHeadless = () => { };
  e.pushState = () => { };
  enqueueHeadless(e, { key: 'o/r#7', url: 'https://github.com/o/r/pull/7', title: 't', knownHead: 'head-vivo' });
  const enfileirado = e.headlessQueue.find(p => p.key === 'o/r#7');
  assert.equal(enfileirado.knownHead, 'head-vivo', 'o caminho vivo manda');
  assert.equal(enfileirado.retomarSid, 'sid-000007');
});
```

(O sid `sid-6`/`sid-7` antigo tem 5 caracteres e fica fora da `RESUME_SID_RE`; a referência nunca seria restaurada. Por isso os ids mudam.)

Modificar `test/retry-net.test.js`, substituindo o bloco das linhas 723 a 734 (comentário e teste `_repescarRetry poda o retomadaPendente do PR mergeado`) por:

```js
/* ---------- a referência de retomada não vaza: PR podado leva ela junto ---------- */
// A referência só sai do Map por um desfecho. PR mergeado/fechado nunca volta a
// rodar, então sem esta poda ela ficaria no inflight.json pra sempre.
test('_repescarRetry consome a referência de retomada do PR mergeado', async () => {
  const e = engineForPrune();
  e.prState = async () => 'MERGED';
  e.retryAfterNet.set('o/r#21', { tries: 1, pr: prDe('o/r#21') });
  e.retomadas.set('o/r#21', { key: 'o/r#21', retomarSid: 'sid-000021', knownHead: 'head-21', provedor: 'dir', perfilId: '' });
  await e._repescarRetry([], new Set());
  assert.equal(e.retryAfterNet.has('o/r#21'), false);
  assert.equal(e.retomadas.has('o/r#21'), false, 'a referência morre junto do PR');
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `node --test test/retomada-duravel.test.js test/inflight-session-id.test.js test/retry-net.test.js`
Esperado: FAIL em `writeInflight grava execução, fila e pendente no formato exato` (chaves sem `estado`), `dois reinícios antes da retomada não perdem a referência` (`b.retomadas` indefinido), `referência preservada enquanto espera vaga...` (fila sem `retomarSid`), `PR fechado enquanto aguardava o retry...` (referência não consumida), nos dois de boot do `inflight-session-id` (`e.retomadas` indefinido) e no novo do `retry-net`.

- [ ] **Passo 3: implementar**

`server.js`, logo abaixo de `import reviewMod from './lib/engine/review.js';` (linha 42):

```js
import retomadaMod from './lib/engine/retomada-duravel.js';
```

`server.js`, construtor, logo abaixo da linha `this.retryAfterNet = new Map();  // key do PR -> { tries, pr } da re-revisão pós-falha transitória` (303):

```js
    // referência de retomada durável (CT-RET): key do PR -> entrada, espelhada no
    // inflight.json por writeInflight; só um desfecho a consome (lib/engine/retomada-duravel.js)
    this.retomadas = new Map();
```

`server.js`, substituir o método `recoverInflight` inteiro (371-408), incluindo o comentário acima dele, por:

```js
  // revisões que estavam rodando ou na fila quando o app morreu: devolve à fila (o PR
  // já tinha sido marcado como visto, então sem isso ele sumiria em silêncio)
  recoverInflight() {
    const inflight = readJson(INFLIGHT_FILE, [], (m) => this.log('WARN', m));
    if (!Array.isArray(inflight) || !inflight.length) return;
    for (const pr of inflight) { if (pr && pr.key) this.unsee(pr.key); }
    // CT-RET: a referência de retomada vai pro Map durável e o arquivo é REGRAVADO com
    // ela em estado pendente, nunca esvaziado. Até a A5 o boot gravava [] logo depois
    // de mover o sid pra memória, e um segundo reinício antes de o PR reaparecer perdia
    // a única referência recuperável. Quem tira a entrada é um desfecho.
    retomadaMod.restaurarRetomadas(this, inflight);
    this.writeInflight();
    // só o que estava em fila ou em execução é "revisão em andamento": a linha
    // pendente de um boot anterior repetiria o aviso, a poda e a limpeza de label
    // a cada reinício
    const emCurso = retomadaMod.emAndamentoNoBoot(inflight);
    // G7: a âncora do round 2 é gravada ANTES de enfileirar; se o app morreu com
    // a re-revisão na fila/rodando, a âncora sem a revisão mataria o round pra
    // sempre naquele head. Poda em duas metades via ancoraAposReinicio (head
    // vazio nunca casa com headRound e o gate re-arma igual, mas o teto do dia
    // sobrevive ao reinício); a âncora legada não tem contador a preservar.
    let podado = false;
    for (const pr of emCurso) {
      if (!this.reReviewLaunched) continue;
      const v = this.reReviewLaunched[pr.key];
      if (v === undefined) continue;
      const nova = ancoraAposReinicio(v);
      if (nova === undefined) delete this.reReviewLaunched[pr.key];
      else this.reReviewLaunched[pr.key] = nova;
      podado = true;
    }
    if (podado) this.saveReReviewLaunched();
    // a label `<conta>:revisando` desses PRs ficou presa (o finally que a remove
    // não roda quando o processo morre); o start() limpa, já com token na mão
    this.inflightRecuperado = emCurso.filter(p => p.url);
    if (emCurso.length) this.log('WARN', `app reiniciado com revisão em andamento: ${emCurso.map(p => p.key).join(', ')} devolvido(s) à fila`);
  }
```

(Isto remove o `try { writeJsonAtomic(INFLIGHT_FILE, []); } catch { }` da linha 387, que era um dos dois `emptyCatch` da baseline do `server.js`. A contagem desce; o ratchet aceita. Rode `npm run lint:update` no passo 4 para travar o número mais baixo.)

`server.js`, substituir o método `writeInflight` inteiro (410-418) por:

```js
  writeInflight() {
    try {
      writeJsonAtomic(INFLIGHT_FILE, retomadaMod.montarInflight(this));
    } catch { /* melhor perder a recuperação que derrubar a revisão */ }
  }
```

`server.js`, em `_repescarRetry`, substituir as linhas 1218-1220:

```js
        // PR fechado não volta: o sid guardado no boot pra ele nunca vai ser
        // consumido pelo enqueueHeadless, e sem isto o Map só cresce.
        if (this.retomadaPendente) this.retomadaPendente.delete(pr.key);
```

por:

```js
        // PR fechado não volta: a referência de retomada dele é consumida aqui, senão
        // ficaria no inflight.json pra sempre
        retomadaMod.consumirRetomada(this, pr.key);
```

`lib/engine/review.js`, abaixo de `import { classify, resetAtFrom } from '../log-taxonomy.js';` (linha 13):

```js
import retomadaMod from './retomada-duravel.js';
```

`lib/engine/review.js`, remover o comentário e a função `consumirRetomadaPendente` inteiros (linhas 341-354, do `// get + delete: o sid guardado na recuperação do boot só serve pra ESTA` até o `}` que fecha a função). Manter as duas linhas de comentário de seção logo acima (`// --- revisao autonoma (headless): ...` e a seguinte).

`lib/engine/review.js`, em `enqueueHeadless`, substituir o bloco das linhas 397-406:

```js
  // sid deixado pela recuperação do boot (Task 2): o PR redescoberto pelo
  // check() carrega o sid da sessão que o app perdeu ao morrer, pra pedir
  // retomada em vez de sessão nova (Task 3 valida o formato e consome).
  const pendente = consumirRetomadaPendente(engine, pr.key);
  if (pendente.sid) {
    pr = { ...pr, retomarSid: pendente.sid };
    // knownHead que já veio no objeto (relançamento de re-revisão, G8) manda:
    // ele é do caminho vivo; o do boot é só pra quem não tinha nenhum.
    if (!pr.knownHead && pendente.head) pr.knownHead = pendente.head;
  }
```

por:

```js
  // referência de retomada durável (CT-RET): o PR carrega o sid e o head que a
  // sessão interrompida leu. Só LÊ: enfileirar não é desfecho, e crash com o PR na
  // fila não pode perder a referência. A validação (runHeadlessReview) decide se retoma.
  const guardada = retomadaMod.lerRetomada(engine, pr.key);
  if (guardada) {
    pr = { ...pr, retomarSid: guardada.retomarSid };
    // knownHead que já veio no objeto (relançamento de re-revisão, G8) manda:
    // ele é do caminho vivo; o da referência é só pra quem não tinha nenhum.
    if (!pr.knownHead && guardada.knownHead) pr.knownHead = guardada.knownHead;
  }
```

Conferir que nada mais usa o nome antigo:
Rodar: `git grep -n "retomadaPendente\|consumirRetomadaPendente" -- lib server.js test`
Esperado: nenhuma linha.

- [ ] **Passo 4: rodar e ver passar**

Rodar: `node --test test/retomada-duravel.test.js test/inflight-session-id.test.js test/retry-net.test.js test/rereview.test.js test/retomada-apos-falha.test.js test/sync-review.test.js`
Esperado: PASS em todos (o `rereview.test.js` cobre o G7 com inflight legado sem `estado`, que continua em andamento).

Rodar: `npm run check && npm run lint && npm run lint:update`
Esperado: verde; o `lint:update` baixa `emptyCatch` do `server.js` de 2 para 1 em `tools/quality/baseline.json`.

- [ ] **Passo 5: contraprova**

Mutação: em `server.js`, `recoverInflight`, trocar `this.writeInflight();` (logo abaixo de `retomadaMod.restaurarRetomadas(this, inflight);`) por `writeJsonAtomic(INFLIGHT_FILE, []);`.
Rodar: `node --test test/retomada-duravel.test.js`
Esperado: FAIL em `dois reinícios antes da retomada não perdem a referência` (`linha(PR.key)` indefinida e `c.retomadas.get(PR.key)` ausente). Restaurar: PASS.

Segunda mutação: em `enqueueHeadless`, logo abaixo de `const guardada = retomadaMod.lerRetomada(engine, pr.key);`, inserir `retomadaMod.consumirRetomada(engine, pr.key);`.
Esperado: FAIL em `referência preservada enquanto espera vaga na fila, inclusive depois de reiniciar` (`enfileirar não consome`). Remover a linha: PASS.

- [ ] **Passo 6: commit**

```
git add server.js lib/engine/review.js test/retomada-duravel.test.js test/inflight-session-id.test.js test/retry-net.test.js tools/quality/baseline.json
git commit -m "feat(retomada): inflight.json guarda a referencia em pendente, fila e execucao e sobrevive a reinicios"
```

---

## Tarefa 3: a referência nasce com head e contexto, e os desfechos definitivos a consomem

Fecha o gap (3) da seção 4.5 (retry só em memória) e grava o contexto local que a validação exige.

**Arquivos:**
- Modificar: `lib/engine/review.js`: `prComRetomada` (356-366), `runOneHeadless` (589-596, 667-675, 686-700, 712-716), `registrarSessionId` (1103-1110), `runHeadlessReview` (1113-1118)
- Modificar: `test/retomada-duravel.test.js` (acrescentar)

**Interfaces:**
- O registro ativo (`activeReviews.get(id)`) ganha `provedor`, `perfilId` e `resumeOutcome: 'nenhuma'` desde a criação.
- O objeto do PR ganha `contextoLido: { provedor, perfilId }` (mesmo espírito do `headLido`: campo próprio, nunca sobrescreve `knownHead`).
- `registrarSessionId(engine, id, sid)` grava a referência com head e contexto da sessão.
- `prComRetomada(engine, pr, err, guardado)`: o `engine` passa a ser o primeiro argumento.

- [ ] **Passo 1: escrever os testes que falham**

Acrescentar ao fim de `test/retomada-duravel.test.js`:

```js
/* ---------- Tarefa 3: a referência nasce durável e os desfechos a consomem ---------- */

test('o sid da sessão nova vai pro disco com head e contexto enquanto ela roda', async () => {
  const e = motor();
  let visto = null;
  e.runClaudeStream = async (prompt, opts) => {
    opts.onSession('sessao-viva-0001');
    visto = linha(PR.key);
    return RESPOSTA();
  };
  await e.runHeadlessReview({ ...PR });
  assert.ok(visto, 'linha gravada durante a sessão');
  assert.equal(visto.estado, 'execucao');
  assert.equal(visto.retomarSid, 'sessao-viva-0001');
  assert.equal(visto.sessionId, 'sessao-viva-0001');
  assert.equal(visto.knownHead, HEAD);
  assert.equal(visto.provedor, 'dir');
  assert.equal(visto.perfilId, '');
});

test('queda transitória: a referência vai pro disco com head e contexto e sobrevive ao reinício', async () => {
  const e = motor();
  e.prState = async () => 'OPEN';
  e.runClaudeStream = async () => { throw Object.assign(new Error('fetch failed'), { sessionId: SID }); };
  await e.runOneHeadless({ ...PR }, 'trabalho');
  assert.ok(e.retryAfterNet.has(PR.key), 'falha de rede vira retry');
  const item = linha(PR.key);
  assert.equal(item.estado, 'pendente');
  assert.equal(item.retomarSid, SID);
  assert.equal(item.knownHead, HEAD);
  assert.equal(item.provedor, 'dir');
  assert.equal(item.perfilId, '');
  const b = new Engine();
  assert.equal(b.retomadas.get(PR.key).retomarSid, SID, 'o retry deixou de ser só memória');
});

test('orçamento estourado na boca da sessão: estaciona sem abrir sessão e sem consumir a retomada', async () => {
  const e = motor();
  semear(e);
  e.prState = async () => 'OPEN';
  e.budgetBlockedFor = () => ({ id: 'p1', label: 'Perfil 1' });
  await e.runOneHeadless({ ...PR }, 'trabalho');
  assert.equal(e.chamadas.length, 0);
  assert.equal(e.autoReviewParked.has(PR.key), true);
  assert.equal(e.retomadas.get(PR.key).retomarSid, SID);
  assert.equal(linha(PR.key).estado, 'pendente');
});

test('PR já mergeado na boca da sessão: a referência é consumida', async () => {
  const e = motor();
  semear(e);
  e.prState = async () => 'MERGED';
  await e.runOneHeadless({ ...PR }, 'trabalho');
  assert.equal(e.chamadas.length, 0);
  assert.equal(e.retomadas.has(PR.key), false);
});

test('cancelada por você: a referência sai junto', async () => {
  const e = motor();
  semear(e);
  e.prState = async () => 'OPEN';
  e.runHeadlessReview = async () => { throw Object.assign(new Error('cancelada por você'), { cancelled: true, sessionId: SID }); };
  await e.runOneHeadless({ ...PR }, 'trabalho');
  assert.equal(e.retomadas.has(PR.key), false);
});

test('falha permanente: a referência sai junto', async () => {
  const e = motor();
  semear(e);
  e.prState = async () => 'OPEN';
  e.runHeadlessReview = async () => { throw Object.assign(new Error('JSON da sessão fora do contrato'), { sessionId: SID }); };
  await e.runOneHeadless({ ...PR }, 'trabalho');
  assert.equal(e.autoReviewParked.has(PR.key), true);
  assert.equal(e.retomadas.has(PR.key), false);
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `node --test test/retomada-duravel.test.js`
Esperado: FAIL em `o sid da sessão nova vai pro disco...` (`visto.retomarSid` é `''`), `queda transitória...` (sem linha no disco), `PR já mergeado...`, `cancelada por você...` e `falha permanente...` (referência não consumida). O teste de orçamento já passa (trava de regressão, validada pela contraprova).

- [ ] **Passo 3: implementar**

`lib/engine/review.js`, substituir o comentário e a função `prComRetomada` inteiros (356-366) por:

```js
// PR que vai pra entrada do retryAfterNet, carregando o sid da sessão que acabou de
// cair (session.js estampa err.sessionId). Sem sid novo (a queda foi antes de a sessão
// nascer), mantém o da tentativa anterior: a leitura já feita não se joga fora.
// O `knownHead` da entrada é o head que a sessão morta DE FATO leu (pr.headLido,
// estampado pelo runHeadlessReview). Com sid novo, a referência durável é gravada
// junto, com o head e o contexto local (pr.contextoLido) daquela sessão: o
// retryAfterNet é memória e um reinício durante a espera a perderia (CT-RET).
function prComRetomada(engine, pr, err, guardado) {
  const anterior = (guardado && guardado.pr && guardado.pr.retomarSid) || '';
  if (err.sessionId) {
    const ctx = pr.contextoLido || {};
    retomadaMod.guardarRetomada(engine, pr, {
      retomarSid: err.sessionId, knownHead: pr.headLido || '', provedor: ctx.provedor, perfilId: ctx.perfilId,
      sessionId: err.sessionId, headSha: pr.headLido || '',
    });
  }
  return { ...pr, retomarSid: err.sessionId || anterior, knownHead: pr.headLido || pr.knownHead || '' };
}
```

`lib/engine/review.js`, `runOneHeadless`, bloco `if (jaMergeado) {` (589): logo abaixo da linha `engine.emit('toast', { kind: 'info', text: `${pr.key} já foi mergeado; cancelei a revisão antes de começar.` });` inserir:

```js
    // PR mergeado não volta: a referência de retomada dele é desfecho, não espera
    retomadaMod.consumirRetomada(engine, pr.key);
```

`lib/engine/review.js`, `runOneHeadless`, ramo `} else if (err.cancelled) {` (667): logo abaixo de `estacionar(engine, pr.key, 'cancelada por você', 'cancelado', pr.headLido);` inserir:

```js
      // cancelar é desfecho: um clique posterior começa sessão nova, nunca retoma a cancelada
      retomadaMod.consumirRetomada(engine, pr.key);
```

`lib/engine/review.js`, `runOneHeadless`, ramo transitório (695): trocar

```js
        const prRetomada = prComRetomada(pr, err, guardado);
```

por

```js
        const prRetomada = prComRetomada(engine, pr, err, guardado);
```

`lib/engine/review.js`, `runOneHeadless`, ramo final de falha não transitória (715): logo abaixo de `estacionar(engine, pr.key, msg, 'falha', pr.headLido);` inserir:

```js
      // falha permanente é desfecho: retomar a sessão que falhou repetiria a falha
      retomadaMod.consumirRetomada(engine, pr.key);
```

`lib/engine/review.js`, substituir `registrarSessionId` inteiro (1103-1110, com o comentário) por:

```js
// sid persiste assim que nasce (não só no fim da revisão): o onSession dispara
// uma vez, no primeiro evento que traz session_id. A referência durável nasce aqui
// com o head e o contexto local desta sessão (CT-RET), e o inflight.json é regravado
// na hora, pra sobreviver a queda do app no meio.
function registrarSessionId(engine, id, sid) {
  const s = engine.activeReviews.get(id);
  if (!s) return;
  s.sessionId = sid;
  if (s.pr) {
    retomadaMod.guardarRetomada(engine, s.pr, {
      retomarSid: sid, knownHead: s.headSha || '', provedor: s.provedor || '', perfilId: s.perfilId || '',
      sessionId: sid, headSha: s.headSha || '',
    });
  }
  engine.writeInflight();
}
```

`lib/engine/review.js`, `runHeadlessReview`, substituir o `engine.activeReviews.set(...)` (1113-1118) por:

```js
  engine.activeReviews.set(id, {
    id, keys: [pr.key], label: `Revisão automática de ${pr.key}`, mode: 'auto', checkpoint: 'review',
    startedAt: Date.now(), cancellable: true, resumeOutcome: 'nenhuma',
    pr: { key: pr.key, url: pr.url, title: pr.title || '', author: pr.author || '' }
  });
  // contexto local de provedor e perfil desta sessão (CT-RET): gravado com a referência
  // de retomada (registrarSessionId, prComRetomada) e comparado antes de reutilizá-la
  const contextoLocal = retomadaMod.contextoDaConta(engine, pr);
  Object.assign(engine.activeReviews.get(id), contextoLocal);
  pr.contextoLido = contextoLocal;
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `node --test test/retomada-duravel.test.js test/retry-net.test.js test/retomada-apos-falha.test.js test/sync-review.test.js test/inflight-session-id.test.js`
Esperado: PASS em todos.

Rodar: `npm run check && npm run lint`
Esperado: verde.

- [ ] **Passo 5: contraprova**

Mutação: no bloco `if (perfilEstourado) {` de `runOneHeadless` (~604), logo abaixo de `estacionar(engine, pr.key, \`perfil "${perfilEstourado.label}"\`, 'orcamento', pr.headLido);`, inserir `retomadaMod.consumirRetomada(engine, pr.key);`.
Rodar: `node --test test/retomada-duravel.test.js`
Esperado: FAIL em `orçamento estourado na boca da sessão...` (`e.retomadas.get(PR.key)` indefinido). Remover a linha: PASS.

Segunda mutação: em `registrarSessionId`, trocar `provedor: s.provedor || ''` por `provedor: ''`.
Esperado: FAIL em `o sid da sessão nova vai pro disco...` (`visto.provedor` recebe `''`). Restaurar: PASS.

- [ ] **Passo 6: commit**

```
git add lib/engine/review.js test/retomada-duravel.test.js
git commit -m "feat(retomada): referencia nasce com head e contexto e so desfecho definitivo a consome"
```

---

## Tarefa 4: validar antes de reutilizar

Implementa a validação de CT-RET: PR, head confirmado, contexto local, operação equivalente concluída. Head não confirmado espera sem abrir sessão; descarte segue em sessão nova sem o bloco "não releia".

**Arquivos:**
- Modificar: `lib/engine/review.js`: import (linha adicionada na Tarefa 2), `RESUME_SID_RE` (1888-1891, remover), `tratarBloqueioDeCoordenacao` (113-121), `runOneHeadless` catch (646-648), `sidDeRetomada` (1066-1090), `anunciaRetomada` (1092-1100), `runHeadlessReview` (1126-1160, 1187, 1250-1254, 1289)
- Modificar: `test/retomada-apos-falha.test.js`
- Modificar: `test/sync-review.test.js` (469, 520)
- Modificar: `test/retomada-duravel.test.js` (acrescentar)

**Interfaces:**
- `sidDeRetomada(engine, pr, validacao, entrada)`: `{ sid, aposFalha, motivo, semRetomada }`, com `semRetomada` em `'nova' | 'nenhuma'` (consumido na Tarefa 5).
- `anunciaRetomada(engine, id, retomada)`: frase da esteira pro descarte (via `AVISO_DESCARTE`) ou pra retomada; devolve o bloco de retomada ou `''`.
- `erroAguardaRetomada(key)`: `Error` com `aguardaRetomada: true`.
- `aguardarConfirmacaoDeHead(engine, pr, msg)`: põe o PR no `retryAfterNet` sem gastar tentativa.

- [ ] **Passo 1: escrever os testes que falham**

Acrescentar ao fim de `test/retomada-duravel.test.js`:

```js
/* ---------- Tarefa 4: validação antes de reutilizar ---------- */

function coordenado(e, admissao) {
  e.syncCoordenacaoAtiva = () => true;
  e.syncAdmit = async () => admissao;
  e.syncRegistrarEspera = () => { };
  delete e.runClaudeStream; // volta pra fachada real: admissão antes de qualquer provedor
}

test('retomada local válida depois de reiniciar: --resume com o bloco, e a referência é consumida pelo resultado', async () => {
  const a = motor();
  semear(a);
  a.writeInflight();
  const e = motor(); // reinício
  e.processHeadless = () => { };
  e.pushState = () => { };
  e.enqueueHeadless({ ...PR });
  const pr = e.headlessQueue.shift();
  await e.runHeadlessReview(pr);
  assert.equal(e.chamadas.length, 1);
  const args = e.chamadas[0].extraArgs;
  assert.equal(args[args.indexOf('--resume') + 1], SID);
  assert.ok(e.chamadas[0].prompt.includes(retomadaAposFalhaBlock()));
  assert.equal(e.retomadas.has(PR.key), false, 'sessão que devolveu resultado consome');
  assert.equal(lerInflight().some(i => i.key === PR.key), false);
});

test('HEAD alterado: sessão nova sem --resume e sem bloco, sem confirmação humana, referência consumida', async () => {
  const e = motor();
  semear(e, { knownHead: 'aaaaaaaaaaaa' });
  await e.runHeadlessReview({ ...PR, knownHead: 'aaaaaaaaaaaa' });
  assert.equal(e.chamadas.length, 1, 'a revisão segue sozinha pelas regras normais');
  assert.equal(e.chamadas[0].extraArgs.includes('--resume'), false);
  assert.equal(e.chamadas[0].prompt.includes(retomadaAposFalhaBlock()), false, 'nenhuma prova herdada');
  assert.equal(e.chamadas[0].guardada, false, 'descartada antes de a sessão abrir');
  assert.equal(e.decididos.length, 1);
  assert.equal(e.autoReviewParked.has(PR.key), false);
});

for (const [nome, headSha] of [['vazio', async () => ''], ['exceção', async () => { throw new Error('gh fora do ar'); }]]) {
  test(`HEAD não confirmado (${nome}): o head salvo não vale como prova, nenhuma sessão abre e a referência espera`, async () => {
    const e = motor();
    semear(e);
    e.headSha = headSha;
    e.prState = async () => 'OPEN';
    await e.runOneHeadless({ ...PR, knownHead: HEAD }, 'trabalho');
    assert.equal(e.chamadas.length, 0, 'sem confirmação não injeta o bloco nem abre sessão');
    assert.equal(e.retomadas.get(PR.key).retomarSid, SID);
    const espera = e.retryAfterNet.get(PR.key);
    assert.ok(espera, 'revalida no próximo ciclo que funcionar');
    assert.equal(espera.tries, 0, 'aguardar confirmação não gasta tentativa');
    assert.equal(e.autoReviewParked.has(PR.key), false);
    assert.equal(linha(PR.key).estado, 'pendente');
  });
}

test('perfil diferente do que originou a sessão: não retoma, sessão nova sem bloco', async () => {
  const e = motor();
  e.config = { ...e.config, claudeProfiles: [{ id: 'p2', label: 'P2', kind: 'dir', dir: path.join(HOME, 'cfg-p2') }], claudeProfileId: 'p2' };
  semear(e); // originada no perfil legado ('')
  await e.runHeadlessReview({ ...PR });
  assert.equal(e.chamadas.length, 1);
  assert.equal(e.chamadas[0].extraArgs.includes('--resume'), false);
  assert.equal(e.chamadas[0].prompt.includes(retomadaAposFalhaBlock()), false);
  assert.equal(e.chamadas[0].guardada, false);
});

test('provedor diferente do que originou a sessão: não retoma', async () => {
  const e = motor();
  semear(e, { provedor: 'apikey', perfilId: '' });
  await e.runHeadlessReview({ ...PR });
  assert.equal(e.chamadas[0].extraArgs.includes('--resume'), false);
  assert.equal(e.chamadas[0].guardada, false);
});

test('contexto local ausente (inflight legado sem provedor): não retoma', async () => {
  fs.writeFileSync(INFLIGHT, JSON.stringify([{ key: PR.key, url: PR.url, title: PR.title, sessionId: SID, headSha: HEAD }]));
  const e = motor();
  assert.equal(e.retomadas.get(PR.key).provedor, '');
  await e.runHeadlessReview({ ...PR });
  assert.equal(e.chamadas[0].extraArgs.includes('--resume'), false);
  assert.equal(e.chamadas[0].prompt.includes(retomadaAposFalhaBlock()), false);
});

test('revisão equivalente já concluída depois da queda: não retoma', async () => {
  const e = motor();
  semear(e);
  e.retomadas.get(PR.key).atualizadoEm = new Date(Date.now() - 60000).toISOString();
  e.decisions.resolved.unshift({ key: PR.key, headSha: HEAD, createdAt: Date.now(), status: 'already_reviewed' });
  await e.runHeadlessReview({ ...PR });
  assert.equal(e.chamadas[0].extraArgs.includes('--resume'), false);
  assert.equal(e.chamadas[0].guardada, false);
});

test('recibo de outro aparelho na admissão: consome a referência sem abrir sessão', async () => {
  const e = motor();
  semear(e);
  coordenado(e, { admitted: false, reason: 'recibo', detail: { deviceName: 'notebook' } });
  await e.runHeadlessReview({ ...PR });
  assert.equal(spawnsDoCli, 0);
  assert.equal(e.decididos.length, 0);
  assert.equal(e.retomadas.has(PR.key), false);
});

for (const reason of ['alheio', 'indisponivel']) {
  test(`recusa da coordenação (${reason}) antes do provedor: sem sessão e sem consumir a retomada`, async () => {
    const e = motor();
    semear(e);
    coordenado(e, { admitted: false, reason, detail: { deviceName: 'notebook' } });
    await e.runHeadlessReview({ ...PR });
    assert.equal(spawnsDoCli, 0, 'nenhum spawn do CLI');
    assert.equal(e.decididos.length, 0);
    assert.equal(e.retomadas.get(PR.key).retomarSid, SID);
    assert.equal(linha(PR.key).estado, 'pendente', 'espera de lease sobrevive a reinício');
    const b = new Engine();
    assert.equal(b.retomadas.get(PR.key).retomarSid, SID);
  });
}
```

Modificar `test/retomada-apos-falha.test.js`:

1. Abaixo de `const { retomadaAposFalhaBlock } = await import('../lib/engine/review.js');` (linha 17), acrescentar:

```js
const retomada = await import('../lib/engine/retomada-duravel.js');
```

2. Abaixo da função `engineCom` (depois do `}` que a fecha, linha ~58), acrescentar:

```js
// A referência de retomada mora no Map durável (lib/engine/retomada-duravel.js): o
// pr.retomarSid sozinho não retoma mais. Contexto 'dir' sem perfil é o que a Engine
// deste teste resolve (config sem claudeProfiles).
function semear(e, sid, knownHead = HEAD) {
  retomada.guardarRetomada(e, PR_BASE, { retomarSid: sid, knownHead, provedor: 'dir', perfilId: '' });
}
```

3. Nos testes abaixo, inserir a linha indicada logo depois de `const e = engineCom(...)`:
   - `retomarSid válido entra como --resume mesmo com reReviewResume desligado`: `semear(e, 'abc-12345');`
   - `retomada por falha injeta o bloco de continuidade no prompt e avisa na atividade`: `semear(e, 'abc-12345');`
   - `retomarSid tem precedência sobre o resumeSid do round incremental`: `semear(e, 'abc-12345');`
   - `head diferente do knownHead da queda derruba a retomada`: `semear(e, 'abc-12345', 'aaaaaaaaaaaa');`
   - `head igual ao knownHead da queda retoma normalmente`: `semear(e, 'abc-12345');`
   - `resume recusado pelo CLI: a sessão nova roda sem o bloco e sem --resume`: `semear(e, 'abc-12345');`

4. Substituir o teste `head desconhecido de um dos lados mantém a retomada` inteiro por:

```js
test('sem head salvo a retomada é descartada e a revisão lê do zero', async () => {
  const e = engineCom({ reReviewResume: false });
  semear(e, 'abc-12345', '');
  await e.runHeadlessReview({ ...PR_BASE, retomarSid: 'abc-12345' });
  assert.equal(e.chamadas[0].extraArgs.includes('--resume'), false, 'sem prova de qual commit a sessão leu, não retoma');
  assert.equal(e.chamadas[0].prompt.includes(retomadaAposFalhaBlock()), false);
});

test('head atual não confirmado: nenhuma sessão abre e a referência espera', async () => {
  const e = engineCom({ reReviewResume: false });
  semear(e, 'abc-12345', 'aaaaaaaaaaaa');
  e.headSha = async () => '';
  await assert.rejects(
    e.runHeadlessReview({ ...PR_BASE, retomarSid: 'abc-12345', knownHead: 'aaaaaaaaaaaa' }),
    (err) => err.aguardaRetomada === true
  );
  assert.equal(e.chamadas.length, 0, 'o head salvo não vale como confirmação do estado atual');
  assert.equal(e.retomadas.has(PR_BASE.key), true);
});
```

Modificar `test/sync-review.test.js`:

1. Abaixo de `const io = (await import('../lib/io.js')).default;` (linha 29), acrescentar:

```js
const retomada = await import('../lib/engine/retomada-duravel.js');
```

2. No teste `retomada recusada que recomeça do zero não reserva outra rodada`, logo depois de `const pr = prDe('o/r#20', { rodadaAutomatica: true, retomarSid: 'sessao-anterior-1', knownHead: HEAD });`, inserir:

```js
  // a referência mora no Map durável; contexto 'dir' sem perfil é o desta Engine
  retomada.guardarRetomada(e, pr, { retomarSid: 'sessao-anterior-1', knownHead: HEAD, provedor: 'dir', perfilId: '' });
```

3. No laço `retomada recusada e segunda admissão alheia (${kind})`, trocar

```js
    await e.runHeadlessReview(prDe('o/r#23', { retomarSid: 'sessao-anterior-2', knownHead: HEAD }));
```

por

```js
    const pr = prDe('o/r#23', { retomarSid: 'sessao-anterior-2', knownHead: HEAD });
    retomada.guardarRetomada(e, pr, { retomarSid: 'sessao-anterior-2', knownHead: HEAD, provedor: 'dir', perfilId: '' });
    await e.runHeadlessReview(pr);
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `node --test test/retomada-duravel.test.js test/retomada-apos-falha.test.js`
Esperado: FAIL em `retomada local válida depois de reiniciar...` (referência não consumida), `HEAD alterado...` (`guardada` true), nos dois `HEAD não confirmado` (a sessão abre com `--resume` sobre o `knownHead`), `perfil diferente...`, `provedor diferente...`, `contexto local ausente...`, `revisão equivalente já concluída...` (todos retomam), `recibo de outro aparelho...` (não consome), e em `head atual não confirmado...` do `retomada-apos-falha`. Os dois de recusa da coordenação já passam (trava de regressão).

- [ ] **Passo 3: implementar**

`lib/engine/review.js`, trocar o import da Tarefa 2

```js
import retomadaMod from './retomada-duravel.js';
```

por

```js
import retomadaMod, { RESUME_SID_RE, AVISO_DESCARTE } from './retomada-duravel.js';
```

e remover o comentário e a constante local (1888-1891):

```js
// formato de session id do CLI que pode entrar numa linha de shell: a MESMA
// allowlist do --resume do chat (chat.js); sid fora do formato degrada pra
// sessão nova em silêncio, nunca entra na linha.
const RESUME_SID_RE = /^[0-9a-zA-Z-]{8,64}$/;
```

Conferir: `git grep -n "RESUME_SID_RE" -- lib/engine/review.js` deve listar só o import e os usos em `sidDeRetomada`.

`lib/engine/review.js`, `tratarBloqueioDeCoordenacao` (113-121), substituir por:

```js
function tratarBloqueioDeCoordenacao(engine, pr, admissao) {
  const adm = admissao || {};
  if (adm.reason !== 'recibo') {
    engine.unsee(pr.key);
    if (!engine.queue.some(p => p.key === pr.key)) engine.queue.push(pr);
    engine.syncRegistrarEspera(pr.key, adm);
  }
  // recibo é desfecho (este commit terminou em outro aparelho): a referência de
  // retomada sai. Lease alheio e coordenação fora são espera, e ela fica (CT-RET).
  if (adm.reason === 'recibo') retomadaMod.consumirRetomada(engine, pr.key);
  avisarBloqueioUmaVez(engine, pr.key, textoBloqueio(pr.key, adm));
}
```

`lib/engine/review.js`, logo acima de `async function runOneHeadless(engine, pr, acct) {`, acrescentar:

```js
// Retomada que não pode ser validada porque o head atual não foi confirmado no GitHub:
// espera, sem gastar tentativa e sem abrir sessão. O retryAfterNet é o gatilho certo,
// porque o _repescarRetry só roda quando a checagem do ciclo funcionou. A referência
// fica no Map (e no disco) em estado pendente.
function aguardarConfirmacaoDeHead(engine, pr, msg) {
  const guardado = engine.retryAfterNet.get(pr.key);
  engine.retryAfterNet.set(pr.key, { tries: (guardado && guardado.tries) || 0, pr, notBefore: null });
  engine.log('WARN', `revisao ${pr.key} (retomada aguardando confirmação do head): ${msg}`);
}
```

`lib/engine/review.js`, `runOneHeadless`, no catch (648), trocar

```js
    if (err.coordenacao) {
```

por

```js
    if (err.aguardaRetomada) {
      aguardarConfirmacaoDeHead(engine, pr, msg);
    } else if (err.coordenacao) {
```

`lib/engine/review.js`, substituir o comentário e as funções `sidDeRetomada` e `anunciaRetomada` inteiros (1066-1100, do `// Escolha do sid de retomada, um lugar só.` até o `}` que fecha `anunciaRetomada`) por:

```js
// Escolha do sid de retomada, um lugar só. Duas origens, políticas diferentes:
// `retomarSid` (queda transitória ou recuperação do boot) NÃO é opt-in e mora na
// referência durável; ele só vale quando validarRetomada (lib/engine/retomada-duravel.js)
// comprovou PR, head confirmado e contexto local. `resumeSid` (round incremental da
// re-revisão) segue atrás de config.reReviewResume, sem mudança. Referência descartada
// não cai no resumeSid: a revisão lê do zero, como antes quando o head mudava.
// Formato sempre pela allowlist: sid fora dela nunca entra numa linha de shell.
function sidDeRetomada(engine, pr, validacao, entrada) {
  if (validacao.acao === 'retomar') {
    return { sid: String(entrada.retomarSid), aposFalha: true, motivo: validacao.motivo, semRetomada: 'nenhuma' };
  }
  if (validacao.acao === 'descartar') return { sid: '', aposFalha: false, motivo: validacao.motivo, semRetomada: 'nova' };
  const optIn = (engine.config || {}).reReviewResume && !!pr.resumeSid && RESUME_SID_RE.test(String(pr.resumeSid));
  return { sid: optIn ? String(pr.resumeSid) : '', aposFalha: false, motivo: validacao.motivo, semRetomada: 'nenhuma' };
}

// bloco de prompt + linha de atividade da retomada, num par só: quem retoma (ou
// deixa de retomar) sem dizer por quê deixa a esteira parecendo revisão pela metade.
// Devolve '' quando não é retomada por falha (descarte, round incremental ou sessão nova).
function anunciaRetomada(engine, id, retomada) {
  const aviso = AVISO_DESCARTE[retomada.motivo];
  if (retomada.semRetomada === 'nova' && aviso) {
    engine.pushActivity(id, 'info', aviso);
    return '';
  }
  if (!retomada.aposFalha) return '';
  engine.pushActivity(id, 'info', 'Retomando a sessão interrompida por instabilidade (sem reler o que já foi lido).');
  return retomadaAposFalhaBlock();
}

// espera de confirmação do head, levantada de dentro do try do runHeadlessReview
// pra o finally limpar o registro ativo; o runOneHeadless a trata como espera
function erroAguardaRetomada(key) {
  return Object.assign(new Error(`${key}: head do PR não confirmado no GitHub; a retomada da sessão interrompida aguarda a próxima checagem`), { aguardaRetomada: true });
}
```

`lib/engine/review.js`, `runHeadlessReview`, trocar (1128-1130)

```js
  try {
    engine.activeReviews.get(id).headSha = await engine.headSha(pr);
  } catch { /* sem SHA do fetch: tenta o knownHead do enfileiramento abaixo */ }
```

por

```js
  // headConfirmado é SÓ o que o GitHub respondeu agora; o knownHead do enfileiramento
  // (G8) continua servindo de âncora da rodada, mas nunca de confirmação pra retomada
  let headConfirmado = '';
  try {
    headConfirmado = String((await engine.headSha(pr)) || '');
    engine.activeReviews.get(id).headSha = headConfirmado;
  } catch { /* sem SHA do fetch: tenta o knownHead do enfileiramento abaixo */ }
```

`lib/engine/review.js`, `runHeadlessReview`, trocar (1151)

```js
  if (!headShaAtual) {
```

por

```js
  // CT-RET: a referência de retomada é validada ANTES de qualquer label, card ou sessão.
  // Descarte comprovado sai do Map agora (a sessão nova registra a dela no onSession);
  // head não confirmado é espera, levantada no início do try abaixo.
  const entradaRetomada = retomadaMod.lerRetomada(engine, pr.key);
  const validacaoRetomada = retomadaMod.validarRetomada(entradaRetomada, {
    prKey: pr.key, headConfirmado, contexto: contextoLocal,
    concluida: retomadaMod.concluidaDepois(engine, entradaRetomada),
  });
  if (validacaoRetomada.acao === 'descartar') retomadaMod.consumirRetomada(engine, pr.key);
  if (!headShaAtual && validacaoRetomada.acao !== 'aguardar') {
```

`lib/engine/review.js`, `runHeadlessReview`, primeira linha do `try {` (1187), trocar

```js
    if (!coordenacaoLigada(engine)) labelEmAndamento = await addInProgressLabel(engine, pr);
```

por

```js
    if (validacaoRetomada.acao === 'aguardar') throw erroAguardaRetomada(pr.key);
    if (!coordenacaoLigada(engine)) labelEmAndamento = await addInProgressLabel(engine, pr);
```

`lib/engine/review.js`, `runHeadlessReview`, trocar (1250)

```js
    const retomada = sidDeRetomada(engine, pr, headShaAtual);
```

por

```js
    const retomada = sidDeRetomada(engine, pr, validacaoRetomada, entradaRetomada);
```

`lib/engine/review.js`, `runHeadlessReview`, trocar (1289)

```js
    const result = lerResultadoDaRevisao(engine, res);
```

por

```js
    const result = lerResultadoDaRevisao(engine, res);
    // a sessão devolveu resultado: a referência de retomada cumpriu o papel (CT-RET)
    retomadaMod.consumirRetomada(engine, pr.key);
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `node --test test/retomada-duravel.test.js test/retomada-apos-falha.test.js test/sync-review.test.js test/retry-net.test.js test/inflight-session-id.test.js test/jira-review-wiring.test.js test/checkpoint-retry-same-path.test.js`
Esperado: PASS em todos.

Rodar: `npm run check && npm run lint`
Esperado: verde. Se o gate apontar `profundidadeExcedida` a mais em `review.js`, o culpado é um bloco novo com chaves dentro de outro; troque por `if` de uma linha ou por função auxiliar, nunca suba a baseline.

- [ ] **Passo 5: contraprova**

Mutação: em `runHeadlessReview`, apagar a linha `    if (validacaoRetomada.acao === 'aguardar') throw erroAguardaRetomada(pr.key);`.
Rodar: `node --test test/retomada-duravel.test.js`
Esperado: FAIL nos dois `HEAD não confirmado (...)` (`e.chamadas.length` 1 em vez de 0). Restaurar: PASS.

Segunda mutação: em `lib/engine/retomada-duravel.js`, `validarRetomada`, trocar `texto(entrada.perfilId) !== texto(ctx.perfilId)` por `false`.
Esperado: FAIL em `perfil diferente do que originou a sessão...` (`--resume` presente). Restaurar: PASS.

Terceira mutação: em `tratarBloqueioDeCoordenacao`, apagar a linha `if (adm.reason === 'recibo') retomadaMod.consumirRetomada(engine, pr.key);`.
Esperado: FAIL em `recibo de outro aparelho na admissão...`. Restaurar: PASS.

- [ ] **Passo 6: commit**

```
git add lib/engine/review.js lib/engine/retomada-duravel.js test/retomada-duravel.test.js test/retomada-apos-falha.test.js test/sync-review.test.js
git commit -m "feat(retomada): valida PR, head confirmado e contexto local antes de retomar"
```

---

## Tarefa 5: desfecho da retomada distinguível (retomada, recusada, nova, nenhuma)

**Arquivos:**
- Modificar: `lib/engine/review.js`: `rodarSessao` (849-872, com o comentário acima), `streamOpts` em `runHeadlessReview` (1255-1280), chamada de `rodarSessao` (1283) e o `result` (logo abaixo da linha alterada na Tarefa 4)
- Modificar: `test/retomada-duravel.test.js` (acrescentar)

**Interfaces:**
- `rodarSessao(engine, promptFinal, streamOpts, sid, jaAnunciada = false, blocoRetomada = '', semRetomada = 'nenhuma')` devolve `res` com `res.resumeOutcome` em `DESFECHOS_RETOMADA`.
- Cada chamada ao `engine.runClaudeStream` recebe `opts.resumeOutcome` da tentativa.
- `engine.activeReviews.get(id).resumeOutcome` reflete a tentativa corrente e termina no desfecho efetivo.
- `streamOpts.onRetomadaRecusada()` é chamado quando o CLI recusa o `--resume`, antes da sessão nova.
- `result.resumeOutcome` chega ao `recordDecision`.

- [ ] **Passo 1: escrever os testes que falham**

Acrescentar ao fim de `test/retomada-duravel.test.js`:

```js
/* ---------- Tarefa 5: diagnóstico distingue retomada, recusa do CLI e sessão nova ---------- */

test('desfecho retomada: opts, registro ativo e resultado dizem retomada', async () => {
  const e = motor();
  semear(e);
  await e.runHeadlessReview({ ...PR });
  assert.equal(e.chamadas.length, 1);
  assert.equal(e.chamadas[0].opcao, 'retomada');
  assert.equal(e.chamadas[0].registro, 'retomada');
  assert.equal(e.decididos[0].resumeOutcome, 'retomada');
});

test('desfecho recusada: a referência sai antes da sessão nova, que nunca aparece como retomada', async () => {
  const e = motor();
  semear(e);
  let n = 0;
  const base = e.runClaudeStream;
  e.runClaudeStream = async (prompt, opts) => {
    n++;
    if (n === 1) {
      await base(prompt, opts);
      e.chamadas[0].falhou = true;
      throw new Error(`No conversation found with session id ${SID}`);
    }
    return base(prompt, opts);
  };
  await e.runHeadlessReview({ ...PR });
  assert.equal(e.chamadas.length, 2);
  assert.equal(e.chamadas[0].opcao, 'retomada');
  assert.equal(e.chamadas[1].opcao, 'recusada');
  assert.equal(e.chamadas[1].registro, 'recusada');
  assert.equal(e.chamadas[1].guardada, false, 'a referência recusada não sobrevive pra outra tentativa');
  assert.equal(e.chamadas[1].extraArgs.includes('--resume'), false);
  assert.equal(e.chamadas[1].prompt.includes(retomadaAposFalhaBlock()), false);
  assert.equal(e.decididos[0].resumeOutcome, 'recusada');
});

test('desfecho nova: referência descartada vira sessão nova, rotulada nova', async () => {
  const e = motor();
  semear(e, { knownHead: 'aaaaaaaaaaaa' });
  await e.runHeadlessReview({ ...PR });
  assert.equal(e.chamadas[0].opcao, 'nova');
  assert.equal(e.chamadas[0].registro, 'nova');
  assert.equal(e.decididos[0].resumeOutcome, 'nova');
});

test('desfecho nenhuma: sem referência, e também com o resumeSid incremental desligado', async () => {
  const e = motor();
  await e.runHeadlessReview({ ...PR, resumeSid: 'zzz-98765-xx' });
  assert.equal(e.chamadas[0].opcao, 'nenhuma');
  assert.equal(e.chamadas[0].registro, 'nenhuma');
  assert.equal(e.decididos[0].resumeOutcome, 'nenhuma');
});

test('admissão recusada na tentativa de retomada: o registro volta pra nenhuma, sem sessão', async () => {
  const e = motor();
  semear(e);
  let registroNoFim = null;
  e.syncCoordenacaoAtiva = () => true;
  e.syncRegistrarEspera = () => { };
  e.runClaudeStream = async (prompt, opts) => {
    e.chamadas.push({ opcao: opts.resumeOutcome, registro: (e.activeReviews.get(opts.id) || {}).resumeOutcome });
    return { blocked: true, coordination: { admitted: false, reason: 'alheio', detail: {} }, text: '', sessionId: null };
  };
  const tratar = e.syncRegistrarEspera;
  e.syncRegistrarEspera = (key, adm) => {
    registroNoFim = [...e.activeReviews.values()].find(s => (s.keys || []).includes(PR.key)).resumeOutcome;
    return tratar(key, adm);
  };
  await e.runHeadlessReview({ ...PR });
  assert.equal(e.chamadas[0].opcao, 'retomada', 'a tentativa foi de retomada');
  assert.equal(registroNoFim, 'nenhuma', 'nada abriu, então o desfecho efetivo é nenhuma');
  assert.equal(e.retomadas.get(PR.key).retomarSid, SID, 'e a referência fica');
});

test('rodarSessao em motor mínimo (sem activeReviews) não lança e devolve o desfecho', async () => {
  const review = await import('../lib/engine/review.js');
  const vistos = [];
  const motorMinimo = { pushActivity: () => { }, runClaudeStream: async (_p, opts) => { vistos.push(opts.resumeOutcome); return {}; } };
  const res = await review.rodarSessao(motorMinimo, 'prompt', { id: 1 }, null);
  assert.equal(res.resumeOutcome, 'nenhuma');
  const res2 = await review.rodarSessao(motorMinimo, 'prompt', { id: 1 }, null, false, '', 'nova');
  assert.equal(res2.resumeOutcome, 'nova');
  assert.deepEqual(vistos, ['nenhuma', 'nova']);
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `node --test test/retomada-duravel.test.js`
Esperado: FAIL nos seis testes novos (`opts.resumeOutcome` indefinido, `result.resumeOutcome` indefinido, `res.resumeOutcome` indefinido; em `desfecho recusada`, `guardada` true na segunda chamada).

- [ ] **Passo 3: implementar**

`lib/engine/review.js`, substituir o comentário e a função `rodarSessao` inteiros (849-872) por:

```js
// Marca o desfecho da tentativa no registro ativo (CT-RET): é o que o diagnóstico lê,
// e é o mesmo valor que viaja no opts até o registro de consumo. Motor sem
// activeReviews (teste mínimo) só não marca.
function marcarDesfecho(engine, id, desfecho) {
  const s = engine.activeReviews instanceof Map ? engine.activeReviews.get(id) : null;
  if (s) s.resumeOutcome = desfecho;
}

// Uma tentativa de sessão com o desfecho carimbado antes (pra quem registra consumo
// durante a sessão) e confirmado depois: admissão recusada não abriu nada, então o
// desfecho efetivo é nenhuma, mesmo que a tentativa fosse de retomada.
async function sessaoComDesfecho(engine, prompt, opts, desfecho) {
  marcarDesfecho(engine, opts.id, desfecho);
  const res = (await engine.runClaudeStream(prompt, { ...opts, resumeOutcome: desfecho })) || {};
  const efetivo = res.blocked ? 'nenhuma' : desfecho;
  marcarDesfecho(engine, opts.id, efetivo);
  return Object.assign(res, { resumeOutcome: efetivo });
}

// roda a sessão de revisão, retomando quando o chamador passou um sid válido (a
// retomada por queda validada, ou o round incremental opt-in): a mesma heurística de
// degradação do chat.js decide se o erro é do resume em si (sessão expirada/limpa
// recomeça do zero) ou falha real (sobe pro retry de sempre). Cancelamento sempre sobe.
// `semRetomada` é o desfecho da sessão sem sid: 'nova' quando uma referência foi
// descartada antes, 'nenhuma' quando não havia referência.
async function rodarSessao(engine, promptFinal, streamOpts, sid, jaAnunciada = false, blocoRetomada = '', semRetomada = 'nenhuma') {
  if (!sid) return sessaoComDesfecho(engine, promptFinal, streamOpts, semRetomada);
  // uma linha por evento: quando a retomada é por queda, quem já anunciou (com o
  // motivo) foi o anunciaRetomada, e repetir aqui duplicaria a mesma notícia na
  // esteira. Texto neutro porque este ponto não sabe qual é a origem do sid.
  if (!jaAnunciada) engine.pushActivity(streamOpts.id, 'info', 'Retomando a sessão anterior (continua a mesma conversa).');
  try {
    // SOMA, nunca substitui: o spread copia extraArgs e a atribuição jogaria fora
    // os argumentos do MCP montados pelo chamador, deixando a sessão retomada sem
    // ferramenta de Jira e sem erro nenhum aparecer.
    const argsRetomada = [...(streamOpts.extraArgs || []), '--resume', sid];
    return await sessaoComDesfecho(engine, promptFinal + blocoRetomada, { ...streamOpts, extraArgs: argsRetomada }, 'retomada');
  } catch (err) {
    if (err.cancelled || !/resume|no conversation|session id|session_id/i.test(err.message || '')) throw err;
    engine.pushActivity(streamOpts.id, 'info', 'Sessão anterior indisponível pra retomada; recomeçando do zero.');
    // a referência recusada sai ANTES da sessão nova: se esta cair antes de nascer, a
    // próxima tentativa não insiste num sid que o CLI já recusou
    if (typeof streamOpts.onRetomadaRecusada === 'function') streamOpts.onRetomadaRecusada();
    // sessão NOVA: o bloco de retomada fica de fora. Ele manda não reler o que já
    // foi lido, e numa sessão que nasce agora isso seria instrução pra pular
    // leitura que ninguém fez.
    return sessaoComDesfecho(engine, promptFinal, semNovaRodada(streamOpts), 'recusada');
  }
}
```

`lib/engine/review.js`, `runHeadlessReview`, no objeto `streamOpts`, logo abaixo de `onSession: (sid2) => registrarSessionId(engine, id, sid2),` (1271), acrescentar:

```js
      // CLI recusou o --resume: a referência vira desfecho antes da sessão nova
      onRetomadaRecusada: () => retomadaMod.consumirRetomada(engine, pr.key),
```

`lib/engine/review.js`, `runHeadlessReview`, trocar (1283)

```js
    const res = await rodarSessao(engine, promptFinal, streamOpts, retomada.sid, retomada.aposFalha, blocoRetomada);
```

por

```js
    const res = await rodarSessao(engine, promptFinal, streamOpts, retomada.sid, retomada.aposFalha, blocoRetomada, retomada.semRetomada);
```

`lib/engine/review.js`, `runHeadlessReview`, trocar o trecho gravado na Tarefa 4

```js
    const result = lerResultadoDaRevisao(engine, res);
    // a sessão devolveu resultado: a referência de retomada cumpriu o papel (CT-RET)
    retomadaMod.consumirRetomada(engine, pr.key);
```

por

```js
    const result = lerResultadoDaRevisao(engine, res);
    // a sessão devolveu resultado: a referência de retomada cumpriu o papel (CT-RET)
    retomadaMod.consumirRetomada(engine, pr.key);
    // desfecho da retomada viaja no resultado até o recordDecision; quem persiste é a A1
    result.resumeOutcome = res.resumeOutcome || 'nenhuma';
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `node --test test/retomada-duravel.test.js test/jira-review-wiring.test.js test/retomada-apos-falha.test.js test/sync-review.test.js test/session-checkpoint-capture.test.js`
Esperado: PASS em todos (o `jira-review-wiring` confirma que o `--resume` continua somando aos argumentos do MCP).

Rodar: `npm run check && npm run lint`
Esperado: verde.

- [ ] **Passo 5: contraprova**

Mutação: no catch de `rodarSessao`, trocar `return sessaoComDesfecho(engine, promptFinal, semNovaRodada(streamOpts), 'recusada');` por `return sessaoComDesfecho(engine, promptFinal, semNovaRodada(streamOpts), 'retomada');`.
Rodar: `node --test test/retomada-duravel.test.js`
Esperado: FAIL em `desfecho recusada...` (`e.chamadas[1].opcao` recebe `retomada`: sessão nova aparecendo como retomada). Restaurar: PASS.

Segunda mutação: em `sessaoComDesfecho`, trocar `const efetivo = res.blocked ? 'nenhuma' : desfecho;` por `const efetivo = desfecho;`.
Esperado: FAIL em `admissão recusada na tentativa de retomada...` (`registroNoFim` recebe `retomada`). Restaurar: PASS.

Terceira mutação: em `rodarSessao`, apagar a linha `if (typeof streamOpts.onRetomadaRecusada === 'function') streamOpts.onRetomadaRecusada();`.
Esperado: FAIL em `desfecho recusada...` (`guardada` true na segunda chamada). Restaurar: PASS.

- [ ] **Passo 6: commit**

```
git add lib/engine/review.js test/retomada-duravel.test.js
git commit -m "feat(retomada): desfecho retomada, recusada, nova ou nenhuma no registro ativo, no opts e no resultado"
```

---

## Tarefa 6: documentação, gate completo e evidência

**Arquivos:**
- Modificar: `CLAUDE.md`, seção `### Retomada após falha transitória (v2.57.3)`
- Criar ou acrescentar: `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md`

- [ ] **Passo 1: atualizar o `CLAUDE.md`**

No fim da seção `### Retomada após falha transitória (v2.57.3)` (logo antes de `## Diagnóstico: ambiente x operação x runtime`), acrescentar:

```markdown
### Retomada durável (A5 da operação multidispositivo)

Contrato: CT-RET da spec `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md`.

- **Uma fonte só:** `engine.retomadas` (`lib/engine/retomada-duravel.js`), key do PR para `{ key, url, title, author, kind: 'auto', estado, retomarSid, knownHead, provedor, perfilId, sessionId, headSha, atualizadoEm }`. O `inflight.json` é o espelho (`montarInflight`): execução vence fila, fila vence pendente, e a referência que não está em nenhuma das duas sai como `pendente`. O `retomadaPendente` em memória e o `inflight.json` esvaziado no boot deixaram de existir: o boot restaura e **regrava**, então dois reinícios seguidos não perdem a referência.
- **Só desfecho consome:** resultado da sessão, `--resume` recusado pelo CLI, descarte comprovado, recibo de outro aparelho, cancelamento, falha permanente, PR mergeado ou fechado. Enfileirar, esperar vaga, lease alheio, coordenação fora, orçamento e head não confirmado **mantêm**.
- **Validar antes de reutilizar** (`validarRetomada`): mesmo PR, contexto local igual (`provedor` = kind do auth resolvido, `perfilId`), nenhuma decisão do mesmo head criada depois da referência, head salvo presente, head atual **confirmado pelo GitHub** e igual. O head salvo e o `knownHead` do G8 são evidência da tentativa anterior, nunca confirmação: sem head confirmado a revisão espera no `retryAfterNet` sem gastar tentativa e sem abrir sessão. Descarte segue em sessão nova sem o bloco "não releia" e sem confirmação humana. Inflight legado da v2.57.3 não tem contexto e por isso não retoma.
- **Diagnóstico:** `resumeOutcome` em `'retomada' | 'recusada' | 'nova' | 'nenhuma'` no registro ativo, no `opts` do `runClaudeStream` e no `result` do `recordDecision`. O desfecho não vai pro `farol.log` (invariante 3); persistir em uso e decisão é da A1.
- **Escopo:** só o `retomarSid`. O `resumeSid` do round incremental segue opt-in e sem mudança.
```

- [ ] **Passo 2: gate completo**

Rodar: `npm run check && npm run lint && npm test`
Esperado: os três verdes. No `npm test`, a contagem final sem `fail`.

Se algum teste fora dos arquivos deste plano falhar citando `retomarSid`, `retomadaPendente` ou `--resume`: rode `git grep -n "retomarSid" -- test` e aplique o padrão `retomada.guardarRetomada(e, pr, { retomarSid, knownHead, provedor: 'dir', perfilId: '' })` antes do `runHeadlessReview` do teste. Não afrouxe `validarRetomada` para fazer teste antigo passar.

Rodar: `node --test test/retomada-duravel-puro.test.js test/retomada-duravel.test.js 2>&1 | tail -n 12`
Esperado: `# fail 0`. Guardar a saída para o passo 3.

- [ ] **Passo 3: registrar a evidência**

Se `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md` não existir, criar com o cabeçalho abaixo; se existir, acrescentar só a seção `## A5 Retomada durável` no fim.

```markdown
# Execução da operação multidispositivo: evidências

Cada entrega registra aqui o gate que rodou e o mapa critério de aceite para teste.

## A5 Retomada durável

**Plano:** `docs/superpowers/plans/2026-09-15-md-a5-retomada-duravel.md`
**Commit final:** <preencher com `git rev-parse --short HEAD`>
**Gate:** `npm run check && npm run lint && npm test` verde em <preencher data e hora de Brasília>; `# fail 0` na suíte da A5 (saída colada abaixo).

| Critério de aceite (7.A5) | Teste |
|---|---|
| Retomada local válida | `test/retomada-duravel.test.js`: "retomada local válida depois de reiniciar..." e "desfecho retomada..." |
| Recusa antes do provedor sem sessão iniciada e sem consumir a retomada | `test/retomada-duravel.test.js`: "recusa da coordenação (alheio)..." e "recusa da coordenação (indisponivel)..." |
| Referência preservada durante espera por vaga | `test/retomada-duravel.test.js`: "referência preservada enquanto espera vaga na fila..." |
| Referência preservada durante espera por lease | `test/retomada-duravel.test.js`: "recusa da coordenação (alheio)..." |
| Recusa temporária por orçamento não consome | `test/retomada-duravel.test.js`: "orçamento estourado na boca da sessão..." |
| Dois reinícios antes da retomada | `test/retomada-duravel.test.js`: "dois reinícios antes da retomada não perdem a referência" |
| Referência vinda de falha transitória é durável | `test/retomada-duravel.test.js`: "queda transitória: a referência vai pro disco..." |
| Sem janela: sid gravado enquanto a sessão roda | `test/retomada-duravel.test.js`: "o sid da sessão nova vai pro disco com head e contexto..." |
| Operação equivalente concluída em outro aparelho não retoma | `test/retomada-duravel.test.js`: "recibo de outro aparelho na admissão..." e "revisão equivalente já concluída depois da queda..." |
| HEAD alterado | `test/retomada-duravel.test.js`: "HEAD alterado..."; `test/retomada-apos-falha.test.js`: "head diferente do knownHead da queda derruba a retomada" |
| HEAD não confirmado (consulta ao GitHub falhou) não injeta o bloco | `test/retomada-duravel.test.js`: "HEAD não confirmado (vazio)..." e "HEAD não confirmado (exceção)..."; `test/retomada-apos-falha.test.js`: "head atual não confirmado..." |
| Contexto local ausente | `test/retomada-duravel.test.js`: "contexto local ausente (inflight legado sem provedor)..." |
| Contexto local incompatível (perfil ou provedor) | `test/retomada-duravel.test.js`: "perfil diferente..." e "provedor diferente..."; `test/retomada-duravel-puro.test.js`: "validarRetomada..." |
| Fallback para sessão nova sem herança indevida | `test/retomada-duravel.test.js`: "HEAD alterado..." e "desfecho recusada..."; `test/retomada-apos-falha.test.js`: "resume recusado pelo CLI..." e "sem head salvo..." |
| Diagnóstico distingue retomada, recusa do CLI e sessão nova | `test/retomada-duravel.test.js`: "desfecho retomada...", "desfecho recusada...", "desfecho nova...", "desfecho nenhuma...", "admissão recusada na tentativa de retomada..." |
| Formato exato do inflight.json | `test/retomada-duravel.test.js`: "writeInflight grava execução, fila e pendente no formato exato"; `test/retomada-duravel-puro.test.js`: "montarInflight..." |

**Contraprovas executadas:** <listar, por tarefa, a mutação aplicada, o teste que ficou vermelho e a confirmação de que voltou a verde>

**Saída da suíte da A5:**

    <colar a saída do passo 2>
```

Preencher os três marcadores `<preencher ...>`/`<listar ...>`/`<colar ...>` com os dados reais desta execução; o arquivo não pode ser commitado com eles.

- [ ] **Passo 4: contraprova do gate**

Mutação: em `server.js`, `writeInflight`, trocar `retomadaMod.montarInflight(this)` por `[]`.
Rodar: `npm test`
Esperado: FAIL, pelo menos em "writeInflight grava execução, fila e pendente no formato exato", "dois reinícios antes da retomada...", "referência preservada enquanto espera vaga..." e nos testes de `writeInflight` do `test/inflight-session-id.test.js`. Restaurar e rodar `npm test`: verde.

- [ ] **Passo 5: commit**

```
git add CLAUDE.md docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md
git commit -m "docs(retomada): contrato da retomada duravel no guia e evidencia da A5"
```

Antes do push (fora deste plano): `npm run eng`, branch própria e PR, nunca push direto na `main` (seção 15 da spec).

---

## Ambiguidades declaradas (não são decisões de produto; confirmar com o dono antes do merge)

1. **Teto de tentativas transitórias (`esgotado`)**: o plano mantém a referência quando o PR estaciona por esgotar as tentativas, então um clique posterior retoma a sessão se a validação passar. A spec não trata esse caso.
2. **Sem prazo de validade para `pendente`**: uma referência de PR fechado enquanto o app estava fora só sai quando o fechamento é observado (retry ou boca da sessão). A spec não define TTL e o plano não inventa um.
3. **Head não confirmado espera sem teto**: enquanto o `gh pr view` falhar e a checagem do ciclo funcionar, a revisão reespera a cada ciclo com um WARN por tentativa, sem custo de sessão. A spec diz "aguarda ou revalida", sem limite.
4. **Inflight legado (v2.57.3) não retoma após o update**: não tem provedor e perfil, e a regra de contexto ausente o descarta (sessão nova). Consequência direta de CT-RET, mas muda o comportamento de quem atualizar com revisão interrompida.
5. **`resumeOutcome` é compartilhado**: o round incremental opt-in (`resumeSid`) que retoma com sucesso também sai como `retomada`, e a recusa da admissão sai como `nenhuma`. A A1 precisa saber disso ao persistir.
6. **"Concluída em outro aparelho"** é detectada por dois sinais que existem hoje: recibo na admissão da coordenação e decisão local do mesmo head criada depois da referência. Decisões vindas de outro aparelho só entram aqui quando a sincronização as trouxer para `engine.decisions`.

---

## Critérios de aceite da spec x testes

| Requisito (CT-RET / 7.A5) | Onde é implementado | Teste |
|---|---|---|
| Transição durável pendente, fila, execução reaproveitando `inflight.json`, sem janela | `montarInflight`, `writeInflight`, `recoverInflight`, `registrarSessionId` | "writeInflight grava execução, fila e pendente no formato exato"; "o sid da sessão nova vai pro disco com head e contexto enquanto ela roda"; "referência preservada enquanto espera vaga na fila..." |
| Vale pra retomada do boot e pra vinda de falha transitória | `restaurarRetomadas`; `prComRetomada` | "dois reinícios..."; "queda transitória: a referência vai pro disco..." |
| Sobrevive a reinício esperando admissão ou vaga; dois reinícios seguidos | `recoverInflight` regrava | "dois reinícios antes da retomada não perdem a referência"; "recusa da coordenação (alheio)..." (reinício dentro do teste) |
| Recusa temporária (lease, capacidade, orçamento, indisponibilidade) não consome | `tratarBloqueioDeCoordenacao`, `runOneHeadless` (orçamento), `enqueueHeadless` | "recusa da coordenação (alheio/indisponivel)..."; "orçamento estourado..."; "referência preservada enquanto espera vaga..." |
| Desfecho equivalente concluído tem tratamento próprio | `concluidaDepois`; recibo em `tratarBloqueioDeCoordenacao` | "revisão equivalente já concluída..."; "recibo de outro aparelho na admissão..." |
| Validação: PR, versão material e contexto local de provedor e perfil | `validarRetomada`, `contextoDaConta` | "validarRetomada: só retoma com PR, head confirmado e contexto iguais"; "perfil diferente..."; "provedor diferente..."; "contexto local ausente..." |
| HEAD salvo não é confirmação; sem confirmação aguarda e não injeta o bloco | `headConfirmado`, `erroAguardaRetomada`, `aguardarConfirmacaoDeHead` | "HEAD não confirmado (vazio)..."; "HEAD não confirmado (exceção)..."; "head atual não confirmado..." |
| HEAD mudou ou contexto não serve: desfecho explícito, revisão nova pelas regras normais sem herança e sem confirmação humana | `sidDeRetomada` (`semRetomada: 'nova'`), `anunciaRetomada`, `AVISO_DESCARTE` | "HEAD alterado: sessão nova sem --resume e sem bloco, sem confirmação humana..."; "desfecho nova..." |
| Diagnóstico distingue retomada, recusa do CLI e sessão nova; sessão nova nunca como retomada | `rodarSessao`, `sessaoComDesfecho`, `marcarDesfecho`, `result.resumeOutcome` | "desfecho retomada..."; "desfecho recusada..."; "desfecho nova..."; "desfecho nenhuma..."; "admissão recusada na tentativa de retomada..." |
| Escopo: só `retomarSid`, `resumeSid` inalterado | `sidDeRetomada` (ramo opt-in intacto) | `test/retomada-apos-falha.test.js`: "sem retomarSid, o resumeSid opt-in segue valendo e sem bloco de retomada" |
| CT-COMPAT (b): muda só o `inflight.json`, nada de gate, decisão ou escrita no GitHub | nenhum arquivo de `decision.js`/`postReview` tocado | suíte completa verde (`npm test`), incluindo `test/dedup-round.test.js`, `test/sync-review.test.js` e `test/public-review-language.test.js` |
