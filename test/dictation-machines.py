# Dictation on a machine without the speech model (an ARM laptop: no
# whisper-cpp package for it), written down by another machine of yours
# that has it (see "dictation on the host" in bin/amarchy), with two real
# amarchy app servers on this machine (test/two_machines.py):
#
#   - alpha has the model (this host's libparakeet and model), beta has
#     neither, and no package for it (a pacman that has no whisper-cpp);
#   - beta says so honestly: no pacman line that fails, but setup building
#     whisper.cpp (what that needs first), and that alpha writes it down;
#   - alpha's hello says it writes dictations down; beta's board and its
#     /api/dictate say alpha does it for beta (via);
#   - the app's WebSocket on beta: what's said, written down on alpha, the
#     words back on beta's socket; alpha's log says for whom;
#   - beta's CLI: amarchy dictation transcribe goes to alpha (and --on);
#   - never further than one: alpha asking beta (its pass-through) gets
#     beta's own no, not alpha's model again;
#   - alpha off: beta's board has no via any more, the mic says why;
#   - Settings' button on beta: whisper.cpp built there (how far on its
#     board), then beta writes its own down; remove takes the build too.
#
# Needs this host's dictation set up (amarchy dictation: libparakeet and the
# model) and ffmpeg; the recording is whisper.cpp's JFK sample, fetched once
# (checked by its hash) into ~/.cache/amarchy-test.
#
#   python3 test/dictation-machines.py      exits 0 when every check passed

import hashlib, json, os, sys, time, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from two_machines import *      # Machine, until, check, failed, the WebSockets' helpers

MODEL = Path(os.environ.get("XDG_STATE_HOME") or Path.home() / ".local/state") / "amarchy/dictation/parakeet-tdt-0.6b-v3-q8_0.bin"
LIB = next((p for p in (Path("/usr/lib/libparakeet.so.1"), Path("/usr/local/lib/libparakeet.so.1")) if p.exists()), None)
SPEECH = Path.home() / ".cache/amarchy-test/jfk.wav"
SPEECH_URL = "https://raw.githubusercontent.com/ggml-org/whisper.cpp/d1be6fde11ac6e0407606b4e42fe72d34add8037/samples/jfk.wav"
SPEECH_SHA = "59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e"

if not MODEL.is_file() or not LIB or not shutil.which("ffmpeg"):
    print("skipped: this host's dictation isn't set up (amarchy dictation), or no ffmpeg")
    sys.exit(0)
if not SPEECH.is_file() or hashlib.sha256(SPEECH.read_bytes()).hexdigest() != SPEECH_SHA:
    SPEECH.parent.mkdir(parents=True, exist_ok=True)
    data = urllib.request.urlopen(SPEECH_URL, timeout=60).read()
    if hashlib.sha256(data).hexdigest() != SPEECH_SHA:
        sys.exit("the JFK sample that came isn't the one it should be")
    SPEECH.write_bytes(data)
pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(SPEECH), "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
                     capture_output=True, check=True).stdout

# No whisper-cpp in this machine's packages (as on Arch Linux ARM): for both, but alpha has the system's library.
(FAKE / "pacman").write_text("#!/bin/sh\necho \"error: package 'whisper-cpp' was not found\" >&2\nexit 1\n")
(FAKE / "pacman").chmod(0o755)

alpha, beta = Machine("alpha"), Machine("beta")
beta.env["AMARCHY_DICTATE_SYSTEM"] = "off"          # as on a machine without the library
(alpha.home / "state/amarchy/dictation").mkdir(parents=True)
(alpha.home / "state/amarchy/dictation" / MODEL.name).symlink_to(MODEL)


def talk(m, path="/api/dictate", audio=pcm, limit=90):
    """The app's mic on machine m: the audio, "end", then what came back (each JSON message)."""
    s, head, rest, want = ws_open(m, path)
    if " 101 " not in head.split("\r\n")[0]:
        s.close()
        return head.split("\r\n")[0], []
    for i in range(0, len(audio), 6400):
        ws_send(s, audio[i:i + 6400])
    ws_send(s, b"end", op=1)
    said, buf, end = [], rest, time.time() + limit
    s.settimeout(2)
    while time.time() < end:
        while len(buf) >= 2:
            n, at = buf[1] & 0x7F, 2
            if n == 126:
                n, at = int.from_bytes(buf[2:4], "big"), 4
            if len(buf) < at + n:
                break
            op, data, buf = buf[0] & 0x0F, buf[at:at + n], buf[at + n:]
            if op == 1:
                said.append(json.loads(data))
                if "text" in said[-1] or "error" in said[-1]:
                    s.close()
                    return "101", said
        try:
            chunk = s.recv(65536)
        except socket.timeout:
            continue
        if not chunk:
            break
        buf += chunk
    s.close()
    return "101", said


try:
    print("two machines, one with the speech model")
    check(alpha.start() and beta.start(), f"alpha (:{alpha.port}) and beta (:{beta.port}) serve")

    print("beta alone: honest about what works there")
    r = beta.amarchy("dictation")
    out = r.stdout
    check("pacman -S whisper-cpp" not in out and "amarchy dictation setup" in out and "builds" in out,
          f"no pacman line that fails, setup builds it ({out.splitlines()[0][:160] if out else r.stderr[-160:]})")
    d = beta.state().get("dictation") or {}
    check(d.get("ready") is False and d.get("via") is None and d.get("lib") is False and isinstance(d.get("how"), str)
          and "builds" in d["how"], f"its board: not ready, nobody to send it to, how ({d.get('how')})")
    code, said = talk(beta)
    check(code.startswith("HTTP/1.1 409") or code.startswith("HTTP/1.0 409"), f"its mic's WebSocket: refused, saying why ({code})")

    print("paired: alpha writes beta's down")
    r = alpha.amarchy("machines", "add", beta.url)
    check(r.returncode == 0, f"alpha pairs with beta ({(r.stdout or r.stderr).strip()[:100]})")
    code, _, h = alpha.ask("GET", "/api/peer/hello", cookie=False)
    check((h.get("dictation") or {}).get("ready") is True, f"alpha's hello: it writes dictations down ({h.get('dictation')})")
    code, _, h = beta.ask("GET", "/api/peer/hello", cookie=False)
    check((h.get("dictation") or {}).get("ready") is False, f"beta's: it doesn't ({h.get('dictation')})")
    d = until(lambda: (x := beta.state().get("dictation") or {}).get("via") and x, limit=20) or {}
    check((d.get("via") or {}).get("name") == "alpha" and d.get("ready") is False and d["via"].get("engine"),
          f"beta's board: alpha writes it down (via {d.get('via')})")
    a = alpha.state().get("dictation") or {}
    check(a.get("ready") is True and a.get("via") is None, "alpha's board: its own model, no via")
    code, _, st_ = beta.ask("GET", "/api/dictate")
    check(code == 200 and (st_.get("via") or {}).get("name") == "alpha", f"beta's /api/dictate says so too ({st_.get('via')})")

    t0 = time.time()
    code, said = talk(beta)
    text = next((m["text"] for m in said if "text" in m), "")
    check(code == "101" and "ask not what your country can do for you" in text.lower().replace(".", "").replace(",", ""),
          f"beta's mic: written down on alpha, the words back ({time.time() - t0:.1f} s: {text[:90]!r})")
    check(any(m.get("state") == "listening" for m in said) and any(m.get("state") == "transcribing" for m in said),
          "as on the host itself: listening, then writing it down")
    log = until(lambda: [json.loads(x) for x in (alpha.home / "state/amarchy/dictation/log.jsonl").read_text().splitlines()], limit=5) or []
    check(log and log[-1].get("for") == "beta" and log[-1].get("engine") == "host" and "country" in log[-1].get("text", ""),
          f"alpha's log: written down for beta ({ {k: log[-1].get(k) for k in ('for', 'engine', 'device')} if log else None})")
    r = alpha.amarchy("dictation", "log")
    check("for beta" in r.stdout, "amarchy dictation log on alpha says for whom")

    print("beta's CLI")
    r = beta.amarchy("dictation")
    check(r.returncode == 0 and "through alpha" in r.stdout and "setup" in r.stdout,
          f"amarchy dictation: alpha writes it down, and how to do it here ({r.stdout.splitlines()[0][:120] if r.stdout else ''})")
    r = beta.amarchy("dictation", "transcribe", str(SPEECH), timeout=120)
    check(r.returncode == 0 and "country" in r.stdout and "on alpha" in r.stderr,
          f"transcribe: on alpha ({(r.stdout.strip() or r.stderr.strip())[:90]})")
    r = beta.amarchy("dictation", "transcribe", "--on", "alpha", str(SPEECH), timeout=120)
    check(r.returncode == 0 and "country" in r.stdout, "transcribe --on alpha")
    r = beta.amarchy("dictation", "transcribe", "--on", "gamma", str(SPEECH))
    check(r.returncode != 0 and "no such machine" in r.stderr, f"--on a machine that isn't paired: says so ({r.stderr.strip()[:80]})")
    r = alpha.amarchy("dictation", "transcribe", "--on", "beta", str(SPEECH))
    check(r.returncode != 0 and "can't write it down" in r.stderr, f"--on one without the model: says so ({r.stderr.strip()[:80]})")

    print("never further than one")
    code, said = talk(alpha, "/api/m/beta/api/dictate", audio=pcm[:32000])
    check("409" in code, f"alpha through beta: beta's own no, not passed back to alpha ({code})")

    print("alpha off")
    alpha.stop()
    d = until(lambda: not (x := beta.state().get("dictation") or {}).get("via") and x, limit=30) or {}
    check(d and d.get("via") is None and d.get("ready") is False, "beta's board: nobody writes it down now")
    code, said = talk(beta, audio=pcm[:32000])
    check("409" in code, f"its mic: refused, saying why ({code})")
    code, _, said = beta.ask("POST", "/api/dictate/setup", {})
    check(code == 409 and "cmake" in said.get("error", ""), f"Settings' button without what builds it: says what to install ({said.get('error', '')[:100]})")

    # Settings' button where it can build: whisper.cpp built on beta (a minute or
    # so), progress on its board, then beta writes its own down. Only with a cmake
    # (pip's will do: python -m venv ~/.cache/cmake-venv && ~/.cache/cmake-venv/bin/pip install cmake).
    cmake = shutil.which("cmake") or next((str(c) for c in [Path.home() / ".cache/cmake-venv/bin/cmake"] if c.exists()), None)
    if not cmake or os.environ.get("QUICK"):
        print("beta builds its own: skipped (no cmake, or QUICK)")
    else:
        print("beta builds its own (Settings' button)")
        beta.stop()
        beta.env["PATH"] = f"{FAKE}:{Path(cmake).parent}:/usr/local/bin:/usr/bin:/bin"
        (beta.home / "state/amarchy/dictation").mkdir(parents=True, exist_ok=True)
        (beta.home / "state/amarchy/dictation" / MODEL.name).symlink_to(MODEL)     # (no 670 MB download for a test)
        check(beta.start(), "beta again, with a cmake")
        d = beta.state().get("dictation") or {}
        check(d.get("buildable") is True and "builds whisper.cpp" in (d.get("how") or ""), f"its board: it can build it ({d.get('how')})")
        code, _, _ = beta.ask("POST", "/api/dictate/setup", {})
        check(code == 200, f"Set up dictation: under way ({code})")
        seen = until(lambda: ((beta.state().get("dictation") or {}).get("setup") or {}).get("pct") is not None
                     and beta.state()["dictation"]["setup"], limit=120, step=0.5)
        check(bool(seen) and "building whisper.cpp" in seen.get("build", ""), f"how far, on its board ({seen})")
        d = until(lambda: (x := beta.state().get("dictation") or {}).get("ready") and x, limit=600, step=2) or {}
        check(d.get("ready") is True and d.get("via") is None and not d.get("setup"), "built: beta writes its own down")
        built = beta.home / "state/amarchy/dictation/whisper.cpp"
        check((built / "lib/libparakeet.so.1").exists() and json.loads((built / "amarchy.json").read_text()).get("commit", "").startswith("d1be6fde"),
              "whisper.cpp 1.9.5 in its state, at its commit")
        check(not (beta.home / "state/amarchy/dictation/build").exists(), "its source and build gone, only the libraries kept")
        code, said = talk(beta)
        text = next((m["text"] for m in said if "text" in m), "")
        check("country" in text, f"its mic: written down on beta itself ({text[:60]!r})")
        log = [json.loads(x) for x in (beta.home / "state/amarchy/dictation/log.jsonl").read_text().splitlines()]
        check(log and log[-1].get("engine") == "host" and not log[-1].get("for"), "in beta's own log")
        r = beta.amarchy("dictation")
        check("built here" in r.stdout, f"amarchy dictation says it's the one built here ({r.stdout.strip()[:120]})")
        r = beta.amarchy("dictation", "remove")
        check(r.returncode == 0 and not built.exists() and "whisper.cpp built here" in r.stdout, f"remove: the model and the build ({r.stdout.strip()[:100]})")
finally:
    for m in (alpha, beta):
        m.stop()
    if not failed:
        shutil.rmtree(BASE, ignore_errors=True)

print(f"\n{'FAILED: ' + ', '.join(failed) if failed else 'all passed'}")
sys.exit(1 if failed else 0)
