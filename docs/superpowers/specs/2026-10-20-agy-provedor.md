# Antigravity CLI (`agy`) como provedor de revisão (medição e desenho)

Data: 20/10/2026. Estado: medição feita, desenho proposto, nada implementado.
CLI medido: **`agy` 1.4.3**, já instalado na máquina em `%LOCALAPPDATA%\agy\bin\agy.exe`
(canal oficial do Windows, `irm https://antigravity.google/cli/install.ps1 | iex`; o
`updater/update_status.json` diz "Already on the latest version"). Para medir o Linux, a mesma
1.4.3 foi instalada no WSL (Ubuntu 24.04) pelo script oficial
(`curl -fsSL https://antigravity.google/cli/install.sh`) numa home temporária, sem login.
Windows 11, Node 24.15.0. Antecede este documento a medição do Gemini CLI
(`docs/superpowers/specs/2026-10-20-gemini-cli-provedor.md`, branch `docs/gemini-cli-provedor`),
que concluiu que o login Google não serve mais para o Gemini CLI e que o sucessor é o `agy`.

## Conclusão em nove linhas

1. **Uma revisão de ponta a ponta rodou no `agy` com o prompt real e devolveu o envelope do
   contrato**, que o `parseHeadlessResult` do Farol aceitou como está (seção 7). 13 minutos,
   `pr-reviewer` rodou como subagente, seis marcadores `FAROL_CHECKPOINT` saíram no stream.
2. **Essa revisão, de um PR de sete linhas, gastou cerca de metade da cota semanal de Gemini
   da conta** (97% para 45%, seção 3). Com o modelo padrão (`gemini-3.8-flash-high`) e o
   protocolo de hoje, cada conta aguenta perto de duas revisões por semana. É o número que
   decide se o `agy` vale como provedor principal; ver "Decisão que vem antes".
3. **A cota do plano é legível sem gastar nada**: `agy -p "/usage" --output-format json`
   devolve, por grupo de modelos, a fração restante e a hora exata do reset em UTC. É a melhor
   fonte que o Farol já teve para "limite acabou, volta às HH:MM" (seção 3 e o contrato).
4. **Várias contas na mesma máquina: por padrão, não; com um truque, sim, e provado.** O login
   mora numa vaga única do chaveiro do sistema (`gemini:antigravity`), igual para qualquer
   pasta. Com uma variável `SSH_*` no ambiente o `agy` guarda o token em arquivo dentro da
   home do processo, e com `USERPROFILE` (Windows) ou `HOME` (POSIX) por conta isso vira uma
   pasta por conta. As duas contas do dono rodaram **ao mesmo tempo**, cada uma na sua pasta,
   sem relogar (seção 2).
5. O modo sem terminal cobre o que a revisão usa: subagente, MCP filtrado por ferramenta,
   retomada por id, escolha de modelo e esforço, cancelamento, uso de tokens.
6. O que degrada: a lista de comandos permitidos casa só a linha exata (a revisão precisa de
   `--dangerously-skip-permissions`, a mesma postura do Claude hoje); o `usage` do `result` não
   inclui o subagente; o teto de tempo devolve **sucesso** com resposta vazia; retomar um id
   inexistente abre conversa nova calado; o subagente lê o PR pela web, não pelo `gh`.
7. Não medido: a mensagem e o código de saída reais de cota esgotada (nenhuma conta chegou a
   zero). O formato está no binário e no changelog (`AGY_ERROR: {...}`, saída 3), e o
   `/usage` dispensa depender dele.
8. Login sem terminal gráfico funciona: `agy -p` sem credencial imprime o link de autorização e
   lê o código pela entrada padrão, o mesmo formato do login do Claude pela tela (PR #262).
9. Estimativa: **3 dias** para o provedor com troca entre contas pelo `/usage`; os riscos são o
   truque do `SSH_*`, que não é contrato do produto (seção 2), e o custo em cota do item 2.

## Decisão que vem antes (é do dono)

Com perto de duas revisões por semana por conta no modelo padrão, duas contas dão umas
quatro revisões semanais antes de cair no Claude Max. Antes de implementar, vale medir o que
muda o número:

| alavanca | o que medir |
|---|---|
| `--model gemini-3.8-flash-low` ou `-medium` | o mesmo PR, a mesma revisão: quanto da cota cai e se o envelope continua certo |
| subagente | a revisão sem o `pr-reviewer` gastaria cerca de metade (o subagente leu o PR de novo pela web e consumiu mais que o principal) |
| grupo "Claude e GPT" | `claude-sonnet-4-6` usa outro balde de cota, intocado nas duas contas; é uma terceira fonte, com outro modelo |

Se nenhuma alavanca trouxer a revisão para uns 10% da cota, o `agy` serve como reforço e
segunda opinião, não como provedor principal da fila.

## Como a medição foi feita

- Tudo com o CLI real e o modelo real. Até a seção 2, pela conta Google que já estava no
  chaveiro (a Gmail, inclusive a revisão de ponta a ponta); na seção 2, pelas duas contas do
  dono, cada uma logada por ele numa pasta própria. Nenhuma credencial nem código de
  autorização foi digitado por esta medição.
  O e-mail da conta não aparece aqui; onde importou saber que duas execuções usaram a mesma
  conta, a comparação foi pelo resumo SHA-256 da linha de log, sem o texto.
- Pastas temporárias como home (`USERPROFILE=<tmp>`) para não tocar `~/.gemini` real, exceto o
  `/usage` e um `git status` que leram a configuração real sem alterá-la.
- Modelo das medições curtas: `gemini-3.8-flash-low`. A revisão de ponta a ponta rodou sem
  `--model`, ou seja, no padrão da conta (`gemini-3.8-flash-high`, conforme `agy -p "/model"`).
- Um servidor MCP falso em Node (stdio, duas ferramentas: `getJiraIssue` e `apagarTudo`)
  serviu para provar o filtro; o resto é saída do `agy`.
- Pegadinha do Git Bash no Windows: `agy -p "/usage"` sem `MSYS_NO_PATHCONV=1` vira
  `C:/Program Files/Git/usage` e vai para o modelo. O Farol não passa pelo Git Bash para
  disparar o provedor, mas quem reproduzir à mão precisa saber.

## 1. Modo não interativo

`agy -p "<prompt>"` (ou `--print`/`--prompt`) roda um turno e sai. `--output-format` aceita
`text`, `json` e `stream-json`. Com `--input-format stream-json` o prompt vem pela entrada
padrão, uma linha NDJSON por turno (`{"event":"user","message":{"content":"..."}}`); é o que o
Farol deve usar, porque o prompt da revisão tem 22 KB e a linha de comando do Windows tem teto
de 32 KB. A revisão de ponta a ponta rodou assim.

`json`, um objeto no fim:

```json
{"conversation_id":"0b3391ce-1077-4174-8da6-bad31d6fcb3b","status":"SUCCESS","response":"oi\n","duration_seconds":2.7169828000000003,"num_turns":1,"usage":{"input_tokens":6705,"output_tokens":93,"thinking_tokens":92,"cache_read_tokens":0,"total_tokens":6798}}
```

`stream-json`, três eventos (`init`, `step_update`, `result`):

```json
{"event":"init","conversation_id":"dca707b0-...","init":{"cwd":"C:\\...\\m\\w","tools":["ask_custom_permission","ask_permission",...,"invoke_subagent",...,"run_command",...,"view_file","write_to_file"],"permission_mode":"request-review"}}
{"event":"step_update","step_update":{"conversation_id":"dca707b0-...","step_index":1,"state":"DONE","step_type":"agent_response","duration_seconds":4.5582821,"usage":{"input_tokens":6731,"output_tokens":400,"thinking_tokens":290,"cache_read_tokens":0,"total_tokens":7131}}}
{"event":"step_update","step_update":{"conversation_id":"dca707b0-...","step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"read_file","tool_info":{"name":"read_file","parameters":{"Path":"C:\\...\\leia.txt"}}}}
{"event":"step_update","step_update":{"conversation_id":"dca707b0-...","step_index":2,"state":"DONE","step_type":"tool","tool_name":"read_file","duration_seconds":0.0329861,"tool_info":{"name":"read_file","parameters":{"Path":"C:\\...\\leia.txt"},"output":"1 lines, 20 bytes"}}}
{"event":"step_update","step_update":{"conversation_id":"dca707b0-...","step_index":3,"state":"ACTIVE","step_type":"agent_response","text_delta":"e6-035c94a7fcb9/scratchpad/m/w/leia.txt) é **42**.\n\nFAROL_CHECKPOINT {"}}
{"event":"step_update","step_update":{"conversation_id":"dca707b0-...","step_index":3,"state":"ACTIVE","step_type":"agent_response","text_delta":"\"x\":1}"}}
{"event":"result","result":{"conversation_id":"dca707b0-...","status":"SUCCESS","response":"O número presente no arquivo [leia.txt](file:///C:/...) é **42**.\n\nFAROL_CHECKPOINT {\"x\":1}\n","duration_seconds":8.8569926,"num_turns":1,"usage":{"input_tokens":13952,"output_tokens":768,"thinking_tokens":533,"cache_read_tokens":0,"total_tokens":14720}}}
```

Ferramenta que falha ou é negada sai como `state: "ERROR"` com `tool_info.error`:

```json
{"event":"step_update","step_update":{"conversation_id":"8f63914c-...","step_index":2,"state":"ERROR","step_type":"tool","tool_name":"run_command","duration_seconds":0.0337488,"tool_info":{"name":"run_command","parameters":{"CommandLine":"git --version"},"error":{"type":"TOOL_ERROR","message":"permission check failed for command \"git --version\": user denied permission to run command:\ngit --version\nDo not attempt to circumvent this denial by rephrasing the command, ..."}}}}
```

Subagente sai como `step_type: "subagent"` com `subagent_info` (seção 5).

O que isso significa para o leitor do stream:

- **O `result.response` é o texto INTEIRO do turno**, inclusive o que o modelo disse antes das
  ferramentas (diferente do Gemini CLI, que guarda só o depois do último `tool_result`). Na
  revisão de ponta a ponta ele começou com uma frase em inglês antes do JSON; o
  `jsonSemCerca` do `session.js` resolve (primeiro `{` ao último `}`), medido.
- `text_delta` vem em pedaços que partem linha no meio (o `FAROL_CHECKPOINT {` e o `"x":1}`
  acima), então o marcador pede buffer por linha, como no Codex.
- **O `usage` do `result` é cumulativo do turno e não inclui subagentes** (seção 5). Somar os
  `usage` dos `step_update` com o do `result` conta duas vezes.
- Não há custo em dólar. `thinking_tokens` vem separado (o Gemini CLI escondia).
- `status` pode ser `SUCCESS`, `ERROR`, `CANCELED`, `INTERRUPTED`, `INVALID`, `WAITING` ou
  `RUNNING` (documentação de modo headless). `denied_actions` lista o que foi negado.

Códigos de saída medidos:

| caso | `status` | saída | onde aparece |
|---|---|---|---|
| turno normal | `SUCCESS` | 0 | |
| ferramenta negada no meio | `SUCCESS` (com `denied_actions`) | 0 | aviso `jetski: no output produced ...` no stderr quando a resposta fica vazia |
| `--model` inexistente | `ERROR`, `"error":"invalid model selection ..."` com a lista de modelos | 1 | stdout (json) e stderr |
| `--effort` inválido | | 1 | `error: invalid model selection (--model "" --effort "turbo"): invalid --effort "turbo" (valid: low, medium, high, xhigh, max)` |
| **`--print-timeout` estourado** | **`SUCCESS`, `response: ""`, `num_turns: 0`** | **0** | só o stderr: `[agy] print timeout after 1m40s with turn in progress; returning partial output` |
| sem login, sem terminal | `ERROR`, `"error":"authentication failed or timed out"` | o `timeout` externo matou (124) | seção 6 |
| processo morto (`taskkill /T /F`) | nenhum `result` | 1 | |
| falha do modelo ou da API no meio (não provocada) | `ERROR` | **3**, com `AGY_ERROR: {...}` no stderr | changelog 1.4.x; ver seção 3 |

O teto de tempo devolvendo sucesso é a armadilha número um: o Farol tem de tratar a linha
`[agy] print timeout` do stderr como falha transitória, nunca como resultado.

## 2. Várias contas na mesma máquina

### O padrão: uma vaga só

O token do login Google mora no chaveiro do sistema, numa entrada fixa:

```text
Destino: LegacyGeneric:target=gemini:antigravity
Usuário: antigravity
```

(saída do `cmdkey /list`; no Linux é o Secret Service, no macOS o Keychain, com o mesmo par.)
Trocar a home não troca a conta: com `USERPROFILE` numa pasta vazia, o `agy` criou a pasta de
configuração nova (`<home>\.gemini\antigravity-cli`, log, conversas, `brain/`) e **autenticou
com a mesma conta** (o log diz `ChainedAuth: authenticated via keyring`; o resumo da linha
`authenticated successfully as ...` é idêntico nas duas execuções). Não existe
`CLAUDE_CONFIG_DIR` nem `GEMINI_CLI_HOME` equivalente; o pedido está aberto no repositório do
CLI (google-antigravity/antigravity-cli#155, "Add equivalent to GEMINI_CLI_HOME env variable",
e #381, seleção de perfil de autenticação), sem resposta do Google até 19/10/2026.
`ANTIGRAVITY_APP_DATA_DIR`, que aparece no binário, **não** muda a pasta do CLI (medido: o log
seguiu em `C:\Users\wanderson\.gemini\antigravity-cli`).

### O caminho que existe: armazenamento em arquivo

O binário escolhe entre o chaveiro e um arquivo (`composite_token_storage.go`,
`shouldBypassKeyring`). Ele escolhe o arquivo quando detecta sessão SSH, WSL, Android sem
chaveiro ou chaveiro com timeout recente. Medido no Windows, com uma home vazia:

| ambiente | linha do log | resultado |
|---|---|---|
| nada | `ChainedAuth: authenticated via keyring` | conta do chaveiro |
| `SSH_CONNECTION=1.2.3.4 5 6.7.8.9 22` | `Using file-based token storage because SSH session detected` | pediu login (a home vazia não tem token) |
| `SSH_TTY=/dev/pts/0` | idem | idem |
| `SSH_CLIENT=1.2.3.4 5 22` | idem | idem |
| `container=docker` | (nenhuma) | conta do chaveiro |
| WSL, sem nada | `Using file-based token storage because WSL environment detected` | pediu login |

Então `SSH_CLIENT=<qualquer coisa>` mais `USERPROFILE=<pasta da conta>` (Windows) ou
`HOME=<pasta da conta>` (POSIX) dá uma pasta por conta, com token, configuração, conversas e
`brain/` separados. Os scripts `C:\Users\wanderson\agy-medicao\login-conta-x.cmd` e
`login-conta-y.cmd` fazem exatamente isso para o login de cada conta.

### A prova com as duas contas do dono

O dono fez o login uma vez em cada pasta, pelos dois scripts (link, página do Google, código
colado no terminal). Cada pasta ganhou um arquivo `.gemini\antigravity-cli\antigravity-oauth-token`
(1.751 bytes) e o log `Using file-based token storage because SSH session detected` seguido de
`ChainedAuth: interactive auth completed via consumer`. Depois, sem login nenhum, três
execuções **ao mesmo tempo** (início 04:59:45, fim 05:00:52):

| execução | ambiente | conta que autenticou (log, mascarado) | resposta |
|---|---|---|---|
| conta X | `SSH_CLIENT` + `USERPROFILE=...\conta-x` | `wa***@gmail.com` | `SUCCESS`, `conta x`, saída 0 |
| conta Y | `SSH_CLIENT` + `USERPROFILE=...\conta-y` | `wa***@icloud.com` | `SUCCESS`, `conta y`, saída 0 |
| padrão | nada | `wa***@icloud.com` (a do chaveiro) | `SUCCESS`, `padrao`, saída 0 |

E o `/usage` de cada pasta mostra cotas diferentes, o que prova que são assinaturas
diferentes e não só rótulos:

```text
conta X  Gemini Models          Weekly Limit Remaining  45%   2026-10-27T07:08:29Z
conta X  Claude and GPT models  Weekly Limit Remaining  100%  2026-10-27T08:02:11Z
conta Y  Gemini Models          Weekly Limit Remaining  99%   2026-10-27T07:45:34Z
conta Y  Claude and GPT models  Weekly Limit Remaining  100%  2026-10-27T08:02:15Z
```

O log do modo arquivo segue dizendo `ChainedAuth: authenticated via keyring`: o nome
interno não muda, o armazenamento sim. Quem confere a identidade lê a linha
`OAuth: authenticated successfully as ...`, não essa.

A vaga única também apareceu sem querer: às 04:40, durante a medição, um `agy` interativo na
home real saiu da conta Gmail e entrou na conta iCloud (o log mostra as duas na mesma
execução). Dali em diante **toda** execução no modo padrão passou a ser a conta iCloud, sem
aviso, inclusive as que já tinham uma pasta própria de configuração.

Riscos do caminho:

- **Não é contrato do produto.** É detecção de ambiente; uma versão pode passar a exigir
  chaveiro, ou mudar o critério. O provedor tem de conferir, a cada sessão, que a conta que
  autenticou é a esperada (seção do contrato) e parar com motivo claro se não for.
- O token fica em arquivo na pasta da conta, **em JSON legível** (`{"token":{...,"ya29...`),
  sem a proteção do chaveiro. A pasta tem de estar em `~/.farol/agy/<perfil>/`, com permissão
  restrita no POSIX, e fora de qualquer pacote, sincronização ou diagnóstico (o invariante 7
  já audita o pacote; o `diagnostico.js` não pode listar a pasta).
- `USERPROFILE` mudado é herdado pelos comandos que o agente roda. No Windows o `gh` lê a
  configuração de `%APPDATA%` e o `git` lê `HOME`, então os dois seguem iguais desde que o Farol
  mude **só** o `USERPROFILE`. No POSIX, mudar `HOME` tira o `gh` e o `git` da configuração do
  usuário: o `GH_TOKEN` que o Farol já injeta resolve o `gh`; o `git` precisa de
  `GIT_CONFIG_GLOBAL` apontando para o `~/.gitconfig` real, se a revisão depender dele.

## 3. Limite do plano

### O que dá para ler sem gastar nada

```bash
agy -p "/usage" --output-format json
```

```json
{"conversation_id":"","status":"SUCCESS","response":"Gemini Models\tWeekly Limit Remaining\t97%\t2026-10-27T07:08:29Z\nClaude and GPT models\tWeekly Limit Remaining\t100%\t2026-10-27T07:23:38Z\n","duration_seconds":0,"num_turns":0,"usage":{"input_tokens":0,"output_tokens":0,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":0},"command":{"name":"usage","data":{"description":"Within each group, models share a weekly limit. Quota is consumed proportionally to the cost of the tokens. ...","groups":[{"name":"Gemini Models","description":"Models within this group: Gemini Flash, Gemini Pro","buckets":[{"id":"gemini-weekly","name":"Weekly Limit Remaining","description":"You have used some of your weekly limit, it will fully refresh in 6 days, 23 hours.","window":"weekly","remaining_fraction":0.9737880229949951,"reset_time":"2026-10-27T07:08:29Z"}]},{"name":"Claude and GPT models","description":"Models within this group: Claude Opus, Claude Sonnet, GPT-OSS","buckets":[{"id":"3p-weekly","name":"Weekly Limit Remaining","window":"weekly","remaining_fraction":1,"reset_time":"2026-10-27T07:23:38Z"}]}]}}}
```

- Zero tokens, um segundo, saída 0. É comando do próprio CLI, não vai ao modelo.
- **Dois grupos de cota independentes** na conta medida: Gemini e "Claude e GPT". Cada um tem
  `buckets` com `window` (aqui só `weekly`; relatos de usuários falam também numa janela de 5
  horas em outros planos, então o Farol tem de ler todos os buckets, não só o semanal),
  `remaining_fraction` de 0 a 1 e `reset_time` em ISO UTC. Na saída para terminal a hora sai no
  fuso local; no `--json` e em pipe sai sempre em UTC (changelog).
- **A janela semanal começa no primeiro uso.** O `reset_time` da conta Gmail é `07:08:29Z`
  de 27/10, sete dias depois do primeiro uso dela nesta medição (04:08 de Brasília); o da conta
  iCloud é `07:45:34Z`, sete dias depois do primeiro uso dela. O Farol não pode prever o reset
  por calendário; tem de ler.
- Num grupo intocado (`remaining_fraction: 1`) o `reset_time` é só "agora mais sete dias" e
  anda a cada leitura (`07:23:38Z`, depois `07:50:18Z`, depois `08:02:11Z`): não significa nada.
- **Quanto custa uma revisão.** A conta Gmail estava com 97% do grupo Gemini na primeira
  leitura (por volta de 04:20, depois de três execuções curtas); depois
  da revisão de ponta a ponta (principal: 214.608 de entrada, 32.295 de saída, 23.085 de
  raciocínio, 2.061.458 de cache; subagente: mais 231.149, 21.131 e 4.006.053) e de umas
  vinte execuções curtas no `flash-low`, ficou com **45%**. As execuções curtas somam poucos
  pontos (as três primeiras, somadas a algum uso anterior nesta máquina, custaram 3), então a revisão de um PR de
  sete linhas custou perto de **50% da semana**. Uma leitura no meio da medição deu 100% e
  parecia contradizer isso: era a outra conta, porque o chaveiro trocou de conta às 04:40
  (seção 2). Lição para o desenho: o `/usage` só vale lido na pasta da conta certa.
- `/credits` nesta conta: `error: /credits failed: retrieving credits: no credits info found`,
  saída 0. O ajuste `useG1Credits` (créditos de IA depois da cota) existe e vem desligado; o
  Farol nunca deve ligá-lo, porque transformaria a cota do plano em gasto.

### O que acontece quando a cota acaba: não medido

Não deu para provocar (97 a 100% da semana nas duas medições). O que existe por escrito:

- Changelog 1.4.x: falha de modelo ou de API no modo `-p` sai com **código 3** e uma linha
  estruturada no stderr, `AGY_ERROR: {...}`, com status canônico, código HTTP ou gRPC,
  `retryable` e id do erro. O binário traz também a forma curta
  `AGY_ERROR: {"short_error":%q}`.
- Changelog: "reaching your individual quota is reported right away instead of being retried";
  "stops right away instead of retrying when the delay is longer than 30 seconds or the quota is
  a daily or billing cap"; com cota esgotada e créditos insuficientes, a frase é
  `Your AI credits balance is too low to continue.`
- Frases do binário: `You have exhausted your quota on this model.`, `individual quota reached`,
  `QUOTA_EXHAUSTED`, `STOP_REASON_QUOTA_EXHAUSTED`, `MODEL_CAPACITY_EXHAUSTED` (capacidade do
  modelo, que é outra coisa: passageira), e os campos `reset_time`/`resetTime` nos protos.
- Fora do Google: relatos de `RESOURCE_EXHAUSTED (code 429): You have exhausted your capacity
  on this model.` e de `UNAVAILABLE (code 503): No capacity available for model`. A issue
  google-antigravity/antigravity-cli#1278 (aberta) diz que no 1.4.2 a cota esgotada no `-p`
  aparecia como **timeout genérico**.

Consequência para o desenho: a mensagem não é confiável e talvez não traga a hora. O provedor
classifica pela mensagem (taxonomia) **e confirma pelo `/usage`**, que traz a hora sempre.

## 4. Modelos, esforço e custo

`agy models` (e `agy -p "/model"` mostra o atual):

```text
gemini-3.8-flash-high	Gemini 3.8 Flash (High)
gemini-3.8-flash-medium	Gemini 3.8 Flash (Medium)
gemini-3.8-flash-low	Gemini 3.8 Flash (Low)
claude-sonnet-4-6	Claude Sonnet 4.6 (Thinking)
claude-opus-4-6-thinking	Claude Opus 4.6 (Thinking)
gpt-oss-120b-medium	GPT-OSS 120B (Medium)
```

- A lista depende do plano da conta (o `/usage` cita "Gemini Pro" no grupo, mas a conta medida
  não lista nenhum Pro). O Farol tem de ler a lista **por conta**, pelo `agy models`, e nunca
  fixar o catálogo em código; um modelo que some vira `--model` inválido, saída 1.
- `--model <slug>` escolhe; `--effort low|medium|high|xhigh|max` escolhe o esforço onde o
  modelo aceita (`agy -p "/effort"` devolveu `high`). No Gemini o esforço também está no slug
  (`-low`, `-medium`, `-high`).
- **Claude Opus e Sonnet pela cota do Google**, em grupo de cota separado do Gemini. É um
  terceiro balde de graça, mas é outro modelo: a decisão de usar fica com o dono.
- Custo em dólar: nenhum. A cota é "proporcional ao custo dos tokens", sem tabela pública; o
  Farol registra tokens e trata o custo como **desconhecido**, igual ao Codex.

## 5. Paridade com o que a revisão usa

| recurso do Farol | `agy` 1.4.3 | como foi provado |
|---|---|---|
| subagente `pr-reviewer` | **suportado**. Agente em Markdown em `.agents/agents/<nome>.md` no workspace (também `~/.gemini/config/`), com `name` e `description` no frontmatter; o principal chama `invoke_subagent` e recebe o resultado por `send_message`. Os campos `tools: Bash, ...` e `model: opus` do Claude foram tirados na cópia. | revisão de ponta a ponta: `"type_name":"pr-reviewer"`, 102 passos do subagente, resultado entregue antes do envelope |
| ver o que o subagente fez | **degrada**. O stream mostra só o `invoke_subagent` e um `subagent_info` com o caminho do transcrito: `<home>/.gemini/antigravity-cli/brain/<conversa>/.system_generated/logs/transcript.jsonl`. As ferramentas de dentro (na ponta a ponta: 19 `read_url_content`, 23 `view_file`, 7 `search_web`) estão só lá. | leitura do transcrito |
| `usage` do subagente | **degrada**. O `result` do principal não soma o subagente (principal 214.608 de entrada e 32.295 de saída; subagente mais 231.149 e 21.131, com 4 milhões de leitura de cache). Cada passo do transcrito traz `input_tokens`, `cache_read_tokens`, `output_tokens`. | somas dos dois transcritos contra o `result` |
| marcador `FAROL_CHECKPOINT` | **suportado**: texto do assistente, partido entre `text_delta`. | seis marcadores na ponta a ponta; o de teste saiu partido |
| MCP do Jira | **suportado de outro jeito**. Servidores em `<home>/.gemini/config/mcp_config.json` (`mcpServers`, stdio ou HTTP), sem flag de arquivo. As ferramentas viram arquivos `<home>/.gemini/antigravity-cli/mcp/<servidor>/<ferramenta>.json` que o modelo lê e chama por `call_mcp_tool`. | `call_mcp_tool` com `ServerName: jira`, `ToolName: getJiraIssue`, saída `card BT-1 de jira: ...` |
| filtro de MCP (`--strict-mcp-config`) | **suportado pela permissão, não pela configuração**. `disabledTools` e `"disabled": true` foram **ignorados** (o servidor desligado subiu, a ferramenta filtrada foi listada). `permissions.allow: ["mcp(jira/getJiraIssue)"]` liberou a leitura do card e **negou** `apagarTudo`. Com `--dangerously-skip-permissions` o filtro some, então o Farol escreve na home da sessão só o servidor do Jira. | estados `DONE` e `ERROR` nas duas chamadas |
| lista de comandos permitidos | **degrada**. `permissions.allow` em `<home>/.gemini/antigravity-cli/settings.json`, formato `command(...)`. Medido: `command(git status)` liberou `git status`; `command(git log)` **negou** `git log -1 --oneline`; `command(gh)`, `command(gh pr)`, `command(gh pr view 1)` e `command(gh pr view *)` negaram `gh pr view 1 --repo cli/cli --json title`; só a linha exata passou. `git status && echo pwned` foi negado. Inútil para `gh api` com argumentos variáveis. | oito combinações, estados `DONE` e `ERROR` |
| aprovação sem prompt | **suportado**: `--dangerously-skip-permissions` (`permission_mode: always-proceed`) libera tudo. É a postura do Claude no headless hoje (`runProvedor` passa a flag sempre). Sem a flag, comando e escrita são negados em silêncio e a sessão costuma terminar com resposta vazia. | `run_command` e `write_file` `DONE` com a flag |
| somente leitura (diagnóstico A3) | **suportado**: o modo padrão (sem a flag) lê o workspace sozinho e nega comando e escrita. `--mode plan` também nega o comando. **Não use** `--mode plan --dangerously-skip-permissions`: a escrita passou (`write_file` `DONE`). | três rodadas |
| protocolo no `CLAUDE.md` do workspace | **suportado de outro jeito**: o `agy` lê `AGENTS.md`/`GEMINI.md` e `.agents/rules/`, não `CLAUDE.md`. Na ponta a ponta o workspace levou uma cópia do `CLAUDE.md` como `AGENTS.md`. | o protocolo foi seguido (identidade, card, `pr-reviewer`, envelope) |
| retomada (`--resume` do chat por PR) | **suportado com uma armadilha**. `--conversation <id>` continua a conversa (`num_turns: 2`, lembrou a palavra-senha). Exige a mesma home. **Id inexistente não falha**: `warning: conversation "..." not found` no stderr e uma conversa nova com outro `conversation_id`. O Farol não escolhe o id antes (não há `--session-id`); lê do `init`. | três rodadas |
| teto de tempo | **existe, mas mente**: `--print-timeout` (padrão sem limite desde o 1.3.x) devolve `SUCCESS`, saída 0 e resposta vazia, com aviso só no stderr (seção 1). O teto de 30 min do Farol continua obrigatório, e o aviso do stderr tem de virar falha. | rodada com `--print-timeout 100s` |
| cancelamento (`killTree`) | **suportado**: um processo só (`agy.exe`), sem filhos no Windows; `taskkill /PID <pid> /T /F` derrubou, sem `result`, saída 1. Servidor MCP e comandos do agente são filhos e caem juntos. | lista de processos antes e depois |
| uso de tokens | **suportado**: `input_tokens`, `output_tokens`, `thinking_tokens`, `cache_read_tokens`, `total_tokens`. Sem custo em dólar. Somar o subagente pelo transcrito. | todas as rodadas |
| shell dos comandos do agente | PowerShell no Windows (o modelo rodou `Get-ChildItem`) | ponta a ponta |
| servidor MCP que não responde | o turno **espera para sempre** (`MCP: 1 server(s) still connecting after 2m0s`) até o teto | rodada com o servidor quebrado |
| espaço em disco | `brain/` e `conversations/` crescem por sessão (2,6 MB e 5,1 MB numa revisão). Relato no #155: 15 GB no `antigravity-cli` de um usuário. O Farol tem de limpar a home da sessão | `du` depois da ponta a ponta |

## 6. Login sem terminal gráfico

Medido no WSL (Ubuntu 24.04), home temporária, sem `DISPLAY`, sem D-Bus, entrada padrão vazia:

```text
Authentication required. Please visit the URL to log in:
  https://accounts.google.com/o/oauth2/auth?access_type=offline&client_id=1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com&code_challenge=<...>&code_challenge_method=S256&prompt=consent&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback&response_type=code&scope=...&state=<...>

Waiting for authentication (timeout 60s)...
Or, paste the authorization code here and press Enter:

Error: authentication interrupted.
error: authentication failed or timed out
{"conversation_id":"","status":"ERROR","response":"","error":"authentication failed or timed out",...}
```

(`client_id` é o identificador público do aplicativo, não segredo; o `code_challenge` e o
`state` foram omitidos.) O log diz `Print mode: not authenticated, trying silent auth`,
`silent auth failed`, `triggering interactive OAuth`.

- É o formato do login do Claude pela tela (PR #262): link, página do Google que mostra o
  código, código colado na entrada padrão. O mesmo painel serve, com **60 segundos** de prazo
  em vez de esperar indefinidamente.
- No Linux sem chaveiro o token vai para arquivo dentro da `HOME` (no Windows, com o `SSH_*`,
  o arquivo é `<home>/.gemini/antigravity-cli/antigravity-oauth-token`), então no servidor
  (Hostinger, Termux) a pasta por conta funciona sem o truque. Medido no Linux só até o pedido
  de login; o login que dá certo foi feito e provado no Windows (seção 2), não no Linux.
- Alternativas oficiais para servidor: `GEMINI_API_KEY` com `"modelProvider": "gemini"` no
  `settings.json` (cobra por token) e `AGY_ADC_AUTH=true` com credencial de aplicativo do GCP
  (conta de negócio). Nenhuma das duas usa a cota do plano pessoal, que é o objetivo.

## 7. Revisão de ponta a ponta

PR público pequeno: **cli/cli#13788** ("fix: preserve percent-encoded path in DisplayURL",
+6/-1, um arquivo). Workspace temporário montado como o Farol monta: `workspace-template/`
copiado, `CLAUDE.md` também como `AGENTS.md`, `pr-reviewer.md` e `claim-verifier.md` em
`.agents/agents/` sem as linhas `tools:` e `model:`, prompt
`workspace-template/prompts/pr-review-auto.md` com `{{URL}}` e `{{CHECKPOINT_PATH}}` trocados
(22.795 bytes) pela entrada padrão.

```bash
agy --input-format stream-json --output-format stream-json --dangerously-skip-permissions --print-timeout 30m < prompt.ndjson
```

Resultado:

- `status: SUCCESS`, saída 0, 778 s de turno (13 min de relógio), 492 linhas de stream.
- O principal rodou 86 comandos (`gh pr view`, `gh pr diff`, `gh issue view`, `gh api`,
  `gh search code`, `Get-ChildItem`), leu arquivos, chamou o `pr-reviewer` uma vez e esperou o
  resultado (o subagente entregou por `send_message` às 07:45:33; o envelope saiu depois).
- O subagente **não usou terminal**: leu o PR pela web (`read_url_content`, `search_web`) e
  arquivos (`view_file`). Não deu para saber se foi escolha do modelo ou falta de permissão
  herdada; o `claim-verifier` não foi chamado.
- O envelope saiu com uma frase antes (`I have launched the pr-reviewer subagent ... will
  process its findings upon completion.`) e o JSON depois. O `parseHeadlessResult` do Farol
  (`lib/engine/session.js`) aceitou: `verdict: approve`, `decision: needs_decision`,
  `analysisStatus: complete`, `protocolo.prReviewer: rodou`, `coverage` com o único arquivo do
  PR, `payloads` com `approve`, `request_changes` e `comment`. Motivos: checks de build em
  FAILURE no CI e ausência de card do Jira (repositório sem Jira). As duas leituras estão
  certas para o PR.
- Nada foi postado: o envelope é a saída, e o `gh` só leu.
- Tokens: principal 214.608 de entrada, 32.295 de saída, 23.085 de raciocínio, 2.061.458 de
  leitura de cache; subagente mais 231.149, 21.131 e 4.006.053.

O que isso prova e o que não prova: o modelo padrão da conta seguiu o protocolo de 22 KB e
devolveu o contrato, num PR trivial. Não prova qualidade de revisão num PR real da BIUD, nem o
comportamento com o card do Jira (o MCP do Jira não estava na sessão).

## Onde o Codex tocou (o mapa que o `agy` segue)

O mesmo mapa da medição do Gemini CLI vale aqui (`lib/codex/stream.js`, `lib/codex/auth.js`,
`lib/engine/session.js` no `runProvedor`, `server.js` no doctor e na resolução de perfil,
`lib/parse.js`, `lib/engine/perfil-claude.js`, `lib/modelos.js`, `lib/settings.js`,
`usage.js`, `quota.js`, `sync-consumo-grupo.js`, `selfpr.js`, `log-taxonomy.js`, as telas de
perfis, automação e consumo, e cerca de 25 testes).

## Desenho proposto

### Arquivos novos

| arquivo | papel |
|---|---|
| `lib/agy/stream.js` | `runAgyStream`, no molde do `lib/codex/stream.js`: argumentos, ambiente da conta, prompt pela entrada padrão em `stream-json`, leitura dos três eventos, buffer de linha para `FAROL_CHECKPOINT`, `conversation_id` do `init` como sid, registro de uso, teto de 30 min, `killTree`. Decide pelo `status` do `result`; `[agy] print timeout` no stderr vira falha transitória; `AGY_ERROR:` no stderr vira a mensagem da falha |
| `lib/agy/home.js` | a pasta da conta e a home da sessão: `~/.farol/agy/<perfil>/` (token, persistente) e, por sessão, o `settings.json` (permissões) e o `mcp_config.json` só com o Jira do PR. Limpa `brain/` e `conversations/` de sessão encerrada, preservando a do chat do PR |
| `lib/agy/ambiente.js` | PURO: o ambiente do filho por SO. Windows: `USERPROFILE=<pasta da conta>`, `SSH_CLIENT=farol 0 0`, `HOME` intacto. POSIX: `HOME=<pasta da conta>`, `SSH_CLIENT` (inofensivo onde não há chaveiro), `GIT_CONFIG_GLOBAL` para o `.gitconfig` real, `GH_TOKEN` como hoje. Tira `GEMINI_API_KEY`, `GOOGLE_API_KEY` e `AGY_ADC_AUTH` herdados (mesma regra do `codexEnv`) |
| `lib/agy/cota.js` | PURO e IO: `lerCota(perfil)` roda `agy -p "/usage" --output-format json` no ambiente da conta e devolve os grupos; `cotaDoModelo(cota, modelo)` escolhe o grupo pelo modelo (`gemini-*` no grupo Gemini, `claude-*` e `gpt-*` no outro); `esgotada(grupo)` e `voltaEm(grupo)` (maior `reset_time` dos buckets com `remaining_fraction <= 0`) |
| `lib/agy/agente.js` | PURO: traduz `workspace-template/.claude/agents/*.md` para `.agents/agents/` (tira `tools:` e `model:`, que o `agy` não entende do jeito do Claude) e escreve `AGENTS.md` a partir do `CLAUDE.md` |
| `lib/agy/cobertura.js` | lê o transcrito do subagente (`subagent_info.subagents[].log_uri`) e devolve as leituras (`view_file`, `read_url_content`) para a cobertura do `selfpr.js`, e soma o `usage` do subagente ao da sessão |
| `lib/agy/login.js` | o login pela tela: `agy -p "Responda apenas: ok"` no ambiente da conta, link e código pelo painel do PR #262, 60 s de prazo; e a conferência de identidade (seção do contrato) |
| `test/agy-*.test.js` | argumentos, ambiente por SO, leitura do stream com os eventos desta medição como fixture, timeout que devolve sucesso, id de conversa trocado, `/usage` com os dois grupos, contrato do limite |

### Comando

```text
agy --input-format stream-json --output-format stream-json --dangerously-skip-permissions \
    --model <slug do perfil> [--effort <esforço>] [--conversation <id do chat>]
```

com o ambiente do `lib/agy/ambiente.js`, a pasta de trabalho do workspace e o prompt na
entrada padrão. Diagnóstico: o mesmo sem `--dangerously-skip-permissions`. O Farol confere,
na retomada, que o `conversation_id` do `init` é o pedido; se não for, a retomada falhou e a
sessão segue como nova, com o aviso no registro.

### Arquivos tocados

Os mesmos do Codex, com `kind: 'agy'` ao lado de `kind: 'codex'`, mais a entrada em
`lib/engine/provedores.js` do PR #263 (seção do contrato): `lib/parse.js` (perfil
`agy` com a pasta da conta e o rótulo, saneamento do slug por `^[a-z0-9.-]+$` e do esforço pela
lista medida), `perfil-claude.js` (`authFromProfile`, `testarPerfil` lê `/usage` e
`agy models`), `session.js` (`runProvedor` desvia para `runAgyStream`; terminal de login),
`server.js` (doctor com `agy --version`; PATH do boot com `%LOCALAPPDATA%\agy\bin` e
`~/.local/bin`), `lib/modelos.js` (catálogo lido por conta, não fixo), `usage.js`, `quota.js`
e `sync-consumo-grupo.js` (custo desconhecido, fora do teto em dólar, como o Codex),
`selfpr.js` (cobertura pelo transcrito), `log-taxonomy.js` (as classes do contrato),
`limite-plano.js` (chave da assinatura do `agy`), `retomada-duravel.js`, `diagnostico.js`, a
UI de perfis, automação e consumo, e o `workspace-template/prompts/pr-review-auto.md` (o item
4 fala em `subagent_type`, que é do Claude; para o `agy` é `invoke_subagent`).

### O que degrada

- linha do feed sem as ferramentas do subagente; a cobertura vem do transcrito no fim;
- o subagente leu pela web, não pelo `gh` (medir num PR privado antes de confiar: pela web ele
  não alcança repositório privado);
- custo desconhecido; a cota vem do `/usage`, em fração;
- lista de comandos inútil, então a revisão roda com tudo liberado, como o Claude hoje;
- a troca de conta depende de um comportamento não documentado (seção 2).

## O contrato com a cadeia de prioridade

A cadeia está no PR #263 (`feat/cadeia-de-perfis`, v2.75.0, aberto em 20/10/2026): ordena
perfis (Gemini X, Gemini Y, Claude Max BIUD), registra o limite **por assinatura** no
`lib/engine/limite-plano.js` (a sessão que falha leva `err.perfilDaSessao`, e
`registrarLimite(engine, conta, ate, agora, { auth, estimado })` grava na assinatura usada),
trata reset desconhecido como uma hora estimada (`TEMPOS.LIMITE_PLANO_SEM_HORA_MS`) e reserva
o lugar do `agy` em `lib/engine/provedores.js` (`RESERVADOS`). Cada provedor declara ali
`kinds`, o par de campos de modelo e esforço com os saneadores e
`limiteDaMensagem(msg, agora) -> { limite, ate }`. A cadeia pergunta, por perfil,
**posso rodar agora?**, **acabou, volta quando?** e **voltou?**. O que o provedor `agy`
entrega para caber nessa interface, sem mudar a cadeia:

### 0. A entrada em `provedores.js`

```js
{ id: 'agy', rotulo: 'Antigravity (Gemini)', kinds: ['agy'],
  campoModelo: 'agyReviewModel', campoEsforco: 'agyReviewEffort',
  saneiaModelo: sanitizeAgyModel, saneiaEsforco: sanitizeAgyEffort,
  limiteDaMensagem: limitePelaTaxonomia }
```

A leitura padrão (`limitePelaTaxonomia`) serve porque o próprio `runAgyStream` escreve na
mensagem de erro a frase com a hora tirada do `/usage` (item 2 abaixo). O provedor não
precisa de leitor próprio de limite; precisa só de classes na taxonomia que reconheçam o texto
do `agy` como `espera-reset`. Sai de `RESERVADOS` na mesma entrega.

### 1. Identidade da assinatura

`chaveDaAssinatura(auth)` em `lib/engine/limite-plano.js` ganha o caso
`kind === 'agy'`. Cada pasta de conta é uma assinatura; duas contas do GitHub no mesmo perfil
`agy` dividem a mesma cota, como no Claude. **Mais um nível**: o limite do `agy` é por
**grupo de cota**, não pela conta inteira (Gemini e "Claude e GPT" se esgotam separados).
A chave é `agy:<perfil>:<grupo>`, com o grupo vindo do modelo configurado para o provedor
(`gemini` ou `3p`, os `id` dos buckets sem o sufixo `-weekly`). Como o `resolveClaudeAuth`
devolve o `auth` do perfil, o grupo entra no próprio `auth` (`{ kind: 'agy', id, grupo }`),
montado com o modelo do `modeloDoProvedor(config, 'agy')`; assim trocar o modelo de Gemini
para Claude Sonnet faz a cadeia enxergar a conta livre no outro balde, e nenhuma linha da
cadeia muda.

### 2. "Acabou, volta às HH:MM"

Quando a sessão termina com sinal de cota:

1. O provedor monta a mensagem de falha com o texto do `AGY_ERROR` (ou do `error` do `result`)
   e **anexa a hora vinda do `/usage`**, numa frase que a taxonomia já entende:

   ```text
   agy: You have exhausted your quota on this model. (grupo gemini, conta <perfil>) resets Oct 27 at 7:08am
   ```

   A hora vai no **fuso local** e no formato que o `resetComData` de `lib/log-taxonomy.js` já
   lê (`resets <Mon> <dia> at <h>[:mm]am|pm`), porque o `resetAtFrom` interpreta no fuso da
   máquina. Converter do `reset_time` UTC para essa frase é do provedor, com `Date` local, sem
   biblioteca.
2. O erro carrega também o instante exato, para não depender do texto:
   `err.limitePlano = { ate: <ms epoch do reset_time>, grupo: 'gemini', fonte: 'usage' }`,
   ao lado do `err.perfilDaSessao` que o `runProvedor` do PR #263 já estampa. Hoje a cadeia lê
   só a mensagem; aceitar `err.limitePlano.ate` antes do `limiteDaMensagem` é uma linha no
   `review.js` e no `pushback.js`, e evita a volta pelo texto em fuso local. Opcional: a frase
   já basta.
3. Sem `/usage` legível (rede, CLI antigo), a hora fica de fora e vale a regra do PR #263:
   uma hora estimada, marcada como estimada na tela.

A taxonomia ganha, antes de `limite-plano`, os textos do `agy` na mesma classe (é limite de
janela, `kind: 'espera-reset'`):

```text
You have exhausted your (quota|capacity) on this model | individual quota reached |
QUOTA_EXHAUSTED | Your AI credits balance is too low to continue
```

E duas classes novas, fora de `limite-plano`:

- `MODEL_CAPACITY_EXHAUSTED`, `No capacity available for model`, `UNAVAILABLE (code 503)`:
  **transitório** (capacidade do Google, não cota da conta; trocar de conta não ajuda).
- `[agy] print timeout after`: transitório, e ainda conferir o `/usage` (a issue #1278 diz que
  cota esgotada já apareceu como timeout).
- `Authentication required` ou `authentication failed or timed out` com o perfil configurado:
  **permanente** (`credencial`), com a ação "abrir o login do perfil".

### 3. "Posso rodar agora?" e "voltou?"

Antes de lançar uma sessão no perfil, a cadeia pergunta `limiteAte(engine, conta)`. Para o
`agy` o provedor oferece uma leitura mais barata que bater na parede: `lerCota(perfil)`, que
roda o `/usage` (zero token, cerca de um segundo). A regra:

- `remaining_fraction > 0` no grupo do modelo: pode rodar.
- `remaining_fraction <= 0`: registra `registrarLimite(..., reset_time)` e devolve "volta em".
  Só o `reset_time` de bucket esgotado conta; o de bucket cheio é "agora mais sete dias" e
  anda a cada leitura (seção 3).
  A cadeia passa para o próximo perfil **sem abrir sessão**.
- Quando o `ate` registrado vence, `limiteAte` devolve 0 sozinho (é o comportamento atual do
  `limite-plano.js`); o provedor ainda confere o `/usage` uma vez antes da primeira sessão
  depois do reset, porque o reset observado andou (seção 3). Se o `/usage` disser que ainda
  está esgotado, registra o novo `reset_time` e a cadeia segue no fallback.
- Sessão que termina bem chama `liberarLimite` (comportamento atual).

Frequência do `/usage`: no máximo uma leitura por perfil a cada 5 minutos, e sempre uma antes
de voltar a um perfil que estava travado. Não é caminho de log: o resultado vai para a memória
do engine e para o `state/limite-plano.json` que já existe.

### 4. Conta errada nunca vira limite

Antes de registrar limite, e no começo de cada sessão, o provedor confere que a pasta do perfil
autenticou como a conta esperada (o e-mail gravado no perfil quando o login foi feito; o `agy`
o escreve no log da sessão em `OAuth: authenticated successfully as ...`, e o Farol compara o
resumo, nunca grava o e-mail em log). Se o `agy` voltar ao chaveiro (uma versão nova ignorando
o `SSH_*`), as duas pastas autenticariam com a mesma conta: o provedor para com a classe
permanente `agy-conta-trocada`, e a cadeia não confunde isso com cota.

### 5. O que a cadeia não pode esperar do `agy`

- hora do reset pela mensagem de erro (talvez não venha; venha do `/usage`);
- custo em dólar (não existe);
- id de conversa escolhido antes (não existe; o sid vem do `init`);
- um perfil `agy` sem pasta própria (sem o `SSH_*`, todos os perfis caem na mesma conta do
  chaveiro, e a cadeia trocaria de perfil sem trocar de conta).

## Estimativa

| escopo | dias |
|---|---|
| provedor no nível do Codex (stream, ambiente por conta, doctor, taxonomia, custo desconhecido) | 1,5 |
| `/usage` como fonte do limite, contrato com a cadeia, conferência de identidade | 0,5 |
| subagente traduzido, `AGENTS.md`, MCP do Jira na home da sessão, cobertura e uso pelo transcrito, limpeza de disco | 1 |
| revisão num PR real da BIUD com card e o ajuste de prompt que ela pedir | 0,5 a 1 |

## Fontes

- Documentação do modo headless, da referência e das funções do CLI:
  https://antigravity.google/docs/cli/headless, https://antigravity.google/docs/cli/reference,
  https://antigravity.google/docs/cli/features, https://antigravity.google/docs/install?tab=cli,
  https://antigravity.google/docs/getting-started?tab=cli
- `agy changelog` da 1.4.3 (960 linhas), lido para os códigos de saída, o `AGY_ERROR`, o
  `/usage` em JSON e o comportamento de cota.
- Issues do repositório do CLI: google-antigravity/antigravity-cli#155, #381, #1278, #78.
- Relato de terceiros sobre uma vaga só no chaveiro:
  https://agentsroom.dev/blog/multiple-accounts-antigravity-cli (o `SSH_*` não é citado lá).
- Relatos de usuários sobre cota no fórum do Google AI (janela de 5 horas e semanal).
- O binário instalado, lido para os nomes de variáveis, as frases de cota e a escolha do
  armazenamento do token.
