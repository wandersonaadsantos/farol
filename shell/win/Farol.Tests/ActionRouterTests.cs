using System.Text;
using System.Text.Json;
using Farol.Contrato;

namespace Farol.Tests;

public class ActionRouterTests
{
    private static ShellEvent.Notice Notice(string? url, string? pr)
    {
        Uri? uri = null;
        if (url is not null)
        {
            Uri.TryCreate(url, UriKind.RelativeOrAbsolute, out uri);
        }
        return new ShellEvent.Notice("T", "C", uri, pr, false);
    }

    // O aviso de um caso da fixture compartilhada, decodificado como a casca decodifica.
    private static ShellEvent.Notice FixtureNotice(string name)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(ShellEventsTests.FixturePath()));
        foreach (var item in doc.RootElement.EnumerateArray())
        {
            if (item.GetProperty("nome").GetString() == name)
            {
                var body = Encoding.UTF8.GetBytes(item.GetProperty("esperado").GetRawText());
                return Assert.IsType<ShellEvent.Notice>(ShellEvent.Decode("aviso-nativo", body));
            }
        }
        throw new InvalidOperationException($"Caso {name} não está na fixture.");
    }

    [Fact]
    public void AbsoluteHttpsUrlOpensTheUrl()
    {
        var action = ActionRouter.For(Notice("https://github.com/o/r/pull/1", "o/r#1"));

        Assert.Equal(new NoticeAction.OpenUrl(new Uri("https://github.com/o/r/pull/1")), action);
    }

    [Fact]
    public void AbsoluteHttpUrlOpensTheUrl()
    {
        var action = ActionRouter.For(Notice("http://example.com/x", null));

        Assert.Equal(new NoticeAction.OpenUrl(new Uri("http://example.com/x")), action);
    }

    [Fact]
    public void RelativeUrlWithPrFocusesThePr()
    {
        Assert.Equal(new NoticeAction.FocusPr("o/r#1"), ActionRouter.For(Notice("u", "o/r#1")));
    }

    [Fact]
    public void FileUrlWithPrFocusesThePr()
    {
        Assert.Equal(new NoticeAction.FocusPr("o/r#1"), ActionRouter.For(Notice("file:///x", "o/r#1")));
    }

    [Fact]
    public void OtherSchemeWithoutPrFocusesTheWindow()
    {
        Assert.Equal(new NoticeAction.FocusWindow(), ActionRouter.For(Notice("ms-settings:privacy", null)));
    }

    [Fact]
    public void OnlyPrFocusesThePr()
    {
        Assert.Equal(new NoticeAction.FocusPr("o/r#1"), ActionRouter.For(Notice(null, "o/r#1")));
    }

    [Fact]
    public void EmptyPrCountsAsAbsent()
    {
        Assert.Equal(new NoticeAction.FocusWindow(), ActionRouter.For(Notice(null, "")));
    }

    [Fact]
    public void NothingFocusesTheWindow()
    {
        Assert.Equal(new NoticeAction.FocusWindow(), ActionRouter.For(Notice(null, null)));
    }

    [Fact]
    public void PrPathEncodesTheReference()
    {
        Assert.Equal("/?pr=o%2Fr%231", ActionRouter.PrPath("o/r#1"));
    }

    [Theory]
    [InlineData("o/r#1")]
    [InlineData("o/r#1 com espaço")]
    [InlineData("a@b//c\\d")]
    public void PrPathIsAcceptedByLocalUrl(string pr)
    {
        var uri = LocalUrl.For(47170, ActionRouter.PrPath(pr));

        Assert.Equal("127.0.0.1", uri.Host);
        Assert.Equal(47170, uri.Port);
    }

    [Fact]
    public void FixtureInterventionOfPrFocusesThePr()
    {
        Assert.Equal(new NoticeAction.FocusPr("o/r#1"), ActionRouter.For(FixtureNotice("intervention de PR fora do silêncio")));
    }

    [Fact]
    public void FixtureToolDoneFocusesTheWindow()
    {
        Assert.Equal(new NoticeAction.FocusWindow(), ActionRouter.For(FixtureNotice("tool-done kudos")));
    }

    [Fact]
    public void FixtureNewPrWithRelativeUrlFocusesThePr()
    {
        Assert.Equal(new NoticeAction.FocusPr("o/r#1"), ActionRouter.For(FixtureNotice("new-prs um pedindo revisão")));
    }

    [Fact]
    public void FixtureGroupedNewPrsFocusesTheWindow()
    {
        Assert.Equal(new NoticeAction.FocusWindow(), ActionRouter.For(FixtureNotice("new-prs vários pedindo revisão")));
    }

    [Fact]
    public void FixtureSilentSystemInterventionFocusesTheWindow()
    {
        Assert.Equal(new NoticeAction.FocusWindow(), ActionRouter.For(FixtureNotice("intervention de sistema no silêncio")));
    }
}
