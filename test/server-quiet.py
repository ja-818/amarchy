# The server doesn't redo or resend what didn't change: the broker writes
# live.json only when it says something new (and a chat's stream sends it
# only then), a helper's step under no activity is nothing new, the side
# panel's Changes are made again only when the worktree changed (and ?sig=
# answers "same"), the look is kept while its folders don't change, and who's
# at the other end of a connection is asked of the kernel for that socket
# only. Without a browser.
#
#   python3 test/server-quiet.py        exits 0 when every check passed

import importlib.machinery, importlib.util, json, os, socket, subprocess, sys, tempfile, time
from pathlib import Path

home = tempfile.mkdtemp(prefix="server-quiet-")
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config",
                  XDG_RUNTIME_DIR=home + "/run")
os.makedirs(home + "/run")
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(Path(__file__).resolve().parent.parent / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failed.append(what)

# ---- live.json: written when it changed, never only to stamp the time

sid = "quiet-test"
agent = am.Agent({"id": sid, "path": home, "repo": "quiet"})
written = []
real_write = am.write_file
am.write_file = lambda f, data: (written.append(data), real_write(f, data))
agent.flush_live()
agent.flush_live()
check(len(written) == 1, "the same live state is written once")
check("updated" not in json.loads(written[0]), "live.json has no write stamp")
agent.live["partial"] = "Hello"
agent.flush_live()
check(len(written) == 2, "a change is written")
agent.live["updated"] = time.time()     # one from an older broker's state
agent.flush_live()
check(len(written) == 2, "a stamp alone isn't a change")
check(am.chat_live({"state": "idle", "updated": 1, "pid": 2}) == {"state": "idle"},
      "the stream's live leaves the stamp out (an older broker's)")

# A helper's step: under the activity it belongs to, news; under none, not.
dirty = []
agent.changed = lambda now=False: dirty.append(1)
helper = {"parent_tool_use_id": "toolu_1", "message": {"content": [{"type": "tool_use", "name": "Read", "input": {}}]}}
agent.on_assistant(helper)
check(not dirty, "a helper's step under no activity changes nothing")
agent.live["activity"] = {"tool": "Agent", "id": "toolu_1", "input": {}, "since": time.time()}
agent.on_assistant(helper)
check(dirty and agent.live["activity"].get("step", {}).get("tool") == "Read", "a helper's step under its activity is news")
am.write_file = real_write

# ---- the side panel's Changes: made again only when the worktree changed

repo = Path(home) / "repo"
repo.mkdir()
git = lambda *a: subprocess.run(["git", *a], cwd=repo, capture_output=True, text=True, check=True)
git("init", "-q", "-b", "main")
git("config", "user.email", "t@t"); git("config", "user.name", "t")
(repo / "a.txt").write_text("one\n")
git("add", "."); git("commit", "-qm", "first")
git("checkout", "-qb", "work")
s = {"id": "changes-test", "path": str(repo), "repo": "repo", "base": "main"}
made = []
real_made = am.changes_made
am.changes_made = lambda *a: (made.append(1), real_made(*a))[1]

def changes():
    before = len(made)
    d = am.app_changes(s)
    return d, len(made) > before

d, again = changes()
check(again and d["files"] == [], "nothing changed: no files")
d2, again = changes()
check(not again and d2["sig"] == d["sig"], "asked again, unchanged: the answer kept")
for what, change in [("a tracked file edited", lambda: (repo / "a.txt").write_text("one\ntwo\n")),
                     ("edited again (still dirty)", lambda: (repo / "a.txt").write_text("one\ntwo\nthree\n")),
                     ("a new file", lambda: (repo / "b.txt").write_text("new\n")),
                     ("the new file edited", lambda: (repo / "b.txt").write_text("newer\n")),
                     ("committed", lambda: (git("add", "."), git("commit", "-qm", "second"))),
                     ("a file deleted", lambda: (repo / "a.txt").unlink())]:
    time.sleep(0.01)
    change()
    was = d["sig"]
    d, again = changes()
    check(again and d["sig"] != was, f"{what}: made again, a new sig")
    d2, again = changes()
    check(not again and d2 == d, f"{what}, then nothing: kept")
fresh = real_made(repo, *am.git_base(s), [])
check(d["sig"] == fresh["sig"] and d["files"] == fresh["files"], "the kept answer is the one made now")
am.changes_made = real_made

# ---- the look: kept while its folders don't change

look = am.look_worn()
check(am.look_worn() == look and am.look_worn() is not am.look_worn(), "the look is kept, a copy each time")
calls = []
real_look = am.look_made
am.look_made = lambda choice: (calls.append(1), real_look(choice))[1]
am.look_worn()
check(not calls, "unchanged: not made again")
time.sleep(0.01)
am.write_file(am.APP_PICK / "choice.json", json.dumps({"theme": "gruvbox"}))
am.look_worn()
check(len(calls) == 1, "a theme picked: made again")
am._worn["at"] -= am.LOOK_WORN_FOR + 1
am.look_worn()
check(len(calls) == 2, f"after {am.LOOK_WORN_FOR} s: made again (a file changed in a folder)")
am.look_made = real_look

# ---- who's at the other end: the kernel's word for that socket, as /proc/net/tcp's

for family, host in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
    srv = socket.socket(family); srv.bind((host, 0)); srv.listen()
    c = socket.socket(family); c.connect(srv.getsockname()[:2]); a, _ = srv.accept()
    try:
        diag = am.sock_diag_uid(a)
    except (OSError, ValueError) as e:
        diag = f"no sock_diag here ({e})"
    real_diag = am.sock_diag_uid
    am.sock_diag_uid = lambda sock: (_ for _ in ()).throw(OSError("off"))
    proc = am.peer_uid(a)       # /proc/net/tcp's
    am.sock_diag_uid = real_diag
    check(diag == proc == os.getuid(), f"{family.name}: sock_diag says {diag}, /proc/net/tcp {proc}")
    check(am.peer_uid(a) == os.getuid(), f"{family.name}: peer_uid")
    c.close(); a.close(); srv.close()

print("all passed" if not failed else f"{len(failed)} failed")
sys.exit(1 if failed else 0)
