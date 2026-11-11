# A new chat is at work from the moment you make it until its first turn
# ends: never idle (so never "done", lit, or "Done" on your phone) in between,
# while its Claude starts and before it takes your first message. A Claude
# that only started hasn't finished anything: no chat is done by starting, by
# being stopped, or by its conversation being compacted mid-turn. With a fake
# claude that speaks the chat engine's protocol; without a browser.
#
#   python3 test/new-chat-state.py       exits 0 when every check passed

import importlib.machinery, importlib.util, io, json, os, subprocess, sys, tempfile, threading, time
from pathlib import Path

home = tempfile.mkdtemp(prefix="new-chat-state-")
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config")
entry = str(Path(__file__).resolve().parent.parent / "bin/amarchy")
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", entry)
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failed.append(what)

# A claude that answers the control protocol, takes a second to start and a
# moment to take a message (as the real one does), and ends each turn.
fake = Path(home) / "bin"
fake.mkdir()
(fake / "claude").write_text('''#!/usr/bin/env python3
import json, sys, time
def say(o):
    sys.stdout.write(json.dumps(o) + "\\n"); sys.stdout.flush()
for line in sys.stdin:
    try:
        o = json.loads(line)
    except ValueError:
        continue
    if o.get("type") == "control_request":
        if o["request"].get("subtype") == "initialize":
            time.sleep(1.0)
        say({"type": "control_response", "response": {"subtype": "success", "request_id": o["request_id"], "response": {}}})
    elif o.get("type") == "user":
        time.sleep(1.0)
        open("turn-ended", "w").close()
        say({"type": "result", "subtype": "success", "is_error": False, "duration_ms": 1000, "session_id": "c0ffee00-0000-4000-8000-000000000001", "result": "ok"})
''')
(fake / "claude").chmod(0o755)
env = dict(os.environ, PATH=f"{fake}:{os.environ['PATH']}")

am.SESSIONS.mkdir(parents=True, exist_ok=True)
am.STATUS.mkdir(parents=True, exist_ok=True)

def make(sid, prompt=None, status="working"):
    wt = Path(home) / f"wt-{sid}"
    wt.mkdir()
    s = {"id": sid, "repo": "proj", "name": sid.split("-", 1)[1], "branch": "b", "base": "origin/main", "path": str(wt), "engine": "chat", "created": int(time.time())}
    if prompt is not None:
        s["prompt"] = prompt
    (am.SESSIONS / f"{sid}.json").write_text(json.dumps(s))
    (am.STATUS / sid).write_text(status)      # as new_session leaves it: working while it's set up
    return s

def watch(sid, until, limit=15):
    """The chat's statuses in turn (and whether it was ever lit as done),
    while its broker runs, until `until(states)`."""
    proc = subprocess.Popen([entry, "claude", sid], env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    states, lit, early, end = [], [], [], time.time() + limit
    turn = Path(home) / f"wt-{sid}" / "turn-ended"
    try:
        while time.time() < end and proc.poll() is None:
            try:
                now = (am.STATUS / sid).read_text().strip()
            except OSError:
                now = ""
            if now and (not states or states[-1] != now):
                states.append(now)
                lit.append(am.unseen(sid))
                if now == "idle" and not turn.exists():
                    early.append(len(states) - 1)      # idle with no turn ended yet
            if until(states):
                break
            time.sleep(0.02)
    finally:
        done = am.finished_now(sid)
        proc.terminate()
        try:
            proc.wait(12)
        except subprocess.TimeoutExpired:
            proc.kill()
    if proc.returncode not in (0, -15) and not states:
        print(proc.stderr.read()[-2000:])
    return states, lit, done, early

# A new chat with its first message: working until its turn ends, then done.
make("proj-first", prompt="Build the thing")
states, lit, done, early = watch("proj-first", lambda st: st[-1:] == ["idle"])
check(states == ["working", "idle"] and not early, f"a new chat with a first message: working until its turn ends ({states}{', idle before it' if early else ''})")
check(lit == [False, True] and done, f"lit as done only once that turn ended ({lit}, finished {done})")

# A new chat without one: idle once its Claude is up, and nothing's done.
make("proj-empty")
states, lit, done, early = watch("proj-empty", lambda st: st[-1:] == ["idle"])
time.sleep(0.2)
check(states == ["working", "idle"] and not am.unseen("proj-empty") and not done,
      f"a new chat with nothing to do: idle, not done ({states}, unseen {am.unseen('proj-empty')})")

# Woken with what you sent while it slept: working at once.
make("proj-woken", status="idle")
am.claude_dir("proj-woken").mkdir(parents=True, exist_ok=True)
(am.claude_dir("proj-woken") / "send").write_text("Go on")
states, lit, done, early = watch("proj-woken", lambda st: st[-1:] == ["idle"] and len(st) > 2)
check(states == ["idle", "working", "idle"] and lit == [False, False, True] and early == [0], f"woken with your message: working, then done ({states}, {lit})")

# ---- the hook
def hook(sid, state, event):
    old_in, old_out, sys.stdin, sys.stdout = sys.stdin, sys.stdout, io.StringIO(json.dumps(event)), io.StringIO()
    try:
        am.cmd_hook(sid, state)
    finally:
        sys.stdin, sys.stdout = old_in, old_out
    return (am.STATUS / sid).read_text().strip()

# The chat engine's Claude starting says nothing of its status: its broker does.
make("proj-hook")
check(hook("proj-hook", "start", {"hook_event_name": "SessionStart", "source": "startup", "session_id": "x"}) == "working"
      and not am.unseen("proj-hook"), "Claude starting on the chat engine: the new chat stays working, nothing's done")
check(hook("proj-hook", "start", {"hook_event_name": "SessionStart", "source": "compact", "session_id": "x"}) == "working"
      and not am.unseen("proj-hook"), "its conversation compacted mid-turn: it works on")
check(hook("proj-hook", "idle", {"hook_event_name": "Stop", "session_id": "x", "stop_hook_active": True}) == "idle"
      and am.unseen("proj-hook") and am.finished_now("proj-hook"), "its turn ended: idle, done, and it tells you")

# The classic terminal's: idle and not done, or working when it starts with your first message.
s = make("proj-tui")
s["engine"] = "terminal"
(am.SESSIONS / "proj-tui.json").write_text(json.dumps(s))
check(hook("proj-tui", "start", {"hook_event_name": "SessionStart", "source": "startup"}) == "idle" and not am.unseen("proj-tui"),
      "the terminal's Claude starting: idle, not done")
(am.STATUS / "proj-tui").write_text("working")
am.write_file(am.claude_dir("proj-tui") / "first", "")
check(hook("proj-tui", "start", {"hook_event_name": "SessionStart", "source": "startup"}) == "working" and not am.unseen("proj-tui"),
      "starting with your first message: working all along")
check(hook("proj-tui", "start", {"hook_event_name": "SessionStart", "source": "resume"}) == "idle", "that message is its first only once")
(am.STATUS / "proj-tui").write_text("working")
check(hook("proj-tui", "start", {"hook_event_name": "SessionStart", "source": "compact"}) == "working", "compacted mid-turn: it works on")

# ---- what tells you: only a turn that finished
row = {"id": "proj-hook", "repo": "proj"}
am.write_file(am.ALERTS_FILE, "all\n")
check(am.alert_kind(row, "idle", "working") == "session", "a finished turn tells you (alerts: all)")
am.set_status("proj-hook", "working")
time.sleep(0.05)
am.set_status("proj-hook", "idle", done=False)
check(am.alert_kind(row, "idle", "working") is None, "a turn you stopped doesn't, though an older one is still unseen")
check(am.alert_kind({"id": "proj-empty", "repo": "proj"}, "idle", "working") is None, "a chat that only started doesn't")
check(am.alert_kind({"id": "proj-empty", "repo": "proj"}, "waiting", "working") == "session", "one that asks you does")

print("\nFAILED: " + "; ".join(failed) if failed else "\nall passed")
sys.exit(1 if failed else 0)
