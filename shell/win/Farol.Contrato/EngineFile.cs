using System.Text.Json;

namespace Farol.Contrato;

/// <summary>
/// O arquivo de descoberta que o motor grava em <c>~/.farol/state/casca.json</c> depois de
/// abrir o socket: porta, pid, versão, código de pareamento de uso único, hora de início
/// e, só antes de uma saída por update, a próxima versão.
/// </summary>
public sealed record EngineFile(
    int Port,
    int Pid,
    string Version,
    string PairingCode,
    DateTimeOffset StartedAt,
    string? NextVersion)
{
    /// <summary>
    /// Lê o arquivo. Ausente, ilegível ou com JSON inválido devolve <c>null</c>: o motor
    /// pode estar subindo ou saindo, e a casca só tenta de novo.
    /// </summary>
    public static EngineFile? Read(string path)
    {
        string json;
        try
        {
            json = File.ReadAllText(path);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            return null;
        }
        return Parse(json);
    }

    /// <summary>
    /// Interpreta o JSON do arquivo. Sem <c>porta</c>, <c>pid</c> ou <c>codigoPareamento</c>
    /// (ou com o tipo errado) devolve <c>null</c>; <c>versao</c> ausente vira texto vazio.
    /// </summary>
    public static EngineFile? Parse(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return null;
            }
            if (!Json.TryInt(root, "porta", out var port)
                || !Json.TryInt(root, "pid", out var pid)
                || Json.String(root, "codigoPareamento") is not { } code)
            {
                return null;
            }
            var startedAt = root.TryGetProperty("iniciadoEm", out var started)
                && started.ValueKind == JsonValueKind.Number
                && started.TryGetInt64(out var ms)
                ? DateTimeOffset.FromUnixTimeMilliseconds(ms)
                : DateTimeOffset.UnixEpoch;
            return new EngineFile(
                port,
                pid,
                Json.String(root, "versao") ?? "",
                code,
                startedAt,
                Json.String(root, "proximaVersao"));
        }
        catch (Exception e) when (e is JsonException or ArgumentOutOfRangeException)
        {
            return null;
        }
    }
}
