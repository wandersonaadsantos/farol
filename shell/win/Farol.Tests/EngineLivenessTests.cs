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
