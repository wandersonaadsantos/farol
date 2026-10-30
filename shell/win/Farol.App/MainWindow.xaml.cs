using System.Runtime.InteropServices;
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
    private WebView2? _view;
    private bool _attaching;
    private string? _pendingPath;

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
    internal async Task AttachEngineAsync(int port, string? token, string userDataFolder, Action<string>? log = null)
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
            var web = new WebHost(view, port, token, userDataFolder, log);
            web.ColorsChanged += OnColorsChanged;
            web.BrowserProcessExited += OnBrowserProcessExited;
            await web.InitializeAsync();
            _web = web;
            _view = view;
            var path = _pendingPath ?? "/";
            _pendingPath = null;
            await web.NavigateAsync(path);
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

    /// <summary>
    /// Abre um caminho da interface (o PR de um aviso clicado). Antes de
    /// <see cref="AttachEngineAsync"/> o caminho fica guardado e é o primeiro a abrir no lugar
    /// da raiz; um pedido novo substitui o guardado.
    /// </summary>
    internal Task NavigateWhenReadyAsync(string path)
    {
        if (_web is null)
        {
            _pendingPath = path;
            return Task.CompletedTask;
        }
        return _web.NavigateAsync(path);
    }

    /// <summary>
    /// O processo do navegador do WebView2 morreu e a janela largou o controle: quem compõe liga
    /// um novo por <see cref="AttachEngineAsync"/>.
    /// </summary>
    internal event Action? EngineViewLost;

    /// <summary>A janela está visível e é a janela à frente do sistema.</summary>
    internal bool IsForeground => AppWindow.IsVisible && GetForegroundWindow() == Hwnd;

    /// <summary>
    /// Larga o WebView2 ligado ao motor (porta nova, ou navegador que morreu). Depois disso
    /// <see cref="IsAttached"/> é falso e <see cref="AttachEngineAsync"/> liga outro, com a mesma
    /// pasta de dados. Sem controle ligado, não faz nada.
    /// </summary>
    internal void DetachEngine()
    {
        if (_web is null)
        {
            return;
        }
        var view = _view;
        _web.BrowserProcessExited -= OnBrowserProcessExited;
        _web.ColorsChanged -= OnColorsChanged;
        _web = null;
        _view = null;
        if (view is not null)
        {
            if (ReferenceEquals(ContentHost.Child, view))
            {
                ContentHost.Child = null;
            }
            view.Close();
        }
    }

    private void OnBrowserProcessExited()
    {
        DetachEngine();
        EngineViewLost?.Invoke();
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    /// <summary>O WebView2 já foi ligado ao motor por <see cref="AttachEngineAsync"/>.</summary>
    internal bool IsAttached => _web is not null;

    /// <summary>Texto simples enquanto o motor sobe, no lugar onde a interface vai aparecer.</summary>
    internal void ShowStarting()
    {
        if (_web is not null)
        {
            return;
        }
        ContentHost.Child = CenteredPanel(new TextBlock
        {
            Text = "Ligando o motor do Farol...",
            TextWrapping = TextWrapping.Wrap,
            MaxWidth = 480,
        });
    }

    /// <summary>
    /// A casca desistiu de religar o motor: a mensagem e o botão "Tentar de novo", que chama
    /// <paramref name="retry"/>. O WebView2, se existia, fica guardado e volta por
    /// <see cref="RestoreEngineView"/>.
    /// </summary>
    internal void ShowFailure(string message, Action retry)
    {
        var button = new Button { Content = "Tentar de novo" };
        button.Click += (_, _) =>
        {
            button.IsEnabled = false;
            retry();
        };
        ContentHost.Child = CenteredPanel(
            new TextBlock { Text = message, TextWrapping = TextWrapping.Wrap, MaxWidth = 480 },
            button);
    }

    /// <summary>Põe de volta o WebView2 ligado ao motor (depois de <see cref="ShowFailure"/>).</summary>
    internal void RestoreEngineView()
    {
        if (_view is not null && !ReferenceEquals(ContentHost.Child, _view))
        {
            ContentHost.Child = _view;
        }
    }

    private static StackPanel CenteredPanel(params UIElement[] children)
    {
        var panel = new StackPanel
        {
            Spacing = 12,
            Margin = new Thickness(32),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        foreach (var child in children)
        {
            panel.Children.Add(child);
        }
        return panel;
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
