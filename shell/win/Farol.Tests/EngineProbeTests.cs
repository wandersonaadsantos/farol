using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using Farol.Sidecar;

namespace Farol.Tests;

/// <summary>
/// A sondagem de motor vivo contra um HttpListener falso em 127.0.0.1, a espera do
/// casca.json e os caminhos do motor embutido.
/// </summary>
public sealed class EngineProbeTests
{
    private static int FreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    /// <summary>
    /// Sobe um listener que responde com <paramref name="body"/>; sem <c>x-farol: 1</c>, com o
    /// Host errado ou fora de <c>/api/auth/status</c> responde 403, para provar que a sonda manda
    /// os dois cabeçalhos na rota certa.
    /// </summary>
    private static (HttpListener Listener, int Port) Serve(string body)
    {
        var port = FreePort();
        var listener = new HttpListener();
        listener.Prefixes.Add($"http://127.0.0.1:{port}/");
        listener.Start();
        _ = Task.Run(async () =>
        {
            while (listener.IsListening)
            {
                HttpListenerContext ctx;
                try
                {
                    ctx = await listener.GetContextAsync();
                }
                catch (Exception e) when (e is HttpListenerException or ObjectDisposedException or InvalidOperationException)
                {
                    return;
                }
                var ok = ctx.Request.Headers["x-farol"] == "1"
                    && ctx.Request.Headers["Host"] == $"127.0.0.1:{port}"
                    && ctx.Request.Url?.AbsolutePath == "/api/auth/status";
                ctx.Response.StatusCode = ok ? 200 : 403;
                ctx.Response.ContentType = "application/json";
                var bytes = Encoding.UTF8.GetBytes(ok ? body : """{"exigida":true}""");
                await ctx.Response.OutputStream.WriteAsync(bytes);
                ctx.Response.Close();
            }
        });
        return (listener, port);
    }

    [Fact]
    public async Task FarolAnsweringWithExigidaIsFarol()
    {
        var (listener, port) = Serve("""{"exigida":true,"autenticado":false}""");
        try
        {
            Assert.True(await EngineProbe.IsFarolAsync(port));
        }
        finally
        {
            listener.Close();
        }
    }

    [Fact]
    public async Task ObjectWithoutExigidaIsNotFarol()
    {
        var (listener, port) = Serve("{}");
        try
        {
            Assert.False(await EngineProbe.IsFarolAsync(port));
        }
        finally
        {
            listener.Close();
        }
    }

    [Fact]
    public async Task NonObjectBodyIsNotFarol()
    {
        var (listener, port) = Serve("""["exigida"]""");
        try
        {
            Assert.False(await EngineProbe.IsFarolAsync(port));
        }
        finally
        {
            listener.Close();
        }
    }

    [Fact]
    public async Task CallerCancellationPropagates()
    {
        var (listener, port) = Serve("""{"exigida":true}""");
        try
        {
            using var cts = new CancellationTokenSource();
            cts.Cancel();

            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => EngineProbe.IsFarolAsync(port, cts.Token));
        }
        finally
        {
            listener.Close();
        }
    }

    [Fact]
    public async Task ClosedPortIsNotFarol()
    {
        Assert.False(await EngineProbe.IsFarolAsync(FreePort()));
    }

    [Fact]
    public async Task WaitForEngineFileTimesOutWhenItNeverAppears()
    {
        var path = Path.Combine(Path.GetTempPath(), "farol-nunca-" + Guid.NewGuid().ToString("N"), "casca.json");
        var watch = Stopwatch.StartNew();

        await Assert.ThrowsAsync<TimeoutException>(
            () => EngineProbe.WaitForEngineFileAsync(path, TimeSpan.FromMilliseconds(500)));
        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(3));
    }

    [Fact]
    public async Task WaitForEngineFileIgnoresAFileOlderThanTheSpawn()
    {
        var dir = Path.Combine(Path.GetTempPath(), "farol-velho-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, "casca.json");
        try
        {
            await File.WriteAllTextAsync(path, """{"porta":1,"pid":1,"codigoPareamento":"VELHO"}""");
            File.SetLastWriteTimeUtc(path, DateTime.UtcNow.AddMinutes(-10));

            await Assert.ThrowsAsync<TimeoutException>(
                () => EngineProbe.WaitForEngineFileAsync(path, TimeSpan.FromMilliseconds(500), DateTimeOffset.UtcNow));
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public async Task WaitForEngineFileReturnsAFreshFile()
    {
        var dir = Path.Combine(Path.GetTempPath(), "farol-novo-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, "casca.json");
        try
        {
            var spawn = DateTimeOffset.UtcNow;
            await File.WriteAllTextAsync(path, """{"porta":4242,"pid":1,"codigoPareamento":"NOVO"}""");

            var file = await EngineProbe.WaitForEngineFileAsync(path, TimeSpan.FromSeconds(2), spawn);

            Assert.Equal(4242, file.Port);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void CurrentProcessIsAlive()
    {
        Assert.True(EngineProbe.IsProcessAlive(Environment.ProcessId));
    }

    [Fact]
    public void AbsentPidIsNotAlive()
    {
        Assert.False(EngineProbe.IsProcessAlive(int.MaxValue - 7));
        Assert.False(EngineProbe.IsProcessAlive(0));
        Assert.False(EngineProbe.IsProcessAlive(-1));
    }

    [Fact]
    public void BundledPathsAreUnderTheAppFolder()
    {
        var (node, server) = EngineLocator.Bundled();

        Assert.Equal(Path.Combine(AppContext.BaseDirectory, "engine", "node", "node.exe"), node);
        Assert.Equal(Path.Combine(AppContext.BaseDirectory, "engine", "app", "server.js"), server);
        // A pasta de saída dos testes não traz o motor embutido.
        Assert.False(EngineLocator.Found());
    }
}
