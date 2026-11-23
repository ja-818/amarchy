// The share sheet's inbox, sent to the machine as the iPhone's Shortcut
// sends it (phone/README.md, "The share sheet"): POST <share address>, a
// form with `text` and one `images` file per picture. The address is
// GET /api/share/key's, kept per machine. Not sent (out of reach): kept for
// the next time the app opens.

import Foundation

/// A multipart/form-data body.
struct Multipart {
    let boundary: String
    private var body = Data()

    init(boundary: String = "amarchy-" + UUID().uuidString) {
        self.boundary = boundary
    }

    var contentType: String { "multipart/form-data; boundary=\(boundary)" }

    mutating func field(_ name: String, _ value: String) {
        body += Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n".utf8)
        body += Data(value.utf8) + Data("\r\n".utf8)
    }

    mutating func file(_ name: String, filename: String, type: String, data: Data) {
        body += Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n".utf8)
        body += Data("Content-Type: \(type)\r\n\r\n".utf8) + data + Data("\r\n".utf8)
    }

    var finished: Data { body + Data("--\(boundary)--\r\n".utf8) }
}

enum ShareSender {
    struct Result {
        var sent = 0
        /// The machine refused one (it's dropped): its words.
        var refused: String?
    }

    static func keptName(for server: Server) -> String { "share.key." + Address.origin(server.url) }

    /// The share address's key, kept; asked for when it isn't.
    static func shareURL(_ server: Server, fresh: Bool = false) async throws -> URL {
        let defaults = SharedStore.defaults
        var key = fresh ? nil : defaults.string(forKey: keptName(for: server))
        if key == nil {
            let (data, _) = try await Net.send(Net.request(server.url.appendingPathComponent("api/share/key"), timeout: 10))
            let said = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["url"] as? String
            key = said.flatMap(URLComponents.init(string:))?.queryItems?.first { $0.name == "key" }?.value
            guard let key else { throw Net.Failure(errorDescription: "\(server.url.host ?? "It") didn't give its share address") }
            defaults.set(key, forKey: keptName(for: server))
        }
        // The machine's own origin (the one this app reaches), with its key.
        var parts = URLComponents(url: server.url.appendingPathComponent("api/share"), resolvingAgainstBaseURL: false)!
        parts.queryItems = [URLQueryItem(name: "key", value: key)]
        return parts.url!
    }

    static func body(for item: InboxItem, in folder: URL) -> Multipart {
        var form = Multipart()
        if let text = item.text { form.field("text", text) }
        for name in item.images {
            guard let data = try? Data(contentsOf: folder.appendingPathComponent(name)) else { continue }
            form.file("images", filename: name, type: Picture.kind(of: data)?.mime ?? "application/octet-stream", data: data)
        }
        return form
    }

    @MainActor
    static func send(server: Server) async -> Result {
        var result = Result()
        for (folder, item) in Inbox.pending() {
            let form = body(for: item, in: folder)
            do {
                try await post(form, to: server)
                Inbox.remove(folder)
                result.sent += 1
            } catch let failure as Net.Failure where failure.status.map({ (400..<500).contains($0) && $0 != 408 && $0 != 429 }) == true {
                // Refused for what it is (too big, not a picture): not again.
                Inbox.remove(folder)
                result.refused = failure.errorDescription
            } catch {
                break       // out of reach: all of it next time
            }
        }
        return result
    }

    private static func post(_ form: Multipart, to server: Server) async throws {
        for fresh in [false, true] {
            var request = Net.request(try await shareURL(server, fresh: fresh), method: "POST", timeout: 60)
            request.setValue(form.contentType, forHTTPHeaderField: "Content-Type")
            request.httpBody = form.finished
            do {
                _ = try await Net.send(request)
                return
            } catch let failure as Net.Failure where failure.status == 403 && !fresh {
                continue        // its key changed: asked for again, once
            }
        }
    }
}
