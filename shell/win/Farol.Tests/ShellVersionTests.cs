using Farol.Contrato;

namespace Farol.Tests;

/// <summary>A versão que a casca informa ao motor em <c>FAROL_SHELL_VERSION</c>.</summary>
public class ShellVersionTests
{
    [Fact]
    public void PackageVersionBecomesSemver()
    {
        Assert.Equal("3.0.0", ShellVersion.From(3, 0, 0));
        Assert.Equal("3.12.7", ShellVersion.From(3, 12, 7));
    }

    [Fact]
    public void FallbackMatchesTheEngineRange()
    {
        // O package.json do motor declara engines.farolShell ">=3.0.0 <4".
        Assert.Equal("3.0.0", ShellVersion.Fallback);
    }
}
