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

/// `node` falso que, na primeira subida, ignora o SIGTERM (o `stop()` precisa chegar ao
/// SIGKILL); nas seguintes, morre com o SIGTERM. Cada subida acrescenta o próprio pid em
/// `pids` antes do `exec`, e o sinal ignorado continua ignorado depois do `exec`.
private let stubbornNode = """
    if [ -f "$FAROL_HOME/pids" ]; then
      echo $$ >> "$FAROL_HOME/pids"
      exec sleep 60
    fi
    trap '' TERM
    echo $$ >> "$FAROL_HOME/pids"
    exec sleep 60

    """

/// `node` falso que lê a entrada padrão até o fim: com `/dev/null` sai na hora; com o pipe
/// retido pela casca fica esperando, como o motor que detecta o EOF quando o app morre.
private let stdinReadingNode = """
    if [ -p /dev/stdin ]; then echo pipe > "$FAROL_HOME/stdin.txt"; fi
    echo $$ > "$FAROL_HOME/pids"
    exec cat > /dev/null

    """

/// Tempo de CPU (usuário mais sistema) do processo de teste, em segundos.
private func processCPUSeconds() -> Double {
    var usage = rusage()
    getrusage(RUSAGE_SELF, &usage)
    let user = Double(usage.ru_utime.tv_sec) + Double(usage.ru_utime.tv_usec) / 1_000_000
    let system = Double(usage.ru_stime.tv_sec) + Double(usage.ru_stime.tv_usec) / 1_000_000
    return user + system
}

/// Os pids gravados pelo `stubbornNode`, esperando até haver `count` deles.
private func pids(in dir: URL, count: Int) async throws -> [Int32] {
    let url = dir.appendingPathComponent("pids")
    for _ in 0..<200 {
        let text = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        let values = text.split(separator: "\n").compactMap { Int32($0) }
        if values.count >= count { return values }
        try await Task.sleep(for: .milliseconds(25))
    }
    throw EngineFileError.timeout
}

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

    @Test func stopFromCancelledTaskStillTerminatesWithinBound() async throws {
        let dir = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let node = try writeScript(stubbornNode, named: "node", in: dir)
        let engine = EngineProcess(
            node: node, serverJS: dir.appendingPathComponent("server.js"), home: dir,
            shellVersion: "3.0.0")
        try await engine.start()
        let pid = try await pids(in: dir, count: 1)[0]

        let clock = ContinuousClock()
        let began = clock.now
        let cpuBefore = processCPUSeconds()
        let stopper = Task {
            try? await Task.sleep(for: .seconds(100))
            let cancelled = Task.isCancelled
            await engine.stop()
            return cancelled
        }
        stopper.cancel()
        #expect(await stopper.value)
        #expect(clock.now - began < .seconds(7))
        // Laço quente gastaria uns 5 s de CPU esperando o SIGKILL; esperar de verdade, quase nada.
        #expect(processCPUSeconds() - cpuBefore < 2)
        #expect(!EngineProbe.isProcessAlive(pid: pid))
    }

    @Test func startDuringPendingStopWaitsAndLeavesOneProcess() async throws {
        let dir = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let node = try writeScript(stubbornNode, named: "node", in: dir)
        let engine = EngineProcess(
            node: node, serverJS: dir.appendingPathComponent("server.js"), home: dir,
            shellVersion: "3.0.0")
        try await engine.start()
        let first = try await pids(in: dir, count: 1)[0]

        let stopping = Task { await engine.stop() }
        try await Task.sleep(for: .milliseconds(300))
        try await engine.start()
        #expect(!EngineProbe.isProcessAlive(pid: first))
        let second = try await pids(in: dir, count: 2)[1]
        #expect(EngineProbe.isProcessAlive(pid: second))

        await stopping.value
        #expect(EngineProbe.isProcessAlive(pid: second))
        await engine.stop()
        #expect(!EngineProbe.isProcessAlive(pid: second))
        #expect(await firstValue(of: engine.exitCodes, within: 0.5) == nil)
    }

    @Test func standardInputIsAPipeHeldOpenWhileTheEngineLives() async throws {
        let dir = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let node = try writeScript(stdinReadingNode, named: "node", in: dir)
        let engine = EngineProcess(
            node: node, serverJS: dir.appendingPathComponent("server.js"), home: dir,
            shellVersion: "3.0.0")

        try await engine.start()
        let pid = try await pids(in: dir, count: 1)[0]
        #expect(await firstValue(of: engine.exitCodes, within: 0.5) == nil)
        #expect(EngineProbe.isProcessAlive(pid: pid))
        let kind = try String(contentsOf: dir.appendingPathComponent("stdin.txt"), encoding: .utf8)
        #expect(kind == "pipe\n")

        await engine.stop()
        #expect(!EngineProbe.isProcessAlive(pid: pid))
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
