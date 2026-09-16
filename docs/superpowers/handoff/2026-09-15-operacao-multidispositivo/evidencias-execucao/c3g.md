# Evidência: C3g Envio do histórico local existente

Branch `md/c3g`, cortada da ponta de `md/integracao` com a C3f.

## Estado

Implementada e validada localmente. O dono mede o envio (quantas revisões e quantos bytes, medidos cifrando de verdade), confirma aquele conteúdo, e o envio sobe em lotes, retoma de onde parou e não duplica nada se repetido. Duas rotas novas. Sem tela (Claude Design).

## Gate

| Medida | Antes | `md/c3g` |
|---|---|---|
| arquivos do `check` | 439 | 441 |
| `tests` | 3574 | 3588 |
| `pass` | 3546 | 3560 |
| `fail` | 0 | 0 |

## Critério de aceite x teste

| Critério (7.C3) | Teste | Estado |
|---|---|---|
| Ato explícito, com o tamanho MEDIDO antes da confirmação | `sync-envio-historico` | comprovado |
| Confirmação vale para aquele conteúdo | `sync-envio-historico` (contagem e versão) | comprovado |
| Retoma depois de interrupção | `sync-envio-historico` | comprovado |
| Repetido, não duplica | `sync-envio-historico` | comprovado |
| Nunca credencial, config inteira ou histórico do CLI | `sync-envio-historico` (varredura) | comprovado |
| Só categorias autorizadas (revisões, pela projeção da tela) | `sync-envio-historico`, `sync-historico` | comprovado |

## Contraprovas

8 por script, uma refeita, todas reprovando: envio sem conferir a medição, tamanho estimado, envio do posterior ao marco, sem lote, progresso sem persistir, impressão sem versão (refeita), corpo sem o review humanizado, relatório cru sem projeção.

**A contraprova da impressão não provou nada na primeira rodada:** o teste mudava a CONTAGEM de revisões, então uma impressão que só contasse itens também reprovava o envio. Entrou o caso em que só a versão de uma revisão antiga muda.

## Correção da C3d feita aqui

O corpo da revisão (C3d) descartava `reportMarkdown`. Na projeção da tela esse campo JÁ É o review humanizado (`reviewMarkdownForUi`), que é exatamente o que se abre no outro aparelho. Ele voltou ao corpo; sem a projeção da tela, o relatório cru continua fora, com teste e contraprova próprios.

## Limite

A medição cobre as revisões. O resto do que a spec chama de histórico (autoanálises e consumo antigo) não entra neste envio: autoanálise sincronizada é nó próprio (`selfAnalyses`), ainda não publicado por nenhuma entrega, e o consumo antigo já tem a consolidação da v2.59.
