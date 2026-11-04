using System.Text;

namespace Farol.Contrato;

/// <summary>
/// Leitor incremental de <c>text/event-stream</c>. Recebe os bytes como chegam da rede,
/// guarda a linha incompleta entre um pedaço e outro (inclusive no meio de um caractere
/// UTF-8) e devolve os eventos completos. Linha em branco despacha; evento sem
/// <c>data</c> (o <c>ping</c>) e comentário (linha começando com <c>:</c>) não viram nada.
/// </summary>
public sealed class SseParser
{
    private const string DefaultName = "message";

    private readonly List<byte> _line = new();
    private readonly StringBuilder _data = new();
    private bool _hasData;
    private string _name = DefaultName;
    private bool _afterCr;

    /// <summary>
    /// Alimenta o leitor com mais um pedaço. Devolve uma lista (e não um iterador, porque um
    /// span não atravessa o <c>yield</c>) com os eventos que este pedaço completou.
    /// </summary>
    public IReadOnlyList<(string Name, byte[] Data)> Feed(ReadOnlySpan<byte> chunk)
    {
        var events = new List<(string Name, byte[] Data)>();
        foreach (var b in chunk)
        {
            // o \n de um \r\n que ficou partido entre dois pedaços já foi contado no \r
            if (_afterCr)
            {
                _afterCr = false;
                if (b == (byte)'\n')
                {
                    continue;
                }
            }
            if (b == (byte)'\r' || b == (byte)'\n')
            {
                _afterCr = b == (byte)'\r';
                EndLine(events);
                continue;
            }
            _line.Add(b);
        }
        return events;
    }

    private void EndLine(List<(string Name, byte[] Data)> events)
    {
        var line = Encoding.UTF8.GetString(_line.ToArray());
        _line.Clear();

        if (line.Length == 0)
        {
            Dispatch(events);
            return;
        }
        if (line[0] == ':')
        {
            return;
        }

        var colon = line.IndexOf(':');
        var field = colon < 0 ? line : line[..colon];
        var value = colon < 0 ? "" : line[(colon + 1)..];
        if (value.StartsWith(' '))
        {
            value = value[1..];
        }

        switch (field)
        {
            case "event":
                _name = value;
                break;
            case "data":
                if (_hasData)
                {
                    _data.Append('\n');
                }
                _data.Append(value);
                _hasData = true;
                break;
            default:
                // id, retry e campos desconhecidos não interessam à casca
                break;
        }
    }

    private void Dispatch(List<(string Name, byte[] Data)> events)
    {
        if (_hasData)
        {
            var name = _name.Length == 0 ? DefaultName : _name;
            events.Add((name, Encoding.UTF8.GetBytes(_data.ToString())));
        }
        _data.Clear();
        _hasData = false;
        _name = DefaultName;
    }
}
