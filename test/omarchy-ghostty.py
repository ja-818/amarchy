#!/usr/bin/env python3
"""`amarchy ghostty`: a chat of this machine's in a real Ghostty window.

- With fakes (ghostty and Hyprland log what they're asked): a window of its
  own (its class, its title) running `amarchy attach <id> term` (or claude);
  the window it has already brought to the front instead of a second one;
  refused, saying why, without Ghostty, without a desktop, for a chat that
  isn't here or is on another machine; from a chat's terminal, that chat.
- For real, when Xvfb, Ghostty and tmux are here: Ghostty opened on an X
  display attaches to the chat's terminal (tmux, on a socket of the test's
  own: a client shows on it), with a picture of the window.

    python3 test/omarchy-ghostty.py        # OUT=<folder> keeps the picture
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = Path(os.environ.get("OUT") or tempfile.gettempdir())
failed = []


def check(what, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + what + (f": {detail}" if detail and not ok else ""), flush=True)
    if not ok:
        failed.append(what)


GHOSTTY = '#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done > "$HOME/ghostty-args"\necho "---" >> "$HOME/ghostty-calls"\n'
HYPRCTL = r'''#!/bin/sh
case "$1" in
  clients) cat "$HOME/clients.json" 2>/dev/null || echo "[]" ;;
  dispatch) echo "$*" >> "$HOME/hyprctl-calls"; echo ok ;;
esac
'''


def home_with_chat(base, tmux_socket=None):
    home = Path(base) / "home"
    state = home / "state/amarchy"
    (state / "sessions").mkdir(parents=True)
    work = home / "Work/proj"
    work.mkdir(parents=True)
    (state / "sessions/proj-pop.json").write_text(json.dumps({
        "id": "proj-pop", "repo": "proj", "name": "pop", "branch": "pop", "path": str(work), "created": int(time.time()),
        "title": "Pop out"}))
    (state / "tmux.conf").write_text("")
    env = {"HOME": str(home), "XDG_STATE_HOME": str(home / "state"), "XDG_CONFIG_HOME": str(home / "config"),
           "AMARCHY_WORK": str(home / "Work"), "AMARCHY_HOST_NAME": "desk", "LANG": "C.UTF-8",
           "XDG_RUNTIME_DIR": str(Path(base) / "run"), "PATH": "/usr/bin:/bin"}
    if tmux_socket:
        env["AMARCHY_TMUX"] = tmux_socket
    return home, env


def gh(env, *args):
    r = subprocess.run([sys.executable, str(REPO / "bin/amarchy"), "ghostty", *args], env=env, capture_output=True,
                       text=True, timeout=30)
    return r.returncode, r.stdout + r.stderr


def fake_test(base):
    home, env = home_with_chat(base)
    fakes = Path(base) / "bin"
    fakes.mkdir()
    (fakes / "ghostty").write_text(GHOSTTY)
    (fakes / "hyprctl").write_text(HYPRCTL)
    for f in fakes.iterdir():
        f.chmod(0o755)
    env = {**env, "PATH": f"{fakes}:/usr/bin:/bin", "DISPLAY": ":99"}

    def args():
        for _ in range(40):
            f = home / "ghostty-args"
            if f.exists():
                a = f.read_text().splitlines()
                f.unlink()
                return a
            time.sleep(0.05)
        return []
    code, out = gh(env, "proj-pop")
    a = args()
    check("a window of its own, running amarchy attach <id> term", code == 0 and a[:3] == [
        "--class=dev.amarchy.term-proj-pop", "--title=Pop out · terminal · amarchy", "-e"]
        and a[3:] == [str(REPO / "bin/amarchy"), "attach", "proj-pop", "term"], (code, out, a))
    code, out = gh(env, "proj-pop", "claude")
    a = args()
    check("claude: Claude's pane", code == 0 and a[:1] == ["--class=dev.amarchy.claude-proj-pop"] and a[-1] == "claude", a)
    code, out = gh({**env, "AMARCHY_SESSION": "proj-pop"})
    check("from a chat's terminal: that chat", code == 0 and args()[-2:] == ["proj-pop", "term"], out)

    # Hyprland, with the chat's window open already: to the front, nothing started.
    hy = {**env, "HYPRLAND_INSTANCE_SIGNATURE": "test"}
    (home / "clients.json").write_text(json.dumps([{"class": "dev.amarchy.term-proj-pop", "address": "0xabc",
                                                    "focusHistoryID": 2}]))
    (home / "ghostty-calls").unlink(missing_ok=True)
    code, out = gh(hy, "proj-pop")
    time.sleep(0.3)
    check("its window open already: brought to the front, no second one",
          code == 0 and not (home / "ghostty-calls").exists()
          and 'hl.dsp.focus({ window = "address:0xabc" })' in (home / "hyprctl-calls").read_text(), out)
    (home / "clients.json").unlink()

    code, out = gh({k: v for k, v in env.items() if k != "DISPLAY"}, "proj-pop")
    check("no desktop: says so", code == 1 and "has no desktop" in out, out)
    (fakes / "ghostty").unlink()
    code, out = gh({**env, "PATH": str(fakes)}, "proj-pop")      # (this machine's own Ghostty is in /usr/bin)
    check("no Ghostty: says so", code == 1 and "Ghostty isn't installed here" in out, out)
    code, out = gh(env, "proj-nope")
    check("a chat not here: says so", code == 1 and "no chat proj-nope on this machine" in out, out)
    code, out = gh(env, "box:proj-far")
    check("another machine's chat: open it there", code == 1 and "proj-far is on box" in out, out)


def real_test(base):
    if not all(shutil.which(c) for c in ("xvfb-run", "ghostty", "tmux")):
        print("skip: the real window needs xvfb-run, ghostty and tmux")
        return
    sock = f"amarchy-test-ghostty-{os.getpid()}"
    home, env = home_with_chat(base, tmux_socket=sock)
    tm = ["tmux", "-L", sock]
    try:
        for name, text in (("proj-pop", "Claude, in its pane"), ("proj-pop~term", "this chat terminal, in Ghostty")):
            subprocess.run([*tm, "new-session", "-d", "-s", name, "-x", "100", "-y", "30",
                            f"printf '\\n  amarchy: {text}\\n'; exec sleep 120"], check=True, env={**os.environ, **env})
        shot = OUT / "omarchy-ghostty.png"
        script = (f"{sys.executable} {REPO / 'bin/amarchy'} ghostty proj-pop || exit 9; "
                  f"for i in $(seq 1 40); do [ -n \"$(tmux -L {sock} list-clients -t =proj-pop~term)\" ] && break; sleep 0.5; done; "
                  f"sleep 2; tmux -L {sock} list-clients -t =proj-pop~term > {home}/clients; "
                  f"import -window root {shot} 2>/dev/null; true")
        r = subprocess.run(["xvfb-run", "-a", "-s", "-screen 0 1280x800x24", "sh", "-c", script],
                           env={**os.environ, **env, "PATH": os.environ.get("PATH", "/usr/bin:/bin")},
                           capture_output=True, text=True, timeout=120)
        clients = (home / "clients").read_text().strip() if (home / "clients").exists() else ""
        screen = subprocess.run([*tm, "capture-pane", "-p", "-t", "=proj-pop~term:"], capture_output=True, text=True).stdout
        check("a real Ghostty attaches to the chat's terminal (tmux has its client)", r.returncode == 0 and clients
              and "this chat terminal, in Ghostty" in screen, (r.returncode, r.stderr[-300:], clients, screen[:200]))
        check("its picture", shot.is_file() and shot.stat().st_size > 5000, shot)
        print(f"     picture: {shot}")
    finally:
        subprocess.run([*tm, "kill-server"], capture_output=True)


def main():
    base = tempfile.mkdtemp(prefix="omarchy-ghostty-")
    try:
        fake_test(Path(base) / "fake")
        real_test(Path(base) / "real")
    finally:
        shutil.rmtree(base, ignore_errors=True)
    print(f"\n{len(failed)} failed" if failed else "\nall ok")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
