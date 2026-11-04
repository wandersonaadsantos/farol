import Foundation

/// O arquivo de descoberta que o motor grava em `~/.farol/state/casca.json` depois de escutar.
///
/// As chaves do JSON são as do motor, em português; as propriedades ficam em inglês.
/// `iniciadoEm` chega em milissegundos desde a época Unix.
public struct EngineFile: Codable, Equatable, Sendable {
    /// Porta efetiva em que o motor escuta (127.0.0.1).
    public let port: Int
    /// Processo do motor.
    public let pid: Int32
    /// Versão do motor que está rodando.
    public let version: String
    /// Código de pareamento de uso único, novo a cada subida do motor.
    public let pairingCode: String
    /// Quando o motor subiu.
    public let startedAt: Date
    /// Versão que vai subir depois de uma saída por update, quando houver.
    public let nextVersion: String?

    public init(
        port: Int,
        pid: Int32,
        version: String,
        pairingCode: String,
        startedAt: Date,
        nextVersion: String?
    ) {
        self.port = port
        self.pid = pid
        self.version = version
        self.pairingCode = pairingCode
        self.startedAt = startedAt
        self.nextVersion = nextVersion
    }

    enum CodingKeys: String, CodingKey {
        case port = "porta"
        case pid
        case version = "versao"
        case pairingCode = "codigoPareamento"
        case startedAt = "iniciadoEm"
        case nextVersion = "proximaVersao"
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        port = try container.decode(Int.self, forKey: .port)
        pid = try container.decode(Int32.self, forKey: .pid)
        version = try container.decode(String.self, forKey: .version)
        pairingCode = try container.decode(String.self, forKey: .pairingCode)
        let milliseconds = try container.decode(Double.self, forKey: .startedAt)
        startedAt = Date(timeIntervalSince1970: milliseconds / 1000)
        nextVersion = try container.decodeIfPresent(String.self, forKey: .nextVersion)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(port, forKey: .port)
        try container.encode(pid, forKey: .pid)
        try container.encode(version, forKey: .version)
        try container.encode(pairingCode, forKey: .pairingCode)
        try container.encode(startedAt.timeIntervalSince1970 * 1000, forKey: .startedAt)
        try container.encode(nextVersion, forKey: .nextVersion)
    }

    /// Lê o `casca.json` em `url`.
    ///
    /// Arquivo ausente devolve `nil` (o motor ainda não escutou ou já saiu). Conteúdo que
    /// não é JSON ou não tem a forma esperada também devolve `nil`: o motor pode estar no
    /// meio da gravação, e quem chama espera o próximo. Só lança erro de leitura que não
    /// seja "não existe" (permissão, por exemplo), que não se resolve esperando.
    public static func read(at url: URL) throws -> EngineFile? {
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            return nil
        }
        return try? JSONDecoder().decode(EngineFile.self, from: data)
    }
}
