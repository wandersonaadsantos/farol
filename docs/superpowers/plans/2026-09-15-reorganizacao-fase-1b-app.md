# Reorganização estrutural, Fase 1b: quebrar o `ui/app.js`

> **Para quem executa:** use `superpowers:subagent-driven-development` (recomendado) ou
> `superpowers:executing-plans`, tarefa a tarefa. Os passos usam caixa (`- [ ]`).

**Goal:** tirar do `ui/app.js` tudo que é tela de uma aba, deixando nele só o bootstrap da
página (estado global, SSE, troca de aba, `data-goto`, atalhos), com cada aba num módulo ES
de `ui/telas/` importado por ele, sem mudar uma linha de comportamento.

**Architecture:** o `ui/app.js` deixa de chamar cada aba pelo nome e passa a conversar com
elas por um **registro**: cada módulo de tela se declara com `{ id, aoEntrar, aoEstado }`, e
o `switchTab` e o `connect()` percorrem o registro em vez de listar funções. É essa inversão
que torna a divisão possível: hoje o grafo entre os candidatos a módulo **não é acíclico**
(medição abaixo), e todos os sete ciclos passam por `switchTab` e `connect()` chamando as
abas enquanto as abas chamam de volta. O estado global (`STATE`, `SCOPE`, `CURRENT_TAB`) sai
para `ui/telas/estado.js`, que é a única coisa que todos importam.

**Tech Stack:** módulo ES nativo servido pelo próprio servidor do Farol, `node --test`, zero
dependências novas (invariante 1). Sem bundler, sem transpilador.

**Spec:** [`docs/superpowers/specs/2026-09-14-reorganizacao-estrutural-design.md`](../specs/2026-09-14-reorganizacao-estrutural-design.md)

**Depende de:** Fase 1a (`ui/pure.js` virou fachada de 16 módulos), já na `main`.

## Global Constraints

Valem em toda tarefa, sem exceção:

- **Zero dependências além do Electron.** Nenhum pacote npm, bundler ou transpilador.
- **Nada de mudança de comportamento.** Move-se código; não se reescreve lógica. As duas
  exceções são a Task 3 (o registro) e a Task 4 (o módulo de estado), que são declaradas,
  provadas e feitas ANTES de qualquer movimentação.
- **O `ui/index.html` continua carregando UM módulo** (`<script type="module" src="app.js">`).
  Nenhuma tag nova: mudar isso muda a ordem de execução, e é o que a spec proíbe na Fase 1.
- **Texto em português, sem travessão.** Vírgula, parênteses ou dois pontos.
- **Sem atribuição de IA** em commit ou PR.
- **Cada módulo novo fica abaixo de 400 linhas úteis.** `maxLines` do ratchet dispara em 400 e
  arquivo novo tem teto zero. Domínio que não couber é sinal de que ele são dois.
- **A frase de responsabilidade de cada módulo se escreve ANTES de mover** (lição 8 da
  execução da 1a): cada "e também" na frase é um módulo a mais, e arquivo NOVO em violação
  não pode entrar no baseline do eng-behaviour.
- **Gate por tarefa:** `npm run check && npm run lint && npm test` verde. Antes do push,
  `npm run eng`, com as avaliações de julgamento escritas para o head final pelo roteiro de
  `docs/QUALITY.md` (`repositoryId` = `farol`).
- **Caminho até a `main`:** branch, PR, CI verde, merge. Sem push direto, sem bypass.
- **Contraprova se desfaz restaurando de cópia, nunca com `git checkout`** sobre arquivo com
  trabalho não commitado (lição 4 da execução da 1a, que custou um módulo órfão).

## Linha de base medida (15/09/2026, `5a59c50`, Windows, Node 24)

Tudo abaixo foi medido, não estimado. Compare contra a SUA máquina antes de começar.

| medida | valor |
|---|---|
| `npm test` | 2856 testes, 2832 pass, **0 fail**, 24 skipped |
| `ui/app.js` | 4401 linhas, 169 funções de topo, 1 export (`toast`) |
| funções que leem global mutável | **109 de 169** (`STATE` em 68, `SCOPE` em 19, `ACCT` em 13, `ACTIVE_OPS` em 11) |
| `let` de módulo | 34 |
| efeitos no topo do módulo | 80 linhas (56 ligações `$('#id')`, 12 listeners de `document`, `connect()` na última linha) |
| `#id` citados pelo `app.js` | 167, dos quais 133 moram num painel de aba e 34 são cromo, topo e modais |
| testes que **importam** o `app.js` | 1 (`test/app-carrega.test.js`) |
| testes que **leem o fonte** do `app.js` | 9 |
| dívida mecânica do arquivo | `maxLines: 1`, `jsonStringifyCru: 2`, `ternarioAninhado: 38`, `profundidadeExcedida: 9` |
| dívida de arquitetura | `core.file.single-responsibility|ui/app.js|violacao` no baseline (`currentFindings` 14) |

Como reproduzir as medições: os scripts estão descritos na seção "Medição" no fim deste
plano.

## O achado que decide a fase: a divisão por aba NÃO é acíclica

Este é o fato que distingue a 1b da 1a. Na 1a o grafo interno do `ui/pure.js` era acíclico e
bastava mover em camadas. Aqui, agrupando as 169 funções pelos 20 blocos de seção do
arquivo, o grafo de chamadas tem **sete pares mútuos**:

| par mútuo | quem chama quem |
|---|---|
| `navegacao` <-> `entregas` | `switchTab->loadDeliveries`; `loadDeliveries->marcarSeg` |
| `navegacao` <-> `consumo` | `switchTab->renderUsage`; `wireUsageControls->marcarSeg` |
| `navegacao` <-> `reviewers` | `switchTab->loadReviewerCands`; `renderAutomationSettings->marcarSeg` |
| `navegacao` <-> `contas` | `switchTab->renderAccountBar`; `syncOptionalTabsVisibility->switchTab` |
| `navegacao` <-> `goto-busca` | `sysGoTo->sysSearchFilter`; `gotoAba->switchTab` |
| `sse` <-> `ferramentas` | `connect->renderTools`, `connect->ping`; `ping->connect` |
| `sistema-contas-orcamento` <-> `meus-prs` | `rerenderScope->renderMyPRs`; `montaFixPrompt->renderRadarNav` |

A causa é sempre a mesma e está escrita em duas funções:

- **`switchTab` (1516-1534)** lista as abas pelo nome: `if (name === 'entregas')
  loadDeliveries();`, e assim por diante para destaques, time, sistema e consumo.
- **`connect()` (4304-4318)** lista os renderizadores pelo nome, quinze chamadas em sequência
  a cada evento `state`.

Mover uma aba para um módulo sem mexer nisso criaria import circular de verdade: `app.js`
importa `telas/entregas.js` para chamar `loadDeliveries`, e `telas/entregas.js` importa
`app.js` para chamar `marcarSeg` e `switchTab`. Módulo ES aguenta ciclo em tempo de carga,
mas o valor lido no topo do módulo vem `undefined`, e o sintoma é tela em branco com a suíte
verde: exatamente o modo de falha que a Fase 1a já viu.

**A saída é inverter a aresta**, e por isso as Tasks 3 e 4 vêm antes de qualquer
movimentação:

- **`ui/telas/registro.js`**: cada tela chama `registrarTela({ id, aoEntrar, aoEstado })` e
  o `app.js` só percorre o registro. `switchTab` deixa de conhecer nome de aba, e `connect()`
  deixa de conhecer nome de renderizador. A dependência passa a ser de mão única, das telas
  para o registro.
- **`ui/telas/estado.js`**: `STATE`, `SCOPE`, `CURRENT_TAB` e os acessórios que 109 funções
  leem saem do escopo do módulo `app.js` e viram um objeto lido por função (`estado()`), com
  escrita só pelo `app.js`. Sem isso, cada módulo movido precisaria importar `app.js` de
  volta só para ler `STATE`, que é o ciclo pela porta dos fundos.

## File Structure

Módulos criados em `ui/telas/`. A frase de responsabilidade de cada um está escrita aqui, e
é ela que a avaliação de `core.file.single-responsibility` vai repetir no fim da fase:

| arquivo | responsabilidade numa frase | fonte (linhas de hoje) |
|---|---|---|
| `ui/telas/estado.js` | guarda o estado que a tela inteira lê (snapshot do SSE, escopo de conta, aba atual) e avisa quem depende dele | `STATE`, `SCOPE`, `CURRENT_TAB` e os `let` de topo correlatos |
| `ui/telas/registro.js` | guarda quais telas existem e o que cada uma faz ao entrar e ao chegar estado novo | novo |
| `ui/telas/infra.js` | fala com o engine (`api`, `get`) e com a pessoa (`toast`, modal de confirmação, operações em andamento) | 55-350 |
| `ui/telas/contas.js` | resolve identidade: de quem é cada PR, o que o escopo esconde e como a conta é marcada | 351-544 |
| `ui/telas/radar.js` | desenha o Radar: fila, panorama, decisões, resolvidos e a sub-navegação | 2439-2584, parte de 2180-2348 |
| `ui/telas/meus-prs.js` | desenha "Meus PRs" e a autoanálise, incluindo ocultar e o prompt de correção | 2585-2977 |
| `ui/telas/sessoes.js` | desenha o que está rodando agora: status do topo, cartões de sessão, feed e etapas | 2180-2348 |
| `ui/telas/chat.js` | desenha a conversa por PR | 2349-2438 |
| `ui/telas/entregas.js` | desenha a aba Entregas: filtros, busca, estatísticas e grupos | 2017-2179 |
| `ui/telas/consumo.js` | desenha a aba Consumo: séries, matriz, orçamento e o recorte por aparelho | 2978-3310 |
| `ui/telas/time.js` | desenha Destaques e Time | 3311-3452 |
| `ui/telas/sistema.js` | desenha a aba Sistema: sub-navegação, busca, saúde, preferências e novidades | 3453-3717, 1540-1628 |
| `ui/telas/sistema-contas.js` | edita contas, perfis de IA e orçamento na aba Sistema | 545-1032 |
| `ui/telas/sistema-jira.js` | edita sites do Jira e credencial | 1033-1275 |
| `ui/telas/sistema-sync.js` | edita a sincronização entre aparelhos | 1276-1470 |
| `ui/telas/reviewers.js` | edita reviewers padrão por org e exceções por repo | 3718-3987 |
| `ui/telas/ferramentas.js` | roda as ferramentas internas (kudos, diagnóstico, log) e exporta o diagnóstico | 3988-4140 |
| `ui/telas/acoes.js` | dispara as ações do usuário sobre PR e revisão (checar, revisar, decidir) | 4141-4300 |
| `ui/app.js` | bootstrap da página: assina o SSE, guarda o estado, troca de aba, `data-goto`, atalhos e paleta | o que sobra |

**Três decisões de fronteira que a medição forçou, e que não são gosto:**

1. **`sistema.js` se divide em quatro** (`sistema`, `sistema-contas`, `sistema-jira`,
   `sistema-sync`). A aba Sistema reivindica 74 dos 167 `#id` do arquivo, e a frase de
   responsabilidade de um módulo único precisaria de três "e também". É a mesma lição que na
   1a partiu `contas.js` em `contas` e `jira`.
2. **`sessoes.js` sai do Radar**, apesar de desenhar dentro do painel do Radar. O feed ao
   vivo é alimentado pelo evento `activity` do SSE, não pelo `state`, e tem ciclo de vida
   próprio; juntá-lo ao Radar faria o Radar mudar por dois motivos.
3. **`acoes.js` não é "o resto"**. São os disparadores que escrevem no engine, e eles são o
   lugar onde um erro custa caro (aprovar, revisar, cancelar). Ficam num arquivo que se lê
   inteiro de uma vez, em vez de espalhados pelas telas.

## Ordem das tarefas

1. as travas (leitores de fonte enxergam `ui/telas/`, contrato de aba, superfície do `app.js`)
2. a regra da dívida que muda de caminho já está em `docs/QUALITY.md` (Fase 1a): conferir
3. `registro.js`, com `switchTab` e `connect()` passando a percorrer o registro
4. `estado.js`, com o `STATE` saindo do escopo do `app.js`
5. `infra.js` (a camada que todos usam)
6. `contas.js`
7. `entregas.js` e `consumo.js` (as duas abas mais isoladas, que provam o mecanismo)
8. `sessoes.js`, `chat.js`, `radar.js`, `meus-prs.js`
9. `time.js`, `ferramentas.js`, `acoes.js`
10. `sistema.js`, `sistema-contas.js`, `sistema-jira.js`, `sistema-sync.js`, `reviewers.js`
11. fechar: o `app.js` só bootstrap, baseline do eng-behaviour, `ui/telas/README.md`, `CLAUDE.md`

---

### Task 1: as travas que tornam a quebra conferível

Antes de mover uma linha: os nove testes que leem o fonte do `app.js` ficariam cegos assim
que o trecho que eles afirmam mudar de arquivo, e cego é pior que vermelho (o piso de
contagem passa a medir o que sobrou, não o que a tela emite). É o mesmo defeito que a 1a
registrou em `test/helpers/fontes-ui.js`.

**Arquivos:**
- Modificar: `test/helpers/fontes-ui.js`
- Modificar: `test/ui-widgets.test.js`, `test/ui-contract.test.js`, `test/ui-semantics.test.js`,
  `test/ui-pure.test.js`, `test/reviewers-editor.test.js`, `test/settings-fonte-unica.test.js`,
  `test/rerevisar-head-velho.test.js`
- Criar: `test/ui-telas-contrato.test.js`

**Interfaces:**
- Consome: `arquivosDosPuros`/`fonteDosPuros` da Fase 1a.
- Produz: `fonteDasTelas()`, de que TODAS as tarefas seguintes dependem.

- [ ] **Passo 1: estender o varredor**

Em `test/helpers/fontes-ui.js`, acrescente, no mesmo idioma do que já existe:

```js
/**
 * Os arquivos da tela com DOM (ui/app.js e ui/telas/*.js), bootstrap primeiro:
 * `[{ nome, texto }]`. Mesmo motivo do `arquivosDosPuros`: teste preso a um arquivo fica
 * cego quando o trecho que ele afirma muda de módulo, e cego passa verde.
 */
function arquivosDasTelas() {
  const dir = path.join(RAIZ, 'ui', 'telas');
  const modulos = fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.js'))
      .map((e) => ({ nome: `telas/${e.name}`, texto: fs.readFileSync(path.join(dir, e.name), 'utf8') }))
    : [];
  return [{ nome: 'app.js', texto: fs.readFileSync(path.join(RAIZ, 'ui', 'app.js'), 'utf8') }, ...modulos];
}

/** Todo o código de tela com DOM concatenado, na ordem de leitura. */
function fonteDasTelas() {
  return arquivosDasTelas().map((a) => a.texto).join('\n');
}
```

E acrescente os dois ao `export`. O `fs.existsSync` não é zelo: `ui/telas/` só nasce na
Task 3.

- [ ] **Passo 2: trocar os leitores**

Nos sete testes listados, troque a leitura direta do `ui/app.js` por `fonteDasTelas()`. Nos
que hoje fatiam por índice (`test/rerevisar-head-velho.test.js:149`,
`test/ui-pure.test.js:2788`), a troca é literal: eles continuam procurando o mesmo trecho,
agora no texto concatenado.

**Exceção declarada:** `test/release-consistency.test.js` continua lendo **só** o `ui/app.js`.
Ele afirma sobre `RELEASE_NOTES`, que é dado do bootstrap e não muda de arquivo nesta fase;
lê-lo do concatenado enfraqueceria a trava sem ganho.

- [ ] **Passo 3: rodar e ver passar**

```bash
node --test --test-force-exit test/ui-widgets.test.js test/ui-contract.test.js test/ui-semantics.test.js test/ui-pure.test.js test/reviewers-editor.test.js test/settings-fonte-unica.test.js test/rerevisar-head-velho.test.js
```

Esperado: PASSA, com a mesma contagem de antes (nada mudou de lugar ainda).

- [ ] **Passo 4: contraprova do varredor**

Crie `ui/telas/zz-prova.js` com `// marcador-de-prova` e confirme que `fonteDasTelas()` o
inclui e continua incluindo o `app.js`:

```bash
node --input-type=module -e "const { fonteDasTelas } = await import('./test/helpers/fontes-ui.js'); const s = fonteDasTelas(); console.log(s.includes('marcador-de-prova'), s.includes('function connect()'));"
```

Esperado: `true true`. Apague o arquivo de prova em seguida (`rm`, não `git checkout`).

- [ ] **Passo 5: a trava do contrato de tela**

Crie `test/ui-telas-contrato.test.js`:

```js
// O contrato do diretório ui/telas: todo módulo de tela se registra, e nenhum importa o
// ui/app.js de volta. Import de volta é o ciclo que esta fase existe para evitar: em módulo
// ES ele não explode, o valor lido no topo vem undefined, e o sintoma é tela em branco com a
// suíte verde.
import test from 'node:test';
import assert from 'node:assert/strict';
import { arquivosDasTelas } from './helpers/fontes-ui.js';

test('nenhum modulo de ui/telas importa o ui/app.js', () => {
  const culpados = arquivosDasTelas()
    .filter((a) => a.nome !== 'app.js')
    .filter((a) => /from '\.\.\/app\.js'/.test(a.texto))
    .map((a) => a.nome);
  assert.deepEqual(culpados, [], 'modulo de tela importando o bootstrap de volta cria ciclo');
});

test('todo modulo de tela com aba se registra', () => {
  const semRegistro = arquivosDasTelas()
    .filter((a) => a.nome !== 'app.js' && /aoEntrar|aoEstado/.test(a.texto))
    .filter((a) => !/registrarTela\(/.test(a.texto))
    .map((a) => a.nome);
  assert.deepEqual(semRegistro, [], 'tela que declara aoEntrar/aoEstado precisa chamar registrarTela');
});
```

- [ ] **Passo 6: gate e commit**

```bash
npm run check && npm run lint && npm test
```

```bash
git add test/helpers/fontes-ui.js test/ui-telas-contrato.test.js test/ui-widgets.test.js test/ui-contract.test.js test/ui-semantics.test.js test/ui-pure.test.js test/reviewers-editor.test.js test/settings-fonte-unica.test.js test/rerevisar-head-velho.test.js
git commit -m "test: os leitores de fonte da UI enxergam ui/telas e o contrato de tela"
```

---

### Task 2: conferir a regra da dívida que muda de caminho

A Fase 1a já escreveu em `docs/QUALITY.md` ("Gate de ratchet", subseção "Dívida que muda de
caminho") a regra que esta fase vai usar em toda tarefa que mover código. Esta tarefa é de
conferência, não de escrita: se a seção não estiver lá, a fase para e ela é escrita antes.

- [ ] **Passo 1: conferir**

```bash
grep -n "Dívida que muda de caminho" docs/QUALITY.md
```

Esperado: uma ocorrência. Leia o parágrafo inteiro antes de seguir.

- [ ] **Passo 2: guardar a linha de base do ratchet**

```bash
git show HEAD:tools/quality/baseline.json > /tmp/baseline-inicio-1b.json
```

É contra este arquivo que a Task 11 vai provar que nenhuma regra subiu na fase inteira.

---

### Task 3: o registro de telas, e as duas funções que deixam de conhecer nome de aba

É a tarefa que quebra os sete ciclos. Nada se move ainda: o `app.js` continua com todo o
código, mas `switchTab` e `connect()` passam a falar com um registro.

**Arquivos:**
- Criar: `ui/telas/registro.js`
- Modificar: `ui/app.js`
- Modificar: `test/app-carrega.test.js`

**Interfaces:**
- Consome: as travas da Task 1.
- Produz: `registrarTela({ id, aoEntrar, aoEstado })` e `telasRegistradas()`, de que TODAS as
  tarefas de movimentação dependem.

- [ ] **Passo 1: escrever o registro**

Crie `ui/telas/registro.js`:

```js
// Quais telas existem e o que cada uma faz ao entrar e ao chegar estado novo.
//
// POR QUE EXISTE: até a Fase 1b o switchTab listava as abas pelo nome
// (`if (name === 'entregas') loadDeliveries()`) e o connect() listava os renderizadores,
// quinze chamadas em sequência. Com o código das abas em módulos, isso obrigaria o módulo a
// importar o bootstrap de volta, que é ciclo. Aqui a dependência é de mão única: a tela se
// declara, o bootstrap percorre.
const TELAS = new Map();

/**
 * @param {{ id: string, aoEntrar?: () => void, aoEstado?: () => void }} tela
 * `id` é o nome da aba (o `data-tab` do HTML), ou um nome próprio para tela sem aba.
 * `aoEntrar` roda quando a aba passa a ser a visível; `aoEstado`, a cada snapshot do SSE.
 */
function registrarTela(tela) {
  if (!tela || !tela.id) throw new Error('tela sem id');
  if (TELAS.has(tela.id)) throw new Error(`tela registrada duas vezes: ${tela.id}`);
  TELAS.set(tela.id, tela);
}

function telasRegistradas() { return [...TELAS.values()]; }

function telaPorId(id) { return TELAS.get(id) || null; }

export { registrarTela, telasRegistradas, telaPorId };
```

O `throw` em id repetido não é zelo: dois módulos registrando o mesmo id significaria uma
aba desenhada duas vezes por evento, que é justamente o defeito silencioso que esta fase pode
introduzir.

- [ ] **Passo 2: o `app.js` importa o registro e registra as telas de hoje**

No topo do `ui/app.js`, depois do import de `./pure.js`:

```js
import { registrarTela, telasRegistradas, telaPorId } from './telas/registro.js';
```

E, logo antes do `connect()` do fim do arquivo, registre as telas que hoje estão escritas à
mão no `switchTab` e no `connect()`, com as MESMAS funções, sem mudar nenhuma:

```js
// As telas ainda moram neste arquivo; a Fase 1b as move uma a uma, e cada uma leva o seu
// registro junto. O que muda AQUI é só quem conhece quem: o switchTab e o connect() passam
// a percorrer o registro em vez de listar nome de aba.
registrarTela({ id: 'entregas', aoEntrar: () => loadDeliveries() });
registrarTela({ id: 'destaques', aoEntrar: () => { loadHighlights(); renderTools(); } });
registrarTela({ id: 'time', aoEntrar: () => loadTeam() });
registrarTela({
  id: 'sistema',
  aoEntrar: () => { switchSistemaSection(); loadLog(); renderDoctor(); renderAccountsManager(); renderClaudeProfiles(); renderJiraSites(); renderSync(); loadReviewerCands(); },
  aoEstado: () => { if ($('#tab-sistema').classList.contains('active')) { renderDoctor(); renderAccountsManager(); renderClaudeProfiles(); renderJiraSites(); renderSync(); } },
});
registrarTela({
  id: 'consumo',
  aoEntrar: () => renderUsage(),
  aoEstado: () => { if ($('#tab-consumo').classList.contains('active')) renderUsage(); },
});
```

- [ ] **Passo 3: `switchTab` deixa de conhecer aba**

Troque as cinco linhas `if (name === ...)` de `switchTab` (1529-1533) por:

```js
  const tela = telaPorId(name);
  if (tela && tela.aoEntrar) tela.aoEntrar();
```

- [ ] **Passo 4: `connect()` deixa de conhecer aba**

No handler de `state` (4316-4317), troque os dois `if (...classList.contains('active'))` por:

```js
    for (const tela of telasRegistradas()) if (tela.aoEstado) tela.aoEstado();
```

As quinze chamadas de render que vêm antes (`renderStatus()`, `renderQueue()`, ...) **não
mudam nesta tarefa**: elas são do bootstrap e das telas que ainda não se moveram. Cada uma
vira `aoEstado` do seu módulo na tarefa que o move.

- [ ] **Passo 5: provar que a ordem não mudou**

Acrescente a `test/app-carrega.test.js`:

```js
test('trocar de aba chama o aoEntrar da tela registrada, uma vez so', () => {
  // o defeito que este teste pega: aba registrada duas vezes, ou aoEntrar chamado no
  // switchTab E no aoEstado, desenhando duas vezes por evento
  const painel = document.querySelector('#tab-entregas');
  assert.ok(painel, 'a aba Entregas existe no HTML');
  assert.equal(emitir('state', { ...ESTADO, config: { ...ESTADO.config, deliveriesEnabled: true } }), 1);
});
```

- [ ] **Passo 6: gate, tela e commit**

```bash
npm run check && npm run lint && npm test
```

Abra o app numa instância isolada em porta própria (a padrão costuma estar ocupada pelo
Farol real, lição 7 da 1a):

```bash
FAROL_HOME=/tmp/farol-fase1b node server.js
```

Escreva `{"port": 47185, "autoReview": false}` no `config.json` do `FAROL_HOME` antes de
subir. Navegue as seis abas e confira o console do navegador sem erro.

```bash
git add ui/telas/registro.js ui/app.js test/app-carrega.test.js
git commit -m "refactor(ui): registro de telas quebra o ciclo entre bootstrap e abas"
```

---

### Task 4: `estado.js`, o global que 109 funções leem

**Arquivos:**
- Criar: `ui/telas/estado.js`
- Modificar: `ui/app.js`

**Interfaces:**
- Consome: o registro da Task 3.
- Produz: `estado()`, `definirEstado()`, `escopo()`, `definirEscopo()`, `abaAtual()`, que
  todos os módulos seguintes importam em vez de ler global do `app.js`.

- [ ] **Passo 1: escrever o módulo**

Crie `ui/telas/estado.js`:

```js
// O estado que a tela inteira lê: o último snapshot do SSE, o escopo de conta e a aba atual.
//
// POR QUE EXISTE: 109 das 169 funções do ui/app.js liam variável de módulo (STATE em 68,
// SCOPE em 19). Com as telas em módulos, cada uma precisaria importar o bootstrap de volta
// só para ler STATE, que é o ciclo que a Fase 1b existe para evitar. Aqui a leitura é de mão
// única, e a escrita continua sendo só do bootstrap.
let STATE = null;
let SCOPE = 'all';
let ABA = 'radar';

const estado = () => STATE;
const escopo = () => SCOPE;
const abaAtual = () => ABA;

// Escrita: só o ui/app.js chama. Não há setter parcial de propósito, para não existirem
// dois donos do mesmo dado.
function definirEstado(novo) { STATE = novo; }
function definirEscopo(novo) { SCOPE = novo; }
function definirAba(nome) { ABA = nome; }

export { estado, escopo, abaAtual, definirEstado, definirEscopo, definirAba };
```

- [ ] **Passo 2: o `app.js` passa a usar o módulo**

Remova `let STATE = null;` (52), `let SCOPE = ...` (352) e `let CURRENT_TAB = ...` (354). No
lugar, importe do módulo e troque cada leitura por chamada. São 109 funções: faça em UMA
passada mecânica e confira pelo contador, não pelo olho:

```bash
node --input-type=module -e "
import fs from 'node:fs';
const s = fs.readFileSync('ui/app.js', 'utf8');
for (const g of ['STATE', 'SCOPE', 'CURRENT_TAB']) {
  const n = [...s.matchAll(new RegExp('\\\\b' + g + '\\\\b', 'g'))].length;
  console.log(g, n);
}"
```

Esperado ao fim da tarefa: zero para os três. `SCOPE` e `CURRENT_TAB` guardam valor de
`localStorage` na inicialização; essa leitura passa para o `app.js`, que chama
`definirEscopo` no boot.

- [ ] **Passo 3: gate, tela e commit**

Rode o gate, abra o app, navegue as seis abas, troque de escopo de conta e confira que a
barra de contas filtra o Radar como antes.

```bash
git add ui/telas/estado.js ui/app.js
git commit -m "refactor(ui): o estado da tela sai do escopo do app.js"
```

---

### Task 5: `infra.js`, a camada que todos usam

**Arquivos:**
- Criar: `ui/telas/infra.js`
- Modificar: `ui/app.js`, `test/app-carrega.test.js`

**Interfaces:**
- Consome: `estado.js`.
- Produz: `api`, `get`, `toast`, `confirmModal`, `showOp`, `updateOp`, `closeOp`, que TODAS
  as tarefas seguintes importam.

- [ ] **Passo 1: mover o bloco 55-350**

Mova `$` (24), `api` (56), `get` (63), `toastBase` (65), `toastRich` (81), `toast` (73),
`confirmModal` (90), e o bloco inteiro de operações (113-350: `showOp`, `updateOp`,
`closeOp`, `updateOpDisplay`, `formatDuration`, `syncAnalysisOps`, `ACTIVE_OPS` e as tabelas
`TEXTO_DA_LISTA_VAZIA`, `ICONE_DA_OPERACAO`, `DIMENSAO_DO_CONSUMO`), com os comentários que
os precedem.

**Atenção ao único export de hoje:** `ui/app.js:73` tem `export function toast`, e
`test/app-carrega.test.js` chama `UI.toast`. O `app.js` passa a reexportar:

```js
export { toast } from './telas/infra.js';
```

Sem isso o teste que EXECUTA a tela quebra, e ele é a única rede que roda o arquivo de
verdade.

- [ ] **Passo 2: derivar os imports do uso, nunca escrevê-los à mão**

Lição 3 da execução da 1a: adivinhar a lista de imports quebrou duas vezes. Derive com o
tokenizador do ratchet:

```bash
node --input-type=module -e "
import fs from 'node:fs';
import { strip } from './tools/quality/strip.js';
const modulo = strip(fs.readFileSync('ui/telas/infra.js', 'utf8'));
const puros = Object.keys(await import('./ui/pure.js'));
console.log(puros.filter((n) => new RegExp('\\\\b' + n + '\\\\b').test(modulo)).join(', '));"
```

O que sair é o import de `./pure.js` do módulo novo.

- [ ] **Passo 3: gate, tela e commit**

```bash
npm run check && npm run lint && npm test
```

```bash
git add ui/telas/infra.js ui/app.js test/app-carrega.test.js
git commit -m "refactor(ui): infra da tela (api, toast, operacoes) sai do app.js"
```

---

### Task 6: `contas.js`

Mesmo roteiro da Task 5, com o bloco 351-544: `rebuildAccounts`, `multiAccount`, `prUser`,
`acctOf`, `isMutedPr`, `scopeVisible`, `dimmedPr`, `acctMark`, `acctUserFromUrl`,
`scopeMemVisible`, `acctStyleFor`, `memGroupHead`, `attentionCount`, `renderAccountBar`,
`renderIdentity`, `renderSilenced`, `rerenderScope`, `TWEAK`, `ACCT`, `OWNER2USER`.

`renderAccountBar`, `renderIdentity` e `renderSilenced` viram `aoEstado` do módulo.
`rerenderScope` chama `renderMyPRs`, que ainda mora no `app.js`: nesta tarefa ele chama por
parâmetro (o módulo recebe a função no registro), e a Task 8 fecha isso quando `meus-prs.js`
existir.

- [ ] Passos 1 a 3 iguais aos da Task 5, trocando o bloco e o nome do módulo.
- [ ] Commit: `refactor(ui): camada de contas sai do app.js`

---

### Task 7: `entregas.js` e `consumo.js`

As duas abas mais isoladas (grau de saída 3 e 2 no grafo medido), e é por isso que elas vêm
primeiro entre as telas: provam o mecanismo do registro antes das abas emaranhadas.

- [ ] **Passo 1: `entregas.js`** com 2017-2179, incluindo os oito `let deliveries*` e as seis
  ligações `$('#deliv*')`. O módulo se registra com `aoEntrar: () => loadDeliveries()`.
- [ ] **Passo 2: `consumo.js`** com 2978-3310, incluindo `usageHoverIdx`, `wireUsageControls`
  e o recorte por aparelho. Registra `aoEntrar` e `aoEstado`.
- [ ] **Passo 3:** os dois módulos importam `marcarSeg` do `app.js`? **Não.** `marcarSeg`
  (1512) é helper de segmentado usado por três telas: mova-o para `infra.js` nesta tarefa, e
  registre a mudança no commit.
- [ ] **Passo 4:** gate, tela (abrir as duas abas, trocar período e filtro), commit.
- [ ] Commit: `refactor(ui): abas Entregas e Consumo viram modulos de ui/telas`

---

### Task 8: `sessoes.js`, `chat.js`, `radar.js` e `meus-prs.js`

- [ ] **Passo 1: `sessoes.js`** (2180-2348, menos o que for do Radar): `renderStatus`,
  `tickCountdown`, `tickElapsed`, `updateStageFlow`, `updateSessionAgents`, `fillFeed`,
  `sessionVisible`, `updateSessionBar`, `renderActive`. O `setInterval(tickCountdown, 1000)`
  (2246) vai junto, dentro do módulo.
- [ ] **Passo 2: `chat.js`** (2349-2438) com `chatKey`, `chatUrl`, `openChat`, `closeChat`,
  `renderChat` e as cinco ligações `$('#chat*')`. O handler `chat-activity` do SSE continua no
  `app.js` e chama o módulo.
- [ ] **Passo 3: `radar.js`** (2439-2584 mais `renderRadarNav` e `switchRadarSub`, 618-630).
- [ ] **Passo 4: `meus-prs.js`** (2585-2977). É o maior bloco do arquivo (393 linhas): se o
  módulo passar de 400 linhas úteis, ele são dois (`meus-prs` e `autoanalise`), e a decisão se
  toma aqui, com a frase de responsabilidade na mão.
- [ ] **Passo 5:** fechar o pendente da Task 6: `rerenderScope` passa a chamar `meus-prs.js`
  pelo registro, e o parâmetro temporário sai.
- [ ] Gate, tela (Radar inteiro: fila, panorama, meus PRs, decisões, sessão ao vivo, chat),
  commit por módulo.

---

### Task 9: `time.js`, `ferramentas.js` e `acoes.js`

- [ ] **Passo 1: `time.js`** (3311-3452): destaques e time.
- [ ] **Passo 2: `ferramentas.js`** (3988-4140): kudos, diagnóstico, log, som e notificação.
  **Atenção ao ciclo medido** `ferramentas <-> sse`: `ping()` chama `connect()`. Ao mover,
  `ping` NÃO leva o `connect` junto; o módulo recebe do registro o que precisa, e `connect`
  fica no bootstrap, que é o dono do SSE.
- [ ] **Passo 3: `acoes.js`** (4141-4300), incluindo `settingsMap` e as onze ligações
  `$('#btn*')`. `test/settings-fonte-unica.test.js` afirma sobre `settingsMap`: ele já lê o
  concatenado desde a Task 1, então não muda.
- [ ] Gate, tela, commit por módulo.

---

### Task 10: a aba Sistema em quatro módulos, e `reviewers.js`

É a maior parte do arquivo e a que tem mais `#id` (74 dos 167). A ordem é de baixo para cima,
para nenhum módulo precisar de outro que ainda não existe.

- [ ] **Passo 1: `sistema-jira.js`** (1033-1275).
- [ ] **Passo 2: `sistema-sync.js`** (1276-1470), com `syncRascunho` e os seis helpers dele.
- [ ] **Passo 3: `sistema-contas.js`** (545-1032): gerenciador de contas, perfis de IA e o
  editor de orçamento.
- [ ] **Passo 4: `reviewers.js`** (3718-3987).
- [ ] **Passo 5: `sistema.js`** (3453-3717 mais a sub-navegação 1540-1628): `renderDoctor`,
  `renderSettings`, `renderAutomationSettings`, `renderUpdate`, `renderReleaseNotes`,
  `renderAbout`, `switchSistemaSection`, `SYS_INDEX`, `sysSearchFilter`, `sysGoTo`, `sysFlash`.
  O `aoEntrar` da tela Sistema, escrito à mão na Task 3, passa a ser deste módulo.
- [ ] **Passo 6:** `RELEASE_NOTES` (3491-3682) **fica no `app.js`**? Não: ele vai para
  `ui/telas/novidades.js`, como dado próprio, exatamente como diz a condição de fechamento do
  `ui/app.js` em `docs/QUALITY.md`. `test/release-consistency.test.js` passa a ler esse
  arquivo, e a exceção declarada na Task 1 se resolve aqui, no mesmo commit.
- [ ] Gate, tela (as seis seções do Sistema, a busca, o editor de reviewers), commit por módulo.

---

### Task 11: fechar a fase

**Arquivos:**
- Modificar: `ui/app.js`, `tools/eng-behaviour/baselines.json`, `docs/QUALITY.md`, `CLAUDE.md`
- Criar: `ui/telas/README.md`

- [ ] **Passo 1: conferir o que sobrou no `app.js`**

```bash
grep -vE "^\s*(//|$)" ui/app.js | wc -l
```

Esperado: o bootstrap, e nada de tela. Leia o arquivo inteiro de uma vez: se não couber na
cabeça, a fase não terminou.

- [ ] **Passo 2: o `ui/telas/README.md`**, no idioma do `ui/pure/README.md`: o que entra
  (código que toca DOM e lê estado), o que não entra (função pura vai para `ui/pure/`), como é
  carregado (um `<script type="module">` só, o `app.js` importa as telas), o contrato do
  registro e a proibição de importar o `app.js` de volta.

- [ ] **Passo 3: provar que o total do ratchet não subiu na fase inteira**

```bash
node --input-type=module -e "
import fs from 'node:fs';
const soma = (b) => Object.values(b).reduce((acc, regras) => {
  for (const [r, n] of Object.entries(regras)) acc[r] = (acc[r] || 0) + n;
  return acc;
}, {});
const antes = soma(JSON.parse(fs.readFileSync('/tmp/baseline-inicio-1b.json', 'utf8')));
const agora = soma(JSON.parse(fs.readFileSync('tools/quality/baseline.json', 'utf8')));
for (const r of new Set([...Object.keys(antes), ...Object.keys(agora)])) {
  const a = antes[r] || 0, b = agora[r] || 0;
  console.log((b > a ? 'SUBIU  ' : b < a ? 'desceu ' : 'igual  ') + r + ': ' + a + ' -> ' + b);
}"
```

Nenhuma linha pode sair como `SUBIU`.

- [ ] **Passo 4: tirar o `ui/app.js` do baseline do eng-behaviour**

Só se a condição de fechamento estiver cumprida: "fica só o bootstrap da página (SSE, estado
global, troca de aba, `data-goto`); cada aba vira módulo ES importado por ele, e
`RELEASE_NOTES` vira dado próprio". Remova
`"core.file.single-responsibility|ui/app.js|violacao"` e baixe `currentFindings` de 14 para
13. **Não mexa em `initialFindings`.**

```bash
node --test --test-force-exit test/eng-behaviour-baseline.test.js
```

- [ ] **Passo 5: registrar em `docs/QUALITY.md` e no `CLAUDE.md`**

No `docs/QUALITY.md`, a linha do `ui/app.js` sai da tabela e vira registro de resolvido, ao
lado do do `ui/pure.js`. No `CLAUDE.md`, a linha do `ui/app.js` no "Mapa de arquivos" passa a
descrever o bootstrap, e entra uma linha para `ui/telas/`.

- [ ] **Passo 6: avaliação do eng-behaviour, gate e PR**

A avaliação de `core.file.single-responsibility` é **`conforme`** para o `ui/app.js`, e é ela
que autoriza o passo 4; o gate deve imprimir `resolvido
core.file.single-responsibility|ui/app.js|violacao`.

```bash
npm run check && npm run lint && npm test && npm run eng
```

```bash
git add ui/app.js ui/telas/README.md tools/eng-behaviour/baselines.json docs/QUALITY.md CLAUDE.md
git commit -m "refactor(ui): app.js vira bootstrap e sai da divida de responsabilidade unica"
git push -u origin HEAD
gh pr create --fill --assignee wandersonaadsantos
```

---

## Verificação final da fase

| o que | como | esperado |
|---|---|---|
| a tela executa | `node --test test/app-carrega.test.js` | mesma contagem, `fail 0` |
| nada de comportamento mudou | `npm test` | 2856 mais os testes novos da Task 1 e 3, `fail 0` |
| nenhum ciclo nasceu | `node --test test/ui-telas-contrato.test.js` | 2 testes, 0 falhas |
| a dívida mecânica não subiu | o script do passo 3 da Task 11 | nenhuma linha `SUBIU` |
| a dívida de arquitetura desceu | `npm run eng` | `resolvido ... ui/app.js`, `currentFindings` 13 |
| a tela funciona | abrir o app e navegar as seis abas e as seis seções do Sistema | sem erro no console, sem área em branco |
| a distribuição continua íntegra | `powershell -File tools\make-package.ps1` | `pacote limpo`; `ui/` é espelhada inteira, então `ui/telas/` viaja sem tocar nas seis listas |

**Por que a instalação a partir do zip não é exigida aqui:** `ui` já é uma das pastas que os
instaladores espelham, e a cópia é recursiva. Subpasta DENTRO de `ui/` viaja junto. O que
exigiria instalação real é pasta nova na RAIZ, que esta fase não cria. Ainda assim, confira
que o zip tem `ui/telas/`:

```bash
powershell -NoProfile -Command "(Get-ChildItem dist/farol-v*.zip | Select-Object -Last 1) | ForEach-Object { [IO.Compression.ZipFile]::OpenRead($_.FullName).Entries | Where-Object { $_.FullName -like 'ui/telas/*' } | Measure-Object | Select-Object -ExpandProperty Count }"
```

Esperado: o número de módulos criados.

## O que esta fase deliberadamente NÃO faz

- **Não toca no `ui/app.css`.** É a Fase 1c.
- **Não muda `ui/index.html`.** Um `<script type="module">` só, como hoje.
- **Não acrescenta função nova nem muda assinatura de função pura.** Símbolo novo em módulo
  novo é feature, não reorganização; o registro e o módulo de estado são a exceção declarada,
  e existem para quebrar o ciclo.
- **Não mexe nas seis listas de distribuição.** Nada de novo na raiz.
- **Não resolve a dívida de `server.js`** nem a dos arquivos de `lib/`. É a Fase 4.

## Medição

Os números da linha de base saíram destes scripts, rodados em `5a59c50`:

- **funções, globais e seções:** varre o `ui/app.js`, casa `^function`/`^async function`,
  fecha cada função no início da seguinte, e conta quais corpos citam cada global mutável.
- **dono de cada `#id`:** casa `<section id="tab-...">` no `ui/index.html`, delimita cada
  painel até o próximo, e classifica cada `$('#id')` do `app.js` pelo painel em que o id mora.
- **grafo entre candidatos a módulo:** agrupa as funções pelas faixas de linha das seções e
  registra aresta quando o corpo de uma cita o nome de outra; pares mútuos são os ciclos.

Rode-os de novo antes de começar: se a `main` andou, os números mudam, e é a medição da sua
máquina que vale.

## Registro da execução (16/09/2026)

A fase foi executada tarefa a tarefa, com a suíte, o ratchet e a tela conferidos a cada
passo. O `ui/app.js` fechou em 367 linhas de bootstrap, `ui/telas/` ganhou 30 módulos, a
suíte foi a 2866 testes com `fail 0`, e nenhuma regra do ratchet mecânico subiu na fase
inteira (`profundidadeExcedida` 81 para 80, `ternarioAninhado` 74 para 63, `maxLines` 6 para
5). O que a execução corrigiu no plano:

1. **A medição do plano errou um ciclo.** O plano anunciava sete pares mútuos; um deles,
   `ferramentas <-> sse`, era falso positivo: o `connect` que `ping()` chama é o do Web Audio
   (`o.connect(g).connect(audioCtx.destination)`), não o `connect()` do SSE. O script de
   grafo casava identificador nu, sem distinguir de que objeto o método vinha. Eram seis.
2. **A divisão real ficou maior que a planejada:** 19 módulos previstos, 30 entregues. Toda
   vez que a frase de responsabilidade de um módulo previsto pediu um "e também", o arquivo
   virou dois: contas e perfis de IA; ferramentas e avisos (som e notificação são reação a
   evento, não ferramenta); e a aba Sistema, que virou cinco (sub-navegação e busca,
   atualização, automação, ambiente, sobre). A mesma lição da Fase 1a se repetiu, agora em
   escala maior.
3. **A injeção de dependência resolveu o ciclo, mas criou dívida medida.** Embrulhar
   listeners em `function iniciarX(deps) { ... }` acrescenta um nível de aninhamento e fez
   `profundidadeExcedida` subir de 81 para 89 numa versão intermediária, com o `lint` verde
   só porque o teto de arquivo novo foi subido à mão. A forma correta, que ficou: handler
   nomeado no topo do módulo, dependências guardadas em variável de módulo (dono de escrita
   único), e a função de inicialização só registra. É a forma documentada em
   `ui/telas/README.md`.
4. **O fecho exigiu uma extração a mais do que o plano previa.** Com as dez tarefas do plano
   concluídas, o `ui/app.js` ainda tinha paleta, atalhos, caixa de revisão, tema, e gatilhos
   de outras telas. Avaliar `core.file.single-responsibility` como `conforme` naquele ponto
   teria sido falso: cada um desses blocos é um assunto que muda por motivo próprio.
5. **Símbolo que entra na superfície congelada tem que nascer na forma final.**
   `genProfileId` entrou chamando `Date.now()` e `Math.random()` inline e com nome que
   mentia (gera id de site do Jira também, não só de perfil); virou `genId(agora, aleatorio)`
   na mesma entrega, porque depois do congelamento renomear custa caro.
6. **As travas novas pegaram defeito real.** O guarda de import morto, generalizado para todo
   arquivo de tela, achou três imports mortos antigos (`repoMention`, `prRefMention`, `selo`).
   O guarda de menção escrita à mão, que estava cego para o markup movido, voltou a cobrir os
   cards de PR.
7. **Uma mudança de comportamento declarada.** A confirmação de "Pedir mudanças" da paleta de
   comando estava duplicada e divergente da do card, e passou a mostrar o parágrafo "o PR fica
   bloqueado até o autor tratar" que faltava.
8. **Defeito pré-existente reportado e não corrigido.** `orgToUser`, em
   `renderReviewersEditor` (`ui/telas/reviewers.js`), é montado e nunca lido. Fora de escopo
   desta fase (não é reorganização, é bug), fica registrado para tratar à parte.
9. **Limitação do ambiente de prova.** O navegador embutido usado na conferência não executa
   `scrollIntoView` com `behavior: 'smooth'`, então a busca do Sistema parece não rolar;
   medido igual na `main`, com o corpo de `sysGoTo` byte a byte idêntico. Não é defeito do
   app, é limitação do ambiente de teste manual.
