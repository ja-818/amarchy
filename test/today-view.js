// Today, the app's home, in a browser: on the phone its tab first with the
// count of what's your move; a chat's question answered with a tap (sent to
// the chat); a loop's Done and a chase told to your assistant; a done chat's
// Close (asked first); a quiet one nudged; the Chats tab with the list. On a
// computer: Today in the middle with the new chat under it, and its row
// above the list. And a reply's goal block: never shown, the chat's goal and
// state. With screenshots.
//
//   node test/today-view.js          both layouts
//   node test/today-view.js phone    one layout (phone | wide)
//
// Needs what test/brief-view.js needs (Chromium, playwright-core). It starts
// its own app server from this checkout's bin/amarchy, with a home and state
// of its own. Exits 0 when every check passed.

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "amarchy");
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "today-view-"));
const ONLY = process.argv[2];

const SHIM = `
import importlib.machinery, importlib.util, os, sys, threading, http.server
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
server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Local)
server.daemon_threads = True
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

const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  wide: { viewport: { width: 1280, height: 800 } },
};

const NOW = Date.now() / 1000;
const iso = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const T = (o) => ({ goal: "", state: "", goal_at: 0, asks: [], at: NOW - 600, ...o });

const CHATS = [
  { id: "me-jaken", repo: "me", name: "jaken", task: "Jaken", status: "idle", engine: "chat", path: "/tmp/j", assistant: "main", assistant_name: "Jaken", today: T({}) },
  { id: "proj-ask", repo: "proj", name: "ask", task: "Fellowship: application", status: "idle", engine: "chat", path: "/tmp/a",
    today: T({ goal: "Submit the application", state: "waiting", asks: [{ question: "Submit it now?", options: [{ label: "Submit", send: "Submit it now" }, { label: "Wait", send: "Wait until Friday" }] }] }) },
  { id: "proj-perm", repo: "proj", name: "perm", task: "Meta: verification", status: "waiting", asks: "Claude asks to run gcloud", engine: "chat", path: "/tmp/p", today: T({}),
    permission: { request_id: "req-1", tool: "Bash" } },
  { id: "proj-done2", repo: "other", name: "done2", task: "Docs: the guide", status: "idle", engine: "chat", path: "/tmp/d2", today: T({ goal: "Write the guide", state: "done" }) },
  { id: "proj-done", repo: "proj", name: "done", task: "Study: T3 vs amarchy", status: "idle", engine: "chat", path: "/tmp/d", today: T({ goal: "Compare T3 with amarchy", state: "done" }) },
  { id: "proj-quiet", repo: "proj", name: "quiet", task: "Eval: json-render", status: "idle", engine: "chat", path: "/tmp/q", today: T({ goal: "Try json-render", state: "working", at: NOW - 4 * 86400 }) },
  { id: "proj-work", repo: "proj", name: "work", task: "Build: Today", status: "working", engine: "chat", path: "/tmp/w", today: T({ goal: "Make Today the home" }) },
];

const LOOPS = [
  { key: "late1", kind: "due", what: "Fix the per-minute calc", who: "", due: iso(-1), nudge: "", since: "", chase: "", ref: "", line: "x" },
  { key: "tom1", kind: "due", what: "Submit the fellowship", who: "", due: iso(1), nudge: "", since: "", chase: "", ref: "", line: "y" },
  { key: "week1", kind: "due", what: "Demo to Felipe", who: "", due: iso(3), nudge: "", since: "", chase: "", ref: "", line: "z" },
  { key: "wait1", kind: "waiting", what: "the valuation doc", who: "Felipe", due: "", nudge: "", since: iso(-4), chase: iso(0), ref: "", line: "w" },
];

async function page(browser, layout, port) {
  const ctx = await browser.newContext({ ...LAYOUTS[layout], baseURL: `http://127.0.0.1:${port}` });
  const p = await ctx.newPage();
  p.errors = [];
  p.posts = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  await p.route("**/api/session/*/stream", (r) => r.fulfill({ status: 200, contentType: "text/event-stream", body: "retry: 600000\n\n" }));
  await p.route("**/api/session/*/composer", (r) => r.fulfill({ json: { engine: "chat", commands: [], models: [], model: "opus", mode: "default" } }));
  await p.route("**/api/session/*/closing", (r) => r.fulfill({ json: { changes: 0 } }));
  for (const what of ["send", "close", "answer"]) {
    await p.route(`**/api/session/*/${what}`, (r) => { p.posts.push({ url: r.request().url(), body: r.request().postDataJSON() }); r.fulfill({ json: {} }); });
  }
  await p.route("**/api/today/loop", (r) => { p.posts.push({ url: r.request().url(), body: r.request().postDataJSON() }); r.fulfill({ json: {} }); });
  await p.addInitScript(({ chats, loops }) => {
    Object.defineProperty(Navigator.prototype, "standalone", { get: () => true });
    const parse = JSON.parse;
    JSON.parse = function (text, ...rest) {
      const v = parse.call(this, text, ...rest);
      if (v && typeof v === "object" && Array.isArray(v.sessions) && "share" in v) {
        v.sessions = chats.map((c) => ({ ...c }));
        v.projects = [{ name: "proj", sessions: 5 }, { name: "me", sessions: 1 }];
        v.today = { loops, source: "/home/x/loops.md", error: "", sent: {}, assistant: { id: "me-jaken", name: "Jaken" } };
        v.needs = 2;
      }
      return v;
    };
  }, { chats: CHATS, loops: LOOPS });
  return p;
}

const ready = (p) => until(p, () => window.app && app.view && app.view.sessions && app.view.sessions.length);
const text = (p, sel) => p.evaluate((sel) => { const el = document.querySelector(sel); return el ? el.innerText : ""; }, sel);
const click = (p, sel, label) => p.evaluate(({ sel, label }) => {
  const b = [...document.querySelectorAll(sel)].find((x) => x.innerText.trim().replace(/^[^A-Za-z]+/, "") === label && !x.closest("[hidden]"));
  if (b) b.click();
  return !!b;
}, { sel, label });

async function common(p, where) {
  const t = await text(p, ".today:not([hidden])");
  check(where, /Your move/i.test(t) && /Finish/i.test(t) && /Waiting/i.test(t), "Your move, Finish, Waiting");
  check(where, /Submit it now\?/.test(t) && /Claude asks to run gcloud/.test(t), "a chat's question and a permission are your move");
  check(where, /Fix the per-minute calc/.test(t) && /Submit the fellowship/.test(t), "loops due by tomorrow are your move");
  check(where, /Chase today/.test(await text(p, ".today-yours")) && /Felipe/.test(await text(p, ".today-yours")), "who to chase today is your move");
  check(where, /1 day|yesterday/.test(t), "a late loop says how late");
  check(where, /Study: T3 vs amarchy/.test(await text(p, ".today-finish")) && /Eval: json-render/.test(await text(p, ".today-finish")), "done and stalled chats are to finish, unfolded");
  check(where, /Close all 2 done/.test(await text(p, ".today-finish")), "Close all done, with two done");
  check(where, !/Jaken/.test(await text(p, ".today-finish")) && !!(await p.$(".today-line.assistant")), "your assistant: a line on top, never to finish");
  check(where, await p.evaluate(() => [...document.querySelectorAll(".today-card.ask .pchip")].every((c) => c.innerText === "Proj")
                                      && document.querySelectorAll(".today-line .pchip").length >= 2), "every chat says its project");
  check(where, await p.evaluate(() => !document.querySelector(".today-opt.accent")), "no option is pushed on you");
  await p.screenshot({ path: path.join(SHOTS, `${where}-today.png`), fullPage: true });

  // An answer: off the page at once, with Undo; sent once Undo's gone.
  check(where, await click(p, ".today-card.ask .control", "Submit"), "a question's option tapped");
  check(where, await until(p, () => !/Submit it now\?/.test(document.querySelector(".today:not([hidden])").innerText) && !!document.querySelector(".undo-toast")), "it goes, Undo up");
  check(where, !p.posts.some((x) => /proj-ask\/send/.test(x.url)), "not sent yet");
  await sleep(4200);
  const sent = p.posts.find((x) => /proj-ask\/send/.test(x.url));
  check(where, !!sent && sent.body.text === "Submit it now", `then sent to the chat (${JSON.stringify(sent && sent.body)})`);

  // A permission: Allow, Undo, it comes back; Allow again, it goes.
  check(where, await click(p, ".today-card.ask .control", "Allow"), "Allow, right on Today");
  await p.evaluate(() => [...document.querySelectorAll(".undo-toast .text-btn")].pop().click());
  check(where, await until(p, () => /Claude asks to run gcloud/.test(document.querySelector(".today:not([hidden])").innerText)), "Undo: it's back");
  await click(p, ".today-card.ask .control", "Allow");
  await sleep(4000);
  const allowed = p.posts.find((x) => /proj-perm\/answer/.test(x.url));
  check(where, !!allowed && allowed.body.choice === "allow" && allowed.body.request_id === "req-1", "allowed, once");

  const tapIn = (what, label) => p.evaluate(({ what, label }) => {
    const row = [...document.querySelectorAll(".today:not([hidden]) .today-loop")].find((r) => r.innerText.includes(what));
    const b = row && [...row.querySelectorAll(".control")].find((x) => x.innerText.trim().replace(/^[^A-Za-z]+/, "") === label);
    if (b) b.click();
    return !!b;
  }, { what, label });
  check(where, await tapIn("per-minute", "Done"), "a loop's Done tapped");
  await sleep(300);
  const done = p.posts.find((x) => /today\/loop/.test(x.url) && x.body.action === "done");
  check(where, !!done && done.body.key === "late1", "Done goes to your assistant, by the loop's key");
  check(where, /Sent to Jaken/.test(await text(p, ".today:not([hidden])")), "the loop says it was sent");
  check(where, await tapIn("valuation", "Chase"), "a chase tapped");
  await sleep(300);
  check(where, p.posts.some((x) => /today\/loop/.test(x.url) && x.body.action === "chase" && x.body.key === "wait1"), "the chase goes to your assistant");

  check(where, await click(p, ".today-line.stale .control", "Ask status"), "a stalled chat asked");
  await sleep(300);
  check(where, p.posts.some((x) => /proj-quiet\/send/.test(x.url) && /Where does this stand/.test(x.body.text)), "the ask goes to that chat");

  // Close with nothing to lose: at once, with Undo.
  check(where, await click(p, ".today-line.done .control", "Close"), "a done chat's Close tapped");
  check(where, await until(p, () => !!document.querySelector(".undo-toast") && !document.querySelector(".sheet")), "no sheet: closed, with Undo");
  await sleep(5600);
  check(where, p.posts.some((x) => /proj-done\/close/.test(x.url)), "closed once Undo's gone");

  // The goal block: the chat's, never shown in its reply.
  const r = await p.evaluate(() => {
    const t = "It shipped\n\nAll done.\n\n```goal state=\"done\"\nShip Today\n```\n";
    const x = parseReply(t);
    return { goal: x.goal, body: JSON.stringify(x.sections), said: withoutGoal(t) };
  });
  check(where, r.goal && r.goal.goal === "Ship Today" && r.goal.state === "done", "a reply's goal block read");
  check(where, !/Ship Today/.test(r.body) && !/goal/.test(r.said), "and never shown in the reply");
}

async function phone(browser, port) {
  const where = "phone";
  const p = await page(browser, "phone", port);
  await p.goto("/");
  await ready(p);
  check(where, await until(p, () => !!document.querySelector(".home-tabs .tab.on[data-tab=today]") && !!document.querySelector(".today:not([hidden]) .today-part")), "opens on Today");
  check(where, /5/.test(await text(p, ".home-tabs .tab[data-tab=today]")), "its tab counts your move (2 asks, 2 loops due, 1 chase)");
  check(where, /5 for you to do · 2 to close/i.test(await text(p, ".hero .meta")), `one count, in the header (${await text(p, ".hero .meta")})`);
  check(where, await p.evaluate(() => document.querySelector(".list-view .dock").hidden), "no new chat's box under it: Today has the room");
  await p.evaluate(() => document.querySelector(".hero .new-btn").click());
  check(where, await p.evaluate(() => !document.querySelector(".list-view .dock").hidden && document.activeElement === app.newChat.field), "+: the new chat's box, its keyboard up");
  await p.evaluate(() => document.activeElement.blur());
  check(where, await until(p, () => document.querySelector(".list-view .dock").hidden), "left empty, it goes again");
  const kept = await p.evaluate(async () => {
    const sc = document.querySelector(".list-view .scroll");
    sc.scrollTop = 300;
    const was = sc.scrollTop;
    renderList(); app.view = { ...app.view, sessions: app.view.sessions.map((x) => ({ ...x, said: "new words" })) }; renderList();
    await new Promise((r) => setTimeout(r, 50));
    return { was, now: sc.scrollTop };
  });
  check(where, kept.was > 0 && kept.now === kept.was, `it scrolls, and keeps its place as the list changes (${JSON.stringify(kept)})`);
  await p.evaluate(() => { document.querySelector(".list-view .scroll").scrollTop = 0; });
  await common(p, where);
  // A chat opened from Today: sent something, back on Today.
  await p.evaluate(() => todayOpen(app.view.sessions.find((s) => s.id === "proj-work")));
  check(where, await until(p, () => app.session && app.session.id === "proj-work"), "a chat opened from Today");
  await p.evaluate(() => app.session.chat.post("send", { text: "go on" }));
  check(where, await until(p, () => !app.session && app.tab === "today" && !!document.querySelector(".today:not([hidden])")), "sent: back on Today");
  await p.evaluate(() => document.querySelector(".home-tabs .tab[data-tab=chats]").click());
  check(where, await until(p, () => !document.querySelector(".list-view .list").hidden && document.querySelector(".today").hidden), "Chats: the list");
  check(where, !p.errors.length, `no page errors (${p.errors.join("; ")})`);
  await p.context().close();
}

async function wide(browser, port) {
  const where = "wide";
  const p = await page(browser, "wide", port);
  await p.goto("/");
  await ready(p);
  check(where, await until(p, () => desk.mode === "tasks" && !!document.querySelector(".tasks-board .board-today .today-part")
                                   && getComputedStyle(document.querySelector(".stage")).display === "none"), "launched: Tasks, the whole window, no list");
  check(where, /Tasks\s*5/.test(await text(p, ".board-switch")) && /Chats/.test(await text(p, ".board-switch")), "its switch: Tasks (5) | Chats");
  check(where, /Try json-render/.test(await text(p, ".board-today")), "a ticket says its goal");
  await common(p, where);

  // Opened: the whole window, its box ready; Back and Esc: the board, where you were.
  await p.evaluate(() => document.querySelector(".ticket[data-id=proj-work] .today-go").click());
  check(where, await until(p, () => board.open === "proj-work" && !document.querySelector(".board-focus").hidden
                                   && !!document.querySelector(".board-focus .chat")), "a ticket opens over the whole window");
  // The list changes under it (every second, live): it stays open.
  await p.evaluate(() => { app.view = { ...app.view, sessions: app.view.sessions.map((x) => ({ ...x, said: `${x.said || ""}.` })) }; refresh(); refresh(); });
  await sleep(300);
  check(where, await p.evaluate(() => board.open === "proj-work" && !document.querySelector(".board-focus").hidden), "it stays open as the list changes");
  await p.screenshot({ path: path.join(SHOTS, "wide-ticket-open.png") });
  await p.evaluate(() => document.querySelector(".board-back").click());
  check(where, await until(p, () => !board.open && document.querySelector(".board-focus").hidden), "Back: the board");
  check(where, await p.evaluate(() => document.activeElement && document.activeElement.closest(".ticket[data-id=proj-work]")), "on the ticket it opened");
  await p.keyboard.press("Enter");
  check(where, await until(p, () => board.open === "proj-work"), "Enter opens it again");
  await p.evaluate(() => document.activeElement.blur());
  await p.keyboard.press("Escape");
  check(where, await until(p, () => !board.open), "Esc: back");

  // Sent from an open chat: back to the board, it's off your move, the next lit with the keys.
  await p.evaluate(() => todayOpen(row("proj-quiet")));
  check(where, await until(p, () => board.open === "proj-quiet"), "another opened");
  await p.evaluate(() => board.chat.post("send", { text: "Go on" }));
  check(where, await until(p, () => !board.open), "sent: back on the board");
  check(where, await p.evaluate(() => { const n = document.querySelector(".ticket.next"); return !n || n.contains(document.activeElement); }), "the next one lit, the keys on it");

  // Keys: j / k move, n a new chat, Esc away.
  await p.evaluate(() => { document.activeElement.blur(); board.scroll.focus(); });
  await p.keyboard.press("j");
  const first = await p.evaluate(() => document.activeElement.closest(".ticket") && document.activeElement.closest(".ticket").dataset.id);
  await p.keyboard.press("j");
  const second = await p.evaluate(() => document.activeElement.closest(".ticket") && document.activeElement.closest(".ticket").dataset.id);
  check(where, !!first && !!second && first !== second, `j moves from ticket to ticket (${first} → ${second})`);
  await p.keyboard.press("n");
  check(where, await until(p, () => !document.querySelector(".board-new").hidden && document.activeElement === document.querySelector(".board-new textarea")), "n: a new chat, its box at the top");
  await p.keyboard.press("Escape");
  check(where, await until(p, () => document.querySelector(".board-new").hidden), "Esc: away again");

  await p.setViewportSize({ width: 1280, height: 520 });
  const sc = await p.evaluate(() => { const el = document.querySelector(".board-scroll"); el.scrollTop = 200; return el.scrollTop; });
  check(where, sc > 0, `the board scrolls (${sc})`);
  await p.setViewportSize({ width: 1280, height: 800 });

  await p.evaluate(() => [...document.querySelectorAll(".board-switch .control")].find((b) => b.innerText === "Chats").click());
  check(where, await until(p, () => desk.mode === "chats" && getComputedStyle(document.querySelector(".tasks-board")).display === "none"), "Chats: the list again");
  check(where, await p.evaluate(() => [...document.querySelectorAll(".panel-buttons .control")].map((b) => b.className.split(" ")[1]).join(",")) === "new-chat,today-btn,brand", "the bar: New chat, Tasks, the cog");
  await p.evaluate(() => go2("proj-work"));
  check(where, await until(p, () => desk.current === "proj-work"), "a chat opened");
  await p.reload();
  await ready(p);
  check(where, await until(p, () => desk.mode === "chats"), "the app opens on the one you used last");
  await p.evaluate(() => document.querySelector(".today-btn").click());
  check(where, await until(p, () => desk.mode === "tasks"), "Tasks over the list: Tasks again");
  await p.keyboard.press("Control+Alt+KeyH");
  check(where, await until(p, () => desk.mode === "chats"), "Ctrl+Alt+H switches");
  check(where, !p.errors.length, `no page errors (${p.errors.join("; ")})`);
  await p.context().close();
}

(async () => {
  const pw = loadPlaywright();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "today-view-home-"));
  const port = await freePort();
  const server = await startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  try {
    for (const [layout, run] of [["phone", phone], ["wide", wide]]) {
      if (ONLY && ONLY !== layout) continue;
      console.log(layout);
      await run(browser, port).catch((e) => check(layout, false, `crashed: ${e.stack}`));
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
