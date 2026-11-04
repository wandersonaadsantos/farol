namespace Farol.Sidecar;

/// <summary>
/// Os pedidos que a casca faz ao motor fora do pareamento. Só existe um: o "Checar agora" da
/// bandeja (<c>POST /api/check</c>), o único POST da casca além da autenticação.
/// </summary>
public static class EngineCommands
{
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(5);

    // Sem proxy: só fala com 127.0.0.1.
    private static readonly HttpClient Client = new(new HttpClientHandler { UseProxy = false })
    {
        Timeout = Timeout.InfiniteTimeSpan,
    };

    /// <summary>
    /// Pede ao motor uma checagem agora. Verdadeiro só com resposta 2xx; sem token não envia
    /// nada, e qualquer falha (porta fechada, recusa, prazo de 5 s) devolve falso sem lançar.
    /// </summary>
    public static async Task<bool> CheckNowAsync(int port, string? token, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(token))
        {
            return false;
        }
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(RequestTimeout);
            using var request = new HttpRequestMessage(HttpMethod.Post, $"http://127.0.0.1:{port}/api/check");
            request.Headers.Host = $"127.0.0.1:{port}";
            request.Headers.Add("x-farol", "1");
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            request.Content = new StringContent("{}", System.Text.Encoding.UTF8, "application/json");
            using var response = await Client.SendAsync(request, cts.Token).ConfigureAwait(false);
            return response.IsSuccessStatusCode;
        }
        catch (Exception)
        {
            return false;
        }
    }
}
