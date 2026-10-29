import Foundation

/// O que fazer depois que o motor saiu.
public enum RestartDecision: Equatable, Sendable {
    /// Religar na hora (saída de propósito, como a do update).
    case immediately
    /// Religar depois de esperar tantos segundos.
    case after(seconds: Double)
    /// Não religar sozinho; `reason` é o texto que a casca mostra.
    case stop(reason: String)
}

/// A política de religar o motor sidecar, PURA: só olha o código de saída e quantas falhas
/// seguidas já houve.
///
/// O código `75` é a saída de propósito (o motor pede para ser religado, por exemplo depois
/// de instalar um update) e religa na hora. O `0` é fim pedido e não religa. Qualquer outro
/// código é falha: o recuo dobra a cada falha seguida (1 s, 2 s, 4 s, ...) com teto de 30 s,
/// e ao chegar a `maxConsecutiveFailures` a casca para de tentar e mostra o motivo.
public struct RestartPolicy: Equatable, Sendable {
    /// O código com que o motor sai quando quer ser religado.
    public static let intentionalExit: Int32 = 75
    /// Quantas falhas seguidas fazem a casca desistir, por padrão.
    public static let maxConsecutiveFailures = 5
    /// Teto do recuo entre uma tentativa e outra, em segundos.
    static let maxDelay: Double = 30

    /// Quantas falhas seguidas fazem esta política desistir.
    public let maxConsecutiveFailures: Int

    public init(maxConsecutiveFailures: Int = RestartPolicy.maxConsecutiveFailures) {
        self.maxConsecutiveFailures = maxConsecutiveFailures
    }

    /// Decide o que fazer depois da saída com `code`.
    ///
    /// `consecutiveFailures` já conta esta saída quando ela é falha (a primeira falha chega
    /// como 1). Para `75` e `0` o número é ignorado.
    public func delay(afterExit code: Int32, consecutiveFailures: Int) -> RestartDecision {
        if code == Self.intentionalExit { return .immediately }
        if code == 0 { return .stop(reason: "encerrado") }
        if consecutiveFailures >= maxConsecutiveFailures {
            return .stop(
                reason: "o motor não ficou de pé depois de \(maxConsecutiveFailures) tentativas"
            )
        }
        let exponent = Double(max(consecutiveFailures, 1) - 1)
        return .after(seconds: min(Self.maxDelay, pow(2, exponent)))
    }
}
