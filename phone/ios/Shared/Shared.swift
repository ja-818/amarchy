// What the app and its extensions share: the app group (its files and
// settings) and the names every target agrees on. Compiled into each target.

import Foundation

enum Amarchy {
    static let bundleID = "io.github.ja818.amarchy"
    static let appGroup = "group.io.github.ja818.amarchy"

    /// The Keychain group the app and its notification extension share (the
    /// team's prefix comes from the build, in each target's Info.plist).
    static var keychainGroup: String? {
        let group = Bundle.main.object(forInfoDictionaryKey: "AmarchyKeychainGroup") as? String
        return group.flatMap { $0.isEmpty || $0.hasPrefix("$(") ? nil : $0 }
    }

    /// The push relay built in (AMARCHY_RELAY), or nil: no notifications in this build.
    static var relay: URL? {
        guard let raw = (Bundle.main.object(forInfoDictionaryKey: "AmarchyRelay") as? String)?
            .trimmingCharacters(in: .whitespaces), raw.hasPrefix("https://") || raw.hasPrefix("http://"),
            let url = URL(string: raw.hasSuffix("/") ? String(raw.dropLast()) : raw), url.host != nil
        else { return nil }
        return url
    }

    /// "1.0 (12)": the app's version and build.
    static var version: String {
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0"
        return "\(shortVersion) (\(build))"
    }

    /// "1.0", as the web view's user agent says it (AmarchyApp/1.0).
    static var shortVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
    }
}

/// The app group's files and settings. Without the group (a build that
/// isn't signed, as the simulator's in CI), the target's own: everything
/// still works, the extensions just don't see it.
enum SharedStore {
    static var defaults: UserDefaults {
        UserDefaults(suiteName: Amarchy.appGroup) ?? .standard
    }

    static var folder: URL {
        let fm = FileManager.default
        let base = fm.containerURL(forSecurityApplicationGroupIdentifier: Amarchy.appGroup)
            ?? fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? fm.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    static var statusFile: URL { folder.appendingPathComponent("status.json") }

    /// What the share sheet left for the app to send: one folder per share.
    static var inbox: URL {
        let url = folder.appendingPathComponent("inbox", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
}

/// What the widget shows: how many chats need you, and the first of them.
/// Written by the page (the bridge's `status`) and by each notification
/// (its `waiting`), read by the widget.
struct WidgetStatus: Codable, Equatable {
    struct Chat: Codable, Equatable {
        var key: String
        var name: String
        var why: String?
    }

    var needs: Int
    var chats: [Chat]
    /// The machine the chats' keys are on (a key "<machine>:<id>" is another's).
    var machine: String?
    var at: Date

    static let empty = WidgetStatus(needs: 0, chats: [], machine: nil, at: .distantPast)

    /// "2 need you", "1 needs you", "Nothing needs you".
    var words: String {
        switch needs {
        case ..<1: return "Nothing needs you"
        case 1: return "1 needs you"
        default: return "\(needs) need you"
        }
    }

    /// The chat's link (amarchy://chat/<machine>/<id>), for a widget's line.
    func link(for chat: Chat) -> URL? {
        let parts = chat.key.split(separator: ":", maxSplits: 1).map(String.init)
        let (machine, id) = parts.count == 2 ? (parts[0], parts[1]) : (self.machine ?? "", chat.key)
        guard AmarchyLink.okPart(machine, most: 63), AmarchyLink.okPart(id, most: 120) else { return nil }
        return URL(string: "amarchy://chat/\(machine)/\(id)")
    }

    static func read(from url: URL = SharedStore.statusFile) -> WidgetStatus {
        guard let data = try? Data(contentsOf: url),
              let status = try? JSONDecoder.amarchy.decode(WidgetStatus.self, from: data) else { return .empty }
        return status
    }

    func write(to url: URL = SharedStore.statusFile) throws {
        try JSONEncoder.amarchy.encode(self).write(to: url, options: .atomic)
    }

    /// The page's `status` args, `{"needs", "chats": [{"key", "name", "why"}]}`.
    init?(page args: Any?, machine: String?, at: Date = Date()) {
        guard let dict = args as? [String: Any] else { return nil }
        let needs = (dict["needs"] as? NSNumber)?.intValue ?? 0
        let chats = (dict["chats"] as? [Any] ?? []).compactMap { item -> Chat? in
            guard let c = item as? [String: Any], let key = c["key"] as? String, !key.isEmpty else { return nil }
            let name = (c["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? key
            return Chat(key: key, name: String(name.prefix(80)), why: (c["why"] as? String).map { String($0.prefix(160)) })
        }
        self.init(needs: max(0, needs), chats: Array(chats.prefix(8)), machine: machine, at: at)
    }

    init(needs: Int, chats: [Chat], machine: String?, at: Date) {
        self.needs = needs
        self.chats = chats
        self.machine = machine
        self.at = at
    }

    /// A notification's `waiting`: the count it says, with the names the page
    /// gave (as many as still fit).
    func waiting(_ n: Int, at: Date = Date()) -> WidgetStatus {
        WidgetStatus(needs: max(0, n), chats: n > 0 ? Array(chats.prefix(n)) : [], machine: machine, at: at)
    }
}

extension JSONEncoder {
    static let amarchy: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .secondsSince1970
        e.outputFormatting = [.sortedKeys]
        return e
    }()
}

extension JSONDecoder {
    static let amarchy: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .secondsSince1970
        return d
    }()
}

extension Data {
    /// base64url, with or without its padding.
    init?(base64URL text: String) {
        var s = text.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while s.hasSuffix("=") { s.removeLast() }
        s += String(repeating: "=", count: (4 - s.count % 4) % 4)
        self.init(base64Encoded: s)
    }

    /// base64url without padding, as Web Push writes keys.
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    var hex: String { map { String(format: "%02x", $0) }.joined() }
}
