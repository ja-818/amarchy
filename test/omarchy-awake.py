#!/usr/bin/env python3
"""Keep-awake: while a chat on this machine works, amarchy's app server holds
off the machine's idle sleep, and lets go when none does.

- With a fake systemd-inhibit (it logs what it's asked, then runs what it
  holds for): held for a chat in its turn or running what it started, not for
  one idle, asleep or waiting on you; one lock however many work; let go when
  the last one stops; never with `amarchy awake off`; "idle" only (the lid and
  Suspend still sleep the machine); a systemd-inhibit that can't take it is
  said, and not tried again every second; the lock goes with the server when
  the server dies (killed, not stopped).
- `amarchy awake` says each of those.
- With the real systemd-inhibit, when it's here: logind lists amarchy's lock
  while a chat works, and not after.

    python3 test/omarchy-awake.py
"""
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
failed = []


def check(what, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + what + (f": {detail}" if detail and not ok else ""), flush=True)
    if not ok:
        failed.append(what)


# A systemd-inhibit that logs its options, then holds while what it runs runs
# ($HOME/inhibit-fails: it can't take the lock, as logind would say).
FAKE = r'''#!/bin/sh
echo "$$ $*" >> "$HOME/inhibit-calls"
if [ -f "$HOME/inhibit-fails" ]; then echo "Failed to inhibit: Access denied" >&2; exit 1; fi
while [ $# -gt 0 ]; do case "$1" in --*) shift ;; *) break ;; esac; done
"$@"
echo "$$ released" >> "$HOME/inhibit-calls"
'''

# A server stand-in: amarchy's own awake_want, fed chats, one line of JSON
# (a list of statuses) at a time on stdin; it says "ok" after each.
DRIVER = r'''
import importlib.machinery, importlib.util, json, sys
loader = importlib.machinery.SourceFileLoader("am", sys.argv[1])
spec = importlib.util.spec_from_loader("am", loader); am = importlib.util.module_from_spec(spec); loader.exec_module(am)
for line in sys.stdin:
    am.awake_want([{"id": f"c{i}", "status": s} for i, s in enumerate(json.loads(line))])
    print("ok", flush=True)
'''


class Server:
    def __init__(self, home, env):
        self.home = home
        self.p = subprocess.Popen([sys.executable, "-c", DRIVER, str(REPO / "bin/amarchy")], env=env, text=True,
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def chats(self, *statuses):
        self.p.stdin.write(json.dumps(statuses) + "\n")
        self.p.stdin.flush()
        return self.p.stdout.readline().strip() == "ok"

    def calls(self):
        f = self.home / "inhibit-calls"
        return f.read_text().splitlines() if f.exists() else []

    def holders(self):
        """The fake systemd-inhibits still running."""
        held = {}
        for line in self.calls():
            pid, _, what = line.partition(" ")
            held[pid] = what != "released"
        return [pid for pid, on in held.items() if on and Path(f"/proc/{pid}").exists()]


def awake(env, *args):
    r = subprocess.run([sys.executable, str(REPO / "bin/amarchy"), "awake", *args], env=env, capture_output=True,
                       text=True, timeout=30)
    return r.stdout.strip()


def settle():
    time.sleep(0.5)


def fake_test(base):
    home = Path(base) / "home"
    (home / "bin").mkdir(parents=True)
    (home / "bin/systemd-inhibit").write_text(FAKE)
    (home / "bin/systemd-inhibit").chmod(0o755)
    env = {"HOME": str(home), "XDG_STATE_HOME": str(home / "state"), "XDG_CONFIG_HOME": str(home / "config"),
           "PATH": f"{home / 'bin'}:/usr/bin:/bin", "AMARCHY_HOST_NAME": "desk", "LANG": "C.UTF-8"}
    s = Server(home, env)
    s.chats()
    check("no chat: nothing held", not s.calls())
    check("amarchy awake: none works", awake(env).startswith("On: no chat works here now"), awake(env))
    s.chats("idle", "waiting", "idle")
    check("idle, waiting on you: nothing held", not s.calls())
    s.chats("working", "idle")
    settle()
    check("a chat in its turn: held", len(s.holders()) == 1, s.calls())
    opts = s.calls()[0].split(" ", 1)[1]
    check("idle only, never sleep or the lid", "--what=idle" in opts and "--mode=block" in opts
          and "sleep" not in opts.replace("--what=idle", "") and "lid" not in opts and "--who=amarchy" in opts, opts)
    check("amarchy awake: holding, for which", awake(env).startswith("Holding off idle sleep since")
          and "1 chat working here" in awake(env), awake(env))
    j = json.loads(awake(env, "--json"))
    check("amarchy awake --json", j["held"] is True and j["working"] == ["c0"] and j["server"] is True, j)
    s.chats("working", "running", "working")
    s.chats("running")
    settle()
    check("one lock however many work, kept while one runs what it started", len(s.holders()) == 1
          and len([c for c in s.calls() if "--what" in c]) == 1, s.calls())
    s.chats("idle", "idle")
    settle()
    check("none works: let go", not s.holders() and s.calls()[-1].endswith("released"), s.calls())
    check("amarchy awake: let go", awake(env).startswith("On: no chat works here now"), awake(env))

    awake(env, "off")
    s.chats("working")
    settle()
    check("awake off: never held", not s.holders(), s.calls())
    check("amarchy awake: off", awake(env).startswith("Off:"), awake(env))
    awake(env, "on")
    s.chats("working")
    settle()
    check("awake on again: held", len(s.holders()) == 1, s.calls())
    awake(env, "off")
    s.chats("working")
    settle()
    check("turned off while held: let go", not s.holders(), s.calls())
    awake(env, "on")

    # It can't take the lock: said, and not tried every second.
    s.chats("idle")
    (home / "inhibit-fails").write_text("")
    n = len(s.calls())
    for _ in range(5):
        s.chats("working")
    check("can't take it: tried once, not every second", len(s.calls()) - n == 1, s.calls()[n:])
    check("can't take it: amarchy awake says why", "Access denied" in awake(env), awake(env))
    (home / "inhibit-fails").unlink()

    # The server dies (killed): its lock goes with it.
    s.p.kill()
    s.p.wait()
    s2 = Server(home, env)
    s2.chats("working")
    settle()
    held = s2.holders()
    check("a new server holds it", len(held) == 1, s2.calls())
    s2.p.send_signal(signal.SIGKILL)
    s2.p.wait()
    for _ in range(30):
        if not s2.holders():
            break
        time.sleep(0.1)
    check("the server killed: its lock goes too", not s2.holders(), s2.calls()[-3:])
    check("amarchy awake: no server, nothing held", awake(env).startswith("On, but amarchy's app isn't running"),
          awake(env))


def real_test(base):
    if not shutil.which("systemd-inhibit"):
        print("skip: no systemd-inhibit here")
        return
    home = Path(base) / "real"
    home.mkdir()
    env = {"HOME": str(home), "XDG_STATE_HOME": str(home / "state"), "XDG_CONFIG_HOME": str(home / "config"),
           "PATH": os.environ.get("PATH", "/usr/bin:/bin"), "AMARCHY_HOST_NAME": "desk", "LANG": "C.UTF-8",
           **{k: os.environ[k] for k in ("XDG_RUNTIME_DIR", "DBUS_SYSTEM_BUS_ADDRESS") if k in os.environ}}
    s = Server(home, env)

    def listed():
        out = subprocess.run(["systemd-inhibit", "--list", "--no-pager"], capture_output=True, text=True).stdout
        return [l for l in out.splitlines() if l.split()[:1] == ["amarchy"] and str(s.p.pid) not in l
                and "A chat in amarchy is working" in l]
    before = len(listed())
    s.chats("working")
    settle()
    now = listed()
    check("logind lists amarchy's idle lock while a chat works", len(now) == before + 1 and " idle " in f" {now[-1]} ",
          now)
    s.chats("idle")
    settle()
    check("and not after", len(listed()) == before, listed())
    s.p.kill()


def main():
    base = tempfile.mkdtemp(prefix="omarchy-awake-")
    try:
        fake_test(base)
        real_test(base)
    finally:
        shutil.rmtree(base, ignore_errors=True)
    print(f"\n{len(failed)} failed" if failed else "\nall ok")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
