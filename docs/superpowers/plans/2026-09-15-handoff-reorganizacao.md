# Handoff: reorganização estrutural do Farol

> **Estado em 15/09/2026:** a reorganização está **planejada e não executada**. A spec e o
> plano da Fase 0 foram provados, corrigidos para a `main` de então (`a74f2c0`) e versionados
> junto com este handoff. No meio do planejamento houve um desvio pedido pelo
> Wanderson, que terminou: o eng-behaviour ganhou a v0.12.0 e o Farol já a adota. A próxima
> pessoa começa pela seção "Como retomar".

## O pedido e de onde ele veio

Em 13/09/2026 o cderick, que foi tutor do Wanderson, criticou a organização do repositório:
arquivos gigantes, raiz poluída, `test/` plano, "só patches e nenhuma refatoração" e um
suposto erro no `main` do `package.json`. O Wanderson pediu (14/09/2026) para continuar o
planejamento de forma autônoma, "com extremo cuidado", entendendo o ponto que leva a uma
refatoração completa.

A spec separa a crítica em três baldes, e isso orienta tudo o que vem depois:

- **Procede, e é pior do que ele disse:** o `ui/` (o `ui/app.js` tem 4391 linhas e o
  `ui/pure.js` 3401, num diretório sem subpasta), a raiz com 15 arquivos soltos e um
  `CLAUDE.md` de 190 KB, e `test/` com 178 arquivos no mesmo nível.
- **Já estava feito e ele não viu:** a decomposição do engine em `lib/` (Onda 2 do
  `docs/QUALITY.md`).
- **É mal-entendido:** `main: "main.js"` está certo para o Electron; falta o README dizer que
  o app tem duas entradas. Trocar a classe `Engine` por factory é preferência, e ficou fora de
  escopo declarado.

## Onde está cada coisa

| arquivo | estado | o que é |
|---|---|---|
| `docs/superpowers/specs/2026-09-14-reorganizacao-estrutural-design.md` | versionado | a spec: medição, crítica item a item, restrições 3.1 a 3.8, fases 0, 1, 1.5, 2, 3 e 4 |
| `docs/superpowers/plans/2026-09-14-reorganizacao-fase-0.md` | versionado | plano executável da Fase 0, seis tarefas, com código dos testes e contraprovas |
| `docs/superpowers/plans/2026-09-15-handoff-reorganizacao.md` | versionado | este documento |

Os três entraram na `main` pelo PR de documentação de 15/09/2026, que não mudou nada além
deles. Todo o trabalho desta atividade foi feito em worktree, e não no checkout principal,
porque outras sessões podem estar usando ele.

## O que já está provado

**Fase 0 (plano):** nenhum teste do plano é palpite.

- `test/distribuicao-listas.test.js` rodou contra o repositório real (4 testes). Duas
  mutações foram mortas: um instalador divergindo dos outros, e os três instaladores levando
  uma pasta que o pacote não leva.
- `test/guias-navegaveis.test.js` rodou num sandbox com o README, o `CLAUDE.md` e o
  CONTRIBUTING já editados como o plano manda (6 testes). As mutações foram mortas: seção nova
  sem índice e link morto.
- Em 15/09/2026 as premissas foram conferidas de novo contra `a74f2c0` e continuam valendo: as
  linhas das listas de distribuição, as 20 seções do `CLAUDE.md`, a seção `## Como funciona`
  do README, o parágrafo do CONTRIBUTING e zero link relativo quebrado.

**Desvios que a medição provocou na spec** (já escritos nela):

- **A extração do `CLAUDE.md` saiu da Fase 0 e virou Fase 1.5.** Os instaladores e o pacote
  levam o `CLAUDE.md` para `~/.farol/app`, e `docs/` não viaja, então extrair deixaria o guia
  instalado apontando para arquivos que não existem naquela máquina.
- **As listas fixas de distribuição são quatro, não três** (restrição 3.6), e nada as
  testava. A primeira tarefa da Fase 0 fecha isso.
- **A rede do `ui/` é o `test/app-carrega.test.js`** (restrição 3.7), que executa o `ui/app.js`
  contra um DOM de mentira.
- **Medição da Fase 1:** 21 arquivos de teste citam `ui/app.js` ou `ui/pure.js`; o `app.js`
  importa o `pure.js` uma vez só, o que viabiliza a quebra por reexport; o `pure.js` tem 171
  exports que não podem sumir nem mudar de grafia.

## O desvio no meio: eng-behaviour v0.12.0 e o baseline no Farol

Ao responder se a análise servia para melhorar o eng-behaviour, a medição achou um defeito
real. Das avaliações de `core.file.single-responsibility` do Farol, sete sobre o `ui/app.js`
saíram `conforme`, com a dívida escrita só na fundamentação. A causa estava no pacote: o
baseline finito da ADR-0004 só valia para regra automática. O Wanderson pediu para levar o
ajuste ao eng-behaviour, publicar a versão com notas, atualizar o Farol e só então voltar ao
planejamento. **Tudo isso está concluído:**

- **eng-behaviour [v0.12.0](https://github.com/wandersonaadsantos/eng-behaviour/releases/tag/v0.12.0)**, com PRs #11 e #12 e a ADR-0015.
  - Houve quatro rodadas de revisão adversarial, com três céticos por achado; o que
    sobreviveu foi corrigido com teste.
  - O PR #11 foi integrado pela conta do Wanderson antes das correções das duas últimas
    rodadas. Elas entraram pelo #12, antes da tag.
- **Farol [PR #85](https://github.com/wandersonaadsantos/farol/pull/85)**, merge `a74f2c0`:
  - recorte regenerado;
  - `tools/eng-behaviour/baselines.json` com **15 arquivos** que violam responsabilidade
    única;
  - gate com `--baselines` e `--repo-id farol`;
  - `test/eng-behaviour-baseline.test.js`;
  - seção "Dívida registrada de responsabilidade única" em `docs/QUALITY.md`, com a
    condição de fechamento de cada arquivo.

**Por que isso importa para a reorganização** (restrição 3.8 da spec): **a condição de
fechamento desses 15 arquivos é a própria reorganização.**

- Toda fase que mover um arquivo listado leva a assinatura junto, na mesma tarefa.
- Dividir um arquivo em dois que continuam violando não cabe no baseline.
- Arquivo que deixa de violar sai da lista na mesma entrega.
- O número descendo em `currentFindings` é a medida objetiva de progresso.

Os 15 arquivos:
- **Confiança alta:** `ui/app.js`, `ui/pure.js`, `server.js`, `lib/engine/review.js`,
  `lib/engine/selfpr.js`, `lib/engine/session.js`, `lib/engine/decision.js`, `lib/parse.js`
  e `lib/engine/skip-review.js`.
- **Confiança média:** `lib/engine/usage.js`, `lib/io.js`, `lib/format.js`,
  `lib/log-taxonomy.js`, `lib/engine/public-review.js` e `lib/taxonomy.js`.

`tools/` e `test/` também contam como código para o pacote e **não foram avaliados**.

Isso muda o peso da Fase 4 da spec. A spec dizia que o `server.js` residual "é legítimo nunca
fazer", mas agora o `server.js` está na dívida registrada, e aquela frase precisa ser revista
quando a Fase 4 for planejada.

## Pendências, em ordem

> **Atualização de 15/09/2026, fim do dia:** os itens 2 e 3 foram feitos. A **Fase 0 está na
> `main`** (PR #87, merge `144b0c1`) e a **Fase 1 foi medida e dividida em 1a, 1b e 1c**, com
> o plano da 1a escrito
> ([`2026-09-15-reorganizacao-fase-1a-pure.md`](2026-09-15-reorganizacao-fase-1a-pure.md)).
> Continua pendente o item 1, que é decisão do dono, mais a execução da 1a e os planos das
> demais.
>
> **Atualização de 15/09/2026, noite: a Fase 1a foi executada** (branch
> `refactor/ui-pure-fase-1a`). O `ui/pure.js` virou fachada de reexport, o conteúdo mora em
> 14 módulos de `ui/pure/` em camadas sem ciclo, a superfície pública (174 nomes) ficou
> congelada por teste, e o `ui/pure.js` saiu da dívida de responsabilidade única
> (`currentFindings` de 15 para 14). O que a execução corrigiu no plano está na seção
> "Registro da execução" do próprio plano. Próximo: o plano da Fase 1b (`ui/app.js`).

1. **Decisão do Wanderson na Fase 1.5**, que não pode ser tomada por quem executa. A escolha é
   entre fazer `docs/` viajar na distribuição (o pacote fica maior, e `docs/superpowers/`
   precisaria de recorte) ou tirar o `CLAUDE.md` dela (a cópia instalada perde o guia, e o
   README precisa parar de mandar o usuário de macOS abri-lo).
2. ~~**Executar a Fase 0**~~ feito em 15/09/2026, PR #87. Duas lições para as próximas: o
   código de teste que um plano traz pronto pode divergir da convenção do repositório, e pode
   repetir o que outro teste já decide; nos dois casos quem cobra é o `npm run eng`, não a
   suíte.
3. ~~**Escrever o plano da Fase 1**~~ feito em 15/09/2026, e a medição dividiu a fase em
   três: `ui/pure.js` (sem estado de módulo, grafo interno acíclico, testes que importam) e
   `ui/app.js` (bootstrap espalhado, `STATE` lido em 163 pontos, nove testes que recortam o
   fonte por regex de bloco) não têm o mesmo risco nem a mesma rede de segurança.
4. Depois: planos da Fase 1.5 (após a decisão), da Fase 2 (`test/`), da Fase 3 (raiz) e,
   revista, da Fase 4 (`server.js` e os demais arquivos da dívida em `lib/`).

## Como retomar

1. Ler a spec inteira, depois `docs/QUALITY.md` na seção "Dívida registrada de
   responsabilidade única", depois o plano da Fase 0.
2. Trabalhar numa worktree nova a partir da `origin/main`, e não no checkout principal:
   ```bash
   git -C C:/Users/wanderson/Documents/farol fetch origin
   git -C C:/Users/wanderson/Documents/farol worktree add -b docs/reorganizacao-planejamento .worktrees/reorganizacao origin/main
   ```
3. O rodapé "Antes de executar cada fase" da spec vale para todo PR daqui em diante: cada
   fase é pelo menos um PR próprio, e quem move arquivo instala a partir do zip antes do
   commit.
4. Antes de qualquer push: `npm run check && npm run lint && npm test`, e depois `npm run eng`,
   com as avaliações de julgamento escritas pelo roteiro de `docs/QUALITY.md`, uma por regra
   acionada, cada uma com fundamentação própria e `repositoryId` = `farol`.

## Cuidados que custaram caro nesta atividade

- **A conta ativa do `gh` volta sozinha para a conta de trabalho.** Para PR e release nos
  repositórios pessoais, `gh auth switch --user wandersonaadsantos` tem que ir no mesmo comando.
  Ao terminar, devolva a conta de trabalho. O push do Farol usa o alias SSH e não depende disso.
- **Suíte verde não prova que um teste protege nada.** Toda trava nova precisa de contraprova:
  remover o comportamento e ver o teste certo falhar, depois restaurar e conferir o arquivo.
- **Script Python no Windows grava CRLF.** Abrir arquivo com `newline=''` ou normalizar
  depois. O `.gitattributes` corrige no commit, mas a cópia de trabalho fica suja.
- **Nunca `git stash`** (a pilha é compartilhada com outras worktrees e sessões). Nunca apagar a
  junção de `node_modules` com `rm -rf`. Nunca atribuição de IA em commit ou PR. Nunca push
  direto nem bypass de admin na `main`.
- **Workflow longo não sobrevive à queda da sessão.** Duas rodadas de revisão morreram no meio.
  O diário (`journal.jsonl`) guarda o resultado de cada agente: leia antes de relançar, porque
  a síntese pode ser feita a partir dele.

## O que não precisa ser carregado

O scratchpad da sessão de 14 e 15/09/2026 é descartável. O que dele importava já está em lugar
permanente: a avaliação dos 15 arquivos está em `docs/QUALITY.md`, as notas da v0.12.0 estão na
release, e as correções das revisões estão nos PRs #11 e #12 do eng-behaviour e no #85 do Farol.
