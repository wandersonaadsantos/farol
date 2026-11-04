import Foundation

/// O retrato de uma subida do motor, para a espera do `casca.json` não aceitar o arquivo que
/// já estava lá antes dela (o pid de um motor morto reaproveitado no recuo, outro Farol, um
/// filho do bootstrap ainda vivo): o código desse arquivo é gasto ou alheio.
public struct SpawnMark: Equatable, Sendable {
    /// O pid do `casca.json` que existia antes da subida, ou `nil` sem arquivo.
    public let previousPid: Int32?
    /// O instante em que a casca mandou subir o motor.
    public let spawnedAt: Date

    public init(previousPid: Int32?, spawnedAt: Date) {
        self.previousPid = previousPid
        self.spawnedAt = spawnedAt
    }

    /// O arquivo é desta subida: sem arquivo anterior, com outro pid, ou iniciado depois dela.
    public func accepts(_ file: EngineFile) -> Bool {
        guard let previousPid else { return true }
        return file.pid != previousPid || file.startedAt > spawnedAt
    }
}
