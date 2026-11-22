import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons as Commons
import qs.Ui

// amarchy's Ⓐ in Omarchy's bar. Stop babysitting your agents, manage them:
// it lights up when a chat needs you and says how many; a click opens the
// first of them in the desktop app (none: your chats), a right click opens
// your chats.
//
// What it shows comes from `amarchy bar --follow`, a process of its own that
// follows the board's events and prints a line of JSON on every change, so
// nothing here polls. Everything it does goes through `amarchy open`, which
// brings the desktop app to the front. Notifications are the desktop app's.
BarWidget {
  id: root
  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  readonly property string amarchy: Quickshell.env("HOME") + "/.local/bin/amarchy"
  // What `amarchy bar --follow` said last.
  property bool heard: false
  property bool up: false
  property string why: ""
  property int needs: 0
  property var chats: []
  // Its process ended: "missing" (no amarchy here) or "stopped".
  property string ended: ""
  // How many times in a row its process ended: each time it starts again a
  // little later (amarchy updated or reinstalled, or not installed yet).
  property int restarts: 0

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  // Text from the board, made safe to show: one line, no control characters,
  // bounded (the bar's tooltip is plain text already).
  function clean(value, length) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim().slice(0, length)
  }

  function take(line) {
    let d = null
    try { d = JSON.parse(line) } catch (e) { return }
    if (!d || typeof d !== "object") return
    const list = []
    const given = Array.isArray(d.chats) ? d.chats : []
    for (let i = 0; i < given.length && list.length < 8; i++) {
      const c = given[i]
      const link = c && typeof c.link === "string" ? c.link : ""
      // Only a chat's own link reaches `amarchy open`.
      if (!/^amarchy:\/\/chat\/[a-z0-9][a-z0-9-]{0,62}\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,119}$/.test(link)) continue
      list.push({ link: link, name: root.clean(c.name, 60), why: root.clean(c.why, 80) })
    }
    root.heard = true
    root.ended = ""
    root.restarts = 0
    root.up = d.up === true
    root.why = root.clean(d.why, 200)
    root.chats = list
    root.needs = root.up && typeof d.needs === "number" && isFinite(d.needs) ? Math.max(0, Math.floor(d.needs)) : 0
  }

  function open(link) {
    Quickshell.execDetached(link ? [root.amarchy, "open", link] : [root.amarchy, "open"])
  }

  readonly property string tooltip: {
    if (!root.heard) return strings.t("tooltip.starting")
    if (root.ended !== "") return strings.t("tooltip.down").arg(strings.t("why." + root.ended))
    if (!root.up) return strings.t("tooltip.down").arg(root.why)
    if (root.needs === 0) return strings.t("tooltip.none") + "\n" + strings.t("tooltip.openBoard")
    const lines = [strings.tn("tooltip.needs", root.needs).arg(Commons.I18n.formatNumber(root.needs))]
    for (let i = 0; i < root.chats.length && i < 5; i++)
      lines.push(strings.t("tooltip.chat").arg(root.chats[i].name).arg(root.chats[i].why))
    if (root.needs > lines.length - 1)
      lines.push(strings.tn("tooltip.more", root.needs - (lines.length - 1)).arg(Commons.I18n.formatNumber(root.needs - (lines.length - 1))))
    lines.push(strings.t("tooltip.openFirst"))
    return lines.join("\n")
  }

  Process {
    id: watcher
    // Through sh, so an amarchy that isn't there yet ends it like any other
    // exit (and it's started again later).
    command: ["sh", "-c", "exec \"$1\" bar --follow", "amarchy-bar", root.amarchy]
    running: true
    stdout: SplitParser { onRead: function(line) { root.take(line) } }
    onExited: function(exitCode, exitStatus) {
      root.heard = true
      root.up = false
      root.needs = 0
      root.chats = []
      root.ended = exitCode === 127 ? "missing" : "stopped"
      again.interval = [2000, 5000, 15000, 30000, 60000][Math.min(root.restarts, 4)]
      root.restarts++
      again.restart()
    }
  }

  Timer {
    id: again
    onTriggered: watcher.running = true
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "Ⓐ"
    labelText: root.needs > 0 ? Commons.I18n.formatNumber(root.needs) : ""
    active: root.needs > 0
    dimmed: root.heard && !root.up
    tooltipText: root.tooltip
    onPressed: function(mouseButton) {
      if (mouseButton === Qt.RightButton) root.open("")
      else root.open(root.needs > 0 && root.chats.length > 0 ? root.chats[0].link : "")
    }
  }
}
