namespace Farol.Contrato;

/// <summary>
/// Os caminhos da casca dentro do home do Farol. Fonte única da regra do home padrão
/// (<c>~/.farol</c>), que o processo do motor e a janela leem daqui.
/// </summary>
public static class FarolPaths
{
    /// <summary>
    /// O mesmo home do motor (<c>os.homedir()</c> mais <c>.farol</c>): <c>%USERPROFILE%</c> no
    /// Windows, <c>$HOME</c> fora dele, e a pasta do perfil do sistema quando a variável falta.
    /// </summary>
    public static string DefaultHome()
    {
        var profile = OperatingSystem.IsWindows()
            ? Environment.GetEnvironmentVariable("USERPROFILE")
            : Environment.GetEnvironmentVariable("HOME");
        if (string.IsNullOrEmpty(profile))
        {
            profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        }
        return Path.Combine(profile, ".farol");
    }

    /// <summary>
    /// A pasta de dados do WebView2 (cache, localStorage com o token): dentro do home do Farol,
    /// nunca em AppData (invariante 2). Home vazio ou ausente usa o padrão.
    /// </summary>
    public static string WebViewDataFolder(string? home) =>
        Path.Combine(string.IsNullOrEmpty(home) ? DefaultHome() : home, "casca-win", "webview2");
}
