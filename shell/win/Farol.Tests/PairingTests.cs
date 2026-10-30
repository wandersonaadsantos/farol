using System.Net;
using System.Text.Json;
using Farol.Sidecar;

namespace Farol.Tests;

/// <summary>O pareamento contra um motor falso: corpo, cabeçalhos e as três formas de recusa.</summary>
public sealed class PairingTests
{
    // Sem x-farol: 1, no Host errado ou fora de POST /api/auth/pair responde 403, como o motor.
    private static bool Valid(HttpListenerContext ctx, int port) =>
        ctx.Request.HttpMethod == "POST"
        && ctx.Request.Url?.AbsolutePath == "/api/auth/pair"
        && ctx.Request.Headers["x-farol"] == "1"
        && ctx.Request.Headers["Host"] == $"127.0.0.1:{port}"
        && (ctx.Request.ContentType ?? "").StartsWith("application/json", StringComparison.Ordinal);

    private static async Task<JsonDocument> ReadBody(HttpListenerContext ctx)
    {
        using var reader = new StreamReader(ctx.Request.InputStream);
        return JsonDocument.Parse(await reader.ReadToEndAsync());
    }

    [Fact]
    public async Task SuccessReturnsTheToken()
    {
        string? codigo = null;
        string? rotulo = null;
        FakeServer? server = null;
        server = new FakeServer(async (ctx, _) =>
        {
            if (!Valid(ctx, server!.Port))
            {
                await FakeServer.Respond(ctx, 403, """{"error":"forbidden"}""");
                return;
            }
            using var body = await ReadBody(ctx);
            codigo = body.RootElement.GetProperty("codigo").GetString();
            rotulo = body.RootElement.GetProperty("rotulo").GetString();
            await FakeServer.Respond(ctx, 200, """{"ok":true,"token":"T1"}""");
        });
        using (server)
        {
            var token = await Pairing.PairAsync(server.Port, "ABCDE12345");

            Assert.Equal("T1", token);
            Assert.Equal("ABCDE12345", codigo);
            Assert.Equal("Farol", rotulo);
        }
    }

    [Fact]
    public async Task RefusalCarriesCodeAndRemaining()
    {
        using var server = new FakeServer((ctx, _) =>
            FakeServer.Respond(ctx, 200, """{"ok":false,"code":"codigo_invalido","restantes":2}"""));

        var e = await Assert.ThrowsAsync<PairingException>(() => Pairing.PairAsync(server.Port, "X", "Casca"));

        Assert.Equal("codigo_invalido", e.Code);
        Assert.Equal(2, e.Remaining);
    }

    [Fact]
    public async Task ServerErrorIsHttpStatus()
    {
        using var server = new FakeServer((ctx, _) => FakeServer.Respond(ctx, 500, """{"error":"x"}"""));

        var e = await Assert.ThrowsAsync<PairingException>(() => Pairing.PairAsync(server.Port, "X"));

        Assert.Equal("http_500", e.Code);
        Assert.Null(e.Remaining);
    }

    [Fact]
    public async Task NonJsonIsInvalidResponse()
    {
        using var server = new FakeServer((ctx, _) => FakeServer.Respond(ctx, 200, "<html>", "text/html"));

        var e = await Assert.ThrowsAsync<PairingException>(() => Pairing.PairAsync(server.Port, "X"));

        Assert.Equal("resposta_invalida", e.Code);
    }

    [Fact]
    public async Task OkWithoutTokenIsInvalidResponse()
    {
        using var server = new FakeServer((ctx, _) => FakeServer.Respond(ctx, 200, """{"ok":true}"""));

        var e = await Assert.ThrowsAsync<PairingException>(() => Pairing.PairAsync(server.Port, "X"));

        Assert.Equal("resposta_invalida", e.Code);
    }

    [Fact]
    public async Task ExceptionMessageNeverCarriesThePairingCode()
    {
        using var server = new FakeServer((ctx, _) =>
            FakeServer.Respond(ctx, 200, """{"ok":false,"code":"codigo_invalido","restantes":0}"""));

        var e = await Assert.ThrowsAsync<PairingException>(() => Pairing.PairAsync(server.Port, "SEGREDO123"));

        Assert.DoesNotContain("SEGREDO123", e.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ClosedPortPropagatesTheNetworkFailure()
    {
        await Assert.ThrowsAsync<HttpRequestException>(() => Pairing.PairAsync(FakeServer.FreePort(), "X"));
    }
}
