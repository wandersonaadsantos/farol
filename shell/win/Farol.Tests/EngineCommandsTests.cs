using Farol.Sidecar;

namespace Farol.Tests;

/// <summary>O "Checar agora" da bandeja: o único POST da casca fora da autenticação.</summary>
public sealed class EngineCommandsTests
{
    [Fact]
    public async Task CheckNowPostsWithTheContractHeaders()
    {
        string? method = null, path = null, host = null, xFarol = null, auth = null;
        using var server = new FakeServer(async (ctx, _) =>
        {
            method = ctx.Request.HttpMethod;
            path = ctx.Request.Url?.AbsolutePath;
            host = ctx.Request.Headers["Host"];
            xFarol = ctx.Request.Headers["x-farol"];
            auth = ctx.Request.Headers["Authorization"];
            await FakeServer.Respond(ctx, 200, """{"ok":true}""");
        });

        Assert.True(await EngineCommands.CheckNowAsync(server.Port, "TOKEN"));

        Assert.Equal("POST", method);
        Assert.Equal("/api/check", path);
        Assert.Equal($"127.0.0.1:{server.Port}", host);
        Assert.Equal("1", xFarol);
        Assert.Equal("Bearer TOKEN", auth);
    }

    [Fact]
    public async Task RefusalIsFalse()
    {
        using var server = new FakeServer((ctx, _) => FakeServer.Respond(ctx, 401, """{"error":"nao_autenticado"}"""));

        Assert.False(await EngineCommands.CheckNowAsync(server.Port, "TOKEN"));
    }

    [Fact]
    public async Task ClosedPortIsFalseAndNeverThrows()
    {
        Assert.False(await EngineCommands.CheckNowAsync(FakeServer.FreePort(), "TOKEN"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public async Task WithoutTokenNothingIsSent(string? token)
    {
        using var server = new FakeServer((ctx, _) => FakeServer.Respond(ctx, 200, "{}"));

        Assert.False(await EngineCommands.CheckNowAsync(server.Port, token));
        Assert.Equal(0, server.Requests);
    }
}
