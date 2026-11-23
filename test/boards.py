# Tasks as boards, without a browser (amarchy board, and the app's side of
# it): a board is your assistant's or an agent's, never a plain chat's; its
# columns (a new one's: To do, Doing, Done), each column's buttons (a
# message, a column to move to, words asked first, or nothing sent); its
# cards, any block the app draws, checked as a reply's are; --key changes
# one in place. Approving is yours alone: an agent can't put a card into a
# column that needs your approval; your approval is of exactly what the card
# has (its sha256), signed, and goes with any change to it (yours, an
# agent's), the card back where it was; a forged one doesn't check. The
# board's check refuses your edit or approval, in its words. Your comment
# goes to the card's agent as your own message, naming the card; an agent's
# update over your edit is refused until it says so. The log has it all.
# Tasks from before boards move onto their agent's board once; an older
# machine's tasks show as boards; the guard keeps an agent's tools off the
# app's board actions and the boards' files.
#
#   python3 test/boards.py         exits 0 when every check passed

import hashlib, importlib.machinery, importlib.util, io, json, os, re, shutil, sys, tempfile, time
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path

home = tempfile.mkdtemp(prefix="boards-", dir=os.environ.get("TMPDIR"))
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

def run(*args, me=None, stdin=None):
    out, err = io.StringIO(), io.StringIO()
    if me:
        os.environ["AMARCHY_SESSION"] = me
    if stdin is not None:
        sys.stdin = io.StringIO(stdin)
    try:
        with redirect_stdout(out), redirect_stderr(err):
            rc = am.main(list(args))
    finally:
        os.environ.pop("AMARCHY_SESSION", None)
        sys.stdin = sys.__stdin__
    return rc, out.getvalue(), err.getvalue()

am.SESSIONS.mkdir(parents=True, exist_ok=True)
def mk(sid, repo):
    path = f"{home}/wt/{sid}"
    os.makedirs(path, exist_ok=True)
    am.write_file(am.SESSIONS / f"{sid}.json", json.dumps({"id": sid, "repo": repo, "name": sid.split("-", 1)[1], "branch": "b",
                                                           "path": path, "created": int(time.time()) - 3600}))
for sid, repo in [("jaken-jaken", "jaken"), ("fireship-fireship", "fireship"), ("scout-scout", "scout"), ("proj-a", "proj")]:
    mk(sid, repo)

# Tasks from before boards: moved onto their agent's own board, once.
am.STATE.mkdir(parents=True, exist_ok=True)
am.write_file(am.TASKS, json.dumps([
    {"id": "a1b2c3", "agent": "fireship-fireship", "title": "Reply: old", "note": "n", "links": [], "buttons": [{"label": "Replied", "send": "Replied to old"}],
     "until": time.time() + 3600, "at": time.time() - 60, "key": "old-1"},
    {"id": "d4e5f6", "agent": "fireship-fireship", "title": "Long gone", "links": [], "buttons": [], "until": time.time() - am.TASK_GRACE - 10, "at": 1}]))
run("assistant", "jaken-jaken")
run("agents", "fireship-fireship")
run("agents", "scout-scout", "--name", "Scout")
b = am.board_get("fireship-fireship")
check(b and b.get("task") and [c["id"] for c in b["cards"]] == ["a1b2c3"] and b["cards"][0]["key"] == "old-1"
      and [c["name"] for c in b["columns"]] == ["For you", "Done"], f"tasks from before boards: on their agent's own board ({b})")
check(not am.TASKS.exists() and am.TASKS.with_name("tasks.json.moved").exists(), "the old file kept aside, read once")

# What's sent to an agent: recorded here, not delivered.
sent = []
real_run = am.run_amarchy
def fake_run(*args, **kw):
    if args and args[0] == "send":
        sent.append(args)
        bad = "refuse" in args[1]
        return am.subprocess.CompletedProcess(args, 1 if bad else 0, "", "amarchy: it said no" if bad else "")
    return real_run(*args, **kw)
am.run_amarchy = fake_run
F = "fireship-fireship"

# ---- a board: whose, its columns, their buttons
rc, out, err = run("board", "set", "ideas", me=F)
b = am.board_get("ideas")
check(rc == 0 and out.strip() == "made\tideas" and b["lead"] == F and [c["name"] for c in b["columns"]] == ["To do", "Doing", "Done"]
      and b["columns"][0].get("yours") and b["columns"][2].get("done"), f"a new board: its lead, To do (yours), Doing, Done ({b and b['columns']})")
rc, _, err = run("board", "set", "mine", me="proj-a")
check(rc == 1 and "only they keep boards" in err, "a plain chat: refused")
rc, _, err = run("board", "set", "jaken-jaken", me=F)
check(rc == 1 and "own board" in err, "another agent's own board: its alone to make")
for bad, what in [(["--button", "x"], "a button before any column"),
                  (["--column", "A", "--button", "x", "--to", "Nowhere"], "a button moving to a column there isn't"),
                  (["--column", "A", "--column", "a"], "two columns of one name"),
                  (["--column", "A", "--approval", "--done"], "approval and done at once"),
                  (["--column", "A", "--approval"], "only columns that need approval"),
                  ([x for i in range(9) for x in ("--column", f"C{i}")], "nine columns"),
                  (["--column", "A", *[x for i in range(5) for x in ("--button", f"b{i}")]], "five buttons on a column"),
                  (["--column", "A", "--quiet"], "--quiet with no button before it"),
                  (["--yours"], "--yours with no column before it")]:
    rc, _, err = run("board", "set", "bad", *bad, me=F)
    check(rc == 1 and err.startswith("amarchy: ") and not am.board_get("bad"), f"{what}: refused ({err.strip()[:80]})")
rc, _, err = run("board", "set", "Bad Id!", me=F)
check(rc == 1 and "id" in err, "a board id that isn't one: refused")

LINT = "if grep -q BANNED; then echo \"Lint ($AMARCHY_CARD_ACTION): BANNED is banned\"; exit 1; fi"
rc, out, err = run("board", "set", "posts", "--title", "Post board",
                   "--column", "For review", "--yours", "--button", "Approve", "--to", "ready to post", "--quiet",
                   "--button", "Discard", "--asks", "Why?", "--to", "Discarded",
                   "--column", "Ready to post", "--approval", "--button", "Back to review", "--to", "For review", "--quiet",
                   "--button", "Posted by hand=Posted {key} by hand: {words}", "--asks", "Its link?", "--to", "Posted",
                   "--column", "Posted", "--done", "--column", "Discarded", "--done", "--button", "Restore", "--to", "For review",
                   "--check", LINT, me=F)
b = am.board_get("posts")
cols = {c["name"]: c for c in b["columns"]}
check(rc == 0 and b["title"] == "Post board" and list(cols) == ["For review", "Ready to post", "Posted", "Discarded"], "the post board, as Fireship's is")
check(cols["For review"]["buttons"] == [{"label": "Approve", "send": "", "to": "Ready to post"}, {"label": "Discard", "send": None, "to": "Discarded", "asks": "Why?"}],
      f"a column's buttons: quiet, a column to go to (its name as the board has it), words asked ({cols['For review']['buttons']})")
check(cols["Ready to post"].get("approval") and cols["Posted"].get("done") and b["check"] == LINT, "needs approval, done, the check")

# ---- cards
os.makedirs(f"{home}/pics", exist_ok=True)
Path(f"{home}/pics/a.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"\0" * 40)
Path(f"{home}/pics/notes.txt").write_text("not a picture")
rc, out, err = run("board", "card", "posts", "--key", "fs-1", "--title", "Agents: stop babysitting", "--xpost", "-", "--handle", "ja818_",
                   "--media", f"{home}/pics/a.png", "--note", "Slot: Tue 9:00", "--link", "Source=https://example.com/s", me=F,
                   stdin="Stop babysitting your agents.\nManage them.\n")
c1 = out.strip()
c = am.card_find(am.board_get("posts"), "fs-1")
check(rc == 0 and re.fullmatch(r"[0-9a-f]{6}", c1) and c["column"] == "For review" and c["agent"] == F and c["by"] == F,
      f"a card: in the first column, its agent ({err})")
check(c["block"] == {"kind": "xpost", "attrs": {"handle": "ja818_", "media": f"{home}/pics/a.png"}, "body": "Stop babysitting your agents.\nManage them."},
      f"its block: an xpost, its text as given ({c['block']})")
check(c["note"] == "Slot: Tue 9:00" and c["links"] == [{"label": "Source", "url": "https://example.com/s"}], "its note and link")
for bad, what in [(["--xpost", "hi", "--handle", "not a handle!"], "an xpost with a handle that isn't one"),
                  (["--xpost", "hi", "--media", f"{home}/pics/notes.txt"], "a picture that isn't one"),
                  (["--xpost", "a\n```\nb"], "a ``` line in its text"),
                  (["--block", "goal", "--body", "x"], "a reply's own block"),
                  (["--block", "event", "--body", "x"], "an event without its title and time"),
                  (["--body", "x"], "--body without a block"),
                  (["--column", "Nowhere"], "a column there isn't"),
                  (["--column", "Ready to post"], "straight into a column that needs approval")]:
    rc, _, err = run("board", "card", "posts", "--title", "x", *bad, me=F)
    check(rc == 1 and err.startswith("amarchy: "), f"{what}: refused ({err.strip()[:100]})")
rc, _, err = run("board", "card", "posts", "--key", "new-1", me=F)
check(rc == 1 and "--title" in err, "a new card needs its title")
rc, out, _ = run("board", "card", "posts", "--key", "fs-2", "--title", "Second", "--block", "email", "--attr", "to=ana@example.com", "--attr", "subject=Hi",
                 "--body", "Hello Ana", me=F)
check(rc == 0 and am.card_find(am.board_get("posts"), "fs-2")["block"]["kind"] == "email", "any block the app draws (an email)")
rc, out, _ = run("board", "card", "posts", "--key", "fs-1", "--note", "Slot: Wed 9:00", me=F)
c = am.card_find(am.board_get("posts"), "fs-1")
check(out.strip() == c1 and c["note"] == "Slot: Wed 9:00" and c["block"]["body"].startswith("Stop babysitting"), "--key: changed in place, only what's given")
rc, out, _ = run("board", "card", "posts", "--key", c1, "--title", "Agents: stop babysitting them", me=F)
check(out.strip() == c1 and am.card_find(am.board_get("posts"), "fs-1")["title"] == "Agents: stop babysitting them", "--key takes a card's id too")
rc, _, err = run("board", "card", "posts", "--key", "fs-1", "--column", "Ready to post", me=F)
check(rc == 1 and "approval" in err, "an agent can't move a card into a column that needs approval")
rc, _, err = run("board", "move", "posts", "fs-1", "Ready to post", me=F)
check(rc == 1 and "approval" in err and am.card_find(am.board_get("posts"), "fs-1")["column"] == "For review", "nor with move")
rc, _, err = run("board", "approved", "posts", "fs-1")
check(rc == 1, "not approved")

# ---- your approval: of exactly what it has, signed
b = am.board_get("posts")
sha = am.card_sha(am.card_find(b, "fs-1"))
sent.clear()
check(am.board_press("posts", c1, 0, "", "julian@example.com") is None and not sent, "Approve: quiet, nothing sent")
c = am.card_find(am.board_get("posts"), "fs-1")
check(c["column"] == "Ready to post" and c["approval"]["by"] == "julian@example.com" and c["approval"]["sha256"] == sha and c["approval"]["from"] == "For review",
      f"in Ready to post, approved by you, of its content's sha256 ({c['approval']})")
rc, out, _ = run("board", "approved", "posts", "fs-1", "--json")
a = json.loads(out)
check(rc == 0 and a["approved"] and a["by"] == "julian@example.com" and a["sha256"] == sha and a["text"] == "Stop babysitting your agents.\nManage them.",
      "amarchy board approved: who, when, the hash, the text")
canon = json.dumps({"kind": "xpost", "attrs": c["block"]["attrs"], "body": c["block"]["body"]}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
check(hashlib.sha256(canon.encode()).hexdigest() == sha, "the hash: its block as JSON, keys in order, no spaces (a script can make it again)")
rc, _, _ = run("board", "approved", "posts", "fs-1", "--text", "-", stdin="Stop babysitting your agents.\nManage them.\n")
check(rc == 0, "--text: the text a script will post, the one approved")
rc, out, _ = run("board", "approved", "posts", "fs-1", "--text", "-", stdin="Something else")
check(rc == 1 and "isn't the text approved" in out, "another text: not approved")
rc, out, _ = run("board", "show", "posts", "--card", "fs-1", "--json")
v = json.loads(out)
check(v["approval"] and v["approval"]["by"] == "julian@example.com" and v["sha256"] == sha
      and v["text_sha256"] == hashlib.sha256("Stop babysitting your agents.\nManage them.".encode()).hexdigest(), "show --json: its approval, sha256, text_sha256")
# A forged one doesn't check: another by, a hash of something else, no key.
raw = json.loads(am.board_file("posts").read_text())
for x in raw["cards"]:
    if x["key"] == "fs-1":
        x["approval"]["by"] = "fireship@agent"
am.write_file(am.board_file("posts"), json.dumps(raw))
rc, out, _ = run("board", "approved", "posts", "fs-1")
check(rc == 1 and "doesn't check" in out, f"an approval written by hand (its by changed): doesn't check ({out.strip()})")
for x in raw["cards"]:
    if x["key"] == "fs-1":
        x["approval"]["by"] = "julian@example.com"
am.write_file(am.board_file("posts"), json.dumps(raw))
check(run("board", "approved", "posts", "fs-1")[0] == 0, "as it was: checks again")
forged = {"by": "julian@example.com", "at": 1.0, "sha256": am.card_sha(am.card_find(am.board_get("posts"), "fs-2")), "sig": "0" * 64, "from": "For review"}
for x in raw["cards"]:
    if x["key"] == "fs-2":
        x["approval"] = forged
am.write_file(am.board_file("posts"), json.dumps(raw))
check(run("board", "approved", "posts", "fs-2")[0] == 1, "a signature made up: doesn't check")
check(oct(am.BOARD_KEY.stat().st_mode & 0o777) == "0o600" and am.BOARD_KEY.parent == am.SECRETS, "the key: 0600, in the secrets' folder")

# An agent's revision drops it: the card back where it was.
rc, out, err = run("board", "card", "posts", "--key", "fs-1", "--xpost", "Stop babysitting. Manage.", me=F)
c = am.card_find(am.board_get("posts"), "fs-1")
check(rc == 0 and "isn't any more" in err and not c["approval"] and c["column"] == "For review", f"revised: not approved, back in For review ({err.strip()})")
check(c["thread"][-2]["kind"] == "revise" and c["thread"][-2]["before"] == "Stop babysitting your agents.\nManage them." and c["thread"][-1]["kind"] == "move",
      "its thread: the revision, what was there before, the move back")
rc, _, _ = run("board", "card", "posts", "--key", "fs-1", "--note", "Slot: Thu", me=F)
check(am.card_find(am.board_get("posts"), "fs-1")["thread"][-1]["kind"] == "move", "a note's change: no revision (only the block is approved)")

# The board's check: refuses your approval and your edit, in its words.
run("board", "card", "posts", "--key", "fs-3", "--title", "Banned", "--xpost", "Some BANNED words", "--handle", "ja818_", me=F)
c3 = am.card_find(am.board_get("posts"), "fs-3")["id"]
why = am.board_press("posts", c3, 0, "", "julian@example.com")
check(why == "Lint (approve): BANNED is banned" and am.card_find(am.board_get("posts"), "fs-3")["column"] == "For review", f"approve: the check says no, in its words ({why})")
why = am.board_move_you("posts", c3, "Ready to post", "julian@example.com")
check(why == "Lint (approve): BANNED is banned", "Move to it too")
why = am.board_edit_you("posts", c1, None, "Now BANNED too", None)
check(why == "Lint (edit): BANNED is banned" and "BANNED" not in am.card_find(am.board_get("posts"), "fs-1")["block"]["body"], "an edit: refused, nothing saved")

# Your edit: saved, its approval gone, the thread and the log; nothing sent.
check(am.board_press("posts", c1, 0, "", "julian@example.com") is None, "approved again")
sent.clear()
check(am.board_edit_you("posts", c1, "Agents: managed", "Manage your agents.", None) is None and not sent, "an edit: saved, nothing sent")
c = am.card_find(am.board_get("posts"), "fs-1")
check(c["title"] == "Agents: managed" and c["block"]["body"] == "Manage your agents." and not c["approval"] and c["column"] == "For review",
      "its title and text, not approved any more, back in For review")
check([x["kind"] for x in c["thread"][-3:]] == ["edit", "edit", "move"] and c["thread"][-2]["before"] == "Stop babysitting. Manage.", "on its thread, with what was there")
check(am.board_edit_you("posts", c1, None, "x", "0" * 64) == "Its agent changed it while you were editing: look at it again", "an edit over a change you didn't see: refused")
# An agent's update over your edit: refused until it says so.
rc, _, err = run("board", "card", "posts", "--key", "fs-1", "--xpost", "Mine instead", me=F)
check(rc == 1 and "edited fs-1 since you last wrote it" in err and "Manage your agents." in err and "--over-edit" in err, "an agent's update over your edit: refused, your text shown")
rc, _, _ = run("board", "card", "posts", "--key", "fs-1", "--note", "Slot: Fri", me=F)
check(rc == 0, "its note it can still change")
rc, _, _ = run("board", "card", "posts", "--key", "fs-1", "--xpost", "Manage your agents. Really.", "--over-edit", me=F)
check(rc == 0 and am.card_find(am.board_get("posts"), "fs-1")["block"]["body"] == "Manage your agents. Really.", "--over-edit: it builds on yours")
rc, _, err = run("board", "card", "posts", "--key", "fs-1", "--xpost", "again", "--base", "0" * 64, me=F)
check(rc == 1 and "changed since" in err, "--base: refused when it changed since")

# Your comment: to its agent as your message, naming the card; on its thread.
sent.clear()
check(am.board_comment_you("posts", c1, "Shorter, please") is None, "a comment")
check(sent == [("send", F, "About “Agents: managed” (board posts, card fs-1): Shorter, please", "--no-wait")], f"to Fireship, naming the card ({sent})")
check(am.board_comment_you("posts", c1, "  ") == "Write something first", "an empty one: refused")
rc, out, _ = run("board", "comment", "posts", "fs-1", "Cut it to one line.", me=F)
crew = am.team()
v = am.card_view(am.board_get("posts"), am.card_find(am.board_get("posts"), "fs-1"), crew)
check(rc == 0 and v["thread"][-1]["kind"] == "comment" and v["thread"][-1]["name"] == "Fireship" and v["answered"], "its answer on the thread: the card says it answered")
check(am.board_comment_you("posts", c1, "Good") is None and not am.card_view(am.board_get("posts"), am.card_find(am.board_get("posts"), "fs-1"), crew)["answered"],
      "you again: not answered any more")

# A button that asks first; its words in the message; {placeholders}.
sent.clear()
check(am.board_press("posts", c1, 1, "", "j") == "Discard asks you first: Why?" and not sent, "Discard with no reason: asked first, nothing sent")
check(am.board_press("posts", c1, 1, "too   salesy", "j") is None, "with one")
check(sent[-1][2] == "Discard: “Agents: managed” (board posts, card fs-1): too salesy", f"the reason in the message ({sent[-1]})")
c = am.card_find(am.board_get("posts"), "fs-1")
check(c["column"] == "Discarded" and c["thread"][-1] == {**c["thread"][-1], "kind": "press", "label": "Discard", "text": "too salesy", "column": "Discarded"},
      "in Discarded, its reason on its thread")
check(am.board_press("posts", c1, 0, "", "j") is None and am.card_find(am.board_get("posts"), "fs-1")["column"] == "For review", "Restore: For review again")
check(am.board_press("posts", c1, 0, "", "julian@example.com") is None, "approve")
sent.clear()
check(am.board_press("posts", c1, 1, "https://x.com/ja818_/status/1", "j") is None and sent[-1][2] == "Posted fs-1 by hand: https://x.com/ja818_/status/1",
      f"{{key}} and {{words}} in a message ({sent[-1]})")
check(am.card_find(am.board_get("posts"), "fs-1")["column"] == "Posted" and run("board", "approved", "posts", "fs-1")[0] == 0,
      "Posted: still approved (posted as it was approved)")
check(am.board_press("posts", c1, 9, "", "j") == "That card has no such button" and am.board_press("posts", "zzzzzz", 0, "", "j"), "a button or card there isn't: refused")
c = am.card_find(am.board_get("posts"), "fs-2")
sent.clear()
mk("refuse-refuse", "refuse")
run("agents", "refuse-refuse")
run("board", "set", "nope", me="refuse-refuse")
run("board", "card", "nope", "--key", "n1", "--title", "N", "--button", "Go=go", me="refuse-refuse")
nid = am.card_find(am.board_get("nope"), "n1")["id"]
check(am.board_press("nope", nid, 0, "", "j") == "amarchy: it said no" and am.card_find(am.board_get("nope"), "n1")["column"] == "To do",
      "its agent didn't take it: said why, nothing moved")

# A task you write: a card of yours, its board's lead told.
sent.clear()
r, why = am.board_add_you("jaken-jaken", "Renew the car insurance\nIt ends Dec 1")
b = am.board_get("jaken-jaken")
c = next(x for x in b["cards"] if x["id"] == r["id"])
check(not why and b.get("task") and c["title"] == "Renew the car insurance" and c["note"] == "It ends Dec 1" and c["by"] == "you" and c["column"] == "For you",
      "on your assistant's own board (made for it), For you, yours")
check(sent and sent[0][1] == "jaken-jaken" and sent[0][2].startswith("Renew the car insurance\nIt ends Dec 1\n\n(A task of mine on your board: board jaken-jaken, card ")
      and f'amarchy board comment jaken-jaken {r["id"]}' in sent[0][2], f"Jaken told, with how to answer ({sent})")
check([x["label"] for x in am.card_buttons(b, c)] == ["Done"], "a task of yours: Done")
r2, _ = am.board_add_you("posts", "A post about boards")
check(am.card_find(am.board_get("posts"), r2["id"])["column"] == "For review" and "the board “Post board”" in sent[-1][2], "on another board: its first column of yours")
check(am.board_add_you("posts", "  ")[1] == "Write the task first" and am.board_add_you("proj-a", "x")[1] == "That board is gone", "nothing written, or no board: refused")

# The app's view: each board, what's yours, the first of it.
view = am.today_view()["boards"]
ids = [x["id"] for x in view]
check(ids.index("jaken-jaken") < ids.index("posts") and "nope" in ids, f"your assistant's first ({ids})")
pv = next(x for x in view if x["id"] == "posts")
check(pv["title"] == "Post board" and pv["lead_name"] == "Fireship" and pv["yours"] == 3 and len(pv["cards"]) == 3
      and [c["name"] for c in pv["columns"]] == ["For review", "Ready to post", "Posted", "Discarded"], f"the post board: 3 for you ({pv['yours']})")
whole = am.board_whole("posts")
check(len(whole["cards"]) == 4 and all("thread" in c for c in whole["cards"]), "/api/boards/posts: every card, its thread")
rc, out, _ = run("board", "list")
check(rc == 0 and re.search(r"^posts\tfireship-fireship\tPost board\tFor review 3 · Ready to post 0 · Posted 1", out, re.M), f"amarchy board list ({out})")
rc, out, _ = run("board", "show", "posts")
check(rc == 0 and "For review (yours): 3" in out and "Posted (done): 1" in out and "✓ approved" in out, "amarchy board show")

# The log: what was done, by whom.
rc, out, _ = run("board", "log", "posts", "--json")
log = json.loads(out)
acts = [(r["who"], r["action"]) for r in log]
check(("you", "approve") in acts and ("you", "edit") in acts and ("you", "comment") in acts and (F, "revise") in acts and (F, "comment") in acts,
      "the log: your approvals, edits, comments; its revisions and answers")
check(any(r["action"] == "press" and r.get("label") == "Discard" and r.get("words") == "too salesy" for r in log), "a discard with its reason")

# Columns changed: a card in one that's gone goes to the first.
run("board", "card", "ideas", "--key", "i1", "--title", "An idea", "--column", "Doing", me=F)
rc, _, err = run("board", "set", "ideas", "--column", "Backlog", "--yours", "--column", "Done", "--done", me=F)
check(rc == 0 and "i1 was in 'Doing'" in err and am.card_find(am.board_get("ideas"), "i1")["column"] == "Backlog", "a column gone: its cards to the first, said")

# Taken down: by you, by the agent; a board dropped.
check(am.board_remove_you("posts", r2["id"]) is None and not am.card_find(am.board_get("posts"), r2["id"]), "you took one down")
rc, out, _ = run("board", "rm", "posts", "fs-2", me=F)
check(rc == 0 and not am.card_find(am.board_get("posts"), "fs-2"), "rm: the agent took one down")
rc, out, _ = run("board", "drop", "ideas", me=F)
check(rc == 0 and not am.board_get("ideas") and not am.board_file("ideas").exists(), "drop: the whole board")

# Done a month ago: gone (only the log has it).
def age(boards):
    for x in boards["posts"]["cards"]:
        if x["key"] == "fs-1":
            x["done_at"] = time.time() - am.BOARD_DONE_KEEP - 5
am.boards_change(age)
check(not am.card_find(am.board_get("posts"), "fs-1"), "a card done a month ago: gone")

# An older machine's tasks: shown as boards.
legacy = am.boards_of_tasks([{"id": "abc123", "agent": "x-x", "agent_name": "X", "title": "T", "buttons": [{"label": "Ok", "send": "ok"}], "until": 0, "at": 1}])
check(legacy and legacy[0]["legacy"] and legacy[0]["cards"][0]["buttons"][0]["send"] == "ok" and legacy[0]["yours"] == 1, "an older machine's tasks, as its agent's board")

# The guard: an agent's tools stay off the app's board actions and the boards' files.
g = lambda cmd: bool(am.board_guard({"tool_name": "Bash", "tool_input": {"command": cmd}}))
check(g('curl -X POST -H "Origin: https://a" https://amarchy.x.ts.net/api/boards/press -d "{}"') and g("wget -qO- http://127.0.0.1:7397/api/boards/move")
      and g("curl https://a/api/m/ja/api/boards/edit") and g("curl https://a/api/tasks/press"), "a call to the app's board actions: refused")
check(g(f"cat {am.BOARDS}/posts.json") and g("cat ~/.local/state/amarchy/boards/posts.json".replace("~/.local/state", "~/state")) is not None
      and g(f"echo x > {am.BOARDS}/posts.json") and g(f"python3 -c \"open('{am.BOARDS}/posts.json','w')\""), "reading or writing the boards' files: refused")
check(g(f"cat {am.BOARD_KEY}"), "the key: refused")
check(not g('grep -n "/api/boards" app/*.js') and not g("amarchy board show posts --json") and not g('git commit -m "boards: /api/boards/press"'),
      "naming them (a grep, a commit message), amarchy board: fine")
settings = json.loads(am.hook_settings("fireship-fireship"))
check(f"Read(/{am.BOARDS}/**)" in settings["permissions"]["deny"] and f"Edit(/{am.BOARDS}/**)" in settings["permissions"]["deny"], "Claude's Read and Edit of the boards' files: denied")
check(f"Read(/{am.SECRETS}/**)" in settings["permissions"]["deny"], "(the secrets' folder, with the key: still denied)")
rc, out, _ = run("board", "--help")
check(rc == 0 and "amarchy board card" in out and "amarchy board approved" in out, "board --help: its usage")

shutil.rmtree(home, ignore_errors=True)
print(f"\n{len(failed)} failed" if failed else "\nAll passed")
sys.exit(1 if failed else 0)
