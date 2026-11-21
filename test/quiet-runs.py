# Routines you don't see when they've nothing for you. A timer, a script or
# another chat wakes a chat (amarchy send, another Claude's message); when what
# woke it leaves nothing you'd want to see, its Claude ends the turn with
# NO_REPLY, and the whole turn is gone from everything you see: its chat, the
# list's words, unread, Today, the notifications (idle, not done). While such
# a turn works, nothing of it shows (no typing…, no words, the chat idle as it
# was); once it ends with something to say, it's all there at once. The broker
# knows who started each turn (Claude names the message it starts on); a turn
# you started, or one that asked you something, is never hidden: NO_REPLY to
# it is sent back, to be answered. Without a browser.
#
#   python3 test/quiet-runs.py         exits 0 when every check passed

import importlib.machinery, importlib.util, io, json, os, shutil, sys, tempfile, time
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path

home = tempfile.mkdtemp(prefix="quiet-runs-")
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config", AMARCHY_WORK=home + "/Work")
for k in ("AMARCHY_SESSION", "AMARCHY_SENT_BY"):
    os.environ.pop(k, None)
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(Path(__file__).resolve().parent.parent / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failed.append(what)

def run(*args):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        rc = am.main(list(args))
    return rc, out.getvalue(), err.getvalue()

am.SESSIONS.mkdir(parents=True, exist_ok=True)
am.STATUS.mkdir(parents=True, exist_ok=True)
def mk(sid, repo, status="idle"):
    wt = Path(home, "wt", sid)
    wt.mkdir(parents=True, exist_ok=True)
    am.write_file(am.SESSIONS / f"{sid}.json", json.dumps({"id": sid, "repo": repo, "name": sid.split("-", 1)[1], "branch": "b",
                                                           "path": str(wt), "engine": "chat", "created": int(time.time()) - 3600}))
    (am.STATUS / sid).write_text(status)
    am.claude_dir(sid).mkdir(parents=True, exist_ok=True)
for sid, repo in [("fire-fire", "fire"), ("proj-a", "proj")]:
    mk(sid, repo)
run("agents", "fire-fire", "--name", "Fire")
S = {sid: am.session(sid) for sid in ("fire-fire", "proj-a")}

# ---- the word: NO_REPLY alone, or first or last with a few words of why
for text, note in [("NO_REPLY", ""), ("  `NO_REPLY`  ", ""), ("**NO_REPLY**", ""), ("NO_REPLY — skip: a scroll fix", "skip: a scroll fix"),
                   ("Skip: CSS fixed widths.\n---\nNO_REPLY", "Skip: CSS fixed widths. --- "[:-5].strip()),
                   ("Skip: a bug fix is not a personality. NO_REPLY.", "Skip: a bug fix is not a personality")]:
    got = am.silent_note(text)
    check(got is not None and (got == note or (note and got.startswith(note[:20]))), f"{text!r}: quiet, its note {got!r}")
for text in ["Posted it.", "", "NO_REPLYING is not a word", "I won't say NO_REPLY here, the merge is worth a post: here it is."]:
    check(am.silent_note(text) is None, f"{text!r}: not quiet")
check("NO_REPLY" in am.CHAT_FORMAT and "hides that whole turn" in am.CHAT_FORMAT and "Never NO_REPLY to what they wrote" in am.CHAT_FORMAT,
      "your agents' format says when and what it does")
check("NO_REPLY" in am.REPLY_FORMAT and "no goal block" in am.REPLY_FORMAT.split("NO_REPLY", 1)[1][:60],
      "a working chat's too, with no goal block for it")

# ---- who started it: amarchy send's note, taken once by the broker
am.send_later = lambda sid, f: True      # (nothing to deliver it to here)
run("send", "fire-fire", "Merged: amarchy d82d234 the terminal", "--no-wait")
os.environ["AMARCHY_SENT_BY"] = "you"
run("send", "fire-fire", "Replied to https://x.com/a/1", "--no-wait")
os.environ.pop("AMARCHY_SENT_BY")
queued = sorted(am.send_queue("fire-fire").glob("[0-9]*"))
check([am.send_entry(f).get("mine") for f in queued] == [False, True], "the queue says whose each message is (a timer's, your button's)")
check(isinstance(am.sent_by_read("fire-fire")[-1].get("until"), int), "the note says until when it may wait")
taken = set()
check(am.sent_by_taken("fire-fire", "Merged:  amarchy d82d234 the terminal", taken), "the timer's words reaching its Claude: not yours")
check(not am.sent_by_taken("fire-fire", "Merged: amarchy d82d234 the terminal", taken), "taken once: the same words again are yours")
check(not am.sent_by_taken("fire-fire", "Replied to https://x.com/a/1", set()), "your button: yours")
check(not am.sent_by_taken("fire-fire", "What's up?", set()), "what you wrote: yours")
old = am.SENT_BY / "fire-fire.jsonl"
with open(old, "a") as fh:
    fh.write(json.dumps({"at": time.time() - 9 * 3600, "hash": am.sent_hash("Ritual: idea pass"), "from": "", "until": int(time.time() - 8 * 3600)}) + "\n")
check(not am.sent_by_taken("fire-fire", "Ritual: idea pass", set()), "a note long past its wait: those words now are yours")

# ---- the broker: each turn, who began it
agent = am.Agent(S["fire-fire"])
fed = io.StringIO()
agent.claude = type("C", (), {"stdin": fed})()
agent.live["state"] = "idle"
run("send", "fire-fire", "Ritual (automatic timer): idea pass", "--no-wait")
r = agent.send("Ritual (automatic timer): idea pass")
turn = agent.live["turn"]
check(turn and turn["elsewhere"] and not turn["asked"] and turn["what"].startswith("Ritual"), f"a timer's message begins a turn that isn't yours ({turn})")
check(json.loads(am.agent_live_file("fire-fire").read_text())["turn"] == turn, "written before Claude has it (live.json)")
uid = json.loads(fed.getvalue().splitlines()[-1])["uuid"]
agent.handle({"type": "command_lifecycle", "state": "started", "command_uuid": uid})
check(agent.live["turn"]["elsewhere"], "Claude starting on it: still not yours")
agent.handle({"type": "command_lifecycle", "state": "started", "command_uuid": "cc-own"})
check(agent.live["turn"]["elsewhere"], "another Claude's message joining it: not yours either")
r = agent.send("Also check Slack", when="next")
uid2 = json.loads(fed.getvalue().splitlines()[-1])["uuid"]
agent.handle({"type": "command_lifecycle", "state": "started", "command_uuid": uid2})
check(agent.live["turn"]["elsewhere"] is False, "yours taken into it (Send now): yours")
agent.handle({"type": "result", "subtype": "success", "session_id": "c1"})
check(agent.live["turn"] is None, "the turn ends with its result")
ended = agent.ended
agent.handle({"type": "command_lifecycle", "state": "started", "command_uuid": "cc-peer"})
check(agent.live["turn"] and agent.live["turn"]["elsewhere"], "a turn Claude begins itself (another Claude's message): not yours")
agent.handle({"type": "user", "isReplay": True, "message": {"content": "Another Claude session sent a message:\n<cross-session-message from=\"x\">Mission report: skipped</cross-session-message>"}})
check(agent.live["turn"]["what"] == "Mission report: skipped", f"what began it, for amarchy quiet ({agent.live['turn']['what']!r})")
check(ended <= agent.live["turn"]["since"] <= time.time() and agent.live["turn"]["since"] >= time.time() - 2.1,
      "it counts from the last turn's end (its message may be written before Claude says so), 2 s back at most")
agent.handle({"type": "control_request", "request_id": "q1", "request": {"subtype": "can_use_tool", "tool_name": "Bash", "input": {"command": "x"}}})
check(agent.live["turn"]["asked"], "it asked you something: never quiet")
agent.live["pending"] = []
agent.handle({"type": "result", "subtype": "success", "session_id": "c1"})
r = agent.send("How did yesterday go?")
check(agent.live["turn"]["elsewhere"] is False, "your message: yours")
agent.handle({"type": "result", "subtype": "success", "session_id": "c1"})
agent.busy = True
run("send", "fire-fire", "Merged: houston-os #302 board columns", "--no-wait")
agent.send("Merged: houston-os #302 board columns")
q = am.chat_live(agent.live, S["fire-fire"])["queue"]
check(len(agent.live["queue"]) == 1 and agent.live["queue"][0].get("elsewhere") and q == [],
      "a timer's message waiting for Claude: not in your box's queue")
agent.queue, agent.busy = [], False

# ---- the turn's end (the Stop hook)
def hook(sid, event):
    old_in, old_out, sys.stdin, sys.stdout = sys.stdin, sys.stdout, io.StringIO(json.dumps(event)), io.StringIO()
    try:
        am.cmd_hook(sid, "idle")
        said = sys.stdout.getvalue()
    finally:
        sys.stdin, sys.stdout = old_in, old_out
    return (am.STATUS / sid).read_text().strip(), said
def live_turn(sid, **turn):
    live = json.loads(am.agent_live_file(sid).read_text()) if am.agent_live_file(sid).exists() else {}
    live.update(state="working", pending=[], turn={"since": time.time() - 30, "elsewhere": True, "asked": False, "what": "Merged: x", **turn})
    am.write_file(am.agent_live_file(sid), json.dumps(live))
am.hook_claude = lambda: {}
am.mark_seen("fire-fire")       # (the broker's turns above ended: done)
for sid in ("fire-fire", "proj-a"):
    (am.STATUS / sid).write_text("working")
    live_turn(sid)
    status, said = hook(sid, {"hook_event_name": "Stop", "last_assistant_message": "NO_REPLY — skip: a scroll fix", "session_id": "x"})
    check(status == "idle" and not am.unseen(sid) and said == "", f"{sid}: a timer's turn ended quiet: idle, nothing new, not sent back (no goal asked)")
    e = am.quiet_turns(sid)[-1]
    check(e["note"] == "skip: a scroll fix" and e["what"] == "Merged: x" and e["until"] >= e["since"], f"{sid}: written down, with its note ({e})")
am.mark_unseen("fire-fire")
(am.STATUS / "fire-fire").write_text("working")
live_turn("fire-fire")
hook("fire-fire", {"hook_event_name": "Stop", "last_assistant_message": "NO_REPLY", "session_id": "x"})
check(am.unseen("fire-fire"), "what you hadn't read before it: still unread")
am.mark_seen("fire-fire")
for what, turn in [("your own message", {"elsewhere": False}), ("a turn that asked you something", {"asked": True})]:
    (am.STATUS / "fire-fire").write_text("working")
    live_turn("fire-fire", **turn)
    n = len(am.quiet_turns("fire-fire"))
    status, said = hook("fire-fire", {"hook_event_name": "Stop", "last_assistant_message": "NO_REPLY", "session_id": "x"})
    ask = json.loads(said or "{}")
    check(ask.get("decision") == "block" and am.SILENT_MARK in ask.get("reason", "") and status == "working" and len(am.quiet_turns("fire-fire")) == n,
          f"NO_REPLY to {what}: sent back to be answered, not hidden")
    status, said = hook("fire-fire", {"hook_event_name": "Stop", "last_assistant_message": "NO_REPLY", "session_id": "x", "stop_hook_active": True})
    check(status == "idle" and am.unseen("fire-fire") and said == "", f"{what}, NO_REPLY again: shown, as any reply (not sent back twice)")
    am.mark_seen("fire-fire")
check(am.user_item(am.HOOK_FEEDBACK + "\n" + am.SILENT_ASK) is None, "that ask is amarchy's own: not in the chat")
(am.STATUS / "fire-fire").write_text("working")
live_turn("fire-fire")
status, said = hook("fire-fire", {"hook_event_name": "Stop", "last_assistant_message": "Worth a post: drafted it.", "session_id": "x"})
check(status == "idle" and am.unseen("fire-fire") and said == "", "a timer's turn with something to say: done, new, told")
am.mark_seen("fire-fire")

# ---- what you see: the quiet turns gone, as if they never ran
shutil.rmtree(am.QUIET_TURNS)
am._quiet.clear()
t0 = time.time() - 3600
iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(t)) + f".{int(t % 1 * 1000):03d}Z"
def user(text, t, uid):
    return {"type": "user", "uuid": uid, "timestamp": iso(t), "message": {"role": "user", "content": text}}
def said(text, t, uid):
    return {"type": "assistant", "uuid": uid, "timestamp": iso(t), "message": {"role": "assistant", "content": [{"type": "text", "text": text}]}}
def tool(t, uid, tid):
    return {"type": "assistant", "uuid": uid, "timestamp": iso(t), "message": {"role": "assistant", "content": [{"type": "tool_use", "id": tid, "name": "Bash", "input": {"command": "gh pr view 302"}}]}}
def result(t, uid, tid):
    return {"type": "user", "uuid": uid, "timestamp": iso(t), "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tid, "content": "x"}]}}
def summary(t, uid):
    return {"type": "system", "subtype": "stop_hook_summary", "uuid": uid, "timestamp": iso(t)}
sent_quiet = "Merged: houston-os #302 board columns keep one width"
with open(am.SENT_BY / "fire-fire.jsonl", "a") as fh:
    fh.write(json.dumps({"at": t0 + 99, "hash": am.sent_hash(sent_quiet), "from": ""}) + "\n")
lines = [user("Find me a post idea", t0, "h1"), said("**amarchy tour**: worth a post.\n---\nDraft's on its way.", t0 + 10, "a1"), summary(t0 + 10.2, "s1"),
         # The timer's, ended quiet: its message, a step, its words.
         user(sent_quiet, t0 + 100.05, "q1"), tool(t0 + 101, "q2", "tq"), result(t0 + 102, "q3", "tq"),
         said("Skip: CSS has widths now.\n---\nNO_REPLY", t0 + 103, "q4"), summary(t0 + 103.4, "s2"),
         user("Thanks!", t0 + 200, "h2"), said("Anytime.", t0 + 201, "a2"), summary(t0 + 201.2, "s3")]
f = Path(home, "fire.jsonl")
f.write_text("\n".join(json.dumps(l) for l in lines) + "\n")
am.transcript = lambda s: f if s and s["id"] == "fire-fire" else None
(am.STATUS / "fire-fire").write_text("idle")
am.write_file(am.agent_live_file("fire-fire"), json.dumps({"state": "idle", "pending": [], "turn": None, "queue": []}))
am.quiet_note("fire-fire", {"since": t0 + 100, "what": sent_quiet}, "Skip: CSS has widths now")
until = am.quiet_turns("fire-fire")[-1]
until["until"] = t0 + 103.2         # (the hook ran a moment after its words)
am.write_file(am.QUIET_TURNS / "fire-fire.jsonl", json.dumps(until) + "\n")
fs = am.session("fire-fire")
items = am.app_items(lines, fs)
keys = [it["key"].split(":")[0] for it in items]
check(keys == ["h1", "a1", "h2", "a2"], f"its chat: the quiet turn's message, step and words aren't there ({keys})")
check(not any(it.get("from") for it in items), "what you wrote after it is yours (the timer's words matched to its own message)")
w = am.last_words(fs, deep=True)
check(w["said"] == "Anytime." and w["after_you"] == 1, f"the list's words: what it said to you ({w['said']!r})")
lines2 = lines[:8]
f.write_text("\n".join(json.dumps(l) for l in lines2) + "\n")
w = am.last_words(fs, deep=True)
check(w["said"] == "Draft's on its way." and len(w["stamps"]) == 2, f"a quiet turn last: the words before it, nothing more to read ({w['said']!r}, {len(w['stamps'])})")
am.mark_seen("fire-fire")
os.utime(am.SEEN / "fire-fire", (t0 - 10, t0 - 10))
check(am.unread(fs, w) == 2, f"unread: what it said to you (2), not the quiet turn's ({am.unread(fs, w)})")
am.mark_seen("fire-fire")
proj = am.session("proj-a")
pf = Path(home, "proj.jsonl")
pf.write_text("\n".join(json.dumps(l) for l in [user("Ship the tour", t0, "h1"),
                                                 said("Shipped.\n\n```goal state=\"done\"\nShip the tour\n```", t0 + 10, "a1"),
                                                 user(sent_quiet, t0 + 100.05, "q1"), said("NO_REPLY", t0 + 103, "q4"), summary(t0 + 103.4, "s2")]) + "\n")
os.utime(pf, (t0 + 104, t0 + 104))
am.transcript = lambda s: f if s and s["id"] == "fire-fire" else pf if s and s["id"] == "proj-a" else None
am.write_file(am.QUIET_TURNS / "proj-a.jsonl", json.dumps({**until}) + "\n")
(am.STATUS / "proj-a").write_text("idle")
r = am.chat_reply(proj)
check(r["goal"] == "Ship the tour" and r["state"] == "done" and abs(r["at"] - (t0 + 10)) < 1,
      f"Today: its goal stands, and a quiet run didn't move it ({r['goal']!r}, {r['state']}, at {r['at'] - t0:.0f}s)")

# ---- the turn under way: nothing of it until it ends
f.write_text("\n".join(json.dumps(l) for l in lines[:3]) + "\n")
conv = am.AppConversation(fs)
items, reset = conv.poll()
check([i["key"].split(":")[0] for i in items] == ["h1", "a1"], "the chat, before the timer")
held = t0 + 300
with open(f, "a") as fh:
    for l in [user("Ritual (automatic timer): idea pass", held + 0.01, "r1"), said("Looking at Slack.", held + 5, "r2"), tool(held + 6, "r3", "tr")]:
        fh.write(json.dumps(l) + "\n")
(am.STATUS / "fire-fire").write_text("working")
am.write_file(am.agent_live_file("fire-fire"), json.dumps({"state": "working", "pending": [], "queue": [], "partial": "Found one",
                                                            "activity": {"tool": "Bash", "input": {}}, "thinking": False,
                                                            "turn": {"since": held, "elsewhere": True, "asked": False, "what": "Ritual"}}))
fs = am.session("fire-fire")
check(am.turn_hold(fs) == held, "a timer's turn at work: held")
items, reset = conv.poll()
check(items == [] and not reset, "its chat: nothing of it while it works")
check(am.last_words(fs, deep=True)["said"] == "Draft's on its way.", "the list's words: as they were")
live = am.chat_live(am.agent_live("fire-fire"), fs)
check(live["state"] == "idle" and live["partial"] == "" and live["activity"] is None and "turn" not in live,
      "the chat's live state: idle, no words coming, no step (no typing…)")
am.host_titles = lambda: {"fire-fire": "Fire", "proj-a": "A"}      # (both awake)
view = am.session_view()
row = next(s for s in view if s["id"] == "fire-fire")
check(row["quiet"] and row["status"] == "working", "amarchy list: at work, quiet")
app = am.app_row(row)
check(app["status"] == "idle" and app["doing"] is None and not app["waking"], "the app's row: as it was, idle (no typing…)")
check(am.app_row(next(s for s in view if s["id"] == "proj-a")) is next(s for s in view if s["id"] == "proj-a"), "any other row: as it is")
# It asks you something: shown at once.
live = am.agent_live("fire-fire")
live["turn"]["asked"] = True
am.write_file(am.agent_live_file("fire-fire"), json.dumps(live))
check(am.turn_hold(fs) is None, "it asks you something: not held")
live["turn"]["asked"] = False
am.write_file(am.agent_live_file("fire-fire"), json.dumps(live))
items, reset = conv.poll()
check(items == [], "held again")
# It ends with something to say: all of it, at once.
with open(f, "a") as fh:
    fh.write(json.dumps(said("Worth a post: the agents' tasks.", held + 20, "r4")) + "\n")
(am.STATUS / "fire-fire").write_text("idle")        # (the Stop hook: not quiet)
items, reset = conv.poll()
check([i["key"].split(":")[0] for i in items] == ["r1", "r2", "r3", "r4"] and items[0].get("from") is None,
      f"ended with something to say: its message, steps and words, at once ({[i['key'] for i in items]})")
check(am.last_words(fs, deep=True)["said"] == "Worth a post: the agents' tasks.", "and the list's words")
# Another, that ends quiet: never shown.
with open(f, "a") as fh:
    for l in [user("Ritual (automatic timer): hunt", held + 100.01, "z1"), said("NO_REPLY", held + 104, "z2"), summary(held + 104.5, "z3")]:
        fh.write(json.dumps(l) + "\n")
(am.STATUS / "fire-fire").write_text("working")
live["turn"]["since"] = held + 100
am.write_file(am.agent_live_file("fire-fire"), json.dumps(live))
check(conv.poll()[0] == [], "the next one at work: held")
am.quiet_note("fire-fire", {"since": held + 100, "what": "Ritual (automatic timer): hunt"}, "")
spans = am.quiet_turns("fire-fire")
spans[-1]["until"] = held + 104.2       # (the hook ran a moment after its words)
am.write_file(am.QUIET_TURNS / "fire-fire.jsonl", "".join(json.dumps(e) + "\n" for e in spans))
(am.STATUS / "fire-fire").write_text("idle")
am.write_file(am.agent_live_file("fire-fire"), json.dumps({**live, "state": "idle", "turn": None}))
check(conv.poll()[0] == [], "it ended quiet: nothing, ever")
with open(f, "a") as fh:
    fh.write(json.dumps(user("Hey", held + 200, "y1")) + "\n")
check([i["key"].split(":")[0] for i in conv.poll()[0]] == ["y1"], "what comes after it: shown")
items, start = am.app_earlier(fs, f.stat().st_size)
check("z1" not in [i["key"].split(":")[0] for i in items] and "q1" not in [i["key"].split(":")[0] for i in items], "Show earlier messages: no quiet turn either")

# A quiet turn that left a background job running: not "busy" either.
spans = am.quiet_turns("fire-fire")
spans[-1]["until"] = time.time()
am.write_file(am.QUIET_TURNS / "fire-fire.jsonl", "".join(json.dumps(e) + "\n" for e in spans))
(am.STATUS / "fire-fire").write_text("idle")        # (the hook: written down, then idle)
check(am.quiet_last("fire-fire"), "its last turn ended quiet")
am.write_file(am.agent_live_file("fire-fire"), json.dumps({"state": "idle", "pending": [], "queue": [], "turn": None,
                                                            "tasks": [{"task_id": "b1", "task_type": "local_bash", "description": "Run the hunt"}]}))
row = next(s for s in am.session_view() if s["id"] == "fire-fire")
check(row["status"] == "running" and row["quiet"] and am.app_row(row)["status"] == "idle" and am.app_row(row)["running"] == "",
      f"its job still running: amarchy list says running, the app idle ({row['status']}, {row['quiet']})")
time.sleep(0.05)
(am.STATUS / "fire-fire").write_text("working")
time.sleep(0.05)
(am.STATUS / "fire-fire").write_text("idle")
os.utime(am.STATUS / "fire-fire", (time.time() + 10, time.time() + 10))
check(not am.quiet_last("fire-fire"), "a turn since that wasn't quiet: not")

# ---- woken by a timer: not "typing…", and what you hadn't read stays unread
mk("fire-sleepy", "fire")
am.mark_unseen("fire-sleepy")
am.wake = lambda s: None
am.asleep_since = lambda sid: 1.0 if sid == "fire-sleepy" else None
am.send_started = lambda sid, text, since: None
am.send_start(am.session("fire-sleepy"), "Merged: x", mine=False)
check(am.unseen("fire-sleepy") and am.quiet_waking("fire-sleepy"), "a timer waking it: still unread, waking quietly")
am.send_start(am.session("fire-sleepy"), "Morning!")
check(not am.unseen("fire-sleepy") and not am.quiet_waking("fire-sleepy"), "you waking it: what it said is read, and it's at work for you")

# ---- amarchy quiet: what was hidden
rc, out, _ = run("quiet", "fire-fire")
check(rc == 0 and "Ritual (automatic timer): hunt" in out and "Skip: CSS has widths now" in out, f"amarchy quiet lists them, with their notes")
rc, out, _ = run("quiet", "fire-fire", "--json")
check(rc == 0 and len(json.loads(out)) == 2, "and as JSON")
rc, out, _ = run("quiet", "proj-nope")
check(rc != 0, "a session that isn't there: fails")
rc, out, _ = run("quiet", "--help")
check(rc == 0 and "NO_REPLY" in out, "its usage")

shutil.rmtree(home, ignore_errors=True)
print(f"\n{len(failed)} failed" if failed else "\nAll passed")
sys.exit(1 if failed else 0)
