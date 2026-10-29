> A aprovação agora exige admissibilidade técnica. Consulte a política e a instalação privada em [REVIEW-GATES.md](REVIEW-GATES.md).

# Configuração operacional do Farol

Extraído do `CLAUDE.md` na Fase 1.5 da reorganização. O `CLAUDE.md` da raiz é o sumário, e os
invariantes continuam lá.

O motor externo, o desenvolvimento e os testes exigem Node 24 LTS,
`>=24.22.1 <25`. Selecione 24.22.1 no gerenciador do ambiente do Farol, confira
`node --version` e reinicie o serviço somente em uma janela apropriada depois
de aplicar a atualização. O desktop usa o Node embarcado no Electron, validado
separadamente; o instalador offline dispensa Node externo. O contrato completo
e a orientação para atualizar estão na seção Runtime suportado do `README.md`.

<!-- indice:inicio (gerado; test/guias-navegaveis.test.js reprova se divergir das seções) -->

## Índice

- [Uma decisão, uma configuração (30/09/2026)](#uma-decisão-uma-configuração-30092026)
- [Modelo e esforço das sessões autônomas](#modelo-e-esforço-das-sessões-autônomas)
- [Assinatura do Claude (qual conta/plano o Farol usa, e como alternar)](#assinatura-do-claude-qual-contaplano-o-farol-usa-e-como-alternar)
- [Cadeia de perfis e provedores (20/10/2026)](#cadeia-de-perfis-e-provedores-20102026)
- [Jira multi-tenant (v2.52.0)](#jira-multi-tenant-v2520)
- [Padrões do time na revisão (v2.72.0)](#padrões-do-time-na-revisão-v2720)

- [Avisos de intervenção e voz](#avisos-de-intervenção-e-voz)

- [Especialistas por repositório](#especialistas-por-repositório)
- [Auditoria de reviews](#auditoria-de-reviews)
- [Reserva de cota e recursos](#reserva-de-cota-e-recursos)
- [Interface, retomada e preferências portáveis](#interface-retomada-e-preferências-portáveis)
- [Fontes versionadas e contexto controlado](#fontes-versionadas-e-contexto-controlado)
- [Modo casca e bind (28/10/2026)](#modo-casca-e-bind-28102026)

<!-- indice:fim -->

## Uma decisão, uma configuração (30/09/2026)

Pedido do dono: "Preciso que não exista mais sobreposição de configurações". Duas decisões tinham dois endereços, e para saber o que o Farol faria era preciso ler duas telas e lembrar de uma regra implícita. Agora cada uma tem um.

### Revisar e aprovar sozinho: só na conta

A política mora em `accounts[]`, em quatro campos sempre escritos por extenso, e é editada no cartão da conta (Sistema → Contas) ou, à distância, em Radar → Aparelhos, com as mesmas palavras nas duas telas (`POLITICA_DA_CONTA_TEXTOS`, `ui/pure/contas.js`).

| campo | valores | conta nova |
|---|---|---|
| `autoReview` | `true` (revisa sozinho), `false` (só põe na fila) | `true` |
| `onClean` | `approve`, `wait` | `approve` |
| `onCaveats` | `approve`, `wait` | `approve` |
| `onReject` | `request_changes`, `wait` | `request_changes` |

O padrão da conta nova é **aprovar sozinho (com ou sem ressalvas) e reprovar sozinho** desde 01/10/2026; quem prefere revisar escolhe `wait` no seletor. Conta que já existia **não muda**: ela tem os quatro campos gravados, e a config de antes da primeira migração (sem `esquemaConfig`) recebe o que as chaves antigas diziam, porque atualizar nunca faz o Farol passar a postar no GitHub sem a pessoa ter escolhido. Valor fora do domínio numa edição é recusado e devolvido em `ignorados`, em vez de virar o padrão. Reprovar sozinho não é mais barrado por lacuna de cobertura, checkpoint divergente ou contestação: o card registra o que a leitura não cobriu.

**O com ressalvas nunca é mais permissivo que o limpo**, sem exceção: com `onClean: wait`, `acaoAoAprovar(…, false)` devolve `wait`, a gravação força `onCaveats: wait`, pedir `approve` nas ressalvas é recusado, e as duas telas mostram o seletor desligado com "espera você (o sem ressalvas espera)".

As chaves gerais `autoReview` e `autoApproveAll` (Sistema → Automação) **deixaram de existir como preferência**: saíram de `lib/settings.js`, da tela e do `POST /api/settings` (que as devolve em `ignoradas`). `lib/engine/contas-migracao.js` (puro, idempotente) é o único lugar que ainda as conhece: na carga da config ele escreve em cada conta o que ela já fazia (valor da conta; senão o que ela herdava da chave geral) e apaga as duas chaves do `config.json`. O que mudou fica em `state/politica-historico.json` com origem `migração`.

Três consequências que valem saber:

- **O modo simples virou conta.** Config sem `accounts` valia pela conta única `ghUser` + `owners`, que não tinha onde guardar política e que a tela de Contas não conseguia editar. A migração escreve essa conta na lista, com o mesmo login e as mesmas orgs. Com UMA conta na lista, os campos de Conexões (conta e organizações) continuam editando essa conta.
- **As chaves antigas no arquivo são entrada da migração, sempre.** `{"port": 47180, "autoReview": false}` numa instância de teste continua valendo: enquanto não existe conta, as chaves esperam; quando o login do `gh` é detectado, a conta nasce com `autoReview: false`. Para deixar explícito, escreva a conta: `{"accounts": [{"user": "login", "owners": [], "autoReview": false}]}`.
- **A única diferença de comportamento, e ela só restringe:** conta com `onClean: wait` e `onCaveats: approve` por escolha própria aprovava sozinha o PR com ressalvas e segurava o limpo. Agora ela espera você nos dois, e a migração grava `onCaveats: wait` nela.

### Review por organização e autor

Em Sistema → Contas, cada cartão tem o bloco **Review por organização e autor**.
Uma regra pode escolher **Automático** ou **Manual** para uma organização inteira,
ou para um login de autor dentro dela. O autor tem precedência sobre a organização;
sem exceção vale a organização e, sem regra para ela, vale a configuração atual da
conta revisora. A conta em "só põe na fila" continua impedindo o início automático.
As organizações monitoradas no panorama não são uma lista de permissão: regras também
se aplicam a PRs de outras organizações encontrados por pedido de revisão.

As regras ficam no campo opcional `accounts[].reviewRules`, por exemplo:
`{"acme":{"mode":"manual","authors":{"joao":"auto","maria":"manual"}}}`.
Ausência do campo não exige migração nem muda as opções já salvas. "Seguir conta",
"Seguir organização" e Remover eliminam apenas a regra escolhida, restaurando sua
herança; editar uma regra não regrava as demais regras nem as políticas de publicação.

**Manual** permite o clique Revisar, mas impede retentativas automáticas, mesmo de
uma sessão iniciada por clique, e novas rodadas após push ou resultado em head antigo.
Sem regras novas, as retentativas mantêm o contrato anterior. O engine consulta a
regra atual ao selecionar, enfileirar e iniciar a sessão; um item que passou a manual
enquanto esperava vaga volta à fila visível, sem perder a referência de retomada.
Uma sessão que já começou não é cancelada pela edição. Aprovar e pedir mudanças
continuam obedecendo às opções de publicação existentes na conta.

### Paralelismo: cada número diz uma coisa só

| número | onde | o que é |
|---|---|---|
| `parallelReviews` (1 a 4) | Automação, "Revisões paralelas por conta" | limite POR CONTA, sempre, com ou sem o compartilhamento entre aparelhos |
| `globalParallelReviews` (0 a 8) | Automação, "Teto total deste aparelho" | total do aparelho somando todas as contas; 0 = sem teto total |
| `tetoParalelismo` da política (1 a 4) | Sistema → Aparelhos e Radar → Aparelhos, "Teto total do aparelho" | o mesmo total, definido pelo admin à distância |

O total que vale é o MENOR entre o do aparelho e o do admin (`politica-efetiva.js`, o remoto só restringe). Sem um deles, vale o outro; sem nenhum, não há teto total e o que limita é o limite por conta. Até 30/09/2026, com o compartilhamento ligado, `parallelReviews` virava calado o total do aparelho e o limite por conta passava a ser 4 fixo: o mesmo número queria dizer duas coisas conforme uma chave em outra tela.

**Atualizar não faz nenhuma instalação trabalhar mais.** Quem já tinha o compartilhamento ligado praticava `parallelReviews` como total do aparelho. Na primeira carga depois da atualização, `migrarParalelismo` (`lib/engine/contas-migracao.js`) grava esse total em `globalParallelReviews`: o menor entre `parallelReviews` e o `globalParallelReviews` que já existia (o escalonador também o aplicava). O limite por conta fica menor ou igual ao total, então roda o mesmo de antes com qualquer número de contas, e a mudança fica no rastro com origem `migração`. O predicado é o mesmo da admissão (`sharedActive`, `lib/sync/config.js`); instalação sem compartilhamento não é tocada, porque nunca teve total de aparelho além do `globalParallelReviews`. A migração roda uma vez: o marcador é `esquemaConfig: 1` no `config.json`, gravado na primeira carga tenha ela mudado algo ou não. Por isso quem depois puser "Teto total deste aparelho" em "Sem teto total" de propósito fica sem teto, e aí sim o total passa a ser `parallelReviews` vezes o número de contas: é escolha, não efeito da atualização. O mesmo vale para quem ligar o compartilhamento depois da atualização com o teto total em 0.

O que o aparelho publica como capacidade (`paralelismo`, em `live/deviceStatus`) continua sendo um número, com o mesmo nome de campo, para o agendador do admin e para a frota em versão antiga: o teto total que está valendo, ou, sem teto total, a soma dos limites por conta (`parallelReviews` vezes o número de contas, `admissao.totalDoAparelho`).

## Modelo e esforço das sessões autônomas

Dois campos de config (`reviewModel`, `reviewEffort`) que viram as flags `--model` e `--effort` da linha headless. São os **únicos valores de configuração que entram numa linha de comando montada por concatenação e passada a um shell** (`cmd.exe /d /s /c` no Windows, `/bin/sh -lc` no mac), então a defesa é **allowlist, nunca escaping**, em `lib/parse.js` (`sanitizeModel`, `sanitizeEffort`, `effortForModel`), aplicada em TRÊS camadas: no boot (construtor da `Engine`, pra config.json editado à mão), no `updateSettings` (caminho HTTP) e de novo em `buildModelFlags` (defesa em profundidade). Valor inválido no `updateSettings` MANTÉM o anterior; no boot vira `''`.

`buildModelFlags(config, opts)` (`lib/engine/session.js`) é **pura e exportada**: é o único ponto onde a flag é montada, e existe separada justamente pra ser testável (antes a montagem vivia dentro do `runClaudeStream`, que faz spawn, e o stub suprimia a flag, ou seja: não dava pra provar o que ia pra linha). Com `FAROL_HEADLESS_CMD` setado ela devolve `''`, contrato do qual toda a bateria stubada depende.

**Modelos expostos** (7): `''` (padrão), `auto`, `best`, `opus`, `sonnet`, `haiku`, `fable`. Os 5 aliases de família foram testados contra o CLI 2.1.220 e todos respondem. **`auto` é do Farol, não do CLI:** desde 26/09/2026 a qualidade vem antes do custo: `lib/engine/model-router.js` revisa todo PR com o Opus no esforço herdado (o mesmo do Opus fixo, sem modo rápido) e sobe para `--effort xhigh` em repositório crítico, caminho sensível ou PR muito grande. Até ali o Auto mandava PR pequeno para o Haiku em modo rápido e o resto para o Sonnet, e a auditoria que mediu isso (14 aprovações re-revisadas pelo Opus no mesmo head, uma delas REQUEST_CHANGES) está no comentário de `AUTO_POR_FAIXA`, em `lib/modelos.js`; `sanitizeClaudeModel('auto')` devolve `''` pra nunca mandar `--model auto` (o CLI mataria a sessão). **Fora de propósito:** `opusplan` (o `claude -p` não tem plan mode, a sessão inteira cairia pra Sonnet sob rótulo de Opus), `default` (indistinguível de `''`, já que o Farol nunca seta `ANTHROPIC_MODEL`) e `opus[1m]`/`sonnet[1m]` (colchete é **glob pro `/bin/sh`**: rodando com cwd no WORKSPACE, `opus[1m]` casaria com um arquivo `opus1` e viraria outro argumento, calado; sem match o sh deixa passar, então "funciona quase sempre", que é pior). Se um dia quiser as variantes `[1m]`, o caminho é aspa simples no lado POSIX e valor cru no Windows, decidido dentro do próprio montador, com teste de execução real em `sh`. Nome completo (`claude-opus-5`) é aceito pelo engine via `MODEL_FULL_RE`, como escotilha pra modelo novo sem release, mas não é oferecido no select.

**Esforço exposto** (4 + padrão): `low`, `medium`, `high`, `xhigh`. `max` e `ultracode` ficam **fora**: são session-only (nem o `settings.json` do próprio CLI os aceita) e a revisão headless roda desacompanhada com timeout de 30 minutos, o pior lugar possível pra eles. Vale pros CINCO chamadores de `runClaudeStream` (review, autoanálise, pushback, chat, ferramentas); a sessão no TERMINAL nunca é afetada, e o texto da UI promete isso. Verificado contra o CLI real: `--effort` **convive com `--resume`** (o chat não quebra) e nível desconhecido só emite warning, não mata a sessão. Já modelo inválido **mata** a sessão, daí a allowlist ser mais estrita do lado do modelo.

`effortForModel` só derruba o esforço quando o modelo é `haiku`, a única incompatibilidade afirmável pelo alias (o alias diz a FAMÍLIA, não a versão: `opus` pode resolver num 4.6, que não tem `xhigh`). Nos demais, o CLI decide. A UI espelha isso desabilitando os cartões com Haiku escolhido.

**Adiamentos conscientes:** não há override de modelo/esforço **por conta**. `claudeProfileId` tem porque `runClaudeStream` já resolve a assinatura por `opts.account` dentro do `ghEnv`, e o chat passou a passar `opts.account` (conta dona do PR da conversa, correção do gap A3). `tools.js` segue sem passar: um override por conta funcionaria em 4 dos 5 chamadores e seria ignorado em silêncio nas ferramentas, exatamente o anti-padrão de "setting que a UI mostra e o engine descarta". Fazer direito exige costurar `account` no `tools.js`.

## Assinatura do Claude (qual conta/plano o Farol usa, e como alternar)

O Farol roda `claude -p ...` (headless, **sem `--bare`**) e o `claude` interativo no terminal. **Qual assinatura/plano é usado é decisão da autenticação do próprio `claude`, não do config do Farol.** Precedência oficial (docs code.claude.com): cloud provider → `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` → `apiKeyHelper` → `CLAUDE_CODE_OAUTH_TOKEN` → **assinatura OAuth logada via `claude login`** (default). Sem nenhuma env var de auth, usa o OAuth logado, guardado em `.credentials.json` dentro do config dir (`~/.claude.json`/`~/.claude/` por padrão, ou o que `CLAUDE_CONFIG_DIR` apontar).

Como o Farol espalha `process.env` pros filhos, por padrão ele herda o login da máquina. Formas de trocar, da mais simples à recomendada:

1. **Máquina toda:** `claude login` (troca a conta pra tudo, inclusive seu Claude Code interativo de codar). Simples, mas não isola o Farol.
2. **Um diretório de config isolado (o que já existia):** aponte `config.claudeConfigDir` pra um diretório próprio. O engine injeta `CLAUDE_CONFIG_DIR` nesse dir em TODAS as sessões do Farol, então elas usam a assinatura logada ali, sem mexer no `claude` principal da máquina.
3. **Perfis nomeados de assinatura, um por conta GitHub monitorada (recomendado, desde a v2.27.0):** em Sistema > **"Plano e chaves"**, o campo único virou um gerenciador de perfis. Cada perfil tem um nome (ex.: "BIUD Trabalho", "Pessoal Max") e um diretório de config próprio. Desde a v2.75.0 o padrão do Farol é o primeiro perfil ligado da **ordem de uso** (ver [Cadeia de perfis e provedores](#cadeia-de-perfis-e-provedores-20102026)) e, se quiser, atribua um perfil diferente a uma conta GitHub específica (Sistema > Contas, override por conta). Sem override, a conta usa a cadeia; sem nenhum perfil ligado, vale o `claudeConfigDir` legado como sempre valeu (compatibilidade total).

**O login padrão da máquina como perfil (kind `maquina`, 20/10/2026):** sem pasta indicada, o Claude Code usa o login de `~/.claude` com a conta em `~/.claude.json`, e até aqui esse login não aparecia na lista de perfis. Agora ele se lista pelo cartão "Login padrão desta máquina" em Sistema > Plano e chaves (a gravação é do engine, pela mesma rota da adoção, `POST /api/claude/profile-adopt`): vira o perfil de id fixo `maquina`, com nome editável e orçamento, que se escolhe como padrão do Farol, numa conta do GitHub ou num grupo de consumo. Ele **não aponta `CLAUDE_CONFIG_DIR` para lugar nenhum**: a sessão entra exatamente como entrava sem perfil. Medido com o Claude Code 2.1.295: com `CLAUDE_CONFIG_DIR=~/.claude` o CLI passa a ler a conta de `~/.claude/.claude.json` (diz que o arquivo não existe e cria `backups/`), não de `~/.claude.json`, ou seja, é outro login; no macOS o item do keychain também ganha sufixo derivado da pasta. Listar não troca a assinatura de ninguém: o padrão do Farol só vira `maquina` quando estava vazio, e vazio já era esse mesmo login.

**Login de perfil pela própria tela (20/10/2026, `lib/engine/login-web.js`):** sem terminal para abrir (modo servidor, como a instância da Hostinger, e Linux sem emulador), o "Abrir sessão de login" abre um painel na tela: o engine roda `claude auth login` com a pasta do perfil, mostra o link de autorização e um campo para colar o código que a página da Anthropic mostra no fim. Medido com o Claude Code 2.1.295 sem TTY (stdin em pipe): o CLI imprime o link (com `redirect_uri` na página da Anthropic que exibe o código, então o navegador pode estar em outra máquina), escreve `Paste code here if prompted >` e lê o código do stdin; código falso devolve `Login failed: Request failed with status code 400` e sai com 1. Zero dependência nova. O código é credencial de uso único: vai só para o stdin do CLI (rota `recebe-segredo` no inventário da A4) e nunca para log, snapshot ou toast. Não medido: o login que dá certo (o sucesso é a saída 0, conferida pelo doctor) e o CLI tentando abrir navegador numa máquina sem nenhum. O comando de terminal segue no painel como alternativa.

**Perfil por chave de API (desde a v2.34.0):** cada perfil pode ser "login por assinatura" (o de sempre, `CLAUDE_CONFIG_DIR`) ou "chave de API" (`ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL` opcional, billing por token em vez de assinatura). Os dois convivem no mesmo gerenciador de perfis e são escolhidos por conta GitHub do mesmo jeito. Perfil de chave não tem fluxo de `claude login` (a chave já é a credencial) e cobre tanto as sessões headless quanto a sessão de terminal interativa da fila, a sessão de LOGIN em si (botão "Abrir sessão de login") segue existindo só pro tipo assinatura. URL base é um escape hatch genérico pra qualquer endpoint compatível com a API de Mensagens da Anthropic (proxy próprio, gateway corporativo).

**Perfil OpenRouter (kind `openrouter`):** usa o Claude Code apontado pro [Anthropic Skin](https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration) em `https://openrouter.ai/api` (sem `/v1`). Auth: `ANTHROPIC_AUTH_TOKEN` = chave `sk-or-...`, `ANTHROPIC_API_KEY` = string **vazia** (não unset: o CLI exige o vazio explícito pra não autenticar na Anthropic direto), `ANTHROPIC_BASE_URL` = o Skin. Sem fluxo de `claude login`. O modo **Auto** do Farol (`reviewModel: auto`) continua sendo o roteador local, decidido pelo contexto e pelo tamanho do PR; não é o `openrouter/auto` da OpenRouter (que otimiza adequação à tarefa, não custo). Modelos não-Anthropic pelo Skin não são garantia do Claude Code.

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

   **A tela diz a diferença entre vazio e 0** (23/10/2026). Os campos dizem "vazio = sem
   teto", uma linha logo abaixo explica que 0 pausa a revisão automática do perfil (o
   clique manual continua valendo), e com teto 0 valendo hoje a linha do gasto diz
   "teto 0: revisão automática pausada" em vez de só "de US$ 0.00". Nasceu de um 0
   digitado para tirar o limite, que parou as revisões de uma conta inteira com "o
   orçamento estourou". Travado em `test/teto-vazio-x-zero-na-tela.test.js`. Na mesma
   entrega, a boca da sessão (`runOneHeadless`) passou a deixar o clique manual
   atravessar o orçamento, como já fazia com o limite do plano: antes o botão Revisar de
   um PR estacionado por orçamento estacionava de novo enquanto o teto seguisse
   estourado, contra o que esta seção promete. Travado em `test/check-resilience.test.js`.

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
**Alternar assinaturas** vira trocar de perfil (ou, no modo legado, trocar o caminho): mantenha um dir por assinatura (`.claude-pessoal`, `.claude-trabalho`), um perfil pra cada. Cada conta e cada perfil mostram um selo com a conta em uso (email do `oauthAccount`) e avisam **"SEM LOGIN"** se o dir apontado não tiver `.credentials.json` (você esqueceu o `claude login` nele); o selo se atualiza sozinho ao salvar, sem precisar de "Reverificar" manual. **Pegadinha:** o login é interativo e tem que ser feito ANTES; sessão headless com dir sem credencial falha. **As vars de auth do ambiente da máquina são ignoradas de propósito:** `applyClaudeAuthEnv` (`lib/parse.js`) limpa `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CONFIG_DIR` e `CLAUDE_CODE_OAUTH_TOKEN` em TODA sessão que o Farol dispara, antes de aplicar o perfil resolvido, justamente pra um perfil de assinatura (dir) ou de chave nunca ser sobrescrito em silêncio por uma var de ambiente perdida no processo (ex.: perfil de shell do usuário, sem relação com o Farol). `CLAUDE_CODE_OAUTH_TOKEN` também é removido porque vence o login do diretório selecionado e pode manter um token expirado em toda sessão nova. Além das credenciais, URL e diretório também precisam de isolamento: a URL base redireciona o endpoint (mandaria credencial de assinatura pra host de terceiro) e o config dir troca a conta logada. **No posix, limpar o env NÃO basta** (G21): o profile do usuário é sourceado DEPOIS do env montado (o `-l` do `/bin/sh -lc` no headless, o login shell do Terminal.app antes do `.command`), então um `export ANTHROPIC_API_KEY` perdido no `~/.profile` re-injetava a chave por cima do perfil resolvido. Por isso o `unset` dessas variáveis é emitido DENTRO do shell, depois de qualquer sourcing e antes do `exec` do claude, e o perfil resolvido é re-exportado logo em seguida (no Windows não existe esse sourcing, o `cmd.exe` não lê profile nenhum, então lá o env limpo basta). **Limitação conhecida, e é deliberada:** no headless posix com perfil de **chave de API** o prefixo remove apenas `CLAUDE_CODE_OAUTH_TOKEN`, sem restaurar as variáveis `ANTHROPIC_*`, porque re-setar a chave ali a colocaria na linha de comando, visível no `ps` de qualquer processo da máquina; a chave viaja só pelo env, e um profile sujo ainda vence nesse caso específico. Nos scripts de terminal isso não se aplica (a chave já está no arquivo, então o unset sai e a chave é re-exportada depois). Backlog pra fechar de vez: passar a chave por uma var sombra, com o script traduzindo pra `ANTHROPIC_API_KEY` depois do sourcing. **O console de login** (`loginConsoleEnv`, `lib/engine/session.js`) usa o mesmo `applyClaudeAuthEnv` e ainda apaga o `GH_TOKEN` herdado: "sem token de conta" era promessa do comentário e do teste, mas não injetar não impede HERDAR, e o `gh` de lá cai no login do próprio keyring, como tem que ser. **O mesmo furo existia pro token do GitHub, e quem denunciou foi o gate de pré-push** (30/08/2026): `ghEnv` (`server.js`) também parte de `{ ...process.env }`, então um `GH_TOKEN` exportado no shell de quem abre o Farol entrava no filho sempre que não havia token resolvido (primária sem token, o caminho legado do doctor/boot), e o `gh` saía agindo como o dono daquela variável, em silêncio, que é o A1 por outra porta. Hoje `ghEnv` apaga `GH_TOKEN` e `GITHUB_TOKEN` ANTES de setar o da conta (as DUAS porque o `gh` lê as duas no github.com, com `GH_TOKEN` vencendo e `GITHUB_TOKEN` de reserva: limpar uma só deixaria a herança entrar pela vizinha), e "sem token" volta a significar o que sempre quis dizer, que é o `gh` cair no próprio keyring. O sintoma foi um teste: `ghEnv: sem user e sem token nenhum não lança` reprovava na máquina de quem exporta `GH_TOKEN` no shell, bloqueando o push com cara de regressão, porque a invariante estava sendo afirmada pelo AMBIENTE e não pelo código, o mesmo diagnóstico do `loginConsoleEnv` logo acima. Quem quiser billing por API tem que usar o **perfil por chave de API**, documentado no parágrafo acima ("Perfil por chave de API"), que é o jeito suportado hoje; setar a var no ambiente da máquina não tem mais efeito em nenhuma sessão do Farol. **Nunca** logar/gravar credencial pelo Claude Code em nome do usuário: o `claude login` é ação dele.

### Falhas de autenticação

`OAuth access token has expired` é credencial expirada, mesmo quando a mensagem contém tentativas de reconexão. A taxonomia estaciona a revisão na primeira falha e a fila orienta renovar o login do perfil, inclusive para registros antigos estacionados por esgotamento de retries. Remover `CLAUDE_CODE_OAUTH_TOKEN` herdado isola o perfil escolhido; não renova uma credencial já expirada.

O que acontece com a revisão estacionada, e quando ela volta a rodar, está em [`REVIEW-GATES.md`](REVIEW-GATES.md#ciclo-de-vida-e-higiene-onda-3-dos-gaps-da-auditoria-de-15082026).

## Cadeia de perfis e provedores (20/10/2026)

Pedido do dono: "definir por ordem qual a conta que consome primeiro e qual é fallback da conta prioritária, assim sempre vou ter algumas opções sem travar o Farol". Com o exemplo dele: Gemini X principal, Gemini Y fallback 1, Claude Max BIUD fallback 2. "Caso estourou a conta Gemini X, salva quando volta o limite e vai direto pra Gemini Y, e assim por diante, e segue a prioridade de qual vai consumir primeiro."

### A cadeia

`config.cadeiaPerfis` é a lista ordenada `[{ id, ativo }]` com TODOS os perfis salvos, editada em Sistema > Plano e chaves > Ordem de uso (subir, descer, ligar, desligar; `POST /api/settings` com a lista inteira, porque a ordem é o conteúdo). `lib/engine/cadeia-perfis.js` escolhe, a cada pergunta, o perfil de uma conta (`authDaConta`, que é o corpo do `Engine.resolveClaudeAuth`):

1. conta do GitHub com perfil próprio (`accounts[].claudeProfileId`): SÓ esse perfil, como antes;
2. senão, o primeiro perfil **ligado** e **pronto** da cadeia;
3. sem nenhum pronto, o de **reset mais cedo** entre os que estão no limite (a fila espera por ele);
4. sem limite nenhum, o primeiro **sem login** (o que a cadeia de um perfil só já fazia: tenta e mostra a falha);
5. sem perfil ligado, o `claudeConfigDir` legado.

O estado de cada perfil: `desligado`, `problema` (falta pasta ou chave: `authFromProfile` devolve null), `limite` (registro de `lib/engine/limite-plano.js` ainda valendo), `sem-login` (o último diagnóstico disse `ready: false` ou uma sessão comprovou OAuth expirado) e `pronto`. A tela recebe a cadeia avaliada no snapshot (`cadeiaPerfis`, `cadeiaParaTela`), com o `em-uso` marcado, a hora do reset e se ela é estimada.

**Login expirado (v2.76.2).** Uma revisão recusada por OAuth expirado marca a assinatura usada como indisponível e volta à fila no próximo perfil ligado e pronto, inclusive de outro provedor. A nova tentativa começa sem os identificadores de retomada anteriores, inclusive o do round incremental. Perfis desligados, sem login, limitados ou que compartilham a credencial vencida não são alternativas. Conta com perfil próprio não transborda, independentemente de maiúsculas no login; sem alternativa pronta, a revisão estaciona com o erro de autenticação, sem loop. O diagnóstico local não apaga essa falha só porque o arquivo de credencial existe. A mudança nos metadados de `.credentials.json`, um login pela tela confirmado pelo CLI, o status confirmado ao fechar o terminal de login do Farol ou uma sessão bem-sucedida libera o perfil. A confirmação do terminal também cobre o Codex e o keychain do macOS. O registro fica na memória do processo e contém somente metadados, sem tokens; ao reiniciar, o Farol pode tentar a credencial novamente. Um login externo ao Farol que não altere esse arquivo pode exigir uma tentativa manual para comprovar a recuperação. Login expirado não cria cota nem hora de reset.

**Limite do plano.** Não existe segundo registro: o "no limite até" é o de `lib/engine/limite-plano.js`, por chave de assinatura, em disco. O que mudou nele:

- a sessão amarra o desfecho à assinatura que USOU (`comPerfilDaSessao` no `runProvedor`, sem a chave): a falha leva `err.perfilDaSessao` e o limite é registrado nela, e o sucesso libera exatamente esse perfil. Pela conta não dava: com a cadeia, quando o desfecho chega a conta já pode resolver para outro perfil (duas sessões no mesmo perfil, uma estoura e a outra conclui);
- reset citado pelo provedor substitui o prazo estimado do mesmo perfil, mesmo quando é mais cedo;
- todo perfil Codex usa o mesmo login do Codex CLI da máquina, então o limite é um só (`codex:`) e vale para todos eles; perfil Codex com o plano ChatGPT sem login (`codexChatGPT: false` no diagnóstico) conta como sem login. A cota do Codex (`codex: cota do plano atingida; resets ...`) está na classe `limite-plano` da taxonomia;
- **reset desconhecido** (o provedor não disse a hora): o perfil fica fora por `TEMPOS.LIMITE_PLANO_SEM_HORA_MS` (uma hora), marcado `estimado`, visível na tela como "(estimado)". Antes o limite sem hora não era registrado e cada PR descobria o limite de novo a cada ciclo, até o teto de tentativas e o estacionamento; com a cadeia isso seria a fila inteira batendo no perfil esgotado em vez de seguir para o próximo. Uma hora fica entre o ciclo de polling (relançar a cada 3 minutos é pagar sessão para redescobrir o limite) e a janela de 5 horas do plano. Uma sessão que dá certo libera o perfil antes;
- **revisão que morre por limite no meio** (`lib/engine/limite-na-cadeia.js`, `aposLimite`): registra o limite no perfil usado e, se a cadeia tem outro perfil livre para a conta, o PR entra no retry com `notBefore: null` e relança no ciclo seguinte, no perfil seguinte, sem clique e sem gastar o teto de tentativas (a troca não conta, e com perfil livre o PR não estaciona). A varredura de pushback segue a mesma regra: limite sem hora vira prazo estimado no perfil usado, e a cadeia segue para o próximo. A referência de retomada da sessão anterior é descartada pelo contexto (provedor e perfil mudaram, `lib/engine/retomada-duravel.js`): a revisão nova começa do zero;
- **todos no limite**: o `limiteAte` da conta passa a ser o primeiro reset. A boca da sessão, o retry e a fila automática já consultavam esse valor, então o PR espera sem abrir sessão, sem estacionar e sem gastar tentativa. Quando o reset passa, o registro vence sozinho e o perfil prioritário volta a ser o escolhido, porque a escolha é refeita a cada pergunta. Clique manual continua passando (invariante 4).

**A relação com o que já existia, e nada fica mais permissivo:**

| peça | com a cadeia |
|---|---|
| perfil padrão do Farol (`claudeProfileId`) | continua existindo, DERIVADO: o primeiro perfil ligado da cadeia. Gravação que só troca o padrão (adoção do legado, listar o login da máquina) põe o escolhido no topo, ligado |
| perfil por conta do GitHub | fixo, fora da cadeia. Deixar a conta transbordar faria uma conta presa à assinatura do trabalho gastar a pessoal. Cadeia própria por conta fica para quando houver o pedido |
| orçamento por perfil | não troca de perfil: estourou, a automação pausa como antes (o orçamento é ritmo escolhido pelo dono, e a cadeia não é jeito de contorná-lo) |
| grupo de consumo | vale sobre o perfil escolhido, como valia sobre o padrão |
| política do admin (sincronização) | não fala de perfil; teto e pausa continuam valendo por cima |
| perfil novo | entra desligado: nenhuma assinatura passa a gastar sem escolha |

**Migração.** Config sem `cadeiaPerfis` (`def: null` em `lib/settings.js`) ganha, no boot, a cadeia com o perfil padrão de hoje ligado e os outros desligados (`reconciliar`, idempotente, também roda depois de toda gravação de configuração). Comportamento idêntico ao de antes. Perfil removido sai da cadeia na mesma gravação.

### Modelo e esforço por provedor

Cada provedor tem o próprio par de campos (`reviewModel`/`reviewEffort` do Claude, `codexReviewModel`/`codexReviewEffort` do Codex, `agyReviewModel`/`agyReviewEffort` do Antigravity), escolhidos em Plano e chaves junto da cadeia. A sessão usa o par do provedor do perfil que a cadeia escolheu. Modelo de um provedor nunca chega à linha de comando de outro: cada par passa pelo saneador do próprio provedor em `lib/parse.js`, que continua sendo a única porta de valor de config para a linha de comando, e o vocabulário de um é recusado pelo outro (`test/settings-model-effort.test.js`, `test/cadeia-perfis.test.js`).

### O contrato de um provedor novo

`lib/engine/provedores.js` é o registro. O Antigravity CLI (`agy`) foi o primeiro a entrar por este contrato (20/10/2026, seção seguinte); `RESERVADOS` ficou vazio. Um provedor novo só precisa declarar:

1. **como roda**: os `kinds` de perfil que são dele, e o ramo de execução no `runProvedor` (`lib/engine/session.js`), que deve passar a promessa por `comPerfilDaSessao` para o desfecho levar a assinatura usada; se todos os perfis do provedor dividem um login só, como no Codex, `chaveDaAssinatura` dá a eles a mesma chave;
2. **quais modelos aceita**: `campoModelo` e `campoEsforco` (chaves novas em `lib/settings.js`), `saneiaModelo` e `saneiaEsforco` em `lib/parse.js` (allowlist, nunca escaping) e o catálogo da tela em `lib/modelos.js`;
3. **como sinaliza o limite com a hora do reset**: `limiteDaMensagem(msg, agora)` devolve `{ limite, ate }`. O padrão (`limitePelaTaxonomia`) lê a classe `espera-reset` de `lib/log-taxonomy.js` e a hora com `resetAtFrom`; provedor com frase própria cadastra a classe lá (a tabela é a fonte única de classificação, invariante 3) ou declara a leitura dele. `ate: null` vira o prazo estimado.

A cadeia, o registro de limite, a escolha de perfil e a tela não mudam. A chave do limite (`chaveDaAssinatura`) é `<kind>:<id>` para perfil sem pasta, então o provedor novo já tem o registro dele.

### Antigravity CLI (agy, 20/10/2026)

Gemini pela cota do plano Google, pelo `agy` 1.4.3. Medição, números e riscos em
`docs/superpowers/specs/2026-10-20-agy-provedor.md`; o código mora em `lib/agy/`.

**Perfil.** Kind `agy` em Sistema > Plano e chaves: nome e, opcional, o e-mail da conta Google
esperada (`{ id, label, kind: 'agy', email? }`, saneado em `lib/parse.js`). A pasta da conta é
`~/.farol/agy/<id>/`, derivada do id e nunca escrita na config: é a home do `agy` daquele perfil
(token do login Google em arquivo, configuração, logs, conversas), 0700 no POSIX, fora do
workspace da sessão, do pacote, do diagnóstico e da sincronização. O login é sempre pela tela
(o mesmo painel do Claude, `lib/engine/login-web.js`): o `agy -p /usage` na pasta do perfil
imprime o link do Google e lê o código pela entrada padrão por 60 segundos; o comando
equivalente aparece no painel para quem prefere o terminal.

No Linux, o login pela tela usa o pseudoterminal do util-linux (`/usr/bin/script`) e
`stty`, exigidos pelo `agy` 1.4.3 para oferecer o link com entrada aberta. O eco do código
fica desligado e a transcrição vai para `/dev/null`. Cancelamento e prazo encerram também
o CLI na sessão do terminal; uma saída zero depois do cancelamento não confirma o login.
Windows e macOS continuam com a entrada padrão direta.

**Várias contas na mesma máquina.** Por padrão o `agy` guarda o login numa vaga única do
chaveiro do sistema. Com `SSH_CLIENT` no ambiente ele usa um arquivo dentro da home, e o filho
recebe `USERPROFILE=<pasta>` (Windows, com HOME intacto, porque o `git` lê HOME) ou
`HOME=<pasta>` com `GIT_CONFIG_GLOBAL` para o `~/.gitconfig` real (POSIX). `GEMINI_API_KEY`,
`GOOGLE_API_KEY` e `AGY_ADC_AUTH` herdados saem (cobrariam por token ou por conta de
aplicativo); o `GH_TOKEN` da conta segue. Isso é detecção de ambiente do CLI, não contrato do
produto: antes de cada sessão o Farol lê no log do `/usage` a conta que autenticou e se o token
veio de arquivo. Token do chaveiro, ou conta diferente do e-mail esperado, param com a classe
permanente `agy-conta-trocada`, que a cadeia não confunde com cota. Sem e-mail registrado, só a
origem do token é conferida.

**Modelo e esforço.** O padrão é `gemini-3.8-flash-high` (`agyReviewModel`), o único que repetiu o
veredito certo na medição, e o `agy` nunca sai sem `--model` (o padrão da conta pode ser outro).
`gemini-*-flash-low` fica fora da allowlist (inventou o alcance e aprovou errado); `claude-*` e
`gpt-*` pela cota do Google são aceitos só por escolha explícita (outro balde, cerca de quatro
vezes o custo). No Gemini o esforço está no nome do modelo, então `--effort` só vai para Claude
e GPT; `max` fica fora, como no Claude.

**Sem o subagente.** A revisão no `agy` roda sem o `pr-reviewer`: o prompt ganha no fim o bloco
do provedor (`lib/agy/protocolo.js`), que manda a sessão principal fazer a revisão dele e
declarar `protocolo.prReviewer = "dispensado"` com o motivo, o que o gate aceita
(`lib/technical-review/evidence.js`). O marcador `FAROL_CHECKPOINT: {...}` vai como linha de texto
(não há `description` de Bash), e o envelope é a última mensagem, sozinho.

**Protocolo inteiro.** O `agy` não lê `CLAUDE.md`; lê `.agents/rules/` e corta cada arquivo em
24.000 bytes. A cada sessão o `CLAUDE.md` do workspace é partido por seção em
`.agents/rules/farol-protocolo-NN.md`, cada parte abaixo do teto (`test/agy-puro.test.js` reprova
parte acima dele).

**Resultado.** O texto do ÚLTIMO passo `agent_response` do stream, nunca o `result.response`, que
é o turno inteiro e, com prosa e marcador antes, não começa no envelope. O teto de tempo do
`agy` (`[agy] print timeout`) devolve SUCCESS vazio e é falha transitória; saída sem `result` é
falha. Nos três provedores, o Farol interrompe após 30 minutos sem eventos de progresso
ou no teto absoluto de duas horas. Eventos de resposta e ferramentas renovam a janela;
ruído de saída e tentativas de reconexão não renovam. O cancelamento continua imediato.

**Cota e cadeia.** `agy -p /usage --output-format json` (zero token) dá, por grupo de modelos, a
fração restante e o reset de cada bucket. Antes de abrir a sessão o perfil é lido (cache de 60
segundos, `TEMPOS.AGY_COTA_CACHE_MS`; a ordem de uso também agenda a leitura sem esperar por
ela). Grupo do modelo com bucket esgotado registra o perfil "no limite até" o maior reset dos
buckets esgotados, no mesmo `lib/engine/limite-plano.js` (chave `agy:<id>:<grupo>`: o limite do
Gemini não trava o balde Claude e GPT), e a cadeia passa para o próximo perfil sem abrir nada no
esgotado. Saldo positivo libera também um bloqueio com reset confirmado quando a consulta
começou depois do bloqueio, está recente e confirma a conta esperada no arquivo do perfil.
Leitura antiga, falha ou de outra conta não libera o bloqueio. Falha de cota no meio (`AGY_ERROR:` com saída 3, `RESOURCE_EXHAUSTED`, `You have
exhausted your quota`, `QUOTA_EXHAUSTED`, `individual quota reached`) é confirmada pelo `/usage`:
a mensagem ganha a frase `resets <Mon> <dia> at <h:mm>am` e o erro leva `err.limitePlano.ate`, que
o `aposLimite` lê antes do texto. `MODEL_CAPACITY_EXHAUSTED` e 503 sem capacidade são
passageiros (`capacidade-agy`). As classes estão em `lib/log-taxonomy.js`.

**Consumo.** Tokens do principal (entrada, saída, raciocínio, leitura de cache) pelo `usage` do
`result`, que já é o total do turno: os passos só valem quando o `result` não chega. Custo em
dólar `desconhecido`, como o Codex; teto em US$ e grupo de consumo tratam o `agy` como não
controlado (`semCustoEmDolar` em `lib/engine/provedores.js`).

**Chat por PR e retomada.** O `--resume <id>` vira `--conversation <id>`. Id que o `agy` não
conhece não falha: ele abre outra conversa calado. O `conversation_id` do `init` diferente do
pedido para a sessão antes do modelo, com a frase de retomada recusada que o chat e a retomada
já tratam como "recomece sem retomar".

**Disco.** `brain/`, `conversations/` e `log/` crescem por sessão. Conversa de ferramenta e
pushback sai no fim da sessão; as outras saem depois de um dia, menos a do chat por PR e a da
revisão pendente que o chat herda; ficam os 30 logs mais novos.

**Diagnóstico.** O doctor diz a versão do `agy` e, por perfil, se há login e a última cota lida;
o aviso de runtime acusa `agy` ausente ou perfil sem login. A pasta do token nunca é listada.

**O que não está coberto.** O MCP do Jira na home da sessão (o card continua entrando no prompt
pelo bloco do Farol); a cobertura e o uso do subagente pelo transcrito (o subagente não roda); o
catálogo de modelos lido por conta pelo `agy models` (a lista da tela é fixa, a allowlist aceita
slug novo escrito à mão).

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
   [mapa de arquivos](../CLAUDE.md#mapa-de-arquivos).
5bis. **O `command` é o `process.execPath`, que no app é o binário do ELECTRON, e
   por isso o config leva `env: { ELECTRON_RUN_AS_NODE: '1' }`** (v2.54.6). Sem a
   variável o Electron trata o `.js` como aplicativo e estoura o diálogo
   "Unable to find Electron app at .../jira-mcp.js", mesmo com o arquivo no lugar.
   Esse diálogo tinha DUAS causas somadas, cada uma suficiente sozinha, e a
   segunda escondeu a primeira por dias: os instaladores também não copiavam a
   pasta `tools/` pra `~/.farol/app` (o pacote já a levava desde a v2.53.2, mas
   `install.sh`, `install.ps1` e `install-linux.sh` só espelhavam
   lib/ui/assets/workspace-template/installer). Achado no Mac do Guilherme em
   29/08/2026 e corrigido no PR #36.
   **VALIDADO ponta a ponta em 29/08/2026 (Windows).** Os testes do repo são
   estáticos (leem o config escrito e a lista de pastas dos instaladores) e NÃO
   provam que o servidor sobe; a prova foi feita à mão, uma vez, e fica aqui:
   `electron.exe tools/jira-mcp.js <site>` com `ELECTRON_RUN_AS_NODE=1` e um
   `FAROL_HOME` de sandbox respondeu `initialize` (protocolo 2024-11-05,
   `farol-jira` 1.0.0) e `tools/list` (`getJiraIssue`,
   `searchJiraIssuesUsingJql`). Sem a variável, o mesmo comando morre antes de
   falar JSON-RPC. **Falta a mesma prova num Mac real**, que é onde o defeito
   apareceu; o mecanismo é o mesmo binário do Electron nos dois sistemas, mas
   isso é dedução, não medição.
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

## Padrões do time na revisão (v2.72.0)

Cada conta, em **Sistema > Contas**, tem o campo **padrões do time na revisão**. O que se escreve ali entra na revisão daquela conta como critério de leitura: padrões de projeto preferidos, camadas, nomes, o que evitar. Quando o código se afasta de um deles, o apontamento sai como sugestão, citando o padrão e propondo a forma que o segue; desvio de padrão só bloqueia quando também é um defeito pelo protocolo.

- **Onde fica:** no campo `padroesRevisao` da conta, no `config.json`. Não fica no workspace porque o protocolo do workspace é regravado a cada boot.
- **Como entra:** delimitado e rotulado como dado, no mesmo molde do card do Jira. Não muda o protocolo, os critérios para aprovar sozinho nem a política da conta. Segredo colado por engano sai mascarado; o prompt leva até 6.000 caracteres (o resto é cortado com aviso) e a conta guarda até 20.000.
- **Regras do repositório:** além dos padrões da conta, a revisão lê o que o repositório revisado declara (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING`, ADRs) e cita qual regra embasou cada cobrança. Se uma regra do repositório conflita com um padrão do time, vale a do repositório para aquele PR.


A memória de rodadas é configurada por `reviewRoundsMode` no config local: `observe` é o
padrão e conserva o comportamento anterior das decisões, exibindo as comparações. `enforce`
ativa os novos gates somente após validar a amostra de reviews e atualizar os executores.
O campo não liga compartilhamento nem troca as políticas de aprovação e reprovação da conta.
Veja [Memória de achados entre rodadas](REVIEW-GATES.md#memória-de-achados-entre-rodadas).


## Avisos de intervenção e voz

Em **Sistema > Preferências**, o Farol oferece voz opcional para quatro tipos de
atenção: decisão pendente, acesso ausente ou vencido, revisão estacionada por falha
sem recuperação automática e sincronização bloqueada por credencial/configuração.
Cancelamento voluntário, orçamento, CI, prova técnica e retry ainda ativo não são
tratados como uma decisão aguardando a pessoa. Um head novo só fica sem alerta
quando o estado de re-revisão comprova espera ou execução automática.

Os avisos aproveitam o estado e os caminhos existentes: bandeja e Notification do
Electron no desktop, eventos/SSE no servidor e toast com **Abrir pendência** no
cliente. Clicar abre o PR e seleciona a conta da pendência; falha sem PR visível
abre o Diagnóstico, acesso abre Contas e sincronização abre sua seção no Sistema.
O servidor headless nunca tenta tocar áudio. No navegador, a notificação do sistema
depende da permissão já concedida; o toast permanece disponível sem ela.

A identidade do aviso é o tipo + conta/PR (ou configuração afetada), não o ID da
sessão nem a data de cada polling. Mudança de head, motivo ou bloqueio gera aviso
novo. Os recibos locais em `state/interventions.json` guardam apenas hashes e
horários, sobrevivem ao reinício e são retirados quando a condição deixa de existir.
Arquivo corrompido é preservado pelo mecanismo de leitura existente; falha de
persistência deixa log e não interrompe revisões. Uma queda entre aviso e gravação
não oferece garantia de entrega exatamente uma vez.

`interventionReminderMinutes` começa em **0** (sem repetição). Entre 5 e 1440,
relembra na primeira atualização de estado depois do intervalo; valores menores que
5 não armam lembretes. Reconectar ou recarregar um cliente recupera os avisos ainda
ativos pelo snapshot, sem disparar outra notificação nativa do engine. Clientes
distintos podem avisar a mesma pendência; não existe eleição de um aparelho para
concentrar áudio.

`voiceEnabled` começa desligado. `voiceEvents` seleciona `decision`, `access`,
`failure` e/ou `operational`; `voiceVolume` varia de 0 a 100, inicialmente 50.
A fala é genérica: não inclui nomes, repositórios, credenciais nem conteúdo de
reviews. Somente vozes marcadas como locais pelo sintetizador do cliente são usadas.
Sem API/voz disponível ou com erro, o estado aparece junto de **Testar voz** e os
avisos visuais continuam. Rajadas não criam uma fila de falas; uma síntese que não
termina em 15 segundos é cancelada e sinalizada como falha.

`voiceQuietEnabled`, `voiceQuietStart` e `voiceQuietEnd` definem o silêncio no fuso
local do cliente (padrão 22:00–08:00, intervalo inicialmente desligado). Início e fim
iguais desativam o intervalo. O silêncio impede voz e toques do app; a notificação
visual de intervenção pede modo silencioso ao navegador/Electron, inclusive ao
balão de reserva do Windows. O shell usa o relógio da máquina em que está rodando.
As preferências ficam no engine ao qual o cliente se conecta; a disponibilidade e
o volume final do áudio dependem do sistema de cada cliente. Desligar a voz não
altera gates, pendências nem resultados de revisão.


## Especialistas por repositório

Em **Sistema > Reviewers > Especialistas por repositório**, configure contexto para
uma conta, um repositório e uma branch de destino de PR. O especialista é um
contexto versionado entregue ao revisor existente; não abre outro agente nem cria
sessão paga. Continua aproveitando os padrões da conta, as instruções do projeto e
a memória de pushback que já existiam.

Cada conclusão tem um tipo (arquitetura, contrato, convenção, ponto crítico ou lição),
título, texto e de uma a oito evidências no formato `caminho:início-fim`. A prévia
consulta o GitHub pela conta escolhida e fixa commit, blob, linhas e trecho. Confira
a conclusão e as fontes antes de clicar em **Confirmar curadoria**. A prévia expira
em dez minutos; mudança de branch, versão ou origem da lição exige nova prévia.
Não existe geração automática de conclusões arquiteturais nem aceitação por
confiança declarada de um modelo nesta versão.

O revisor só recebe conclusões ativas cujos arquivos declarados continuam com os
mesmos blobs no head efetivamente analisado. A branch de destino vem do PR e é
conferida contra o inventário de head/base. Branch, conta ou repositório diferentes
não herdam o contexto. Mudança ou remoção de fonte marca a conclusão como vencida;
falha de consulta, árvore parcial ou incompatibilidade deixa o estado não
verificável. Em ambos os casos a conclusão fica fora do prompt, sem impedir a
revisão completa pelos mecanismos existentes. Não há consulta adicional de fontes
para um repositório sem especialista local.

**Fontes conferidas** significa somente que o conteúdo declarado foi encontrado
com o mesmo blob. Não comprova que uma conclusão continua semanticamente correta:
um consumidor ou uma configuração fora dessas fontes pode mudar o comportamento.
Cabe à curadoria incluir dependências relevantes nas evidências; o revisor continua
obrigado a verificar interações e o código atual. Conteúdo de fontes e lições é dado
não confiável, sem autoridade para alterar ferramentas, autorização, cobertura,
gates ou formato público da revisão. O registro interno da decisão guarda a versão
e o head usados, sem aceitar esses metadados do envelope do modelo.

Pushbacks confirmados que deram razão ao autor, integralmente ou em parte, aparecem
apenas como propostas de lição. Registros legados podem não identificar a conta de
origem; a tela informa isso e exige conferir a procedência para o escopo escolhido.
É necessário acrescentar evidências e confirmar a curadoria. Alterar, retirar ou
reabrir a origem de uma lição curada a torna vencida. O fluxo anterior de pushbacks
permanece independente, como contexto de tom e postura; sua confirmação não ativa
uma conclusão no especialista automaticamente.

**Reconstruir / revisar** abre a conclusão e suas referências para nova leitura das
fontes e nova confirmação. **Desativar** retira a conclusão do contexto, inclusive
offline. **Restaurar como inativo** cria uma versão nova com o conteúdo de uma
anterior, sem apagar o histórico nem reativar conclusões sem conferência. Cada
conclusão restaurada precisa de reconstrução e curadoria para voltar ao prompt.

As versões são locais, sob `state/specialists/`, isoladas por hashes do escopo, com
IDs únicos, escrita imutável e controle de concorrência por versão esperada e lock
exclusivo. Um conflito exige recarregar; histórico corrompido ou com lacunas é
preservado e fica indisponível, em vez de parecer vazio. Não há limpeza automática,
sincronização entre aparelhos ou importação de especialistas nesta etapa. Um
executor sem esse contexto local revisa sem ele; não deve fingir que o recebeu.
Lock restante após queda não é quebrado automaticamente: antes de removê-lo, é
preciso confirmar que não existe escritor ativo naquele escopo.

Os limites são explícitos: 50 conclusões por escopo, 20 arquivos distintos, até 20
linhas e 4.000 caracteres por trecho, 2.000 caracteres por conclusão e 64 KiB de
contexto ativo. Excesso é recusado, nunca truncado. Arquivos de fonte acima de 1 MiB,
conteúdo binário, symlinks, submódulos e árvores incompletas não são aceitos como
prova. Caminhos de credenciais e padrões conhecidos de segredo, e-mail ou diretório
pessoal são recusados. Essa proteção é conservadora e não substitui conferir o que
se pretende guardar; não cole dados pessoais nem credenciais na curadoria.

## Auditoria de reviews

Em **Sistema > Reviewers > Auditoria de reviews**, carregue as revisões elegíveis e
escolha uma para auditar. O botão informa o consumo de duas sessões de IA. A primeira
recebe somente o retrato histórico do código; a segunda recebe essa leitura e o
parecer original para comparar. São conversas novas, sem retomada da sessão revisora,
sem contexto do especialista e em modo somente leitura do executor existente.
Não há capability de postagem, outro review público, mudança de decisão ou gate.
O provedor continua sendo o autorizado para a conta; a primeira versão admite os
caminhos Claude e Codex com contrato de leitura. Isso reduz ancoragem, mas modelos
da mesma família podem compartilhar erros; não é validação humana independente.

São elegíveis registros locais de análise completa, com inventário e rodada
compatíveis pertencentes à conta escolhida. Legados sem essas provas ficam fora.
A comparação usa base e head originais por SHA e confere os arquivos e blobs contra
o inventário registrado. Um push posterior não transforma a auditoria antiga em
auditoria do head atual. As duas versões dos arquivos do diff, a leitura independente,
o relatório e suas impressões ficam preservados em `state/review-audits/`.
Nenhum contexto de outro repositório é importado. Conteúdo de fontes é dado sem
autoridade; caminhos sensíveis e padrões conhecidos de segredo/PII são recusados.

Os limites desta versão são 100 arquivos e 256 KiB somando fontes das duas versões,
além dos limites de texto da curadoria. Fontes binárias, symlinks, submódulos, árvore
parcial, comparação incompatível ou excedente deixam a auditoria **inconclusiva**,
sem truncamento. Dependências fora do diff são limitações declaradas pelo auditor;
uma auditoria sobre esse retrato não comprova ausência de defeitos no sistema.

O relatório separa achados confirmados pelo auditor, possíveis falsos positivos,
possíveis omissões e inconclusivos. Cada achado original e cada observação da leitura
independente precisa de resposta; citações são conferidas contra o retrato por caminho,
lado e linhas. A classificação é uma opinião do auditor com evidência, não verdade
automática. Para cada item, a pessoa pode concordar, discordar ou registrar que não
consegue concluir, com justificativa. Avaliações são versionadas; conflito exige
recarregar e o histórico não é apagado. Compare os mesmos PRs com uma amostra de
referência avaliada por pessoas antes de afirmar ganho de qualidade.

Concordância mostra somente os itens efetivamente julgados por uma pessoa, excluindo
inconclusivos do denominador. Possíveis omissões ou falsos positivos viram erros
confirmados somente após concordância humana. Custo por erro permanece indisponível
sem erro confirmado ou quando faltar custo de alguma auditoria. Valores estimados são
identificados, separados de medidos e indisponíveis. As sessões entram no Consumo como
Ferramentas, com referência de auditoria, reaproveitando o diário de tentativas.

A amostragem automática começa **desligada**. Habilitá-la exige escolher contas,
máximo diário (até dez), orçamento diário e reserva estimada por auditoria de duas
sessões. O tick usa uma ordem de risco explícita: aprovações, volume, pendências de
rodada e nomes de caminhos sensíveis. É uma heurística de seleção, não uma nota de
precisão. Um mesmo retrato não é reamostrado automaticamente. Revisões na fila e
sessões ativas têm prioridade. Contas silenciadas ou sem token e perfis sem orçamento
não iniciam auditoria. Falhas não têm retentativa automática.

Quantidade e orçamento são **locais deste aparelho**, não uma cota compartilhada da
frota. A reserva controla admissão: não é um limite rígido imposto ao provedor, e uma
sessão já iniciada pode ultrapassá-la. Custo estimado entra no orçamento; indisponível
suspende novas amostras naquele dia. Desligar a amostragem impede novos inícios, mas
não cancela a auditoria atual. Repetição manual de uma auditoria concluída exige marcar
nova tentativa e gera novo consumo, preservando a anterior. Uma tentativa sem resultado
fica interrompida; não equivale a zero problemas. A execução ativa é identificada pelo
ID da auditoria: iniciar outra não faz um registro interrompido aparecer em andamento.
O lock registra cada processo concorrente separadamente e recupera automaticamente
somente donos cuja morte o sistema operacional confirmou, sem apagar a tentativa.
Um processo vivo ou uma identidade ilegível mantém o bloqueio. Locks de formato
antigo, sem identidade verificável, são preservados; confirme que o escritor
e seus processos filhos terminaram. Dados corrompidos permanecem preservados e não
são interpretados como histórico vazio.

Depois da avaliação humana favorável, possíveis omissões e falsos positivos oferecem
**propostas** na curadoria dos especialistas da mesma conta e repositório. É preciso
acrescentar fontes e confirmar a curadoria separadamente. Contestação ou mudança da
avaliação invalida a lição derivada. Auditoria nunca ativa conhecimento automaticamente.
Não há sincronização das auditorias, comparação humana preenchida por IA nem selo
de “assertividade” nesta etapa. A voz permanece desligada por padrão.

## Reserva de cota e recursos

Em **Sistema > Plano e chaves > Reserva de cota e recursos**, carregue os perfis e
escolha uma política: **desligada**, **observar e avisar** ou **reservar**. Nenhuma
reserva vem habilitada por padrão. O percentual máximo, de 1 a 99, vale para cada
janela do grupo de modelos usado pelo perfil, exatamente como o provedor a informou.
Uma janela semanal não é apresentada como janela de cinco horas.

A fonte integrada verificável é o `/usage` do Antigravity. Usa o leitor e o cache
existentes, sem chamada ao modelo. Todos os buckets precisam estar válidos, com
fração numérica, IDs únicos, janela e reset. A identidade tem que conferir com a
conta configurada e o token precisa vir da pasta do perfil. A leitura vale por até
um minuto; leitura vencida, futura, parcial, reset vencido ou identidade não comprovada
é **cota desconhecida**, nunca zero usado. O painel mostra fonte e horário da coleta.
Claude e Codex continuam sem uma medição verificável integrada nesta versão; tokens,
custo em dólar e estimativa de reset não são convertidos em percentual de cota.

**Observar** informa quando o percentual chega ao máximo, mas não barra sessões.
**Reservar** impede novas sessões headless naquele perfil quando o teto é atingido
ou a fonte é desconhecida. A cadeia pode usar somente outra opção já habilitada;
não liga perfis novos, não troca associações da conta e não cria fallback para o
login legado quando todos estão reservados. Conta com perfil próprio permanece
presa a ele. Perfis reconhecidos da mesma assinatura compartilham a política mais
restritiva: Codex usa o login único da máquina; pastas Claude usam a identidade
canônica existente; perfis Antigravity com a mesma conta configurada compartilham
a reserva do grupo. Quando houver política de reserva efetiva em algum alias,
ela prevalece sobre observação nos demais. A tela mostra os perfis de origem da
política efetiva, sem expor chave, caminho ou identidade de login completa.

Orçamentos do perfil e do grupo, silêncio da conta, admissão, política do aparelho
e limites de concorrência continuam sendo exigências independentes. A reserva não
autoriza contornar orçamento. A revisão impedida volta à fila sem gastar tentativa
nem publicar review; uma nova coleta pode liberar sua admissão. A checagem ocorre
antes do provedor, inclusive nos caminhos de autoanálise, pushback, ferramentas e
chat headless. Terminal interativo continua fora desta admissão headless.

Sessão iniciada não é cancelada ao cruzar o percentual. O consumo continua no diário
existente, e observações antes/depois são preservadas sob `state/quota-admissions/`
em registros imutáveis com versão e integridade. O painel lista as trinta observações
mais recentes; não apaga as anteriores. Fonte final ausente é desconhecida; registro
sem fim é sessão em andamento ou interrompida, não prova de ausência de ultrapassagem.
Corrupção fica explícita e os arquivos permanecem preservados.

Não há garantia rígida de “30% preservados”: uma sessão longa ou outro aplicativo
na mesma assinatura pode consumir essa margem. A medição final diz o que foi
observado depois da sessão, não atribui todo o consumo da janela exclusivamente a
ela. A reserva é local ao aparelho; não é uma transação de cota entre todos os
clientes do provedor. Custos medidos, estimados e indisponíveis permanecem separados
no Consumo. Desligar a política libera novas admissões, preservando histórico.

**Medir recursos agora** coleta sob demanda, com cache de cinco segundos e uma
consulta em andamento por engine. Separa máquina inteira, processo principal do
Farol, subprocessos observados do app, CLIs rastreados e seus descendentes, com uma
linha por sessão. A seleção usa PIDs, parentesco e nascimento; processo encerrado,
inacessível ou PID reciclado não é atribuído à sessão como se estivesse medido.
No Windows usa CIM para buscar somente a árvore do Farol, sem materializar métricas
de outros aplicativos; em macOS/Linux, `ps`. Não coleta linha de comando, nome de
usuário, ambiente, caminho de executável ou credenciais para apresentar o diagnóstico.

CPU precisa de duas amostras e é normalizada pela capacidade total da máquina.
A primeira leitura e processos novos mostram CPU indisponível, sem inventar 0%.
RAM dos processos é soma de RSS/working set, que pode contar páginas compartilhadas
mais de uma vez; não equivale à RAM física exclusiva. A memória disponível ao processo
reaproveita a métrica da admissão existente, incluindo limite de container quando
disponível. A coleta tem custo e inclui processos acessíveis no snapshot, não uma
prova de completude de processos inacessíveis. Falha de consulta fica indisponível.

Alertas de RAM e CPU são observações no painel. Não mudam paralelismo, não encerram
processos nem reinterpretam o piso de memória já existente. Ajuste automático exige
medição posterior. Nenhuma política de cota ou medição de recursos liga a voz; seu
padrão permanece desligado.


## Interface, retomada e preferências portáveis

No Radar, **Agrupar fila** alterna entre lista, conta e repositório. O agrupamento
altera só a apresentação; não muda a ordem de execução, o escopo ou a autorização.
Cada grupo pode ser recolhido pelo resumo com mouse ou teclado. A escolha e os
grupos recolhidos ficam neste navegador e sobrevivem à atualização do estado e à
recarga. A contagem e **Revisar tudo** continuam incluindo os itens recolhidos.

Rodadas compatíveis nas pendências e revisões recentes têm um resumo expansível:
identificador, pais, pendências, apontamentos sem resposta e mudança de contexto.
Ausência de resumo não significa zero achados. Memória não verificada tem aviso;
a evidência continua no relatório. O resumo é interno, não entra no review público.

O andamento mostra a etapa e os agentes observados, incluindo sua tarefa e estado
em uma lista acessível. Tempo decorrido, mediana histórica e número de eventos não
são convertidos em porcentagem de conclusão. A fração de arquivos declarados lidos
pode aparecer, identificada como leitura declarada, sem substituir a prova de cobertura.
Fechamento e saída da sessão não prometem sucesso da análise ou da postagem; consulte
o resultado da revisão. Silêncio do stream continua visível.

Em **Sistema > Visão geral > Configuração e retomada**, o roteiro guarda o último
passo escolhido e o recolhimento neste navegador. Sem conta configurada ele começa
aberto; nas demais instalações pode ser aberto quando necessário. Login, organizações e prontidão do último diagnóstico
são informações distintas de configuração preenchida. Use **Reverificar saúde** para
atualizar o diagnóstico. O roteiro não ativa automação nem aprova a política da conta.

**Tags de revisão no GitHub**, em Sistema > Visão geral, consulta um PR e permite
remover individualmente os marcadores `conta:revisando`, inclusive de outro login.
A ação usa a conta autenticada que cobre o PR e pede confirmação. Ela tira a tag
daquele PR, sem excluir sua definição no repositório nem cancelar uma revisão ativa.
A sessão local respeita a remoção manual; uma revisão nova pode recolocar o marcador.
Tags de outras ferramentas e outros assuntos ficam fora desse controle.

Ao concluir, falhar ou cancelar uma revisão, o Farol tenta remover sua tag. A intenção
é registrada antes da inclusão, inclusive para resposta perdida do GitHub. Falhas de
remoção e limpeza após reinício ficam pendentes para os próximos ciclos, sem expirar
após sete dias. Sem rede, token ou permissão, a remoção não pode ser garantida na hora.
A limpeza automática adiada respeita revisões vivas e a posse entre aparelhos.

**Preferências entre instalações** exporta JSON versão 2 com todas as preferências
editáveis do Sistema, a partir da tabela central de configurações. Inclui contas e
políticas de automação, modelos e esforço, limites de revisões, regras e revisores,
papéis das pessoas, tema, som, voz e horário silencioso, atualização e inicialização,
perfis e orçamentos dos provedores, ordem dos perfis e configuração da sincronização.

Senhas, tokens, chaves de API e sessões autenticadas não entram no arquivo. Os ajustes
de um perfil de API reutilizam somente a credencial local do mesmo identificador,
tipo e endereço. Sem ela, a diferença aparece indisponível e explica como cadastrar
a credencial antes de aplicar. A sincronização exige a configuração local da chave
para o mesmo projeto e banco; as proteções de autenticação do aparelho continuam
valendo. Login no GitHub, Jira e provedores continua sendo feito no destino.

Não é uma cópia do diretório do Farol: histórico de revisões, credenciais, identidade
do dispositivo, grupos publicados e políticas de outros aparelhos não são preferências
locais e não são migrados por esse arquivo. Portas, migrações internas e proteção da
API local não são editáveis por essa importação. Diretórios configurados nos perfis
são transferidos como preferências; precisam existir no aparelho de destino.

Importar exige arquivo de até 1 MiB, prévia e seleção explícita das diferenças.
**Aplicar diferenças selecionadas** usa a mesma validação e os mesmos efeitos do
salvamento em Sistema, incluindo voz, inicialização, checagem e sincronização.
A prévia não grava. Valores iguais, inclusive objetos com chaves em outra ordem,
não aparecem. Se tudo é igual, a tela informa que não há diferenças.
A prévia explica os ajustes dependentes: a última conta configurada não pode ser
removida por importação, como na edição normal de Contas. Deixar o perfil padrão
vazio desativa a cadeia. Uma cadeia vazia
representa os perfis existentes desligados, sem diferenças que reapareçam após aplicar.
A coluna **No arquivo** mostra a cadeia contida no JSON. Perfis locais ausentes dela
ficam desativados; se a lista de perfis também for importada, os ausentes são removidos.
IDs duplicados e datas inexistentes nos orçamentos são recusados antes da gravação.
Usuário, organizações e remoção de perfis que alterem contas exigem selecionar também
as diferenças das contas afetadas; um arquivo parcial não pode mudar esses vínculos
silenciosamente. Se o arquivo inclui contas iguais às atuais, elas são preservadas
ao restaurar usuário e organizações, sem exigir selecionar uma diferença inexistente.
Sites Jira com credencial local não podem mudar de endereço pela
importação, inclusive quando o identificador pertence a um cadastro antigo removido.
Use outro identificador ou ajuste explicitamente o cadastro e a credencial no destino.

Arquivos antigos na versão 1 continuam aceitos como parciais. Preferências ausentes
são preservadas, com aviso; para transferir todos os ajustes é necessária uma nova
exportação. Versões anteriores do Farol recusam o novo formato versão 2.
Se o arquivo ou as preferências do destino mudarem, gere outra prévia.
Falha ao salvar restaura a configuração anterior antes de disparar efeitos ou
registrar mudança de política. Não há reinício automático do aplicativo.

Tema claro e escuro usam os tokens existentes. A preferência persistida do engine
prevalece quando chega o estado; o navegador mantém o último tema para o primeiro
paint. A voz nasce desligada e pode ser ativada pela seleção explícita na importação.

## Fontes versionadas e contexto controlado

Review e autoanálise podem preparar fontes autorizadas pelo GitHub sem checkout pessoal
ou declaração de perfil técnico. O manifesto separa H (head analisado), B (ponta da base)
e M (merge-base). Paginação, quantidade e estabilidade do PR são conferidas; ausência de
patch não retira o arquivo do escopo. Consulta adicional de árvore, texto ou arquivo usa
o mesmo manifesto e revalida a conta e o acesso ao repositório. Nunca substitui um SHA
indisponível pela branch atual. O caminho anterior continua disponível quando a aquisição
falha, com cobertura e limitações próprias, sem inventar leitura.

O cache fica em `~/.farol/source-cache/`, separado do material temporário. O isolamento
inclui host, conta e identidade do repositório. Objetos Git são compartilhados somente
nesse escopo, com leases e referências por consumidor; materializações continuam separadas.
Binários e segredos reconhecidos não entram no cache textual. Nenhum filtro garante
reconhecer todos os segredos possíveis em código; fontes continuam dados não confiáveis.

As opções avançadas abaixo pertencem ao `config.json`. Mescle os campos, sem substituir
o arquivo nem copiar contas/credenciais. Esta alteração de código não modifica a instalação
aberta. Instalar ou reiniciar exige uma operação posterior autorizada.

```json
{
  "reviewContextMode": "off",
  "reviewContextTokens": 3000,
  "reviewContextLimits": { "files": 600, "bytes": 8388608, "fileBytes": 262144, "timeMs": 30000, "depth": 2, "paths": 120 },
  "sourceCacheLimits": { "maxBytes": 2147483648, "reserveBytes": 536870912, "globalMaxBytes": 4294967296, "globalReserveBytes": 1073741824, "acquisitionReserveBytes": 16777216, "monitorIntervalMs": 250, "concurrency": 1, "maxQueued": 8 }
}
```

`off` preserva a seleção anterior e não cria o mapa. `observe` levanta o mapa e registra
métricas sem injetar a seleção no prompt. `assist` permite a seleção adicional, com orçamento
estimado em caracteres/4, sem afirmar tokens faturados ou qualidade da decisão do modelo.
Regras e blockers obrigatórios ficam fora desse orçamento e não são retirados para caber.
Se o mapa falhar ou ficar incompleto em assist, não se herda validade de análise apenas
porque o blob não mudou. Conteúdo disponível, leitura observada e análise válida são fatos
distintos. Nenhum desses modos muda os gates ou a política de publicação da conta.

O parser distribuído `@babel/parser` 7.28.5 roda em worker limitado, sem ligar ou executar
o código do projeto. O pacote inclui o artefato oficial autocontido, licença e hashes;
upgrades não dependem de instalar um módulo novo no `node_modules` preservado.
JS, TS, JSX, TSX, imports de tipos e reexports têm relações sintáticas. Isso não constitui
resolução semântica de props, bindings ou chamadas. CommonJS, aliases e dependências
dinâmicas conservam confiança e limitações explícitas. Sintaxe não suportada amplia a
investigação textual, sem excluir silenciosamente arquivos. JSONC/extends e resoluções
não suportadas nunca provam ausência de uso. O cache de 4 MiB contabiliza apenas a
serialização das análises retidas, não a memória total do worker ou do processo.
Relações são reconstruídas para H/M e configuração. A bateria e os detalhes dos modos
estão em `docs/CONTEXTO-FRONTEND.md`, na documentação de desenvolvimento do repositório.
O orçamento de tempo do levantamento é verificado entre leituras; cada consulta de rede
também tem seu timeout próprio. Não representa prazo máximo rígido de ponta a ponta.

O limite de 2 GiB por escopo é coordenado com orçamento global lógico de 4 GiB e piso
global livre de 1 GiB. Reservas duráveis coordenam admissões simultâneas; aquisição
desconhecida é monitorada e interrompida quando o orçamento deixa de ser atendido.
Objetos, Git, temporários, metadados e materiais ativos ou pendentes entram na medição.
Legados são observados separadamente, sem remoção nem inclusão retroativa no teto de
4 GiB. O limite é lógico e amostrado; não promete overshoot físico zero. Material ativo
nunca é eliminado para cumprir quota. Estado incerto adia o trabalho. Veja
`docs/SOURCE-STORAGE.md`, no repositório, para contabilização, precisão e exclusões. Os dados de capacidade não
fazem uma varredura global por atualização da interface.

Materiais técnicos novos têm manifesto de propriedade e consumidores. A coleta é
assíncrona, limitada e independente da próxima review. Falha de remoção tem retry;
abort sem confirmação de término preserva o material. Diretórios legados sem manifesto
permanecem pendentes de diagnóstico. Evidências e resultados duráveis não são cache.
Após reinício, coleta de preparação interrompida exige decisão final correspondente
ao PR/head/conta e prova de término dos processos, sem referência ativa, fila ou
retomada. Sem desfecho comprovado, o material permanece preservado para diagnóstico.

Na curadoria de especialistas, entradas antigas e `scope: "global"` são globais por
segurança. A API de prévia pode declarar `scope: "module"` explicitamente; somente essas
entradas podem ser selecionadas por relevância em assist. Mapa desconhecido preserva
todas. Evidências idênticas podem usar referências, mantendo conclusões e procedência.

Para rollback da seleção, volte `reviewContextMode` para `off` na próxima configuração
autorizada. Rollback do aplicativo deve aguardar consumidores terminarem e voltar à
versão anterior sem apagar estado, checkpoints, resultados ou diretórios novos desconhecidos.

## Modo casca e bind (28/10/2026)

O desenho do Farol nativo (`docs/superpowers/specs/2026-10-27-farol-nativo-swiftui-winui-design.md`) troca o Electron por duas cascas nativas (SwiftUI no macOS, WinUI 3 no Windows) que sobem o motor como sidecar: `node server.js` num processo separado, com a `ui/` servida pelo próprio motor num WebView. O contrato entre as cascas e o motor está fixado no índice dos planos (`docs/superpowers/plans/2026-10-28-farol-nativo-indice.md`); aqui fica o que o motor faz de diferente e como configurar. A mesma entrega trouxe o `config.bind`, que é da implantação web e não depende da casca.

### As variáveis que a casca passa

| variável | valor | quem lê |
|---|---|---|
| `FAROL_SHELL` | `mac` ou `win` (caixa e espaço tolerados; qualquer outro valor é "sem casca") | `modoCasca()` em `lib/paths.js` |
| `FAROL_SHELL_VERSION` | versão da casca, só `X.Y.Z` (fora do formato é vazio, nunca um palpite) | `versaoDaCasca()` em `lib/paths.js`, pelo bootstrap de versão |
| `FAROL_HOME` | opcional, como sempre | `lib/paths.js` |

O modo casca não substitui o `modoServidor`: sem Electron o motor continua sendo servidor, e a casca só acrescenta o que está abaixo. Duas variáveis são internas do bootstrap e a casca nunca as passa: `FAROL_BOOTSTRAP_FEITO=1` (`bootstrapFeito`) e `FAROL_PAI_PID` (`pidDoPai`), postas por `ambienteDoBootstrap` no motor reexecutado.

### O que muda com `FAROL_SHELL`

- **A autenticação local é exigida sempre.** `exigeAutenticacao` (`lib/local-auth/modo.js`) devolve verdadeiro com `modoCasca` `mac` ou `win`, como no celular, e nenhuma config desliga. `GET /api/state` sem `Authorization: Bearer` devolve `401 { error: 'nao_autenticado' }`.
- **As sessões de IA voltam ao motor com credencial de escopo único.** Elas não têm Bearer, e o porteiro (`recusaSemCredencial`, `lib/local-auth/acesso.js`) aceita, em vez dele, duas credenciais, cada uma só na própria rota e sempre por `POST`: a capability de postagem (`x-farol-review-cap`, a mesma que o curl do terminal e do chat já mandava) em `/api/review/post`, conferida viva em `reviewCaps` (escopo, PR e uso único a rota confere como antes), e o segredo da sessão de terminal (`x-farol-session`) em `/api/session-exit`, conferido contra o `id` do corpo em tempo constante (`lib/engine/segredo-de-saida.js`). O segredo nasce aleatório ao abrir a sessão (revisão, login do Claude e login do Codex), mora só no registro em `activeReviews` (`segredoDeSaida`, fora do snapshot) e no script da sessão, que o exporta como `FAROL_SESSION_SECRET` e o manda por cabeçalho no trap EXIT; nunca vai a log nem a linha de comando. Sem isso, a postagem pelo terminal e pelo chat morria em 401 e a sessão de terminal nunca saía de `activeReviews`, deixando `casca.ocupado` preso. Qualquer outra rota com essas credenciais continua `401`, e fora do modo que exige nada muda. Vale igual com `config.bind` fora do loopback e com `localAuth: 'exigir'`.
- **`state/casca.json`** (`CASCA_FILE`, em `~/.farol/state/`, FORA do workspace: o workspace é o cwd de toda sessão de IA, e o arquivo leva o código de pareamento em claro por até 10 minutos), gravado por `publicarCasca` (`lib/engine/casca-arquivo.js`) com modo 0600, só depois de o socket escutar e com a porta EFETIVA:

  ```json
  { "porta": 47170, "pid": 12345, "versao": "2.79.0", "codigoPareamento": "K7QMZP2XWD",
    "iniciadoEm": 1761600000000, "proximaVersao": null }
  ```

  O `pid` é o do processo que escuta, mesmo depois do reexec do bootstrap, e é por ele que a casca encerra o motor. Com a porta ocupada nada é gravado: a casca reconhece o Farol vivo pelo `GET /api/auth/status`. A saída ordenada (`registrarSaidaOrdenada` no `server.js`, SIGTERM, SIGINT e SIGHUP, este último porque o pai do bootstrap o repassa ao motor reexecutado) apaga o arquivo com `apagarCasca`.
- **A sessão `casca`.** O `codigoPareamento` é um código de uso único da classe `casca` (`criarCodigo(agora, { classe: 'casca' })`), válido por `TEMPOS.PAREAMENTO_VALIDADE_MS` (10 minutos). A casca o troca em `POST /api/auth/pair` com `{ codigo, rotulo }` e recebe `{ ok: true, token }`; `tentarCodigo` devolve a classe e `emitirSessao` a grava na sessão. A sessão `casca` não tem o limite absoluto (`TEMPOS.SESSAO_LOCAL_ABSOLUTA_MS`), porque a casca não tem como pedir código novo sozinha, e continua vencendo com 30 dias sem uso (`TEMPOS.SESSAO_LOCAL_OCIOSA_MS`). A lista de sessões (`POST /api/auth/sessions`) mostra a `classe`.
- **Os eventos da casca no SSE** (`GET /api/events`, com o Bearer e `x-farol: 1`). A casca lê só três, e nunca `state` nem `state-patch`:

  | evento | corpo | quando |
  |---|---|---|
  | `casca` | `{ badge: { contador, rotulo }, ocupado, autostart, cores: { bg, symbol } }` (`cascaDe`) | logo depois do `state` da conexão e a cada mudança; pode repetir, e as cascas comparam e ignoram igual |
  | `aviso-nativo` | `{ titulo, corpo, url, pr, silencioso }` (`avisoDe`; `url` e `pr` podem ser `null`) | a cada `new-prs`, `auto-approved`, `auto-rejected`, `auto-commented`, `intervention` (só com `pr`), `meu-pr-base` e `tool-done` |
  | `casca-saida` | `{ motivo, proximaVersao }` | antes de o motor sair de propósito, com o código 75 |

  Os textos de `lib/engine/avisos-nativos.js` são os mesmos do `main.js` até o Electron sair, e `test/fixtures/casca/eventos.json` é o contrato de paridade das duas cascas.
- **Bootstrap de versão** (`bootstrapDaCasca`, `lib/engine/casca-bootstrap.js`). A casca sempre executa o motor semeado no próprio bundle. Antes de o engine existir, ele procura em `~/.farol/engine/<X.Y.Z>/` (`ENGINE_DIR`) a maior versão acima da sua cujo `package.json` tem `engines.farolShell` aceitando `FAROL_SHELL_VERSION` (faixa `>=X.Y.Z <N`, a mesma forma de `engines.node`; o motor de hoje declara `>=3.0.0 <4`), poda as versões abaixo da escolhida e da semeada e se reexecuta de lá, repassando sinais e devolvendo o código de saída do filho. Sem prova (casca sem versão, manifesto ilegível, sem `farolShell`) fica na semeada; manifesto inválido vira WARN no `farol.log`. O filho vigia o pid do pai a cada `TEMPOS.VIGIA_DO_PAI_MS` (2 s) e sai pelo caminho do SIGTERM quando ele some, então um pai morto por SIGKILL, ou pelo `TerminateProcess` da casca no Windows, não deixa um órfão segurando a porta.
- **Update** (`aplicarNaCasca`, `lib/engine/update-casca.js`). O bundle da casca é só leitura e assinado, então o update não troca nada no lugar: o pacote leve vai para `~/.farol/engine/<versão>` (cópia em `<versão>.tmp` e rename, a pasta final só aparece inteira), o `casca.json` ganha a `proximaVersao`, o motor marca a reabertura silenciosa, emite `casca-saida { motivo: 'update', proximaVersao }` e sai depois de `TEMPOS.SAIDA_DEPOIS_DO_UPDATE_MS` com `CASCA.CODIGO_SAIDA_DE_PROPOSITO` (75). A casca religa na hora, sem recuo; quem religa é sempre a casca. Rodando de um checkout git, recusa com o mesmo texto do modo servidor. O desvio no `applyUpdateInner` vem antes do modo servidor.

Códigos de saída do sidecar: `0` é saída pedida (SIGTERM, SIGHUP ou Ctrl+C), `75` é saída de propósito (religar sem contar como falha), qualquer outro é falha.

Para ver tudo isso sem casca: `FAROL_HOME=/tmp/farol-casca FAROL_SHELL=mac FAROL_SHELL_VERSION=3.0.0 node server.js`, e então ler o `casca.json`, parear com o código dele e abrir o SSE com o token (o passo a passo está em "Como rodar" no `CLAUDE.md`).

### `config.bind`: onde o servidor escuta

O endereço do `listen`. Padrão `127.0.0.1`, e só por arquivo (`config.json`, com reinício), como a porta: trocar em runtime derrubaria o servidor que respondeu o pedido. `sanearBind` (`lib/parse.js`) aceita IPv4, IPv6 entre colchetes (a forma do cabeçalho Host, ex. `[::1]`) ou nome de host, sempre em caixa baixa; qualquer outra coisa (porta junto, esquema, espaço, vazio) volta para `127.0.0.1`. O valor padrão não é gravado no arquivo.

Com o bind fora do loopback (`loopback` em `lib/http-guard.js`: `127.0.0.1`, `localhost` e `[::1]` contam como loopback):

- a allowlist de Host aceita `<bind>:<porta>` além de `127.0.0.1:<porta>` e `localhost:<porta>`, e as origens `http://<bind>:<porta>` e `https://<bind>` (o proxy com TLS fica na 443, sem porta na origem);
- a autenticação local é exigida sempre (`bindForaDoLoopback` em `exigeAutenticacao`): ali a API chega a outras máquinas, e Host permitido não é autenticação.

Na implantação web com proxy TLS (plano 5 do Farol nativo) o motor fica em loopback atrás do proxy, que reescreve o Host; o bind fora do loopback é para quem expõe o motor sem proxy na frente.
