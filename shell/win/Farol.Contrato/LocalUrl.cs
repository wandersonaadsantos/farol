namespace Farol.Contrato;

/// <summary>O endereço de um caminho da interface no motor local.</summary>
public static class LocalUrl
{
    /// <summary>
    /// <c>http://127.0.0.1:&lt;porta&gt;&lt;caminho&gt;</c>. O caminho tem de começar por <c>/</c> e
    /// não pode ter <c>//</c>, <c>\</c>, <c>@</c> nem espaço em branco: qualquer um deles poderia
    /// levar o endereço para outro host. Recusa com <see cref="ArgumentException"/>.
    /// </summary>
    public static Uri For(int port, string path)
    {
        ArgumentNullException.ThrowIfNull(path);
        if (port is < 1 or > 65535)
        {
            throw new ArgumentException("Porta fora do intervalo.", nameof(port));
        }
        if (!path.StartsWith('/') || path.Contains("//", StringComparison.Ordinal) || path.Contains('\\')
            || path.Contains('@') || path.Any(char.IsWhiteSpace) || path.Any(char.IsControl))
        {
            throw new ArgumentException("Caminho local inválido.", nameof(path));
        }
        return new Uri($"http://127.0.0.1:{port}{path}");
    }
}
