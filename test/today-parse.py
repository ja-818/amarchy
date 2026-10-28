# Today's reading, without a browser: your loops file's lines (due, waiting,
# someday, a date in MM-DD put in the nearest year), a reply's choices and
# goal block, a question you answered no longer asking, the goal block kept
# out of the list's preview, and what a loop's buttons tell your assistant.
#
#   python3 test/today-parse.py         exits 0 when every check passed

import datetime, importlib.machinery, importlib.util, json, os, sys, tempfile
from pathlib import Path

home = tempfile.mkdtemp(prefix="today-parse-")
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config")
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(Path(__file__).resolve().parent.parent / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failed.append(what)

today = datetime.date(2026, 10, 27)
loops = am.parse_loops("""# Loops
- [ ] 2026-10-30 · Demo to Felipe · nudge 10-29 · → log/2026-10-27.md
- [ ] waiting · Felipe · the valuation doc · since 10-23 · chase 10-27
- [ ] someday · Pick a gym · → projects/gym.md
- [x] 2026-10-20 · Done already
- [ ] waiting · adidas · refund · since 12-28 · chase 01-05
- [ ] 2026-10-29 · ECOS talk (chat jaken-ecos-talk) · nudge 10-27
not a loop
""", today)
check(len(loops) == 5, f"five open loops ({len(loops)})")
d, w, s, w2, c = loops
check(c["chat"] == "jaken-ecos-talk" and d["chat"] == "" and c["what"] == "ECOS talk (chat jaken-ecos-talk)", f"a loop naming its chat ({c})")
check(am.parse_loops("- [ ] someday · x (session jaken-o1-visa; progress in ~/o1)")[0]["chat"] == "jaken-o1-visa", "(session <id>) names it too")
check(d["kind"] == "due" and d["due"] == "2026-10-30" and d["what"] == "Demo to Felipe" and d["nudge"] == "2026-10-29" and d["ref"] == "log/2026-10-27.md", f"a dated loop ({d})")
check(w["kind"] == "waiting" and w["who"] == "Felipe" and w["what"] == "the valuation doc" and w["since"] == "2026-10-23" and w["chase"] == "2026-10-27", f"a waiting loop ({w})")
check(s["kind"] == "someday" and s["what"] == "Pick a gym", "a someday loop")
check(w2["since"] == "2025-12-28" and w2["chase"] == "2027-01-05", f"MM-DD in the nearest year, a since never ahead ({w2['since']}, {w2['chase']})")
check(len({l["key"] for l in loops}) == 5, "each its own key")

reply = '''It's ready for your go

The design is below.

```choices question="Build it?"
- Go | Go: build it
- Not yet
```

```goal state="waiting"
Make Today the app's home
```
'''
asks = am.reply_choices(reply)
check(asks == [{"question": "Build it?", "options": [{"label": "Go", "send": "Go: build it"}, {"label": "Not yet", "send": "Not yet"}]}], f"its choices ({asks})")
check(am.reply_goal(reply) == {"goal": "Make Today the app's home", "state": "waiting"}, "its goal block")
check("goal" not in am.without_goal(reply) and "Build it?" in am.without_goal(reply), "the goal block out of its words")

# A conversation: the reply asks, then you answer, then a reply without a goal block.
f = Path(home) / "t.jsonl"
rec = lambda kind, content, ts="2026-10-27T10:00:00Z": json.dumps({"type": kind, "timestamp": ts, "message": {"role": kind, "content": content}})
f.write_text("\n".join([rec("user", "build Today"), rec("assistant", [{"type": "text", "text": reply}])]) + "\n")
am.transcript = lambda s: f
r = am.chat_reply({"id": "x"})
check(r["state"] == "waiting" and r["goal"] == "Make Today the app's home" and len(r["asks"]) == 1, f"a chat asking ({r})")
check(am.needs_you([{"id": "x", "status": "idle", "today": r}]) == 1, "it needs you")
check(am.needs_you([{"id": "x", "status": "working", "today": r}]) == 0, "not while it works")
with open(f, "a") as fh:
    fh.write(rec("user", [{"type": "tool_result", "tool_use_id": "1", "content": "x"}]) + "\n")
os.utime(f, (1, 1))
check(len(am.chat_reply({"id": "x"})["asks"]) == 1, "a tool's result isn't your answer")
with open(f, "a") as fh:
    fh.write(rec("user", "Go: build it") + "\n" + rec("assistant", [{"type": "text", "text": "Building it"}]) + "\n")
r = am.chat_reply({"id": "x"})
check(r["asks"] == [] and r["goal"] == "Make Today the app's home", f"answered: no ask, the goal from the reply before ({r})")
with open(f, "a") as fh:
    fh.write(rec("assistant", [{"type": "text", "text": 'Shipped\n\n```goal state="done"\nMake Today the app\'s home\n```'}], "2026-10-27T12:00:00Z") + "\n")
r = am.chat_reply({"id": "x"})
check(r["state"] == "done" and r["goal_at"] > 0, "done, and when")

# Search: by name, by what was said (every word), its lines without markdown, a tool's output not.
with open(f, "a") as fh:
    fh.write(rec("user", [{"type": "tool_result", "tool_use_id": "2", "content": "secret pricing in a log"}]) + "\n")
    fh.write(rec("assistant", [{"type": "text", "text": "The **pricing** table for C21 is ready"}]) + "\n")
s = {"id": "x", "task": "Build: Today home", "repo": "amarchy", "name": "today"}
r = am.search_chats("pricing c21", [s])
check(len(r) == 1 and r[0]["hits"] == 1 and "**" not in r[0]["lines"][0]["text"] and "pricing" in r[0]["lines"][0]["text"], f"found by what was said ({r})")
check(am.search_chats("today home", [s])[0]["name"] is True, "found by its name")
check(am.search_chats("pricing nowhere", [s]) == [], "every word, or nothing")
check(am.search_chats("log", [s]) == [], "a tool's output isn't searched")

# Today's buttons on a loop, told to your assistant: New chat's message, its note optional.
told = []
am.read_loops = lambda: (am.parse_loops("- [ ] 2026-10-29 · ECOS talk · nudge 10-27\n- [ ] waiting · adidas · refund · since 10-24"), "/x/loops.md", "")
am.assistant = lambda: {"id": "me-jaken", "name": "Jaken"}
am.run_amarchy = lambda *a: told.append(a) or type("R", (), {"returncode": 0, "stderr": ""})()
ecos, adidas = am.read_loops()[0]
check(am.loop_tell(ecos["key"], "session") is None and told[-1] == ("send", "me-jaken", "Start a session for this loop: 2026-10-29 · ECOS talk · nudge 10-27", "--no-wait"),
      f"New chat: a session for the loop, no note ({told[-1:]})")
check(am.loop_tell(adidas["key"], "session", "  Personal: in jaken  ") is None
      and told[-1][2] == "Start a session for this loop: waiting · adidas · refund · since 10-24\n\nPersonal: in jaken", f"with a note under it ({told[-1:]})")
check(am.loop_tell(ecos["key"], "ask", "Draft it") is None and told[-1][2] == "About this loop: 2026-10-29 · ECOS talk · nudge 10-27\n\nDraft it", "Ask's unchanged")
check(am.loop_tell(ecos["key"], "done") is None and told[-1][2] == "Loop done: 2026-10-29 · ECOS talk · nudge 10-27. Tick it off in /x/loops.md.", "Done's unchanged")
check(am.loop_tell(ecos["key"], "ask") and am.loop_tell("nope", "session") and am.loop_tell(ecos["key"], "start"), "Ask needs words; a gone loop, an unknown action: refused")
check(am.loops_sent()[adidas["key"]]["action"] == "session", "the loop shows it was sent")

print(f"\n{len(failed)} failed: {failed}" if failed else "\nAll passed.")
import shutil
shutil.rmtree(home, ignore_errors=True)
sys.exit(1 if failed else 0)
