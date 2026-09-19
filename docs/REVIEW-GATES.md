# Gates de revisão e postagem do Farol

Extraído do `CLAUDE.md` na Fase 1.5 da reorganização. O `CLAUDE.md` da raiz é o sumário, e os
invariantes continuam lá.

<!-- indice:inicio (gerado; test/guias-navegaveis.test.js reprova se divergir das seções) -->

## Índice

- [Invariante 4, em detalhe](#invariante-4-em-detalhe)
- [Conclusão da revisão](#conclusão-da-revisão)
- [Motivo é OBJETO: o unwrap tem UM endereço (v2.51.1)](#motivo-é-objeto-o-unwrap-tem-um-endereço-v2511)
- [A garantia mora no estrangulamento, não no chamador (v2.51.1)](#a-garantia-mora-no-estrangulamento-não-no-chamador-v2511)
- [Justiça de fila entre orgs e contas (v2.58.0)](#justiça-de-fila-entre-orgs-e-contas-v2580)
- [Aprovação não é fungível: o CODEOWNERS entra no gate (v2.51.0; SUPERADA em 28/08/2026)](#aprovação-não-é-fungível-o-codeowners-entra-no-gate-v2510-superada-em-28082026)
- [Um Farol por PR (v2.50.1): a lição do marcador transitório](#um-farol-por-pr-v2501-a-lição-do-marcador-transitório)
- [Dedup é por ROUND, não por "alguma vez" (v2.40.5)](#dedup-é-por-round-não-por-alguma-vez-v2405)
- [Re-revisão automática pós-push (v2.41.0): o round 2 fecha sozinho](#re-revisão-automática-pós-push-v2410-o-round-2-fecha-sozinho)
- [Autoanálise: parecer do modelo x decisão do app (P0a v2.54.8, P0b v2.55.0)](#autoanálise-parecer-do-modelo-x-decisão-do-app-p0a-v2548-p0b-v2550)
- [Checkpoint de verificação (memória entre passadas da revisão, v2.36.0)](#checkpoint-de-verificação-memória-entre-passadas-da-revisão-v2360)

<!-- indice:fim -->

## Invariante 4, em detalhe

4. **Nada é postado no GitHub sem gate.** **Duas escritas vieram do "um Farol por PR" (v2.49.0/v2.50.1), e a que sobrou é a mais séria de todo o invariante.** (a) O **COMENTÁRIO de pulo** (`gh pr comment`) MORREU em 28/08/2026 (v2.53.9): era template fixo, a mesma frase saindo de contas diferentes minutos depois do sinal alheio subir, e denunciava a automação. A saída de cena continua durável (âncora `state/skip-comentado.json`, que agora nasce da DECISÃO, não mais de um comentário que saiu) e o aviso é toast no app; NADA é postado no PR. Hoje a única escrita fora do caminho de review é a seguinte. (b) A **CO-ASSINATURA** (`coAssinarReview`, opt-in, default false): um APPROVE postado em seu nome SEM sessão, SEM envelope e SEM passar por `shouldAutoApprove`, com base na aprovação de quem pegou o PR. É o único caminho em que o Farol aprova sem ter revisado, e por isso os gates são explícitos no próprio `coAssinar` em vez de herdados: chave ligada, aprovação comprovada NO HEAD ATUAL de alguém por quem eu saí de cena, e dedup por head (`myReviewStates` null = não posta, porque postar review não é idempotente). Nunca ligue por padrão: quem liga assume que endossa revisão alheia sem saber o rigor nem o modelo que a produziu. Os dois passam pelas travas de identidade do resto (conta sem token não posta). O texto segue o `reviewFormatBlock`: sem citar automação/Farol/fila, sem travessão, e sem pronome de gênero pra quem o app não tem como saber. Auto-approve exige `requested === true` (revisão pedida a mim; revisão iniciada por clique no panorama nunca auto-posta), veredito `approve` e payload `APPROVE`. Com `autoApproveAll: true` (OPT-IN, ligado em Sistema) TODO PR aprovável é aprovado sozinho, sem depender do humano. **O corpo do APPROVE vai LIMPO no PR (tem que parecer humano, ver "review humano" abaixo), nunca com carimbo de "automático". A ressalva TÉCNICA sobre o código entra no corpo, escrita como um revisor sênior mencionaria de passagem (desde a v2.26.1, ver o parágrafo "Ressalva vai pro PR" abaixo); a ressalva OPERACIONAL do nosso fluxo (`result.reasons` que sejam de processo + aviso se `cardMet === false`) fica SÓ no app, no campo `attention`, visível em Revisões recentes.** O DEFAULT é `false` (gate estrito de sempre: só auto-aprova quando a sessão decidiu `decision === 'auto_approve'` E `cardMet === true`), por segurança, já que o app é público/multiusuário e cada um liga se quiser. A decisão fica isolada em `shouldAutoApprove(pr, result)` (devolve `{ ok, motivo }`; o `motivo` alimenta a transparência do runHeadlessReview, que só atribui a recusa à política da conta quando o motivo é `politica`); a composição dos pontos em `attentionPoints`. **Cada conta pode sobrescrever esses padrões globais** (painel Contas): `autoReview` (revisa sozinho / só põe na fila / herda), `onClean` (PR aprovável sem ressalva: `approve`/`wait`) e `onCaveats` (aprovável com ressalva: `approve`/`wait`). O engine resolve por conta em `autoReviewFor(user)` (gate da revisão automática, por `pr.account`) e `approvePolicyFor(user, clean)` (usado por `shouldAutoApprove`; `clean` = sem pontos de atenção e `decision === 'auto_approve'`). Campo ausente na conta = herda o global. `acctPolicy(user)` acha a conta. **Discordância com review de terceiro** (`contested` com prova) segura o auto-approve por default, porque aprovar por cima de outro revisor é tomar posição pública; desde a v2.47.0 isso é escolha e não decreto: `autoApproveContested` (global, opt-in em Sistema > Automação, resolvido em `contestedPolicy()` e lido só por `shouldAutoApprove`) tira a trava, e aí a discordância segue como ponto de atenção comum, o que joga a decisão pra `approvePolicyFor` com `clean === false` (PR com contestação nunca é limpo). Consequência desejada: ligar essa chave sozinha jamais aprova o que `onCaveats: wait` já mandava esperar. Vale SÓ pro approve, `shouldAutoReject` continua barrando contestação sem opção (reprovar por cima de outro revisor é mais grave, não menos). O `runHeadlessReview` só prepend a linha "confira a redação antes de postar" quando o gate de fato barrou (`autoDec.motivo === 'contestacao'`); com a chave ligada essa linha sumiria mentindo, e o ponto já é publicado por `attentionPoints` com rótulo e prova. **Reprovar sozinho** é OPT-IN por conta (`onReject: 'request_changes'`, default `wait`, sem global): quando a revisão pede mudanças (`verdict === 'request_changes'` + payload REQUEST_CHANGES) num review PEDIDO a mim (clique nunca posta) e a conta optou, o app posta o REQUEST_CHANGES com os bloqueios (corpo LIMPO, sem carimbo de automático), dedup por `myReviewStates` (não re-pede se eu já pedi **para o head atual**, ver "Dedup é por round" abaixo). Gate isolado em `shouldAutoReject(pr, result)`/`rejectPolicyFor(user)`; nunca reprova sozinho por default. **A auto-revisão (headless) vale pra TODA a fila elegível da conta com `autoReview` ligado, não só os PRs que acabaram de chegar** (`check()` filtra `this.queue`, não só `fresh`): ligar "revisa na hora" passa a valer pro que já estava esperando. PRs que falharam sem ser rede, ou que você cancelou, ficam em `autoReviewParked` (aguardam ação manual, não relançam sozinhos); lançar de novo (manual) tira do estacionamento. **Desde a v2.57.4 o estacionamento é VISÍVEL no card da fila** (quando parou, por quê, e que o Revisar tenta de novo), porque até ali "nunca revisou" e "revisou, caiu e estacionou" eram idênticos na tela (biud-core#317, 03/09/2026); ver "Estacionamento persistido" em "Ciclo de vida e higiene". **A revisão headless roda até `config.parallelReviews` POR CONTA em paralelo** (default 1 = serial dentro da conta, o comportamento de sempre; contas diferentes revisam juntas desde sempre; opt-in em Sistema > Automação, 1..4, sanitizado por `sanitizeParallelReviews` no boot/updateSettings E clampado de novo em `parallelLimit` no escalonador, defesa em profundidade): `processHeadless` é um escalonador que puxa da `headlessQueue` revisões até o teto da conta, contando em `headlessBusyAccounts` (**Map conta -> contagem** desde a v2.41.0; era Set); `runOneHeadless(pr, acct)` roda cada uma e devolve o slot via `freeHeadlessSlot` (zera com delete, nunca set 0: o isBusy do update.js pergunta `.size`) + reprograma no fim. `headlessAcct(pr)` = conta dona (por `accountForPr`). **Perfil de review por pessoa** (`config.people` = {login: {papel?, dominios?{backend|frontend|dados|infra: nivel}}}, marcado à mão: papel no card do PR e na aba Time, matriz por domínio só na aba Time) molda o TOM e a POSTURA da revisão automática, NUNCA a decisão. `personProfileBlock(login)` injeta no prompt headless (`headlessPromptFor(url, author)`): PAPEL (estagio/junior/pleno/senior/techlead/arquiteto/especialista) dá o tom-base, a MATRIZ (basico/intermediario/avancado/autoridade por domínio) calibra a postura conforme a área que o PR mexe (autoridade→defere; básico→explica mais). A instrução trava: só TOM/POSTURA, nunca verdict/decision/cardMet/gate. Sem perfil = bloco vazio (neutro). Só no caminho headless, não no terminal. Migração: o `config.seniority` plano antigo vira `papel` (`migrateSeniorityToPeople` no load). `parsePeople` valida/normaliza. **Review humano/personalizado:** `reviewFormatBlock()` (injetado SEMPRE junto do perfil, PREVALECE sobre o formato do CLAUDE.md do workspace) manda escrever o corpo postado como uma PESSOA (o Wanderson), personalizado/objetivo/profissional: SEM caixas de alerta `> [!NOTE]`, SEM "Placar", SEM checklist `- [x]`, SEM prefixos de Conventional Comments no texto, SEM citar automação/Farol/"auto-aprovei" (o autor não pode saber que é bot), sem travessão, e o FORMATO adapta à senioridade (estágio/júnior = prosa de mentor; pleno/sênior/arquiteto = enxuto e direto). O protocolo de review (`CLAUDE.md`, `prompts/pr-review-auto.md`, `prompts/self-review.md`, `.claude/agents/pr-reviewer.md`) é RE-SINCRONIZADO da fonte a cada boot (`prepareHome`), pra mudanças de formato chegarem nas cópias já semeadas (nunca toca em `state/`). **Memória de pushback (automática):** quando o autor contesta um review meu, o Farol detecta e classifica sozinho. `scanPushbacks()` roda no `check()` (fire-and-forget, guarda `pushbackScanning`, best-effort): só entra no scan o PR cujo review MEU foi **bloqueio** (`request_changes`) ou **aprovação COM ressalva** (aprovação limpa não gera pushback; `reviewActions()` expõe `caveats` = mesmos pontos do `attentionPoints`, card não comprovado ou motivo listado, pra distinguir). Nesses, gatilho barato via gh (`detectAuthorPushback` = atividade do autor DEPOIS do meu último review; marcador em `state/pushback-scanned.json` evita reprocessar; `updatedAt` do PR é o gate) e, só nos candidatos novos, `classifyPushback` (1 sessão Claude LEITURA pura, nunca posta, `MAX_PER_CYCLE=2`) devolve `{isPushback, outcome, confidence, note}`. Confiança ALTA vira registro `confirmed` sozinho; BAIXA vira `pending` (aparece como "confirmar?" no controle de Revisões recentes, com o desfecho sugerido, você resolve num toque). Registros em `state/pushbacks.json` carregam `source`('auto'|'manual')/`status`('confirmed'|'pending')/`confidence`. `recordPushback` (marcação/correção à mão) é sempre `manual`+`confirmed` (override). `pushbacksFor` (injeção no `personProfileBlock`) usa SÓ confirmados, pra não calibrar em cima de palpite. Mesma trava: só tom/postura, nunca a decisão. Migração: registros antigos sem `source` viram manual+confirmed. **A autoanálise em si (Meus PRs) NUNCA posta nem escreve em `state/`** (é diagnóstico do autor sobre o próprio PR): o caminho `runSelfAnalysis` não passa pelo gate de postagem, o prompt `self-review.md` proíbe qualquer `gh`/`git` de escrita, e o resultado fica só em `self-analyses.json`, onde PERMANECE até o PR fechar. **As escritas no GitHub partindo de Meus PRs são só duas, ambas por clique explícito: o botão "Reviewers" e o botão Merge.** O botão **"👥 Reviewers"** (`setReviewers`) atribui o autor e pede review da lista efetiva do repo, resolvida por `reviewersForRepo(repo)`: a EXCEÇÃO do repo (`config.projectReviewers[repo]`) se houver, senão o PADRÃO da org (`config.defaultReviewers[org]`). Assim funciona em qualquer repo da org que tenha padrão, mesmo sem config própria. Aceita pessoas e times `org/slug`, sem confirmação (aplica na hora); não posta review nem mergeia, só ajusta assignee/reviewers, e filtra o próprio autor da lista. O botão **Merge** (`mergeSelfPR`), acionado por clique explícito com confirmação, e gateado: só o autor mergeia o próprio PR (`author === ghUser`), só quando a autoanálise marcou `approvable === true`, só em repo fora de `config.mergeBlockedRepos` (default `biudtech/biud-frontend`), e nunca em rascunho/PR com conflito. Faz merge commit (`gh pr merge --merge`, sem squash/rebase), atribui o autor se preciso, e deleta a branch de origem **só se for descartável** (`isPermanentBranch` protege develop/release*/main/master/hml*/staging/etc., que jamais são deletadas). Quando o merge normal esbarra na proteção de branch (`blocked: 'policy'`), a UI oferece duas saídas: **auto-merge** (`--auto`, mergeia quando os requisitos passarem, sem burlar nada) e **merge como admin** (`--admin`, bypassa a proteção agora, só se você for admin, com confirmação reforçada). Os dois modos passam pelos mesmos gates (autor/aprovável/lista bloqueada), então nem admin mergeia repo bloqueado como `biud-frontend`. **O botão só fica disponível quando dá pra mergear de verdade**: o engine lê a mergeabilidade real de cada PR aprovável (`refreshMergeStates` no fim do `check()` e após cada autoanálise aprovável, guardada em `mergeStates`) via `gh pr view --json mergeable,mergeStateStatus`. CLEAN/UNSTABLE = botão Merge ativo; BLOCKED = mostra auto/admin direto (sem tentativa que falha); DIRTY/BEHIND/DRAFT = botão desabilitado com o motivo. O Auto-merge só é oferecido quando o repo tem `allow_auto_merge` ligado (`fetchAutoMergeAllowed`); senão o botão fica desabilitado e sobra o Merge (admin). Se ainda assim o `gh` recusar o `--auto` (`enablePullRequestAutoMerge`), o merge devolve `blocked:'autoUnavailable'` com mensagem acionável, e a condição é logada como WARN (não ERROR), já que não é bug do Farol.
   **Check obrigatório vermelho nunca sai como APPROVE sozinho, em nenhuma política (v2.57.3).** `checksVermelhos(result)` (`decision.js`, PURA, mesmo padrão de `coverageGap`/`checkpointGap`) lê `result.checksObrigatorios`, que o `runHeadlessReview` preenche na SAÍDA da sessão com o `faltando` do `bloqueadoPorChecks` (a mesma leitura do gate de lançamento), e `shouldAutoApprove` devolve `motivo: 'ci_vermelho'` antes de consultar a política. Caso medido (biud-frontend#896, 02/09/2026): a regra "CI vermelho = needs_decision" só existia no prompt, a política de ressalvas aprovou por cima com o `audit` obrigatório em FAILURE, e o PR foi mergeado por bypass de admin três minutos depois, com a aprovação assinada por você como cobertura. O gate de ENTRADA (v2.57.0) não bastava porque o clique no Revisar o atravessa por desenho; o de SAÍDA vale pros dois caminhos. Só 'vermelho' segura (rodando e ausente não provam reprovação; leitura que falha devolve `[]`, falta de dado não inventa CI vermelho), e `shouldAutoReject` não é afetado. Travado em `test/ci-vermelho-gate.test.js`.

   **Postagem que falhou por instabilidade tenta de novo sozinha (v2.48.0).** O gate acima decide SE pode postar; esta parte cuida de quando ele já disse que sim e só o POST morreu. Achado no `biud-frontend#774` (17/08/2026): a revisão decidiu `approve`, `shouldAutoApprove` devolveu `ok:true`, e o `gh` respondeu 503 num `major_outage` do GitHub. A falha entrava como mais uma string em `result.reasons` e o item caía pra `pending`, ou seja, uma pendência puramente mecânica esperando clique humano pra sempre, com a decisão e o payload já prontos em disco. Agora `runHeadlessReview` marca `result.postRetry = { event, attempts: 0 }` quando (e SÓ quando) `classify(post.error).kind === 'transitorio'` (mesma tabela de `lib/log-taxonomy.js`, invariante 3: uma fonte só pro que é transitório; a classe `github-indisponivel` nasceu deste incidente). `retryFailedPosts(engine)` roda no `check()` **depois** do `reconcilePending` (pra nunca reenviar em cima de pendência já atendida por fora) e reenvia o payload GRAVADO, sem reabrir sessão nem gastar token. **A trava que mantém isso seguro é o dedup por head** (`myReviewStates`, o mesmo do caminho normal): postar review não é idempotente, então se a 1ª tentativa tinha ido pro ar e só a resposta se perdeu, o retry vira no-op e a pendência resolve sem duplicar review no PR. Teto de `MAX_POST_RETRY_ATTEMPTS` (3), cada ciclo de polling servindo de backoff natural (180s-3600s); esgotado, marca `exhausted` e a pendência volta a ser sua, sem mais tentativa. Falha PERMANENTE (credencial recusada, payload inválido, bloqueio de `internal_language`) nunca entra no sweep: insistir não resolveria e esconderia de você o único problema que exige ação humana. O gate do invariante 4 NÃO afrouxou: só entra no sweep item que o gate já tinha liberado, e `postRetry: null` (a maioria: gate barrou por regra ou conteúdo) jamais é tocado.

   **Firebase ligado mas fora do ar (v2.62.1).** A coordenação conta como ativa pela CONFIGURAÇÃO, não pela conexão, então sem conexão (rede, login vencido, sem credencial) a arbitragem recusava tudo: medido numa matriz de cinco modos, o clique em Aprovar era recusado (`coordenacao-indisponivel`) e a revisão disparada com "sem coordenação" rodava, gastava a sessão e morria na postagem (`registro-indisponivel`). Agora `contornoComFirebaseFora` (`lib/engine/postagem-arbitragem.js`) deixa o ato EXPLÍCITO seguir pelo caminho sem Firebase: vias `clique` e `sessao`, e `revisao` com o handle noop, que com a coordenação ligada só nasce do clique em revisar sem coordenação. Antes de postar, `conferirNoGithub` faz o papel da arbitragem: veredito igual naquele commit já no GitHub é dedup, e sem conseguir conferir não posta (`estado-desconhecido`). O automático (`reenvio`, `coassinatura`, `revisao` com lease) continua esperando a conexão, e o `retryFailedPosts` nem roda enquanto `coordenacaoForaDoAr`, em vez de gastar duas chamadas ao GitHub por pendência a cada ciclo. Risco aceito pelo dono: dois aparelhos postando o mesmo veredito no mesmo instante com o Firebase fora do ar para os dois.

   **Recusa passageira da coordenação (18/09/2026).** Com a coordenação entre aparelhos ligada, a revisão automática grava a intenção de postar em `receipts/.../$fp/postagens` ANTES de o recibo do head existir, e a regra publicada do banco exigia os campos do recibo em qualquer escrita abaixo de `$fp`: a intenção era recusada, o PR caía em "falha técnica ao postar", e o `postRetry` nem armava, porque "não deu para gravar a intenção de postar" não casa classe transitória nenhuma da taxonomia. O clique depois passava, porque o recibo já estava lá (medido no `postagens.json` real: 3 de 3 falhas pela via `revisao`, 6 de 6 sucessos por clique). Três camadas: a regra aceita o `$fp` só com `postagens` e recusa recibo pela metade (`firebase/database.rules.template.json`, publicação manual pelo dono); `postarComRetentativas` tenta de novo até 3 vezes, com `TEMPOS.POSTAGEM_RETENTATIVA_MS` (2 s) entre elas e o lease reconferido antes de cada uma; e `postRetryFor` arma o reenvio dos ciclos também para `falhaPassageira(post)`. Passageira é só `nao_enviada` com `attempted: false` e motivo em `registro-indisponivel`, `coordenacao-indisponivel`, `estado-desconhecido` ou `head-desconhecido` (`lib/engine/postagem-arbitragem.js`): posse de outro aparelho, commit novo e resultado incerto nunca repetem.

   **Motivo tem EIXO, não é lista plana (v2.48.0).** Cada entrada de `reasons`/`attention` é `{ text, kind }` com `kind` em `gate` | `content` | `infra`. Antes era string solta e os três se confundiam na tela: no print do #774 apareciam "7 motivos de ter vindo pra você" misturando 6 achados da revisão com 1 erro 503, o que fazia o gate parecer quebrado quando o que houve foi a rede cair. `gate` = regra deliberada do app (cobertura incompleta, discordância com outro review, política da conta, revisão por clique); `content` = o que a revisão apontou sobre o código; `infra` = a postagem em si falhou. Quem etiqueta é quem cria o motivo (`runHeadlessReview` e `attentionPoints`), uma vez só. **Retrocompatível por construção**: entrada antiga do `decisions.json` (string pura, sem etiqueta) é lida como `content`, a leitura conservadora, nunca inventando um gate ou uma falha de infra que não houve. `uniqueHumanTexts` preserva o par (dedup segue pelo texto normalizado) e `decisionForUi` projeta `postRetry` com allowlist (só `attempts`/`exhausted`: `lastError` é stderr do `gh` e não vai pra tela). A UI agrupa em `reasonGroups`/`reasonGroupsHtml` (`ui/pure.js`), na ordem infra → gate → content.

   **Fronteira do review humano (v2.40.7).** `reportMarkdown`, `reasons`, `attention`, memória, cobertura e gate são diagnóstico interno persistido; `reviewMarkdown`, `payloads.*.body` e cada `comments[].body` são texto de review. `postReview` normaliza o schema e roda `publicReviewLanguageIssues` antes de credencial, arquivo temporário ou `gh`; o fallback de inline é validado de novo. Qualquer vazamento de processo, origem da revisão ou template robótico falha fechado nos fluxos mediados pelo app. O protocolo de terminal e chat manda usar `/api/review/post` com capability efêmera limitada às keys e à conta da sessão, e o writer comum aplica o mesmo gate. Essas sessões ainda recebem uma credencial GitHub para investigar PRs privados, então a capability evita bypass acidental, mas não é uma fronteira contra um processo deliberadamente malicioso que ignore o protocolo e use a credencial diretamente. A UI recebe `decisionForUi`, uma allowlist com o review humanizado e diagnósticos reescritos, nunca o relatório bruto nem os payloads. O protocolo sincronizado inclui também `.claude/commands/pr-review.md`.

   **Ressalva vai pro PR (mudança de 29/07/2026, decisão do Wanderson; valia o contrário até a v2.26.0).** Aprovável COM ressalva **aprova** (ressalva nunca bloqueia) e a ressalva **aparece no corpo do PR**, escrita como um revisor sênior mencionaria de passagem, sem checklist e sem seção rotulada. **Filtro obrigatório** (em `reviewFormatBlock`): ressalva TÉCNICA sobre o código entra no corpo; ressalva OPERACIONAL do nosso fluxo NÃO entra e fica só em `reasons`/`attention` (card não confirmado por falha de acesso ao Jira, review que não era pedido a mim, discordância com outro review, política de conta, cobertura incompleta), porque é assunto interno e citar vazaria a automação.

   **Cobertura da leitura é gate (v2.26.0).** Motivo medido em 29/07/2026 sobre 44 reviews reais: o tamanho do PR varia 4359x no histórico e o esforço visível do review varia 3x; a correlação entre linhas do diff e âncoras `arquivo:linha` é **r = -0,08**, ou seja, nenhuma. Nos PRs acima de 2000 linhas, 3 de 5 saíram sem uma única âncora, e o #688 (74 arquivos, 8717 linhas) auto-aprovou com relatório de tamanho médio, zero âncora e zero achado. Conclusão: "nenhum achado" era indistinguível de "li 20% e não vi nada". Agora o envelope carrega `coverage: {total, reviewed[], missing[]}` e `coverageGap(result)` segura a postagem automática (approve E reject) quando falta arquivo, mandando pra decisão humana com a lista. **Dois eixos separados, não confunda:** ressalva é o que a revisão ENCONTROU (não bloqueia), cobertura é o que ela conseguiu LER (bloqueia a postagem sozinha, porque sem leitura completa não há prova). A rede de segurança também pega `reviewed.length < total` mesmo com `missing` vazio. Envelope sem `coverage` (passe único) devolve `[]` e nada muda.

   **Fan-out em PR grande (v2.26.0).** Acima de **1000 linhas OU 20 arquivos** (limiar medido: pega 28% dos PRs do histórico, 7 de 25), o engine mede o PR com uma chamada `gh pr view --json additions,deletions,changedFiles,files`, monta 2 a 4 **lotes** por afinidade de caminho (`planLotes`) e injeta o instrutivo. A sessão principal então dispara **um subagente `pr-reviewer` por lote, em paralelo** (ela já disparava um; agora dispara N), cada um lendo por completo só os arquivos do seu lote e **ciente dos caminhos dos outros lotes** (pra sinalizar dependência cross-lote sem afirmar defeito em arquivo que não leu). A consolidação é na própria sessão: dedup por `arquivo:linha`, resolução das suspeitas cross-lote e **o gate dos 8 blockers aplicado UMA vez** sobre o conjunto (a decisão continua num lugar só). Falha na medição degrada pro passe único de sempre, que é sempre seguro. **`planLotes` DESCE por profundidade de caminho, nunca sobe pro pai:** a 1ª versão fundia o menor grupo no diretório pai e a validação com o #688 real reprovou (cascateava até a raiz e um lote ficava com 53 dos 74 arquivos, recriando o problema). Fundir os dois menores entre si mantém o equilíbrio. **Aritmética conhecida:** com teto de 4 lotes, um PR de 8717 linhas ainda dá ~2200 linhas por lote; subir o teto custa quase nada em tokens (o total de linhas lidas é o mesmo, muda só o overhead por subagente), então se a cauda de PRs gigantes incomodar, o caminho é `MAX_LOTES`.
   **ATENÇÃO, e é a parte mais importante deste parágrafo: até a v2.27.0 nada disso rodou.** A fachada `Engine.headlessPromptFor` declarava `(url, author)` enquanto a implementação em `lib/engine/review.js` recebe `(engine, url, author, lotes, metrics)` e o chamador em `runHeadlessReview` passava os quatro. Os dois últimos eram engolidos pela fachada, chegavam `undefined`, e `fanOutBlock` nunca era concatenado: o Farol media o PR, montava os lotes e **jogava o plano fora**, seguindo no passe único. Todo o módulo `fanout.js` e a bateria de testes dele estavam verdes porque testavam as funções puras, não o caminho até o prompt. Corrigido na **v2.28.0**, com os dois lados travados em teste: o comportamento (o bloco chega no prompt) segue em `test/review-prompt.test.js`, e a **aridade das fachadas** MUDOU DE CASA na onda 3. Hoje ela vive em `test/facades.test.js`, que **deriva do fonte** em vez de manter tabela curada: faz parse do `server.js` como texto, casa cada fachada de uma linha e compara o `Function.length` dela com o da implementação, descontando o slot do `engine`. Fachada nova passa a ser coberta sozinha, sem ninguém precisar cadastrar. Os dois casos que o cálculo não alcança (parâmetro desestruturado com default, que zera o `Function.length`, e a fachada que liga `this.usage` como segundo argumento) estão no mapa `EXCECOES` daquele arquivo, e o teste reprova se um deles sumir. Consequência prática de ter corrigido: PR grande passou a custar bem mais tokens, porque agora ele é de fato lido inteiro. Fachada nova que carregue argumento de comportamento entra naquela tabela.

## Conclusão da revisão

O parser de revisão aceita JSON bruto ou um único bloco explicitamente `json`, sem confundir chaves de templates na prosa com o início do objeto. Blocos ambíguos ou inválidos continuam recusados. Uma resposta só de progresso não é uma decisão: sem resultado estruturado a revisão permanece não concluída e não pode postar nem ser retomada automaticamente para repetir uma ferramenta recusada. O protocolo exige o envelope com `analysisStatus: "incomplete"` quando alguma verificação necessária não puder terminar.

## Motivo é OBJETO: o unwrap tem UM endereço (v2.51.1)

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

## A garantia mora no estrangulamento, não no chamador (v2.51.1)

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

## Justiça de fila entre orgs e contas (v2.58.0)

Spec: `docs/superpowers/specs/2026-09-10-justica-de-fila-entre-orgs-design.md`.

**O invariante que manda nas três políticas: elas são WORK-CONSERVING.** Se existe PR
elegível esperando e existe slot ou cota disponível, alguma revisão dispara. Nenhuma
política pode deixar recurso ocioso pra "guardar a vez" de quem não chegou. É a regra
do Wanderson (10/09/2026) escrita como invariante: *com fila, divide; sem fila, o que
chegar é atendido.* Quem mexer aqui e sentir vontade de segurar uma vaga vazia está
quebrando a feature, não melhorando ela.

**Segundo invariante: justiça mexe em ORDEM e ADMISSÃO, nunca em VEREDITO.** Nada deste
bloco toca `verdict`, `decision`, `cardMet`, `shouldAutoApprove`, `shouldAutoReject` ou
o corpo postado. Um PR atendido mais cedo ou mais tarde recebe exatamente a mesma
revisão. É o que mantém o invariante 4 ("nada é postado no GitHub sem gate") intacto.

**Política 1, rodízio por org** (`proximoHeadless`/`headlessOrg` em `lib/engine/review.js`).
O escalonador já isolava por CONTA (`headlessBusyAccounts`), então contas diferentes
NUNCA disputaram slot entre si; o que não existia era divisão entre as ORGS de uma mesma
conta, e ali a escolha era FIFO puro. Agora, entre os ELEGÍVEIS (conta abaixo de
`parallelReviews`), ganha a org de menor `seq` em `engine.orgLastStart`; org ausente do
Map (nunca atendida) vale `-Infinity` e ganha de todas; empate resolve por ordem de
chegada, o que faz uma org só se comportar exatamente como antes da feature.

A ordem é por CONTADOR MONOTÔNICO (`engine.headlessSeq`) e **não por relógio**:
`Date.now()` tem granularidade de milissegundo e o escalonador dispara várias revisões
no mesmo tick, então o empate de relógio apagaria a alternância justamente no lote que a
feature existe pra resolver. O `at` guardado junto é só pra tela dizer "atendida há 12
min"; ele nunca decide a vez. `orgLastStart` é EFÊMERO como o `headlessBusyAccounts`:
persistir a última org atendida faria o primeiro PR depois de um restart herdar uma
dívida de ontem, e o app abriria já devendo a vez pra alguém.

**Política 2, cota de conta dentro do perfil** (`quotaStatusFor`/`accountSpendInProfile`
em `lib/engine/usage.js`, `quotaBlockedFor`/`contasDoPerfil` em `server.js`). O teto de
orçamento sempre foi do PERFIL: duas contas no mesmo `claudeProfileId` dividiam um teto
único, a de alto volume queimava a cota do dia sozinha, e a outra era barrada no gate de
enfileiramento sem NUNCA ter tido uma revisão. Pior, o toast falava do perfil, então nem
dava pra ver quem consumiu.

A cota é o teto do dia rateado por peso (`accounts[].budgetWeight`, default 1) entre as
contas ATIVAS (não silenciadas, com `autoReview` ligado) daquele perfil. **A cláusula
que faz a feature ser o que é: a cota só barra quando existe OUTRA conta do mesmo perfil
esperando na fila E que ainda cabe na cota dela.** Sem disputa, quem chegou é atendido
até o teto duro, como sempre. Ceder pra quem também estourou não devolveria a vez a
ninguém, só deixaria o teto sem gastar, que é exatamente o que o invariante proíbe.

O teto DURO do perfil (`profileBudgetStatus`) continua valendo por cima e é avaliado
ANTES: perfil estourado barra todo mundo, e essa é a mensagem certa. A cota é um segundo
motivo, mais cedo e mais seletivo. **Nada aqui fura o teto.**

`waiting` (quem está esperando) sai da fila VIVA e de propósito NÃO reconsulta o gate de
orçamento: isso recursaria, porque o gate é justamente quem chama `contasDoPerfil`. Os
filtros ali são os baratos e síncronos do `toReview`.

`budgetWarned` guarda DOIS formatos desde aqui: `idDoPerfil` (teto duro) e
`idDoPerfil|conta` (cota). A reconciliação no topo do `check()` trata os dois no mesmo
laço; tratar a chave composta como id de perfil não acharia perfil nenhum, o aviso sairia
do Set todo ciclo e o toast repetiria sem parar, que é o barulho que o Set existe pra
impedir.

**Política 3, teto global** (`globalParallelLimit`, `config.globalParallelReviews`).
Limita o TOTAL somando todas as contas. **Default 0 = desligado**, o comportamento de
sempre. Clampa 1..8 no consumidor além do saneamento (defesa em profundidade, padrão do
`parallelLimit`), e negativo vira 0 e não 1: config torta não pode LIGAR uma trava que
ninguém pediu. **Só é seguro porque a Política 1 existe:** teto global sozinho concentra,
porque quem tem mais PR na fila ocupa o teto inteiro; com o rodízio decidindo quem ocupa
cada vaga liberada, ele vira distribuição de vazão em vez de corrida.

**Visibilidade é parte da feature, não enfeite** (`filaJusta()` no snapshot,
`filaJustaHtml` em `ui/pure.js`, painel na aba Consumo). Mesma lição do estacionamento
visível (v2.57.4) e do rastro durável do gate de orçamento: uma automação que CEDE A VEZ,
vista de fora, é idêntica a uma automação QUEBRADA. Nos dois casos o PR fica parado e
nada explica. O aviso de cota nomeia os dois lados (quem cedeu, pra quem, quanto falta) e
tem rastro no log, não só toast. O painel decide a própria vaziez: uma org e um perfil só
não têm rodízio a explicar, e o card some inteiro.

**Clique explícito atravessa e DESFAZ** (`pr.manual`, `origem: 'clique'` na rota):
quem mandou revisar foi você, sabendo que outra pessoa está lá, e a partir daí o
app volta a agir no PR. Mesmo espírito do estacionamento (lançar tira de lá).
Travado em `test/saida-de-cena-estrangulamento.test.js`.

## Aprovação não é fungível: o CODEOWNERS entra no gate (v2.51.0; SUPERADA em 28/08/2026)

**Nota de 28/08/2026: a cobertura de exigência foi SUPERADA pela regra plana**
(ver "As duas decisões de 28/08" abaixo): ver alguém revisando sempre segura o
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
  **Ela CADUCA desde a v2.54.3, e isso não é detalhe:** o finally não roda
  quando o processo morre (queda de renderer, kill, reinício do auto-update), e
  label presa não tinha relógio nenhum, então um Farol morto calava a frota
  inteira naquele PR para sempre (as refs da v2.53.9 já caducavam em 1h; a label
  não). Duas frentes: quem LÊ usa `labelVistaDesde` (relógio LOCAL de há quanto
  tempo ESTA cópia vê a mesma label, carimbado uma vez por ciclo em
  `marcarLabelsVistas`, com validade de `SINAL_REVISAO_TTL_MS`; sem carimbo a
  label VALE, porque falta de dado nunca libera revisão sozinha), e quem ESCREVE
  limpa no boot as próprias labels presas (`limparLabelsOrfas`, sobre a lista
  que o `recoverInflight` recuperou).
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
  PR+head. **INVARIANTE (v2.54.3, bug de campo): bloqueio NÃO grava a âncora
  do `reReviewLaunched`.** Até a v2.54.2 o `launchReReviews` gravava a âncora de
  todos os alvos ANTES do gate, pra não reconsultar o mesmo head a cada ciclo;
  como a âncora é o que o `classificaReRound` lê pra dizer "esse head já teve o
  round dele", um bloqueio momentâneo matava o relançamento automático PARA
  SEMPRE naquele head e o PR passava a depender de clique. Mesma classe do G7 do
  `recoverInflight`, que já tinha fechado o caminho do crash. A âncora agora só é
  gravada por round CONSUMIDO (relançado, ou pulado pelo `pushTrivial`), e o
  custo de gh fica em `bloqueioConsultado`: memória em processo, janela de
  `HEAD_QUIETO_MS`, que adia a reconsulta e nunca mata o round.
  **Regra geral: âncora que impede repetição só se grava depois de o trabalho
  acontecer; antes disso ela não é dedup, é cancelamento silencioso.** Head novo zera o histórico e a automação volta. Falta de dado
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

**Teto diário local: REMOVIDO na v2.59.3** (existia desde a v2.53.0 como
`MAX_RODADAS_AUTO_DIA`, 3 por PR por dia, com `reReviewEsgotados`/`avisoRodadasDia`).
Pedido do Wanderson, 15/09/2026: o 4º push do dia virava clique obrigatório até
amanhã, anunciado por um toast de 5 segundos. No lugar entrou a contagem de
**rodadas presas em sequência** (seção "Card que se explica" abaixo). A âncora
`reReviewLaunched` segue `{ head, dia, rodadas, at }` (`at` novo na v2.59.3, quando o
round saiu); `dia`/`rodadas` continuam gravados por compatibilidade com a âncora do
reinício, mas nenhum gate lê mais o contador. **O teto COMPARTILHADO entre aparelhos
(`SYNC.DAILY_ROUNDS_MAX`, D13) NÃO mudou**: é contrato da sincronização e só vale com
ela ligada; lá o esgotado vira espera da coordenação e o card mostra "outro aparelho
seu está cuidando deste PR". Alinhar os dois exige revisar o contrato D13, e ficou fora.

**Gatilho B NUNCA entra no pulo de push trivial** (`pushTrivial`, mesmo arquivo): a
prova salva que o pulo compara é do head ANTERIOR ao bloqueio, e o payload da
pendência já está ancorado nesse head velho. Pular ali recriaria o deadlock que
esta feature existe pra matar: um toast de "a revisão anterior segue valendo" sem
NENHUMA revisão de fato postada, com a âncora já queimada pro head novo. Só a
sessão relançada produz payload postável no head atual.

`explicaReRound`, `classificaReRound` e `reReviewTargets` continuam SÍNCRONAS e
sem IO, mesmo contrato de sempre; `reReviewTargets` devolve CÓPIAS RASAS (nunca o
objeto do panorama, que `_headRound` mutaria em compartilhado).

**Dívidas conscientes que ficam por decisão** (as três de orçamento/reinício da
leva original foram resolvidas na v2.53.1: `headQuietoDesde` (e o `avisoRodadasDia`, que saiu na v2.59.3)
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
  o pior caso é relançar um pouco cedo, nunca com head errado. (Desde a v2.59.3 o
  destrave carimba `headQuietoDesde` na pendência PRESA quando vê commit novo, e o
  relógio usa o mais novo dos dois; a pendência que ainda não rodou segue no `createdAt`.)

### Card que se explica e estado novo que destrava (v2.59.3)

Caso de campo: Edicoes-CNBB/biblioteca-cnbb-api#22, 09/09/2026. Force-push às 19:39
com a sessão lendo o PR, card `stale_head` às 19:42 pedindo "Peça uma revisão nova", e
às 19:44 a pergunta "Farol travou aí?". Não tinha travado: o gatilho B só podia armar às
19:47, e o review no head novo saiu às 19:54. O defeito era a tela pedir ação humana no
caso em que o app ia agir sozinho. A pergunta seguinte ("se eu pedir revisão de novo, o
outro Farol executa ou trava?") levou a três travas REAIS, reproduzidas em teste antes do
conserto (`test/rereview-estado-novo.test.js`): (1) rodada relançada que não conclui
deixa a âncora == `blockedHead` pra sempre, e o `blockedHead` nunca acompanha o head;
(2) estacionamento só saía por clique; (3) Pular nunca volta, porque o `markReRequests`
não conta Pular como revisado (isso continua certo lá: nada foi postado).

Peças:

- **`explicaReRound`** (`review.js`) substitui o miolo do `classificaReRound`, que virou
  fachada do contrato antigo ('relanca' | null). Cada uma das saídas silenciosas tem nome:
  `sem_gatilho` | `revisando` | `parado` com `motivo` (rascunho, auto_desligado,
  conta_silenciada, sem_token, orcamento, estacionado, outros_revisando, saiu_de_cena,
  coordenacao, pendencia_viva, ancora) | `aguardando`/`espera_longa` com `aPartirDe` |
  `relanca`. A ordem das travas não muda desfecho (todas seguram), só qual motivo a tela
  vê primeiro.
- **`reRoundParaUi`** vai no snapshot como `reRounds` (mesmo padrão do `parkedParaUi`):
  só pendências `stale_head`. `relanca` vira `aguardando` com `nextCheckAt` (quem dispara
  é o ciclo), ou `parado`/`consciencia` quando o `bloqueioConsultado` barrou este head.
- **Rodadas presas**: `recordDecision` grava `rodadasPresas` na pendência `stale_head` que
  nasce de sessão (herda a da pendência que substitui, +1; outro desfecho não carrega e a
  sequência recomeça). Com `rodadasPresas >= MAX_RODADAS_PRESAS` (3) a espera do gatilho B
  passa a `TEMPOS.HEAD_QUIETO_LONGO_MS` (30 min). Nunca vira clique.
- **`lib/engine/destrava.js`** roda no `check()` ANTES do `_dispararAutomacoes` (o toReview
  do mesmo ciclo já vê o PR de volta). Ver a linha dele no [mapa de arquivos](../CLAUDE.md#mapa-de-arquivos). Pra pendência
  presa: tira do estacionamento (se não foi cancelamento), solta o `head` da âncora (mesmo
  movimento do G7 do reinício), leva o `blockedHead` pro head do push e carimba
  `headQuietoDesde`. `estacionar` passou a gravar o `head` lido (quinto argumento), que é o
  que prova commit novo depois de uma parada.
- **Card** (`staleCardMeta`/`reRoundStatus` em `ui/pure.js`): barra azul (`working`) quando o
  Farol vai agir, âmbar quando precisa de você; selo "COMMIT NOVO"; sai Aprovar/Pedir
  mudanças/Só comentar (payload ancorado no head velho, o GitHub recusaria); a "regra do
  app" (motivo `gate`) sai porque repetia a caixa; **Revisar agora** é secundário quando o
  Farol já vai agir, primário quando parou, e some com a revisão rodando. Desenho no Claude
  Design: https://claude.ai/artifact/1c2yxcUa3BtGEycq5Q695w. O toast de pendência nova
  deixou de dizer "precisa da sua atenção" quando o motivo é commit novo.
- **FAQ no README** ("Perguntas frequentes: commit novo durante a revisão") descreve cada
  cenário pra quem usa. Mexeu num motivo ou num tempo daqui, atualize a FAQ junto.

Dívidas conscientes: PR fora do panorama não tem `updatedAt` e fica fora do destrave (a
fila mine entra no panorama, então o caso real é coberto); o marcador `destravados` só
poda quando o PR sai do panorama e da mesa.

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
  **Desde a v2.57.4 o estacionamento tem MOTIVO, HORA e uma terceira metade na poda.**
  Caso medido (biud-core#317, 03/09/2026, no Farol de um colega): a sessão abriu às
  13:14:55 (label `<conta>:revisando`), morreu às 13:21:56 sem postar, o PR voltou pra
  "Sua fila" com o botão Revisar e NADA na tela dizia o que tinha acontecido; o toast
  morre em cinco segundos, o `snapshot` não carregava o estacionamento e o card era
  idêntico ao de um PR nunca revisado. Duas horas parado enquanto o mesmo Farol
  revisava os vizinhos. Agora: (a) os QUATRO pontos de estacionamento passam por
  `estacionar(engine, key, motivo, tipo)` em `review.js` (tipo em `cancelado` |
  `esgotado` | `falha` | `orcamento`), que grava `parkedMotivos[key] = { at, motivo,
  tipo }` no MESMO arquivo (`{ keys, motivos }`; a lista crua antiga continua lida, sem
  motivo, e motivo órfão de key que não está no Set morre no boot); (b) `desestacionar`
  é o único caminho de saída e apaga o motivo junto (launchReview e a poda); (c) o
  `snapshot` leva `parked` (allowlist `at`/`motivo` cortado em 200/`tipo`, só das keys
  no Set, via `parkedParaUi`; desde a v2.57.5 key sem motivo, estacionada pelo arquivo
  antigo, sai como tipo `legado`, senão o estoque anterior seguia invisível) e
  `queueCardHtml` desenha `parkedNoteHtml` embaixo do título; (d) a poda exige `PARKED_PRUNE_STRIKES` (2) ausências SEGUIDAS do panorama,
  pela mesma razão da `SELF_PRUNE_STRIKES`: o `gh search` é índice e índice atrasado
  responde `ok` sem o PR aberto, e aqui a poda errada relança sessão paga (leitura mais
  provável das 7 linhas ERROR do biud-esg#268 em 83 minutos no mesmo dia, sem commit
  novo). Contagem em memória; reinício zera e a key sobrevive dois ciclos a mais, o lado
  seguro. Junto entrou a classe `provedor-indisponivel` em `lib/log-taxonomy.js` (5xx da
  API de IA, "Overloaded"): era `desconhecido` -> permanente -> estacionava; o próprio
  texto do provedor diz "usually temporary". Travado em
  `test/estacionamento-visivel.test.js`.
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

## Autoanálise: parecer do modelo x decisão do app (P0a v2.54.8, P0b v2.55.0)

**O defeito de origem, e ele era de AUTORIDADE, não de qualidade da análise.** Até a
v2.54.7 o único gate de qualidade de todo o caminho do `mergeSelfPR` era
`analysis.approvable !== true`, um booleano produzido pela sessão de IA, e o MESMO gate
servia o `--admin`, que bypassa branch protection: a proteção do repositório deixava de
ser a segunda barreira justamente onde a decisão de qualidade era a mais fraca. A regra
vivia copiada em QUATRO sítios (gate do merge, filtro de alvos do `refreshMergeStates`,
fetch pós-análise e o `canMerge` da UI), e foi essa duplicação que criou porta lateral:
fechar só a porta do merge deixaria as derivadas de pé. **Antes de mexer num gate,
mapeie todos os consumidores do campo**; corrigir só a porta que você achou não fecha
nada.

**A regra que substituiu.** O `self-review.md` produz PARECER; o Farol produz a DECISÃO
operacional. `evaluateQualityEligibility(analysis, observed)` é a fonte única, e as duas
entradas têm autoridades diferentes:

| ENGINE (`observed`) | MODELO (`analysis`) |
|---|---|
| `headSha` analisado | `blockers`, findings |
| `sessionOutcome` (fluxo de controle real) | `cardMet` (interpretação do requisito) |
| `scope.total` (escopo medido) | `verdict`/`approvable` (parecer) |
| `scope.reviewed` (leitura OBSERVADA) | `coverageLimitations` |
| `verification` (checkpoint da loja `self`) | |

**O modelo só REDUZ cobertura, nunca amplia.** `coverageLimitations` subtrai do que o
engine observou. Não existe campo que some, e é por isso que `coverageClaimed` (se vier
no envelope) não é lido em lugar nenhum: a direção da autoridade é estrutural, não uma
regra que alguém precisa lembrar de respeitar.

**Álgebra.** Acumula razões e decide no fim, nunca retorna no primeiro `if`:
`ineligible` (evidência CONTRA) > `inconclusive` (evidência FALTANDO) > `eligible`.
Quatro valores por dimensão (`satisfied`/`unsatisfied`/`unknown`/`not_applicable`),
porque sobrecarregar `inconclusive` apagaria a diferença entre requisito REPROVADO e
requisito NÃO LIDO. `reasons` é `{code, detail}`, contrato de máquina; quem escreve a
frase é `ui/pure.js` (`qualityReasonLabel`/`qualityBlockTitle`). Engine não escreve copy.

**`quality` é DERIVADO e NUNCA persistido** (`projectSelfAnalyses` calcula a cada
snapshot). Gravado em disco, um registro carimbado `eligible` sobreviveria à evidência
que o justificava. O disco guarda parecer bruto + `observed` bruto.

**Como a cobertura virou observável (achado do preflight do P0b).** O protocolo lia um
`.patch` ÚNICO, então `Read` por arquivo nunca acontecia e observar "Read · caminho" não
cobriria nada. Agora o engine ESCREVE o patch de cada arquivo sob
`state/pr-scope/<enc(key)>` (`lib/engine/pr-scope.js`) e o prompt manda ler dali:
`Read` por arquivo passa a ser o mecanismo real e o mapeamento caminho-lido ->
caminho-do-PR é `path.relative`, não heurística. `observarLeitura` (session.js) conta
também leitura de SUBAGENTE (o fan-out lê nos subagentes; exigir a sessão principal
zeraria a cobertura de PR grande) e o Set deduplica sozinho.

**LIMITE HONESTO, declarado e não resolvido:** `Read` observado prova que o conteúdo foi
ENTREGUE ao agente, nunca que ele raciocinou bem sobre aquilo. O que isto elimina é a
classe "o modelo afirmou ter coberto o que o engine nunca observou". A classe "abriu e
raciocinou mal" continua viva e não tem solução por instrumento.

**Freshness são DUAS provas diferentes, e nenhuma substitui a outra.** `EVIDENCE_STALE`
(em `evaluateQualityEligibility`) prova que a evidência pertence ao conteúdo analisado
(`observed.headSha === analysis.headSha`, ausência de qualquer lado também reprova); o
gate G3 do `mergeSelfPR` prova que esse conteúdo ainda é o atual no instante do merge.

**Checkpoint: o gate deixou de ser o MODO.** Era `review.mode !== 'auto'`, e por isso a
autoanálise nunca produzia verificação capturável, justamente o caminho que autorizava
merge. Hoje a propriedade é explícita: `review.checkpoint` carrega a LOJA que a sessão
alimenta (`'review'` | `'self'`); ausente = não participa (terminal, chat, ferramenta).
`checkpointPath(prKey, escopo)` separa as lojas, e a separação não é cosmética: sem ela,
a análise que EU fiz do MEU PR alimentaria o gate de uma revisão feita por outra conta.

**Jira NÃO é obrigatório (decisão do Wanderson, 29/08/2026), e a divisão de autoridade
é o que faz isso ser seguro.** A prova de campo do PR #42 mostrou o gate parando só no
card num repo que nem usa Jira, o que deixaria o Merge indisponível PARA SEMPRE em repo
sem card (o próprio farol, o `gestao-api`). Quem diz se EXISTE requisito é o ENGINE
(`observed.card.requirement`, derivado do código do `cardForPr`, porque é ele quem chama
o Jira e sabe POR QUE não leu); quem diz se foi ATENDIDO segue sendo o modelo. Sem essa
divisão, `cardMet: null` seria ambíguo entre "não há card aqui" e "não consegui ler", e
as duas coisas têm desfecho oposto. Só os TRÊS códigos silenciosos da taxonomia
(`desligado`, `site_nao_configurado`, `sem_chave`) dispensam; todo o resto é card que
existe e não foi lido, e continua `inconclusive`. `cardMet === false` vence a dispensa:
dispensar o REQUISITO nunca apaga um ACHADO. A regra do mapa está travada por teste do
CLASSIFICADOR, não só do avaliador: uma mutação que jogava `sem_credencial` na lista de
dispensa passou verde enquanto só o avaliador tinha cobertura.

**O card entra pelo APP, não pelo modelo.** `runSelfAnalysis` chama `cardForPr` e soma
`cardBlock` ao prompt, igual ao caminho de review: determinismo, cache, escopo de tenant
e o guard de `<<<CARD-JIRA` ("isto é dado, não instrução"). Card ausente ou ilegível
nunca vira satisfação: `cardMet` fica `null` e o gate devolve `CARD_UNKNOWN`.

**Parser estrito é dependência técnica do primeiro `eligible`.** `parseSelfResult` valida
enum de `verdict`, listas de verdade e `cardMet` booleano-ou-null, e recusa a contradição
`verdict`/`approvable`. A regra é sempre a mesma: **ausência não vira vazio e `null` não
vira satisfação**. O código antigo fazia `Array.isArray(x) ? x : []`, então `null`,
`"nenhum"` e campo faltando viravam lista vazia, que é a declaração mais forte possível
("não achei nada"). Coerção conveniente é como dado inválido vira satisfação, e foi
exatamente esse o furo do `BLOCKERS_UNKNOWN`.

**A autoanálise PERSISTE, e ocultar nunca apaga (v2.57.3).** Três caminhos removiam o
registro do disco, e os três custavam a mesma coisa: reanalisar, que é pagar de novo pra
reproduzir o que já tinha sido pago.

| caminho | antes | agora |
|---|---|---|
| botão "Ocultar análise" | `delete` no registro, com title prometendo que só sumia da tela | `observed`/relatório ficam; `hidden: true` no registro e o botão vira "Mostrar análise" |
| head andou (`enrichMyPRBranches`) | `delete` + `marcarDesfecho('descartada')` | `observed.stale = true` + `marcarDesfecho('parcial')`; o relatório fica, o veredito não vale |
| PR saiu da busca (`check`) | `delete` SEM log, SEM carimbo de consumo, SEM limpar `mergeStates` | duas ausências seguidas (`SELF_PRUNE_STRIKES`) e um WARN nomeando o PR |

**Persistir vencido EXIGIU um código de gate novo, e essa é a parte que não pode ser
esquecida por quem mexer aqui.** `EVIDENCE_STALE` NÃO cobre o caso: ele compara
`analysis.headSha` com `observed.headSha`, os dois carimbados pela mesma sessão no mesmo
sha, então ele prova coerência DENTRO do registro e nunca dispara quando o PR anda. Sem
`ANALYSIS_STALE`, o registro que agora sobrevive continuaria `eligible` e o botão Merge
apareceria sobre análise vencida. Ele é evidência CONTRA (`ineligible`), não faltando: o
engine não deixou de medir, ele mediu o head mudar. E o carimbo mora em `observed` porque
é medição do ENGINE, que é o lado do gate; campo solto no registro seria o modelo e o
engine escrevendo no mesmo lugar.

**`hidden` é preferência de leitura e não entra em gate nenhum**, de propósito e travado
por teste: recolher um parecer da tela não muda o que ele comprova, e ligar as duas coisas
daria a uma escolha visual autoridade sobre merge.

**O WARN sai UMA vez** (`marcarDesatualizada` devolve false se já carimbado): o
`farol.log` é de falha, não de estado (invariante 3), e reescrever a mesma linha a cada
ciclo de polling inundaria o Diagnóstico.

**As duas ausências da poda não são zelo, são medição.** `gh search prs` é ÍNDICE, não
estado: ele responde `ok` com resultado incompleto quando o índice está atrasado, e a
trava de "só poda conta que respondeu" (G5) passa nesse caso. Uma ausência não distingue
"o PR fechou" de "o índice piscou"; duas custam um ciclo de polling e cobrem a flutuação
observada. A contagem é em memória: reinício zera e a chave sobrevive dois ciclos a mais,
que é o lado seguro.

**Fan-out NÃO é requisito.** A invariante é cobertura demonstrável: PR grande que o
mecanismo não cobrir devolve `COVERAGE_INCOMPLETE` e o merge simplesmente não fica
disponível. O sistema está correto sem fan-out.

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

### Retomada após falha transitória (v2.57.3)

Sessão que cai no meio da revisão (rede ou tempo esgotado) já leu o PR, e relançar do
zero pagava de novo o que já tinha sido lido. Peças:

- `lib/log-taxonomy.js` ganhou a classe `tempo-esgotado` (transitória, teto de 30 min),
  e a classe `rede` passa a casar também o sufixo "após N tentativa(s) de reconexão com a
  API" que `session.js` (`runClaudeStream`) anexa à mensagem quando a sessão emitiu
  eventos `api_retry` antes de morrer. Esse sufixo é o que liga a morte pós-retry à classe
  `rede`. Todo caminho de erro do `runClaudeStream` também anexa `err.sessionId`.
  **O sufixo só cobre a morte que veio DEPOIS de reconexão visível.** O `result` com
  `is_error` ("sessão retornou erro: API Error: 529 Overloaded...") chega sem sufixo e
  caía em `desconhecido` -> permanente -> estacionamento; desde a v2.57.4 a classe
  `provedor-indisponivel` (5xx e "Overloaded", transitória) fecha esse caso, e a
  retomada por sid vale igual. `JSON da sessão fora do contrato` continua permanente
  de propósito: uma sessão que TERMINOU bem e devolveu envelope inválido não é
  instabilidade, e relançar três vezes pagaria três sessões pra reproduzir o mesmo
  defeito de prompt; o que mudou é que agora o card mostra que ela estacionou e por quê.
- O sid é capturado no início da sessão (`opts.onSession`, primeiro `session_id` do
  stream), gravado no registro da revisão ativa e gravado em `state/inflight.json`
  assim que nasce (o `onSession` dispara uma vez, no primeiro evento que traz
  `session_id`), não só no fim. Desde a A5 a referência mora em `engine.retomadas`
  (ver "Retomada durável" logo abaixo): o boot restaura e regrava, e `enqueueHeadless`
  só LÊ, carimbando `retomarSid` e `knownHead` no PR quando ele reaparece na fila. Falha
  transitória em pleno voo grava a mesma referência, além do `retryAfterNet`.
- `sidDeRetomada` (`lib/engine/review.js`) decide o sid do `--resume`: `retomarSid` tem
  precedência sobre `resumeSid` e não depende de `config.reReviewResume` (é a mesma
  revisão retomando, não o opt-in do round incremental), sempre validado por
  `RESUME_SID_RE`. Desde a A5 quem decide é `validarRetomada`: head salvo ausente
  descarta, head atual não confirmado espera, e head diferente descarta. O `knownHead` que alimenta essa
  guarda existe em todo caminho, não só no relançamento da re-revisão: o
  `runHeadlessReview` estampa `pr.headLido` assim que resolve o head da rodada, o
  `prComRetomada` copia isso pro `knownHead` da entrada do `retryAfterNet`, e o boot
  guarda o head junto do sid (`headSha` e `knownHead` no `inflight.json` e na entrada de
  `engine.retomadas`), com o `enqueueHeadless` carimbando os dois. Campo próprio e não
  `knownHead` direto porque o objeto do PR atravessa rounds, e escrever `knownHead` ali
  contaminaria o fallback G8 do head da rodada seguinte.
- O bloco de prompt da retomada NÃO entra no prompt base: ele é passado à parte pro
  `rodarSessao` e somado só na tentativa com `--resume`. Quando o CLI recusa a retomada
  e a sessão degrada pra nova, o prompt sai sem o bloco (senão a sessão nova receberia
  ordem de não reler o que ninguém leu). A retomada vale pras revisões feitas pelo
  Claude, e não porque falte `--resume` ao Codex (o `codexArgs` aceita, virando `exec
  resume`): é que `opts.onSession` só é chamado no stream do Claude e o stream do Codex
  não estampa `err.sessionId`, então `retomarSid` nunca nasce nesse caminho.
- Sem sid recuperável, ou com o resume falhando, `rodarSessao` degrada pra sessão nova
  (comportamento de sempre), nunca vira erro.

### Retomada durável (A5 da operação multidispositivo)

Contrato: CT-RET da spec `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md`.

- **Uma fonte só:** `engine.retomadas` (`lib/engine/retomada-duravel.js`), key do PR para `{ key, url, title, author, kind: 'auto', estado, retomarSid, knownHead, provedor, perfilId, sessionId, headSha, atualizadoEm }`. O `inflight.json` é o espelho (`montarInflight`): execução vence fila, fila vence pendente, e a referência que não está em nenhuma das duas sai como `pendente`. O `retomadaPendente` em memória e o `inflight.json` esvaziado no boot deixaram de existir: o boot restaura e **regrava**, então dois reinícios seguidos não perdem a referência.
- **Só desfecho consome:** resultado da sessão, `--resume` recusado pelo CLI, descarte comprovado, recibo de outro aparelho, cancelamento, falha permanente, PR mergeado ou fechado. Enfileirar, esperar vaga, lease alheio, coordenação fora, orçamento e head não confirmado **mantêm**.
- **Validar antes de reutilizar** (`validarRetomada`): mesmo PR, contexto local igual (`provedor` = kind do auth resolvido, `perfilId`), nenhuma decisão do mesmo head criada depois da referência, head salvo presente, head atual **confirmado pelo GitHub** e igual. O head salvo e o `knownHead` do G8 são evidência da tentativa anterior, nunca confirmação: sem head confirmado a revisão espera no `retryAfterNet` sem gastar tentativa e sem abrir sessão. Descarte segue em sessão nova sem o bloco "não releia" e sem confirmação humana. Inflight legado da v2.57.3 não tem contexto e por isso não retoma.
- **Diagnóstico:** `resumeOutcome` em `'retomada' | 'recusada' | 'nova' | 'nenhuma'` no registro ativo, no `opts` do `runClaudeStream` e no `result` do `recordDecision`. O desfecho não vai pro `farol.log` (invariante 3); persistir em uso e decisão é da A1.
- **Escopo:** só o `retomarSid`. O `resumeSid` do round incremental segue opt-in e sem mudança.
