#!/usr/bin/env python3
"""The theme live, "Omarchy (live)", made from Omarchy's own theme files
(rendered by Omarchy's own template script, as `omarchy theme set` does):

- `amarchy theme --omarchy` on a desktop: the app's tokens from the theme's
  colors.toml and shell.toml (and your shell.toml over it), the corners
  Hyprland draws (hyprctl, else the theme's hyprland.lua), the wallpaper on
  the desktop cut for a phone and a computer, and Omarchy's font with its
  files (amarchy's own when it's one of them); kept in app/custom/omarchy-live
  behind a link turned in one step;
- made again only when what it's made from changes: a theme switched, a
  wallpaper, a font, a light theme, the corners;
- picked (`amarchy theme omarchy-live`), Omarchy's font comes with it;
- sent to the machine it's paired with (PUT /api/peer/look, a real second
  amarchy server): there in the app's Look and its theme.css, with its
  wallpaper served (and not drawn again in a window on the Omarchy desktop,
  html.on-omarchy), and again when the desktop's theme changes; refused from a
  page, with a wrong key, for another theme's name, with files it doesn't
  name, too big;
- with the desktop's own app up too, as on a desktop and its Cloud, their
  sync running both ways: switched again and again, taken every time, and
  never synced as a theme of yours (that raced it: a folder left where a
  link was, then "couldn't keep it (Not a directory)" on every switch, and
  the sync stopped short); the server taking it again from that state, its
  leftovers gone; a server that refuses it fails the unit, one that's off
  doesn't, and it's sent there by the desktop's app once it answers again.

Needs a checkout of Omarchy in OMARCHY_SRC (default /tmp/omarchy-src/omarchy),
and ImageMagick or ffmpeg (the wallpaper's cut).

    python3 test/omarchy-theme.py
"""
import base64
import http.client
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BIN = str(REPO / "bin/amarchy")
SRC = Path(os.environ.get("OMARCHY_SRC", "/tmp/omarchy-src/omarchy"))
USER = "tester@example.com"
failed = []


def check(what, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + what + (f": {detail}" if detail and not ok else ""), flush=True)
    if not ok:
        failed.append(what)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# fontconfig, as the desktop has it: $HOME/font says "family|regular file|bold file".
FC_MATCH = r'''#!/bin/sh
IFS='|' read -r family regular bold < "$HOME/font"
pattern="$1"; shift
[ "$1" = -f ] && format="$2"
case "$pattern" in *bold*) file=$bold ;; *) file=$regular ;; esac
case "$format" in
  "%{family}") printf '%s,Alias' "$family" ;;
  "%{file}") printf '%s' "$file" ;;
  *) printf '%s|%s' "$family" "$file" ;;
esac
'''
# Hyprland, when $HOME/rounding is there: its corners.
HYPRCTL = r'''#!/bin/sh
[ -f "$HOME/rounding" ] || exit 1
[ "$1" = -j ] && [ "$2" = getoption ] && printf '{"option": "decoration:rounding", "int": %s, "set": true}' "$(cat "$HOME/rounding")"
'''


class Desk:
    """An Omarchy desktop's home: its current theme, as omarchy theme set leaves it."""

    def __init__(self, base, name="desk"):
        self.home = Path(base) / name
        self.bin = Path(base) / f"{name}-bin"
        self.bin.mkdir(parents=True)
        (self.bin / "fc-match").write_text(FC_MATCH)
        (self.bin / "hyprctl").write_text(HYPRCTL)
        for f in self.bin.iterdir():
            f.chmod(0o755)
        self.current = self.home / ".local/state/omarchy/current"
        self.env = {"HOME": str(self.home), "XDG_STATE_HOME": str(self.home / "state"),
                    "XDG_CONFIG_HOME": str(self.home / "config"), "XDG_RUNTIME_DIR": str(Path(base) / f"{name}-run"),
                    "HYPRLAND_INSTANCE_SIGNATURE": "test",
                    "AMARCHY_HOST_NAME": name, "AMARCHY_HOST_URL": f"http://127.0.0.1:{free_port()}",
                    "AMARCHY_HOST_APP_USERS": USER, "AMARCHY_WORK": str(self.home / "Work"),
                    "PATH": f"{self.bin}:/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8"}
        (self.home / "Work").mkdir(parents=True)
        self.font("JetBrainsMono Nerd Font", "/nowhere/JetBrainsMonoNerdFont-Regular.ttf")

    def theme(self, name):
        """omarchy theme set <name>, as far as the files go: rendered into
        next-theme by Omarchy's templates, then swapped in."""
        nxt = self.current / "next-theme"
        shutil.rmtree(nxt, ignore_errors=True)
        nxt.mkdir(parents=True)
        shutil.copytree(SRC / "themes" / name, nxt, dirs_exist_ok=True)
        r = subprocess.run([str(SRC / "bin/omarchy-theme-set-templates")], capture_output=True, text=True,
                           env={**self.env, "OMARCHY_PATH": str(SRC), "HOME": str(self.home),
                                "PATH": f"{SRC}/bin:/usr/bin:/bin"}, timeout=60)
        assert (nxt / "shell.toml").is_file(), r.stderr[-400:]
        shutil.rmtree(self.current / "theme", ignore_errors=True)
        nxt.rename(self.current / "theme")
        (self.current / "theme.name").write_text(name.replace("-", " ").title() + "\n")

    def background(self, picture):
        link = self.current / "background"
        link.unlink(missing_ok=True)
        link.symlink_to(picture)

    def font(self, family, regular, bold=None):
        (self.home / "font").write_text(f"{family}|{regular}|{bold or regular}")

    def amarchy(self, *args):
        return subprocess.run([sys.executable, BIN, *args], env=self.env, capture_output=True, text=True, timeout=120)

    @property
    def live(self):
        return self.home / "state/amarchy/app/custom/omarchy-live"

    def kept(self):
        try:
            return json.loads((self.live / "theme.json").read_text())
        except (OSError, ValueError):
            return {}


class Box:
    """A machine running amarchy's app server (its own home, port, name;
    env: more of its environment, a desktop's own)."""

    def __init__(self, base, name="box", env=None):
        self.name, self.port = name, free_port()
        self.home = Path(base) / name
        self.url = f"http://127.0.0.1:{self.port}"
        (self.home / "Work").mkdir(parents=True, exist_ok=True)
        self.env = {"HOME": str(self.home), "XDG_STATE_HOME": str(self.home / "state"),
                    "XDG_CONFIG_HOME": str(self.home / "config"), "AMARCHY_WORK": str(self.home / "Work"),
                    "AMARCHY_TMUX": f"amarchy-test-{os.getpid()}-{name}", "AMARCHY_HOST_NAME": name,
                    "AMARCHY_HOST_APP_PORT": str(self.port), "AMARCHY_HOST_URL": self.url,
                    "AMARCHY_HOST_APP_LINKS": "off", "AMARCHY_HOST_APP_USERS": USER, "AUTO_UPDATE": "off",
                    "PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8", "SHELL": "/bin/bash",
                    "XDG_RUNTIME_DIR": os.environ.get("XDG_RUNTIME_DIR", ""), **(env or {})}
        self.logfile = Path(base) / f"{name}.log"
        self.start()

    def start(self):
        self.log = open(self.logfile, "a")
        self.proc = subprocess.Popen([sys.executable, BIN, "app", "serve"], env=self.env, stdout=self.log,
                                     stderr=self.log, stdin=subprocess.DEVNULL, start_new_session=True)
        for _ in range(100):
            try:
                socket.create_connection(("127.0.0.1", self.port), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)
        key = (self.home / "state/amarchy/app/local.key").read_text().strip()
        self.jar = None
        code, h, _ = self.ask("GET", f"/local?key={key}")
        self.jar = h.get("Set-Cookie", "").split(";")[0]

    def ask(self, method, path, body=None, headers=None, raw=False):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        h = {"Host": f"127.0.0.1:{self.port}", **({"Cookie": self.jar} if self.jar else {})}
        if method in ("POST", "PUT"):
            h.update({"Origin": self.url, "Content-Type": "application/json"})
        h.update(headers or {})
        c.request(method, path, body=body if isinstance(body, bytes) else json.dumps(body).encode() if body is not None
                  else None, headers=h)
        r = c.getresponse()
        out = r.read()
        c.close()
        if raw:
            return r.status, dict(r.getheaders()), out
        try:
            return r.status, dict(r.getheaders()), json.loads(out or b"{}")
        except ValueError:
            return r.status, dict(r.getheaders()), {"raw": out[:300]}

    def stop(self):
        if self.proc.poll() is None:
            os.killpg(self.proc.pid, signal.SIGTERM)
            self.proc.wait(10)
        self.log.close()
        subprocess.run(["tmux", "-L", self.env["AMARCHY_TMUX"], "kill-server"], capture_output=True)

    @property
    def live(self):
        return self.home / "state/amarchy/app/custom/omarchy-live"

    def kept(self):
        try:
            return json.loads((self.live / "theme.json").read_text())
        except (OSError, ValueError):
            return {}

    def leftovers(self):
        """What's in app/custom beside its themes and the folders they point at."""
        custom = self.home / "state/amarchy/app/custom"
        targets = {os.readlink(p) for p in custom.iterdir() if p.is_symlink() and not p.name.startswith(".")}
        return sorted(p.name for p in custom.iterdir() if p.name.startswith(".") and p.name not in targets)

    def synced_themes(self):
        try:
            return set(json.loads((self.home / "state/amarchy/sync/themes.json").read_text()))
        except (OSError, ValueError):
            return set()


def until(fn, limit=20, every=0.5):
    end = time.time() + limit
    while True:
        got = fn()
        if got or time.time() > end:
            return got
        time.sleep(every)


def shell_value(desk, section, key):
    import tomllib
    return tomllib.loads((desk.current / "theme/shell.toml").read_text())[section][key]


def local_test(base):
    desk = Desk(base)
    r = desk.amarchy("theme", "--omarchy")
    check("no Omarchy theme: says so", r.returncode == 1 and "no Omarchy theme" in r.stderr, r.stderr + r.stdout)

    desk.theme("tokyo-night")
    walls = sorted((SRC / "themes/tokyo-night/backgrounds").iterdir())
    desk.background(walls[0])
    r = desk.amarchy("theme", "--omarchy")
    check("made", r.returncode == 0 and "Omarchy (live): made from Tokyo Night on desk" in r.stdout, r.stderr + r.stdout)
    t = desk.kept()
    check("kept behind a link", desk.live.is_symlink() and (desk.live / "theme.json").is_file())
    check("named Omarchy (live), dark", t.get("name") == "Omarchy (live)" and t.get("mode") == "dark", t.get("name"))
    v = t.get("vars", {})
    check("its surfaces are the shell's menus", v.get("surface") == shell_value(desk, "menu", "background").lower()
          and v.get("text") == shell_value(desk, "menu", "text").lower(), (v.get("surface"), v.get("text")))
    check("square corners, as Omarchy's default", v.get("radius") == "0px", v.get("radius"))
    files = sorted(p.name for p in desk.live.iterdir())
    walls = t.get("wallpaper") or {}
    check("with its wallpaper (phone, wide) and font, and nothing else",
          files == sorted(["bold.woff2", "regular.woff2", "theme.json", walls.get("phone", "?"), walls.get("wide", "?")])
          and walls.get("phone", "").startswith("wallpaper.") and walls.get("wide", "").startswith("wallpaper-wide."), files)
    check("the font is amarchy's own JetBrains Mono, a Nerd Font", t.get("font", {}).get("nerd") is True
          and (desk.live / "regular.woff2").read_bytes() == (REPO / "fonts/jetbrains-mono/regular.woff2").read_bytes(),
          t.get("font"))
    wall = (desk.live / walls["phone"]).read_bytes()
    check("its wallpaper cut small for a phone", len(wall) < 600_000, len(wall))
    target = os.readlink(desk.live)

    r = desk.amarchy("theme", "--omarchy")
    check("again with nothing changed: nothing done, nothing said", r.returncode == 0 and not r.stdout.strip()
          and os.readlink(desk.live) == target, r.stdout)

    desk.theme("solitude")
    r = desk.amarchy("theme", "--omarchy")
    t = desk.kept()
    check("a theme switched: made again", r.returncode == 0 and "from Solitude" in r.stdout, r.stdout + r.stderr)
    check("solitude's corners (its hyprland.lua): 6px", t["vars"].get("radius") == "6px", t["vars"].get("radius"))
    check("the one before is gone", not Path(desk.live.parent / target).exists()
          and len([p for p in desk.live.parent.iterdir() if p.name.startswith(".")]) == 1,
          [p.name for p in desk.live.parent.iterdir()])
    (desk.home / "rounding").write_text("10")
    desk.amarchy("theme", "--omarchy")
    check("the corners Hyprland draws, when it says", desk.kept()["vars"].get("radius") == "10px",
          desk.kept()["vars"].get("radius"))
    before = (desk.live / desk.kept()["wallpaper"]["phone"]).read_bytes()
    desk.background(sorted((SRC / "themes/solitude/backgrounds").iterdir())[2])
    r = desk.amarchy("theme", "--omarchy")
    check("a wallpaper changed: made again", r.returncode == 0
          and (desk.live / desk.kept()["wallpaper"]["phone"]).read_bytes() != before, r.stdout)
    (desk.home / ".config/omarchy").mkdir(parents=True, exist_ok=True)
    (desk.home / ".config/omarchy/shell.toml").write_text('[menu]\nbackground = "#102030"\n')
    desk.amarchy("theme", "--omarchy")
    check("your shell.toml over the theme's", desk.kept()["vars"].get("surface") == "#102030",
          desk.kept()["vars"].get("surface"))
    (desk.home / ".config/omarchy/shell.toml").unlink()

    mono = Path("/usr/share/fonts/liberation/LiberationMono-Regular.ttf")
    if mono.is_file():
        desk.font("Liberation Mono", str(mono), str(mono.with_name("LiberationMono-Bold.ttf")))
        r = desk.amarchy("theme", "--omarchy")
        t = desk.kept()
        check("a font of Omarchy's not amarchy's: its own files", t.get("font", {}).get("family") == "Liberation Mono"
              and t["font"]["files"] == {"regular": "regular.ttf", "bold": "bold.ttf"} and t["font"]["nerd"] is False
              and (desk.live / "regular.ttf").read_bytes() == mono.read_bytes(), t.get("font"))
        desk.font("JetBrainsMono Nerd Font", "/nowhere")

    desk.theme("catppuccin-latte")
    desk.amarchy("theme", "--omarchy")
    check("a light theme is light", desk.kept().get("mode") == "light", desk.kept().get("mode"))

    r = desk.amarchy("theme", "omarchy-live")
    show = desk.amarchy("theme", "--show")
    check("picked: worn, with Omarchy's font", r.returncode == 0 and show.stdout.startswith("Omarchy (live) · JetBrains")
          or "Omarchy (live)" in show.stdout, show.stdout + r.stderr)
    choice = json.loads((desk.home / "state/amarchy/app/theme/choice.json").read_text())
    check("its font picked with it", choice.get("theme") == "omarchy-live" and choice.get("font") == "custom-omarchy-live",
          choice)
    lst = desk.amarchy("theme", "--list")
    check("listed among your own", "omarchy-live" in lst.stdout and "Omarchy (live)" in lst.stdout, lst.stdout[:300])
    desk.background(desk.home / "not-there.jpg")
    desk.amarchy("theme", "--omarchy")
    check("no wallpaper on the desktop: none", desk.kept().get("wallpaper") is None, desk.kept().get("wallpaper"))
    return desk


def peer_test(base, desk):
    box = Box(base)
    try:
        r = desk.amarchy("machines", "add", box.url)
        check("the desktop pairs with the server", r.returncode == 0, r.stderr + r.stdout)
        desk.theme("tokyo-night")
        desk.background(sorted((SRC / "themes/tokyo-night/backgrounds").iterdir())[1])
        r = desk.amarchy("theme", "--omarchy")
        check("made and sent", r.returncode == 0 and "sent to box" in r.stdout, r.stdout + r.stderr)
        code, _, look = box.ask("GET", "/api/look")
        live = next((t for t in look.get("themes", []) if t["key"] == "omarchy-live"), None)
        check("on the server's Look, as one of yours", code == 200 and live and live["name"] == "Omarchy (live)"
              and live.get("custom"), live)
        r = desk.amarchy("theme", "--omarchy")
        check("again, nothing changed: not sent again", r.returncode == 0 and not r.stdout.strip(), r.stdout)

        code, _, look = box.ask("POST", "/api/look", {"theme": "omarchy-live"})
        check("picked on the server, its font with it", code == 200 and look.get("theme") == "omarchy-live"
              and look.get("font") == "custom-omarchy-live", (code, look.get("theme"), look.get("font")))
        code, _, css = box.ask("GET", "/theme.css", raw=True)
        css = css.decode()
        surface = desk.kept()["vars"]["surface"]
        check("its theme.css wears it", code == 200 and f"--surface: {surface};" in css
              and "/custom/omarchy-live/" in css, css[:400])
        url = next((part.split('"')[1] for part in css.split("--wallpaper: url(")[1:2]), "")
        code, h, pic = box.ask("GET", url, raw=True)
        check("its wallpaper served", code == 200 and (pic[:4] == b"RIFF" or pic[:3] == b"\xff\xd8\xff"), (url, code))
        # The desktop app's window on an Omarchy desktop (html.on-omarchy) is
        # see-through, the desktop's own wallpaper behind it: nothing drawn
        # under the panes; only for this look's own wallpaper.
        blank = "html.on-omarchy { --wallpaper: none; --wallpaper-wide: none; --wallpaper-ground: transparent; }"
        check("in a window on the Omarchy desktop, its wallpaper not drawn again", blank in css, css[-300:])
        for change, why in (({"wallpaper": "none"}, "no wallpaper"), ({"theme": "tokyo-night", "wallpaper": "theme"},
                                                                       "another theme's wallpaper")):
            box.ask("POST", "/api/look", change)
            code, _, other = box.ask("GET", "/theme.css", raw=True)
            check(f"{why}: nothing taken away there", code == 200 and blank not in other.decode(), other.decode()[-300:])
        code, _, look = box.ask("POST", "/api/look", {"theme": "omarchy-live", "wallpaper": "theme"})
        check("Omarchy (live) worn again", code == 200 and look.get("theme") == "omarchy-live", (code, look.get("theme")))

        desk.theme("gruvbox")
        r = desk.amarchy("theme", "--omarchy")
        code, _, css2 = box.ask("GET", "/theme.css", raw=True)
        check("the desktop's theme switched: the server wears the new one", "sent to box" in r.stdout
              and f"--surface: {desk.kept()['vars']['surface']};" in css2.decode() and css2 != css.encode(),
              r.stdout + r.stderr)

        # Who may put it.
        theme = desk.kept()
        files = {f: base64.b64encode((desk.live / f).read_bytes()).decode() for f in os.listdir(desk.live)
                 if f != "theme.json"}
        body = {"key": "omarchy-live", "theme": theme, "files": files}
        code, _, said = box.ask("PUT", "/api/peer/look", body)
        check("from a page (no peer key): refused", code == 403, (code, said))
        key = json.loads((box.home / "config/amarchy/machines.json").read_text())[0]["key"]
        peer = {"X-Amarchy-Peer": "desk", "Authorization": f"Bearer {key}", "X-Amarchy-Protocol": "1"}
        code, _, said = box.ask("PUT", "/api/peer/look", body, headers={**peer, "Authorization": "Bearer " + "x" * 43})
        check("with a wrong key: refused", code == 403, (code, said))
        code, _, said = box.ask("PUT", "/api/peer/look", {**body, "key": "tokyo-night"}, headers=peer)
        check("another theme's name: refused", code == 400, (code, said))
        code, _, said = box.ask("PUT", "/api/peer/look", {**body, "files": {**files, "evil.sh": "eA=="}}, headers=peer)
        check("a file it doesn't name: refused", code == 400, (code, said))
        bad = dict(files)
        bad[theme["wallpaper"]["phone"]] = base64.b64encode(b"#!/bin/sh\nrm -rf ~\n").decode()
        code, _, said = box.ask("PUT", "/api/peer/look", {**body, "files": bad}, headers=peer)
        check("a wallpaper that isn't a picture: refused", code == 400, (code, said))
        code, _, said = box.ask("PUT", "/api/peer/look", {**body, "theme": {**theme, "vars": {"x": "red; } body { x"}}},
                                headers=peer)
        check("colors that aren't colors: refused", code == 400, (code, said))
        s = socket.create_connection(("127.0.0.1", box.port), timeout=10)
        s.sendall(("PUT /api/peer/look HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nContent-Type: application/json\r\n"
                   "Content-Length: 49000000\r\n%s\r\n{" % (box.port, "".join(f"{k}: {v}\r\n" for k, v in peer.items())))
                  .encode())
        answer = s.recv(4096).decode(errors="replace")
        s.close()
        check("too big: refused before it's read", answer.startswith("HTTP/1.1 413") or answer.startswith("HTTP/1.0 413"),
              answer[:80])
        code, _, said = box.ask("PUT", "/api/peer/look", body, headers=peer)
        check("the right one, from the desktop: taken", code == 200 and said.get("worn") is True, (code, said))
    finally:
        box.stop()


def sync_test(base):
    """A desktop and its Cloud, both up, as Julian's are."""
    desk = Desk(base, "ja")
    desk.theme("tokyo-night")
    desk.background(sorted((SRC / "themes/tokyo-night/backgrounds").iterdir())[0])
    # The desktop's own app, with the desktop's environment (its fakes; no
    # systemd: its catch-up runs `amarchy theme --omarchy` itself).
    app = Box(base, "ja", env={k: desk.env[k] for k in ("PATH", "XDG_RUNTIME_DIR", "HYPRLAND_INSTANCE_SIGNATURE")})
    desk.env.update(AMARCHY_HOST_URL=app.url, AMARCHY_HOST_APP_PORT=str(app.port), AMARCHY_TMUX=app.env["AMARCHY_TMUX"])
    cloud = Box(base, "cloud")
    try:
        r = desk.amarchy("machines", "add", cloud.url)
        check("both up: the desktop pairs with its Cloud", r.returncode == 0, r.stderr + r.stdout)
        r = desk.amarchy("theme", "--omarchy")
        check("made and sent", r.returncode == 0 and "sent to cloud" in r.stdout, r.stdout + r.stderr)
        time.sleep(8)       # the sync, both ways, a few times (it looks every 2 s; a change: pushed)

        surfaces = set()
        for name in ("rose-pine", "gruvbox", "nord", "kanagawa", "rose-pine"):
            desk.theme(name)
            r = desk.amarchy("theme", "--omarchy", "--quiet")
            surface = desk.kept()["vars"]["surface"]
            surfaces.add(surface)
            check(f"switched to {name}: taken, the unit succeeds", r.returncode == 0 and not r.stderr.strip()
                  and cloud.kept().get("vars", {}).get("surface") == surface, (r.returncode, r.stdout, r.stderr))
            time.sleep(3)   # a sync between switches, as there was between Julian's
        check("the switches were the server's to see", len(surfaces) >= 3, surfaces)
        check("kept behind a link on both", desk.live.is_symlink() and cloud.live.is_symlink())
        check("never synced as a theme of yours", "omarchy-live" not in cloud.synced_themes()
              and "omarchy-live" not in app.synced_themes(), (cloud.synced_themes(), app.synced_themes()))
        check("nothing left beside it", not cloud.leftovers() and not app.leftovers(),
              (cloud.leftovers(), app.leftovers()))

        # What the sync left on Julian's Cloud: the link moved aside under the
        # server's pid, a folder where it was, the folder a take cut short left.
        custom = cloud.live.parent
        pid = cloud.proc.pid
        target = os.readlink(cloud.live)
        os.rename(cloud.live, custom / f".omarchy-live.old.{pid}")
        shutil.copytree(custom / target, cloud.live)
        (custom / f".omarchy-live.{pid}").mkdir()
        (custom / f".omarchy-live.{pid}/theme.json").write_text("{}")
        old = time.time() - 1800
        for f in (custom / f".omarchy-live.old.{pid}", custom / f".omarchy-live.{pid}", custom / target):
            os.utime(f, (old, old), follow_symlinks=False)
        desk.theme("everforest")
        r = desk.amarchy("theme", "--omarchy", "--quiet")
        check("the state Julian's Cloud was in: taken again", r.returncode == 0 and not r.stderr.strip()
              and cloud.live.is_symlink() and cloud.kept()["vars"]["surface"] == desk.kept()["vars"]["surface"],
              (r.stdout, r.stderr))
        check("its leftovers gone", not cloud.leftovers(), cloud.leftovers())

        # A machine on an older amarchy still syncs it as a theme of yours: not taken.
        key = json.loads((cloud.home / "config/amarchy/machines.json").read_text())[0]["key"]
        peer = {"X-Amarchy-Peer": "ja", "Authorization": f"Bearer {key}", "X-Amarchy-Protocol": "1"}
        before = os.readlink(cloud.live)
        code, _, said = cloud.ask("POST", "/api/peer/sync", {"themes": {"omarchy-live": {
            "files": {"theme.json": "0" * 64}, "at": 9e9, "by": "zzz"}}}, headers=peer)
        time.sleep(3)
        check("one an older machine syncs: not taken", code == 200 and os.readlink(cloud.live) == before, (code, said))

        # Refused: the unit fails, saying why.
        custom.chmod(0o555)
        try:
            desk.theme("nord")
            r = desk.amarchy("theme", "--omarchy", "--quiet")
        finally:
            custom.chmod(0o755)
        check("refused there: the unit fails, saying why", r.returncode == 1
              and "not sent to cloud: couldn't keep it (Permission denied)" in r.stderr, (r.returncode, r.stderr))

        # Off: not a failure, and sent once it answers again.
        cloud.stop()
        desk.theme("catppuccin")
        r = desk.amarchy("theme", "--omarchy")
        check("its Cloud off: the unit succeeds, saying it's sent when it's back", r.returncode == 0
              and "not sent to cloud yet" in r.stdout, (r.returncode, r.stdout, r.stderr))
        r = desk.amarchy("theme", "--omarchy", "--quiet")
        check("quiet, nothing said", r.returncode == 0 and not r.stdout.strip() and not r.stderr.strip(),
              (r.stdout, r.stderr))
        want = desk.kept()["vars"]["surface"]
        time.sleep(1)
        cloud.start()
        t0 = time.time()
        got = until(lambda: cloud.kept().get("vars", {}).get("surface") == want, limit=100, every=1)
        check(f"back on: the desktop's app sends it there ({time.time() - t0:.0f} s)", bool(got),
              cloud.kept().get("vars", {}).get("surface"))
        sent = json.loads((desk.home / "state/amarchy/omarchy-live.json").read_text())
        check("and it's kept as sent", sent["sent"].get("cloud") == sent["sig"] and "cloud" not in sent.get("tried", {}),
              sent.get("tried"))
        logs = {b.name: b.logfile.read_text() for b in (app, cloud)}
        check("no error in either app's log", not any("Traceback" in t or "Not a directory" in t for t in logs.values()),
              {n: t[-1500:] for n, t in logs.items() if "Traceback" in t or "Not a directory" in t})
    finally:
        cloud.stop()
        app.stop()


def main():
    if not (SRC / "bin/omarchy-theme-set-templates").is_file():
        print(f"skip: no Omarchy checkout in {SRC} (OMARCHY_SRC=)")
        return 0
    base = tempfile.mkdtemp(prefix="omarchy-theme-")
    try:
        desk = local_test(base)
        peer_test(base, desk)
        sync_test(base)
    finally:
        shutil.rmtree(base, ignore_errors=True)
    print(f"\n{len(failed)} failed" if failed else "\nall ok")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
