# Your agents, without a browser (amarchy agents): chats that live on, as
# your assistant does. None until you make one; made by its id, named after
# its project unless you name it, with a chime of its own nothing else rings
# with; renamed, given a picture (cut round, found by its hash, by its
# notifications) or a chime; your assistant's name, picture and chime set the
# same way; not an agent any more (its pictures gone), but your assistant
# never that way. The list: your assistant, your agents in the order made,
# then the rest; each one's role, name, picture and chime, another chat of an
# agent's project under its name. Always told (whatever amarchy alerts says);
# never a mission (closed, it isn't written down; its merges don't count);
# made your assistant, it's no longer an agent. A closed agent is left out.
#
#   python3 test/agents.py         exits 0 when every check passed

import importlib.machinery, importlib.util, io, json, os, shutil, subprocess, sys, tempfile, time
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path

home = tempfile.mkdtemp(prefix="agents-")
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config", AMARCHY_WORK=home + "/Work")
os.environ.pop("AMARCHY_SESSION", None)
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(Path(__file__).resolve().parent.parent / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failed.append(what)

def run(*args):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        rc = am.main(list(args))
    return rc, out.getvalue(), err.getvalue()

am.SESSIONS.mkdir(parents=True, exist_ok=True)
def mk(sid, repo, **more):
    am.write_file(am.SESSIONS / f"{sid}.json", json.dumps({"id": sid, "repo": repo, "name": sid.split("-", 1)[1], "branch": "b",
                                                           "path": f"{home}/nowhere/{sid}", "created": int(time.time()) - 3600, **more}))
for sid, repo in [("jaken-jaken", "jaken"), ("fireship-fireship", "fireship"), ("fireship-ideas", "fireship"),
                  ("scout-scout", "scout"), ("proj-a", "proj"), ("proj-b", "proj")]:
    mk(sid, repo)

rc, out, _ = run("agents")
check(rc == 0 and out.strip() == "none" and am.team() == [], f"none at first ({out.strip()!r})")

# Your assistant, then an agent: named after its project, a chime of its own.
run("assistant", "jaken-jaken")
rc, out, _ = run("agents", "fireship-fireship")
check(rc == 0 and out.strip() == "fireship-fireship\tFireship", f"made an agent, named after its project ({out.strip()!r})")
crew = am.team()
check([(a["id"], a["role"]) for a in crew] == [("jaken-jaken", "main"), ("fireship-fireship", "agent")], f"the team: your assistant first ({crew})")
fire = crew[1]
check(fire["sound"] not in (am.sound_name(), am.assistant_sound_name()) and fire["sound"] in am.AGENT_CHIMES,
      f"its chime: one nothing else rings with ({fire['sound']})")
run("agents", "scout-scout", "--name", "Scout")
scout = am.team()[2]
check(scout["name"] == "Scout" and scout["sound"] not in (fire["sound"], am.sound_name(), am.assistant_sound_name()),
      f"another: by the name given, another chime ({scout})")
rc, out, _ = run("agents", "fireship-fireship", "--name", "Fire Ship", "--sound", "Tine")
check(rc == 0 and am.team()[1]["name"] == "Fire Ship" and am.team()[1]["sound"] == "tine", "renamed, its chime picked (any case)")
rc, _, err = run("agents", "fireship-fireship", "--sound", "nope")
check(rc == 1 and "no sound" in err, "a chime there isn't: refused")
rc, _, err = run("agents", "nope-nope")
check(rc == 1 and "No session" in err, "a session there isn't: refused")
rc, _, err = run("agents", "fireship-fireship", "--bogus")
check(rc == 1 and "unknown option" in err, "an option it doesn't know: refused before it acts")
rc, out, _ = run("agents", "--json")
rows = json.loads(out)
check([r["id"] for r in rows] == ["jaken-jaken", "fireship-fireship", "scout-scout"] and rows[0]["role"] == "main" and rows[1]["sound"] == "tine",
      f"--json: each, with its role and chime ({rows})")
# Your assistant's through amarchy agents too.
rc, out, _ = run("agents", "jaken-jaken", "--name", "Jake", "--sound", "ocean")
check(rc == 0 and am.assistant()["name"] == "Jake" and am.assistant_sound_name() == "ocean" and "(your assistant)" in out,
      "your assistant's name and chime, set the same way")
run("agents", "jaken-jaken", "--name", "Jaken")

# The list: roles, names, order, chimes.
ss = [dict(s, status="idle") for s in am.sessions()]
crew = am.team()
for s in ss:
    s["assistant"], who = am.team_of(s, crew)
    s["assistant_name"] = who["name"] if who else ""
roles = {s["id"]: (s["assistant"], s["assistant_name"]) for s in ss}
check(roles == {"jaken-jaken": ("main", "Jaken"), "fireship-fireship": ("agent", "Fire Ship"), "fireship-ideas": ("near", "Fire Ship"),
                "scout-scout": ("agent", "Scout"), "proj-a": ("", ""), "proj-b": ("", "")}, f"each one's role and name ({roles})")
ranks = {a["id"]: i for i, a in enumerate(crew)}
for s in ss:
    s["priority"] = "high" if s["id"] == "proj-b" else "normal"
order = [s["id"] for s in sorted(ss, key=lambda s: am.session_order(s, ranks))]
check(order[:4] == ["jaken-jaken", "fireship-fireship", "scout-scout", "proj-b"], f"your assistant, your agents as made, then what you pinned ({order})")

# Always told, whatever amarchy alerts lets through; never a mission.
am.write_file(am.ALERTS_FILE, "assistant\n")
row = {"id": "fireship-fireship", "repo": "fireship", "assistant": "agent"}
check(am.alert_kind(row, "waiting", "working") == "assistant", "an agent that needs you: always told")
check(am.alert_kind({"id": "proj-a", "repo": "proj", "assistant": ""}, "waiting", "working") is None, "a chat, with alerts on your team alone: not")
check(am.alert_kind({"id": "fireship-fireship", "repo": "fireship"}, "waiting", "working") == "assistant", "an agent's file (no list row): always told too")
am.MISSIONS.parent.mkdir(parents=True, exist_ok=True)
am.MISSIONS.write_text("")
am.mission_done(am.session("fireship-fireship"))
am.mission_done(am.session("jaken-jaken"))
check(am.MISSIONS.read_text() == "", "an agent closed, your assistant closed: not written down as missions")
check(am.is_agent(am.session("scout-scout")) and am.is_agent(am.session("jaken-jaken")) and not am.is_agent(am.session("fireship-ideas")),
      "is_agent: your assistant and your agents, not the chats of their projects")
seen = []
am.merge_found = lambda s, *a: seen.append(s["id"]) or []
Path(home, "Work", "fireship").mkdir(parents=True, exist_ok=True)
Path(home, "Work", "proj").mkdir(parents=True, exist_ok=True)
for sid in ("fireship-fireship", "proj-a"):
    Path(am.session(sid)["path"]).mkdir(parents=True, exist_ok=True)
am.merge_scan([am.session("fireship-fireship"), am.session("proj-a")], use_gh=False)
check(seen == ["proj-a"], f"its merges aren't looked for: they don't count ({seen})")

# Its picture: cut round, found by its hash, by its notifications; off, gone.
if shutil.which("ffmpeg") or shutil.which("magick"):
    pic = Path(home, "pic.png")
    if shutil.which("ffmpeg"):
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=orange:s=300x200", "-frames:v", "1", str(pic)], check=True)
    else:
        subprocess.run(["magick", "-size", "300x200", "xc:orange", str(pic)], check=True)
    rc, _, err = run("agents", "fireship-fireship", "--picture", str(pic))
    big, small = am.agent_picture("fireship-fireship"), am.agent_picture("fireship-fireship", small=True)
    check(rc == 0 and big.is_file() and small.is_file() and am.image_kind(big.read_bytes()) == "png", f"its picture, cut ({err.strip()})")
    sig = am.picture_sig(big)
    check(am.picture_by_sig(sig, small=True) == small and am.picture_by_sig(sig, small=False) == big, "found by its hash")
    check(am.picture_by_sig("0" * 12, small=True) is None, "a hash there isn't: none")
    fire = next(a for a in am.team() if a["id"] == "fireship-fireship")
    check(am.team_icon(fire) == f"/picture/{sig}-192.png", "by its notifications")
    check(am.team_icon(am.team()[0]) == "/assistant-192.png", "your assistant's, amarchy's own still")
    rc, _, _ = run("agents", "fireship-fireship", "--picture", str(pic), "--crop", "0,0,500")
    check(rc == 1, "a crop past its edge: refused")
    run("agents", "fireship-fireship", "--picture", "off")
    check(not big.exists() and not small.exists() and am.team_icon(fire) == "/assistant-192.png", "off: gone, amarchy's own by its notifications")
    run("agents", "scout-scout", "--picture", str(pic))
else:
    print("  (no ffmpeg or ImageMagick: its picture not tried)")

# Not an agent any more; your assistant never that way; one made your assistant.
rc, _, err = run("agents", "jaken-jaken", "off")
check(rc == 1 and "amarchy assistant off" in err, "your assistant: not with agents off")
rc, _, err = run("agents", "proj-a", "off")
check(rc == 1 and "isn't one of your agents" in err, "a chat that isn't one: said so")
rc, out, _ = run("agents", "scout-scout", "off")
check(rc == 0 and [a["id"] for a in am.team()] == ["jaken-jaken", "fireship-fireship"], "Scout: a chat like the others again")
check(not am.agent_picture("scout-scout").exists(), "its picture gone with it")
rc, out, _ = run("assistant", "fireship-fireship")
check(rc == 0 and out.strip() == "fireship-fireship\tFire Ship" and [a["id"] for a in am.team()] == ["fireship-fireship"],
      f"an agent made your assistant: it is that now, by its name, and not an agent too ({out.strip()!r}, {am.team()})")
run("assistant", "jaken-jaken", "--name", "Jaken")
run("agents", "fireship-fireship")

# Closed: left out (made again under its id, an agent again, as your assistant is).
(am.SESSIONS / "fireship-fireship.json").unlink()
check([a["id"] for a in am.team()] == ["jaken-jaken"], "a closed agent: left out")
mk("fireship-fireship", "fireship")
check([a["id"] for a in am.team()] == ["jaken-jaken", "fireship-fireship"], "made again under its id: back")

# The app's sounds: each agent's.
check(am.app_sounds()["agent_sounds"] == {"fireship-fireship": am.team()[1]["sound"]}, "the app's sounds: each agent's chime")

# A new chat that's an agent from its start (amarchy new --agent, the app's
# New agent): written down before its Claude starts, so it starts writing as
# someone you text; a chat already there isn't made one by surprise.
repo = Path(home) / "Work" / "inbox"
repo.mkdir(parents=True)
for cmd in (["init", "-q", "-b", "main"], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "Initial commit"]):
    subprocess.run(["git", *cmd], cwd=repo, check=True)
started = []
am.host_start = lambda s: started.append((s["id"], am.reply_format(am.session(s["id"]))))
am.agent_remember = lambda *a, **k: None
rc, out, err = run("new", "inbox", "watcher", "--agent", "Inbox", "--prompt", "Keep my inbox at zero")
sid = out.strip()
check(rc == 0 and sid == "inbox-watcher", f"made: its id ({out.strip()!r} {err.strip()!r})")
inbox = next((a for a in am.team() if a["id"] == sid), None)
check(inbox and inbox["role"] == "agent" and inbox["name"] == "Inbox", f"one of your agents, called that ({inbox})")
check(inbox and inbox["sound"] not in {a["sound"] for a in am.team() if a["id"] != sid}, "with a chime of its own")
check(started == [(sid, am.CHAT_FORMAT)], "its Claude starts writing as someone you text")
check(am.session(sid).get("prompt") == "Keep my inbox at zero", "its job: its first message")
rc, _, err = run("new", "inbox", "watcher", "--agent", "Other")
check(rc == 1 and "amarchy agents" in err and am.team()[-1]["name"] == "Inbox", "a chat already there: not made one by surprise")
rc, _, err = run("new", "inbox", "--agent", "x" * 41)
check(rc == 1 and "40 characters" in err, "a name too long: refused")
rc, _, err = run("new", "inbox", "--agent")
check(rc == 1, "--agent with no name: refused")

shutil.rmtree(home, ignore_errors=True)
print(f"\n{len(failed)} failed" if failed else "\nAll passed")
sys.exit(1 if failed else 0)
