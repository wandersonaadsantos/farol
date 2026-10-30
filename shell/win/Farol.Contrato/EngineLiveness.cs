namespace Farol.Contrato;

/// <summary>
/// No boot, o <c>casca.json</c> que já estava lá é de um motor vivo? Só quando o pid ainda
/// existe E a porta responde como Farol: pid reaproveitado pelo sistema, ou porta tomada por
/// outro programa, não fazem a casca virar visor.
/// </summary>
public static class EngineLiveness
{
    /// <summary>
    /// Sem arquivo não pergunta nada; pid morto não chega a sondar a porta. Sonda que lança
    /// conta como não.
    /// </summary>
    public static async Task<bool> IsAliveAsync(EngineFile? file, Func<int, bool> pidAlive, Func<int, Task<bool>> portIsFarol)
    {
        ArgumentNullException.ThrowIfNull(pidAlive);
        ArgumentNullException.ThrowIfNull(portIsFarol);
        if (file is null)
        {
            return false;
        }
        try
        {
            return pidAlive(file.Pid) && await portIsFarol(file.Port).ConfigureAwait(false);
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// <summary>
    /// A entrada <see cref="SidecarInput.Boot"/>: o <c>casca.json</c> vivo vale primeiro; sem ele,
    /// um Farol que responda na porta padrão (um Electron ou um <c>node server.js</c>, que não
    /// gravam <c>casca.json</c>) conta como motor vivo ali, e a casca vira visor em vez de lançar
    /// um motor que morreria com <c>EADDRINUSE</c>. A casca não lê a config do motor: outra porta
    /// configurada cai no <see cref="BusyPort"/> depois da primeira saída.
    /// </summary>
    public static async Task<SidecarInput.Boot> BootAsync(EngineFile? existing, Func<int, bool> pidAlive, Func<int, Task<bool>> portIsFarol)
    {
        if (await IsAliveAsync(existing, pidAlive, portIsFarol).ConfigureAwait(false))
        {
            return new SidecarInput.Boot(existing, true);
        }
        bool other;
        try
        {
            other = await portIsFarol(EngineDefaults.Port).ConfigureAwait(false);
        }
        catch (Exception)
        {
            other = false;
        }
        return other
            ? new SidecarInput.Boot(PortOnly(EngineDefaults.Port), true)
            : new SidecarInput.Boot(existing, false);
    }

    // Um motor que a casca só conhece pela porta: sem pid nem código (o visor não pareia).
    private static EngineFile PortOnly(int port) => new(port, 0, "", "", DateTimeOffset.UnixEpoch, null);
}
