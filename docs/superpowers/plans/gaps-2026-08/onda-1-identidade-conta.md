# Rascunho de plano, correção dos gaps lógicos do Farol

## Onda 1: Identidade de conta (raiz P1)

**Achados cobertos:** A1 (raiz, server.js:473), A3 (chat.js:65), M10 (selfpr.js:401), M11 (gh-queries.js:19)

**Base:** Farol v2.30.1, commit `4d39d8f`, fonte em `C:\Users\wanderson\Documents\farol`. Números de linha citados conferidos contra o fonte em 02/08/2026.

### Decisão de design central (documentada, pedida pelo relatório)

`ghEnv(user)` passa a FALHAR ALTO (lança `Error`) quando a conta pedida está sem token, em vez de herdar o token da primária. O único fallback legítimo que permanece é `ghEnv()` SEM user, que significa "conta padrão, pedido explícito" (é o contrato do `update.js`, que baixa release do repo pessoal). Racional:

1. Devolver env sem `GH_TOKEN` seria pior: o gh cai no keyring e a identidade vira "o que estiver ativo na máquina", exatamente o M11.
2. Devolver `null` seria fail-silent: `spawn(..., { env: null })` herda `process.env` sem ninguém perceber; um call site esquecido volta ao bug em silêncio.
3. Lançar é fail-loud e tem precedente no próprio projeto: `ehMac`/`ehWin` viraram funções de propósito pra que referência esquecida explodisse em `ReferenceError` alto em vez de falhar calada (CLAUDE.md, seção de plataforma).

Pra isso ser seguro, TODO call site é classificado e guardado ANTES do flip (a ordem das tarefas garante isso; ver D1). A guarda usa um método novo e pequeno, `Engine.tokenFor(user)`, que devolve o token da conta pedida ou `null`, sem nunca herdar (user vazio = primária, o único fallback legítimo).

### Mapa completo dos call sites de ghEnv e comportamento desejado sem token da conta

| # | Call site | Tipo | Comportamento quando a conta pedida está sem token |
|---|---|---|---|
| 1 | `gh-queries.js:11` `searchPRs` | leitura sensível a identidade (`@me`) | pré-checagem: WARN + `return null` (o `check()` já trata null como busca falhada) |
| 2 | `gh-queries.js:43` `myAuthoredPRs` | leitura sensível a identidade | pré-checagem: WARN + `return null` |
| 3 | `gh-queries.js:98` `fetchDeliveries` | leitura por conta | pula o alvo, `partial = true`, os outros seguem |
| 4 | `decision.js:79` `myReviewStates` | leitura sensível a identidade (dedup de postagem) | pré-checagem: `return null` (contrato existente: null = não confirmou) |
| 5 | `decision.js:192,202` `postReview` | ESCRITA no GitHub | pré-checagem: ERROR + `{ ok:false, error }`, nunca postar |
| 6 | `selfpr.js:21` `reviewerCandidates` | leitura por org | `continue` (a org daquela conta fica fora do seletor no ciclo) |
| 7 | `selfpr.js:55` `setReviewers` | ESCRITA | corrigir a guarda existente (precedência errada permitia fallback primário) |
| 8 | `selfpr.js:118` `fetchMergeState` | leitura best-effort | pré-checagem: `return null` (contrato existente) |
| 9 | `selfpr.js:140` `enrichMyPRBranches` | leitura best-effort por PR | `continue` no PR daquela conta, os outros seguem |
| 10 | `selfpr.js:158` `fetchAutoMergeAllowed` | leitura best-effort | pré-checagem: `return null` |
| 11 | `selfpr.js:171` `fetchRuleBlocked` | leitura best-effort | pré-checagem: `return null` |
| 12 | `selfpr.js:237` `staleForReview` | leitura sensível a identidade | pré-checagem: `return false` (contrato: incerteza = false, nunca "Re-revisar" indevido) |
| 13 | `selfpr.js:270` `mergeSelfPR` | ESCRITA (merge!) | corrigir a guarda existente (mesma precedência errada do 7) |
| 14 | `selfpr.js:438` `runSelfAnalysis` (busca do SHA) | leitura pós-sessão | cair no caminho `!ok` já existente (`pr.headSha \|\| null`), não descartar a análise |
| 15 | `pushback.js:127` `detectAuthorPushback` | leitura sensível a identidade | pré-checagem: `return null` (contrato existente) |
| 16 | `pushback.js:158` `classifyPushback` (via runClaudeStream) | sessão Claude | coberto pelo catch por PR do `scanPushbacks` (vira WARN); sem guarda própria |
| 17 | `fanout.js:26` `prMetrics` | leitura | sem guarda própria: o chamador degrada pro passe único e o gate do launchReview (tarefa 1.6) impede chegar aqui sem token |
| 18 | `session.js:132` `spawnConsole` | sessão terminal | gate por conta no `launchReview` ANTES do spawn (tarefa 1.6) |
| 19 | `session.js:331` `runClaudeStream` | sessão headless | gate nos chamadores (launchReview, launchSelfAnalysis, chatSend); o throw do ghEnv vira rejection capturada como rede de segurança |
| 20 | `update.js:66,93` `checkUpdate`/download | leitura de release | chama `ghEnv()` SEM user: continua na primária por contrato (documentado e travado por teste) |

**Dificuldades antecipadas da onda** (a parte MAIS importante do plano; o objetivo é ter a solução pronta antes do impedimento aparecer):

- **D1. Ordem de execução: o flip do ghEnv (lançar) antes das guardas quebraria o app nos commits intermediários** (um flake de keyring derrubaria o ciclo inteiro com throw não guardado, e `check():617` chama `launchReview` sem await nem catch, então um throw síncrono viraria unhandled rejection, que no Node 20+ derruba o processo). → Solução preparada: a ordem das tarefas é 1.1 a 1.6 primeiro (guardas distribuídas, cada uma já corrige comportamento com o ghEnv leniente) e o flip do ghEnv é a ÚLTIMA tarefa (1.7). Quando o throw entra, todos os caminhos de produção já foram guardados: o throw é rede de segurança inalcançável no fluxo normal, e cada commit intermediário é verde e shippable.
- **D2. Testes existentes quebram no flip: `test/claude-profiles.test.js` chama `ghEnv('bob')`, `ghEnv('alice')` e `ghEnv('qualquer')` SEM tokens no engine** (linhas 107, 108, 115, 117 e o script de subprocesso da linha 247). Com o ghEnv estrito, esses cinco pontos lançam e a suíte fica vermelha. → Solução preparada: a tarefa 1.7 inclui os diffs exatos desses testes (adicionar `engine.tokens = { bob: 't-b', alice: 't-a' }` etc. antes das chamadas). Não é afrouxamento: é o contrato novo, e os testes de CLAUDE_CONFIG_DIR continuam provando o mesmo que provavam.
- **D3. Interação com o A2 (onda de outra fatia): pular a busca de conta sem token gera `null` parcial, e hoje `check()` com `mine` parcial zera a fila e apaga `reReviewedKeys` (A2).** Análise feita: no cenário disparador do A1 (token de trabalho falhou), os PRs de trabalho JÁ somem hoje, porque a busca roda com o token pessoal e o `@me` não os encontra; a onda não piora nada, só torna a falha explícita (null) em vez de implícita (resultado da identidade errada). → Solução preparada: nenhuma tentativa de consertar A2 aqui (seria vazamento de escopo); registrar no PR da onda que o skip usa o MESMO caminho `null` que a correção do A2 vai preservar, então a correção do A2 fica MAIS eficaz depois desta onda. Se a onda do A2 já tiver sido executada antes, nada muda neste plano.
- **D4. Toast spam no ciclo automático: com gate por conta no `launchReview`, o `check()` relançaria os PRs da conta sem token a cada ciclo (60s) e cada tentativa emitiria toast de erro.** → Solução preparada: filtro `this.tokenFor(this.accountForPr(p))` no `toReview` (server.js:608-613) e no bloco de retry (server.js:621), silencioso de propósito: a barra de contas da UI já mostra "sem token: rode gh auth login" via `snapshot().accounts[].tokenOk` (server.js:1005, ui/app.js:424), zero UI nova. O PR fica na fila esperando o token voltar.
- **D5. `runOneHeadless` classificaria "sem token" como falha não-transitória e ESTACIONARIA o PR (`autoReviewParked`), exigindo relançamento manual depois de um flake de keyring que se resolve sozinho.** → Solução preparada: nova classe transitória `authErr` (`/sem token no gh/i`) na classificação de `runOneHeadless` (review.js:130-133), com teste próprio na tarefa 1.6. A mensagem de erro do ghEnv estrito e das guardas usa sempre a MESMA frase "sem token no gh" justamente pra essa regex casar (contrato de mensagem documentado no código).
- **D6. O espião de `run` dos testes precisa ser instalado ANTES do `require('../server.js')`, senão gh REAL roda durante os testes** (os módulos de engine fazem `const { run } = require('../io')` no load e a desestruturação captura a referência). → Solução preparada: o arquivo de teste novo (`test/account-identity.test.js`) nasce com o espião no topo, no padrão documentado de `test/merge-gates.test.js`, e com default respondendo `{ ok:true, stdout:'' }` (nunca cai no gh real, diferente do merge-gates que delega pro real por default).
- **D7. Testar `chatSend` é testar um fire-and-forget: a resposta roda numa IIFE async interna, então asserção logo após o await lê estado parcial (status ainda 'running').** → Solução preparada: poll `while (chat.status === 'running') await sleep(10)` no teste, mesmo espírito das esperas de `claude-profiles.test.js:283-284`; `runClaudeStream` é substituído por stub na INSTÂNCIA (sombra da fachada do prototype), então nenhuma sessão real abre.
- **D8. De onde vem a conta do chat: `chatSend` só recebe `key` e `url`, não um `pr` com `account`.** → Solução preparada: `engine.accountForPr({ key, url })` (server.js:416-420) deriva a conta pela org do repo embutida na key, com fallback documentado pra primária quando a org não é monitorada (mesmo comportamento do resto do app); o teste usa org monitorada pra provar o caso que importa.
- **D9. `postReview` tem try/catch envolvendo tudo: sem cuidado, o teste "recusa sem token" passaria ANTES do fix por um motivo errado** (STATE_DIR inexistente no FAROL_HOME temporário faz o `writeFileSync` do payload lançar e o catch devolve `ok:false` igual). → Solução preparada: o setup do teste cria `STATE_DIR` com `fs.mkdirSync(STATE_DIR, { recursive: true })` (mesmo idiom de `chat-tools-queries.test.js:119`) e a asserção exige a mensagem `/sem token/` E zero chamadas gh, não só `ok:false`.
- **D10. CLAUDE.md fica mentiroso depois do A3: o parágrafo "Adiamentos conscientes" afirma que `chat.js` não passa `opts.account`** (linha 124). Documentação desatualizada nesse arquivo é dívida grave, porque ele é o guia de manutenção que os próprios Claudes leem. → Solução preparada: o texto novo do parágrafo já está pronto na tarefa 1.5, passo 3, editado no MESMO commit que muda o comportamento.
- **D11. Legado persistido e single-account: máquina antiga sem `accounts[]` configurado e com keyring do gh funcionando, mas `gh auth token` falhando** (raro, o flake documentado no CLAUDE.md), hoje ainda busca "algo" via keyring; depois da onda o ciclo falha explícito com "todas as buscas gh falharam". → Solução preparada: é o comportamento DESEJADO (falhar alto em vez de identidade indeterminada), documentado no comentário do `tokenFor`; o log de WARN por busca pulada diz exatamente qual conta está sem token e o que rodar (`gh auth login`), então o usuário tem ação clara.
- **D12. Cross-platform: nada nesta onda tem branch de SO (token e env são puros), mas a suíte roda no Windows E precisa rodar num Mac.** → Solução preparada: todos os testes novos usam Engine real contra `FAROL_HOME` temporário com `path.join` (idiom existente), nenhum toca `cmd.exe`/`sh` nem os testes de sessão por SO; `session-posix.test.js` e `session-claude-profile.test.js` não são modificados, então o contrato de plataforma não é tocado.
- **D13. `refreshTokens` roda a cada ciclo e pode DELETAR um token no meio de uma operação em andamento** (sessão headless de 10min, por exemplo). → Solução preparada: nenhuma ação necessária e o porquê documentado: `spawn` copia o env no momento do spawn, então sessão já aberta não é afetada; só operações NOVAS falham, e falham alto na guarda ou no ghEnv, caindo no retry transitório da D5.
- **D14. `test/facades.test.js` e a tabela de aridade de `test/review-prompt.test.js` podem reclamar de método novo ou aridade mudada.** → Solução preparada: `tokenFor` é método novo da Engine (não fachada de colaborador, não entra na tabela), `chatSend` não muda de assinatura e `runClaudeStream` já aceitava `opts.account` (review.js:278 e pushback.js:158 já passavam); o passo "rodar a suíte inteira" de cada tarefa pega qualquer surpresa, e nenhuma fachada nova com argumento de comportamento é criada.

---

### Tarefa 1.1: `Engine.tokenFor(user)`, token por conta sem herança de identidade (achados: A1)

**Arquivos:** Modify: `server.js:467-470` (novo método antes do `ghEnv`) | Test: `test/account-identity.test.js` (novo)

**Interfaces:** Produz: `Engine.tokenFor(user: string | undefined): string | null`. Contrato: `user` vazio/undefined devolve `this.token` (primária, único fallback legítimo); `user` preenchido devolve `this.tokens[user]` ou `null`, NUNCA o token de outra conta. Consumido por todas as tarefas seguintes.

**Dificuldades antecipadas:**
- O arquivo de teste novo precisa fixar `FAROL_HOME` antes de QUALQUER require que carregue `lib/paths.js` (const de módulo lida uma vez) → o esqueleto abaixo já vem com a ordem certa, copiada de `session-claude-profile.test.js:14-15`.
- Espião de `run` instalado depois do require do server não intercepta nada (D6) → esqueleto já instala antes.

- [ ] **Passo 1: escrever o teste que falha**

Criar `test/account-identity.test.js`:

```js
'use strict';
// Identidade de conta (raiz P1 do relatório de gaps): o Farol NUNCA age no GitHub nem
// abre sessão Claude com o token de uma conta no lugar de outra. tokenFor é a fonte
// única de "token desta conta, sem herdar"; as guardas das tarefas seguintes usam ele.
// Padrões seguidos: espião no io.run ANTES do require do server.js (merge-gates.test.js)
// e Engine real contra FAROL_HOME temporário (claude-profiles.test.js).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-identidade-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// espião no run: os módulos de engine capturam a referência na desestruturação do
// require, então a troca tem que acontecer antes do require('../server.js'). O default
// devolve ok vazio: NENHUM gh real roda neste arquivo.
const io = require('../lib/io');
const runReal = io.run;
let runImpl = null;
const chamadas = [];
io.run = function runEspiao(cmd, args, opts) {
  chamadas.push({ cmd, args: args || [], env: (opts || {}).env });
  if (runImpl) return runImpl(cmd, args || [], opts);
  return Promise.resolve({ ok: true, code: 0, stdout: '', stderr: '' });
};

const { Engine } = require('../server.js');
const { STATE_DIR } = require('../lib/paths');
fs.mkdirSync(STATE_DIR, { recursive: true });

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(() => { chamadas.length = 0; runImpl = null; });

// engine com duas contas: alice (primária, com token) e bob (trabalho, SEM token),
// exatamente o cenário do flake de keyring que dispara o A1
function engineDuasContas() {
  const e = new Engine();
  e.config.accounts = [
    { user: 'alice', owners: ['acme'] },
    { user: 'bob', owners: ['biudtech'] }
  ];
  e.token = 'tok-alice';
  e.tokens = { alice: 'tok-alice' }; // bob ficou sem token neste ciclo
  e.tokenOk = true;
  e.refreshTokens = async () => { };
  e.refreshToken = async () => { };
  e.log = () => { };            // não sujar o farol.log do temp
  e.on('toast', () => { });
  e.pushState = () => { };
  return e;
}

test('tokenFor: conta pedida sem token devolve null, nunca o token da primária', () => {
  const e = engineDuasContas();
  assert.equal(e.tokenFor('bob'), null, 'bob sem token = null (herdar tok-alice seria o A1)');
  assert.equal(e.tokenFor('alice'), 'tok-alice');
});

test('tokenFor: sem user cai na primária (único fallback legítimo, contrato do update.js)', () => {
  const e = engineDuasContas();
  assert.equal(e.tokenFor(''), 'tok-alice');
  assert.equal(e.tokenFor(undefined), 'tok-alice');
  e.token = null;
  assert.equal(e.tokenFor(undefined), null, 'primária sem token = null, não inventa');
});
```

- [ ] **Passo 2: rodar e ver falhar**

```
node --test test/account-identity.test.js
```

Esperado: os 2 testes falham com `TypeError: e.tokenFor is not a function`.

- [ ] **Passo 3: implementação mínima**

Em `server.js`, imediatamente antes do `ghEnv` (hoje na linha 470-471), inserir:

```js
  // compat: alguns caminhos chamam refreshToken (singular)
  async refreshToken() { return this.refreshTokens(); }

  // token da conta pedida, SEM herdar identidade (raiz A1): user vazio = primária
  // (único fallback legítimo, pedido explícito da conta padrão, ex.: update.js).
  // Conta pedida sem token = null; quem precisa agir checa isso ANTES de rodar gh.
  tokenFor(user) {
    if (!user) return this.token || null;
    return (this.tokens && this.tokens[user]) || null;
  }

  // env de child-process com o GH_TOKEN da conta pedida (default = primaria)
  ghEnv(user) {
```

(Só adiciona o método; `ghEnv` ainda não muda nesta tarefa, ver D1.)

- [ ] **Passo 4: rodar a suite inteira**

```
npm run check && npm test
```

- [ ] **Passo 5: commit**

```
feat: tokenFor expoe o token por conta sem herdar identidade
```

---

### Tarefa 1.2: buscas gh pulam conta sem token em vez de buscar com identidade errada (achados: A1, M11)

**Arquivos:** Modify: `lib/engine/gh-queries.js:8-11` (searchPRs), `lib/engine/gh-queries.js:39-43` (myAuthoredPRs), `lib/engine/gh-queries.js:96-99` (loop do fetchDeliveries) | Test: `test/account-identity.test.js`

**Interfaces:** Consome: `engine.tokenFor(user)`. Nenhuma assinatura muda; o contrato de retorno `null` (busca falhou) já existe e o `check()` (server.js:504-527, 534-539, 545-551) já o trata preservando estado, então NENHUMA mudança no check() é necessária nesta tarefa.

**Dificuldades antecipadas:**
- `@me` é o ponto onde o M11 morde: a busca com token errado devolve resultados válidos DA OUTRA conta, indistinguíveis de sucesso → a guarda fica ANTES de qualquer `run`, e o teste afirma `chamadas.length === 0` (nem tentou), não só o retorno null.
- Regra uniforme ou por flag? `searchPRs` serve panorama (`--owner`, não sensível) e fila (`--review-requested=@me`, sensível) → decisão: regra UNIFORME (sem token da conta pedida, não busca), porque analisar flag por flag criaria dois regimes no mesmo módulo e o ganho (panorama parcial com token de outra conta) nem existe, já que org privada de trabalho não é visível pro token pessoal.
- Interação com A2 (D3) → nada a fazer aqui além do registro no PR.

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar em `test/account-identity.test.js`:

```js
/* ---------- buscas gh: nunca com a identidade errada (A1, M11) ---------- */

test('searchPRs: conta sem token não roda gh nenhum e devolve null (falha de busca, não identidade errada)', async () => {
  const e = engineDuasContas();
  const r = await e.searchPRs(['--review-requested=@me'], 'bob');
  assert.equal(r, null);
  assert.equal(chamadas.length, 0, 'zero chamadas gh: o @me nunca resolve na conta errada');
});

test('searchPRs: conta com token busca com o token DELA', async () => {
  const e = engineDuasContas();
  runImpl = () => Promise.resolve({ ok: true, code: 0, stdout: '[]', stderr: '' });
  const r = await e.searchPRs(['--owner', 'acme'], 'alice');
  assert.deepEqual(r, []);
  assert.equal(chamadas[0].env.GH_TOKEN, 'tok-alice');
});

test('myAuthoredPRs: conta sem token devolve null sem rodar gh', async () => {
  const e = engineDuasContas();
  assert.equal(await e.myAuthoredPRs('bob'), null);
  assert.equal(chamadas.length, 0);
});

test('fetchDeliveries: alvo de conta sem token vira partial, os outros alvos seguem', async () => {
  const e = engineDuasContas();
  runImpl = () => Promise.resolve({ ok: true, code: 0, stdout: '[]', stderr: '' });
  const d = await e.fetchDeliveries(7, '');
  assert.equal(d.partial, true, 'a UI avisa que uma conta ficou de fora, nada de corte silencioso');
  assert.ok(chamadas.length > 0, 'a conta com token buscou normalmente');
  for (const c of chamadas) assert.equal(c.env.GH_TOKEN, 'tok-alice', 'nenhuma busca saiu com token trocado');
});
```

- [ ] **Passo 2: rodar e ver falhar**

```
node --test test/account-identity.test.js
```

Esperado: os testes de "sem token" falham (hoje a busca roda com `tok-alice` herdado: `r` vem `[]` em vez de `null` e `chamadas.length` é 1). Os testes de "com token" passam.

- [ ] **Passo 3: implementação mínima**

`lib/engine/gh-queries.js`, `searchPRs` (linhas 8-11) fica:

```js
async function searchPRs(engine, extraArgs, user) {
  // conta pedida sem token: NÃO busca com outra identidade (o @me resolveria na conta
  // errada e o resultado pareceria válido, M11). Trata como falha de busca (null),
  // que o check() já preserva. A frase "sem token no gh" é contrato (retry transitório).
  if (!engine.tokenFor(user)) {
    engine.log('WARN', `gh search pulado (${user || 'primaria'} sem token no gh)`);
    return null;
  }
  const args = ['search', 'prs', ...extraArgs, '--state', 'open', '--limit', '100',
    '--json', 'url,title,isDraft,author,number,repository,updatedAt'];
  const r = await run('gh', args, { env: engine.ghEnv(user) });
```

`myAuthoredPRs` (linhas 39-43) fica:

```js
  const acc = user || engine.primaryUser();
  const me = (acc || '').toLowerCase();
  if (!me) return null;
  if (!engine.tokenFor(user)) {
    engine.log('WARN', `gh search prs --author @me pulado (${acc} sem token no gh)`);
    return null;
  }
  const r = await run('gh', ['search', 'prs', '--author', '@me', '--state', 'open', '--limit', '50',
    '--json', 'url,title,isDraft,author,number,repository,updatedAt'], { env: engine.ghEnv(user) });
```

Loop do `fetchDeliveries` (linha 96-99) fica:

```js
  for (const t of targets) {
    if (!engine.tokenFor(t.user)) {
      partial = true;
      engine.log('WARN', `entregas puladas (${t.user || 'primaria'} sem token no gh)`);
      continue;
    }
    const r = await run('gh', ['search', 'prs', `merged:>=${since}`, '--owner', t.owner,
      '--limit', String(DELIVERIES_LIMIT), '--json', 'url,title,author,number,repository,closedAt'], { env: engine.ghEnv(t.user) });
```

- [ ] **Passo 4: rodar a suite inteira**

```
npm run check && npm test
```

- [ ] **Passo 5: commit**

```
fix: buscas gh pulam conta sem token em vez de herdar o da primaria
```

---

### Tarefa 1.3: `postReview` e `myReviewStates` exigem o token da conta do PR (achados: A1)

**Arquivos:** Modify: `lib/engine/decision.js:77` (myReviewStates), `lib/engine/decision.js:186-188` (postReview) | Test: `test/account-identity.test.js`

**Interfaces:** Consome: `engine.tokenFor(acc)`. Contratos de retorno preservados: `myReviewStates` devolve `null` (= não deu pra confirmar, o `decide()` em decision.js:264 segue adiante e o `postReview` barra), `postReview` devolve `{ ok:false, error }` que o `decide()` já transforma em toast (decision.js:273-275).

**Dificuldades antecipadas:**
- Falso verde do teste do postReview por STATE_DIR ausente (D9) → o header do arquivo de teste já criou `STATE_DIR`; a asserção exige `/sem token/` na mensagem e zero chamadas gh.
- `decide()` chama `myReviewStates` sem try/catch (decision.js:264): quando o ghEnv virar estrito (tarefa 1.7), um throw ali viraria 500 na rota → a pré-checagem devolvendo `null` elimina o caminho do throw; é por isso que esta tarefa vem antes do flip.

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar em `test/account-identity.test.js`:

```js
/* ---------- postagem: nunca com a identidade errada (A1, consequência 2) ---------- */

test('postReview: conta do PR sem token NÃO posta (o APPROVE não sai pela primária)', async () => {
  const e = engineDuasContas();
  const pr = { key: 'biudtech/app#9', repo: 'biudtech/app', number: 9 };
  const r = await e.postReview(pr, { event: 'APPROVE', body: 'ok' });
  assert.equal(r.ok, false);
  assert.match(r.error, /sem token/);
  assert.equal(chamadas.length, 0, 'nenhum gh api reviews foi chamado');
});

test('myReviewStates: conta sem token devolve null (não confirma dedup pela identidade errada)', async () => {
  const e = engineDuasContas();
  const s = await e.myReviewStates({ key: 'biudtech/app#9', repo: 'biudtech/app', number: 9 });
  assert.equal(s, null);
  assert.equal(chamadas.length, 0);
});
```

- [ ] **Passo 2: rodar e ver falhar**

```
node --test test/account-identity.test.js
```

Esperado: `postReview` devolve `ok:true` (o espião respondeu ok com o token herdado) e `chamadas.length` é 1 em cada teste: os dois falham.

- [ ] **Passo 3: implementação mínima**

`decision.js`, `myReviewStates`, depois da linha 77 (`if (!repo || !number || !me) return null;`):

```js
  if (!repo || !number || !me) return null;
  // conta sem token: não dá pra confirmar (nunca consultar com outra identidade)
  if (!engine.tokenFor(acc)) return null;
  const r = await run('gh', ['api', `repos/${repo}/pulls/${number}/reviews`,
```

`decision.js`, `postReview`, logo depois de `const acc = engine.accountForPr(pr);` (linha 187):

```js
    const acc = engine.accountForPr(pr);
    // ESCRITA no GitHub: sem o token DESTA conta, não posta (a alternativa era o
    // review sair assinado pela primária, o cenário central do A1)
    if (!engine.tokenFor(acc)) {
      const msg = `conta ${acc || '(nenhuma)'} sem token no gh, review não postado`;
      engine.log('ERROR', `postar review ${pr.key} (${payload.event}): ${msg}`);
      return { ok: false, error: msg };
    }
    const file = path.join(STATE_DIR, 'pr-review-payload.json');
```

- [ ] **Passo 4: rodar a suite inteira**

```
npm run check && npm test
```

- [ ] **Passo 5: commit**

```
fix: postReview e myReviewStates exigem token da conta do PR
```

---

### Tarefa 1.4: Meus PRs, gates pela conta do PR e leitores best-effort (achados: M10, A1)

**Arquivos:** Modify: `lib/engine/selfpr.js:398-404` (launchSelfAnalysis), `selfpr.js:56-59` (guarda do setReviewers), `selfpr.js:272-276` (guarda do mergeSelfPR), `selfpr.js:20-22` (reviewerCandidates), `selfpr.js:116-118` (fetchMergeState), `selfpr.js:139-140` (enrichMyPRBranches), `selfpr.js:157-158` (fetchAutoMergeAllowed), `selfpr.js:170-171` (fetchRuleBlocked), `selfpr.js:236-237` (staleForReview), `selfpr.js:438` (busca do SHA no runSelfAnalysis), `lib/engine/pushback.js:126-127` (detectAuthorPushback) | Test: `test/account-identity.test.js` e `test/merge-gates.test.js`

**Interfaces:** Consome: `engine.tokenFor(acc)`. Nenhuma assinatura muda. Comportamentos por contrato existente: `fetchMergeState`/`fetchAutoMergeAllowed`/`fetchRuleBlocked`/`detectAuthorPushback` devolvem `null`, `staleForReview` devolve `false`, `enrichMyPRBranches`/`reviewerCandidates` pulam o item.

**Dificuldades antecipadas:**
- A guarda atual de `setReviewers` e `mergeSelfPR` tem precedência errada: `!(engine.tokens && engine.tokens[acc]) && !engine.token` deixa passar quando a conta do PR está sem token mas a PRIMÁRIA tem (o `&&` liga os dois negativos; com token primário presente a expressão é false e a guarda não barra). É EXATAMENTE o fallback A1 no nível da operação → o fix troca a expressão inteira por `!engine.tokenFor(acc)`, e o teste do merge usa `tokens = {}` com `engine.token` presente pra provar a precedência.
- `launchSelfAnalysis` hoje refresca token ANTES de resolver o PR (linhas 400-404); o gate por conta precisa da conta, que precisa do PR → reordenar (resolver `found` primeiro) sem mudar nenhum retorno; os retornos `{ ok:false, error }` existentes são preservados literalmente.
- Teste do caminho feliz do `launchSelfAnalysis` dispararia `processHeadless` real, que abriria sessão Claude de verdade → override `e.processHeadless = () => {}` na instância ANTES da chamada, e asserção no `headlessQueue` (o item fica lá, com `account: 'bob'`).
- `runSelfAnalysis` busca o SHA DEPOIS da sessão (selfpr.js:438); com ghEnv estrito um flake ali descartaria uma análise inteira que custou minutos → guarda ternária caindo no MESMO caminho `!ok` que já existe (`pr.headSha || null`), sem tocar na semântica do A6 (que é de outra onda).

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar em `test/account-identity.test.js`:

```js
/* ---------- Meus PRs: gate pela conta DONA do PR, não pela primária (M10) ---------- */

test('launchSelfAnalysis: recusa quando a conta do PR está sem token, mesmo com a primária ok (M10)', async () => {
  const e = engineDuasContas(); // primária alice ok, bob sem token
  e.myPRs = [{ key: 'biudtech/app#3', url: 'https://github.com/biudtech/app/pull/3', repo: 'biudtech/app', number: 3 }];
  const r = await e.launchSelfAnalysis('https://github.com/biudtech/app/pull/3');
  assert.equal(r.ok, false, 'não abre sessão que rodaria gh e Claude com identidade errada');
  assert.equal(e.headlessQueue.length, 0);
});

test('launchSelfAnalysis: conta do PR com token passa, mesmo com a PRIMÁRIA sem token (o M10 recusava isso)', async () => {
  const e = engineDuasContas();
  e.token = null; e.tokenOk = false; e.tokens = { bob: 'tok-bob' }; // só a de trabalho autenticada
  e.myPRs = [{ key: 'biudtech/app#3', url: 'https://github.com/biudtech/app/pull/3', repo: 'biudtech/app', number: 3 }];
  e.processHeadless = () => { }; // não abrir sessão de verdade no teste
  const r = await e.launchSelfAnalysis('https://github.com/biudtech/app/pull/3');
  assert.equal(r.ok, true);
  assert.equal(e.headlessQueue[0].account, 'bob');
});

test('setReviewers: conta do PR sem token recusa mesmo com token primário presente (precedência corrigida)', async () => {
  const e = engineDuasContas();
  e.config.defaultReviewers = { biudtech: ['carol'] };
  const r = await e.setReviewers('https://github.com/biudtech/app/pull/5');
  assert.equal(r.ok, false);
  assert.equal(chamadas.filter(c => c.args.join(' ').startsWith('pr edit')).length, 0,
    'nenhum pr edit sai assinado pela primária');
});

/* ---------- leitores best-effort: sem token = incerteza pelo contrato ---------- */

test('fetchMergeState: conta da org sem token devolve null sem rodar gh', async () => {
  const e = engineDuasContas();
  const ms = await e.fetchMergeState('https://github.com/biudtech/app/pull/8');
  assert.equal(ms, null);
  assert.equal(chamadas.length, 0);
});

test('staleForReview: conta sem token devolve false (nunca reativa Re-revisar por incerteza)', async () => {
  const e = engineDuasContas();
  const stale = await e.staleForReview({ key: 'biudtech/app#8', repo: 'biudtech/app', number: 8, url: 'https://github.com/biudtech/app/pull/8' });
  assert.equal(stale, false);
  assert.equal(chamadas.length, 0);
});
```

Acrescentar em `test/merge-gates.test.js` (depois dos testes de gate existentes, usando o `novoEngine` e o `roteador` do próprio arquivo):

```js
test('conta do PR sem token não mergeia, mesmo com token primário presente', async () => {
  const engine = novoEngine();
  engine.tokens = {}; // 'eu' perdeu o token no ciclo; engine.token (primário) segue setado
  runImpl = roteador();
  const r = await engine.mergeSelfPR(URL_PR);
  assert.equal(r.ok, false);
  assert.equal(mergeChamado().length, 0, 'o gate barra ANTES de qualquer pr merge');
});
```

- [ ] **Passo 2: rodar e ver falhar**

```
node --test test/account-identity.test.js
node --test test/merge-gates.test.js
```

Esperado: no primeiro arquivo, os testes de recusa falham (hoje `launchSelfAnalysis` gateia por `tokenOk` da primária e enfileira; `setReviewers` passa pela guarda de precedência errada; `fetchMergeState`/`staleForReview` rodam gh com token herdado). O teste "primária sem token" também falha (hoje `tokenOk false` recusa indevidamente). No merge-gates, o merge é chamado e o teste falha.

- [ ] **Passo 3: implementação mínima**

`selfpr.js`, `launchSelfAnalysis` (linhas 398-407) fica:

```js
async function launchSelfAnalysis(engine, url) {
  if (!url) return { ok: false, error: 'sem PR para analisar' };
  const found = engine.myPRs.find(p => p.url === url) || engine.prFromUrl(url);
  if (!found) return { ok: false, error: 'não reconheci esse PR' };
  const pr = { ...found, account: engine.accountForPr(found), kind: 'self' };
  // gate pela conta DONA do PR, não pela primária (M10): é ela que roda a sessão e o gh
  if (!engine.tokenFor(pr.account)) await engine.refreshTokens();
  if (!engine.tokenFor(pr.account)) {
    engine.emit('toast', { kind: 'error', text: `Conta ${pr.account || '(nenhuma)'} não autenticada no gh. Rode: gh auth login` });
    return { ok: false, error: 'gh sem token' };
  }
```

`setReviewers` (linhas 56-59) fica:

```js
  const acc = engine.accountForOwner(repo.split('/')[0]);
  const env = engine.ghEnv(acc);
  if (!acc || !engine.tokenFor(acc)) {
    engine.emit('toast', { kind: 'error', text: `Conta ${acc || '(nenhuma)'} não autenticada no gh. Rode: gh auth login` });
    return { ok: false, error: 'gh sem token' };
  }
```

(Atenção: mover a linha `const env = engine.ghEnv(acc);` pra DEPOIS da guarda quando a tarefa 1.7 tornar o ghEnv estrito; nesta tarefa a ordem atual ainda funciona, mas já deixar a guarda antes do env evita retrabalho: a forma final é guarda primeiro, `env` depois.)

```js
  const acc = engine.accountForOwner(repo.split('/')[0]);
  if (!acc || !engine.tokenFor(acc)) {
    engine.emit('toast', { kind: 'error', text: `Conta ${acc || '(nenhuma)'} não autenticada no gh. Rode: gh auth login` });
    return { ok: false, error: 'gh sem token' };
  }
  const env = engine.ghEnv(acc);
```

`mergeSelfPR` (linhas 269-276), mesma reordenação:

```js
  const acc = engine.accountForOwner(repo.split('/')[0]);
  const me = (acc || '').toLowerCase();
  if (!me) return { ok: false, error: 'conta do GitHub não configurada' };
  if (!engine.tokenFor(acc)) {
    engine.emit('toast', { kind: 'error', text: `Conta ${acc || '(nenhuma)'} não autenticada no gh. Rode: gh auth login` });
    return { ok: false, error: 'gh sem token' };
  }
  const env = engine.ghEnv(acc);
```

Leitores best-effort, cada um com a pré-checagem no topo, caindo no caminho de incerteza já existente:

```js
// fetchMergeState (linha 116)
async function fetchMergeState(engine, url) {
  const m = String(url).match(/github\.com\/([^/]+)\//i);
  const acc = engine.accountForOwner(m && m[1]);
  if (!engine.tokenFor(acc)) return null;
  const r = await run('gh', ['pr', 'view', url, '--json', 'mergeable,mergeStateStatus,isDraft,state'], { env: engine.ghEnv(acc) });

// fetchAutoMergeAllowed (linha 157)
async function fetchAutoMergeAllowed(engine, repo) {
  const acc = engine.accountForOwner(String(repo).split('/')[0]);
  if (!engine.tokenFor(acc)) return null;
  const r = await run('gh', ['api', `repos/${repo}`, '--jq', '.allow_auto_merge'], { env: engine.ghEnv(acc) });

// fetchRuleBlocked (dentro, depois do cache, linha 170)
  if (c && (Date.now() - c.at) < 30 * 60 * 1000) return c.blocked;
  const acc = engine.accountForOwner(String(repo).split('/')[0]);
  if (!engine.tokenFor(acc)) return null;
  const r = await run('gh', ['api', `repos/${repo}/rules/branches/${base}`, '--jq', '[.[].type]'], { env: engine.ghEnv(acc) });

// enrichMyPRBranches (loop, linha 139)
  for (const pr of (engine.myPRs || [])) {
    const acc = engine.accountForPr(pr);
    if (!engine.tokenFor(acc)) continue; // conta sem token neste ciclo: PR fica sem branch info
    const r = await run('gh', ['pr', 'view', pr.url, '--json', 'headRefName,baseRefName,headRefOid'], { env: engine.ghEnv(acc) });

// staleForReview (depois da linha 236)
  if (!repo || !number || !me) return false;
  if (!engine.tokenFor(acc)) return false; // incerteza NUNCA reativa o Re-revisar
  const env = engine.ghEnv(acc);

// reviewerCandidates (loop, linha 20)
  for (const owner of engine.allOwners()) {
    const accOwner = engine.accountForOwner(owner);
    if (!engine.tokenFor(accOwner)) continue; // org daquela conta fica fora do seletor no ciclo
    const env = engine.ghEnv(accOwner);

// runSelfAnalysis, busca do SHA (linha 438)
    const accPr = engine.accountForPr(pr);
    const shaR = engine.tokenFor(accPr)
      ? await run('gh', ['pr', 'view', pr.url, '--json', 'headRefOid', '--jq', '.headRefOid'], { env: engine.ghEnv(accPr) })
      : { ok: false };
    const headSha = shaR.ok ? shaR.stdout.trim() : (pr.headSha || null);
```

`pushback.js`, `detectAuthorPushback` (depois da linha 126):

```js
  if (!repo || !number || !me || !author || author === me) return null;
  if (!engine.tokenFor(acc)) return null; // sem token da conta: não dá pra determinar
  const env = engine.ghEnv(acc);
```

- [ ] **Passo 4: rodar a suite inteira**

```
npm run check && npm test
```

- [ ] **Passo 5: commit**

```
fix: gates de Meus PRs e leitores best-effort checam a conta do PR
```

---

### Tarefa 1.5: chat roda com a conta dona do PR (achados: A3)

**Arquivos:** Modify: `lib/engine/chat.js:44-48` (gate por conta no chatSend), `chat.js:65-67` (runOnce passa account), `CLAUDE.md` (parágrafo "Adiamentos conscientes") | Test: `test/account-identity.test.js`

**Interfaces:** Consome: `engine.accountForPr({ key, url })` e `engine.tokenFor(acc)`. Produz: `runOnce` passa `account: acc` no `opts` de `runClaudeStream` (opção JÁ suportada por session.js:331, nenhuma mudança lá). Assinatura de `chatSend(engine, key, url, text)` inalterada (nada de tabela de aridade).

**Dificuldades antecipadas:**
- Fire-and-forget do chatSend (D7) → poll de status no teste, código pronto abaixo.
- Derivação da conta sem objeto pr (D8) → `accountForPr({ key, url })`, a MESMA função usada por review/selfpr/pushback, então o fallback (org não monitorada cai na primária) é idêntico ao resto do app, nenhum regime novo.
- O efeito completo do A3 (o `--resume` achar a sessão da revisão headless) depende de `CLAUDE_CONFIG_DIR` igual ao da revisão: `runClaudeStream` resolve isso via `ghEnv(opts.account)` → `resolveClaudeConfigDir(account)` (server.js:478-479), já testado em `claude-profiles.test.js:96-109`; o teste daqui prova o repasse do `account`, que era o elo quebrado.
- CLAUDE.md desatualizado após o fix (D10) → edição no mesmo commit, texto pronto no passo 3.

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar em `test/account-identity.test.js`:

```js
/* ---------- chat: sessão com a conta dona do PR (A3) ---------- */

test('chatSend passa a conta do PR ao runClaudeStream (token gh e perfil Claude certos)', async () => {
  const e = engineDuasContas();
  e.tokens.bob = 'tok-bob'; // bob autenticado: o que se prova aqui é o REPASSE da conta
  let captured = null;
  e.runClaudeStream = async (prompt, opts) => { captured = opts; return { text: 'oi', sessionId: 's1' }; };
  e.saveChats = () => { };
  const r = await e.chatSend('biudtech/app#7', 'https://github.com/biudtech/app/pull/7', 'olá');
  assert.equal(r.ok, true);
  while (e.chats['biudtech/app#7'].status === 'running') await new Promise(res => setTimeout(res, 10));
  assert.ok(captured, 'runClaudeStream foi chamado');
  assert.equal(captured.account, 'bob', 'sem isso o resume cai no perfil Claude padrão e o gh no token primário (A3)');
});

test('chatSend recusa quando a conta do PR está sem token (nunca conversa com identidade errada)', async () => {
  const e = engineDuasContas(); // bob sem token
  let abriu = false;
  e.runClaudeStream = async () => { abriu = true; return { text: 'x' }; };
  e.saveChats = () => { };
  const r = await e.chatSend('biudtech/app#7', 'https://github.com/biudtech/app/pull/7', 'olá');
  assert.equal(r.ok, false);
  assert.match(r.error, /sem token/);
  assert.equal(abriu, false, 'nenhuma sessão abre com o token da primária');
});
```

- [ ] **Passo 2: rodar e ver falhar**

```
node --test test/account-identity.test.js
```

Esperado: primeiro teste falha com `captured.account` undefined (hoje `runOnce` não passa account). Segundo falha com `r.ok === true` (hoje só checa `engine.token`, que existe).

- [ ] **Passo 3: implementação mínima**

`chat.js`, linhas 44-48 ficam:

```js
  let chat = engine.chats[key];
  if (!chat) chat = engine.chats[key] = { key, url: url || null, sessionId: null, seeded: false, status: 'idle', messages: [], createdAt: Date.now() };
  if (chat.status === 'running') return { ok: false, error: 'aguarde a resposta atual (ou pare a geração)' };
  // conta dona do PR da conversa (A3): a sessão herda a da revisão headless, que rodou
  // com o token gh E o perfil Claude desta conta; sem o repasse o resume cai no perfil
  // errado e o gh na identidade errada. Sem token da conta, a conversa nem abre.
  const acc = engine.accountForPr({ key, url: url || chat.url || null });
  if (!engine.tokenFor(acc)) await engine.refreshToken();
  if (!engine.tokenFor(acc)) return { ok: false, error: `conta ${acc || '(nenhuma)'} sem token no gh (rode: gh auth login)` };
  chat.url = chat.url || url || null;
```

`chat.js`, `runOnce` (linha 65) fica:

```js
  const runOnce = (sid, prompt) => engine.runClaudeStream(prompt, {
    id,
    account: acc,
    extraArgs: sid ? ['--resume', sid] : [],
```

`CLAUDE.md`, parágrafo "Adiamentos conscientes" (na seção "Modelo e esforço das sessões autônomas") fica:

```
**Adiamentos conscientes:** não há override de modelo/esforço **por conta**. `claudeProfileId` tem porque `runClaudeStream` já resolve a assinatura por `opts.account` dentro do `ghEnv`, e o chat passou a passar `opts.account` (conta dona do PR da conversa, correção do gap A3). `tools.js` segue sem passar: um override por conta funcionaria em 4 dos 5 chamadores e seria ignorado em silêncio nas ferramentas, exatamente o anti-padrão de "setting que a UI mostra e o engine descarta". Fazer direito exige costurar `account` no `tools.js`.
```

- [ ] **Passo 4: rodar a suite inteira**

```
npm run check && npm test
```

- [ ] **Passo 5: commit**

```
fix: chat roda com a conta dona do PR (token gh e perfil Claude)
```

---

### Tarefa 1.6: revisão só abre sessão de conta com token; "sem token" é transitório (achados: A1 nos consumidores, família do M10)

**Arquivos:** Modify: `lib/engine/review.js:25-29 e 34-45` (launchReview: gate por conta no lugar do gate pela primária), `review.js:130-133` (classificação transitória), `server.js:608-613` (filtro do toReview) e `server.js:621` (filtro do retry) | Test: `test/account-identity.test.js`

**Interfaces:** Consome: `engine.tokenFor(user)`. `launchReview(urls, mode)` inalterada por fora; internamente filtra itens por conta com token e devolve `{ ok:false, error:'gh sem token' }` só quando NENHUM item sobra.

**Dificuldades antecipadas:**
- `check():617` chama `launchReview` fire-and-forget (sem await/catch): qualquer throw síncrono ali vira unhandled rejection (D1/D6) → o gate é filtro interno com toast, nunca throw; e o filtro do `toReview` no check() evita até a chamada.
- Toast spam a cada ciclo de 60s pra conta sem token (D4) → filtro silencioso no `toReview` e no bloco de retry; o toast do launchReview só dispara em clique manual, que é quando o usuário está olhando.
- PR estacionado indevidamente por flake de keyring (D5) → classe `authErr` transitória; o teste prova `retryAfterNet` em vez de `autoReviewParked`.
- O filtro precisa vir ANTES do `markSeen`/remoção da fila (review.js:43-44), senão o PR pulado é marcado como visto e SOME da fila sem revisão → posição do filtro explicitada no diff.
- Sessão TERMINAL (mode 'terminal') usa a conta do primeiro item (review.js:52): com o filtro antes, `items[0]` é garantidamente de conta com token.

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar em `test/account-identity.test.js`:

```js
/* ---------- lançamento de revisão: só conta com token abre sessão ---------- */

test('launchReview: PR de conta sem token fica de fora (e na fila); os das contas com token seguem', async () => {
  const e = engineDuasContas();
  const enfileirados = [];
  e.enqueueHeadless = (pr) => { enfileirados.push(pr); };
  const r = await e.launchReview([
    'https://github.com/acme/app/pull/1',
    'https://github.com/biudtech/app/pull/2'
  ], 'auto');
  assert.equal(r.ok, true);
  assert.deepEqual(enfileirados.map(p => p.account), ['alice'], 'só o PR da conta autenticada entrou');
});

test('launchReview: todas as contas sem token devolve erro sem enfileirar nada', async () => {
  const e = engineDuasContas();
  e.token = null; e.tokens = {}; e.tokenOk = false;
  const enfileirados = [];
  e.enqueueHeadless = (pr) => { enfileirados.push(pr); };
  const r = await e.launchReview(['https://github.com/acme/app/pull/1'], 'auto');
  assert.equal(r.ok, false);
  assert.equal(enfileirados.length, 0);
});

test('runOneHeadless: falha por "sem token" é transitória (retry no próximo ciclo, não estaciona)', async () => {
  const e = engineDuasContas();
  e.runHeadlessReview = async () => { throw new Error('conta bob sem token no gh (gh auth login --user bob)'); };
  e.writeInflight = () => { };
  const pr = { key: 'biudtech/app#2', url: 'https://github.com/biudtech/app/pull/2', repo: 'biudtech/app', number: 2, account: 'bob' };
  await e.runOneHeadless(pr, 'bob');
  assert.equal(e.autoReviewParked.has('biudtech/app#2'), false, 'flake de keyring se resolve sozinho, não pode estacionar');
  assert.equal(e.retryAfterNet.get('biudtech/app#2'), 1);
});
```

- [ ] **Passo 2: rodar e ver falhar**

```
node --test test/account-identity.test.js
```

Esperado: primeiro teste falha com `['alice','bob']` (hoje o gate é só `tokenOk` da primária, que está ok, e tudo entra). Terceiro falha com o PR estacionado (`autoReviewParked` tem a key e `retryAfterNet` está vazio). O segundo já passa hoje (gate da primária), fica como trava de regressão do novo caminho.

- [ ] **Passo 3: implementação mínima**

`review.js`, `launchReview`: o bloco das linhas 25-29 vira só o refresh (o gate por conta desce pra depois de montar os itens):

```js
async function launchReview(engine, urls, mode = 'auto') {
  if (!urls || !urls.length) return { ok: false, error: 'sem PRs para revisar' };
  if (!engine.token) await engine.refreshTokens();
```

E depois do `.filter(Boolean)` da montagem de `items` (linha 41), ANTES do `markSeen` (linha 43):

```js
  // gate por conta (A1 nos consumidores): item de conta SEM token não abre sessão
  // nenhuma (a sessão rodaria gh e Claude com identidade errada). Ele NÃO é marcado
  // como visto: fica na fila esperando o token voltar. Os demais seguem normalmente.
  const semToken = items.filter(it => !engine.tokenFor(it.account));
  if (semToken.length) {
    const contas = [...new Set(semToken.map(it => it.account || '(nenhuma)'))].join(', ');
    engine.emit('toast', { kind: 'error', text: `Conta ${contas} não autenticada no gh. Rode: gh auth login (${semToken.length} PR(s) fora desta revisão).` });
  }
  const prontos = items.filter(it => engine.tokenFor(it.account));
  if (!prontos.length) return { ok: false, error: 'gh sem token' };
  // lançar (manual ou auto) tira o PR do "estacionamento": ele volta a ser elegível
  for (const it of prontos) { engine.markSeen(it.key); engine.autoReviewParked.delete(it.key); }
  engine.queue = engine.queue.filter(p => !prontos.some(it => it.url === p.url));
  engine.pushState();
```

(e as referências seguintes a `items` no corpo, terminal e headless, passam a usar `prontos`: `prontos.map(p => p.key)`, `engine.accountForPr(prontos[0])`, `for (const pr of prontos) engine.enqueueHeadless(pr);` e os textos de toast usam `prontos.length`.)

`review.js`, classificação transitória (linhas 130-133) fica:

```js
    const limitErr = /hit your (session|usage|weekly) limit|session limit|usage limit/i.test(msg);
    const netErr = /ECONNRESET|ENOTFOUND|ETIMEDOUT|Connection closed|Unable to connect|fetch failed|network/i.test(msg);
    const toolErr = /não é reconhecido|not recognized|No such file|ENOENT|command not found|saiu com c[óo]digo \d/i.test(msg);
    // token da conta sumiu no meio (flake do keyring do gh): volta sozinho, não estaciona
    const authErr = /sem token no gh/i.test(msg);
    const transient = limitErr || netErr || toolErr || authErr;
```

`server.js`, `toReview` (linhas 608-613) fica:

```js
      const toReview = this.queue.filter(p =>
        !this.isMuted(this.accountForPr(p)) &&
        this.autoReviewFor(this.accountForPr(p)) &&
        this.tokenFor(this.accountForPr(p)) &&
        !inflight.has(p.key) &&
        !this.autoReviewParked.has(p.key) &&
        !this.retryAfterNet.has(p.key));
```

`server.js`, bloco de retry (linha 621) ganha o mesmo filtro:

```js
        const retry = this.queue.filter(p => this.retryAfterNet.has(p.key) && !fresh.some(f => f.key === p.key) && !this.isMuted(this.accountForPr(p)) && this.autoReviewFor(this.accountForPr(p)) && this.tokenFor(this.accountForPr(p)));
```

- [ ] **Passo 4: rodar a suite inteira**

```
npm run check && npm test
```

Verificação manual adicional (sem teste automatizado pro filtro do toReview, decisão consciente: testar `check()` inteiro exige stub de todas as buscas e não paga o custo aqui): subir instância isolada `FAROL_HOME=/tmp/farol-teste node server.js` com uma conta sem token e `autoReview` ligado nela, e confirmar no log que NÃO há toast repetido a cada ciclo nem relançamento (o PR fica na fila, a barra de contas mostra "sem token").

- [ ] **Passo 5: commit**

```
fix: revisao so abre sessao de conta com token e trata sem-token como transitorio
```

---

### Tarefa 1.7: ghEnv estrito, lança pra conta sem token (flip da raiz A1) (achados: A1, fechamento do M11)

**Arquivos:** Modify: `server.js:470-481` (ghEnv), `test/claude-profiles.test.js:96-118 e 241-253` (tokens nos testes legados de ghEnv) | Test: `test/account-identity.test.js`

**Interfaces:** Muda o contrato de `Engine.ghEnv(user)`: com `user` truthy e sem token daquela conta, LANÇA `Error('conta <user> sem token no gh ...')` (antes: herdava `this.token`). `ghEnv()` sem user segue exatamente como era (primária, e sem `GH_TOKEN` se nem ela tiver, contrato do update.js e do doctor). A frase "sem token no gh" na mensagem é contrato com a classificação transitória da tarefa 1.6.

**Dificuldades antecipadas:**
- Testes legados quebram (D2) → diffs exatos abaixo, no mesmo commit.
- Depois deste flip, QUALQUER call site futuro que esqueça a guarda falha alto em vez de agir com identidade errada; os pontos sem guarda própria e cobertos por catch (classifyPushback via scanPushbacks, prMetrics via degradação do fan-out, runClaudeStream via rejection nos chamadores) foram auditados na tabela de call sites; nenhum caminho de produção alcança o throw sem um catch de contexto → registrar a tabela no texto do PR pra revisão conferir.
- O smoke de boot (`test/boot.test.js`) roda contra o gh real da máquina: se o gh estiver logado, `refreshTokens` preenche e nada lança; se não estiver, as buscas já são puladas pela guarda da tarefa 1.2 ANTES de chegar no ghEnv → sem risco de vermelho intermitente novo (mesmo comportamento de hoje quando o gh falta).

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar em `test/account-identity.test.js`:

```js
/* ---------- a raiz (A1): ghEnv nunca herda identidade ---------- */

test('ghEnv: conta pedida sem token LANÇA em vez de herdar o token da primária', () => {
  const e = engineDuasContas();
  assert.throws(() => e.ghEnv('bob'), /bob sem token no gh/);
  assert.equal(e.ghEnv('alice').GH_TOKEN, 'tok-alice');
  assert.equal(e.ghEnv().GH_TOKEN, 'tok-alice', 'sem user = primária, contrato do update.js preservado');
});

test('ghEnv: sem user e sem token nenhum não lança (comportamento legado do doctor/boot)', () => {
  const e = engineDuasContas();
  e.token = null;
  const env = e.ghEnv();
  assert.equal('GH_TOKEN' in env, false);
});
```

- [ ] **Passo 2: rodar e ver falhar**

```
node --test test/account-identity.test.js
```

Esperado: o primeiro teste falha no `assert.throws` (hoje `ghEnv('bob')` devolve env com `GH_TOKEN: 'tok-alice'`, o próprio bug A1). O segundo já passa (trava de regressão).

- [ ] **Passo 3: implementação mínima**

`server.js`, `ghEnv` (linhas 470-481) fica:

```js
  // env de child-process com o GH_TOKEN da conta pedida (sem user = primaria, o único
  // fallback legítimo, ex.: update.js). Conta pedida SEM token = erro alto (raiz A1):
  // herdar o token de outra conta fazia busca @me, review postado e sessão Claude
  // saírem com a identidade errada. Os call sites de produção pré-checam com tokenFor
  // e caem nos seus caminhos de falha; este throw é a rede de segurança fail-loud
  // (mesma filosofia do ehMac/ehWin da UI). A frase "sem token no gh" é contrato
  // com a classificação de erro transitório do runOneHeadless.
  ghEnv(user) {
    const env = { ...process.env, GH_PAGER: 'cat', PAGER: 'cat', GH_PROMPT_DISABLED: '1' };
    const tok = this.tokenFor(user);
    if (user && !tok) throw new Error(`conta ${user} sem token no gh (rode: gh auth login --user ${user})`);
    if (tok) env.GH_TOKEN = tok;
    if (this.gitBash) env.CLAUDE_CODE_GIT_BASH_PATH = this.gitBash;
    // assinatura do Claude que o Farol usa pra esta conta: ver resolveClaudeConfigDir
    // (perfil por conta > perfil padrão do Farol > claudeConfigDir legado).
    const claudeDir = this.resolveClaudeConfigDir(user);
    if (claudeDir) env.CLAUDE_CONFIG_DIR = claudeDir;
    return env;
  }
```

`test/claude-profiles.test.js`, três ajustes (o contrato novo exige token pra pedir env de conta específica):

No teste da linha 96 (`ghEnv: injeta CLAUDE_CONFIG_DIR do perfil da conta`), depois do `engine.config.accounts = [...]`:

```js
  engine.tokens = { bob: 't-b', alice: 't-a' }; // ghEnv estrito: conta pedida precisa de token
  assert.equal(engine.ghEnv('bob').CLAUDE_CONFIG_DIR, 'C:\\biud-trabalho');
  assert.equal(engine.ghEnv('alice').CLAUDE_CONFIG_DIR, 'C:\\pessoal');
```

No teste da linha 111 (`ghEnv: sem profiles, comportamento legado`), no início:

```js
  const engine = new Engine();
  engine.tokens = { qualquer: 't-q' }; // ghEnv estrito: conta pedida precisa de token
```

No script embutido do teste de boot malformado (linha 241-253), antes da linha `const env = e.ghEnv('qualquer');`:

```js
    e.tokens = { qualquer: 'tok' };
    const env = e.ghEnv('qualquer');
```

- [ ] **Passo 4: rodar a suite inteira**

```
npm run check && npm test
```

Atenção redobrada aqui: é o commit que muda contrato; a suíte inteira verde é a prova de que TODAS as guardas das tarefas 1.2 a 1.6 cobrem os caminhos reais (se algum teste de outro arquivo lançar "sem token no gh", achamos um call site esquecido, e a correção é adicionar a guarda no padrão das tarefas anteriores, nunca afrouxar o ghEnv).

- [ ] **Passo 5: commit**

```
fix: ghEnv falha alto quando a conta pedida esta sem token (raiz A1)
```

---

### Verificação de encerramento da onda

1. `npm run check && npm test` verde (rede completa, 335 testes existentes + os novos).
2. Instância isolada (`FAROL_HOME=/tmp/farol-teste node server.js`, `autoReview` OFF) com duas contas configuradas e o token de uma delas ausente de propósito (`gh auth logout --user <conta>` numa conta de teste, ou simplesmente conta inexistente no keyring): confirmar no log os WARN "sem token no gh" das buscas puladas, a barra de contas com "sem token", NENHUM toast repetido por ciclo, e clique manual em Revisar num PR da conta sem token devolvendo o toast de erro claro.
3. Conferir que o A1 morreu de fato: com a conta de trabalho sem token, nenhum processo gh da conta de trabalho aparece com o token pessoal (o spawnlog opt-in, `lib/spawnlog.js`, ajuda a auditar quando ligado).
4. Registrar no texto do PR: a tabela de call sites desta onda, a dependência declarada com a onda do A2 (D3) e o adiamento consciente do `tools.js` (CLAUDE.md atualizado na tarefa 1.5).
