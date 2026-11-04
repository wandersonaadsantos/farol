import Foundation

/// O marcador de reabertura silenciosa que o motor grava antes de um update.
///
/// O arquivo `<workspace>/state/reabrir-silencioso.json` traz `{ "at": <ms>, "to": "<versão>" }`.
/// Mesma regra do `consumirReaberturaSilenciosa` do motor: vale por 10 minutos, carimbo do
/// futuro não vale, e o arquivo é apagado SEMPRE que é lido, vencido ou não (uso único). Sem
/// prazo, um update que falhasse deixaria a próxima abertura manual sem janela.
public enum SilentReopen {
    public static let fileName = "reabrir-silencioso.json"
    /// A janela de validade, a mesma `REABERTURA_SILENCIOSA_MS` do motor.
    public static let validity: TimeInterval = 10 * 60

    /// A versão para a qual o Farol acabou de atualizar, ou `nil` quando não há marcador
    /// válido. Apaga o marcador em qualquer caso.
    public static func consume(stateDir: URL, now: Date = Date()) -> String? {
        let url = stateDir.appendingPathComponent(fileName)
        guard let data = try? Data(contentsOf: url) else { return nil }
        try? FileManager.default.removeItem(at: url)
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let at = (object["at"] as? NSNumber)?.doubleValue,
            let version = object["to"] as? String, !version.isEmpty
        else { return nil }
        let age = now.timeIntervalSince1970 - at / 1000
        return age >= 0 && age <= validity ? version : nil
    }
}
