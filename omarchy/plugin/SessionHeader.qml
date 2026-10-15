import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import qs.Commons

// The strip above the zen column with the session on screen, said the way its
// row in the list says it, in the bar's colors: the status glyph (bell, spinner,
// check, moon), what it's about in bold, and the small caps of an Omarchy panel
// hero (PROJECT · BRANCH) on the right. The bell takes the bar's active color,
// like the Ⓐ when a session needs you. `amarchy layout` keeps the room for it
// free on session workspaces, so it only shows there.
// Click the name to rename the session: hovering it fills it like any Omarchy
// control, with a pencil, and the right side says the key that does the same.
PanelWindow {
  id: root

  property var sessions: []
  property int zenWidth: 900
  property int stripHeight: 0
  property int spinnerFrame: 0
  // "Ctrl+Alt+E", the rename key bound in Hyprland ("" when unbound).
  property string renameKey: ""
  signal renameRequested()

  readonly property var monitor: screen ? Hyprland.monitorFor(screen) : null
  readonly property string workspace: monitor && monitor.activeWorkspace ? monitor.activeWorkspace.name : ""
  readonly property var session: {
    for (var i = 0; i < sessions.length; i++) if (sessions[i].workspace === workspace) return sessions[i]
    return null
  }
  readonly property string status: session ? (session.status || "idle") : ""
  readonly property bool hot: nameMouse.containsMouse

  readonly property var spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  readonly property var icons: ({ waiting: "󰂞", idle: "󰄬", asleep: "󰒲" })
  readonly property color ink: Color.bar.text
  readonly property color dim: Qt.darker(Color.bar.text, 1.4)

  visible: stripHeight > 0 && session !== null
  color: "transparent"
  implicitHeight: Math.max(1, stripHeight)
  anchors { top: true; left: true; right: true }
  // Not exclusive itself, but it does make way for the bar.
  exclusiveZone: 0

  WlrLayershell.namespace: "amarchy-header"
  WlrLayershell.layer: WlrLayer.Bottom
  WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
  // Only the name takes clicks; the rest falls through to the desktop.
  mask: Region { item: name }

  Rectangle {
    id: strip
    width: Math.min(root.zenWidth, parent.width)
    height: parent.height
    anchors.horizontalCenter: parent.horizontalCenter
    color: Color.bar.background

    // The name, as a control: status glyph, title and (on hover) a pencil.
    Rectangle {
      id: name
      anchors.left: parent.left
      anchors.leftMargin: Style.spacing.rowPaddingX - Style.spacing.md
      anchors.verticalCenter: parent.verticalCenter
      height: Math.min(parent.height - Style.spacing.xs * 2, row.implicitHeight + Style.spacing.xs * 2)
      // From the parts, not the row: the title's own width depends on this.
      readonly property real natural: Style.spacing.md * 2 + glyph.width + row.spacing + title.implicitWidth
                                      + (pencil.visible ? row.spacing + pencil.implicitWidth : 0)
      width: Math.min(natural, parent.width - where.width - Style.spacing.rowPaddingX * 3)
      radius: Style.cornerRadius
      color: root.hot ? Style.hoverFillFor(root.ink, Color.accent) : "transparent"
      border.width: root.hot ? Style.hoverBorderWidth : 0
      border.color: Style.hoverBorderFor(root.ink, Color.accent)
      clip: true

      Row {
        id: row
        anchors.left: parent.left
        anchors.leftMargin: Style.spacing.md
        anchors.verticalCenter: parent.verticalCenter
        spacing: Style.spacing.lg

        Text {
          id: glyph
          // A fixed slot, so the title doesn't shift as the spinner turns.
          width: Style.font.icon
          anchors.verticalCenter: parent.verticalCenter
          horizontalAlignment: Text.AlignHCenter
          textFormat: Text.PlainText
          text: root.status === "working" ? root.spinner[root.spinnerFrame % root.spinner.length]
                                          : (root.icons[root.status] || "󰄬")
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.icon
          color: root.status === "waiting" ? Color.bar.active : root.ink
          opacity: root.status === "waiting" || root.status === "working" ? 1 : 0.52
        }

        Text {
          id: title
          anchors.verticalCenter: parent.verticalCenter
          width: Math.min(implicitWidth, name.width - Style.spacing.md * 2 - glyph.width - row.spacing
                          - (pencil.visible ? pencil.width + row.spacing : 0))
          textFormat: Text.PlainText
          elide: Text.ElideRight
          text: root.session ? (root.session.task || "new session") : ""
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.body
          font.bold: true
          color: root.ink
          opacity: root.session && root.session.task ? 1 : 0.52
        }

        Text {
          id: pencil
          visible: root.hot
          anchors.verticalCenter: parent.verticalCenter
          textFormat: Text.PlainText
          text: "󰏫"
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.body
          color: root.dim
        }
      }

      MouseArea {
        id: nameMouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: root.renameRequested()
      }
    }

    // PROJECT · BRANCH, or while the name is hovered, how to rename it. As
    // wide as the wider of the two, so hovering never moves the name's edge.
    Text {
      id: where
      width: Math.max(placeText.advanceWidth, renameText.advanceWidth) + font.letterSpacing
      horizontalAlignment: Text.AlignRight
      anchors.right: parent.right
      anchors.rightMargin: Style.spacing.rowPaddingX
      anchors.verticalCenter: parent.verticalCenter
      textFormat: Text.PlainText
      text: !root.session ? ""
          : root.hot ? ("Rename" + (root.renameKey ? " · " + root.renameKey : "")).toUpperCase()
          : (root.session.repo + " · " + root.session.name).toUpperCase()
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.caption
      font.bold: true
      font.letterSpacing: 1.2
      color: root.dim

      TextMetrics {
        id: placeText
        font: where.font
        text: root.session ? (root.session.repo + " · " + root.session.name).toUpperCase() : ""
      }
      TextMetrics {
        id: renameText
        font: where.font
        text: ("Rename" + (root.renameKey ? " · " + root.renameKey : "")).toUpperCase()
      }
    }
  }
}
