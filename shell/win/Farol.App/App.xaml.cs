using Farol.Contrato;
using Microsoft.UI.Xaml;

namespace Farol.App;

/// <summary>
/// Ponto de entrada da casca Windows: confere o WebView2 Runtime antes de qualquer outra coisa.
/// Sem ele, a janela mostra o aviso nativo e o motor nunca é ligado.
/// </summary>
public partial class App : Application
{
    private MainWindow? _window;

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
                _window.ShowRuntimeMissing(missing);
                _window.Activate();
                return;
            case WebView2Decision.Proceed:
                // TODO Task 8: Composition. Aqui entra a fiação do motor sidecar (processo,
                // pareamento, token do PasswordVault, SSE) e o AttachEngineAsync(porta, token).
                _window.Activate();
                return;
        }
    }
}
