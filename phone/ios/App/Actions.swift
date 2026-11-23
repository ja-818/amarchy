// A notification acted on (phone/README.md, "Notifications", steps 3 and
// 4): a button POSTs its `body` to the machine as the page would (iOS
// starts the app in the background for it), and the notification goes; it
// didn't go through: a notification says so, and opens the chat. Tapped:
// the app opens on its chat, on the card it's about.

import UIKit
import UserNotifications

/// On the main actor: iOS's completion handlers behind these async methods
/// must be called there.
@MainActor
final class NotificationHandler: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationHandler()

    /// In front: shown as the phone's browser shows them (the page is
    /// what's open, not necessarily that chat).
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async
        -> UNNotificationPresentationOptions {
        [.banner, .list, .sound, .badge]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let request = response.notification.request
        // Not one of the machine's (one the extension couldn't read): the app, as it is.
        guard let notice = Notice(userInfo: request.content.userInfo) else { return }
        let id = response.actionIdentifier
        if id == UNNotificationDefaultActionIdentifier {
            Router.shared.with { $0.open(OpenRequest(go: notice.url, ask: notice.ask, server: notice.server)) }
        } else if id.hasPrefix("a"), let i = Int(id.dropFirst()), notice.actions.indices.contains(i) {
            await ActionSender.send(notice.actions[i], of: notice, shownAs: request.identifier)
        }
    }
}

enum ActionSender {
    /// Its POST, with 20 seconds to answer, as a background task: the
    /// notification off the screen when it worked, one saying so when not.
    @MainActor
    static func send(_ action: Notice.Action, of notice: Notice, shownAs id: String) async {
        let task = BackgroundTask(name: "amarchy.answer")
        defer { task.end() }
        guard let server = notice.server ?? Server.kept?.url,
              let url = URL(string: Address.origin(server) + action.path) else {
            await failed(action, of: notice)
            return
        }
        do {
            _ = try await Net.postJSON(url, action.body, origin: server, timeout: 20)
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [id])
        } catch {
            await failed(action, of: notice)
        }
    }

    /// "Couldn't send <label>" / "Open the chat to answer": tapped, the chat.
    static func failed(_ action: Notice.Action, of notice: Notice) async {
        let content = UNMutableNotificationContent()
        content.title = "Couldn't send \(action.label)"
        content.body = "Open the chat to answer"
        content.sound = .default
        if let tag = notice.tag { content.threadIdentifier = tag }
        var plain = notice
        plain.actions = []
        content.userInfo = plain.userInfo
        let request = UNNotificationRequest(identifier: "failed.\(notice.tag ?? UUID().uuidString)", content: content, trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)
    }
}

/// A background task's time, ended once (by us, or when iOS says it's up).
@MainActor
final class BackgroundTask {
    private var id: UIBackgroundTaskIdentifier = .invalid

    init(name: String) {
        id = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
            MainActor.assumeIsolated { self?.end() }
        }
    }

    func end() {
        guard id != .invalid else { return }
        UIApplication.shared.endBackgroundTask(id)
        id = .invalid
    }
}
