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
  property bool cockpit: false
  property int zenWidth: 900
  // The session keys bound in Hyprland: { mod: "Ctrl+Alt", next: "J", ... }
  property var keys: ({})

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
          root.cockpit = !!d.cockpit
          root.zenWidth = d.zen_width || 900
          root.keys = d.keys || {}
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
