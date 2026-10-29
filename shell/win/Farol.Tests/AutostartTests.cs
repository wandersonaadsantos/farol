using Farol.Contrato;

namespace Farol.Tests;

public sealed class AutostartTests
{
    private sealed class FakeStartupTask : IStartupTask
    {
        private readonly StartupState _state;
        private readonly StartupState _afterRequest;
        private readonly bool _throws;

        public FakeStartupTask(StartupState state, StartupState afterRequest = StartupState.Enabled, bool throws = false)
        {
            _state = state;
            _afterRequest = afterRequest;
            _throws = throws;
        }

        public int RequestCalls { get; private set; }

        public int DisableCalls { get; private set; }

        public StartupState State => _throws ? throw new InvalidOperationException("sem pacote") : _state;

        public Task<StartupState> RequestEnableAsync()
        {
            RequestCalls++;
            return Task.FromResult(_afterRequest);
        }

        public void Disable() => DisableCalls++;
    }

    private static async Task<(AutostartOutcome Outcome, List<string> Log)> Run(IStartupTask task, bool wanted)
    {
        var log = new List<string>();
        var outcome = await AutostartDecision.ApplyAsync(task, wanted, log.Add);
        return (outcome, log);
    }

    [Fact]
    public async Task WantedAndDisabledAcceptedEnables()
    {
        var task = new FakeStartupTask(StartupState.Disabled, StartupState.Enabled);
        var (outcome, log) = await Run(task, wanted: true);
        Assert.Equal(AutostartOutcome.Enabled, outcome);
        Assert.Equal(1, task.RequestCalls);
        Assert.Empty(log);
    }

    [Fact]
    public async Task WantedAndDisabledDeclinedWarnsOnceWithoutRetry()
    {
        var task = new FakeStartupTask(StartupState.Disabled, StartupState.DisabledByUser);
        var (outcome, log) = await Run(task, wanted: true);
        Assert.Equal(AutostartOutcome.RefusedByUser, outcome);
        Assert.Equal(1, task.RequestCalls);
        var line = Assert.Single(log);
        Assert.Contains("recusado pelo usuário", line);
    }

    [Fact]
    public async Task WantedAndDisabledByUserWarnsWithoutAsking()
    {
        var task = new FakeStartupTask(StartupState.DisabledByUser);
        var (outcome, log) = await Run(task, wanted: true);
        Assert.Equal(AutostartOutcome.RefusedByUser, outcome);
        Assert.Equal(0, task.RequestCalls);
        Assert.Single(log);
    }

    [Fact]
    public async Task WantedAndEnabledIsUnchanged()
    {
        var task = new FakeStartupTask(StartupState.Enabled);
        var (outcome, log) = await Run(task, wanted: true);
        Assert.Equal(AutostartOutcome.Unchanged, outcome);
        Assert.Equal(0, task.RequestCalls);
        Assert.Empty(log);
    }

    [Fact]
    public async Task WantedAndDisabledByPolicyIsRefused()
    {
        var task = new FakeStartupTask(StartupState.DisabledByPolicy);
        var (outcome, log) = await Run(task, wanted: true);
        Assert.Equal(AutostartOutcome.RefusedByPolicy, outcome);
        Assert.Equal(0, task.RequestCalls);
        Assert.Single(log);
    }

    [Fact]
    public async Task NotWantedAndEnabledDisables()
    {
        var task = new FakeStartupTask(StartupState.Enabled);
        var (outcome, log) = await Run(task, wanted: false);
        Assert.Equal(AutostartOutcome.Disabled, outcome);
        Assert.Equal(1, task.DisableCalls);
        Assert.Empty(log);
    }

    [Fact]
    public async Task NotWantedAndEnabledByPolicyIsRefused()
    {
        var task = new FakeStartupTask(StartupState.EnabledByPolicy);
        var (outcome, log) = await Run(task, wanted: false);
        Assert.Equal(AutostartOutcome.RefusedByPolicy, outcome);
        Assert.Equal(0, task.DisableCalls);
        Assert.Single(log);
    }

    [Fact]
    public async Task NotWantedAndDisabledIsUnchanged()
    {
        var task = new FakeStartupTask(StartupState.DisabledByUser);
        var (outcome, log) = await Run(task, wanted: false);
        Assert.Equal(AutostartOutcome.Unchanged, outcome);
        Assert.Equal(0, task.DisableCalls);
        Assert.Empty(log);
    }

    [Fact]
    public async Task ThrowingTaskWarnsOnceAndNeverThrows()
    {
        var task = new FakeStartupTask(StartupState.Disabled, throws: true);
        var (outcome, log) = await Run(task, wanted: true);
        Assert.Equal(AutostartOutcome.Unchanged, outcome);
        Assert.Single(log);
    }

    [Fact]
    public async Task NullLogIsAccepted()
    {
        var task = new FakeStartupTask(StartupState.DisabledByUser);
        Assert.Equal(AutostartOutcome.RefusedByUser, await AutostartDecision.ApplyAsync(task, true, null));
    }
}
