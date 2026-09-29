# Admin observador: a mesa de controle do conjunto

Data: 28/09/2026. Decisões do dono tomadas nesta data, em conversa.

> **Revisto em 28/09/2026 à noite (v2.64.2), por decisão do dono.** O admin é o aparelho
> mais capaz do conjunto e o que o dono usa todo dia, então ele **volta a revisar a
> própria fila**, por todos os caminhos: clique, ciclo automático, re-revisão, retry,
> autoanálise, pushback, distribuição e comandos. Caiu tudo o que a fase 2 barrava com o
> código `observador`, e caiu a linha "quem cuida" da fila do admin (seção 2.3), que só
> existia porque ele não executava. Continua valendo: a fase 1 (execução amarrada à
> conta), a fase 3 (feed ao vivo e decisão com o review completo) e a fase 4 (só o admin
> vê a frota e decide pelos outros). O objetivo declarado é o celular ficar no canto,
> revisando a conta dele, e tudo ser acompanhado e decidido pelo computador.

## O problema, medido

Em 28/09/2026 o `Farol-Android-Velho` revisou PRs da própria conta (`engine-ai#314`, `biud-frontend#1211`) e o time viu o autor "revisando" o próprio trabalho. A v2.63.4 fechou a porta do PR próprio. O mapeamento que veio depois mostrou um problema maior, de papel:

1. **O admin executa como qualquer aparelho.** Publica candidato, aceita atribuição, revisa a própria fila. "Tomar para este aparelho" traz a revisão de outro aparelho para ele.
2. **A execução não é amarrada à conta.** O `tomar` não confere conta nenhuma; a revisão tomada roda com `accountForPr` LOCAL, que cai na conta primária. Como o lease é por conta, a tomada com outra conta nem trava a origem, e os dois aparelhos podem postar.
3. **A fusão de candidatos junta contas diferentes.** O item é `prTag_matTag`, sem a conta. Um PR que pediu revisão a duas contas, cada uma num aparelho do conjunto, vira UM item: só uma das duas revisões acontece.
4. **A transferência confere conta de forma grosseira.** `token` é o `gh auth` global da máquina, não o token daquela conta.
5. **O admin decide às cegas.** O card de pendência mostra veredito e a contagem de motivos. O review existe no histórico cifrado, sem ligação com o card.
6. **Não existe separação de tela.** Todo aparelho vê a frota inteira; quem não é admin vê botões que viram nota.

## As decisões do dono

| pergunta | decisão |
|---|---|
| O admin executa? | **Nunca.** Ele assiste e decide. |
| PR de conta que só o admin tem | **Ninguém revisa sozinho.** Fica visível no admin como "sem aparelho com a conta". |
| O que o admin vê para decidir | **O review completo:** corpo, inlines, veredito, motivos. O post sai do aparelho dono, com a conta dele. |
| Quão ao vivo | **Feed de atividade**, as mesmas linhas que o aparelho dono mostra, cifrado. Nada de código nem de texto do modelo. |
| Quem não é admin | **Só o próprio trabalho.** A visão da frota é exclusiva do admin. |
| Abordagem | **Ser admin é ser observador**, sem chave a mais. |

## Princípio

O conjunto tem dois papéis e nenhum estado intermediário:

- **Executor**: todo aparelho que não é o admin. Revisa o que a PRÓPRIA conta dele pode revisar. Nunca revisa com outra identidade.
- **Admin (observador)**: assiste tudo ao vivo e decide pelos executores. Não abre revisão, não publica candidato, não aceita atribuição, não toma.

Deixar de ser admin (outro aparelho assumiu a geração) devolve o aparelho a executor, sem configuração.

## Fase 1. Execução amarrada à conta

Vale para todo aparelho, admin ou não, e é pré-requisito das outras fases.

**1.1 A conta entra na identidade do candidato.** `candidato.candidatoDe` passa a derivar o material do item de `head + conta` (`matContaTag(kId, head, conta)`, domínio `mat` com pré-imagem `head\0login`). Consequências:

- dois aparelhos com contas diferentes no mesmo PR e head geram dois itens, e as duas revisões acontecem;
- o formato continua `hex_hex`, então as regras do banco não mudam e não há deploy do Firebase;
- quem executa recalcula com a conta LOCAL (`accountForPr`): conta diferente dá tag diferente e a recusa sai por construção.

O `matTag` do andamento e do histórico continua sendo só do head, porque o histórico usa essa tag para ligar revisões ao mesmo PR. Só a identidade do CANDIDATO muda.

**1.2 Recusa com nome.** `aceitarAtribuicoes`, `adotarUm` (transferência) e o comando `iniciar` recusam com `conta_diferente` quando a conta local não é a do item, em vez de `head_mudou`. O código ganha rótulo no mapa `CODIGO` da UI.

**1.3 Credencial por conta.** A presença publica `contasComToken`: as `acctTag` das contas configuradas que têm token AGORA (`tokenFor(login)`), em lugar do booleano global. `transferencia.destinoApto` exige a `acctTag` do item nessa lista. Aparelho antigo, sem o campo, não é destino (falha fechada).

**1.4 `tomar` exige a conta.** O comando passa a levar `acctTag`; o alvo recusa com `conta_diferente` quando a conta local para aquele PR não é a do comando, e com `observador` quando o alvo é o admin. Na fase 3 o botão sai da tela do admin.

**Transição.** Aparelho antigo publica candidato com material só do head; aparelho novo não reconhece esse item como seu e ele vence pelo TTL. O efeito é o de hoje (o item volta ao ramo local de quem publicou). O auto-update fecha a janela.

## Fase 2. Admin observador

**2.1 Quem é o admin, localmente.** Pura, em `lib/sync/papel.js`: `ehObservador({ sinais, deviceId, temChaveDeAdmin })`.

- com sinal do banco: observador se e só se `sinais.admin.dev === deviceId`;
- sem sinal (desconectado, antes do primeiro batimento): observador se tem chave de admin local. Falha FECHADA: admin que perdeu a rede não volta a executar, e um aparelho que deixou de ser admin enquanto estava fora só volta a executar quando o sinal do banco mostrar outro admin.

**2.2 Onde a regra vale** (`observador` como código único):

| porta | efeito |
|---|---|
| `check()` → `toReview` | o admin não lança revisão automática |
| `launchReview` (clique) | recusa com aviso: "este aparelho é o admin: ele assiste e decide" |
| `enqueueHeadless` | recusa `observador` (boca única de toda revisão headless) |
| `admissao.requisitoDuro` | `observador` para `review`, `self` e `pushback` |
| `estadoDoAparelho` do agendador | admin nunca é apto, motivo `observador` |
| `aceitarAtribuicoes`, `tomar`, `iniciar`, `repetir` | recusa `observador` |
| `launchSelfAnalysis`, varredura de pushback | não rodam no admin |

`chat` e `tool` continuam: são conversa da pessoa na frente do aparelho, não execução do conjunto.

**2.3 A fila do admin explica quem cuida.** Cada PR da fila do admin mostra uma de três situações, calculadas pelas `contasComToken` da presença dos outros aparelhos:

- "o `<aparelho>` cuida desta revisão": existe aparelho não admin com a conta;
- "revisando no `<aparelho>`": já há operação ao vivo para ele;
- "sem aparelho com a conta `<conta>`": nenhum executor tem a conta. É o caso das contas que só o admin tem, e a revisão não acontece sozinha, por decisão do dono.

## Fase 3. Transmissão ao vivo e decisão com o review completo

**3.1 Feed ao vivo.** A projeção do andamento (`lib/sync/andamento.js`) ganha `feed`: as últimas linhas de `engine.activity` da sessão, na ordem, cada uma cortada em 140 caracteres, com orçamento total para o nó caber no limite de 2048 caracteres cifrados das regras (a função corta do mais antigo até caber). O conteúdo é o que o aparelho dono já mostra na tela dele. A escrita continua no ritmo atual (mínimo de 10 s entre escritas da mesma operação), então o admin vê o feed com até ~10 s de atraso.

**3.2 O card ao vivo no admin** mostra aparelho, conta (nome, não tag), PR, etapa, tempo, modelo, subagentes pelo nome e o feed, com as ações **Cancelar** e **Transferir** (esta só lista destinos com a conta, regra 1.3). "Tomar para este aparelho" deixa de existir.

**3.3 A pendência aponta para o review.** A projeção da pendência ganha `reviewId`, a mesma tag que o histórico usa para aquela decisão (`reviewIdDe(kId, dev, idLocal)`). O histórico passa a guardar no corpo, além do `reportMarkdown`, os payloads por ação (corpo e inlines de aprovar, pedir mudanças e comentar), dentro do limite de 48 mil do corpo; o que não couber é cortado com aviso no próprio corpo.

**3.4 A decisão no admin.** O card de pendência mostra veredito, os motivos por extenso e o botão **Ver review completo**, que abre corpo e inlines. As ações são as que o `decide` do aparelho dono aceita e que têm payload: **Aprovar**, **Pedir mudanças**, **Só comentar** e **Pular**. O comando `decidir` passa a levar `acao` nesse vocabulário (`approve`, `request_changes`, `comment`, `skip`); `reject` continua aceito como `request_changes` para admin antigo. Quem posta é o aparelho dono, com as travas e a conta dele. Sem edição de texto (decisão do dono).

## Fase 4. Quem não é admin vê só o próprio trabalho

- As seções "Em outros aparelhos", "Precisa de você em todos os aparelhos", "Esperando colocação no conjunto" e "Revisões de todos os aparelhos" só existem no admin (`adminParaTela.souEu`).
- O executor mostra o próprio trabalho, como antes da sincronização.
- Quando o admin decide uma pendência do executor, o executor registra na atividade e num toast: "o admin decidiu <ação> em <PR>".

## O que NÃO muda

- Regras do banco (nenhum deploy do Firebase).
- O gate de postagem (invariante 4): quem posta é o aparelho dono, com os gates dele.
- A sessão de terminal por clique continua fora da coordenação, e no admin ela também é recusada (é execução).

## Testes

Cada fase entra com teste de comportamento que falha sem a mudança:

- fase 1: fusão de duas contas gera dois itens; executor com conta diferente recusa `conta_diferente`; destino sem token da conta não é apto; `tomar` sem a conta recusa;
- fase 2: `ehObservador` nas três situações de sinal; admin não lança, não enfileira, não é escolhido e não aceita; executor segue igual; a fila do admin classifica as três situações;
- fase 3: o feed respeita o orçamento de 2048; a pendência leva o `reviewId` que o histórico usa; o corpo do histórico leva os payloads; `decidir` com as quatro ações e o legado `reject`;
- fase 4: as seções da frota não renderizam fora do admin; o executor avisa a decisão remota.

## Entrega

Uma branch, quatro commits (um por fase), um PR. Release **v2.64.0**: o núcleo é capacidade nova (a mesa de controle do admin), e a fase 1 é o conserto que ela exige. Todo aparelho do conjunto precisa atualizar; aparelho antigo convive pela regra de transição da fase 1.
