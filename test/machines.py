# Two machines' chats on one board (docs/plan-omarchy-and-machines.md, track
# A), with two amarchy app servers on this machine, each with a home, state,
# port, name (alpha, beta) and tmux of its own, a fake claude that speaks the
# chat engine's protocol, and the real `amarchy app serve` and CLI:
#
#   - hello, and pairing with `amarchy machines add` (both keep the other,
#     one key, 0600); a machine that isn't yours, or on another protocol, is
#     refused saying why;
#   - who may call as a peer: the key, its name, the protocol; nothing passes
#     on what another passed on; a page can't pair;
#   - the board: alpha's /api/state and /api/events have beta's chats, with
#     their machine; beta's own state (/api/peer/state) has only its own;
#   - the pass-through, from alpha's app (the local key) to beta: REST, a
#     message sent, an upload, a picture's bytes (a Range), the chat's event
#     stream as it's written (gzipped too), and its terminal's WebSocket both
#     ways;
#   - beta going away in the middle of a stream and coming back: the stream
#     ends, its chats stay on alpha's board marked off, the pass-through
#     says it's off, then it's on again by itself;
#   - rename (on the machine itself), remove (both forget).
#
#   python3 test/machines.py        exits 0 when every check passed (about a minute)

import base64, gzip, hashlib, http.client, json, os, shutil, signal, socket, stat, subprocess, sys, tempfile, threading, time, zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BIN = str(ROOT / "bin/amarchy")
BASE = Path(tempfile.mkdtemp(prefix="machines-"))
USER = "tester@example.com"

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}", flush=True)
    if not ok:
        failed.append(what)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


# A claude that answers the control protocol and ends each turn, saying what it got.
FAKE = BASE / "bin"
FAKE.mkdir()
(FAKE / "claude").write_text('''#!/usr/bin/env python3
import json, sys, time
def say(o):
    sys.stdout.write(json.dumps(o) + "\\n"); sys.stdout.flush()
for line in sys.stdin:
    try:
        o = json.loads(line)
    except ValueError:
        continue
    if o.get("type") == "control_request":
        say({"type": "control_response", "response": {"subtype": "success", "request_id": o["request_id"], "response": {}}})
    elif o.get("type") == "user":
        c = o["message"]["content"]
        text = c if isinstance(c, str) else " ".join(b.get("text", "") for b in c if isinstance(b, dict))
        open("got.txt", "a").write(text + "\\n")
        say({"type": "result", "subtype": "success", "is_error": False, "duration_ms": 10,
             "session_id": "c0ffee00-0000-4000-8000-000000000001", "result": "ok"})
''')
(FAKE / "claude").chmod(0o755)


class Machine:
    def __init__(self, name):
        self.name, self.port = name, free_port()
        self.home = BASE / name
        self.work = self.home / "Work"
        self.url = f"http://127.0.0.1:{self.port}"
        self.socket = f"amarchy-test-{os.getpid()}-{name}"
        self.env = {
            "HOME": str(self.home), "XDG_STATE_HOME": str(self.home / "state"), "XDG_CONFIG_HOME": str(self.home / "config"),
            "AMARCHY_WORK": str(self.work), "AMARCHY_TMUX": self.socket, "AMARCHY_HOST_NAME": name,
            "AMARCHY_HOST_APP_PORT": str(self.port), "AMARCHY_HOST_URL": self.url, "AMARCHY_HOST_APP_LINKS": "off",
            "AMARCHY_HOST_APP_USERS": USER, "AUTO_UPDATE": "off", "AMARCHY_PEER_SILENT": "6",
            "PATH": f"{FAKE}:/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8",
            "XDG_RUNTIME_DIR": os.environ.get("XDG_RUNTIME_DIR", ""), "DBUS_SESSION_BUS_ADDRESS": os.environ.get("DBUS_SESSION_BUS_ADDRESS", ""),
            "SHELL": "/bin/bash", "TERM": "xterm-256color",
        }
        self.proc, self.jar = None, None
        repo = self.work / "proj"
        repo.mkdir(parents=True)
        git = lambda *a: subprocess.run(["git", *a], cwd=repo, capture_output=True, env={**self.env, "GIT_AUTHOR_NAME": "t",
                                        "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"})
        git("init", "-q", "-b", "main")
        (repo / "README.md").write_text(f"# {name}\n")
        git("add", ".")
        git("commit", "-q", "-m", "first")

    def amarchy(self, *args, input=None, timeout=60):
        return subprocess.run([sys.executable, BIN, *args], env=self.env, capture_output=True, text=True, input=input, timeout=timeout)

    def start(self):
        self.log = open(self.home / "server.log", "a")
        self.proc = subprocess.Popen([sys.executable, BIN, "app", "serve"], env=self.env, stdout=self.log, stderr=self.log,
                                     stdin=subprocess.DEVNULL, start_new_session=True)
        for _ in range(100):
            try:
                socket.create_connection(("127.0.0.1", self.port), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)
        key = (self.home / "state/amarchy/app/local.key").read_text().strip()
        code, h, _ = self.ask("GET", f"/local?key={key}", cookie=False)
        self.jar = h.get("Set-Cookie", "").split(";")[0]
        return code == 303

    def stop(self, how=signal.SIGTERM):
        if self.proc and self.proc.poll() is None:
            os.killpg(self.proc.pid, how)
            self.proc.wait(10)

    def ask(self, method, path, body=None, headers=None, cookie=True, timeout=20, raw=False):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=timeout)
        h = {"Host": f"127.0.0.1:{self.port}", **({"Cookie": self.jar} if cookie and self.jar else {})}
        if method == "POST":
            h.update({"Origin": self.url, "Content-Type": "application/json"})
        h.update(headers or {})
        data = body if isinstance(body, bytes) else json.dumps(body).encode() if body is not None else None
        c.request(method, path, body=data, headers=h)
        r = c.getresponse()
        out = r.read()
        c.close()
        if raw:
            return r.status, dict(r.getheaders()), out
        try:
            return r.status, dict(r.getheaders()), json.loads(out or b"{}")
        except ValueError:
            return r.status, dict(r.getheaders()), {"raw": out[:200]}

    def state(self):
        return self.ask("GET", "/api/state")[2]

    def machines(self):
        try:
            return json.loads((self.home / "config/amarchy/machines.json").read_text())
        except (OSError, ValueError):
            return []


def until(fn, limit=20, step=0.2):
    end = time.time() + limit
    while time.time() < end:
        try:
            v = fn()
            if v:
                return v
        except Exception:
            pass
        time.sleep(step)
    return None


def stream_open(m, path, gz=False):
    """An event stream (http.client), its connection and response."""
    c = http.client.HTTPConnection("127.0.0.1", m.port, timeout=30)
    c.request("GET", path, headers={"Host": f"127.0.0.1:{m.port}", "Cookie": m.jar, "Accept": "text/event-stream",
                                    **({"Accept-Encoding": "gzip"} if gz else {})})
    return c, c.getresponse()


def events(r, want, limit=10, gz=False):
    """The stream's events (name, data) until each named in want came."""
    want = set(want)
    unzip = zlib.decompressobj(31) if gz else None
    buf, got, end = b"", [], time.time() + limit
    r.fp.raw._sock.settimeout(limit) if hasattr(r.fp, "raw") else None
    while time.time() < end:
        chunk = r.read1(65536)
        if not chunk:
            break
        buf += unzip.decompress(chunk) if unzip else chunk
        while b"\n\n" in buf:
            block, buf = buf.split(b"\n\n", 1)
            name, data = None, []
            for line in block.decode().split("\n"):
                if line.startswith("event:"):
                    name = line[6:].strip()
                elif line.startswith("data:"):
                    data.append(line[5:].strip())
            if name:
                got.append((name, json.loads("\n".join(data)) if data else None))
                want.discard(name)
                if not want:
                    return got
    return got


def ws_open(m, path):
    s = socket.create_connection(("127.0.0.1", m.port), timeout=10)
    key = base64.b64encode(os.urandom(16)).decode()
    s.sendall((f"GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{m.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nOrigin: {m.url}\r\nCookie: {m.jar}\r\n\r\n").encode())
    head = b""
    while b"\r\n\r\n" not in head:
        chunk = s.recv(4096)
        if not chunk:
            break
        head += chunk
    head, _, rest = head.partition(b"\r\n\r\n")
    want = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
    return s, head.decode(errors="replace"), rest, want


def ws_send(s, data, op=2):
    mask = os.urandom(4)
    n = len(data)
    head = bytes([0x80 | op]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + n.to_bytes(2, "big"))
    s.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))


class Frames:
    """What a WebSocket said, kept across reads (a frame may come in pieces)."""
    def __init__(self, s, rest):
        self.s, self.buf, self.seen = s, rest, b""


def ws_read_until(f, needle, limit=10):
    s, buf, seen, end = f.s, f.buf, f.seen, time.time() + limit
    try:
        return ws_reading(s, buf, seen, end, needle, f)
    finally:
        pass


def ws_reading(s, buf, seen, end, needle, f):
    s.settimeout(1)
    while time.time() < end:
        while len(buf) >= 2:
            n, off = buf[1] & 0x7F, 2
            if n == 126:
                if len(buf) < 4:
                    break
                n, off = int.from_bytes(buf[2:4], "big"), 4
            elif n == 127:
                if len(buf) < 10:
                    break
                n, off = int.from_bytes(buf[2:10], "big"), 10
            if len(buf) < off + n:
                break
            if buf[0] & 0x0F == 2:
                seen += buf[off:off + n]
            buf = buf[off + n:]
        f.buf, f.seen = buf, seen
        if needle in seen:
            f.seen = seen[seen.index(needle) + len(needle):]
            return True
        try:
            chunk = s.recv(65536)
        except socket.timeout:
            continue
        if not chunk:
            break
        buf += chunk
    f.buf, f.seen = buf, seen
    return False


alpha, beta = Machine("alpha"), Machine("beta")
try:
    print("two machines")
    check(alpha.start() and beta.start(), f"alpha (:{alpha.port}) and beta (:{beta.port}) serve, each its own")
    r = beta.amarchy("new", "proj", "one")
    sid = r.stdout.strip().splitlines()[-1] if r.returncode == 0 and r.stdout.strip() else ""
    check(sid == "proj-one", f"a chat on beta ({sid or r.stderr[-200:]})")
    ready = until(lambda: (s := next((x for x in beta.state()["sessions"] if x["id"] == sid), None)) and not s.get("setup")
                  and Path(s["path"]).is_dir() and s, limit=30)
    check(bool(ready), "its worktree is made, its fake Claude up")
    wt = Path(ready["path"]) if ready else beta.work

    print("hello")
    code, _, h = beta.ask("GET", "/api/peer/hello", cookie=False)
    check(code == 200 and h.get("name") == "beta" and h.get("protocol") == 1 and h.get("user") == USER and "version" in h,
          f"beta says who it is ({h})")
    code, _, h = beta.ask("GET", "/api/peer/hello", cookie=False, headers={"X-Forwarded-For": "100.1.2.3"})
    check(code == 403, f"through a proxy that isn't Tailscale: refused ({code})")

    print("pairing")
    r = alpha.amarchy("machines", "add", beta.url)
    check(r.returncode == 0 and "beta" in r.stdout, f"alpha pairs with beta ({(r.stdout or r.stderr).strip()[:120]})")
    ka, kb = alpha.machines(), beta.machines()
    check([m["name"] for m in ka] == ["beta"] and [m["name"] for m in kb] == ["alpha"], "both keep the other")
    check(ka and kb and ka[0]["key"] == kb[0]["key"] and len(ka[0]["key"]) >= 43, "one key, the same on both")
    check(all(stat.S_IMODE(os.stat(m.home / "config/amarchy/machines.json").st_mode) == 0o600 for m in (alpha, beta)),
          "machines.json is 0600 on both")
    check(ka and kb and ka[0]["url"] == beta.url and kb[0]["url"] == alpha.url, "each knows where the other is")
    r = alpha.amarchy("machines", "--json")
    rows = json.loads(r.stdout) if r.returncode == 0 else []
    check([(m["name"], m["state"]) for m in rows] == [("alpha", "on"), ("beta", "on")] and not any("key" in m for m in rows),
          f"amarchy machines: this one, then beta, on; never a key ({[(m['name'], m['state']) for m in rows]})")
    r = alpha.amarchy("machines", "add", alpha.url)
    check(r.returncode != 0 and "this machine" in r.stderr, f"not with itself ({r.stderr.strip()[:80]})")

    # A machine that isn't yours, or speaks another protocol: a stand-in that says so.
    import http.server
    class Other(http.server.BaseHTTPRequestHandler):
        said = {}
        def log_message(self, *a):
            pass
        def do_GET(self):
            data = json.dumps(Other.said).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
    other = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Other)
    threading.Thread(target=other.serve_forever, daemon=True).start()
    Other.said = {"name": "gamma", "label": "Gamma", "version": "x", "protocol": 1, "user": "someone@else.com"}
    r = alpha.amarchy("machines", "add", f"http://127.0.0.1:{other.server_address[1]}")
    check(r.returncode != 0 and "not yours" in r.stderr, f"someone else's: refused ({r.stderr.strip()[:90]})")
    Other.said = {"name": "gamma", "label": "Gamma", "version": "x", "protocol": 2, "user": USER}
    r = alpha.amarchy("machines", "add", f"http://127.0.0.1:{other.server_address[1]}")
    check(r.returncode != 0 and "Update amarchy on alpha" in r.stderr, f"a newer one: update this one ({r.stderr.strip()[:90]})")
    Other.said = {"name": "gamma", "label": "Gamma", "version": "x", "protocol": 0, "user": USER}
    r = alpha.amarchy("machines", "add", f"http://127.0.0.1:{other.server_address[1]}")
    check(r.returncode != 0 and "Update amarchy on Gamma" in r.stderr, f"an older one: update it ({r.stderr.strip()[:90]})")
    other.shutdown()
    r = alpha.amarchy("machines", "add", "http://example.com:8080")
    check(r.returncode != 0 and "https" in r.stderr, "plain http elsewhere: refused (a key never goes in the clear)")
    check(len(alpha.machines()) == 1, "none of those kept")

    print("who may call as a peer")
    key = ka[0]["key"] if ka else ""
    peer = lambda **h: {"X-Amarchy-Peer": "alpha", "Authorization": f"Bearer {key}", **h}
    code, _, st_ = beta.ask("GET", "/api/peer/state", cookie=False, headers=peer())
    check(code == 200 and [s["id"] for s in st_.get("sessions", [])] == [sid] and st_["machine"]["name"] == "beta",
          f"alpha, with the key: beta's own chats ({code})")
    code, _, _ = beta.ask("GET", "/api/peer/state", cookie=False, headers=peer(Authorization="Bearer " + "x" * 43))
    check(code == 403, f"a wrong key: refused ({code})")
    code, _, _ = beta.ask("GET", "/api/peer/state", cookie=False, headers=peer(**{"X-Amarchy-Peer": "gamma"}))
    check(code == 403, f"the key under another name: refused ({code})")
    code, _, said = beta.ask("GET", "/api/peer/state", cookie=False, headers=peer(**{"X-Amarchy-Protocol": "2"}))
    check(code == 409 and "Update amarchy" in said.get("error", ""), f"another protocol: says what to update ({said.get('error')})")
    code, _, _ = beta.ask("POST", "/api/session/proj-one/seen", {}, cookie=False, headers={**peer(), "Origin": "https://evil.example"})
    check(code == 200, f"a peer's change needs no page's Origin ({code})")
    code, _, _ = beta.ask("GET", "/api/m/alpha/api/state", cookie=False, headers=peer())
    check(code == 403, f"a peer can't pass on through it ({code})")
    code, _, _ = beta.ask("POST", "/api/peer/pair", {"name": "evil", "label": "x", "url": "https://evil.example", "protocol": 1},
                          cookie=False, headers={"Content-Type": "text/plain", "X-Amarchy-Peer": "evil", "Authorization": "Bearer " + "e" * 43})
    check(code == 403 and len(beta.machines()) == 1, f"pairing from a form: refused ({code})")
    code, _, _ = beta.ask("POST", "/api/peer/pair", {"name": "evil", "label": "x", "url": "https://evil.example", "protocol": 1},
                          cookie=False, headers={"X-Amarchy-Peer": "evil", "Authorization": "Bearer " + "e" * 43, "Via": "1.1 proxy"})
    check(code == 403 and len(beta.machines()) == 1, f"pairing through a proxy that isn't Tailscale: refused ({code})")

    print("the board")
    board = until(lambda: (v := alpha.state()) and any(s.get("machine") == "beta" for s in v["sessions"]) and v, limit=15)
    check(bool(board), "beta's chat is on alpha's board")
    if board:
        row = next(s for s in board["sessions"] if s["id"] == sid)
        check(row["machine"] == "beta" and not row.get("machine_off"), "with its machine, on")
        check(board["machine"] == "alpha" and [(m["name"], m["on"]) for m in board["machines"]] == [("alpha", True), ("beta", True)],
              f"the machines, this one first ({[(m['name'], m['on']) for m in board['machines']]})")
        check(all(s["machine"] == "alpha" for s in board["sessions"] if s["id"] != sid), "alpha's own chats say alpha")
    bb = until(lambda: (v := beta.state()) and len(v["machines"]) == 2 and v, limit=15)
    check(bool(bb) and all(s["machine"] == "beta" for s in bb["sessions"]), "beta's board: alpha paired, no chats of alpha's (it has none)")
    r = alpha.amarchy("new", "proj", "two")
    aid = r.stdout.strip().splitlines()[-1] if r.returncode == 0 else ""
    check(bool(until(lambda: any(s["id"] == aid and s["machine"] == "alpha" for s in beta.state()["sessions"]), limit=20)),
          "alpha's new chat shows on beta's board")
    code, _, st_ = beta.ask("GET", "/api/peer/state", cookie=False, headers=peer())
    check(code == 200 and [s["id"] for s in st_["sessions"]] == [sid], "but beta's own state has only beta's (no echo)")
    c, r = stream_open(alpha, "/api/events")
    got = events(r, {"list"})
    c.close()
    lst = next((d for n, d in got if n == "list"), {})
    check(any(s["id"] == sid and s["machine"] == "beta" for s in lst.get("sessions", [])), "alpha's /api/events: beta's chat too")

    print("the pass-through: REST")
    code, _, direct = beta.ask("GET", f"/api/session/{sid}/composer")
    code2, _, via = alpha.ask("GET", f"/api/m/beta/api/session/{sid}/composer")
    check(code == code2 == 200 and direct == via, f"a chat's composer, through alpha: as beta says it ({code2})")
    code, _, said = alpha.ask("GET", "/api/m/beta/api/session/nope-chat/composer")
    check(code == 404 and said.get("error") == "no such chat", f"beta's own refusal comes back as it said it ({code})")
    code, _, said = alpha.ask("GET", "/api/m/gamma/api/state")
    check(code == 404 and "gamma" in said.get("error", ""), f"a machine not paired: said ({code})")
    code, _, _ = alpha.ask("GET", "/api/m/alpha/api/state")
    check(code == 200, "this machine's own name: here")
    code, _, said = alpha.ask("POST", f"/api/m/beta/api/session/{sid}/send", {"text": "hello from alpha"})
    check(code == 200 and said.get("ok"), f"a message sent through alpha ({code} {said})")
    check(bool(until(lambda: "hello from alpha" in (wt / "got.txt").read_text(), limit=15)), "beta's Claude got it")
    code, _, _ = alpha.ask("POST", f"/api/m/beta/api/session/{sid}/send", {"text": "x"}, headers={"Origin": "https://evil.example"})
    check(code == 403, f"from a page elsewhere: alpha refuses it, as its own ({code})")
    blob = os.urandom(300_000)
    code, _, said = alpha.ask("POST", f"/api/m/beta/api/session/{sid}/upload", {"name": "big.bin", "data": base64.b64encode(blob).decode()})
    up = wt / ".amarchy/uploads/big.bin"
    check(code == 200 and up.is_file() and up.read_bytes() == blob, f"an upload (300 KB) lands on beta, whole ({code})")
    pic = wt / "pic.png"
    pic.write_bytes(b"\x89PNG\r\n\x1a\n" + os.urandom(5000))
    code, h, data = alpha.ask("GET", f"/api/m/beta/api/session/{sid}/media?src=pic.png", headers={"Range": "bytes=0-99"}, raw=True)
    check(code == 206 and data == pic.read_bytes()[:100] and h.get("Content-Range", "").startswith("bytes 0-99/"),
          f"a picture's first 100 bytes (Range): {code} {h.get('Content-Range')}")
    code, h, data = alpha.ask("GET", "/api/m/beta/theme.css", headers={"Accept-Encoding": "gzip"}, raw=True)
    check(code == 200 and h.get("Content-Encoding") == "gzip" and gzip.decompress(data).startswith(b":root") or b"--" in gzip.decompress(data),
          f"gzipped as beta sent it ({h.get('Content-Encoding')})")

    print("the pass-through: a chat's events as they come")
    t0 = time.time()
    c, r = stream_open(alpha, f"/api/m/beta/api/session/{sid}/stream")
    got = events(r, {"live", "session"})
    names = [n for n, _ in got]
    check(r.status == 200 and "session" in names and "live" in names and time.time() - t0 < 5,
          f"its first events in {time.time() - t0:.1f} s ({', '.join(names)})")
    beta.ask("POST", f"/api/session/{sid}/send", {"text": "a second one"})
    more = events(r, {"live"}, limit=8)
    check(len(more) > 0, f"and what changes after, as it comes ({', '.join(n for n, _ in more)})")
    c.close()
    c, r = stream_open(alpha, f"/api/m/beta/api/session/{sid}/stream", gz=True)
    got = events(r, {"live"}, gz=True)
    check(r.getheader("Content-Encoding") == "gzip" and "live" in [n for n, _ in got], "gzipped, flushed as it goes")
    c.close()

    print("the pass-through: a terminal's WebSocket")
    s, head, rest, want = ws_open(alpha, f"/api/m/beta/api/session/{sid}/tty/term?cols=100&rows=30")
    check(head.startswith("HTTP/1.1 101") and want in head, f"opened on beta through alpha ({head.splitlines()[0] if head else 'nothing'})")
    f = Frames(s, rest)
    ws_send(s, b"echo machines-$((6*7))\r")
    check(ws_read_until(f, b"machines-42", limit=15), "keys go there, what it prints comes back")
    ws_send(s, json.dumps({"resize": [120, 40]}).encode(), op=1)
    time.sleep(0.5)
    ws_send(s, b"echo size-$(stty size | tr ' ' x)\r")
    check(ws_read_until(f, b"size-40x120", limit=10), "a resize reaches its terminal")
    s.close()
    s, head, _, _ = ws_open(alpha, "/api/m/beta/api/session/nope-chat/tty/term")
    check(" 404 " in head.splitlines()[0], f"a chat that isn't there: beta's 404 ({head.splitlines()[0]})")
    s.close()

    print("beta goes away in the middle of a stream, and comes back")
    c, r = stream_open(alpha, f"/api/m/beta/api/session/{sid}/stream")
    events(r, {"live"})
    gone = {}
    def drain():
        try:
            while r.read1(65536):
                pass
        except Exception:
            pass
        gone["at"] = time.time()
    threading.Thread(target=drain, daemon=True).start()
    t0 = time.time()
    beta.stop()
    check(bool(until(lambda: "at" in gone, limit=10)), f"the stream through alpha ends with it ({gone.get('at', t0 + 99) - t0:.1f} s)")
    c.close()
    off = until(lambda: (v := alpha.state()) and next((m for m in v["machines"] if m["name"] == "beta" and not m["on"]), None) and v, limit=20)
    check(bool(off), "alpha's board says beta is off")
    if off:
        row = next((s for s in off["sessions"] if s["id"] == sid), None)
        check(bool(row) and row.get("machine_off") is True, "its chat stays, as last seen, marked off")
    code, _, said = alpha.ask("GET", f"/api/m/beta/api/session/{sid}/composer")
    check(code == 502 and said.get("machine_off") and "beta is off" in said.get("error", ""), f"the pass-through says it's off ({said.get('error')})")
    kept = alpha.home / "state/amarchy/app/peers/beta.json"
    check(kept.is_file() and sid in kept.read_text(), "its last chats kept on disk (for after a restart)")
    alpha.stop()
    alpha.start()
    after = until(lambda: (v := alpha.state()) and any(s["id"] == sid for s in v["sessions"]) and v, limit=10)
    check(bool(after) and next(s for s in after["sessions"] if s["id"] == sid).get("machine_off"), "alpha restarted: still there, off")
    t0 = time.time()
    beta.start()
    back = until(lambda: (v := alpha.state()) and any(m["name"] == "beta" and m["on"] for m in v["machines"])
                 and not next(s for s in v["sessions"] if s["id"] == sid).get("machine_off"), limit=45)
    check(bool(back), f"beta back: on again by itself ({time.time() - t0:.0f} s)")
    code, _, _ = alpha.ask("GET", f"/api/m/beta/api/session/{sid}/composer")
    check(code == 200, f"and the pass-through works again ({code})")

    print("beta hangs (a laptop shut): its connections stay open, nothing comes")
    c, r = stream_open(alpha, f"/api/m/beta/api/session/{sid}/stream")
    events(r, {"live"})
    gone = {}
    threading.Thread(target=drain, daemon=True).start()
    t0 = time.time()
    os.killpg(beta.proc.pid, signal.SIGSTOP)
    try:
        hung = until(lambda: any(m["name"] == "beta" and not m["on"] for m in alpha.state()["machines"]), limit=30)
        check(bool(hung), f"alpha's board says it's off ({time.time() - t0:.0f} s; silent 6 s is gone, here)")
        check(bool(until(lambda: "at" in gone, limit=20)), f"the stream through alpha ends ({gone.get('at', t0 + 99) - t0:.0f} s)")
        c.close()
    finally:
        os.killpg(beta.proc.pid, signal.SIGCONT)
    t0 = time.time()
    check(bool(until(lambda: any(m["name"] == "beta" and m["on"] for m in alpha.state()["machines"]), limit=45)),
          f"it wakes: on again ({time.time() - t0:.0f} s)")

    print("rename and remove")
    r = alpha.amarchy("machines", "rename", "beta", "Beta box")
    check(r.returncode == 0 and (beta.home / "config/amarchy/label").read_text().strip() == "Beta box", "renamed on beta itself")
    check(bool(until(lambda: any(m["label"] == "Beta box" for m in alpha.state()["machines"]), limit=10)), "alpha's board says it")
    r = alpha.amarchy("machines", "rename", "alpha", "Alpha")
    check(bool(until(lambda: any(m["name"] == "alpha" and m["label"] == "Alpha" for m in beta.state()["machines"]), limit=15)),
          "alpha's own label reaches beta's board")
    r = alpha.amarchy("machines", "remove", "beta")
    check(r.returncode == 0 and alpha.machines() == [] and beta.machines() == [], f"removed: both forget ({r.stdout.strip()})")
    check(bool(until(lambda: not any(s.get("machine") == "beta" for s in alpha.state()["sessions"]), limit=10)),
          "beta's chats leave alpha's board")
    code, _, _ = beta.ask("GET", "/api/peer/state", cookie=False, headers=peer())
    check(code == 403, f"the old key: refused ({code})")
finally:
    for m in (alpha, beta):
        try:
            m.stop()
        except Exception:
            pass
        subprocess.run(["tmux", "-L", m.socket, "kill-server"], capture_output=True)
    if failed:
        for m in (alpha, beta):
            log = (m.home / "server.log")
            if log.exists():
                print(f"--- {m.name}'s log\n" + log.read_text()[-3000:])
    shutil.rmtree(BASE, ignore_errors=True)

print(f"\n{'all passed' if not failed else f'{len(failed)} failed'}")
sys.exit(1 if failed else 0)
