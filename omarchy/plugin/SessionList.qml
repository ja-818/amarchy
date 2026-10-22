import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui

// Sessions in the order the CLI gives them (`amarchy sort`: higher priority
// first, or newest or oldest first), grouped by project, priority and/or
// status with a section header where the group changes. Groups nest in the
// order of `groups`, outermost first. Every header is the same flush-left
// label, except that with more than one grouping the outermost is a rule
// across the list with its name in the middle, to set the big sections apart.
// Your assistant and the other sessions of its project come first (the CLI
// puts them there), in a place of their own above the groups, without
// headers, a rule under them.
Column {
  id: list

  property var sessions: []
  // "project", "priority" and/or "status", outermost first.
  property var groups: []
  property int cursor: -1
  property int spinnerFrame: 0
  signal activated(int index)
  signal hovered(int index)

  readonly property var statusNames: ({ waiting: "Needs you", working: "Working", done: "Done", idle: "Idle", asleep: "Asleep" })
  readonly property var priorityNames: ({ high: "High priority", normal: "Normal priority", low: "Low priority" })

  // What a session is grouped under, for one grouping. By status, one that
  // finished and you haven't opened yet is "Done", apart from the idle ones.
  function key(s, what) {
    if (what === "project") return s.repo
    if (what === "status") return s.status === "idle" && s.unseen === true ? "done" : s.status
    return s[what]
  }
  // A header's name, for one grouping.
  function title(s, what) {
    if (what === "project") return s.repo || ""
    if (what === "priority") return list.priorityNames[s.priority] || s.priority
    var status = list.key(s, "status")
    return list.statusNames[status] || status
  }

  // Where a session's row is, from the top of the list, counting the
  // headers that open right above it: { top, bottom }, or null.
  function rowExtent(index) {
    var entry = rows.itemAt(index)
    if (!entry) return null
    list.forceLayout()
    entry.forceLayout()
    return { top: entry.y, bottom: entry.y + entry.height }
  }

  spacing: Style.spacing.xxs

  Repeater {
    id: rows
    model: list.sessions

    Column {
      id: entry
      required property var modelData
      required property int index
      width: list.width
      spacing: Style.spacing.xxs

      readonly property var previous: index > 0 ? list.sessions[index - 1] : null
      // How many of the groupings, outermost first, get a new header above
      // this row: from the first one that changes here down to the innermost.
      readonly property bool mine: !!modelData.assistant
      // The first row after your assistant's section: the rule above it, and all its headers.
      readonly property bool afterMine: !mine && !!previous && !!previous.assistant
      readonly property int firstNew: {
        var groups = list.groups
        if (mine) return groups.length
        if (afterMine) return 0
        for (var i = 0; i < groups.length; i++)
          if (!previous || list.key(previous, groups[i]) !== list.key(modelData, groups[i])) return i
        return groups.length
      }
      // The first header of a row hugs whatever is above it; the others don't
      // add space, they're right under it.
      readonly property int gapAbove: index === 0 || afterMine ? 0 : Style.spacing.md

      Item {
        visible: entry.afterMine
        width: entry.width
        height: Style.spacing.md * 2

        PanelSeparator {
          foreground: Commons.Color.menu.text
          strength: 0.2
          x: Style.space(8)
          width: parent.width - x * 2
          y: Math.round(parent.height / 2)
        }
      }

      Repeater {
        model: list.groups

        Item {
          id: heading
          required property string modelData
          required property int index
          // With more than one grouping, the outermost is a rule with its
          // name in the middle; the rest are plain labels.
          readonly property bool ruled: index === 0 && list.groups.length > 1
          // The rules stop where the rows' text does.
          readonly property int inset: Style.space(8)
          readonly property int gap: Style.space(8)
          visible: index >= entry.firstNew
          width: entry.width
          height: label.height

          PanelSectionHeader {
            id: label
            x: heading.ruled ? Math.round((heading.width - width) / 2) : 0
            text: list.title(entry.modelData, heading.modelData)
            foreground: Commons.Color.menu.text
            fontFamily: Style.font.menuFamily
            topPadding: (heading.index === entry.firstNew ? entry.gapAbove : 0) + Math.ceil(fontSize * 0.15)
            leftPadding: heading.ruled ? 0 : heading.inset
          }

          PanelSeparator {
            visible: heading.ruled
            foreground: Commons.Color.menu.text
            strength: 0.2
            x: heading.inset
            width: Math.max(0, label.x - heading.gap - x)
            y: Math.round(label.topPadding + (label.height - label.topPadding) / 2)
          }

          PanelSeparator {
            visible: heading.ruled
            foreground: Commons.Color.menu.text
            strength: 0.2
            x: label.x + label.width + heading.gap
            width: Math.max(0, heading.width - heading.inset - x)
            y: Math.round(label.topPadding + (label.height - label.topPadding) / 2)
          }
        }
      }

      SessionRow {
        width: parent.width
        session: entry.modelData
        // The project is in the header above it (none above your assistant's).
        showRepo: entry.mine || list.groups.indexOf("project") < 0
        // The priority is in the header above it.
        showPriority: entry.mine || list.groups.indexOf("priority") < 0
        cursor: entry.index === list.cursor
        spinnerFrame: list.spinnerFrame
        onActivated: list.activated(entry.index)
        onHovered: list.hovered(entry.index)
      }
    }
  }
}
