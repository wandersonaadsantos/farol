import AppKit
import FarolApp
import FarolContrato
import os

/// Liga as peças da casca: o supervisor do motor, a janela, a bandeja, o Dock, o abrir junto
/// com o sistema e os avisos. Guarda forte tudo o que o sistema só referencia fraco (o
/// `Notifier`, delegate da central; o controlador da bandeja, alvo do menu).
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuItemValidation, StatusItemActions, ShellUI {
    private static let logger = Logger(subsystem: "com.biud.farol", category: "app")

    private let presenter = WindowPresenterAdapter()
    private let autostart = Autostart(service: MainAppLoginItem())
    private var dispatcher: NoticeDispatcher?
    private var notifier: Notifier?
    private var statusItem: StatusItemController?
    private var supervisor: SidecarSupervisor?
    private var updater: Updater?
    private var lastState: ShellState?
    /// A primeira janela nasce escondida depois de um update (reabertura silenciosa).
    private var startHidden = false
    private var terminating = false
    private var terminationReplied = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = MainMenu.make()
        let environment = ProcessInfo.processInfo.environment
        let paths = ShellPaths(environment: environment)

        let dispatcher = NoticeDispatcher(presenter: presenter)
        let notifier = Notifier(dispatcher: dispatcher)
        self.dispatcher = dispatcher
        self.notifier = notifier
        notifier.requestPermissionOnce()
        statusItem = StatusItemController(actions: self)
        updater = Updater(checker: SparkleUpdateChecker())

        if let version = SilentReopen.consume(stateDir: paths.workspaceState) {
            startHidden = true
            notifier.post(SidecarSupervisor.updatedNotice(version: version))
        }

        let shellVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let services = SidecarServices.live(
            paths: paths, environment: environment, shellVersion: shellVersion ?? "3.0.0")
        let supervisor = SidecarSupervisor(services: services, ui: self)
        self.supervisor = supervisor
        // O que o Farol Electron deixou (LaunchAgent e lançador), em segundo plano: não atrasa
        // a janela e não mostra nada.
        let migration = LegacyMigration(
            home: FileManager.default.homeDirectoryForCurrentUser, runningBundle: Bundle.main.bundleURL)
        Task.detached(priority: .utility) { migration.run() }
        Task { await supervisor.boot() }
    }

    /// Clique no Dock ou segunda abertura do app: só mostra a janela.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        presenter.show()
        return false
    }

    /// Fechar a janela só esconde; o app segue na bandeja.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    /// Quanto o encerramento espera o motor parar antes de deixar o app sair mesmo assim.
    private static let shutdownLimit: Duration = .seconds(8)

    /// Para o motor antes de sair; o processo do motor nunca fica órfão.
    ///
    /// O encerramento corre contra um teto de 8 s: o `stop()` do motor já tem o próprio limite
    /// (SIGTERM, 5 s, SIGKILL), mas um passo que trave antes dele (uma subida pendente, um
    /// alerta modal aberto) não pode prender o Sair para sempre. Quem chegar primeiro responde,
    /// e a resposta é sempre "pode sair". Não é um grupo de tarefas: o grupo espera todas as
    /// filhas no fim, e o `shutdown()` não para quando cancelado, então o teto não valeria.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let supervisor else { return .terminateNow }
        if terminating { return .terminateLater }
        terminating = true
        let limit = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: Self.shutdownLimit) } catch { return }
            Self.logger.error("o motor não parou em 8 s; saindo assim mesmo")
            self?.replyToTermination()
        }
        Task { @MainActor [weak self] in
            await supervisor.shutdown()
            limit.cancel()
            self?.replyToTermination()
        }
        return .terminateLater
    }

    /// Responde ao pedido de saída uma vez só, a quem chegar primeiro.
    private func replyToTermination() {
        guard !terminationReplied else { return }
        terminationReplied = true
        NSApp.reply(toApplicationShouldTerminate: true)
    }

    // MARK: StatusItemActions

    func openWindow() { presenter.show() }

    func checkNow() {
        guard let supervisor else { return }
        Task { await supervisor.checkNow() }
    }

    func quit() { NSApp.terminate(nil) }

    /// "Verificar atualizações..." do menu Farol, pela cadeia de resposta.
    @objc func checkForUpdates(_ sender: Any?) {
        updater?.checkNow()
    }

    /// O item "Verificar atualizações..." só fica habilitado quando a verificação pode rodar
    /// (a Sparkle iniciou e o motor não está revisando); os outros itens que chegam aqui seguem
    /// habilitados.
    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        guard menuItem.action == #selector(checkForUpdates(_:)) else { return true }
        return updater?.canCheckNow ?? false
    }

    // MARK: ShellUI

    func openWindow(port: Int, token: String?, viewer: Bool) {
        let previous = presenter.mainWindow
        let window = MainWindow(webViewController: WebViewController(port: port, token: token))
        if let lastState { window.apply(lastState) }
        presenter.mainWindow = window
        window.webViewController.navigate(to: "/")

        if let previous {
            // Repareamento ou religar: a janela nova toma o lugar da antiga, do mesmo jeito.
            window.window.setFrame(previous.window.frame, display: false)
            if previous.isVisible {
                window.window.orderFront(nil)
                if previous.window.isKeyWindow { window.window.makeKey() }
            }
            previous.window.orderOut(nil)
        } else if startHidden {
            startHidden = false
        } else {
            window.show()
        }
        Self.logger.notice(
            "janela aberta (visor: \(viewer, privacy: .public), com token: \(token != nil, privacy: .public))"
        )
    }

    func showViewerNotice() {
        let alert = NSAlert()
        alert.messageText = "Outro Farol já está rodando nesta porta; esta janela só mostra o que ele faz"
        alert.addButton(withTitle: "OK")
        Task { @MainActor [weak self] in
            if let window = self?.presenter.mainWindow?.window, window.isVisible {
                alert.beginSheetModal(for: window)
            } else {
                alert.runModal()
            }
        }
    }

    func showFailure(_ message: String) {
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "O Farol não conseguiu subir"
        alert.informativeText = message
        alert.addButton(withTitle: "Tentar de novo")
        alert.addButton(withTitle: "Sair")
        // Fora da pilha do supervisor: o alerta modal não roda dentro de um efeito.
        Task { @MainActor [weak self] in
            NSApp.activate()
            if alert.runModal() == .alertFirstButtonReturn {
                self?.supervisor?.retry()
            } else {
                NSApp.terminate(nil)
            }
        }
    }

    func apply(_ state: ShellState) {
        lastState = state
        presenter.mainWindow?.apply(state)
        statusItem?.apply(state)
        DockBadge.apply(state)
        updater?.engineBusy = state.busy
    }

    func applyAutostart(_ wanted: Bool) {
        autostart.apply(wanted)
    }

    func post(_ notice: NativeNotice) {
        notifier?.post(notice)
    }
}
