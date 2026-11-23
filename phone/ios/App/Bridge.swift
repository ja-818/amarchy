// The page's side of the shell (phone/README.md, "What a shell is"):
// `window.amarchyPhone` on the machine's origin, and `window.amarchyShell`
// on the app's own page, each set before the page's scripts run, each
// answered by a WKScriptMessageHandlerWithReply that takes messages from
// that page's main frame only.

import UIKit
import UserNotifications
import WebKit
import WidgetKit

struct BridgeError: LocalizedError {
    let errorDescription: String?
    init(_ words: String) { errorDescription = words }
}

/// What the bridge's commands do outside notifications (fakes in the tests).
@MainActor
protocol BridgeHost: AnyObject {
    func clearNotes(tags: [String]) async
    func keep(status: WidgetStatus)
}

/// `window.amarchyPhone.call(command, args)`: the commands, on the machine `server`.
@MainActor
final class Bridge {
    let push: PushBackend
    weak var host: BridgeHost?

    init(push: PushBackend, host: BridgeHost?) {
        self.push = push
        self.host = host
    }

    /// The answer (NSNull for the page's null), or a BridgeError in words.
    func handle(_ command: String, _ args: Any?, server: Server) async throws -> Any {
        let a = args as? [String: Any] ?? [:]
        switch command {
        case "push.state":
            return await push.state(server: server)
        case "push.subscribe":
            guard let key = a["key"] as? String, !key.isEmpty else { throw BridgeError("push.subscribe needs the machine's key") }
            do {
                return try await push.subscribe(server: server, key: key)
            } catch {
                throw BridgeError(error.localizedDescription)
            }
        case "push.unsubscribe":
            let dropped = await push.unsubscribe(server: server)
            return dropped.map { $0 as Any } ?? NSNull()
        case "notes.clear":
            let tags = (a["tags"] as? [Any] ?? []).compactMap { $0 as? String }.filter { !$0.isEmpty }
            await host?.clearNotes(tags: tags)
            return NSNull()
        case "status":
            guard let status = WidgetStatus(page: args, machine: server.machine) else { throw BridgeError("status needs {needs, chats}") }
            host?.keep(status: status)
            return NSNull()
        default:
            throw BridgeError("The app doesn't know \(command)")
        }
    }

    /// The script that sets `window.amarchyPhone`, on that origin only.
    static func script(origin: String, version: String, relay: URL?) -> String {
        let consts: [String: Any] = ["origin": origin, "version": version, "relay": relay.map { $0.absoluteString as Any } ?? NSNull()]
        let json = (try? JSONSerialization.data(withJSONObject: consts)).map { String(decoding: $0, as: UTF8.self) } ?? "{}"
        return """
        (() => {
          const c = \(json);
          if (location.origin !== c.origin || window.amarchyPhone) return;
          const handler = window.webkit.messageHandlers.amarchy;
          Object.defineProperty(window, "amarchyPhone", { enumerable: true, value: Object.freeze({
            version: c.version, platform: "ios", relay: c.relay,
            call(command, args) {
              return handler.postMessage({ command: String(command), args: args === undefined ? null : args })
                .then((v) => v === undefined ? null : v, (e) => { throw new Error((e && e.message) || String(e)); });
            },
          }) });
        })();
        """
    }

    /// `window.amarchyShell.invoke(cmd, args)` for desktop/dist/shell.js, on
    /// the bundle's own page: rejected with the words, as the desktop's.
    /// shell.js redraws when a status's JSON changes, and a status from
    /// Swift has its keys in any order: they're put in one order here.
    static let shellScript = """
    (() => {
      if (location.protocol !== "file:" || window.amarchyShell) return;
      const handler = window.webkit.messageHandlers.amarchyShell;
      const status = (s) => ({ kind: s.kind, label: s.label, why: s.why, waiting: !!s.waiting,
        machines: (s.machines || []).map((m) => ({ name: m.name, label: m.label, url: m.url })) });
      window.amarchyShell = Object.freeze({
        invoke(cmd, args) {
          return handler.postMessage({ command: String(cmd), args: args || {} })
            .then((v) => v === undefined || v === null ? null : cmd === "status" ? status(v) : v,
                  (e) => { throw (e && e.message) || String(e); });
        },
      });
    })();
    """

    /// The page told of something to open (`amarchy-open`), once it has
    /// loaded; a page that doesn't take it still goes to its route.
    static func openScript(go: String?, ask: String?, share: Bool) -> String {
        var detail: [String: Any] = [:]
        if let go { detail["go"] = go }
        if let ask { detail["ask"] = ask }
        if share { detail["share"] = true }
        let json = (try? JSONSerialization.data(withJSONObject: detail)).map { String(decoding: $0, as: UTF8.self) } ?? "{}"
        return """
        (() => {
          const detail = \(json);
          const fire = () => {
            const before = location.hash;
            window.dispatchEvent(new CustomEvent("amarchy-open", { detail }));
            if (!detail.go) return;
            setTimeout(() => {
              const want = new URL(detail.go, location.href).hash;
              if (want && location.hash === before && location.hash !== want) location.hash = want;
            }, 400);
          };
          if (document.readyState === "complete") fire(); else window.addEventListener("load", fire, { once: true });
        })();
        """
    }
}

/// The web view's message handlers, checking where each message is from.
@MainActor
final class BridgeHandler: NSObject, WKScriptMessageHandlerWithReply {
    /// The machine the web view is on (nil on the own page).
    var server: @MainActor () -> Server? = { nil }
    let bridge: Bridge
    /// The own page's commands (the shell's).
    let shell: @MainActor (String, [String: Any]) async throws -> Any
    let ownPage: URL

    init(bridge: Bridge, ownPage: URL, shell: @escaping @MainActor (String, [String: Any]) async throws -> Any) {
        self.bridge = bridge
        self.ownPage = ownPage
        self.shell = shell
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) async -> (Any?, String?) {
        let body = message.body as? [String: Any] ?? [:]
        let command = body["command"] as? String ?? ""
        let args = body["args"] is NSNull ? nil : body["args"]
        guard message.frameInfo.isMainFrame else { return (nil, "Only the page itself can ask the app") }
        do {
            switch message.name {
            case "amarchy":
                guard let server = server(), Self.isOrigin(message.frameInfo.securityOrigin, of: server.url) else {
                    return (nil, "Only your amarchy can ask the app")
                }
                return (try await bridge.handle(command, args, server: server), nil)
            case "amarchyShell":
                guard let url = message.frameInfo.request.url, OwnPage.contains(url, page: ownPage) else {
                    return (nil, "Only the app's own page can ask that")
                }
                return (try await shell(command, args as? [String: Any] ?? [:]), nil)
            default:
                return (nil, "No such handler")
            }
        } catch {
            return (nil, error.localizedDescription)
        }
    }

    static func isOrigin(_ origin: WKSecurityOrigin, of url: URL) -> Bool {
        var parts = URLComponents()
        parts.scheme = origin.protocol
        parts.host = origin.host
        parts.port = origin.port == 0 ? nil : origin.port
        guard let frame = parts.url else { return false }
        return Address.sameOrigin(frame, url)
    }
}

/// The web view keeps its message handlers strongly: this keeps ours weakly.
final class WeakHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var target: BridgeHandler?

    init(_ target: BridgeHandler) {
        self.target = target
    }

    @MainActor
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) async -> (Any?, String?) {
        guard let target else { return (nil, "The app is closing") }
        return await target.userContentController(controller, didReceive: message)
    }
}

/// The bridge's effects on the phone: notifications off the screen, the
/// widget's status kept (and the badge).
@MainActor
final class PhoneHost: BridgeHost {
    private var last: WidgetStatus?

    func clearNotes(tags: [String]) async {
        guard !tags.isEmpty else { return }
        let center = UNUserNotificationCenter.current()
        let wanted = Set(tags)
        let shown = await center.deliveredNotifications()
        let ids = shown.filter { n in
            wanted.contains(n.request.content.threadIdentifier) || (n.request.content.userInfo["tag"] as? String).map(wanted.contains) == true
        }.map(\.request.identifier)
        center.removeDeliveredNotifications(withIdentifiers: ids)
    }

    func keep(status: WidgetStatus) {
        let old = last ?? WidgetStatus.read()
        // The page says it each time the board changes: the widget only when its words do.
        var same = status
        same.at = old.at
        guard same != old else { return }
        last = status
        try? status.write()
        WidgetCenter.shared.reloadAllTimelines()
        UNUserNotificationCenter.current().setBadgeCount(status.needs) { _ in }
    }
}
