using Microsoft.UI.Xaml;

namespace Farol.App;

/// <summary>
/// Ponto de entrada da casca Windows. Por enquanto só abre a janela principal.
/// </summary>
public partial class App : Application
{
    private Window? _window;

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(Microsoft.UI.Xaml.LaunchActivatedEventArgs args)
    {
        _window = new MainWindow();
        _window.Activate();
    }
}
