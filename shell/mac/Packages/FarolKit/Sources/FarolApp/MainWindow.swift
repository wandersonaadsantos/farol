import AppKit
import FarolContrato

/// A janela principal do Farol, com a `ui/` do motor ocupando tudo.
///
/// Mesma geometria do Electron (1120x760, mínimo 880x560) e barra "hidden inset": título
/// escondido, barra transparente e conteúdo por baixo, com os botões de semáforo sobre a
/// barra de topo da `ui/`. Fechar só esconde; o app segue no Dock e na bandeja. Quem
/// reabre pelo Dock é o `applicationShouldHandleReopen` do AppDelegate (Task 8), que chama
/// `show()`.
@MainActor
public final class MainWindow: NSObject, NSWindowDelegate {
    public let window: NSWindow
    public let webViewController: WebViewController

    public init(webViewController: WebViewController) {
        self.webViewController = webViewController
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1120, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: true)
        super.init()
        window.title = "Farol"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.minSize = NSSize(width: 880, height: 560)
        window.isReleasedWhenClosed = false
        window.contentView = webViewController.webView
        window.delegate = self
        window.center()
    }

    public var isVisible: Bool { window.isVisible }

    /// Traz a janela para a frente e ativa o app.
    public func show() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    /// Mostra sem roubar o foco (reabertura silenciosa depois de update).
    public func showWithoutActivating() {
        window.orderFront(nil)
    }

    /// Aplica as cores do motor à janela e à página.
    public func apply(_ state: ShellState) {
        webViewController.apply(state)
        if let bg = WebViewController.color(fromHex: state.colors.bg) {
            window.backgroundColor = bg
        }
        if let name = webViewController.appearanceName {
            window.appearance = NSAppearance(named: name)
        }
    }

    /// Fechar esconde: o motor e a bandeja continuam vivos.
    public func windowShouldClose(_ sender: NSWindow) -> Bool {
        window.orderOut(nil)
        return false
    }
}
