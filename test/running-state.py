# A chat whose turn ended while what it started still runs: "running", not
# idle (so not done, not asleep, no chime), with what runs; a dev server it
# left serving doesn't count (it never ends): "serving". Without a browser.
#
#   python3 test/running-state.py       exits 0 when every check passed

import importlib.machinery, importlib.util, json, os, subprocess, sys, tempfile, time
from pathlib import Path

home = tempfile.mkdtemp(prefix="running-state-")
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config")
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(Path(__file__).resolve().parent.parent / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failed.append(what)

bash = lambda tid, what: {"task_id": tid, "task_type": "local_bash", "description": what, "started": time.time()}

# What serves, by what Claude called it.
for what, serves in [("Run the full check, e2e and tour chain", False), ("Run the e2e tests", False),
                     ("Start the dev server", True), ("Serve the app on port 8080", True),
                     ("Restart the API server", True), ("Watch the CI run", False), ("Run server tests", False),
                     ("Run e2e against the dev server", False), ("Run the server's e2e", False), ("Tail the logs", True)]:
    check(am.task_serves(bash("x1", what)) == serves, f"{what!r}: {'serves' if serves else 'runs to an end'}")
check(not am.task_serves({"task_id": "a1", "task_type": "local_agent", "description": "Serve the docs"}), "a helper never serves")

# By its command: the one whose stdout is Claude Code's tasks/<id>.output.
tasks = Path(home) / "tasks"
tasks.mkdir()
procs = []
for tid, command in [("srvtask01", "python3 -m http.server 0 --bind 127.0.0.1"), ("runtask01", "sleep 30")]:
    out = open(tasks / f"{tid}.output", "w")
    line = f"source /x/shell-snapshots/s.sh 2>/dev/null || true && eval '{command}' < /dev/null && pwd -P >| /tmp/cwd"
    procs.append(subprocess.Popen(["bash", "-c", line], stdout=out, stderr=out, stdin=subprocess.DEVNULL))
time.sleep(0.5)
try:
    check(am.task_command("srvtask01") == "python3 -m http.server 0 --bind 127.0.0.1", f"a task's command, from its shell ({am.task_command('srvtask01')!r})")
    check(am.task_serves(bash("srvtask01", "Start it in the background")), "a server by its command, whatever it was called")
    check(not am.task_serves(bash("runtask01", "Wait a bit")), "a command that ends: runs")
    check(am.task_command("nosuchtask") == "", "a task that isn't there: no command")
    runs, serves = am.background_runs([bash("srvtask01", "Start it"), bash("runtask01", "Run the e2e")],
                                      [{"name": "fix-flaky", "status": "busy"}, {"name": "parked", "status": "idle"}])
    check(runs == ["Run the e2e", "fix-flaky"] and serves == ["Start it"], f"split: runs {runs}, serves {serves}")

    # The list: idle with a run going is "running", with what runs.
    sid = "proj-run"
    am.SESSIONS.mkdir(parents=True, exist_ok=True)
    am.STATUS.mkdir(parents=True, exist_ok=True)
    wt = Path(home) / "wt"
    wt.mkdir()
    (am.SESSIONS / f"{sid}.json").write_text(json.dumps({"id": sid, "repo": "proj", "name": "run", "branch": "run", "path": str(wt), "engine": "chat"}))
    (am.STATUS / sid).write_text("idle")
    am.mark_unseen(sid)
    am.claude_dir(sid).mkdir(parents=True, exist_ok=True)
    live = am.agent_live_file(sid)
    am.host_titles = lambda: {sid: "Check: e2e chain"}
    am.engine = lambda s: "chat"
    am.all_background_sessions = lambda: []

    def view(tasks, status="idle"):
        (am.STATUS / sid).write_text(status)
        live.write_text(json.dumps({"state": "idle", "tasks": tasks}))
        return next(s for s in am.session_view() if s["id"] == sid)

    s = view([bash("runtask01", "Run the full check, e2e and tour chain")])
    check(s["status"] == "running" and s["running"] == "Run the full check, e2e and tour chain", f"idle, a run going: running ({s['status']}, {s['running']!r})")
    check(not s["unseen"] and s["background"] == 1, "not done (unseen) while it runs")
    check(am.status_group(s) == "running", "grouped as running")
    check(am.alert_kind(s, "running", "working") is None, "its turn ending with a run going: no chime")
    s = view([bash("srvtask01", "Start the app")])
    check(s["status"] == "idle" and s["serving"] == "Start the app" and s["running"] == "", f"only a server going: idle, serving ({s['status']}, {s['serving']!r})")
    check(s["unseen"], "and done, as any finished turn")
    s = view([bash("runtask01", "Run the e2e")], status="working")
    check(s["status"] == "working", "working stays working, a run going or not")
    s = view([bash("runtask01", "Run the e2e")], status="waiting")
    check(s["status"] == "waiting", "waiting stays waiting")
    s = view([])
    check(s["status"] == "idle" and s["running"] == "", "the run ended: idle again")
    closing = am.app_closing({**json.loads((am.SESSIONS / f"{sid}.json").read_text())})
    check(closing["running"] == [], "nothing running: closing asks nothing of it")
    live.write_text(json.dumps({"state": "idle", "tasks": [bash("runtask01", "Run the e2e")]}))
    closing = am.app_closing({**json.loads((am.SESSIONS / f"{sid}.json").read_text())})
    check(closing["running"] == ["Run the e2e"], f"closing says what would stop ({closing['running']})")
finally:
    for p in procs:
        p.kill()

print(f"\n{len(failed)} failed:\n  " + "\n  ".join(failed) if failed else "\nAll passed.")
sys.exit(1 if failed else 0)
