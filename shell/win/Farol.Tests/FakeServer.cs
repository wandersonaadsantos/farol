using System.Net;
using System.Net.Sockets;
using System.Text;

namespace Farol.Tests;

/// <summary>
/// Servidor HTTP falso em 127.0.0.1 para os testes da casca: cada pedido vai ao
/// <c>handler</c> com o número dele (começando em 1), e o servidor conta quantos chegaram.
/// </summary>
internal sealed class FakeServer : IDisposable
{
    private readonly HttpListener _listener = new();
    private int _requests;

    public FakeServer(Func<HttpListenerContext, int, Task> handler)
    {
        Port = FreePort();
        _listener.Prefixes.Add($"http://127.0.0.1:{Port}/");
        _listener.Start();
        _ = Task.Run(async () =>
        {
            while (_listener.IsListening)
            {
                HttpListenerContext ctx;
                try
                {
                    ctx = await _listener.GetContextAsync();
                }
                catch (Exception e) when (e is HttpListenerException or ObjectDisposedException or InvalidOperationException)
                {
                    return;
                }
                var n = Interlocked.Increment(ref _requests);
                _ = Task.Run(async () =>
                {
                    try
                    {
                        await handler(ctx, n);
                    }
                    catch (Exception e) when (e is HttpListenerException or ObjectDisposedException or IOException or InvalidOperationException)
                    {
                        // o cliente fechou a conexão no meio: nada a fazer no servidor falso
                    }
                });
            }
        });
    }

    public int Port { get; }

    public int Requests => Volatile.Read(ref _requests);

    public static int FreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    public static async Task Respond(HttpListenerContext ctx, int status, string body, string contentType = "application/json")
    {
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = contentType;
        var bytes = Encoding.UTF8.GetBytes(body);
        await ctx.Response.OutputStream.WriteAsync(bytes);
        ctx.Response.Close();
    }

    public void Dispose() => _listener.Close();
}
