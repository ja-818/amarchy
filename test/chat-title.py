# A new chat is named from its first message as that goes in, not once its
# first turn ends: it's at work on it (At work, on the board), perhaps for
# half an hour, and its card says what about from the start, not "New chat".
# The name is kept for its conversation once that's there (a moment later,
# as its Claude takes the message), so it's the same asleep. A slash command
# or a picture alone isn't what it's about; Haiku failing is tried again with
# the next message; a conversation that has a name keeps it, unasked.
#
# Deterministic: a fake Haiku (conversation_title) and a fake Claude's stdin,
# without a browser.
#
#   python3 test/chat-title.py          exits 0 when every check passed

import importlib.machinery, importlib.util, io, json, os, sys, tempfile, threading, time, uuid
from pathlib import Path

home = tempfile.mkdtemp(prefix="chat-title-")
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config")
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(Path(__file__).resolve().parent.parent / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)

# The pane's title (what the list reads, host_titles) goes to the broker's
# stdout: kept here, the checks said on the real one.
pane, real_out = io.StringIO(), sys.stdout
sys.stdout = pane

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}", file=real_out, flush=True)
    if not ok:
        failed.append(what)

def until(f, wait=3):
    end = time.time() + wait
    while time.time() < end:
        if f():
            return True
        time.sleep(0.02)
    return bool(f())

asked = []          # what Haiku was asked to name
answer = {"title": "Name chats before they reach At work", "slow": 0.2}
def haiku(text):
    asked.append(text)
    time.sleep(answer["slow"])
    return answer["title"]
am.conversation_title = haiku

for d in (am.SESSIONS, am.STATUS):
    d.mkdir(parents=True, exist_ok=True)

def chat(name):
    sid = f"proj-{name}"
    wt = Path(home) / name
    wt.mkdir()
    s = {"id": sid, "repo": "proj", "name": name, "branch": name, "path": str(wt), "engine": "chat"}
    (am.SESSIONS / f"{sid}.json").write_text(json.dumps(s))
    am.claude_dir(sid).mkdir(parents=True, exist_ok=True)
    agent = am.Agent(s)
    agent.live["state"] = "idle"
    agent.changed = lambda *a, **k: None    # (no app to tell)
    fed = io.StringIO()
    agent.claude = type("C", (), {"stdin": fed})()
    return s, agent, fed

def conversation(s, *said):
    """Its Claude takes the message: the conversation it's in, and its file."""
    cid = str(uuid.uuid4())
    am.set_conversation_id(s["id"], cid)
    f = am.projects_dir(s["path"]) / f"{cid}.jsonl"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("".join(json.dumps({"type": "user", "message": {"role": "user", "content": t}}, separators=(",", ":")) + "\n"
                         for t in said))      # (as Claude writes it: compact)
    return cid, f

def turn_ends(agent):
    agent.handle({"type": "result", "subtype": "success", "is_error": False, "duration_ms": 1, "session_id": "", "result": "ok"})

def kept(s):
    try:
        return json.loads((am.claude_dir(s["id"]) / "title").read_text())
    except (OSError, ValueError):
        return None

FIRST = ("The first time the chat gets inside At work it gets really hard to understand what is happening, "
         "because we need to see the title of the chat.")

# ---- a new chat: named as its first message goes in
s, agent, fed = chat("new")
agent.send(FIRST)
check(agent.busy and agent.live["turn"], "its first message is in: its turn under way")
check(until(lambda: agent.live["title"] == answer["title"]), f"named while that turn works, no result yet ({agent.live['title']!r})")
check(agent.busy, "(its turn still under way)")
check(asked == [FIRST], f"named from what you said ({asked})")
check(f"\033]0;{answer['title']}\007" in pane.getvalue(), "the pane's title, which the list reads (host_titles)")
time.sleep(0.6)
check(kept(s) is None, "not kept yet: its conversation isn't there")
cid, f = conversation(s, FIRST)
check(until(lambda: kept(s) is not None), "kept as soon as its conversation is there")
check(kept(s) == {"conversation": cid, "title": answer["title"]}, f"kept for that conversation ({kept(s)})")
check(am.claude_title(am.session(s["id"]), "") == answer["title"], "asleep (no pane title), the list has it the same (saved_title)")
turn_ends(agent)
agent.send("And the phone too")
turn_ends(agent)
time.sleep(0.4)
check(asked == [FIRST], "named once: not again with the next message, nor at the turn's end")

# ---- a slash command, or a picture alone, isn't what it's about
s, agent, fed = chat("command")
asked.clear()
agent.send("<command-name>/model</command-name><command-args>opus</command-args>")
turn_ends(agent)
agent.send([{"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "iVBOR"}}])
turn_ends(agent)
time.sleep(0.4)
check(not asked and agent.live["title"] is None and not agent.titled, "a slash command or a picture alone: not named from them, still to be")
agent.send("Fix the board's order")
check(until(lambda: agent.live["title"] == answer["title"]) and asked == ["Fix the board's order"],
      f"named from the first words you said ({asked})")

# ---- Haiku failing: tried again with the next message
s, agent, fed = chat("fails")
asked.clear()
answer["title"] = None
agent.send("Make the tour shorter")
check(until(lambda: asked and not agent.titled), "Haiku gave nothing: no name, to be tried again")
check(asked == ["Make the tour shorter"] * 2, f"(asked once more first: it may fail once) ({asked})")
answer["title"] = "Make the tour shorter"
agent.send("The tour, I mean")      # (waits for the turn under way)
time.sleep(0.3)
check(len(asked) == 2, "(not while it waits)")
turn_ends(agent)
check(until(lambda: agent.live["title"] == "Make the tour shorter"), "named as the turn ends and the next message goes in")
check(asked == ["Make the tour shorter"] * 3, f"from the first thing said, still ({asked})")

# ---- its Claude starting: nothing said yet, then the first message
s, agent, fed = chat("starting")
asked.clear()
answer["title"] = "Start the agents' board"
agent.name_soon()               # (Agent.run, before any message: the name it has already)
check(until(lambda: not agent.titled), "nothing said yet, no conversation: nothing to name it from, yet")
check(not asked, "(Haiku not asked)")
agent.send("Start the agents' board")
check(until(lambda: agent.live["title"] == "Start the agents' board"), "named as the first message goes in")

# ...or the first message as its Claude starts: one name, made from it.
s, agent, fed = chat("racing")
asked.clear()
answer.update(title="Racing start", slow=0.05)
go = threading.Barrier(2)
def start():
    go.wait()
    agent.name_soon()
t = threading.Thread(target=start)
t.start()
go.wait()
agent.send("Racing start")
t.join()
check(until(lambda: agent.live["title"] == "Racing start"), "a message as its Claude starts: named from it")
check(asked == ["Racing start"], f"once ({asked})")

# ---- named by its Claude while Haiku thinks (/rename): that name stays
s, agent, fed = chat("renamed")
asked.clear()
answer.update(title="Haiku's name", slow=0.5)
agent.send("Rename it as I go")
check(until(lambda: asked), "(Haiku asked)")
agent.handle({"type": "system", "subtype": "session_title_changed", "title": "Your name for it"})
time.sleep(0.8)
check(agent.live["title"] == "Your name for it" and kept(s) is None, f"yours stays, Haiku's isn't put over it ({agent.live['title']!r})")
answer["slow"] = 0.05

# ---- a conversation that has a name keeps it: Haiku isn't asked
s, agent, fed = chat("named")
asked.clear()
cid, f = conversation(s, "Old words")
with open(f, "a") as fh:
    fh.write(json.dumps({"type": "custom-title", "customTitle": "Your own name for it"}) + "\n")
agent.name_soon("New words")
check(until(lambda: agent.live["title"] == "Your own name for it"), "the name it has (yours, /rename)")
s, agent, fed = chat("ours")
cid, f = conversation(s, "Old words")
am.write_file(am.claude_dir(s["id"]) / "title", json.dumps({"conversation": cid, "title": "Ours from before"}))
agent.send("Carry on")
check(until(lambda: agent.live["title"] == "Ours from before"), "the one amarchy gave it before (asleep, woken)")
check(not asked, f"neither asks Haiku ({asked})")

# ...and one with no name: from its first words, not from what woke it.
s, agent, fed = chat("unnamed")
answer.update(title="Old words, named")
cid, f = conversation(s, "<command-name>/clear</command-name>", "Old words")
agent.send("Carry on")
check(until(lambda: agent.live["title"] == "Old words, named"), "a conversation with no name: named")
check(asked == ["Old words"], f"from its first words, not what woke it ({asked})")
check(until(lambda: kept(s) == {"conversation": cid, "title": "Old words, named"}), "and kept for it at once")

sys.stdout = real_out
print(f"\n{'FAILED: ' + str(len(failed)) if failed else 'all passed'}")
sys.exit(1 if failed else 0)
