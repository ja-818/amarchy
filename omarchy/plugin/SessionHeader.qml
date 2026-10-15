import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import qs.Commons

// The session's name above Claude in zen mode, where the list that shows the
// session you're in has stepped away: a bar as wide as Claude's column, its
// name centered, on the wallpaper with a gap above Claude, so it reads as the desktop's and
// not as part of Claude's window. The status glyph (the bell in the theme's
// accent) and what the session is about; hovering fills it like any Omarchy
// control and adds project · branch and a pencil: click to rename.
// `amarchy layout` makes room for it above Claude in zen mode only.
PanelWindow {
  id: root

  property var sessions: []
  property bool zen: false
  property int zenWidth: 900
  property int stripHeight: 0
  property int spinnerFrame: 0
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

  visible: zen && stripHeight > 0 && session !== null
  color: "transparent"
  implicitHeight: Math.max(1, stripHeight)
  anchors { top: true; left: true; right: true }
  // Not exclusive itself, but it does make way for the bar.
  exclusiveZone: 0

  WlrLayershell.namespace: "amarchy-header"
  WlrLayershell.layer: WlrLayer.Bottom
  WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
  // Only the pill takes clicks; the rest falls through to the desktop.
  mask: Region { item: pill }

  Rectangle {
    id: pill
    anchors.centerIn: parent
    height: row.implicitHeight + Style.spacing.xs * 2
    // As wide as Claude's column below it.
    width: Math.min(root.zenWidth, parent.width)
    radius: Style.cornerRadius
    color: root.hot ? Qt.tint(Color.bar.background, Style.hoverFillFor(root.ink, Color.accent)) : Color.bar.background
    border.width: Style.hoverBorderWidth
    border.color: root.hot ? Style.hoverBorderFor(root.ink, Color.accent) : Util.alpha(root.ink, 0.12)
    clip: true

    Row {
      id: row
      anchors.centerIn: parent
      spacing: Style.spacing.md

      Text {
        id: glyph
        // A fixed slot, so the title doesn't shift as the spinner turns.
        width: Style.font.body
        anchors.verticalCenter: parent.verticalCenter
        horizontalAlignment: Text.AlignHCenter
        textFormat: Text.PlainText
        text: root.status === "working" ? root.spinner[root.spinnerFrame % root.spinner.length]
                                        : (root.icons[root.status] || "󰄬")
        font.family: Style.font.menuFamily
        font.pixelSize: Style.font.body
        color: root.status === "waiting" ? Color.accent : root.ink
        opacity: root.status === "waiting" || root.status === "working" ? 1 : 0.52
      }

      Text {
        id: title
        anchors.verticalCenter: parent.verticalCenter
        // Leaves room for the rest of the row inside the column.
        width: Math.min(implicitWidth, pill.width - Style.spacing.controlPaddingX * 2
                        - glyph.width - row.spacing - (more.visible ? more.implicitWidth + row.spacing : 0))
        textFormat: Text.PlainText
        elide: Text.ElideRight
        text: root.session ? (root.session.task || "New session") : ""
        font.family: Style.font.menuFamily
        font.pixelSize: Style.font.body
        font.bold: true
        color: root.ink
        opacity: root.session && root.session.task ? 1 : 0.52
      }

      Text {
        id: more
        visible: root.hot
        anchors.verticalCenter: parent.verticalCenter
        textFormat: Text.PlainText
        text: root.session ? root.session.repo + " · " + root.session.name + "  󰏫" : ""
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
}
