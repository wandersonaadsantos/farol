import AppKit
import FarolContrato
import os

/// O que os itens do menu da bandeja pedem a quem monta o app.
@MainActor
public protocol StatusItemActions: AnyObject {
    func openWindow()
    func checkNow()
    func quit()
}

/// O ícone do Farol na barra de menus, com o menu "Abrir", "Checar agora" e "Sair".
///
/// O controlador só repassa o clique às `actions` (guardadas fracas): quem fala com o motor
/// ou mexe na janela é o dono delas. Quem cria o controlador precisa guardá-lo com referência
/// forte enquanto a bandeja existir: os itens do menu apontam para ele por referência fraca.
@MainActor
public final class StatusItemController: NSObject {
    public let statusItem: NSStatusItem
    public let menu: NSMenu
    private weak var actions: (any StatusItemActions)?

    private static let logger = Logger(subsystem: "com.biud.farol", category: "bandeja")

    /// `iconURL` existe para os testes; o padrão é o `tray.png` dos recursos do pacote.
    public init(actions: any StatusItemActions, iconURL: URL? = StatusItemController.bundledIconURL()) {
        self.actions = actions
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        menu = NSMenu()
        super.init()
        menu.autoenablesItems = false
        menu.addItem(item("Abrir", #selector(openWindow)))
        menu.addItem(item("Checar agora", #selector(checkNow)))
        menu.addItem(.separator())
        menu.addItem(item("Sair", #selector(quit)))
        // Com menu atribuído, o clique esquerdo no ícone abre o menu (comportamento padrão).
        statusItem.menu = menu
        if let image = Self.image(from: iconURL) {
            statusItem.button?.image = image
        } else {
            // Sem imagem e sem título o item fica invisível e o menu, inalcançável.
            statusItem.button?.title = "Farol"
            Self.logger.warning("bandeja: ícone não encontrado, mostrando o nome no lugar")
        }
        statusItem.button?.toolTip = "Farol"
    }

    /// Os títulos do menu em ordem; o separador aparece como texto vazio.
    public var menuTitles: [String] { menu.items.map(\.title) }

    /// Atualiza o que muda com o estado do motor (hoje, a dica do ícone).
    public func apply(_ state: ShellState) {
        statusItem.button?.toolTip = Self.tooltip(for: state)
    }

    /// `Farol · <rótulo>` quando o motor manda rótulo; senão só `Farol`.
    public static func tooltip(for state: ShellState) -> String {
        state.badgeLabel.isEmpty ? "Farol" : "Farol \u{00B7} \(state.badgeLabel)"
    }

    /// Tira o ícone da barra de menus.
    public func remove() {
        NSStatusBar.system.removeStatusItem(statusItem)
    }

    /// O ícone vem de `assets/tray.png`, copiado sem mudança para os recursos do pacote (e não
    /// para um `Assets.xcassets` do alvo do app, que só compõe os módulos): assim o ícone mora
    /// junto do código que o usa.
    ///
    /// A busca é própria, e não o `Bundle.module` do SwiftPM, porque aquele acessor encerra o
    /// processo quando o pacote de recursos falta; aqui a falta vira `nil` e o nome no lugar.
    /// O app põe `FarolKit_FarolApp.bundle` em `Contents/Resources`; o `swift test`, ao lado do
    /// pacote de testes.
    public nonisolated static func bundledIconURL() -> URL? {
        let code = Bundle(for: StatusItemController.self)
        let places = [
            Bundle.main.resourceURL, Bundle.main.bundleURL, code.resourceURL,
            code.bundleURL.deletingLastPathComponent(),
        ]
        for place in places.compactMap({ $0 }) {
            let url = place.appendingPathComponent("FarolKit_FarolApp.bundle")
            if let bundle = Bundle(url: url), let icon = bundle.url(forResource: "tray", withExtension: "png")
            {
                return icon
            }
        }
        return nil
    }

    /// A imagem modelo da bandeja (o sistema a pinta conforme a barra de menus), ou `nil`
    /// quando não há arquivo ou ele não é imagem.
    public nonisolated static func image(from url: URL?) -> NSImage? {
        guard let url, let image = NSImage(contentsOf: url) else { return nil }
        image.size = NSSize(width: 16, height: 16)
        image.isTemplate = true
        return image
    }

    private func item(_ title: String, _ action: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        return item
    }

    @objc private func openWindow() { actions?.openWindow() }

    @objc private func checkNow() { actions?.checkNow() }

    @objc private func quit() { actions?.quit() }
}
