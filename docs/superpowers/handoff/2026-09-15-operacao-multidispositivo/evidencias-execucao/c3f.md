# Evidência: C3f Memória de pushback sincronizada

Branch `md/c3f`, cortada da ponta de `md/integracao` com a C3e.

## Estado

Implementada e validada localmente. Registro de pushback CONFIRMADO sobe cifrado, com autor e PR por tag; o que é corrigido ou retirado vira lápide e some nos outros aparelhos; a mesclagem respeita a decisão manual e marca conflito em vez de inventar concordância. Marcadores de varredura e retry continuam locais. Sem tela (Claude Design).

## Gate

| Medida | Antes | `md/c3f` |
|---|---|---|
| arquivos do `check` | 435 | 439 |
| `tests` | 3554 | 3574 |
| `pass` | 3526 | 3546 |
| `fail` | 0 | 0 |

## Critério de aceite x teste

| Critério (7.C3) | Teste | Estado |
|---|---|---|
| Só registros confirmados, cifrados, com origem e escopo | `sync-pushback`, `sync-pushback-remoto` | comprovado |
| "Confirmado automaticamente" e "confirmado por mim" seguem distinguíveis | `sync-pushback` (origem na projeção) | comprovado |
| Precedência da decisão manual | `sync-pushback`, `sync-pushback-remoto` | comprovado |
| Correções e invalidações se propagam; ninguém ressuscita | `sync-pushback-remoto` (lápide) | comprovado |
| O mesmo registro de novo não vira segunda evidência | `sync-pushback-remoto` | comprovado |
| Conflito não é combinado em silêncio | `sync-pushback`, `sync-pushback-remoto` | comprovado |
| A memória não autoriza postagem nem substitui gate | `sync-pushback-remoto`: varredura do fonte | comprovado |
| Marcadores de scan e retry não sincronizam | `sync-pushback-remoto` | comprovado |
| Regras do nó no servidor | `firebase/README.md`, item 34 | **aguardando validação externa** |

## Contraprovas

11 por script (uma refeita) e 1 manual com regeneração. Reprovaram: suspeita sobe, autor em claro, manual sem precedência, conflito virando concordância, lápide ressuscitando registro novo, retirada como DELETE, reaplicação duplicando, próprio aparelho se aplicando, AAD sem `u`, sem gate; manual: lápide obrigada a carregar envelope.

**Uma contraprova não provou nada na primeira rodada** ("o próprio aparelho se aplica"): o registro local e o publicado eram idênticos, então nem sem a checagem de aparelho alguma coisa mudava. O caso passou a deixar o local mais ANTIGO que o publicado, e aí a própria publicação voltaria como novidade.

**Uma proteção é redundante e está declarada:** o `continue` depois de marcar conflito. Como a mesclagem em conflito sempre devolve o lado local, o fluxo seguinte já não aplicaria nada. Ficou pela clareza, e a contraprova correspondente não reprova nada, de propósito registrado aqui.
