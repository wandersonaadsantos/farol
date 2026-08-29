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
| `lib/engine/skip-review.js` | **UM Farol por PR** (v2.50.1; regras reformadas em 28/08/2026, ver "As duas decisões de 28/08" na seção própria). Ver o SINAL de outra pessoa (a label `<conta>:revisando`, que é o sinal escrito; ou ref de transição da v2.53.9) faz o Farol SAIR DE CENA naquele head, de forma DURÁVEL, SEMPRE (regra plana: caiu a exceção de CODEOWNERS da v2.51.0). `revisandoPorOutros` (labels) e `revisandoPorSinais` (refs de transição) são PURAS, `outrosRevisando` é a UNIÃO das duas e segue SÍNCRONA e sem IO (contrato do reReviewTargets), `saiDeCena` ancora por head e avisa por TOAST (desde 28/08/2026 nada é postado no PR), `standDownCaducou` é a rede de segurança (sessão do colega morreu sem review = volta a revisar), `coAssinar` é o opt-in que aprova em seu nome quando quem pegou aprovou, e `autoridadeNaSaida` responde só se EU sou autoridade (gateia a co-assinatura; falta de dado cai em true, o lado seguro). **Gate de consciência** (28/08/2026 à tarde; calibrado na v2.54.1): `bloqueadoPorHistorico` (reprovação de gente no head ativo, ou 2 aprovações humanas, seguram o automático; 1 aprovação não, a automática vale como a segunda) com boca única `bloqueiaAutomatico` (clique manual atravessa sem gh) + `avisaBloqueioHistorico`/`podarHistoricoAvisado` (toast único por PR+head). **`acrity` nunca conta como pessoa** (review de ferramenta não dispensa olho humano). Vale só no caminho AUTOMÁTICO: clique manual sempre revisa |
| `lib/engine/review-signal.js` | **LEITURA DE TRANSIÇÃO das refs da v2.53.9** (28/08/2026). Por algumas horas a v2.53.9 escreveu o sinal de revisão em andamento como ref git `refs/farol/revisando/<pr>/<login>/<epoch-ms>`; a v2.54.0 devolveu a escrita pra label `<conta>:revisando` (decisão da tarde: label visível é desejada) e este módulo ficou só LENDO e coletando as refs até a frota convergir (remover no futuro). `refreshReviewSignals` roda no `check()` (uma chamada `matching-refs` com `--paginate` por repo de interesse por ciclo) e alimenta `engine.reviewSignals`; TTL de 1h dos DOIS lados do relógio (`TEMPOS.SINAL_REVISAO_TTL_MS`); GC apaga só ref órfã do passado; falha preserva o snapshot anterior. Também abriga `repoDoPr`/`numeroDoPr` |
| `lib/engine/codeowners.js` | **Quem é AUTORIDADE sobre cada arquivo do PR** (v2.51.0). Tudo PURO: `parseCodeowners`, `patternToRegex` (estilo gitignore), `ownersForPath` (a ÚLTIMA regra que casa vence, semântica do GitHub, NÃO acumula), `souAutoridade` e `cobreMinhaExigencia` (só saio de cena se quem pegou o PR é dono de TODO arquivo em que eu sou). Dono que é TIME (`@org/slug`) é inconclusivo e cai sempre no lado seguro |
| `lib/engine/fanout.js` | Fan-out de revisão em PR grande: mede o PR (`prMetrics`), decide se fatia (`shouldFanOut`), monta os lotes por afinidade de caminho (`planLotes`, função PURA) e injeta o instrutivo (`fanOutBlock`). Determinístico, ZERO IA e zero rede na parte que decide |
| `lib/engine/model-router.js` | **Roteador de modelo por custo-benefício** (quando `reviewModel === 'auto'`). PURA: escolhe haiku/sonnet (+ esforço/fast) pelas métricas do PR. `auto` nunca entra na cmdline do CLI |
| `lib/engine/session.js` | Sessões do Claude: headless (`runClaudeStream`, `buildModelFlags`), terminal por SO (`buildSessionScript`/`Mac`), cancelamento (`killTree`). É aqui que o marcador `FAROL_CHECKPOINT` é interceptado (ver a seção "Checkpoint de verificação") |
| `lib/engine/verification-checkpoint.js` | Checkpoint de verificação da revisão headless: memória append-only por PR do que já foi confirmado contra o código (`checkpointPath`, `appendCheckpointEntry`, `readCheckpoint`, `summarizeCheckpoint`, `resumeBlock`). Só o ENGINE escreve, nunca a sessão; detalhe na seção "Checkpoint de verificação" |
| `lib/engine/selfpr.js` | "Meus PRs": autoanálise (nunca posta), `setReviewers` e `mergeSelfPR` (as duas ÚNICAS escritas no GitHub partindo daqui, com os gates travados em `test/merge-gates.test.js`) e o **ocultar PR** (`hidePR`/`unhidePR`/`reconcileHiddenPRs`, estado em `state/hidden-prs.json`, travado em `test/hidden-prs.test.js`). Ocultar é 100% local e **temporário por natureza**: guarda o `updatedAt` do PR e o `check()` desoculta sozinho quando esse carimbo muda (atividade nova). O engine NÃO filtra `myPRs` (quem esconde é a UI, que também mostra os ocultos), e a limpeza de chave órfã é POR CONTA desde a v2.41.2 (`reconcileHiddenPRs(okAccounts)`): só limpa chave cuja conta dona respondeu à busca de PRs meus neste ciclo, senão a queda de UMA conta desocultaria (e apagaria autoanálise) das outras. Não confunda com `clearSelfAnalysis`, que apaga só a AUTOANÁLISE |
| `lib/engine/pushback.js` | Memória de contestação: quem entra no scan (`pushbackTargets`), detecção e classificação |
| `lib/engine/gh-queries.js` | As buscas no GitHub (`searchPRs`, `myAuthoredPRs`, entregas) e os créditos do Sistema > Sobre (`refreshContributors`: contribuidores do repo do update, cache 24h, backoff de falha 1h) |
| `lib/engine/chat.js` | Chat por PR (`--resume` da sessão), com o preâmbulo que proíbe postar sem pedido explícito |
| `lib/engine/tools.js` | Ferramentas internas (kudos, diagnóstico), com escopo por conta |
| `lib/engine/update.js` | Auto-update: comparação de versão, download da release e aplicação por SO |
| `lib/engine/usage.js` | Agregação do consumo (por dia, tipo, conta e modelo) + log permanente por sessão (`usage-sessions.json`, sem poda, com o campo `ref`). **FONTE ÚNICA da aba Consumo (v2.40.0)**: `usageSummary` entrega série diária, séries empilhadas e matriz JÁ RECONCILIADAS contra `days` (a fatia de um dia sem detalhamento vira a camada `_resto`, "Sem detalhamento"; invariante travado em teste: soma das camadas == série do dia), o orçamento por perfil (`budgets`, mesma conta do gate real, refeita a cada push; o doctor NÃO carrega mais gasto/bloqueio), `sessionsSince` e `retentionDays`. A UI só fatia janela e formata; não crie definição de dado (janela, métrica, teto) do lado de lá |
| `lib/engine/jira.js` | **O único arquivo do recurso de Jira que COMPÕE os outros** (v2.52.0). `siteForPr` (resolve org do GitHub -> site, sem tocar rede nem credencial), `cardForPr` (lê o card, com cache), `cardBlock` (o bloco delimitado que entra no prompt), `mcpArgsFor` (o `--mcp-config` + `--strict-mcp-config` da sessão) e `mcpConfigPath`. Os módulos de `lib/jira/` são FOLHAS e não se importam entre si: quem junta site, credencial, cache, cliente e normalização é aqui, e só aqui |
| **`lib/jira/`** | **Folhas do recurso de Jira, puras ou de IO simples** |
| `lib/jira/sites.js` | Modelo do site (`parseJiraSites`, `siteForOwner`, `maskJiraSites`): allowlist de id, validação de origem e a máscara que impede o segredo de chegar na tela |
| `lib/jira/credentials.js` | Credencial por site em `~/.farol/jira-credentials.json`, FORA do `config.json` (que trafega inteiro pra UI), com permissão restrita em TODA gravação |
| `lib/jira/client.js` | Cliente REST do Jira em Node puro, API **v2** (a v3 devolve descrição em ADF e exigiria um interpretador), timeout próprio e corpo provado |
| `lib/jira/card.js` | `normalizeIssue`/`issueValida`: whitelist de saída (título, status, critérios, escopo, fora de escopo) e prova de forma. Card só é card se tiver a forma esperada; `fields` array não é card |
| `lib/jira/cache.js` | Cache de card por site, fora do workspace da sessão. Namespace é id **E** host (a tela deixa corrigir o `baseUrl` mantendo o id, e sem o host o Farol serviria por até uma hora o card do tenant ANTERIOR) |
| `lib/jira/errors.js` | Taxonomia com três donos de falha (do Farol, do Jira, do usuário). Os códigos `desligado` e `sem_chave` são SILENCIOSOS por decisão, ver a seção do Jira |
| `tools/jira-mcp.js` | **O servidor MCP local do Farol** (v2.52.0). Expõe `getJiraIssue` e `searchJiraIssuesUsingJql` já apontados pro site certo. Recebe SÓ o `siteId` por argumento e lê a credencial do disco por conta própria: o `state/spawns.log` registra a linha de comando inteira, então segredo ali seria segredo em texto puro pra sempre |
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
4. **Nada é postado no GitHub sem gate.** **Duas escritas vieram do "um Farol por PR" (v2.49.0/v2.50.1), e a que sobrou é a mais séria de todo o invariante.** (a) O **COMENTÁRIO de pulo** (`gh pr comment`) MORREU em 28/08/2026 (v2.53.9): era template fixo, a mesma frase saindo de contas diferentes minutos depois do sinal alheio subir, e denunciava a automação. A saída de cena continua durável (âncora `state/skip-comentado.json`, que agora nasce da DECISÃO, não mais de um comentário que saiu) e o aviso é toast no app; NADA é postado no PR. Hoje a única escrita fora do caminho de review é a seguinte. (b) A **CO-ASSINATURA** (`coAssinarReview`, opt-in, default false): um APPROVE postado em seu nome SEM sessão, SEM envelope e SEM passar por `shouldAutoApprove`, com base na aprovação de quem pegou o PR. É o único caminho em que o Farol aprova sem ter revisado, e por isso os gates são explícitos no próprio `coAssinar` em vez de herdados: chave ligada, aprovação comprovada NO HEAD ATUAL de alguém por quem eu saí de cena, e dedup por head (`myReviewStates` null = não posta, porque postar review não é idempotente). Nunca ligue por padrão: quem liga assume que endossa revisão alheia sem saber o rigor nem o modelo que a produziu. Os dois passam pelas travas de identidade do resto (conta sem token não posta). O texto segue o `reviewFormatBlock`: sem citar automação/Farol/fila, sem travessão, e sem pronome de gênero pra quem o app não tem como saber. Auto-approve exige `requested === true` (revisão pedida a mim; revisão iniciada por clique no panorama nunca auto-posta), veredito `approve` e payload `APPROVE`. Com `autoApproveAll: true` (OPT-IN, ligado em Sistema) TODO PR aprovável é aprovado sozinho, sem depender do humano. **O corpo do APPROVE vai LIMPO no PR (tem que parecer humano, ver "review humano" abaixo), nunca com carimbo de "automático". A ressalva TÉCNICA sobre o código entra no corpo, escrita como um revisor sênior mencionaria de passagem (desde a v2.26.1, ver o parágrafo "Ressalva vai pro PR" abaixo); a ressalva OPERACIONAL do nosso fluxo (`result.reasons` que sejam de processo + aviso se `cardMet === false`) fica SÓ no app, no campo `attention`, visível em Revisões recentes.** O DEFAULT é `false` (gate estrito de sempre: só auto-aprova quando a sessão decidiu `decision === 'auto_approve'` E `cardMet === true`), por segurança, já que o app é público/multiusuário e cada um liga se quiser. A decisão fica isolada em `shouldAutoApprove(pr, result)` (devolve `{ ok, motivo }`; o `motivo` alimenta a transparência do runHeadlessReview, que só atribui a recusa à política da conta quando o motivo é `politica`); a composição dos pontos em `attentionPoints`. **Cada conta pode sobrescrever esses padrões globais** (painel Contas): `autoReview` (revisa sozinho / só põe na fila / herda), `onClean` (PR aprovável sem ressalva: `approve`/`wait`) e `onCaveats` (aprovável com ressalva: `approve`/`wait`). O engine resolve por conta em `autoReviewFor(user)` (gate da revisão automática, por `pr.account`) e `approvePolicyFor(user, clean)` (usado por `shouldAutoApprove`; `clean` = sem pontos de atenção e `decision === 'auto_approve'`). Campo ausente na conta = herda o global. `acctPolicy(user)` acha a conta. **Discordância com review de terceiro** (`contested` com prova) segura o auto-approve por default, porque aprovar por cima de outro revisor é tomar posição pública; desde a v2.47.0 isso é escolha e não decreto: `autoApproveContested` (global, opt-in em Sistema > Automação, resolvido em `contestedPolicy()` e lido só por `shouldAutoApprove`) tira a trava, e aí a discordância segue como ponto de atenção comum, o que joga a decisão pra `approvePolicyFor` com `clean === false` (PR com contestação nunca é limpo). Consequência desejada: ligar essa chave sozinha jamais aprova o que `onCaveats: wait` já mandava esperar. Vale SÓ pro approve, `shouldAutoReject` continua barrando contestação sem opção (reprovar por cima de outro revisor é mais grave, não menos). O `runHeadlessReview` só prepend a linha "confira a redação antes de postar" quando o gate de fato barrou (`autoDec.motivo === 'contestacao'`); com a chave ligada essa linha sumiria mentindo, e o ponto já é publicado por `attentionPoints` com rótulo e prova. **Reprovar sozinho** é OPT-IN por conta (`onReject: 'request_changes'`, default `wait`, sem global): quando a revisão pede mudanças (`verdict === 'request_changes'` + payload REQUEST_CHANGES) num review PEDIDO a mim (clique nunca posta) e a conta optou, o app posta o REQUEST_CHANGES com os bloqueios (corpo LIMPO, sem carimbo de automático), dedup por `myReviewStates` (não re-pede se eu já pedi **para o head atual**, ver "Dedup é por round" abaixo). Gate isolado em `shouldAutoReject(pr, result)`/`rejectPolicyFor(user)`; nunca reprova sozinho por default. **A auto-revisão (headless) vale pra TODA a fila elegível da conta com `autoReview` ligado, não só os PRs que acabaram de chegar** (`check()` filtra `this.queue`, não só `fresh`): ligar "revisa na hora" passa a valer pro que já estava esperando. PRs que falharam sem ser rede, ou que você cancelou, ficam em `autoReviewParked` (aguardam ação manual, não relançam sozinhos); lançar de novo (manual) tira do estacionamento. **A revisão headless roda até `config.parallelReviews` POR CONTA em paralelo** (default 1 = serial dentro da conta, o comportamento de sempre; contas diferentes revisam juntas desde sempre; opt-in em Sistema > Automação, 1..4, sanitizado por `sanitizeParallelReviews` no boot/updateSettings E clampado de novo em `parallelLimit` no escalonador, defesa em profundidade): `processHeadless` é um escalonador que puxa da `headlessQueue` revisões até o teto da conta, contando em `headlessBusyAccounts` (**Map conta -> contagem** desde a v2.41.0; era Set); `runOneHeadless(pr, acct)` roda cada uma e devolve o slot via `freeHeadlessSlot` (zera com delete, nunca set 0: o isBusy do update.js pergunta `.size`) + reprograma no fim. `headlessAcct(pr)` = conta dona (por `accountForPr`). **Perfil de review por pessoa** (`config.people` = {login: {papel?, dominios?{backend|frontend|dados|infra: nivel}}}, marcado à mão: papel no card do PR e na aba Time, matriz por domínio só na aba Time) molda o TOM e a POSTURA da revisão automática, NUNCA a decisão. `personProfileBlock(login)` injeta no prompt headless (`headlessPromptFor(url, author)`): PAPEL (estagio/junior/pleno/senior/techlead/arquiteto/especialista) dá o tom-base, a MATRIZ (basico/intermediario/avancado/autoridade por domínio) calibra a postura conforme a área que o PR mexe (autoridade→defere; básico→explica mais). A instrução trava: só TOM/POSTURA, nunca verdict/decision/cardMet/gate. Sem perfil = bloco vazio (neutro). Só no caminho headless, não no terminal. Migração: o `config.seniority` plano antigo vira `papel` (`migrateSeniorityToPeople` no load). `parsePeople` valida/normaliza. **Review humano/personalizado:** `reviewFormatBlock()` (injetado SEMPRE junto do perfil, PREVALECE sobre o formato do CLAUDE.md do workspace) manda escrever o corpo postado como uma PESSOA (o Wanderson), personalizado/objetivo/profissional: SEM caixas de alerta `> [!NOTE]`, SEM "Placar", SEM checklist `- [x]`, SEM prefixos de Conventional Comments no texto, SEM citar automação/Farol/"auto-aprovei" (o autor não pode saber que é bot), sem travessão, e o FORMATO adapta à senioridade (estágio/júnior = prosa de mentor; pleno/sênior/arquiteto = enxuto e direto). O protocolo de review (`CLAUDE.md`, `prompts/pr-review-auto.md`, `prompts/self-review.md`, `.claude/agents/pr-reviewer.md`) é RE-SINCRONIZADO da fonte a cada boot (`prepareHome`), pra mudanças de formato chegarem nas cópias já semeadas (nunca toca em `state/`). **Memória de pushback (automática):** quando o autor contesta um review meu, o Farol detecta e classifica sozinho. `scanPushbacks()` roda no `check()` (fire-and-forget, guarda `pushbackScanning`, best-effort): só entra no scan o PR cujo review MEU foi **bloqueio** (`request_changes`) ou **aprovação COM ressalva** (aprovação limpa não gera pushback; `reviewActions()` expõe `caveats` = mesmos pontos do `attentionPoints`, card não comprovado ou motivo listado, pra distinguir). Nesses, gatilho barato via gh (`detectAuthorPushback` = atividade do autor DEPOIS do meu último review; marcador em `state/pushback-scanned.json` evita reprocessar; `updatedAt` do PR é o gate) e, só nos candidatos novos, `classifyPushback` (1 sessão Claude LEITURA pura, nunca posta, `MAX_PER_CYCLE=2`) devolve `{isPushback, outcome, confidence, note}`. Confiança ALTA vira registro `confirmed` sozinho; BAIXA vira `pending` (aparece como "confirmar?" no controle de Revisões recentes, com o desfecho sugerido, você resolve num toque). Registros em `state/pushbacks.json` carregam `source`('auto'|'manual')/`status`('confirmed'|'pending')/`confidence`. `recordPushback` (marcação/correção à mão) é sempre `manual`+`confirmed` (override). `pushbacksFor` (injeção no `personProfileBlock`) usa SÓ confirmados, pra não calibrar em cima de palpite. Mesma trava: só tom/postura, nunca a decisão. Migração: registros antigos sem `source` viram manual+confirmed. **A autoanálise em si (Meus PRs) NUNCA posta nem escreve em `state/`** (é diagnóstico do autor sobre o próprio PR): o caminho `runSelfAnalysis` não passa pelo gate de postagem, o prompt `self-review.md` proíbe qualquer `gh`/`git` de escrita, e o resultado fica só em `self-analyses.json`. **As escritas no GitHub partindo de Meus PRs são só duas, ambas por clique explícito: o botão "Reviewers" e o botão Merge.** O botão **"👥 Reviewers"** (`setReviewers`) atribui o autor e pede review da lista efetiva do repo, resolvida por `reviewersForRepo(repo)`: a EXCEÇÃO do repo (`config.projectReviewers[repo]`) se houver, senão o PADRÃO da org (`config.defaultReviewers[org]`). Assim funciona em qualquer repo da org que tenha padrão, mesmo sem config própria. Aceita pessoas e times `org/slug`, sem confirmação (aplica na hora); não posta review nem mergeia, só ajusta assignee/reviewers, e filtra o próprio autor da lista. O botão **Merge** (`mergeSelfPR`), acionado por clique explícito com confirmação, e gateado: só o autor mergeia o próprio PR (`author === ghUser`), só quando a autoanálise marcou `approvable === true`, só em repo fora de `config.mergeBlockedRepos` (default `biudtech/biud-frontend`), e nunca em rascunho/PR com conflito. Faz merge commit (`gh pr merge --merge`, sem squash/rebase), atribui o autor se preciso, e deleta a branch de origem **só se for descartável** (`isPermanentBranch` protege develop/release*/main/master/hml*/staging/etc., que jamais são deletadas). Quando o merge normal esbarra na proteção de branch (`blocked: 'policy'`), a UI oferece duas saídas: **auto-merge** (`--auto`, mergeia quando os requisitos passarem, sem burlar nada) e **merge como admin** (`--admin`, bypassa a proteção agora, só se você for admin, com confirmação reforçada). Os dois modos passam pelos mesmos gates (autor/aprovável/lista bloqueada), então nem admin mergeia repo bloqueado como `biud-frontend`. **O botão só fica disponível quando dá pra mergear de verdade**: o engine lê a mergeabilidade real de cada PR aprovável (`refreshMergeStates` no fim do `check()` e após cada autoanálise aprovável, guardada em `mergeStates`) via `gh pr view --json mergeable,mergeStateStatus`. CLEAN/UNSTABLE = botão Merge ativo; BLOCKED = mostra auto/admin direto (sem tentativa que falha); DIRTY/BEHIND/DRAFT = botão desabilitado com o motivo. O Auto-merge só é oferecido quando o repo tem `allow_auto_merge` ligado (`fetchAutoMergeAllowed`); senão o botão fica desabilitado e sobra o Merge (admin). Se ainda assim o `gh` recusar o `--auto` (`enablePullRequestAutoMerge`), o merge devolve `blocked:'autoUnavailable'` com mensagem acionável, e a condição é logada como WARN (não ERROR), já que não é bug do Farol.
   **Postagem que falhou por instabilidade tenta de novo sozinha (v2.48.0).** O gate acima decide SE pode postar; esta parte cuida de quando ele já disse que sim e só o POST morreu. Achado no `biud-frontend#774` (17/08/2026): a revisão decidiu `approve`, `shouldAutoApprove` devolveu `ok:true`, e o `gh` respondeu 503 num `major_outage` do GitHub. A falha entrava como mais uma string em `result.reasons` e o item caía pra `pending`, ou seja, uma pendência puramente mecânica esperando clique humano pra sempre, com a decisão e o payload já prontos em disco. Agora `runHeadlessReview` marca `result.postRetry = { event, attempts: 0 }` quando (e SÓ quando) `classify(post.error).kind === 'transitorio'` (mesma tabela de `lib/log-taxonomy.js`, invariante 3: uma fonte só pro que é transitório; a classe `github-indisponivel` nasceu deste incidente). `retryFailedPosts(engine)` roda no `check()` **depois** do `reconcilePending` (pra nunca reenviar em cima de pendência já atendida por fora) e reenvia o payload GRAVADO, sem reabrir sessão nem gastar token. **A trava que mantém isso seguro é o dedup por head** (`myReviewStates`, o mesmo do caminho normal): postar review não é idempotente, então se a 1ª tentativa tinha ido pro ar e só a resposta se perdeu, o retry vira no-op e a pendência resolve sem duplicar review no PR. Teto de `MAX_POST_RETRY_ATTEMPTS` (3), cada ciclo de polling servindo de backoff natural (180s-3600s); esgotado, marca `exhausted` e a pendência volta a ser sua, sem mais tentativa. Falha PERMANENTE (credencial recusada, payload inválido, bloqueio de `internal_language`) nunca entra no sweep: insistir não resolveria e esconderia de você o único problema que exige ação humana. O gate do invariante 4 NÃO afrouxou: só entra no sweep item que o gate já tinha liberado, e `postRetry: null` (a maioria: gate barrou por regra ou conteúdo) jamais é tocado.

   **Motivo tem EIXO, não é lista plana (v2.48.0).** Cada entrada de `reasons`/`attention` é `{ text, kind }` com `kind` em `gate` | `content` | `infra`. Antes era string solta e os três se confundiam na tela: no print do #774 apareciam "7 motivos de ter vindo pra você" misturando 6 achados da revisão com 1 erro 503, o que fazia o gate parecer quebrado quando o que houve foi a rede cair. `gate` = regra deliberada do app (cobertura incompleta, discordância com outro review, política da conta, revisão por clique); `content` = o que a revisão apontou sobre o código; `infra` = a postagem em si falhou. Quem etiqueta é quem cria o motivo (`runHeadlessReview` e `attentionPoints`), uma vez só. **Retrocompatível por construção**: entrada antiga do `decisions.json` (string pura, sem etiqueta) é lida como `content`, a leitura conservadora, nunca inventando um gate ou uma falha de infra que não houve. `uniqueHumanTexts` preserva o par (dedup segue pelo texto normalizado) e `decisionForUi` projeta `postRetry` com allowlist (só `attempts`/`exhausted`: `lastError` é stderr do `gh` e não vai pra tela). A UI agrupa em `reasonGroups`/`reasonGroupsHtml` (`ui/pure.js`), na ordem infra → gate → content.

   **Fronteira do review humano (v2.40.7).** `reportMarkdown`, `reasons`, `attention`, memória, cobertura e gate são diagnóstico interno persistido; `reviewMarkdown`, `payloads.*.body` e cada `comments[].body` são texto de review. `postReview` normaliza o schema e roda `publicReviewLanguageIssues` antes de credencial, arquivo temporário ou `gh`; o fallback de inline é validado de novo. Qualquer vazamento de processo, origem da revisão ou template robótico falha fechado nos fluxos mediados pelo app. O protocolo de terminal e chat manda usar `/api/review/post` com capability efêmera limitada às keys e à conta da sessão, e o writer comum aplica o mesmo gate. Essas sessões ainda recebem uma credencial GitHub para investigar PRs privados, então a capability evita bypass acidental, mas não é uma fronteira contra um processo deliberadamente malicioso que ignore o protocolo e use a credencial diretamente. A UI recebe `decisionForUi`, uma allowlist com o review humanizado e diagnósticos reescritos, nunca o relatório bruto nem os payloads. O protocolo sincronizado inclui também `.claude/commands/pr-review.md`.

   **Ressalva vai pro PR (mudança de 29/07/2026, decisão do Wanderson; valia o contrário até a v2.26.0).** Aprovável COM ressalva **aprova** (ressalva nunca bloqueia) e a ressalva **aparece no corpo do PR**, escrita como um revisor sênior mencionaria de passagem, sem checklist e sem seção rotulada. **Filtro obrigatório** (em `reviewFormatBlock`): ressalva TÉCNICA sobre o código entra no corpo; ressalva OPERACIONAL do nosso fluxo NÃO entra e fica só em `reasons`/`attention` (card não confirmado por falha de acesso ao Jira, review que não era pedido a mim, discordância com outro review, política de conta, cobertura incompleta), porque é assunto interno e citar vazaria a automação.

   **Cobertura da leitura é gate (v2.26.0).** Motivo medido em 29/07/2026 sobre 44 reviews reais: o tamanho do PR varia 4359x no histórico e o esforço visível do review varia 3x; a correlação entre linhas do diff e âncoras `arquivo:linha` é **r = -0,08**, ou seja, nenhuma. Nos PRs acima de 2000 linhas, 3 de 5 saíram sem uma única âncora, e o #688 (74 arquivos, 8717 linhas) auto-aprovou com relatório de tamanho médio, zero âncora e zero achado. Conclusão: "nenhum achado" era indistinguível de "li 20% e não vi nada". Agora o envelope carrega `coverage: {total, reviewed[], missing[]}` e `coverageGap(result)` segura a postagem automática (approve E reject) quando falta arquivo, mandando pra decisão humana com a lista. **Dois eixos separados, não confunda:** ressalva é o que a revisão ENCONTROU (não bloqueia), cobertura é o que ela conseguiu LER (bloqueia a postagem sozinha, porque sem leitura completa não há prova). A rede de segurança também pega `reviewed.length < total` mesmo com `missing` vazio. Envelope sem `coverage` (passe único) devolve `[]` e nada muda.

   **Fan-out em PR grande (v2.26.0).** Acima de **1000 linhas OU 20 arquivos** (limiar medido: pega 28% dos PRs do histórico, 7 de 25), o engine mede o PR com uma chamada `gh pr view --json additions,deletions,changedFiles,files`, monta 2 a 4 **lotes** por afinidade de caminho (`planLotes`) e injeta o instrutivo. A sessão principal então dispara **um subagente `pr-reviewer` por lote, em paralelo** (ela já disparava um; agora dispara N), cada um lendo por completo só os arquivos do seu lote e **ciente dos caminhos dos outros lotes** (pra sinalizar dependência cross-lote sem afirmar defeito em arquivo que não leu). A consolidação é na própria sessão: dedup por `arquivo:linha`, resolução das suspeitas cross-lote e **o gate dos 8 blockers aplicado UMA vez** sobre o conjunto (a decisão continua num lugar só). Falha na medição degrada pro passe único de sempre, que é sempre seguro. **`planLotes` DESCE por profundidade de caminho, nunca sobe pro pai:** a 1ª versão fundia o menor grupo no diretório pai e a validação com o #688 real reprovou (cascateava até a raiz e um lote ficava com 53 dos 74 arquivos, recriando o problema). Fundir os dois menores entre si mantém o equilíbrio. **Aritmética conhecida:** com teto de 4 lotes, um PR de 8717 linhas ainda dá ~2200 linhas por lote; subir o teto custa quase nada em tokens (o total de linhas lidas é o mesmo, muda só o overhead por subagente), então se a cauda de PRs gigantes incomodar, o caminho é `MAX_LOTES`.
   **ATENÇÃO, e é a parte mais importante deste parágrafo: até a v2.27.0 nada disso rodou.** A fachada `Engine.headlessPromptFor` declarava `(url, author)` enquanto a implementação em `lib/engine/review.js` recebe `(engine, url, author, lotes, metrics)` e o chamador em `runHeadlessReview` passava os quatro. Os dois últimos eram engolidos pela fachada, chegavam `undefined`, e `fanOutBlock` nunca era concatenado: o Farol media o PR, montava os lotes e **jogava o plano fora**, seguindo no passe único. Todo o módulo `fanout.js` e a bateria de testes dele estavam verdes porque testavam as funções puras, não o caminho até o prompt. Corrigido na **v2.28.0**, com os dois lados travados em teste: o comportamento (o bloco chega no prompt) segue em `test/review-prompt.test.js`, e a **aridade das fachadas** MUDOU DE CASA na onda 3. Hoje ela vive em `test/facades.test.js`, que **deriva do fonte** em vez de manter tabela curada: faz parse do `server.js` como texto, casa cada fachada de uma linha e compara o `Function.length` dela com o da implementação, descontando o slot do `engine`. Fachada nova passa a ser coberta sozinha, sem ninguém precisar cadastrar. Os dois casos que o cálculo não alcança (parâmetro desestruturado com default, que zera o `Function.length`, e a fachada que liga `this.usage` como segundo argumento) estão no mapa `EXCECOES` daquele arquivo, e o teste reprova se um deles sumir. Consequência prática de ter corrigido: PR grande passou a custar bem mais tokens, porque agora ele é de fato lido inteiro. Fachada nova que carregue argumento de comportamento entra naquela tabela.

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

**O suporte a macOS foi escrito no Windows.** Em 17/08/2026 o checklist inteiro (itens 1 a 8) foi finalmente rodado num Mac real (Apple Silicon, Darwin 25.6, Node 24, pós-ESM), e os itens 3 a 7, que estavam pendentes desde sempre, saíram do papel. **Três bugs REAIS apareceram nessa rodada, dois deles graves e nenhum visível em teste** (ver os itens riscados e o bloco "Rodada de validação de 17/08/2026" no fim da seção). O que segue pendente está marcado como tal; o resto é memória do que já foi provado em campo.

1. ~~**Instalar**~~ **VALIDADO (28/07/2026, Mac real, Apple Silicon, via `Farol-Instalar-mac.command` v2.23.4)**: `~/.farol/app`, `~/.farol/workspace` e `~/Applications/Farol.app` criados certinhos, symlinks do Electron preservados, sem atributo de quarentena no `.app` (só `com.apple.provenance`, que não bloqueia). PEGADINHA: o app vai pra `~/Applications` (por usuário, sem pedir admin), que NÃO é a `/Applications` da barra lateral do Finder, então o usuário "não acha o app". Um symlink resolve (`ln -s ~/Applications/Farol.app /Applications/Farol.app`, funciona sem sudo pra quem é admin); avaliar fazer o `install.sh` criar esse symlink quando tiver permissão. Pra instalar do zip leve: `bash Instalar.command` (o zip gerado no Windows não preserva bit de execução, então a primeira vez é com `bash`, não duplo clique).
2. ~~**Abrir**~~ **VALIDADO E CORRIGIDO (28/07/2026)**, com DOIS bugs reais achados num Mac de verdade:
   - **Launcher morria em silêncio via Finder/Spotlight**: o wrapper dava `exec` no `node_modules/.bin/electron`, que é script node (`#!/usr/bin/env node`); Finder/Spotlight lançam com PATH mínimo (sem node) e o wrapper morria com `env: node: No such file or directory`, sem janela e sem log. PEGADINHA DE VALIDAÇÃO: `open` rodado de um shell PROPAGA o env do chamador (PATH com node), então "funciona no terminal" NÃO valida o clique do usuário; valide com `env -i HOME="$HOME" PATH=/usr/bin:/bin:/usr/sbin:/sbin ~/Applications/Farol.app/Contents/MacOS/Farol`. Corrigido no `install.sh`: o launcher agora dá `exec` direto no binário NATIVO (`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`), zero dependência de node no PATH.
   - **Janela subia atrás de tudo e sem foco**: o app que o Finder ativa (wrapper) morre no `exec`, e o Electron subia sem ativação. Corrigido no `main.js` com `app.focus({ steal: true })` no `createWindow` e no `showWindow` (só `IS_MAC`).
   - ~~**Confusão de identidade no menu/Dock**~~ **CORRIGIDA (27/08/2026, sem empacotamento completo)**: como o launcher ainda executa o binário nativo do Electron, o processo podia herdar "Electron" como nome visível no macOS. O `main.js` agora chama `app.setName('Farol')` logo no boot e o `install.sh` ajusta `CFBundleName`, `CFBundleDisplayName` e `CFBundleIdentifier` do `Electron.app` preservado em `node_modules`. Ainda precisa de validação em Mac real depois do update, porque Windows não prova barra de menu/Cmd-Tab. Se não abrir mesmo, rode o launcher à mão pra ver o erro: `~/Applications/Farol.app/Contents/MacOS/Farol`.
3. ~~**Doctor**~~ **VALIDADO (17/08/2026, Mac real, pós-ESM)**: gh 2.86.0, claude 2.1.228, `ghAuth` e `claudeAuth` verdes, `gitBash: null` (correto no mac). Validado na condição que importa, que é a do Finder: app aberto com `env -i ... PATH=/usr/bin:/bin:/usr/sbin:/sbin`, e o `prependPathDirs` do boot achou o `gh` em `/opt/homebrew/bin` e o `claude` em `~/.local/bin`. Doctor verde com o PATH do SEU shell não vale como validação, porque o shell já carrega o profile.
4. ~~**Polling**~~ **VALIDADO (17/08/2026)**: 17 PRs reais no Panorama e 9 em Meus PRs, de uma org de verdade, no primeiro ciclo. `farol.log` sem nenhum erro de busca.
5. ~~**Revisão headless: spawn, feed e cancelamento**~~ **VALIDADO (17/08/2026)**, com uma metade PENDENTE (ver abaixo). Com `autoReview` desligado, o clique no Panorama enfileirou e disparou a sessão; a árvore de processos mostrou o desenho pretendido: `/bin/sh -lc unset ANTHROPIC_API_KEY ... ` como líder **em grupo próprio** (o `detached: true` funciona) e filho, neto e netos-de-`sleep` todos no MESMO pgid. O `/api/cancel` derrubou o **grupo inteiro** (o neto, que é o que denuncia kill só no líder, morreu junto): o `killTree` posix está provado end-to-end, não só no teste unitário. De quebra, o prefixo de `unset` do G21 apareceu na linha de shell REAL. **PENDENTE**: a revisão de ponta a ponta com sessão Claude de verdade (relatório, veredito, card em "Precisa de você") não rodou, porque o `claude` desta máquina está com a assinatura expirada (`Failed to authenticate: OAuth session expired`); `claude login` é ação do dono da máquina, não do Claude Code. A mecânica acima foi validada com o stub `FAROL_HEADLESS_CMD`, que é o caminho documentado em "Como rodar e testar sem estragar nada".
6. ~~**Sessão no terminal**~~ **VALIDADO (17/08/2026)**: o Terminal.app abriu, o `.command` saiu com modo `0700` e com tudo que as auditorias anteriores prometiam (porta com fallback em vez de `:undefined`, `unset` das quatro vars de auth antes do sourcing, `gh auth token --user` com aborto quando a conta não tem token). Ao encerrar a sessão, o trap EXIT chamou `/api/session-exit`, o **pill sumiu** e o script **se apagou sozinho**; nenhum WARN de saída != 0. Validado com o stub `FAROL_REVIEW_CMD` (mesma razão do item 5: a assinatura do Claude desta máquina está expirada), o que exercita o script inteiro, que é justamente a parte específica do macOS. O contrato original segue valendo: se o pill ficar preso, o trap não rodou. **O trap que não roda deixa uma entrada FANTASMA em `activeReviews`, e essa entrada gateia DUAS coisas, não só o pill:** (a) o **busy do update** (`sessionsBusy` em `lib/engine/update.js`, G14: sessão de terminal viva barra o installer, que mataria a janela no meio) e (b) a **isenção de TTL da capability de postagem** (`terminalOwnerAlive` em `lib/engine/decision.js`, G17: enquanto a sessão dona vive, a cap vive junto). Nos dois, a entrada fantasma valeria pra sempre, então nos dois vale o MESMO teto de **12h** desde esta release (`TERMINAL_SESSION_MAX_MS`, exportada por `decision.js` e importada pelo `update.js`, fonte única: dois números divergentes fariam a mesma janela morta ser fantasma num lugar e viva no outro). Acima de 12h a entrada deixa de contar: o update volta a aplicar e a cap expira pelo TTL de sempre. Sessão sem `startedAt` confiável continua contando como viva nos dois lados (falha fechado: sem idade provada não dá pra afirmar fantasma, e matar sessão viva é pior). **A saída definitiva pro fantasma continua sendo reiniciar o app**, que zera o `activeReviews` (é memória, nunca persiste); o teto de 12h é rede de segurança pra quem deixa o Farol aberto por dias, não conserto do trap.
7. ~~**Update**~~ **VALIDADO E CORRIGIDO (17/08/2026), depois de achar DOIS bugs que tornavam o auto-update do macOS impossível.** O ciclo "fecha, atualiza e reabre" foi observado funcionando pela primeira vez: app fechou em ~2s, reabriu em ~4s com **pid novo**, versão em memória subiu de 2.46.0 pra 2.47.0 e o Electron ficou intacto. Os dois bugs estão detalhados no bloco "Rodada de validação de 17/08/2026" no fim da seção; em uma linha cada: **(a)** o `install.sh` apagava o `node_modules` e morria no `cp`, porque o pacote de update não traz `node_modules` de propósito, deixando `~/.farol/app` sem Electron (o app nunca mais abria); **(b)** o `pkill` do installer NUNCA alcança o Farol nesse caminho, porque o `pkill` do macOS exclui os ANCESTRAIS de quem chama e o installer é descendente do app, então o update aplicava os arquivos e o app seguia rodando o código velho. O contrato de antes segue: log em `~/.farol/workspace/state/update.log`. **BUG REAL ACHADO NUM MAC (30/07/2026, Thiago, v2.26.0) E CORRIGIDO NA v2.26.1**: o auto-update NUNCA funcionou no macOS. O `Compress-Archive` do Windows PowerShell grava as entradas do zip com `\` separando as pastas, e o formato zip exige `/` (APPNOTE 4.4.17.1); o `unzip` do Mac avisava `appears to use backslashes as path separators` e saía com código 1, que o `update.js` tratava como falha fatal ("falha ao extrair (unzip)"). Todos os `farol-v*.zip` publicados até a v2.26.0 têm o defeito (verificado nos históricos). Duas correções: (a) `make-package.ps1` monta as entradas na mão via `ZipFileExtensions::CreateEntryFromFile` com o nome normalizado, e a auditoria REPROVA o pacote se aparecer `\` ou raiz absoluta (PEGADINHA do fix: `$env:TEMP` volta em caminho curto `WANDER~1`, então a raiz e o enumerador têm que sair do MESMO caminho resolvido, senão a subtração de prefixo erra por um caractere e todas as entradas de raiz saem como `/arquivo`); (b) `update.js` passa a aceitar saída 1 do Info-ZIP (aviso, não erro), deixando a checagem do `installer/install.sh` ser o gate de verdade. ~~FALTA validar num Mac real~~ **VALIDADO em 17/08/2026 contra o artefato PUBLICADO**: o `farol-v2.47.0.zip` baixado da release tem 67 entradas, **zero** com `\` e zero com raiz absoluta, e o `unzip` deste Mac extraiu com código **0** e stderr vazio. A correção da v2.26.1 se sustenta no que está no ar.
8. ~~**Ícone**~~ **VALIDADO E COMPLETADO (28/07/2026)**: `bash tools/make-icns.sh` gerou o `.icns` num Mac real (transparência dos 4 cantos validada programaticamente, inclusive no 1024px extraído do `.icns`) e `bash installer/install.sh` levou ele pro lançador. DOIS avisos: (a) o `.icns` no wrapper só cobre Finder/Spotlight/Launchpad; o ícone do DOCK em runtime é o do processo (Electron cru), então o `main.js` passou a chamar `app.dock.setIcon` com `assets/png/farol-256.png` no boot (só `IS_MAC`); (b) reinstalar da FONTE exige o dist do Electron darwin em `node_modules/electron/dist` do repo (o `install.sh` copia o `node_modules` inteiro; sem o dist ele cai no `npm install` de rede ou quebra). Se a instalação atual funciona, semeie antes: `cp -R ~/.farol/app/node_modules/electron/dist <repo>/node_modules/electron/dist` (e o `path.txt` junto). Depois de trocar ícone, refresque o cache: `lsregister -f` no bundle + `killall Dock`.

Pendências conhecidas do port (decisões conscientes, não bugs):

- **Autostart não existe no macOS** (login item com Electron + args não é confiável). Se for implementar, o caminho é um LaunchAgent em `~/Library/LaunchAgents`.
- **`.command` aberto por duplo clique pode pedir permissão** na primeira vez (Gatekeeper em arquivos baixados). `bash Instalar.command` contorna.
- **Notificações**: `displayBalloon` é Windows; no macOS o `Notification` do Electron cobre, mas a primeira notificação pede permissão do sistema.

**O que a v2.28.0 NÃO resolveu do macOS, pra não dar impressão errada:** ela unificou a fonte de verdade da plataforma na UI e acrescentou `test/session-posix.test.js` (trava `/bin/sh -lc` + `detached: true`, a pré-condição do `killTree` posix), mas esse teste **pula no Windows**. Esses testes posix rodaram de verdade pela primeira vez em 17/08/2026 e passaram; os itens 3 a 7 saíram de pendentes na mesma data.

**Auditoria cross-platform de 16/08/2026 (4 frentes: engine, apresentação, instalação, testes), corrigida sem Mac real:** porta sem fallback nos dois `notify()` dos `.command` (URL virava `:undefined` e o pill ficava preso pra sempre); conta pedida sem token agora ABORTA a sessão de terminal do mac como o `ghEnv` do Windows (antes caía calado na conta ativa do keyring, o cenário A1); `buildLoginScriptMac` ganhou o `unset GH_TOKEN` + pagers que só existiam no `loginConsoleEnv` do Windows; `logSpawn` nos três spawns do mac; script de login com `0o700` (era `0o755` com chave de API em claro); comparação de caminho case-insensitive só no Windows (APFS pode ser case-sensitive); `install.sh` não exige mais Node no modo offline (derrubava instalador E auto-update em Mac sem Node; a versão sai por `sed`) e valida o binário NATIVO do Electron (o que o lançador executa), não o `.bin`; `install.ps1` virou `/MIR` (arquivo deletado na fonte agora morre no destino) e leva `installer/`+`Desinstalar.cmd` pro app instalado; auditoria do pacote passou a varrer `*.sh`/`*.command`; `applyUpdateMac` tem montador puro testado (`buildUpdateScriptMac`, apóstrofo escapado) como o M14 do Windows; `killTree` posix tem teste com processo real (skip no Windows); PATH do boot virou `prependPathDirs` pura testada; `sid` do `--resume` do chat passa por allowlist de formato antes de entrar na linha de shell. Sobra pro Mac real: o checklist 3-7 acima continua pendente de validação de campo.

**Migração ESM de 16/08/2026 (v2.45.1) exige REVALIDAR o boot no Mac, mesmo o que já estava riscado:** o repo inteiro virou ES modules (`"type": "module"`, main.js e server.js incluídos), então o caminho de carga do Electron e do `node server.js` mudou de plataforma. No Windows a suíte inteira passou (1138 testes) e o main.js carregou até a trava de instância única; num Mac real, nada disso rodou ainda. Ao pegar as pendências num Mac, a ordem é: (0) `npm run check && npm run lint && npm test` (a suíte tem testes posix REAIS que pulam no Windows: killTree de grupo, quoting em bash; aqui eles rodam de verdade pela primeira vez pós-ESM); (1) reabrir o app pelo Finder (item 2 do checklist, que estava validado ANTES do ESM: o launcher dá exec no binário nativo do Electron, e o Electron >= 28 suporta main ESM, mas ninguém provou neste app); (2) seguir os itens 3-7 abaixo na ordem. Qualquer erro de `ERR_MODULE_NOT_FOUND`/import no boot é regressão da migração ESM: o mapa de decisões da fase está no histórico do git (commits `0e7cf1f`..`74b42ac`). **Feito em 17/08/2026, e o resultado está no bloco "Rodada de validação de 17/08/2026" no fim desta seção**: nenhum `ERR_MODULE_NOT_FOUND`, mas DUAS regressões de ESM que não se manifestam como erro de import (a guarda de execução direta sob symlink e o isolamento de `FAROL_HOME` nos testes) e dois bugs de update que impediam o macOS de se atualizar. A lição pra próxima migração desse tipo: em ESM o perigo não é o import que explode, é o **import que é hasteado** e a **string que deixou de ser objeto**, porque os dois falham em silêncio.

### Rodada de validação de 17/08/2026 (Mac real, pós-ESM): o que quebrou e o que mudou

Primeira vez que os itens 3 a 7 rodaram num Mac. **A migração ESM não deixou nenhum
`ERR_MODULE_NOT_FOUND`**: `server.js` e `main.js` carregam limpos, o app abre pelo
lançador com PATH mínimo e a suíte inteira passa. Mas a rodada achou **três defeitos
reais que nenhum teste pegava**, e os três têm a mesma assinatura: *sucesso aparente,
falha silenciosa*.

**1. Auto-update do macOS destruía a instalação (grave; `installer/install.sh`).** O
`install.sh` fazia `rm -rf "$APP/node_modules"` seguido de `cp -R "$SRC/node_modules"`
**sem guarda**. O pacote leve de update NÃO traz `node_modules` de propósito ("O
Electron NÃO viaja no update: a cópia instalada já tem, o installer preserva", em
`update.js`), então rodar o installer a partir dele apagava o Electron e morria no `cp`
por causa do `set -euo pipefail`, deixando `~/.farol/app` sem como abrir. Reproduzido
com o zip publicado da v2.47.0. O `install.ps1` do Windows sempre honrou o contrato (só
copia `node_modules` quando a FONTE tem Electron) e o `install-linux.sh` tem `|| true`;
**o mac era o único sem guarda**. Gravidade: desde a v2.46.0 o `autoUpdate` é LIGADO por
padrão e `maybeAutoUpdate` aplica sozinho quando o app está ocioso, então toda instalação
de macOS se quebraria sozinha na primeira release seguinte, sem clique nenhum. Corrigido
copiando só quando `[ -d "$SRC/node_modules" ]`, e travado por `test/installer-update-mac.test.js`,
que roda o `install.sh` DE VERDADE com `HOME` falso (o script ancora tudo em `$HOME`, e é
assim que se testa sem tocar a instalação real) e com um `pkill` neutro em
`$HOME/.local/bin`, que o próprio script prependa no PATH: sem esse cuidado o
`pkill -f '\.farol/app'` do installer mataria o Farol da máquina de quem roda a suíte.

**2. O update aplicava e o app nunca reiniciava (`lib/engine/update.js`).** Mesmo com o
item 1 corrigido, o ciclo não fechava: os arquivos novos chegavam ao disco e o app seguia
rodando o código VELHO, com o toast prometendo "vai fechar e reabrir sozinho". A causa é
regra documentada do macOS, não acidente: `man pkill` diz que "the current pgrep or pkill
process and all of its **ANCESTORS** are excluded" por padrão. O script de update é
spawnado PELO app, logo o installer é descendente dele, e o `pkill -f '\.farol/app'`
matava só os processos auxiliares do Electron, nunca o principal; o `open` seguinte então
só focava a janela já aberta. Medido em campo: `pgrep` de dentro do installer devolvia os
helpers e omitia o pid principal, e o mesmo `pgrep` do meu shell o encontrava. `kill` por
PID **não** tem essa regra (verificado no mesmo Mac), então `buildUpdateScriptMac` passou
a receber o `process.pid` e a fechar o app por PID, esperando a saída antes de rodar o
installer. Sem pid conhecido degrada pro comportamento antigo em vez de chutar alvo. O
ramo Linux NÃO foi tocado: o `pgrep` do procps não exclui ancestral, então lá o
`install-linux.sh` continua fechando o app como sempre; o builder do Linux ignora o
argumento a mais de propósito.

**3. Guarda de execução direta quebrava sob symlink (regressão pura de ESM).** Em
CommonJS a guarda era `require.main === module`, que compara OBJETOS de módulo, chaveados
pelo caminho REAL. A tradução da migração comparava
`import.meta.url === pathToFileURL(process.argv[1]).href`, e os dois lados não vêm da
mesma fonte: `import.meta.url` já vem resolvido por realpath, `argv[1]` é o que o usuário
digitou. Com caminho ABSOLUTO passando por symlink a guarda dava falso e
`node /caminho/com/symlink/server.js` carregava tudo, não subia nada e saía **0**, em
silêncio. No macOS isso não é hipótese: `/tmp` e `/var/folders` SÃO symlinks, e o próprio
CLAUDE.md manda usar `FAROL_HOME=/tmp/farol-teste node server.js`. Valia também pros dois
gates de qualidade, onde é pior, porque um gate que sai 0 sem checar nada passa por verde.
Caminho RELATIVO escapava por acaso (o `pathToFileURL` resolve contra o cwd, e o `getcwd`
já devolve o caminho canônico), e é por isso que o `npm run lint` nunca denunciou. A
guarda virou `executadoDireto` em `lib/paths.js` (fonte única, resolve realpath dos dois
lados) e é usada por `server.js`, `tools/quality/gate.js` e `tools/quality/higiene.js`.
`test/execucao-direta.test.js` trava o comportamento E proíbe a volta da comparação crua
nos três arquivos.

**Bônus, e é a lição de método: `npm test` estava escrevendo no `~/.farol` REAL.** O
`test/spawnlog.test.js` fixava `process.env.FAROL_HOME` num diretório temporário e logo
abaixo fazia `import { Engine } from '../server.js'` **estático**. Import estático é
hasteado acima do corpo do módulo, então o `paths.js` resolvia HOME antes da env existir:
o teste semeava o workspace de verdade, escrevia `spawns.log` lá, reescrevia o
`~/.claude.json` da máquina (o boot da Engine chama `ensureWorkspaceTrusted`) e o
`after()` apagava um temporário que nunca foi usado. Passava verde. Corrigido pra
`await import()`, que é avaliado no ponto onde aparece, e travado por
`test/test-isolation.test.js`, que reprova qualquer teste que fixe `FAROL_HOME` e importe
estaticamente um módulo do repo que alcance o `paths.js` (varredura do grafo de imports, e
não lista de nomes, pra não envelhecer). Os outros 57 arquivos de teste estavam corretos:
a migração usou `await import()` justamente por isso, e o `spawnlog` foi o único que
escapou.

**Ainda pendente, e por quê:**

- **Revisão headless de ponta a ponta com sessão Claude real** (item 5, segunda metade): a
  assinatura do `claude` desta máquina está expirada (`OAuth session expired and could not
  be refreshed`). `claude login` é ação do dono da máquina; o CLAUDE.md proíbe o Claude
  Code logar em nome do usuário. Falta ver relatório, veredito e o card em "Precisa de
  você" saídos de uma sessão de verdade.
- **Update pelo canal REMOTO ponta a ponta**: validado pelo canal local apontando pro
  pacote real extraído, que exercita o MESMO `applyUpdateMac`/`install.sh`. O remoto puro
  só fecha quando existir release publicada com as correções.
  **Onde cada correção mora, porque isso muda quem se salva e quando** (`applyUpdateInner`
  faz `engine.update.source = dir`, a pasta EXTRAÍDA, e o `applyUpdateMac` monta o caminho
  do installer a partir dela):
  - a correção **1 viaja no PACOTE BAIXADO**, então ela vale já na primeira release que a
    carregar. O corolário é que **o risco é publicar release SEM ela**: aí toda instalação
    de macOS existente se quebra no auto-update, que é ligado por padrão desde a v2.46.0.
  - a correção **2 mora na CÓPIA INSTALADA** (é o `update.js` de quem está rodando que
    monta o script), então o primeiro salto a partir de uma v2.47.0 instalada ainda NÃO vai
    reiniciar sozinho: os arquivos atualizam, o app segue no código velho e o usuário
    precisa reabrir na mão UMA vez. Do salto seguinte em diante é automático.
- **Achados de auditoria fora do checklist, não corrigidos** (levantados na mesma rodada,
  confirmados sob refutação, deixados registrados em vez de resolvidos no meio do
  caminho): o stub autoextraível do `tools/make-offline-mac.sh` tem `set -e` que mata o
  script antes da pausa de leitura e do cleanup (falha de instalação offline fecha a
  janela sem dizer por quê e deixa ~200 MB de payload pra trás) e faz `cd` antes de reabrir
  `$0`, o que quebra invocação por caminho relativo; rodar `bash ~/.farol/app/installer/install.sh`
  (o installer que o próprio projeto copia pra dentro do app) tem `SRC == APP` e destrói a
  instalação; `buildUpdateScriptMac` ignora o exit status do installer, então update que
  falha não gera toast, log nem diálogo; e no Linux o `install-linux.sh` também apaga o
  `node_modules` antes de saber se tem com que substituir, só que degrada pro `npm install`
  em vez de quebrar.
- Segue valendo o de sempre: **autostart** não existe no macOS, o **nome no Dock** é
  "Electron", e o `.app` vai pra `~/Applications`, não pra `/Applications`.

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

**Modelos expostos** (7): `''` (padrão), `auto`, `best`, `opus`, `sonnet`, `haiku`, `fable`. Os 5 aliases de família foram testados contra o CLI 2.1.220 e todos respondem. **`auto` é do Farol, não do CLI:** `lib/engine/model-router.js` escolhe haiku (PR pequeno) ou sonnet (médio/grande) pelas métricas do diff antes do spawn; `sanitizeClaudeModel('auto')` devolve `''` pra nunca mandar `--model auto` (o CLI mataria a sessão). **Fora de propósito:** `opusplan` (o `claude -p` não tem plan mode, a sessão inteira cairia pra Sonnet sob rótulo de Opus), `default` (indistinguível de `''`, já que o Farol nunca seta `ANTHROPIC_MODEL`) e `opus[1m]`/`sonnet[1m]` (colchete é **glob pro `/bin/sh`**: rodando com cwd no WORKSPACE, `opus[1m]` casaria com um arquivo `opus1` e viraria outro argumento, calado; sem match o sh deixa passar, então "funciona quase sempre", que é pior). Se um dia quiser as variantes `[1m]`, o caminho é aspa simples no lado POSIX e valor cru no Windows, decidido dentro do próprio montador, com teste de execução real em `sh`. Nome completo (`claude-opus-5`) é aceito pelo engine via `MODEL_FULL_RE`, como escotilha pra modelo novo sem release, mas não é oferecido no select.

**Esforço exposto** (4 + padrão): `low`, `medium`, `high`, `xhigh`. `max` e `ultracode` ficam **fora**: são session-only (nem o `settings.json` do próprio CLI os aceita) e a revisão headless roda desacompanhada com timeout de 30 minutos, o pior lugar possível pra eles. Vale pros CINCO chamadores de `runClaudeStream` (review, autoanálise, pushback, chat, ferramentas); a sessão no TERMINAL nunca é afetada, e o texto da UI promete isso. Verificado contra o CLI real: `--effort` **convive com `--resume`** (o chat não quebra) e nível desconhecido só emite warning, não mata a sessão. Já modelo inválido **mata** a sessão, daí a allowlist ser mais estrita do lado do modelo.

`effortForModel` só derruba o esforço quando o modelo é `haiku`, a única incompatibilidade afirmável pelo alias (o alias diz a FAMÍLIA, não a versão: `opus` pode resolver num 4.6, que não tem `xhigh`). Nos demais, o CLI decide. A UI espelha isso desabilitando os cartões com Haiku escolhido.

**Adiamentos conscientes:** não há override de modelo/esforço **por conta**. `claudeProfileId` tem porque `runClaudeStream` já resolve a assinatura por `opts.account` dentro do `ghEnv`, e o chat passou a passar `opts.account` (conta dona do PR da conversa, correção do gap A3). `tools.js` segue sem passar: um override por conta funcionaria em 4 dos 5 chamadores e seria ignorado em silêncio nas ferramentas, exatamente o anti-padrão de "setting que a UI mostra e o engine descarta". Fazer direito exige costurar `account` no `tools.js`.

## Assinatura do Claude (qual conta/plano o Farol usa, e como alternar)

O Farol roda `claude -p ...` (headless, **sem `--bare`**) e o `claude` interativo no terminal. **Qual assinatura/plano é usado é decisão da autenticação do próprio `claude`, não do config do Farol.** Precedência oficial (docs code.claude.com): cloud provider → `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` → `apiKeyHelper` → `CLAUDE_CODE_OAUTH_TOKEN` → **assinatura OAuth logada via `claude login`** (default). Sem nenhuma env var de auth, usa o OAuth logado, guardado em `.credentials.json` dentro do config dir (`~/.claude.json`/`~/.claude/` por padrão, ou o que `CLAUDE_CONFIG_DIR` apontar).

Como o Farol espalha `process.env` pros filhos, por padrão ele herda o login da máquina. Formas de trocar, da mais simples à recomendada:

1. **Máquina toda:** `claude login` (troca a conta pra tudo, inclusive seu Claude Code interativo de codar). Simples, mas não isola o Farol.
2. **Um diretório de config isolado (o que já existia):** aponte `config.claudeConfigDir` pra um diretório próprio. O engine injeta `CLAUDE_CONFIG_DIR` nesse dir em TODAS as sessões do Farol, então elas usam a assinatura logada ali, sem mexer no `claude` principal da máquina.
3. **Perfis nomeados de assinatura, um por conta GitHub monitorada (recomendado, desde a v2.27.0):** em Sistema > **"Assinatura do Claude"**, o campo único virou um gerenciador de perfis. Cada perfil tem um nome (ex.: "BIUD Trabalho", "Pessoal Max") e um diretório de config próprio. Escolha um perfil como **padrão do Farol** e, se quiser, atribua um perfil diferente a uma conta GitHub específica (Sistema > Contas, override por conta). Sem override, a conta usa o padrão global; sem nenhum perfil criado, vale o `claudeConfigDir` legado como sempre valeu (compatibilidade total).

**Perfil por chave de API (desde a v2.34.0):** cada perfil pode ser "login por assinatura" (o de sempre, `CLAUDE_CONFIG_DIR`) ou "chave de API" (`ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL` opcional, billing por token em vez de assinatura). Os dois convivem no mesmo gerenciador de perfis e são escolhidos por conta GitHub do mesmo jeito. Perfil de chave não tem fluxo de `claude login` (a chave já é a credencial) e cobre tanto as sessões headless quanto a sessão de terminal interativa da fila, a sessão de LOGIN em si (botão "Abrir sessão de login") segue existindo só pro tipo assinatura. URL base é um escape hatch genérico pra qualquer endpoint compatível com a API de Mensagens da Anthropic (proxy próprio, gateway corporativo).

**Perfil OpenRouter (kind `openrouter`):** usa o Claude Code apontado pro [Anthropic Skin](https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration) em `https://openrouter.ai/api` (sem `/v1`). Auth: `ANTHROPIC_AUTH_TOKEN` = chave `sk-or-...`, `ANTHROPIC_API_KEY` = string **vazia** (não unset: o CLI exige o vazio explícito pra não autenticar na Anthropic direto), `ANTHROPIC_BASE_URL` = o Skin. Sem fluxo de `claude login`. O modo **Auto (custo-benefício)** do Farol (`reviewModel: auto`) continua sendo o roteador local por tamanho de PR; não é o `openrouter/auto` da OpenRouter (que otimiza adequação à tarefa, não custo). Modelos não-Anthropic pelo Skin não são garantia do Claude Code.

   **Desde a v2.49.0 o orçamento vale pros DOIS tipos de perfil, e o gate passou a PROJETAR.**
   Antes o teto era privilégio de quem usa chave de API, por três travas empilhadas: o
   `session.js` descartava o id de perfil de assinatura ao registrar consumo (então
   `byProfileDay` ficava vazio e `profileSpend` devolvia zero pra sempre), o
   `profileBudgetStatus` recusava `kind !== 'apikey'`, e o `normalizeClaudeProfiles`
   descartava os campos de teto no shape dir. As três caíram. Num perfil de assinatura o
   teto **não fala de fatura** (token de assinatura não vira cobrança), fala de RITMO. O
   gasto por perfil de assinatura só conta a partir desta versão: o consumo anterior foi
   gravado sem dono e não dá pra atribuir depois. A **projeção** é a segunda metade:
   `custoTipicoDeReview` (PURA) diz quanto custa uma revisão típica, e o gate pergunta se a
   PRÓXIMA cabe, não se a anterior coube. É MEDIANA e não média porque a cauda é longa
   (medido em 20/08/2026 sobre 144 revisões: média US$ 5,68, mediana US$ 4,11, máximo US$
   29,04); a média deixaria a estimativa refém de dois PRs gigantes do mês. O motivo do
   bloqueio distingue `diario`/`total` (já estourou) de `diario-previsto`/`total-previsto`
   (não estourou, mas a próxima não cabe), porque a ação de quem lê é diferente. Sem
   histórico, `tipico` é 0 e a projeção fica desligada, que é exatamente o comportamento
   anterior (falta de dado nunca vira ação). A razão de decidir na PORTA e não no meio:
   sessão de revisão não é interrompível sem perder o que já foi pago, então "se a revisão
   vai estourar o limite, assume que vai estourar" (Wanderson, 20/08/2026) e a que COMEÇOU
   sempre termina.

   **Desde a v2.50.0 o teto do dia tem TRÊS granularidades, resolvidas num lugar só.**
   `dailyCapFor(profile, day)` (PURA, `lib/engine/usage.js`) é a peça central e vale
   igual pros dois tipos de perfil, cada um independente: data única
   (`budgetDates['YYYY-MM-DD']`) vence dia da semana (`budgetByWeekday['0'..'6']`), que
   vence o teto base (`budgetDaily`). `dailyCapSource` diz de ONDE veio o teto que vale
   hoje, e a UI precisa disso: sem ele, um sábado com teto próprio mostraria o número do
   campo base no medidor e pareceria defeito. **`0` é um teto VÁLIDO** ("não gaste nada
   neste dia") e por isso todo teste de presença usa `Number.isFinite`, nunca `||` nem
   truthy; campo vazio na UI APAGA a chave em vez de gravar 0. O dia da semana sai de
   **meio-dia local** (`new Date(day + 'T12:00:00')`): com meia-noite, a virada de
   horário de verão jogaria a data pro dia anterior em parte do ano.

   O campo de teto vem **preenchido com uma sugestão** (`sugestaoTetoDiario`, PURA): a
   mediana do gasto dos DIAS ÚTEIS dos últimos 30 dias. Dia útil e não todo dia porque o
   fim de semana tem poucos dias medidos e distorce (em 20/08/2026: 8 dias úteis com
   mediana US$ 72,31 contra 2 dias de fim de semana com US$ 132,05, e dois dias não
   sustentam teto). A sugestão é POR PERFIL quando há gasto atribuído a ele, senão cai no
   gasto total da máquina, porque perfil de assinatura só passou a ter gasto atribuído na
   v2.49.0 e exigir dado próprio deixaria sem sugestão justamente quem mais precisa.
   **Ela NUNCA passa a valer sozinha** (decisão do Wanderson, 20/08/2026): só preenche o
   campo, e o bloqueio só existe depois de salvar. Aplicar sozinho pararia a automação de
   quem nunca configurou nada, que é o pior default possível num app que revisa PR.

   Desde a v2.35.0, cada perfil pode ter um **orçamento**: teto diário e/ou total (contado a partir de uma data de corte editável), configurados no mesmo card do perfil. Estourar qualquer um dos dois pausa toda a automação de revisão (disparo automático de PR novo, retentativa automática pós-falha transitória, e o scan automático de pushback), sem bloquear clique manual nem a autoanálise de Meus PRs (que só roda por clique); libera sozinho quando o gasto volta a caber, sem precisar de nenhum botão de "despausar". **A liberação automática vale pro gate de ENFILEIRAMENTO** (PR novo volta a disparar sozinho, o retry pós-falha volta a repescar, o scan de pushback volta a rodar). **PR que já estava na fila headless e foi barrado na BOCA da sessão é outra história: ele ESTACIONA (`autoReviewParked`) e espera clique** (decisão da spec, G16). O motivo é o teto do estacionamento em si: o que estaciona nunca relança sozinho, e abrir uma exceção só pro caso do orçamento faria a mesma leva reabrir sozinha horas depois, sem ninguém pedindo, exatamente o que o estacionamento existe pra impedir. Na prática, o card volta visível na fila com o botão Revisar ativo, e um clique retoma. O aviso desse estouro sai **uma vez por perfil por janela de bloqueio** (Set `budgetWarned`, o MESMO do gate de enfileiramento, reconciliado no topo do `check()` quando o perfil destrava): um lote de 8 PRs barrados pelo mesmo teto dava 8 toasts idênticos no mesmo segundo. **Correção importante junto desta feature**: sessões que terminam em erro agora também registram consumo no `usage.json` (`lib/engine/usage.js`), porque uma sessão pode gastar tokens de verdade em turnos anteriores e falhar só no passo final; antes disso, esse gasto ficava invisível na aba Consumo (achado real de um incidente de 04/08/2026, ~US$ 11 gastos em sessões que nunca terminaram com sucesso).

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

## Jira multi-tenant (v2.52.0)

O Farol lê cards de VÁRIOS Jiras, escolhendo o site pela org do GitHub dona do
PR. Antes disso ele dependia do conector `Atlassian Rovo` do claude.ai, que é um
grant OAuth por conta Claude e alcança **um tenant só**. Hoje existe um cliente
REST em Node puro e um servidor MCP local (`tools/jira-mcp.js`): a sessão sobe
com `--mcp-config` apontando pro MCP do Farol mais `--strict-mcp-config`, que
desliga todos os outros. O modelo continua chamando `getJiraIssue` como sempre,
só que a ferramenta agora é do Farol e já nasce apontada pro Jira certo.

**Decisões fechadas (não reabrir sem motivo novo):**

1. **A chave do mapeamento é a ORG do GitHub, não a conta.** Uma conta cobre
   várias orgs, que podem ter Jiras diferentes.
2. **Sem fallback de conta.** Org sem site cadastrado = card não-verificável,
   nunca "tenta o site padrão". Ler o Jira errado é pior do que não ler.
3. **Modelo híbrido.** O Farol pré-busca o card E expõe a ferramenta escopada,
   porque a medição mostrou 7,5% de chamadas que são investigação própria do
   modelo (card ligado, JQL). Tirar isso seria perda real.
4. **A credencial é e-mail + API token do Atlassian, por site.** É o único
   formato que funciona headless (OAuth exigiria navegador) e o único que
   funciona pra quem é convidado numa org que não administra.
5. **O segredo NUNCA passa por linha de comando.** O `--mcp-config` carrega só o
   `siteId`; o servidor MCP lê a credencial do disco. Ver `tools/jira-mcp.js` no
   mapa de arquivos.
6. **`--strict-mcp-config` só entra quando existe pelo menos um site.** Enquanto
   ninguém cadastrar nada, o comportamento é idêntico ao de antes. A partir do
   primeiro site o Farol assume TODOS os MCPs da sessão, **inclusive quando a org
   daquele PR não tem site**: deixar o conector antigo vivo faria o modelo ler o
   Jira de outra empresa sem ninguém perceber.
7. **Card ilegível força `cardMet = false`.** Antes o `cardMet` era afirmação do
   modelo e ninguém conferia (a medição achou 1 em 165 com `cardMet: true` sem
   nenhuma leitura de card na sessão).
8. **Recurso DESLIGADO não é card ilegível, e é isto que faz a decisão 6 valer.**
   Sem o código próprio `desligado`, `jiraSites` vazio devolveria "site não
   configurado" em todo PR, o que zeraria o `clean` e **derrubaria o auto-approve
   de quem nunca ligou o recurso**. `desligado` não loga, não etiqueta, não injeta
   bloco no prompt e não encosta no `cardMet`.
9. **O conteúdo do card é DADO, não instrução.** Card é escrito por qualquer
   pessoa com acesso ao tenant e a revisão abre aprovação automática, então o
   texto entra delimitado e rotulado, e as marcas do delimitador são removidas do
   conteúdo antes de entrar.

**A tela (v2.52.4).** Jira é **seção própria** de Sistema (`sys-jira`), não mais
um bloco no fim de Conexões. Três decisões de apresentação que valem pra quem
mexer ali: (1) o **mapeamento** org -> host se lê como frase no topo do cartão
(`jiraMapaHtml`), porque ele é o recurso inteiro e estava implícito em dois
campos de texto; (2) a **credencial** tem bloco próprio, e o selo mais a barra
esquerda do cartão dizem o estado (verde com credencial, âmbar sem); (3) o aviso
de escopo dos MCPs é `callout`, não prosa, porque é o que muda o comportamento da
máquina de quem salva o primeiro site.

**`testarSite` (v2.52.4)** prova o site sem esperar PR nenhum, e usa
`/rest/api/2/myself` de propósito: qualquer credencial válida responde, então
falha ali é sempre credencial ou URL, nunca permissão em projeto. A recusa carrega
`motivo` junto do `code` (a tabela de `errors.js` vive em `lib/`, que o navegador
não alcança; duplicar no front seria a segunda fonte de verdade que o próprio
`errors.js` existe pra impedir). Rota `POST /api/jira/test`, fachada
`Engine.testarJiraSite`, testes em `test/jira-teste-site.test.js`. Erro cru do
fetch chega como `indisponivel`, não `falha_interna`: quem normaliza é o cliente
(`comoJiraError`), e fetch estourando É falha de rede.

**Pegadinhas já pagas (todas com teste):**

- **O `sanitizar` do cache não pode colapsar underscore.** Ele achata ponto em
  underscore, então id `s1_a` + host `net` e id `s1` + host `a.net` cairiam na
  mesma pasta. Por isso o namespace leva o TAMANHO do id na frente.
- **A tela recusa site inválido, o servidor não descarta em silêncio.** Config
  rejeitada sem aviso é o tipo de falha que o usuário lê como "não funciona".
- **A config de "sem site" usa um nome que id nenhum produz**, senão um site
  cadastrado colidiria com o arquivo do caminho não escopado.
- **`fields` array não é card.** O Jira responde 200 com envelope de erro, e sem
  prova de forma isso viraria "card lido".
- **O protocolo do workspace tem que instruir o caso da seção de card AUSENTE**
  (revisão aberta pelo terminal, ou Farol sem site) e **não pode prometer escopo
  em caminho não escopado**: ali a ferramenta alcança o único tenant que o
  conector tiver, que pode ser o de outra empresa.
- **Fora de escopo por decisão:** a sessão de **chat** do PR continua sem MCP
  escopado (`lib/engine/chat.js` sobrescreve `extraArgs` inteiro por
  `['--resume', sid]`); chat não produz veredito. A autoanálise, essa sim, entra.

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

### Motivo é OBJETO: o unwrap tem UM endereço (v2.51.1)

Desde a v2.48.0 `reasons`/`attention` viajam como `{ text, kind }`. Interpolar o
objeto cru numa string escreve **"[object Object]"** na cara do usuário, e isso
já saiu em produção DUAS vezes:

| onde | versão | corrigido |
|---|---|---|
| card "Precisa de você" | v2.48.0 | v2.48.3 |
| as TRÊS notificações do sistema (`main.js`) | v2.48.0 | **v2.51.1** |

O agravante: **o CHANGELOG da v2.48.3 afirmava que a notificação tinha sido
corrigida** ("A notificação do Windows dizia a mesma coisa"). Não tinha. O
`main.js` nunca teve teste nenhum, então nada denunciou.

`reasonText` mora em **`lib/format.js`** e é a fonte única pro engine e pro shell.
`ui/pure.js` mantém a própria cópia **de propósito**: ele é servido ao NAVEGADOR
como módulo ES e não pode importar de `lib/`, que o servidor não expõe.

`test/motivo-nunca-vira-objeto.test.js` trava as duas metades: o unwrap, e a
AUSÊNCIA de interpolação crua no `main.js` (lê o fonte e proíbe `${x[0]}` que não
passe por `reasonText`, mesma técnica do `ui-pure.test.js` contra menção de pessoa
escrita à mão). Consumidor sem teste é onde o mesmo bug volta.

**Foco da janela no Windows, no mesmo pacote:** `win.focus()` sozinho NÃO traz a
janela pra frente. O SO só deixa quem já é o processo em primeiro plano roubar o
foco (foreground lock), e clicar numa notificação não conta, então o clique não
fazia nada visível. `showWindow` faz o pulo do `setAlwaysOnTop(true)`/`(false)`
antes do `focus()`, só no ramo não-mac.

### A garantia mora no estrangulamento, não no chamador (v2.51.1)

Terceiro tropeço da mesma feature, e o mais instrutivo. A saída de cena foi
implementada como um filtro no `toReview`, e existem **três** caminhos automáticos
que enfileiram revisão:

| caminho | via label viva | via saída registrada |
|---|---|---|
| `toReview` | sim | sim |
| `reReviewTargets` | sim | **não** (até a v2.51.0) |
| `retryTargets` | **não** | **não** (até a v2.51.0) |

Medido no `biudtech/engine-ai#68` (20/08/2026): o Farol comentou às 19:55:52 e a
label dele subiu às **19:57:45**, com a label do colega ainda no ar (ela só saiu às
20:00:01). Ou seja, entrou por um caminho que nem olhava a label. Diferente do #60,
aqui não foi o marcador transitório: foi gate no lugar errado.

**A regra que sai daqui:** garantia que precisa valer sempre mora no PONTO DE
ESTRANGULAMENTO, nunca em cada chamador. `enqueueHeadless` é por onde toda revisão
headless passa (`launchReview` e `launchReReviews`), então é lá que a saída de cena
é honrada. Os filtros em `retryTargets`/`reReviewTargets` continuam, mas agora são
economia (não ficar repescando em silêncio), não a garantia.

O CLAUDE.md **já avisava** disso no parágrafo do `reReviewTargets` ("as MESMAS
travas do toReview: quem mexer lá, mexe aqui") e eu acrescentei uma trava nova sem
espelhar. Aviso em prosa não substitui invariante no código.

**Clique explícito atravessa e DESFAZ** (`pr.manual`, `origem: 'clique'` na rota):
quem mandou revisar foi você, sabendo que outra pessoa está lá, e a partir daí o
app volta a agir no PR. Mesmo espírito do estacionamento (lançar tira de lá).
Travado em `test/saida-de-cena-estrangulamento.test.js`.

### Aprovação não é fungível: o CODEOWNERS entra no gate (v2.51.0; SUPERADA em 28/08/2026)

**Nota de 28/08/2026: a cobertura de exigência foi SUPERADA pela regra plana**
(ver "As duas decisões de 28/08" acima): ver alguém revisando sempre segura o
automático e o PR espera ação manual, então `cobreMinhaExigencia` saiu do
código. O que sobreviveu desta seção: `souAutoridade` e o guarda "nunca
co-assino onde sou autoridade". O texto abaixo fica como registro da motivação.

A v2.50.1 consertou o marcador transitório mas manteve um pressuposto errado:
que "outra pessoa está revisando" bastava. **Não basta, importa QUEM.** Dados
medidos em 20/08/2026:

As duas formas encontradas nos repos da empresa (logins trocados por letras: este
arquivo viaja no pacote de distribuição, que é auditado e não aceita conta de
ninguém, ver invariante 7):

| forma | CODEOWNERS | gate |
|---|---|---|
| dono único | `* @dona-do-repo` | ruleset com codeowners |
| dupla de guardiãs + exceção por caminho | `* @dona-A @dona-B` + `/package.json @dona-C` | ruleset com `require_code_owner_review: true` |

Na segunda o gate é EXIGIDO de verdade, então aprovação da dona-C não libera nada
fora do `package.json`. Com o comportamento da v2.50.1, se o Farol dela pegasse um
PR primeiro, os Farols das donas A e B saíam de cena e o PR travava sem a aprovação
exigida. E com a co-assinatura ligada era **pior**: o gate de codeowner seria
satisfeito sem nenhum codeowner ter revisado, que é o oposto do que ele existe pra
fazer ("filtrar o que sobe ou não").

`cobreMinhaExigencia(regras, caminhos, eu, outro)` é a pergunta que decide: só
saio de cena se, pra TODO arquivo em que eu sou dono, `outro` também é. Os quatro
casos reais estão travados em `test/codeowners.test.js` (lá os logins são os de
verdade: o diretório `test/` NÃO viaja no pacote). **CODEOWNERS é OU dentro da
linha e a ÚLTIMA regra que casa vence por arquivo** (não acumula), então a dona-B
cobre a dona-A mas nenhuma das duas cobre o `package.json`.

Duas travas que vêm junto: **nunca co-assino onde sou autoridade** (registrado em
`skipComentado[key].autoridade` na hora de sair de cena) e **falta de dado nunca
libera** (CODEOWNERS ilegível, diff não medido ou dono de time = reviso). O cache
do CODEOWNERS é por repo, em memória, TTL de 1h.

### Reabertura silenciosa pós-update (v2.51.0)

O auto-update é ligado por padrão desde a v2.46.0, então o ciclo "fecha e reabre"
acontecia sozinho no meio do dia e a janela nova roubava o foco. Agora o app
reabre **escondido, direto na bandeja**, e quem avisa é uma notificação.

O sinal é um ARQUIVO (`state/reabrir-silencioso.json`), não um argumento de linha
de comando, porque no Windows quem reabre é `explorer.exe <atalho>` e os
argumentos vêm do `.lnk`. Ele é gravado antes de disparar o installer e consumido
(e apagado) pelo `main.js` no boot, uma vez só. **Tem prazo de 10 minutos de
propósito**: update que falha no meio deixaria o marcador no disco e a próxima
abertura MANUAL sairia sem janela, o que pareceria app quebrado.

## Um Farol por PR (v2.50.1): a lição do marcador transitório

A v2.49.0 estreou o "pulo por label" e ele estava errado de origem. Vale registrar
porque a classe do erro se repete: **decidir de forma permanente olhando um sinal
transitório.**

A label `<conta>:revisando` é posta no início da sessão e removida no `finally`.
Ela responde "tem alguém revisando NESTE SEGUNDO", e essa resposta volta a ser
"não" em minutos. O gate lia isso e o Farol comentava no PR que não ia duplicar a
revisão. Medido no `biudtech/engine-ai#60` (20/08/2026):

| hora | evento |
|---|---|
| 18:48:42 | label `thiagocarvalho-dev:revisando` entra |
| 18:50:29 | Farol do Alexpraxedes comenta "não vou duplicar a revisão" |
| 18:52:15 | label do thiago SAI (a revisão dele terminou) |
| 18:55:46 | label `Alexpraxedes:revisando` entra |
| 18:59:09 | Alexpraxedes APROVA |

Ou seja: adiamento de cinco minutos com promessa pública quebrada em cima. E o
agravante que o Thiago apontou na mesma conversa: **quem se calou era o CODEOWNERS
do repo** (`* @Alexpraxedes`), então, se o pulo tivesse funcionado como escrito, o
PR ficaria sem a aprovação estruturalmente exigida, com um comentário público
explicando por quê.

Duas perguntas diferentes que estavam sendo confundidas:

| pergunta | natureza | efeito correto |
|---|---|---|
| "alguém está revisando agora?" | transitória (minutos) | esperar, e esperar não precisa de comentário |
| "alguém já assumiu esta rodada?" | durável (por head) | sair de cena, e aí o comentário é verdade |

O que vale agora (decisão do Wanderson, 20/08/2026, "só um Farol pode aprovar por
PR"): ver a label de outra pessoa faz o Farol **sair de cena naquele head**, de
forma durável, gravada em `state/skip-comentado.json` com o `head` junto. Ele não
revisa depois, e é isso que o comentário descreve.

Três peças que a decisão exige, e nenhuma é opcional:

1. **`coAssinarReview`** (opt-in, default false). Sem ela, "só um Farol aprova"
   deixa o PR do codeowner esperando clique humano, porque o Farol sai de cena e
   ninguém aprova no lugar. Com ela ligada, a aprovação de quem pegou o PR vira um
   APPROVE em seu nome, sem sessão e sem token. **É o único caminho do app que
   aprova sem ter revisado**, então os gates moram no próprio `coAssinar` (ver
   invariante 4) e a chave nunca nasce ligada: quem liga assume que endossa
   revisão alheia sem saber o rigor nem o modelo que a produziu (objeção do
   próprio Wanderson na conversa, e ela não tem solução técnica: o Farol não tem
   como descobrir o modelo que rodou na máquina do colega).
2. **`standDownCaducou`** (PURA). Se a label do colega sumiu e ele NÃO deixou
   review naquele head, a sessão dele morreu no meio: a saída de cena caduca e o
   Farol assume de volta. Sem isso, um crash na máquina alheia deixaria o PR órfão
   pra sempre. Sem a lista de reviews (rede fora) **nunca** caduca: na dúvida fico
   de fora, que é o lado seguro desta política.
3. **Poda por head.** A âncora guarda o `head`, e o `_headSeguro` degrada pra head
   vazio quando o `gh` falha (âncora vale pro PR inteiro, de novo o lado seguro).

**Limite conhecido e declarado:** dois Farols que começam no mesmo segundo não se
veem (nenhum tem sinal ainda) e os dois revisam. O sinal reduz duplicata, não é
trava distribuída. Fingir o contrário no código ou na tela seria mentira.

### As duas decisões de 28/08/2026 (v2.53.9 e v2.54.0): o que é vazamento e o que não é

O dia teve DUAS rodadas de decisão do Wanderson, e só a segunda vale. De manhã,
ao ver a label `thiagocarvalho-dev:revisando` no biud-frontend#845, a leitura
foi "nenhum rastro de automação em público" e a v2.53.9 trocou a label por uma
ref git invisível e matou o comentário de pulo. À tarde ele corrigiu o rumo:
**a label visível é DESEJADA** ("deixa os demais membros cientes da revisão");
o que é proibido é **TEXTO público não-humanizado** (template, contexto interno,
coisa irrelevante ao trabalho revisado). Estado final (v2.54.0):

- **A label `<conta>:revisando` é o sinal ESCRITO**, de volta como sempre foi
  (aplicada no início da revisão headless, removida no finally, criada no repo
  quando falta). `lib/engine/review-signal.js` ficou só como LEITURA DE
  TRANSIÇÃO das refs que a v2.53.9 escreveu por algumas horas.
- **O comentário de pulo segue MORTO** (esse era texto público não-humanizado de
  verdade: a mesma frase, de contas diferentes, minutos depois do sinal alheio).
  A saída de cena é silenciosa no GitHub: âncora local + toast no app.
- **Gate de consciência do review automático** (formulação dele: "se alguém já
  aprovou, se alguém tá revisando e se alguém já reprovou que não seja o acrity,
  não fazemos review a menos que haja ação manual"): antes de gastar sessão, o
  caminho automático consulta o head ATIVO (`bloqueadoPorHistorico`,
  no máximo 2 chamadas gh e SÓ na boca do lançamento, nunca por ciclo em todo
  PR). Segura: CHANGES_REQUESTED de gente (a primeira já basta) ou
  `APROVACOES_QUE_SEGURAM` (2) aprovações humanas, o "(máximo 2)" da regra: com
  UMA aprovação a automática ainda vale como a segunda (calibração da v2.54.1).
  Cada pessoa conta pelo ÚLTIMO estado decisivo dela no head (pediu mudanças e
  depois aprovou = aprovação); DISMISSED/COMMENTED não contam e FERRAMENTA nunca
  conta. **Quem decide se é ferramenta é `ehFerramenta`, e não a lista crua**
  (v2.54.2, incidente do biudtech/engine-ai#108): `NAO_SAO_PESSOAS` guarda o
  prefixo da LABEL (`acrity`), mas a API de reviews devolve
  `acrity-advesarial-code-review[bot]`, então o `has()` cru dava falso e a
  reprovação do bot segurou a automática de um PR inteiro em silêncio. As
  fixtures da suíte usavam o prefixo curto e ficaram verdes o tempo todo:
  **fixture de login tem que ser o login REAL da API.** As três provas de
  `ehFerramenta` são `user.type === 'Bot'`, sufixo `[bot]` no login e o nome
  da lista (exato ou como prefixo antes de um hífen). Bloqueado = o PR fica na fila esperando clique, com toast único por
  PR+head. Head novo zera o histórico e a automação volta. Falta de dado
  NUNCA bloqueia (o pior caso é revisão redundante, nunca post errado). A boca
  única é `bloqueiaAutomatico`, aguardada nos TRÊS caminhos automáticos:
  `launchReview` (toReview do check), `launchReReviews` (antes até do
  pushTrivial) e `_repescarRetry` (server.js; retry bloqueado também sai do
  `retryAfterNet`, senão reconsultaria o mesmo head pra sempre). Clique manual
  (`pr.manual`) atravessa sem nenhuma chamada.
- **Regra plana na saída de cena**: ver alguém revisando SEMPRE segura o
  automático. Caiu a exceção da v2.51.0 (`cobreMinhaExigencia`, removida de
  `codeowners.js`): PR cuja exigência de codeowner é minha agora ESPERA meu
  clique em vez de revisar por cima. O guarda "nunca co-assino onde sou
  autoridade" permanece (`autoridadeNaSaida`, via `souAutoridade`).
- Regra pra feature futura: TEXTO público novo (comentário, corpo, descrição)
  passa pelo crivo de humanização antes de existir; sinal de ESTADO visível
  (label) é aceitável e desejado.

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

### A pergunta é sobre o passado; o POST é sobre o presente (v2.52.2)

Caso medido (biud-esg#230, 23/08/2026): **dois APPROVE meus no mesmo PR, com 10
segundos de diferença** (02:04:33Z e 02:04:43Z). O log fecha a história: às
22:10:53 -03 a postagem morreu por rede, e às 23:04:42 -03 saiu `decide
biud-esg#230: pendência já resolvida durante o post, histórico preservado`,
exatamente ENTRE os dois reviews. O reenvio automático e o clique postaram nos
dois lados da mesma janela.

Não faltava dedup: as CINCO vias que postam (revisão automática, `retryFailedPosts`,
`decide`, chat e co-assinatura) consultam `myReviewStates` antes, e as duas
consultaram. O problema é que **a consulta responde sobre o passado**: entre o
"ainda não há review meu" e o POST cabe outro POST, e quem perguntou primeiro não
tem como ver o review que ainda está no ar.

A trava mora no **funil** (`postReview`, `lib/engine/decision.js`), pela mesma
regra da seção "A garantia mora no estrangulamento": postagens do mesmo PR pela
mesma conta entram em FILA (`postLanes`), e quem chega depois não repete o veredito
que acabou de sair para o MESMO head (`postedReviews`, janela de 5 min em
`TEMPOS.POSTAGEM_MEMORIA_MS`).

**A janela é curta de propósito, e a primeira versão errou nisso** (nasceu com 6h,
corrigido na v2.52.5 na auditoria da própria entrega): esta memória sabe só
`veredito + head`, enquanto o dedup remoto sabe o que ela não sabe. Review
**DISMISSED** pelo autor deixou de valer (`DECISIVE_REVIEW_STATES`), então aprovar
de novo no MESMO head depois de um dismiss é LEGÍTIMO e o `myReviewStates` deixa
passar. Com janela longa, a memória vetaria essa repostagem devolvendo `ok`, e a
pendência seria resolvida com o PR sem aprovação nenhuma. A corrida que ela existe
pra resolver dura segundos (10, no #230); o resto é com quem pergunta ao GitHub. O retorno é
`{ ok: true, deduped: true }`, nunca erro: o review que aquele chamador queria ver
no PR está lá, e devolver falha faria a pendência voltar pra mesa.

O que **continua passando**, de propósito: round novo (head diferente é outra
manifestação; o engine-ai#51 tem dois APPROVE legítimos, de 18/08 e 23/08),
`COMMENT` (o chat conversa, travar isso o emudeceria), outro PR, outra conta, e o
repost depois de uma tentativa que FALHOU (falha não é entrega). O sha da
assinatura passa pela MESMA régua do `normalizeReviewPayload` (7 a 40 hex, caixa
ignorada): sha torto é descartado lá e o review sai sem âncora, então ele não pode
inventar rodada nova aqui.

Limite honesto: a fila é por PROCESSO. Duas instâncias do Farol (ou o app
reiniciado no meio) continuam contando com o dedup remoto de cada via, que é o
que sempre existiu e cobre o caso sem corrida.

### Head que anda DURANTE a sessão: não posta (v2.51.2)

Caso medido (biud-esg#224, 21/08/2026): a sessão leu o head `3cf42b3`, o autor
empurrou `b8722a3` dois minutos antes do POST, e o APPROVE saiu ancorado no sha
lido. O GitHub recusou com um `422` genérico ("Unprocessable Entity"), o card
caiu em "Precisa de você" com essa frase de oito palavras como único motivo, e o
clique em Aprovar reenviava o MESMO payload, ou seja, falhava idêntico pra sempre.

A regra do G1 não mudou (a âncora é sempre o head que a sessão LEU). O que mudou
é o desfecho quando esse head já não é o do PR, porque aí as duas saídas eram
erradas: com a âncora velha o GitHub recusa; sem ela o review sairia carimbado num
código que ninguém leu E o `staleForReview` passaria a ver review meu no head novo,
desarmando o round 2 (o buraco do #742). Então **não posta**, nos DOIS pontos, e
quem mexer num tem que mexer no outro:

- `review.js`, logo antes dos ramos `canAuto`/`canReject`: relê o head (`engine.headSha`,
  exceção e vazio degradam pro comportamento antigo, como no dedup) e, se andou,
  derruba os dois gates e prepende uma `gateReason`. O achado vira pendência.
- `decision.js` (`decide()`): reusa o `head` que o dedup já buscou, grava
  `blockedReason` no item (mesmo mecanismo do bloqueio de linguagem, G13) e devolve
  `blocked: 'stale_head'`. A pendência FICA na mesa, com o motivo no card.

A frase é uma só, em `lib/format.js` (`staleHeadText`), com os dois shas curtos.

Duas correções irmãs, no `postReview`:

- **A mensagem de erro do `gh`**: ele fala por dois canais quando o GitHub recusa,
  a linha curta no stderr e o corpo JSON inteiro no stdout, e é no `errors[]` do
  stdout que mora o campo recusado. O código fazia `r.stderr || r.stdout`, então o
  stderr sempre vencia e o detalhe ia pro lixo: era por isso que o 422 não dizia nada.
  `ghErrorMessage` junta as duas metades (teto de 300, `errors[]` de string ou objeto).
- **Degrau de recuo sem inline**: o fallback de 422 era gateado em `comments.length`,
  então review sem comentário de linha (o APPROVE, quase sempre) não tinha saída
  nenhuma. `semAncoraPayload` recua a âncora uma vez. Só chega aí payload cujo head
  JÁ foi conferido acima, então largar a âncora não muda de que código o texto fala.

**Desde a v2.53.0 essa pendência não fica presa esperando clique pra sempre.** Ela
carrega `blockedKind: 'stale_head'` e `blockedHead: <head observado>` nos DOIS
pontos que a criam (`review.js`, fim de `runHeadlessReview`, e `decision.js`,
`decide()`; quem mexer num tem que mexer no outro), e é esse par que o round
automático pós-push lê pra se destravar sozinho quando a conta é autônoma (ver
"Autonomia completa do round automático" logo abaixo). Motivação medida:
engine-ai#90, 25/08/2026, 14 commits em rajada com as rodadas de correção
dependendo de clique, porque até aqui o próprio bloqueio impedia o mecanismo que
o resolveria. Ela é superseded em QUALQUER desfecho do round novo (`recordDecision`
em `decision.js`): postou, virou outra pendência ou falhou de outro jeito, o card
velho sai da mesa e vira `superseded` no histórico, nunca fica duplicado.

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
  sessão Claude. **Desde a v2.53.0 não é mais só `CHANGES_REQUESTED`**: dois
  gatilhos armam (review meu que ficou stale, OU pendência bloqueada por head
  velho), com debounce e teto diário próprios; ver a seção "Autonomia completa
  do round automático" logo abaixo pro mecanismo inteiro. **Draft NÃO arma round
  automático** (v2.41.3, G10: WIP geraria sessão e, com onReject, um review por
  push; o chip manual segue cobrindo). Pendência na mesa segura o relançamento
  (um card por PR), **exceto a pendência `blockedKind === 'stale_head'`**: essa
  é ignorada por esta trava de propósito, porque ela é o SINTOMA que o gatilho B
  existe pra resolver, não um julgamento humano esperando. E repete as MESMAS
  travas do toReview: quem mexer lá, mexe aqui.
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

### Autonomia completa do round automático: dois gatilhos, debounce e teto diário (v2.53.0)

Motivação medida: engine-ai#90, 25/08/2026, 14 commits em rajada com as rodadas de
correção dependendo de clique. Duas causas raiz, e as duas eram falta de respeito
à autonomia que a conta já tinha configurado: (1) o gate só armava com
`CHANGES_REQUESTED`, então round iterativo que já tinha recebido um APPROVE stale
travava no primeiro e nunca mais fechava sozinho; (2) quando o head andava NO MEIO
da sessão anterior (ver "Head que anda DURANTE a sessão" acima), a pendência que
isso gerava travava o próprio mecanismo que a resolveria. Decisão do Wanderson: "se
configurei pra ser autônomo, quero que seja respeitado". **Nenhum toggle novo**:
tudo continua governado por `autoReviewFor` da conta, do jeito que já era.

O que mudou de fundo:

1. **APPROVE stale também relança** (antes só `CHANGES_REQUESTED` armava; aprovação
   stale ficava só no botão, por clique).
2. **Pendência bloqueada por `stale_head` deixa de segurar o round e passa a ARMAR
   um segundo gatilho**, em vez de impedir o mecanismo que a resolveria.

`classificaReRound` (`lib/engine/review.js`) escolhe entre dois gatilhos
independentes pro mesmo `headRound`:

- **Gatilho A (staleInfo)**: meu último review postado (APPROVE ou
  CHANGES_REQUESTED) ficou stale contra o head atual, com prova completa
  (`stale` true, `head` conhecido). Debounce lido de `engine.headQuietoDesde[key]`,
  carimbado no `refreshStaleStates` toda vez que o head observado muda.
- **Gatilho B (pendência)**: o resultado nunca chegou a postar porque o head andou
  durante a sessão anterior. Lê `blockedHead` da pendência `stale_head` (os dois
  pontos que a criam, `review.js` e `decision.js`, ver a seção acima). Debounce
  pelo `createdAt` da própria pendência. O candidato pode estar FORA do panorama
  (a fila mine não filtra por owner): `candidatosReRound` o reconstrói a partir da
  pendência, sem labels e com o `isDraft` real gravado na pendência (desde a
  v2.53.1), e a CONTA junto (`recordDecision`
  passou a incluir `account` na allowlist de `item.pr`, sem ela o relançamento e a
  postagem cairiam na conta primária errada).

Os dois convergem nas MESMAS travas do `toReview` (conta muda, sem token,
orçamento estourado, `outrosRevisando`, `skipComentado`, draft). A trava de
"pendência na mesa segura" continua valendo pra julgamento humano pendente, e por
isso a pendência `stale_head` é a ÚNICA exceção: ela não segura porque é o sintoma
que este gate existe pra resolver, não uma decisão esperando o Wanderson.

**Debounce** (`TEMPOS.HEAD_QUIETO_MS`, 5 minutos): os dois gatilhos só armam com o
head QUIETO por esse tempo, proteção contra rajada de pushes. Carimbo ausente
nunca dispara.

**Teto diário** (`MAX_RODADAS_AUTO_DIA`, 3 por PR por dia): proteção de orçamento
dentro do modo autônomo, nunca redução de autonomia. A âncora `reReviewLaunched`
(`state/rereview-launched.json`) mudou de string (só o head) pra
`{ head, dia, rodadas }`; `normalizeAncora` lê os dois formatos (string legada vira
`{ head, dia: '', rodadas: 1 }`, nunca infla o teto por acidente de migração) e
`proximaAncora` incrementa `rodadas` quando o dia bate, reseta pra 1 quando muda.
Estourou: `reReviewEsgotados` avisa UMA vez por PR por dia (`avisoRodadasDia`, Set
em memória) e nunca enfileira sozinho; o botão Re-revisar continua valendo sempre
(o teto é só do caminho automático).

**Gatilho B NUNCA entra no pulo de push trivial** (`pushTrivial`, mesmo arquivo): a
prova salva que o pulo compara é do head ANTERIOR ao bloqueio, e o payload da
pendência já está ancorado nesse head velho. Pular ali recriaria o deadlock que
esta feature existe pra matar: um toast de "a revisão anterior segue valendo" sem
NENHUMA revisão de fato postada, com a âncora já queimada pro head novo. Só a
sessão relançada produz payload postável no head atual.

`classificaReRound`, `reReviewTargets` e `reReviewEsgotados` continuam SÍNCRONAS e
sem IO, mesmo contrato de sempre; `reReviewTargets` devolve CÓPIAS RASAS (nunca o
objeto do panorama, que `_headRound` mutaria em compartilhado).

**Dívidas conscientes que ficam por decisão** (as três de orçamento/reinício da
leva original foram resolvidas na v2.53.1: `avisoRodadasDia`/`headQuietoDesde`
agora podam a cada `launchReReviews`, o candidato do gatilho B carrega o
`isDraft` real da pendência, e `recoverInflight` só libera o `head` da âncora
objeto, preservando `dia`/`rodadas`; as duas abaixo continuam por decisão):

- O candidato do gatilho B fora do panorama não carrega labels (janela estreita:
  `candidatosReRound` reconstrói do que a pendência guardou, não do panorama de
  verdade; label é sinal transitório e dado velho seria pior que nenhum).
  `enqueueHeadless` segue honrando `skipComentado` normalmente nesse caminho,
  então "um Farol por PR" não afrouxa.
- O debounce do gatilho B usa `createdAt` FIXO: não reinicia se chegar um push novo
  durante a espera. A sessão relançada relê o head real no início como sempre, então
  o pior caso é relançar um pouco cedo, nunca com head errado.

### Prova por arquivo: round incremental, pulo de push trivial e retomada de sessão (17/08/2026, ainda não publicado)

Motivação medida: o round 2 pós-push relia o PR INTEIRO mesmo quando o dev corrigiu 3 arquivos
de 40, e um "update branch" (merge da base que não toca o diff) custava uma sessão completa pra
chegar na mesma conclusão. Três peças, todas com a régua de sempre (falta de dado NUNCA vira
herança; degradação é sempre pra revisão cheia, que é segura):

- **`lib/engine/file-proof.js`** é o módulo novo. A cada revisão headless o engine tira um
  retrato do diff efetivo via `pulls/{n}/files` (`fetchPrFiles`, fachada `Engine.fetchPrFiles`;
  é esse endpoint porque ele devolve o **blob SHA por arquivo**, que o `gh pr view --json files`
  não dá) e, no fim da sessão, grava a prova em `state/file-proof/<encodeURIComponent(key)>.json`:
  `{head, files: [{path, sha, status, lines}], reviewed}` com `reviewed` vindo do
  `coverage.reviewed` do envelope (envelope sem coverage grava `reviewed: []`: sem declaração não
  há prova de leitura, mesma régua do coverageGap; a prova ainda serve pro pulo de push trivial).
  Poda por idade de 30 dias (`pruneFileProofs` no boot, `TEMPOS.PROVA_ARQUIVO_MAX_AGE_MS`,
  best-effort padrão G20).
- **Pulo de push trivial** (`launchReReviews`, que virou **async**; o `check()` aguarda): antes
  de relançar o round 2 automático, se existe prova salva, UMA chamada `pulls/files` compara o
  diff atual com o que a última sessão leu (`sameEffectiveDiff`: mesmos caminhos, mesmo blob,
  mesmo status em TODOS; sha vazio nunca prova igualdade). Idêntico = rebase limpo ou merge da
  base: nenhuma sessão abre, toast avisa (nunca silencioso) e a âncora `reReviewLaunched` já
  gravada segura até o próximo push DE VERDADE. Sem prova salva o gh nem é consultado (zero
  custo no caso comum) e qualquer falha de medição relança como sempre. Edge conhecido e aceito:
  conflito resolvido "descartando" a mudança da base mantém o blob do head idêntico e pula, mas
  o código resultante é byte a byte o que a revisão anterior avaliou.
- **Round incremental (herança de cobertura por blob)**: no round 2 com head DIFERENTE do da
  prova (mesmo head é retomada de falha, e aí quem cobre é o checkpoint; herdar tudo no mesmo
  head faria a sessão "se confirmar" sem ler nada), `splitByProof` separa o diff em INALTERADOS
  (blob + status idênticos E leitura declarada na prova) e ALTERADOS. O prompt ganha o
  `fileProofBlock` (leia os alterados + reverifique os achados; inalterado só se interagir; e
  declare em `coverage.reviewed` SÓ o que leu NESTA sessão), o fan-out passa a medir e fatiar
  **só o que precisa ser lido** (`metricsIncrementais`), e depois da sessão
  `reconcileInheritedCoverage` move o inalterado de `missing` pra `reviewed` com a origem
  separada em `coverage.inherited` (leitura desta sessão e prova herdada nunca se confundem).
  O `coverageGap` continua PURO e intocado: a reconciliação acontece antes, em review.js. A
  prova nova gravada no fim carrega o reviewed já reconciliado, então o round 3 herda o acumulado.
  O checkpoint de verificação também sobrevive ao push por blob: cada entrada ganha `blobSha`
  (carimbado em session.js via `activeReviews.get(id).fileBlobs`) e `relevantEntries` (fonte
  única em verification-checkpoint.js, usada pelo resumeBlock E pelo summarizeCheckpoint) aceita
  entrada de head antigo cujo arquivo não mudou.
- **Retomada de sessão no round 2** (`config.reReviewResume`, default **false**, opt-in;
  toggle em Sistema > Automação, `#setReReviewResume`): o relançamento automático carrega o
  `sessionId` da última decisão do PR (`lastReviewSessionId`, lido das decisões CRUAS porque o
  `decisionByKey` projeta allowlist sem sessionId) e `rodarSessao` roda `claude --resume <sid>`,
  com a MESMA allowlist de formato do chat antes de entrar na linha de shell. Falha de retomada
  (sessão expirada/limpa, mesma heurística de erro do chat.js) degrada pra sessão nova sozinha;
  cancelamento e falha real sobem pro retry de sempre. Por que opt-in: sessão retomada carrega o
  contexto do round anterior (premissas velhas podem contaminar), e quem prefere round do zero
  não paga isso sem pedir.

O que NÃO mudou: o gate de postagem (invariante 4) está intacto, o dedup por head também, e a
autoanálise/chat/pushback não gravam nem leem prova. Testes: `test/file-proof.test.js` (puras +
roundtrip + poda + relevância por blob no checkpoint) e `test/rereview.test.js` (pulo de push
trivial, medição falhando relança, sem prova não consulta gh, sid viaja no enfileiramento).

Na mesma leva, dois complementos (motivados pelo caso real biud-frontend#774, 17/08/2026: PR de
3 arquivos de CI levou 30 min porque as 9 verificações empíricas rodaram em SÉRIE):

- **Verificação empírica em paralelo**: agente novo `claim-verifier`
  (`workspace-template/.claude/agents/claim-verifier.md`, leitura pura: Bash/Read/Grep/Glob, sem
  Write) e a seção "Verificações empíricas em PARALELO" em `prompts/pr-review-auto.md`: com 2+
  verificações INDEPENDENTES pendentes, a sessão dispara um `claim-verifier` por afirmação, em
  paralelo, e depois **REEMITE** cada veredito como marcador `FAROL_CHECKPOINT` na própria sessão.
  A reemissão não é opcional: desde esta leva `registrarCheckpointDeBash` captura SÓ blocos da
  sessão principal (evento com `parent_tool_use_id` é ignorado de propósito, senão a captura
  duplicaria quando o CLI streama o subagente). O agente novo está na lista `synced` do
  `prepareHome` (server.js), senão workspace já semeado nunca o receberia, a mesma classe do bug
  de fachada da v2.28.0. Travado em `test/review-prompt.test.js`.
- **Subagentes visíveis na UI** (pedido do Thiago, 17/08/2026): o stream marca evento de dentro
  de subagente com `parent_tool_use_id`, e o `session.js` passou a rastrear: `tool_use` de `Task`
  na sessão principal registra o agente (`registrarAgenteDeTask`, rótulo `tipo N` em
  `activeReviews.get(id).agents`), o `tool_result` correspondente o conclui
  (`concluirAgentesDoEvento`), e cada linha do feed vinda de subagente carrega o rótulo
  (`item.a`, via `pushActivity(id, kind, text, agent)`, fachada com aridade nova). O snapshot
  entrega a projeção compacta via `projectSessions` (PURA, e é ela que também tira `fileBlobs` do
  payload). Na UI: badge `👥 vivos/total` no card "Analisando agora" (title lista quem faz o quê,
  `agentsTitle` em `ui/pure.js`) e etiqueta `👤 rótulo` nas linhas do feed (`feedLine`). Testes:
  `test/session-agents.test.js` e os de `feedLine`/`agentsTitle` em `test/ui-pure.test.js`.

### Tempo por etapa e modo rápido (17/08/2026, ainda não publicado)

Motivação medida (#775): "por que a revisão demorou 10 minutos?" era impossível de responder
depois do fim, porque o feed de atividade (único traço com timestamp por linha) morre no
finally da sessão. Duas peças:

- **Tempo por etapa** (`stageSummaryFrom` em review.js, PURA): calculado do feed IMEDIATAMENTE
  após a sessão (antes do finally apagar) e persistido na decisão (`item.stages`, projetado
  saneado pelo `decisionForUi`). Heurística determinística: o intervalo entre linhas pertence à
  etapa da linha que o ENCERRA, e a fatia final é a redação do envelope. Etapas: preparo,
  leitura, card, verificação (FAROL_CHECKPOINT + linhas de `claim-verifier`), raciocínio,
  redação. A UI mostra em Revisões recentes ("Tempo por etapa: ...", `stagesLine`/`fmtDur` em
  ui/pure.js). É aproximação de traço, não cronômetro; não muda decisão nenhuma.
- **Modo rápido** (`config.reviewFast`, default false, opt-in; toggle em Sistema > Automação,
  `#setReviewFast`): injeta `fastModeBlock()` no prompt headless E derruba o `--effort` da
  linha de comando pra `medium` (salvo `low` explícito, que fica; regra em `buildModelFlags`
  via `opts.fast`, que SÓ o caminho de revisão passa). A segunda metade nasceu de medição
  (#776, 17/08/2026): com fast só no prompt, a "leitura" ainda levava 6m28s, quase tudo
  raciocínio pré-comando, que instrução nenhuma alcança; a flag alcança. O que corta:
  leitura orientada a diff (arquivo inteiro só quando o hunk não se explica), verificação
  empírica SÓ do que muda verdict/decision, experimento longo vira `needs_decision` com reason
  de não-verificado, e pula o dossiê do autor. O que NUNCA muda: schema do envelope, cobertura
  completa, gates de postagem e formato humano. A troca honesta é velocidade por autonomia
  (mais PRs caem pra decisão humana), nunca velocidade por afirmação sem prova. Testes:
  `test/review-stages.test.js` + `fmtDur`/`stagesLine`/`resolvedRow` em `test/ui-pure.test.js`.
- **Esteira de etapas AO VIVO no card** (pedido do Thiago, estilo n8n): cada linha do feed sai
  do engine ESTAMPADA com a etapa (`item.s`, decidido por `stageOfLine` no `onEvent` da revisão;
  `stageOfLine` prefere a estampa quando presente, então a esteira ao vivo e o resumo final
  nunca divergem sobre a mesma linha). A UI desenha nós ligados (`stageFlowFrom`/`stageFlowHtml`
  em ui/pure.js, ordem canônica preparo→leitura→card→verificação→raciocínio→redação): feito
  marcado, ATIVO pulsando com o tempo correndo (o `tickElapsed` atualiza entre eventos),
  pendente apagado. Linha sem estampa (info do app) herda a etapa corrente. A esteira só
  aparece com traço real e morre com o card; o que persiste é o resumo (`stages` na decisão).
  A etapa pode REATIVAR (leitura↔verificação intercalam de verdade): a esteira mostra o estado
  corrente, não uma máquina de estados linear fictícia.

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

## Governança do repositório público (17/08/2026)

O repo é público desde sempre, mas até 17/08/2026 estava sem CI, sem proteção de branch e
com a aba de segurança inteiramente desligada. O que existe agora:

**CI (`.github/workflows/ci.yml`).** `npm run check`, `npm run lint` e `npm test` em todo
push na `main` e em todo PR, numa matriz Linux + Windows + macOS. Não roda `npm install`:
a suíte usa o runner nativo e o Electron só serve pra abrir a janela. O job agregador
**`ci`** é o único status check exigido pela proteção, então dá pra mexer na matriz sem
reconfigurar a regra. O macOS na matriz é a única validação contínua do caminho POSIX
(ver a seção "macOS: estado real"): rodada inteira em menos de 1 minuto.

**Proteção da `main`** (ruleset `main protegida`, não branch protection clássica): PR
obrigatório com resolução de conversa, `ci` verde e branch atualizada, force push e
deleção bloqueados. **Bypass pra Repository admin**, de propósito: o checklist de release
manda commitar e dar push direto na `main`, e sem o bypass a publicação travaria. A
consequência honesta é que a disciplina do mantenedor continua sendo o gate do próprio
push (o `npm run check && npm test` do passo 2), com a rodada de CI na `main` como
testemunha visível. Pra fechar de vez, é remover `bypass_actors` do ruleset e passar a
publicar release por PR.

**Tags `v*`** (ruleset `tags de release`): deleção e reescrita bloqueadas, **sem bypass**.
A cadeia de auto-update lê release do GitHub, então tag publicada é imutável. Republicar
com `FAROL_REPUBLISH=1` continua funcionando (atualiza notas e anexos, não mexe na tag).
Se algum dia precisar mesmo apagar uma tag, desative o ruleset, apague, reative.

**Segurança**: secret scanning com push protection (bloqueia commit que carregue token,
que é a mesma preocupação da auditoria do `make-package.ps1`, só que uma camada antes),
Dependabot com alertas e correções automáticas, CodeQL pelo setup padrão, e relato privado
de vulnerabilidade ligado. A política e o modelo de ameaça estão em `.github/SECURITY.md`,
inclusive o que é **fora de escopo** (a credencial na sessão do Claude, os binários sem
assinatura, a automação opt-in). Reportar coisa fora de escopo não vira correção.

**Perfil da comunidade**: `.github/CONTRIBUTING.md`, `.github/CODE_OF_CONDUCT.md`,
`.github/SECURITY.md`, `.github/PULL_REQUEST_TEMPLATE.md` e dois templates de issue
(`bug.yml`, `melhoria.yml`). O CONTRIBUTING repete os 7 invariantes desta seção acima de
propósito: quem chega de fora não lê o `CLAUDE.md` primeiro.

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
- [ ] Push pra `main`. Desde 17/08/2026 o `origin` aponta pro alias SSH da conta pessoal (`git@github-pessoal:wandersonaadsantos/farol.git`, definido no `~/.ssh/config`), então o **push** não depende mais da conta ativa do `gh` e o 403 crônico descrito abaixo deixou de acontecer nesse passo. A `main` é protegida por ruleset, mas o Repository admin tem bypass, então o push direto continua passando. O que continua dependendo da conta ativa é a **release** (passo 4), que usa a API.
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

**Auto-update**: cópias instaladas (>= 1.15.0) leem a última release via `gh` a cada ciclo de polling (detecção). Desde a v2.46.0, a APLICAÇÃO também é automática: `maybeAutoUpdate` (`lib/engine/update.js`) roda logo depois do `checkUpdate` no `check()` e aplica sozinha quando há update no canal `remote` e o app está ocioso (gate `sessionsBusy`, o mesmo do botão manual). Opt-out em Sistema > Automação (config `autoUpdate: false`) volta ao clique manual. Canal `local` (fluxo de dev do mantenedor) nunca auto-aplica, só pelo botão. Bootstrap: cópias antigas precisam instalar 1.15.0 uma vez (offline).

**Fonte de verdade**: a release do GitHub. O app instalado atualiza só a partir das releases, nunca de código local não mergeado (a menos que `config.updateSource` aponte um caminho explícito).

**Distribuição offline**: o instalador Windows (`.exe`, NSIS) e o macOS (`.command`, autoextraível) não precisam de Node/npm/terminal. Nenhum dos dois é assinado/notarizado (SmartScreen/Gatekeeper avisam uma vez).
