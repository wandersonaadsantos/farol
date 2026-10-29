using Farol.Contrato;

namespace Farol.Tests;

public class NoticeDispatcherTests
{
    private sealed class FakePresenter : IWindowPresenter
    {
        public List<string> Calls { get; } = new();

        public void ShowAndActivate() => Calls.Add("show");

        public async Task NavigateAsync(string path)
        {
            await Task.Yield();
            Calls.Add("navigate " + path);
        }

        public void OpenExternal(Uri url) => Calls.Add("open " + url.AbsoluteUri);
    }

    // Review Focus 4: clique no aviso com a janela na bandeja reabre a janela e abre o PR.
    [Fact]
    public async Task FocusPrShowsTheWindowThenNavigatesToThePr()
    {
        var presenter = new FakePresenter();

        await NoticeDispatcher.ApplyAsync(new NoticeAction.FocusPr("o/r#1"), presenter);

        Assert.Equal(new[] { "show", "navigate /?pr=o%2Fr%231" }, presenter.Calls);
    }

    [Fact]
    public async Task OpenUrlOnlyOpensOutside()
    {
        var presenter = new FakePresenter();

        await NoticeDispatcher.ApplyAsync(new NoticeAction.OpenUrl(new Uri("https://github.com/o/r/pull/1")), presenter);

        Assert.Equal(new[] { "open https://github.com/o/r/pull/1" }, presenter.Calls);
    }

    [Fact]
    public async Task FocusWindowOnlyShowsTheWindow()
    {
        var presenter = new FakePresenter();

        await NoticeDispatcher.ApplyAsync(new NoticeAction.FocusWindow(), presenter);

        Assert.Equal(new[] { "show" }, presenter.Calls);
    }

    [Fact]
    public async Task DecodedToastArgumentsReachTheSamePath()
    {
        var presenter = new FakePresenter();
        var notice = new ShellEvent.Notice("T", "C", new Uri("u", UriKind.Relative), "o/r#1", false);

        await NoticeDispatcher.ApplyAsync(NoticeArguments.Decode(NoticeArguments.Encode(notice)), presenter);

        Assert.Equal(new[] { "show", "navigate /?pr=o%2Fr%231" }, presenter.Calls);
    }
}
