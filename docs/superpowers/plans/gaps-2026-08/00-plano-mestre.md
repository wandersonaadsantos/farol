# Plano de correção dos 52 gaps lógicos do Farol

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os 52 gaps lógicos confirmados na análise de 01/08/2026 (relatório em `Documents/biud/analise-farol-gaps-logicos/relatorio.md`), em 9 ondas com TDD, sem quebrar nenhum comportamento existente.

**Architecture:** As correções estão organizadas em 9 ondas por área de código (arquivos que mudam juntos ficam na mesma onda). Cada onda tem seu arquivo de plano detalhado nesta pasta (`onda-N-*.md`) com tarefas bite-sized, código real de teste e implementação, e dificuldades antecipadas com solução preparada. Este documento mestre define a ordem, as regras de reconciliação entre ondas (decididas pelo red team) e a estratégia de release. **Onde uma regra deste mestre contradisser um rascunho de onda, o mestre vence.**

**Tech Stack:** Node puro + Electron 43, suite `node --test` (335 testes na baseline), `npm run check` (check-syntax), Windows + macOS.

## Global Constraints

- Fonte é a verdade: todo trabalho em `~/Documents/farol`, nunca na cópia instalada.
- Commits: conventional commits, um por tarefa, SEM trailer de co-autoria.
- Cada tarefa: teste que falha primeiro, implementação mínima, `npm test && npm run check` verdes antes do commit.
- Onda seguinte só começa com a anterior 100% verde e integrada (regra do usuário: tudo 100% antes de trabalho novo).
- Proibido travessão (em-dash) em qualquer texto produzido (código, comentário, doc, mensagem de commit); usar vírgula, "e" ou parênteses.
- Sem refatoração além do necessário pra correção; seguir o estilo do código vizinho.
- Cross-platform: nada pode quebrar macOS (session.js spawnConsole*, installers) nem Windows (paths, PowerShell).
- NÃO publicar release nem push durante a execução noturna: commits ficam locais na `main`; tags e releases são decisão do usuário de manhã.
- Números de linha nos rascunhos referem-se ao commit `4d39d8f` (v2.30.1). A partir da segunda onda TODO número desloca. Regra transversal: localizar SEMPRE pela âncora (nome de função, comentário, campo vizinho), nunca por número de linha.

## Ordem de execução (decisão do red team)

| # | Onda | Arquivo | Por quê nessa posição |
|---|---|---|---|
| 1º | Onda 2: resiliência do check() | `onda-2-resiliencia-check.md` | Sem dependências; cria o contrato `mine === null` que a Onda 1 consome |
| 2º | Onda 6: robustez de sessão/spawn | `onda-6-robustez-sessao.md` | Estabelece o invariante de guarda síncrona (B1/B2) ANTES da Onda 1 mexer no chatSend; session.js é exclusivo dela |
| 3º | Onda 1: identidade de conta | `onda-1-identidade-conta.md` | ghEnv estrito + tokenFor são O contrato que as ondas seguintes consomem |
| 4º | Onda 4: gates de aprovação/merge | `onda-4-gates-aprovacao.md` | Segurança logo após a raiz de identidade; blocos DEPOIS precisam de merge com as guardas da Onda 1 |
| 5º | Onda 5: instância única + update | `onda-5-instancia-update.md` | Arquivos quase isolados; fecha os achados ALTOS restantes |
| 6º | Onda 7: pipeline de revisão | `onda-7-pipeline-revisao.md` | Adapta consumidores em bloco (shouldAutoApprove {ok, motivo}, retryTargets) |
| 7º | Onda 3: contratos UI↔server | `onda-3-contratos-ui-server.md` | Depois da 7 pro module.exports do selfpr; launchSelfAnalysis já estabilizou |
| 8º | Onda 8: UI widgets/estado | `onda-8-ui-widgets-estado.md` | Máquina de estados das ops (8.1) por cima do objeto op enriquecido pela Onda 3 |
| 9º | Onda 9: persistência/consumo | `onda-9-persistencia-consumo.md` | Toca dez arquivos em pontos de uma linha; no fim da fila o custo de conflito é mínimo |

## Estratégia de release (após revisão do usuário; NADA é publicado autonomamente)

6 releases a partir de 2.30.1, cortados só em fechamento de onda, nunca no meio:
1. **v2.30.2** (Ondas 2+6): patch, correções puras de check() e sessão/spawn.
2. **v2.31.0** (Onda 1): minor, mudança de contrato observável (ghEnv estrito, tokenFor, buscas/sessões puladas por conta sem token). O flip do ghEnv (tarefa 1.7) JAMAIS sai em release sem as guardas 1.1 a 1.6 no mesmo pacote.
3. **v2.31.1** (Ondas 4+5): patch, gates + instância única/update.
4. **v2.31.2** (Onda 7): patch, pipeline ({ok, motivo} é contrato interno).
5. **v2.32.0** (Onda 3): minor, API nova (POST /api/self-review/cancel) e contrato novo do POST /api/review (urls obrigatório).
6. **v2.32.1** (Ondas 8+9): patch, UI + persistência + cosméticos.

Checklist de release do CLAUDE.md do repo se aplica (CHANGELOG.md, RELEASE_NOTES no ui/app.js, publicação pela conta pessoal wandersonaadsantos).

## Regras de reconciliação (VINCULANTES; o red team encontrou os conflitos antes de eles acontecerem)

**R1. Chat: design unificado da guarda (Onda 6 tarefa 6.6 × Onda 1 tarefa 1.5).** Contradição real de design entre os rascunhos. Desenho único que satisfaz os dois arquivos de teste (reentrancy e account-identity): a vez é reservada de forma SÍNCRONA logo após a guarda `status === 'running'` (zero await antes de marcar `running`); a checagem de conta usa `engine.tokenFor(acc)` síncrono; se faltar token, desfaz a reserva e devolve `{ok: false, error: /sem token no gh/}`; o refreshToken assíncrono acontece DEPOIS da marcação, e falha vira mensagem de erro do turno, não estado inconsistente. Quando a Onda 1 (3º) chegar no chatSend, a linha `if (!engine.token) await engine.refreshToken()` já não existirá no corpo síncrono (a Onda 6 a removeu); a tarefa 1.5 aplica a checagem de conta sobre o desenho da 6.6, não sobre o código do rascunho.

**R2. Retry do check() (Onda 1 tarefa 1.6 × Onda 7 tarefa 7.4).** A 7.4 substitui o bloco de retry por `retryTargets`, e isso APAGARIA o filtro de token da 1.6. Regra: `retryTargets` nasce com o filtro `engine.tokenFor(engine.accountForPr(entry.pr))` incorporado (o red team deixou o esqueleto no registro de viabilidade), e o teste da 7.4 ganha o caso "conta sem token não relança". A remoção do `autoReviewFor` pela 7.4 é INTENCIONAL (é o próprio M8); o filtro de token permanece.

**R3. Formato do retryAfterNet (Onda 1 × Onda 7).** O teste `account-identity.test.js` da 1.6 pina `retryAfterNet.get(key) === 1` (número). A 7.4 muda o valor pra `{tries, pr}`. Na execução da 7.4, re-derivar TODOS os leitores com `grep -rn "retryAfterNet" lib server.js test` (a lista fechada do rascunho está desatualizada por construção) e adaptar o teste da 1.6 no mesmo commit.

**R4. shouldAutoApprove (Onda 4 tarefa 4.1 × Onda 7 tarefa 7.1).** Ordem 4 antes de 7: a 4.1 escreve asserts booleanos normalmente. Na 7.1 (retorno vira `{ok, motivo}`), NÃO usar a lista fixa do rascunho: rodar `grep -n "shouldAutoApprove(" test/*.js lib/*.js lib/engine/*.js` no momento da execução e adaptar todo consumidor, incluindo os asserts que a 4.1 criou.

**R5. selfpr.js, zona quente (Ondas 1, 3, 4, 7, 9).** Os blocos DEPOIS das tarefas 4.3 e 4.4 foram escritos sobre o fonte pré-Onda-1 e NÃO contêm as guardas tokenFor da 1.4: ao executar a Onda 4, fazer MERGE (aplicar a mudança semântica preservando as guardas), nunca colagem literal. Na 4.3, a leitura de SHA pós-sessão que a 1.4 guardou SAI mesmo (é substituída pelas duas leituras antes/depois, ambas com guarda).

**R6. module.exports compartilhados.** `lib/engine/selfpr.js` (Ondas 3, 7, 9) e `ui/pure.js` (Ondas 3, 8, 9): cada rascunho mostra a lista literal SEM os nomes das outras ondas. Regra: exports são sempre EDIÇÃO ADITIVA (acrescentar o nome novo à lista existente), nunca substituição do bloco.

**R7. Construtor da Engine (Ondas 2, 5, 9).** Três ondas inserem linhas na região 118-210 do server.js. Sem conflito semântico; localizar pela âncora citada em cada rascunho (campo vizinho ou comentário).

**R8. CLAUDE.md.** A Onda 1 (1.5) reescreve o parágrafo "Adiamentos conscientes" (o chat passa a enviar account); a Onda 7 (7.1) edita o invariante 4. A edição da 7 parte do texto JÁ alterado pela 1.

**R9. Sistema de ops da UI (Onda 3 tarefas 3.3/3.4 × Onda 8 tarefa 8.1).** Mesmas funções (showOp/closeOp/handler .op-cancel). Ordem 3 antes de 8; nas tarefas 8.1/8.2/8.7, localizar pelos NOMES das funções e aplicar como edição incremental sobre o resultado da 3, atualizando o inventário de call sites com as ops que a 3 criou.

**R10. Teste 8.7 (closeChat) falso-verde.** A regex do rascunho casa errado; usar a versão do red team: ancorar o recorte no início da PRÓXIMA função e exigir o closeOp com o opId do chat.

**R11. Onda 1 tarefa 1.1.** No snippet, `refreshToken()` compat e o cabeçalho do ghEnv são CONTEXTO de posição (já existem); o diff real é só o bloco novo do `tokenFor`.

**R12. Teste da 2.5 (gh-queries-capped).** Após a Onda 1, o teste precisa semear `engine.tokens` (a busca de conta sem token passa a ser pulada). Como a ordem é 2 antes de 1, é a tarefa 1.2/1.7 que adapta esse teste no próprio commit (o rascunho da 1 já prevê ajustes de testes legados; incluir este).

**R13. Divergências de completude (adições obrigatórias):**
- **A5 (Onda 3, tarefa 3.5):** o lote "Aprovar as N pendentes" deve iterar APENAS as decisões visíveis no `scopeVisible`, não `STATE.decisions.pending` inteiro (agravante registrado no relatório).
- **M5 (Onda 6, tarefa 6.5):** aplicar a MESMA correção de exit code ao `spawnLoginConsoleMac` (linha ~245), que tem o mesmo buraco.
- **M6 (Onda 4, tarefa 4.2):** além do recordDecision, corrigir a atribuição em `writeMemory` (decision.js:220/226), que também confia no repo/autor do envelope, inclusive no caminho automático (review.js:333/360).
- **M19 (Onda 8, tarefa 8.3):** o teste automatizado proposto é regex estática; manter, mas registrar no roteiro manual o cenário dinâmico (trocar filtro rápido e conferir que a resposta velha não vence).

**R14. Fuso horário nos testes da Onda 9.** Validado pelo red team neste Windows/Node: `process.env.TZ` setado em runtime ANTES do primeiro uso de Date muda o fuso do processo; usar esse mecanismo nos testes de bucket diário (não confiar no fuso da máquina).

**R15. Contagem da suite.** "335 + N" dos rascunhos vale só pra primeira onda; a baseline cresce a cada onda (estimativa final: ~430 a 460). Divergência de contagem não é regressão; o gate é verde completo.

**R16. Caminho do relatório.** Ondas 4 e 8 reverificaram os achados direto no fonte (o caminho do relatório chegou indefinido pra elas); antes de executá-las, reconciliar os códigos dos achados com `Documents/biud/analise-farol-gaps-logicos/relatorio.md`.

## Protocolo de execução por onda

1. Ler o arquivo da onda inteiro + este mestre (as regras R* que citam a onda).
2. Executar as tarefas na ordem do arquivo, TDD estrito (teste falha → implementação mínima → suite inteira verde → commit).
3. No fim da onda: `npm test && npm run check` verdes, revisão do diff da onda contra o plano, atualizar CHANGELOG.md (entrada da onda, sem cortar tag).
4. Registrar no arquivo `progresso.md` desta pasta: tarefas concluídas, desvios do plano (com motivo), dificuldades novas encontradas e como foram resolvidas.
5. Impedimento que o plano não antecipou e não se resolve em 2 tentativas: registrar no progresso.md, marcar a tarefa como PENDENTE, seguir para a próxima tarefa independente (nunca deixar a suite vermelha; reverter o que não fechou).
