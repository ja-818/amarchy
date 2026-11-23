// Notifications as the phone reads them: every vector in
// phone/testdata/push-vectors.json decrypts (the tampered one doesn't), the
// payload's fields, the buttons' categories, the relay's request, the
// subscription the machine is given.

import CryptoKit
import UserNotifications
import XCTest
@testable import Amarchy

final class PushCryptoTests: XCTestCase {
    struct Vector: Decodable {
        var name: String
        var ua_private: String
        var ua_public: String
        var auth: String
        var record: String
        var plaintext: String?
    }

    func vectors() throws -> [Vector] {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "push-vectors", withExtension: "json"))
        struct File: Decodable { var vectors: [Vector] }
        return try JSONDecoder().decode(File.self, from: Data(contentsOf: url)).vectors
    }

    func testEveryVectorDecrypts() throws {
        let all = try vectors()
        XCTAssertGreaterThanOrEqual(all.count, 5)
        XCTAssertTrue(all.contains { $0.plaintext == nil }, "a vector that must fail")
        for v in all {
            let keys = try PushKeys(raw: XCTUnwrap(Data(base64URL: v.ua_private)), auth: XCTUnwrap(Data(base64URL: v.auth)))
            XCTAssertEqual(keys.p256dh, v.ua_public, "\(v.name): the public key from the private one")
            let record = try XCTUnwrap(Data(base64URL: v.record), v.name)
            if let plain = v.plaintext {
                XCTAssertEqual(String(decoding: try PushCrypto.decrypt(record, keys: keys), as: UTF8.self), plain, v.name)
            } else {
                XCTAssertThrowsError(try PushCrypto.decrypt(record, keys: keys), v.name)
            }
        }
    }

    func testOthersKeysAndBrokenRecordsFail() throws {
        let all = try vectors()
        let a = all[1], b = all[2]
        let wrong = try PushKeys(raw: XCTUnwrap(Data(base64URL: b.ua_private)), auth: XCTUnwrap(Data(base64URL: b.auth)))
        let record = try XCTUnwrap(Data(base64URL: a.record))
        XCTAssertThrowsError(try PushCrypto.decrypt(record, keys: wrong))
        let right = try PushKeys(raw: XCTUnwrap(Data(base64URL: a.ua_private)), auth: XCTUnwrap(Data(base64URL: a.auth)))
        XCTAssertThrowsError(try PushCrypto.decrypt(record.prefix(90), keys: right)) { XCTAssertEqual($0 as? PushCrypto.Failure, .short) }
        var badHeader = record
        badHeader[20] = 64
        XCTAssertThrowsError(try PushCrypto.decrypt(badHeader, keys: right)) { XCTAssertEqual($0 as? PushCrypto.Failure, .header) }
        var small = record
        small.replaceSubrange(16..<20, with: [0, 0, 0, 17])
        XCTAssertThrowsError(try PushCrypto.decrypt(small, keys: right)) { XCTAssertEqual($0 as? PushCrypto.Failure, .recordSize) }
    }

    func testTheNotificationsPayloadReadsFromTheVector() throws {
        let v = try vectors()[1]
        let keys = try PushKeys(raw: XCTUnwrap(Data(base64URL: v.ua_private)), auth: XCTUnwrap(Data(base64URL: v.auth)))
        let notice = try XCTUnwrap(Notice(json: PushCrypto.decrypt(XCTUnwrap(Data(base64URL: v.record)), keys: keys)))
        XCTAssertEqual(notice.title, "Fix the login")
        XCTAssertEqual(notice.tag, "houston-os-fix-login")
        XCTAssertEqual(notice.actions.map(\.label), ["Allow", "Deny"])
    }

    func testKeysAreKeptAsTheyWereMade() throws {
        let keys = PushKeys.make()
        XCTAssertEqual(keys.auth.count, 16)
        XCTAssertEqual(Data(base64URL: keys.p256dh)?.count, 65)
        let back = try XCTUnwrap(PushKeys(stored: keys.stored))
        XCTAssertEqual(back.p256dh, keys.p256dh)
        XCTAssertEqual(back.auth, keys.auth)
        XCTAssertNil(PushKeys(stored: Data(count: 10)))
    }

    func testTheKeychainKeepsOneSetOfKeys() throws {
        KeyStore.delete()
        let made: PushKeys
        do {
            made = try KeyStore.loadOrMake()
        } catch {
            throw XCTSkip("No Keychain in this simulator run: \(error.localizedDescription)")
        }
        defer { KeyStore.delete() }
        let again = try KeyStore.loadOrMake()
        XCTAssertEqual(again.p256dh, made.p256dh, "made once, then kept")
        XCTAssertEqual(KeyStore.load()?.auth, made.auth)
        // In the group the notification extension reads, when the build is signed with it.
        if let group = Amarchy.keychainGroup {
            XCTAssertEqual(KeyStore.keptGroup, group)
        }
    }

    /// What the notification extension does with what the relay delivers:
    /// `p` opened with the keys the Keychain keeps.
    func testWhatTheRelayDeliversOpensWithTheKeptKeys() throws {
        let all = try vectors()
        let v = all[1], tampered = try XCTUnwrap(all.first { $0.plaintext == nil })
        let keys = try PushKeys(raw: XCTUnwrap(Data(base64URL: v.ua_private)), auth: XCTUnwrap(Data(base64URL: v.auth)))
        XCTAssertEqual(Notice(delivered: ["p": v.record], keys: keys)?.title, "Fix the login")
        XCTAssertNil(Notice(delivered: ["p": v.record], keys: nil), "no keys: nothing to open it with")
        XCTAssertNil(Notice(delivered: [:], keys: keys))
        XCTAssertNil(Notice(delivered: ["p": "not base64url!"], keys: keys))
        let other = try PushKeys(raw: XCTUnwrap(Data(base64URL: tampered.ua_private)), auth: XCTUnwrap(Data(base64URL: tampered.auth)))
        XCTAssertNil(Notice(delivered: ["p": tampered.record], keys: other), "changed on the way")
        XCTAssertNil(Notice(delivered: ["p": v.record], keys: other), "for another phone")

        KeyStore.delete()
        do {
            try KeyStore.keep(keys)
        } catch {
            throw XCTSkip("No Keychain in this simulator run: \(error.localizedDescription)")
        }
        defer { KeyStore.delete() }
        XCTAssertEqual(Notice(delivered: ["p": v.record], keys: KeyStore.load())?.tag, "houston-os-fix-login")
    }

    /// The app group the app, the extension and the widget share, when the
    /// build is signed with it: the widget's status written there.
    func testTheAppGroupIsShared() throws {
        guard let group = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Amarchy.appGroup) else {
            throw XCTSkip("No app group in this simulator run (an unsigned build)")
        }
        XCTAssertEqual(SharedStore.folder.standardizedFileURL, group.standardizedFileURL)
        let status = WidgetStatus(needs: 1, chats: [.init(key: "x", name: "X", why: nil)], machine: "m", at: Date())
        try status.write()
        defer { try? FileManager.default.removeItem(at: SharedStore.statusFile) }
        XCTAssertEqual(WidgetStatus.read(from: group.appendingPathComponent("status.json")).chats, status.chats)
    }

    func testBase64URL() {
        XCTAssertEqual(Data([0xfb, 0xff]).base64URL, "-_8")
        XCTAssertEqual(Data(base64URL: "-_8"), Data([0xfb, 0xff]))
        XCTAssertEqual(Data(base64URL: "-_8="), Data([0xfb, 0xff]))
        XCTAssertNil(Data(base64URL: "a"))
        XCTAssertEqual(Data([0, 255]).hex, "00ff")
    }
}

final class NoticeTests: XCTestCase {
    func notice(_ json: String) -> Notice? { Notice(json: Data(json.utf8)) }

    func testEveryField() throws {
        let n = try XCTUnwrap(notice("""
        {"title": "Fix the login", "body": "Asks: Allow Bash: npm test?\\nHouston Os", "tag": "houston-os-fix-login",
         "url": "/#/s/houston-os-fix-login", "ask": "houston-os-fix-login", "waiting": 2, "urgent": true,
         "server": "https://amarchy.example.ts.net", "session": "houston-os-fix-login", "sound": "chime",
         "actions": [{"label": "Allow", "path": "/api/session/houston-os-fix-login/answer",
                      "body": {"request_id": "r1", "choice": "allow"}}]}
        """))
        XCTAssertEqual(n.body, "Asks: Allow Bash: npm test?\nHouston Os")
        XCTAssertEqual(n.url, "/#/s/houston-os-fix-login")
        XCTAssertEqual(n.ask, "houston-os-fix-login")
        XCTAssertEqual(n.waiting, 2)
        XCTAssertTrue(n.urgent)
        XCTAssertEqual(n.server?.absoluteString, "https://amarchy.example.ts.net")
        XCTAssertEqual(n.session, "houston-os-fix-login")
        XCTAssertEqual(n.actions.first?.path, "/api/session/houston-os-fix-login/answer")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(n.actions.first?.body)) as? [String: String])
        XCTAssertEqual(body, ["request_id": "r1", "choice": "allow"])
    }

    func testOnlyTheTitleIsNeeded() throws {
        let n = try XCTUnwrap(notice(#"{"title": "Amarchy"}"#))
        XCTAssertNil(n.body)
        XCTAssertNil(n.waiting)
        XCTAssertFalse(n.urgent)
        XCTAssertTrue(n.actions.isEmpty)
        XCTAssertNil(notice(#"{"body": "no title"}"#))
        XCTAssertNil(notice("not json"))
        XCTAssertNil(notice("[1, 2]"))
    }

    func testWhatIsntRightCountsAsMissing() throws {
        let n = try XCTUnwrap(notice("""
        {"title": "t", "waiting": "2", "urgent": "yes", "server": "http://elsewhere.example", "tag": 5,
         "actions": [{"label": "A", "path": "https://evil.example/x"}, {"label": "B", "path": "//evil.example/x"},
                     {"label": "", "path": "/x"}, {"label": "C", "path": "/c"}, {"label": "D", "path": "/d"},
                     {"label": "E", "path": "/e"}, {"label": "F", "path": "/f"}]}
        """))
        XCTAssertNil(n.waiting)
        XCTAssertFalse(n.urgent)
        XCTAssertNil(n.server, "plain http only to the phone itself")
        XCTAssertNil(n.tag)
        XCTAssertEqual(n.actions.map(\.label), ["C", "D", "E"], "the machine's own paths, three at most")
        XCTAssertEqual(n.actions.first?.body, Data("{}".utf8))
        XCTAssertNil(notice(#"{"title": "t", "waiting": true}"#)?.waiting)
        XCTAssertEqual(notice(#"{"title": "t", "waiting": -3}"#)?.waiting, 0)
    }

    func testWhatTheNotificationCarriesForTheApp() throws {
        let n = try XCTUnwrap(notice("""
        {"title": "t", "tag": "x", "url": "/#/s/x", "ask": "x", "server": "https://m.example.ts.net", "session": "x",
         "actions": [{"label": "Ship it", "path": "/api/session/x/send", "body": {"text": "ship it"}}]}
        """))
        let info = n.userInfo
        XCTAssertTrue(PropertyListSerialization.propertyList(info, isValidFor: .binary), "property-list types only")
        let back = try XCTUnwrap(Notice(userInfo: info))
        XCTAssertEqual(back.tag, "x")
        XCTAssertEqual(back.url, "/#/s/x")
        XCTAssertEqual(back.ask, "x")
        XCTAssertEqual(back.server, n.server)
        XCTAssertEqual(back.actions, n.actions)
        XCTAssertNil(Notice(userInfo: ["p": "something else's"]))
    }

    func testItsSound() {
        XCTAssertNil(notice(#"{"title": "t", "sound": "off"}"#)?.notificationSound, "off: silent")
        XCTAssertNotNil(notice(#"{"title": "t"}"#)?.notificationSound)
        XCTAssertNotNil(notice(#"{"title": "t", "sound": "../x"}"#)?.notificationSound)
        XCTAssertNotNil(notice(#"{"title": "t", "sound": "kalimba"}"#)?.notificationSound)
    }
}

final class CategoryTests: XCTestCase {
    func testOnePerSetOfLabelsAlwaysTheSame() {
        XCTAssertEqual(NoticeCategory.id(labels: ["Allow", "Deny"]), "amarchy.831d45751c51925a")
        XCTAssertEqual(NoticeCategory.id(labels: ["Approve"]), "amarchy.6007acbe30b2cd98")
        XCTAssertNotEqual(NoticeCategory.id(labels: ["Deny", "Allow"]), NoticeCategory.id(labels: ["Allow", "Deny"]))
    }

    func testItsButtons() {
        let c = NoticeCategory.make(labels: ["Yes", "No", "Later", "Never"])
        XCTAssertEqual(c.actions.map(\.identifier), ["a0", "a1", "a2"])
        XCTAssertEqual(c.actions.map(\.title), ["Yes", "No", "Later"])
        XCTAssertTrue(c.actions.allSatisfy { $0.options.contains(.authenticationRequired) }, "Face ID on a locked phone")
        XCTAssertFalse(c.actions.contains { $0.options.contains(.foreground) }, "answered without opening the app")
        XCTAssertEqual(c.identifier, NoticeCategory.id(labels: ["Yes", "No", "Later"]))
    }

    func testOnlyTheNewestOfOursAreKept() {
        let other = UNNotificationCategory(identifier: "someone.else", actions: [], intentIdentifiers: [])
        var recent: [String] = []
        var registered: Set<UNNotificationCategory> = [other]
        for i in 0..<(NoticeCategory.kept + 10) {
            registered = NoticeCategory.merged(registered, adding: NoticeCategory.make(labels: ["L\(i)"]), recent: &recent)
        }
        let ours = registered.filter { $0.identifier.hasPrefix(NoticeCategory.prefix) }
        XCTAssertEqual(ours.count, NoticeCategory.kept)
        XCTAssertTrue(registered.contains { $0.identifier == "someone.else" })
        XCTAssertEqual(recent.last, NoticeCategory.id(labels: ["L\(NoticeCategory.kept + 9)"]))
        XCTAssertFalse(ours.contains { $0.identifier == NoticeCategory.id(labels: ["L0"]) }, "the oldest went")
        // The same labels again: one category, the newest.
        let again = NoticeCategory.merged(registered, adding: NoticeCategory.make(labels: ["L12"]), recent: &recent)
        XCTAssertEqual(again.filter { $0.identifier == NoticeCategory.id(labels: ["L12"]) }.count, 1)
        XCTAssertEqual(recent.last, NoticeCategory.id(labels: ["L12"]))
    }
}

@MainActor
final class RelayTests: XCTestCase {
    func testTheRegisterRequest() throws {
        let relay = try XCTUnwrap(URL(string: "https://relay.example"))
        let r = Relay.registerRequest(relay: relay, token: "ab12", serverKey: "KEY")
        XCTAssertEqual(r.url?.absoluteString, "https://relay.example/v1/register")
        XCTAssertEqual(r.httpMethod, "POST")
        XCTAssertEqual(r.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertNil(r.value(forHTTPHeaderField: "Origin"))
        XCTAssertEqual(r.timeoutInterval, 15)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(r.httpBody)) as? [String: String])
        XCTAssertEqual(body, ["platform": "apns-sandbox", "token": "ab12", "app": "io.github.ja818.amarchy", "server_key": "KEY"],
                       "a debug build gets development tokens")
    }

    func testItsAnswer() throws {
        XCTAssertEqual(try Relay.endpoint(from: Data(#"{"endpoint": "https://relay.example/v1/push/h"}"#.utf8)),
                       "https://relay.example/v1/push/h")
        XCTAssertThrowsError(try Relay.endpoint(from: Data(#"{"endpoint": "http://relay.example/x"}"#.utf8)))
        XCTAssertThrowsError(try Relay.endpoint(from: Data(#"{"error": "no"}"#.utf8)))
    }

    func testTheSubscriptionTheMachineIsGiven() throws {
        let keys = PushKeys.make()
        let sub = PushService.subscription(endpoint: "https://relay.example/v1/push/h", keys: keys)
        XCTAssertEqual(sub["endpoint"] as? String, "https://relay.example/v1/push/h")
        let k = try XCTUnwrap(sub["keys"] as? [String: String])
        XCTAssertEqual(Data(base64URL: k["p256dh"] ?? "")?.count, 65)
        XCTAssertEqual(Data(base64URL: k["auth"] ?? "")?.count, 16)
        let app = try XCTUnwrap(sub["app"] as? [String: String])
        XCTAssertEqual(app["platform"], "ios")
        XCTAssertEqual(app["version"], Amarchy.version)
        XCTAssertFalse(app["device"]?.isEmpty ?? true)
        XCTAssertTrue(JSONSerialization.isValidJSONObject(sub))
    }

    func testWithoutARelayNotificationsAreUnsupported() async throws {
        XCTAssertNil(Amarchy.relay, "this test build has no AMARCHY_RELAY")
        let server = Server(url: try XCTUnwrap(URL(string: "https://m.example.ts.net")), machine: "m")
        let state = await PushService.shared.state(server: server)
        XCTAssertEqual(state, "unsupported")
        do {
            _ = try await PushService.shared.subscribe(server: server, key: String(repeating: "A", count: 87))
            XCTFail("subscribed without a relay")
        } catch {
            XCTAssertEqual(error.localizedDescription, "Notifications aren't in this build of the app")
        }
    }
}
