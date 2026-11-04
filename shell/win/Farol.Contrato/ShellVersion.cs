using System.Globalization;

namespace Farol.Contrato;

/// <summary>
/// A versão que a casca informa ao motor em <c>FAROL_SHELL_VERSION</c> (só <c>X.Y.Z</c>), que o
/// bootstrap e o update do motor conferem contra o <c>engines.farolShell</c> do pacote.
/// </summary>
public static class ShellVersion
{
    /// <summary>
    /// A versão de quando o pacote não diz a dele (executável rodando fora do MSIX). Tem de ser
    /// a mesma do <c>Package.appxmanifest</c>.
    /// </summary>
    public const string Fallback = "3.0.0";

    /// <summary>Os três primeiros números da versão do pacote (o quarto, de revisão, fica de fora).</summary>
    public static string From(int major, int minor, int build) =>
        string.Create(CultureInfo.InvariantCulture, $"{major}.{minor}.{build}");
}
