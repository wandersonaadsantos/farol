import AppKit
import FarolContrato
import WebKit

/// O que fazer com uma navegação pedida pela página.
public enum NavigationPolicy: Equatable, Sendable {
    /// Fica na janela: é a origem do motor (ou `about:`).
    case allow
    /// Abre no navegador padrão e cancela na janela.
    case openExternally
    /// Cancela sem abrir nada (esquema que não é web, como `file:` ou `javascript:`).
    case deny
}

/// O `WKWebView` que mostra a `ui/` do motor, com o token injetado antes da página.
///
/// Paridade com o Electron: link com `target=_blank` e navegação para fora da origem do
/// motor (`127.0.0.1` ou `localhost` na porta dele) abrem no navegador padrão.
@MainActor
public final class WebViewController: NSObject, WKNavigationDelegate, WKUIDelegate {
    public let port: Int
    public let webView: WKWebView

    /// Aparência que a barra de título deve usar, derivada do fundo do último `apply`.
    public private(set) var appearanceName: NSAppearance.Name?
    /// Cor dos símbolos da barra vinda do motor (guardada para a barra de título).
    public private(set) var symbolColor: NSColor?

    public init(port: Int, token: String?) {
        self.port = port
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = TokenInjection.userContentController(token: token)
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
    }

    /// O endereço do motor para um caminho que começa com `/`.
    func url(for path: String) -> URL? {
        URL(string: "http://127.0.0.1:\(port)\(path)")
    }

    /// Carrega um caminho da `ui/` (por exemplo `/?pr=owner%2Frepo%23N`).
    public func navigate(to path: String) {
        guard let url = url(for: path) else { return }
        webView.load(URLRequest(url: url))
    }

    /// Pinta o fundo da página com a cor do motor e guarda a aparência da barra.
    public func apply(_ state: ShellState) {
        if let bg = Self.color(fromHex: state.colors.bg) {
            webView.underPageBackgroundColor = bg
            appearanceName = Self.appearanceName(forHex: state.colors.bg)
        }
        if let symbol = Self.color(fromHex: state.colors.symbol) {
            symbolColor = symbol
        }
    }

    // MARK: Regras puras

    /// Decide o destino de uma navegação; pura para ser testada sem janela.
    public static func policy(for url: URL, port: Int) -> NavigationPolicy {
        guard let scheme = url.scheme?.lowercased() else { return .deny }
        switch scheme {
        case "about":
            return .allow
        case "http":
            let host = url.host?.lowercased()
            if (host == "127.0.0.1" || host == "localhost") && url.port == port {
                return .allow
            }
            return .openExternally
        case "https", "mailto":
            return .openExternally
        default:
            return .deny
        }
    }

    /// Lê `#rrggbb` em sRGB; qualquer outro formato devolve `nil`.
    public static func color(fromHex hex: String) -> NSColor? {
        guard hex.count == 7, hex.hasPrefix("#") else { return nil }
        let digits = hex.dropFirst()
        guard digits.allSatisfy(\.isHexDigit), let value = UInt32(digits, radix: 16) else { return nil }
        return NSColor(
            srgbRed: CGFloat((value >> 16) & 0xff) / 255,
            green: CGFloat((value >> 8) & 0xff) / 255,
            blue: CGFloat(value & 0xff) / 255,
            alpha: 1)
    }

    /// Fundo escuro pede `.darkAqua`, claro pede `.aqua` (luminância relativa).
    public static func appearanceName(forHex hex: String) -> NSAppearance.Name? {
        guard let color = color(fromHex: hex) else { return nil }
        let luminance =
            0.2126 * color.redComponent + 0.7152 * color.greenComponent + 0.0722 * color.blueComponent
        return luminance < 0.5 ? .darkAqua : .aqua
    }

    // MARK: WKNavigationDelegate

    public func webView(
        _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        switch Self.policy(for: url, port: port) {
        case .allow:
            decisionHandler(.allow)
        case .openExternally:
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        case .deny:
            decisionHandler(.cancel)
        }
    }

    // MARK: WKUIDelegate

    /// `target=_blank` e `window.open` nunca abrem janela nova: vão ao navegador padrão,
    /// como o `setWindowOpenHandler` do Electron.
    public func webView(
        _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url, Self.policy(for: url, port: port) != .deny {
            NSWorkspace.shared.open(url)
        }
        return nil
    }
}
