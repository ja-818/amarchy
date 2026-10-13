import QtQuick
import Quickshell
import Quickshell.Io

// amarchy's state, polled from the CLI (`amarchy ui`, ~30ms). Everything the
// plugin shows comes from here; everything it does goes back through the CLI.
Item {
  id: root

  property int interval: 1000
  property bool active: true
  property var sessions: []
  // Zen mode: Claude alone in its column, nothing beside it.
  property bool zen: true
  // Width of Claude's column on session workspaces, in logical pixels.
  property int zenWidth: 900
  // Space between the column and the panels beside it.
  property int panelGap: 8
  // How opaque the session terminal's background is; the list beside Claude matches it.
  property real terminalAlpha: 1
  // Height of the strip kept free above it for the session's name (0: none).
  property int headerHeight: 0
  // The session keys bound in Hyprland: { mod: "Ctrl+Alt", next: "J", ... }
  property var keys: ({})
  // How the list is ordered: "opened" (as opened) or "activity".
  property string order: "opened"

  readonly property int waiting: count("waiting")
  readonly property int working: count("working")

  function count(status) {
    var n = 0
    for (var i = 0; i < sessions.length; i++) if (sessions[i].status === status) n++
    return n
  }

  function refresh() {
    if (!proc.running) proc.running = true
  }

  // Runs `amarchy <args...>` detached, e.g. run(["jump", id]).
  function run(args) {
    Quickshell.execDetached(["sh", "-c", 'exec "$HOME/.local/bin/amarchy" "$@"', "amarchy"].concat(args))
    refreshSoon.restart()
  }

  Process {
    id: proc
    command: ["sh", "-c", 'exec "$HOME/.local/bin/amarchy" ui']
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        try {
          var d = JSON.parse(text)
          root.sessions = d.sessions || []
          root.keys = d.keys || {}
          root.order = d.order || "opened"
          root.zen = d.zen !== false
          root.zenWidth = d.zen_width || 900
          root.panelGap = d.panel_gap || 8
          root.terminalAlpha = d.terminal_alpha > 0 ? d.terminal_alpha : 1
          root.headerHeight = d.header_height || 0
        } catch (e) {}
      }
    }
  }

  Timer {
    interval: root.interval
    running: root.active
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  Timer {
    id: refreshSoon
    interval: 250
    onTriggered: root.refresh()
  }
}
