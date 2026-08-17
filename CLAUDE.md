# Farol, guia do mantenedor

Leia isto antes de mexer em qualquer arquivo. Este documento existe pra que qualquer Claude Code (em qualquer máquina, Windows ou macOS) consiga manter o Farol sem quebrar os contratos do app.

## O que é

Radar de Pull Requests em Electron. O engine (`server.js`, Node puro) monitora o GitHub com comandos `gh` (zero tokens de IA), serve a UI local por HTTP + SSE e orquestra sessões do Claude Code (headless pra revisão autônoma, terminal pra sessão interativa). O `main.js` é só o shell Electron (janela, bandeja, notificações).

## Mapa de arquivos

| Caminho | Papel |
|---|---|
| `server.js` | A classe `Engine`: estado, polling, fila e as **fachadas finas** que delegam pros colaboradores de `lib/engine/`. Deixou de ser "o engine inteiro" na Onda 2 (ver `docs/QUALITY.md`): hoje ~2/3 dos métodos são só fiação de delegação |
| `main.js` | Shell Electron (janela, bandeja, notificações, autostart) |
| **`lib/`** | **Funções puras e infraestrutura, sem estado do engine** |
| `lib/paths.js` | Caminhos do app e `IS_WIN`/`IS_MAC` (fonte única do branch de plataforma) |
| `lib/io.js` | `run`/`runShell` (todo `gh` do Farol passa aqui; NUNCA lançam, devolvem `{ok,code,stdout,stderr}`), `readJson`, `copyRecursive`, `detectGitBash` |
| `lib/parse.js` | Normalizadores de config: contas, reviewers, perfis Claude, e o saneamento de `reviewModel`/`reviewEffort` por allowlist (os únicos valores que entram numa linha de comando de shell) |
| `lib/format.js` | `modelLabel` (id cru do CLI vira "Opus 5") e `isPermanentBranch` (protege develop/release/main de serem deletadas num merge) |
| `lib/taxonomy.js` | Papéis, domínios e níveis do perfil de review, com os textos de tom que entram no prompt |
| `lib/workspace.js` | Leitura dos artefatos que o Claude escreve: destaques, dossiês por autor, log |
| `lib/log-taxonomy.js` | **Fonte ÚNICA de classificação de falha** (v2.37.0). `classify(texto)` diz que tipo de falha é (`CLASSES`, tabela ordenada, primeira que casa vence) e o `kind` (`transitorio`/`espera-reset`/`permanente`/`operacional`) é o que o retry consulta pra decidir se relança. `resetAtFrom` extrai a hora do reset da mensagem de limite de plano. `parseLine`/`triage` agrupam o `farol.log` pro Diagnóstico. Falha nova se cadastra AQUI, e passa a valer no retry e no diagnóstico de uma vez. Não volte a escrever regex de erro dentro de `review.js` |
| `lib/http-server.js` | Servidor HTTP + SSE que serve a UI e as ~27 rotas de `/api` |
| `lib/spawnlog.js` | Registro opt-in dos processos disparados (caça o "terminal piscando") |
| **`lib/engine/`** | **Colaboradores da Engine: recebem o engine como contexto** |
| `lib/engine/review.js` | Revisão headless: fila por conta, escalonador paralelo (`processHeadless`), prompt (`headlessPromptFor`) e o ciclo de uma revisão |
| `lib/engine/decision.js` | O gate de postagem: `shouldAutoApprove`, `shouldAutoReject`, `coverageGap`, `checkpointGap`, `attentionPoints`, `postReview`, `decide`, capabilities das sessões interativas e projeção segura das decisões para a UI |
| `lib/engine/public-review.js` | Fronteira determinística entre diagnóstico interno e review: valida schema/linguagem de corpos e inlines, extrai review humano de registros legados e monta a allowlist enviada à UI |
| `lib/engine/fanout.js` | Fan-out de revisão em PR grande: mede o PR (`prMetrics`), decide se fatia (`shouldFanOut`), monta os lotes por afinidade de caminho (`planLotes`, função PURA) e injeta o instrutivo (`fanOutBlock`). Determinístico, ZERO IA e zero rede na parte que decide |
| `lib/engine/session.js` | Sessões do Claude: headless (`runClaudeStream`, `buildModelFlags`), terminal por SO (`buildSessionScript`/`Mac`), cancelamento (`killTree`). É aqui que o marcador `FAROL_CHECKPOINT` é interceptado (ver a seção "Checkpoint de verificação") |
| `lib/engine/verification-checkpoint.js` | Checkpoint de verificação da revisão headless: memória append-only por PR do que já foi confirmado contra o código (`checkpointPath`, `appendCheckpointEntry`, `readCheckpoint`, `summarizeCheckpoint`, `resumeBlock`). Só o ENGINE escreve, nunca a sessão; detalhe na seção "Checkpoint de verificação" |
| `lib/engine/selfpr.js` | "Meus PRs": autoanálise (nunca posta), `setReviewers` e `mergeSelfPR` (as duas ÚNICAS escritas no GitHub partindo daqui, com os gates travados em `test/merge-gates.test.js`) e o **ocultar PR** (`hidePR`/`unhidePR`/`reconcileHiddenPRs`, estado em `state/hidden-prs.json`, travado em `test/hidden-prs.test.js`). Ocultar é 100% local e **temporário por natureza**: guarda o `updatedAt` do PR e o `check()` desoculta sozinho quando esse carimbo muda (atividade nova). O engine NÃO filtra `myPRs` (quem esconde é a UI, que também mostra os ocultos), e a limpeza de chave órfã é POR CONTA desde a v2.41.2 (`reconcileHiddenPRs(okAccounts)`): só limpa chave cuja conta dona respondeu à busca de PRs meus neste ciclo, senão a queda de UMA conta desocultaria (e apagaria autoanálise) das outras. Não confunda com `clearSelfAnalysis`, que apaga só a AUTOANÁLISE |
| `lib/engine/pushback.js` | Memória de contestação: quem entra no scan (`pushbackTargets`), detecção e classificação |
| `lib/engine/gh-queries.js` | As buscas no GitHub (`searchPRs`, `myAuthoredPRs`, entregas) e os créditos do Sistema > Sobre (`refreshContributors`: contribuidores do repo do update, cache 24h, backoff de falha 1h) |
| `lib/engine/chat.js` | Chat por PR (`--resume` da sessão), com o preâmbulo que proíbe postar sem pedido explícito |
| `lib/engine/tools.js` | Ferramentas internas (kudos, diagnóstico), com escopo por conta |
| `lib/engine/update.js` | Auto-update: comparação de versão, download da release e aplicação por SO |
| `lib/engine/usage.js` | Agregação do consumo (por dia, tipo, conta e modelo) + log permanente por sessão (`usage-sessions.json`, sem poda, com o campo `ref`). **FONTE ÚNICA da aba Consumo (v2.40.0)**: `usageSummary` entrega série diária, séries empilhadas e matriz JÁ RECONCILIADAS contra `days` (a fatia de um dia sem detalhamento vira a camada `_resto`, "Sem detalhamento"; invariante travado em teste: soma das camadas == série do dia), o orçamento por perfil (`budgets`, mesma conta do gate real, refeita a cada push; o doctor NÃO carrega mais gasto/bloqueio), `sessionsSince` e `retentionDays`. A UI só fatia janela e formata; não crie definição de dado (janela, métrica, teto) do lado de lá |
| `ui/` | UI sem framework: `index.html` + `pure.js` + `app.js` + `app.css` |
| `ui/pure.js` | As funções PURAS da UI (esc, md, formatadores, agrupamento das Entregas). Módulo ES nativo: `ui/app.js` importa por `import { ... } from './pure.js'` (um `<script type="module">` só, sem o truque de carga dupla), e o `node --test` importa o mesmo arquivo por `import`/`import()`. É o único código de front que tem teste. Só entra aqui o que não toca DOM nem lê estado global |
| `workspace-template/` | Workspace semeado em `~/.farol/workspace` (protocolo de review do Claude); `prompts/pr-review-auto.md` é a revisão headless, `prompts/self-review.md` é a autoanálise dos meus PRs (só leitura, nunca posta) |
| `installer/install.ps1` / `uninstall.ps1` | Instalador Windows |
| `installer/install.sh` / `uninstall.sh` | Instalador macOS |
| `Instalar.cmd` / `Instalar.command` | Atalhos de duplo clique (Windows / macOS) |
| `tools/make-package.ps1` | Gera o zip LEVE de distribuição (sem node_modules) com auditoria anti-vazamento |
| `tools/make-installer.ps1` + `installer/farol.nsi` | Gera o INSTALADOR ÚNICO do Windows (`dist/Farol-Setup-vX.Y.Z.exe`, NSIS): um `.exe`, duplo clique instala e abre (roda o `install.ps1` por dentro). Requer `makensis` (vem com o Tauri em `AppData\Local\tauri\NSIS`). É o instalador de primeira instalação |
| `tools/make-offline-mac.sh` | Gera o instalador OFFLINE do macOS (`dist/Farol-Instalar-mac.command`): autoextraível único, Electron embutido. RODA EM QUALQUER SO (baixa o zip darwin do GitHub e EMBUTE; o `.app` é montado no Mac na instalação, pois só o unzip do Mac preserva os symlinks do `.app`). Default Apple Silicon; `ARCH=x64` pra Intel. É BETA até validar num Mac real |
| `tools/publish-release.ps1` | Publica a release no GitHub (`wandersonaadsantos/farol`): sobe o pacote leve (update) + o instalador único Windows. É como as cópias distribuídas recebem atualização |
| `tools/make-icns.sh` | Gera `assets/farol.icns` (rodar num Mac) |

## Invariantes do projeto (não negociar)

1. **Zero dependências além do Electron.** O engine roda com Node puro (`node server.js`). Não adicione pacotes npm.
2. **Dados em `~/.farol`, nunca em AppData/Library.** No Windows o motivo é o MSIX virtualizar `%LOCALAPPDATA%`; no macOS mantemos o mesmo caminho por simetria (o estado migra entre máquinas copiando uma pasta só).
3. **Log só de falhas.** `farol.log` não recebe ruído operacional; o Diagnóstico usa esse log como fonte. **A classificação dessas falhas mora só em `lib/log-taxonomy.js`** (desde a v2.37.0): quem decide retry (`runOneHeadless`) e quem monta o Diagnóstico leem a MESMA tabela. Duplicar a regra foi o que deixou o painel mostrando 159 linhas cruas de 4 episódios enquanto o motor achava que entendia o erro.
4. **Nada é postado no GitHub sem gate.** Auto-approve exige `requested === true` (revisão pedida a mim; revisão iniciada por clique no panorama nunca auto-posta), veredito `approve` e payload `APPROVE`. Com `autoApproveAll: true` (OPT-IN, ligado em Sistema) TODO PR aprovável é aprovado sozinho, sem depender do humano. **O corpo do APPROVE vai LIMPO no PR (tem que parecer humano, ver "review humano" abaixo), nunca com carimbo de "automático". A ressalva TÉCNICA sobre o código entra no corpo, escrita como um revisor sênior mencionaria de passagem (desde a v2.26.1, ver o parágrafo "Ressalva vai pro PR" abaixo); a ressalva OPERACIONAL do nosso fluxo (`result.reasons` que sejam de processo + aviso se `cardMet === false`) fica SÓ no app, no campo `attention`, visível em Revisões recentes.** O DEFAULT é `false` (gate estrito de sempre: só auto-aprova quando a sessão decidiu `decision === 'auto_approve'` E `cardMet === true`), por segurança, já que o app é público/multiusuário e cada um liga se quiser. A decisão fica isolada em `shouldAutoApprove(pr, result)` (devolve `{ ok, motivo }`; o `motivo` alimenta a transparência do runHeadlessReview, que só atribui a recusa à política da conta quando o motivo é `politica`); a composição dos pontos em `attentionPoints`. **Cada conta pode sobrescrever esses padrões globais** (painel Contas): `autoReview` (revisa sozinho / só põe na fila / herda), `onClean` (PR aprovável sem ressalva: `approve`/`wait`) e `onCaveats` (aprovável com ressalva: `approve`/`wait`). O engine resolve por conta em `autoReviewFor(user)` (gate da revisão automática, por `pr.account`) e `approvePolicyFor(user, clean)` (usado por `shouldAutoApprove`; `clean` = sem pontos de atenção e `decision === 'auto_approve'`). Campo ausente na conta = herda o global. `acctPolicy(user)` acha a conta. **Reprovar sozinho** é OPT-IN por conta (`onReject: 'request_changes'`, default `wait`, sem global): quando a revisão pede mudanças (`verdict === 'request_changes'` + payload REQUEST_CHANGES) num review PEDIDO a mim (clique nunca posta) e a conta optou, o app posta o REQUEST_CHANGES com os bloqueios (corpo LIMPO, sem carimbo de automático), dedup por `myReviewStates` (não re-pede se eu já pedi **para o head atual**, ver "Dedup é por round" abaixo). Gate isolado em `shouldAutoReject(pr, result)`/`rejectPolicyFor(user)`; nunca reprova sozinho por default. **A auto-revisão (headless) vale pra TODA a fila elegível da conta com `autoReview` ligado, não só os PRs que acabaram de chegar** (`check()` filtra `this.queue`, não só `fresh`): ligar "revisa na hora" passa a valer pro que já estava esperando. PRs que falharam sem ser rede, ou que você cancelou, ficam em `autoReviewParked` (aguardam ação manual, não relançam sozinhos); lançar de novo (manual) tira do estacionamento. **A revisão headless roda até `config.parallelReviews` POR CONTA em paralelo** (default 1 = serial dentro da conta, o comportamento de sempre; contas diferentes revisam juntas desde sempre; opt-in em Sistema > Automação, 1..4, sanitizado por `sanitizeParallelReviews` no boot/updateSettings E clampado de novo em `parallelLimit` no escalonador, defesa em profundidade): `processHeadless` é um escalonador que puxa da `headlessQueue` revisões até o teto da conta, contando em `headlessBusyAccounts` (**Map conta -> contagem** desde a v2.41.0; era Set); `runOneHeadless(pr, acct)` roda cada uma e devolve o slot via `freeHeadlessSlot` (zera com delete, nunca set 0: o isBusy do update.js pergunta `.size`) + reprograma no fim. `headlessAcct(pr)` = conta dona (por `accountForPr`). **Perfil de review por pessoa** (`config.people` = {login: {papel?, dominios?{backend|frontend|dados|infra: nivel}}}, marcado à mão: papel no card do PR e na aba Time, matriz por domínio só na aba Time) molda o TOM e a POSTURA da revisão automática, NUNCA a decisão. `personProfileBlock(login)` injeta no prompt headless (`headlessPromptFor(url, author)`): PAPEL (estagio/junior/pleno/senior/techlead/arquiteto/especialista) dá o tom-base, a MATRIZ (basico/intermediario/avancado/autoridade por domínio) calibra a postura conforme a área que o PR mexe (autoridade→defere; básico→explica mais). A instrução trava: só TOM/POSTURA, nunca verdict/decision/cardMet/gate. Sem perfil = bloco vazio (neutro). Só no caminho headless, não no terminal. Migração: o `config.seniority` plano antigo vira `papel` (`migrateSeniorityToPeople` no load). `parsePeople` valida/normaliza. **Review humano/personalizado:** `reviewFormatBlock()` (injetado SEMPRE junto do perfil, PREVALECE sobre o formato do CLAUDE.md do workspace) manda escrever o corpo postado como uma PESSOA (o Wanderson), personalizado/objetivo/profissional: SEM caixas de alerta `> [!NOTE]`, SEM "Placar", SEM checklist `- [x]`, SEM prefixos de Conventional Comments no texto, SEM citar automação/Farol/"auto-aprovei" (o autor não pode saber que é bot), sem travessão, e o FORMATO adapta à senioridade (estágio/júnior = prosa de mentor; pleno/sênior/arquiteto = enxuto e direto). O protocolo de review (`CLAUDE.md`, `prompts/pr-review-auto.md`, `prompts/self-review.md`, `.claude/agents/pr-reviewer.md`) é RE-SINCRONIZADO da fonte a cada boot (`prepareHome`), pra mudanças de formato chegarem nas cópias já semeadas (nunca toca em `state/`). **Memória de pushback (automática):** quando o autor contesta um review meu, o Farol detecta e classifica sozinho. `scanPushbacks()` roda no `check()` (fire-and-forget, guarda `pushbackScanning`, best-effort): só entra no scan o PR cujo review MEU foi **bloqueio** (`request_changes`) ou **aprovação COM ressalva** (aprovação limpa não gera pushback; `reviewActions()` expõe `caveats` = mesmos pontos do `attentionPoints`, card não comprovado ou motivo listado, pra distinguir). Nesses, gatilho barato via gh (`detectAuthorPushback` = atividade do autor DEPOIS do meu último review; marcador em `state/pushback-scanned.json` evita reprocessar; `updatedAt` do PR é o gate) e, só nos candidatos novos, `classifyPushback` (1 sessão Claude LEITURA pura, nunca posta, `MAX_PER_CYCLE=2`) devolve `{isPushback, outcome, confidence, note}`. Confiança ALTA vira registro `confirmed` sozinho; BAIXA vira `pending` (aparece como "confirmar?" no controle de Revisões recentes, com o desfecho sugerido, você resolve num toque). Registros em `state/pushbacks.json` carregam `source`('auto'|'manual')/`status`('confirmed'|'pending')/`confidence`. `recordPushback` (marcação/correção à mão) é sempre `manual`+`confirmed` (override). `pushbacksFor` (injeção no `personProfileBlock`) usa SÓ confirmados, pra não calibrar em cima de palpite. Mesma trava: só tom/postura, nunca a decisão. Migração: registros antigos sem `source` viram manual+confirmed. **A autoanálise em si (Meus PRs) NUNCA posta nem escreve em `state/`** (é diagnóstico do autor sobre o próprio PR): o caminho `runSelfAnalysis` não passa pelo gate de postagem, o prompt `self-review.md` proíbe qualquer `gh`/`git` de escrita, e o resultado fica só em `self-analyses.json`. **As escritas no GitHub partindo de Meus PRs são só duas, ambas por clique explícito: o botão "Reviewers" e o botão Merge.** O botão **"👥 Reviewers"** (`setReviewers`) atribui o autor e pede review da lista efetiva do repo, resolvida por `reviewersForRepo(repo)`: a EXCEÇÃO do repo (`config.projectReviewers[repo]`) se houver, senão o PADRÃO da org (`config.defaultReviewers[org]`). Assim funciona em qualquer repo da org que tenha padrão, mesmo sem config própria. Aceita pessoas e times `org/slug`, sem confirmação (aplica na hora); não posta review nem mergeia, só ajusta assignee/reviewers, e filtra o próprio autor da lista. O botão **Merge** (`mergeSelfPR`), acionado por clique explícito com confirmação, e gateado: só o autor mergeia o próprio PR (`author === ghUser`), só quando a autoanálise marcou `approvable === true`, só em repo fora de `config.mergeBlockedRepos` (default `biudtech/biud-frontend`), e nunca em rascunho/PR com conflito. Faz merge commit (`gh pr merge --merge`, sem squash/rebase), atribui o autor se preciso, e deleta a branch de origem **só se for descartável** (`isPermanentBranch` protege develop/release*/main/master/hml*/staging/etc., que jamais são deletadas). Quando o merge normal esbarra na proteção de branch (`blocked: 'policy'`), a UI oferece duas saídas: **auto-merge** (`--auto`, mergeia quando os requisitos passarem, sem burlar nada) e **merge como admin** (`--admin`, bypassa a proteção agora, só se você for admin, com confirmação reforçada). Os dois modos passam pelos mesmos gates (autor/aprovável/lista bloqueada), então nem admin mergeia repo bloqueado como `biud-frontend`. **O botão só fica disponível quando dá pra mergear de verdade**: o engine lê a mergeabilidade real de cada PR aprovável (`refreshMergeStates` no fim do `check()` e após cada autoanálise aprovável, guardada em `mergeStates`) via `gh pr view --json mergeable,mergeStateStatus`. CLEAN/UNSTABLE = botão Merge ativo; BLOCKED = mostra auto/admin direto (sem tentativa que falha); DIRTY/BEHIND/DRAFT = botão desabilitado com o motivo. O Auto-merge só é oferecido quando o repo tem `allow_auto_merge` ligado (`fetchAutoMergeAllowed`); senão o botão fica desabilitado e sobra o Merge (admin). Se ainda assim o `gh` recusar o `--auto` (`enablePullRequestAutoMerge`), o merge devolve `blocked:'autoUnavailable'` com mensagem acionável, e a condição é logada como WARN (não ERROR), já que não é bug do Farol.
   **Fronteira do review humano (v2.40.7).** `reportMarkdown`, `reasons`, `attention`, memória, cobertura e gate são diagnóstico interno persistido; `reviewMarkdown`, `payloads.*.body` e cada `comments[].body` são texto de review. `postReview` normaliza o schema e roda `publicReviewLanguageIssues` antes de credencial, arquivo temporário ou `gh`; o fallback de inline é validado de novo. Qualquer vazamento de processo, origem da revisão ou template robótico falha fechado nos fluxos mediados pelo app. O protocolo de terminal e chat manda usar `/api/review/post` com capability efêmera limitada às keys e à conta da sessão, e o writer comum aplica o mesmo gate. Essas sessões ainda recebem uma credencial GitHub para investigar PRs privados, então a capability evita bypass acidental, mas não é uma fronteira contra um processo deliberadamente malicioso que ignore o protocolo e use a credencial diretamente. A UI recebe `decisionForUi`, uma allowlist com o review humanizado e diagnósticos reescritos, nunca o relatório bruto nem os payloads. O protocolo sincronizado inclui também `.claude/commands/pr-review.md`.

   **Ressalva vai pro PR (mudança de 29/07/2026, decisão do Wanderson; valia o contrário até a v2.26.0).** Aprovável COM ressalva **aprova** (ressalva nunca bloqueia) e a ressalva **aparece no corpo do PR**, escrita como um revisor sênior mencionaria de passagem, sem checklist e sem seção rotulada. **Filtro obrigatório** (em `reviewFormatBlock`): ressalva TÉCNICA sobre o código entra no corpo; ressalva OPERACIONAL do nosso fluxo NÃO entra e fica só em `reasons`/`attention` (card não confirmado por falha de acesso ao Jira, review que não era pedido a mim, discordância com outro review, política de conta, cobertura incompleta), porque é assunto interno e citar vazaria a automação.

   **Cobertura da leitura é gate (v2.26.0).** Motivo medido em 29/07/2026 sobre 44 reviews reais: o tamanho do PR varia 4359x no histórico e o esforço visível do review varia 3x; a correlação entre linhas do diff e âncoras `arquivo:linha` é **r = -0,08**, ou seja, nenhuma. Nos PRs acima de 2000 linhas, 3 de 5 saíram sem uma única âncora, e o #688 (74 arquivos, 8717 linhas) auto-aprovou com relatório de tamanho médio, zero âncora e zero achado. Conclusão: "nenhum achado" era indistinguível de "li 20% e não vi nada". Agora o envelope carrega `coverage: {total, reviewed[], missing[]}` e `coverageGap(result)` segura a postagem automática (approve E reject) quando falta arquivo, mandando pra decisão humana com a lista. **Dois eixos separados, não confunda:** ressalva é o que a revisão ENCONTROU (não bloqueia), cobertura é o que ela conseguiu LER (bloqueia a postagem sozinha, porque sem leitura completa não há prova). A rede de segurança também pega `reviewed.length < total` mesmo com `missing` vazio. Envelope sem `coverage` (passe único) devolve `[]` e nada muda.

   **Fan-out em PR grande (v2.26.0).** Acima de **1000 linhas OU 20 arquivos** (limiar medido: pega 28% dos PRs do histórico, 7 de 25), o engine mede o PR com uma chamada `gh pr view --json additions,deletions,changedFiles,files`, monta 2 a 4 **lotes** por afinidade de caminho (`planLotes`) e injeta o instrutivo. A sessão principal então dispara **um subagente `pr-reviewer` por lote, em paralelo** (ela já disparava um; agora dispara N), cada um lendo por completo só os arquivos do seu lote e **ciente dos caminhos dos outros lotes** (pra sinalizar dependência cross-lote sem afirmar defeito em arquivo que não leu). A consolidação é na própria sessão: dedup por `arquivo:linha`, resolução das suspeitas cross-lote e **o gate dos 8 blockers aplicado UMA vez** sobre o conjunto (a decisão continua num lugar só). Falha na medição degrada pro passe único de sempre, que é sempre seguro. **`planLotes` DESCE por profundidade de caminho, nunca sobe pro pai:** a 1ª versão fundia o menor grupo no diretório pai e a validação com o #688 real reprovou (cascateava até a raiz e um lote ficava com 53 dos 74 arquivos, recriando o problema). Fundir os dois menores entre si mantém o equilíbrio. **Aritmética conhecida:** com teto de 4 lotes, um PR de 8717 linhas ainda dá ~2200 linhas por lote; subir o teto custa quase nada em tokens (o total de linhas lidas é o mesmo, muda só o overhead por subagente), então se a cauda de PRs gigantes incomodar, o caminho é `MAX_LOTES`.
   **ATENÇÃO, e é a parte mais importante deste parágrafo: até a v2.27.0 nada disso rodou.** A fachada `Engine.headlessPromptFor` declarava `(url, author)` enquanto a implementação em `lib/engine/review.js` recebe `(engine, url, author, lotes, metrics)` e o chamador em `runHeadlessReview` passava os quatro. Os dois últimos eram engolidos pela fachada, chegavam `undefined`, e `fanOutBlock` nunca era concatenado: o Farol media o PR, montava os lotes e **jogava o plano fora**, seguindo no passe único. Todo o módulo `fanout.js` e a bateria de testes dele estavam verdes porque testavam as funções puras, não o caminho até o prompt. Corrigido na **v2.28.0**, com `test/review-prompt.test.js` travando os dois lados: o comportamento (o bloco chega no prompt) e a **aridade das fachadas** (tabela curada; varredura automática daria falso positivo em funções puras que não recebem `engine` e em parâmetro desestruturado com default, que reduz `Function.length`). Consequência prática de ter corrigido: PR grande passou a custar bem mais tokens, porque agora ele é de fato lido inteiro. Fachada nova que carregue argumento de comportamento entra naquela tabela.

5. **Toda diferença de SO passa por `IS_WIN`/`IS_MAC`/`IS_LINUX`** (fonte única em `lib/paths.js`), nunca por checagens soltas espalhadas. Doutrina desde a v2.45.0: o que é POSIX genuíno (runShell, spawn headless, killTree, PATH do boot) ramifica em `!IS_WIN` e vale pra mac E linux; o que é mac de verdade (`open`, `Farol.app`) usa `IS_MAC`; o ramo Linux (experimental) fica ao lado, ver a seção "Linux (experimental)".
6. **Texto da UI e comentários em português, sem travessão.** Use vírgula, parênteses ou dois pontos.
7. **O zip de distribuição é auditado** (`make-package.ps1` falha se detectar estado, config, token ou conta pessoal). Não enfraqueça a auditoria.

## Pontos com branch de plataforma

Todos em `server.js`, salvo indicação:

| Função | Windows | macOS |
|---|---|---|
| PATH no boot | nada | prependa `/opt/homebrew/bin` etc. (app aberto pelo Finder tem PATH mínimo) |
| `runShell` | `cmd.exe /d /s /c` | `/bin/sh -lc` |
| `runClaudeStream` | spawn `cmd.exe` | spawn `/bin/sh -lc` com `detached: true` (grupo próprio) |
| `killTree` | `taskkill /t /f` | `process.kill(-pid)` (o grupo inteiro) |
| `spawnConsole` | `.cmd` + PowerShell `Start-Process` | `.command` + `open -a Terminal`; o script avisa o fim via `POST /api/session-exit` e se apaga (trap EXIT) |
| `applyUpdate` | `install.ps1` via PowerShell detached | `applyUpdateMac`: `install.sh` via bash detached |
| `detectGitBash` | procura o Git Bash | retorna `null` (não se aplica) |
| `main.js`: janela | `titleBarStyle: hidden` + `titleBarOverlay` | `hiddenInset` (semáforo nativo à esquerda) |
| `main.js`: bandeja | `tray.png` direto | resize pra 18px (barra de menu) |
| `main.js`: autostart | `setLoginItemSettings` com args | desabilitado (login item ignoraria os args; a UI esconde a opção) |
| `ui/app.js` | check do Git Bash no doctor | esconde Git Bash e autostart; classe `mac` no body (padding do semáforo) |

**Fonte de verdade da plataforma na UI (v2.28.0):** é o ENGINE (`snapshot.app.platform`), nunca o `navigator.userAgent`. `ui/app.js` mantém `PLATAFORMA` + `ehMac()`/`ehWin()` e `aplicaPlataforma(p)`, chamada na primeira linha do handler `state` do SSE. O userAgent segue sendo lido UMA vez, só como palpite do primeiro paint (sem ele o padding do semáforo do macOS piscaria antes do primeiro estado chegar). Antes eram duas fontes de verdade no mesmo arquivo (userAgent no cromo, `app.platform` no doctor), que divergem de verdade ao abrir a UI de um Mac contra um engine Windows. `ehMac`/`ehWin` são FUNÇÕES de propósito: uma referência esquecida ao antigo `isMac` vira `ReferenceError` alto, em vez de um `if (isMac)` sempre verdadeiro (função é truthy) falhando calado.

## macOS: estado real e o que falta validar

**O suporte a macOS foi escrito no Windows e NUNCA rodou num Mac de verdade.** O código segue as APIs documentadas, mas você, Claude rodando num Mac, é o primeiro teste real. Assuma que pode haver quebras e valide na ordem abaixo antes de dar qualquer coisa por funcionando:

1. ~~**Instalar**~~ **VALIDADO (28/07/2026, Mac real, Apple Silicon, via `Farol-Instalar-mac.command` v2.23.4)**: `~/.farol/app`, `~/.farol/workspace` e `~/Applications/Farol.app` criados certinhos, symlinks do Electron preservados, sem atributo de quarentena no `.app` (só `com.apple.provenance`, que não bloqueia). PEGADINHA: o app vai pra `~/Applications` (por usuário, sem pedir admin), que NÃO é a `/Applications` da barra lateral do Finder, então o usuário "não acha o app". Um symlink resolve (`ln -s ~/Applications/Farol.app /Applications/Farol.app`, funciona sem sudo pra quem é admin); avaliar fazer o `install.sh` criar esse symlink quando tiver permissão. Pra instalar do zip leve: `bash Instalar.command` (o zip gerado no Windows não preserva bit de execução, então a primeira vez é com `bash`, não duplo clique).
2. ~~**Abrir**~~ **VALIDADO E CORRIGIDO (28/07/2026)**, com DOIS bugs reais achados num Mac de verdade:
   - **Launcher morria em silêncio via Finder/Spotlight**: o wrapper dava `exec` no `node_modules/.bin/electron`, que é script node (`#!/usr/bin/env node`); Finder/Spotlight lançam com PATH mínimo (sem node) e o wrapper morria com `env: node: No such file or directory`, sem janela e sem log. PEGADINHA DE VALIDAÇÃO: `open` rodado de um shell PROPAGA o env do chamador (PATH com node), então "funciona no terminal" NÃO valida o clique do usuário; valide com `env -i HOME="$HOME" PATH=/usr/bin:/bin:/usr/sbin:/sbin ~/Applications/Farol.app/Contents/MacOS/Farol`. Corrigido no `install.sh`: o launcher agora dá `exec` direto no binário NATIVO (`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`), zero dependência de node no PATH.
   - **Janela subia atrás de tudo e sem foco**: o app que o Finder ativa (wrapper) morre no `exec`, e o Electron subia sem ativação. Corrigido no `main.js` com `app.focus({ steal: true })` no `createWindow` e no `showWindow` (só `IS_MAC`).
   - Confusão restante de identidade: no Dock/Cmd-Tab o NOME é "Electron" (pendência documentada abaixo); o ícone foi resolvido no item 8. Se não abrir mesmo, rode o launcher à mão pra ver o erro: `~/Applications/Farol.app/Contents/MacOS/Farol`.
3. **Doctor** (aba Sistema): gh, conta e claude precisam ficar verdes. Se `gh`/`claude` não aparecem, o problema é PATH (veja o bloco de PATH no topo do `server.js`; adicione o diretório que faltar).
4. **Polling**: o Radar deve listar PRs reais em ~30s. Erros aparecem em `~/.farol/workspace/state/farol.log`.
5. **Revisão headless sem risco**: desligue "Revisar automaticamente" em Sistema, clique Revisar num PR do panorama (nunca auto-posta) e confira o feed ao vivo + o card em "Precisa de você". Cancele no meio pra validar o `killTree` posix.
6. **Sessão no terminal**: ícone de terminal num card da fila. Deve abrir o Terminal.app, rodar o claude e, ao sair, o pill "sessão no terminal" deve sumir (é o `curl` do trap EXIT chamando `/api/session-exit`). Se o pill ficar preso, o trap não rodou. **O trap que não roda deixa uma entrada FANTASMA em `activeReviews`, e essa entrada gateia DUAS coisas, não só o pill:** (a) o **busy do update** (`sessionsBusy` em `lib/engine/update.js`, G14: sessão de terminal viva barra o installer, que mataria a janela no meio) e (b) a **isenção de TTL da capability de postagem** (`terminalOwnerAlive` em `lib/engine/decision.js`, G17: enquanto a sessão dona vive, a cap vive junto). Nos dois, a entrada fantasma valeria pra sempre, então nos dois vale o MESMO teto de **12h** desde esta release (`TERMINAL_SESSION_MAX_MS`, exportada por `decision.js` e importada pelo `update.js`, fonte única: dois números divergentes fariam a mesma janela morta ser fantasma num lugar e viva no outro). Acima de 12h a entrada deixa de contar: o update volta a aplicar e a cap expira pelo TTL de sempre. Sessão sem `startedAt` confiável continua contando como viva nos dois lados (falha fechado: sem idade provada não dá pra afirmar fantasma, e matar sessão viva é pior). **A saída definitiva pro fantasma continua sendo reiniciar o app**, que zera o `activeReviews` (é memória, nunca persiste); o teto de 12h é rede de segurança pra quem deixa o Farol aberto por dias, não conserto do trap.
7. **Update**: com uma fonte mais nova em `~/Documents/farol`, o botão Atualizar agora deve fechar, atualizar e reabrir o app. Log em `~/.farol/workspace/state/update.log`. **BUG REAL ACHADO NUM MAC (30/07/2026, Thiago, v2.26.0) E CORRIGIDO NA v2.26.1**: o auto-update NUNCA funcionou no macOS. O `Compress-Archive` do Windows PowerShell grava as entradas do zip com `\` separando as pastas, e o formato zip exige `/` (APPNOTE 4.4.17.1); o `unzip` do Mac avisava `appears to use backslashes as path separators` e saía com código 1, que o `update.js` tratava como falha fatal ("falha ao extrair (unzip)"). Todos os `farol-v*.zip` publicados até a v2.26.0 têm o defeito (verificado nos históricos). Duas correções: (a) `make-package.ps1` monta as entradas na mão via `ZipFileExtensions::CreateEntryFromFile` com o nome normalizado, e a auditoria REPROVA o pacote se aparecer `\` ou raiz absoluta (PEGADINHA do fix: `$env:TEMP` volta em caminho curto `WANDER~1`, então a raiz e o enumerador têm que sair do MESMO caminho resolvido, senão a subtração de prefixo erra por um caractere e todas as entradas de raiz saem como `/arquivo`); (b) `update.js` passa a aceitar saída 1 do Info-ZIP (aviso, não erro), deixando a checagem do `installer/install.sh` ser o gate de verdade. FALTA validar num Mac real: atualizar de uma versão instalada para a v2.26.1 pelo botão.
8. ~~**Ícone**~~ **VALIDADO E COMPLETADO (28/07/2026)**: `bash tools/make-icns.sh` gerou o `.icns` num Mac real (transparência dos 4 cantos validada programaticamente, inclusive no 1024px extraído do `.icns`) e `bash installer/install.sh` levou ele pro lançador. DOIS avisos: (a) o `.icns` no wrapper só cobre Finder/Spotlight/Launchpad; o ícone do DOCK em runtime é o do processo (Electron cru), então o `main.js` passou a chamar `app.dock.setIcon` com `assets/png/farol-256.png` no boot (só `IS_MAC`); (b) reinstalar da FONTE exige o dist do Electron darwin em `node_modules/electron/dist` do repo (o `install.sh` copia o `node_modules` inteiro; sem o dist ele cai no `npm install` de rede ou quebra). Se a instalação atual funciona, semeie antes: `cp -R ~/.farol/app/node_modules/electron/dist <repo>/node_modules/electron/dist` (e o `path.txt` junto). Depois de trocar ícone, refresque o cache: `lsregister -f` no bundle + `killall Dock`.

Pendências conhecidas do port (decisões conscientes, não bugs):

- **Autostart não existe no macOS** (login item com Electron + args não é confiável). Se for implementar, o caminho é um LaunchAgent em `~/Library/LaunchAgents`.
- **O nome no menu do macOS aparece como "Electron"** enquanto rodarmos o binário cru do Electron. Resolver exige empacotamento de verdade (electron-builder), o que quebraria o invariante 1; só vale se o time Mac crescer.
- **`.command` aberto por duplo clique pode pedir permissão** na primeira vez (Gatekeeper em arquivos baixados). `bash Instalar.command` contorna.
- **Notificações**: `displayBalloon` é Windows; no macOS o `Notification` do Electron cobre, mas a primeira notificação pede permissão do sistema.

**O que a v2.28.0 NÃO resolveu do macOS, pra não dar impressão errada:** ela unificou a fonte de verdade da plataforma na UI e acrescentou `test/session-posix.test.js` (trava `/bin/sh -lc` + `detached: true`, a pré-condição do `killTree` posix), mas esse teste **pula no Windows** e, portanto, **nenhum item pendente do checklist acima foi validado num Mac real**. O que mudou é que, quando o primeiro Mac rodar `npm test`, o contrato do spawn dá SINAL em vez de silêncio. Os itens 3, 4, 5, 6 e 7 seguem pendentes.

**Auditoria cross-platform de 16/08/2026 (4 frentes: engine, apresentação, instalação, testes), corrigida sem Mac real:** porta sem fallback nos dois `notify()` dos `.command` (URL virava `:undefined` e o pill ficava preso pra sempre); conta pedida sem token agora ABORTA a sessão de terminal do mac como o `ghEnv` do Windows (antes caía calado na conta ativa do keyring, o cenário A1); `buildLoginScriptMac` ganhou o `unset GH_TOKEN` + pagers que só existiam no `loginConsoleEnv` do Windows; `logSpawn` nos três spawns do mac; script de login com `0o700` (era `0o755` com chave de API em claro); comparação de caminho case-insensitive só no Windows (APFS pode ser case-sensitive); `install.sh` não exige mais Node no modo offline (derrubava instalador E auto-update em Mac sem Node; a versão sai por `sed`) e valida o binário NATIVO do Electron (o que o lançador executa), não o `.bin`; `install.ps1` virou `/MIR` (arquivo deletado na fonte agora morre no destino) e leva `installer/`+`Desinstalar.cmd` pro app instalado; auditoria do pacote passou a varrer `*.sh`/`*.command`; `applyUpdateMac` tem montador puro testado (`buildUpdateScriptMac`, apóstrofo escapado) como o M14 do Windows; `killTree` posix tem teste com processo real (skip no Windows); PATH do boot virou `prependPathDirs` pura testada; `sid` do `--resume` do chat passa por allowlist de formato antes de entrar na linha de shell. Sobra pro Mac real: o checklist 3-7 acima continua pendente de validação de campo.

Quando validar (ou corrigir) qualquer item acima, **atualize esta seção**: risque o que passou, documente o que mudou e por quê. Este arquivo é a memória do port.

## Linux (experimental, v2.45.0)

Fundação aprovada pelo Wanderson em 16/08/2026 (sem usuário concreto; a motivação é completude honesta nos três SOs). NÃO é port desktop completo: **fora de escopo por decisão** ficam tray/autostart/notificações polidos, AppImage e instalador offline. WSLg não tem bandeja, então essa borda só se valida em desktop nativo, quando houver usuário.

O que existe:

- **Sessão de terminal**: os scripts bash do mac servem sem mudança; o que muda é o lançador. `pickLinuxTerminal(candidates, exists)` (pura, testada) escolhe na cadeia `x-terminal-emulator` (alternatives do Debian) → `gnome-terminal` → `konsole` → `xterm`; nenhum achado = toast alto com instrução, nunca silêncio. `spawnConsolePosix`/`spawnLoginConsolePosix` são o núcleo compartilhado mac/linux (o mac vira wrapper com `open -a Terminal`); o contrato M5 (exit != 0 = janela nunca abriu, limpa e devolve keys) vale igual nos dois.
- **Update**: `buildUpdateScriptLinux` (pura, mesmo escaping do mac) roda `install-linux.sh` e reabre via `setsid ~/.farol/bin/farol`; `posixInstallerName(isMac)` escolhe o instalador do ramo posix.
- **Instalação**: `installer/install-linux.sh` + `uninstall-linux.sh`. App em `~/.farol/app`, lançador `~/.farol/bin/farol` (exec no binário NATIVO `node_modules/electron/dist/electron`, mesma lição do mac), `.desktop` em `~/.local/share/applications` com ícone PNG. `FAROL_INSTALL_ROOT` permite instalar num root de teste sem tocar a instalação real (a lacuna A5 que o mac ainda tem). Fonte sem `node_modules` (clone limpo) cai no `npm install`.
- **UI**: exemplos de caminho decidem por `ehWin()` (Linux vê `~/`); autostart só aparece no Windows (`setLoginItemSettings` é no-op no Linux).

Validação real (WSL Ubuntu-24.04, 16/08/2026, bancada oficial do ramo): `npm test` VERDE no Linux (1110 pass, incluindo os posix reais: killTree de grupo, quoting em bash, prefixo de auth); `install-linux.sh` rodou de ponta a ponta a partir de clone limpo com `FAROL_INSTALL_ROOT` (npm pulou o postinstall do electron e o fallback pro `install.js` cobriu, ver comentário no script); o app instalado ABRIU no WSLg pelo lançador e o engine respondeu HTTP 200 na 47170. NÃO validados (limite do WSLg, não do código): tray, notificações, sessão de terminal com emulador real (o WSL não tem terminal gráfico instalado; o caminho do "nenhum terminal" avisa alto por construção).

## Modelo e esforço das sessões autônomas

Dois campos de config (`reviewModel`, `reviewEffort`) que viram as flags `--model` e `--effort` da linha headless. São os **únicos valores de configuração que entram numa linha de comando montada por concatenação e passada a um shell** (`cmd.exe /d /s /c` no Windows, `/bin/sh -lc` no mac), então a defesa é **allowlist, nunca escaping**, em `lib/parse.js` (`sanitizeModel`, `sanitizeEffort`, `effortForModel`), aplicada em TRÊS camadas: no boot (construtor da `Engine`, pra config.json editado à mão), no `updateSettings` (caminho HTTP) e de novo em `buildModelFlags` (defesa em profundidade). Valor inválido no `updateSettings` MANTÉM o anterior; no boot vira `''`.

`buildModelFlags(config, opts)` (`lib/engine/session.js`) é **pura e exportada**: é o único ponto onde a flag é montada, e existe separada justamente pra ser testável (antes a montagem vivia dentro do `runClaudeStream`, que faz spawn, e o stub suprimia a flag, ou seja: não dava pra provar o que ia pra linha). Com `FAROL_HEADLESS_CMD` setado ela devolve `''`, contrato do qual toda a bateria stubada depende.

**Modelos expostos** (6): `''` (padrão), `best`, `opus`, `sonnet`, `haiku`, `fable`. Os 5 aliases foram testados contra o CLI 2.1.220 e todos respondem. **Fora de propósito:** `opusplan` (o `claude -p` não tem plan mode, a sessão inteira cairia pra Sonnet sob rótulo de Opus), `default` (indistinguível de `''`, já que o Farol nunca seta `ANTHROPIC_MODEL`) e `opus[1m]`/`sonnet[1m]` (colchete é **glob pro `/bin/sh`**: rodando com cwd no WORKSPACE, `opus[1m]` casaria com um arquivo `opus1` e viraria outro argumento, calado; sem match o sh deixa passar, então "funciona quase sempre", que é pior). Se um dia quiser as variantes `[1m]`, o caminho é aspa simples no lado POSIX e valor cru no Windows, decidido dentro do próprio montador, com teste de execução real em `sh`. Nome completo (`claude-opus-5`) é aceito pelo engine via `MODEL_FULL_RE`, como escotilha pra modelo novo sem release, mas não é oferecido no select.

**Esforço exposto** (4 + padrão): `low`, `medium`, `high`, `xhigh`. `max` e `ultracode` ficam **fora**: são session-only (nem o `settings.json` do próprio CLI os aceita) e a revisão headless roda desacompanhada com timeout de 30 minutos, o pior lugar possível pra eles. Vale pros CINCO chamadores de `runClaudeStream` (review, autoanálise, pushback, chat, ferramentas); a sessão no TERMINAL nunca é afetada, e o texto da UI promete isso. Verificado contra o CLI real: `--effort` **convive com `--resume`** (o chat não quebra) e nível desconhecido só emite warning, não mata a sessão. Já modelo inválido **mata** a sessão, daí a allowlist ser mais estrita do lado do modelo.

`effortForModel` só derruba o esforço quando o modelo é `haiku`, a única incompatibilidade afirmável pelo alias (o alias diz a FAMÍLIA, não a versão: `opus` pode resolver num 4.6, que não tem `xhigh`). Nos demais, o CLI decide. A UI espelha isso desabilitando os cartões com Haiku escolhido.

**Adiamentos conscientes:** não há override de modelo/esforço **por conta**. `claudeProfileId` tem porque `runClaudeStream` já resolve a assinatura por `opts.account` dentro do `ghEnv`, e o chat passou a passar `opts.account` (conta dona do PR da conversa, correção do gap A3). `tools.js` segue sem passar: um override por conta funcionaria em 4 dos 5 chamadores e seria ignorado em silêncio nas ferramentas, exatamente o anti-padrão de "setting que a UI mostra e o engine descarta". Fazer direito exige costurar `account` no `tools.js`.

## Assinatura do Claude (qual conta/plano o Farol usa, e como alternar)

O Farol roda `claude -p ...` (headless, **sem `--bare`**) e o `claude` interativo no terminal. **Qual assinatura/plano é usado é decisão da autenticação do próprio `claude`, não do config do Farol.** Precedência oficial (docs code.claude.com): cloud provider → `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` → `apiKeyHelper` → `CLAUDE_CODE_OAUTH_TOKEN` → **assinatura OAuth logada via `claude login`** (default). Sem nenhuma env var de auth, usa o OAuth logado, guardado em `.credentials.json` dentro do config dir (`~/.claude.json`/`~/.claude/` por padrão, ou o que `CLAUDE_CONFIG_DIR` apontar).

Como o Farol espalha `process.env` pros filhos, por padrão ele herda o login da máquina. Formas de trocar, da mais simples à recomendada:

1. **Máquina toda:** `claude login` (troca a conta pra tudo, inclusive seu Claude Code interativo de codar). Simples, mas não isola o Farol.
2. **Um diretório de config isolado (o que já existia):** aponte `config.claudeConfigDir` pra um diretório próprio. O engine injeta `CLAUDE_CONFIG_DIR` nesse dir em TODAS as sessões do Farol, então elas usam a assinatura logada ali, sem mexer no `claude` principal da máquina.
3. **Perfis nomeados de assinatura, um por conta GitHub monitorada (recomendado, desde a v2.27.0):** em Sistema > **"Assinatura do Claude"**, o campo único virou um gerenciador de perfis. Cada perfil tem um nome (ex.: "BIUD Trabalho", "Pessoal Max") e um diretório de config próprio. Escolha um perfil como **padrão do Farol** e, se quiser, atribua um perfil diferente a uma conta GitHub específica (Sistema > Contas, override por conta). Sem override, a conta usa o padrão global; sem nenhum perfil criado, vale o `claudeConfigDir` legado como sempre valeu (compatibilidade total).

**Perfil por chave de API (desde a v2.34.0):** cada perfil pode ser "login por assinatura" (o de sempre, `CLAUDE_CONFIG_DIR`) ou "chave de API" (`ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL` opcional, billing por token em vez de assinatura). Os dois convivem no mesmo gerenciador de perfis e são escolhidos por conta GitHub do mesmo jeito. Perfil de chave não tem fluxo de `claude login` (a chave já é a credencial) e cobre tanto as sessões headless quanto a sessão de terminal interativa da fila, a sessão de LOGIN em si (botão "Abrir sessão de login") segue existindo só pro tipo assinatura. URL base é um escape hatch genérico pra qualquer endpoint compatível com a API de Mensagens da Anthropic (proxy próprio, gateway corporativo); não é garantia de funcionar com qualquer provedor (ex.: OpenRouter fala nativamente uma API diferente, OpenAI-style).

   Desde a v2.35.0, cada perfil de chave pode ter um **orçamento**: teto diário e/ou total (contado a partir de uma data de corte editável), configurados no mesmo card do perfil. Estourar qualquer um dos dois pausa toda a automação de revisão (disparo automático de PR novo, retentativa automática pós-falha transitória, e o scan automático de pushback), sem bloquear clique manual nem a autoanálise de Meus PRs (que só roda por clique); libera sozinho quando o gasto volta a caber, sem precisar de nenhum botão de "despausar". **A liberação automática vale pro gate de ENFILEIRAMENTO** (PR novo volta a disparar sozinho, o retry pós-falha volta a repescar, o scan de pushback volta a rodar). **PR que já estava na fila headless e foi barrado na BOCA da sessão é outra história: ele ESTACIONA (`autoReviewParked`) e espera clique** (decisão da spec, G16). O motivo é o teto do estacionamento em si: o que estaciona nunca relança sozinho, e abrir uma exceção só pro caso do orçamento faria a mesma leva reabrir sozinha horas depois, sem ninguém pedindo, exatamente o que o estacionamento existe pra impedir. Na prática, o card volta visível na fila com o botão Revisar ativo, e um clique retoma. O aviso desse estouro sai **uma vez por perfil por janela de bloqueio** (Set `budgetWarned`, o MESMO do gate de enfileiramento, reconciliado no topo do `check()` quando o perfil destrava): um lote de 8 PRs barrados pelo mesmo teto dava 8 toasts idênticos no mesmo segundo. **Correção importante junto desta feature**: sessões que terminam em erro agora também registram consumo no `usage.json` (`lib/engine/usage.js`), porque uma sessão pode gastar tokens de verdade em turnos anteriores e falhar só no passo final; antes disso, esse gasto ficava invisível na aba Consumo (achado real de um incidente de 04/08/2026, ~US$ 11 gastos em sessões que nunca terminaram com sucesso).

**Passo a passo (perfil isolado):**
```
# 1) logar a conta desejada SÓ nesse dir (uma vez; o headless NÃO faz login sozinho)
#    Windows PowerShell:
$env:CLAUDE_CONFIG_DIR="C:\Users\voce\.claude-pessoal"; claude login
# 2) no Farol: Sistema > "Assinatura do Claude" > criar perfil apontando pra C:\Users\voce\.claude-pessoal
# 3) marcar esse perfil como padrão, ou atribuí-lo só a uma conta em Sistema > Contas
```
**Alternar assinaturas** vira trocar de perfil (ou, no modo legado, trocar o caminho): mantenha um dir por assinatura (`.claude-pessoal`, `.claude-trabalho`), um perfil pra cada. Cada conta e cada perfil mostram um selo com a conta em uso (email do `oauthAccount`) e avisam **"SEM LOGIN"** se o dir apontado não tiver `.credentials.json` (você esqueceu o `claude login` nele); o selo se atualiza sozinho ao salvar, sem precisar de "Reverificar" manual. **Pegadinha:** o login é interativo e tem que ser feito ANTES; sessão headless com dir sem credencial falha. **As vars de auth do ambiente da máquina são ignoradas de propósito:** `applyClaudeAuthEnv` (`lib/parse.js`) limpa as QUATRO (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` e `CLAUDE_CONFIG_DIR`) em TODA sessão que o Farol dispara, antes de aplicar o perfil resolvido, justamente pra um perfil de assinatura (dir) ou de chave nunca ser sobrescrito em silêncio por uma var de ambiente perdida no processo (ex.: perfil de shell do usuário, sem relação com o Farol). São quatro e não duas porque as outras duas são a mesma classe de furo: a URL base redireciona o endpoint (mandaria credencial de assinatura pra host de terceiro) e o config dir troca a conta logada. **No posix, limpar o env NÃO basta** (G21): o profile do usuário é sourceado DEPOIS do env montado (o `-l` do `/bin/sh -lc` no headless, o login shell do Terminal.app antes do `.command`), então um `export ANTHROPIC_API_KEY` perdido no `~/.profile` re-injetava a chave por cima do perfil resolvido. Por isso o `unset` das quatro é emitido DENTRO do shell, depois de qualquer sourcing e antes do `exec` do claude, e o perfil resolvido é re-exportado logo em seguida (no Windows não existe esse sourcing, o `cmd.exe` não lê profile nenhum, então lá o env limpo basta). **Limitação conhecida, e é deliberada:** no headless posix com perfil de **chave de API** não há prefixo de propósito nenhum (`claudeAuthPosixPrefix` devolve string vazia), porque re-setar a chave ali a colocaria na linha de comando, visível no `ps` de qualquer processo da máquina; a chave viaja só pelo env, e um profile sujo ainda vence nesse caso específico. Nos scripts de terminal isso não se aplica (a chave já está no arquivo, então o unset sai e a chave é re-exportada depois). Backlog pra fechar de vez: passar a chave por uma var sombra, com o script traduzindo pra `ANTHROPIC_API_KEY` depois do sourcing. **O console de login** (`loginConsoleEnv`, `lib/engine/session.js`) usa o mesmo `applyClaudeAuthEnv` e ainda apaga o `GH_TOKEN` herdado: "sem token de conta" era promessa do comentário e do teste, mas não injetar não impede HERDAR, e o `gh` de lá cai no login do próprio keyring, como tem que ser. Quem quiser billing por API tem que usar o **perfil por chave de API**, documentado no parágrafo acima ("Perfil por chave de API"), que é o jeito suportado hoje; setar a var no ambiente da máquina não tem mais efeito em nenhuma sessão do Farol. **Nunca** logar/gravar credencial pelo Claude Code em nome do usuário: o `claude login` é ação dele.

## Como rodar e testar sem estragar nada

- **Instância isolada**: `FAROL_HOME=/tmp/farol-teste node server.js` sobe engine + UI em `http://127.0.0.1:47170` sem tocar nos dados reais. Pra trocar a porta, escreva `{"port": 47180, "autoReview": false}` no `config.json` do FAROL_HOME antes de subir.
- **Nunca teste com `autoReview` ligado** numa conta real: PR novo na sua fila dispararia revisão headless de verdade (e potencial APPROVE real).
- **Stubs**: `FAROL_REVIEW_CMD` substitui o `claude` da sessão terminal; `FAROL_HEADLESS_CMD` substitui o headless (imprima um envelope `{"result": "..."}` no stdout).
- **Gate de qualidade** (rodar antes de QUALQUER entrega): `npm run check && npm run lint && npm test`. O `lint` é o gate de ratchet do contrato engineering-standards em Node puro (`tools/quality/`): compara as violações com `baseline.json` e reprova qualquer contagem que SUBA. Corrigiu dívida? `npm run lint:update` trava o número mais baixo. A baseline nunca sobe à mão. O `check` valida a sintaxe (`tools/check-syntax.js` roda `node --check` por processo filho em TODO `.js` do projeto, 98 arquivos, ESM nativo desde a migração; `package.json` tem `"type": "module"`); o `test` roda a rede (`node --test`, runner nativo, ZERO dependências): funções puras + smoke de boot com `FAROL_HOME` temporário. Verde em todos é pré-requisito. A rede vive em `test/` e é o que protege a decomposição do engine em ondas (ver `docs/QUALITY.md`, o contrato de qualidade extraído do lace-be-fastify).
- As buscas `gh search prs` são read-only; rodar `check` contra o GitHub real é seguro.

## Menções navegáveis (regra de usabilidade, v2.40.1)

Pedido do Wanderson (11/08/2026): **"se tem menção a uma coisa X ou Y eu deveria
navegar até aquela coisa por clique"**. Toda menção sai de UM helper, nunca
escrita à mão, pra o destino ser o mesmo em toda tela:

| menção | helper (`ui/pure.js`) | destino |
|---|---|---|
| pessoa (`@login`) | `personMention(login, cls, semFoto)` | perfil dela no GitHub, **sempre com foto** |
| repositório (`owner/repo`) | `repoMention(repo, label)` | repo no GitHub |
| PR (`owner/repo#N`) | `prRefMention(ref, cls)` | o PR no GitHub (só o que casa o formato) |
| ferramenta (`Kudos`, `Diagnóstico do Farol`) | `toolRefGoto(ref)` | o painel dela no próprio app |
| ref de sessão (coluna do Consumo) | `sessionRefMention(ref, cls)` | roteia entre os dois de cima |
| célula da coluna do Consumo | `sessionRefCell(ref, cls)` | menção + atalho pra caixa de revisão |
| caixa de revisão | `reviewBoxHtml(d)` + `data-review-key` | modal com veredito, ressalvas e relatório |
| lugar do próprio app | atributo `data-goto` | aba/seção/grupo, com rolagem e destaque |

O ref da coluna "PR / sessão" é POLIMÓRFICO (revisão, pushback e chat gravam a
chave do PR; ferramenta grava o rótulo montado no `tools.js`), por isso ele passa
pelo roteador `sessionRefMention` e não direto pelo `prRefMention`. Ref que
nenhum dos dois reconhece continua texto puro: clique que não leva a nada é pior
que texto, porque promete navegação e não entrega.

`data-goto` (handler ÚNICO delegado no `document`, em `ui/app.js`, junto do
`goTo`/`gotoAba`/`gotoDeliv`): `aba:<nome>`, `aba:<nome>:<seletor>`,
`sys:<secao>`, `sys:<secao>:<seletor>`, `deliv:repo:<owner/repo>`,
`deliv:author:<login>`, `deliv:days:<0|7|15|30>`. O parse do spec é o
`parseGoto` do `ui/pure.js` (o seletor é o RESTO inteiro, nunca o terceiro
pedaço: seletor CSS tem `:`). Tanto em `aba:` quanto em `sys:` a aba troca ANTES
de procurar o alvo (elemento em aba escondida não rola, e falha calado), e alvo
`hidden` (painel de ferramenta sem resultado gerado ainda) não é destacado, a
navegação para na aba certa. Span com `data-goto` leva `role="button"` +
`tabindex="0"`.

**Dois destinos no mesmo lugar = dois elementos** (v2.40.3). A célula da coluna
"PR / sessão" tem o texto (leva ao PR no GitHub) e um botão ao lado (abre a
caixa de revisão AQUI). Nunca empilhe dois destinos no mesmo elemento; e o botão
só existe onde há o que abrir (linha de ferramenta e sessão sem referência não
ganham botão, porque botão que não faz nada é pior que botão nenhum).

**Alcance do histórico, e por que não é só aumentar o payload** (v2.40.3).
`resolveIntoHistory` guarda **3000** decisões em disco (era 200), mas o snapshot
do SSE segue mandando só as **30** mais recentes. Medido em 11/08/2026 no estado
real: cada decisão pesa **5,2 KB com relatório** e **1,1 KB sem**, então mandar
3000 seriam **15 MB por push**, a cada ciclo de polling. O alcance vem da rota
`GET /api/decision?key=` (fachada `Engine.decisionByKey`), que varre o histórico
completo sob demanda. **A rota responde ENVELOPE `{found, decision}`, nunca a
decisão crua e nunca 404**: o `get()` da UI é um `fetch().catch(() => null)`, então
sem envelope "não há revisão desse PR" e "a busca falhou" chegariam idênticos na
tela. É o M18 outra vez, com outra roupa.

**Trava contra destino morto** (`ui-contract.test.js`, v2.40.2): todo `data-goto`
literal é conferido contra o `index.html` (a aba existe? a seção existe? a âncora
`#id` existe?). É a mesma classe do M18 que criou aquele arquivo, e pior de
achar: `querySelector` devolve `null`, o `goTo` volta em silêncio e o clique
simplesmente não faz nada, sem 404, sem erro no console e sem linha no log.

Duas travas no `npm test`: `ui-pure.test.js` varre o fonte atrás de `@${...author}`
escrito à mão (menção de pessoa sem foto/link reprova) e `ui-widgets.test.js`
trava o handler único, o `role/tabindex` e a estrutura do título do Panorama
(o autor fica FORA do elemento que trunca; título comprido já comeu o autor
duas vezes, em Revisões recentes na v2.39.0 e no Panorama na v2.40.0).

Distinção que evita dois destinos pro mesmo texto: dentro de uma LISTA, nome de
pessoa/repo leva ao GitHub; nos CARTÕES DE ESTATÍSTICA ("@X na frente", "repo na
frente", "+N hoje"), que são atalhos da própria tela, o clique leva ao grupo
correspondente na lista abaixo, trocando a visão se preciso.

## Dedup é por ROUND, não por "alguma vez" (v2.40.5)

O gate de postagem tem um dedup pra não postar o mesmo review duas vezes
(incidentes reais: biud-frontend#635 no approve, biud-core#215 no clique). Até a
v2.40.4 ele perguntava a coisa errada:

| pergunta | resultado |
|---|---|
| "eu já pedi mudanças neste PR alguma vez?" (até v2.40.4) | round 2 em diante nunca postava |
| "eu já me manifestei sobre ESTE head?" (v2.40.5) | round anterior não silencia o atual |

O caso que motivou (biud-frontend#742, 11/08/2026): o Farol postou
CHANGES_REQUESTED por um open redirect, o autor empurrou a correção, e as duas
revisões seguintes concluíram que a correção não tinha fechado o buraco (achado
NOVO, sobre o head novo). As duas foram resolvidas como `already_reviewed` e
nada saiu. O achado ficou só no `decisions.json` enquanto o PR seguia com
aprovação de terceiro em cima do head vulnerável.

A âncora é o **`commit_id` do review** (que a API de reviews do GitHub já
devolve, e o `myReviewsWithTime` descartava no `jq`) comparado com o
**`headRefOid`** do PR, agora em `ghMod.headSha`. Não use horário: `submitted_at`
contra data de commit mente em rebase e amend, e `updatedAt` de PR muda com
comentário. Sem sha conhecido (rede, token), degrada pro comportamento antigo em
vez de repostar às cegas: falta de dado não inventa rodada nova.

Vale pros TRÊS pontos de dedup, e quem mexer num tem que mexer nos três:
`review.js` (ramo canAuto e ramo canReject) e `decision.js` (`decide()`, o
caminho do clique). Travado em `test/dedup-round.test.js`, que também trava os
guarda-corpos: mesmo head segue sem repostar.

Regra geral que sai daqui, e que já valia em dois outros eixos (`reconcilePending`
compara horário OU mesmo head com estado decisivo, desde a v2.41.3: review seu
APPROVED/CHANGES_REQUESTED no head que a sessão leu resolve o card mesmo
anterior à pendência, e COMMENTED anterior não resolve nada; `hidden-prs`
guarda `updatedAt` e se desfaz sozinho): decisão
sobre um PR que consulta o passado precisa dizer **de qual estado do PR** está
falando. E o corolário de UI: status que significa "não postei" é o único lugar
onde o achado existe, então ele nunca pode esconder as reasons na linha
(`resolvedRow`, "achados que ficaram só aqui").

## Re-revisão automática pós-push (v2.41.0): o round 2 fecha sozinho

O caso medido que motivou (biud-frontend#756, 15/08/2026): CHANGES_REQUESTED
postado às 00:51, o autor corrigiu às 00:57, e a correção ficou parada 24
minutos até o Wanderson pedir a re-análise à mão. O app era rápido pra abrir o
round e passivo pra fechar. Agora o `check()` chama `launchReReviews()`
imediatamente depois do `refreshStaleStates()` (a ordem IMPORTA: o gate lê o
`staleInfo` que essa função acabou de preencher).

Peças e contratos:

- **`staleForReview` devolve `{ stale, head, lastState }`** (era booleano), da
  MESMA chamada gh de antes: zero IO extra. `refreshStaleStates` preenche DOIS
  mapas do mesmo passe: `staleStates` segue booleano (contrato da UI, o chip
  Re-revisar) e `staleInfo` fica interno, fora do snapshot. Não funda os dois.
- **`reReviewTargets(engine, inflightKeys)`** (`lib/engine/review.js`) é o gate:
  SÍNCRONO e sem IO, como retryTargets/pushbackTargets, porque decide gastar
  sessão Claude. Só arma com prova completa: `stale` true, `head` conhecido e
  `lastState === 'CHANGES_REQUESTED'`. **Aprovação stale NÃO relança** (fica no
  botão, por clique). **Draft NÃO arma round automático** (v2.41.3, G10: WIP
  geraria sessão e, com onReject, um review por push; o chip manual segue
  cobrindo). Pendência na mesa segura (um card por PR). E repete as
  MESMAS travas do toReview: quem mexer lá, mexe aqui.
- **Âncora por head** (`state/rereview-launched.json`, `reReviewLaunched`):
  cada estado do PR relança NO MÁXIMO uma vez, gravada ANTES de enfileirar.
  Falha da revisão cai no retry/estacionamento de sempre; head mais novo reabre,
  e desde a v2.41.3 o REINÍCIO também (G7: `recoverInflight` poda a âncora das
  keys que estavam inflight, senão app morto entre a âncora e a sessão matava o
  round pra sempre naquele head). O relançamento carrega `knownHead` (G8): se o
  fetch do headSha falhar no início da sessão, o head da âncora vale como
  fallback, então a EXCEÇÃO à regra "sem sha degrada pro comportamento antigo" é
  a re-revisão, que sempre tem head provado. A poda (PR fora do panorama) aceita
  o mesmo compromisso do reconcileHiddenPRs: busca parcialmente falha pode
  custar UMA sessão repetida, nunca postagem duplicada (o dedup por head cobre).
- **`requested: true` no relançamento**: round 2 é continuação de um review meu,
  não clique avulso. A POSTAGEM continua atrás de shouldAutoApprove/
  shouldAutoReject (política da conta, card, contestação, cobertura) e do dedup
  por round. O gate do invariante 4 não afrouxou.

Junto na v2.41.0, e relacionados: **rascunhos entram no radar** (caiu o
`.filter(p => !p.isDraft)` do `searchPRs`; `isDraft` viaja no objeto pro selo
"rascunho" em fila/panorama; o `mergeSelfPR` segue recusando draft, revalidado
na hora do clique) e o **paralelismo por conta** documentado no invariante 4.

### Ciclo de vida e higiene (onda 3 dos gaps da auditoria de 15/08/2026)

Quatro estados que existiam só em memória (ou não existiam) e agora têm dono e regra
de poda. Todos seguem o mesmo princípio das outras duas ondas: **falta de dado nunca
vira ação**, e poda errada não pode custar sessão paga.

- **Estacionamento persistido** em `state/auto-review-parked.json` (G15, padrão do
  `pushbackScanned`: load no boot, save a cada mutação; o load é blindado com
  `Array.isArray`, porque `{}` é JSON válido e `new Set({})` derrubaria o boot
  inteiro). Era memória pura, e cada reinício, inclusive o do próprio auto-update,
  relançava sessões fadadas à mesma falha conhecida. **A regra da poda tem duas
  metades, e a segunda foi paga com um bug reaberto:** (1) só se poda a key de um
  owner que RESPONDEU à busca neste ciclo (`ownersOk`, mesmo padrão do G5: busca que
  caiu não prova PR fechado); (2) owner que saiu de TODA a config nunca mais vai
  responder, então ele dispensa o gate (1), **mas nunca a prova de que o PR sumiu do
  panorama**. A primeira versão podava esse caso INCONDICIONALMENTE, e a fila mine
  (`--review-requested=@me`) não filtra por owner: PR de org não monitorada entra na
  fila normalmente, era des-estacionado todo ciclo, relançado, falhava de novo e
  estacionava de novo, um loop pago de 30 em 30 segundos. Quem lança (manual ou auto)
  tira do estacionamento, e a gravação do lote é UMA (fora do laço do `launchReview`).
- **Dedup do `mineMap` por conta capaz** (G18): o mesmo PR chega pelas duas contas
  quando você está nos dois times; a conta capaz de agir (não silenciada e com token)
  vence a incapaz, empate mantém a primeira. Antes, a primeira vencia sempre e o PR
  ficava mudo, preso numa identidade que nunca dispara aviso nem auto-revisão.
- **Guarda `mergeInFlight`** (G19, `lib/engine/selfpr.js`): Set por key, segunda
  chamada devolve `{ ok: false, error: 'merge já em andamento' }` sem tocar no `gh`.
  Vale pros três botões (normal, auto, admin), que passam pela mesma função. Na UI,
  essa recusa sai como toast **info**, não vermelho: nada falhou ali, é a segunda
  metade de um clique duplo, e o merge de verdade seguiu em frente (a cor sai de
  `mergeToastKind`, em `ui/pure.js`, um lugar só pros três handlers).
- **Poda dos `update-dl-*`** (G20): cada tentativa de update criava
  `sessions/update-dl-<ts>` e nada apagava. Toda tentativa começa apagando os que têm
  mais de 24h, best-effort com try/catch por entrada (lixo que não sai hoje sai
  amanhã; falhar o update por causa de um diretório travado seria pior).

## Checkpoint de verificação (memória entre passadas da revisão, v2.36.0)

Motivado por um incidente real (05/08/2026, PR biudtech/internal-auth#43): a sessão de
revisão caiu em `529 Overloaded` no meio da verificação de afirmações factuais de um
documento e, ao retomar, refez do zero exatamente as mesmas checagens que já tinha
concluído minutos antes. Custo pago duas vezes e risco silencioso: nada garantia que a
segunda passada chegasse ao mesmo veredito da primeira (a última simplesmente vencia).

As peças (`lib/engine/verification-checkpoint.js` + costuras em `session.js`,
`review.js`, `decision.js` e `ui/pure.js`):

- **Arquivo por PR**, `state/verification/<encodeURIComponent(key)>.json`,
  **append-only**: entrada nova nunca sobrescreve a anterior; veredito revisado vira
  entrada NOVA e a divergência é detectada, nunca escondida. `encodeURIComponent` porque
  trocar `/`/`#` por `__` colidiria (`a__b/c` vs `a/b__c` dariam o mesmo arquivo).
- **Quem escreve é o ENGINE, nunca a sessão** (regra 2 do prompt: sessão não escreve em
  `state/`). A sessão sinaliza o veredito no campo `description` de um Bash que ela já
  rodaria de qualquer forma (`FAROL_CHECKPOINT: {"claim","file","line","verdict","evidence"}`;
  sem comando real pra rodar, usa `true`), e `session.js` (branch `tool_use` de
  `handleEvent`) intercepta e grava via `appendCheckpointEntry`. Guardas da captura: só
  `Bash.description`; só sessão `mode === 'auto'` (autoanálise NUNCA escreve, é o
  invariante 4); payload tem que ser objeto (array não vira entrada vazia); JSON inválido
  é ignorado sem derrubar a sessão. O engine carimba `sessionId`, `headSha` e `at`
  (horário de Brasília, nunca UTC cru).
- **Leitura**: `runHeadlessReview` lê o arquivo em DOIS pontos com propósitos distintos
  (antes da sessão, pra decidir se injeta o `resumeBlock` de retomada no prompt; depois
  dela, pra montar `result.verificationCheckpoint` via `summarizeCheckpoint`). O disco é
  lido ali, onde a sessão já faz IO; NUNCA em `decision.js`, que continua 100% puro.
- **Gate**: `checkpointGap(result)` (`decision.js`, mesmo padrão do `coverageGap`: função
  pura que só olha o envelope) trava `shouldAutoApprove` (`{ok:false, motivo:'checkpoint'}`)
  E `shouldAutoReject` quando o checkpoint está malformado ou tem divergência entre
  passadas. Mesma régua da cobertura: sem prova consistente não posta sozinho; o clique
  manual nunca é bloqueado. A mensagem cita `arquivo:linha` e a claim; o agrupamento de
  conflito usa a claim NORMALIZADA (trim, espaços colapsados, minúsculas), senão fraseado
  ligeiramente diferente esconderia divergência real.
- **Ciclo de vida por SHA do head**: cada entrada carrega o `headSha` do PR no momento da
  verificação, e `summarizeCheckpoint(entries, shaAtual)` só considera entradas do head
  atual (entrada SEM sha sempre conta: falta de dado nunca descarta). PR que ganha commit
  novo "reseta" o gate na prática, sem apagar nada do histórico. Sem isso, um conflito
  antigo travava approve E reject pra sempre.
- **Retomada**: com checkpoint não-vazio relevante ao head atual, `resumeBlock` é
  concatenado ao prompt mandando ler o arquivo antes de reverificar. Vale igual pro
  retry, porque relançamento passa pelo MESMO `runHeadlessReview` (premissa travada em
  `test/checkpoint-retry-same-path.test.js`).
- **UI**: `resolvedRow` (`ui/pure.js`) mostra "Verificação de afirmações: N confirmadas
  de M" e o selo de divergência em Revisões recentes; o texto do problema também entra em
  `result.reasons`.
- Divergência NUNCA é reconciliada sozinha (decisão humana sempre). Chat, autoanálise e
  pushback não gravam checkpoint (o formato é genérico pra adoção futura, decisão
  consciente). A captura só enxerga `tool_use` da sessão principal, não o que roda DENTRO
  de subagente do fan-out (limitação documentada; o incidente real era do orquestrador).
- Testes: `test/verification-checkpoint.test.js`, `test/session-checkpoint-capture.test.js`,
  `test/checkpoint-gate.test.js`, `test/checkpoint-review-wiring.test.js` e
  `test/checkpoint-retry-same-path.test.js`.

## Diagnóstico: ambiente x operação (v2.40.4)

Os checks de Sistema → Visão geral respondem DUAS perguntas diferentes, e
misturá-las foi o defeito de origem:

| pergunta | de onde vem | exemplos |
|---|---|---|
| o Farol consegue RODAR? | `STATE.doctor` (engine) | gh, conta primária, Claude Code, Git Bash, pasta |
| o Farol vai ACHAR algo? | `operationChecks(STATE.accounts)` (`ui/pure.js`) | conta sem organização, conta sem token, tudo silenciado |

O caso que motivou (Wanderson, 11/08/2026): **conta cadastrada sem nenhum owner
deixava os 5 checks de ambiente verdes e o painel vazio pra sempre, sem erro,
sem log e sem nada na tela**. A causa é o fan-out da busca ser
`accountList().flatMap(acc => acc.owners...)`: sem owner a lista de alvos é
vazia, o `gh` nunca é chamado, e não existe falha pra registrar. Silêncio por
construção, que é o tipo de defeito que faz desconfiar do app inteiro.

Ao acrescentar check novo aqui: **o rótulo tem que nomear a DIMENSÃO**, não a
coisa. "Conta @X" já é o check de autenticação; o de monitoramento é
"Monitoramento de @X". Dois checks com o mesmo rótulo leem como linha
duplicada, mesmo dizendo coisas diferentes (travado em `ui-pure.test.js`).
Config que só o usuário sabe preencher e cujo vazio produz SILÊNCIO (não erro)
é candidata a check; config com default seguro não é.

## Versionamento (regras firmes; houve erro demais aqui)

Pedido explícito do Wanderson (10/08/2026) depois de erros REAIS acumulados:
fonte bumpado sem publicar (v2.28.0 no `package.json` com v2.26.1 instalada, e o
usuário achando que rodava o novo); spec citando uma versão e a release saindo
com outra (a releitura do Consumo foi escrita como "sai como v2.38.0" e
publicada como v2.39.0); e duas sessões paralelas escolhendo o MESMO número, com
a segunda sobrescrevendo a release da primeira em silêncio (o episódio da
v2.31.0/export do pure.js). Estas regras existem pra nenhum desses se repetir:

1. **A referência de sequência é UMA só: a última release PUBLICADA no GitHub.**
   ```
   gh release view --repo wandersonaadsantos/farol --json tagName --jq .tagName
   ```
   Nunca o `package.json` (pode estar bumpado sem publicar), nunca o
   `CHANGELOG.md`, nunca a versão escrita numa spec (spec registra INTENÇÃO; o
   número real se decide na hora de publicar, contra o publicado).
2. **Tabela de decisão do bump** (sobre a última publicada), na doutrina que o
   Wanderson já cobrou em episódios reais, não na do semver de livro:
   | mudança | bump |
   |---|---|
   | correção, refino ou CONSERTO de comportamento que já era esperado, mesmo com UI nova envolvida; refinar/completar uma feature recém-lançada (mesma leva de trabalho); filtro/separação que faltava desde o início | **patch** |
   | CAPACIDADE nova de verdade e independente (algo que o app não fazia em nenhuma forma) | **minor** |
   | quebra de compatibilidade de `config.json`/`state/` que exija migração manual | **major** (raro; o auto-update torna isso quase teórico) |
   Episódios que calibram a régua: "kudos respeita a conta" foi cobrado como
   PATCH (conserto do que devia funcionar desde o início, não feature); o
   redesenho da tela de Consumo logo após o lançamento dela foi cobrado como
   PATCH (2.24.0 foi deletada e republicada como 2.23.1: "não foi feature, era
   fix de uma feature"); e a v2.40.0 (10/08) foi errada NESTA direção de novo,
   era conserto da releitura recém-lançada do Consumo e devia ter sido v2.39.1.
   No sentido oposto: nível do modelo visível + fila transparente era capacidade
   nova e saiu como patch por engano (devia 1.7.0). **Misturou fix e feature na
   mesma leva: separar em duas releases (patch pro fix, minor pra feature); se
   não der, classificar pelo NÚCLEO da entrega, e o núcleo quase sempre é o
   conserto.** Na dúvida entre patch e minor, é patch: superestimar mente sobre
   o que é novo, e é o erro mais frequente do histórico.
3. **Uma release por entrega.** Versões intermediárias não publicadas não
   existem pro mundo: consolidar numa seção só de CHANGELOG e uma entrada só de
   RELEASE_NOTES, com o número final.
4. **O número só é seu DEPOIS de publicado.** Sessões paralelas colidem: conferir
   a última publicada imediatamente antes do bump E de novo colado no publish
   (mesmo comando). Se o número foi tomado no meio do caminho, renumerar TUDO
   (package.json + CHANGELOG + RELEASE_NOTES + spec) e publicar com o número
   novo; jamais sobrescrever a release do outro.
5. **Travas automáticas (não confiar em disciplina):**
   - `test/release-consistency.test.js` (roda no `npm test`): package.json,
     `## vX.Y.Z` do CHANGELOG e `RELEASE_NOTES[0]` do ui/app.js têm que
     concordar, RELEASE_NOTES estritamente decrescente, CHANGELOG sem seção
     acima da versão atual. Bump incompleto = suíte vermelha.
   - `tools/publish-release.ps1`: recusa publicar versão MENOR ou IGUAL à última
     publicada e recusa sobrescrever release existente. Republicar a mesma
     versão de propósito (consertar nota/anexo) exige `FAROL_REPUBLISH=1`.

## Release (checklist obrigatório)

Toda release segue estes passos na ordem. Não pule nenhum.

### 1. Preparar a versão

- [ ] Ler a **última release publicada** (`gh release view --repo wandersonaadsantos/farol --json tagName --jq .tagName`) e decidir o bump pela tabela da seção "Versionamento" acima.
- [ ] Bump de `version` no `package.json`.
- [ ] Atualizar `CHANGELOG.md`: criar seção `## vX.Y.Z` com novidades e correções. Se houver versões intermediárias não publicadas, consolidar tudo numa seção só.
- [ ] Atualizar `RELEASE_NOTES` no `ui/app.js`: adicionar entrada `['X.Y.Z', ['item 1', 'item 2']]` no topo do array. Se consolidou versões, uma entrada só. Verificar que a versão anterior publicada também tem entrada (corrigir se faltar).
- [ ] Os três acima andam JUNTOS: `test/release-consistency.test.js` falha se qualquer um ficar pra trás.

### 2. Gate de qualidade

```
npm run check && npm test
```

Verde nos dois é pré-requisito. Não publique com teste vermelho.

### 3. Commit e push

- [ ] Commit com mensagem descritiva (ex.: `chore: release v2.27.0`).
- [ ] Push pra `main`.
- [ ] **Conta do gh**: o repo é `wandersonaadsantos/farol`, então o push e a release têm que sair pela conta DONA do repo, não pela conta de trabalho (que costuma ser a ativa e devolve 403). Confira com `gh auth status` e, se precisar, `gh auth switch --user wandersonaadsantos`. **Confira de novo IMEDIATAMENTE antes de rodar o `publish-release.ps1`, num comando só com ele:** a conta ativa do `gh` mora no keyring e já foi observada revertendo entre um comando e o outro na mesma sessão. Em 01/08/2026 isso derrubou a publicação da v2.29.0 no meio: o push passou, os dois artefatos foram construídos, e só o `gh release create` falhou (o erro que aparece é um `gh auth refresh ... -s workflow`, que engana, porque o problema é a conta e não o escopo). Rodar de novo com a conta certa resolve, e o script é idempotente. **Não escreva o login da conta de trabalho neste arquivo**: o `CLAUDE.md` vai dentro do zip de distribuição e a auditoria do `make-package.ps1` reprova o pacote se achar (invariante 7).

### 4. Publicar a release

```
powershell -ExecutionPolicy Bypass -File tools\publish-release.ps1
```

O script faz tudo: builda o pacote leve (`dist/farol-vX.Y.Z.zip`, auditado) + instalador Windows (`dist/Farol-Setup-vX.Y.Z.exe`, NSIS), extrai notas do `CHANGELOG.md`, anexa rodapé de `tools/release-footer.md` e cria a release `vX.Y.Z` no GitHub. Se a release já existe, atualiza notas e sobrescreve os artefatos.

### 5. Pós-publicação

- [ ] Verificar a release no GitHub (notas, artefatos).
- [ ] **Restaurar a conta ativa do gh pra de trabalho** (`gh auth switch`), pra não deixar a máquina apontada pra conta pessoal no dia a dia.
- [ ] macOS (quando aplicável): `bash tools/make-offline-mac.sh` e anexar com `gh release upload vX.Y.Z dist/Farol-Instalar-mac.command --repo wandersonaadsantos/farol`.

### Referência rápida

| Artefato | Comando | Destino |
|---|---|---|
| Pacote leve (update) | `tools\make-package.ps1` | `dist/farol-vX.Y.Z.zip` |
| Instalador Windows | `tools\make-installer.ps1` | `dist/Farol-Setup-vX.Y.Z.exe` |
| Release GitHub | `tools\publish-release.ps1` | ambos acima + release |
| Instalador macOS | `tools/make-offline-mac.sh` | `dist/Farol-Instalar-mac.command` |

**Auto-update**: cópias instaladas (>= 1.15.0) leem a última release via `gh` e se atualizam sozinhas no próximo ciclo. Bootstrap: cópias antigas precisam instalar 1.15.0 uma vez (offline).

**Fonte de verdade**: a release do GitHub. O app instalado atualiza só a partir das releases, nunca de código local não mergeado (a menos que `config.updateSource` aponte um caminho explícito).

**Distribuição offline**: o instalador Windows (`.exe`, NSIS) e o macOS (`.command`, autoextraível) não precisam de Node/npm/terminal. Nenhum dos dois é assinado/notarizado (SmartScreen/Gatekeeper avisam uma vez).
