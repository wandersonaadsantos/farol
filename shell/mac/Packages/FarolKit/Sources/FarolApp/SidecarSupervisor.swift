import FarolContrato
import FarolSidecar
import Foundation
import os

/// O processo do motor visto pelo supervisor (o `EngineProcess`, ou um falso nos testes).
public protocol EngineControl: Sendable {
    /// Os códigos de saída do motor; o fim pedido pelo próprio `stop()` não aparece.
    var exitCodes: AsyncStream<Int32> { get }
    func start() async throws
    func stop() async
}

extension EngineProcess: EngineControl {}

/// O fluxo de eventos do motor visto pelo supervisor (o `EventStream`, ou um falso).
public protocol EventSource: Sendable {
    var events: AsyncStream<EventStreamOutput> { get }
    func start() async
    func stop() async
}

extension EventStream: EventSource {}

/// O que o supervisor pede à interface nativa (janela, bandeja, Dock, avisos).
@MainActor
public protocol ShellUI: AnyObject {
    /// Abre (ou refaz) a janela da `ui/` na porta, com o token injetado quando houver.
    func openWindow(port: Int, token: String?, viewer: Bool)
    /// O aviso único de que outro Farol já roda nesta porta.
    func showViewerNotice()
    /// O alerta de falha com "Tentar de novo" (que chama `SidecarSupervisor.retry()`).
    func showFailure(_ message: String)
    /// O retrato do evento `casca`: cores, selo do Dock e dica da bandeja.
    func apply(_ state: ShellState)
    /// Abrir junto com o sistema; chamado só quando o pedido do motor muda.
    func applyAutostart(_ wanted: Bool)
    /// Um aviso nativo.
    func post(_ notice: NativeNotice)
}

/// As fronteiras de entrada e saída do supervisor, trocadas por falsos nos testes.
public struct SidecarServices: Sendable {
    public var engine: any EngineControl
    /// O `casca.json` agora, ou `nil`.
    public var readEngineFile: @Sendable () -> EngineFile?
    /// Apaga o `casca.json` que sobrou de um motor morto, antes de subir outro.
    public var removeEngineFile: @Sendable () -> Void
    /// Espera o motor publicar o `casca.json`; lança no prazo estourado.
    public var waitForEngineFile: @Sendable () async throws -> EngineFile
    public var isEngineAlive: @Sendable (EngineFile) async -> Bool
    /// Troca o código por token: `(porta, código)`.
    public var pair: @Sendable (Int, String) async throws -> String
    public var saveToken: @Sendable (String) throws -> Void
    /// Um fluxo de eventos novo para `(porta, token)`.
    public var makeEventSource: @Sendable (Int, String) -> any EventSource
    /// O "Checar agora": `(porta, token)`.
    public var checkNow: @Sendable (Int, String) async throws -> Void
    /// Consome o marcador de reabertura silenciosa e devolve a versão nova.
    public var consumeSilentReopen: @Sendable () -> String?
    public var sleep: @Sendable (Double) async throws -> Void

    public init(
        engine: any EngineControl,
        readEngineFile: @escaping @Sendable () -> EngineFile?,
        removeEngineFile: @escaping @Sendable () -> Void,
        waitForEngineFile: @escaping @Sendable () async throws -> EngineFile,
        isEngineAlive: @escaping @Sendable (EngineFile) async -> Bool,
        pair: @escaping @Sendable (Int, String) async throws -> String,
        saveToken: @escaping @Sendable (String) throws -> Void,
        makeEventSource: @escaping @Sendable (Int, String) -> any EventSource,
        checkNow: @escaping @Sendable (Int, String) async throws -> Void,
        consumeSilentReopen: @escaping @Sendable () -> String?,
        sleep: @escaping @Sendable (Double) async throws -> Void
    ) {
        self.engine = engine
        self.readEngineFile = readEngineFile
        self.removeEngineFile = removeEngineFile
        self.waitForEngineFile = waitForEngineFile
        self.isEngineAlive = isEngineAlive
        self.pair = pair
        self.saveToken = saveToken
        self.makeEventSource = makeEventSource
        self.checkNow = checkNow
        self.consumeSilentReopen = consumeSilentReopen
        self.sleep = sleep
    }

    /// As peças de verdade: `EngineProcess` do `EngineLocator`, `casca.json` e marcador nos
    /// caminhos de `paths`, token no Keychain e o `EventStream`.
    public static func live(
        paths: ShellPaths, environment: [String: String], shellVersion: String
    ) -> SidecarServices {
        let located = EngineLocator.resolve(environment: environment)
        let engine = EngineProcess(
            node: located.node, serverJS: located.serverJS, home: paths.explicitHome,
            shellVersion: shellVersion)
        let fileURL = paths.engineFile
        let stateDir = paths.workspaceState
        return SidecarServices(
            engine: engine,
            readEngineFile: { try? EngineFile.read(at: fileURL) },
            removeEngineFile: { try? FileManager.default.removeItem(at: fileURL) },
            waitForEngineFile: { try await FarolSidecar.waitForEngineFile(at: fileURL) },
            isEngineAlive: { await EngineProbe.isEngineAlive($0) },
            pair: { try await Pairing.pair(port: $0, code: $1) },
            saveToken: { try TokenStore().save($0) },
            makeEventSource: { EventStream(port: $0, token: $1) },
            checkNow: { try await EngineCommands(port: $0, token: $1).checkNow() },
            consumeSilentReopen: { SilentReopen.consume(stateDir: stateDir) },
            sleep: { try await Task.sleep(for: .seconds($0)) }
        )
    }
}

/// Dirige a `SidecarMachine`: executa cada efeito e devolve cada resultado como entrada.
///
/// - `.spawn` apaga o `casca.json` velho (o motor morto por sinal não apaga o dele, e a
///   espera leria o código já gasto) e sobe o motor; falha ao subir conta como saída 1.
/// - `.waitFile` espera o arquivo; prazo estourado com o processo vivo é motor que não
///   publicou: o supervisor o para e entrega `.exited(code: 1)`, para o recuo valer.
/// - `.pair` troca o código pelo token; recusa vira `.pairFailed` direto, outra falha tenta
///   de novo uma vez depois de 1 s.
/// - `.openWindow` abre a janela e, com token, um `EventStream` novo (o token é fixo por fluxo).
/// - `.restart(after:)` dorme e entrega `.restartNow`.
///
/// Saída `75` (update do motor) consome também o marcador de reabertura silenciosa e posta o
/// "Farol atualizado": a casca não reinicia, só o motor, e um marcador esquecido faria a
/// próxima abertura manual, dentro de 10 minutos, subir sem janela.
///
/// Depois de `shutdown()` nada mais é entregue à máquina: a tarefa que lê os códigos de saída
/// é cancelada antes do `stop()` do motor.
@MainActor
public final class SidecarSupervisor {
    private nonisolated static let logger = Logger(subsystem: "com.biud.farol", category: "casca")

    private var machine: SidecarMachine
    private let services: SidecarServices
    private weak var ui: (any ShellUI)?

    private var exitTask: Task<Void, Never>?
    private var waitTask: Task<Void, Never>?
    private var pairTask: Task<Void, Never>?
    private var restartTask: Task<Void, Never>?
    private var eventsTask: Task<Void, Never>?
    private var eventSource: (any EventSource)?
    /// O token desta subida do motor, ou `nil` sem pareamento válido.
    private var token: String?
    private var lastAutostart: Bool?
    private var shuttingDown = false

    /// A versão anunciada no último `casca-saida`, quando houver.
    public private(set) var nextVersion: String?

    public init(services: SidecarServices, ui: any ShellUI, machine: SidecarMachine = SidecarMachine()) {
        self.services = services
        self.ui = ui
        self.machine = machine
    }

    public var phase: SidecarPhase { machine.phase }
    public var consecutiveFailures: Int { machine.consecutiveFailures }

    /// Abre a casca: começa a ouvir as saídas do motor e decide entre lançar e só mostrar.
    public func boot() async {
        let codes = services.engine.exitCodes
        exitTask = Task { [weak self] in
            for await code in codes {
                self?.engineExited(code: code)
            }
        }
        let file = services.readEngineFile()
        var alive = false
        if let file {
            alive = await services.isEngineAlive(file)
        }
        feed(.boot(existingEngine: file, engineAlive: alive))
    }

    /// O "Tentar de novo" do alerta de falha.
    public func retry() {
        feed(.restartNow)
    }

    /// O "Checar agora" da bandeja; sem motor nosso pareado não há o que pedir.
    public func checkNow() async {
        guard case .ready(let port) = machine.phase, let token else {
            Self.logger.notice("checar agora: sem motor pareado, nada a pedir")
            return
        }
        do {
            try await services.checkNow(port, token)
        } catch {
            Self.logger.warning("checar agora falhou: \(String(describing: error), privacy: .public)")
        }
    }

    /// Encerra: para de ouvir, cancela o que está pendente e para o motor (como visor, o
    /// motor não é nosso e o `stop()` não tem processo a parar).
    public func shutdown() async {
        shuttingDown = true
        exitTask?.cancel()
        exitTask = nil
        cancelPending()
        restartTask?.cancel()
        restartTask = nil
        await detachEvents()?.stop()
        await services.engine.stop()
    }

    // MARK: Máquina

    private func feed(_ input: SidecarInput) {
        guard !shuttingDown else { return }
        for effect in machine.on(input) {
            perform(effect)
        }
    }

    private func perform(_ effect: SidecarEffect) {
        switch effect {
        case .spawn:
            spawn()
        case .waitFile:
            waitForFile()
        case .pair(let code, let port):
            pair(code: code, port: port)
        case .openWindow(let port, let viewer):
            openWindow(port: port, viewer: viewer)
        case .showViewerNotice:
            ui?.showViewerNotice()
        case .restart(let seconds):
            scheduleRestart(after: seconds)
        case .showFailure(let message):
            Self.logger.error("motor parado: \(message, privacy: .public)")
            ui?.showFailure(message)
        }
    }

    private func engineExited(code: Int32) {
        guard !shuttingDown else { return }
        Self.logger.notice("motor saiu com código \(code, privacy: .public)")
        cancelPending()
        if let source = detachEvents() {
            Task { await source.stop() }
        }
        if code == RestartPolicy.intentionalExit, let version = services.consumeSilentReopen() {
            ui?.post(Self.updatedNotice(version: version))
        }
        feed(.exited(code: code))
    }

    /// O aviso de que o Farol acabou de atualizar.
    public static func updatedNotice(version: String) -> NativeNotice {
        NativeNotice(
            title: "Farol atualizado",
            body: "Agora na versão \(version). Segue monitorando na bandeja.",
            url: nil, pr: nil, silent: true)
    }

    // MARK: Efeitos

    private func spawn() {
        token = nil
        services.removeEngineFile()
        let engine = services.engine
        Task { [weak self] in
            do {
                try await engine.start()
            } catch {
                Self.logger.error("motor não subiu: \(String(describing: error), privacy: .public)")
                self?.engineExited(code: 1)
            }
        }
    }

    private func waitForFile() {
        waitTask?.cancel()
        let services = services
        waitTask = Task { [weak self] in
            do {
                let file = try await services.waitForEngineFile()
                self?.feed(.fileAppeared(file))
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                Self.logger.error("o motor não publicou o casca.json a tempo; parando e religando")
                await services.engine.stop()
                self?.engineExited(code: 1)
            }
        }
    }

    private func pair(code: String, port: Int) {
        pairTask?.cancel()
        let services = services
        pairTask = Task { [weak self] in
            let token = await Self.pairWithRetry(services: services, port: port, code: code)
            guard !Task.isCancelled, let self else { return }
            if let token {
                do {
                    try services.saveToken(token)
                } catch {
                    Self.logger.error(
                        "não gravei o token no Keychain: \(String(describing: error), privacy: .public)")
                }
                Self.logger.notice("pareamento com o motor concluído")
                self.token = token
                self.feed(.paired)
            } else {
                self.token = nil
                self.feed(.pairFailed)
            }
        }
    }

    /// O token, ou `nil`: recusa não tenta de novo; outra falha tenta mais uma vez após 1 s.
    private nonisolated static func pairWithRetry(
        services: SidecarServices, port: Int, code: String
    ) async -> String? {
        for attempt in 0..<2 {
            do {
                return try await services.pair(port, code)
            } catch PairingError.refused(let reason) {
                logger.error("o motor recusou o pareamento (\(reason, privacy: .public))")
                return nil
            } catch {
                logger.warning("pareamento falhou: \(String(describing: error), privacy: .public)")
                if attempt == 0 {
                    do { try await services.sleep(1) } catch { return nil }
                }
            }
        }
        return nil
    }

    private func openWindow(port: Int, viewer: Bool) {
        let token = viewer ? nil : self.token
        ui?.openWindow(port: port, token: token, viewer: viewer)
        guard let token else { return }
        let source = services.makeEventSource(port, token)
        let previous = eventSource
        eventSource = source
        eventsTask?.cancel()
        eventsTask = Task { [weak self] in
            await previous?.stop()
            await source.start()
            for await output in source.events {
                guard let self, !Task.isCancelled else { return }
                self.handle(output)
            }
        }
    }

    private func handle(_ output: EventStreamOutput) {
        switch output {
        case .event(.shell(let state)):
            ui?.apply(state)
            if lastAutostart != state.autostart {
                lastAutostart = state.autostart
                ui?.applyAutostart(state.autostart)
            }
        case .event(.notice(let notice)):
            ui?.post(notice)
        case .event(.exit(let exit)):
            // A saída com 75 vem logo depois; aqui só se guarda a versão anunciada.
            nextVersion = exit.nextVersion
            Self.logger.notice("o motor anunciou a saída (\(exit.reason, privacy: .public))")
        case .event(.other):
            break
        case .unauthorized:
            token = nil
            feed(.unauthorized(current: services.readEngineFile()))
        }
    }

    private func scheduleRestart(after seconds: Double) {
        restartTask?.cancel()
        let sleep = services.sleep
        restartTask = Task { [weak self] in
            do { try await sleep(seconds) } catch { return }
            guard !Task.isCancelled else { return }
            self?.feed(.restartNow)
        }
    }

    // MARK: Limpeza

    private func cancelPending() {
        waitTask?.cancel()
        waitTask = nil
        pairTask?.cancel()
        pairTask = nil
    }

    /// Solta o fluxo de eventos atual na hora (o próximo `.openWindow` nunca é parado por
    /// engano) e devolve quem precisa receber o `stop()`.
    private func detachEvents() -> (any EventSource)? {
        eventsTask?.cancel()
        eventsTask = nil
        defer { eventSource = nil }
        return eventSource
    }
}
