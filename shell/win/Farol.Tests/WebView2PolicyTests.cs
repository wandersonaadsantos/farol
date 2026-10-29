using Farol.Contrato;

namespace Farol.Tests;

public class WebView2PolicyTests
{
    private const string Message =
        "O Farol precisa do WebView2 Runtime, que não está instalado nesta máquina. Instale pelo link e abra o Farol de novo.";

    private sealed class FakeCheck(Func<string?> version) : IWebView2Check
    {
        public string? AvailableBrowserVersion() => version();
    }

    [Fact]
    public void InstalledRuntimeProceedsWithItsVersion()
    {
        var decision = WebView2Policy.Decide(new FakeCheck(() => "120.0.0.0"));
        Assert.Equal(new WebView2Decision.Proceed("120.0.0.0"), decision);
    }

    [Fact]
    public void AbsentRuntimeShowsTheDownloadLink()
    {
        var decision = WebView2Policy.Decide(new FakeCheck(() => null));
        Assert.Equal(new WebView2Decision.MissingRuntime(WebView2Policy.RuntimeUrl, Message), decision);
        Assert.Equal("https://developer.microsoft.com/microsoft-edge/webview2/", WebView2Policy.RuntimeUrl);
    }

    [Fact]
    public void EmptyVersionCountsAsAbsent()
    {
        var decision = WebView2Policy.Decide(new FakeCheck(() => ""));
        Assert.IsType<WebView2Decision.MissingRuntime>(decision);
    }

    [Fact]
    public void ThrowingCheckCountsAsAbsent()
    {
        var decision = WebView2Policy.Decide(new FakeCheck(() => throw new InvalidOperationException("sem runtime")));
        Assert.Equal(new WebView2Decision.MissingRuntime(WebView2Policy.RuntimeUrl, Message), decision);
    }
}
