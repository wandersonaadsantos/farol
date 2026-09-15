# Reorganização estrutural do Farol: diagnóstico e fases

> **Este documento é a SPEC, não o plano de execução.** Ele cobre cinco subsistemas
> independentes, e cada fase precisa do próprio plano detalhado na hora de executar
> (`superpowers:writing-plans`, salvando em `docs/superpowers/plans/`). Executar tudo
> de uma vez é o caminho mais rápido para quebrar instalação em silêncio.

**Origem:** revisão do cderick em 13/09/2026, por mensagem direta. Ele foi tutor do
Wanderson e a crítica é de quem conhece o assunto, então ela entra inteira, separada
em três baldes: o que procede, o que já estava feito e ele não viu, e o que é
mal-entendido de arquitetura.

**Objetivo:** deixar o repositório legível para quem chega de fora, sem quebrar
nenhum dos sete invariantes do `CLAUDE.md` e sem quebrar instalação nem auto-update.

**Não-objetivo:** reescrever comportamento. Nada aqui muda o que o app faz. Uma fase
que muda comportamento saiu do escopo e vira outra entrega.

---

## 1. O estado medido em 14/09/2026

Tudo abaixo foi medido no commit `27d2e1b`, não estimado.

### Arquivos de código, do maior para o menor

| arquivo | linhas | bytes |
|---|---|---|
| `ui/app.js` | 4391 | 349 KB |
| `ui/pure.js` | 3401 | 202 KB |
| `test/ui-pure.test.js` | 2986 | |
| `server.js` | 2129 | |
| `lib/engine/review.js` | 1979 | |
| `lib/engine/selfpr.js` | 1213 | |
| `lib/engine/session.js` | 1190 | |
| `lib/engine/decision.js` | 1126 | |

Fora do ranking de `.js`, mas relevantes: `ui/app.css` com 116 KB e
`ui/index.html` com 58 KB.

### Distribuição

| lugar | conteúdo |
|---|---|
| raiz | 15 arquivos soltos, 12 pastas |
| `ui/` | **5 arquivos, zero subpasta** |
| `lib/` | 63 arquivos em 5 diretórios (`engine` 28, `sync` 14, raiz 13, `jira` 6, `codex` 2), ~16 mil linhas |
| `test/` | **178 arquivos, todos no mesmo nível** |
| `docs/` | 4 arquivos + `evidencias/` + `superpowers/` |

### Guias na raiz

| arquivo | linhas | bytes |
|---|---|---|
| `CLAUDE.md` | 1832 | **190 KB** |
| `eng-behaviour.rules.md` | 722 | 55 KB |
| `README.md` | 135 | 13 KB |

---

## 2. A crítica, item a item

### 2.1 O que procede, e um item é pior do que ele disse

**A navegabilidade do `ui/` é o maior buraco do repositório, e ele não chegou a ver.**
Ele citou o `server.js` com "2k de linha" como exemplo de não modularizado. O
`server.js` tem 2129 linhas. O `ui/app.js` tem **4391** e o `ui/pure.js` tem **3401**,
os dois num diretório com cinco arquivos e nenhuma subpasta. A crítica dele está
certa no espírito e apontada para o arquivo errado: o `ui/` é o dobro do problema
que ele nomeou, e é onde o ganho de legibilidade é maior.

**A raiz está poluída.** Quinze arquivos soltos, incluindo três guias que somam
258 KB. O `CLAUDE.md` sozinho tem 190 KB, e ele é o mapa do projeto: quem chega de
fora é mandado para um arquivo de 1832 linhas para descobrir onde as coisas estão.

**`test/` com 178 arquivos planos.** A suíte é a maior prova de qualidade do
repositório e é o diretório mais difícil de navegar. Não há como olhar `test/` e
saber o que cobre o quê sem abrir arquivo.

**O argumento de fundo é correto e é o que importa.** "Para open source onde você
espera contribuição, a organização tem que ser legível, senão ninguém entende,
ninguém contribui." Isso não tem contra-argumento. O repositório é público, tem
CI, tem `CONTRIBUTING.md`, tem template de issue e de PR; só falta a parte que faz
alguém conseguir achar onde mexer.

### 2.2 O que já estava feito, e ele viu só a janela recente

Ele olhou o histórico a partir de um ponto e disse "não vi nenhuma refatoração, só
patches e mais coisa". A decomposição do engine aconteceu antes dessa janela, está
registrada em `docs/QUALITY.md` como Onda 2, e o resultado é medível: 63 arquivos e
~16 mil linhas em `lib/`, com o `server.js` reduzido ao papel de fachada que delega.
O `CLAUDE.md` descreve isso explicitamente ("hoje ~2/3 dos métodos são só fiação de
delegação").

Vale registrar sem ironia: **o contrato de qualidade do Farol foi extraído do
`lace-be-fastify`**, o repositório que ele apresentou como exemplo. Está escrito em
`docs/QUALITY.md`. A direção que ele aponta já é a direção que o projeto seguiu; o
que falta é ela ter chegado no `ui/`, no `test/` e na raiz.

### 2.3 O que é mal-entendido, e a correção é de documentação

> "Pra rodar você lança `node server`. Mas no seu `package.json` o `main` é o principal."

Os dois estão certos, e são entradas de coisas diferentes:

| entrada | o que é | como roda |
|---|---|---|
| `main.js` | shell Electron (janela, bandeja, notificações) | `npm start`, que é `electron .`, e `electron .` lê o `main` do `package.json` |
| `server.js` | o engine puro, sem janela | `npm run server`, que é `node server.js` |

`main: "main.js"` está correto: é exatamente o que o Electron exige. O que não
existe é uma linha no `README.md` explicando que há duas entradas e para que serve
cada uma. **A correção é escrever essas duas linhas, não mexer no `package.json`.**

> "Class pra Engine mas você usa a Engine uma vez apenas. Uma factory seria o suficiente."

Preferência de estilo, não defeito. Uma classe instanciada uma vez com estado,
ciclo de vida e ~90 métodos de fachada é um padrão legítimo. Trocar por factory não
melhora legibilidade nem testabilidade aqui, e mexeria em 63 arquivos e nos 64
testes que leem fonte como texto. **Fica fora de escopo, declarado, não esquecido.**

---

## 3. Restrições inegociáveis

Qualquer fase que ignore uma destas quebra o produto em silêncio. As duas primeiras
são as perigosas, porque falham sem erro visível.

**3.1 Os instaladores copiam listas FIXAS de arquivos e pastas.**

- `installer/install.ps1:59` lista os arquivos: `main.js`, `server.js`,
  `package.json`, `README.md`, `CLAUDE.md`
- `installer/install.ps1:69` e `installer/install.sh:103` listam as pastas:
  `lib`, `ui`, `assets`, `workspace-template`, `installer`, `tools`

Mover, renomear ou criar pasta de topo **sem tocar nos três instaladores** quebra a
instalação e o auto-update, sem erro na tela. Precedente registrado no `CLAUDE.md`:
a pasta `tools/` viajava no pacote desde a v2.53.2 mas os instaladores não a
copiavam, e o sintoma só apareceu no Mac do Guilherme, em 29/08/2026, como um
diálogo do Electron sem relação aparente com a causa (PR #36).

**3.2 64 arquivos de teste leem o fonte como TEXTO.**

`test/facades.test.js` faz parse do `server.js`; `test/ui-widgets.test.js` e
`test/ui-pure.test.js` casam regex contra `ui/app.js`; `test/release-consistency.test.js`
lê `package.json`, `CHANGELOG.md` e `ui/app.js`. Mover ou quebrar esses arquivos
exige atualizar os testes na mesma tarefa, nunca depois.

**3.3 Zero dependências além do Electron** (invariante 1). Nenhuma fase pode
introduzir bundler, transpilador ou ferramenta de módulo. O `ui/` é servido como
módulo ES nativo pelo navegador, e o `node --test` importa os mesmos arquivos.
Qualquer divisão de `ui/pure.js` tem que funcionar nos dois lados sem build.

**3.4 `tools/make-package.ps1` audita o zip** (invariante 7) e reprova pacote com
estado, config, token ou conta pessoal. Arquivo novo na raiz entra no radar dessa
auditoria.

**3.5 O caminho até a `main` é PR com CI verde**, e o pre-push roda
`check` + `lint` + `test` + `eng`. Sem bypass de admin (regra 5 de "Versionamento").
Cada fase é pelo menos um PR próprio.

**3.6 As listas fixas são QUATRO, não três.** Além dos três instaladores,
`tools/make-package.ps1:34` (arquivos de raiz), `:38` (pastas) e `:47` (arquivos de
`tools/` que viajam) decidem o que entra no zip, e o zip é o que o auto-update aplica.
A Fase 0 passa a derivar e comparar as quatro em `test/distribuicao-listas.test.js`, e
nenhuma fase que mexa em pasta de topo deve começar antes dessa trava existir.

**3.7 A rede de segurança do `ui/` é UM teste, e ele executa o código.**
`test/app-carrega.test.js` carrega `ui/app.js` de verdade contra um DOM de mentira e
dispara o handler de `state` do SSE, que chama ~15 funções de tela. Ele existe porque
dois bugs de runtime com sintaxe válida passaram por `check`, `lint`, `test` e CI verde
nos três sistemas (18/08/2026). Toda tarefa da Fase 1 depende dele continuar verde, e o
limite dele está escrito no próprio arquivo: verde não diz que a tela está certa, diz
que ela não explode. Abrir o app continua obrigatório.

**3.8 A reorganização é a condição de fechamento de uma dívida registrada** (desde
15/09/2026, PR #85). `tools/eng-behaviour/baselines.json` lista os 15 arquivos que violam
`core.file.single-responsibility` (entre eles `ui/app.js`, `ui/pure.js` e `server.js`), e a
condição de fechamento de cada um está em `docs/QUALITY.md`, seção "Dívida registrada de
responsabilidade única". Três consequências para toda fase que mexer nesses arquivos:

- **Arquivo listado que muda de caminho** ainda em violação leva a assinatura para o
  caminho novo na mesma tarefa; `test/eng-behaviour-baseline.test.js` reprova se isso
  ficar para trás.
- **Dividir um arquivo listado em dois que continuam violando não cabe no baseline**,
  porque a contagem subiria. A divisão precisa resolver a responsabilidade de verdade; o
  pedaço que ainda juntar assuntos reprova como dívida nova.
- **Arquivo que deixa de violar** sai da lista na mesma entrega: avaliação `conforme`, a
  assinatura removida de `known` e `currentFindings` baixado. É o número descendo que
  mede o progresso da reorganização.

---

## 4. As fases

Ordenadas por razão entre ganho e risco. Cada uma entrega valor sozinha e pode ser
publicada sem as seguintes.

### Fase 0: legibilidade sem mover um arquivo

**Risco: nenhum.** Não move, não renomeia, não quebra teste nem instalador.

O que entra:

1. **`README.md` ganha um mapa de entrada.** As duas entradas (`main.js` e
   `server.js`), o que cada uma faz, e "por onde começar a ler" apontando para
   `lib/engine/` e `ui/pure.js`. Isso responde sozinho a reclamação do `main`.
2. **`CLAUDE.md` ganha índice navegável**, gerado das próprias seções e travado por
   teste. **A extração por tema para `docs/` SAIU da Fase 0** (medição de 14/09/2026):
   os três instaladores e o pacote copiam o `CLAUDE.md` para `~/.farol/app`, e `docs/`
   não viaja em nenhuma das quatro listas. Extrair sem decidir isso deixaria o guia
   instalado apontando para arquivos que não existem naquela máquina, e o `README.md`
   manda justamente o usuário de macOS abrir esse arquivo. A extração vira a **Fase
   1.5**, e a decisão que ela exige antes é uma escolha entre fazer `docs/` viajar na
   distribuição ou tirar o `CLAUDE.md` dela.
3. **`CONTRIBUTING.md` aponta o mapa** em vez de repetir os invariantes.
4. **As travas mecânicas que as fases seguintes vão precisar**, que não existiam:
   `test/distribuicao-listas.test.js` (as quatro listas de distribuição, ver 3.6) e
   `test/guias-navegaveis.test.js` (mapa contra `package.json`, índice contra as
   seções, link relativo morto). Sem elas, as Fases 1 a 3 mexem em pasta de topo sem
   nenhuma rede.

**Plano detalhado:** [`docs/superpowers/plans/2026-09-14-reorganizacao-fase-0.md`](../plans/2026-09-14-reorganizacao-fase-0.md),
escrito em 14/09/2026, com as contraprovas das duas travas já executadas.

**Como provar:** `npm run check && npm run lint && npm test` verde, com a contagem de
testes igual à linha de base mais 10. Instalação a partir do zip não é exigida nesta
fase, porque nenhum arquivo muda de lugar e as quatro listas não são tocadas.

### Fase 1.5: extrair o `CLAUDE.md` por tema

**Risco: médio, e ele é de DISTRIBUIÇÃO, não de código.** Esta fase não pode começar
sem a decisão do dono, porque as duas saídas têm custo diferente:

| saída | o que implica |
|---|---|
| `docs/` passa a viajar | uma pasta a mais nas quatro listas, pacote maior, e o `docs/superpowers/` (specs, planos, método) iria junto ou precisaria de recorte |
| o `CLAUDE.md` sai da distribuição | a cópia instalada perde o guia, e o `README.md` precisa parar de mandar o usuário de macOS abrir "a seção macOS do `CLAUDE.md`" na pasta do app |

Só depois disso vale quebrar em `docs/SYNC.md`, `docs/REVIEW-GATES.md`,
`docs/MACOS.md` e `docs/RELEASE.md`, deixando o `CLAUDE.md` como sumário. O índice da
Fase 0 e o teste de link morto são o que torna essa quebra conferível.

### Fase 1: `ui/`, o maior ganho do repositório

**Risco: alto.** É onde os testes de fonte mais batem, e não há bundler.

**Medido em 14/09/2026, e muda o desenho da fase:**

- **21 arquivos de teste** citam `ui/app.js` ou `ui/pure.js`, e **14 citam o `app.js`**.
  Eles não quebram por mover arquivo, quebram por regex que deixa de casar quando o
  trecho muda de arquivo. Cada tarefa da fase corrige os seus, na mesma tarefa.
- **`ui/app.js` importa `ui/pure.js` uma vez só**, num `import { ... } from './pure.js'`
  com uma lista grande de nomes. Isso é o que faz a estratégia do reexport funcionar:
  quebrar o `pure.js` em `ui/pure/*.js` e deixar o `ui/pure.js` como
  `export * from './pure/...'` não exige tocar no `app.js` na mesma tarefa.
- **`ui/pure.js` tem 171 `export`.** É a fronteira a preservar: nenhum nome pode sumir
  nem mudar de grafia durante a quebra, senão a tela quebra em runtime com a suíte
  possivelmente verde.
- **`ui/index.html` carrega UM módulo** (`<script type="module" src="app.js">`) e UMA
  folha (`app.css`). Quebrar o `app.js` exige que os pedaços sejam importados POR ele,
  nunca por tags novas no HTML, senão a ordem de execução muda.

O que entra:

1. **Quebrar `ui/pure.js` (3401 linhas) por domínio**, mantendo um arquivo de
   reexport para não quebrar os imports existentes de uma vez: `pure/format.js`,
   `pure/sync.js`, `pure/usage.js`, `pure/review.js`, `pure/deliveries.js`,
   `pure/goto.js`. O `ui/pure.js` passa a ser só `export * from './pure/...'`.
2. **Quebrar `ui/app.js` (4391 linhas)** pelos mesmos domínios, depois de 1.
3. **`ui/app.css` (116 KB)** em parciais por seção, importadas por `@import` ou
   por múltiplos `<link>`, sem build.

**A trava que decide esta fase:** `ui/` é uma das seis pastas que os instaladores
espelham, então subpasta DENTRO de `ui/` viaja junto (o `robocopy /MIR` e o
`cp -R` são recursivos). Criar `ui/pure/` é seguro; criar uma pasta nova na RAIZ
não é. Confirmar isso na primeira tarefa da fase, com uma instalação real.

**Como provar:** além da suíte, abrir o app e navegar as quatro abas. O
`test/ui-contract.test.js` e o `test/ui-widgets.test.js` são os detetores de
destino morto e de estrutura.

### Fase 2: `test/` espelha `lib/`

**Risco: médio.** Move 178 arquivos; o `node --test` descobre por padrão, então a
descoberta não quebra, mas caminhos relativos dentro dos testes sim.

`test/engine/`, `test/sync/`, `test/jira/`, `test/ui/`, `test/installer/`.
Cada teste que faz `readFileSync` de fonte precisa do caminho corrigido.

**Como provar:** a contagem de testes antes e depois tem que ser idêntica
(2786 no commit `27d2e1b`). Contagem menor significa arquivo que deixou de ser
descoberto, e é o modo de falha silenciosa desta fase.

### Fase 3: a raiz

**Risco: alto, e é o mais fácil de subestimar.** Os instaladores listam arquivos da
raiz por nome.

`Instalar.cmd`, `Instalar.command`, `Desinstalar.cmd`, `Desinstalar.command` são
atalhos de duplo clique e **têm que continuar na raiz**, porque é lá que o usuário
os encontra ao descompactar. O que pode sair: `eng-behaviour.json` e
`eng-behaviour.rules.md` para `docs/` ou `tools/eng-behaviour/`.

**Regra desta fase:** cada arquivo movido exige o instalador atualizado **na mesma
tarefa**, e uma instalação real feita a partir do zip antes do commit.

### Fase 4: `server.js` residual

**Risco: baixo, ganho baixo.** É a fase que o cderick nomeou e a que menos entrega,
porque a decomposição já aconteceu. O que resta são ~90 fachadas de uma linha.

Se for feita: agrupar as fachadas por colaborador em vez de por ordem histórica, e
manter o `test/facades.test.js` verde (ele deriva do fonte, então ele acompanha
sozinho, mas o mapa `EXCECOES` dele precisa continuar batendo).

---

## 5. Ordem, e por que esta ordem

Fase 0 primeiro porque é risco zero e resolve sozinha duas das três críticas que
procedem (navegabilidade e o mal-entendido do `main`). É a melhor resposta por
esforço investido.

Fase 1 segunda porque é o maior ganho real e porque quanto mais o `ui/app.js`
cresce, mais caro fica. Ele cresceu 349 KB sem nenhuma barreira.

Fase 2 e 3 depois, porque são movimentação pura e o risco está concentrado nos
instaladores, que é onde este repositório já se queimou uma vez.

Fase 4 por último, e **é legítimo nunca fazer**. Registrar a decisão vale mais do
que executá-la por completude.

---

## 6. Fora de escopo, declarado

- **Trocar a classe `Engine` por factory.** Estilo, não defeito. Ver 2.3.
- **Mudar `main` no `package.json`.** Está correto para Electron.
- **Tirar `firebase/database.rules.json` do repositório.** Regra de Firebase é
  avaliada no servidor do Google e é artefato de deploy, feito para ser versionado;
  não existe banco central do Farol, cada pessoa aplica no projeto dela, e o arquivo
  não tem nenhum identificador. Os dois limites conhecidos das regras já estão
  documentados em `firebase/README.md`.
- **Qualquer mudança de comportamento.** Se uma fase precisar mudar o que o app faz
  para caber, a fase está errada.

---

## 7. Antes de executar cada fase

1. Escrever o plano detalhado da fase com `superpowers:writing-plans`, salvando em
   `docs/superpowers/plans/`.
2. Cortar branch própria. Uma fase, um PR.
3. Depois de qualquer movimentação de arquivo ou pasta: **instalar a partir do zip
   gerado** (`tools/make-package.ps1`) e abrir o app, antes do commit. A suíte verde
   não prova que o instalador copiou o que precisava.
4. `npm run check && npm run lint && npm test`, e `npm run eng` antes do push.
5. Registrar no `CLAUDE.md` o que mudou de lugar. O arquivo é a memória do projeto,
   e um mapa desatualizado é pior que mapa nenhum.
