// The Notification Service Extension: what the relay sends is only
// "Something needs you" and `p`, the notification encrypted for this phone.
// Here it's opened (PushCrypto) and shown as the machine wrote it: its title
// and body, one per chat (`tag`), the badge, its buttons; and the widget's
// count. Anything it can't open shows "Amarchy" / "Open it to see", and
// nothing else. It runs in ~24 MB: one small JSON, no web view, no images.

import UserNotifications
import WidgetKit

final class NotificationService: UNNotificationServiceExtension {
    private var handler: ((UNNotificationContent) -> Void)?
    private let lock = NSLock()

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        lock.withLock { handler = contentHandler }
        guard let notice = Self.open(request.content.userInfo) else {
            deliver(Self.unreadable)
            return
        }
        let content = Self.content(for: notice)
        Self.keepWaiting(notice.waiting)
        guard !notice.actions.isEmpty else {
            deliver(content)
            return
        }
        // Its buttons' category is registered (and read back, so it's in
        // place) before the notification is handed over: that's what lets
        // a category made now show on this very notification.
        let category = NoticeCategory.make(labels: notice.actions.map(\.label))
        content.categoryIdentifier = category.identifier
        let center = UNUserNotificationCenter.current()
        center.getNotificationCategories { existing in
            let defaults = SharedStore.defaults
            var recent = defaults.stringArray(forKey: NoticeCategory.recentKey) ?? []
            center.setNotificationCategories(NoticeCategory.merged(existing, adding: category, recent: &recent))
            defaults.set(recent, forKey: NoticeCategory.recentKey)
            center.getNotificationCategories { _ in self.deliver(content) }
        }
    }

    override func serviceExtensionTimeWillExpire() {
        // Out of time: never the relay's placeholder, never half of it.
        deliver(Self.unreadable)
    }

    private func deliver(_ content: UNNotificationContent) {
        let h = lock.withLock { () -> ((UNNotificationContent) -> Void)? in
            defer { handler = nil }
            return handler
        }
        h?(content)
    }

    /// `p` opened with this phone's keys, or nil (no keys, not ours, tampered).
    static func open(_ userInfo: [AnyHashable: Any]) -> Notice? {
        Notice(delivered: userInfo, keys: KeyStore.load())
    }

    static func content(for notice: Notice) -> UNMutableNotificationContent {
        notice.content
    }

    static var unreadable: UNNotificationContent {
        let c = UNMutableNotificationContent()
        c.title = "Amarchy"
        c.body = "Open it to see"
        c.sound = .default
        return c
    }

    /// The widget's count, as the notification says it.
    static func keepWaiting(_ n: Int?) {
        guard let n else { return }
        let old = WidgetStatus.read()
        guard old.needs != n || (n == 0 && !old.chats.isEmpty) else { return }
        try? old.waiting(n).write()
        WidgetCenter.shared.reloadAllTimelines()
    }
}
