namespace Farol.Contrato;

/// <summary>
/// O gate de update da casca. O App Installer baixa e aplica o MSIX sozinho; o único papel da
/// casca é escolher a hora de reiniciar, e essa hora nunca é no meio de uma revisão
/// (<see cref="ShellEvent.Shell.Busy"/>). Um pedido de reinício feito com o motor ocupado fica
/// guardado e sai no primeiro retrato livre com a janela à frente, uma vez só.
/// </summary>
/// <remarks>
/// Puro e sem relógio: quem pede o reinício e quem entrega os retratos é o adaptador da casca, na
/// thread da interface (a classe não é segura entre threads). Antes do primeiro retrato não se
/// sabe se há revisão em curso, então o pedido espera.
/// </remarks>
public sealed class UpdateGate
{
    private ShellEvent.Shell? _last;
    private bool _pending;
    private bool _released;
    private bool _foreground;

    /// <summary>A casca pode reiniciar com este retrato: o motor não está ocupado.</summary>
    public static bool MayRestart(ShellEvent.Shell shell)
    {
        ArgumentNullException.ThrowIfNull(shell);
        return !shell.Busy;
    }

    /// <summary>
    /// A hora de reiniciar: motor livre E a janela do Farol visível e à frente. O sistema recusa o
    /// <c>AppInstance.Restart</c> de um app fora do primeiro plano (<c>NotInForeground</c>), e o
    /// motor teria sido encerrado à toa; e como só reinicia com a janela à frente, a janela que
    /// volta depois do reinício é a mesma que estava na tela (não rouba o foco de ninguém).
    /// </summary>
    public static bool MayRestartNow(ShellEvent.Shell shell, bool foreground) => MayRestart(shell) && foreground;

    /// <summary>Há um pedido de reinício esperando o motor ficar livre ou a janela vir à frente.</summary>
    public bool Pending => _pending;

    /// <summary>
    /// Entrega um retrato <c>casca</c>. Devolve <c>true</c> quando é a hora de reiniciar (havia
    /// pedido e o retrato está livre); depois disso, nunca mais.
    /// </summary>
    public bool OnShell(ShellEvent.Shell shell)
    {
        ArgumentNullException.ThrowIfNull(shell);
        _last = shell;
        return TryRelease();
    }

    /// <summary>
    /// A janela do Farol veio à frente (<c>true</c>) ou saiu dela. Devolve <c>true</c> quando é a
    /// hora de reiniciar (havia pedido e o último retrato está livre).
    /// </summary>
    public bool OnForeground(bool foreground)
    {
        _foreground = foreground;
        return TryRelease();
    }

    /// <summary>
    /// O reinício liberado não chegou a ser tentado (a janela saiu da frente no meio do caminho):
    /// o motor não foi tocado, e o pedido volta a esperar a próxima vez que a janela vier à frente.
    /// Sem liberação em curso, não faz nada.
    /// </summary>
    public void Defer()
    {
        if (!_released)
        {
            return;
        }
        _released = false;
        _pending = true;
        _foreground = false;
    }

    /// <summary>
    /// Pede o reinício (o App Installer tem versão nova). Devolve <c>true</c> se é para reiniciar
    /// agora; <c>false</c> quando fica adiado (motor ocupado ou sem retrato) ou já foi liberado.
    /// </summary>
    public bool RequestRestart()
    {
        if (_released)
        {
            return false;
        }
        _pending = true;
        return TryRelease();
    }

    /// <summary>
    /// O sistema recusou o reinício liberado. O gate volta ao começo, sem pedido: tentar de novo
    /// a cada retrato derrubaria o motor a cada evento, então só o próximo pedido do App
    /// Installer libera outra tentativa.
    /// </summary>
    public void RestartFailed()
    {
        _released = false;
        _pending = false;
    }

    private bool TryRelease()
    {
        if (!_pending || _released || _last is null || !MayRestartNow(_last, _foreground))
        {
            return false;
        }
        _pending = false;
        _released = true;
        return true;
    }
}
