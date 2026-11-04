using System.Net;
using System.Text;
using Farol.Contrato;
using Farol.Sidecar;

namespace Farol.Tests;

/// <summary>
/// O cliente SSE contra um motor falso: só três eventos chegam ao consumidor, o 401 vira um
/// único <see cref="ShellEvent.Unauthorized"/> sem religar, e a queda religa com recuo.
/// </summary>
public sealed class EventStreamTests
{
    private const string Token = "tok-de-teste";

    private const string CascaBody =
        """{"badge":{"contador":3,"rotulo":"3"},"ocupado":true,"autostart":false,"cores":{"bg":"#000000","symbol":"#ffffff"}}""";

    private const string AvisoBody =
        """{"titulo":"Farol · PR aguardando sua revisão","corpo":"o/r#1: T","url":"https://github.com/o/r/pull/1","pr":"o/r#1","silencioso":false}""";

    private static readonly TimeSpan Wait = TimeSpan.FromSeconds(5);

    // Sem Bearer certo, sem x-farol: 1, no Host errado ou fora de GET /api/events responde 403.
    private static bool Valid(HttpListenerContext ctx, int port) =>
        ctx.Request.HttpMethod == "GET"
        && ctx.Request.Url?.AbsolutePath == "/api/events"
        && ctx.Request.Headers["Authorization"] == $"Bearer {Token}"
        && ctx.Request.Headers["x-farol"] == "1"
        && ctx.Request.Headers["Host"] == $"127.0.0.1:{port}";

    private static async Task Stream(HttpListenerContext ctx, params (string Name, string Data)[] events)
    {
        ctx.Response.StatusCode = 200;
        ctx.Response.ContentType = "text/event-stream";
        ctx.Response.SendChunked = true;
        foreach (var (name, data) in events)
        {
            var bytes = Encoding.UTF8.GetBytes($"event: {name}\ndata: {data}\n\n");
            await ctx.Response.OutputStream.WriteAsync(bytes);
            await ctx.Response.OutputStream.FlushAsync();
        }
        ctx.Response.Close();
    }

    private static async Task<ShellEvent> Next(IAsyncEnumerator<ShellEvent> events)
    {
        var move = events.MoveNextAsync().AsTask();
        var done = await Task.WhenAny(move, Task.Delay(Wait));
        Assert.True(done == move, "o evento não chegou a tempo");
        Assert.True(await move, "o fluxo terminou antes do evento");
        return events.Current;
    }

    private static async Task<List<ShellEvent>> Drain(EventStream stream)
    {
        var rest = new List<ShellEvent>();
        await foreach (var e in stream.Events)
        {
            rest.Add(e);
        }
        return rest;
    }

    [Fact]
    public async Task OnlyShellNoticeAndExitReachTheConsumer()
    {
        var bigState = "{\"itens\":\"" + new string('x', 100 * 1024) + "\"}";
        FakeServer? server = null;
        server = new FakeServer(async (ctx, n) =>
        {
            if (n > 1 || !Valid(ctx, server!.Port))
            {
                await FakeServer.Respond(ctx, 403, """{"error":"forbidden"}""");
                return;
            }
            await Stream(ctx,
                ("ping", "1730000000000"),
                ("state", bigState),
                ("state-patch", "{nao e json"),
                ("casca", CascaBody),
                ("aviso-nativo", AvisoBody));
        });
        using (server)
        {
            var stream = new EventStream(server.Port, Token);
            stream.Start();
            await using var events = stream.Events.GetAsyncEnumerator();

            var first = await Next(events);
            var second = await Next(events);
            stream.Stop();

            var shell = Assert.IsType<ShellEvent.Shell>(first);
            Assert.Equal(3, shell.BadgeCount);
            var notice = Assert.IsType<ShellEvent.Notice>(second);
            Assert.Equal("o/r#1", notice.Pr);
            Assert.False(await events.MoveNextAsync());
        }
    }

    [Fact]
    public async Task UnauthorizedIsEmittedOnceAndStopsReconnecting()
    {
        using var server = new FakeServer((ctx, _) =>
            FakeServer.Respond(ctx, 401, """{"error":"nao_autenticado"}"""));
        var stream = new EventStream(server.Port, Token, initialBackoff: TimeSpan.FromMilliseconds(50));
        stream.Start();
        await using var events = stream.Events.GetAsyncEnumerator();

        Assert.IsType<ShellEvent.Unauthorized>(await Next(events));
        await Task.Delay(TimeSpan.FromSeconds(1));

        Assert.Equal(1, server.Requests);
        Assert.False(stream.IsRunning);
        stream.Stop();
        Assert.Empty(await Drain(stream));
    }

    [Fact]
    public async Task ReconnectsAfterTheStreamEnds()
    {
        FakeServer? server = null;
        server = new FakeServer(async (ctx, n) =>
        {
            if (!Valid(ctx, server!.Port))
            {
                await FakeServer.Respond(ctx, 403, """{"error":"forbidden"}""");
                return;
            }
            if (n == 1)
            {
                await Stream(ctx, ("casca", CascaBody));
                return;
            }
            await Stream(ctx, ("aviso-nativo", AvisoBody));
        });
        using (server)
        {
            var stream = new EventStream(server.Port, Token, initialBackoff: TimeSpan.FromMilliseconds(50));
            stream.Start();
            await using var events = stream.Events.GetAsyncEnumerator();

            Assert.IsType<ShellEvent.Shell>(await Next(events));
            Assert.IsType<ShellEvent.Notice>(await Next(events));
            stream.Stop();

            Assert.True(server.Requests >= 2);
        }
    }

    [Fact]
    public async Task StartAgainAfterStopOpensANewStream()
    {
        FakeServer? server = null;
        server = new FakeServer(async (ctx, _) =>
        {
            if (!Valid(ctx, server!.Port))
            {
                await FakeServer.Respond(ctx, 403, """{"error":"forbidden"}""");
                return;
            }
            await Stream(ctx, ("casca-saida", """{"motivo":"update","proximaVersao":"3.1.0"}"""));
        });
        using (server)
        {
            var stream = new EventStream(server.Port, Token);
            stream.Start();
            await using (var first = stream.Events.GetAsyncEnumerator())
            {
                Assert.IsType<ShellEvent.Exit>(await Next(first));
            }
            stream.Stop();
            Assert.False(stream.IsRunning);

            stream.Start();
            Assert.True(stream.IsRunning);
            await using var second = stream.Events.GetAsyncEnumerator();
            var exit = Assert.IsType<ShellEvent.Exit>(await Next(second));
            stream.Stop();

            Assert.Equal("3.1.0", exit.NextVersion);
        }
    }

    [Fact]
    public async Task StartAfterStopWithUndrainedEventsDeliversTheNewStream()
    {
        var firstSent = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        FakeServer? server = null;
        server = new FakeServer(async (ctx, n) =>
        {
            if (!Valid(ctx, server!.Port))
            {
                await FakeServer.Respond(ctx, 403, """{"error":"forbidden"}""");
                return;
            }
            if (n == 1)
            {
                await Stream(ctx, ("casca", CascaBody));
                firstSent.SetResult();
                return;
            }
            await Stream(ctx, ("casca", CascaBody.Replace("\"contador\":3", "\"contador\":7", StringComparison.Ordinal)));
        });
        using (server)
        {
            var stream = new EventStream(server.Port, Token);
            stream.Start();
            await firstSent.Task.WaitAsync(Wait);
            // folga para o cliente enfileirar o evento, que fica sem ser lido
            await Task.Delay(300);
            stream.Stop();

            stream.Start();
            await using var events = stream.Events.GetAsyncEnumerator();
            var shell = Assert.IsType<ShellEvent.Shell>(await Next(events));
            stream.Stop();

            Assert.Equal(7, shell.BadgeCount);
        }
    }

    [Fact]
    public async Task RepeatedFailuresLogOneLineAndCleanEndsLogNothing()
    {
        var lines = new List<string>();
        using var failing = new FakeServer((ctx, _) => FakeServer.Respond(ctx, 500, """{"error":"x"}"""));
        var stream = new EventStream(failing.Port, Token, line => { lock (lines) { lines.Add(line); } },
            initialBackoff: TimeSpan.FromMilliseconds(10));
        stream.Start();
        while (failing.Requests < 4)
        {
            await Task.Delay(20);
        }
        stream.Stop();
        lock (lines)
        {
            Assert.Single(lines);
            Assert.DoesNotContain(Token, lines[0], StringComparison.Ordinal);
            lines.Clear();
        }

        using var clean = new FakeServer((ctx, _) => Stream(ctx, ("casca", CascaBody)));
        var healthy = new EventStream(clean.Port, Token, line => { lock (lines) { lines.Add(line); } },
            initialBackoff: TimeSpan.FromMilliseconds(10));
        healthy.Start();
        while (clean.Requests < 4)
        {
            await Task.Delay(20);
        }
        healthy.Stop();
        lock (lines)
        {
            Assert.Empty(lines);
        }
    }

    [Fact]
    public async Task LogNeverCarriesTheToken()
    {
        var lines = new List<string>();
        using var server = new FakeServer((ctx, _) =>
            FakeServer.Respond(ctx, 401, """{"error":"nao_autenticado"}"""));
        var stream = new EventStream(server.Port, Token, line => { lock (lines) { lines.Add(line); } });
        stream.Start();
        await using var events = stream.Events.GetAsyncEnumerator();

        Assert.IsType<ShellEvent.Unauthorized>(await Next(events));
        stream.Stop();

        lock (lines)
        {
            Assert.NotEmpty(lines);
            Assert.All(lines, l => Assert.DoesNotContain(Token, l, StringComparison.Ordinal));
        }
    }

    [Fact]
    public void BackoffDoublesUpToTheCeiling()
    {
        var schedule = new List<double>();
        var current = EventStream.Reconnect.InitialBackoff;
        for (var i = 0; i < 6; i++)
        {
            schedule.Add(current.TotalSeconds);
            current = EventStream.NextBackoff(current);
        }

        Assert.Equal(new double[] { 3, 6, 12, 24, 30, 30 }, schedule);
        Assert.Equal(TimeSpan.FromSeconds(30), EventStream.Reconnect.MaxBackoff);
    }
}
