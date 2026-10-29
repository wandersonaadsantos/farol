using System.Globalization;

namespace Farol.Contrato;

/// <summary>A cor que o motor manda no evento <c>casca</c>, no formato <c>#rrggbb</c>.</summary>
public readonly record struct HexColor(byte R, byte G, byte B)
{
    /// <summary>Aceita só <c>#rrggbb</c> (maiúscula ou minúscula); qualquer outra forma é recusada.</summary>
    public static bool TryParse(string? text, out HexColor color)
    {
        color = default;
        if (text is null || text.Length != 7 || text[0] != '#')
        {
            return false;
        }
        for (var i = 1; i < 7; i++)
        {
            if (!char.IsAsciiHexDigit(text[i]))
            {
                return false;
            }
        }
        color = new HexColor(Channel(text, 1), Channel(text, 3), Channel(text, 5));
        return true;
    }

    private static byte Channel(string text, int start) =>
        byte.Parse(text.AsSpan(start, 2), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture);
}
