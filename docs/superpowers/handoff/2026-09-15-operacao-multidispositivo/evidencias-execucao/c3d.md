# Evidência: C3d História de revisões

Branch `md/c3d`, cortada da ponta de `md/integracao` com a C3c.

## Estado

Implementada e validada localmente. Cada revisão feita depois de o compartilhamento ligar sobe como índice pequeno (consultável pelo banco) e corpo versionado write-once; qualquer aparelho lista as recentes de todos ou de um aparelho e abre qualquer uma. Duas rotas novas. Sem tela (Claude Design).

**Não faz, de propósito:** não publica o histórico anterior (é a C3g, ato explícito com tamanho medido).

## Gate

| Medida | Antes | `md/c3d` |
|---|---|---|
| arquivos do `check` | 426 | 430 |
| `tests` | 3510 | 3533 |
| `pass` | 3482 | 3505 |
| `fail` | 0 | 0 |
| lint | sem regressão | sem regressão |

## Critério de aceite x teste

| Critério | Teste | Estado |
|---|---|---|
| Filtro "Todos" sem duplicar; filtro por aparelho | `sync-historico`, `sync-historico-remoto` | comprovado |
| Consulta ordenada no cliente e no dublê | `sync-rtdb` | comprovado |
| Índice sem título, repo, login ou relatório | `sync-historico`, `sync-historico-remoto` | comprovado |
| Corpo write-once por versão, sobrevivendo a reinício | `sync-historico-remoto`, `sync-rules-contrato` | comprovado |
| Vale a maior versão que decifra | `sync-historico-remoto` | comprovado |
| Histórico anterior não sobe sozinho; marco persiste | `sync-historico-remoto` | comprovado |
| Teto por ciclo | `sync-historico-remoto` | comprovado |
| A limpeza alcança índice e corpo | `sync-limpeza-ato`, `sync-rules-contrato` | comprovado |
| Regras no servidor, inclusive o `.indexOn` | `firebase/README.md`, itens 29 a 31 | **aguardando validação externa** |

## Contraprovas

15 por script e 1 manual com regeneração, todas reprovando: consulta (chave sem conferência, `orderBy` sem JSON, consulta ignorada); projeção (título no índice, conta no corpo, `dt` sem 13 dígitos, ordenação que duplica); fiação (histórico antigo sobe, marco não persiste, corpo sobrescreve, 412 vira falha, versão corrompida esconde a anterior, AAD sem `d`, sem teto, sem gate); manual: corpo sem a exigência de nó vazio.

## Ajustes

- **O cliente do banco ganhou consulta ordenada**, e o dublê passou a responder consulta como o servidor (filtro inclusivo, limites, objeto sem ordem). Isso é extensão do dublê, não afrouxamento.
- **Versão do corpo = instante do status**, e não um contador: determinística entre reinícios, então republicar encontra o nó (412) e para.
- **Rotas:** `/api/sync/reviews` e `/api/sync/review-body` como `leitura-sensivel` (55 para 57); a abertura responde envelope `{found}`, nunca 404, pelo mesmo motivo do `/api/decision`.
