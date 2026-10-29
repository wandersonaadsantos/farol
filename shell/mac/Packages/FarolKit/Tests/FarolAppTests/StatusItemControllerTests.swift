import AppKit
import FarolContrato
import Testing

@testable import FarolApp

/// Ações falsas da bandeja: guardam o que o menu pediu.
@MainActor
final class FakeStatusItemActions: StatusItemActions {
    var calls: [String] = []

    func openWindow() { calls.append("openWindow") }
    func checkNow() { calls.append("checkNow") }
    func quit() { calls.append("quit") }
}

@MainActor
@Suite struct StatusItemControllerTests {
    private func state(label: String) -> ShellState {
        ShellState(
            badgeCount: label.isEmpty ? 0 : 2, badgeLabel: label, busy: false, autostart: false,
            colors: ShellColors(bg: "#f4f6f9", symbol: "#1c2536"))
    }

    @Test func tooltipWithLabelUsesTheMiddleDot() {
        let tooltip = StatusItemController.tooltip(for: state(label: "2 pendentes"))
        #expect(tooltip == "Farol \u{00B7} 2 pendentes")
    }

    @Test func tooltipWithoutLabelIsJustTheName() {
        #expect(StatusItemController.tooltip(for: state(label: "")) == "Farol")
    }

    @Test func menuHasTheFourEntriesInOrder() {
        let actions = FakeStatusItemActions()
        let controller = StatusItemController(actions: actions)
        defer { controller.remove() }

        #expect(controller.menuTitles == ["Abrir", "Checar agora", "", "Sair"])
        #expect(controller.menu.items[2].isSeparatorItem)
    }

    @Test func iconIsATemplateImage() throws {
        let actions = FakeStatusItemActions()
        let controller = StatusItemController(actions: actions)
        defer { controller.remove() }

        let image = try #require(controller.statusItem.button?.image)
        #expect(image.isTemplate)
    }

    @Test func menuItemsCallTheActions() {
        let actions = FakeStatusItemActions()
        let controller = StatusItemController(actions: actions)
        defer { controller.remove() }

        for index in [0, 1, 3] {
            let item = controller.menu.items[index]
            _ = NSApp.sendAction(item.action!, to: item.target, from: item)
        }

        #expect(actions.calls == ["openWindow", "checkNow", "quit"])
    }

    @Test func applySetsTheTooltip() {
        let actions = FakeStatusItemActions()
        let controller = StatusItemController(actions: actions)
        defer { controller.remove() }

        controller.apply(state(label: "3 pendentes"))
        #expect(controller.statusItem.button?.toolTip == "Farol \u{00B7} 3 pendentes")

        controller.apply(state(label: ""))
        #expect(controller.statusItem.button?.toolTip == "Farol")
    }
}
