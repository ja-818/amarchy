import QtQuick
import qs.Commons
import qs.Ui

// Sessions in the order the CLI gives them (`amarchy sort`: higher priority
// first, or newest or oldest first), grouped by project, priority and/or
// status with a section header where the group changes. Groups nest in that
// order, each level a step in from the one above and quieter.
Column {
  id: list

  property var sessions: []
  property bool byProject: false
  property bool byPriority: false
  property bool byStatus: false
  property int cursor: -1
  property int spinnerFrame: 0
  signal activated(int index)
  signal hovered(int index)

  readonly property var statusNames: ({ waiting: "Needs you", working: "Working", idle: "Idle", asleep: "Asleep" })
  readonly property var priorityNames: ({ high: "High priority", normal: "Normal priority", low: "Low priority" })

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
      readonly property bool newProject: list.byProject && (!previous || previous.repo !== modelData.repo)
      readonly property bool newPriority: list.byPriority && (newProject || !previous || previous.priority !== modelData.priority)
      readonly property bool newStatus: list.byStatus && (newPriority || newProject || !previous || previous.status !== modelData.status)
      // How far in each header sits: one step per grouping above it.
      readonly property int priorityDepth: list.byProject ? 1 : 0
      readonly property int statusDepth: priorityDepth + (list.byPriority ? 1 : 0)
      // The first header of a row hugs whatever is above it; the others don't
      // add space, they're right under it.
      readonly property int gapAbove: index === 0 ? 0 : Style.spacing.md

      PanelSectionHeader {
        visible: entry.newProject
        text: entry.modelData.repo || ""
        foreground: Color.menu.text
        fontFamily: Style.font.menuFamily
        topPadding: entry.gapAbove + Math.ceil(fontSize * 0.15)
        leftPadding: Style.space(8)
      }

      PanelSectionHeader {
        visible: entry.newPriority
        text: list.priorityNames[entry.modelData.priority] || entry.modelData.priority
        foreground: Color.menu.text
        fontFamily: Style.font.menuFamily
        opacity: entry.priorityDepth > 0 ? 0.7 : 1
        topPadding: (entry.newProject ? 0 : entry.gapAbove) + Math.ceil(fontSize * 0.15)
        leftPadding: Style.space(8 + 12 * entry.priorityDepth)
      }

      PanelSectionHeader {
        visible: entry.newStatus
        text: list.statusNames[entry.modelData.status] || entry.modelData.status
        foreground: Color.menu.text
        fontFamily: Style.font.menuFamily
        opacity: entry.statusDepth > 0 ? (entry.statusDepth > 1 ? 0.55 : 0.7) : 1
        topPadding: (entry.newProject || entry.newPriority ? 0 : entry.gapAbove) + Math.ceil(fontSize * 0.15)
        leftPadding: Style.space(8 + 12 * entry.statusDepth)
      }

      SessionRow {
        width: parent.width
        session: entry.modelData
        // The project is in the header above it.
        showRepo: !list.byProject
        // The priority is in the header above it.
        showPriority: !list.byPriority
        cursor: entry.index === list.cursor
        spinnerFrame: list.spinnerFrame
        onActivated: list.activated(entry.index)
        onHovered: list.hovered(entry.index)
      }
    }
  }
}
