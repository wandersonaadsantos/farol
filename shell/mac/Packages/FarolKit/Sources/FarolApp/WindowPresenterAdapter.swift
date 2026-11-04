import AppKit

/// A janela vista pelo clique de um aviso: a `MainWindow` atual, trocada a cada pareamento.
///
/// É o dono da `MainWindow` (o AppDelegate guarda o adaptador). Nada aponta de volta para
/// cá: nem a janela nem a página conhecem o `Notifier` ou o despachante, então não há ciclo.
@MainActor
public final class WindowPresenterAdapter: WindowPresenter {
    public var mainWindow: MainWindow?

    public init() {}

    public var isVisible: Bool { mainWindow?.isVisible ?? false }

    /// Sem janela ainda (o motor não subiu), não há o que mostrar.
    public func show() { mainWindow?.show() }

    public func navigate(to path: String) { mainWindow?.webViewController.navigate(to: path) }

    public func openExternal(_ url: URL) { NSWorkspace.shared.open(url) }
}
