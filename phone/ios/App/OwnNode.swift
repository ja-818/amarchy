// amarchy's own Tailscale node in the app (tailnet/mobile, a gomobile
// framework: phone/ios/Frameworks/Tailnet.xcframework), for a phone without
// the Tailscale app's VPN on: it signs in on its own page ("Sign in to
// Tailscale"), finds your machines on the tailnet, and carries the web
// view's and the app's requests to them through its proxy on 127.0.0.1.
// A build without the framework simply has none (OwnNodeLink.node is nil).

import AuthenticationServices
import Foundation
import WebKit
#if canImport(Tailnet)
import Tailnet
#endif

/// What the app needs of a node (the framework's Go API). Its calls may
/// take seconds: never on the main thread.
protocol OwnNode: AnyObject, Sendable {
    func start(dir: String, hostname: String) throws
    func stop()
    /// `{"state", "words", "login_url", "self", "peers": [{"name", "dns", "online"}]}`
    func stateJSON() -> String
    /// Tailscale's sign-in page, or "" when it's signed in already.
    func loginURL() throws -> String
    /// "http://amarchy:<secret>@127.0.0.1:<port>", or "" while it isn't up.
    func proxyURL() -> String
}

struct NodeState: Decodable, Equatable {
    struct Peer: Decodable, Equatable {
        var name: String
        var dns: String?
        var online: Bool?
    }

    var state: String
    var words: String?
    var login_url: String?
    var peers: [Peer]?

    var running: Bool { state == "Running" }
    var needsLogin: Bool { state == "NeedsLogin" || (login_url ?? "").isEmpty == false }

    static func parse(_ json: String) -> NodeState? {
        try? JSONDecoder().decode(NodeState.self, from: Data(json.utf8))
    }
}

#if canImport(Tailnet)
/// The gomobile framework's functions (package mobile: MobileStart...).
final class TailnetNode: OwnNode, @unchecked Sendable {
    func start(dir: String, hostname: String) throws {
        var error: NSError?
        if !MobileStart(dir, hostname, &error) {
            throw error.map { $0 as Error } ?? Net.Failure(errorDescription: "amarchy's own node didn't start")
        }
    }

    func stop() { MobileStop() }
    func stateJSON() -> String { MobileState() }

    func loginURL() throws -> String {
        var error: NSError?
        let url = MobileLoginURL(&error)
        if let error { throw error }
        return url
    }

    func proxyURL() -> String { MobileProxyURL() }
}
#endif

/// The node as the connection uses it: started when the VPN isn't on, its
/// sign-in, its proxy set where the app's requests go, its machines found.
@MainActor
final class OwnNodeLink: NSObject, ASWebAuthenticationPresentationContextProviding {
    let node: OwnNode?
    private(set) var state: NodeState?
    private var started = false
    private var signingIn: ASWebAuthenticationSession?
    private var onRunning: @MainActor () -> Void = {}
    private var poll: Task<Void, Never>?
    private var proxied = false

    init(node: OwnNode? = OwnNodeLink.builtIn()) {
        self.node = node
    }

    nonisolated static func builtIn() -> OwnNode? {
        #if DEBUG
        // The UI tests of the flows without it, in a build that has it.
        if ProcessInfo.processInfo.arguments.contains("-AmarchyNoOwnNode") { return nil }
        #endif
        #if canImport(Tailnet)
        return TailnetNode()
        #else
        return nil
        #endif
    }

    /// The own page's sign-in, while the node waits for it.
    var signinStatus: ShellStatus? {
        guard let state, !state.running, state.needsLogin else { return nil }
        return ShellStatus(kind: .signin, why: "This phone reaches your amarchy through Tailscale, with amarchy's own node "
                           + "(no Tailscale app needed). Sign in with the Tailscale account your other machines use.",
                           waiting: signingIn != nil)
    }

    func startIfAvailable(onRunning: @escaping @MainActor () -> Void) {
        guard let node else { return }
        self.onRunning = onRunning
        guard !started else { return }
        started = true
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("tailnet", isDirectory: true)
        poll = Task { [weak self] in
            let up: Bool = await Task.detached {
                try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                return (try? node.start(dir: dir.path, hostname: "amarchy-iphone")) != nil
            }.value
            guard up else {
                self?.started = false       // tried again the next time it's needed
                return
            }
            while !Task.isCancelled, self != nil {
                let json = await Task.detached { node.stateJSON() }.value
                await self?.took(NodeState.parse(json))
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
    }

    private func took(_ now: NodeState?) async {
        guard let node, let now else { return }
        state = now
        guard now.running, !proxied else { return }
        // On the tailnet: its proxy where the app's requests go (once it has one).
        let text = await Task.detached { node.proxyURL() }.value
        guard let proxy = ProxySettings(text) else { return }
        WKWebsiteDataStore.default().proxyConfigurations = [proxy.configuration]
        Net.use(proxy: proxy)
        proxied = true
        signingIn?.cancel()
        signingIn = nil
        onRunning()
    }

    /// The own page's Sign in to Tailscale: Tailscale's login page, in the
    /// system's browser sheet; the node sees it done.
    func signIn() async throws {
        guard let node else { throw Net.Failure(errorDescription: "This build signs in through the Tailscale app: turn its VPN on") }
        let text = try await Task.detached { try node.loginURL() }.value
        if text.isEmpty { return }      // signed in already: its state says so next
        guard let url = URL(string: text), url.scheme == "https" else {
            throw Net.Failure(errorDescription: "Tailscale didn't give a sign-in page: try again in a moment")
        }
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: nil) { [weak self] _, _ in
            Task { @MainActor in self?.signingIn = nil }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        signingIn = session
        if !session.start() {
            signingIn = nil
            throw Net.Failure(errorDescription: "The sign-in page didn't open: try again")
        }
    }

    /// Your machines on the tailnet that answer as amarchy (each peer's hello).
    func machines() async -> [Server] {
        guard let peers = state?.peers else { return [] }
        var found: [Server] = []
        for peer in peers where peer.online != false {
            guard let dns = peer.dns?.trimmingCharacters(in: CharacterSet(charactersIn: ".")), !dns.isEmpty,
                  let url = try? Address.parse(dns) else { continue }
            if case .success(let name) = await Hello.check(url) { found.append(Server(url: url, machine: name)) }
        }
        return found
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
        }
    }
}
