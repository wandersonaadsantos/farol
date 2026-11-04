using Farol.Contrato;

namespace Farol.Tests;

public class LocalUrlTests
{
    [Theory]
    [InlineData("/", "http://127.0.0.1:47170/")]
    [InlineData("/?pr=owner%2Frepo%23N", "http://127.0.0.1:47170/?pr=owner%2Frepo%23N")]
    [InlineData("/radar/pra-mim", "http://127.0.0.1:47170/radar/pra-mim")]
    public void BuildsTheEngineAddress(string path, string expected)
    {
        var uri = LocalUrl.For(47170, path);
        Assert.Equal(expected, uri.AbsoluteUri);
        Assert.True(ExternalLinkPolicy.IsLocal(uri, 47170));
    }

    [Theory]
    [InlineData("")]
    [InlineData("radar")]
    [InlineData("//evil.com/")]
    [InlineData("/a//b")]
    [InlineData("/\\evil.com")]
    [InlineData("\\\\evil.com")]
    [InlineData("/@evil.com")]
    [InlineData("/a b")]
    [InlineData("/a\tb")]
    [InlineData("/a\nb")]
    public void RejectsPathsThatCouldLeaveTheEngine(string path)
    {
        Assert.Throws<ArgumentException>(() => LocalUrl.For(47170, path));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(70000)]
    public void RejectsInvalidPort(int port)
    {
        Assert.Throws<ArgumentException>(() => LocalUrl.For(port, "/"));
    }
}
