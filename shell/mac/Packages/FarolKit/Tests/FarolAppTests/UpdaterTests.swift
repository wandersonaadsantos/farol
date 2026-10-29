import Testing

@testable import FarolApp

/// Verificador falso: conta as verificações e guarda o gate que o `Updater` instalou.
@MainActor
final class FakeUpdateChecker: UpdateChecker {
    var canCheckForUpdates = true
    var mayPerformCheck: (@MainActor () -> Bool)?
    private(set) var backgroundChecks = 0
    private(set) var userChecks = 0

    func checkForUpdatesInBackground() { backgroundChecks += 1 }

    func checkForUpdates() { userChecks += 1 }
}

@MainActor
@Suite struct UpdaterTests {
    @Test func idleEngineChecksInBackground() {
        let checker = FakeUpdateChecker()
        let updater = Updater(checker: checker)

        #expect(updater.checkInBackground())
        #expect(checker.backgroundChecks == 1)
    }

    @Test func busyEngineDoesNotCheck() {
        let checker = FakeUpdateChecker()
        let updater = Updater(checker: checker)
        updater.engineBusy = true

        #expect(!updater.checkInBackground())
        #expect(!updater.checkNow())
        #expect(checker.backgroundChecks == 0)
        #expect(checker.userChecks == 0)
    }

    @Test func idleEngineChecksOnUserRequest() {
        let checker = FakeUpdateChecker()
        let updater = Updater(checker: checker)

        #expect(updater.checkNow())
        #expect(checker.userChecks == 1)
    }

    @Test func checkerThatCannotCheckIsNotCalled() {
        let checker = FakeUpdateChecker()
        checker.canCheckForUpdates = false
        let updater = Updater(checker: checker)

        #expect(!updater.checkInBackground())
        #expect(checker.backgroundChecks == 0)
    }

    @Test func installedGateFollowsBusy() throws {
        let checker = FakeUpdateChecker()
        let updater = Updater(checker: checker)
        let gate = try #require(checker.mayPerformCheck)

        #expect(gate())
        updater.engineBusy = true
        #expect(!gate())
        updater.engineBusy = false
        #expect(gate())
    }

    @Test func scheduledCheckRefusedWhileBusyRunsOnceWhenIdle() throws {
        let checker = FakeUpdateChecker()
        let updater = Updater(checker: checker)
        let gate = try #require(checker.mayPerformCheck)
        updater.engineBusy = true

        #expect(!gate())
        updater.engineBusy = true
        #expect(checker.backgroundChecks == 0)
        updater.engineBusy = false
        #expect(checker.backgroundChecks == 1)
        updater.engineBusy = true
        updater.engineBusy = false
        #expect(checker.backgroundChecks == 1)
    }

    @Test func goingIdleWithoutRefusalDoesNotCheck() {
        let checker = FakeUpdateChecker()
        let updater = Updater(checker: checker)

        updater.engineBusy = true
        updater.engineBusy = false

        #expect(checker.backgroundChecks == 0)
    }
}
