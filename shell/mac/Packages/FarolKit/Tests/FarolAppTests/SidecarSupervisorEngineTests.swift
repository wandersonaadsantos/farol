import FarolContrato
import FarolSidecar
import Foundation
import Testing

@testable import FarolApp

/// `node` falso que imita a saída por update: conta a subida, grava o `casca.json` com o
/// próprio pid e a hora de agora depois de 1 s e sai com `75` depois de mais 1 s.
private let updatingNode = """
    echo $$ >> "$FAROL_HOME/spawns"
    sleep 1
    mkdir -p "$FAROL_HOME/state"
    printf '{"porta":47199,"pid":%s,"versao":"9.9.9","codigoPareamento":"C%s",\
    "iniciadoEm":%s000,"proximaVersao":"9.9.10"}' "$$" "$$" "$(date +%s)" > "$FAROL_HOME/state/casca.tmp"
    mv "$FAROL_HOME/state/casca.tmp" "$FAROL_HOME/state/casca.json"
    sleep 1
    exit 75

    """

@MainActor
@Suite struct SidecarSupervisorEngineTests {
    @Test func realEngineExitingWith75IsSpawnedAgainWithoutBackoff() async throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("farol-supervisor-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let node = dir.appendingPathComponent("node")
        try ("#!/bin/sh\n" + updatingNode).write(to: node, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: node.path)
        let serverJS = dir.appendingPathComponent("server.js")

        let paths = ShellPaths(environment: ["FAROL_HOME": dir.path])
        var services = SidecarServices.live(
            paths: paths,
            environment: ["FAROL_NODE": node.path, "FAROL_SERVER_JS": serverJS.path],
            shellVersion: "3.0.0")
        let recorder = Recorder()
        services.pair = { _, code in "token-\(code)" }
        services.saveToken = { recorder.saved($0) }
        services.makeEventSource = { _, token in
            let source = FakeEventSource(token: token)
            recorder.add(source)
            return source
        }
        let ui = FakeShellUI()
        let supervisor = SidecarSupervisor(services: services, ui: ui)

        await supervisor.boot()
        let deadline = ContinuousClock.now + .seconds(8)
        while ContinuousClock.now < deadline && spawnCount(in: dir) < 2 {
            try await Task.sleep(for: .milliseconds(20))
        }
        let spawns = spawnCount(in: dir)
        let windows = ui.windows
        await supervisor.shutdown()

        #expect(spawns >= 2)
        #expect(windows.first?.port == 47199)
        #expect(windows.first?.viewer == false)
        #expect(windows.first?.token?.hasPrefix("token-C") == true)
        #expect(supervisor.consecutiveFailures == 0)
        #expect(ui.failures.isEmpty)
    }

    private func spawnCount(in dir: URL) -> Int {
        let text = (try? String(contentsOf: dir.appendingPathComponent("spawns"), encoding: .utf8)) ?? ""
        return text.split(separator: "\n").count
    }
}
