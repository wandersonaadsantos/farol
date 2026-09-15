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
| `lib/spawnlog.js` | Registro opt-in dos processos disparados (caça o "terminal piscando") |
| **`lib/engine/`** | **Colaboradores da Engine: recebem o engine como contexto** |
| `lib/engine/review.js` | Revisão headless: fila por conta, escalonador paralelo (`processHeadless`), prompt (`headlessPromptFor`) e o ciclo de uma revisão |
| `lib/engine/decision.js` | O gate de postagem: `shouldAutoApprove`, `shouldAutoReject`, `coverageGap`, `checkpointGap`, `attentionPoints`, `postReview`, `decide`, capabilities das sessões interativas e projeção segura das decisões para a UI |
| `lib/engine/public-review.js` | Fronteira determinística entre diagnóstico interno e review: valida schema/linguagem de corpos e inlines, extrai review humano de registros legados e monta a allowlist enviada à UI |
| `lib/engine/skip-review.js` | **UM Farol por PR** (v2.50.1; regras reformadas em 28/08/2026, ver "As duas decisões de 28/08" em [`docs/REVIEW-GATES.md`](docs/REVIEW-GATES.md#as-duas-decisões-de-28082026-v2539-e-v2540-o-que-é-vazamento-e-o-que-não-é)). Ver o SINAL de outra pessoa (a label `<conta>:revisando`, que é o sinal escrito; ou ref de transição da v2.53.9) faz o Farol SAIR DE CENA naquele head, de forma DURÁVEL, SEMPRE (regra plana: caiu a exceção de CODEOWNERS da v2.51.0). `revisandoPorOutros` (labels) e `revisandoPorSinais` (refs de transição) são PURAS, `outrosRevisando` é a UNIÃO das duas e segue SÍNCRONA e sem IO (contrato do reReviewTargets), `saiDeCena` ancora por head e avisa por TOAST (desde 28/08/2026 nada é postado no PR), `standDownCaducou` é a rede de segurança (sessão do colega morreu sem review = volta a revisar), `coAssinar` é o opt-in que aprova em seu nome quando quem pegou aprovou, e `autoridadeNaSaida` responde só se EU sou autoridade (gateia a co-assinatura; falta de dado cai em true, o lado seguro). **Gate de consciência** (28/08/2026 à tarde; calibrado na v2.54.1): `bloqueadoPorHistorico` (reprovação de gente no head ativo, ou 2 aprovações humanas, seguram o automático; 1 aprovação não, a automática vale como a segunda) com boca única `bloqueiaAutomatico` (clique manual atravessa sem gh) + `avisaBloqueioHistorico`/`podarHistoricoAvisado` (toast único por PR+head). **`acrity` nunca conta como pessoa** (review de ferramenta não dispensa olho humano). Vale só no caminho AUTOMÁTICO: clique manual sempre revisa |
| `lib/engine/destrava.js` | **Estado novo destrava o que esperava clique** (v2.59.3). Commit novo ou pedido de revisão PRA MIM, posterior à parada, devolve aos caminhos automáticos três casos que ficavam presos pra sempre: pendência `stale_head` cuja rodada relançada não concluiu (âncora == `blockedHead`), revisão estacionada (exceto `cancelado`) e Pular num PR que segue pedindo minha revisão (exceto ignorado). Seleção SÍNCRONA gateada por `updatedAt`; só candidato real custa uma chamada `gh` (timeline) e, sem prova nela, uma de head. Marcador `state/destravados.json` impede o mesmo sinal de destravar duas vezes. Nunca posta nem lança sessão. Ver [Card que se explica e estado novo que destrava](docs/REVIEW-GATES.md#card-que-se-explica-e-estado-novo-que-destrava-v2593) |
| `lib/engine/review-signal.js` | **LEITURA DE TRANSIÇÃO das refs da v2.53.9** (28/08/2026). Por algumas horas a v2.53.9 escreveu o sinal de revisão em andamento como ref git `refs/farol/revisando/<pr>/<login>/<epoch-ms>`; a v2.54.0 devolveu a escrita pra label `<conta>:revisando` (decisão da tarde: label visível é desejada) e este módulo ficou só LENDO e coletando as refs até a frota convergir (remover no futuro). `refreshReviewSignals` roda no `check()` (uma chamada `matching-refs` com `--paginate` por repo de interesse por ciclo) e alimenta `engine.reviewSignals`; TTL de 1h dos DOIS lados do relógio (`TEMPOS.SINAL_REVISAO_TTL_MS`); GC apaga só ref órfã do passado; falha preserva o snapshot anterior. Também abriga `repoDoPr`/`numeroDoPr` |
| `lib/engine/codeowners.js` | **Quem é AUTORIDADE sobre cada arquivo do PR** (v2.51.0). Tudo PURO: `parseCodeowners`, `patternToRegex` (estilo gitignore), `ownersForPath` (a ÚLTIMA regra que casa vence, semântica do GitHub, NÃO acumula), `souAutoridade` e `cobreMinhaExigencia` (só saio de cena se quem pegou o PR é dono de TODO arquivo em que eu sou). Dono que é TIME (`@org/slug`) é inconclusivo e cai sempre no lado seguro |
| `lib/engine/fanout.js` | Fan-out de revisão em PR grande: mede o PR (`prMetrics`), decide se fatia (`shouldFanOut`), monta os lotes por afinidade de caminho (`planLotes`, função PURA) e injeta o instrutivo (`fanOutBlock`). Determinístico, ZERO IA e zero rede na parte que decide |
| `lib/engine/model-router.js` | **Roteador de modelo por custo-benefício** (quando `reviewModel === 'auto'`). PURA: escolhe haiku/sonnet (+ esforço/fast) pelas métricas do PR. `auto` nunca entra na cmdline do CLI |
| `lib/engine/session.js` | Sessões do Claude: headless (`runClaudeStream`, `buildModelFlags`), terminal por SO (`buildSessionScript`/`Mac`), cancelamento (`killTree`). É aqui que o marcador `FAROL_CHECKPOINT` é interceptado (ver [Checkpoint de verificação](docs/REVIEW-GATES.md#checkpoint-de-verificação-memória-entre-passadas-da-revisão-v2360)); é aqui também que o sid é capturado (`opts.onSession`) e o sufixo de reconexão é anexado (ver [Retomada após falha transitória](docs/REVIEW-GATES.md#retomada-após-falha-transitória-v2573)) |
| `lib/engine/verification-checkpoint.js` | Checkpoint de verificação da revisão headless: memória append-only por PR do que já foi confirmado contra o código (`checkpointPath`, `appendCheckpointEntry`, `readCheckpoint`, `summarizeCheckpoint`, `resumeBlock`). Só o ENGINE escreve, nunca a sessão; detalhe em [Checkpoint de verificação](docs/REVIEW-GATES.md#checkpoint-de-verificação-memória-entre-passadas-da-revisão-v2360) |
| `lib/engine/selfpr.js` | "Meus PRs": autoanálise (nunca posta), `setReviewers` e `mergeSelfPR` (as duas ÚNICAS escritas no GitHub partindo daqui, com os gates travados em `test/merge-gates.test.js`) e o **ocultar PR** (`hidePR`/`unhidePR`/`reconcileHiddenPRs`, estado em `state/hidden-prs.json`, travado em `test/hidden-prs.test.js`). Ocultar é 100% local e **temporário por natureza**: guarda o `updatedAt` do PR e o `check()` desoculta sozinho quando esse carimbo muda (atividade nova). O engine NÃO filtra `myPRs` (quem esconde é a UI, que também mostra os ocultos), e a limpeza de chave órfã é POR CONTA desde a v2.41.2 (`reconcileHiddenPRs(okAccounts)`): só limpa chave cuja conta dona respondeu à busca de PRs meus neste ciclo, senão a queda de UMA conta desocultaria (e apagaria autoanálise) das outras. Não confunda com `setSelfAnalysisVisibility`, que só recolhe a AUTOANÁLISE da tela (o registro fica no disco; ver "A autoanálise PERSISTE" em [Autoanálise](docs/REVIEW-GATES.md#autoanálise-parecer-do-modelo-x-decisão-do-app-p0a-v2548-p0b-v2550)) |
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
| `lib/jira/errors.js` | Taxonomia com três donos de falha (do Farol, do Jira, do usuário). Os códigos `desligado` e `sem_chave` são SILENCIOSOS por decisão, ver [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md#jira-multi-tenant-v2520) |
| `tools/jira-mcp.js` | **O servidor MCP local do Farol** (v2.52.0). Expõe `getJiraIssue` e `searchJiraIssuesUsingJql` já apontados pro site certo. Recebe SÓ o `siteId` por argumento e lê a credencial do disco por conta própria: o `state/spawns.log` registra a linha de comando inteira, então segredo ali seria segredo em texto puro pra sempre |
| `ui/` | UI sem framework: `index.html` + `pure.js` (fachada) + `pure/` + `app.js` + `app.css` |
| `ui/pure.js` | **Fachada** desde a Fase 1a da reorganização (15/09/2026): só reexporta os módulos de `ui/pure/`. Existe para o `ui/app.js` (`import { ... } from './pure.js'`, um `<script type="module">` só) e os testes continuarem importando de um lugar. Nome novo nunca nasce aqui |
| `ui/pure/` | As funções PURAS da UI, um módulo por assunto, em camadas sem ciclo: `comum.js` (formatação, sem dependência; é também o parser único de JSON da UI e santuário do ratchet), `mencoes.js` (menções navegáveis, só de `comum`) e os de domínio (`consumo`, `entregas`, `radar`, `review`, `pessoas`, `autoanalise`, `meus-prs`, `contas`, `jira`, `sistema`, `sobre`, `sessao`, `sync`, `fila-justa`). Único código de front com teste. As regras de quem mexe estão no `ui/pure/README.md`; a superfície pública é congelada em `test/ui-pure-superficie.test.js`, que também reprova nome declarado em dois arquivos |
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
7. **O zip de distribuição é auditado** (`make-package.ps1` falha se detectar estado, config, token ou conta pessoal). Não enfraqueça a auditoria.

## Como rodar e testar sem estragar nada

- **Instância isolada**: `FAROL_HOME=/tmp/farol-teste node server.js` sobe engine + UI em `http://127.0.0.1:47170` sem tocar nos dados reais. Pra trocar a porta, escreva `{"port": 47180, "autoReview": false}` no `config.json` do FAROL_HOME antes de subir.
- **Nunca teste com `autoReview` ligado** numa conta real: PR novo na sua fila dispararia revisão headless de verdade (e potencial APPROVE real).
- **Stubs**: `FAROL_REVIEW_CMD` substitui o `claude` da sessão terminal; `FAROL_HEADLESS_CMD` substitui o headless (imprima um envelope `{"result": "..."}` no stdout).
- **A constituição que o Farol assina é o [eng-behaviour](https://github.com/wandersonaadsantos/eng-behaviour).** É a única, e não existe segunda doutrina valendo aqui. O escopo aplicável está declarado em `eng-behaviour.json` (`core`), o recorte das regras vive versionado em `eng-behaviour.rules.md`, e `npm run eng` roda o gate: `check` (o recorte versionado é byte a byte o que o catálogo gera hoje) e `audit` (regra hard verificada + evidência de avaliação das de julgamento). **Ele NÃO está no `npm run lint`, e portanto não está no CI**; ele mora no pre-push, e como o pre-push também proíbe push direto na main, todo caminho até a main atravessa o gate. As duas razões independentes para isso têm um endereço só, em `docs/QUALITY.md`, seção "A constituição vem do eng-behaviour". **São até 10 avaliações escritas por commit** (uma por regra de julgamento do escopo `core` que a entrega aciona), cada uma com fundamentação própria sobre AQUELE diff: um laço escrevendo a mesma frase em todas passa no gate sem avaliar nada. **Dívida anterior de regra de julgamento mora num baseline finito** (v0.12.0 do pacote): `tools/eng-behaviour/baselines.json`, passado pelo gate com `--repo-id farol`, hoje com os 15 arquivos que violam `core.file.single-responsibility`. Arquivo listado continua sendo avaliado como `violacao`, uma avaliação por arquivo, e a contagem só desce; a condição de fechamento de cada um e as regras de manutenção estão em `docs/QUALITY.md`, seção "Dívida registrada de responsabilidade única".
- **`tools/quality/` continua, e não é o eng-behaviour.** É o enforcement mecânico local do Farol, e ele cobre dois tipos de coisa. (a) A face mecânica de regras que no catálogo são de julgamento: `jsonParseCru`, `jsonStringifyCru`, `processEnvDireto`, `portaLiteral` e `tempoMagico` são todos casos de `core.duplication.business-rule`, fonte de verdade única, que o catálogo não verifica por ferramenta porque distinguir invariante compartilhado de coincidência de valor exige entender o domínio. Aqui o domínio é conhecido e os santuários são nomeados, então dá pra medir. (b) Eixos que o catálogo não tem: `emptyCatch`, `varUse`, `ternarioAninhado` e `profundidadeExcedida`. **Uma divergência declarada:** `maxLines` (400) mede tamanho de arquivo, e `core.file.single-responsibility` rejeita esse eixo por princípio. O contador fica como ratchet sobre dívida já medida, não como afirmação de que tamanho é o critério; se ele sai, é decisão do dono, não descuido.
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
