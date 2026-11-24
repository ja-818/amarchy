# A turn that ends the instant its message goes in (a quick answer, a
# command) leaves the chat idle, never "working" with nothing at work (its
# card said Working, and a move was refused, until its next turn). The
# broker's status writes go one at a time, each as what's known says it as
# it's written (Agent.status_lock): one worked out as the message went in
# (working) never lands over the turn's end (idle).
#
# Deterministic: a fake Claude that answers as its message is written, its
# answer handled on another thread (as the broker's reader does) while the
# message's "working" is on its way to the status file. Without a browser.
#
#   python3 test/broker-status.py       exits 0 when every check passed

import importlib.machinery, importlib.util, json, os, shutil, sys, tempfile, threading, time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import homes      # (test/homes.py: its home gone with it, however it ends)
home = homes.home("broker-status")
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config")
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(Path(__file__).resolve().parent.parent / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failed.append(what)


sid = "proj-quick"
wt = Path(home) / "wt"
wt.mkdir()
for d in (am.SESSIONS, am.STATUS):
    d.mkdir(parents=True, exist_ok=True)
(am.SESSIONS / f"{sid}.json").write_text(json.dumps({"id": sid, "repo": "proj", "name": "quick", "branch": "quick", "path": str(wt), "engine": "chat"}))
am.claude_dir(sid).mkdir(parents=True, exist_ok=True)
status = lambda: (am.STATUS / sid).read_text().strip() if (am.STATUS / sid).exists() else ""

agent = am.Agent({"id": sid, "path": str(wt), "repo": "proj"})
agent.live["state"] = "idle"
agent.changed = lambda *a, **k: None        # (no app to tell)
agent.titled = True                         # (nor a title to give it)
result = {"type": "result", "subtype": "success", "is_error": False, "duration_ms": 1, "session_id": "s1", "result": "ok"}
answered = []


class Quick:
    """Claude's stdin: what's written in is answered at once, on another
    thread, the moment the broker has worked out that it's working (and
    is about to say so)."""
    def write(self, line):
        if json.loads(line).get("type") == "user":
            def answer():
                end = time.time() + 3
                while agent.live["state"] != "working" and time.time() < end:
                    time.sleep(0.001)
                agent.handle(result)
            t = threading.Thread(target=answer, daemon=True)
            answered.append(t)
            t.start()

    def flush(self):
        pass


agent.claude = type("C", (), {"stdin": Quick()})()

# The status as the message went in ("working", after Claude has it: set_state)
# held until the answer had its chance to be written first.
real = am.agent_status
def held(s, state, done=True):
    reader = next((x for x in answered if isinstance(x, threading.Thread)), None)
    if state == "working" and reader is not None:
        reader.join(1.5)        # (one at a time: it waits for this one, so it can't be first)
    real(s, state, done)
am.agent_status = held

for n in range(3):
    answered.clear()
    agent.send(f"quick one {n + 1}")
    reader = next(x for x in answered if isinstance(x, threading.Thread))
    reader.join(5)
    check(not reader.is_alive() and agent.live["state"] == "idle" and not agent.busy, f"turn {n + 1}: answered, the broker idle")
    check(status() == "idle", f"turn {n + 1}: the chat idle, not working with nothing at work ({status()!r})")

# And the other way round: what asks you, left asked (waiting), never idle over it.
am.agent_status = real
agent.live["pending"] = [{"request_id": "r1"}]
agent.set_state()
check(status() == "waiting", f"something asks: waiting ({status()!r})")
agent.live["pending"] = []
agent.set_state()
agent.status_as(lambda: "idle" if not agent.busy and not agent.live["pending"] else None)
check(status() == "idle", f"answered: idle ({status()!r})")

print(f"\n{'all passed' if not failed else f'{len(failed)} failed'}")
sys.exit(1 if failed else 0)
