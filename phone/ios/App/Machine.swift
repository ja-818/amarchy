// Which amarchy the app opens, and whether it answers (phone/README.md,
// "Reaching your machine"): the address kept (the last that answered),
// one typed on its own page or given by a link, each asked
// GET /api/peer/hello first. What its own page shows while it isn't
// showing amarchy is `Connection.status`.

import Foundation

/// A machine the app opens: its origin, and its name (for a chat's link).
struct Server: Codable, Equatable {
    var url: URL
    var machine: String

    static let keptKey = "server"

    /// The last one that answered.
    static var kept: Server? {
        get { SharedStore.defaults.data(forKey: keptKey).flatMap { try? JSONDecoder().decode(Server.self, from: $0) } }
        set {
            if let newValue, let data = try? JSONEncoder().encode(newValue) {
                SharedStore.defaults.set(data, forKey: keptKey)
            } else {
                SharedStore.defaults.removeObject(forKey: keptKey)
            }
        }
    }
}

enum Hello {
    /// The machine's name when an amarchy answers at url, else why not.
    static func check(_ url: URL) async -> Result<String, Net.Failure> {
        let host = url.host ?? "it"
        let request = Net.request(url.appendingPathComponent("api/peer/hello"), timeout: 5)
        do {
            let (data, _) = try await Net.send(request)
            guard let hello = try? JSONSerialization.jsonObject(with: data) as? [String: Any], hello["protocol"] != nil else {
                return .failure(Net.Failure(errorDescription: "\(host) answers, but it isn't an amarchy"))
            }
            let name = (hello["name"] as? String).flatMap { AmarchyLink.okPart($0, most: 63) ? $0 : nil }
            return .success(name ?? Address.machineName(url))
        } catch let failure as Net.Failure {
            if failure.status == 403 {
                return .failure(Net.Failure(status: 403, errorDescription: "\(host) is an amarchy, but not yours (it said: \(failure.errorDescription ?? "no"))"))
            }
            if failure.status == 404 {
                return .failure(Net.Failure(status: 404, errorDescription: "\(host) answers, but it isn't an amarchy (or it's too old: update it)"))
            }
            return .failure(failure)
        } catch {
            return .failure(Net.Failure(errorDescription: error.localizedDescription))
        }
    }
}

/// The own page's state, as `window.amarchyShell.invoke("status")` gives
/// it to desktop/dist/shell.js.
struct ShellStatus: Equatable {
    enum Kind: String { case opening, choose, nothing, failed, signin }

    var kind: Kind
    var label: String?
    var why: String?
    var machines: [[String: String]] = []
    var waiting = false

    var json: [String: Any] {
        var d: [String: Any] = ["kind": kind.rawValue, "machines": machines, "waiting": waiting]
        d["label"] = label ?? NSNull()
        d["why"] = why ?? NSNull()
        return d
    }
}

/// Finding the machine: what the own page shows until one answers, and the
/// one to open when it does.
@MainActor
final class Connection {
    /// What the own page shows; while amarchy's own node waits to be signed
    /// in, its sign-in instead of "can't find it".
    var status: ShellStatus {
        if base.kind == .nothing || base.kind == .failed, let signin = node.signinStatus { return signin }
        return base
    }

    /// The address being tried, or the last that didn't answer (Try again).
    private(set) var trying: URL?
    /// Called with a machine that answered: the shell opens it.
    var onOpen: @MainActor (Server) -> Void = { _ in }
    /// The own node, when this build has one (used when the Tailscale app's VPN isn't on).
    let node: OwnNodeLink
    private var base = ShellStatus(kind: .opening)
    private var choices: [Server] = []
    private var attempt = 0

    init(node: OwnNodeLink = OwnNodeLink()) {
        self.node = node
    }

    func start() {
        if let kept = Server.kept {
            reach(kept.url)
        } else {
            nothing()
        }
    }

    func retry() {
        if let url = trying ?? Server.kept?.url {
            reach(url)
        } else {
            nothing()
        }
    }

    /// An address typed on the own page; a wrong one says why, at once.
    func use(address raw: String) throws {
        reach(try Address.parse(raw))
    }

    /// One of the machines the own node found.
    func choose(name: String) throws {
        guard let server = choices.first(where: { $0.machine == name }) else {
            throw Net.Failure(errorDescription: "\(name) isn't one of those any more: try again")
        }
        reach(server.url)
    }

    /// The machine's page didn't load after all (its hello did): why, on the own page.
    func failed(_ url: URL, why: String) {
        attempt += 1
        trying = url
        base = unreachable(url, why: why)
    }

    func reach(_ url: URL) {
        attempt += 1
        let mine = attempt
        trying = url
        base = ShellStatus(kind: .opening, label: url.host)
        Task {
            let result = await Hello.check(url)
            guard mine == attempt else { return }       // a newer one was asked for since
            switch result {
            case .success(let name):
                let server = Server(url: url, machine: name)
                Server.kept = server
                trying = nil
                onOpen(server)
            case .failure(let failure):
                base = unreachable(url, why: failure.errorDescription ?? "It didn't answer")
                startNode()
            }
        }
    }

    private func nothing() {
        attempt += 1
        trying = nil
        let vpn = TailscaleVPN.isUp
        base = ShellStatus(kind: .nothing, why: vpn
            ? "Type its address below: Settings, Phone app, in amarchy has a link that opens it here."
            : "Turn on the Tailscale app's VPN, then type your amarchy's address below (Settings, Phone app, in amarchy has a link that opens it here).")
        startNode()
    }

    /// `failed` (the address didn't answer), or `nothing` when the
    /// Tailscale app's VPN is off: then turning it on is the thing to do.
    private func unreachable(_ url: URL, why: String) -> ShellStatus {
        ShellStatus(kind: TailscaleVPN.isUp || Address.isLoopback(url.host ?? "") ? .failed : .nothing,
                    label: url.host, why: why)
    }

    /// Without the Tailscale app's VPN, amarchy's own node (when the build
    /// has it): once it's on the tailnet, the address again, or the
    /// machines it finds there.
    private func startNode() {
        guard !TailscaleVPN.isUp else { return }
        node.startIfAvailable { [weak self] in self?.nodeRunning() }
    }

    private func nodeRunning() {
        if let url = trying ?? Server.kept?.url {
            reach(url)
            return
        }
        attempt += 1
        let mine = attempt
        base = ShellStatus(kind: .opening, label: "your tailnet")
        Task {
            let found = await node.machines()
            guard mine == attempt else { return }
            choices = found
            switch found.count {
            case 0:
                base = ShellStatus(kind: .nothing, why: "No amarchy of yours answers on your tailnet: type its address below.")
            case 1:
                reach(found[0].url)
            default:
                base = ShellStatus(kind: .choose, machines: found.map {
                    ["name": $0.machine, "label": $0.url.host ?? $0.machine, "url": $0.url.absoluteString]
                })
            }
        }
    }
}
