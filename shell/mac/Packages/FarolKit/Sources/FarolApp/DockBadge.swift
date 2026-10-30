import AppKit
import FarolContrato

/// O número de pendências no ícone do Dock.
public enum DockBadge {
    /// Zero vira texto vazio (o Dock esconde o selo); qualquer outro número vira o próprio número.
    public static func badgeLabel(for state: ShellState) -> String {
        state.badgeCount == 0 ? "" : "\(state.badgeCount)"
    }

    /// Escreve o selo no Dock.
    @MainActor
    public static func apply(_ state: ShellState, to dockTile: NSDockTile = NSApp.dockTile) {
        dockTile.badgeLabel = badgeLabel(for: state)
    }
}
