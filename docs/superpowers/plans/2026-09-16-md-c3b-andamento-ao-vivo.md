# C3b Andamento ao vivo: plano de implementação

> **Ajustes de execução (16/09/2026):** worktree `C:\Users\wanderson\Documents\farol-md-exec`; branch `md/c3b` cortada da ponta de `md/integracao` (com C3a). Evidência em `evidencias-execucao/c3b.md`. Contraprova e suíte sempre em série.

**Objetivo:** qualquer aparelho vê a etapa, o tempo por etapa, os subagentes, o modelo e o PR de cada análise que roda em outro aparelho, sem que ver dispare processamento.

**Arquitetura:** folha pura `lib/sync/andamento.js` (vocabulário único de etapa, projeção com allowlist, TTL, id da operação) e fiação `lib/engine/sync-andamento.js` (publicação coalescida com relógio próprio, remoção ao terminar, leitura com falha fechada e evento SSE `sync-live`).

**Spec:** 7.C3 e anexo C1, nó `live/operations/{opId}`.

## Constraints

- Nó `{v, dev, t0, x, enc}`, `enc` até 2048, `x = agora + 150 s` e nunca além de `agora + 300 s`; `dev` e `t0` imutáveis na vida do nó.
- Só publica com a frota v2 (C3a) e com a chave aberta.
- **Nunca** sobe linha de feed, caminho, comando ou prosa: só etapa, tempos, contagem e rótulos de subagente, modelo, `prTag`, `acctTag` e tipo.
- Escrita coalescida: no mínimo 10 s entre escritas da mesma operação; renovação a cada 60 s mesmo sem mudança; DELETE ao terminar. O relógio é próprio, porque o ciclo de polling pode ser de minutos e o TTL é de 150 s.
- Autoanálise (sem etapa) aparece como `desconhecida`, sem percentual.
- Nó vencido aparece como "interrompida em <aparelho>"; qualquer aparelho pode apagá-lo.
- A leitura emite evento SSE `sync-live` e **nunca** `pushState`.
- Desligado: nenhum timer, nenhuma escrita.

## Tarefas

1. **Projeção pura** (`lib/sync/andamento.js`, `test/sync-andamento.test.js`): vocabulário, projeção sem prosa, id da operação por HMAC do id local, vencimento, "interrompida". Contraprova: prosa vaza; vocabulário aberto; vencimento ignorado.
2. **Publicação coalescida** (`lib/engine/sync-andamento.js`, `test/sync-andamento-remoto.test.js`): gate, 10 s, 60 s, DELETE no fim, sessão sem sessão ativa apagada, `dev`/`t0` estáveis. Contraprova: tirar coalescência; tirar renovação; tirar DELETE; tirar gate.
3. **Leitura e evento** (mesmo teste): decifra, ignora o próprio aparelho, marca vencida, falha fechada, emite `sync-live` e não chama `pushState`; limpeza cooperativa do vencido. Contraprova: `pushState` na leitura; vencida tratada como viva.
4. **Relógio próprio e fiação** (`sync.js`, `server.js`, `http-server.js`): timer só com compartilhamento ligado, parado no stop; rota SSE repassa `sync-live`.
5. **Regras v2** de `live/operations/$op` com contraprova manual regenerada.
6. **Documentação, gate, evidência, merge.**
