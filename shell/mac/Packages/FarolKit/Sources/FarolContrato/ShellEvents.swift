import Foundation

/// Aviso pronto para a notificação do sistema (evento SSE `aviso-nativo`).
public struct NativeNotice: Equatable, Sendable {
    public let title: String
    public let body: String
    /// Para onde o clique leva, quando há.
    public let url: URL?
    /// Chave do PR (`owner/repo#N`), quando o aviso é de um PR.
    public let pr: String?
    /// Avisos silenciosos não tocam som.
    public let silent: Bool

    public init(title: String, body: String, url: URL?, pr: String?, silent: Bool) {
        self.title = title
        self.body = body
        self.url = url
        self.pr = pr
        self.silent = silent
    }
}

/// Cores do ícone da bandeja, como o motor as manda.
public struct ShellColors: Equatable, Sendable {
    public let bg: String
    public let symbol: String

    public init(bg: String, symbol: String) {
        self.bg = bg
        self.symbol = symbol
    }
}

/// Retrato do que a casca mostra fora da janela (evento SSE `casca`).
public struct ShellState: Equatable, Sendable {
    public let badgeCount: Int
    public let badgeLabel: String
    /// Há sessão de revisão rodando.
    public let busy: Bool
    /// Abrir junto com o sistema.
    public let autostart: Bool
    public let colors: ShellColors

    public init(badgeCount: Int, badgeLabel: String, busy: Bool, autostart: Bool, colors: ShellColors) {
        self.badgeCount = badgeCount
        self.badgeLabel = badgeLabel
        self.busy = busy
        self.autostart = autostart
        self.colors = colors
    }
}

/// O motor avisa que vai sair de propósito (evento SSE `casca-saida`).
public struct ExitNotice: Equatable, Sendable {
    /// `update` ou `reinicio`.
    public let reason: String
    /// Versão que sobe em seguida, quando é saída por update.
    public let nextVersion: String?

    public init(reason: String, nextVersion: String?) {
        self.reason = reason
        self.nextVersion = nextVersion
    }
}

/// Os eventos SSE que a casca lê; o resto vira `.other` sem decodificar o corpo.
public enum ShellEvent: Equatable, Sendable {
    case notice(NativeNotice)
    case shell(ShellState)
    case exit(ExitNotice)
    case other(name: String)

    /// Decodifica o corpo de um evento pelo nome.
    ///
    /// Nome desconhecido (inclusive `state`, `state-patch` e `ping`) vira `.other`; corpo
    /// inválido de um nome conhecido devolve `nil`, para quem chama descartar o evento.
    public static func decode(name: String, data: Data) -> ShellEvent? {
        let decoder = JSONDecoder()
        switch name {
        case "aviso-nativo":
            guard let wire = try? decoder.decode(NoticeWire.self, from: data) else { return nil }
            return .notice(
                NativeNotice(
                    title: wire.titulo,
                    body: wire.corpo,
                    url: wire.url.flatMap { URL(string: $0) },
                    pr: wire.pr,
                    silent: wire.silencioso
                )
            )
        case "casca":
            guard let wire = try? decoder.decode(ShellWire.self, from: data) else { return nil }
            return .shell(
                ShellState(
                    badgeCount: wire.badge.contador,
                    badgeLabel: wire.badge.rotulo,
                    busy: wire.ocupado,
                    autostart: wire.autostart,
                    colors: ShellColors(bg: wire.cores.bg, symbol: wire.cores.symbol)
                )
            )
        case "casca-saida":
            guard let wire = try? decoder.decode(ExitWire.self, from: data) else { return nil }
            return .exit(ExitNotice(reason: wire.motivo, nextVersion: wire.proximaVersao))
        default:
            return .other(name: name)
        }
    }
}

/// Corpo de `aviso-nativo` como o motor escreve.
private struct NoticeWire: Decodable {
    let titulo: String
    let corpo: String
    let url: String?
    let pr: String?
    let silencioso: Bool
}

/// Corpo de `casca` como o motor escreve.
private struct ShellWire: Decodable {
    struct Badge: Decodable {
        let contador: Int
        let rotulo: String
    }

    struct Colors: Decodable {
        let bg: String
        let symbol: String
    }

    let badge: Badge
    let ocupado: Bool
    let autostart: Bool
    let cores: Colors
}

/// Corpo de `casca-saida` como o motor escreve.
private struct ExitWire: Decodable {
    let motivo: String
    let proximaVersao: String?
}
