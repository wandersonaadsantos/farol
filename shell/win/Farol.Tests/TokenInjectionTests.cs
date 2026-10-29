using System.Text.Json;
using Farol.Contrato;

namespace Farol.Tests;

public class TokenInjectionTests
{
    private const string Prefix = "localStorage.setItem('farol-auth-token', ";
    private const string Suffix = "); } } catch (e) {}";

    // Tira do script o literal que vai como segundo argumento do setItem.
    private static string Literal(string script)
    {
        var start = script.IndexOf(Prefix, StringComparison.Ordinal);
        Assert.True(start >= 0);
        Assert.EndsWith(Suffix, script);
        return script[(start + Prefix.Length)..^Suffix.Length];
    }

    [Fact]
    public void ScriptSetsTheTokenInLocalStorage()
    {
        var token = "abcDEF0123456789_-abcDEF0123456789_-abcdefg";
        var script = TokenInjection.Script(token);

        Assert.Contains("localStorage.setItem('farol-auth-token'", script);
        Assert.Contains(token, script);
        Assert.Equal(token, JsonSerializer.Deserialize<string>(Literal(script)));
    }

    [Fact]
    public void StorageKeyIsTheOneTheUiReads()
    {
        Assert.Equal("farol-auth-token", TokenInjection.StorageKey);
    }

    [Fact]
    public void ScriptIsWrappedInTryCatch()
    {
        var script = TokenInjection.Script("x");
        Assert.StartsWith("try {", script);
        Assert.EndsWith("} catch (e) {}", script);
    }

    [Fact]
    public void ScriptOnlyWritesInTheEngineDocument()
    {
        var script = TokenInjection.Script("x");
        Assert.StartsWith("try { if (location.protocol === 'http:' && (location.hostname === '127.0.0.1' || location.hostname === 'localhost')) { localStorage.setItem(", script);
    }

    [Fact]
    public void HostileTokenRoundTripsAndNeverBreaksOutOfTheLiteral()
    {
        var token = "a'b\"c\\d</script>e\u2028f\u2029g\nh\ri ção";
        var script = TokenInjection.Script(token);

        var literal = Literal(script);
        Assert.Equal(token, JsonSerializer.Deserialize<string>(literal));
        Assert.DoesNotContain("</script>", script, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("\n", script);
        Assert.DoesNotContain("\r", script);
        Assert.DoesNotContain("\u2028", script);
        Assert.DoesNotContain("\u2029", script);
        // Aspa simples crua no literal não fecha nada (o literal é de aspas duplas), mas o
        // codificador do .NET escapa as duas, e o literal só pode ter as aspas das pontas.
        Assert.DoesNotContain("'", literal);
        Assert.DoesNotContain("\"", literal[1..^1]);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void EmptyTokenInjectsNothing(string? token)
    {
        Assert.Equal("", TokenInjection.Script(token));
    }
}
