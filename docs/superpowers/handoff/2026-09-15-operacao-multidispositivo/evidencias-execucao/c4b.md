# Evidência: C4b Ativação do teto do grupo

Branch `md/c4b`, da ponta de `md/integracao` com a C3h. Plano em
`docs/superpowers/plans/2026-09-16-md-c4b-teto-do-grupo.md`.

## Estado

Implementada e validada localmente, **com a ativação protegida**: a constante
`ATIVACAO_TETO_GRUPO_C4B` nasce `false` e só o dono a liga depois da medição do atraso do
consumo entre dois aparelhos reais (spec, seção 13). Enquanto isso o grupo pode ser
configurado, publicado e exibido com o que falta para ativar, e o gate não barra nada.
Os testes exercitam os dois lados pela propriedade em memória `engine.ativacaoTetoGrupo`,
que nem rota nem config alcançam.

## Gate

| Medida | Antes | `md/c4b` |
|---|---|---|
| arquivos do `check` | 458 | 463 |
| `tests` | 3691 | 3728 |
| `pass` | 3663 | 3700 |
| `fail` | 0 | 0 |
| `cancelled` | 0 | 0 |

`npm run lint` sem regressão; `sync-rules --check` confere.

## Critério de aceite x teste (7.C4b)

| Critério | Teste | Estado |
|---|---|---|
| O consumo de B no mesmo grupo barra a admissão em A | `sync-consumo-grupo-remoto` | comprovado |
| Reservas vivas de três aparelhos admitindo ao mesmo tempo são somadas | `sync-consumo-grupo-remoto`, `sync-consumo-grupo` | comprovado |
| Valor desconhecido usa a reserva e marca parcialmente estimado | `sync-consumo-grupo-remoto`, `sync-consumo-grupo` | comprovado |
| Evento inválido ou lacuna: não verificável, segura automático e clique, sem estacionar | `sync-consumo-grupo-remoto` (fila, escalonador e boca da sessão) | comprovado |
| Codex aparece como não controlado | `sync-consumo-grupo-remoto` | comprovado |
| Rotação de credencial não zera a contagem | `sync-consumo-grupo-remoto` | comprovado |
| A tela não oferece ativar sem os requisitos | `sync-grupo`, `sync-grupo-remoto`, `sync-consumo-grupo-remoto` (`requisitos` no resumo da tela) | comprovado (dado); a tela em si sai do Claude Design |
| Store do grupo depende do banco, nunca do admin | desenho: o retrato lê só `usageDaily` e `deviceStatus` | comprovado por leitura |
| Regras do `usageDaily` no servidor | `firebase/README.md`, item 39 | **aguardando validação externa** |
| Atraso do consumo entre aparelhos | dois aparelhos reais | **medição externa pendente** (protege a ativação) |

## Ajustes declarados em testes existentes

- `test/sync-rules-contrato.test.js`: a lista exata de nós com concessão ganhou
  `usageDaily`, e a varredura de dono passou a incluir os três níveis dele.
- `test/sync-limpeza-chave.test.js`: caso novo, a limpeza alcança `usageDaily`.
- `test/helpers/fake-rtdb.js`: o dublê passou a entender `orderBy="$key"`, que o banco
  real entende e o contrato do `usageDaily` usa.
- `test/review-commit-id.test.js`: a importação do `server.js` subiu para antes do
  primeiro caso. Com `--test-force-exit`, o processo sai quando os casos já registrados
  terminam; com o grafo de módulos maior, a importação passou a terminar depois dos três
  primeiros casos e os seis seguintes saíam como **cancelados** (a suíte dizia 0 falhas).
  Nenhuma asserção mudou. Outros treze arquivos têm o mesmo padrão latente e ganham
  entrega própria.

## Contraprovas

24 por script, todas reprovaram. Duas nasceram inertes e viraram teste novo: vínculo de tipo não controlado num perfil medido, e a capacidade publicada sem o consumo do grupo. Uma terceira (a exclusão da conta segurada) deixava o escalonador em laço infinito em vez de reprovar, e isso virou correção: o laço passou a ter teto de voltas pelo tamanho da fila, e a mutação passou a mirar a exclusão em si.

## Limites declarados

- O custo típico do grupo é mediana de medianas (a de cada aparelho e a local).
- A reserva é projeção, não teto de gasto: aparelhos admitindo ao mesmo tempo com dados
  defasados podem passar do teto ("teto macio").
- Aparelho offline que gasta por clique ou chat só aparece quando volta a publicar.
