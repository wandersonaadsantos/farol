namespace Farol.Contrato;

/// <summary>O estado da tarefa de inicialização, espelho de <c>Windows.ApplicationModel.StartupTaskState</c>.</summary>
public enum StartupState
{
    Disabled,
    DisabledByUser,
    Enabled,
    DisabledByPolicy,
    EnabledByPolicy,
}

/// <summary>A tarefa de inicialização do pacote, atrás de interface para a decisão ser testável sem WinRT.</summary>
public interface IStartupTask
{
    StartupState State { get; }

    Task<StartupState> RequestEnableAsync();

    void Disable();
}

/// <summary>O que a decisão fez (ou por que não fez).</summary>
public enum AutostartOutcome
{
    Unchanged,
    Enabled,
    Disabled,
    RefusedByUser,
    RefusedByPolicy,
}

/// <summary>
/// Aplica o <c>autostart</c> do evento <c>casca</c> à tarefa de inicialização. PURA: o log entra
/// por callback, e lembrar de não repetir o aviso é de quem chama. Nunca lança.
/// </summary>
/// <remarks>
/// <c>DisabledByUser</c> não é pedido de novo: o sistema ignoraria o <c>RequestEnableAsync</c>,
/// e só a pessoa religa em Configurações. Recusa no pedido também não é repetida.
/// </remarks>
public static class AutostartDecision
{
    public const string RefusedByUserWarning =
        "WARN iniciar com o Windows: recusado pelo usuário; religue em Configurações > Aplicativos > Inicialização";

    public const string DisabledByPolicyWarning =
        "WARN iniciar com o Windows: desligado pela política da organização";

    public const string EnabledByPolicyWarning =
        "WARN iniciar com o Windows: ligado pela política da organização, a casca não desliga";

    /// <summary>O começo do aviso de tarefa indisponível; o único lugar onde esse texto existe.</summary>
    public const string UnavailableWarningPrefix = "WARN iniciar com o Windows: indisponível";

    /// <summary>O aviso de tarefa indisponível, só com o nome do tipo da exceção (nunca a mensagem).</summary>
    public static string UnavailableWarning(Exception e) => $"{UnavailableWarningPrefix} ({e.GetType().Name})";

    public static async Task<AutostartOutcome> ApplyAsync(IStartupTask task, bool wanted, Action<string>? log)
    {
        try
        {
            var state = task.State;
            if (wanted)
            {
                switch (state)
                {
                    case StartupState.Enabled or StartupState.EnabledByPolicy:
                        return AutostartOutcome.Unchanged;
                    case StartupState.DisabledByUser:
                        log?.Invoke(RefusedByUserWarning);
                        return AutostartOutcome.RefusedByUser;
                    case StartupState.DisabledByPolicy:
                        log?.Invoke(DisabledByPolicyWarning);
                        return AutostartOutcome.RefusedByPolicy;
                    default:
                        var result = await task.RequestEnableAsync().ConfigureAwait(false);
                        if (result is StartupState.Enabled or StartupState.EnabledByPolicy)
                        {
                            return AutostartOutcome.Enabled;
                        }
                        if (result == StartupState.DisabledByPolicy)
                        {
                            log?.Invoke(DisabledByPolicyWarning);
                            return AutostartOutcome.RefusedByPolicy;
                        }
                        log?.Invoke(RefusedByUserWarning);
                        return AutostartOutcome.RefusedByUser;
                }
            }

            switch (state)
            {
                case StartupState.Enabled:
                    task.Disable();
                    return AutostartOutcome.Disabled;
                case StartupState.EnabledByPolicy:
                    log?.Invoke(EnabledByPolicyWarning);
                    return AutostartOutcome.RefusedByPolicy;
                default:
                    return AutostartOutcome.Unchanged;
            }
        }
        catch (Exception e)
        {
            // Sem pacote (execução fora do MSIX) a tarefa nem existe; a casca segue sem autostart.
            log?.Invoke(UnavailableWarning(e));
            return AutostartOutcome.Unchanged;
        }
    }
}
