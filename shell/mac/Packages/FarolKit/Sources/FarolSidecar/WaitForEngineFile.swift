import FarolContrato
import Foundation

/// Falhas da espera do `casca.json`.
public enum EngineFileError: Error, Equatable, Sendable {
    /// O motor não publicou o arquivo dentro do prazo.
    case timeout
}

/// Espera o motor publicar o `casca.json` em `url` e devolve o conteúdo.
///
/// Lê a cada `pollInterval` segundos. Arquivo ausente ou ainda pela metade lê como `nil`
/// (`EngineFile.read`) e é só lido de novo; passado `timeout`, lança `EngineFileError.timeout`.
/// Respeita o cancelamento da tarefa. Erro de leitura que esperar não resolve (permissão)
/// sobe como veio. Com `mark`, arquivo que a marca não aceita (o de antes da subida) é tratado
/// como ausente.
public func waitForEngineFile(
    at url: URL,
    accepting mark: SpawnMark? = nil,
    timeout: Double = 30,
    pollInterval: Double = 0.2
) async throws -> EngineFile {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: .seconds(timeout))
    while true {
        try Task.checkCancellation()
        if let file = try EngineFile.read(at: url), mark?.accepts(file) ?? true {
            return file
        }
        if clock.now >= deadline {
            throw EngineFileError.timeout
        }
        try await Task.sleep(for: .seconds(pollInterval))
    }
}
