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
// amarchy does), New session and a search by name, with the grouping (by
// project, by status) next to it.
// IPC: omarchy-shell amarchy-bar toggle|open|close
//      omarchy-shell amarchy refresh|peek|search|zen <true|false>
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
  // The list beside Claude has the keyboard: its search was clicked.
  property bool searching: false
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
      var name = ((s.task || "") + " " + (s.repo || "") + " " + (s.name || "")).toLowerCase()
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

  // Switch a grouping ("project", "status"). The buttons light up at once;
  // the list follows when the CLI has it in its new order.
  function group(what) {
    if (what === "project") store.byProject = !store.byProject
    else store.byStatus = !store.byStatus
    store.run(["group", what, (what === "project" ? store.byProject : store.byStatus) ? "on" : "off"])
  }

  // Put the keyboard in the search, from the keyboard: always under the Ⓐ.
  // The list beside Claude only keeps the keyboard while the pointer is on it
  // (Hyprland hands it back to the window under the pointer), so its search is
  // for the mouse.
  function search() {
    if (root.opened) {
      column.focusSearch()
    } else {
      root.searchOnOpen = true
      root.open()
    }
  }

  // Back to the whole list, and the keyboard back to where it was.
  function endSearch() {
    root.query = ""
    root.searching = false
  }

  // The cursor follows the search: on the first match while typing, back on
  // the session on screen once it's cleared.
  onQueryChanged: root.cursor = query !== "" ? 0 : Math.max(0, root.currentIndex)
  onShownChanged: if (root.cursor >= shown.length) root.cursor = Math.max(0, shown.length - 1)

  onOpenedChanged: {
    if (!opened) {
      root.searchOnOpen = false
      root.query = ""
      return
    }
    root.peeking = false
    root.searching = false
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
    // Zen mode was toggled: the list beside Claude follows right away.
    function zen(on: bool): string { store.zen = on; store.refresh(); return "ok" }
    function ping(): string { return "ok" }
  }

  // What the popup and the list beside Claude show: the menu and New session,
  // the search with the grouping next to it, and the sessions. The peek is
  // `passive`: the sessions alone.
  component Content: Column {
    id: content
    property int cursor: -1
    property bool passive: false
    readonly property Item searchField: search
    readonly property bool searchFocused: search.activeFocus
    signal activated(int index)
    signal hovered(int index)
    signal moved(int dy)
    // The search was clicked / is done with (Esc).
    signal searchRequested()
    signal searchEnded()

    function focusSearch() { search.forceActiveFocus() }

    spacing: Style.spacing.panelGap

    Row {
      visible: !content.passive
      spacing: Style.spacing.controlGap
      // The name on the door is the menu: everything else amarchy does.
      Button {
        id: brand
        iconText: "Ⓐ"
        text: "Amarchy"
        tooltipText: root.keyHint("menu")
        bordered: true
        onClicked: root.act(["menu"])
      }
      Button {
        // The Ⓐ is a tall glyph; keep the two the same height.
        height: brand.height
        iconText: "󰐕"
        text: "New session"
        tooltipText: root.keyHint("new")
        bordered: true
        onClicked: root.act(["new"])
      }
    }

    Row {
      width: parent.width
      visible: !content.passive && store.sessions.length > 0
      spacing: Style.spacing.controlGap

      TextField {
        id: search
        width: parent.width - byProject.width - byStatus.width - parent.spacing * 2
        anchors.verticalCenter: parent.verticalCenter
        placeholderText: "󰍉  Search sessions"
        rightPadding: horizontalPadding + clear.width + Style.spacing.sm

        // Two fields (popup, beside Claude), one query.
        onTextEdited: root.query = text
        onPressed: content.searchRequested()
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

      // Two switches, lit while on: each groups the list on its own, both
      // group it by project with the status inside each.
      Button {
        id: byProject
        anchors.verticalCenter: parent.verticalCenter
        iconText: "󰉋"
        tooltipText: store.byProject ? "Stop grouping by project" : "Group by project"
        bordered: true
        selected: store.byProject
        onClicked: root.group("project")
      }

      Button {
        id: byStatus
        anchors.verticalCenter: parent.verticalCenter
        iconText: "󰉹"
        tooltipText: store.byStatus ? "Stop grouping by status" : "Group by status"
        bordered: true
        selected: store.byStatus
        onClicked: root.group("status")
      }
    }

    SessionList {
      width: parent.width
      visible: root.shown.length > 0
      sessions: root.shown
      byProject: store.byProject
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
    onVisibleChanged: if (!visible && root.searching) root.endSearch()

    Content {
      width: parent.width
      cursor: root.searching ? root.cursor : root.currentIndex
      onActivated: function(index) { root.activate(index) }
      onMoved: function(dy) { root.moveCursor(dy) }
      onSearchRequested: {
        if (root.opened || root.searching) return
        root.cursor = Math.max(0, root.currentIndex)
        root.searching = true
      }
      // Esc, or the keyboard left: what's typed stays until it's cleared.
      onSearchEnded: root.searching = false
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
    renameKey: root.keyHint("rename")
    onRenameRequested: store.run(["rename"])
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
      onMoveRequested: function(dx, dy) { root.moveCursor(dy) }
      onActivateRequested: root.activate(root.cursor)
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onDeleteRequested: {
        var s = root.shown[root.cursor]
        if (!s) return
        root.act(["close", s.id, "--confirm"])
      }
      onTextKey: function(t) {
        if (t === "n") root.act(["new"])
        else if (t === "a") root.act(["add"])
        else if (t === "m") root.act(["menu"])
        else if (t === "p") root.group("project")
        else if (t === "s") root.group("status")
        else if (t === "/") column.focusSearch()
      }

      Content {
        id: column
        width: parent.width
        cursor: root.cursor
        onActivated: function(index) { root.activate(index) }
        onHovered: function(index) { root.cursor = index }
        onMoved: function(dy) { root.moveCursor(dy) }
        onSearchEnded: if (root.opened) keys.forceActiveFocus()
      }
    }
  }
}
