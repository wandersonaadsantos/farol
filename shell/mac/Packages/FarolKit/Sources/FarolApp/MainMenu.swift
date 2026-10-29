import AppKit

/// O menu principal do app: sem ele, um app AppKit sem storyboard não tem ⌘Q nem os atalhos
/// de edição (copiar e colar na página, por exemplo).
@MainActor
public enum MainMenu {
    public static func make() -> NSMenu {
        let main = NSMenu()
        main.addItem(
            submenu(
                "Farol",
                [
                    // Vai pela cadeia de resposta até o AppDelegate, que segura o Updater.
                    NSMenuItem(
                        title: "Verificar atualizações…", action: Selector(("checkForUpdates:")),
                        keyEquivalent: ""),
                    .separator(),
                    NSMenuItem(
                        title: "Ocultar Farol", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"),
                    .separator(),
                    NSMenuItem(
                        title: "Sair do Farol", action: #selector(NSApplication.terminate(_:)),
                        keyEquivalent: "q"),
                ]))
        let redo = NSMenuItem(title: "Refazer", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        main.addItem(
            submenu(
                "Editar",
                [
                    NSMenuItem(title: "Desfazer", action: Selector(("undo:")), keyEquivalent: "z"),
                    redo,
                    .separator(),
                    NSMenuItem(title: "Recortar", action: #selector(NSText.cut(_:)), keyEquivalent: "x"),
                    NSMenuItem(title: "Copiar", action: #selector(NSText.copy(_:)), keyEquivalent: "c"),
                    NSMenuItem(title: "Colar", action: #selector(NSText.paste(_:)), keyEquivalent: "v"),
                    NSMenuItem(
                        title: "Selecionar tudo", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"),
                ]))
        main.addItem(
            submenu(
                "Janela",
                [
                    NSMenuItem(
                        title: "Minimizar", action: #selector(NSWindow.performMiniaturize(_:)),
                        keyEquivalent: "m"),
                    NSMenuItem(
                        title: "Fechar", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"),
                ]))
        return main
    }

    private static func submenu(_ title: String, _ items: [NSMenuItem]) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        let menu = NSMenu(title: title)
        items.forEach(menu.addItem)
        item.submenu = menu
        return item
    }
}
