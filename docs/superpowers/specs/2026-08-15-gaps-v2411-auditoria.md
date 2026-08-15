# Auditoria de gaps lógicos v2.41.1 (15/08/2026): os 20 confirmados

Segunda rodada de caça a gaps (a primeira, na v2.30.1, fechou 52 na v2.31.0).
Método: 4 auditores por fatia do engine + verificação adversarial manual de cada
achado no fonte. Só entrou gap com cenário de operação normal e mecânica
confirmada por leitura direta. Este arquivo é a SPEC das correções: cada gap
carrega o fix pretendido. Os planos por onda moram em
`../plans/gaps-2026-08-15/`.

## Onda 1: integridade de postagem e custo (alvo v2.41.2)

**G1. Review postado sem `commit_id`.** `postReview` (decision.js) envia só
`{event, body, comments}`; o GitHub ancora o review no head do momento do POST.
Push do autor durante a sessão (10-30 min em PR grande) faz o review sair
carimbado num commit não lido; `staleForReview` compara igual e o round morre.
FIX: `runHeadlessReview` e `decide()` propagam o `headShaAtual` da sessão até o
`postReview`, que inclui `commit_id` no payload quando conhecido (vazio = omite,
comportamento atual). `normalizeReviewPayload` passa a aceitar (e validar formato
sha) o campo. Consequência desejada: review ancorado no head LIDO; se o autor
empurrou commit durante a sessão, `staleForReview` acusa stale e o round 2/3 arma.

**G2. `decide()` com índice velho depois dos awaits.** decision.js:551 captura
`idx`, atravessa `headSha`/`myReviewStates`/`postReview` e usa o índice velho nos
splices (:577/:588). `recordDecision` faz unshift e `reconcilePending` roda
concorrente; o splice remove a pendência errada, que some das duas listas. FIX:
re-achar o índice por `d.id === item.id` imediatamente antes de CADA splice
(mesmo padrão do reconcilePending:209); idx < 0 = já resolvida por outro caminho,
seguir sem splice (e sem resolveIntoHistory duplicado).

**G3. Merge com autoanálise de head não lido.** `mergeSelfPR` (selfpr.js:407) lê
o PR fresco sem `headRefOid` e não compara com `analysis.headSha`. FIX:
acrescentar `headRefOid` ao `--json` e, quando `analysis.headSha` existir e
divergir, recusar com erro claro ("o PR recebeu commit depois da sua análise;
re-analise antes de mergear"). `analysis.headSha` vazio (análise antiga) mantém o
comportamento atual (não bloqueia), documentado no código.

**G4. Loop pago do scan de pushback.** pushback.js:86 usa `updatedAt do PR >
marcador`, com marcador = último comentário DO AUTOR. Atividade de terceiro
avança `updatedAt` pra sempre e a MESMA thread é reclassificada (sessão Claude) a
cada ciclo; registro `auto` não estanca (:83 só pula `manual`). FIX em duas
partes: (a) `detectAuthorPushback` só considera atividade nova quando existe
comentário do autor DEPOIS do marcador anterior (recebe `seen` e filtra por ele,
não só pelo meu review); (b) PR com registro `auto` já gravado só re-escaneia se
houver comentário novo do autor (mesma condição (a) cobre). Sem comentário novo
do autor: grava marcador e segue sem sessão.

**G5. Falha parcial de uma conta apaga estado da outra.** server.js:613-638:
`authAnyOk` global; lista parcial substitui `myPRs`, poda autoanálises da conta
que falhou e `reconcileHiddenPRs(true)` desoculta. FIX: rastrear POR CONTA quais
buscas responderam (`okAccounts`); a poda de `selfAnalyses` e a limpeza de
`hiddenPRs` só valem pra chave cuja conta dona (accountForPr/owner) está em
`okAccounts`. `myPRs` vira merge: entradas novas das contas ok + entradas
preservadas das contas que falharam (do `this.myPRs` anterior).

**G6. `seen.txt` sem atomicidade.** server.js:365 usa `writeFileSync` direto
(único estado fora do `writeJsonAtomic`). Truncamento = rajada de re-revisões
pagas. FIX: gravar via tmp + rename (mesmo padrão do writeJsonAtomic, mas texto
plano; extrair helper `writeTextAtomic` em lib/io.js e usar nos dois).

## Onda 2: round 2 resiliente e reconcile completo (alvo v2.41.3)

**G7. Reinício mata o round 2.** Âncora `reReviewLaunched[key]=head` persiste
(gravada ANTES de enfileirar, review.js:605), fila morre com o processo,
`recoverInflight` só faz unsee (não devolve: não estou em --review-requested).
FIX: `recoverInflight` poda de `engine.reReviewLaunched` as keys presentes no
inflight recuperado (e salva); o próximo check re-arma o gate com o mesmo head.

**G8. headSha falho no início da re-revisão = regressão do #742.** Sessão
relançada com `headShaAtual=''` faz o dedup degradar pra "todos os reviews" e o
CHANGES_REQUESTED do round 1 mata o round 2 como already_reviewed, com âncora já
queimada. O `launchReReviews` SABE o head (info.head, é a âncora) e não o passa.
FIX: `enqueueHeadless({ ...pr, knownHead: info.head, ... })` e
`runHeadlessReview` usa `pr.knownHead` como fallback quando o fetch do headSha
falha.

**G9. Retry pós-rede perde `requested: true`.** server.js:734 relança por URL
(`launchReview(stillOpen.map(p => p.url))`); o launchReview re-resolve no
panorama e `requested` vira `!!pano.mine` (false após round 1). FIX: novo caminho
de relançamento que usa o OBJETO guardado no retryAfterNet (era o motivo de
guardá-lo): `enqueueHeadless(prGuardado)` direto, preservando requested/knownHead.

**G10. Draft dispara re-revisão automática.** `reReviewTargets` não olha
`isDraft`; com onReject ligado, um REQUEST_CHANGES por push de WIP. FIX: draft
não arma re-revisão automática (`if (pr.isDraft) return false` no gate); o chip
manual continua cobrindo. Teste com isDraft true/false.

**G11. `reconcilePending` não trata CLOSED.** decision.js:187 só MERGED; PR
fechado sem merge = card eterno. FIX: `estado === 'CLOSED'` resolve como
`already_closed` (status novo no histórico, action skip), com toast "o PR foi
fechado; cancelei a revisão pendente". Rótulo do status na UI (ui/pure.js, onde
os demais status ganham label).

**G12. Review no MESMO head anterior ao createdAt nunca reconcilia.**
decision.js:201 filtra só por `r.at > item.createdAt`; aprovar à mão DURANTE a
sessão deixa card eterno. FIX: aceitar também review com `r.commit` igual ao
head da pendência (`item.headSha`, que o recordDecision precisa passar a gravar a
partir do headShaAtual da sessão; sem headSha gravado, comportamento atual). A
trava de horário continua valendo pro caso re-request (outro head).

**G13. Bloqueio `internal_language` sem saída no clique.** Pendência não tem rota
de edição; clique falha idêntico pra sempre. FIX mínimo honesto: quando
`decide()` recebe `blocked: 'internal_language'`, o card da pendência passa a
exibir o motivo persistente (campo `blockedReason` na pendência, salvo) com a
orientação de usar o chat do PR pra redigir e postar (caminho mediado já
existente); toast aponta o chat. Sem editor de payload nesta onda.

## Onda 3: ciclo de vida e higiene (alvo v2.41.4)

**G14. Update ignora sessão de terminal.** update.js:132 `sessionsBusy` não olha
`activeReviews` mode 'terminal'. FIX: incluir
`[...engine.activeReviews.values()].some(s => s.mode === 'terminal')` no busy.

**G15. `autoReviewParked` só memória.** server.js:207; reinício relança falha
conhecida. FIX: persistir em `state/auto-review-parked.json` (padrão
pushbackScanned: load no boot, save a cada mutação), poda de key fora do panorama
no check.

**G16. Orçamento só no enfileiramento.** FIX: `runOneHeadless` re-checa
`budgetBlockedFor(acct)` imediatamente antes de abrir a sessão; bloqueado =
devolve o PR pro estacionamento com toast único (não descarta, não loopa).

**G17. Capability 2h vs terminal sem prazo.** decision.js:429. FIX: pra sessão de
TERMINAL viva (activeReviews contém a sessão dona da cap), a expiração não vale
(a vida da cap = vida da sessão); TTL continua pros demais casos. Morreu a sessão,
morreu a cap (já é assim).

**G18. Primeira conta vence o mineMap mesmo silenciada.** server.js:595. FIX: no
dedup do mineMap, conta NÃO silenciada e com token vence conta silenciada/sem
token (preferência simples na inserção); empate mantém a primeira.

**G19. Double-click no Merge.** selfpr.js:374 sem guarda. FIX: Set
`mergeInFlight` por key; segunda chamada com key presente devolve
`{ ok: false, error: 'merge já em andamento' }` sem toast de erro vermelho.

**G20. `update-dl-*` nunca limpos.** update.js:90-99. FIX: no início de cada
tentativa de update, apagar diretórios `update-dl-*` mais velhos que 24h
(best-effort, try/catch por entrada).

**G21 (verificar antes de corrigir). Env de auth no console de login e no login
shell do mac.** Alegação do auditor: spawnLoginConsole (session.js:246) herda
process.env cru sem `applyClaudeAuthEnv`; no mac, `/bin/sh -lc` re-source do
profile re-injeta `ANTHROPIC_API_KEY` por cima do perfil. PRIMEIRO reproduzir a
mecânica lendo o código com calma (não foi verificada adversarialmente na
auditoria); se confirmar: aplicar `applyClaudeAuthEnv` no env do console de login
e, no posix, emitir `unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN` DEPOIS do
sourcing do profile (dentro do script, antes do exec do claude).

## Invariantes das três ondas

- Zero dependências novas; texto de UI e comentários em português SEM travessão.
- TDD: teste vermelho antes do fix, em test/ (runner nativo). Gate por task:
  `npm run check && npm test`.
- Quem mexe em dedup mexe nos TRÊS pontos (review.js canAuto, canReject,
  decision.js decide) e no teste dedup-round.
- Cada onda = uma release PATCH (doutrina de versionamento do CLAUDE.md), com
  CHANGELOG + RELEASE_NOTES + checklist completo.
- Nenhum gate de postagem afrouxa: correção que toque shouldAutoApprove/
  shouldAutoReject/coverageGap exige teste provando que o comportamento seguro
  permaneceu.
