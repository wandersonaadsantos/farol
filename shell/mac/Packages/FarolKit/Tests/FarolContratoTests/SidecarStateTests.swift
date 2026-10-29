import Foundation
import Testing

@testable import FarolContrato

private func engineFile(port: Int = 47170, code: String = "K7QMZP2XWD") -> EngineFile {
    EngineFile(
        port: port,
        pid: 12345,
        version: "2.79.0",
        pairingCode: code,
        startedAt: Date(timeIntervalSince1970: 1_761_600_000),
        nextVersion: nil
    )
}

/// Leva uma máquina nova até `.ready(port)` pelo caminho normal.
private func readyMachine(port: Int = 47170, code: String = "K7QMZP2XWD") -> SidecarMachine {
    var machine = SidecarMachine()
    _ = machine.on(.boot(existingEngine: nil, engineAlive: false))
    _ = machine.on(.fileAppeared(engineFile(port: port, code: code)))
    _ = machine.on(.paired)
    return machine
}

@Test func startsInStartingWithNoFailures() {
    let machine = SidecarMachine()
    #expect(machine.phase == .starting)
    #expect(machine.consecutiveFailures == 0)
}

@Test func bootWithoutFileSpawnsAndWaits() {
    var machine = SidecarMachine()
    #expect(machine.on(.boot(existingEngine: nil, engineAlive: false)) == [.spawn, .waitFile])
    #expect(machine.phase == .waitingForFile)
}

@Test func bootWithLiveEngineOpensViewer() {
    var machine = SidecarMachine()
    let effects = machine.on(.boot(existingEngine: engineFile(port: 47180), engineAlive: true))
    #expect(effects == [.openWindow(port: 47180, viewer: true), .showViewerNotice])
    #expect(machine.phase == .viewer(port: 47180))
}

@Test func bootWithDeadEngineSpawnsAndWaits() {
    var machine = SidecarMachine()
    let effects = machine.on(.boot(existingEngine: engineFile(), engineAlive: false))
    #expect(effects == [.spawn, .waitFile])
    #expect(machine.phase == .waitingForFile)
}

@Test func fileAppearedPairsWithTheFileCode() {
    var machine = SidecarMachine()
    _ = machine.on(.boot(existingEngine: nil, engineAlive: false))
    let effects = machine.on(.fileAppeared(engineFile(port: 47175, code: "ABCDEFGHJK")))
    #expect(effects == [.pair(code: "ABCDEFGHJK", port: 47175)])
    #expect(machine.phase == .pairing)
}

@Test func pairedOpensTheWindow() {
    var machine = SidecarMachine()
    _ = machine.on(.boot(existingEngine: nil, engineAlive: false))
    _ = machine.on(.fileAppeared(engineFile(port: 47175)))
    #expect(machine.on(.paired) == [.openWindow(port: 47175, viewer: false)])
    #expect(machine.phase == .ready(port: 47175))
}

@Test func pairFailedOpensTheWindowAnyway() {
    var machine = SidecarMachine()
    _ = machine.on(.boot(existingEngine: nil, engineAlive: false))
    _ = machine.on(.fileAppeared(engineFile(port: 47175)))
    #expect(machine.on(.pairFailed) == [.openWindow(port: 47175, viewer: false)])
    #expect(machine.phase == .ready(port: 47175))
}

@Test func intentionalExitWhileReadyRestartsNow() {
    var machine = readyMachine()
    #expect(machine.on(.exited(code: 75)) == [.restart(after: 0)])
    #expect(machine.phase == .restarting(in: 0))
    #expect(machine.consecutiveFailures == 0)
}

@Test func restartNowAfterIntentionalExitSpawnsAgain() {
    var machine = readyMachine()
    _ = machine.on(.exited(code: 75))
    #expect(machine.on(.restartNow) == [.spawn, .waitFile])
    #expect(machine.phase == .waitingForFile)
}

@Test func cleanExitStopsTheMachine() {
    var machine = readyMachine()
    #expect(machine.on(.exited(code: 0)) == [.showFailure("encerrado")])
    #expect(machine.phase == .stopped(reason: "encerrado"))
    #expect(machine.consecutiveFailures == 0)
}

@Test func fiveFailuresInARowBackOffThenStop() {
    var machine = readyMachine()
    var delays: [Double] = []
    for _ in 1...4 {
        let effects = machine.on(.exited(code: 1))
        guard case .restart(let seconds) = effects.first, effects.count == 1 else {
            Issue.record("esperava um único .restart, veio \(effects)")
            return
        }
        delays.append(seconds)
        #expect(machine.phase == .restarting(in: seconds))
        #expect(machine.on(.restartNow) == [.spawn, .waitFile])
    }
    #expect(delays == [1, 2, 4, 8])
    let reason = "o motor não ficou de pé depois de 5 tentativas"
    #expect(machine.on(.exited(code: 1)) == [.showFailure(reason)])
    #expect(machine.phase == .stopped(reason: reason))
    #expect(machine.consecutiveFailures == 5)
}

@Test func restartNowAfterStopTriesAgain() {
    var machine = readyMachine()
    _ = machine.on(.exited(code: 0))
    #expect(machine.on(.restartNow) == [.spawn, .waitFile])
    #expect(machine.phase == .waitingForFile)
}

@Test func fileAppearedResetsTheFailureCounter() {
    var machine = readyMachine()
    for _ in 1...4 {
        _ = machine.on(.exited(code: 1))
        _ = machine.on(.restartNow)
    }
    #expect(machine.consecutiveFailures == 4)
    _ = machine.on(.fileAppeared(engineFile()))
    #expect(machine.consecutiveFailures == 0)
    #expect(machine.on(.exited(code: 1)) == [.restart(after: 1)])
    #expect(machine.phase == .restarting(in: 1))
}

@Test func unauthorizedRepairsOnceThenOpensTheWindow() {
    var machine = readyMachine(port: 47175, code: "PRIMEIRO01")
    let current = engineFile(port: 47175, code: "ATUAL00001")
    #expect(machine.on(.unauthorized(current: current)) == [.pair(code: "ATUAL00001", port: 47175)])
    #expect(machine.phase == .pairing)
    #expect(machine.on(.paired) == [.openWindow(port: 47175, viewer: false)])
    #expect(machine.on(.unauthorized(current: current)) == [.openWindow(port: 47175, viewer: false)])
    #expect(machine.phase == .ready(port: 47175))
}

@Test func unauthorizedWithoutFileOpensTheWindow() {
    var machine = readyMachine(port: 47175)
    #expect(machine.on(.unauthorized(current: nil)) == [.openWindow(port: 47175, viewer: false)])
    #expect(machine.phase == .ready(port: 47175))
}

@Test func unauthorizedRepairAllowedAgainAfterANewEngineRun() {
    var machine = readyMachine(port: 47175)
    _ = machine.on(.unauthorized(current: engineFile(port: 47175)))
    _ = machine.on(.paired)
    _ = machine.on(.exited(code: 75))
    _ = machine.on(.restartNow)
    _ = machine.on(.fileAppeared(engineFile(port: 47176)))
    _ = machine.on(.paired)
    let effects = machine.on(.unauthorized(current: engineFile(port: 47176, code: "NOVO000001")))
    #expect(effects == [.pair(code: "NOVO000001", port: 47176)])
}

@Test func exitedInViewerIsIgnored() {
    var machine = SidecarMachine()
    _ = machine.on(.boot(existingEngine: engineFile(), engineAlive: true))
    #expect(machine.on(.exited(code: 1)) == [])
    #expect(machine.on(.exited(code: 75)) == [])
    #expect(machine.phase == .viewer(port: 47170))
}

@Test func inputsThatMakeNoSenseAreIgnored() {
    var machine = SidecarMachine()
    #expect(machine.on(.paired) == [])
    #expect(machine.on(.pairFailed) == [])
    #expect(machine.on(.restartNow) == [])
    #expect(machine.on(.unauthorized(current: engineFile())) == [])
    #expect(machine.on(.fileAppeared(engineFile())) == [])
    #expect(machine.phase == .starting)

    var ready = readyMachine()
    #expect(ready.on(.boot(existingEngine: nil, engineAlive: false)) == [])
    #expect(ready.on(.restartNow) == [])
    #expect(ready.on(.paired) == [])
    #expect(ready.phase == .ready(port: 47170))
}
