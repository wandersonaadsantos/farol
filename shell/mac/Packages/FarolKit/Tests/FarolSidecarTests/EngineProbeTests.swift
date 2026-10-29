import FarolContrato
import Foundation
import Network
import Testing
import os

@testable import FarolSidecar

/// Servidor HTTP falso: responde a todo pedido com 200 e o corpo dado, guardando o
/// texto de cada pedido recebido para o teste conferir os cabeçalhos.
private final class FakeHTTPServer: Sendable {
    private let listener: NWListener
    private let requests = OSAllocatedUnfairLock(initialState: [String]())
    private let queue = DispatchQueue(label: "farol.teste.http")

    init(body: String) throws {
        listener = try NWListener(using: .tcp, on: .any)
        let response = Data(
            ("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \(body.utf8.count)\r\n"
                + "Connection: close\r\n\r\n" + body).utf8)
        listener.newConnectionHandler = { [requests, queue] connection in
            connection.start(queue: queue)
            Self.receive(on: connection, buffer: Data(), response: response, requests: requests)
        }
    }

    private static func receive(
        on connection: NWConnection, buffer: Data, response: Data,
        requests: OSAllocatedUnfairLock<[String]>
    ) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, isComplete, error in
            var buffer = buffer
            if let data { buffer.append(data) }
            if buffer.range(of: Data("\r\n\r\n".utf8)) != nil {
                let text = String(decoding: buffer, as: UTF8.self)
                requests.withLock { $0.append(text) }
                connection.send(
                    content: response,
                    completion: .contentProcessed { _ in connection.cancel() })
            } else if isComplete || error != nil {
                connection.cancel()
            } else {
                receive(on: connection, buffer: buffer, response: response, requests: requests)
            }
        }
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

    func stop() { listener.cancel() }
}

@Suite struct EngineProbeTests {
    @Test func farolAnswerIsRecognizedAndCarriesTheHeaders() async throws {
        let server = try FakeHTTPServer(body: #"{"exigida":true,"autenticado":false}"#)
        defer { server.stop() }
        let port = try await server.start()

        #expect(await EngineProbe.isFarol(port: port))
        let request = try #require(server.receivedRequests.first)
        let lines = request.split(separator: "\r\n").map { $0.lowercased() }
        #expect(lines.first == "get /api/auth/status http/1.1")
        #expect(lines.contains("x-farol: 1"))
        #expect(lines.contains("host: 127.0.0.1:\(port)"))
    }

    @Test func otherServerIsNotFarol() async throws {
        let server = try FakeHTTPServer(body: #"{"foo":1}"#)
        defer { server.stop() }
        let port = try await server.start()

        #expect(await EngineProbe.isFarol(port: port) == false)
    }

    @Test func closedPortIsNotFarol() async throws {
        let listener = try NWListener(using: .tcp, on: .any)
        listener.newConnectionHandler = { $0.cancel() }
        let port = try await FakeHTTPServer.ready(listener, queue: DispatchQueue(label: "farol.teste.porta"))
        listener.cancel()

        #expect(await EngineProbe.isFarol(port: port) == false)
    }

    @Test func processAliveness() {
        #expect(EngineProbe.isProcessAlive(pid: getpid()))
        #expect(EngineProbe.isProcessAlive(pid: 99_999_999) == false)
        #expect(EngineProbe.isProcessAlive(pid: 0) == false)
        #expect(EngineProbe.isProcessAlive(pid: -1) == false)
    }

    @Test func engineAliveNeedsBothProcessAndFarolAnswer() async throws {
        let server = try FakeHTTPServer(body: #"{"exigida":false}"#)
        defer { server.stop() }
        let port = try await server.start()
        let alive = EngineFile(
            port: port, pid: getpid(), version: "1.0.0", pairingCode: "X", startedAt: Date(),
            nextVersion: nil)
        let deadPid = EngineFile(
            port: port, pid: 99_999_999, version: "1.0.0", pairingCode: "X", startedAt: Date(),
            nextVersion: nil)

        #expect(await EngineProbe.isEngineAlive(alive))
        #expect(await EngineProbe.isEngineAlive(deadPid) == false)
    }
}
