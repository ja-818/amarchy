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


def main():
    base = tempfile.mkdtemp(prefix="omarchy-tailscale-")
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
    finally:
        shutil.rmtree(base, ignore_errors=True)
    print(f"\n{len(failed)} failed" if failed else "\nall ok")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
