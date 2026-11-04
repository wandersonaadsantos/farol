namespace Farol.Contrato;

/// <summary>Pergunta ao sistema qual WebView2 Runtime está instalado.</summary>
public interface IWebView2Check
{
    /// <summary>A versão do runtime, ou <c>null</c> quando ele não está instalado.</summary>
    string? AvailableBrowserVersion();
}

/// <summary>O que a casca faz depois de olhar o runtime.</summary>
public abstract record WebView2Decision
{
    private WebView2Decision()
    {
    }

    /// <summary>O runtime existe: a janela abre a interface.</summary>
    public sealed record Proceed(string Version) : WebView2Decision;

    /// <summary>O runtime falta: a janela mostra o link e não sobe o motor.</summary>
    public sealed record MissingRuntime(string DownloadUrl, string Message) : WebView2Decision;
}

/// <summary>A decisão de abrir a interface ou pedir a instalação do WebView2 Runtime.</summary>
public static class WebView2Policy
{
    /// <summary>Onde a pessoa baixa o runtime.</summary>
    public const string RuntimeUrl = "https://developer.microsoft.com/microsoft-edge/webview2/";

    /// <summary>O texto da janela nativa quando o runtime falta.</summary>
    public const string MissingMessage =
        "O Farol precisa do WebView2 Runtime, que não está instalado nesta máquina. Instale pelo link e abra o Farol de novo.";

    /// <summary>
    /// Versão vazia, ausente ou checagem que lança contam como runtime ausente: sem o
    /// Evergreen instalado, <c>GetAvailableBrowserVersionString</c> lança
    /// <c>WebView2RuntimeNotFoundException</c>.
    /// </summary>
    public static WebView2Decision Decide(IWebView2Check check)
    {
        string? version;
        try
        {
            version = check.AvailableBrowserVersion();
        }
        catch (Exception)
        {
            version = null;
        }
        return string.IsNullOrEmpty(version)
            ? new WebView2Decision.MissingRuntime(RuntimeUrl, MissingMessage)
            : new WebView2Decision.Proceed(version);
    }
}
