# The amarchy the iPhone app's UI test opens: this checkout's bin/amarchy
# (its app_handler, the real app and API), with a home of its own, on
# 127.0.0.1:<port>, as test/today-view.js runs it: who's asking is
# "tester@test", writes come from the app's own pages. The machine is
# "testbox", with two made-up chats ("desk-fix", "desk-docs").
#
#   python3 phone/ios/UITests/server.py <port> [home]
#
# Prints "listening <port>" when up. Runs on macOS (the CI's simulator host): what
# bin/amarchy reads from Linux's /proc to know who's asking is answered
# here (it's always you, on this machine).

import http.server
import importlib.machinery
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
port = int(sys.argv[1])
if len(sys.argv) > 2:
    home = sys.argv[2]
else:       # run by hand: a home of its own, gone when it stops (test/homes.py)
    sys.path.insert(0, str(ROOT / "test")); import homes
    home = homes.home("ios-server")
os.makedirs(home, exist_ok=True)
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/.local/state", XDG_CONFIG_HOME=home + "/.config",
                  AMARCHY_WORK=home + "/Work", TMUX_TMPDIR=home + "/tmux")
os.makedirs(home + "/tmux", exist_ok=True)
for k in ("AMARCHY_SESSION", "AMARCHY_SENT_BY", "TMUX"):
    os.environ.pop(k, None)

loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(ROOT / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)

# macOS has no /proc and no sock_diag: every connection here is this user's.
am.tailscale_uids = lambda: {0, os.getuid()}
am.peer_uid = lambda sock: os.getuid()

am.write_file(am.HOST_CONFIG, "NAME=testbox\n")
am.app_key()
am.migrate()


def repo(path):
    path.mkdir(parents=True, exist_ok=True)
    if not (path / ".git").exists():
        subprocess.run(["git", "init", "-q", "-b", "main", str(path)], check=True)
        (path / "README.md").write_text("A test project.\n")
        subprocess.run(["git", "-C", str(path), "add", "."], check=True)
        subprocess.run(["git", "-C", str(path), "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first"],
                       check=True)
    return path


def chat(sid, title, turns):
    """A chat on the chat engine, with a conversation of (you, Claude) turns."""
    name = sid.split("-", 1)[1]
    path = repo(Path(home) / "Work/.worktrees/desk" / name)
    am.write_file(am.SESSIONS / f"{sid}.json", json.dumps({
        "id": sid, "repo": "desk", "name": name, "branch": name, "base": "origin/main", "path": str(path),
        "created": int(time.time()) - 7200, "title": title, "engine": "chat"}))
    conv = str(uuid.uuid4())
    am.set_conversation_id(sid, conv)
    lines, parent = [], None
    for i, (you, claude) in enumerate(turns):
        for role, text in (("user", you), ("assistant", claude)):
            u = str(uuid.uuid4())
            at = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() - 7000 + i * 30))
            msg = {"role": role, "content": text if role == "user" else [{"type": "text", "text": text}]}
            lines.append(json.dumps({"type": role, "message": msg, "uuid": u, "parentUuid": parent, "timestamp": at,
                                     "sessionId": conv, "cwd": str(path)}))
            parent = u
    f = am.projects_dir(path) / f"{conv}.jsonl"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("\n".join(lines) + "\n")


am.SESSIONS.mkdir(parents=True, exist_ok=True)
chat("desk-fix", "Fix the login", [("Fix the login page", "Fixed: the form posts again, and its test passes.")])
chat("desk-docs", "Write the docs", [("Write the setup docs", "Written: docs/setup.md, with the three steps.")])

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


server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Local)
server.daemon_threads = True
threading.Thread(target=am.app_watch, args=(st,), daemon=True).start()
print(f"listening {port}", flush=True)
server.serve_forever()
