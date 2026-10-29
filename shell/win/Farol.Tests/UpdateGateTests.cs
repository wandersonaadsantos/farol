using Farol.Contrato;

namespace Farol.Tests;

public sealed class UpdateGateTests
{
    private static ShellEvent.Shell State(bool busy) =>
        new(0, "", Busy: busy, Autostart: false, ColorBg: "", ColorSymbol: "");

    [Fact]
    public void MayRestartOnlyWhenIdle()
    {
        Assert.True(UpdateGate.MayRestart(State(busy: false)));
        Assert.False(UpdateGate.MayRestart(State(busy: true)));
    }

    [Fact]
    public void RequestWhileIdleRestartsNow()
    {
        var gate = new UpdateGate();
        Assert.False(gate.OnShell(State(busy: false)));
        Assert.True(gate.RequestRestart());
    }

    [Fact]
    public void RequestWhileBusyIsDeferredUntilIdle()
    {
        var gate = new UpdateGate();
        gate.OnShell(State(busy: true));
        Assert.False(gate.RequestRestart());
        Assert.True(gate.Pending);
        Assert.False(gate.OnShell(State(busy: true)));
        Assert.True(gate.OnShell(State(busy: false)));
        Assert.False(gate.Pending);
    }

    [Fact]
    public void RequestBeforeAnyShellWaitsForTheFirstIdleOne()
    {
        // Sem retrato não se sabe se há revisão em curso: o lado seguro é esperar.
        var gate = new UpdateGate();
        Assert.False(gate.RequestRestart());
        Assert.True(gate.OnShell(State(busy: false)));
    }

    [Fact]
    public void RestartIsReleasedOnlyOnce()
    {
        var gate = new UpdateGate();
        gate.OnShell(State(busy: true));
        gate.RequestRestart();
        Assert.True(gate.OnShell(State(busy: false)));
        Assert.False(gate.OnShell(State(busy: false)));
        Assert.False(gate.RequestRestart());
        Assert.False(gate.OnShell(State(busy: false)));
    }

    [Fact]
    public void RepeatedRequestsWhileBusyReleaseOnce()
    {
        var gate = new UpdateGate();
        gate.OnShell(State(busy: true));
        Assert.False(gate.RequestRestart());
        Assert.False(gate.RequestRestart());
        Assert.True(gate.OnShell(State(busy: false)));
        Assert.False(gate.OnShell(State(busy: false)));
    }

    [Fact]
    public void IdleShellsWithoutRequestNeverRestart()
    {
        var gate = new UpdateGate();
        Assert.False(gate.OnShell(State(busy: false)));
        Assert.False(gate.OnShell(State(busy: true)));
        Assert.False(gate.OnShell(State(busy: false)));
        Assert.False(gate.Pending);
    }

    [Fact]
    public void BusyAgainAfterIdleDefersANewRequest()
    {
        var gate = new UpdateGate();
        gate.OnShell(State(busy: false));
        gate.OnShell(State(busy: true));
        Assert.False(gate.RequestRestart());
        Assert.True(gate.OnShell(State(busy: false)));
    }

    [Fact]
    public void FailedRestartWaitsForANewRequest()
    {
        // O sistema recusou o reinício: nada de tentar a cada retrato (cada tentativa derruba o
        // motor); o próximo pedido do App Installer vale de novo.
        var gate = new UpdateGate();
        gate.OnShell(State(busy: false));
        Assert.True(gate.RequestRestart());
        gate.RestartFailed();
        Assert.False(gate.Pending);
        Assert.False(gate.OnShell(State(busy: false)));
        Assert.True(gate.RequestRestart());
    }

    [Fact]
    public void NullShellIsRejected()
    {
        Assert.Throws<ArgumentNullException>(() => UpdateGate.MayRestart(null!));
        Assert.Throws<ArgumentNullException>(() => new UpdateGate().OnShell(null!));
    }
}
