namespace Farol.Contrato;

/// <summary>O que fazer depois que o motor saiu.</summary>
public abstract record RestartDecision
{
    private RestartDecision()
    {
    }

    /// <summary>Religar na hora (saída de propósito).</summary>
    public sealed record Immediately : RestartDecision;

    /// <summary>Religar depois de esperar <see cref="Seconds"/> segundos.</summary>
    public sealed record After(double Seconds) : RestartDecision;

    /// <summary>Não religar; <see cref="Reason"/> diz por quê.</summary>
    public sealed record Stop(string Reason) : RestartDecision;
}

/// <summary>
/// A política de religar o motor: o código 75 é saída de propósito (update, reinício pedido)
/// e religa na hora; 0 é fim; qualquer outro é falha, com recuo de 1 s, 2 s, 4 s e 8 s, teto
/// de 30 s, e parada na quinta falha seguida.
/// </summary>
public static class RestartPolicy
{
    /// <summary>O código com que o motor sai de propósito e pede para ser religado.</summary>
    public const int IntentionalExit = 75;

    /// <summary>Quantas falhas seguidas fazem a casca desistir.</summary>
    public const int MaxConsecutiveFailures = 5;

    private const double MaxDelaySeconds = 30;

    /// <summary>
    /// Decide o que fazer com a saída <paramref name="exitCode"/>.
    /// <paramref name="consecutiveFailures"/> conta as falhas seguidas INCLUINDO esta
    /// (1 na primeira); é ignorado para 75 e 0.
    /// </summary>
    public static RestartDecision Delay(int exitCode, int consecutiveFailures)
    {
        if (exitCode == IntentionalExit)
        {
            return new RestartDecision.Immediately();
        }
        if (exitCode == 0)
        {
            return new RestartDecision.Stop("encerrado");
        }
        if (consecutiveFailures >= MaxConsecutiveFailures)
        {
            return new RestartDecision.Stop($"o motor não ficou de pé depois de {MaxConsecutiveFailures} tentativas");
        }
        // Com o limite de 5 o maior recuo é 8 s; o teto segue a política escrita e só vale
        // se o limite subir.
        var n = Math.Max(1, consecutiveFailures);
        return new RestartDecision.After(Math.Min(MaxDelaySeconds, Math.Pow(2, n - 1)));
    }
}
