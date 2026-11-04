using System.Text.Json;

namespace Farol.Contrato;

/// <summary>
/// O marcador da reabertura silenciosa: o update do motor grava
/// <c>{ "at": &lt;epoch ms&gt;, "to": "&lt;versão&gt;" }</c> em
/// <c>&lt;home&gt;/workspace/state/reabrir-silencioso.json</c> antes de sair, e a casca o consome
/// para subir na bandeja sem roubar o foco. Mesma regra do <c>consumirReaberturaSilenciosa</c>
/// do motor (<c>lib/engine/update.js</c>): uso único e com prazo, para um update que falhou não
/// deixar a próxima abertura manual sem janela.
/// </summary>
public static class SilentReopen
{
    /// <summary>O nome do arquivo dentro do <c>STATE_DIR</c> do motor.</summary>
    public const string FileName = "reabrir-silencioso.json";

    /// <summary>Quanto tempo o marcador vale (<c>TEMPOS.REABERTURA_SILENCIOSA_MS</c>, 10 min).</summary>
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(10);

    /// <summary>
    /// Lê e SEMPRE apaga o marcador de <paramref name="stateDir"/>. Devolve a versão (texto vazio
    /// quando o motor não a gravou) se o carimbo tem entre 0 e 10 min; vencido, no futuro,
    /// ausente, ilegível ou inválido devolve <c>null</c>. Nunca lança: falhar aqui só faz o Farol
    /// abrir com a janela, que é o comportamento de sempre.
    /// </summary>
    public static string? Consume(string stateDir, DateTimeOffset? now = null)
    {
        string path;
        string json;
        try
        {
            path = Path.Combine(stateDir, FileName);
            json = File.ReadAllText(path);
        }
        catch (Exception)
        {
            return null;
        }
        try
        {
            File.Delete(path);
        }
        catch (Exception)
        {
            // Some no próximo boot, vencido.
        }
        return Parse(json, now ?? DateTimeOffset.UtcNow);
    }

    private static string? Parse(string json, DateTimeOffset now)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("at", out var at)
                || at.ValueKind != JsonValueKind.Number
                || !at.TryGetDouble(out var ms)
                || !double.IsFinite(ms))
            {
                return null;
            }
            var age = now.ToUnixTimeMilliseconds() - ms;
            if (age < 0 || age > Window.TotalMilliseconds)
            {
                return null;
            }
            return Json.String(root, "to") ?? "";
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
