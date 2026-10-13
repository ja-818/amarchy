import QtQuick
import qs.Commons
import qs.Ui

// One session, with the proportions of an Omarchy panel hero (the "Display /
// FIXED BRIGHTNESS" block of the monitor panel): a display-size icon centered
// on the row, a bold title (what the session is about) and a small-caps line
// under it (project · branch), plus the time on the right. Everything is the
// hero's size times `zoom`, so a screenful of sessions fits.
// The cursor (which starts on the session you're in) uses the menu's selected
// treatment.
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
  readonly property color dim: Qt.darker(Color.menu.text, 1.4)
  readonly property real zoom: 0.85
  readonly property int iconSize: Style.font.iconLarge

  implicitHeight: Math.max(icon.implicitHeight, content.implicitHeight) + Style.spacing.controlPaddingY * 2
  radius: Style.cornerRadius
  color: cursor ? Color.menu.selectedBackground : "transparent"
  borderSpec: Border.surfaceSpec("menu", "selected-border", Color.menu.selectedBorder, 0)

  Text {
    id: icon
    // A fixed slot, so titles line up whatever the glyph's own width.
    width: row.iconSize
    anchors.left: parent.left
    anchors.leftMargin: row.borderLeft + Style.spacing.sm
    anchors.verticalCenter: parent.verticalCenter
    horizontalAlignment: Text.AlignHCenter
    textFormat: Text.PlainText
    text: row.status === "working" ? row.spinner[row.spinnerFrame % row.spinner.length]
                                   : (row.icons[row.status] || "󰄬")
    font.family: Style.font.menuFamily
    font.pixelSize: row.iconSize
    color: row.cursor || row.urgent ? Color.menu.selectedText : Color.menu.text
    opacity: row.cursor || row.urgent ? 1 : 0.52
  }

  Column {
    id: content
    anchors.left: icon.right
    anchors.leftMargin: Math.round(Style.space(14) * row.zoom)
    anchors.right: when.left
    anchors.rightMargin: Style.space(8)
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(2)

    Text {
      id: label
      width: parent.width
      textFormat: Text.PlainText
      elide: Text.ElideRight
      text: row.session.task || "new session"
      font.family: Style.font.menuFamily
      font.pixelSize: Math.round(Style.font.title * row.zoom)
      font.bold: true
      color: row.ink
      opacity: row.session.task || row.cursor ? 1 : 0.52
    }

    Text {
      width: parent.width
      textFormat: Text.PlainText
      elide: Text.ElideRight
      text: ((row.session.repo || "") + " · " + (row.session.name || "")).toUpperCase()
      font.family: Style.font.menuFamily
      font.pixelSize: Math.round(Style.font.caption * row.zoom)
      font.bold: true
      font.letterSpacing: 1.2 * row.zoom
      color: row.dim
    }
  }

  Text {
    id: when
    anchors.right: parent.right
    anchors.rightMargin: row.borderRight + Style.spacing.lg
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
