// The Share Extension (phone/README.md, "The share sheet"): text, a link,
// up to 20 pictures, put in the app group's inbox as they came, then the
// app opened on it (amarchy://share), which sends it to your amarchy. When
// the app can't be opened from here, it says it's saved and closes.

import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let words = UILabel()
    private var done = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0x1a / 255, green: 0x1b / 255, blue: 0x26 / 255, alpha: 1)
        words.text = "Sending to Amarchy…"
        words.textColor = UIColor(red: 0xc0 / 255, green: 0xca / 255, blue: 0xf5 / 255, alpha: 1)
        words.font = .monospacedSystemFont(ofSize: 15, weight: .semibold)
        words.numberOfLines = 0
        words.textAlignment = .center
        words.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(words)
        NSLayoutConstraint.activate([
            words.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            words.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            words.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !done else { return }
        done = true
        Task { await take() }
    }

    private func take() async {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        do {
            var writer = try Inbox.Writer()
            var texts: [String] = []
            for provider in providers {
                if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                    if let data = await Self.image(provider) { try writer.add(image: data) }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    if let url = await Self.load(provider, UTType.url) as? URL { texts.append(url.absoluteString) }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    if let text = await Self.load(provider, UTType.plainText) as? String { texts.append(text) }
                }
            }
            let text = texts.joined(separator: "\n")
            guard !writer.images.isEmpty || !text.isEmpty else {
                writer.discard()
                return finish(saying: "Nothing to send: Amarchy takes text, links and pictures")
            }
            try writer.finish(text: text)
        } catch {
            return finish(saying: "Couldn't keep it for Amarchy: \(error.localizedDescription)")
        }
        if await openApp(URL(string: "amarchy://share")!) {
            extensionContext?.completeRequest(returningItems: nil)
        } else {
            finish(saying: "Saved: open Amarchy to send it")
        }
    }

    private func finish(saying message: String) {
        words.text = message
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: nil)
        }
    }

    /// The containing app, through the responder chain's UIApplication (the
    /// way that still works on iOS 18; an extension has no UIApplication.shared).
    @MainActor
    private func openApp(_ url: URL) async -> Bool {
        var responder: UIResponder? = self
        while let r = responder {
            if let app = r as? UIApplication {
                return await withCheckedContinuation { done in
                    app.open(url, options: [:]) { done.resume(returning: $0) }
                }
            }
            responder = r.next
        }
        return false
    }

    /// A picture's bytes as they came (a screenshot's editor gives a UIImage instead).
    private static func image(_ provider: NSItemProvider) async -> Data? {
        let item = await load(provider, UTType.image)
        if let url = item as? URL { return try? Data(contentsOf: url) }
        if let data = item as? Data { return data }
        if let image = item as? UIImage { return image.pngData() }
        return nil
    }

    private static func load(_ provider: NSItemProvider, _ type: UTType) async -> NSSecureCoding? {
        await withCheckedContinuation { done in
            provider.loadItem(forTypeIdentifier: type.identifier, options: nil) { item, _ in done.resume(returning: item) }
        }
    }
}
