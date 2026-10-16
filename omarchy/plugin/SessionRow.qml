import QtQuick
import qs.Commons
import qs.Ui

// One session, with the proportions of an Omarchy panel hero (the "Display /
// FIXED BRIGHTNESS" block of the monitor panel): a display-size icon centered
// on the row, a bold title (what the session is about) and a small-caps line
// under it (project · branch), plus the time on the right. Everything is the
// hero's size times `zoom`, so a screenful of sessions fits.
// A session asleep (its Claude Code stopped until you type in it) shows the
// moon and how long it has slept; "+1 BG" after the branch counts Claude Code
// background sessions still running in its worktree.
// The cursor (which starts on the session you're in) uses the menu's selected
// treatment. Under the time sits the priority: a flag for high, in the
// theme's accent, an arrow down for low (which also steps back, dimmed).
BorderSurface {
  id: row

  property var session: ({})
  property bool cursor: false
  property int spinnerFrame: 0
  // "project · branch" under the title; just the branch under a project header.
  property bool showRepo: true
  // The priority under the time; not under a "High/Low priority" header.
  property bool showPriority: true
  signal activated()
  signal hovered()

  readonly property var spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  readonly property var icons: ({ waiting: "󰂞", idle: "󰄬", asleep: "󰒲" })
  readonly property string status: session.status || "idle"
  readonly property bool urgent: status === "waiting" || status === "working"
  readonly property string priority: session.priority || "normal"
  readonly property color ink: cursor ? Color.menu.selectedText : Color.menu.text
  readonly property color dim: Qt.darker(Color.menu.text, 1.4)
  readonly property real zoom: 0.85
  readonly property int iconSize: Style.font.iconLarge

  implicitHeight: Math.max(icon.implicitHeight, content.implicitHeight) + Style.spacing.controlPaddingY * 2
  radius: Style.cornerRadius
  color: cursor ? Color.menu.selectedBackground : "transparent"
  opacity: priority === "low" && !cursor ? 0.6 : 1
  borderSpec: Border.surfaceSpec("menu", "selected-border", Color.menu.selectedBorder, 0)

  Text {
    id: icon
    // A fixed slot, so titles line up whatever the glyph's own width.
    width: row.iconSize
    anchors.left: parent.left
    anchors.leftMargin: row.borderLeft + Style.spacing.sm
    anchors.verticalCenter: parent.verticalCenter
    horizontalAlignment: Text.AlignHCenter
    textFormat: Text.PlainText
    text: row.status === "working" ? row.spinner[row.spinnerFrame % row.spinner.length]
                                   : (row.icons[row.status] || "󰄬")
    font.family: Style.font.menuFamily
    font.pixelSize: row.iconSize
    color: row.cursor || row.urgent ? Color.menu.selectedText : Color.menu.text
    opacity: row.cursor || row.urgent ? 1 : 0.52
  }

  // What a session is about, as rich text: the keyword before ": " in bold,
  // the few words after it in the regular weight, so a list of them reads by
  // the keyword. A name without one is bold all through.
  function taskText(task) {
    var esc = function(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") }
    var i = task.indexOf(": ")
    return i > 0 ? "<b>" + esc(task.slice(0, i + 1)) + "</b> " + esc(task.slice(i + 2)) : "<b>" + esc(task) + "</b>"
  }

  Column {
    id: content
    anchors.left: icon.right
    anchors.leftMargin: Math.round(Style.space(14) * row.zoom)
    // Clear of the time and the priority under it, whichever is wider.
    anchors.right: parent.right
    anchors.rightMargin: row.borderRight + Style.spacing.lg + Style.space(8)
                         + Math.max(when.implicitWidth, prio.visible ? prio.implicitWidth : 0)
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(2)

    Text {
      id: label
      width: parent.width
      textFormat: Text.StyledText
      elide: Text.ElideRight
      text: row.taskText(row.session.task || "new session")
      font.family: Style.font.menuFamily
      font.pixelSize: Math.round(Style.font.title * row.zoom)
      color: row.ink
      opacity: row.session.task || row.cursor ? 1 : 0.52
    }

    Text {
      id: meta
      width: parent.width
      textFormat: Text.PlainText
      elide: Text.ElideRight
      // Claude Code background sessions (/bg) still running in its worktree.
      text: ((row.showRepo ? (row.session.repo || "") + " · " : "") + (row.session.name || "")
             + (row.session.background > 0 ? " · +" + row.session.background + " bg" : "")).toUpperCase()
      font.family: Style.font.menuFamily
      font.pixelSize: Math.round(Style.font.caption * row.zoom)
      font.bold: true
      font.letterSpacing: 1.2 * row.zoom
      color: row.dim
    }
  }

  Text {
    id: when
    anchors.right: parent.right
    anchors.rightMargin: row.borderRight + Style.spacing.lg
    y: content.y + label.y + (label.height - height) / 2
    textFormat: Text.PlainText
    text: row.session.age || ""
    font.family: Style.font.menuFamily
    font.pixelSize: Style.font.caption
    color: Color.menu.text
    opacity: 0.45
  }

  // On the second line, under the time.
  Text {
    id: prio
    visible: row.showPriority && row.priority !== "normal"
    anchors.right: when.right
    y: content.y + meta.y + (meta.height - height) / 2
    textFormat: Text.PlainText
    text: row.priority === "high" ? "󰈻" : "󰁅"
    font.family: Style.font.menuFamily
    font.pixelSize: Style.font.caption
    color: row.cursor ? Color.menu.selectedText : (row.priority === "high" ? Color.accent : Color.menu.text)
  }

  MouseArea {
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    onEntered: row.hovered()
    onClicked: row.activated()
  }
}
