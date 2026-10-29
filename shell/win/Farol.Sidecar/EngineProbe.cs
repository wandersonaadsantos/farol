using System.Diagnostics;
using System.Text.Json;
using Farol.Contrato;

namespace Farol.Sidecar;

/// <summary>
/// Perguntas curtas sobre o motor: a porta responde como Farol, o casca.json do motor novo
/// já apareceu, o pid ainda vive.
/// </summary>
public static class EngineProbe
{
    private static readonly TimeSpan ProbeTimeout = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(200);

    // Folga entre o relógio de quem grava o arquivo e o instante do spawn anotado pela casca.
    private static readonly TimeSpan WriteTimeTolerance = TimeSpan.FromSeconds(2);

    // Sem proxy: a sonda só fala com 127.0.0.1, e um proxy do sistema não tem nada a fazer aí.
    private static readonly HttpClient Client = new(new HttpClientHandler { UseProxy = false })
    {
        Timeout = Timeout.InfiniteTimeSpan,
    };

    /// <summary>
    /// A porta responde como um Farol: <c>GET /api/auth/status</c> (rota pública) devolve 200
    /// com um objeto JSON que tem a chave <c>exigida</c>. Qualquer falha, inclusive o prazo de
    /// 2 s, vale como não.
    /// </summary>
    public static async Task<bool> IsFarolAsync(int port, CancellationToken ct = default)
    {
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(ProbeTimeout);
            using var request = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{port}/api/auth/status");
            request.Headers.Host = $"127.0.0.1:{port}";
            request.Headers.Add("x-farol", "1");
            using var response = await Client.SendAsync(request, cts.Token).ConfigureAwait(false);
            if ((int)response.StatusCode != 200)
            {
                return false;
            }
            var body = await response.Content.ReadAsStringAsync(cts.Token).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(body);
            return doc.RootElement.ValueKind == JsonValueKind.Object
                && doc.RootElement.TryGetProperty("exigida", out _);
        }
        catch (Exception)
        {
            // Porta fechada, outro programa, corpo que não é JSON, prazo: nada disso é um Farol.
            return false;
        }
    }

    /// <summary>
    /// Espera o motor gravar o casca.json, conferindo a cada 200 ms. Com <paramref name="notBefore"/>
    /// (o instante do spawn), um arquivo gravado antes dele, com 2 s de folga, é de um motor
    /// anterior e é ignorado. Passado o <paramref name="timeout"/>, lança <see cref="TimeoutException"/>.
    /// </summary>
    public static async Task<EngineFile> WaitForEngineFileAsync(
        string path,
        TimeSpan timeout,
        DateTimeOffset? notBefore = null,
        CancellationToken ct = default)
    {
        var watch = Stopwatch.StartNew();
        while (true)
        {
            ct.ThrowIfCancellationRequested();
            if (EngineFile.Read(path) is { } file && IsFresh(path, notBefore))
            {
                return file;
            }
            var left = timeout - watch.Elapsed;
            if (left <= TimeSpan.Zero)
            {
                throw new TimeoutException($"O motor não gravou o casca.json em {timeout.TotalSeconds:0.#} s.");
            }
            await Task.Delay(left < PollInterval ? left : PollInterval, ct).ConfigureAwait(false);
        }
    }

    private static bool IsFresh(string path, DateTimeOffset? notBefore)
    {
        if (notBefore is not { } limit)
        {
            return true;
        }
        try
        {
            var written = new DateTimeOffset(File.GetLastWriteTimeUtc(path), TimeSpan.Zero);
            return written >= limit - WriteTimeTolerance;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    /// <summary>O processo com este pid existe e não terminou.</summary>
    public static bool IsProcessAlive(int pid)
    {
        if (pid <= 0)
        {
            return false;
        }
        try
        {
            using var process = Process.GetProcessById(pid);
            return !process.HasExited;
        }
        catch (Exception e) when (e is ArgumentException or InvalidOperationException
            or System.ComponentModel.Win32Exception or NotSupportedException)
        {
            return false;
        }
    }
}
