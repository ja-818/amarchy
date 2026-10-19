import QtQuick 6.11
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Ui

// The chime of amarchy's notifications (`amarchy sound`), in a card like the
// Omarchy menu's, centered on the monitor you're on over the same dimmed
// screen: every sound by its name, the one set now checked. Each one plays as the
// cursor lands on it (the arrows, j/k, or the pointer), cutting off the one
// before, so you hear them as you go down the list. Enter or a click sets it,
// Esc leaves it as it was.
Item {
  id: root

  property bool opened: false
  // {kind: "sound" | "off" | "add", name, label}
  property var rows: []
  property string current: ""
  property int cursor: 0

  // The list first (`amarchy sound --list --json`, ~30ms), then the panel.
  function open() {
    if (!lister.running) lister.running = true
  }

  function close() {
    root.opened = false
    previewDelay.stop()
  }

  function amarchy(args) {
    Quickshell.execDetached(["sh", "-c", 'unset AMARCHY_SESSION; exec "$HOME/.local/bin/amarchy" "$@"', "amarchy"].concat(args))
  }

  function moveCursor(dy) {
    root.hover(Math.max(0, Math.min(root.cursor + dy, root.rows.length - 1)))
  }

  // The cursor on a row plays it, once it rests there a moment: running
  // down the list plays where you stop, not every row on the way.
  function hover(index) {
    if (index === root.cursor) return
    root.cursor = index
    previewDelay.restart()
  }

  function preview() {
    var r = root.rows[root.cursor]
    if (!r) return
    root.amarchy(r.kind === "sound" ? ["sound", "--play", r.name] : ["sound", "--stop"])
  }

  function choose(index) {
    var r = root.rows[index]
    if (!r) return
    root.close()
    if (r.kind === "add") {
      root.amarchy(["sound", "--add"])
    } else {
      root.current = r.name
      root.amarchy(["sound", r.name])
    }
  }

  Timer {
    id: previewDelay
    interval: 120
    onTriggered: root.preview()
  }

  Process {
    id: lister
    command: ["sh", "-c", 'exec "$HOME/.local/bin/amarchy" sound --list --json']
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var d
        try { d = JSON.parse(text) } catch (e) { return }
        var rows = (d.sounds || []).map(function(s) { return { kind: "sound", name: s.name, label: s.label } })
        rows.push({ kind: "off", name: "off", label: "Off" })
        rows.push({ kind: "add", name: "", label: "Add your own" })
        root.rows = rows
        root.current = d.current || ""
        var at = rows.findIndex(function(r) { return r.kind !== "add" && r.name === root.current })
        root.cursor = Math.max(0, at)
        root.opened = true
      }
    }
  }

  // The monitor you're on, where the Omarchy menu would open.
  readonly property var screen: {
    var name = Hyprland.focusedMonitor ? Hyprland.focusedMonitor.name : ""
    for (var i = 0; i < Quickshell.screens.length; i++) if (Quickshell.screens[i].name === name) return Quickshell.screens[i]
    return Quickshell.screens.length ? Quickshell.screens[0] : null
  }

  PanelWindow {
    id: panel
    visible: root.opened
    screen: root.screen
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "amarchy-sound"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle {
      anchors.fill: parent
      color: Color.menu.scrim
    }

    // A click beside the card closes it, as in the menu.
    MouseArea {
      anchors.fill: parent
      onClicked: root.close()
    }

    BorderSurface {
      id: card
      width: Math.min(Style.space(300), panel.width - Style.gapsOut * 2)
      height: Math.min(column.implicitHeight + contentTopInset + contentBottomInset, panel.height - Style.gapsOut * 2)
      anchors.centerIn: parent
      radius: Style.cornerRadius
      color: Color.menu.background
      borderSpec: Border.surfaceSpec("menu", "border", Color.menu.border, Math.max(1, Style.space(2)))
      padding: Style.spacing.panelPadding
      clip: true

      MouseArea { anchors.fill: parent; onClicked: {} }

      Item {
        id: keys
        anchors.fill: parent
        focus: true
        Keys.priority: Keys.BeforeItem
        Keys.onPressed: function(event) {
          if (event.key === Qt.Key_Escape) root.close()
          else if (event.key === Qt.Key_Down || event.key === Qt.Key_Tab || event.text === "j") root.moveCursor(1)
          else if (event.key === Qt.Key_Up || event.key === Qt.Key_Backtab || event.text === "k") root.moveCursor(-1)
          else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter || event.key === Qt.Key_Space) root.choose(root.cursor)
          else return
          event.accepted = true
        }
      }

      Column {
        id: column
        x: card.contentLeftInset
        y: card.contentTopInset
        width: card.width - card.contentLeftInset - card.contentRightInset
        spacing: Style.spacing.md

        // The menu's header: what this is, dimmed.
        Text {
          width: parent.width
          height: Math.max(Style.space(34), Style.font.title + Style.spacing.controlPaddingY * 2)
          verticalAlignment: Text.AlignVCenter
          textFormat: Text.PlainText
          text: "Sound…"
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.heading
          color: Color.menu.text
          opacity: 0.58
        }

        Column {
          id: list
          width: parent.width
          spacing: Style.spacing.xs

          Repeater {
            model: root.rows

            // A row of the Omarchy menu: an icon in a fixed slot, the name.
            delegate: BorderSurface {
              id: row
              required property var modelData
              required property int index
              readonly property bool hasCursor: index === root.cursor
              readonly property bool isCurrent: modelData.kind !== "add" && modelData.name === root.current

              width: list.width
              height: Math.max(Style.space(50), Style.font.body + Style.spacing.rowPaddingX * 2)
              radius: Style.cornerRadius
              color: hasCursor ? Color.menu.selectedBackground : "transparent"
              borderSpec: hasCursor ? Border.surfaceSpec("menu", "selected-border", Color.menu.selectedBorder, 0) : Border.none()

              Text {
                id: icon
                width: Style.space(36)
                anchors.left: parent.left
                anchors.leftMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                horizontalAlignment: Text.AlignHCenter
                textFormat: Text.PlainText
                text: row.isCurrent ? "󰄬" : (row.modelData.kind === "off" ? "󰖁" : row.modelData.kind === "add" ? "󰐕" : "󰕾")
                font.family: Style.font.menuFamily
                font.pixelSize: Style.font.iconLarge
                color: row.hasCursor ? Color.menu.selectedText : Color.menu.text
              }

              Text {
                anchors.left: icon.right
                anchors.leftMargin: Style.space(6)
                anchors.right: parent.right
                anchors.rightMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                textFormat: Text.PlainText
                elide: Text.ElideRight
                text: row.modelData.label
                font.family: Style.font.menuFamily
                font.pixelSize: Style.font.heading
                font.weight: Font.Medium
                color: row.hasCursor ? Color.menu.selectedText : Color.menu.text
              }

              MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onEntered: root.hover(row.index)
                onClicked: root.choose(row.index)
              }
            }
          }
        }
      }
    }
  }

  // The keyboard comes to the list each time it opens.
  onOpenedChanged: if (opened) Qt.callLater(function() { keys.forceActiveFocus() })
}
