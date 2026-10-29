import AppKit
import FarolApp
import FarolContrato
import os

/// Liga as peças da casca: o supervisor do motor, a janela, a bandeja, o Dock, o abrir junto
/// com o sistema e os avisos. Guarda forte tudo o que o sistema só referencia fraco (o
/// `Notifier`, delegate da central; o controlador da bandeja, alvo do menu).
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, StatusItemActions, ShellUI {
    private static let logger = Logger(subsystem: "com.biud.farol", category: "app")

    private let presenter = WindowPresenterAdapter()
    private let autostart = Autostart(service: MainAppLoginItem())
    private var dispatcher: NoticeDispatcher?
    private var notifier: Notifier?
    private var statusItem: StatusItemController?
    private var supervisor: SidecarSupervisor?
    private var lastState: ShellState?
    /// A primeira janela nasce escondida depois de um update (reabertura silenciosa).
    private var startHidden = false
    private var terminating = false

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

        if let version = SilentReopen.consume(stateDir: paths.workspaceState) {
            startHidden = true
            notifier.post(SidecarSupervisor.updatedNotice(version: version))
        }

        let shellVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let services = SidecarServices.live(
            paths: paths, environment: environment, shellVersion: shellVersion ?? "3.0.0")
        let supervisor = SidecarSupervisor(services: services, ui: self)
        self.supervisor = supervisor
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

    /// Para o motor antes de sair; o processo do motor nunca fica órfão.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let supervisor else { return .terminateNow }
        if terminating { return .terminateLater }
        terminating = true
        Task {
            await supervisor.shutdown()
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    // MARK: StatusItemActions

    func openWindow() { presenter.show() }

    func checkNow() {
        guard let supervisor else { return }
        Task { await supervisor.checkNow() }
    }

    func quit() { NSApp.terminate(nil) }

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
    }

    func applyAutostart(_ wanted: Bool) {
        autostart.apply(wanted)
    }

    func post(_ notice: NativeNotice) {
        notifier?.post(notice)
    }
}
