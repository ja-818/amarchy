# The desktop app itself, as its real window runs (WebKitGTK, under Xvfb):
# what it opens (the contract's order: --url, this machine's amarchy when it
# has chats, a paired machine, the address kept by hand, one found on the
# tailnet: paired, or asked which), its own page when there's nothing to
# open or it didn't load (Try again, an address typed in), a chat's link
# handed to the running one, closing to the tray and coming back, the page
# knowing it's the app, what it may and may not do (the microphone yes,
# notifications and the shell's own commands no), its window size kept.
#
#   python3 desktop/test/shell-test.py          exits 0 when every check passed
#
# Needs the app built for tests (cargo build --features test-hooks, in
# desktop/), Xvfb, xdotool, dbus-daemon. Its app servers have homes of their
# own; amarchy's CLI is this checkout's (on a test home) or a made-up one,
# never the machine's, so nothing here pairs with a real machine.

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from shell import ROOT, Shell, need  # noqa: E402

# Its homes (each with a web view's data) in one folder, gone at the end:
# under ~/.cache unless TMPDIR says (a server's /tmp can be small).
if not os.environ.get("TMPDIR"):
    tempfile.tempdir = str(Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "amarchy-tests")
    os.makedirs(tempfile.tempdir, exist_ok=True)
tempfile.tempdir = tempfile.mkdtemp(prefix="desktop-shell-test-")
SHOTS = Path(os.environ.get("SHOTS") or tempfile.mkdtemp(prefix="shots-"))
SHOTS.mkdir(parents=True, exist_ok=True)
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


class Server:
    """desktop/test/server.py on a port of its own."""

    def __init__(self, *flags, home=None, port=None):
        self.port = port or free_port()
        self.home = home or tempfile.mkdtemp(prefix="desktop-srv-")
        self.proc = subprocess.Popen([sys.executable, str(Path(__file__).parent / "server.py"), str(self.port), self.home, *flags],
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        line = self.proc.stdout.readline()
        if not line.startswith("listening"):
            raise RuntimeError(f"the test server didn't start: {self.proc.stderr.read()[-800:]}")
        self.url = f"http://127.0.0.1:{self.port}/"
        self.lines = []
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for line in self.proc.stdout:
            self.lines.append(line.rstrip("\n"))

    def acted(self, path, timeout=15):
        """What a button sent to path: (its Origin, its body), or None."""
        end = time.time() + timeout
        while time.time() < end:
            for line in self.lines:
                parts = line.split(" ", 3)
                if parts[0] == "acted" and parts[1] == path:
                    return parts[2], json.loads(parts[3])
            time.sleep(0.1)
        return None

    def notice(self, payload, desktop=None):
        """A notification, as this server sends one (push_all)."""
        req = urllib.request.Request(self.url + "__test/notice", data=json.dumps({"payload": payload, "desktop": desktop}).encode(),
                                     method="POST", headers={"Content-Type": "application/json"})
        return json.loads(urllib.request.urlopen(req, timeout=10).read())["sent"]

    def stop(self):
        self.proc.terminate()
        self.proc.wait()
        subprocess.run(["tmux", "-L", "amarchy", "kill-server"], env={**os.environ, "TMUX_TMPDIR": self.home + "/tmux"},
                       capture_output=True)


def fake_cli(home, found=(), machines=None, fail_found=None):
    """A made-up amarchy CLI: what `machines found` finds, `machines --json`
    (this machine, then what `machines add` paired), no chats. What it was
    asked is logged beside it."""
    d = Path(home) / "fakebin"
    d.mkdir(parents=True, exist_ok=True)
    state = d / "machines.json"
    state.write_text(json.dumps(machines or [{"name": "desk", "label": "desk", "me": True, "state": "on"}]))
    (d / "found.json").write_text(json.dumps(list(found)))
    script = d / "amarchy"
    script.write_text(f"""#!/usr/bin/env python3
import json, sys
from pathlib import Path
d = Path({str(d)!r})
with open(d / "asked.log", "a") as f:
    f.write(" ".join(sys.argv[1:]) + "\\n")
a = sys.argv[1:]
if a[:2] == ["list", "--compact"]:
    print("[]")
elif a == ["machines", "--json"]:
    print((d / "machines.json").read_text())
elif a[:2] == ["machines", "found"]:
    {"print(" + repr(fail_found) + ", file=sys.stderr); sys.exit(1)" if fail_found else "print((d / 'found.json').read_text())"}
elif a[:2] == ["machines", "add"]:
    found = json.loads((d / "found.json").read_text())
    m = next((m for m in found if m["name"] == a[2]), None)
    if not m:
        print("no such machine", file=sys.stderr); sys.exit(1)
    rows = json.loads((d / "machines.json").read_text())
    rows.append({{"name": m["name"], "label": m.get("label") or m["name"], "url": m["url"], "me": False, "state": "on"}})
    (d / "machines.json").write_text(json.dumps(rows))
    print("paired with " + m["name"])
else:
    print("not in the test: " + " ".join(a), file=sys.stderr); sys.exit(2)
""")
    script.chmod(0o755)
    return script


def asked(cli):
    try:
        return (Path(cli).parent / "asked.log").read_text().splitlines()
    except OSError:
        return []


# This checkout's CLI on a test home, but never the tailnet: discovery and
# pairing refused (the home has its own machines, never the real ones).
def real_cli(home):
    d = Path(home) / "realbin"
    d.mkdir(parents=True, exist_ok=True)
    script = d / "amarchy"
    script.write_text(f"""#!/bin/sh
case "$1 $2" in "machines found"|"machines add") echo "not in a test" >&2; exit 3;; esac
exec python3 {ROOT / "bin/amarchy"} "$@"
""")
    script.chmod(0o755)
    return script


def env_for(cli):
    # Not the machine's own amarchy: PATH without ~/.local/bin.
    path = ":".join(p for p in os.environ.get("PATH", "").split(":") if ".local/bin" not in p and "amarchy" not in p)
    return {"AMARCHY_CLI": str(cli), "PATH": path, "AMARCHY_URL": ""}


def brightness(f):
    """How light a screenshot is, 0 (black) to 1 (white): ImageMagick 7's
    magick, or 6's convert."""
    tool = ["magick"] if shutil.which("magick") else ["convert"]
    out = subprocess.run([*tool, str(f), "-format", "%[fx:mean]", "info:"], capture_output=True, text=True).stdout
    return float(out or 1)


def listening(server, w, timeout=40):
    """Once the app's stream of notices is up: a notice sent reaches it."""
    end = time.time() + timeout
    while time.time() < end:
        if server.notice({"title": "warm-up", "body": "", "tag": "warm"}) and w.note(lambda n: n["summary"] == "warm-up", 2):
            return True
        time.sleep(0.3)
    raise TimeoutError("the desktop app never listened for notices")


def on_app(w, timeout=30):
    return w.wait("!!document.querySelector('#look') && typeof app !== 'undefined' && !!app.view", timeout=timeout)


def own_page(w, kind, timeout=20):
    """The window's own page, showing kind (its title says which)."""
    titles = {"nothing": "Can't find", "failed": "Can't reach", "choose": "Which amarchy?", "opening": "Opening"}
    return w.wait(f"location.protocol === 'tauri:' && document.getElementById('title').textContent.startsWith({json.dumps(titles[kind])})",
                  timeout=timeout)


def main():
    need("Xvfb", "xdotool", "dbus-daemon", "import")
    remote = Server()
    try:
        # ---- --url: that one. The page knows it's the app; the app's
        # own notifications are off; the shell's commands aren't its.
        print("an address given (--url)")
        home = tempfile.mkdtemp(prefix="desktop-home-")
        with Shell(remote.url, home=home, env=env_for(fake_cli(home))) as w:
            # While it loads: the app's look, never WebKit's white.
            frames = []
            for i in range(4):
                f = w.shot(SHOTS / f"start-{i}.png")
                frames.append(brightness(f))
                time.sleep(0.3)
            check(max(frames) < 0.5, f"no white flash while it opens (brightness {[round(x, 2) for x in frames]})")
            on_app(w)
            check(w.do("url").startswith(remote.url), f"it opens the address given ({w.do('url')})")
            d = w.js("window.amarchyDesktop")
            check(isinstance(d, dict) and d.get("platform") == "linux" and bool(d.get("version")), f"the page knows it's the desktop app ({d})")
            check(" Amarchy/" in w.js("navigator.userAgent"), "its user agent says Amarchy/<version>")
            check(w.js("return await Notification.requestPermission();") == "denied", "the app's own browser notifications: denied")
            r = w.js("try { await window.__TAURI_INTERNALS__.invoke('status'); return 'allowed'; } catch (e) { return 'refused: ' + e; }")
            check(isinstance(r, str) and r.startswith("refused"), f"amarchy's page can't call the shell's commands ({r})")
            w.shot(SHOTS / "url-board.png")
            w.js("openSettings(); 1")
            said = w.wait("[...document.querySelectorAll('.sheet p')].map(p => p.textContent).find(t => t.includes('desktop app')) || ''")
            check("next update" in said or "tells you" in said, f"Settings → Notifications speaks of the desktop app's own ({said[:80]})")
            w.shot(SHOTS / "url-settings.png")
            w.key("Escape")

            # A chat's link, from a second start: the running one opens it.
            code, said = w.again("amarchy://chat/127/desk-long")
            check(code == 0, f"a second start ends at once, handing its link over ({code} {said.strip()[:200]})")
            check(bool(w.wait("location.hash === '#/s/desk-long'")), "the running window goes to that chat")
            w.wait("document.querySelectorAll('.msg').length > 10")
            w.shot(SHOTS / "url-link.png")

            # Closed: into the tray, still running; started again: back.
            w.do("close")
            time.sleep(0.8)
            check(w.do("visible") is False and w.proc.poll() is None, "closing the window keeps the app (hidden, in the tray)")
            code, _ = w.again()
            time.sleep(0.8)
            check(code == 0 and w.do("visible") is True, "started again, its window comes back")
            check(w.do("url").startswith(remote.url), "on the same page as it was")

            # An update (install.sh): started again on the new build, where it was.
            w.js("location.hash = '#/s/desk-long'; 1")
            time.sleep(0.5)
            old = w.proc.pid
            code, _ = w.again("--restart")
            back = w.wait("location.hash === '#/s/desk-long' && typeof app !== 'undefined' && !!app.view", timeout=40)
            ended = not Path(f"/proc/{old}").exists() or Path(f"/proc/{old}/cmdline").read_bytes() == b""     # gone, or a zombie
            check(code == 0 and ended, "--restart: the running one ends")
            check(bool(back) and w.do("visible") is True, "and starts again, on the chat it was on")
            w.do("close")
            time.sleep(0.5)
            w.again("--restart")
            time.sleep(4)
            check(w.do("visible", timeout=40) is False, "a hidden one starts again hidden (in the tray)")
            w.again()
            time.sleep(0.8)

            # A link out: your browser, not this window.
            w.js("location.href = 'https://example.com/elsewhere'; 1")
            time.sleep(1)
            check(w.do("url").startswith(remote.url), "a page elsewhere isn't opened in the window (it's the browser's)")

        # ---- this machine's amarchy, with chats: through the local key.
        print("this machine's amarchy, with chats")
        local = Server("--local")
        try:
            cli = real_cli(local.home)
            with Shell(None, home=local.home, env=env_for(cli)) as w:
                on_app(w)
                url = w.do("url")
                check(url.startswith(local.url), f"it opens this machine's amarchy on 127.0.0.1 ({url})")
                check("key=" not in url, "the key isn't left in the address")
                check(len(w.js("app.view.sessions")) == 2, "its chats are there")
                w.shot(SHOTS / "local-board.png")
                # A link to one of its chats, by this machine's name.
                me = json.loads(subprocess.run([str(cli), "machines", "--json"], capture_output=True, text=True,
                                               env={**os.environ, "HOME": local.home, "XDG_STATE_HOME": local.home + "/.local/state",
                                                    "XDG_CONFIG_HOME": local.home + "/.config"}).stdout)[0]["name"]
                w.again(f"amarchy://chat/{me}/desk-term")
                check(bool(w.wait("location.hash === '#/s/desk-term'")), f"a link to this machine's chat ({me}) opens it")
                # A link to another machine's chat: its <machine>:<id> route
                # (what the app does with it is the app's: it may not know it).
                w.js("window.__routes = []; addEventListener('hashchange', (e) => __routes.push(new URL(e.newURL).hash)); 1")
                w.again("amarchy://chat/elsewhere/web-fix")
                check(bool(w.wait("__routes.includes('#/s/elsewhere:web-fix')")), "a link to another machine's chat: its <machine>:<id> route")
        finally:
            local.stop()

        # ---- this machine's amarchy with no chats: the address kept by hand.
        print("this machine's amarchy, no chats: the address kept by hand")
        empty = Server("--local", "--no-chats")
        try:
            Path(empty.home, ".config/amarchy").mkdir(parents=True, exist_ok=True)
            Path(empty.home, ".config/amarchy/desktop.json").write_text(json.dumps({"server": remote.url}))
            with Shell(None, home=empty.home, env=env_for(real_cli(empty.home))) as w:
                on_app(w)
                check(w.do("url").startswith(remote.url), f"an amarchy with nothing on its board isn't opened: the server is ({w.do('url')})")
        finally:
            empty.stop()

        # ---- a paired machine that's on (this one has no chats).
        print("a paired machine")
        home = tempfile.mkdtemp(prefix="desktop-home-")
        cli = fake_cli(home, machines=[{"name": "desk", "me": True, "state": "on"},
                                       {"name": "srv", "label": "Server", "url": remote.url, "me": False, "state": "on"}])
        with Shell(None, home=home, env=env_for(cli)) as w:
            on_app(w)
            check(w.do("url").startswith(remote.url), "the first paired machine that's on")
            check(not any(a.startswith("machines found") for a in asked(cli)), "nothing looked for on the tailnet")

        # ---- found on the tailnet: one, paired and opened, said once.
        print("one found on the tailnet")
        home = tempfile.mkdtemp(prefix="desktop-home-")
        cli = fake_cli(home, found=[{"name": "srv", "label": "Server", "url": remote.url, "version": "x"}])
        with Shell(None, home=home, env=env_for(cli)) as w:
            # Watched from the start: it shows for a few seconds once the app is up.
            said = w.wait("[...document.querySelectorAll('.toast')].map(e => e.textContent).join(' ').includes('Paired with Server')",
                          timeout=40, every=0.05)
            check(bool(said), "the window says so once (Paired with Server.)")
            on_app(w)
            check(w.do("url").startswith(remote.url), "the one found is opened")
            check("machines add srv" in asked(cli), f"and paired with ({asked(cli)})")
            w.shot(SHOTS / "found-one.png")

        # ---- several: asked which, once.
        print("several found")
        home = tempfile.mkdtemp(prefix="desktop-home-")
        cli = fake_cli(home, found=[{"name": "srv", "label": "Server", "url": remote.url, "version": "x"},
                                    {"name": "lab", "label": "Lab box", "url": "http://127.0.0.1:9/", "version": "x"}])
        with Shell(None, home=home, env=env_for(cli)) as w:
            own_page(w, "choose")
            names = w.js("[...document.querySelectorAll('.machine span')].map(e => e.textContent)")
            check(names == ["Server", "Lab box"], f"its page lists them ({names})")
            w.shot(SHOTS / "found-several.png")
            w.click_el(".machine")
            on_app(w)
            check(w.do("url").startswith(remote.url) and "machines add srv" in asked(cli), "the one picked is paired with and opened")

        # ---- nothing: why, an address typed in (kept), Try again.
        print("nothing found")
        home = tempfile.mkdtemp(prefix="desktop-home-")
        cli = fake_cli(home)
        with Shell(None, home=home, env=env_for(cli), size=(390, 844)) as w:
            own_page(w, "nothing")
            check("No amarchy of yours answers" in w.js("document.getElementById('why').textContent"), "it says why")
            w.shot(SHOTS / "nothing-phone.png")
            w.click_el("#addr")
            w.type(remote.url)
            w.key("Return")
            on_app(w)
            check(w.do("url").startswith(remote.url), "an address typed in is opened")
            kept = json.loads(Path(home, ".config/amarchy/desktop.json").read_text())
            check(kept.get("server") == remote.url, f"and kept ({kept})")

        # ---- it doesn't load: why, then Try again once it's back.
        print("a server that doesn't answer")
        home = tempfile.mkdtemp(prefix="desktop-home-")
        port = free_port()
        with Shell(f"http://127.0.0.1:{port}/", home=home, env=env_for(fake_cli(home))) as w:
            own_page(w, "failed")
            check(f"127.0.0.1" in w.js("document.getElementById('title').textContent"), "its page says which can't be reached")
            w.shot(SHOTS / "failed-wide.png")
            back = Server(port=port)
            try:
                w.click_el("#retry")
                on_app(w)
                check(w.do("url").startswith(back.url), "Try again, once it answers: the app")
            finally:
                back.stop()

        # ---- no amarchy on this computer at all.
        print("no amarchy here")
        home = tempfile.mkdtemp(prefix="desktop-home-")
        with Shell(None, home=home, env={**env_for(Path(home) / "none"), "AMARCHY_CLI": str(Path(home) / "none")}) as w:
            own_page(w, "nothing")
            check("isn't installed" in w.js("document.getElementById('why').textContent"), "it says amarchy isn't installed here")

        # ---- its notifications: what the server sends, shown natively with
        # its buttons, a button done as the page would, a click on the chat;
        # window closed too; a chime; a tag replaces; back after a restart.
        print("its notifications")
        home = tempfile.mkdtemp(prefix="desktop-home-")
        allow = [{"label": "Allow", "path": "/api/session/desk-term/answer", "body": {"request_id": "r1", "choice": "allow"}},
                 {"label": "Deny", "path": "/api/session/desk-term/answer", "body": {"request_id": "r1", "choice": "deny"}}]
        with Shell(remote.url, home=home, env=env_for(fake_cli(home)), notifyd=True) as w:
            on_app(w)
            w.js("window.__rang = []; const p = playSound; playSound = (src, o) => { __rang.push(src); return p(src, o); }; 1")
            listening(remote, w)
            sent = remote.notice({"title": "Term: a real terminal", "body": "Claude wants to run ls\nDesk", "tag": "desk-term",
                                  "url": "/#/s/desk-term", "ask": "desk-term", "waiting": 1},
                                 {"session": "desk-term", "sound": "kalimba", "actions": allow})
            check(sent >= 1, f"the server counts the desktop app as a device notified ({sent})")
            n = w.note(lambda n: n["summary"] == "Term: a real terminal")
            check(bool(n) and n["body"].startswith("Claude wants to run ls"), "a chat that needs you: a notification on the desktop")
            if n:
                check(n["actions"] == ["default", "Open", "a0", "Allow", "a1", "Deny"], f"with its buttons: Allow, Deny ({n['actions']})")
                check(n["app"] == "Amarchy" and n["hints"].get("desktop-entry") == "amarchy", "as Amarchy (its launcher entry, its icon)")
                check(bool(w.wait("__rang.includes('/sound/kalimba')", timeout=5)), "the chat's chime rings (the app's own sound)")
                w.press(n["id"], "a0")
                got = remote.acted("/api/session/desk-term/answer")
                check(got is not None and got[1] == {"request_id": "r1", "choice": "allow"}, f"Allow: answered as the page answers it ({got})")
                check(got is not None and got[0] == remote.url.rstrip("/"), "from the app's own origin")
            # Window closed: still told; a click opens the window on the chat, at its card.
            w.do("close")
            time.sleep(0.5)
            remote.notice({"title": "Long: a chat with 120 turns", "body": "Done: it works", "tag": "desk-long", "url": "/#/s/desk-long"},
                          {"session": "desk-long", "sound": "kalimba", "actions": []})
            n2 = w.note(lambda n: n["summary"] == "Long: a chat with 120 turns")
            check(bool(n2) and w.do("visible") is False, "its window closed, the notification still comes")
            if n2:
                w.press(n2["id"], "default")
                check(bool(w.wait("location.hash === '#/s/desk-long'")) and w.do("visible") is True, "clicked: the window, on that chat")
            # The same chat again: in place of the one before.
            remote.notice({"title": "Term again", "body": "x", "tag": "desk-term"}, {"session": "desk-term"})
            remote.notice({"title": "Term once more", "body": "y", "tag": "desk-term"}, {"session": "desk-term"})
            a = w.note(lambda n: n["summary"] == "Term again")
            b = w.note(lambda n: n["summary"] == "Term once more")
            check(bool(a and b) and b["replaces"] == a["id"], "a chat's next notification takes the place of its last")
            w.shot(SHOTS / "notified.png")
        # This machine's amarchy: its notices and buttons with the local cookie.
        local = Server("--local")
        try:
            with Shell(None, home=local.home, env=env_for(real_cli(local.home)), notifyd=True) as w:
                on_app(w)
                listening(local, w)
                local.notice({"title": "Local asks", "body": "Allow it?", "tag": "desk-term"}, {"session": "desk-term", "actions": allow})
                n = w.note(lambda n: n["summary"] == "Local asks")
                check(bool(n), "this machine's amarchy: its notifications come too (the local cookie)")
                if n:
                    w.press(n["id"], "a1")
                    got = local.acted("/api/session/desk-term/answer")
                    check(got is not None and got[1]["choice"] == "deny" and got[0] == local.url.rstrip("/"),
                          f"and its buttons answer, let in by the cookie ({got})")
                # The server restarted (a ship): what came meanwhile still comes.
                port, lhome = local.port, local.home
                local.stop()
                env = {**os.environ, "HOME": lhome, "XDG_STATE_HOME": lhome + "/.local/state", "XDG_CONFIG_HOME": lhome + "/.config"}
                subprocess.run([sys.executable, "-c", "import importlib.machinery, importlib.util, sys; "
                                "l = importlib.machinery.SourceFileLoader('a', sys.argv[1]); m = importlib.util.module_from_spec("
                                "importlib.util.spec_from_loader('a', l)); l.exec_module(m); m.notice_put({'title': 'While away', 'body': 'z'})",
                                str(ROOT / "bin/amarchy")], env=env, check=True)
                local = Server("--local", home=lhome, port=port)
                check(bool(w.note(lambda n: n["summary"] == "While away", 40)), "the server restarted: a notice sent meanwhile still comes")
        finally:
            local.stop()

        # ---- the window's size, kept.
        print("its window")
        home = tempfile.mkdtemp(prefix="desktop-home-")
        with Shell(remote.url, home=home, env=env_for(fake_cli(home)), size=(1400, 900)) as w:
            on_app(w)
            w.resize(1000, 700)
            time.sleep(0.5)
            w.do("close")
            time.sleep(0.5)
        with Shell(remote.url, home=home, env=env_for(fake_cli(home)), size=(1400, 900), sized=False) as w:
            on_app(w)
            size = w.do("size")
            check(size == [1000, 700], f"its size is kept from last time ({size})")
    finally:
        remote.stop()

    print(f"screenshots: {SHOTS}")
    if not os.environ.get("KEEP"):
        for d in Path(tempfile.tempdir).iterdir():
            if d != SHOTS:
                shutil.rmtree(d, ignore_errors=True)
        try:
            os.rmdir(tempfile.tempdir)      # unless the screenshots are in it
        except OSError:
            pass
    if failed:
        print(f"{len(failed)} failed")
        sys.exit(1)
    print("all passed")


if __name__ == "__main__":
    main()
