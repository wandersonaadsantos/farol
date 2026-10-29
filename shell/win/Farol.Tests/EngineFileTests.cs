using Farol.Contrato;

namespace Farol.Tests;

public class EngineFileTests
{
    // O exemplo do índice dos planos, seção "Arquivo casca.json".
    private const string IndexJson =
        """{ "porta": 47170, "pid": 12345, "versao": "2.79.0", "codigoPareamento": "K7QMZP2XWD", "iniciadoEm": 1761600000000, "proximaVersao": null }""";

    [Fact]
    public void ParsesTheIndexExample()
    {
        var file = EngineFile.Parse(IndexJson);

        Assert.NotNull(file);
        Assert.Equal(47170, file.Port);
        Assert.Equal(12345, file.Pid);
        Assert.Equal("2.79.0", file.Version);
        Assert.Equal("K7QMZP2XWD", file.PairingCode);
        Assert.Equal(DateTimeOffset.FromUnixTimeMilliseconds(1761600000000), file.StartedAt);
        Assert.Null(file.NextVersion);
    }

    [Fact]
    public void ReadsNextVersionWhenPresent()
    {
        var file = EngineFile.Parse(
            """{ "porta": 1, "pid": 2, "versao": "2.79.0", "codigoPareamento": "X", "iniciadoEm": 0, "proximaVersao": "2.80.0" }""");

        Assert.Equal("2.80.0", file?.NextVersion);
    }

    [Fact]
    public void MissingVersionBecomesEmpty()
    {
        var file = EngineFile.Parse("""{ "porta": 1, "pid": 2, "codigoPareamento": "X", "iniciadoEm": 0 }""");

        Assert.NotNull(file);
        Assert.Equal("", file.Version);
        Assert.Null(file.NextVersion);
    }

    [Theory]
    [InlineData("{nope")]
    [InlineData("")]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("""{ "pid": 2, "codigoPareamento": "X", "iniciadoEm": 0 }""")]
    [InlineData("""{ "porta": 1, "codigoPareamento": "X", "iniciadoEm": 0 }""")]
    [InlineData("""{ "porta": 1, "pid": 2, "iniciadoEm": 0 }""")]
    [InlineData("""{ "porta": "47170", "pid": 2, "codigoPareamento": "X", "iniciadoEm": 0 }""")]
    public void InvalidJsonOrMissingKeysIsNull(string json)
    {
        Assert.Null(EngineFile.Parse(json));
    }

    [Fact]
    public void ReadOfMissingPathIsNull()
    {
        var path = Path.Combine(Path.GetTempPath(), $"farol-nao-existe-{Guid.NewGuid():N}", "casca.json");

        Assert.Null(EngineFile.Read(path));
    }

    [Fact]
    public void ReadParsesATempFile()
    {
        var path = Path.Combine(Path.GetTempPath(), $"farol-casca-{Guid.NewGuid():N}.json");
        File.WriteAllText(path, IndexJson);
        try
        {
            var file = EngineFile.Read(path);

            Assert.NotNull(file);
            Assert.Equal(47170, file.Port);
            Assert.Equal("K7QMZP2XWD", file.PairingCode);
        }
        finally
        {
            File.Delete(path);
        }
    }
}
