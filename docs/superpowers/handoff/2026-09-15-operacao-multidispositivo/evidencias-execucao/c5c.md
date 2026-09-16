# Evidência: C5c Distribuição (publicar, agendar, aceitar)

Branch `md/c5c`, da ponta de `md/integracao` com a C5b.

## Estado

Implementada e validada localmente. Com `sync.distribution.enabled` ligado (que exige coordenação e compartilhamento cifrado), a revisão automática vira candidato, o admin agenda no relógio de 10 s e só renova a prontidão depois de ciclo saudável, e o aparelho escolhido confere tudo, reserva vaga e devolve o item ao ramo local, onde o lease continua sendo a autoridade final. Desligada, nada muda.

## Gate

| Medida | Antes | `md/c5c` |
|---|---|---|
| arquivos do `check` | 449 | 451 |
| `tests` | 3632 | 3663 |
| `pass` | 3604 | 3635 |
| `fail` | 0 | 0 |

## Critério de aceite x teste

| Critério (7.C5, S3, CT-PRONT) | Teste | Estado |
|---|---|---|
| Distribuição exige coordenação (o saneador zera) | `sync-config` | comprovado |
| Sem admin vivo, ninguém agenda | `sync-distribuicao` | comprovado |
| Publicação no ato, com o PR visível esperando | `sync-distribuicao` | comprovado |
| Candidato sem PR, título, login, head nem `requested` em claro | `sync-distribuicao` | comprovado |
| Nome transplantado não abre, e o item segue pelo tag | `sync-distribuicao` | comprovado |
| Registro defeituoso isolado por publicador | `sync-distribuicao` (as duas ordens) | comprovado |
| Fila vazia e "ninguém apto" são ciclos saudáveis | `sync-distribuicao` | comprovado |
| Leitura incompleta não é saudável e não renova | `sync-distribuicao` | comprovado |
| Item com atribuição viva não é reatribuído | `sync-distribuicao` | comprovado |
| Executor confere consentimento, assinatura, geração, TTL e head | `sync-distribuicao` | comprovado |
| Atribuição válida de outro aparelho não é aceita nem respondida | `sync-distribuicao` | comprovado |
| Recusa com código e espera | `sync-distribuicao` | comprovado |
| Aceite volta ao ramo local com uma vaga só | `sync-distribuicao` | comprovado |
| Prontidão com sequência que só sobe, e falha não anda a sequência | `sync-distribuicao`, `sync-rules-contrato` | comprovado |
| `enqueueHeadless` devolve desfecho | `sync-distribuicao` | comprovado |
| Item com retomada fica local, sem consumir a retomada (CT-RET) | `sync-distribuicao` | comprovado |
| Clique manual não distribui | `sync-distribuicao` | comprovado |
| Regras dos nós no servidor | `firebase/README.md`, itens 35 a 38 | **aguardando validação externa** |

## Contraprovas

21 por script e 1 manual com regeneração. Cinco não reprovaram na primeira rodada e viraram teste novo: a ordem do registro quebrado (o quebrado vindo primeiro), a leitura incompleta, o resumo velho (existir não basta), a atribuição VÁLIDA de outro aparelho e a sequência da prontidão (duas renovações seguidas). A primeira contraprova manual das regras acertou a regra errada (a do `cleanup`, que também tem `rev`); refeita mirando a linha da atribuição.

## Correções de desenho achadas aqui

- **RAM da capacidade virou faixa.** Em blocos de 256 MB ela ainda cruzava a fronteira sozinha com a máquina ocupada e republicava a capacidade sem mudança real. Achado porque o caso "escrita única" passou a falhar só dentro da suíte.
- **Reserva dupla.** A atribuição aceita já reserva vaga; o escalonador passou a respeitar o id que o item carrega.
- **Vazamento entre casos no teste da admissão**: objetos de PR reaproveitados carregavam o carimbo de reserva de um caso para o outro.

## Limite

O que falta da C5 é a C5d: degradação e volta ao modo local (relógio curto no seguidor, recálculo com guarda de concorrência, jitter, teto de lançamentos, classe de rate limit do GitHub).
