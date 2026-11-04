namespace Farol.Contrato;

/// <summary>
/// Os avisos que a própria casca monta. Os do motor chegam prontos pelo evento
/// <c>aviso-nativo</c>; estes nascem de coisas que só a casca vê.
/// </summary>
public static class ShellNotices
{
    /// <summary>A casca abriu como visor de um motor que ela não lançou.</summary>
    public static readonly ShellEvent.Notice Viewer = new(
        "Farol",
        "Outro Farol já está rodando nesta porta; esta janela só mostra o que ele faz",
        null,
        null,
        false);

    /// <summary>O Farol voltou de um update (a reabertura silenciosa).</summary>
    public static ShellEvent.Notice Updated(string version) => new(
        "Farol atualizado",
        string.IsNullOrWhiteSpace(version) ? "Nova versão pronta." : $"Versão {version.Trim()} pronta.",
        null,
        null,
        false);

    /// <summary>A casca desistiu de religar o motor.</summary>
    public static ShellEvent.Notice Failure(string reason) => new(
        "O Farol parou",
        Sentence(reason),
        null,
        null,
        false);

    /// <summary>O texto da janela quando a casca desiste de religar o motor.</summary>
    public static string FailureText(string reason) =>
        string.IsNullOrWhiteSpace(reason) ? "O Farol parou." : $"O Farol parou: {reason.Trim().TrimEnd('.')}.";

    private static string Sentence(string reason)
    {
        var text = (reason ?? "").Trim().TrimEnd('.');
        if (text.Length == 0)
        {
            return "O motor saiu e não foi religado.";
        }
        return char.ToUpperInvariant(text[0]) + text[1..] + ".";
    }
}
