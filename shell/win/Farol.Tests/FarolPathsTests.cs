using Farol.Contrato;

namespace Farol.Tests;

public class FarolPathsTests
{
    [Fact]
    public void WebViewDataLivesInsideTheGivenHome()
    {
        var home = Path.Combine(Path.GetTempPath(), "farol-home");
        Assert.Equal(Path.Combine(home, "casca-win", "webview2"), FarolPaths.WebViewDataFolder(home));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void MissingHomeUsesTheDefault(string? home)
    {
        Assert.Equal(Path.Combine(FarolPaths.DefaultHome(), "casca-win", "webview2"), FarolPaths.WebViewDataFolder(home));
    }

    [Fact]
    public void DefaultHomeIsDotFarolInTheUserProfile()
    {
        var profile = Environment.GetEnvironmentVariable(OperatingSystem.IsWindows() ? "USERPROFILE" : "HOME");
        if (string.IsNullOrEmpty(profile))
        {
            profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        }
        Assert.Equal(Path.Combine(profile, ".farol"), FarolPaths.DefaultHome());
    }
}
