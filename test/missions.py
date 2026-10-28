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

shutil.rmtree(home, ignore_errors=True)
print(f"\n{len(failed)} failed" if failed else "\nAll passed.")
raise SystemExit(1 if failed else 0)
