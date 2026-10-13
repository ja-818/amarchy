import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import qs.Commons

// Your sessions in the gap left of Claude's column, the way the terminal
// fills the one on the right. `amarchy layout` keeps that gap free on session
// workspaces, so it only shows there, and not in zen mode (`amarchy zen`).
// It never takes the keyboard: the session keys go through Hyprland. Whatever
// is declared inside is laid out in the panel, scrolling when it's too tall.
PanelWindow {
  id: root

  property var sessions: []
  property bool zen: true
  property int zenWidth: 900
  property int gap: 8
  // As see-through as the terminal on the other side of Claude.
  property real alpha: 1
  default property alias content: holder.data

  readonly property var monitor: screen ? Hyprland.monitorFor(screen) : null
  readonly property string workspace: monitor && monitor.activeWorkspace ? monitor.activeWorkspace.name : ""
  readonly property bool onSession: {
    for (var i = 0; i < sessions.length; i++) if (sessions[i].workspace === workspace) return true
    return false
  }
  readonly property int panelWidth: screen ? Math.floor((screen.width - zenWidth) / 2) - gap : 0

  visible: !zen && onSession && panelWidth > 0
  color: "transparent"
  implicitWidth: Math.max(1, panelWidth)
  anchors { top: true; bottom: true; left: true }
  // Not exclusive itself, but it does make way for the bar.
  exclusiveZone: 0

  WlrLayershell.namespace: "amarchy-sessions"
  WlrLayershell.layer: WlrLayer.Bottom
  WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

  Rectangle {
    anchors.fill: parent
    color: Util.alpha(Color.menu.background, root.alpha)
  }

  Flickable {
    id: flick
    anchors.fill: parent
    anchors.margins: Style.spacing.panelPadding
    contentHeight: holder.childrenRect.height
    clip: true
    boundsBehavior: Flickable.StopAtBounds

    Item {
      id: holder
      width: flick.width
      height: childrenRect.height
    }
  }
}
