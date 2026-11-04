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

public class FarolPathsHomeTests
{
    [Fact]
    public void FarolHomeWinsWhenSet()
    {
        var home = Path.Combine(Path.GetTempPath(), "farol-teste");
        Assert.Equal(home, FarolPaths.Home(home));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void WithoutFarolHomeUsesTheDefault(string? value)
    {
        Assert.Equal(FarolPaths.DefaultHome(), FarolPaths.Home(value));
    }

    [Fact]
    public void EngineFileLivesInStateOutsideTheWorkspace()
    {
        var home = Path.Combine(Path.GetTempPath(), "farol-home");
        Assert.Equal(Path.Combine(home, "state", "casca.json"), FarolPaths.EngineFilePath(home));
    }

    [Fact]
    public void EngineStateDirIsInsideTheWorkspace()
    {
        // O STATE_DIR do motor (lib/paths.js), onde o update grava o reabrir-silencioso.json.
        var home = Path.Combine(Path.GetTempPath(), "farol-home");
        Assert.Equal(Path.Combine(home, "workspace", "state"), FarolPaths.EngineStateDir(home));
    }

    [Fact]
    public void ShellLogLivesNextToTheWebViewData()
    {
        var home = Path.Combine(Path.GetTempPath(), "farol-home");
        Assert.Equal(Path.Combine(home, "casca-win", "casca.log"), FarolPaths.ShellLogFile(home));
    }
}
