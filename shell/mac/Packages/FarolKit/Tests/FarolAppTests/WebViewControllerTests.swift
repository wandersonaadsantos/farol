import AppKit
import FarolContrato
import Testing

@testable import FarolApp

@MainActor
@Suite struct WebViewControllerTests {
    @Test func engineOriginStaysInTheWindow() throws {
        let port = 47170
        #expect(WebViewController.policy(for: try url("http://127.0.0.1:47170/x"), port: port) == .allow)
        #expect(WebViewController.policy(for: try url("http://localhost:47170/"), port: port) == .allow)
        #expect(WebViewController.policy(for: try url("about:blank"), port: port) == .allow)
    }

    @Test func otherOriginsOpenInTheBrowser() throws {
        let port = 47170
        #expect(
            WebViewController.policy(for: try url("http://127.0.0.1:47171/"), port: port) == .openExternally)
        #expect(
            WebViewController.policy(for: try url("https://github.com/owner/repo/pull/1"), port: port)
                == .openExternally)
        #expect(
            WebViewController.policy(for: try url("https://127.0.0.1:47170/"), port: port) == .openExternally)
        #expect(WebViewController.policy(for: try url("http://127.0.0.1/"), port: port) == .openExternally)
    }

    @Test func schemesThatAreNotWebAreRefused() throws {
        #expect(WebViewController.policy(for: try url("file:///etc/passwd"), port: 47170) == .deny)
        #expect(WebViewController.policy(for: try url("javascript:alert(1)"), port: 47170) == .deny)
    }

    @Test func navigateBuildsTheEngineURL() throws {
        let controller = WebViewController(port: 47170, token: nil)

        #expect(
            controller.url(for: "/?pr=owner%2Frepo%23N")?.absoluteString
                == "http://127.0.0.1:47170/?pr=owner%2Frepo%23N")
    }

    @Test func colorParsingAcceptsOnlyHexTriplets() throws {
        let dark = try #require(WebViewController.color(fromHex: "#0b0e14"))
        #expect(abs(dark.redComponent - 11.0 / 255.0) < 0.001)
        #expect(WebViewController.color(fromHex: "0b0e14") == nil)
        #expect(WebViewController.color(fromHex: "#0b0e1") == nil)
        #expect(WebViewController.color(fromHex: "#zzzzzz") == nil)
    }

    @Test func appearanceFollowsTheBackgroundLuminance() {
        #expect(WebViewController.appearanceName(forHex: "#0b0e14") == .darkAqua)
        #expect(WebViewController.appearanceName(forHex: "#f4f6f9") == .aqua)
        #expect(WebViewController.appearanceName(forHex: "lixo") == nil)
    }

    @Test func tokenReachesTheWebViewContentController() {
        let controller = WebViewController(port: 47170, token: "abc")

        #expect(controller.webView.configuration.userContentController.userScripts.count == 1)
    }

    @Test func blobAndDataURLsBecomeDownloads() throws {
        #expect(
            WebViewController.shouldDownload(
                url: try url("blob:http://127.0.0.1:47170/abc"), requested: false))
        #expect(
            WebViewController.shouldDownload(url: try url("data:text/plain;base64,QQ=="), requested: false))
        #expect(WebViewController.shouldDownload(url: try url("DATA:text/plain,x"), requested: false))
    }

    @Test func downloadAttributeBecomesDownloadEvenOnTheEngineOrigin() throws {
        #expect(
            WebViewController.shouldDownload(url: try url("http://127.0.0.1:47170/x.md"), requested: true))
    }

    @Test func ordinaryNavigationIsNotADownload() throws {
        #expect(!WebViewController.shouldDownload(url: try url("http://127.0.0.1:47170/"), requested: false))
        #expect(!WebViewController.shouldDownload(url: try url("https://github.com/"), requested: false))
    }

    private func url(_ text: String) throws -> URL {
        try #require(URL(string: text))
    }
}
