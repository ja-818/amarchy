// The app's own requests (a machine's hello, a button's answer, the share
// sheet's upload, the relay): one URLSession, through amarchy's own node's
// proxy when that's how this phone reaches the tailnet, and every failure
// said in plain words.

import Foundation
import Network

enum Net {
    private static var proxied: URLSession?

    static var session: URLSession { proxied ?? .shared }

    /// The own node's proxy on the app's requests (nil: straight, as the
    /// Tailscale app's VPN carries them).
    static func use(proxy: ProxySettings?) {
        proxied?.invalidateAndCancel()
        guard let proxy else {
            proxied = nil
            return
        }
        let config = URLSessionConfiguration.default
        config.proxyConfigurations = [proxy.configuration]
        proxied = URLSession(configuration: config)
    }

    struct Failure: LocalizedError {
        var status: Int?
        var errorDescription: String?
    }

    static func request(_ url: URL, method: String = "GET", json: Data? = nil, origin: URL? = nil,
                        timeout: TimeInterval) -> URLRequest {
        var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        r.httpMethod = method
        if let json {
            r.httpBody = json
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        // A write to a machine is the app's own, as its page's would be.
        if let origin { r.setValue(Address.origin(origin), forHTTPHeaderField: "Origin") }
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        return r
    }

    /// The answer, or what went wrong in words: a status that isn't 2xx is
    /// a Failure with the server's own `error`, when it says one.
    static func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let data: Data, response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw Failure(errorDescription: words(for: error, host: request.url?.host ?? "it"))
        }
        guard let http = response as? HTTPURLResponse else { throw Failure(errorDescription: "\(request.url?.host ?? "It") didn't answer as a web server") }
        guard (200..<300).contains(http.statusCode) else {
            let said = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw Failure(status: http.statusCode, errorDescription: said ?? "\(request.url?.host ?? "It") said \(http.statusCode)")
        }
        return (data, http)
    }

    static func postJSON(_ url: URL, _ body: Data, origin: URL, timeout: TimeInterval = 20) async throws -> Data {
        try await send(request(url, method: "POST", json: body, origin: origin, timeout: timeout)).0
    }

    /// A request's failure as the person can act on it.
    static func words(for error: Error, host: String) -> String {
        let vpn = TailscaleVPN.isUp
        guard let e = error as? URLError else { return error.localizedDescription }
        switch e.code {
        case .cannotFindHost, .dnsLookupFailed:
            return vpn ? "This phone can't find \(host): is that the address Settings, Phone app, shows?"
                : "This phone can't find \(host): turn on the Tailscale app's VPN, then try again"
        case .timedOut:
            return vpn ? "\(host) didn't answer in time: is that machine on?"
                : "\(host) didn't answer in time: turn on the Tailscale app's VPN, then try again"
        case .cannotConnectToHost, .networkConnectionLost:
            return "\(host) didn't answer: is amarchy running there?"
        case .notConnectedToInternet, .dataNotAllowed, .internationalRoamingOff:
            return "This phone is offline"
        case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate,
             .serverCertificateNotYetValid, .serverCertificateHasUnknownRoot, .clientCertificateRejected:
            return "\(host) answered without a certificate this phone trusts: use the address Settings, Phone app, shows"
        case .appTransportSecurityRequiresSecureConnection:
            return "\(host) needs its https:// address"
        case .cancelled:
            return "Stopped before \(host) answered"
        default:
            return e.localizedDescription
        }
    }
}

/// The own node's proxy, "http://amarchy:<secret>@127.0.0.1:<port>", for
/// the web view and the app's requests, only to tailnet names.
struct ProxySettings: Equatable {
    var host: String
    var port: UInt16
    var user: String
    var password: String

    init?(_ text: String) {
        guard let u = URLComponents(string: text), u.scheme == "http", let host = u.host, let port = u.port,
              let p = UInt16(exactly: port) else { return nil }
        self.host = host
        self.port = p
        user = u.user ?? ""
        password = u.password ?? ""
    }

    var configuration: ProxyConfiguration {
        let endpoint = NWEndpoint.hostPort(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: port) ?? 1080)
        var config = ProxyConfiguration(httpCONNECTProxy: endpoint, tlsOptions: nil)
        config.matchDomains = ["ts.net"]
        if !user.isEmpty { config.applyCredential(username: user, password: password) }
        return config
    }
}

/// Whether the Tailscale app's VPN is on: an interface utun… with an
/// address in Tailscale's range (100.64.0.0/10).
enum TailscaleVPN {
    static var isUp: Bool {
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return false }
        defer { freeifaddrs(list) }
        for ifa in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let name = String(cString: ifa.pointee.ifa_name)
            guard name.hasPrefix("utun"), let addr = ifa.pointee.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET) else { continue }
            let ip = addr.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { UInt32(bigEndian: $0.pointee.sin_addr.s_addr) }
            if inTailnet(ip) { return true }
        }
        return false
    }

    /// 100.64.0.0/10, as a host-order IPv4 address.
    static func inTailnet(_ ip: UInt32) -> Bool {
        ip >> 22 == (100 << 2 | 64 >> 6)
    }
}
