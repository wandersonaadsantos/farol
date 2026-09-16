# Evidência: C3b Andamento ao vivo

Plano: `docs/superpowers/plans/2026-09-16-md-c3b-andamento-ao-vivo.md`. Branch `md/c3b`, cortada da ponta de `md/integracao` com a C3a.

## Estado

Implementada e validada localmente. Cada aparelho publica, cifrado e com vida curta, a etapa, o tempo por etapa, os subagentes, o modelo e as tags do PR e da conta de cada análise em curso, e lê as dos outros aparelhos. A leitura chega à tela por um evento próprio (`sync-live`), sem `pushState`.

**O que esta entrega NÃO faz, de propósito:** não tem tela (Claude Design); não usa stream para ler (lê por GET no relógio de 10 s, e só quando existe outro aparelho pronto, ver limite abaixo); não liga nada com o compartilhamento desligado.

## Gate

| Medida | Antes (`md/integracao`) | `md/c3b` |
|---|---|---|
| arquivos do `check` | 418 | 422 |
| `tests` | 3470 | 3491 |
| `pass` | 3442 | 3463 |
| `fail` | 0 | 0 |
| lint | sem regressão | sem regressão |

## Critério de aceite x teste

| Critério | Teste | Estado |
|---|---|---|
| Sem outro aparelho v2, zero escritas de andamento | `sync-andamento-remoto` | comprovado |
| Nenhuma prosa, caminho, comando, título ou login sobe | `sync-andamento`, `sync-andamento-remoto` (varredura da árvore) | comprovado |
| Vocabulário fechado; autoanálise sem etapa | `sync-andamento` | comprovado |
| Coalescência de 10 s, renovação de 60 s, DELETE ao terminar | `sync-andamento-remoto` | comprovado |
| `dev` e `t0` imutáveis | `sync-andamento-remoto`, `sync-rules-contrato` | comprovado |
| Vencido aparece como interrompida; limpeza cooperativa | `sync-andamento`, `sync-andamento-remoto` | comprovado |
| Eventos de UI por SSE dedicado e zero `pushState` do remoto | `sync-andamento-remoto` | comprovado |
| Relógio só com compartilhamento ligado, parado no stop | `sync-andamento-remoto` | comprovado |
| Regras do nó no servidor | `firebase/README.md`, item 26 | **aguardando validação externa** |

## Contraprovas

25 por script, mais 1 manual com regeneração. Tarefa 1: prosa vaza pelo modelo (2), vocabulário aberto (1), vencido como vivo (1), subagente sem saneamento (1), id sem aparelho (1), login em claro (2). Tarefas 2 e 3: sem coalescência (1), sem renovação (1), sem DELETE (1), sem gate (1), `t0` mutável (1), leitura com `pushState` (1), vencida como viva (1), próprio aparelho aparece (1), AAD sem `dev` (1), vencido recente apagado (1). Tarefa 4: dois relógios (1), stop não para (1), relógio sem compartilhamento (1), visão velha mantida (1). Tarefa 5 (manual): sem a igualdade de `t0` (1).

**Uma contraprova não provou nada na primeira rodada:** `t0` mutável depois da escrita só aparece na TERCEIRA escrita, e o teste fazia duas. O teste passou a fazer três e a conferir que a terceira aconteceu.

## Ajustes e limites

- **Leitura por GET, não por stream.** O stream existente é o dos leases; abrir um segundo stream é trabalho próprio. O GET roda a cada 10 s e só quando a frota tem outro aparelho pronto, então o custo existe apenas quando há quem ver. Trocar por stream fica registrado para a C3c em diante, que também precisa de leitura ao vivo.
- **Uma expectativa do teste estava errada, não o código:** a regra de tempo por etapa é a mesma do resumo local (o intervalo antes de uma linha é da etapa dela), e o valor esperado foi corrigido com a conta escrita no teste.
- **Ternário aninhado** apareceu na projeção e foi extraído sem subir baseline.

## Pendências

| O que falta provar | Onde |
|---|---|
| Regras de `live/operations` no servidor | emulador e projeto real, item 26 |
| Latência real entre dois aparelhos | medição entre aparelhos reais |
