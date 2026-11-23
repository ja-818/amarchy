// Notifications on (phone/README.md, "Notifications", step 1): the system's
// permission, the APNs token, the phone's keys (made once, in the Keychain
// the extension shares), registered with the relay, and kept, so a new
// token registers again and tells each machine itself.

import UIKit
import UserNotifications

/// What the bridge asks of notifications (a fake one in the tests).
@MainActor
protocol PushBackend: AnyObject {
    func state(server: Server) async -> String
    func subscribe(server: Server, key: String) async throws -> [String: Any]
    func unsubscribe(server: Server) async -> [String: Any]?
}

enum Relay {
    /// Xcode's runs get development tokens; TestFlight's and the App Store's production ones.
    static var platform: String {
        #if DEBUG
        return "apns-sandbox"
        #else
        return "apns"
        #endif
    }

    /// POST <relay>/v1/register {"platform", "token", "app", "server_key"}.
    static func registerRequest(relay: URL, token: String, serverKey: String,
                                platform: String = Relay.platform, app: String = Amarchy.bundleID) -> URLRequest {
        let body: [String: String] = ["platform": platform, "token": token, "app": app, "server_key": serverKey]
        let json = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
        return Net.request(relay.appendingPathComponent("v1/register"), method: "POST", json: json, timeout: 15)
    }

    /// Its answer's `endpoint` (the relay's own https address), or why not.
    static func endpoint(from data: Data) throws -> String {
        guard let d = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let endpoint = d["endpoint"] as? String, endpoint.hasPrefix("https://") else {
            throw Net.Failure(errorDescription: "The push relay answered without an address to send to")
        }
        return endpoint
    }

    static func register(token: String, serverKey: String) async throws -> String {
        guard let relay = Amarchy.relay else { throw Net.Failure(errorDescription: "Notifications aren't in this build of the app") }
        do {
            let (data, _) = try await Net.send(registerRequest(relay: relay, token: token, serverKey: serverKey))
            return try endpoint(from: data)
        } catch let failure as Net.Failure where failure.status == 429 {
            throw Net.Failure(status: 429, errorDescription: "The push relay is busy: try again in a minute")
        } catch let failure as Net.Failure where failure.status != nil {
            throw Net.Failure(status: failure.status, errorDescription: "The push relay said: \(failure.errorDescription ?? "no")")
        }
    }
}

/// A machine's subscription, as this phone keeps it.
struct PushSubscription: Codable, Equatable {
    var server: URL
    /// The machine's VAPID key (its /api/state `key`).
    var key: String
    var endpoint: String
    /// The APNs token it was registered with.
    var token: String
}

@MainActor
final class PushService: PushBackend {
    static let shared = PushService()
    static let keptKey = "push.subscriptions"

    private var waiting: [UUID: CheckedContinuation<String, Error>] = [:]
    private var refreshing = false

    var kept: [PushSubscription] {
        get {
            SharedStore.defaults.data(forKey: Self.keptKey)
                .flatMap { try? JSONDecoder().decode([PushSubscription].self, from: $0) } ?? []
        }
        set { SharedStore.defaults.set(try? JSONEncoder().encode(newValue), forKey: Self.keptKey) }
    }

    func state(server: Server) async -> String {
        guard Amarchy.relay != nil else { return "unsupported" }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .denied: return "denied"
        case .authorized, .provisional, .ephemeral:
            return kept.contains { Address.sameOrigin($0.server, server.url) } && KeyStore.load() != nil ? "on" : "off"
        default: return "off"
        }
    }

    func subscribe(server: Server, key: String) async throws -> [String: Any] {
        guard Amarchy.relay != nil else { throw Net.Failure(errorDescription: "Notifications aren't in this build of the app") }
        guard let raw = Data(base64URL: key), raw.count == 65, raw.first == 4 else {
            throw Net.Failure(errorDescription: "That isn't a notification key (the machine's is 65 bytes, base64url)")
        }
        // Asked while it's still the tap that turned them on.
        let center = UNUserNotificationCenter.current()
        let allowed = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        guard allowed else {
            throw Net.Failure(errorDescription: "Notifications are off for Amarchy: turn them on in the iPhone's Settings, Notifications, Amarchy")
        }
        let token = try await deviceToken()
        let keys = try KeyStore.loadOrMake()
        let endpoint = try await Relay.register(token: token, serverKey: key)
        var subs = kept.filter { !Address.sameOrigin($0.server, server.url) }
        subs.append(PushSubscription(server: server.url, key: key, endpoint: endpoint, token: token))
        kept = subs
        return Self.subscription(endpoint: endpoint, keys: keys)
    }

    func unsubscribe(server: Server) async -> [String: Any]? {
        guard let sub = kept.first(where: { Address.sameOrigin($0.server, server.url) }) else { return nil }
        kept = kept.filter { $0 != sub }
        return ["endpoint": sub.endpoint]
    }

    /// What `push.subscribe` answers and POST /api/push takes: a browser's
    /// subscription, and the app it is.
    static func subscription(endpoint: String, keys: PushKeys) -> [String: Any] {
        ["endpoint": endpoint,
         "keys": ["p256dh": keys.p256dh, "auth": keys.authText],
         "app": ["platform": "ios", "version": Amarchy.version,
                 "device": "\(UIDevice.current.model) (iOS \(UIDevice.current.systemVersion))"]]
    }

    // MARK: The APNs token

    private func deviceToken() async throws -> String {
        let id = UUID()
        return try await withCheckedThrowingContinuation { c in
            waiting[id] = c
            UIApplication.shared.registerForRemoteNotifications()
            Task {
                try? await Task.sleep(nanoseconds: 20_000_000_000)
                self.waiting.removeValue(forKey: id)?.resume(throwing: Net.Failure(
                    errorDescription: "Apple's push service didn't give this phone a token in time: is it online?"))
            }
        }
    }

    private func resume(_ result: Result<String, Error>) {
        let all = waiting.values
        waiting = [:]
        all.forEach { $0.resume(with: result) }
    }

    /// At launch: the token again, when there's a subscription it may have changed for.
    func launch() {
        guard Amarchy.relay != nil, !kept.isEmpty else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    func didRegister(_ token: Data) {
        let hex = token.hex
        resume(.success(hex))
        Task { await refresh(token: hex) }
    }

    func didFail(_ error: Error) {
        resume(.failure(Net.Failure(errorDescription: "Apple's push service didn't give this phone a token: \(error.localizedDescription)")))
    }

    /// A new token: each machine's subscription registered again with the
    /// relay, and that machine told itself (the new one, then the old one
    /// removed). One that fails is tried again at the next launch.
    func refresh(token: String) async {
        guard !refreshing, let keys = KeyStore.load() else { return }
        refreshing = true
        defer { refreshing = false }
        for sub in kept where sub.token != token {
            do {
                let endpoint = try await Relay.register(token: token, serverKey: sub.key)
                let new = Self.subscription(endpoint: endpoint, keys: keys)
                let push = sub.server.appendingPathComponent("api/push")
                _ = try await Net.postJSON(push, JSONSerialization.data(withJSONObject: new), origin: sub.server)
                if endpoint != sub.endpoint {
                    let old = try JSONSerialization.data(withJSONObject: ["endpoint": sub.endpoint])
                    _ = try? await Net.postJSON(sub.server.appendingPathComponent("api/push/remove"), old, origin: sub.server)
                }
                kept = kept.map { $0 == sub ? PushSubscription(server: sub.server, key: sub.key, endpoint: endpoint, token: token) : $0 }
            } catch {
                continue
            }
        }
    }
}
