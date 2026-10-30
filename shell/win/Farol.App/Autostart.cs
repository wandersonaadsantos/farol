using Farol.Contrato;
using Windows.ApplicationModel;

namespace Farol.App;

/// <summary>
/// Liga e desliga o "iniciar com o Windows" pela tarefa <c>FarolAutostart</c> do manifesto,
/// seguindo o <c>autostart</c> de cada evento <c>casca</c>. A decisão é a de
/// <see cref="AutostartDecision"/> e a memória do aviso é a de <see cref="AutostartReporter"/>;
/// aqui fica só o WinRT.
/// </summary>
/// <remarks>Fora do pacote MSIX a tarefa não existe; vira um WARN e a casca segue, nunca cai.</remarks>
internal sealed class Autostart
{
    private const string TaskId = "FarolAutostart";

    private readonly AutostartReporter _reporter;

    public Autostart(Action<string>? log = null)
    {
        _reporter = new AutostartReporter(GetTaskAsync, log);
    }

    /// <summary>Aplica o desejado; chamadas seguidas entram em fila, uma por vez.</summary>
    public Task ApplyAsync(bool wanted) => _reporter.ApplyAsync(wanted);

    private static async Task<IStartupTask> GetTaskAsync() =>
        new StartupTaskAdapter(await StartupTask.GetAsync(TaskId));

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
