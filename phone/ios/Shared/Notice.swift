// A notification as the machine sends a phone app (phone/README.md,
// "Notifications"): every field but `title` may be missing, and one that
// isn't what it should be counts as missing.

import CryptoKit
import Foundation
import UserNotifications

struct Notice: Equatable {
    struct Action: Equatable {
        var label: String
        /// The machine's path to POST to ("/api/session/<id>/answer").
        var path: String
        /// What to POST, as JSON.
        var body: Data
    }

    var title: String
    var body: String?
    var tag: String?
    var url: String?
    var ask: String?
    var waiting: Int?
    var urgent = false
    var server: URL?
    var session: String?
    var sound: String?
    var actions: [Action] = []

    static let mostActions = 3

    /// The decrypted payload, or nil when it isn't a notification (no title).
    init?(json: Data) {
        guard let d = (try? JSONSerialization.jsonObject(with: json)) as? [String: Any],
              let title = d["title"] as? String else { return nil }
        self.title = title
        body = d["body"] as? String
        tag = Self.text(d["tag"])
        url = Self.text(d["url"])
        ask = Self.text(d["ask"])
        if let n = d["waiting"] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() { waiting = max(0, n.intValue) }
        urgent = (d["urgent"] as? Bool) ?? false
        server = (d["server"] as? String).flatMap { try? Address.parse($0) }
        session = Self.text(d["session"])
        sound = Self.text(d["sound"])
        actions = (d["actions"] as? [Any] ?? []).compactMap { item -> Action? in
            guard let a = item as? [String: Any], let label = Self.text(a["label"]),
                  let path = a["path"] as? String, path.hasPrefix("/"), !path.hasPrefix("//") else { return nil }
            let body = a["body"].flatMap { try? JSONSerialization.data(withJSONObject: $0, options: [.fragmentsAllowed]) }
            return Action(label: label, path: path, body: body ?? Data("{}".utf8))
        }.prefix(Self.mostActions).map { $0 }
    }

    init(title: String) {
        self.title = title
    }

    /// What the relay delivered (`p`, the encrypted payload), opened with
    /// these keys; nil when there's nothing to open it with, or it isn't
    /// for them, or it was changed on the way.
    init?(delivered userInfo: [AnyHashable: Any], keys: PushKeys?) {
        guard let p = userInfo["p"] as? String, let record = Data(base64URL: p), let keys,
              let plain = try? PushCrypto.decrypt(record, keys: keys) else { return nil }
        self.init(json: plain)
    }

    private static func text(_ v: Any?) -> String? {
        guard let s = v as? String, !s.isEmpty else { return nil }
        return s
    }

    // What the notification carries for the app (a button pressed, a tap):
    // property-list types only, the actions' bodies as JSON text.

    var userInfo: [String: Any] {
        var info: [String: Any] = ["amarchy": 1]
        info["tag"] = tag
        info["url"] = url
        info["ask"] = ask
        info["server"] = server?.absoluteString
        info["session"] = session
        info["actions"] = actions.map { ["label": $0.label, "path": $0.path, "body": String(decoding: $0.body, as: UTF8.self)] }
        return info
    }

    init?(userInfo info: [AnyHashable: Any]) {
        guard info["amarchy"] != nil else { return nil }
        title = ""
        tag = info["tag"] as? String
        url = info["url"] as? String
        ask = info["ask"] as? String
        server = (info["server"] as? String).flatMap { try? Address.parse($0) }
        session = info["session"] as? String
        actions = (info["actions"] as? [[String: String]] ?? []).compactMap { a -> Action? in
            guard let label = a["label"], let path = a["path"] else { return nil }
            return Action(label: label, path: path, body: Data((a["body"] ?? "{}").utf8))
        }
    }

    /// amarchy's own chimes (bin/amarchy's CHIMES), each in the app's bundle
    /// as App/Sounds/<name>.caf (phone/ios/sounds.sh): iOS rings a
    /// notification's sound from the app's bundle only, the extension's own
    /// doesn't count.
    static let chimes = ["kalimba", "vibraphone", "tine", "fairy", "ocean", "elementary", "herald"]

    /// The sound file for a chime the machine named, when it's one of
    /// amarchy's; nil for any other (a chime of your own the app hasn't).
    static func chimeFile(_ name: String?) -> String? {
        guard let name = name?.lowercased(), chimes.contains(name) else { return nil }
        return "\(name).caf"
    }

    /// The notification's sound: the chime picked in amarchy's Settings (or
    /// your assistant's own), as the desktop app rings it; iOS's own when
    /// it's none of amarchy's, or none was named.
    var notificationSound: UNNotificationSound {
        Self.chimeFile(sound).map { UNNotificationSound(named: UNNotificationSoundName($0)) } ?? .default
    }

    /// As the extension shows it: one per chat (`tag`), the badge, its
    /// chime, time-sensitive when it's urgent, and what the app needs of it.
    var content: UNMutableNotificationContent {
        let c = UNMutableNotificationContent()
        c.title = title
        c.body = body ?? ""
        if let tag { c.threadIdentifier = tag }
        if let waiting { c.badge = NSNumber(value: waiting) }
        c.sound = notificationSound
        c.interruptionLevel = urgent ? .timeSensitive : .active
        c.userInfo = userInfo
        return c
    }
}

/// The buttons' category: one per set of labels (`amarchy.<hash>`), its
/// actions `a0`…`a2`, each asking for Face ID on a locked phone. Made in
/// the extension as each notification comes, so the labels are the
/// notification's own.
enum NoticeCategory {
    static let prefix = "amarchy."
    /// How many of ours are kept registered (the newest).
    static let kept = 24
    static let recentKey = "categories.recent"

    static func id(labels: [String]) -> String {
        let digest = SHA256.hash(data: Data(labels.joined(separator: "\u{1f}").utf8))
        return prefix + Data(digest).prefix(8).hex
    }

    static func make(labels: [String]) -> UNNotificationCategory {
        let actions = labels.prefix(Notice.mostActions).enumerated().map { i, label in
            UNNotificationAction(identifier: "a\(i)", title: label, options: [.authenticationRequired])
        }
        return UNNotificationCategory(identifier: id(labels: Array(labels.prefix(Notice.mostActions))),
                                      actions: actions, intentIdentifiers: [], options: [])
    }

    /// The categories to register with a new one: anyone else's as they are,
    /// ours only the `kept` newest (`recent`, oldest first, is updated).
    static func merged(_ existing: Set<UNNotificationCategory>, adding new: UNNotificationCategory,
                       recent: inout [String]) -> Set<UNNotificationCategory> {
        recent.removeAll { $0 == new.identifier }
        recent.append(new.identifier)
        recent = Array(recent.suffix(kept))
        let keep = Set(recent)
        var out = existing.filter { !$0.identifier.hasPrefix(prefix) || (keep.contains($0.identifier) && $0.identifier != new.identifier) }
        out.insert(new)
        return out
    }
}
