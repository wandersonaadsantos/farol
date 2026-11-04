import Foundation

/// Onde moram os arquivos que a casca lê do motor.
///
/// O HOME do Farol é `$FAROL_HOME` quando definido (desenvolvimento e testes), senão
/// `~/.farol`. A casca só repassa o `FAROL_HOME` ao motor quando o próprio ambiente dela o
/// define; sem ele o motor chega ao mesmo `~/.farol` sozinho.
public struct ShellPaths: Equatable, Sendable {
    /// O HOME do Farol.
    public let home: URL
    /// O HOME a repassar ao motor, só quando veio do ambiente.
    public let explicitHome: URL?

    public init(environment: [String: String] = ProcessInfo.processInfo.environment) {
        if let value = environment["FAROL_HOME"], !value.isEmpty {
            let url = URL(fileURLWithPath: value, isDirectory: true)
            home = url
            explicitHome = url
        } else {
            home = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".farol", isDirectory: true)
            explicitHome = nil
        }
    }

    /// `<HOME>/state/casca.json`, o arquivo de descoberta do motor.
    public var engineFile: URL {
        home.appendingPathComponent("state/casca.json")
    }

    /// `<HOME>/workspace/state`, onde o motor grava o marcador de reabertura silenciosa.
    public var workspaceState: URL {
        home.appendingPathComponent("workspace/state", isDirectory: true)
    }
}
