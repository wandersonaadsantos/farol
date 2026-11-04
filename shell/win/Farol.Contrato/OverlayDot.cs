namespace Farol.Contrato;

/// <summary>
/// A bolinha vermelha do overlay da barra de tarefas, pixel a pixel como o <c>overlayDot</c> do
/// Electron: 16x16, cor <c>#ef4236</c>, raio 6,5 centrado em (7,5; 7,5), borda suavizada em um pixel.
/// </summary>
public static class OverlayDot
{
    public const int Size = 16;

    private const uint Rgb = 0xEF4236;
    private const double Center = 7.5;
    private const double Radius = 6.5;

    /// <summary>
    /// Os pixels de cima para baixo, em ARGB com alfa direto (não pré-multiplicado), que é o que
    /// um ícone de 32 bits espera. Na memória little endian cada um fica B, G, R, A.
    /// </summary>
    public static uint[] Pixels()
    {
        var pixels = new uint[Size * Size];
        for (var y = 0; y < Size; y++)
        {
            for (var x = 0; x < Size; x++)
            {
                var d = Math.Sqrt(((x - Center) * (x - Center)) + ((y - Center) * (y - Center)));
                pixels[(y * Size) + x] = (Alpha(d) << 24) | Rgb;
            }
        }
        return pixels;
    }

    private static uint Alpha(double d)
    {
        if (d <= Radius - 0.5)
        {
            return 255;
        }
        if (d >= Radius + 0.5)
        {
            return 0;
        }
        return (uint)Math.Round(255 * (Radius + 0.5 - d), MidpointRounding.AwayFromZero);
    }
}
