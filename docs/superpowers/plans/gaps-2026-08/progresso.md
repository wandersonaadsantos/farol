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

## Onda 1: identidade de conta (raiz P1)

Executada em 02/08/2026 (madrugada, horário de Brasília). Achados cobertos: A1 (raiz), A3, M10 e M11. Suite na largada da onda: 411 testes; no fechamento: 432 (429 pass, 3 skipped só-macOS, esperados no Windows), com `npm run check` ok (55 arquivos). Verificação independente confirmou os 7 diffs contra o rascunho e as regras R1, R11, R12, R13 e R15 do mestre, auditou os 20 call sites de `ghEnv` da tabela do plano (todos guardados ou sob catch de contexto) e provou por mutação (worktree descartável, revert de cada hunk de produção) que cada teste novo falha sem a sua implementação; nenhum teste passa por acaso.

**Tarefas concluídas**
- 1.1 `Engine.tokenFor(user)`, token por conta sem herdar identidade, A1: commit `8c6b9d4`
- 1.2 buscas gh (`searchPRs`, `myAuthoredPRs`, `fetchDeliveries`) pulam conta sem token, A1 e M11, incluindo o ajuste do `test/gh-queries-capped.test.js` previsto pela R12 do mestre: commit `8975d58`
- 1.3 `postReview` e `myReviewStates` exigem o token da conta do PR, A1: commit `1609d0a`
- 1.4 gates de Meus PRs (`launchSelfAnalysis`, `setReviewers`, `mergeSelfPR`) pela conta do PR + leitores best-effort caem na incerteza do contrato, M10 e A1: commit `1873178`
- 1.5 chat roda com a conta dona do PR (repasse de `account` ao `runClaudeStream` + CLAUDE.md atualizado no mesmo commit), A3: commit `f7f6250`
- 1.6 `launchReview` filtra por conta com token, filtro silencioso no `toReview` e no retry do `check()`, classe transitória `authErr`, A1: commit `bbf26cf`
- 1.7 flip do `ghEnv` estrito (conta pedida sem token lança) + ajustes dos testes legados de `claude-profiles`, A1 e fechamento do M11: commit `e34881d`
- Fechamento da onda (esta seção + entrada "Não publicado" no CHANGELOG.md): commit próprio, `docs:`

**Pendências**
- Itens 2 e 3 da "Verificação de encerramento da onda" do rascunho (instância isolada com conta real sem token: observar os WARN "sem token no gh", a ausência de toast repetido por ciclo e a auditoria via spawnlog de que nenhum gh da conta de trabalho sai com token pessoal) NÃO foram executados: exigem manipular o keyring real do gh (`gh auth logout` de uma conta), o que a execução autônoma não faz. Pendência consciente, executar com o usuário presente antes do corte da v2.31.0.

**Desvios relevantes do plano**
- R1 do mestre respeitada na 1.5: a checagem de conta do chat foi aplicada sobre o desenho da 6.6 (guarda SÍNCRONA via `tokenFor`, zero await antes de marcar `running`), não sobre o código do rascunho (que tinha `await engine.refreshToken()` no corpo síncrono). Desvio semântico adicional documentado no código: a guarda só recusa quando há conta derivada (`acc` truthy); máquina legada sem `accounts[]` cai no caminho de sempre, com o refreshToken dentro do bloco async resolvendo a primária.
- R11 respeitada na 1.1 (o diff real é só o bloco novo do `tokenFor`; `refreshToken` compat e cabeçalho do `ghEnv` eram contexto). R12 cumprida no próprio commit da 1.2 (o `gh-queries-capped` semeia `engine.tokens`). R15: contagem 411 pra 432 não é regressão, o gate é verde completo.
- O item 4 da verificação de encerramento pede o registro da tabela de call sites "no texto do PR"; como a execução é de commits locais na `main` (sem PR, por decisão do mestre), o registro vale aqui: a tabela dos 20 call sites do rascunho foi auditada na verificação independente, com os pontos sem guarda própria cobertos por catch de contexto (`prMetrics` pela degradação do fan-out, `classifyPushback` pelo catch por PR do scan, `spawnConsole` gateado pelo `launchReview`, `update.js` sem user por contrato, `tools.js` pelo adiamento consciente documentado no CLAUDE.md). A dependência com o A2 (D3 do rascunho) ficou a favor: a Onda 2 já tinha sido executada antes, então o skip por conta sem token usa o caminho `null` que o `check()` resiliente preserva.
- Versão segue 2.30.1, sem tag, sem release e sem push (commits locais na `main`, conforme o mestre). Localização por âncora respeitada (regra transversal).

**Dificuldades novas encontradas**
- Nuance de prova registrada pela verificação: o teste do `postReview` sobrevive à mutação isolada da guarda da 1.3 porque, com o `ghEnv` estrito da 1.7, o throw cai no try/catch da própria função e devolve `ok:false` igual (defesa em profundidade fazendo o papel dela; o teste do `myReviewStates` cobre a guarda diretamente). Não é falso verde do invariante: sem token nunca posta, por dois mecanismos independentes.

## Onda 4: gates de aprovação e merge (segurança)

Executada em 02/08/2026 (madrugada, horário de Brasília). Achados cobertos: A4, A6, M6, B7 e B8. Suite na largada da onda: 432 testes; no fechamento: 447 (444 pass, 3 skipped de plataforma, esperados no Windows), com `npm run check` ok (57 arquivos). Verificação independente confirmou os 5 diffs contra o rascunho e as regras R4, R5, R13, R15 e R16 do mestre, e provou por mutação (worktree descartável no commit `9a5e5c0`, início da onda, com os arquivos de teste do HEAD copiados) que os testes de comportamento novo falham sem a implementação: 2 vermelhos no `fanout.test.js`, 5 no `decision-envelope.test.js` e 5 no `selfpr-consistency.test.js`; os 3 verdes-de-nascença são os documentados de propósito (2 pinos de semântica original na 4.5 e o teste de consumidor da 4.4). `test/selfpr-consistency.test.js` rodou 3 vezes seguidas sem flakiness (passo 4 da 4.5) e `test/review-prompt.test.js` (tabela de aridade das fachadas) segue verde: nenhuma fachada mudou de assinatura (D12 do rascunho).

**Tarefas concluídas**
- 4.1 `coverageGap` deixa de exigir `revisados > 0`: total declarado com leitura zero (ou `reviewed` fora do contrato) é lacuna e segura approve e reject, A4: commit `c6b10e6`
- 4.2 `recordDecision` deriva `item.pr` sempre do PR da fila (o `pr` do envelope fica ignorado de propósito) e `writeMemory` atribui pela mesma identidade confiável, M6 com a extensão da R13: commit `6de8387`
- 4.3 SHA da autoanálise capturado ANTES da sessão, re-checagem TOCTOU no fim com descarte sem re-enfileirar, e `enrichMyPRBranches` descarta análise sem SHA quando o head atual é conhecido, A6: commit `16de9ba`
- 4.4 `fetchMergeState` devolve `baseRefName` e o gate de ruleset do `refreshMergeStates` checa a base real mesmo sem `pr.base` enriquecido, B7: commit `7f48346`
- 4.5 `refreshMergeStates` ganha carimbo `iniciado` e reconciliação síncrona por `at >= iniciado` antes da troca do mapa: a escrita concorrente do `runSelfAnalysis` sobrevive, B8: commit `f9f58f2`
- Fechamento da onda (esta seção + entrada "Não publicado" no CHANGELOG.md, incluindo a frase preparada na D4 sobre o descarte de autoanálises antigas sem SHA): commit próprio, `docs:`

**Pendências**
- Nenhuma.

**Desvios relevantes do plano**
- R13 do mestre na 4.2 (o mestre vence a D5 do rascunho, que deixava o `writeMemory` pra onda futura): a atribuição da memória por autor saiu do autor do envelope e passou pra `result.pr.author` (o item gravado pelo `recordDecision`, identidade da fila), com o fallback pro `memory.author` removido de propósito; os 2 call sites do caminho automático em `review.js` passam o item gravado (que carrega `memory`), então a correção vale também fora do `decide()`.
- R5 do mestre na 4.3 e na 4.4: os blocos DEPOIS do rascunho foram escritos sobre o fonte pré-Onda-1, então a aplicação foi merge semântico preservando as guardas `tokenFor` da 1.4 (as duas leituras de SHA saem guardadas; a leitura pós-sessão que a 1.4 tinha guardado saiu mesmo, substituída pelo par antes/depois, como o mestre previa). O return antecipado do descarte TOCTOU é seguro: o `finally` existente limpa `activeReviews` e a atividade da sessão.
- R4 respeitada na 4.1 (asserts booleanos normais; a adaptação pro `{ok, motivo}` é da 7.1). R16 cumprida: os achados foram reconciliados com o relatório em `Documents/biud/analise-farol-gaps-logicos/relatorio.md` antes da execução. R15: contagem 432 pra 447 não é regressão, o gate é verde completo.
- Versão segue 2.30.1, sem tag, sem release e sem push (commits locais na `main`, conforme o mestre). Localização por âncora respeitada (regra transversal); travessão ausente do diff e das mensagens (verificado por varredura Unicode).

**Dificuldades novas encontradas**
- Nota de transparência do TDD da 4.4, registrada pela verificação: o segundo teste da tarefa (o `refreshMergeStates` com stub de `fetchMergeState`) nasceu verde, porque pina a semântica do consumidor, não o código morto; o vermelho exigido pelo TDD veio do teste unitário do `fetchMergeState` (confirmado por mutação no worktree pré-onda). Nenhuma ação necessária, fica o registro.
- Fora isso, nenhuma além das antecipadas (D1 a D13 do rascunho, todas com a solução preparada funcionando).

## Onda 5: instância única e fluxo de update

Executada em 02/08/2026 (madrugada, horário de Brasília). Achados cobertos: A7, M13, M14, M15 e M16. Suite na largada da onda: 447 testes; no fechamento: 456 (453 pass, 3 skipped de plataforma, esperados no Windows), com `npm run check` ok (58 arquivos). Verificação independente (adversarial) auditou cada commit por diff contra o rascunho e as regras do mestre, e provou por mutação (com `lib/engine/update.js`, `server.js` e `main.js` revertidos pro commit pré-onda `da07119`, arquivos de teste do HEAD mantidos) que os 8 testes de comportamento novo falham sem a implementação e o baseline da 5.3 segue verde, exatamente como o plano previu; nenhum teste passa por acaso. Isolados: `test/instance.test.js` 2/2, os testes novos de `test/update.test.js` 13/13 no arquivo, e `test/facades.test.js` verde incluindo "fachada applyUpdate não engole argumento".

**Tarefas concluídas**
- 5.1 `start()` só agenda polling e inicia o ciclo no callback de SUCESSO do listen (latch `began`); com a porta ocupada o engine fica inerte, a janela do Electron vira visor da instância existente e a bandeja ganha a guarda `attachedToExisting`, A7: commit `9251b0f`
- 5.2 `buildUpdateLaunchCommand` pura e exportada cita o -File do Start-Process do PowerShell 5.1 (aspas duplas embutidas, apóstrofo dobrado), M14: commit `ddde520`
- 5.3 costura de teste: `applyUpdate(engine, deps = {})` com `checkUpdate` e `downloadRemoteUpdate` injetáveis, default preservando `Function.length` 1 (a fachada `Engine.applyUpdate` de 0 parâmetros segue verde no facades), pré-requisito de M13/M15/M16: commit `9e7946a`
- 5.4 atribuição em dois tempos do `engine.update.source` (a referência de `engine.update` é reavaliada DEPOIS do await do download, com comentário anti-simplificação), M13: commit `65cb221`
- 5.5 `sessionsBusy` e `BUSY_ERROR` module-private, re-checagem de sessões ativas depois do bloco remoto e ANTES do `if (!IS_WIN)` (mac protegido), M15: commit `643b8fd`
- 5.6 guarda de reentrância `engine.updateApplying` ligada antes de qualquer await (wrapper + `applyUpdateInner` module-private, não exportado); destrava em `ok:false` e em exceção, fica ligada em `ok:true` de propósito; flag inicializado no construtor junto de `this.checking`, M16: commit `540b457`
- Fechamento da onda (esta seção + entrada "Não publicado" no CHANGELOG.md): commit próprio, `docs:`

**Pendências**
- Smoke manual complementar do Passo 4 da 5.1 (num terminal `node server.js`, noutro `npm start`; conferir que a janela abre como visor da instância existente, que só o `node server.js` escreve em `~/.farol/workspace/state/` e que o "Verificar agora" da bandeja vira no-op pela guarda `attachedToExisting`) NÃO foi executado: a execução noturna não roda o app real contra o `~/.farol` de verdade. O próprio rascunho o trata como complementar (a verificação automatizada da D8 é o `npm run check`, que passou e cobre a sintaxe do main.js). Executar com o usuário presente antes do corte da v2.31.1.

**Desvios relevantes do plano**
- Nenhum desvio semântico: ordem fixa da D9 respeitada (5.2, 5.3, 5.4, 5.5, 5.6 sobre o mesmo corpo do `applyUpdate`) e o estado final do arquivo confere com o bloco-alvo completo da tarefa 5.6. Único desvio de texto, validado pela verificação: o comentário da costura da 5.3 (deps injetável e `Function.length`) foi MANTIDO sobre o wrapper, embora o bloco-alvo da 5.6 não o mostre (foi escrito sem enxergar a 5.3); correto pela regra de merge semântico do mestre, que preserva o que as tarefas anteriores fizeram.
- R7 do mestre respeitada na 5.6 (o `this.updateApplying = false` entrou por âncora, junto de `this.checking`, na região compartilhada do construtor). D3/D10 do rascunho honradas: `deps = {}` com default (facades verde) e flag só em memória, nunca persistido. R15: contagem 447 pra 456 não é regressão, o gate é verde completo.
- Versão segue 2.30.1, sem tag, sem release e sem push (commits locais na `main`, conforme o mestre). Localização por âncora respeitada (regra transversal); travessão ausente das linhas adicionadas do diff e das mensagens de commit (verificado por varredura Unicode).

**Dificuldades novas encontradas**
- Nenhuma além das antecipadas (D1 a D11 do rascunho, todas com a solução preparada funcionando; destaque pra D1/D2, o teste de instância com blocker em porta efêmera e stubs síncronos antes do tick do listen rodou limpo e sem rede na fase verde, e pra D7, o teste de reentrância com deps próprios instantâneos não travou em nenhuma fase).

## Onda 7: pipeline de revisão, pushback e fan-out

Executada em 02/08/2026 (manhã, horário de Brasília). Achados cobertos: M7, M8, M9, M12, B5, B6 e B9. Suite na largada da onda: 456 testes; no fechamento: 481 (478 pass, 3 skipped de plataforma, esperados no Windows), com `npm run check` ok (61 arquivos). Três arquivos de teste novos (`review-reasons`, `retry-net`, `reviewer-candidates`), 10 asserts legados adaptados pro `.ok`, zero teste removido. A verificação de fechamento apontou uma única pendência bloqueante, a ausência do próprio commit de fechamento (esta seção + CHANGELOG); antes de fechar, o corretor re-conferiu no fonte as regras do mestre que citam a onda: todos os consumidores de `shouldAutoApprove` usam `.ok` ou comparam o objeto inteiro e a fachada segue intocada (grep da R4), a única escrita de `engine.reviewerCands` no selfpr.js está atrás do gate `temCandidatos` (grep da D9 do rascunho) e os `module.exports` de `review.js` e `selfpr.js` foram edição aditiva (R6).

**Tarefas concluídas**
- 7.1 `shouldAutoApprove` devolve `{ok, motivo}` estruturado (chamador do review.js pro `.ok` no mesmo commit, 10 asserts legados adaptados, CLAUDE.md invariante 4), M7 parte 1: commit `0b6b369`
- 7.2 transparência do `runHeadlessReview` só atribui a recusa à política da conta quando `motivo === 'politica'`, M7 parte 2: commit `851bec6`
- 7.3 lacuna de cobertura entra uma vez só nas reasons, com a amostra dos arquivos e a consequência, B5: commit `52a5d3b`
- 7.4 retry pós-transitório guarda `{tries, pr}` e `retryTargets` relança clique do panorama e conta sem autoReview, M8: commit `c783f85`
- 7.5 registro manual de pushback fica fora do scan e sobrevive à corrida da classificação em voo, M9: commit `81944dd`
- 7.6 marcador de scan só grava depois da classificação responder (falha transitória reentra no próximo ciclo), B6: commit `7b01121`
- 7.7 `planLotes` ganha fallback determinístico por arquivo quando o caminho não separa o diff, M12: commit `d8332f5`
- 7.8 `temCandidatos` pura e exportada gateia o cache dos candidatos a reviewer (falha total não cacheia), B9: commit `35d6623`
- Fechamento da onda (esta seção + entrada "Não publicado" no CHANGELOG.md): commit próprio, `docs:`

**Pendências**
- Nenhuma.

**Desvios relevantes do plano**
- R2 do mestre na 7.4 (o mestre vence o rascunho): `retryTargets` nasceu com o filtro `engine.tokenFor(engine.accountForPr(pr))` incorporado e o teste ganhou o caso "conta sem token não relança (o filtro da Onda 1 permanece, R2)". A remoção do gate `autoReviewFor` no retry é intencional (é o próprio M8).
- R3 cumprida no commit da 7.4: os leitores de `retryAfterNet` foram re-derivados por grep no fonte atual (a lista fechada do rascunho estava desatualizada por construção) e o teste da Onda 1, `test/account-identity.test.js`, foi adaptado pro formato `{tries, pr}` (lê `.tries`) no mesmo commit.
- R4 cumprida na 7.1: os consumidores de `shouldAutoApprove` foram re-derivados por grep no momento da execução, incluindo os asserts que a Onda 4 criou no `fanout.test.js`; `shouldAutoReject` segue booleano de propósito (o M7 é só do approve).
- R8 respeitada na 7.1: a edição do invariante 4 do CLAUDE.md partiu do texto já alterado pela Onda 1. R15: contagem 456 pra 481 não é regressão, o gate é verde completo.
- Versão segue 2.30.1, sem tag, sem release e sem push (commits locais na `main`, conforme o mestre). Localização por âncora respeitada (regra transversal).

**Dificuldades novas encontradas**
- O commit de fechamento da onda não saiu junto da última tarefa (as 8 tarefas commitaram, o passo 3/4 do protocolo do mestre ficou pra trás) e a verificação o apontou como única pendência bloqueante. Corrigido com este commit `docs`, sem mudança de código; a suite seguia verde o tempo todo.

## Onda 3: contratos UI e servidor (raiz P3)

Executada em 02/08/2026 (manhã, horário de Brasília). Achados cobertos: A5, M18, M20, M21 e B22. Suite na largada da onda: 481 testes; no fechamento: 506 (503 pass, 3 skipped de plataforma, esperados no Windows), com `npm run check` ok (63 arquivos). Verificação independente (adversarial) conferiu os 7 commits diff a diff contra o rascunho e as regras do mestre, e provou por mutação (worktree temporário no commit pré-onda `e0e0917`, com os 4 arquivos de teste novos copiados por cima) que a rodada produz exatamente 24 falhas, que são exatamente os 24 testes escritos na onda; nenhum teste passa por acaso. O 25º teste novo da contagem é o derivado automático do `facades.test.js` pra fachada `cancelSelfAnalysis`. Os testes alvo também rodaram isolados, todos verdes.

**Tarefas concluídas**
- 3.1 `cancelSelfAnalysis(engine, key)` cancela a autoanálise por key nos dois estados (na fila: remove da `headlessQueue` com toast próprio; rodando: acha a sessão `mode === 'self'` e delega pro `cancelSession`), fachada de 1 linha, rota `POST /api/self-review/cancel` por igualdade estrita, M18 lado servidor: commit `f753479`
- 3.2 key canônico do widget de autoanálise: `prKeyFromUrl` pura no `ui/pure.js` com `card.dataset.key` como fonte primária e a URL como fallback (fim do `repo#pull#123`), M20 parte a: commit `83b0ceb`
- 3.3 botão Cancelar posta o cancelamento real: descriptor `cancel: { path, body }` no `showOp`, handler `.op-cancel` só afirma cancelado com `r.ok` do servidor, e o contrato de rotas UI e server virou o teste `test/ui-contract.test.js` (com sanidade anti-extrator-cego da D6), M18 lado UI: commit `983a848`
- 3.4 ciclo de vida do widget: `analysisOpsPlan` pura com protocolo seen/close (a corrida do SSE contra o clique é teste explícito) e `syncAnalysisOps` reanexa o elemento vivo após cada re-render e fecha pelo snapshot, filtrando só `type === 'analysis'` (D10, achado 47 intocado), M20 partes b e c: commit `8cd92ff`
- 3.5 paleta de comandos decide de verdade: `decide`/`decideComConfirmacao` (caminho único com o card, confirmação no REQUEST_CHANGES), paleta fecha antes de rodar com `.catch` em toast, A5: commit `86c5e29`
- 3.6 pushback pendente confirma num clique: `PB_OPTS`/`PB_SHORT`/`pushbackControl` movidas pro `ui/pure.js` (assinatura nova, pushbacks por parâmetro; `pushbackOf` removida), botão Confirmar no estado pending, `renderResolved()` no fim do `submitPushback` e listener de click no `.pb-confirm`, M21: commit `751e814`
- 3.7 `POST /api/review` exige `urls` explícito (Array.isArray + strings não vazias, senão 400 com mensagem de contrato) e `#btnReviewAll` nunca posta `{}` (manda o escopo visível ou avisa com toast), B22: commit `e2ccc0f`
- Fechamento da onda (esta seção + entrada "Não publicado" no CHANGELOG.md): commit próprio, `docs:`

**Pendências**
- A verificação manual num `FAROL_HOME` isolado prevista no fechamento do rascunho (paleta Ctrl+K aprovando pendente, widget de autoanálise com Cancelar real e fechamento no fim, botão Confirmar do pushback, toast do "Revisar tudo" com a fila esvaziada) NÃO foi executada: a execução autônoma não roda o app real. A lógica por trás de cada cenário tem cobertura automatizada provada por mutação; o ritual de UI fica pendente, executar com o usuário presente antes do corte da v2.32.0.

**Desvios relevantes do plano**
- R13 do mestre na 3.5 (o mestre vence o rascunho): o lote "Aprovar as N pendentes" itera APENAS as decisões visíveis no `scopeVisible`, não `STATE.decisions.pending` inteiro (o snippet do rascunho iterava a lista inteira), com teste próprio; `scopeVisible` funciona em item de decisão pelo mesmo padrão do `renderDecisions`.
- R6 respeitada: os `module.exports` de `lib/engine/selfpr.js` e `ui/pure.js` foram edição aditiva, preservando os nomes das ondas anteriores. R9 fica preparada pra Onda 8: `showOp`/`closeOp`/handler `.op-cancel` devem ser localizados pelos nomes e editados incrementalmente sobre o resultado desta onda.
- Os campos `activeSessions`/`headlessWaiting` que o `analysisOpsPlan` consome foram confirmados reais no snapshot do `server.js` antes da implementação (contrato da 3.4 conferido no fonte, não só no rascunho).
- Versão segue 2.30.1, sem tag, sem release e sem push (commits locais na `main`, conforme o mestre). Localização por âncora respeitada (regra transversal); travessão ausente das linhas adicionadas e das mensagens de commit (varredura Unicode).

**Dificuldades novas encontradas**
- O commit de fechamento não saiu junto da última tarefa, o mesmo escorregão da Onda 7 (passos 3 e 4 do protocolo do mestre ficaram pra trás) e a verificação o apontou como pendência importante. Corrigido com este commit `docs`, sem mudança de código; a suite seguia verde o tempo todo. Fica o padrão anotado pra quem executar as Ondas 8 e 9: o fechamento é parte da onda, não um extra.
- Fora isso, nenhuma além das antecipadas (D1 a D11 do rascunho, todas com a solução preparada funcionando; destaque pra D7, o grep anti-redeclaração confirmou as três declarações só no `pure.js`, e pra D3, a corrida do SSE virou teste de unidade explícito).
