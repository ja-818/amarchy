import QtQuick 6.11
import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import qs.Commons

// Your sessions in the gap left of Claude's column, the way the terminal
// fills the one on the right. `amarchy layout` keeps that gap free on session
// workspaces, so it only shows there, and not in zen mode (`amarchy zen`).
// It doesn't take the keyboard (the session keys go through Hyprland) until
// you click its search, or `amarchy search` asks for it: `keyboard` hands it
// over. Whatever is declared inside fills the panel, inside its padding, and
// does its own scrolling.
PanelWindow {
  id: root

  property var sessions: []
  property bool zen: true
  property int zenWidth: 900
  property int gap: 8
  // As see-through as the terminal on the other side of Claude.
  property real alpha: 1
  // Take the keyboard, for the search.
  property bool keyboard: false
  // Asked for from the keyboard (`amarchy search`): the pointer is still on
  // Claude, and on OnDemand Hyprland would hand the keyboard straight back to
  // it. So keep it Exclusive until the pointer comes onto the list; from then
  // on it's as if the search was clicked.
  property bool holdKeyboard: false
  property bool focusPrimed: false
  property bool pointerSeen: false
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
  // Like the shell's own panels: Exclusive for a moment, since Hyprland only
  // hands the keyboard to an already mapped surface that way, then OnDemand so
  // Claude or the terminal take it back as soon as the pointer is on them.
  WlrLayershell.keyboardFocus: keyboard
    ? (focusPrimed && (!holdKeyboard || pointerSeen || hover.hovered) ? WlrKeyboardFocus.OnDemand : WlrKeyboardFocus.Exclusive)
    : WlrKeyboardFocus.None

  onKeyboardChanged: {
    focusPrimed = false
    pointerSeen = false
    if (keyboard) focusPrimeTimer.restart()
    else focusPrimeTimer.stop()
  }

  Timer {
    id: focusPrimeTimer
    interval: 75
    onTriggered: if (root.keyboard) root.focusPrimed = true
  }

  Rectangle {
    anchors.fill: parent
    color: Util.alpha(Color.menu.background, root.alpha)

    HoverHandler {
      id: hover
      onHoveredChanged: if (hovered) root.pointerSeen = true
    }
  }

  Item {
    id: holder
    anchors.fill: parent
    anchors.margins: Style.spacing.panelPadding
  }
}
