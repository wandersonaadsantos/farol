using System.Diagnostics;
using Farol.Contrato;
using Farol.Sidecar;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;
using Microsoft.Windows.AppNotifications;

namespace Farol.App;

/// <summary>
/// A única peça que conhece todas as outras: liga a <see cref="SidecarMachine"/> ao processo do
/// motor, ao pareamento, ao cofre do token, ao SSE, à janela, à bandeja, ao overlay, ao autostart
/// e aos avisos. Não decide fase nenhuma: executa os efeitos que a máquina devolve e devolve a
/// ela o que aconteceu.
/// </summary>
/// <remarks>
/// Tudo roda na thread da interface: a máquina não é segura entre threads, e cada efeito longo
/// (esperar o arquivo, parear, religar) é uma tarefa que devolve o resultado pela fila do
/// <see cref="DispatcherQueue"/>, nunca chamando a máquina de dentro de outro efeito. Toda tarefa
/// em segundo plano tem o próprio <c>try/catch</c> com log.
/// </remarks>
internal sealed class Composition
{
    private static readonly TimeSpan EngineFileTimeout = TimeSpan.FromSeconds(30);

    private readonly MainWindow _window;
    private readonly DispatcherQueue _dispatcher;
    private readonly string _home;
    private readonly string _engineFile;
    private readonly ShellLog _shellLog;
    private readonly Notifier _notifier;
    private readonly TokenStore _tokens = new();
    private readonly TaskbarOverlay _overlay;
    private readonly Autostart _autostart;
    private readonly EngineProcess _engine;

    private SidecarMachine _machine = new();
    private TrayIcon? _tray;
    private CancellationTokenSource _wait = new();
    private DateTimeOffset _spawnedAt;

    private EventStream? _stream;
    private string? _token;

    // A prova do pareamento em curso: o token só conta como aceito quando o fluxo novo entrega o
    // primeiro retrato casca. A geração muda a cada Pair e a cada saída do motor, e resultado de
    // geração velha nunca chega à máquina.
    private PairingProof? _proof;
    private EventStream? _proofStream;
    private string _proofCode = "";
    private int _proofPort;
    private CancellationTokenSource? _proofTimer;
    private int _pairGeneration;
    private int _port;
    private bool _viewer;

    private bool _silent;
    private bool _windowShown;
    private bool _firstOpenDone;
    private bool _attachPending;
    private int _attachedPort;
    private string? _attachedToken;

    private ShellEvent.Shell? _lastShell;
    private bool? _autostartApplied;
    private bool _engineRestarted;
    private bool _repairing;
    private bool _quitting;

    /// <param name="window">A janela principal, já criada e ainda não mostrada.</param>
    /// <param name="home">O home em uso (<see cref="FarolPaths.Home"/>).</param>
    /// <param name="engineHome">
    /// O home a passar ao motor em <c>FAROL_HOME</c>, ou <c>null</c> para ele usar o padrão.
    /// </param>
    /// <param name="shellVersion">A versão da casca, em <c>X.Y.Z</c>.</param>
    public Composition(MainWindow window, string home, string? engineHome, string shellVersion)
    {
        _window = window;
        _dispatcher = window.DispatcherQueue;
        _home = home;
        _engineFile = FarolPaths.EngineFilePath(home);
        _shellLog = new ShellLog(FarolPaths.ShellLogFile(home));
        _notifier = new Notifier(_dispatcher, new WindowPresenter(window), Log);
        _overlay = new TaskbarOverlay(Log);
        _autostart = new Autostart(Log);
        var (nodeExe, serverJs) = EngineLocator.Bundled();
        _engine = new EngineProcess(nodeExe, serverJs, engineHome, shellVersion, Log);
    }

    /// <summary>
    /// O último retrato <c>casca</c> do motor, ou <c>null</c> antes do primeiro. O gate de update
    /// lê o <see cref="ShellEvent.Shell.Busy"/> daqui.
    /// </summary>
    public ShellEvent.Shell? LastShell => _lastShell;

    /// <summary>
    /// Liga tudo. Com <paramref name="silentVersion"/> (a reabertura silenciosa depois de um
    /// update), a janela não aparece: o Farol fica na bandeja e avisa "Farol atualizado".
    /// </summary>
    public void Start(string? silentVersion)
    {
        _notifier.Register();
        _window.Activated += OnWindowActivated;
        CreateTray();
        if (!EngineLocator.Found())
        {
            Log("WARN o motor embutido não está no pacote (engine\\node\\node.exe e engine\\app\\server.js)");
        }

        // Sem bandeja, um Farol que não mostra a janela ficaria invisível e sem saída.
        _silent = silentVersion is not null && _tray is not null;
        if (silentVersion is not null)
        {
            _notifier.Post(ShellNotices.Updated(silentVersion));
        }
        if (!_silent)
        {
            _window.ShowStarting();
            ShowWindow();
        }

        _ = WatchExitsAsync();
        _ = BootAsync();
    }

    /// <summary>
    /// O caminho único de toda ativação: a fria (<paramref name="redirected"/> falso) e a que uma
    /// segunda instância redirecionou para cá. Clique num aviso vai ao <see cref="Notifier"/>; a
    /// abertura redirecionada mostra a janela. A abertura fria comum não faz nada aqui: quem
    /// decide se a janela aparece no boot é o <see cref="Start"/>.
    /// </summary>
    public void HandleActivation(AppActivationArguments args, bool redirected)
    {
        ArgumentNullException.ThrowIfNull(args);
        if (args.Kind == ExtendedActivationKind.AppNotification
            && args.Data is AppNotificationActivatedEventArgs notification)
        {
            _notifier.HandleActivation(notification);
            return;
        }
        if (redirected)
        {
            OnUi(ShowWindow);
        }
    }

    // ---------- a máquina ----------

    private async Task BootAsync()
    {
        try
        {
            _machine = new SidecarMachine();
            var existing = EngineFile.Read(_engineFile);
            var alive = await EngineLiveness.IsAliveAsync(
                existing,
                EngineProbe.IsProcessAlive,
                port => EngineProbe.IsFarolAsync(port));
            Feed(new SidecarInput.Boot(existing, alive));
        }
        catch (Exception e)
        {
            Log($"WARN boot da casca falhou ({e.GetType().Name})");
        }
    }

    // Só na thread da interface, e nunca de dentro de um efeito: resultado de efeito volta por Post.
    private void Feed(SidecarInput input)
    {
        if (_quitting)
        {
            return;
        }
        if (input is SidecarInput.Exited exited)
        {
            // O motor que saiu não vai gravar o arquivo nem provar token: as esperas acabam aqui.
            _wait.Cancel();
            AbandonProof();
            _engineRestarted = true;
            if (exited.Code == 0)
            {
                Log("WARN o motor saiu com 0 sem a casca pedir; ele não é religado");
            }
        }
        IReadOnlyList<SidecarEffect> effects;
        try
        {
            effects = _machine.On(input);
        }
        catch (Exception e)
        {
            Log($"WARN a máquina recusou {input.GetType().Name} ({e.GetType().Name})");
            return;
        }
        foreach (var effect in effects)
        {
            try
            {
                Run(effect);
            }
            catch (Exception e)
            {
                // Um efeito que lança não pode levar os seguintes nem o processo junto.
                Log($"WARN efeito {effect.GetType().Name} falhou ({e.GetType().Name})");
            }
        }
    }

    private void Post(SidecarInput input)
    {
        if (!_dispatcher.TryEnqueue(() => Feed(input)))
        {
            Log($"WARN casca encerrando: {input.GetType().Name} descartado");
        }
    }

    private void Run(SidecarEffect effect)
    {
        switch (effect)
        {
            case SidecarEffect.Spawn:
                _ = SpawnAsync();
                break;
            case SidecarEffect.WaitFile:
                _ = WaitFileAsync(NewWait());
                break;
            case SidecarEffect.Pair pair:
                _ = PairAsync(pair.Code, pair.Port);
                break;
            case SidecarEffect.OpenWindow open:
                OpenWindow(open.Port, open.Viewer);
                break;
            case SidecarEffect.ShowViewerNotice:
                _notifier.Post(ShellNotices.Viewer);
                break;
            case SidecarEffect.Restart restart:
                _ = RestartAsync(restart.After, NewWait());
                break;
            case SidecarEffect.ShowFailure failure:
                ShowFailure(failure.Message);
                break;
        }
    }

    private CancellationToken NewWait()
    {
        _wait.Cancel();
        _wait = new CancellationTokenSource();
        return _wait.Token;
    }

    // ---------- o processo do motor ----------

    // Um laço só para a vida toda da casca: o canal de códigos tem um consumidor.
    private async Task WatchExitsAsync()
    {
        try
        {
            await foreach (var code in _engine.ExitCodes)
            {
                if (_quitting)
                {
                    return;
                }
                Post(new SidecarInput.Exited(code));
            }
        }
        catch (Exception e)
        {
            Log($"WARN leitura das saídas do motor parou ({e.GetType().Name})");
        }
    }

    private async Task<bool> SpawnAsync()
    {
        _spawnedAt = DateTimeOffset.UtcNow;
        try
        {
            await _engine.StartAsync();
            return true;
        }
        catch (Exception e)
        {
            // Sem processo não há código de saída: a falha entra na máquina como uma saída.
            Log($"WARN o motor não subiu ({e.GetType().Name}: {e.Message})");
            Post(new SidecarInput.Exited(-1));
            return false;
        }
    }

    private async Task WaitFileAsync(CancellationToken ct)
    {
        try
        {
            var file = await EngineProbe.WaitForEngineFileAsync(_engineFile, EngineFileTimeout, _spawnedAt, ct);
            if (!ct.IsCancellationRequested)
            {
                Post(new SidecarInput.FileAppeared(file));
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // O motor saiu antes de gravar, ou um religamento tomou o lugar desta espera.
        }
        catch (TimeoutException)
        {
            // Prazo do arquivo conta como falha do motor, com a mesma política de recuo e parada.
            Log($"WARN o motor não gravou o casca.json em {EngineFileTimeout.TotalSeconds:0} s; encerrado para religar");
            await StopForRestartAsync();
        }
        catch (Exception e)
        {
            Log($"WARN espera do casca.json falhou ({e.GetType().Name})");
        }
    }

    // O processo morto devolve o próprio código pelo canal, e é ele que vira Exited; só sem
    // processo (ou com um que não morre) a saída é anunciada aqui.
    private async Task StopForRestartAsync()
    {
        try
        {
            if (_engine.IsRunning)
            {
                await _engine.StopAsync();
                if (!_engine.IsRunning)
                {
                    return;
                }
            }
        }
        catch (Exception e)
        {
            Log($"WARN encerrar o motor travado falhou ({e.GetType().Name})");
        }
        Post(new SidecarInput.Exited(-1));
    }

    private async Task RestartAsync(double afterSeconds, CancellationToken ct)
    {
        try
        {
            if (afterSeconds > 0)
            {
                await Task.Delay(TimeSpan.FromSeconds(afterSeconds), ct);
            }
            // O StartAsync já apaga o casca.json do motor anterior antes de subir.
            if (!ct.IsCancellationRequested && await SpawnAsync())
            {
                await WaitFileAsync(ct);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
        }
        catch (Exception e)
        {
            Log($"WARN religar o motor falhou ({e.GetType().Name})");
        }
    }

    // ---------- pareamento e eventos ----------

    // Token guardado vale primeiro; o código do casca.json só é gasto sem token, ou quando o
    // motor recusa o guardado. Paired só sai quando o motor responde (BeginProof).
    private async Task PairAsync(string code, int port)
    {
        AbandonProof();
        var generation = _pairGeneration;
        try
        {
            _port = port;
            var stored = LoadToken();
            var token = stored;
            if (token is null)
            {
                token = await TryPairAsync(port, code);
                if (generation != _pairGeneration)
                {
                    return;
                }
                if (token is not null)
                {
                    SaveToken(token);
                }
            }
            if (token is null)
            {
                _token = null;
                StopStream();
                PostPairing(new SidecarInput.PairFailed(), generation);
                return;
            }
            _token = token;
            BeginProof(new PairingProof(tokenFromStore: stored is not null), code, port, token, generation);
        }
        catch (Exception e)
        {
            Log($"WARN pareamento falhou ({e.GetType().Name})");
            PostPairing(new SidecarInput.PairFailed(), generation);
        }
    }

    // Um fluxo NOVO para cada prova: conexão fresca, sem o recuo de um fluxo antigo.
    private void BeginProof(PairingProof proof, string code, int port, string token, int generation)
    {
        _proof = proof;
        _proofCode = code;
        _proofPort = port;
        _proofStream = StartStream(port, token);
        ArmProofTimer(proof, generation);
    }

    private void ArmProofTimer(PairingProof proof, int generation)
    {
        _proofTimer?.Cancel();
        _proofTimer = new CancellationTokenSource();
        _ = ProofTimeoutAsync(proof, generation, _proofTimer.Token);
    }

    private async Task ProofTimeoutAsync(PairingProof proof, int generation, CancellationToken ct)
    {
        try
        {
            await Task.Delay(PairingProof.Timeout, ct);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        if (generation != _pairGeneration || !ReferenceEquals(proof, _proof))
        {
            return;
        }
        if (proof.OnTimeout() == ProofStep.Failed)
        {
            // Sem resposta não é recusa: o token e o fluxo ficam, e se o motor responder depois
            // a janela já está com ele.
            Log($"WARN o motor não respondeu ao pareamento em {PairingProof.Timeout.TotalSeconds:0} s");
            PostPairing(new SidecarInput.PairFailed(), generation);
        }
    }

    private bool IsProving(EventStream stream) =>
        _proof is { Settled: false } && ReferenceEquals(stream, _proofStream);

    private void OnProofShell()
    {
        if (_proof?.OnShell() == ProofStep.Proven)
        {
            _proofTimer?.Cancel();
            PostPairing(new SidecarInput.Paired(), _pairGeneration);
        }
    }

    private async Task OnProofRefusedAsync()
    {
        var proof = _proof;
        var generation = _pairGeneration;
        if (proof is null)
        {
            return;
        }
        try
        {
            var step = proof.OnUnauthorized();
            if (step == ProofStep.None)
            {
                return;
            }
            StopStream();
            _token = null;
            DeleteToken();
            if (step == ProofStep.Failed)
            {
                _proofTimer?.Cancel();
                PostPairing(new SidecarInput.PairFailed(), generation);
                return;
            }
            var token = await TryPairAsync(_proofPort, _proofCode);
            if (generation != _pairGeneration || !ReferenceEquals(proof, _proof))
            {
                return;
            }
            if (token is null)
            {
                proof.Abandon();
                _proofTimer?.Cancel();
                PostPairing(new SidecarInput.PairFailed(), generation);
                return;
            }
            SaveToken(token);
            _token = token;
            proof.OnPairedWithCode();
            _proofStream = StartStream(_proofPort, token);
            ArmProofTimer(proof, generation);
        }
        catch (Exception e)
        {
            Log($"WARN novo pareamento falhou ({e.GetType().Name})");
            PostPairing(new SidecarInput.PairFailed(), generation);
        }
    }

    private void AbandonProof()
    {
        _pairGeneration++;
        _proof?.Abandon();
        _proof = null;
        _proofStream = null;
        _proofTimer?.Cancel();
        _proofTimer = null;
    }

    // Paired e PairFailed só valem para o pareamento em que nasceram.
    private void PostPairing(SidecarInput input, int generation)
    {
        if (!_dispatcher.TryEnqueue(() =>
        {
            if (generation == _pairGeneration)
            {
                Feed(input);
            }
        }))
        {
            Log($"WARN casca encerrando: {input.GetType().Name} descartado");
        }
    }

    private async Task<string?> TryPairAsync(int port, string code)
    {
        if (string.IsNullOrEmpty(code))
        {
            return null;
        }
        try
        {
            return await Pairing.PairAsync(port, code);
        }
        catch (PairingException e)
        {
            Log($"WARN o motor recusou o pareamento ({e.Code})");
        }
        catch (Exception e)
        {
            Log($"WARN pareamento sem resposta do motor ({e.GetType().Name})");
        }
        return null;
    }

    private EventStream StartStream(int port, string token)
    {
        _stream?.Stop();
        var stream = new EventStream(port, token, Log);
        _stream = stream;
        stream.Start();
        _ = ReadEventsAsync(stream);
        return stream;
    }

    private void StopStream()
    {
        _stream?.Stop();
        _stream = null;
    }

    private async Task ReadEventsAsync(EventStream stream)
    {
        try
        {
            await foreach (var e in stream.Events)
            {
                OnUi(() => OnEvent(stream, e));
            }
        }
        catch (Exception e)
        {
            Log($"WARN leitura dos eventos do motor parou ({e.GetType().Name})");
        }
    }

    private void OnEvent(EventStream stream, ShellEvent e)
    {
        if (_quitting || !ReferenceEquals(stream, _stream))
        {
            return;
        }
        try
        {
            switch (e)
            {
                case ShellEvent.Shell shell:
                    // O primeiro retrato do fluxo novo é a prova de que o motor aceitou o token.
                    if (IsProving(stream))
                    {
                        OnProofShell();
                    }
                    ApplyShell(shell);
                    break;
                case ShellEvent.Notice notice:
                    _notifier.Post(notice);
                    break;
                case ShellEvent.Exit exit:
                    // O motor vai sair com 75 e a máquina religa na hora pelo Exited(75).
                    Debug.WriteLine($"casca: o motor vai sair ({exit.Reason}, próxima versão {exit.NextVersion ?? "nenhuma"})");
                    break;
                case ShellEvent.Unauthorized:
                    _ = IsProving(stream) ? OnProofRefusedAsync() : RepairAsync(stream);
                    break;
            }
        }
        catch (Exception ex)
        {
            Log($"WARN evento {e.GetType().Name} não foi aplicado ({ex.GetType().Name})");
        }
    }

    // O motor recusou, depois da prova, um token que já tinha aceitado (sessões revogadas, por
    // exemplo): ele sai do cofre e a casca pareia de novo com o código do casca.json. Sem código (ou recusado), a janela fica sem token e a interface mostra o
    // painel de pareamento.
    private async Task RepairAsync(EventStream stream)
    {
        if (_repairing || !ReferenceEquals(stream, _stream))
        {
            return;
        }
        _repairing = true;
        try
        {
            StopStream();
            _token = null;
            DeleteToken();
            var file = EngineFile.Read(_engineFile);
            if (file is not null && await TryPairAsync(file.Port, file.PairingCode) is { } token)
            {
                SaveToken(token);
                _token = token;
                _port = file.Port;
                StartStream(file.Port, token);
            }
            await RefreshWindowTokenAsync();
        }
        catch (Exception e)
        {
            Log($"WARN novo pareamento falhou ({e.GetType().Name})");
        }
        finally
        {
            _repairing = false;
        }
    }

    private void ApplyShell(ShellEvent.Shell shell)
    {
        _lastShell = shell;
        if (_window.IsAttached)
        {
            _window.Web.Apply(shell);
        }
        else
        {
            _window.ApplyColors(shell.ColorBg, shell.ColorSymbol);
        }
        _overlay.Apply(_window.Hwnd, shell);
        _tray?.SetTooltip(OverlayLabel.Tooltip(shell));
        if (_autostartApplied != shell.Autostart)
        {
            _autostartApplied = shell.Autostart;
            _ = ApplyAutostartAsync(shell.Autostart);
        }
    }

    private async Task ApplyAutostartAsync(bool wanted)
    {
        try
        {
            await _autostart.ApplyAsync(wanted);
        }
        catch (Exception e)
        {
            Log($"WARN autostart não foi aplicado ({e.GetType().Name})");
        }
    }

    // ---------- a janela ----------

    // A primeira abertura mostra a janela (salvo a reabertura silenciosa); as seguintes, depois
    // de um motor religado, só põem a interface de volta, sem roubar o foco de quem trabalha.
    private void OpenWindow(int port, bool viewer)
    {
        _port = port;
        _viewer = viewer;
        NotifyUpdateIfRestarted();
        if (_window.IsAttached)
        {
            _window.RestoreEngineView();
            if (port != _attachedPort)
            {
                Log($"WARN o motor voltou noutra porta ({port}); a janela segue na {_attachedPort} até reabrir o Farol");
            }
            _ = RefreshWindowTokenAsync();
            return;
        }
        _attachPending = true;
        var first = !_firstOpenDone;
        _firstOpenDone = true;
        if (first && !_silent)
        {
            ShowWindow();
            return;
        }
        // Na bandeja, o WebView2 só nasce quando a janela aparecer pela primeira vez.
        EnsureAttached();
    }

    private void EnsureAttached()
    {
        if (!_attachPending || !_windowShown)
        {
            return;
        }
        _attachPending = false;
        // O visor não tem token: a interface pareia pelo próprio painel.
        _ = AttachAsync(_port, _viewer ? null : _token);
    }

    private async Task AttachAsync(int port, string? token)
    {
        try
        {
            await _window.AttachEngineAsync(port, token, FarolPaths.WebViewDataFolder(_home));
            _attachedPort = port;
            _attachedToken = token;
            if (_lastShell is { } shell)
            {
                _window.Web.Apply(shell);
            }
            // O token pode ter mudado enquanto o WebView2 subia.
            await RefreshWindowTokenAsync();
        }
        catch (Exception e)
        {
            Log($"WARN a janela não ligou ao motor ({e.GetType().Name})");
            // A próxima vez que a janela aparecer tenta de novo.
            _attachPending = true;
        }
    }

    // Só depois do Attach concluído (o UpdateTokenAsync exige o WebView2 de pé).
    private async Task RefreshWindowTokenAsync()
    {
        if (_viewer || !_window.IsAttached || _attachedToken == _token)
        {
            return;
        }
        try
        {
            var token = _token;
            await _window.Web.UpdateTokenAsync(token);
            _attachedToken = token;
            _window.Web.Reload();
        }
        catch (Exception e)
        {
            Log($"WARN a janela não recebeu o token novo ({e.GetType().Name})");
        }
    }

    private void ShowWindow()
    {
        _window.ShowAndActivate();
        MarkShown();
    }

    private void OnWindowActivated(object sender, WindowActivatedEventArgs args)
    {
        if (args.WindowActivationState != WindowActivationState.Deactivated)
        {
            MarkShown();
        }
    }

    // Toda volta da janela: o botão da barra de tarefas some com ela escondida e o evento casca
    // só chega quando muda, então o overlay é reaplicado com o último retrato.
    private void MarkShown()
    {
        _windowShown = true;
        if (_lastShell is { } shell)
        {
            _overlay.Apply(_window.Hwnd, shell);
        }
        EnsureAttached();
    }

    private void ShowFailure(string reason)
    {
        Log($"WARN a casca desistiu do motor: {reason}");
        // A tela da falha não pode ser trocada por um WebView2 apontado para um motor morto.
        _attachPending = false;
        _notifier.Post(ShellNotices.Failure(reason));
        _window.ShowFailure(ShellNotices.FailureText(reason), Retry);
        ShowWindow();
    }

    // "Tentar de novo": máquina nova e o boot inteiro de novo (a parada não volta sozinha).
    private void Retry()
    {
        if (_quitting)
        {
            return;
        }
        if (!_window.IsAttached)
        {
            _window.ShowStarting();
        }
        _ = BootAsync();
    }

    // Toda volta do motor depois de uma saída: o update no modo casca grava o marcador e sai com
    // 75, e a casca não reinicia. O marcador sai do disco aqui, senão a próxima abertura manual
    // dentro de 10 min subiria escondida na bandeja. O primeiro boot já o consumiu no App.
    private void NotifyUpdateIfRestarted()
    {
        if (!_engineRestarted)
        {
            return;
        }
        _engineRestarted = false;
        if (SilentReopen.Consume(FarolPaths.EngineStateDir(_home)) is { } version)
        {
            _notifier.Post(ShellNotices.Updated(version));
        }
    }

    // ---------- bandeja ----------

    private void CreateTray()
    {
        try
        {
            var tray = new TrayIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "farol.ico"), Log);
            tray.Open += ShowWindow;
            tray.CheckNow += () => _ = CheckNowAsync();
            tray.Quit += () => _ = QuitAsync();
            _tray = tray;
        }
        catch (Exception e)
        {
            Log($"WARN bandeja indisponível ({e.GetType().Name})");
        }
    }

    private async Task CheckNowAsync()
    {
        try
        {
            if (_viewer || _token is null)
            {
                Log("WARN checar agora: sem token deste motor (visor ou sem pareamento)");
                return;
            }
            if (!await EngineCommands.CheckNowAsync(_port, _token))
            {
                Log("WARN checar agora: o motor não aceitou o pedido");
            }
        }
        catch (Exception e)
        {
            Log($"WARN checar agora falhou ({e.GetType().Name})");
        }
    }

    // Sair é só pela bandeja: fecha o SSE, encerra o motor (o do visor não é nosso e fica),
    // tira o ícone e o registro dos avisos, e só então encerra o processo.
    private async Task QuitAsync()
    {
        if (_quitting)
        {
            return;
        }
        _quitting = true;
        _wait.Cancel();
        AbandonProof();
        try
        {
            StopStream();
            await _engine.StopAsync();
        }
        catch (Exception e)
        {
            Log($"WARN encerrar o motor na saída falhou ({e.GetType().Name})");
        }
        _engine.Dispose();
        _tray?.Dispose();
        _tray = null;
        _overlay.Dispose();
        _notifier.Unregister();
        _window.HideOnClose = false;
        Application.Current.Exit();
    }

    // ---------- apoio ----------

    private void OnUi(Action action)
    {
        if (_dispatcher.HasThreadAccess)
        {
            action();
            return;
        }
        if (!_dispatcher.TryEnqueue(() => action()))
        {
            Log("WARN casca encerrando: ação da interface descartada");
        }
    }

    private string? LoadToken()
    {
        try
        {
            return _tokens.Load();
        }
        catch (Exception e)
        {
            Log($"WARN cofre: token não foi lido ({e.GetType().Name})");
            return null;
        }
    }

    private void SaveToken(string token)
    {
        try
        {
            _tokens.Save(token);
        }
        catch (Exception e)
        {
            // Sem o cofre o token vale só nesta execução; o próximo boot pareia de novo.
            Log($"WARN cofre: token não foi guardado ({e.GetType().Name})");
        }
    }

    private void DeleteToken()
    {
        try
        {
            _tokens.Delete();
        }
        catch (Exception e)
        {
            Log($"WARN cofre: token recusado não foi apagado ({e.GetType().Name})");
        }
    }

    // Só falha chega aqui (invariante 3), e nunca segredo.
    private void Log(string message)
    {
        Debug.WriteLine(message);
        _shellLog.Write(message);
    }
}
