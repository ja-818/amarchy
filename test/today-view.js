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
  { id: "proj-perm", repo: "proj", name: "perm", task: "Meta: verification", status: "waiting", asks: "Claude asks to run gcloud", engine: "chat", path: "/tmp/p", today: T({}) },
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
  for (const what of ["send", "close"]) {
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
  check(where, /Your move/i.test(t) && /Finish/i.test(t) && /Their move/i.test(t), "Your move, Finish, Their move");
  check(where, /Submit it now\?/.test(t) && /Claude asks to run gcloud/.test(t), "a chat's question and a permission are your move");
  check(where, /Fix the per-minute calc/.test(t) && /Submit the fellowship/.test(t), "loops due by tomorrow are your move");
  check(where, /1 day|yesterday/.test(t), "a late loop says how late");
  check(where, /Study: T3 vs amarchy/.test(await text(p, ".today-finish")), "a done chat is to finish");
  check(where, /Eval: json-render/.test(await text(p, ".today-finish")), "a chat quiet for days is to finish");
  check(where, !/Jaken/.test(await text(p, ".today-finish")), "your assistant is never to finish");
  await p.screenshot({ path: path.join(SHOTS, `${where}-today.png`), fullPage: true });

  check(where, await click(p, ".today-card.ask .control", "Submit"), "a question's option tapped");
  await sleep(300);
  const sent = p.posts.find((x) => /proj-ask\/send/.test(x.url));
  check(where, !!sent && sent.body.text === "Submit it now", `its answer sent to the chat (${JSON.stringify(sent && sent.body)})`);

  check(where, await click(p, ".today-loop .control", "Done"), "a loop's Done tapped");
  await sleep(300);
  const done = p.posts.find((x) => /today\/loop/.test(x.url) && x.body.action === "done");
  check(where, !!done && done.body.key === "late1", "Done goes to your assistant, by the loop's key");
  check(where, /Sent to Jaken/.test(await text(p, ".today:not([hidden])")), "the loop says it was sent");

  await p.evaluate(() => { const d = [...document.querySelectorAll(".today-fold")].find((x) => /Waiting on others/.test(x.innerText)); if (d) d.open = true; });
  check(where, await click(p, ".today-loop .control", "Chase"), "a chase tapped");
  await sleep(300);
  check(where, p.posts.some((x) => /today\/loop/.test(x.url) && x.body.action === "chase" && x.body.key === "wait1"), "the chase goes to your assistant");

  check(where, await click(p, ".today-line.stale .control", "Nudge"), "a quiet chat nudged");
  await sleep(300);
  check(where, p.posts.some((x) => /proj-quiet\/send/.test(x.url) && /Where does this stand/.test(x.body.text)), "the nudge goes to that chat");

  check(where, await click(p, ".today-line.done .control", "Close"), "a done chat's Close tapped");
  check(where, await until(p, () => !!document.querySelector(".sheet") && /Close/.test(document.querySelector(".sheet").innerText)), "Close asks first");
  await p.screenshot({ path: path.join(SHOTS, `${where}-close.png`) });
  await click(p, ".sheet .control", "Close chat");
  await sleep(300);
  check(where, p.posts.some((x) => /proj-done\/close/.test(x.url)), "closed when you say so");

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
  check(where, /4/.test(await text(p, ".home-tabs .tab[data-tab=today]")), "its tab counts your move (2 asks, 2 loops)");
  check(where, !!(await p.$(".list-view .dock .start-chat")), "the new chat stays under it");
  // It scrolls, and stays where you scrolled it while the list changes under it.
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
  await p.evaluate(() => document.querySelector(".home-tabs .tab[data-tab=chats]").click());
  check(where, await until(p, () => !document.querySelector(".list-view .list").hidden && document.querySelector(".today").hidden), "Chats: the list");
  await p.screenshot({ path: path.join(SHOTS, "phone-chats.png") });
  check(where, !p.errors.length, `no page errors (${p.errors.join("; ")})`);
  await p.context().close();
}

async function wide(browser, port) {
  const where = "wide";
  const p = await page(browser, "wide", port);
  await p.goto("/");
  await ready(p);
  check(where, await until(p, () => desk.today && !!document.querySelector(".desk-empty:not([hidden]) .today")), "launched: Today in the middle");
  await p.setViewportSize({ width: 1280, height: 520 });
  const sc = await p.evaluate(() => {
    const el = document.querySelector(".today-scroll");
    el.scrollTop = 200;
    return { top: el.scrollTop, fits: el.clientHeight < window.innerHeight };
  });
  check(where, sc.top > 0 && sc.fits, `the middle scrolls (${JSON.stringify(sc)})`);
  await p.evaluate(() => { document.querySelector(".today-scroll").scrollTop = 0; });
  await p.setViewportSize({ width: 1280, height: 800 });
  check(where, /Today/.test(await text(p, ".panel-buttons .today-btn")) && await p.evaluate(() => document.querySelector(".today-btn").classList.contains("on")), "its button over the list, on");
  check(where, await p.evaluate(() => [...document.querySelectorAll(".panel-buttons .control")].map((b) => b.className.split(" ")[1]).join(",")) === "new-chat,today-btn,brand", "the bar: New chat, Today, the cog");
  await common(p, where);
  await p.evaluate(() => go2("proj-work"));
  check(where, await until(p, () => desk.current === "proj-work"), "a chat opened");
  await p.evaluate(() => document.querySelector(".today-btn").click());
  check(where, await until(p, () => desk.today && !desk.current), "the Today button: Today again");
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
