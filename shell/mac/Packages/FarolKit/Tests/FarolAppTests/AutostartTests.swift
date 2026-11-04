import FarolContrato
import Foundation
import ServiceManagement
import Testing
import os

@testable import FarolApp

/// Serviço de login item falso: guarda as chamadas e pode lançar.
final class FakeLoginItemService: LoginItemService {
    struct Failure: Error {}

    private let registered: Bool
    private let fails: Bool
    private let calls = OSAllocatedUnfairLock(initialState: [String]())

    init(registered: Bool, fails: Bool = false) {
        self.registered = registered
        self.fails = fails
    }

    var isRegistered: Bool { registered }

    func register() throws {
        calls.withLock { $0.append("register") }
        if fails { throw Failure() }
    }

    func unregister() throws {
        calls.withLock { $0.append("unregister") }
        if fails { throw Failure() }
    }

    var recorded: [String] { calls.withLock { $0 } }
}

/// Guarda as linhas de log para o teste conferir.
final class LogSink: Sendable {
    private let lines = OSAllocatedUnfairLock(initialState: [String]())

    var log: @Sendable (String) -> Void {
        { [lines] line in lines.withLock { $0.append(line) } }
    }

    var recorded: [String] { lines.withLock { $0 } }
}

@Suite struct AutostartTests {
    @Test func desiredFollowsTheEngine() {
        let colors = ShellColors(bg: "#000000", symbol: "#ffffff")
        let on = ShellState(badgeCount: 0, badgeLabel: "", busy: false, autostart: true, colors: colors)
        let off = ShellState(badgeCount: 0, badgeLabel: "", busy: false, autostart: false, colors: colors)

        #expect(Autostart.desired(from: on))
        #expect(!Autostart.desired(from: off))
    }

    @Test func wantedAndNotRegisteredRegistersOnce() {
        let service = FakeLoginItemService(registered: false)
        Autostart(service: service).apply(true)
        #expect(service.recorded == ["register"])
    }

    @Test func wantedAndRegisteredDoesNothing() {
        let service = FakeLoginItemService(registered: true)
        Autostart(service: service).apply(true)
        #expect(service.recorded.isEmpty)
    }

    @Test func notWantedAndRegisteredUnregistersOnce() {
        let service = FakeLoginItemService(registered: true)
        Autostart(service: service).apply(false)
        #expect(service.recorded == ["unregister"])
    }

    @Test func notWantedAndNotRegisteredDoesNothing() {
        let service = FakeLoginItemService(registered: false)
        Autostart(service: service).apply(false)
        #expect(service.recorded.isEmpty)
    }

    @Test func errorBecomesALogLineAndIsNotPropagated() {
        let service = FakeLoginItemService(registered: false, fails: true)
        let sink = LogSink()

        Autostart(service: service, log: sink.log).apply(true)

        #expect(service.recorded == ["register"])
        #expect(sink.recorded.count == 1)
        #expect(sink.recorded.first?.contains("abrir junto com o sistema") == true)
    }

    @Test func enabledAndAwaitingApprovalCountAsRegistered() {
        #expect(MainAppLoginItem.isRegistered(status: .enabled))
        #expect(MainAppLoginItem.isRegistered(status: .requiresApproval))
        #expect(!MainAppLoginItem.isRegistered(status: .notRegistered))
        #expect(!MainAppLoginItem.isRegistered(status: .notFound))
    }
}
