import Foundation
import Testing

@testable import FarolSidecar

@Suite struct EngineCommandsTests {
    @Test func checkNowPostsWithTheContractHeaders() async throws {
        let server = try FakeHTTPServer(body: #"{"ok":true}"#)
        defer { server.stop() }
        let port = try await server.start()

        try await EngineCommands(port: port, token: "tok-teste").checkNow()

        let request = try #require(server.receivedRequests.first)
        let lines = headerLines(of: request)
        #expect(lines.first == "post /api/check http/1.1")
        #expect(lines.contains("x-farol: 1"))
        #expect(lines.contains("host: 127.0.0.1:\(port)"))
        #expect(lines.contains("authorization: bearer tok-teste"))
    }

    @Test func nonOkStatusThrows() async throws {
        let response = FakeHTTPServer.response(
            status: 401, contentType: "application/json", body: #"{"error":"nao_autenticado"}"#)
        let server = try FakeHTTPServer { _, _ in response }
        defer { server.stop() }
        let port = try await server.start()

        await #expect(throws: EngineCommandError.status(401)) {
            try await EngineCommands(port: port, token: "tok-teste").checkNow()
        }
    }
}
