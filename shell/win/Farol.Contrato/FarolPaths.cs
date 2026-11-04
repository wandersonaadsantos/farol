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

    /// <summary>
    /// O home em uso: o <c>FAROL_HOME</c> do ambiente quando definido (o motor também o
    /// respeita), senão o padrão. Recebe o valor da variável para o teste não mexer no ambiente.
    /// </summary>
    public static string Home(string? farolHome) =>
        string.IsNullOrEmpty(farolHome) ? DefaultHome() : farolHome;

    /// <summary>O <c>casca.json</c> do motor (<c>CASCA_FILE</c>): <c>&lt;home&gt;/state</c>, fora do workspace.</summary>
    public static string EngineFilePath(string home) => Path.Combine(home, "state", "casca.json");

    /// <summary>
    /// O <c>STATE_DIR</c> do motor (<c>&lt;home&gt;/workspace/state</c>), onde o update grava o
    /// marcador da reabertura silenciosa.
    /// </summary>
    public static string EngineStateDir(string home) => Path.Combine(home, "workspace", "state");

    /// <summary>O log de falhas da casca, ao lado dos dados do WebView2.</summary>
    public static string ShellLogFile(string home) => Path.Combine(home, "casca-win", "casca.log");
}
