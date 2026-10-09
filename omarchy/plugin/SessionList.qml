import QtQuick
import qs.Commons
import qs.Ui

// Sessions grouped by urgency (the CLI already sorts them that way), with a
// section header where the state changes. Shared by Mission Control and the
// bar popup.
Column {
  id: list

  property var sessions: []
  property int cursor: -1
  property int spinnerFrame: 0
  signal activated(int index)
  signal hovered(int index)

  readonly property var sectionNames: ({ waiting: "Needs you", working: "Working", idle: "Idle", asleep: "Asleep" })

  spacing: Style.spacing.xs

  Repeater {
    model: list.sessions

    Column {
      id: entry
      required property var modelData
      required property int index
      width: list.width
      spacing: Style.spacing.xs

      readonly property bool firstOfSection: index === 0 || list.sessions[index - 1].status !== modelData.status

      PanelSectionHeader {
        visible: entry.firstOfSection
        text: list.sectionNames[entry.modelData.status] || entry.modelData.status
        foreground: Color.menu.text
        fontFamily: Style.font.menuFamily
        topPadding: (entry.index === 0 ? 0 : Style.spacing.lg) + Math.ceil(fontSize * 0.15)
        leftPadding: Style.space(8)
      }

      SessionRow {
        width: parent.width
        session: entry.modelData
        cursor: entry.index === list.cursor
        spinnerFrame: list.spinnerFrame
        onActivated: list.activated(entry.index)
        onHovered: list.hovered(entry.index)
      }
    }
  }
}
