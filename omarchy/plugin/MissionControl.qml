import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import Quickshell.Hyprland
import qs.Commons
import qs.Ui

// Mission Control: the left side of the amarchy cockpit, drawn by the Omarchy
// shell so it looks like the rest of Omarchy. Shows while the cockpit is on
// and an amarchy session workspace (A:...) is on screen. With the cockpit off
// it peeks in for a moment when you move between sessions (`amarchy next`).
//
// Click a session to jump to it. The keyboard goes through Hyprland (see
// hypr/amarchy.lua), so the panel never has to take focus; the hints at the
// bottom show those keys. `amarchy focus` can still hand it the keyboard:
// j/k or arrows to move, Enter to jump, n new, a add, x close, Esc to leave.
// IPC: omarchy-shell amarchy refresh|peek|focus|blur
Item {
  id: root

  // Host contract for panel plugins.
  property bool opened: false
  property var shell
  property var manifest
  function open(payloadJson) {}
  function close() {}

  property int cursor: 0
  property bool focused: false
  property int spinnerFrame: 0
  property bool peeking: false

  readonly property string workspaceName: Hyprland.focusedWorkspace ? String(Hyprland.focusedWorkspace.name) : ""
  readonly property bool onSession: workspaceName.indexOf("A:") === 0 || workspaceName.indexOf("F:") === 0
  readonly property bool shown: (store.cockpit || peeking) && onSession && !!screenForPanel
  readonly property var screenForPanel: {
    var name = Hyprland.focusedMonitor ? Hyprland.focusedMonitor.name : ""
    for (var i = 0; i < Quickshell.screens.length; i++)
      if (Quickshell.screens[i].name === name) return Quickshell.screens[i]
    return Quickshell.screens.length ? Quickshell.screens[0] : null
  }
  // Same geometry as the cockpit's terminal on the right: the gap beside
  // Claude's column, minus the space between the two.
  readonly property int panelWidth: screenForPanel
      ? Math.max(Math.floor((screenForPanel.width - store.zenWidth) / 2), 200) - 8 : 0

  function clampCursor() {
    root.cursor = Math.max(0, Math.min(root.cursor, store.sessions.length - 1))
  }

  // What to show under the list: the panel's own keys while it has the
  // keyboard, otherwise the Hyprland keys (prefixed by their modifier).
  readonly property var hintRows: {
    if (root.focused) return [["↵", "jump"], ["n", "new"], ["a", "add"], ["x", "close"]]
    var k = store.keys, rows = []
    function key(name) { return String(k[name]).toLowerCase() }
    if (k.next && k.prev) rows.push([key("next") + "/" + key("prev"), "move"])
    if (k["new"]) rows.push([key("new"), "new"])
    if (k.add) rows.push([key("add"), "add"])
    if (k.close) rows.push([key("close"), "close"])
    return rows
  }

  function activate(index) {
    var s = store.sessions[index]
    if (!s) return
    root.focused = false
    store.run(["jump", s.id])
  }

  Sessions {
    id: store
    interval: root.onSession ? 1000 : 4000
    onSessionsChanged: root.clampCursor()
  }

  Timer {
    interval: 100
    repeat: true
    running: root.shown && store.working > 0
    onTriggered: root.spinnerFrame++
  }

  Timer {
    id: peekTimer
    interval: 1500
    onTriggered: root.peeking = false
  }

  IpcHandler {
    target: "amarchy"
    function refresh(): string { store.refresh(); return "ok" }
    function peek(): string {
      store.refresh()
      root.peeking = true
      peekTimer.restart()
      return "ok"
    }
    function focus(): string {
      if (!root.shown) return "hidden"
      var i = store.sessions.findIndex(function(s) { return s.current })
      root.cursor = i >= 0 ? i : 0
      root.focused = true
      Qt.callLater(function() { keys.forceActiveFocus() })
      return "ok"
    }
    function blur(): string { root.focused = false; return "ok" }
    function ping(): string { return "ok" }
  }

  PanelWindow {
    id: panel
    visible: root.shown
    screen: root.screenForPanel
    anchors { top: true; bottom: true; left: true }
    implicitWidth: root.panelWidth
    color: "transparent"
    WlrLayershell.namespace: "amarchy-mission-control"
    WlrLayershell.layer: WlrLayer.Top
    WlrLayershell.keyboardFocus: root.focused ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None
    // Sit below the bar like a window would, flush with it and the screen edges.
    exclusionMode: ExclusionMode.Normal

    Rectangle {
      anchors.fill: parent
      color: Color.menu.background
    }

    PanelKeyCatcher {
      id: keys
      anchors.fill: parent
      focus: root.focused
      onMoveRequested: function(dx, dy) {
        root.cursor = Math.max(0, Math.min(root.cursor + dy, store.sessions.length - 1))
      }
      onActivateRequested: root.activate(root.cursor)
      onCloseRequested: root.focused = false
      onDeleteRequested: {
        var s = store.sessions[root.cursor]
        if (!s) return
        root.focused = false
        store.run(["close", s.id, "--confirm"])
      }
      onTextKey: function(t) {
        if (t === "n") { root.focused = false; store.run(["new"]) }
        else if (t === "a") { root.focused = false; store.run(["add"]) }
      }

      Item {
        anchors.fill: parent
        anchors.margins: Style.spacing.panelPadding

        Text {
          id: header
          anchors.top: parent.top
          anchors.left: parent.left
          anchors.leftMargin: Style.space(8)
          textFormat: Text.PlainText
          text: "Amarchy…"
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.heading
          color: Color.menu.text
          opacity: 0.58
        }

        Flickable {
          anchors.top: header.bottom
          anchors.topMargin: Style.spacing.panelGap
          anchors.left: parent.left
          anchors.right: parent.right
          anchors.bottom: hints.top
          anchors.bottomMargin: Style.spacing.md
          contentHeight: sessionList.implicitHeight
          clip: true
          boundsBehavior: Flickable.StopAtBounds

          SessionList {
            id: sessionList
            width: parent.width
            sessions: store.sessions
            cursor: root.focused ? root.cursor : -1
            spinnerFrame: root.spinnerFrame
            onActivated: function(index) { root.activate(index) }
            onHovered: function(index) { if (root.focused) root.cursor = index }
          }
        }

        Column {
          visible: store.sessions.length === 0
          anchors.centerIn: parent
          spacing: Style.spacing.md
          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "󰚩"
            font.family: Style.font.menuFamily
            font.pixelSize: Style.font.displayLarge
            color: Color.menu.selectedText
            opacity: 0.8
          }
          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "No agents running"
            font.family: Style.font.menuFamily
            font.pixelSize: Style.font.title
            color: Color.menu.text
            opacity: 0.7
          }
        }

        Row {
          id: hints
          anchors.bottom: parent.bottom
          anchors.left: parent.left
          anchors.leftMargin: Style.space(8)
          spacing: Style.spacing.xl
          opacity: root.focused ? 0.7 : 0.4
          Text {
            visible: !root.focused && !!store.keys.mod && root.hintRows.length > 0
            text: store.keys.mod || ""
            font.family: Style.font.menuFamily
            font.pixelSize: Style.font.caption
            color: Color.menu.text
          }
          Repeater {
            model: root.hintRows
            Row {
              required property var modelData
              spacing: Style.spacing.sm
              Text {
                text: modelData[0]
                font.family: Style.font.menuFamily
                font.pixelSize: Style.font.caption
                color: Color.menu.selectedText
              }
              Text {
                text: modelData[1]
                font.family: Style.font.menuFamily
                font.pixelSize: Style.font.caption
                color: Color.menu.text
              }
            }
          }
        }
      }
    }
  }
}
