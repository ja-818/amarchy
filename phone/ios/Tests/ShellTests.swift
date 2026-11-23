// The shell around the page: its links and addresses, where a navigation
// goes, the widget's words, the share sheet's upload, and the bridge (its
// commands, with a fake notifications backend, and its scripts, run in
// JavaScriptCore).

import JavaScriptCore
import XCTest
@testable import Amarchy

final class LinkTests: XCTestCase {
    func link(_ s: String) -> AmarchyLink? { URL(string: s).flatMap(AmarchyLink.init) }

    func testTheAppsLinks() {
        XCTAssertEqual(link("amarchy://open?server=https://amarchy.tail1234.ts.net"),
                       .open(server: URL(string: "https://amarchy.tail1234.ts.net")!))
        XCTAssertEqual(link("amarchy://open?server=amarchy.tail1234.ts.net%2F"), .open(server: URL(string: "https://amarchy.tail1234.ts.net")!))
        XCTAssertEqual(link("amarchy://open?server=http://127.0.0.1:7397"), .open(server: URL(string: "http://127.0.0.1:7397")!))
        XCTAssertNil(link("amarchy://open?server=http://elsewhere.example"))
        XCTAssertNil(link("amarchy://open"))
        XCTAssertEqual(link("amarchy://chat/amarchy/web-fix"), .chat(machine: "amarchy", id: "web-fix"))
        XCTAssertEqual(link("amarchy://chat/omarchy/a.b_c-1/"), .chat(machine: "omarchy", id: "a.b_c-1"))
        XCTAssertEqual(link("amarchy://chat/omarchy/x?from=bar"), .chat(machine: "omarchy", id: "x"))
        XCTAssertEqual(link("amarchy://share"), .share)
        for bad in ["amarchy://chat/omarchy", "amarchy://chat//x", "amarchy://other/a/b", "https://chat/a/b",
                    "amarchy://chat/a/b/c", "amarchy://chat/a/%2e%2e", "amarchy://chat/a/b%20c", "amarchy://chat/a/%27%3E%3Cscript%3E"] {
            XCTAssertNil(link(bad), bad)
        }
    }

    func testAChatsRoute() {
        XCTAssertEqual(AmarchyLink.route(machine: "omarchy", id: "dots", here: "omarchy"), "/#/s/dots")
        XCTAssertEqual(AmarchyLink.route(machine: "omarchy", id: "dots", here: "amarchy"), "/#/s/omarchy:dots")
        XCTAssertEqual(AmarchyLink.route(machine: "omarchy", id: "dots", here: ""), "/#/s/dots")
    }

    func testAddresses() throws {
        XCTAssertEqual(try Address.parse("amarchy.tail1234.ts.net").absoluteString, "https://amarchy.tail1234.ts.net")
        XCTAssertEqual(try Address.parse(" HTTPS://Amarchy.Tail1234.ts.net:443/x?y#z ").absoluteString, "https://amarchy.tail1234.ts.net")
        XCTAssertEqual(try Address.parse("https://amarchy.tail1234.ts.net:8443").absoluteString, "https://amarchy.tail1234.ts.net:8443")
        XCTAssertEqual(try Address.parse("http://127.0.0.1:7397/").absoluteString, "http://127.0.0.1:7397")
        XCTAssertEqual(try Address.parse("http://localhost:7397").absoluteString, "http://localhost:7397")
        for bad in ["", "   ", "http://amarchy.tail1234.ts.net", "ftp://x", "https://user:pw@x.ts.net", "https://"] {
            XCTAssertThrowsError(try Address.parse(bad), bad) { XCTAssertFalse($0.localizedDescription.isEmpty) }
        }
        XCTAssertEqual(Address.machineName(try Address.parse("amarchy.tail1234.ts.net")), "amarchy")
        XCTAssertEqual(Address.machineName(try Address.parse("http://127.0.0.1:1")), "")
        XCTAssertEqual(Address.origin(try Address.parse("http://127.0.0.1:7397")), "http://127.0.0.1:7397")
        XCTAssertTrue(Address.sameOrigin(URL(string: "https://a.ts.net:443/x")!, URL(string: "https://A.ts.net")!))
        XCTAssertFalse(Address.sameOrigin(URL(string: "https://a.ts.net:8443/")!, URL(string: "https://a.ts.net")!))
        XCTAssertFalse(Address.sameOrigin(URL(string: "http://a.ts.net/")!, URL(string: "https://a.ts.net")!))
    }

    func testThePageToLoadForANotification() throws {
        let server = try Address.parse("amarchy.tail1234.ts.net")
        XCTAssertEqual(Address.page(server, go: "/#/s/fix-login", ask: "fix-login").absoluteString,
                       "https://amarchy.tail1234.ts.net/?ask=fix-login#/s/fix-login")
        XCTAssertEqual(Address.page(server, go: "/#/s/m:x", ask: "m:x").absoluteString, "https://amarchy.tail1234.ts.net/?ask=m:x#/s/m:x")
        XCTAssertEqual(Address.page(server, go: "/#/s/x", ask: nil).absoluteString, "https://amarchy.tail1234.ts.net/#/s/x")
        XCTAssertEqual(Address.page(server, go: nil, ask: nil).absoluteString, "https://amarchy.tail1234.ts.net/")
        XCTAssertEqual(Address.page(server, go: "//evil.example/#/s/x", ask: nil).absoluteString, "https://amarchy.tail1234.ts.net/")
        XCTAssertEqual(Address.page(server, go: "https://evil.example/", ask: nil).absoluteString, "https://amarchy.tail1234.ts.net/")
        XCTAssertEqual(Address.page(server, go: "/", ask: "a b&c").absoluteString, "https://amarchy.tail1234.ts.net/?ask=a%20b%26c")
    }

    func testWhereANavigationGoes() throws {
        let server = try Address.parse("amarchy.tail1234.ts.net")
        let own = URL(fileURLWithPath: "/app/Amarchy.app/dist/index.html")
        func rule(_ s: String, main: Bool = true) -> NavigationRule {
            NavigationRule.decide(URL(string: s)!, mainFrame: main, server: server, ownPage: own)
        }
        XCTAssertEqual(rule("https://amarchy.tail1234.ts.net/#/s/x"), .allow)
        XCTAssertEqual(rule("https://github.com/ja-818/amarchy"), .outside)
        XCTAssertEqual(rule("http://amarchy:3471/"), .outside, "a preview: the browser's")
        XCTAssertEqual(rule("https://www.youtube.com/embed/x", main: false), .allow, "a frame in the page")
        for other in ["tel:+15555550100", "mailto:a@b.c", "googlechrome://github.com", "x-safari-https://github.com",
                      "firefox://open-url?url=https%3A%2F%2Fgithub.com", "microsoft-edge-https://github.com", "brave://open-url?url=x"] {
            XCTAssertEqual(rule(other), .outside, other)
        }
        XCTAssertEqual(rule("amarchy://chat/m/x"), .link(.chat(machine: "m", id: "x")))
        XCTAssertEqual(rule("amarchy://nonsense"), .deny)
        XCTAssertEqual(rule("about:blank"), .allow)
        XCTAssertEqual(NavigationRule.decide(own, mainFrame: true, server: nil, ownPage: own), .allow)
        XCTAssertEqual(NavigationRule.decide(URL(fileURLWithPath: "/app/Amarchy.app/dist/shell.css"), mainFrame: true, server: nil,
                                             ownPage: own), .allow)
        XCTAssertEqual(NavigationRule.decide(URL(fileURLWithPath: "/app/Amarchy.app/distant/x"), mainFrame: true, server: nil,
                                             ownPage: own), .deny)
        XCTAssertEqual(NavigationRule.decide(URL(fileURLWithPath: "/etc/passwd"), mainFrame: true, server: nil, ownPage: own), .deny)
        XCTAssertEqual(NavigationRule.decide(URL(string: "https://amarchy.tail1234.ts.net/")!, mainFrame: true, server: nil, ownPage: own),
                       .outside, "no machine yet: nothing is in the app")
    }
}

final class WidgetStatusTests: XCTestCase {
    func testItsWords() {
        XCTAssertEqual(WidgetStatus(needs: 0, chats: [], machine: nil, at: Date()).words, "Nothing needs you")
        XCTAssertEqual(WidgetStatus(needs: 1, chats: [], machine: nil, at: Date()).words, "1 needs you")
        XCTAssertEqual(WidgetStatus(needs: 2, chats: [], machine: nil, at: Date()).words, "2 need you")
    }

    func testFromThePageAndFromANotification() throws {
        let page: [String: Any] = ["needs": 2, "chats": [["key": "fix-login", "name": "Fix the login", "why": "Asks: Allow?"],
                                                         ["key": "omarchy:dots", "name": "Dots"], ["name": "no key"], "junk"]]
        let s = try XCTUnwrap(WidgetStatus(page: page, machine: "amarchy"))
        XCTAssertEqual(s.needs, 2)
        XCTAssertEqual(s.chats.map(\.key), ["fix-login", "omarchy:dots"])
        XCTAssertEqual(s.link(for: s.chats[0])?.absoluteString, "amarchy://chat/amarchy/fix-login")
        XCTAssertEqual(s.link(for: s.chats[1])?.absoluteString, "amarchy://chat/omarchy/dots")
        XCTAssertNil(s.link(for: WidgetStatus.Chat(key: "a/b", name: "x", why: nil)))
        XCTAssertNil(WidgetStatus(page: "nope", machine: nil))
        XCTAssertEqual(s.waiting(1).chats.map(\.key), ["fix-login"])
        XCTAssertEqual(s.waiting(0).chats, [])
        XCTAssertEqual(s.waiting(5).needs, 5)

        let file = FileManager.default.temporaryDirectory.appendingPathComponent("status-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: file) }
        try s.write(to: file)
        XCTAssertEqual(WidgetStatus.read(from: file).chats, s.chats)
        XCTAssertEqual(WidgetStatus.read(from: file.appendingPathExtension("none")), .empty)
    }
}

final class ShareTests: XCTestCase {
    func testTheFormTheMachineReads() {
        var form = Multipart(boundary: "B")
        form.field("text", "hello\nthere")
        form.file("images", filename: "0.png", type: "image/png", data: Data("PIC".utf8))
        XCTAssertEqual(form.contentType, "multipart/form-data; boundary=B")
        XCTAssertEqual(String(decoding: form.finished, as: UTF8.self),
                       "--B\r\nContent-Disposition: form-data; name=\"text\"\r\n\r\nhello\nthere\r\n"
                       + "--B\r\nContent-Disposition: form-data; name=\"images\"; filename=\"0.png\"\r\nContent-Type: image/png\r\n\r\n"
                       + "PIC\r\n--B--\r\n")
    }

    func testTheInboxKeepsSharesUntilSent() throws {
        let inbox = FileManager.default.temporaryDirectory.appendingPathComponent("inbox-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: inbox) }
        let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3])
        var first = try Inbox.Writer(in: inbox, at: Date(timeIntervalSince1970: 1))
        for _ in 0..<25 { try first.add(image: png) }
        try first.finish(text: "  a link\n ")
        var second = try Inbox.Writer(in: inbox, at: Date(timeIntervalSince1970: 2))
        try second.add(image: Data([0xFF, 0xD8, 0xFF, 0]))
        _ = try Inbox.Writer(in: inbox, at: Date(timeIntervalSince1970: 3))        // still being written
        let pending = Inbox.pending(in: inbox)
        XCTAssertEqual(pending.count, 1, "only finished shares")
        XCTAssertEqual(pending[0].item.images.count, InboxItem.most)
        XCTAssertEqual(pending[0].item.images.first, "0.png")
        XCTAssertEqual(pending[0].item.text, "a link")
        try second.finish(text: nil)
        XCTAssertEqual(Inbox.pending(in: inbox).map(\.item.images), [pending[0].item.images, ["0.jpg"]])

        let body = String(decoding: ShareSender.body(for: pending[0].item, in: pending[0].folder).finished, as: UTF8.self)
        XCTAssertTrue(body.contains("name=\"text\"\r\n\r\na link\r\n"))
        XCTAssertEqual(body.components(separatedBy: "name=\"images\"; filename=").count - 1, InboxItem.most)
        XCTAssertTrue(body.contains("Content-Type: image/png"))
        Inbox.remove(pending[0].folder)
        XCTAssertEqual(Inbox.pending(in: inbox).count, 1)
    }

    func testPictureKinds() {
        XCTAssertEqual(Picture.kind(of: Data([0xFF, 0xD8, 0xFF, 0xE0]))?.mime, "image/jpeg")
        XCTAssertEqual(Picture.kind(of: Data("GIF89a".utf8))?.ext, "gif")
        XCTAssertEqual(Picture.kind(of: Data("RIFF\0\0\0\0WEBPVP8".utf8))?.ext, "webp")
        XCTAssertEqual(Picture.kind(of: Data("\0\0\0\u{18}ftypheic".utf8))?.mime, "image/heic")
        XCTAssertNil(Picture.kind(of: Data("hello".utf8)))
    }
}

/// The bridge's commands, with notifications faked.
@MainActor
final class BridgeTests: XCTestCase {
    final class FakePush: PushBackend {
        var state = "off"
        var subscribed: [(String, String)] = []
        var refuse: String?
        var kept: [String: Any]?

        func state(server: Server) async -> String { state }

        func subscribe(server: Server, key: String) async throws -> [String: Any] {
            if let refuse { throw Net.Failure(errorDescription: refuse) }
            subscribed.append((server.url.absoluteString, key))
            return ["endpoint": "https://relay.example/v1/push/h", "keys": ["p256dh": "P", "auth": "A"]]
        }

        func unsubscribe(server: Server) async -> [String: Any]? { kept }
    }

    final class FakeHost: BridgeHost {
        var cleared: [[String]] = []
        var kept: [WidgetStatus] = []
        func clearNotes(tags: [String]) async { cleared.append(tags) }
        func keep(status: WidgetStatus) { kept.append(status) }
    }

    let server = Server(url: URL(string: "https://amarchy.tail1234.ts.net")!, machine: "amarchy")

    func testItsCommands() async throws {
        let push = FakePush(), host = FakeHost()
        let bridge = Bridge(push: push, host: host)

        var answer = try await bridge.handle("push.state", nil, server: server)
        XCTAssertEqual(answer as? String, "off")
        push.state = "denied"
        answer = try await bridge.handle("push.state", [:], server: server)
        XCTAssertEqual(answer as? String, "denied")

        answer = try await bridge.handle("push.subscribe", ["key": "BKEY"], server: server)
        XCTAssertEqual((answer as? [String: Any])?["endpoint"] as? String, "https://relay.example/v1/push/h")
        XCTAssertEqual(push.subscribed.first?.0, "https://amarchy.tail1234.ts.net")
        XCTAssertEqual(push.subscribed.first?.1, "BKEY")
        await assertRefused(bridge, "push.subscribe", nil, "push.subscribe needs the machine's key")
        push.refuse = "Notifications are off for Amarchy"
        await assertRefused(bridge, "push.subscribe", ["key": "BKEY"], "Notifications are off for Amarchy")

        answer = try await bridge.handle("push.unsubscribe", nil, server: server)
        XCTAssertTrue(answer is NSNull)
        push.kept = ["endpoint": "https://relay.example/v1/push/h"]
        answer = try await bridge.handle("push.unsubscribe", nil, server: server)
        XCTAssertEqual((answer as? [String: Any])?["endpoint"] as? String, "https://relay.example/v1/push/h")

        answer = try await bridge.handle("notes.clear", ["tags": ["a", 3, "", "b"]], server: server)
        XCTAssertTrue(answer is NSNull)
        XCTAssertEqual(host.cleared, [["a", "b"]])

        answer = try await bridge.handle("status", ["needs": 1, "chats": [["key": "x", "name": "X"]]], server: server)
        XCTAssertTrue(answer is NSNull)
        XCTAssertEqual(host.kept.first?.needs, 1)
        XCTAssertEqual(host.kept.first?.machine, "amarchy")
        await assertRefused(bridge, "status", "nope", "status needs {needs, chats}")
        await assertRefused(bridge, "open.sesame", nil, "The app doesn't know open.sesame")
    }

    func assertRefused(_ bridge: Bridge, _ command: String, _ args: Any?, _ words: String,
                       file: StaticString = #filePath, line: UInt = #line) async {
        do {
            _ = try await bridge.handle(command, args, server: server)
            XCTFail("\(command) answered", file: file, line: line)
        } catch {
            XCTAssertEqual(error.localizedDescription, words, file: file, line: line)
        }
    }

    /// A page as WebKit gives it the scripts: its origin, and the message
    /// handlers (each postMessage answering with a promise).
    func page(origin: String, protocol proto: String = "https:") -> JSContext {
        let js = JSContext()!
        js.exceptionHandler = { _, e in XCTFail("JavaScript: \(e?.toString() ?? "?")") }
        js.evaluateScript("""
        var window = globalThis, sent = [], events = [], timers = [];
        var location = { origin: \(String(reflecting: origin)), protocol: \(String(reflecting: proto)), hash: "#/",
                         href: \(String(reflecting: origin)) + "/#/" };
        var document = { readyState: "complete" };
        function CustomEvent(type, init) { this.type = type; this.detail = init.detail; }
        function URL(u, base) { var i = u.indexOf("#"); this.hash = i < 0 ? "" : u.slice(i); }
        window.dispatchEvent = function (e) { events.push(e); };
        window.addEventListener = function () {};
        function setTimeout(f) { timers.push(f); }
        function answer(m, value, words) {
          sent.push(m);
          return m.command === "bad" ? Promise.reject(new Error(words)) : Promise.resolve(m.command === "none" ? undefined : value);
        }
        window.webkit = { messageHandlers: {
          amarchy: { postMessage: function (m) { return answer(m, "on", "no such"); } },
          amarchyShell: { postMessage: function (m) {
            return answer(m, { why: "w", machines: [{ url: "u", name: "n" }], kind: "nothing", label: null }, "words"); } },
        } };
        """)
        return js
    }

    func testThePhoneScriptOnTheMachineOnly() {
        let source = Bridge.script(origin: "https://amarchy.tail1234.ts.net", version: "1.0 (7)", relay: URL(string: "https://relay.example"))
        let js = page(origin: "https://amarchy.tail1234.ts.net")
        js.evaluateScript(source)
        XCTAssertEqual(js.evaluateScript("window.amarchyPhone.platform").toString(), "ios")
        XCTAssertEqual(js.evaluateScript("window.amarchyPhone.version").toString(), "1.0 (7)")
        XCTAssertEqual(js.evaluateScript("window.amarchyPhone.relay").toString(), "https://relay.example")
        js.evaluateScript("""
        window.amarchyPhone.call("push.state").then(function (v) { globalThis.got = v; });
        window.amarchyPhone.call("none").then(function (v) { globalThis.none = v; });
        window.amarchyPhone.call("bad").catch(function (e) { globalThis.err = e instanceof Error ? e.message : "not an Error"; });
        """)
        XCTAssertEqual(js.evaluateScript("JSON.stringify(sent)").toString(),
                       #"[{"command":"push.state","args":null},{"command":"none","args":null},{"command":"bad","args":null}]"#)
        XCTAssertEqual(js.evaluateScript("got").toString(), "on")
        XCTAssertTrue(js.evaluateScript("none").isNull, "the page's null, never undefined")
        XCTAssertEqual(js.evaluateScript("err").toString(), "no such")
        XCTAssertTrue(js.evaluateScript("Object.isFrozen(window.amarchyPhone)").toBool())

        let noRelay = page(origin: "https://amarchy.tail1234.ts.net")
        noRelay.evaluateScript(Bridge.script(origin: "https://amarchy.tail1234.ts.net", version: "1", relay: nil))
        XCTAssertTrue(noRelay.evaluateScript("window.amarchyPhone.relay").isNull)

        let elsewhere = page(origin: "https://evil.example")
        elsewhere.evaluateScript(source)
        XCTAssertEqual(elsewhere.evaluateScript("typeof window.amarchyPhone").toString(), "undefined")
        let own = page(origin: "null", protocol: "file:")
        own.evaluateScript(source)
        XCTAssertEqual(own.evaluateScript("typeof window.amarchyPhone").toString(), "undefined")
    }

    func testTheShellScriptOnTheOwnPageOnly() {
        let js = page(origin: "null", protocol: "file:")
        js.evaluateScript(Bridge.shellScript)
        js.evaluateScript("""
        amarchyShell.invoke("status").then(function (v) { globalThis.got = JSON.stringify(v); });
        amarchyShell.invoke("bad").catch(function (e) { globalThis.err = typeof e === "string" ? e : "not words"; });
        """)
        XCTAssertEqual(js.evaluateScript("got").toString(),
                       #"{"kind":"nothing","label":null,"why":"w","waiting":false,"machines":[{"name":"n","url":"u"}]}"#,
                       "a status's keys in one order, whatever order the app gave them in")
        XCTAssertEqual(js.evaluateScript("err").toString(), "words", "rejected with the words, as the desktop's")
        XCTAssertEqual(js.evaluateScript("JSON.stringify(sent[0])").toString(), #"{"command":"status","args":{}}"#)

        let machine = page(origin: "https://amarchy.tail1234.ts.net")
        machine.evaluateScript(Bridge.shellScript)
        XCTAssertEqual(machine.evaluateScript("typeof window.amarchyShell").toString(), "undefined")
    }

    func testTellingThePage() {
        let js = page(origin: "https://amarchy.tail1234.ts.net")
        js.evaluateScript(Bridge.openScript(go: "/#/s/fix-login", ask: "fix-login", share: false))
        XCTAssertEqual(js.evaluateScript("events[0].type").toString(), "amarchy-open")
        XCTAssertEqual(js.evaluateScript("events[0].detail.go").toString(), "/#/s/fix-login")
        XCTAssertEqual(js.evaluateScript("events[0].detail.ask").toString(), "fix-login")
        XCTAssertEqual(js.evaluateScript("'share' in events[0].detail").toBool(), false)
        // A page that didn't take it: its route all the same.
        js.evaluateScript("timers[0]()")
        XCTAssertEqual(js.evaluateScript("location.hash").toString(), "#/s/fix-login")

        let shared = page(origin: "https://amarchy.tail1234.ts.net")
        shared.evaluateScript(Bridge.openScript(go: nil, ask: nil, share: true))
        XCTAssertEqual(shared.evaluateScript("JSON.stringify(events[0].detail)").toString(), #"{"share":true}"#)
        XCTAssertEqual(shared.evaluateScript("timers.length").toInt32(), 0)
    }

    func testTheOwnPagesStatus() {
        let s = ShellStatus(kind: .failed, label: "amarchy.tail1234.ts.net", why: "It didn't answer")
        XCTAssertEqual(s.json["kind"] as? String, "failed")
        XCTAssertEqual(s.json["label"] as? String, "amarchy.tail1234.ts.net")
        XCTAssertTrue(ShellStatus(kind: .nothing).json["label"] is NSNull)
        XCTAssertTrue(JSONSerialization.isValidJSONObject(s.json))
    }
}
