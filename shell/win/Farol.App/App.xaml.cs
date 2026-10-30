using System.Diagnostics;
using Farol.Contrato;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;

namespace Farol.App;

/// <summary>
/// Ponto de entrada da casca Windows. Primeiro a instância única (uma segunda abertura entrega a
/// ativação à principal e morre antes de criar janela ou motor), depois o WebView2 Runtime (sem
/// ele, a janela mostra o aviso nativo e o motor nunca é ligado), e por fim a
/// <see cref="Composition"/>, que liga todo o resto.
/// </summary>
public partial class App : Application
{
    /// <summary>A chave da instância única: um Farol por usuário.</summary>
    private const string InstanceKey = "farol";

    private MainWindow? _window;
    private Composition? _composition;

    public App()
    {
        InitializeComponent();
    }

    protected override async void OnLaunched(Microsoft.UI.Xaml.LaunchActivatedEventArgs args)
    {
        var activation = AppInstance.GetCurrent().GetActivatedEventArgs();
        var main = AppInstance.FindOrRegisterForKey(InstanceKey);
        if (!main.IsCurrent)
        {
            await RedirectAndDieAsync(main, activation);
            return;
        }

        // Assinado logo depois de virar a principal: uma segunda abertura durante a checagem do
        // WebView2 ou a montagem da composição não cai no vazio. O evento chega numa thread do
        // sistema e é passado para a da interface, que só o atende depois deste OnLaunched (o
        // caminho da principal não tem await), com a janela e a composição já prontas.
        var ui = DispatcherQueue.GetForCurrentThread();
        main.Activated += (_, redirected) => ui.TryEnqueue(() => OnRedirected(redirected));

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
                Compose(activation);
                return;
        }
    }

    // Com a composição, o caminho único das ativações; sem ela (o aviso de WebView2 ausente), ao
    // menos a janela que existe vem para a frente.
    private void OnRedirected(AppActivationArguments args)
    {
        try
        {
            if (_composition is { } composition)
            {
                composition.HandleActivation(args, redirected: true);
            }
            else
            {
                _window?.ShowAndActivate();
            }
        }
        catch (Exception e)
        {
            Debug.WriteLine($"WARN ativação redirecionada não foi atendida ({e.GetType().Name})");
        }
    }

    private void Compose(AppActivationArguments activation)
    {
        // O Farol vive na bandeja: fechar ou esconder a janela nunca encerra o processo, só o
        // Sair da bandeja (Exit).
        DispatcherShutdownMode = DispatcherShutdownMode.OnExplicitShutdown;

        var farolHome = Environment.GetEnvironmentVariable("FAROL_HOME");
        var home = FarolPaths.Home(farolHome);
        // Lido (e apagado) antes de qualquer janela: presente, o Farol sobe só na bandeja.
        var silentVersion = SilentReopen.Consume(FarolPaths.EngineStateDir(home));

        var composition = new Composition(
            _window!,
            home,
            string.IsNullOrEmpty(farolHome) ? null : home,
            ReadShellVersion());
        _composition = composition;

        composition.Start(silentVersion);
        // Aberto pelo clique num aviso com o Farol fechado: o mesmo caminho de quando ele roda.
        composition.HandleActivation(activation, redirected: false);
    }

    // A segunda instância entrega a ativação (abrir de novo, ou o clique num aviso) à principal e
    // morre sem criar nada. O redirecionamento roda fora da thread da interface, como pede o
    // Windows App SDK, mas é esperado sem bloqueá-la.
    private static async Task RedirectAndDieAsync(AppInstance main, AppActivationArguments activation)
    {
        try
        {
            await Task.Run(() => main.RedirectActivationToAsync(activation).AsTask());
        }
        catch (Exception e)
        {
            Debug.WriteLine($"WARN instância única: redirecionamento falhou ({e.GetType().Name})");
        }
        Process.GetCurrentProcess().Kill();
    }

    // A versão do pacote MSIX (os três primeiros números); fora do pacote, a de reserva.
    private static string ReadShellVersion()
    {
        try
        {
            var version = global::Windows.ApplicationModel.Package.Current.Id.Version;
            return ShellVersion.From(version.Major, version.Minor, version.Build);
        }
        catch (Exception)
        {
            return ShellVersion.Fallback;
        }
    }
}
