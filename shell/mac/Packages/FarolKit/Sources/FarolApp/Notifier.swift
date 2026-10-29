import FarolContrato
import Foundation
import UserNotifications

/// O pedaço da central de notificações que o `Notifier` usa (injetável nos testes).
public protocol NotificationCenterProtocol: AnyObject {
    var delegate: (any UNUserNotificationCenterDelegate)? { get set }
    func requestAuthorization(
        options: UNAuthorizationOptions,
        completionHandler: @escaping @Sendable (Bool, (any Error)?) -> Void)
    func add(
        _ request: UNNotificationRequest,
        withCompletionHandler completionHandler: (@Sendable ((any Error)?) -> Void)?)
}

extension UNUserNotificationCenter: NotificationCenterProtocol {}

/// Mostra os avisos nativos do motor e leva o clique ao `NoticeDispatcher`.
@MainActor
public final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    /// Marca, nas preferências, que a permissão já foi pedida nesta instalação.
    public static let permissionAskedKey = "farol.notifications.permissionAsked"

    private let center: any NotificationCenterProtocol
    private let dispatcher: NoticeDispatcher
    private let defaults: UserDefaults

    public init(
        center: any NotificationCenterProtocol = UNUserNotificationCenter.current(),
        dispatcher: NoticeDispatcher,
        defaults: UserDefaults = .standard
    ) {
        self.center = center
        self.dispatcher = dispatcher
        self.defaults = defaults
        super.init()
        center.delegate = self
    }

    /// Pede alerta, som e selo uma vez só por instalação; a resposta fica com o sistema.
    public func requestPermissionOnce() {
        guard !defaults.bool(forKey: Self.permissionAskedKey) else { return }
        defaults.set(true, forKey: Self.permissionAskedKey)
        center.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    /// Entrega o aviso à central, sem gatilho (aparece na hora).
    public func post(_ notice: NativeNotice) {
        let content = UNMutableNotificationContent()
        content.title = notice.title
        content.body = notice.body
        content.sound = notice.silent ? nil : .default
        var userInfo: [String: String] = [:]
        if let url = notice.url { userInfo["url"] = url.absoluteString }
        if let pr = notice.pr { userInfo["pr"] = pr }
        content.userInfo = userInfo
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        center.add(request, withCompletionHandler: nil)
    }

    /// Refaz o aviso a partir do `userInfo` gravado pelo `post` (o som não importa no clique).
    public nonisolated static func notice(
        from userInfo: [AnyHashable: Any], title: String, body: String
    ) -> NativeNotice {
        NativeNotice(
            title: title,
            body: body,
            url: (userInfo["url"] as? String).flatMap { URL(string: $0) },
            pr: userInfo["pr"] as? String,
            silent: false
        )
    }

    /// O clique no aviso: refaz o aviso e entrega ao despachante na thread principal.
    public nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping @Sendable () -> Void
    ) {
        let content = response.notification.request.content
        let notice = Self.notice(from: content.userInfo, title: content.title, body: content.body)
        Task { @MainActor in
            self.dispatcher.handle(notice)
            completionHandler()
        }
    }

    /// Com o app em primeiro plano o aviso aparece mesmo assim (o som já é nulo quando silencioso).
    public nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler:
            @escaping @Sendable (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }
}
