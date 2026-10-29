import FarolContrato
import Foundation
import Network
import Testing

@testable import FarolSidecar

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
