import Foundation
import Testing

@testable import FarolContrato

private func file(pid: Int32, startedAt seconds: Double) -> EngineFile {
    EngineFile(
        port: 47190, pid: pid, version: "2.80.0", pairingCode: "C",
        startedAt: Date(timeIntervalSince1970: seconds),
        nextVersion: nil)
}

@Test func spawnMarkWithoutPreviousFileAcceptsAnyFile() {
    let mark = SpawnMark(previousPid: nil, spawnedAt: Date(timeIntervalSince1970: 100))
    #expect(mark.accepts(file(pid: 10, startedAt: 50)))
}

@Test func spawnMarkRejectsTheSameOldFile() {
    let mark = SpawnMark(previousPid: 10, spawnedAt: Date(timeIntervalSince1970: 100))
    #expect(!mark.accepts(file(pid: 10, startedAt: 50)))
    #expect(!mark.accepts(file(pid: 10, startedAt: 100)))
}

@Test func spawnMarkAcceptsAnotherPidOrALaterStart() {
    let mark = SpawnMark(previousPid: 10, spawnedAt: Date(timeIntervalSince1970: 100))
    #expect(mark.accepts(file(pid: 11, startedAt: 50)))
    #expect(mark.accepts(file(pid: 10, startedAt: 101)))
}
