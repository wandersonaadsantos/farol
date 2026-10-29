import Testing

@testable import FarolSidecar

@Test func moduleNameIsDeclared() {
    #expect(FarolSidecar.moduleName == "FarolSidecar")
}
