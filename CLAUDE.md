# Farol, guia do mantenedor

Leia isto antes de mexer em qualquer arquivo. Este documento existe pra que qualquer Claude Code (em qualquer máquina, Windows ou macOS) consiga manter o Farol sem quebrar os contratos do app.

## O que é

Radar de Pull Requests em Electron. O engine (`server.js`, Node puro) monitora o GitHub com comandos `gh` (zero tokens de IA), serve a UI local por HTTP + SSE e orquestra sessões do Claude Code (headless pra revisão autônoma, terminal pra sessão interativa). O `main.js` é só o shell Electron (janela, bandeja, notificações).

## Mapa de arquivos

| Caminho | Papel |
|---|---|
| `server.js` | Engine inteiro: polling, fila, revisão headless, chat por PR, ferramentas (kudos/diagnóstico), update, HTTP + SSE |
| `main.js` | Shell Electron (janela, bandeja, notificações, autostart) |
| `lib/engine/fanout.js` | Fan-out de revisão em PR grande: mede o PR (`prMetrics`), decide se fatia (`shouldFanOut`), monta os lotes por afinidade de caminho (`planLotes`, função PURA) e injeta o instrutivo (`fanOutBlock`). Determinístico, ZERO IA e zero rede na parte que decide |
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
4. **Nada é postado no GitHub sem gate.** Auto-approve exige `requested === true` (revisão pedida a mim; revisão iniciada por clique no panorama nunca auto-posta), veredito `approve` e payload `APPROVE`. Com `autoApproveAll: true` (OPT-IN, ligado em Sistema) TODO PR aprovável é aprovado sozinho, sem depender do humano. **O corpo do APPROVE vai LIMPO no PR (tem que parecer humano, ver "review humano" abaixo); os pontos de atenção (`result.reasons` + aviso se `cardMet === false`) ficam SÓ no app (campo `attention`, visível em Revisões recentes), NÃO colados no PR nem com carimbo de "automático".** O DEFAULT é `false` (gate estrito de sempre: só auto-aprova quando a sessão decidiu `decision === 'auto_approve'` E `cardMet === true`), por segurança, já que o app é público/multiusuário e cada um liga se quiser. A decisão fica isolada em `shouldAutoApprove(pr, result)`; a composição dos pontos em `attentionPoints`. **Cada conta pode sobrescrever esses padrões globais** (painel Contas): `autoReview` (revisa sozinho / só põe na fila / herda), `onClean` (PR aprovável sem ressalva: `approve`/`wait`) e `onCaveats` (aprovável com ressalva: `approve`/`wait`). O engine resolve por conta em `autoReviewFor(user)` (gate da revisão automática, por `pr.account`) e `approvePolicyFor(user, clean)` (usado por `shouldAutoApprove`; `clean` = sem pontos de atenção e `decision === 'auto_approve'`). Campo ausente na conta = herda o global. `acctPolicy(user)` acha a conta. **Reprovar sozinho** é OPT-IN por conta (`onReject: 'request_changes'`, default `wait`, sem global): quando a revisão pede mudanças (`verdict === 'request_changes'` + payload REQUEST_CHANGES) num review PEDIDO a mim (clique nunca posta) e a conta optou, o app posta o REQUEST_CHANGES com os bloqueios (corpo LIMPO, sem carimbo de automático), dedup por `myReviewStates` (não re-pede se eu já pedi). Gate isolado em `shouldAutoReject(pr, result)`/`rejectPolicyFor(user)`; nunca reprova sozinho por default. **A auto-revisão (headless) vale pra TODA a fila elegível da conta com `autoReview` ligado, não só os PRs que acabaram de chegar** (`check()` filtra `this.queue`, não só `fresh`): ligar "revisa na hora" passa a valer pro que já estava esperando. PRs que falharam sem ser rede, ou que você cancelou, ficam em `autoReviewParked` (aguardam ação manual, não relançam sozinhos); lançar de novo (manual) tira do estacionamento. **A revisão headless roda 1 POR CONTA em paralelo** (contas diferentes revisam juntas; dentro da mesma conta segue serial): `processHeadless` é um escalonador que puxa da `headlessQueue` uma revisão por conta livre, marcando `headlessBusyAccounts` (Set de contas ocupadas); `runOneHeadless(pr, acct)` roda cada uma e libera a conta + reprograma no fim. `headlessAcct(pr)` = conta dona (por `accountForPr`). **Perfil de review por pessoa** (`config.people` = {login: {papel?, dominios?{backend|frontend|dados|infra: nivel}}}, marcado à mão: papel no card do PR e na aba Time, matriz por domínio só na aba Time) molda o TOM e a POSTURA da revisão automática, NUNCA a decisão. `personProfileBlock(login)` injeta no prompt headless (`headlessPromptFor(url, author)`): PAPEL (estagio/junior/pleno/senior/techlead/arquiteto/especialista) dá o tom-base, a MATRIZ (basico/intermediario/avancado/autoridade por domínio) calibra a postura conforme a área que o PR mexe (autoridade→defere; básico→explica mais). A instrução trava: só TOM/POSTURA, nunca verdict/decision/cardMet/gate. Sem perfil = bloco vazio (neutro). Só no caminho headless, não no terminal. Migração: o `config.seniority` plano antigo vira `papel` (`migrateSeniorityToPeople` no load). `parsePeople` valida/normaliza. **Review humano/personalizado:** `reviewFormatBlock()` (injetado SEMPRE junto do perfil, PREVALECE sobre o formato do CLAUDE.md do workspace) manda escrever o corpo postado como uma PESSOA (o Wanderson), personalizado/objetivo/profissional: SEM caixas de alerta `> [!NOTE]`, SEM "Placar", SEM checklist `- [x]`, SEM prefixos de Conventional Comments no texto, SEM citar automação/Farol/"auto-aprovei" (o autor não pode saber que é bot), sem travessão, e o FORMATO adapta à senioridade (estágio/júnior = prosa de mentor; pleno/sênior/arquiteto = enxuto e direto). O protocolo de review (`CLAUDE.md`, `prompts/pr-review-auto.md`, `prompts/self-review.md`, `.claude/agents/pr-reviewer.md`) é RE-SINCRONIZADO da fonte a cada boot (`prepareHome`), pra mudanças de formato chegarem nas cópias já semeadas (nunca toca em `state/`). **Memória de pushback (automática):** quando o autor contesta um review meu, o Farol detecta e classifica sozinho. `scanPushbacks()` roda no `check()` (fire-and-forget, guarda `pushbackScanning`, best-effort): só entra no scan o PR cujo review MEU foi **bloqueio** (`request_changes`) ou **aprovação COM ressalva** (aprovação limpa não gera pushback; `reviewActions()` expõe `caveats` = mesmos pontos do `attentionPoints`, card não comprovado ou motivo listado, pra distinguir). Nesses, gatilho barato via gh (`detectAuthorPushback` = atividade do autor DEPOIS do meu último review; marcador em `state/pushback-scanned.json` evita reprocessar; `updatedAt` do PR é o gate) e, só nos candidatos novos, `classifyPushback` (1 sessão Claude LEITURA pura, nunca posta, `MAX_PER_CYCLE=2`) devolve `{isPushback, outcome, confidence, note}`. Confiança ALTA vira registro `confirmed` sozinho; BAIXA vira `pending` (aparece como "confirmar?" no controle de Revisões recentes, com o desfecho sugerido, você resolve num toque). Registros em `state/pushbacks.json` carregam `source`('auto'|'manual')/`status`('confirmed'|'pending')/`confidence`. `recordPushback` (marcação/correção à mão) é sempre `manual`+`confirmed` (override). `pushbacksFor` (injeção no `personProfileBlock`) usa SÓ confirmados, pra não calibrar em cima de palpite. Mesma trava: só tom/postura, nunca a decisão. Migração: registros antigos sem `source` viram manual+confirmed. **A autoanálise em si (Meus PRs) NUNCA posta nem escreve em `state/`** (é diagnóstico do autor sobre o próprio PR): o caminho `runSelfAnalysis` não passa pelo gate de postagem, o prompt `self-review.md` proíbe qualquer `gh`/`git` de escrita, e o resultado fica só em `self-analyses.json`. **As escritas no GitHub partindo de Meus PRs são só duas, ambas por clique explícito: o botão "Reviewers" e o botão Merge.** O botão **"👥 Reviewers"** (`setReviewers`) atribui o autor e pede review da lista efetiva do repo, resolvida por `reviewersForRepo(repo)`: a EXCEÇÃO do repo (`config.projectReviewers[repo]`) se houver, senão o PADRÃO da org (`config.defaultReviewers[org]`). Assim funciona em qualquer repo da org que tenha padrão, mesmo sem config própria. Aceita pessoas e times `org/slug`, sem confirmação (aplica na hora); não posta review nem mergeia, só ajusta assignee/reviewers, e filtra o próprio autor da lista. O botão **Merge** (`mergeSelfPR`), acionado por clique explícito com confirmação, e gateado: só o autor mergeia o próprio PR (`author === ghUser`), só quando a autoanálise marcou `approvable === true`, só em repo fora de `config.mergeBlockedRepos` (default `biudtech/biud-frontend`), e nunca em rascunho/PR com conflito. Faz merge commit (`gh pr merge --merge`, sem squash/rebase), atribui o autor se preciso, e deleta a branch de origem **só se for descartável** (`isPermanentBranch` protege develop/release*/main/master/hml*/staging/etc., que jamais são deletadas). Quando o merge normal esbarra na proteção de branch (`blocked: 'policy'`), a UI oferece duas saídas: **auto-merge** (`--auto`, mergeia quando os requisitos passarem, sem burlar nada) e **merge como admin** (`--admin`, bypassa a proteção agora, só se você for admin, com confirmação reforçada). Os dois modos passam pelos mesmos gates (autor/aprovável/lista bloqueada), então nem admin mergeia repo bloqueado como `biud-frontend`. **O botão só fica disponível quando dá pra mergear de verdade**: o engine lê a mergeabilidade real de cada PR aprovável (`refreshMergeStates` no fim do `check()` e após cada autoanálise aprovável, guardada em `mergeStates`) via `gh pr view --json mergeable,mergeStateStatus`. CLEAN/UNSTABLE = botão Merge ativo; BLOCKED = mostra auto/admin direto (sem tentativa que falha); DIRTY/BEHIND/DRAFT = botão desabilitado com o motivo. O Auto-merge só é oferecido quando o repo tem `allow_auto_merge` ligado (`fetchAutoMergeAllowed`); senão o botão fica desabilitado e sobra o Merge (admin). Se ainda assim o `gh` recusar o `--auto` (`enablePullRequestAutoMerge`), o merge devolve `blocked:'autoUnavailable'` com mensagem acionável, e a condição é logada como WARN (não ERROR), já que não é bug do Farol.
   **Ressalva vai pro PR (mudança de 29/07/2026, decisão do Wanderson).** O trecho acima diz que os pontos de atenção ficam SÓ no app. Isso valia até a v2.26.0. Agora: aprovável COM ressalva **aprova** (ressalva nunca bloqueia) e a ressalva **aparece no corpo do PR**, escrita como um revisor sênior mencionaria de passagem, sem checklist e sem seção rotulada. **Filtro obrigatório** (em `reviewFormatBlock`): ressalva TÉCNICA sobre o código entra no corpo; ressalva OPERACIONAL do nosso fluxo NÃO entra e fica só em `reasons`/`attention` (card não confirmado por falha de acesso ao Jira, review que não era pedido a mim, discordância com outro review, política de conta, cobertura incompleta), porque é assunto interno e citar vazaria a automação.

   **Cobertura da leitura é gate (v2.26.0).** Motivo medido em 29/07/2026 sobre 44 reviews reais: o tamanho do PR varia 4359x no histórico e o esforço visível do review varia 3x; a correlação entre linhas do diff e âncoras `arquivo:linha` é **r = -0,08**, ou seja, nenhuma. Nos PRs acima de 2000 linhas, 3 de 5 saíram sem uma única âncora, e o #688 (74 arquivos, 8717 linhas) auto-aprovou com relatório de tamanho médio, zero âncora e zero achado. Conclusão: "nenhum achado" era indistinguível de "li 20% e não vi nada". Agora o envelope carrega `coverage: {total, reviewed[], missing[]}` e `coverageGap(result)` segura a postagem automática (approve E reject) quando falta arquivo, mandando pra decisão humana com a lista. **Dois eixos separados, não confunda:** ressalva é o que a revisão ENCONTROU (não bloqueia), cobertura é o que ela conseguiu LER (bloqueia a postagem sozinha, porque sem leitura completa não há prova). A rede de segurança também pega `reviewed.length < total` mesmo com `missing` vazio. Envelope sem `coverage` (passe único) devolve `[]` e nada muda.

   **Fan-out em PR grande (v2.26.0).** Acima de **1000 linhas OU 20 arquivos** (limiar medido: pega 28% dos PRs do histórico, 7 de 25), o engine mede o PR com uma chamada `gh pr view --json additions,deletions,changedFiles,files`, monta 2 a 4 **lotes** por afinidade de caminho (`planLotes`) e injeta o instrutivo. A sessão principal então dispara **um subagente `pr-reviewer` por lote, em paralelo** (ela já disparava um; agora dispara N), cada um lendo por completo só os arquivos do seu lote e **ciente dos caminhos dos outros lotes** (pra sinalizar dependência cross-lote sem afirmar defeito em arquivo que não leu). A consolidação é na própria sessão: dedup por `arquivo:linha`, resolução das suspeitas cross-lote e **o gate dos 8 blockers aplicado UMA vez** sobre o conjunto (a decisão continua num lugar só). Falha na medição degrada pro passe único de sempre, que é sempre seguro. **`planLotes` DESCE por profundidade de caminho, nunca sobe pro pai:** a 1ª versão fundia o menor grupo no diretório pai e a validação com o #688 real reprovou (cascateava até a raiz e um lote ficava com 53 dos 74 arquivos, recriando o problema). Fundir os dois menores entre si mantém o equilíbrio. **Aritmética conhecida:** com teto de 4 lotes, um PR de 8717 linhas ainda dá ~2200 linhas por lote; subir o teto custa quase nada em tokens (o total de linhas lidas é o mesmo, muda só o overhead por subagente), então se a cauda de PRs gigantes incomodar, o caminho é `MAX_LOTES`.

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

1. ~~**Instalar**~~ **VALIDADO (28/07/2026, Mac real, Apple Silicon, via `Farol-Instalar-mac.command` v2.23.4)**: `~/.farol/app`, `~/.farol/workspace` e `~/Applications/Farol.app` criados certinhos, symlinks do Electron preservados, sem atributo de quarentena no `.app` (só `com.apple.provenance`, que não bloqueia). PEGADINHA: o app vai pra `~/Applications` (por usuário, sem pedir admin), que NÃO é a `/Applications` da barra lateral do Finder, então o usuário "não acha o app". Um symlink resolve (`ln -s ~/Applications/Farol.app /Applications/Farol.app`, funciona sem sudo pra quem é admin); avaliar fazer o `install.sh` criar esse symlink quando tiver permissão. Pra instalar do zip leve: `bash Instalar.command` (o zip gerado no Windows não preserva bit de execução, então a primeira vez é com `bash`, não duplo clique).
2. ~~**Abrir**~~ **VALIDADO E CORRIGIDO (28/07/2026)**, com DOIS bugs reais achados num Mac de verdade:
   - **Launcher morria em silêncio via Finder/Spotlight**: o wrapper dava `exec` no `node_modules/.bin/electron`, que é script node (`#!/usr/bin/env node`); Finder/Spotlight lançam com PATH mínimo (sem node) e o wrapper morria com `env: node: No such file or directory`, sem janela e sem log. PEGADINHA DE VALIDAÇÃO: `open` rodado de um shell PROPAGA o env do chamador (PATH com node), então "funciona no terminal" NÃO valida o clique do usuário; valide com `env -i HOME="$HOME" PATH=/usr/bin:/bin:/usr/sbin:/sbin ~/Applications/Farol.app/Contents/MacOS/Farol`. Corrigido no `install.sh`: o launcher agora dá `exec` direto no binário NATIVO (`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`), zero dependência de node no PATH.
   - **Janela subia atrás de tudo e sem foco**: o app que o Finder ativa (wrapper) morre no `exec`, e o Electron subia sem ativação. Corrigido no `main.js` com `app.focus({ steal: true })` no `createWindow` e no `showWindow` (só `IS_MAC`).
   - Confusão restante de identidade: no Dock/Cmd-Tab o NOME é "Electron" (pendência documentada abaixo); o ícone foi resolvido no item 8. Se não abrir mesmo, rode o launcher à mão pra ver o erro: `~/Applications/Farol.app/Contents/MacOS/Farol`.
3. **Doctor** (aba Sistema): gh, conta e claude precisam ficar verdes. Se `gh`/`claude` não aparecem, o problema é PATH (veja o bloco de PATH no topo do `server.js`; adicione o diretório que faltar).
4. **Polling**: o Radar deve listar PRs reais em ~30s. Erros aparecem em `~/.farol/workspace/state/farol.log`.
5. **Revisão headless sem risco**: desligue "Revisar automaticamente" em Sistema, clique Revisar num PR do panorama (nunca auto-posta) e confira o feed ao vivo + o card em "Precisa de você". Cancele no meio pra validar o `killTree` posix.
6. **Sessão no terminal**: ícone de terminal num card da fila. Deve abrir o Terminal.app, rodar o claude e, ao sair, o pill "sessão no terminal" deve sumir (é o `curl` do trap EXIT chamando `/api/session-exit`). Se o pill ficar preso, o trap não rodou.
7. **Update**: com uma fonte mais nova em `~/Documents/farol`, o botão Atualizar agora deve fechar, atualizar e reabrir o app. Log em `~/.farol/workspace/state/update.log`. **BUG REAL ACHADO NUM MAC (30/07/2026, Thiago, v2.26.0) E CORRIGIDO NA v2.26.1**: o auto-update NUNCA funcionou no macOS. O `Compress-Archive` do Windows PowerShell grava as entradas do zip com `\` separando as pastas, e o formato zip exige `/` (APPNOTE 4.4.17.1); o `unzip` do Mac avisava `appears to use backslashes as path separators` e saía com código 1, que o `update.js` tratava como falha fatal ("falha ao extrair (unzip)"). Todos os `farol-v*.zip` publicados até a v2.26.0 têm o defeito (verificado nos históricos). Duas correções: (a) `make-package.ps1` monta as entradas na mão via `ZipFileExtensions::CreateEntryFromFile` com o nome normalizado, e a auditoria REPROVA o pacote se aparecer `\` ou raiz absoluta (PEGADINHA do fix: `$env:TEMP` volta em caminho curto `WANDER~1`, então a raiz e o enumerador têm que sair do MESMO caminho resolvido, senão a subtração de prefixo erra por um caractere e todas as entradas de raiz saem como `/arquivo`); (b) `update.js` passa a aceitar saída 1 do Info-ZIP (aviso, não erro), deixando a checagem do `installer/install.sh` ser o gate de verdade. FALTA validar num Mac real: atualizar de uma versão instalada para a v2.26.1 pelo botão.
8. ~~**Ícone**~~ **VALIDADO E COMPLETADO (28/07/2026)**: `bash tools/make-icns.sh` gerou o `.icns` num Mac real (transparência dos 4 cantos validada programaticamente, inclusive no 1024px extraído do `.icns`) e `bash installer/install.sh` levou ele pro lançador. DOIS avisos: (a) o `.icns` no wrapper só cobre Finder/Spotlight/Launchpad; o ícone do DOCK em runtime é o do processo (Electron cru), então o `main.js` passou a chamar `app.dock.setIcon` com `assets/png/farol-256.png` no boot (só `IS_MAC`); (b) reinstalar da FONTE exige o dist do Electron darwin em `node_modules/electron/dist` do repo (o `install.sh` copia o `node_modules` inteiro; sem o dist ele cai no `npm install` de rede ou quebra). Se a instalação atual funciona, semeie antes: `cp -R ~/.farol/app/node_modules/electron/dist <repo>/node_modules/electron/dist` (e o `path.txt` junto). Depois de trocar ícone, refresque o cache: `lsregister -f` no bundle + `killall Dock`.

Pendências conhecidas do port (decisões conscientes, não bugs):

- **Autostart não existe no macOS** (login item com Electron + args não é confiável). Se for implementar, o caminho é um LaunchAgent em `~/Library/LaunchAgents`.
- **O nome no menu do macOS aparece como "Electron"** enquanto rodarmos o binário cru do Electron. Resolver exige empacotamento de verdade (electron-builder), o que quebraria o invariante 1; só vale se o time Mac crescer.
- **`.command` aberto por duplo clique pode pedir permissão** na primeira vez (Gatekeeper em arquivos baixados). `bash Instalar.command` contorna.
- **Notificações**: `displayBalloon` é Windows; no macOS o `Notification` do Electron cobre, mas a primeira notificação pede permissão do sistema.

Quando validar (ou corrigir) qualquer item acima, **atualize esta seção**: risque o que passou, documente o que mudou e por quê. Este arquivo é a memória do port.

## Assinatura do Claude (qual conta/plano o Farol usa, e como alternar)

O Farol roda `claude -p ...` (headless, **sem `--bare`**) e o `claude` interativo no terminal. **Qual assinatura/plano é usado é decisão da autenticação do próprio `claude`, não do config do Farol.** Precedência oficial (docs code.claude.com): cloud provider → `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` → `apiKeyHelper` → `CLAUDE_CODE_OAUTH_TOKEN` → **assinatura OAuth logada via `claude login`** (default). Sem nenhuma env var de auth, usa o OAuth logado, guardado em `.credentials.json` dentro do config dir (`~/.claude.json`/`~/.claude/` por padrão, ou o que `CLAUDE_CONFIG_DIR` apontar).

Como o Farol espalha `process.env` pros filhos, por padrão ele herda o login da máquina. Formas de trocar, da mais simples à recomendada:

1. **Máquina toda:** `claude login` (troca a conta pra tudo, inclusive seu Claude Code interativo de codar). Simples, mas não isola o Farol.
2. **Um diretório de config isolado (o que já existia):** aponte `config.claudeConfigDir` pra um diretório próprio. O engine injeta `CLAUDE_CONFIG_DIR` nesse dir em TODAS as sessões do Farol, então elas usam a assinatura logada ali, sem mexer no `claude` principal da máquina.
3. **Perfis nomeados de assinatura, um por conta GitHub monitorada (recomendado, desde a v2.27.0):** em Sistema > **"Assinatura do Claude"**, o campo único virou um gerenciador de perfis. Cada perfil tem um nome (ex.: "BIUD Trabalho", "Pessoal Max") e um diretório de config próprio. Escolha um perfil como **padrão do Farol** e, se quiser, atribua um perfil diferente a uma conta GitHub específica (Sistema > Contas, override por conta). Sem override, a conta usa o padrão global; sem nenhum perfil criado, vale o `claudeConfigDir` legado como sempre valeu (compatibilidade total, spec completo em `docs/superpowers/specs/2026-07-31-perfis-claude-por-conta-design.md`).

**Passo a passo (perfil isolado):**
```
# 1) logar a conta desejada SÓ nesse dir (uma vez; o headless NÃO faz login sozinho)
#    Windows PowerShell:
$env:CLAUDE_CONFIG_DIR="C:\Users\voce\.claude-pessoal"; claude login
# 2) no Farol: Sistema > "Assinatura do Claude" > criar perfil apontando pra C:\Users\voce\.claude-pessoal
# 3) marcar esse perfil como padrão, ou atribuí-lo só a uma conta em Sistema > Contas
```
**Alternar assinaturas** vira trocar de perfil (ou, no modo legado, trocar o caminho): mantenha um dir por assinatura (`.claude-pessoal`, `.claude-trabalho`), um perfil pra cada. Cada conta e cada perfil mostram um selo com a conta em uso (email do `oauthAccount`) e avisam **"SEM LOGIN"** se o dir apontado não tiver `.credentials.json` (você esqueceu o `claude login` nele); o selo se atualiza sozinho ao salvar, sem precisar de "Reverificar" manual. **Pegadinha:** o login é interativo e tem que ser feito ANTES; sessão headless com dir sem credencial falha. Alternativa oficial pra headless sem depender de OAuth persistente: `ANTHROPIC_API_KEY` (ou `CLAUDE_CODE_OAUTH_TOKEN` via `claude setup-token`) no ambiente, mas aí o billing é por API, não pela assinatura. **Nunca** logar/gravar credencial pelo Claude Code em nome do usuário: o `claude login` é ação dele.

## Como rodar e testar sem estragar nada

- **Instância isolada**: `FAROL_HOME=/tmp/farol-teste node server.js` sobe engine + UI em `http://127.0.0.1:47170` sem tocar nos dados reais. Pra trocar a porta, escreva `{"port": 47180, "autoReview": false}` no `config.json` do FAROL_HOME antes de subir.
- **Nunca teste com `autoReview` ligado** numa conta real: PR novo na sua fila dispararia revisão headless de verdade (e potencial APPROVE real).
- **Stubs**: `FAROL_REVIEW_CMD` substitui o `claude` da sessão terminal; `FAROL_HEADLESS_CMD` substitui o headless (imprima um envelope `{"result": "..."}` no stdout).
- **Gate de qualidade** (rodar antes de QUALQUER entrega): `npm run check && npm test`. O `check` valida a sintaxe (`node --check` em `server.js`/`main.js`/`ui/app.js`); o `test` roda a rede (`node --test`, runner nativo, ZERO dependências): funções puras + smoke de boot com `FAROL_HOME` temporário. Verde nos dois é pré-requisito. A rede vive em `test/` e é o que protege a decomposição do engine em ondas (ver `docs/QUALITY.md`, o contrato de qualidade extraído do lace-be-fastify).
- As buscas `gh search prs` são read-only; rodar `check` contra o GitHub real é seguro.

## Release (checklist obrigatório)

Toda release segue estes passos na ordem. Não pule nenhum.

### 1. Preparar a versão

- [ ] Definir a versão nova em semver (`major.minor.patch`). A referência é a **última release publicada no GitHub**, não a versão no fonte (que pode ter sido bumped sem publicar).
- [ ] Bump de `version` no `package.json`.
- [ ] Atualizar `CHANGELOG.md`: criar seção `## vX.Y.Z` com novidades e correções. Se houver versões intermediárias não publicadas, consolidar tudo numa seção só.
- [ ] Atualizar `RELEASE_NOTES` no `ui/app.js`: adicionar entrada `['X.Y.Z', ['item 1', 'item 2']]` no topo do array. Se consolidou versões, uma entrada só. Verificar que a versão anterior publicada também tem entrada (corrigir se faltar).

### 2. Gate de qualidade

```
npm run check && npm test
```

Verde nos dois é pré-requisito. Não publique com teste vermelho.

### 3. Commit e push

- [ ] Commit com mensagem descritiva (ex.: `chore: release v2.27.0`).
- [ ] Push pra `main`.
- [ ] **Conta do gh**: o repo é `wandersonaadsantos/farol` (conta pessoal). Antes de publicar, verificar: `gh auth status`. Se a conta ativa for `wandersonbiuder`, trocar: `gh auth switch --user wandersonaadsantos`.

### 4. Publicar a release

```
powershell -ExecutionPolicy Bypass -File tools\publish-release.ps1
```

O script faz tudo: builda o pacote leve (`dist/farol-vX.Y.Z.zip`, auditado) + instalador Windows (`dist/Farol-Setup-vX.Y.Z.exe`, NSIS), extrai notas do `CHANGELOG.md`, anexa rodapé de `tools/release-footer.md` e cria a release `vX.Y.Z` no GitHub. Se a release já existe, atualiza notas e sobrescreve os artefatos.

### 5. Pós-publicação

- [ ] Verificar a release no GitHub (notas, artefatos).
- [ ] **Restaurar a conta do gh pra trabalho**: `gh auth switch --user wandersonbiuder`.
- [ ] macOS (quando aplicável): `bash tools/make-offline-mac.sh` e anexar com `gh release upload vX.Y.Z dist/Farol-Instalar-mac.command --repo wandersonaadsantos/farol`.

### Referência rápida

| Artefato | Comando | Destino |
|---|---|---|
| Pacote leve (update) | `tools\make-package.ps1` | `dist/farol-vX.Y.Z.zip` |
| Instalador Windows | `tools\make-installer.ps1` | `dist/Farol-Setup-vX.Y.Z.exe` |
| Release GitHub | `tools\publish-release.ps1` | ambos acima + release |
| Instalador macOS | `tools/make-offline-mac.sh` | `dist/Farol-Instalar-mac.command` |

**Auto-update**: cópias instaladas (>= 1.15.0) leem a última release via `gh` e se atualizam sozinhas no próximo ciclo. Bootstrap: cópias antigas precisam instalar 1.15.0 uma vez (offline).

**Fonte de verdade**: a release do GitHub. O app instalado atualiza só a partir das releases, nunca de código local não mergeado (a menos que `config.updateSource` aponte um caminho explícito).

**Distribuição offline**: o instalador Windows (`.exe`, NSIS) e o macOS (`.command`, autoextraível) não precisam de Node/npm/terminal. Nenhum dos dois é assinado/notarizado (SmartScreen/Gatekeeper avisam uma vez).
