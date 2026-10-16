import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Ui

// The amarchy bar widget: an anarchy A that lights up (urgent) when a session
// needs you. Click opens your sessions; right click starts a new one. On a
// session the same list sits in the gap left of Claude. In zen mode (`amarchy
// zen`) it doesn't, and moving between sessions from the keyboard (`amarchy
// next`) drops the list for a moment, without taking the keyboard, to show
// where you landed.
// Above the list there is only the Ⓐ Amarchy button (the menu: everything else
// amarchy does), New session and a search by name (its placeholder is the key
// that puts the keyboard in it), with one 󰒼 button next to it that opens how
// the list is grouped (by project, priority, status).
// IPC: omarchy-shell amarchy-bar toggle|open|close
//      omarchy-shell amarchy refresh|peek|search|sounds|zen <true|false>
Panel {
  id: root
  moduleName: "amarchy"
  ipcTarget: "amarchy-bar"
  manageIpc: true

  property int cursor: 0
  property int spinnerFrame: 0
  property bool peeking: false
  // What's typed in the search; the popup and the list beside Claude share it.
  property string query: ""
  // The list beside Claude has the keyboard: its search was clicked, or asked
  // for from the keyboard (searchFromKeys).
  property bool searching: false
  property bool searchFromKeys: false
  // Open the popup with the keyboard in its search (`amarchy search`).
  property bool searchOnOpen: false

  // As wide as the gap beside the zen column, so on a session the panel sits
  // next to Claude instead of over it. Same width everywhere else.
  readonly property int panelWidth: {
    var gap = panel.screenW > 0 ? Math.floor((panel.screenW - store.zenWidth) / 2) - Style.gapsOut : 0
    return Math.max(Style.space(240), gap > 0 ? gap : Style.space(380))
  }

  // The sessions on the list: all of them, or the ones the search matches by
  // name (what the session is about, its project and its branch), every word
  // of it.
  readonly property var shown: {
    var words = query.toLowerCase().split(/\s+/).filter(function(w) { return w !== "" })
    if (words.length === 0) return store.sessions
    return store.sessions.filter(function(s) {
      var name = ((s.task || "") + " " + (s.claude_title || "") + " " + (s.repo || "") + " " + (s.name || "")).toLowerCase()
      return words.every(function(w) { return name.indexOf(w) >= 0 })
    })
  }

  readonly property int currentIndex: {
    for (var i = 0; i < shown.length; i++) if (shown[i].current) return i
    return -1
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  // "Ctrl+Alt+N": the key bound in Hyprland (hypr/amarchy.lua), as a tooltip.
  // Short, so it fits the list beside Claude.
  function keyHint(name) {
    var k = store.keys[name]
    if (!k) return ""
    return (store.keys.mod ? store.keys.mod + "+" : "") + k.charAt(0) + k.slice(1).toLowerCase()
  }

  function activate(index) {
    var s = root.shown[index]
    if (!s) return
    root.close()
    root.endSearch()
    store.run(["jump", s.id])
  }

  function moveCursor(dy) {
    root.cursor = Math.max(0, Math.min(root.cursor + dy, root.shown.length - 1))
  }

  // Run something from the buttons: the list steps out of its way.
  function act(args) {
    root.close()
    root.endSearch()
    store.run(args)
  }

  // Switch a grouping ("project", "priority", "status"), or drop them all
  // ("none"). The menu checks it at once; the list follows when the CLI has
  // it in its new order.
  function group(what) {
    if (what === "none") {
      store.byProject = store.byPriority = store.byStatus = false
      store.run(["group", "none"])
      return
    }
    var on
    if (what === "project") on = store.byProject = !store.byProject
    else if (what === "priority") on = store.byPriority = !store.byPriority
    else on = store.byStatus = !store.byStatus
    store.run(["group", what, on ? "on" : "off"])
  }

  // Raise ("up") or lower ("down") the priority of the session under the
  // cursor; the list reorders and the cursor goes with it.
  function prioritize(direction) {
    var s = root.shown[root.cursor]
    if (s) store.run(["priority", direction, "--id", s.id])
  }

  // Put the keyboard in the search, from the keyboard: the same as clicking
  // it. On a session that's the list beside Claude, which holds the keyboard
  // until Esc or ↵ (or, once the pointer has been on it, a click on Claude);
  // elsewhere, and in zen mode, the list under the Ⓐ.
  function search() {
    if (root.opened) {
      column.focusSearch()
    } else if (side.visible) {
      if (!root.searching) {
        root.cursor = Math.max(0, root.currentIndex)
        root.searchFromKeys = true
      }
      root.searching = true
      sideContent.focusSearch()
    } else {
      root.searchOnOpen = true
      root.open()
    }
  }

  // Back to the whole list, and the keyboard back to where it was.
  function endSearch() {
    root.query = ""
    root.searching = false
    root.searchFromKeys = false
  }

  // The cursor follows the search: on the first match while typing, back on
  // the session on screen once it's cleared.
  onQueryChanged: root.cursor = query !== "" ? 0 : Math.max(0, root.currentIndex)
  // When the list reorders (a priority, a status changing), the cursor stays
  // on its session rather than on its old place.
  property string cursorId: ""
  onCursorChanged: cursorId = shown[cursor] ? shown[cursor].id : ""
  onShownChanged: {
    for (var i = 0; i < shown.length; i++) {
      if (shown[i].id === cursorId) { root.cursor = i; return }
    }
    if (root.cursor >= shown.length) root.cursor = Math.max(0, shown.length - 1)
  }

  onOpenedChanged: {
    column.closeMenu()
    if (!opened) {
      root.searchOnOpen = false
      root.query = ""
      return
    }
    root.peeking = false
    root.searching = false
    root.searchFromKeys = false
    store.refresh()
    root.query = ""
    root.cursor = Math.max(0, root.currentIndex)
  }

  Sessions {
    id: store
    interval: root.opened || side.visible || header.visible ? 1000 : 3000
  }

  Timer {
    interval: 100
    repeat: true
    running: (root.opened || root.peeking || side.visible || header.spinning) && store.working > 0
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
      // Moving between sessions walks all of them, so show all of them.
      root.endSearch()
      // No need when the list is already on screen beside Claude.
      if (!root.opened && !side.visible) root.peeking = true
      peekTimer.restart()
      return "ok"
    }
    function search(): string { root.search(); return "ok" }
    // The notification sound, picked by ear (`amarchy sound`).
    function sounds(): string { root.close(); soundPicker.open(); return "ok" }
    // Zen mode was toggled: the list beside Claude follows right away.
    function zen(on: bool): string { store.zen = on; store.refresh(); return "ok" }
    function ping(): string { return "ok" }
  }

  // What the popup and the list beside Claude show: the menu and New session,
  // the search with the grouping button next to it, and the sessions. The peek
  // is `passive`: the sessions alone. The grouping menu drops over the list.
  component Content: Item {
    id: content
    property int cursor: -1
    property bool passive: false
    // The grouping menu is open; menuCursor is its row under the keyboard
    // (the popup's j/k), -1 for none.
    property bool menuOpen: false
    property int menuCursor: -1
    // The popup has keys for each grouping; the menu shows them.
    property bool showKeys: false
    readonly property Item searchField: search
    readonly property bool searchFocused: search.activeFocus
    signal activated(int index)
    signal hovered(int index)
    signal moved(int dy)
    // The search was clicked / is done with (Esc).
    signal searchRequested()
    signal searchEnded()

    // What the grouping menu offers, in the order they nest. "none" is the
    // plain list.
    readonly property var groupings: [
      { what: "project", icon: "󰉋", label: "Project", key: "P" },
      { what: "priority", icon: "󰈻", label: "Priority", key: "F" },
      { what: "status", icon: "󰉹", label: "Status", key: "S" },
      { what: "none", icon: "󰒼", label: "Not grouped", key: "" }
    ]

    function grouped(what) {
      if (what === "project") return store.byProject
      if (what === "priority") return store.byPriority
      if (what === "status") return store.byStatus
      return !store.byProject && !store.byPriority && !store.byStatus
    }

    function focusSearch() {
      content.closeMenu()
      search.forceActiveFocus()
    }
    function openMenu(withKeyboard) {
      content.menuOpen = true
      content.menuCursor = withKeyboard ? 0 : -1
    }
    function closeMenu() {
      content.menuOpen = false
      content.menuCursor = -1
    }
    function moveMenu(dy) {
      content.menuCursor = Math.max(0, Math.min(content.menuCursor + dy, content.groupings.length - 1))
    }
    // Switch the grouping under the menu's cursor; the menu stays open, to
    // set more than one.
    function pickMenu() {
      var g = content.groupings[content.menuCursor]
      if (g) root.group(g.what)
    }

    // One height for every control up top: the buttons size from their
    // glyphs (the Ⓐ is tall, the group button has no label) and the search
    // from its own padding and a border that changes with hover and focus,
    // so left alone no two would agree. The buttons reserve their largest
    // border, so theirs is steady.
    readonly property real controlHeight: Math.max(brand.implicitHeight, newSession.implicitHeight, organize.implicitHeight)

    implicitHeight: Math.max(stack.implicitHeight, content.menuOpen ? menu.y + menu.height : 0)

    Column {
      id: stack
      width: parent.width
      spacing: Style.spacing.panelGap

      // The two share the row in halves, so it's as wide as the search under
      // it; when the popup is too narrow for that, a label never gets cut:
      // the wider one keeps its size and the other takes what's left.
      Row {
        width: parent.width
        visible: !content.passive
        spacing: Style.spacing.controlGap
        // The name on the door is the menu: everything else amarchy does.
        Button {
          id: brand
          width: Math.max(implicitWidth, Math.min((parent.width - parent.spacing) / 2,
                                                  parent.width - parent.spacing - newSession.implicitWidth))
          height: content.controlHeight
          iconText: "Ⓐ"
          text: "Amarchy"
          tooltipText: root.keyHint("menu")
          bordered: true
          onClicked: root.act(["menu"])
        }
        Button {
          id: newSession
          width: Math.max(implicitWidth, parent.width - parent.spacing - brand.width)
          height: content.controlHeight
          iconText: "󰐕"
          text: "New session"
          tooltipText: root.keyHint("new")
          bordered: true
          onClicked: root.act(["new"])
        }
      }

      Row {
        id: toolbar
        width: parent.width
        visible: !content.passive && store.sessions.length > 0
        spacing: Style.spacing.controlGap

        TextField {
          id: search
          width: parent.width - organize.width - parent.spacing
          height: content.controlHeight
          verticalAlignment: TextInput.AlignVCenter
          // The key that puts the keyboard here; what it's for is plain enough.
          placeholderText: "󰍉  " + (root.keyHint("search") || "Search sessions")
          rightPadding: horizontalPadding + clear.width + Style.spacing.sm

          // Two fields (popup, beside Claude), one query.
          onTextEdited: root.query = text
          onPressed: {
            content.closeMenu()
            content.searchRequested()
          }
          // The keyboard went elsewhere (a click on Claude, say).
          onActiveFocusChanged: if (!activeFocus) content.searchEnded()

          Connections {
            target: root
            function onQueryChanged() { if (search.text !== root.query) search.text = root.query }
          }
          Component.onCompleted: text = root.query

          Keys.onPressed: function(event) {
            if (event.key === Qt.Key_Escape) {
              root.query = ""
              content.searchEnded()
            } else if (event.key === Qt.Key_Down || event.key === Qt.Key_Tab) {
              content.moved(1)
            } else if (event.key === Qt.Key_Up || event.key === Qt.Key_Backtab) {
              content.moved(-1)
            } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
              content.activated(content.cursor)
            } else {
              return
            }
            event.accepted = true
          }

          Text {
            id: clear
            visible: search.text !== ""
            anchors.right: parent.right
            anchors.rightMargin: search.horizontalPadding
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: "󰅖"
            font.family: search.font.family
            font.pixelSize: Style.font.body
            color: search.foreground
            opacity: clearArea.containsMouse ? 1 : 0.52

            MouseArea {
              id: clearArea
              anchors.fill: parent
              anchors.margins: -Style.spacing.sm
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onClicked: root.query = ""
            }
          }
        }

        // How the list is grouped, in a menu; lit while it's grouped at all.
        Button {
          id: organize
          // Square, at the height of everything else.
          width: Math.max(implicitWidth, content.controlHeight)
          height: content.controlHeight
          iconText: "󰒼"
          tooltipText: content.menuOpen ? "" : "Group the list"
          bordered: true
          selected: content.menuOpen || !content.grouped("none")
          onClicked: content.menuOpen ? content.closeMenu() : content.openMenu(false)
        }
      }

      SessionList {
        width: parent.width
        visible: root.shown.length > 0
        sessions: root.shown
        byProject: store.byProject
        byPriority: store.byPriority
        byStatus: store.byStatus
        cursor: content.cursor
        spinnerFrame: root.spinnerFrame
        onActivated: function(index) { content.activated(index) }
        onHovered: function(index) { content.hovered(index) }
      }

      Text {
        width: parent.width
        visible: !content.passive && root.shown.length === 0
        textFormat: Text.PlainText
        elide: Text.ElideRight
        text: store.sessions.length === 0 ? "No sessions yet" : "No session called “" + root.query.trim() + "”"
        font.family: Style.font.menuFamily
        font.pixelSize: Style.font.body
        color: Color.menu.text
        opacity: 0.52
      }
    }

    // A click anywhere off the menu closes it.
    MouseArea {
      anchors.fill: parent
      visible: content.menuOpen
      z: 1
      onClicked: content.closeMenu()
    }

    // The grouping menu: each switch on its own, checked while on; together
    // they nest in the order they're listed. It stays open to set several.
    BorderSurface {
      id: menu
      visible: content.menuOpen
      z: 2
      width: Math.min(parent.width, Style.space(200))
      x: parent.width - width
      y: toolbar.y + toolbar.height + Style.spacing.xxs
      height: menuItems.implicitHeight + topPadding + bottomPadding + borderTop + borderBottom
      radius: Style.cornerRadius
      // Solid, whatever the theme's alpha: the list is right under it.
      color: Util.alpha(Color.popups.background, 1)
      borderSpec: Border.surfaceSpec("popups", "border", Color.popups.border, Style.normalBorderWidth)
      padding: Style.spacing.xs

      // Clicks between the rows stay on the menu.
      MouseArea { anchors.fill: parent }

      Column {
        id: menuItems
        x: menu.contentLeftInset
        y: menu.contentTopInset
        width: menu.width - menu.contentLeftInset - menu.contentRightInset

        Text {
          width: parent.width
          leftPadding: Style.spacing.sm
          topPadding: Style.spacing.xs
          bottomPadding: Style.spacing.xs
          textFormat: Text.PlainText
          text: "GROUP BY"
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.caption
          font.bold: true
          font.letterSpacing: 1.2
          color: Qt.darker(Color.popups.text, 1.4)
        }

        Repeater {
          model: content.groupings

          BorderSurface {
            id: item
            required property var modelData
            required property int index
            readonly property bool on: content.grouped(modelData.what)
            readonly property bool hot: content.menuCursor === index || itemArea.containsMouse

            width: menuItems.width
            height: Style.spacing.popupRowHeight
            radius: Style.cornerRadius
            color: hot ? Color.menu.selectedBackground : "transparent"

            Text {
              id: itemIcon
              width: Style.font.icon + Style.spacing.sm
              anchors.left: parent.left
              anchors.leftMargin: Style.spacing.sm
              anchors.verticalCenter: parent.verticalCenter
              textFormat: Text.PlainText
              text: item.modelData.icon
              font.family: Style.font.menuFamily
              font.pixelSize: Style.font.icon
              color: item.on ? Color.menu.selectedText : Color.popups.text
              opacity: item.on || item.hot ? 1 : 0.6
            }

            Text {
              anchors.left: itemIcon.right
              anchors.right: itemKey.left
              anchors.rightMargin: Style.spacing.sm
              anchors.verticalCenter: parent.verticalCenter
              textFormat: Text.PlainText
              elide: Text.ElideRight
              text: item.modelData.label
              font.family: Style.font.menuFamily
              font.pixelSize: Style.font.body
              font.bold: item.on
              color: item.on || item.hot ? Color.menu.selectedText : Color.popups.text
            }

            // Its key in the popup, the way the Ⓐ menu shows them.
            Text {
              id: itemKey
              anchors.right: check.left
              anchors.rightMargin: Style.spacing.sm
              anchors.verticalCenter: parent.verticalCenter
              visible: content.showKeys && item.modelData.key !== ""
              width: visible ? implicitWidth : 0
              textFormat: Text.PlainText
              text: item.modelData.key
              font.family: Style.font.menuFamily
              font.pixelSize: Style.font.caption
              color: Color.popups.text
              opacity: 0.45
            }

            Text {
              id: check
              width: Style.font.icon
              anchors.right: parent.right
              anchors.rightMargin: Style.spacing.sm
              anchors.verticalCenter: parent.verticalCenter
              horizontalAlignment: Text.AlignHCenter
              textFormat: Text.PlainText
              text: item.on ? "󰄬" : ""
              font.family: Style.font.menuFamily
              font.pixelSize: Style.font.icon
              color: Color.menu.selectedText
            }

            MouseArea {
              id: itemArea
              anchors.fill: parent
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onClicked: root.group(item.modelData.what)
            }
          }
        }
      }
    }
  }

  // The peek: the same panel, but it never takes the keyboard, so you can
  // keep typing where you are.
  QtObject {
    id: peekOwner
    function close() { root.peeking = false }
  }

  KeyboardPanel {
    id: peek
    anchorItem: button
    owner: peekOwner
    bar: root.bar
    open: root.peeking && !root.opened && root.shown.length > 0
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    contentWidth: peek.fittedContentWidth(root.panelWidth)
    contentHeight: peek.fittedContentHeight(peekContent.implicitHeight, Style.space(640))

    Content {
      id: peekContent
      width: parent.width
      passive: true
      cursor: root.currentIndex
    }
  }

  // The list beside Claude; the session on screen wears the cursor, until
  // you click its search: then the keyboard is here and the cursor is yours.
  SessionPanel {
    id: side
    screen: button.QsWindow.window ? button.QsWindow.window.screen : null
    sessions: store.sessions
    zen: store.zen
    zenWidth: store.zenWidth
    gap: store.panelGap
    alpha: store.terminalAlpha
    keyboard: root.searching
    holdKeyboard: root.searchFromKeys
    onVisibleChanged: {
      if (!visible && root.searching) root.endSearch()
      if (!visible) sideContent.closeMenu()
    }

    Content {
      id: sideContent
      width: parent.width
      cursor: root.searching ? root.cursor : root.currentIndex
      onActivated: function(index) { root.activate(index) }
      onMoved: function(dy) { root.moveCursor(dy) }
      onSearchRequested: {
        if (root.opened || root.searching) return
        root.cursor = Math.max(0, root.currentIndex)
        root.searchFromKeys = false
        root.searching = true
      }
      // Esc, or the keyboard left: what's typed stays until it's cleared.
      onSearchEnded: {
        root.searching = false
        root.searchFromKeys = false
      }
    }
  }

  SessionHeader {
    id: header
    // Its glyph turns while the session on screen works, even in zen mode.
    readonly property bool spinning: visible && status === "working"
    screen: button.QsWindow.window ? button.QsWindow.window.screen : null
    sessions: store.sessions
    zen: store.zen
    zenWidth: store.zenWidth
    stripHeight: store.headerHeight
    spinnerFrame: root.spinnerFrame
    onRenameRequested: store.run(["rename"])
  }

  SoundPicker {
    id: soundPicker
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
    // The keyboard starts on the list, or in the search when that's what was
    // asked for (`amarchy search`).
    focusTarget: root.searchOnOpen && store.sessions.length > 0 ? column.searchField : keys
    contentWidth: panel.fittedContentWidth(root.panelWidth)
    contentHeight: panel.fittedContentHeight(column.implicitHeight, Style.space(640))

    PanelKeyCatcher {
      id: keys
      anchors.fill: parent
      // The search has the keys while you type in it.
      blocked: column.searchFocused
      // While the grouping menu is open the keys move in it: Esc closes it,
      // Enter or Space switch the grouping under its cursor.
      onMoveRequested: function(dx, dy) {
        if (column.menuOpen) column.moveMenu(dy)
        else root.moveCursor(dy)
      }
      onActivateRequested: {
        if (column.menuOpen) column.pickMenu()
        else root.activate(root.cursor)
      }
      onCloseRequested: {
        if (column.menuOpen) column.closeMenu()
        else root.close()
      }
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onDeleteRequested: {
        if (column.menuOpen) return
        var s = root.shown[root.cursor]
        if (!s) return
        root.act(["close", s.id, "--confirm"])
      }
      onTextKey: function(t) {
        if (t === "n") root.act(["new"])
        else if (t === "a") root.act(["add"])
        else if (t === "m") root.act(["menu"])
        else if (t === "p") root.group("project")
        else if (t === "f") root.group("priority")
        else if (t === "s") root.group("status")
        else if (t === "g") column.menuOpen ? column.closeMenu() : column.openMenu(true)
        else if (t === "+" || t === "=") root.prioritize("up")
        else if (t === "-") root.prioritize("down")
        else if (t === "/") column.focusSearch()
      }

      Content {
        id: column
        width: parent.width
        showKeys: true
        cursor: root.cursor
        onActivated: function(index) { root.activate(index) }
        onHovered: function(index) { root.cursor = index }
        onMoved: function(dy) { root.moveCursor(dy) }
        onSearchEnded: if (root.opened) keys.forceActiveFocus()
      }
    }
  }
}
