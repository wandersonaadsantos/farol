using System.Globalization;
using System.Text.RegularExpressions;

namespace Farol.Contrato;

/// <summary>As constantes do motor que a casca precisa conhecer sem ler a config dele.</summary>
public static class EngineDefaults
{
    /// <summary>A porta padrão do motor (<c>DEFAULT_PORT</c> de <c>lib/constants.js</c>).</summary>
    public const int Port = 47170;
}

/// <summary>
/// A porta que o motor não conseguiu abrir porque outro processo a ocupa, lida das últimas linhas
/// do stderr dele. O <c>server.js</c> imprime o <c>err.message</c> do Node
/// (<c>listen EADDRINUSE: address already in use 127.0.0.1:47170</c>); o objeto de erro do Node,
/// quando impresso inteiro, traz <c>port: 47170</c> depois de <c>code: 'EADDRINUSE'</c>.
/// </summary>
public static partial class BusyPort
{
    /// <summary>A porta, ou <c>null</c> sem linha de <c>EADDRINUSE</c> com uma porta válida.</summary>
    public static int? FromStderr(IEnumerable<string> lines)
    {
        ArgumentNullException.ThrowIfNull(lines);
        var sawCode = false;
        foreach (var line in lines)
        {
            if (string.IsNullOrEmpty(line))
            {
                continue;
            }
            if (line.Contains("EADDRINUSE", StringComparison.Ordinal))
            {
                sawCode = true;
                if (Message().Match(line) is { Success: true } message && Valid(message.Groups[1].Value) is { } port)
                {
                    return port;
                }
                continue;
            }
            if (sawCode && Field().Match(line) is { Success: true } field && Valid(field.Groups[1].Value) is { } fieldPort)
            {
                return fieldPort;
            }
        }
        return null;
    }

    private static int? Valid(string digits) =>
        int.TryParse(digits, NumberStyles.None, CultureInfo.InvariantCulture, out var port) && port is > 0 and <= 65535
            ? port
            : null;

    // "address already in use <host>:<porta>", com host IPv4, nome, ::: ou [::1].
    [GeneratedRegex(@"EADDRINUSE.*in use\s+\S*:(\d{1,5})\s*$")]
    private static partial Regex Message();

    [GeneratedRegex(@"^\s*port:\s*(\d{1,5})\s*,?\s*$")]
    private static partial Regex Field();
}
