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
    /// O motor lançado saiu porque outro Farol já ocupa a <see cref="Port"/> (o
    /// <c>EADDRINUSE</c> do stderr, conferido pela sonda): no lugar da saída, a casca vira visor.
    /// </summary>
    public sealed record PortTaken(int Port) : SidecarInput;
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

    private int _port;

    /// <summary>A fase atual.</summary>
    public SidecarPhase Phase { get; private set; } = new SidecarPhase.Starting();

    /// <summary>Falhas seguidas do motor; zera quando um pareamento prova que ele ficou de pé.</summary>
    public int ConsecutiveFailures { get; private set; }

    /// <summary>Aplica <paramref name="input"/> e devolve os efeitos a executar.</summary>
    public IReadOnlyList<SidecarEffect> On(SidecarInput input) => (input, Phase) switch
    {
        (SidecarInput.Boot boot, SidecarPhase.Starting) => OnBoot(boot),
        (SidecarInput.FileAppeared appeared, SidecarPhase.WaitingForFile or SidecarPhase.Restarting) => OnFile(appeared.File),
        (SidecarInput.Paired, SidecarPhase.Pairing) => OnPaired(resetFailures: true),
        (SidecarInput.PairFailed, SidecarPhase.Pairing) => OnPaired(resetFailures: false),
        (SidecarInput.Exited exited, not (SidecarPhase.Viewer or SidecarPhase.Stopped)) => OnExited(exited.Code),
        (SidecarInput.PortTaken taken, SidecarPhase.WaitingForFile or SidecarPhase.Restarting) => OnPortTaken(taken.Port),
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

    private IReadOnlyList<SidecarEffect> OnPaired(bool resetFailures)
    {
        // Pareamento que falhou também abre a janela: a ui/ mostra o painel de pareamento.
        if (resetFailures)
        {
            ConsecutiveFailures = 0;
        }
        Phase = new SidecarPhase.Ready(_port);
        return [new SidecarEffect.OpenWindow(_port, false)];
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
