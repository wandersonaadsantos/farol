# macOS, Linux e os pontos com branch de plataforma

Extraído do `CLAUDE.md` na Fase 1.5 da reorganização. O `CLAUDE.md` da raiz é o sumário, e os
invariantes continuam lá.

<!-- indice:inicio (gerado; test/guias-navegaveis.test.js reprova se divergir das seções) -->

## Índice

- [Pontos com branch de plataforma](#pontos-com-branch-de-plataforma)
- [macOS: estado real e o que falta validar](#macos-estado-real-e-o-que-falta-validar)
- [Linux (experimental, v2.45.0)](#linux-experimental-v2450)

<!-- indice:fim -->

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
| `main.js`: autostart | `setLoginItemSettings` com args | LaunchAgent `~/Library/LaunchAgents/com.biud.farol.autostart.plist` que abre `~/Applications/Farol.app` pelo `open` (`lib/autostart-mac.js`; o login item ignoraria os args e abriria o Electron pelado) |
| `ui/app.js` | check do Git Bash no doctor | esconde Git Bash; o autostart aparece como "Iniciar com o macOS"; classe `mac` no body (padding do semáforo) |

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

- **Autostart por LaunchAgent (18/09/2026), escrito no Windows e PENDENTE de Mac real.** O login item do Electron registra o `Electron.app` de dentro de `node_modules` e ignora `args`, então abriria o Electron pelado. Ligar "Iniciar com o macOS" grava `~/Library/LaunchAgents/com.biud.farol.autostart.plist` (`/usr/bin/open -a ~/Applications/Farol.app`, `RunAtLoad`, SEM `KeepAlive` para fechar pela bandeja não reabrir); desligar remove. Sem `launchctl load`: vale do próximo login em diante, e carregar na hora abriria uma segunda instância. Sem o lançador instalado (rodando da fonte), recusa e loga em vez de gravar agente que abriria nada. O `uninstall.sh` apaga o plist. Validar num Mac: ligar, conferir o arquivo, sair e entrar na sessão, e ver se o Farol abre UMA vez; o macOS 13+ mostra o aviso "item de segundo plano adicionado", que é esperado.
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

**Contrato atual com Electron 44:** preservar o runtime exige executá-lo com
`ELECTRON_RUN_AS_NODE=1` e comprovar compatibilidade com o manifesto novo. Os
instaladores preparam e validam o substituto em pasta temporária antes de parar o
app ou copiar arquivos. O update leve recusa runtime incompatível e orienta usar
o instalador completo. `npm install` sozinho já não baixa o binário do Electron;
o fallback executa também `node node_modules/electron/install.js`.

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
  be refreshed`). `claude login` é ação do dono da máquina; a seção
  [Assinatura do Claude](CONFIGURATION.md#assinatura-do-claude-qual-contaplano-o-farol-usa-e-como-alternar)
  proíbe o Claude Code logar em nome do usuário. Falta ver relatório, veredito e o card em "Precisa de
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
  falha não gera toast, log nem diálogo. A remoção antecipada de `node_modules` no
  Linux foi corrigida no fluxo de preparação do Electron 44: primeiro valida o
  runtime instalado ou prepara o substituto em uma pasta temporária.
- Segue valendo o de sempre: o **nome no Dock** é "Electron", e o `.app` vai pra
  `~/Applications`, não pra `/Applications`. (O autostart deixou de faltar em 18/09/2026, por
  LaunchAgent; ver "Pendências conhecidas do port".)

Quando validar (ou corrigir) qualquer item acima, **atualize esta seção**: risque o que passou, documente o que mudou e por quê. Este arquivo é a memória do port.

### Auto-update travado pelo Electron 44 e o npm do nvm (11/09/2026, Mac do Thiago)

Primeiro salto de Electron desde que o auto-update ficou ligado por padrão, e ele
travou em campo. O `update.log` dizia `O Electron exigido nao esta disponivel e npm nao
foi encontrado`, todo ciclo, com a v2.57.5 preservada (o instalador fez o certo ao
recusar). As três causas somadas: (1) a v2.58 passou a exigir Electron 44 e o
instalado era 43.2.0; (2) o pacote leve não traz Electron, por desenho, então a única
saída era o fallback de rede via `npm`; (3) o `npm` da máquina vive no nvm do Homebrew
(`/opt/homebrew/opt/nvm/versions/node/vX/bin`), que só entra no PATH dentro do profile
do shell, e o instalador chega pelo APP, que o Finder abriu com PATH mínimo.
`/opt/homebrew/bin` estava no PATH, o `npm` não.

Correção em `installer/electron-runtime.sh`: `incluir_npm_de_gerenciador`, chamada nos
DOIS instaladores POSIX logo depois do `source` e ANTES do `preparar_runtime` (que é
quem consulta `npm`). Ela só age quando `command -v npm` falha, e então prependa o
`bin` do nvm (`NVM_DIR`, `~/.nvm`, `${HOMEBREW_PREFIX}/opt/nvm`; a versão MAIS NOVA que
de fato TENHA `bin/npm`, varrendo em ordem decrescente por `sort -rV`, porque um
`nvm install` interrompido deixa a pasta da versão sem npm e parar nela pularia a raiz
inteira), ou o alias default do fnm, ou o `~/.volta/bin`. **A raiz do Homebrew sai
de `HOMEBREW_PREFIX`** com os dois defaults (Apple Silicon e Intel), e isso não é
enfeite: é o que permite ao teste isolar o nvm REAL da máquina de quem roda a suíte,
que vazou na primeira rodada. Travado em `test/installer-npm-gerenciador.test.js`, que
roda a função de verdade em bash com HOME falso.

**No Windows isso não se aplica, e por dois motivos distintos.** O `install.ps1` acha o
`npm` por `Get-Command`, sobre o PATH que o app herdou, e no Windows o PATH é
PERSISTIDO no registro: nvm-windows, fnm e volta registram os diretórios deles lá, então
o app aberto pelo atalho já enxerga o `npm`. E não existe `~/.local/bin` no fluxo do
Windows: symlink ali não é lido por ninguém. Se um dia aparecer um Windows com `npm` só
visível dentro do shell, o lugar do conserto é o `Prepare-ElectronRuntime` do
`electron-runtime.ps1`, não o `.sh`. Não foi medido.

Paliativo local que também funciona, e que fica registrado porque foi o que destravou
esta máquina antes da correção: symlinks de `node` e `npm` em `~/.local/bin`, que o
`install.sh` já prependa. Fica preso à versão do nvm da hora (o alvo do link é o
diretório da versão), então um `nvm install` de versão nova quebra o link até refazer.
Com a correção acima o symlink deixa de ser necessário.

A atualização em si foi feita à mão a partir do repo (`npm install` + `node install.js`
do Electron, porque o npm pulou o postinstall, o mesmo caso documentado no ramo Linux;
depois `bash installer/install.sh`). O app abriu pelo lançador com PATH mínimo na
2.58.1 com Electron 44.3.0.

## Linux (experimental, v2.45.0)

Fundação aprovada pelo Wanderson em 16/08/2026 (sem usuário concreto; a motivação é completude honesta nos três SOs). NÃO é port desktop completo: **fora de escopo por decisão** ficam tray/autostart/notificações polidos, AppImage e instalador offline. WSLg não tem bandeja, então essa borda só se valida em desktop nativo, quando houver usuário.

O que existe:

- **Sessão de terminal**: os scripts bash do mac servem sem mudança; o que muda é o lançador. `pickLinuxTerminal(candidates, exists)` (pura, testada) escolhe na cadeia `x-terminal-emulator` (alternatives do Debian) → `gnome-terminal` → `konsole` → `xterm`; nenhum achado = toast alto com instrução, nunca silêncio. `spawnConsolePosix`/`spawnLoginConsolePosix` são o núcleo compartilhado mac/linux (o mac vira wrapper com `open -a Terminal`); o contrato M5 (exit != 0 = janela nunca abriu, limpa e devolve keys) vale igual nos dois.
- **Update**: `buildUpdateScriptLinux` (pura, mesmo escaping do mac) roda `install-linux.sh` e reabre via `setsid ~/.farol/bin/farol`; `posixInstallerName(isMac)` escolhe o instalador do ramo posix.
- **Instalação**: `installer/install-linux.sh` + `uninstall-linux.sh`. App em `~/.farol/app`, lançador `~/.farol/bin/farol` (exec no binário NATIVO `node_modules/electron/dist/electron`, mesma lição do mac), `.desktop` em `~/.local/share/applications` com ícone PNG. `FAROL_INSTALL_ROOT` permite instalar num root de teste sem tocar a instalação real (a lacuna A5 que o mac ainda tem). O Electron instalado só é preservado se atender ao manifesto; caso contrário, o substituto é preparado e validado em pasta temporária antes de alterar o app.
- **UI**: exemplos de caminho decidem por `ehWin()` (Linux vê `~/`); autostart aparece no Windows e no macOS, nunca no Linux (`setLoginItemSettings` é no-op lá).

Validação real (WSL Ubuntu-24.04, 16/08/2026, bancada oficial do ramo): `npm test` VERDE no Linux (1110 pass, incluindo os posix reais: killTree de grupo, quoting em bash, prefixo de auth); `install-linux.sh` rodou de ponta a ponta a partir de clone limpo com `FAROL_INSTALL_ROOT` (npm pulou o postinstall do electron e o fallback pro `install.js` cobriu, ver comentário no script); o app instalado ABRIU no WSLg pelo lançador e o engine respondeu HTTP 200 na 47170. NÃO validados (limite do WSLg, não do código): tray, notificações, sessão de terminal com emulador real (o WSL não tem terminal gráfico instalado; o caminho do "nenhum terminal" avisa alto por construção).
