import Darwin
import Foundation
import os

/// Falhas ao subir o processo do motor.
public enum EngineProcessError: Error, Equatable, Sendable {
    /// O `Process` não conseguiu executar o `node` (caminho errado, sem permissão).
    case launchFailed(String)
}

/// O processo do motor (`node server.js`) como sidecar da casca.
///
/// Sobe o motor com o ambiente do app mais `FAROL_SHELL=mac`, `FAROL_SHELL_VERSION` e, quando
/// dado, `FAROL_HOME`, na pasta do `server.js`. A saída do motor não vai para a do app: cada
/// linha segue para o `os.Logger` em nível de depuração, e linha com cara de credencial é
/// omitida. O ambiente nunca é registrado.
public actor EngineProcess {
    private static let logger = Logger(subsystem: "com.biud.farol", category: "engine")
    private static let stopGrace: Duration = .seconds(5)
    private static let stopPoll: Duration = .milliseconds(50)

    private let node: URL
    private let serverJS: URL
    private let home: URL?
    private let shellVersion: String

    /// Um valor por fim de processo: o código de saída quando o motor sai por conta própria
    /// (`terminationReason == .exit`), ou `128 + sinal` quando um sinal o derrubou.
    ///
    /// O fim causado pelo próprio `stop()` não aparece aqui de jeito nenhum: o SIGTERM (ou
    /// SIGKILL) que a casca manda não é falha do motor, e contá-lo faria a política de religar
    /// tratar o desligamento pedido como queda. O `stop()` marca a subida antes de sinalizar,
    /// e o fim de uma subida marcada não é publicado.
    public nonisolated let exitCodes: AsyncStream<Int32>
    private let exitContinuation: AsyncStream<Int32>.Continuation

    private var process: Process?
    /// Conta as subidas, para o fim de uma subida antiga não ser confundido com a atual.
    private var generation = 0
    private var stoppingGeneration: Int?

    public init(node: URL, serverJS: URL, home: URL?, shellVersion: String) {
        self.node = node
        self.serverJS = serverJS
        self.home = home
        self.shellVersion = shellVersion
        (exitCodes, exitContinuation) = AsyncStream.makeStream(of: Int32.self)
    }

    deinit {
        exitContinuation.finish()
    }

    /// Sobe o motor. Com um motor desta instância ainda rodando, não faz nada.
    public func start() async throws {
        if let process, process.isRunning { return }

        generation += 1
        let current = generation
        let process = Process()
        process.executableURL = node
        process.arguments = [serverJS.path]
        process.currentDirectoryURL = serverJS.deletingLastPathComponent()

        var environment = ProcessInfo.processInfo.environment
        environment["FAROL_SHELL"] = "mac"
        environment["FAROL_SHELL_VERSION"] = shellVersion
        if let home {
            environment["FAROL_HOME"] = home.path
        }
        process.environment = environment

        process.standardInput = FileHandle.nullDevice
        process.standardOutput = Self.forwardingPipe()
        process.standardError = Self.forwardingPipe()

        process.terminationHandler = { [weak self] finished in
            let status = finished.terminationStatus
            let byExit = finished.terminationReason == .exit
            Task { await self?.didTerminate(generation: current, status: status, byExit: byExit) }
        }

        do {
            try process.run()
        } catch {
            throw EngineProcessError.launchFailed(error.localizedDescription)
        }
        self.process = process
    }

    /// Desliga o motor: SIGTERM, até 5 s de espera e então SIGKILL. Sem motor rodando, não faz
    /// nada; chamar de novo é seguro. Volta só depois de o processo ter terminado.
    public func stop() async {
        guard let process, process.isRunning else { return }
        stoppingGeneration = generation
        let pid = process.processIdentifier

        kill(pid, SIGTERM)
        if await waitForTermination(within: Self.stopGrace) { return }
        kill(pid, SIGKILL)
        _ = await waitForTermination(within: nil)
    }

    /// Espera o fim da subida atual ser tratado (`didTerminate` zera `process`). `nil` espera
    /// sem prazo. A espera é por consulta curta: o ator fica livre entre uma e outra.
    private func waitForTermination(within limit: Duration?) async -> Bool {
        let clock = ContinuousClock()
        let deadline = limit.map { clock.now.advanced(by: $0) }
        while process != nil {
            if let deadline, clock.now >= deadline { return false }
            try? await Task.sleep(for: Self.stopPoll)
        }
        return true
    }

    private func didTerminate(generation finished: Int, status: Int32, byExit: Bool) {
        guard finished == generation else { return }
        process = nil
        if stoppingGeneration == finished {
            stoppingGeneration = nil
            return
        }
        exitContinuation.yield(byExit ? status : 128 + status)
    }

    /// Um pipe cuja saída vira linhas de depuração no `Logger`, nunca na saída do app.
    private static func forwardingPipe() -> Pipe {
        let pipe = Pipe()
        pipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty else {
                handle.readabilityHandler = nil
                return
            }
            for line in String(decoding: data, as: UTF8.self).split(whereSeparator: \.isNewline) {
                log(line: String(line))
            }
        }
        return pipe
    }

    /// Registra uma linha do motor, omitindo a que menciona token ou Bearer: o motor não
    /// deveria imprimir credencial, mas a casca não aposta nisso.
    private static func log(line: String) {
        let lowered = line.lowercased()
        if lowered.contains("token") || lowered.contains("bearer") {
            logger.debug("linha do motor omitida (pode conter credencial)")
        } else {
            logger.debug("\(line, privacy: .private)")
        }
    }
}
