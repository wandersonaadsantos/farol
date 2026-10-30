namespace Farol.Tests;

/// <summary>
/// Fato do xUnit que só roda no Windows. Fora dele o teste aparece como pulado,
/// porque depende de WinRT em tempo de execução (PasswordVault, StartupTask).
/// </summary>
public sealed class WindowsFactAttribute : FactAttribute
{
    public WindowsFactAttribute()
    {
        if (!OperatingSystem.IsWindows())
        {
            Skip = "Só roda no Windows";
        }
    }
}

/// <summary>Fato do xUnit que só roda fora do Windows (o inverso de <see cref="WindowsFactAttribute"/>).</summary>
public sealed class NonWindowsFactAttribute : FactAttribute
{
    public NonWindowsFactAttribute()
    {
        if (OperatingSystem.IsWindows())
        {
            Skip = "Só roda fora do Windows";
        }
    }
}
