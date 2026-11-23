// The widget (phone/README.md, "The widget"): "2 need you" and the first
// chats' names, on the home screen and the lock screen, from the app
// group's status.json (the page's `status`, each notification's
// `waiting`). Tapped: the app; a chat's line: that chat.

import SwiftUI
import WidgetKit

@main
struct AmarchyWidgets: WidgetBundle {
    var body: some Widget {
        NeedsYouWidget()
    }
}

struct NeedsYouWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "amarchy.needs-you", provider: StatusProvider()) { entry in
            NeedsYouView(entry: entry)
        }
        .configurationDisplayName("Who needs you")
        .description("How many chats need you, and which.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct StatusEntry: TimelineEntry {
    var date: Date
    var status: WidgetStatus
}

struct StatusProvider: TimelineProvider {
    func placeholder(in context: Context) -> StatusEntry {
        StatusEntry(date: Date(), status: WidgetStatus(needs: 2, chats: [
            .init(key: "fix-login", name: "Fix the login", why: "Asks: Allow Bash?"),
            .init(key: "docs", name: "Write the docs", why: "Done"),
        ], machine: nil, at: Date()))
    }

    func getSnapshot(in context: Context, completion: @escaping (StatusEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : StatusEntry(date: Date(), status: WidgetStatus.read()))
    }

    /// Reloaded by the app and the notification extension when it changes;
    /// nothing to refresh on a clock.
    func getTimeline(in context: Context, completion: @escaping (Timeline<StatusEntry>) -> Void) {
        completion(Timeline(entries: [StatusEntry(date: Date(), status: WidgetStatus.read())], policy: .never))
    }
}

/// desktop/dist/shell.css's colors (Omarchy's Tokyo Night).
enum Look {
    static let background = Color(red: 0x1a / 255, green: 0x1b / 255, blue: 0x26 / 255)
    static let text = Color(red: 0xc0 / 255, green: 0xca / 255, blue: 0xf5 / 255)
    static let muted = Color(red: 0x79 / 255, green: 0x82 / 255, blue: 0xa9 / 255)
    static let accent = Color(red: 0x7a / 255, green: 0xa2 / 255, blue: 0xf7 / 255)
}

struct NeedsYouView: View {
    var entry: StatusEntry
    @Environment(\.widgetFamily) private var family

    private var status: WidgetStatus { entry.status }

    var body: some View {
        content
            .widgetURL(tapped)
            .containerBackground(for: .widget) { Look.background }
    }

    /// The one chat that needs you, else the app.
    private var tapped: URL? {
        if status.needs == 1, status.chats.count == 1, let url = status.link(for: status.chats[0]) { return url }
        return URL(string: "amarchy://app")
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .accessoryInline:
            Text(status.words)
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Text("\(status.needs)").font(.system(.title2, design: .monospaced).weight(.semibold))
                    Text(status.needs == 1 ? "needs you" : "need you").font(.system(size: 8, design: .monospaced))
                }
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text(status.words).font(.system(.headline, design: .monospaced))
                ForEach(status.chats.prefix(2), id: \.key) { chat in
                    Text(chat.name).font(.system(.caption, design: .monospaced)).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .systemMedium:
            board(lines: 3)
        default:
            board(lines: 2)
        }
    }

    /// The home screen's: the count in the accent, the chats under it.
    private func board(lines: Int) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                if status.needs > 0 {
                    Text("\(status.needs)").font(.system(size: 34, weight: .bold, design: .monospaced)).foregroundStyle(Look.accent)
                    Text(status.needs == 1 ? "needs you" : "need you").font(.system(.subheadline, design: .monospaced))
                        .foregroundStyle(Look.text)
                } else {
                    Text("Nothing needs you").font(.system(.subheadline, design: .monospaced).weight(.semibold))
                        .foregroundStyle(Look.text)
                }
            }
            ForEach(status.chats.prefix(lines), id: \.key) { chat in
                line(chat)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder private func line(_ chat: WidgetStatus.Chat) -> some View {
        let words = VStack(alignment: .leading, spacing: 0) {
            Text(chat.name).font(.system(.caption, design: .monospaced).weight(.semibold)).foregroundStyle(Look.text).lineLimit(1)
            if family == .systemMedium, let why = chat.why, !why.isEmpty {
                Text(why).font(.system(.caption2, design: .monospaced)).foregroundStyle(Look.muted).lineLimit(1)
            }
        }
        // A line opens its chat (a small widget opens the app wherever it's tapped).
        if family == .systemMedium, let url = status.link(for: chat) {
            Link(destination: url) { words }
        } else {
            words
        }
    }
}
