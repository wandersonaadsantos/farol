import Testing

@testable import FarolContrato

@Test func intentionalExitRestartsImmediately() {
    let policy = RestartPolicy()
    #expect(RestartPolicy.intentionalExit == 75)
    #expect(policy.delay(afterExit: 75, consecutiveFailures: 0) == .immediately)
    #expect(policy.delay(afterExit: 75, consecutiveFailures: 3) == .immediately)
}

@Test func cleanExitStops() {
    let policy = RestartPolicy()
    #expect(policy.delay(afterExit: 0, consecutiveFailures: 0) == .stop(reason: "encerrado"))
}

@Test func failuresBackOffExponentiallyUntilTheDefaultMax() {
    let policy = RestartPolicy()
    #expect(RestartPolicy.maxConsecutiveFailures == 5)
    #expect(policy.maxConsecutiveFailures == 5)
    #expect(policy.delay(afterExit: 1, consecutiveFailures: 1) == .after(seconds: 1))
    #expect(policy.delay(afterExit: 1, consecutiveFailures: 2) == .after(seconds: 2))
    #expect(policy.delay(afterExit: 9, consecutiveFailures: 3) == .after(seconds: 4))
    #expect(policy.delay(afterExit: -1, consecutiveFailures: 4) == .after(seconds: 8))
    let stop = RestartDecision.stop(reason: "o motor não ficou de pé depois de 5 tentativas")
    #expect(policy.delay(afterExit: 1, consecutiveFailures: 5) == stop)
    #expect(policy.delay(afterExit: 1, consecutiveFailures: 6) == stop)
}

@Test func delayIsCappedAtThirtySeconds() {
    let policy = RestartPolicy(maxConsecutiveFailures: 10)
    #expect(policy.delay(afterExit: 1, consecutiveFailures: 5) == .after(seconds: 16))
    #expect(policy.delay(afterExit: 1, consecutiveFailures: 6) == .after(seconds: 30))
    #expect(policy.delay(afterExit: 1, consecutiveFailures: 7) == .after(seconds: 30))
    #expect(policy.delay(afterExit: 1, consecutiveFailures: 9) == .after(seconds: 30))
    #expect(
        policy.delay(afterExit: 1, consecutiveFailures: 10)
            == .stop(reason: "o motor não ficou de pé depois de 10 tentativas")
    )
}
