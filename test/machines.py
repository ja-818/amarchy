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
#   - the command line across machines: amarchy new --on, list --all, send
#     and close <machine>:<id> (refused with uncommitted changes unless
#     --force, and while something else holds its preview's port; off: said);
#   - rename (on the machine itself), remove (both forget).
#
#   python3 test/machines.py        exits 0 when every check passed (about a minute)

import base64, gzip, hashlib, http.client, json, os, shutil, signal, socket, stat, subprocess, sys, tempfile, threading, time, zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from two_machines import *      # Machine, until, check, failed, the streams' and WebSockets' helpers

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
    check(code == 200 and h.get("name") == "beta" and h.get("protocol") == 1 and USER in h.get("users", []) and "user" in h and "version" in h,
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

    print("the command line, across machines")
    r = alpha.amarchy("new", "proj", "three", "--on", "beta", "--prompt", "started from alpha")
    key = r.stdout.strip().splitlines()[-1] if r.returncode == 0 and r.stdout.strip() else ""
    check(key == "beta:proj-three", f"amarchy new --on beta: {key or r.stderr.strip()[-160:]}")
    three = until(lambda: next((s for s in beta.state()["sessions"] if s["id"] == "proj-three" and not s.get("setup")), None), limit=30)
    check(bool(three), "the chat is on beta")
    check(bool(three) and bool(until(lambda: "started from alpha" in (Path(three["path"]) / "got.txt").read_text(), limit=20)),
          "its Claude there got the prompt")
    r = alpha.amarchy("new", "nope", "--on", "beta")
    check(r.returncode != 0 and "GitHub" in r.stderr, f"a project on neither, with no GitHub address: said ({r.stderr.strip()[-120:]})")
    r = alpha.amarchy("new", "proj", "--on", "gamma")
    check(r.returncode != 0 and "no machine gamma" in r.stderr, "a machine not paired: said")
    r = alpha.amarchy("list", "--all", "--compact")
    rows = json.loads(r.stdout) if r.returncode == 0 else []
    check({(s["machine"], s["id"]) for s in rows} >= {("alpha", aid), ("beta", sid), ("beta", "proj-three")},
          f"amarchy list --all: both machines' chats, each with its machine ({sorted((s['machine'], s['id']) for s in rows)})")
    r = alpha.amarchy("send", f"beta:{sid}", "sent by alpha's command line", env_extra={"AMARCHY_SESSION": aid})
    check(r.returncode == 0 and "queued for beta:" in r.stdout, f"amarchy send beta:{sid} ({(r.stdout or r.stderr).strip()[:100]})")
    check(bool(until(lambda: "sent by alpha's command line" in (wt / "got.txt").read_text(), limit=20)), "its Claude on beta got it")
    sent_by = beta.home / f"state/amarchy/sent-by/{sid}.jsonl"
    check(sent_by.is_file() and f'"from": "alpha:{aid}"' in sent_by.read_text(), "noted there as from alpha's chat, not from you")
    r = alpha.amarchy("send", "beta:nope-chat", "x")
    check(r.returncode != 0 and "no such chat" in r.stderr, f"a chat that isn't there: said ({r.stderr.strip()[-80:]})")

    print("closing a chat on another machine")
    on_beta = lambda cid: any(s["id"] == cid for s in beta.state()["sessions"])
    tp = Path(three["path"]) if three else beta.work / "nowhere"
    (tp / "wip.txt").write_text("not committed\n")
    r = alpha.amarchy("close", "beta:proj-three")
    check(r.returncode != 0 and "uncommitted changes" in r.stderr and "amarchy close beta:proj-three --force" in r.stderr,
          f"uncommitted changes: refused, saying --force ({r.stderr.strip()[-120:]})")
    check(on_beta("proj-three") and (tp / "wip.txt").is_file(), "it stays on beta, its work too")
    held = socket.socket()
    held.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    held.bind(("127.0.0.1", 0))
    held.listen()
    hp = held.getsockname()[1]
    r = beta.amarchy("preview", "--id", "proj-three", "--run", f"python3 -m http.server {hp} --bind 127.0.0.1",
                     f"http://localhost:{hp}", "--no-start")
    check(r.returncode == 0, f"a preview of its own on beta ({(r.stdout or r.stderr).strip()[-120:]})")
    r = alpha.amarchy("close", "proj-three", "--on", "beta", "--force")
    check(r.returncode != 0 and "preview is still running" in r.stderr and str(hp) in r.stderr and on_beta("proj-three"),
          f"something else on its preview's port: refused even with --force, saying what ({r.stderr.strip()[-160:]})")
    held.close()
    r = alpha.amarchy("close", "--force", "proj-three", "--on=beta")
    check(r.returncode == 0, f"amarchy close proj-three --on beta --force: closed ({r.stderr.strip()[-120:]})")
    check(bool(until(lambda: not on_beta("proj-three"), limit=15)), "off beta's list")
    check(bool(until(lambda: not tp.exists(), limit=40)), "its worktree gone from beta, uncommitted work with it (asked)")
    check(bool(until(lambda: not any(s["id"] == "proj-three" for s in alpha.state()["sessions"]), limit=15)), "and off alpha's board")
    r = alpha.amarchy("close", "beta:proj-three")
    check(r.returncode != 0 and "no such chat" in r.stderr, f"closed already: said ({r.stderr.strip()[-80:]})")
    r = alpha.amarchy("close", "gamma:proj-three")
    check(r.returncode != 0 and "no machine gamma" in r.stderr, "a machine not paired: said")
    r = alpha.amarchy("close", "alpha:proj-three", "--on", "beta")
    check(r.returncode != 0 and "not beta" in r.stderr, f"two machines named: refused ({r.stderr.strip()[-80:]})")
    r = alpha.amarchy("new", "proj", "five", "--on", "beta")
    ok = r.returncode == 0 and bool(until(lambda: next((s for s in beta.state()["sessions"] if s["id"] == "proj-five"
                                                         and not s.get("setup")), None), limit=30))
    r = alpha.amarchy("close", "beta:proj-five") if ok else r
    check(ok and r.returncode == 0 and bool(until(lambda: not on_beta("proj-five"), limit=15)),
          f"one with nothing uncommitted: closed, no --force ({r.stderr.strip()[-100:]})")
    r = alpha.amarchy("new", "proj", "six")
    six = r.stdout.strip().splitlines()[-1] if r.returncode == 0 and r.stdout.strip() else ""
    on_alpha = lambda: any(s["id"] == six for s in alpha.state()["sessions"])
    until(lambda: next((s for s in alpha.state()["sessions"] if s["id"] == six and not s.get("setup")), None), limit=30)
    r = alpha.amarchy("close", f"alpha:{six}")
    check(bool(six) and r.returncode == 0 and bool(until(lambda: not on_alpha(), limit=15)),
          f"this machine's own name: closed here ({r.stderr.strip()[-100:]})")

    print("another machine's agent and its task")
    r = beta.amarchy("agents", sid, "--name", "Beta")
    check(r.returncode == 0, f"beta's chat made an agent ({(r.stdout or r.stderr).strip()[:80]})")
    r = beta.amarchy("task", "add", "--title", "Check: the beta box", "--button", "Done=done with the beta box", "--agent", sid)
    tid = r.stdout.strip()
    check(r.returncode == 0 and len(tid) == 6, f"a task of its own ({tid or r.stderr.strip()[:80]})")
    task = until(lambda: next((x for x in (alpha.state().get("today") or {}).get("tasks") or [] if x.get("id") == tid), None), limit=15)
    check(bool(task) and task.get("machine") == "beta" and task.get("agent") == sid, f"on alpha's Tasks, with its machine ({task})")
    code, _, said = alpha.ask("POST", "/api/m/beta/api/tasks/press", {"id": tid, "button": 0})
    check(code == 200, f"its button pressed through alpha ({code} {said})")
    check(bool(until(lambda: "done with the beta box" in (wt / "got.txt").read_text(), limit=20)), "its message reached the agent on beta")
    check(bool(until(lambda: not any(x.get("id") == tid for x in (alpha.state().get("today") or {}).get("tasks") or []), limit=15)),
          "and it's off alpha's Tasks")
    beta.amarchy("agents", sid, "off")

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
    other = alpha.work / "site"
    other.mkdir(exist_ok=True)
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=other, capture_output=True)
    (other / "a.txt").write_text("a\n")
    subprocess.run(["git", "add", "."], cwd=other, capture_output=True)
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "a"], cwd=other, capture_output=True)
    code, _, said = alpha.ask("POST", "/api/m/beta/api/add", {"repo": str(other)}, timeout=120)
    check(code == 200 and said.get("name") == "site" and said.get("path", "").endswith("/site") and (beta.work / "site/a.txt").is_file(),
          f"a project cloned on beta through alpha: its name, and its path ({said})")
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
    s, head, rest, _ = ws_open(alpha, "/api/m/beta/api/session/nope-chat/tty/term")
    check(" 404 " in head.splitlines()[0], f"a chat that isn't there: beta's 404 ({head.splitlines()[0]} {rest[:200]!r})")
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
    r = alpha.amarchy("list", "--all", "--compact")
    rows = json.loads(r.stdout) if r.returncode == 0 else []
    check(any(s["id"] == sid and s.get("machine_off") for s in rows), "amarchy list --all: beta's chats as last seen, off")
    r = alpha.amarchy("send", f"beta:{sid}", "x")
    check(r.returncode != 0 and "beta is off" in r.stderr, f"amarchy send to it: says it's off ({r.stderr.strip()[-80:]})")
    r = alpha.amarchy("close", f"beta:{sid}")
    check(r.returncode != 0 and "beta is off" in r.stderr, f"amarchy close on it: says it's off ({r.stderr.strip()[-80:]})")
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
