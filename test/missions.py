# Missions, without a browser: only merges count. A chat's merges found
# (a merge commit into main, a fast-forward, a GitHub pull request), each
# written down once; a chat closed is written down but doesn't count, nor a
# task; the app's score read from the merges: today's (with how long each
# took), the streak (alive up to yesterday while today has none), the best
# day before today, the week, all; the badges; a reset, kept in a backup.
#
#   python3 test/missions.py         exits 0 when every check passed

import datetime, importlib.machinery, importlib.util, json, os, shutil, subprocess, tempfile, time
from pathlib import Path

home = tempfile.mkdtemp(prefix="missions-")
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config", AMARCHY_WORK=home + "/Work")
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
am.MISSIONS.write_text("".join(json.dumps({"kind": "merge", "at": t, "id": f"x{i}", "repo": "p", "task": "T", "created": t - 600}) + "\n"
                               for i, t in enumerate(rows)) + "not json\n"
                       + json.dumps({"at": at(1, 15), "id": "closed", "repo": "p", "task": "T", "merged": 0}) + "\n"
                       + json.dumps({"at": at(1, 16), "kind": "task", "id": "task:k", "task": "Call"}) + "\n")
v = am.missions_view()
check(v["streak"] == 3 and v["today"] == [], f"none today: the streak up to yesterday stands, at risk ({v['streak']})")
check(v["best"] == 3 and v["total"] == 6, f"the best day, all of them; a chat closed unmerged and a task don't count ({v['best']}, {v['total']})")
check(v["week"] == [0, 0, 0, 1, 3, 1, 0] and len(v["week"]) == 7, f"the week, today last ({v['week']})")

# A chat closed: written down, but it doesn't count (nothing merged); a merge does.
s = {"id": "amarchy-done", "repo": "amarchy", "title": "Game: missions", "created": int(time.time()) - 3600, "path": home + "/nowhere"}
am.mission_done(s)
am.mission_done({**s, "id": "amarchy-setup", "setup": True})
closed = [json.loads(l) for l in am.MISSIONS.read_text().splitlines() if l.startswith("{") and '"amarchy-' in l]
check(len(closed) == 1 and closed[0]["merged"] == 0, f"a chat closed is written down, with no merge ({closed})")
v = am.missions_view()
check(v["today"] == [] and v["total"] == 6, f"a chat closed unmerged doesn't count ({v['today']})")
am.mission_log({"kind": "merge", "id": "amarchy-done", "repo": "amarchy", "task": "Game: missions", "created": s["created"]})
v = am.missions_view()
check(len(v["today"]) == 1 and v["today"][0]["id"] == "amarchy-done" and v["today"][0]["task"] == "Game: missions",
      f"a merge is today's mission ({v['today']})")
check(3590 <= (v["today"][0]["took"] or 0) <= 3700, f"how long after the chat opened ({v['today'][0]['took']})")
check(v["streak"] == 4 and v["total"] == 7 and v["week"][-1] == 1, f"the streak goes on with it ({v['streak']})")

# A day missed breaks it.
am.MISSIONS.write_text(json.dumps({"kind": "merge", "at": at(3), "id": "old"}) + "\n" + json.dumps({"kind": "merge", "at": at(2), "id": "old2"}) + "\n")
check(am.missions_view()["streak"] == 0, "a day missed: no streak")

# Badges, from the merges: a quick chat (speedrun, quick fix), one at 2am
# (night owl, early bird), combos, ten in a day, one chat merged 3 times.
am.MISSIONS.write_text("")
base = at(0, 10)
lines = [{"kind": "merge", "at": base + i * 60, "id": f"c{i % 4}", "repo": f"r{i % 3}", "created": base + i * 60 - 300} for i in range(10)]
lines.append({"kind": "merge", "at": at(0, 2), "id": "late", "repo": "r0", "created": at(0, 2) - 7200})
lines.append({"kind": "merge", "at": at(0, 12) + 5, "id": "pr", "repo": "r4", "via": "pr", "url": "u", "created": at(0, 12) - 2 * 86400})
lines.append({"at": at(0, 13), "kind": "task", "id": "task:x", "task": "A task"})
am.write_file(am.MISSION_GOAL, "5\n")
am.MISSIONS.write_text("".join(json.dumps(x) + "\n" for x in sorted(lines, key=lambda x: x["at"])))
v = am.missions_view()
got = {b["key"]: b["at"] for b in v["badges"]}
want = ["first", "merges10", "hat", "high5", "ten", "goal", "goal2", "repos2", "repos3", "night", "early", "lunch",
        "speedrun", "quickfix", "combo3", "combo5", "combo10", "marathon", "iterate", "pr1"]
check(all(got[k] for k in want), f"badges earned from the merges (missing {[k for k in want if not got[k]]})")
nope = ["century", "clean", "twenty", "streak3", "polyglot", "dawn", "lastcall", "comeback", "pr25", "fullweek", "weekend", "goalweek"]
check(not any(got[k] for k in nope), f"and not the others ({[k for k in nope if got[k]]})")
check(len(v["badges"]) >= 40 and len({b["key"] for b in v["badges"]}) == len(v["badges"]), f"40 badges, each its own ({len(v['badges'])})")
check(v["total"] == 12 and len(v["today"]) == 12 and v["today"][-1]["url"] == "u", f"merges today, a PR's link ({v['total']})")

# Streaks over days: 7 in a row (week streak, a full week when Mon to Sun, a
# weekend), the goal 5 days running, a comeback after 3 days with none.
today_d = datetime.date.today()
def day_at(d, hour=12):
    return int(datetime.datetime(d.year, d.month, d.day, hour).timestamp())
monday = today_d - datetime.timedelta(days=today_d.weekday() + 14)
week = [monday + datetime.timedelta(days=i) for i in range(7)]
lines = [{"kind": "merge", "at": day_at(d, 10) + k * 2000, "id": f"w{i}{k}", "repo": "r"} for i, d in enumerate(week) for k in range(5)]
gap = week[-1] + datetime.timedelta(days=4)
lines.append({"kind": "merge", "at": day_at(gap, 23), "id": "back", "repo": "r"})
am.MISSIONS.write_text("".join(json.dumps(x) + "\n" for x in lines))
got = {b["key"]: b["at"] for b in am.missions_view()["badges"]}
want = ["streak3", "streak7", "fullweek", "weekend", "goalweek", "comeback", "lastcall"]
check(all(got[k] for k in want) and not got["streak14"], f"streak badges (missing {[k for k in want if not got[k]]})")

# Replies: fast ones in a row, a slow one breaks the run; today's counted.
am.MISSIONS.write_text("".join(json.dumps({"at": at(0, 9) + i, "kind": "reply", "id": "r", "wait": w}) + "\n"
                               for i, w in enumerate([30] * 10 + [500, 20, 40])))
v = am.missions_view()
check(v["replies"] == {"n": 13, "fast": 12, "streak": 2, "best": 10}, f"replies: today's, fast, in a row, the best run ({v['replies']})")
check(next(b for b in v["badges"] if b["key"] == "quick")["at"], "ten fast in a row: Quick draw")
check(v["today"] == [] and v["total"] == 0, "replies aren't missions")

# Five days all clear in a row: Clean week. A task's Done isn't a mission.
am.MISSIONS.write_text("".join(json.dumps({"at": at(d), "kind": "clear"}) + "\n" for d in range(4, -1, -1))
                       + json.dumps({"at": at(0, 13), "kind": "task", "id": "task:k", "task": "Fix it"}) + "\n")
v = am.missions_view()
check(next(b for b in v["badges"] if b["key"] == "clean")["at"] and v["clear_streak"] == 5, "five days all clear: Clean week")
check(v["today"] == [], "a task's Done doesn't count")

# Five at once, kept apart from the log.
am.mission_badge("five")
check(next(b for b in am.missions_view()["badges"] if b["key"] == "five")["at"], "five at once: kept")

# Your goal: 5 until you set one; the app's API keeps it.
am.MISSION_GOAL.unlink()
check(am.missions_view()["goal"] == 5, "the goal: 5 at first")
am.write_file(am.MISSION_GOAL, "8\n")
check(am.missions_view()["goal"] == 8, "the goal set: 8")

# The reminder: at 8pm, a streak with none today; once a day.
am.MISSIONS.write_text("".join(json.dumps({"kind": "merge", "at": at(d), "id": f"s{d}"}) + "\n" for d in (3, 2, 1)))
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
am.MISSIONS.write_text("".join(json.dumps({"kind": "merge", "at": int(datetime.datetime(d.year, d.month, d.day, 12).timestamp()) + i, "id": f"w{i}"}) + "\n"
                               for i, d in enumerate([lastweek + datetime.timedelta(days=1)] * 3 + [lastweek + datetime.timedelta(days=4)])))
w = am.missions_last_week(monday)
check(w["n"] == 4 and w["best"][1] == 3, f"last week: 4, best day 3 ({w})")
r = am.missions_nudge(datetime.datetime(monday.year, monday.month, monday.day, 9, 30))
check(r and "4 merges last week" in r["body"] and "Tuesday, 3" in r["body"], f"Monday 9:30: the recap ({r})")
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

# Merges found, in real repos: a merge commit into main naming the branch,
# a fast-forward of a commit seen unmerged, a pull request merged on GitHub
# (from a branch the chat moved to); each once; before the score's start,
# kept on the chat but not counted.
os.environ.update(GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
def git(*a, cwd):
    r = subprocess.run(["git", *a], cwd=cwd, capture_output=True, text=True)
    assert r.returncode == 0, (a, r.stderr)
    return r.stdout.strip()
am.MISSIONS.write_text("")
am.write_file(am.MISSIONS_SINCE, f"{int(time.time()) - 5}\n")
repo = Path(home) / "Work" / "proj"
repo.mkdir(parents=True)
git("init", "-q", "-b", "main", cwd=repo)
(repo / "a").write_text("a")
git("add", ".", cwd=repo); git("commit", "-qm", "start", cwd=repo)
wt = Path(home) / "wt" / "feat"
git("worktree", "add", "-q", "-b", "feat", str(wt), "main", cwd=repo)
chat = {"id": "proj-feat", "repo": "proj", "branch": "feat", "base": "main", "path": str(wt), "created": int(time.time()) - 60, "task": "Feat: it"}
check(am.merge_scan([chat]) == [] and am.chat_merged("proj-feat") is None, "nothing done: nothing merged")
(wt / "b").write_text("b"); git("add", ".", cwd=wt); git("commit", "-qm", "b", cwd=wt)
check(am.merge_scan([chat]) == [], "committed, not merged: nothing")
git("merge", "-q", "--no-ff", "feat", "-m", "Merge branch 'feat'", cwd=repo)
new = am.merge_scan([chat])
check(len(new) == 1 and new[0]["via"] == "local" and new[0]["into"] == "main", f"merged into main: a merge ({new})")
check(am.merge_scan([chat]) == [], "seen again: not twice")
m = am.chat_merged("proj-feat")
check(m and m["n"] == 1 and m["since"] == 0, f"the chat's Merged ✓ ({m})")
(wt / "c").write_text("c"); git("add", ".", cwd=wt); git("commit", "-qm", "c", cwd=wt)
am.merge_scan([chat])
check(am.chat_merged("proj-feat")["since"] == 1, "a commit since: said")
git("rebase", "-q", "main", cwd=wt)
am.merge_scan([chat])
git("merge", "-q", "--ff-only", "feat", cwd=repo)
new = am.merge_scan([chat])
check(len(new) == 1 and am.chat_merged("proj-feat")["n"] == 2 and am.chat_merged("proj-feat")["since"] == 0, f"a fast-forward: a merge too ({new})")
v = am.missions_view()
check(v["total"] == 2 and all(x["id"] == "proj-feat" for x in v["today"]), f"both on the score ({v['total']})")

# Shipped twice by fast-forward while nobody looked (the app restarting):
# both found at the first look, each when main took it.
wt5 = Path(home) / "wt" / "unseen"
git("worktree", "add", "-q", "-b", "unseen", str(wt5), "main", cwd=repo)
unseen = {**chat, "id": "proj-unseen", "branch": "unseen", "path": str(wt5)}
for name in ("u1", "u2"):
    (wt5 / name).write_text(name); git("add", ".", cwd=wt5); git("commit", "-qm", name, cwd=wt5)
    git("merge", "-q", "--ff-only", "unseen", cwd=repo)
    time.sleep(1.1)
new = am.merge_scan([unseen])
check(len(new) == 2 and new[0]["at"] < new[1]["at"] and am.chat_merged("proj-unseen")["since"] == 0,
      f"fast-forwards never seen before: found, each its own ({new})")
check(am.merge_scan([unseen]) == [], "and not twice")

# Rebased on a newer main with nothing of its own: not a merge.
wt2 = Path(home) / "wt" / "idle"
git("worktree", "add", "-q", "-b", "idle", str(wt2), "main", cwd=repo)
idle = {**chat, "id": "proj-idle", "branch": "idle", "path": str(wt2)}
am.merge_scan([idle])
(repo / "d").write_text("d"); git("add", ".", cwd=repo); git("commit", "-qm", "d", cwd=repo)
git("rebase", "-q", "main", cwd=wt2)
check(am.merge_scan([idle]) == [] and am.chat_merged("proj-idle") is None, "caught up with main, nothing of its own: not merged")

# A pull request, from a branch the chat moved to; seen once.
git("remote", "add", "origin", "https://github.com/x/proj.git", cwd=repo)
wt3 = Path(home) / "wt" / "pr"
git("worktree", "add", "-q", "-b", "pr", str(wt3), "main", cwd=repo)
prc = {**chat, "id": "proj-pr", "branch": "pr", "path": str(wt3)}
git("checkout", "-q", "-b", "os-1-thing", cwd=wt3)
(wt3 / "e").write_text("e"); git("add", ".", cwd=wt3); git("commit", "-qm", "e", cwd=wt3)
tip = git("rev-parse", "HEAD", cwd=wt3)
merged_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
prs = [{"number": 7, "url": "https://github.com/x/proj/pull/7", "mergedAt": merged_at, "headRefName": "os-1-thing", "headRefOid": tip, "baseRefName": "dev"},
       {"number": 3, "url": "https://github.com/x/proj/pull/3", "mergedAt": "2020-01-01T00:00:00Z", "headRefName": "os-1-thing", "headRefOid": tip, "baseRefName": "dev"}]
am.merge_prs = lambda repo_dir, repo, fresh=False: prs
new = am.merge_scan([prc])
check(len(new) == 1 and new[0]["via"] == "pr" and new[0]["url"].endswith("/7"), f"its pull request merged: a merge, an old one with its name isn't ({new})")
check(am.merge_scan([prc]) == [], "the pull request seen again: not twice")
m = am.chat_merged("proj-pr")
check(m and m["pr"] == 7 and m["into"] == "dev", f"the chat's Merged ✓, its pull request ({m})")
check(next(b for b in am.missions_view()["badges"] if b["key"] == "pr1")["at"], "Pull request badge")

# Merged before the score's start: the chat says so, the score doesn't count it.
am.write_file(am.MISSIONS_SINCE, f"{int(time.time()) + 3600}\n")
wt4 = Path(home) / "wt" / "old"
git("worktree", "add", "-q", "-b", "old", str(wt4), "main", cwd=repo)
old = {**chat, "id": "proj-old", "branch": "old", "path": str(wt4)}
(wt4 / "f").write_text("f"); git("add", ".", cwd=wt4); git("commit", "-qm", "f", cwd=wt4)
git("merge", "-q", "--no-ff", "old", "-m", "Merge branch 'old'", cwd=repo)
check(am.merge_scan([old]) == [] and am.chat_merged("proj-old")["n"] == 1, "merged before the start: on the chat, not counted")

# A merged chat completed: written down with its merges, the score as it was.
before = am.missions_view()["total"]
am.mission_done({**chat, "title": "Feat: it"})
last = json.loads(am.MISSIONS.read_text().splitlines()[-1])
check(last["id"] == "proj-feat" and last["merged"] == 2 and am.missions_view()["total"] == before, f"completed: its merges said, not counted again ({last})")

# The app's loop: a chat whose turn just ended is looked at within seconds,
# GitHub too (fresh), not only at the next minute's look at every chat.
class Stop(Exception):
    pass
calls, ticks = [], []
class St:
    view = {"sessions": [{"id": "a", "status": "working", "repo": "p"}, {"id": "b", "status": "idle", "repo": "p"}]}
    class poke:
        set = staticmethod(lambda: calls.append("poke"))
def fake_sleep(_):
    ticks.append(1)
    if len(ticks) == 2:
        St.view = {"sessions": [{"id": "a", "status": "idle", "repo": "p"}, {"id": "b", "status": "idle", "repo": "p"}]}
    if len(ticks) == 4:
        raise Stop
was_scan, was_sleep = am.merge_scan, am.time.sleep
am.merge_scan = lambda ss, use_gh=True, fresh=False: calls.append(([s["id"] for s in ss], fresh)) or ([1] if fresh else [])
am.time.sleep = fake_sleep
try:
    am.app_merges(St())
except Stop:
    pass
am.merge_scan, am.time.sleep = was_scan, was_sleep
check(calls == [(["a", "b"], False), (["a"], True), "poke"], f"a turn ended: that chat looked at now, GitHub fresh ({calls})")

# A reset: everything kept in a backup first, then from 0; a second one the same day kept apart.
am.write_file(am.MISSION_BADGES, json.dumps({"five": 1}))
to = am.missions_reset(datetime.date(2026, 11, 15))
check(to.name == "missions-backup-2026-11-15" and (to / "missions.jsonl").read_text().count("\n") >= 4
      and json.loads((to / "missions-badges.json").read_text()) == {"five": 1}, f"kept in the backup ({to})")
v = am.missions_view()
check(v["total"] == 0 and v["today"] == [] and not any(b["at"] for b in v["badges"]) and v["goal"], "from 0, the goal kept")
check(am.missions_reset(datetime.date(2026, 11, 15)).name == "missions-backup-2026-11-15-2" and to.exists(), "a second reset: its own backup, the first kept")

shutil.rmtree(home, ignore_errors=True)
print(f"\n{len(failed)} failed" if failed else "\nAll passed.")
raise SystemExit(1 if failed else 0)
