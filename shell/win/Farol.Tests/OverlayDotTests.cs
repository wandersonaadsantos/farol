using Farol.Contrato;

namespace Farol.Tests;

public sealed class OverlayDotTests
{
    private static uint At(uint[] pixels, int x, int y) => pixels[(y * OverlayDot.Size) + x];

    [Fact]
    public void HasSixteenBySixteenPixels()
    {
        Assert.Equal(16 * 16, OverlayDot.Pixels().Length);
    }

    [Fact]
    public void CenterIsOpaqueFarolRed()
    {
        // ARGB com alfa direto: na memória (little endian) fica B, G, R, A, como o BGRA do Electron.
        Assert.Equal(0xFFEF4236u, At(OverlayDot.Pixels(), 7, 7));
    }

    [Fact]
    public void CornerIsTransparent()
    {
        Assert.Equal(0u, At(OverlayDot.Pixels(), 0, 0) >> 24);
    }

    [Fact]
    public void EdgeIsAntialiased()
    {
        // (14, 7) fica a cerca de 6,52 do centro (7,5; 7,5): dentro da faixa suavizada, alfa 123.
        var alpha = At(OverlayDot.Pixels(), 14, 7) >> 24;
        Assert.Equal(123u, alpha);
    }
}
