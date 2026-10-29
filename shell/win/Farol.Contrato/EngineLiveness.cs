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
}
