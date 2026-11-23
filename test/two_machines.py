# Two amarchy app servers on this machine, for the tests between machines
# (test/machines.py, test/sync.py): each with a home, state, port, name and
# tmux of its own, a fake claude that speaks the chat engine's protocol, the
# real `amarchy app serve` and CLI. Imported; runs nothing by itself.

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

    def amarchy(self, *args, input=None, timeout=60, env_extra=None):
        return subprocess.run([sys.executable, BIN, *args], env={**self.env, **(env_extra or {})}, capture_output=True, text=True,
                              input=input, timeout=timeout)

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
