using System.Text;
using System.Text.Json;
using Farol.Contrato;

namespace Farol.Tests;

public class ShellEventsTests
{
    private const string FixtureRelativePath = "test/fixtures/casca/eventos.json";

    // Sobe a partir da pasta do assembly (bin/Debug/<tfm>/) até achar a raiz do repositório.
    private static string FixturePath()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, FixtureRelativePath);
            if (File.Exists(candidate))
            {
                return candidate;
            }
            dir = dir.Parent;
        }
        throw new FileNotFoundException($"Não achei {FixtureRelativePath} acima de {AppContext.BaseDirectory}");
    }

    // Só os casos em que o motor emite um aviso; os de esperado null não viram evento.
    public static IEnumerable<object[]> NoticeCases()
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(FixturePath()));
        foreach (var item in doc.RootElement.EnumerateArray())
        {
            var expected = item.GetProperty("esperado");
            if (expected.ValueKind == JsonValueKind.Null)
            {
                continue;
            }
            yield return new object[] { item.GetProperty("nome").GetString()!, expected.GetRawText() };
        }
    }

    // O esperado é o corpo que o motor transmite: confere a paridade dos nomes de campo.
    [Theory]
    [MemberData(nameof(NoticeCases))]
    public void FixtureCaseDecodesToNotice(string name, string expectedJson)
    {
        using var expected = JsonDocument.Parse(expectedJson);
        var root = expected.RootElement;

        var decoded = ShellEvent.Decode("aviso-nativo", Encoding.UTF8.GetBytes(expectedJson));

        var notice = Assert.IsType<ShellEvent.Notice>(decoded);
        Assert.Equal(root.GetProperty("titulo").GetString(), notice.Title);
        Assert.Equal(root.GetProperty("corpo").GetString(), notice.Body);
        Assert.Equal(root.GetProperty("url").GetString(), notice.Url?.OriginalString);
        Assert.Equal(root.GetProperty("pr").GetString(), notice.Pr);
        Assert.True(root.GetProperty("silencioso").GetBoolean() == notice.Silent, name);
    }

    [Fact]
    public void LoneSurrogateInTitleDoesNotThrow()
    {
        // o JSON.stringify do Node emite isso para um título cortado no meio de um emoji
        var decoded = ShellEvent.Decode("aviso-nativo", Bytes(
            """{ "titulo": "x\ud83d", "corpo": "C", "url": null, "pr": "o/r#1", "silencioso": false }"""));

        var notice = Assert.IsType<ShellEvent.Notice>(decoded);
        Assert.Equal("", notice.Title);
        Assert.Equal("C", notice.Body);
        Assert.Equal("o/r#1", notice.Pr);
    }

    [Fact]
    public void FixtureExercisesAtLeastFifteenCases()
    {
        Assert.True(NoticeCases().Count() >= 15);
    }

    [Fact]
    public void AbsoluteUrlIsAbsolute()
    {
        var decoded = ShellEvent.Decode("aviso-nativo", Bytes(
            """{ "titulo": "T", "corpo": "C", "url": "https://github.com/o/r/pull/1", "pr": "o/r#1", "silencioso": false }"""));

        var notice = Assert.IsType<ShellEvent.Notice>(decoded);
        Assert.NotNull(notice.Url);
        Assert.True(notice.Url.IsAbsoluteUri);
    }

    [Theory]
    [InlineData("{nope")]
    [InlineData("null")]
    [InlineData("[1]")]
    public void MalformedNoticeIsNull(string body)
    {
        Assert.Null(ShellEvent.Decode("aviso-nativo", Bytes(body)));
    }

    [Fact]
    public void ShellEventDecodesAllFields()
    {
        var decoded = ShellEvent.Decode("casca", Bytes(
            """{ "badge": { "contador": 2, "rotulo": "2 decisões esperando você" }, "ocupado": true, "autostart": true, "cores": { "bg": "#0b0e14", "symbol": "#e7ecf5" } }"""));

        Assert.Equal(new ShellEvent.Shell(2, "2 decisões esperando você", true, true, "#0b0e14", "#e7ecf5"), decoded);
    }

    [Fact]
    public void PartialShellEventFallsBackToDefaults()
    {
        var decoded = ShellEvent.Decode("casca", Bytes("""{ "badge": null, "ocupado": true }"""));

        Assert.Equal(new ShellEvent.Shell(0, "", true, false, "", ""), decoded);
    }

    [Fact]
    public void MalformedShellEventIsNull()
    {
        Assert.Null(ShellEvent.Decode("casca", Bytes("{nope")));
    }

    [Fact]
    public void ExitEventDecodes()
    {
        Assert.Equal(
            new ShellEvent.Exit("update", "2.80.0"),
            ShellEvent.Decode("casca-saida", Bytes("""{ "motivo": "update", "proximaVersao": "2.80.0" }""")));
        Assert.Equal(
            new ShellEvent.Exit("reinicio", null),
            ShellEvent.Decode("casca-saida", Bytes("""{ "motivo": "reinicio", "proximaVersao": null }""")));
    }

    [Theory]
    [InlineData("state")]
    [InlineData("state-patch")]
    [InlineData("ping")]
    [InlineData("qualquer")]
    public void OtherEventsAreNotParsed(string name)
    {
        // corpo propositalmente inválido: a casca nunca decodifica esses eventos
        Assert.Equal(new ShellEvent.Other(name), ShellEvent.Decode(name, Bytes("{lixo \u0000")));
    }

    private static byte[] Bytes(string text) => Encoding.UTF8.GetBytes(text);
}
