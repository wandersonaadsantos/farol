# Evidência: C7a Checkpoint de verificação compartilhado

Branch `md/c7a`, da ponta de `md/integracao` com a C6. É a primeira metade da 7.C7; a
transferência voluntária é a C7b, e a afinidade continua adiada pela medição externa
("frequência real de troca de dono no mesmo head", spec seção 13).

## Estado

Implementada e validada localmente. O que uma sessão confirma contra o código sobe
cifrado por loja, e o aparelho que pega o mesmo PR depois herda essa memória antes de
montar o prompt, registrando se herdou tudo, parte ou nada. Nada disso retoma sessão: o
`sid` do CLI continua preso à máquina que o abriu (CT-RET).

## Gate

| Medida | Antes | `md/c7a` |
|---|---|---|
| arquivos do `check` | 468 | 471 |
| `tests` | 3762 | 3785 |
| `fail` | 0 | 0 |
| `cancelled` | 0 | 0 |

## Critério de aceite x teste (7.C7, parte do checkpoint)

| Critério | Teste | Estado |
|---|---|---|
| Checkpoint compartilhado, cifrado, com lojas separadas | `sync-checkpoint-remoto` | comprovado |
| Entrada inválida ou não decifrável não entra no gate | `sync-checkpoint`, `sync-checkpoint-remoto` | comprovado |
| Lojas `review` e `self` nunca se misturam (caminho E envelope) | `sync-checkpoint-remoto` (transplante nos dois sentidos) | comprovado |
| Checkpoint de outro head não é retomado integralmente | `sync-checkpoint-remoto` | comprovado |
| A operação registra se retomou, reaproveitou parcialmente ou reiniciou | `sync-checkpoint`, `sync-checkpoint-remoto` | comprovado |
| Regras do nó no servidor | `firebase/README.md`, item 42 | **aguardando validação externa** |

## Decisões registradas

- **A passada viaja prefixada pelo aparelho** (`dOutro:s1`). Sem isso, dois ids de sessão
  iguais em aparelhos diferentes virariam a mesma passada e a divergência entre passadas
  sumiria justamente do `checkpointGap`, que é o gate que ela alimenta.
- **Entrada herdada não é republicada como minha**: ela já está no banco com o dono certo.
- **Publicação no relógio, não só no fim da sessão**: sessão que morre no meio deixaria a
  verificação presa no aparelho.

## Contraprovas

13 por script, todas reprovaram. Duas nasceram inertes e viraram teste novo: o ida e volta
do envelope na mesma loja, visto de outro aparelho (sem ele, um erro de caminho na escrita
passava batido), e a entrada herdada voltando ao banco com o meu nome.
