import Testing
import WebKit

@testable import FarolApp

@MainActor
@Suite struct TokenInjectionTests {
    @Test func plainTokenIsWrittenBeforeThePageInTheMainFrame() {
        let script = TokenInjection.script(token: "abc123")

        #expect(script.source.contains("localStorage.setItem('farol-auth-token', 'abc123')"))
        #expect(script.injectionTime == .atDocumentStart)
        #expect(script.isForMainFrameOnly)
    }

    @Test func blockedStorageDoesNotBreakThePage() {
        let source = TokenInjection.script(token: "abc").source

        #expect(source.hasPrefix("try {"))
        #expect(source.contains("catch"))
    }

    @Test func quotesBackslashesSlashesAndAngleBracketsAreEscaped() {
        let source = TokenInjection.script(token: "a'b\\c/d<e").source

        #expect(source.contains(#"'a\'b\\c\/d\x3ce'"#))
        #expect(source.contains("\\'"))
        #expect(!source.contains("a'b"))
        #expect(!source.contains("<"))
        #expect(!source.contains("c/d"))
    }

    @Test func lineBreaksAreEscaped() {
        let source = TokenInjection.script(token: "a\nb\rc\u{2028}d\u{2029}e").source

        let escaped = "\\u"
        #expect(source.contains("'a\\nb\\rc" + escaped + "2028d" + escaped + "2029e'"))
        #expect(!source.contains("\n"))
        #expect(!source.contains("\r"))
        #expect(!source.contains("\u{2028}"))
        #expect(!source.contains("\u{2029}"))
    }

    @Test func contentControllerHasTheScriptOnlyWithAToken() {
        #expect(TokenInjection.userContentController(token: nil).userScripts.isEmpty)
        #expect(TokenInjection.userContentController(token: "x").userScripts.count == 1)
    }
}
