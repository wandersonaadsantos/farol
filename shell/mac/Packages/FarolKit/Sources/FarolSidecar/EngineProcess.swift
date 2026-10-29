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
    ///
    /// Consumidor único (`AsyncStream`): itere numa tarefa de vida longa, porque cancelar a
    /// tarefa que itera encerra o fluxo para sempre.
    public nonisolated let exitCodes: AsyncStream<Int32>
    private let exitContinuation: AsyncStream<Int32>.Continuation

    private var process: Process?
    /// Conta as subidas, para o fim de uma subida antiga não ser confundido com a atual.
    private var generation = 0
    /// A subida cujo fim ainda não foi tratado por `didTerminate`; `nil` sem motor vivo.
    private var liveGeneration: Int?
    private var stoppingGeneration: Int?
    /// O desligamento em andamento. `start()` e outro `stop()` esperam por ele, então uma
    /// subida nova nunca cruza com o desligamento da anterior.
    private var stopTask: Task<Void, Never>?
    /// Quem espera o fim de uma subida, por identificador: a subida esperada e a continuação.
    private var terminationWaiters: [Int: (generation: Int, continuation: CheckedContinuation<Bool, Never>)] =
        [:]
    private var nextWaiterID = 0

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

    /// Sobe o motor. Com um desligamento em andamento, espera ele terminar antes; com um motor
    /// desta instância ainda vivo, não faz nada.
    public func start() async throws {
        while let stopTask {
            await stopTask.value
        }
        if liveGeneration != nil { return }

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
        liveGeneration = current
    }

    /// Desliga o motor: SIGTERM, até 5 s de espera e então SIGKILL. Sem motor rodando, não faz
    /// nada; chamar de novo, inclusive durante um desligamento, é seguro. Volta só depois de o
    /// processo ter terminado.
    ///
    /// O trabalho roda numa tarefa própria, que não herda o cancelamento de quem chama: a saída
    /// do app e o fim de um `.task` chamam `stop()` de tarefa já cancelada, e o motor precisa
    /// morrer do mesmo jeito.
    public func stop() async {
        if let stopTask {
            await stopTask.value
            return
        }
        guard let target = liveGeneration, let process else { return }
        stoppingGeneration = target
        let pid = process.processIdentifier
        let task = Task { await self.terminate(pid: pid, generation: target) }
        stopTask = task
        await task.value
    }

    private func terminate(pid: Int32, generation target: Int) async {
        kill(pid, SIGTERM)
        if await !waitForTermination(of: target, within: Self.stopGrace) {
            if liveGeneration == target {
                kill(pid, SIGKILL)
            }
            _ = await waitForTermination(of: target, within: nil)
        }
        stopTask = nil
    }

    /// Espera `didTerminate` tratar o fim da subida `target`, sem consulta repetida: a
    /// continuação é retomada pelo fim ou pelo prazo (`nil` espera sem prazo). Devolve se o
    /// processo terminou.
    private func waitForTermination(of target: Int, within limit: Duration?) async -> Bool {
        guard liveGeneration == target else { return true }
        let id = nextWaiterID
        nextWaiterID += 1
        if let limit {
            Task {
                try? await Task.sleep(for: limit)
                expireWaiter(id)
            }
        }
        return await withCheckedContinuation { continuation in
            terminationWaiters[id] = (target, continuation)
        }
    }

    private func expireWaiter(_ id: Int) {
        terminationWaiters.removeValue(forKey: id)?.continuation.resume(returning: false)
    }

    private func didTerminate(generation finished: Int, status: Int32, byExit: Bool) {
        if liveGeneration == finished {
            liveGeneration = nil
            process = nil
        }
        for (id, waiter) in terminationWaiters where waiter.generation == finished {
            terminationWaiters.removeValue(forKey: id)
            waiter.continuation.resume(returning: true)
        }
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
