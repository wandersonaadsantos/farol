# Gemini CLI como terceiro provedor de revisão (medição e desenho)

Data: 20/10/2026. Estado: medição feita, desenho proposto, nada implementado.
CLI medido: `@google/gemini-cli` **0.64.0**, já instalado na máquina (Windows 11, Node 24.15.0).

## Conclusão em cinco linhas

1. **O login com conta Google não serve mais para o Gemini CLI.** Desde 18/06/2026 o Google
   recusa o CLI nos planos individual, AI Pro e AI Ultra, e manda migrar para o Antigravity.
   Medido aqui: o login Google da máquina devolve `IneligibleTierError ... UNSUPPORTED_CLIENT`.
   Sobram a **chave paga da Gemini API** (cobra por token) e o **Vertex AI** (projeto GCP com
   faturamento). Isso quebra a premissa do Codex, que entrou para gastar a franquia de um plano,
   e a premissa do desenho da revisão convergente ("o custo é baixo porque roda nas assinaturas").
2. Tecnicamente o CLI cobre quase tudo o que a revisão do Claude usa: subagente, MCP com filtro
   por nome, retomada por id que o próprio Farol escolhe, política de comandos por prefixo,
   pasta de configuração por perfil (`GEMINI_CLI_HOME`) e escolha de modelo e de raciocínio.
   Paridade maior que a do Codex.
3. O que degrada: os eventos do subagente não saem no stream (a cobertura tem que ser lida do
   transcrito em disco depois), o stream não traz custo em dólar (só tokens), o código de saída
   não é confiável no Windows, e o CLI não tem teto de tempo próprio.
4. A revisão de ponta a ponta com modelo de verdade **não foi feita**: não há credencial válida
   na máquina. O encanamento inteiro (prompt real de 22 KB pela entrada padrão, CLAUDE.md como
   contexto, subagente, MCP, política, envelope montado a partir do stream) foi provado com o
   CLI real contra um servidor falso local.
5. Estimativa: **3 a 4 dias** para paridade com o caminho do Claude, ou **2 dias** para o nível
   do Codex. Antes de gastar isso, decida a pergunta da seção "Decisão que vem antes".

## Decisão que vem antes (é do dono)

| caminho | custo | o que falta medir |
|---|---|---|
| Gemini CLI com chave paga da Gemini API | por token, sem franquia | só a revisão de ponta a ponta com a chave |
| Gemini CLI com Vertex AI | por token no projeto GCP | idem, mais o login ADC sem navegador |
| Antigravity CLI (`agy`), o sucessor | franquia do plano Google, se o plano cobrir | tudo: é outro binário, de código fechado, e o formato do modo não interativo não foi medido |

Se o objetivo é uma segunda opinião **sem pagar por token**, o candidato é o `agy`, não o
Gemini CLI, e ele pede uma medição própria antes de qualquer desenho. Se pagar por token é
aceitável, o desenho abaixo vale.

## Como a medição foi feita

- **API real do Google**: só com uma chave **inválida de propósito** (`AIzaFAKE_...`, não é
  credencial), para capturar a mensagem real de chave inválida.
- **Login Google existente**: o CLI usou o `~/.gemini/oauth_creds.json` presente na máquina. O
  arquivo apareceu às 03:46 de 20/10/2026, durante a primeira execução da medição; nenhuma
  credencial nem código de autorização foi digitado. Ele não serve para nada (o Google recusa o
  cliente) e pode ser apagado pelo dono.
- **Servidor falso local**: um servidor HTTP em `127.0.0.1` respondendo no formato da Gemini API
  (`:generateContent`, `:streamGenerateContent?alt=sse`), apontado por `GOOGLE_GEMINI_BASE_URL`,
  com `GEMINI_CLI_HOME` numa pasta temporária. **O CLI é o real**: os eventos, as recusas de
  política, o subagente, o MCP e a retomada abaixo são saída dele. O que o servidor falso
  inventa é só a resposta do modelo e o corpo dos erros 429 e 404, escrito no formato
  documentado da API.
- Detalhe que custou uma rodada: com `GOOGLE_GEMINI_BASE_URL` o CLI escolhe o tipo de
  autenticação `gateway` e recusa no modo não interativo (`Invalid auth method selected.`,
  saída 41). Gravar `"security.auth.selectedType": "gemini-api-key"` no `settings.json` do perfil
  resolve, e é o que o Farol faria de qualquer jeito.

## 1. Modo não interativo

`gemini -p "<prompt>" -o stream-json` emite NDJSON com seis tipos fixos (`init`, `message`,
`tool_use`, `tool_result`, `error`, `result`; enum `JsonStreamEventType` no bundle). O texto do
`-p` é **anexado** ao que vier pela entrada padrão, então `-p ""` com o prompt na entrada padrão
funciona (medido com o `pr-review-auto.md` real, 22.409 bytes).

Início e texto (o texto vem em pedaços, `delta: true`):

```json
{"type":"init","timestamp":"2026-10-20T06:48:30.116Z","session_id":"2540c67c-0bed-490f-a394-48cf2de2e9ea","model":"auto"}
{"type":"message","timestamp":"2026-10-20T06:48:30.118Z","role":"user","content":"diga oi"}
{"type":"message","timestamp":"2026-10-20T06:48:30.263Z","role":"assistant","content":"Olá, ","delta":true}
{"type":"message","timestamp":"2026-10-20T06:48:30.264Z","role":"assistant","content":"FAROL_CHECKPOINT {\"x\":1}\nfim.","delta":true}
```

Uso de ferramenta (o `output` do `read_file` vem vazio no evento; o conteúdo vai só ao modelo):

```json
{"type":"tool_use","timestamp":"2026-10-20T06:49:21.879Z","tool_name":"read_file","tool_id":"read_file__read_file_1792478961827_0","parameters":{"file_path":"leia.txt"}}
{"type":"tool_result","timestamp":"2026-10-20T06:49:21.913Z","tool_id":"read_file__read_file_1792478961827_0","status":"success","output":""}
{"type":"tool_result","timestamp":"2026-10-20T06:49:34.938Z","tool_id":"run_shell_command__run_shell_command_1792478974929_0","status":"error","output":"Tool \"run_shell_command\" not found. Did you mean one of: \"update_topic\", \"grep_search\", \"invoke_agent\"?","error":{"type":"tool_not_registered","message":"..."}}
```

Resultado com uso de tokens:

```json
{"type":"result","timestamp":"2026-10-20T06:48:30.269Z","status":"success","stats":{"total_tokens":2580,"input_tokens":2400,"output_tokens":80,"cached":1600,"input":800,"duration_ms":153,"tool_calls":0,"models":{"gemini-3.5-flash-lite":{"total_tokens":1290,"input_tokens":1200,"output_tokens":40,"cached":800,"input":400},"gemini-3.1-pro-preview":{"total_tokens":1290,"input_tokens":1200,"output_tokens":40,"cached":800,"input":400}}}}
```

Erro (no `stream-json` o erro sai no próprio `result`, na saída padrão):

```json
{"type":"result","timestamp":"2026-10-20T06:47:38.593Z","status":"error","error":{"type":"unknown","message":"[API Error: {\"error\":{\"message\":\"{\\n  \\\"error\\\": {\\n    \\\"code\\\": 400,\\n    \\\"message\\\": \\\"API key not valid. Please pass a valid API key.\\\", ... \\\"reason\\\": \\\"API_KEY_INVALID\\\" ..."},"stats":{"total_tokens":0, ...}}
```

O que isso significa para o leitor do stream:

- **O `result` não traz o texto final.** O texto é a soma dos `message` do assistente **depois
  do último `tool_result`** (no `-o json` o campo `response` é exatamente isso: medido, o
  "Vou ler o arquivo." que veio antes da ferramenta ficou de fora). O envelope sai dessa soma.
- **Não há custo em dólar**, só tokens. E o `output_tokens` do stream **não inclui o
  raciocínio**: no `-o json` o mesmo pedido mostra `thoughts: 50`, e no stream ele só aparece
  como `total_tokens - input_tokens - output_tokens` (1290 - 1200 - 40 = 50). A API cobra o
  raciocínio como saída.
- `input` é `input_tokens - cached` (a parte não cacheada).
- Com `-m auto` (o padrão) o CLI faz uma chamada extra de roteamento num modelo leve antes de
  cada turno (`gemini-3.5-flash-lite` acima). Ela aparece em `stats.models` e custa.
- No `-o json` o erro vai para a **saída de erro** como JSON
  (`{"session_id":"...","error":{"type":"Error","message":"You have exhausted your daily quota on this model.","code":429}}`)
  e a saída padrão fica vazia. O Farol deve usar só o `stream-json`.
- **Código de saída não é confiável no Windows**: oito execuções terminadas com
  `"status":"success"` saíram com código 127, todas com
  `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76` na
  saída de erro (um defeito do libuv ao fechar). Erros vistos: 41 (autenticação), 144 (chave
  inválida), 173 (cota), 1 (modelo inexistente e cliente não suportado). Quem decide é o
  `status` do `result`; o código de saída só vale quando não houve `result`.

## 2. Autenticação

| modo | como liga | onde guarda | sem terminal gráfico | por perfil |
|---|---|---|---|---|
| conta Google (`oauth-personal`) | login interativo | `~/.gemini/oauth_creds.json` e `google_accounts.json` | só com `NO_BROWSER=true` e código colado; sem terminal: `FatalAuthenticationError: Manual authorization is required but the current session is non-interactive` (saída 41) | sim, via `GEMINI_CLI_HOME` |
| chave da Gemini API (`gemini-api-key`) | `GEMINI_API_KEY` no ambiente, ou `.env`, ou a tela `/auth` | ambiente; a tela `/auth` grava no chaveiro do sistema, serviço `gemini-cli-api-key`, **global** (não respeita `GEMINI_CLI_HOME`) | sim, é só variável de ambiente | sim, se o Farol injetar a variável por sessão |
| Vertex AI (`vertex-ai`) | `GOOGLE_GENAI_USE_VERTEXAI=true` mais `GOOGLE_CLOUD_PROJECT` e `GOOGLE_CLOUD_LOCATION` (ADC ou `GOOGLE_APPLICATION_CREDENTIALS`), ou `GOOGLE_API_KEY` no modo expresso | ADC do gcloud ou o JSON da conta de serviço | sim (`gcloud auth application-default login --no-browser`, ou conta de serviço) | sim, por variável |

O login Google, além de recusado no plano individual, falhou assim na primeira execução que
encontrou a credencial:

```text
Error authenticating: IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products: https://antigravity.google
  ineligibleTiers: [ { reasonCode: 'UNSUPPORTED_CLIENT', tierId: 'free-tier', tierName: 'Gemini Code Assist for individuals' } ]
```

**Pasta por perfil existe**: `GEMINI_CLI_HOME` substitui a home (`homedir()` em
`packages/core/dist/src/utils/paths.js`), e tudo vai para `$GEMINI_CLI_HOME/.gemini/`
(settings, agentes, histórico de sessões em `tmp/<projeto>/chats/`). Medido: com uma pasta
temporária, nada foi escrito no `~/.gemini` real.

Para o modo servidor (Hostinger, Termux): **chave de API ou Vertex com conta de serviço**.
O login Google não entra.

## 3. Paridade com a revisão do Claude

| recurso do Farol | Gemini CLI 0.64.0 | como foi provado |
|---|---|---|
| subagente `pr-reviewer` | **suportado de outro jeito**. Arquivo `.md` com frontmatter (`name`, `description`, `tools`, `model`, `max_turns`, `timeout_mins`) e a ferramenta `invoke_agent` (`agent_name`, `prompt`). Só carrega da pasta do **perfil** (`$GEMINI_CLI_HOME/.gemini/agents/`); na pasta do projeto deu `Subagent 'pr-reviewer' not found.` (agente de projeto pede reconhecimento interativo). O fim do subagente é a ferramenta `complete_task`. | mock chamou `invoke_agent`; com o arquivo no perfil, `tool_result` `success` e `tool_calls: 3` |
| ver o que o subagente fez | **degrada**. O stream mostra só o `invoke_agent`, não as ferramentas de dentro (o `read_file` do subagente não saiu). O transcrito fica em disco: `$GEMINI_CLI_HOME/.gemini/tmp/<projeto>/chats/<sessão>/<subagente>.jsonl`, com os três `read_file` e o `complete_task`. | contagem no transcrito |
| marcador `FAROL_CHECKPOINT` | **suportado**: é texto do assistente; chega nos `delta` e precisa de buffer por linha, porque a linha pode vir partida entre pedaços. | o marcador saiu inteiro no `message` |
| MCP do Jira com `--strict-mcp-config` | **suportado de outro jeito**. Não há flag de arquivo de MCP: os servidores vêm do `settings.json` (`mcpServers`). `--allowed-mcp-server-names jira` deixou só o `jira` (o `outro`, do mesmo arquivo, sumiu da lista de ferramentas). As ferramentas viram `mcp_<servidor>_<ferramenta>`. O arquivo de sistema (`GEMINI_CLI_SYSTEM_SETTINGS_PATH`) foi **recusado** porque a pasta não é de um administrador. | lista de ferramentas no corpo da requisição: `...,invoke_agent,mcp_jira_getJiraIssue_jira`; chamada devolveu `card BT-1 de jira` |
| lista de ferramentas permitidas | **suportado, e melhor que a do Claude**. Motor de políticas em TOML (`--policy arquivo.toml`): `commandPrefix = ["gh pr view", "gh pr diff", "gh api", "git"]` liberou `git --version` e `gh pr view ...`, negou `gh --version` e negou `git --version && echo pwned`. Pegadinha: prefixo `"git "` com espaço no fim nega tudo. `--allowed-tools` existe mas está obsoleto. | `tool_result` com `success` nos liberados e `Tool execution denied by policy.` nos outros |
| aprovação sem prompt | **suportado**. No modo padrão sem terminal as ferramentas de escrita e o shell nem são registrados (`Tool "write_file" not found`); leitura, busca e MCP rodam. `--approval-mode yolo` libera tudo; a política acima libera só o necessário. | t4, t6, t7, p1 a p4 |
| somente leitura (diagnóstico A3) | **suportado**: `--approval-mode plan` (`Tool execution denied by policy. You are in Plan Mode and cannot modify source code.`), ou o modo padrão sem política de shell. | t5 |
| retomada (`--resume` do chat por PR) | **suportado, e mais simples que no Claude**. `--session-id <uuid>` deixa o Farol escolher o id antes de abrir; `--resume <uuid>` continua a mesma conversa (o arquivo da sessão ficou com `primeira` e `segunda`). O histórico mora em `$GEMINI_CLI_HOME/.gemini/tmp/<projeto>/chats/`, então retomar exige a mesma home e a mesma pasta de trabalho. | r1, r2 |
| escolha de modelo | **suportado**: `-m gemini-2.5-pro`. O padrão `auto` faz a chamada de roteamento extra. | `init` com `"model":"gemini-2.5-pro"` e a URL pedida |
| escolha de esforço | **suportado de outro jeito**. Não há flag. Um apelido no `settings.json` (`modelConfigs.customAliases`) com `thinkingConfig.thinkingLevel` (Gemini 3) ou `thinkingBudget` (2.5), e `-m <apelido>`. | `-m farol-pro-low` pediu `gemini-3.1-pro-preview` com `"thinkingConfig":{"includeThoughts":true,"thinkingLevel":"LOW"}`; o 2.5 sem apelido foi com `thinkingBudget: 8192` |
| protocolo no `CLAUDE.md` do workspace | **suportado**: `"context": {"fileName": ["CLAUDE.md"]}` no `settings.json` faz o CLI ler o `CLAUDE.md` em vez do `GEMINI.md`. | marcador do `CLAUDE.md` apareceu no corpo da requisição |
| teto de tempo | **sem equivalente**. Com a rede fora, o CLI tentou de novo em silêncio (`Attempt 1 failed. Retrying with backoff... fetch failed sending request`, 8 tentativas) e foi morto pelo `timeout` de 180 s sem emitir `result`. O teto de 30 min do Farol continua obrigatório. | e3 |
| cancelamento (`killTree`) | **suportado**: o CLI é um `node` que se relança como filho (dois processos). `taskkill /pid <pai> /T /F` derrubou os dois. No POSIX o mesmo grupo de processos do `detached` atende; não medido aqui. | lista de processos antes e depois |

## 4. Mensagens de erro para `lib/log-taxonomy.js`

| caso | mensagem real | origem | classe proposta |
|---|---|---|---|
| chave inválida | `API key not valid. Please pass a valid API key.` (`API_KEY_INVALID`) | API real | permanente |
| login Google sem terminal | `Manual authorization is required but the current session is non-interactive. Please run the Gemini CLI in an interactive terminal to log in, provide a GEMINI_API_KEY, or ensure Application Default Credentials are configured.` | CLI real | permanente (ambiente) |
| plano individual recusado | `This client is no longer supported for Gemini Code Assist for individuals.` | API real | permanente (ambiente), com a ação "use chave de API ou Vertex" |
| cota diária | `[API Error: You have exhausted your daily quota on this model.]` seguido de `Please wait and try again later. To increase your limits, request a quota increase through AI Studio, or switch to another /auth method` | texto do CLI; o 429 veio do servidor falso | espera-reset, **sem hora de reset** na mensagem (cota diária da API vira à meia-noite do Pacífico, o Farol teria que calcular) |
| modelo inexistente | `[API Error: models/gemini-9-inexistente is not found for API version v1beta, or is not supported for generateContent. ...]` | texto do CLI; o 404 veio do servidor falso | permanente |
| rede | `Attempt N failed. Retrying with backoff... Error: exception TypeError: fetch failed sending request` (saída de erro, sem `result`) | CLI real | transitório; na prática a sessão morre pelo teto de tempo do Farol |
| ferramenta negada | `Tool execution denied by policy.` e `Tool "x" not found.` | CLI real | não é falha de sessão: vai ao feed |

A cota por minuto (com `RetryInfo`) o CLI tenta sozinho; não foi medida separadamente.

## 5. Revisão de ponta a ponta

**Bloqueada por falta de credencial válida.** O login Google é recusado e não há chave de API
nem ADC na máquina. O que foi provado com o CLI real e o servidor falso:

- o prompt real (`workspace-template/prompts/pr-review-auto.md`, URL e checkpoint
  substituídos, 22.409 bytes) chegou inteiro pela entrada padrão com `-p ""`;
- um envelope do contrato partido em três pedaços de texto foi remontado a partir dos `delta`
  depois do último `tool_result`, e `JSON.parse` devolveu `verdict: approve`,
  `decision: needs_decision`.

Não está provado: que um modelo Gemini siga o protocolo de 22 KB, chame o `pr-reviewer` e
devolva **só** o JSON. Para medir, o dono cria uma chave em https://aistudio.google.com/apikey
e roda ele mesmo, numa pasta temporária, só lendo (sem postar nada):

```bash
GEMINI_API_KEY=<sua chave> gemini -p "" -o stream-json -m gemini-2.5-pro --policy farol-revisao.toml < prompt.txt
```

com `prompt.txt` sendo o `pr-review-auto.md` com `{{URL}}` trocado por um PR público pequeno e
`farol-revisao.toml` a política da seção 3. Ou grava a chave como variável de usuário e pede
para a medição ser refeita.

## Onde o Codex tocou (o mapa que o Gemini segue)

Contagem de linhas que citam o Codex, por arquivo, em `origin/main` (caaad870):

| arquivo | linhas | o quê |
|---|---|---|
| `lib/codex/stream.js` | 58 | argumentos, ambiente, leitura do stream, registro de uso, teto e cancelamento |
| `lib/codex/auth.js` | 3 | leitura do `codex login status` |
| `lib/engine/session.js` | 46 | `runProvedor` desvia para `runCodexStream`; terminal de login por SO |
| `server.js` | 35 | doctor (`codex --version`, login), PATH do boot, `resolveAuthForLogin`, `allClaudeAuthInfo`, migração de modelo e esforço |
| `lib/parse.js` | 18 | perfil `kind: 'codex'`, saneamento de modelo e esforço, remoção de chave do ambiente |
| `lib/engine/perfil-claude.js` | 6 | `authFromProfile` e o teste do perfil |
| `lib/modelos.js`, `lib/settings.js` | 7 | catálogo de modelos e chaves de config |
| `lib/engine/usage.js`, `quota.js`, `sync-consumo-grupo.js` | 10 | custo desconhecido, sem teto em dólar, fora do grupo de consumo |
| `lib/engine/selfpr.js` | 4 | cobertura não observável |
| `lib/log-taxonomy.js` | 4 | ressalva do teto de tempo |
| `lib/engine/retomada-duravel.js`, `diagnostico.js`, `falhas.js`, `skip-review.js`, `desfecho-automatico.js`, `comentario-proprio.js`, `lib/sync/*` | 1 a 2 cada | provedor no registro, diagnóstico, textos |
| `ui/pure/contas.js`, `sistema.js`, `consumo.js`, `grupos.js` | 31 | perfis, seletor de modelo, consumo |
| `ui/telas/sistema-automacao.js`, `sistema-perfis.js`, `sistema.js`, `acoes.js`, `caixa-revisao.js`, `sistema-ambiente.js`, `sistema-grupos.js` | 29 | telas |
| `test/` | 25 arquivos | |

## Desenho proposto

### Arquivos novos

| arquivo | papel |
|---|---|
| `lib/gemini/stream.js` | `runGeminiStream`, no molde do `lib/codex/stream.js`: argumentos, ambiente, leitura NDJSON, texto final depois do último `tool_result`, buffer de linha para o `FAROL_CHECKPOINT` e o sid, registro de uso, teto de 30 min e `killTree`. Decide pelo `status` do `result`, nunca pelo código de saída |
| `lib/gemini/home.js` | monta a home do perfil por sessão (ver abaixo): `settings.json` (`selectedType`, `context.fileName`, `mcpServers` do Jira do PR, apelidos de esforço), o agente `pr-reviewer.md` traduzido e a política TOML. Nada de credencial em disco |
| `lib/gemini/agente.js` | PURO: traduz o frontmatter de `workspace-template/.claude/agents/pr-reviewer.md` (`Bash` vira `run_shell_command`, `Read` vira `read_file`, `Grep` vira `grep_search`, `Glob` vira `glob`, `WebFetch` vira `web_fetch`; `model: opus` vira o modelo do perfil) |
| `lib/gemini/politica.js` | PURO: a política TOML (prefixos `gh` e `git` de leitura, escrita negada; no diagnóstico, só leitura) |
| `lib/gemini/cobertura.js` | lê o transcrito do subagente em `tmp/<projeto>/chats/<sessão>/` e devolve os `read_file`, para a cobertura do `selfpr.js` e do `coverageGap` continuar observável |
| `lib/gemini/precos.js` | tabela de preço por modelo (entrada, cache, saída, raciocínio como saída) com a data da tabela; o custo vira **estimado** e o teto do perfil volta a valer. Sem a tabela, o Gemini seria pago e sem teto, que é o pior dos dois mundos |
| `test/gemini-*.test.js` | argumentos, leitura do stream (com os eventos desta medição como fixture), tradução do agente, política, cobertura, preço, taxonomia |

### Home do perfil por sessão

O `settings.json` é o único lugar do MCP e dos apelidos, e o site do Jira muda por PR. Revisões
paralelas no mesmo perfil não podem dividir um arquivo. Então a home é
`~/.farol/gemini/<perfil>/<chave do PR>/`, recriada a cada sessão e preservada para o chat do
mesmo PR (a retomada exige a mesma home e a mesma pasta de trabalho). A chave entra por
`GEMINI_API_KEY` no ambiente do filho, como o perfil `apikey` do Claude faz hoje; o chaveiro
global `gemini-cli-api-key` nunca é usado.

### Comando

```text
gemini -p "" -o stream-json -m <modelo ou apelido> --session-id <uuid do Farol> \
  --policy <home>/farol-revisao.toml --allowed-mcp-server-names jira
```

com `GEMINI_CLI_HOME=<home>`, `GEMINI_API_KEY` (ou as variáveis do Vertex),
`GEMINI_CLI_TRUST_WORKSPACE=true` e o prompt na entrada padrão. Retomada: `--resume <uuid>` no
lugar do `--session-id`. Diagnóstico: `--approval-mode plan` sem política de shell.

### Arquivos tocados

Os mesmos do Codex na tabela acima, com `kind: 'gemini'` ao lado de `kind: 'codex'`:
`lib/parse.js` (perfil com chave, saneamento de modelo `gemini-*` e de esforço), `perfil-claude.js`,
`session.js` (`runProvedor`), `server.js` (doctor com `gemini --version` e presença da chave;
não existe comando de status de login), `lib/modelos.js`, `lib/settings.js`, `usage.js`,
`quota.js`, `sync-consumo-grupo.js` (aqui o Gemini **entra** no teto, ao contrário do Codex,
porque tem custo estimável), `selfpr.js`, `log-taxonomy.js` (as classes da seção 4),
`retomada-duravel.js`, `diagnostico.js`, a UI de perfis, automação e consumo, e o
`workspace-template/prompts/pr-review-auto.md` (o item 4 fala em `subagent_type`, que é o nome
do Claude; para o Gemini o texto precisa dizer `invoke_agent`). Sem terminal de login: perfil de
chave não loga, e a tela já esconde o botão nesse caso.

### O que degrada

- a linha do feed não diz qual subagente fez o quê (o stream não traz); a cobertura vem do
  transcrito depois do fim;
- custo é estimado pela tabela, não informado pelo provedor; a tabela envelhece;
- cota diária sem hora de reset na mensagem;
- a chamada de roteamento do `auto` custa; o Farol deve sempre passar `-m`;
- o protocolo de 22 KB nunca rodou num modelo Gemini (seção 5).

## Estimativa

| escopo | dias |
|---|---|
| nível do Codex: perfil com chave, stream, doctor, taxonomia, custo desconhecido, sem subagente nem cobertura | 2 |
| paridade com o Claude: mais home por sessão, agente traduzido, política, MCP do Jira, retomada, cobertura pelo transcrito, tabela de preço no teto | 3 a 4 |
| a revisão de ponta a ponta com chave e o ajuste do prompt que ela pedir | meio dia a 1, e é o maior risco: se o modelo não seguir o protocolo, o trabalho vira prompt, não código |

A estimativa anterior (2 a 3 dias, risco nas funções que só o Claude tem) estava certa no
tamanho e errada no risco: subagente, checkpoint, MCP restrito e retomada existem. O risco real
é comercial (não há mais franquia) e de qualidade do modelo no protocolo, que só a chave mede.

## Fontes

- Notas de versão do Gemini Code Assist (corte de 18/06/2026):
  https://docs.cloud.google.com/gemini/docs/codeassist/release-notes
- Relato do mesmo erro no repositório do CLI:
  https://github.com/google-gemini/gemini-cli/issues/28229
- Bundle do CLI instalado (`@google/gemini-cli/bundle/chunk-NR7L3FXV.js` e `policies/*.toml`),
  lido para os nomes de variáveis, o enum dos eventos e o esquema do agente.
