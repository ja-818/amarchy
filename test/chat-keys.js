// amarchy's keys, in the real app, three rules: Ctrl+Alt + a key does
// things from anywhere (typing too), as Super does on Omarchy; Esc stops
// Claude, as in Claude Code, and nothing else; the rest only move, or type.
//
//   A chat opens with the keys in its box, to write, a click or Enter on its
//   card (on a phone's touch, none: its keyboard would come up over the
//   chat). ↑ with nothing above it in the box goes up onto the messages, ↓ on
//   the latest back down, i too; Page Up / Page Down scroll them from the box.
//   Esc: Claude at work, a stop (from the box, a message, nowhere in it; on
//   its question too, a no); Claude done, nothing at all (not back, not out
//   of the box). Ctrl+Alt+← (H) back to the board, → (L) into the chat again,
//   ↑ ↓ (J K) the board's Chats and Tasks, M the menu (a chat by its name as you
//   type), T its terminal and back, / the keys. Plain letters on the board do
//   nothing but move.
//
// Three layouts: the phone's (touch), the phone layout on a computer (a
// narrow window), and the wide one. With screenshots.
//
//   node test/chat-keys.js          every layout
//   node test/chat-keys.js wide     one (phone | narrow | wide)
//
// Needs what test/today-view.js needs (Chromium, playwright-core). It starts
// its own app server from this checkout's bin/amarchy, with a home of its
// own. Exits 0 when every check passed.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const homes = require("./homes");      // (test/homes.js: its home gone with it, however it ends)
const { loadPlaywright, freePort, startServer, findChrome, until, sleep, check, failures, T } = require("./today-view.js");

const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "chat-keys-"));
const ONLY = process.argv[2];
const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  narrow: { viewport: { width: 480, height: 844 } },
  wide: { viewport: { width: 1280, height: 800 } },
};

const ID = "proj-keys", TWO = "proj-other";
const CHATS = [
  { id: ID, repo: "proj", name: "keys", task: "Fix: the login loop", status: "idle", engine: "chat", path: "/tmp/k", today: T({ goal: "Fix the login loop" }) },
  { id: TWO, repo: "proj", name: "other", task: "Docs: the keys page", status: "idle", engine: "chat", path: "/tmp/o", today: T({ goal: "Write the keys page" }) },
];
const paras = (what) => Array.from({ length: 30 }, (_, i) => `${what}, paragraph ${i + 1}: words enough to make it longer than a phone or a computer's screen.`).join("\n\n");
const user = (n, text) => ({ kind: "user", text, turn: true, key: `u${n}:0`, rec: `u${n}`, at: "" });
const claude = (n, text) => ({ kind: "claude", text, key: `c${n}:0`, at: "" });
const ITEMS = [user(1, "Plan it"), claude(1, `The plan is done.\n\n${paras("The plan")}`), user(2, "Ship it"), claude(2, "Shipped.")];

async function page(browser, layout, port) {
  const ctx = await browser.newContext({ ...LAYOUTS[layout], baseURL: `http://127.0.0.1:${port}` });
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  p.stops = [];
  await p.route("**/api/session/*/stream", (r) => {
    const id = decodeURIComponent(new URL(r.request().url()).pathname.split("/")[3]);
    const c = CHATS.find((x) => x.id === id) || CHATS[0];
    const ev = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    r.fulfill({ status: 200, contentType: "text/event-stream",
                body: `retry: 600000\n\n${ev("session", c)}${ev("live", { state: "idle", pending: [], queue: [] })}${ev("conversation", { reset: true, items: ITEMS, start: 0 })}${ev("screen", { live: true })}` });
  });
  await p.route("**/api/session/*/interrupt", (r) => { p.stops.push(r.request().url()); r.fulfill({ json: { ok: true } }); });
  await p.route("**/api/session/*/keys", (r) => { p.stops.push(r.request().url()); r.fulfill({ json: { ok: true } }); });
  await p.route("**/api/session/*/composer", (r) => r.fulfill({ json: { engine: "chat", commands: [], models: [], model: "opus", mode: "default" } }));
  await p.route("**/api/session/*/agent", (r) => r.fulfill({ json: { agent: {}, live: {} } }));
  await p.route("**/api/session/*/seen", (r) => r.fulfill({ json: { ok: true } }));
  await p.addInitScript(({ chats }) => {
    Object.defineProperty(Navigator.prototype, "standalone", { get: () => true });
    try { localStorage.setItem("tour", "1"); localStorage.setItem("amarchy-push", "no"); } catch (e) { /* no storage yet */ }
    window.__chat = () => (app.desk ? desk.chat : app.session && app.session.chat);
    const parse = JSON.parse;
    JSON.parse = function (text, ...rest) {
      const v = parse.call(this, text, ...rest);
      if (v && typeof v === "object" && Array.isArray(v.sessions) && "share" in v) {
        v.sessions = chats.map((c) => ({ ...c, today: { ...c.today } }));
        v.projects = [{ name: "proj", sessions: chats.length }];
        v.today = { loops: [], source: "", error: "", sent: {}, assistant: null };
      }
      return v;
    };
  }, { chats: CHATS });
  return p;
}

const opened = (p, id = ID) => until(p, (id) => { const c = __chat(); return c && c.id === id && c.scroller.isConnected && !!document.querySelector(".chat .msg.claude"); }, id);
const isHome = (p) => until(p, () => !!document.querySelector(".tcard .today-go") && !(app.desk ? desk.current : app.session));
const openNow = (p) => p.evaluate(() => (app.desk ? desk.current : app.session ? app.session.id : null));

// Opened from its card: with a click (a tap on the phone), or with the keys (Enter on it).
async function openBy(p, how) {
  if (how === "click") {
    await p.evaluate((id) => {
      const head = document.querySelector(`.tcard[data-id="${id}"] .today-go`);
      head.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: matchMedia("(pointer: coarse)").matches ? "touch" : "mouse" }));
      head.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
      head.click();
    }, ID);
  } else {
    await p.evaluate((id) => document.querySelector(`.tcard[data-id="${id}"] .today-go`).focus(), ID);
    await p.keyboard.press("Enter");
  }
  await opened(p);
  await sleep(700);      // the stream in, the dock drawn again: the keys stay
}

async function home(p) {
  await p.evaluate(() => { if (app.desk) boardBack(); else go("#/"); });
  await isHome(p);
  await sleep(200);
}

// Where the keys are: the box, a message (and whether it's the latest), else what.
const keys = (p) => p.evaluate(() => {
  const c = __chat(), a = document.activeElement;
  if (!c || !(app.desk ? desk.current : app.session)) return { where: "home" };
  if (a === c.input) return { where: "box", value: c.input.value };
  const items = c.navItems(), at = items.findIndex((it) => it === a || it.contains(a));
  if (at >= 0) return { where: "message", latest: at === items.length - 1, lit: !!items[at].classList.contains("nav-sel") };
  return { where: a ? `${a.tagName.toLowerCase()}.${a.className}` : "none" };
});
const scrollTop = (p) => p.evaluate(() => Math.round(__chat().scroller.scrollTop));
const live = (p, l) => p.evaluate((l) => {
  const c = __chat();
  c.live = { pending: [], queue: [], ...l };
  c.row = { ...c.row, status: l.state === "working" ? "working" : l.pending && l.pending.length ? "waiting" : "idle" };
  c.renderDock();
  c.renderTail();
}, l);

async function run(browser, layout, port) {
  const as = layout;
  const p = await page(browser, layout, port);
  await p.goto("/");
  await until(p, () => typeof app !== "undefined" && app.view && document.querySelector(".tcard .today-go"));
  const shot = (name) => p.screenshot({ path: path.join(SHOTS, `${layout}-${name}.png`) });
  const desk = await p.evaluate(() => app.desk);
  check(as, desk === (layout === "wide"), `the ${layout === "wide" ? "wide" : "phone"} layout`);

  // Opened with a click: the box (a phone's tap: nothing, its keyboard stays down).
  await openBy(p, "click");
  let k = await keys(p);
  if (layout === "phone") check(as, k.where !== "box", `opened with a tap: the keyboard stays down (keys: ${k.where})`);
  else check(as, k.where === "box", `opened with a click: the keys in the box (${k.where})`);
  await home(p);

  // Opened with the keys: the box, to write.
  await openBy(p, "keys");
  k = await keys(p);
  check(as, k.where === "box", `opened with Enter on its card: the keys in the box, not on a message (${k.where})`);
  check(as, await p.evaluate(() => __chat().stopBtn.title === "Stop Claude (Esc)"), "Stop says its key, Esc");
  await shot("opened");

  // Typed into straight away.
  await p.keyboard.type("Looks");
  k = await keys(p);
  check(as, k.where === "box" && k.value === "Looks", `typing goes into the box (${JSON.stringify(k)})`);

  // ↑ with words above it in the box stays in it; with nothing above it, up onto the latest message.
  await p.keyboard.press("ArrowUp");
  k = await keys(p);
  check(as, k.where === "box", `↑ with words before it: still in the box (${k.where})`);
  await p.keyboard.press("ArrowUp");
  k = await keys(p);
  check(as, k.where === "message" && k.latest && k.lit, `↑ again, nothing above it: on the latest message, lit (${JSON.stringify(k)})`);
  await shot("up-on-messages");

  // ↓ on the latest: down into the box again, the draft as it was.
  await p.keyboard.press("ArrowDown");
  k = await keys(p);
  check(as, k.where === "box" && k.value === "Looks", `↓ on the latest: the box again, its words kept (${JSON.stringify(k)})`);
  await p.evaluate(() => { const c = __chat(); c.input.value = ""; c.typed(); });

  // Claude done: Esc does nothing at all, in the box or on a message.
  p.stops.length = 0;
  await p.keyboard.press("Escape");
  await sleep(200);
  k = await keys(p);
  check(as, k.where === "box" && !p.stops.length, `Claude done, Esc in the box: nothing, the keys still there (${k.where}; ${p.stops.join(", ") || "nothing sent"})`);
  await p.keyboard.press("ArrowUp");
  await p.keyboard.press("k");
  await p.keyboard.press("Escape");
  await sleep(200);
  k = await keys(p);
  check(as, k.where === "message" && !k.latest && !p.stops.length, `Claude done, Esc on a message: nothing, not back (${JSON.stringify(k)})`);
  await p.keyboard.press("i");
  k = await keys(p);
  check(as, k.where === "box" && k.value === "", `i: the box, nothing typed in it (${JSON.stringify(k)})`);

  // Page Up / Page Down in the box: the conversation scrolls, the keys stay in the box.
  const t0 = await scrollTop(p);
  await p.keyboard.press("PageUp");
  await sleep(150);
  const t1 = await scrollTop(p);
  k = await keys(p);
  check(as, t1 < t0 && k.where === "box", `Page Up in the box: the messages scroll up (${t0} → ${t1}), the keys still in the box (${k.where})`);
  await p.keyboard.press("PageDown");
  await sleep(150);
  const t2 = await scrollTop(p);
  check(as, t2 > t1 && (await keys(p)).where === "box", `Page Down: back down (${t1} → ${t2})`);

  // Claude at work: Esc stops it, wherever the keys are in the chat, and the chat stays open.
  await live(p, { state: "working" });
  p.stops.length = 0;
  await p.keyboard.press("Escape");
  await sleep(300);
  check(as, p.stops.length === 1 && /proj-keys\/interrupt/.test(p.stops[0]), `Claude at work, Esc in the box: a stop (${p.stops.join(", ") || "nothing sent"})`);
  k = await keys(p);
  check(as, k.where === "box" && (await openNow(p)) === ID, `and the chat stays open, the keys in its box (${k.where})`);
  await shot("esc-stopped");
  await p.keyboard.press("ArrowUp");
  await p.keyboard.press("Escape");
  await sleep(300);
  k = await keys(p);
  check(as, p.stops.length === 2 && k.where === "message" && (await openNow(p)) === ID, `on a message: a stop too, never back (${p.stops.length}; ${k.where})`);

  // Its question (a permission waiting): Esc is a stop, a no, as in Claude Code.
  await live(p, { state: "waiting", pending: [{ request_id: "req-1", tool: "Bash", input: { command: "ls", description: "List the files" } }] });
  await p.evaluate(() => { const c = __chat(); c.takeKeys(); });
  check(as, await p.evaluate(() => __chat().dock.contains(document.activeElement)), "a question up: the keys on its card");
  await p.keyboard.press("Escape");
  await sleep(300);
  check(as, p.stops.length === 3 && (await openNow(p)) === ID, `Esc on its question: a stop, Claude takes it back (${p.stops.length})`);
  await live(p, { state: "idle" });
  await p.evaluate(() => __chat().takeKeys());

  // Ctrl+Alt: from the box, typing, the keys do things.
  await p.keyboard.type("half a thought");
  await p.keyboard.press("Control+Alt+ArrowLeft");
  check(as, await isHome(p), "Ctrl+Alt+← from the box, typing: back to the board");
  check(as, p.stops.length === 3, `and nothing stopped (${p.stops.length})`);
  await p.keyboard.press("Control+Alt+ArrowRight");
  check(as, await opened(p), "Ctrl+Alt+→: into it again");
  await sleep(500);
  k = await keys(p);
  check(as, k.where === "box" && k.value === "half a thought", `the keys in its box, what you wrote still there (${JSON.stringify(k)})`);
  await p.evaluate(() => { const c = __chat(); c.input.value = ""; c.typed(); });

  // Ctrl+Alt+↓ / ↑: Tasks / Chats, the board's tabs (from a chat: the board, on that tab). Not chat to chat.
  const tabNow = () => p.evaluate(() => (!(app.desk ? desk.current : app.session) ? board.tab : "chat"));
  await p.keyboard.press("Control+Alt+ArrowDown");
  check(as, await until(p, () => !(app.desk ? desk.current : app.session) && board.tab === "tasks"), `Ctrl+Alt+↓ from a chat: the board, on Tasks (${await tabNow()})`);
  await p.keyboard.press("Control+Alt+ArrowDown");
  await sleep(200);
  check(as, (await tabNow()) === "tasks", "again: Tasks still (the last tab)");
  await p.keyboard.press("Control+Alt+ArrowUp");
  check(as, await until(p, () => board.tab === "chats"), `Ctrl+Alt+↑: Chats (${await tabNow()})`);

  // J and K, as the tabs sit: K Tasks, J Chats; L into the chat lit, H back; from the box, typing.
  await p.keyboard.press("Control+Alt+KeyK");
  check(as, await until(p, () => board.tab === "tasks"), "Ctrl+Alt+K: Tasks");
  await p.keyboard.press("Control+Alt+KeyJ");
  check(as, await until(p, () => board.tab === "chats"), "Ctrl+Alt+J: Chats");
  await p.evaluate((id) => boardSelectId(id), ID);
  await p.keyboard.press("Control+Alt+KeyL");
  check(as, await opened(p, ID), "Ctrl+Alt+L: into the chat lit");
  await sleep(400);
  await p.keyboard.type("hjkl");
  await p.keyboard.press("Control+Alt+KeyH");
  check(as, await isHome(p), "Ctrl+Alt+H from the box, typing: back to the board");
  await p.keyboard.press("Control+Alt+KeyL");
  check(as, await opened(p, ID), "Ctrl+Alt+L: into it again");
  await sleep(400);
  check(as, (await keys(p)).value === "hjkl", "and nothing typed by them (the box has what you typed)");
  await p.evaluate(() => { const c = __chat(); c.input.value = ""; c.typed(); });

  // Ctrl+Alt+T: its terminal, the keyboard in it; again, back to the chat, the keys in its box.
  await p.keyboard.press("Control+Alt+KeyT");
  check(as, await until(p, () => (app.desk ? sideTab() === "term" : app.session.mode === "terminal")), "Ctrl+Alt+T: its terminal");
  await sleep(400);
  await shot("terminal");
  if (desk) await p.evaluate(() => desk.terminal.focus());
  await p.keyboard.press("Control+Alt+KeyT");
  check(as, await until(p, () => (app.desk ? !sideTab() : app.session.mode === "chat") && document.activeElement === __chat().input), "again: back to the chat, the keys in its box");

  // Ctrl+Alt+Space: nothing of amarchy's (Omarchy's dictation is on Alt+Space).
  await p.keyboard.press("Control+Alt+Space");
  await sleep(250);
  check(as, await p.evaluate(() => !document.querySelector(".picker, .sheet-back")), "Ctrl+Alt+Space: nothing of amarchy's");

  // Ctrl+Alt+M: the menu, a chat by its name as you type.
  await p.keyboard.press("Control+Alt+KeyM");
  const menu = () => p.evaluate(() => { const m = document.querySelector(".picker") || [...document.querySelectorAll(".sheet")].pop(); return m ? m.innerText : ""; });
  await until(p, () => !!document.querySelector(".picker, .sheet-back"));
  const m0 = await menu();
  check(as, /New chat/.test(m0) && !/Docs: the keys page/.test(m0),
        `Ctrl+Alt+M: the menu, no chats in it before you type (${JSON.stringify(m0.slice(0, 300))})`);
  await sleep(500);
  await shot("menu");
  if (desk) await p.keyboard.type("keys page");
  else {      // (a tap on its search first, as on a phone: a box stepped aside for Ctrl+Alt takes text again with a key or a tap)
    await p.click(".sheet .ui-menu-search input");
    await p.fill(".sheet .ui-menu-search input", "keys page");
  }
  check(as, await until(p, () => { const m = document.querySelector(".picker") || [...document.querySelectorAll(".sheet")].pop();
    return !!m && [...m.querySelectorAll(".picker-row, .menu-item")].some((r) => !r.hidden && /Docs: the keys page/.test(r.innerText)); }), "typed: the chat by its name");
  await p.evaluate(() => { const m = document.querySelector(".picker") || [...document.querySelectorAll(".sheet")].pop();
    [...m.querySelectorAll(".picker-row, .menu-item")].find((r) => !r.hidden && /Docs: the keys page/.test(r.innerText)).click(); });
  check(as, await opened(p, TWO), "picked: it opens");

  // Ctrl+Alt+/: the keys, the same on both.
  await p.keyboard.press("Control+Alt+Slash");
  check(as, await until(p, () => /Ctrl\+Alt\+M\b/.test((document.querySelector(".sheet") || {}).innerText || "") && /H \/ L/.test(document.querySelector(".sheet").innerText) && /J \/ K[\s\S]*Chats \/ Tasks/.test(document.querySelector(".sheet").innerText) && /Ctrl twice\s+or\s+Ctrl\+Alt\+D[\s\S]*Dictate/.test(document.querySelector(".sheet").innerText)), "Ctrl+Alt+/: the keys, H / L, J / K and Ctrl twice (dictate) in them");
  await sleep(500);
  await shot("keys");
  await p.keyboard.press("Escape");
  await until(p, () => !document.querySelector(".sheet-back"));

  // Back on the board: plain letters only move.
  await p.keyboard.press("Control+Alt+ArrowLeft");
  await isHome(p);
  for (const key of ["n", "x", "m", "?", "Escape"]) await p.keyboard.press(key);
  await sleep(300);
  check(as, await p.evaluate(() => !document.querySelector(".picker, .sheet-back, .mission, .undo-toast") && document.querySelector(".board-new").hidden && !(app.desk ? desk.current : app.session)),
        "on the board, n, x, m, ? and Esc: nothing");
  await p.keyboard.press("Control+Alt+Enter");
  check(as, await until(p, () => !!document.querySelector(".picker-row, .sheet .menu-item") || !document.querySelector(".board-new").hidden), "Ctrl+Alt+↵: a new chat");

  check(as, !p.errors.length, `no page errors ${p.errors.join(" | ")}`);
  await p.context().close();
}

(async () => {
  const pw = loadPlaywright();
  const home = homes.home("chat-keys");
  const port = await freePort();
  const server = await startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: findChrome(), args: ["--no-sandbox"] });
  try {
    for (const layout of Object.keys(LAYOUTS)) {
      if (ONLY && ONLY !== layout) continue;
      console.log(layout);
      await run(browser, layout, port).catch((e) => check(layout, false, `crashed: ${e.stack}`));
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
