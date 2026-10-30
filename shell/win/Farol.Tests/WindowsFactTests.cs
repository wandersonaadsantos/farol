namespace Farol.Tests;

// Prova que o atributo WindowsFact roda no Windows e pula fora dele.
public class WindowsFactTests
{
    [WindowsFact]
    public void RunsOnlyOnWindows()
    {
        Assert.True(OperatingSystem.IsWindows());
    }
}
