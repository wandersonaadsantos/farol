# Verificações A, B e C (16/09/2026)

Três verificações delimitadas sobre entregas já feitas, cada uma no CAMINHO REAL, não só no
helper. Branch `md/verificacoes`, cortada de `md/integracao`. As saídas brutas de toda rodada
(inclusive as que falharam) estão em `verificacoes-saidas/`, com o código de saída na última
linha de cada arquivo. Todo material de credencial usado aqui é SINTÉTICO, fabricado para o
teste, e nenhuma sessão de modelo foi aberta.

Resumo: **as três acharam defeito**, e as três foram corrigidas com teste e contraprova.

| | o que se prometia | o que estava acontecendo | correção |
|---|---|---|---|
| A | testar um perfil "nunca grava" | o CLI reescrevia o `.claude.json` da pasta do perfil e criava `backups/` ali, a cada teste | status roda contra cópia efêmera; credencial lida da pasta original |
| B | sessão de diagnóstico somente leitura | `--tools` não alcança hooks, plugins e skills de settings, que rodavam na sessão | `--safe-mode` e `--disable-slash-commands` na linha |
| C | pacote auditado contra vazamento | a varredura de conteúdo tinha lista de nove extensões; `.svg`, `.nsi` e `.txt` que viajam ficavam fora | varredura sem lista de extensão |

---

## A. Testar o perfil não pode alterar a pasta da assinatura

### O que foi medido

Script de medição rodando o caminho real (`Engine.claudeTestarPerfil`, `io.runShell`
INTOCADO, `claude` 2.1.268 instalado), com `FAROL_HOME` temporário, home falso e pastas de
perfil sintéticas, comparando a árvore de arquivos (nome, tamanho, sha256) antes e depois.
Saída: `verificacoes-saidas/a-medicao-antes-da-correcao.txt`.

Três casos, e nos TRÊS a pasta apontada mudou:

| caso | diferença depois de "testar" |
|---|---|
| pasta de perfil vazia | `+ .claude.json` (343 B), `+ backups/.claude.json.backup.<epoch>` |
| pasta com `.claude.json`, `settings.json` e `.credentials.json` sintéticos | `.claude.json` reescrito (95 B para 436 B), `backups/` com o conteúdo anterior |
| padrão da máquina (sem pasta) | o `~/.claude.json` do home reescrito, mais `~/.claude/backups/` |

O `.credentials.json` NÃO foi tocado em nenhum caso, e o `config.json` do Farol também não
(o "não grava" valia só para a configuração do Farol). Os arquivos reais da máquina
(`~/.claude.json`, `~/.claude/.credentials.json`) foram conferidos por tamanho e mtime antes
e depois de cada rodada e não mudaram: a medição inteira rodou com home e `FAROL_HOME` falsos.

Um detalhe medido e descartado: o `AppData/Roaming` vazio que aparecia no home falso é do
`powershell.exe` do `runShell` reagindo ao `USERPROFILE` falso, não do CLI
(`verificacoes-saidas/a-medicao-appdata.txt`, três invocações comparadas).

### Defeito

**Sim.** Testar o perfil alterava a pasta da assinatura, que é exatamente o que o contrato
"validar sem alterar indevidamente" proíbe. No padrão da máquina o arquivo alterado é o
`~/.claude.json` real do usuário.

### Correção

`lib/engine/perfil-claude.js`, `statusDoClaude`: o status roda contra uma CÓPIA efêmera e
privada (`mkdtemp` em `os.tmpdir()`, `chmod 0700` antes de qualquer arquivo entrar) com só
`.claude.json`, `settings.json` e `.config.json`, e `CLAUDE_SECURESTORAGE_CONFIG_DIR` aponta
para a pasta ORIGINAL, que é de onde o CLI lê a credencial. A cópia é apagada num `finally`,
inclusive quando o CLI falha, e falha no meio da cópia apaga o que já foi criado.

`CLAUDE_SECURESTORAGE_CONFIG_DIR` não é palpite: está no binário do CLI, onde o caminho do
`.credentials.json` e o nome do item de keychain do macOS (`Claude Code<sufixo>-credentials`,
com o sufixo derivado do sha256 dessa pasta) saem dessa variável, e com ela vazia o CLI cai no
padrão da máquina. Medido no caminho real
(`verificacoes-saidas/a-medicao-securestorage.txt`), com credencial sintética:

1. `CLAUDE_CONFIG_DIR=original`: `loggedIn: true`, e a pasta original ganha `.claude.json`
   reescrito mais `backups/`.
2. `CLAUDE_CONFIG_DIR=copia` sem a variável: `loggedIn: false` (a credencial não é vista).
3. `CLAUDE_CONFIG_DIR=copia` + `CLAUDE_SECURESTORAGE_CONFIG_DIR=original`: `loggedIn: true`,
   e-mail correto, **pasta original byte a byte igual**; só a cópia recebeu escrita.

Medição repetida com o caminho real depois da correção
(`verificacoes-saidas/a-medicao-depois-da-correcao.txt`): "nenhuma diferença" nos três casos,
na pasta do perfil, no home e no `FAROL_HOME`.

Nenhuma credencial é copiada, então nenhum segredo entra em diretório temporário nem em
fixture do repositório.

### Testes

`test/perfil-claude-sem-escrita.test.js` (novo, 6 casos), com `io.runShell` REAL e um `claude`
falso no PATH (script node que imita o CLI medido: lê a credencial da pasta segura, reescreve
o `.claude.json` e cria `backups/` na pasta de configuração que recebeu). Provam: pasta do
perfil byte a byte igual; home byte a byte igual no padrão da máquina; a cópia recebe
`settings.json` e nunca o `.credentials.json`; `chmod 0700` é o primeiro ato sobre a cópia;
a cópia nasce em `os.tmpdir()`; a cópia some quando o CLI cai e quando a própria cópia falha.

Ajuste declarado em `test/perfil-claude.test.js`: o caso que afirmava
`env.CLAUDE_CONFIG_DIR === DIR_A` passou a afirmar `CLAUDE_SECURESTORAGE_CONFIG_DIR === DIR_A`
e `CLAUDE_CONFIG_DIR !== DIR_A`, que é o contrato novo.

Nos casos POSIX o teste PULA com motivo escrito se o shell de login resolver outro `claude`
(no macOS o `path_helper` reordena o PATH): pular dizendo por quê é diferente de aprovar.

### Contraprova

12 mutações em cópia de trabalho, restauradas byte a byte com conferência de sha256.
Primeira rodada: 9 reprovaram, **3 passaram inertes** (`a-mutacoes-rodada1.txt`):

1. cópia sem `chmod 0700`: o modo POSIX não é observável no Windows. O teste passou a
   observar a CHAMADA (`fs.chmodSync` espionado), que existe nos dois sistemas.
2. falha no meio da cópia sem limpeza: não havia caso de falha na cópia. Nasceu o caso com
   `.claude.json` que é diretório (existe, mas `copyFileSync` falha).
3. cópia criada dentro da pasta do perfil: como ela é apagada no `finally`, a árvore não
   mudava. O teste passou a afirmar que a cópia nasce em `os.tmpdir()`.

Segunda rodada: **12 de 12 reprovaram** (`a-mutacoes-rodada2.txt`).

### Limites

- O que o CLI faz foi medido no Windows, com a versão 2.1.268. O comportamento do keychain do
  macOS (o sufixo derivado da pasta) está lido no binário e não foi executado num Mac.
- A medição observou a pasta de configuração, o home e o `FAROL_HOME`. Escrita do CLI em
  outros lugares (por exemplo `%LOCALAPPDATA%` ou `TMPDIR`) não foi medida.
- A cópia leva `settings.json`: se ele tiver `env` com segredo, esse segredo passa por um
  diretório temporário com modo 0700, apagado no `finally`. Não há como evitar isso sem
  deixar de validar o método de autenticação que o settings define.

---

## B. Diagnóstico somente leitura

### O que foi medido

`claude --help` da versão instalada (2.1.268), rodado com `CLAUDE_CONFIG_DIR` temporário vazio
e sem nenhuma variável de credencial no ambiente: `verificacoes-saidas/b-claude-help.txt`
(o `--help` não criou arquivo nenhum na pasta vazia). Mais a documentação oficial
(`code.claude.com/docs/en/cli-reference` e `/hooks`) e as cadeias do próprio binário.

O que ficou provado pelo texto da versão instalada:

- `--tools <tools...>`: "Specify the list of available tools from the built-in set" (restringe
  o CONJUNTO disponível, diferente de `--allowedTools`, que só dispensa confirmação). A
  documentação confirma: "this removes tools from Claude's context entirely".
- `--strict-mcp-config`: "Only use MCP servers from --mcp-config, ignoring all other MCP
  configurations".
- `--safe-mode`: "Start with all customizations (CLAUDE.md, skills, plugins, hooks, MCP
  servers, custom commands and agents, output styles, workflows, custom themes, keybindings,
  and more) disabled ... Admin-managed (policy) settings still apply. Auth, model selection,
  built-in tools, and permissions work normally."
- `--disable-slash-commands`: "Disable all skills".
- Existem ainda `--restricted` e `--bare`, os dois inadequados aqui: `--restricted` recusa
  `bypassPermissions` (a linha headless passa `--dangerously-skip-permissions` sempre) e
  confina os arquivos ao diretório de trabalho, e a sessão precisa ler `..\app`; `--bare`
  nunca lê OAuth nem keychain, o que derruba quem roda por assinatura.
- No binário: `Safe mode: all customizations are disabled (CLAUDE.md, skills, plugins, hooks,
  MCP, agents, and more)`, `Safe mode: skipping plugin hook registration` e
  `safe mode disables plugins (managed settings-file hooks still run)`.

A documentação de hooks diz que hooks de settings (usuário, projeto, local), de política
gerenciada e de plugins rodam em `-p`, e que **não são afetados** por `--tools` nem por
`--dangerously-skip-permissions`.

O `--setting-sources` da versão instalada aceita "user, project, local" como lista de fontes a
CARREGAR; o resumo que a documentação devolveu para essa linha divergiu do `--help` instalado
(e divergiu de si mesmo quanto a safe mode e hooks), então a fonte usada aqui é o `--help` da
versão instalada, mais as cadeias do binário.

### Defeito

**Sim, um controle faltando.** A sessão de diagnóstico saía com
`--tools Read,Grep,Glob --strict-mcp-config`. Isso tira Bash, Write, Edit, WebFetch, Task e as
ferramentas de MCP do contexto do modelo, mas NÃO alcança hooks de settings (inclusive o
`.claude/settings.json` do próprio workspace, que o Farol semeia), plugins, skills e agentes
customizados. Uma sessão anunciada como somente leitura podia, por essa via, disparar comando
configurado na máquina.

### Correção

`lib/engine/session.js`, `argsDeSomenteLeitura`: a lista passou a ser
`--tools Read,Grep,Glob --strict-mcp-config --safe-mode --disable-slash-commands`.
Hook de política gerenciada continua valendo, e isso é desejado: é da organização, não desta
sessão. Um CLI velho demais para conhecer as flags recusa a sessão com erro, que é o lado
seguro (falha fechada), não silêncio.

### Testes

`test/diagnostico-ia-execucao.test.js` (novo, 3 casos) exercita CONSTRUÇÃO e EXECUÇÃO: sem
`FAROL_HEADLESS_CMD`, com `spawn` real e um `claude` falso no PATH que grava o `argv`, o `cwd`
e o tamanho do que chegou pelo stdin. Afirma a linha exata
(`-p --output-format stream-json --verbose --dangerously-skip-permissions` mais as quatro
flags de restrição), o `cwd` no workspace, o prompt pelo stdin, a ausência de `--mcp-config`,
a sessão comum sem restrição nenhuma e a ordem (argumento de quem chama vem DEPOIS da
restrição, nunca no lugar dela).

Ajustes declarados: `test/diagnostico-ia-cmdline.test.js` e `test/diagnostico-ia-leitura.test.js`
passaram a exigir as quatro flags, e o caso cujo título prometia "kudos não muda" passou a
exercitar mesmo o kudos (ele só lançava `health`).

### Contraprova

13 mutações (em `session.js`, `tools.js` e `codex/stream.js`), restauradas byte a byte.
Primeira rodada: 12 reprovaram, **1 passou inerte** (`b-mutacoes-rodada1.txt`): pôr o kudos
também como somente leitura, porque nenhum caso lançava o kudos. Com o caso escrito, segunda
rodada: **13 de 13 reprovaram** (`b-mutacoes-rodada2.txt`).

### Limites

- **Codex**: o CLI não está instalado nesta máquina. Está provado apenas o ARGUMENTO EMITIDO
  (`--sandbox read-only`, e que sessão comum não o recebe). A restrição dentro do binário do
  Codex não foi observada.
- O efeito das flags DENTRO do Claude Code não foi executado: provar isso exigiria abrir uma
  sessão de modelo, o que não foi feito. O que está provado é o texto do `--help` da versão
  instalada, as cadeias do binário e a linha de comando efetiva do Farol.
- Distinção que a evidência mantém: o que está em jogo é o acesso da SESSÃO a arquivos e ações
  protegidos. Arquivo que o próprio CLI cria no diretório de configuração dele (por exemplo
  `.claude.json`, `backups/`, `projects/`) é outra coisa, e é assunto da verificação A.
- Com `Read` disponível, a sessão pode LER qualquer arquivo alcançável, inclusive credencial em
  disco, e o que ela lê pode sair no relatório. "Somente leitura" é sobre não alterar, não
  sobre confidencialidade.

---

## C. Auditoria do pacote

### O que foi medido

19 execuções do empacotador REAL
(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/make-package.ps1`), uma por
caso, com material sintético colocado em arquivo que ENTRA no pacote e restauração byte a byte
depois de cada uma (`verificacoes-saidas/c-casos-antes-da-correcao.txt` e
`c-casos-depois-da-correcao.txt`; a última linha registra `git status --porcelain` vazio).

Sem material sintético o pacote fecha: `ok pacote limpo ... (249 arquivos)`, código 0. Um
comentário inocente acrescentado a um `.js` também fecha: o que reprova é o segredo, não a
mudança.

Cada formato do padrão, sozinho, num comentário de `lib/io.js`, reprovou com código 1 e a
linha nomeada na saída: `ghp_`, `github_pat_`, `gho_`, `ATATT`, `Bearer ` com valor e o nome de
conta pessoal que o padrão lista. Em MAIÚSCULAS também reprova, porque o `Select-String`
ignora caixa por padrão.

Barreiras de nome provadas no caminho real, uma por vez: `lib/config.json`,
`lib/state/sintetico.json` e `ui/farol.log` reprovaram com "ARQUIVOS PROIBIDOS" e código 1.
A guarda de árvore suja também foi provada: mudança em `lib/` sem `FAROL_ALLOW_DIRTY=1` recusa
o build. Em toda reprovação o zip é apagado (o `dist` fica vazio).

### Defeito

**Sim.** A varredura de conteúdo usava `-Include` com nove extensões
(`.js .md .json .cmd .ps1 .html .css .sh .command`). Dois arquivos de TEXTO que viajam no
pacote ficam fora dessa lista, e um arquivo novo com extensão fora dela também. Medido:

| caso | antes | depois |
|---|---|---|
| `ghp_` sintético em `ui/favicon.svg` | pacote fechou limpo, código 0 | reprova, código 1 |
| `ghp_` sintético em `installer/farol.nsi` | pacote fechou limpo, código 0 | reprova, código 1 |
| `ghp_` sintético num `lib/sintetico-nota.txt` novo | empacotado, código 0 | reprova, código 1 |

### Correção

`tools/make-package.ps1`: a varredura passou a ler TODO arquivo do pacote
(`Get-ChildItem $tmpDir -Recurse -File`), sem lista de extensão. O próprio `make-package.ps1`
segue fora do pente (ele contém o padrão). Depois da mudança, o pacote limpo continua limpo
(249 arquivos, código 0): varrer os binários que viajam (`.png`, `.ico`, `.icns`) não produziu
falso positivo.

Lista de extensão foi trocada por "lê tudo" de propósito: lista envelhece calada a cada
arquivo novo, e foi assim que `.svg` e `.nsi` ficaram de fora.

### Testes

`test/pacote-auditoria.test.js`, que lê o PRÓPRIO empacotador (nunca uma cópia do padrão),
ganhou:

- a trava da varredura sem filtro (`-Include`, `-Filter` ou `-Exclude` na linha do
  `Get-ChildItem` reprova);
- a barreira de NOME como caso próprio: nove nomes proibidos que têm que casar e oito
  caminhos legítimos do pacote que não podem casar;
- duas menções nuas de prefixo (`ghp_`, `github_pat_`, `gho_` sem valor) na lista do que é
  código e não pode reprovar o pacote;
- o espelho do padrão passou a ignorar caixa, como o `Select-String` real, e a varredura do
  repositório passou a ler todo arquivo (em `latin1`), sem lista de extensão.

### Contraprova

11 mutações no empacotador, restauradas byte a byte. Primeira rodada: 8 reprovaram, **3
passaram inertes** (`c-mutacoes-rodada1.txt`):

1. padrão virando menção de prefixo (`ghp_` sem exigir valor): nenhum caso tinha menção nua de
   prefixo. Duas linhas assim entraram na lista de código legítimo.
2 e 3. barreira de nome perdendo `state/` e `config.json`: ela não tinha teste nenhum. Nasceu
   o caso da barreira de nome.

Segunda rodada: **11 de 11 reprovaram** (`c-mutacoes-rodada2.txt`).

### Alcance comprovado, e limites

Comprovado no caminho real: os seis formatos listados no padrão, em qualquer caixa, em
qualquer arquivo do pacote (inclusive `.svg`, `.nsi` e `.txt`), mais três barreiras de nome e a
guarda de árvore suja.

Limites medidos ou conhecidos, sem exceção criada para nenhum deles:

- **Segredo quebrado em duas linhas passa** (medido: `ghp_` partido em duas linhas fecha o
  pacote limpo). O `Select-String` é linha a linha.
- **Formato fora do padrão passa**: medido com uma chave sintética `sk-ant-api03-…`. Não estão
  cobertos, entre outros: chaves da Anthropic, OpenAI, AWS, Slack, Firebase, `.pem` de chave
  privada, JWT solto e token do Jira que não comece com `ATATT`.
- **Valor curto passa**: medido com `ghp_` seguido de 19 caracteres. O padrão exige 20 ou mais,
  por decisão anterior (sem isso ele acusava o próprio código que fala sobre credencial).
- **Binário comprimido**: os binários agora são lidos, mas só casam quando o segredo está em
  ASCII contíguo. Segredo dentro de um `.png` ou `.zip` comprimido não é alcançado.
- **O pente só olha o pacote.** Nada aqui promete que o repositório esteja limpo.
- Observação registrada, não corrigida: a guarda de árvore suja lista `tools/jira-mcp.js` e
  `tools/farol-parear.js`, mas não os outros arquivos de `tools/`, o `README.md` nem os
  `Instalar*/Desinstalar*` que também viajam. Mudança não commitada neles não recusa o build.

O `dist/` é ignorado pelo git e o zip gerado foi apagado ao fim.

---

## Gates

Rodados no fim, na ponta da branch (saídas em `verificacoes-saidas/`):

| gate | resultado | arquivo |
|---|---|---|
| `npm run check` | código 0 | `gate-final-check.txt` |
| `npm run lint` | código 0, sem regressão | `gate-final-lint.txt` |
| `npm test` | código 0 | `gate-final-test.txt` |

Nenhuma rodada de gate falhou. As rodadas que falharam de propósito são os testes vermelhos
(`a-teste-vermelho.txt`, `b-teste-vermelho.txt`, código 1 em cada) e as mutações da primeira
rodada de cada verificação, que é onde a contraprova mora.
