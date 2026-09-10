# Justiça de fila entre orgs e contas

Data: 10/09/2026
Estado: spec aprovada para planejamento
Origem: Wanderson, 10/09/2026 — "users que têm mais de um gh configurado pra review
automático, devemos fazer uma distribuição equilibrada entre orgs pra evitar monopólio
de fila; se tem fila a gente divide, sem fila o que chegar deve ser atendido."

## O problema, medido no código

A queixa é que a BIUD (`wandersonbiuder`) monopoliza a atenção do Farol e a conta
pessoal (`wandersonaadsantos`) fica sem vez. A leitura do escalonador mostra que a
causa NÃO é onde a intuição aponta.

`processHeadless` (`lib/engine/review.js:250`) já isola por CONTA: ele varre a
`headlessQueue` e dispara o primeiro PR cuja conta ainda não bateu `parallelReviews`,
contando em `headlessBusyAccounts`. Contas diferentes nunca disputam slot entre si.
Uma conta saturada não segura a outra no escalonador.

Sobram três fontes reais de monopólio, e as três existem:

1. **FIFO dentro da conta.** O slot é por conta, mas a escolha dentro dela é pura
   ordem de chegada. Uma conta que monitora mais de um owner (`accounts[].owners`)
   deixa a org de alto volume comer o slot serial (`parallelReviews` default 1)
   enquanto a org pequena espera atrás de uma fila que nunca esvazia.

2. **Orçamento de perfil compartilhado.** `budgetBlockedFor(acct)` resolve o perfil
   Claude da conta e pergunta `profileBudgetStatus`. O teto é do PERFIL, não da conta.
   Duas contas apontando pro mesmo `claudeProfileId` dividem um teto único: a de alto
   volume queima a cota do dia e a outra é barrada no gate de enfileiramento
   (`server.js:1121`) sem nunca ter tido uma revisão. Esse é o monopólio mais severo,
   porque é invisível: o toast fala do perfil, não de quem consumiu.

3. **Ausência de teto global.** Não existe limite de revisões simultâneas somando
   todas as contas. Na prática o teto é a máquina e a API, e quem tem mais PR ocupa
   mais dele. Sem teto explícito não há como distribuir vazão; com teto explícito mal
   feito, o monopólio PIORA (a org de alto volume ocupa o teto global inteiro).

## Invariante que governa tudo

**Toda política aqui é *work-conserving*.** Se existe PR elegível esperando e existe
slot ou cota disponível, alguma revisão dispara. Nenhuma política pode deixar recurso
ocioso para "guardar a vez" de quem não chegou. É a regra do Wanderson escrita como
invariante: *com fila, divide; sem fila, o que chegar é atendido.*

**Segundo invariante: justiça mexe em ORDEM e ADMISSÃO, nunca em VEREDITO.** Nada
neste desenho toca `verdict`, `decision`, `cardMet`, `shouldAutoApprove`,
`shouldAutoReject` ou o corpo postado. Um PR atendido mais cedo ou mais tarde recebe
exatamente a mesma revisão. Isso mantém intacto o invariante 4 do CLAUDE.md ("nada é
postado no GitHub sem gate").

## Escopo

Três políticas em camadas, com a medição embutida em cada uma em vez de virar
sub-projeto separado.

### Política 1 — Rodízio por org dentro da conta

`processHeadless` deixa de ser FIFO filtrado e passa a escolher, entre os PRs
elegíveis (conta abaixo do teto), o da org **atendida há mais tempo**. Dentro da mesma
org, continua FIFO puro.

Estado novo: `engine.orgLastStart` = Map `owner` (minúsculo) para o timestamp da última
revisão headless INICIADA daquela org. Org nunca atendida vale `-Infinity`, ou seja,
prioridade máxima. Carimbado em `processHeadless` no mesmo ponto em que
`headlessBusyAccounts` é incrementado.

Por que "última vez atendida" e não contagem: contagem pune eternamente quem teve um
pico de manhã, e exige janela deslizante e decaimento pra não mentir. "Quem esperou
mais" é a definição direta de justiça de fila, é uma comparação de dois números, e é
trivialmente testável.

Comportamento com 10 PRs da biudtech e 1 da org pessoal, `parallelReviews: 1`:
o primeiro disparo vai pra org nunca atendida (a pessoal), o segundo em diante vai pra
biudtech, porque ela volta a ser a mais antiga assim que a outra fila esvazia. Uma
revisão de atraso, e a org pequena deixa de esperar dez.

Work-conserving por construção: a escolha é entre elegíveis, e se existe algum
elegível ele dispara. A política só decide QUAL, nunca SE.

Owner do PR: `(pr.repo || pr.key.split('#')[0]).split('/')[0]`, o mesmo caminho que
`accountForPr` já usa. Sem owner resolvível, cai num balde `(sem org)`, que participa
do rodízio como qualquer outra org.

Sem configuração. Não há chave pra ligar: FIFO por chegada dentro de uma conta com uma
org só é EXATAMENTE o que o rodízio faz (uma org, sempre a mais antiga). O
comportamento de quem tem uma org por conta não muda em nada, então não há o que optar.

### Política 2 — Cota de conta dentro do perfil, com sobra

O teto do perfil continua duro e intacto: nada aqui fura `profileBudgetStatus`. O que
muda é QUEM é barrado quando o dinheiro fica curto.

Cada conta que usa um perfil ganha uma **cota**: por padrão, o teto do dia dividido
igualmente entre as contas ativas (não silenciadas, com `autoReview` ligado) que
apontam pra aquele perfil. Configurável por conta como peso (`accounts[].budgetWeight`,
default 1) no painel Contas.

O gate de enfileiramento passa a barrar a conta quando **as duas** condições valem:

- a conta já consumiu a própria cota (`gastoDaConta + projeção >= cota`), E
- existe outra conta do mesmo perfil, ainda abaixo da própria cota, **com PR esperando
  na fila** naquele momento.

A segunda cláusula é o coração do desenho e é o que honra a regra do Wanderson: **a
cota só morde quando há disputa de verdade.** Sem ninguém esperando do outro lado, a
conta de alto volume segue consumindo até o teto do perfil, como hoje. Com alguém
esperando, ela cede a vez até a outra alcançar a própria cota. Isso é work-conserving:
nenhum dólar do teto fica sem gastar por causa de reserva de quem não chegou.

Gasto por conta dentro do perfil sai de `usageSessions.sessions`, que já carrega
`account`, `profileId`, `day` e `costUsd` (`lib/engine/usage.js:295`). **Nenhuma
mudança de schema de usage é necessária** — só uma função de leitura nova,
`accountSpendInProfile(sessions, profileId, account, day)`, pura e testável.

O teto duro do perfil continua valendo por cima e é avaliado primeiro: perfil estourado
bloqueia todo mundo, como hoje. A cota só entra como um segundo motivo de bloqueio,
mais cedo e mais seletivo.

Transparência obrigatória, no mesmo espírito do rastro durável que o gate de orçamento
já tem: quando a cota barra uma conta, o toast e o `log('WARN', ...)` dizem QUAL conta
cedeu a vez, PRA QUEM e QUANTO falta, e não só "orçamento estourado". O motivo entra no
estado empurrado pra UI. `budgetWarned` ganha granularidade por conta (`perfil|conta`),
pelo mesmo motivo que ele existe: um lote de 8 PRs barrados pela mesma cota não pode
dar 8 toasts idênticos.

O que NÃO muda: clique manual continua liberado (a cota nunca barra `pr.manual`),
autoanálise de Meus PRs continua fora do gate, e a liberação continua automática
(a cota volta a caber sozinha na virada do dia ou quando a disputa some).

### Política 3 — Teto global de revisões simultâneas

`config.globalParallelReviews`, inteiro, **default 0 = desligado**, que é exatamente o
comportamento de hoje. Ligado (1..8, sanitizado no boot e clampado de novo no
escalonador, no padrão de defesa em profundidade do `parallelLimit`), `processHeadless`
para de disparar quando o total de revisões em curso somando todas as contas atinge o
teto.

Esta política só é segura porque a Política 1 existe. Teto global sozinho concentra:
quem tem mais PR na fila ocupa o teto inteiro. Com o rodízio por org decidindo quem
ocupa cada vaga liberada, o teto global vira distribuição de vazão em vez de corrida.

Fica desligada por padrão porque saturação de máquina é hipótese, não medição, e o
painel da Política 1 é quem vai dizer se ela é necessária. Existe pronta e testada, e
liga com um número.

### Medição, embutida

Um painel de **Justiça de fila**, alimentado pelo estado que as três políticas já
produzem, sem coleta nova:

- por org: PRs esperando, espera do mais antigo, última vez atendida, revisões
  iniciadas hoje;
- por perfil: teto do dia, gasto, e a barra de cada conta contra a própria cota, com a
  conta que está cedendo a vez marcada;
- teto global: em curso contra teto, quando ligado.

É leitura pura. Nenhum controle de decisão mora aqui além dos que já existem em Contas
e Sistema.

## Fora de escopo

- Prioridade por PR (urgente, hotfix, autor): é outro eixo de política, e misturar com
  justiça de fila torna as duas impossíveis de raciocinar.
- Teto de busca por org no polling (`capped` em `gh-queries.js`): é starvation de
  PANORAMA, não de fila, e tem causa e correção próprias.
- Balanceamento entre MÁQUINAS (o Farol de duas instâncias). A fila é por processo, e o
  CLAUDE.md já registra esse limite.

## Arquivos tocados

| Arquivo | Mudança |
|---|---|
| `lib/engine/review.js` | `processHeadless` escolhe por rodízio de org; carimba `orgLastStart`; respeita o teto global |
| `lib/engine/usage.js` | `accountSpendInProfile`, `quotaFor`, e o veredito de cota (puros) |
| `server.js` | `orgLastStart` no estado; `budgetBlockedFor` consulta a cota; `budgetWarned` por perfil+conta; `sanitizeGlobalParallel`; painel no `pushState` |
| `lib/parse.js` | `accounts[].budgetWeight` normalizado |
| `ui/` | Painel de Justiça de fila; campo de peso em Contas; campo de teto global em Sistema |
| `test/` | Suítes novas por política (ver abaixo) |
| `CLAUDE.md` | Contrato das três políticas e do invariante work-conserving |

## Testes

Cada política tem a sua suíte, e cada uma prova o invariante além do caminho feliz.

**Política 1:** org nunca atendida vem primeiro; dentro da org a ordem é FIFO;
alternância entre duas orgs em disputa; **work-conserving** (fila com uma org só
dispara sem atraso, e nenhum ciclo termina com slot livre e elegível na fila);
`parallelReviews > 1` distribui entre orgs antes de repetir; PR sem owner participa do
rodízio.

**Política 2:** conta abaixo da cota nunca é barrada; conta acima da cota COM disputa é
barrada; conta acima da cota SEM disputa passa (a prova da regra do Wanderson); o teto
duro do perfil continua barrando todo mundo; clique manual atravessa a cota; peso
assimétrico divide na proporção; conta silenciada ou sem `autoReview` não entra no
divisor; um só toast por perfil e conta por janela de bloqueio.

**Política 3:** default 0 não muda comportamento nenhum (teste de regressão sobre a
suíte existente); teto respeitado; config torta (negativo, NaN, string) não trava a
fila nem vira loop; vaga liberada vai pro rodízio de org, não pro primeiro da fila.

## Ordem de implementação

1. Política 1 (contida no escalonador, prova o rodízio isoladamente)
2. Painel de medição da Política 1 (mostra o efeito antes de mexer em dinheiro)
3. Política 2 (a mais invasiva; entra com o painel já mostrando a fila)
4. Política 3 (barata, desligada por padrão)
5. `CLAUDE.md`, `CHANGELOG.md`, release
