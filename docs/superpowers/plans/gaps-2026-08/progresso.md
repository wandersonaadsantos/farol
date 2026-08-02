# Progresso da execução do plano de correção

Iniciado em 02/08/2026 (madrugada, execução autônoma). Uma seção por onda, preenchida no fechamento de cada uma.

## Onda 2: resiliência do check()

Executada em 02/08/2026 (madrugada, horário de Brasília). Achados cobertos: A2, M1, M2 e B10. Suite na largada da onda: 392 testes; no fechamento: 401 (398 pass, 3 skipped só-macOS), com `npm run check` ok. Verificação independente confirmou os diffs contra o rascunho e provou por mutação (worktree no commit pré-onda 333e119) que os 6 testes de comportamento novo falham sem a implementação e os 3 documentados como "nascem verdes" seguem verdes.

**Tarefas concluídas**
- 2.1 `markReRequests` distingue "busca falhou" (null) de "ninguém mais pedido" (Set vazio), A2 parte 1: commit `2dabbb4`
- 2.2 `check()` preserva fila, "é meu" e marcadores quando só as buscas `--review-requested` falham, A2 parte 2: commit `1bc7d88`
- 2.3 carência anti-lag `REREQ_GRACE_MS` no `markReRequests`, M1: commit `9d2be2d`
- 2.4 `intervalSeconds` clampado no boot, M2: commit `120df41`
- 2.5 `searchPRs` loga WARN no teto do `--limit 100`, B10: commit `f5e5b70`
- Fechamento da onda (esta seção + entrada "Não publicado" no CHANGELOG.md): commit próprio, `docs:`

**Pendências**
- Nenhuma.

**Desvios relevantes do plano**
- Nenhum desvio semântico: localização por âncora (regra transversal do mestre), R7 e R15 respeitadas. Versão segue 2.30.1, sem tag, sem release e sem push (commits locais na `main`, conforme o mestre).
- Lembrete pra Onda 1 (R12 do mestre): o teste `test/gh-queries-capped.test.js` vai precisar semear `engine.tokens` quando o ghEnv estrito entrar (busca de conta sem token passa a ser pulada); o ajuste é da tarefa 1.2/1.7, no próprio commit.

**Dificuldades novas encontradas**
- Nenhuma além das antecipadas (D1 a D9 do rascunho, todas com a solução preparada funcionando). Nota de relato: a tarefa 2.1 registrou baseline 393 quando a real era 392 (393 já era o total COM o teste novo); inconsistência só de relato, a aritmética das tarefas seguintes fecha (393 + 2 + 3 + 1 + 2 = 401).
