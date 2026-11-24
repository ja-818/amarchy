# The local key: the desktop app on this machine comes straight to
# 127.0.0.1:<port> (docs/plan-omarchy-and-machines.md, "Who may call"). It
# opens /local?key=<STATE/app/local.key>, gets an HttpOnly, SameSite=Strict
# cookie for that port and is sent on to the app; with it, it's let in from
# you, and changes only from its own page (Origin http://127.0.0.1:<port>).
# Nothing else gets in that way: a wrong key, no cookie, an old key's cookie,
# a request through a proxy (tailscale serve also comes from 127.0.0.1), one
# to another name for this machine, another user here (with sudo), and a page
# elsewhere (its Origin, Sec-Fetch-Site, a form's content type). Through
# Tailscale it's as strict as before. Without a browser.
#
#   python3 test/local-key.py       exits 0 when every check passed

import http.client, importlib.machinery, importlib.util, json, os, shutil, socket, stat, subprocess, sys, tempfile, threading, time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import homes      # (test/homes.py: its home gone with it, however it ends)
home = homes.home("local-key")
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config", AMARCHY_WORK=home + "/work")
entry = str(Path(__file__).resolve().parent.parent / "bin/amarchy")
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", entry)
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import isolate; isolate.timers(am); isolate.downloads(am)      # (test/isolate.py: none of this machine's automations, nor its big downloads)

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failed.append(what)

ADDRESS = "box.example.ts.net"
am.app_key()
key = am.local_key()
st = am.AppState()
st.transcriber = None
handler = am.app_handler(st, {"me@example.com"}, ADDRESS)
server = am.app_server_class()(("127.0.0.1", 0), handler)
port = server.server_address[1]
threading.Thread(target=server.serve_forever, daemon=True).start()
threading.Thread(target=am.app_watch, args=(st,), daemon=True).start()
for _ in range(100):
    if st.view:
        break
    time.sleep(0.1)
HOST = f"127.0.0.1:{port}"
ORIGIN = f"http://{HOST}"


def ask(method, path, headers=None, body=None, host=HOST):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    c.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
    c.putheader("Host", host)
    data = json.dumps(body).encode() if body is not None else None
    for k, v in (headers or {}).items():
        c.putheader(k, v)
    if data is not None:
        c.putheader("Content-Length", str(len(data)))
    c.endheaders(data)
    r = c.getresponse()
    out = r.status, dict(r.getheaders()), r.read()
    c.close()
    return out


print("the key")
mode = stat.S_IMODE(os.stat(am.LOCAL_KEY).st_mode)
check(mode == 0o600, f"local.key is 0600 ({oct(mode)})")
check(am.local_key() == key and len(key) >= 43, "it stays the same, 32 random bytes")
os.chmod(am.LOCAL_KEY, 0o644)
am.local_key()
check(stat.S_IMODE(os.stat(am.LOCAL_KEY).st_mode) == 0o600, "made 0600 again when it was opened up")

print("coming in")
code, h, _ = ask("GET", "/")
check(code == 403, f"no cookie: refused ({code})")
code, h, _ = ask("GET", "/local?key=" + "x" * 43)
check(code == 403 and "Set-Cookie" not in h, f"a wrong key: refused, no cookie ({code})")
code, h, _ = ask("GET", "/local")
check(code == 403, f"no key: refused ({code})")
code, h, _ = ask("GET", "/local?key=" + key)
cookie = h.get("Set-Cookie", "")
check(code == 303 and h.get("Location") == "/", f"the key: sent on to the app ({code} {h.get('Location')})")
check(cookie.startswith(f"amarchy_local_{port}=") and "HttpOnly" in cookie and "SameSite=Strict" in cookie
      and "Path=/" in cookie, f"its cookie: this port's, HttpOnly, SameSite=Strict ({cookie[:40]}…)")
check(key not in cookie, "the cookie isn't the key")
check(h.get("Cache-Control") == "no-store" and h.get("Referrer-Policy") == "no-referrer", "the answer isn't kept, and says nowhere where it came from")
jar = {"Cookie": cookie.split(";")[0]}
for to, want in (("/%23/s/proj-x", "/#/s/proj-x"), ("//evil.example", "/"), ("/%5Cevil.example", "/"),
                 ("https://evil.example", "/"), ("/local?key=1", "/")):
    code, h, _ = ask("GET", f"/local?key={key}&next={to}")
    check(h.get("Location") == want, f"next={to}: to {h.get('Location')}")

print("with the cookie")
code, h, body = ask("GET", "/api/state", jar)
state = json.loads(body) if code == 200 else {}
check(code == 200 and "sessions" in state, f"the list ({code})")
check(state.get("user") == "me@example.com", f"as the machine's owner ({state.get('user')})")
code, h, _ = ask("GET", "/", jar)
csp = h.get("Content-Security-Policy", "")
check(code == 200 and f"ws://{HOST}" in csp and "wss://" not in csp, "the page, its terminals' WebSockets on ws://127.0.0.1")
code, h, _ = ask("GET", "/api/state", {"Cookie": f"amarchy_local_{port + 1}=" + jar["Cookie"].split("=", 1)[1]})
check(code == 403, f"another port's cookie: refused ({code})")
code, h, _ = ask("GET", "/api/state", {"Cookie": f"amarchy_local_{port}=" + "0" * 64})
check(code == 403, f"a made-up cookie: refused ({code})")
code, _, _ = ask("GET", "/api/state", jar, host=f"localhost:{port}")
check(code == 403, f"to localhost (another name): refused ({code})")
code, _, _ = ask("GET", "/api/state", jar, host=ADDRESS)
check(code == 403, f"to the tailnet name, without Tailscale's word: refused ({code})")
for proxy in ("X-Forwarded-For", "Forwarded", "Via", "Tailscale-User-Login"):
    code, _, _ = ask("GET", "/api/state", {**jar, proxy: "100.64.0.9" if proxy != "Tailscale-User-Login" else "me@example.com"})
    check(code == 403, f"through a proxy ({proxy}): refused ({code})")

print("changes")
write = {**jar, "Origin": ORIGIN, "Content-Type": "application/json"}
code, _, body = ask("POST", "/api/missions/goal", write, {"goal": 3})
check(code == 200 and json.loads(body).get("goal") == 3, f"from its own page: done ({code})")
code, _, _ = ask("POST", "/api/missions/goal", {**write, "Sec-Fetch-Site": "same-origin"}, {"goal": 4})
check(code == 200, f"Sec-Fetch-Site same-origin: done ({code})")
for what, hs in (("no Origin", {k: v for k, v in write.items() if k != "Origin"}),
                 ("an https Origin", {**write, "Origin": f"https://{HOST}"}),
                 ("another page's Origin", {**write, "Origin": "http://127.0.0.1:5173"}),
                 ("Sec-Fetch-Site cross-site", {**write, "Sec-Fetch-Site": "cross-site"}),
                 ("Sec-Fetch-Site same-site", {**write, "Sec-Fetch-Site": "same-site"}),
                 ("a form's content type", {**write, "Content-Type": "text/plain"}),
                 ("no cookie", {k: v for k, v in write.items() if k != "Cookie"})):
    code, _, _ = ask("POST", "/api/missions/goal", hs, {"goal": 5})
    check(code == 403, f"{what}: refused ({code})")
check(am.MISSION_GOAL.read_text().strip() == "4", "nothing refused was done")

print("WebSockets")
am.SESSIONS.mkdir(parents=True, exist_ok=True)
(am.SESSIONS / "proj-ws.json").write_text(json.dumps({"id": "proj-ws", "repo": "proj", "name": "ws", "path": home, "engine": "chat"}))
upgrade = {**jar, "Upgrade": "websocket", "Connection": "Upgrade", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
           "Sec-WebSocket-Version": "12"}      # a version it doesn't take: what's checked first is said, no terminal opens
code, _, body = ask("GET", "/api/session/proj-ws/tty/term", {**upgrade, "Origin": "http://127.0.0.1:5173"})
check(code == 403, f"from another page: refused ({code} {body[:40]})")
code, _, body = ask("GET", "/api/session/proj-ws/tty/term", {**upgrade, "Origin": ORIGIN})
check(code == 400 and b"a WebSocket" in body, f"from its own page: past the Origin check ({code})")

print("another user on this machine")
if shutil.which("sudo") and subprocess.run(["sudo", "-n", "true"], capture_output=True).returncode == 0:
    probe = (f"import http.client; c = http.client.HTTPConnection('127.0.0.1', {port}, timeout=5); "
             f"c.request('GET', '/api/state', headers={{'Cookie': {jar['Cookie']!r}}}); print(c.getresponse().status); "
             f"c = http.client.HTTPConnection('127.0.0.1', {port}, timeout=5); c.request('GET', '/local?key={key}'); "
             f"print(c.getresponse().status)")
    r = subprocess.run(["sudo", "-n", "-u", "nobody", sys.executable, "-I", "-c", probe], capture_output=True, text=True, cwd="/")
    check(r.stdout.split() == ["403", "403"], f"with the cookie, or even the key: refused ({' '.join(r.stdout.split()) or r.stderr[-200:]})")
else:
    print("  skip (no sudo here)")

print("a new key")
am.LOCAL_KEY.unlink()
fresh = am.local_key()
code, _, _ = ask("GET", "/api/state", jar)
check(fresh != key and code == 403, f"the old cookie: refused ({code})")

print("through Tailscale, as before")
ts = {"Tailscale-User-Login": "me@example.com"}
code, _, _ = ask("GET", "/api/state", ts, host=ADDRESS)
check(code == 200, f"you, at this machine's name: in ({code})")
code, _, _ = ask("GET", "/api/state", {"Tailscale-User-Login": "someone@else.com"}, host=ADDRESS)
check(code == 403, f"someone else: refused ({code})")
code, _, _ = ask("POST", "/api/missions/goal", {**ts, "Origin": f"https://{ADDRESS}", "Content-Type": "application/json"},
                 {"goal": 2}, host=ADDRESS)
check(code == 200, f"a change from the app's page: done ({code})")
code, _, _ = ask("POST", "/api/missions/goal", {**ts, "Origin": ORIGIN, "Content-Type": "application/json"},
                 {"goal": 2}, host=ADDRESS)
check(code == 403, f"a change with the local page's Origin: refused ({code})")
code, h, _ = ask("GET", "/", ts, host=ADDRESS)
check(f"wss://{ADDRESS}" in h.get("Content-Security-Policy", ""), "its page's WebSockets on wss:// as before")

server.shutdown()
print(f"\n{'all passed' if not failed else f'{len(failed)} failed'}")
sys.exit(1 if failed else 0)
