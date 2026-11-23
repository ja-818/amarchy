// For the UI tests only, and only in a debug build: a fresh start
// (-AmarchyForget), and what the web view's page sees, read through the
// real bridge and shown in a label the test reads (-AmarchyProbe).

#if DEBUG
import UIKit
import WebKit

enum TestHooks {
    static var probing: Bool { ProcessInfo.processInfo.arguments.contains("-AmarchyProbe") }

    static func atLaunch() {
        guard ProcessInfo.processInfo.arguments.contains("-AmarchyForget") else { return }
        let defaults = SharedStore.defaults
        defaults.dictionaryRepresentation().keys.forEach(defaults.removeObject(forKey:))
        try? FileManager.default.removeItem(at: SharedStore.statusFile)
        try? FileManager.default.removeItem(at: SharedStore.inbox)
    }
}

/// The page's view of the app, as JSON in a label: on the machine's page,
/// window.amarchyPhone and what push.state answers through it (and that an
/// unknown command is refused); on the own page, window.amarchyShell and
/// its title.
@MainActor
final class Probe {
    private let label = UILabel()
    private weak var shell: ShellViewController?
    private var runs = 0

    static func attach(to shell: ShellViewController) -> Probe? {
        guard TestHooks.probing else { return nil }
        let probe = Probe()
        probe.shell = shell
        let label = probe.label
        label.accessibilityIdentifier = "probe"
        label.numberOfLines = 0
        label.font = .monospacedSystemFont(ofSize: 9, weight: .regular)
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
        return probe
    }

    static let script = """
    await new Promise((r) => setTimeout(r, delay));
    if (location.protocol === "file:") {
      return JSON.stringify({ page: "own", shell: typeof window.amarchyShell, phone: typeof window.amarchyPhone,
                              title: (document.getElementById("title") || {}).textContent || "" });
    }
    const p = window.amarchyPhone;
    if (!p) return JSON.stringify({ page: "machine", bridge: false, hash: location.hash });
    const state = await p.call("push.state");
    let refused = null;
    try { await p.call("no.such.command"); } catch (e) { refused = String((e && e.message) || e); }
    return JSON.stringify({ page: "machine", bridge: true, platform: p.platform, version: p.version, relay: p.relay,
                            state, refused, hash: location.hash, ua: navigator.userAgent,
                            text: ((document.body && document.body.innerText) || "").slice(0, 400) });
    """

    func run(after seconds: Double) {
        guard let web = shell?.webView else { return }
        runs += 1
        let mine = runs
        web.callAsyncJavaScript(Self.script, arguments: ["delay": seconds * 1000], in: nil, in: .page) { [weak self] result in
            guard let self, mine == self.runs else { return }
            switch result {
            case .success(let value): self.label.text = value as? String ?? "\(value)"
            case .failure(let error): self.label.text = "{\"error\": \"\(error.localizedDescription)\"}"
            }
        }
    }
}
#endif
