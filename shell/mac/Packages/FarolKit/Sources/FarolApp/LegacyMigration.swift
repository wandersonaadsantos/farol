import FarolContrato
import Foundation
import os

/// O IO da migração do Farol Electron: lê o disco, pede o plano ao `LegacyCleanup`, apaga.
///
/// Roda uma vez por abertura, em segundo plano. Achar nada é o caso comum e não loga; cada
/// item que não sai vira UMA linha de log, nunca alerta.
public struct LegacyMigration: Sendable {
    private static let logger = Logger(subsystem: "com.biud.farol", category: "migracao")

    private let home: URL
    private let runningBundle: URL
    private let bootout: @Sendable (String) throws -> Void
    private let log: @Sendable (String) -> Void

    /// - Parameters:
    ///   - home: o `$HOME` da pessoa (nos testes, uma pasta temporária).
    ///   - runningBundle: o `Bundle.main.bundleURL` do app que roda, que nunca é apagado.
    ///   - bootout: descarrega o LaunchAgent do rótulo dado; a falha é esperada (agente não
    ///     carregado) e só vai ao log de depuração.
    ///   - log: uma linha por item que não saiu.
    public init(
        home: URL,
        runningBundle: URL,
        bootout: @escaping @Sendable (String) throws -> Void = LegacyMigration.launchctlBootout,
        log: @escaping @Sendable (String) -> Void = {
            Logger(subsystem: "com.biud.farol", category: "migracao").warning("\($0, privacy: .public)")
        }
    ) {
        self.home = home
        self.runningBundle = runningBundle
        self.bootout = bootout
        self.log = log
    }

    /// Lê o disco, apaga o que o plano manda e loga o que falhar.
    public func run() {
        let fm = FileManager.default
        let launcher = LegacyCleanup.electronLauncher(home: home)
        let snapshot = LegacySnapshot(
            launchAgentExists: fm.fileExists(atPath: LegacyCleanup.launchAgent(home: home).path),
            launcherHasMarker: fm.fileExists(atPath: LegacyCleanup.launcherMarker(home: home).path),
            launcherIsRunningApp: Self.samePath(launcher, runningBundle))
        for action in LegacyCleanup.plan(snapshot) {
            switch action {
            case .removeLaunchAgent: removeLaunchAgent()
            case .removeElectronLauncher: remove(launcher, what: "o lançador do Farol Electron")
            }
        }
    }

    private func removeLaunchAgent() {
        do {
            try bootout(LegacyCleanup.launchAgentLabel)
        } catch {
            let reason = String(describing: error)
            Self.logger.debug("bootout do LaunchAgent antigo falhou (\(reason, privacy: .public))")
        }
        remove(LegacyCleanup.launchAgent(home: home), what: "o LaunchAgent do Farol Electron")
    }

    private func remove(_ url: URL, what: String) {
        do {
            try FileManager.default.removeItem(at: url)
        } catch {
            log("migração: não consegui apagar \(what) em \(url.path) (\(error.localizedDescription))")
        }
    }

    /// Mesmo caminho depois de resolver links, `..` e a barra final.
    static func samePath(_ a: URL, _ b: URL) -> Bool {
        func canonical(_ url: URL) -> String {
            let path = url.resolvingSymlinksInPath().standardizedFileURL.path
            return path.hasSuffix("/") ? String(path.dropLast()) : path
        }
        return canonical(a) == canonical(b)
    }

    /// `launchctl bootout gui/<uid>/<rótulo>`; saída diferente de zero vira erro.
    public static let launchctlBootout: @Sendable (String) throws -> Void = { label in
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = ["bootout", "gui/\(getuid())/\(label)"]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw BootoutError(status: process.terminationStatus) }
    }

    /// O `launchctl bootout` saiu com erro (o comum é o agente não estar carregado).
    public struct BootoutError: Error, CustomStringConvertible {
        public let status: Int32
        public var description: String { "launchctl saiu com \(status)" }
    }
}
