# Reorganização estrutural, Fase 0: legibilidade e as travas que faltam

> **Para quem executa:** use `superpowers:subagent-driven-development` (recomendado) ou
> `superpowers:executing-plans` para executar tarefa a tarefa. Os passos usam caixa
> (`- [ ]`) para acompanhamento.

**Objetivo:** deixar o repositório navegável para quem chega de fora e instalar as travas
mecânicas que as fases seguintes (que movem arquivo) vão precisar, sem mover nenhum
arquivo nesta fase.

**Arquitetura:** três entregas de documentação (mapa no `README.md`, índice no
`CLAUDE.md`, ponteiro no `CONTRIBUTING.md`) e uma suíte nova que DERIVA do fonte, no
mesmo estilo do `test/facades.test.js`: nenhuma lista curada à mão, para nada envelhecer
em silêncio. A trava de distribuição é o entregável mais importante da fase: é ela que
torna a Fase 1 e a Fase 3 seguras.

**Stack:** Node puro (>= 22.12), `node --test` nativo, zero dependências novas.

**Spec:** [`docs/superpowers/specs/2026-09-14-reorganizacao-estrutural-design.md`](../specs/2026-09-14-reorganizacao-estrutural-design.md)

## Desvio consciente em relação à spec (ler antes de começar)

A spec colocava a **extração do `CLAUDE.md` por tema para `docs/`** dentro da Fase 0, com
risco declarado como "nenhum". A medição mostrou que não é nenhum, e por isso a extração
**saiu desta fase**:

- Os três instaladores copiam `CLAUDE.md` para `~/.farol/app` (`install.ps1:59`,
  `install.sh:97`, `install-linux.sh:48`) e `tools/make-package.ps1:34` o põe no zip.
- **`docs/` não viaja**: não está na lista de pastas de nenhum dos três instaladores nem
  do pacote.
- O `README.md` manda o usuário abrir o Claude Code na pasta do Farol e seguir "a seção
  macOS do `CLAUDE.md`", e quem só instalou tem a cópia de `~/.farol/app`.

Ou seja: extrair conteúdo para `docs/` deixaria o `CLAUDE.md` instalado apontando para
arquivos que não existem naquela máquina. A extração vira fase própria e exige uma
decisão antes (fazer `docs/` viajar, ou tirar o `CLAUDE.md` da distribuição). A spec já
foi atualizada com isso: a extração virou a Fase 1.5, e as duas saídas possíveis estão
descritas lá com o custo de cada uma.

## Restrições globais (valem em toda tarefa)

- **Zero dependências além do Electron.** Nenhum pacote npm, bundler ou transpilador.
- **Texto em português, sem travessão.** Vírgula, parênteses ou dois pontos.
- **Nada de mudança de comportamento.** Esta fase não toca em `lib/`, `ui/`, `server.js`
  nem `main.js`.
- **Nenhum arquivo muda de lugar nesta fase.** Nem raiz, nem `test/`, nem `ui/`.
- **Sem atribuição de IA** em commit ou PR (`Co-Authored-By`, "Generated with Claude
  Code" e variações são proibidos).
- **Gate por tarefa:** `npm run check && npm run lint && npm test` verde. Antes do push,
  `npm run eng`, com as avaliações de julgamento escritas para o head final pelo roteiro de
  `docs/QUALITY.md` (`repositoryId` = `farol`).
- **Caminho até a `main`:** branch, PR, CI verde, merge. Sem push direto e sem bypass de
  admin.

## Linha de base medida

A primeira medição foi no commit `7432f47` (14/09/2026): 2795 testes, 2772 pass, 0 fail, 23
skipped. A `main` andou depois disso (v2.59.3 e a adoção do eng-behaviour 0.12.0, PR #85), e a
medição que vale é a de 15/09/2026, sobre o conteúdo de `a74f2c0`, Windows, Node 24:

| medida | valor |
|---|---|
| `npm test` | 2824 testes, 2800 pass, **0 fail**, 24 skipped |
| `npm run eng` | 13 regras no escopo, verde com o baseline carregado |

Em 15/09/2026 foi conferido contra `a74f2c0` que tudo em que este plano se apoia continua
valendo: as listas dos quatro scripts de distribuição nas mesmas linhas (`install.ps1:59` e
`:69`, `install.sh:97` e `:103`, `install-linux.sh:48` e `:52`, `make-package.ps1:34`, `:38` e
`:47`), a seção `## Como funciona` do README, as mesmas 20 seções de primeiro nível do
`CLAUDE.md`, o parágrafo de abertura do CONTRIBUTING e zero link relativo quebrado nos guias.
O README ganhou uma seção de perguntas frequentes na v2.59.3; confira as linhas antes de
editar, porque os números de linha de trechos do README citados aqui podem ter andado.

A contagem de testes varia entre sistemas e versões do Node (há testes que só rodam em
POSIX). Compare sempre contra a contagem da MESMA máquina, medida antes de começar.

---

### Task 1: a trava de distribuição

O modo de falha mais caro deste repositório: criar ou mover pasta de topo sem atualizar
as quatro listas fixas quebra instalação e auto-update **sem erro na tela**. Já
aconteceu com `tools/`, e só apareceu no Mac de outra pessoa (PR #36, 29/08/2026). Hoje
nada testa isso. Esta tarefa fecha o buraco antes de qualquer fase que mova arquivo.

O teste não guarda uma lista própria: ele lê as quatro listas do fonte e compara umas com
as outras. Lista nova que nasça divergente reprova sozinha.

**Arquivos:**
- Criar: `test/distribuicao-listas.test.js`
- Ler (não modificar): `installer/install.ps1`, `installer/install.sh`,
  `installer/install-linux.sh`, `tools/make-package.ps1`

**Interfaces:**
- Consome: nada (primeira tarefa).
- Produz: `test/distribuicao-listas.test.js`, o guarda que as Fases 1 a 3 vão depender.

- [ ] **Passo 1: escrever o teste**

Crie `test/distribuicao-listas.test.js` com EXATAMENTE este conteúdo:

```js
// As listas do que viaja na instalação e no pacote são FIXAS e moram em quatro
// arquivos diferentes. Criar ou mover pasta de topo sem atualizar as quatro quebra
// instalação e auto-update sem nenhum erro visível (foi o caso de tools/, PR #36).
// Este teste não mantém lista própria: ele deriva as quatro do fonte e exige que
// concordem, do mesmo jeito que test/facades.test.js deriva as fachadas do server.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
// nome de arquivo ou pasta do repositório, pra separar a lista de distribuição de
// outros laços do mesmo script (o install.sh tem um `for d in /opt/homebrew/bin ...`)
const NOME_SIMPLES = /^[A-Za-z][\w.-]*$/;

const RE_PS = {
  f: /foreach \(\$f in @\(([\s\S]*?)\)\)/g,
  d: /foreach \(\$d in @\(([\s\S]*?)\)\)/g,
  t: /foreach \(\$t in @\(([\s\S]*?)\)\)/g,
};
const RE_SH = {
  f: /^for f in (.+); do$/gm,
  d: /^for d in (.+); do$/gm,
};

function listaPowershell(texto, variavel, arquivo) {
  const re = new RegExp(RE_PS[variavel].source, 'g');
  const achadas = [...texto.matchAll(re)].map((m) => (m[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1)));
  assert.equal(achadas.length, 1, `${arquivo}: esperava UMA lista de $${variavel}, achei ${achadas.length}`);
  return achadas[0];
}

function listaBash(texto, variavel, arquivo) {
  const re = new RegExp(RE_SH[variavel].source, 'gm');
  const achadas = [...texto.matchAll(re)]
    .map((m) => m[1].trim().split(/\s+/))
    .filter((itens) => itens.every((i) => NOME_SIMPLES.test(i)));
  assert.equal(achadas.length, 1, `${arquivo}: esperava UMA lista de ${variavel} com nomes simples, achei ${achadas.length}`);
  return achadas[0];
}

const INSTALADORES = {
  'installer/install.ps1': (t, a) => ({ arquivos: listaPowershell(t, 'f', a), pastas: listaPowershell(t, 'd', a) }),
  'installer/install.sh': (t, a) => ({ arquivos: listaBash(t, 'f', a), pastas: listaBash(t, 'd', a) }),
  'installer/install-linux.sh': (t, a) => ({ arquivos: listaBash(t, 'f', a), pastas: listaBash(t, 'd', a) }),
};

const listas = Object.fromEntries(Object.entries(INSTALADORES).map(([arq, fn]) => [arq, fn(ler(arq), arq)]));
const pacote = ler('tools/make-package.ps1');
const pacoteArquivos = listaPowershell(pacote, 'f', 'tools/make-package.ps1');
const pacotePastas = listaPowershell(pacote, 'd', 'tools/make-package.ps1');
const pacoteTools = listaPowershell(pacote, 't', 'tools/make-package.ps1');
const instalado = listas['installer/install.ps1'];

test('os tres instaladores copiam os mesmos arquivos de raiz e as mesmas pastas', () => {
  for (const [arq, l] of Object.entries(listas)) {
    assert.deepEqual(l.arquivos, instalado.arquivos, `${arq} diverge nos arquivos de raiz`);
    assert.deepEqual(l.pastas, instalado.pastas, `${arq} diverge nas pastas`);
  }
});

test('todo arquivo de raiz instalado viaja no pacote', () => {
  for (const f of instalado.arquivos) {
    assert.ok(pacoteArquivos.includes(f), `${f} e instalado mas nao entra no zip`);
  }
});

test('toda pasta instalada viaja no pacote', () => {
  for (const d of instalado.pastas) {
    // tools/ viaja por lista de ARQUIVOS nomeados no pacote (o resto da pasta é
    // ferramenta de build, não runtime), então a checagem aqui é do que é runtime
    if (d === 'tools') { assert.ok(pacoteTools.includes('jira-mcp.js'), 'tools/ viaja por arquivos nomeados e jira-mcp.js e runtime'); continue; }
    assert.ok(pacotePastas.includes(d), `a pasta ${d} e instalada mas nao entra no zip`);
  }
});

test('tudo que as listas nomeiam existe no repositorio', () => {
  for (const f of new Set([...pacoteArquivos, ...instalado.arquivos])) {
    assert.ok(fs.existsSync(path.join(RAIZ, f)), `${f} esta numa lista de distribuicao e nao existe`);
  }
  for (const d of new Set([...pacotePastas, ...instalado.pastas])) {
    assert.ok(fs.existsSync(path.join(RAIZ, d)) && fs.statSync(path.join(RAIZ, d)).isDirectory(), `${d} nao e pasta do repositorio`);
  }
  for (const t of pacoteTools) assert.ok(fs.existsSync(path.join(RAIZ, 'tools', t)), `tools/${t} nao existe`);
});
```

- [ ] **Passo 2: rodar e ver passar**

```bash
node --test --test-force-exit test/distribuicao-listas.test.js
```

Esperado: PASSA, 4 testes, 0 falhas. Aqui o teste nasce verde de propósito: ele descreve
um invariante que o repositório JÁ cumpre. Quem prova que ele morde é o passo seguinte.

- [ ] **Passo 3: contraprova 1, lista divergente entre instaladores**

Edite `installer/install.sh` e troque a linha 103 por:

```bash
for d in lib ui assets workspace-template installer tools docs; do
```

Rode de novo:

```bash
node --test --test-force-exit test/distribuicao-listas.test.js
```

Esperado: FALHA com `installer/install.sh diverge nas pastas`. Se passar, o parser não
está lendo a lista certa e o teste é inútil: pare e conserte antes de seguir.

Desfaça: `git checkout installer/install.sh`

- [ ] **Passo 4: contraprova 2, pasta instalada que não entra no zip**

Acrescente `docs` à lista de pastas nos TRÊS instaladores (linha 103 do `install.sh`,
linha 52 do `install-linux.sh`, linha 69 do `install.ps1`), sem tocar no
`make-package.ps1`. Rode de novo:

```bash
node --test --test-force-exit test/distribuicao-listas.test.js
```

Esperado: FALHA com `a pasta docs e instalada mas nao entra no zip`.

Desfaça: `git checkout installer/`

- [ ] **Passo 5: gate**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0`, `gate de qualidade: sem regressão`, e a contagem de testes igual à
linha de base mais 4. `tools/quality/gate.js` ignora `test/`, então este arquivo não
mexe na baseline.

- [ ] **Passo 6: commit**

```bash
git add test/distribuicao-listas.test.js
git commit -m "test: trava as quatro listas de distribuicao contra divergencia"
```

---

### Task 2: o mapa do código no README

A crítica do `main` no `package.json` é mal-entendido, e a correção é de documentação:
não existe no `README.md` uma linha dizendo que há duas entradas. Esta tarefa escreve
essa parte e trava contra apodrecimento: o teste deriva os scripts do `package.json` e
exige que o mapa os documente.

**Arquivos:**
- Criar: `test/guias-navegaveis.test.js`
- Modificar: `README.md` (acrescentar seção antes de "## Como funciona")

**Interfaces:**
- Consome: nada da Task 1.
- Produz: `test/guias-navegaveis.test.js`, que as Tasks 3, 4 e 5 vão AMPLIAR (mesmo
  arquivo, testes novos no fim).

- [ ] **Passo 1: escrever o teste**

Crie `test/guias-navegaveis.test.js` com EXATAMENTE este conteúdo:

```js
// Os guias do repositório (README, CLAUDE.md, CONTRIBUTING) são a porta de entrada de
// quem chega de fora. Mapa desatualizado é pior que mapa nenhum, então o que dá pra
// derivar do fonte é derivado, nunca curado à mão.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const README = ler('README.md');

test('o README tem o mapa do codigo', () => {
  assert.match(README, /^## Mapa do código$/m, 'faltou a seção "Mapa do código" no README');
});

test('o mapa do README documenta as DUAS entradas, com o comando de cada uma', () => {
  const pkg = JSON.parse(ler('package.json'));
  const mapa = README.split('## Mapa do código')[1] || '';
  assert.ok(mapa.includes('`main.js`'), 'o mapa não cita main.js');
  assert.ok(mapa.includes('`server.js`'), 'o mapa não cita server.js');
  for (const script of ['start', 'server']) {
    assert.ok(mapa.includes(`npm run ${script}`) || mapa.includes(`npm ${script}`),
      `o mapa não diz como rodar o script "${script}" (${pkg.scripts[script]})`);
  }
  assert.equal(pkg.main, 'main.js', 'o package.json deixou de apontar main.js e o mapa mente');
});

test('todo caminho do repositorio citado no mapa existe', () => {
  const mapa = README.split('## Mapa do código')[1].split('\n## ')[0];
  const citados = [...mapa.matchAll(/`([\w./-]+\/[\w./-]*|\w+\.js)`/g)].map((m) => m[1]);
  assert.ok(citados.length >= 4, 'o mapa cita menos caminhos do que o esperado, confira o teste');
  for (const c of new Set(citados)) {
    assert.ok(fs.existsSync(path.join(RAIZ, c)), `o mapa do README cita ${c}, que não existe`);
  }
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test --test-force-exit test/guias-navegaveis.test.js
```

Esperado: FALHA, `faltou a seção "Mapa do código" no README`.

- [ ] **Passo 3: escrever a seção no README**

Em `README.md`, insira a seção abaixo IMEDIATAMENTE ANTES da linha `## Como funciona`:

```markdown
## Mapa do código

O Farol tem **duas entradas**, e as duas estão corretas:

| entrada | o que é | como roda |
|---|---|---|
| `main.js` | o shell Electron: janela, bandeja, notificações, autostart | `npm start` (que é `electron .`, e o `electron` lê o campo `main` do `package.json`) |
| `server.js` | o engine puro, sem janela: polling do GitHub, fila, sessões de IA e o servidor HTTP + SSE que serve a interface | `npm run server` (que é `node server.js`) |

Por onde começar a ler, dependendo do que você quer mexer:

| quero mexer em | comece por |
|---|---|
| o que o app decide (revisar, aprovar, esperar) | `lib/engine/` |
| o que aparece na tela | `ui/pure.js` (funções puras, com teste) e `ui/app.js` |
| como o app fala com o GitHub | `lib/io.js` e `lib/engine/gh-queries.js` |
| como o app é instalado e atualizado | `installer/` e `lib/engine/update.js` |
| as regras de qualidade e o gate | `docs/QUALITY.md` e `tools/quality/` |

O guia completo do mantenedor, com os invariantes que reprovam um PR, é o
[`CLAUDE.md`](CLAUDE.md). Ele é grande de propósito: é a memória do projeto, e o índice
no topo dele leva direto ao assunto.
```

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test --test-force-exit test/guias-navegaveis.test.js
```

Esperado: PASSA, 3 testes, 0 falhas.

- [ ] **Passo 5: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0`.

```bash
git add README.md test/guias-navegaveis.test.js
git commit -m "docs: README ganha o mapa do codigo e as duas entradas"
```

---

### Task 3: o índice do CLAUDE.md

O `CLAUDE.md` tem 1832 linhas e 20 seções de primeiro nível. Ele continua sendo um
arquivo só (a extração é fase própria, ver o desvio no topo), mas ninguém precisa rolar
1832 linhas para achar a seção do Jira. O índice é gerado, não escrito à mão, e o teste
compara o índice com os títulos reais.

**Arquivos:**
- Modificar: `CLAUDE.md` (índice logo depois do primeiro parágrafo)
- Modificar: `test/guias-navegaveis.test.js` (acrescentar ao fim)

**Interfaces:**
- Consome: `test/guias-navegaveis.test.js` da Task 2.
- Produz: os marcadores `<!-- indice:inicio -->` e `<!-- indice:fim -->` no `CLAUDE.md`,
  que a fase de extração vai reusar.

- [ ] **Passo 1: escrever o teste**

Acrescente ao FIM de `test/guias-navegaveis.test.js`:

```js
/* O índice do CLAUDE.md é gerado, nunca escrito à mão: seção nova sem entrada no
   índice reprova aqui. O slug segue a regra do GitHub (minúsculas, pontuação fora,
   espaço vira hífen, acento fica). */
const slugDeTitulo = (t) => t.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').replace(/ /g, '-');

test('o indice do CLAUDE.md lista TODAS as secoes, na ordem, com ancora valida', () => {
  const guia = ler('CLAUDE.md');
  // por PREFIXO: o marcador de abertura carrega um comentário depois do nome
  const inicio = guia.indexOf('<!-- indice:inicio');
  const fim = guia.indexOf('<!-- indice:fim');
  assert.ok(inicio >= 0 && fim > inicio, 'o CLAUDE.md não tem o bloco de índice delimitado');
  const indice = guia.slice(inicio, fim);
  // os títulos saem do arquivo SEM o bloco do índice: o "## Índice" mora dentro dele e
  // listar a si mesmo seria ruído (e deixaria o teste impossível de satisfazer)
  const fora = guia.slice(0, inicio) + guia.slice(fim);
  const titulos = fora.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim());
  assert.ok(titulos.length >= 15, `esperava o CLAUDE.md com muitas seções, achei ${titulos.length}`);
  const esperado = titulos.map((t) => `- [${t}](#${slugDeTitulo(t)})`);
  const linhas = indice.split('\n').filter((l) => l.startsWith('- ['));
  assert.deepEqual(linhas, esperado, 'o índice do CLAUDE.md divergiu das seções do arquivo');
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test --test-force-exit test/guias-navegaveis.test.js
```

Esperado: FALHA, `o CLAUDE.md não tem o bloco de índice delimitado`.

- [ ] **Passo 3: gerar o índice**

Rode o gerador (ele só imprime, não escreve):

```bash
node -e "const fs=require('fs');const s=t=>t.toLowerCase().replace(/[^\p{L}\p{N} -]/gu,'').replace(/ /g,'-');for(const l of fs.readFileSync('CLAUDE.md','utf8').split(/\r?\n/))if(l.startsWith('## ')){const t=l.slice(3).trim();console.log('- ['+t+'](#'+s(t)+')');}"
```

No commit `7432f47` a saída é exatamente esta:

```markdown
- [O que é](#o-que-é)
- [Mapa de arquivos](#mapa-de-arquivos)
- [Invariantes do projeto (não negociar)](#invariantes-do-projeto-não-negociar)
- [Pontos com branch de plataforma](#pontos-com-branch-de-plataforma)
- [macOS: estado real e o que falta validar](#macos-estado-real-e-o-que-falta-validar)
- [Linux (experimental, v2.45.0)](#linux-experimental-v2450)
- [Modelo e esforço das sessões autônomas](#modelo-e-esforço-das-sessões-autônomas)
- [Assinatura do Claude (qual conta/plano o Farol usa, e como alternar)](#assinatura-do-claude-qual-contaplano-o-farol-usa-e-como-alternar)
- [Como rodar e testar sem estragar nada](#como-rodar-e-testar-sem-estragar-nada)
- [Jira multi-tenant (v2.52.0)](#jira-multi-tenant-v2520)
- [Menções navegáveis (regra de usabilidade, v2.40.1)](#menções-navegáveis-regra-de-usabilidade-v2401)
- [Um Farol por PR (v2.50.1): a lição do marcador transitório](#um-farol-por-pr-v2501-a-lição-do-marcador-transitório)
- [Dedup é por ROUND, não por "alguma vez" (v2.40.5)](#dedup-é-por-round-não-por-alguma-vez-v2405)
- [Re-revisão automática pós-push (v2.41.0): o round 2 fecha sozinho](#re-revisão-automática-pós-push-v2410-o-round-2-fecha-sozinho)
- [Autoanálise: parecer do modelo x decisão do app (P0a v2.54.8, P0b v2.55.0)](#autoanálise-parecer-do-modelo-x-decisão-do-app-p0a-v2548-p0b-v2550)
- [Checkpoint de verificação (memória entre passadas da revisão, v2.36.0)](#checkpoint-de-verificação-memória-entre-passadas-da-revisão-v2360)
- [Diagnóstico: ambiente x operação x runtime (v2.40.4, terceira dimensão na v2.53.3)](#diagnóstico-ambiente-x-operação-x-runtime-v2404-terceira-dimensão-na-v2533)
- [Governança do repositório público (17/08/2026)](#governança-do-repositório-público-17082026)
- [Versionamento (regras firmes; houve erro demais aqui)](#versionamento-regras-firmes-houve-erro-demais-aqui)
- [Release (checklist obrigatório)](#release-checklist-obrigatório)
```

Se a sua saída divergir dessa, use a SUA: o arquivo mudou desde o commit da medição, e
quem manda é o gerador.

- [ ] **Passo 4: inserir o índice no CLAUDE.md**

Em `CLAUDE.md`, logo DEPOIS da linha que começa com "Leia isto antes de mexer" e da linha
em branco seguinte, e ANTES de `## O que é`, insira:

```markdown
<!-- indice:inicio (gerado; test/guias-navegaveis.test.js reprova se divergir das seções) -->

## Índice

<COLE AQUI a saída do gerador do passo 3, as linhas "- [...](#...)">

<!-- indice:fim -->
```

Duas coisas importam aqui: o título `## Índice` fica DENTRO dos marcadores (o teste
ignora as seções que estão dentro do bloco, então o índice não lista a si mesmo), e o
bloco inteiro fica acima de `## O que é`.

- [ ] **Passo 5: rodar e ver passar**

```bash
node --test --test-force-exit test/guias-navegaveis.test.js
```

Esperado: PASSA, 4 testes, 0 falhas.

- [ ] **Passo 6: contraprova**

Acrescente uma seção qualquer no fim do `CLAUDE.md` (`## Teste de índice`) e rode o teste
de novo. Esperado: FALHA com `o índice do CLAUDE.md divergiu das seções do arquivo`.
Desfaça com `git checkout CLAUDE.md` e refaça o passo 4, ou apague a seção à mão.

- [ ] **Passo 7: gate e commit**

```bash
npm run check && npm run lint && npm test
```

```bash
git add CLAUDE.md test/guias-navegaveis.test.js
git commit -m "docs: indice navegavel no CLAUDE.md, derivado das secoes"
```

---

### Task 4: o CONTRIBUTING aponta o mapa

Hoje o `.github/CONTRIBUTING.md` repete os sete invariantes e manda ler o `CLAUDE.md`
inteiro. Quem chega de fora precisa antes de tudo saber ONDE as coisas estão.

**Arquivos:**
- Modificar: `.github/CONTRIBUTING.md`
- Modificar: `test/guias-navegaveis.test.js`

**Interfaces:**
- Consome: a seção "Mapa do código" criada na Task 2.
- Produz: nada que outra tarefa consuma.

- [ ] **Passo 1: escrever o teste**

Acrescente ao FIM de `test/guias-navegaveis.test.js`:

```js
test('o CONTRIBUTING manda o recem-chegado pro mapa do codigo', () => {
  const contrib = ler('.github/CONTRIBUTING.md');
  assert.ok(contrib.includes('README.md#mapa-do-código'),
    'o CONTRIBUTING não aponta para a seção "Mapa do código" do README');
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test --test-force-exit test/guias-navegaveis.test.js
```

Esperado: FALHA, `o CONTRIBUTING não aponta para a seção "Mapa do código" do README`.

- [ ] **Passo 3: editar o CONTRIBUTING**

Em `.github/CONTRIBUTING.md`, substitua o parágrafo de abertura (o que começa com
"Obrigado por olhar o código") por:

```markdown
Obrigado por olhar o código. O Farol é um app de desktop (Electron + Node puro) que
monitora Pull Requests e dispara revisões com o Claude Code.

Comece pelo [mapa do código](../README.md#mapa-do-código): ele diz quais são as duas
entradas do app e por onde começar a ler conforme o que você quer mexer. Depois leia o
[`CLAUDE.md`](../CLAUDE.md) (guia do mantenedor, manda nos invariantes do app; tem
índice no topo) e o [`docs/QUALITY.md`](../docs/QUALITY.md) (manda em como o código é
organizado e verificado).
```

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test --test-force-exit test/guias-navegaveis.test.js
```

Esperado: PASSA, 5 testes, 0 falhas.

- [ ] **Passo 5: gate e commit**

```bash
npm run check && npm run lint && npm test
```

```bash
git add .github/CONTRIBUTING.md test/guias-navegaveis.test.js
git commit -m "docs: CONTRIBUTING comeca pelo mapa do codigo"
```

---

### Task 5: link morto reprova

Esta é a trava que a fase de extração do `CLAUDE.md` vai precisar, e ela também cobre o
que as Fases 1 a 3 quebram ao mover arquivo: link relativo em guia apontando para lugar
que não existe mais. Hoje todos os links relativos dos guias resolvem (conferido em
14/09/2026), então o teste nasce verde e a contraprova é quem o valida.

**Arquivos:**
- Modificar: `test/guias-navegaveis.test.js`

**Interfaces:**
- Consome: os guias das Tasks 2 a 4.
- Produz: nada.

- [ ] **Passo 1: escrever o teste**

Acrescente ao FIM de `test/guias-navegaveis.test.js`:

```js
/* Link relativo quebrado é o modo de falha das fases que MOVEM arquivo: o guia
   continua parecendo certo e o destino sumiu. Vale pros guias da raiz e pro docs/,
   menos as pastas de método e de plano, que citam caminho de worktree que não existe
   mais de propósito. */
const GUIAS = ['README.md', 'CLAUDE.md', '.github/CONTRIBUTING.md', '.github/SECURITY.md', 'docs/QUALITY.md'];

test('todo link relativo dos guias aponta pra arquivo que existe', () => {
  for (const guia of GUIAS) {
    const base = path.dirname(path.join(RAIZ, guia));
    for (const m of ler(guia).matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const alvo = m[1];
      if (/^(https?:|mailto:|#)/.test(alvo)) continue;
      const arquivo = path.join(base, alvo.split('#')[0]);
      assert.ok(fs.existsSync(arquivo), `${guia} aponta pra ${alvo}, que não existe`);
    }
  }
});
```

- [ ] **Passo 2: rodar e ver passar**

```bash
node --test --test-force-exit test/guias-navegaveis.test.js
```

Esperado: PASSA, 6 testes, 0 falhas.

- [ ] **Passo 3: contraprova**

No fim do `README.md`, acrescente a linha `Veja [isto](docs/NAO-EXISTE.md).` e rode o
teste. Esperado: FALHA com `README.md aponta pra docs/NAO-EXISTE.md, que não existe`.
Apague a linha depois.

- [ ] **Passo 4: gate e commit**

```bash
npm run check && npm run lint && npm test
```

```bash
git add test/guias-navegaveis.test.js
git commit -m "test: link relativo quebrado nos guias reprova"
```

---

### Task 6: registrar no CLAUDE.md e fechar a fase

O `CLAUDE.md` é a memória do projeto. Trava nova que ninguém conhece é trava que a
próxima sessão remove por achar que é ruído.

**Arquivos:**
- Modificar: `CLAUDE.md` (seção "Como rodar e testar sem estragar nada")

A spec **já foi atualizada em 14/09/2026** com o desvio da Fase 0 (a extração virou
Fase 1.5), com a restrição 3.6 (as listas são quatro), com a 3.7 (o `app-carrega` é a
rede do `ui/`) e com a medição da Fase 1. Não reescreva aquilo aqui: confira que está
lá e siga.

**Interfaces:**
- Consome: tudo das Tasks 1 a 5.
- Produz: o registro que as fases seguintes leem.

- [ ] **Passo 1: registrar as travas no CLAUDE.md**

Na seção "Como rodar e testar sem estragar nada", acrescente como último item da lista:

```markdown
- **As travas de navegação e distribuição** (Fase 0 da reorganização, 14/09/2026):
  `test/distribuicao-listas.test.js` deriva as QUATRO listas fixas do que viaja
  (`install.ps1`, `install.sh`, `install-linux.sh`, `make-package.ps1`) e reprova
  divergência entre elas, que é o modo de falha silenciosa que já custou a pasta
  `tools/` no Mac (PR #36). `test/guias-navegaveis.test.js` trava o mapa do código no
  README contra os scripts do `package.json`, o índice do `CLAUDE.md` contra as próprias
  seções, e qualquer link relativo morto nos guias. Pasta de topo nova exige as quatro
  listas na MESMA tarefa, e uma instalação real a partir do zip antes do commit: suíte
  verde não prova que o instalador copiou o que precisava.
```

- [ ] **Passo 2: conferir que a spec está atualizada**

Abra a spec e confirme que a Fase 0 já diz que a extração do `CLAUDE.md` virou Fase
1.5, e que existem as restrições 3.6 e 3.7. Se faltar, a spec é que está atrasada:
atualize ela antes de seguir, porque é ela que as próximas fases leem.

- [ ] **Passo 3: gate**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0`, e a contagem de testes igual à linha de base mais 10 (4 da Task 1 e 6
da `guias-navegaveis`).

- [ ] **Passo 4: commit e PR**

```bash
git add CLAUDE.md
git commit -m "docs: registra as travas da fase 0 e adia a extracao do guia"
```

```bash
git switch -c docs/reorganizacao-fase-0 2>/dev/null; git push origin HEAD
gh pr create --fill
```

Antes do push, `npm run eng`. Desde o PR #85 ele passa na `main`, então **qualquer
reprovação aqui é desta fase** e tem que ser resolvida, nunca contornada com `--no-verify`.
As avaliações de julgamento seguem o roteiro de `docs/QUALITY.md`: uma por regra acionada,
com fundamentação própria sobre este diff e `repositoryId` = `farol`. Esta fase não toca
nenhum dos 15 arquivos do baseline de `core.file.single-responsibility`.

---

## O que já foi provado antes de este plano ser escrito

Nenhum dos testes acima é palpite. Em 14/09/2026 eles foram executados de verdade antes
de virarem plano, e as contraprovas também:

| teste | como foi provado |
|---|---|
| `distribuicao-listas` | rodado contra o repositório real: 4 passam. Mutação 1 (só o `install.sh` ganha `docs`) reprovou com `diverge nas pastas`; mutação 2 (os três instaladores ganham `docs`, o pacote não) reprovou com `a pasta docs e instalada mas nao entra no zip`. O repositório foi restaurado com `git checkout` em seguida. |
| `guias-navegaveis` | rodado num sandbox com o README, o CLAUDE.md e o CONTRIBUTING já editados como este plano manda: 6 passam. Acrescentar uma seção ao CLAUDE.md sem mexer no índice reprovou com `o índice do CLAUDE.md divergiu das seções do arquivo`, e um guia apontando para arquivo ausente reprovou nomeando o link. |

Isso importa por um motivo específico deste repositório: num plano executado por outro
agente, "os testes passaram" não é verificação, porque o executor tem poder sobre os
testes (a lição está em `docs/superpowers/metodo-plano-executavel/README.md`). As
contraprovas acima são o que impede uma trava de nascer decorativa.

## Verificação final da fase

| o que | como | esperado |
|---|---|---|
| nada mudou de lugar | `git diff --name-status main` | só `M` e `A`, nenhum `R` |
| nada de comportamento mudou | o mesmo diff | nenhum arquivo em `lib/`, `ui/`, `server.js`, `main.js` |
| a suíte cresceu só o previsto | `npm test` | linha de base + 10 testes, `fail 0` |
| a distribuição continua íntegra | `powershell -ExecutionPolicy Bypass -File tools\make-package.ps1` | `pacote limpo`, auditoria sem achado |

A instalação real a partir do zip **não é exigida nesta fase**, porque nenhum arquivo
mudou de lugar e as quatro listas não foram tocadas. Ela passa a ser obrigatória a partir
da Fase 1, em toda tarefa que mova arquivo ou crie pasta.

## O que esta fase deliberadamente NÃO faz

- **Não extrai o `CLAUDE.md`.** Ver o desvio no topo. Vira Fase 1.5, com decisão de
  distribuição antes.
- **Não toca em `ui/`, `test/` nem na raiz.** São as Fases 1, 2 e 3, cada uma com plano
  próprio escrito na hora de executar.
- **Não mexe no `package.json`.** `main: "main.js"` está correto para Electron.
- **Não troca a classe `Engine` por factory.** Fora de escopo declarado na spec.
