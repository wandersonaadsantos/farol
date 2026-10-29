import FarolContrato
import FarolSidecar
import Foundation
import Testing
import os

@testable import FarolApp

// MARK: Falsos

/// Motor falso: registra subidas e paradas em ordem, e o teste decide quando ele "sai" e
/// quando uma subida pendente termina.
final class FakeEngine: EngineControl {
    let exitCodes: AsyncStream<Int32>
    private let continuation: AsyncStream<Int32>.Continuation
    private let state = OSAllocatedUnfairLock(
        initialState: (operations: [String](), entered: 0, holding: false))

    init() {
        (exitCodes, continuation) = AsyncStream.makeStream(of: Int32.self)
    }

    var starts: Int { operations.filter { $0 == "start" }.count }
    var stops: Int { operations.filter { $0 == "stop" }.count }
    /// "start" e "stop" na ordem em que terminaram.
    var operations: [String] { state.withLock { $0.operations } }
    /// Quantas subidas começaram (terminadas ou não).
    var entered: Int { state.withLock { $0.entered } }

    /// Com `true`, a próxima subida fica pendente até `holdStarts(false)`.
    func holdStarts(_ hold: Bool) { state.withLock { $0.holding = hold } }

    func start() async throws {
        state.withLock { $0.entered += 1 }
        while state.withLock({ $0.holding }) {
            try? await Task.sleep(for: .milliseconds(5))
        }
        state.withLock { $0.operations.append("start") }
    }
    func stop() async { state.withLock { $0.operations.append("stop") } }
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

/// Fluxo de eventos falso, um por pareamento; registra subidas e paradas em ordem.
final class FakeEventSource: EventSource {
    let events: AsyncStream<EventStreamOutput>
    let token: String
    private let startDelay: Duration
    private let continuation: AsyncStream<EventStreamOutput>.Continuation
    private let log = OSAllocatedUnfairLock(initialState: [String]())

    init(token: String, startDelay: Duration = .zero) {
        self.token = token
        self.startDelay = startDelay
        (events, continuation) = AsyncStream.makeStream(of: EventStreamOutput.self)
    }

    var operations: [String] { log.withLock { $0 } }
    var started: Bool { operations.contains("start") }
    var stopped: Bool { operations.contains("stop") }

    func start() async {
        if startDelay > .zero { try? await Task.sleep(for: startDelay) }
        log.withLock { $0.append("start") }
    }
    func stop() async { log.withLock { $0.append("stop") } }
    func send(_ output: EventStreamOutput) { continuation.yield(output) }
}

/// Os processos vivos e a sonda do Farol vistos pelo supervisor.
final class FakeProbe: Sendable {
    private struct State {
        var alivePids: Set<Int32> = []
        var farolAnswers: [Bool] = []
        var probes = 0
    }
    private let state = OSAllocatedUnfairLock(initialState: State())

    var probes: Int { state.withLock { $0.probes } }
    func setAlive(_ pids: Set<Int32>) { state.withLock { $0.alivePids = pids } }
    /// As respostas das próximas sondas, em ordem; acabou a fila, a sonda falha.
    func answer(_ answers: [Bool]) { state.withLock { $0.farolAnswers = answers } }

    func isAlive(_ pid: Int32) -> Bool { state.withLock { $0.alivePids.contains(pid) } }
    func isFarol() -> Bool {
        state.withLock { state in
            state.probes += 1
            return state.farolAnswers.isEmpty ? false : state.farolAnswers.removeFirst()
        }
    }
}

/// Guarda o que o supervisor criou e o que ele dormiu.
final class Recorder: Sendable {
    private struct State {
        var sources: [FakeEventSource] = []
        var sleeps: [Double] = []
        var tokens: [String] = []
        var checks: [String] = []
        var reopenVersion: String?
    }
    private let state = OSAllocatedUnfairLock(initialState: State())

    var sources: [FakeEventSource] { state.withLock { $0.sources } }
    var sleeps: [Double] { state.withLock { $0.sleeps } }
    var tokens: [String] { state.withLock { $0.tokens } }
    var checks: [String] { state.withLock { $0.checks } }

    func add(_ source: FakeEventSource) { state.withLock { $0.sources.append(source) } }
    func slept(_ seconds: Double) { state.withLock { $0.sleeps.append(seconds) } }
    func saved(_ token: String) { state.withLock { $0.tokens.append(token) } }
    func checked(port: Int, token: String) { state.withLock { $0.checks.append("\(port) \(token)") } }
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
    let probe = FakeProbe()
    let recorder = Recorder()
    let ui = FakeShellUI()
    let supervisor: SidecarSupervisor

    /// `storedToken` é o que o Keychain devolve; `stabilityWindow` vale 60 s como no app, e
    /// os testes da janela passam um valor curto.
    init(
        storedToken: String? = nil, stabilityWindow: Double = 60,
        sourceStartDelay: Duration = .zero
    ) {
        let files = files
        let pairing = pairing
        let probe = probe
        let recorder = recorder
        let services = SidecarServices(
            engine: engine,
            readEngineFile: { files.current },
            removeEngineFile: { files.remove() },
            waitForEngineFile: { try await files.wait() },
            isProcessAlive: { probe.isAlive($0) },
            isFarol: { _ in probe.isFarol() },
            pair: { try await pairing.pair(port: $0, code: $1) },
            saveToken: { recorder.saved($0) },
            loadToken: { storedToken },
            makeEventSource: { _, token in
                let source = FakeEventSource(token: token, startDelay: sourceStartDelay)
                recorder.add(source)
                return source
            },
            checkNow: { port, token in recorder.checked(port: port, token: token) },
            consumeSilentReopen: { recorder.takeReopenVersion() },
            sleep: { seconds in
                recorder.slept(seconds)
                await Task.yield()
            },
            stabilityWindow: stabilityWindow,
            probeRetryInterval: 0
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
        let h = Harness()
        h.files.current = engineFile(code: "OUTRO")
        h.probe.setAlive([4242])
        h.probe.answer([true])

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

    @Test func unauthorizedRestartsTheEngineOnceThenReopensWithoutToken() async {
        let h = Harness()
        await bootToReady(h)
        h.files.current = engineFile(code: "C1")
        h.pairing.enqueue(.success("tok2"))

        h.recorder.sources[0].send(.unauthorized)

        #expect(await eventually { h.engine.starts == 2 })
        #expect(h.engine.operations == ["start", "stop", "start"])
        #expect(h.recorder.sources[0].stopped)
        #expect(h.supervisor.phase == .waitingForFile)
        h.files.publish(engineFile(code: "C2"))

        #expect(await eventually { h.recorder.sources.count == 2 && h.recorder.sources[1].started })
        #expect(h.pairing.codes == ["C1", "C2"])
        #expect(h.ui.windows.last == .init(port: 47190, token: "tok2", viewer: false))
        #expect(h.supervisor.consecutiveFailures == 0)

        h.recorder.sources[1].send(.unauthorized)

        #expect(await eventually { h.ui.windows.count == 3 })
        #expect(h.ui.windows.last == .init(port: 47190, token: nil, viewer: false))
        #expect(h.pairing.codes == ["C1", "C2"])
        #expect(h.engine.operations == ["start", "stop", "start"])
        #expect(h.recorder.sources.count == 2)
        #expect(await eventually { h.recorder.sources[1].stopped })
        #expect(h.supervisor.consecutiveFailures == 0)
    }

    @Test func viewerWithStoredTokenOpensWithTheTokenAndListens() async {
        let h = Harness(storedToken: "guardado")
        h.files.current = engineFile(code: "OUTRO")
        h.probe.setAlive([4242])
        h.probe.answer([true])

        await h.supervisor.boot()

        #expect(h.ui.windows == [.init(port: 47190, token: "guardado", viewer: true)])
        #expect(await eventually { h.recorder.sources.first?.started == true })
        #expect(h.recorder.sources.map(\.token) == ["guardado"])

        await h.supervisor.checkNow()
        #expect(h.recorder.checks == ["47190 guardado"])

        h.recorder.sources[0].send(.unauthorized)

        #expect(await eventually { h.ui.windows.count == 2 })
        #expect(h.ui.windows.last == .init(port: 47190, token: nil, viewer: true))
        #expect(await eventually { h.recorder.sources[0].stopped })
        #expect(h.recorder.sources.count == 1)
        #expect(h.engine.entered == 0)
        #expect(h.pairing.codes.isEmpty)
        #expect(h.supervisor.phase == .viewer(port: 47190))

        await h.supervisor.checkNow()
        #expect(h.recorder.checks == ["47190 guardado"])
    }

    @Test func engineExitWhileTheEventSourceStartsLeavesNoSourceRunning() async {
        let h = Harness(sourceStartDelay: .milliseconds(80))
        h.pairing.enqueue(.success("tok1"))
        await h.supervisor.boot()
        _ = await eventually { h.engine.starts == 1 }
        h.files.publish(engineFile(code: "C1"))
        _ = await eventually { h.recorder.sources.count == 1 }

        h.engine.exit(1)

        #expect(await eventually { h.engine.starts == 2 })
        try? await Task.sleep(for: .milliseconds(200))
        let operations = h.recorder.sources[0].operations
        #expect(operations.last == "stop")
    }

    @Test func engineThatDiesBeforeTheStabilityWindowShowsTheAlert() async {
        let h = Harness()
        await h.supervisor.boot()
        for attempt in 1...5 {
            _ = await eventually { h.engine.starts == attempt }
            h.pairing.enqueue(.success("tok\(attempt)"))
            h.files.publish(engineFile(code: "C\(attempt)"))
            _ = await eventually { h.ui.windows.count == attempt }
            h.engine.exit(1)
        }

        #expect(await eventually { h.ui.failures.count == 1 })
        #expect(h.engine.starts == 5)
        #expect(h.recorder.sleeps == [1, 2, 4, 8])
        #expect(h.supervisor.consecutiveFailures == 5)
    }

    @Test func engineThatStaysUpThroughTheWindowResetsTheFailures() async {
        let h = Harness(stabilityWindow: 0.05)
        await h.supervisor.boot()
        for attempt in 1...5 {
            _ = await eventually { h.engine.starts == attempt }
            h.pairing.enqueue(.success("tok\(attempt)"))
            h.files.publish(engineFile(code: "C\(attempt)"))
            _ = await eventually { h.ui.windows.count == attempt }
            try? await Task.sleep(for: .milliseconds(150))
            h.engine.exit(1)
        }

        #expect(await eventually { h.engine.starts == 6 })
        #expect(h.ui.failures.isEmpty)
        #expect(h.recorder.sleeps == [1, 1, 1, 1, 1])
    }

    @Test func liveEnginePidWithSlowProbeOpensViewerAndKeepsTheFile() async {
        let h = Harness()
        h.files.current = engineFile(code: "OUTRO")
        h.probe.setAlive([4242])
        h.probe.answer([false, false, true])

        await h.supervisor.boot()

        #expect(h.probe.probes == 3)
        #expect(h.ui.windows == [.init(port: 47190, token: nil, viewer: true)])
        #expect(h.engine.entered == 0)
        #expect(h.files.removals == 0)
    }

    @Test func liveEnginePidThatNeverAnswersStillPrefersTheViewer() async {
        let h = Harness()
        h.files.current = engineFile(code: "OUTRO")
        h.probe.setAlive([4242])

        await h.supervisor.boot()

        #expect(h.probe.probes == 3)
        #expect(h.supervisor.phase == .viewer(port: 47190))
        #expect(h.engine.entered == 0)
        #expect(h.files.removals == 0)
    }

    @Test func deadEnginePidIsSpawnedOverAndTheOldFileRemoved() async {
        let h = Harness()
        h.files.current = engineFile(code: "VELHO")

        await h.supervisor.boot()

        #expect(await eventually { h.engine.starts == 1 })
        #expect(h.probe.probes == 0)
        #expect(h.files.removals == 1)
    }

    @Test func spawnKeepsTheFileOfALiveProcess() async {
        let h = Harness()
        await bootToReady(h)
        #expect(h.files.removals == 1)
        h.files.current = engineFile(code: "C1", pid: 5151)
        h.probe.setAlive([5151])

        h.recorder.sources[0].send(.unauthorized)

        #expect(await eventually { h.engine.starts == 2 })
        #expect(h.files.removals == 1)
    }

    @Test func shutdownDuringAPendingSpawnStopsAfterTheStart() async {
        let h = Harness()
        h.engine.holdStarts(true)
        await h.supervisor.boot()
        _ = await eventually { h.engine.entered == 1 }

        let supervisor = h.supervisor
        let shutdown = Task { await supervisor.shutdown() }
        try? await Task.sleep(for: .milliseconds(50))
        h.engine.holdStarts(false)
        await shutdown.value

        #expect(h.engine.operations == ["start", "stop"])
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
