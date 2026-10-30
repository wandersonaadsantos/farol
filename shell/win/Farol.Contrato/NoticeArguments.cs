namespace Farol.Contrato;

/// <summary>
/// Os argumentos que viajam dentro do aviso do Windows e voltam no clique, mesmo depois de o
/// Farol ter sido fechado e aberto de novo. Só levam o que o roteador lê (<c>url</c> e
/// <c>pr</c>) e a marca <c>kind=notice</c>; título e corpo nunca entram.
/// </summary>
public static class NoticeArguments
{
    /// <summary>A marca que diz que os argumentos são de um aviso do Farol.</summary>
    public const string Kind = "notice";

    /// <summary>
    /// Forma de texto, no estilo <c>application/x-www-form-urlencoded</c>: <c>kind=notice</c>,
    /// e <c>url</c> e <c>pr</c> codificados quando existem.
    /// </summary>
    public static string Encode(ShellEvent.Notice notice)
    {
        ArgumentNullException.ThrowIfNull(notice);
        var parts = new List<string>(3);
        foreach (var (key, value) in Pairs(notice))
        {
            parts.Add(Uri.EscapeDataString(key) + "=" + Uri.EscapeDataString(value));
        }
        return string.Join('&', parts);
    }

    /// <summary>
    /// Os mesmos pares que <see cref="Encode"/> codifica, na ordem: é o que o aviso real recebe
    /// pelo construtor do Windows, que codifica do jeito dele.
    /// </summary>
    public static IReadOnlyList<KeyValuePair<string, string>> Pairs(ShellEvent.Notice notice)
    {
        ArgumentNullException.ThrowIfNull(notice);
        var pairs = new List<KeyValuePair<string, string>>(3) { new("kind", Kind) };
        // Valor vazio nunca vira argumento: o construtor do aviso do Windows não o aceita.
        if (notice.Url is not null && !string.IsNullOrWhiteSpace(notice.Url.OriginalString))
        {
            pairs.Add(new("url", notice.Url.OriginalString));
        }
        if (!string.IsNullOrWhiteSpace(notice.Pr))
        {
            pairs.Add(new("pr", notice.Pr));
        }
        return pairs;
    }

    /// <summary>Lê de volta a forma de texto e aplica a regra de <see cref="ActionRouter"/>.</summary>
    public static NoticeAction Decode(string arguments)
    {
        ArgumentNullException.ThrowIfNull(arguments);
        var pairs = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var part in arguments.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var eq = part.IndexOf('=');
            if (eq <= 0)
            {
                continue;
            }
            pairs[Uri.UnescapeDataString(part[..eq])] = Uri.UnescapeDataString(part[(eq + 1)..]);
        }
        return FromPairs(pairs);
    }

    /// <summary>
    /// A ação a partir dos pares já decodificados (o dicionário que o Windows entrega no clique).
    /// Sem a marca <c>kind=notice</c> os argumentos não são de um aviso do Farol, e o clique só
    /// mostra a janela.
    /// </summary>
    public static NoticeAction FromPairs(IReadOnlyDictionary<string, string> pairs)
    {
        ArgumentNullException.ThrowIfNull(pairs);
        if (!pairs.TryGetValue("kind", out var kind) || kind != Kind)
        {
            return new NoticeAction.FocusWindow();
        }
        Uri? url = null;
        if (pairs.TryGetValue("url", out var text))
        {
            Uri.TryCreate(text, UriKind.Absolute, out url);
        }
        pairs.TryGetValue("pr", out var pr);
        return ActionRouter.For(url, pr);
    }
}
