namespace Farol.Contrato;

/// <summary>
/// Aplica o <c>autostart</c> de cada evento <c>casca</c> e lembra o último aviso, para que a
/// mesma recusa saia no log UMA vez e não a cada evento. O aviso volta quando o desfecho
/// muda (outra recusa, ou um sucesso e depois a recusa de novo). Nunca lança.
/// </summary>
/// <remarks>
/// A tarefa vem de uma fábrica porque no WinRT ela é assíncrona (<c>StartupTask.GetAsync</c>) e
/// é ela que falha fora do pacote MSIX. Chamadas seguidas entram em fila, uma por vez.
/// </remarks>
public sealed class AutostartReporter
{
    private readonly Func<Task<IStartupTask>> _taskFactory;
    private readonly Action<string>? _log;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private string? _lastWarning;

    public AutostartReporter(Func<Task<IStartupTask>> taskFactory, Action<string>? log)
    {
        _taskFactory = taskFactory;
        _log = log;
    }

    public async Task<AutostartOutcome> ApplyAsync(bool wanted)
    {
        await _gate.WaitAsync().ConfigureAwait(false);
        try
        {
            var lines = new List<string>();
            var outcome = AutostartOutcome.Unchanged;
            try
            {
                var task = await _taskFactory().ConfigureAwait(false);
                outcome = await AutostartDecision.ApplyAsync(task, wanted, lines.Add).ConfigureAwait(false);
            }
            catch (Exception e)
            {
                lines.Add(AutostartDecision.UnavailableWarning(e));
            }

            var warning = lines.Count == 0 ? null : outcome + "|" + string.Join("\n", lines);
            if (warning is not null && warning != _lastWarning)
            {
                foreach (var line in lines)
                {
                    _log?.Invoke(line);
                }
            }
            // Sem aviso, a memória zera: uma recusa que volte depois é avisada de novo.
            _lastWarning = warning;
            return outcome;
        }
        finally
        {
            _gate.Release();
        }
    }
}
