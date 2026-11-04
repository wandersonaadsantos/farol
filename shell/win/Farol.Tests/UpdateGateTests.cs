using Farol.Contrato;

namespace Farol.Tests;

public sealed class UpdateGateTests
{
    private static ShellEvent.Shell State(bool busy) =>
        new(0, "", Busy: busy, Autostart: false, ColorBg: "", ColorSymbol: "");

    // A janela à frente: os testes do motor ocupado partem daqui.
    private static UpdateGate Foreground()
    {
        var gate = new UpdateGate();
        gate.OnForeground(true);
        return gate;
    }

    [Fact]
    public void MayRestartOnlyWhenIdle()
    {
        Assert.True(UpdateGate.MayRestart(State(busy: false)));
        Assert.False(UpdateGate.MayRestart(State(busy: true)));
    }

    [Fact]
    public void RequestWhileIdleRestartsNow()
    {
        var gate = Foreground();
        Assert.False(gate.OnShell(State(busy: false)));
        Assert.True(gate.RequestRestart());
    }

    [Fact]
    public void RequestWhileBusyIsDeferredUntilIdle()
    {
        var gate = Foreground();
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
        var gate = Foreground();
        Assert.False(gate.RequestRestart());
        Assert.True(gate.OnShell(State(busy: false)));
    }

    [Fact]
    public void RestartIsReleasedOnlyOnce()
    {
        var gate = Foreground();
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
        var gate = Foreground();
        gate.OnShell(State(busy: true));
        Assert.False(gate.RequestRestart());
        Assert.False(gate.RequestRestart());
        Assert.True(gate.OnShell(State(busy: false)));
        Assert.False(gate.OnShell(State(busy: false)));
    }

    [Fact]
    public void IdleShellsWithoutRequestNeverRestart()
    {
        var gate = Foreground();
        Assert.False(gate.OnShell(State(busy: false)));
        Assert.False(gate.OnShell(State(busy: true)));
        Assert.False(gate.OnShell(State(busy: false)));
        Assert.False(gate.Pending);
    }

    [Fact]
    public void BusyAgainAfterIdleDefersANewRequest()
    {
        var gate = Foreground();
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
        var gate = Foreground();
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

    [Fact]
    public void MayRestartNowNeedsIdleAndForeground()
    {
        Assert.True(UpdateGate.MayRestartNow(State(busy: false), foreground: true));
        Assert.False(UpdateGate.MayRestartNow(State(busy: false), foreground: false));
        Assert.False(UpdateGate.MayRestartNow(State(busy: true), foreground: true));
        Assert.False(UpdateGate.MayRestartNow(State(busy: true), foreground: false));
    }

    [Fact]
    public void StartsInTheBackground()
    {
        // Na bandeja o sistema recusa o reinício (NotInForeground): sem janela à frente, espera.
        var gate = new UpdateGate();
        gate.OnShell(State(busy: false));
        Assert.False(gate.RequestRestart());
        Assert.True(gate.Pending);
        Assert.True(gate.OnForeground(true));
        Assert.False(gate.Pending);
    }

    [Fact]
    public void LosingTheForegroundHoldsTheRequest()
    {
        var gate = Foreground();
        gate.OnShell(State(busy: true));
        Assert.False(gate.RequestRestart());
        Assert.False(gate.OnForeground(false));
        Assert.False(gate.OnShell(State(busy: false)));
        Assert.True(gate.Pending);
        Assert.True(gate.OnForeground(true));
    }

    [Fact]
    public void ForegroundWhileBusyWaitsForAnIdleShell()
    {
        var gate = new UpdateGate();
        gate.OnShell(State(busy: true));
        gate.RequestRestart();
        Assert.False(gate.OnForeground(true));
        Assert.True(gate.OnShell(State(busy: false)));
    }

    [Fact]
    public void ForegroundWithoutRequestNeverRestarts()
    {
        var gate = new UpdateGate();
        gate.OnShell(State(busy: false));
        Assert.False(gate.OnForeground(true));
        Assert.False(gate.Pending);
    }

    [Fact]
    public void DeferredReleaseStaysArmedForTheNextForeground()
    {
        // Liberado, mas a janela saiu da frente antes da tentativa: o motor não foi tocado, o
        // pedido continua e sai na próxima vez que a janela vier à frente.
        var gate = Foreground();
        gate.OnShell(State(busy: false));
        Assert.True(gate.RequestRestart());
        gate.Defer();
        Assert.True(gate.Pending);
        Assert.False(gate.OnShell(State(busy: false)));
        Assert.True(gate.OnForeground(true));
    }

    [Fact]
    public void DeferWithoutReleaseDoesNothing()
    {
        var gate = new UpdateGate();
        gate.Defer();
        Assert.False(gate.Pending);
        gate.OnShell(State(busy: false));
        Assert.False(gate.OnForeground(true));
    }
}
