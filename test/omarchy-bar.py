#!/usr/bin/env python3
"""The Ⓐ in Omarchy's bar, both halves:

- `amarchy bar --follow` against a fake board (SSE, zipped and plain): a line
  only when what the Ⓐ shows changes, the chats that need you in the board's
  order, "up": false when the board goes away, and back when it returns.
- omarchy/plugin/BarWidget.qml drawn offscreen in Omarchy's own shell code
  (as `omarchy agent look plugin` does), fed by a fake amarchy: lit with the
  count when chats need you, plain when none do, dimmed when the board is
  down, started again when amarchy isn't there; a click opens the first
  chat (`amarchy open <link>`), a right click your chats; a link that isn't a
  chat's never reaches `amarchy open`. Pictures of each in OUT.
- qmllint finds nothing in it.

Needs a checkout of Omarchy in OMARCHY_SRC (default /tmp/omarchy-src/omarchy)
and Quickshell (quickshell, qmllint); without them those parts are skipped.

    python3 test/omarchy-bar.py            # OUT=/tmp/omarchy-bar
"""
import http.server
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import zlib
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = Path(os.environ.get("OMARCHY_SRC", "/tmp/omarchy-src/omarchy"))
OUT = Path(os.environ.get("OUT", "/tmp/omarchy-bar"))
failed = []


def check(what, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + what + (f": {detail}" if detail and not ok else ""))
    if not ok:
        failed.append(what)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# ---- the watcher, against a fake board

def chat(sid, status="idle", **more):
    return {"id": sid, "name": sid, "task": f"Task {sid}", "status": status, "asks": "", "today": {}, **more}


class Board:
    """A board's /api/events: each view in self.views, sent as the server
    sends a list event, zipped when asked, with keepalives. On 127.0.0.1 it's
    this machine's own: in only with the local key's cookie (GET /local?key=
    sets it, as the contract has it)."""

    def __init__(self, port=None, host="127.0.0.2", key=None):
        self.views, self.sent, self.zipped = [], 0, []
        self.next, self.stopped = threading.Event(), threading.Event()
        board = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                cookie = f"amarchy_local_{board.port}=good"
                if board.key and self.path.startswith("/local?"):
                    if self.path != f"/local?key={board.key}&next=/" and self.path != f"/local?key={board.key}":
                        self.send_error(403)
                        return
                    self.send_response(303)
                    self.send_header("Set-Cookie", f"{cookie}; HttpOnly; SameSite=Strict; Path=/")
                    self.send_header("Location", "/")
                    self.end_headers()
                    return
                if board.key and self.headers.get("Cookie") != cookie:
                    self.send_error(403)
                    return
                if not self.path.startswith("/api/events"):
                    self.send_error(404)
                    return
                zipped = "gzip" in self.headers.get("Accept-Encoding", "") and "plain=1" not in self.path
                board.zipped.append(zipped)
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                if zipped:
                    self.send_header("Content-Encoding", "gzip")
                self.end_headers()
                z = zlib.compressobj(6, zlib.DEFLATED, 31) if zipped else None

                def out(b):
                    self.wfile.write(z.compress(b) + z.flush(zlib.Z_SYNC_FLUSH) if z else b)
                    self.wfile.flush()
                try:
                    out(b"retry: 1000\n\n")
                    i = 0
                    while not board.stopped.is_set():     # gone: its streams end with it
                        if i < len(board.views):
                            out(f"event: list\ndata: {json.dumps(board.views[i])}\n\n".encode())
                            i += 1
                            board.sent += 1
                            continue
                        board.next.wait(0.2)
                        board.next.clear()
                        out(b": still here\n\n")
                except OSError:
                    pass

        self.port, self.host, self.key = port or free_port(), host, key
        self.url = f"http://{host}:{self.port}"
        self.server = http.server.ThreadingHTTPServer((host, self.port), Handler)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def push(self, view):
        self.views.append(view)
        self.next.set()

    def stop(self):
        self.stopped.set()
        self.next.set()
        self.server.shutdown()
        self.server.server_close()


def watcher_test():
    board = Board()
    home = Path(tempfile.mkdtemp())
    env = {**os.environ, "HOME": str(home), "XDG_STATE_HOME": str(home / "state"),
           "XDG_CONFIG_HOME": str(home / "config"), "AMARCHY_URL": board.url}
    env.pop("AMARCHY_SESSION", None)
    p = subprocess.Popen([str(REPO / "bin/amarchy"), "bar", "--follow"], env=env, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, text=True)
    lines = []

    def read():
        for line in p.stdout:
            lines.append(json.loads(line))
    threading.Thread(target=read, daemon=True).start()

    def wait(n, timeout=10):
        """Whether there are n lines yet."""
        end = time.time() + timeout
        while len(lines) < n and time.time() < end:
            time.sleep(0.05)
        return len(lines) >= n

    base = {"hostname": "box", "sessions": [chat("a"), chat("b", "working")]}
    board.push(base)
    check("watcher: first state", wait(1) and lines[0]["up"] and lines[0]["needs"] == 0, lines)
    check("watcher: asks for the events zipped", board.zipped[:1] == [True], board.zipped)
    # The same chats, a word changed that the Ⓐ doesn't show: no line.
    board.push({**base, "sessions": [chat("a", said="hello"), chat("b", "working")]})
    time.sleep(0.6)
    check("watcher: says nothing when the Ⓐ wouldn't change", len(lines) == 1, lines)
    board.push({"hostname": "box", "sessions": [
        chat("a", "waiting", asks="Allow Bash?"), chat("b", "working"),
        chat("c", "idle", today={"asks": [{"question": "Ship it?"}]}),
        chat("d", "working", today={"asks": [{"question": "old"}]}),      # at work: not waiting on you
        chat("e", "waiting", machine="desk"), chat("f", "waiting", machine="off", machine_off=True),
        chat("../x", "waiting"), chat("g", "idle", secret_asks=[{"name": "KEY"}])]})
    ok = wait(2)
    s = lines[-1] if ok else {}
    check("watcher: counts the chats that need you", s.get("needs") == 4, s)
    check("watcher: in the board's order, with links per machine",
          [c["link"] for c in s.get("chats", [])] == ["amarchy://chat/box/a", "amarchy://chat/box/c",
                                                        "amarchy://chat/desk/e", "amarchy://chat/box/g"], s)
    check("watcher: says what each waits on", s.get("chats", [{}])[0].get("why") == "Allow Bash?"
          and s["chats"][1]["why"] == "Needs your answer", s)
    # The board goes away: it says so. Back on the same address, it's
    # followed again, with nothing done.
    port, n = board.port, len(lines)
    board.stop()
    check("watcher: says when the board is gone", wait(n + 1) and lines[-1]["up"] is False and lines[-1]["why"],
          lines[-1:])
    board = Board(port)
    board.push({"hostname": "box", "sessions": [chat("a", "waiting")]})
    n = len(lines)
    check("watcher: back by itself when the board is", wait(n + 1, timeout=20) and lines[-1]["up"]
          and lines[-1]["needs"] == 1, lines[-1:])
    p.kill()
    # Its reader goes away (the widget reloaded): it ends, on the board's
    # next keepalive, though nothing changed to say.
    alone = subprocess.Popen([str(REPO / "bin/amarchy"), "bar", "--follow"], env=env, stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL)
    alone.stdout.readline()
    alone.stdout.close()
    try:
        alone.wait(timeout=20)
        check("watcher: ends when no one reads it", True)
    except subprocess.TimeoutExpired:
        check("watcher: ends when no one reads it", False, "still running")
        alone.kill()
    board.stop()

    # This machine's own board (127.0.0.1): in with the local key's cookie.
    key = "k" * 43
    (home / "state/amarchy/app").mkdir(parents=True, exist_ok=True)
    (home / "state/amarchy/app/local.key").write_text(key + "\n")
    own = Board(host="127.0.0.1", key=key)
    own.push({"hostname": "box", "sessions": [chat("a", "waiting")]})
    r = subprocess.Popen([str(REPO / "bin/amarchy"), "bar", "--follow"], env={**env, "AMARCHY_URL": own.url},
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first = json.loads(r.stdout.readline() or "{}")
    check("watcher: this machine's board, in with the local key", first.get("up") and first.get("needs") == 1, first)
    r.kill()
    own.stop()
    (home / "state/amarchy/app/local.key").write_text("wrong\n")
    own = Board(host="127.0.0.1", key=key)
    r = subprocess.Popen([str(REPO / "bin/amarchy"), "bar", "--follow"], env={**env, "AMARCHY_URL": own.url},
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first = json.loads(r.stdout.readline() or "{}")
    check("watcher: a key it doesn't take: down, with why", first.get("up") is False
          and first.get("why") == "this machine's amarchy didn't take the local key",
          first)
    r.kill()
    own.stop()

    # One state, not followed (amarchy bar).
    board6 = Board()
    board6.push({"hostname": "box", "sessions": [chat("a", "waiting")]})
    r = subprocess.run([str(REPO / "bin/amarchy"), "bar"], env={**env, "AMARCHY_URL": board6.url},
                       capture_output=True, text=True, timeout=30)
    board6.stop()
    # /api/state isn't served by the fake: a no, said as such.
    check("amarchy bar: a board that says no", r.returncode == 1 and json.loads(r.stdout)["up"] is False
          and "404" in json.loads(r.stdout)["why"], r.stdout + r.stderr)
    shutil.rmtree(home, ignore_errors=True)


# ---- the widget, drawn

HARNESS = r'''
import QtQuick
import Quickshell
import qs.Commons
import qs.Commons as Commons
ShellRoot {
  id: root
  property var widget
  property var button
  property int step: 0
  FloatingWindow {
    implicitWidth: 240
    implicitHeight: Style.bar.sizeHorizontal + 16
    color: Commons.Color.background
    Rectangle {
      id: frame
      anchors.centerIn: parent
      width: 220
      height: Style.bar.sizeHorizontal + 8
      color: (Commons.Color.bar && Commons.Color.bar.background) ? Commons.Color.bar.background : "#16161e"
      Item { id: host; anchors.centerIn: parent; width: 204; height: Style.bar.sizeHorizontal }
    }
  }
  Timer {
    interval: 600; repeat: true; running: true
    onTriggered: {
      if (root.step === 0) {
        const component = Qt.createComponent("file://PLUGIN/BarWidget.qml")
        if (component.status !== Component.Ready) { console.log("T_ERROR " + component.errorString()); Qt.quit(); return }
        root.widget = component.createObject(host, { moduleName: "amarchy.chats", height: Style.bar.sizeHorizontal })
        root.widget.anchors.verticalCenter = host.verticalCenter
        root.widget.anchors.left = host.left
        for (let i = 0; i < root.widget.children.length; i++)
          if (typeof root.widget.children[i].triggerPress === "function") root.button = root.widget.children[i]
      } else if (root.step === WAIT) {
        console.log("T_STATE " + JSON.stringify({ heard: root.widget.heard, up: root.widget.up, needs: root.widget.needs,
          chats: root.widget.chats, tooltip: root.widget.tooltip, active: root.button.active,
          label: root.button.labelText, opacity: root.button.opacity, restarts: root.widget.restarts }))
        frame.grabToImage(function(result) { result.saveToFile("SHOT"); console.log("T_SAVED") })
      } else if (root.step === WAIT + 1) {
        root.button.triggerPress(Qt.LeftButton)
      } else if (root.step === WAIT + 2) {
        root.button.triggerPress(Qt.RightButton)
      } else if (root.step === WAIT + 3) {
        Qt.quit()
      }
      root.step++
    }
  }
}
'''


def draw(name, line, installed=True, wait=2):
    """The widget with a fake amarchy saying line (then staying, as the real
    one does), or none at all: its state, what it ran, its log."""
    work = Path(tempfile.mkdtemp())
    home, config = work / "home", work / "config"
    (home / ".local/bin").mkdir(parents=True)
    theme = home / ".local/state/omarchy/current/theme"
    theme.mkdir(parents=True)
    shutil.copy(SRC / "themes/tokyo-night/colors.toml", theme)
    if installed:
        fake = home / ".local/bin/amarchy"
        fake.write_text("#!/bin/sh\necho \"$@\" >> \"$HOME/calls\"\n[ \"$1\" = bar ] || exit 0\n"
                        f"cat <<'EOF'\n{line}\nEOF\nexec sleep 600\n")
        fake.chmod(0o755)
    config.mkdir()
    for item in (SRC / "shell").iterdir():
        if item.name != "shell.qml":
            (config / item.name).symlink_to(item)
    shot = OUT / f"{name}.png"
    (config / "shell.qml").write_text(HARNESS.replace("PLUGIN", str(REPO / "omarchy/plugin"))
                                      .replace("SHOT", str(shot)).replace("WAIT", str(wait)))
    env = {**os.environ, "HOME": str(home), "OMARCHY_PATH": str(SRC), "QT_QPA_PLATFORM": "offscreen",
           "QT_QUICK_BACKEND": "software", "QT_QPA_PLATFORMTHEME": "", "QT_STYLE_OVERRIDE": ""}
    r = subprocess.run(["timeout", "40", "quickshell", "-p", str(config), "--no-color"], env=env,
                       capture_output=True, text=True, stdin=subprocess.DEVNULL)
    log = r.stdout + r.stderr
    state = next((json.loads(l.split("T_STATE ", 1)[1]) for l in log.splitlines() if "T_STATE " in l), None)
    calls = (home / "calls").read_text().splitlines() if (home / "calls").exists() else []
    problems = [l for l in log.splitlines() if ("WARN" in l or "ERROR" in l) and "plugin/BarWidget.qml" in l]
    shutil.rmtree(work, ignore_errors=True)
    return state, calls, problems, shot


def widget_test():
    OUT.mkdir(parents=True, exist_ok=True)
    needs = {"up": True, "board": "https://box.example.ts.net", "needs": 7, "chats": [
        {"link": "amarchy://chat/box/amarchy-bar", "name": "Bar: the Ⓐ <img src=x>", "why": "Allow Bash?"},
        {"link": "amarchy://chat/../etc/passwd", "name": "a bad link", "why": "x"},
        {"link": "amarchy://chat/desk/x-theme", "name": "Theme:\tlive\nnow", "why": "Needs your answer"}]}
    s, calls, problems, shot = draw("needs", json.dumps(needs))
    check("widget: draws without a QML problem", s is not None and not problems, problems)
    if s:
        check("widget: lit, with the count", s["active"] and s["label"] == "7" and s["needs"] == 7, s)
        check("widget: a link that isn't a chat's is dropped", [c["link"] for c in s["chats"]] ==
              ["amarchy://chat/box/amarchy-bar", "amarchy://chat/desk/x-theme"], s["chats"])
        check("widget: names on one line each", s["chats"][1]["name"] == "Theme: live now", s["chats"])
        check("widget: tooltip says who and what", s["tooltip"].splitlines() == [
            "7 chats need you", "Bar: the Ⓐ <img src=x> · Allow Bash?", "Theme: live now · Needs your answer",
            "and 5 more", "Click: open it · Right click: all your chats"], s["tooltip"])
    check("widget: click opens the first chat, right click your chats",
          calls == ["bar --follow", "open amarchy://chat/box/amarchy-bar", "open"], calls)
    check("widget: picture saved", shot.is_file(), shot)

    s, calls, problems, shot = draw("none", json.dumps({"up": True, "board": "b", "needs": 0, "chats": []}))
    check("widget: nothing needs you: plain, no count", s and not s["active"] and s["label"] == "" and s["opacity"] == 1, s)
    check("widget: nothing needs you: says so", s and s["tooltip"] == "Amarchy · no chat needs you\nClick: your chats", s)
    check("widget: nothing needs you: click opens your chats", calls == ["bar --follow", "open", "open"], calls)

    s, calls, problems, shot = draw("down", json.dumps({"up": False, "board": "b", "why": "The board doesn't answer"}))
    check("widget: board down: dimmed, with why", s and s["opacity"] < 1 and not s["active"]
          and s["tooltip"] == "Amarchy · The board doesn't answer", s)

    s, calls, problems, shot = draw("missing", "", installed=False, wait=6)
    check("widget: no amarchy yet: dimmed, says so, tries again", s and s["opacity"] < 1 and s["restarts"] >= 2
          and s["tooltip"] == "Amarchy · amarchy isn't installed", s)
    check("widget: no amarchy yet: no QML problem", not problems, problems)


def lint_test():
    lint = shutil.which("qmllint") or "/usr/lib/qt6/bin/qmllint"
    if not Path(lint).exists():
        print("skip: no qmllint")
        return
    q = Path(tempfile.mkdtemp())
    (q / "qs").mkdir()
    (q / "qs/Commons").symlink_to(SRC / "shell/Commons")
    (q / "qs/Ui").symlink_to(SRC / "shell/Ui")
    r = subprocess.run([lint, "-I", str(q), "-I", "/usr/lib/qt6/qml", "--json", "-",
                        str(REPO / "omarchy/plugin/BarWidget.qml")], capture_output=True, text=True)
    try:
        found = [w for f in json.loads(r.stdout)["files"] for w in f["warnings"]]
    except (ValueError, KeyError):
        found = [r.stdout + r.stderr]
    check("qmllint finds nothing", not found, found)
    shutil.rmtree(q, ignore_errors=True)


def main():
    watcher_test()
    if (SRC / "shell").is_dir() and shutil.which("quickshell"):
        widget_test()
        lint_test()
    else:
        print(f"skip: the widget needs Quickshell and Omarchy's shell in {SRC}")
    print(f"\n{len(failed)} failed" if failed else f"\nall ok (pictures in {OUT})")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
