using Farol.Contrato;

namespace Farol.Tests;

/// <summary>Motor vivo no boot: pid vivo E a porta respondendo como Farol.</summary>
public class EngineLivenessTests
{
    private static readonly EngineFile File = new(47170, 4242, "2.79.0", "CODE", DateTimeOffset.UnixEpoch, null);

    [Fact]
    public async Task NoFileIsNotAliveAndProbesNothing()
    {
        var probed = false;

        var alive = await EngineLiveness.IsAliveAsync(null, _ => { probed = true; return true; }, _ => { probed = true; return Task.FromResult(true); });

        Assert.False(alive);
        Assert.False(probed);
    }

    [Fact]
    public async Task DeadPidIsNotAliveAndSkipsThePort()
    {
        var portProbed = false;

        var alive = await EngineLiveness.IsAliveAsync(File, _ => false, _ => { portProbed = true; return Task.FromResult(true); });

        Assert.False(alive);
        Assert.False(portProbed);
    }

    [Fact]
    public async Task LivePidOnAPortThatIsNotFarolIsNotAlive()
    {
        Assert.False(await EngineLiveness.IsAliveAsync(File, _ => true, _ => Task.FromResult(false)));
    }

    [Fact]
    public async Task BothAnswersMakeItAlive()
    {
        int? pid = null;
        int? port = null;

        var alive = await EngineLiveness.IsAliveAsync(File, p => { pid = p; return true; }, p => { port = p; return Task.FromResult(true); });

        Assert.True(alive);
        Assert.Equal(4242, pid);
        Assert.Equal(47170, port);
    }

    [Fact]
    public async Task ProbeThatThrowsIsNotAlive()
    {
        Assert.False(await EngineLiveness.IsAliveAsync(File, _ => throw new InvalidOperationException(), _ => Task.FromResult(true)));
        Assert.False(await EngineLiveness.IsAliveAsync(File, _ => true, _ => throw new HttpRequestException()));
        Assert.False(await EngineLiveness.IsAliveAsync(File, _ => true, _ => Task.FromException<bool>(new TimeoutException())));
    }
}

/// <summary>O Boot: casca.json vivo, ou outro Farol (um Electron) na porta padrão sem casca.json.</summary>
public class EngineLivenessBootTests
{
    private static readonly EngineFile Live = new(47180, 4242, "2.79.0", "CODE", DateTimeOffset.UnixEpoch, null);

    [Fact]
    public async Task LiveFileWinsAndSkipsTheDefaultPort()
    {
        var probed = new List<int>();

        var boot = await EngineLiveness.BootAsync(Live, _ => true, p => { probed.Add(p); return Task.FromResult(true); });

        Assert.Equal(new SidecarInput.Boot(Live, true), boot);
        Assert.Equal([47180], probed);
    }

    [Fact]
    public async Task NoFileButFarolOnTheDefaultPortIsALiveEngineThere()
    {
        var boot = await EngineLiveness.BootAsync(null, _ => true, p => Task.FromResult(p == EngineDefaults.Port));

        Assert.True(boot.EngineAlive);
        Assert.Equal(EngineDefaults.Port, boot.Existing?.Port);
    }

    [Fact]
    public async Task DeadFileButFarolOnTheDefaultPortIsALiveEngineThere()
    {
        var boot = await EngineLiveness.BootAsync(Live, _ => false, p => Task.FromResult(p == EngineDefaults.Port));

        Assert.True(boot.EngineAlive);
        Assert.Equal(EngineDefaults.Port, boot.Existing?.Port);
    }

    [Fact]
    public async Task NothingAliveKeepsTheFileAndSpawns()
    {
        var boot = await EngineLiveness.BootAsync(Live, _ => false, _ => Task.FromResult(false));

        Assert.Equal(new SidecarInput.Boot(Live, false), boot);
    }

    [Fact]
    public async Task DefaultPortProbeThatThrowsIsNotAlive()
    {
        var boot = await EngineLiveness.BootAsync(null, _ => true, _ => throw new HttpRequestException());

        Assert.Equal(new SidecarInput.Boot(null, false), boot);
    }

    [Fact]
    public async Task ViewerMachineFromTheDefaultPortOpensThere()
    {
        var boot = await EngineLiveness.BootAsync(null, _ => true, _ => Task.FromResult(true));
        var machine = new SidecarMachine();

        var effects = machine.On(boot);

        Assert.Equal([new SidecarEffect.OpenWindow(EngineDefaults.Port, true), new SidecarEffect.ShowViewerNotice()], effects);
    }
}
