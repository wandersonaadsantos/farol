# Labels de revisão, pedido visível e rigor proporcional: desenho

Data: 05/11/2026. Autor do pedido: Alex Praxedes (co-mantenedor, com instância própria do Farol).
Estado: aprovado por ele em 05/11/2026, incluindo a parte C, que muda um ponto do invariante 4.

## Por que agora

Estudo feito em 05/11/2026 sobre a label `<conta>:revisando` e o caminho automático da revisão, com
o código da `main` (v2.78.35) e o GitHub real das orgs biudtech e Edicoes-CNBB. Três incômodos
relatados pelo Alex, e o que a medição mostrou de cada um:

1. **"A label aparece sem a puxada para review."** A fila automática é só a busca de PRs com pedido
   de revisão para a conta. Nos três casos do dia havia pedido explícito, feito por outra pessoa (ou
   pelo Farol dela, que re-pede a cada commit), e o Farol do Alex respondeu na hora. Não há label
   nascendo sem pedido. Há pedido chegando sem que a pessoa revisora veja de onde veio.
2. **"Tirar a label não para a revisão."** Confirmado. O botão da tela avisa que a remoção não
   cancela, e o vigia da sessão (`lib/engine/vigia-sessao.js`, a cada três minutos) olha head, estado
   do PR e revisão já existente, nunca a label. Label retirada no GitHub por alguém não produz efeito.
3. **"Preciosismo severo nos itens cobrados."** As três reprovações automáticas do dia na biudtech
   vieram do veredito do modelo, e a política da conta (`onReject: request_changes`) postou sem passar
   por ninguém. Os motivos que seguraram o merge: conflito com a base e CI que não rodou
   (tenant-company#293), seletores de e2e em arquivos que só existem na branch de destino
   (biud-frontend#1784), critério do card mais duplicação de SQL (engine-ai#880, dispensada depois
   pelo time). Em nenhum dos três a avaliação técnica rodou (`technicalReview.semDeclaracao`): o
   rigor veio inteiro do julgamento do modelo, e o engine só separa defeito de estado do PR quando a
   avaliação técnica existe.

Mais três fragilidades da label vistas no mesmo estudo:

- a label nasce antes de a sessão provar vida, então toda sessão que morre na largada é um ciclo
  público de 20 segundos (7 de 32 ciclos medidos em dois PRs no dia);
- instância que morre e não volta deixa a label até alguém da mesma conta revisar o PR (medido:
  2 h 05 em backoffice#258) ou até os outros Farols esperarem 3 h;
- a retentativa de remoção não tem prazo (o `CLAUDE.md` promete desistir em 7 dias, o código tenta
  para sempre) e grava um WARN por ciclo, contra o invariante 3.

E um incidente de processo: uma instância de teste com `FAROL_HOME` fora de `~/.farol`, com a conta
real e revisão automática ligada, postou sete reviews de verdade em 05/11/2026 entre 08:49 e 10:06.
Nada no engine distingue instância isolada de instância de produção.

## Intenção

A label `<conta>:revisando` é um **contrato visível** entre o Farol e o time: existe só enquanto há
sessão viva, quem vê sabe de onde veio a revisão, e quem tira a label encerra a sessão. E a reprovação
automática sai só por **defeito provado no código do PR**; estado do PR (conflito, CI que não rodou,
dependência, arquivo fora do diff) espera, nunca reprova.

## Objetivos

- Label no PR equivale a sessão viva, nos dois sentidos: sem sessão, sem label; sem label, sem sessão.
- Quem revisa vê, no card e no aviso, quem pediu a revisão e quando.
- REQUEST_CHANGES automático só com bloqueio classificado como defeito do código ou da parte do card.
- Instância isolada nunca escreve no GitHub sem opt-in explícito.

## Não objetivos

- Reescrever o gate das oito perguntas do `pr-reviewer` ou o tom da revisão.
- Mexer no protocolo de coordenação entre aparelhos (leases, recibos).
- Trocar a busca que alimenta a fila (`--review-requested=@me` continua sendo a única fonte).
- Cadastrar a declaração técnica dos repositórios (é operação do dono, não código; ver "Fora do
  desenho, mas pré-requisito").

## Anti objetivos (o que faria isto falhar mesmo funcionando)

- Texto público novo no PR. Nada aqui comenta, explica ou pede desculpa no GitHub. A label é o único
  sinal escrito, e continua sendo só um marcador.
- Afrouxar o que é defeito. Violação técnica confirmada, achado não resolvido e parte do card não
  entregue continuam reprovando sozinhos quando a conta manda.
- Dois Farols da mesma conta apagando a label um do outro.

## Restrições

- Node puro, sem dependência nova. Texto e comentários em português, sem travessão.
- Tempo só em `lib/constants.js` (`TEMPOS`). `process.env` só em `lib/paths.js`.
- Falha de classificação em `lib/log-taxonomy.js`. Log só de falha.
- Toda escrita no GitHub continua passando pelos gates de `postReviewOnce` (invariante 4).
- Rota nova de `/api` entra no inventário da A4 com classe.
- Gate: `npm run check && npm run lint && npm test` verde, `npm run eng` antes de empurrar.

## Parte A: a label como contrato

### A1. A label espera a sessão provar vida

Hoje: sem coordenação, `addInProgressLabel` roda no início do `try` do `runOneHeadless`, antes de
`prepareReviewReading`; com coordenação, na admissão (`porLabelNaAdmissao`).

Novo: sem coordenação, a label entra no **primeiro evento do provedor** (no Claude, o `onSession` de
`lib/engine/session.js`; no Codex e no Antigravity, a primeira linha do stream, porque o id pode
chegar só no fim) ou em `TEMPOS.LABEL_APOS_SPAWN_MS` (decisão minha: 15 s) depois do spawn, o que
vier primeiro. Falha na preparação, no gate de lançamento ou no spawn não toca o GitHub. Com
coordenação ligada nada muda: ali a label protege o lease e tem de entrar na admissão. Enquanto
`labelEmAndamento` está vazio a sessão está viva sem label, e o motivo `label-retirada` de A2 não
dispara nessa janela.

Custo declarado: a janela em que dois Farols sem coordenação não se veem cresce em até 15 s. É o
limite já documentado em `docs/REVIEW-GATES.md` ("dois Farols que começam no mesmo segundo não se
veem"), um pouco maior, e continua não sendo trava distribuída.

### A2. Tirar a label encerra a sessão

Duas bocas, mesmo efeito:

- **Vigia.** A leitura de estado do PR que `conferir` já faz (`engine.prState`, um `gh pr view`)
  passa a pedir `labels` junto de `state`, então não há chamada nova por tique. `decidir` ganha o
  motivo `label-retirada`: a sessão tinha adicionado a label (`labelEmAndamento` não vazio) e ela não
  está mais no PR. Falta de dado (leitura falhou, lista ausente) nunca encerra, como nos outros
  motivos. A sessão cancelada por este motivo **estaciona** como estacionamento comum (não é a classe
  `cancelado`), com o motivo dito no card ("a label de revisão foi retirada do PR; a revisão volta
  por clique, commit novo ou pedido novo"). O `destrava.js` a devolve aos caminhos automáticos só por
  sinal **posterior à parada** (commit novo ou pedido de revisão novo), que é o contrato que ele já
  tem; o mesmo head sem sinal novo não relança: quem tirou a label disse "não agora".
- **Botão da tela** (`ui/telas/review-labels.js`, rota `/api/review-labels`). Remover a própria
  label de um PR com sessão viva deste aparelho cancela a sessão **antes** de remover, pelo mesmo
  `cancelSession` do botão Cancelar, e o texto da confirmação passa a dizer isso. Label de outra
  conta continua só sendo removida (não há sessão aqui para cancelar).

Corrida com o próprio `finally`: o vigia é parado no `finally` antes de `removeInProgressLabel`, e a
remoção própria nunca cai no motivo novo. Outro aparelho da mesma conta sob coordenação: só o dono do
lease tem sessão, e a label é dele; o caso "colega tirou a label do meu aparelho remoto" encerra a
sessão remota, que é o comportamento pedido.

### A3. Label própria sem dono some sozinha

Nova verificação no ciclo, ao lado de `tirarPendentes`: label `<minha conta>:revisando` vista no
Panorama (a busca já traz `labels` de todo PR, `lib/engine/gh-queries.js`) num PR em que este
aparelho **não** tem sessão viva (`activeReviews`) nem pendência de remoção, e (com coordenação
ligada) nenhum outro aparelho da conta tem lease vivo no PR (leitura do lease de `lib/sync/lease.js`,
sem adquirir), é carimbada em
`labelVistaDesde` como as alheias já são, e depois de `TEMPOS.SINAL_REVISAO_TTL_MS` (3 h, o teto
absoluto da sessão headless é 2 h) entra em `labels-a-tirar` e sai. Cobre a instância que morreu e
não voltou, que hoje só a coincidência cura. Sem coordenação, a mesma regra vale: nenhuma sessão
legítima dura 3 h.

### A4. Pendência de remoção com prazo e sem ruído

`labels-a-tirar.js`: pendência com `desde` mais velho que `TEMPOS.LABEL_PENDENCIA_MAX_MS` (7 dias,
o que o `CLAUDE.md` já promete) é descartada com **um** WARN. A tentativa que falha deixa de gravar
WARN por ciclo: grava uma vez por mudança de estado (primeira falha, e quando a causa muda), no molde
de `avisarSemToken`.

### A5. Documentação alinhada

Comentário de `lib/engine/gh-queries.js:49-54` (ainda diz que a label é sinal legado) e a linha de
`labels-a-tirar.js` no `CLAUDE.md` passam a descrever o que o código faz depois desta entrega.

## Parte B: o pedido chega visível

A revisão automática começa por um pedido que outra pessoa fez, muitas vezes pelo Farol dela. O
Alex não vê o pedido, só a label.

- **B1. Quem pediu e quando.** Quando a revisão automática é admitida, uma leitura da timeline do
  PR (uma chamada `gh api` por sessão, não por ciclo) traz o último `review_requested` para a conta:
  ator e hora, como o GitHub os dá (o Farol de outra pessoa age como a pessoa, então aparece o login
  dela; pedido feito a um time mostra o nome do time). Vai ao registro da sessão (`activeReviews`) e à decisão (`provas.pedido`), aparece no
  cartão "Analisando agora", no card da fila e no toast de início ("revisão automática de X,
  pedida por @fulano às 12:22"), e no `aviso-nativo` correspondente. Falta de dado mostra "pedido
  não identificado", nunca inventa ator.
- **B2. Re-pedido sem commit novo não gasta sessão.** Já existe (`jaRevisado` no vigia e no gate de
  lançamento). Fica aqui só para registrar que foi conferido e não muda.

Decisão minha, marcada como tal: não há janela de espera nem confirmação antes da revisão automática.
O dono da conta escolhe `autoReview` e `reviewRules` por org e autor; o que faltava era ver o pedido,
não travá-lo.

## Parte C: rigor proporcional, decidido pelo engine

Hoje o modelo classifica cada achado em `blocking`, `suggestion`, `question` ou `nitpick`
(`lib/engine/review-findings.js`), e o engine só distingue **defeito** de **estado** quando a
avaliação técnica rodou (`defeitosDoPr`). Sem declaração técnica, qualquer `blocking` do modelo vira
REQUEST_CHANGES automático com `onReject: request_changes`.

### C1. Todo bloqueio declara a causa

O envelope (schema em `workspace-template/prompts/pr-review-auto.md` e validação em
`review-findings.js`) ganha, em cada finding `blocking`, o campo obrigatório `causa`, de lista
fechada:

| causa | significa | efeito no desfecho automático |
|---|---|---|
| `defeito_codigo` | regressão, regra de negócio quebrada, segurança, contrato de API, teste que falha pelo diff | pode reprovar sozinho |
| `card` | a parte do card que cabe a este PR não foi entregue | pode reprovar sozinho (já é `GAP_DA_PARTE_DO_CARD`) |
| `ci` | check obrigatório vermelho ou sem resultado no head | espera do CI (`espera-ci.js`); o REQUEST_CHANGES do CI vermelho segue a regra vigente de 18/10/2026 |
| `conflito` | PR em conflito com a base, checks não rodaram por isso | espera, nunca reprova (C2) |
| `dependencia` | depende de PR ou card em aberto | ressalva, como já é |
| `fora_do_diff` | o problema está em arquivo que este PR não toca (base, outra branch) | pergunta ou ressalva, nunca bloqueio |

Regras do engine, PURAS, em `desfecho-automatico.js`:

- `shouldAutoReject` exige ao menos um `blocking` com causa `defeito_codigo` ou `card`. Veredito
  `request_changes` sustentado só por `ci`, `conflito`, `dependencia` ou `fora_do_diff` **não vira
  aprovação** (o engine nunca escreve APPROVE que o modelo não escreveu): vira espera ou mesa, por
  causa. `ci` entra na espera do CI de sempre; `conflito` entra na espera de C2; `dependencia` e
  `fora_do_diff` vão à mesa com o texto do modelo no card. O head novo que resolve o estado abre
  revisão nova, e aí o modelo decide de novo.
- As lacunas de `approvalEvidence` que já são defeito (`defeitosDoPr`: violação técnica confirmada,
  achado não resolvido, parte do card) continuam reprovando sozinhas **sem olhar `causa`**: C1
  restringe só o que o modelo pode chamar de defeito sem prova, nunca o que a avaliação técnica
  provou.
- `blocking` sem `causa`, ou com causa fora da lista, é envelope fora do contrato para fins de
  postagem automática: cai em `review_inconsistent` (`review-consistency.js`) e vai para a
  recuperação durável, nunca para o PR.
- Vale só para a decisão automática. No clique e no chat a pessoa está escolhendo o que posta, e o
  invariante 4 já cobre a admissibilidade do APPROVE nessas vias; a classificação de bloqueio ali
  é dela.
- O prompt (`pr-review-auto.md` e `pr-reviewer.md`) diz a tabela acima em uma linha por causa e
  reafirma: "conflito com a base, CI que não rodou e arquivo fora do diff não são defeito deste PR".

Esta é a única parte que muda doutrina do invariante 4 ("defeito do PR vira REQUEST_CHANGES com a
conta reprovando sozinha"): ela não afrouxa o que é defeito, restringe o que o modelo pode chamar de
defeito sem prova no diff. Aceita pelo Alex, como mantenedor, em 05/11/2026; o `CLAUDE.md` e o
`docs/REVIEW-GATES.md` registram a decisão junto da entrega.

### C2. Conflito com a base não abre sessão

Gate de lançamento (ao lado de `aguardaChecksParaRevisar` em `checks-exigidos.js`): antes de abrir
a sessão automática, uma leitura de `mergeable` do PR (a mesma que `meus-prs-base.js` já faz por
GraphQL para os PRs próprios, aqui para o PR a revisar). `CONFLICTING` marca o PR como espera com o
motivo "em conflito com a base; a revisão abre quando o conflito for resolvido" no card, sem gastar
sessão e sem label. `UNKNOWN` (GitHub ainda calculando) não segura: falta de dado nunca cala a
revisão. Resolver conflito, por merge da base ou por rebase, sempre produz head novo, então a volta é
pelo gatilho de head novo de sempre; a espera relê `mergeable` só quando o `updatedAt` do PR muda,
para não custar busca por ciclo. Clique manual atravessa.

Decisão minha: ligado por padrão. Revisar PR em conflito produz veredito sobre código que vai mudar
e, medido hoje, produz reprovação pública pelo conflito. Se o dono preferir opt-in, é uma chave
`aguardarMergeavelParaRevisar` no molde das irmãs.

### C3. A alavanca que já existe

Enquanto C1 não entra, a conta pode pôr `onReject: wait` (Sistema > Contas): a reprovação vai à
mesa com o texto pronto, e a pessoa decide. O desenho registra isto porque é o que o Alex pode
fazer hoje, sem código.

## Parte D: instância isolada não escreve no GitHub

`lib/paths.js` já sabe quando `FAROL_HOME` está definido. Nova marca `instanciaIsolada`: `FAROL_HOME`
presente e, resolvido, diferente de `path.join(os.homedir(), '.farol')`. Casca nativa, web hospedada
e Termux usam `~/.farol` e não são isoladas. Sob o runner de teste (`NODE_TEST_CONTEXT`) a marca fica
desligada, senão toda a rede que posta com stub quebraria; o teste que prova a recusa sobe o servidor
como processo filho sem essa variável, como os smokes de boot já fazem. Com a marca:

- `postReviewOnce` recusa com `blocked: 'instancia_isolada'` (texto do card: "instância isolada não
  posta no GitHub; ligue `instanciaIsoladaPosta` na config para permitir");
- `addInProgressLabel`, `setReviewers`, `mergeSelfPR` e a co-assinatura recusam pelo mesmo motivo;
- buscas, sessões (com os stubs `FAROL_HEADLESS_CMD`) e a tela seguem funcionando, que é o uso de
  teste pretendido;
- `config.instanciaIsoladaPosta: true` (só por arquivo, nunca pela tela) desliga a recusa, para a
  web hospedada ou o Termux que usem `FAROL_HOME` de propósito; o doctor mostra a marca.

Travado em teste: instância com `FAROL_HOME` temporário e conta com política automática não produz
nenhuma chamada `gh pr review`, `gh pr edit --add-label`, `--add-reviewer` ou `gh pr merge`.

Decisão minha: isto é regra de segurança, não preferência, e entra como invariante novo no
`CLAUDE.md` ("Como rodar e testar sem estragar nada").

## Fora do desenho, mas pré-requisito do rigor

A avaliação técnica não rodou em nenhum dos repositórios medidos (`semDeclaracao`). Sem declaração em
`~/.farol/technical-review/repositories.json`, o engine não tem como separar violação de opinião, e
C1 é o máximo que dá para fazer do lado do app. Cadastrar a declaração dos repositórios ativos da
biudtech e da Edicoes-CNBB é operação do dono e vale mais que qualquer ajuste de prompt.

## Ordem sugerida de entrega

1. D (segurança do teste), A4 e A5: pequenos, sem decisão pendente.
2. A2 e A1 (label como contrato), depois A3.
3. B1.
4. C2 e C1.

Cada item sobe com teste próprio na rede de `test/`, e os textos de card e toast entram pelos
helpers existentes (`TEXTOS_DA_RECUSA`, `textoDaEspera`), nunca escritos à mão na tela.

## O que fica para quem constrói

- Nome exato das constantes novas em `TEMPOS` e dos motivos novos em `MOTIVOS` do vigia.
- Forma do campo `provas.pedido` e do evento SSE que leva ator e hora ao cartão.
- Onde a leitura de `mergeable` do PR a revisar mora (reaproveitar o cliente GraphQL de
  `meus-prs-base.js` ou `gh pr view --json mergeable`), respeitando o orçamento de busca.
- Texto final das linhas novas do prompt, dentro do teto de bytes do protocolo partido do `agy`.
