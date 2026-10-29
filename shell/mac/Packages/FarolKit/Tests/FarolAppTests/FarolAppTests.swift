import Testing

@testable import FarolApp

@Test func moduleNameIsDeclared() {
    #expect(FarolApp.moduleName == "FarolApp")
}
