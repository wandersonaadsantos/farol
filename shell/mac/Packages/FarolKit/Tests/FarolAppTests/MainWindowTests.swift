import AppKit
import FarolContrato
import Testing

@testable import FarolApp

@MainActor
@Suite struct MainWindowTests {
    @Test func windowHasTheElectronGeometryAndTitle() {
        let main = MainWindow(webViewController: WebViewController(port: 47170, token: nil))

        #expect(main.window.title == "Farol")
        #expect(main.window.frame.size.width == 1120)
        #expect(main.window.frame.size.height == 760)
        #expect(main.window.minSize == NSSize(width: 880, height: 560))
        #expect(main.window.titlebarAppearsTransparent)
        #expect(main.window.titleVisibility == .hidden)
        #expect(main.window.styleMask.contains(.fullSizeContentView))
        #expect(!main.window.isReleasedWhenClosed)
    }

    @Test func closingHidesInsteadOfClosing() {
        let main = MainWindow(webViewController: WebViewController(port: 47170, token: nil))

        #expect(main.windowShouldClose(main.window) == false)
        #expect(!main.isVisible)
    }

    @Test func applyPaintsTheWindowWithTheEngineColors() {
        let main = MainWindow(webViewController: WebViewController(port: 47170, token: nil))
        let state = ShellState(
            badgeCount: 0, badgeLabel: "", busy: false, autostart: false,
            colors: ShellColors(bg: "#f4f6f9", symbol: "#1c2536"))

        main.apply(state)

        #expect(main.window.appearance?.name == .aqua)
        let bg = main.window.backgroundColor.usingColorSpace(.sRGB)
        #expect(abs((bg?.redComponent ?? 0) - 0xf4 / 255.0) < 0.001)
    }
}
