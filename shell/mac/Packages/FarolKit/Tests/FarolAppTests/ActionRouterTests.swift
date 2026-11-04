import FarolContrato
import Foundation
import Testing

@testable import FarolApp

/// Apresentador falso que registra, em ordem, o que a casca pediu à janela.
@MainActor
final class FakePresenter: WindowPresenter {
    enum Call: Equatable {
        case show
        case navigate(String)
        case openExternal(URL)
    }

    var isVisible: Bool
    private(set) var calls: [Call] = []

    init(isVisible: Bool) {
        self.isVisible = isVisible
    }

    func show() {
        calls.append(.show)
        isVisible = true
    }

    func navigate(to path: String) {
        calls.append(.navigate(path))
    }

    func openExternal(_ url: URL) {
        calls.append(.openExternal(url))
    }
}

@Suite struct ActionRouterTests {
    private let prURL = URL(string: "https://github.com/owner/repo/pull/123")!

    private func notice(url: URL?, pr: String?) -> NativeNotice {
        NativeNotice(title: "t", body: "b", url: url, pr: pr, silent: false)
    }

    @Test func urlWinsEvenWhenThereIsAPR() {
        let action = ActionRouter().action(for: notice(url: prURL, pr: "owner/repo#123"))
        #expect(action == .openURL(prURL))
    }

    @Test func prOnlyFocusesThePR() {
        let action = ActionRouter().action(for: notice(url: nil, pr: "owner/repo#123"))
        #expect(action == .focusPR("owner/repo#123"))
    }

    @Test func neitherFocusesTheWindow() {
        #expect(ActionRouter().action(for: notice(url: nil, pr: nil)) == .focusWindow)
    }

    @Test func pathEncodesSlashAndHash() {
        #expect(ActionRouter.path(forPR: "owner/repo#123") == "/?pr=owner%2Frepo%23123")
    }

    @Test func pathEncodesEverythingOutsideUnreserved() {
        #expect(ActionRouter.path(forPR: "a.b_c-d~e/f g&h=i") == "/?pr=a.b_c-d~e%2Ff%20g%26h%3Di")
    }
}

@MainActor
@Suite struct NoticeDispatcherTests {
    @Test func focusPRWithHiddenWindowShowsThenNavigates() {
        let presenter = FakePresenter(isVisible: false)
        let dispatcher = NoticeDispatcher(presenter: presenter)

        dispatcher.handle(NativeNotice(title: "t", body: "b", url: nil, pr: "owner/repo#123", silent: false))

        #expect(presenter.calls == [.show, .navigate("/?pr=owner%2Frepo%23123")])
        #expect(presenter.isVisible)
    }

    @Test func openURLGoesOutsideWithoutShowingTheWindow() {
        let presenter = FakePresenter(isVisible: false)
        let url = URL(string: "https://github.com/owner/repo/pull/1")!

        NoticeDispatcher(presenter: presenter).handle(
            NativeNotice(title: "t", body: "b", url: url, pr: "owner/repo#1", silent: false))

        #expect(presenter.calls == [.openExternal(url)])
    }

    @Test func focusWindowOnlyShows() {
        let presenter = FakePresenter(isVisible: false)

        NoticeDispatcher(presenter: presenter).handle(
            NativeNotice(title: "t", body: "b", url: nil, pr: nil, silent: false))

        #expect(presenter.calls == [.show])
    }
}
