# Evidência: C7b Transferência voluntária

Branch `md/c7b`, da ponta de `md/integracao` com a C7a. Fecha a 7.C7 no que não depende de
medição externa; a **afinidade** continua adiada (ela precisa da frequência real de troca
de dono no mesmo head, spec seção 13).

## Estado

Implementada e validada localmente. O pedido chega como comando remoto `transferir`
(C6), o aparelho de origem confere o destino, manda a memória do checkpoint (C7a), encerra
a própria sessão e devolve o item ao conjunto com preferência pelo destino, por 10
minutos. O destino herda a memória ao começar (C7a) e registra se retomou, aproveitou
parte ou reiniciou.

## Gate

| Medida | Antes | `md/c7b` |
|---|---|---|
| arquivos do `check` | 472 | 474 |
| `tests` | 3785 | 3812 |
| `fail` | 0 | 0 |
| `cancelled` | 0 | 0 |

## Critério de aceite x teste (7.C7, parte da transferência)

| Critério | Teste | Estado |
|---|---|---|
| Transferência só ocorre para destino apto | `sync-transferencia` (os cinco motivos) | comprovado |
| Credencial ausente no destino impede a continuidade | `sync-transferencia` | comprovado |
| A operação registra se retomou, reaproveitou parcialmente ou reiniciou | `sync-checkpoint`, `sync-checkpoint-remoto` (desfecho da herança) | comprovado |
| Afinidade nunca reserva o PR para aparelho sem presença além do limite de tempo | `sync-transferencia` (preferência com prazo, e preferência por aparelho inelegível não segura o item) | comprovado |
| Comando `transferir` exige destino | `sync-comando` | comprovado |
| Afinidade como heurística de colocação | | **adiada**: depende da medição de troca de dono |

## Decisões registradas

- **A ordem é memória, encerrar, publicar.** Publicar antes de encerrar deixaria duas
  sessões possíveis no mesmo head; encerrar antes de mandar a memória jogaria fora o que
  já tinha sido verificado. Um teste lê o fonte e trava a ordem.
- **A preferência é do item, não do PR**: ela vem de quem entregou o trabalho, vale por
  10 minutos e só enquanto o destino continua elegível.
- **Destino inapto não encerra nada**: a sessão de origem continua rodando.

## Contraprovas

14 por script, todas reprovaram. Uma nasceu inerte (a fusão carregando a preferência) e o
caso foi refeito com o publicador SEM preferência chegando primeiro, que é a ordem em que
o problema aparece.
