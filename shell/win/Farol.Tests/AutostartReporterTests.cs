using Farol.Contrato;

namespace Farol.Tests;

public sealed class AutostartReporterTests
{
    private static (AutostartReporter Reporter, List<string> Log) Make(Func<Task<IStartupTask>> factory)
    {
        var log = new List<string>();
        return (new AutostartReporter(factory, log.Add), log);
    }

    [Fact]
    public async Task RepeatedRefusalLogsOnce()
    {
        var task = new AutostartTests.FakeStartupTask(StartupState.DisabledByUser);
        var (reporter, log) = Make(() => Task.FromResult<IStartupTask>(task));
        for (var i = 0; i < 3; i++)
        {
            Assert.Equal(AutostartOutcome.RefusedByUser, await reporter.ApplyAsync(true));
        }
        Assert.Equal(AutostartDecision.RefusedByUserWarning, Assert.Single(log));
        Assert.Equal(0, task.RequestCalls);
    }

    [Fact]
    public async Task RefusalAfterSuccessLogsAgain()
    {
        var task = new AutostartTests.FakeStartupTask(StartupState.DisabledByUser);
        var (reporter, log) = Make(() => Task.FromResult<IStartupTask>(task));
        await reporter.ApplyAsync(true);
        task.Current = StartupState.Enabled;
        Assert.Equal(AutostartOutcome.Unchanged, await reporter.ApplyAsync(true));
        task.Current = StartupState.DisabledByUser;
        await reporter.ApplyAsync(true);
        Assert.Equal(2, log.Count);
    }

    [Fact]
    public async Task DistinctRefusalsLogEach()
    {
        var task = new AutostartTests.FakeStartupTask(StartupState.DisabledByUser);
        var (reporter, log) = Make(() => Task.FromResult<IStartupTask>(task));
        await reporter.ApplyAsync(true);
        task.Current = StartupState.DisabledByPolicy;
        await reporter.ApplyAsync(true);
        await reporter.ApplyAsync(true);
        Assert.Equal(
            new[] { AutostartDecision.RefusedByUserWarning, AutostartDecision.DisabledByPolicyWarning },
            log);
    }

    [Fact]
    public async Task FactoryThatThrowsLogsOnceAndNeverThrows()
    {
        var (reporter, log) = Make(() => throw new InvalidOperationException("sem pacote"));
        for (var i = 0; i < 3; i++)
        {
            Assert.Equal(AutostartOutcome.Unchanged, await reporter.ApplyAsync(true));
        }
        Assert.Equal(AutostartDecision.UnavailableWarning(new InvalidOperationException()), Assert.Single(log));
    }

    [Fact]
    public async Task FactoryFaultedTaskLogsOnce()
    {
        var (reporter, log) = Make(() => Task.FromException<IStartupTask>(new InvalidOperationException()));
        await reporter.ApplyAsync(false);
        await reporter.ApplyAsync(false);
        Assert.Single(log);
    }
}
