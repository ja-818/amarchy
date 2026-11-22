#!/usr/bin/env python3
"""`amarchy open`: what Super+Alt+A, the Omarchy menu and the Ⓐ in the bar
run. With fakes of Hyprland (hyprctl), uwsm-app, the desktop app and
Omarchy's web-app launchers, each logging what it's asked:

- the desktop app: its window brought to the front when Hyprland has one
  (Omarchy's Lua dispatcher, the old one when that fails), started (through
  uwsm-app) when it hasn't, and handed the chat's link when there is one;
- what it's given: a link, <machine>/<id>, a chat's id (the board's
  machine's when this one hasn't it), nothing; anything else refused;
- without the desktop app, the board in a browser window at the chat, by the
  routes the desktop app takes: /#/s/<id> on that machine's own board,
  /#/s/<machine>:<id> for another's, /local?key=…&next=… on this machine's;
- without Hyprland, the app just started.

    python3 test/omarchy-open.py
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.parse
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
failed = []


def check(what, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + what + (f": {detail}" if detail and not ok else ""))
    if not ok:
        failed.append(what)


LOGGER = '#!/bin/sh\necho "NAME $*" >> "$HOME/log"\n'
UWSM = '#!/bin/sh\necho "uwsm-app $*" >> "$HOME/log"\n[ "$1" = -- ] && shift\nexec "$@"\n'
HYPRCTL = r'''#!/bin/sh
case "$1" in
  clients) cat "$HOME/clients.json" ;;
  dispatch)
    echo "hyprctl $*" >> "$HOME/log"
    case "$2" in hl.dsp.*) [ -f "$HOME/old-hyprland" ] && { echo "error: unknown dispatcher"; exit 1; } ;; esac
    echo ok ;;
esac
'''


def setup(base, desktop=True, hyprland=True, windows=()):
    home = Path(base) / "home"
    bin_ = Path(base) / "bin"
    bin_.mkdir(parents=True)
    (home / ".local/state").mkdir(parents=True)
    fakes = {"uwsm-app": UWSM, "omarchy-launch-webapp": LOGGER.replace("NAME", "webapp"),
             "omarchy-launch-or-focus-webapp": LOGGER.replace("NAME", "webapp-or-focus")}
    if desktop:
        fakes["amarchy-desktop"] = LOGGER.replace("NAME", "amarchy-desktop")
    if hyprland:
        fakes["hyprctl"] = HYPRCTL
    for name, text in fakes.items():
        (bin_ / name).write_text(text)
        (bin_ / name).chmod(0o755)
    clients = [{"class": "firefox", "address": "0xaaa", "focusHistoryID": 0}]
    clients += [{"class": "amarchy", "address": a, "focusHistoryID": i + 1} for i, a in enumerate(windows)]
    (home / "clients.json").write_text(json.dumps(clients))
    env = {"HOME": str(home), "PATH": f"{bin_}:/usr/bin:/bin", "XDG_RUNTIME_DIR": str(Path(base) / "run"),
           "AMARCHY_HOST_NAME": "desk", "AMARCHY_URL": "https://box.example.ts.net"}
    if hyprland:
        env["HYPRLAND_INSTANCE_SIGNATURE"] = "test"
    return home, env


def open_(env, *args):
    r = subprocess.run([str(REPO / "bin/amarchy"), "open", *args], env=env, capture_output=True, text=True, timeout=30)
    log = Path(env["HOME"]) / "log"
    for _ in range(40):         # what it started, started apart from it
        if log.exists() or r.returncode:
            break
        time.sleep(0.05)
    time.sleep(0.15)
    lines = log.read_text().splitlines() if log.exists() else []
    log.unlink(missing_ok=True)
    return r, lines


def main():
    with tempfile.TemporaryDirectory() as base:
        home, env = setup(base)
        r, log = open_(env)
        check("no window yet: the app started, through uwsm-app",
              log == ["uwsm-app -- " + str(Path(base) / "bin/amarchy-desktop"), "amarchy-desktop "], log)
        r, log = open_(env, "amarchy://chat/box/amarchy-bar")
        check("with a link: started with it", log[-1:] == ["amarchy-desktop amarchy://chat/box/amarchy-bar"], log)
        r, log = open_(env, "desk/x-theme")
        check("<machine>/<id> is that machine's chat", log[-1:] == ["amarchy-desktop amarchy://chat/desk/x-theme"], log)
        r, log = open_(env, "houston-os-c21")
        check("an id not here: the board's machine's chat", log[-1:] == ["amarchy-desktop amarchy://chat/box/houston-os-c21"],
              log)
        for bad in ("../etc", "amarchy://chat/BOX/x", "a/b/c", "x;rm -rf ~"):
            r, log = open_(env, bad)
            check(f"refuses {bad!r}", r.returncode == 1 and not log and "isn't a chat" in r.stderr, (r.returncode, log))

    with tempfile.TemporaryDirectory() as base:
        home, env = setup(base, windows=("0xbbb", "0xccc"))
        r, log = open_(env)
        check("a window already: brought to the front, nothing started",
              log == ['hyprctl dispatch hl.dsp.focus({ window = "address:0xbbb" })'], log)
        r, log = open_(env, "amarchy://chat/box/a")
        check("a window and a link: to the front, and the link handed over",
              log == ['hyprctl dispatch hl.dsp.focus({ window = "address:0xbbb" })',
                      "uwsm-app -- " + str(Path(base) / "bin/amarchy-desktop") + " amarchy://chat/box/a",
                      "amarchy-desktop amarchy://chat/box/a"], log)
        (home / "old-hyprland").write_text("")
        r, log = open_(env)
        check("a Hyprland without Lua dispatchers: focuswindow", log[-1:] == ["hyprctl dispatch focuswindow address:0xbbb"],
              log)

    with tempfile.TemporaryDirectory() as base:
        home, env = setup(base, hyprland=False)
        r, log = open_(env, "box/a")
        check("no Hyprland: the app just started", r.returncode == 0 and log[-1:] == ["amarchy-desktop amarchy://chat/box/a"],
              (r.stderr, log))

    # No desktop app: the board in a browser window.
    with tempfile.TemporaryDirectory() as base:
        home, env = setup(base, desktop=False)
        r, log = open_(env)
        check("no desktop app: your chats as a web app, focused if open",
              log[-1:] == ["webapp-or-focus Amarchy https://box.example.ts.net/"], log)
        r, log = open_(env, "amarchy://chat/box/amarchy-bar")
        check("no desktop app: the board's own chat", log[-1:] == ["webapp https://box.example.ts.net/#/s/amarchy-bar"], log)
        r, log = open_(env, "amarchy://chat/desk/x")
        check("no desktop app: another machine's chat", log[-1:] == ["webapp https://box.example.ts.net/#/s/desk:x"], log)
        # This machine's own board: in with the local key.
        (home / ".local/state/amarchy/app").mkdir(parents=True)
        (home / ".local/state/amarchy/app/local.key").write_text("K" * 43 + "\n")
        r, log = open_({**env, "AMARCHY_URL": "http://127.0.0.1:7999"}, "amarchy://chat/desk/x")
        url = log[-1].split(" ", 1)[1] if log else ""
        u = urllib.parse.urlsplit(url)
        q = urllib.parse.parse_qs(u.query)
        check("no desktop app, this machine's board: in with the local key, on to the chat",
              u.path == "/local" and q.get("key") == ["K" * 43] and q.get("next") == ["/#/s/x"], url)
        r, log = open_({**env, "AMARCHY_URL": "http://127.0.0.1:7999"}, "amarchy://chat/box/y")
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(log[-1].split(" ", 1)[1]).query) if log else {}
        check("no desktop app, this machine's board: another machine's chat", q.get("next") == ["/#/s/box:y"], log)
        # Nothing to open.
        env2 = {k: v for k, v in env.items() if k != "AMARCHY_URL"}
        env2["AMARCHY_HOST_URL"] = "https://desk.example.ts.net"
        r, log = open_(env2)
        check("no desktop app and no board: says how to get one", r.returncode == 1 and "amarchy machines add" in r.stderr
              and not log, (r.stderr, log))

    print(f"\n{len(failed)} failed" if failed else "\nall ok")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
