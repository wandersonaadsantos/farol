# Meus PRs: faixa de prontidão (checks, reviewers, merge)

Data: 07/11/2026. Medido contra `origin/main` em v2.78.45 (03eb09a7).
Desenho: Claude Design, canvas "Farol · Meus PRs com prontidão"
(https://claude.ai/artifact/SdrLUMfUwyoKbmSefd71fN), artboards `Main` (interativo) e `Estados`.

## O pedido

No card de cada PR em Radar > Meus PRs, saber sem abrir o GitHub:

1. se os checks **obrigatórios** já passaram;
2. quem foi marcado como reviewer (e o que cada um fez);
3. se o PR é mergeável ou não, e por quê.

## O que o desenho decide

- **Duas densidades, Compacta (padrão) e Expandida** (pedido de 07/11/2026, depois de aprovar as telas:
  "tudo mais clean"). O seletor fica ao lado das sub-abas do Radar, vale para Pra mim, Meus PRs e Panorama e
  fica guardado como preferência da tela.
  - **Compacta**: uma linha por PR com barra de estado, ponto da conta, `repo#N`, título cortado, os três
    estados em forma curta ("6/6", "1/2", "Falta 1 aprovação") e o Merge só quando dá para mergear. A
    seta no fim abre o card cheio só daquele PR; a seta para cima, no card, recolhe. Sem branches, sem
    texto de apoio, sem os botões Analisar/Reviewers/Ocultar.
  - **Expandida**: o card como está abaixo, com a faixa de pílulas e o detalhe.
  - Trocar de densidade recolhe o que estava aberto. O resumo "1 pronto · 2 esperando · 1 travado" fica nas duas.
- **Pra mim na mesma régua** (artboard `PraMim`):
  - No topo, uma linha de resumo que leva a cada seção: "1 analisando · 2 precisam de você · 1 se resolve
    sozinho · 2 na fila · 2 resolvidas hoje".
  - Compacta: as seções continuam (Analisando agora, Precisa de você, Resolução automática, Sua fila), sem o
    parágrafo de explicação, uma linha por PR com autor, `repo#N`, título, o estado numa frase ("Aprovar com 2
    ressalvas", "Esperando e2e · posta sozinho", "1º na fila") e uma ação só, a principal (Aprovar, Pedir
    mudanças, Revisar, Cancelar); Resolução automática não tem ação. A sessão rodando mostra a barra fina do
    tempo típico. Revisões recentes vira uma linha "2 resolvidas hoje · mostrar".
  - A seta abre o card cheio daquele PR, com todas as ações (Aprovar, Pedir mudanças, Comentar, Pular) e os
    motivos e ressalvas.
  - Expandida: os cards de hoje, com os parágrafos de explicação e Revisões recentes aberta.
  - Fora do desenho, ficam como estão: Intervenções, "Seus aparelhos" e as seções da sincronização.
  - **Prontidão também nos PRs de Pra mim** (07/11/2026): cada PR das seções Analisando agora, Precisa de
    você, Resolução automática e Sua fila mostra checks obrigatórios, reviewers e merge. Na Compacta, os três
    em forma curta ao lado do estado ("7/7", "1/2", "Falta a sua"); no card cheio, a faixa de três pílulas.
    Reviewers inclui você ("Gabriel aprovou, falta você"). Revisões recentes não leva prontidão.
- **Panorama na mesma régua** (artboard `Panorama`):
  - Continua lista de linhas com a sua revisão destacada, a busca por URL no topo e o botão ou o estado no
    fim de cada linha (Revisar, Na fila, aguardando você, aguardando o autor, nada a fazer).
  - Compacta: linha com autor, `repo#N`, selo da sua revisão quando há (você aprovou, você pediu mudanças),
    título e **três pontos coloridos** (checks, reviewers, merge), com o texto completo no título do elemento
    e uma legenda curta acima da lista. A seta abre a linha.
  - Expandida (ou linha aberta): branches, autor, atualizado, quem mais está revisando e as três pílulas.
  - Como o Panorama tem dezenas de PRs, a prontidão dele vem da mesma consulta por conta, estendida para os
    PRs do Panorama (decisão de custo a medir antes de implementar).
- **Uma faixa com três pílulas** logo abaixo do cabeçalho do card, na ordem Checks, Reviewers, Merge.
  Cada pílula é um `<button>` com rótulo, valor curto e ícone; Reviewers carrega os avatares.
- **Clicar numa pílula abre o detalhe** dela embaixo da faixa (uma por vez por card, estado só da tela,
  igual ao `meusAbertos` de hoje): lista dos checks exigidos no head, lista dos reviewers com o estado de
  cada um, e a lista do que o GitHub exige para mergear.
- **Cinco tons, nenhuma cor nova**: `--ok` resolvido, `--danger` trava, `--accent` espera alguém,
  `--info` o GitHub está rodando, `--muted` não se aplica. São os apelidos `--settled`, `--blocked`,
  `--urgent`, `--working` e `--ambient` que o `app.css` já define.
- **A barra esquerda do card passa a seguir a pílula Merge** quando não há autoanálise. Com autoanálise,
  continua a regra de hoje (`BARRA_DO_SELO`), para não ter duas leituras do mesmo estado.
- **Resumo no topo da lista**: "1 pronto pra merge · 2 esperando · 1 travado".
- **O botão Merge não muda de regra**: continua dependendo da autoanálise elegível (`canMergeSelfAnalysis`).
  A pílula informa; o botão autoriza. Isso fica escrito no detalhe do Merge.

O catálogo completo de estados está no artboard `Estados`. Resumo:

| Pílula | Verde | Azul | Âmbar | Vermelho | Cinza |
|---|---|---|---|---|---|
| Checks obrigatórios | todos verdes | algum rodando, nenhum falhou | exigido nunca reportado no head | algum falhou (nome, se for um só) | branch sem exigência |
| Reviewers | aprovações no head somam o exigido | | marcado sem aprovação suficiente; aprovação em commit antigo | CHANGES_REQUESTED aberto | ninguém marcado / não exigido |
| Merge | CLEAN, UNSTABLE, HAS_HOOKS | BLOCKED só por check rodando | BLOCKED por review; BEHIND | DIRTY/CONFLICTING; check falhando; mudança pedida | DRAFT, repo bloqueado, UNKNOWN |

## O que já existe no código (medido)

| Dado | Onde | Limite de hoje |
|---|---|---|
| Lista de Meus PRs | `lib/engine/gh-queries.js:56`, `gh search prs --json url,title,isDraft,author,number,repository,updatedAt,labels` | não traz checks, reviews nem mergeabilidade |
| Mergeabilidade | `selfpr.js` `fetchMergeState` / `refreshMergeStates` → `estado().mergeStates` | **só para PR com autoanálise elegível** e fora de `mergeBlockedRepos`; os dois PRs da tela de hoje não têm nada |
| Checks exigidos da branch | `checks-exigidos.js` `checksExigidosDoRepo` (cache `repo@base`), `checksExigidosVerdes`, `ultimaRodadaPorNome`, exclusão de `dono/review` | só roda no gate de lançamento automático; nada chega à UI |
| Reviewers pedidos e reviews | `pedido-de-revisao.js:27` lê `reviewRequests,reviews` | só para saber se a conta ainda é pedida; nada chega à UI |
| Ruleset da base | `selfpr.js` `fetchRuleBlocked` (`repos/{repo}/rules/branches/{base}`, cache 30 min) | só devolve booleano; não lê `required_approving_review_count` |
| Conflito, mergeabilidade e head de TODO PR meu | `meus-prs-base.js` (`CONSULTA_DOS_MEUS`): UMA consulta GraphQL por conta e ciclo, já traz `mergeable mergeStateStatus baseRefName baseRefOid headRefOid` → `estado().baseDosMeusPRs` | o `mergeStateStatus` já chega para todos, mas a tela só usa para o aviso de conflito/superado |

## O que falta construir

1. **Estender a consulta que já existe, sem chamada nova por PR.** `CONSULTA_DOS_MEUS` em
   `meus-prs-base.js` ganha `isDraft reviewDecision`, `reviewRequests(first:20){nodes{requestedReviewer{... on User{login} ... on Team{slug}}}}`,
   `latestReviews(first:20){nodes{author{login} state commit{oid} submittedAt}}` e
   `commits(last:1){nodes{commit{statusCheckRollup{contexts(first:100){nodes{... on CheckRun{name status conclusion startedAt} ... on StatusContext{context state}}}}}}}`.
   Continua UMA chamada por conta e ciclo. A interpretação vai para um módulo novo
   (`lib/engine/prontidao-meus-prs.js`), para o `meus-prs-base.js` seguir dono só da base:
   - checks: `checksExigidosDoRepo` + `ultimaRodadaPorNome` + a mesma régua de verde de `checksExigidosVerdes`
     (SUCCESS, SKIPPED, NEUTRAL), separando rodando de falhou e de nunca reportado;
   - reviewers: `reviewRequests` (pessoa ou time) unido ao autor de cada `latestReviews`, com o estado e o
     `commit.oid` da review comparado ao `headRefOid` (aprovação só conta no head, mesma régua da memória
     do time); `reviewDecision` como sinal do GitHub;
   - aprovações exigidas: estender a leitura de `rules/branches/{base}` para trazer
     `parameters.required_approving_review_count` e `require_code_owner_review` (mesmo cache).
   - grava `estado().prontidao[key] = { at, headSha, checks, reviewers, merge }` e manda no snapshot.
2. **Pura de UI** (`ui/pure/prontidao.js`): recebe o registro e devolve as três pílulas (tom, rótulo, valor,
   avatares) e as linhas do detalhe. É onde moram as tabelas de estado acima, testada sem rede.
3. **Card** (`ui/telas/meus-prs.js`): faixa e detalhe; barra esquerda pela pílula Merge sem autoanálise.
4. **CSS** (`ui/app.css`): `.mypr-prontidao`, `.pill` com os cinco tons sobre as variáveis existentes; tema
   claro sai de graça pelas mesmas variáveis.
5. **`refreshMergeStates` continua** como está (decide os botões auto-merge/admin); o leitor novo é a fonte da
   pílula. Quando os dois existirem para o mesmo PR, o mais recente vence, pelo `at`.

## Riscos e decisões em aberto

- **Custo de `gh`**: zero chamada nova por PR (a consulta por conta só engorda). O custo novo é a leitura
  da regra da branch, uma por `repo@base`, em cache (já existe para os checks exigidos). Ponto a medir: o
  `search` com `first:50` e os `contexts(first:100)` em conta com muitos PRs abertos (custo de pontos do GraphQL).
- **Proteção clássica de branch**: `rules/branches` só enxerga ruleset. Repo com proteção clássica não informa
  aprovações exigidas por ali; nesse caso a pílula cai em `reviewDecision` (REVIEW_REQUIRED/APPROVED) e o
  detalhe diz "regra da branch não legível".
- **Time como reviewer**: aparece como um item com o nome do time; não abre os membros.
- **Veredito de bot** (`acrity/review`): fica fora da conta de checks, como no gate atual, e o detalhe diz isso.
- **Conta que lê**: a mesma do `accountForPr`; nada é escrito no GitHub por esta feature.
