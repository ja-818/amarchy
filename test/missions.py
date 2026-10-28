# Missions, without a browser: a chat closed is written down (your
# assistant's and a worktree being set up aren't), and the app's score read
# from them: today's (with how long each took), the streak (alive up to
# yesterday while today has none), the best day before today, the week, all.
#
#   python3 test/missions.py         exits 0 when every check passed

import datetime, importlib.machinery, importlib.util, json, os, shutil, tempfile, time
from pathlib import Path

home = tempfile.mkdtemp(prefix="missions-")
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config")
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(Path(__file__).resolve().parent.parent / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failed.append(what)

v = am.missions_view()
check(v["today"] == [] and v["streak"] == 0 and v["total"] == 0 and v["week"] == [0] * 7, "nothing completed yet: all zero")

def at(days_ago, hour=12):
    d = datetime.date.today() - datetime.timedelta(days=days_ago)
    return int(datetime.datetime(d.year, d.month, d.day, hour).timestamp())

# Three days in a row up to yesterday (3 the day before it: the best), one a week ago.
rows = [at(7), at(3), at(2), at(2, 13), at(2, 14), at(1)]
am.MISSIONS.parent.mkdir(parents=True, exist_ok=True)
am.MISSIONS.write_text("".join(json.dumps({"at": t, "id": f"x{i}", "repo": "p", "task": "T", "created": t - 600}) + "\n"
                               for i, t in enumerate(rows)) + "not json\n")
v = am.missions_view()
check(v["streak"] == 3 and v["today"] == [], f"none today: the streak up to yesterday stands, at risk ({v['streak']})")
check(v["best"] == 3 and v["total"] == 6, f"the best day, all of them ({v['best']}, {v['total']})")
check(v["week"] == [0, 0, 0, 1, 3, 1, 0] and len(v["week"]) == 7, f"the week, today last ({v['week']})")

# A chat closed: written down, today's, with how long it took.
s = {"id": "amarchy-done", "repo": "amarchy", "title": "Game: missions", "created": int(time.time()) - 3600, "path": home + "/nowhere"}
am.mission_done(s)
am.mission_done({**s, "id": "amarchy-setup", "setup": True})
v = am.missions_view()
check(len(v["today"]) == 1 and v["today"][0]["id"] == "amarchy-done" and v["today"][0]["task"] == "Game: missions",
      f"a chat closed is today's mission ({v['today']})")
check(3590 <= (v["today"][0]["took"] or 0) <= 3700, f"how long it took ({v['today'][0]['took']})")
check(v["streak"] == 4 and v["total"] == 7 and v["week"][-1] == 1, f"the streak goes on with it ({v['streak']})")

# A day missed breaks it.
am.MISSIONS.write_text(json.dumps({"at": at(3), "id": "old"}) + "\n" + json.dumps({"at": at(2), "id": "old2"}) + "\n")
check(am.missions_view()["streak"] == 0, "a day missed: no streak")

# Badges, from the log: a quick chat (speedrun), one at 2am (night owl), five in a combo, ten in a day.
am.MISSIONS.write_text("")
base = at(0, 10)
lines = [{"at": base + i * 60, "id": f"c{i}", "created": base + i * 60 - 300} for i in range(10)]
lines.append({"at": at(0, 2), "id": "late", "created": at(0, 2) - 7200})
am.MISSIONS.write_text("".join(json.dumps(x) + "\n" for x in sorted(lines, key=lambda x: x["at"])))
got = {b["key"]: b["at"] for b in am.missions_view()["badges"]}
check(all(got[k] for k in ("speedrun", "night", "combo5", "ten")) and not got["century"] and not got["clean"],
      f"badges earned from the log ({[k for k, v in got.items() if v]})")

# Replies: fast ones in a row, a slow one breaks the run; today's counted.
am.MISSIONS.write_text("".join(json.dumps({"at": at(0, 9) + i, "kind": "reply", "id": "r", "wait": w}) + "\n"
                               for i, w in enumerate([30] * 10 + [500, 20, 40])))
v = am.missions_view()
check(v["replies"] == {"n": 13, "fast": 12, "streak": 2, "best": 10}, f"replies: today's, fast, in a row, the best run ({v['replies']})")
check(next(b for b in v["badges"] if b["key"] == "quick")["at"], "ten fast in a row: Quick draw")
check(v["today"] == [] and v["total"] == 0, "replies aren't missions")

# Five days all clear in a row: Clean week. A task's Done is a mission.
am.MISSIONS.write_text("".join(json.dumps({"at": at(d), "kind": "clear"}) + "\n" for d in range(4, -1, -1))
                       + json.dumps({"at": at(0, 13), "kind": "task", "id": "task:k", "task": "Fix it"}) + "\n")
v = am.missions_view()
check(next(b for b in v["badges"] if b["key"] == "clean")["at"] and v["clear_streak"] == 5, "five days all clear: Clean week")
check(len(v["today"]) == 1 and v["today"][0]["kind"] == "task" and v["today"][0]["task"] == "Fix it", "a task's Done: today's mission")

# Five at once, kept apart from the log.
am.mission_badge("five")
check(next(b for b in am.missions_view()["badges"] if b["key"] == "five")["at"], "five at once: kept")

# Your goal: 5 until you set one; the app's API keeps it.
check(am.missions_view()["goal"] == 5, "the goal: 5 at first")
am.write_file(am.MISSION_GOAL, "8\n")
check(am.missions_view()["goal"] == 8, "the goal set: 8")

# The reminder: at 8pm, a streak with none today; once a day.
am.MISSIONS.write_text("".join(json.dumps({"at": at(d), "id": f"s{d}"}) + "\n" for d in (3, 2, 1)))
today = datetime.date.today()
eve = datetime.datetime(today.year, today.month, today.day, 20, 30)
n1 = am.missions_nudge(eve)
check(n1 and "3-day streak" in n1["title"], f"8pm, a 3-day streak at risk: reminded ({n1})")
check(am.missions_nudge(eve) is None, "once a day")
check(am.missions_nudge(datetime.datetime(today.year, today.month, today.day, 15)) is None or today.weekday() == 0, "not before 8pm")

# The recap: on a Monday, last week's.
am.MISSION_TOLD.unlink()
monday = today - datetime.timedelta(days=today.weekday()) + datetime.timedelta(days=7)
lastweek = monday - datetime.timedelta(days=7)
am.MISSIONS.write_text("".join(json.dumps({"at": int(datetime.datetime(d.year, d.month, d.day, 12).timestamp()) + i, "id": f"w{i}"}) + "\n"
                               for i, d in enumerate([lastweek + datetime.timedelta(days=1)] * 3 + [lastweek + datetime.timedelta(days=4)])))
w = am.missions_last_week(monday)
check(w["n"] == 4 and w["best"][1] == 3, f"last week: 4, best day 3 ({w})")
r = am.missions_nudge(datetime.datetime(monday.year, monday.month, monday.day, 9, 30))
check(r and "4 missions last week" in r["body"] and "Tuesday, 3" in r["body"], f"Monday 9:30: the recap ({r})")
check(am.missions_nudge(datetime.datetime(monday.year, monday.month, monday.day, 10)) is None, "once")

# Watching the list: one waiting when the server started isn't timed; one that
# starts waiting and is answered is a reply; five at work at once, a badge.
am.MISSIONS.write_text("")
am.MISSION_BADGES.unlink()
am.MISSION_TOLD.write_text(json.dumps({"reminder": today.isoformat(), "recap": today.isoformat()}))
class St:
    waiting_since, nudged_at, missions_seen = {}, 0, False
st = St()
am.app_missions(st, [{"id": "a", "status": "waiting"}])
am.app_missions(st, [{"id": "a", "status": "working"}, {"id": "b", "status": "waiting"}])
am.app_missions(st, [{"id": "a", "status": "idle"}, {"id": "b", "status": "working"}])
am.app_missions(st, [{"id": "c", "status": "waiting"}])
am.app_missions(st, [])     # closed while it waited: not a reply
v = am.missions_view()
check(v["replies"]["n"] == 1 and v["replies"]["fast"] == 1, f"only the one answered while watched is a reply ({v['replies']})")
am.app_missions(st, [{"id": str(i), "status": "working" if i % 2 else "running"} for i in range(5)])
check(next(b for b in am.missions_view()["badges"] if b["key"] == "five")["at"], "five at work at once: the badge")

shutil.rmtree(home, ignore_errors=True)
print(f"\n{len(failed)} failed" if failed else "\nAll passed.")
raise SystemExit(1 if failed else 0)
