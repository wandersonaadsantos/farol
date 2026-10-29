using Farol.Contrato;
using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;
using Microsoft.Windows.AppNotifications;

namespace Farol.App;

/// <summary>
/// Ponto de entrada da casca Windows: confere o WebView2 Runtime antes de qualquer outra coisa.
/// Sem ele, a janela mostra o aviso nativo e o motor nunca é ligado.
/// </summary>
public partial class App : Application
{
    private MainWindow? _window;
    private Notifier? _notifier;

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(Microsoft.UI.Xaml.LaunchActivatedEventArgs args)
    {
        _window = new MainWindow();
        switch (WebView2Policy.Decide(new WebView2Check()))
        {
            case WebView2Decision.MissingRuntime missing:
                // Sem bandeja nem motor, fechar o aviso encerra o Farol de verdade; esconder
                // deixaria um processo vivo sem janela nenhuma.
                _window.HideOnClose = false;
                _window.ShowRuntimeMissing(missing);
                _window.Activate();
                return;
            case WebView2Decision.Proceed:
                // TODO Task 8: Composition. Aqui entra a fiação do motor sidecar (processo,
                // pareamento, token do PasswordVault, SSE) e o
                // AttachEngineAsync(porta, token, FarolPaths.WebViewDataFolder(home)), o log do
                // farol.log para o Notifier e o Post de cada ShellEvent.Notice do SSE.
                _notifier = new Notifier(_window.DispatcherQueue, new WindowPresenter(_window));
                _notifier.Register();
                _window.Activate();
                RouteLaunchNotification(_notifier);
                return;
        }
    }

    // Aberto pelo clique num aviso com o Farol fechado: o clique segue o mesmo caminho de
    // quando ele está rodando, já com a janela criada.
    private static void RouteLaunchNotification(Notifier notifier)
    {
        var activation = AppInstance.GetCurrent().GetActivatedEventArgs();
        if (activation.Kind == ExtendedActivationKind.AppNotification
            && activation.Data is AppNotificationActivatedEventArgs args)
        {
            notifier.HandleActivation(args);
        }
    }
}
