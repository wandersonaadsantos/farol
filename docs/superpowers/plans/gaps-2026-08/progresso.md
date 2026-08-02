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
