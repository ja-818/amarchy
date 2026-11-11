# A new chat given a closed chat's name (so its folder, where Claude Code
# still keeps the old conversations) is a new chat: it doesn't pick the old
# conversation up, wear its title, or show what it said. And a name amarchy
# picks itself is never a closed chat's. Without a browser.
#
#   python3 test/same-name.py       exits 0 when every check passed

import importlib.machinery, importlib.util, json, os, tempfile, time
from pathlib import Path

home = tempfile.mkdtemp(prefix="same-name-")
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config")
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(Path(__file__).resolve().parent.parent / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failed.append(what)

now = time.time()
path = am.WORKTREES / "proj" / "zesty-vanzetti"
s = {"id": "proj-zesty-vanzetti", "repo": "proj", "name": "zesty-vanzetti", "path": str(path), "created": int(now), "engine": "chat"}
folder = am.projects_dir(path)
folder.mkdir(parents=True)
old = folder / "11111111-1111-1111-1111-111111111111.jsonl"
old.write_text(json.dumps({"type": "ai-title", "aiTitle": "Overhaul the README"}) + "\n"
               + json.dumps({"type": "user", "message": {"role": "user", "content": "make the readme better"}}) + "\n")
os.utime(old, (now - 86400 * 20,) * 2)       # the closed chat's, weeks old

check(am.claude_resume(s) == [], f"a new chat with a closed chat's name: a new conversation ({am.claude_resume(s)})")
check(am.saved_title(s) == "", f"not its title ({am.saved_title(s)!r})")
check("readme" not in "\n".join(am.conversation_lines(s, 80)).lower(), "nor what it said")

# Its own conversation, once it has one: picked back up.
mine = folder / "22222222-2222-2222-2222-222222222222.jsonl"
mine.write_text(json.dumps({"type": "ai-title", "aiTitle": "Move the card at once"}) + "\n")
os.utime(mine, (now + 5,) * 2)
check(am.claude_resume(s) == ["--continue"], f"its own, the folder's latest: continued ({am.claude_resume(s)})")
check("card" in am.saved_title(s).lower(), f"its own title ({am.saved_title(s)!r})")
os.utime(old, (now + 60,) * 2)      # (the old one touched since: still its own it resumes)
check(am.claude_resume(s) in (["--continue"], ["--resume", mine.stem]), "an old one touched since: never one from before it by --continue alone")
am.set_conversation_id(s["id"], mine.stem)
check(am.claude_resume(s) == ["--resume", mine.stem], "the conversation it's in: resumed")

# A session from before `created` was kept: the folder's latest, as ever.
legacy = {k: v for k, v in s.items() if k != "created"}
(am.claude_dir(s["id"]) / "conversation").unlink()
check(am.claude_resume(legacy) == ["--continue"], "a session with no date: the folder's latest")

# The name amarchy picks: not one with conversations left.
am.sh = lambda *a, **k: type("R", (), {"stdout": "", "returncode": 0})()
am.sessions = lambda: []
am.ADJECTIVES, am.ANARCHISTS = ("zesty", "wobbly"), ("vanzetti",)
names = {am.auto_name("proj") for _ in range(40)}
check(names == {"wobbly-vanzetti"}, f"a picked name is never a closed chat's ({names})")

print("all ok" if not failed else f"{len(failed)} FAILED")
raise SystemExit(1 if failed else 0)
