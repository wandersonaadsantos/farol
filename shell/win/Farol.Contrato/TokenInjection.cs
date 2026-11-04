using System.Text.Json;

namespace Farol.Contrato;

/// <summary>
/// O script que a janela roda na criação de cada documento para entregar o token à interface,
/// que o lê de <c>localStorage</c> (<c>ui/transporte.js</c>).
/// </summary>
/// <remarks>
/// A interface só aceita token no formato <c>^[A-Za-z0-9_-]{43}$</c>, então um token de
/// verdade nunca precisa de escape. Mesmo assim ele sai como literal JSON pelo codificador
/// padrão, que escapa aspas, barra invertida, <c>&lt;</c>, <c>&gt;</c>, quebras de linha,
/// U+2028, U+2029 e todo caractere fora do ASCII: nada do token fecha o literal.
/// </remarks>
public static class TokenInjection
{
    /// <summary>A chave em que a interface procura o token.</summary>
    public const string StorageKey = "farol-auth-token";


    /// <summary>
    /// O script para <c>AddScriptToExecuteOnDocumentCreatedAsync</c>; token vazio devolve
    /// texto vazio (não há o que injetar). <c>localStorage</c> que lança fica calado.
    /// </summary>
    /// <remarks>
    /// O WebView2 roda esse script também nos quadros filhos, de qualquer origem; por isso o
    /// token só é gravado quando o documento é http em <c>127.0.0.1</c> ou <c>localhost</c>, na
    /// porta do motor.
    /// </remarks>
    public static string Script(string? token, int port)
    {
        if (string.IsNullOrEmpty(token))
        {
            return "";
        }
        return "try { if (" + LocalDocument(port) + ") { "
            + $"localStorage.setItem('{StorageKey}', {JsonSerializer.Serialize(token)});"
            + " } } catch (e) {}";
    }

    /// <summary>A condição JavaScript de documento do motor na porta dada.</summary>
    public static string LocalDocument(int port) =>
        "location.protocol === 'http:' && (location.hostname === '127.0.0.1' || location.hostname === 'localhost')"
        + $" && location.port === '{port.ToString(System.Globalization.CultureInfo.InvariantCulture)}'";
}
