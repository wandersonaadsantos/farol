# C4 Capacidade e admissão local: plano de implementação

> **Ajustes de execução (16/09/2026):** worktree `farol-md-exec`, branch `md/c4` cortada da ponta de `md/integracao` (C3 inteira). Evidência em `evidencias-execucao/c4.md`. Contraprova e suíte em série.

**Objetivo:** a admissão local (CT-ADM) vira a autoridade de ocupação do aparelho quando o compartilhamento está ligado: reserva antes do provedor, requisitos duros desde o primeiro dia, piso de memória em que "não sei medir" é recusa, espera sem estacionar, e exceção de clique que não atravessa o resto.

**Fronteira declarada (CT-COMPAT):** a C4 não está na lista de melhorias universais, então **com o compartilhamento desligado o escalonador é byte a byte o de hoje** (teto por conta, teto global opcional). A admissão só existe com `sync.shared.enabled` ligado.

**A etapa de medição não fecha aqui.** Ela exige execuções reais por ambiente (engine, CLI, subagentes) e um teste estatístico definido sobre esses dados. O código entrega o ponto de coleta (a métrica e o piso usados em cada admissão ficam registrados na reserva) e o piso inicial é declarado como margem a validar, não como regra sustentada por dado.

## Tarefas

1. **Caracterização do desligado** (`test/admissao-desligada.test.js`): com o compartilhamento desligado, `processHeadless` dispara como hoje (teto por conta), e nenhuma reserva existe.
2. **Núcleo puro** (`lib/engine/admissao.js`): reservar/iniciar/liberar atômico no processo; teto do aparelho (política efetiva, C2a); requisitos duros (presença vencida, root, provedor não pronto, pausado, sem vaga); piso de memória com medição por ambiente e "indisponível é desconhecido"; exceção de clique só atravessa o teto; resumo por estado e tipo. Contraprovas por requisito.
3. **Fiação no escalonador** (`review.js`): com a admissão ativa, reservar ANTES de tirar o PR da fila; sem vaga, o PR fica na fila (espera, sem estacionar); toda saída do `runOneHeadless` libera a reserva. Critérios da spec: três contas com teto 1 abrem uma sessão; clique e automático não usam a mesma vaga; espera por vaga não estaciona.
4. **Resumo publicado na capacidade** (C3a): o resumo da admissão entra no `deviceStatus`.
5. **Documentação, gate, evidência, merge.**
