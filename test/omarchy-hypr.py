#!/usr/bin/env python3
"""omarchy/hypr/amarchy.lua on Omarchy's own Lua helpers (default/hypr/
helpers.lua), with Hyprland's `hl` a fake that keeps the window rules it's
given: Super+D bound, and the desktop app's window (class amarchy)
see-through as the terminals are in each of Omarchy's window modes:
Transparent (Omarchy's standard transparency, the terminals' rule), Opaque
and Glassy (no rule of its own: theirs apply), and none when Omarchy has no
transparent_window.

Needs lua (5.4) and a checkout of Omarchy (basecamp/omarchy, branch
quattro) in OMARCHY_SRC (default /tmp/omarchy-src/omarchy).

    python3 test/omarchy-hypr.py
"""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = Path(os.environ.get("OMARCHY_SRC", "/tmp/omarchy-src/omarchy"))
failed = []

# Omarchy's helpers with a fake hl; prints each window rule and each key bound.
HARNESS = r"""
local src, file, setup = arg[1], arg[2], arg[3]
package.path = src .. "/?.lua;" .. package.path
local function any(name)
  return setmetatable({}, {
    __index = function(_, k) return any(name .. "." .. k) end,
    __call = function(_, a)
      if name == "hl.window_rule" then
        print(string.format("rule class=%s opacity=%s tag=%s", tostring(a.match and a.match.class), tostring(a.opacity), tostring(a.tag)))
      end
      return any(name .. "()")
    end,
  })
end
hl = any("hl")
dofile(src .. "/default/hypr/helpers.lua")
local bind = o.bind
o.bind = function(keys, ...) print("bind " .. keys) return bind(keys, ...) end
if setup == "old" then o.transparent_window = nil end
dofile(file)
"""


def check(what, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + what + (f": {detail}" if detail and not ok else ""))
    if not ok:
        failed.append(what)


def main():
    lua = shutil.which("lua5.4") or shutil.which("lua")
    if not lua or not (SRC / "default/hypr/helpers.lua").is_file():
        print(f"skipped: needs lua and Omarchy's source in {SRC}")
        return 0
    base = Path(tempfile.mkdtemp(prefix="omarchy-hypr-"))
    try:
        harness = base / "harness.lua"
        harness.write_text(HARNESS)
        home = base / "home"
        toggles = home / ".local/state/omarchy/toggles/hypr"
        toggles.mkdir(parents=True)

        def run(setup="", **env):
            r = subprocess.run([lua, str(harness), str(SRC), str(REPO / "omarchy/hypr/amarchy.lua"), setup],
                               capture_output=True, text=True, env={**os.environ, "HOME": str(home), "XDG_STATE_HOME": "",
                                                                    "OMARCHY_PATH": str(SRC), **env})
            if r.returncode:
                return f"error: {r.stderr.strip()[-300:]}"
            return r.stdout.strip().splitlines()

        terminals = "rule class=amarchy opacity=0.985 0.96 tag=+transparent-window"
        out = run()
        check("Super+D bound", "bind SUPER + D" in out, out)
        check("Transparent (Omarchy's default): the terminals' rule, for the window of class amarchy",
              [x for x in out if x.startswith("rule")] == [terminals], out)
        (toggles / "window-opaque.lua").write_text("-- Omarchy's opaque toggle\n")
        out = run()
        check("Opaque: no rule of its own (Omarchy's keeps it solid)", not any(x.startswith("rule") for x in out), out)
        (toggles / "window-opaque.lua").unlink()
        (toggles / "window-glassy.lua").write_text("-- Omarchy's glassy toggle\n")
        out = run()
        check("Glassy: no rule of its own (Glassy's fades every window)", not any(x.startswith("rule") for x in out), out)
        xdg = base / "xdg"
        (xdg / "omarchy/toggles/hypr").mkdir(parents=True)
        out = run(XDG_STATE_HOME=str(xdg))
        check("the toggles where Omarchy keeps them ($XDG_STATE_HOME's when set)",
              [x for x in out if x.startswith("rule")] == [terminals], out)
        (toggles / "window-glassy.lua").unlink()
        out = run("old")
        check("an Omarchy without transparent_window: the key only", out == ["bind SUPER + D"], out)
    finally:
        shutil.rmtree(base, ignore_errors=True)
    if failed:
        print(f"{len(failed)} failed")
        return 1
    print("all passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
