# Reorganização estrutural, Fase 1a: quebrar o `ui/pure.js`

> **Para quem executa:** use `superpowers:subagent-driven-development` (recomendado) ou
> `superpowers:executing-plans`, tarefa a tarefa. Os passos usam caixa (`- [ ]`).

**Goal:** transformar `ui/pure.js` (3498 linhas, 174 exports) num arquivo que só reexporta
módulos de `ui/pure/`, cada um com uma responsabilidade que cabe numa frase, sem mudar
uma linha de comportamento nem a superfície pública.

**Architecture:** o `ui/pure.js` vira fachada (`export * from './pure/<modulo>.js'`), o que
mantém intactos os 13 testes que importam dele e o import único do `ui/app.js`. Os módulos
nascem em camadas, de baixo para cima: `comum` (sem dependência), `mencoes` (só `comum`) e
os módulos de domínio (dependem dos dois de baixo). O grafo de funções do arquivo hoje é
**acíclico** (medido), e a ordem das tarefas preserva isso.

**Tech Stack:** módulo ES nativo servido pelo próprio servidor do Farol, `node --test`,
zero dependências novas (invariante 1). Sem bundler, sem transpilador.

**Spec:** [`docs/superpowers/specs/2026-09-14-reorganizacao-estrutural-design.md`](../specs/2026-09-14-reorganizacao-estrutural-design.md)

## Por que esta fase é 1a, e não a Fase 1 inteira

A spec descreve a Fase 1 com três entregas: quebrar o `ui/pure.js`, quebrar o `ui/app.js` e
fatiar o `ui/app.css`. A medição de 15/09/2026 mostrou que são três entregas com riscos e
redes de segurança diferentes, e que juntá-las num plano só produziria um PR impossível de
revisar:

| entrega | o que a medição achou |
|---|---|
| **1a, `ui/pure.js`** (este plano) | arquivo de funções puras, sem estado de módulo, sem import, grafo interno acíclico. Os testes que dependem dele **importam** (13 arquivos), e a fachada de reexport os mantém verdes sem tocar em nenhum |
| **1b, `ui/app.js`** | tem bootstrap espalhado do começo ao fim (10 efeitos no topo do módulo, incluindo `connect()` do SSE e 56 ligações a `$('#id')`), `STATE` lido em 163 pontos, e pelo menos 9 testes que **recortam funções do fonte por regex de bloco**. Precisa de plano próprio |
| **1c, `ui/app.css`** | 1696 linhas com dependência de ordem provada (variáveis no `:root`, tema claro sobrescrevendo por posição, `@media` intercalados em 14 pontos). Precisa de plano próprio |

A Fase 1b depende desta: com o `pure.js` quebrado, o import de ~75 nomes no topo do
`app.js` passa a poder ser repartido por módulo.

## Global Constraints

Valem em toda tarefa, sem exceção:

- **Zero dependências além do Electron.** Nenhum pacote npm, bundler ou transpilador.
- **Nada de mudança de comportamento.** Move-se código; não se reescreve lógica. A única
  exceção é a Task 2, que é declarada e provada pela suíte.
- **A superfície pública não muda.** Nenhum dos 174 nomes exportados pode sumir, mudar de
  grafia ou trocar de significado. A Task 1 instala a trava disso.
- **Texto em português, sem travessão.** Vírgula, parênteses ou dois pontos.
- **Sem atribuição de IA** em commit ou PR.
- **Cada módulo novo fica abaixo de 400 linhas úteis.** Não é estética: `maxLines` do
  ratchet mecânico dispara em 400, e arquivo novo tem teto zero (ver "O ratchet" abaixo).
  Domínio que não couber é sinal de que ele são dois.
- **Gate por tarefa:** `npm run check && npm run lint && npm test` verde. Antes do push,
  `npm run eng`, com as avaliações de julgamento escritas para o head final pelo roteiro de
  `docs/QUALITY.md` (`repositoryId` = `farol`).
- **Caminho até a `main`:** branch, PR, CI verde, merge. Sem push direto, sem bypass.

## O ratchet mecânico, e por que ele manda na ordem das tarefas

`tools/quality/gate.js` compara violação por **arquivo**, e arquivo ausente da baseline vale
**zero** (`gate.js:44`). Hoje `ui/pure.js` carrega `ternarioAninhado: 16`, `jsonParseCru: 1`
e `maxLines: 1` (`tools/quality/baseline.json:115-119`). Mover um símbolo com ternário
aninhado para `ui/pure/review.js` cria uma violação nova num caminho com teto zero, e o
gate reprova com "subiu de 0 pra N". A baseline nunca sobe à mão.

Daí a ordem: a **Task 2 reparticiona a dívida mecânica junto com o código**, e a **Task 4**
resolve o `JSON.parse` declarando o parser único da UI como santuário, do mesmo jeito que
`lib/io.js` já é (`tools/quality/rules.js:16`).

> **Correção de 15/09/2026, medida durante a execução.** A primeira versão deste plano
> mandava **zerar** os ternários aninhados antes de mover, supondo que fossem 16 ternários
> aninhados de verdade. A medição do que o contador de fato acusa (11 statements hoje, não
> 16) mostrou que ele é **mais cru que a regra do catálogo**: ele quebra o arquivo por `;` e
> conta `?` por statement, então acusa também ternário dentro de template literal, cujo pai
> não é outro ternário e que a regra hard `core.javascript.no-nested-ternary` (que lê a
> árvore sintática) **não** acusa. Casos reais deste arquivo: o rótulo de
> `ROTULO_DOS_PONTOS` (2405-2409), que é uma tabela de três funções com um plural cada, e
> `rotuloDosPontos` (2412). Zerar o contador exigiria contorcer código legítimo por causa de
> métrica, que é exatamente o que `docs/QUALITY.md` condena ao declarar a divergência do
> `maxLines`. Então a dívida **muda de caminho junto com o código**, do mesmo jeito que a
> assinatura do baseline do eng-behaviour acompanha um arquivo movido, e o que se prova é
> que **o total por regra não sobe**.

**Como provar que o total não subiu** (roda em toda tarefa que mover código, depois do
`npm run lint:update`):

```bash
node --input-type=module -e "
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const soma = (b) => Object.values(b).reduce((acc, regras) => {
  for (const [r, n] of Object.entries(regras)) acc[r] = (acc[r] || 0) + n;
  return acc;
}, {});
const antes = soma(JSON.parse(execSync('git show HEAD:tools/quality/baseline.json', { encoding: 'utf8' })));
const agora = soma(JSON.parse(fs.readFileSync('tools/quality/baseline.json', 'utf8')));
for (const r of new Set([...Object.keys(antes), ...Object.keys(agora)])) {
  const a = antes[r] || 0, b = agora[r] || 0;
  console.log((b > a ? 'SUBIU  ' : b < a ? 'desceu ' : 'igual  ') + r + ': ' + a + ' -> ' + b);
}
"
```

Nenhuma linha pode sair como `SUBIU`. `desceu` é bem-vindo e `igual` é o esperado numa
movimentação pura.

## Linha de base medida (15/09/2026, `144b0c1`, Windows, Node 24)

| medida | valor |
|---|---|
| `npm test` | 2834 testes, 2812 pass, **0 fail**, 22 skipped |
| `ui/pure.js` | 3498 linhas, 174 exports, zero import, zero `let` de módulo |
| grafo interno | acíclico (DFS sobre o grafo completo) |
| testes que **importam** `ui/pure.js` | 13 |
| testes que **leem o fonte** de `ui/pure.js` | 2 (`ui-contract.test.js:81`, `ui-widgets.test.js:463`) |

Compare sempre contra a contagem da SUA máquina, medida antes de começar: há testes que só
rodam em POSIX.

## File Structure

Módulos criados em `ui/pure/`, nesta camada (a seta é "depende de"):

```
comum.js  <-  mencoes.js  <-  { radar, review, consumo, entregas, sistema,
                                contas, meus-prs, sessao, sync, fila-justa }
```

| arquivo | responsabilidade numa frase | fonte |
|---|---|---|
| `ui/pure/comum.js` | formata e transforma valor solto (texto, número, data, duração) sem saber de que tela veio | grupo A + `listViewState`, `aprovadosHoje`, `usageDayKeysBack` |
| `ui/pure/mencoes.js` | transforma pessoa, repo, PR e sessão em menção navegável | grupo B |
| `ui/pure/sessao.js` | desenha a sessão de revisão ao vivo (etapas, feed, agentes, progresso) | grupo L |
| `ui/pure/sync.js` | desenha a sincronização entre dispositivos | grupo J |
| `ui/pure/fila-justa.js` | desenha o rodízio de fila entre orgs e contas | grupo K |
| `ui/pure/consumo.js` | desenha a aba Consumo (séries, matriz, orçamento, sessões) | grupo C |
| `ui/pure/entregas.js` | desenha a aba Entregas (filtros, buckets, estatística, grupos) | grupo I |
| `ui/pure/review.js` | desenha decisão, revisão e pushback | grupo H, menos os dois abaixo |
| `ui/pure/pessoas.js` | desenha perfil de pessoa (papel, matriz por domínio) e editor de reviewers | grupo H, sub-blocos de 1895-2004 e 2296-2335 |
| `ui/pure/autoanalise.js` | desenha o parecer de autoanálise dos meus PRs | grupo H, 2958-3027 |
| `ui/pure/radar.js` | desenha os cards da fila e do panorama | grupo G, menos `aprovadosHoje` |
| `ui/pure/meus-prs.js` | desenha "Meus PRs": ocultos, merge e vazio | grupo F, menos `listViewState` |
| `ui/pure/contas.js` | desenha contas, perfis do Claude e orçamento | grupo E |
| `ui/pure/sistema.js` | desenha a aba Sistema: log agrupado, checks, diagnóstico e créditos | grupo D |
| `ui/pure.js` | fachada: só reexporta | o que sobra |

**Três decisões de fronteira que a medição forçou, e que não são gosto:**

1. **`fmtMoney` (2031) e `escAttrSelector` (2012) vão para `comum.js`**, apesar de morarem
   fisicamente dentro do bloco do Consumo. Eles são consumidos por Contas, Orçamento e pelos
   checks do Sistema; deixá-los em `consumo.js` faria o Sistema depender do Consumo por
   acidente de posição.
2. **`aprovadosHoje` (626) e `usageDayKeysBack` (609) vão para `comum.js`**, no bloco de
   datas onde já moram. `aprovadosHoje` é o que impediria o ciclo: `sessionProgress`
   (`sessao`) o chama, e `radar` também; se ele fosse para `radar.js`, nasceria
   `radar -> review -> sessao -> radar`.
3. **`sessionRefCell` (840) fica em `mencoes.js`**, com os primitivos que ela usa, mesmo
   sendo a célula de uma coluna da aba Consumo. `consumo.js` depende de `mencoes.js`, e a
   direção contrária não existe.

## Ordem das tarefas

1. as travas (superfície, servidor, leitores de fonte)
2. zerar os ternários aninhados
3. o diretório e a fachada, com o primeiro módulo trivial
4. `comum.js` (e o santuário do parser)
5. `mencoes.js`
6. `sessao.js`, `sync.js`, `fila-justa.js`
7. `consumo.js`
8. `entregas.js`
9. `review.js`, `pessoas.js`, `autoanalise.js`
10. `radar.js`, `meus-prs.js`
11. `contas.js`, `sistema.js`
12. fechar: `pure.js` só reexporta, baseline do eng-behaviour, registro no CLAUDE.md

---

### Task 1: as três travas que tornam a quebra conferível

Antes de mover uma linha, três coisas precisam de rede: a superfície pública (174 nomes que
não podem sumir), a entrega do arquivo pelo servidor (subpasta de `ui/` nunca foi servida em
teste) e os dois testes que leem o fonte do `pure.js` e ficariam cegos.

**Arquivos:**
- Criar: `test/ui-pure-superficie.test.js`
- Modificar: `test/http.test.js` (acrescentar um teste ao fim)
- Modificar: `test/ui-contract.test.js:81`
- Modificar: `test/ui-widgets.test.js:463`

**Interfaces:**
- Consome: nada.
- Produz: `ui/pure/` reconhecido pelos leitores de fonte, e a trava de superfície de que
  TODAS as tarefas seguintes dependem.

- [ ] **Passo 1: gerar a lista da superfície atual**

```bash
node -e "import('./ui/pure.js').then(m=>console.log(Object.keys(m).sort().map(n=>'  '+JSON.stringify(n)+',').join('\n')))"
```

Guarde a saída: ela entra no arquivo do passo 2. Espere 174 linhas.

- [ ] **Passo 2: escrever a trava de superfície**

Crie `test/ui-pure-superficie.test.js`:

```js
// A superfície pública do ui/pure.js é o contrato com o ui/app.js (que importa dezenas de
// nomes num import só) e com os 13 testes que importam daqui. Durante a quebra em
// ui/pure/*.js, nenhum nome pode sumir nem mudar de grafia: a tela quebraria em runtime
// com a suíte possivelmente verde, porque quase nenhum teste chama TODOS os nomes.
//
// Esta lista é CONGELADA de propósito, e é a única do repositório que não deriva do fonte:
// derivar do próprio arquivo que ela protege a tornaria vazia (ela casaria consigo mesma
// depois de qualquer perda). Nome sai daqui só com motivo declarado no commit.
import test from 'node:test';
import assert from 'node:assert/strict';

const CONGELADA = [
// COLE AQUI a saída do passo 1
];

test('o ui/pure.js exporta exatamente a superficie congelada', async () => {
  const modulo = await import('../ui/pure.js');
  const atual = Object.keys(modulo).sort();
  const sumiram = CONGELADA.filter((n) => !atual.includes(n));
  const nasceram = atual.filter((n) => !CONGELADA.includes(n));
  assert.deepEqual(sumiram, [], 'sumiram nomes da superficie publica do ui/pure.js');
  assert.deepEqual(nasceram, [], 'nomes novos na superficie: acrescente a lista congelada no mesmo commit');
});

test('todo nome exportado e usavel, nao so declarado', async () => {
  // reexport quebrado (arquivo que não existe, nome com grafia errada no `export *`)
  // aparece aqui como undefined, e não como ausência de chave.
  const modulo = await import('../ui/pure.js');
  const indefinidos = CONGELADA.filter((n) => modulo[n] === undefined);
  assert.deepEqual(indefinidos, [], 'nomes exportados com valor undefined');
});
```

- [ ] **Passo 3: rodar e ver passar**

```bash
node --test --test-force-exit test/ui-pure-superficie.test.js
```

Esperado: PASSA, 2 testes.

- [ ] **Passo 4: contraprova da trava de superfície**

Comente a linha `export function plural(` do `ui/pure.js:470` trocando por
`function plural(` (sem `export`) e rode o teste.

Esperado: FALHA com `sumiram nomes da superficie publica do ui/pure.js`. Desfaça com
`git checkout ui/pure.js`.

- [ ] **Passo 5: provar que o servidor entrega subpasta de `ui/`**

O `lib/http-server.js:186-193` resolve estático por caminho sob `UI_DIR`. Isso nunca foi
testado com subpasta, e a quebra inteira depende disso. Acrescente ao FIM de
`test/http.test.js`:

```js
/* A quebra do ui/pure.js em ui/pure/*.js depende de o servidor entregar arquivo em
   SUBPASTA de ui/ com o tipo de módulo ES. O navegador carrega o app por
   <script type="module">, e um 404 aqui quebraria a tela inteira com a suíte verde. */
test('GET de arquivo em subpasta de ui/ e servido como modulo ES', async () => {
  const dir = path.join(UI_DIR, 'prova-subpasta');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'modulo.js'), 'export const x = 1;\n');
  try {
    const r = await get('/prova-subpasta/modulo.js');
    assert.equal(r.status, 200, 'subpasta de ui/ precisa ser servida');
    assert.match(r.type, /text\/javascript/, 'modulo ES precisa do tipo javascript');
    assert.match(r.body, /export const x/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GET fora de ui/ continua recusado', async () => {
  const r = await get('/../package.json');
  assert.notEqual(r.status, 200, 'escapar de UI_DIR nao pode servir arquivo do repositorio');
});
```

E acrescente `UI_DIR` ao import de `lib/paths.js` no topo do arquivo (hoje ele importa só
`LOG_FILE`, em `test/http.test.js:16`):

```js
const { LOG_FILE, UI_DIR } = await import('../lib/paths.js');
```

- [ ] **Passo 6: rodar e ver passar**

```bash
node --test --test-force-exit test/http.test.js
```

Esperado: PASSA, com dois testes a mais que antes.

- [ ] **Passo 7: contraprova do servidor**

Em `lib/http-server.js:187`, troque `let file = p === '/' ? '/index.html' : p;` por
`let file = p === '/' ? '/index.html' : path.basename(p);` (achata o caminho, que é
exatamente o defeito que o teste existe para pegar). Rode o teste.

Esperado: FALHA com `subpasta de ui/ precisa ser servida`. Desfaça com
`git checkout lib/http-server.js`.

- [ ] **Passo 8: fazer os dois leitores de fonte enxergarem `ui/pure/`**

Os dois leitores (`test/ui-contract.test.js:81` e `test/ui-widgets.test.js:463`) leem só o
`ui/pure.js` e ficariam cegos assim que o trecho que eles afirmam mudar de módulo. Como são
dois consumidores concretos da mesma pergunta, e a Fase 1b vai precisar da mesma leitura, o
varredor nasce compartilhado em `test/helpers/fontes-ui.js`:

```js
// Todo o código puro da UI (ui/pure.js e ui/pure/*.js) concatenado, na ordem de leitura.
function fonteDosPuros() {
  const dir = path.join(RAIZ, 'ui', 'pure');
  const modulos = fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.js'))
      .map((e) => fs.readFileSync(path.join(dir, e.name), 'utf8'))
    : [];
  return [fs.readFileSync(path.join(RAIZ, 'ui', 'pure.js'), 'utf8'), ...modulos].join('
');
}
```

O `fs.existsSync` não é zelo: `ui/pure/` só nasce na Task 3, e sem a guarda os dois testes
ficariam vermelhos entre duas tarefas. Nos dois arquivos, troque a linha do `readFileSync`
por `const PUREJS = fonteDosPuros();` e importe o helper.

**Contraprova do varredor:** crie `ui/pure/zz-prova.js` com um marcador qualquer e confirme
que `fonteDosPuros()` o inclui e continua incluindo a fachada; apague em seguida.

- [ ] **Passo 9: gate**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0`, com a contagem da linha de base mais 4.

- [ ] **Passo 10: commit**

```bash
git add test/ui-pure-superficie.test.js test/http.test.js test/ui-contract.test.js test/ui-widgets.test.js
git commit -m "test: trava a superficie do pure.js, a entrega de subpasta e os leitores de fonte"
```

---

### Task 2: registrar a regra da dívida que muda de caminho

**Substituiu** a tarefa original ("zerar os ternários aninhados"), pelo motivo medido na
seção "O ratchet mecânico" acima: o contador é mais cru que a regra do catálogo e acusa
ternário dentro de template literal. A dívida mecânica passa a **acompanhar o código**, e o
que se prova é que o total por regra não sobe. Isso precisa estar escrito onde a próxima
pessoa procura, senão a primeira tarefa que rodar `lint:update` parece estar burlando o
ratchet.

**Arquivos:**
- Modificar: `docs/QUALITY.md` (seção "Gate de ratchet")

**Interfaces:**
- Consome: nada.
- Produz: a regra que as Tasks 3 a 11 citam ao mexer na baseline.

- [ ] **Passo 1: escrever a regra**

Na seção "Gate de ratchet (v2.45.1)" do `docs/QUALITY.md`, acrescente ao fim:

```markdown
**Dívida que muda de caminho** (15/09/2026, Fase 1a da reorganização). O teto é por arquivo
e arquivo ausente vale zero, então mover código com dívida registrada reprova no destino
mesmo sem nada ter piorado. Nesse caso a dívida acompanha o código: a entrega roda
`npm run lint:update` e prova, no próprio commit, que **o total por regra não subiu**
(some as contagens do `baseline.json` antes e depois; nenhuma regra pode crescer). É a mesma
doutrina da assinatura do baseline do eng-behaviour, que acompanha o arquivo movido na mesma
entrega. O que continua proibido é o total subir, que é dívida nova entrando pela porta dos
fundos.

Não confunda o contador com a regra do catálogo: `ternarioAninhado` quebra o arquivo por `;`
e conta `?` por statement, então ele também acusa ternário dentro de template literal, que a
regra hard `core.javascript.no-nested-ternary` (que lê a árvore sintática) não acusa.
Contorcer código legítimo para zerar o contador é perseguir métrica, o mesmo motivo pelo
qual o `maxLines` está declarado como divergência logo acima.
```

- [ ] **Passo 2: conferir que os guias continuam navegáveis**

```bash
node --test --test-force-exit test/guias-navegaveis.test.js
```

Esperado: PASSA (a trava de link morto da Fase 0 cobre o `docs/QUALITY.md`).

- [ ] **Passo 3: gate e commit**

```bash
npm run check && npm run lint && npm test
```

```bash
git add docs/QUALITY.md docs/superpowers/plans/2026-09-15-reorganizacao-fase-1a-pure.md
git commit -m "docs: divida mecanica acompanha o codigo que muda de caminho"
```


### Task 3: o diretório, a fachada e o primeiro módulo

Prova o mecanismo inteiro com o menor grupo possível (`fila-justa`, 3 exports), antes de
mover 170 símbolos por cima de um desenho não verificado.

**Arquivos:**
- Criar: `ui/pure/fila-justa.js`
- Modificar: `ui/pure.js`

**Interfaces:**
- Consome: as travas da Task 1.
- Produz: o padrão de módulo e de reexport que TODAS as tarefas seguintes repetem.

- [ ] **Passo 1: criar o módulo com os dois símbolos folha**

Esta tarefa move só `fjQuando` (3040) e `fjMoeda` (3048). `filaJustaHtml` (3107) e os
privados dele dependem de `esc` e `personMention`, que só existirão como módulo nas Tasks 4
e 5; ele sai do `ui/pure.js` na Task 5, e a lista de qual símbolo sai em qual tarefa está
lá.

Crie `ui/pure/fila-justa.js`:

```js
// Justiça de fila entre orgs e contas (spec 2026-09-10-justica-de-fila-entre-orgs).
// Extraído do ui/pure.js na Fase 1a da reorganização; o conteúdo não mudou.
//
// <COLE AQUI o comentário de seção que estava em ui/pure.js:3029-3035>
//
// O import abaixo aponta para a FACHADA, e é temporário por uma tarefa: a Task 4 o troca
// por './comum.js', quando fmtDur passar a morar lá. Ele funciona porque fjQuando só chama
// fmtDur em tempo de chamada, nunca no topo do módulo.
import { fmtDur } from '../pure.js';
```

Embaixo, os dois símbolos recortados, com os comentários que os precedem.

- [ ] **Passo 2: apagar os dois símbolos do `ui/pure.js` e reexportar**

Remova `fjQuando` e `fjMoeda` do `ui/pure.js` e acrescente, no TOPO do arquivo (antes de
qualquer declaração, para a fachada ser a primeira coisa que se lê):

```js
// Fachada: o conteúdo mora em ui/pure/*.js desde a Fase 1a da reorganização. Cada linha
// abaixo reexporta um módulo inteiro; nomes novos nascem no módulo, nunca aqui.
export * from './pure/fila-justa.js';
```

- [ ] **Passo 3: rodar as travas**

```bash
node --test --test-force-exit test/ui-pure-superficie.test.js test/fila-justa-ui.test.js test/app-carrega.test.js
```

Esperado: PASSA. A trava de superfície é quem prova que `fjQuando` e `fjMoeda` continuam
saindo pelo `ui/pure.js`.

- [ ] **Passo 4: contraprova do reexport**

Troque o nome do arquivo no `export *` para `./pure/fila-justa-x.js` (que não existe) e rode
`node --test --test-force-exit test/ui-pure-superficie.test.js`.

Esperado: FALHA no carregamento do módulo, nomeando o arquivo ausente. Desfaça.

- [ ] **Passo 5: provar no navegador do próprio app**

Esta é a prova que teste nenhum dá, e ela é obrigatória em TODA tarefa deste plano a partir
daqui:

```bash
FAROL_HOME=/tmp/farol-fase1 node server.js
```

Abra `http://127.0.0.1:47170`, confira que a tela desenha e que o console do navegador
(F12) está sem erro. Feche o servidor. Se a tela subir em branco, o import quebrou: o
`export *` não resolve nome que não existe e o módulo inteiro morre.

- [ ] **Passo 6: gate e commit**

```bash
npm run check && npm run lint && npm test
```

```bash
git add ui/pure.js ui/pure/fila-justa.js
git commit -m "refactor(ui): primeiro modulo de ui/pure e a fachada de reexport"
```

---

### Task 4: `comum.js`, a camada de baixo

**Arquivos:**
- Criar: `ui/pure/comum.js`
- Modificar: `ui/pure.js`, `ui/pure/fila-justa.js`, `tools/quality/rules.js`

**Interfaces:**
- Consome: a fachada da Task 3.
- Produz: `esc`, `fmtTok`, `fmtMoney`, `fmtWhenDay`, `plural`, `fmtDur` e os outros 20, que
  TODOS os módulos seguintes importam por `./comum.js`.

- [ ] **Passo 1: mover o grupo**

Mova para `ui/pure/comum.js`, com os comentários que os precedem:

`esc` (16), `safeJsonParse` (23), `fmtClock` (28), `fmtTok` (33), `fmtCompact` (35),
`stageLabel` (47), `sysNorm` (94), `repoShort` (115), `stripFence` (117), `hexToRgba` (121),
`sameSet` (128), `diffVs` (135), `lastMerge` (141), `groupBy` (143), `fmtSpan` (415),
`plural` (470), `fmtRel` (557), `fmtStamp` (568), `fmtWhenDay` (583), `localDayKey` (600),
`usageDayKeysBack` (609), `aprovadosHoje` (626), `md` (1037), `fmtDur` (1086),
`escAttrSelector` (2012), `fmtMoney` (2031), `listViewState` (87).

Leve junto os comentários longos de decisão: 20-22 (`safeJsonParse`), 37-38 (`fmtCompact`),
44-46 (`stageLabel`), 81-86 (`listViewState`), 553 (folhas com relógio), 555-556, 566-567,
576-582, 597-599, 608, 615-625 (bloco de datas, e os de 576-582 e 597-599 amarram o corte de
dia LOCAL ao `lib/engine/usage.js`), 1046-1049 (`md`), 2006-2011 (`escAttrSelector`).

O cabeçalho do arquivo:

```js
// Folhas da UI: formatação e transformação de valor solto (texto, número, data, duração),
// sem saber de que tela o valor veio. É a camada de baixo de ui/pure/: nada aqui importa
// outro módulo do diretório, e todos os outros importam daqui.
//
// Extraído do ui/pure.js na Fase 1a da reorganização; o conteúdo não mudou.
```

- [ ] **Passo 2: reexportar e corrigir o módulo da Task 3**

No `ui/pure.js`, acrescente `export * from './pure/comum.js';` ANTES da linha do
`fila-justa` (a ordem do `export *` não importa para o resolvedor, mas a leitura de cima
para baixo passa a espelhar a camada).

Em `ui/pure/fila-justa.js`, troque `import { fmtDur } from '../pure.js';` por
`import { fmtDur } from './comum.js';`.

- [ ] **Passo 3: declarar o santuário do parser**

`safeJsonParse` é o `JSON.parse` único da UI, e ele acabou de mudar de arquivo: no destino o
teto é zero e o ratchet reprova. Em `tools/quality/rules.js:16`, acrescente o caminho novo:

```js
const JSON_SANTUARIOS = ['lib/io.js', 'ui/pure/comum.js'];
```

Escreva no comentário acima da constante por que ele entra: é o parser único da UI, do mesmo
jeito que `lib/io.js` é o do engine, e foi por isso que `safeJsonParse` existe (ver o
comentário dela, que viajou junto).

- [ ] **Passo 4: rodar as travas**

```bash
node --test --test-force-exit test/ui-pure-superficie.test.js test/ui-pure.test.js test/app-carrega.test.js
```

Esperado: PASSA.

- [ ] **Passo 5: gate**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `sem regressão`. Se aparecer `ui/pure/comum.js: jsonParseCru subiu de 0
pra 1`, o passo 3 não foi feito ou o caminho está escrito diferente do que o gate vê.

- [ ] **Passo 6: prova no navegador**

Suba o app como no Passo 5 da Task 3, confira a tela e o console. Este passo se repete em
todas as tarefas seguintes e não será reescrito: **nenhuma tarefa deste plano fecha sem
ele.**

- [ ] **Passo 7: commit**

```bash
git add ui/pure.js ui/pure/comum.js ui/pure/fila-justa.js tools/quality/rules.js
git commit -m "refactor(ui): comum.js, a camada de baixo do ui/pure"
```

---

### Task 5: `mencoes.js`

**Arquivos:**
- Criar: `ui/pure/mencoes.js`
- Modificar: `ui/pure.js`, `ui/pure/fila-justa.js`

**Interfaces:**
- Consome: `esc` de `./comum.js`.
- Produz: `personMention`, `repoMention`, `prRefMention`, `sessionRefMention`,
  `sessionRefCell`, `avatar`, `ghPrUrl`, `parseGoto`, `toolRefGoto`, `ownerFromUrl`,
  `canonicalGithubPrUrl`, `prKeyFromUrl`, importados por review, radar, entregas, sessão,
  consumo, sistema e fila-justa.

- [ ] **Passo 1: mover o grupo**

Para `ui/pure/mencoes.js`: `ownerFromUrl` (97), `canonicalGithubPrUrl` (101),
`prKeyFromUrl` (110), `avatar` (658), `ghPrUrl` (687), `personMention` (695),
`repoMention` (704), `prRefMention` (712), `parseGoto` (722), `toolRefGoto` (737),
`sessionRefMention` (747), `sessionRefCell` (840), mais os privados `GH_URL` (680),
`PR_REF_RE` (685) e `TOOL_REF_GOTO` (732).

Comentários que viajam: 663-679 (o cabeçalho de 17 linhas "menções navegáveis: UM primitivo
por tipo de coisa"), 99-100, 727-731, 743-746, 835-839.

Cabeçalho:

```js
// Menções navegáveis: UM primitivo por tipo de coisa (pessoa, repo, PR, ferramenta,
// sessão). A regra de usabilidade está no CLAUDE.md, seção "Menções navegáveis": toda
// menção sai daqui, nunca escrita à mão, para o destino ser o mesmo em toda tela.
//
// Extraído do ui/pure.js na Fase 1a da reorganização; o conteúdo não mudou.
import { esc } from './comum.js';
```

- [ ] **Passo 2: terminar o `fila-justa.js`**

Agora `filaJustaHtml` (3107) pode sair do `ui/pure.js`: mova-o e os privados `fjOrgsHtml`
(3057), `fjContaHtml` (3075) e `fjPerfisHtml` (3095) para `ui/pure/fila-justa.js`, junto com
o comentário 3078-3082 (que justifica por escrito o uso de `personMention`), e acrescente ao
import do módulo:

```js
import { esc, fmtDur, fmtMoney } from './comum.js';
import { personMention } from './mencoes.js';
```

- [ ] **Passo 3: reexportar**

No `ui/pure.js`, acrescente `export * from './pure/mencoes.js';`.

- [ ] **Passo 4: travas, gate, navegador e commit**

```bash
node --test --test-force-exit test/ui-pure-superficie.test.js test/ui-pure.test.js test/ui-contract.test.js test/ui-widgets.test.js test/fila-justa-ui.test.js
npm run check && npm run lint && npm test
```

Os dois testes de contrato entram aqui porque `parseGoto` e os `data-goto` são o que eles
leem. Suba o app, navegue pelas seis abas e clique em uma menção de pessoa e em um
`data-goto` (o "+N hoje" do Radar serve).

```bash
git add ui/pure.js ui/pure/mencoes.js ui/pure/fila-justa.js
git commit -m "refactor(ui): mencoes.js e o fim do fila-justa.js"
```

---

### Task 6: `sessao.js` e `sync.js`

Dois módulos independentes entre si, que só dependem de `comum` e `mencoes`.

**Arquivos:**
- Criar: `ui/pure/sessao.js`, `ui/pure/sync.js`
- Modificar: `ui/pure.js`

**Interfaces:**
- Consome: `comum`, `mencoes`.
- Produz: `stagesLine` (que `review.js` vai importar na Task 9) e `prCoordNoteHtml` (que
  `radar.js` vai importar na Task 10).

- [ ] **Passo 1: `sessao.js`**

Mova: `opTransition` (642), `opDismissDelay` (650), `stagesLine` (1098),
`STAGE_FLOW_ORDER` (1110), `stageFlowFrom` (1115), `stageFlowHtml` (1133),
`agentsTitle` (1146), `feedLine` (1154), `analysisOpsPlan` (1169), `selfSessionKey` (1195),
`sessionProgress` (1199), `sessionCardHtml` (2900).

Comentários que viajam: 1105-1109 (esteira de etapas estilo n8n), 1162-1168 (ops de
autoanálise), 1184-1194 (a régua ÚNICA de progresso), 2896-2899 (cartão da sessão).

```js
// A sessão de revisão ao vivo: esteira de etapas, feed, subagentes e progresso.
// Extraído do ui/pure.js na Fase 1a da reorganização; o conteúdo não mudou.
import { esc, fmtClock, fmtDur, aprovadosHoje } from './comum.js';
import { personMention } from './mencoes.js';
```

**`stageLabel` NÃO vem para cá**: ele ficou em `comum.js` na Task 4 porque é o ticker do app
inteiro (comentário 44-46). Importe-o de `./comum.js` se algum símbolo daqui o usar.

- [ ] **Passo 2: `sync.js`**

Mova: `syncEstado` (3145), `syncSeloHtml` (3155), `syncClasseCartao` (3160),
`syncCfgComGeral` (3184), `syncTogglesHtml` (3195), `syncContaHtml` (3238),
`syncEnvioHtml` (3271), `syncConexaoHtml` (3281), `syncAparelhosHtml` (3309),
`syncCoordenacaoHtml` (3341), `syncSecaoHtml` (3360), `syncConfirmacaoDoClique` (3411),
`syncConfirmacoesDoClique` (3428), `prCoordNoteHtml` (3446), mais os privados `SYNC_SELOS`
(3129), `SYNC_BORDA` (3137), `SYNC_ERROS_DE_LOGIN` (3140), `syncSubToggle` (3170),
`syncCampo` (3210), `syncOlhoHtml` (3221), `syncLinhaLease` (3326), `syncLinhaRecibo`
(3332), `SYNC_CONFIRMACOES` (3385), `syncCorpoIndisponivel` (3398), `syncCorpoRecibo`
(3404), `SYNC_ESPERA_FRASE` (3439), `SYNC_ESPERA_CLASSE` (3444).

Comentários que viajam: 3118-3127 (cabeçalho da sincronização), 3165-3167, 3180-3183,
3218-3220, 3229-3237, 3269-3270, 3372-3384, 3425-3427, 3433-3438.

```js
// Sincronização entre dispositivos: estado, selo, toggles, conta, envio, aparelhos e as
// confirmações de clique. Inclui a nota de coordenação que o card da FILA renderiza (U3):
// ela nasce aqui porque a regra é de sincronização, e o radar só a exibe.
//
// Extraído do ui/pure.js na Fase 1a da reorganização; o conteúdo não mudou.
import { esc, fmtClock, fmtTok, fmtWhenDay } from './comum.js';
```

**`usageConsolidatedHtml` (3464) e `usageConsolidadoEnvelopeHtml` (3493) NÃO vêm para cá**,
apesar de morarem no fim do arquivo dentro da região do Sync: são a aba Consumo de todos os
aparelhos e vão para `consumo.js` na Task 7, com o comentário 3459-3463.

- [ ] **Passo 3: reexportar, travas, gate, navegador, commit**

```js
export * from './pure/sessao.js';
export * from './pure/sync.js';
```

```bash
node --test --test-force-exit test/ui-pure-superficie.test.js test/ui-pure.test.js test/ui-pure-sync.test.js test/sync-consolidated.test.js
npm run check && npm run lint && npm test
```

No app, abra Sistema > Sincronização e o Radar com uma revisão em andamento, se houver.

```bash
git add ui/pure.js ui/pure/sessao.js ui/pure/sync.js
git commit -m "refactor(ui): sessao.js e sync.js"
```

---

### Task 7: `consumo.js`

O maior grupo depois de review, e o que tem mais teste próprio.

**Arquivos:**
- Criar: `ui/pure/consumo.js`
- Modificar: `ui/pure.js`

**Interfaces:**
- Consome: `comum` (`fmtTok`, `fmtCompact`, `fmtMoney`, `fmtWhenDay`, `escAttrSelector`,
  `usageDayKeysBack`), `mencoes` (`sessionRefCell`), `fila-justa` (`fjMoeda`).
- Produz: a superfície de Consumo que `entregas.js` (`usageDayKeysBack` não, esse é de
  `comum`) e o `app.js` consomem.

- [ ] **Passo 1: mover o grupo**

`usageMetricVal` (149), `sparklinePath` (160), `usageDelta` (171), `usageStackLayers` (180),
`usageHoverIndex` (209), `usageMatrixRows` (221), `USAGE_KIND_LABEL` (246),
`USAGE_ST_LABEL` (249), `FAROL_STAMP_SINCE` (256), `FAROL_PRE_STAMP_LABEL` (257),
`usageSessionRow` (285), `fmtUsageMetric` (2033), `USAGE_KIND_COLOR` (2039),
`USAGE_PALETTE` (2040), `usageColorsFor` (2041), `usageTooltipHtml` (2046),
`usageKpisHtml` (2053), `usageMatrixHtml` (2099), `usageBudgetHtml` (2131),
`usageSessionsHtml` (2221), `auditoriaLinhaHtml` (2264), `usageConsolidatedHtml` (3464),
`usageConsolidadoEnvelopeHtml` (3493), mais o privado `custoDaSessao` (268).

Comentários que viajam: 2016-2029 (o cabeçalho de 14 linhas da aba Consumo, hoje entre
`escAttrSelector` e `fmtMoney`, que **ficaram em comum.js**: recorte o cabeçalho e não os
dois símbolos), 158-159, 169-170, 177-179, 183, 207-208, 217-220, 243-245, 247-248,
253-255, 259-267, 291-293, 297-301, 2035-2038, 2114-2117, 2135-2143, 2214-2217, 2257-2263,
3459-3463, 3490-3491.

```js
// A aba Consumo: séries, matriz por modelo, orçamento por perfil, sessões e o consolidado
// de todos os aparelhos. Só construtor de HTML e SVG; o desenho do gráfico em canvas mora
// no ui/app.js e não é puro.
//
// Extraído do ui/pure.js na Fase 1a da reorganização; o conteúdo não mudou.
import { esc, fmtTok, fmtCompact, fmtMoney, fmtWhenDay, escAttrSelector } from './comum.js';
import { sessionRefCell } from './mencoes.js';
import { fjMoeda } from './fila-justa.js';
```

- [ ] **Passo 2: se passar de 400 linhas úteis, dividir**

Meça antes de commitar:

```bash
node -e "const s=require('fs').readFileSync('ui/pure/consumo.js','utf8').split('\n').filter(l=>l.trim()&&!l.trim().startsWith('//'));console.log(s.length)"
```

Acima de 400, separe em `ui/pure/consumo.js` (série, matriz, KPIs, tooltip) e
`ui/pure/consumo-sessoes.js` (`usageSessionRow`, `usageSessionsHtml`, `auditoriaLinhaHtml`,
`custoDaSessao`, `FAROL_STAMP_SINCE`, `FAROL_PRE_STAMP_LABEL`), que é a costura natural: um
é o agregado, o outro é a tabela de sessões. Reexporte os dois.

- [ ] **Passo 3: reexportar, travas, gate, navegador, commit**

```bash
node --test --test-force-exit test/ui-pure-superficie.test.js test/ui-pure.test.js test/sync-consolidated.test.js test/cota-conta-no-perfil.test.js
npm run check && npm run lint && npm test
```

No app, abra a aba Consumo, passe o mouse pela série (o tooltip é construído aqui) e abra a
caixa de uma revisão pela coluna "PR / sessão".

```bash
git add ui/pure.js ui/pure/consumo*.js
git commit -m "refactor(ui): consumo.js"
```

---

### Task 8: `entregas.js`

**Arquivos:**
- Criar: `ui/pure/entregas.js`
- Modificar: `ui/pure.js`

**Interfaces:**
- Consome: `comum` (`groupBy`, `lastMerge`, `plural`, `fmtRel`, `repoShort`, `localDayKey`,
  `usageDayKeysBack`), `mencoes` (`personMention`, `repoMention`).
- Produz: nada que outro módulo deste plano importe.

- [ ] **Passo 1: mover o grupo**

`delivCappedMsg` (329, que hoje mora longe do bloco), `delivFilterItems` (2504),
`delivDayBuckets` (2512), `delivStats` (2531), `delivStatsCards` (2576),
`delivActivityChart` (2589), `delivActivityCard` (2620), `delivSliceRows` (2631),
`deliveriesByRepo` (2690), `deliveriesByAuthor` (2712), `delivEmptyState` (2744), mais os
privados `DIAS_SEMANA` (2525), `ddmm` (2526), `subtituloDoPeriodo` (2571),
`delivPrRowV2` (2642), `delivGroupBody` (2653), `delivGroupCardV2` (2668),
`delivVolumeOrder` (2684).

**`PASSO_DO_ROTULO` e `rotuloDaBarra` NÃO entram na lista**, e isto foi medido na execução:
eles estão escritos na coluna zero, mas **dentro do corpo** de `delivActivityChart`, então
são locais dela e viajam junto sem ser nomeados. São as duas únicas declarações aninhadas
do arquivo inteiro (varredura com o tokenizador do ratchet, `tools/quality/strip.js`).
Listá-los faz o recorte se sobrepor; e qualquer recorte que pare no primeiro `}` da
coluna zero corta `delivActivityChart` ao meio, no fim de `rotuloDaBarra`.

Comentários que viajam: 2498-2500 (cabeçalho), 324-328 (`delivCappedMsg`, e ele explica o
`DELIVERIES_LIMIT`), 2545-2549. Os comentários de `delivActivityChart` e de `rotuloDaBarra` já estão no lugar
certo: o que parecia um par de comentários separado da função por uma linha de export é a
declaração local descrita acima.

```js
// A aba Entregas: filtros, buckets por dia, estatística, gráfico de atividade e os grupos
// por repositório e por pessoa.
//
// Extraído do ui/pure.js na Fase 1a da reorganização; o conteúdo não mudou.
import { esc, groupBy, lastMerge, plural, fmtRel, repoShort, localDayKey, usageDayKeysBack } from './comum.js';
import { personMention, repoMention } from './mencoes.js';
```

- [ ] **Passo 2: reexportar, travas, gate, navegador, commit**

```bash
node --test --test-force-exit test/ui-pure-superficie.test.js test/ui-pure.test.js
npm run check && npm run lint && npm test
```

No app, abra a aba Entregas, troque a janela (7, 15, 30 dias), troque o agrupamento e
confira o gráfico.

```bash
git add ui/pure.js ui/pure/entregas.js
git commit -m "refactor(ui): entregas.js"
```

---

### Task 9: `review.js`, `pessoas.js` e `autoanalise.js`

O grupo H tem 35 exports e três sub-blocos que se separam limpo. Um arquivo só passaria de
400 linhas e continuaria juntando assuntos, o que não cabe no baseline (ver a restrição 3.8
da spec: dividir em pedaços que continuam violando não vale).

**Arquivos:**
- Criar: `ui/pure/review.js`, `ui/pure/pessoas.js`, `ui/pure/autoanalise.js`
- Modificar: `ui/pure.js`

**Interfaces:**
- Consome: `comum`, `mencoes`, `sessao` (`stagesLine`).
- Produz: `reviewChip` e `chatBadge`, importados por `radar.js` na Task 10; `papelPicker`,
  idem.

- [ ] **Passo 1: `review.js` (decisão, revisão e pushback)**

`reasonGroups` (871), `reasonText` (895), `reasonGroupsHtml` (900), `reRoundStatus` (955),
`reRoundBoxHtml` (982), `staleCardMeta` (991), `reviewBoxHtml` (1014), `reviewChip` (1718),
`chatBadge` (2341), `PB_OPTS` (2349), `PB_SHORT` (2350), `pushbackControl` (2351),
`resolvedRow` (2438), mais os privados `VERDICT_LABEL` (854), `REASON_GROUPS` (865),
`REROUND_MOTIVO` (923), `shaCurto` (940), `reRoundAguardando` (942), `REROUND_ICONE` (975),
`RESOLVED_LABELS` (2387), `RESOLVED_ACTIONS` (2397), `VERDICT_CLASS` (2400),
`ROTULO_DOS_PONTOS` (2405), `rotuloDosPontos` (2410), `pontosDeAtencao` (2417),
`divergenciasDoCheckpoint` (2423), `resumoDoPushback` (2431).

Comentários que viajam: 856-864 (os três eixos), 917-922 (card de commit novo, stale_head),
2338-2340, 2346-2348, 2372-2386 (Revisões recentes, 15 linhas), 850-853, 888-894, 2446-2454.

```js
import { esc, md, fmtClock, plural } from './comum.js';
import { personMention, prRefMention, avatar } from './mencoes.js';
import { stagesLine } from './sessao.js';
```

- [ ] **Passo 2: `pessoas.js` (perfil de pessoa e editor de reviewers)**

`defaultFor` (1895), `overrideFor` (1897), `reposOfOrg` (1899), `suggestDefault` (1910),
`addControl` (1919), `renderOrgBlock` (1932), `PAPEL_OPTS` (2296), `DOMAIN_DEFS` (2297),
`DOMLEVEL_OPTS` (2298), `personOf` (2299), `papelOf` (2300), `domLevelOf` (2301),
`papelPicker` (2303), `domainMatrix` (2309), `reviewerLabel` (2322), `chipHtml` (2329).

Comentários que viajam: 1879-1893 (editor de reviewers, 15 linhas), 2282-2295 (perfil de
review por pessoa, 14 linhas), 2317-2321.

```js
import { esc, sameSet, diffVs, repoShort, plural } from './comum.js';
```

- [ ] **Passo 3: `autoanalise.js`**

`canMergeSelfAnalysis` (2958), `selfAnalysisStale` (2966), `selfAnalysisBadge` (2973),
`selfAnalysisToggle` (2987), `qualityReasonLabel` (3016), `qualityBlockTitle` (3023), mais o
privado `QUALITY_REASON_LABELS` (2997).

Comentários que viajam: 2952-2957 ("a UI CONSOME, nunca reconstrói"), 2962-2965, 2983-2986.

```js
import { esc } from './comum.js';
```

- [ ] **Passo 4: reexportar, travas, gate, navegador, commit**

```bash
node --test --test-force-exit test/ui-pure-superficie.test.js test/ui-pure.test.js test/ui-rerodada.test.js test/reviewers-editor.test.js test/taxonomy-ui.test.js test/self-analise-persistente.test.js
npm run check && npm run lint && npm test
```

No app: Revisões recentes (abra uma caixa de revisão), Sistema > Reviewers, aba Time (papel
e matriz) e Meus PRs com uma autoanálise.

```bash
git add ui/pure.js ui/pure/review.js ui/pure/pessoas.js ui/pure/autoanalise.js
git commit -m "refactor(ui): review.js, pessoas.js e autoanalise.js"
```

---

### Task 10: `radar.js` e `meus-prs.js`

**Arquivos:**
- Criar: `ui/pure/radar.js`, `ui/pure/meus-prs.js`
- Modificar: `ui/pure.js`

**Interfaces:**
- Consome: `comum`, `mencoes`, `review` (`reviewChip`, `chatBadge`), `pessoas`
  (`papelPicker`), `sync` (`prCoordNoteHtml`).
- Produz: nada que outro módulo deste plano importe.

- [ ] **Passo 1: `radar.js`**

`automacaoPausadaPor` (1228), `orgsMonitoradas` (1267), `queueEmptyOkHtml` (1284),
`parkedNoteHtml` (1751), `queueCardHtml` (1758), `panoramaRowHtml` (1798), mais os privados
`textoPausa` (1243), `orgsDaConta` (1280), `comMotivo` (1733), `PARKED_FRASE` (1737).

**`aprovadosHoje` não vem para cá**: ficou em `comum.js` na Task 4, e é isso que impede o
ciclo `radar -> review -> sessao -> radar`. Importe-o.

Comentários que viajam: 1208-1214 (o vazio que CONFIRMA), 1215-1227 e 1254-1266 (os dois
blocos de 13 linhas marcados "PURA"), 1708-1716 (cards da fila e do panorama), 1747-1750.

```js
import { esc, fmtRel, fmtMoney, plural, aprovadosHoje, localDayKey } from './comum.js';
import { personMention, avatar } from './mencoes.js';
import { reviewChip, chatBadge } from './review.js';
import { papelPicker } from './pessoas.js';
import { prCoordNoteHtml } from './sync.js';
```

- [ ] **Passo 2: `meus-prs.js`**

`expiredSessionMarks` (75), `splitHiddenPRs` (504), `effectiveHidden` (517),
`hiddenFootLabel` (525), `myPRsEmptyMsg` (534), `MERGE_EM_ANDAMENTO` (548),
`mergeToastKind` (549).

**`listViewState` não vem para cá**: ficou em `comum.js`, porque serve myPRs, fila e
panorama (o comentário 81-86 diz isso).

Comentários que viajam: 494-499 (cabeçalho do PR oculto), 70-74, 501-503, 513-516, 523-524,
531-533, 542-547 (`mergeToastKind`, e ele explica por que a decisão de cor mora no puro).

```js
import { esc, plural, fmtRel } from './comum.js';
```

- [ ] **Passo 3: reexportar, travas, gate, navegador, commit**

```bash
node --test --test-force-exit test/ui-pure-superficie.test.js test/ui-pure.test.js test/ui-widgets.test.js test/estacionamento-visivel.test.js test/parked-oauth-guidance.test.js
npm run check && npm run lint && npm test
```

No app: o Radar inteiro (fila, panorama, e um PR estacionado se houver) e Meus PRs, com o
rodapé de ocultos aberto.

```bash
git add ui/pure.js ui/pure/radar.js ui/pure/meus-prs.js
git commit -m "refactor(ui): radar.js e meus-prs.js"
```

---

### Task 11: `contas.js` e `sistema.js`

O que sobrou.

**Arquivos:**
- Criar: `ui/pure/contas.js`, `ui/pure/sistema.js`
- Modificar: `ui/pure.js`

**Interfaces:**
- Consome: `comum`, `mencoes`.
- Produz: nada que outro módulo deste plano importe.

- [ ] **Passo 1: `contas.js`**

`validScope` (56), `accountBarVisible` (66), `accountSaveArray` (307),
`statusBannerHtml` (1331), `claudeAuthBadge` (1370), `budgetEditorHtml` (1455),
`claudeProfilesHtml` (1495), `accountsManagerHtml` (1610), `jiraBaseUrlProblema` (2935),
`jiraPrefixosProblema` (2946), mais os privados `sel` (1356), `seloOrcamento` (1361),
`DIAS_DO_TETO` (1405), `CAP_ORIGEM_LABEL` (1411), `valorTeto` (1415), `linhaGastoHoje`
(1417), `botaoSugestao` (1426), `campoDia` (1438), `linhaData` (1444), `listaDeDatas`
(1449), `profileFieldsHtml` (1486).

**Cuidado medido:** `sel` (1356) é declarada DEPOIS de `statusBannerHtml`, que não a usa;
quem a usa é `claudeProfilesHtml` e `accountsManagerHtml`. Cortar por proximidade erra aqui.

Comentários que viajam: 1319-1330 (banner do topo), 1345-1351 (cabeçalho do painel, que fica
logo depois de `statusBannerHtml`), 1400-1404 (editor de orçamento), 2927-2934 (o que a tela
recusa antes de mandar pro servidor), 53-55, 62-65, 315-318, 1372-1375, 1380-1383,
1498-1501, 1539-1543.

```js
import { esc, fmtMoney, fmtWhenDay, escAttrSelector } from './comum.js';
```

- [ ] **Passo 2: `sistema.js`**

`fmtLogStamp` (348), `logGroupLine` (359), `logSpanMinutes` (390), `logGroupRate` (405),
`logRegimeLines` (425), `logReadingLine` (441), `logSummaryLines` (454), `logTailLines`
(463), `logSummaryShort` (474), `operationChecks` (767), `runtimeChecks` (802),
`creditsHtml` (2765), `buildFixPrompt` (2789), `diagnosticsText` (2837), mais os privados
`LOG_REFS_VISIVEIS` (355), `REGIME_MIN_MINUTOS` (402), `REGIME_MIN_POR_HORA` (403),
`LOG_KINDS_SOZINHO` (439), `contaLinhaDiag` (2813), `assinaturaLinhaDiag` (2821),
`atualizacaoLinhaDiag` (2829).

Comentários que viajam: 334-342, 374-384, 755-766 (checks de OPERAÇÃO), 793-801,
2759-2764, 2807-2811, 344-347, 353-354, 386-389, 399-401, 414, 422-424, 436-438, 452-453,
460-462, 472-473, 480-481, 486-487 (este último cita o ratchet de `?` por statement, e
depois da Task 2 ele precisa de uma linha dizendo que a dívida foi zerada).

```js
import { esc, fmtSpan, plural, escAttrSelector } from './comum.js';
import { personMention, repoMention } from './mencoes.js';
```

Se passar de 400 linhas úteis, separe `ui/pure/log.js` (as nove funções de log) de
`ui/pure/sistema.js` (checks, créditos, diagnóstico): são dois assuntos que mudam por
motivos diferentes.

- [ ] **Passo 3: reexportar, travas, gate, navegador, commit**

```bash
node --test --test-force-exit test/ui-pure-superficie.test.js test/ui-pure.test.js test/log-regime.test.js test/claude-profiles.test.js test/cota-conta-no-perfil.test.js
npm run check && npm run lint && npm test
```

No app: Sistema inteiro (Visão geral, Contas, Conexões, Automação, Sobre) e o Diagnóstico.

```bash
git add ui/pure.js ui/pure/contas.js ui/pure/sistema.js
git commit -m "refactor(ui): contas.js e sistema.js"
```

---

### Task 12: fechar a fase

**Arquivos:**
- Modificar: `ui/pure.js`, `tools/eng-behaviour/baselines.json`, `docs/QUALITY.md`,
  `CLAUDE.md`
- Criar: `ui/pure/README.md`

**Interfaces:**
- Consome: tudo.
- Produz: o registro que a Fase 1b lê.

- [ ] **Passo 1: conferir que o `ui/pure.js` só reexporta**

```bash
grep -vE "^\s*(//|$)" ui/pure.js
```

Esperado: só linhas `export * from './pure/<modulo>.js';`. Qualquer declaração que tenha
sobrado é símbolo que ninguém classificou: decida o módulo dele e mova, nesta tarefa.

- [ ] **Passo 2: o cabeçalho do arquivo**

O comentário de 2-12 do `ui/pure.js` descreve o contrato de pureza do diretório inteiro e
**afirma uma coisa que não é mais verdade** (que o Node lê "pelo rodapé CommonJS lá
embaixo", rodapé que não existe desde a migração ESM). Mova o contrato para
`ui/pure/README.md`, corrigido, e deixe no `ui/pure.js` só:

```js
// Fachada do ui/pure: o conteúdo mora em ui/pure/*.js desde a Fase 1a da reorganização
// (15/09/2026). Este arquivo existe para o ui/app.js e os testes continuarem importando de
// um lugar só; nome novo nasce no módulo do assunto, nunca aqui.
//
// O contrato de pureza do diretório está em ui/pure/README.md.
```

- [ ] **Passo 3: tirar o `ui/pure.js` do baseline do eng-behaviour**

A condição de fechamento dele, em `docs/QUALITY.md`, é "um módulo comum e um por aba;
`pure.js` some ou só reexporta". Ela está cumprida. Em
`tools/eng-behaviour/baselines.json`: remova a linha
`"core.file.single-responsibility|ui/pure.js|violacao"` e baixe `currentFindings` de 15 para
14. **Não mexa em `initialFindings`.**

```bash
node --test --test-force-exit test/eng-behaviour-baseline.test.js
```

Esperado: PASSA (`known.length === currentFindings`).

- [ ] **Passo 4: registrar em `docs/QUALITY.md`**

Na tabela da seção "Dívida registrada de responsabilidade única", a linha do `ui/pure.js`
sai da tabela e vira uma linha de registro logo abaixo dela:

```markdown
**Resolvido:** `ui/pure.js` saiu da lista em 15/09/2026 (Fase 1a da reorganização): ele só
reexporta, e o conteúdo mora em `ui/pure/*.js`, um módulo por assunto. `currentFindings`
baixou de 15 para 14.
```

- [ ] **Passo 5: registrar no `CLAUDE.md`**

Na tabela "Mapa de arquivos", a linha do `ui/pure.js` passa a descrever a fachada, e entra
uma linha nova para `ui/pure/`. No índice não se mexe (ele é gerado das seções, e nenhuma
seção nasceu).

- [ ] **Passo 6: avaliação do eng-behaviour e gate**

```bash
npm run check && npm run lint && npm test
```

Escreva as avaliações de julgamento para o head final pelo roteiro de `docs/QUALITY.md`. A
de `core.file.single-responsibility` é **`conforme`** para o `ui/pure.js`, e é ela que
autoriza a remoção do passo 3; o gate deve imprimir `resolvido
core.file.single-responsibility|ui/pure.js|violacao`.

```bash
npm run eng
```

- [ ] **Passo 7: commit e PR**

```bash
git add ui/pure.js ui/pure/README.md tools/eng-behaviour/baselines.json docs/QUALITY.md CLAUDE.md
git commit -m "refactor(ui): pure.js vira fachada e sai da divida de responsabilidade unica"
git push -u origin HEAD
gh pr create --fill
```

---

## Verificação final da fase

| o que | como | esperado |
|---|---|---|
| a superfície não mudou | `node --test test/ui-pure-superficie.test.js` | 2 testes, 0 falhas, nenhum nome a mais nem a menos |
| nada de comportamento mudou | `npm test` | mesma contagem da linha de base mais os testes novos da Task 1, `fail 0` |
| a dívida mecânica não subiu | `npm run lint` | `sem regressão`, e nenhum `ui/pure/*.js` na baseline com `ternarioAninhado` |
| a dívida de arquitetura desceu | `npm run eng` | `resolvido ... ui/pure.js`, `currentFindings` 14 |
| a tela funciona | abrir o app e navegar as seis abas | sem erro no console, sem área em branco |
| a distribuição continua íntegra | `powershell -File tools\make-package.ps1` | `pacote limpo`; `ui/` é espelhada inteira, então `ui/pure/` viaja sem tocar nas quatro listas |

**Por que a instalação a partir do zip não é exigida aqui:** `ui` já é uma das seis pastas
que os três instaladores espelham (`install.ps1:69`, `install.sh:103`,
`install-linux.sh:52`), e a cópia é recursiva (`robocopy /MIR` e `cp -R`). Subpasta DENTRO
de `ui/` viaja junto. O que exigiria instalação real é pasta nova na RAIZ, que esta fase não
cria. Mesmo assim, rode `make-package.ps1` e confira que o zip tem `ui/pure/`:

```bash
powershell -NoProfile -Command "(Get-ChildItem dist/farol-v*.zip | Select-Object -Last 1) | ForEach-Object { [IO.Compression.ZipFile]::OpenRead($_.FullName).Entries | Where-Object { $_.FullName -like 'ui/pure/*' } | Measure-Object | Select-Object -ExpandProperty Count }"
```

Esperado: o número de módulos criados.

## O que esta fase deliberadamente NÃO faz

- **Não toca no `ui/app.js`.** É a Fase 1b, com plano próprio, e ela depende desta.
- **Não toca no `ui/app.css`.** É a Fase 1c.
- **Não muda `ui/index.html`.** Ele continua carregando um módulo só (`app.js`), que
  continua importando `./pure.js`. Quebrar isso mudaria a ordem de execução.
- **Não acrescenta nome novo à superfície pública.** Símbolo novo em módulo novo é feature,
  não reorganização.
- **Não mexe nas quatro listas de distribuição.** Nada de novo na raiz.

## Registro da execução (15/09/2026)

A fase foi executada tarefa a tarefa, com a suíte, o ratchet e a tela conferidos a cada
passo. O plano acertou o desenho quase inteiro (13 das 14 fronteiras e as três decisões de
fronteira se sustentaram, e o grafo final não tem ciclo). O que a execução corrigiu, e que a **Fase 1b**
precisa saber antes de começar:

1. **A Task 2 original estava errada** e foi substituída. O contador `ternarioAninhado` é
   mais cru que a regra do catálogo e acusa ternário dentro de template literal, então
   zerá-lo exigiria contorcer código por métrica. A dívida passou a acompanhar o código, com
   a prova de que o total por regra não sobe (seção "O ratchet mecânico" acima e
   `docs/QUALITY.md`, "Dívida que muda de caminho").
2. **`npm run lint:update` regenera a baseline inteira**, travando também tetos defasados
   de arquivos que a entrega não toca. A entrega passou a trocar só as entradas dos
   caminhos movidos, partindo da baseline do HEAD.
3. **`export *` não traz nome para o escopo do próprio arquivo.** Enquanto um símbolo ainda
   morava na fachada, ela precisou importar de volta o que ele chamava. Adivinhar essa lista
   quebrou duas vezes; derivá-la do uso (com o tokenizador do ratchet,
   `tools/quality/strip.js`, e aceitando o spread `...nome`) resolveu. Os imports de cada
   módulo novo também saíram derivados do uso, nunca escritos à mão.
4. **Uma contraprova desfeita com `git checkout` apagou uma edição não commitada** (a
   fachada da Task 3), e o commit saiu com um módulo órfão que duplicava dois símbolos. A
   suíte ficou verde, porque arquivo órfão não é lido por ninguém. Daí a trava nova em
   `test/ui-pure-superficie.test.js`: nenhum nome declarado em dois arquivos do diretório.
   **Regra para a 1b: contraprova se desfaz restaurando de cópia, nunca com `git checkout`
   sobre arquivo que tem trabalho não commitado.**
5. **Recorte por texto não serve para achar fim de função.** Contar chaves tropeça em regex
   com aspas, e "primeiro `}` na coluna zero" cortaria `delivActivityChart` ao meio, porque
   ela tem uma função local escrita na coluna zero dentro do corpo (as duas únicas
   declarações aninhadas do arquivo). O fim de bloco passou a ser o primeiro candidato que
   compila no V8. Para o `ui/app.js`, que é quatro vezes mais irregular, isso não é opcional.
6. **Cabeçalho de seção não viaja sozinho** com o símbolo. Ao fim, 23 cabeçalhos com conteúdo
   foram conferidos um a um contra os cabeçalhos dos módulos antes de sair da fachada.
7. **A prova no navegador se fez importando a fachada dentro da própria página** e chamando
   os construtores de cada módulo com dados de exemplo, anotando a CLASSE do erro:
   `TypeError` por argumento de exemplo é aceitável, `ReferenceError` é import faltando. A
   instância isolada roda em porta própria (47185): a padrão estava ocupada pelo Farol real
   do usuário, e o primeiro `curl` bateu nele sem ninguém perceber.
8. **Dois módulos do plano juntavam assuntos, e só a avaliação honesta da regra mostrou.**
   Ao escrever a `core.file.single-responsibility` de cada arquivo, o `contas.js` precisava
   de um "e também" para a validação do formulário do site do Jira, e o `sistema.js` para os
   créditos do Sobre: os dois mudam por motivos que não têm nada a ver com o resto do
   arquivo. Arquivo NOVO em violação não pode entrar no baseline, então eles viraram
   `jira.js` e `sobre.js`, e a fase fechou com 16 módulos em vez de 14. A lição para a 1b: a
   frase de responsabilidade de cada arquivo se escreve ANTES de mover, na tabela de
   estrutura do plano, e cada "e também" ali é um módulo a mais.

