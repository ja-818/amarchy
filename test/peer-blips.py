# A machine that restarts or drops off the network a moment is never "off"
# (docs/plan-omarchy-and-machines.md, "Chats from every machine"), and what
# you send its chats meanwhile is never lost: two real servers (alpha shows
# beta's chats; test/two_machines.py), alpha's board watched five times a
# second throughout.
#
#   - beta's app server restarted five times in a row (as a ship does),
#     alpha's stream on it cut each time: beta never off on alpha's board, its
#     chats never marked off; a message sent through alpha while it's down
#     waits there and arrives;
#   - beta frozen 10 s (a network drop: its connections open, nothing comes):
#     never off;
#   - beta down for good: off once it's been out of reach a while
#     (AMARCHY_PEER_OFF_AFTER); a message sent then waits (the board lists
#     it), another is taken back (Cancel), and the one left arrives once beta's
#     back, once.
#
#   python3 test/peer-blips.py        exits 0 when every check passed (a couple of minutes)

import json, os, signal, subprocess, sys, threading, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from two_machines import *      # Machine, until, check, failed

OFF_AFTER = 20
alpha, beta = Machine("alpha"), Machine("beta")
for m in (alpha, beta):
    m.env["AMARCHY_PEER_OFF_AFTER"] = str(OFF_AFTER)

seen_off = []           # (when, what) beta was ever shown off on alpha's board while it mustn't be
watching = threading.Event()


def watch():
    while True:
        if watching.is_set():
            try:
                v = alpha.state()
                mb = next((m for m in v["machines"] if m["name"] == "beta"), None)
                rows = [s for s in v["sessions"] if s.get("machine") == "beta"]
                if mb and (not mb["on"] or any(s.get("machine_off") for s in rows)):
                    seen_off.append((round(time.time(), 1), mb.get("error")))
            except Exception:
                pass
        time.sleep(0.2)


def got(m, chat_path):
    try:
        return (Path(chat_path) / "got.txt").read_text()
    except OSError:
        return ""


try:
    alpha.start(); beta.start()
    check(alpha.amarchy("machines", "add", beta.url).returncode == 0, "alpha pairs with beta")
    sid = beta.amarchy("new", "proj", "one").stdout.strip()
    row = until(lambda: next((s for s in alpha.state()["sessions"] if s.get("machine") == "beta" and s["id"] == sid and not s.get("setup")), None), limit=30)
    check(bool(row), "beta's chat on alpha's board")
    chat = row["path"] if row else ""
    threading.Thread(target=watch, daemon=True).start()
    watching.set()

    print("beta restarted five times in a row")
    sent = []
    for i in range(5):
        beta.stop()
        t0 = time.time()
        if i == 2:      # a message while it's down
            code, _, said = alpha.ask("POST", f"/api/m/beta/api/session/{sid}/send", {"text": "sent while beta restarts"})
            sent.append((code, said))
        time.sleep(1.5)
        beta.start()
        check(bool(until(lambda: any(m["name"] == "beta" and m["on"] and not m.get("reconnecting") for m in alpha.state()["machines"]), limit=20)),
              f"restart {i + 1}: beta back on alpha's board ({time.time() - t0:.1f} s)")
    check(not seen_off, f"never off meanwhile ({seen_off[:3]})")
    code, said = sent[0]
    check(code == 202 and (said.get("waits") or {}).get("label") == "beta", f"the message sent while it was down: kept on alpha, waiting ({code} {said})")
    check(bool(until(lambda: "sent while beta restarts" in got(beta, chat), limit=30)), "and it arrived once beta was back")
    check(got(beta, chat).count("sent while beta restarts") == 1, "once")
    check(bool(until(lambda: not alpha.state().get("outbox"), limit=10)), "nothing left waiting")

    print("beta frozen 10 s (a network drop)")
    os.killpg(beta.proc.pid, signal.SIGSTOP)
    time.sleep(10)
    os.killpg(beta.proc.pid, signal.SIGCONT)
    check(bool(until(lambda: any(m["name"] == "beta" and m["on"] and not m.get("reconnecting") for m in alpha.state()["machines"]), limit=30)),
          "back on alpha's board")
    check(not seen_off, f"never off meanwhile ({seen_off[:3]})")

    print("beta down for good: off after a while, what you send waits")
    watching.clear()
    beta.stop()
    t0 = time.time()
    off = until(lambda: any(m["name"] == "beta" and not m["on"] for m in alpha.state()["machines"]), limit=OFF_AFTER + 30)
    took = time.time() - t0
    check(bool(off) and took >= OFF_AFTER - 2, f"off after {took:.0f} s out of reach (not before {OFF_AFTER} s)")
    check(all(s.get("machine_off") for s in alpha.state()["sessions"] if s.get("machine") == "beta"), "its chats marked off")
    code, _, said = alpha.ask("POST", f"/api/m/beta/api/session/{sid}/send", {"text": "sent while beta is off"})
    check(code == 202, f"a message to it: kept, waiting ({code})")
    code, _, said2 = alpha.ask("POST", f"/api/m/beta/api/session/{sid}/send", {"text": "taken back"})
    waiting = alpha.state().get("outbox") or []
    check(len(waiting) == 2 and waiting[0]["chat"] == f"beta:{sid}" and waiting[0]["text"] == "sent while beta is off",
          f"the board lists both, in order ({[w['text'] for w in waiting]})")
    code, _, _ = alpha.ask("POST", "/api/outbox/cancel", {"id": said2["waits"]["id"]})
    check(code == 200 and [w["text"] for w in alpha.state().get("outbox") or []] == ["sent while beta is off"], "one taken back (Cancel)")
    code, _, _ = alpha.ask("POST", "/api/outbox/cancel", {"id": said2["waits"]["id"]})
    check(code == 404, "taken back twice: it's gone already")
    beta.start()
    check(bool(until(lambda: "sent while beta is off" in got(beta, chat), limit=40)), "beta back: the one left arrives")
    time.sleep(3)
    check("taken back" not in got(beta, chat) and got(beta, chat).count("sent while beta is off") == 1, "once, and not the one taken back")
    check(not alpha.state().get("outbox"), "nothing left waiting")
finally:
    watching.clear()
    for m in (alpha, beta):
        try:
            m.stop()
        except Exception:
            pass
        subprocess.run(["tmux", "-L", m.socket, "kill-server"], capture_output=True)
    if failed:
        for m in (alpha, beta):
            log = m.home / "server.log"
            if log.exists():
                print(f"--- {m.name}'s log\n" + log.read_text()[-2000:])
    shutil.rmtree(BASE, ignore_errors=True)

print(f"\n{'all passed' if not failed else f'{len(failed)} failed'}")
sys.exit(1 if failed else 0)
