# Memory safety: a chat that sleeps leaves nothing running behind it (a dev
# server it let go of, a headless browser), unless you have its page open;
# a chat whose turn was cut off (the machine ran out of memory, Claude
# crashed) says "interrupted", not idle. Real processes in a real systemd
# scope, as each tmux pane has on a host; no browser.
#
#   python3 test/oom-safety.py       exits 0 when every check passed

import importlib.machinery, importlib.util, json, os, shutil, signal, socket, subprocess, sys, tempfile, time
from pathlib import Path

home = tempfile.mkdtemp(prefix="oom-safety-")
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config")
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(Path(__file__).resolve().parent.parent / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failed.append(what)

def alive(pid):
    try:
        stat = Path(f"/proc/{pid}/stat").read_text()
    except OSError:
        return False
    return stat[stat.rfind(")") + 2] != "Z"

def wait_for(test, secs=5):
    end = time.time() + secs
    while time.time() < end and not test():
        time.sleep(0.05)
    return test()

# ---- a turn cut off

sid = "proj-cut"
am.SESSIONS.mkdir(parents=True, exist_ok=True)
am.STATUS.mkdir(parents=True, exist_ok=True)
wt = Path(home) / "wt"
wt.mkdir()
(am.SESSIONS / f"{sid}.json").write_text(json.dumps({"id": sid, "repo": "proj", "name": "cut", "branch": "cut", "path": str(wt), "engine": "chat"}))
(am.STATUS / sid).write_text("idle")
d = am.claude_dir(sid)
d.mkdir(parents=True, exist_ok=True)
stream = d / "stream.jsonl"

def write(records, age=120):
    stream.write_text("".join(json.dumps(r) + "\n" for r in records))
    t = time.time() - age
    os.utime(stream, (t, t))

turn = [{"_sent": {"type": "user", "message": {"role": "user", "content": "fix it"}}},
        {"type": "command_lifecycle", "state": "started"},
        {"type": "system", "subtype": "init"},
        {"type": "stream_event", "event": {"type": "content_block_delta"}},
        {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Bash", "input": {}}]}},
        {"type": "user", "message": {"content": [{"type": "tool_result"}]}}]
done = turn + [{"type": "result", "subtype": "success"}, {"type": "command_lifecycle", "state": "completed"}]
woke = [{"_sent": {"type": "control_request", "request": {"subtype": "initialize"}}},
        {"type": "control_response", "response": {"subtype": "success"}},
        {"type": "system", "subtype": "hook_started"}, {"type": "system", "subtype": "hook_response"},
        {"type": "system", "subtype": "status", "status": None}, {"type": "rate_limit_event"}]

write(done)
check(not am.turn_cut(sid), "a turn that ended with its result: not cut off")
write(done + woke)
check(not am.turn_cut(sid), "woken after a finished turn (init, hooks, control): not cut off")
write(done + turn)
check(am.turn_cut(sid), "a turn under way with no result after it: cut off")
write(done + turn + woke)
check(am.turn_cut(sid), "cut off, then woken with nothing sent: still cut off")
write(done + turn + [{"type": "result", "subtype": "error_during_execution"}])
check(not am.turn_cut(sid), "a turn you stopped yourself ends with a result: not cut off")
# A long turn: far more than one read of the file after its last word on a turn.
write(done + turn + [{"type": "stream_event", "event": {"pad": "x" * 2000}}] * 1500)
check(am.turn_cut(sid), "a long cut-off turn, read in chunks: cut off")
write(done + [{"type": "rate_limit_event", "pad": "y" * 2000}] * 1500)
check(not am.turn_cut(sid), "a finished turn far behind quiet lines: not cut off")
stream.write_text('{"type": "assistant"}\n{"type": "res')
os.utime(stream, (time.time() - 120,) * 2)
check(am.turn_cut(sid), "a last line cut in half (killed while writing): cut off")

def row():
    return next(s for s in am.session_view() if s["id"] == sid)

write(done + turn)
am.mark_unseen(sid)
r = row()
check(r["status"] == "idle" and r["interrupted"] and not r["unseen"], f"the list: idle, interrupted, not done ({r['status']}, {r['interrupted']}, {r['unseen']})")
check(r["sleeping"], "asleep (its tmux gone, as after the restart) and still interrupted")
(am.STATUS / sid).write_text("working")
r = row()
check(r["status"] == "idle" and r["interrupted"], "a status left at working by a Claude that died: asleep, so idle, interrupted")
write(done + turn + done)
r = row()
check(not r["interrupted"], "the next turn finished: not interrupted any more")
write(done + turn, age=0)
check(row()["interrupted"], "just written, but no Claude carries it on: interrupted at once")
tr = am.projects_dir(str(wt))
tr.mkdir(parents=True, exist_ok=True)
conv = "12345678-1234-1234-1234-123456789abc"
am.set_conversation_id(sid, conv)
write(done + turn)
(tr / f"{conv}.jsonl").write_text("{}\n")
check(not row()["interrupted"], "the conversation went on in Claude's classic terminal since: not interrupted")

# ---- what a sleeping chat leaves running

# Someone has its page open: a connection in from another machine.
srv = socket.socket()
srv.bind(("127.0.0.1", 0))
srv.listen()
port = srv.getsockname()[1]
c = socket.create_connection(("127.0.0.1", port))
check(not am.watched({os.getpid()}), "a connection from this machine (a test, a proxy): no one watching")
real = am.tcp_sockets
inode = next(i for st, l, _, i in real() if st == "0A" and l[1] == port)
am.tcp_sockets = lambda: [("0A", ("00000000", port), ("00000000", 0), inode),
                          ("01", ("045D5964", port), ("0A00A8C0", 50000), "1")]      # 100.89.93.4 <- 192.168.0.10
check(am.watched({os.getpid()}), "a connection in from a browser elsewhere: watched")
check(not am.watched({1 << 22}), "someone else's port: not ours")
am.tcp_sockets = real
c.close()
srv.close()
check(am.loopback("0100007F") and am.loopback("00000000000000000000000001000000")
      and am.loopback("0000000000000000FFFF00000100007F") and not am.loopback("045D5964"), "loopback addresses, v4, v6 and mapped")

# Stopping: SIGTERM, then SIGKILL for what ignores it.
stubborn = subprocess.Popen(["sh", "-c", "trap '' TERM; while :; do sleep 0.1; done"], start_new_session=True)
gentle = subprocess.Popen(["sleep", "300"])
t0 = time.time()
n = am.stop_processes({stubborn.pid, gentle.pid}, wait=1)
check(n == 2 and wait_for(lambda: not alive(stubborn.pid) and not alive(gentle.pid), 2), "SIGTERM, and SIGKILL for one that ignores it")
check(time.time() - t0 < 3, f"no longer than it has to ({time.time() - t0:.1f}s)")
check(am.stop_processes({os.getpid()}) == 0 and alive(os.getpid()), "never itself")

if not shutil.which("systemd-run") or subprocess.run(["systemctl", "--user", "is-system-running"], capture_output=True).returncode not in (0, 1):
    print("  skip the pane's scope: no systemd user manager here")
else:
    # A pane as tmux starts one on a host: a tmux-spawn-*.scope of its own,
    # its loop, and what was let go of in it (a dev server started with
    # `(... &)`, reparented away from Claude).
    unit = f"tmux-spawn-oomtest-{os.getpid()}"
    ready = Path(home) / "ready"
    pane = subprocess.Popen(["systemd-run", "--user", "--scope", "--quiet", f"--unit={unit}", "sh", "-c",
                             f"(python3 -m http.server 0 --bind 127.0.0.1 >/dev/null 2>&1 &); "
                             f"(setsid sh -c 'trap \"\" TERM; exec sleep 300' &); touch {ready}; exec sleep 300"],
                            stdin=subprocess.DEVNULL)
    try:
        wait_for(ready.exists)
        time.sleep(0.5)
        procs = am.processes()
        scope = Path("/sys/fs/cgroup" + next(l[3:] for l in Path(f"/proc/{pane.pid}/cgroup").read_text().splitlines() if l.startswith("0::")))
        check(scope.name == f"{unit}.scope", f"the pane runs in its own scope ({scope.name})")
        check(am.pane_scope(pane.pid) == scope, "pane_scope finds it")
        check(am.pane_scope(os.getpid()) is None or am.pane_scope(os.getpid()).name.startswith("tmux-spawn-"),
              "not a pane's scope: none")
        inside = am.scope_pids(scope)
        server = next((p for p in inside if "http.server" in " ".join(am.cmdline(p))), None)
        deaf = next((p for p in inside if procs.get(p, (0, ""))[1] == "sleep" and p != pane.pid), None)
        check(server and deaf, f"what it let go of is still in its scope ({len(inside)} there)")
        check(procs[server][0] != pane.pid, "let go of: not the pane's child any more")
        am.host_pane = lambda s: {"pid": pane.pid}
        am.term_pane = lambda s: None
        s = am.session(sid)
        left = am.left_running(s, am.processes(), {"pid": pane.pid})
        check(server in left and deaf in left and pane.pid not in left, f"left running: the server and the stubborn one, not the pane ({sorted(left)})")
        am.watched = lambda pids: False
        am.clear_asleep(sid)
        check(am.stop_left_running(s) == 0 and alive(server) and alive(deaf), "awake (no mark that it sleeps): nothing of it is touched")
        am.mark_asleep(sid)
        am.pane_claude = lambda pane, procs: pane["pid"]
        check(am.stop_left_running(s) == 0 and alive(server), "marked asleep but a Claude in its pane: awake, nothing touched")
        am.pane_claude = lambda pane, procs: None
        am.watched = lambda pids: True
        check(am.stop_left_running(s) is None and alive(server), "its page is open: kept")
        am.watched = lambda pids: False
        check(am.stop_left_running(s) == len(left), "nobody looking: stopped")
        check(wait_for(lambda: not alive(server) and not alive(deaf), 8), "the server is gone, the one that ignores SIGTERM too")
        check(alive(pane.pid), "the pane's own process stays")
        # What reap does on close: the panes' scopes, whatever is in them.
        check(am.stop_leftovers(Path(home) / "nowhere", [scope]) >= 1 and wait_for(lambda: not alive(pane.pid)), "close: everything in its scopes")
    finally:
        pane.kill()
        subprocess.run(["systemctl", "--user", "stop", f"{unit}.scope"], capture_output=True)

# After a restart: its tmux gone, no mark that it sleeps. It counts as
# asleep, so waking it or sending it something starts its Claude again.
am.tmux_has = lambda name: False
am.clear_asleep(sid)
(am.claude_dir(sid) / "waking").unlink(missing_ok=True)
check(am.asleep_if_gone(am.session(sid)) and am.asleep_since(sid) is not None, "tmux gone after a restart, no mark: marked asleep")
check(not am.asleep_if_gone(am.session(sid)), "marked already: nothing to do")
am.clear_asleep(sid)
started = []
am.host_start = lambda s, wake=False: started.append(wake)
am.host_pane = lambda s: None       # its tmux gone
am.wake(am.session(sid))
check(started == [True] and am.waking_now(sid), f"wake starts it, though it had no mark ({started})")
am.clear_asleep(sid)
(am.claude_dir(sid) / "waking").unlink(missing_ok=True)
am.tmux_has = lambda name: True
check(not am.asleep_if_gone(am.session(sid)) and am.asleep_since(sid) is None, "its tmux there: awake, left alone")

# Claude's background commands: serving ones don't keep it awake.
tasks = Path(home) / "tasks"
tasks.mkdir()
shells = []
for tid, command in [("srv01", "python3 -m http.server 0 --bind 127.0.0.1"), ("run01", "sleep 30")]:
    out = open(tasks / f"{tid}.output", "w")
    line = f"source /x/shell-snapshots/s.sh 2>/dev/null || true && eval '{command}' < /dev/null && pwd -P >| /tmp/cwd"
    shells.append(subprocess.Popen(["bash", "-c", line], stdout=out, stderr=out, stdin=subprocess.DEVNULL))
time.sleep(0.3)
try:
    bash = lambda tid, what: {"task_id": tid, "task_type": "local_bash", "description": what}
    check(am.shell_serves(shells[0].pid, [bash("srv01", "Start the dev server")]), "a dev server's shell serves (its task says so)")
    check(not am.shell_serves(shells[1].pid, [bash("run01", "Run the tests")]), "a test run's shell doesn't")
    check(am.shell_serves(shells[0].pid), "without its task (the classic terminal): by its command")
    check(not am.shell_serves(shells[1].pid), "a command that ends, by its command: doesn't serve")
finally:
    for p in shells:
        p.kill()

shutil.rmtree(home, ignore_errors=True)
print(f"\n{len(failed)} failed" if failed else "\nall passed")
sys.exit(1 if failed else 0)
