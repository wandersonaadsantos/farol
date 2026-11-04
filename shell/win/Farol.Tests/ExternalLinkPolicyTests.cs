using Farol.Contrato;

namespace Farol.Tests;

public class ExternalLinkPolicyTests
{
    private const int Port = 47170;

    [Theory]
    [InlineData("http://127.0.0.1:47170/")]
    [InlineData("http://localhost:47170/?pr=x")]
    [InlineData("http://LOCALHOST:47170/radar/pra-mim")]
    public void LocalAddressesStayInTheWindow(string url)
    {
        Assert.True(ExternalLinkPolicy.IsLocal(new Uri(url), Port));
    }

    [Theory]
    [InlineData("https://127.0.0.1:47170/")]
    [InlineData("http://127.0.0.1:47171/")]
    [InlineData("http://127.0.0.1/")]
    [InlineData("https://github.com/o/r/pull/1")]
    [InlineData("http://127.0.0.1.evil.com:47170/")]
    [InlineData("http://user@evil.com:47170/")]
    [InlineData("http://user@127.0.0.1:47170/")]
    [InlineData("file:///C:/Windows/win.ini")]
    public void EverythingElseOpensOutside(string url)
    {
        Assert.False(ExternalLinkPolicy.IsLocal(new Uri(url), Port));
    }

    [Fact]
    public void RelativeUriIsNotLocal()
    {
        Assert.False(ExternalLinkPolicy.IsLocal(new Uri("/x", UriKind.Relative), Port));
    }
}
