# A chat whose turn ended while what it started still runs: "running", not
# idle (so not done, not asleep, no chime), with what runs; a dev server it
# left serving doesn't count (it never ends): "serving". Without a browser.
#
#   python3 test/running-state.py       exits 0 when every check passed

import importlib.machinery, importlib.util, io, json, os, subprocess, sys, tempfile, time
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

# What waits for an end runs, --watch or not (a CI watch killed by sleep as a
# "server" left its chat waiting forever, 2026-11-22).
ci = {**bash("brg50f8j2", "Watch the PR's CI checks until they finish"), "command": "sleep 20; gh pr checks 310 --watch --interval 30 2>&1 | tail -15"}
check(not am.task_serves(ci), "gh pr checks --watch, until they finish: runs to an end")
check(not am.task_serves({**ci, "description": "Check CI"}), "gh pr checks --watch, whatever it was called: runs")
check(not am.task_serves({**ci, "command": "", "description": "Watch the PR's CI checks until they finish"}), "until they finish, whatever its command: runs")
check(not am.task_serves({**ci, "command": "gh run watch 123 --exit-status"}), "gh run watch: runs")
check(not am.task_serves(bash("w1", "Wait for the deploy to go live")), "waiting for something: runs")
check(am.task_serves({**bash("w2", "Rebuild on change"), "command": "tsc --watch"}), "tsc --watch: serves (it never ends)")
check(am.task_serves({**bash("w3", "Start it"), "command": "npm run dev"}), "a server by the command the chat engine kept")
check(am.task_serves({**bash("w4", "Start the dev server"), "command": ""}), "a server by its words, no command")

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

    def view(tasks, status="idle", **more):
        (am.STATUS / sid).write_text(status)
        live.write_text(json.dumps({"state": "idle", "pid": os.getpid(), "tasks": tasks, **more}))
        return next(s for s in am.session_view() if s["id"] == sid)

    s = view([bash("runtask01", "Run the full check, e2e and tour chain")])
    check(s["status"] == "running" and s["running"] == "Run the full check, e2e and tour chain", f"idle, a run going: running ({s['status']}, {s['running']!r})")
    check(not s["unseen"] and s["background"] == 1, "not done (unseen) while it runs")
    check(am.alert_kind(s, "running", "working") is None, "its turn ending with a run going: no chime")
    s = view([bash("srvtask01", "Start the app")])
    check(s["status"] == "idle" and s["serving"] == "Start the app" and s["running"] == "", f"only a server going: idle, serving ({s['status']}, {s['serving']!r})")
    check(s["unseen"], "and done, as any finished turn")
    s = view([bash("runtask01", "Run the e2e")], status="working")
    check(s["status"] == "working", "working stays working, a run going or not")
    # What you sent a sleeping chat is on its way (its Claude wakes with it):
    # at work from then on, waking rather than asleep, not once Claude is up.
    am.mark_asleep(sid)
    s = view([])
    check(s["status"] == "idle" and s["sleeping"] and not s["waking"], "asleep: idle")
    am.write_file(am.claude_dir(sid) / "send", "carry on")
    s = view([])
    check(s["status"] == "working" and not s["sleeping"] and s["waking"] and not s["unseen"],
          f"sent to, asleep: working, waking with it ({s['status']}, sleeping {s['sleeping']}, waking {s['waking']})")
    am.clear_asleep(sid)
    s = view([])
    check(s["status"] == "working", "its Claude starting, the message not taken yet: working still")
    os.utime(am.claude_dir(sid) / "send", (time.time() - am.SEND_START - 5,) * 2)
    s = view([])
    check(s["status"] == "idle", "never taken: idle again")
    (am.claude_dir(sid) / "send").unlink()
    am.mark_unseen(sid)
    s = view([bash("runtask01", "Run the e2e")], status="waiting")
    check(s["status"] == "waiting", "waiting stays waiting")
    s = view([])
    check(s["status"] == "idle" and s["running"] == "", "the run ended: idle again")
    closing = am.app_closing({**json.loads((am.SESSIONS / f"{sid}.json").read_text())})
    check(closing["running"] == [], "nothing running: closing asks nothing of it")
    live.write_text(json.dumps({"state": "idle", "pid": os.getpid(), "tasks": [bash("runtask01", "Run the e2e")]}))
    closing = am.app_closing({**json.loads((am.SESSIONS / f"{sid}.json").read_text())})
    check(closing["running"] == ["Run the e2e"], f"closing says what would stop ({closing['running']})")

    # A CI watch: running, the chat at work (never Now with nothing to do).
    s = view([ci])
    check(s["status"] == "running" and s["running"] == ci["description"] and not s["interrupted"],
          f"a CI watch going: running ({s['status']}, {s['running']!r})")

    # Its Claude stopped (asleep, a crash) while the CI watch ran: that
    # stopped too, before it ended. Not running any more, not "1 command in
    # the background": interrupted, what was cut said, the chat's to resume.
    dead = subprocess.Popen(["true"]); dead.wait()
    for how, more in [("its broker said it exited", {"state": "exited"}), ("its broker gone without a word (a reboot)", {"pid": dead.pid})]:
        s = view([ci], **more)
        check(s["status"] == "idle" and s["running"] == "" and s["background"] == 0, f"{how}: nothing runs ({s['status']}, {s['running']!r}, {s['background']})")
        check(s["interrupted"] and s["cut"] == ci["description"] and not s["unseen"], f"{how}: interrupted, cut: {s['cut']!r}")
        l = am.chat_live(json.loads(live.read_text()), s)
        check(l["tasks"] == [] and [t["task_id"] for t in l["cut"]] == ["brg50f8j2"], "the chat: nothing in the background, the run cut")
        check(am.app_closing({**json.loads((am.SESSIONS / f"{sid}.json").read_text())})["running"] == [], f"{how}: closing stops nothing")
    s = view([bash("srvtask02", "Start the dev server")], state="exited")
    check(not s["interrupted"] and s["cut"] == "", "only a server stopped with it (as sleep means it to): not interrupted")
    s = view([], cut=[ci])
    check(s["interrupted"] and s["cut"] == ci["description"], "cut kept for the next Claude (live.json's cut): interrupted still")
    s = view([], status="working", cut=[ci])
    check(not s["interrupted"], "at work again: not interrupted")
    s = view([])
    check(not s["interrupted"] and s["cut"] == "", "told, nothing cut: not interrupted")

    # ---- the broker: a background command's command kept; cut when its Claude
    # stops; the next Claude told with its first message, unseen in the chat.
    agent = am.Agent({"id": sid, "path": str(wt), "repo": "proj"})
    agent.titled = True                     # (no title to give it: chat-title.py)
    fed = io.StringIO()
    agent.claude = type("C", (), {"stdin": fed})()
    agent.live["state"] = "idle"
    call = lambda uid, command, what: {"type": "assistant", "message": {"content": [{"type": "tool_use", "id": uid, "name": "Bash",
        "input": {"command": command, "description": what, "run_in_background": True}}]}}
    agent.handle(call("toolu_ci", ci["command"], ci["description"]))
    agent.handle({"type": "system", "subtype": "background_tasks_changed", "tasks": [{"task_id": "brg50f8j2", "task_type": "local_bash", "description": ci["description"]}]})
    agent.handle({"type": "system", "subtype": "task_started", "task_id": "brg50f8j2", "tool_use_id": "toolu_ci", "task_type": "local_bash"})
    check(agent.live["tasks"][0].get("command") == ci["command"], "the task's command, from its Bash call (task_started after the list)")
    agent.handle(call("toolu_dev", "npm run dev", "Start it"))
    agent.handle({"type": "system", "subtype": "task_started", "task_id": "bdev", "tool_use_id": "toolu_dev", "task_type": "local_bash"})
    agent.handle({"type": "system", "subtype": "background_tasks_changed", "tasks": [{"task_id": "brg50f8j2", "task_type": "local_bash", "description": ci["description"]},
                                                                                       {"task_id": "bdev", "task_type": "local_bash", "description": "Start it"}]})
    check([t.get("command") for t in agent.live["tasks"]] == [ci["command"], "npm run dev"], "and the list after task_started: each with its command")
    agent.live["pid"] = os.getpid()
    agent.claude_ended(-9)
    agent.flush_live()      # (run: once what was queued is put aside too)
    got = json.loads(live.read_text())
    check(got["state"] == "exited" and got["tasks"] == [] and [t["task_id"] for t in got["cut"]] == ["brg50f8j2"],
          f"its Claude killed: nothing runs, the CI watch cut, not the server ({[t['task_id'] for t in got['cut']]})")
    check([t["task_id"] for t in am.live_cut(am.agent_live(sid))] == ["brg50f8j2"], "what the next Claude starts with (Agent.run: live_cut)")
    nxt = am.Agent({"id": sid, "path": str(wt), "repo": "proj"})
    nxt.titled = True
    nxt.live["cut"] = am.live_cut(am.agent_live(sid))
    fed = io.StringIO()
    nxt.claude = type("C", (), {"stdin": fed})()
    nxt.live["state"] = "idle"
    nxt.send("Carry on where you were cut off")      # (Resume's words: app.js RESUME_TEXT)
    sent = json.loads(fed.getvalue().splitlines()[-1])["message"]["content"]
    check(isinstance(sent, list) and sent[0]["text"].startswith("Carry on") and sent[-1]["text"].startswith("<system-reminder>")
          and "gh pr checks 310 --watch" in sent[-1]["text"] and ci["description"] in sent[-1]["text"],
          "its first message: your words, then what stopped before it ended, its command (for Claude)")
    check(nxt.live["cut"] == [] and json.loads(live.read_text())["cut"] == [], "told once: nothing cut any more")
    item = am.user_item(am.message_text(sent))
    check(item == {"kind": "user", "text": "Carry on where you were cut off"} and am.human_message(am.message_text(sent)),
          f"the chat shows your words only, yours ({item})")
    nxt.handle({"type": "result", "subtype": "success", "session_id": "c1"})
    nxt.send("And then?")
    check(not any("system-reminder" in json.dumps(json.loads(x)) for x in fed.getvalue().splitlines()[-1:]), "the next message: as you wrote it")
finally:
    for p in procs:
        p.kill()

print(f"\n{len(failed)} failed:\n  " + "\n  ".join(failed) if failed else "\nAll passed.")
sys.exit(1 if failed else 0)
