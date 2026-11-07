# A chat's preview, without a browser: amarchy preview saves an address for its
# Preview button, refuses one the user's browser can't reach, and clears; the
# list says whether it answers, the prompts tell Claude about it. Then a
# registered one (--run), for real, as a systemd user service: it starts and
# answers, outside the chat's sleep, capped; stops, leaving its ports free;
# a server the chat left on its port gives way, anyone else's refuses it;
# one that fails says so, with its log; Complete stops it and won't close
# the chat while something still holds one of its ports; unused, it stops.
#
#   python3 test/preview.py         exits 0 when every check passed

import importlib.machinery, importlib.util, json, os, socket, sys, tempfile, time
from pathlib import Path

home = tempfile.mkdtemp(prefix="preview-")
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config")
os.environ.pop("AMARCHY_SESSION", None)
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(Path(__file__).resolve().parent.parent / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failed.append(what)

am._network = ("box", "127.0.0.1")
am.SESSIONS.mkdir(parents=True, exist_ok=True)
am.save_session({"id": "p-a", "repo": "p", "name": "a", "branch": "a", "base": "main", "path": home})
saved = lambda: am.session("p-a").get("preview")

check(am.cmd_preview(["--id", "p-a", "http://localhost:3000"]) != 0 and not saved(), "localhost refused on a host: it wouldn't reach their browser")
check(am.cmd_preview(["--id", "p-a", "ftp://box/x"]) != 0 and not saved(), "only http and https")
check(am.cmd_preview(["--id", "p-a", "not a url"]) != 0 and not saved(), "not an address: refused")

srv = socket.socket(); srv.bind(("127.0.0.1", 0)); srv.listen(1)
port = srv.getsockname()[1]
url = f"http://box:{port}/app"
check(am.cmd_preview(["--id", "p-a", url]) == 0 and saved() == {"url": url}, "saved on the session")
s = am.session("p-a"); s["title"] = "Named"; am.save_session(s)
check(saved() == {"url": url}, "kept when the session is saved again")

check(am.preview_up(url) is True, "something listens: up")
srv.close()
am._preview_up.clear()
check(am.preview_up(url) is False, "nothing listens: not up")
check(am.preview_up(f"http://box.tail1234.ts.net:{port}/") is False, "the machine's full name is this machine too")
check(am.preview_up("https://example.vercel.app/") is True, "served elsewhere: not tried, taken as up")
check(am.preview_local("https://example.vercel.app/") is None, "nothing elsewhere is ever probed")

check(am.cmd_preview(["--id", "p-a", "--clear"]) == 0 and not saved(), "--clear takes it off")
check(am.cmd_preview(["--id", "p-a", "https://example.com/x"]) == 0 and saved() == {"url": "https://example.com/x"}, "a deploy's address is fine")

check("amarchy preview <url>" in am.REPLY_FORMAT, "the system prompt tells Claude to set it")
check("http://box:<port>" in am.agent_context(am.session("p-a")), "and the session's start says which address")
check("preview" not in am.VIEW_FIELDS and {"preview_up", "preview_state"} <= set(am.VIEW_FIELDS), "the address is saved, whether it answers isn't")
check("amarchy preview --run" in am.REPLY_FORMAT and "amarchy preview --run" in am.agent_context(am.session("p-a")),
      "Claude is told to register a dev server, not keep it in its shell")

# The reminder for a server started in the background.
bash = lambda command, bg=False: {"tool_name": "Bash", "tool_input": {"command": command, "run_in_background": bg}}
check(am.serve_reminder(bash("pnpm dev --port 5180", True)) and "amarchy preview --run" in am.serve_reminder(bash("pnpm dev", True)),
      "a dev server in the background: Claude is reminded to register it")
check(am.serve_reminder(bash("nohup npm run dev > /tmp/x.log 2>&1 &")), "one let go of with & too")
check(not am.serve_reminder(bash("pnpm test", True)) and not am.serve_reminder(bash("pnpm dev --help")),
      "a test run, or a server in the foreground: nothing said")
check(not am.serve_reminder(bash("amarchy preview --run 'pnpm dev' http://box:5180")), "registering it: nothing said")

# ---- a registered one, for real
import subprocess, shutil
def free_port():
    x = socket.socket(); x.bind(("127.0.0.1", 0)); p = x.getsockname()[1]; x.close(); return p
def answers(p):
    try:
        socket.create_connection(("127.0.0.1", p), timeout=0.3).close(); return True
    except OSError:
        return False
def gone(p, wait=6):
    end = time.time() + wait
    while time.time() < end and answers(p):
        time.sleep(0.1)
    return not answers(p)

if not shutil.which("systemd-run") or subprocess.run(["systemctl", "--user", "is-system-running"], capture_output=True).returncode not in (0, 1):
    print("  (no systemd user manager here: the service checks are skipped)")
else:
    sid = f"t{os.getpid()}-prev"
    work = tempfile.mkdtemp(prefix="preview-work-")
    am.save_session({"id": sid, "repo": "p", "name": "prev", "branch": "prev", "base": "main", "path": work})
    port, hmr = free_port(), free_port()
    url = f"http://box:{port}/"
    serve = f"python3 -m http.server {port} --bind 127.0.0.1"
    try:
        r = am.cmd_preview(["--id", sid, "--run", serve, url, "--port", str(hmr), "--stop", "echo torn-down", "--idle", "2h"])
        p = am.session(sid)["preview"]
        check(r == 0 and answers(port), "registered with --run: started, and it answers before it returns")
        check(p == {"url": url, "run": serve, "stop": "echo torn-down", "ports": [hmr], "idle": 7200}, "the command is saved with the chat")
        pids = am.preview_pids(sid)
        check(bool(pids) and am.preview_state(am.session(sid)) == "up", "its service runs: up")
        unit = am.preview_unit(sid)
        shown = subprocess.run(["systemctl", "--user", "show", unit, "-p", "MemoryMax,OOMScoreAdjust"], capture_output=True, text=True).stdout
        check(f"MemoryMax={2 * 1024 ** 3}" in shown and "OOMScoreAdjust=500" in shown, "capped at 2 GB, and killed before a chat when memory runs out")
        check(not (pids & am.left_running(am.session(sid), am.processes())), "not among what a sleeping chat leaves running")
        info = am.preview_info(am.session(sid))
        check(info["ports"] == sorted([port, hmr]) and info.get("memory", 0) > 0 and info["memory_max"] == "2G", "its sheet: ports, memory")
        check(am.cmd_preview(["--id", sid, "start"]) == 0 and am.preview_pids(sid) == pids, "start while it runs: the same one")

        check(am.preview_stop(am.session(sid)) == [] and gone(port) and not am.preview_pids(sid), "stopped: its service gone, its port free")
        check("torn-down" in am.preview_log(sid), "its stop command ran")
        check(am.preview_state(am.session(sid)) == "stopped", "and it says stopped (not failed)")

        # A server the chat left on its port (the old way): it gives way.
        stray = subprocess.Popen(["python3", "-m", "http.server", str(port), "--bind", "127.0.0.1"], cwd=work,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        end = time.time() + 5
        while time.time() < end and not answers(port):
            time.sleep(0.1)
        check(am.preview_start(am.session(sid), wait=20) is None and stray.wait(timeout=6) is not None and am.preview_pids(sid),
              "the chat's own old server on its port is stopped, and the preview starts")

        # Complete: stopped and checked; something else on one of its ports keeps the chat open.
        held = socket.socket(); held.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); held.bind(("127.0.0.1", hmr)); held.listen(1)
        err = am.close(sid)
        check(err and err.startswith(am.PREVIEW_LEFT) and f"port {hmr}" in err and am.session(sid), "Complete: a port still held keeps the chat open, saying what holds it")
        check(not am.preview_pids(sid) and gone(port), "its service is stopped all the same")
        refused = am.preview_start(am.session(sid))
        check(refused and "taken" in refused and f"port {hmr}" in refused and not am.preview_pids(sid), "someone else's process on its port: it doesn't start, and says whose")
        held.close()
        check(am.preview_close(am.session(sid)) == [], "nothing left: Complete can go on")

        # One that fails says so, with what it wrote.
        am.cmd_preview(["--id", sid, "--run", "echo boom-here; exit 3", url, "--no-start"])
        check(am.cmd_preview(["--id", sid, "start"]) != 0, "a command that fails: start says so")
        check(am.preview_state(am.session(sid)) == "failed" and "boom-here" in am.preview_log(sid), "failed, and its log says why")
        check(am.preview_info(am.session(sid))["state"] == "failed", "its sheet too")

        # Unused for its idle time: stopped.
        am.cmd_preview(["--id", sid, "--run", serve, url])
        check(answers(port), "registered again: running")
        am.preview_note(sid, used=time.time() - 7300)
        am.preview_tend()
        check(not am.preview_pids(sid) and gone(port) and am.preview_record(sid).get("why") == "idle", "unused for its idle time: stopped")

        # Its chat gone (closed while amarchy wasn't looking): its service goes.
        am.preview_start(am.session(sid), wait=20)
        s = am.session(sid)
        (am.SESSIONS / f"{sid}.json").unlink()
        am.preview_tend()
        check(not am.preview_pids(sid) and gone(port), "a preview whose chat is gone stops")
        am.save_session(s)

        # An address alone: the command goes, and so does its service.
        am.preview_start(am.session(sid), wait=20)
        check(am.cmd_preview(["--id", sid, "https://example.com/"]) == 0 and am.session(sid)["preview"] == {"url": "https://example.com/"}
              and not am.preview_pids(sid), "an address alone: an address only, its service stopped")
        check(am.cmd_preview(["--id", sid, "--run", "x", "https://example.com/"]) != 0, "a command for an address elsewhere: refused")
        check(am.cmd_preview(["--id", sid, "--stop", "x"]) != 0, "--stop without a command: refused")
    finally:
        subprocess.run(["systemctl", "--user", "stop", am.preview_unit(sid)], capture_output=True)
        subprocess.run(["systemctl", "--user", "reset-failed", am.preview_unit(sid)], capture_output=True)

print(f"\n{len(failed)} failed" if failed else "\nAll passed.")
sys.exit(1 if failed else 0)
