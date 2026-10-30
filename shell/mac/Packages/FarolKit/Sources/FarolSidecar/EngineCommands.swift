import Foundation

/// Por que um comando ao motor não foi aceito.
public enum EngineCommandError: Error, Equatable, Sendable {
    /// O motor respondeu com status diferente de 200.
    case status(Int)
    /// O pedido não chegou ao motor.
    case transport(String)
}

/// Os comandos que a casca manda ao motor fora da autenticação.
///
/// O único é `POST /api/check` (o "Checar agora" da bandeja): a casca é cliente do motor e
/// nunca decide nada por conta própria.
public struct EngineCommands: Sendable {
    private let port: Int
    private let token: String
    private let session: URLSession

    public init(port: Int, token: String, session: URLSession = .shared) {
        self.port = port
        self.token = token
        self.session = session
    }

    /// Pede ao motor uma checagem agora; status diferente de 200 lança.
    public func checkNow() async throws {
        guard (1...65535).contains(port), let url = URL(string: "http://127.0.0.1:\(port)/api/check")
        else { throw EngineCommandError.transport("porta inválida") }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        request.httpMethod = "POST"
        request.setValue("127.0.0.1:\(port)", forHTTPHeaderField: "Host")
        request.setValue("1", forHTTPHeaderField: "x-farol")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let response: URLResponse
        do {
            (_, response) = try await session.data(for: request)
        } catch {
            throw EngineCommandError.transport(
                (error as? URLError).map { "URLError \($0.code.rawValue)" } ?? "falha de rede")
        }
        guard let status = (response as? HTTPURLResponse)?.statusCode else {
            throw EngineCommandError.transport("resposta sem HTTP")
        }
        guard status == 200 else { throw EngineCommandError.status(status) }
    }
}
