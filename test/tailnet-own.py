# bin/amarchy on a computer whose Tailscale is amarchy's own node (track H):
# run by tailnet/node/amarchy_test.go, which brings up a tailnet of its own,
# the node (as its service runs it) in a home of its own, and another machine
# answering as an amarchy. Here: amarchy takes the node for this computer's
# Tailscale, its `tailscale ...` runs on it (status, its name and address,
# serving), what it serves is for the tailnet (not an address of the
# computer's own to listen on), and a call to another machine goes through
# the node's proxy (the http.client of peer calls, and a raw socket).
#
#   go test ./tailnet/node -run TestAmarchyOnItsOwnNode     (from the repo)

import importlib.machinery
import importlib.util
import json
import os
import sys
from pathlib import Path

if "TAILNET_TEST_PEER" not in os.environ:
    raise SystemExit("run by tailnet/node/amarchy_test.go (go test ./tailnet/node -run TestAmarchyOnItsOwnNode)")
for k in ("AMARCHY_SESSION", "AMARCHY_SENT_BY"):
    os.environ.pop(k, None)
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(Path(__file__).resolve().parent.parent / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)

failed = []


def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}", flush=True)
    if not ok:
        failed.append(what)


check(not am.system_tailscale(), "the system's Tailscale set aside (TAILSCALE=own: the test's)")
check(am.tailnet_own(), "amarchy's own node is this computer's Tailscale (its socket answers)")
check(am.tailscale_argv(["status"])[1:4] == ["cli", "--state", str(am.TAILNET)], "`tailscale ...` runs as amarchy-tailnet cli")
st = am.tailscale_status()
check((st.get("Self") or {}).get("DNSName") == "desk.tail-scale.ts.net.", f"tailscale status: the node ({(st.get('Self') or {}).get('DNSName')})")
check(am.app_address(st) == "desk.tail-scale.ts.net", "its name on the tailnet")
check(am.tailscale_here(), "a Tailscale amarchy can use, without the system's")
name, bind = am.host_network()
check(name == "desk" and bind is None, f"its name; no tailnet address of the computer's own to listen on ({name}, {bind})")

# Serving, as amarchy serves (`tailscale serve`), on the node.
r = am.sh("tailscale", "serve", "--bg", "--http=8081", os.environ["TAILNET_TEST_APP"])
check(r.returncode == 0, f"tailscale serve on the node ({r.returncode} {(r.stderr or r.stdout).strip()[:200]})")
conf = json.loads(am.sh("tailscale", "serve", "status", "--json").stdout or "{}")
check("8081" in (conf.get("TCP") or {}), "and its serve status says so")

# Another machine: its hello through the node's proxy (peer calls' http.client).
peer = {"url": os.environ["TAILNET_TEST_PEER"], "name": "srv"}
try:
    conn, res = am.peer_request(peer, "GET", "/api/peer/hello")
    hello = json.loads(res.read())
    conn.close()
except Exception as e:  # noqa: BLE001 (said below)
    hello = {"error": str(e)}
check(hello.get("name") == "srv" and hello.get("peer") == am.machine_name(), f"a call to another machine, through the node ({hello})")
# A raw socket (the pass-through's WebSocket), through the node.
try:
    s = am.tailnet_dial("srv.tail-scale.ts.net", 8080, 20)
    s.sendall(b"GET /api/peer/hello HTTP/1.1\r\nHost: srv\r\nConnection: close\r\n\r\n")
    got = b""
    while True:
        chunk = s.recv(4096)
        if not chunk:
            break
        got += chunk
    s.close()
except Exception as e:  # noqa: BLE001
    got = str(e).encode()
check(b'"name": "srv"' in got or b'"name":"srv"' in got, f"a raw socket to another machine, through the node ({got[-120:]!r})")
check(am.on_tailnet("srv.tail-scale.ts.net") and am.on_tailnet("100.100.1.2") and not am.on_tailnet("example.com")
      and not am.on_tailnet("127.0.0.1"), "the tailnet's names and addresses, and nothing else")

if failed:
    print(f"{len(failed)} failed")
    sys.exit(1)
print("all passed")
