using Farol.Contrato;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;

namespace Farol.App;

/// <summary>
/// Dono do controle WebView2: injeta o token antes de qualquer script da interface, mantém
/// dentro da janela só o endereço do motor e manda todo o resto para o navegador padrão.
/// Não conhece a <c>AppWindow</c>: as cores chegam à janela por <see cref="ColorsChanged"/>.
/// </summary>
internal sealed class WebHost
{
    private readonly WebView2 _view;
    private readonly int _port;
    private readonly string _userDataFolder;
    private readonly Action<string>? _log;
    private readonly EpisodeLatch _unresponsive = new();
    private string? _token;
    private string? _scriptId;

    /// <param name="userDataFolder">
    /// A pasta de dados do WebView2 (<see cref="FarolPaths.WebViewDataFolder"/>): dentro de
    /// <c>~/.farol</c>, nunca em AppData. O localStorage com o token mora nela.
    /// </param>
    /// <param name="log">Uma linha de WARN por falha de processo do WebView2, sem segredo.</param>
    public WebHost(WebView2 view, int port, string? token, string userDataFolder, Action<string>? log = null)
    {
        _log = log;
        _view = view;
        _port = port;
        _token = token;
        _userDataFolder = userDataFolder;
    }

    /// <summary>A porta do motor a que este controle está preso.</summary>
    public int Port => _port;

    /// <summary>O token injetado agora (o último dado por <see cref="UpdateTokenAsync"/>).</summary>
    public string? Token => _token;

    /// <summary>
    /// O processo do navegador do WebView2 morreu: este controle não volta mais, e quem é dono da
    /// janela tem de criar outro. Sai na thread da interface.
    /// </summary>
    public event Action? BrowserProcessExited;

    /// <summary>As cores do evento <c>casca</c> (fundo e símbolo, em <c>#rrggbb</c>).</summary>
    public event Action<string, string>? ColorsChanged;

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(_userDataFolder);
        // Na projeção WinRT do WebView2 a pasta de dados só entra pelo CreateWithOptionsAsync;
        // texto vazio no executável é o runtime Evergreen instalado.
        var environment = await CoreWebView2Environment.CreateWithOptionsAsync(
            "", _userDataFolder, new CoreWebView2EnvironmentOptions());
        await _view.EnsureCoreWebView2Async(environment);
        var core = _view.CoreWebView2;

        // O script entra antes da primeira navegação, para a interface já achar o token no
        // primeiro carregamento. O token nunca vai para log.
        await InstallTokenScriptAsync(core);

        // O menu de contexto fica (copiar e colar texto); as ferramentas de desenvolvedor só
        // na compilação de depuração.
        core.Settings.AreDefaultContextMenusEnabled = true;
#if DEBUG
        core.Settings.AreDevToolsEnabled = true;
#else
        core.Settings.AreDevToolsEnabled = false;
#endif
        core.Settings.IsStatusBarEnabled = false;

        core.NewWindowRequested += OnNewWindowRequested;
        core.NavigationStarting += OnNavigationStarting;
        core.ProcessFailed += OnProcessFailed;
        core.NavigationCompleted += OnNavigationCompleted;
    }

    /// <summary>
    /// Troca o token injetado (pareamento novo): tira o script anterior pelo id e põe o novo.
    /// Vale a partir do próximo documento; quem chama recarrega a página se precisar.
    /// </summary>
    public async Task UpdateTokenAsync(string? token)
    {
        _token = token;
        var core = _view.CoreWebView2;
        if (core is null)
        {
            // Ainda não inicializado: o InitializeAsync instala o token novo.
            return;
        }
        await InstallTokenScriptAsync(core);
    }

    /// <summary>
    /// Abre um caminho do motor, como <c>/</c> ou <c>/?pr=owner%2Frepo%23N</c>. Caminho que
    /// poderia sair do motor é recusado por <see cref="LocalUrl.For"/>.
    /// </summary>
    public Task NavigateAsync(string path)
    {
        _view.Source = LocalUrl.For(_port, path);
        return Task.CompletedTask;
    }

    /// <summary>
    /// Recarrega a página: depois de <see cref="UpdateTokenAsync"/>, é o que faz a interface ler o
    /// token novo. Antes de inicializado não faz nada.
    /// </summary>
    public void Reload() => _view.CoreWebView2?.Reload();

    private async Task InstallTokenScriptAsync(CoreWebView2 core)
    {
        if (_scriptId is not null)
        {
            core.RemoveScriptToExecuteOnDocumentCreated(_scriptId);
            _scriptId = null;
        }
        var script = TokenInjection.Script(_token, _port);
        if (script.Length > 0)
        {
            _scriptId = await core.AddScriptToExecuteOnDocumentCreatedAsync(script);
        }
    }

    /// <summary>Repassa as cores do retrato da casca para quem desenha a barra de título.</summary>
    public void Apply(ShellEvent.Shell state)
    {
        ColorsChanged?.Invoke(state.ColorBg, state.ColorSymbol);
    }

    // Sem isto a janela fica em branco para sempre depois de uma queda do renderizador (o Electron
    // recarrega no render-process-gone pelo mesmo motivo). Renderizador que caiu ou travou:
    // recarregar. Navegador que caiu: o controle morreu junto, e a janela cria outro.
    private void OnProcessFailed(CoreWebView2 sender, CoreWebView2ProcessFailedEventArgs args)
    {
        try
        {
            switch (args.ProcessFailedKind)
            {
                case CoreWebView2ProcessFailedKind.RenderProcessExited:
                    _log?.Invoke($"WARN janela: o processo da página falhou ({args.ProcessFailedKind}); recarregando");
                    sender.Reload();
                    break;
                case CoreWebView2ProcessFailedKind.RenderProcessUnresponsive:
                    // O travado avisa de novo a cada poucos segundos: uma linha por episódio,
                    // que acaba quando uma página carrega.
                    if (_unresponsive.TryEnter())
                    {
                        _log?.Invoke($"WARN janela: o processo da página falhou ({args.ProcessFailedKind}); recarregando");
                    }
                    sender.Reload();
                    break;
                case CoreWebView2ProcessFailedKind.BrowserProcessExited:
                    _log?.Invoke("WARN janela: o processo do navegador do WebView2 saiu; criando outro");
                    BrowserProcessExited?.Invoke();
                    break;
            }
        }
        catch (Exception e)
        {
            _log?.Invoke($"WARN janela: recuperação da falha do WebView2 falhou ({e.GetType().Name})");
        }
    }

    private void OnNavigationCompleted(CoreWebView2 sender, CoreWebView2NavigationCompletedEventArgs args)
    {
        if (args.IsSuccess)
        {
            _unresponsive.End();
        }
    }

    // Janela nova nunca é aberta pelo WebView2: endereço do motor navega aqui mesmo, o resto
    // vai para o navegador padrão.
    private void OnNewWindowRequested(CoreWebView2 sender, CoreWebView2NewWindowRequestedEventArgs args)
    {
        args.Handled = true;
        if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri))
        {
            return;
        }
        if (ExternalLinkPolicy.IsLocal(uri, _port))
        {
            sender.Navigate(uri.AbsoluteUri);
            return;
        }
        LaunchOutside(uri);
    }

    private void OnNavigationStarting(CoreWebView2 sender, CoreWebView2NavigationStartingEventArgs args)
    {
        if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri) && ExternalLinkPolicy.IsLocal(uri, _port))
        {
            return;
        }
        args.Cancel = true;
        if (uri is not null)
        {
            LaunchOutside(uri);
        }
    }

    // Só http e https saem para o navegador: outro esquema (file, ms-settings, protocolo de
    // app) seria um jeito de a página abrir qualquer coisa na máquina.
    private static void LaunchOutside(Uri uri)
    {
        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
        {
            return;
        }
        _ = global::Windows.System.Launcher.LaunchUriAsync(uri);
    }
}
