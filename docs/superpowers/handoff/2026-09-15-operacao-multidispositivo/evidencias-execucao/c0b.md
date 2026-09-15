# Evidência: C0b Arbitragem de postagem no funil e co-assinatura coordenada

Plano: `docs/superpowers/plans/2026-09-15-md-c0b-arbitragem-postagem.md`. Branch `md/c0b`, cortada da ponta de `md/integracao` já com C1a, C0, A5, A1 e A4.

## Estado

Implementada e validada localmente, nas onze tarefas do plano. A dependência da C0 (`syncAtualizarPublicacao` em `lib/engine/sync.js`) existia na ponta, conforme a Tarefa 0 exige.

Com a coordenação DESLIGADA nada muda: `test/postagem-coordenacao-desligada.test.js` nasceu verde contra o código anterior à mudança e continua verde depois de todas as tarefas, comparando as chamadas ao `gh` argumento a argumento e o conteúdo exato do arquivo `--input`.

## Gate

    npm run check && npm run lint && npm test

| Medida | Antes (`md/integracao` com A1 e A4) | `md/c0b` |
|---|---|---|
| arquivos do `check` | 333 | 353 |
| `tests` | 3108 | 3191 |
| `pass` | 3082 | 3165 |
| `fail` | 0 | 0 |
| `skipped` | 26 | 26 |
| lint | sem regressão | sem regressão |

Windows 11, Node v24.15.0. Caracterização isolada, rodada de novo no fim: `node --test test/postagem-coordenacao-desligada.test.js` → 9 testes, 9 aprovados, 0 falhas.

Nenhum teste existente foi editado: `git diff --name-status md/integracao...HEAD -- test/` devolve só linhas `A` (13 arquivos novos, dois deles helpers).

## Critério de aceite x teste

| Critério (7.C0b e CT-POST) | Teste |
|---|---|
| duas co-assinaturas concorrentes geram um único POST | `coassinatura-coordenada`: "duas co-assinaturas concorrentes..." |
| co-assinatura x revisão normal: um único POST | "co-assinatura concorrendo com revisão normal...", "co-assinatura que sai primeiro..." |
| HEAD mudando entre a conferência e o POST | "HEAD mudando entre a conferência e o POST", `postagem-arbitragem`: "commitIdObrigatorio com head que andou..." |
| recuo sem âncora não é tentado | "422 na co-assinatura...", "recuoPermitido false: nenhuma segunda chamada..." |
| aceite seguido de queda: `enviando`, sem repost, reconciliação confirma | `postagem-incerta`: "publicação aceita e queda antes do desfecho" |
| queda na fronteira só vira `nao_enviada` com as duas leituras | "queda na fronteira...", `postagem-reconciliacao` (regras puras) |
| posse perdida na espera da fila: `io.run` não é chamado | `postagem-arbitragem`: "posse perdida durante a espera na fila por processo" |
| posse vencida depois de suspensão não posta | "retomada depois de suspensão..." |
| reenvio com `enviando` pendente não posta nem gasta tentativa | `postagem-vias`: "reenvio automático com enviando pendente..." |
| dois cliques em aparelhos diferentes; clique durante revisão automática | "dois cliques em aparelhos diferentes", "clique durante a revisão automática de outro aparelho" |
| chat depois de reinício não duplica | "chat depois de reinício não duplica review já publicado..." |
| `myReviewStates` indisponível não autoriza nenhuma via | `postagem-vias`, `coassinatura-coordenada` e `postagem-arbitragem`, um caso cada |
| conta com aparelho antigo é declarada não coberta | `cobertura-postagem` (função pura e `statusForUi`) |
| coordenação desligada: comportamento de hoje, byte a byte | `postagem-coordenacao-desligada` (9 casos) |
| posse perdida devolvida à revisão automática como perda de coordenação | `postagem-revisao-automatica`, nos dois vereditos |
| co-assinatura não é revisão fictícia | "co-assinatura não é revisão: não abre sessão nem registra sessão ativa" |
| as cinco vias se identificam ao funil | `postagem-fiacao-fonte` (trava de fonte) |

## Contraprovas (restauração byte a byte conferida)

24 mutações, todas medidas contra a ponta da branch; nenhuma inerte.

| Tarefa | Mutação | Falhas |
|---|---|---|
| 1 | payload do `gh` deixa de ser identado | 7 |
| 2 | recibo apaga o registro de postagem do mesmo nó; posse sem margem antes do envio | 1, 1 |
| 3 | posse grava tipo `review`; lease alheio deixa de recusar | 1, 1 |
| 4 | remoto ilegível deixa de restringir; intenção recusada deixa o local em `enviando`; desfecho sobrescreve tentativa alheia | 1, 1, 1 |
| 5 | leitura conta sem esperar a janela; prova aceita review anterior à intenção; coordenação desligada passa a consultar banco e GitHub | 1, 1, 1 |
| 6 | envio sem a última conferência da posse; falha sem prova vira recusa; âncora obrigatória deixa de ser exigida | 1, 1, 1 |
| 7 | reenvio gasta tentativa mesmo sem recusa; revisão automática engole a posse perdida | 1, 2 |
| 8 | `enviando` deixa de barrar a próxima tentativa | 2 |
| 9 | âncora obrigatória e recuo liberado juntos; endosso aceita aprovação fora do sha; commit novo deixa de barrar | 1, 1, 1 |
| 10 | versão ilegível conta como coberta; conta sem aparelho visto é declarada coberta | 1, 1 |
| 11 | revisão automática deixa de se identificar ao funil; co-assinatura perde a âncora obrigatória | 1, 1 |

## Ajustes técnicos em relação ao plano

- **`lib/codex/stream.js` (herdado da A1)**: nenhum. Aqui o ajuste de forma foi outro: o literal da tentativa saiu do `runCodexStream` na A1, e a C0b não precisou de nenhum.
- **Três contraprovas do plano não provavam nada e foram refeitas.** Contraprova que não falha não é contraprova:
  1. **Tarefa 5**, "coordenação desligada": o caso do plano aponta `postagensArquivo` para um arquivo inexistente, então a lista sai vazia com ou sem a guarda e o resultado é 0 nos dois casos. O teste ganhou um segundo cenário, com um incerto no disco e um cliente que anota cada consulta; agora só a guarda explica nenhuma consulta acontecer.
  2. **Tarefa 6**, "só 422 prova recusa": o caso do 502 tem corpo HTML, que já não passa na prova de forma, então mutar a exigência do status não falhava. O teste ganhou um 403 com corpo JSON de erro do GitHub, que é o caso em que só o status separa recusa provada de falha incerta.
  3. **Tarefa 9**, duas mutações: `recuoPermitido: false` e `commitIdObrigatorio` são, nesse cenário, **independentemente suficientes** (o payload da co-assinatura nunca tem inline, então o recuo é sempre o sem-âncora, que a âncora obrigatória já barra); e o filtro estrito de `reviewNoHead` é sombreado por `aprovouNoMesmoSha`, que exige `r.commit === head` por conta própria. As mutações passaram a derrubar as duas travas juntas e a atacar a trava que de fato enforce a regra. A redundância fica registrada como redundância, não como prova.
- **`test/sync-posse-postagem.test.js`**: o plano esperava `undefined` no nó do lease depois do `abort`; o dublê do banco representa nó apagado como `null` (semântica do RTDB, e o `releaseLease` faz `del` de verdade). A asserção passou a exigir a garantia (não sobra lease nenhum) em vez da forma do vazio.
- **Âncora de mutação não única**: `operationKind: 'post'` aparece duas vezes em `lib/sync/posse-postagem.js` (no lease e no ctx do handle); a mutação passou a usar um trecho maior.

## Limites que continuam declarados (do plano, conferidos na execução)

- **Não é exactly-once.** Entre a última conferência da posse e o pacote sair existe uma janela que nenhum código fecha; quem a cobre é o `enviando` com a reconciliação.
- **`POSTAGEM_COORDENADA_DESDE` nasce `2.59.4`** e precisa ser ajustada no PR de release para a versão efetivamente publicada, senão um aparelho numa versão intermediária, sem a arbitragem, seria contado como coberto.
- **Aparelho em versão antiga não participa**: coordena revisões por lease como hoje e posta por fora; a conta aparece como não coberta em `statusForUi().coberturaPostagem`. A tela dessa informação é da onda de telas (Claude Design), não desta entrega.
- **A presença não diz quais contas cada aparelho usa**, então todo aparelho visto conta para toda conta: o erro é para o lado seguro.
- **Registro remoto sem regra própria no Firebase**: o filho `postagens/{EVENTO}` fica sob o nó do recibo, e a leitura trata forma inválida como `enviando` (CT-FIO). Nenhuma regra nova é publicada aqui.
- **"Refazer neste aparelho" apaga o nó do recibo órfão inteiro**, junto com um registro remoto de postagem que estivesse lá; a cópia local de quem tentou continua segurando a dúvida.
- **COMMENT não é arbitrado**: chat e terminal seguem conversando sem posse nem registro.
- **Com a coordenação desligada nada disto vale**, inclusive as regras novas da co-assinatura, e registros `enviando` gravados com ela ligada ficam parados se ela for desligada.
- **A reconciliação compara o horário do review no GitHub com o relógio da coordenação**; relógio destoante pode adiar a prova, e nesse caso a regra das duas leituras conclui `nao_enviada` sem que a via reposte (o passo 2 encontra o review no head).
