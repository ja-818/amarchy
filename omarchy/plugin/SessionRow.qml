import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui

// One session, with the proportions of an Omarchy panel hero (the "Display /
// FIXED BRIGHTNESS" block of the monitor panel): a display-size icon centered
// on the row, a bold title (what the session is about) and a small-caps line
// under it (project · branch), plus the time on the right. Everything is the
// hero's size times `zoom`, so a screenful of sessions fits.
// A session that finished while you weren't looking shows a filled check in
// the theme's accent until you open it (a plain, dimmed one after). A session
// asleep (its Claude Code stopped until you type in it) shows the
// moon and how long it has slept; "+1 BG" after the branch counts Claude Code
// background sessions still running in its worktree.
// Your assistant (`amarchy assistant`) is bigger: its picture in the icon's
// place with its state on a badge, its name, and what it's on; it looks
// selected only when it is, like any row. The other sessions of its project show its picture small.
// Unread (a turn it finished that you haven't opened yet, here or on another
// device): a dot by the time; your assistant's card shows the start of what
// it wrote, with "New" by its name, and the other sessions of its project
// show it in place of project · branch.
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
  // Done, and you haven't opened it since.
  readonly property bool unseen: status === "idle" && session.unseen === true
  readonly property bool urgent: status === "waiting" || status === "working" || unseen
  readonly property string priority: session.priority || "normal"
  readonly property color ink: cursor ? Commons.Color.menu.selectedText : Commons.Color.menu.text
  readonly property color dim: Qt.darker(Commons.Color.menu.text, 1.4)
  readonly property real zoom: 0.85
  readonly property int iconSize: Style.font.iconLarge
  // "main" for your assistant, "near" for another session of its project.
  readonly property string assistant: session.assistant || ""
  readonly property bool main: assistant === "main"
  readonly property string assistantName: session.assistant_name || "Assistant"
  readonly property int avatarSize: main ? Math.round(iconSize * 2.6) : Math.round(iconSize * 1.05)
  // Under its name: what it's on (unless that's just its name again), else how it is.
  // What your assistant (or another session of its project) wrote, unread.
  readonly property string said: unseen && assistant !== "" ? (session.said || "") : ""
  readonly property string assistantLine: {
    if (status === "waiting") return "Needs you"
    if (said) return said
    var task = session.task || ""
    if (task && task.toLowerCase() !== assistantName.toLowerCase()) return task
    return status === "working" ? "On it…" : "Here for you"
  }

  implicitHeight: Math.max(icon.implicitHeight, content.implicitHeight, avatar.visible ? avatar.height : 0)
                  + Style.spacing.controlPaddingY * (main ? 3 : 2)
  radius: Style.cornerRadius
  color: cursor ? Commons.Color.menu.selectedBackground : "transparent"
  opacity: priority === "low" && !cursor ? 0.6 : 1
  borderSpec: Border.surfaceSpec("menu", "selected-border", Commons.Color.menu.selectedBorder, 0)

  // Your assistant's picture: in the icon's place, big, for the assistant;
  // small after the icon for the other sessions of its project.
  Image {
    id: avatar
    visible: row.assistant !== ""
    width: visible ? row.avatarSize : 0
    height: width
    anchors.left: row.main ? parent.left : icon.right
    anchors.leftMargin: row.main ? row.borderLeft + Style.spacing.sm : Math.round(Style.space(8) * row.zoom)
    anchors.verticalCenter: parent.verticalCenter
    source: Qt.resolvedUrl("assistant.svg")
    sourceSize.width: row.avatarSize * 2
    sourceSize.height: row.avatarSize * 2
    fillMode: Image.PreserveAspectFit
    smooth: true
    mipmap: true
  }

  // The assistant's state, on a badge at the corner of its picture.
  Rectangle {
    id: badge
    visible: row.main
    width: Math.round(row.iconSize * 1.15)
    height: width
    radius: width / 2
    x: avatar.x + avatar.width - width * 0.8
    y: avatar.y + avatar.height - height * 0.8
    color: Commons.Color.menu.background
    border.width: 1
    border.color: Qt.rgba(Commons.Color.menu.text.r, Commons.Color.menu.text.g, Commons.Color.menu.text.b, 0.25)
  }

  Text {
    id: icon
    // A fixed slot, so titles line up whatever the glyph's own width; on
    // the assistant's badge, centered on it.
    width: row.main ? badge.width : row.iconSize
    anchors.left: row.main ? undefined : parent.left
    anchors.leftMargin: row.borderLeft + Style.spacing.sm
    anchors.verticalCenter: row.main ? badge.verticalCenter : parent.verticalCenter
    anchors.horizontalCenter: row.main ? badge.horizontalCenter : undefined
    horizontalAlignment: Text.AlignHCenter
    textFormat: Text.PlainText
    text: row.status === "working" ? row.spinner[row.spinnerFrame % row.spinner.length]
                                   : row.unseen ? "󰗠" : (row.icons[row.status] || "󰄬")
    font.family: Style.font.menuFamily
    font.pixelSize: row.main ? Math.round(row.iconSize * 0.7) : row.iconSize
    color: row.cursor ? Commons.Color.menu.selectedText
         : row.unseen ? Commons.Color.accent
         : row.urgent ? Commons.Color.menu.selectedText : Commons.Color.menu.text
    opacity: row.cursor || row.urgent || row.main ? 1 : 0.52
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
    anchors.left: avatar.visible ? avatar.right : icon.right
    anchors.leftMargin: Math.round(Style.space(14) * row.zoom)
    // Clear of the time and the priority under it, whichever is wider.
    anchors.right: parent.right
    anchors.rightMargin: row.borderRight + Style.spacing.lg + Style.space(8)
                         + Math.max(when.implicitWidth + (row.unseen ? Style.space(13) : 0), prio.visible ? prio.implicitWidth : 0)
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(2)

    Text {
      id: label
      width: parent.width
      textFormat: Text.StyledText
      elide: Text.ElideRight
      text: row.main ? "<b>" + row.assistantName.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</b>"
                     : row.taskText(row.session.task || "new session")
      font.family: Style.font.menuFamily
      font.pixelSize: Math.round((row.main ? Style.font.heading : Style.font.title) * row.zoom)
      color: row.main && !row.cursor ? Commons.Color.accent : row.ink
      opacity: row.session.task || row.cursor || row.main ? 1 : 0.52
    }

    // The assistant: what it's on, in the body's size; what it wrote, unread, on two lines.
    Text {
      visible: row.main
      width: parent.width
      textFormat: Text.PlainText
      elide: Text.ElideRight
      wrapMode: row.said ? Text.Wrap : Text.NoWrap
      maximumLineCount: row.said ? 2 : 1
      text: row.assistantLine
      font.family: Style.font.menuFamily
      font.pixelSize: Math.round(Style.font.body * row.zoom)
      font.bold: row.status === "waiting"
      color: row.status === "waiting" ? Commons.Color.menu.selectedText : row.ink
    }

    Text {
      id: meta
      width: parent.width
      textFormat: Text.PlainText
      elide: Text.ElideRight
      // Claude Code background sessions (/bg) still running in its worktree.
      // Another session of your assistant's project, unread: what it wrote.
      readonly property bool preview: !row.main && row.said !== ""
      text: preview ? row.said
          : ((row.showRepo && !(row.main && row.session.name === row.session.repo) ? (row.session.repo || "") + " · " : "")
             + (row.session.name || "")
             + (row.session.background > 0 ? " · +" + row.session.background + " bg" : "")).toUpperCase()
      font.family: Style.font.menuFamily
      font.pixelSize: Math.round(Style.font.caption * row.zoom)
      font.bold: !preview
      font.letterSpacing: preview ? 0 : 1.2 * row.zoom
      color: preview ? row.ink : row.dim
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
    color: Commons.Color.menu.text
    opacity: 0.45
  }

  // "New" by your assistant's name, while what it wrote is unread.
  Rectangle {
    visible: row.main && row.said !== ""
    x: content.x + Math.min(label.contentWidth, label.width) + Style.space(10)
    y: content.y + label.y + (label.height - height) / 2
    width: newText.implicitWidth + Style.space(12)
    height: newText.implicitHeight + Style.space(4)
    radius: Style.cornerRadius
    color: Commons.Color.accent

    Text {
      id: newText
      anchors.centerIn: parent
      textFormat: Text.PlainText
      text: "New"
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.caption
      font.bold: true
      color: Commons.Color.menu.background
    }
  }

  // Unread: a dot on the time's line, before it.
  Rectangle {
    visible: row.unseen
    width: Style.space(7)
    height: width
    radius: width / 2
    anchors.right: when.left
    anchors.rightMargin: Style.space(6)
    anchors.verticalCenter: when.verticalCenter
    color: Commons.Color.accent
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
    color: row.cursor ? Commons.Color.menu.selectedText : (row.priority === "high" ? Commons.Color.accent : Commons.Color.menu.text)
  }

  MouseArea {
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    onEntered: row.hovered()
    onClicked: row.activated()
  }
}
