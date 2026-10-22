import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Commons as Commons
import qs.Ui

// The amarchy bar widget: an anarchy A that lights up (urgent) when a session
// needs you. Click opens your sessions; right click starts a new one. On a
// session the same list sits in the gap left of Claude. In zen mode (`amarchy
// zen`) it doesn't, and moving between sessions from the keyboard (`amarchy
// next`) drops the list for a moment, without taking the keyboard, to show
// where you landed.
// Above the list, fixed while it scrolls, there is only the Ⓐ Amarchy Menu
// button (everything else amarchy does), New session and a search by name (its
// placeholder is the key that puts the keyboard in it), with one 󰒼 button next to it that opens how
// the list is grouped (by project, priority, status) and sorted inside its
// groups (by priority, newest or oldest first).
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
  // ("none"). One turned on goes inside the ones already on, so the order you
  // pick them in is how they nest: priority, then project, puts each
  // priority's projects inside it. The menu shows it at once; the list
  // follows when the CLI has it in its new order.
  function group(what) {
    if (what === "none") {
      store.groups = []
      store.run(["group", "none"])
      return
    }
    var on = store.groups.indexOf(what) < 0
    store.groups = on ? store.groups.concat([what]) : store.groups.filter(function(g) { return g !== what })
    store.run(["group", what, on ? "on" : "off"])
  }

  // Sort the list inside its groups: "priority", "newest" or "oldest". The
  // menu checks it at once, like the groupings.
  function sortBy(how) {
    if (store.sortBy === how) return
    store.sortBy = how
    store.run(["sort", how])
  }

  // Put a project before or after another one (a project header's arrows).
  function moveProject(name, where, other) {
    store.run(["projects", "move", name, where, other])
  }

  // Put your projects in order, one at a time, in the Omarchy menu.
  function orderProjects() {
    root.close()
    root.endSearch()
    store.run(["projects", "move"])
  }

  // The next sort, from the keyboard (o in the popup).
  function nextSort() {
    var sorts = ["priority", "newest", "oldest"]
    root.sortBy(sorts[(sorts.indexOf(store.sortBy) + 1) % sorts.length])
  }

  // Raise ("up") or lower ("down") the priority of the session under the
  // cursor; the list reorders and the cursor goes with it.
  function prioritize(direction) {
    var s = root.shown[root.cursor]
    if (s) store.run(["priority", direction, "--id", s.id])
  }

  // The amarchy menu, in its card; the list steps out of its way.
  function openMenu(path) {
    root.close()
    root.endSearch()
    amarchyMenu.open(path)
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
    Qt.callLater(column.reveal, false)
  }

  onPeekingChanged: if (peeking) Qt.callLater(peekContent.reveal, false)

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
    // The amarchy menu (`amarchy menu`), or one of its groups ("Settings/Keys").
    function menu(): string { root.openMenu(""); return "ok" }
    function menuAt(path: string): string { root.openMenu(path); return "ok" }
    // Zen mode was toggled: the list beside Claude follows right away.
    function zen(on: bool): string { store.zen = on; store.refresh(); return "ok" }
    function ping(): string { return "ok" }
  }

  // What the popup and the list beside Claude show: the menu and New session,
  // the search with the group & sort button next to it, and the sessions. The peek
  // is `passive`: the sessions alone. The group & sort menu drops over the list.
  component Content: Item {
    id: content
    property int cursor: -1
    property bool passive: false
    // The group & sort menu is open; menuCursor is its row under the keyboard
    // (the popup's j/k), -1 for none: the groupings first, then the sorts.
    property bool menuOpen: false
    property int menuCursor: -1
    // The popup has keys for each grouping and for the sort; the menu shows them.
    property bool showKeys: false
    readonly property Item searchField: search
    readonly property bool searchFocused: search.activeFocus
    signal activated(int index)
    signal hovered(int index)
    signal moved(int dy)
    // The search was clicked / is done with (Esc).
    signal searchRequested()
    signal searchEnded()

    // The groupings the menu offers; they nest in the order you turn them
    // on, and each one on shows its level. "none" is the plain list.
    readonly property var groupings: [
      { what: "project", icon: "󰉋", label: "Project", key: "P" },
      { what: "priority", icon: "󰈻", label: "Priority", key: "F" },
      { what: "status", icon: "󰉹", label: "Status", key: "S" },
      { what: "none", icon: "󰒼", label: "Not grouped", key: "" }
    ]
    // How it's sorted inside the groups: one of these, always.
    readonly property var sorts: [
      { what: "priority", icon: "󰈻", label: "Priority" },
      { what: "newest", icon: "󱕈", label: "Newest first" },
      { what: "oldest", icon: "󱕇", label: "Oldest first" }
    ]

    function grouped(what) {
      return what === "none" ? store.groups.length === 0 : store.groups.indexOf(what) >= 0
    }
    // How deep a grouping that's on sits: 1 outermost; 0 when it's off.
    function level(what) {
      return store.groups.indexOf(what) + 1
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
      var last = content.groupings.length + content.sorts.length
      content.menuCursor = Math.max(0, Math.min(content.menuCursor + dy, last))
    }
    // Switch the grouping, or pick the sort, under the menu's cursor; the
    // menu stays open, to set more than one.
    function pickMenu() {
      var g = content.groupings[content.menuCursor]
      if (g) { root.group(g.what); return }
      var o = content.sorts[content.menuCursor - content.groupings.length]
      if (o) { root.sortBy(o.what); return }
      if (content.menuCursor === content.groupings.length + content.sorts.length) {
        content.closeMenu()
        root.orderProjects()
      }
    }

    // One height for every control up top: the buttons size from their
    // glyphs (the Ⓐ is tall, the group button has no label) and the search
    // from its own padding and a border that changes with hover and focus,
    // so left alone no two would agree. The buttons reserve their largest
    // border, so theirs is steady.
    readonly property real controlHeight: Math.max(brand.implicitHeight, newSession.implicitHeight, organize.implicitHeight)

    // Up top, out of the way of the scrolling: the buttons and the search.
    readonly property real headerHeight: header.visible ? header.implicitHeight + Style.spacing.panelGap : 0

    implicitHeight: Math.max(headerHeight + rows.implicitHeight, content.menuOpen ? menu.y + menu.height : 0)

    // Bring the session under the cursor into view, with its headers when
    // they're right above it: moving between sessions (from the keyboard, or
    // `amarchy next`) never lands on one you can't see. Not while the pointer
    // moves the cursor, which is on the row already.
    function reveal(animate) {
      var r = list.rowExtent(content.cursor)
      // Not laid out yet: there's nothing to see it through.
      if (!r || scroller.height < r.bottom - r.top) return
      if (r.top < scroller.contentY) scroller.scrollTo(r.top, animate)
      else if (r.bottom > scroller.contentY + scroller.height) scroller.scrollTo(r.bottom - scroller.height, animate)
    }
    property bool pointerMoving: false
    onCursorChanged: if (!pointerMoving) Qt.callLater(content.reveal, true)
    // Once it has its height (on the first layout of a panel), and when that
    // changes, the cursor's still in view.
    onHeightChanged: Qt.callLater(content.reveal, false)

    Column {
      id: header
      width: parent.width
      visible: !content.passive
      spacing: Style.spacing.panelGap

      // The two share the row in halves, so it's as wide as the search under
      // it; when the popup is too narrow for that, a label never gets cut:
      // the wider one keeps its size and the other takes what's left.
      Row {
        width: parent.width
        spacing: Style.spacing.controlGap
        // The name on the door is the menu: everything else amarchy does.
        // Its own label: the Ⓐ sits on the baseline with a descent of its
        // own, so the Button's centered glyph rides low next to the text.
        Button {
          id: brand
          width: Math.max(implicitWidth, Math.min((parent.width - parent.spacing) / 2,
                                                  parent.width - parent.spacing - newSession.implicitWidth))
          height: content.controlHeight
          implicitWidth: brandLabel.implicitWidth + horizontalPadding * 2 + _reservedBorderLeft + _reservedBorderRight
          implicitHeight: newSession.implicitHeight
          tooltipText: root.keyHint("menu")
          bordered: true
          onClicked: root.openMenu("")

          Item {
            id: brandLabel
            anchors.centerIn: parent
            implicitWidth: brandGlyph.width + Style.spacing.controlGap + brandText.implicitWidth
            implicitHeight: brandText.implicitHeight
            width: implicitWidth
            height: implicitHeight

            TextMetrics { id: glyphInk; font: brandGlyph.font; text: brandGlyph.text }
            TextMetrics { id: capInk; font: brandText.font; text: "A" }

            Text {
              id: brandGlyph
              textFormat: Text.PlainText
              text: "Ⓐ"
              color: brand.foreground
              font.family: brand.fontFamily
              font.pixelSize: brand.iconSize
              // The middle of its ring on the middle of the capitals beside it.
              anchors.baseline: brandText.baseline
              anchors.baselineOffset: Math.round((capInk.tightBoundingRect.y + capInk.tightBoundingRect.height / 2)
                                                 - (glyphInk.tightBoundingRect.y + glyphInk.tightBoundingRect.height / 2))
            }
            Text {
              id: brandText
              x: brandGlyph.width + Style.spacing.controlGap
              anchors.verticalCenter: parent.verticalCenter
              textFormat: Text.PlainText
              text: "Amarchy Menu"
              color: brand.foreground
              font.family: brand.fontFamily
              font.pixelSize: brand.fontSize
            }
          }
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
        visible: store.sessions.length > 0
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

        // How the list is grouped and sorted, in a menu. Lit only while the
        // menu is open: the headers in the list already say how it's grouped.
        Button {
          id: organize
          // Square, at the height of everything else.
          width: Math.max(implicitWidth, content.controlHeight)
          height: content.controlHeight
          iconText: "󰒼"
          tooltipText: content.menuOpen ? "" : "Group and sort the list"
          bordered: true
          selected: content.menuOpen
          onClicked: content.menuOpen ? content.closeMenu() : content.openMenu(false)
        }
      }
    }

    // The sessions, scrolling under the header. The wheel moves a few rows a
    // notch, and glides there; a touchpad moves it by its own pixels.
    // Flickable's own wheel handling crawls with a mouse, so it's off.
    Flickable {
      id: scroller
      y: content.headerHeight
      width: parent.width
      height: Math.max(0, content.height - y)
      contentWidth: width
      contentHeight: rows.implicitHeight
      clip: true
      interactive: false
      boundsBehavior: Flickable.StopAtBounds

      readonly property real maxY: Math.max(0, contentHeight - height)
      // Where it's headed, while it glides.
      readonly property real targetY: glide.running ? glide.to : contentY

      function scrollTo(y, animate) {
        y = Math.round(Math.max(0, Math.min(y, maxY)))
        glide.stop()
        if (animate && y !== contentY) {
          glide.from = contentY
          glide.to = y
          glide.start()
        } else {
          contentY = y
        }
      }

      // The list grew shorter (a session closed, a search): never past its end.
      onMaxYChanged: if (contentY > maxY) scrollTo(maxY, false)

      NumberAnimation {
        id: glide
        target: scroller
        property: "contentY"
        duration: 160
        easing.type: Easing.OutCubic
      }

      WheelHandler {
        acceptedDevices: PointerDevice.Mouse | PointerDevice.TouchPad
        onWheel: function(event) {
          if (event.pixelDelta.y !== 0) scroller.scrollTo(scroller.contentY - event.pixelDelta.y, false)
          else if (event.angleDelta.y !== 0) scroller.scrollTo(scroller.targetY - event.angleDelta.y / 120 * Style.space(150), true)
        }
      }

      Column {
        id: rows
        width: scroller.width

        SessionList {
          id: list
          width: parent.width
          visible: root.shown.length > 0
          sessions: root.shown
          groups: store.groups
          cursor: content.cursor
          spinnerFrame: root.spinnerFrame
          movable: !content.passive
          onActivated: function(index) { content.activated(index) }
          onMoveProject: function(name, where, other) { root.moveProject(name, where, other) }
          onHovered: function(index) {
            content.pointerMoving = true
            content.hovered(index)
            content.pointerMoving = false
          }
        }

        Text {
          width: parent.width
          visible: !content.passive && root.shown.length === 0
          textFormat: Text.PlainText
          elide: Text.ElideRight
          text: store.sessions.length === 0 ? "No sessions yet" : "No session called “" + root.query.trim() + "”"
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.body
          color: Commons.Color.menu.text
          opacity: 0.52
        }
      }
    }

    // How far down the list you are, when it doesn't all fit.
    Rectangle {
      visible: scroller.maxY > 0
      x: parent.width - width + Style.spacing.sm
      y: scroller.y + scroller.visibleArea.yPosition * scroller.height
      width: Style.space(3)
      height: Math.max(Style.space(24), scroller.visibleArea.heightRatio * scroller.height)
      radius: width / 2
      color: Commons.Color.menu.text
      opacity: scrollerHover.hovered || glide.running ? 0.35 : 0.15
      Behavior on opacity { NumberAnimation { duration: 140 } }
    }
    HoverHandler { id: scrollerHover }

    // A click anywhere off the menu closes it.
    MouseArea {
      anchors.fill: parent
      visible: content.menuOpen
      z: 1
      onClicked: content.closeMenu()
    }

    // The group & sort menu. The groupings are switches, each on its own,
    // checked while on; together they nest in the order you turned them on,
    // and each shows its level (1 outermost) instead of the check. Under
    // them, how the list is sorted inside its groups: one of them, checked.
    // It stays open to set several. Last, putting your projects in order.
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
      color: Util.alpha(Commons.Color.popups.background, 1)
      borderSpec: Border.surfaceSpec("popups", "border", Commons.Color.popups.border, Style.normalBorderWidth)
      padding: Style.spacing.xs

      // Clicks between the rows stay on the menu.
      MouseArea { anchors.fill: parent }

      Column {
        id: menuItems
        x: menu.contentLeftInset
        y: menu.contentTopInset
        width: menu.width - menu.contentLeftInset - menu.contentRightInset

        MenuHeader {
          width: parent.width
          text: "GROUP BY"
        }

        Repeater {
          model: content.groupings

          MenuRow {
            required property var modelData
            required property int index
            width: menuItems.width
            icon: modelData.icon
            label: modelData.label
            keyText: content.showKeys ? modelData.key : ""
            on: content.grouped(modelData.what)
            // With more than one on, the check says where it nests.
            level: store.groups.length > 1 ? content.level(modelData.what) : 0
            hasCursor: content.menuCursor === index
            onPicked: root.group(modelData.what)
          }
        }

        MenuHeader {
          width: parent.width
          text: "SORT BY"
          gapAbove: Style.spacing.sm
          // o goes to the next one.
          keyText: content.showKeys ? "O" : ""
        }

        Repeater {
          model: content.sorts

          MenuRow {
            required property var modelData
            required property int index
            width: menuItems.width
            icon: modelData.icon
            label: modelData.label
            on: store.sortBy === modelData.what
            hasCursor: content.menuCursor === content.groupings.length + index
            onPicked: root.sortBy(modelData.what)
          }
        }

        // The order your projects come in (also the arrows on a project's
        // header, under the pointer), one at a time in the Omarchy menu.
        MenuHeader {
          width: parent.width
          text: "PROJECTS"
          gapAbove: Style.spacing.sm
        }

        MenuRow {
          width: menuItems.width
          icon: "󰒺"
          label: "Order projects…"
          hasCursor: content.menuCursor === content.groupings.length + content.sorts.length
          onPicked: {
            content.closeMenu()
            root.orderProjects()
          }
        }
      }
    }
  }

  // A section of the group & sort menu: its name, small and quiet, and the
  // key for it on the right in the popup.
  component MenuHeader: Item {
    id: header
    property string text: ""
    property string keyText: ""
    // Room above it, setting it apart from the section before.
    property real gapAbove: 0

    implicitHeight: headerText.implicitHeight

    Text {
      id: headerText
      width: parent.width
      leftPadding: Style.spacing.sm
      rightPadding: Style.spacing.sm
      topPadding: Style.spacing.xs + header.gapAbove
      bottomPadding: Style.spacing.xs
      textFormat: Text.PlainText
      text: header.text
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.caption
      font.bold: true
      font.letterSpacing: 1.2
      color: Qt.darker(Commons.Color.popups.text, 1.4)

      Text {
        anchors.right: parent.right
        anchors.rightMargin: Style.spacing.sm
        anchors.baseline: parent.baseline
        visible: header.keyText !== ""
        textFormat: Text.PlainText
        text: header.keyText
        font.family: Style.font.menuFamily
        font.pixelSize: Style.font.caption
        color: Commons.Color.popups.text
        opacity: 0.45
      }
    }
  }

  // A row of the group & sort menu: icon, label, its key in the popup (the
  // way the Ⓐ menu shows them) and a check while it's on.
  component MenuRow: BorderSurface {
    id: item
    property string icon: ""
    property string label: ""
    property string keyText: ""
    property bool on: false
    // Where it nests, 1 outermost, shown in place of the check; 0 for the check.
    property int level: 0
    // Under the menu's keyboard cursor.
    property bool hasCursor: false
    readonly property bool hot: hasCursor || itemArea.containsMouse
    signal picked()

    height: Style.spacing.popupRowHeight
    radius: Style.cornerRadius
    color: hot ? Commons.Color.menu.selectedBackground : "transparent"

    Text {
      id: itemIcon
      width: Style.font.icon + Style.spacing.sm
      anchors.left: parent.left
      anchors.leftMargin: Style.spacing.sm
      anchors.verticalCenter: parent.verticalCenter
      textFormat: Text.PlainText
      text: item.icon
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.icon
      color: item.on ? Commons.Color.menu.selectedText : Commons.Color.popups.text
      opacity: item.on || item.hot ? 1 : 0.6
    }

    Text {
      anchors.left: itemIcon.right
      anchors.right: itemKey.left
      anchors.rightMargin: Style.spacing.sm
      anchors.verticalCenter: parent.verticalCenter
      textFormat: Text.PlainText
      elide: Text.ElideRight
      text: item.label
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.body
      font.bold: item.on
      color: item.on || item.hot ? Commons.Color.menu.selectedText : Commons.Color.popups.text
    }

    Text {
      id: itemKey
      anchors.right: check.left
      anchors.rightMargin: Style.spacing.sm
      anchors.verticalCenter: parent.verticalCenter
      visible: item.keyText !== ""
      width: visible ? implicitWidth : 0
      textFormat: Text.PlainText
      text: item.keyText
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.caption
      color: Commons.Color.popups.text
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
      text: !item.on ? "" : item.level > 0 ? String(item.level) : "󰄬"
      font.family: Style.font.menuFamily
      font.pixelSize: item.level > 0 ? Style.font.body : Style.font.icon
      font.bold: item.level > 0
      color: Commons.Color.menu.selectedText
    }

    MouseArea {
      id: itemArea
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: item.picked()
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
      height: parent.height
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
      else Qt.callLater(sideContent.reveal, false)
    }

    Content {
      id: sideContent
      width: parent.width
      height: parent.height
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

  AmarchyMenu {
    id: amarchyMenu
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
      // While the group & sort menu is open the keys move in it: Esc closes
      // it, Enter or Space switch the grouping (or pick the sort) under its
      // cursor.
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
        else if (t === "m") root.openMenu("")
        else if (t === "p") root.group("project")
        else if (t === "f") root.group("priority")
        else if (t === "s") root.group("status")
        else if (t === "o") root.nextSort()
        else if (t === "g") column.menuOpen ? column.closeMenu() : column.openMenu(true)
        else if (t === "+" || t === "=") root.prioritize("up")
        else if (t === "-") root.prioritize("down")
        else if (t === "/") column.focusSearch()
      }

      Content {
        id: column
        width: parent.width
        height: parent.height
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
