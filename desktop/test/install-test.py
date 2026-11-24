# desktop/install.sh when pacman can't get what it asks for, as on an Omarchy
# whose package list is older than its mirror (a 404): the GStreamer plugins
# of its sounds and microphone never stand in the way of building the app
# (built anyway, and it says it has no microphone and no video without them,
# its chimes played anyway, with the command; a system update half done,
# "breaks dependency", said as that); Rust that pacman
# can't get comes from mise instead (asked first); a package the build needs
# that pacman can't get: not built, why in plain words, no system update
# suggested (no -Sy, no -Syu); each says how it went in the line amarchy's
# install.sh ends with. In a terminal of its own (script), with a made-up
# pacman, sudo, mise and pkg-config, in a home of its own: nothing is
# installed on this machine.
#
#   python3 desktop/test/install-test.py      exits 0 when every check passed
#
# Needs what building the desktop app needs (cargo, WebKitGTK), and script
# (util-linux). The first run builds it (a few minutes); later ones reuse
# that build (~/.cache/amarchy-tests/desktop-install-build).

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "test")); import homes as test_homes  # noqa: E402  (test/homes.py: its homes gone with it, however it ends)
CACHE = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "amarchy-tests"
BUILD = CACHE / "desktop-install-build"      # the build, kept between runs (its cargo target)
failed = []


def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}", flush=True)
    if not ok:
        failed.append(what)


FAKE_PACMAN = r"""#!/usr/bin/env python3
# pacman, made up: what's installed and what its mirror no longer has (state.json).
import json, sys
from pathlib import Path
f = Path(__file__).with_name("state.json")
st = json.loads(f.read_text())
a = sys.argv[1:]
with open(Path(__file__).with_name("asked.log"), "a") as log:
    log.write("pacman " + " ".join(a) + "\n")
if a == ["-Qq"]:
    print("\n".join(st["installed"] + st.get("held", [])))
    sys.exit(0)
if a[:1] == ["-Qq"]:
    sys.exit(0 if a[1] in st["installed"] else 1)
if a[:1] == ["-Qqo"]:
    sys.exit(1)
if a[:1] == ["-S"]:
    pkgs = [p for p in a[1:] if not p.startswith("-")]
    if st.get("broken") and any(p in st["broken"] for p in pkgs):
        print("error: failed to prepare transaction (could not satisfy dependencies)", file=sys.stderr)
        print(":: installing gstreamer (1.28.9-3) breaks dependency 'gstreamer=1.28.9-1' required by gst-plugins-bad-libs",
              file=sys.stderr)
        sys.exit(1)
    gone = [p for p in pkgs if p in st["gone"]]
    if gone:
        for p in gone:
            print(f"error: failed retrieving file '{p}-1.28.9-1-aarch64.pkg.tar.xz' from arm-mirror.omarchy.org : "
                  "The requested URL returned error: 404", file=sys.stderr)
        print("warning: failed to retrieve some files", file=sys.stderr)
        print("error: failed to commit transaction (failed to retrieve some files)", file=sys.stderr)
        print("Errors occurred, no packages were upgraded.", file=sys.stderr)
        sys.exit(1)
    st["installed"] += pkgs
    f.write_text(json.dumps(st))
    print("installing " + " ".join(pkgs))
    sys.exit(0)
print("not in the test: pacman " + " ".join(a), file=sys.stderr)
sys.exit(2)
"""

FAKE_SUDO = """#!/bin/sh
echo "sudo $*" >> "$(dirname "$0")/asked.log"
exec "$@"
"""

# pkg-config as the real one, but for the packages the test says are missing.
FAKE_PKG_CONFIG = r"""#!/usr/bin/env python3
import json, os, subprocess, sys
from pathlib import Path
st = json.loads(Path(__file__).with_name("state.json").read_text())
if sys.argv[1:2] == ["--exists"] and sys.argv[2] in st.get("pc_missing", []) and st.get("pc_pkg", {}).get(sys.argv[2]) not in st["installed"]:
    sys.exit(1)
os.execv("/usr/bin/pkg-config", ["pkg-config", *sys.argv[1:]])
"""

# mise, made up: Rust once `mise use -g rust@stable` ran (this machine's cargo).
FAKE_MISE = r"""#!/usr/bin/env python3
import json, shutil, sys
from pathlib import Path
f = Path(__file__).with_name("state.json")
st = json.loads(f.read_text())
a = sys.argv[1:]
with open(Path(__file__).with_name("asked.log"), "a") as log:
    log.write("mise " + " ".join(a) + "\n")
if a == ["which", "cargo"]:
    if st.get("mise_rust"):
        print("/usr/bin/cargo"); sys.exit(0)
    sys.exit(1)
if a[:2] == ["use", "-g"]:
    st["mise_rust"] = True
    f.write_text(json.dumps(st))
    print("mise rust@stable installed"); sys.exit(0)
sys.exit(2)
"""


def sandbox(state, cargo=True):
    """A home, and a PATH whose pacman, sudo, mise and pkg-config are made
    up (and, cargo=False, no cargo but mise's)."""
    home = Path(test_homes.home("desktop-install"))
    fake = home / "fakebin"
    fake.mkdir()
    for name, text in (("pacman", FAKE_PACMAN), ("sudo", FAKE_SUDO), ("pkg-config", FAKE_PKG_CONFIG), ("mise", FAKE_MISE)):
        (fake / name).write_text(text)
        (fake / name).chmod(0o755)
    (fake / "state.json").write_text(json.dumps(state))
    dirs = [str(fake)]
    if not cargo:       # this machine's commands, but cargo and rustc
        usr = home / "usrbin"
        usr.mkdir()
        for f in Path("/usr/bin").iterdir():
            if f.name not in ("cargo", "rustc", "rustup", "pacman", "sudo", "mise", "pkg-config"):
                (usr / f.name).symlink_to(f)
        dirs.append(str(usr))
    else:
        dirs += [p for p in os.environ["PATH"].split(":") if p and ".cargo" not in p and "mise" not in p
                 and ".local/bin" not in p]
    return home, fake, ":".join(dirs)


def run(home, path, answers=""):
    """desktop/install.sh in a terminal of its own: what it printed, how it ended."""
    env = {"HOME": str(home), "PATH": path, "TERM": "xterm", "LANG": os.environ.get("LANG", "C.UTF-8"),
           "XDG_CONFIG_HOME": f"{home}/.config", "XDG_DATA_HOME": f"{home}/.local/share",
           "XDG_STATE_HOME": f"{home}/.local/state", "XDG_CACHE_HOME": str(BUILD),
           "CARGO_HOME": os.environ.get("CARGO_HOME") or str(Path.home() / ".cargo")}
    cmd = f"{ROOT / 'desktop/install.sh'}; echo EXIT=$?"
    r = subprocess.run(["script", "-qec", cmd, "/dev/null"], input=answers, capture_output=True, text=True, env=env, timeout=1800)
    out = r.stdout.replace("\r", "")
    code = int(out.rsplit("EXIT=", 1)[1].split()[0]) if "EXIT=" in out else -1
    return out, code


def status(home):
    try:
        return (home / ".local/state/amarchy/desktop/status").read_text().strip()
    except OSError:
        return ""


def main():
    for tool in ("script", "cargo"):
        if not shutil.which(tool):
            raise SystemExit(f"Needs {tool}")
    BUILD.mkdir(parents=True, exist_ok=True)
    tempfile.tempdir = str(CACHE)
    homes = []

    # ---- the sounds' and mic's plugins 404 (Julian's M5): built anyway.
    print("the sounds' and microphone's plugins: a 404")
    home, fake, path = sandbox({"installed": [], "gone": ["gst-plugins-good"]})
    homes.append(home)
    out, code = run(home, path)
    asked = (fake / "asked.log").read_text()
    check(code == 0 and (home / ".local/bin/amarchy-desktop").is_file(), f"built and installed all the same (exit {code})")
    check("pacman -S --needed gst-plugin-pipewire gst-plugins-base gst-plugins-good" in asked and "rust" not in asked,
          "the build's packages and the sounds' and microphone's asked for apart (here only theirs)")
    state = json.loads((fake / "state.json").read_text())
    check("gst-plugin-pipewire" in state["installed"] and "gst-plugins-base" in state["installed"],
          "after the 404, each on its own: the ones pacman can get come (PipeWire's)")
    check("older than its mirror" in out and "a 404" in out, "pacman's 404 said in words")
    check("no microphone (dictation) and no video until these are installed: gst-plugins-good" in out
          and "sudo pacman -S --needed gst-plugins-good" in out and "Its chimes play anyway" in out,
          "no microphone and no video without the one missing, said, with the command (its chimes play)")
    check("-Sy" not in out.replace("-Syu), yours to decide", ""), "no partial update suggested (-Sy)")
    check(status(home).startswith("installed") and "no microphone and no video in it until gst-plugins-good" in status(home)
          and "older than its mirror" in status(home), f"the summary line says so, and why ({status(home)[:140]})")

    # ---- a system update half done (Julian's M5): "breaks dependency".
    print("a system update half done")
    home, fake, path = sandbox({"installed": [], "gone": [], "broken": ["gst-plugins-good", "gst-plugins-base", "gst-plugin-pipewire"],
                                "held": ["linux-aurora", "m1n1-aurora", "uboot-aurora"]})
    homes.append(home)
    out, code = run(home, path)
    check(code == 0 and (home / ".local/bin/amarchy-desktop").is_file(), f"built and installed all the same (exit {code})")
    check("halfway through a system update" in out and "breaks dependency 'gstreamer=1.28.9-1'" in out,
          "said: a system update half done, with pacman's line")
    check("sudo pacman -Syu --ignore linux-aurora,m1n1-aurora,uboot-aurora" in out,
          "finish it first, the Apple Silicon kernel and boot packages held back")
    check("pacman -Sy " not in out and "never updates your system" in out, "never run, never a partial update")
    check("no microphone and no video in it until" in status(home) and "halfway through a system update" in status(home),
          "the summary line says why too")

    # ---- Rust: pacman can't get it, mise can (asked first).
    print("Rust: a 404, then mise")
    home, fake, path = sandbox({"installed": ["gst-plugin-pipewire", "gst-plugins-base", "gst-plugins-good"], "gone": ["rust"]}, cargo=False)
    homes.append(home)
    out, code = run(home, path, answers="y\n")
    asked = (fake / "asked.log").read_text()
    check("pacman -S --needed rust" in asked, "rust asked of pacman first")
    check("Install Rust for you alone with mise" in out and "mise use -g rust@stable" in asked, "then mise, asked first")
    check(code == 0 and (home / ".local/bin/amarchy-desktop").is_file() and status(home).startswith("installed"),
          f"built with mise's Rust ({status(home)})")
    home, fake, path = sandbox({"installed": ["gst-plugin-pipewire", "gst-plugins-base", "gst-plugins-good"], "gone": ["rust"]}, cargo=False)
    homes.append(home)
    out, code = run(home, path, answers="n\n")
    check(code == 1 and not (home / ".local/bin/amarchy-desktop").exists(), "mise declined: not built")
    check(status(home).startswith("not built: it needs rust to build") and "older than its mirror" in status(home),
          f"and why, in words ({status(home)[:120]})")

    # ---- what the build needs, a 404: not built, why, no system update.
    print("WebKitGTK: a 404")
    home, fake, path = sandbox({"installed": ["gst-plugin-pipewire", "gst-plugins-base", "gst-plugins-good"], "gone": ["webkit2gtk-4.1"],
                                "pc_missing": ["webkit2gtk-4.1"], "pc_pkg": {"webkit2gtk-4.1": "webkit2gtk-4.1"}})
    homes.append(home)
    out, code = run(home, path)
    check(code == 1 and not (home / ".local/bin/amarchy-desktop").exists(), f"not built (exit {code})")
    check("The desktop app isn't built: it needs webkit2gtk-4.1 to build" in out and "older than its mirror" in out
          and "Nothing was installed" in out, "said plainly, with why")
    check("pacman -Sy " not in out and "-Syu)" in out and "yours to decide" in out, "a system update named, never run or pushed")
    check(status(home).startswith("not built: it needs webkit2gtk-4.1"), "the summary line says it wasn't built, and why")

    # ---- the top-level summary, as install.sh says it.
    print("install.sh's summary")
    snippet = (ROOT / "install.sh").read_text()
    piece = snippet[snippet.index("# ---- the desktop app (track B): how it went"):snippet.index("# ---- end of the desktop app (track B)\n", snippet.index("# ---- the desktop app (track B): how it went"))]
    for said, bold in (("not built: it needs rust to build. pacman couldn't download them", True),
                       ("installed (Amarchy in your launcher); no microphone and no video in it until gst-plugins-good are installed (its chimes play)", False)):
        r = subprocess.run(["bash", "-c", "set -euo pipefail; say() { printf 'BOLD:%s\\n' \"$*\"; }; desktop_said=\"$1\"\n" + piece
                            + "\necho done", "x", said], capture_output=True, text=True)
        line = r.stdout.splitlines()[0] if r.stdout else ""
        check(r.returncode == 0 and r.stdout.endswith("done\n") and said in line and line.startswith("BOLD:") == bold,
              f"\"The desktop app: {said[:40]}…\"{' in bold' if bold else ''}")

    if os.environ.get("KEEP"):
        for h in homes:
            test_homes.keep(h)
    if failed:
        print(f"{len(failed)} failed")
        sys.exit(1)
    print("all passed")


if __name__ == "__main__":
    main()
