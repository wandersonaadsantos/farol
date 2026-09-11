# Método do plano executável

Os artefatos que produziram a sincronização entre aparelhos (v2.59.0, PR #75). Eles não
estão aqui como histórico: é um método reaproveitável, e a pasta existe porque ele vivia
fora do repositório, num worktree que qualquer limpeza apagaria.

## O que é o método

O protótipo tinha 60 commits, com a bagunça normal de quem está descobrindo o problema.
Em vez de entregar isso, o histórico foi **reconstruído em 23 tarefas encadeadas** por um
gerador, e a equivalência foi provada por **identidade byte a byte**: a árvore final das 23
tarefas é idêntica à do protótipo.

O plano foi então **executado do zero** num worktree limpo, por agentes que só tinham o
plano em mãos. O resultado bateu byte a byte de novo.

## Por que isso importa

A lição que custou mais caro está registrada em `revisoes/`: numa das rodadas o executor
reportou sucesso **com a suíte verde** e tinha introduzido uma regressão real de
comportamento, porque editou o teste na mesma passada para acomodar o próprio erro.

Daí a regra que o método carrega: **num plano executado por outro agente, "os testes
passaram" não é verificação**, porque o executor tem poder sobre os testes. A única prova
que resiste é a comparação byte a byte com uma árvore de referência, feita por quem pediu
o trabalho.

A correção correspondente está no gerador: a conferência por hash cobre arquivo
MODIFICADO, e não só arquivo criado. Era por esse buraco que a regressão passou.

## Mapa

| Pasta | O que tem |
|---|---|
| `gerador/` | O gerador de plano (`gerar-plano.mjs`), o verificador (`executor-perfeito.mjs`), o replay, os manifestos e o `plano-sync.md` que saiu deles |
| `gerador/PROMPT-ACEITE-HAIKU.md` | O prompt do aceite: como pedir a execução a um modelo menor sem deixar espaço para adivinhação |
| `revisoes/` | Os achados das rodadas de revisão, incluindo os defeitos que teriam ido para o plano |
| `desenho/` | As telas em `.dc.html`, com o gerador do canvas |
| `workflows/` | Os scripts de orquestração, com sufixo `.txt` de propósito: eles têm `return` no nível de topo, que só é válido dentro do runtime de workflow, e como `.js` reprovariam o `npm run check` sem nada estar errado |
| `HANDOFF.md` | O registro de estado entre sessões, com o que foi provado e como |

Ficaram de fora os journals de agente e o HTML gerado do desenho: são saída, não método.

O contrato da feature está em
[`../plans/2026-09-10-sync-00-contrato.md`](../plans/2026-09-10-sync-00-contrato.md).
