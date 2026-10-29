using Farol.Contrato;

namespace Farol.Tests;

/// <summary>Os avisos que a própria casca monta (os do motor chegam prontos pelo SSE).</summary>
public class ShellNoticesTests
{
    [Fact]
    public void UpdatedCitesTheVersion()
    {
        var notice = ShellNotices.Updated("2.80.0");

        Assert.Equal("Farol atualizado", notice.Title);
        Assert.Equal("Versão 2.80.0 pronta.", notice.Body);
        Assert.Null(notice.Url);
        Assert.Null(notice.Pr);
        Assert.False(notice.Silent);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void UpdatedWithoutVersionStillSaysReady(string version)
    {
        Assert.Equal("Nova versão pronta.", ShellNotices.Updated(version).Body);
    }

    [Fact]
    public void ViewerTextIsExact()
    {
        var notice = ShellNotices.Viewer;

        Assert.Equal("Farol", notice.Title);
        Assert.Equal("Outro Farol já está rodando nesta porta; esta janela só mostra o que ele faz", notice.Body);
        Assert.Null(notice.Url);
        Assert.Null(notice.Pr);
        Assert.False(notice.Silent);
    }

    [Fact]
    public void FailureCarriesTheReason()
    {
        var notice = ShellNotices.Failure("o motor não ficou de pé depois de 5 tentativas");

        Assert.Equal("O Farol parou", notice.Title);
        Assert.Equal("O motor não ficou de pé depois de 5 tentativas.", notice.Body);
        Assert.Null(notice.Url);
        Assert.False(notice.Silent);
    }

    [Fact]
    public void FailureTextForTheWindow()
    {
        Assert.Equal(
            "O Farol parou: o motor não ficou de pé depois de 5 tentativas.",
            ShellNotices.FailureText("o motor não ficou de pé depois de 5 tentativas"));
        Assert.Equal("O Farol parou.", ShellNotices.FailureText(""));
    }
}
