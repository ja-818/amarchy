// Your assistant's and your agents' chats as a messaging app's, on the phone
// and on a computer alike. On the board, each is a conversation's row: its
// picture, its name over its last message (typing… while it works, what it
// asks you when it does), when it wrote, and how many of its messages you
// haven't read, a round count; on top whatever it does: asking you, its row
// has the answers. Its chat: its messages in bubbles on the left, yours on the
// right, each with its time (yours with ticks), the day between them, its
// steps one quiet line, a tap away, never open by themselves; what a script
// or another chat sent, a quiet line in the middle; three dots while it
// types, and typing… under its name on the bar. A working chat (not an agent)
// stays as it was: no bubbles. With screenshots.
//
//   node test/agent-chat-view.js          both layouts
//   node test/agent-chat-view.js phone    one layout (phone | wide)
//
// Needs what test/today-view.js needs. Exits 0 when every check passed.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadPlaywright, freePort, startServer, findChrome, page, ready, until, sleep, check, failures, CHATS, T, NOW } = require("./today-view.js");

const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "agent-chat-view-"));
const ONLY = process.argv[2];

const at = (secAgo) => new Date((NOW - secAgo) * 1000).toISOString();
const yesterday = (h, m) => { const d = new Date(NOW * 1000); d.setDate(d.getDate() - 1); d.setHours(h, m, 0, 0); return d.toISOString(); };
const today = (h, m) => { const d = new Date(NOW * 1000); d.setHours(h, m, 0, 0); return new Date(Math.min(d.getTime(), NOW * 1000 - 60000)).toISOString(); };

// Scout: three messages you haven't read, the last two minutes ago.
const SCOUT = { id: "scout-scout", repo: "scout", name: "scout", task: "Scout", status: "idle", engine: "chat", path: "/tmp/sc",
                assistant: "agent", assistant_name: "Scout", picture: "", chime: "fairy", today: T({}), unseen: true,
                said: "Two posts worth a reply tonight. Both are on your Tasks.", said_at: Math.floor(NOW - 120), unread: 3 };
// Fireship: read, quiet since yesterday.
const FIRESHIP = { id: "fireship-fireship", repo: "fireship", name: "fireship", task: "", status: "idle", engine: "chat", path: "/tmp/fs",
                   assistant: "agent", assistant_name: "Fireship", picture: "", chime: "elementary", today: T({}),
                   said: "Posted. 12 likes in the first hour.", said_at: Math.floor(new Date(yesterday(12, 0)).getTime() / 1000), unread: 0 };      // (yesterday whenever it runs, past midnight too)
const JAKEN = { ...CHATS[0], said: "Your 3 pm with Felipe moved to 4.", said_at: Math.floor(NOW - 600), unread: 1 };
const AGENTS = [JAKEN, SCOUT, FIRESHIP, ...CHATS.slice(1)];

// Scout's conversation: yesterday's, then today's; its steps between two of
// its messages; what a timer and another chat sent it.
const ITEMS = [
  { kind: "user", text: "Find me two posts to reply to tonight", turn: true, key: "u1:0", at: yesterday(21, 2) },
  { kind: "claude", text: "On it.", key: "c1:0", at: yesterday(21, 2) },
  { kind: "tool", id: "t1", name: "Bash", input: { command: "bin/x-hunt --hours 3" }, key: "c2:0", at: yesterday(21, 3) },
  { kind: "result", tool: "t1", error: false, text: "8 posts", key: "c3:0", at: yesterday(21, 3) },
  { kind: "claude", text: "Found two. **@levelsio** on AI replies, and a thread on Omarchy.", key: "c4:0", at: yesterday(21, 4) },
  { kind: "claude", text: "Both are on your Tasks, with a button each.\n\n```link label=\"Open the thread\"\nhttps://x.com/a/status/1\n```", key: "c5:0", at: yesterday(21, 4) },
  { kind: "user", text: "Ritual (automatic timer): run the hunt skill. Read and follow ~/Work/scout/.claude/skills/hunt/SKILL.md", turn: true, from: "script", key: "u2:0", at: today(8, 0) },
  { kind: "user", text: "<cross-session-message from=\"uds:/run/x.sock\" from-name=\"post-amarchy-14\" from-mode=\"bypass\">Mission report: the post is live.</cross-session-message>", key: "u3:0", at: today(8, 1) },
  { kind: "claude", text: "Morning! The amarchy post is live. Two more targets tonight.", key: "c6:0", at: today(8, 2) },
  { kind: "user", text: "Nice, thanks", turn: true, key: "u4:0", at: today(8, 5) },
  { kind: "claude", text: "Anytime.", key: "c7:0", at: today(8, 5) },
  // Several messages in one reply (a line of --- between two): a bubble each; a table in one.
  { kind: "user", text: "How did this week go?", turn: true, key: "u5:0", at: today(8, 5) },
  { kind: "claude", text: "Good week: **3 posts**, 41 replies.\n---\nBy post:\n\n| Post | Likes |\n|---|---|\n| Tasks | 12 |\n| Omarchy | 9 |\n---\nWant next week's plan?", key: "c9:0", at: today(8, 6) },
  // An old reply, from before it wrote as someone you text: read as written, nothing folded.
  { kind: "claude", text: "The week's posts are drafted.\n\n```brief\nChecked: all five read well\nYou: Pick the first\n```\n\n```choices question=\"Post Monday's now?\"\n- Post it | Post Monday's now\n- Wait\n```\n\n## Monday is the strongest\n\nIt has the demo GIF.\n\n```goal state=\"waiting\"\nPost every day\n```", key: "c8:0", at: today(8, 6) },
];

const sse = (events) => `retry: 600000\n\n${events.map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`).join("")}`;

async function run(browser, port, layout) {
  const where = layout;
  const p = await page(browser, layout, port, { chats: AGENTS });
  await p.route("**/api/session/scout-scout/stream", (r) => r.fulfill({ status: 200, contentType: "text/event-stream",
    body: sse([["session", SCOUT], ["conversation", { reset: true, start: 0, items: ITEMS }], ["live", { state: "idle", pending: [], queue: [] }]]) }));
  await p.route("**/api/session/proj-fresh/stream", (r) => r.fulfill({ status: 200, contentType: "text/event-stream",
    body: sse([["session", CHATS[5]], ["conversation", { reset: true, start: 0, items: ITEMS.filter((x) => !x.from && !/^</.test(x.text)) }], ["live", { state: "idle", pending: [], queue: [] }]]) }));
  await p.goto("/");
  await ready(p);
  await until(p, () => !!document.querySelector(".board-today .tcard[data-id=scout-scout]"));

  // The board: each one a conversation's row, on top.
  const rows = await p.evaluate(() => [...document.querySelectorAll(".board-today .tcard.k-assistant")].map((c) => ({
    id: c.dataset.id, two: !!c.querySelector(".tcard-head.two"), avatar: Math.round((c.querySelector(".tcard-head .avatar") || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width),
    name: (c.querySelector(".tcard-title") || {}).innerText || "", sub: (c.querySelector(".tcard-sub") || {}).innerText || "",
    time: (c.querySelector(".tcard-time") || {}).innerText || "", lit: !!c.querySelector(".tcard-time.on"),
    count: (c.querySelector(".ui-unread") || {}).innerText || "", complete: [...c.querySelectorAll(".tbtn")].some((b) => /Complete|Seen/.test(b.innerText)),
    pill: !!c.querySelector(".tpill") })));
  const scout = rows.find((r) => r.id === "scout-scout") || {}, fire = rows.find((r) => r.id === "fireship-fireship") || {}, jaken = rows.find((r) => r.id === "me-jaken") || {};
  check(where, rows.map((r) => r.id).join() === "me-jaken,scout-scout,fireship-fireship", `your assistant and your agents, on top, in order (${rows.map((r) => r.id).join()})`);
  check(where, scout.two && scout.avatar >= 40 && scout.name === "Scout", `a row: its picture, big, and its name (${JSON.stringify(scout)})`);
  check(where, /Two posts worth a reply/.test(scout.sub), "its last message under its name");
  check(where, scout.count === "3" && scout.lit && /\d/.test(scout.time), `how many you haven't read, its time lit (${scout.count}, ${scout.time})`);
  check(where, jaken.count === "1", "your assistant's too");
  check(where, !fire.count && fire.time === "Yesterday" && !fire.lit, `read: no count, its time quiet (${fire.time})`);
  check(where, !rows.some((r) => r.complete || r.pill), "no Complete, no Seen, no state pill on them");
  const row = await p.evaluate(() => { const c = document.querySelector(".board-today .tcard[data-id=scout-scout]"), r = (q) => c.querySelector(q).getBoundingClientRect();
    return { side: r(".ui-unread").left > r(".tcard-sub").right - 2, under: r(".ui-unread").top >= r(".tcard-time").bottom - 1, sub: r(".tcard-sub").top >= r(".tcard-title").bottom - 1 }; });
  check(where, row.side && row.under && row.sub, `its count at its end under its time, its message under its name (${JSON.stringify(row)})`);
  await p.screenshot({ path: path.join(SHOTS, `${where}-rows.png`) });

  // Working: typing…; asking you: still on top, saying so, with its answers.
  // (Kept over the lists the server sends meanwhile: window.__rows, today-view.js's page.)
  const set = (id, o) => p.evaluate(([id, o]) => {
    window.__rows = { ...(window.__rows || {}), [id]: { ...((window.__rows || {})[id] || {}), ...o } };
    app.view = { ...app.view, sessions: app.view.sessions.map((x) => (x.id === id ? { ...x, ...o, today: { ...x.today, ...(o.today || {}) } } : x)) };
    refresh();
  }, [id, o]);
  await set("fireship-fireship", { status: "working" });
  check(where, await until(p, () => /typing…/.test((document.querySelector(".board-today .tcard[data-id=fireship-fireship] .tcard-sub") || {}).innerText || "")), "working: typing… in its row");
  await set("fireship-fireship", { status: "waiting", asks: "Fireship asks to run x-post", permission: { request_id: "r9", tool: "Bash" } });
  check(where, await until(p, () => { const c = document.querySelector(".board-today .tcard[data-id=fireship-fireship]");
    return !!c && c.matches(".k-assistant") && /asks your permission/.test(c.querySelector(".tcard-sub").innerText) && [...c.querySelectorAll(".tbtn")].some((b) => b.innerText === "Allow"); }),
    "asking you: on top still, saying so, with Allow and Deny");
  const order = await p.evaluate(() => [...document.querySelectorAll(".board-today .tcard.k-assistant")].map((c) => c.dataset.id).join());
  check(where, order === "me-jaken,scout-scout,fireship-fireship", `and in its place (${order})`);
  await p.screenshot({ path: path.join(SHOTS, `${where}-rows-asking.png`) });
  await set("fireship-fireship", { status: "idle", asks: "", permission: null });

  // Its chat: a messaging app's.
  await p.evaluate(() => todayOpen(row("scout-scout")));
  check(where, await until(p, () => !!document.querySelector(".chat.bubbles .msg.claude .stamp")), "its chat: bubbles");
  await sleep(400);
  const c = await p.evaluate(() => {
    const chat = [...document.querySelectorAll(".chat.bubbles")].find((x) => x.offsetParent);
    const conv = chat.querySelector(".chat-conv").getBoundingClientRect();
    const them = [...chat.querySelectorAll(".chat-conv > .msg.claude")], you = [...chat.querySelectorAll(".chat-conv > .msg.user .bubble")];
    const r = (el) => el.getBoundingClientRect();
    return {
      them: them.length, you: you.length,
      left: them.every((m) => r(m).left - conv.left < 30 && r(m).right < conv.right - 20),
      right: you.every((b) => conv.right - r(b).right < 30 && r(b).left > conv.left + 20),
      stamps: them.every((m) => /\d/.test((m.querySelector(":scope > .stamp") || {}).textContent || "")),
      ticks: you.every((b) => !!b.querySelector(".stamp.read .ticks")),
      inside: them.concat(you).every((m) => { const s = m.querySelector(":scope > .stamp"); return s && r(s).right <= r(m).right && r(s).bottom <= r(m).bottom + 1; }),
      days: [...chat.querySelectorAll(".chat-conv > .msg.day")].map((d) => d.innerText),
      auto: [...chat.querySelectorAll(".chat-conv > .msg.note.auto summary")].map((s) => s.querySelector("b").innerText),
      autoYou: you.some((b) => /Ritual|Mission report/.test(b.innerText)),
      work: (() => { const w = chat.querySelector(".chat-conv > .work"); return w ? { head: r(w.querySelector(".work-head")).height > 0, body: r(w.querySelector(".work-body")).height,
        after: /On it/.test((w.previousElementSibling || {}).innerText || "") } : null; })(),
      said: them.map((m) => m.innerText.split("\n")[0]),
      head: (() => { const t = [...document.querySelectorAll(".head-title.who")].find((x) => x.offsetParent); return t ? { name: t.querySelector(".head-name").innerText, pic: !!t.querySelector(".avatar.head") } : null; })(),
      state: [...document.querySelectorAll(".head-state")].some((x) => x.offsetParent),
    };
  });
  check(where, c.them === 9 && c.you === 3, `its 9 messages (three in one reply) and your 3 (${c.them}, ${c.you})`);
  const split = await p.evaluate(() => { const chat = [...document.querySelectorAll(".chat.bubbles")].find((x) => x.offsetParent);
    const them = [...chat.querySelectorAll(".chat-conv > .msg.claude")].map((m) => m.innerText.split("\n")[0]);
    const at = them.findIndex((t) => /Good week/.test(t));
    const table = chat.querySelectorAll(".chat-conv > .msg.claude")[at + 1];
    const r = table.getBoundingClientRect(), t = table.querySelector("table").getBoundingClientRect();
    return { three: at >= 0 && /By post/.test(them[at + 1]) && /next week/.test(them[at + 2]), noRule: !chat.querySelector(".chat-conv > .msg.claude hr"),
             table: t.width > 0 && t.right <= r.right + 1 && t.left >= r.left - 1 }; });
  check(where, split.three && split.noRule, `a reply of three messages: three bubbles, no rule drawn (${JSON.stringify(split)})`);
  check(where, split.table, "a table in a bubble, inside it");
  const square = await p.evaluate(() => { const chat = [...document.querySelectorAll(".chat.bubbles")].find((x) => x.offsetParent);
    const want = getComputedStyle(document.documentElement).getPropertyValue("--radius-bubble").trim() || "0px";
    const r = (el) => getComputedStyle(el).borderTopLeftRadius;
    const els = [chat.querySelector(".chat-conv > .msg.claude"), chat.querySelector(".msg.user .bubble"), chat.querySelector(".msg.day span"),
                 chat.querySelector(".msg.note.auto summary"), chat.querySelector(".work > .work-head")];
    return { want, got: els.map((el) => (el ? r(el) : "none")) }; });
  check(where, square.got.every((x) => x === (square.want === "0" ? "0px" : square.want)), `square as the app: bubbles, days, quiet lines, steps (${JSON.stringify(square)})`);
  check(where, c.left && c.right, "its on the left, yours on the right");
  check(where, c.stamps && c.ticks && c.inside, "each with its time in its corner, yours with ticks");
  check(where, JSON.stringify(c.days) === JSON.stringify(["Yesterday", "Today"]), `the day between them (${c.days.join(", ")})`);
  check(where, c.auto.length === 2 && c.auto[0] === "Automatic" && /From post-amarchy/.test(c.auto[1]) && !c.autoYou,
        `what a timer and another chat sent: quiet lines in the middle, not yours (${c.auto.join(", ")})`);
  check(where, c.work && c.work.head && c.work.body === 0 && c.work.after, `its steps: one quiet line after what it said, folded (${JSON.stringify(c.work)})`);
  check(where, c.said[0] === "On it." && /Found two/.test(c.said[1]), `what it said on the way is a message (${c.said.slice(0, 2).join(" | ")})`);
  check(where, c.head && c.head.name === "Scout" && c.head.pic && !c.state, `the bar: its picture and name, no state box (${JSON.stringify(c.head)})`);
  await p.screenshot({ path: path.join(SHOTS, `${where}-chat.png`) });
  const old = await p.evaluate(() => { const chat = [...document.querySelectorAll(".chat.bubbles")].find((x) => x.offsetParent);
    const m = [...chat.querySelectorAll(".chat-conv > .msg.claude")].pop();
    return { folds: m.querySelectorAll(".ufold").length, parts: m.querySelectorAll(".tsec").length, words: /It has the demo GIF/.test(m.innerText),
             goal: /Post every day/.test(m.innerText), choices: [...m.querySelectorAll(".choices .bq-opt")].map((b) => b.innerText) }; });
  check(where, !old.folds && !old.parts && old.words && !old.goal && old.choices.join() === "Post it,Wait",
        `an old reply reads as written: nothing folded, no parts, its goal not shown, its question to tap (${JSON.stringify(old)})`);
  await p.evaluate(() => { const ch = chatsOpen.get("scout-scout"); ch.toBottom(true); });
  await sleep(200);
  await p.screenshot({ path: path.join(SHOTS, `${where}-chat-end.png`) });

  // A tap opens its steps; a tap on a quiet line, all it said.
  await p.evaluate(() => { const chat = [...document.querySelectorAll(".chat.bubbles")].find((x) => x.offsetParent); chat.querySelector(".work-head").click(); chat.querySelector(".msg.note.auto summary").click(); });
  check(where, await p.evaluate(() => { const chat = [...document.querySelectorAll(".chat.bubbles")].find((x) => x.offsetParent);
    return chat.querySelector(".work-body").getBoundingClientRect().height > 0 && /SKILL\.md/.test(chat.querySelector(".msg.note.auto .auto-body").innerText); }), "a tap opens its steps, and a quiet line's words");

  // Typing: three dots, and typing… on the bar.
  await p.evaluate(() => {
    const ch = chatsOpen.get("scout-scout");
    ch.live = { state: "working", pending: [], queue: [], working_since: Date.now() / 1000 };
    ch.row = { ...ch.row, status: "working" };
    if (ch.opts.onSession) ch.opts.onSession(ch.row);
    ch.renderTail();
    window.__rows = { ...(window.__rows || {}), "scout-scout": { status: "working" } };
    app.view = { ...app.view, sessions: app.view.sessions.map((x) => (x.id === "scout-scout" ? { ...x, status: "working" } : x)) };
    refresh();
  });
  check(where, await until(p, () => { const t = [...document.querySelectorAll(".chat.bubbles .msg.claude.typing")].find((x) => x.offsetParent); return !!t && t.querySelectorAll(".dots i").length === 3; }),
        "working: three dots in a bubble");
  check(where, await until(p, () => [...document.querySelectorAll(".head-sub")].some((x) => x.offsetParent && x.innerText === "typing…")), "and typing… under its name");
  check(where, await p.evaluate(() => ![...document.querySelectorAll(".chat.bubbles .working")].some((x) => x.offsetParent)), "not the working line of a working chat");
  // Writing: each message a bubble as it comes, the one being written with the caret; no --- shown.
  await p.evaluate(() => { const ch = chatsOpen.get("scout-scout"); ch.live = { ...ch.live, partial: "Found **three** posts.\n---\nThe best one is on Om" }; ch.renderTail(); });
  check(where, await until(p, () => { const m = [...document.querySelectorAll(".chat.bubbles .stream-msgs > .msg.claude")].filter((x) => x.offsetParent);
    return m.length === 2 && /Found three posts/.test(m[0].innerText) && !m[0].querySelector(".caret") && /The best one is on Om/.test(m[1].innerText)
      && !!m[1].querySelector(".caret") && !/---/.test(m[0].innerText + m[1].innerText); }), "writing: a bubble a message as it comes, the caret in the last");
  await p.screenshot({ path: path.join(SHOTS, `${where}-writing.png`) });
  await p.evaluate(() => { const ch = chatsOpen.get("scout-scout"); ch.live = { ...ch.live, partial: "" }; ch.endStream(); ch.renderTail(); });
  await p.screenshot({ path: path.join(SHOTS, `${where}-typing.png`) });

  // What you send: your bubble at once, its time and a tick.
  await p.evaluate(() => { const ch = chatsOpen.get("scout-scout"); ch.live = { state: "idle", pending: [], queue: [] }; ch.row = { ...ch.row, status: "idle" }; ch.renderTail(); });
  // Resting, the box alone (no model, effort or mode over it); writing, they're there.
  check(where, await p.evaluate(() => { document.activeElement.blur(); const ch = chatsOpen.get("scout-scout"); return !ch.pills.getClientRects().length; }), "resting: the box alone, no menus over it");
  await p.evaluate(() => chatsOpen.get("scout-scout").input.focus());
  check(where, await until(p, () => chatsOpen.get("scout-scout").pills.getClientRects().length > 0), "writing: the model, effort and mode over it");
  await p.evaluate(() => { const ch = chatsOpen.get("scout-scout"); ch.opts.onSent = null; ch.input.value = "Great, post the first one"; ch.typed(); ch.send(); });
  check(where, await until(p, () => { const b = document.querySelector(".chat.bubbles .chat-outbox .msg.user .bubble");
    return !!b && /post the first/.test(b.innerText) && !!b.querySelector(".stamp.sent .ticks"); }), "sent: your bubble at once, with its time and a tick");
  await sleep(200);
  await p.screenshot({ path: path.join(SHOTS, `${where}-sent.png`) });

  // A working chat keeps its look: no bubbles.
  await p.evaluate(() => { if (typeof boardBack === "function") boardBack(); });
  await sleep(300);
  await p.evaluate(() => todayOpen(row("proj-fresh")));
  check(where, await until(p, () => [...document.querySelectorAll(".chat")].some((x) => x.offsetParent && x.querySelector(".msg.claude"))), "a working chat opens");
  check(where, await p.evaluate(() => { const chat = [...document.querySelectorAll(".chat")].find((x) => x.offsetParent);
    return !chat.matches(".bubbles") && !chat.querySelector(".stamp, .msg.day") && !!chat.querySelector(".head-state, .chat-conv"); }), "a working chat: as it was, no bubbles, no times");
  check(where, await p.evaluate(() => [...document.querySelectorAll(".head-state")].some((x) => x.offsetParent)), "its bar keeps its state box");
  check(where, !p.errors.length, `no page errors (${p.errors.join("; ")})`);
  await p.context().close();
}

if (require.main === module) (async () => {
  const pw = loadPlaywright();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-chat-view-home-"));
  const port = await freePort();
  const server = await startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  try {
    for (const layout of ["phone", "wide"]) {
      if (ONLY && ONLY !== layout) continue;
      console.log(layout);
      await run(browser, port, layout).catch((e) => check(layout, false, `crashed: ${e.stack}`));
    }
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
