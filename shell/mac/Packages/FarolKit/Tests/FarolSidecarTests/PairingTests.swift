import Foundation
import Testing

@testable import FarolSidecar

@Suite struct PairingTests {
    @Test func acceptedCodeReturnsTheTokenAndSendsTheContract() async throws {
        let server = try FakeHTTPServer(body: #"{"ok":true,"token":"tok-teste"}"#)
        defer { server.stop() }
        let port = try await server.start()

        let token = try await Pairing.pair(port: port, code: "ABCDE12345", label: "Farol.app")

        #expect(token == "tok-teste")
        let request = try #require(server.receivedRequests.first)
        let lines = headerLines(of: request)
        #expect(lines.first == "post /api/auth/pair http/1.1")
        #expect(lines.contains("x-farol: 1"))
        #expect(lines.contains("host: 127.0.0.1:\(port)"))
        #expect(lines.contains("content-type: application/json"))
        let object = try #require(
            try JSONSerialization.jsonObject(with: body(of: request)) as? [String: String])
        #expect(object == ["codigo": "ABCDE12345", "rotulo": "Farol.app"])
    }

    @Test func refusedCodeThrowsTheReason() async throws {
        let server = try FakeHTTPServer(body: #"{"ok":false,"code":"codigo_invalido","restantes":4}"#)
        defer { server.stop() }
        let port = try await server.start()

        await #expect(throws: PairingError.refused(code: "codigo_invalido")) {
            try await Pairing.pair(port: port, code: "ABCDE12345")
        }
    }

    @Test func nonOkStatusIsTransportError() async throws {
        let response = FakeHTTPServer.response(
            status: 403, contentType: "application/json", body: #"{"error":"forbidden"}"#)
        let server = try FakeHTTPServer { _, _ in response }
        defer { server.stop() }
        let port = try await server.start()

        await #expect(throws: PairingError.transport("HTTP 403")) {
            try await Pairing.pair(port: port, code: "ABCDE12345")
        }
    }

    @Test func unexpectedBodyIsMalformed() async throws {
        let server = try FakeHTTPServer(body: #"{"ok":true}"#)
        defer { server.stop() }
        let port = try await server.start()

        await #expect(throws: PairingError.malformed) {
            try await Pairing.pair(port: port, code: "ABCDE12345")
        }
    }
}
