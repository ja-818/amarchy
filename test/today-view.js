// Today, the app's home, in a browser: on the phone its tab first with the
// count of what's your move; a chat's question answered with a tap (sent to
// the chat); a loop's Done and a chase told to your assistant; a done chat's
// Close (asked first); a quiet one nudged; the Chats tab with the list. On a
// computer: Today in the middle with the new chat under it, and its row
// above the list. And a reply's goal block: never shown, the chat's goal and
// state. A chat whose turn ended while what it started still runs: at work,
// "Running · what", never done, and closing it asks first. With screenshots.
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
  { id: "proj-done", repo: "proj", name: "done", task: "Study: T3 vs amarchy", status: "idle", engine: "chat", path: "/tmp/d", today: T({ goal: "Compare T3 with amarchy", state: "done", links: [{ label: "Open the PR", url: "https://github.com/x/y/pull/1" }] }) },
  { id: "proj-fresh", repo: "proj", name: "fresh", task: "Fix: login loop", status: "idle", unseen: true, engine: "chat", path: "/tmp/f", said: "The login loop came from a stale cookie; fixed.", today: T({ goal: "Fix the login loop" }) },
  { id: "proj-quiet", repo: "proj", name: "quiet", task: "Eval: json-render", status: "idle", engine: "chat", path: "/tmp/q", today: T({ goal: "Try json-render", state: "working", at: NOW - 4 * 86400 }) },
  { id: "proj-work", repo: "proj", name: "work", task: "Build: Today", status: "working", engine: "chat", path: "/tmp/w", today: T({ goal: "Make Today the home" }), priority: "high" },
  // Its turn over (its goal block even says done), its e2e still running: at work.
  { id: "proj-run", repo: "proj", name: "run", task: "Check: e2e chain", status: "running", running: "Run the full check, e2e and tour chain", background: 1,
    engine: "chat", path: "/tmp/r", today: T({ goal: "Get the e2e chain green", state: "done", at: NOW - 3 * 86400 }) },
];
const RUNNING = "Run the full check, e2e and tour chain";

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
  await p.route("**/api/session/*/closing", (r) => r.fulfill({ json: /proj-run/.test(r.request().url()) ? { changes: 0, running: [RUNNING] } : { changes: 0 } }));
  for (const what of ["send", "close", "answer", "interrupt", "keys"]) {
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

// On the board, its tab (Chats or Tasks); elsewhere both are on one page.
const tab = (p, which) => p.evaluate((which) => { if (boardOn() && board.tab !== which) boardTab(which); }, which);

// A running chat: under At work with what runs, not Done, new or stalled, no
// Complete on its card; completing it anyway asks first, saying the run stops.
async function running(p, where) {
  await tab(p, "chats");
  check(where, await p.evaluate((what) => {
    const c = document.querySelector(".today:not([hidden]) .today-working .tcard[data-id=proj-run]");
    return !!c && c.querySelector(".tpill.t-running").textContent.includes(`Running · ${what}`);
  }, RUNNING), "a running chat: under At work, Running · what runs");
  check(where, await p.evaluate(() => [".today-finish", ".today-yours", ".today-idle"].every((s) => !document.querySelector(`.today:not([hidden]) ${s} .tcard[data-id=proj-run]`))),
        "not under Done, Needs you or Ready (nor Stalled)");
  check(where, await p.evaluate(() => ![...document.querySelectorAll(".tcard[data-id=proj-run] .tbtn")].some((b) => /Complete/.test(b.innerText))), "no Complete mission on it");
  check(where, await p.evaluate(() => /1 working · 1 running/.test(document.querySelector(".today:not([hidden]) .today-working .tsec-head").textContent)), "At work counts it: 1 working · 1 running");
  await p.evaluate(() => { document.querySelector(".today:not([hidden]) .today-working").open = true; });
  await p.screenshot({ path: path.join(SHOTS, `${where}-running.png`), fullPage: true });
  await p.evaluate(() => { document.querySelector(".today:not([hidden]) .today-working").open = false; uiState.open.delete("working"); });
  await p.evaluate(() => todayComplete(row("proj-run")));
  check(where, await until(p, (what) => { const s = document.querySelector(".sheet"); return !!s && s.textContent.includes(`Stops what's still running: ${what}`) && /Stop it and complete/.test(s.textContent); }, RUNNING),
        "Complete anyway: asked first, saying the run stops");
  check(where, !(await p.$(".mission")), "and not celebrated yet");
  await sleep(500);
  await p.screenshot({ path: path.join(SHOTS, `${where}-running-close.png`) });
  await p.evaluate(() => closeSheets());
  check(where, !p.posts.some((x) => /proj-run\/close/.test(x.url)), "nothing closed");
  // It ended: Claude goes on (Working), then it's done, as any chat.
  const set = (o) => p.evaluate((o) => { app.view = { ...app.view, sessions: app.view.sessions.map((x) => (x.id === "proj-run" ? { ...x, ...o } : x)) }; refresh(); }, o);
  await set({ status: "working", running: "", background: 0 });
  check(where, await until(p, () => /Working/.test((document.querySelector(".today:not([hidden]) .today-working .tcard[data-id=proj-run] .tpill") || {}).textContent || "")), "the run ended: Working");
  await set({ status: "idle", unseen: true });
  check(where, await until(p, () => /Done/.test((document.querySelector(".today:not([hidden]) .today-yours .tcard[data-id=proj-run] .tpill") || {}).textContent || "")), "then Done, new: under Needs you");
  // Back as the test's chats are (the list as the host sends it).
  await p.evaluate((chats) => { app.view = { ...app.view, sessions: chats.map((c) => ({ ...c })) }; refresh(); }, CHATS);
  await until(p, () => !!document.querySelector(".today:not([hidden]) .today-working .tcard[data-id=proj-run]"));
}

async function common(p, where) {
  await running(p, where);
  await tab(p, "chats");
  let t = await text(p, ".today:not([hidden])");
  const board = await p.evaluate(() => boardOn());
  if (board) {
    check(where, !/per-minute/.test(t), "the board's Chats: chats only");
    await tab(p, "tasks");
    t += await text(p, ".today:not([hidden])");
    check(where, !/Submit it now\?/.test(await text(p, ".today:not([hidden])")), "its Tasks: tasks only");
    await tab(p, "chats");
  }
  check(where, /Needs you/i.test(t) && /Done/i.test(t) && /At work/i.test(t) && /Ready/i.test(t), "Needs you, Done, the rest");
  check(where, /Submit it now\?/.test(t) && /Claude asks to run gcloud/.test(t), "a chat's question and a permission are your move");
  check(where, /Fix the per-minute calc/.test(t) && /Submit the fellowship/.test(t), "loops due by tomorrow are your move");
  await tab(p, "tasks");
  check(where, /Felipe/.test(await text(p, ".today-yours")) && !!(await p.$(".today-yours .tcard.k-chase")), "who to follow up today is your move");
  await tab(p, "chats");
  check(where, /1 day|yesterday/.test(t), "a late loop says how late");
  check(where, /Study: T3 vs amarchy/.test(await text(p, ".today-finish")) && /Eval: json-render/.test(await text(p, ".today-idle")) && /Stalled/.test(await text(p, ".today-idle")),
        "done chats under Done; a stalled one under Ready, saying so");
  check(where, /Complete all 2/.test(await text(p, ".today-finish")), "Complete all, with two done");
  check(where, /Fix: login loop/.test(await text(p, ".today-yours")) && /stale cookie/.test(await text(p, ".today-yours")), "finished but not seen: it needs you, with what it said");
  check(where, await p.evaluate(() => { const a = document.querySelector(".tcard.k-done a.tbtn"); return !!a && a.href === "https://github.com/x/y/pull/1" && /Open the PR/.test(a.innerText); }), "a done chat's Review: the link its reply gave");
  check(where, await p.evaluate(() => !!document.querySelector(".today-working:not([open])") || !document.querySelector(".today-working")), "At work starts folded");
  check(where, !/Jaken/.test(await text(p, ".today-finish")) && !!(await p.$(".tcard.k-assistant")), "your assistant: a line on top, never to finish");
  // Seen without opening: off Needs you.
  await p.evaluate(() => { const c = document.querySelector(".tcard[data-id=proj-fresh]"); [...c.querySelectorAll(".tbtn")].find((b) => b.innerText === "Seen").click(); });
  check(where, await until(p, () => !/Fix: login loop/.test(document.querySelector(".today:not([hidden]) .today-yours").innerText)), "Seen: off Needs you");
  check(where, await p.evaluate(() => [...document.querySelectorAll(".tcard.k-ask .tcard-chip")].every((c) => c.innerText === "Proj")
                                      && document.querySelectorAll(".tcard .tcard-chip").length >= 2), "every chat says its project");
  check(where, await p.evaluate(() => !document.querySelector(".today-opt.primary")), "no option is pushed on you");
  await p.screenshot({ path: path.join(SHOTS, `${where}-today.png`), fullPage: true });

  // An answer: off the page at once, with Undo; sent once Undo's gone.
  check(where, await click(p, ".tcard.k-ask .tbtn", "Submit"), "a question's option tapped");
  check(where, await until(p, () => !/Submit it now\?/.test(document.querySelector(".today:not([hidden])").innerText) && !!document.querySelector(".undo-toast")), "it goes, Undo up");
  check(where, !p.posts.some((x) => /proj-ask\/send/.test(x.url)), "not sent yet");
  await sleep(4200);
  const sent = p.posts.find((x) => /proj-ask\/send/.test(x.url));
  check(where, !!sent && sent.body.text === "Submit it now", `then sent to the chat (${JSON.stringify(sent && sent.body)})`);

  // A permission: Allow, Undo, it comes back; Allow again, it goes.
  check(where, await click(p, ".tcard.k-ask .tbtn", "Allow"), "Allow, right on Today");
  await p.evaluate(() => [...document.querySelectorAll(".undo-toast .text-btn")].pop().click());
  check(where, await until(p, () => /Claude asks to run gcloud/.test(document.querySelector(".today:not([hidden])").innerText)), "Undo: it's back");
  await click(p, ".tcard.k-ask .tbtn", "Allow");
  await sleep(4000);
  const allowed = p.posts.find((x) => /proj-perm\/answer/.test(x.url));
  check(where, !!allowed && allowed.body.choice === "allow" && allowed.body.request_id === "req-1", "allowed, once");

  const tapIn = (what, label) => p.evaluate(({ what, label }) => {
    const row = [...document.querySelectorAll(".today:not([hidden]) .tcard.k-due, .today:not([hidden]) .tcard.k-chase")].find((r) => r.innerText.includes(what));
    const b = row && [...row.querySelectorAll(".tbtn")].find((x) => x.innerText.trim().replace(/^[^A-Za-z]+/, "") === label);
    if (b) b.click();
    return !!b;
  }, { what, label });
  await tab(p, "tasks");
  check(where, await tapIn("per-minute", "Done"), "a loop's Done tapped");
  await sleep(300);
  const done = p.posts.find((x) => /today\/loop/.test(x.url) && x.body.action === "done");
  check(where, !!done && done.body.key === "late1", "Done goes to your assistant, by the loop's key");
  check(where, /Sent to Jaken/.test(await text(p, ".today:not([hidden])")), "the loop says it was sent");
  check(where, await tapIn("valuation", "Follow up"), "Follow up tapped");
  await sleep(300);
  check(where, p.posts.some((x) => /today\/loop/.test(x.url) && x.body.action === "chase" && x.body.key === "wait1"), "the follow-up goes to your assistant");
  check(where, await tapIn("Submit the fellowship", "Ask Jaken…"), "Ask Jaken… tapped");
  check(where, await until(p, () => document.activeElement && document.activeElement.matches(".tcard-ask")), "its box, the keyboard in it");
  await p.keyboard.type("Draft it for me tonight");
  await p.keyboard.press("Enter");
  await sleep(300);
  const asked = p.posts.find((x) => /today\/loop/.test(x.url) && x.body.action === "ask");
  check(where, !!asked && asked.body.key === "tom1" && asked.body.text === "Draft it for me tonight", `what to do goes to your assistant (${JSON.stringify(asked && asked.body)})`);
  await tab(p, "chats");

  check(where, await click(p, ".tcard.k-stale .tbtn", "Ask status"), "a stalled chat asked");
  await sleep(300);
  check(where, p.posts.some((x) => /proj-quiet\/send/.test(x.url) && /Where does this stand/.test(x.body.text)), "the ask goes to that chat");

  // Complete: mission accomplished, then closed (nothing to lose: no sheet), with Undo.
  check(where, await click(p, ".tcard[data-id=proj-done] .tbtn", "Complete mission"), "a done chat's Complete mission tapped");
  check(where, await until(p, () => !!document.querySelector(".tcard.completing .tcard-complete")), "Mission complete, on its card");
  check(where, await until(p, () => !!document.querySelector(".mission .mission-kicker") && /1st today/.test(document.querySelector(".mission-stats").innerText)),
        "then the celebration: MISSION COMPLETE, the 1st today");
  await sleep(700);
  await p.screenshot({ path: path.join(SHOTS, `${where}-complete.png`) });
  await p.evaluate(() => { const m = document.querySelector(".mission"); if (m) m.remove(); });
  check(where, await until(p, () => !!document.querySelector(".undo-toast") && /Mission complete/.test(document.querySelector(".undo-toast").innerText) && !document.querySelector(".sheet")), "then closed, with Undo");
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

// The board as a structure, for the phone's and the computer's to be compared:
// the bar's parts, the tabs and their counts, and on each tab its sections,
// each card's chat, pill and buttons. Only the layout may differ.
const SHAPE = () => {
  const bar = [...document.querySelector(".board-head-in").children].map((c) => c.className.split(" ").pop());
  const tabs = [...document.querySelectorAll(".board-switch .control")].map((b) => b.textContent.trim());
  const sections = () => [...board.box.querySelectorAll(":scope > .tsec, :scope > .tcard, :scope > .ticket")].map((s) => ({
    title: (s.querySelector(".tsec-title") || {}).textContent || s.className,
    cards: [...s.querySelectorAll(".tcard")].map((c) => [c.dataset.id || (c.querySelector(".tcard-title") || {}).textContent,
      ((c.querySelector(".tpill") || {}).textContent || "").replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/, ""), [...c.querySelectorAll(".tcard-actions .tbtn")].map((x) => x.textContent.trim()).join("|")]) }));
  const was = board.tab;
  boardTab("chats"); const chats = sections();
  boardTab("tasks"); const tasks = sections();
  boardTab(was);
  return JSON.stringify({ bar, tabs, chats, tasks });
};
const shapes = {};

// An open chat's head, as a structure: its buttons (by what they do), its name, its pill.
const HEAD = () => {
  const hd = document.querySelector(".chat-head");
  return JSON.stringify({ btns: [...hd.querySelectorAll(".head-btn:not(.on)")].filter((b) => !/side|term|changes|details/i.test(b.title))
                            .map((b) => b.getAttribute("aria-label")), name: (hd.querySelector(".task") || {}).textContent,
                          chip: (hd.querySelector(".tcard-chip") || {}).textContent,
                          pill: ((hd.querySelector(".tpill") || {}).textContent || "").replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/, "") });
};

// The Tasks tab, for the eye; a task's line (when, its buttons) on one row, never a word a line.
async function shotTasks(p, where) {
  await p.evaluate(() => boardTab("tasks"));
  await p.screenshot({ path: path.join(SHOTS, `${where}-tasks.png`) });
  check(where, await p.evaluate(() => [...document.querySelectorAll(".tcard.k-chase .tcard-meta, .tcard.k-due .tcard-meta")]
    .every((m) => m.getBoundingClientRect().height < 2.6 * parseFloat(getComputedStyle(m).lineHeight || "16") || m.getBoundingClientRect().height < 48)),
        "a task's when and its buttons fit: no word a line");
  await p.evaluate(() => boardTab("chats"));
}

async function phone(browser, port) {
  const where = "phone";
  const p = await page(browser, "phone", port);
  await p.goto("/");
  await ready(p);
  check(where, await until(p, () => !!document.querySelector(".home-view .tasks-board .board-today .tsec")), "opens on the board, as a computer does");
  check(where, await p.evaluate(() => !document.querySelector(".list-view, .home-tabs, .hero, .session-row")), "no list of its own: the board is the home");
  shapes.phone = await p.evaluate(SHAPE);
  await shotTasks(p, where);
  check(where, /^Chats\s*3\s*Tasks\s*3$/.test((await text(p, ".board-switch")).trim()), `its tabs: Chats (3) | Tasks (3) (${JSON.stringify(await text(p, ".board-switch"))})`);
  check(where, await p.evaluate(() => { const r = document.querySelector(".board-switch").getBoundingClientRect(), s = document.querySelector(".board-search").getBoundingClientRect();
                                        return s.top >= r.bottom - 1 && s.width > 300 && document.documentElement.scrollWidth <= innerWidth; }),
        "its bar fits the phone: the search on a row of its own, nothing wider than the screen");
  check(where, await p.evaluate(() => getComputedStyle(document.querySelector(".board-search input")).fontSize === "16px"), "the search at 16px: iOS doesn't zoom in on it");
  // + : the new chat's box at the top of the board, its keyboard up; Not now: away.
  await p.evaluate(() => document.querySelector(".board-new-btn").click());
  check(where, await until(p, () => !document.querySelector(".board-new").hidden && document.activeElement === document.querySelector(".board-new textarea")), "+: the new chat's box, its keyboard up");
  await p.evaluate(() => document.querySelector(".board-new-close").click());
  check(where, await until(p, () => document.querySelector(".board-new").hidden), "Not now: away again");
  // Started: you stay on the board (it shows there once it's done), as after sending any chat something.
  await p.route("**/api/new", (r) => r.fulfill({ json: { id: "proj-work" } }));
  await p.evaluate(() => document.querySelector(".board-new-btn").click());
  await p.keyboard.type("Look into the search page");
  await p.evaluate(() => document.querySelector(".board-new .start-chat .send").click());
  await sleep(500);
  check(where, await p.evaluate(() => !app.session && document.querySelector(".board-new").hidden && /Started in Proj/.test((document.querySelector(".toast") || {}).innerText || "")),
        "a new chat started: you stay on the board");
  await p.unroute("**/api/new");
  const kept = await p.evaluate(async () => {
    const sc = board.scroll;
    sc.scrollTop = 300;
    const was = sc.scrollTop;
    app.view = { ...app.view, sessions: app.view.sessions.map((x) => ({ ...x, said: "new words" })) }; refresh();
    await new Promise((r) => setTimeout(r, 50));
    return { was, now: sc.scrollTop };
  });
  check(where, kept.was > 0 && kept.now === kept.was, `it scrolls, and keeps its place as the list changes (${JSON.stringify(kept)})`);
  await p.evaluate((chats) => { app.view = { ...app.view, sessions: chats.map((c) => ({ ...c })) }; refresh(); board.scroll.scrollTop = 0; }, CHATS);
  await common(p, where);
  // A card opens its chat, its own screen; Back: the board, where it was.
  await p.evaluate(() => { board.scroll.scrollTop = 120; document.querySelector(".ticket[data-id=proj-work] .today-go").click(); });
  check(where, await until(p, () => app.session && app.session.id === "proj-work"), "a card opens its chat");
  shapes.phoneHead = await p.evaluate(HEAD);
  check(where, await until(p, () => !!document.querySelector(".chat-dock .cbtn.send svg") && !!document.querySelector(".chat-dock .cbtn.mic svg")),
        "Send and the mic are drawings: they never wait on the font");
  await p.screenshot({ path: path.join(SHOTS, "phone-chat-open.png") });
  await p.evaluate(() => go("#/"));
  check(where, await until(p, () => !app.session && !!document.querySelector(".home-view .tasks-board") && board.scroll.scrollTop === 120), "back: the board, where it was");
  // Sent something: back on the board, told what's left.
  await p.evaluate(() => todayOpen(app.view.sessions.find((s) => s.id === "proj-work")));
  await until(p, () => app.session && app.session.id === "proj-work");
  await p.evaluate(() => app.session.chat.post("send", { text: "go on" }));
  check(where, await until(p, () => !app.session && !!document.querySelector(".home-view .tasks-board") && /^Sent/.test((document.querySelector(".toast") || {}).innerText || "")), "sent: back on the board");
  // Held down, a chat's card: its menu (priority, name, Complete).
  await p.evaluate(() => { const hd = document.querySelector(".tcard[data-id=proj-work] .tcard-head"), r = hd.getBoundingClientRect();
                           hd.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: r.x + 30, clientY: r.y + 10, pointerType: "touch" })); });
  await sleep(650);
  await p.evaluate(() => document.querySelector(".tcard[data-id=proj-work] .tcard-head").dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch" })));
  check(where, await until(p, () => !!document.querySelector(".sheet") && /Priority/.test(document.querySelector(".sheet").textContent)), "held down, a card: its menu");
  await p.evaluate(() => closeSheets());
  await p.screenshot({ path: path.join(SHOTS, "phone-board.png"), fullPage: false });
  check(where, !p.errors.length, `no page errors (${p.errors.join("; ")})`);
  await p.context().close();
}

async function wide(browser, port) {
  const where = "wide";
  const p = await page(browser, "wide", port);
  await p.goto("/");
  await ready(p);
  check(where, await until(p, () => !!document.querySelector(".tasks-board .board-today .tsec")
                                   && getComputedStyle(document.querySelector(".stage")).display === "none"), "launched: the board, the whole window");
  check(where, await p.evaluate(() => !document.querySelector(".panel, .ball, .board-classic, .today-btn")), "no list beside it: the board is the only layout");
  check(where, await p.evaluate(() => [...document.querySelector(".board-head-in").children].map((c) => c.className.split(" ").pop()).join(",")) === "board-switch,board-find,board-tools,board-new-btn",
        "the bar: Chats | Tasks, the search (and Group & sort), the tools, New chat");
  check(where, await until(p, () => document.activeElement && document.activeElement.matches(".tcard > .today-go")), "the keys on the first card at once");
  // One card, one surface: no stripe on its left, its head no box of its own.
  const look = await p.evaluate(() => {
    const c = document.querySelector(".tcard.k-ask"), hd = c.querySelector(".tcard-head"), cs = getComputedStyle(c);
    return { left: cs.borderLeftWidth, right: cs.borderRightWidth, leftColor: cs.borderLeftColor, rightColor: cs.borderRightColor,
             headBg: getComputedStyle(hd).backgroundColor };
  });
  check(where, look.left === look.right && look.leftColor === look.rightColor && /rgba\(0, 0, 0, 0\)|transparent/.test(look.headBg), `no stripe, no box in the card (${JSON.stringify(look)})`);
  check(where, /^Chats\s*3\s*Tasks\s*3$/.test((await text(p, ".board-switch")).trim()), `its tabs: Chats (3) | Tasks (3) (${JSON.stringify(await text(p, ".board-switch"))})`);
  check(where, /Try json-render/.test(await text(p, ".board-today")), "a ticket says its goal");
  shapes.wide = await p.evaluate(SHAPE);
  await shotTasks(p, where);
  // The phone and the computer: one app. The same bar, tabs, sections, cards, pills and buttons.
  if (shapes.phone) check("both", shapes.phone === shapes.wide, `the phone's board is the computer's${shapes.phone === shapes.wide ? "" : `\n    phone ${shapes.phone}\n    wide  ${shapes.wide}`}`);
  await common(p, where);

  // Hovered: the whole card lights, as one.
  const box = await p.evaluate(() => { const r = document.querySelector(".tcard[data-id=proj-fresh] .tcard-text").getBoundingClientRect(); return { x: r.x + 20, y: r.y + r.height / 2 }; });
  await p.mouse.move(box.x, box.y);
  await sleep(250);
  const hov = await p.evaluate(() => { const c = document.querySelector(".tcard[data-id=proj-fresh]"); return [getComputedStyle(c).backgroundImage, getComputedStyle(c.querySelector(".tcard-head")).backgroundColor]; });
  check(where, /gradient/.test(hov[0]) && /rgba\(0, 0, 0, 0\)|transparent/.test(hov[1]), `the card lights under the pointer, not its head alone (${hov.join(" | ")})`);
  await p.mouse.move(5, 790);

  // The whole card opens it, not only its head.
  await p.evaluate(() => document.querySelector(".ticket[data-id=proj-fresh] .tcard-text").click());
  check(where, await until(p, () => desk.current === "proj-fresh"), "a click anywhere on the card opens it");
  check(where, await p.evaluate(() => !!document.querySelector(".desk-head .board-back") && /Fix/.test(document.querySelector(".desk-head").innerText)
                                   && !!document.querySelector(".desk-head .head-btn.complete")), "over it: Back, its name, Complete");
  await p.evaluate(() => boardBack());
  await p.evaluate(() => boardOpen("proj-work"));
  await until(p, () => desk.current === "proj-work");
  const wideHead = await p.evaluate(HEAD);
  check(where, await until(p, () => !!document.querySelector(".chat-dock .cbtn.send svg") && !!document.querySelector(".chat-dock .cbtn.mic svg")),
        "Send and the mic are drawings: they never wait on the font");
  if (shapes.phoneHead) check("both", wideHead === shapes.phoneHead, `an open chat's head is the same on both${wideHead === shapes.phoneHead ? "" : `\n    phone ${shapes.phoneHead}\n    wide  ${wideHead}`}`);
  await p.evaluate(() => boardBack());

  // Opened: the whole window, its box ready; Back and Esc: the board, where you were.
  await p.evaluate(() => document.querySelector(".ticket[data-id=proj-fresh] .today-go").click());
  check(where, await until(p, () => desk.current === "proj-fresh" && getComputedStyle(document.querySelector(".tasks-board")).display === "none"
                                   && !!document.querySelector(".stage .chat")), "a ticket opens over the whole window");
  // The list changes under it (every second, live): it stays open.
  await p.evaluate(() => { app.view = { ...app.view, sessions: app.view.sessions.map((x) => ({ ...x, said: `${x.said || ""}.` })) }; refresh(); refresh(); });
  await sleep(300);
  check(where, await p.evaluate(() => desk.current === "proj-fresh" && !!document.querySelector(".stage .chat")), "it stays open as the list changes");
  await p.screenshot({ path: path.join(SHOTS, "wide-ticket-open.png") });
  await p.evaluate(() => document.querySelector(".desk-head .board-back").click());
  check(where, await until(p, () => !desk.current && getComputedStyle(document.querySelector(".stage")).display === "none"), "Back: the board");
  check(where, await p.evaluate(() => document.activeElement && document.activeElement.closest(".ticket[data-id=proj-fresh]")), "on the ticket it opened");
  await p.keyboard.press("Enter");
  check(where, await until(p, () => desk.current === "proj-fresh"), "Enter opens it again");
  await p.evaluate(() => document.activeElement.blur());
  await p.keyboard.press("Escape");
  check(where, await until(p, () => !desk.current), "Esc: back");
  await p.keyboard.press("Enter");
  await until(p, () => desk.current === "proj-fresh");
  await p.evaluate(() => { desk.chat.row = { ...desk.chat.row, status: "working" }; desk.chat.input.focus(); });
  await p.keyboard.press("Escape");
  check(where, await until(p, () => !desk.current), "Esc in the box, Claude at work: back too (not a stop)");
  check(where, !p.posts.some((x) => /proj-fresh\/(interrupt|keys)/.test(x.url)), "and Claude wasn't stopped");

  // Sent from an open chat: back to the board, it's off your move, the next lit with the keys.
  await p.evaluate(() => todayOpen(row("proj-quiet")));
  check(where, await until(p, () => desk.current === "proj-quiet"), "another opened");
  await p.evaluate(() => desk.chat.post("send", { text: "Go on" }));
  check(where, await until(p, () => !desk.current), "sent: back on the board");
  check(where, await p.evaluate(() => { const n = document.querySelector(".ticket.next"); return !n || n.contains(document.activeElement); }), "the next one lit, the keys on it");

  // Grouped as the list is: by priority (High first, what asks you first in each), by project.
  await p.evaluate(() => { app.organize = { group: ["priority"], sort: "priority" }; refresh(); });
  const grouped = await p.evaluate(() => [...board.box.querySelectorAll(".tsec .tsec-title")].map((t) => t.textContent));
  const clear = await p.evaluate(() => /Nothing needs you/.test(board.box.innerText));
  check(where, (grouped[0] === "Needs you" || (clear && grouped[0] === "Done")) && grouped.includes("High priority") && grouped.includes("Normal priority"),
        `by priority: Needs you (or that nothing does) first, Done, then its groups (${grouped.join(", ")})`);
  check(where, grouped.indexOf("High priority") < grouped.indexOf("Normal priority"), "High before Normal");
  check(where, /Build: Today/.test(await p.evaluate(() => [...board.box.querySelectorAll(".tsec")].find((x) => /^High/.test(x.querySelector(".tsec-title").textContent)).innerText))
               && !!(await p.$(".board-today .tsec .prio.high")), "the high one in High, its mark on it");
  const inGroups = await p.evaluate(() => [...board.box.querySelectorAll(".tsec")].filter((x) => /priority$/.test(x.querySelector(".tsec-title").textContent))
    .flatMap((x) => [...x.querySelectorAll(".tcard")].map((c) => c.className)));
  check(where, !inGroups.some((c) => /k-ask|k-blocked|k-fresh/.test(c)), "what needs you isn't in the groups too");
  await p.evaluate(() => { app.view = { ...app.view, sessions: app.view.sessions.map((x) => (x.id === "proj-done2" ? { ...x, unseen: true, today: { ...x.today, state: "" } } : x)) }; refresh(); });
  const unseenFirst = await p.evaluate(() => { const sec = board.box.querySelector(".tsec"); return sec && sec.querySelector(".tsec-title").textContent === "Needs you" && !!sec.querySelector(".tcard[data-id=proj-done2]"); });
  check(where, unseenFirst, "grouped, a chat you haven't opened is under Needs you, first");
  await p.evaluate(() => { app.organize = { group: ["project"], sort: "priority" }; refresh(); });
  const byProject = await p.evaluate(() => [...board.box.querySelectorAll(".tsec .tsec-title")].map((t) => t.textContent));
  check(where, byProject.includes("Proj") && !byProject.includes("High priority"), `by project: one group each (${byProject.join(", ")})`);
  await p.screenshot({ path: path.join(SHOTS, "wide-by-project.png") });
  await p.evaluate(() => { app.organize = { group: [], sort: "priority" }; refresh(); });
  check(where, /Needs you/i.test(await text(p, ".board-today")), "not grouped: Needs you, Done… again");

  // Ctrl+Alt+J / K: from chat to chat in the board's order.
  await p.evaluate(() => { board.scroll.focus(); });
  await p.keyboard.press("Control+Alt+KeyJ");
  const j1 = await p.evaluate(() => keyedId());
  await p.keyboard.press("Control+Alt+KeyJ");
  const j2 = await p.evaluate(() => keyedId());
  check(where, !!j1 && !!j2 && j1 !== j2, `Ctrl+Alt+J moves from card to card (${j1} → ${j2})`);
  await p.keyboard.press("Enter");
  await until(p, (id) => desk.current === id, j2);
  await p.keyboard.press("Control+Alt+KeyK");
  check(where, await until(p, (id) => desk.current === id, j1), "with one open, Ctrl+Alt+K opens the one before");
  await p.evaluate(() => boardBack());
  check(where, await p.evaluate(() => board.search.placeholder === "Search"), "the search box says only Search");

  // Ctrl+Alt+X on the board: the open chat closes (with Undo), from its box too.
  await p.evaluate(() => todayOpen(row("proj-quiet")));
  await until(p, () => desk.current === "proj-quiet");
  await p.evaluate(() => desk.chat.input.focus());
  await p.keyboard.press("Control+Alt+KeyX");
  check(where, await until(p, () => !desk.current && !!document.querySelector(".undo-toast") && /Mission complete: Eval/.test(document.querySelector(".undo-toast").innerText)),
        "Ctrl+Alt+X: the open chat's mission completes, with Undo");
  await p.evaluate(() => { const m = document.querySelector(".mission"); if (m) m.remove(); });
  await sleep(5600);
  check(where, p.posts.some((x) => /proj-quiet\/close/.test(x.url)), "closed once Undo's gone");

  // Dictating on a computer: the keys go to the box (Enter stops it there, the next sends).
  await p.evaluate(() => todayOpen(row("proj-work")));
  await until(p, () => desk.current === "proj-work");
  const keyed = await p.evaluate(() => { document.activeElement.blur(); desk.chat.talk.keys(); return document.activeElement === desk.chat.input; });
  check(where, keyed, "dictation puts the keys in the message box");
  await p.evaluate(() => boardBack());

  // Search: names at once, what was said from the host; Enter opens the first, Esc empties it.
  await p.route("**/api/search*", (r) => {
    const q = new URL(r.request().url()).searchParams.get("q");
    r.fulfill({ json: { q, results: /pricing/i.test(q) ? [{ id: "proj-done", name: false, hits: 2, at: Date.now() / 1000 - 3600,
      lines: [{ who: "claude", at: 0, text: "…the pricing table for C21 is ready…" }, { who: "you", at: 0, text: "check the pricing again" }] }] : [] } });
  });
  await p.evaluate(() => { document.activeElement && document.activeElement.blur(); });
  await p.keyboard.press("/");
  check(where, await p.evaluate(() => document.activeElement === board.search), "/: the search box");
  await p.keyboard.type("json");
  check(where, await until(p, () => /Eval: json-render/.test(board.box.innerText) && !!board.box.querySelector(".tcard mark")
                                   && !/Needs you/i.test(board.box.innerText)), "a chat by its name, the word lit, instead of Today");
  await p.evaluate(() => { board.search.value = ""; });
  await p.keyboard.type("pricing");
  check(where, await until(p, () => /Study: T3 vs amarchy/.test(board.box.innerText) && /pricing table for C21/.test(board.box.innerText)
                                   && /2 messages/.test(board.box.innerText)), "a chat by what was said in it, with its lines");
  await p.screenshot({ path: path.join(SHOTS, "wide-search.png") });
  await p.keyboard.press("Enter");
  check(where, await until(p, () => desk.current === "proj-done"), "Enter opens the first");
  await p.evaluate(() => boardBack());
  check(where, await p.evaluate(() => !!board.query && /pricing/.test(board.box.innerText)), "back: the search as it was");
  await p.evaluate(() => board.search.focus());
  await p.keyboard.press("Escape");
  check(where, await until(p, () => !board.query && /Needs you/i.test(board.box.innerText)), "Esc: Today again");

  // Keys: j / k move, n a new chat, Esc away.
  await p.evaluate(() => { document.activeElement.blur(); board.scroll.focus(); });
  await p.keyboard.press("j");
  const first = await p.evaluate(() => document.activeElement.closest(".ticket") && document.activeElement.closest(".ticket").dataset.id);
  await p.keyboard.press("j");
  await p.keyboard.press("j");
  const second = await p.evaluate(() => document.activeElement.closest(".ticket") && document.activeElement.closest(".ticket").dataset.id);
  check(where, !!first && !!second && first !== second, `j moves from card to card (${first} → ${second})`);
  check(where, await p.evaluate(() => { const c = document.activeElement.closest(".tcard"); return getComputedStyle(c).borderTopColor === getComputedStyle(document.documentElement).getPropertyValue("--focus-ring").trim() || /gradient/.test(getComputedStyle(c).backgroundImage); }),
        "the card under the keys is lit, the whole of it");
  await p.keyboard.press("k");
  check(where, await p.evaluate((id) => (document.activeElement.closest(".ticket") || {}).dataset?.id !== id, second), "k goes back");
  await p.keyboard.press("End");
  const last = await p.evaluate(() => document.activeElement.closest(".tcard") && document.activeElement.closest(".tcard").dataset.id);
  await p.keyboard.press("g");
  const top = await p.evaluate(() => document.activeElement.closest(".tcard") && document.activeElement.closest(".tcard").dataset.id);
  check(where, !!last && top === "me-jaken" && last !== top, `End / g: the last card and the first (${last}, ${top})`);
  // On Tasks too: your tasks are cards the keys go through.
  await p.keyboard.press("l");
  check(where, await until(p, () => board.tab === "tasks"), "l: Tasks");
  await p.keyboard.press("j");
  check(where, await p.evaluate(() => !!document.activeElement.closest(".tcard.k-due, .tcard.k-chase, .tsec")), "j on Tasks: from task to task");
  await p.keyboard.press("h");
  check(where, await until(p, () => board.tab === "chats"), "h: Chats");
  await p.keyboard.press("?");
  check(where, await until(p, () => /On the board/.test((document.querySelector(".sheet") || {}).innerText || "")), "?: the keys");
  await p.keyboard.press("Escape");
  await until(p, () => !document.querySelector(".sheet-back"));
  await p.keyboard.press("n");
  check(where, await until(p, () => !document.querySelector(".board-new").hidden && document.activeElement === document.querySelector(".board-new textarea")), "n: a new chat, its box at the top");
  await p.keyboard.press("Escape");
  check(where, await until(p, () => document.querySelector(".board-new").hidden), "Esc: away again");

  await p.setViewportSize({ width: 1280, height: 520 });
  const sc = await p.evaluate(() => { const el = document.querySelector(".board-scroll"); el.scrollTop = 200; return el.scrollTop; });
  check(where, sc > 0, `the board scrolls (${sc})`);
  await p.setViewportSize({ width: 1280, height: 800 });

  // A screenshot pasted into the new chat: it goes with what you wrote.
  const made = [];
  await p.route("**/api/new", (r) => { made.push(r.request().postDataJSON()); r.fulfill({ json: { id: "proj-work" } }); });
  await p.keyboard.press("n");
  await until(p, () => document.activeElement === document.querySelector(".board-new textarea"));
  await p.keyboard.type("Fix what this shows");
  await p.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 40; c.height = 30;
    c.getContext("2d").fillRect(0, 0, 40, 30);
    const blob = await new Promise((ok) => c.toBlob(ok, "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "image.png", { type: "image/png" }));
    document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  check(where, await until(p, () => !!document.querySelector(".board-new .tray .att.image img")), "a screenshot pasted into the new chat: on it");
  await p.keyboard.press("Enter");
  check(where, await until(p, () => document.querySelector(".board-new").hidden), "started: the box goes");
  await sleep(400);
  check(where, await p.evaluate(() => !desk.current && getComputedStyle(document.querySelector(".tasks-board")).display !== "none"
                                   && /Started in Proj/.test((document.querySelector(".toast") || {}).innerText || "")), "and you stay on the board, on with the rest");
  check(where, made.length === 1 && made[0].prompt === "Fix what this shows" && (made[0].images || []).length === 1 && made[0].images[0].type === "image/png" && made[0].images[0].data.length > 20,
        `the picture goes with it (${JSON.stringify(made.map((x) => ({ ...x, images: (x.images || []).length })))})`);
  check(where, await p.evaluate(() => !document.querySelector(".board-new .tray .att")), "and the box is empty again");
  // Ctrl+Alt+H: the board; Ctrl+Alt+A: any chat, by its name.
  await p.keyboard.press("Control+Alt+KeyH");
  check(where, await until(p, () => !desk.current), "Ctrl+Alt+H: the board");
  await p.keyboard.press("Control+Alt+KeyA");
  check(where, await until(p, () => !!document.querySelector(".picker")), "Ctrl+Alt+A: go to a chat");
  await p.keyboard.type("login");
  await p.keyboard.press("Enter");
  check(where, await until(p, () => desk.current === "proj-fresh"), "picked by its name, it opens");
  await p.keyboard.press("Escape");
  check(where, await until(p, () => !desk.current), "Esc: the board");
  await p.reload();
  await ready(p);
  check(where, await until(p, () => !!document.querySelector(".tasks-board .tcard") && getComputedStyle(document.querySelector(".stage")).display === "none"), "reloaded: the board");
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
    fs.rmSync(home, { recursive: true, force: true });      // its own home: 70 MB in /tmp each run otherwise
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
