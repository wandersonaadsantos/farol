# Configuração operacional do Farol

Extraído do `CLAUDE.md` na Fase 1.5 da reorganização. O `CLAUDE.md` da raiz é o sumário, e os
invariantes continuam lá.

<!-- indice:inicio (gerado; test/guias-navegaveis.test.js reprova se divergir das seções) -->

## Índice

- [Modelo e esforço das sessões autônomas](#modelo-e-esforço-das-sessões-autônomas)
- [Assinatura do Claude (qual conta/plano o Farol usa, e como alternar)](#assinatura-do-claude-qual-contaplano-o-farol-usa-e-como-alternar)
- [Jira multi-tenant (v2.52.0)](#jira-multi-tenant-v2520)

<!-- indice:fim -->

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
3. **Perfis nomeados de assinatura, um por conta GitHub monitorada (recomendado, desde a v2.27.0):** em Sistema > **"Assinatura do Claude"**, o campo único virou um gerenciador de perfis. Cada perfil tem um nome (ex.: "BIUD Trabalho", "Pessoal Max") e um diretório de config próprio. Escolha um perfil como **padrão do Farol** e, se quiser, atribua um perfil diferente a uma conta GitHub específica (Sistema > Contas, override por conta). Sem override, a conta usa o padrão global; sem nenhum perfil criado, vale o `claudeConfigDir` legado como sempre valeu (compatibilidade total).

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
