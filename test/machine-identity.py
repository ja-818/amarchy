# A machine's identity across a tailnet move (docs/plan-omarchy-and-machines.md,
# "Machines"): its name kept once it's paired (a tailnet that renames it
# breaks no pair); "yours" is its owner on Tailscale plus APP_USERS (one
# person's logins on two tailnets); an address a peer gives is taken only on
# this machine's own tailnet; the app's last known address and logins kept
# while Tailscale is logged out. Without a server or a network.
#
#   python3 test/machine-identity.py       exits 0 when every check passed

import importlib.machinery, importlib.util, json, os, sys, tempfile
from pathlib import Path

home = tempfile.mkdtemp(prefix="machine-identity-")
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config")
for k in [k for k in os.environ if k.startswith("AMARCHY_HOST_")]:
    del os.environ[k]
entry = str(Path(__file__).resolve().parent.parent / "bin/amarchy")
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", entry)
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failed.append(what)

STATUS = {"Self": {"UserID": 7, "DNSName": "box.tail1234.ts.net."}, "MagicDNSSuffix": "tail1234.ts.net",
          "User": {"7": {"LoginName": "me@personal.example"}}}
am.tailscale_status = lambda: STATUS
am.tailnet_status = lambda fresh=False: STATUS

print("the name")
am.host_name = lambda: "box"
check(am.machine_name() == "box", "its Tailscale name, before it's paired")
am.machine_name_keep()
check(am.MACHINE_NAME_FILE.read_text().strip() == "box", "kept once paired")
am.host_name = lambda: "box-main"
check(am.machine_name() == "box", "Tailscale renames it (a move): still box, as the others know it")
os.environ["AMARCHY_HOST_NAME"] = "named"
check(am.machine_name() == "named", "NAME= in the host settings wins")
del os.environ["AMARCHY_HOST_NAME"]

print("yours")
check(am.app_users(STATUS) == {"me@personal.example"}, "the machine's owner")
os.environ["AMARCHY_HOST_APP_USERS"] = "me@work.example, other@work.example"
check(am.app_users(STATUS) == {"me@personal.example", "me@work.example", "other@work.example"}, "and APP_USERS, besides it")
check(am.app_users({}) == {"me@work.example", "other@work.example"}, "Tailscale logged out: APP_USERS alone")
h = am.hello()
check(h["user"] == "me@personal.example" and set(h["users"]) == am.app_users(STATUS), f"hello: its owner, and every login it takes ({h['user']})")
del os.environ["AMARCHY_HOST_APP_USERS"]

print("an address a peer gives")
check(am.machine_url_here("https://ja.tail1234.ts.net"), "on this tailnet: taken")
check(not am.machine_url_here("https://ja.tailother.ts.net"), "on another tailnet (it reaches this one through a proxy): not")
check(am.machine_url_here("http://127.0.0.1:9999"), "this machine itself (a test's second server): taken")
check(not am.machine_url_here("http://10.0.0.5:9999"), "plain http elsewhere: not")
check(not am.machine_url_ok("http://example.com:80") and am.machine_url_ok("https://ja.tail1234.ts.net"),
      "a key never goes in the clear: https, or this machine")

print("the tailnet while Tailscale is logged out")
check(am.tailnet_last() == {}, "nothing kept yet")
am.tailnet_last("box.tail1234.ts.net", {"me@personal.example"})
kept = am.tailnet_last()
check(kept.get("address") == "box.tail1234.ts.net" and kept.get("users") == ["me@personal.example"], f"kept as Tailscale said ({kept})")
am.tailnet_last(None, set())
check(am.tailnet_last().get("address") == "box.tail1234.ts.net", "nothing said: the last kept stays")

print(f"\n{'all passed' if not failed else f'{len(failed)} failed'}")
sys.exit(1 if failed else 0)
