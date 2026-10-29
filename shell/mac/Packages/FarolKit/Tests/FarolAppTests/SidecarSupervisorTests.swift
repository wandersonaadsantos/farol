import FarolContrato
import FarolSidecar
import Foundation
import Testing
import os

@testable import FarolApp

// MARK: Falsos

/// Motor falso: conta subidas e paradas, e o teste decide quando ele "sai".
final class FakeEngine: EngineControl {
    let exitCodes: AsyncStream<Int32>
    private let continuation: AsyncStream<Int32>.Continuation
    private let counts = OSAllocatedUnfairLock(initialState: (starts: 0, stops: 0))

    init() {
        (exitCodes, continuation) = AsyncStream.makeStream(of: Int32.self)
    }

    var starts: Int { counts.withLock { $0.starts } }
    var stops: Int { counts.withLock { $0.stops } }

    func start() async throws { counts.withLock { $0.starts += 1 } }
    func stop() async { counts.withLock { $0.stops += 1 } }
    func exit(_ code: Int32) { continuation.yield(code) }
}

/// O `casca.json` falso: o que a leitura avulsa vê e o que a espera entrega.
final class FakeFiles: Sendable {
    private struct State {
        var current: EngineFile?
        var pending: EngineFile?
        var removals = 0
        var timeoutNext = false
    }
    private let state = OSAllocatedUnfairLock(initialState: State())

    var current: EngineFile? {
        get { state.withLock { $0.current } }
        set { state.withLock { $0.current = newValue } }
    }
    var removals: Int { state.withLock { $0.removals } }

    /// A próxima espera recebe `file`.
    func publish(_ file: EngineFile) { state.withLock { $0.pending = file } }
    /// A próxima espera estoura o prazo.
    func timeoutNextWait() { state.withLock { $0.timeoutNext = true } }

    func remove() { state.withLock { $0.removals += 1 } }

    func wait() async throws -> EngineFile {
        while true {
            try Task.checkCancellation()
            let next: Result<EngineFile, any Error>? = state.withLock { state in
                if state.timeoutNext {
                    state.timeoutNext = false
                    return .failure(EngineFileError.timeout)
                }
                guard let file = state.pending else { return nil }
                state.pending = nil
                return .success(file)
            }
            if let next { return try next.get() }
            try await Task.sleep(for: .milliseconds(5))
        }
    }
}

/// Pareamento falso: respostas em fila, pedidos guardados.
final class FakePairing: Sendable {
    private let state = OSAllocatedUnfairLock(
        initialState: (answers: [Result<String, PairingError>](), calls: [String]()))

    func enqueue(_ answer: Result<String, PairingError>) { state.withLock { $0.answers.append(answer) } }
    var codes: [String] { state.withLock { $0.calls } }

    func pair(port: Int, code: String) async throws -> String {
        let answer = state.withLock { state -> Result<String, PairingError> in
            state.calls.append(code)
            return state.answers.isEmpty ? .failure(.transport("sem resposta")) : state.answers.removeFirst()
        }
        return try answer.get()
    }
}

/// Fluxo de eventos falso, um por pareamento.
final class FakeEventSource: EventSource {
    let events: AsyncStream<EventStreamOutput>
    let token: String
    private let continuation: AsyncStream<EventStreamOutput>.Continuation
    private let flags = OSAllocatedUnfairLock(initialState: (started: false, stopped: false))

    init(token: String) {
        self.token = token
        (events, continuation) = AsyncStream.makeStream(of: EventStreamOutput.self)
    }

    var started: Bool { flags.withLock { $0.started } }
    var stopped: Bool { flags.withLock { $0.stopped } }

    func start() async { flags.withLock { $0.started = true } }
    func stop() async { flags.withLock { $0.stopped = true } }
    func send(_ output: EventStreamOutput) { continuation.yield(output) }
}

/// Guarda o que o supervisor criou e o que ele dormiu.
final class Recorder: Sendable {
    private struct State {
        var sources: [FakeEventSource] = []
        var sleeps: [Double] = []
        var tokens: [String] = []
        var reopenVersion: String?
    }
    private let state = OSAllocatedUnfairLock(initialState: State())

    var sources: [FakeEventSource] { state.withLock { $0.sources } }
    var sleeps: [Double] { state.withLock { $0.sleeps } }
    var tokens: [String] { state.withLock { $0.tokens } }

    func add(_ source: FakeEventSource) { state.withLock { $0.sources.append(source) } }
    func slept(_ seconds: Double) { state.withLock { $0.sleeps.append(seconds) } }
    func saved(_ token: String) { state.withLock { $0.tokens.append(token) } }
    func setReopenVersion(_ version: String?) { state.withLock { $0.reopenVersion = version } }
    func takeReopenVersion() -> String? {
        state.withLock { state in
            defer { state.reopenVersion = nil }
            return state.reopenVersion
        }
    }
}

/// A interface falsa: guarda o que o supervisor pediu.
@MainActor
final class FakeShellUI: ShellUI {
    struct Window: Equatable {
        let port: Int
        let token: String?
        let viewer: Bool
    }
    var windows: [Window] = []
    var viewerNotices = 0
    var failures: [String] = []
    var states: [ShellState] = []
    var autostarts: [Bool] = []
    var notices: [NativeNotice] = []

    func openWindow(port: Int, token: String?, viewer: Bool) {
        windows.append(Window(port: port, token: token, viewer: viewer))
    }
    func showViewerNotice() { viewerNotices += 1 }
    func showFailure(_ message: String) { failures.append(message) }
    func apply(_ state: ShellState) { states.append(state) }
    func applyAutostart(_ wanted: Bool) { autostarts.append(wanted) }
    func post(_ notice: NativeNotice) { notices.append(notice) }
}

// MARK: Montagem

@MainActor
private struct Harness {
    let engine = FakeEngine()
    let files = FakeFiles()
    let pairing = FakePairing()
    let recorder = Recorder()
    let ui = FakeShellUI()
    let supervisor: SidecarSupervisor

    init(alive: Bool = false) {
        let files = files
        let pairing = pairing
        let recorder = recorder
        let services = SidecarServices(
            engine: engine,
            readEngineFile: { files.current },
            removeEngineFile: { files.remove() },
            waitForEngineFile: { try await files.wait() },
            isEngineAlive: { _ in alive },
            pair: { try await pairing.pair(port: $0, code: $1) },
            saveToken: { recorder.saved($0) },
            makeEventSource: { _, token in
                let source = FakeEventSource(token: token)
                recorder.add(source)
                return source
            },
            checkNow: { _, _ in },
            consumeSilentReopen: { recorder.takeReopenVersion() },
            sleep: { seconds in
                recorder.slept(seconds)
                await Task.yield()
            }
        )
        supervisor = SidecarSupervisor(services: services, ui: ui)
    }
}

private func engineFile(code: String, port: Int = 47190, pid: Int32 = 4242) -> EngineFile {
    EngineFile(
        port: port, pid: pid, version: "2.80.0", pairingCode: code, startedAt: Date(), nextVersion: nil)
}

private let shellState = ShellState(
    badgeCount: 2, badgeLabel: "2 pendências", busy: false, autostart: true,
    colors: ShellColors(bg: "#0b0e14", symbol: "#ffffff"))

/// Espera a condição valer na thread principal, conferindo a cada 5 ms, por até 3 s.
@MainActor
private func eventually(_ condition: @MainActor () -> Bool) async -> Bool {
    let deadline = ContinuousClock.now + .seconds(3)
    while ContinuousClock.now < deadline {
        if condition() { return true }
        try? await Task.sleep(for: .milliseconds(5))
    }
    return condition()
}

/// Sobe do zero até a janela pareada, com o token `tok1`.
@MainActor
private func bootToReady(_ h: Harness) async {
    h.pairing.enqueue(.success("tok1"))
    await h.supervisor.boot()
    _ = await eventually { h.engine.starts == 1 }
    h.files.publish(engineFile(code: "C1"))
    _ = await eventually { h.ui.windows.count == 1 && h.recorder.sources.first?.started == true }
}

// MARK: Testes

@MainActor
@Suite struct SidecarSupervisorTests {
    @Test func bootWithoutFileSpawnsPairsAndOpensTheWindow() async {
        let h = Harness()
        await bootToReady(h)

        #expect(h.engine.starts == 1)
        #expect(h.files.removals == 1)
        #expect(h.pairing.codes == ["C1"])
        #expect(h.recorder.tokens == ["tok1"])
        #expect(h.ui.windows == [.init(port: 47190, token: "tok1", viewer: false)])
        #expect(h.recorder.sources.map(\.token) == ["tok1"])
        #expect(h.supervisor.phase == .ready(port: 47190))
    }

    @Test func bootWithLiveEngineOpensAsViewerWithoutSpawning() async {
        let h = Harness(alive: true)
        h.files.current = engineFile(code: "OUTRO")

        await h.supervisor.boot()

        #expect(h.ui.windows == [.init(port: 47190, token: nil, viewer: true)])
        #expect(h.ui.viewerNotices == 1)
        #expect(h.engine.starts == 0)
        #expect(h.files.removals == 0)
        #expect(h.recorder.sources.isEmpty)
        #expect(h.supervisor.phase == .viewer(port: 47190))
    }

    @Test func intentionalExitRestartsAtOnceAndAnnouncesTheUpdate() async {
        let h = Harness()
        await bootToReady(h)
        h.recorder.setReopenVersion("2.81.0")

        h.engine.exit(75)

        #expect(await eventually { h.engine.starts == 2 })
        #expect(h.recorder.sleeps == [0])
        #expect(h.recorder.sources[0].stopped)
        #expect(h.ui.notices.map(\.title) == ["Farol atualizado"])
        #expect(h.ui.notices.first?.body == "Agora na versão 2.81.0. Segue monitorando na bandeja.")
        #expect(h.supervisor.phase == .waitingForFile)
    }

    @Test func fiveFailuresShowTheAlertAndRetrySpawnsAgain() async {
        let h = Harness()
        await h.supervisor.boot()
        for attempt in 1...5 {
            _ = await eventually { h.engine.starts == attempt }
            h.engine.exit(1)
        }

        #expect(await eventually { h.ui.failures.count == 1 })
        #expect(h.engine.starts == 5)
        #expect(h.recorder.sleeps == [1, 2, 4, 8])

        h.supervisor.retry()

        #expect(await eventually { h.engine.starts == 6 })
    }

    @Test func unauthorizedRepairsOnceThenReopensWithoutToken() async {
        let h = Harness()
        await bootToReady(h)
        h.files.current = engineFile(code: "C2")
        h.pairing.enqueue(.success("tok2"))

        h.recorder.sources[0].send(.unauthorized)

        #expect(await eventually { h.recorder.sources.count == 2 && h.recorder.sources[1].started })
        #expect(h.pairing.codes == ["C1", "C2"])
        #expect(h.ui.windows.last == .init(port: 47190, token: "tok2", viewer: false))

        h.recorder.sources[1].send(.unauthorized)

        #expect(await eventually { h.ui.windows.count == 3 })
        #expect(h.ui.windows.last == .init(port: 47190, token: nil, viewer: false))
        #expect(h.pairing.codes == ["C1", "C2"])
        #expect(h.recorder.sources.count == 2)
    }

    @Test func refusedPairingOpensTheWindowWithoutToken() async {
        let h = Harness()
        h.pairing.enqueue(.failure(.refused(code: "codigo_invalido")))
        await h.supervisor.boot()
        _ = await eventually { h.engine.starts == 1 }
        h.files.publish(engineFile(code: "C1"))

        #expect(await eventually { h.ui.windows.count == 1 })
        #expect(h.ui.windows == [.init(port: 47190, token: nil, viewer: false)])
        #expect(h.pairing.codes == ["C1"])
        #expect(h.recorder.sources.isEmpty)
    }

    @Test func transportFailureRetriesThePairingOnceAfterOneSecond() async {
        let h = Harness()
        h.pairing.enqueue(.failure(.transport("URLError -1004")))
        h.pairing.enqueue(.success("tok1"))
        await h.supervisor.boot()
        _ = await eventually { h.engine.starts == 1 }
        h.files.publish(engineFile(code: "C1"))

        #expect(await eventually { h.ui.windows.count == 1 })
        #expect(h.pairing.codes == ["C1", "C1"])
        #expect(h.recorder.sleeps == [1])
        #expect(h.ui.windows == [.init(port: 47190, token: "tok1", viewer: false)])
    }

    @Test func fileTimeoutStopsTheEngineAndCountsAsFailure() async {
        let h = Harness()
        h.files.timeoutNextWait()
        await h.supervisor.boot()

        #expect(await eventually { h.engine.starts == 2 })
        #expect(h.engine.stops == 1)
        #expect(h.recorder.sleeps == [1])
        #expect(h.supervisor.consecutiveFailures == 1)
    }

    @Test func shellEventsReachTheInterfaceAndAutostartOnlyWhenItChanges() async {
        let h = Harness()
        await bootToReady(h)
        let source = h.recorder.sources[0]
        let notice = NativeNotice(title: "t", body: "b", url: nil, pr: "o/r#1", silent: false)
        let off = ShellState(
            badgeCount: 0, badgeLabel: "", busy: false, autostart: false, colors: shellState.colors)

        source.send(.event(.shell(shellState)))
        source.send(.event(.shell(shellState)))
        source.send(.event(.shell(off)))
        source.send(.event(.notice(notice)))
        source.send(.event(.exit(ExitNotice(reason: "update", nextVersion: "2.81.0"))))

        #expect(await eventually { h.supervisor.nextVersion == "2.81.0" })
        #expect(h.ui.states == [shellState, shellState, off])
        #expect(h.ui.autostarts == [true, false])
        #expect(h.ui.notices == [notice])
    }

    @Test func shutdownStopsTheEngineAndIgnoresLaterExits() async {
        let h = Harness()
        await bootToReady(h)

        await h.supervisor.shutdown()
        h.engine.exit(1)
        try? await Task.sleep(for: .milliseconds(100))

        #expect(h.engine.stops == 1)
        #expect(h.recorder.sources[0].stopped)
        #expect(h.engine.starts == 1)
        #expect(h.supervisor.phase == .ready(port: 47190))
    }
}
