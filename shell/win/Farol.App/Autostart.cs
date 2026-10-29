using Farol.Contrato;
using Windows.ApplicationModel;

namespace Farol.App;

/// <summary>
/// Liga e desliga o "iniciar com o Windows" pela tarefa <c>FarolAutostart</c> do manifesto,
/// seguindo o <c>autostart</c> de cada evento <c>casca</c>. A decisão é a de
/// <see cref="AutostartDecision"/>; aqui fica só o WinRT e a memória do aviso.
/// </summary>
/// <remarks>
/// O mesmo aviso não se repete a cada evento: só sai quando o desfecho muda. Fora do pacote
/// MSIX a tarefa não existe; vira um WARN e a casca segue, nunca cai.
/// </remarks>
internal sealed class Autostart
{
    private const string TaskId = "FarolAutostart";

    private readonly Action<string>? _log;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private string? _lastWarning;

    public Autostart(Action<string>? log = null)
    {
        _log = log;
    }

    /// <summary>Aplica o desejado; chamadas seguidas entram em fila, uma por vez.</summary>
    public async Task ApplyAsync(bool wanted)
    {
        await _gate.WaitAsync();
        try
        {
            var lines = new List<string>();
            var outcome = AutostartOutcome.Unchanged;
            try
            {
                var task = await StartupTask.GetAsync(TaskId);
                outcome = await AutostartDecision.ApplyAsync(new StartupTaskAdapter(task), wanted, lines.Add);
            }
            catch (Exception e)
            {
                lines.Add($"WARN iniciar com o Windows: indisponível ({e.GetType().Name})");
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
        }
        finally
        {
            _gate.Release();
        }
    }

    private sealed class StartupTaskAdapter : IStartupTask
    {
        private readonly StartupTask _task;

        public StartupTaskAdapter(StartupTask task)
        {
            _task = task;
        }

        public StartupState State => Map(_task.State);

        public async Task<StartupState> RequestEnableAsync() => Map(await _task.RequestEnableAsync());

        public void Disable() => _task.Disable();

        // Estado que o Windows venha a criar depois cai em Disabled: a decisão então pede,
        // e o pedido devolve o estado real.
        private static StartupState Map(StartupTaskState state) => state switch
        {
            StartupTaskState.Enabled => StartupState.Enabled,
            StartupTaskState.DisabledByUser => StartupState.DisabledByUser,
            StartupTaskState.DisabledByPolicy => StartupState.DisabledByPolicy,
            StartupTaskState.EnabledByPolicy => StartupState.EnabledByPolicy,
            _ => StartupState.Disabled,
        };
    }
}
