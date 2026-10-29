import FarolContrato
import Foundation
import ServiceManagement
import os

/// O registro do app como item de login, atrás de um protocolo para os testes.
public protocol LoginItemService: Sendable {
    var isRegistered: Bool { get }
    func register() throws
    func unregister() throws
}

/// O item de login de verdade: o próprio app pelo `SMAppService.mainApp`.
public struct MainAppLoginItem: LoginItemService {
    public init() {}

    public var isRegistered: Bool { Self.isRegistered(status: SMAppService.mainApp.status) }

    /// Ligado ou aguardando aprovação em Ajustes do Sistema contam como registrado: registrar
    /// de novo enquanto a pessoa não aprova só repetiria a falha, e o item que aguarda
    /// aprovação também precisa ser removido quando o motor desliga o autostart.
    public static func isRegistered(status: SMAppService.Status) -> Bool {
        status == .enabled || status == .requiresApproval
    }

    public func register() throws { try SMAppService.mainApp.register() }

    public func unregister() throws { try SMAppService.mainApp.unregister() }
}

/// Abrir junto com o sistema, como o motor pede no evento `casca`.
///
/// Falha ao registrar ou remover vira uma linha de log, nunca alerta nem erro para quem
/// chama (o mesmo WARN do `applyAutostart` da casca Electron).
public struct Autostart: Sendable {
    private let service: any LoginItemService
    private let log: @Sendable (String) -> Void

    public init(
        service: any LoginItemService,
        log: @escaping @Sendable (String) -> Void = {
            Logger(subsystem: "com.biud.farol", category: "autostart").warning("\($0, privacy: .public)")
        }
    ) {
        self.service = service
        self.log = log
    }

    /// O que o motor quer.
    public static func desired(from state: ShellState) -> Bool {
        state.autostart
    }

    /// Registra quando quer e não está registrado, remove quando não quer e está; senão nada.
    public func apply(_ wanted: Bool) {
        let registered = service.isRegistered
        do {
            if wanted && !registered {
                try service.register()
            } else if !wanted && registered {
                try service.unregister()
            }
        } catch {
            let action = wanted ? "registrar" : "remover"
            log("abrir junto com o sistema: não consegui \(action) o item de login (\(error))")
        }
    }
}
