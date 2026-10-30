import AppKit

/// Entrada do app: ciclo de vida AppKit, para a casca controlar a criação da janela e a
/// reabertura pelo Dock. A instância única é do Launch Services (bundle id): a segunda
/// abertura chega ao app que já roda como `applicationShouldHandleReopen`.
@main
@MainActor
enum FarolMain {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) {
            app.run()
        }
    }
}
