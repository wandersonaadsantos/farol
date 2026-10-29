using Farol.Contrato;
using Microsoft.UI.Dispatching;
using Microsoft.Windows.AppLifecycle;

namespace Farol.App;

/// <summary>
/// O adaptador do <see cref="UpdateGate"/>: pergunta ao App Installer, de hora em hora, se há
/// versão nova do pacote (<c>Package.CheckUpdateAvailabilityAsync</c>) e, quando há, pede o
/// reinício ao gate. O App Installer baixa e aplica o MSIX sozinho; a casca só escolhe a hora de
/// reiniciar, e nunca com o motor ocupado. Os retratos <c>casca</c> chegam pela
/// <see cref="Composition"/> (<see cref="OnShell"/>), sem segunda leitura do fluxo de eventos.
/// </summary>
/// <remarks>
/// Gate, pedido e reinício rodam na thread da interface. Fora do pacote (desenvolvimento sem
/// MSIX) ou instalado sem <c>.appinstaller</c>, a checagem não acha nada e nada acontece.
/// </remarks>
internal sealed class UpdateWatcher : IDisposable
{
    private static readonly TimeSpan FirstCheck = TimeSpan.FromMinutes(1);
    private static readonly TimeSpan Interval = TimeSpan.FromHours(1);

    private readonly UpdateGate _gate = new();
    private readonly DispatcherQueue _dispatcher;
    private readonly Func<bool> _isForeground;
    private readonly Func<Task<bool>> _beforeRestart;
    private readonly Func<Task> _afterFailedRestart;
    private readonly Action<string> _log;
    private readonly CancellationTokenSource _stop = new();
    private bool _restarting;
    private bool _disposed;

    /// <param name="dispatcher">A fila da thread da interface.</param>
    /// <param name="isForeground">A janela do Farol está visível e à frente, agora.</param>
    /// <param name="beforeRestart">
    /// Encerra o motor e o fluxo de eventos antes do reinício; <c>false</c> desiste (a casca está
    /// saindo).
    /// </param>
    /// <param name="afterFailedRestart">Põe o motor de volta quando o sistema recusa o reinício.</param>
    /// <param name="log">O log de falhas da casca.</param>
    public UpdateWatcher(DispatcherQueue dispatcher, Func<bool> isForeground, Func<Task<bool>> beforeRestart, Func<Task> afterFailedRestart, Action<string> log)
    {
        _dispatcher = dispatcher;
        _isForeground = isForeground;
        _beforeRestart = beforeRestart;
        _afterFailedRestart = afterFailedRestart;
        _log = log;
    }

    /// <summary>Começa a checar o App Installer em segundo plano.</summary>
    public void Start() => _ = CheckLoopAsync(_stop.Token);

    /// <summary>Cada retrato <c>casca</c>, na thread da interface: libera o reinício adiado.</summary>
    public void OnShell(ShellEvent.Shell shell)
    {
        if (!_disposed && _gate.OnShell(shell))
        {
            _ = RestartAsync();
        }
    }

    /// <summary>
    /// A janela veio à frente ou saiu dela, na thread da interface: libera o reinício que esperava
    /// por isso.
    /// </summary>
    public void OnForeground(bool foreground)
    {
        if (!_disposed && _gate.OnForeground(foreground))
        {
            _ = RestartAsync();
        }
    }

    /// <summary>
    /// Para as checagens e qualquer reinício ainda não feito. O Sair chama antes de tudo, então
    /// uma checagem que chegue durante a saída não vira reinício.
    /// </summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }
        _disposed = true;
        _stop.Cancel();
        _stop.Dispose();
    }

    private async Task CheckLoopAsync(CancellationToken ct)
    {
        var wait = FirstCheck;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(wait, ct);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            wait = Interval;
            if (await UpdateAvailableAsync())
            {
                if (!_dispatcher.TryEnqueue(OnUpdateAvailable))
                {
                    return;
                }
            }
        }
    }

    private async Task<bool> UpdateAvailableAsync()
    {
        try
        {
            var result = await global::Windows.ApplicationModel.Package.Current.CheckUpdateAvailabilityAsync();
            return result.Availability is global::Windows.ApplicationModel.PackageUpdateAvailability.Available
                or global::Windows.ApplicationModel.PackageUpdateAvailability.Required;
        }
        catch (InvalidOperationException)
        {
            // Fora do pacote MSIX não há identidade nem App Installer: não é falha.
            return false;
        }
        catch (Exception e)
        {
            _log($"WARN checagem de update do pacote falhou ({e.GetType().Name})");
            return false;
        }
    }

    private void OnUpdateAvailable()
    {
        // Repetir o pedido a cada hora é inofensivo: o gate libera uma vez só.
        if (!_disposed && _gate.RequestRestart())
        {
            _ = RestartAsync();
        }
    }

    // Só com a janela visível e à frente: o sistema recusa o Restart de um app fora do primeiro
    // plano (NotInForeground), e o motor teria sido encerrado à toa a cada hora. A janela é
    // conferida de novo aqui, antes de tocar no motor; fora da frente, o pedido volta a esperar a
    // próxima ativação da janela (Defer) sem encerrar nada. Como o reinício só acontece com a
    // janela na tela, ela voltar depois dele é o esperado, e nenhum marcador de reabertura
    // silenciosa é gravado. O motor é encerrado antes de o processo reiniciar; o Restart só volta
    // quando o sistema recusa, e aí o motor sobe de novo e a próxima checagem do App Installer
    // (uma hora depois) pede outra tentativa. Saindo (Dispose), nada reinicia.
    private async Task RestartAsync()
    {
        if (_restarting || _disposed)
        {
            return;
        }
        if (!SafeIsForeground())
        {
            _gate.Defer();
            return;
        }
        _restarting = true;
        try
        {
            if (!await _beforeRestart() || _disposed)
            {
                return;
            }
            var reason = AppInstance.Restart("");
            _log($"WARN reinício para o update recusado pelo sistema ({reason})");
        }
        catch (Exception e)
        {
            _log($"WARN reinício para o update falhou ({e.GetType().Name})");
        }
        finally
        {
            _restarting = false;
        }
        await AfterRefusedAsync();
    }

    private bool SafeIsForeground()
    {
        try
        {
            return _isForeground();
        }
        catch (Exception e)
        {
            _log($"WARN conferência da janela à frente falhou ({e.GetType().Name})");
            return false;
        }
    }

    private async Task AfterRefusedAsync()
    {
        _gate.RestartFailed();
        try
        {
            await _afterFailedRestart();
        }
        catch (Exception e)
        {
            _log($"WARN o motor não voltou depois do reinício recusado ({e.GetType().Name})");
        }
    }
}
