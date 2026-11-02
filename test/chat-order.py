# The chats' order: your assistant, pinned, Now, For later, the one you last
# wrote to first in each. Only what you do moves a chat. Without a browser.
#
#   python3 test/chat-order.py       exits 0 when every check passed

import importlib.machinery, importlib.util, json, os, tempfile
from pathlib import Path

home = tempfile.mkdtemp(prefix="chat-order-")
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config")
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(Path(__file__).resolve().parent.parent / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failed.append(what)

stamp = lambda minute: f"2026-11-01T10:{minute:02d}:00.000Z"
at = lambda minute: am.timestamp({"timestamp": stamp(minute)})
def said(minute, text):
    return {"type": "assistant", "timestamp": stamp(minute), "message": {"role": "assistant", "content": [{"type": "text", "text": text}]}}
def you(minute, text="go on"):
    return {"type": "user", "timestamp": stamp(minute), "message": {"role": "user", "content": text}}
def tool(minute):
    return {"type": "user", "timestamp": stamp(minute), "message": {"role": "user", "content": [{"type": "tool_result", "content": "x"}]}}
goal = '\n```goal state="working"\nA goal\n```'

logs = {}
am.transcript = lambda s: logs.get(s.get("id"))
def chat(sid, records, **more):
    f = Path(home) / f"{sid}.jsonl"
    f.write_text("".join(json.dumps(r) + "\n" for r in records))
    logs[sid] = f
    am._replies.pop(str(f), None)
    return {"id": sid, "repo": "p", "status": "idle", "created": at(0), **more}

s = chat("wrote", [you(1), said(2, "x"), you(5), said(6, "Done." + goal)])
check(am.last_you(s) == at(5), "the last time you wrote, past its goal block")
check(am.chat_reply(s)["goal"] == "A goal" and am.chat_reply(s)["goal_at"] == at(6), "its goal still read")

s = chat("replies", [you(1), said(3, "Done." + goal), said(9, "A task finished"), tool(10), said(11, "Going on")], status="working")
check(am.last_you(s) == at(1), "a reply, a tool's result, a turn of its own: don't move it")

s = chat("asks", [you(1), said(2, "Which?" + goal)])
before = am.last_you(s)
s["status"] = "waiting"
check(am.last_you(s) == before, "asking you doesn't move it")

s = chat("told", [{"type": "user", "timestamp": stamp(7), "message": {"role": "user", "content": "<task-notification>done</task-notification>"}}])
check(am.last_you(s) == at(0), "what's put in your name doesn't count: when it opened")

s = {"id": "new", "repo": "p", "status": "idle", "created": at(30)}
check(am.last_you(s) == at(30), "nothing said yet: when it opened")

# More written after: read again, the time carried if it's further back than what's read.
s = chat("grows", [you(4), said(5, "Done." + goal)])
am.chat_reply(s)
with open(logs["grows"], "a") as f:
    f.write(json.dumps(said(8, "x" * 300_000)) + "\n" + json.dumps(said(9, "still at it")) + "\n")
check(am.last_you(s) == at(4), "a long turn: when you wrote is kept")

mk = lambda sid, minute, **more: chat(sid, [you(minute), said(minute, "x")], **more)
ss = [mk("low-new", 9, priority="low"), mk("now-old", 2), mk("now-new", 8), mk("pin-old", 1, priority="high"), mk("helper", 0, assistant="main", priority="low")]
order = [s["id"] for s in sorted(ss, key=am.session_order)]
check(order == ["helper", "pin-old", "now-new", "now-old", "low-new"], f"assistant, pinned, Now by you, For later ({order})")

print("all ok" if not failed else f"{len(failed)} FAILED")
raise SystemExit(1 if failed else 0)
