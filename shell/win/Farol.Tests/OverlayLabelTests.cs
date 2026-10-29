using Farol.Contrato;

namespace Farol.Tests;

public sealed class OverlayLabelTests
{
    private static ShellEvent.Shell State(int count, string label) =>
        new(count, label, Busy: false, Autostart: false, ColorBg: "", ColorSymbol: "");

    [Fact]
    public void ZeroHasNoLabelAndPlainTooltip()
    {
        var state = State(0, "");
        Assert.Equal("", OverlayLabel.For(state));
        Assert.Equal("Farol", OverlayLabel.Tooltip(state));
    }

    [Fact]
    public void ZeroIgnoresStaleLabel()
    {
        var state = State(0, "1 decisão esperando você");
        Assert.Equal("", OverlayLabel.For(state));
        Assert.Equal("Farol", OverlayLabel.Tooltip(state));
    }

    [Fact]
    public void OneUsesEngineLabel()
    {
        var state = State(1, "1 decisão esperando você");
        Assert.Equal("1 decisão esperando você", OverlayLabel.For(state));
        Assert.Equal("Farol · 1 decisão esperando você", OverlayLabel.Tooltip(state));
    }

    [Fact]
    public void EmptyLabelFallsBackToComputedPlural()
    {
        var state = State(3, "");
        Assert.Equal("3 decisões esperando você", OverlayLabel.For(state));
        Assert.Equal("Farol · 3 decisões esperando você", OverlayLabel.Tooltip(state));
    }

    [Fact]
    public void EmptyLabelFallsBackToComputedSingular()
    {
        Assert.Equal("1 decisão esperando você", OverlayLabel.For(State(1, "")));
    }
}
