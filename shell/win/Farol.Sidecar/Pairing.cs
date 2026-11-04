using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Farol.Sidecar;

/// <summary>
/// O motor recusou o pareamento, ou respondeu algo que não é um pareamento. <see cref="Code"/>
/// é o motivo (do motor, como <c>codigo_invalido</c>, ou <c>http_&lt;status&gt;</c> e
/// <c>resposta_invalida</c>), nunca o código de pareamento.
/// </summary>
public sealed class PairingException : Exception
{
    public PairingException(string code, int? remaining = null)
        : base($"O motor recusou o pareamento: {code}.")
    {
        Code = code;
        Remaining = remaining;
    }

    public string Code { get; }

    /// <summary>Tentativas que o motor ainda aceita, quando ele diz.</summary>
    public int? Remaining { get; }
}

/// <summary>
/// Troca o código de uso único do casca.json por um token da A4 (<c>POST /api/auth/pair</c>).
/// Nem o código nem o token passam por log ou mensagem de erro.
/// </summary>
public static class Pairing
{
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(5);

    // Sem proxy: o pareamento só fala com 127.0.0.1.
    private static readonly HttpClient Client = new(new HttpClientHandler { UseProxy = false })
    {
        Timeout = Timeout.InfiniteTimeSpan,
    };

    /// <summary>
    /// Devolve o token. A recusa do motor (que chega com 200 e <c>ok: false</c>), status HTTP
    /// de erro e corpo que não é o esperado viram <see cref="PairingException"/>; falha de rede
    /// sobe como <see cref="HttpRequestException"/>, e o prazo de 5 s como cancelamento.
    /// </summary>
    public static async Task<string> PairAsync(int port, string code, string label = "Farol", CancellationToken ct = default)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(RequestTimeout);

        var payload = JsonSerializer.Serialize(new Dictionary<string, string>
        {
            ["codigo"] = code,
            ["rotulo"] = label,
        });
        using var request = new HttpRequestMessage(HttpMethod.Post, $"http://127.0.0.1:{port}/api/auth/pair");
        request.Headers.Host = $"127.0.0.1:{port}";
        request.Headers.Add("x-farol", "1");
        request.Content = new StringContent(payload, Encoding.UTF8);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");

        using var response = await Client.SendAsync(request, cts.Token).ConfigureAwait(false);
        var status = (int)response.StatusCode;
        if (status < 200 || status > 299)
        {
            throw new PairingException($"http_{status}");
        }
        var body = await response.Content.ReadAsByteArrayAsync(cts.Token).ConfigureAwait(false);
        return ReadToken(body);
    }

    private static string ReadToken(byte[] body)
    {
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(body);
        }
        catch (JsonException)
        {
            throw new PairingException("resposta_invalida");
        }
        using (doc)
        {
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("ok", out var ok)
                || (ok.ValueKind != JsonValueKind.True && ok.ValueKind != JsonValueKind.False))
            {
                throw new PairingException("resposta_invalida");
            }
            if (ok.ValueKind == JsonValueKind.False)
            {
                var reason = root.TryGetProperty("code", out var c) && c.ValueKind == JsonValueKind.String
                    ? c.GetString()
                    : null;
                int? remaining = root.TryGetProperty("restantes", out var r)
                    && r.ValueKind == JsonValueKind.Number
                    && r.TryGetInt32(out var n)
                        ? n
                        : null;
                throw new PairingException(string.IsNullOrEmpty(reason) ? "recusado" : reason, remaining);
            }
            if (root.TryGetProperty("token", out var t) && t.ValueKind == JsonValueKind.String
                && t.GetString() is { Length: > 0 } token)
            {
                return token;
            }
            throw new PairingException("resposta_invalida");
        }
    }
}
