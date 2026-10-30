import Foundation

/// Por que o pareamento com o motor não deu um token.
///
/// Nenhum caso carrega o código de pareamento nem o token: são segredos e podem acabar
/// em log por quem imprime o erro.
public enum PairingError: Error, Equatable, Sendable {
    /// O motor recusou o código (`codigo_invalido`, `bloqueado` e afins).
    case refused(code: String)
    /// O pedido não chegou ao motor ou voltou com status diferente de 200.
    case transport(String)
    /// O motor respondeu 200 com um corpo fora do contrato.
    case malformed
}

/// Troca o código de pareamento do `casca.json` por um token da API local.
public struct Pairing {
    /// `POST /api/auth/pair` com `{ codigo, rotulo }` em `127.0.0.1:<porta>`; devolve o token
    /// de `{ ok: true, token }`. `{ ok: false, code }` lança `PairingError.refused(code:)`.
    public static func pair(
        port: Int, code: String, label: String = "Farol.app", session: URLSession = .shared
    ) async throws -> String {
        guard (1...65535).contains(port), let url = URL(string: "http://127.0.0.1:\(port)/api/auth/pair")
        else { throw PairingError.transport("porta inválida") }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        request.httpMethod = "POST"
        request.setValue("127.0.0.1:\(port)", forHTTPHeaderField: "Host")
        request.setValue("1", forHTTPHeaderField: "x-farol")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(PairRequest(codigo: code, rotulo: label))

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw PairingError.transport(
                (error as? URLError).map { "URLError \($0.code.rawValue)" } ?? "falha de rede")
        }
        guard let status = (response as? HTTPURLResponse)?.statusCode else {
            throw PairingError.transport("resposta sem HTTP")
        }
        guard status == 200 else { throw PairingError.transport("HTTP \(status)") }
        guard let answer = try? JSONDecoder().decode(PairResponse.self, from: data) else {
            throw PairingError.malformed
        }
        if answer.ok, let token = answer.token, !token.isEmpty {
            return token
        }
        if !answer.ok, let reason = answer.code {
            throw PairingError.refused(code: reason)
        }
        throw PairingError.malformed
    }
}

/// Corpo do pedido como o motor lê.
private struct PairRequest: Encodable {
    let codigo: String
    let rotulo: String
}

/// Corpo da resposta como o motor escreve.
private struct PairResponse: Decodable {
    let ok: Bool
    let token: String?
    let code: String?
}
