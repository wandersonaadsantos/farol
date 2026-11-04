using Farol.Contrato;

namespace Farol.Tests;

public class HexColorTests
{
    [Theory]
    [InlineData("#0b1220", 0x0b, 0x12, 0x20)]
    [InlineData("#FFFFFF", 255, 255, 255)]
    [InlineData("#00aAfF", 0, 0xaa, 0xff)]
    public void ParsesSixDigitHex(string text, int r, int g, int b)
    {
        Assert.True(HexColor.TryParse(text, out var color));
        Assert.Equal(new HexColor((byte)r, (byte)g, (byte)b), color);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("#fff")]
    [InlineData("0b1220")]
    [InlineData("#0b12200")]
    [InlineData("#0g1220")]
    [InlineData("#+b1220")]
    [InlineData("rgb(0,0,0)")]
    public void RejectsAnythingElse(string? text)
    {
        Assert.False(HexColor.TryParse(text, out var color));
        Assert.Equal(default, color);
    }
}
