import AppKit
import Testing

@testable import FarolApp

@MainActor
@Suite struct MainMenuTests {
    @Test func quitAndEditShortcutsExist() {
        let items = MainMenu.make().items.flatMap { $0.submenu?.items ?? [] }
        let shortcuts = Set(items.map(\.keyEquivalent).filter { !$0.isEmpty })

        #expect(shortcuts.isSuperset(of: ["q", "c", "v", "x", "a", "z", "w"]))
        #expect(items.contains { $0.action == #selector(NSApplication.terminate(_:)) })
    }

    @Test func presenterWithoutWindowIsHiddenAndShowDoesNothing() {
        let presenter = WindowPresenterAdapter()

        presenter.show()
        presenter.navigate(to: "/")

        #expect(!presenter.isVisible)
    }
}
