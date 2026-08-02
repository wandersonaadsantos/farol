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

## Onda 6: robustez de sessão e spawn

Executada em 02/08/2026 (madrugada, horário de Brasília). Achados cobertos: M3, M4, M5, B1, B2, B3 e B4. Suite na largada da onda: 401 testes; no fechamento: 411 (408 pass, 3 skipped de plataforma, esperados no Windows), com `npm run check` ok (54 arquivos). Verificação independente confirmou os 7 diffs contra o rascunho e as regras do mestre, e provou por mutação (clone isolado, revert do hunk de produção de cada commit) que cada teste novo falha sem a sua implementação; nenhum teste passa por acaso. Os testes novos da onda não têm skip por plataforma (D10 do rascunho): o caminho macOS é exercitado por injeção de fake nos dois SOs.

**Tarefas concluídas**
- 6.1 `setEncoding('utf8')` no stdout do stream headless (multibyte cortado no chunk não vira U+FFFD), M4: commit `56cf55d`
- 6.2 exit code != 0 sem evento result vira erro, nunca sucesso com NDJSON cru, M3: commit `072bba2`
- 6.3 stdin da sessão headless ganha handler de error (EPIPE não derruba o engine), B4: commit `e10401c`
- 6.4 timeout de 30min não sobrescreve cancelamento em andamento, B3: commit `c1a604f`
- 6.5 `spawnConsoleMac` trata exit code do open (pill não fica preso, PR não some da fila), M5, incluindo a mesma correção em `spawnLoginConsoleMac` por força da R13 do mestre, com teste próprio: commit `a44b1f2`
- 6.6 `chatSend` marca `running` de forma síncrona antes do await do token, B1: commit `cda65fa`
- 6.7 `launchTool` marca `running` de forma síncrona antes do await do token, B2: commit `d0323e5`
- Fechamento da onda (esta seção + entrada "Não publicado" no CHANGELOG.md): commit próprio, `docs:`

**Pendências**
- Nenhuma.

**Desvios relevantes do plano**
- D11 do rascunho (registrar `spawnLoginConsoleMac` como candidato de onda futura) foi superado pela R13 do mestre, que mandou aplicar a mesma correção de exit code na própria tarefa 6.5; o mestre venceu, a correção entrou com teste e não fica pendência futura.
- R1 do mestre respeitada na 6.6: a guarda do chat segue o desenho unificado (reserva síncrona da vez, zero await antes de marcar `running`; o refreshToken foi movido pra dentro do bloco async). A linha `if (!engine.token) await engine.refreshToken()` não existe mais no corpo síncrono do `chatSend`; a tarefa 1.5 da Onda 1 deve aplicar a checagem de conta sobre esse desenho, não sobre o código do rascunho dela.
- Versão segue 2.30.1, sem tag, sem release e sem push (commits locais na `main`, conforme o mestre). Localização por âncora respeitada (regra transversal).

**Dificuldades novas encontradas**
- Nenhuma além das antecipadas (D1 a D10 do rascunho, todas com a solução preparada funcionando).
