# How the chats are ordered (amarchy sort): Groups, Priority or Last, and what
# Last goes by: a chat's newest answer; what it says while at work doesn't
# move it; one asking counts from when it asked. Without a browser.
#
#   python3 test/sort-order.py       exits 0 when every check passed

import importlib.machinery, importlib.util, json, os, tempfile
from pathlib import Path

home = tempfile.mkdtemp(prefix="sort-order-")
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
goal = '\n```goal state="working"\nA goal\n```'

logs = {}
am.transcript = lambda s: logs.get(s.get("id"))
def chat(sid, records, status="idle", **more):
    f = Path(home) / f"{sid}.jsonl"
    f.write_text("".join(json.dumps(r) + "\n" for r in records))
    logs[sid] = f
    am._replies.pop(str(f), None)
    return {"id": sid, "repo": "p", "status": status, "created": at(0), **more}

s = chat("answered", [you(1), said(2, "on my way"), said(5, "Done." + goal)])
check(am.last_answer(s) == at(5), "idle: its newest reply")

s = chat("no-goal", [you(1), said(7, "A reply with no goal block")])
check(am.last_answer(s) == at(7), "a reply without a goal block counts too")

s = chat("working", [you(1), said(3, "Done." + goal), you(10), said(11, "Looking at it"), said(12, "Still looking")], "working")
check(am.last_answer(s) == at(3), "at work: the answer before your message, not what it says on the way")
s["status"] = "running"
check(am.last_answer(s) == at(3), "running on its own: the same")

s = chat("woken", [you(1), said(3, "Done." + goal), said(9, "A task finished, going on")], "working")
check(am.last_answer(s) == at(3), "woken without a message from you: its last answer")

s = chat("first", [you(1), said(2, "Looking")], "working")
check(am.last_answer(s) == at(0), "at work with no answer yet: when it opened")

s = chat("asking", [you(1), said(3, "Done." + goal), you(10)], "waiting")
os.utime(logs["asking"], (at(20), at(20)))
am._replies.pop(str(logs["asking"]), None)
check(am.last_answer(s) == at(20), "asking you: from when it asked")

s = {"id": "new", "repo": "p", "status": "idle", "created": at(30)}
check(am.last_answer(s) == at(30), "nothing said yet: when it opened")

# The orders.
a = {**chat("a", [said(1, "x")]), "priority": "high"}
b = {**chat("b", [said(9, "x")]), "priority": "low"}
c = {**chat("c", [said(5, "x")]), "priority": "normal", "assistant": "main"}
ids = lambda how: [x["id"] for x in sorted([a, b, c], key=lambda s: am.session_order(s, how))]
check(ids("last") == ["b", "c", "a"], f"last: the newest first, whatever its priority, your assistant among them ({ids('last')})")
check(ids("priority") == ["c", "a", "b"], f"priority: your assistant, then high before low ({ids('priority')})")
check(ids("groups")[0] == "c", "groups: your assistant first")

# The setting.
check(am.list_sort() == "groups", "groups by default")
am.STATE.mkdir(parents=True, exist_ok=True)
for old in ("newest", "oldest"):
    am.SORT_FILE.write_text(old + "\n")
    check(am.list_sort() == "groups", f"{old!r}, from before: groups")
check(am.set_list({"sort": "last"}) is None and am.list_sort() == "last", "set from the app")
check(am.set_list({"sort": "newest"}) is not None and am.list_sort() == "last", "a wrong one refused")
check(am.cmd_sort(["priority"]) == 0 and am.list_sort() == "priority", "amarchy sort priority")

print("all ok" if not failed else f"{len(failed)} FAILED")
raise SystemExit(1 if failed else 0)
