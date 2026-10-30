import Foundation
import Sparkle
import os

/// O que a casca precisa do verificador de atualizações, atrás de um protocolo para os testes
/// (o de verdade é o `SPUUpdater` da Sparkle).
@MainActor
public protocol UpdateChecker: AnyObject {
    var canCheckForUpdates: Bool { get }
    /// Consultado antes de cada verificação que a própria Sparkle agenda; `false` recusa.
    var mayPerformCheck: (@MainActor () -> Bool)? { get set }
    func checkForUpdatesInBackground()
    func checkForUpdates()
}

/// A atualização da casca: só verifica com o motor parado (`ShellState.busy == false`).
///
/// A verificação periódica é da Sparkle (`SUScheduledCheckInterval`, 24 h por padrão); o gate
/// recusa a que cair durante uma revisão e a refaz uma vez, em segundo plano, quando o motor
/// fica livre. Atualizar no meio de uma sessão de IA a mataria junto com o motor.
@MainActor
public final class Updater {
    private let checker: any UpdateChecker
    /// Uma verificação agendada foi recusada enquanto o motor trabalhava.
    private var deferredCheck = false

    /// O motor está rodando uma revisão; vem do evento `casca`.
    public var engineBusy = false {
        didSet {
            guard oldValue, !engineBusy, deferredCheck else { return }
            deferredCheck = false
            _ = checkInBackground()
        }
    }

    public init(checker: any UpdateChecker) {
        self.checker = checker
        checker.mayPerformCheck = { [weak self] in self?.allowScheduledCheck() ?? false }
    }

    /// O gate puro: verifica só com o motor parado.
    public var mayCheck: Bool { !engineBusy }

    /// A regra pura de "dá para verificar agora": a Sparkle iniciou (sem a chave EdDSA ela não
    /// inicia e não verifica nada) e o motor não está revisando. O item "Verificar
    /// atualizações..." fica desabilitado quando ela diz não, porque clique que não faz nada
    /// é pior que item cinza.
    public static func canCheck(sparkleReady: Bool, engineBusy: Bool) -> Bool {
        sparkleReady && !engineBusy
    }

    /// `canCheck` com o estado atual; o menu consulta isto ao validar o item.
    public var canCheckNow: Bool {
        Self.canCheck(sparkleReady: checker.canCheckForUpdates, engineBusy: engineBusy)
    }

    /// Verificação silenciosa; devolve se ela foi pedida à Sparkle.
    @discardableResult
    public func checkInBackground() -> Bool {
        guard canCheckNow else { return false }
        checker.checkForUpdatesInBackground()
        return true
    }

    /// "Verificar atualizações..." do menu; devolve se ela foi pedida à Sparkle.
    @discardableResult
    public func checkNow() -> Bool {
        guard canCheckNow else { return false }
        checker.checkForUpdates()
        return true
    }

    private func allowScheduledCheck() -> Bool {
        if mayCheck { return true }
        deferredCheck = true
        return false
    }
}

/// O verificador de verdade: o `SPUStandardUpdaterController` da Sparkle, já iniciado.
///
/// O gate entra pelo `updater(_:mayPerform:)` do `SPUUpdaterDelegate` (na 2.10.1 o método
/// Objective-C é `updater:mayPerformUpdateCheck:error:`, que no Swift vira `throws`): lançar
/// ali recusa a verificação.
@MainActor
public final class SparkleUpdateChecker: NSObject, UpdateChecker, SPUUpdaterDelegate {
    private static let logger = Logger(subsystem: "com.biud.farol", category: "updater")

    public var mayPerformCheck: (@MainActor () -> Bool)?
    private var controller: SPUStandardUpdaterController?

    public override init() {
        super.init()
        let controller = SPUStandardUpdaterController(
            startingUpdater: false, updaterDelegate: self, userDriverDelegate: nil)
        self.controller = controller
        // Inicia pelo SPUUpdater, não pelo controlador: o `startUpdater()` do controlador mostra
        // um alerta modal a cada abertura quando a configuração não fecha (a chave EdDSA fica
        // vazia até o plano 4), e aqui a falha vira só uma linha de log. Sem iniciar, o
        // `canCheckForUpdates` fica falso e nenhuma verificação sai.
        do {
            try controller.updater.start()
        } catch {
            Self.logger.warning(
                "atualização desligada: \(error.localizedDescription, privacy: .public)")
        }
    }

    public var canCheckForUpdates: Bool { controller?.updater.canCheckForUpdates ?? false }

    public func checkForUpdatesInBackground() { controller?.updater.checkForUpdatesInBackground() }

    public func checkForUpdates() { controller?.updater.checkForUpdates() }

    public func updater(_ updater: SPUUpdater, mayPerform updateCheck: SPUUpdateCheck) throws {
        guard let mayPerformCheck, !mayPerformCheck() else { return }
        Self.logger.notice("verificação de atualização adiada: o motor está revisando")
        throw NSError(
            domain: "com.biud.farol.updater", code: 1,
            userInfo: [
                NSLocalizedDescriptionKey: "O Farol está revisando um PR; a verificação fica para depois"
            ])
    }
}
