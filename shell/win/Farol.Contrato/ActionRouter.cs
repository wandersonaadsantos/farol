namespace Farol.Contrato;

/// <summary>O que o clique num aviso faz.</summary>
public abstract record NoticeAction
{
    private NoticeAction()
    {
    }

    /// <summary>Abre o endereço no navegador padrão (só http e https chegam aqui).</summary>
    public sealed record OpenUrl(Uri Url) : NoticeAction;

    /// <summary>Mostra a janela e abre a caixa de revisão do PR (<c>owner/repo#N</c>).</summary>
    public sealed record FocusPr(string Pr) : NoticeAction;

    /// <summary>Só mostra a janela.</summary>
    public sealed record FocusWindow : NoticeAction;
}

/// <summary>
/// A regra do clique, a mesma da casca Mac: endereço presente abre o endereço; só o PR abre o
/// PR na janela; nenhum dos dois só mostra a janela. Endereço relativo ou com esquema que não
/// seja http ou https conta como ausente, porque o motor manda textos como <c>u</c> e, no Unix,
/// <c>/x</c> vira <c>file:///x</c>.
/// </summary>
public static class ActionRouter
{
    /// <summary>A ação do clique num aviso do motor.</summary>
    public static NoticeAction For(ShellEvent.Notice notice)
    {
        ArgumentNullException.ThrowIfNull(notice);
        return For(notice.Url, notice.Pr);
    }

    /// <summary>A mesma regra, a partir dos dois campos soltos (os argumentos do aviso clicado).</summary>
    public static NoticeAction For(Uri? url, string? pr)
    {
        if (url is not null && url.IsAbsoluteUri && (url.Scheme == Uri.UriSchemeHttp || url.Scheme == Uri.UriSchemeHttps))
        {
            return new NoticeAction.OpenUrl(url);
        }
        if (!string.IsNullOrEmpty(pr))
        {
            return new NoticeAction.FocusPr(pr);
        }
        return new NoticeAction.FocusWindow();
    }

    /// <summary>
    /// O caminho da interface que abre a caixa de revisão do PR: <c>/?pr=</c> e a referência
    /// codificada (<c>o/r#1</c> vira <c>/?pr=o%2Fr%231</c>), lido por <c>ui/pure/rota.js</c>.
    /// A codificação tira barra, espaço e arroba, então o resultado passa por
    /// <see cref="LocalUrl.For"/>.
    /// </summary>
    public static string PrPath(string pr)
    {
        ArgumentNullException.ThrowIfNull(pr);
        return "/?pr=" + Uri.EscapeDataString(pr);
    }
}
