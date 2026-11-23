# The desktop app on a computer whose GStreamer lacks the plugins its
# page's sounds need (Julian's M5, 2026-11-22: GStreamer and its base
# libraries only, and each chime ended the page's process): its page loads
# no media, so nothing ends it; its sounds (a chime, a preview, a
# notification's) are played by the app itself (a pw-play of the test's);
# it says what's missing and the command, once, and in Settings; once
# they're installed it starts again by itself, its page playing them. And
# its page's process crashing: with GStreamer's words before it, the GPU
# isn't blamed (no media from then on); with no sign why, it loads again.
# The same with less still: GStreamer's core elements only, and no plugins.
#
#   python3 desktop/test/sound-test.py          exits 0 when every check passed
#
# Needs what shell-test.py needs (the test build, Xvfb, xdotool,
# dbus-daemon, PyGObject), and GStreamer's good, base and PipeWire plugins
# on this computer: the app's GStreamer is given only some of them
# (GST_PLUGIN_SYSTEM_PATH_1_0) and a registry of its own, never the machine's.

import importlib.util
import json
import os
import resource
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location("shell_test", HERE / "shell-test.py")
st = importlib.util.module_from_spec(spec)
spec.loader.exec_module(st)       # its homes' folder (tempfile.tempdir) and helpers
from shell import Shell, need  # noqa: E402

check, failed, SHOTS = st.check, st.failed, st.SHOTS
# A crash's core isn't kept (systemd-coredump would take half a minute on it).
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


# What Julian's M5 had: GStreamer's core plugins and those of its base
# libraries (Arch's gst-plugins-base-libs), none of its good, base or
# PipeWire plugins.
CORE = ["coreelements", "coretracers", "adder", "app", "audioconvert", "audiomixer", "audiorate", "audioresample",
        "audiotestsrc", "basedebug", "compositor", "dsd", "encoding", "gio", "opengl", "overlaycomposition", "pbtypes",
        "playback", "rawparse", "subparse", "tcp", "typefindfunctions", "videoconvertscale", "videorate", "videotestsrc",
        "volume", "ximagesink", "xvimagesink"]


def system_plugins():
    """This computer's GStreamer plugins (the folder its core elements are in)."""
    for d in ["/usr/lib/gstreamer-1.0", "/usr/lib64/gstreamer-1.0", *map(str, Path("/usr/lib").glob("*/gstreamer-1.0"))]:
        if Path(d, "libgstcoreelements.so").exists():
            return sorted(Path(d).glob("libgst*.so"))
    raise SystemExit("Needs GStreamer's plugins (libgstcoreelements.so not found)")


class Gst:
    """A GStreamer of the test's: some of this computer's plugins (names, or
    all of them), its own registry."""

    def __init__(self, names):
        self.dir = Path(tempfile.mkdtemp(prefix="gst-plugins-"))
        self.registry = Path(tempfile.mkdtemp(prefix="gst-registry-")) / "registry.bin"
        self.add(names)

    def add(self, names=None):
        for p in system_plugins():
            if (names is None or p.name[len("libgst"):-len(".so")] in names) and not (self.dir / p.name).exists():
                os.symlink(p, self.dir / p.name)

    def env(self):
        return {"GST_PLUGIN_SYSTEM_PATH_1_0": str(self.dir), "GST_PLUGIN_PATH_1_0": "", "GST_REGISTRY_1_0": str(self.registry)}


# What a page may do with Web Audio, each in words when it can't: a context
# started with a tone, and a .wav decoded (without GStreamer's decoders
# WebKit's decoding never ends: "pending"). [the tone's, the decoding's]
WEB_AUDIO = """
  const within = (p) => Promise.race([p, new Promise((ok) => setTimeout(() => ok('pending'), 3000))]);
  const out = [];
  try { const c = new AudioContext(); const o = c.createOscillator(); o.connect(c.destination); o.start();
        await within(c.resume()); out.push(c.state); o.stop(); await within(c.close()); }
  catch (e) { out.push(e.name); }
  try { const b = await (await fetch('/sound/herald')).arrayBuffer();
        out.push(await within(new OfflineAudioContext(1, 100, 44100).decodeAudioData(b).then(() => 'decoded'))); }
  catch (e) { out.push(e.name); }
  return out;
"""

# What it says to install, on this computer (sound.rs).
if shutil.which("pacman"):
    PACKAGES = "gst-plugins-good, gst-plugins-base and gst-plugin-pipewire"
    FIX = "sudo pacman -S --needed gst-plugins-good gst-plugins-base gst-plugin-pipewire"
else:
    PACKAGES = "gstreamer1.0-plugins-good, gstreamer1.0-plugins-base and gstreamer1.0-pipewire"
    FIX = "sudo apt install gstreamer1.0-plugins-good gstreamer1.0-plugins-base gstreamer1.0-pipewire"


def player(home):
    """A pw-play of the test's: each sound it's given, kept (played-<n>), a
    line in played.log; it plays for 3 s (stopped: 'stopped' in the log)."""
    d = Path(home) / "playbin"
    d.mkdir(parents=True, exist_ok=True)
    (d / "pw-play").write_text(f"""#!/bin/sh
log={d}/played.log
n=$(wc -l < "$log" 2>/dev/null || echo 0)
for a; do f=$a; done
cp "$f" {d}/played-$n
echo "$*" >> "$log"
trap 'echo stopped >> {d}/stopped.log; exit 0' TERM
sleep 3 & wait
""")
    (d / "pw-play").chmod(0o755)
    return d


def played(d):
    try:
        return (d / "played.log").read_text().splitlines()
    except OSError:
        return []


def web(w):
    """Its page's processes (on the test's bus: a new app's too, after it started again)."""
    out = []
    for p in w.ours():
        try:
            if Path(f"/proc/{p}/comm").read_text().strip().startswith("WebKitWebProces"):
                out.append(p)
        except OSError:
            pass
    return sorted(out)


def logged(home):
    f = Path(home, ".local/state/amarchy/desktop/desktop.log")
    return f.read_text() if f.exists() else ""


def wait_for(test, timeout=30, every=0.3):
    end = time.time() + timeout
    while time.time() < end:
        v = test()
        if v:
            return v
        time.sleep(every)
    return None


def main():
    need("Xvfb", "xdotool", "dbus-daemon", "import")
    for el in ("wavparse", "autodetect", "pipewire", "ogg", "vorbis"):
        if not any(p.name == f"libgst{el}.so" for p in system_plugins()):
            raise SystemExit(f"Needs GStreamer's {el} plugin on this computer (gst-plugins-good, gst-plugins-base, gst-plugin-pipewire)")
    remote = st.Server()
    kalimba = urllib.request.urlopen(remote.url + "sound/kalimba", timeout=10).read()
    try:
        # ---- GStreamer and its base libraries only: no media, the app's sounds.
        print("GStreamer without its plugins (gst-plugins-good, -base, -pipewire)")
        home = tempfile.mkdtemp(prefix="desktop-home-")
        gst = Gst(CORE)
        pb = player(home)
        env = {**st.env_for(st.fake_cli(home)), **gst.env()}
        env["PATH"] = f"{pb}:{env['PATH']}"
        with Shell(remote.url, home=home, env=env, notifyd=True) as w:
            st.on_app(w)
            log = logged(home)
            check("sound: GStreamer" in log and "lacks autoaudiosink, wavparse" in log,
                  "its log says what GStreamer lacks (autoaudiosink, wavparse, …)")
            check(f"to fix it: {FIX}" in log,
                  "and the command that installs it")
            lacks = w.js("window.amarchyDesktopMedia && JSON.parse(JSON.stringify(window.amarchyDesktopMedia))")
            check(isinstance(lacks, dict) and lacks.get("sounds") is False and lacks.get("native") is True
                  and lacks.get("dictation") is False and lacks.get("packages") == PACKAGES,
                  f"the page knows: no sounds of its own, the app plays them, no dictation ({lacks})")
            csp = w.js("(document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]') || {}).content || null")
            check(csp == "media-src 'none'", f"its page loads no media (a media-src 'none' policy, before its scripts) ({csp})")

            # What crashed it on Julian's M5: an <audio> (playSound's way for
            # a sound Web Audio can't decode), a <video> (a post's), a chime.
            before = web(w)
            w.click(300, 300)
            r = w.js("try { await new Audio('/sound/herald').play(); return 'played'; } catch (e) { return e.name; }")
            check(r == "NotSupportedError", f"an <audio> doesn't play ({r})")
            r = w.js("const v = document.createElement('video'); v.muted = true; v.src = '/sound/herald#t=0.1'; document.body.append(v);"
                     " try { await v.play(); return 'played'; } catch (e) { return e.name; } finally { v.remove(); }")
            check(r == "NotSupportedError", f"nor a <video> ({r})")
            r = w.js(WEB_AUDIO)
            check(isinstance(r, list) and len(r) == 2, f"Web Audio (a context, a tone, a .wav decoded) fails in words ({r})")
            w.js("window.__stop = playSound('/sound/kalimba'); 1")
            got = wait_for(lambda: played(pb), timeout=10)
            check(bool(got) and "--media-role=Notification" in got[0], f"a chime: the app plays it (pw-play {got[:1]})")
            check((pb / "played-0").exists() and (pb / "played-0").read_bytes() == kalimba, "the chime's own sound, fetched from its amarchy")
            w.js("__stop(); 1")
            check(bool(wait_for(lambda: (pb / "stopped.log").exists(), timeout=5)), "stopped (a preview's when the next starts): it stops")
            time.sleep(5)
            check(web(w) == before and before and "crashed" not in logged(home),
                  f"its page's process lives on ({before} → {web(w)})")
            check(not Path(home, ".local/state/amarchy/desktop/rendering.json").exists(), "and nothing makes it draw the safe way")

            # Dictation: it can't start here, and says why, with the command.
            way = w.js("typeof dictationWay === 'function' ? dictationWay() : null")
            if way == "host":
                at = w.js("(() => { const b = [...document.querySelectorAll('button.mic')].find((b) => !b.hidden && b.offsetParent);"
                          " if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()")
                if at:
                    w.click(*at)
                said = w.wait("[...document.querySelectorAll('.toast')].map(t => t.textContent).join(' ')", timeout=10)
                check(f"Dictation here needs {PACKAGES}" in said and "Copy the command" in said, f"dictation says why it can't start ({said[:90]})")
            else:
                print(f"  (dictation's {way}, not the host's here: its words not checked)")

            # Said once: a notification, with the command; a click: Settings.
            n = w.note(lambda n: n["summary"].startswith("This computer lacks"), timeout=10)
            check(bool(n) and PACKAGES in n["summary"] and FIX in n["body"]
                  and "plays its sounds itself" in n["body"], f"a notification says so, with the command ({n and n['summary']}: {n and n['body']})")
            # Its notifications' chimes: the app's too.
            st.listening(remote, w)
            had = len(played(pb))
            remote.notice({"title": "Rings", "body": "x", "tag": "desk-long"}, {"session": "desk-long", "sound": "kalimba", "actions": []})
            check(bool(w.note(lambda n: n["summary"] == "Rings")) and bool(wait_for(lambda: len(played(pb)) > had, timeout=10)),
                  "a notification's chime: the app plays it")
            if n:
                w.press(n["id"], "default")
                note = w.wait("(document.querySelector('.sheet .note[data-lacks]') || {}).textContent || ''", timeout=10)
                check(f"This computer lacks {PACKAGES}" in note and "plays its sounds itself" in note,
                      f"its click: Settings says it too ({note[:90]})")
                shown = "document.querySelector('.sheet .note[data-lacks]').scrollIntoView({ block: 'center' }); 1"
                time.sleep(0.8)
                w.js(shown)
                time.sleep(0.4)
                w.shot(SHOTS / "sound-settings-wide.png")
                w.resize(390, 844)
                time.sleep(0.8)
                w.js(shown)
                time.sleep(0.4)
                w.shot(SHOTS / "sound-settings-phone.png")
                w.resize(1280, 800)
                w.key("Escape")

        # ---- less still: GStreamer's core elements only, then no plugins at all.
        for what, names in (("GStreamer's core elements only", ["coreelements", "coretracers"]), ("no GStreamer plugins at all", [])):
            print(what)
            home2 = tempfile.mkdtemp(prefix="desktop-home-")
            pb2 = player(home2)
            env2 = {**st.env_for(st.fake_cli(home2)), **Gst(names).env()}
            env2["PATH"] = f"{pb2}:{env2['PATH']}"
            with Shell(remote.url, home=home2, env=env2) as w:
                st.on_app(w)
                lacks = w.js("window.amarchyDesktopMedia && JSON.parse(JSON.stringify(window.amarchyDesktopMedia))")
                check(isinstance(lacks, dict) and lacks.get("sounds") is False and lacks.get("native") is True and "decodebin" in lacks.get("missing", []),
                      f"it knows what's missing ({lacks and lacks.get('missing')})")
                csp = w.js("(document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]') || {}).content || null")
                check(csp == "media-src 'none'", "its page loads no media")
                before = web(w)
                w.click(300, 300)
                a = w.js("try { await new Audio('/sound/herald').play(); return 'played'; } catch (e) { return e.name; }")
                v = w.js("const v = document.createElement('video'); v.src = '/sound/herald'; document.body.append(v);"
                         " try { await v.play(); return 'played'; } catch (e) { return e.name; } finally { v.remove(); }")
                r = w.js(WEB_AUDIO)
                w.js("playSound('/sound/kalimba'); 1")
                check(a == v == "NotSupportedError" and isinstance(r, list), f"an <audio>, a <video>, Web Audio: refused in words ({a}, {v}, {r})")
                check(bool(wait_for(lambda: played(pb2), timeout=10)), "a chime: the app plays it")
                time.sleep(5)
                check(web(w) == before and before and "crashed" not in logged(home2), f"its page's process lives on ({before} → {web(w)})")

        # Started again, the same: not said twice.
        print("started again")
        with Shell(remote.url, home=home, env=env, notifyd=True) as w:
            st.on_app(w)
            n = w.note(lambda n: n["summary"].startswith("This computer lacks"), timeout=6)
            check(n is None, "the next start doesn't say it again")

            # ---- installed: it starts again by itself, its page playing.
            print("installed meanwhile")
            old = w.do("pid")
            gst.add()       # all of this computer's
            new = None
            for _ in range(80):
                try:
                    new = w.do("pid", timeout=2)
                except TimeoutError:
                    new = None
                if new and new != old:
                    break
                time.sleep(0.5)
            check(bool(new) and new != old, f"it starts again by itself (pid {old} → {new})")
            back = w.wait("typeof app !== 'undefined' && !!app.view", timeout=40) if new and new != old else False
            log = logged(home)
            check(bool(back) and "GStreamer has autoaudiosink" in log, "its log says why, and its page is back")
            if back:
                check(w.js("window.amarchyDesktopMedia === undefined && !document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]')"),
                      "its page plays its own sounds again (nothing lacking, no policy)")
                before = web(w)
                w.click(300, 300)
                w.js("const a = new Audio('/sound/herald'); a.play().catch(() => {}); 1")
                time.sleep(4)
                check(web(w) == before and before and "crashed" not in logged(home), "an <audio> plays, its page lives on")

        # ---- AMARCHY_DESKTOP_SOUND=1: the page plays even so, and crashes.
        # GStreamer's words were the last: no media from then on, and not the GPU.
        print("a crash playing a sound")
        home = tempfile.mkdtemp(prefix="desktop-home-")
        gst = Gst(CORE)
        pb = player(home)
        env = {**st.env_for(st.fake_cli(home)), **gst.env(), "AMARCHY_DESKTOP_SOUND": "1"}
        env["PATH"] = f"{pb}:{env['PATH']}"
        with Shell(remote.url, home=home, env=env) as w:
            st.on_app(w)
            check("AMARCHY_DESKTOP_SOUND=1: the page plays its sounds even so" in logged(home), "AMARCHY_DESKTOP_SOUND=1: the page plays them itself")
            check(w.js("!document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]')"), "(no policy)")
            w.click(300, 300)
            w.js("new Audio('/sound/herald').play().catch(() => {}); 1")
            said = wait_for(lambda: "crashed playing a sound or a video" in logged(home), timeout=60)
            log = logged(home)
            check(bool(said) and "GStreamer said last:" in log, "the crash is a sound's, with what GStreamer said last")
            check("no GPU compositing" not in log and not Path(home, ".local/state/amarchy/desktop/rendering.json").exists(),
                  "the GPU isn't blamed (it doesn't draw the safe way)")
            back = w.wait("typeof app !== 'undefined' && !!app.view && !!window.amarchyDesktopMedia", timeout=40)
            check(bool(back) and w.js("window.amarchyDesktopMedia.sounds") is False
                  and w.js("(document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]') || {}).content") == "media-src 'none'",
                  "its page is back, loading no media from now on")
            if back:
                before = web(w)
                r = w.js("try { await new Audio('/sound/herald').play(); return 'played'; } catch (e) { return e.name; }")
                w.js("playSound('/sound/kalimba'); 1")
                check(bool(wait_for(lambda: played(pb), timeout=10)), "its sounds: the app's from now on")
                time.sleep(4)
                check(r == "NotSupportedError" and web(w) == before, f"an <audio> again: it lives on ({r})")
    finally:
        remote.stop()

    print(f"screenshots: {SHOTS}")
    if not os.environ.get("KEEP"):
        for d in Path(tempfile.tempdir).iterdir():
            if d != SHOTS:
                shutil.rmtree(d, ignore_errors=True)
        try:
            os.rmdir(tempfile.tempdir)
        except OSError:
            pass
    if failed:
        print(f"{len(failed)} failed")
        sys.exit(1)
    print("all passed")


if __name__ == "__main__":
    main()
