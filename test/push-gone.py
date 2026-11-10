# A device whose push service says its subscription ended (410), without a
# browser: it's taken off the ones notified, remembered as ended (so the
# device makes a new subscription instead of sending the dead one again),
# and the app's log says which device and why. One the service refuses for
# another reason stays.
#
#   python3 test/push-gone.py         exits 0 when every check passed

import contextlib, http.server, importlib.machinery, importlib.util, io, json, os, sys, tempfile, threading
from pathlib import Path

home = tempfile.mkdtemp(prefix="push-gone-")
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config")
os.environ.pop("AMARCHY_SESSION", None)
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(Path(__file__).resolve().parent.parent / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failed.append(what)

# A push service: /gone ended, /busy can't now, /ok takes it.
class Push(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        self.send_response({"/gone": 410, "/busy": 503}.get(self.path, 201))
        self.send_header("Content-Length", "0")
        self.end_headers()
    def log_message(self, *a):
        pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Push)
threading.Thread(target=srv.serve_forever, daemon=True).start()
at = f"http://127.0.0.1:{srv.server_address[1]}"

am.app_key()
device = Path(home) / "device.pem"
am.ec_new(device)
keys = {"p256dh": am.b64u(am.ec_public(device)), "auth": am.b64u(os.urandom(16))}
mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
am.app_save_subscriptions(lambda subs: [{"endpoint": at + p, "keys": keys, "device": mac} for p in ("/gone", "/busy", "/ok")])

err = io.StringIO()
with contextlib.redirect_stderr(err):
    sent = am.push_all({"title": "t", "body": "b"})
log = err.getvalue()
left = [s["endpoint"] for s in am.app_subscriptions()]
check(sent == 1, f"sent to the one that takes it ({sent})")
check(left == [at + "/busy", at + "/ok"], f"the ended one is taken off, the busy one stays ({left})")
check(am.push_gone() == [at + "/gone"], f"and remembered as ended ({am.push_gone()})")
check("notifications off: Mac Chrome (127.0.0.1" in log and "subscription ended" in log, f"the log says which device and why ({log.strip()[:160]})")
check(oct((am.APP / "push-gone.json").stat().st_mode & 0o777) == "0o600", "kept readable by you only")

sys.exit(1 if failed else 0)
