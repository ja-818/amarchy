# The desktop app itself, as its real window runs (WebKitGTK, under Xvfb):
# what it opens (the contract's order: --url, this machine's amarchy when it
# has chats, a paired machine, the address kept by hand, one found on the
# tailnet: paired, or asked which), its own page when there's nothing to
# open or it didn't load (Try again, an address typed in), a chat's link
# handed to the running one, closing to the tray and coming back, the page
# knowing it's the app (and on an Omarchy desktop: see-through, the desktop's
# wallpaper through it when it wears the desktop's look live), what it may and may not do (the microphone yes,
# notifications and the shell's own commands no), its window size kept.
#
#   python3 desktop/test/shell-test.py          exits 0 when every check passed
#
# Needs the app built for tests (cargo build --features test-hooks, in
# desktop/), Xvfb, xdotool, dbus-daemon (and picom, to see a see-through window
# on a desktop: those checks are skipped without it). Its app servers have homes of their
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
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from shell import BIN, ROOT, Shell, need  # noqa: E402

# Its homes (each with a web view's data) in one folder, gone at the end:
# under ~/.cache unless TMPDIR says (a server's /tmp can be small).
if not os.environ.get("TMPDIR"):
    tempfile.tempdir = str(Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "amarchy-tests")
    os.makedirs(tempfile.tempdir, exist_ok=True)
tempfile.tempdir = tempfile.mkdtemp(prefix="desktop-shell-test-")
SHOTS = Path(os.environ.get("SHOTS") or tempfile.mkdtemp(prefix="shots-"))
SHOTS.mkdir(parents=True, exist_ok=True)
failed = []


def pipes(pid):
    """The pipes a process has open (their inodes)."""
    out = set()
    for f in Path(f"/proc/{pid}/fd").iterdir():
        try:
            link = os.readlink(f)
        except OSError:
            continue
        if link.startswith("pipe:"):
            out.add(link)
    return out


def own_pipes(pid):
    """Its pipes that aren't the test's (its stdin and stdout are)."""
    return pipes(pid) - pipes(os.getpid())


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


def wait_for(test, timeout=30, every=0.3):
    """test()'s first true value within timeout, else None."""
    end = time.time() + timeout
    while time.time() < end:
        v = test()
        if v:
            return v
        time.sleep(every)
    return None


CHAT_OPEN = ("!!app.session && !!document.querySelector('.chat-head')"
             " && [...document.querySelectorAll('.chat-head')].some((e) => e.offsetParent !== null)")


def opens_chats(w, server, how):
    """On the board, a chat opens: by a click on its card, and by the keys
    (j to its card, Enter); what's written in it is sent (Julian's M5: no
    chat opened, by either). how: when (after a restart...)."""
    def board():
        w.js("location.hash = '#/'; 1")
        return w.wait("!app.session && !!document.querySelector('.tcard[data-id] .today-go')", timeout=20)
    board()
    w.click_el(".tcard[data-id] .today-go")
    check(bool(w.wait(CHAT_OPEN, timeout=20)), f"{how}: a click on a chat opens it")
    board()
    w.js("document.activeElement && document.activeElement.blur(); 1")
    for _ in range(8):
        w.key("j")
        time.sleep(0.25)
        if w.js("!!document.activeElement && document.activeElement.matches('.today-go') && !!document.activeElement.closest('.tcard[data-id]')"):
            break
    w.key("Return")
    check(bool(w.wait(CHAT_OPEN, timeout=20)), f"{how}: j to a chat and Enter open it too")
    sid = w.js("app.session.id")
    # Its address there already, the board shown (the view didn't follow
    # it): a click on it opens it all the same.
    board()
    w.js(f"history.replaceState(history.state, '', '#/s/' + encodeURIComponent({json.dumps(sid)})); 1")
    w.click_el(f".tcard[data-id={json.dumps(sid)}] .today-go")
    check(bool(w.wait(CHAT_OPEN, timeout=20)), f"{how}: a chat whose address is there already opens too")
    words = f"sent from the window, {how}"
    w.js(f"const t = app.session.chat.input; t.focus(); t.value = {json.dumps(words)}; t.dispatchEvent(new Event('input')); 1")
    w.click_el(".cbtn.send")
    got = wait_for(lambda: any(l.startswith(f"acted /api/session/{sid}/send ") and words in l for l in server.lines), timeout=15)
    check(bool(got), f"{how}: and what's written in it is sent")
    board()


def on_app(w, timeout=30):
    return w.wait("!!document.querySelector('#look') && typeof app !== 'undefined' && !!app.view", timeout=timeout)


def own_page(w, kind, timeout=20):
    """The window's own page, showing kind (its title says which)."""
    titles = {"nothing": "Can't find", "failed": "Can't reach", "choose": "Which amarchy?", "opening": "Opening",
              "signin": "Sign in to Tailscale"}
    return w.wait(f"location.protocol === 'tauri:' && document.getElementById('title').textContent.startsWith({json.dumps(titles[kind])})",
                  timeout=timeout)


class FakeProxy:
    """An HTTP proxy standing in for amarchy's own node's: it wants the
    node's credential, takes tailnet names (srv.tail-scale.ts.net) to this
    computer's test server, and writes down what came through it."""

    def __init__(self, routes):
        import base64
        import socketserver
        self.routes, self.seen = routes, []
        self.cred = "Basic " + base64.b64encode(b"amarchy:s3cret").decode()
        proxy = self

        class Handler(socketserver.StreamRequestHandler):
            # As the node's proxy reads them (tailnet/node/proxy.go): asked
            # for its credential (407), the same connection goes on; a
            # target naming nothing or the proxy itself means its Host header.
            def handle(self):
                buf = b""
                while True:
                    while b"\r\n\r\n" not in buf:
                        chunk = self.connection.recv(65536)
                        if not chunk:
                            return
                        buf += chunk
                    top, _, buf = buf.partition(b"\r\n\r\n")
                    lines = top.decode(errors="replace").split("\r\n")
                    method, target, version = lines[0].split(" ", 2)
                    hdr = {l.split(":", 1)[0].strip().lower(): l.split(":", 1)[1].strip() for l in lines[1:] if ":" in l}
                    keep = [l for l in lines[1:] if not l.lower().startswith(("proxy-authorization:", "proxy-connection:"))]
                    if hdr.get("proxy-authorization") != proxy.cred:
                        proxy.seen.append(("407", target))
                        self.connection.sendall(b"HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"amarchy\"\r\nContent-Length: 0\r\n\r\n")
                        continue
                    me = f"127.0.0.1:{proxy.port}"
                    if method == "CONNECT":
                        host = target
                    else:
                        u = urllib.parse.urlsplit(target)
                        host = u.netloc
                        target = (u.path or "/") + (f"?{u.query}" if u.query else "")
                    if not host or host == me:
                        host = hdr.get("host", "")
                        if host and ":" not in host:
                            host += ":443" if method == "CONNECT" else ":80"
                    to = proxy.routes.get(host)
                    proxy.seen.append((method, host + ("" if method == "CONNECT" else target)))
                    if not to:
                        self.connection.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                        return
                    up = socket.create_connection(to)
                    if method == "CONNECT":
                        self.connection.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                        if buf:
                            up.sendall(buf)
                    else:
                        up.sendall(f"{method} {target} {version}\r\n".encode() + "\r\n".join(keep).encode() + b"\r\n\r\n" + buf)
                    pump(self.connection, up)
                    return

        def pump(a, b):
            def one(x, y):
                try:
                    while True:
                        d = x.recv(65536)
                        if not d:
                            break
                        y.sendall(d)
                except OSError:
                    pass
                for s in (x, y):
                    try:
                        s.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass
            t = threading.Thread(target=one, args=(b, a), daemon=True)
            t.start()
            one(a, b)
            t.join(5)

        class Server(socketserver.ThreadingTCPServer):
            daemon_threads = True
            allow_reuse_address = True

        self.server = Server(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        self.url = f"http://amarchy:s3cret@127.0.0.1:{self.port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self):
        self.server.shutdown()


def fake_node(home, proxy_url, state="Running", flip_after_login=None):
    """amarchy's own Tailscale node, made up: its state folder (a socket,
    proxy.json), and an amarchy-tailnet that answers status and login (and,
    flip_after_login: on the tailnet that many seconds after a login)."""
    d = Path(home, ".local/state/amarchy/tailnet")
    d.mkdir(parents=True, exist_ok=True)
    (d / "tailscaled.sock").write_text("")
    (d / "proxy.json").write_text(json.dumps({"url": proxy_url}))
    (d / "fake.json").write_text(json.dumps({"state": state, "login_at": None, "flip": flip_after_login}))
    b = Path(home, ".local/bin")
    b.mkdir(parents=True, exist_ok=True)
    (b / "amarchy-tailnet").write_text(f"""#!/usr/bin/env python3
import json, sys, time
from pathlib import Path
f = Path({str(d / "fake.json")!r})
st = json.loads(f.read_text())
with open(f.with_name("asked.log"), "a") as log:
    log.write(" ".join(sys.argv[1:]) + "\\n")
if st["login_at"] and st["flip"] is not None and time.time() - st["login_at"] > st["flip"]:
    st["state"] = "Running"
if sys.argv[1:2] == ["status"]:
    words = "on your tailnet as desk" if st["state"] == "Running" else "waits for you to sign in to Tailscale"
    print(json.dumps({{"running": True, "state": st["state"], "words": words}}))
elif sys.argv[1:2] == ["login"]:
    st["login_at"] = time.time()
    f.write_text(json.dumps(st))
    print("https://login.tailscale.com/a/amarchytest")
""")
    (b / "amarchy-tailnet").chmod(0o755)
    return d


def fake_opener(home):
    """xdg-open, made up: what it was asked to open, written down."""
    b = Path(home, "openbin")
    b.mkdir(parents=True, exist_ok=True)
    (b / "xdg-open").write_text(f"#!/bin/sh\necho \"$@\" >> {b}/opened.log\n")
    (b / "xdg-open").chmod(0o755)
    return b


def desktop_behind(w, color):
    """A desktop behind the window, as Hyprland composes one: a window of one
    color under it, and a compositor (picom) blending what the window leaves
    see-through. None when there's no picom here (the checks that need it
    are skipped); else what stops them."""
    if not shutil.which("picom") or not shutil.which("display"):
        return None
    tool = ["magick"] if shutil.which("magick") else ["convert"]
    pic = Path(tempfile.mkdtemp(prefix="desktop-behind-")) / "desktop.png"
    subprocess.run([*tool, "-size", "1280x800", f"xc:{color}", str(pic)], check=True)
    behind = subprocess.Popen(["display", "-geometry", "1280x800+0+0", "-title", "desktop", str(pic)], env=w.env,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    comp = subprocess.Popen(["picom", "--backend", "xrender", "--no-fading-openclose"], env=w.env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    subprocess.run(["xdotool", "windowraise", str(w.window)], env=w.env)
    time.sleep(1)

    def stop():
        for p in (comp, behind):
            p.terminate()
            p.wait()
    return stop


def tint(f, box="300x120+100+600"):
    """How much bluer than red a part of a screenshot is (-1 to 1): the
    desktop behind, blue, showing through; the theme's wallpaper, orange,
    drawn; or neither."""
    tool = ["magick"] if shutil.which("magick") else ["convert"]
    out = subprocess.run([*tool, str(f), "-crop", box, "+repage", "-format", "%[fx:mean.b-mean.r]", "info:"],
                         capture_output=True, text=True).stdout
    return float(out or 0)


def omarchy_desktop(remote):
    """On an Omarchy desktop (Hyprland's session, Omarchy's current theme):
    the page is told so, and <html> marked before it's drawn, and the window
    is see-through. Wearing the desktop's look live, its page paints no
    wallpaper and nothing under it, so the desktop's own wallpaper shows
    through its panes as a browser shows the app's (seen under a compositor,
    picom, when it's here), the GPU's way and the safe way; Settings → Look
    says so; another theme keeps its wallpaper. Off Omarchy, the live look's
    wallpaper is drawn."""
    print("on an Omarchy desktop")
    # Omarchy (live) on the server, its wallpaper a loud orange: plain in a screenshot when it's drawn.
    live = Path(remote.home) / ".local/state/amarchy/app/custom/omarchy-live"
    live.mkdir(parents=True, exist_ok=True)
    tool = ["magick"] if shutil.which("magick") else ["convert"]
    for f in ("wallpaper.png", "wallpaper-wide.png"):
        subprocess.run([*tool, "-size", "64x64", "xc:#ff8800", str(live / f)], check=True)
    (live / "theme.json").write_text(json.dumps({
        "name": "Omarchy (live)", "mode": "dark", "vars": {"surface": "#121212", "text": "#bebebe", "accent": "#e68e0d"},
        "terminal": {}, "wallpaper": {"phone": "wallpaper.png", "wide": "wallpaper-wide.png"}, "font": None,
        "from": "matte-black on desk", "omarchy": {"theme": "matte-black", "machine": "desk"}}))

    def wear(w, look, surface):
        w.js(f"lookWorn(await api('/api/look', {json.dumps(look)})); return 1;")
        w.wait(f"getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() === {json.dumps(surface)}")
        time.sleep(0.5)
        return w.js("getComputedStyle(document.body, '::before').backgroundImage")

    under = "[getComputedStyle(document.documentElement).backgroundColor, getComputedStyle(document.body, '::before').backgroundColor]"
    clear = ["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]
    tokyo = "#1a1b26"
    try:
        home = tempfile.mkdtemp(prefix="desktop-home-")
        (Path(home) / ".local/state/omarchy/current/theme").mkdir(parents=True)
        with Shell(remote.url, home=home, env={**env_for(fake_cli(home)), "HYPRLAND_INSTANCE_SIGNATURE": "test"},
                   size=(1280, 800)) as w:
            on_app(w)
            d = w.js("window.amarchyDesktop")
            check(isinstance(d, dict) and d.get("omarchy") is True, f"the page knows it's on an Omarchy desktop ({d})")
            check(w.js("document.documentElement.classList.contains('on-omarchy')"), "<html> is marked on-omarchy")
            bg = wear(w, {"theme": "omarchy-live", "wallpaper": "theme"}, "#121212")
            check(bg == "none", f"wearing Omarchy (live): no wallpaper of its own, the desktop's behind it ({bg[:80]})")
            got = w.js(under)
            check(got == clear, f"and nothing painted under its panes ({got})")
            stop = desktop_behind(w, "#3050ff")
            if stop:
                time.sleep(3)       # past keep_background, which mustn't make it solid again
                shot = w.shot(SHOTS / "omarchy-live.png")
                t = tint(shot)
                check(t > 0.03, f"the desktop (blue) shows through the window, as a wallpaper through the app's panes ({t:.3f})")
                w.js("location.hash = '#/s/desk-long'; 1")
                time.sleep(2)
                t = tint(w.shot(SHOTS / "omarchy-live-chat.png"), "200x200+40+300")
                check(t > 0.03, f"and through a chat's ({t:.3f})")
                w.js("location.hash = '#/'; 1")
                stop()
            else:
                print("  (no picom here: the desktop through the window not looked at)")
            w.js("openLook(); 1")
            said = w.wait("[...document.querySelectorAll('.sheet p')].map(p => p.textContent).find(t => t.includes('your desktop')) || ''")
            check("seen through it" in said, f"Settings → Look says where its wallpaper is ({said[:90]})")
            w.key("Escape")
            bg = wear(w, {"theme": "tokyo-night", "wallpaper": "theme"}, tokyo)
            check(bg not in ("", "none"), f"another theme: its own wallpaper, drawn ({bg[:80]})")
            bg = wear(w, {"theme": "omarchy-live", "wallpaper": "none"}, "#121212")
            got = w.js(under)
            check(bg == "none" and got[1] not in ("", "rgba(0, 0, 0, 0)"), f"Omarchy (live) with no wallpaper: solid ({got})")
            w.js("lookWorn(await api('/api/look', {theme: 'omarchy-live', wallpaper: 'theme'})); return 1;")
            w.wait("getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() === '#121212'")
            w.do("close")
            time.sleep(0.5)
        # Drawn the safe way (after a crash; no GPU): see-through all the same.
        home = tempfile.mkdtemp(prefix="desktop-home-")
        (Path(home) / ".local/state/omarchy/current/theme").mkdir(parents=True)
        (Path(home) / ".local/state/amarchy/desktop").mkdir(parents=True)
        (Path(home) / ".local/state/amarchy/desktop/rendering.json").write_text('{"safe": true, "why": "a test"}')
        with Shell(remote.url, home=home, env={**env_for(fake_cli(home)), "HYPRLAND_INSTANCE_SIGNATURE": "test"}) as w:
            on_app(w)
            w.wait("getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() === '#121212'")
            stop = desktop_behind(w, "#3050ff")
            if stop:
                time.sleep(3)
                t = tint(w.shot(SHOTS / "omarchy-live-safe.png"))
                check(t > 0.03, f"drawn the safe way: the desktop shows through all the same ({t:.3f})")
                stop()
            w.do("close")
            time.sleep(0.5)
        home = tempfile.mkdtemp(prefix="desktop-home-")
        with Shell(remote.url, home=home, env={**env_for(fake_cli(home)), "HYPRLAND_INSTANCE_SIGNATURE": ""}) as w:
            on_app(w)
            w.wait("getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() === '#121212'")
            time.sleep(0.5)
            bg = w.js("getComputedStyle(document.body, '::before').backgroundImage")
            check(w.js("window.amarchyDesktop.omarchy") is False and "url(" in bg,
                  f"off Omarchy, Omarchy (live) draws its wallpaper ({bg[:80]})")
            w.shot(SHOTS / "omarchy-live-elsewhere.png")
            w.js("lookWorn(await api('/api/look', {theme: 'tokyo-night'})); return 1;")
    finally:
        shutil.rmtree(live, ignore_errors=True)       # the rest of the tests in amarchy's own look


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
            check(d.get("omarchy") is False and not w.js("document.documentElement.classList.contains('on-omarchy')"),
                  "off Omarchy, the page knows it isn't on an Omarchy desktop")
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
            logf = Path(home, ".local/state/amarchy/desktop/desktop.log")
            once = logf.read_text().count("graphics:"), logf.read_text().count("sound: GStreamer")
            code, said = w.again("amarchy://chat/127/desk-long")
            check(code == 0, f"a second start ends at once, handing its link over ({code} {said.strip()[:200]})")
            check(bool(w.wait("location.hash === '#/s/desk-long'")), "the running window goes to that chat")
            check(once == (1, 1) and (logf.read_text().count("graphics:"), logf.read_text().count("sound: GStreamer")) == once,
                  f"a start that hands over says nothing of graphics or GStreamer in the log (asks nothing) ({once})")
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
            theirs = own_pipes(old)
            code, _ = w.again("--restart")
            back = w.wait("location.hash === '#/s/desk-long' && typeof app !== 'undefined' && !!app.view", timeout=40)
            new = w.do("pid")
            kept = theirs & pipes(new)
            check(bool(theirs) and not kept, f"the new one holds none of the old one's pipes (its stderr's would fill and hang it) ({kept or 'none'})")
            ended = not Path(f"/proc/{old}").exists() or Path(f"/proc/{old}/cmdline").read_bytes() == b""     # gone, or a zombie
            check(code == 0 and ended, "--restart: the running one ends")
            check(bool(back) and w.do("visible") is True, "and starts again, on the chat it was on")
            opens_chats(w, remote, "after a restart (an update)")
            w.do("close")
            time.sleep(0.5)
            w.again("--restart")
            time.sleep(4)
            check(w.do("visible", timeout=40) is False, "a hidden one starts again hidden (in the tray)")
            w.again()
            time.sleep(0.8)

            # An update from a service (amarchy's own): no display. It hands
            # over before GTK starts (whose init would abort it).
            old = w.do("pid")
            bare = {k: v for k, v in w.env.items() if k not in ("DISPLAY", "WAYLAND_DISPLAY")}
            r = subprocess.run([str(BIN), "--restart"], env=bare, capture_output=True, text=True, timeout=15)
            back = w.wait("typeof app !== 'undefined' && !!app.view", timeout=40)
            check(r.returncode == 0 and "abort" not in (r.stdout + r.stderr).lower(),
                  f"--restart with no display: handed over, no abort (exit {r.returncode})")
            check(bool(back) and w.do("pid") not in (None, old) and w.do("visible") is True, "and it starts again all the same")
            alone = tempfile.mkdtemp(prefix="desktop-home-")
            r = subprocess.run([str(BIN), "--restart"], env={"HOME": alone, "PATH": "/usr/bin"}, capture_output=True,
                               text=True, timeout=15)
            shutil.rmtree(alone, ignore_errors=True)
            check(r.returncode == 0 and not r.stderr.strip(), f"none running, no display, no bus: nothing to do (exit {r.returncode})")

            # A link out: your browser, not this window.
            w.js("location.href = 'https://example.com/elsewhere'; 1")
            time.sleep(1)
            check(w.do("url").startswith(remote.url), "a page elsewhere isn't opened in the window (it's the browser's)")

        # ---- it heals itself: its log; a window gone, a crashed page, a
        # stuck window thread: a start always brings it back.
        print("it heals itself")
        home = tempfile.mkdtemp(prefix="desktop-home-")
        logf = Path(home, ".local/state/amarchy/desktop/desktop.log")
        rendering = Path(home, ".local/state/amarchy/desktop/rendering.json")
        # The safe way as the build before kept it, after any crash (a sound's, on Julian's M5): forgotten.
        rendering.parent.mkdir(parents=True, exist_ok=True)
        rendering.write_text(json.dumps({"safe": True, "why": "its page's process crashed"}))
        with Shell(remote.url, home=home, env=env_for(fake_cli(home))) as w:
            on_app(w)
            log = logf.read_text() if logf.exists() else ""
            check("amarchy-desktop" in log and " started (pid " in log and "graphics:" in log,
                  "its log, readable without a terminal (~/.local/state/amarchy/desktop/desktop.log)")
            check(not rendering.exists() and "drawing with the GPU again" in log and "drawing the safe way" not in log,
                  "the safe way an earlier build kept after any crash: forgotten (the GPU again)")
            check("sound: GStreamer" in log, "its log says what its page can play (GStreamer)")
            # What goes wrong in its page: a click whose handler throws, a
            # promise nothing caught, console.error; a picture that doesn't load isn't one.
            w.js("const b = document.createElement('button'); b.id = 'oops'; b.textContent = 'oops';"
                 " b.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:99999';"
                 " b.onclick = () => { missionsSheetNot(); }; document.body.append(b);"
                 " Promise.reject(new Error('nobody caught me')); console.error('said', {a: 1});"
                 " const i = new Image(); i.src = '/nothing-here.png'; document.body.append(i); 1")
            w.click_el("#oops")
            said = wait_for(lambda: "missionsSheetNot" in logf.read_text() and "nobody caught me" in logf.read_text(), timeout=10)
            log = logf.read_text()
            check(bool(said) and "page: error: ReferenceError: Can't find variable: missionsSheetNot" in log,
                  "a click whose handler throws: in its log, with where")
            check("page: a promise nothing caught: Error: nobody caught me" in log and 'page: console.error: said {"a":1}' in log,
                  "a promise nothing caught and console.error too")
            check("nothing-here.png" not in log, "a picture that doesn't load isn't the page's error")
            w.js("document.getElementById('oops').remove(); 1")
            w.do("destroy")
            time.sleep(0.5)
            check(w.do("visible") is None, "(its window destroyed)")
            code, _ = w.again()
            back = w.wait("typeof app !== 'undefined' && !!app.view", timeout=40)
            check(code == 0 and bool(back) and w.do("visible") is True, "its window gone: a start makes it again, on the app")
            # Its page's process crashes with no sign why: the page comes back;
            # twice in ten minutes, drawn the safe way from now on. (A sound's
            # crash, with GStreamer's words before it: sound-test.py.)
            def crash():
                web = [p for p in w.tree() if Path(f"/proc/{p}/comm").read_text().strip().startswith("WebKitWebProces")]
                for p in web:
                    os.kill(p, 9)       # as a crash ends it (JavaScriptCore catches a SIGSEGV of its own)
                time.sleep(1)
                return web, w.wait("typeof app !== 'undefined' && !!app.view", timeout=40)
            web, back = crash()
            check(bool(web) and bool(back), f"its page's process crashed ({len(web)}): the page comes back")
            check(not rendering.exists(), "once, with no sign why: still drawn with the GPU")
            check("its page's process crashed, with no sign why" in logf.read_text(), "the crash is in its log, with what it said last")
            web, back = crash()
            check(bool(web) and bool(back), "crashed again: the page comes back")
            check(rendering.exists() and json.loads(rendering.read_text()).get("safe") is True and "crashed twice" in logf.read_text(),
                  "twice in ten minutes: it draws the safe way from now on")
            # Its window's thread stuck: a start hands over and ends at once,
            # and the watchdog starts it again, on the app.
            old = w.do("pid")
            w.do("hang")
            t0 = time.time()
            code, _ = w.again()
            check(code == 0 and time.time() - t0 < 5, f"a start handed to a stuck one ends at once ({time.time() - t0:.1f}s)")
            new = None
            for _ in range(60):
                try:
                    new = w.do("pid", timeout=2)
                except TimeoutError:
                    new = None
                if new and new != old:
                    break
                time.sleep(0.5)
            back = w.wait("typeof app !== 'undefined' && !!app.view", timeout=40) if new and new != old else False
            check(bool(new) and new != old and bool(back) and w.do("visible") is True,
                  f"stuck: it starts again by itself, its window up (pid {old} → {new})")
            check("hasn't answered" in logf.read_text(), "and says so in its log")
            w.shot(SHOTS / "healed.png")

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
                # Its chats open, through the local key's cookie, as on Julian's M5; and after an update's restart.
                opens_chats(w, local, "this machine's board")
                w.again("--restart")
                w.wait("typeof app !== 'undefined' && !!app.view", timeout=40)
                opens_chats(w, local, "this machine's board, after a restart")
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
            on_app(w, timeout=60)
            # Said in the app's toast, once the app is up (kept on the page as amarchyDesktopSaid).
            try:
                said = w.wait("window.amarchyDesktopSaid || ''", timeout=60)
            except TimeoutError:
                said = f"nothing ({w.do('url')}, {w.js('document.title')})"
            check(said == "Paired with Server.", f"the window says so once ({said})")
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

        # ---- amarchy's own Tailscale node (a computer without the
        # system's): its sign-in in the window's own page, and the window,
        # its notices and its buttons reaching a server by its tailnet name
        # through the node's proxy.
        print("amarchy's own Tailscale node")
        tsnet_srv = Server("--address=srv.tail-scale.ts.net")
        proxy = FakeProxy({f"srv.tail-scale.ts.net:{tsnet_srv.port}": ("127.0.0.1", tsnet_srv.port)})
        try:
            home = tempfile.mkdtemp(prefix="desktop-home-")
            srv_url = f"http://srv.tail-scale.ts.net:{tsnet_srv.port}"
            cli = fake_cli(home, machines=[{"name": "desk", "me": True, "state": "on"},
                                           {"name": "srv", "label": "Server", "url": srv_url, "me": False, "state": "on"}])
            node_dir = fake_node(home, proxy.url, state="NeedsLogin", flip_after_login=2)
            opener = fake_opener(home)
            env = {**env_for(cli), "AMARCHY_HOST_TAILSCALE": "own"}
            env["PATH"] = f"{opener}:{Path(home, '.local/bin')}:{env['PATH']}"
            with Shell(None, home=home, env=env, notifyd=True) as w:
                own_page(w, "signin", timeout=40)
                check("Sign in with the Tailscale account" in w.js("document.getElementById('why').textContent"),
                      "its page asks to sign in to Tailscale (amarchy's own node)")
                w.shot(SHOTS / "tailscale-signin.png")
                w.click_el("#signin-go")
                opened = Path(opener, "opened.log")
                for _ in range(50):
                    if opened.exists():
                        break
                    time.sleep(0.2)
                check(opened.exists() and "https://login.tailscale.com/a/amarchytest" in opened.read_text(),
                      "Sign in opens Tailscale's sign-in page in the browser")
                on_app(w, timeout=60)
                check(w.do("url").startswith(srv_url), f"signed in: the server, by its tailnet name ({w.do('url')})")
                check(any(m == "GET" and "/api/state" in t for m, t in proxy.seen) or any(m == "CONNECT" for m, _ in proxy.seen),
                      "the window went through the node's proxy, with its credential")
                kinds = [m for m, _ in proxy.seen]
                check("407" in kinds and kinds.index("407") < max(i for i, m in enumerate(kinds) if m != "407"),
                      "the proxy asks for its credential, and gets it")
                before = len(proxy.seen)
                listening(tsnet_srv, w)
                check(any(m == "CONNECT" or "/api/notices" in t for m, t in proxy.seen[before:] + proxy.seen[:before]
                          if m != "407" and t.startswith("srv.tail-scale.ts.net")), "its notices too, through the node")
                tsnet_srv.notice({"title": "Through the node", "body": "Allow it?", "tag": "desk-term"},
                                 {"session": "desk-term", "actions": [{"label": "Allow", "path": "/api/session/desk-term/answer",
                                                                       "body": {"request_id": "r7", "choice": "allow"}}]})
                n = w.note(lambda n: n["summary"] == "Through the node")
                if n:
                    w.press(n["id"], "a0")
                got = tsnet_srv.acted("/api/session/desk-term/answer")
                check(got is not None and got[1]["request_id"] == "r7" and got[0] == srv_url,
                      f"and its buttons, from the server's own origin ({got})")
                w.shot(SHOTS / "tailscale-through.png")
        finally:
            proxy.stop()
            tsnet_srv.stop()

        # ---- the window's size, kept.
        omarchy_desktop(remote)

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
