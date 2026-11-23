// A chat's keys, in the real app: it opens with them in its box, to write,
// whether a click or Enter on its card opened it (on a phone's touch, none:
// its keyboard would come up over the chat). From the box: Esc goes up onto
// the latest message, as ↑ does with nothing above it in the box; Page Up /
// Page Down scroll the conversation, the keys still in the box. On the
// messages: i, or ↓ on the latest, the box again; Esc back to the chats.
// Esc never stops Claude, at work or not: a stop by mistake loses a turn.
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
const { loadPlaywright, freePort, startServer, findChrome, until, sleep, check, failures, T } = require("./today-view.js");

const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "chat-keys-"));
const ONLY = process.argv[2];
const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  narrow: { viewport: { width: 480, height: 844 } },
  wide: { viewport: { width: 1280, height: 800 } },
};

const ID = "proj-keys";
const CHATS = [
  { id: ID, repo: "proj", name: "keys", task: "Fix: the login loop", status: "idle", engine: "chat", path: "/tmp/k", today: T({ goal: "Fix the login loop" }) },
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
  p.now = { state: "idle" };
  await p.route("**/api/session/*/stream", (r) => {
    const { state } = p.now;
    const c = { ...CHATS[0], status: state === "working" ? "working" : "idle" };
    const ev = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    r.fulfill({ status: 200, contentType: "text/event-stream",
                body: `retry: 600000\n\n${ev("session", c)}${ev("live", { state, pending: [], queue: [] })}${ev("conversation", { reset: true, items: ITEMS, start: 0 })}${ev("screen", { live: true })}` });
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
        v.projects = [{ name: "proj", sessions: 1 }];
        v.today = { loops: [], source: "", error: "", sent: {}, assistant: null };
      }
      return v;
    };
  }, { chats: CHATS });
  return p;
}

const opened = (p) => until(p, (id) => { const c = __chat(); return c && c.id === id && c.scroller.isConnected && !!document.querySelector(".chat .msg.claude"); }, ID);
const isHome = (p) => until(p, () => !!document.querySelector(".tcard .today-go") && !(app.desk ? desk.current : app.session));

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
  if (!c) return { where: "home" };
  if (a === c.input) return { where: "box", value: c.input.value };
  const items = c.navItems(), at = items.findIndex((it) => it === a || it.contains(a));
  if (at >= 0) return { where: "message", latest: at === items.length - 1, lit: !!items[at].classList.contains("nav-sel") };
  return { where: a ? `${a.tagName.toLowerCase()}.${a.className}` : "none" };
});
const scrollTop = (p) => p.evaluate(() => Math.round(__chat().scroller.scrollTop));
const working = (p, on) => p.evaluate((on) => {
  const c = __chat();
  c.live = { state: on ? "working" : "idle", pending: [], queue: [] };
  c.row = { ...c.row, status: on ? "working" : "idle" };
  c.renderDock();
  c.renderTail();
}, on);

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

  // Esc in the box, Claude not at work: up onto the latest message; i, the box.
  await p.keyboard.press("Escape");
  k = await keys(p);
  check(as, k.where === "message" && k.latest, `Esc in the box, Claude done: on the latest message (${JSON.stringify(k)})`);
  await p.keyboard.press("k");
  k = await keys(p);
  check(as, k.where === "message" && !k.latest, `k: the message before (${JSON.stringify(k)})`);
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

  // Claude at work: Esc in the box is up onto the messages, and again back to the chats; never a stop.
  await working(p, true);
  await sleep(100);
  p.stops.length = 0;
  await p.keyboard.press("Escape");
  await sleep(300);
  k = await keys(p);
  check(as, k.where === "message" && !p.stops.length, `Claude at work, Esc in the box: on the messages, not a stop (${k.where}; ${p.stops.join(", ") || "nothing sent"})`);
  await shot("esc-at-work");
  await p.keyboard.press("Escape");
  check(as, await isHome(p), "Esc on a message: back to the chats");
  await sleep(300);
  check(as, !p.stops.length, `and Claude wasn't stopped (${p.stops.join(", ") || "nothing sent"})`);

  // Claude done: Esc, Esc from the box is back to the chats.
  await openBy(p, "keys");
  await working(p, false);
  p.stops.length = 0;
  await p.keyboard.press("Escape");
  await p.keyboard.press("Escape");
  check(as, await isHome(p), "Claude done: Esc, Esc from the box is back to the chats");
  check(as, !p.stops.length, `nothing stopped (${p.stops.join(", ") || "nothing sent"})`);

  check(as, !p.errors.length, `no page errors ${p.errors.join(" | ")}`);
  await p.context().close();
}

(async () => {
  const pw = loadPlaywright();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "chat-keys-home-"));
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
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
