# Your agents' tasks, without a browser (amarchy task add | list | done):
# a task is your assistant's or one of your agents' (its own, from its chat;
# --agent for another), never a plain chat's; its title, note, links ([label=]
# url, the url kept whole) and buttons (label=message; a label alone sends
# "<label>: <title>"; none: Done); --until as a date and time with its zone,
# a time today or how long from now, never past; --key changes the same one
# in place; a cap per agent. The app's view has them (soonest to go first,
# each with its agent's name); one past its time is out of sight, still
# pressable a while, then gone; an agent no longer one keeps its out of sight,
# a closed one's go. A button pressed: its message to the agent (amarchy
# send, waking it) and the task done; refused, nothing sent and the task
# stays. --notify: on the phones, under the agent's name, a tap opening Tasks.
# done takes them down, one by one or all of an agent's. And amarchy today.
#
#   python3 test/agent-tasks.py         exits 0 when every check passed

import datetime, importlib.machinery, importlib.util, io, json, os, re, shutil, sys, tempfile, time
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import homes      # (test/homes.py: its home gone with it, however it ends)
home = homes.home("agent-tasks")
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config", AMARCHY_WORK=home + "/Work")
os.environ.pop("AMARCHY_SESSION", None)
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(Path(__file__).resolve().parent.parent / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failed.append(what)

def run(*args, me=None):
    out, err = io.StringIO(), io.StringIO()
    if me:
        os.environ["AMARCHY_SESSION"] = me
    try:
        with redirect_stdout(out), redirect_stderr(err):
            rc = am.main(list(args))
    finally:
        os.environ.pop("AMARCHY_SESSION", None)
    return rc, out.getvalue(), err.getvalue()

def stored():
    """The tasks open: each agent's own board's cards not done, as a task was
    (its agent, its buttons each with its message)."""
    out = []
    for b in am.boards_all():
        if not b.get("task"):
            continue
        for c in b["cards"]:
            if c.get("column") != am.board_done_column(b):
                out.append({**c, "agent": b["lead"], "buttons": [{"label": x["label"], "send": am.button_words(b, c, x, "")}
                                                                  for x in am.card_buttons(b, c) if x["own"]]})
    return out

def set_until(tid, when):
    def change(boards):
        for b in boards.values():
            for c in b["cards"]:
                if c["id"] == tid:
                    c["until"] = when
    am.boards_change(change)

am.SESSIONS.mkdir(parents=True, exist_ok=True)
def mk(sid, repo):
    am.write_file(am.SESSIONS / f"{sid}.json", json.dumps({"id": sid, "repo": repo, "name": sid.split("-", 1)[1], "branch": "b",
                                                           "path": f"{home}/nowhere/{sid}", "created": int(time.time()) - 3600}))
for sid, repo in [("jaken-jaken", "jaken"), ("fireship-fireship", "fireship"), ("scout-scout", "scout"), ("proj-a", "proj")]:
    mk(sid, repo)
run("assistant", "jaken-jaken")
run("agents", "fireship-fireship")
run("agents", "scout-scout", "--name", "Scout")

# What's sent to an agent: recorded here, not delivered.
sent = []
real_run = am.run_amarchy
def fake_run(*args, **kw):
    if args and args[0] == "send":
        sent.append(args)
        return am.subprocess.CompletedProcess(args, 1 if "refuse" in args[1] else 0, "", "amarchy: it said no" if "refuse" in args[1] else "")
    return real_run(*args, **kw)
am.run_amarchy = fake_run

rc, out, _ = run("task", "list")
check(rc == 0 and out.strip() == "none", f"none at first ({out.strip()!r})")

# Added from the agent's own chat: its id printed.
POST = "https://x.com/levelsio/status/123"
rc, out, err = run("task", "add", "--title", "Reply: @levelsio's AI-reply spam list", "--note", "45 min old, 46 replies; worth it until 10:12",
                   "--link", f"Open post={POST}?s=20", "--button", f"Replied=Replied to {POST}", "--button", f"Skipped=Skipped {POST}",
                   "--until", "45m", me="fireship-fireship")
tid = out.strip()
check(rc == 0 and re.fullmatch(r"[0-9a-f]{6}", tid), f"added from its own chat: its id printed ({out!r} {err!r})")
t = next((x for x in stored() if x["id"] == tid), {})
check(t.get("agent") == "fireship-fireship" and t.get("title") == "Reply: @levelsio's AI-reply spam list"
      and t.get("note") == "45 min old, 46 replies; worth it until 10:12", f"its agent, title and note ({t})")
check(t.get("links") == [{"label": "Open post", "url": f"{POST}?s=20"}], f"a link: its label, its url whole (its = kept) ({t.get('links')})")
check(t.get("buttons") == [{"label": "Replied", "send": f"Replied to {POST}"}, {"label": "Skipped", "send": f"Skipped {POST}"}],
      f"its buttons, each its message ({t.get('buttons')})")
check(abs(t.get("until", 0) - (time.time() + 45 * 60)) < 5, "--until 45m: 45 minutes from now")

# --until: a date and time with its zone, a time today; never past; a month at most.
zone = datetime.datetime.now().astimezone() + datetime.timedelta(hours=3)
iso = zone.astimezone(datetime.timezone(datetime.timedelta(hours=-5))).strftime("%Y-%m-%dT%H:%M-05:00")
when, why = am.task_until(iso)
check(why is None and abs(when - zone.replace(second=0, microsecond=0).timestamp()) < 1, f"--until {iso}: that moment, whatever this machine's zone ({why})")
check(am.task_until("1h30m")[0] and abs(am.task_until("1h30m")[0] - time.time() - 5400) < 2, "1h30m")
check(abs((am.task_until("1d")[0] or 0) - time.time() - 86400) < 2 and am.task_until("2h")[0], "1d, 2h")
soon = datetime.datetime.now() + datetime.timedelta(minutes=5)
if soon.date() == datetime.date.today():
    when, why = am.task_until(soon.strftime("%H:%M"))
    check(why is None and abs(when - soon.replace(second=0, microsecond=0).timestamp()) < 1, "a time today (HH:MM)")
before = datetime.datetime.now() - datetime.timedelta(minutes=5)
if before.date() == datetime.date.today():
    check("past already" in (am.task_until(before.strftime("%H:%M"))[1] or ""), "a time today gone by: refused")
check("past already" in (am.task_until("2020-01-01T10:00-05:00")[1] or ""), "a date gone by: refused")
check("takes a time" in (am.task_until("soonish")[1] or "") and "takes a time" in (am.task_until("30")[1] or ""), "words that aren't a time: refused")
check("a month" in (am.task_until("40d")[1] or ""), "further than a month: refused")
rc, _, err = run("task", "add", "--title", "x", "--until", "yesterday", me="fireship-fireship")
check(rc == 1 and "--until takes a time" in err, "the command says so too")

# Its links and buttons.
rc, out, _ = run("task", "add", "--title", "Read: the thread", "--link", "https://x.com/a/status/9?t=1&s=20", "--button", "Read", "--agent", "scout-scout")
t2 = next(x for x in stored() if x["id"] == out.strip())
check(t2["links"] == [{"label": "Open", "url": "https://x.com/a/status/9?t=1&s=20"}], f"a bare url: Open, the url whole ({t2['links']})")
check(t2["buttons"] == [{"label": "Read", "send": "Read: Read: the thread"}], f"a label alone sends \"<label>: <title>\" ({t2['buttons']})")
check(t2["agent"] == "scout-scout" and t2["until"] == 0, "--agent: another agent's; no --until: none")
rc, out, _ = run("task", "add", "--title", "Look at this", me="jaken-jaken")
t3 = next(x for x in stored() if x["id"] == out.strip())
check(rc == 0 and t3["buttons"] == [{"label": "Done", "send": "Done: Look at this"}] and t3["agent"] == "jaken-jaken",
      "your assistant's too; no button: Done")
for bad, what in [(["--link", "Open=ftp://x"], "a link that isn't http(s)"), (["--link", "Open="], "a link with no url"),
                  (["--button", "=hello"], "a button with no label"), (["--button", "x" * 40 + "=y"], "a label too long"),
                  (["--button", "a", "--button", "b", "--button", "c", "--button", "d", "--button", "e"], "five buttons"),
                  (["--link", "https://a.b", "--link", "https://a.b", "--link", "https://a.b", "--link", "https://a.b"], "four links"),
                  (["--note", "n" * 2100], "a note too long")]:
    rc, _, err = run("task", "add", "--title", "x", *bad, me="fireship-fireship")
    check(rc == 1 and err.startswith("amarchy: "), f"{what}: refused ({err.strip()[:90]})")
rc, _, err = run("task", "add", "--title", "  ", me="fireship-fireship")
check(rc == 1 and "--title" in err, "no title: refused")
rc, _, err = run("task", "add", "--title", "x", "--agent", "proj-a")
check(rc == 1 and "isn't your assistant or one of your agents" in err and "amarchy agents proj-a" in err, f"a plain chat: refused, saying how ({err.strip()})")
rc, _, err = run("task", "add", "--title", "x")
check(rc == 1 and "--agent" in err, "from nowhere, no --agent: asked whose")
rc, _, err = run("task", "add", "--title", "x", "--agent", "nope-nope")
check(rc == 1 and "No session" in err, "a session there isn't: refused")
rc, _, err = run("task", "add", "--title", "x", "--bogus", me="fireship-fireship")
check(rc == 1 and "unknown option" in err, "an option it doesn't know: refused before it acts")
rc, out, _ = run("task", "--help")
check(rc == 0 and "amarchy task add" in out and "amarchy task done" in out, "task --help: its usage")
rc, out, _ = run("help", "task")
check(rc == 0 and "--until" in out, "amarchy help task")

# --key: the same one again is changed in place, its id kept.
rc, out, _ = run("task", "add", "--title", "Reply: v1", "--key", "post-77", me="fireship-fireship")
k1 = out.strip()
rc, out, _ = run("task", "add", "--title", "Reply: v2", "--key", "post-77", "--until", "2h", me="fireship-fireship")
same = [x for x in stored() if x.get("key") == "post-77"]
check(out.strip() == k1 and len(same) == 1 and same[0]["title"] == "Reply: v2" and same[0]["until"], f"--key: changed in place, its id kept ({same})")
rc, out, _ = run("task", "add", "--title", "Other agent, same key", "--key", "post-77", "--agent", "scout-scout")
check(out.strip() != k1, "another agent's same key: a task of its own")

# The list, the app's view.
rc, out, _ = run("task", "list")
lines = out.strip().splitlines()
check(rc == 0 and any(l.startswith(f"{tid}\tfireship-fireship\t") and l.endswith("Reply: @levelsio's AI-reply spam list") for l in lines),
      f"list: id, agent, until, title ({lines[:2]})")
rc, out, _ = run("task", "list", "--agent", "scout-scout", "--json")
rows = json.loads(out)
check(rc == 0 and rows and all(r["agent"] == "scout-scout" and r["agent_name"] == "Scout" for r in rows), "list --agent --json: that agent's, with its name")
rc, out, _ = run("task", "list", "--json")
row = next(r for r in json.loads(out) if r["id"] == tid)
check(row["until_iso"] and datetime.datetime.fromisoformat(row["until_iso"]).timestamp() // 60 == row["until"] // 60, f"--json: until, and as a time ({row['until_iso']})")
view = am.today_view()["tasks"]
check([x["id"] for x in view][0] == tid and view[0]["agent_name"] == "Fireship" and view[0]["buttons"][0]["label"] == "Replied",
      f"the app's view: the one going soonest first, with its agent's name ({[(x['id'], x['until']) for x in view]})")
timed = [x for x in view if x["until"]]
check(timed == sorted(timed, key=lambda x: x["until"]) and view.index(timed[-1]) < min(view.index(x) for x in view if not x["until"]),
      "those with a time first, soonest first; then the rest")
rc, out, _ = run("today")
check(rc == 0 and "On your boards:" in out and "Fireship: 2 for you" in out and "Reply: @levelsio's AI-reply spam list (until" in out, f"amarchy today says them ({out})")

# Past its time: out of sight, still pressable a while, then gone.
set_until(tid, time.time() - 60)
check(tid not in [x["id"] for x in am.today_view()["tasks"]], "past its time: off the app's view")
rc, out, _ = run("task", "list")
check(tid not in out, "and off the list")
sent.clear()
check(am.task_press(tid, 0) is None and sent == [("send", "fireship-fireship", f"Replied to {POST}", "--no-wait")],
      f"pressed a moment after: its message still goes ({sent})")
check(tid not in [x["id"] for x in stored()], "and it's done")
rc, out, _ = run("task", "add", "--title", "Old one", "--until", "1m", me="fireship-fireship")
old = out.strip()
set_until(old, time.time() - am.TASK_GRACE - 5)
run("task", "add", "--title", "Something new", me="fireship-fireship")
check(old not in [x["id"] for x in stored()], "long past its time: gone at the next change")

# A button pressed: its message to its agent, the task done; refused, nothing sent, it stays.
rc, out, _ = run("task", "add", "--title", "Reply: two", "--button", "Replied=Replied to two", "--button", "Skipped=Skipped two", me="fireship-fireship")
two = out.strip()
sent.clear()
check(am.task_press(two, 5) == "That task has no such button" and not sent, "a button it hasn't: refused, nothing sent")
check(am.task_press(two, True) and am.task_press("zzz", 0) and am.task_press(two, "1") and not sent, "not a task's id or a button's place: refused")
check(am.task_press(two, 1) is None and sent == [("send", "fireship-fireship", "Skipped two", "--no-wait")], "Skipped: its message to Fireship")
check("gone" in (am.task_press(two, 1) or "") and len(sent) == 1, "pressed again: it's gone, nothing sent twice")
mk("refuse-refuse", "refuse")
run("agents", "refuse-refuse")
rc, out, _ = run("task", "add", "--title", "Can't send", "--agent", "refuse-refuse")
nope = out.strip()
check(am.task_press(nope, 0) == "amarchy: it said no" and nope in [x["id"] for x in stored()], "its agent didn't take it: said why, the task stays")

# done: one by one, or all of an agent's; nothing sent.
sent.clear()
rc, out, err = run("task", "done", t3["id"], "abcdef")
check(rc == 1 and f"done\t{t3['id']}" in out and "no task abcdef" in err and t3["id"] not in [x["id"] for x in stored()],
      f"done: that one down, one there isn't said (exit 1) ({out!r} {err!r})")
rc, out, _ = run("task", "done", "--agent", "scout-scout")
check(rc == 0 and not [x for x in stored() if x["agent"] == "scout-scout"] and out.count("done\t") == 2, f"done --agent: all of Scout's ({out!r})")
rc, out, _ = run("task", "done", "--agent", "scout-scout")
check(rc == 0 and "no task open" in out, "again: it has none")
rc, _, _ = run("task", "done")
check(rc == 1, "done with nothing to take down: its usage")
check(not sent, "done sends nothing")

# Agents no longer: out of sight; closed: gone.
rc, out, _ = run("task", "add", "--title", "Scout's", "--agent", "scout-scout")
sc = out.strip()
run("agents", "scout-scout", "off")
check(sc not in [x["id"] for x in am.today_view()["tasks"]] and sc in [x["id"] for x in stored()], "not an agent any more: out of sight, kept")
run("agents", "scout-scout", "--name", "Scout")
check(sc in [x["id"] for x in am.today_view()["tasks"]], "an agent again: back")
(am.SESSIONS / "scout-scout.json").unlink()
run("task", "add", "--title", "a change", me="fireship-fireship")
check(sc not in [x["id"] for x in stored()], "closed: its tasks gone")

# A cap per agent.
run("task", "done", "--agent", "fireship-fireship")
for i in range(am.TASK_MAX):
    run("task", "add", "--title", f"n{i}", me="fireship-fireship")
rc, _, err = run("task", "add", "--title", "one too many", me="fireship-fireship")
check(rc == 1 and f"{am.TASK_MAX} tasks open already" in err, f"more than {am.TASK_MAX} open: refused")
rc, out, _ = run("task", "add", "--title", "n3", "--key", "k", "--agent", "jaken-jaken")
check(rc == 0, "another agent's: still fine")
run("task", "done", "--agent", "fireship-fireship")

# --notify: on your phones, under its name and picture; a tap opens Tasks.
pushed = []
am.app_subscriptions = lambda: []
rc, out, err = run("task", "add", "--title", "Reply: quiet", "--notify", me="fireship-fireship")
check(rc == 0 and re.fullmatch(r"[0-9a-f]{6}", out.strip()) and "not on your phones" in err, f"no phone to tell: up all the same, said so ({err.strip()})")
am.app_subscriptions = lambda: [{"endpoint": "x"}]
am.push_all = lambda p: pushed.append(p) or 1
rc, out, err = run("task", "add", "--title", "Reply: loud", "--note", "worth it", "--notify", me="fireship-fireship")
p = pushed[0] if pushed else {}
check(rc == 0 and not err and p.get("title") == "Fireship: Reply: loud" and p.get("body") == "worth it" and p.get("url") == "/#/b/fireship-fireship"
      and p.get("tag") == f"amarchy-card-{out.strip()}" and p.get("icon"), f"--notify: under its name, a tap opens its board ({p})")
run("task", "add", "--title", "Reply: no", me="fireship-fireship")
check(len(pushed) == 1, "without --notify: no notification")

# Written in one go: the file is always whole JSON.
check(all(isinstance(json.loads(f.read_text()), dict) for f in am.BOARDS.glob("*.json")), "the files: whole")

print(f"\n{len(failed)} failed" if failed else "\nAll passed")
sys.exit(1 if failed else 0)
