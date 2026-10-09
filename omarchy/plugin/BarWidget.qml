import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

// The amarchy bar widget: an anarchy A that lights up (urgent) when a session
// needs you. Click opens your sessions; right click starts a new one.
// IPC: omarchy-shell amarchy-bar toggle|open|close
Panel {
  id: root
  moduleName: "amarchy"
  ipcTarget: "amarchy-bar"
  manageIpc: true

  property int cursor: 0
  property int spinnerFrame: 0

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
    store.refresh()
    root.cursor = 0
    Qt.callLater(function() { keys.forceActiveFocus() })
  }

  Sessions {
    id: store
    interval: root.opened ? 1000 : 3000
  }

  Timer {
    interval: 100
    repeat: true
    running: root.opened && store.working > 0
    onTriggered: root.spinnerFrame++
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
        if (s) store.run(["close", s.id])
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
      }
    }
  }
}
