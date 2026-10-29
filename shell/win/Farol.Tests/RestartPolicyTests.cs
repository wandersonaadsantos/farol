using Farol.Contrato;

namespace Farol.Tests;

public class RestartPolicyTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(4)]
    [InlineData(5)]
    [InlineData(99)]
    public void IntentionalExitRestartsImmediatelyRegardlessOfFailures(int failures)
    {
        Assert.Equal(new RestartDecision.Immediately(), RestartPolicy.Delay(RestartPolicy.IntentionalExit, failures));
    }

    [Fact]
    public void IntentionalExitIs75AndLimitIs5()
    {
        Assert.Equal(75, RestartPolicy.IntentionalExit);
        Assert.Equal(5, RestartPolicy.MaxConsecutiveFailures);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(5)]
    public void ZeroStopsAsEnded(int failures)
    {
        Assert.Equal(new RestartDecision.Stop("encerrado"), RestartPolicy.Delay(0, failures));
    }

    [Theory]
    [InlineData(1, 1.0)]
    [InlineData(2, 2.0)]
    [InlineData(3, 4.0)]
    [InlineData(4, 8.0)]
    public void FailureBacksOffExponentially(int failures, double seconds)
    {
        Assert.Equal(new RestartDecision.After(seconds), RestartPolicy.Delay(1, failures));
    }

    [Theory]
    [InlineData(5)]
    [InlineData(6)]
    [InlineData(40)]
    public void FifthFailureStops(int failures)
    {
        Assert.Equal(
            new RestartDecision.Stop("o motor não ficou de pé depois de 5 tentativas"),
            RestartPolicy.Delay(1, failures));
    }

    [Theory]
    [InlineData(139)]
    [InlineData(-1)]
    [InlineData(2)]
    [InlineData(255)]
    public void AnyOtherCodeCountsAsFailure(int code)
    {
        Assert.Equal(new RestartDecision.After(8), RestartPolicy.Delay(code, 4));
    }

    // O teto de 30 s não é alcançável: a quinta falha já para, e o maior recuo antes dela
    // é 8 s. O teto fica no código porque a política escrita o fixa, sem teste próprio.
}
