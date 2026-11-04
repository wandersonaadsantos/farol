using Farol.Contrato;

namespace Farol.Tests;

public class SidecarMachineTests
{
    private static EngineFile File(int port = 47170, string code = "K7QMZP2XWD") =>
        new(port, 12345, "2.79.0", code, DateTimeOffset.UnixEpoch, null);

    private static SidecarMachine ReadyMachine(int port = 47170)
    {
        var machine = new SidecarMachine();
        machine.On(new SidecarInput.Boot(null, false));
        machine.On(new SidecarInput.FileAppeared(File(port)));
        machine.On(new SidecarInput.Paired());
        return machine;
    }

    [Fact]
    public void StartsInStarting()
    {
        var machine = new SidecarMachine();

        Assert.Equal(new SidecarPhase.Starting(), machine.Phase);
        Assert.Equal(0, machine.ConsecutiveFailures);
    }

    [Fact]
    public void BootWithoutFileSpawnsAndWaits()
    {
        var machine = new SidecarMachine();

        var effects = machine.On(new SidecarInput.Boot(null, false));

        Assert.Equal([new SidecarEffect.Spawn(), new SidecarEffect.WaitFile()], effects);
        Assert.Equal(new SidecarPhase.WaitingForFile(), machine.Phase);
    }

    [Fact]
    public void BootWithLiveEngineBecomesViewerAndNeverSpawns()
    {
        var machine = new SidecarMachine();

        var effects = machine.On(new SidecarInput.Boot(File(47180), true));

        Assert.Equal([new SidecarEffect.OpenWindow(47180, true), new SidecarEffect.ShowViewerNotice()], effects);
        Assert.Equal(new SidecarPhase.Viewer(47180), machine.Phase);
    }

    [Fact]
    public void BootWithFileOfDeadEngineIgnoresItAndSpawns()
    {
        var machine = new SidecarMachine();

        var effects = machine.On(new SidecarInput.Boot(File(), false));

        Assert.Equal([new SidecarEffect.Spawn(), new SidecarEffect.WaitFile()], effects);
        Assert.Equal(new SidecarPhase.WaitingForFile(), machine.Phase);
    }

    [Fact]
    public void FileAppearedPairsWithCodeAndPort()
    {
        var machine = new SidecarMachine();
        machine.On(new SidecarInput.Boot(null, false));

        var effects = machine.On(new SidecarInput.FileAppeared(File(47171, "ABC")));

        Assert.Equal([new SidecarEffect.Pair("ABC", 47171)], effects);
        Assert.Equal(new SidecarPhase.Pairing(), machine.Phase);
    }

    [Fact]
    public void PairedOpensTheWindow()
    {
        var machine = new SidecarMachine();
        machine.On(new SidecarInput.Boot(null, false));
        machine.On(new SidecarInput.FileAppeared(File(47171)));

        var effects = machine.On(new SidecarInput.Paired());

        Assert.Equal([new SidecarEffect.OpenWindow(47171, false)], effects);
        Assert.Equal(new SidecarPhase.Ready(47171), machine.Phase);
    }

    [Fact]
    public void PairFailedStillOpensTheWindowForTheUiToPair()
    {
        var machine = new SidecarMachine();
        machine.On(new SidecarInput.Boot(null, false));
        machine.On(new SidecarInput.FileAppeared(File(47171)));

        var effects = machine.On(new SidecarInput.PairFailed());

        Assert.Equal([new SidecarEffect.OpenWindow(47171, false)], effects);
        Assert.Equal(new SidecarPhase.Ready(47171), machine.Phase);
    }

    [Fact]
    public void IntentionalExitInReadyRestartsImmediately()
    {
        var machine = ReadyMachine();

        var effects = machine.On(new SidecarInput.Exited(75));

        Assert.Equal([new SidecarEffect.Restart(0)], effects);
        Assert.Equal(new SidecarPhase.Restarting(0), machine.Phase);
        Assert.Equal(0, machine.ConsecutiveFailures);
    }

    [Fact]
    public void FiveFailuresInARowStop()
    {
        var machine = ReadyMachine();

        var all = Enumerable.Range(0, 5).Select(_ => machine.On(new SidecarInput.Exited(1))).ToList();

        Assert.Equal([new SidecarEffect.Restart(1)], all[0]);
        Assert.Equal([new SidecarEffect.Restart(2)], all[1]);
        Assert.Equal([new SidecarEffect.Restart(4)], all[2]);
        Assert.Equal([new SidecarEffect.Restart(8)], all[3]);
        Assert.Equal([new SidecarEffect.ShowFailure("o motor não ficou de pé depois de 5 tentativas")], all[4]);
        Assert.Equal(new SidecarPhase.Stopped("o motor não ficou de pé depois de 5 tentativas"), machine.Phase);
    }

    [Fact]
    public void RestartingAcceptsTheRewrittenFile()
    {
        var machine = ReadyMachine();
        machine.On(new SidecarInput.Exited(1));

        var effects = machine.On(new SidecarInput.FileAppeared(File(47172, "NEW")));

        Assert.Equal([new SidecarEffect.Pair("NEW", 47172)], effects);
        Assert.Equal(new SidecarPhase.Pairing(), machine.Phase);
    }

    [Fact]
    public void StableBetweenFailuresResetsTheCounter()
    {
        var machine = ReadyMachine();
        for (var i = 0; i < 4; i++)
        {
            machine.On(new SidecarInput.Exited(1));
        }
        Assert.Equal(4, machine.ConsecutiveFailures);

        machine.On(new SidecarInput.FileAppeared(File()));
        machine.On(new SidecarInput.Paired());
        Assert.Empty(machine.On(new SidecarInput.Stable()));
        Assert.Equal(0, machine.ConsecutiveFailures);

        var effects = machine.On(new SidecarInput.Exited(1));

        Assert.Equal([new SidecarEffect.Restart(1)], effects);
        Assert.Equal(1, machine.ConsecutiveFailures);
    }

    // Paridade com a casca Mac (R25 de lá): um motor que pareia e morre logo depois continua
    // contando para a desistência. Antes o Paired zerava, e um motor assim religava a cada 1 s
    // para sempre.
    [Fact]
    public void PairingAndDyingStillCountsTowardsGivingUp()
    {
        var machine = ReadyMachine();
        var last = (IReadOnlyList<SidecarEffect>)[];
        for (var i = 0; i < RestartPolicy.MaxConsecutiveFailures; i++)
        {
            last = machine.On(new SidecarInput.Exited(1));
            machine.On(new SidecarInput.FileAppeared(File()));
            machine.On(new SidecarInput.Paired());
        }

        Assert.Equal([new SidecarEffect.ShowFailure("o motor não ficou de pé depois de 5 tentativas")], last);
        Assert.True(machine.GaveUp);
    }

    [Fact]
    public void StableCountsOnlyWithAnEngineUp()
    {
        var waiting = new SidecarMachine();
        waiting.On(new SidecarInput.Boot(null, false));
        waiting.On(new SidecarInput.Exited(1));
        Assert.Empty(waiting.On(new SidecarInput.Stable()));
        Assert.Equal(1, waiting.ConsecutiveFailures);

        var pairing = new SidecarMachine();
        pairing.On(new SidecarInput.Boot(null, false));
        pairing.On(new SidecarInput.Exited(1));
        pairing.On(new SidecarInput.FileAppeared(File()));
        pairing.On(new SidecarInput.Stable());
        Assert.Equal(0, pairing.ConsecutiveFailures);
        Assert.Equal(new SidecarPhase.Pairing(), pairing.Phase);
    }

    [Fact]
    public void StabilityWindowIsSixtySecondsLikeTheMacShell()
    {
        Assert.Equal(TimeSpan.FromSeconds(60), SidecarMachine.StabilityWindow);
    }

    [Fact]
    public void GaveUpOnlyWhenStopped()
    {
        var machine = ReadyMachine();
        Assert.False(machine.GaveUp);
        machine.On(new SidecarInput.Exited(0));
        Assert.True(machine.GaveUp);
    }

    [Fact]
    public void ExitsAndPortTakenEndTheEngineWaits()
    {
        Assert.True(SidecarMachine.EndsEngineWaits(new SidecarInput.Exited(1)));
        Assert.True(SidecarMachine.EndsEngineWaits(new SidecarInput.PortTaken(47170, 1)));
        Assert.False(SidecarMachine.EndsEngineWaits(new SidecarInput.Paired()));
        Assert.False(SidecarMachine.EndsEngineWaits(new SidecarInput.FileAppeared(File())));
        Assert.False(SidecarMachine.EndsEngineWaits(new SidecarInput.Stable()));
    }

    [Fact]
    public void IntentionalExitDoesNotCountAsFailure()
    {
        var machine = ReadyMachine();
        machine.On(new SidecarInput.Exited(1));
        machine.On(new SidecarInput.Exited(75));

        Assert.Equal(1, machine.ConsecutiveFailures);
        Assert.Equal([new SidecarEffect.Restart(2)], machine.On(new SidecarInput.Exited(1)));
    }

    [Fact]
    public void ExitZeroStopsSilently()
    {
        var machine = ReadyMachine();

        var effects = machine.On(new SidecarInput.Exited(0));

        Assert.Empty(effects);
        Assert.Equal(new SidecarPhase.Stopped("encerrado"), machine.Phase);
    }

    [Fact]
    public void InputsOutOfPlaceAreNoops()
    {
        var viewer = new SidecarMachine();
        viewer.On(new SidecarInput.Boot(File(47180), true));
        Assert.Empty(viewer.On(new SidecarInput.Paired()));
        Assert.Empty(viewer.On(new SidecarInput.PairFailed()));
        Assert.Empty(viewer.On(new SidecarInput.Exited(1)));
        Assert.Empty(viewer.On(new SidecarInput.FileAppeared(File())));
        Assert.Empty(viewer.On(new SidecarInput.Boot(null, false)));
        Assert.Equal(new SidecarPhase.Viewer(47180), viewer.Phase);

        var ready = ReadyMachine(47171);
        Assert.Empty(ready.On(new SidecarInput.FileAppeared(File(1))));
        Assert.Empty(ready.On(new SidecarInput.Paired()));
        Assert.Empty(ready.On(new SidecarInput.Boot(null, false)));
        Assert.Equal(new SidecarPhase.Ready(47171), ready.Phase);

        var starting = new SidecarMachine();
        Assert.Empty(starting.On(new SidecarInput.Paired()));
        Assert.Empty(starting.On(new SidecarInput.FileAppeared(File())));
        Assert.Equal(new SidecarPhase.Starting(), starting.Phase);

        var stopped = ReadyMachine();
        stopped.On(new SidecarInput.Exited(0));
        Assert.Empty(stopped.On(new SidecarInput.Exited(1)));
        Assert.Empty(stopped.On(new SidecarInput.FileAppeared(File())));
        Assert.Equal(new SidecarPhase.Stopped("encerrado"), stopped.Phase);
    }
}

public class SidecarMachinePortTakenTests
{
    private static EngineFile File(int port = 47170) =>
        new(port, 12345, "2.79.0", "CODE", DateTimeOffset.UnixEpoch, null);

    [Fact]
    public void PortTakenWhileWaitingBecomesViewer()
    {
        var machine = new SidecarMachine();
        machine.On(new SidecarInput.Boot(null, false));

        var effects = machine.On(new SidecarInput.PortTaken(47170, 1));

        Assert.Equal([new SidecarEffect.OpenWindow(47170, true), new SidecarEffect.ShowViewerNotice()], effects);
        Assert.Equal(new SidecarPhase.Viewer(47170), machine.Phase);
        Assert.Equal(0, machine.ConsecutiveFailures);
    }

    [Fact]
    public void PortTakenWhileRestartingBecomesViewerWithoutCountingAFailure()
    {
        var machine = new SidecarMachine();
        machine.On(new SidecarInput.Boot(null, false));
        machine.On(new SidecarInput.Exited(1));
        Assert.Equal(1, machine.ConsecutiveFailures);

        var effects = machine.On(new SidecarInput.PortTaken(47180, 1));

        Assert.Equal([new SidecarEffect.OpenWindow(47180, true), new SidecarEffect.ShowViewerNotice()], effects);
        Assert.Equal(new SidecarPhase.Viewer(47180), machine.Phase);
        Assert.Equal(1, machine.ConsecutiveFailures);
    }

    [Fact]
    public void ViewerIgnoresLaterExits()
    {
        var machine = new SidecarMachine();
        machine.On(new SidecarInput.Boot(null, false));
        machine.On(new SidecarInput.PortTaken(47170, 1));

        Assert.Empty(machine.On(new SidecarInput.Exited(1)));
        Assert.Equal(new SidecarPhase.Viewer(47170), machine.Phase);
    }

    [Fact]
    public void PortTakenOutOfPlaceIsANoOp()
    {
        var starting = new SidecarMachine();
        Assert.Empty(starting.On(new SidecarInput.PortTaken(47170, 1)));
        Assert.Equal(new SidecarPhase.Starting(), starting.Phase);

        var viewer = new SidecarMachine();
        viewer.On(new SidecarInput.Boot(File(47180), true));
        Assert.Empty(viewer.On(new SidecarInput.PortTaken(47170, 1)));
        Assert.Equal(new SidecarPhase.Viewer(47180), viewer.Phase);
    }

    // Um EADDRINUSE no stderr de um motor que já pareou (ou está pareando) não é "outro Farol na
    // porta": o motor caiu, e a saída conta como saída. Antes a máquina engolia o PortTaken e a
    // casca seguia "pronta" com o motor morto.
    [Fact]
    public void PortTakenWithAnEngineUpIsTheExitItCameFrom()
    {
        var pairing = new SidecarMachine();
        pairing.On(new SidecarInput.Boot(null, false));
        pairing.On(new SidecarInput.FileAppeared(File()));
        Assert.Equal([new SidecarEffect.Restart(1)], pairing.On(new SidecarInput.PortTaken(47170, 1)));
        Assert.Equal(new SidecarPhase.Restarting(1), pairing.Phase);
        Assert.Equal(1, pairing.ConsecutiveFailures);

        var ready = new SidecarMachine();
        ready.On(new SidecarInput.Boot(null, false));
        ready.On(new SidecarInput.FileAppeared(File()));
        ready.On(new SidecarInput.Paired());
        Assert.Equal([new SidecarEffect.Restart(1)], ready.On(new SidecarInput.PortTaken(47170, 3)));
        Assert.Equal(1, ready.ConsecutiveFailures);
    }

    [Fact]
    public void ResolveTurnsPortTakenIntoTheExitOnlyWithAnEngineUp()
    {
        var waiting = new SidecarMachine();
        waiting.On(new SidecarInput.Boot(null, false));
        var taken = new SidecarInput.PortTaken(47170, 1);
        Assert.Equal(taken, waiting.Resolve(taken));

        waiting.On(new SidecarInput.FileAppeared(File()));
        Assert.Equal(new SidecarInput.Exited(1), waiting.Resolve(taken));
        Assert.Equal(new SidecarInput.Paired(), waiting.Resolve(new SidecarInput.Paired()));
    }

    [Fact]
    public void PortTakenAfterStoppedIsANoOp()
    {
        var machine = new SidecarMachine();
        machine.On(new SidecarInput.Boot(null, false));
        for (var i = 0; i < RestartPolicy.MaxConsecutiveFailures; i++)
        {
            machine.On(new SidecarInput.Exited(1));
        }
        Assert.IsType<SidecarPhase.Stopped>(machine.Phase);

        Assert.Empty(machine.On(new SidecarInput.PortTaken(47170, 1)));
    }
}

public class SidecarMachineViewerLostTests
{
    private static EngineFile File(int port = 47170) =>
        new(port, 12345, "2.79.0", "CODE", DateTimeOffset.UnixEpoch, null);

    [Fact]
    public void ViewerLostSpawnsOurOwnEngine()
    {
        var machine = new SidecarMachine();
        machine.On(new SidecarInput.Boot(File(47180), true));

        var effects = machine.On(new SidecarInput.ViewerLost());

        Assert.Equal([new SidecarEffect.Spawn(), new SidecarEffect.WaitFile()], effects);
        Assert.Equal(new SidecarPhase.WaitingForFile(), machine.Phase);
        Assert.Equal([new SidecarEffect.Pair("CODE", 47170)], machine.On(new SidecarInput.FileAppeared(File())));
        Assert.Equal([new SidecarEffect.OpenWindow(47170, false)], machine.On(new SidecarInput.Paired()));
    }

    [Fact]
    public void ViewerLostAfterPortTakenAlsoSpawns()
    {
        var machine = new SidecarMachine();
        machine.On(new SidecarInput.Boot(null, false));
        machine.On(new SidecarInput.PortTaken(47170, 1));

        Assert.Equal([new SidecarEffect.Spawn(), new SidecarEffect.WaitFile()], machine.On(new SidecarInput.ViewerLost()));
    }

    [Fact]
    public void ViewerLostOutOfViewerIsANoOp()
    {
        var waiting = new SidecarMachine();
        waiting.On(new SidecarInput.Boot(null, false));
        Assert.Empty(waiting.On(new SidecarInput.ViewerLost()));
        Assert.Equal(new SidecarPhase.WaitingForFile(), waiting.Phase);

        var starting = new SidecarMachine();
        Assert.Empty(starting.On(new SidecarInput.ViewerLost()));
    }
}
