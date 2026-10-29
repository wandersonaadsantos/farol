using Farol.Contrato;

namespace Farol.App;

/// <summary>A <see cref="MainWindow"/> vista pelo clique num aviso. Roda na thread da interface.</summary>
internal sealed class WindowPresenter : IWindowPresenter
{
    private readonly MainWindow _window;

    public WindowPresenter(MainWindow window)
    {
        _window = window;
    }

    public void ShowAndActivate() => _window.ShowAndActivate();

    // Antes de o motor ligar à janela o caminho fica guardado e é o primeiro a abrir.
    public Task NavigateAsync(string path) => _window.NavigateWhenReadyAsync(path);

    // Só http e https saem para o navegador, como nos links da página (WebHost).
    public void OpenExternal(Uri url)
    {
        ArgumentNullException.ThrowIfNull(url);
        if (!url.IsAbsoluteUri || (url.Scheme != Uri.UriSchemeHttp && url.Scheme != Uri.UriSchemeHttps))
        {
            return;
        }
        _ = global::Windows.System.Launcher.LaunchUriAsync(url);
    }
}
