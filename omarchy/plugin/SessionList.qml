import QtQuick
import qs.Commons
import qs.Ui

// Sessions in the order the CLI gives them: as they were opened, or grouped
// by project and/or status, with a section header where the group changes.
// With both, each project has its status sections under it.
Column {
  id: list

  property var sessions: []
  property bool byProject: false
  property bool byStatus: false
  property int cursor: -1
  property int spinnerFrame: 0
  signal activated(int index)
  signal hovered(int index)

  readonly property var sectionNames: ({ waiting: "Needs you", working: "Working", idle: "Idle", asleep: "Asleep" })

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
      readonly property bool newStatus: list.byStatus && (newProject || !previous || previous.status !== modelData.status)

      PanelSectionHeader {
        visible: entry.newProject
        text: entry.modelData.repo || ""
        foreground: Color.menu.text
        fontFamily: Style.font.menuFamily
        topPadding: (entry.index === 0 ? 0 : Style.spacing.md) + Math.ceil(fontSize * 0.15)
        leftPadding: Style.space(8)
      }

      // Under a project it's a step in from the project's name, and quieter.
      PanelSectionHeader {
        visible: entry.newStatus
        text: list.sectionNames[entry.modelData.status] || entry.modelData.status
        foreground: Color.menu.text
        fontFamily: Style.font.menuFamily
        opacity: list.byProject ? 0.7 : 1
        topPadding: (entry.index === 0 || entry.newProject ? 0 : Style.spacing.md) + Math.ceil(fontSize * 0.15)
        leftPadding: Style.space(list.byProject ? 20 : 8)
      }

      SessionRow {
        width: parent.width
        session: entry.modelData
        // The project is in the header above it.
        showRepo: !list.byProject
        cursor: entry.index === list.cursor
        spinnerFrame: list.spinnerFrame
        onActivated: list.activated(entry.index)
        onHovered: list.hovered(entry.index)
      }
    }
  }
}
