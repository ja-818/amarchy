// For the UI tests only, and only in a debug build: a fresh start
// (-AmarchyForget), the flows without the own node in a build that has it
// (-AmarchyNoOwnNode, OwnNodeLink.builtIn), and what the web view's page
// sees, read through the real bridge and shown in a label the test reads,
// with the app's last steps (-AmarchyProbe).

import UIKit
import WebKit

/// A step of the app's, for the UI tests' probe (nothing in a release build).
@MainActor
func trace(_ step: @autoclosure () -> String) {
    #if DEBUG
    TestHooks.steps.append(step())
    if TestHooks.steps.count > 14 { TestHooks.steps.removeFirst() }
    #endif
}

#if DEBUG
@MainActor
enum TestHooks {
    static var steps: [String] = []
    static var probing: Bool { ProcessInfo.processInfo.arguments.contains("-AmarchyProbe") }

    static func atLaunch() {
        guard ProcessInfo.processInfo.arguments.contains("-AmarchyForget") else { return }
        let defaults = SharedStore.defaults
        defaults.dictionaryRepresentation().keys.forEach(defaults.removeObject(forKey:))
        try? FileManager.default.removeItem(at: SharedStore.statusFile)
        try? FileManager.default.removeItem(at: SharedStore.inbox)
    }
}

/// The page's view of the app, as JSON in a label, every 1.5 seconds and
/// after each load: on the machine's page, window.amarchyPhone and what
/// push.state answers through it (and that an unknown command is refused);
/// on the own page, window.amarchyShell and its title; and the app's side
/// (its own page's status, its last steps).
@MainActor
final class Probe {
    private let label = UILabel()
    private weak var shell: ShellViewController?
    private var runs = 0
    private var timer: Timer?

    static func attach(to shell: ShellViewController) -> Probe? {
        guard TestHooks.probing else { return nil }
        let probe = Probe()
        probe.shell = shell
        let label = probe.label
        label.accessibilityIdentifier = "probe"
        label.numberOfLines = 0
        label.font = .monospacedSystemFont(ofSize: 8, weight: .regular)
        label.textColor = .white
        label.backgroundColor = UIColor.black.withAlphaComponent(0.6)
        label.text = "{}"
        label.translatesAutoresizingMaskIntoConstraints = false
        shell.view.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: shell.view.leadingAnchor),
            label.trailingAnchor.constraint(equalTo: shell.view.trailingAnchor),
            label.bottomAnchor.constraint(equalTo: shell.view.safeAreaLayoutGuide.bottomAnchor),
        ])
        probe.timer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak probe] _ in
            MainActor.assumeIsolated { probe?.run(after: 0) }
        }
        return probe
    }

    static let script = """
    await new Promise((r) => setTimeout(r, delay));
    let page;
    if (location.protocol === "file:") {
      page = { page: "own", shell: typeof window.amarchyShell, phone: typeof window.amarchyPhone,
               title: (document.getElementById("title") || {}).textContent || "" };
    } else if (!window.amarchyPhone) {
      page = { page: "machine", bridge: false, hash: location.hash };
    } else {
      const p = window.amarchyPhone;
      const state = await p.call("push.state");
      let refused = null;
      try { await p.call("no.such.command"); } catch (e) { refused = String((e && e.message) || e); }
      page = { page: "machine", bridge: true, platform: p.platform, version: p.version, relay: p.relay,
               state, refused, hash: location.hash, ua: navigator.userAgent,
               text: ((document.body && document.body.innerText) || "").slice(0, 300) };
    }
    return JSON.stringify(Object.assign(page, { app: native }));
    """

    func run(after seconds: Double) {
        guard let shell, let web = shell.webView else { return }
        runs += 1
        let mine = runs
        let status = shell.connection.status
        let native: [String: Any] = ["status": status.kind.rawValue, "why": status.why ?? "", "ownNode": shell.connection.node.node != nil,
                                     "server": shell.server?.url.absoluteString ?? "", "steps": TestHooks.steps]
        web.callAsyncJavaScript(Self.script, arguments: ["delay": seconds * 1000, "native": native], in: nil, in: .page) { [weak self] result in
            guard let self, mine == self.runs else { return }
            switch result {
            case .success(let value): self.label.text = value as? String ?? "\(value)"
            case .failure(let error): self.label.text = "{\"error\": \"\(error.localizedDescription)\", \"steps\": \"\(TestHooks.steps)\"}"
            }
        }
    }
}
#endif
