# Farol, guia do mantenedor

Leia isto antes de mexer em qualquer arquivo. Este documento existe pra que qualquer Claude Code (em qualquer máquina, Windows ou macOS) consiga manter o Farol sem quebrar os contratos do app.

<!-- indice:inicio (gerado; test/guias-navegaveis.test.js reprova se divergir das seções) -->

## Índice

- [Os guias operacionais](#os-guias-operacionais)
- [O que é](#o-que-é)
- [Mapa de arquivos](#mapa-de-arquivos)
- [Invariantes do projeto (não negociar)](#invariantes-do-projeto-não-negociar)
- [Como rodar e testar sem estragar nada](#como-rodar-e-testar-sem-estragar-nada)
- [Menções navegáveis (regra de usabilidade, v2.40.1)](#menções-navegáveis-regra-de-usabilidade-v2401)
- [Diagnóstico: ambiente x operação x runtime (v2.40.4, terceira dimensão na v2.53.3)](#diagnóstico-ambiente-x-operação-x-runtime-v2404-terceira-dimensão-na-v2533)

<!-- indice:fim -->

## Os guias operacionais

O conteúdo detalhado mora em quatro guias, que viajam junto com o app instalado:

| guia | assunto |
|---|---|
| [`docs/REVIEW-GATES.md`](docs/REVIEW-GATES.md) | o invariante 4 em detalhe: gates de postagem, dedup, re-revisão, autoanálise, checkpoint |
| [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) | assinatura e perfis do Claude, orçamento, modelo e esforço, Jira |
| [`docs/MACOS.md`](docs/MACOS.md) | macOS, Linux e os pontos com branch de plataforma |
| [`docs/RELEASE.md`](docs/RELEASE.md) | versionamento, checklist de release e governança do repositório |

A documentação de sincronização entre dispositivos ainda não viaja com o app: ela depende de
`firebase/`, que não faz parte da distribuição, e tem fase própria.

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
| `lib/http-guard.js` | **Allowlist de Host e Origin da API local** (C1a). `validarHostEOrigem({ host, origin, porta })` é PURA e o `startServer` a aplica antes de qualquer rota, estáticos e SSE inclusive, com a porta EFETIVA do socket (`server.address().port`), nunca a da config. Aceita só `127.0.0.1:<porta>` e `localhost:<porta>`, sem curinga; `Origin` ausente passa, presente tem que ser `http://127.0.0.1:<porta>` ou `http://localhost:<porta>`. Recusa é `403 { error: 'forbidden', motivo: 'host' \| 'origin' }`, sem cabeçalho CORS. Host permitido não é autenticação (isso é a A4); `x-farol` e `x-farol-review-cap` continuam como estavam |
| `lib/spawnlog.js` | Registro opt-in dos processos disparados (caça o "terminal piscando") |
| **`lib/local-auth/`** | **Autenticação da API local (A4): o núcleo existe, e a exigência automática no celular está LIGADA desde a v2.61.0** (`ATIVACAO_AUTOMATICA_A4 = true` em `lib/constants.js`, travada em teste, ligada por decisão do dono em 17/09/2026 antes da validação num Termux real; se a detecção do modo celular errar lá, a interface tranca e o desbloqueio é pelo terminal, com `node tools/farol-parear.js`). `config.localAuth: 'exigir'` (arquivo, nunca a tela) continua ligando a exigência também no desktop. `modo.js` (puro) decide modo celular e exigência sem olhar User-Agent; `pareamento.js` e `sessoes.js` guardam só hash em `~/.farol/local-auth/` com 0600 a cada gravação; `inventario.js` classifica cada rota `/api` (rota nova sem classe reprova em `test/local-auth-inventario.test.js`); `acesso.js` é o porteiro que o `http-server.js` consulta depois da allowlist de Host e do `x-farol`. Sem cookie: o token sai só no corpo de `POST /api/auth/pair` |
| **`lib/engine/`** | **Colaboradores da Engine: recebem o engine como contexto** |
| `lib/engine/review.js` | Revisão headless: fila por conta, escalonador paralelo (`processHeadless`), prompt (`headlessPromptFor`) e o ciclo de uma revisão |
| `lib/engine/decision.js` | O gate de postagem: `shouldAutoApprove`, `shouldAutoReject`, `coverageGap` (reexportada: a regra de cobertura mora em `lib/engine/file-proof.js`, junto da herança e do diff medido que ela confere), `checkpointGap`, `attentionPoints`, `postReview`, `decide`, capabilities das sessões interativas e projeção segura das decisões para a UI |
| `lib/engine/public-review.js` | Fronteira determinística entre diagnóstico interno e review: valida schema/linguagem de corpos e inlines, extrai review humano de registros legados e monta a allowlist enviada à UI |
| `lib/engine/skip-review.js` | **UM Farol por PR** (v2.50.1; regras reformadas em 28/08/2026, ver "As duas decisões de 28/08" em [`docs/REVIEW-GATES.md`](docs/REVIEW-GATES.md#as-duas-decisões-de-28082026-v2539-e-v2540-o-que-é-vazamento-e-o-que-não-é)). Ver o SINAL de outra pessoa (a label `<conta>:revisando`, que é o sinal escrito; ou ref de transição da v2.53.9) faz o Farol SAIR DE CENA naquele head, de forma DURÁVEL, SEMPRE (regra plana: caiu a exceção de CODEOWNERS da v2.51.0). `revisandoPorOutros` (labels) e `revisandoPorSinais` (refs de transição) são PURAS, `outrosRevisando` é a UNIÃO das duas e segue SÍNCRONA e sem IO (contrato do reReviewTargets), `saiDeCena` ancora por head e avisa por TOAST (desde 28/08/2026 nada é postado no PR), `standDownCaducou` é a rede de segurança (sessão do colega morreu sem review = volta a revisar), `coAssinar` é o opt-in que aprova em seu nome quando quem pegou aprovou, e `autoridadeNaSaida` responde só se EU sou autoridade (gateia a co-assinatura; falta de dado cai em true, o lado seguro). **Gate de consciência** (28/08/2026 à tarde; calibrado na v2.54.1): `bloqueadoPorHistorico` (reprovação de gente no head ativo, ou 2 aprovações humanas, seguram o automático; 1 aprovação não, a automática vale como a segunda) com boca única `bloqueiaAutomatico` (clique manual atravessa sem gh) + `avisaBloqueioHistorico`/`podarHistoricoAvisado` (toast único por PR+head). **`acrity` nunca conta como pessoa** (review de ferramenta não dispensa olho humano). Vale só no caminho AUTOMÁTICO: clique manual sempre revisa |
| `lib/engine/destrava.js` | **Estado novo destrava o que esperava clique** (v2.59.3). Commit novo ou pedido de revisão PRA MIM, posterior à parada, devolve aos caminhos automáticos três casos que ficavam presos pra sempre: pendência `stale_head` cuja rodada relançada não concluiu (âncora == `blockedHead`), revisão estacionada (exceto `cancelado`) e Pular num PR que segue pedindo minha revisão (exceto ignorado). Seleção SÍNCRONA gateada por `updatedAt`; só candidato real custa uma chamada `gh` (timeline) e, sem prova nela, uma de head. Marcador `state/destravados.json` impede o mesmo sinal de destravar duas vezes. Nunca posta nem lança sessão. Ver [Card que se explica e estado novo que destrava](docs/REVIEW-GATES.md#card-que-se-explica-e-estado-novo-que-destrava-v2593) |
| `lib/engine/review-signal.js` | **LEITURA DE TRANSIÇÃO das refs da v2.53.9** (28/08/2026). Por algumas horas a v2.53.9 escreveu o sinal de revisão em andamento como ref git `refs/farol/revisando/<pr>/<login>/<epoch-ms>`; a v2.54.0 devolveu a escrita pra label `<conta>:revisando` (decisão da tarde: label visível é desejada) e este módulo ficou só LENDO e coletando as refs até a frota convergir (remover no futuro). `refreshReviewSignals` roda no `check()` (uma chamada `matching-refs` com `--paginate` por repo de interesse por ciclo) e alimenta `engine.reviewSignals`; TTL de 1h dos DOIS lados do relógio (`TEMPOS.SINAL_REVISAO_TTL_MS`); GC apaga só ref órfã do passado; falha preserva o snapshot anterior. Também abriga `repoDoPr`/`numeroDoPr` |
| `lib/engine/codeowners.js` | **Quem é AUTORIDADE sobre cada arquivo do PR** (v2.51.0). Tudo PURO: `parseCodeowners`, `patternToRegex` (estilo gitignore), `ownersForPath` (a ÚLTIMA regra que casa vence, semântica do GitHub, NÃO acumula), `souAutoridade` e `cobreMinhaExigencia` (só saio de cena se quem pegou o PR é dono de TODO arquivo em que eu sou). Dono que é TIME (`@org/slug`) é inconclusivo e cai sempre no lado seguro |
| `lib/engine/fanout.js` | Fan-out de revisão em PR grande: mede o PR (`prMetrics`), decide se fatia (`shouldFanOut`), monta os lotes por afinidade de caminho (`planLotes`, função PURA) e injeta o instrutivo (`fanOutBlock`). Determinístico, ZERO IA e zero rede na parte que decide |
| `lib/engine/model-router.js` | **Roteador de modelo por custo-benefício** (quando `reviewModel === 'auto'`). PURA: sobe para o Opus pelo CONTEXTO do PR (repositório crítico, caminho sensível no estilo CODEOWNERS, PR muito grande; config `autoOpus`, saneada aqui a cada leitura) e, fora disso, escolhe haiku/sonnet (+ esforço/fast) pelo tamanho. `auto` nunca entra na cmdline do CLI |
| `lib/engine/session.js` | Sessões do Claude: headless (`runClaudeStream`, `buildModelFlags`), terminal por SO (`buildSessionScript`/`Mac`), cancelamento (`killTree`). É aqui que o marcador `FAROL_CHECKPOINT` é interceptado (ver [Checkpoint de verificação](docs/REVIEW-GATES.md#checkpoint-de-verificação-memória-entre-passadas-da-revisão-v2360)); é aqui também que o sid é capturado (`opts.onSession`) e o sufixo de reconexão é anexado (ver [Retomada após falha transitória](docs/REVIEW-GATES.md#retomada-após-falha-transitória-v2573)) |
| `lib/engine/verification-checkpoint.js` | Checkpoint de verificação da revisão headless: memória append-only por PR do que já foi confirmado contra o código (`checkpointPath`, `appendCheckpointEntry`, `readCheckpoint`, `summarizeCheckpoint`, `resumeBlock`). Só o ENGINE escreve, nunca a sessão; detalhe em [Checkpoint de verificação](docs/REVIEW-GATES.md#checkpoint-de-verificação-memória-entre-passadas-da-revisão-v2360) |
| `lib/engine/selfpr.js` | "Meus PRs": autoanálise (nunca posta), `setReviewers` e `mergeSelfPR` (as duas ÚNICAS escritas no GitHub partindo daqui, com os gates travados em `test/merge-gates.test.js`) e o **ocultar PR** (`hidePR`/`unhidePR`/`reconcileHiddenPRs`, estado em `state/hidden-prs.json`, travado em `test/hidden-prs.test.js`). Ocultar é 100% local e **temporário por natureza**: guarda o `updatedAt` do PR e o `check()` desoculta sozinho quando esse carimbo muda (atividade nova). O engine NÃO filtra `myPRs` (quem esconde é a UI, que também mostra os ocultos), e a limpeza de chave órfã é POR CONTA desde a v2.41.2 (`reconcileHiddenPRs(okAccounts)`): só limpa chave cuja conta dona respondeu à busca de PRs meus neste ciclo, senão a queda de UMA conta desocultaria (e apagaria autoanálise) das outras. Não confunda com `setSelfAnalysisVisibility`, que só recolhe a AUTOANÁLISE da tela (o registro fica no disco; ver "A autoanálise PERSISTE" em [Autoanálise](docs/REVIEW-GATES.md#autoanálise-parecer-do-modelo-x-decisão-do-app-p0a-v2548-p0b-v2550)) |
| `lib/engine/pushback.js` | Memória de contestação: quem entra no scan (`pushbackTargets`), detecção e classificação |
| `lib/engine/limite-plano.js` | **Limite do plano do Claude vale para a ASSINATURA, não para o PR** (21/09/2026). Por chave de assinatura (a mesma identidade de `resolveClaudeAuth`: duas contas do GitHub no mesmo perfil dividem a cota), guarda até quando ela está no limite, em `state/limite-plano.json`, porque reiniciar durante o limite disparava a fila inteira de novo. Consultado nos mesmos pontos do gate de orçamento (fila automática, boca da sessão, relançamento) e pela varredura de pushback; só registra com hora de reset conhecida, e uma sessão que dá certo libera. Clique manual atravessa (invariante 4). Nasceu de um aparelho já corrigido abrindo 12 revisões em 34 s, cada uma morrendo em ~4 s: a espera era por PR, e cada PR tinha de bater no limite para descobri-lo |
| `lib/engine/contas-config.js` | **A configuração das contas** (25/09/2026). A política efetiva de cada conta (`politicaDaConta`, `revisaSozinho`, `acaoAoAprovar`, `acaoAoReprovar`; os métodos do `server.js` são fachadas de uma linha), a edição por OPERAÇÃO (`aplicarEdicao`, rota `POST /api/accounts/edit`: a tela diz qual campo de qual conta mudou e o servidor aplica sobre a config atual, porque salvar a lista inteira que a tela tinha na memória apagava ou ressuscitava campo em todas as contas) e o rastro de toda mudança de política, de Contas ou de Automação, em `state/politica-historico.json` com data e origem (janela do Farol ou navegador). O motivo "a política manda aguardar" diz quando e de onde a configuração veio, e o Diagnóstico lista as mudanças recentes. Travado em `test/contas-respeitadas.test.js` |
| `lib/engine/gh-queries.js` | As buscas no GitHub (`searchPRs`, `myAuthoredPRs`, entregas) e os créditos do Sistema > Sobre (`refreshContributors`: contribuidores do repo do update, cache 24h, backoff de falha 1h) |
| `lib/engine/contas-gh.js` | **Contas do GitHub x contas do Farol** (v2.62.0). `gh auth status --json hosts` (a cada `TEMPOS.CONTAS_GH_MS`, sem o `GH_TOKEN` herdado) e `user/orgs` por conta (a cada `TEMPOS.ORGS_DA_CONTA_MS`); `diagnosticoDasContas` é PURO e devolve login não monitorado, conta sem login, org em duas contas e org sugerida (a de membro e a dos PRs pedidos à conta, que acha onde ela é só colaboradora). `avisarSemToken` faz "sem token no gh" virar uma linha por mudança de estado, não uma por ciclo. `atribuicaoDoPr` diz por que o PR ficou com a conta (`busca`, `org`, `unica` ou `reserva`); com duas ou mais contas, `reserva` recusa a postagem em `postReviewOnce`. A tela é `contasGhHtml` (`ui/pure/contas-gh.js`), no topo de Sistema > Contas |
| `lib/engine/chat.js` | Chat por PR (`--resume` da sessão), com o preâmbulo que proíbe postar sem pedido explícito |
| `lib/engine/tools.js` | Ferramentas internas (kudos, diagnóstico), com escopo por conta |
| `lib/engine/update.js` | Auto-update: comparação de versão, download da release e aplicação por SO |
| `lib/engine/usage.js` | Agregação do consumo (por dia, tipo, conta e modelo) + log permanente por sessão (`usage-sessions.json`, sem poda, com o campo `ref`). **FONTE ÚNICA da aba Consumo (v2.40.0)**: `usageSummary` entrega série diária, séries empilhadas e matriz JÁ RECONCILIADAS contra `days` (a fatia de um dia sem detalhamento vira a camada `_resto`, "Sem detalhamento"; invariante travado em teste: soma das camadas == série do dia), o orçamento por perfil (`budgets`, mesma conta do gate real, refeita a cada push; o doctor NÃO carrega mais gasto/bloqueio), `sessionsSince` e `retentionDays`. A UI só fatia janela e formata; não crie definição de dado (janela, métrica, teto) do lado de lá |
| `lib/engine/usage-tentativas.js` | **Diário de tentativas de sessão de IA** (A1). `abrirTentativa` grava em `state/usage-tentativas.json` imediatamente antes do provedor, `registrarParcial` guarda o acumulado (intervalo mínimo `TEMPOS.TENTATIVA_PARCIAL_MS`, fim de turno sempre), `fecharTentativa` sai DEPOIS do registro de consumo e `reconciliarInterrompidas` (boot) transforma o que sobrou em linha `interrompida`, com o parcial ou com custo `desconhecido`, sem duplicar (a linha leva `attemptId`). No POSIX o provedor destacado pode seguir gastando depois da morte do engine, e a linha diz isso (`provedorPodeTerContinuado`) |
| `lib/engine/falhas.js` | **Registro durável de falha por sessão** (A1), em `state/falhas-sessao.json`, FORA do `farol.log`: "Limpar log" não apaga. Motivo inteiro (a mensagem de erro segue cortada em 300; o texto completo viaja em `err.detalheCompleto`, via `erroDeSessao`), teto de 8000 caracteres, máscara de segredo e no máximo 500 registros. Liga ao Consumo por `sessionId`/`attemptId` e ao card estacionado por `parked[key].sessionId`. Guarda `resumeOutcome` quando a A5 informa |
| `lib/engine/sessao-id.js` | **Id opaco de sessão de IA** (A1): `<prefixo>-<uuid>`, único entre boots e aparelhos, com o rótulo curto (`a1`) só para exibição. `kindFromId` lê o prefixo. Sessão de terminal (`t<n>`) fica fora |
| `lib/engine/jira.js` | **O único arquivo do recurso de Jira que COMPÕE os outros** (v2.52.0). `siteForPr` (resolve org do GitHub -> site, sem tocar rede nem credencial), `cardForPr` (lê o card, com cache), `cardBlock` (o bloco delimitado que entra no prompt), `mcpArgsFor` (o `--mcp-config` + `--strict-mcp-config` da sessão) e `mcpConfigPath`. Os módulos de `lib/jira/` são FOLHAS e não se importam entre si: quem junta site, credencial, cache, cliente e normalização é aqui, e só aqui |
| `lib/engine/sync-chave.js` | **Estado e abertura da chave do conjunto** (C1, CT-ENV). `estadoDaChave` (`desligada`/`bloqueada`/`pronta`/`perdida`), `syncUnlock` (login por senha e depois o chaveiro, nessa ordem), `reembrulharComCache` (troca de senha: a chave NÃO muda, só o embrulho), `syncGerarChaveNova` (época nova, só no estado `perdida`), `abrirPeloCache` (boot e reconexão: reabre sem senha só com cache deste destino e `kcv` conferido contra o chaveiro; desde a v2.61.1, antes o cache nunca era lido e todo reinício trancava a chave) e `esquecerChave` (o ÚNICO caminho que apaga o cache; desligar e credencial inválida preservam) |
| `lib/engine/sync-admin.js` | **Tornar ESTE aparelho admin** (C2a): a senha real do Firebase vem ANTES de qualquer gravação, e a geração anda +1 por CAS com ETag. Designação remota de admin não mora aqui (é da C6) |
| `lib/engine/sync-politicas.js` | **Publicar e aceitar política por aparelho** (C2a). A ordem das recusas é o contrato: consentimento local (`aceitarAdmin`), geração vigente, assinatura, frescor e versão, e só DEPOIS o envelope é aberto. Decifrar antes da assinatura seria processar conteúdo que ninguém provou ter vindo do admin |
| `lib/engine/politica-efetiva.js` | **Valor efetivo** (C2a), PURO: o remoto SÓ RESTRINGE (pausa é OU, teto é o menor, lista é interseção) e a queda da autoridade nunca amplia, senão perder a rede viraria o jeito de despausar um aparelho pausado. `origem` diz, campo a campo, quem decidiu |
| `lib/engine/sync-grupo.js` | **Grupo de consumo no banco** (C2b, CT-GRUPO): publicar (admin) e aceitar, pelo mesmo contrato de nó da política, mais o vínculo local do perfil. **Configurar não é ativar**: o teto aceito aqui não entra em caminho de admissão nenhum, e quem liga o gate é a C4b |
| `lib/engine/sync-aparelho.js` | **Renomear e aposentar** (C2b): o ÚNICO lugar que escreve `retiredAt`. Aposentar é ato explícito e reversível; ausência de presença NUNCA infere aposentadoria, e aposentar não apaga dado, não tira chave e não encerra sessão. **Quem pode** (20/09/2026): aposentar, reativar e renomear OUTRO aparelho exigem o admin da geração vigente, lida do banco no instante da mutação; renomear a SI MESMO fica com todo aparelho, porque é o mesmo ato do campo "Nome deste aparelho". Leitura do admin indisponível recusa, e "ninguém administra" recusa com motivo próprio |
| `lib/engine/sync-limpeza.js` | **Chave da limpeza protegida** (C2b, decisão D-b): ligar não pede senha, porque ligar não apaga nada. Fail-closed: nó ausente, assinatura que não fecha, geração antiga ou admin sem sinal de vida contam como DESLIGADA |
| `lib/engine/sync-limpar.js` | **O ato de apagar** (C2b, D8): chave ligada, senha real ANTES de qualquer gravação, nenhuma operação viva, trava do ato, remoção só do que a lista positiva alcança, corte do que REALMENTE saiu, e a trava sai sempre. Servidor recusando = nada publicado, e a saída é o console do Firebase |
| `lib/engine/sync-revogacao.js` | **Revogação** (C2b): `revokedBefore` (menor que o `auth_time` do próprio ato, e só cresce), retirada do consentimento local e o resumo que separa as três revogações. Não promete cancelamento imediato nem remoção do que outro aparelho já recebeu |
| `lib/engine/sync-publicar.js` | **Ritual de publicação de nó assinado** (C2b): geração vigente lida do banco (não a guardada), `v` anterior + 1 e CAS por ETag. Política e grupo passam por aqui |
| `lib/engine/sync-publicacao.js` | **Publicação de conteúdo compartilhado** (C3a): capacidade do aparelho e catálogo, com as duas condições sempre juntas: existe outro aparelho da frota v2 pronto para ler, e o TEXTO CLARO mudou. O `enc` muda a cada cifragem (IV novo), então comparar o que está no banco nunca detectaria "não mudou" |
| `lib/engine/sync-andamento.js` | **Andamento ao vivo entre aparelhos** (C3b): relógio próprio de 10 s, só com o compartilhamento ligado. Coalesce 10 s, renova a cada 60 s, apaga ao terminar; `dev`, `t0` e `x` vão na AAD. A leitura emite `sync-live` e NUNCA chama `pushState` |
| `lib/engine/sync-pendencias.js` | **Precisa de você em todos os aparelhos** (C3c, D3): publica as pendências daqui, lê as dos outros, avisa uma vez o que ninguém viu (`sync-pending`, nunca `pushState`) e grava o visto uma vez só. Agir continua sendo no aparelho dono |
| `lib/engine/sync-historico.js` | **História de revisões entre aparelhos** (C3d): índice consultável (`t`, `dt`) e corpo write-once por versão. Só sobe o que aconteceu depois de o compartilhamento ligar aqui (marco em `state/`); o histórico anterior é envio explícito. Teto de 20 por ciclo |
| `lib/engine/sync-escopo.js` | **Panorama e Meus PRs entre aparelhos** (C3e): um publicador por conta (meta com CAS e 15 min), só linhas cujo `ctag` mudou, tombstone para PR que saiu (apagável 24 h depois), reconstrução pelo índice `su` depois de reiniciar. Meus PRs chega `somenteLeitura`: o Merge nunca é habilitado por dado remoto |
| `lib/engine/sync-listas.js` | **Panorama e Meus PRs de OUTROS aparelhos** (C3, CT-LEITURA): no relógio, lê por conta o ponteiro `live/rev` e os metas; as linhas só quando o ponteiro andou, a partir do maior `u` já lido. A origem é o `dev` do meta (quem publica a conta agora), o escopo publicado por ESTE aparelho não é remoto, e leitura que falha marca o escopo como `falhou` sem apagar a visão. A tela recebe `sync-lists` (mudança ou batimento, nunca `pushState`) e `POST /api/sync/lists` |
| `lib/engine/sync-pushback.js` | **Memória de pushback entre aparelhos** (C3f): sobe só o confirmado, retira por LÁPIDE (para ninguém ressuscitar), mescla respeitando a decisão manual e marca conflito em vez de combinar. Nunca toca `pushbackScanned` nem o contador de falhas |
| `lib/engine/sync-envio-historico.js` | **Envio explícito do histórico local** (C3g): mede cifrando de verdade antes de perguntar, confirma pela impressão do conteúdo medido (mudou, mede de novo), envia só o anterior ao marco, em lotes, retomável e sem duplicar. Nunca credencial, config inteira ou histórico do CLI |
| `lib/engine/admissao.js` | **Admissão local** (C4, CT-ADM): só com o compartilhamento ligado. Reserva a vaga do APARELHO antes do provedor, aplica os requisitos duros (presença, root, provedor, pausa, vaga) e o piso de memória, onde **medição indisponível é desconhecido, não suficiente**. A exceção de clique atravessa só o teto, e quem excede conta |
| `lib/engine/escolha.js` | **Escolha do agendador** (C5a), PURA e sem engine: QUAL (rodízio por org, igual ao local de hoje) e ONDE (publicador apto, com vaga, fora da espera da recusa, por prioridade e folga). Item sem aparelho apto não trava a fila |
| `lib/engine/sync-distribuicao.js` | **Distribuição entre aparelhos** (C5c): publica o candidato no ato, o admin agenda no relógio e só renova a prontidão depois de ciclo saudável, o executor confere consentimento, assinatura, geração, TTL e head pela tag antes de reservar vaga, e recusa com código e espera. **O consentimento entrou na ELEGIBILIDADE em 20/09/2026**, com o mesmo predicado da transferência (`aceitarAdmin === false` barra, ausente não): sem isso o admin atribuía a quem recusa por princípio e repetia o laço a cada TTL, inclusive consigo mesmo. Campo ausente segue elegível, de propósito, para a frota em versão antiga não ficar sem trabalho. Os códigos de autoridade entraram em `DETALHES`, senão a recusa chegava ao publicador sem motivo. Atribuição aceita volta pelo ramo local, com o lease como autoridade final. O desvio no `enqueueHeadless` exige `distribuindo` (autoridade E prontidão frescas); o agendador do admin exige só `ativa` |
| `lib/engine/sync-andamento.js` (relógio) | **O relógio de 10 s é a fiação da frota** (C3h), ligado ao CONECTAR desde a v2.62.2 (antes só no primeiro tique de polling, e a tela passava minutos sem dizer quem é o admin): publica andamento, capacidade (com a política efetiva) e catálogo, observa sinais, aceita política e grupo, distribui, e sincroniza histórico, escopos, pushbacks e pendências. Publicador novo sem chamador aqui não roda fora de teste |
| `lib/sync/tomada.js` | **Tomada forçada** (C8), PURA: quando dá para tomar (lease VIVO de outro aparelho), o lease sucessor (geração anterior mais um, nomeando de quem tomou), o risco de duplicidade pela última batida, o aviso que o computador mostra ANTES de confirmar e o bloqueio de publicação de quem ficou uma geração atrás. Sem promessa de exactly-once: o Farol não alcança o processo do outro aparelho |
| `lib/engine/sync-projecao.js` | **Projeção da sincronização para a tela**: allowlist dos aparelhos (com a versão do Farol de cada um) e as últimas tomadas dos dois lados. Saiu do `sync.js` quando ele passou do teto de tamanho |
| `lib/engine/sync-transferencia.js` | **Transferência voluntária** (C7b): o aparelho que está rodando entrega o trabalho a outro, nesta ordem: confere o destino (resumo fresco, sem pausa, com IA, com vaga e com a CREDENCIAL da conta), publica a memória do checkpoint, encerra a sessão daqui e devolve o item ao conjunto preferindo o destino. Nenhuma sessão migra, e a preferência tem prazo |
| `lib/sync/transferencia.js` | **Aptidão do destino e preferência** (C7b), PURA: os cinco motivos de inaptidão e a preferência com prazo, que a colocação respeita enquanto vale e ignora depois (PR nunca fica reservado para aparelho que sumiu) |
| `lib/engine/capacidades.js` | **O que existe no código e NÃO está valendo** (adendo de 16/09/2026): retrato puro do que foi PEDIDO (configuração) e do que está APLICADO (autenticação exigida, compartilhamento depois da guarda do celular, teto do grupo). Vai ao snapshot em `capacidades`, e a tela mostra a lista por `capacidadesIndisponiveis`/`capacidadesIndisponiveisHtml` (`ui/pure/capacidades.js`) no topo da seção de sincronização. Enquanto a proteção não é aplicada, a tela não pode dizer que está |
| `lib/engine/perfil-claude.js` | **Plano e chaves explícito** (A2): `authFromProfile` (a regra ÚNICA de perfil utilizável, que o `resolveClaudeAuth` do `server.js` importa), `problemasDePerfil` (id apontado que a cascata não usa; vai ao snapshot em `claudePerfis.problemas`, ao `runtimeChecks` e ao diagnóstico), `testarPerfil` (ato explícito: roda `claude auth status --json` com o ambiente limpo da sessão de login contra uma CÓPIA efêmera e privada da configuração do perfil, porque o CLI reescreve o `.claude.json` e cria `backups/` na pasta que recebe; a credencial é lida da pasta original por `CLAUDE_SECURESTORAGE_CONFIG_DIR` e nunca é copiada; travado em `test/perfil-claude-sem-escrita.test.js`; e devolve a origem de cada campo, sem gravar nada e sem expor o nome do plano) e `adotarLegado` (prévia; só `confirmar: true` literal grava). Queda para a assinatura legada continua acontecendo, mas deixou de ser silenciosa |
| `lib/engine/diagnostico.js` | **Diagnóstico unificado** (A3): UM Markdown (ambiente do doctor, falhas do registro durável da A1, resumo do triage) servido em `GET /api/diagnostics`, que a tela mostra, o botão copia e a sessão de IA lê. Tudo que vem de fora sai mascarado, com menção e URL em código e texto livre em cerca maior que qualquer crase de dentro; e-mail de login e caminho da máquina não entram. A sessão de diagnóstico é SOMENTE LEITURA (`argsDeSomenteLeitura` no `session.js`: `--tools Read,Grep,Glob --strict-mcp-config --safe-mode --disable-slash-commands`, porque `--tools` não desliga hooks, plugins nem skills de settings; execução provada com `claude` falso em `test/diagnostico-ia-execucao.test.js`; `--sandbox read-only` no Codex, provado só como argumento emitido), e o `pr-health.md` virou prompt de leitura, ressincronizado pelo `prepareHome`. A renderização inerte é `diagnosticoHtml` (`ui/pure/diagnostico.js`) |
| `lib/engine/sync-telas.js` | **Contrato das telas da sincronização** (brief B2): projeções para o snapshot (admin vigente, modo da distribuição e itens esperando, ocupação local sem referência de PR, comandos emitidos) e leituras avulsas que não cabem no ciclo (desfecho de comando pelo recibo, aviso da tomada lendo o lease, estado da chave de limpeza). Não decide nada: expõe, com allowlist, o que o engine já decidiu |
| `lib/engine/sync-checkpoint.js` | **Checkpoint compartilhado** (C7a): publica no relógio o que as sessões vivas verificaram (`checkpoints/{loja}/{prTag}/{id}`, cifrado, escrita única) e herda o que os outros verificaram ANTES de montar o prompt, devolvendo o desfecho (integral, parcial, reinício). Falha fechada: entrada que não abre fica de fora inteira e vira contagem. Herança é MEMÓRIA, nunca sessão (o `sid` do CLI segue preso à máquina que o abriu) |
| `lib/sync/checkpoint.js` | **Forma do checkpoint compartilhado** (C7a), PURA: allowlist da entrada, vereditos fechados, id de conteúdo, mescla sem duplicar e o desfecho da herança. A loja (`review` ou `self`) entra no caminho e no envelope, então as duas nunca se misturam |
| `lib/engine/sync-comandos.js` | **Comandos remotos** (C6): o admin emite cifrado e assinado em `live/commands`, e o ALVO aplica no relógio com as quatro condições (consentimento local, geração, assinatura, autoridade fresca) mais o TTL, revalidando head e posse. Idempotência durável por `cmdId` gravada ANTES do efeito, recibo de escrita única em `commandReceipts`, e sucesso só existe com recibo. Designar admin não promove ninguém: acende o pedido e espera a senha digitada no destino |
| `lib/sync/comando.js` | **Forma do comando** (C6), PURA: allowlist por tipo (cancelar, repetir, decidir, iniciar, designar-admin), a ordem das recusas e `prDoComando`, que remove `manual` e `requested` (CT-FIO). **`nao-e-meu` vem ANTES de `nao-aceita-admin` desde 20/09/2026**: `nao-aceita-admin` e uma frase sobre ESTE aparelho, e com ela na frente um comando endereçado a outro devolvia um codigo que o engine trata como recusa COM efeito, fazendo o aparelho errado gravar `commandReceipts`. Para o destinatario de verdade nada muda. `conferirRecibo` amarra o recibo ao alvo declarado pelo no do comando: ausencia, recibo de terceiro e alvo desconhecido sao tres coisas, e nenhuma delas e "o alvo respondeu" |
| `lib/engine/sync-consumo-grupo.js` | **Teto do grupo de consumo** (C4b). **De quem ele le sao TRES perguntas, separadas em 20/09/2026**: de quem se EXIGE dado fresco (aparelho da conta nao aposentado), que gasto entra na janela (o ja publicado, aposentado ou nao) e que reserva ainda vale (a com retrato fresco, pelo TTL de `reservasDe`). Aposentar encerra a exigencia, nao a contabilidade: o gasto dele continua contando. O filtro NAO olha `lastSeenAt`, e trocar por `frota.aparelhoV2` soltaria o teto sozinho quando alguem desligasse o notebook por um dia. Publica o rollup diário deste aparelho em `usageDaily` (só quando muda), recalcula no relógio o retrato de cada grupo ATIVO a partir do banco (nunca do admin) e responde, síncrono, ao gate: estouro vira perfil sintético `grupo:<id>` em `budgetBlockedFor`; não verificável (lacuna, rollup inválido, aparelho sem dados, reserva vencida, retrato velho, perfil sem vínculo) é `grupoSegura`, que espera sem estacionar e segura também o clique no escalonador. Codex e tipo não controlado ficam fora. Ativação por `ATIVACAO_TETO_GRUPO_C4B`, LIGADA desde a v2.61.0 (decisão do dono em 17/09/2026, antes da medição do atraso do consumo entre dois aparelhos reais): com grupo ativo, com identidade e teto, o estouro passa a barrar de verdade, e barrar continua sendo espera, nunca estacionamento |
| `lib/sync/consumo-grupo.js` | **Soma do consumo do grupo** (C4b), PURA: início do período no dia canônico, rollup saneado, soma por aparelho com os motivos de não verificável, e o perfil sintético que reusa `profileBudgetStatus` |
| `lib/sync/capacidade.js` | **Abrir a capacidade de outro aparelho** (C4b), folha: um lugar só para o agendador e o teto do grupo decifrarem `live/deviceStatus`, com falha fechada |
| `lib/engine/sync-aceite.js` | **Aceite no relógio** (C2c): com consentimento local e autoridade fresca, lê a política DESTE aparelho e os grupos e passa pelos aceites de `sync-politicas.js` e `sync-grupo.js` (a ordem das recusas é deles). Sem isso a política publicada nunca chegava ao cache que a admissão lê |
| `lib/engine/sync-sinais.js` | **Sinais do admin e volta ao local** (C5d): no relógio de 10 s, o admin publica o batimento (um por intervalo), todo aparelho observa batimento e prontidão (primeira leitura é snapshot e não prova vida; leitura que falha não muda nada) e alimenta `engine.sync.autoridade`. Prontidão vencida vira modo local: a volta devolve `headlessDistribuindo` ao ramo local com atraso estável por aparelho, teto por giro e guarda contra duas voltas; o primeiro valor fresco devolve o modo distribuído na hora. Sessão viva e lease não são tocados |
| `lib/engine/sync-falha.js` | **Estados da conexão e registro de falha** (C2b): `STATUS`, as recusas permanentes, e o log que só sai quando o CÓDIGO muda. Saiu do `sync.js` quando os colaboradores passaram a precisar dele |
| **`lib/sync/`** | **Folhas do protocolo de sincronização: puras ou de IO simples, sem conhecer o engine** |
| `lib/sync/tags.js` | **Identificadores v2** (C1): `tag(K_id, domínio, valor)` por HMAC-SHA256, 32 hex, com sete domínios fechados. O "sal" é a chave secreta, porque sal público não resolve contra dicionário: quem lê o banco lê o sal junto |
| `lib/sync/kek.js` | **Embrulho do material pela senha** (C1): `scrypt` ASSÍNCRONO (nunca `scryptSync` no event loop do engine), AES-256-GCM com AAD amarrando uid, rev, sal e custo, e o `kcv` que prova sem senha que o cache confere com o banco |
| `lib/sync/chaveiro.js` | **Nó `users/{uid}/keyring`** (C1): criação com CAS por ETag (412 = outro aparelho criou antes, e o material próprio é descartado), reembrulho com `rev + 1` e rotação que PRESERVA as gerações antigas. Chaveiro visto e depois ausente nunca é recriado sozinho |
| `lib/sync/cache-chave.js` | **Cache local da chave** (C1), em `~/.farol/sync-key.json` com modo 0600 em TODA gravação. O boot só LÊ (sem scrypt e sem rede). Descarta por `uid`, por destino e por `kcv` divergente |
| `lib/sync/envelope.js` | **Envelope cifrado** (C1): `e1.<kid>.<iv>.<ct>.<tag>`, AAD em ordem fixa, preenchimento até múltiplo de 256 e SEM compressão (tamanho comprimido vazaria conteúdo). Leitura falha FECHADA: qualquer pedaço malformado descarta o item inteiro, nunca texto parcial |
| `lib/sync/sonda-regras.js` | **Prova qual versão de regra está publicada** (C1), escrevendo num caminho que as regras v2 NEGAM. Nunca apaga dado de verdade: provar pelo DELETE da raiz seria destrutivo justamente no caso detectado |
| `lib/sync/admin-chave.js` | **Par Ed25519 do admin** (C2a, CT-ADM-POL), em `~/.farol/sync-admin.json` com 0600. A privada NASCE e MORA só no aparelho admin: nunca sobe ao banco, nunca entra no `config.json` e nunca sai em snapshot, log ou rota. É presa à GERAÇÃO, porque guardar a chave velha criaria caminho para assinar com uma autoridade que não existe mais |
| `lib/sync/assinatura.js` | **Assinatura dos sinais do admin** (C2a): a pré-imagem amarra conta, caminho lógico, geração e o valor canônico, então mover a assinatura de nó ou reusar de outra geração falha. NÃO é controle de acesso: o banco não verifica criptografia, e quem recusa valor mal assinado é sempre o cliente que lê |
| `lib/sync/autoridade.js` | **Frescor da autoridade** (C2a): frescor é OBSERVAR UMA MUDANÇA (sequência maior que a maior já vista, chegando depois do início desta conexão), nunca "assinatura válida". Snapshot inicial, reentrega e keep-alive contam como visto e não provam nada; a maior sequência vista é persistida, senão reiniciar o Farol faria valor antigo parecer novidade |
| `lib/sync/politica.js` | **Allowlist e clamp da política** (C2a). Chave fora da lista é DESCARTADA, não recusa o pacote (recusar tudo faria uma versão mais nova desligar a política nas antigas); `tetoParalelismo` é clampado para 1 a 4, o mesmo clamp local. Campo ausente não é campo falso |
| `lib/sync/grupo.js` | **Identidade e forma do grupo** (C2b, CT-GRUPO): id SORTEADO, nunca derivado de credencial, nome ou caminho (um teste varre o módulo atrás de `createHash`). Teto inválido é descartado, não virado zero; Codex aparece como não controlado, nunca como consumo zero |
| `lib/sync/vinculo.js` | **Vínculo perfil→grupo como INTERVALO** (C2b), em `state/`. `grupoDoConsumo(perfil, at)` responde pelo instante do gasto, então trocar de grupo não reatribui o que já foi consumido; revincular ao mesmo grupo não reinicia a contagem (é o caso da rotação de credencial) |
| `lib/sync/limpeza.js` | **Alcance da limpeza** (C2b): lista POSITIVA. Nó novo é preservado por omissão, e categoria só entra junto com a regra de remoção dela, senão seria promessa que o banco não cumpre |
| `lib/sync/frota.js` | **Quem está na frota v2** (C3a): o gate de publicação. Exige OUTRO aparelho com `contract` 2, `keyReady` verdadeiro, não aposentado e visto em 24 h. O próprio aparelho nunca conta, senão um Farol sozinho publicaria para sempre, para ninguém |
| `lib/sync/catalogo.js` | **Linha do catálogo e o resumo do claro** (C3a): allowlist de sete campos e um resumo que ordena as chaves antes de resumir (estável entre execuções e independente da ordem). O catálogo é regenerável e nenhum caminho de decisão o lê |
| `lib/sync/andamento.js` | **Projeção do andamento** (C3b), PURA: etapa num vocabulário fechado, tempo por etapa, subagentes saneados, modelo e tags. Nenhuma linha de feed, caminho, comando ou prosa sobe, nem cifrada |
| `lib/sync/pendencia.js` | **Projeção da pendência e a regra do visto** (C3c), PURA: tags, veredito, motivos curtos da tela e bloqueio; nada do relatório interno nem do corpo do review |
| `lib/sync/historico.js` | **Índice e corpo da revisão** (C3d), PURO: índice com veredito, status, ação, contagens e tag; corpo = projeção da tela sem login nem estado de retry; `dt` com 13 dígitos para ordenar por aparelho |
| `lib/sync/escopo.js` | **Linha do Panorama e de Meus PRs** (C3e), PURO: allowlist por tipo (SHA do head nunca sobe), `ctag` por HMAC do claro, `su` com 13 dígitos e a regra da vez do publicador |
| `lib/sync/pushback-sync.js` | **Projeção e mesclagem do pushback** (C3f), PURO: autor por tag, manual vence automático, dois manuais que discordam devolvem `conflito` e o local continua valendo |
| `lib/sync/candidato.js` | **Candidato à distribuição** (C5a), PURO: ponteiro com tags (PR, conta, org, versão material), sem `requested`, sem peso e sem texto; head como tag (head novo é item novo); fusão do mesmo trabalho publicado por vários aparelhos num item com N publicadores |
| `lib/sync/modo-distribuicao.js` | **Modo da distribuição** (C5d), PURO: distribuído só com prontidão fresca (três intervalos, relógio local), virada nomeada nos dois sentidos, jitter estável por aparelho e lote da volta (mais antigos primeiro) |
| `lib/sync/prontidao.js` | **Prontidão do distribuidor** (C5b, CT-PRONT), PURA: só ciclo saudável renova, e falha nunca se disfarça de fila vazia; defeito é do REGISTRO (não do PR) e guarda a impressão da causa, então a recuperação acontece quando a causa muda, sem head novo; ocupação soma reserva e execução, com a atribuição provisória contada uma vez só |
| `lib/sync/no-assinado.js` | **Forma e ORDEM de recusa do nó assinado** (C2b): forma, geração, assinatura, frescor, versão, e só então decifrar. A ordem é regra de negócio, e copiada em dois lugares viraria duas ordens diferentes na primeira correção |
| `lib/sync/cache-politica.js` | **Última política aceita** (C2a), em `~/.farol/sync-policy.json` com 0600 |
| `tools/sync-rules.js` | **Gera `firebase/database.rules.json`** a partir do template, expandindo as macros por substituição textual (sem `JSON.parse`). `--check` reprova quando o arquivo publicado diverge do gerado; a publicação segue manual, uma vez, pelo dono |
| **`lib/jira/`** | **Folhas do recurso de Jira, puras ou de IO simples** |
| `lib/jira/sites.js` | Modelo do site (`parseJiraSites`, `siteForOwner`, `maskJiraSites`): allowlist de id, validação de origem e a máscara que impede o segredo de chegar na tela |
| `lib/jira/credentials.js` | Credencial por site em `~/.farol/jira-credentials.json`, FORA do `config.json` (que trafega inteiro pra UI), com permissão restrita em TODA gravação |
| `lib/jira/client.js` | Cliente REST do Jira em Node puro, API **v2** (a v3 devolve descrição em ADF e exigiria um interpretador), timeout próprio e corpo provado |
| `lib/jira/card.js` | `normalizeIssue`/`issueValida`: whitelist de saída (título, status, critérios, escopo, fora de escopo) e prova de forma. Card só é card se tiver a forma esperada; `fields` array não é card |
| `lib/jira/cache.js` | Cache de card por site, fora do workspace da sessão. Namespace é id **E** host (a tela deixa corrigir o `baseUrl` mantendo o id, e sem o host o Farol serviria por até uma hora o card do tenant ANTERIOR) |
| `lib/jira/errors.js` | Taxonomia com três donos de falha (do Farol, do Jira, do usuário). Os códigos `desligado` e `sem_chave` são SILENCIOSOS por decisão, ver [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md#jira-multi-tenant-v2520) |
| `tools/jira-mcp.js` | **O servidor MCP local do Farol** (v2.52.0). Expõe `getJiraIssue` e `searchJiraIssuesUsingJql` já apontados pro site certo. Recebe SÓ o `siteId` por argumento e lê a credencial do disco por conta própria: o `state/spawns.log` registra a linha de comando inteira, então segredo ali seria segredo em texto puro pra sempre |
| `tools/farol-parear.js` | Comando local da A4: imprime um código de pareamento SÓ no stdout (10 caracteres, 10 minutos, uso único) e `--revogar-todas`. Honra `FAROL_HOME`. Viaja nas três whitelists de `tools/` (pacote leve, Setup.exe, offline do macOS) |
| `ui/` | UI sem framework: `index.html` + `pure.js` (fachada) + `pure/` + `app.js` + `telas/` + `app.css`; `ui/transporte.js` é o transporte autenticado da A4 (Authorization e SSE por fetch, só com token salvo), consumido por `ui/telas/infra.js` e pelo bootstrap |
| `ui/app.js` | **O bootstrap da página** desde a Fase 1b da reorganização (16/09/2026): liga o SSE ao estado, comanda a troca de aba e o `data-goto`, e inicializa as telas. Saiu da dívida de responsabilidade única (ver `docs/QUALITY.md`) |
| `ui/pure.js` | **Fachada** desde a Fase 1a da reorganização (15/09/2026): só reexporta os módulos de `ui/pure/`. Existe para o `ui/app.js` (`import { ... } from './pure.js'`, um `<script type="module">` só) e os testes continuarem importando de um lugar. Nome novo nunca nasce aqui |
| `ui/pure/` | As funções PURAS da UI, um módulo por assunto, em camadas sem ciclo: `comum.js` (formatação, sem dependência; é também o parser único de JSON da UI e santuário do ratchet), `mencoes.js` (menções navegáveis, só de `comum`) e os de domínio (`consumo`, `entregas`, `radar`, `review`, `pessoas`, `autoanalise`, `meus-prs`, `contas`, `jira`, `sistema`, `sobre`, `sessao`, `sync`, `fila-justa`). Único código de front com teste. As regras de quem mexe estão no `ui/pure/README.md`; a superfície pública é congelada em `test/ui-pure-superficie.test.js`, que também reprova nome declarado em dois arquivos |
| `ui/telas/` | As telas da UI (código que toca DOM e lê `estado()`), um módulo por assunto, 30 arquivos desde a Fase 1b (16/09/2026). Cada uma se registra em `registro.js` (`registrarTela`) e o `ui/app.js` importa cada módulo; nenhuma importa o bootstrap de volta. As regras de quem mexe estão no `ui/telas/README.md`, e a trava do ciclo está em `test/ui-telas-contrato.test.js` |
| `workspace-template/` | Workspace semeado em `~/.farol/workspace` (protocolo de review do Claude); `prompts/pr-review-auto.md` é a revisão headless, `prompts/self-review.md` é a autoanálise dos meus PRs (só leitura, nunca posta) |
| `installer/install.ps1` / `uninstall.ps1` | Instalador Windows |
| `installer/install.sh` / `uninstall.sh` | Instalador macOS |
| `Instalar.cmd` / `Instalar.command` | Atalhos de duplo clique (Windows / macOS) |
| `tools/make-package.ps1` | Gera o zip LEVE de distribuição (sem node_modules) com auditoria anti-vazamento |
| `tools/make-installer.ps1` + `installer/farol.nsi` | Gera o INSTALADOR ÚNICO do Windows (`dist/Farol-Setup-vX.Y.Z.exe`, NSIS): um `.exe`, duplo clique instala e abre (roda o `install.ps1` por dentro). Requer `makensis` (vem com o Tauri em `AppData\Local\tauri\NSIS`). É o instalador de primeira instalação |
| `tools/make-offline-mac.sh` | Gera o instalador OFFLINE do macOS (`dist/Farol-Instalar-mac.command`): autoextraível único, Electron embutido. RODA EM QUALQUER SO (baixa o zip darwin do GitHub e EMBUTE; o `.app` é montado no Mac na instalação, pois só o unzip do Mac preserva os symlinks do `.app`). Default Apple Silicon; `ARCH=x64` pra Intel. É BETA até validar num Mac real |
| `tools/publish-release.ps1` | Publica a release no GitHub (`wandersonaadsantos/farol`): sobe o pacote leve (update) + o instalador único Windows. É como as cópias distribuídas recebem atualização |
| `tools/make-icns.sh` | Gera `assets/farol.icns` (rodar num Mac) |
| `docs/` | Documentação. Só os quatro guias da tabela "Os guias operacionais" viajam com o app (allowlist nas seis rotas, travada em `test/distribuicao-listas.test.js`); `docs/superpowers/`, `docs/QUALITY.md` e o resto ficam no repositório |

## Invariantes do projeto (não negociar)

1. **Zero dependências além do Electron.** O engine roda com Node puro (`node server.js`). Não adicione pacotes npm.
2. **Dados em `~/.farol`, nunca em AppData/Library.** No Windows o motivo é o MSIX virtualizar `%LOCALAPPDATA%`; no macOS mantemos o mesmo caminho por simetria (o estado migra entre máquinas copiando uma pasta só).
3. **Log só de falhas.** `farol.log` não recebe ruído operacional; o Diagnóstico usa esse log como fonte. **A classificação dessas falhas mora só em `lib/log-taxonomy.js`** (desde a v2.37.0): quem decide retry (`runOneHeadless`) e quem monta o Diagnóstico leem a MESMA tabela. Duplicar a regra foi o que deixou o painel mostrando 159 linhas cruas de 4 episódios enquanto o motor achava que entendia o erro.
4. **Nada é postado no GitHub sem gate.** Auto-approve exige revisão pedida a mim
   (`requested === true`), veredito `approve` e payload `APPROVE`, com default estrito por
   conta; reprovar sozinho e co-assinar são opt-in; clique manual nunca é bloqueado pelos
   gates automáticos; e check obrigatório vermelho nunca sai como APPROVE sozinho. O desenho
   completo, com o porquê de cada gate e os incidentes que os criaram, está em
   [`docs/REVIEW-GATES.md`](docs/REVIEW-GATES.md).
5. **Toda diferença de SO passa por `IS_WIN`/`IS_MAC`/`IS_LINUX`** (fonte única em `lib/paths.js`), nunca por checagens soltas espalhadas. Doutrina desde a v2.45.0: o que é POSIX genuíno (runShell, spawn headless, killTree, PATH do boot) ramifica em `!IS_WIN` e vale pra mac E linux; o que é mac de verdade (`open`, `Farol.app`) usa `IS_MAC`; o ramo Linux (experimental) fica ao lado, ver [`docs/MACOS.md`](docs/MACOS.md#linux-experimental-v2450), que também traz os pontos com branch de plataforma.
6. **Texto da UI e comentários em português, sem travessão.** Use vírgula, parênteses ou dois pontos.
7. **O zip de distribuição é auditado** (`make-package.ps1` falha se detectar estado, config, token ou conta pessoal). Não enfraqueça a auditoria. Desde 16/09/2026 a varredura de conteúdo lê TODO arquivo do pacote, sem lista de extensão (a lista anterior deixava `ui/favicon.svg` e `installer/farol.nsi` fora, medido no caminho real), e `test/pacote-auditoria.test.js` reprova quem reintroduzir o filtro.

## Como rodar e testar sem estragar nada

- **Instância isolada**: `FAROL_HOME=/tmp/farol-teste node server.js` sobe engine + UI em `http://127.0.0.1:47170` sem tocar nos dados reais. Pra trocar a porta, escreva `{"port": 47180, "autoReview": false}` no `config.json` do FAROL_HOME antes de subir.
- **Nunca teste com `autoReview` ligado** numa conta real: PR novo na sua fila dispararia revisão headless de verdade (e potencial APPROVE real).
- **Stubs**: `FAROL_REVIEW_CMD` substitui o `claude` da sessão terminal; `FAROL_HEADLESS_CMD` substitui o headless (imprima um envelope `{"result": "..."}` no stdout).
- **A constituição que o Farol assina é o [eng-behaviour](https://github.com/wandersonaadsantos/eng-behaviour).** É a única, e não existe segunda doutrina valendo aqui. O escopo aplicável está declarado em `eng-behaviour.json` (`core`), o recorte das regras vive versionado em `eng-behaviour.rules.md`, e `npm run eng` roda o gate: `check` (o recorte versionado é byte a byte o que o catálogo gera hoje) e `audit` (regra hard verificada + evidência de avaliação das de julgamento). **Ele NÃO está no `npm run lint`, e portanto não está no CI**; ele mora no pre-push, e como o pre-push também proíbe push direto na main, todo caminho até a main atravessa o gate. As duas razões independentes para isso têm um endereço só, em `docs/QUALITY.md`, seção "A constituição vem do eng-behaviour". **São até 10 avaliações escritas por commit** (uma por regra de julgamento do escopo `core` que a entrega aciona), cada uma com fundamentação própria sobre AQUELE diff: um laço escrevendo a mesma frase em todas passa no gate sem avaliar nada. **Dívida anterior de regra de julgamento mora num baseline finito** (v0.12.0 do pacote): `tools/eng-behaviour/baselines.json`, passado pelo gate com `--repo-id farol`, hoje com os 15 arquivos que violam `core.file.single-responsibility`. Arquivo listado continua sendo avaliado como `violacao`, uma avaliação por arquivo, e a contagem só desce; a condição de fechamento de cada um e as regras de manutenção estão em `docs/QUALITY.md`, seção "Dívida registrada de responsabilidade única".
- **`tools/quality/` continua, e não é o eng-behaviour.** É o enforcement mecânico local do Farol, e ele cobre dois tipos de coisa. (a) A face mecânica de regras que no catálogo são de julgamento: `jsonParseCru`, `jsonStringifyCru`, `processEnvDireto`, `portaLiteral` e `tempoMagico` são todos casos de `core.duplication.business-rule`, fonte de verdade única, que o catálogo não verifica por ferramenta porque distinguir invariante compartilhado de coincidência de valor exige entender o domínio. Aqui o domínio é conhecido e os santuários são nomeados, então dá pra medir. (b) Eixos que o catálogo não tem: `emptyCatch`, `varUse`, `ternarioAninhado` e `profundidadeExcedida`. **Uma divergência declarada:** `maxLines` (400) mede tamanho de arquivo, e `core.file.single-responsibility` rejeita esse eixo por princípio. O contador fica como ratchet sobre dívida já medida, não como afirmação de que tamanho é o critério; se ele sai, é decisão do dono, não descuido. **Ele conta o EXCESSO de linhas úteis sobre o teto, não 0/1** (22/09/2026): binário, ele deixava crescer o arquivo que já estava na baseline, e foi assim que o `server.js` foi de 905 linhas (Onda 2) a 2326 com o gate verde. Ver `docs/QUALITY.md`, "Por que o `maxLines` conta linhas, e não arquivos".
- **Gate de qualidade** (rodar antes de QUALQUER entrega): `npm run check && npm run lint && npm test`, e `npm run eng` antes de empurrar. O `lint` é o gate de ratchet do enforcement mecânico em Node puro (`tools/quality/`): compara as violações com `baseline.json` e reprova qualquer contagem que SUBA. Corrigiu dívida? `npm run lint:update` trava o número mais baixo. A baseline nunca sobe à mão. O `check` valida a sintaxe (`tools/check-syntax.js` roda `node --check` por processo filho em TODO `.js` do projeto, ESM nativo desde a migração; a lista é DESCOBERTA e o próprio gate imprime quantos achou, então não existe número escrito aqui para apodrecer; `package.json` tem `"type": "module"`); o `test` roda a rede (`node --test`, runner nativo, ZERO dependências): funções puras + smoke de boot com `FAROL_HOME` temporário. Verde em todos é pré-requisito. A rede vive em `test/` e é o que protege a decomposição do engine em ondas (ver `docs/QUALITY.md`, o contrato de qualidade extraído do lace-be-fastify).
- As buscas `gh search prs` são read-only; rodar `check` contra o GitHub real é seguro.
- **As travas de navegação e distribuição** (Fase 0 da reorganização, 14/09/2026):
  `test/distribuicao-listas.test.js` deriva as QUATRO listas fixas do que viaja
  (`install.ps1`, `install.sh`, `install-linux.sh`, `make-package.ps1`) e reprova
  divergência entre elas, que é o modo de falha silenciosa que já custou a pasta
  `tools/` no Mac (PR #36). `test/guias-navegaveis.test.js` trava o mapa do código no
  README contra os scripts do `package.json`, o índice do `CLAUDE.md` contra as próprias
  seções, e qualquer link relativo morto nos guias. Pasta de topo nova exige as quatro
  listas na MESMA tarefa, e uma instalação real a partir do zip antes do commit: suíte
  verde não prova que o instalador copiou o que precisava.

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

## Diagnóstico: ambiente x operação x runtime (v2.40.4, terceira dimensão na v2.53.3)

Os checks de Sistema → Visão geral respondem TRÊS perguntas diferentes, e
misturá-las foi o defeito de origem:

| pergunta | de onde vem | exemplos |
|---|---|---|
| o Farol consegue RODAR? | `STATE.doctor` (engine) | gh, conta primária, Claude Code, Git Bash, pasta |
| o Farol vai ACHAR algo? | `operationChecks(STATE.accounts)` (`ui/pure.js`) | conta sem organização, conta sem token, tudo silenciado |
| o Farol consegue ABRIR A SESSÃO? | `runtimeChecks(STATE.doctor, STATE.config)` (`ui/pure.js`) | rodando como root, Codex sem CLI ou sem login |

A terceira nasceu na v2.53.3 e é diferente das outras duas em natureza: o
ambiente está instalado e a busca acha PRs, mas a sessão de IA **morre no
spawn**. Caso que motivou (Termux + proot Debian num Android, 25/08/2026): o
login padrão do proot é root, o Claude Code recusa
`--dangerously-skip-permissions` com uid 0, e o headless passa essa flag SEMPRE
(é fixa no `runClaudeStream`, não sai do toggle de `skipPermissions`, que só
alcança sessão de terminal). O resultado era "saiu com código 1" a cada ciclo,
para sempre, com os cinco checks de ambiente verdes.

Onde cada peça mora: `rodandoComoRoot()` em `lib/paths.js` (uid 0 em POSIX,
sempre false no Windows), exposta como `doctor.root` no `server.js`; a classe
`skip-permissions-root` em `lib/log-taxonomy.js`, que faz a falha ser lida como
PERMANENTE (estaciona na primeira, em vez de relançar para sempre); e o check
visível em `runtimeChecks`.

**O check de ambiente pergunta no ambiente em que o app AGE** (30/08/2026). `gh auth token` SEM `--user` honra o `GH_TOKEN` do ambiente (medido), e o `doctor()` só acrescenta o `--user` quando existe conta primária: sem conta configurada, o check de autenticação ficava VERDE por causa de um token exportado no shell de quem abriu o app, que o `ghEnv` recusa usar desde a correção do mesmo dia (seção Assinatura de [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md#assinatura-do-claude-qual-contaplano-o-farol-usa-e-como-alternar)). Doctor mais verde que a realidade é a pior falha possível num painel que existe pra dizer se dá pra rodar. O probe passou a receber `this.ghEnv()` como env, que é exatamente o "caminho legado do doctor/boot" nomeado no contrato do `ghEnv` (sem user ele nunca lança). Travado em `test/doctor-identidade.test.js`, cujo primeiro caso quase nasceu inútil: `env` AUSENTE não é `env` limpo, e afirmar sobre `(probe.env || {})` passava verde justamente no caso em que o filho herda `process.env` inteiro.

Esse check **não tem `goto`**, de propósito: não existe tela do app que conserte
"você é root". Clique que não leva a lugar nenhum é pior que texto puro, é a
mesma doutrina das menções navegáveis.

O caso que motivou (Wanderson, 11/08/2026): **conta cadastrada sem nenhum owner
deixava os 5 checks de ambiente verdes e o painel vazio pra sempre, sem erro,
sem log e sem nada na tela**. A causa é o fan-out da busca ser
`accountList().flatMap(acc => acc.owners...)`: sem owner a lista de alvos é
vazia, o `gh` nunca é chamado, e não existe falha pra registrar. Silêncio por
construção, que é o tipo de defeito que faz desconfiar do app inteiro.

Ao acrescentar check novo aqui: **decida primeiro em qual das TRÊS perguntas ele
entra** (ambiente, operação ou runtime), porque isso define o arquivo e a fonte
do dado. E **o rótulo tem que nomear a DIMENSÃO**, não a
coisa. "Conta @X" já é o check de autenticação; o de monitoramento é
"Monitoramento de @X". Dois checks com o mesmo rótulo leem como linha
duplicada, mesmo dizendo coisas diferentes (travado em `ui-pure.test.js`).
Config que só o usuário sabe preencher e cujo vazio produz SILÊNCIO (não erro)
é candidata a check; config com default seguro não é.
