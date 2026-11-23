# A chat's terminal from the app, on the host's side, with a real tmux (one
# of the test's own, never the host's): Select text gets what it printed and
# shows, each line whole (one tmux wrapped to the width joined again, so a
# long address copies whole), its history too, without the blank lines at its
# end; a terminal that isn't running says so. The message line's "bottom"
# takes it out of tmux's copy mode (where scrolling back leaves it) and leaves
# one that isn't in it alone. And over the app's own route: GET
# /api/session/<id>/tty/term/text, and an upload's whole path.
#
#   python3 test/terminal-text.py      exits 0 when every check passed

import base64, importlib.machinery, importlib.util, json, os, shutil, subprocess, sys, tempfile, threading, time, urllib.request
import http.server
from pathlib import Path

home = tempfile.mkdtemp(prefix="terminal-text-")
# A tmux server of the test's own: its socket under the test's home.
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config", TMUX_TMPDIR=home)
for k in ("AMARCHY_SESSION", "TMUX", "TMUX_PANE"):
    os.environ.pop(k, None)
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(Path(__file__).resolve().parent.parent / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import isolate; isolate.timers(am)      # (test/isolate.py: none of this machine's automations)

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failed.append(what)

if not shutil.which("tmux"):
    print("tmux isn't installed: skipped")
    sys.exit(0)

sid = "p-a"
work = Path(home) / "work"
work.mkdir()
am.SESSIONS.mkdir(parents=True, exist_ok=True)
am.save_session({"id": sid, "repo": "p", "name": "a", "branch": "a", "base": "main", "path": str(work)})
name = am.tmux_name(sid, "term")
conf = am.STATE / "tmux.conf"
am.tmux("list-sessions")      # writes its conf
script = Path(home) / "print.sh"
url = "https://example.com/" + "a" * 70 + "/end?x=1"
script.write_text("for i in $(seq 1 60); do echo \"line $i\"; done\n"
                  f"echo '{url}'\n"
                  "printf '\\n\\n\\n'\n"
                  "exec sleep 600\n")
r = subprocess.run(["tmux", "-u", "-L", "amarchy", "-f", str(conf), "new-session", "-d", "-s", name, "-x", "40", "-y", "10",
                    "sh", str(script)], capture_output=True, text=True, env=am.clean_env())
check(r.returncode == 0, f"a test tmux, on the test's own socket ({r.stderr.strip()})")
try:
    text = None
    for _ in range(50):
        text = am.tty_text(sid, "term")
        if text and url in text:
            break
        time.sleep(0.1)
    lines = (text or "").split("\n")
    check(bool(text) and lines[0] == "line 1", f"from its history: the first line it printed ({lines[:1]})")
    check(url in lines, "a line wider than the terminal (40 columns) whole again: the address copies whole")
    check(lines[-1] == url, f"no blank lines at its end ({lines[-2:]})")
    check(len(lines) == 61, f"every line, once ({len(lines)})")
    check(am.tty_text(sid, "claude") is None, "a terminal that isn't running: None")

    # Scrolled back: tmux's copy mode, as the wheel leaves it.
    target = f"={name}:"
    in_mode = lambda: am.tmux("display-message", "-p", "-t", target, "#{pane_in_mode}").stdout.strip()
    am.tmux("copy-mode", "-t", target)
    am.tmux("send-keys", "-t", target, "-X", "-N", "5", "scroll-up")
    check(in_mode() == "1", "scrolled back: in copy mode")
    am.tty_bottom(sid, "term")
    check(in_mode() == "0", "bottom: out of copy mode, back at the prompt")
    am.tty_bottom(sid, "term")
    check(in_mode() == "0", "bottom again, not in copy mode: nothing happens")
    am.tty_bottom(sid, "claude")
    check(True, "bottom on a terminal that isn't running: no error")

    # Over the app's own routes.
    am.app_key()
    am.migrate()
    st = am.AppState()
    st.transcriber = None
    Handler = am.app_handler(st, ["tester@test"], "127.0.0.1")

    class Local(Handler):
        def parse_request(self):
            ok = super().parse_request()
            if ok and not self.headers.get("Tailscale-User-Login"):
                self.headers["Tailscale-User-Login"] = "tester@test"
            if ok and self.headers.get("Origin"):
                self.headers.replace_header("Origin", "https://" + self.headers.get("Host", ""))
            return ok
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Local)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"

    def get(path):
        try:
            with urllib.request.urlopen(base + path, timeout=10) as res:
                return res.status, json.loads(res.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def post(path, body):
        req = urllib.request.Request(base + path, data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json", "Origin": base})
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                return res.status, json.loads(res.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    code, d = get(f"/api/session/{sid}/tty/term/text")
    check(code == 200 and d.get("text") == text, f"GET …/tty/term/text: the same text ({code})")
    code, d = get(f"/api/session/{sid}/tty/claude/text")
    check(code == 409 and "isn't running" in d.get("error", ""), f"…/tty/claude/text, not running: 409, said ({code} {d})")
    code, d = get("/api/session/nope/tty/term/text")
    check(code == 404, f"no such chat: 404 ({code})")
    code, d = post(f"/api/session/{sid}/upload", {"name": "photo (2).png", "data": base64.b64encode(b"png!").decode()})
    full = d.get("full", "")
    check(code == 200 and full == str(work / ".amarchy/uploads/photo (2).png") and Path(full).read_bytes() == b"png!",
          f"an upload: its whole path too, for a terminal to type ({code} {d})")
    server.shutdown()
finally:
    subprocess.run(["tmux", "-L", "amarchy", "kill-server"], capture_output=True, env=am.clean_env())
    shutil.rmtree(home, ignore_errors=True)

print(f"\n{len(failed)} failed:\n  " + "\n  ".join(failed) if failed else "\nAll passed.")
sys.exit(1 if failed else 0)
