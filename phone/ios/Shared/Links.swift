// The app's links (phone/README.md): amarchy://open?server=<https url> (the
// web app's Settings, Phone app), amarchy://chat/<machine>/<id> (a chat, as
// on the desktop), amarchy://share (the share sheet left something).

import Foundation

enum AmarchyLink: Equatable {
    case open(server: URL)
    case chat(machine: String, id: String)
    case share

    init?(_ url: URL) {
        guard url.scheme?.lowercased() == "amarchy" else { return nil }
        let parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let path = (parts?.percentEncodedPath ?? "").split(separator: "/").map(String.init)
        switch url.host?.lowercased() {
        case "open":
            guard let raw = parts?.queryItems?.first(where: { $0.name == "server" })?.value,
                  let server = try? Address.parse(raw) else { return nil }
            self = .open(server: server)
        case "chat":
            guard path.count == 2, Self.okPart(path[0], most: 63), Self.okPart(path[1], most: 120) else { return nil }
            self = .chat(machine: path[0], id: path[1])
        case "share":
            self = .share
        default:
            return nil
        }
    }

    /// A name or an id as a link may carry it: letters, digits, "._-".
    static func okPart(_ s: String, most: Int) -> Bool {
        !s.isEmpty && s.count <= most && s.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || "._-".contains($0)) }
    }

    /// A chat's route on the machine that's `here`: its own by id, another
    /// machine's by <machine>:<id>.
    static func route(machine: String, id: String, here: String) -> String {
        machine == here || here.isEmpty ? "/#/s/\(id)" : "/#/s/\(machine):\(id)"
    }
}

/// A machine's address, as typed or given: its origin (https://, or http://
/// only to this phone itself), no path.
enum Address {
    struct Invalid: LocalizedError {
        let errorDescription: String?
    }

    static func parse(_ raw: String) throws -> URL {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw Invalid(errorDescription: "Type your amarchy's address, as amarchy.your-tailnet.ts.net") }
        let with = text.contains("://") ? text : "https://" + text
        guard var parts = URLComponents(string: with), let host = parts.host?.lowercased(), !host.isEmpty,
              let scheme = parts.scheme?.lowercased(), parts.user == nil, parts.password == nil,
              !host.contains(" ")
        else { throw Invalid(errorDescription: "\(text) isn't an address: it looks like amarchy.your-tailnet.ts.net") }
        switch scheme {
        case "https": break
        case "http" where isLoopback(host): break
        case "http": throw Invalid(errorDescription: "Your amarchy's address starts with https:// (Tailscale gives it its certificate)")
        default: throw Invalid(errorDescription: "\(text) isn't an address: it looks like amarchy.your-tailnet.ts.net")
        }
        parts.scheme = scheme
        if parts.host != host { parts.host = host }
        if parts.port == (scheme == "https" ? 443 : 80) { parts.port = nil }
        parts.path = ""
        parts.query = nil
        parts.fragment = nil
        guard let url = parts.url else { throw Invalid(errorDescription: "\(text) isn't an address") }
        return url
    }

    static func isLoopback(_ host: String) -> Bool {
        ["127.0.0.1", "localhost", "::1", "[::1]"].contains(host)
    }

    /// The machine's name an address says (its first label), or "" for an IP address.
    static func machineName(_ url: URL) -> String {
        guard let host = url.host, host.rangeOfCharacter(from: .letters) != nil, !host.contains(":") else { return "" }
        return String(host.split(separator: ".").first ?? "")
    }

    /// `Origin:` for a request to it: "https://host[:port]".
    static func origin(_ url: URL) -> String {
        var parts = URLComponents()
        parts.scheme = url.scheme
        parts.host = url.host
        parts.port = url.port
        return parts.string ?? url.absoluteString
    }

    /// Whether a page's URL is on that origin.
    static func sameOrigin(_ a: URL, _ b: URL) -> Bool {
        a.scheme?.lowercased() == b.scheme?.lowercased() && a.host?.lowercased() == b.host?.lowercased()
            && effectivePort(a) == effectivePort(b)
    }

    static func effectivePort(_ url: URL) -> Int {
        url.port ?? (url.scheme?.lowercased() == "http" ? 80 : 443)
    }

    /// The app's address for a route ("/#/s/<key>") and a card to show
    /// (`ask`): "<server>/?ask=<ask>#/s/<key>".
    static func page(_ server: URL, go: String?, ask: String?) -> URL {
        var text = Address.origin(server)
        // Only a route on the machine itself: never another site ("//elsewhere").
        let route = go.flatMap { $0.hasPrefix("/") && !$0.hasPrefix("//") ? $0 : nil } ?? "/"
        let (path, hash) = route.firstIndex(of: "#").map { (String(route[..<$0]), String(route[$0...])) } ?? (route, "")
        text += path.isEmpty ? "/" : path
        if let ask, !ask.isEmpty,
           let q = ask.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._~:"))) {
            text += (text.contains("?") ? "&" : "?") + "ask=" + q
        }
        text += hash
        return URL(string: text) ?? server
    }
}
