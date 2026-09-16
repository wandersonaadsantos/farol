# Evidência: C3h Fiação da capacidade e do catálogo no relógio

Branch `md/c3h`, da ponta de `md/integracao` com a C2c. Entrega curta, sem plano
próprio: é fiação que faltou na C3a e que a distribuição (C5) e a C4b pressupõem.

## O achado

Uma varredura dos publicadores por chamador de produção mostrou que
`publicarCapacidade`, `publicarNoCatalogo` e `lerDoCatalogo` só eram chamados por
testes. Sem a capacidade publicada, o admin nunca enxerga aparelho apto, e a
distribuição da C5 não atribuiria nada fora de teste. A mesma varredura confirmou que
os outros publicadores (andamento, histórico, escopos, pushbacks, pendências,
política, grupo) têm chamador.

A capacidade também publicava `parallelReviews` local e não publicava a pausa,
enquanto o admin lê `teto` e `pausado` dela: um aparelho pausado pela política
continuaria recebendo atribuição.

## O que mudou

- O relógio de 10 s publica a capacidade e o catálogo (fila de revisão e itens
  esperando distribuição) antes dos sinais; os dois continuam subindo só quando o
  texto claro muda, e só com outro aparelho pronto.
- A capacidade leva a política EFETIVA: `paralelismo` é o teto efetivo e `pausado`
  entrou.
- `lerDoCatalogo` segue sem chamador de produção de propósito: quem lê o nome é a
  tela, que sai do Claude Design.

## Gate

| Medida | Antes | `md/c3h` |
|---|---|---|
| `tests` | 3687 | 3691 |
| `fail` | 0 | 0 |

## Critério x teste

| Critério | Teste | Estado |
|---|---|---|
| Um giro publica capacidade e catálogo da fila | `sync-relogio-publicacao` | comprovado |
| Sem outro aparelho pronto, nada sobe | `sync-relogio-publicacao` | comprovado |
| Capacidade com pausa e teto efetivos | `sync-relogio-publicacao` | comprovado |
| Item esperando distribuição ganha nome | `sync-relogio-publicacao` | comprovado |

## Contraprovas

5 por script, todas reprovaram.
