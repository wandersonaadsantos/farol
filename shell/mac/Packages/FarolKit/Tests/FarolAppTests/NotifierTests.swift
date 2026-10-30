import FarolContrato
import Foundation
import Testing
import UserNotifications

@testable import FarolApp

/// Central de notificações falsa: guarda os pedidos em vez de falar com o sistema.
final class FakeNotificationCenter: NotificationCenterProtocol {
    weak var delegate: (any UNUserNotificationCenterDelegate)?
    private(set) var authorizationRequests: [UNAuthorizationOptions] = []
    private(set) var requests: [UNNotificationRequest] = []

    func requestAuthorization(
        options: UNAuthorizationOptions,
        completionHandler: @escaping @Sendable (Bool, (any Error)?) -> Void
    ) {
        authorizationRequests.append(options)
        completionHandler(true, nil)
    }

    func add(
        _ request: UNNotificationRequest,
        withCompletionHandler completionHandler: (@Sendable ((any Error)?) -> Void)?
    ) {
        requests.append(request)
        completionHandler?(nil)
    }
}

@MainActor
@Suite struct NotifierTests {
    private func makeNotifier(
        center: FakeNotificationCenter, presenter: FakePresenter = FakePresenter(isVisible: false),
        defaults: UserDefaults = .standard
    ) -> Notifier {
        Notifier(center: center, dispatcher: NoticeDispatcher(presenter: presenter), defaults: defaults)
    }

    @Test func initBecomesTheCenterDelegate() {
        let center = FakeNotificationCenter()
        let notifier = makeNotifier(center: center)
        #expect(center.delegate === notifier)
    }

    @Test func postBuildsContentWithUserInfo() throws {
        let center = FakeNotificationCenter()
        let notifier = makeNotifier(center: center)

        notifier.post(
            NativeNotice(
                title: "Título", body: "Corpo", url: URL(string: "https://github.com/o/r/pull/1"),
                pr: "o/r#1", silent: false))

        let request = try #require(center.requests.first)
        #expect(request.trigger == nil)
        #expect(UUID(uuidString: request.identifier) != nil)
        #expect(request.content.title == "Título")
        #expect(request.content.body == "Corpo")
        #expect(request.content.sound == .default)
        #expect(request.content.userInfo["url"] as? String == "https://github.com/o/r/pull/1")
        #expect(request.content.userInfo["pr"] as? String == "o/r#1")
    }

    @Test func silentNoticeHasNoSoundAndOmitsMissingKeys() throws {
        let center = FakeNotificationCenter()
        let notifier = makeNotifier(center: center)

        notifier.post(NativeNotice(title: "t", body: "b", url: nil, pr: nil, silent: true))

        let request = try #require(center.requests.first)
        #expect(request.content.sound == nil)
        #expect(request.content.userInfo["url"] == nil)
        #expect(request.content.userInfo["pr"] == nil)
    }

    @Test func permissionIsRequestedOnlyOnce() throws {
        let suite = "farol.tests.notifier.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let center = FakeNotificationCenter()
        let notifier = makeNotifier(center: center, defaults: defaults)

        notifier.requestPermissionOnce()
        notifier.requestPermissionOnce()

        #expect(center.authorizationRequests == [[.alert, .sound, .badge]])
        #expect(defaults.bool(forKey: Notifier.permissionAskedKey))
    }

    @Test func noticeFromUserInfoRebuildsTheNotice() {
        let notice = Notifier.notice(
            from: ["url": "https://github.com/o/r/pull/2", "pr": "o/r#2"], title: "t", body: "b")
        #expect(
            notice
                == NativeNotice(
                    title: "t", body: "b", url: URL(string: "https://github.com/o/r/pull/2"), pr: "o/r#2",
                    silent: false))
    }

    @Test func noticeFromEmptyUserInfoHasNoTarget() {
        let notice = Notifier.notice(from: [:], title: "t", body: "b")
        #expect(notice.url == nil)
        #expect(notice.pr == nil)
    }

    @Test func clickOnPRNoticeShowsAndNavigates() {
        let presenter = FakePresenter(isVisible: false)
        let dispatcher = NoticeDispatcher(presenter: presenter)

        dispatcher.handle(Notifier.notice(from: ["pr": "owner/repo#123"], title: "t", body: "b"))

        #expect(presenter.calls == [.show, .navigate("/?pr=owner%2Frepo%23123")])
    }
}
