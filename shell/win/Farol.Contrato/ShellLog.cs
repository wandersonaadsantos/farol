using System.Globalization;

namespace Farol.Contrato;

/// <summary>
/// O log de falhas da casca (<see cref="FarolPaths.ShellLogFile"/>): uma linha por chamada, com a
/// hora em UTC. Só recebe falha (invariante 3) e nunca segredo. Passado de
/// <see cref="MaxBytes"/>, o arquivo vira <c>.1</c> e recomeça. Nunca lança: o log é a última
/// coisa que pode derrubar a casca.
/// </summary>
public sealed class ShellLog
{
    /// <summary>O tamanho a partir do qual o arquivo é trocado.</summary>
    public const int MaxBytes = 512 * 1024;

    private readonly string _path;
    private readonly Func<DateTimeOffset> _now;
    private readonly object _gate = new();

    public ShellLog(string path, Func<DateTimeOffset>? now = null)
    {
        _path = path;
        _now = now ?? (() => DateTimeOffset.UtcNow);
    }

    public void Write(string message)
    {
        var line = _now().UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture)
            + " " + (message ?? "").Replace("\r", " ", StringComparison.Ordinal).Replace("\n", " ", StringComparison.Ordinal)
            + Environment.NewLine;
        lock (_gate)
        {
            try
            {
                var dir = Path.GetDirectoryName(_path);
                if (!string.IsNullOrEmpty(dir))
                {
                    Directory.CreateDirectory(dir);
                }
                Rotate();
                File.AppendAllText(_path, line);
            }
            catch (Exception)
            {
                // Sem onde escrever: a linha se perde, a casca segue.
            }
        }
    }

    private void Rotate()
    {
        var info = new FileInfo(_path);
        if (info.Exists && info.Length > MaxBytes)
        {
            File.Move(_path, _path + ".1", overwrite: true);
        }
    }
}
