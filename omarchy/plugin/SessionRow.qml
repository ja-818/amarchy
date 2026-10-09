import QtQuick
import qs.Commons
import qs.Ui

// One session, drawn like a row of the Omarchy menu: icon column, label
// (what the session is about), subtext (project · branch), time on the right.
// The keyboard cursor uses the menu's selected treatment; the session that's
// on screen gets Hyprland's active border, like the focused window.
BorderSurface {
  id: row

  property var session: ({})
  property bool cursor: false
  property int spinnerFrame: 0
  signal activated()
  signal hovered()

  readonly property var spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  readonly property var icons: ({ waiting: "󰂞", idle: "󰄬", asleep: "󰒲" })
  readonly property string status: session.status || "idle"
  readonly property bool urgent: status === "waiting" || status === "working"
  readonly property color ink: cursor ? Color.menu.selectedText : Color.menu.text

  implicitHeight: Math.max(Style.space(58), Style.font.body + Style.font.caption + Style.spacing.rowPaddingX * 2)
  radius: Style.cornerRadius
  color: cursor ? Color.menu.selectedBackground : "transparent"
  borderSpec: session.current ? Border.hyprlandActiveSpec(Color.accent, Math.max(1, Style.space(2)))
                              : Border.surfaceSpec("menu", "selected-border", Color.menu.selectedBorder, 0)

  Text {
    id: icon
    width: Style.space(36)
    anchors.left: parent.left
    anchors.leftMargin: row.borderLeft + Style.space(8)
    y: content.y + label.y + (label.height - height) / 2
    horizontalAlignment: Text.AlignHCenter
    textFormat: Text.PlainText
    text: row.status === "working" ? row.spinner[row.spinnerFrame % row.spinner.length]
                                   : (row.icons[row.status] || "󰄬")
    font.family: Style.font.menuFamily
    font.pixelSize: Style.font.iconLarge
    color: row.cursor || row.urgent ? Color.menu.selectedText : Color.menu.text
    opacity: row.cursor || row.urgent ? 1 : 0.52
  }

  Column {
    id: content
    anchors.left: icon.right
    anchors.leftMargin: Style.space(6)
    anchors.right: when.left
    anchors.rightMargin: Style.space(8)
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(3)

    Text {
      id: label
      width: parent.width
      textFormat: Text.PlainText
      elide: Text.ElideRight
      text: row.session.task || "new session"
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.heading
      font.weight: Font.Medium
      color: row.ink
      opacity: row.session.task || row.cursor ? 1 : 0.52
    }

    Text {
      width: parent.width
      textFormat: Text.PlainText
      elide: Text.ElideRight
      text: (row.session.repo || "") + " · " + (row.session.name || "")
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.bodySmall
      color: Color.menu.text
      opacity: 0.52
    }
  }

  Text {
    id: when
    anchors.right: parent.right
    anchors.rightMargin: row.borderRight + Style.space(12)
    y: content.y + label.y + (label.height - height) / 2
    textFormat: Text.PlainText
    text: row.session.age || ""
    font.family: Style.font.menuFamily
    font.pixelSize: Style.font.caption
    color: Color.menu.text
    opacity: 0.45
  }

  MouseArea {
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    onEntered: row.hovered()
    onClicked: row.activated()
  }
}
