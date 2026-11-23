# The phone apps' notifications, on the server's side (docs/plan-omarchy-and-
# machines.md, "The phone apps and the push relay"): a phone app registers
# through the app's own /api/push, kept with what it is and the address its
# buttons go to; a notification for it goes to its push service (the relay)
# encrypted for the phone alone, with the chat, its chime, its buttons and
# that address, cut to fit, with a Topic for the chat; a browser's stays as it
# was; a relay that says the phone is gone takes it off. Then, when relay/ is
# here and Go too, the same through the real relay to a fake APNs and a fake
# FCM, decrypted at the end as the phone does.
#
#   python3 test/push-phone.py         exits 0 when every check passed

import base64, contextlib, hashlib, http.server, importlib.machinery, importlib.util, io, json, os, shutil
import subprocess, sys, tempfile, threading, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
tmp = os.environ.get("TMPDIR") or None
home = tempfile.mkdtemp(prefix="push-phone-", dir=tmp)
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config")
os.environ.pop("AMARCHY_SESSION", None)
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(ROOT / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import isolate; isolate.timers(am)      # (test/isolate.py: none of this machine's automations)

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failed.append(what)


# ---- the phone's side: its keys, and reading what it's sent (RFC 8291)

def device():
    pem = Path(home) / f"device-{os.urandom(3).hex()}.pem"
    am.ec_new(pem)
    auth = os.urandom(16)
    return pem, {"p256dh": am.b64u(am.ec_public(pem)), "auth": am.b64u(auth)}


def decrypt(record, pem, keys):
    pub, auth = am.unb64u(keys["p256dh"]), am.unb64u(keys["auth"])
    salt, idlen = record[:16], record[20]
    as_public, ct = record[21:21 + idlen], record[21 + idlen:]
    secret = am.ecdh(pem, as_public)
    ikm = am.hkdf(auth, secret, b"WebPush: info\0" + pub + as_public, 32)
    cek = am.hkdf(salt, ikm, b"Content-Encoding: aes128gcm\0", 16)
    nonce = am.hkdf(salt, ikm, b"Content-Encoding: nonce\0", 12)
    body, tag = ct[:-16], ct[-16:]
    plain = am.aes128gcm(cek, nonce, body)[:-16]
    if am.aes128gcm(cek, nonce, plain)[-16:] != tag:
        raise ValueError("tag")
    plain = plain.rstrip(b"\0")
    assert plain.endswith(b"\2")
    return plain[:-1]


# ---- a fake relay: takes what a push service takes, keeps it

got = []
class Relay(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        got.append({"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": body})
        self.send_response({"/gone": 410}.get(self.path, 201))
        self.send_header("Content-Length", "0")
        self.end_headers()
    def log_message(self, *a):
        pass
relay = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Relay)
threading.Thread(target=relay.serve_forever, daemon=True).start()
at = f"http://127.0.0.1:{relay.server_address[1]}"


# ---- 1. registering, through the app's own /api/push

am.app_key()
am.migrate()
st = am.AppState()
st.transcriber = None
Handler = am.app_handler(st, ["tester@test"], "127.0.0.1")
class Local(Handler):
    def parse_request(self):
        ok = super().parse_request()
        if ok and not self.headers.get("Tailscale-User-Login"):
            self.headers["Tailscale-User-Login"] = "tester@test"
        return ok
    def log_message(self, *a):
        pass
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Local)
server.daemon_threads = True
threading.Thread(target=server.serve_forever, daemon=True).start()
port = server.server_address[1]


def post(path, body, origin=True):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Host": f"127.0.0.1:{port}",
                                          **({"Origin": f"https://127.0.0.1:{port}"} if origin else {})})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


phone_pem, phone_keys = device()
web_pem, web_keys = device()
ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AmarchyApp/1.0 (iOS)"
code, _ = post("/api/push", {"endpoint": "https://relay.example/v1/push/abc", "keys": phone_keys,
                             "app": {"platform": "ios", "version": "1.0 (1)", "device": "iPhone\x07 15"}})
check(code == 200, f"a phone app registers through /api/push ({code})")
subs = am.app_subscriptions()
mine = next((x for x in subs if x["endpoint"] == "https://relay.example/v1/push/abc"), {})
check(mine.get("app") == {"platform": "ios", "version": "1.0 (1)", "device": "iPhone 15"},
      f"kept with what it is, its words cleaned ({mine.get('app')})")
check(mine.get("server") == f"https://127.0.0.1:{port}", f"and the address its buttons go to ({mine.get('server')})")
code, _ = post("/api/push", {"endpoint": "https://relay.example/v1/push/x", "keys": phone_keys,
                             "app": {"platform": "ios"}}, origin=False)
check(code == 403, f"only from the app's own page or the app itself, with its Origin ({code})")
code, _ = post("/api/push", {"endpoint": "https://web.example/push/1", "keys": web_keys, "app": {"platform": "palm"}})
web = next((x for x in am.app_subscriptions() if x["endpoint"] == "https://web.example/push/1"), {})
check(code == 200 and "app" not in web and "server" not in web, "an \"app\" that isn't a phone app's: a browser's, as before")
log = io.StringIO()
with contextlib.redirect_stderr(log):
    am.push_log("on", mine)
check("iPhone app (relay.example)" in log.getvalue(), f"the log says it's the iPhone app, on which relay ({log.getvalue().strip()})")


# ---- 2. what it's sent, through the relay

server_url = f"https://127.0.0.1:{port}"
am.app_save_subscriptions(lambda subs: [
    {"endpoint": at + "/phone", "keys": phone_keys, "app": {"platform": "ios", "version": "1", "device": ""}, "server": server_url},
    {"endpoint": at + "/web", "keys": web_keys, "device": ua}])
payload = {"title": "Fix the login", "body": "Asks: Allow Bash: npm test?\nHouston Os", "tag": "houston-os-fix-login",
           "url": "/#/s/houston-os-fix-login", "waiting": 2, "ask": "houston-os-fix-login"}
actions = [{"label": "Allow", "path": "/api/session/houston-os-fix-login/answer", "body": {"request_id": "r1", "choice": "allow"}},
           {"label": "Deny", "path": "/api/session/houston-os-fix-login/answer", "body": {"request_id": "r1", "choice": "deny"}}]
desktop = {"session": "houston-os-fix-login", "sound": "chime", "actions": actions}
got.clear()
with contextlib.redirect_stderr(io.StringIO()):
    n = am.push_all(payload, desktop)
check(n == 2, f"both took it ({n})")
by = {g["path"]: g for g in got}
p, w = by.get("/phone"), by.get("/web")
check(p and p["headers"].get("content-encoding") == "aes128gcm", "the phone's: encrypted (aes128gcm), as Web Push is")
check(p and p["headers"].get("authorization", "").startswith("vapid t=") and f"k={am.app_public()}" in p["headers"]["authorization"],
      "signed with the machine's key (VAPID), the key the relay ties the phone to")
topic = am.b64u(hashlib.sha256(b"houston-os-fix-login").digest()[:16])
check(p and p["headers"].get("topic") == topic and len(topic) <= 32, f"with a Topic for the chat, none of its name in it ({p and p['headers'].get('topic')})")
check(p and p["headers"].get("urgency") == "high" and p["headers"].get("ttl"), "urgent, with a TTL")
phone_got = json.loads(decrypt(p["body"], phone_pem, phone_keys)) if p else {}
check(phone_got.get("server") == server_url and phone_got.get("actions") == actions and phone_got.get("session") == desktop["session"]
      and phone_got.get("sound") == "chime", "the phone reads its buttons, the chat, its chime and where its buttons go")
check(all(phone_got.get(k) == v for k, v in payload.items()), "and everything a browser's has")
check(b"Fix the login" not in p["body"] and b"Allow" not in p["body"], "nothing of it readable on the way")
web_got = json.loads(decrypt(w["body"], web_pem, web_keys)) if w else {}
check(web_got == payload and "topic" not in w["headers"], f"a browser's: as it was, no buttons, no address ({sorted(web_got)})")

# Long: cut to fit what Apple's and Google's push carry, at a word.
got.clear()
long_body = "Done: " + "a very long reply with many words " * 200
with contextlib.redirect_stderr(io.StringIO()):
    am.push_all({**payload, "body": long_body, "title": "Ünïcode ✓ 日本語"}, desktop)
p = next((g for g in got if g["path"] == "/phone"), None)
plain = decrypt(p["body"], phone_pem, phone_keys) if p else b""
cut = json.loads(plain) if plain else {}
check(len(plain) <= am.PHONE_MAX, f"a long one fits ({len(plain)} bytes ≤ {am.PHONE_MAX})")
check(len(p["body"]) <= 2900 if p else False, f"encrypted, within what the relay takes ({len(p['body']) if p else '?'} ≤ 2900)")
check(cut.get("body", "").endswith("…") and cut["body"][:-1].rstrip() in long_body and not cut["body"][:-1].endswith(" "),
      "its body cut at a word, with …")
check(cut.get("actions") == actions and cut.get("title") == "Ünïcode ✓ 日本語", "its buttons and its title kept whole")
huge = {**payload, "title": "T" * 5000, "body": "b" * 5000}
fits = am.phone_payload(huge, {"actions": actions * 2}, {"server": server_url})
check(len(fits) <= am.PHONE_MAX and json.loads(fits).get("server") == server_url, f"even a huge one fits, its address kept ({len(fits)})")

# Secrets: masked for the phone too, buttons and all.
real_secrets = am.secret_values
am.secret_values = lambda: ["s3cr3t-value"]
got.clear()
with contextlib.redirect_stderr(io.StringIO()):
    am.push_all({**payload, "body": "the key is s3cr3t-value"}, {**desktop, "actions": [{**actions[0], "body": {"answers": {"q": "s3cr3t-value"}}}]})
p = next((g for g in got if g["path"] == "/phone"), None)
check(p and b"s3cr3t-value" not in decrypt(p["body"], phone_pem, phone_keys), "a secret's value masked, in its body and its buttons")
am.secret_values = real_secrets

# Gone: the relay says the phone is (APNs or FCM said so).
am.app_save_subscriptions(lambda subs: [{"endpoint": at + "/gone", "keys": phone_keys, "app": {"platform": "android"}, "server": server_url}])
err = io.StringIO()
with contextlib.redirect_stderr(err):
    am.push_all(payload, desktop)
check(am.app_subscriptions() == [] and at + "/gone" in am.push_gone(), "a phone the relay says is gone: taken off, remembered as ended")
check("Android app (127.0.0.1" in err.getvalue(), f"the log says which ({err.getvalue().strip()[:120]})")


# ---- 3. through the real relay (relay/), to a fake APNs and a fake FCM

def relay_binary():
    go = shutil.which("go")
    if not go or not (ROOT / "relay/go.mod").exists():
        return None
    out = Path(home) / "amarchy-relay"
    r = subprocess.run([go, "build", "-o", str(out), "./cmd/amarchy-relay"], cwd=ROOT / "relay", capture_output=True, text=True,
                       env={**os.environ, "GOTMPDIR": tmp or tempfile.gettempdir(), "GOFLAGS": "-mod=mod"})
    if r.returncode:
        print(r.stderr[-2000:], file=sys.stderr)
        return False
    return out


class Upstream:
    """The fake APNs and FCM (test/push-upstream: HTTP/2 as APNs speaks it),
    what they got read off its output as it comes."""
    def __init__(self):
        out = Path(home) / "push-upstream"
        r = subprocess.run([shutil.which("go"), "build", "-o", str(out), "."], cwd=ROOT / "test/push-upstream",
                           capture_output=True, text=True, env={**os.environ, "GOTMPDIR": tmp or tempfile.gettempdir(), "GO111MODULE": "off"})
        if r.returncode:
            raise RuntimeError(r.stderr[-1000:])
        self.proc = subprocess.Popen([str(out)], stdout=subprocess.PIPE, text=True)
        self.url = self.proc.stdout.readline().strip()
        self.got = []
        threading.Thread(target=self.read, daemon=True).start()
    def read(self):
        for line in self.proc.stdout:
            g = json.loads(line)
            g["body"] = base64.b64decode(g["body"] or "")
            self.got.append(g)
    def clear(self):
        self.got.clear()
    def wait(self, n, s=10):
        end = time.time() + s
        while len(self.got) < n and time.time() < end:
            time.sleep(0.05)
        return self.got


binary = relay_binary()
if binary is None:
    print("  (no relay/ or no Go here: the real relay's part is skipped)")
elif binary is False:
    check(False, "the relay builds")
else:
    up = Upstream()
    up_at = up.url
    p8 = am.openssl("genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256").decode()
    sa_key = am.openssl("genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048").decode()
    creds = json.dumps({"type": "service_account", "client_email": "relay@p.iam.gserviceaccount.com",
                        "private_key": sa_key, "token_uri": up_at + "/token"})
    with contextlib.closing(__import__("socket").socket()) as sock:
        sock.bind(("127.0.0.1", 0))
        relay_port = sock.getsockname()[1]
    relay_url = f"http://127.0.0.1:{relay_port}"
    logf = open(Path(home) / "relay.log", "w+")
    proc = subprocess.Popen([str(binary)], stdout=logf, stderr=subprocess.STDOUT, env={
        "PATH": os.environ.get("PATH", ""), "RELAY_LISTEN": f"127.0.0.1:{relay_port}", "RELAY_URL": relay_url,
        "RELAY_SECRET": base64.b64encode(os.urandom(32)).decode(),
        "APNS_KEY": p8, "APNS_KEY_ID": "ABC123DEFG", "APNS_TEAM_ID": "TEAM123456", "APNS_TOPICS": "io.github.ja818.amarchy",
        "APNS_URL": up_at, "APNS_SANDBOX_URL": up_at,
        "FCM_PROJECT": "p", "FCM_CREDENTIALS": creds, "FCM_URL": up_at, "FCM_TOKEN_URL": up_at + "/token"})
    try:
        for _ in range(100):
            try:
                with urllib.request.urlopen(relay_url + "/v1/health", timeout=1) as r:
                    health = json.loads(r.read())
                break
            except OSError:
                time.sleep(0.1)
        else:
            health = {}
        check(health.get("ok") and health.get("apns") and health.get("fcm"), f"the relay is up, APNs and FCM on ({health})")

        def register(platform, token):
            req = urllib.request.Request(relay_url + "/v1/register", method="POST", headers={"Content-Type": "application/json"},
                                         data=json.dumps({"platform": platform, "token": token, "app": "io.github.ja818.amarchy",
                                                          "server_key": am.app_public()}).encode())
            with urllib.request.urlopen(req, timeout=10) as r:
                return json.loads(r.read())["endpoint"]

        ios_pem, ios_keys = device()
        droid_pem, droid_keys = device()
        apns_token = os.urandom(32).hex()
        fcm_token = "fcm:" + base64.urlsafe_b64encode(os.urandom(90)).decode()
        ios_end, droid_end = register("apns", apns_token), register("fcm", fcm_token)
        check(ios_end.startswith(relay_url + "/v1/push/") and apns_token not in ios_end,
              "the relay gives the phone an endpoint, its token sealed in it")
        am.app_save_subscriptions(lambda subs: [
            {"endpoint": ios_end, "keys": ios_keys, "app": {"platform": "ios"}, "server": server_url},
            {"endpoint": droid_end, "keys": droid_keys, "app": {"platform": "android"}, "server": server_url}])
        up.clear()
        with contextlib.redirect_stderr(io.StringIO()):
            n = am.push_all(payload, desktop)
        check(n == 2, f"the machine sends through it to both ({n})")
        upstream = up.wait(2)
        apns = next((u for u in upstream if u["path"].startswith("/3/device/")), None)
        fcm = next((u for u in upstream if "/messages:send" in u["path"]), None)
        check(apns and apns["path"] == f"/3/device/{apns_token}" and apns["headers"].get("apns-topic") == "io.github.ja818.amarchy"
              and apns["headers"].get("apns-collapse-id") == topic and apns["headers"].get("proto") == "HTTP/2.0",
              "to APNs over HTTP/2: the phone's token, the app, the chat's topic")
        aps = json.loads(apns["body"]) if apns else {}
        check(aps.get("aps", {}).get("mutable-content") == 1 and "Fix the login" not in apns["body"].decode(),
              "for the phone's extension to decrypt, nothing of it readable to Apple")
        ios_got = json.loads(decrypt(am.unb64u(aps.get("p", "")), ios_pem, ios_keys)) if aps.get("p") else {}
        check(ios_got.get("title") == "Fix the login" and ios_got.get("actions") == actions,
              "the iPhone decrypts it: its title, its buttons")
        msg = json.loads(fcm["body"]).get("message", {}) if fcm else {}
        check(msg.get("token") == fcm_token and msg.get("android", {}).get("collapse_key") == topic
              and fcm["headers"].get("authorization") == "Bearer ya29.test", "to FCM: the phone's token, the chat's topic, the relay's token")
        droid_got = json.loads(decrypt(am.unb64u(msg.get("data", {}).get("p", "")), droid_pem, droid_keys)) if msg else {}
        check(droid_got.get("server") == server_url and droid_got.get("session") == desktop["session"],
              "the Android phone decrypts it: where its buttons go, the chat")
        logf.seek(0)
        said = logf.read()
        check(said and apns_token not in said and fcm_token not in said and "Fix the login" not in said and ios_end.rsplit("/", 1)[1] not in said,
              "the relay's log has no token, no handle, nothing of what it carried")
        # Another machine's key can't use the phone's endpoint.
        other = Path(home) / "other.pem"
        am.ec_new(other)
        real = am.app_key()
        am.app_key = lambda: other
        am._app_public.clear()
        up.clear()
        with contextlib.redirect_stderr(io.StringIO()):
            ok = am.push_send({"endpoint": ios_end, "keys": ios_keys}, payload)
        check(ok is None and not up.wait(1, 1), "a machine without the phone's machine key: refused, nothing sent on")
        am.app_key = lambda: real
        am._app_public.clear()
    finally:
        proc.terminate()
        proc.wait(timeout=10)
        up.proc.terminate()

server.shutdown()
sys.exit(1 if failed else 0)
