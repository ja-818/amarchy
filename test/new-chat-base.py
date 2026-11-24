# Where a new chat starts: origin's default branch as origin says it is now,
# not as it was when the project was cloned. A project that moved its work
# to another branch on GitHub (houston-os: main, then dev) has its new chats
# start there; origin not answering, they start from the one remembered.
#
#   python3 test/new-chat-base.py         exits 0 when every check passed

import importlib.machinery, importlib.util, os, shutil, subprocess, sys, tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import homes      # (test/homes.py: its home gone with it, however it ends)
home = homes.home("new-chat-base")
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config",
                  AMARCHY_WORK=home + "/work", GIT_CONFIG_GLOBAL=home + "/gitconfig", GIT_CONFIG_NOSYSTEM="1")
os.environ.pop("AMARCHY_SESSION", None)
Path(home, "gitconfig").write_text("[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n")
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(Path(__file__).resolve().parent.parent / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failed.append(what)

def git(*args, cwd):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()

# origin: main, and dev a commit ahead of it.
origin = Path(home, "origin.git")
git("init", "--bare", "-q", str(origin), cwd=home)
seed = Path(home, "seed")
git("clone", "-q", str(origin), str(seed), cwd=home)
(seed / "a").write_text("a\n")
git("add", "a", cwd=seed); git("commit", "-qm", "a", cwd=seed); git("push", "-q", "origin", "main", cwd=seed)
git("checkout", "-qb", "dev", cwd=seed)
(seed / "b").write_text("b\n")
git("add", "b", cwd=seed); git("commit", "-qm", "b", cwd=seed); git("push", "-q", "origin", "dev", cwd=seed)
dev_sha = git("rev-parse", "dev", cwd=seed)

repo = am.WORK / "proj"
repo.parent.mkdir(parents=True)
git("clone", "-q", str(origin), str(repo), cwd=home)
check(am.default_base(repo) == "origin/main", "cloned while main was origin's default: origin/main")

def made(name):
    s = {"id": f"proj-{name}", "repo": "proj", "name": name, "branch": name, "base": am.default_base(repo),
         "path": str(am.WORKTREES / "proj" / name), "setup": True}
    am.save_session(s)
    err = am.make_worktree(s)
    return err, am.session(s["id"]), Path(s["path"])

# The project moves its work to dev (GitHub's default branch).
git("symbolic-ref", "HEAD", "refs/heads/dev", cwd=origin)
err, s, path = made("one")
check(err is None and s["base"] == "origin/dev", f"a new chat asks origin: it starts from origin/dev ({err or s['base']})")
check(git("rev-parse", "HEAD", cwd=path) == dev_sha, "its worktree is dev's latest")
check(am.default_base(repo) == "origin/dev", "and the project remembers it")

# Origin not answering: from the one remembered, the chat starts all the same.
shutil.move(str(origin), str(origin) + ".away")
err, s, path = made("two")
check(err is None and s["base"] == "origin/dev" and path.is_dir(), f"origin away: from what was fetched last ({err or s['base']})")
shutil.move(str(origin) + ".away", str(origin))

# A project without origin: its local main, as before.
local = am.WORK / "solo"
git("init", "-q", str(local), cwd=home)
(local / "x").write_text("x\n")
git("add", "x", cwd=local); git("commit", "-qm", "x", cwd=local)
check(am.default_base(local) == "main", "no origin: its main")

print(f"\n{len(failed)} failed" if failed else "\nAll passed.")
sys.exit(1 if failed else 0)
