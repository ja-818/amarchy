# Dictation on a machine without the speech model (not set up yet, or a
# laptop that shouldn't hold it), written down by another machine of yours
# that has it (see "dictation on the host" in bin/amarchy), with two real
# amarchy app servers on this machine (test/two_machines.py):
#
#   - alpha has the model (this host's engine, transcribe.cpp, and model),
#     beta has neither (no package's engine either);
#   - beta says so honestly: setup fetches them, by itself, and alpha
#     writes it down meanwhile;
#   - alpha's hello says it writes dictations down; beta's board and its
#     /api/dictate say alpha does it for beta (via);
#   - the app's WebSocket on beta: what's said, written down on alpha, the
#     words back on beta's socket; alpha's log says for whom;
#   - beta's CLI: amarchy dictation transcribe goes to alpha (and --on);
#   - never further than one: alpha asking beta (its pass-through) gets
#     beta's own no, not alpha's model again;
#   - alpha off: beta's board has no via any more, the mic says why;
#   - a processor amarchy has no engine for: beta says so, and Settings'
#     button can't set it up by itself;
#   - Settings' button on beta: the engine fetched there (the real release,
#     checked, unpacked without the GPU's code; how far on its board), then
#     beta writes its own down; what wrote it down before (whisper.cpp's
#     model and build) gone; remove takes the engine too; setup --engine
#     (what an install runs) fetches only the engine.
#
# Needs this host's dictation set up (amarchy dictation: the engine and the
# model) and ffmpeg; the recording is whisper.cpp's JFK sample, fetched once
# (checked by its hash) into ~/.cache/amarchy-test.
#
#   python3 test/dictation-machines.py      exits 0 when every check passed

import hashlib, json, os, sys, time, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from two_machines import *      # Machine, until, check, failed, the WebSockets' helpers

HOST = Path(os.environ.get("XDG_STATE_HOME") or Path.home() / ".local/state") / "amarchy/dictation"
MODEL = HOST / "parakeet-tdt-0.6b-v3-Q8_0.gguf"
ENGINE = next((d for d in (HOST / "transcribe.cpp", Path("/usr/lib/amarchy/transcribe.cpp")) if (d / "libtranscribe.so").is_file()), None)
SPEECH = Path.home() / ".cache/amarchy-test/jfk.wav"
SPEECH_URL = "https://raw.githubusercontent.com/ggml-org/whisper.cpp/d1be6fde11ac6e0407606b4e42fe72d34add8037/samples/jfk.wav"
SPEECH_SHA = "59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e"

if not MODEL.is_file() or not ENGINE or not shutil.which("ffmpeg"):
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

alpha, beta = Machine("alpha"), Machine("beta")
for m in (alpha, beta):
    m.env["AMARCHY_DICTATE_SYSTEM"] = "off"         # no package's engine: only what's in its own state
(alpha.home / "state/amarchy/dictation").mkdir(parents=True)
(alpha.home / "state/amarchy/dictation" / MODEL.name).symlink_to(MODEL)
(alpha.home / "state/amarchy/dictation/transcribe.cpp").symlink_to(ENGINE)


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
    check("amarchy dictation setup (fetches transcribe.cpp 0.4.2 and Parakeet TDT 0.6B v3" in out and "whisper" not in out,
          f"setup fetches what it needs ({out.splitlines()[0][:160] if out else r.stderr[-160:]})")
    d = beta.state().get("dictation") or {}
    check(d.get("ready") is False and d.get("via") is None and d.get("lib") is False and d.get("auto") is True
          and d.get("buildable") is False and "fetches" in (d.get("how") or "") and d.get("fix") == "amarchy dictation setup",
          f"its board: not ready, nobody to send it to, setup by itself ({d.get('how')})")
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

    print("a processor amarchy has no engine for")
    beta.stop()
    beta.env["AMARCHY_DICTATE_ARCH"] = "riscv64"
    check(beta.start(), "beta again, as a riscv64")
    d = beta.state().get("dictation") or {}
    check(d.get("auto") is False and d.get("fix") is None and "no speech engine for riscv64" in (d.get("how") or "")
          and "AMARCHY_DICTATE_ENGINE" in d["how"], f"its board: it can't by itself, and what would ({(d.get('how') or '')[:90]})")
    code, _, said = beta.ask("POST", "/api/dictate/setup", {})
    check(code == 409 and "no speech engine for riscv64" in said.get("error", ""), f"Settings' button: says so ({said.get('error', '')[:90]})")
    r = beta.amarchy("dictation", "setup", env_extra={"AMARCHY_DICTATE_ARCH": "riscv64"})
    check(r.returncode != 0 and "no speech engine for riscv64" in r.stderr, f"amarchy dictation setup: says so ({r.stderr.strip()[:90]})")
    r = beta.amarchy("dictation", "setup", "--engine", env_extra={"AMARCHY_DICTATE_ARCH": "riscv64"})
    check(r.returncode == 0 and not (beta.home / "state/amarchy/dictation/transcribe.cpp").exists(),
          "an install's setup --engine there: nothing to fetch, no error")

    # Settings' button: the engine fetched on beta (the real release, about
    # 20 MB), how far on its board, then beta writes its own down. The model
    # is this host's (no 740 MB download for a test); what wrote it down
    # before is there, to go.
    if os.environ.get("QUICK"):
        print("beta sets up its own: skipped (QUICK)")
    else:
        print("beta sets up its own (Settings' button)")
        beta.stop()
        del beta.env["AMARCHY_DICTATE_ARCH"]
        here = beta.home / "state/amarchy/dictation"
        here.mkdir(parents=True, exist_ok=True)
        (here / MODEL.name).symlink_to(MODEL)
        (here / "parakeet-tdt-0.6b-v3-q8_0.bin").write_bytes(b"whisper.cpp's model")
        (here / "whisper.cpp/lib").mkdir(parents=True)
        check(beta.start(), "beta again")
        d = beta.state().get("dictation") or {}
        check(d.get("auto") is True and d.get("lib") is False and d.get("model") is True and d.get("size") == 22562331,
              f"its board: only the engine to fetch ({d.get('size')} bytes: {d.get('how')})")
        code, _, _ = beta.ask("POST", "/api/dictate/setup", {})
        check(code == 200, f"Set up dictation: under way ({code})")
        # (Its progress is there before the button's answer: nothing to catch in flight.)
        seen = until(lambda: (x := (beta.state().get("dictation") or {}).get("setup") or {}).get("size") and x, limit=5, step=0.1)
        check(bool(seen) and seen.get("size") == 22562331 and 0 <= seen.get("done", -1) <= seen["size"] and not seen.get("error"),
              f"how far, on its board ({seen})")
        d = until(lambda: (x := beta.state().get("dictation") or {}).get("ready") and x, limit=180, step=1) or {}
        check(d.get("ready") is True and d.get("via") is None and not d.get("setup"), "set up: beta writes its own down")
        eng = here / "transcribe.cpp"
        check(json.loads((eng / "contract.json").read_text()).get("version") == "0.4.2" and (eng / "libtranscribe.so").is_file()
              and not (eng / "libggml-vulkan.so").exists() and (eng / "licenses/LICENSE").is_file(),
              "transcribe.cpp 0.4.2 in its state: its CPU code and licenses, not the GPU's")
        check(not (here / "parakeet-tdt-0.6b-v3-q8_0.bin").exists() and not (here / "whisper.cpp").exists()
              and not list(here.glob("*.part")) and not (here / "setup.json").exists(),
              "what wrote it down before gone, nothing half-fetched left")
        code, said = talk(beta)
        text = next((m["text"] for m in said if "text" in m), "")
        check("country" in text, f"its mic: written down on beta itself ({text[:60]!r})")
        log = until(lambda: [json.loads(x) for x in (here / "log.jsonl").read_text().splitlines()], limit=5) or []
        check(log and log[-1].get("engine") == "host" and not log[-1].get("for"), "in beta's own log")
        code, _, h = beta.ask("GET", "/api/peer/hello", cookie=False)
        check((h.get("dictation") or {}).get("ready") is True, "beta's hello: it writes dictations down now")
        r = beta.amarchy("dictation")
        check("through transcribe.cpp 0.4.2" in r.stdout, f"amarchy dictation says through what ({r.stdout.strip()[:120]})")
        r = beta.amarchy("dictation", "remove")
        check(r.returncode == 0 and not eng.exists() and not (here / MODEL.name).exists() and MODEL.is_file(),
              f"remove: the model and the engine (this host's model untouched: {r.stdout.strip()[:90]})")
        r = beta.amarchy("dictation", "setup", "--engine", timeout=180)
        check(r.returncode == 0 and (eng / "libtranscribe.so").is_file() and not (here / MODEL.name).exists()
              and "the speech model comes the first time" in r.stdout,
              f"setup --engine (an install's): the engine only ({r.stdout.strip()[:100] or r.stderr.strip()[-100:]})")
finally:
    for m in (alpha, beta):
        m.stop()
    if not failed:
        shutil.rmtree(BASE, ignore_errors=True)

print(f"\n{'FAILED: ' + ', '.join(failed) if failed else 'all passed'}")
sys.exit(1 if failed else 0)
