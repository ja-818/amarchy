// A chat you open from home shows its latest message: on the top of Claude's
// last reply when it doesn't fit the screen, else at the very end. Every time
// you open it, wherever you left it, and whatever came while you were away.
// In the real app (the phone's and the wide layout's), opened from its card:
//
//   opened for the first time
//   opened again, a new reply in since (long, then short): on that one,
//     not on the one you read last time (it's drawn at once as you left it,
//     and the stream's newer messages come after)
//   the same, with its stream slow to come, or from a later start (a long
//     transcript is read from its latest part)
//   opened again with nothing new, after reading higher up: on the reply
//   landed, a card coming into the dock: still on the reply's top
//   landed, then you scroll (the wheel, a finger): what comes after doesn't
//     move you, and Go to the latest shows
//   opened while Claude works: at the end; its turn ending, not moved
//     meanwhile: on its reply's top
//   its stream coming back (the phone woke): moved, where you are stays;
//     not moved, on the newest reply that came meanwhile
//
// Each layout runs twice: as Chrome, and as Safari (no scroll anchoring, as
// on a Mac and an iPhone).
//
//   node test/chat-open.js          both layouts, as both browsers
//   node test/chat-open.js phone    one layout (phone | wide)
//
// Needs what test/today-view.js needs (Chromium, playwright-core). It starts
// its own app server from this checkout's bin/amarchy, with a home of its
// own. Exits 0 when every check passed.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadPlaywright, freePort, startServer, findChrome, until, sleep, check, failures, T } = require("./today-view.js");

const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "chat-open-"));
const ONLY = process.argv[2];
const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  wide: { viewport: { width: 1280, height: 800 } },
};

const ID = "proj-talk";
const CHATS = [
  { id: ID, repo: "proj", name: "talk", task: "Fix: the login loop", status: "idle", engine: "chat", path: "/tmp/t", today: T({ goal: "Fix the login loop" }) },
];
const paras = (what) => Array.from({ length: 30 }, (_, i) => `${what}, paragraph ${i + 1}: words enough to make it longer than a phone or a computer's screen.`).join("\n\n");
const user = (n, text) => ({ kind: "user", text, turn: true, key: `u${n}:0`, rec: `u${n}`, at: "" });
const claude = (n, text) => ({ kind: "claude", text, key: `c${n}:0`, at: "" });
const LONG = (what) => `${what} is done.\n\n${paras(what)}`;
const V1 = [user(1, "Plan it"), claude(1, LONG("The plan"))];
const V2 = [...V1, user(2, "Build it"), claude(2, LONG("The build"))];
const V3 = [...V2, user(3, "Ship it"), claude(3, "Shipped.")];
const V4 = [...V3, user(4, "Write the docs"), claude(4, LONG("The docs"))];
const V5 = [...V4, user(5, "Check the guide"), claude(5, LONG("The guide"))];

async function page(browser, layout, engine, port) {
  const ctx = await browser.newContext({ ...LAYOUTS[layout], baseURL: `http://127.0.0.1:${port}` });
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  // The chat's stream, as the server sends it: what the test says is there now.
  p.now = { items: V1, start: 0, state: "idle", held: 0 };
  await p.route("**/api/session/*/stream", async (r) => {
    const { items, start, state, held } = p.now;
    if (held) await sleep(held);
    const c = { ...CHATS[0], status: state === "working" ? "working" : "idle" };
    const ev = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    r.fulfill({ status: 200, contentType: "text/event-stream",
                body: `retry: 600000\n\n${ev("session", c)}${ev("live", { state, pending: [], queue: [] })}${ev("conversation", { reset: true, items, start })}${ev("screen", { live: true })}` });
  });
  await p.route("**/api/session/*/composer", (r) => r.fulfill({ json: { engine: "chat", commands: [], models: [], model: "opus", mode: "default" } }));
  await p.route("**/api/session/*/agent", (r) => r.fulfill({ json: { agent: {}, live: {} } }));
  await p.route("**/api/session/*/seen", (r) => r.fulfill({ json: { ok: true } }));
  await p.addInitScript(({ chats, safari }) => {
    Object.defineProperty(Navigator.prototype, "standalone", { get: () => true });
    if (safari) addEventListener("DOMContentLoaded", () => document.head.append(Object.assign(document.createElement("style"), { textContent: "* { overflow-anchor: none !important; }" })));
    try { localStorage.setItem("tour", "1"); localStorage.setItem("amarchy-push", "no"); } catch (e) { /* no storage yet */ }
    window.__chat = () => (app.desk ? desk.chat : app.session && app.session.chat);
    const parse = JSON.parse;
    JSON.parse = function (text, ...rest) {
      const v = parse.call(this, text, ...rest);
      if (v && typeof v === "object" && Array.isArray(v.sessions) && "share" in v) {
        v.sessions = chats.map((c) => ({ ...c, today: { ...c.today } }));
        v.projects = [{ name: "proj", sessions: 1 }];
        v.today = { loops: [], source: "", error: "", sent: {}, assistant: null };
      }
      return v;
    };
  }, { chats: CHATS, safari: engine === "safari" });
  return p;
}

// Opened from its card on home, as a tap (down, up, click), and given its
// time to land (the stream, then a moment).
async function open(p) {
  await p.evaluate((id) => {
    const head = document.querySelector(`.tcard[data-id="${id}"] .today-go`);
    head.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    head.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
    head.click();
  }, ID);
  await until(p, (id) => { const c = __chat(); return c && c.id === id && c.scroller.isConnected && !!document.querySelector(".chat .msg.claude"); }, ID);
  await sleep((p.now.held || 0) + 600);
}

async function home(p) {
  await p.evaluate(() => { if (app.desk) boardBack(); else go("#/"); });
  await until(p, () => !!document.querySelector(".tcard .today-go") && !(app.desk ? desk.current : app.session));
  await sleep(200);
}

// Where the view is: how far from the end, and the last reply's top on screen and its words.
const at = (p) => p.evaluate(() => {
  const c = __chat(), s = c.scroller, v = s.getBoundingClientRect();
  const replies = [...c.conv.querySelectorAll(":scope > .msg.claude")];
  const last = replies.at(-1);
  const inView = replies.filter((r) => { const b = r.getBoundingClientRect(); return b.bottom > v.top + 4 && b.top < v.bottom - 4; })
    .map((r) => r.innerText.slice(0, 20));
  return { top: Math.round(s.scrollTop), fromBottom: Math.round(s.scrollHeight - s.clientHeight - s.scrollTop), replyTop: Math.round(last.getBoundingClientRect().top - v.top),
           last: last.innerText.slice(0, 20), inView, latestHidden: c.latest.hidden };
});
const onReply = (a, words) => a.replyTop >= 0 && a.replyTop <= 24 && a.last.startsWith(words);
const atEnd = (a, words) => a.fromBottom <= 2 && a.last.startsWith(words) && a.latestHidden;
const say = (a) => `${a.replyTop}px from the top, ${a.fromBottom}px from the end, in sight: ${a.inView.join(" | ")}`;

async function run(browser, layout, engine, port) {
  const as = `${layout} as ${engine}`;
  const p = await page(browser, layout, engine, port);
  await p.goto("/");
  await until(p, () => typeof app !== "undefined" && app.view && document.querySelector(".tcard .today-go"));
  const shot = (name) => p.screenshot({ path: path.join(SHOTS, `${layout}-${engine}-${name}.png`) });
  const scrollUp = () => p.evaluate(() => { __chat().scroller.scrollTop = 0; });

  // The first time.
  await open(p);
  let a = await at(p);
  check(as, onReply(a, "The plan"), `opened the first time: on the top of its reply (${say(a)})`);
  await shot("first");

  // Again, a long reply in since: on that one, not the one read last time.
  await home(p);
  p.now = { ...p.now, items: V2 };
  await open(p);
  a = await at(p);
  check(as, onReply(a, "The build"), `opened again, a long reply in since: on its top (${say(a)})`);
  await shot("new-long-reply");

  // Again, a short one in since, read higher up before: at the end.
  await scrollUp();
  await sleep(100);
  await home(p);
  p.now = { ...p.now, items: V3 };
  await open(p);
  a = await at(p);
  check(as, atEnd(a, "Shipped"), `opened again, a short reply in since: at the very end (${say(a)})`);
  await shot("new-short-reply");

  // Again, its stream slow to come (the conversation drawn as you left it first).
  await home(p);
  p.now = { ...p.now, items: V4, held: 900 };
  await open(p);
  a = await at(p);
  check(as, onReply(a, "The docs"), `opened again, its stream slow, a long reply in since: on its top (${say(a)})`);
  p.now.held = 0;

  // Again, the stream from a later start (a long transcript, read from its latest part).
  await scrollUp();
  await sleep(100);
  await home(p);
  p.now = { ...p.now, items: V5.slice(4), start: 9000 };
  await open(p);
  a = await at(p);
  check(as, onReply(a, "The guide"), `opened again, its stream from a later start, a long reply in since: on its top (${say(a)})`);

  // Again with nothing new, read higher up before: on the reply.
  await scrollUp();
  await sleep(100);
  await home(p);
  await open(p);
  a = await at(p);
  check(as, onReply(a, "The guide"), `opened again, nothing new, read higher up before: on the reply (${say(a)})`);

  // Landed, and a card comes into the dock (Claude asks to run something): still on the reply's top.
  await p.evaluate(() => {
    const c = __chat();
    c.live = { state: "waiting", pending: [{ request_id: "req-1", tool: "Bash", input: { command: "ls", description: "List the files" } }], queue: [] };
    c.renderDock();
  });
  await sleep(300);
  a = await at(p);
  const card = await p.evaluate(() => !!document.querySelector(".chat-dock .card"));
  check(as, card && onReply(a, "The guide"), `landed, a card coming into the dock: still on the reply's top (${say(a)})`);
  await shot("card-came");
  await p.evaluate(() => { const c = __chat(); c.live = { state: "idle", pending: [], queue: [] }; c.renderDock(); });
  await sleep(200);

  // Landed, then you scroll (the wheel): a new reply after doesn't move you.
  const mid = await p.evaluate(() => { const r = __chat().scroller.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.mouse.move(mid.x, mid.y);
  await p.mouse.wheel(0, -500);
  await sleep(400);
  let was = await at(p);
  const U6 = user(6, "And the tests"), C6 = claude(6, LONG("The tests"));
  await p.evaluate(({ u, c }) => __chat().conversation({ items: [u, c] }), { u: U6, c: C6 });
  await sleep(300);
  a = await at(p);
  check(as, was.top > 0 && Math.abs(a.top - was.top) <= 2 && a.inView.join() === was.inView.join() && !a.latestHidden && a.last.startsWith("The tests"),
        `scrolled with the wheel, then a new reply: the view stays, Go to the latest shows (was: ${say(was)}; now: ${say(a)})`);
  await home(p);

  // A finger on it, then a new reply: it stays too.
  p.now = { ...p.now, items: [...V5, U6, C6], start: 0 };
  await open(p);
  await p.evaluate(() => {
    const s = __chat().scroller;
    s.dispatchEvent(new TouchEvent("touchstart", { bubbles: true }));
    s.scrollTop -= 400;
  });
  await sleep(300);
  was = await at(p);
  const U7 = user(7, "And the docs again"), C7 = claude(7, LONG("The second docs"));
  await p.evaluate(({ u, c }) => __chat().conversation({ items: [u, c] }), { u: U7, c: C7 });
  await sleep(300);
  a = await at(p);
  check(as, Math.abs(a.top - was.top) <= 2 && a.inView.join() === was.inView.join() && !a.latestHidden && a.last.startsWith("The second docs"),
        `a finger moved it, then a new reply: the view stays (was: ${say(was)}; now: ${say(a)})`);
  await home(p);

  // While Claude works: at the end; its turn ending, not moved meanwhile: on its reply's top.
  p.now = { ...p.now, items: [...V5, U6, C6, U7, C7], state: "working" };
  await open(p);
  a = await at(p);
  check(as, a.fromBottom <= 2, `opened while Claude works: at the end (${say(a)})`);
  await shot("working");
  await p.evaluate(() => { const c = __chat(); c.live = { state: "idle", pending: [], queue: [] }; c.renderDock(); c.renderTail(); });
  await sleep(300);
  a = await at(p);
  check(as, onReply(a, "The second docs"), `and its turn ending, not moved meanwhile: on its reply's top (${say(a)})`);
  await home(p);
  p.now = { ...p.now, state: "idle" };

  // Its stream coming back (the phone woke), a new reply in meanwhile: moved
  // before, where you are stays; not moved, on the newest.
  const U8 = user(8, "Now the tour"), C8 = claude(8, LONG("The tour")), U9 = user(9, "And the menu"), C9 = claude(9, LONG("The menu"));
  await open(p);
  await p.mouse.move(mid.x, mid.y);
  await p.mouse.wheel(0, -700);
  await sleep(400);
  was = await at(p);
  p.now = { ...p.now, items: [...p.now.items, U8, C8] };
  await p.evaluate(() => __chat().reopen());
  await sleep(600);
  a = await at(p);
  check(as, Math.abs(a.top - was.top) <= 2 && a.inView.join() === was.inView.join() && !a.latestHidden && a.last.startsWith("The tour"),
        `moved, then its stream coming back with a new reply: where you are stays (was: ${say(was)}; now: ${say(a)})`);
  await home(p);
  await open(p);
  a = await at(p);
  check(as, onReply(a, "The tour"), `opened again after that: on the newest reply (${say(a)})`);
  p.now = { ...p.now, items: [...p.now.items, U9, C9] };
  await p.evaluate(() => __chat().reopen());
  await sleep(600);
  a = await at(p);
  check(as, onReply(a, "The menu"), `not moved, its stream coming back with a new reply: on that one (${say(a)})`);
  await home(p);

  // An open chat that can't be closed (an error in it, as on Julian's M5,
  // where then no chat opened): back home, and the next opens all the same.
  await open(p);
  await p.evaluate(() => { __chat().close = () => { throw new Error("a chat that can't close"); }; });
  await home(p);
  check(as, await p.evaluate(() => !!document.querySelector(".tcard .today-go") && !(app.desk ? desk.chat : app.session)),
        "a chat that can't close: home all the same, the chat let go");
  await open(p);
  check(as, await p.evaluate((id) => { const c = __chat(); return !!c && c.id === id && c.scroller.isConnected; }, ID),
        "and the next chat opens");
  await home(p);

  check(as, !p.errors.length, `no page errors (${p.errors.join("; ")})`);
  await p.context().close();
}

(async () => {
  const pw = loadPlaywright();
  const home_ = fs.mkdtempSync(path.join(os.tmpdir(), "chat-open-home-"));
  const port = await freePort();
  const srv = await startServer(port, home_);
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  try {
    for (const layout of ["phone", "wide"]) {
      if (ONLY && ONLY !== layout) continue;
      for (const engine of ["chrome", "safari"]) {
        console.log(`${layout} as ${engine}`);
        await run(browser, layout, engine, port).catch((e) => check(`${layout} as ${engine}`, false, `crashed: ${e.stack}`));
      }
    }
  } finally {
    await browser.close();
    srv.kill();
    fs.rmSync(home_, { recursive: true, force: true });
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
