import WebKit

/// Grava o token da A4 no `localStorage` da página antes de qualquer script dela rodar.
///
/// A `ui/` lê o token em `localStorage['farol-auth-token']` na primeira linha do
/// bootstrap; injetar em `.atDocumentStart` faz a janela nascer autenticada, sem tela de
/// pareamento. Só o quadro principal recebe o token.
@MainActor
public enum TokenInjection {
    /// Chave que a `ui/transporte.js` lê.
    static let storageKey = "farol-auth-token"

    /// O script que grava o token, protegido por `try` para que um `localStorage`
    /// bloqueado não quebre a página.
    ///
    /// O escape do literal é defesa em profundidade: a `ui/transporte.js` só aceita token
    /// no formato `^[A-Za-z0-9_-]{43}$`, então um token legítimo nunca traz caractere a
    /// escapar. Mesmo assim, nada do que chega aqui consegue fechar o literal nem a tag.
    public static func script(token: String) -> WKUserScript {
        let source =
            "try { localStorage.setItem('\(storageKey)', '\(escapedLiteral(token))'); } catch (e) {}"
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    /// O controlador de conteúdo da janela: com o script quando há token, vazio sem ele.
    public static func userContentController(token: String?) -> WKUserContentController {
        let controller = WKUserContentController()
        if let token {
            controller.addUserScript(script(token: token))
        }
        return controller
    }

    /// Escapa o texto para dentro de um literal JS entre aspas simples.
    static func escapedLiteral(_ text: String) -> String {
        var out = ""
        for scalar in text.unicodeScalars {
            switch scalar {
            case "\\": out += "\\\\"
            case "'": out += "\\'"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\u{2028}": out += "\\u2028"
            case "\u{2029}": out += "\\u2029"
            case "<": out += "\\x3c"
            case "/": out += "\\/"
            default: out.unicodeScalars.append(scalar)
            }
        }
        return out
    }
}
