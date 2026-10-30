using Farol.Contrato;
using Microsoft.UI.Dispatching;
using Microsoft.Windows.AppNotifications;
using Microsoft.Windows.AppNotifications.Builder;

namespace Farol.App;

/// <summary>
/// Os avisos do Windows: mostra o aviso pronto que o motor manda e, no clique, aplica a regra
/// de <see cref="ActionRouter"/> na janela. Os argumentos do aviso levam só <c>kind</c>,
/// <c>url</c> e <c>pr</c> (<see cref="NoticeArguments.Pairs"/>), então um clique depois de o
/// Farol ter reiniciado chega ao mesmo caminho. Título e corpo nunca vão para o log: trazem o
/// título do PR.
/// </summary>
internal sealed class Notifier
{
    private readonly DispatcherQueue _dispatcher;
    private readonly IWindowPresenter _presenter;
    private readonly Action<string>? _log;
    private bool _registered;

    public Notifier(DispatcherQueue dispatcher, IWindowPresenter presenter, Action<string>? log = null)
    {
        _dispatcher = dispatcher;
        _presenter = presenter;
        _log = log;
    }

    /// <summary>
    /// Uma vez, na partida: o evento do clique é assinado ANTES do <c>Register</c>, como pede o
    /// Windows App SDK, para nenhum clique cair no vazio. Uma segunda chamada não faz nada.
    /// </summary>
    public void Register()
    {
        if (_registered)
        {
            return;
        }
        var manager = AppNotificationManager.Default;
        manager.NotificationInvoked += OnNotificationInvoked;
        try
        {
            manager.Register();
            _registered = true;
        }
        catch (Exception e)
        {
            manager.NotificationInvoked -= OnNotificationInvoked;
            _log?.Invoke($"WARN avisos: registro no Windows falhou ({e.GetType().Name})");
        }
    }

    /// <summary>Na saída de verdade (o Sair da bandeja), desfaz o <see cref="Register"/>.</summary>
    public void Unregister()
    {
        if (!_registered)
        {
            return;
        }
        var manager = AppNotificationManager.Default;
        manager.NotificationInvoked -= OnNotificationInvoked;
        try
        {
            manager.Unregister();
        }
        catch (Exception e)
        {
            _log?.Invoke($"WARN avisos: cancelar o registro falhou ({e.GetType().Name})");
        }
        _registered = false;
    }

    /// <summary>Mostra o aviso. Silencioso sai sem som; o resto, com o som padrão do sistema.</summary>
    public void Post(ShellEvent.Notice notice)
    {
        ArgumentNullException.ThrowIfNull(notice);
        if (!_registered)
        {
            return;
        }
        try
        {
            var builder = new AppNotificationBuilder()
                .AddText(notice.Title.Length > 0 ? notice.Title : "Farol");
            if (notice.Body.Length > 0)
            {
                builder.AddText(notice.Body);
            }
            foreach (var (key, value) in NoticeArguments.Pairs(notice))
            {
                builder.AddArgument(key, value);
            }
            if (notice.Silent)
            {
                builder.MuteAudio();
            }
            AppNotificationManager.Default.Show(builder.BuildNotification());
        }
        catch (Exception e)
        {
            _log?.Invoke($"WARN avisos: aviso não foi mostrado ({e.GetType().Name})");
        }
    }

    /// <summary>
    /// O Farol aberto pelo clique num aviso (partida a frio): os argumentos da ativação seguem
    /// o mesmo caminho do clique com o Farol rodando. Quem chama é a partida, depois de a
    /// janela existir.
    /// </summary>
    public void HandleActivation(AppNotificationActivatedEventArgs args)
    {
        ArgumentNullException.ThrowIfNull(args);
        Route(args);
    }

    // Chega numa thread do sistema, fora da interface.
    private void OnNotificationInvoked(AppNotificationManager sender, AppNotificationActivatedEventArgs args) =>
        Route(args);

    private void Route(AppNotificationActivatedEventArgs args)
    {
        NoticeAction action;
        try
        {
            // Cópia: o dicionário projetado do WinRT não garante IReadOnlyDictionary.
            action = NoticeArguments.FromPairs(new Dictionary<string, string>(args.Arguments, StringComparer.Ordinal));
        }
        catch (Exception e)
        {
            _log?.Invoke($"WARN avisos: argumentos do clique ilegíveis ({e.GetType().Name})");
            action = new NoticeAction.FocusWindow();
        }
        if (_dispatcher.HasThreadAccess)
        {
            _ = ApplyAsync(action);
            return;
        }
        if (!_dispatcher.TryEnqueue(() => _ = ApplyAsync(action)))
        {
            _log?.Invoke("WARN avisos: clique chegou com a interface encerrando");
        }
    }

    private async Task ApplyAsync(NoticeAction action)
    {
        try
        {
            await NoticeDispatcher.ApplyAsync(action, _presenter);
        }
        catch (Exception e)
        {
            _log?.Invoke($"WARN avisos: clique não foi aplicado ({action.GetType().Name}, {e.GetType().Name})");
        }
    }
}
