// What the share sheet hands the app (phone/README.md, "The share sheet"):
// one folder per share in the app group's inbox, its pictures as they came
// and meta.json written last (a folder without it is a share still being
// written, or one that never finished).

import Foundation

struct InboxItem: Codable, Equatable {
    var text: String?
    /// The pictures' file names in its folder, in order.
    var images: [String]
    var at: Date

    static let most = 20
}

enum Inbox {
    /// A share being written: its pictures one by one (no more than 20), then its text.
    struct Writer {
        let folder: URL
        private(set) var images: [String] = []

        init(in inbox: URL = SharedStore.inbox, at date: Date = Date()) throws {
            let name = String(format: "%013.0f-", date.timeIntervalSince1970 * 1000) + UUID().uuidString
            folder = inbox.appendingPathComponent(name, isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        }

        mutating func add(image data: Data) throws {
            guard images.count < InboxItem.most, !data.isEmpty else { return }
            let name = "\(images.count).\(Picture.kind(of: data)?.ext ?? "jpg")"
            try data.write(to: folder.appendingPathComponent(name), options: .atomic)
            images.append(name)
        }

        func finish(text: String?) throws {
            let words = text?.trimmingCharacters(in: .whitespacesAndNewlines)
            let item = InboxItem(text: words?.isEmpty == false ? words : nil, images: images, at: Date())
            try JSONEncoder.amarchy.encode(item).write(to: folder.appendingPathComponent("meta.json"), options: .atomic)
        }

        func discard() {
            try? FileManager.default.removeItem(at: folder)
        }
    }

    /// The shares waiting, oldest first. Unfinished ones an hour old go.
    static func pending(in inbox: URL = SharedStore.inbox) -> [(folder: URL, item: InboxItem)] {
        let fm = FileManager.default
        let folders = (try? fm.contentsOfDirectory(at: inbox, includingPropertiesForKeys: [.creationDateKey])) ?? []
        return folders.sorted { $0.lastPathComponent < $1.lastPathComponent }.compactMap { folder in
            let meta = folder.appendingPathComponent("meta.json")
            guard let data = try? Data(contentsOf: meta), let item = try? JSONDecoder.amarchy.decode(InboxItem.self, from: data) else {
                let made = (try? folder.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
                if made < Date().addingTimeInterval(-3600) { try? fm.removeItem(at: folder) }
                return nil
            }
            return (folder, item)
        }
    }

    static func remove(_ folder: URL) {
        try? FileManager.default.removeItem(at: folder)
    }
}

/// A picture's type, read off its first bytes (as the server's share_type).
enum Picture {
    static func kind(of data: Data) -> (mime: String, ext: String)? {
        let b = [UInt8](data.prefix(12))
        if b.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return ("image/png", "png") }
        if b.starts(with: [0xFF, 0xD8, 0xFF]) { return ("image/jpeg", "jpg") }
        if b.starts(with: Array("GIF8".utf8)) { return ("image/gif", "gif") }
        if b.count >= 12, b[0..<4].elementsEqual("RIFF".utf8), b[8..<12].elementsEqual("WEBP".utf8) { return ("image/webp", "webp") }
        if b.count >= 12, b[4..<8].elementsEqual("ftyp".utf8),
           ["heic", "heix", "heim", "heis", "hevc", "mif1", "msf1"].contains(String(decoding: b[8..<12], as: UTF8.self)) {
            return ("image/heic", "heic")
        }
        return nil
    }
}
