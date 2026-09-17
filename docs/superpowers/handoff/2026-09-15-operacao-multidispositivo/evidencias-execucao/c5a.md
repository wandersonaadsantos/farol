# Evidência: C5a Candidato e escolha do agendador (parte pura)

Branch `md/c5a`, da ponta de `md/integracao` com a C4.

## Estado

Parte PURA da C5 implementada e validada: a forma do candidato, a fusão entre aparelhos e as duas escolhas (qual item e qual aparelho). Nada disso está fiado ainda: publicar, atribuir, aceitar e recusar são as entregas seguintes (C5b prontidão, C5c atribuição e fiação no `enqueueHeadless`, C5d degradação e volta ao modo local). Sem fiação, o comportamento do app não muda em nada.

## Gate

| Medida | Antes | `md/c5a` |
|---|---|---|
| arquivos do `check` | 444 | 447 |
| `tests` | 3606 | 3622 |
| `pass` | 3578 | 3594 |
| `fail` | 0 | 0 |

## Critério de aceite x teste

| Critério (7.C5, S3, S3-4) | Teste | Estado |
|---|---|---|
| `requested` não viaja (CT-FIO) | `sync-candidato` | comprovado |
| Head protegido: viaja como tag, head novo é item novo | `sync-candidato` | comprovado |
| Nome do owner é apresentação e fica fora do ponteiro | `sync-candidato` | comprovado |
| Mesma org agrupa entre contas e caixas diferentes | `sync-candidato` | comprovado |
| Dois aparelhos publicando o mesmo trabalho viram um item com dois publicadores | `sync-candidato` | comprovado |
| Rodízio equivalente ao atual, com um aparelho só | `sync-candidato` (compara com `processHeadless`) | comprovado |
| Escolha de aparelho respeita apto, pausado, vaga e a espera da recusa | `sync-candidato` | comprovado |
| Nenhum apto não trava a fila | `sync-candidato` | comprovado |

## Contraprovas

12 por script, todas reprovando: `requested` viajando, head em claro, head fora da identidade, org sem normalizar caixa, fusão duplicando, fusão aceitando vencido, fusão perdendo a chegada mais antiga, escolha de aparelho sem vaga, espera da recusa ignorada, item sem aparelho travando a fila, org nunca atendida perdendo a vez e empate deixando de ser FIFO.

## Limite

A parte pura não publica nem atribui nada. O ciclo completo (publicar, fundir no banco, atribuir com TTL, aceitar ou recusar com código, executar pelo ramo local) é a C5c, e ela precisa da prontidão (CT-PRONT, C5b) para decidir quem pode ser agendador.
