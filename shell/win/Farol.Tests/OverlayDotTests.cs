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
        // Distância 6,5 do centro (7,5; 7,5): meio caminho na borda, alfa 128.
        var alpha = At(OverlayDot.Pixels(), 14, 7) >> 24;
        Assert.InRange(alpha, 1u, 254u);
    }
}
