import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

// The amarchy bar widget: an anarchy A that lights up (urgent) when a session
// needs you. Click opens your sessions; right click starts a new one. Moving
// between sessions from the keyboard (`amarchy next`) drops the list for a
// moment, without taking the keyboard, to show where you landed.
// IPC: omarchy-shell amarchy-bar toggle|open|close
//      omarchy-shell amarchy refresh|peek
Panel {
  id: root
  moduleName: "amarchy"
  ipcTarget: "amarchy-bar"
  manageIpc: true

  property int cursor: 0
  property int spinnerFrame: 0
  property bool peeking: false

  readonly property int currentIndex: {
    for (var i = 0; i < store.sessions.length; i++) if (store.sessions[i].current) return i
    return -1
  }

  // The session keys bound in Hyprland (hypr/amarchy.lua), for the hints.
  readonly property var hintRows: {
    var k = store.keys, rows = []
    function key(name) { return k[name] === "RETURN" ? "↵" : String(k[name]).toLowerCase() }
    if (k.next && k.prev) rows.push([key("next") + "/" + key("prev"), "move"])
    if (k.terminal) rows.push([key("terminal"), "terminal"])
    if (k["new"]) rows.push([key("new"), "new"])
    if (k.add) rows.push([key("add"), "add"])
    if (k.close) rows.push([key("close"), "close"])
    return rows
  }

  readonly property string summary: {
    var n = store.sessions.length
    if (n === 0) return "No agents running"
    var parts = [n + (n === 1 ? " agent" : " agents")]
    if (store.waiting) parts.push(store.waiting + " needs you")
    if (store.working) parts.push(store.working + " working")
    return parts.join(" · ")
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  function activate(index) {
    var s = store.sessions[index]
    if (!s) return
    root.close()
    store.run(["jump", s.id])
  }

  onOpenedChanged: {
    if (!opened) return
    root.peeking = false
    store.refresh()
    root.cursor = Math.max(0, root.currentIndex)
    Qt.callLater(function() { keys.forceActiveFocus() })
  }

  Sessions {
    id: store
    interval: root.opened ? 1000 : 3000
  }

  Timer {
    interval: 100
    repeat: true
    running: (root.opened || root.peeking) && store.working > 0
    onTriggered: root.spinnerFrame++
  }

  Timer {
    id: peekTimer
    interval: 450
    onTriggered: root.peeking = false
  }

  IpcHandler {
    target: "amarchy"
    function refresh(): string { store.refresh(); return "ok" }
    function peek(): string {
      store.refresh()
      if (!root.opened) root.peeking = true
      peekTimer.restart()
      return "ok"
    }
    function ping(): string { return "ok" }
  }

  // The peek: a passive card under the Ⓐ, so the keyboard stays where it is.
  PopupCard {
    anchorItem: button
    bar: root.bar
    triggerMode: "hover"
    open: root.peeking && !root.opened && store.sessions.length > 0
    contentWidth: fittedContentWidth(Style.space(380))
    contentHeight: fittedContentHeight(peekList.implicitHeight, Style.space(640))

    SessionList {
      id: peekList
      width: parent.width
      sessions: store.sessions
      cursor: root.currentIndex
      spinnerFrame: root.spinnerFrame
    }
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "Ⓐ"
    active: store.waiting > 0
    onPressed: function(buttonCode) {
      if (buttonCode === Qt.RightButton) store.run(["new"])
      else root.toggle()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keys
    contentWidth: panel.fittedContentWidth(Style.space(380))
    contentHeight: panel.fittedContentHeight(column.implicitHeight, Style.space(640))

    PanelKeyCatcher {
      id: keys
      anchors.fill: parent
      onMoveRequested: function(dx, dy) {
        root.cursor = Math.max(0, Math.min(root.cursor + dy, store.sessions.length - 1))
      }
      onActivateRequested: root.activate(root.cursor)
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onDeleteRequested: {
        var s = store.sessions[root.cursor]
        if (!s) return
        root.close()
        store.run(["close", s.id, "--confirm"])
      }
      onTextKey: function(t) {
        if (t === "n") { root.close(); store.run(["new"]) }
        else if (t === "a") { root.close(); store.run(["add"]) }
      }

      Column {
        id: column
        width: parent.width
        spacing: Style.spacing.panelGap

        PanelHero {
          width: parent.width
          title: "Amarchy"
          meta: root.summary
          iconComponent: Component {
            Text {
              text: "Ⓐ"
              font.family: Style.font.menuFamily
              font.pixelSize: Style.font.displayLarge
              color: store.waiting > 0 ? Color.urgent : Color.menu.selectedText
            }
          }
        }

        SessionList {
          width: parent.width
          visible: store.sessions.length > 0
          sessions: store.sessions
          cursor: root.cursor
          spinnerFrame: root.spinnerFrame
          onActivated: function(index) { root.activate(index) }
          onHovered: function(index) { root.cursor = index }
        }

        PanelSeparator { width: parent.width }

        Row {
          spacing: Style.spacing.controlGap
          Button {
            iconText: "󰐕"
            text: "New session"
            bordered: true
            onClicked: { root.close(); store.run(["new"]) }
          }
          Button {
            iconText: "󰉋"
            text: "Add project"
            bordered: true
            onClicked: { root.close(); store.run(["add"]) }
          }
        }

        Row {
          visible: root.hintRows.length > 0
          spacing: Style.spacing.xl
          opacity: 0.5
          Text {
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
