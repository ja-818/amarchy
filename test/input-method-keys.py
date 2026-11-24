#!/usr/bin/env python3
"""amarchy's keys against a real input method: fcitx5, as Omarchy runs it.

fcitx5 has every text field (the chat's box, a terminal's) before the page
does, and keeps the keys it binds: Ctrl+Alt+H turns its word hints on (a list
under all you type, in every app, until pressed again), J for one word, P its
preedit. amarchy keeps those keys its own: while Ctrl and Alt are down, its
box stops taking text, the input method lets go of the keyboard, and the key
comes to amarchy (app/desk.js, imKeys; test/input-method-view.py shows it in
the browsers). That needs, from every input method (the keyboard, and each
engine installed: Pinyin, Mozc, Hangul, Chewing, the tables...), checked here
in a focused input context of a private fcitx5:

- Ctrl and Alt themselves let through, as they go down (the page steps aside
  on them);
- what it takes of amarchy's Ctrl+Alt keys (read from app/desk.js): said, the
  ones the stepping aside is for;
- Ctrl+Alt+? let through: with Shift held amarchy leaves the box to the input
  method (Ctrl+Alt+Shift+U is its Unicode entry), so ? must get past it;
- Ctrl+Alt+P taken (fcitx5's own, under every method), else the test isn't
  reaching fcitx5 at all;
- and, said: with something typed first (the keyboard's word hints on, an
  engine's half-made word), what it holds.

Under fcitx5's own defaults, Omarchy's config (its config/fcitx5) and, where
there is one, yours (~/.config/fcitx5, copied: never changed).

The fcitx5 runs on a D-Bus of the test's own, with no display: the desktop's
input method is never touched. It is /usr/bin/fcitx5, or one unpacked in
FCITX5_ROOT (its usr/bin/fcitx5, usr/lib, usr/share/fcitx5: a package
extracted there, on a machine without it).

    python3 test/input-method-keys.py            # every config it finds
    python3 test/input-method-keys.py --config ~/some/fcitx5   # and that one

Exits 0 when every check passed, 1 when one didn't, 2 when there's no fcitx5
to test with.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
failed = []


def check(what, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + what + (f": {detail}" if detail else ""), flush=True)
    if not ok:
        failed.append(what)


def note(what):
    print("     " + what, flush=True)


# KeyboardEvent.code -> (X keysym, X keycode: evdev + 8, as a US keyboard has them)
LETTERS = "qwertyuiop", "asdfghjkl", "zxcvbnm"
CODES = {
    "ArrowLeft": (0xff51, 113), "ArrowRight": (0xff53, 114), "ArrowUp": (0xff52, 111), "ArrowDown": (0xff54, 116),
    "Enter": (0xff0d, 36), "NumpadEnter": (0xff8d, 104), "Slash": (0x2f, 61), "Space": (0x20, 65),
}
for row, first in zip(LETTERS, (24, 38, 52)):
    for i, ch in enumerate(row):
        CODES["Key" + ch.upper()] = (ord(ch), first + i)
SHIFT, CTRL, ALT = 1, 4, 8
QUESTION = (0x3f, 61)      # Shift+/
CONTROL_L, ALT_L = (0xffe3, 37), (0xffe9, 64)


def names(code):
    return {"ArrowLeft": "←", "ArrowRight": "→", "ArrowUp": "↑", "ArrowDown": "↓", "Enter": "↵", "NumpadEnter": "keypad ↵",
            "Slash": "/"}.get(code, code[3:] if code.startswith("Key") else code)


def amarchy_keys():
    """amarchy's Ctrl+Alt keys, from app/desk.js: what each is, as (label, keysym, keycode, state)."""
    src = (REPO / "app/desk.js").read_text()
    block = re.search(r"const APP_KEYS = \{(.*?)\n\};", src, re.S)
    talk = re.search(r"const TALK_KEYS = \[(.*?)\];", src, re.S)
    if not block or not talk:
        sys.exit("app/desk.js: no APP_KEYS / TALK_KEYS to read")
    codes = re.findall(r"(\w+):\s*\(", block[1]) + re.findall(r'"(\w+)"', talk[1])
    keys = []
    for code in codes:
        if code not in CODES:
            check(f"Ctrl+Alt+{code}: a key this test knows", False, "add it to CODES")
            continue
        keys.append((f"Ctrl+Alt+{names(code)}", *CODES[code], CTRL | ALT))
    if "Slash" in codes:
        keys.append(("Ctrl+Alt+?", *QUESTION, CTRL | ALT | SHIFT))
    return keys


def find_fcitx5():
    root = os.environ.get("FCITX5_ROOT")
    if root:
        root = Path(root).expanduser()
        exe = root / "usr/bin/fcitx5"
        if not exe.exists():
            sys.exit(f"FCITX5_ROOT={root}: no usr/bin/fcitx5 in it")
        return exe, {"LD_LIBRARY_PATH": str(root / "usr/lib"), "FCITX_ADDON_DIRS": str(root / "usr/lib/fcitx5"),
                     "FCITX_DATA_DIRS": str(root / "usr/share/fcitx5")}
    exe = shutil.which("fcitx5")
    return (Path(exe), {}) if exe else (None, {})


def omarchy_config():
    for base in [os.environ.get("OMARCHY_SRC"), os.environ.get("OMARCHY_PATH"), "/usr/share/omarchy",
                 "~/.local/share/omarchy", "/tmp/omarchy-src/omarchy"]:
        if base and (Path(base).expanduser() / "config/fcitx5").is_dir():
            return Path(base).expanduser() / "config/fcitx5"
    return None


class Fcitx:
    """A fcitx5 of the test's own: its own D-Bus, its own config, no display."""

    def __init__(self, exe, env, config, work):
        from gi.repository import Gio, GLib
        self.Gio, self.GLib = Gio, GLib
        self.work = Path(tempfile.mkdtemp(dir=work))
        cfg = self.work / "config"
        if config:
            shutil.copytree(config, cfg, symlinks=False)
        else:
            cfg.mkdir()
        run = self.work / "run"
        run.mkdir(mode=0o700)
        bus_sock = self.work / "bus"
        self.dbus = subprocess.Popen(["dbus-daemon", "--session", "--nofork", "--nopidfile", f"--address=unix:path={bus_sock}",
                                      "--print-address=1"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        self.address = self.dbus.stdout.readline().strip()
        e = {k: v for k, v in os.environ.items() if k not in ("WAYLAND_DISPLAY", "DISPLAY", "DBUS_SESSION_BUS_ADDRESS")}
        e.update(env, DBUS_SESSION_BUS_ADDRESS=self.address, XDG_RUNTIME_DIR=str(run), FCITX_CONFIG_HOME=str(cfg),
                 FCITX_DATA_HOME=str(self.work / "data"), HOME=str(self.work), LANG="en_US.UTF-8")
        self.env = e
        self.exe = exe
        self.log = open(self.work / "fcitx5.log", "w")
        self.proc = subprocess.Popen([str(exe), "--disable=wayland,waylandim,xcb,xim,classicui,kimpanel,notificationitem,ibusfrontend,fcitx4frontend,virtualkeyboard"],
                                     env=e, stdout=self.log, stderr=subprocess.STDOUT)
        self.bus = Gio.DBusConnection.new_for_address_sync(
            self.address, Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, None, None)
        for _ in range(200):
            try:
                self.controller("State", None, "(i)")
                break
            except Exception:
                if self.proc.poll() is not None:
                    raise RuntimeError(f"fcitx5 stopped ({self.proc.returncode}): {(self.work / 'fcitx5.log').read_text()[-600:]}")
                time.sleep(0.05)
        else:
            raise RuntimeError("fcitx5 never answered on its D-Bus")

    def call(self, path, iface, method, args, rtype):
        GLib = self.GLib
        v = self.bus.call_sync("org.fcitx.Fcitx5", path, iface, method, args, GLib.VariantType(rtype) if rtype else None, 0, 5000, None)
        return v.unpack() if v is not None else None

    def controller(self, method, args=None, rtype=None):
        return self.call("/controller", "org.fcitx.Fcitx.Controller1", method, args, rtype)

    def version(self):
        out = subprocess.run([str(self.exe), "--version"], env=self.env, capture_output=True, text=True).stdout.strip()
        return out.split()[-1] if out else "?"

    def methods(self):
        """Every input method it has: (name, its own name, language)."""
        return [(m[0], m[1], m[5]) for m in self.controller("AvailableInputMethods", None, "(a(ssssssb))")[0]]

    def group(self):
        name = self.controller("CurrentInputMethodGroup", None, "(s)")[0]
        layout, items = self.controller("InputMethodGroupInfo", self.GLib.Variant("(s)", (name,)), "(sa(ss))")
        return name, layout, [i[0] for i in items]

    def use(self, methods):
        """A group of the test's own with these in it (the config's own group stays as it was)."""
        V = self.GLib.Variant
        self.controller("AddInputMethodGroup", V("(s)", ("amarchy-test",)))
        self.controller("SetInputMethodGroupInfo", V("(ssa(ss))", ("amarchy-test", "us", [(m, "") for m in methods])))
        self.controller("SwitchInputMethodGroup", V("(s)", ("amarchy-test",)))

    def context(self, method):
        V = self.GLib.Variant
        path = self.call("/org/freedesktop/portal/inputmethod", "org.fcitx.Fcitx.InputMethod1", "CreateInputContext",
                         V("(a(ss))", ([("program", "amarchy-input-method-test")],)), "(oay)")[0]
        ic = Context(self, path)
        ic.do("SetCapability", V("(t)", (0,)))
        ic.do("FocusIn")
        if method:
            self.controller("SetCurrentIM", V("(s)", (method,)))
        return ic

    def current(self):
        return self.controller("CurrentInputMethod", None, "(s)")[0]

    def close(self):
        for p in (self.proc, self.dbus):
            if p.poll() is None:
                p.terminate()
                try:
                    p.wait(5)
                except subprocess.TimeoutExpired:
                    p.kill()
        self.log.close()
        shutil.rmtree(self.work, ignore_errors=True)


class Context:
    I = "org.fcitx.Fcitx.InputContext1"

    def __init__(self, fx, path):
        self.fx, self.path = fx, path

    def do(self, method, args=None, rtype=None):
        return self.fx.call(self.path, self.I, method, args, rtype)

    def key(self, sym, code, state):
        """Pressed and let go: whether fcitx5 took it (the app would never see it)."""
        V = self.fx.GLib.Variant
        taken = self.do("ProcessKeyEvent", V("(uuubu)", (sym, code, state, False, 0)), "(b)")[0]
        self.do("ProcessKeyEvent", V("(uuubu)", (sym, code, state, True, 0)), "(b)")
        return taken

    def type(self, text):
        for ch in text:
            self.key(*CODES["Key" + ch.upper()], 0)

    def close(self):
        try:
            self.do("FocusOut")
            self.do("DestroyIC")
        except Exception:
            pass


def run(where, config, exe, env, keys, work):
    print(f"\n{where}" + (f" ({config})" if config else ""), flush=True)
    try:
        fx = Fcitx(exe, env, config, work)
    except Exception as e:
        check(f"{where}: a fcitx5 of the test's own", False, str(e))
        return
    try:
        _, _, own = fx.group()
        every = fx.methods()
        engines = [m for m, _, _ in every if not m.startswith("keyboard-")]
        methods = list(dict.fromkeys(["keyboard-us"] + own + engines))
        note(f"fcitx5 {fx.version()}; the config's own: {', '.join(own) or 'none'}; testing {len(methods)}: {', '.join(methods)}")
        fx.use(methods)
        for method in methods:
            ic = fx.context(method)
            if fx.current() != method:
                note(f"{method}: couldn't switch to it ({fx.current() or 'none'}): skipped")
                ic.close()
                continue
            mods = not ic.key(*CONTROL_L, 0) and not ic.key(*ALT_L, CTRL)
            check(f"{where}, {method}: Ctrl and Alt get through as they go down (the box steps aside on them)", mods)
            taken = [label for label, sym, code, state in keys if not state & SHIFT and ic.key(sym, code, state)]
            note(f"{method}, an empty box: it takes {', '.join(taken) or 'none'} of amarchy's (the box steps aside for them)")
            shifted = [label for label, sym, code, state in keys if state & SHIFT and ic.key(sym, code, state)]
            check(f"{where}, {method}: amarchy's Ctrl+Alt+Shift keys get through (Shift leaves the box to it)", not shifted,
                  f"it took {', '.join(shifted)}" if shifted else "")
            check(f"{where}, {method}: it takes Ctrl+Alt+P (the test reaches its keys)", ic.key(*CODES["KeyP"], CTRL | ALT))
            ic.close()

            # Something typed first, each time: in an engine, a half-made word; with the keyboard, hints on.
            ic = fx.context(method)
            hints = method.startswith("keyboard-") and ic.key(*CODES["KeyH"], CTRL | ALT)
            held = []
            for label, sym, code, state in keys:
                ic.type("he")
                if ic.key(sym, code, state):
                    held.append(label)
                ic.do("Reset")
            what = "word hints on, a word typed" if hints else "a word typed"
            note(f"{method}, {what}: " + (f"it holds {', '.join(held)}" if held else "every amarchy key gets through"))
            ic.close()
    finally:
        fx.close()


def main():
    ap = argparse.ArgumentParser(description="amarchy's keys against a real fcitx5")
    ap.add_argument("--config", action="append", default=[], help="a fcitx5 config folder to test as well (copied, never changed)")
    args = ap.parse_args()
    exe, env = find_fcitx5()
    if not exe:
        print("no fcitx5 here: install it, or unpack its package and set FCITX5_ROOT")
        return 2
    try:
        import gi  # noqa: F401
        from gi.repository import Gio  # noqa: F401
    except ImportError:
        print("needs python-gobject (gi) for D-Bus")
        return 2
    if not shutil.which("dbus-daemon"):
        print("needs dbus-daemon")
        return 2
    keys = amarchy_keys()
    print("amarchy's keys: " + ", ".join(k[0] for k in keys))
    work = Path(os.environ.get("TMPDIR") or tempfile.gettempdir())
    configs = [("fcitx5's own defaults", None)]
    om = omarchy_config()
    if om:
        configs.append(("Omarchy's", om))
    else:
        note("no Omarchy checkout (OMARCHY_SRC): its config not tested")
    mine = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "fcitx5"
    if mine.is_dir():
        configs.append(("yours", mine))
    configs += [(f"--config {c}", Path(c).expanduser()) for c in args.config]
    for where, config in configs:
        run(where, config, exe, env, keys, work)
    print()
    if failed:
        print(f"{len(failed)} failed:\n  " + "\n  ".join(failed))
        return 1
    print("All passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
