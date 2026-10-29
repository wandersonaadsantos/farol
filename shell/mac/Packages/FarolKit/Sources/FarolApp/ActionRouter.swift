import FarolContrato
import Foundation

/// O que o clique num aviso nativo faz.
public enum NoticeAction: Equatable, Sendable {
    /// Abre o endereço no navegador padrão.
    case openURL(URL)
    /// Mostra a janela e abre a caixa de revisão do PR (`owner/repo#N`).
    case focusPR(String)
    /// Só mostra a janela.
    case focusWindow
}

/// Decide, sem efeito colateral, o que o clique num aviso nativo faz.
public struct ActionRouter: Sendable {
    public init() {}

    /// `url` vence (mesmo com `pr`); só `pr` foca o PR; sem nenhum dos dois, foca a janela.
    public func action(for notice: NativeNotice) -> NoticeAction {
        if let url = notice.url { return .openURL(url) }
        if let pr = notice.pr { return .focusPR(pr) }
        return .focusWindow
    }

    /// Caracteres que passam sem codificação (os não reservados da RFC 3986).
    private static let unreserved = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    /// A rota da `ui/` que abre a caixa de revisão do PR: `owner/repo#123` vira
    /// `/?pr=owner%2Frepo%23123`.
    public static func path(forPR pr: String) -> String {
        "/?pr=" + (pr.addingPercentEncoding(withAllowedCharacters: unreserved) ?? "")
    }
}

/// A janela do Farol vista pelo clique de um aviso (injetável nos testes).
@MainActor
public protocol WindowPresenter: AnyObject {
    var isVisible: Bool { get }
    func show()
    func navigate(to path: String)
    func openExternal(_ url: URL)
}

/// Aplica a ação do roteador sobre a janela.
@MainActor
public final class NoticeDispatcher {
    private let presenter: any WindowPresenter
    private let router: ActionRouter

    public init(presenter: any WindowPresenter, router: ActionRouter = .init()) {
        self.presenter = presenter
        self.router = router
    }

    /// Executa o clique: o PR sempre reabre a janela antes de navegar, mesmo escondida.
    public func handle(_ notice: NativeNotice) {
        switch router.action(for: notice) {
        case .openURL(let url):
            presenter.openExternal(url)
        case .focusPR(let pr):
            presenter.show()
            presenter.navigate(to: ActionRouter.path(forPR: pr))
        case .focusWindow:
            presenter.show()
        }
    }
}
