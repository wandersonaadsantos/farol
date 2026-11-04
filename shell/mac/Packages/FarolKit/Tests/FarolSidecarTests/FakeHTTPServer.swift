import Foundation
import Network
import os

/// Servidor HTTP falso para os testes do `FarolSidecar`.
///
/// Para cada conexão, lê o pedido inteiro (cabeçalhos e corpo pelo `Content-Length`),
/// guarda o texto e pergunta ao `responder` o que mandar: os bytes devolvidos saem e a
/// conexão fecha; `nil` fecha sem responder nada. Conta as conexões recebidas.
final class FakeHTTPServer: Sendable {
    /// Recebe o índice da conexão (a partir de zero) e o texto do pedido.
    typealias Responder = @Sendable (_ connection: Int, _ request: String) -> Data?

    private let listener: NWListener
    private let requests = OSAllocatedUnfairLock(initialState: [String]())
    private let connections = OSAllocatedUnfairLock(initialState: 0)
    private let queue = DispatchQueue(label: "farol.teste.http")

    init(responder: @escaping Responder) throws {
        listener = try NWListener(using: .tcp, on: .any)
        listener.newConnectionHandler = { [requests, connections, queue] connection in
            let index = connections.withLock { count in
                defer { count += 1 }
                return count
            }
            connection.start(queue: queue)
            Self.receive(on: connection, buffer: Data()) { request in
                requests.withLock { $0.append(request) }
                guard let response = responder(index, request) else {
                    connection.cancel()
                    return
                }
                connection.send(
                    content: response,
                    completion: .contentProcessed { _ in connection.cancel() })
            }
        }
    }

    /// Responde 200 com o corpo JSON dado a todo pedido.
    convenience init(body: String) throws {
        let response = Self.response(status: 200, contentType: "application/json", body: body)
        try self.init { _, _ in response }
    }

    /// Uma resposta HTTP/1.1 completa; sem `contentLength`, o fim do corpo é o fechamento
    /// da conexão (como o fluxo SSE do motor).
    static func response(status: Int, contentType: String, body: String, contentLength: Bool = true)
        -> Data
    {
        var head = "HTTP/1.1 \(status) X\r\nContent-Type: \(contentType)\r\nConnection: close\r\n"
        if contentLength {
            head += "Content-Length: \(body.utf8.count)\r\n"
        }
        return Data((head + "\r\n" + body).utf8)
    }

    private static func receive(
        on connection: NWConnection, buffer: Data, complete: @escaping @Sendable (String) -> Void
    ) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, isComplete, error in
            var buffer = buffer
            if let data { buffer.append(data) }
            if let request = completeRequest(in: buffer) {
                complete(request)
            } else if isComplete || error != nil {
                connection.cancel()
            } else {
                receive(on: connection, buffer: buffer, complete: complete)
            }
        }
    }

    /// O texto do pedido quando os cabeçalhos e o corpo inteiro já chegaram.
    private static func completeRequest(in buffer: Data) -> String? {
        guard let headerEnd = buffer.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        let head = String(decoding: buffer[..<headerEnd.lowerBound], as: UTF8.self)
        let length =
            head.split(separator: "\r\n")
            .compactMap { line -> Int? in
                let parts = line.split(separator: ":", maxSplits: 1)
                guard parts.count == 2, parts[0].lowercased() == "content-length" else { return nil }
                return Int(parts[1].trimmingCharacters(in: .whitespaces))
            }
            .first ?? 0
        guard buffer.count - headerEnd.upperBound >= length else { return nil }
        return String(decoding: buffer, as: UTF8.self)
    }

    /// Começa a escutar e devolve a porta efetiva.
    func start() async throws -> Int {
        try await Self.ready(listener, queue: queue)
    }

    static func ready(_ listener: NWListener, queue: DispatchQueue) async throws -> Int {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Int, any Error>) in
            let resumed = OSAllocatedUnfairLock(initialState: false)
            listener.stateUpdateHandler = { state in
                let value: Result<Int, any Error>?
                switch state {
                case .ready: value = .success(Int(listener.port?.rawValue ?? 0))
                case .failed(let error): value = .failure(error)
                default: value = nil
                }
                guard let value else { return }
                let first = resumed.withLock { done in
                    defer { done = true }
                    return !done
                }
                if first { continuation.resume(with: value) }
            }
            listener.start(queue: queue)
        }
    }

    var receivedRequests: [String] { requests.withLock { $0 } }

    var connectionCount: Int { connections.withLock { $0 } }

    func stop() { listener.cancel() }
}

/// Os cabeçalhos de um pedido HTTP em minúsculas, uma linha por item (a primeira é a do método).
func headerLines(of request: String) -> [String] {
    let head = request.components(separatedBy: "\r\n\r\n").first ?? ""
    return head.components(separatedBy: "\r\n").map { $0.lowercased() }
}

/// O corpo de um pedido HTTP (o que vem depois da linha em branco).
func body(of request: String) -> Data {
    guard let range = request.range(of: "\r\n\r\n") else { return Data() }
    return Data(request[range.upperBound...].utf8)
}
