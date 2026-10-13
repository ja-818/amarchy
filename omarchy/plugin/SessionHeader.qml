import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import qs.Commons

// The strip above the zen column with the name of the session on screen:
// what it's about on the left, project · branch on the right. `amarchy
// layout` keeps the room for it free on session workspaces, so it only shows
// there. Click the name to rename the session.
PanelWindow {
  id: root

  property var sessions: []
  property int zenWidth: 900
  property int stripHeight: 0
  signal renameRequested()

  readonly property var monitor: screen ? Hyprland.monitorFor(screen) : null
  readonly property string workspace: monitor && monitor.activeWorkspace ? monitor.activeWorkspace.name : ""
  readonly property var session: {
    for (var i = 0; i < sessions.length; i++) if (sessions[i].workspace === workspace) return sessions[i]
    return null
  }

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
  mask: Region { item: title }

  Rectangle {
    id: strip
    width: Math.min(root.zenWidth, parent.width)
    height: parent.height
    anchors.horizontalCenter: parent.horizontalCenter
    color: Color.bar.background

    Text {
      id: title
      anchors.left: parent.left
      anchors.leftMargin: Style.spacing.rowPaddingX
      anchors.verticalCenter: parent.verticalCenter
      width: Math.min(implicitWidth, parent.width - where.width - Style.spacing.rowPaddingX * 3)
      textFormat: Text.PlainText
      elide: Text.ElideRight
      text: root.session ? (root.session.task || "new session") : ""
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.body
      font.weight: Font.Medium
      color: Color.bar.text
      opacity: root.session && root.session.task ? 1 : 0.52

      MouseArea {
        anchors.fill: parent
        cursorShape: Qt.PointingHandCursor
        onClicked: root.renameRequested()
      }
    }

    Text {
      id: where
      anchors.right: parent.right
      anchors.rightMargin: Style.spacing.rowPaddingX
      anchors.verticalCenter: parent.verticalCenter
      textFormat: Text.PlainText
      text: root.session ? root.session.repo + " · " + root.session.name : ""
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.caption
      color: Color.bar.text
      opacity: 0.52
    }
  }
}
