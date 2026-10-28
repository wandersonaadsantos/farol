# Farol nativo: cascas SwiftUI e WinUI 3 sobre o motor Node (desenho)

Data: 27/10/2026. Base: Farol v2.78.7 (commit 226b685e). Estudo prévio em
`2026-10-27-farol-nativo-mac-win-web-estrategia.md`. Decisão do dono: motor
Node intacto, cascas nativas por SO com fidelidade máxima, Node como sidecar,
e a versão web pelo modo servidor que já existe.

## 1. Intenção e motivo

O time sente o Farol pesado por rodar num Chromium embutido (Electron): 398 MB
de RSS parado nesta máquina, dos quais 86 MB são o motor. O objetivo é um
Farol instalado de forma nativa no Mac e no Windows, com bandeja, badge,
notificação, autostart, instância única e update do próprio SO, consumindo
perto do motor mais a janela do SO, e a mesma `ui/` servida pelo motor como
versão web. O motor não muda de linguagem: a reescrita em Swift do Sentinela
mostrou que o ganho de memória está na casca, não no motor, e que reescrever o
motor custa o escopo e o invariante 4.

## 2. Metas, não metas e antimetas

**Metas**
- Mac e Windows com app nativo próprio: `Farol.app` em Swift/SwiftUI e
  `Farol` em C#/WinUI 3, cada um com o comportamento que o SO espera.
- Paridade funcional com o `main.js` de hoje: janela, bandeja com menu,
  badge, notificações com clique que abre o PR, autostart, instância única,
  reabertura silenciosa depois de update, janela "visor" quando a porta já
  está ocupada por outro Farol.
- Motor e `ui/` intactos: nenhuma regra de produto muda, os 6415 testes
  continuam valendo, o invariante 4 não é tocado.
- Memória do app parado abaixo de 150 MB no Mac (motor incluso), medida com
  as contas reais do time; no Windows, o menor que o WebView2 permitir, medido
  e registrado (seção 8, item 0).
- Web pelo modo servidor, com bind configurável e autenticação exigida fora do
  loopback.
- Assinatura e distribuição de verdade: Developer ID com notarização no Mac e
  certificado de código no Windows, update automático em ambos.

**Não metas**
- Reescrever telas em componentes nativos. A tela continua sendo a `ui/` num
  WebView. Tela a tela em nativo é decisão futura, fora deste desenho.
- Linux: continua pelo instalador experimental e pelo modo servidor, sem casca.
- Mudar o pipeline de revisão (espelho local, Leitor/Verificador/Redator do
  Sentinela): são melhorias do motor, com desenho próprio.

**Antimetas (o que faria o projeto falhar mesmo funcionando)**
- Qualquer caminho em que a casca poste no GitHub ou decida algo que hoje é do
  motor. A casca é um cliente do motor, igual ao navegador.
- Duas cascas com comportamento diferente para o mesmo evento do motor.
- Dependência npm nova no motor ou na `ui/`.
- Perder o modo servidor ou o Termux no caminho.

## 3. Restrições

- Invariante 1 passa a ser: "o motor roda em Node puro sem dependência npm de
  runtime; as cascas são código nativo do SO sem framework de terceiros entre
  elas e o SO". O Electron sai quando as duas cascas estiverem em produção.
- Invariantes 2, 3, 4, 6 e 7 não mudam. Invariante 5 (`IS_WIN`/`IS_MAC`) vale
  para o motor; cada casca é de um SO só.
- Texto de UI e comentários em português, sem travessão, nas três linguagens.
- O `gh` e o `claude` continuam vindo do PATH do usuário: a casca não os
  embute.
- Node: o binário oficial da linha 24 LTS viaja dentro do app (como o Electron
  já viaja), uma arquitetura por build. Não se exige Node instalado.

## 4. Arquitetura

```
Farol.app (Swift)  /  Farol.exe (C#)             <- casca: ~5 a 15 MB
 ├─ janela: WKWebView / WebView2 -> http://127.0.0.1:<porta>/   (ui/ servida pelo motor)
 ├─ bandeja, badge, notificação, autostart, instância única, updater do SO
 ├─ cliente SSE de /api/events (os mesmos eventos que a tela recebe)
 └─ sidecar: <bundle>/node <bundle>/engine/server.js  (FAROL_SHELL=mac|win)
       └─ HTTP + SSE em 127.0.0.1:<porta>; estado em ~/.farol como hoje
```

### 4.1 O contrato do sidecar (o que muda no motor, e é pouco)

1. **Modo de execução.** `lib/paths.js` ganha `modoCasca()` lendo
   `FAROL_SHELL` (`mac`, `win`; ausente = servidor ou Electron). `modoServidor()`
   continua sendo "sem Electron", mas `update.js` passa a tratar casca como
   caso próprio (ver 4.5). Nenhuma regra de produto lê o modo.
2. **Prontidão.** O motor já responde `GET /api/state`. A casca considera o
   motor pronto na primeira resposta 200 e abre a janela; antes disso mostra
   a própria tela de carregamento nativa (hoje o Electron mostra a janela
   branca).
3. **Porta e descoberta.** Quem escolhe a porta continua sendo o motor, e ele
   aceita `port: 0` (efêmera). Por isso a casca NÃO lê o `config.json`: ao
   subir com `FAROL_SHELL`, o motor grava `~/.farol/state/casca.json` (0600)
   com `{ porta, pid, versao, codigoPareamento, iniciadoEm }` assim que o
   socket abre, e a casca espera esse arquivo (teto 30 s) em vez de ler o
   stdout. O mesmo arquivo serve para reconhecer um motor já vivo (item 4)
   e para o pareamento (item 6). Decisão minha, a partir da revisão.
4. **Instância única e visor.** Se a porta responde ao `/api/state` com a
   assinatura do Farol antes de a casca subir o sidecar, a casca NÃO sobe o
   motor e vira visor daquele motor (é o `attachedToExisting` do `main.js`).
   A instância única da casca em si é do SO (bundle id no Mac, `AppInstance`
   no Windows).
5. **Eventos.** A casca lê o SSE `/api/events`, mas NUNCA o `state` nem o
   `state-patch` (o estado vai por diferença, `lib/estado-delta.js`, e
   mesclar o patch em Swift e em C# seria a duplicação que a antimeta
   proíbe). O motor passa a emitir três eventos feitos para a casca, todos
   montados por um módulo puro `lib/engine/avisos-nativos.js`, que recebe a
   lógica de `wireEngine()` do `main.js` (títulos, corpo, "aprovado com
   ressalvas", silêncio por horário):
   - `aviso-nativo { titulo, corpo, url, pr, silencioso }`: derivado de
     `new-prs`, `auto-approved`, `auto-rejected`, `auto-commented`,
     `tool-done`, `intervention` e `meu-pr-base`. A casca só exibe; o clique
     abre `url` no navegador ou, com `pr`, foca a janela e navega o WebView
     para `?pr=owner%2Frepo%23N` (a rota que `ui/pure/rota.js` já entende).
     Não existe rota de foco no motor: `focus-pr` e `focus-intervention`
     eram emissões em processo do Electron e não viram API.
   - `casca { badge, ocupado, autostart, cores }`: o contador do badge (o
     cálculo de `updateBadge` migra para o motor), se há revisão viva
     (gate do update da casca), o autostart e as cores da janela. Emitido
     na conexão e a cada mudança; substitui `settings-changed`, que hoje só
     existe em processo e não sai no SSE.
   - `casca-saida { motivo: 'update' | 'reinicio', proximaVersao }`:
     emitido antes de o motor sair de propósito (ver 4.5).
   As duas cascas só exibem o que chega. Isso é o que garante a antimeta
   "duas cascas diferentes".
6. **Autenticação (A4).** No desktop o token não é exigido por padrão hoje.
   Com casca, o motor exige token sempre que `FAROL_SHELL` está presente
   (modo `exigir` implícito). A casca obtém o token por `POST /api/auth/pair`
   com o `codigoPareamento` de `state/casca.json` (item 3), que o motor gera
   a cada subida como sidecar e invalida no primeiro uso. A sessão criada
   assim é da classe `casca` em `lib/local-auth/sessoes.js`: sem prazo
   absoluto de 90 dias, renovada a cada uso; e, se expirar ou for revogada,
   a casca pareia de novo sozinha na próxima subida, porque tem o código
   novo no arquivo. A casca guarda o token no Keychain (Mac) ou no Credential
   Manager (Windows) e o injeta no WebView antes de a página rodar
   (`localStorage['farol-auth-token']`, o que `ui/transporte.js` já lê).
   Como visor de um motor remoto (4.6) não há arquivo: a casca não injeta
   nada e o pareamento é pelo painel da própria tela, como no navegador.
7. **Ciclo de vida.** A casca é dona do processo: sobe no início, religa com
   recuo (1 s, 2 s, 4 s, teto 30 s) se morrer, e derruba no fim (SIGTERM e,
   depois de 5 s, SIGKILL; no Windows, `taskkill /T`). Saída de propósito
   (update ou reinício pedido pela tela) é diferente de morte: o motor emite
   `casca-saida`, grava `state/casca.json` com `proximaVersao` e sai com
   código 75; a casca religa na hora, sem recuo, e sem contar como falha. O
   motor já encerra as sessões filhas por `killTree`.
8. **Terminal interativo.** Continua sendo o motor quem abre o Terminal.app
   ou o terminal do Windows (`session.js`). A casca não participa.
9. **Reabertura silenciosa.** O marcador `consumirReaberturaSilenciosa()`
   passa a ser lido pela casca (arquivo em `~/.farol/state/`), que sobe na
   bandeja sem roubar o foco e notifica "Farol atualizado".

### 4.2 Casca macOS (Swift 6, SwiftUI, AppKit onde a SwiftUI não chega)

| responsabilidade | como |
|---|---|
| janela | `NSWindow` com `WKWebView`, barra de título unificada, cor de fundo lida de `settings-changed`; fecha para a bandeja, Dock reabre (`applicationShouldHandleReopen`) |
| bandeja | `NSStatusItem` com o ícone atual e menu: Abrir, Checar agora, Sair (sem "Pausar": pausa local não existe no motor, `pausado` só vem da política remota; não entra neste desenho) |
| badge | `NSApp.dockTile.badgeLabel` com o contador que `updateBadge` calcula hoje (migra para o motor, campo `badge` no snapshot) |
| notificação | `UNUserNotificationCenter`, clique abre o PR (`NSWorkspace.open`) ou foca a janela com `focus-intervention` enviado ao motor por `POST /api/...` já existente |
| autostart | `SMAppService.mainApp` (substitui `lib/autostart-mac.js` e o LaunchAgent) |
| instância única | garantida pelo Launch Services via bundle id; `second-instance` vira `applicationShouldHandleReopen` |
| sidecar | `Process` com `executableURL` no `node` do bundle; `Contents/Resources/engine/` tem o pacote leve; `Contents/Resources/node/bin/node` o binário |
| update | Sparkle 2 com appcast assinado (EdDSA), release no GitHub como hoje; ou o `.dmg` novo baixado pela casca. Ver 4.5 |
| assinatura | Developer ID Application, Hardened Runtime, notarização com `notarytool`; entitlements: sem sandbox (o motor executa `gh`, `claude`, `git`, Terminal) |
| alvo | macOS 14 ou mais novo (decisão em aberto, ver 8), universal arm64 + x64 ou um por arquitetura |

### 4.3 Casca Windows (C#, .NET 8, WinUI 3 / Windows App SDK)

| responsabilidade | como |
|---|---|
| janela | `Window` com `WebView2`, barra de título customizada (`ExtendsContentIntoTitleBar`) com a cor de `settings-changed`; fechar minimiza para a bandeja |
| bandeja | `Shell_NotifyIcon` via P/Invoke ou `H.NotifyIcon.WinUI` (decisão em aberto: a regra "sem framework de terceiros" pede P/Invoke) |
| badge | overlay na barra de tarefas (`ITaskbarList3.SetOverlayIcon`) com o contador |
| notificação | toast do Windows App SDK (`AppNotificationManager`), clique abre o PR ou foca a janela |
| autostart | `StartupTask` do pacote MSIX (ou chave `Run` no registro se o instalador não for MSIX) |
| instância única | `AppInstance.FindOrRegisterForKey` do Windows App SDK; a segunda ativa a primeira |
| sidecar | `Process` com o `node.exe` em `engine\node\`; pacote leve em `engine\app\` |
| update | MSIX com App Installer apontando para o `.appinstaller` da release no GitHub; ou instalador NSIS como hoje mais updater próprio. Ver 4.5 |
| assinatura | certificado de código (OV, ou EV para passar o SmartScreen sem reputação); `signtool` no CI |
| alvo | Windows 10 1809+ ou Windows 11 (decisão em aberto); x64 (arm64 depois) |

### 4.4 O que sai do repositório do motor

- `main.js`, `lib/electron-runtime.js`, `lib/update-installer.js`,
  `lib/autostart-mac.js`, `installer/electron-runtime.*`,
  `installer/native-bundle-mac.sh`, `tools/make-installer.ps1` (NSIS do
  Electron), `installer/farol.nsi`, os smokes e testes que importam `electron`,
  e `electron` do `package.json`. Tudo na última fase, quando as duas cascas
  estiverem em produção.
- `lib/engine/update.js`: o ramo "pacote completo" vira o ramo "casca" (4.5).

### 4.5 Update

Dois níveis, como hoje, mas com donos claros:

- **Motor (pacote leve)**: o bundle traz o motor semeado em
  `Resources/engine/` (só leitura: trocar arquivo dentro de um `.app`
  notarizado ou de um MSIX invalida a assinatura). A casca sempre executa o
  motor do BUNDLE, e esse motor é quem decide: ao subir com `FAROL_SHELL`, o
  `server.js` procura em `~/.farol/engine/<versão>/` a versão mais nova que
  seja maior que a semeada e compatível com a casca (`engines.farolShell` do
  `package.json` dela, informado em `FAROL_SHELL_VERSION`), e se existir faz
  `execve` para o `server.js` de lá (mesmo `node`, mesmos argumentos). Assim a
  casca nunca entende versão nem escolhe pasta. `APP_ROOT` passa a ser a
  pasta do motor em execução: o pacote leve já contém `ui/`,
  `workspace-template/` e `assets/third-party/`, então tudo deriva de um
  lugar só, como hoje. O `update-servidor.js` ganha o ramo casca: baixa o
  pacote leve para `~/.farol/engine/<versão>/` (atômico, pasta `.tmp` e
  rename), emite `casca-saida` e sai com 75; a casca religa e o bootstrap
  cai na versão nova. Versão semeada mais nova que a de `~/.farol/engine/`
  (reinstalou a casca) ganha, e a pasta antiga é podada no boot seguinte.
- **Casca**: Sparkle no Mac e App Installer no Windows, cada um com a sua
  assinatura. A casca só se atualiza quando o motor não tem revisão viva
  (lê `activeReviews` do snapshot), o mesmo gate que o update de hoje aplica.
- **Compatibilidade**: `package.json` ganha `engines.farolShell` (faixa de
  versão da casca que este motor aceita) e a casca recusa motor fora da
  faixa, no espírito de `lib/electron-runtime.js`.

### 4.6 Web

Fase independente, só motor: `config.bind` (padrão `127.0.0.1`), allowlist
de Host de `lib/http-guard.js` aceitando o host configurado, A4 exigido
sempre que o bind não for loopback, e um proxy com TLS na frente. Um processo
por pessoa. As cascas podem apontar para um motor remoto (campo "motor" em
Ajustes da casca): é o "visor" de 4.1 com outro endereço, sem código novo na
tela.

### 4.7 Migração de quem já tem o Farol Electron

Decisão minha: uma release de ponte, a última da linha 2.x. Ela traz um aviso
na tela e no `update.js` do Electron: "esta é a última versão nesta casca;
baixe o Farol nativo", com o link do `.dmg` ou `.msix` e sem tentar aplicar
pacote completo de 3.x (o `assertElectronRuntime` recusaria para sempre). O
instalador nativo, na primeira abertura, limpa o que o antigo deixou: o
LaunchAgent de `lib/autostart-mac.js` e o `~/Applications/Farol.app` do
Electron no Mac; o desinstalador NSIS e o item de login no Windows; e avisa
se encontrar um Farol antigo vivo na porta (em vez de virar visor dele
calado). `~/.farol` não é tocado: dados, config, estado e token do `gh`
continuam onde estão.

## 5. Organização do código

Um repositório só, com três raízes, para release e versão andarem juntas:

```
farol/
  server.js, lib/, ui/, test/, tools/       (motor, como hoje)
  shell/mac/   Farol.xcodeproj gerado por XcodeGen (project.yml), Sources/, Tests/
  shell/win/   Farol.sln, Farol/ (WinUI 3), Farol.Tests/
  installer/   scripts de empacotamento dos dois, um por SO
```

As quatro listas de distribuição travadas em `test/distribuicao-listas.test.js`
passam a descrever o pacote leve do motor (o que vai dentro de
`Resources/engine/`) e nada mais. Alternativa (ver 8): dois repositórios para
as cascas, com o motor como submódulo ou pacote baixado da release.

## 6. Build, CI e release

- Motor: `npm run check && npm run lint && npm test` como hoje; o pacote leve
  continua sendo gerado por `tools/make-package.ps1` (porta para `.sh`
  também).
- Mac: runner `macos-14`, `xcodegen`, `xcodebuild archive`, assinatura
  Developer ID, `notarytool submit --wait`, `.dmg` por `create-dmg` ou
  `hdiutil`, appcast do Sparkle assinado. Node arm64 e x64 baixados do
  nodejs.org com SHA conferido no build.
- Windows: runner `windows-latest`, `dotnet publish`, `MakeAppx`/`signtool`,
  `.msix` + `.appinstaller`. Node x64 idem.
- Release: a tag `vX.Y.Z` publica, na mesma release do GitHub, o pacote leve
  do motor (update dos Termux e servidores), o `.dmg`, o `.msix` e os
  manifestos de update. `tools/publish-release.ps1` cresce para isso.
- Smoke por SO no CI: a casca sobe o sidecar com `FAROL_HOME` temporário,
  espera `/api/state`, confere um evento `aviso-nativo` falso e fecha.

## 7. Testes

- Motor: testes novos para `modoCasca`, `avisos-nativos.js` (puro, com os
  casos do `wireEngine`, mais `casca` e `casca-saida`), A4 implícito com
  `FAROL_SHELL`, sessão da classe `casca`, `state/casca.json`, bootstrap de
  versão em `~/.farol/engine/`, saída 75 e `engines.farolShell`.
- Mac: Swift Testing para o cliente SSE, o parser dos eventos, o ciclo de vida
  do sidecar (com um `node` falso) e o badge; XCUITest só para o smoke.
- Windows: xUnit para os mesmos quatro, WinAppDriver só para o smoke.
- Paridade entre cascas: um arquivo de fixtures JSON com os eventos do motor
  e o resultado esperado (título, corpo, url, badge) lido pelos testes das
  duas cascas. É o teste que impede as cascas de divergirem.

## 8. Decisões que só o dono toma

0. **O critério de memória no Windows (decidido em 28/10/2026).** Os 150 MB
   somam TODOS os processos (casca, `node`, o processo do WebView e seus
   filhos). No Mac o WKWebView é o motor do Safari, compartilhado com o
   sistema, e os 150 MB valem como critério de passagem. No Windows o
   WebView2 é o Chromium do Edge e a estimativa honesta é de 200 a 280 MB
   parado, contra 398 do Electron. Decisão do dono: a casca Windows SEGUE
   mesmo sem fechar nos 150 MB; bandeja, instalador, update e assinatura
   nativos já justificam, e o ganho de memória lá é o que a medição der. A
   semana 1 do Windows é "medir", não "provar", e o número medido entra no
   documento.
1. Versão mínima de macOS (14 Sonoma é o piso prático para `SMAppService` e
   notificações modernas; 13 amplia o alcance) e de Windows (10 1809 ou só 11).
2. Formato do instalador Windows: MSIX com App Installer (update nativo, exige
   certificado confiável pela máquina) ou NSIS como hoje mais updater próprio.
3. Bandeja no Windows por P/Invoke (zero dependência, mais código) ou pela
   biblioteca `H.NotifyIcon` (uma dependência NuGet).
4. Update da casca Mac: Sparkle (uma dependência Swift Package, padrão de
   mercado) ou download do `.dmg` pela própria casca (zero dependência, mais
   código e sem delta).
5. Um repositório com `shell/mac` e `shell/win`, ou repositórios separados.
6. Contas de assinatura: Apple Developer Program (US$ 99/ano) e certificado
   de código Windows (OV ou EV), em nome de quem.
7. Ordem: as duas cascas em paralelo (duas pessoas) ou Mac primeiro.

## 9. Fases e cronograma

Premissa: uma pessoa Swift e uma pessoa C# em paralelo, mais quem cuida do
motor. Semanas corridas.

| semana | motor | Mac | Windows |
|---|---|---|---|
| 1 | contrato do sidecar: `modoCasca`, `state/casca.json`, A4 implícito e sessão `casca`, `avisos-nativos.js` com os eventos `aviso-nativo`, `casca` e `casca-saida` | protótipo: janela + WKWebView + sidecar; medir RSS; passar a `ui/` no WebKit | protótipo: janela + WebView2 + sidecar; medir RSS |
| 2 | correções de compatibilidade da `ui/` no WebKit; fixtures de paridade | bandeja, notificações, badge, cliente SSE | bandeja, toast, overlay, cliente SSE |
| 3 | `engines.farolShell`; bootstrap de versão e update do motor em `~/.farol/engine/<versão>/`, saída 75 | autostart, instância única, visor, reabertura silenciosa | autostart, instância única, visor, reabertura silenciosa |
| 4 | listas de distribuição; `make-package.sh` | Developer ID, notarização, `.dmg`, Sparkle | certificado, MSIX, App Installer |
| 5 | CI com os dois runners, a release unificada e a release de ponte 2.x (4.7) | piloto com o time (Electron em paralelo) | piloto com o time |
| 6 | web: `config.bind`, Host configurável, A4 fora do loopback | ajustes do piloto | ajustes do piloto |
| 7 | retirada do Electron e do `main.js`; docs (`MACOS.md`, `RELEASE.md`, `CLAUDE.md`) | release 3.0 | release 3.0 |
| 8+ | performance da tela (diff de snapshot, render por seção, gzip), independente das cascas | | |

Critério de passagem da semana 1: nenhuma tela quebrada no WebView nas duas
cascas; no Mac, app inteiro abaixo de 150 MB parado com as contas reais; no
Windows, só medir e registrar (decisão do dono, seção 8 item 0).

## 10. Riscos

- **WebKit no Mac**: a `ui/` nunca rodou fora do Chromium. Risco técnico
  número um; o protótipo da semana 1 existe para medi-lo.
- **WebView2 em máquinas bloqueadas por política**: o runtime Evergreen vem
  com o Windows 10 e 11 atualizados; o instalador MSIX declara a dependência.
- **Assinatura**: sem Developer ID e certificado Windows, nada disso é
  "compatível com o SO". É pré-requisito da semana 4, e a conta precisa
  existir antes.
- **Node dentro do bundle e o update do motor**: trocar arquivos dentro de um
  `.app` notarizado invalida a assinatura; por isso o motor atualizado mora
  em `~/.farol/engine/`. Mesmo cuidado no MSIX, que é só leitura.
- **Duas linguagens novas no repositório**: quem mantém precisa de Swift e C#.
  As cascas são pequenas (estimativa: 2 a 3 mil linhas cada) e mudam pouco
  depois de prontas; o motor segue sendo onde o produto vive.
- **Sidecar órfão**: se a casca morrer sem derrubar o motor, a próxima
  abertura vira visor dele (4.1 item 4), o que já é o comportamento de hoje.
- **Fidelidade sem reescrever a tela**: a `ui/` é a mesma nos dois SOs; a
  fidelidade está na janela, na bandeja, nas notificações e no instalador.
  Se o time esperar componentes nativos nas telas, isso é outro projeto.

## 11. O que fica para quem constrói

Nomes de tipos e módulos nas cascas, layout do menu da bandeja, ícones por
SO, detalhes do `.dmg`, estrutura exata do `project.yml` e do `.csproj`,
política de logs da casca (sugestão: só falhas, em `~/.farol/farol.log`, pelo
mesmo formato do motor) e o texto das telas de carregamento e de erro do
sidecar.
