using System.Text.Json;

namespace Farol.Contrato;

// Leituras tolerantes de campo: tipo errado ou ausente conta como ausente, nunca lança.
internal static class Json
{
    public static string? String(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    public static bool TryInt(JsonElement obj, string name, out int result)
    {
        result = 0;
        return obj.ValueKind == JsonValueKind.Object
            && obj.TryGetProperty(name, out var value)
            && value.ValueKind == JsonValueKind.Number
            && value.TryGetInt32(out result);
    }

    public static bool Bool(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.True;

    public static JsonElement Object(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.Object
            ? value
            : default;
}
