import Foundation
import Testing

@testable import FarolSidecar

@Suite struct EngineLocatorTests {
    @Test func bundledPointsInsideResources() throws {
        let dir = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let app = dir.appendingPathComponent("Fake.app", isDirectory: true)
        let resources = app.appendingPathComponent("Contents/Resources", isDirectory: true)
        try FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true)
        let bundle = try #require(Bundle(url: app))
        let resolvedResources = try #require(bundle.resourceURL)

        let paths = EngineLocator.bundled(in: bundle)
        #expect(paths.node.standardizedFileURL.path.hasSuffix("Contents/Resources/engine/node/bin/node"))
        #expect(paths.serverJS.standardizedFileURL.path.hasSuffix("Contents/Resources/engine/app/server.js"))
        #expect(paths.node.path.hasPrefix(resolvedResources.path))
    }

    @Test func resolvePrefersDevelopmentEnvironmentWhenBothAreSet() {
        let paths = EngineLocator.resolve(
            environment: ["FAROL_NODE": "/opt/node/bin/node", "FAROL_SERVER_JS": "/src/farol/server.js"])
        #expect(paths.node.path == "/opt/node/bin/node")
        #expect(paths.serverJS.path == "/src/farol/server.js")
    }

    @Test func resolveFallsBackToBundleWhenOnlyOneIsSet() {
        let bundled = EngineLocator.bundled(in: .main)
        for environment in [["FAROL_NODE": "/opt/node"], ["FAROL_NODE": "/opt/node", "FAROL_SERVER_JS": ""]] {
            let paths = EngineLocator.resolve(environment: environment, bundle: .main)
            #expect(paths.node == bundled.node)
            #expect(paths.serverJS == bundled.serverJS)
        }
    }
}
