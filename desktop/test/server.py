# An amarchy app server for the desktop app's tests: this checkout's
# bin/amarchy, with a home, state and tmux of its own (nothing of the
# machine's), on 127.0.0.1:<port>, as the browser tests run it
# (test/today-view.js): who's asking is "tester@test", writes come from the
# app's own pages. Its chats are made up: "desk-long", a long conversation
# (whose live words a test can stream: POST /__test/live), and "desk-term",
# whose terminal is a real shell in a git repo of its own.
#
#   python3 desktop/test/server.py <port> [home] [--local] [--no-chats]
#
# Prints "listening <home>" when up. Its home is laid out as a machine's
# (~/.config/amarchy, ~/.local/state/amarchy), so the desktop app run with
# the same HOME finds it as this machine's amarchy. --local: as this
# machine's own app server (who's asking checked for real: the desktop
# app's local key and cookie; APP_PORT= in the host settings); else as a
# server through Tailscale, its login and Origin given to every request.
# --no-chats: an amarchy with no chats. --address=<name>: the name it's
# asked for at (a tailnet name, reached through a proxy), else 127.0.0.1.
#
# Dictation is set up on it, with a made-up speech model: what it hears is
# written down as "heard <n> seconds" (the audio's length), so a test sees
# the microphone's sound go all the way.
#
# A test reports what the page saw with POST /__test/report (printed as
# "report <json>"), since the page can't print anywhere a test reads.

import http.server
import importlib.machinery
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
flags = [a for a in sys.argv[1:] if a.startswith("--")]
pos = [a for a in sys.argv[1:] if not a.startswith("--")]
port = int(pos[0])
home = pos[1] if len(pos) > 1 else tempfile.mkdtemp(prefix="amarchy-desktop-test-")
LOCAL, CHATS = "--local" in flags, "--no-chats" not in flags
# --address=<name>: the name it's asked for at (a tailnet name, reached through a proxy).
ADDRESS = next((f.split("=", 1)[1] for f in flags if f.startswith("--address=")), "127.0.0.1")
os.makedirs(home, exist_ok=True)
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/.local/state", XDG_CONFIG_HOME=home + "/.config",
                  AMARCHY_WORK=home + "/Work", TMUX_TMPDIR=home + "/tmux")
os.makedirs(home + "/tmux", exist_ok=True)
for k in ("AMARCHY_SESSION", "AMARCHY_SENT_BY", "TMUX"):
    os.environ.pop(k, None)

loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(ROOT / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)
am.app_key()
am.migrate()

WORDS = ("The board reads the chats every second and wakes the streams on a change, so what you did is on "
         "every screen in a moment. ")


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
    """A chat on the chat engine with a conversation of turns (you, Claude)."""
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
    return path


LONG = [(f"Question {i + 1}: how does part {i + 1} work?",
         f"Part {i + 1} works.\n\n" + WORDS * 6 + f"\n\n- one point about part {i + 1}\n- another\n\n"
         f"```command\nls part-{i + 1}\n```") for i in range(120)]
am.SESSIONS.mkdir(parents=True, exist_ok=True)
if CHATS:
    chat("desk-long", "Long: a chat with 120 turns", LONG)
    chat("desk-term", "Term: a real terminal", [("Run the tests", "They pass.")])
if LOCAL:
    am.write_file(am.HOST_CONFIG, f"APP_PORT={port}\n")
    am.local_key()

class Heard:
    """The host's speech model, made up: the audio's length, in words."""
    def __init__(self, transcriber, heard):
        self.bytes, self.loud, self.pieces = 0, False, 0

    def add(self, data):
        self.bytes += len(data)
        self.loud = self.loud or any(b not in (0, 255) for b in data[1::2])

    def finish(self):
        return f"heard {self.bytes / 32000:.1f} seconds" if self.loud else ""

    def drop(self):
        pass


class Model:
    def warm(self):
        pass


am.Dictation = Heard
am.dictate_status = lambda: {"ready": True, "lib": True, "model": True, "engine": "test", "size": "0", "setup": None}

st = am.AppState()
st.transcriber = Model()
Handler = am.app_handler(st, ["tester@test"], ADDRESS)


class Local(Handler):
    def parse_request(self):
        ok = super().parse_request()
        self.sent_origin = self.headers.get("Origin") if ok else None     # as sent, before it's made the tailnet's below
        if LOCAL:
            return ok
        if ok and not self.headers.get("Tailscale-User-Login"):
            self.headers["Tailscale-User-Login"] = "tester@test"
        if ok and self.headers.get("Origin"):
            self.headers.replace_header("Origin", "https://" + self.headers.get("Host", ""))
        return ok

    def do_POST(self):
        # A chat's answer or message, as the desktop app's notification
        # buttons send them: let in (or not) as the app's would be, then
        # printed ("acted <path> <origin> <body>") instead of reaching a Claude.
        if re.fullmatch(r"/api/session/[^/]+/(answer|send)", self.path.partition("?")[0]):
            if not self.allowed(write=True):
                return
            n = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(n).decode(errors="replace")
            print(f"acted {self.path} {self.sent_origin} {body}", flush=True)
            return self.send(200, {"ok": True})
        if self.path == "/__test/notice":       # a notification, as the server sends one: {payload, desktop}
            n = int(self.headers.get("Content-Length") or 0)
            given = json.loads(self.rfile.read(n) or b"{}")
            sent = am.push_all(given.get("payload") or {}, given.get("desktop"))
            return self.send(200, {"sent": sent})
        if self.path in ("/__test/report", "/__test/live"):
            n = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(n).decode(errors="replace")
            if self.path == "/__test/report":
                print("report " + body.replace("\n", " "), flush=True)
            else:       # what the chat's Claude is writing now: {"sid", "partial", "state"}
                live = json.loads(body)
                am.write_file(am.agent_live_file(live.pop("sid")), json.dumps(
                    {"pid": os.getpid(), "claude_pid": os.getpid(), "updated": time.time(), **live}))
            self.send_response(204)
            self.end_headers()
            return
        return super().do_POST()


server = (am.app_server_class() if LOCAL else http.server.ThreadingHTTPServer)(("127.0.0.1", port), Local)
server.daemon_threads = True
threading.Thread(target=am.app_watch, args=(st,), daemon=True).start()
print(f"listening {home}", flush=True)
server.serve_forever()
