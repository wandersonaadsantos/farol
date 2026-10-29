namespace Farol.Contrato;

/// <summary>
/// O gate de update da casca. O App Installer baixa e aplica o MSIX sozinho; o único papel da
/// casca é escolher a hora de reiniciar, e essa hora nunca é no meio de uma revisão
/// (<see cref="ShellEvent.Shell.Busy"/>). Um pedido de reinício feito com o motor ocupado fica
/// guardado e sai no primeiro retrato livre, uma vez só.
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

    /// <summary>A casca pode reiniciar com este retrato: o motor não está ocupado.</summary>
    public static bool MayRestart(ShellEvent.Shell shell)
    {
        ArgumentNullException.ThrowIfNull(shell);
        return !shell.Busy;
    }

    /// <summary>Há um pedido de reinício esperando o motor ficar livre.</summary>
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
        if (!_pending || _released || _last is null || !MayRestart(_last))
        {
            return false;
        }
        _pending = false;
        _released = true;
        return true;
    }
}
