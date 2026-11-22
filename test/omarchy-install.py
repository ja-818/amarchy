#!/usr/bin/env python3
"""omarchy/install.sh in a home of its own, on Omarchy 4's own config files:
the Ⓐ plugin linked and put on the bar once, Super+Alt+A loaded from
hyprland.lua, Amarchy in the Omarchy menu (read by Omarchy's own menu parser),
what an amarchy from before left taken away, nothing changed on a second run,
and --uninstall leaving the files as they were.

Needs a checkout of Omarchy (basecamp/omarchy, branch quattro) in
OMARCHY_SRC (default /tmp/omarchy-src/omarchy), and node for its menu parser.
The running shell and Hyprland are fakes that log what they're asked (and the
shell writes shell.json as the real one would).

    python3 test/omarchy-install.py
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = Path(os.environ.get("OMARCHY_SRC", "/tmp/omarchy-src/omarchy"))
failed = []


def check(what, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + what + (f": {detail}" if detail and not ok else ""))
    if not ok:
        failed.append(what)


# The running shell: logs each call; putBarWidget and setPluginEnabled write
# shell.json the way the shell does, unless SHELL_DOWN is there (no shell).
FAKE_SHELL = r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
home = Path(os.environ["HOME"])
with open(home / "shell-calls", "a") as f:
    f.write(" ".join(sys.argv[1:]) + "\n")
if (home / "SHELL_DOWN").exists():
    sys.exit(1)
args = [a for a in sys.argv[1:] if a != "-q"]
conf = home / ".config/omarchy/shell.json"
if args[:2] == ["shell", "putBarWidget"]:
    c = json.loads(conf.read_text())
    ids = [w.get("id") for ws in c["bar"]["layout"].values() for w in ws]
    if args[2] not in ids:
        c["bar"]["layout"][json.loads(args[3])["section"]].append({"id": args[2]})
        conf.write_text(json.dumps(c, indent=2) + "\n")
    print("ok")
elif args[:2] == ["shell", "setPluginEnabled"] and args[3] == "false":
    c = json.loads(conf.read_text())
    c["bar"]["layout"] = {k: [w for w in ws if w.get("id") != args[2]] for k, ws in c["bar"]["layout"].items()}
    c["plugins"] = [p for p in c.get("plugins", []) if p.get("id") != args[2]]
    conf.write_text(json.dumps(c, indent=2) + "\n")
    print("ok")
else:
    print("ok")
'''
FAKE_HYPRCTL = '#!/bin/sh\necho "$@" >> "$HOME/hyprctl-calls"\necho ok\n'

MENU_PARSE = r'''
const fs = require("fs"), vm = require("vm");
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[1], "utf8"), ctx);
const user = ctx.readMenuJsonc(fs.readFileSync(process.argv[2], "utf8"));
const defaults = ctx.readMenuJsonc(fs.readFileSync(process.argv[3], "utf8"));
const merged = ctx.mergeMenuSources(defaults, user, "Go");
console.log(JSON.stringify({user, root: merged.itemOrder.filter(id => merged.items[id].parent === "root")}));
'''


def home_setup(base, omarchy=True):
    home = Path(base) / "home"
    cfg = home / ".config"
    (cfg / "hypr").mkdir(parents=True)
    (cfg / "omarchy/extensions").mkdir(parents=True)
    shutil.copy(SRC / "config/hypr/hyprland.lua", cfg / "hypr/hyprland.lua")
    shutil.copy(SRC / "config/omarchy/shell.json", cfg / "omarchy/shell.json")
    shutil.copy(SRC / "config/omarchy/extensions/omarchy-menu.jsonc", cfg / "omarchy/extensions/omarchy-menu.jsonc")
    fakes = Path(base) / "bin"
    fakes.mkdir()
    (fakes / "omarchy-shell").write_text(FAKE_SHELL)
    (fakes / "hyprctl").write_text(FAKE_HYPRCTL)
    for f in fakes.iterdir():
        f.chmod(0o755)
    env = {"HOME": str(home), "PATH": f"{fakes}:/usr/bin:/bin", "HYPRLAND_INSTANCE_SIGNATURE": "test",
           "OMARCHY_PATH": str(SRC) if omarchy else str(Path(base) / "no-omarchy")}
    return home, env


def run(env, *args):
    return subprocess.run([str(REPO / "omarchy/install.sh"), *args], env=env, capture_output=True, text=True)


def snapshot(home):
    """Every file under the home's config and state (backups aside), with what it says or where it points."""
    out = {}
    for p in sorted(home.rglob("*")):
        rel = str(p.relative_to(home))
        if ".amarchy-bak." in rel or not (rel.startswith(".config") or rel.startswith(".local")):
            continue
        if p.is_symlink():
            out[rel] = "-> " + os.readlink(p)
        elif p.is_file():
            out[rel] = p.read_text()
    return out


def bar_ids(home):
    c = json.loads((home / ".config/omarchy/shell.json").read_text())
    return {k: [w.get("id") for w in ws] for k, ws in c["bar"]["layout"].items()}, [p.get("id") for p in c.get("plugins", [])]


def menu(home):
    r = subprocess.run(["node", "-e", MENU_PARSE, str(SRC / "shell/plugins/menu/MenuModel.js"),
                        str(home / ".config/omarchy/extensions/omarchy-menu.jsonc"),
                        str(SRC / "default/omarchy/omarchy-menu.jsonc")], capture_output=True, text=True)
    return json.loads(r.stdout) if r.returncode == 0 else {"error": r.stderr}


def main():
    if not (SRC / "shell").is_dir():
        print(f"skip: no Omarchy checkout in {SRC} (OMARCHY_SRC=)")
        return 0
    plugin_link = "-> " + str(REPO / "omarchy/plugin")
    load = f'dofile("{REPO}/omarchy/hypr/amarchy.lua") -- amarchy'

    # A fresh Omarchy, its shell running.
    with tempfile.TemporaryDirectory() as base:
        home, env = home_setup(base)
        before = snapshot(home)
        r = run(env)
        check("install runs", r.returncode == 0, r.stderr + r.stdout)
        check("install says what it put", "the Ⓐ in the bar" in r.stdout and "Super+Alt+A" in r.stdout
              and "Amarchy in the Omarchy menu" in r.stdout, r.stdout)
        after = snapshot(home)
        check("plugin linked to this checkout", after.get(".config/omarchy/plugins/amarchy.chats") == plugin_link,
              after.get(".config/omarchy/plugins/amarchy.chats"))
        layout, _ = bar_ids(home)
        check("Ⓐ on the bar's left, at its end", layout.get("left", [])[-1:] == ["amarchy.chats"], layout)
        calls = (home / "shell-calls").read_text()
        check("asked the running shell to rescan and place it", "shell rescanPlugins" in calls
              and 'shell putBarWidget amarchy.chats {"section":"left"}' in calls, calls)
        hypr = (home / ".config/hypr/hyprland.lua").read_text()
        check("hyprland.lua loads the key, at its end", hypr.rstrip().endswith(load), hypr[-200:])
        check("hyprland.lua otherwise as it was",
              hypr.replace("\n\n" + load + "\n", "\n") == before[".config/hypr/hyprland.lua"].rstrip("\n") + "\n")
        check("Hyprland reloaded", "reload" in (home / "hyprctl-calls").read_text())
        m = menu(home)
        entry = next((i for i in m.get("user", []) if i["id"] == "amarchy"), None)
        check("menu file reads as Omarchy reads it", "error" not in m, m.get("error"))
        check("Amarchy on the Omarchy menu's root", entry and entry["parent"] == "root" and "amarchy" in m["root"], m)
        check("its action runs amarchy open", entry and entry["action"] == f"'{home}/.local/bin/amarchy' open",
              entry and entry["action"])
        check("placed once (marker)", (home / ".local/state/amarchy/omarchy-bar-placed").is_file())

        backups = sorted(str(p) for p in home.rglob("*.amarchy-bak.*"))
        check("a backup of each file it changed", len(backups) == 2, backups)

        # Again: nothing new, nothing said, no backups.
        r2 = run(env)
        check("second run changes nothing", snapshot(home) == after and not r2.stdout.startswith("\x1b[1m"), r2.stdout)
        check("no backup made for nothing", sorted(str(p) for p in home.rglob("*.amarchy-bak.*")) == backups)

        # You took the Ⓐ off the bar: an update doesn't put it back.
        c = json.loads((home / ".config/omarchy/shell.json").read_text())
        c["bar"]["layout"]["left"] = [w for w in c["bar"]["layout"]["left"] if w.get("id") != "amarchy.chats"]
        (home / ".config/omarchy/shell.json").write_text(json.dumps(c, indent=2) + "\n")
        run(env)
        layout, _ = bar_ids(home)
        check("taken off the bar, it stays off", "amarchy.chats" not in sum(layout.values(), []), layout)

        # Uninstall: every file as it was.
        r = run(env, "--uninstall")
        check("uninstall runs", r.returncode == 0, r.stderr)
        gone = snapshot(home)
        for f in (".config/hypr/hyprland.lua", ".config/omarchy/extensions/omarchy-menu.jsonc"):
            check(f"uninstall leaves {f} as it was", gone.get(f) == before.get(f),
                  "\n".join(l for l in (gone.get(f) or "").splitlines() if "amarchy" in l))
        check("uninstall takes the plugin link away", ".config/omarchy/plugins/amarchy.chats" not in gone)
        check("uninstall forgets the bar was placed", ".local/state/amarchy/omarchy-bar-placed" not in gone)
        check("uninstall says what it took", "Took away" in r.stdout, r.stdout)

    # Installed, then uninstalled with the Ⓐ still on the bar: off the bar too.
    with tempfile.TemporaryDirectory() as base:
        home, env = home_setup(base)
        before = snapshot(home)
        run(env)
        run(env, "--uninstall")
        layout, plugins = bar_ids(home)
        check("uninstall takes the Ⓐ off the bar", "amarchy.chats" not in sum(layout.values(), []) + plugins, layout)
        check("shell.json back as it was", json.loads(snapshot(home)[".config/omarchy/shell.json"])
              == json.loads(before[".config/omarchy/shell.json"]))

    # No shell running (installing over ssh): shell.json itself, both ways.
    with tempfile.TemporaryDirectory() as base:
        home, env = home_setup(base)
        (home / "SHELL_DOWN").write_text("")
        r = run(env)
        check("install without a shell runs", r.returncode == 0, r.stderr)
        layout, _ = bar_ids(home)
        check("without a shell, shell.json gets the Ⓐ", "amarchy.chats" in layout.get("left", []), layout)
        run(env, "--uninstall")
        layout, plugins = bar_ids(home)
        check("without a shell, uninstall takes it out of shell.json", "amarchy.chats" not in sum(layout.values(), []) + plugins, layout)

    # What an amarchy from before left: its plugin "amarchy" (on the bar and in
    # plugins[]), its load line, its menu block, and the menu with an entry of
    # the user's own after it.
    with tempfile.TemporaryDirectory() as base:
        home, env = home_setup(base)
        old_src = Path(base) / "old-checkout/omarchy/plugin"
        old_src.mkdir(parents=True)
        (home / ".config/omarchy/plugins").mkdir(parents=True)
        (home / ".config/omarchy/plugins/amarchy").symlink_to(old_src)
        c = json.loads((home / ".config/omarchy/shell.json").read_text())
        c["bar"]["layout"]["left"].append({"id": "amarchy"})
        c["plugins"] = [{"id": "amarchy"}]
        (home / ".config/omarchy/shell.json").write_text(json.dumps(c, indent=2) + "\n")
        with open(home / ".config/hypr/hyprland.lua", "a") as f:
            f.write(f'\ndofile("{base}/old-checkout/hypr/amarchy.lua") -- amarchy\n')
        menu_file = home / ".config/omarchy/extensions/omarchy-menu.jsonc"
        t = menu_file.read_text()
        i = t.rfind("}")
        menu_file.write_text(t[:i] + '  // >>> amarchy\n  "amarchy": {"label":"Amarchy","action":"old"},\n'
                             '  "amarchy.new": {"label":"New session","action":"old new"},\n  // <<< amarchy\n'
                             '  "mine": {"label":"Mine","action":"true"},\n}\n')
        (home / ".config/omarchy/hooks/theme-set.d").mkdir(parents=True)
        (home / ".config/omarchy/hooks/theme-set.d/amarchy").write_text(
            '#!/bin/bash\n# Installed by amarchy\n[[ -x x ]] && "x/amarchy" theme --refresh\nexit 0\n')
        r = run(env)
        check("old theme hook gone", not (home / ".config/omarchy/hooks/theme-set.d/amarchy").exists())
        check("install over an old one runs", r.returncode == 0, r.stderr)
        layout, plugins = bar_ids(home)
        check("old plugin off the bar and out of plugins[]", "amarchy" not in sum(layout.values(), []) + plugins,
              (layout, plugins))
        check("old plugin link gone", not (home / ".config/omarchy/plugins/amarchy").exists())
        hypr = (home / ".config/hypr/hyprland.lua").read_text()
        check("old load line replaced by the new one", "old-checkout" not in hypr and hypr.count("-- amarchy") == 1
              and load in hypr, [l for l in hypr.splitlines() if "amarchy" in l])
        m = menu(home)
        ids = [i["id"] for i in m.get("user", [])]
        check("old menu block replaced, your own entry kept", ids.count("amarchy") == 1 and "amarchy.new" not in ids
              and "mine" in ids, ids)

    # Not Omarchy (or no longer): install takes away what's left.
    with tempfile.TemporaryDirectory() as base:
        home, env = home_setup(base, omarchy=False)
        with open(home / ".config/hypr/hyprland.lua", "a") as f:
            f.write('\ndofile("/gone/hypr/amarchy.lua") -- amarchy\n')
        r = run(env)
        check("off Omarchy, install runs", r.returncode == 0, r.stderr)
        check("off Omarchy, the old load line goes", "-- amarchy" not in (home / ".config/hypr/hyprland.lua").read_text())
        check("off Omarchy, no plugin", not (home / ".config/omarchy/plugins/amarchy.chats").exists())

    print(f"\n{len(failed)} failed" if failed else "\nall ok")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
