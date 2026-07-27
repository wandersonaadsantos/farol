# Farol, guia do mantenedor

Leia isto antes de mexer em qualquer arquivo. Este documento existe pra que qualquer Claude Code (em qualquer máquina, Windows ou macOS) consiga manter o Farol sem quebrar os contratos do app.

## O que é

Radar de Pull Requests em Electron. O engine (`server.js`, Node puro) monitora o GitHub com comandos `gh` (zero tokens de IA), serve a UI local por HTTP + SSE e orquestra sessões do Claude Code (headless pra revisão autônoma, terminal pra sessão interativa). O `main.js` é só o shell Electron (janela, bandeja, notificações).

## Mapa de arquivos

| Caminho | Papel |
|---|---|
| `server.js` | Engine inteiro: polling, fila, revisão headless, chat por PR, ferramentas (kudos/diagnóstico), update, HTTP + SSE |
| `main.js` | Shell Electron (janela, bandeja, notificações, autostart) |
| `ui/` | UI sem framework: `index.html` + `app.js` + `app.css` |
| `workspace-template/` | Workspace semeado em `~/.farol/workspace` (protocolo de review do Claude); `prompts/pr-review-auto.md` é a revisão headless, `prompts/self-review.md` é a autoanálise dos meus PRs (só leitura, nunca posta) |
| `installer/install.ps1` / `uninstall.ps1` | Instalador Windows |
| `installer/install.sh` / `uninstall.sh` | Instalador macOS |
| `Instalar.cmd` / `Instalar.command` | Atalhos de duplo clique (Windows / macOS) |
| `tools/make-package.ps1` | Gera o zip LEVE de distribuição (sem node_modules) com auditoria anti-vazamento |
| `tools/make-installer.ps1` + `installer/farol.nsi` | Gera o INSTALADOR ÚNICO do Windows (`dist/Farol-Setup-vX.Y.Z.exe`, NSIS): um `.exe`, duplo clique instala e abre (roda o `install.ps1` por dentro). Requer `makensis` (vem com o Tauri em `AppData\Local\tauri\NSIS`). É o instalador de primeira instalação |
| `tools/make-offline.ps1` | (legado) Gera o pacote OFFLINE do Windows em zip (`dist/Farol-Offline-Windows-vX.Y.Z.zip`); substituído pelo instalador único acima |
| `tools/make-offline-mac.sh` | Gera o instalador OFFLINE do macOS (`dist/Farol-Instalar-mac.command`): autoextraível único, Electron embutido. RODA EM QUALQUER SO (baixa o zip darwin do GitHub e EMBUTE; o `.app` é montado no Mac na instalação, pois só o unzip do Mac preserva os symlinks do `.app`). Default Apple Silicon; `ARCH=x64` pra Intel. É BETA até validar num Mac real |
| `tools/publish-release.ps1` | Publica a release no GitHub (`wandersonaadsantos/farol`): sobe o pacote leve (update) + o instalador único Windows. É como as cópias distribuídas recebem atualização |
| `tools/make-icns.sh` | Gera `assets/farol.icns` (rodar num Mac) |

## Invariantes do projeto (não negociar)

1. **Zero dependências além do Electron.** O engine roda com Node puro (`node server.js`). Não adicione pacotes npm.
2. **Dados em `~/.farol`, nunca em AppData/Library.** No Windows o motivo é o MSIX virtualizar `%LOCALAPPDATA%`; no macOS mantemos o mesmo caminho por simetria (o estado migra entre máquinas copiando uma pasta só).
3. **Log só de falhas.** `farol.log` não recebe ruído operacional; o Diagnóstico usa esse log como fonte.
4. **Nada é postado no GitHub sem gate.** Auto-approve exige `requested === true` (revisão pedida a mim; revisão iniciada por clique no panorama nunca auto-posta), veredito `approve` e payload `APPROVE`. Com `autoApproveAll: true` (OPT-IN, ligado em Sistema) TODO PR aprovável é aprovado sozinho, sem depender do humano, com os pontos de atenção (`result.reasons` mais um aviso quando `cardMet === false`) anexados ao corpo do APPROVE (ficam visíveis no PR) e guardados no histórico (campo `attention`, que a UI mostra em Revisões recentes). O DEFAULT é `false` (gate estrito de sempre: só auto-aprova quando a sessão decidiu `decision === 'auto_approve'` E `cardMet === true`), por segurança, já que o app é público/multiusuário e cada um liga se quiser. A decisão fica isolada em `shouldAutoApprove(pr, result)`; a composição dos pontos em `attentionPoints`/`approveBodyWithPoints`. **Cada conta pode sobrescrever esses padrões globais** (painel Contas): `autoReview` (revisa sozinho / só põe na fila / herda), `onClean` (PR aprovável sem ressalva: `approve`/`wait`) e `onCaveats` (aprovável com ressalva: `approve`/`wait`). O engine resolve por conta em `autoReviewFor(user)` (gate da revisão automática, por `pr.account`) e `approvePolicyFor(user, clean)` (usado por `shouldAutoApprove`; `clean` = sem pontos de atenção e `decision === 'auto_approve'`). Campo ausente na conta = herda o global. `acctPolicy(user)` acha a conta. **Reprovar sozinho** é OPT-IN por conta (`onReject: 'request_changes'`, default `wait`, sem global): quando a revisão pede mudanças (`verdict === 'request_changes'` + payload REQUEST_CHANGES) num review PEDIDO a mim (clique nunca posta) e a conta optou, o app posta o REQUEST_CHANGES com os bloqueios (corpo marcado como automático), dedup por `myReviewStates` (não re-pede se eu já pedi). Gate isolado em `shouldAutoReject(pr, result)`/`rejectPolicyFor(user)`; nunca reprova sozinho por default. **A auto-revisão (headless) vale pra TODA a fila elegível da conta com `autoReview` ligado, não só os PRs que acabaram de chegar** (`check()` filtra `this.queue`, não só `fresh`): ligar "revisa na hora" passa a valer pro que já estava esperando. PRs que falharam sem ser rede, ou que você cancelou, ficam em `autoReviewParked` (aguardam ação manual, não relançam sozinhos); lançar de novo (manual) tira do estacionamento. **A revisão headless roda 1 POR CONTA em paralelo** (contas diferentes revisam juntas; dentro da mesma conta segue serial): `processHeadless` é um escalonador que puxa da `headlessQueue` uma revisão por conta livre, marcando `headlessBusyAccounts` (Set de contas ocupadas); `runOneHeadless(pr, acct)` roda cada uma e libera a conta + reprograma no fim. `headlessAcct(pr)` = conta dona (por `accountForPr`). **Perfil de review por pessoa** (`config.people` = {login: {papel?, dominios?{backend|frontend|dados|infra: nivel}}}, marcado à mão: papel no card do PR e na aba Time, matriz por domínio só na aba Time) molda o TOM e a POSTURA da revisão automática, NUNCA a decisão. `personProfileBlock(login)` injeta no prompt headless (`headlessPromptFor(url, author)`): PAPEL (estagio/junior/pleno/senior/techlead/arquiteto/especialista) dá o tom-base, a MATRIZ (basico/intermediario/avancado/autoridade por domínio) calibra a postura conforme a área que o PR mexe (autoridade→defere; básico→explica mais). A instrução trava: só TOM/POSTURA, nunca verdict/decision/cardMet/gate. Sem perfil = bloco vazio (neutro). Só no caminho headless, não no terminal. Migração: o `config.seniority` plano antigo vira `papel` (`migrateSeniorityToPeople` no load). `parsePeople` valida/normaliza. **Memória de pushback (automática):** quando o autor contesta um review meu, o Farol detecta e classifica sozinho. `scanPushbacks()` roda no `check()` (fire-and-forget, guarda `pushbackScanning`, best-effort): gatilho barato via gh (`detectAuthorPushback` = atividade do autor DEPOIS do meu último review; marcador em `state/pushback-scanned.json` evita reprocessar; `updatedAt` do PR é o gate) e, só nos candidatos novos, `classifyPushback` (1 sessão Claude LEITURA pura, nunca posta, `MAX_PER_CYCLE=2`) devolve `{isPushback, outcome, confidence, note}`. Confiança ALTA vira registro `confirmed` sozinho; BAIXA vira `pending` (aparece como "confirmar?" no controle de Revisões recentes, com o desfecho sugerido, você resolve num toque). Registros em `state/pushbacks.json` carregam `source`('auto'|'manual')/`status`('confirmed'|'pending')/`confidence`. `recordPushback` (marcação/correção à mão) é sempre `manual`+`confirmed` (override). `pushbacksFor` (injeção no `personProfileBlock`) usa SÓ confirmados, pra não calibrar em cima de palpite. Mesma trava: só tom/postura, nunca a decisão. Migração: registros antigos sem `source` viram manual+confirmed. **A autoanálise em si (Meus PRs) NUNCA posta nem escreve em `state/`** (é diagnóstico do autor sobre o próprio PR): o caminho `runSelfAnalysis` não passa pelo gate de postagem, o prompt `self-review.md` proíbe qualquer `gh`/`git` de escrita, e o resultado fica só em `self-analyses.json`. **As escritas no GitHub partindo de Meus PRs são só duas, ambas por clique explícito: o botão "Reviewers" e o botão Merge.** O botão **"👥 Reviewers"** (`setReviewers`) atribui o autor e pede review da lista efetiva do repo, resolvida por `reviewersForRepo(repo)`: a EXCEÇÃO do repo (`config.projectReviewers[repo]`) se houver, senão o PADRÃO da org (`config.defaultReviewers[org]`). Assim funciona em qualquer repo da org que tenha padrão, mesmo sem config própria. Aceita pessoas e times `org/slug`, sem confirmação (aplica na hora); não posta review nem mergeia, só ajusta assignee/reviewers, e filtra o próprio autor da lista. O botão **Merge** (`mergeSelfPR`), acionado por clique explícito com confirmação, e gateado: só o autor mergeia o próprio PR (`author === ghUser`), só quando a autoanálise marcou `approvable === true`, só em repo fora de `config.mergeBlockedRepos` (default `biudtech/biud-frontend`), e nunca em rascunho/PR com conflito. Faz merge commit (`gh pr merge --merge`, sem squash/rebase), atribui o autor se preciso, e deleta a branch de origem **só se for descartável** (`isPermanentBranch` protege develop/release*/main/master/hml*/staging/etc., que jamais são deletadas). Quando o merge normal esbarra na proteção de branch (`blocked: 'policy'`), a UI oferece duas saídas: **auto-merge** (`--auto`, mergeia quando os requisitos passarem, sem burlar nada) e **merge como admin** (`--admin`, bypassa a proteção agora, só se você for admin, com confirmação reforçada). Os dois modos passam pelos mesmos gates (autor/aprovável/lista bloqueada), então nem admin mergeia repo bloqueado como `biud-frontend`. **O botão só fica disponível quando dá pra mergear de verdade**: o engine lê a mergeabilidade real de cada PR aprovável (`refreshMergeStates` no fim do `check()` e após cada autoanálise aprovável, guardada em `mergeStates`) via `gh pr view --json mergeable,mergeStateStatus`. CLEAN/UNSTABLE = botão Merge ativo; BLOCKED = mostra auto/admin direto (sem tentativa que falha); DIRTY/BEHIND/DRAFT = botão desabilitado com o motivo. O Auto-merge só é oferecido quando o repo tem `allow_auto_merge` ligado (`fetchAutoMergeAllowed`); senão o botão fica desabilitado e sobra o Merge (admin). Se ainda assim o `gh` recusar o `--auto` (`enablePullRequestAutoMerge`), o merge devolve `blocked:'autoUnavailable'` com mensagem acionável, e a condição é logada como WARN (não ERROR), já que não é bug do Farol.
5. **Toda diferença de SO passa por `IS_WIN`/`IS_MAC`** (topo do `server.js`), nunca por checagens soltas espalhadas.
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

## macOS: estado real e o que falta validar

**O suporte a macOS foi escrito no Windows e NUNCA rodou num Mac de verdade.** O código segue as APIs documentadas, mas você, Claude rodando num Mac, é o primeiro teste real. Assuma que pode haver quebras e valide na ordem abaixo antes de dar qualquer coisa por funcionando:

1. **Instalar**: `bash Instalar.command` (o zip gerado no Windows não preserva bit de execução, então a primeira vez é com `bash`, não duplo clique). Confira que `~/.farol/app` e `~/Applications/Farol.app` existem.
2. **Abrir**: `open ~/Applications/Farol.app`. Se não abrir, rode à mão pra ver o erro: `~/.farol/app/node_modules/.bin/electron ~/.farol/app`.
3. **Doctor** (aba Sistema): gh, conta e claude precisam ficar verdes. Se `gh`/`claude` não aparecem, o problema é PATH (veja o bloco de PATH no topo do `server.js`; adicione o diretório que faltar).
4. **Polling**: o Radar deve listar PRs reais em ~30s. Erros aparecem em `~/.farol/workspace/state/farol.log`.
5. **Revisão headless sem risco**: desligue "Revisar automaticamente" em Sistema, clique Revisar num PR do panorama (nunca auto-posta) e confira o feed ao vivo + o card em "Precisa de você". Cancele no meio pra validar o `killTree` posix.
6. **Sessão no terminal**: ícone de terminal num card da fila. Deve abrir o Terminal.app, rodar o claude e, ao sair, o pill "sessão no terminal" deve sumir (é o `curl` do trap EXIT chamando `/api/session-exit`). Se o pill ficar preso, o trap não rodou.
7. **Update**: com uma fonte mais nova em `~/Documents/farol`, o botão Atualizar agora deve fechar, atualizar e reabrir o app. Log em `~/.farol/workspace/state/update.log`.
8. **Ícone**: gere o `.icns` (`bash tools/make-icns.sh`) e reinstale. Sem ele o app usa o ícone genérico do Electron (funciona, só é feio).

Pendências conhecidas do port (decisões conscientes, não bugs):

- **Autostart não existe no macOS** (login item com Electron + args não é confiável). Se for implementar, o caminho é um LaunchAgent em `~/Library/LaunchAgents`.
- **O nome no menu do macOS aparece como "Electron"** enquanto rodarmos o binário cru do Electron. Resolver exige empacotamento de verdade (electron-builder), o que quebraria o invariante 1; só vale se o time Mac crescer.
- **`.command` aberto por duplo clique pode pedir permissão** na primeira vez (Gatekeeper em arquivos baixados). `bash Instalar.command` contorna.
- **Notificações**: `displayBalloon` é Windows; no macOS o `Notification` do Electron cobre, mas a primeira notificação pede permissão do sistema.

Quando validar (ou corrigir) qualquer item acima, **atualize esta seção**: risque o que passou, documente o que mudou e por quê. Este arquivo é a memória do port.

## Como rodar e testar sem estragar nada

- **Instância isolada**: `FAROL_HOME=/tmp/farol-teste node server.js` sobe engine + UI em `http://127.0.0.1:47170` sem tocar nos dados reais. Pra trocar a porta, escreva `{"port": 47180, "autoReview": false}` no `config.json` do FAROL_HOME antes de subir.
- **Nunca teste com `autoReview` ligado** numa conta real: PR novo na sua fila dispararia revisão headless de verdade (e potencial APPROVE real).
- **Stubs**: `FAROL_REVIEW_CMD` substitui o `claude` da sessão terminal; `FAROL_HEADLESS_CMD` substitui o headless (imprima um envelope `{"result": "..."}` no stdout).
- **Sintaxe**: `node --check server.js main.js ui/app.js` antes de qualquer entrega.
- As buscas `gh search prs` são read-only; rodar `check` contra o GitHub real é seguro.

## Release

1. Bump de `version` no `package.json` (semver).
2. `powershell -ExecutionPolicy Bypass -File tools\make-package.ps1` gera `dist/farol-vX.Y.Z.zip` auditado (leve, sem node_modules; serve pros dois SOs pra quem já tem Node).
3. Quem tem instalação local atualiza pelo botão em Sistema (a fonte em `~/Documents/farol` com versão maior acende o botão) ou rodando o instalador da versão nova.

**Publicar update pras cópias distribuídas (auto-update):**
- `powershell -ExecutionPolicy Bypass -File tools\publish-release.ps1` builda o pacote leve + o instalador único Windows (`Farol-Setup-vX.Y.Z.exe`) e cria/atualiza a release `vX.Y.Z` em `wandersonaadsantos/farol`. As cópias instaladas (>= 1.15.0) leem a última release via `gh` (`updateRepo` no config, default `wandersonaadsantos/farol`) e se atualizam sozinhas no próximo ciclo, baixando só o pacote leve (o Electron já está instalado).
- Fonte de verdade: a RELEASE do GitHub (git). Por padrão o app instalado atualiza só a partir das releases, nunca de código local não-mergeado (uma fonte só). A pasta-fonte local é opt-in: só vale se `config.updateSource` apontar um caminho explícito (teste de build local de dev).
- macOS: `bash tools/make-offline-mac.sh` (roda em qualquer SO, Apple Silicon; `ARCH=x64` pra Intel) e anexe com `gh release upload vX.Y.Z dist/Farol-Instalar-mac.command --repo wandersonaadsantos/farol`. BETA: o runtime no macOS nunca foi validado num Mac real; valide via "Exportar diagnóstico".
- Bootstrap: cópias antigas (< 1.15.0) não têm o auto-update; instale a 1.15.0 uma vez (offline). Daí pra frente, automático.

**Distribuição offline (sem pré-requisitos):**
- Windows: `powershell -ExecutionPolicy Bypass -File tools\make-installer.ps1` gera `dist/Farol-Setup-vX.Y.Z.exe` (NSIS, Electron embutido). A pessoa dá **um** duplo clique: instala e abre, sem extrair zip nem escolher arquivo. Sem Node/npm/download/terminal.
- macOS: `bash tools/make-offline-mac.sh` (em QUALQUER SO) gera `dist/Farol-Instalar-mac.command` (autoextraível único, Electron darwin embutido como zip). Duplo clique instala; na 1ª vez, botão direito > Abrir (quarentena, sem assinatura). O `.app` é montado no Mac na instalação (o unzip do Mac preserva os symlinks), então o Gatekeeper não bloqueia por assinatura. Default arm64; `ARCH=x64` pra Intel.
- Nenhum dos dois é assinado/notarizado (exige conta paga): SmartScreen/Gatekeeper ainda avisam uma vez.
