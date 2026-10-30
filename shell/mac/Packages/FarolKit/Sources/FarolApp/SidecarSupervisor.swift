import FarolContrato
import FarolSidecar
import Foundation
import os

/// Dirige a `SidecarMachine`: executa cada efeito e devolve cada resultado como entrada.
///
/// - `.stopEngine` para o nosso motor (o 401 da `ui/`); o `.spawn` seguinte espera a parada.
/// - `.spawn` sobe o motor; antes, apaga o `casca.json` velho quando o pid dele não está
///   vivo ou quando o boot já viu que não é Farol (o motor morto por sinal não apaga o dele, e a espera leria o código já gasto; o
///   de um processo vivo não é nosso para apagar). Falha ao subir conta como saída 1.
/// - `.waitFile` espera a subida e então o arquivo; prazo estourado com o processo vivo é
///   motor que não publicou: o supervisor o para e entrega `.exited(code: 1)`, para o recuo
///   valer. Com o arquivo, começa a janela de estabilidade: passados
///   `SidecarServices.stabilityWindow` segundos sem saída do motor, entrega `.stable`.
/// - `.pair` troca o código pelo token; recusa vira `.pairFailed` direto, outra falha tenta
///   de novo uma vez depois de 1 s.
/// - `.openWindow` abre a janela com o token atual (o do pareamento, ou, como visor, o do
///   Keychain) e, com token, um `EventStream` novo (o token é fixo por fluxo).
/// - `.restart(after:)` dorme e entrega `.restartNow`.
///
/// No boot, um `casca.json` cujo pid está vivo é sondado até `probeAttempts` vezes antes da
/// decisão; sem resposta, não é Farol: a casca sobe o próprio motor e essa primeira subida
/// apaga o arquivo velho mesmo com o pid vivo (senão um pid reaproveitado depois de uma
/// queda de energia prenderia o app num visor de porta morta). A espera do arquivo recebe a
/// `SpawnMark` da subida e não aceita o arquivo que já estava lá.
///
/// Saída `75` (update do motor) consome também o marcador de reabertura silenciosa e posta o
/// "Farol atualizado": a casca não reinicia, só o motor, e um marcador esquecido faria a
/// próxima abertura manual, dentro de 10 minutos, subir sem janela.
///
/// Depois de `shutdown()` nada mais é entregue à máquina: a tarefa que lê os códigos de saída
/// é cancelada antes do `stop()` do motor, e o `stop()` só vem depois da subida pendente.
@MainActor
public final class SidecarSupervisor {
    private nonisolated static let logger = Logger(subsystem: "com.biud.farol", category: "casca")
    /// Quantas vezes o boot sonda a porta de um `casca.json` cujo pid está vivo.
    nonisolated static let probeAttempts = 3

    private var machine: SidecarMachine
    private let services: SidecarServices
    private weak var ui: (any ShellUI)?

    private var exitTask: Task<Void, Never>?
    private var waitTask: Task<Void, Never>?
    private var pairTask: Task<Void, Never>?
    private var restartTask: Task<Void, Never>?
    private var stableTask: Task<Void, Never>?
    /// A parada pedida por `.stopEngine`; o próximo `.spawn` espera por ela.
    private var stopTask: Task<Void, Never>?
    /// A subida em andamento, que devolve a marca dela (ou `nil` quando não subiu); a espera
    /// do arquivo e o `shutdown()` esperam por ela.
    private var spawnTask: Task<SpawnMark?, Never>?
    private var eventsTask: Task<Void, Never>?
    private var eventSource: (any EventSource)?
    /// O token da janela: o do pareamento desta subida, o do Keychain como visor, ou `nil`.
    private var token: String?
    private var lastAutostart: Bool?
    /// O boot sondou o `casca.json` e ele não é de um Farol: a próxima subida o apaga sem
    /// olhar o pid.
    private var removeFileOnNextSpawn = false
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
        if let file, services.isProcessAlive(file.pid) {
            alive = await engineAnswers(port: file.port)
            if !alive {
                // Sondado e não é Farol: o arquivo é velho (o pid foi reaproveitado), e a
                // primeira subida o apaga mesmo com o pid vivo.
                Self.logger.warning(
                    "o processo do casca.json está vivo, mas a porta não respondeu como Farol; subindo outro motor"
                )
                removeFileOnNextSpawn = true
            }
        }
        if alive {
            // O motor não é nosso e não há código para gastar: o visor usa o token guardado.
            token = services.loadToken()
        }
        feed(.boot(existingEngine: file, engineAlive: alive))
    }

    /// Sonda a porta até `probeAttempts` vezes, com `probeRetryInterval` entre as sondas.
    private func engineAnswers(port: Int) async -> Bool {
        for attempt in 1...Self.probeAttempts {
            if await services.isFarol(port) { return true }
            if attempt < Self.probeAttempts {
                try? await Task.sleep(for: .seconds(services.probeRetryInterval))
            }
        }
        return false
    }

    /// O "Tentar de novo" do alerta de falha.
    public func retry() {
        feed(.restartNow)
    }

    /// O "Checar agora" da bandeja: com o nosso motor pareado ou, como visor, com o token
    /// guardado; sem token não há o que pedir.
    public func checkNow() async {
        let port: Int?
        switch machine.phase {
        case .ready(let current), .viewer(let current): port = current
        default: port = nil
        }
        guard let port, let token else {
            Self.logger.notice("checar agora: sem motor pareado, nada a pedir")
            return
        }
        do {
            try await services.checkNow(port, token)
        } catch {
            Self.logger.warning("checar agora falhou: \(String(describing: error), privacy: .public)")
        }
    }

    /// Encerra: para de ouvir, cancela o que está pendente, espera a subida em andamento e
    /// para o motor (como visor, o motor não é nosso e o `stop()` não tem processo a parar).
    /// Sem esperar a subida, o `stop()` chegaria antes do processo existir e o motor ficaria
    /// órfão depois que o app saísse.
    public func shutdown() async {
        shuttingDown = true
        exitTask?.cancel()
        exitTask = nil
        cancelPending()
        restartTask?.cancel()
        restartTask = nil
        await detachEvents()?.stop()
        await spawnTask?.value
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
        case .stopEngine:
            stopEngine()
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

    private func stopEngine() {
        Self.logger.notice("a ui/ recusou o token; parando o motor para parear com um código novo")
        cancelPending()
        if let source = detachEvents() {
            Task { await source.stop() }
        }
        token = nil
        let engine = services.engine
        let pendingSpawn = spawnTask
        stopTask = Task {
            await pendingSpawn?.value
            await engine.stop()
        }
    }

    private func spawn() {
        token = nil
        let services = services
        let pendingStop = stopTask
        stopTask = nil
        let removeAlways = removeFileOnNextSpawn
        removeFileOnNextSpawn = false
        spawnTask = Task { [weak self] in
            await pendingStop?.value
            let previous = Self.removeStaleEngineFile(services: services, evenIfAlive: removeAlways)
            let mark = SpawnMark(previousPid: previous?.pid, spawnedAt: Date())
            do {
                try await services.engine.start()
                return mark
            } catch {
                Self.logger.error("motor não subiu: \(String(describing: error), privacy: .public)")
                self?.engineExited(code: 1)
                return nil
            }
        }
    }

    /// Apaga o `casca.json` de um processo que não existe mais; o de um processo vivo fica,
    /// salvo com `evenIfAlive` (o boot já sondou e viu que não é Farol). Devolve o arquivo que
    /// havia antes, para a marca da subida.
    private nonisolated static func removeStaleEngineFile(
        services: SidecarServices, evenIfAlive: Bool
    ) -> EngineFile? {
        let file = services.readEngineFile()
        if let file, !evenIfAlive, services.isProcessAlive(file.pid) {
            logger.notice("o casca.json é de um processo vivo; mantido")
            return file
        }
        services.removeEngineFile()
        return file
    }

    private func waitForFile() {
        waitTask?.cancel()
        let services = services
        let pendingSpawn = spawnTask
        waitTask = Task { [weak self] in
            guard let mark = await pendingSpawn?.value, !Task.isCancelled else { return }
            do {
                let file = try await services.waitForEngineFile(mark)
                self?.engineFilePublished(file)
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

    private func engineFilePublished(_ file: EngineFile) {
        guard !shuttingDown else { return }
        feed(.fileAppeared(file))
        scheduleStable()
    }

    /// A janela de estabilidade: sem saída do motor até o fim dela, as falhas zeram.
    private func scheduleStable() {
        stableTask?.cancel()
        let window = services.stabilityWindow
        stableTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(window)) } catch { return }
            guard !Task.isCancelled else { return }
            self?.feed(.stable)
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
        let token = self.token
        ui?.openWindow(port: port, token: token, viewer: viewer)
        guard let token else { return }
        let source = services.makeEventSource(port, token)
        let previous = eventSource
        eventSource = source
        eventsTask?.cancel()
        eventsTask = Task { [weak self] in
            await previous?.stop()
            // Cancelada antes ou durante a subida (o motor saiu): a fonte nova não fica de pé.
            guard !Task.isCancelled else { return await source.stop() }
            await source.start()
            guard !Task.isCancelled else { return await source.stop() }
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
            if let source = detachEvents() {
                Task { await source.stop() }
            }
            feed(.unauthorized)
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
        stableTask?.cancel()
        stableTask = nil
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
