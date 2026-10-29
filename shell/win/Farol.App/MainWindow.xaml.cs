using Farol.Contrato;
using Microsoft.UI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace Farol.App;

/// <summary>
/// Janela principal: barra de título própria com as cores do motor e o WebView2 embaixo.
/// Fechar esconde a janela (o Farol continua na bandeja); <see cref="ShowAndActivate"/> traz de volta.
/// </summary>
public sealed partial class MainWindow : Window
{
    private readonly DispatcherQueue _dispatcher;
    private WebHost? _web;
    private bool _attaching;

    public MainWindow()
    {
        InitializeComponent();
        _dispatcher = DispatcherQueue;
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(DragRegion);
        if (AppWindowTitleBar.IsCustomizationSupported())
        {
            // Botões do sistema na altura da linha de 44 px da barra própria.
            AppWindow.TitleBar.PreferredHeightOption = TitleBarHeightOption.Tall;
        }
        AppWindow.Closing += OnClosing;
    }

    /// <summary>
    /// Enquanto verdadeiro, fechar só esconde. Quem encerra o Farol de verdade (o Sair da
    /// bandeja) desliga antes de fechar.
    /// </summary>
    public bool HideOnClose { get; set; } = true;

    /// <summary>O HWND da janela, para o overlay da barra de tarefas (<see cref="TaskbarOverlay"/>).</summary>
    public IntPtr Hwnd => WinRT.Interop.WindowNative.GetWindowHandle(this);

    /// <summary>A interface web; existe depois de <see cref="AttachEngineAsync"/>.</summary>
    internal WebHost Web => _web ?? throw new InvalidOperationException("O motor ainda não foi ligado à janela.");

    /// <summary>
    /// Cria o WebView2 com a pasta de dados dada (<see cref="FarolPaths.WebViewDataFolder"/>),
    /// injeta o token e abre a raiz do motor na porta dada. Uma segunda chamada, durante ou
    /// depois da primeira, não faz nada; se a inicialização falha, o controle sai da janela e
    /// uma nova chamada pode tentar de novo.
    /// </summary>
    internal async Task AttachEngineAsync(int port, string? token, string userDataFolder)
    {
        if (_web is not null || _attaching)
        {
            return;
        }
        _attaching = true;
        var view = new WebView2();
        try
        {
            ContentHost.Child = view;
            var web = new WebHost(view, port, token, userDataFolder);
            web.ColorsChanged += OnColorsChanged;
            await web.InitializeAsync();
            _web = web;
            await web.NavigateAsync("/");
        }
        catch
        {
            if (_web is null)
            {
                ContentHost.Child = null;
                view.Close();
            }
            throw;
        }
        finally
        {
            _attaching = false;
        }
    }

    /// <summary>Sem WebView2 Runtime: aviso nativo com o link, e nenhum WebView criado.</summary>
    public void ShowRuntimeMissing(WebView2Decision.MissingRuntime decision)
    {
        var panel = new StackPanel
        {
            Spacing = 12,
            Margin = new Thickness(32),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        panel.Children.Add(new TextBlock
        {
            Text = decision.Message,
            TextWrapping = TextWrapping.Wrap,
            MaxWidth = 480,
        });
        panel.Children.Add(new HyperlinkButton
        {
            Content = "Baixar o WebView2 Runtime",
            NavigateUri = new Uri(decision.DownloadUrl),
        });
        ContentHost.Child = panel;
    }

    /// <summary>Mostra a janela escondida e traz para a frente.</summary>
    public void ShowAndActivate()
    {
        AppWindow.Show();
        Activate();
    }

    /// <summary>
    /// Pinta a barra de título: fundo da área de arrastar, texto e os botões do sistema.
    /// Cor fora do formato <c>#rrggbb</c> é ignorada e a barra fica como estava.
    /// </summary>
    public void ApplyColors(string bg, string symbol)
    {
        if (!HexColor.TryParse(bg, out var background) || !HexColor.TryParse(symbol, out var foreground))
        {
            return;
        }
        var backgroundColor = ColorHelper.FromArgb(255, background.R, background.G, background.B);
        var foregroundColor = ColorHelper.FromArgb(255, foreground.R, foreground.G, foreground.B);

        DragRegion.Background = new SolidColorBrush(backgroundColor);
        TitleText.Foreground = new SolidColorBrush(foregroundColor);

        if (AppWindowTitleBar.IsCustomizationSupported())
        {
            var bar = AppWindow.TitleBar;
            bar.ButtonBackgroundColor = backgroundColor;
            bar.ButtonForegroundColor = foregroundColor;
            bar.ButtonInactiveBackgroundColor = backgroundColor;
        }
    }

    // O evento pode chegar fora da thread da interface (o cliente SSE roda em segundo plano).
    private void OnColorsChanged(string bg, string symbol)
    {
        if (_dispatcher.HasThreadAccess)
        {
            ApplyColors(bg, symbol);
            return;
        }
        _dispatcher.TryEnqueue(() => ApplyColors(bg, symbol));
    }

    private void OnClosing(AppWindow sender, AppWindowClosingEventArgs args)
    {
        if (!HideOnClose)
        {
            return;
        }
        args.Cancel = true;
        sender.Hide();
    }
}
