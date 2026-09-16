# C5d, degradação e volta ao modo local (plano)

**Objetivo:** quando a prontidão do distribuidor deixa de ser fresca, cada aparelho volta
sozinho ao escalonador local, sem busca nova no GitHub, sem disparar a frota inteira no
mesmo segundo e sem tocar sessão viva. Quando a prontidão volta, a distribuição volta no
primeiro valor fresco.

**Spec:** `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-anexos/S3-agendador.md`,
seção "Degradação e volta", com os trechos superados declarados lá (CT-ADM-POL e CT-PRONT).

## Achado que muda o escopo

Até a C5c nada em produção PUBLICAVA o batimento (`live/control/beat`) nem ALIMENTAVA
`engine.sync.autoridade`: os testes injetavam o estado à mão. Sem essa fiação a
distribuição nunca liga fora de teste. A C5d liga as duas pontas no relógio de 10 s do
andamento (`lib/engine/sync-andamento.js`), que já é mais fino que os 30 s pedidos.

## Tarefas

1. `lib/log-taxonomy.js`: classe `rate-limit-github` (`transitorio`, grupo `rede`) antes
   de `rede`. Teste em `test/log-taxonomy.test.js`; a trava de contagem e de ordem
   passa de 16 para 17 classes (a lista é exata de propósito, a garantia fica).
2. `lib/sync/modo-distribuicao.js` (puro): `modoDe`, `transicao`, `jitterMs`,
   `loteDaVolta`. Teste `test/sync-modo-distribuicao.test.js`.
3. `lib/engine/sync-sinais.js`: `publicarSinal` (a assinatura que era da prontidão,
   agora servindo aos dois caminhos), `publicarBatimento` (só o admin, no máximo um por
   `AUTORIDADE_INTERVALO_MS`), `observarSinais` (primeira leitura da conexão é
   snapshot e não prova vida; a sequência do batimento é a persistida de
   `lib/sync/autoridade.js`), `modoAtual`, `voltarAoLocal` (guarda de concorrência,
   jitter por deviceId, teto por virada, o resto sai nos giros seguintes) e
   `cicloDosSinais`. Teste `test/sync-sinais.test.js` com o banco falso.
4. `lib/engine/sync-distribuicao.js`: `distribuindo(engine, cfg)` = `ativa` E modo
   distribuído. O desvio de `enqueueHeadless` e `publicarCandidato` passam a exigir
   `distribuindo`; o ciclo do agendador segue exigindo só `ativa` (senão a prontidão
   nunca nasceria). `publicarProntidao` passa a usar `publicarSinal`.
5. Relógio: `cicloDosSinais` roda antes do ciclo da distribuição.
6. Docs (`CLAUDE.md`, `firebase/README.md` se tocar regra), evidência, EXECUCAO.

## O recálculo, dito com precisão

A spec pede recalcular o `toReview` sobre a fila já coletada. O desvio para a
distribuição acontece em `enqueueHeadless`, DEPOIS de todos os filtros do check; por
isso o conjunto que precisa voltar é exatamente `engine.headlessDistribuindo`, e a volta
é devolvê-lo ao ramo local pelo mesmo `devolverAoLocal`. Não há repesca, não há busca, e
o gate de consciência dos elegíveis já foi pago na entrada. O lease continua deduplicando
entre aparelhos que publicaram o mesmo PR.

## Contraprovas previstas

- modo ignora o frescor (sempre distribuído): testes de modo falham.
- jitter constante: teste de espalhamento falha.
- teto por virada removido: teste do teto falha.
- guarda de concorrência removida: teste de duas voltas simultâneas falha.
- snapshot contado como vida: teste de primeira leitura falha.
- desvio com `ativa` em vez de `distribuindo`: teste de enfileirar sem prontidão falha.
- classe de rate limit como permanente: teste da taxonomia falha.
