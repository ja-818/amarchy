// The app: one web view on the machine's app (app/, served by your
// amarchy), or on its own page (desktop/dist, from the bundle) while it
// isn't showing amarchy. Pages of the machine's origin stay in it; anything
// else goes to the system (Safari, another browser by its scheme, the
// phone, mail). Never a second UI: everything a person sees is a page.

import UIKit
import WebKit

/// Something to show: a route (`go`, "/#/s/<key>"), a chat's card (`ask`),
/// what was just shared; on `server` when it's another machine's.
struct OpenRequest: Equatable {
    var go: String?
    var ask: String?
    var share = false
    var server: URL?
}

/// Where a navigation goes (a pure rule, tested).
enum NavigationRule: Equatable {
    case allow
    case link(AmarchyLink)
    case outside
    case deny

    static func decide(_ url: URL, mainFrame: Bool, server: URL?, ownPage: URL?) -> NavigationRule {
        switch url.scheme?.lowercased() ?? "" {
        case "amarchy":
            return AmarchyLink(url).map { .link($0) } ?? .deny
        case "about", "blob", "data", "javascript":
            return .allow
        case "file":
            return ownPage.map { OwnPage.contains(url, page: $0) } == true ? .allow : .deny
        case "http", "https":
            if let server, Address.sameOrigin(url, server) { return .allow }
            // A frame inside the page (a preview) is the page's business; a
            // page of another site is the browser's.
            return mainFrame ? .outside : .allow
        default:
            // tel:, mailto:, googlechrome://, x-safari-https://, firefox://... the system's.
            return .outside
        }
    }
}

/// The app's own page: desktop/dist, in the bundle.
enum OwnPage {
    /// Whether a file URL is one of its files.
    static func contains(_ url: URL, page: URL) -> Bool {
        guard url.isFileURL else { return false }
        let dir = page.deletingLastPathComponent().resolvingSymlinksInPath().path + "/"
        return url.resolvingSymlinksInPath().path.hasPrefix(dir)
    }
}

@MainActor
final class ShellViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    let connection = Connection()
    private(set) var webView: WKWebView!
    /// The machine shown, or being loaded.
    private(set) var server: Server?
    private var handler: BridgeHandler!
    private let phone = PhoneHost()
    private let ownPage = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "dist")
    /// The app's own load of the machine (its failure shows why, on the own page).
    private var machineLoad: WKNavigation?
    /// The machine's page has loaded (it hears `amarchy-open`).
    private var pageReady = false
    /// A page is loading in the web view (the machine's own reloads too).
    private var pageLoading = false
    /// It's on its own page (no machine, or the machine didn't load).
    private(set) var showingOwn = true
    /// For the machine's page, once it has loaded.
    private var forPage: [OpenRequest] = []
    /// For the machine, once one answers.
    private var nextOpen: OpenRequest?
    private var sharing = false
    private var shareWanted = false
    #if DEBUG
    private var probe: Probe?
    #endif

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []      // the app's chimes
        config.applicationNameForUserAgent = (config.applicationNameForUserAgent ?? "Mobile/15E148")
            + " AmarchyApp/\(Amarchy.shortVersion) (iOS)"

        let bridge = Bridge(push: PushService.shared, host: phone)
        handler = BridgeHandler(bridge: bridge, ownPage: ownPage ?? Bundle.main.bundleURL) { [weak self] command, args in
            guard let self else { throw BridgeError("The app is closing") }
            return try await self.shellCommand(command, args)
        }
        handler.server = { [weak self] in self?.server }
        let controller = config.userContentController
        controller.addScriptMessageHandler(WeakHandler(handler), contentWorld: .page, name: "amarchy")
        controller.addScriptMessageHandler(WeakHandler(handler), contentWorld: .page, name: "amarchyShell")

        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.isOpaque = false
        web.backgroundColor = .amarchyBackground
        web.scrollView.backgroundColor = .amarchyBackground
        // The page lays itself out around the notch and the home bar
        // (viewport-fit=cover, env(safe-area-inset-*)).
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsBackForwardNavigationGestures = false
        web.allowsLinkPreview = false
        #if DEBUG
        web.isInspectable = true
        #endif
        webView = web
        view = web
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        #if DEBUG
        probe = Probe.attach(to: self)
        #endif
        connection.onOpen = { [weak self] in self?.load($0) }
        showOwnPage()
        connection.start()
    }

    // MARK: What it shows

    private func installScripts(for server: Server?) {
        let controller = webView.configuration.userContentController
        controller.removeAllUserScripts()
        controller.addUserScript(WKUserScript(source: Bridge.shellScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if let server {
            let source = Bridge.script(origin: Address.origin(server.url), version: Amarchy.version, relay: Amarchy.relay)
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
    }

    private func showOwnPage() {
        machineLoad = nil
        pageReady = false
        pageLoading = true
        showingOwn = true
        installScripts(for: server)
        guard let ownPage else {
            webView.loadHTMLString("<body style='background:#1a1b26;color:#c0caf5;font:15px -apple-system'>"
                                   + "<p style='margin:40vh 2em'>This build of Amarchy is missing its own page.</p>", baseURL: nil)
            return
        }
        webView.loadFileURL(ownPage, allowingReadAccessTo: ownPage.deletingLastPathComponent())
    }

    /// A machine that answered: its app (on the route asked for, if any).
    private func load(_ server: Server) {
        self.server = server
        installScripts(for: server)
        let o = nextOpen
        nextOpen = nil
        if o?.share == true { forPage.append(OpenRequest(share: true)) }
        pageReady = false
        pageLoading = true
        showingOwn = false
        machineLoad = webView.load(URLRequest(url: Address.page(server.url, go: o?.go, ask: o?.ask)))
        if shareWanted { sendShared(tellPage: true) }
    }

    /// Something to show (a notification tapped, a chat's link, a share):
    /// told to the page when it's up, else the page loaded on it.
    func open(_ o: OpenRequest) {
        if let target = o.server, server.map({ !Address.sameOrigin($0.url, target) }) ?? true {
            nextOpen = o
            connection.reach(target)
            return
        }
        guard let server else {
            nextOpen = o
            return
        }
        if pageReady, !pageLoading, let url = webView.url, Address.sameOrigin(url, server.url) {
            tell(o)
        } else if pageLoading, !showingOwn {
            forPage.append(o)
        } else {
            nextOpen = o
            load(server)
        }
    }

    private func tell(_ o: OpenRequest) {
        webView.evaluateJavaScript(Bridge.openScript(go: o.go, ask: o.ask, share: o.share)) { _, _ in }
        #if DEBUG
        probe?.run(after: 1.2)
        #endif
    }

    func handle(_ link: AmarchyLink) {
        switch link {
        case .open(let url):
            connection.reach(url)
        case .chat(let machine, let id):
            let here = server?.machine ?? Server.kept?.machine ?? ""
            open(OpenRequest(go: AmarchyLink.route(machine: machine, id: id, here: here)))
        case .share:
            sendShared(tellPage: true)
        }
    }

    /// Back in front: what the share sheet left, and another try when
    /// the machine didn't answer (the VPN may be on now).
    func becameActive() {
        if !Inbox.pending().isEmpty { sendShared(tellPage: false) }
        if showingOwn, [.nothing, .failed].contains(connection.status.kind),
           connection.trying != nil || Server.kept != nil {
            connection.retry()
        }
    }

    // MARK: The share sheet's inbox

    func sendShared(tellPage: Bool) {
        guard let server, !showingOwn else {
            shareWanted = true
            return
        }
        shareWanted = false
        guard !sharing else { return }
        sharing = true
        Task {
            let result = await ShareSender.send(server: server)
            sharing = false
            if result.sent > 0 || tellPage { open(OpenRequest(share: true)) }
            if let why = result.refused { say("Couldn't send what you shared", why) }
        }
    }

    // MARK: Its own page's commands (window.amarchyShell)

    private func shellCommand(_ command: String, _ args: [String: Any]) async throws -> Any {
        switch command {
        case "status":
            return connection.status.json
        case "choose":
            guard let name = args["name"] as? String else { throw BridgeError("Which one?") }
            try connection.choose(name: name)
        case "use_address":
            try connection.use(address: args["address"] as? String ?? "")
        case "retry":
            connection.retry()
        case "sign_in":
            try await connection.node.signIn()
        default:
            throw BridgeError("The app doesn't know \(command)")
        }
        return NSNull()
    }

    // MARK: WKNavigationDelegate

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = action.request.url else { return .cancel }
        switch NavigationRule.decide(url, mainFrame: action.targetFrame?.isMainFrame ?? true, server: server?.url, ownPage: ownPage) {
        case .allow:
            return .allow
        case .link(let link):
            handle(link)
        case .outside:
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        case .deny:
            break
        }
        return .cancel
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        pageLoading = true
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageLoading = false
        if let server, let url = webView.url, Address.sameOrigin(url, server.url) {
            pageReady = true
            machineLoad = nil
            let waiting = forPage
            forPage = []
            waiting.forEach(tell)
        }
        #if DEBUG
        probe?.run(after: 0.8)
        #endif
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        pageLoading = false
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        pageLoading = false
        guard navigation == machineLoad, let server, !Self.superseded(error) else { return }
        machineLoad = nil
        connection.failed(server.url, why: Net.words(for: error, host: server.url.host ?? "it"))
        showOwnPage()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // Its page's process ended (memory, most often): the page again.
        if let server {
            load(server)
        } else {
            showOwnPage()
        }
    }

    /// A load stopped by another one (or by the rule above), not a failure.
    private static func superseded(_ error: Error) -> Bool {
        let e = error as NSError
        return (e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled) || (e.domain == "WebKitErrorDomain" && e.code == 102)
    }

    // MARK: WKUIDelegate

    /// target=_blank and window.open: never a second web view, never a blank page.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = action.request.url else { return nil }
        if let link = AmarchyLink(url) {
            handle(link)
        } else if !["about", "javascript", "blob", "data"].contains(url.scheme?.lowercased() ?? "") {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }
        return nil
    }

    /// The microphone, for the machine's own page (its dictation); nothing else.
    func webView(_ webView: WKWebView, decideMediaCapturePermissionsFor origin: WKSecurityOrigin,
                 initiatedBy frame: WKFrameInfo, type: WKMediaCaptureType) async -> WKPermissionDecision {
        let mine = server.map { BridgeHandler.isOrigin(origin, of: $0.url) } ?? false
        return mine && type == .microphone ? .grant : .deny
    }

    // The page's alert(), confirm() and prompt(): a web view shows none by itself.

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo) async {
        await ask(message, buttons: [("OK", .default, ())], otherwise: ())
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo) async -> Bool {
        await ask(message, buttons: [("Cancel", .cancel, false), ("OK", .default, true)], otherwise: false)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo) async -> String? {
        var field: UITextField?
        let ok = await ask(prompt, buttons: [("Cancel", .cancel, false), ("OK", .default, true)], otherwise: false) { alert in
            alert.addTextField { $0.text = defaultText; field = $0 }
        }
        return ok ? field?.text ?? "" : nil
    }

    /// An alert's answer; with nothing on screen to show it over, `otherwise` at once.
    private func ask<T>(_ message: String, title: String? = nil, buttons: [(String, UIAlertAction.Style, T)], otherwise: T,
                        setup: (UIAlertController) -> Void = { _ in }) async -> T {
        guard view.window != nil, presentedViewController == nil else { return otherwise }
        return await withCheckedContinuation { done in
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            setup(alert)
            for (label, style, value) in buttons {
                alert.addAction(UIAlertAction(title: label, style: style) { _ in done.resume(returning: value) })
            }
            present(alert, animated: true)
        }
    }

    private func say(_ title: String, _ message: String) {
        Task { await ask(message, title: title, buttons: [("OK", .default, ())], otherwise: ()) }
    }
}

extension UIColor {
    /// The app's dark, as desktop/dist/shell.css (Tokyo Night).
    static let amarchyBackground = UIColor(red: 0x1a / 255, green: 0x1b / 255, blue: 0x26 / 255, alpha: 1)
}
