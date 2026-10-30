using Farol.Contrato;

namespace Farol.Tests;

public class ViewerWatchTests
{
    [Fact]
    public void OneMissIsNotEnough()
    {
        var watch = new ViewerWatch();

        Assert.False(watch.OnProbe(farolAnswered: false));
    }

    [Fact]
    public void TwoMissesInARowLoseTheViewer()
    {
        var watch = new ViewerWatch();

        watch.OnProbe(farolAnswered: false);

        Assert.True(watch.OnProbe(farolAnswered: false));
    }

    [Fact]
    public void AnAnswerInBetweenStartsTheCountAgain()
    {
        var watch = new ViewerWatch();
        watch.OnProbe(farolAnswered: false);
        watch.OnProbe(farolAnswered: true);

        Assert.False(watch.OnProbe(farolAnswered: false));
        Assert.True(watch.OnProbe(farolAnswered: false));
    }

    [Fact]
    public void LostIsSaidOnlyOnce()
    {
        var watch = new ViewerWatch();
        watch.OnProbe(farolAnswered: false);
        Assert.True(watch.OnProbe(farolAnswered: false));

        Assert.False(watch.OnProbe(farolAnswered: false));
    }

    [Fact]
    public void ProbesEveryFiveSeconds()
    {
        Assert.Equal(TimeSpan.FromSeconds(5), ViewerWatch.Interval);
        Assert.Equal(2, ViewerWatch.MissesToLose);
    }
}

public class EpisodeLatchTests
{
    [Fact]
    public void WarnsOncePerEpisode()
    {
        var latch = new EpisodeLatch();

        Assert.True(latch.TryEnter());
        Assert.False(latch.TryEnter());
        Assert.False(latch.TryEnter());
    }

    [Fact]
    public void EndOfTheEpisodeArmsItAgain()
    {
        var latch = new EpisodeLatch();
        latch.TryEnter();

        latch.End();

        Assert.True(latch.TryEnter());
    }
}
