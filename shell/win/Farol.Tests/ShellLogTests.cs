using Farol.Contrato;

namespace Farol.Tests;

/// <summary>O log da casca: só linhas de falha, com data, e nunca lança.</summary>
public sealed class ShellLogTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "farol-log-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try
        {
            Directory.Delete(_dir, recursive: true);
        }
        catch (IOException)
        {
        }
    }

    [Fact]
    public void WritesOneStampedLinePerCallAndCreatesTheFolder()
    {
        var path = Path.Combine(_dir, "casca-win", "casca.log");
        var log = new ShellLog(path, () => DateTimeOffset.Parse("2026-10-29T12:00:00Z", System.Globalization.CultureInfo.InvariantCulture));

        log.Write("WARN um");
        log.Write("WARN dois");

        var lines = File.ReadAllLines(path);
        Assert.Equal(["2026-10-29T12:00:00.000Z WARN um", "2026-10-29T12:00:00.000Z WARN dois"], lines);
    }

    [Fact]
    public void LineBreaksInsideAMessageStayOnOneLine()
    {
        var path = Path.Combine(_dir, "casca.log");
        var log = new ShellLog(path);

        log.Write("WARN a\r\nb");

        Assert.Single(File.ReadAllLines(path));
    }

    [Fact]
    public void RotatesWhenTooBig()
    {
        Directory.CreateDirectory(_dir);
        var path = Path.Combine(_dir, "casca.log");
        File.WriteAllText(path, new string('x', ShellLog.MaxBytes + 1));
        var log = new ShellLog(path);

        log.Write("WARN novo");

        Assert.True(File.Exists(path + ".1"));
        Assert.EndsWith("WARN novo", File.ReadAllText(path).TrimEnd());
        Assert.True(new FileInfo(path).Length < ShellLog.MaxBytes);
    }

    [Theory]
    [InlineData("")]
    [InlineData("bad\0path")]
    public void UnusablePathNeverThrows(string path)
    {
        new ShellLog(path).Write("WARN x");
    }

    [Fact]
    public void FolderInPlaceOfTheFileNeverThrows()
    {
        var path = Path.Combine(_dir, "casca.log");
        Directory.CreateDirectory(path);

        new ShellLog(path).Write("WARN x");
    }
}
