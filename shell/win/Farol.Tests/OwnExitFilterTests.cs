using Farol.Contrato;

namespace Farol.Tests;

public sealed class OwnExitFilterTests
{
    [Fact]
    public void NothingExpectedLetsEveryExitThrough()
    {
        var filter = new OwnExitFilter();
        Assert.False(filter.Expecting);
        Assert.False(filter.TryConsume());
    }

    [Fact]
    public void ExpectedExitIsDroppedOnce()
    {
        var filter = new OwnExitFilter();
        filter.Expect();
        Assert.True(filter.Expecting);
        Assert.True(filter.TryConsume());
        // A queda de verdade do motor seguinte chega à máquina.
        Assert.False(filter.Expecting);
        Assert.False(filter.TryConsume());
    }

    [Fact]
    public void ExpectingTwiceStillDropsOnlyOne()
    {
        var filter = new OwnExitFilter();
        filter.Expect();
        filter.Expect();
        Assert.True(filter.TryConsume());
        Assert.False(filter.TryConsume());
    }

    [Fact]
    public void ClearGivesUpOnAnExitThatNeverCame()
    {
        var filter = new OwnExitFilter();
        filter.Expect();
        filter.Clear();
        Assert.False(filter.Expecting);
        Assert.False(filter.TryConsume());
    }
}
