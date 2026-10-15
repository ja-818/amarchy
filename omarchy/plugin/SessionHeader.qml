import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import qs.Commons

// The strip above Claude in zen mode, where the list that shows the session
// you're in has stepped away. It says the session the way its row does, as an
// Omarchy panel hero, in the bar's colors: the status glyph (the bell in the
// theme's accent), and what it's about in bold with PROJECT · BRANCH in small
// caps under it. `amarchy layout` makes room for it above Claude in zen mode
// only. Click the name to rename the session: hovering fills it like any
// Omarchy control, with a pencil.
PanelWindow {
  id: root

  property var sessions: []
  property bool zen: false
  property int zenWidth: 900
  property int stripHeight: 0
  property int spinnerFrame: 0
  signal renameRequested()

  readonly property var monitor: screen ? Hyprland.monitorFor(screen) : null
  readonly property string workspace: monitor && monitor.activeWorkspace ? monitor.activeWorkspace.name : ""
  readonly property var session: {
    for (var i = 0; i < sessions.length; i++) if (sessions[i].workspace === workspace) return sessions[i]
    return null
  }
  readonly property string status: session ? (session.status || "idle") : ""
  readonly property bool hot: nameMouse.containsMouse

  readonly property var spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  readonly property var icons: ({ waiting: "󰂞", idle: "󰄬", asleep: "󰒲" })
  readonly property color ink: Color.bar.text
  readonly property color dim: Qt.darker(Color.bar.text, 1.4)
  // The glyph's color: the theme's accent when it needs you.
  readonly property color statusInk: status === "waiting" ? Color.accent : (status === "working" ? ink : dim)

  visible: zen && stripHeight > 0 && session !== null
  color: "transparent"
  implicitHeight: Math.max(1, stripHeight)
  anchors { top: true; left: true; right: true }
  // Not exclusive itself, but it does make way for the bar.
  exclusiveZone: 0

  WlrLayershell.namespace: "amarchy-header"
  WlrLayershell.layer: WlrLayer.Bottom
  WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
  // Only the name takes clicks; the rest falls through to the desktop.
  mask: Region { item: name }

  Rectangle {
    id: strip
    width: Math.min(root.zenWidth, parent.width)
    height: parent.height
    anchors.horizontalCenter: parent.horizontalCenter
    color: Color.bar.background

    // The name, as a control: status glyph, then title over PROJECT · BRANCH.
    Rectangle {
      id: name
      anchors.left: parent.left
      anchors.leftMargin: Style.spacing.rowPaddingX - Style.spacing.lg
      anchors.verticalCenter: parent.verticalCenter
      height: labels.implicitHeight + Style.spacing.sm * 2
      // From the parts: the labels' own width depends on this.
      readonly property real natural: Style.spacing.lg * 2 + glyph.width + Style.space(14)
                                      + Math.max(title.implicitWidth + (pencil.visible ? Style.spacing.lg + pencil.implicitWidth : 0),
                                                 meta.implicitWidth)
      width: Math.min(natural, parent.width - Style.spacing.rowPaddingX * 2)
      radius: Style.cornerRadius
      color: root.hot ? Style.hoverFillFor(root.ink, Color.accent) : "transparent"
      border.width: root.hot ? Style.hoverBorderWidth : 0
      border.color: Style.hoverBorderFor(root.ink, Color.accent)
      clip: true

      Text {
        id: glyph
        // A fixed slot, so the title doesn't shift as the spinner turns.
        width: Style.font.iconLarge
        anchors.left: parent.left
        anchors.leftMargin: Style.spacing.lg
        anchors.verticalCenter: parent.verticalCenter
        horizontalAlignment: Text.AlignHCenter
        textFormat: Text.PlainText
        text: root.status === "working" ? root.spinner[root.spinnerFrame % root.spinner.length]
                                        : (root.icons[root.status] || "󰄬")
        font.family: Style.font.menuFamily
        font.pixelSize: Style.font.iconLarge
        color: root.statusInk
      }

      Column {
        id: labels
        anchors.left: glyph.right
        anchors.leftMargin: Style.space(14)
        anchors.right: parent.right
        anchors.rightMargin: Style.spacing.lg
        anchors.verticalCenter: parent.verticalCenter
        spacing: Style.space(2)

        Row {
          width: parent.width
          spacing: Style.spacing.lg

          Text {
            id: title
            width: Math.min(implicitWidth, parent.width - (pencil.visible ? pencil.width + parent.spacing : 0))
            textFormat: Text.PlainText
            elide: Text.ElideRight
            text: root.session ? (root.session.task || "New session") : ""
            font.family: Style.font.menuFamily
            font.pixelSize: Style.font.title
            font.bold: true
            color: root.ink
            opacity: root.session && root.session.task ? 1 : 0.52
          }

          Text {
            id: pencil
            visible: root.hot
            anchors.verticalCenter: title.verticalCenter
            textFormat: Text.PlainText
            text: "󰏫"
            font.family: Style.font.menuFamily
            font.pixelSize: Style.font.title
            color: root.dim
          }
        }

        Text {
          id: meta
          width: parent.width
          textFormat: Text.PlainText
          elide: Text.ElideRight
          text: root.session ? (root.session.repo + " · " + root.session.name).toUpperCase() : ""
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.caption
          font.bold: true
          font.letterSpacing: 1.2
          color: root.dim
        }
      }

      MouseArea {
        id: nameMouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: root.renameRequested()
      }
    }
  }
}
