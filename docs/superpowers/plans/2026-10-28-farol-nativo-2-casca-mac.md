# Casca macOS (Swift/SwiftUI): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** um `Farol.app` nativo em Swift que sobe o motor Node como sidecar, mostra a `ui/` num WKWebView e repõe tudo o que o `main.js` do Electron faz no Mac: bandeja, badge no Dock, notificações, autostart, instância única, visor e reabertura silenciosa.

**Architecture:** pacote Swift local `FarolKit` com três módulos em camadas: `FarolContrato` (puro: modelos dos eventos, parser de SSE, leitura do `casca.json`, política de religar, injeção do token), `FarolSidecar` (processo do motor, cliente SSE e pareamento, com `Process` e `URLSession`) e `FarolApp` (SwiftUI/AppKit: janela, bandeja, badge, notificações, autostart). O alvo do app é só composição. Toda regra é testada em `FarolContrato` com um `node` falso e um servidor HTTP falso.

**Tech Stack:** Swift 6 (modo de linguagem 6, concorrência estrita), SwiftUI + AppKit, WebKit, UserNotifications, ServiceManagement, XcodeGen (`project.yml`, `.xcodeproj` não versionado), Swift Testing, `swift-format`. Dependência externa: Sparkle 2 (SPM, versão exata) só no módulo `FarolApp` (decisão do plano, seção 8 item 4 do desenho; reversível).

**Spec:** `docs/superpowers/specs/2026-10-27-farol-nativo-swiftui-winui-design.md` (4.1, 4.2) e `docs/superpowers/plans/2026-10-28-farol-nativo-indice.md` (interfaces fixadas; o plano 1 as entrega).

## Global Constraints

- Alvo macOS 14 ou mais novo (decisão do plano, seção 8 item 1; reversível), arquitetura arm64 e x64 (binário universal).
- Sem App Sandbox (o motor executa `gh`, `claude`, `git` e abre o Terminal); Hardened Runtime ligado com a entitlement `com.apple.security.cs.allow-jit` para o `node` (necessária ao V8) e `com.apple.security.cs.disable-library-validation` desligada.
- Identificadores de código em inglês; textos de interface, comentários e `docs/` em português, sem travessão.
- A casca é cliente do motor: nunca escreve no GitHub, nunca decide; o único POST fora da autenticação é `/api/check`.
- A casca NÃO lê `state` nem `state-patch` do SSE.
- Toda chamada HTTP leva `Host: 127.0.0.1:<porta>` e `x-farol: 1`; as autenticadas levam `Authorization: Bearer <token>`.
- Código de saída `75` do sidecar é saída de propósito (religar na hora); `0` é fim; outro é falha (recuo 1 s, 2 s, 4 s, teto 30 s).
- Nenhum segredo em log; o token só mora no Keychain.
- Commits em português, `tipo(escopo): assunto`, sem trailer de coautoria. Branch `feat/casca-mac` a partir de `main`, com o plano 1 já mergeado.
- Antes de cada commit: `shell/mac/scripts/test.sh` e `shell/mac/scripts/lint.sh` verdes.

## Review Focus

1. **Motor que morre em laço** (ex. porta ocupada por outro programa a cada subida): o recuo chega ao teto de 30 s e, depois de 5 falhas seguidas, a casca mostra uma janela nativa com o motivo e o botão "Tentar de novo", sem continuar relançando sozinha; teste na Task 2.
2. **`casca.json` de um motor morto** (pid não existe) encontrado no boot: a casca ignora o arquivo, sobe o sidecar e espera o arquivo novo; teste na Task 3.
3. **Token do Keychain revogado no motor** (401 no SSE): a casca repareia com o código do `casca.json` atual sem intervenção, uma vez por subida; se o código já foi consumido, mostra a tela da `ui/` que pede pareamento e para; teste na Task 4.
4. **Clique na notificação com o app fechado na bandeja**: a janela reabre e navega para `?pr=`; teste na Task 7 (unitário sobre o roteador de ações, não XCUITest).
5. **Dois Farols no mesmo `~/.farol`** (Electron antigo vivo na porta): a casca vira visor e mostra, uma vez, o aviso "Outro Farol já está rodando nesta porta; esta janela só mostra o que ele faz" (texto do desenho 4.7); teste na Task 3.

---

### Task 0: esqueleto do projeto

**Files:**
- Create: `shell/mac/project.yml`, `shell/mac/Farol/FarolApp.swift` (só `@main`), `shell/mac/Farol/Info.plist` (chaves: `LSUIElement` = false, `CFBundleIdentifier` = `com.biud.farol`, `NSUserNotificationAlertStyle` = alert), `shell/mac/Farol/Farol.entitlements`
- Create: `shell/mac/Packages/FarolKit/Package.swift` (alvos `FarolContrato`, `FarolSidecar`, `FarolApp` e os três de teste), um arquivo mínimo por módulo
- Create: `shell/mac/scripts/build.sh`, `test.sh` (`swift test --package-path Packages/FarolKit` e depois `xcodebuild test -scheme Farol`), `lint.sh` (`swift format lint --strict --recursive`), `.swift-format`
- Create: `shell/mac/README.md` (como compilar; aponta para o desenho e o índice)

- [ ] **Step 1:** `xcodegen generate` e `scripts/build.sh` compilam um app vazio que abre uma janela com o texto "Farol".
- [ ] **Step 2:** `scripts/test.sh` roda um teste trivial por módulo e passa.
- [ ] **Step 3: Commit** `chore(casca-mac): esqueleto do projeto Swift com XcodeGen e FarolKit`

---

### Task 1: `FarolContrato`: modelos, `casca.json` e parser de SSE

**Files:**
- Create: `Packages/FarolKit/Sources/FarolContrato/EngineFile.swift`, `ShellEvents.swift`, `SSEParser.swift`
- Test: `Packages/FarolKit/Tests/FarolContratoTests/EngineFileTests.swift`, `ShellEventsTests.swift`, `SSEParserTests.swift`

**Interfaces:**
- Produces:
  - `struct EngineFile: Codable, Sendable { port: Int; pid: Int32; version: String; pairingCode: String; startedAt: Date; nextVersion: String? }` com `static func read(at url: URL) throws -> EngineFile?` (JSON inválido → `nil`, nunca lança por conteúdo) e chaves JSON mapeadas (`porta`, `pid`, `versao`, `codigoPareamento`, `iniciadoEm` em ms, `proximaVersao`).
  - `enum ShellEvent: Equatable, Sendable { case notice(NativeNotice); case shell(ShellState); case exit(ExitNotice); case other(name: String) }` com `struct NativeNotice { title, body: String; url: URL?; pr: String?; silent: Bool }`, `struct ShellState { badgeCount: Int; badgeLabel: String; busy: Bool; autostart: Bool; colors: (bg: String, symbol: String) }`, `struct ExitNotice { reason: String; nextVersion: String? }`; `static func decode(name: String, data: Data) -> ShellEvent?` (desconhecido → `.other`; corpo inválido de um nome conhecido → `nil`).
  - `struct SSEParser { mutating func feed(_ bytes: Data) -> [(name: String, data: Data)] }` (acumula entre chunks; `ping` e comentários ignorados).

- [ ] **Step 1: Write the failing tests** lendo `test/fixtures/casca/eventos.json` do repositório (caminho relativo a `shell/mac`): para cada caso, `ShellEvent.decode("aviso-nativo", corpo)` tem de dar `.notice` com título, corpo, url e pr iguais a `esperado`. Mais: `EngineFile.read` com o JSON do índice; com `{nope` → `nil`; `SSEParser` com um evento partido em dois chunks e com `event: ping`.
- [ ] **Step 2:** `swift test --filter FarolContratoTests` falha por tipos inexistentes.
- [ ] **Step 3:** Implementar os três arquivos.
- [ ] **Step 4:** `swift test --filter FarolContratoTests` passa.
- [ ] **Step 5: Commit** `feat(casca-mac): contrato com o motor: casca.json, eventos e parser de SSE`

---

### Task 2: `FarolContrato`: política de religar e máquina de estados do sidecar

**Files:**
- Create: `Sources/FarolContrato/RestartPolicy.swift`, `SidecarState.swift`
- Test: `Tests/FarolContratoTests/RestartPolicyTests.swift`, `SidecarStateTests.swift`

**Interfaces:**
- Produces: `struct RestartPolicy { static let intentionalExit: Int32 = 75; static let maxConsecutiveFailures = 5; func delay(afterExit code: Int32, consecutiveFailures: Int) -> RestartDecision }` com `enum RestartDecision: Equatable { case immediately; case after(seconds: Double); case stop(reason: String) }`: `75` → `.immediately`; `0` → `.stop("encerrado")`; outro → `.after(min(30, pow(2, n-1)))` até 5 falhas, depois `.stop("o motor não ficou de pé depois de 5 tentativas")`.
- `enum SidecarPhase: Equatable { case starting, waitingForFile, pairing, ready(port: Int), viewer(port: Int), restarting(in: Double), stopped(reason: String) }` e `struct SidecarMachine { mutating func on(_ input: SidecarInput) -> [SidecarEffect] }` com `enum SidecarInput { case boot(existingEngine: EngineFile?, engineAlive: Bool); case fileAppeared(EngineFile); case paired; case pairFailed; case exited(code: Int32) }` e `enum SidecarEffect: Equatable { case spawn; case waitFile; case pair(code: String, port: Int); case openWindow(port: Int, viewer: Bool); case showViewerNotice; case restart(after: Double); case showFailure(String) }`.

- [ ] **Step 1: Write the failing tests** cobrindo: boot sem arquivo → `[.spawn, .waitFile]`; boot com arquivo de motor vivo (`engineAlive: true`) → `[.openWindow(port, viewer: true), .showViewerNotice]` (Review Focus 5); boot com arquivo e motor morto → `[.spawn, .waitFile]` (Review Focus 2); `exited(75)` em `.ready` → `[.restart(after: 0)]`; cinco `exited(1)` seguidos → último efeito `.showFailure` (Review Focus 1); `pairFailed` → `.openWindow(port, viewer: false)` (a `ui/` mostra o pareamento).
- [ ] **Step 2:** falha. **Step 3:** implementar. **Step 4:** passa.
- [ ] **Step 5: Commit** `feat(casca-mac): política de religar e máquina de estados do sidecar`

---

### Task 3: `FarolSidecar`: processo do motor, espera do arquivo e detecção de motor vivo

**Files:**
- Create: `Sources/FarolSidecar/EngineProcess.swift`, `EngineLocator.swift`, `EngineProbe.swift`
- Test: `Tests/FarolSidecarTests/EngineProcessTests.swift` (com um `node` falso: script shell que grava um `casca.json` e dorme), `EngineProbeTests.swift` (com um servidor HTTP falso em `Network`/`NWListener` respondendo `/api/auth/status`)

**Interfaces:**
- Consumes: `EngineFile`, `SidecarMachine`.
- Produces: `actor EngineProcess { init(node: URL, serverJS: URL, home: URL?, shellVersion: String); func start() async throws; func stop() async (SIGTERM, 5 s, SIGKILL); var exitCodes: AsyncStream<Int32> }` passando `FAROL_SHELL=mac` e `FAROL_SHELL_VERSION`; `struct EngineLocator { static func bundled() -> (node: URL, serverJS: URL) }` (`Contents/Resources/engine/node/bin/node` e `engine/app/server.js`); `struct EngineProbe { static func isFarol(port: Int) async -> Bool }` (GET `/api/auth/status` com `Host` e `x-farol`, 200 com corpo JSON contendo `exigida`); `func waitForEngineFile(at: URL, timeout: Double = 30) async throws -> EngineFile`.

- [ ] **Step 1: Write the failing tests:** o `node` falso recebe `FAROL_SHELL=mac` (gravar o env num arquivo); `stop()` mata o processo; `waitForEngineFile` lê o arquivo que o falso grava depois de 1 s e lança em timeout; `EngineProbe.isFarol` dá `true` no servidor falso e `false` em porta fechada.
- [ ] **Step 2:** falha. **Step 3:** implementar. **Step 4:** passa.
- [ ] **Step 5: Commit** `feat(casca-mac): processo do motor, espera do casca.json e sondagem de motor vivo`

---

### Task 4: `FarolSidecar`: pareamento, Keychain e cliente SSE

**Files:**
- Create: `Sources/FarolSidecar/Pairing.swift`, `TokenStore.swift`, `EventStream.swift`
- Test: `Tests/FarolSidecarTests/PairingTests.swift`, `TokenStoreTests.swift` (Keychain com `kSecAttrService` de teste, apagado no fim), `EventStreamTests.swift` (servidor falso que emite `state`, `casca`, `aviso-nativo`, e um que responde 401)

**Interfaces:**
- Produces: `struct Pairing { static func pair(port: Int, code: String, label: String = "Farol.app") async throws -> String }` (POST `/api/auth/pair` `{codigo, rotulo}`; `{ok:false}` → `PairingError.refused(code:)`); `struct TokenStore { func load() -> String?; func save(_: String) throws; func delete() }` (Keychain, service `com.biud.farol`, account `local-auth-token`); `actor EventStream { init(port: Int, token: String); var events: AsyncStream<ShellEvent>; func start(); func stop() }` com reconexão (3 s dobrando até 30 s, igual ao `ui/transporte.js`) e `EventStreamError.unauthorized` emitido uma vez no 401 (Review Focus 3: quem repareia é a máquina de estados, com `.pairFailed` se o código já foi usado).

- [ ] **Step 1: Write the failing tests** (os três comportamentos acima, mais: `EventStream` ignora `state` e `state-patch` sem decodificar).
- [ ] **Step 2:** falha. **Step 3:** implementar. **Step 4:** passa.
- [ ] **Step 5: Commit** `feat(casca-mac): pareamento, token no Keychain e cliente SSE`

---

### Task 5: `FarolApp`: janela com WKWebView e injeção do token

**Files:**
- Create: `Sources/FarolApp/MainWindow.swift`, `WebViewController.swift`, `TokenInjection.swift`
- Test: `Tests/FarolAppTests/TokenInjectionTests.swift` (o `WKUserScript` gerado contém `localStorage.setItem('farol-auth-token', '<token>')`, roda em `.atDocumentStart`, `forMainFrameOnly: true`, e o token com aspas ou barra é escapado)

**Interfaces:**
- Produces: `@MainActor final class WebViewController { init(port: Int, token: String?); func navigate(to path: String) }` (`navigate(to: "/?pr=owner%2Frepo%23N")`); links com `target=_blank` e domínios fora de `127.0.0.1` abrem no navegador padrão (`WKNavigationDelegate.decidePolicyFor`); fechar a janela esconde (`NSWindow.close` interceptado), Dock reabre (`applicationShouldHandleReopen`).
- Cor de fundo e símbolo da barra vêm de `ShellState.colors`; aplicados em `apply(_ state: ShellState)`.

- [ ] **Step 1:** teste de `TokenInjection` falha. **Step 2:** implementar. **Step 3:** passa; abrir o app contra um motor real em `FAROL_HOME` temporário (plano 1 pronto) e ver a `ui/` renderizar no WebKit.
- [ ] **Step 4: Commit** `feat(casca-mac): janela com WKWebView e token injetado antes da página`

---

### Task 6: `FarolApp`: bandeja, badge e autostart

**Files:**
- Create: `Sources/FarolApp/StatusItemController.swift`, `DockBadge.swift`, `Autostart.swift`
- Test: `Tests/FarolAppTests/DockBadgeTests.swift` (`badgeLabel(for: ShellState)`: 0 → `""`, 3 → `"3"`), `AutostartTests.swift` (`Autostart.desired(from: ShellState)` e a chamada a `SMAppService.mainApp.register/unregister` por um protocolo injetável)

**Interfaces:**
- Menu da bandeja: "Abrir", "Checar agora" (POST `/api/check`), separador, "Sair". Tooltip: `Farol · <badgeLabel>` ou `Farol`. Ícone: `assets/farol-tray.png` (template image) copiado para `Farol/Assets.xcassets`.
- `Autostart.apply(_ wanted: Bool)` registra ou remove o login item; falha vira log, nunca alerta (igual ao WARN de `applyAutostart`).

- [ ] **Step 1:** testes falham. **Step 2:** implementar. **Step 3:** passam.
- [ ] **Step 4: Commit** `feat(casca-mac): bandeja, badge no Dock e autostart por SMAppService`

---

### Task 7: `FarolApp`: notificações e roteador de ações

**Files:**
- Create: `Sources/FarolApp/Notifier.swift`, `ActionRouter.swift`
- Test: `Tests/FarolAppTests/ActionRouterTests.swift`

**Interfaces:**
- `struct ActionRouter { func action(for notice: NativeNotice) -> NoticeAction }` com `enum NoticeAction: Equatable { case openURL(URL); case focusPR(String); case focusWindow }`: `url` presente → `.openURL`; só `pr` → `.focusPR`; nenhum → `.focusWindow`.
- `Notifier.post(_ notice: NativeNotice)` por `UNUserNotificationCenter` (título, corpo, `sound` nulo quando `silent`, `userInfo` com url e pr); o delegate aplica `ActionRouter` e, para `.focusPR`, mostra a janela e chama `WebViewController.navigate(to: "/?pr=<pr codificado>")`.
- Pedido de permissão de notificação uma vez, no primeiro boot.

- [ ] **Step 1:** testes do roteador falham (incluir Review Focus 4: `.focusPR` com a janela escondida reabre, provado por um `WindowPresenter` protocolo injetável). **Step 2:** implementar. **Step 3:** passam.
- [ ] **Step 4: Commit** `feat(casca-mac): notificações nativas com clique que abre o PR`

---

### Task 8: composição no alvo do app: instância única, visor, reabertura silenciosa

**Files:**
- Modify: `Farol/FarolApp.swift`, Create: `Farol/AppDelegate.swift`, `Sources/FarolApp/SilentReopen.swift`
- Test: `Tests/FarolAppTests/SilentReopenTests.swift` (lê e apaga `state/reabrir-silencioso.json`; vencido em 10 min → `nil`; ausente → `nil`)

**Interfaces:**
- `AppDelegate` liga tudo: `SidecarMachine` dirige `EngineProcess`, `Pairing`, `TokenStore`, `EventStream`, `WebViewController`, `StatusItemController`, `DockBadge`, `Autostart`, `Notifier`. Instância única é do Launch Services (bundle id): a segunda abertura chega como `applicationShouldHandleReopen` e só mostra a janela.
- `SilentReopen.consume(stateDir:) -> String?` (versão): quando presente, o app sobe sem ativar a janela e posta a notificação "Farol atualizado" / "Agora na versão X. Segue monitorando na bandeja."
- `.exit(ExitNotice)` com `reason == "update"`: a casca espera o processo sair e religa na hora (já é `.immediately` por 75).

- [ ] **Step 1:** teste de `SilentReopen` falha. **Step 2:** implementar e compor. **Step 3:** passa; smoke manual: abrir o app duas vezes (segunda só foca), matar o `node` à mão (religa), forçar `casca-saida` pelo update do motor em `FAROL_HOME` temporário (religa sem recuo).
- [ ] **Step 4: Commit** `feat(casca-mac): composição do app, visor e reabertura silenciosa`

---

### Task 9: Sparkle, medição e documentação

**Files:**
- Modify: `Packages/FarolKit/Package.swift` (Sparkle 2.x exato), `Farol/Info.plist` (`SUFeedURL`, `SUPublicEDKey`), Create: `Sources/FarolApp/Updater.swift`
- Create: `shell/mac/docs/medicao.md`
- Modify: `docs/MACOS.md` (seção "Casca nativa"), `CLAUDE.md` (mapa: `shell/mac/`)

- [ ] **Step 1:** `Updater` só verifica quando `ShellState.busy == false` (teste unitário sobre o gate, com o `SPUUpdater` atrás de um protocolo).
- [ ] **Step 2:** Medir RSS de todos os processos (app, `node`, `com.apple.WebKit.WebContent` e `Networking`) parado por 10 min com as contas reais e registrar em `medicao.md` ao lado dos 398 MB do Electron. Critério do desenho: abaixo de 150 MB.
- [ ] **Step 3:** `scripts/test.sh` e `scripts/lint.sh` verdes; `npm test` do motor intocado.
- [ ] **Step 4: Commit** `feat(casca-mac): updater Sparkle, medição e documentação` e abrir o PR de `feat/casca-mac` para `main`.
