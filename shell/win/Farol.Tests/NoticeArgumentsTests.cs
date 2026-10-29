using Farol.Contrato;

namespace Farol.Tests;

public class NoticeArgumentsTests
{
    private static ShellEvent.Notice Notice(Uri? url, string? pr) => new("Título", "Corpo", url, pr, false);

    [Fact]
    public void EncodeCarriesKindUrlAndPr()
    {
        var encoded = NoticeArguments.Encode(Notice(new Uri("https://x.test/a?b=1&c=2"), "o/r#1"));

        Assert.Equal("kind=notice&url=https%3A%2F%2Fx.test%2Fa%3Fb%3D1%26c%3D2&pr=o%2Fr%231", encoded);
    }

    [Fact]
    public void EncodeOmitsAbsentFields()
    {
        Assert.Equal("kind=notice", NoticeArguments.Encode(Notice(null, null)));
    }

    [Fact]
    public void EncodeNeverCarriesTitleOrBody()
    {
        var encoded = NoticeArguments.Encode(Notice(null, "o/r#1"));

        Assert.DoesNotContain("T%C3%ADtulo", encoded);
        Assert.DoesNotContain("Corpo", encoded);
    }

    [Fact]
    public void RoundTripUrlWithAmpersandOpensTheSameUrl()
    {
        var url = new Uri("https://github.com/o/r/pull/1?a=1&b=2#x");

        var action = NoticeArguments.Decode(NoticeArguments.Encode(Notice(url, "o/r#1")));

        Assert.Equal(new NoticeAction.OpenUrl(url), action);
    }

    [Fact]
    public void RoundTripPrWithHashAndSlashFocusesThePr()
    {
        var action = NoticeArguments.Decode(NoticeArguments.Encode(Notice(null, "o/r#1&x=y")));

        Assert.Equal(new NoticeAction.FocusPr("o/r#1&x=y"), action);
    }

    [Fact]
    public void RoundTripRelativeUrlFallsBackToThePr()
    {
        var relative = new Uri("u", UriKind.Relative);

        var action = NoticeArguments.Decode(NoticeArguments.Encode(Notice(relative, "o/r#1")));

        Assert.Equal(new NoticeAction.FocusPr("o/r#1"), action);
    }

    [Fact]
    public void RoundTripNothingFocusesTheWindow()
    {
        Assert.Equal(new NoticeAction.FocusWindow(), NoticeArguments.Decode(NoticeArguments.Encode(Notice(null, null))));
    }

    [Theory]
    [InlineData("")]
    [InlineData("lixo")]
    [InlineData("=&&==")]
    [InlineData("kind=outro&pr=o%2Fr%231")]
    [InlineData("pr=o%2Fr%231")]
    public void ForeignOrMalformedArgumentsFocusTheWindow(string arguments)
    {
        Assert.Equal(new NoticeAction.FocusWindow(), NoticeArguments.Decode(arguments));
    }

    [Fact]
    public void FromPairsAppliesTheSameRule()
    {
        var pairs = new Dictionary<string, string> { ["kind"] = "notice", ["url"] = "u", ["pr"] = "o/r#1" };

        Assert.Equal(new NoticeAction.FocusPr("o/r#1"), NoticeArguments.FromPairs(pairs));
    }

    [Fact]
    public void FromPairsOpensAnHttpsUrl()
    {
        var pairs = new Dictionary<string, string> { ["kind"] = "notice", ["url"] = "https://x.test/a&b" };

        Assert.Equal(new NoticeAction.OpenUrl(new Uri("https://x.test/a&b")), NoticeArguments.FromPairs(pairs));
    }

    [Fact]
    public void FromPairsWithoutKindFocusesTheWindow()
    {
        var pairs = new Dictionary<string, string> { ["pr"] = "o/r#1" };

        Assert.Equal(new NoticeAction.FocusWindow(), NoticeArguments.FromPairs(pairs));
    }

    [Fact]
    public void FromPairsIgnoresFileUrl()
    {
        var pairs = new Dictionary<string, string> { ["kind"] = "notice", ["url"] = "file:///x" };

        Assert.Equal(new NoticeAction.FocusWindow(), NoticeArguments.FromPairs(pairs));
    }
}
