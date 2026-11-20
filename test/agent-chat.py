# Your assistant's and your agents' chats as a messaging app's, without a
# browser. Their Claude writes as someone you text (CHAT_FORMAT: short
# messages, no brief, no sections, no goal), every other chat in the reply
# format; the turn's check asks an agent only for blocks it can't draw, never
# for a shape or a goal. What a script, a timer or another chat sent it
# (amarchy send) is told apart from what you said (app_items "from"), but a
# button of yours (a task's, a loop's) is yours. How many of its messages you
# haven't read: those since you last looked (last_words, unread), none while
# it's on your screen; the app's badge counts them with what needs you.
#
#   python3 test/agent-chat.py         exits 0 when every check passed

import importlib.machinery, importlib.util, io, json, os, shutil, sys, tempfile, time
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path

home = tempfile.mkdtemp(prefix="agent-chat-")
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
for sid, repo in [("jaken-jaken", "jaken"), ("scout-scout", "scout"), ("scout-ideas", "scout"), ("proj-a", "proj")]:
    mk(sid, repo)
run("assistant", "jaken-jaken")
run("agents", "scout-scout", "--name", "Scout")
S = {sid: am.session(sid) for sid in ("jaken-jaken", "scout-scout", "scout-ideas", "proj-a")}

# ---- the format each one's Claude writes in
check(am.reply_format(S["scout-scout"]) == am.CHAT_FORMAT and am.reply_format(S["jaken-jaken"]) == am.CHAT_FORMAT,
      "your assistant and your agents: the chat format")
check(am.reply_format(S["proj-a"]) == am.REPLY_FORMAT and am.reply_format(S["scout-ideas"]) == am.REPLY_FORMAT,
      "every other chat (an agent's project's too): the reply format")
check(am.format_version(S["scout-scout"]) == am.CHAT_VERSION != am.FORMAT_VERSION == am.format_version(S["proj-a"]), "each its own version")
check(am.CHAT_FORMAT.startswith("amarchy shows") and am.REPLY_FORMAT.startswith("amarchy shows"),
      "both read back from a running Claude's arguments (claude_format_version)")
argv = am.agent_argv(S["scout-scout"])
check(argv[argv.index("--append-system-prompt") + 1] == am.CHAT_FORMAT, "an agent's Claude starts with it")
argv = am.agent_argv(S["proj-a"])
check(argv[argv.index("--append-system-prompt") + 1] == am.REPLY_FORMAT, "a chat's with the reply format")
cf = am.CHAT_FORMAT
check("WhatsApp" in cf and "no brief" in cf and "no goal block" in cf and "```brief" not in cf and "```goal" not in cf,
      "the chat format: texting, no brief or goal block to write")
check("```whatsapp" in cf and "```link" in cf and "```choices" in cf and "```xpost" in cf, "its blocks are there, as the reply format's")
check("just ask it" in cf and "Any question you ask them" not in cf, "a question: a choices block only when it has a few clear answers")
check("several short messages" in cf and "A line holding only ---" in cf and f"at most {am.CHAT_MESSAGE_MAX} words" in cf,
      "several short messages, a --- between two, each short")
check("superpowers" in cf and "a table for side-by-side data" in cf, "WhatsApp with superpowers: markdown, tables, blocks")
check("amarchy task add" in cf and "amarchy new" in cf, "what's for later on Tasks; real work in a chat of its own")

# ---- its messages: split at ---, each short
check(am.chat_messages("Moved to 4.\n---\nWant the deck?\n```command\n---\n```\n---\n\n ---\nOk") ==
      ["Moved to 4.", "Want the deck?\n```command\n---\n```", "Ok"], "its messages: split at a line of ---, not in a block, none empty")

# ---- the turn's check: an agent's blocks and its messages' size
LONG = "The search page works. " + " ".join(["It filters as you type and shows everything when the search is empty."] * 12)
ask = am.reply_fix({"last_assistant_message": LONG}, chat=True) or ""
check(ask.startswith(am.FIX_MARK) and "Split it into short messages" in ask, "an agent's wall of text: sent back, to split it")
SPLIT = "\n---\n".join(["It filters as you type and shows everything when the search is empty."] * 6)
check(am.reply_fix({"last_assistant_message": SPLIT}, chat=True) is None, "the same words as short messages: fine")
TABLE = "Here they are:\n\n| Post | Likes |\n|---|---|\n" + "\n".join(f"| Post number {i} about the launch | {i} |" for i in range(20))
check(am.reply_fix({"last_assistant_message": TABLE}, chat=True) is None, "a big table in a message: fine (it isn't words to read)")
check("has a heading" in (am.reply_fix({"last_assistant_message": "## Today\nTwo posts."}, chat=True) or ""), "a heading: sent back")
check(am.reply_fix({"last_assistant_message": "Done, posted it."}, chat=True) is None, "no goal block: fine")
bad = "Here:\n\n```event title=\"Call\" when=\"someday\"\nx\n```"
ask = am.reply_fix({"last_assistant_message": bad}, chat=True)
check(bool(ask) and ask.startswith(am.FIX_MARK), "a block it can't draw: sent back, as any chat's")
check((am.reply_fix({"last_assistant_message": LONG}) or "").startswith(am.FIX_MARK), "a working chat's long reply: sent back for its shape")
check(am.reply_fix({"last_assistant_message": "Done."}) == am.GOAL_ASK, "and for its goal block")

# ---- who sent it: amarchy send, not you
am.send_later = lambda sid, f: True      # (nothing to deliver it to here)
rc, _, err = run("send", "scout-scout", "Ritual (automatic timer): run the hunt", "--no-wait")
check(rc == 0, f"a timer's message sent ({err.strip()})")
os.environ["AMARCHY_SESSION"] = "proj-a"
run("send", "scout-scout", "Mission report: posted", "--no-wait")
os.environ["AMARCHY_SENT_BY"] = "you"
run("send", "scout-scout", "Replied to https://x.com/a/1", "--no-wait")
os.environ.pop("AMARCHY_SENT_BY")
os.environ["AMARCHY_SESSION"] = "scout-scout"
run("send", "scout-scout", "Remind me: stretch", "--no-wait")
os.environ.pop("AMARCHY_SESSION")
led = am.sent_by_read("scout-scout")
check([e["from"] for e in led] == ["", "proj-a", ""], f"what a timer, another chat and itself sent, written down; your button not ({[e['from'] for e in led]})")
now = time.time()
iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(t))
def user(text, t, uid):
    return {"type": "user", "uuid": uid, "timestamp": iso(t), "message": {"role": "user", "content": text}}
def said(text, t, uid):
    return {"type": "assistant", "uuid": uid, "timestamp": iso(t), "message": {"role": "assistant", "content": [{"type": "text", "text": text}]}}
recs = [user("Ritual (automatic timer):   run the hunt", now + 2, "u1"), user("Mission report: posted", now + 3, "u2"),
        user("Replied to https://x.com/a/1", now + 4, "u3"), user("Remind me: stretch", now + 5, "u4"),
        user("Ritual (automatic timer): run the hunt", now + 6, "u5"), user("Hey there", now + 7, "u6")]
items = {it["key"]: it for it in am.app_items(recs, S["scout-scout"])}
check(items["u1:0"].get("from") == "script", "a timer's: from a script (its spacing aside)")
check(items["u2:0"].get("from") == "proj-a", "another chat's: from that chat")
check("from" not in items["u3:0"], "your task's button: yours")
check(items["u4:0"].get("from") == "script", "one it sent itself (a reminder): not yours either")
check("from" not in items["u5:0"] and "from" not in items["u6:0"], "the same words again, sent once: the second is yours; yours: yours")
check(all(items[k].get("turn") for k in items), "each still starts a turn")
old = [user("Ritual (automatic timer): run the hunt", now - 5 * 86400, "u9")]
check("from" not in am.app_items(old, S["scout-scout"])[0], "a message from before it was sent: not that one")

# ---- unread: what it wrote since you last looked
f = Path(home, "scout.jsonl")
t0 = now - 600
def tool(t, uid, tid):
    return {"type": "assistant", "uuid": uid, "timestamp": iso(t), "message": {"role": "assistant", "content": [{"type": "tool_use", "id": tid, "name": "Bash", "input": {"command": "ls"}}]}}
def result(t, uid, tid):
    return {"type": "user", "uuid": uid, "timestamp": iso(t), "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tid, "content": "x"}]}}
lines = [said("Old news", t0 - 100, "a0"), user("Find me posts", t0, "h1"), said("On it.", t0 + 10, "a1"), tool(t0 + 20, "a2", "t1"), result(t0 + 30, "r1", "t1"),
         said("Found two.\n---\nBoth on your **Tasks**.\n\n```goal state=\"working\"\nHunt\n```", t0 + 50, "a4"),
         said("```goal state=\"working\"\nHunt\n```", t0 + 55, "a5")]
f.write_text("\n".join(json.dumps(l) for l in lines) + "\n")
am.transcript = lambda s: f if s["id"] == "scout-scout" else None
w = am.last_words(S["scout-scout"], deep=True)
check(w["said"] == "Both on your Tasks." and abs(w["said_at"] - (t0 + 50)) <= 1, f"its last message, and when ({w['said']!r})")
check(len(w["stamps"]) == 4 and w["after_you"] == 3, f"the times of its messages, three since yours (two in one, a ---; a goal alone isn't one) ({len(w['stamps'])}, {w['after_you']})")
check(am.unread(S["scout-scout"], w) == 0, "never looked since this was kept, and nothing unseen: none")
am.mark_unseen("scout-scout")
check(am.unread(S["scout-scout"], w) == 3, "never looked, its turn unseen: those since your message")
am.mark_seen("scout-scout")
os.utime(am.SEEN / "scout-scout", (t0 + 35, t0 + 35))
check(am.unread(S["scout-scout"], w) == 2, "looked after its first: the two since")
am.mark_seen("scout-scout")
check(am.unread(S["scout-scout"], w) == 0 and not am.unseen("scout-scout"), "looked now: none, and not unseen")
w2 = am.last_words(S["scout-scout"])
check(w2["said"] == "Found two. --- Both on your Tasks.", f"a working chat's list words: the whole reply in a line ({w2['said']!r})")

# ---- the badge: what needs you, and your team's unread messages
ss = [{"id": "jaken-jaken", "assistant": "main", "unread": 2, "status": "idle"}, {"id": "scout-scout", "assistant": "agent", "unread": 3, "status": "idle"},
      {"id": "scout-ideas", "assistant": "near", "unread": 9, "status": "idle"}, {"id": "proj-a", "assistant": "", "status": "waiting"}]
check(am.needs_you(ss) == 1 and am.app_badge(ss) == 6, f"the badge: 1 needing you and 5 unread ({am.app_badge(ss)})")

# ---- made an agent, or not one: its Claude asked to start again with its format (none running here: nothing)
started = []
am.detach = lambda argv: started.append(argv)
run("agents", "proj-a")
run("agents", "proj-a", "off")
check(started == [], "no Claude running: nothing to start again")
am.host_pane = lambda s: {"pid": 1}
run("agents", "proj-a")
run("agents", "proj-a", "--name", "Ops")
run("agents", "proj-a", "off")
check([a[-1] for a in started] == ["proj-a", "proj-a"] and all(a[1] == "claude-reload" for a in started),
      f"made an agent, then not: started again each time, not for a rename ({started})")
started.clear()
run("assistant", "proj-a")
check(sorted(a[-1] for a in started) == ["jaken-jaken", "proj-a"], f"a new assistant: it and the one it replaces ({started})")
started.clear()
run("assistant", "off")
check([a[-1] for a in started] == ["proj-a"], "no assistant: the one it was")
run("assistant", "jaken-jaken")

shutil.rmtree(home, ignore_errors=True)
print(f"\n{len(failed)} failed" if failed else "\nAll passed")
sys.exit(1 if failed else 0)
