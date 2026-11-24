#!/usr/bin/env python3
"""`amarchy tailscale`, with a fake tailscale on its PATH (this machine's own
Tailscale is never asked anything): where it stands and the next step, in
each state a machine goes through; what needs root only said, never run,
without a terminal; the sign-in link got (tailscale up, left running) and
shown; MagicDNS and HTTPS off pointed at the admin page; your machines on
another tailnet said, with the accounts to switch to; switching; and how to
install it, Omarchy's way on Omarchy, pacman's on Arch.

    python3 test/omarchy-tailscale.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent)); import homes      # (test/homes.py: its home gone with it, however it ends)

REPO = Path(__file__).resolve().parent.parent
failed = []


def check(what, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + what + (f": {detail}" if detail and not ok else ""), flush=True)
    if not ok:
        failed.append(what)


FAKE = r'''#!/usr/bin/env python3
import json, os, pwd, sys
home = os.environ["HOME"]
f = os.path.join(home, "ts.json")
sc = json.load(open(f))
args = sys.argv[1:]
open(os.path.join(home, "ts-calls"), "a").write(" ".join(args) + "\n")
def save(): json.dump(sc, open(f, "w"))
if args[:2] == ["status", "--json"]:
    if not sc.get("running", True): print("failed to connect to local tailscaled; it doesn't appear to be running"); sys.exit(1)
    acct = next(a for a in sc["accounts"] if a["selected"])
    print(json.dumps({"BackendState": sc["state"], "AuthURL": sc.get("auth_url", ""),
        "CertDomains": [sc["name"]] if sc.get("https") else None,
        "CurrentTailnet": {"Name": acct["tailnet"], "MagicDNSSuffix": sc["name"].split(".", 1)[1], "MagicDNSEnabled": sc.get("magicdns", True)},
        "Self": {"DNSName": sc["name"] + ".", "UserID": 1}, "User": {"1": {"LoginName": acct["account"]}}}))
elif args[:2] == ["debug", "prefs"]:
    print(json.dumps({"OperatorUser": sc.get("operator", pwd.getpwuid(os.getuid()).pw_name)}))
elif args[:3] == ["switch", "--list", "--json"]:
    print(json.dumps(sc["accounts"]))
elif args[:1] == ["switch"]:
    for a in sc["accounts"]: a["selected"] = a["id"] == args[1]
    save()
elif args[:1] == ["up"]:
    if sc["state"] == "NeedsLogin": sc["auth_url"] = "https://login.tailscale.com/a/cli-test-0000"
    else: sc["state"] = "Running"
    save()
'''

# amarchy's own node (track H): its status and login, and its cli, which is
# Tailscale's own CLI against it (the fake tailscale above, on the same
# scenario). Running once its socket is there (the fake systemctl makes it).
NODE = r'''#!/usr/bin/env python3
import json, os, subprocess, sys
home = os.environ["HOME"]
sock = os.path.join(os.environ["XDG_STATE_HOME"], "amarchy/tailnet/tailscaled.sock")
f = os.path.join(home, "ts.json")
sc = json.load(open(f))
args = sys.argv[1:]
open(os.path.join(home, "node-calls"), "a").write(" ".join(args) + "\n")
up = os.path.exists(sock)
if args[:2] == ["status", "--json"]:
    print(json.dumps({"running": up, "state": sc["state"] if up else "off", "words": "the node"}))
elif args[:1] == ["login"]:
    if not up: print("amarchy's own node isn't running (systemctl --user start amarchy-tailnet)"); sys.exit(1)
    if sc["state"] != "NeedsLogin": print("Signed in already: on"); sys.exit(0)
    sc["auth_url"] = "https://login.tailscale.com/a/own-node-0000"; json.dump(sc, open(f, "w"))
    print(sc["auth_url"])
elif args[:1] == ["cli"]:
    rest = args[3:] if args[1:2] == ["--state"] else args[1:]
    sys.exit(subprocess.run([os.path.join(os.path.dirname(sys.argv[0]), "tailscale-for-node"), *rest]).returncode)
'''
SYSTEMCTL = r'''#!/bin/sh
echo "$@" >> "$HOME/systemctl-calls"
case "$*" in *"enable --now amarchy-tailnet.service"*)
  /usr/bin/mkdir -p "$XDG_STATE_HOME/amarchy/tailnet" && : > "$XDG_STATE_HOME/amarchy/tailnet/tailscaled.sock" ;;
esac
'''

ONE = [{"id": "a1", "account": "julian@example.com", "tailnet": "julian@example.com", "selected": True}]
TWO = ONE + [{"id": "b2", "account": "julian@work.example", "tailnet": "work.example", "selected": False}]
READY = {"running": True, "state": "Running", "name": "desk.tail1234.ts.net", "magicdns": True, "https": True,
         "accounts": ONE}


def setup(base, tailscale=True, extra=()):
    home = Path(base) / "home"
    fakes = Path(base) / "bin"
    fakes.mkdir(parents=True)
    if tailscale:
        (fakes / "tailscale").write_text(FAKE)
    for name in extra:
        (fakes / name).write_text("#!/bin/sh\nexit 0\n")
    for f in fakes.iterdir():
        f.chmod(0o755)
    (home / "Work").mkdir(parents=True)
    env = {"HOME": str(home), "XDG_STATE_HOME": str(home / "state"), "XDG_CONFIG_HOME": str(home / "config"),
           # Not installed: only the fakes (this machine's own tailscale is in /usr/bin).
           "PATH": f"{fakes}:/usr/bin:/bin" if tailscale else str(fakes),
           "AMARCHY_HOST_NAME": "desk", "AMARCHY_WORK": str(home / "Work"), "LANG": "C.UTF-8"}
    return home, env


def scenario(home, **sc):
    (home / "ts.json").write_text(json.dumps({**READY, **sc}))


def ts(env, *args):
    r = subprocess.run([sys.executable, str(REPO / "bin/amarchy"), "tailscale", *args], env=env, capture_output=True,
                       text=True, timeout=60, stdin=subprocess.DEVNULL)
    return r.returncode, r.stdout + r.stderr


def own_node(base):
    """No system Tailscale; amarchy's own node built (or not) here."""
    home, env = setup(base, tailscale=False, extra=("systemctl",))
    fakes = Path(env["PATH"])
    # (Only the fakes on the PATH, this machine's own tailscale being in /usr/bin: they name what they run in full.)
    (fakes / "systemctl").write_text(SYSTEMCTL.replace("#!/bin/sh", "#!/usr/bin/sh"))
    for f in fakes.iterdir():
        f.chmod(0o755)
    env["PATH"] = str(fakes)

    # Neither: the node offered first, the system's Tailscale the other way.
    code, out = ts(env)
    check("no Tailscale at all: amarchy's own node first, nothing else to install",
          code == 1 and f"amarchy's own node (nothing else to install): {REPO}/tailnet/install.sh" in out
          and "Or the system's Tailscale: https://tailscale.com/download/linux" in out
          and out.index("own node") < out.index("Or the system's"), out)
    st = json.loads(ts(env, "--json")[1])
    check("--json: its steps, the node then the system's as the other way",
          [s["do"] for s in st["steps"]] == ["own-install", "install"] and st["steps"][1].get("alt") and st["node"] is None, st["steps"])

    # Built, not running: started (a user service, no root, nothing asked), then the sign-in.
    (home / ".local/bin").mkdir(parents=True)
    (home / ".local/bin/amarchy-tailnet").write_text(NODE.replace("#!/usr/bin/env python3", f"#!{sys.executable}"))
    (home / ".local/bin/amarchy-tailnet").chmod(0o755)
    (home / ".local/bin/tailscale-for-node").write_text(FAKE.replace("#!/usr/bin/env python3", f"#!{sys.executable}"))
    (home / ".local/bin/tailscale-for-node").chmod(0o755)       # the node's own CLI, beside it
    scenario(home, state="NeedsLogin")
    code, out = ts(env, "--no-open")
    check("its node built but off: started, then its sign-in link", "--user enable --now amarchy-tailnet.service"
          in (home / "systemctl-calls").read_text() and "https://login.tailscale.com/a/own-node-0000" in out, out)
    check("signed in through amarchy-tailnet login", "login --no-open" in (home / "node-calls").read_text())
    st = json.loads(ts(env, "--json")[1])
    check("it says it's amarchy's own node, and that it drives it", st["node"] == "own" and st["operator"] is True
          and st["auth_url"] == "https://login.tailscale.com/a/own-node-0000", st)

    scenario(home, state="Running")
    code, out = ts(env)
    check("on: its words say amarchy's own node", code == 0
          and "amarchy's own node: On: desk.tail1234.ts.net, as julian@example.com." in out and "Ready" in out, out)
    check("its status asked through its own cli", "cli --state" in (home / "node-calls").read_text())


def main():
    base = homes.home("omarchy-tailscale")
    try:
        home, env = setup(Path(base) / "a")
        scenario(home)
        code, out = ts(env)
        check("ready: says so, exits 0", code == 0 and "On: desk.tail1234.ts.net, as julian@example.com. MagicDNS on, HTTPS on."
              in out and "Ready" in out, out)
        st = json.loads(ts(env, "--json")[1])
        check("--json: the state", st["ready"] and st["steps"] == [] and st["account"] == "julian@example.com", st)

        scenario(home, state="NeedsLogin")
        code, out = ts(env, "--no-open")
        check("not signed in: the sign-in link, from tailscale up left running",
              "Sign in at:" in out and "https://login.tailscale.com/a/cli-test-0000" in out, out)
        check("tailscale up was asked, with a timeout", "up --timeout=15m" in (home / "ts-calls").read_text())

        scenario(home, state="Stopped")
        code, out = ts(env)
        check("off: turned on", code == 0 and "On: desk" in out and json.loads((home / "ts.json").read_text())["state"] == "Running",
              out)

        scenario(home, state="NeedsMachineAuth")
        code, out = ts(env, "--no-open")
        check("waiting for approval: the admin's machines page", code == 1 and "https://login.tailscale.com/admin/machines" in out,
              out)

        scenario(home, magicdns=False, https=False)
        code, out = ts(env, "--no-open")
        check("MagicDNS and HTTPS off: the admin's DNS page", code == 1 and "Turn on MagicDNS and Turn on HTTPS certificates"
              in out and "https://login.tailscale.com/admin/dns" in out, out)

        scenario(home, state="NeedsLogin", operator="root")
        ups = (home / "ts-calls").read_text().count("up --timeout")
        code, out = ts(env)
        check("not allowed to drive it, no terminal: says what to run, runs nothing",
              code == 1 and "Run it in a terminal: sudo tailscale set --operator=" in out
              and (home / "ts-calls").read_text().count("up --timeout") == ups, out)

        scenario(home, running=False)
        code, out = ts(env)
        check("service not running: says how to start it", code == 1 and "sudo systemctl enable --now tailscaled" in out, out)

        # Accounts, and a machine of yours on another tailnet.
        scenario(home, accounts=TWO)
        code, out = ts(env, "switch")
        check("switch: the accounts, the one in use marked", out.splitlines()[0].startswith("* julian@example.com")
              and "julian@work.example" in out, out)
        code, out = ts(env, "switch", "julian@work.example")
        check("switch <account>: switched", code == 0 and "as julian@work.example" in out, out)
        code, out = ts(env, "switch", "nobody@nowhere")
        check("switch to an account not here: refused", code == 1 and "no account 'nobody@nowhere' here" in out, out)
        scenario(home, accounts=TWO)
        (home / "config/amarchy").mkdir(parents=True, exist_ok=True)
        (home / "config/amarchy/machines.json").write_text(json.dumps(
            [{"name": "amarchy", "label": "Server", "url": "https://amarchy.tail9999.ts.net", "key": "k" * 43}]))
        code, out = ts(env)
        check("your machines on another tailnet: said, with the accounts to switch to", code == 1
              and "Server (tail9999.ts.net)" in out and "amarchy tailscale switch julian@work.example" in out, out)
        (home / "config/amarchy/machines.json").unlink()

        # Not installed: how, by the system.
        for extra, want in ((("omarchy-install-service-tailscale",), "omarchy-install-service-tailscale"),
                            (("pacman",), "sudo pacman -S --needed tailscale"), ((), "https://tailscale.com/download/linux")):
            h2, e2 = setup(Path(base) / f"none-{len(extra)}-{'-'.join(extra)}", tailscale=False, extra=extra)
            code, out = ts(e2)
            check(f"not installed{' (' + extra[0] + ')' if extra else ''}: {want}", code == 1 and want in out, out)
        own_node(Path(base) / "own")
    finally:
        homes.clean_up()      # its home goes now (not only at the exit)
    print(f"\n{len(failed)} failed" if failed else "\nall ok")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
