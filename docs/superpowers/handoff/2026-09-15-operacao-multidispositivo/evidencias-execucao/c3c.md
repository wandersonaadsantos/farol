# Evidência: C3c Pendências e visto

Branch `md/c3c`, cortada da ponta de `md/integracao` com a C3b. Plano curto no registro de execução (a entrega reusa a forma da C3b: projeção pura, fiação no mesmo relógio, regras).

## Estado

Implementada e validada localmente. "Precisa de você" aparece em todos os aparelhos, cifrado; cada aparelho avisa uma vez o que ninguém viu; o primeiro visto em qualquer aparelho cala os outros (D3). Agir continua sendo no aparelho dono. Sem tela (Claude Design).

## Gate

| Medida | Antes | `md/c3c` |
|---|---|---|
| arquivos do `check` | 422 | 426 |
| `tests` | 3491 | 3510 |
| `pass` | 3463 | 3482 |
| `fail` | 0 | 0 |
| lint | sem regressão | sem regressão |

## Critério de aceite x teste

| Critério | Teste | Estado |
|---|---|---|
| Visto em A cala B | `sync-pendencias-remoto` | comprovado |
| Todos avisam o que ninguém viu, uma vez | `sync-pendencias-remoto` | comprovado |
| Nada do relatório interno, título, repo ou login sobe | `sync-pendencia`, `sync-pendencias-remoto` | comprovado |
| Pendência resolvida some do banco | `sync-pendencias-remoto` | comprovado |
| Visto gravado uma vez só | `sync-pendencias-remoto`, `sync-rules-contrato` | comprovado |
| Aviso por evento dedicado, zero `pushState` | `sync-pendencias-remoto` | comprovado |
| Regras dos nós no servidor | `firebase/README.md`, itens 27 e 28 | **aguardando validação externa** |

## Contraprovas

15 por script, 1 manual com regeneração, todas reprovando: projeção (relatório sobe, motivo sem teto, veredito livre, visto alheio não cala, visto apagável com pendência viva, id sem aparelho) e fiação (sem gate, motivos crus do registro, resolvida não apagada, aviso repetido, visto sobrescrito, AAD sem `at`, próprio aparelho aparece, aviso por `pushState`, ciclo sem leitura); manual: visto sem a exigência de nó vazio.

## Ajustes

- Os motivos saem de `decisionForUi`, a projeção que a tela já usa, nunca do registro cru.
- A rota `/api/sync/seen` entrou como `demais` no inventário da A4 (54 para 55).
