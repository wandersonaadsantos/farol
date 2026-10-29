using Microsoft.UI.Xaml;

namespace Farol.App;

/// <summary>
/// Janela principal. No esqueleto mostra só o nome; o WebView2 entra numa task seguinte.
/// </summary>
public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
    }
}
