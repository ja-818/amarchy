#!/usr/bin/env python3
"""The key that brings amarchy to the front on Omarchy, a setting:

- omarchy/hypr/amarchy.lua, run by Lua with a stand-in for Omarchy's `o` and
  Hyprland's `hl` (each logs what it's asked, as Omarchy's own bindings left
  them: Super+Shift+A its AI key): Super+D by default, Omarchy's keys
  left alone; a key you picked (amarchy key) takes the chord, whatever was
  there giving way; off: no key; a setting that isn't a chord: the default;
  outside Omarchy's config: nothing.
- `amarchy key`: says the key; sets one as you'd type it (Super+Ctrl+M),
  refuses what isn't one; off; default; Hyprland reloaded when it runs.
- The Omarchy menu's entry shows the key under it, and follows it
  (omarchy/install.sh --menu, which amarchy key runs).

Needs lua (any 5.x) for the first part, and a checkout of Omarchy in
OMARCHY_SRC (default /tmp/omarchy-src/omarchy) for the last.

    python3 test/omarchy-key.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = Path(os.environ.get("OMARCHY_SRC", "/tmp/omarchy-src/omarchy"))
failed = []


def check(what, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + what + (f": {detail}" if detail and not ok else ""), flush=True)
    if not ok:
        failed.append(what)


# Omarchy's o and Hyprland's hl, as its bindings leave them: Super+Shift+A
# bound to its AI web app. Prints what's bound after the file ran.
STAND_IN = r'''
local binds = { ["SUPER + SHIFT + A"] = "AI", ["SUPER + A"] = "Select all" }
local log = {}
hl = { unbind = function(k) table.insert(log, "unbind " .. k); binds[k] = nil end }
o = { bind = function(k, d, c) table.insert(log, "bind " .. k .. " | " .. tostring(d) .. " | " .. c); binds[k] = d end }
if arg[2] == "no-omarchy" then o = nil end
dofile(arg[1])
for _, l in ipairs(log) do print(l) end
local keys = {}
for k, d in pairs(binds) do table.insert(keys, k .. "=" .. d) end
table.sort(keys)
print("now: " .. table.concat(keys, ", "))
'''


def lua_test(base):
    lua = shutil.which("lua") or shutil.which("lua5.4") or shutil.which("lua54")
    if not lua:
        print("skip: no lua here")
        return
    home = Path(base) / "lua-home"
    (home / ".config/amarchy").mkdir(parents=True)
    script = Path(base) / "stand-in.lua"
    script.write_text(STAND_IN)

    def run(setting=None, extra=""):
        f = home / ".config/amarchy/key"
        f.unlink(missing_ok=True)
        if setting is not None:
            f.write_text(setting + "\n")
        r = subprocess.run([lua, str(script), str(REPO / "omarchy/hypr/amarchy.lua"), extra], capture_output=True,
                           text=True, env={"HOME": str(home), "PATH": "/usr/bin:/bin"})
        return (r.stdout + r.stderr).strip().splitlines()
    bin_ = f"'{home}/.local/bin/amarchy' open"
    out = run()
    check("default: Super+D, Omarchy's keys left alone", out == [
        f"bind SUPER + D | Amarchy | {bin_}",
        "now: SUPER + A=Select all, SUPER + D=Amarchy, SUPER + SHIFT + A=AI"], out)
    out = run("SUPER + CTRL + M")
    check("a key picked: that one", out[-1] == "now: SUPER + A=Select all, SUPER + CTRL + M=Amarchy, SUPER + SHIFT + A=AI"
          and f"bind SUPER + CTRL + M | Amarchy | {bin_}" in out, out)
    out = run("SUPER + SHIFT + A")
    check("a key picked that Omarchy uses: it gives way", out == [
        "unbind SUPER + SHIFT + A", f"bind SUPER + SHIFT + A | Amarchy | {bin_}",
        "now: SUPER + A=Select all, SUPER + SHIFT + A=Amarchy"], out)
    out = run("off")
    check("off: no key, Omarchy's left alone", out == ["now: SUPER + A=Select all, SUPER + SHIFT + A=AI"], out)
    out = run("SUPER + A\"); os.execute(\"touch /tmp/x")
    check("a setting that isn't a chord: the default", out[-1].startswith("now:") and "SUPER + D=Amarchy" in out[-1]
          and "SUPER + A=Select all" in out[-1], out)
    out = run(None, "no-omarchy")
    check("outside Omarchy's config: nothing bound", out == ["now: SUPER + A=Select all, SUPER + SHIFT + A=AI"], out)


def cli_test(base):
    home = Path(base) / "cli-home"
    fakes = Path(base) / "cli-bin"
    fakes.mkdir(parents=True)
    (fakes / "hyprctl").write_text('#!/bin/sh\necho "$@" >> "$HOME/hyprctl-calls"\n'
                                   '[ "$1" = binds ] && cat "$HOME/binds.json" 2>/dev/null\n')
    (fakes / "hyprctl").chmod(0o755)
    (home / "Work").mkdir(parents=True)
    env = {"HOME": str(home), "XDG_STATE_HOME": str(home / "state"), "XDG_CONFIG_HOME": str(home / "config"),
           "AMARCHY_WORK": str(home / "Work"), "AMARCHY_HOST_NAME": "desk", "PATH": f"{fakes}:/usr/bin:/bin",
           "HYPRLAND_INSTANCE_SIGNATURE": "test", "LANG": "C.UTF-8"}

    def key(*args):
        r = subprocess.run([sys.executable, str(REPO / "bin/amarchy"), "key", *args], env=env, capture_output=True,
                           text=True, timeout=30)
        return r.returncode, (r.stdout + r.stderr).strip()
    setting = home / "config/amarchy/key"
    code, out = key()
    check("says the key: Super+D, the default", code == 0 and out.startswith("Super+D brings amarchy to the front (the default)"), out)
    code, out = key("Super+Ctrl+M")
    check("sets one as you'd type it", code == 0 and setting.read_text() == "SUPER + CTRL + M\n"
          and out.startswith("Super+Ctrl+M brings amarchy to the front, in place of anything Omarchy had there"), out)
    check("and Hyprland reloads", "reload" in (home / "hyprctl-calls").read_text())
    code, out = key("M")
    check("a key without a modifier: refused, the setting kept", code == 1 and "isn't a key" in out
          and setting.read_text() == "SUPER + CTRL + M\n", out)
    code, out = key("off")
    check("off", code == 0 and setting.read_text() == "off\n" and out.startswith("No key brings amarchy"), out)
    code, out = key("default")
    check("default: the setting gone", code == 0 and not setting.exists() and "(the default)" in out, out)
    code, out = key("super d")
    check("the default typed out: no setting kept", code == 0 and not setting.exists(), out)

    # What else this machine's Hyprland has on the key (hyprctl binds).
    binds = home / "binds.json"
    binds.write_text(json.dumps([
        {"modmask": 64, "key": "D", "keycode": 0, "submap": "", "description": "Amarchy", "dispatcher": "exec",
         "arg": "'/home/x/.local/bin/amarchy' open"},
        {"modmask": 65, "key": "D", "keycode": 0, "submap": "", "description": "Docker", "dispatcher": "exec", "arg": "x"}]))
    code, out = key()
    check("only amarchy's on Super+D (another chord is another key): nothing said", "something else" not in out, out)
    code, out = key("--check")
    check("--check: nothing to say", code == 0 and out == "", out)
    binds.write_text(json.dumps([
        {"modmask": 64, "key": "d", "keycode": 0, "submap": "", "description": "My dictation", "dispatcher": "exec",
         "arg": "voxtype record toggle"},
        {"modmask": 64, "key": "D", "keycode": 0, "submap": "resize", "description": "In a submap", "dispatcher": "x", "arg": ""}]))
    code, out = key()
    check("Super+D taken by your own binding: said, with how to pick another",
          "But this machine's Hyprland has something else on Super+D too: My dictation. Pick another key" in out, out)
    code, out = key("--check")
    check("--check: says it", code == 0 and out == "Super+D is also bound here: My dictation. Another key: amarchy key <keys>", out)
    binds.unlink()


def omarchy_free_test():
    """Omarchy's own bindings (its defaults, every region's, the user file it
    ships) leave the default free."""
    if not (SRC / "default/hypr/bindings").is_dir():
        print(f"skip: no Omarchy checkout in {SRC}")
        return
    import re as re_
    found = []
    for f in [*(SRC / "default/hypr").rglob("*.lua"), *(SRC / "config/hypr").rglob("*.lua")]:
        for m in re_.finditer(r'"(SUPER(?: \+ [A-Z]+)*)"', f.read_text()):
            if m.group(1) in ("SUPER + D",):
                found.append(f"{f.relative_to(SRC)}: {m.group(1)}")
    check("Omarchy's own bindings leave Super+D free", not found, found)


def menu_test(base):
    if not (SRC / "shell").is_dir():
        print(f"skip: no Omarchy checkout in {SRC}")
        return
    home = Path(base) / "menu-home"
    (home / ".config/hypr").mkdir(parents=True)
    (home / ".config/omarchy/extensions").mkdir(parents=True)
    shutil.copy(SRC / "config/hypr/hyprland.lua", home / ".config/hypr/hyprland.lua")
    shutil.copy(SRC / "config/omarchy/shell.json", home / ".config/omarchy/shell.json")
    shutil.copy(SRC / "config/omarchy/extensions/omarchy-menu.jsonc", home / ".config/omarchy/extensions/omarchy-menu.jsonc")
    fakes = Path(base) / "menu-bin"
    fakes.mkdir()
    for name in ("omarchy-shell", "systemctl", "hyprctl"):
        (fakes / name).write_text("#!/bin/sh\nexit 1\n" if name == "omarchy-shell" else "#!/bin/sh\n")
        (fakes / name).chmod(0o755)
    env = {"HOME": str(home), "PATH": f"{fakes}:/usr/bin:/bin", "OMARCHY_PATH": str(SRC)}

    def hint():
        t = (home / ".config/omarchy/extensions/omarchy-menu.jsonc").read_text()
        line = next((l for l in t.splitlines() if '"amarchy":' in l), "")
        return json.loads(line.split(":", 1)[1].strip().rstrip(",")).get("description", "") if line else ""
    subprocess.run([str(REPO / "omarchy/install.sh")], env=env, capture_output=True, text=True)
    check("the menu's entry shows the key", hint() == "Your chats · Super+D. Stop babysitting your agents.", hint())
    (home / ".config/amarchy").mkdir(parents=True, exist_ok=True)
    (home / ".config/amarchy/key").write_text("SUPER + CTRL + M\n")
    r = subprocess.run([str(REPO / "omarchy/install.sh"), "--menu"], env=env, capture_output=True, text=True)
    check("--menu: the hint follows the key", r.returncode == 0 and hint() == "Your chats · Super+Ctrl+M. Stop babysitting your agents.",
          (r.stderr, hint()))
    (home / ".config/amarchy/key").write_text("off\n")
    subprocess.run([str(REPO / "omarchy/install.sh"), "--menu"], env=env, capture_output=True, text=True)
    check("off: no key in the hint", hint() == "Your chats. Stop babysitting your agents.", hint())


def main():
    base = tempfile.mkdtemp(prefix="omarchy-key-")
    try:
        lua_test(base)
        omarchy_free_test()
        cli_test(base)
        menu_test(base)
    finally:
        shutil.rmtree(base, ignore_errors=True)
    print(f"\n{len(failed)} failed" if failed else "\nall ok")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
