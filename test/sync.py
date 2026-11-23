# Your stuff on every machine (docs/plan-omarchy-and-machines.md, track D):
# three real amarchy app servers on this machine (alpha, beta, gamma; see
# test/two_machines.py), every pair paired. What's yours, changed on one
# machine (the CLI, the app), is the same on the others in a moment:
#
#   - items, last change wins: the look, the project order, a new chat's
#     model and effort, alerts, the chime, Show terminals, how machines show,
#     the daily goal; at pairing, the latest set of any machine's wins;
#   - files by their hash: your own wallpaper, your chime, a theme of yours;
#   - every machine's missions (a merge, an all clear), counted once each,
#     the badges (the earliest), a reset (the same score everywhere);
#   - a machine off during a change catches up when it's back; one that was
#     off while the machine that changed it went away catches up through a
#     third; two edits made apart: the later one, everywhere;
#   - what's per machine on purpose (when its chats sleep) stays.
#
#   python3 test/sync.py        exits 0 when every check passed (a couple of minutes)

import base64, json, os, subprocess, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from two_machines import *      # Machine, until, check, failed

ms = alpha, beta, gamma = Machine("alpha"), Machine("beta"), Machine("gamma")
SYNC_WAIT = 6        # seconds: a few looks for changes (every 2 s)


def st(m):
    return m.state()


def item(m, key):
    """An item as machine m has it stamped (its sync/items.json)."""
    try:
        return (json.loads((m.home / "state/amarchy/sync/items.json").read_text()).get(key) or {}).get("value")
    except (OSError, ValueError):
        return None


def py(m, code):
    """Python with amarchy loaded as machine m (its HOME and state)."""
    shim = ("import importlib.machinery, importlib.util\n"
            f"l = importlib.machinery.SourceFileLoader('am', {BIN!r}); am = importlib.util.module_from_spec(importlib.util.spec_from_loader(l.name, l)); l.exec_module(am)\n"
            + code)
    return subprocess.run([sys.executable, "-c", shim], env=m.env, capture_output=True, text=True, timeout=60)


def same(fn, want=None, limit=20):
    """fn(m) the same on every machine that's up (and want, given), within limit seconds."""
    up = [m for m in ms if m.proc and m.proc.poll() is None]
    def ok():
        got = [json.dumps(fn(m), sort_keys=True) for m in up]
        return len(set(got)) == 1 and (want is None or got[0] == json.dumps(want, sort_keys=True))
    return until(ok, limit=limit)


try:
    print("three machines, each its own")
    alpha.amarchy("theme", "nord")
    time.sleep(1.2)
    beta.amarchy("theme", "ristretto")      # set later: it wins at pairing
    beta.amarchy("alerts", "all")
    for m in ms:
        m.start()
    for a, b in ((alpha, beta), (alpha, gamma), (beta, gamma)):
        r = a.amarchy("machines", "add", b.url)
        check(r.returncode == 0, f"{a.name} pairs with {b.name}")

    print("at pairing: the latest of each, everywhere")
    check(bool(same(lambda m: st(m)["look"]["theme"], "ristretto")), "the same look on all three")
    check(st(alpha)["look"]["theme"] == "ristretto", f"beta's, set last (alpha has {st(alpha)['look']['theme']})")
    check(bool(same(lambda m: st(m).get("alerts"), "all")), "beta's alerts too, set where nobody else had")

    print("a change on one machine, on the others in a moment")
    t0 = time.time()
    alpha.amarchy("theme", "catppuccin")
    check(bool(same(lambda m: st(m)["look"]["theme"], "catppuccin")),
          f"amarchy theme on alpha: on beta and gamma ({time.time() - t0:.1f} s)")
    code, _, _ = beta.ask("POST", "/api/new/model", {"model": "sonnet"})
    check(code == 200 and bool(same(lambda m: st(m).get("new_model"), "sonnet")),
          "a new chat's model, set in beta's app: on alpha and gamma")
    code, _, _ = gamma.ask("POST", "/api/new/effort", {"effort": "high"})
    check(code == 200 and bool(same(lambda m: st(m).get("new_effort"), "high")), "its effort, from gamma")
    for m in ms:
        (m.work / "site").mkdir(exist_ok=True)
    r = alpha.amarchy("projects", "order", "proj")
    check(bool(until(lambda: all((item(m, "project-order") or [])[:1] == ["proj"] for m in ms))), "the project order")
    code, _, _ = alpha.ask("POST", "/api/missions/goal", {"goal": 7})
    check(bool(same(lambda m: st(m)["missions"]["goal"], 7)), "the daily goal")
    code, _, _ = beta.ask("POST", "/api/terminals", {"on": True})
    check(bool(same(lambda m: st(m).get("show_terminals"), True)), "Show terminals")
    r = gamma.amarchy("machines", "show", "name")
    check(bool(same(lambda m: st(m).get("machines_as"), "name")), "machines shown by name")

    print("files: by their hash")
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
    code, _, said = alpha.ask("POST", "/api/look/wallpaper", {"phone": base64.b64encode(png).decode(), "wide": base64.b64encode(png + b"\0").decode()})
    check(code == 200, f"your own wallpaper, on alpha ({code})")
    own = lambda m: sorted(f.name for f in (m.home / "state/amarchy/app/theme").glob("own-*"))
    worn = lambda m: (json.loads((m.home / "state/amarchy/app/theme/choice.json").read_text()) or {}).get("wallpaper")
    check(bool(same(lambda m: (own(m), worn(m)), [own(alpha), "own"])) and len(own(gamma)) == 2,
          f"on beta and gamma: the same files, worn ({own(gamma)})")
    check((beta.home / "state/amarchy/app/theme" / own(alpha)[0]).read_bytes() == (alpha.home / "state/amarchy/app/theme" / own(alpha)[0]).read_bytes(),
          "byte for byte")
    wav = b"RIFF$\0\0\0WAVEfmt \x10\0\0\0\1\0\1\0D\xac\0\0\x88X\1\0\2\0\x10\0data\0\0\0\0"
    code, _, _ = beta.ask("POST", "/api/sound/add", {"name": "ding.wav", "data": base64.b64encode(wav).decode()})
    check(code == 200 and bool(until(lambda: (alpha.home / "config/amarchy/sounds/ding.wav").is_file()
                                     and (gamma.home / "config/amarchy/sounds/ding.wav").read_bytes() == wav, limit=20)),
          "a chime of yours, added on beta: on alpha and gamma")
    theme = gamma.home / "state/amarchy/app/custom/mine"
    theme.mkdir(parents=True)
    (theme / "theme.json").write_text(json.dumps({"name": "Mine", "mode": "dark", "vars": {"--accent": "#ff8800"}}))
    (theme / "wallpaper.png").write_bytes(png)
    check(bool(until(lambda: (alpha.home / "state/amarchy/app/custom/mine/wallpaper.png").read_bytes() == png, limit=20)),
          "a theme of yours, made on gamma: on alpha, whole")
    r = alpha.amarchy("theme", "mine")
    check(r.returncode == 0 and bool(same(lambda m: st(m)["look"]["theme"], "mine")),
          "worn on alpha: worn everywhere")

    print("missions: every machine's, once each")
    r = py(alpha, "am.mission_log({'kind': 'merge', 'id': 'proj-x', 'repo': 'proj', 'task': 'Fix: x', 'created': int(__import__('time').time()) - 300})")
    r2 = py(beta, "am.mission_log({'kind': 'merge', 'id': 'proj-y', 'repo': 'proj', 'task': 'Fix: y'})")
    check(r.returncode == r2.returncode == 0, f"a merge on alpha, one on beta ({r.stderr[-200:]}{r2.stderr[-200:]})")
    check(bool(same(lambda m: st(m)["missions"]["total"], 2, limit=30)),
          f"two on every machine's score (gamma: {st(gamma)['missions']['total']})")
    today = {x["id"] for x in st(beta)["missions"]["today"]}
    check(today == {"alpha:proj-x", "proj-y"}, f"beta names alpha's chat as alpha's ({sorted(today)})")
    time.sleep(SYNC_WAIT)
    for m in ms:
        m.ask("GET", "/api/state")
    check(st(alpha)["missions"]["total"] == 2, "still two after more syncs (none counted twice)")
    py(alpha, "am.mission_badge('clean')")
    check(bool(until(lambda: "clean" in json.loads((gamma.home / "state/amarchy/missions-badges.json").read_text() or "{}"), limit=20)),
          "a badge earned on alpha: on gamma")

    print("a machine off during a change")
    beta.stop()
    alpha.amarchy("alerts", "needs-you")
    ok_ = bool(until(lambda: st(gamma).get("alerts") == "needs-you", limit=20))
    if not ok_ and os.environ.get("SYNC_DEBUG"):
        for m in (alpha, gamma):
            print("   ", m.name, "alerts item:", json.loads((m.home / "state/amarchy/sync/items.json").read_text()).get("alerts"),
                  "file:", (m.home / "state/amarchy/alerts").read_text().strip() if (m.home / "state/amarchy/alerts").exists() else None,
                  "now:", time.time())
        print("    alpha's machines:", [(x["name"], x["on"]) for x in st(alpha)["machines"]])
    check(ok_, "gamma has it at once")
    beta.start()
    check(bool(until(lambda: st(beta).get("alerts") == "needs-you", limit=40)), "beta, back: has it too")

    print("off while the machine that changed it went away: through a third")
    gamma.stop()
    alpha.amarchy("theme", "nord")
    check(bool(until(lambda: st(beta)["look"]["theme"] == "nord", limit=20)), "beta has alpha's change")
    alpha.stop()
    gamma.start()
    check(bool(until(lambda: st(gamma)["look"]["theme"] == "nord", limit=40)), "gamma, back with alpha off: has it, from beta")
    alpha.start()

    print("two edits made apart: the later one, everywhere")
    MARKS = {}
    alpha.stop()
    MARKS["low"] = time.time()
    beta.ask("POST", "/api/new/effort", {"effort": "low"})
    time.sleep(1.5)
    beta.stop()
    gamma.stop()
    alpha.start()
    MARKS["max"] = time.time()
    alpha.ask("POST", "/api/new/effort", {"effort": "max"})      # later, made apart
    beta.start()
    gamma.start()
    ok_ = bool(same(lambda m: st(m).get("new_effort"), "max", limit=60))
    if not ok_ and os.environ.get("SYNC_DEBUG"):
        for m in ms:
            f = m.home / "state/amarchy/new-effort"
            print("   ", m.name, json.loads((m.home / "state/amarchy/sync/items.json").read_text()).get("new-effort"),
                  "file", f.read_text().strip(), f.stat().st_mtime)
        print("    marks:", MARKS)
    check(ok_,
          f"max (alpha's, later) on all three ({[st(m).get('new_effort') for m in ms]})")

    print("a reset: the same score everywhere")
    r = beta.amarchy("missions", "--reset")
    check(r.returncode == 0 and bool(same(lambda m: st(m)["missions"]["total"], 0, limit=30)), f"0 on every machine ({[st(m)['missions']['total'] for m in ms]})")
    check(bool(until(lambda: all(not any(b["at"] for b in st(m)["missions"]["badges"] if b["key"] == "clean") for m in ms), limit=20)),
          "the badges earned before it: gone everywhere")
    py(gamma, "am.mission_log({'kind': 'merge', 'id': 'proj-z', 'repo': 'proj', 'task': 'Fix: z'})")
    check(bool(until(lambda: all(st(m)["missions"]["total"] == 1 for m in ms), limit=30)), "a merge after it: counted, once, everywhere")

    print("per machine on purpose")
    code, _, _ = alpha.ask("POST", "/api/sleep", {"after": 42})
    time.sleep(SYNC_WAIT)
    check(st(alpha)["sleep_after"] == 42 and st(beta)["sleep_after"] != 42, f"when its chats sleep: alpha's own ({st(alpha)['sleep_after']}, beta {st(beta)['sleep_after']})")
finally:
    for m in ms:
        try:
            m.stop()
        except Exception:
            pass
        subprocess.run(["tmux", "-L", m.socket, "kill-server"], capture_output=True)
    if failed:
        for m in ms:
            log = (m.home / "server.log")
            if log.exists():
                print(f"--- {m.name}'s log\n" + log.read_text()[-2500:])
    shutil.rmtree(BASE, ignore_errors=True)

print(f"\n{'all passed' if not failed else f'{len(failed)} failed'}")
sys.exit(1 if failed else 0)
