import FarolContrato
import Foundation
import Testing

@testable import FarolSidecar

/// Resposta SSE do motor, sem `Content-Length`: o fluxo acaba quando a conexão fecha.
private func sse(_ text: String) -> Data {
    FakeHTTPServer.response(status: 200, contentType: "text/event-stream", body: text, contentLength: false)
}

private let shellBody =
    ##"{"badge":{"contador":2,"rotulo":"2"},"ocupado":true,"autostart":false,"cores":{"bg":"#000","symbol":"#fff"}}"##
private let noticeBody =
    ##"{"titulo":"T","corpo":"C","url":"https://github.com/o/r/pull/1","pr":"o/r#1","silencioso":false}"##
private let exitBody = #"{"motivo":"update","proximaVersao":"3.1.0"}"#

private let expectedShell = ShellEvent.shell(
    ShellState(
        badgeCount: 2, badgeLabel: "2", busy: true, autostart: false,
        colors: ShellColors(bg: "#000", symbol: "#fff")))
private let expectedNotice = ShellEvent.notice(
    NativeNotice(
        title: "T", body: "C", url: URL(string: "https://github.com/o/r/pull/1"), pr: "o/r#1",
        silent: false))
private let expectedExit = ShellEvent.exit(ExitNotice(reason: "update", nextVersion: "3.1.0"))

/// Recuo curto para os testes de reconexão.
private let fastBackoff = BackoffSchedule(initial: .milliseconds(20), maximum: .milliseconds(80))

@Suite struct EventStreamTests {
    @Test func defaultBackoffDoublesFromThreeUpToThirtySeconds() {
        let delays = (0..<7).map { BackoffSchedule.default.delay(attempt: $0) }
        #expect(delays == [3, 6, 12, 24, 30, 30, 30].map { Duration.seconds($0) })
        #expect(BackoffSchedule.default.delay(attempt: 500) == .seconds(30))
    }

    @Test func yieldsOnlyTheShellEventsAndSendsTheHeaders() async throws {
        let bigState = "{\"itens\":[" + Array(repeating: "\"x\"", count: 50_000).joined(separator: ",") + "]}"
        let stream =
            "event: state\ndata: \(bigState)\n\n"
            + "event: state-patch\ndata: {\"a\":1}\n\n"
            + "event: ping\ndata: 1\n\n"
            + "event: casca\ndata: \(shellBody)\n\n"
            + "event: algo-novo\ndata: {}\n\n"
            + "event: aviso-nativo\ndata: \(noticeBody)\n\n"
            + "event: casca\ndata: {\"quebrado\":true}\n\n"
            + "event: casca-saida\ndata: \(exitBody)\n\n"
        let response = sse(stream)
        let server = try FakeHTTPServer { _, _ in response }
        defer { server.stop() }
        let port = try await server.start()
        let events = EventStream(
            port: port, token: "tok-teste",
            backoff: BackoffSchedule(initial: .seconds(30), maximum: .seconds(30)))
        let collector = Collector(events.events)
        defer { collector.cancel() }
        await events.start()

        #expect(await waitUntil(within: 3) { collector.values.count >= 3 })
        try await Task.sleep(for: .milliseconds(300))
        await events.stop()

        #expect(collector.values == [.event(expectedShell), .event(expectedNotice), .event(expectedExit)])
        #expect(server.connectionCount == 1)
        let lines = headerLines(of: try #require(server.receivedRequests.first))
        #expect(lines.first == "get /api/events http/1.1")
        #expect(lines.contains("authorization: bearer tok-teste"))
        #expect(lines.contains("x-farol: 1"))
        #expect(lines.contains("accept: text/event-stream"))
        #expect(lines.contains("host: 127.0.0.1:\(port)"))
    }

    @Test func unauthorizedIsYieldedOnceAndStopsReconnecting() async throws {
        let response = FakeHTTPServer.response(
            status: 401, contentType: "application/json", body: #"{"error":"nao_autenticado"}"#)
        let server = try FakeHTTPServer { _, _ in response }
        defer { server.stop() }
        let port = try await server.start()
        let events = EventStream(port: port, token: "tok-teste", backoff: fastBackoff)
        let collector = Collector(events.events)
        defer { collector.cancel() }
        await events.start()

        #expect(await waitUntil(within: 3) { !collector.values.isEmpty })
        try await Task.sleep(for: .milliseconds(300))
        #expect(collector.values == [.unauthorized])
        #expect(server.connectionCount == 1)

        await events.start()
        #expect(await waitUntil(within: 3) { collector.values.count >= 2 })
        try await Task.sleep(for: .milliseconds(300))
        await events.stop()

        #expect(collector.values == [.unauthorized, .unauthorized])
        #expect(server.connectionCount == 2)
    }

    @Test func reconnectsAfterDropAndErrorWithTheBackoff() async throws {
        let served = sse("event: casca\ndata: \(shellBody)\n\n")
        let unavailable = FakeHTTPServer.response(status: 503, contentType: "text/plain", body: "")
        let server = try FakeHTTPServer { connection, _ in
            switch connection {
            case 0: nil
            case 1: unavailable
            default: served
            }
        }
        defer { server.stop() }
        let port = try await server.start()
        let events = EventStream(port: port, token: "tok-teste", backoff: fastBackoff)
        let collector = Collector(events.events)
        defer { collector.cancel() }
        await events.start()

        #expect(await waitUntil(within: 3) { !collector.values.isEmpty })
        await events.stop()

        #expect(collector.values.first == .event(expectedShell))
        #expect(server.connectionCount >= 3)
    }

    @Test func stopEndsTheReconnections() async throws {
        let server = try FakeHTTPServer { _, _ in nil }
        defer { server.stop() }
        let port = try await server.start()
        let events = EventStream(port: port, token: "tok-teste", backoff: fastBackoff)
        await events.start()

        #expect(await waitUntil(within: 3) { server.connectionCount >= 2 })
        await events.stop()
        try await Task.sleep(for: .milliseconds(50))
        let afterStop = server.connectionCount
        try await Task.sleep(for: .milliseconds(300))

        #expect(server.connectionCount == afterStop)
    }
}
