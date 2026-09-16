# Evidência: C5d Degradação e volta ao modo local

Branch `md/c5d`, da ponta de `md/integracao` com a C5c. Plano em
`docs/superpowers/plans/2026-09-16-md-c5d-degradacao-e-volta.md`.

## Estado

Implementada e validada localmente. Quando a prontidão do distribuidor fica três
intervalos sem mudar, o aparelho passa ao modo local e devolve ao escalonador local o
que estava esperando distribuição, em lotes, com atraso próprio e sem busca nova no
GitHub. No primeiro valor fresco, volta ao modo distribuído.

## Achado que mudou o escopo

Até a C5c nada em produção publicava o batimento (`live/control/beat`) nem alimentava
`engine.sync.autoridade`: todos os testes injetavam esse estado à mão. Fora de teste a
distribuição nunca teria ligado. A C5d liga as duas pontas no relógio do andamento
(`lib/engine/sync-sinais.js`). As regras do banco para `beat` e `ready` já existiam e
não mudaram.

## Gate

| Medida | Antes | `md/c5d` |
|---|---|---|
| arquivos do `check` | 451 | 455 |
| `tests` | 3663 | 3681 |
| `pass` | 3635 | 3653 |
| `fail` | 0 | 0 |

`npm run lint` sem regressão.

## Critério de aceite x teste

| Critério (S3, "Degradação e volta") | Teste | Estado |
|---|---|---|
| Rate limit do GitHub é transitório (classe própria) | `log-taxonomy` | comprovado |
| Vencimento medido pelo relógio local, três intervalos | `sync-modo-distribuicao`, `sync-sinais` | comprovado |
| Primeira leitura (snapshot) não prova vida | `sync-sinais` | comprovado |
| Sinal de outro caminho não vale nem envenena a sequência | `sync-sinais` | comprovado |
| Sequência vista do batimento persistida | `sync-sinais` | comprovado |
| Só quem tem a chave da geração publica, no máximo um por intervalo | `sync-sinais` | comprovado |
| Desconhecido vale como indisponível (modo local) | `sync-modo-distribuicao`, `sync-sinais` | comprovado |
| Sem prontidão fresca o item fica local | `sync-distribuicao` | comprovado |
| Volta sem busca nova, pelo ramo local de sempre | `sync-sinais` | comprovado |
| Jitter por aparelho, só no primeiro lote da virada | `sync-modo-distribuicao`, `sync-sinais` | comprovado |
| Teto por giro, mais antigos primeiro, resto nos giros seguintes | `sync-sinais` | comprovado |
| Guarda contra duas voltas simultâneas | `sync-sinais` | comprovado |
| Sem histerese na subida: primeiro valor fresco volta a distribuir, e a volta em espera desiste | `sync-sinais` | comprovado |
| Leitura que falha não muda o estado (banco fora não é admin fora) | `sync-sinais` | comprovado |
| Janela sem enfileiramento aparece na tela como estado | | **fica para as telas** (o modo está em `engine.sync.sinais.modo`; a virada chama `pushState`) |

## Ajuste declarado em teste existente

- `test/log-taxonomy.test.js`: a trava de contagem e de ordem das classes passou de 16
  para 17, com a classe nova na posição documentada. A garantia (lista exata e ordenada)
  continua a mesma.
- `test/sync-distribuicao.test.js`: o preparo `motorDistribuidor` passou a declarar a
  prontidão fresca, que agora é pré-condição do desvio; o caso oposto (sem prontidão,
  fica local) entrou como teste novo.

## Contraprovas

12 por script. 11 reprovaram como esperado. A que não reprovou ("virada para
distribuído não cancela a volta pendente") mostrou que a linha era redundante: toda
entrada no modo local já arma a volta, e em modo distribuído ela nunca roda; quem
protege a subida é a reconferência do modo depois do atraso, que tem contraprova
própria. A linha saiu.

## Limite

O relógio de 10 s só gira com frota v2 e chave prontas (é o mesmo do andamento). A
exibição do modo e da janela de até três intervalos sem ninguém enfileirar fica para as
telas, que saem do Claude Design.
