# Dictation in the real desktop app (WebKitGTK: no speech recognition of its
# own) on a machine without the speech model, as on Julian's M5 (ja): two
# real amarchy app servers (test/two_machines.py), alpha with the model (this
# host's engine, transcribe.cpp, and model), beta without; a chat on each; the desktop
# app on beta, through its local key, with WebKit's own test microphone
# (a tone: what's said is test/dictation-machines.py's, through the same
# WebSocket).
#
#   - GStreamer without its PipeWire source (what ja had): the mic is there
#     on both chats, beta's own and alpha's, dimmed; a click names the
#     packages, with Copy the command;
#   - GStreamer with its plugins: the mic lit on both (alpha writes it
#     down for beta); a click: what the window hears goes to beta, on to
#     alpha, and alpha's answer comes back to the window (its log says for
#     beta);
#   - beta alone (alpha off): dimmed, and a click says beta needs a speech
#     model, Set it up opening Settings at Dictation.
#
#   python3 desktop/test/dictation-test.py      exits 0 when every check passed
#
# Needs what shell-test.py needs (the test build, Xvfb, xdotool, dbus-daemon),
# GStreamer's plugins, and this host's dictation set up (amarchy dictation).

import importlib.util
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location("sound_test", HERE / "sound-test.py")
snd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snd)      # shell-test's homes' folder and helpers, GStreamer of the test's
st = snd.st
from shell import Shell, need  # noqa: E402
sys.path.insert(0, str(ROOT / "test"))
import two_machines as tm  # noqa: E402

check, failed, SHOTS = st.check, st.failed, st.SHOTS
HOST = Path(os.environ.get("XDG_STATE_HOME") or Path.home() / ".local/state") / "amarchy/dictation"
MODEL = HOST / "parakeet-tdt-0.6b-v3-Q8_0.gguf"
ENGINE = next((d for d in (HOST / "transcribe.cpp", Path("/usr/lib/amarchy/transcribe.cpp")) if (d / "libtranscribe.so").is_file()), None)


def cli_for(m, home):
    """amarchy's CLI as machine m has it (its home, state, port, name), for the desktop app."""
    d = Path(home) / "clibin"
    d.mkdir(parents=True, exist_ok=True)
    script = d / "amarchy"
    exports = "".join(f"export {k}={json.dumps(v)}\n" for k, v in m.env.items())
    script.write_text(f"#!/bin/sh\n{exports}exec {sys.executable} {ROOT / 'bin/amarchy'} \"$@\"\n")
    script.chmod(0o755)
    return script


def desktop_env(m, gst):
    path = ":".join(p for p in os.environ.get("PATH", "").split(":") if ".local/bin" not in p and "amarchy" not in p)
    return {"AMARCHY_CLI": str(cli_for(m, m.home)), "PATH": path, "AMARCHY_URL": "", "AMARCHY_HOST_APP_PORT": str(m.port),
            "AMARCHY_DESKTOP_MOCK_MIC": "1", **gst.env()}


MIC = """(() => {
  const b = [...document.querySelectorAll('.cbtn.mic')].find((x) => x.offsetParent);
  return b ? { shown: !b.hidden, cant: b.classList.contains('cant'), title: b.title, on: b.classList.contains('on') } : null;
})()"""
TOAST = "(document.querySelector('.toast') || {}).innerText || ''"


def open_chat(w, key):
    w.js(f"go({json.dumps('#/s/' + key)}); 1")
    return w.wait(f"(desk.current === {json.dumps(key)} || location.hash === {json.dumps('#/s/' + key)}) && "
                  "[...document.querySelectorAll('.cbtn.mic')].some((b) => b.offsetParent)", timeout=20)


def click_mic(w, clear=True):
    """A click on the mic of the chat on screen (the desk keeps others' views, hidden)."""
    if clear:
        w.js("document.querySelectorAll('.toast').forEach((t) => t.remove()); 1")
    w.js("document.querySelectorAll('#test-mic').forEach((b) => b.removeAttribute('id')); "
         "[...document.querySelectorAll('.cbtn.mic')].find((b) => b.offsetParent).id = 'test-mic'; 1")
    w.click_el("#test-mic")
    time.sleep(0.6)


def main():
    need("Xvfb", "xdotool", "dbus-daemon", "import")
    if not MODEL.is_file() or not ENGINE:
        raise SystemExit("Needs this host's dictation set up (amarchy dictation)")

    alpha, beta = tm.Machine("alpha"), tm.Machine("beta")
    for m in (alpha, beta):
        m.env["AMARCHY_DICTATE_SYSTEM"] = "off"     # no package's engine: only what's in its own state
    (alpha.home / "state/amarchy/dictation").mkdir(parents=True)
    (alpha.home / "state/amarchy/dictation" / MODEL.name).symlink_to(MODEL)
    (alpha.home / "state/amarchy/dictation/transcribe.cpp").symlink_to(ENGINE)
    # The desktop app reads its state and config at ~/.local/state and ~/.config: beta's.
    (beta.home / ".local").mkdir()
    (beta.home / ".local/state").symlink_to(beta.home / "state")
    (beta.home / ".config").symlink_to(beta.home / "config")
    try:
        print("two machines: alpha with the speech model, beta without")
        check(alpha.start() and beta.start(), "both serve")
        check(alpha.amarchy("machines", "add", beta.url).returncode == 0, "paired")
        srv = alpha.amarchy("new", "proj", "srv").stdout.strip().splitlines()[-1:]
        loc = beta.amarchy("new", "proj", "loc").stdout.strip().splitlines()[-1:]
        check(srv == ["proj-srv"] and loc == ["proj-loc"], f"a chat on each ({srv}, {loc})")
        check(bool(tm.until(lambda: any(s.get("id") == "proj-srv" and s.get("machine") == "alpha" for s in beta.state()["sessions"])
                            and (beta.state().get("dictation") or {}).get("via"), limit=30)),
              "alpha's chat on beta's board, and alpha writes beta's dictation down")

        # ---- GStreamer without its PipeWire source: what ja had.
        print("the desktop app on beta, GStreamer without its plugins")
        gst = snd.Gst(snd.CORE)
        with Shell(None, home=str(beta.home), env=desktop_env(beta, gst), size=(1280, 800)) as w:
            check(bool(st.on_app(w, timeout=40)), "it opens beta's amarchy (its local key)")
            check(w.js("!window.SpeechRecognition && !window.webkitSpeechRecognition"), "WebKitGTK: no speech recognition of its own")
            check(w.js("!!window.amarchyDesktopMedia && window.amarchyDesktopMedia.dictation === false"), "and no microphone through GStreamer")
            for key, whose in (("alpha:proj-srv", "alpha's chat (on the server)"), ("proj-loc", "beta's own chat")):
                check(bool(open_chat(w, key)), f"{whose} opens")
                m = w.js(MIC)
                check(bool(m) and m["shown"] and m["cant"], f"{whose}: the mic is there, dimmed ({m})")
                click_mic(w)
                t = w.js(TOAST)
                check("Dictation here needs" in t and "pipewire" in t and "Copy the command" in t, f"{whose}: a click names the packages ({t!r})")
            w.shot(SHOTS / "dictation-desktop-lacks.png")

        # ---- GStreamer with its plugins: alpha writes it down.
        print("the desktop app on beta, GStreamer with its plugins")
        gst = snd.Gst(None)
        with Shell(None, home=str(beta.home), env=desktop_env(beta, gst), size=(1280, 800)) as w:
            check(bool(st.on_app(w, timeout=40)), "it opens beta's amarchy")
            check(w.js("!window.amarchyDesktopMedia || window.amarchyDesktopMedia.dictation !== false"), "a microphone through GStreamer")
            for key, whose in (("proj-loc", "beta's own chat"), ("alpha:proj-srv", "alpha's chat (on the server)")):
                check(bool(open_chat(w, key)), f"{whose} opens")
                m = w.js(MIC)
                check(bool(m) and m["shown"] and not m["cant"], f"{whose}: the mic is lit ({m})")
            logs = alpha.home / "state/amarchy/dictation/log.jsonl"
            before = len(logs.read_text().splitlines()) if logs.exists() else 0
            click_mic(w)                        # a click: it listens until clicked again
            time.sleep(2.5)
            w.shot(SHOTS / "dictation-desktop-listening.png")
            if w.js("!!document.querySelector('#test-mic.on')"):
                click_mic(w, clear=False)       # done
            # (Without a sound server, as in this test's X server, WebKit's audio clock
            # barely runs: a moment of its test microphone's tone goes, not seconds.)
            log = tm.until(lambda: (x := [json.loads(l) for l in logs.read_text().splitlines()] if logs.exists() else []) and len(x) > before and x, limit=60) or []
            check(bool(log) and log[-1].get("for") == "beta" and (log[-1].get("said_s") or 0) > 0,
                  f"what the window heard went to beta, then to alpha, which wrote it down for beta ({log[-1] if log else None})")
            answered = w.wait("!document.querySelector('#test-mic.on') && !/Writing it down|Starting/.test(document.querySelector('#test-mic').closest('.composer').querySelector('textarea').placeholder) && "
                              "((document.querySelector('.toast') || {}).innerText || document.querySelector('#test-mic').closest('.composer').querySelector('textarea').value)", timeout=30)
            check(bool(answered) and "didn't connect" not in str(answered) and "needs" not in str(answered) and "didn't start" not in str(answered),
                  f"and alpha's answer came back to the window ({answered!r})")
            w.shot(SHOTS / "dictation-desktop-said.png")

            # ---- beta alone: nobody to write it down.
            print("alpha off")
            alpha.stop()
            gone = w.wait("!(app.view.dictation || {}).via", timeout=40)
            check(bool(gone), "beta's board: nobody writes it down now")
            open_chat(w, "proj-loc")
            m = w.js(MIC)
            check(bool(m) and m["cant"], f"the mic dimmed ({m})")
            click_mic(w)
            t = w.js(TOAST)
            check("needs a speech model on beta" in t and "Set it up" in t, f"a click: beta needs a speech model ({t!r})")
            w.js("document.querySelector('.toast.act').click(); 1")
            check(bool(w.wait("!!document.querySelector('.sheet-back.settings [data-section=\"dictation\"]')")), "Set it up: Settings at Dictation")
            w.shot(SHOTS / "dictation-desktop-settings.png")
    finally:
        for m in (alpha, beta):
            m.stop()
    print(f"screenshots: {SHOTS}")
    if failed:
        print(f"\nFAILED: {', '.join(failed)}")
        sys.exit(1)
    print("all passed")


if __name__ == "__main__":
    main()
