# A chat's preview, without a browser: amarchy preview saves an address for its
# Preview button, refuses one the user's browser can't reach, and clears; the
# list says whether it answers, the prompts tell Claude about it. Then a
# registered one (--run), for real, as a systemd user service: it starts and
# answers, outside the chat's sleep, capped; stops, leaving its ports free;
# a server the chat left on its port gives way, anyone else's refuses it;
# one that fails says so, with its log; Complete stops it and won't close
# the chat while something still holds one of its ports; unused, it stops.
# Several in one chat, each with a name: their own services, ports, logs;
# one starting doesn't take another down; each stops on its own, Complete
# stops them all; a new name restarts nothing. A chat from before (one
# "preview") reads as its first.
#
#   python3 test/preview.py         exits 0 when every check passed

import contextlib, importlib.machinery, importlib.util, io, json, os, socket, sys, tempfile, time
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
saved = lambda: am.session("p-a").get("previews")

check(am.cmd_preview(["--id", "p-a", "http://localhost:3000"]) != 0 and not saved(), "localhost refused on a host: it wouldn't reach their browser")
check(am.cmd_preview(["--id", "p-a", "ftp://box/x"]) != 0 and not saved(), "only http and https")
check(am.cmd_preview(["--id", "p-a", "not a url"]) != 0 and not saved(), "not an address: refused")

srv = socket.socket(); srv.bind(("127.0.0.1", 0)); srv.listen(1)
port = srv.getsockname()[1]
url = f"http://box:{port}/app"
check(am.cmd_preview(["--id", "p-a", url]) == 0 and saved() == [{"url": url}], "saved on the session")
s = am.session("p-a"); s["title"] = "Named"; am.save_session(s)
check(saved() == [{"url": url}], "kept when the session is saved again")

check(am.preview_up(url) is True, "something listens: up")
srv.close()
am._preview_up.clear()
check(am.preview_up(url) is False, "nothing listens: not up")
check(am.preview_up(f"http://box.tail1234.ts.net:{port}/") is False, "the machine's full name is this machine too")
check(am.preview_up("https://example.vercel.app/") is True, "served elsewhere: not tried, taken as up")
check(am.preview_local("https://example.vercel.app/") is None, "nothing elsewhere is ever probed")

check(am.cmd_preview(["--id", "p-a", "--clear"]) == 0 and not saved(), "--clear takes it off")
check(am.cmd_preview(["--id", "p-a", "https://example.com/x"]) == 0 and saved() == [{"url": "https://example.com/x"}], "a deploy's address is fine")

# Several: each with a name, the one without a name the chat's first.
check(am.cmd_preview(["--id", "p-a", "https://example.com/y"]) == 0 and saved() == [{"url": "https://example.com/y"}],
      "with one, an address without a name changes it")
check(am.cmd_preview(["--id", "p-a", "--name", "Admin", "https://example.com/admin"]) == 0
      and saved() == [{"url": "https://example.com/y"}, {"url": "https://example.com/admin", "name": "Admin", "key": "admin"}],
      "--name adds one beside it, with a key of its own")
check(am.cmd_preview(["--id", "p-a", "https://example.com/z"]) != 0 and len(saved()) == 2,
      "with several, an address without a name: refused (which one?)")
check(am.cmd_preview(["--id", "p-a", "https://example.com/admin"]) == 0 and len(saved()) == 2,
      "the address of one of them: that one")
check(am.cmd_preview(["--id", "p-a", "--name", "admin", "https://example.com/admin2"]) == 0
      and saved()[1] == {"url": "https://example.com/admin2", "name": "Admin", "key": "admin"}, "its name, in any case: that one, its address changed")
check(am.cmd_preview(["--id", "p-a", "--rename", "Site"]) == 0 and saved()[0] == {"url": "https://example.com/y", "name": "Site"},
      "--rename names the one without a name (its key stays)")
check(am.cmd_preview(["--id", "p-a", "--rename", "admin"]) != 0, "--rename without --name, all named: which one? refused")
check(am.cmd_preview(["--id", "p-a", "--name", "Site", "--rename", "ADMIN"]) != 0, "a name another has: refused")
check(am.cmd_preview(["--id", "p-a", "--name", "Nope", "stop"]) != 0, "no preview by that name: refused")
check(am.cmd_preview(["--id", "p-a", "--name", "  ", "x"]) != 0, "a name with nothing in it: refused")
check(am.preview_key("Página") == "pagina" and am.preview_key("API docs") == "api-docs" and am.preview_key("ドキュメント").startswith("p")
      and am.preview_key("ドキュメント") != am.preview_key("ストーリー") and am.preview_key("") == "", "a name's key: plain letters, else its hash")
# Two registered at once (Claude's commands side by side): both kept.
import threading
both = [threading.Thread(target=am.cmd_preview, args=(["--id", "p-a", "--name", n, f"https://example.com/{n}"],)) for n in ("One", "Two")]
[x.start() for x in both]; [x.join() for x in both]
check({"One", "Two"} <= {p.get("name") for p in saved()}, "two registered at once: both kept")
am.cmd_preview(["--id", "p-a", "--name", "One", "--clear"]); am.cmd_preview(["--id", "p-a", "--name", "Two", "--clear"])
view = next(x for x in am.session_view() if x["id"] == "p-a")
check([(p["label"], p["key"], p["state"]) for p in view["previews"]] == [("Site", "", "up"), ("Admin", "admin", "up")],
      "the list: each, its name, its key, where it stands")
am.save_session(view)
check(saved() == [{"url": "https://example.com/y", "name": "Site"}, {"url": "https://example.com/admin2", "name": "Admin", "key": "admin"}],
      "saved from the list: what the list adds isn't")
check(am.cmd_preview(["--id", "p-a", "--name", "Admin", "--clear"]) == 0 and saved() == [{"url": "https://example.com/y", "name": "Site"}],
      "--clear with a name takes that one off only")
check(am.cmd_preview(["--id", "p-a", "--name", "Docs", "https://example.com/d"]) == 0 and am.cmd_preview(["--id", "p-a", "--clear"]) == 0 and not saved(),
      "--clear without one takes them all off")
s = am.session("p-a"); s["preview"] = {"url": "https://example.com/old"}; am.save_session(s)
check([(p["key"], p["url"]) for p in am.previews(am.session("p-a"))] == [("", "https://example.com/old")], "a chat from before: its one preview, its first")
check(am.cmd_preview(["--id", "p-a", "--name", "New", "https://example.com/new"]) == 0 and "preview" not in am.session("p-a")
      and [p["url"] for p in am.previews(am.session("p-a"))] == ["https://example.com/old", "https://example.com/new"], "and saved the new way")
am.cmd_preview(["--id", "p-a", "--clear"])

check("amarchy preview <url>" in am.REPLY_FORMAT, "the system prompt tells Claude to set it")
check("http://box:<port>" in am.agent_context(am.session("p-a")), "and the session's start says which address")
check("previews" not in am.VIEW_FIELDS and set(am.PREVIEW_VIEW) == {"label", "state"}, "the address is saved, whether it answers isn't")
check("--name" in am.REPLY_FORMAT and "--name" in am.agent_context(am.session("p-a")), "Claude is told to name each when there are several")
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
    first = lambda: am.previews(am.session(sid))[0]
    port, hmr = free_port(), free_port()
    url = f"http://box:{port}/"
    serve = f"python3 -m http.server {port} --bind 127.0.0.1"
    try:
        r = am.cmd_preview(["--id", sid, "--run", serve, url, "--port", str(hmr), "--stop", "echo torn-down", "--idle", "2h"])
        p = am.session(sid)["previews"][0]
        check(r == 0 and answers(port), "registered with --run: started, and it answers before it returns")
        check(p == {"url": url, "run": serve, "stop": "echo torn-down", "ports": [hmr], "idle": 7200}, "the command is saved with the chat")
        pids = am.preview_pids(sid)
        check(bool(pids) and am.preview_state(am.session(sid), first()) == "up", "its service runs: up")
        unit = am.preview_unit(sid)
        shown = subprocess.run(["systemctl", "--user", "show", unit, "-p", "MemoryMax,OOMScoreAdjust"], capture_output=True, text=True).stdout
        check(f"MemoryMax={2 * 1024 ** 3}" in shown and "OOMScoreAdjust=500" in shown, "capped at 2 GB, and killed before a chat when memory runs out")
        check(not (pids & am.left_running(am.session(sid), am.processes())), "not among what a sleeping chat leaves running")
        info = am.preview_info(am.session(sid), first())
        check(info["ports"] == sorted([port, hmr]) and info.get("memory", 0) > 0 and info["memory_max"] == "2G", "its sheet: ports, memory")
        check(am.cmd_preview(["--id", sid, "start"]) == 0 and am.preview_pids(sid) == pids, "start while it runs: the same one")

        check(am.preview_stop(am.session(sid), first()) == [] and gone(port) and not am.preview_pids(sid), "stopped: its service gone, its port free")
        check("torn-down" in am.preview_log(sid), "its stop command ran")
        check(am.preview_state(am.session(sid), first()) == "stopped", "and it says stopped (not failed)")

        # A server the chat left on its port (the old way): it gives way.
        stray = subprocess.Popen(["python3", "-m", "http.server", str(port), "--bind", "127.0.0.1"], cwd=work,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        end = time.time() + 5
        while time.time() < end and not answers(port):
            time.sleep(0.1)
        check(am.preview_start(am.session(sid), first(), wait=20) is None and stray.wait(timeout=6) is not None and am.preview_pids(sid),
              "the chat's own old server on its port is stopped, and the preview starts")

        # Complete: stopped and checked; something else on one of its ports keeps the chat open.
        held = socket.socket(); held.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); held.bind(("127.0.0.1", hmr)); held.listen(1)
        err = am.close(sid)
        check(err and err.startswith(am.PREVIEW_LEFT) and f"port {hmr}" in err and am.session(sid), "Complete: a port still held keeps the chat open, saying what holds it")
        check(not am.preview_pids(sid) and gone(port), "its service is stopped all the same")
        refused = am.preview_start(am.session(sid), first())
        check(refused and "taken" in refused and f"port {hmr}" in refused and not am.preview_pids(sid), "someone else's process on its port: it doesn't start, and says whose")
        held.close()
        check(am.preview_close(am.session(sid)) == [], "nothing left: Complete can go on")

        # One that fails says so, with what it wrote.
        am.cmd_preview(["--id", sid, "--run", "echo boom-here; exit 3", url, "--no-start"])
        check(am.cmd_preview(["--id", sid, "start"]) != 0, "a command that fails: start says so")
        check(am.preview_state(am.session(sid), first()) == "failed" and "boom-here" in am.preview_log(sid), "failed, and its log says why")
        check(am.preview_info(am.session(sid), first())["state"] == "failed", "its sheet too")

        # Unused for its idle time: stopped.
        am.cmd_preview(["--id", sid, "--run", serve, url])
        check(answers(port), "registered again: running")
        am.preview_note(sid, used=time.time() - 7300)
        am.preview_tend()
        check(not am.preview_pids(sid) and gone(port) and am.preview_record(sid).get("why") == "idle", "unused for its idle time: stopped")

        # Its chat gone (closed while amarchy wasn't looking): its service goes.
        am.preview_start(am.session(sid), first(), wait=20)
        s = am.session(sid)
        (am.SESSIONS / f"{sid}.json").unlink()
        am.preview_tend()
        check(not am.preview_pids(sid) and gone(port), "a preview whose chat is gone stops")
        am.save_session(s)
        # Never one this amarchy didn't start (the real ones, while this test runs).
        other = f"t{os.getpid()}-other"
        subprocess.run(["systemd-run", "--user", "--quiet", f"--unit={am.preview_unit(other)}", "sleep", "60"], check=True)
        am.preview_tend()
        check(bool(am.preview_pids(other)), "another amarchy's preview (no record of it here): left alone")
        subprocess.run(["systemctl", "--user", "stop", am.preview_unit(other)], capture_output=True)

        # Several, for real: each its own service, ports, log.
        am.preview_start(am.session(sid), first(), wait=20)
        api, api_hmr = free_port(), free_port()
        api_url = f"http://box:{api}/"
        api_serve = f"echo api-here; python3 -m http.server {api} --bind 127.0.0.1"
        main = am.preview_pids(sid)
        check(am.cmd_preview(["--id", sid, "--name", "API", "--run", api_serve, api_url, "--port", str(port)]) != 0
              and len(am.previews(am.session(sid))) == 1, "a port another of its previews has: refused")
        r = am.cmd_preview(["--id", sid, "--name", "API docs", "--run", api_serve, api_url, "--port", str(api_hmr), "--stop", "echo api-down"])
        two = am.previews(am.session(sid))
        slot = am.preview_slot(sid, "api-docs")
        check(r == 0 and [x["key"] for x in two] == ["", "api-docs"] and answers(api) and answers(port),
              "a second one, by name: it starts, and the first goes on")
        check(am.preview_pids(slot) and am.preview_pids(sid) == main and not (am.preview_pids(slot) & main),
              "each its own service: the first's untouched")
        check(am.preview_unit(slot) == f"amarchy-preview-{sid}--api-docs.service", "its unit, named by the chat and its key")
        check("api-here" in am.preview_log(slot) and "api-here" not in am.preview_log(sid), "its own log")
        check(am.chat_preview_pids(am.session(sid)) == main | am.preview_pids(slot), "the chat's: both")
        check(not (am.chat_preview_pids(am.session(sid)) & am.preview_strays(am.session(sid), am.listeners([port, api]))),
              "neither is a stray to the other")
        check([x["state"] for x in am.preview_shown(am.session(sid))] == ["up", "up"], "the list: both up")
        # Another of its previews on its port: it says which, and leaves it be.
        am.preview_stop(am.session(sid), first())
        squat = am.session(sid)
        squat["previews"].append({"url": f"http://box:{free_port()}/", "name": "Squat", "key": "squat", "run": f"python3 -m http.server {port} --bind 127.0.0.1"})
        am.save_session(squat)
        sq = am.previews(am.session(sid))[2]
        am.preview_start(am.session(sid), sq)
        end = time.time() + 5
        while time.time() < end and not answers(port):
            time.sleep(0.1)
        clash = am.preview_start(am.session(sid), first())
        check(clash and "its preview Squat" in clash and answers(port) and am.preview_pids(am.preview_slot(sid, "squat")),
              f"a port another of its previews holds: says which, and leaves it running ({clash})")
        am.preview_stop(am.session(sid), sq)
        squat = am.session(sid); squat["previews"].pop(); am.save_session(squat)
        check(gone(port) and am.preview_start(am.session(sid), first(), wait=20) is None, "that one stopped: it starts")
        api_pids = am.preview_pids(slot)
        check(am.cmd_preview(["--id", sid, "--name", "api docs", "--rename", "Docs"]) == 0 and am.preview_pids(slot) == api_pids
              and am.previews(am.session(sid))[1]["name"] == "Docs", "a new name: the same service goes on")
        check(am.cmd_preview(["--id", sid, "--name", "Docs", "stop"]) == 0 and gone(api) and answers(port) and "api-down" in am.preview_log(slot),
              "stop --name: that one only (its stop command ran)")
        check([x["state"] for x in am.preview_shown(am.session(sid))] == ["up", "stopped"], "the list: one up, one stopped")
        check(am.cmd_preview(["--id", sid, "start"]) == 0 and answers(api) and answers(port), "start without a name: all of them")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            am.cmd_preview(["--id", sid, "status"])
        got = json.loads(out.getvalue())
        check(isinstance(got, list) and [x["label"] for x in got] == ["box:%d" % port, "Docs"] and all(x["state"] == "up" for x in got),
              "status without a name: each, by name (its address for the one without)")
        am.cmd_preview(["--id", sid, "--name", "Docs", "--clear"])
        check(gone(api) and answers(port) and len(am.previews(am.session(sid))) == 1, "--clear --name: that one stops and goes")
        am.cmd_preview(["--id", sid, "--name", "Docs", "--run", api_serve, api_url, "--no-start"])
        am.preview_start(am.session(sid), am.previews(am.session(sid))[1], wait=20)
        held = socket.socket(); held.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); held.bind(("127.0.0.1", hmr)); held.listen(1)
        err = am.close(sid)
        check(err and f"port {hmr}" in err and not am.chat_preview_pids(am.session(sid)) and gone(port) and gone(api),
              "Complete stops every one of them")
        held.close()
        am.cmd_preview(["--id", sid, "--name", "Docs", "--clear"])
        am.preview_note(slot, sid=sid, key="docs", started=time.time())
        am.preview_tend()
        check(not (am.PREVIEWS / f"{slot}.json").exists(), "the record of one it no longer has: gone")

        # An address alone: the command goes, and so does its service.
        am.preview_start(am.session(sid), first(), wait=20)
        check(am.cmd_preview(["--id", sid, "https://example.com/"]) == 0 and am.session(sid)["previews"] == [{"url": "https://example.com/"}]
              and not am.preview_pids(sid), "an address alone: an address only, its service stopped")
        check(am.cmd_preview(["--id", sid, "--run", "x", "https://example.com/"]) != 0, "a command for an address elsewhere: refused")
        check(am.cmd_preview(["--id", sid, "--stop", "x"]) != 0, "--stop without a command: refused")
    finally:
        for slot in (sid, am.preview_slot(sid, "api-docs"), am.preview_slot(sid, "docs")):
            subprocess.run(["systemctl", "--user", "stop", am.preview_unit(slot)], capture_output=True)
            subprocess.run(["systemctl", "--user", "reset-failed", am.preview_unit(slot)], capture_output=True)

print(f"\n{len(failed)} failed" if failed else "\nAll passed.")
sys.exit(1 if failed else 0)
