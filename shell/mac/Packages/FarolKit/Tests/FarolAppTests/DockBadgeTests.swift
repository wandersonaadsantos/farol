import AppKit
import FarolContrato
import Testing

@testable import FarolApp

@MainActor
@Suite struct DockBadgeTests {
    private func state(count: Int) -> ShellState {
        ShellState(
            badgeCount: count, badgeLabel: count == 0 ? "" : "\(count) pendentes", busy: false,
            autostart: false, colors: ShellColors(bg: "#f4f6f9", symbol: "#1c2536"))
    }

    @Test func zeroHidesTheBadge() {
        #expect(DockBadge.badgeLabel(for: state(count: 0)) == "")
    }

    @Test func countBecomesTheBadgeText() {
        #expect(DockBadge.badgeLabel(for: state(count: 3)) == "3")
    }

    @Test func applyWritesTheLabelOnTheDockTile() {
        let tile = NSApplication.shared.dockTile

        DockBadge.apply(state(count: 7), to: tile)
        #expect(tile.badgeLabel == "7")

        DockBadge.apply(state(count: 0), to: tile)
        #expect((tile.badgeLabel ?? "").isEmpty)
    }
}
