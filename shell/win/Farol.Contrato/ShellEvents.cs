using System.Text.Json;

namespace Farol.Contrato;

/// <summary>
/// Os eventos SSE que a casca lê do motor. Só três são decodificados (<c>aviso-nativo</c>,
/// <c>casca</c> e <c>casca-saida</c>); qualquer outro, inclusive <c>state</c> e
/// <c>state-patch</c>, vira <see cref="Other"/> sem que o corpo seja sequer lido.
/// </summary>
public abstract record ShellEvent
{
    private ShellEvent()
    {
    }

    /// <summary>Uma notificação pronta, montada pelo motor.</summary>
    /// <remarks>
    /// <see cref="Url"/> aceita endereço relativo para não perder o que o motor mandou;
    /// quem abre o link precisa aceitar só http e https, porque no Unix um texto como
    /// <c>/x</c> vira <c>file:///x</c> absoluto.
    /// </remarks>
    public sealed record Notice(string Title, string Body, Uri? Url, string? Pr, bool Silent) : ShellEvent;

    /// <summary>O retrato da casca: badge, ocupado, abrir com o sistema e as cores da janela.</summary>
    public sealed record Shell(int BadgeCount, string BadgeLabel, bool Busy, bool Autostart, string ColorBg, string ColorSymbol) : ShellEvent;

    /// <summary>O motor vai sair de propósito (código 75); a casca religa na hora.</summary>
    public sealed record Exit(string Reason, string? NextVersion) : ShellEvent;

    /// <summary>Evento que a casca não lê.</summary>
    public sealed record Other(string Name) : ShellEvent;

    /// <summary>
    /// Decodifica o corpo de um evento. JSON malformado, ou que não seja objeto, devolve
    /// <c>null</c>; campo ausente num objeto bem formado cai no valor neutro e nunca lança.
    /// </summary>
    public static ShellEvent? Decode(string name, ReadOnlySpan<byte> data) => name switch
    {
        "aviso-nativo" => WithObject(data, DecodeNotice),
        "casca" => WithObject(data, DecodeShell),
        "casca-saida" => WithObject(data, DecodeExit),
        _ => new Other(name),
    };

    private static ShellEvent? WithObject(ReadOnlySpan<byte> data, Func<JsonElement, ShellEvent> decode)
    {
        try
        {
            var reader = new Utf8JsonReader(data);
            using var doc = JsonDocument.ParseValue(ref reader);
            return doc.RootElement.ValueKind == JsonValueKind.Object ? decode(doc.RootElement) : null;
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException)
        {
            return null;
        }
    }

    private static ShellEvent DecodeNotice(JsonElement root)
    {
        var url = Json.String(root, "url");
        Uri? uri = null;
        if (url is not null)
        {
            Uri.TryCreate(url, UriKind.RelativeOrAbsolute, out uri);
        }
        return new Notice(
            Json.String(root, "titulo") ?? "",
            Json.String(root, "corpo") ?? "",
            uri,
            Json.String(root, "pr"),
            Json.Bool(root, "silencioso"));
    }

    private static ShellEvent DecodeShell(JsonElement root)
    {
        var badge = Json.Object(root, "badge");
        var colors = Json.Object(root, "cores");
        Json.TryInt(badge, "contador", out var count);
        return new Shell(
            count,
            Json.String(badge, "rotulo") ?? "",
            Json.Bool(root, "ocupado"),
            Json.Bool(root, "autostart"),
            Json.String(colors, "bg") ?? "",
            Json.String(colors, "symbol") ?? "");
    }

    private static ShellEvent DecodeExit(JsonElement root) =>
        new Exit(Json.String(root, "motivo") ?? "", Json.String(root, "proximaVersao"));
}
