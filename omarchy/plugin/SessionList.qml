import QtQuick
import qs.Commons
import qs.Ui

// Sessions in the order the CLI gives them (`amarchy sort`: higher priority
// first, or newest or oldest first), grouped by project, priority and/or
// status with a section header where the group changes. Groups nest in the
// order of `groups`, outermost first, each level a step in from the one above
// and quieter.
Column {
  id: list

  property var sessions: []
  // "project", "priority" and/or "status", outermost first.
  property var groups: []
  property int cursor: -1
  property int spinnerFrame: 0
  signal activated(int index)
  signal hovered(int index)

  readonly property var statusNames: ({ waiting: "Needs you", working: "Working", idle: "Idle", asleep: "Asleep" })
  readonly property var priorityNames: ({ high: "High priority", normal: "Normal priority", low: "Low priority" })

  // What a session is grouped under, for one grouping.
  function key(s, what) {
    return what === "project" ? s.repo : s[what]
  }
  // A header's name, for one grouping.
  function title(s, what) {
    if (what === "project") return s.repo || ""
    if (what === "priority") return list.priorityNames[s.priority] || s.priority
    return list.statusNames[s.status] || s.status
  }

  spacing: Style.spacing.xxs

  Repeater {
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
      readonly property int firstNew: {
        var groups = list.groups
        for (var i = 0; i < groups.length; i++)
          if (!previous || list.key(previous, groups[i]) !== list.key(modelData, groups[i])) return i
        return groups.length
      }
      // The first header of a row hugs whatever is above it; the others don't
      // add space, they're right under it.
      readonly property int gapAbove: index === 0 ? 0 : Style.spacing.md

      Repeater {
        model: list.groups

        PanelSectionHeader {
          required property string modelData
          required property int index
          visible: index >= entry.firstNew
          text: list.title(entry.modelData, modelData)
          foreground: Color.menu.text
          fontFamily: Style.font.menuFamily
          // One step in, and quieter, per grouping above it.
          opacity: index === 0 ? 1 : index === 1 ? 0.7 : 0.55
          topPadding: (index === entry.firstNew ? entry.gapAbove : 0) + Math.ceil(fontSize * 0.15)
          leftPadding: Style.space(8 + 12 * index)
        }
      }

      SessionRow {
        width: parent.width
        session: entry.modelData
        // The project is in the header above it.
        showRepo: list.groups.indexOf("project") < 0
        // The priority is in the header above it.
        showPriority: list.groups.indexOf("priority") < 0
        cursor: entry.index === list.cursor
        spinnerFrame: list.spinnerFrame
        onActivated: list.activated(entry.index)
        onHovered: list.hovered(entry.index)
      }
    }
  }
}
