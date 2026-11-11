# The blocks' catalog on the server, without a browser: the guidance Claude
# gets is made from it (every block it has, with its example, each example
# passing the check); a reply's blocks are read and checked (what can't be
# drawn, said so Claude can fix it); when a turn ends, the Stop hook sends a
# reply back to be written again, or asks for its goal block alone, or lets
# it be; the reply sent back isn't shown, nor the hook's words, and they
# aren't something you said; a reply that's only its goal block doesn't hide
# the questions of the one before it from Today.
#
#   python3 test/reply-check.py         exits 0 when every check passed

import importlib.machinery, importlib.util, json, os, tempfile
from pathlib import Path

home = tempfile.mkdtemp(prefix="reply-check-")
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config")
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(Path(__file__).resolve().parent.parent / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failed.append(what)

# The guidance, made from the catalog.
cat = am.block_catalog()["blocks"]
kinds = [b["kind"] for b in cat]
check({"whatsapp", "email", "slack", "sms", "command", "link", "event", "todos", "fields", "chart", "contact", "place", "session", "file",
       "brief", "actions", "choices", "goal"} == set(kinds), f"the catalog's blocks ({kinds})")
check(all(f"```{k}" in am.REPLY_FORMAT for k in kinds), "the guidance shows every block")
check(all(b["rule"] in am.REPLY_FORMAT for b in cat if b.get("rule")), "and every block's rule")
check(am.REPLY_FORMAT.startswith("amarchy shows"), "it starts as a Claude's format is recognized by (claude_format_version)")
for b in cat:
    ex = b["example"]
    text = f"```{b['kind']} {ex['attrs']}\n{ex.get('body') or 'the message'}\n```"
    issues = am.block_issues(am.reply_blocks(text)[0], lambda sid: True)
    check(not issues, f"the {b['kind']} example passes its own check {issues or ''}")

# A reply's blocks read and checked.
reply = '''Done, here's all of it.

```whatsapp to="Felipe" phone="+57 300 111 2233" colour="red"
Hola
```

```event title="Panel" when="tomorrow at 3"
```

```choices question=“Ship?”
- Yes
```

```chart type="pie" title="Load"
| Day | A | B |
|---|---|---|
| Mon | 1,200 | 2 |
| Tue | $3.5 | 40% |
```

```fields title="Number"
Number: +1 628 296 2190
oops
```

```session id="nope-nope"
```

```link
javascript:alert(1)
```

```js
```goal not a block, code
```
'''
blocks = am.reply_blocks(reply)
check([b["kind"] for b in blocks] == ["whatsapp", "event", "choices", "chart", "fields", "session", "link"], f"its blocks, in order, code skipped ({[b['kind'] for b in blocks]})")
chart = blocks[3]
check(chart["series"] == ["A", "B"] and chart["points"] == [{"label": "Mon", "values": [1200.0, 2.0]}, {"label": "Tue", "values": [3.5, 40.0]}],
      f"a chart's table: series and numbers ($, %, commas) ({chart['points']})")
issues, has_goal = am.reply_issues(reply, lambda sid: sid != "nope-nope")
text = "\n".join(issues)
for what, needle in [("an attribute it doesn't take", "takes no 'colour'"), ("a date that isn't one", "'tomorrow at 3' isn't a date and time"),
                     ("curly quotes", "isn't key=\"value\""), ("a question with no question", "needs question="),
                     ("a chart type it doesn't draw", "type is 'pie'"), ("a line that isn't a field", "'oops'"),
                     ("a chat that isn't there", "'nope-nope' isn't a chat's id"), ("an address not to open", "isn't one to open")]:
    check(needle in text, f"said: {what}")
check(not has_goal, "no goal block: the one in code doesn't count")
ok, goal = am.reply_issues('All good.\n\n```todos title="Open"\n- [ ] One (today)\n```\n\n```goal state="done"\nShip it\n```')
check(ok == [] and goal, f"a good reply: nothing to fix ({ok})")
check(am.reply_issues("```chart title=\"x\"\nMon: 1\n```\n```goal state=\"done\"\nx\n```")[0] == ["The chart block needs at least 2 values to chart."], "a chart needs two values")
check(am.reply_issues("```choices question=\"Q?\"\n- a\n- b\n- c\n- d\n- e\n```")[0] == ["The choices block has 5 options: at most 4 (one question per block)."], "at most 4 options")
check(am.reply_issues("```event title=\"x\" when=\"2026-10-29T15:40:00-05:00\" end=\"2026-10-29T14:00:00-05:00\"\n```")[0] == ["The event block ends before it starts."], "an event ending before it starts")
check(am.reply_issues("```whatsapp\nhola")[0] == ["The whatsapp block isn't closed with ```."], "a block not closed")

# A reply's shape: a long one opens with its outcome and its brief, then what
# they need to do, then every idea under a heading; a short one is let be.
GOAL = '\n\n```goal state="done"\nX\n```'
BRIEF = '\n\n```brief\nChecked: Both view tests pass\nOpen: Algolia isn\'t wired\n```'
ACTS = '\n\n```actions\n- Say whether to ship it\n```\n\n```choices question="Ship it?"\n- Ship it\n- Not yet\n```'
words = lambda n: " ".join(["word"] * n) + "."
shape = lambda text: "\n".join(am.reply_issues(text + GOAL)[0])
check(shape("Done, it works. " + words(60)) == "", "a short reply: no sections, no brief asked")
check(shape("Done, it works. " + words(60) + '\n\n```choices question="Ship it?"\n- Ship it\n- Not yet\n```') == "", "a short reply's question, at its end")
wall = shape("Done. " + words(100))
check("in one piece" in wall and "brief block" in wall, f"a long reply in one piece: sections and a brief asked ({wall[:60]})")
body = "\n\n## It filters as you type\n\n" + words(70) + "\n\n## Tests pass on phone and wide\n\n- " + words(50) + "\n\n## Sources\n\n- [a](https://a.b)"
good = "Done, it works." + BRIEF + ACTS + body
check(shape(good) == "", f"the outcome and its brief, what's yours to do, its sections: nothing to fix ({shape(good)})")
check(shape("Done, it works." + BRIEF + body) == "", "nothing for them to do: no actions block")
check("no brief block" in shape("Done, it works." + body), "sections but no brief: asked for it")
check("no opening sentence" in shape(BRIEF.strip() + body), "a brief with no opening before it: asked for it")
lead = shape(words(60) + BRIEF + "\n\n## One\n\n" + words(40))
check("60 words come before your first" in lead, f"a long opening: said ({lead[:50]})")
long = shape("Done." + BRIEF + "\n\n## One point\n\n" + words(130))
check('The section "One point" is 130 words' in long, f"a section that runs on: said ({long[:50]})")
check("characters: at most 70" in shape("Done." + BRIEF + "\n\n## " + "A heading that goes on and on " * 4 + "\n\nShort."), "a heading that isn't a few words: said")
late = shape("Done, it works." + body + BRIEF + ACTS)
check(all(f"Your {k} block comes after" in late for k in ("brief", "actions", "choices")), f"the brief, the action items or a question after a heading: said ({late[:60]})")
table = "Done.\n\n## Numbers\n\n" + "\n".join(["| a b c d e f g h | 1 |"] * 40) + "\n\n```js\n" + words(300) + "\n```\n\n```whatsapp to=\"A\"\n" + words(300) + "\n```"
check(shape(table) == "", f"a table, code and a draft aren't prose: not counted ({shape(table)[:60]})")
check(shape("Done.\n\n```js\n## not a heading\n" + words(10) + "\n```") == "" and am.reply_outline("```js\n## x\n```")["sections"] == [], "a heading in code isn't one")
o = am.reply_outline(good)
check([s["title"] for s in o["sections"]] == ["It filters as you type", "Tests pass on phone and wide", "Sources"] and o["lead"] == 3 and o["brief"] == 3 and not o["late"], f"its outline ({o})")
brief = lambda body: "\n".join(am.reply_issues(f"```brief\n{body}\n```")[0])
check(brief("Checked: x") == "" and brief("Checked: y\nOpen: z\nNext: w") == "" and brief("Done: x\nYou: Nothing") == "", "a brief's rows (an older one's too)")
check("takes no 'Summary' row (its rows: Checked, Open, Next)" in brief("Summary: x\nChecked: x"), f"a row it doesn't take: said ({brief('Summary: x')})")
check("over 200 characters" in brief("Checked: " + words(60)), "a row that runs on: said")
check("aren't \"Label: value\"" in brief("Checked: x\n- and more"), "a line that isn't a row: said")
check("is empty" in brief(""), "an empty brief: said")
acts = am.reply_blocks("```actions\n- Open the PR (today)\n- [x] Pay\n```")[0]
check(acts["items"] == [{"text": "Open the PR", "due": "today", "done": False}, {"text": "Pay", "due": "", "done": True}] and am.reply_issues("```actions\n```")[0] == ["The actions block is empty."],
      f"what's yours to do: a line each ({acts['items']})")

# When a turn ends: sent back, asked for its goal, or let be.
def turn(*records):
    f = Path(home) / f"t{len(os.listdir(home))}.jsonl"
    f.write_text("\n".join(json.dumps(r) for r in records) + "\n")
    return str(f)
you = {"type": "user", "message": {"role": "user", "content": "Do it"}}
step = {"type": "assistant", "message": {"content": [{"type": "text", "text": "Looking."}, {"type": "tool_use", "id": "t1", "name": "Bash", "input": {}}]}}
result = {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "t1", "content": "ok"}]}}
said = lambda t: {"type": "assistant", "message": {"content": [{"type": "text", "text": t}]}}
bad = 'Done.\n\n```event title="x" when="soon"\n```\n\n```goal state="done"\nX\n```'
ask = am.reply_fix({"transcript_path": turn(you, step, result, said(bad))})
check(ask and ask.startswith(am.FIX_MARK) and "'soon' isn't a date and time" in ask and "Looking." not in ask, f"a broken block: the reply sent back, with what's wrong ({ask and ask[:90]})")
check(am.turn_reply(turn(you, step, result, said("Part one."), said(bad))) == "Part one.\n\n" + bad, "the reply is all its words after the last step")
check(am.reply_fix({"transcript_path": turn(you, said("Done."))}) == am.GOAL_ASK, "no goal block: asked for it alone")
check(am.reply_fix({"last_assistant_message": 'Done.\n\n```goal state="done"\nX\n```'}) is None, "a good reply: let be")
check(am.reply_fix({"transcript_path": turn(you, step)}) is None, "a turn that ended without words: let be")
ask = am.reply_fix({"last_assistant_message": "Done. " + words(100) + GOAL})
check(ask and ask.startswith(am.FIX_MARK) and "in one piece" in ask, f"a wall of text: sent back ({ask and ask[:70]})")
old_fb = {"type": "user", "isMeta": True, "message": {"role": "user", "content": f"{am.HOOK_FEEDBACK}\namarchy: some blocks in your reply can't be drawn, so their buttons won't work:\n- x"}}
check(am.fix_feedback(old_fb) and am.user_item(old_fb["message"]["content"]) is None, "what the hook said before is still known as its own")

# The reply sent back isn't shown, nor the hook's words, and they aren't yours.
ask = am.reply_fix({"transcript_path": turn(you, step, result, said(bad))})
feedback = {"type": "user", "uuid": "f", "isMeta": True, "message": {"role": "user", "content": f"{am.HOOK_FEEDBACK}\n{ask}"}}
fixed = said('Done.\n\n```event title="x" when="2026-10-29T15:40:00-05:00"\n```\n\n```goal state="done"\nX\n```')
items = am.app_items([you, step, result, said("Part one."), said(bad), feedback, fixed], {"id": "x", "path": home})
shown = [(i["kind"], i.get("text", "")[:9], bool(i.get("aside"))) for i in items if i["kind"] in ("user", "claude", "note")]
check(shown == [("user", "Do it", False), ("claude", "Looking.", False), ("claude", "Part one.", True), ("claude", "Done.\n\n``", True),
                ("claude", "Done.\n\n``", False)], f"the words sent back aside, the hook's not shown, the new reply is ({shown})")
check(not am.human_turn(feedback) and not am.human_message(feedback["message"]["content"]), "the hook's words aren't something you said")
goal_fb = {"type": "user", "isMeta": True, "message": {"role": "user", "content": f"{am.HOOK_FEEDBACK}\n{am.GOAL_ASK}"}}
items = am.app_items([you, said("Done, ship it?"), goal_fb, said('```goal state="waiting"\nShip\n```')], {"id": "x", "path": home})
check([i.get("aside", False) for i in items if i["kind"] == "claude"] == [False, False] and not any(i["kind"] == "user" and "Stop hook" in i["text"] for i in items),
      "asked for its goal alone: the reply stays, the hook's words don't show")
other = am.user_item(f"{am.HOOK_FEEDBACK}\nlint failed")
check(other == {"kind": "note", "text": f"{am.HOOK_FEEDBACK}\nlint failed"}, "another hook's words: a quiet line")

# Today: a reply that's only its goal block keeps the one before it's questions.
q = 'Ready.\n\n```choices question="Ship it?"\n- Ship it\n- Not yet\n```'
s = {"id": "x", "path": home}
f = turn(you, said(q), goal_fb, said('```goal state="waiting"\nShip\n```'))
orig = am.transcript
am.transcript = lambda _s: Path(f)
try:
    r = am.chat_reply(s)
finally:
    am.transcript = orig
check(r["goal"] == "Ship" and r["state"] == "waiting" and r["asks"] and r["asks"][0]["question"] == "Ship it?", f"Today: its goal, and the question before it ({r.get('asks')})")
check(am.reply_choices(q) == [{"question": "Ship it?", "options": [{"label": "Ship it", "send": "Ship it"}, {"label": "Not yet", "send": "Not yet"}]}], "choices read by the catalog's parser")
check(am.reply_links('```link label="PR"\nhttps://github.com/x/1\n```') == [{"label": "PR", "url": "https://github.com/x/1"}], "links too")

print("\nAll passed." if not failed else f"\n{len(failed)} failed:\n  " + "\n  ".join(failed))
raise SystemExit(1 if failed else 0)
