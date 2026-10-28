# Casca Windows (C#/WinUI 3): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** um `Farol.exe` nativo em C# com WinUI 3 que sobe o motor Node como sidecar, mostra a `ui/` num WebView2 e repõe o que o `main.js` do Electron faz no Windows: bandeja, overlay na barra de tarefas, toasts, autostart, instância única, visor e reabertura silenciosa.

**Architecture:** solução com três projetos: `Farol.Contrato` (biblioteca .NET pura, sem WinUI: modelos dos eventos, parser de SSE, `casca.json`, política de religar, máquina de estados, roteador de ações), `Farol.Sidecar` (processo do motor, cliente SSE, pareamento, cofre do token) e `Farol.App` (WinUI 3: janela, bandeja, overlay, toasts, autostart). Espelha módulo a módulo o plano da casca Mac, com os MESMOS nomes de tipos, para as fixtures de paridade e os revisores poderem comparar os dois.

**Tech Stack:** .NET 8, Windows App SDK 1.6 (WinUI 3, WebView2, `AppNotificationManager`, `AppInstance`), `Windows.Security.Credentials.PasswordVault` (WinRT, zero dependência) para o token, P/Invoke para `Shell_NotifyIcon` e `ITaskbarList3` (decisão do plano, seção 8 item 3 do desenho; reversível para `H.NotifyIcon.WinUI`), xUnit, `dotnet format`. Empacotamento MSIX (decisão do plano, seção 8 item 2; o plano 4 cuida do instalador).

**Spec:** `docs/superpowers/specs/2026-10-27-farol-nativo-swiftui-winui-design.md` (4.1, 4.3) e `docs/superpowers/plans/2026-10-28-farol-nativo-indice.md`.

## Global Constraints

- Alvo Windows 10 1809 (build 17763) ou mais novo, x64 (decisão do plano, seção 8 item 1; reversível).
- Identificadores em inglês; textos de interface, comentários e `docs/` em português, sem travessão.
- A casca é cliente do motor: nunca escreve no GitHub; o único POST fora da autenticação é `/api/check`.
- A casca NÃO lê `state` nem `state-patch`.
- Toda chamada HTTP leva `Host: 127.0.0.1:<porta>` e `x-farol: 1`; as autenticadas, `Authorization: Bearer <token>`.
- Código de saída `75` é saída de propósito; `0` é fim; outro é falha com recuo 1 s, 2 s, 4 s, teto 30 s, parada depois de 5 falhas seguidas.
- Nenhum segredo em log; o token só mora no `PasswordVault`.
- `Farol.Contrato` não referencia WinUI nem Windows App SDK, para rodar no xUnit sem janela.
- Commits em português, `tipo(escopo): assunto`, sem trailer de coautoria. Branch `feat/casca-win` a partir de `main` com o plano 1 mergeado.
- Antes de cada commit: `dotnet test shell/win/Farol.sln` e `dotnet format --verify-no-changes` verdes.

## Review Focus

1. **WebView2 Runtime ausente** (máquina sem o Evergreen): a casca mostra uma janela nativa com o link oficial do runtime e não sobe o sidecar; teste na Task 5 (checagem atrás de um protocolo injetável).
2. **`taskkill /T` não derruba o `claude` filho do motor** (o motor já mata a árvore por `killTree`, mas a casca precisa esperar): `Stop()` espera até 5 s e registra WARN se ainda houver processo vivo; teste na Task 3.
3. **Token revogado (401 no SSE)**: repareia uma vez com o código atual; código consumido → janela com a `ui/` de pareamento; teste na Task 4.
4. **Clique no toast com o app na bandeja**: a janela reabre e navega para `?pr=`; teste na Task 7 sobre o `ActionRouter`.
5. **Electron antigo vivo na porta**: a casca vira visor e avisa uma vez (texto do desenho 4.7); teste na Task 2.

---

### Task 0: esqueleto da solução

**Files:**
- Create: `shell/win/Farol.sln`, `shell/win/Farol.Contrato/Farol.Contrato.csproj` (`net8.0`), `shell/win/Farol.Sidecar/Farol.Sidecar.csproj` (`net8.0-windows10.0.17763.0`), `shell/win/Farol.App/Farol.App.csproj` (WinUI 3, `net8.0-windows10.0.19041.0`, `TargetPlatformMinVersion` 10.0.17763.0, `WindowsPackageType=MSIX`), `shell/win/Farol.App/Package.appxmanifest` (identidade `BIUD.Farol`, `StartupTask` `FarolAutostart` desligada por padrão, `runFullTrust`), `shell/win/Farol.Tests/Farol.Tests.csproj` (xUnit, referencia Contrato e Sidecar)
- Create: `shell/win/scripts/build.ps1`, `test.ps1`, `lint.ps1`, `shell/win/README.md`

- [ ] **Step 1:** `dotnet build` compila; o app abre uma janela com o texto "Farol".
- [ ] **Step 2:** `dotnet test` roda um teste trivial e passa.
- [ ] **Step 3: Commit** `chore(casca-win): esqueleto da solução WinUI 3 com Contrato, Sidecar e Tests`

---

### Task 1: `Farol.Contrato`: `EngineFile`, `ShellEvent` e `SseParser`

**Files:**
- Create: `Farol.Contrato/EngineFile.cs`, `ShellEvents.cs`, `SseParser.cs`
- Test: `Farol.Tests/EngineFileTests.cs`, `ShellEventsTests.cs`, `SseParserTests.cs`

**Interfaces:**
- `record EngineFile(int Port, int Pid, string Version, string PairingCode, DateTimeOffset StartedAt, string? NextVersion)` com `static EngineFile? Read(string path)` (JSON inválido → `null`; chaves `porta`, `pid`, `versao`, `codigoPareamento`, `iniciadoEm` em ms, `proximaVersao`).
- `abstract record ShellEvent` com `record Notice(string Title, string Body, Uri? Url, string? Pr, bool Silent)`, `record Shell(int BadgeCount, string BadgeLabel, bool Busy, bool Autostart, string ColorBg, string ColorSymbol)`, `record Exit(string Reason, string? NextVersion)`, `record Other(string Name)`; `static ShellEvent? Decode(string name, ReadOnlySpan<byte> data)`.
- `sealed class SseParser { IEnumerable<(string Name, byte[] Data)> Feed(ReadOnlySpan<byte> chunk); }` (acumula entre chunks; `ping` e comentários ignorados).

- [ ] **Step 1: Write the failing tests** lendo `test/fixtures/casca/eventos.json` (caminho relativo a `shell/win`): cada caso decodifica para `Notice` igual a `esperado`; `EngineFile.Read` com o JSON do índice e com `{nope`; parser com evento partido em dois chunks e com `event: ping`.
- [ ] **Step 2:** `dotnet test --filter Contrato` falha. **Step 3:** implementar com `System.Text.Json`. **Step 4:** passa.
- [ ] **Step 5: Commit** `feat(casca-win): contrato com o motor: casca.json, eventos e parser de SSE`

---

### Task 2: `Farol.Contrato`: `RestartPolicy` e `SidecarMachine`

**Files:**
- Create: `Farol.Contrato/RestartPolicy.cs`, `SidecarMachine.cs`
- Test: `Farol.Tests/RestartPolicyTests.cs`, `SidecarMachineTests.cs`

**Interfaces:** os mesmos nomes e casos do plano da casca Mac (Task 2 de lá): `RestartPolicy.IntentionalExit = 75`, `MaxConsecutiveFailures = 5`, `RestartDecision Delay(int exitCode, int consecutiveFailures)` com `Immediately | After(double seconds) | Stop(string reason)`; `SidecarMachine.On(SidecarInput) -> IReadOnlyList<SidecarEffect>` com `Boot(EngineFile? existing, bool engineAlive)`, `FileAppeared`, `Paired`, `PairFailed`, `Exited(int code)` e efeitos `Spawn`, `WaitFile`, `Pair(code, port)`, `OpenWindow(port, viewer)`, `ShowViewerNotice`, `Restart(after)`, `ShowFailure(string)`.

- [ ] **Step 1:** os seis casos de teste do plano Mac (boot sem arquivo, visor de motor vivo, arquivo de motor morto, saída 75, cinco falhas, `PairFailed`). **Step 2:** falha. **Step 3:** implementar. **Step 4:** passa.
- [ ] **Step 5: Commit** `feat(casca-win): política de religar e máquina de estados do sidecar`

---

### Task 3: `Farol.Sidecar`: `EngineProcess`, `EngineLocator`, `EngineProbe`

**Files:**
- Create: `Farol.Sidecar/EngineProcess.cs`, `EngineLocator.cs`, `EngineProbe.cs`
- Test: `Farol.Tests/EngineProcessTests.cs` (um `node.exe` falso: `.cmd` que grava o env e um `casca.json` e dorme), `EngineProbeTests.cs` (`HttpListener` falso em `127.0.0.1` respondendo `/api/auth/status`)

**Interfaces:**
- `sealed class EngineProcess(string nodeExe, string serverJs, string? home, string shellVersion) { Task StartAsync(); Task StopAsync(); IAsyncEnumerable<int> ExitCodes; }`: env `FAROL_SHELL=win`, `FAROL_SHELL_VERSION`; `StopAsync` = `taskkill /T /PID` e espera até 5 s (Review Focus 2); `CreateNoWindow = true`.
- `EngineLocator.Bundled()` → (`engine\node\node.exe`, `engine\app\server.js`) relativos a `AppContext.BaseDirectory`.
- `EngineProbe.IsFarolAsync(int port)`; `WaitForEngineFileAsync(string path, TimeSpan timeout)`.

- [ ] **Step 1:** testes falham. **Step 2:** implementar. **Step 3:** passam.
- [ ] **Step 4: Commit** `feat(casca-win): processo do motor, espera do casca.json e sondagem de motor vivo`

---

### Task 4: `Farol.Sidecar`: `Pairing`, `TokenStore` (PasswordVault) e `EventStream`

**Files:**
- Create: `Farol.Sidecar/Pairing.cs`, `TokenStore.cs`, `EventStream.cs`
- Test: `Farol.Tests/PairingTests.cs`, `TokenStoreTests.cs` (recurso `com.biud.farol.test`, apagado no fim), `EventStreamTests.cs` (`HttpListener` falso emitindo `state`, `casca`, `aviso-nativo`; e um que responde 401)

**Interfaces:**
- `Pairing.PairAsync(int port, string code, string label = "Farol")` → token ou `PairingException(code)`.
- `TokenStore { string? Load(); void Save(string); void Delete(); }` (recurso `com.biud.farol`, usuário `local-auth-token`).
- `sealed class EventStream(int port, string token) { IAsyncEnumerable<ShellEvent> Events; void Start(); void Stop(); }` com reconexão 3 s dobrando até 30 s e `Unauthorized` emitido uma vez no 401 (Review Focus 3), e sem decodificar `state`/`state-patch`.

- [ ] **Step 1:** testes falham. **Step 2:** implementar com `HttpClient` (`ResponseHeadersRead`). **Step 3:** passam.
- [ ] **Step 4: Commit** `feat(casca-win): pareamento, token no PasswordVault e cliente SSE`

---

### Task 5: `Farol.App`: janela com WebView2 e injeção do token

**Files:**
- Create: `Farol.App/MainWindow.xaml(.cs)`, `WebHost.cs`, `TokenInjection.cs`, `WebView2Check.cs`
- Test: `Farol.Tests/TokenInjectionTests.cs` (o script gerado faz `localStorage.setItem('farol-auth-token', ...)` com escape de aspas e barra, para `AddScriptToExecuteOnDocumentCreatedAsync`)

**Interfaces:**
- `WebHost { Task NavigateAsync(string path); void Apply(ShellEvent.Shell state); }` com `NewWindowRequested` e domínios fora de `127.0.0.1` abertos no navegador padrão; fechar a janela esconde (`AppWindow.Closing` cancelado), `ExtendsContentIntoTitleBar = true` com as cores de `Shell`.
- `WebView2Check.IsRuntimeInstalled()` por `CoreWebView2Environment.GetAvailableBrowserVersionString()` atrás de `IWebView2Check` injetável; ausente → janela nativa com o link `https://developer.microsoft.com/microsoft-edge/webview2/` e sem sidecar (Review Focus 1).

- [ ] **Step 1:** testes falham. **Step 2:** implementar. **Step 3:** passam; abrir contra um motor real em `FAROL_HOME` temporário.
- [ ] **Step 4: Commit** `feat(casca-win): janela com WebView2, token injetado e checagem do runtime`

---

### Task 6: `Farol.App`: bandeja (P/Invoke), overlay e autostart

**Files:**
- Create: `Farol.App/TrayIcon.cs` (`Shell_NotifyIcon`, `NOTIFYICONDATA`, janela de mensagens oculta, menu `TrackPopupMenu`), `TaskbarOverlay.cs` (`ITaskbarList3.SetOverlayIcon`), `Autostart.cs` (`StartupTask.GetAsync("FarolAutostart")` → `RequestEnableAsync` / `Disable`)
- Test: `Farol.Tests/OverlayLabelTests.cs` (`OverlayLabel.For(Shell)`: 0 → `""`, 1 → `"1 decisão esperando você"`), `AutostartTests.cs` (decisão atrás de `IStartupTask` injetável; estado `DisabledByUser` vira WARN e não insiste)

**Interfaces:** menu "Abrir", "Checar agora" (POST `/api/check`), separador, "Sair"; tooltip `Farol · <BadgeLabel>` ou `Farol`; ícone `assets/farol.ico`.

- [ ] **Step 1:** testes falham. **Step 2:** implementar. **Step 3:** passam.
- [ ] **Step 4: Commit** `feat(casca-win): bandeja por Shell_NotifyIcon, overlay na barra de tarefas e autostart`

---

### Task 7: `Farol.App`: toasts e `ActionRouter`

**Files:**
- Create: `Farol.Contrato/ActionRouter.cs` (puro), `Farol.App/Notifier.cs`
- Test: `Farol.Tests/ActionRouterTests.cs`

**Interfaces:** `ActionRouter.For(Notice)` → `OpenUrl(Uri) | FocusPr(string) | FocusWindow` (mesma regra do plano Mac); `Notifier.Post(Notice)` por `AppNotificationBuilder` com argumentos `url` e `pr`, `Silent` → `SetAudioEvent` mudo; `AppNotificationManager.Default.NotificationInvoked` aplica o roteador e, para `FocusPr`, mostra a janela e navega para `/?pr=<pr codificado>` (Review Focus 4, com `IWindowPresenter` injetável).

- [ ] **Step 1:** testes falham. **Step 2:** implementar. **Step 3:** passam.
- [ ] **Step 4: Commit** `feat(casca-win): toasts com clique que abre o PR`

---

### Task 8: composição: instância única, visor, reabertura silenciosa

**Files:**
- Modify: `Farol.App/App.xaml.cs`, Create: `Farol.App/Composition.cs`, `Farol.Contrato/SilentReopen.cs`
- Test: `Farol.Tests/SilentReopenTests.cs` (lê e apaga `state\reabrir-silencioso.json`; vencido em 10 min → `null`)

**Interfaces:** `AppInstance.FindOrRegisterForKey("farol")`: se não for a instância principal, `RedirectActivationToAsync` e sair; a principal recebe `Activated` e mostra a janela. `Composition` liga `SidecarMachine` a `EngineProcess`, `Pairing`, `TokenStore`, `EventStream`, `WebHost`, `TrayIcon`, `TaskbarOverlay`, `Autostart`, `Notifier`. `SilentReopen.Consume(stateDir)` → versão ou `null`; presente: sobe minimizado na bandeja e posta o toast "Farol atualizado".

- [ ] **Step 1:** teste falha. **Step 2:** implementar e compor. **Step 3:** passa; smoke manual: abrir duas vezes, matar o `node.exe` à mão, forçar `casca-saida` pelo update em `FAROL_HOME` temporário.
- [ ] **Step 4: Commit** `feat(casca-win): composição do app, instância única, visor e reabertura silenciosa`

---

### Task 9: gate de update, medição e documentação

**Files:**
- Create: `Farol.App/UpdateGate.cs` (o App Installer atualiza o MSIX sozinho; a casca só adia a reinicialização enquanto `Shell.Busy`, por `AppInstance.Restart` depois do ocupado cair), `shell/win/docs/medicao.md`
- Modify: `docs/MACOS.md` (seção "Casca nativa no Windows", ou mover para um `docs/NATIVO.md` novo com as duas cascas, decisão de quem constrói), `CLAUDE.md` (mapa: `shell/win/`)

- [ ] **Step 1:** teste unitário do gate (`UpdateGate.MayRestart(Shell)` → `!Busy`).
- [ ] **Step 2:** Medir memória privada (Working Set privado) de todos os processos (`Farol.exe`, `node.exe`, `msedgewebview2.exe` e filhos) parado por 10 min com as contas reais; registrar em `medicao.md` ao lado do Electron. Critério do desenho para o Windows: medir e registrar (decisão do dono, seção 8 item 0).
- [ ] **Step 3:** `dotnet test` e `dotnet format --verify-no-changes` verdes; `npm test` do motor intocado.
- [ ] **Step 4: Commit** `feat(casca-win): gate de update, medição e documentação` e abrir o PR de `feat/casca-win` para `main`.
