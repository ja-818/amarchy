# Moving a chat to another machine (docs/plan-omarchy-and-machines.md,
# "Moving a chat", track E), on the two-servers harness of test/machines.py:
# two amarchy app servers on this machine (alpha and beta, each with a home,
# state, port, name and tmux of its own), paired, their projects cloned from
# one origin (a bare repo here), and a fake claude that keeps a transcript
# where Claude Code does, resumes it (--resume) and can say what it was told
# first, so a moved chat shows it remembers.
#
#   - alpha to beta: refused while it works, and when it asked for a secret
#     and you didn't say; then moved: its uncommitted work as one WIP commit
#     on its branch, pushed to origin, its worktree on beta from it, the files
#     git ignores carried (.amarchy's upload, .env) but node_modules, a file
#     with a key in it never committed; its conversation resumed there (its
#     Claude remembers, and is told it moved), its name, priority, created,
#     seen and unread, run command, secret (asked: copied), preview (stopped
#     on alpha, registered on beta at beta's address); alpha let it go
#     (worktree, branch, state), its old key leads to the new one on both
#     boards, and a message sent to the old id goes on to beta;
#   - back, beta to alpha, with nothing to commit (no WIP commit);
#   - busy: --when-free waits for the turn to end, then moves it;
#   - dies halfway: beta's Claude doesn't come up, so beta undoes all of it
#     and alpha undoes the WIP commit, origin's branch, as they were, and its
#     preview starts again; beta's server dies in the middle of taking it:
#     alpha undoes, beta drops it once it's back, alpha's abort is answered;
#     alpha's mover dies after pushing: amarchy move --tend undoes it.
#
#   python3 test/move.py        exits 0 when every check passed (a few minutes)

import hashlib, http.client, json, os, shutil, signal, socket, subprocess, sys, tempfile, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BIN = str(ROOT / "bin/amarchy")
BASE = Path(tempfile.mkdtemp(prefix="move-"))
USER = "tester@example.com"
GIT_ID = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}", flush=True)
    if not ok:
        failed.append(what)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


# A claude that answers the control protocol and keeps its conversation where
# Claude Code does (~/.claude/projects/<its folder>/<session>.jsonl), picks it
# up again with --resume (none there: it fails, as Claude Code does), says
# what it was told first when asked, takes its time on "slow", and starts
# slowly or not at all when its home says so (slow-start, fail-resume).
FAKE = BASE / "bin"
FAKE.mkdir()
(FAKE / "claude").write_text('''#!/usr/bin/env python3
import json, os, re, sys, time, uuid
args = sys.argv[1:]
open("argv.txt", "a").write(json.dumps(args) + "\\n")
home = os.path.expanduser("~")
folder = os.path.join(home, ".claude", "projects", re.sub(r"[^A-Za-z0-9]", "-", os.getcwd()))
os.makedirs(folder, exist_ok=True)
sid = args[args.index("--resume") + 1] if "--resume" in args else str(uuid.uuid4())
log = os.path.join(folder, sid + ".jsonl")
if "--resume" in args and (not os.path.exists(log) or os.path.exists(os.path.join(home, "fail-resume"))):
    sys.stderr.write("No conversation found with session ID: " + sid + "\\n")
    sys.exit(1)
if os.path.exists(os.path.join(home, "slow-start")):
    time.sleep(float(open(os.path.join(home, "slow-start")).read() or 30))
def say(o):
    sys.stdout.write(json.dumps(o) + "\\n"); sys.stdout.flush()
def record(role, text):
    with open(log, "a") as f:
        f.write(json.dumps({"type": role, "sessionId": sid, "cwd": os.getcwd(), "uuid": str(uuid.uuid4()),
                            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
                            "message": {"role": role, "content": text if role == "user" else [{"type": "text", "text": text}]}}) + "\\n")
started = False
for line in sys.stdin:
    try:
        o = json.loads(line)
    except ValueError:
        continue
    if o.get("type") == "control_request":
        say({"type": "control_response", "response": {"subtype": "success", "request_id": o["request_id"], "response": {}}})
    elif o.get("type") == "user":
        c = o["message"]["content"]
        text = c if isinstance(c, str) else " ".join(b.get("text", "") for b in c if isinstance(b, dict))
        open("got.txt", "a").write(text + "\\n")
        if not started:
            say({"type": "system", "subtype": "init", "session_id": sid, "model": "fake"})
            started = True
        first = None
        if os.path.exists(log):
            for l in open(log):
                r = json.loads(l)
                if r.get("type") == "user":
                    first = r["message"]["content"]
                    break
        record("user", text)
        if "slow" in text:
            time.sleep(8)
        answer = f"You said first: {first}" if "what did I say first" in text else "ok"
        record("assistant", answer)
        open("got.txt", "a").write("ANSWER: " + answer + "\\n")
        say({"type": "result", "subtype": "success", "is_error": False, "duration_ms": 10, "session_id": sid, "result": answer})
''')
(FAKE / "claude").chmod(0o755)
# Never this machine's own tailscale: its tailscaled is the live host's (a
# preview would be served on its tailnet). One that knows nothing.
(FAKE / "tailscale").write_text("#!/bin/sh\n[ \"$1\" = status ] && { echo '{}'; exit 0; }\nexit 1\n")
(FAKE / "tailscale").chmod(0o755)

# One origin for both machines' project (a bare repo: as GitHub would be).
ORIGIN = BASE / "origin.git"
seed = BASE / "seed"
seed.mkdir()
def git(cwd, *a, env=None):
    return subprocess.run(["git", *a], cwd=cwd, capture_output=True, text=True, env={**os.environ, **GIT_ID, **(env or {})})
git(BASE, "init", "-q", "--bare", "-b", "main", str(ORIGIN))
git(seed, "init", "-q", "-b", "main")
(seed / "README.md").write_text("# proj\n")
(seed / ".gitignore").write_text(".env\nnode_modules/\nargv.txt\ngot.txt\n")     # (the fake's own: carried as ignored)
(seed / "app.txt").write_text("one\n")
git(seed, "add", ".")
git(seed, "commit", "-q", "-m", "first")
git(seed, "remote", "add", "origin", str(ORIGIN))
git(seed, "push", "-q", "origin", "main")


class Machine:
    def __init__(self, name):
        self.name, self.port = name, free_port()
        self.home = BASE / name
        self.work = self.home / "Work"
        self.url = f"http://127.0.0.1:{self.port}"
        self.socket = f"amarchy-test-{os.getpid()}-{name}"
        self.env = {
            "HOME": str(self.home), "XDG_STATE_HOME": str(self.home / "state"), "XDG_CONFIG_HOME": str(self.home / "config"),
            "AMARCHY_WORK": str(self.work), "AMARCHY_TMUX": self.socket, "AMARCHY_HOST_NAME": name,
            "AMARCHY_HOST_APP_PORT": str(self.port), "AMARCHY_HOST_URL": self.url, "AMARCHY_HOST_APP_LINKS": "off",
            "AMARCHY_HOST_APP_USERS": USER, "AUTO_UPDATE": "off",
            "AMARCHY_HOST_BIND": "127.0.0.1",
            "PATH": f"{FAKE}:/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8",
            "XDG_RUNTIME_DIR": os.environ.get("XDG_RUNTIME_DIR", ""), "DBUS_SESSION_BUS_ADDRESS": os.environ.get("DBUS_SESSION_BUS_ADDRESS", ""),
            "SHELL": "/bin/bash", "TERM": "xterm-256color",
        }
        self.proc, self.jar = None, None
        self.work.mkdir(parents=True)
        git(self.work, "clone", "-q", str(ORIGIN), "proj")
        self.repo = self.work / "proj"

    def amarchy(self, *args, input=None, timeout=300, env_extra=None):
        return subprocess.run([sys.executable, BIN, *args], env={**self.env, **(env_extra or {})}, capture_output=True, text=True,
                              input=input, timeout=timeout)

    def start(self):
        self.log = open(self.home / "server.log", "a")
        self.proc = subprocess.Popen([sys.executable, BIN, "app", "serve"], env=self.env, stdout=self.log, stderr=self.log,
                                     stdin=subprocess.DEVNULL, start_new_session=True)
        for _ in range(100):
            try:
                socket.create_connection(("127.0.0.1", self.port), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)
        key = (self.home / "state/amarchy/app/local.key").read_text().strip()
        code, h, _ = self.ask("GET", f"/local?key={key}", cookie=False)
        self.jar = h.get("Set-Cookie", "").split(";")[0]
        return code == 303

    def stop(self, how=signal.SIGTERM):
        if self.proc and self.proc.poll() is None:
            os.killpg(self.proc.pid, how)
            self.proc.wait(10)

    def ask(self, method, path, body=None, headers=None, cookie=True, timeout=60):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=timeout)
        h = {"Host": f"127.0.0.1:{self.port}", **({"Cookie": self.jar} if cookie and self.jar else {})}
        if method == "POST":
            h.update({"Origin": self.url, "Content-Type": "application/json"})
        h.update(headers or {})
        c.request(method, path, body=json.dumps(body).encode() if body is not None else None, headers=h)
        r = c.getresponse()
        out = r.read()
        c.close()
        try:
            return r.status, dict(r.getheaders()), json.loads(out or b"{}")
        except ValueError:
            return r.status, dict(r.getheaders()), {"raw": out[:200]}

    def state(self):
        return self.ask("GET", "/api/state")[2]

    def chat(self, sid):
        return next((s for s in self.state()["sessions"] if s["id"] == sid and s.get("machine") in (None, self.name)), None)

    def own(self, sid):
        """The chat as this machine has it itself (its own list, not the board)."""
        r = self.amarchy("list", "--compact")
        return next((s for s in json.loads(r.stdout or "[]") if s["id"] == sid), None) if r.returncode == 0 else None

    def state_dir(self):
        return self.home / "state/amarchy"

    def projects_dir(self, path):
        import re
        return self.home / ".claude/projects" / re.sub(r"[^A-Za-z0-9]", "-", str(path))


def until(fn, limit=30, step=0.3):
    end = time.time() + limit
    while time.time() < end:
        try:
            v = fn()
            if v:
                return v
        except Exception:
            pass
        time.sleep(step)
    return None


def got(m, path):
    try:
        return (Path(path) / "got.txt").read_text()
    except OSError:
        return ""


def git_state(path):
    """What a worktree is, for checking it's as it was: HEAD, the index's
    tree, git status."""
    return (git(path, "rev-parse", "HEAD").stdout.strip(), git(path, "write-tree").stdout.strip(),
            git(path, "status", "--porcelain", "--untracked-files=all").stdout)


def origin_branch(branch):
    return git(BASE, "--git-dir", str(ORIGIN), "rev-parse", "--verify", "--quiet", f"refs/heads/{branch}").stdout.strip() or None


def new_chat(m, name, first="remember the blue door"):
    r = m.amarchy("new", "proj", name, "--prompt", first)
    sid = r.stdout.strip().splitlines()[-1] if r.returncode == 0 and r.stdout.strip() else ""
    ready = until(lambda: (s := m.own(sid)) and not s.get("setup") and s["status"] == "idle" and Path(s["path"]).is_dir()
                  and "ANSWER" in got(m, s["path"]) and s, limit=60)
    return sid, ready


def say_to(m, sid, text):
    code, _, said = m.ask("POST", f"/api/session/{sid}/send", {"text": text})
    return code, said


alpha, beta = Machine("alpha"), Machine("beta")
try:
    print("two machines, one origin")
    check(alpha.start() and beta.start(), f"alpha (:{alpha.port}) and beta (:{beta.port}) serve, each its own")
    r = alpha.amarchy("machines", "add", beta.url)
    check(r.returncode == 0, f"paired ({(r.stdout or r.stderr).strip()[:100]})")
    code, _, h = beta.ask("GET", "/api/peer/hello", cookie=False)
    check(h.get("moves") is True, "beta says it takes moves (hello)")

    sid, ready = new_chat(alpha, "door")
    check(sid == "proj-door" and bool(ready), f"a chat on alpha, its first turn done ({sid})")
    wt = Path(ready["path"]) if ready else alpha.work
    conv = (alpha.state_dir() / f"claude/{sid}/conversation").read_text().strip() if ready else ""
    log = alpha.projects_dir(wt) / f"{conv}.jsonl"
    check(len(conv) == 36 and log.is_file(), f"its conversation, where Claude keeps it ({log.name})")

    print("what moving it would do")
    r = alpha.amarchy("move", sid, "--check", "--to", "beta", "--json")
    plan = json.loads(r.stdout) if r.stdout.strip().startswith("{") else {}
    check(r.returncode == 0 and plan.get("on") and not plan.get("refused") and not plan.get("busy"),
          f"it can move now ({plan.get('refused') or plan.get('busy')})")
    r = alpha.amarchy("move", sid, "--to", "gamma")
    check(r.returncode != 0 and "no machine gamma" in r.stderr, "to a machine not paired: said")
    r = alpha.amarchy("move", sid, "--to", "alpha")
    check(r.returncode != 0 and "this machine already" in r.stderr, f"to itself: said ({r.stderr.strip()[-60:]})")

    print("busy: it works, so it waits")
    say_to(alpha, sid, "a slow one")
    check(bool(until(lambda: alpha.own(sid)["status"] == "working", limit=10)), "it works on a slow turn")
    r = alpha.amarchy("move", sid, "--to", "beta")
    check(r.returncode != 0 and "it's working" in r.stderr and "--when-free" in r.stderr,
          f"refused while it works, saying why and how ({r.stderr.strip()[-120:]})")
    code, _, said = alpha.ask("POST", f"/api/session/{sid}/move", {"to": "beta", "when": "now"})
    check(code == 409 and said.get("busy"), f"the app's: 409 with why ({said.get('error')})")
    check(bool(until(lambda: alpha.own(sid)["status"] == "idle", limit=20)), "its turn ends")

    print("a secret it asked for: only when you say")
    alpha.amarchy("secret", "set", "OPENAI_API_KEY", "--project", "proj", input="sk-test-0123456789abcdef\n")
    with open(log, "a") as f:     # (what Claude Code writes of a Bash call)
        f.write(json.dumps({"type": "assistant", "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
                            "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "toolu_1", "name": "Bash",
                                        "input": {"command": "amarchy secret ask OPENAI_API_KEY --why 'tests'"}}]}}) + "\n")
    r = alpha.amarchy("move", sid, "--check", "--to", "beta", "--json")
    check(json.loads(r.stdout).get("secrets") == ["OPENAI_API_KEY"], "it says it asked for OPENAI_API_KEY")
    r = alpha.amarchy("move", sid, "--to", "beta")
    check(r.returncode != 0 and "--secrets" in r.stderr, f"without --secrets or --no-secrets, asked first ({r.stderr.strip()[-90:]})")

    print("what it carries")
    (wt / "app.txt").write_text("one\ntwo (not committed)\n")       # changed, not committed
    (wt / "notes.md").write_text("new, not added\n")                # new, not added
    (wt / ".env").write_text("LOCAL=1\n")                           # ignored: carried
    (wt / "node_modules/dep").mkdir(parents=True)                   # rebuilt there: not carried
    (wt / "node_modules/dep/index.js").write_text("x\n")
    (wt / "config").mkdir()
    (wt / "config/credentials.json").write_text('{"token": "abc"}\n')   # a key: never committed, carried
    code, _, up = alpha.ask("POST", f"/api/session/{sid}/upload", {"name": "pic.png", "data": "iVBORw0KGgo="})
    check(code == 200 and (wt / ".amarchy/uploads/pic.png").is_file(), "an upload in .amarchy/uploads")
    alpha.amarchy("run", "--set", "echo running $AMARCHY_NAME", env_extra={"AMARCHY_SESSION": sid})
    alpha.amarchy("priority", "high", "--id", sid)
    alpha.amarchy("rename", "--id", sid, "Door: the blue one")
    pport = free_port()
    r = alpha.amarchy("preview", "--id", sid, "--run", f"python3 -m http.server {pport} --bind 127.0.0.1",
                      f"http://alpha:{pport}", env_extra={"AMARCHY_SESSION": sid}, timeout=120)
    has_preview = r.returncode == 0
    check(has_preview or "systemd" in r.stderr, f"a preview, running on alpha ({(r.stdout or r.stderr).strip()[-80:]})")
    before = alpha.own(sid)
    branch = before["branch"]
    created = before["created"]
    head_before = git(wt, "rev-parse", "HEAD").stdout.strip()

    print("alpha to beta")
    t0 = time.time()
    r = alpha.amarchy("move", sid, "--to", "beta", "--secrets")
    key = r.stdout.strip().splitlines()[-1] if r.returncode == 0 and r.stdout.strip() else ""
    check(key == f"beta:{sid}", f"moved: {key or r.stderr.strip()[-300:]} ({time.time() - t0:.1f} s)")
    there = until(lambda: beta.own(sid), limit=10)
    check(bool(there), "the chat is on beta")
    bwt = Path(there["path"]) if there else beta.work
    check(bwt == beta.work / ".worktrees/proj/door" and bwt.is_dir(), f"its worktree there, in the same layout ({bwt})")
    if there:
        check(there["branch"] == branch and git(bwt, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip() == branch,
              f"on its branch ({branch})")
        subject = git(bwt, "log", "-1", "--format=%s").stdout.strip()
        check(subject == "WIP: moving to beta (amarchy move)", f"its work as one WIP commit, named so ({subject})")
        check(git(bwt, "rev-parse", "HEAD~1").stdout.strip() == head_before, "on top of what it had")
        check(origin_branch(branch) == git(bwt, "rev-parse", "HEAD").stdout.strip(), "pushed to origin")
        check(git(bwt, "rev-parse", "--abbrev-ref", "@{u}").stdout.strip() == f"origin/{branch}", "tracking origin's")
        check((bwt / "app.txt").read_text() == "one\ntwo (not committed)\n" and (bwt / "notes.md").is_file(),
              "the changed file and the new one are there")
        files = git(bwt, "show", "--name-only", "--format=", "HEAD").stdout.split()
        check("config/credentials.json" not in files and (bwt / "config/credentials.json").is_file(),
              f"the file with a key: carried, never committed ({files})")
        check((bwt / ".env").read_text() == "LOCAL=1\n", "what git ignores (.env): carried")
        check((bwt / ".amarchy/uploads/pic.png").is_file(), "the chat's upload: carried")
        check(not (bwt / "node_modules").exists(), "node_modules: not carried (made again there)")
        check(git(bwt, "status", "--porcelain").stdout.strip() in ("?? config/", "?? config/credentials.json"),
              f"nothing else left over ({git(bwt, 'status', '--porcelain').stdout.strip()})")
        check(there["title"] == "Door: the blue one" and there["priority"] == "high" and there["created"] == created,
              f"its name, priority and created (its card's place) ({there.get('title')}, {there.get('priority')})")
        bconv = (beta.state_dir() / f"claude/{sid}/conversation").read_text().strip()
        check(bconv == conv and (beta.projects_dir(bwt) / f"{conv}.jsonl").is_file(), "its conversation, where beta's Claude looks")
        argv = [json.loads(l) for l in (bwt / "argv.txt").read_text().splitlines()]
        check(any(a[a.index("--resume") + 1] == conv for a in argv if "--resume" in a), "its Claude up on beta, resumed (--resume)")
        check(bool(until(lambda: (beta.own(sid) or {}).get("status") == "idle", limit=10)), "idle there")
        check((beta.home / "state/amarchy/run/proj").read_text().strip() == "echo running $AMARCHY_NAME", "its run command")
        sec = (beta.home / "config/amarchy/secrets/projects/proj.env")
        check(sec.is_file() and "OPENAI_API_KEY=" in sec.read_text() and oct(sec.stat().st_mode)[-3:] == "600",
              "the secret it asked for, copied (you said so), 0600")
        ps = there.get("previews") or []
        if has_preview:
            check(len(ps) == 1 and ps[0]["url"] == f"http://beta:{pport}" and ps[0]["state"] != "up",
                  f"its preview: registered at beta's address, not started ({[(p['url'], p['state']) for p in ps]})")
        code, said = say_to(beta, sid, "what did I say first?")
        check(code == 200 and bool(until(lambda: "ANSWER: You said first: remember the blue door" in got(beta, bwt), limit=20)),
              "its Claude remembers (what it was told first, on alpha)")
        check("this chat moved from alpha to beta" in got(beta, bwt) and "WIP: moving to beta" in got(beta, bwt),
              "and is told, with that message, that it moved and what the WIP commit is")
        check(not (beta.state_dir() / f"claude/{sid}/moved-note").exists(), "told once")
    print("alpha let it go")
    check(alpha.own(sid) is None, "not on alpha's list")
    check(not wt.exists(), "its worktree gone")
    check(git(alpha.repo, "rev-parse", "--verify", "--quiet", f"refs/heads/{branch}").returncode != 0, "its local branch gone (origin has it)")
    check(not (alpha.state_dir() / f"claude/{sid}").exists(), "amarchy's state of it gone")
    check(log.is_file(), "Claude's own files of its conversation stay, as closing leaves them")
    missions = alpha.state_dir() / "missions.jsonl"
    check(not missions.exists() or sid not in missions.read_text(), "not a mission completed")
    if has_preview:
        check(subprocess.run(["systemctl", "--user", "is-active", f"amarchy-preview-{sid}"], capture_output=True, text=True).stdout.strip()
              != "active", "its preview stopped on alpha")
    st = alpha.state()
    check(st.get("moved", {}).get(f"alpha:{sid}") == f"beta:{sid}", f"alpha's board: its old key leads to the new one ({st.get('moved')})")
    card = until(lambda: next((s for s in alpha.state()["sessions"] if s["id"] == sid and s.get("machine") == "beta"), None), limit=15)
    check(bool(card) and card.get("priority") == "high" and card.get("created") == created and card.get("title") == "Door: the blue one",
          "its card on alpha's board: beta's now, as it was (its place)")
    bst = until(lambda: (v := beta.state()) and v.get("moved", {}).get(f"alpha:{sid}") and v, limit=15)
    check(bool(bst) and bst["moved"][f"alpha:{sid}"] == f"beta:{sid}", "beta's board says so too (alpha's moved chats)")
    r = alpha.amarchy("send", sid, "sent to the old id")
    check(r.returncode == 0 and "moved to beta" in r.stderr, f"amarchy send to its old id on alpha: goes on to beta ({r.stderr.strip()[:80]})")
    check(bool(until(lambda: "sent to the old id" in got(beta, bwt), limit=20)), "its Claude on beta got it")

    print("back again, beta to alpha (nothing to commit)")
    until(lambda: (beta.own(sid) or {}).get("status") == "idle", limit=20)
    r = beta.amarchy("move", sid, "--to", "alpha", "--no-secrets")
    key = r.stdout.strip().splitlines()[-1] if r.returncode == 0 and r.stdout.strip() else ""
    check(key == f"alpha:{sid}", f"moved back: {key or r.stderr.strip()[-300:]}")
    home_again = until(lambda: alpha.own(sid), limit=10)
    check(bool(home_again) and Path(home_again["path"]) == wt, "on alpha, its worktree where it was")
    if home_again:
        check(git(wt, "log", "-1", "--format=%s").stdout.strip() == "WIP: moving to beta (amarchy move)",
              "no second WIP commit: nothing was uncommitted")
        check(beta.own(sid) is None and not bwt.exists(), "beta let it go")
        check(alpha.state().get("moved", {}).get(f"alpha:{sid}") is None, "alpha's old key leads nowhere now: it's here")
        say_to(alpha, sid, "what did I say first? (back home)")
        check(bool(until(lambda: "You said first: remember the blue door" in got(alpha, wt), limit=20)), "and it still remembers")

    print("when it's free")
    until(lambda: alpha.own(sid)["status"] == "idle", limit=20)
    say_to(alpha, sid, "another slow one")
    until(lambda: alpha.own(sid)["status"] == "working", limit=10)
    r = alpha.amarchy("move", sid, "--to", "beta", "--when-free", "--no-secrets")
    check(r.returncode == 0 and "once it's free" in r.stdout, f"--when-free: it waits ({r.stdout.strip() or r.stderr.strip()[-100:]})")
    row = until(lambda: (c := alpha.chat(sid)) and c.get("moving") and c, limit=10)
    check(bool(row) and row["moving"]["when"] == "free" and row["moving"]["label"] == "beta",
          f"its card says it moves once it's free ({row and row.get('moving')})")
    check(bool(until(lambda: beta.own(sid), limit=60)), "once its turn ended, it's on beta")
    check(bool(until(lambda: alpha.own(sid) is None, limit=20)), "and off alpha")
    check("another slow one" in got(beta, beta.work / ".worktrees/proj/door") or
          "ANSWER: ok" in (alpha.projects_dir(wt) / f"{conv}.jsonl").read_text(), "after its turn, which it finished")

    print("dies halfway: beta's Claude doesn't come up")
    until(lambda: (beta.own(sid) or {}).get("status") == "idle", limit=20)
    r = beta.amarchy("move", sid, "--to", "alpha", "--no-secrets")
    check(r.returncode == 0, f"back on alpha first ({r.stderr.strip()[-200:]})")
    until(lambda: alpha.own(sid) and alpha.own(sid)["status"] == "idle", limit=20)
    (wt / "app.txt").write_text("one\ntwo\nthree, half staged\n")
    git(wt, "add", "app.txt")
    (wt / "app.txt").write_text("one\ntwo\nthree, half staged\nfour, not staged\n")
    (wt / "scratch.txt").write_text("new\n")
    was = git_state(wt)
    origin_was = origin_branch(branch)
    if has_preview:
        alpha.amarchy("preview", "start", env_extra={"AMARCHY_SESSION": sid}, timeout=120)
    (beta.home / "fail-resume").write_text("")
    r = alpha.amarchy("move", sid, "--to", "beta", "--no-secrets")
    check(r.returncode != 0 and "didn't start on beta" in r.stderr, f"it didn't move, saying why ({r.stderr.strip()[-160:]})")
    check(alpha.own(sid) is not None and beta.own(sid) is None, "still on alpha, not on beta")
    check(git_state(wt) == was, "its worktree exactly as it was: the WIP commit undone, the index as it was (half staged)")
    check(origin_branch(branch) == origin_was, "origin's branch as it was")
    check(not (beta.work / ".worktrees/proj/door").exists(), "beta undid its worktree")
    check(git(beta.repo, "rev-parse", "--verify", "--quiet", f"refs/heads/{branch}").returncode != 0, "and its branch")
    check(not (beta.state_dir() / f"claude/{sid}").exists() and not (beta.state_dir() / f"sessions/{sid}.json").exists(),
          "and its state of it")
    row = until(lambda: (c := alpha.chat(sid)) and c.get("move_error") and c, limit=10)
    check(bool(row) and row.get("move_error") and "didn't start on beta" in row["move_error"]["error"] and not row.get("moving"),
          f"its card says why it didn't move ({row and row.get('move_error')})")
    if has_preview:
        check(bool(until(lambda: (alpha.own(sid)["previews"] or [{}])[0].get("state") in ("up", "starting"), limit=30)),
              "its preview started again")
    code, _, _ = alpha.ask("POST", f"/api/session/{sid}/move", {"dismiss": True})
    check(code == 200 and not alpha.own(sid).get("move_error"), "dismissed")
    (beta.home / "fail-resume").unlink()

    print("dies halfway: beta's server goes in the middle of taking it")
    (beta.home / "slow-start").write_text("40")
    mover = subprocess.Popen([sys.executable, BIN, "move", sid, "--to", "beta", "--no-secrets"], env=alpha.env,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    taking = until(lambda: any(json.loads(f.read_text()).get("state") == "taking" for f in (beta.state_dir() / "moves-in").glob("*.json")),
                   limit=60, step=0.2)
    check(bool(taking), "beta is taking it (its Claude slow to start)")
    beta.stop(signal.SIGKILL)
    subprocess.run(["tmux", "-L", beta.socket, "kill-server"], capture_output=True)
    out, err = mover.communicate(timeout=120)
    check(mover.returncode != 0 and "didn't answer" in err, f"alpha: beta didn't answer, it's here as it was ({err.strip()[-160:]})")
    check(alpha.own(sid) is not None and git_state(wt) == was, "on alpha, exactly as it was")
    rec = json.loads((alpha.state_dir() / f"moves/{sid}.json").read_text())
    check(rec.get("abort") is True, "alpha keeps asking beta to let go of it")
    (beta.home / "slow-start").unlink()
    beta.start()
    check(bool(until(lambda: all(json.loads(f.read_text()).get("state") != "taking"
                                 for f in (beta.state_dir() / "moves-in").glob("*.json")), limit=30)),
          "beta, back, undid what it was taking")
    check(beta.own(sid) is None and not (beta.work / ".worktrees/proj/door").exists(), "nothing of it left on beta")
    alpha.amarchy("move", "--tend")
    rec = json.loads((alpha.state_dir() / f"moves/{sid}.json").read_text())
    check(not rec.get("abort"), "alpha's ask answered (move --tend)")
    alpha.amarchy("move", sid, "--dismiss")

    print("dies halfway: alpha's mover goes after pushing")
    was = git_state(wt)
    origin_was = origin_branch(branch)
    r = alpha.amarchy("move", sid, "--to", "beta", "--no-secrets", env_extra={"AMARCHY_MOVE_DIE": "Packing its conversation"})
    check(r.returncode != 0, "the mover died")
    check(git_state(wt) != was or origin_branch(branch) != origin_was, "in the middle: its WIP commit made, pushed")
    alpha.amarchy("move", "--tend")
    check(git_state(wt) == was and origin_branch(branch) == origin_was, "amarchy move --tend undid it: as it was, origin too")
    row = alpha.own(sid)
    check(bool(row) and row.get("move_error") and "in the middle" in row["move_error"]["error"], "its card says what happened")
    check(beta.own(sid) is None, "never on beta")

    print("refused")
    r = alpha.amarchy("agents", sid, "--name", "Doorman")
    r = alpha.amarchy("move", sid, "--to", "beta", "--no-secrets")
    check(r.returncode != 0 and "an agent lives on its machine" in r.stderr, f"an agent: stays ({r.stderr.strip()[-80:]})")
    alpha.amarchy("agents", sid, "off")
    (wt / "app.txt").write_text("key: sk-test-0123456789abcdef\n")
    r = alpha.amarchy("move", sid, "--check", "--to", "beta", "--json")
    check("secrets in it" in json.loads(r.stdout).get("refused", "") or "one of your secrets" in json.loads(r.stdout).get("refused", ""),
          f"a changed file with a secret in it: never committed to origin ({json.loads(r.stdout).get('refused')})")
finally:
    for m in (alpha, beta):
        try:
            m.stop()
        except Exception:
            pass
        subprocess.run(["tmux", "-L", m.socket, "kill-server"], capture_output=True)
    subprocess.run(["systemctl", "--user", "stop", "amarchy-preview-proj-door"], capture_output=True)
    subprocess.run(["systemctl", "--user", "reset-failed", "amarchy-preview-proj-door"], capture_output=True)
    if failed:
        for m in (alpha, beta):
            log_ = (m.home / "server.log")
            if log_.exists():
                print(f"--- {m.name}'s log\n" + log_.read_text()[-3000:])
    shutil.rmtree(BASE, ignore_errors=True)

print(f"\n{'all passed' if not failed else f'{len(failed)} failed'}")
sys.exit(1 if failed else 0)
