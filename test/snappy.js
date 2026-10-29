// Snappy: what you do is on screen the moment you do it, never after the
// server answers. In a browser, on the phone and in the wide layout, with the
// server's answers held back (or refused) to tell:
//
//   a message sent: the box empties and it's in the conversation at once;
//     the conversation's own takes its place; refused, its words are back
//   a card answered (a permission): off the dock at once; refused, back
//   a priority: on its card at once
//   Chats | Tasks | Chats: the cards as they were, not drawn again
//   a finger down on a card: its chat's stream asked for before the tap ends
//   a chat opened again: its conversation drawn at once, as it was left
//   a new chat: the box empties, its card ("Starting…") at once; refused, back
//   pressed: a card and a button light the moment they're pressed
//
// And the server: the app's files by build (name?b=<build>, kept for good),
// gzipped, checked by ETag; a page's burst of connections all answered at
// once; what a page did in the list at once, not a second on.
//
//   node test/snappy.js          both layouts
//   node test/snappy.js phone    one layout (phone | wide)
//
// Needs what test/today-view.js needs (Chromium, playwright-core). It starts
// its own app server from this checkout's bin/amarchy, with a home of its
// own. Exits 0 when every check passed.

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "amarchy");
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "snappy-"));
const ONLY = process.argv[2];

const SHIM = `
import importlib.machinery, importlib.util, os, sys, threading
bin, port, home = sys.argv[1], int(sys.argv[2]), sys.argv[3]
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config")
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", bin)
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)
am.app_key(); am.migrate()
st = am.AppState(); st.transcriber = None
Handler = am.app_handler(st, ["tester@test"], "127.0.0.1")
class Local(Handler):
    def parse_request(self):
        ok = super().parse_request()
        if ok and not self.headers.get("Tailscale-User-Login"):
            self.headers["Tailscale-User-Login"] = "tester@test"
        if ok and self.headers.get("Origin"):
            self.headers.replace_header("Origin", "https://" + self.headers.get("Host", ""))
        return ok
server = am.app_server_class()(("127.0.0.1", port), Local)
threading.Thread(target=am.app_watch, args=(st,), daemon=True).start()
print("listening", flush=True)
server.serve_forever()
`;

const failures = [];
function check(where, ok, what) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${where}: ${what}`);
  if (!ok) failures.push(`${where}: ${what}`);
}

function freePort() {
  return new Promise((ok, no) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); });
    s.on("error", no);
  });
}

function startServer(port, home) {
  return new Promise((ok, no) => {
    const py = spawn("python3", ["-c", SHIM, BIN, String(port), home], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    py.stderr.on("data", (d) => { err += d; });
    py.stdout.once("data", () => ok(py));
    py.on("exit", (code) => no(new Error(`the app server stopped (${code}): ${err.slice(-400)}`)));
  });
}

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = path.join(os.homedir(), ".cache", "ms-playwright");
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => d.startsWith("chromium-")).sort().reverse() : [];
  for (const d of dirs) for (const sub of ["chrome-linux64", "chrome-linux"]) {
    const bin = path.join(base, d, sub, "chrome");
    if (fs.existsSync(bin)) return bin;
  }
  return undefined;
}

function loadPlaywright() {
  for (const id of [process.env.PLAYWRIGHT_CORE, "playwright-core", "playwright"]) {
    if (!id) continue;
    try { return require(id); } catch (err) { /* the next one */ }
  }
  console.error("playwright-core not found: set PLAYWRIGHT_CORE to its folder");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(page, fn, arg, ms = 6000) {
  try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (e) { return false; }
}

// A GET to the server, as it came: {status, headers, body (decoded)}.
function get(port, p, headers = {}) {
  return new Promise((ok, no) => {
    const t = Date.now();
    http.get({ host: "127.0.0.1", port, path: p, headers }, (res) => {
      const parts = [];
      res.on("data", (d) => parts.push(d));
      res.on("end", () => {
        let body = Buffer.concat(parts);
        const raw = body.length;
        if (res.headers["content-encoding"] === "gzip") body = zlib.gunzipSync(body);
        ok({ status: res.statusCode, headers: res.headers, body: body.toString(), raw, took: Date.now() - t });
      });
    }).on("error", no);
  });
}

const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  wide: { viewport: { width: 1280, height: 800 } },
};

const NOW = Date.now() / 1000;
const T = (o) => ({ goal: "", state: "", goal_at: 0, asks: [], at: NOW - 600, ...o });
const CHATS = [
  { id: "proj-talk", repo: "proj", name: "talk", task: "Fix: the login loop", status: "idle", engine: "chat", path: "/tmp/t", today: T({ goal: "Fix the login loop" }) },
  { id: "proj-perm", repo: "proj", name: "perm", task: "Deploy: the site", status: "waiting", asks: "Claude asks to run ls", engine: "chat", path: "/tmp/p", today: T({}),
    permission: { request_id: "req-9", tool: "Bash" } },
  { id: "proj-other", repo: "proj", name: "other", task: "Docs: the guide", status: "idle", engine: "chat", path: "/tmp/o", today: T({ goal: "Write the guide" }) },
];
const ITEMS = [
  { kind: "user", text: "Why does the login loop?", key: "u1:0", rec: "u1", turn: true, at: "" },
  { kind: "claude", text: "A stale cookie: the session check reads the old one first.", key: "c1:0", at: "" },
];
// A chat's stream, as the server sends it (the same body each time it's asked for).
function stream(id) {
  const c = CHATS.find((x) => x.id === id) || CHATS[0];
  const live = id === "proj-perm"
    ? { state: "waiting", pending: [{ request_id: "req-9", tool: "Bash", input: { command: "ls", description: "List the files" } }], queue: [] }
    : { state: "idle", pending: [], queue: [] };
  const ev = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  return `retry: 600000\n\n${ev("session", c)}${ev("live", live)}${ev("conversation", { reset: true, items: ITEMS, start: 0 })}${ev("screen", { live: true })}`;
}

async function page(browser, layout, port) {
  const ctx = await browser.newContext({ ...LAYOUTS[layout], baseURL: `http://127.0.0.1:${port}` });
  const p = await ctx.newPage();
  p.errors = [];
  p.streams = [];
  p.held = {};        // route -> {ms, fail}: how the server answers it
  p.on("pageerror", (e) => p.errors.push(e.message));
  await p.route("**/api/session/*/stream", async (r) => {
    const id = decodeURIComponent(r.request().url().split("/api/session/")[1].split("/")[0]);
    p.streams.push(id);
    // Asked for again, held: what's drawn is what the page kept.
    if (p.held.stream) await sleep(p.held.stream);
    r.fulfill({ status: 200, contentType: "text/event-stream", body: stream(id) });
  });
  await p.route("**/api/session/*/composer", (r) => r.fulfill({ json: { engine: "chat", commands: [], models: [], model: "opus", mode: "default" } }));
  await p.route("**/api/session/*/agent", (r) => r.fulfill({ json: { agent: {}, live: {} } }));
  for (const what of ["send", "answer", "priority", "seen", "new"]) {
    await p.route(what === "new" ? "**/api/new" : `**/api/session/*/${what}`, async (r) => {
      const h = p.held[what] || {};
      if (h.ms) await sleep(h.ms);
      if (h.fail) return r.fulfill({ status: 409, json: { error: h.fail } });
      r.fulfill({ json: what === "new" ? { id: "proj-talk" } : { ok: true } });
    });
  }
  await p.addInitScript(({ chats, today }) => {
    Object.defineProperty(Navigator.prototype, "standalone", { get: () => true });
    // The chat open now (the phone's, a computer's).
    window.__chat = () => (app.desk ? desk.chat : app.session && app.session.chat);
    const parse = JSON.parse;
    JSON.parse = function (text, ...rest) {
      const v = parse.call(this, text, ...rest);
      if (v && typeof v === "object" && Array.isArray(v.sessions) && "share" in v) {
        v.sessions = chats.map((c) => ({ ...c, today: { ...c.today } }));
        v.projects = [{ name: "proj", sessions: 3 }];
        v.today = { loops: [{ key: "l1", kind: "due", what: "Send the invoice", who: "", due: today, nudge: "", since: "", chase: "", ref: "", line: "x" }],
                    source: "", error: "", sent: {}, assistant: null };
      }
      return v;
    };
  }, { chats: CHATS, today: new Date().toISOString().slice(0, 10) });
  return p;
}

const ready = (p) => until(p, () => typeof app !== "undefined" && app.view && app.view.sessions && app.view.sessions.length && document.querySelector(".tcard .today-go"));


// Open a chat from its card (as a tap: down, up, click), or (link) by its
// address, as a notification does (then sending something stays in it), and
// wait for its conversation.
async function openChat(p, id, link = false) {
  await p.evaluate(({ id, link }) => {
    if (link) return go(`#/s/${encodeURIComponent(id)}`);
    const head = document.querySelector(`.tcard[data-id="${id}"] .today-go`);
    head.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    head.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
    head.click();
  }, { id, link });
  return until(p, (id) => { const c = app.desk ? desk.chat : app.session && app.session.chat; return c && c.id === id && document.querySelector(".chat .msg.claude, .chat .turn"); }, id);
}

async function back(p) {
  await p.evaluate(() => { if (app.desk) boardBack(); else go("#/"); });
  await until(p, () => !!document.querySelector(".tcard .today-go") && !(app.desk ? desk.current : app.session));
}

// Sent from a chat opened from the board: back on the board at once (the
// chat works on it); refused, why, and the words back in its box.
async function sentFromBoard(p, where) {
  await openChat(p, "proj-talk");
  p.held.send = { ms: 1500 };
  const r = await p.evaluate(async () => {
    const chat = __chat();
    chat.input.value = "Ship it when it's green";
    chat.typed();
    const t = performance.now();
    chat.send();
    await new Promise((r) => requestAnimationFrame(() => r()));
    return { took: performance.now() - t, board: !(app.desk ? desk.current : app.session) && !!document.querySelector(".board-today .tcard"),
             toast: ((document.querySelector(".toast") || {}).innerText || "") };
  });
  check(where, r.board && /^Sent/.test(r.toast) && r.took < 50, `sent from the board's chat: back on the board in ${Math.round(r.took)} ms, before the server answered (${JSON.stringify(r)})`);
  await sleep(1700);
  p.held.send = { ms: 300, fail: "Claude isn't running" };
  await openChat(p, "proj-talk");
  await p.evaluate(() => { const chat = __chat(); chat.input.value = "And the docs"; chat.typed(); chat.send(); });
  check(where, await until(p, () => /Didn't send: Claude isn't running/.test((document.querySelector(".toast") || {}).innerText || "")), "refused: why, said on the board");
  await openChat(p, "proj-talk");
  check(where, await until(p, () => __chat().input.value === "And the docs"), "and its words back in its box");
  await p.evaluate(() => { const chat = __chat(); chat.input.value = ""; chat.typed(); });
  p.held.send = {};
  await back(p);
}

async function sending(p, where) {
  await openChat(p, "proj-talk", true);
  // Held: the server takes a second and a half to answer.
  p.held.send = { ms: 1500 };
  const now = await p.evaluate(async () => {
    const chat = __chat();
    chat.input.value = "Ship it when it's green";
    chat.typed();
    const t = performance.now();
    chat.send();
    await new Promise((r) => requestAnimationFrame(() => r()));
    const bubble = [...document.querySelectorAll(".chat-outbox .msg.user")].find((m) => m.innerText.includes("Ship it when it's green"));
    return { took: performance.now() - t, empty: chat.input.value === "", bubble: !!bubble, sending: !!bubble && bubble.classList.contains("sending"),
             shown: !!bubble && bubble.offsetParent !== null };
  });
  check(where, now.empty && now.bubble && now.sending && now.shown, `sent: the box empty and the message in the conversation in ${Math.round(now.took)} ms, before the server answered (${JSON.stringify(now)})`);
  check(where, now.took < 50, "within a frame");
  await sleep(1700);
  check(where, await p.evaluate(() => { const b = document.querySelector(".chat-outbox .msg.user"); return !!b && !b.classList.contains("sending"); }),
        "the server took it: no longer a shade lighter, still there until the conversation has it");
  // The conversation has it now: its own bubble, ours gone (one, not two).
  await p.evaluate(() => __chat().conversation({ items: [{ kind: "user", text: "Ship it when it's green", key: "u2:0", rec: "u2", turn: true, at: "" }] }));
  check(where, await p.evaluate(() => !document.querySelector(".chat-outbox .msg") &&
    [...document.querySelectorAll(".chat .msg.user")].filter((m) => m.innerText.includes("Ship it when it's green")).length === 1),
        "the conversation's own in its place: said once");
  // Refused: why, and the words back in the box.
  p.held.send = { ms: 300, fail: "Claude isn't running" };
  await p.evaluate(() => { const chat = __chat(); chat.input.value = "And the docs"; chat.typed(); chat.send(); });
  check(where, await p.evaluate(() => !!document.querySelector(".chat-outbox .msg.user")), "a second one: there at once too");
  check(where, await until(p, () => { const chat = __chat(); return chat.input.value === "And the docs" && !document.querySelector(".chat-outbox .msg"); }),
        "refused: its words back in the box, its bubble gone");
  check(where, await until(p, () => /Didn't send: Claude isn't running/.test((document.querySelector(".toast") || {}).innerText || "")), "and why, said");
  await p.evaluate(() => { const chat = __chat(); chat.input.value = ""; chat.typed(); });
  p.held.send = {};
  await back(p);
}

// Answered from a chat opened from the board: back on the board at once, its
// card answered there; refused, its card asks again.
async function answeredFromBoard(p, where) {
  await openChat(p, "proj-perm");
  check(where, await until(p, () => !!document.querySelector(".chat-dock .card.permission")), "a permission's card in the dock");
  p.held.answer = { ms: 1500 };
  const r = await p.evaluate(async () => {
    const t = performance.now();
    [...document.querySelectorAll(".chat-dock .card .cta")].find((b) => b.innerText.trim() === "Allow").click();
    await new Promise((r) => requestAnimationFrame(() => r()));
    const card = document.querySelector('.board-today .tcard[data-id="proj-perm"]');
    return { took: performance.now() - t, board: !(app.desk ? desk.current : app.session), asks: !!card && !!card.closest(".today-yours") };
  });
  check(where, r.board && !r.asks && r.took < 50, `Allow: back on the board in ${Math.round(r.took)} ms, its card no longer asking (${JSON.stringify(r)})`);
  await sleep(1700);
  p.held.answer = { ms: 300, fail: "The question changed" };
  await openChat(p, "proj-perm");
  await until(p, () => !!document.querySelector(".chat-dock .card.permission"));
  await p.evaluate(() => [...document.querySelectorAll(".chat-dock .card .cta")].find((b) => b.innerText.trim() === "Allow").click());
  check(where, await until(p, () => /The question changed/.test((document.querySelector(".toast") || {}).innerText || "") &&
    !!document.querySelector('.board-today .today-yours .tcard[data-id="proj-perm"]')), "refused: why, and its card asks again");
  p.held.answer = {};
  await p.evaluate(() => { todayUI.sent.clear(); todayRedraw(); });
}

async function answering(p, where) {
  await openChat(p, "proj-perm", true);
  check(where, await until(p, () => !!document.querySelector(".chat-dock .card.permission")), "a permission's card in the dock");
  p.held.answer = { ms: 1500 };
  const r = await p.evaluate(async () => {
    const allow = [...document.querySelectorAll(".chat-dock .card .cta")].find((b) => b.innerText.trim() === "Allow");
    const t = performance.now();
    allow.click();
    const lit = allow.classList.contains("chosen");
    await new Promise((ok) => setTimeout(ok, 250));
    return { lit, gone: !document.querySelector(".chat-dock .card.permission"), box: !!document.querySelector(".chat-dock textarea"), took: performance.now() - t };
  });
  check(where, r.lit && r.gone && r.box, `Allow: lit, and the card off the dock (the box in its place) before the server answered (${JSON.stringify(r)})`);
  await sleep(1500);
  check(where, await p.evaluate(() => !document.querySelector(".chat-dock .card.permission")), "the stream still says it's asked: it stays off");
  await back(p);
  // Refused: the card's back.
  await openChat(p, "proj-perm", true);
  await until(p, () => !!document.querySelector(".chat-dock .card.permission"));
  p.held.answer = { ms: 300, fail: "The question changed" };
  await p.evaluate(() => [...document.querySelectorAll(".chat-dock .card .cta")].find((b) => b.innerText.trim() === "Allow").click());
  check(where, await until(p, () => !document.querySelector(".chat-dock .card.permission"), null, 1000), "off at once again");
  check(where, await until(p, () => !!document.querySelector(".chat-dock .card.permission") && /The question changed/.test((document.querySelector(".toast") || {}).innerText || "")),
        "refused: the card's back, and why");
  p.held.answer = {};
  await back(p);
}

async function reopened(p, where) {
  await openChat(p, "proj-other");
  await back(p);
  // Its stream is slow to come now: what's drawn the moment it opens is what was kept.
  p.held.stream = 3000;
  const r = await p.evaluate(async () => {
    const t = performance.now();
    document.querySelector('.tcard[data-id="proj-other"] .today-go').click();
    for (let i = 0; i < 100 && !(document.querySelector(".chat") && /stale cookie/.test(document.querySelector(".chat").innerText)); i++) await new Promise((ok) => setTimeout(ok, 10));
    return { took: performance.now() - t, drawn: !!document.querySelector(".chat") && /stale cookie/.test(document.querySelector(".chat").innerText) };
  });
  check(where, r.drawn && r.took < 300, `opened again: its conversation at once, as it was left, its stream not here yet (${Math.round(r.took)} ms)`);
  p.held.stream = 0;
  await back(p);
}

async function early(p, where) {
  p.streams.length = 0;
  await p.evaluate(() => document.querySelector('.tcard[data-id="proj-talk"] .today-go').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })));
  check(where, (await (async () => { for (let i = 0; i < 50 && !p.streams.length; i++) await sleep(10); return p.streams.includes("proj-talk"); })()),
        "a finger down on a card: its chat's stream asked for, before the tap's click");
  await sleep(200);
  await p.evaluate(() => document.querySelector('.tcard[data-id="proj-talk"] .today-go').click());
  await until(p, () => { const c = app.desk ? desk.chat : app.session && app.session.chat; return c && c.id === "proj-talk" && /stale cookie/.test(document.querySelector(".chat").innerText); });
  check(where, p.streams.filter((x) => x === "proj-talk").length === 1, `the click: that one stream, not another (${p.streams.join(", ")})`);
  await back(p);
  // A finger that scrolls instead: let go.
  p.streams.length = 0;
  await p.evaluate(() => {
    document.querySelector('.tcard[data-id="proj-other"] .today-go').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
  });
  await sleep(300);
  check(where, await p.evaluate(() => streamEarly === null), "a scroll instead (the pointer cancelled): let go");
}

async function onTheBoard(p, where) {
  // A priority: on its card at once.
  p.held.priority = { ms: 1500 };
  const pr = await p.evaluate(async () => {
    priorityNow(row("proj-other"), "high").catch(() => {});
    await new Promise((r) => requestAnimationFrame(() => r()));
    return !!document.querySelector('.tcard[data-id="proj-other"] .prio.high');
  });
  check(where, pr, "a priority: on its card at once, before the server answered");
  // An older list comes meanwhile: it stays as you set it.
  await p.evaluate(() => { app.view = JSON.parse(JSON.stringify({ ...app.view, sessions: app.view.sessions.map((s) => (s.id === "proj-other" ? { ...s, priority: "normal" } : s)) })); aheadOn(app.view); refresh(); });
  check(where, await p.evaluate(() => !!document.querySelector('.tcard[data-id="proj-other"] .prio.high')), "a list from before it comes: still as you set it");
  await sleep(1600);
  // Refused: as the server has it, and why.
  p.held.priority = { ms: 200, fail: "can't" };
  await p.evaluate(() => { priorityNow(row("proj-talk"), "low").catch(() => {}); });
  check(where, await p.evaluate(() => !!document.querySelector('.tcard[data-id="proj-talk"] .prio.low')), "another: at once");
  check(where, await until(p, () => !document.querySelector('.tcard[data-id="proj-talk"] .prio.low') && /can't/.test((document.querySelector(".toast") || {}).innerText || "")),
        "refused: back as it was, and why");
  p.held.priority = {};
  await p.evaluate(() => { ahead.clear(); app.view.sessions.forEach((s) => { s.priority = "normal"; }); todayRedraw(); });

  // Chats | Tasks | Chats: the cards as they were.
  const tabs = await p.evaluate(() => {
    boardTab("chats");
    const first = document.querySelector(".board-today .tcard");
    boardTab("tasks");
    const tasks = /Send the invoice/.test(document.querySelector(".board-today").innerText);
    boardTab("chats");
    return { tasks, same: document.querySelector(".board-today .tcard") === first };
  });
  check(where, tabs.tasks && tabs.same, `Chats, Tasks, Chats: Tasks drawn, then Chats' cards as they were, not drawn again (${JSON.stringify(tabs)})`);

  // Pressed: lit the moment it's pressed (no fade in).
  const pressed = await p.evaluate(() => {
    const css = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch (e) { return []; } }).map((r) => r.cssText).join("\n");
    return { card: /\.tcard:has\(> \.tcard-head:active\)/.test(css), button: /\.tbtn:active/.test(css), tap: getComputedStyle(document.documentElement).touchAction };
  });
  check(where, pressed.card && pressed.button && pressed.tap === "manipulation", `pressed: a card and a button light at once; taps don't wait on a double tap (${JSON.stringify(pressed)})`);

  // A new chat: the box empties, its card at once; refused, the words back.
  p.held.new = { ms: 1500 };
  const started = await p.evaluate(async () => {
    boardCompose();
    const n = desk.newChat;
    n.field.value = "Make the board faster";
    n.field.dispatchEvent(new Event("input"));
    n.use("proj");
    n.field.value = "Make the board faster";
    n.field.dispatchEvent(new Event("input"));
    const go = n.el.querySelector(".send, button.go, button[type=submit]") || [...n.el.querySelectorAll("button")].find((b) => /start|send/i.test(b.getAttribute("aria-label") || b.innerText));
    go.click();
    await new Promise((r) => requestAnimationFrame(() => r()));
    const card = document.querySelector(".board-starting .tcard");
    return { empty: n.field.value === "", card: !!card && /Make the board faster/.test(card.innerText) && /Starting/.test(card.innerText), box: board.slot.hidden };
  });
  check(where, started.empty && started.card && started.box, `a new chat: the box empty and gone, its card Starting… at once (${JSON.stringify(started)})`);
  check(where, await until(p, () => document.querySelector(".board-starting").hidden), "up: its card goes (the chat's own is in the list)");
  p.held.new = { ms: 200, fail: "no such project" };
  await p.evaluate(() => {
    boardCompose();
    const n = desk.newChat;
    n.field.value = "And the phone";
    n.field.dispatchEvent(new Event("input"));
    const go = n.el.querySelector(".send, button.go, button[type=submit]") || [...n.el.querySelectorAll("button")].find((b) => /start|send/i.test(b.getAttribute("aria-label") || b.innerText));
    go.click();
  });
  check(where, await until(p, () => !board.slot.hidden && desk.newChat.field.value === "And the phone" && document.querySelector(".board-starting").hidden
                                    && /Didn't start: no such project/.test((document.querySelector(".toast") || {}).innerText || "")),
        "refused: the box back with its words, and why");
  await p.evaluate(() => { desk.newChat.field.value = ""; store.set("draft:new", ""); leaveNewChat(); });
  p.held.new = {};
}

async function run(browser, layout, port) {
  const p = await page(browser, layout, port);
  await p.goto("/");
  check(layout, await ready(p), `the board is up${p.errors.length ? ` (${p.errors.join(" | ")})` : ""}`);
  await sentFromBoard(p, layout);
  await answeredFromBoard(p, layout);
  if (layout === "phone") {     // (a computer's open chat always goes back to the board)
    await sending(p, layout);
    await answering(p, layout);
  }
  await reopened(p, layout);
  await early(p, layout);
  await onTheBoard(p, layout);
  await p.screenshot({ path: path.join(SHOTS, `${layout}-board.png`) });
  check(layout, !p.errors.length, `no page errors${p.errors.length ? `: ${p.errors.join(" | ")}` : ""}`);
  await p.context().close();
}

async function server(port) {
  const where = "server";
  const page = await get(port, "/");
  const build = page.headers["x-amarchy-build"];
  check(where, /src="app\.js\?b=[0-9a-f]{12}"/.test(page.body) && page.body.includes(`app.js?b=${build}`) && page.body.includes('href="theme.css"'),
        "the page asks for each of its files by build (name?b=<build>), the look as it is");
  const stamped = await get(port, `/app.js?b=${build}`, { "Accept-Encoding": "gzip" });
  check(where, /immutable/.test(stamped.headers["cache-control"] || "") && stamped.headers["content-encoding"] === "gzip" && stamped.raw < stamped.body.length / 2,
        `a file by its build: kept for good, gzipped (${stamped.raw} of ${stamped.body.length} bytes)`);
  const plain = await get(port, "/app.js");
  check(where, plain.headers["cache-control"] === "no-cache" && plain.headers.etag === `"${build}"` && !plain.headers["content-encoding"],
        "asked for otherwise: checked, by its ETag; not gzipped for who doesn't take it");
  const again = await get(port, "/app.js", { "If-None-Match": `"${build}"` });
  check(where, again.status === 304 && !again.body, "the same build again: 304, nothing sent");
  const old = await get(port, "/app.js?b=000000000000");
  check(where, old.headers["cache-control"] === "no-cache", "another build's address: not kept for good");
  const sw = await get(port, "/sw.js");
  check(where, sw.body.includes(`const BUILD = "${build}"`) && sw.headers["cache-control"] === "no-cache", "the worker: made for its build, always asked again");
  // A page's burst: 40 connections at once, all answered at once (not a second on, refused and asked again).
  const t = Date.now();
  const all = await Promise.all(Array.from({ length: 40 }, (_, i) => get(port, `/ui.css?n=${i}`)));
  const took = Date.now() - t;
  check(where, all.every((r) => r.status === 200) && took < 800, `40 connections at once: all answered in ${took} ms`);
}

// The list's stream, as far as its first event: {headers, text (decoded),
// took}, read as it comes (gzipped, each write flushed), the stream left open.
function firstEvent(port, p, headers = {}) {
  return new Promise((ok, no) => {
    const t = Date.now();
    const req = http.get({ host: "127.0.0.1", port, path: p, headers }, (res) => {
      const body = res.headers["content-encoding"] === "gzip" ? res.pipe(zlib.createGunzip()) : res;
      let text = "";
      body.on("data", (d) => {
        text += d.toString();
        if (/event: list\ndata: .*\n\n/.test(text)) { req.destroy(); ok({ headers: res.headers, text, took: Date.now() - t }); }
      });
      body.on("error", () => {});
    });
    req.on("error", () => {});
    setTimeout(() => { req.destroy(); no(new Error(`no first event on ${p} in 4 s`)); }, 4000);
  });
}

// A stream gzipped as it goes, for who takes it, each event there at once;
// ?plain=1 not; and back a second after the server restarts.
async function streamed(port) {
  const where = "server";
  const zipped = await firstEvent(port, "/api/events", { "Accept-Encoding": "gzip" });
  check(where, zipped.headers["content-encoding"] === "gzip" && zipped.text.startsWith("retry: 1000\n\n") && zipped.took < 1500,
        `the list's stream: gzipped, its first event there at once (${zipped.took} ms), retry: 1000 first`);
  const plain = await firstEvent(port, "/api/events?plain=1", { "Accept-Encoding": "gzip" });
  check(where, !plain.headers["content-encoding"] && plain.text.startsWith("retry: 1000\n\n"), "?plain=1: the same, not gzipped");
}

// What a page did is in the list at once (app_watch is poked), not a second on.
async function pushed(browser, port) {
  const where = "server";
  const ctx = await browser.newContext({ baseURL: `http://127.0.0.1:${port}` });
  const p = await ctx.newPage();
  await p.goto("/");
  await until(p, () => window.app && app.view && app.view.sort);
  const r = await p.evaluate(async () => {
    const times = [];
    for (const sort of ["newest", "oldest", "priority", "newest", "priority"]) {
      await new Promise((ok) => setTimeout(ok, 300 + Math.random() * 400));
      const t = performance.now();
      const es = new EventSource("/api/events");
      await new Promise((ok) => es.addEventListener("list", ok, { once: true }));
      const got = new Promise((ok) => es.addEventListener("list", (e) => { if (JSON.parse(e.data).sort === sort) ok(); }));
      const t0 = performance.now();
      await api("/api/list", { group: [], sort });
      await got;
      times.push(Math.round(performance.now() - t0));
      es.close();
    }
    return times;
  });
  const worst = Math.max(...r);
  check(where, worst < 400, `a change from a page: in the list in ${r.join(", ")} ms (the list was read every second)`);
  await ctx.close();
}

(async () => {
  const pw = loadPlaywright();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "snappy-home-"));
  const port = await freePort();
  const srv = await startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  try {
    if (!ONLY) {
      console.log("server");
      await server(port).catch((e) => check("server", false, `crashed: ${e.stack}`));
      await pushed(browser, port).catch((e) => check("server", false, `crashed: ${e.stack}`));
      await streamed(port).catch((e) => check("server", false, `crashed: ${e.stack}`));
    }
    for (const layout of ["phone", "wide"]) {
      if (ONLY && ONLY !== layout) continue;
      console.log(layout);
      await run(browser, layout, port).catch((e) => check(layout, false, `crashed: ${e.stack}`));
    }
  } finally {
    await browser.close();
    srv.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
