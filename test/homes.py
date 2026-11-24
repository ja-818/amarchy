# A test's made-up home (and any scratch folder it makes), gone with the
# test: when it ends, passes or fails, raises, or is stopped (Ctrl-C, kill,
# a timeout). A server's /tmp is its RAM, shared by every chat: on
# 2026-11-24 the homes the tests had left there (551 of them, 16 GB) had
# filled it and the swap. test/homes.js is the same for the browser tests.
#
#   sys.path.insert(0, str(Path(__file__).resolve().parent)); import homes
#   home = homes.home("agents")            # $TMPDIR/agents-home-XXXXXXXX
#   work = homes.temp_dir("agents-work-")
#   homes.when_done(lambda: ...)            # something of its own to stop first (a tmux server)
#   homes.keep(home)                        # a failed run's, to look at (the sweep takes it a day on)
#   homes.clean_up()                        # all of it now, not only at the exit
#
# Imported, a kill (SIGTERM, SIGHUP) ends the test as an exit does, its
# finally blocks run (Ctrl-C does already). At the end, what the test
# started that's still running (its app servers, what they started) is
# stopped, then its folders go. Each run also sweeps what a test left over a
# day ago (killed with -9, or homes from before this). KEEP_TEST_HOMES=1
# keeps them, and says where they are. Screenshots (SHOTS) aren't its:
# they're kept, to look at.

import atexit
import os
import re
import shutil
import signal
import sys
import tempfile
import threading
import time

MARK = ".amarchy-test-home"     # in each folder made here: the sweep's to take, a day on
STALE = 24 * 3600
_made = []
_kept = []      # kept to look at (keep()): what runs from them is stopped all the same
_done = []
_hooked = False

# The tests' homes as they were named before this, without the mark: the
# sweep takes them too (only these, and only a day old: never another
# chat's file in /tmp). The same list as test/homes.js's.
LEGACY = {
    "agent-chat-view", "agent-tasks", "agents-view", "automations", "boards-view", "chat-keys", "chat-open",
    "chat-scroll", "cloud-view", "compare", "desktop", "ghostty", "image-names", "links-out", "local-key-view",
    "machines-look", "machines-view", "mic-first-tap", "mic-release", "mic-why", "move-view", "new-chat-project",
    "new-chat-share", "open-new-chat", "phone-app-view", "preview-view", "project-filter", "push-notice", "reply-view", "snappy",
    "spinner-view", "still-view", "suggest-view", "tailscale", "terminal-view", "today-view", "tour-view",
    "whole-view", "xpost-view",
}
MADE_NAME = re.compile(r"[a-z0-9][a-z0-9.-]*-[A-Za-z0-9_]{6,8}")      # mkdtemp's (Python's and node's)
HOME_NAME = re.compile(r"([a-z0-9][a-z0-9.-]*?)-home-[A-Za-z0-9_]{6,8}")

# The caches of what a test builds or fetches with are the account's, not a
# new one in each home: uv's (33 MB a home, a font cut) and Go's (104 MB,
# test/push-phone.py's relay built again from nothing each run).
try:
    import pwd
    _ACCOUNT = pwd.getpwuid(os.getuid()).pw_dir
except (ImportError, KeyError):
    _ACCOUNT = os.path.expanduser("~")
_CACHE = os.environ.get("XDG_CACHE_HOME") or os.path.join(_ACCOUNT, ".cache")
ON_DISK = os.path.join(_CACHE, "amarchy-tests")     # the tests' own folder on disk, for what's big (temp_dir(..., homes.ON_DISK))
os.environ.setdefault("UV_CACHE_DIR", os.path.join(_CACHE, "uv"))
os.environ.setdefault("GOCACHE", os.path.join(_CACHE, "go-build"))
os.environ.setdefault("GOMODCACHE", os.path.join((os.environ.get("GOPATH") or os.path.join(_ACCOUNT, "go")).split(os.pathsep)[0],
                                                 "pkg", "mod"))


def descendants(pid=None):
    """The processes under this one, all the way down: [pid]."""
    pid = pid or os.getpid()
    out, seen, todo = [], {pid}, [pid]
    while todo:
        p = todo.pop(0)
        kids = []
        try:
            for t in os.listdir(f"/proc/{p}/task"):
                with open(f"/proc/{p}/task/{t}/children") as f:
                    kids += [int(k) for k in f.read().split()]
        except OSError:
            if p != os.getpid():
                continue
            try:        # no /proc (a Mac): pgrep says
                import subprocess
                kids = [int(k) for k in subprocess.run(["pgrep", "-P", str(p)], capture_output=True, text=True).stdout.split()]
            except (OSError, ValueError):
                kids = []
        for k in kids:
            if k not in seen:
                seen.add(k)
                out.append(k)
                todo.append(k)
    return out


def _alive(pid):
    try:
        with open(f"/proc/{pid}/stat") as f:
            stat = f.read()
        return stat[stat.rindex(")") + 2:stat.rindex(")") + 3] != "Z"
    except (OSError, ValueError):
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False


def _ancestors():
    out, p = {os.getpid()}, os.getpid()
    for _ in range(64):
        try:
            with open(f"/proc/{p}/stat") as f:
                stat = f.read()
            p = int(stat[stat.rindex(")") + 2:].split()[1])
        except (OSError, ValueError, IndexError):
            break
        if p <= 1 or p in out:
            break
        out.add(p)
    return out


def running_in(dirs):
    """Processes of yours still running from one of dirs, though not under
    the test: their folder in it, or its path in their command (a tmux
    server and its chats' shells, a job started apart). Only where there's
    /proc."""
    dirs = [str(d) for d in dirs]
    if not dirs or not os.path.isdir("/proc"):
        return []
    skip, out = _ancestors(), []
    for p in os.listdir("/proc"):
        if not p.isdigit() or int(p) in skip:
            continue
        try:
            if os.stat(f"/proc/{p}").st_uid != os.getuid():
                continue
            with open(f"/proc/{p}/cmdline", "rb") as f:
                cmd = f.read().decode(errors="replace").replace("\0", " ")
        except OSError:
            continue
        try:
            cwd = os.readlink(f"/proc/{p}/cwd")
        except OSError:
            cwd = ""
        if any(d in cmd or cwd == d or cwd.startswith((d + "/", d + " ")) for d in dirs):
            out.append(int(p))
    return out


def stop_all(dirs=()):
    """Stop what the test started and left running, and whatever still runs
    from its folders: asked first, then made to."""
    left = list(dict.fromkeys(descendants() + running_in(dirs)))
    if not left:
        return
    for p in left:
        try:
            os.kill(p, signal.SIGTERM)
        except OSError:
            pass
    for _ in range(30):
        left = [p for p in left if _alive(p)]
        if not left:
            return
        time.sleep(0.1)
    for p in left:
        try:
            os.kill(p, signal.SIGKILL)
        except OSError:
            pass
    for _ in range(10):
        left = [p for p in left if _alive(p)]
        if not left:
            return
        time.sleep(0.05)


def _writable(func, path, exc):
    """A folder that's read-only (Go's module cache): made writable, then again."""
    try:
        os.chmod(os.path.dirname(path), 0o700)
        if os.path.isdir(path) and not os.path.islink(path):
            os.chmod(path, 0o700)
        func(path)
    except OSError:
        pass


def _remove(d):
    for i in range(5):
        if sys.version_info >= (3, 12):
            shutil.rmtree(d, onexc=_writable)
        else:
            shutil.rmtree(d, onerror=_writable)
        if not os.path.lexists(d):
            return
        time.sleep(0.1 * (i + 1))      # something still writing in it, a moment ago
    print(f"couldn't remove the test's {d}", file=sys.stderr)


def clean_up():
    """What the test made goes (atexit runs it; a test may call it sooner)."""
    while _done:
        fn = _done.pop()
        try:
            fn()
        except Exception as e:
            print(f"a test's clean-up failed: {e}", file=sys.stderr)
    stop_all(_made + _kept)     # kept or not: nothing of the test runs on
    if os.environ.get("KEEP_TEST_HOMES"):
        for d in _made:
            if os.path.exists(d):
                print(f"kept (KEEP_TEST_HOMES): {d}", file=sys.stderr)
        return
    while _made:
        _remove(_made.pop())


def sweep():
    """Folders a test left over a day ago (its mark in them, or a home named
    as the tests named theirs before), where the tests make them."""
    places = {tempfile.gettempdir(), "/tmp", ON_DISK}
    for place in places:
        try:
            names = os.listdir(place)
        except OSError:
            continue
        for name in names:
            if not MADE_NAME.fullmatch(name):
                continue
            m = HOME_NAME.fullmatch(name)
            d = os.path.join(place, name)
            try:
                st = os.lstat(d)
                if not os.path.isdir(d) or os.path.islink(d) or time.time() - st.st_mtime < STALE \
                        or hasattr(os, "getuid") and st.st_uid != os.getuid():
                    continue
                if not (m and m.group(1) in LEGACY) and not os.path.exists(os.path.join(d, MARK)):
                    continue
            except OSError:
                continue
            _remove(d)


def _stopped(signum, frame):
    print(f"\n{signal.Signals(signum).name}: stopping the test and removing its home", file=sys.stderr)
    raise SystemExit(128 + signum)      # finally blocks, then atexit's clean_up


def _hook():
    global _hooked
    if _hooked:
        return
    _hooked = True
    atexit.register(clean_up)
    # Ctrl-C is a KeyboardInterrupt already; a kill or a closed terminal ends
    # it the same way (else Python stops on the spot, its atexit never run).
    if threading.current_thread() is threading.main_thread():
        for sig in filter(None, (getattr(signal, n, None) for n in ("SIGTERM", "SIGHUP"))):
            if signal.getsignal(sig) == signal.SIG_DFL:
                signal.signal(sig, _stopped)
    if not os.environ.get("KEEP_TEST_HOMES"):
        sweep()


_hook()     # imported: a kill ends the test as an exit does, from now on


def temp_dir(prefix, dir=None):
    """A folder of the test's own in $TMPDIR (or dir): mkdtemp's, gone at the end."""
    _hook()
    if dir:
        os.makedirs(dir, exist_ok=True)
    d = tempfile.mkdtemp(prefix=prefix, dir=dir)
    _made.append(d)
    with open(os.path.join(d, MARK), "w") as f:
        f.write(f"{os.getpid()} {' '.join(sys.argv)}\n")
    return d


def home(name, dir=None):
    """A test's home: $TMPDIR/<name>-home-XXXXXXXX, gone at the end."""
    return temp_dir(f"{name}-home-", dir)


def keep(d):
    """d stays, with what's in it (a failed run's, to look at): only the
    sweep takes it, a day on. What the test started is stopped all the same."""
    d = str(d)
    if d in _made:
        _made.remove(d)
        _kept.append(d)
        print(f"kept: {d}", file=sys.stderr)


def when_done(fn):
    """Something to do at the end, before the processes are stopped and the
    homes go (stopping a tmux server: it isn't under the test)."""
    _hook()
    _done.append(fn)
