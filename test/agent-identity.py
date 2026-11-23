# Who your agents are, without a browser (amarchy agents --emoji --tone): one
# emoji (a skin tone, a flag, a family, a keycap: one) and a tone in a line,
# kept with the agent (your assistant's in its own file), kept through a
# rename and carried when an agent becomes your assistant; --json and the
# list say them; off takes them away. Its Claude is handed who it is with its
# reply format, so at every start: the chat format, then its name, emoji and
# tone; until it has them, the bootstrap (offer three, save the one tapped).
# A change starts its Claude again (once idle) as who it is now; a chime
# doesn't. The list's rows carry the emoji (and an agent's tone); its
# notifications lead with the emoji (🔥 Calcifer). amarchy new --agent takes
# them from the start. Another machine's: amarchy agents --all, and
# <machine>:<id> through its app.
#
#   python3 test/agent-identity.py     exits 0 when every check passed

import importlib.machinery, importlib.util, io, json, os, shutil, subprocess, sys, tempfile, time
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path

home = tempfile.mkdtemp(prefix="agent-identity-")
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config", AMARCHY_WORK=home + "/Work")
for k in ("AMARCHY_SESSION", "AMARCHY_SENT_BY"):
    os.environ.pop(k, None)
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
def mk(sid, repo):
    am.write_file(am.SESSIONS / f"{sid}.json", json.dumps({"id": sid, "repo": repo, "name": sid.split("-", 1)[1], "branch": "b",
                                                           "path": f"{home}/nowhere/{sid}", "created": int(time.time()) - 3600}))
for sid, repo in [("jaken-jaken", "jaken"), ("fireship-fireship", "fireship"), ("fireship-ideas", "fireship"),
                  ("calcifer-calcifer", "calcifer"), ("proj-a", "proj")]:
    mk(sid, repo)

# ---- one emoji, a tone in a line
for e in ("🔥", "💀", "🐸", "❤️", "👍🏽", "🇨🇴", "👨‍👩‍👧", "1️⃣", "🏳️‍🌈", "☕", " 🔥 "):
    check(am.emoji_one(e) == e.strip(), f"one emoji: {e!r}")
for e in ("", "a", "ab", "🔥🔥", "a🔥", "🔥 💀", "fire", "字", "🇨", "👨‍", "x" * 20):
    check(am.emoji_one(e) is None, f"not one emoji: {e!r}")
check(am.tone_one("  proud,  grumpy\nfire demon ") == "proud, grumpy fire demon", "a tone: one line, its spaces tidied")
check(am.tone_one("x" * (am.TONE_MAX + 1)) is None and am.tone_one("x" * am.TONE_MAX), f"a tone: {am.TONE_MAX} characters at most")

# ---- set, listed, kept
reloads = []
am.detach = lambda argv: reloads.append(argv[2]) if argv[1] == "claude-reload" and argv[3:] == ["--asked"] else None
am.host_pane = lambda s: {"pid": 1}
run("assistant", "jaken-jaken")
run("agents", "fireship-fireship", "--name", "Hades")
run("agents", "calcifer-calcifer", "--name", "Calcifer")
reloads.clear()
rc, out, err = run("agents", "calcifer-calcifer", "--emoji", "🔥", "--tone", "proud, grumpy fire demon under contract")
check(rc == 0 and out.strip() == "calcifer-calcifer\t🔥 Calcifer\tproud, grumpy fire demon under contract", f"set: printed as listed ({out!r} {err!r})")
check(reloads == ["calcifer-calcifer"], f"its Claude started again (once idle) as who it is now ({reloads})")
rc, out, _ = run("agents", "jaken-jaken", "--emoji", "🐸", "--tone", "shrill, jealous, fiercely loyal")
check(rc == 0 and "\t🐸 Jaken\tshrill, jealous, fiercely loyal\t(your assistant)" in out, f"your assistant's the same way ({out!r})")
check(json.loads(am.ASSISTANT_FILE.read_text()) == {"id": "jaken-jaken", "name": "", "emoji": "🐸", "tone": "shrill, jealous, fiercely loyal"},
      "your assistant's: in its own file")
run("agents", "fireship-fireship", "--emoji", "💀", "--tone", "smooth-talking showman of the underworld")
rc, out, _ = run("agents", "--json")
rows = {r["id"]: r for r in json.loads(out)}
check(rows["calcifer-calcifer"]["emoji"] == "🔥" and rows["calcifer-calcifer"]["tone"] == "proud, grumpy fire demon under contract"
      and rows["jaken-jaken"]["emoji"] == "🐸" and rows["fireship-fireship"]["emoji"] == "💀", f"--json: each one's emoji and tone ({rows})")
check(all({"id", "name", "role", "repo", "sound", "picture", "emoji", "tone"} <= set(r) for r in rows.values()), "--json: what it had, and who it is")
rc, out, _ = run("agents")
check(out.splitlines() == ["jaken-jaken\t🐸 Jaken\tshrill, jealous, fiercely loyal\t(your assistant)",
                           "fireship-fireship\t💀 Hades\tsmooth-talking showman of the underworld",
                           "calcifer-calcifer\t🔥 Calcifer\tproud, grumpy fire demon under contract"], f"the list ({out!r})")
reloads.clear()
run("agents", "calcifer-calcifer", "--sound", "ocean")
check(reloads == [] and am.team()[2]["emoji"] == "🔥", f"a chime: who it is stays, its Claude left alone ({reloads})")
run("agents", "jaken-jaken", "--name", "Jake")
check(am.assistant()["emoji"] == "🐸" and am.assistant()["tone"], "your assistant renamed: who it is stays")
run("assistant", "jaken-jaken", "--name", "Jaken")
check(am.assistant()["emoji"] == "🐸" and am.assistant()["name"] == "Jaken", "renamed through amarchy assistant: the same")
for bad, why in ((["--emoji", "🔥🔥"], "one emoji"), (["--emoji", "x"], "one emoji"), (["--tone", "x" * 200], "characters at most"),
                 (["--tone", ""], "in a line")):
    rc, _, err = run("agents", "calcifer-calcifer", *bad)
    check(rc == 1 and why in err and am.team()[2]["emoji"] == "🔥", f"refused: {bad[0]} {bad[1][:8]!r} ({err.strip()})")
rc, _, err = run("agents", "--emoji", "🔥")
check(rc == 1, "--emoji without an agent: the usage")

# ---- started again: asked, whenever (once idle); one waiting at a time
am.write_file(am.claude_dir("calcifer-calcifer") / "format-reload", "x\n")      # one a minute ago
waits = []
am.time.sleep = lambda n: waits.append(n) or (_ for _ in ()).throw(StopIteration)
try:
    am.claude_reload("calcifer-calcifer")
except StopIteration:
    pass
check(waits == [], "the Stop hook's, a minute after the last: not again (no loop)")
try:
    am.claude_reload("calcifer-calcifer", asked=True)
except StopIteration:
    pass
check(waits == [5], "asked (who it is changed): it waits for its quiet moment, the last one just now or not")
import fcntl as _f
held = open(am.claude_dir("calcifer-calcifer") / "format-reload.lock", "a")
_f.flock(held, _f.LOCK_EX | _f.LOCK_NB)
waits.clear()
check(am.claude_reload("calcifer-calcifer", asked=True) == 0 and waits == [], "one waits already: it leaves it to that one")
held.close()
am.time.sleep = time.sleep

# ---- what its Claude is handed
fmt = am.reply_format(am.session("calcifer-calcifer"))
check(fmt.startswith(am.CHAT_FORMAT) and "you are Calcifer 🔥" in fmt and "proud, grumpy fire demon under contract" in fmt,
      "an agent's: the chat format, then who it is")
check("every message" in fmt and "Only the facts stay exact" in fmt and "amarchy agents calcifer-calcifer --emoji" in fmt,
      "in character in every message, the facts exact; how they change it")
check("Who you are" not in am.reply_format(am.session("proj-a")) and "Who you are" not in am.reply_format(am.session("fireship-ideas")),
      "a chat, an agent's project's too: nothing of it")
v1 = am.format_version(am.session("calcifer-calcifer"))
check(v1 == am.hashlib.sha1(fmt.encode()).hexdigest()[:10], "its version: the hash of what it's handed (claude_format_version reads it back)")
check(v1 != am.format_version(am.session("fireship-fireship")), "each agent's its own")
run("agents", "calcifer-calcifer", "--tone", "a fire demon, proud and grumpy")
check(am.format_version(am.session("calcifer-calcifer")) != v1, "a new tone: a new version (its Claude started again)")
argv = am.agent_argv(am.session("calcifer-calcifer"))
check("you are Calcifer 🔥" in argv[argv.index("--append-system-prompt") + 1], "its Claude starts with it")
check(len(am.IDENTITY_WORDS.format(name="Calcifer", emoji="🔥", tone="x" * am.TONE_MAX, max=am.TONE_MAX,
                                   set="amarchy agents calcifer-calcifer")) < 1400, "short: it's in every call")

# ---- without one yet: the bootstrap
reloads.clear()
rc, out, _ = run("agents", "calcifer-calcifer", "--emoji", "off", "--tone", "off")
check(rc == 0 and out.strip() == "calcifer-calcifer\tCalcifer" and reloads == ["calcifer-calcifer"], f"off: none, its Claude started again ({out!r})")
boot = am.reply_format(am.session("calcifer-calcifer"))
check(boot.startswith(am.CHAT_FORMAT) and "you don't have your emoji and your tone yet" in boot and 'question="Who should I be?"' in boot
      and "amarchy agents calcifer-calcifer --emoji" in boot and "not a timer, a script or another chat" in boot,
      "none: it offers three the next time you write it (a choices block), and saves the one tapped")
run("agents", "calcifer-calcifer", "--emoji", "🔥")
check("you don't have your emoji and your tone yet" in am.reply_format(am.session("calcifer-calcifer")),
      "an emoji alone: still the bootstrap (a tone too, to be someone)")
run("agents", "calcifer-calcifer", "--tone", "proud, grumpy fire demon under contract")

# ---- the list's rows, the notifications
view = am.session_view()
row = {s["id"]: s for s in view}
check(row["calcifer-calcifer"]["emoji"] == "🔥" and row["calcifer-calcifer"]["tone"].startswith("proud"), "its row: its emoji and tone")
check(row["fireship-ideas"]["emoji"] == "💀" and row["fireship-ideas"]["tone"] == "", "another chat of its project: under its emoji, not its tone")
check(row["proj-a"]["emoji"] == "" and row["proj-a"]["tone"] == "", "a chat: none")
am.save_session(dict(am.session("calcifer-calcifer"), emoji="x", tone="y"))
check("emoji" not in json.loads((am.SESSIONS / "calcifer-calcifer.json").read_text()), "the list's, never saved in its file")
crew = am.team()
cal = next(a for a in crew if a["id"] == "calcifer-calcifer")
check(am.team_title(cal) == "🔥 Calcifer", "a notification's title: its emoji first")
check(am.team_title(cal, "Card ready") == "🔥 Calcifer: Card ready", "with a title: after a colon")
check(am.team_title(cal, "Calcifer says hi") == "🔥 Calcifer says hi", "a title that names it: its emoji before it")
check(am.team_title(cal, "🔥 done") == "🔥 done", "one that leads with its emoji already: as it is")
check(am.team_title({"name": "Scout", "emoji": ""}, "Hi") == "Scout: Hi" and am.team_title({"name": None}) == "Your assistant",
      "without an emoji: as before")
sent = []
am.push_all = lambda payload, desktop=None: sent.append(payload) or 1
am.notified_anywhere = lambda: True
os.environ["AMARCHY_SESSION"] = "calcifer-calcifer"
run("notify", "Your build is done", "All green")
os.environ.pop("AMARCHY_SESSION")
check(sent and sent[-1]["title"] == "🔥 Calcifer: Your build is done", f"amarchy notify from it: under its emoji and name ({sent[-1:]})")
am.app_subscriptions = lambda: [{}]
am.board_notify({"id": "calcifer-calcifer", "lead": "calcifer-calcifer"}, {"id": "c1", "title": "Approve the post", "note": "n", "agent": "calcifer-calcifer"})
check(sent[-1]["title"] == "🔥 Calcifer: Approve the post", f"a card on your phones: the same ({sent[-1]['title']})")

# ---- made your assistant: it keeps who it is
run("assistant", "calcifer-calcifer")
check(am.assistant()["emoji"] == "🔥" and am.assistant()["tone"].startswith("proud") and am.assistant()["name"] == "Calcifer",
      "an agent made your assistant: by its name and who it is")
run("assistant", "jaken-jaken", "--name", "Jaken")
check(am.assistant()["emoji"] == "", "another one made your assistant: it picks who it is with you")
run("agents", "jaken-jaken", "--emoji", "🐸", "--tone", "shrill, jealous, fiercely loyal")
run("agents", "calcifer-calcifer", "--name", "Calcifer", "--emoji", "🔥", "--tone", "proud, grumpy fire demon under contract")

# ---- a new agent with who it is, or without
repo = Path(home) / "Work" / "inbox"
repo.mkdir(parents=True)
for cmd in (["init", "-q", "-b", "main"], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "Initial commit"]):
    subprocess.run(["git", *cmd], cwd=repo, check=True)
started = []
am.host_start = lambda s: started.append((s["id"], am.reply_format(am.session(s["id"]))))
am.agent_remember = lambda *a, **k: None
rc, out, err = run("new", "inbox", "owl", "--agent", "Owl", "--emoji", "🦉", "--tone", "wise, dry, a little smug")
check(rc == 0 and started and "you are Owl 🦉" in started[-1][1], f"made with who it is: its Claude starts as it ({err.strip()})")
rc, out, err = run("new", "inbox", "fox", "--agent", "Fox")
check(rc == 0 and "Who should I be?" in started[-1][1], "made without: the bootstrap")
rc, _, err = run("new", "inbox", "plain", "--emoji", "🦊")
check(rc == 1 and "go with --agent" in err, "--emoji for a chat that isn't an agent: refused")
rc, _, err = run("new", "inbox", "bad", "--agent", "Bad", "--emoji", "nope")
check(rc == 1 and "one emoji" in err, "--emoji that isn't one: refused")

# ---- another machine's
me = am.machine_name()
am.list_all = lambda: [{**s, "machine": me} for s in am.session_view()] + [
    {"id": "calcifer-calcifer", "machine": "ja", "assistant": "agent", "assistant_name": "Calcifer", "emoji": "🔥", "tone": "proud",
     "repo": "calcifer", "chime": "fairy", "picture": "62310b2f6206"},
    {"id": "ja-chat", "machine": "ja", "assistant": "", "assistant_name": "", "repo": "x"}]
rc, out, _ = run("agents", "--all", "--json")
rows = json.loads(out)
there = [r for r in rows if r.get("machine") == "ja"]
check(len(there) == 1 and there[0]["emoji"] == "🔥" and there[0]["picture"].endswith("/picture/62310b2f6206-512.png"),
      f"--all: every machine's agents, each with its machine ({there})")
check(all(r.get("machine") == me for r in rows if r["id"] == "jaken-jaken"), "this machine's: with its machine too")
rc, out, _ = run("agents", "--all")
check("ja:calcifer-calcifer\t🔥 Calcifer\tproud" in out, f"--all: listed as <machine>:<id> ({out!r})")
calls = []
am.machine_find = lambda name: {"name": name, "label": "Castle"} if name == "ja" else None
def peer_json(m, method, path, body=None, timeout=None):
    calls.append((method, path, body))
    if method == "POST":
        return 200, {}
    return 200, {"sessions": [{"id": "calcifer-calcifer", "assistant": "agent", "assistant_name": "Calcifer", "emoji": "🔥", "tone": "proud"}]}
am.peer_json = peer_json
rc, out, err = run("agents", "ja:calcifer-calcifer", "--emoji", "🔥", "--tone", "proud")
check(rc == 0 and calls[0] == ("POST", "/api/session/calcifer-calcifer/agent", {"emoji": "🔥", "tone": "proud"})
      and out.strip() == "ja:calcifer-calcifer\t🔥 Calcifer\tproud", f"<machine>:<id>: set through its app ({calls} {out!r} {err!r})")
rc, _, err = run("agents", "ja:calcifer-calcifer", "--sound", "ocean")
check(rc == 1 and "Castle's" in err, "its chime and picture: that machine's to set")
rc, _, err = run("agents", "nowhere:calcifer-calcifer", "--emoji", "🔥")
check(rc == 1 and "no machine nowhere" in err, "a machine that isn't paired: said so")
rc, out, _ = run("agents", f"{me}:calcifer-calcifer", "--emoji", "🔥")
check(rc == 0 and out.startswith("calcifer-calcifer\t🔥 Calcifer"), "this machine's own name: here")

shutil.rmtree(home, ignore_errors=True)
print(f"\n{len(failed)} failed" if failed else "\nAll passed")
sys.exit(1 if failed else 0)
