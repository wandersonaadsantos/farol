# Evidência: C5b Prontidão do distribuidor (CT-PRONT, parte pura)

Branch `md/c5b`, da ponta de `md/integracao` com a C5a.

## Estado

Parte pura de CT-PRONT implementada e validada: o que conta como ciclo saudável, o isolamento por registro com impressão da causa, a revalidação crescente e a conta de ocupação que o admin usa. A publicação do sinal e o uso disso no ciclo de atribuição são da C5c.

## Gate

| Medida | Antes | `md/c5b` |
|---|---|---|
| arquivos do `check` | 447 | 449 |
| `tests` | 3622 | 3632 |
| `pass` | 3594 | 3604 |
| `fail` | 0 | 0 |

## Critério de aceite x teste

| Critério (CT-PRONT) | Teste | Estado |
|---|---|---|
| Fila vazia, sem vaga, política, orçamento e ninguém apto renovam | `sync-prontidao` | comprovado |
| Exceção, leitura incompleta, falha devolvida e prazo estourado não renovam | `sync-prontidao` | comprovado |
| Falha não é disfarçada de fila vazia nem de sucesso | `sync-prontidao` (erro desconhecido vira `estado-impede`) | comprovado |
| Defeito isola o REGISTRO, com impressão da causa | `sync-prontidao` | comprovado |
| Recuperação sem head novo quando a causa muda | `sync-prontidao` | comprovado |
| Revalidação crescente com teto de 1 h | `sync-prontidao` | comprovado |
| Reserva e execução somam; fila só informa | `sync-prontidao` | comprovado |
| Provisória contada uma vez só na passagem para reserva | `sync-prontidao` | comprovado |
| Lease só entra quando não há resumo fresco | `sync-prontidao` | comprovado |
| Sem resumo fresco, inapto para atribuição nova | `sync-prontidao` | comprovado |
| Inicialização: desconhecida vale como indisponível | herdado de `sync-autoridade` (mesma regra de frescor) | comprovado |

## Contraprovas

13 por script, todas reprovando.

## Ajuste

`lib/sync/autoridade.js` passou a aceitar o CAMINHO na verificação da assinatura (com o batimento como padrão): é o mesmo mecanismo de frescor para a autoridade e para a prontidão, e sem o caminho na assinatura um sinal valeria pelo outro.
