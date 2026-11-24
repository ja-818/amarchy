#!/usr/bin/env python3
"""amarchy's keys through a real input method, in the real app: Omarchy's
Chromium and the desktop app's WebKitGTK, on a Wayland desktop with fcitx5.

On Omarchy fcitx5 has every box before the page does (the compositor gives
it the keys while a box takes text), and keeps what it binds: Ctrl+Alt+H (its
word hints: a list under all you type, in every app, until pressed again), J
(a hint for one word), P (its preedit), all three amarchy's too. amarchy
keeps them: while Ctrl and Alt are down its box stops taking text, fcitx5
lets go of the keyboard, and the key is amarchy's (app/desk.js, imKeys).
Here, for each browser:

- a desktop of its own: sway with no screen (headless), fcitx5 on it with
  Omarchy's config (its D-Bus the test's own), and a keyboard on its seat
  with a real US keymap (a small Wayland client built here: the page gets
  each key's own KeyboardEvent.code, as from a person's keyboard; the letter
  30 ms after Ctrl+Alt, as a person's chord: 5 ms is enough);
- the app (this checkout's, with demo chats), a chat open, typing in its box:
  fcitx5 has it, what's typed goes in through it;
- without the stepping aside (turned off, as it was): H J P never get to the
  page from the box (fcitx5's: what Julian hit);
- with it: every Ctrl+Alt key of amarchy's (app/desk.js) gets to the page
  from the box, fcitx5's hints never come on (what's typed next goes in, the
  box taking text again), Ctrl+Alt+Shift+U is still fcitx5's (its Unicode
  entry) and Ctrl+Alt+? amarchy's;
- and they do amarchy's things from the box: H the board, L the chat again
  (what you wrote still there, the keys in its box), K J Tasks and Chats, /
  the keys (H / L and J / K in them, O the preview), M the menu; Ctrl+Alt held down
  across them, L into a chat and H back out of it (the box it lands in steps
  aside too).

Browsers: Chromium as Omarchy starts it (its chromium-flags.conf: Wayland),
Chromium with --enable-wayland-ime, and WebKitGTK 4.1 under GTK 3, what
amarchy's desktop app (Tauri) is. Each one that isn't here is said, and
skipped.

Needs sway, dbus-daemon, a C compiler with wayland-client and xkbcommon
(wayland-scanner too), fcitx5 (/usr/bin/fcitx5, or a package unpacked in
FCITX5_ROOT, as test/input-method-keys.py says), and for the browsers
chromium (CHROME= another) and python-gobject with WebKit2 4.1. Omarchy's
fcitx5 config from OMARCHY_SRC (default /tmp/omarchy-src/omarchy), else
fcitx5's own defaults.

    python3 test/input-method-view.py               # every browser here
    python3 test/input-method-view.py webkit        # one: omarchy | ime | webkit

Exits 0 when every check passed, 1 when one failed, 2 when it can't run here.
"""
import base64
import http.client
import http.server
import importlib.util
import json
import os
import re
import shutil
import signal
import socket
import socketserver
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent)); import homes      # (test/homes.py: its home gone with it, however it ends)

REPO = Path(__file__).resolve().parent.parent
BIN = REPO / "bin/amarchy"
ONLY = sys.argv[1] if len(sys.argv) > 1 else None
SHOTS = Path(os.environ["SHOTS"]) if os.environ.get("SHOTS") else None
failed = []


def check(where, ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {where}: {what}", flush=True)
    if not ok:
        failed.append(f"{where}: {what}")
    return ok


def keys_of_amarchy():
    spec = importlib.util.spec_from_file_location("input_method_keys", REPO / "test/input-method-keys.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


# ---- a keyboard on the seat: a real US keymap, real keycodes

VK_XML = """<?xml version="1.0" encoding="UTF-8"?>
<protocol name="virtual_keyboard_unstable_v1">
  <interface name="zwp_virtual_keyboard_v1" version="1">
    <request name="keymap"><arg name="format" type="uint"/><arg name="fd" type="fd"/><arg name="size" type="uint"/></request>
    <request name="key"><arg name="time" type="uint"/><arg name="key" type="uint"/><arg name="state" type="uint"/></request>
    <request name="modifiers"><arg name="mods_depressed" type="uint"/><arg name="mods_latched" type="uint"/>
      <arg name="mods_locked" type="uint"/><arg name="group" type="uint"/></request>
    <request name="destroy" type="destructor" since="1"/>
  </interface>
  <interface name="zwp_virtual_keyboard_manager_v1" version="1">
    <request name="create_virtual_keyboard"><arg name="seat" type="object" interface="wl_seat"/>
      <arg name="id" type="new_id" interface="zwp_virtual_keyboard_v1"/></request>
  </interface>
  <interface name="zwlr_virtual_pointer_v1" version="1">
    <request name="destroy" type="destructor"/>
  </interface>
  <interface name="zwlr_virtual_pointer_manager_v1" version="1">
    <request name="create_virtual_pointer"><arg name="seat" type="object" interface="wl_seat" allow-null="true"/>
      <arg name="id" type="new_id" interface="zwlr_virtual_pointer_v1"/></request>
  </interface>
</protocol>
"""

# (wtype makes up a keymap of its own for what it types: the page would see
# every key as Escape's, its first keycode.)
VK_C = r"""
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/mman.h>
#include <time.h>
#include <wayland-client.h>
#include <xkbcommon/xkbcommon.h>
#include "vk-protocol.h"

static struct wl_display *display;
static struct wl_seat *seat;
static struct zwp_virtual_keyboard_manager_v1 *manager;
static struct zwp_virtual_keyboard_v1 *kb;
static struct zwlr_virtual_pointer_manager_v1 *pointers;
static struct xkb_keymap *keymap;
static int gap_ms = 30;
static uint32_t held;

static void global(void *d, struct wl_registry *r, uint32_t name, const char *iface, uint32_t v) {
  if (!strcmp(iface, wl_seat_interface.name)) seat = wl_registry_bind(r, name, &wl_seat_interface, 1);
  else if (!strcmp(iface, zwp_virtual_keyboard_manager_v1_interface.name))
    manager = wl_registry_bind(r, name, &zwp_virtual_keyboard_manager_v1_interface, 1);
  else if (!strcmp(iface, zwlr_virtual_pointer_manager_v1_interface.name))
    pointers = wl_registry_bind(r, name, &zwlr_virtual_pointer_manager_v1_interface, 1);
}
static void global_remove(void *d, struct wl_registry *r, uint32_t name) {}
static const struct wl_registry_listener reg = { global, global_remove };

static uint32_t now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec * 1000 + t.tv_nsec / 1000000; }

static int find(xkb_keysym_t sym, xkb_keycode_t *code, int *shift) {
  for (xkb_keycode_t k = xkb_keymap_min_keycode(keymap); k <= xkb_keymap_max_keycode(keymap); k++)
    for (int level = 0; level < 2; level++) {
      const xkb_keysym_t *syms;
      int n = xkb_keymap_key_get_syms_by_level(keymap, k, 0, level, &syms);
      for (int i = 0; i < n; i++) if (syms[i] == sym) { *code = k; *shift = level; return 1; }
    }
  return 0;
}

static uint32_t mask(const char *name) { return 1u << xkb_keymap_mod_get_index(keymap, name); }
static void key(uint32_t code, int down) { zwp_virtual_keyboard_v1_key(kb, now(), code - 8, down); }
static void mods(uint32_t m) { zwp_virtual_keyboard_v1_modifiers(kb, m, 0, 0, 0); }

// As a person does: Control_L, then Alt_L (then Shift_L) held, the key, all let go.
static int press(xkb_keysym_t sym, int ctrl, int alt, int shift) {
  xkb_keycode_t code; int level;
  if (!find(sym, &code, &level)) return 0;
  shift |= level;
  uint32_t m = 0;
  if (ctrl) { key(37, 1); m |= mask(XKB_MOD_NAME_CTRL); mods(m); }
  if (alt) { key(64, 1); m |= mask(XKB_MOD_NAME_ALT); mods(m); }
  if (shift) { key(50, 1); m |= mask(XKB_MOD_NAME_SHIFT); mods(m); }
  if (m && gap_ms) { wl_display_roundtrip(display); usleep(gap_ms * 1000); }
  key(code, 1);
  wl_display_roundtrip(display);
  usleep(20000);
  key(code, 0);
  if (shift) { key(50, 0); m &= ~mask(XKB_MOD_NAME_SHIFT); mods(m); }
  if (alt) { key(64, 0); m &= ~mask(XKB_MOD_NAME_ALT); mods(m); }
  if (ctrl) { key(37, 0); mods(0); }
  if (held) mods(held);
  wl_display_roundtrip(display);
  usleep(20000);
  return 1;
}

// A key held down, or let go: Control_L, Alt_L and Shift_L keep the modifiers as a keyboard does.
static int hold(xkb_keysym_t sym, int down) {
  xkb_keycode_t code; int level;
  if (!find(sym, &code, &level)) return 0;
  uint32_t bit = sym == XKB_KEY_Control_L ? mask(XKB_MOD_NAME_CTRL) : sym == XKB_KEY_Alt_L ? mask(XKB_MOD_NAME_ALT)
               : sym == XKB_KEY_Shift_L ? mask(XKB_MOD_NAME_SHIFT) : 0;
  if (!bit && down && held && gap_ms) usleep(gap_ms * 1000);
  key(code, down);
  if (bit) { held = down ? held | bit : held & ~bit; mods(held); }
  wl_display_roundtrip(display);
  usleep(20000);
  return 1;
}

int main(void) {
  display = wl_display_connect(NULL);
  if (!display) { fprintf(stderr, "no Wayland display\n"); return 1; }
  struct wl_registry *r = wl_display_get_registry(display);
  wl_registry_add_listener(r, &reg, NULL);
  wl_display_roundtrip(display);
  if (!seat || !manager) { fprintf(stderr, "no seat, or no virtual keyboards here\n"); return 1; }
  kb = zwp_virtual_keyboard_manager_v1_create_virtual_keyboard(manager, seat);
  // And a mouse, as a computer has: a seat without one is a touch screen's to a
  // browser (no hover, no fine pointer), and amarchy would take the phone layout.
  if (pointers) zwlr_virtual_pointer_manager_v1_create_virtual_pointer(pointers, seat);
  struct xkb_context *ctx = xkb_context_new(XKB_CONTEXT_NO_FLAGS);
  struct xkb_rule_names names = { .rules = "evdev", .model = "pc105", .layout = "us" };
  keymap = xkb_keymap_new_from_names(ctx, &names, XKB_KEYMAP_COMPILE_NO_FLAGS);
  if (!keymap) { fprintf(stderr, "no US keymap\n"); return 1; }
  char *text = xkb_keymap_get_as_string(keymap, XKB_KEYMAP_FORMAT_TEXT_V1);
  size_t size = strlen(text) + 1;
  int fd = memfd_create("keymap", MFD_CLOEXEC);
  if (fd < 0 || write(fd, text, size) != (ssize_t)size) { fprintf(stderr, "no keymap file\n"); return 1; }
  zwp_virtual_keyboard_v1_keymap(kb, WL_KEYBOARD_KEYMAP_FORMAT_XKB_V1, fd, size);
  wl_display_roundtrip(display);
  printf("ready\n"); fflush(stdout);
  char line[4096];
  while (fgets(line, sizeof line, stdin)) {
    line[strcspn(line, "\n")] = 0;
    int ok = 1;
    if (!strncmp(line, "type ", 5)) {
      for (const char *c = line + 5; *c; c++) ok &= press(xkb_utf32_to_keysym((unsigned char)*c), 0, 0, 0);
    } else if (!strncmp(line, "key ", 4)) {
      char *save, *name = strtok_r(line + 4, " ", &save), *w;
      int ctrl = 0, alt = 0, shift = 0;
      while ((w = strtok_r(NULL, " ", &save))) { ctrl |= !strcmp(w, "ctrl"); alt |= !strcmp(w, "alt"); shift |= !strcmp(w, "shift"); }
      xkb_keysym_t sym = name ? xkb_keysym_from_name(name, XKB_KEYSYM_NO_FLAGS) : XKB_KEY_NoSymbol;
      ok = sym != XKB_KEY_NoSymbol && press(sym, ctrl, alt, shift);
    } else if (!strncmp(line, "down ", 5) || !strncmp(line, "up ", 3)) {
      int down = line[0] == 'd';
      xkb_keysym_t sym = xkb_keysym_from_name(line + (down ? 5 : 3), XKB_KEYSYM_NO_FLAGS);
      ok = sym != XKB_KEY_NoSymbol && hold(sym, down);
    } else if (!strncmp(line, "gap ", 4)) gap_ms = atoi(line + 4);
    else ok = 0;
    printf(ok ? "ok\n" : "no\n");
    fflush(stdout);
  }
  return 0;
}
"""

# KeyboardEvent.code -> the keysym the keyboard sends for it.
SYMS = {"ArrowLeft": "Left", "ArrowRight": "Right", "ArrowUp": "Up", "ArrowDown": "Down", "Enter": "Return",
        "NumpadEnter": "KP_Enter", "Slash": "slash"}


def sym_of(code):
    return SYMS.get(code) or (code[3:].lower() if code.startswith("Key") else None)


class Keyboard:
    def __init__(self, exe, env):
        self.p = subprocess.Popen([str(exe)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
        first = self.p.stdout.readline().strip()
        if first != "ready":
            raise RuntimeError(f"the keyboard didn't start: {self.p.stderr.read()[-300:]}")

    def send(self, line):
        self.p.stdin.write(line + "\n")
        self.p.stdin.flush()
        return self.p.stdout.readline().strip() == "ok"

    def press(self, code, shift=False):
        return self.send(f"key {sym_of(code)} ctrl alt" + (" shift" if shift else ""))

    def type(self, text):
        return self.send(f"type {text}")

    def down(self, sym):
        return self.send(f"down {sym}")

    def up(self, sym):
        return self.send(f"up {sym}")

    def close(self):
        if self.p.poll() is None:
            self.p.terminate()


def build_keyboard(work):
    d = work / "vk"
    d.mkdir()
    (d / "vk.xml").write_text(VK_XML)
    (d / "vk.c").write_text(VK_C)
    try:
        subprocess.run(["wayland-scanner", "client-header", "vk.xml", "vk-protocol.h"], cwd=d, check=True, capture_output=True)
        subprocess.run(["wayland-scanner", "private-code", "vk.xml", "vk-protocol.c"], cwd=d, check=True, capture_output=True)
        flags = subprocess.run(["pkg-config", "--cflags", "--libs", "wayland-client", "xkbcommon"], check=True, capture_output=True, text=True).stdout.split()
        subprocess.run(["cc", "-O1", "-o", "vk", "vk.c", "vk-protocol.c", *flags], cwd=d, check=True, capture_output=True, text=True)
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        raise RuntimeError(f"can't build the keyboard: {getattr(e, 'stderr', '') or e}")
    return d / "vk"


# ---- the app, with demo chats (as test/chat-keys.js has them)

ID, TWO = "proj-keys", "proj-other"


def demo_chats():
    now = time.time()
    t = lambda **o: {"goal": "", "state": "", "goal_at": 0, "asks": [], "at": now - 600, **o}
    return [
        {"id": ID, "repo": "proj", "name": "keys", "task": "Fix: the login loop", "status": "idle", "engine": "chat", "path": "/tmp/k", "today": t(goal="Fix the login loop")},
        {"id": TWO, "repo": "proj", "name": "other", "task": "Docs: the keys page", "status": "idle", "engine": "chat", "path": "/tmp/o", "today": t(goal="Write the keys page")},
    ]


ITEMS = [{"kind": "user", "text": "Plan it", "turn": True, "key": "u1:0", "rec": "u1", "at": ""},
         {"kind": "claude", "text": "The plan is done.", "key": "c1:0", "at": ""}]

# Before the app's own scripts: the demo chats in its view, and what Ctrl+Alt
# reaches the page (window.__seen); with window.__swallow, nothing done with it.
INIT = """(() => {
  const chats = %s;
  try { localStorage.setItem("tour", "1"); localStorage.setItem("amarchy-push", "no"); } catch (e) { /* no storage */ }
  window.__chat = () => (app.desk ? desk.chat : app.session && app.session.chat);
  const parse = JSON.parse;
  JSON.parse = function (text, ...rest) {
    const v = parse.call(this, text, ...rest);
    if (v && typeof v === "object" && Array.isArray(v.sessions) && "share" in v) {
      v.sessions = chats.map((c) => ({ ...c, today: { ...c.today } }));
      v.projects = [{ name: "proj", sessions: chats.length }];
      v.today = { loops: [], source: "", error: "", sent: {}, assistant: null };
    }
    return v;
  };
  window.__seen = [];
  window.__swallow = false;
  addEventListener("keydown", (e) => {
    if (!e.ctrlKey || !e.altKey || /^(Control|Alt|Shift|Meta)/.test(e.code)) return;
    __seen.push(e.code + (e.shiftKey ? "+shift" : ""));
    if (__swallow) { e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
})();"""


def app_server(home, port):
    src = (REPO / "test/today-view.js").read_text()
    shim = re.search(r"const SHIM = `\n(.*?)`;", src, re.S)[1]
    p = subprocess.Popen(["python3", "-c", shim, str(BIN), str(port), str(home)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if not p.stdout.readline():
        raise RuntimeError(f"the app server didn't start: {p.stderr.read()[-400:]}")
    return p


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Proxy(socketserver.ThreadingMixIn, http.server.HTTPServer):
    """The app server, but the demo chats' own calls answered here (their stream, their composer...)."""
    daemon_threads = True

    def __init__(self, upstream):
        self.upstream = upstream
        super().__init__(("127.0.0.1", 0), ProxyHandler)


class ProxyHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def demo(self):
        m = re.match(r"/api/session/([^/?]+)/(\w+)", self.path)
        if not m or m[1] not in (ID, TWO):
            return False
        what = m[2]
        if what == "stream":
            chat = next(c for c in demo_chats() if c["id"] == m[1])
            ev = lambda name, data: f"event: {name}\ndata: {json.dumps(data)}\n\n"
            body = ("retry: 600000\n\n" + ev("session", chat) + ev("live", {"state": "idle", "pending": [], "queue": []})
                    + ev("conversation", {"reset": True, "items": ITEMS, "start": 0}) + ev("screen", {"live": True})).encode()
            kind = "text/event-stream"
        else:
            data = {"composer": {"engine": "chat", "commands": [], "models": [], "model": "opus", "mode": "default"},
                    "agent": {"agent": {}, "live": {}}}.get(what, {"ok": True})
            body, kind = json.dumps(data).encode(), "application/json"
        n = int(self.headers.get("Content-Length") or 0)
        if n:
            self.rfile.read(n)
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        return True

    def forward(self):
        if self.demo():
            return
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else None
        up = http.client.HTTPConnection("127.0.0.1", self.server.upstream, timeout=600)
        headers = {k: v for k, v in self.headers.items() if k.lower() not in ("connection", "keep-alive", "accept-encoding")}
        try:
            up.request(self.command, self.path, body=body, headers=headers)
            r = up.getresponse()
        except OSError:
            self.send_error(502)
            return
        self.send_response(r.status)
        length = r.getheader("Content-Length")
        for k, v in r.getheaders():
            if k.lower() not in ("connection", "keep-alive", "transfer-encoding", "content-length"):
                self.send_header(k, v)
        if length is not None:
            self.send_header("Content-Length", length)
        else:
            self.send_header("Connection", "close")
            self.close_connection = True
        self.end_headers()
        try:
            while True:
                chunk = r.read1(65536)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except OSError:
            pass
        finally:
            up.close()

    do_GET = do_POST = do_PUT = do_DELETE = do_HEAD = forward


# ---- the desktop: sway with no screen, fcitx5 on it

class Desktop:
    """Everything here runs in a session of its own, stopped whole at the end with SIGKILL
    (sway and Chromium can crash at SIGTERM, and Omarchy toasts every crash), leaving no core
    file; its D-Bus starts nothing (no portals, no notifications: input-method-keys.py's BUS_CONF)."""

    def __init__(self, work, fcitx_exe, fcitx_env, config, m):
        self.work = work
        self.procs = []
        self.m = m
        run = work / "run"
        run.mkdir(mode=0o700)
        (work / "bus.conf").write_text(m.BUS_CONF.format(sock=work / "bus"))
        bus = self.start(["dbus-daemon", f"--config-file={work / 'bus.conf'}", "--nofork", "--nopidfile", "--print-address=1"],
                         stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        address = bus.stdout.readline().strip()
        self.env = {k: v for k, v in os.environ.items() if k not in ("WAYLAND_DISPLAY", "DISPLAY", "DBUS_SESSION_BUS_ADDRESS", "GTK_IM_MODULE")}
        # (Omarchy's environment.d: fcitx for Qt, SDL and X; GTK on Wayland goes through text-input, as there.)
        self.env.update(XDG_RUNTIME_DIR=str(run), DBUS_SESSION_BUS_ADDRESS=address, INPUT_METHOD="fcitx", QT_IM_MODULE="fcitx",
                        XMODIFIERS="@im=fcitx", SDL_IM_MODULE="fcitx", NO_AT_BRIDGE="1")
        (work / "sway.conf").write_text("output HEADLESS-1 resolution 1280x800\ndefault_border none\nfocus_follows_mouse no\n")
        sway_env = dict(self.env, WLR_BACKENDS="headless", WLR_RENDERER="pixman", WLR_LIBINPUT_NO_DEVICES="1")
        self.start(["sway", "-c", str(work / "sway.conf")], env=sway_env, stdout=open(work / "sway.log", "w"), stderr=subprocess.STDOUT)
        for _ in range(100):
            socks = [s for s in run.glob("wayland-*") if not s.name.endswith(".lock")]
            if socks:
                break
            time.sleep(0.05)
        else:
            raise RuntimeError(f"sway didn't start: {(work / 'sway.log').read_text()[-400:]}")
        self.env["WAYLAND_DISPLAY"] = socks[0].name
        cfg = work / "fcitx5-config"
        if config:
            shutil.copytree(config, cfg)
        else:
            cfg.mkdir()
        fx_env = dict(self.env, **fcitx_env, FCITX_CONFIG_HOME=str(cfg), FCITX_DATA_HOME=str(work / "fcitx5-data"))
        self.start([str(fcitx_exe), "--disable=xcb,xim,kimpanel,notificationitem,notifications,ibusfrontend,fcitx4frontend"],
                   env=fx_env, stdout=open(work / "fcitx5.log", "w"), stderr=subprocess.STDOUT)
        from gi.repository import Gio, GLib
        self.GLib = GLib
        self.bus = Gio.DBusConnection.new_for_address_sync(
            address, Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, None, None)
        for _ in range(200):
            try:
                self.controller("State", "(i)")
                break
            except Exception:
                time.sleep(0.05)
        else:
            raise RuntimeError(f"fcitx5 didn't start: {(work / 'fcitx5.log').read_text()[-400:]}")
        time.sleep(0.8)      # (its Wayland input method up)

    def controller(self, method, rtype):
        v = self.bus.call_sync("org.fcitx.Fcitx5", "/controller", "org.fcitx.Fcitx.Controller1", method, None,
                               self.GLib.VariantType(rtype), 0, 3000, None)
        return v.unpack()[0]

    def im_has_a_box(self):
        """fcitx5's input method on a focused box (else it's ""): the keys go through it."""
        try:
            return self.controller("CurrentInputMethod", "(s)")
        except Exception:
            return ""

    def start(self, args, **kw):
        p = subprocess.Popen(args, start_new_session=True, preexec_fn=self.m.no_core_files, **kw)
        self.procs.append(p)
        return p

    def spawn(self, args, log, **kw):
        return self.start(args, stdout=kw.pop("stdout", open(self.work / log, "w")), stderr=kw.pop("stderr", subprocess.STDOUT), **kw)

    def close(self):
        for p in reversed(self.procs):      # (the last started first)
            self.m.stop(p)

# ---- the browsers: each answers js(code)

class Chromium:
    """Chromium on the desktop, driven over its DevTools protocol (a websocket of our own: no packages)."""

    def __init__(self, desktop, url, init, flags, name):
        self.desktop = desktop
        self.port = free_port()
        prof = desktop.work / f"chromium-{name}"
        exe = os.environ.get("CHROME") or shutil.which("chromium") or shutil.which("chromium-browser")
        self.p = desktop.spawn([exe, f"--user-data-dir={prof}", *flags, "--no-first-run", "--no-default-browser-check",
                                f"--remote-debugging-port={self.port}", "--remote-allow-origins=*", "about:blank"],
                               f"chromium-{name}.log", env=desktop.env)
        for _ in range(200):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json"))
                page = [t for t in tabs if t["type"] == "page"]
                if page:
                    break
            except OSError:
                pass
            if self.p.poll() is not None:
                raise RuntimeError(f"Chromium stopped ({self.p.returncode}): {(desktop.work / f'chromium-{name}.log').read_text()[-400:]}")
            time.sleep(0.1)
        else:
            raise RuntimeError("Chromium never opened a page")
        self.sock = self.connect(page[0]["webSocketDebuggerUrl"])
        self.n = 0
        self.cdp("Page.enable")
        self.cdp("Page.addScriptToEvaluateOnNewDocument", source=init)
        self.cdp("Page.navigate", url=url)

    def connect(self, ws):
        hostport, path = ws[len("ws://"):].split("/", 1)
        host, port = hostport.split(":")
        s = socket.create_connection((host, int(port)))
        key = base64.b64encode(os.urandom(16)).decode()
        s.sendall(f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                  f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode())
        head = b""
        while b"\r\n\r\n" not in head:
            head += s.recv(1)
        if b" 101 " not in head.split(b"\r\n")[0]:
            raise RuntimeError(f"DevTools refused the websocket: {head[:200]}")
        return s

    def _exactly(self, n):
        b = b""
        while len(b) < n:
            chunk = self.sock.recv(n - len(b))
            if not chunk:
                raise RuntimeError("DevTools closed")
            b += chunk
        return b

    def _recv(self):
        data = b""
        while True:
            a, ln = self._exactly(2)
            fin, op, ln = a & 0x80, a & 0x0f, ln & 0x7f
            if ln == 126:
                ln = struct.unpack(">H", self._exactly(2))[0]
            elif ln == 127:
                ln = struct.unpack(">Q", self._exactly(8))[0]
            payload = self._exactly(ln)
            if op == 9:      # a ping
                continue
            data += payload
            if fin:
                return json.loads(data)

    def cdp(self, method, **params):
        self.n += 1
        msg = json.dumps({"id": self.n, "method": method, "params": params}).encode()
        mask = os.urandom(4)
        n = len(msg)
        head = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n) if n < 65536
                                else bytes([0x80 | 127]) + struct.pack(">Q", n))
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(msg)))
        while True:
            m = self._recv()
            if m.get("id") == self.n:
                if "error" in m:
                    raise RuntimeError(f"{method}: {m['error']}")
                return m.get("result", {})

    def js(self, code):
        r = self.cdp("Runtime.evaluate", expression=code, returnByValue=True, awaitPromise=True)
        if r.get("exceptionDetails"):
            raise RuntimeError(f"in the page: {r['exceptionDetails'].get('exception', {}).get('description') or r['exceptionDetails']}")
        return r["result"].get("value")

    def shot(self, path):
        path.write_bytes(base64.b64decode(self.cdp("Page.captureScreenshot", format="png")["data"]))

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass
        self.desktop.m.stop(self.p)      # (all of it at once: SIGTERM can crash its helpers)


KIOSK = r"""
import json, sys
import gi
gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, WebKit2, GLib
url, init = sys.argv[1], open(sys.argv[2]).read()
ucm = WebKit2.UserContentManager()
ucm.add_script(WebKit2.UserScript(init, WebKit2.UserContentInjectedFrames.TOP_FRAME, WebKit2.UserScriptInjectionTime.START, None, None))
view = WebKit2.WebView.new_with_user_content_manager(ucm)
win = Gtk.Window(title="amarchy")
win.set_default_size(1280, 800)
win.add(view)
win.show_all()
win.connect("destroy", Gtk.main_quit)
def say(obj):
    print(json.dumps(obj), flush=True)
def done(v, res, _):
    try:
        r = v.evaluate_javascript_finish(res)
        say({"value": None if r.is_undefined() or r.is_null() else json.loads(r.to_json(0))})
    except Exception as e:
        say({"error": str(e)})
def line(ch, cond):
    s = ch.readline()
    if not s:
        Gtk.main_quit()
        return False
    view.evaluate_javascript(json.loads(s)["js"], -1, None, None, None, done, None)
    return True
GLib.io_add_watch(GLib.IOChannel.unix_new(0), GLib.IO_IN | GLib.IO_HUP, line)
view.load_uri(url)
say({"ready": True})
Gtk.main()
"""


class WebKitGTK:
    """WebKitGTK 4.1 under GTK 3 in a window of its own: what the desktop app (Tauri) is."""

    def __init__(self, desktop, url, init, name):
        self.desktop = desktop
        (desktop.work / "kiosk.py").write_text(KIOSK)
        (desktop.work / "init.js").write_text(init)
        home = desktop.work / "webkit-home"
        home.mkdir()
        env = dict(desktop.env, GDK_BACKEND="wayland", HOME=str(home), XDG_DATA_HOME=str(home / "data"), XDG_CACHE_HOME=str(home / "cache"))
        self.p = desktop.spawn(["python3", "-I", str(desktop.work / "kiosk.py"), url, str(desktop.work / "init.js")], "webkit.log",
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(desktop.work / "webkit.log", "w"), text=True, env=env)
        if '"ready"' not in self.p.stdout.readline():
            raise RuntimeError(f"WebKitGTK didn't start: {(desktop.work / 'webkit.log').read_text()[-400:]}")

    def js(self, code):
        # (an async function's promise, awaited by the caller: evaluate_javascript takes no await)
        self.p.stdin.write(json.dumps({"js": code}) + "\n")
        self.p.stdin.flush()
        r = json.loads(self.p.stdout.readline())
        if "error" in r:
            raise RuntimeError(f"in the page: {r['error']}")
        return r["value"]

    def shot(self, path):
        pass

    def close(self):
        self.desktop.m.stop(self.p)


def until(b, code, ms=8000):
    end = time.time() + ms / 1000
    while time.time() < end:
        try:
            if b.js(f"!!(() => {{ try {{ return {code}; }} catch (e) {{ return false; }} }})()"):
                return True
        except RuntimeError:
            pass
        time.sleep(0.1)
    return False


def desk_js(name, opener):
    """A block of app/desk.js: const <name> = <opener>...; its keys, as KeyboardEvent.codes."""
    src = (REPO / "app/desk.js").read_text()
    close = {"{": r"\n\};", "[": r"\];"}[opener]
    block = re.search(rf"const {name} = \{opener}(.*?){close}", src, re.S)[1]
    return re.findall(r'(\w+):' if opener == "{" else r'"(\w+)"', block)


def amarchy_codes():
    """amarchy's Ctrl+Alt keys ('Slash?' for Ctrl+Alt+?)."""
    codes = desk_js("APP_KEYS", "{") + desk_js("TALK_KEYS", "[")
    return codes + (["Slash?"] if "Slash" in codes else [])


def run(where, name, b, desktop, kb):
    if not check(where, until(b, "typeof app !== 'undefined' && app.view && document.querySelector('.tcard .today-go')", 20000), "the app, its board with the demo chats"):
        return
    size = b.js("`${innerWidth}×${innerHeight}, ${matchMedia('(hover: hover) and (pointer: fine)').matches ? 'a mouse' : 'no mouse'}`")
    check(where, b.js("app.desk") is True, f"the wide layout ({size})")
    check(where, b.js("imAside.on") is True, "on Linux: the input method steps aside for Ctrl+Alt")
    box = "__chat().input"
    value = lambda: b.js(f"{box}.value")

    # A chat open, typing in its box: the input method has it.
    b.js(f"boardOpen({json.dumps(ID)}); true")
    if not check(where, until(b, "__chat() && __chat().id === 'proj-keys' && __chat().scroller.isConnected && !!document.querySelector('.chat .msg.claude')"), "the chat open"):
        return
    time.sleep(0.6)
    b.js(f"{box}.focus(); true")
    time.sleep(0.4)
    im = desktop.im_has_a_box()
    if not check(where, im != "", f"in its box, fcitx5 has the keys ({im or 'no input context focused'})"):
        return
    kb.type("half")
    check(where, until(b, f"{box}.value === 'half'", 3000), f"typed through it: {value()!r}")

    # Without the stepping aside (as it was): fcitx5 takes H J P in the box; amarchy never sees them.
    b.js("imAside.on = false; __swallow = true; __seen.length = 0; true")
    for code in ("KeyH", "KeyJ", "KeyP"):
        kb.press(code)
    time.sleep(0.3)
    seen = b.js("__seen.slice()") or []
    check(where, not seen, f"without stepping aside, Ctrl+Alt+H J P from the box never get to the page: fcitx5's ({', '.join(seen) or 'none got there'})")
    for code in ("KeyH", "KeyJ", "KeyP"):      # (again: its hints, its one-word hint and its preedit as they were)
        kb.press(code)
    time.sleep(0.2)
    b.js(f"{box}.value = 'half'; __chat().typed(); imAside.on = true; true")

    # With it: every key of amarchy's gets to the page from the box (nothing done with them here).
    b.js("__seen.length = 0; true")
    sent = []
    for code in amarchy_codes():
        shift = code == "Slash?"
        real = "Slash" if shift else code
        kb.press(real, shift=shift)
        sent.append((code, real + ("+shift" if shift else "")))
    time.sleep(0.3)
    seen = b.js("__seen.slice()") or []
    missing = [c for c, s in sent if s not in seen]
    check(where, not missing, "from the box, every amarchy key gets to the page" + (f": not {', '.join(missing)}" if missing else f" ({len(sent)}, H and J too)"))
    kb.type(" ok")
    check(where, until(b, f"{box}.value === 'half ok' && !{box}.readOnly", 3000),
          f"fcitx5's hints never came on: what's typed next goes in, the box taking text again ({value()!r})")

    # Ctrl+Alt+Shift stays the input method's: its Unicode entry takes U; amarchy's ? still gets through.
    b.js("__seen.length = 0; true")
    kb.press("KeyU", shift=True)
    time.sleep(0.3)
    check(where, "KeyU+shift" not in (b.js("__seen.slice()") or []), "Ctrl+Alt+Shift+U from the box: fcitx5's (its Unicode entry)")
    kb.send("key Escape")
    time.sleep(0.2)
    b.js(f"{box}.value = 'half'; __chat().typed(); true")
    kb.press("Slash", shift=True)
    time.sleep(0.3)
    check(where, "Slash+shift" in (b.js("__seen.slice()") or []), "and Ctrl+Alt+? amarchy's")

    # From the box, they do amarchy's things.
    b.js("__swallow = false; true")
    kb.press("KeyH")
    check(where, until(b, "!openId() && !!document.querySelector('.tcard .today-go')", 4000), "Ctrl+Alt+H from the box, typing: the board")
    kb.press("KeyL")
    check(where, until(b, f"openId() === 'proj-keys' && document.activeElement === {box}", 4000), "Ctrl+Alt+L: the chat again, the keys in its box")
    check(where, until(b, f"{box}.value === 'half'", 2000), f"what you wrote still there ({value()!r})")
    kb.type("!")
    check(where, until(b, f"{box}.value === 'half!' && !{box}.readOnly", 2000), f"typed: it goes in ({value()!r})")
    check(where, desktop.im_has_a_box() != "", "and the input method on it again")
    kb.press("KeyK")
    check(where, until(b, "!openId() && board.tab === 'tasks'", 4000), "Ctrl+Alt+K from the chat: the board, on Tasks")
    kb.press("KeyJ")
    check(where, until(b, "board.tab === 'chats'", 4000), "Ctrl+Alt+J: Chats")

    # Held down across them: L into the chat lit (the keys in its box: it steps aside too), H back out.
    b.js(f"boardSelectId({json.dumps(ID)}); true")
    kb.down("Control_L")
    kb.down("Alt_L")
    kb.down("l")
    kb.up("l")
    into = until(b, f"openId() === 'proj-keys' && document.activeElement === {box}", 4000)
    time.sleep(0.3)
    kb.down("h")
    kb.up("h")
    check(where, into and until(b, "!openId()", 4000), "Ctrl+Alt held: L into the chat, then H back out (its box stepped aside too)")
    kb.up("Alt_L")
    kb.up("Control_L")

    b.js(f"boardOpen({json.dumps(ID)}); true")
    until(b, "openId() === 'proj-keys'")
    time.sleep(0.5)
    b.js(f"{box}.focus(); true")
    time.sleep(0.3)
    kb.press("Slash")
    sheet = "(document.querySelector('.sheet') || {}).innerText || ''"
    check(where, until(b, f"/H \\/ L/.test({sheet}) && /J \\/ K/.test({sheet}) && /Ctrl\\+Alt\\+O\\b/.test({sheet})", 4000), "Ctrl+Alt+/ from the box: the keys, H / L, J / K and O in them")
    if SHOTS:
        time.sleep(0.6)      # (the sheet in)
        b.shot(SHOTS / f"{name}-keys.png")
    kb.press("KeyM")
    check(where, until(b, "!!document.querySelector('.picker, .sheet-back') && /New chat/.test((document.querySelector('.picker') || [...document.querySelectorAll('.sheet')].pop()).innerText)", 4000),
          "Ctrl+Alt+M: the menu (the keys sheet put away)")


def main():
    m = keys_of_amarchy()
    need = [t for t in ("sway", "dbus-daemon", "cc", "wayland-scanner", "pkg-config") if not shutil.which(t)]
    fcitx_exe, fcitx_env = m.find_fcitx5()
    if not fcitx_exe:
        need.append("fcitx5 (or FCITX5_ROOT)")
    try:
        import gi
        from gi.repository import Gio  # noqa: F401
    except ImportError:
        need.append("python-gobject")
    if need:
        print("can't run here, needs: " + ", ".join(need))
        return 2
    chrome = os.environ.get("CHROME") or shutil.which("chromium") or shutil.which("chromium-browser")
    try:
        gi.require_version("Gtk", "3.0")
        gi.require_version("WebKit2", "4.1")
        webkit = True
    except ValueError:
        webkit = False
    om = m.omarchy_config()
    omarchy_flags = ["--ozone-platform=wayland", "--ozone-platform-hint=wayland"]
    if om:
        conf = om.parent.parent / "config/chromium-flags.conf"
        if conf.exists():
            omarchy_flags = [l.strip() for l in conf.read_text().splitlines()
                             if l.strip().startswith("--") and not l.strip().startswith(("--load-extension", "--password-store"))]
    browsers = [("omarchy", "Chromium, as Omarchy starts it", chrome and (lambda d, url, init: Chromium(d, url, init, omarchy_flags, "omarchy"))),
                ("ime", "Chromium, --enable-wayland-ime", chrome and (lambda d, url, init: Chromium(d, url, init, omarchy_flags + ["--enable-wayland-ime"], "ime"))),
                ("webkit", "WebKitGTK (the desktop app's)", webkit and (lambda d, url, init: WebKitGTK(d, url, init, "webkit")))]
    work = Path(homes.temp_dir("input-method-view-"))
    crashes = m.Crashes(work)
    home = work / "home"
    home.mkdir()
    server = proxy = None
    try:
        vk = build_keyboard(work)
        port = free_port()
        server = app_server(home, port)
        proxy = Proxy(port)
        threading.Thread(target=proxy.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{proxy.server_address[1]}/"
        init = INIT % json.dumps(demo_chats())
        print(f"fcitx5 with {'Omarchy' + chr(39) + 's config' if om else 'its own defaults'}; amarchy's keys: "
              + ", ".join(k[0] for k in m.amarchy_keys()))
        ran = 0
        for key, where, make in browsers:
            if ONLY and ONLY != key:
                continue
            print(where, flush=True)
            if not make:
                print("  (not here: skipped)")
                continue
            d = work / key
            d.mkdir()
            desktop = kb = b = None
            try:
                desktop = Desktop(d, fcitx_exe, fcitx_env, om, m)
                kb = Keyboard(vk, desktop.env)      # (first: a seat with no keyboard crashes Chromium)
                b = make(desktop, url, init)
                run(where, key, b, desktop, kb)
                ran += 1
            except Exception as e:
                check(where, False, f"couldn't run: {e}")
            finally:
                for x in (b, kb, desktop):
                    if x:
                        x.close()
        if not ran and not failed:
            print("no browser here to test")
            return 2
        hits = crashes.found()
        if hits is None:
            print("  (the journal can't be read here: crashes not checked)")
        else:
            check("the test", not hits, "nothing it started crashed (Omarchy would toast it)" + (f": {', '.join(hits)}" if hits else ""))
            if crashes.others:
                print(f"  (meanwhile, not the test's: {len(crashes.others)} crashed: {', '.join(sorted(set(crashes.others)))})")
    finally:
        if proxy:
            proxy.shutdown()
        if server:
            server.terminate()
        if failed:
            homes.keep(work)
            print(f"\n(logs kept: {work})")
    print(f"\n{len(failed)} failed:\n  " + "\n  ".join(failed) if failed else "\nAll passed." + (f" Screenshots: {SHOTS}" if SHOTS else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
