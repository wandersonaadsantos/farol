import Foundation
import Testing

@testable import FarolApp
@testable import FarolContrato

/// O que a migração fez: os rótulos passados ao `bootout` e as linhas de log de falha.
private final class MigrationRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var _bootouts: [String] = []
    private var _logs: [String] = []

    var bootouts: [String] { lock.withLock { _bootouts } }
    var logs: [String] { lock.withLock { _logs } }

    func bootout(_ label: String) { lock.withLock { _bootouts.append(label) } }
    func log(_ line: String) { lock.withLock { _logs.append(line) } }
}

private struct BootoutFailed: Error {}

@Suite struct LegacyMigrationTests {
    private let fm = FileManager.default

    /// Uma pasta temporária que faz as vezes de `$HOME`.
    private func makeHome() throws -> URL {
        let url = fm.temporaryDirectory
            .appendingPathComponent("farol-legado-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func write(_ url: URL, _ text: String = "x") throws {
        try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try text.write(to: url, atomically: true, encoding: .utf8)
    }

    private func plantLaunchAgent(_ home: URL) throws {
        try write(LegacyCleanup.launchAgent(home: home), "<plist/>")
    }

    private func plantElectronLauncher(_ home: URL) throws {
        try write(LegacyCleanup.launcherMarker(home: home), "require('x')")
        try write(LegacyCleanup.electronLauncher(home: home).appendingPathComponent("Contents/Info.plist"))
    }

    private func exists(_ url: URL) -> Bool { fm.fileExists(atPath: url.path) }

    private func migration(
        home: URL, running: URL? = nil, recorder: MigrationRecorder, bootoutFails: Bool = false
    ) -> LegacyMigration {
        LegacyMigration(
            home: home,
            runningBundle: running ?? URL(fileURLWithPath: "/Applications/Farol.app", isDirectory: true),
            bootout: { label in
                recorder.bootout(label)
                if bootoutFails { throw BootoutFailed() }
            },
            log: { recorder.log($0) })
    }

    @Test func removesTheLaunchAgentAfterBootout() throws {
        let home = try makeHome()
        defer { try? fm.removeItem(at: home) }
        try plantLaunchAgent(home)
        let recorder = MigrationRecorder()

        migration(home: home, recorder: recorder).run()

        #expect(!exists(LegacyCleanup.launchAgent(home: home)))
        #expect(recorder.bootouts == ["com.biud.farol.autostart"])
        #expect(recorder.logs.isEmpty)
    }

    @Test func bootoutFailureStillRemovesThePlistWithoutWarning() throws {
        let home = try makeHome()
        defer { try? fm.removeItem(at: home) }
        try plantLaunchAgent(home)
        let recorder = MigrationRecorder()

        migration(home: home, recorder: recorder, bootoutFails: true).run()

        #expect(!exists(LegacyCleanup.launchAgent(home: home)))
        #expect(recorder.logs.isEmpty)
    }

    @Test func removesTheElectronLauncherWithItsMarker() throws {
        let home = try makeHome()
        defer { try? fm.removeItem(at: home) }
        try plantElectronLauncher(home)
        let recorder = MigrationRecorder()

        migration(home: home, recorder: recorder).run()

        #expect(!exists(LegacyCleanup.electronLauncher(home: home)))
        #expect(exists(home.appendingPathComponent("Applications", isDirectory: true)))
        #expect(recorder.bootouts.isEmpty)
        #expect(recorder.logs.isEmpty)
    }

    @Test func keepsAFarolAppWithoutTheMarker() throws {
        let home = try makeHome()
        defer { try? fm.removeItem(at: home) }
        let info = LegacyCleanup.electronLauncher(home: home).appendingPathComponent("Contents/Info.plist")
        try write(info)
        let recorder = MigrationRecorder()

        migration(home: home, recorder: recorder).run()

        #expect(exists(info))
        #expect(recorder.logs.isEmpty)
    }

    @Test func neverRemovesTheRunningApp() throws {
        let home = try makeHome()
        defer { try? fm.removeItem(at: home) }
        try plantElectronLauncher(home)
        let recorder = MigrationRecorder()
        // O caminho que roda pode chegar sem a barra final e com `..`: a comparação é pelo
        // caminho resolvido.
        let running = home.appendingPathComponent("Applications/../Applications/Farol.app")

        migration(home: home, running: running, recorder: recorder).run()

        #expect(exists(LegacyCleanup.launcherMarker(home: home)))
        #expect(recorder.logs.isEmpty)
    }

    @Test func farolHomeIsNeverTouched() throws {
        let home = try makeHome()
        defer { try? fm.removeItem(at: home) }
        try plantLaunchAgent(home)
        try plantElectronLauncher(home)
        let config = home.appendingPathComponent(".farol/config.json")
        try write(config, #"{"autostart": true}"#)
        let recorder = MigrationRecorder()

        migration(home: home, recorder: recorder).run()

        #expect(try String(contentsOf: config, encoding: .utf8) == #"{"autostart": true}"#)
        #expect(exists(home.appendingPathComponent("Library/LaunchAgents", isDirectory: true)))
    }

    @Test func secondRunFindsNothingAndLogsNothing() throws {
        let home = try makeHome()
        defer { try? fm.removeItem(at: home) }
        try plantLaunchAgent(home)
        try plantElectronLauncher(home)
        let first = MigrationRecorder()
        migration(home: home, recorder: first).run()

        let second = MigrationRecorder()
        migration(home: home, recorder: second).run()

        #expect(second.bootouts.isEmpty)
        #expect(second.logs.isEmpty)
    }

    @Test func eachFailedRemovalIsOneLogLine() throws {
        let home = try makeHome()
        let agents = home.appendingPathComponent("Library/LaunchAgents", isDirectory: true)
        let apps = home.appendingPathComponent("Applications", isDirectory: true)
        defer {
            try? fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: agents.path)
            try? fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: apps.path)
            try? fm.removeItem(at: home)
        }
        try plantLaunchAgent(home)
        try plantElectronLauncher(home)
        // Sem escrita na pasta que contém cada item, nenhum dos dois sai.
        try fm.setAttributes([.posixPermissions: 0o555], ofItemAtPath: agents.path)
        try fm.setAttributes([.posixPermissions: 0o555], ofItemAtPath: apps.path)
        let recorder = MigrationRecorder()

        migration(home: home, recorder: recorder).run()

        #expect(exists(LegacyCleanup.launchAgent(home: home)))
        // O `removeItem` esvazia a pasta antes de falhar no topo dela; o `Farol.app` fica.
        #expect(exists(LegacyCleanup.electronLauncher(home: home)))
        #expect(recorder.logs.count == 2)
    }
}
