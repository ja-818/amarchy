import QtQuick 6.11
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Ui

// The amarchy menu (`amarchy menu`, Ctrl+Alt+M), in a card like the Omarchy
// menu's, centered on the monitor you're on over the same dimmed screen. One
// line a row; a group has a chevron and opens with → or ↵, and ← or Backspace
// go back up, but never out of amarchy (this is its own menu, not Omarchy's).
// The selected row shows its key. Typing searches every row, groups included.
// What's in it comes from `amarchy menu --json`, made for where you are.
Item {
  id: root

  property bool opened: false
  // [{icon, label, key, command, checked, children}]
  property var tree: []
  property string title: "Amarchy"
  // The groups you're in: [{label, items}], the menu itself first.
  property var stack: []
  property string filter: ""
  property int cursor: 0
  // A group to open right away (`amarchy keys` opens Settings/Keys).
  property string openAt: ""

  readonly property var level: stack.length ? stack[stack.length - 1] : ({ label: title, items: [] })

  // While searching, every row that can be run, with the group it's in.
  readonly property var rows: {
    if (filter === "") return level.items
    var words = filter.toLowerCase().split(/\s+/).filter(function(w) { return w !== "" })
    var out = []
    function walk(items, where) {
      for (var i = 0; i < items.length; i++) {
        var it = items[i]
        var name = (it.label + " " + where).toLowerCase()
        if (!it.children && words.every(function(w) { return name.indexOf(w) >= 0 }))
          out.push(Object.assign({ where: where }, it))
        if (it.children) walk(it.children, it.label)
      }
    }
    walk(tree, "")
    return out
  }

  function open(path) {
    root.openAt = path || ""
    if (!lister.running) lister.running = true
  }

  function close() {
    root.opened = false
  }

  function amarchy(args) {
    Quickshell.execDetached(["sh", "-c", 'unset AMARCHY_SESSION; exec "$HOME/.local/bin/amarchy" "$@"', "amarchy"].concat(args))
  }

  function moveCursor(dy) {
    if (root.rows.length === 0) return
    root.cursor = (root.cursor + dy + root.rows.length) % root.rows.length
  }

  function enter(item) {
    root.filter = ""
    root.stack = root.stack.concat([{ label: item.label, items: item.children }])
    root.cursor = 0
  }

  function back() {
    if (root.stack.length <= 1) return
    var from = root.level.label
    root.stack = root.stack.slice(0, root.stack.length - 1)
    // Back on the group you came out of.
    root.cursor = Math.max(0, root.level.items.findIndex(function(it) { return it.label === from }))
  }

  function choose(index) {
    var it = root.rows[index]
    if (!it) return
    if (it.children) {
      root.enter(it)
      return
    }
    root.close()
    root.amarchy(it.command)
  }

  Process {
    id: lister
    command: ["sh", "-c", 'unset AMARCHY_SESSION; exec "$HOME/.local/bin/amarchy" menu --json']
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var d
        try { d = JSON.parse(text) } catch (e) { return }
        root.tree = d.items || []
        root.title = d.title || "Amarchy"
        root.stack = [{ label: root.title, items: root.tree }]
        root.filter = ""
        root.cursor = 0
        var path = root.openAt ? root.openAt.split("/") : []
        for (var i = 0; i < path.length; i++) {
          var g = root.level.items.find(function(it) { return it.children && it.label === path[i] })
          if (!g) break
          root.enter(g)
        }
        root.opened = true
      }
    }
  }

  onFilterChanged: root.cursor = 0

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
    WlrLayershell.namespace: "amarchy-menu"
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
      width: Math.min(Style.space(380), panel.width - Style.gapsOut * 2)
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
          var k = event.key
          var ctrl = event.modifiers & Qt.ControlModifier
          if (k === Qt.Key_Escape) {
            if (root.filter !== "") root.filter = ""
            else root.close()
          } else if (k === Qt.Key_Down || k === Qt.Key_Tab || (ctrl && k === Qt.Key_J) || (ctrl && k === Qt.Key_N)) {
            root.moveCursor(1)
          } else if (k === Qt.Key_Up || k === Qt.Key_Backtab || (ctrl && k === Qt.Key_K) || (ctrl && k === Qt.Key_P)) {
            root.moveCursor(-1)
          } else if (k === Qt.Key_Return || k === Qt.Key_Enter) {
            root.choose(root.cursor)
          } else if (k === Qt.Key_Right && root.filter === "") {
            var it = root.rows[root.cursor]
            if (it && it.children) root.enter(it)
          } else if (k === Qt.Key_Left && root.filter === "") {
            root.back()
          } else if (k === Qt.Key_Backspace) {
            if (root.filter !== "") root.filter = root.filter.slice(0, -1)
            else root.back()
          } else if (event.text && event.text.length === 1 && event.text >= " " && !ctrl) {
            root.filter += event.text
          } else {
            return
          }
          event.accepted = true
        }
      }

      Column {
        id: column
        x: card.contentLeftInset
        y: card.contentTopInset
        width: card.width - card.contentLeftInset - card.contentRightInset
        spacing: Style.spacing.md

        // The menu's header: where you are, dimmed, or what you're typing.
        Text {
          width: parent.width
          height: Math.max(Style.space(34), Style.font.title + Style.spacing.controlPaddingY * 2)
          verticalAlignment: Text.AlignVCenter
          textFormat: Text.PlainText
          elide: Text.ElideRight
          text: root.filter !== "" ? root.filter : root.level.label + "…"
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.heading
          color: Color.menu.text
          opacity: root.filter !== "" ? 1 : 0.58
        }

        Column {
          id: list
          width: parent.width
          spacing: Style.spacing.xs

          Repeater {
            model: root.rows

            // A row of the Omarchy menu: an icon in a fixed slot, the name
            // (✓ when it's the one set), and on the right a chevron for a
            // group, the key on the selected row, or where a search found it.
            delegate: BorderSurface {
              id: row
              required property var modelData
              required property int index
              readonly property bool hasCursor: index === root.cursor
              readonly property color ink: hasCursor ? Color.menu.selectedText : Color.menu.text
              readonly property string side: modelData.children ? "󰅂"
                : hasCursor && modelData.key ? modelData.key
                : root.filter !== "" ? (modelData.where || "") : ""

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
                text: row.modelData.icon
                font.family: Style.font.menuFamily
                font.pixelSize: Style.font.iconLarge
                color: row.ink
              }

              Text {
                anchors.left: icon.right
                anchors.leftMargin: Style.space(6)
                anchors.right: sideText.left
                anchors.rightMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                textFormat: Text.PlainText
                elide: Text.ElideRight
                text: row.modelData.label + (row.modelData.checked ? "  ✓" : "")
                font.family: Style.font.menuFamily
                font.pixelSize: Style.font.heading
                font.weight: Font.Medium
                color: row.ink
              }

              Text {
                id: sideText
                anchors.right: parent.right
                anchors.rightMargin: Style.space(12)
                anchors.verticalCenter: parent.verticalCenter
                textFormat: Text.PlainText
                text: row.side
                font.family: Style.font.menuFamily
                font.pixelSize: row.modelData.children ? Style.font.body : Style.font.bodySmall
                color: row.ink
                opacity: row.modelData.children ? 0.6 : 0.52
              }

              MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onEntered: root.cursor = row.index
                onClicked: root.choose(row.index)
              }
            }
          }
        }

        Text {
          width: parent.width
          visible: root.rows.length === 0
          leftPadding: Style.space(8)
          textFormat: Text.PlainText
          text: "Nothing called “" + root.filter + "”"
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.body
          color: Color.menu.text
          opacity: 0.52
        }
      }
    }
  }

  // The keyboard comes to the card each time it opens.
  onOpenedChanged: if (opened) Qt.callLater(function() { keys.forceActiveFocus() })
}
