# Evidência: C3e Panorama e Meus PRs

Branch `md/c3e`, cortada da ponta de `md/integracao` com a C3d.

## Estado

Implementada e validada localmente. O Panorama e os Meus PRs de cada conta monitorada sobem cifrados, uma linha por PR, por um único publicador por conta. Só sobe a linha que mudou, PR que sai vira tombstone, e depois de reiniciar o publicador compara com o que já está no banco em vez de reescrever. Qualquer aparelho lê por conta, com leitura incremental. Meus PRs chega somente leitura. Sem tela (Claude Design).

## Gate

| Medida | Antes | `md/c3e` |
|---|---|---|
| `tests` | 3536 | 3554 |
| `pass` | 3508 | 3526 |
| `fail` | 0 | 0 |
| lint | sem regressão | sem regressão |

## Critério de aceite x teste

| Critério | Teste | Estado |
|---|---|---|
| Sem outro aparelho v2, zero escritas de Panorama | `sync-escopo-remoto` | comprovado |
| Um publicador por conta | `sync-escopo`, `sync-escopo-remoto` | comprovado |
| Só o que mudou; nada reescrito depois de reiniciar | `sync-escopo-remoto` | comprovado |
| PR que sai é avisado (tombstone), uma vez | `sync-escopo-remoto` | comprovado |
| Merge nunca habilitado por dado remoto | `sync-escopo-remoto` (`somenteLeitura`) | comprovado |
| Título, repo, login e SHA fora do banco em claro | `sync-escopo`, `sync-escopo-remoto` | comprovado |
| Regras e índice `su` no servidor | `firebase/README.md`, itens 32 e 33 | **aguardando validação externa** |

## Contraprovas

11 por script e 1 manual com regeneração, todas reprovando. Por script: SHA sobe, meta ignora publicador vivo, tombstone apagável na hora, `ctag` dependente da ordem, reescrita do que não mudou, reinício sem reconstrução, saída como DELETE, tombstone repetido, Merge habilitado, AAD sem `ctag` e meta sem CAS. Manual: tombstone apagável sem a espera de 24 h.

## Ajustes

- **Nó ausente é lista vazia**, não falha: o primeiro publicador de uma conta não encontra nada, e tratar isso como "banco indisponível" travava a primeira publicação. Achado no teste.
- **Tempos em `lib/constants.js`** (`ESCOPO_META_MS`, `ESCOPO_TOMBSTONE_MS`), pela regra `tempoMagico`.
- **Durante esta entrega foi achado e corrigido o incidente da pasta real** (ver o topo do `EXECUCAO.md`). A trava entrou primeiro em `md/integracao` e foi trazida para esta branch antes do gate.
