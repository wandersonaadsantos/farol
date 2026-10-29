import FarolContrato
import Foundation
import Testing

@testable import FarolSidecar

/// O `node` falso: guarda o ambiente e o primeiro argumento, grava um `casca.json`
/// válido depois de 1 s (com o próprio pid) e dorme. O `exec` faz o `sleep` herdar o pid
/// do shell, então o SIGTERM do `stop()` não deixa processo órfão para trás.
private let fakeNode = """
    env > "$FAROL_HOME/env.txt"
    printf '%s' "$1" > "$FAROL_HOME/arg.txt"
    (
      sleep 1
      mkdir -p "$FAROL_HOME/state"
      printf '{"porta":47170,"pid":%s,"versao":"9.9.9","codigoPareamento":"ABCDEFGHIJ",\
    "iniciadoEm":1700000000000,"proximaVersao":null}' "$$" > "$FAROL_HOME/state/casca.tmp"
      mv "$FAROL_HOME/state/casca.tmp" "$FAROL_HOME/state/casca.json"
    ) &
    exec sleep 60

    """

@Suite struct EngineProcessTests {
    @Test func startPassesShellEnvironmentAndStopKillsWithoutYielding() async throws {
        let dir = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let node = try writeScript(fakeNode, named: "node", in: dir)
        let serverJS = dir.appendingPathComponent("app/server.js")
        try FileManager.default.createDirectory(
            at: serverJS.deletingLastPathComponent(), withIntermediateDirectories: true)
        let engine = EngineProcess(node: node, serverJS: serverJS, home: dir, shellVersion: "3.0.0")

        try await engine.start()
        let file = try await waitForEngineFile(
            at: dir.appendingPathComponent("state/casca.json"), timeout: 10)
        #expect(file.port == 47170)
        #expect(EngineProbe.isProcessAlive(pid: file.pid))

        let env = try String(contentsOf: dir.appendingPathComponent("env.txt"), encoding: .utf8)
        let lines = Set(env.split(separator: "\n").map(String.init))
        #expect(lines.contains("FAROL_SHELL=mac"))
        #expect(lines.contains("FAROL_SHELL_VERSION=3.0.0"))
        #expect(lines.contains("FAROL_HOME=\(dir.path)"))
        let arg = try String(contentsOf: dir.appendingPathComponent("arg.txt"), encoding: .utf8)
        #expect(arg == serverJS.path)

        await engine.stop()
        #expect(!EngineProbe.isProcessAlive(pid: file.pid))
        #expect(await firstValue(of: engine.exitCodes, within: 1) == nil)
        await engine.stop()
    }

    @Test func exitCodeOfTheProcessIsYielded() async throws {
        let dir = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let node = try writeScript("exit 3\n", named: "node", in: dir)
        let engine = EngineProcess(
            node: node, serverJS: dir.appendingPathComponent("server.js"), home: dir,
            shellVersion: "3.0.0")

        try await engine.start()
        #expect(await firstValue(of: engine.exitCodes, within: 5) == 3)
        await engine.stop()
    }

    @Test func signalNotSentByStopIsYieldedAsFailure() async throws {
        let dir = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let node = try writeScript("kill -KILL $$\n", named: "node", in: dir)
        let engine = EngineProcess(
            node: node, serverJS: dir.appendingPathComponent("server.js"), home: dir,
            shellVersion: "3.0.0")

        try await engine.start()
        #expect(await firstValue(of: engine.exitCodes, within: 5) == 128 + SIGKILL)
        await engine.stop()
    }

    @Test func waitForEngineFileTimesOutOnEmptyDirectory() async throws {
        let dir = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        await #expect(throws: EngineFileError.timeout) {
            try await waitForEngineFile(at: dir.appendingPathComponent("state/casca.json"), timeout: 0.5)
        }
    }

    @Test func waitForEngineFileSkipsHalfWrittenFile() async throws {
        let dir = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("casca.json")
        try Data("{\"porta\":".utf8).write(to: url)
        let writer = Task {
            try await Task.sleep(for: .milliseconds(300))
            let json = """
                {"porta":1,"pid":2,"versao":"1.0.0","codigoPareamento":"X","iniciadoEm":0}
                """
            try Data(json.utf8).write(to: url, options: .atomic)
        }
        let file = try await waitForEngineFile(at: url, timeout: 5, pollInterval: 0.05)
        #expect(file.port == 1)
        try await writer.value
    }
}
