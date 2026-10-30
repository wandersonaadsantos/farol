namespace Farol.Contrato;

/// <summary>
/// O que a janela abre dentro dela: só a interface do motor, em
/// <c>http://127.0.0.1:&lt;porta&gt;</c> ou <c>http://localhost:&lt;porta&gt;</c>. Todo o resto
/// (links do GitHub, outro host, outra porta, outro esquema) vai para o navegador padrão.
/// </summary>
public static class ExternalLinkPolicy
{
    /// <summary>Verdadeiro só para o endereço do motor, com esquema http e a porta exata.</summary>
    public static bool IsLocal(Uri uri, int port)
    {
        if (!uri.IsAbsoluteUri || uri.Scheme != Uri.UriSchemeHttp || uri.Port != port || uri.UserInfo.Length > 0)
        {
            return false;
        }
        var host = uri.Host;
        return host == "127.0.0.1" || string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase);
    }
}
