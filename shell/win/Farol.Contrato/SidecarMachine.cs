namespace Farol.Contrato;

/// <summary>A fase em que a casca está em relação ao motor.</summary>
public abstract record SidecarPhase
{
    private SidecarPhase()
    {
    }

    /// <summary>Antes do boot.</summary>
    public sealed record Starting : SidecarPhase;

    /// <summary>O motor foi lançado e a casca espera o <c>casca.json</c>.</summary>
    public sealed record WaitingForFile : SidecarPhase;

    /// <summary>A casca está trocando o código de pareamento por um token.</summary>
    public sealed record Pairing : SidecarPhase;

    /// <summary>O motor está de pé na porta <see cref="Port"/> e a janela está aberta.</summary>
    public sealed record Ready(int Port) : SidecarPhase;

    /// <summary>
    /// Já havia um motor vivo na porta <see cref="Port"/> (por exemplo um Electron antigo):
    /// a casca só mostra a tela e nunca lança nem religa motor.
    /// </summary>
    public sealed record Viewer(int Port) : SidecarPhase;

    /// <summary>O motor saiu e será religado em <see cref="InSeconds"/> segundos.</summary>
    public sealed record Restarting(double InSeconds) : SidecarPhase;

    /// <summary>A casca não religa mais o motor.</summary>
    public sealed record Stopped(string Reason) : SidecarPhase;
}

/// <summary>O que acontece com a casca e o motor.</summary>
public abstract record SidecarInput
{
    private SidecarInput()
    {
    }

    /// <summary>A casca abriu; <see cref="Existing"/> é o <c>casca.json</c> que já estava lá.</summary>
    public sealed record Boot(EngineFile? Existing, bool EngineAlive) : SidecarInput;

    /// <summary>O motor gravou o <c>casca.json</c>.</summary>
    public sealed record FileAppeared(EngineFile File) : SidecarInput;

    /// <summary>O pareamento deu certo.</summary>
    public sealed record Paired : SidecarInput;

    /// <summary>O pareamento falhou.</summary>
    public sealed record PairFailed : SidecarInput;

    /// <summary>O processo do motor saiu com <see cref="Code"/>.</summary>
    public sealed record Exited(int Code) : SidecarInput;

    /// <summary>
    /// O motor lançado saiu com <see cref="ExitCode"/> porque outro Farol já ocupa a
    /// <see cref="Port"/> (o <c>EADDRINUSE</c> do stderr, conferido pela sonda): esperando o
    /// arquivo ou religando, no lugar da saída a casca vira visor. Com um motor já de pé
    /// (pareando ou pronto) é a saída que é (<see cref="SidecarMachine.Resolve"/>).
    /// </summary>
    public sealed record PortTaken(int Port, int ExitCode) : SidecarInput;

    /// <summary>
    /// O motor ficou de pé por <see cref="SidecarMachine.StabilityWindow"/> sem sair: as falhas
    /// seguidas zeram. A composição entrega depois do <see cref="FileAppeared"/>.
    /// </summary>
    public sealed record Stable : SidecarInput;

    /// <summary>
    /// O Farol de que a casca era visor parou de responder na porta: a casca volta a ser casca
    /// e lança o próprio motor.
    /// </summary>
    public sealed record ViewerLost : SidecarInput;
}

/// <summary>O que a composição da casca precisa fazer.</summary>
public abstract record SidecarEffect
{
    private SidecarEffect()
    {
    }

    /// <summary>Lançar o motor.</summary>
    public sealed record Spawn : SidecarEffect;

    /// <summary>Esperar o <c>casca.json</c>.</summary>
    public sealed record WaitFile : SidecarEffect;

    /// <summary>Parear com o código <see cref="Code"/> na porta <see cref="Port"/>.</summary>
    public sealed record Pair(string Code, int Port) : SidecarEffect;

    /// <summary>Abrir a janela na porta <see cref="Port"/>, como visor ou não.</summary>
    public sealed record OpenWindow(int Port, bool Viewer) : SidecarEffect;

    /// <summary>Avisar que a casca é só visor de um motor que ela não lançou.</summary>
    public sealed record ShowViewerNotice : SidecarEffect;

    /// <summary>Religar o motor depois de <see cref="After"/> segundos.</summary>
    public sealed record Restart(double After) : SidecarEffect;

    /// <summary>Mostrar a falha que fez a casca desistir.</summary>
    public sealed record ShowFailure(string Message) : SidecarEffect;
}

/// <summary>
/// A máquina de estados do motor sidecar. Não toca processo, arquivo nem rede: recebe o que
/// aconteceu e devolve os efeitos que a composição executa. Entrada fora de lugar devolve
/// lista vazia e não muda a fase; nunca lança.
/// </summary>
public sealed class SidecarMachine
{
    private static readonly IReadOnlyList<SidecarEffect> None = [];

    /// <summary>
    /// Quanto o motor fica de pé, sem sair, para as falhas seguidas zerarem: o mesmo da casca Mac.
    /// </summary>
    public static readonly TimeSpan StabilityWindow = TimeSpan.FromSeconds(60);

    private int _port;

    /// <summary>A fase atual.</summary>
    public SidecarPhase Phase { get; private set; } = new SidecarPhase.Starting();

    /// <summary>
    /// Falhas seguidas do motor. Pareamento não zera (um motor que pareia e morre logo depois
    /// continua contando para a desistência); quem zera é o <see cref="SidecarInput.Stable"/>.
    /// </summary>
    public int ConsecutiveFailures { get; private set; }

    /// <summary>A casca desistiu do motor e mostra a tela de falha, até o "Tentar de novo".</summary>
    public bool GaveUp => Phase is SidecarPhase.Stopped;

    /// <summary>
    /// O motor que esta entrada encerra não vai gravar o arquivo nem ficar de pé: as esperas
    /// por ele (o arquivo, a janela de estabilidade) acabam aqui.
    /// </summary>
    public static bool EndsEngineWaits(SidecarInput input) =>
        input is SidecarInput.Exited or SidecarInput.PortTaken;

    /// <summary>
    /// A entrada como ela vale na fase atual: um <see cref="SidecarInput.PortTaken"/> com o motor
    /// já de pé (pareando ou pronto) não é outro Farol na porta, é o motor que caiu, e vira a
    /// saída de onde veio. O resto passa igual. A composição pergunta antes de cuidar da saída.
    /// </summary>
    public SidecarInput Resolve(SidecarInput input) =>
        input is SidecarInput.PortTaken taken && Phase is SidecarPhase.Pairing or SidecarPhase.Ready
            ? new SidecarInput.Exited(taken.ExitCode)
            : input;

    /// <summary>Aplica <paramref name="input"/> e devolve os efeitos a executar.</summary>
    public IReadOnlyList<SidecarEffect> On(SidecarInput input) => (Resolve(input), Phase) switch
    {
        (SidecarInput.Boot boot, SidecarPhase.Starting) => OnBoot(boot),
        (SidecarInput.FileAppeared appeared, SidecarPhase.WaitingForFile or SidecarPhase.Restarting) => OnFile(appeared.File),
        (SidecarInput.Paired or SidecarInput.PairFailed, SidecarPhase.Pairing) => OnPaired(),
        (SidecarInput.Stable, SidecarPhase.Pairing or SidecarPhase.Ready) => OnStable(),
        (SidecarInput.Exited exited, not (SidecarPhase.Viewer or SidecarPhase.Stopped)) => OnExited(exited.Code),
        (SidecarInput.PortTaken taken, SidecarPhase.WaitingForFile or SidecarPhase.Restarting) => OnPortTaken(taken.Port),
        (SidecarInput.ViewerLost, SidecarPhase.Viewer) => OnViewerLost(),
        _ => None,
    };

    private IReadOnlyList<SidecarEffect> OnBoot(SidecarInput.Boot boot)
    {
        // O arquivo de um motor morto é sobra e não vale nada.
        if (boot is { Existing: { } file, EngineAlive: true })
        {
            _port = file.Port;
            Phase = new SidecarPhase.Viewer(file.Port);
            return [new SidecarEffect.OpenWindow(file.Port, true), new SidecarEffect.ShowViewerNotice()];
        }
        Phase = new SidecarPhase.WaitingForFile();
        return [new SidecarEffect.Spawn(), new SidecarEffect.WaitFile()];
    }

    // Não é falha do motor: ele não tem onde abrir, e quem está na porta é outro Farol vivo.
    private IReadOnlyList<SidecarEffect> OnPortTaken(int port)
    {
        _port = port;
        Phase = new SidecarPhase.Viewer(port);
        return [new SidecarEffect.OpenWindow(port, true), new SidecarEffect.ShowViewerNotice()];
    }

    private IReadOnlyList<SidecarEffect> OnFile(EngineFile file)
    {
        _port = file.Port;
        Phase = new SidecarPhase.Pairing();
        return [new SidecarEffect.Pair(file.PairingCode, file.Port)];
    }

    private IReadOnlyList<SidecarEffect> OnPaired()
    {
        // Pareamento que falhou também abre a janela: a ui/ mostra o painel de pareamento.
        Phase = new SidecarPhase.Ready(_port);
        return [new SidecarEffect.OpenWindow(_port, false)];
    }

    private IReadOnlyList<SidecarEffect> OnStable()
    {
        ConsecutiveFailures = 0;
        return None;
    }

    // O outro Farol saiu: a porta ficou livre e a casca sobe o próprio motor, como num boot sem
    // arquivo. O visor nunca contou falha, então o contador segue como estava.
    private IReadOnlyList<SidecarEffect> OnViewerLost()
    {
        _port = 0;
        Phase = new SidecarPhase.WaitingForFile();
        return [new SidecarEffect.Spawn(), new SidecarEffect.WaitFile()];
    }

    private IReadOnlyList<SidecarEffect> OnExited(int code)
    {
        var failures = code is RestartPolicy.IntentionalExit or 0 ? ConsecutiveFailures : ConsecutiveFailures + 1;
        ConsecutiveFailures = failures;
        switch (RestartPolicy.Delay(code, failures))
        {
            case RestartDecision.Immediately:
                Phase = new SidecarPhase.Restarting(0);
                return [new SidecarEffect.Restart(0)];
            case RestartDecision.After after:
                Phase = new SidecarPhase.Restarting(after.Seconds);
                return [new SidecarEffect.Restart(after.Seconds)];
            case RestartDecision.Stop stop:
                Phase = new SidecarPhase.Stopped(stop.Reason);
                // Saída 0 é a casca (ou o Ctrl+C) pedindo o fim: nada a mostrar.
                return code == 0 ? None : [new SidecarEffect.ShowFailure(stop.Reason)];
            default:
                return None;
        }
    }
}
