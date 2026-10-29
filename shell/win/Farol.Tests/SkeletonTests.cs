namespace Farol.Tests;

public class SkeletonTests
{
    [Fact]
    public void ArithmeticWorks()
    {
        Assert.Equal(2, 1 + 1);
    }

    [WindowsFact]
    public void RunsOnlyOnWindows()
    {
        Assert.True(OperatingSystem.IsWindows());
    }
}
