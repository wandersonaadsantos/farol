import Foundation
import Testing

@testable import FarolContrato

@Suite struct LegacyCleanupTests {
    private func snapshot(
        agent: Bool = false, marker: Bool = false, running: Bool = false
    ) -> LegacySnapshot {
        LegacySnapshot(launchAgentExists: agent, launcherHasMarker: marker, launcherIsRunningApp: running)
    }

    @Test func nothingLeftBehindPlansNothing() {
        #expect(LegacyCleanup.plan(snapshot()).isEmpty)
    }

    @Test func launchAgentIsRemoved() {
        #expect(LegacyCleanup.plan(snapshot(agent: true)) == [.removeLaunchAgent])
    }

    @Test func electronLauncherWithMarkerIsRemoved() {
        #expect(LegacyCleanup.plan(snapshot(marker: true)) == [.removeElectronLauncher])
    }

    @Test func launcherWithoutMarkerIsKept() {
        #expect(LegacyCleanup.plan(snapshot(marker: false, running: false)).isEmpty)
    }

    @Test func runningAppIsNeverRemovedEvenWithMarker() {
        #expect(LegacyCleanup.plan(snapshot(marker: true, running: true)).isEmpty)
    }

    @Test func bothArtifactsAreRemovedAgentFirst() {
        #expect(
            LegacyCleanup.plan(snapshot(agent: true, marker: true))
                == [.removeLaunchAgent, .removeElectronLauncher])
    }

    @Test func pathsMatchWhatTheElectronEraWrote() {
        let home = URL(fileURLWithPath: "/Users/pessoa", isDirectory: true)
        #expect(LegacyCleanup.launchAgentLabel == "com.biud.farol.autostart")
        #expect(
            LegacyCleanup.launchAgent(home: home).path
                == "/Users/pessoa/Library/LaunchAgents/com.biud.farol.autostart.plist")
        #expect(LegacyCleanup.electronLauncher(home: home).path == "/Users/pessoa/Applications/Farol.app")
        #expect(
            LegacyCleanup.launcherMarker(home: home).path
                == "/Users/pessoa/Applications/Farol.app/Contents/Resources/app/bootstrap.cjs")
    }
}
