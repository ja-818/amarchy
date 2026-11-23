# The desktop app's notifications, from the app server's side (the contract's
# "Its notifications"): every notification sent to the phones is kept for the
# desktop apps (the last NOTICES_KEEP), GET /api/notices streams the new ones
# (never one from before it connected) to a desktop app, which then counts as a
# device notified; a notice's buttons are what Today's card offers (Allow and
# Deny, a plan's Approve, a question's options, a done reply's choices; none
# for a secret or a question it can't answer in one tap), another machine's
# through its pass-through; its chime is the chat's.
#
#   python3 test/desktop-notices.py         exits 0 when every check passed

import http.server
import importlib.machinery
import importlib.util
import json
import os
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

home = tempfile.mkdtemp(prefix="desktop-notices-")
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config", AMARCHY_WORK=home + "/Work")
for k in ("AMARCHY_SESSION", "AMARCHY_SENT_BY"):
    os.environ.pop(k, None)
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(Path(__file__).resolve().parent.parent / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)

failed = []


def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failed.append(what)


# ---- the buttons
perm = {"id": "proj-a", "status": "waiting", "today": {}}
acts = am.notice_actions(perm, [{"request_id": "r1", "tool": "Bash", "input": {"command": "ls"}}])
check([a["label"] for a in acts] == ["Allow", "Deny"] and acts[0]["path"] == "/api/session/proj-a/answer"
      and acts[0]["body"] == {"request_id": "r1", "choice": "allow"} and acts[1]["body"]["choice"] == "deny",
      "a permission: Allow and Deny, answered as Today's card answers it")
q = {"request_id": "r2", "tool": "AskUserQuestion",
     "input": {"questions": [{"question": "Ship it?", "options": [{"label": "Ship it"}, {"label": "Not yet"}]}]}}
acts = am.notice_actions(perm, [q])
check([a["label"] for a in acts] == ["Ship it", "Not yet"]
      and acts[0]["body"] == {"request_id": "r2", "choice": "allow", "answers": {"Ship it?": "Ship it"}},
      "a question: its options, each its answer")
many = {**q, "input": {"questions": [{"question": "Which?", "options": [{"label": str(i)} for i in range(4)]}]}}
check(am.notice_actions(perm, [many]) == [], "a question with more than three options: none (the chat has them)")
multi = {**q, "input": {"questions": [{"question": "Which?", "multiSelect": True, "options": [{"label": "a"}, {"label": "b"}]}]}}
check(am.notice_actions(perm, [multi]) == [], "a question with several answers: none")
two = {**q, "input": {"questions": [q["input"]["questions"][0], {"question": "And?", "options": [{"label": "x"}]}]}}
check(am.notice_actions(perm, [two]) == [], "two questions at once: none")
plan = am.notice_actions(perm, [{"request_id": "r3", "tool": "ExitPlanMode", "input": {"plan": "x"}}])
check([a["label"] for a in plan] == ["Approve"] and plan[0]["body"] == {"request_id": "r3", "choice": "allow"}, "a plan: Approve")
secret = {**perm, "secret_asks": [{"name": "OPENAI_API_KEY", "waiting": True}]}
check(am.notice_actions(secret, [{"request_id": "r1", "tool": "Bash"}]) == [], "a secret: no button (only in the app)")
peer = {"id": "dots", "machine": "omarchy", "status": "waiting", "permission": {"request_id": "r9", "tool": "Edit"}}
acts = am.notice_actions(peer, None, "/api/m/omarchy")
check([a["path"] for a in acts] == ["/api/m/omarchy/api/session/dots/answer"] * 2 and acts[0]["body"]["request_id"] == "r9",
      "another machine's chat: through its pass-through, from its row")
done = {"id": "proj-b", "status": "idle",
        "today": {"asks": [{"question": "Ship it to main?", "options": [{"label": "Ship it", "send": "Ship it: merge to main and push"},
                                                                        {"label": "Not yet", "send": "Not yet"}]}]}}
acts = am.notice_actions(done)
check([a["label"] for a in acts] == ["Ship it", "Not yet"] and acts[0]["path"] == "/api/session/proj-b/send"
      and acts[0]["body"] == {"text": "Ship it: merge to main and push"}, "a done reply's choices: each sends its message (Ship it)")
check(am.notice_actions({"id": "x", "status": "idle", "today": {"asks": done["today"]["asks"] * 2}}) == [],
      "a reply asking two questions: none")
check(am.notice_actions({"id": "a b/c", "status": "waiting", "today": {}}, [{"request_id": "r", "tool": "Bash"}])[0]["path"]
      == "/api/session/a%20b%2Fc/answer", "a chat's id goes in the path as one part")

# ---- the chime
check(am.notice_chime({"id": "x"}, False) == am.sound_name(), "a chat's notice rings the chime picked")
check(am.notice_chime({"id": "x", "chime": "bell"}, True) == "bell" and am.notice_chime({"id": "x", "assistant": "agent"}, True) == am.ASSISTANT_CHIME,
      "an agent's rings its own chime")

# ---- kept, and streamed
check(am.notice_put({"title": "before"}) > 0 and am.notices_after(0)[-1]["title"] == "before", "a notice is kept")
for i in range(am.NOTICES_KEEP + 5):
    am.notice_put({"title": f"n{i}"})
kept = am.notices_after(0)
check(len(kept) == am.NOTICES_KEEP and kept[-1]["title"] == f"n{am.NOTICES_KEEP + 4}", f"only the last {am.NOTICES_KEEP} are kept")
check(oct(am.NOTICES.stat().st_mode & 0o777) == "0o600", "readable by you only")

am.app_key()
st = am.AppState()
st.transcriber = None
Handler = am.app_handler(st, ["tester@test"], "127.0.0.1")


class Local(Handler):
    def parse_request(self):
        ok = super().parse_request()
        if ok and not self.headers.get("Tailscale-User-Login"):
            self.headers["Tailscale-User-Login"] = "tester@test"
        return ok


server = am.app_server_class()(("127.0.0.1", 0), Local)
threading.Thread(target=server.serve_forever, daemon=True).start()
port = server.server_address[1]
check(am.desktops_listening() == 0 and not am.notified_anywhere(), "no desktop app listening yet: nothing would reach a device")

got, lines = [], []


def listen():
    r = urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{port}/api/notices?plain=1"), timeout=30)
    event = None
    for raw in r:
        line = raw.decode().rstrip("\n")
        lines.append(line)
        if line.startswith("event: "):
            event = line[7:]
        elif line.startswith("data: ") and event == "notice":
            got.append(json.loads(line[6:]))


threading.Thread(target=listen, daemon=True).start()
for _ in range(40):
    if am.desktops_listening():
        break
    time.sleep(0.1)
check(am.desktops_listening() == 1 and am.notified_anywhere(), "a desktop app listening counts as a device notified")
n = am.push_all({"title": "Asks you", "body": "Allow it?", "tag": "proj-a", "url": "/#/s/proj-a", "ask": "proj-a"},
                {"session": "proj-a", "sound": "kalimba", "actions": acts})
check(n == 1, f"sent: to the desktop app (no phone has notifications on) ({n})")
for _ in range(40):
    if got:
        break
    time.sleep(0.1)
check(len(got) == 1, f"the stream sends the new one, none of the {am.NOTICES_KEEP} from before ({len(got)})")
if got:
    g = got[0]
    check(g["title"] == "Asks you" and g["url"] == "/#/s/proj-a" and g["ask"] == "proj-a" and g["session"] == "proj-a"
          and g["sound"] == "kalimba" and g["actions"] == acts and isinstance(g["id"], int),
          "the phone's notification with the desktop's: its chat, chime and buttons")
am.push_all({"title": "Done", "body": "Second"})
for _ in range(40):
    if len(got) > 1:
        break
    time.sleep(0.1)
check(len(got) == 2 and got[1]["title"] == "Done", "and the next, as it's sent")
check(lines and lines[0].startswith("retry:"), "an event stream that comes back a second after the server restarts")

server.shutdown()
import shutil  # noqa: E402
shutil.rmtree(home, ignore_errors=True)
if failed:
    print(f"{len(failed)} failed")
    sys.exit(1)
print("all passed")
